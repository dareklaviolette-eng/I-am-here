// Boats station (the template station, Station Rules v1): ride a real ship from live AIS, Helm / Bow / Aft / Port /
// Starboard / Chase / God's eye, every ship around you is a target (point + select -> Be There -> hop aboard, in VR too).
// Reuses the boats page's own code (stations/boats/ais-core.js + ships3d.js, generated from boats/index.html), so the AIS,
// LOC and card rules are the same: LIVE only while reports are truly arriving, else HIST <age>; SIM for simulated ships;
// LOC by the card spec's sea zones (port / 12 nm place, 12-200 nm ocean, beyond: International waters).
//   params: area (AREAS id; default DEFAULT_AREA in meta.js), mmsi (board this ship), pov, sim=1 (simulated ships: tests /
//   no network; labelled SIM everywhere)
import { AISCore as C } from './ais-core.js';
import { createShipKit } from './ships3d.js';
import meta, { DEFAULT_AREA, AREA_ORDER } from './meta.js';

const RELAY = 'https://imhere-flights.bt4w8jn5ty.workers.dev';
const LIVE_MAX_AGE_MS = 20 * 60 * 1000, LIVE_FRESH_MS = 30000;
const CAT_COLORS = { cargo: '#3d7fd9', tanker: '#c0392b', tug: '#f0a020', passenger: '#8e44ad', pleasure: '#e84393', fishing: '#16a085', special: '#d35400', other: '#7f8c8d', unknown: '#95a5a6' };
const TILE_SOURCES = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const POVS = meta.povs, POV_NAMES = Object.fromEntries(POVS);
const MODE_YAW = { captain: 0, deck: 0, aft: Math.PI, port: Math.PI / 2, stbd: -Math.PI / 2 };
const isEye = (m) => m in MODE_YAW;
const CAPTAIN_PITCH = -0.2, KNOT_MS = 1852 / 3600, R_E = 6371008.8, D2R = Math.PI / 180;
// "worth riding" first (maritime brief): cruise, yachts, sail, ferries, then the rest; tankers and tugs last
const WORTH = { cruise: 0, yacht: 1, sailboat: 2, ferry: 3, fishing: 5, generic: 6, workboat: 6, container: 7, bulk: 7, tow: 8, tanker: 8, tug: 9 };
const SHORT_AREA = Object.fromEntries(AREA_ORDER.map((a) => [a[0], a[1]]));
const CARD_CREDITS = [{ text: 'Imagery © Esri, Maxar, Earthstar Geographics', href: 'https://www.esri.com' }, { text: "AIS: aisstream.io, relayed by the I'M HERE server", href: 'https://aisstream.io' },
  { text: 'Flags: flag-icons (MIT)', href: 'https://github.com/lipis/flag-icons' }, { text: '3D: three.js (MIT). Built with Claude AI' }];

export function createStation(ctx) {
  const { THREE, root, camera, renderer } = ctx;
  const S = { area: null, areaId: '', store: new C.VesselStore(), feed: null, sim: false, lastMsgAt: 0, feedKind: 'idle', feedText: '', ride: null, mode: 'captain', shipsOn: true,
    level: 0, alive: true, userPicked: false, startedAt: 0 };
  const vessels = new Map(), order = [];
  let kit = null, lat0 = 0, lon0 = 0, cosLat0 = 1, aboardYaw = null, hovered = null, labelClock = 0, builtThisFrame = 0;
  const eye = new THREE.Vector3(), camW = new THREE.Vector3(), dir = new THREE.Vector3(), drOut = { lat: 0, lon: 0 }, UP = new THREE.Vector3(0, 1, 0), hit = new THREE.Vector3();

  // ---------------------------------------------------------------- feeds (live through the relay, or simulated)
  function liveNow(now) { return !S.sim && S.feedKind === 'open' && S.lastMsgAt > 0 && now - S.lastMsgAt < LIVE_FRESH_MS; }
  function apply(u, now, simulated) {
    if (!u) return;
    if (u.kind === 'relay') { S.feedKind = 'open'; return; }
    if (u.kind === 'relayError' || u.kind === 'error') { S.feedText = u.error; return; }
    if (u.time == null || Math.abs(now - u.time) > 120000) u.time = now;
    S.feedKind = 'open'; S.lastMsgAt = now;
    const v = S.store.apply(u, now); if (v && simulated) v.simulated = true;
  }
  function liveFeed(box) {
    let ws = null, stopped = false, attempt = 0, timer = 0;
    const dec = new TextDecoder();
    const connect = () => {
      if (stopped || !S.alive) return;
      S.feedKind = 'connecting';
      try { ws = new WebSocket(C.relayUrl(RELAY, box)); } catch (e) { fail('could not open a connection'); return; }
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (ev) => { const d = ev.data; apply(C.parseMessage(typeof d === 'string' ? d : dec.decode(d)), Date.now(), false); attempt = 0; };
      ws.onclose = () => { if (!stopped) fail('the ship feed connection closed'); };
      ws.onerror = () => {};
    };
    const fail = (why) => { ws = null; S.feedKind = 'error'; S.feedText = why; attempt++; clearTimeout(timer); timer = setTimeout(connect, Math.min(60, Math.pow(2, Math.min(attempt, 6))) * 1000); };
    connect();
    return { stop() { stopped = true; clearTimeout(timer); if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch (e) { /* ignore */ } } ws = null; } };
  }
  // simulated ships for the area (labelled SIM everywhere): a small fleet on gentle courses inside the area box
  function simFeed(area) {
    const [[a0, b0], [a1, b1]] = area.box, la = (a0 + a1) / 2, lo = (b0 + b1) / 2, sLa = Math.abs(a1 - a0) * 0.3, sLo = Math.abs(b1 - b0) * 0.3;
    const FLEET = [['SIM HARBOUR FERRY', 60, 30, 8, 11], ['SIM SEA BREEZE', 36, 10, 3, 6], ['SIM SUPERYACHT', 37, 38, 12, 9], ['SIM EXPLORER', 60, 220, 60, 14],
      ['SIM PILOT', 50, 14, 6, 15], ['SIM FISHER', 30, 20, 6, 5], ['SIM TUG', 52, 16, 8, 7], ['SIM SAILS', 36, 14, 4, 7]];
    const ships = FLEET.map(([name, type, A, B, sog], i) => ({ mmsi: 999100000 + i, name, type, dims: { A, B, C: Math.max(2, (A + B) / 10), D: Math.max(2, (A + B) / 10) }, sog,
      lat: la + Math.sin(i * 2.4) * sLa, lon: lo + Math.cos(i * 1.7) * sLo, cog: (i * 47 + 20) % 360 }));
    let last = Date.now();
    const tick = () => {
      const now = Date.now(), dt = (now - last) / 1000; last = now;
      for (const s of ships) {
        const p = C.destination(s.lat, s.lon, s.cog, s.sog * KNOT_MS * dt); s.lat = p.lat; s.lon = p.lon;
        if (Math.abs(s.lat - la) > sLa * 1.6 || Math.abs(s.lon - lo) > sLo * 1.6) s.cog = C.bearing(s.lat, s.lon, la, lo);   // turn back toward the middle
        else s.cog = (s.cog + 0.6 * dt + 360) % 360;
        const t = C.fmtTimeUtc(now);
        apply(C.parseMessage({ MessageType: 'PositionReport', MetaData: { MMSI: s.mmsi, ShipName: s.name, time_utc: t },
          Message: { PositionReport: { UserID: s.mmsi, Latitude: s.lat, Longitude: s.lon, Sog: s.sog, Cog: Math.round(s.cog * 10) / 10, TrueHeading: Math.round(s.cog) % 360, NavigationalStatus: s.type === 36 ? 8 : 0 } } }), now, true);
      }
    };
    ships.forEach((s) => apply(C.parseMessage({ MessageType: 'ShipStaticData', MetaData: { MMSI: s.mmsi, ShipName: s.name, time_utc: C.fmtTimeUtc(Date.now()) },
      Message: { ShipStaticData: { UserID: s.mmsi, Name: s.name, Type: s.type, Dimension: s.dims, Destination: 'SIM ' + (SHORT_AREA[S.areaId] || 'HARBOUR').toUpperCase(), CallSign: 'SIM' } } }), Date.now(), true));
    tick();
    const id = ctx.setInterval(tick, 2000);
    return { stop() { clearInterval(id); } };
  }

  // ---------------------------------------------------------------- geography (no allocations)
  function drInto(f, now, out) {
    const dt = Math.max(0, Math.min(C.MAX_DR_SECONDS, (now - f.time) / 1000));
    if (f.sog == null || f.cog == null || f.sog < 0.3 || dt === 0) { out.lat = f.lat; out.lon = f.lon; return out; }
    const d = f.sog * KNOT_MS * dt / R_E, b = f.cog * D2R, p1 = f.lat * D2R, l1 = f.lon * D2R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    out.lat = p2 / D2R; out.lon = (l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))) / D2R;
    return out;
  }
  const xOf = (lon) => (lon - lon0) * D2R * R_E * cosLat0, zOf = (lat) => -(lat - lat0) * D2R * R_E;

  // ---------------------------------------------------------------- satellite imagery under the sea (land and shallows; deep water fades out)
  function loadTiles(area) {
    const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
    for (const t of C.tilesForBox(area.box, 48, 13)) {
      const x0 = xOf(t.west), z0 = zOf(t.north), x1 = xOf(t.east), z1 = zOf(t.south), w = x1 - x0, h = z1 - z0;
      const mat = kit.tileMaterial(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x0 + w / 2, 1.0, z0 + h / 2); mesh.renderOrder = 1; kit.tileGroup.add(mesh);
      const done = (tex) => { if (!S.alive) { tex.dispose(); return; } tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = kit.maxAniso; mat.map = tex; mat.opacity = 1; mat.needsUpdate = true; };
      const url = (i) => TILE_SOURCES[i].replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
      loader.load(url(0), done, undefined, () => { if (S.alive) loader.load(url(1), done, undefined, () => {}); });
    }
  }

  // ---------------------------------------------------------------- ships
  function addVessel(v, now) {
    const model = kit.buildModel(v);
    const s = { v, model, x: 0, z: 0, offX: 0, offZ: 0, yaw: C.displayHeading(v.fix) || 0, fixTime: v.fix.time, phase: (kit.hash(v.mmsi) % 628) / 100,
      kType: v.shipType, kLen: v.dims ? v.dims.length : 0, kName: v.name, d2: 0, kind: model.kind, heave: 0, pitch: 0, roll: 0 };
    drInto(v.fix, now, drOut); s.x = xOf(drOut.lon); s.z = zOf(drOut.lat);
    root.add(model.group); vessels.set(v.mmsi, s); return s;
  }
  function removeVessel(mmsi) { const s = vessels.get(mmsi); if (!s) return; s.model.group.removeFromParent(); kit.disposeGroup(s.model.group); vessels.delete(mmsi); if (S.ride === mmsi) S.ride = null; }
  let nowMs = 0, frameDt = 0, frameT = 0;
  function stepVessel(v) {
    if (!v.fix) return;
    let s = vessels.get(v.mmsi);
    if (!s) { if (builtThisFrame >= 2) return; builtThisFrame++; s = addVessel(v, nowMs); }   // at most two new models a frame (no hitches)
    else if (s.kType !== v.shipType || s.kLen !== (v.dims ? v.dims.length : 0) || s.kName !== v.name) {
      if (builtThisFrame >= 2) return; builtThisFrame++;
      s.model.group.removeFromParent(); kit.disposeGroup(s.model.group); s.model = kit.buildModel(v); s.kind = s.model.kind; root.add(s.model.group);
      s.kType = v.shipType; s.kLen = v.dims ? v.dims.length : 0; s.kName = v.name;
    }
    drInto(v.fix, nowMs, drOut);
    const px = xOf(drOut.lon), pz = zOf(drOut.lat), hd = C.displayHeading(v.fix);
    if (s.fixTime !== v.fix.time) {   // a new report: keep the boat where it is and glide the correction away
      const ox = s.x - px, oz = s.z - pz;
      if (ox * ox + oz * oz < 4e6) { s.offX = ox; s.offZ = oz; } else { s.offX = s.offZ = 0; }
      s.fixTime = v.fix.time;
    }
    const k = C.decayFactor(frameDt, 1.6); s.offX *= k; s.offZ *= k;
    s.x = px + s.offX; s.z = pz + s.offZ;
    if (hd != null) s.yaw += C.shortestAngle(s.yaw, hd) * (1 - C.decayFactor(frameDt, 1.2));
    const g = s.model.group; g.position.set(s.x, 0, s.z); g.rotation.y = -s.yaw * D2R;
    g.visible = S.shipsOn || v.mmsi === S.ride;
    kit.seaMotion(s, frameT, frameDt);
    const sog = v.fix.sog || 0;
    s.model.wake.visible = sog >= 0.3 && S.level < 1; s.model.wake.material.uniforms.uSog.value = sog;
    if (s.model.sails) { s.model.sails.visible = sog >= 1.5; s.model.furled.visible = sog < 1.5; }
  }
  const byDist = (a, b) => a.d2 - b.d2;
  function sortLabels() {
    order.length = 0; vessels.forEach((s) => { const dx = s.x - camW.x, dz = s.z - camW.z; s.d2 = dx * dx + dz * dz; order.push(s); });
    order.sort(byDist);
    const xr = ctx.isXR(), aboard = isEye(S.mode);
    for (let i = 0; i < order.length; i++) {
      const s = order[i], riding = s.v.mmsi === S.ride;
      s.model.label.visible = S.level < 2 && (riding ? !aboard : i < (xr ? 12 : 30)) && s.model.group.visible;
    }
  }

  // ---------------------------------------------------------------- the ride (the shell's seat keeps the comfort rules)
  function rideTo(mmsi, mode) {
    S.ride = mmsi; aboardYaw = null; if (mode) S.mode = mode;
    ctx.setLookPitch(S.mode === 'captain' ? CAPTAIN_PITCH : -0.04);
    pushCard(); pushEfb();
  }
  function bestShip() {
    let best = null, bs = Infinity; const c = S.area.center;
    S.store.vessels.forEach((v) => {
      if (!v.fix) return; const kind = C.modelKind(v), d = C.distance(c[0], c[1], v.fix.lat, v.fix.lon);
      const sc = (WORTH[kind] == null ? 6 : WORTH[kind]) * 1e6 + (v.name ? 0 : 5e5) + (v.fix.sog >= 0.5 ? 0 : 2e5) + d;
      if (sc < bs) { bs = sc; best = v.mmsi; }
    });
    return best;
  }
  function seat(dt) {
    const s = S.ride != null ? vessels.get(S.ride) : null;
    if (!s) {   // no ship yet: a harbour view above the middle of the area, looking along it
      ctx.placeSeat(0, ctx.isXR() ? 30 : 60, 220, 0); return;
    }
    const want = s.yaw * D2R;
    if (aboardYaw === null) aboardYaw = want;
    else { const d = Math.atan2(Math.sin(want - aboardYaw), Math.cos(want - aboardYaw)), cap = (30 * D2R) * dt; aboardYaw += Math.max(-cap, Math.min(cap, d)); }   // comfort: <= 30 deg/s
    const m = s.model;
    if (isEye(S.mode)) {
      const spot = m.spots[S.mode] || m.spots.captain;
      eye.copy(spot).add(m.anchor).applyEuler(m.motion.rotation); eye.y += m.motion.position.y;
      eye.applyAxisAngle(UP, -aboardYaw).add(m.group.position);
      ctx.placeSeat(eye.x, eye.y, eye.z, -aboardYaw + (S.mode === 'deck' ? m.spots.deckYaw : MODE_YAW[S.mode]));
    } else {
      const L = m.length; let back, up;
      if (S.mode === 'god') { up = Math.max(140, L * 3); back = up * 0.3; } else { const small = L < 60; back = small ? L * 1.8 + 12 : L * 0.9 + 40; up = small ? L * 0.5 + 5 : L * 0.35 + 18; }
      ctx.placeSeat(s.x - Math.sin(aboardYaw) * back, up, s.z + Math.cos(aboardYaw) * back, -aboardYaw);
    }
  }

  // ---------------------------------------------------------------- the card (card spec v1) and the EFB
  function tagOf(v, now) {
    if (!v) return '';
    if (v.simulated || S.sim) return 'SIM';
    return liveNow(now) && now - (v.updatedAt || 0) < 3 * 60000 ? 'LIVE' : 'HIST ' + C.formatAge(now - (v.updatedAt || 0));
  }
  function pushCard() {
    const now = Date.now(), live = liveNow(now), v = S.ride != null ? S.store.vessels.get(S.ride) : null;
    let n = 0; S.store.vessels.forEach((x) => { if (x.fix) n++; });
    const status = live ? 'Live AIS reports arriving' : S.sim ? 'SIMULATED: made-up ships, not real vessels or positions' : S.feedKind === 'error' ? "Can't reach ship feed: " + S.feedText : S.feedKind === 'open' ? 'Connected, waiting for reports' : 'Connecting…';
    const notes = ['Now: ' + status, 'Picture: an icon of the ship type (no licensed ship photos yet; never a fake photo).',
      'Scene: satellite imagery (Esri, not live); ships from AIS reports; sea, waves and ship models are computer-drawn (typical of the reported type). Movement between reports is estimated.'];
    const sig = S.sim ? { source: 'Simulated', tag: 'SIM' } : { source: 'AIS', tag: live ? '' : 'HIST' };
    if (!v) {
      ctx.setCard({ live, thumb: { icon: C.shipIcon('ferry'), label: 'Ships' }, type: n + (n === 1 ? ' ship nearby' : ' ships nearby'), loc: SHORT_AREA[S.areaId] || S.area.name, org: '',
        id: null, rte: '', pov: "God's eye", route: n + ' ships nearby', sig, time: S.lastMsgAt || Date.now(), details: { rows: [['Area', S.area.name]], notes, credits: CARD_CREDITS } });
      return;
    }
    const fl = S.sim ? null : C.flagInfo(v.mmsi), kind = C.modelKind(v), dr = v.fix ? drInto(v.fix, now, { lat: 0, lon: 0 }) : null;
    const li = dr ? C.locInfo(dr.lat, dr.lon) : null, dest = C.destShort(v), phase = C.navPhase(v);
    ctx.setCard({ live: live && !S.sim, thumb: { icon: C.shipIcon(kind), label: C.displayType(v) }, photo: null, photoNote: 'type icon · no photo',
      flag: fl ? { iso2: fl.iso2, name: fl.name } : null, reg: v.imo ? 'IMO ' + v.imo : 'MMSI ' + v.mmsi, type: C.displayType(v),
      loc: (li && li.loc) || SHORT_AREA[S.areaId], org: S.sim ? '' : C.operatorFull(v.name), id: { label: 'NAME', value: C.vesselTitle(v) },
      rte: [dest ? '→ ' + dest : '', phase].filter(Boolean).join(' · '), route: dest ? '→ ' + dest : phase, pov: POV_NAMES[S.mode],
      sig: S.sim ? sig : { source: 'AIS', tag: live && now - (v.updatedAt || 0) < 3 * 60000 ? '' : 'HIST' }, time: v.updatedAt || null,
      details: { rows: [['IMO', v.imo || 'not sent'], ['MMSI', v.mmsi], ['Dest', v.destination ? C.cleanText(v.destination) : 'not sent'], ['Shore', li ? C.offshoreText(li) : '']], notes, credits: CARD_CREDITS } });
  }
  function shipRows() {
    const rows = [], now = Date.now(), c = S.area.center;
    S.store.vessels.forEach((v) => {
      if (!v.fix) return; const kind = C.modelKind(v);
      rows.push({ v, w: WORTH[kind] == null ? 6 : WORTH[kind], d: C.distance(c[0], c[1], v.fix.lat, v.fix.lon) });
    });
    rows.sort((a, b) => (a.v.mmsi === S.ride ? -1 : b.v.mmsi === S.ride ? 1 : 0) || a.w - b.w || (!!b.v.name - !!a.v.name) || a.d - b.d);
    return rows.slice(0, 24).map(({ v }) => ({ id: String(v.mmsi), name: C.vesselTitle(v), sub: C.displayType(v), sel: v.mmsi === S.ride, tag: tagOf(v, now).split(' ')[0], target: targetOf(v, now) }));
  }
  function pushEfb() {
    const n = S.store.vessels.size;
    ctx.setEfb({ povs: S.ride != null ? POVS : [['god', "God's eye"]], pov: S.ride != null ? S.mode : 'god',
      listTitle: 'Ships nearby', list: shipRows(),
      layers: [['ships', 'Ships', S.shipsOn, false], ['planes', 'Planes', false, true], ['wildlife', 'Wildlife', false, true], ['iss', 'ISS', false, true]],
      time: S.sim ? [['sim', 'SIM', true, false], ['hist', 'HIST', false, true]] : [['live', 'LIVE', true, false], ['hist', 'HIST', false, true]],
      status: n ? '' : S.feedKind === 'error' ? "Can't reach the ship feed: " + S.feedText : 'Listening for ships in ' + (SHORT_AREA[S.areaId] || S.area.name) + '…',
      data: (() => { const v = S.ride != null ? S.store.vessels.get(S.ride) : null; if (!v) return []; const d = C.helmData(v, Date.now()); return [['HDG', d.hdg], ['SOG', d.sog], ['DEST', d.dest]]; })() });
  }
  function targetOf(v, now) {
    const dr = drInto(v.fix, now, { lat: 0, lon: 0 }), li = C.locInfo(dr.lat, dr.lon);
    return { id: v.mmsi, mmsi: v.mmsi, name: C.vesselTitle(v), line: [C.displayType(v), C.shipStatus(v), li.loc].filter(Boolean).join(' · '), tag: tagOf(v, now).split(' ')[0],
      station: 'boats', here: v.mmsi === S.ride, kind: 'ship',
      hero: () => {   // the ship's own model (body only), built with the station's shared materials: the shell must not dispose those
        const k = kit, m = k.buildModel(v); m.motion.remove(m.body); k.disposeGroup(m.group); m.body.position.set(0, 0, 0);
        return { object: m.body, shared: true, dispose: () => k.disposeGroup(m.body), note: 'Rendered: typical of its type' };
      } };
  }

  // ---------------------------------------------------------------- the station contract
  return {
    describe: () => ({ id: 'boats', name: meta.name, blocks: meta.blocks, povs: POVS, link: '#station=boats&area=' + S.areaId }),

    async load(params, progress) {
      S.areaId = C.AREAS[params.area] ? params.area : DEFAULT_AREA; S.area = C.AREAS[S.areaId];
      S.sim = params.sim === '1' || params.sim === 1 || params.sim === true;
      lat0 = S.area.center[0]; lon0 = S.area.center[1]; cosLat0 = Math.cos(lat0 * D2R);
      ctx.setTitle(SHORT_AREA[S.areaId] || S.area.name);
      progress(0.05, 'Opening the sea');
      kit = createShipKit(THREE, C, { scene: root, renderer, CAT_COLORS });
      ctx.setEnv({ background: kit.HORIZON.clone(), fog: new THREE.Fog(kit.HORIZON.clone(), 7000, 80000), near: 0.05, far: 250000, exposure: 1.05 });
      root.add(new THREE.HemisphereLight(0xdcecff, 0x34505e, 1.25));
      const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.copy(kit.SUN_DIR); root.add(sun);
      await ctx.yield();
      progress(0.2, 'Satellite imagery');
      loadTiles(S.area);
      await ctx.yield();
      progress(0.35, S.sim ? 'Simulated ships' : 'Listening for ships');
      S.feed = S.sim ? simFeed(S.area) : liveFeed(S.area.box);
      S.startedAt = Date.now();
      // wait a little for the first reports (the arrival covers this), then board the ship most worth riding
      for (let i = 0; i < 16 && !bestShip(); i++) { await new Promise((r) => setTimeout(r, 250)); progress(0.35 + i * 0.02, 'Listening for ships'); }
      const want = params.mmsi ? +params.mmsi : params.target ? +params.target : null;
      const pick = want && S.store.vessels.get(want) && S.store.vessels.get(want).fix ? want : bestShip();
      // build the first models now, a few at a time (each yield lets a frame through)
      const now = Date.now(); let built = 0;
      for (const v of S.store.vessels.values()) { if (!v.fix || vessels.has(v.mmsi)) continue; addVessel(v, now); if (++built % 3 === 0) { progress(0.7 + Math.min(0.25, built / 40), 'Ships'); await ctx.yield(); } if (built >= 24) break; }
      S.mode = POV_NAMES[params.pov] ? params.pov : 'captain';
      if (pick != null) rideTo(pick, S.mode); else { pushCard(); pushEfb(); }
      ctx.setCredit({ text: 'Imagery © Esri · AIS: aisstream.io', short: 'Esri · AIS' });
      // keep the card and the EFB fed (off the frame loop), drop silent ships
      ctx.setInterval(() => {
        pushCard();
        if (S.ride == null && !S.userPicked && Date.now() - S.startedAt < 90000) { const b = bestShip(); if (b != null && vessels.has(b)) { ctx.blink(() => rideTo(b, 'captain')); } }
      }, 1000);
      ctx.setInterval(pushEfb, 2500);
      ctx.setInterval(() => { for (const mmsi of S.store.prune(Date.now(), LIVE_MAX_AGE_MS)) removeVessel(mmsi); }, 15000);
      progress(1, SHORT_AREA[S.areaId]);
    },

    run(dt, t) {
      if (!kit) return;
      nowMs = Date.now(); frameDt = dt; frameT = t; builtThisFrame = 0;
      kit.uTime.value = t;
      S.store.vessels.forEach(stepVessel);
      seat(dt);
      // the dense wave patch and the sky follow the eye
      rig().updateMatrixWorld(); camera.getWorldPosition(camW);
      const lookAhead = Math.min(kit.PATCH_HALF * 0.5, Math.max(0, camW.y * 0.6));
      camera.getWorldDirection(dir); const hl = Math.hypot(dir.x, dir.z) || 1;
      kit.patch.x = camW.x + dir.x / hl * lookAhead; kit.patch.z = camW.z + dir.z / hl * lookAhead;
      kit.nearWater.position.set(kit.patch.x, 0, kit.patch.z); kit.uPatch.value.set(kit.patch.x, kit.patch.z, kit.PATCH_HALF);
      kit.sky.position.copy(camW);
      if ((labelClock += dt) > 0.5) { labelClock = 0; sortLabels(); }
    },

    targets() { const now = Date.now(), out = []; S.store.vessels.forEach((v) => { if (v.fix) out.push(targetOf(v, now)); }); return out; },

    // rays from the shell (screen taps, VR point + select): ships are targets
    pointer(kind, o, d) {
      if (kind === 'hoverEnd') return false;
      let best = null, bt = Infinity;
      vessels.forEach((s) => {
        if (!s.model.group.visible || s.v.mmsi === S.ride && isEye(S.mode)) return;
        const r = Math.max(8, s.model.length * 0.55);
        hit.set(s.x - o.x, 4 - o.y, s.z - o.z); const tt = hit.dot(d); if (tt <= 0) return;
        const px = o.x + d.x * tt - s.x, py = o.y + d.y * tt - 4, pz = o.z + d.z * tt - s.z;
        if (px * px + py * py + pz * pz < r * r && tt < bt) { bt = tt; best = s; }
      });
      if (kind === 'hover') { if (best !== hovered) { if (hovered) hovered.model.label.scale.multiplyScalar(1 / 1.3); hovered = best; if (best) best.model.label.scale.multiplyScalar(1.3); } return !!best; }
      if (kind === 'select' && best) { ctx.reveal(targetOf(best.v, Date.now())); return true; }
      return false;
    },

    act(cmd) {
      switch (cmd.type) {
        case 'pov': if (POV_NAMES[cmd.id] && cmd.id !== S.mode && S.ride != null) ctx.blink(() => { S.mode = cmd.id; aboardYaw = null; ctx.setLookPitch(S.mode === 'captain' ? CAPTAIN_PITCH : -0.04); pushCard(); pushEfb(); }); break;
        case 'target': { const mmsi = +cmd.id; if (vessels.has(mmsi)) { S.userPicked = true; rideTo(mmsi, 'captain'); } break; }   // hop aboard: you board at the helm
        case 'stop': break;   // ships are reached through their Be There reveal (the shell opens it from the list)
        case 'layer': if (cmd.id === 'ships') { S.shipsOn = !!cmd.on; pushEfb(); } break;
        case 'time': if (cmd.mode === 'hist') ctx.toast('Voyage replays: coming soon'); break;
        case 'quality': S.level = cmd.level; labelClock = 1; break;
        case 'recenter': aboardYaw = null; break;
        case 'xr': aboardYaw = null; break;
      }
    },

    unload() {
      S.alive = false;
      if (S.feed) S.feed.stop(); S.feed = null;
      vessels.forEach((s) => { s.model.group.removeFromParent(); kit.disposeGroup(s.model.group); }); vessels.clear(); order.length = 0;
      if (kit) { kit.tileGroup.traverse((o) => { if (o.isMesh) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); o.geometry.dispose(); } }); kit.dispose(); }
      kit = null; S.store = new C.VesselStore();
    },
  };
  function rig() { return ctx.rig; }
}

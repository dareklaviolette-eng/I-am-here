// I'M HERE world layer "planes": live traffic around the ridden aircraft (aviation's first layer; see shared/world-layers.js).
//
// What it shows: every aircraft that is broadcasting (ADS-B / Mode S via the feeds below), airborne or on the ground
// (gates, taxiways, runways), within ~10 nm of the ownship below ~10,000 ft or near an airport, ~20 nm in cruise, and
// within +/- 5,000 ft. Nothing else: an aircraft that stops broadcasting fades from the picture after 90 s; no ghost or
// filler traffic is ever drawn. True scale (size class from the ICAO type / ADS-B category), nav and strobe lights at
// night, a subtle marker on gaze or point (callsign · altitude · climb/descent arrow), TCAS symbols on the ND.
//
// Data: the free browser feeds first (airplanes.live, adsb.lol, adsb.fi taken in turn, then the I'M HERE relay's point
// route, then OpenSky; 737/live-flights.js SOURCES + SourcePool, which rests a source 2 min after HTTP 429), and the relay's
// Flightradar24 /fr24/area as the last resort on the GitHub site only: at most one call per 60 s (the relay caches 60 s),
// resting 15 min after its daily credit cap (429) or when it is not set up. Refresh every 25 s (and early after ~4 nm
// flown); between refreshes each aircraft moves on from its ground speed, track and vertical rate (dead reckoning).
//
// Quest budget: at most 40 aircraft (nearest first), ONE instanced mesh (~150 triangles each), one Points draw for all the
// lights, no allocations in update().  The pure parts (filters, dead reckoning, TCAS rules) are tested in Node:
// node shared/test/layer-planes-test.mjs
import { SOURCES, SourcePool, getFlightJSON, RELAY, FR24_FRESH_S } from '../737/live-flights.js';
import { parseFlights, ON_SITE } from '../globe/feeds.js';
import { sizeClass, CLASS_LEN_M } from './aircraft-class.js';

export const TRAFFIC = { nearNm: 10, cruiseNm: 20, lowAltFt: 10000, nearAptNm: 12, bandFt: 5000, max: 40, maxAgeS: 60, dropAfterS: 90,
  extrapS: 60, groundExtrapS: 10, refreshMs: 25000, refetchNm: 4, marginNm: 3, proxNm: 6, proxFt: 1200, arrowFpm: 500 };
const FT = 0.3048, KT = 0.514444, D2R = Math.PI / 180, R_EARTH = 6371008.8;
export const mPerDegLat = (lat) => { const p = lat * D2R; return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p); };
export const mPerDegLon = (lat) => { const p = lat * D2R; return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p); };

// ---------------------------------------------------------------------------------------------- pure rules (tested)
// Range around the ownship: ~10 nm on the ground, below ~10,000 ft or within ~12 nm of an airport; ~20 nm in cruise.
export function trafficRangeNm(own) {
  if (!own) return TRAFFIC.nearNm;
  const low = own.onGround || !(own.altFt >= TRAFFIC.lowAltFt) || (own.nearAptNm != null && own.nearAptNm < TRAFFIC.nearAptNm);
  return low ? TRAFFIC.nearNm : TRAFFIC.cruiseNm;
}
export function distNmFlat(la1, lo1, la2, lo2) { return Math.hypot((la2 - la1) * mPerDegLat(la1), (lo2 - lo1) * mPerDegLon(la1)) / 1852; }
const normCs = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
// Altitude used for the band: a ground report counts as the field elevation (the feeds send "ground", not a number).
export const trafficAltFt = (f, own) => (f.onGround ? (own && Number.isFinite(own.fieldFt) ? own.fieldFt : 0) : f.altFt);
// The feed list -> what to show: broadcasting now, not the ownship, inside range and the altitude band; nearest first, capped.
export function filterTraffic(list, own, { rangeNm = trafficRangeNm(own), bandFt = TRAFFIC.bandFt, max = TRAFFIC.max, maxAgeS = TRAFFIC.maxAgeS, now = Date.now() } = {}) {
  const hex = String(own.hex || '').toLowerCase(), cs = normCs(own.callsign), out = [];
  for (const f of list || []) {
    if (!f || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
    if (hex && f.hex === hex) continue;                                    // the ownship itself
    if (cs && cs !== 'DEMO' && normCs(f.flight) === cs) continue;
    if (!f.onGround && !Number.isFinite(f.altFt)) continue;               // no altitude broadcast: cannot be placed
    if (Number.isFinite(f.fixAt) && now - f.fixAt > maxAgeS * 1000) continue;   // not broadcasting any more
    const alt = trafficAltFt(f, own); if (Math.abs(alt - own.altFt) > bandFt) continue;
    const d = distNmFlat(own.lat, own.lon, f.lat, f.lon); if (d > rangeNm) continue;
    out.push({ ...f, distNm: d });
  }
  out.sort((a, b) => a.distNm - b.distNm);
  if (out.length > max) out.length = max;
  return out;
}
// Dead reckoning from the last report: ground speed along track, vertical rate; at most extrapS seconds (10 s on the
// ground: taxiing aircraft turn). Writes into out { lat, lon, altFt, t }; no allocations.
export function deadReckon(f, now, out, own) {
  const lim = f.onGround ? TRAFFIC.groundExtrapS : TRAFFIC.extrapS;
  const t = Math.max(0, Math.min(lim, (now - f.fixAt) / 1000));
  out.t = t; out.lat = f.lat; out.lon = f.lon; out.altFt = trafficAltFt(f, own);
  if (Number.isFinite(f.gs) && Number.isFinite(f.track) && f.gs > 0) {
    const d = f.gs * KT * t, tr = f.track * D2R;
    out.lat += d * Math.cos(tr) / mPerDegLat(f.lat); out.lon += d * Math.sin(tr) / mPerDegLon(f.lat);
  }
  if (!f.onGround && Number.isFinite(f.vr)) out.altFt += f.vr * t / 60;
  return out;
}
// TCAS display rules: proximate (filled diamond) within 6 nm and +/-1,200 ft, other traffic hollow; relative altitude in
// hundreds of feet with a sign ("+05", "−12", "00"); a climb/descend arrow at 500 fpm or more. Writes into out.
export function tcasSymbol(relAltFt, distNm, vr, out = {}) {
  out.proximate = distNm <= TRAFFIC.proxNm && Math.abs(relAltFt) <= TRAFFIC.proxFt;
  const h = Math.max(-99, Math.min(99, Math.round(relAltFt / 100)));
  out.text = h === 0 ? '00' : (h > 0 ? '+' : '−') + String(Math.abs(h)).padStart(2, '0');
  out.above = h >= 0;
  out.arrow = vr >= TRAFFIC.arrowFpm ? 1 : vr <= -TRAFFIC.arrowFpm ? -1 : 0;
  return out;
}
// ND range when the ND has no range of its own: 10 nm near the ground / approach, 20 climbing or descending, 40 in cruise.
export function ndRangeNm(phase, altFt) {
  const p = String(phase || '').toUpperCase();
  if (/TAXI|ROLLOUT|FLARE|APPROACH|GROUND|LANDING|TAKEOFF/.test(p)) return 10;
  if (/CRUISE/.test(p)) return altFt != null && altFt < 10000 ? 20 : 40;
  return 20;
}
// Marker words: "SWA1234 · 12,400 ft · ↑", "N172TS · FL350", "AAL55 · GND".
export function markerText(f, altFt) {
  const id = String(f.flight || f.reg || (f.hex || '').toUpperCase()).trim();
  const alt = f.onGround ? 'GND' : altFt >= 18000 ? 'FL' + String(Math.round(altFt / 100)).padStart(3, '0') : (Math.round(altFt / 100) * 100).toLocaleString('en-US') + ' ft';
  const arr = f.onGround ? '' : f.vr >= TRAFFIC.arrowFpm ? '↑' : f.vr <= -TRAFFIC.arrowFpm ? '↓' : '';
  return [id, alt, arr].filter(Boolean).join(' · ');
}

// Draw the TCAS picture on an ND canvas. The context must already be translated to the ownship symbol (ND centre).
// targets: the layer's slots ({ active, onGround, relE, relN (m), relAlt (ft), vr, distNm }). opts: { R: px for rangeNm,
// rangeNm, trackDeg, color, maxBelow: px drawn behind the ownship }. Ground traffic is not drawn (TCAS does not show it).
const _sym = {};
export function drawTCAS(x, targets, { R, rangeNm, trackDeg = 0, color = '#ffffff', maxBelow = 80, font = '"Arial Narrow", Arial, sans-serif' } = {}) {
  let n = 0;
  x.save(); x.lineWidth = 2; x.strokeStyle = color; x.fillStyle = color; x.font = `17px ${font}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]; if (!s.active || s.onGround) continue;
    const dpx = s.distNm / rangeNm * R; if (dpx > R * 1.02) continue;
    const rb = Math.atan2(s.relE, s.relN) - trackDeg * D2R, px = Math.sin(rb) * dpx, py = -Math.cos(rb) * dpx;
    if (py > maxBelow) continue;
    tcasSymbol(s.relAlt, s.distNm, s.vr, _sym);
    x.beginPath(); x.moveTo(px, py - 9); x.lineTo(px + 7, py); x.lineTo(px, py + 9); x.lineTo(px - 7, py); x.closePath();
    if (_sym.proximate) x.fill(); else x.stroke();
    x.fillText(_sym.text, px, _sym.above ? py - 20 : py + 20);
    if (_sym.arrow) {   // vertical arrow right of the symbol
      const ax = px + 15, t0 = py - 9, t1 = py + 9, tip = _sym.arrow > 0 ? t0 : t1, back = _sym.arrow > 0 ? 1 : -1;
      x.beginPath(); x.moveTo(ax, t0); x.lineTo(ax, t1); x.moveTo(ax - 4, tip + back * 5); x.lineTo(ax, tip); x.lineTo(ax + 4, tip + back * 5); x.stroke();
    }
    n++;
  }
  x.restore(); return n;
}

// ---------------------------------------------------------------------------------------------- data
// One fetcher per page. -> { source, flights, at, fr24 }  (throws { status } when no source answered)
export function createTrafficFetcher({ fetchFn = (u, o) => fetch(u, o), onSite = ON_SITE, sources = SOURCES } = {}) {
  const pool = new SourcePool(sources), st = { fr24Next: 0 };
  // ADS-B emitter category (A1 light ... A7 rotorcraft) is in the v2 rows but not kept by the shared parsers
  const withCategory = (j, flights) => { const cat = new Map(); for (const a of (j && (j.ac || j.aircraft)) || []) if (a && a.hex && a.category) cat.set(String(a.hex).toLowerCase().replace(/^~/, ''), a.category);
    if (cat.size) for (const f of flights) f.category = cat.get(f.hex) || ''; return flights; };
  async function fetchNear(lat, lon, nm, signal) {
    const f2 = (u, o) => fetchFn(u, { ...(o || {}), signal: signal && o && o.signal && typeof AbortSignal !== 'undefined' && AbortSignal.any ? AbortSignal.any([o.signal, signal]) : (signal || (o && o.signal)) });
    const errs = []; let all429 = true;
    for (const s of pool.order()) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      try {
        const j = await getFlightJSON(s.point(lat, lon, nm), f2, 6000), t = Date.now(); pool.ok(s.name);
        return { source: s.name, flights: withCategory(j, parseFlights(j, t)), at: t };
      } catch (e) {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        pool.fail(s.name, e.status); if (e.status !== 429) all429 = false; errs.push(s.name + ': ' + e.message);
      }
    }
    // last resort: Flightradar24 light positions through the relay (paid credits; GitHub site only)
    if (onSite && Date.now() >= st.fr24Next) {
      const dLa = nm / 60, dLo = nm / (60 * Math.max(0.2, Math.cos(lat * D2R))), f = (v) => (+v).toFixed(3);
      try {
        const j = await getFlightJSON(`${RELAY}/fr24/area?bounds=${f(lat + dLa)},${f(lat - dLa)},${f(lon - dLo)},${f(lon + dLo)}&limit=100`, f2, 8000), t = Date.now();
        st.fr24Next = t + 60000;   // one call per relay cache period at most
        return { source: 'Flightradar24', fr24: true, flights: parseFlights(j, t).map((x) => ({ ...x, freshS: FR24_FRESH_S })), at: t };
      } catch (e) {
        if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        st.fr24Next = Date.now() + (e.status === 429 || e.status === 503 || e.status === 404 ? 900000 : 60000);
        if (e.status !== 429) all429 = false; errs.push('Flightradar24: ' + e.message);
      }
    }
    throw Object.assign(new Error('No traffic source reachable (' + errs.join('; ') + ')'), { status: all429 && errs.length ? 429 : 0 });
  }
  return { fetchNear, pool, state: st };
}

// ---------------------------------------------------------------------------------------------- the layer (three.js)
// A simple low-poly airliner, metres, nose +z, y up, origin on the ground under the fuselage; ~150 triangles.
export function buildLowPolyAirliner(THREE) {
  const parts = [];
  const add = (g, rx, ry, rz, x, y, z) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
  add(new THREE.CylinderGeometry(1.9, 1.9, 27, 8, 1, true), Math.PI / 2, 0, 0, 0, 3.0, 0.5);          // fuselage
  add(new THREE.ConeGeometry(1.9, 5, 8, 1, true), Math.PI / 2, 0, 0, 0, 3.0, 16.5);                   // nose (+z)
  add(new THREE.ConeGeometry(1.9, 7, 8, 1, true), -Math.PI / 2, 0, 0, 0, 3.3, -16.5);                 // tail cone
  for (const sd of [1, -1]) {
    const w = new THREE.BoxGeometry(17, 0.35, 4.6); w.translate(sd * 8.5, 0, 0);
    add(w, 0, sd * 0.5, sd * 0.06, sd * 1.6, 2.0, 2.0);                                                  // swept wing, dihedral
    add(new THREE.CylinderGeometry(0.95, 0.85, 4.2, 6, 1, false), Math.PI / 2, 0, 0, sd * 5.2, 1.3, 4.2); // engine
    const h = new THREE.BoxGeometry(6.2, 0.22, 2.4); h.translate(sd * 3.1, 0, 0);
    add(h, 0, sd * 0.55, 0, sd * 0.6, 3.8, -16.5);                                                       // stabiliser
  }
  add(new THREE.BoxGeometry(0.3, 6.4, 4.2), -0.45, 0, 0, 0, 7.0, -16.8);                               // fin
  let n = 0; for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3); let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array, o); o += p.attributes.position.array.length; p.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
const MODEL_LEN = 40.5;   // the model above, nose to tail (m)
// Light positions on the model (m): left wing tip red, right green, tail white, beacon red, strobes white at the tips.
const LIGHTS = [[16.6, 3.0, -6.4, 1, 0.08, 0.06], [-16.6, 3.0, -6.4, 0.1, 1, 0.25], [0, 3.3, -20.2, 1, 1, 1], [0, 5.0, 0.5, 1, 0.1, 0.05], [16.6, 3.0, -6.6, 1, 1, 1], [-16.6, 3.0, -6.6, 1, 1, 1]];

export function createPlanesLayer({ THREE, fetcher = createTrafficFetcher(), max = TRAFFIC.max, now = () => Date.now() } = {}) {
  const group = new THREE.Group(); group.name = 'layer-planes'; group.visible = false;
  const geo = buildLowPolyAirliner(THREE);
  const mat = new THREE.MeshLambertMaterial({ color: 0xdfe4e8 });
  const mesh = new THREE.InstancedMesh(geo, mat, max); mesh.count = 0; mesh.frustumCulled = false; mesh.name = 'traffic'; group.add(mesh);
  // lights: one Points draw, round dots of fixed pixel size (visible far away, like real lights)
  const NL = LIGHTS.length, lpos = new Float32Array(max * NL * 3), lcol = new Float32Array(max * NL * 3);
  const lgeo = new THREE.BufferGeometry(); lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3).setUsage(THREE.DynamicDrawUsage));
  lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3).setUsage(THREE.DynamicDrawUsage)); lgeo.setDrawRange(0, 0);
  const dot = (() => { if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); return t; })();
  const lmat = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, map: dot, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
  const lights = new THREE.Points(lgeo, lmat); lights.frustumCulled = false; lights.name = 'traffic-lights'; lights.renderOrder = 5; group.add(lights);

  // fixed slots: slot i = instance i; pickables reuse the same objects every frame
  const slots = [];
  for (let i = 0; i < max; i++) {
    const s = { i, active: false, hex: '', flight: '', reg: '', type: '', category: '', onGround: false, lat: 0, lon: 0, altFt: 0, gs: null, track: null, vr: 0, fixAt: 0,
      scale: 1, lx: 0, ly: 0, lz: 0, ex: 0, ey: 0, ez: 0, has: false, relE: 0, relN: 0, relAlt: 0, distNm: 0, curAlt: 0, phase: Math.random() };
    s.pick = { active: false, x: 0, y: 0, z: 0, r: 20, slot: s, text: () => markerText(s, s.curAlt), key: () => s.hex };
    slots.push(s);
  }
  const picks = slots.map((s) => s.pick);
  const byHex = new Map();
  let src = '', lastOk = 0, count = 0, failing = false, maxNow = max, range = TRAFFIC.nearNm, lastErr = '', visible = false;
  const dr = { lat: 0, lon: 0, altFt: 0, t: 0 }, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'),
    pv = new THREE.Vector3(), sv = new THREE.Vector3(), lv = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);

  function localOf(own, lat, lon, altFt, out) {   // metres relative to the ownship in the page's world frame (x = west, z = north)
    const east = (lon - own.lon) * mPerDegLon(own.lat), north = (lat - own.lat) * mPerDegLat(own.lat), d2 = east * east + north * north;
    out.x = -east; out.z = north; out.y = own.gy + (altFt - own.fieldFt) * FT - d2 / (2 * R_EARTH);   // earth curvature drop
    return out;
  }
  const layer = {
    id: 'planes', label: 'Planes', group, slots,
    refreshMs: TRAFFIC.refreshMs, refetchNm: TRAFFIC.refetchNm,
    fetchNear(lat, lon, altFt, signal, own) { range = trafficRangeNm(own); return fetcher.fetchNear(lat, lon, range + TRAFFIC.marginNm, signal); },
    setData(data, t, own) {
      failing = false; lastErr = ''; src = data.source; lastOk = t;
      const list = filterTraffic(data.flights, own, { rangeNm: trafficRangeNm(own), max: maxNow, now: t });
      const keep = new Set(list.map((f) => f.hex));
      for (const s of slots) if (s.active && !keep.has(s.hex)) { s.active = false; s.pick.active = false; byHex.delete(s.hex); }   // stopped broadcasting / left range
      for (const f of list) {
        let s = byHex.get(f.hex);
        if (!s) { s = slots.find((x) => !x.active); if (!s) break; s.active = true; s.has = false; s.hex = f.hex; byHex.set(f.hex, s); }
        else if (f.fixAt < s.fixAt) continue;   // an older report than the one held
        const old = s.has ? { x: s.lx, y: s.ly, z: s.lz } : null;
        s.flight = f.flight; s.reg = f.reg; s.type = f.type || s.type; s.category = f.category || s.category; s.onGround = f.onGround; s.lat = f.lat; s.lon = f.lon;
        s.altFt = f.altFt; s.gs = f.gs; s.track = f.track ?? s.track; s.vr = f.vr || 0; s.fixAt = f.fixAt;
        s.scale = CLASS_LEN_M[sizeClass(s.type, s.category)] / MODEL_LEN;
        if (old) {   // glide from where it was drawn to the new report over ~1.5 s (no jump)
          deadReckon(s, t, dr, own); localOf(own, dr.lat, dr.lon, dr.altFt, lv);
          s.ex = old.x - lv.x; s.ey = old.y - lv.y; s.ez = old.z - lv.z;
          if (s.ex * s.ex + s.ez * s.ez > 4e6) s.ex = s.ey = s.ez = 0;   // > 2 km apart: just place it
        } else s.ex = s.ey = s.ez = 0;
      }
    },
    onError(err) { failing = true; lastErr = String((err && err.message) || err); },
    setVisible(on) { visible = on; group.visible = on; if (!on) for (const p of picks) p.active = false; },
    setMax(n) { maxNow = Math.max(1, Math.min(max, n | 0)); },
    // every frame (no allocations)
    update(parent, own, dt, t) {
      if (group.parent !== parent) parent.add(group);
      let top = 0; count = 0;
      const k = Math.exp(-dt / 0.5), night = !!own.night, flash = t / 1000;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.active && t - s.fixAt > TRAFFIC.dropAfterS * 1000) { s.active = false; byHex.delete(s.hex); }   // not broadcasting any more
        if (!s.active || i >= maxNow) { s.pick.active = false; mesh.setMatrixAt(i, zero); for (let j = 0; j < NL; j++) { const b = (i * NL + j) * 3; lcol[b] = lcol[b + 1] = lcol[b + 2] = 0; } continue; }
        deadReckon(s, t, dr, own); localOf(own, dr.lat, dr.lon, dr.altFt, lv);
        s.ex *= k; s.ey *= k; s.ez *= k;
        s.lx = lv.x + s.ex; s.ly = lv.y + s.ey; s.lz = lv.z + s.ez; s.has = true; s.curAlt = dr.altFt;
        s.relE = -s.lx; s.relN = s.lz; s.relAlt = dr.altFt - own.altFt; s.distNm = Math.hypot(s.lx, s.lz) / 1852;
        const fpa = s.onGround || !s.gs ? 0 : Math.atan2(s.vr * FT / 60, s.gs * KT);
        e.set(-fpa, -(s.track || 0) * D2R, 0); q.setFromEuler(e); pv.set(s.lx, s.ly, s.lz); sv.setScalar(s.scale);
        m4.compose(pv, q, sv); mesh.setMatrixAt(i, m4);
        for (let j = 0; j < NL; j++) {
          const L = LIGHTS[j], b = (i * NL + j) * 3;
          lv.set(L[0], L[1], L[2]).applyMatrix4(m4); lpos[b] = lv.x; lpos[b + 1] = lv.y; lpos[b + 2] = lv.z;
          let on = night ? 1 : 0;
          if (j === 3) on *= ((flash + s.phase) % 1.0) < 0.12 ? 1 : 0;                         // red beacon, ~1 per second
          if (j >= 4) { const ph = (flash + s.phase * 1.3) % 1.3; on *= ph < 0.05 || (ph > 0.12 && ph < 0.17) ? 1 : 0; }   // double white strobe
          lcol[b] = L[3] * on; lcol[b + 1] = L[4] * on; lcol[b + 2] = L[5] * on;
        }
        // where it is in the world (the parent's matrix from the last frame: one frame late is fine for pointing)
        lv.set(s.lx, s.ly + 3 * s.scale, s.lz).applyMatrix4(parent.matrixWorld);
        s.pick.x = lv.x; s.pick.y = lv.y; s.pick.z = lv.z; s.pick.r = 22 * s.scale; s.pick.active = visible;
        top = i + 1; count++;
      }
      mesh.count = top; mesh.instanceMatrix.needsUpdate = true;
      lgeo.setDrawRange(0, night ? top * NL : 0); lgeo.attributes.position.needsUpdate = true; lgeo.attributes.color.needsUpdate = true;
    },
    pickables: () => picks,
    count: () => count,
    healthy: (t = now()) => !!lastOk && t - lastOk < 90000,
    source: () => src,
    status(t = now()) {
      if (!lastOk) return failing ? 'no data · retrying' : 'loading…';
      const age = (t - lastOk) / 1000;
      return (count ? count + ' nearby' : 'none broadcasting nearby') + ' · ' + src + (failing || age > 90 ? ' · not updating' : '');
    },
    // the card's Details row (honest labels)
    markItem(t = now(), demo = false) {
      if (!lastOk && !failing) return null;
      const fresh = lastOk && t - lastOk < 60000;
      return { kind: fresh ? 'live' : 'recorded', label: `Traffic: ${count} aircraft within ${range} nm, ±5,000 ft`,
        source: !lastOk ? 'Live ADS-B not reachable right now' : (src === 'Flightradar24' ? 'Flightradar24 live data via the I\'M HERE relay' : 'Live ADS-B via ' + src), time: lastOk || undefined, timeLabel: 'Last update',
        note: (demo ? 'Real aircraft around the demo flight\'s position. ' : '') + 'Only aircraft that are broadcasting are shown (airborne and on the ground). Refreshed about every 25 s; in between each moves on from its ground speed, track and vertical rate. Sizes follow the aircraft type where the feed gives it; the shape is a generic airliner.' + (failing ? '\nFeed not answering: ' + lastErr.slice(0, 160) : '') };
    },
    dispose() { geo.dispose(); mat.dispose(); lgeo.dispose(); lmat.dispose(); if (dot) dot.dispose(); mesh.dispose(); if (group.parent) group.parent.remove(group); },
  };
  return layer;
}

// Aurora tours station: the XR Aurora (Aurora-class lead ship IH-0000) flying the Travel Desk tours (travel/<tour>/tour.js)
// inside the shell. Ported from aurora/index.html (which keeps working on its own): the same world adapter, the same
// rendered fallback outside (sky + the tour's terrain), the same grades, and Google 3D tiles from the shell's one instance.
//   params: tour (yosemite | swiss-alps | new-zealand; default DEFAULT_TOUR), stop (index), pov
// Blocks: Ride (the Aurora), Stops (the tour stops), Targets (the stops and the other tours), Time (rendered), POV (six seats).
import { createAurora, POVS } from '../../shared/aurora/aurora.js';
import { createBackdrop } from '../../shared/aurora/backdrop.js';
import { createYosemiteWorld, AXIS, DOMES, toLocal as yToLocal } from '../../aurora/yosemite-world.js';
import { worldFromTour, basisInto } from '../../aurora/tour-world.js';
import { createNightSky } from '../../travel/shared/night-sky.js';
import meta, { TOURS, DEFAULT_TOUR } from './meta.js';

const TOUR_IDS = TOURS.map((t) => t.id);

export function createStation(ctx) {
  const { THREE, root, camera, renderer } = ctx;
  let A = null, world = null, worldFrom = '', TOUR = DEFAULT_TOUR, YOS = false, PARK = null, METRIC = false, CURVED = false;
  let backdrop = null, nightSky = null, landWords = 'Rendered valley', scenery = null, tilesOn = false, credits = '', attached = false, povLabel = 'Observation deck';
  let sceneryClock = 0, sceneryT = 0, cardClock = 0, tintClock = 0, tintHex = 0xffffff, gradeSig = '', haze = 0, alive = true;
  const G = { gold: 0, night: 0 };
  // per-frame temporaries (no allocations in run)
  const camW = new THREE.Vector3(), qSky = new THREE.Quaternion(), mSky = new THREE.Matrix4(), Bsky = { w: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1] };
  const C_DAY = new THREE.Color(0xc7dbed), C_GOLD = new THREE.Color(0xe8c39a), C_NIGHT = new THREE.Color(0x0a1121), T_GOLD = new THREE.Color(0xffd9ae), T_NIGHT = new THREE.Color(0x3a4766), tint = new THREE.Color();
  let fog = null, time = 0;

  async function loadWorld(id) {
    try {
      const m = await import(`../../travel/${id}/tour.js`);
      const w = m.world || m.default || (m.createWorld && m.createWorld()) || worldFromTour(m, { name: (m.PARK && m.PARK.short) || 'Yosemite' });
      if (w && Array.isArray(w.stops) && w.stops.length && typeof w.update === 'function' && w.origin) return { w, from: `travel/${id}/tour.js` };
    } catch (e) { console.warn('[aurora station] tour ' + id + ' did not load:', e && e.message || e); }
    return null;
  }
  const stopName = () => world.stops[world.index || 0].name;
  function cardData() {
    const s = world.stops[world.index || 0];
    const notes = ['The craft and its interior are rendered. Outside: Google Photorealistic 3D Tiles where they load; ' + (YOS ? 'a rendered valley' : 'rendered terrain') + ' until then.'].concat(A ? A.credits : []);
    return { live: false, thumb: { icon: { d: 'M2 12c3-3 9-4 15-4 3 0 5 1 5 4s-2 4-5 4c-6 0-12-1-15-4zm6-1h7', w: 24, h: 24 }, label: 'XR Aurora' }, type: 'Aurora-class craft', reg: 'IH-0000',
      loc: s.loc || (PARK && PARK.name) || 'Yosemite Valley, CA', org: "I'M HERE", id: { label: 'CRAFT', value: 'XR Aurora' }, rte: world.name + ' · ' + s.name, route: '→ ' + s.name,
      pov: povLabel, sig: { source: tilesOn ? 'Google 3D' : landWords, tag: 'RENDERED' }, time: Date.now(),
      details: { rows: [['Craft', 'XR Aurora (Aurora-class lead ship)'], ['World', world.name + ' (' + worldFrom + ')'], ['Scenery', tilesOn ? 'Google Photorealistic 3D Tiles' : YOS ? 'Rendered stand-in valley' : "Rendered approximation of the terrain (I'M HERE)"]], notes } };
  }
  function pushEfb() {
    ctx.setEfb({ povs: POVS, pov: A ? A.pov : 'deck', listTitle: world.name + ' · stops', list: world.stops.map((s, i) => ({ id: String(i), name: s.name, sub: s.loc || '', sel: i === (world.index || 0) })),
      layers: [['planes', 'Planes', false, true], ['ships', 'Ships', false, true], ['wildlife', 'Wildlife', false, true], ['iss', 'ISS', false, true]],
      time: [['rendered', 'REND', true, false], ['hist', 'HIST', false, true]], data: [['STOP', stopName()], ['CRAFT', 'XR Aurora']] });
  }
  function goStop(i) {
    if (world.go) world.go(i); else if (i > (world.index || 0)) world.next(); else world.prev();
    ctx.setCard(cardData()); pushEfb();
  }
  function hero() { return meta.hero(THREE, null, renderer); }

  return {
    describe: () => ({ id: 'aurora', name: meta.name, blocks: meta.blocks, povs: POVS, link: '#station=aurora&tour=' + TOUR }),

    async load(params, progress) {
      TOUR = TOUR_IDS.includes(params.tour) ? params.tour : DEFAULT_TOUR;
      progress(0.05, 'Setting course');
      let loaded = await loadWorld(TOUR);
      if (!loaded && TOUR !== 'yosemite') { TOUR = 'yosemite'; loaded = await loadWorld(TOUR); }
      if (!loaded) loaded = { w: createYosemiteWorld(), from: 'aurora/yosemite-world.js' };
      world = loaded.w; worldFrom = loaded.from;
      const toLocal = world.toLocal || yToLocal;
      YOS = TOUR === 'yosemite'; PARK = world.park || null; METRIC = !!PARK && PARK.units === 'metric'; CURVED = !!world.curved;
      ctx.setTitle('XR Aurora · ' + ((PARK && PARK.short) || world.name));
      await ctx.yield(); progress(0.25, 'The land below');
      // the rendered outside (always the sky; land until real scenery is near)
      if (YOS) {
        const s0 = toLocal(world.stops[0].lat, world.stops[0].lon, 1200);
        const clear = world.stops.map((s) => { const p = toLocal(s.lat, s.lon, s.alt); return [p[0], p[2], p[1] - 140, 700]; });
        backdrop = createBackdrop({ axis: AXIS, domes: DOMES, clear, floorY: 1188, rimY: 2240, centre: [s0[0], s0[2]] });
        ctx.setEnv({ far: 120000 });
      } else {
        let land = null;
        try { const tm = await import(`../../travel/${TOUR}/terrain.js`), N = (PARK && PARK.terrainN) || [300, 240]; land = tm.buildTerrain(THREE, { n: /Quest|OculusBrowser/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches ? N[1] : N[0] }); }
        catch (e) { console.warn('[aurora station] rendered terrain did not build:', e && e.message || e); land = new THREE.Group(); }
        land.name = 'tour-fallback-terrain';
        backdrop = createBackdrop({ terrainMesh: land, sunDir: (PARK && PARK.sun) || undefined });
        landWords = 'Rendered terrain';
        fog = new THREE.FogExp2(0xc7dbed, 1.4e-5);
        ctx.setEnv({ fog, far: 200000 });
        if (world.stops.some((s) => s.src && s.src.night)) { nightSky = createNightSky(THREE, (PARK && PARK.nightSky) || {}); nightSky.group.scale.setScalar(0.25); root.add(nightSky.group);
          nightSky.group.traverse((o) => { if (o.renderOrder) o.renderOrder = o.renderOrder + 880; }); }
      }
      root.add(backdrop.group);
      await ctx.yield(); progress(0.5, 'Boarding the XR Aurora');
      // the craft: built now, in the background; it takes the shell's camera rig when the world is shown (run)
      A = createAurora();
      A.mount({ scene: root, camera, renderer, deferRig: true, xrSelect: false,
        onToast: (t) => { if (!ctx.isXR()) ctx.toast(t); },
        onPOV: (id, label) => { povLabel = label; if (world) { ctx.setCard(cardData()); pushEfb(); } },
        destinations: TOURS.map((t) => (t.id === TOUR ? { id: t.id, text: t.name, sub: "You're here", sel: true } : { id: t.id, text: t.name, sub: 'Fly there' })).concat([{ id: 'glacier-bay', text: 'Glacier Bay, AK', sub: 'Coming soon', dis: true }]),
        onDestination: (id) => { if (TOUR_IDS.includes(id) && id !== TOUR) { ctx.jump('aurora', { tour: id }); return true; } return false; },
      });
      if (METRIC) A.setScreens({ metric: true });
      A.loadWorld(world);
      const st = params.stop != null ? +params.stop : NaN;
      if (st >= 0 && st < world.stops.length && st !== (world.index || 0)) { world.go(st); world.update(1000); }   // arrive at that stop
      if (params.pov && POVS.some((p) => p[0] === params.pov)) A.setPOV(params.pov, { instant: true });
      povLabel = (POVS.find((p) => p[0] === A.pov) || POVS[0])[1];
      ctx.ownsCamera(true);   // the craft seats you (its POVs); on screens it handles drag-to-look itself
      ctx.setCard(cardData()); pushEfb();
      // real scenery: the shell's one Google 3D tiles instance, moved here (null when unavailable: the rendered land stays)
      ctx.wantScenery({ lat: world.origin.lat, lon: world.origin.lon, elevFt: 0 }).then((h) => { if (!alive) return; scenery = h; if (!h) landWords = landWords + ' (Google 3D scenery unavailable)'; });
      if (/github\.io$/i.test(location.hostname) && world.tour && world.tour.fetchWeather) world.tour.fetchWeather().then((l) => { if (alive && l && l[world.index || 0]) { const w = l[world.index || 0]; A.setScreens({ wx: w.text + ' · Open-Meteo', temp: METRIC ? w.tempC + '°C' : w.tempF + '°F' }); } }).catch(() => {});
      progress(1, 'Ready');
    },

    run(dt) {
      if (!A) return;
      if (!attached) { attached = true; A.attachRig(ctx.rig); }
      time += dt;
      A.update(dt);
      // outside: the sky (and stars) on the eye, in the local horizon on curved tours; haze; rendered golden-hour / night grades
      camera.getWorldPosition(camW);
      if (YOS) backdrop.update(camera);
      else {
        if (CURVED && world.tour && world.tour.FRAME) {
          basisInto(world.tour.FRAME, camW.x, camW.y, camW.z, Bsky);
          mSky.set(Bsky.w[0], Bsky.u[0], Bsky.n[0], 0, Bsky.w[1], Bsky.u[1], Bsky.n[1], 0, Bsky.w[2], Bsky.u[2], Bsky.n[2], 0, 0, 0, 0, 1); qSky.setFromRotationMatrix(mSky);
          backdrop.update(camera, qSky);
        } else backdrop.update(camera);
        const s = world.stops[world.index || 0], src = s.src || {}, k = 1 - Math.exp(-dt / 3);
        G.gold += ((src.golden ? 1 : 0) - G.gold) * k; G.night += ((src.night ? 1 : 0) - G.night) * k; haze += ((src.haze || 0.1) - haze) * k;
        backdrop.setGrade(G.gold, G.night);
        if (nightSky) { nightSky.group.position.copy(camW); if (CURVED) nightSky.group.quaternion.copy(qSky); nightSky.set(G.night, time); }
        const alt = Math.max(0, s.alt - ((PARK && PARK.hazeTopM) || 2500));
        if (fog) { fog.density = Math.max(1.4e-5, (1e-5 + haze * haze * 6e-4) / (1 + alt / 4000)); fog.color.copy(C_DAY).lerp(C_GOLD, G.gold).lerp(C_NIGHT, G.night); }
        tint.setRGB(1, 1, 1).lerp(T_GOLD, G.gold).lerp(T_NIGHT, G.night);
        if (backdrop.terrain.material) backdrop.terrain.material.color.copy(tint);
        if ((tintClock += dt) > 0.5) {
          tintClock = 0; const h = tint.getHex();
          if (scenery && h !== tintHex) { tintHex = h; try { scenery.setTint(h); } catch (e) { /* ignore */ } }
          const sig = (G.gold > 0.05 ? 'g' : '') + (G.night > 0.05 ? 'n' : ''); if (sig !== gradeSig) { gradeSig = sig; ctx.setCard(cardData()); }
        }
      }
      // real scenery near? then the rendered land steps aside (checked twice a second)
      if (scenery && (sceneryClock += dt) > 0.5) {
        sceneryClock = 0; sceneryT += 0.5;
        const st = scenery.stats(), near = st.near > 0 || st.visible > 30;
        if (near !== tilesOn) { tilesOn = near; backdrop.setTerrain(!near); ctx.setCard(cardData()); }
        const c = scenery.credits(); if (c !== credits) { credits = c; ctx.setCredit(tilesOn ? { text: c ? 'Google · ' + c : 'Google', short: 'Google' } : null); }
        if (!st.visible && sceneryT > 25) { scenery = null; backdrop.setTerrain(true); }
      }
      if ((cardClock += dt) > 1) { cardClock = 0; ctx.setCard(cardData()); }
    },

    targets() {
      const here = world.index || 0;
      return world.stops.map((s, i) => ({ id: 'stop:' + i, name: s.name, line: (s.loc || world.name) + ' · stop ' + (i + 1), tag: 'RENDERED', station: 'aurora', here: i === here, hero }))
        .concat(TOURS.filter((t) => t.id !== TOUR).map((t) => ({ id: 'tour:' + t.id, name: t.name, line: t.sub, tag: 'RENDERED', station: 'aurora', params: { tour: t.id }, hero })));
    },

    // VR: point + select on the craft's own controls (ring menu, steps, destinations). Screens: the craft handles taps itself.
    pointer(kind, o, d) {
      if (!A || !ctx.isXR()) return false;
      if (kind === 'select') return A.select(o, d);
      return false;
    },

    act(cmd) {
      if (!A) return;
      switch (cmd.type) {
        case 'pov': A.setPOV(cmd.id); break;   // the craft's own blink
        case 'stop': goStop(+cmd.id); break;
        case 'target': if (String(cmd.id).startsWith('stop:')) goStop(+String(cmd.id).slice(5)); break;
        case 'quality': A.setQuality(cmd.level); break;
        case 'time': if (cmd.mode === 'hist') ctx.toast('Time travel · coming soon'); break;
      }
    },

    unload() {
      alive = false;
      if (A) A.unmount(); A = null;
      if (nightSky && nightSky.dispose) nightSky.dispose();
      world = null; scenery = null; backdrop = null; nightSky = null;
    },
  };
}

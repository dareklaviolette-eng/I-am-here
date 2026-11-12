// Headless test of the plane-traffic layer on the 737 page, with MOCKED traffic around the (demo) ownship. No network.
// node 737/test/traffic-browser.mjs [repoRoot]      Screenshots: /home/claude/out/shots/traffic-*.png
// Checks: aircraft render (instanced, true scale), out-of-band / ownship filtered, marker on hover, TCAS on the ND (737 and
// Airbus), Layers chip hides and shows planes, night lights, chase view, no frame errors.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { start, sleep, FETCH_MOCK } from './harness.mjs';
const ROOT = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = '/home/claude/out/shots/';
let fails = 0; const ok = (c, m, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info ? '  ' + info : '')); if (!c) fails++; };

// Mock ADS-B (v2 shape) around whatever point the page asks for, placed relative to the ownship's track and altitude.
// [hex, callsign, type, ahead nm, right nm, relative ft, vr fpm, onGround]
const MOCK = `(() => {
  const T = [['a00001', 'SWA2101', 'B738', 0.38, -0.03, 140, 0, false], ['a00002', 'DAL882', 'A321', 2.2, 0.8, 900, -900, false],
    ['a00003', 'N512KT', 'C172', 3.4, -1.2, -400, 0, false], ['a00004', 'UAL1450', 'B739', 6.5, -3.0, 2600, 1400, false],
    ['a00005', 'FDX1311', 'B763', 4.2, 2.5, 4800, -600, false], ['a00006', 'AAL2380', 'A20N', 0, 0, 0, 0, true],
    ['a0bad1', 'HIGH1', 'B738', 2.0, 0.0, 8000, 0, false], ['a0bad2', 'FAR1', 'B738', 14, 0, 0, 0, false]];
  window.__mockTraffic = { calls: 0, hdg: 18 };
  window.__mockRoutes = [[/airplanes\\.live|adsb\\.lol|adsb\\.fi|opensky/, (u) => {
    window.__mockTraffic.calls++;
    const m = /point\\/(-?[\\d.]+)\\/(-?[\\d.]+)|lat\\/(-?[\\d.]+)\\/lon\\/(-?[\\d.]+)/.exec(u); if (!m) return new Response('', { status: 404 });
    const la = +(m[1] || m[3]), lo = +(m[2] || m[4]), L = window.__737layers, own = L ? L.OWN.altFt : 2000, h = (L && window.__mockTraffic.hdg) * Math.PI / 180;
    const ac = T.map(([hex, cs, t, a, r, dz, vr, gnd]) => {
      let n = a * Math.cos(h) - r * Math.sin(h), e = a * Math.sin(h) + r * Math.cos(h);
      let lat = la + n / 60, lon = lo + e / (60 * Math.cos(la * Math.PI / 180));
      if (gnd) { lat = 36.1300; lon = -86.6735; }   // on a taxiway at BNA (test position)
      return { hex, flight: cs + ' ', t, lat, lon, alt_baro: gnd ? 'ground' : Math.round(own + dz), gs: gnd ? 14 : 140, track: gnd ? 200 : 18, baro_rate: vr, seen_pos: 1, category: t === 'C172' ? 'A1' : 'A3' };
    });
    return { now: Date.now(), ac };
  }]];
})();`;
// TCAS tags drawn on any canvas (the ND): record fillText calls that look like "+05" / "−12" / "00", and TFC labels
const SPY = `(() => { const f = CanvasRenderingContext2D.prototype.fillText; window.__tcas = []; window.__tfc = 0;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) { if (/^([+\\u2212]\\d\\d|00)$/.test(t)) window.__tcas.push([t, performance.now()]); if (/^TFC/.test(t)) window.__tfc = performance.now(); return f.apply(this, arguments); }; })();`;
const recentTags = (H) => H.ev('(() => { const t = performance.now() - 1500; return __tcas.filter((x) => x[1] > t).map((x) => x[0]); })()');

async function run(query, airbus) {
  const H = await start({ root: ROOT });
  await H.preload(FETCH_MOCK + MOCK + SPY);
  await H.open('/737/' + query);
  await H.waitFor('window.__737layers && window.__737 && __737.frames > 5 && document.getElementById("loader").style.display === "none"', 120000, 'page');
  if (airbus) await H.waitFor('document.getElementById("brand").textContent.includes("Airbus")', 60000, 'Airbus cockpit');
  await H.ev("document.getElementById('panel').classList.add('hidden')");
  await H.waitFor('__737layers.PLANES.count() >= 5', 60000, 'traffic in');
  await sleep(1500);
  return H;
}

// ======================================================================= 737
let H = await run('?apt=KBNA', false);
const st = await H.ev(`(() => { const P = __737layers.PLANES, S = P.slots.filter((s) => s.active);
  return { n: P.count(), on: __737layers.LAYERS.isOn('planes'), hex: S.map((s) => s.hex).sort(), meshCount: P.group.children[0].count, vis: P.group.visible,
    scales: Object.fromEntries(S.map((s) => [s.hex, +s.scale.toFixed(2)])), ground: S.filter((s) => s.onGround).map((s) => s.hex), status: P.status() }; })()`);
console.log('   ', JSON.stringify(st));
ok(st.on && st.vis, 'aviation page: Planes layer on by default');
ok(st.hex.join(',') === 'a00001,a00002,a00003,a00004,a00005,a00006', 'the 6 broadcasting aircraft in range and band are drawn (ground one included); +8,000 ft and 14 nm ones are not', st.hex.join(','));
ok(st.meshCount >= 6 && st.meshCount <= 40, 'one instanced mesh, count within the 40 cap', String(st.meshCount));
ok(st.scales.a00003 < 0.3 && st.scales.a00005 > 1.4 && Math.abs(st.scales.a00001 - 0.94) < 0.05, 'true scale by type: C172 small, 767 big, 737 ~38 m');
ok(st.ground.join() === 'a00006', 'ground traffic shown (taxiing at BNA)');
ok(await H.ev('__mockTraffic.calls') <= 2, 'one feed request per refresh (not per frame)', String(await H.ev('__mockTraffic.calls')));
const alloc = await H.ev(`(() => { const P = __737layers.PLANES, m = P.group.children[0]; const a0 = m.instanceMatrix.array; return a0 === m.instanceMatrix.array; })()`);
ok(alloc, 'instance buffer reused');
// in front of the cockpit: the nearest one projects inside the screen
const proj = `(id) => { const L = __737layers, s = L.PLANES.slots.find((x) => x.hex === id); const v = new (L.camera.position.constructor)(s.pick.x, s.pick.y, s.pick.z).project(L.camera);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, front: v.z < 1 }; }`;
const p1 = await H.ev(`(${proj})('a00001')`);
ok(p1.front && p1.x > 0 && p1.x < 1280 && p1.y > 0 && p1.y < 800, 'traffic ahead appears through the windshield', JSON.stringify(p1));
await H.shot(SHOTS + 'traffic-cockpit-day.png');
const gz = await H.ev('__737layers.UI.markers.texts()'); console.log('    gaze markers:', JSON.stringify(gz));
ok(gz.length <= 4, 'at most a few markers at once (gaze / point only)');
// ---- marker on hover (mouse): not shown before, shown after pointing near it
const p0 = await H.ev(`(${proj})('a00001')`);
await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p0.x + 4), y: Math.round(p0.y + 3) }); await sleep(900);
const m0 = await H.ev('__737layers.UI.markers.texts()');
ok(m0.some((t) => /^SWA2101 · [\d,]+ ft$/.test(t)), 'pointing at SWA2101 (level): "SWA2101 · 2,300 ft", no arrow', JSON.stringify(m0));
await H.shot(SHOTS + 'traffic-marker-hover.png');
await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1270, y: 10 }); await sleep(600);
const p2 = await H.ev(`(${proj})('a00002')`);
const before = await H.ev('__737layers.UI.markers.texts()');
ok(!before.some((t) => t.startsWith('DAL882')), 'no marker on DAL882 before pointing at it', JSON.stringify(before));
await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p2.x + 6), y: Math.round(p2.y - 4) }); await sleep(900);
const after = await H.ev('__737layers.UI.markers.texts()');
ok(after.some((t) => /^DAL882 · [\d,]+ ft · ↓$/.test(t)), 'pointing near DAL882 shows "callsign · altitude · ↓"', JSON.stringify(after));
await H.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1270, y: 10 }); await sleep(800);
ok(!(await H.ev('__737layers.UI.markers.texts()')).some((t) => t.startsWith('DAL882')), 'pointing away hides it');
// ---- TCAS on the captain's ND
const tags = await recentTags(H);
console.log('    TCAS tags:', JSON.stringify([...new Set(tags)]));
ok(tags.length >= 4 && tags.some((t) => t.startsWith('+')) && tags.some((t) => t.startsWith('−')), 'TCAS relative-altitude tags drawn on the ND (+ and −)');
ok(await H.ev('performance.now() - __tfc < 1500'), 'ND shows TFC');
await H.ev(`(() => { const d = __737layers.displays.find((x) => x.id === 'cptND'); __737efb.zoom({ screen: d.mesh }); })()`); await sleep(1500);
await H.shot(SHOTS + 'traffic-tcas-nd.png');
await H.ev('__737efb.zoom(null)'); await sleep(500);
// ---- Layers chip: open (screenshot), toggle Planes off and on
await H.ev("document.querySelector('.imh-chip').click()"); await sleep(400);
ok(await H.ev("!document.querySelector('.imh-menu').hidden"), 'Layers chip opens the drop-down');
const rows = await H.ev("[...document.querySelectorAll('.imh-row')].map((b) => b.textContent + (b.disabled ? ' [disabled]' : ''))");
console.log('    menu:', JSON.stringify(rows));
ok(rows.length === 4 && /^PlanesON/.test(rows[0]) && rows.slice(1).every((r) => /soon \[disabled\]$/.test(r)), 'Planes ON; Ships, Wildlife, ISS disabled "soon"');
await H.ev('__737layers.UI.chip.open()'); await sleep(200); await H.shot(SHOTS + 'traffic-layers-menu.png');
await H.ev("__737layers.UI.chip.open()"); await sleep(300);   // the screenshot can take longer than the 4 s auto-close in software GL
const box = await H.ev("(() => { const r = document.querySelector('.imh-row[data-layer=planes]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
for (const type of ['mousePressed', 'mouseReleased']) await H.send('Input.dispatchMouseEvent', { type, x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
await sleep(900);
ok(await H.ev("!__737layers.LAYERS.isOn('planes') && !__737layers.PLANES.group.visible"), 'click Planes: layer off, aircraft hidden');
ok((await recentTags(H)).length === 0, 'TCAS symbols gone from the ND');
ok((await H.ev('__737layers.UI.markers.visibleCount()')) === 0, 'no markers while off');
for (const type of ['mousePressed', 'mouseReleased']) await H.send('Input.dispatchMouseEvent', { type, x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 });
await sleep(400);
if (await H.ev("document.querySelector('.imh-menu').hidden")) console.log('    (menu had closed; reopened)');
ok(await H.ev("__737layers.LAYERS.isOn('planes') && __737layers.PLANES.group.visible"), 'click again: planes back');
await sleep(4800);
ok(await H.ev("document.querySelector('.imh-menu').hidden"), 'drop-down closes by itself after ~4 s without interaction');
await H.ev("document.querySelector('.imh-chip').click()"); await sleep(300);
await H.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 300, button: 'left', clickCount: 1 }); await H.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 300, button: 'left', clickCount: 1 });
await sleep(300); ok(await H.ev("document.querySelector('.imh-menu').hidden"), 'a tap elsewhere closes it');
await H.waitFor('__737layers.PLANES.count() >= 5', 40000, 'traffic back');
// ---- night: nav / strobe lights
await H.ev("document.querySelector('[data-tod=night]').click()"); await sleep(2000);
const lights = await H.ev('__737layers.PLANES.group.children[1].geometry.drawRange.count');
ok(lights >= 30, 'night: nav, beacon and strobe lights drawn (6 per aircraft)', String(lights));
await H.shot(SHOTS + 'traffic-cockpit-night.png');
await H.ev("document.querySelector('[data-tod=day]').click()"); await sleep(500);
ok((await H.ev('__737layers.PLANES.group.children[1].geometry.drawRange.count')) === 0, 'day: no light points');
// ---- chase view
await H.ev("document.querySelector('[data-seat=outside]').click()"); await sleep(2500);
ok(await H.ev('__737layers.PLANES.count() >= 5 && __737layers.PLANES.group.visible'), 'chase view: traffic still drawn');
await H.shot(SHOTS + 'traffic-chase.png');
await H.ev("document.querySelector('[data-seat=captain]').click()");
ok((await H.ev('__737.frameErrors')) === 0, 'no frame errors (737)', String(await H.ev('__737.frameErrors')));
const ex = H.logs.filter((l) => /EXCEPTION/.test(l)); ok(!ex.length, 'no exceptions', ex.join('\n').slice(0, 500));
H.close();

// ======================================================================= Airbus cockpit
H = await run('?apt=KBNA&cockpit=airbus', true);
const t2 = await recentTags(H);
ok(t2.length >= 4, 'Airbus cockpit: TCAS tags on its ND too', JSON.stringify([...new Set(t2)]));
await H.ev(`(() => { const d = __737layers.displays.find((x) => x.id === 'cptND'); __737efb.zoom({ screen: d.mesh }); })()`); await sleep(1500);
await H.shot(SHOTS + 'traffic-tcas-nd-airbus.png');
ok((await H.ev('__737.frameErrors')) === 0, 'no frame errors (Airbus)');
H.close();
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

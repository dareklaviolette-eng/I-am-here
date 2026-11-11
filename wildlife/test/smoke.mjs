// Smoke test: run the WHOLE page module with three.js and the DOM replaced by permissive stubs,
// then drive selectTrack/frame/views/map/file-loading to catch ReferenceErrors/TypeErrors in our own code.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)), html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
let mod = /<script type="module" id="app">([\s\S]*?)<\/script>/.exec(html)[1];
mod = mod.replace(/^import .*$/gm, '');
const errors = [];
function any(name = 'x') {
  const store = {};
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 1;
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      if (k in store) return store[k];
      return (store[k] = any(name + '.' + String(k)));
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return any(name + '()'); },
    construct() { return any('new ' + name); },
  });
}
const listeners = {};
globalThis.THREE = any('THREE'); globalThis.VRButton = any('VRButton'); globalThis.mergeGeometries = any('merge');
const el = () => { const e = any('el'); e.clientWidth = 400; e.clientHeight = 300; e.addEventListener = (k, fn) => (listeners['el:' + k] ||= []).push(fn); return e; };
const els = {};
globalThis.document = { querySelector: s => (els[s] ||= el()), querySelectorAll: () => [], createElement: () => el() };
Object.assign(globalThis, { innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
  addEventListener: (k, fn) => (listeners[k] ||= []).push(fn), window: globalThis });
let loopFn = null;
mod = mod.replace('renderer.setAnimationLoop(frame);', 'renderer.setAnimationLoop(frame); globalThis.__frame = frame; globalThis.__api = { setView, selectTrack, tracks, loadFiles, seek, S, st, cam, get cur(){return cur}, get world(){return world}, setPlay, setGuide, narrate, renderCard, orbit, orbitZoom, chaseDrag, VIEWS };');
// expose toast errors
mod = mod.replace("function toast(msg, ms = 4500) {", "function toast(msg, ms = 4500) { globalThis.__toasts = (globalThis.__toasts||[]).concat(msg);");
const tmp = fs.mkdtempSync('/tmp/wls-'); fs.writeFileSync(path.join(tmp, 'app.mjs'), mod);
await import(pathToFileURL(path.join(tmp, 'app.mjs')));
const A = globalThis.__api, F = globalThis.__frame;
const run = (n) => { for (let i = 0; i < n; i++) F(); };
const check = (label) => { const bad = (globalThis.__toasts || []).filter(t => /went wrong|Could not/.test(t)); if (bad.length) { console.error('FAIL', label, bad); process.exit(1); } console.log('ok -', label); };
run(5); check('boot eagle sample + frames (ride)');
if (JSON.stringify(A.VIEWS) !== JSON.stringify(['ride', 'beside', 'chase'])) { console.error('FAIL views are not exactly Ride / Beside / Chase', A.VIEWS); process.exit(1); }
for (const v of ['beside', 'chase', 'map', 'ride']) { A.setView(v); run(3); check('view ' + v); }
A.seek(A.cur.t0 + (A.cur.t1 - A.cur.t0) * 0.5); run(3); check('seek');
A.selectTrack(A.tracks[1]); run(5); check('shark sample, world=' + A.world.mode);
A.setView('chase'); run(3); A.setView('map'); run(2); check('shark chase/map');
for (const tr of [A.tracks[1], A.tracks[0]]) { A.selectTrack(tr);
  for (const v of ['ride', 'beside', 'chase']) { A.setView(v); run(3); }
  A.setView('chase'); A.chaseDrag(120, -40); A.orbitZoom(0.5); run(3); A.orbitZoom(4); run(3); }
check('Ride, Beside and Chase (with a drag and zoom), both samples');
A.setGuide(true, true); A.narrate('A test line. With two sentences.'); run(5); A.renderCard(true); A.setGuide(false, false); run(2);
check('guide on / narrate / card / guide off');
// VR comfort: on the eagle at x10, the ride camera yaw never turns faster than 30 deg/s and holds while circling
{ A.selectTrack(A.tracks[0]); A.setView('ride'); A.setPlay(true); run(3);
  let maxRate = 0, prev = A.cam.yaw, held = 0;
  for (let i = 0; i < 3000; i++) { F(); const d = Math.abs(((A.cam.yaw - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); maxRate = Math.max(maxRate, d / 0.1); prev = A.cam.yaw; if (A.cam.holding) held++; }
  const deg = maxRate * 180 / Math.PI;
  if (!(deg <= 30.01)) { console.error('FAIL comfort: camera yaw rate', deg.toFixed(1), 'deg/s'); process.exit(1); }
  console.log(`ok - VR comfort: max camera yaw rate ${deg.toFixed(1)} deg/s over 5 min at x10 (held heading ${held} of 3000 frames)`); }
// load files the way the file picker does
const csv = 'event-id,timestamp,location-long,location-lat,individual-local-identifier,individual-taxon-canonical-name\n1,2020-01-01 00:00:00.000,-86.6,36.3,A,Ciconia ciconia\n2,2020-01-01 00:15:00.000,-86.61,36.31,A,Ciconia ciconia\n3,2020-01-01 00:30:00.000,-86.62,36.33,A,Ciconia ciconia\n';
await A.loadFiles([{ name: 'stork.csv', text: async () => csv }]); run(4); check('load Movebank CSV without altitude -> ' + A.cur.name + ' / ' + A.world.mode);
await A.loadFiles([{ name: 'ride.gpx', text: async () => '<gpx><trk><name>T</name><trkseg><trkpt lat="36.3" lon="-86.6"><time>2021-01-01T00:00:00Z</time></trkpt><trkpt lat="36.31" lon="-86.6"><time>2021-01-01T00:10:00Z</time></trkpt></trkseg></trk></gpx>' }]);
run(4); check('load GPX');
await A.loadFiles([{ name: 'bad.csv', text: async () => 'foo,bar\n1,2' }]);
console.log('   friendly error for bad file:', (globalThis.__toasts || []).slice(-1)[0]);
console.log('tracks in list:', A.tracks.map(t => t.name + (t.isSample ? ' [SAMPLE]' : '')).join(' | '));

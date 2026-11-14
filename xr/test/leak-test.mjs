// node xr/test/leak-test.mjs [jumps=12]
// The Station Rules pass test, headless: N jumps in a row between stations (boats <-> Aurora tours <-> example), then back to
// where we started. Asserts that GPU memory (renderer.info.memory geometries / textures) and the JS heap (after GC) return to
// the baseline within a small margin, that no jump failed, and that frames are not slower at the end than at the start.
// Uses simulated ships (sim=1) and no network (tiles, relay, CDNs fail fast and the stations fall back).
import { serve, chrome } from './harness.mjs';

const N = +(process.argv[2] || 12);
const MARGIN = { geometries: 2, textures: 2, heapMB: 6, heapPct: 0.12, slow: 1.5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve(), c = await chrome();
let fails = 0; const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const ROUTE = [['aurora', { tour: 'swiss-alps' }], ['boats', { area: 'juneau', sim: '1' }], ['aurora', { tour: 'yosemite' }], ['example', {}],
  ['boats', { area: 'monaco', sim: '1' }], ['aurora', { tour: 'new-zealand', pov: 'chase' }], ['boats', { area: 'sydney', sim: '1', pov: 'chase' }]];
const HOME = ['boats', { area: 'sydney', sim: '1' }];

async function jump([st, p]) {
  const t0 = Date.now();
  await c.eval(`__xr.jump(${JSON.stringify(st)}, ${JSON.stringify(p)}), true`);
  await sleep(300);
  const done = await c.waitFor(`!__xr.jumping && __xr.current && __xr.current.meta.id === ${JSON.stringify(st)}`, 90000);
  await sleep(1500);   // let it run (ships build over a few frames)
  return { done, ms: Date.now() - t0, err: await c.eval('__xr.lastError') };
}
async function frameMs(ms = 2500) {
  return c.eval(`new Promise((res) => { let n = 0, t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else res((performance.now() - t0) / n); }; requestAnimationFrame(f); })`);
}
async function measure() {
  await c.gc(); await sleep(400); await c.gc();
  const info = JSON.parse(await c.eval('JSON.stringify(__xr.info())'));
  return { ...info, heap: await c.heap(), dom: await c.eval('document.getElementsByTagName("*").length') };
}

await c.open(srv.url + '/xr/test.html?test=1#station=boats&area=sydney&sim=1');
ok(await c.waitFor('window.__xr && __xr.ready', 90000), 'shell started at boats / Sydney (sim)');
// warm-up: every kind of station once (module and shader caches fill once; that is not a leak)
for (const r of [ROUTE[0], ROUTE[2], ROUTE[3], ROUTE[5], HOME]) await jump(r);
const base = await measure();
const f0 = await frameMs();
console.log(`baseline  geometries ${base.geometries}  textures ${base.textures}  programs ${base.programs}  heap ${(base.heap / 1048576).toFixed(1)} MB  dom ${base.dom}  frame ${f0.toFixed(1)} ms`);

const times = [];
for (let i = 0; i < N; i++) {
  const r = i === N - 1 ? HOME : ROUTE[i % ROUTE.length];
  const j = await jump(r);
  times.push(j.ms);
  const m = JSON.parse(await c.eval('JSON.stringify(__xr.info())'));
  console.log(`jump ${String(i + 1).padStart(2)} -> ${r[0]} ${JSON.stringify(r[1])}  ${j.done ? 'ok' : 'NOT DONE'} ${(j.ms / 1000).toFixed(1)} s  geo ${m.geometries} tex ${m.textures} prog ${m.programs}${j.err ? '  error: ' + j.err : ''}`);
  ok(j.done && !j.err, `jump ${i + 1} to ${r[0]} completed`);
}
const end = await measure();
const f1 = await frameMs();
console.log(`after ${N}  geometries ${end.geometries}  textures ${end.textures}  programs ${end.programs}  heap ${(end.heap / 1048576).toFixed(1)} MB  dom ${end.dom}  frame ${f1.toFixed(1)} ms`);
ok(Math.abs(end.geometries - base.geometries) <= MARGIN.geometries, `geometries back to baseline (${base.geometries} -> ${end.geometries}, margin ±${MARGIN.geometries})`);
ok(Math.abs(end.textures - base.textures) <= MARGIN.textures, `textures back to baseline (${base.textures} -> ${end.textures}, margin ±${MARGIN.textures})`);
const dh = (end.heap - base.heap) / 1048576;
ok(dh <= Math.max(MARGIN.heapMB, base.heap / 1048576 * MARGIN.heapPct), `JS heap back to baseline (${dh >= 0 ? '+' : ''}${dh.toFixed(1)} MB)`);
ok(end.dom <= base.dom + 5, `no DOM left behind (${base.dom} -> ${end.dom} elements)`);
ok(end.children === base.children, `scene children back to ${base.children} (now ${end.children})`);
ok(f1 <= f0 * MARGIN.slow + 2, `no slowdown (frame ${f0.toFixed(1)} ms -> ${f1.toFixed(1)} ms)`);
const slowest = Math.max(...times);
console.log(`jump times: ${times.map((t) => (t / 1000).toFixed(1)).join(' ')} s (headless software GL; includes 1.5 s run after each)`);
const errs = c.logs.filter((l) => /^(error|exception)/.test(l) && !/Failed to load resource|ERR_|net::|tile|google|jsdelivr|relay|WebSocket|aisstream|arcgis|openstreetmap|open-meteo|Real scenery|hull/i.test(l));
ok(errs.length === 0, 'no unexpected console errors' + (errs.length ? ':\n  ' + errs.slice(0, 5).join('\n  ') : ''));
console.log(JSON.stringify({ jumps: N, base: { geometries: base.geometries, textures: base.textures, heapMB: +(base.heap / 1048576).toFixed(1), frameMs: +f0.toFixed(1) },
  end: { geometries: end.geometries, textures: end.textures, heapMB: +(end.heap / 1048576).toFixed(1), frameMs: +f1.toFixed(1) }, slowestJumpS: +(slowest / 1000).toFixed(1) }));
c.close(); srv.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);

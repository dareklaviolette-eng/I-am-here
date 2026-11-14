// node xr/test/station-test.mjs : the stations' metadata agrees with their sources, the generated boats files are up to date,
// links round-trip, and every station module that runs in Node answers the six calls of the contract.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AISCore as C } from '../../stations/boats/ais-core.js';
import boats, { AREA_ORDER, DEFAULT_AREA, HERO_VESSEL } from '../../stations/boats/meta.js';
import aurora, { TOURS, DEFAULT_TOUR } from '../../stations/aurora/meta.js';
import example from '../../stations/example/meta.js';
import { parseHash, makeHash } from '../../shared/shell/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// generated files
let fresh = true; try { execFileSync('node', [path.join(ROOT, 'xr/tools/extract-boats.mjs'), '--check'], { stdio: 'pipe' }); } catch (e) { fresh = false; }
ok(fresh, 'stations/boats/ais-core.js and ships3d.js match boats/index.html (node xr/tools/extract-boats.mjs)');
// boats areas
const ids = AREA_ORDER.map((a) => a[0]);
ok(ids.every((id) => C.AREAS[id]), 'every boats area in meta.js exists in AISCore.AREAS');
ok(Object.keys(C.AREAS).every((id) => ids.includes(id)), 'every AISCore area is listed in meta.js (none forgotten)');
ok(ids[0] === DEFAULT_AREA && DEFAULT_AREA === 'sydney', 'the default area (Sydney Harbour) is first');
const cargo = ['losangeles', 'rotterdam', 'singapore', 'channel', 'neworleans', 'houston'];
ok(cargo.every((id) => ids.indexOf(id) > ids.indexOf('cumberland')), 'cargo ports are at the bottom of the list');
ok(AREA_ORDER.every((a) => Math.abs(a[3] - C.AREAS[a[0]].center[0]) < 0.6 && Math.abs(a[4] - C.AREAS[a[0]].center[1]) < 0.6), 'globe pins sit at the area centres');
ok(AREA_ORDER.every((a) => HERO_VESSEL[a[6]]), 'every area has a hero ship kind');
// aurora tours
for (const t of TOURS) {
  const m = await import(`../../travel/${t.id}/tour.js`);
  const names = m.STOPS.filter((s) => s.cam).map((s) => s.name);
  ok(t.stops.every(([sid, name], i) => m.STOPS[i] && m.STOPS[i].id === sid && m.STOPS[i].name === name), `${t.id}: stop ids and names match travel/${t.id}/tour.js`);
  ok(t.stops.length <= names.length, `${t.id}: ${t.stops.length} stops listed`);
}
ok(TOURS.some((t) => t.id === DEFAULT_TOUR), 'the default tour exists');
// links
const h = makeHash('boats', { area: 'sydney', sim: '1' });
ok(h === '#station=boats&area=sydney&sim=1', 'makeHash builds the station link ' + h);
const p = parseHash('#station=aurora&tour=swiss-alps&stop=5');
ok(p.station === 'aurora' && p.tour === 'swiss-alps' && p.stop === '5', 'parseHash reads a station link');
// meta shape
for (const m of [boats, aurora, example]) {
  ok(m.id && m.name && Array.isArray(m.blocks) && Array.isArray(m.povs) && typeof m.module === 'function' && Array.isArray(m.places), `${m.id}: meta has id, name, blocks, povs, places, module`);
  ok(m.blocks.every((b) => ['ride', 'stops', 'targets', 'time', 'pov'].includes(b)), `${m.id}: blocks are from the five`);
  ok(m.places.every((pl) => pl.id && pl.station === m.id && pl.name && typeof pl.lat === 'number' && typeof pl.lon === 'number'), `${m.id}: places are complete`);
}
// contract: the modules that run in Node (no three.js import) answer the six calls
const THREE = await import(path.join(process.env.THREE_DIR || '/home/claude/fleet3d/web/three', 'build/three.module.js')).catch(() => null);
for (const [name, mod] of THREE ? [['boats', await import('../../stations/boats/station.js')], ['example', await import('../../stations/example/station.js')]] : []) {
  const st = mod.createStation({ THREE, root: new THREE.Group(), rig: new THREE.Group(), setInterval() {}, setTimeout() {} });
  ok(['describe', 'load', 'run', 'targets', 'act', 'unload'].every((k) => typeof st[k] === 'function'), `${name}: describe / load / run / targets / act / unload`);
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);

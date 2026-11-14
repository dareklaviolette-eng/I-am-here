// node aurora/test/tour-world-test.mjs : the Aurora adapter takes every Travel Desk tour, and its allocation-free local
// horizon (basisInto) matches tour-core.js basisAt.
import { worldFromTour, basisInto } from '../tour-world.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } };
for (const id of ['yosemite', 'swiss-alps', 'new-zealand']) {
  const m = await import(`../../travel/${id}/tour.js`);
  const w = worldFromTour(m, { name: m.PARK.short });
  ok(w && w.stops.length === m.STOPS.length, id + ': world built');
  ok(w.curved === !!m.CURVED, id + ': curved flag');
  ok(w.stops.every((s) => s.loc), id + ': every stop has loc');
  let worst = 0;
  const B = { w: [0, 0, 0], u: [0, 0, 0], n: [0, 0, 0] };
  for (const s of m.STOPS) {
    const p = m.toLocal(...s.cam), ref = m.basisAt(p);
    if (!m.CURVED) continue;
    basisInto(m.FRAME, p[0], p[1], p[2], B);
    for (const k of ['w', 'u', 'n']) for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(B[k][i] - ref[k][i]));
  }
  ok(worst < 1e-6, id + ': basis matches basisAt (' + worst.toExponential(2) + ')');
  // fly the whole tour: poses finite, the curved basis stays unit length, altitude sane
  w.start(); let bad = 0;
  for (let i = 1; i <= w.stops.length; i++) {
    w.go(i);
    for (let k = 0; k < 900; k++) {
      const p = w.update(0.05);
      if (![p.x, p.y, p.z, p.heading].every(Number.isFinite)) bad++;
      if (p.basis && Math.abs(Math.hypot(...p.basis.u) - 1) > 1e-9) bad++;
    }
  }
  ok(bad === 0, id + ': poses finite along every leg');
  const alt = w.altMsl(), want = w.stops[w.index].alt;
  ok(Math.abs(alt - want) < 5, id + ': altMsl at the stop ' + alt.toFixed(1) + ' vs ' + want);
  console.log(id, 'checked; curved', w.curved, 'basis err', worst.toExponential(2));
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);

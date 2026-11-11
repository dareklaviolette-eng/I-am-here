// Usage: node test/run.mjs  (from anywhere). Extracts scripts from wildlife.html, syntax-checks, unit-tests the core.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)), html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
const tmp = fs.mkdtempSync('/tmp/wl-');
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('ok -', name); };

// 1. syntax: module script + classic script + importmap JSON; only allowed hosts
const mod = /<script type="module" id="app">([\s\S]*?)<\/script>/.exec(html)[1];
fs.writeFileSync(path.join(tmp, 'app.mjs'), mod); execFileSync('node', ['--check', path.join(tmp, 'app.mjs')]);
const classic = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1]; fs.writeFileSync(path.join(tmp, 'c.js'), classic); execFileSync('node', ['--check', path.join(tmp, 'c.js')]);
const imap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
ok('node --check module + classic script, importmap JSON valid; only allowed hosts', () => {
  for (const u of Object.values(imap.imports)) assert.match(u, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.165\.0\//);
  const urls = html.match(/https?:\/\/[^\s"'`)]+/g) || [];
  // jsdelivr (three.js), the Google logo the 3D tiles attribution requires, and Wikimedia Commons (species photos + credit pages)
  for (const u of urls) assert.match(u, /^https:\/\/(cdn\.jsdelivr\.net\/npm\/|www\.google\.com\/images\/branding\/|commons\.wikimedia\.org\/wiki\/(Special:FilePath\/|File:))/, 'unexpected remote URL ' + u);
  assert.match(html, /const GOOGLE_KEY = '[^']*';\s+\/\/ restricted to dareklaviolette-eng\.github\.io/, 'the key is the domain-restricted one');
  assert.ok(!/fetch\(|XMLHttpRequest|url\(http/.test(html.replace(/import\(/g, '')), 'no fetch / XHR / remote CSS images');
  const imgs = html.match(/<img\b[^>]*>/g) || []; assert.equal(imgs.length, 1, 'one <img> tag: the animal card');
  assert.match(imgs[0], /id="cardImg"/); assert.match(imgs[0], /referrerpolicy="no-referrer"/);
});

// 2. load the pure core
const core = /\/\* CORE-BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* CORE-END \*\//.exec(mod)[1];
assert.ok(!/THREE|document|window/.test(core), 'core must be DOM/three free');
const names = ['haversine', 'parseTimestamp', 'splitCSVLine', 'parseMovebankCSV', 'parseGPX', 'buildTrack', 'sampleTrack', 'findSeg', 'detectMode',
  'makeWorld', 'terrainHeight', 'landHeight', 'riverX', 'riverHalfWidth', 'renderAltitude', 'genEagleCSV', 'genSharkCSV', 'chooseSpeed', 'formatUTC', 'formatDist', 'EAGLE_ALT_BASE',
  'formatAgo', 'safePhotoUrl', 'guideNew', 'guideReset', 'guideStep', 'GUIDE_GAP'];
fs.writeFileSync(path.join(tmp, 'core.mjs'), core + '\nexport {' + names.join(',') + '};');
const C = await import(pathToFileURL(path.join(tmp, 'core.mjs')));

ok('timestamps (Movebank UTC, ISO Z, offsets)', () => {
  assert.equal(C.parseTimestamp('2019-03-21 07:00:00.000'), Date.UTC(2019, 2, 21, 7, 0, 0));
  assert.equal(C.parseTimestamp('2019-03-21 07:00:05.250'), Date.UTC(2019, 2, 21, 7, 0, 5, 250));
  assert.equal(C.parseTimestamp('2019-03-21T07:00:00Z'), Date.UTC(2019, 2, 21, 7));
  assert.equal(C.parseTimestamp('2019-03-21T09:00:00+02:00'), Date.UTC(2019, 2, 21, 7));
  assert.ok(Number.isNaN(C.parseTimestamp('')));
});
ok('haversine: 1 degree of latitude ~ 111.2 km', () => assert.ok(Math.abs(C.haversine(36, -86, 37, -86) - 111195) < 20));

const CSV = `﻿event-id,visible,timestamp,location-long,location-lat,height-above-ellipsoid,individual-taxon-canonical-name,individual-local-identifier,comments
5,true,2020-01-01 00:10:00.000,-86.590,36.31,300,Haliaeetus leucocephalus,"Eagle, ""Big Al""",late row first
1,true,2020-01-01 00:00:00.000,-86.600,36.30,250,Haliaeetus leucocephalus,"Eagle, ""Big Al""",
2,false,2020-01-01 00:02:00.000,-80.000,30.00,250,Haliaeetus leucocephalus,"Eagle, ""Big Al""",outlier
3,true,2020-01-01 00:05:00.000,-86.595,36.305,,Haliaeetus leucocephalus,"Eagle, ""Big Al""",no alt
4,true,2020-01-01 00:06:00.000,,,,Haliaeetus leucocephalus,"Eagle, ""Big Al""",no fix
6,true,2020-01-01 00:00:00.000,-122.1,36.5,-12,Carcharodon carcharias,shark-7,
7,true,2020-01-01 01:00:00.000,-122.0,36.4,-30,Carcharodon carcharias,shark-7,
`;
ok('Movebank CSV: quotes, BOM, hidden rows, missing fixes, grouping, sorting, alt fill', () => {
  const r = C.parseMovebankCSV(CSV);
  assert.equal(r.tracks.length, 2); assert.equal(r.hidden, 1); assert.equal(r.skipped, 1); assert.equal(r.altKind, 'height-above-ellipsoid');
  const e = C.buildTrack(r.tracks[0]);
  assert.equal(e.id, 'Eagle, "Big Al"'); assert.equal(e.n, 3); assert.equal(e.t0, Date.UTC(2020, 0, 1)); assert.equal(e.t1, Date.UTC(2020, 0, 1, 0, 10));
  assert.ok(e.hasAlt); assert.equal(e.alt[1], 275); // filled linearly in time (halfway)
  assert.equal(C.detectMode(e.taxon), 'land'); assert.equal(C.detectMode(r.tracks[1].taxon), 'ocean');
  assert.throws(() => C.parseMovebankCSV('a,b\n1,2'), /location-long/);
  const semi = C.parseMovebankCSV('timestamp;location-long;location-lat\n2020-01-01 00:00:00;10;50\n2020-01-01 00:01:00;10.01;50');
  assert.equal(semi.tracks[0].points.length, 2);
});

const GPX = `<?xml version="1.0"?><gpx version="1.1" creator="x"><metadata><name>Doc</name></metadata>
<trk><name>Morning &amp; flight</name><trkseg>
<trkpt lon="-86.6" lat="36.3"><ele>200</ele><time>2021-05-01T12:00:00Z</time></trkpt>
<trkpt lat="36.301" lon="-86.601"><ele>220</ele><time>2021-05-01T12:00:30Z</time></trkpt>
<trkpt lat="36.302" lon="-86.603"><ele>240.5</ele><time>2021-05-01T12:01:00Z</time></trkpt>
</trkseg></trk></gpx>`;
ok('GPX: trkpt attribute order, ele, time, name entities; wpt fallback without times', () => {
  const t = C.parseGPX(GPX); assert.equal(t.length, 1); assert.equal(t[0].id, 'Morning & flight');
  const tr = C.buildTrack(t[0]); assert.equal(tr.n, 3); assert.equal(tr.alt[2], 240.5); assert.equal(tr.t1 - tr.t0, 60000);
  const w = C.parseGPX('<gpx><wpt lat="1" lon="2"/><wpt lat="1.001" lon="2"/></gpx>'); const wt = C.buildTrack(w[0]);
  assert.ok(wt.timesEstimated); assert.ok(Math.abs((wt.t1 - wt.t0) / 1000 - 111.195 / 10) < 0.6);
  assert.throws(() => C.parseGPX('hello'), /GPX/);
});

ok('dateline longitude unwrap keeps distance small', () => {
  const tr = C.buildTrack({ id: 'x', points: [{ t: 0, lat: 0, lon: 179.9, alt: NaN }, { t: 1000, lat: 0, lon: -179.9, alt: NaN }] });
  assert.ok(tr.totalDist < 23000 && tr.totalDist > 21000); assert.ok(Math.abs(tr.x[1]) < 23000);
});

ok('interpolation: hits every fix, continuous, derivative matches, distance monotone, clamps', () => {
  const tr = C.parseMovebankCSV(C.genEagleCSV()).tracks[0]; const T = C.buildTrack(tr, { altBase: C.EAGLE_ALT_BASE });
  for (let i = 0; i < T.n; i += 37) { const s = C.sampleTrack(T, T.t[i]); assert.ok(Math.hypot(s.x - T.x[i], s.z - T.z[i]) < 1e-6); assert.ok(Math.abs(s.alt - T.alt[i]) < 1e-6); }
  let prevD = -1, prev = null;
  for (let t = T.t0; t <= T.t1; t += 731) {
    const s = C.sampleTrack(T, t); assert.ok(s.dist >= prevD - 1e-9); prevD = s.dist;
    if (prev) assert.ok(Math.hypot(s.x - prev.x, s.z - prev.z) < 0.731 * 40, 'no teleports');
    const a = C.sampleTrack(T, t - 5), b = C.sampleTrack(T, t + 5);
    if (a.i === b.i && a.t === t - 5 && b.t === t + 5) { assert.ok(Math.abs((b.x - a.x) / 0.01 - s.vx) < 0.05); assert.ok(Math.abs((b.z - a.z) / 0.01 - s.vz) < 0.05); }
    assert.ok(Number.isFinite(s.omega)); prev = s;
  }
  assert.ok(Math.abs(C.sampleTrack(T, T.t1 + 1e9).dist - T.totalDist) < 1e-6); assert.equal(C.sampleTrack(T, T.t0 - 1e9).dist, 0);
  for (const t of [T.t[5], T.t[5] + 1, T.t[6] - 1]) { const i = C.findSeg(T, t); assert.ok(T.t[i] <= t && t <= T.t[i + 1]); }
});

ok('SAMPLE eagle: Movebank round trip, labelled synthetic, flies above ground, visits water, ~90 min', () => {
  const csv = C.genEagleCSV(); assert.match(csv, /SAMPLE - synthetic, not real data/);
  const T = C.buildTrack(C.parseMovebankCSV(csv).tracks[0], { altBase: C.EAGLE_ALT_BASE, isSample: true });
  const w = C.makeWorld(C.detectMode(T.taxon), T); assert.equal(w.mode, 'land');
  assert.equal((T.t1 - T.t0) / 60000, 90); assert.equal(C.chooseSpeed(T.t1 - T.t0), 10);
  let minAgl = Infinity, maxAgl = 0, overLake = 0;
  for (let i = 0; i < T.n; i++) { const g = Math.max(C.landHeight(T.x[i], T.z[i]), 0); const s = C.sampleTrack(T, T.t[i]);
    const y = C.renderAltitude(T, w, s, C.landHeight(T.x[i], T.z[i])); minAgl = Math.min(minAgl, y - g); maxAgl = Math.max(maxAgl, y - g);
    if (Math.abs(T.x[i] - C.riverX(T.z[i])) < C.riverHalfWidth(T.z[i]) && C.riverHalfWidth(T.z[i]) > 250) overLake++; }
  assert.ok(minAgl >= 1.4, 'minAgl ' + minAgl); assert.ok(maxAgl > 400, 'soars high ' + maxAgl); assert.ok(overLake > 5, 'over lake ' + overLake);
  console.log(`   eagle: ${T.n} fixes, ${(T.totalDist / 1000).toFixed(1)} km, AGL ${minAgl.toFixed(1)}..${maxAgl.toFixed(0)} m, ${overLake} fixes over the lake`);
});

ok('SAMPLE tracks travel: no small circles or loops (any 3 min eagle / 2 h shark window)', () => {
  for (const [csv, winMs, name] of [[C.genEagleCSV(), 180000, 'eagle'], [C.genSharkCSV(), 7200000, 'shark']]) {
    const T = C.buildTrack(C.parseMovebankCSV(csv).tracks[0], { altBase: 0, isSample: true });
    let worstTurn = 0, worstRatio = 1;
    for (let i = 0; i < T.n; i++) {
      let turn = 0, path = 0, prevH = null, j = i;
      for (; j + 1 < T.n && T.t[j + 1] - T.t[i] <= winMs; j++) {
        const dx = T.x[j + 1] - T.x[j], dz = T.z[j + 1] - T.z[j], d = Math.hypot(dx, dz); path += d;
        if (d < 5) continue;   // perched / noise
        const h = Math.atan2(dx, dz); if (prevH !== null) { turn += ((h - prevH + 3 * Math.PI) % (2 * Math.PI)) - Math.PI; worstTurn = Math.max(worstTurn, Math.abs(turn)); } prevH = h;
      }
      if (path < 300) continue;
      worstRatio = Math.min(worstRatio, Math.hypot(T.x[j] - T.x[i], T.z[j] - T.z[i]) / path);
    }
    console.log(`   ${name}: max net turning in a window ${(worstTurn * 180 / Math.PI).toFixed(0)} deg, min straightness ${worstRatio.toFixed(2)}`);
    assert.ok(worstTurn < 1.5 * Math.PI,   // a full circle is 360 deg of net turning
      name + ' turns in circles: ' + (worstTurn * 180 / Math.PI).toFixed(0) + ' deg');
    assert.ok(worstRatio > 0.5, name + ' loops back on itself: straightness ' + worstRatio.toFixed(2));
  }
});

ok('SAMPLE shark: ocean world, coast never crossed, stays underwater above seabed', () => {
  const T = C.buildTrack(C.parseMovebankCSV(C.genSharkCSV()).tracks[0], { altBase: 0, isSample: true });
  const w = C.makeWorld(C.detectMode(T.taxon), T); assert.equal(w.mode, 'ocean'); assert.equal(C.chooseSpeed(T.t1 - T.t0), 1000);
  let minOff = Infinity;
  for (let t = T.t0; t <= T.t1; t += 300000) { const s = C.sampleTrack(T, t), g = C.terrainHeight(w, s.x, s.z), y = C.renderAltitude(T, w, s, g);
    assert.ok(g < -10, 'seabed ' + g); assert.ok(y < 0 && y >= g + 2, 'y ' + y + ' g ' + g); minOff = Math.min(minOff, -g); }
  // there must be land somewhere on the coast side
  const s = C.sampleTrack(T, (T.t0 + T.t1) / 2); let land = false;
  for (let d = 0; d < 40000; d += 500) if (C.terrainHeight(w, s.x + w.nx * d, s.z + w.nz * d) > 5) { land = true; break; }
  assert.ok(land, 'coastline exists');
  console.log(`   shark: ${T.n} fixes, ${(T.totalDist / 1000).toFixed(0)} km over 4 days, shallowest seabed under track ${minOff.toFixed(0)} m`);
});

ok('formatting', () => { assert.equal(C.formatUTC(Date.UTC(2025, 4, 17, 14, 3, 9)), '2025-05-17 14:03:09'); assert.equal(C.formatDist(950), '950 m'); assert.equal(C.formatDist(12400), '12.40 km'); });

ok('perf: terrain tile height evals', () => { const w = C.makeWorld('land'); const t = performance.now(); for (let i = 0; i < 40401; i++) C.terrainHeight(w, i % 201 * 90, (i / 201 | 0) * 90); const ms = performance.now() - t; console.log(`   40k land height evals: ${ms.toFixed(1)} ms`); assert.ok(ms < 400); });

ok('animal card data fields: photo-url / photo-credit / named-by / org columns, safe photo URLs', () => {
  const csv = 'timestamp,location-long,location-lat,individual-local-identifier,individual-nick-name,tracking-organization,named-by,photo-url,photo-credit,photo-is-individual\n' +
    '2020-01-01 00:00:00,-122,36,S1,Mary Lee,OCEARCH,School contest,https://example.org/maryl.jpg,R. Snow,true\n2020-01-01 01:00:00,-122.1,36.1,S1,,,,,,\n';
  const r = C.parseMovebankCSV(csv), t = C.buildTrack(r.tracks[0]);
  assert.equal(t.animalName, 'Mary Lee'); assert.equal(t.org, 'OCEARCH'); assert.equal(t.namedBy, 'School contest');
  assert.equal(t.photoUrl, 'https://example.org/maryl.jpg'); assert.equal(t.photoCredit, 'R. Snow'); assert.equal(t.photoIsIndividual, true);
  const o = C.buildTrack({ id: 'x', points: r.tracks[0].points }, { photoUrl: 'javascript:alert(1)', nameOfAnimal: 'Al', namedBy: 'Kids', org: 'TWRA' });
  assert.equal(o.photoUrl, '', 'only http(s) / data:image photos'); assert.equal(o.animalName, 'Al'); assert.equal(o.photoIsIndividual, false);
  assert.equal(C.safePhotoUrl('data:image/png;base64,AA'), 'data:image/png;base64,AA');
});
ok('formatAgo', () => {
  assert.equal(C.formatAgo(20e3), 'just now'); assert.equal(C.formatAgo(14 * 60e3), '14 min ago'); assert.equal(C.formatAgo(3600e3), '1 hr ago');
  assert.equal(C.formatAgo(5 * 3600e3), '5 hrs ago'); assert.equal(C.formatAgo(12 * 86400e3), '12 days ago'); assert.equal(C.formatAgo(400 * 86400e3), '1 yr ago');
  assert.equal(C.formatAgo(90 * 86400e3), '2 months ago'); assert.equal(C.formatAgo(NaN), 'time unknown');
});
ok('guide speaks only at moments, never more often than GUIDE_GAP, facts once', () => {
  const facts = { dive: 'FACT-DIVE.', deep: 'FACT-DEEP.', rise: 'FACT-RISE.', climb: 'FACT-CLIMB.' };
  const G = C.guideNew({ intro: 'INTRO.', facts });
  const st = (o) => C.guideStep(G, { busy: false, named: false, place: 'Pacific Ocean', ocean: true, vh: 0, ...o });
  assert.equal(st({ now: 0, h: 5 }), 'INTRO.', 'start of the ride');
  assert.equal(st({ now: 5, h: 30 }), '', 'too soon after the last line');
  assert.match(st({ now: 31, h: 30 }), /^Deepest point of this ride so far: 30 metres\. FACT-DEEP\.$/);
  assert.equal(st({ now: 70, h: 31 }), '', 'nothing happened: silence');
  assert.match(st({ now: 75, h: 14 }), /^Rising, 14 metres below the surface\. FACT-RISE\.$/);
  assert.match(st({ now: 110, h: 30.5 }), /^Diving, now 31 metres down\. FACT-DIVE\.$/);
  assert.equal(st({ now: 150, h: 43, busy: true }), '', 'never over the narrator');
  assert.equal(st({ now: 151, h: 43 }), 'Deepest point of this ride so far: 43 metres.', 'a fact is said once');
  assert.equal(st({ now: 190, h: 43, named: true, place: 'Monterey Bay, CA' }), 'Now in Monterey Bay, CA.');
  assert.equal(st({ now: 230, h: 43, named: true, place: 'Monterey Bay, CA' }), '', 'same place: silence');
  C.guideReset(G); assert.equal(st({ now: 400, h: 5 }), '', 'a seek is not a dive or a rise');
  // land: dives (vertical speed) and climbs
  const L = C.guideNew({ intro: 'I.', facts });
  const sl = (o) => C.guideStep(L, { busy: false, named: false, place: 'x', ocean: false, vh: 0, ...o });
  sl({ now: 0, h: 20 }); assert.match(sl({ now: 35, h: 180 }), /^Climbing, now 180 metres up\. FACT-CLIMB\.$/);
  assert.match(sl({ now: 70, h: 150, vh: -7 }), /^Diving!/); assert.equal(sl({ now: 110, h: 100, vh: -7 }), '', 'one call per dive');
  assert.match(sl({ now: 150, h: 420 }), /^Highest of this ride so far: 420 metres above the ground\./);
  // over a whole sample shark ride at x1000, a line every few minutes at most
  const T = C.buildTrack(C.parseMovebankCSV(C.genSharkCSV()).tracks[0], { altBase: 0, isSample: true });
  const W = C.makeWorld('ocean', T), S2 = C.guideNew({ intro: 'I.', facts }); let n = 0, last = -1e9, minGap = 1e9;
  for (let t = 0; t < (T.t1 - T.t0) / 1000 / 1000; t += 0.5) { const s = C.sampleTrack(T, T.t0 + t * 1e6), y = C.renderAltitude(T, W, s, C.terrainHeight(W, s.x, s.z));
    const line = C.guideStep(S2, { now: t, ocean: true, h: -y, vh: 0, place: 'p', named: false, busy: false }); if (line) { n++; if (n > 1) minGap = Math.min(minGap, t - last); last = t; } }
  console.log(`   shark sample at x1000: ${n} guide lines in ${((T.t1 - T.t0) / 1e6 / 60).toFixed(1)} min, min gap ${minGap.toFixed(1)} s`);
  assert.ok(n >= 3 && n <= 14, 'lines ' + n); assert.ok(minGap >= C.GUIDE_GAP);
});

console.log(`\n${pass} test groups passed`);

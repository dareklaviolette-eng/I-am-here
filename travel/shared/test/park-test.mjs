// Shared checks for a Travel Desk park's pure modules (tour.js, guide.js, terrain.js height field). A park's own test calls
// runParkTests(dir, { landmarks, species, ... }); run with node, e.g.: node travel/swiss-alps/test/tour-test.mjs
export async function runParkTests(dirUrl, X) {
  const T = await import(new URL('tour.js', dirUrl)), G = await import(new URL('guide.js', dirUrl));
  const TR = await import(new URL('terrain.js', dirUrl)).catch(() => null);
  const { makeHeightField } = await import('../terrain-kit.js');
  const { STOPS, PARK } = T, SP = G.SPECIES, D = 180 / Math.PI;
  let fail = 0; const ok = (n, c, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (info ? ' (' + info + ')' : '')); if (!c) fail++; };
  const deg = (r) => ((r * D) % 360 + 360) % 360;
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  // frame
  const o = T.toLocal(T.ORIGIN.lat, T.ORIGIN.lon, -T.GEOID_M);
  ok('origin maps to ~0 at the ellipsoid', Math.hypot(...o) < 0.5, o.map((v) => v.toFixed(2)).join(','));
  for (const s of STOPS) {
    const b = T.fromLocal(...T.toLocal(...s.cam));
    if (!(Math.abs(b.lat - s.cam[0]) * 111000 < 5 && Math.abs(b.lon - s.cam[1]) * 80000 < 5 && Math.abs(b.altMsl - s.cam[2]) < 5)) ok('fromLocal inverts toLocal at ' + s.id, false, JSON.stringify(b));
  }
  ok('fromLocal inverts toLocal within 5 m at every viewpoint', true);
  // curved horizon: the local up at a far viewpoint is the geodetic up there, and a stop's pitch is measured from it
  const far = STOPS.reduce((a, s) => (Math.hypot(...T.toLocal(...s.cam)) > Math.hypot(...T.toLocal(...a.cam)) ? s : a));
  const pf = T.toLocal(...far.cam), up = T.basisAt(pf).u, above = T.toLocal(far.cam[0], far.cam[1], far.cam[2] + 1000);
  const tilt = Math.acos(Math.min(1, ((above[0] - pf[0]) * up[0] + (above[1] - pf[1]) * up[1] + (above[2] - pf[2]) * up[2]) / 1000)) * D;
  ok(`local up is true vertical at the farthest viewpoint (${far.id}, ${(Math.hypot(...pf) / 1000).toFixed(0)} km out)`, tilt < 0.01, tilt.toFixed(4) + ' deg');

  // stops
  ok(`6-8 stops (${STOPS.length})`, STOPS.length >= 6 && STOPS.length <= 8);
  ok('ids unique', new Set(STOPS.map((s) => s.id)).size === STOPS.length);
  ok('every caption is 2-3 sentences', STOPS.every((s) => { const k = s.caption.split(/(?<=[.!?])\s+/).length; return k >= 2 && k <= 3; }), STOPS.map((s) => s.caption.split(/(?<=[.!?])\s+/).length).join(','));
  ok('LOC is "Place, Country" with no prepositions', STOPS.every((s) => new RegExp('^[^,]+, ' + X.country + '$').test(s.loc) && !/\b(near|over|above|in|at|of|by|on)\b/i.test(s.loc)), STOPS.map((s) => s.loc).join(' | '));
  ok('every stop has field-guide species that exist', STOPS.every((s) => s.species.length && s.species.every((id) => SP[id])));
  ok('every species in the guide is on the tour, and the order list matches', G.SPECIES_ORDER.length === Object.keys(SP).length && G.SPECIES_ORDER.every((id) => SP[id] && STOPS.some((s) => s.species.includes(id))));
  ok('required species present: ' + X.species.join(', '), X.species.every((k) => SP[k]));
  ok('species cards are text-only with name, scientific name, text, where to look', Object.values(SP).every((s) => s.name && /^[A-Z][a-z]+ [a-z]+( [a-z]+)?$/.test(s.sci) && s.text.length > 60 && s.look && !s.photo));
  ok('elevations given in metres', STOPS.every((s) => Number.isFinite(s.elevM)));
  // headings point at the landmark each stop is about
  for (const [id, lat, lon, alt, tol = 20] of X.landmarks) {
    const s = STOPS.find((x) => x.id === id), P = T.stopPose(s), L = T.toLocal(lat, lon, alt), d = [L[0] - P.pos[0], L[1] - P.pos[1], L[2] - P.pos[2]], B = T.basisAt(P.pos);
    const q = [0, 1, 2].map((k) => [B.w, B.u, B.n][k].reduce((a, v, i) => a + v * d[i], 0)), h = deg(Math.atan2(-q[0], q[2])), pt = Math.atan2(q[1], Math.hypot(q[0], q[2])) * D;
    ok(`${id}: looks toward its landmark (heading ${deg(P.heading).toFixed(0)}°, landmark at ${h.toFixed(0)}°, ${pt.toFixed(0)}° up; on screen)`, angDiff(h, deg(P.heading)) < tol && Math.abs(pt - P.pitch * D) < 25);
  }
  // viewpoints sit above the (rendered) ground around them: a check of the data against our own height model
  if (TR && TR.SPEC) {
    const F = makeHeightField(TR.SPEC);
    for (const s of STOPS) {
      let worst = Infinity;
      for (let a = 0; a < 360; a += 30) for (const r of [0, 300]) { const la = s.cam[0] + r * Math.cos(a / D) / 111000, lo = s.cam[1] + r * Math.sin(a / D) / 78000; worst = Math.min(worst, s.cam[2] - F.sample(...F.xy(la, lo)).h); }
      ok(`${s.id}: viewpoint ${s.cam[2]} m is above the rendered ground within 300 m`, worst > 60, Math.round(worst) + ' m clear');
    }
  }
  // glides
  const poses = STOPS.map((s) => T.povPose(s, 'deck')), base = { turn: 25 };
  let worst = 0, flow = 0; const durs = [];
  for (let i = 0; i < poses.length; i++) {
    const L = T.makeLeg(poses[i], poses[(i + 1) % poses.length]); durs.push(L.dur.toFixed(1));
    worst = Math.max(worst, T.legPeakTurnRate(L)); flow = Math.max(flow, T.legPeakFlow(L));
    const a = { pos: [0, 0, 0] }, b = { pos: [0, 0, 0] }; T.legPose(L, 0, a); T.legPose(L, 1, b);
    ok(`leg ${STOPS[i].id} -> ${STOPS[(i + 1) % STOPS.length].id}: ${(L.dist / 1000).toFixed(0)} km in ${L.dur.toFixed(1)} s, lift ${(L.lift / 1000).toFixed(1)} km, starts and ends on the poses`,
      L.dur >= 10 && L.dur <= X.durMax && Math.hypot(a.pos[0] - poses[i].pos[0], a.pos[1] - poses[i].pos[1], a.pos[2] - poses[i].pos[2]) < 1e-6 && Math.hypot(...b.pos.map((v, k) => v - poses[(i + 1) % poses.length].pos[k])) < 1e-6);
  }
  ok('peak turn rate under 25 deg/s on every leg (no fast spins)', worst < base.turn, worst.toFixed(1) + ' deg/s');
  ok(`peak ground flow (speed / height) under ${X.flowMax} deg/s`, flow < X.flowMax, flow.toFixed(1) + ' deg/s');
  const d0 = T.drift(STOPS[0], 0), dv = T.drift(STOPS[0], 13, true);
  ok('drift starts at zero; VR drift is a slide of at most 8 m, no rotation', Math.hypot(...d0.off) < 1e-9 && d0.yaw === 0 && Math.hypot(...dv.off) <= 8.01 && dv.yaw === 0);
  ok('three POVs: Observation deck, Be There, God\'s eye', T.POVS.map((p) => p[0]).join() === 'deck,bethere,god');
  for (const s of STOPS) { const g = T.povPose(s, 'god'), alt = T.fromLocal(...g.pos).altMsl; if (!(alt > s.cam[2] + 2500)) ok(`God's eye above ${s.id}`, false, Math.round(alt) + ' m'); }
  ok("God's eye sits well above every stop", true);
  ok('route line sampled', T.routeLine(10).length === (STOPS.length - 1) * 11 * 3);
  // weather
  const u = T.weatherURL();
  ok('one Open-Meteo request for every stop, metric, local time zone', u.match(/latitude=([^&]+)/)[1].split(',').length === STOPS.length && /temperature_unit=celsius/.test(u) && /wind_speed_unit=kmh/.test(u) && u.includes('timezone=' + encodeURIComponent(PARK.timezone)), u.slice(0, 80) + '…');
  const w = T.parseWeather([{ current: { temperature_2m: -3.4, weather_code: 71, wind_speed_10m: 18.2, wind_direction_10m: 315, is_day: 1, time: '2026-11-13T10:00' } }, {}]);
  ok('weather parsed (°C with °F, words, km/h, compass)', w[0].tempC === -3 && w[0].tempF === 26 && w[0].text === 'Light snow' && w[0].windKmh === 18 && w[0].windDir === 'NW' && w[1] === null, JSON.stringify(w[0]));
  ok('PARK: card words', PARK.org === X.org && PARK.flag.iso2 === X.iso2 && PARK.units === 'metric' && PARK.name && PARK.about && Array.isArray(PARK.notes) && Array.isArray(PARK.credits));
  console.log('durations', durs.join(' '), '· peak turn', worst.toFixed(1), '· peak flow', flow.toFixed(1));
  return fail;
}

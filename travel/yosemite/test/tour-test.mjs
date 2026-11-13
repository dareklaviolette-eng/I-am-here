// node travel/yosemite/test/tour-test.mjs   (pure tour maths: frames, stops, glide comfort)
import { STOPS, toLocal, fromLocal, stopPose, povPose, makeLeg, legPose, legPeakTurnRate, drift, parseWeather, weatherURL, routeLine, POVS } from '../tour.js';
import { SPECIES } from '../guide.js';
let fail = 0; const ok = (n, c, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (info ? ' (' + info + ')' : '')); if (!c) fail++; };
const deg = (r) => r * 180 / Math.PI;

// frame: the origin is at 0, north is +z, east is -x, up is +y
const o = toLocal(37.7456, -119.5936, 32);
ok('origin maps to ~0 at the geoid', Math.hypot(...o) < 0.5, o.map((v) => v.toFixed(2)).join(','));
const n = toLocal(37.7556, -119.5936, 0), e = toLocal(37.7456, -119.5836, 0);
ok('north = +z, east = -x', n[2] > 1100 && Math.abs(n[0]) < 1 && e[0] < -870 && Math.abs(e[2]) < 1);
const back = fromLocal(...toLocal(37.87, -119.39, 2900));
ok('fromLocal inverts toLocal within 20 m across the park', Math.abs(back.lat - 37.87) * 111000 < 20 && Math.abs(back.lon + 119.39) * 88000 < 20 && Math.abs(back.altMsl - 2900) < 5, JSON.stringify(back));

// stops: headings point the way the famous views look
const H = Object.fromEntries(STOPS.map((s) => [s.id, deg(stopPose(s).heading)]));
ok('Tunnel View looks east-northeast up the valley (60-85 deg)', H.tunnel > 60 && H.tunnel < 85, H.tunnel.toFixed(1));
ok('El Capitan: looks north at the wall', Math.abs(H.elcap - 20) < 25, H.elcap.toFixed(1));
ok('Glacier Point looks northeast at Half Dome', H.glacier > 50 && H.glacier < 75, H.glacier.toFixed(1));
ok('Tuolumne looks east toward Mt Dana', H.tuolumne > 65 && H.tuolumne < 90, H.tuolumne.toFixed(1));
ok('6-8 stops, each with a 2-3 sentence caption and field-guide species that exist', STOPS.length >= 6 && STOPS.length <= 8 &&
  STOPS.every((s) => { const k = s.caption.split(/(?<=\.)\s+/).length; return k >= 2 && k <= 3 && s.species.length && s.species.every((id) => SPECIES[id]); }),
  STOPS.map((s) => s.caption.split(/(?<=\.)\s+/).length).join(','));
ok('all eight required species are in the guide', ['black-bear', 'mule-deer', 'peregrine', 'bighorn', 'stellers-jay', 'fence-lizard', 'pika', 'sequoia'].every((k) => SPECIES[k]));

// glides: 10-20 s, never fast spins, rising over long legs
const poses = STOPS.map((s) => povPose(s, 'deck'));
let worst = 0, durs = [];
for (let i = 0; i < poses.length; i++) {
  const L = makeLeg(poses[i], poses[(i + 1) % poses.length]); durs.push(L.dur.toFixed(1));
  worst = Math.max(worst, legPeakTurnRate(L));
  ok(`leg ${STOPS[i].id} -> ${STOPS[(i + 1) % STOPS.length].id}: 10-20 s`, L.dur >= 10 && L.dur <= 20, L.dur.toFixed(1) + ' s, ' + (L.dist / 1000).toFixed(1) + ' km, lift ' + Math.round(L.lift) + ' m');
  const a = { pos: [0, 0, 0] }, b = { pos: [0, 0, 0] }; legPose(L, 0, a); legPose(L, 1, b);
  ok(`  starts and ends exactly on the poses`, Math.hypot(a.pos[0] - poses[i].pos[0], a.pos[1] - poses[i].pos[1], a.pos[2] - poses[i].pos[2]) < 1e-6 && Math.abs(b.heading - poses[(i + 1) % poses.length].heading) < 1e-6 || Math.abs(Math.abs(b.heading - poses[(i + 1) % poses.length].heading) - 2 * Math.PI) < 1e-6);
}
ok('peak turn rate under 25 deg/s on every leg (no fast spins)', worst < 25, worst.toFixed(1) + ' deg/s');
// drift: zero at arrival, small
const d0 = drift(STOPS[0], 0), d1 = drift(STOPS[1], 13, false), dv = drift(STOPS[0], 13, true);
ok('drift starts at zero (arriving never jumps)', Math.hypot(...d0.off) < 1e-9 && d0.yaw === 0);
ok('El Capitan slides along the wall up to ~130 m; VR drift is a slide of at most 8 m, no rotation', Math.hypot(...d1.off) <= 131 && Math.hypot(...dv.off) <= 8.01 && dv.yaw === 0, Math.hypot(...d1.off).toFixed(1));
ok('three POVs: Observation deck (default), Be There, God\'s eye', POVS.map((p) => p[0]).join() === 'deck,bethere,god');
ok('route line sampled', routeLine(10).length === (STOPS.length - 1) * 11 * 3);
// weather
const w = parseWeather([{ current: { temperature_2m: 47.4, weather_code: 2, wind_speed_10m: 6.2, wind_direction_10m: 225, is_day: 1, time: '2026-11-13T10:00' } }, {}]);
ok('weather parsed (F, words, mph, compass)', w[0].tempF === 47 && w[0].text === 'Partly cloudy' && w[0].windMph === 6 && w[0].windDir === 'SW' && w[1] === null);
ok('one Open-Meteo request for every stop', (weatherURL().match(/latitude=([^&]+)/)[1].split(',').length) === STOPS.length);
console.log('durations', durs.join(' '));
console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);

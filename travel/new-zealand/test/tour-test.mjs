// node travel/new-zealand/test/tour-test.mjs   (pure tour maths, stops, facts plumbing, glide comfort)
import { runParkTests } from '../../shared/test/park-test.mjs';
const T = await import('../tour.js');
let fail = await runParkTests(new URL('../', import.meta.url), {
  country: 'New Zealand', org: 'Department of Conservation', iso2: 'nz', durMax: 42, flowMax: 23,   // flow: no worse than Yosemite's legs (22.4 deg/s)
  species: ['kea', 'kekeno', 'bottlenose', 'dusky', 'tawaki', 'takahe', 'kereru'],
  landmarks: [
    ['milford', -44.6329, 167.8562, 1683, 6],           // Mitre Peak (LINZ)
    ['stirling', -44.607889, 167.86675, 75, 6],         // Stirling Falls (NGA GEOnet)
    ['doubtful', -45.27, 166.86, 0, 15],                // the fiord's mouth
    ['aoraki', -43.5950, 170.1418, 3724, 6],
    ['tasman', -43.683, 170.167, 715, 25],              // Tasman Lake (and the glacier beyond)
    ['tekapo', -44.30, 170.40, 3000, 30],               // the southern sky
  ],
});
const ok = (n, c, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (info ? ' (' + info + ')' : '')); if (!c) fail++; };
const tk = T.STOPS.find((s) => s.id === 'tekapo'), H = ((T.stopPose(tk).heading * 180 / Math.PI) + 360) % 360;
ok('Lake Tekapo: a night stop facing the southern horizon, with the XR Australis moment and the Dark Sky Reserve as ORG', tk.night && H > 150 && H < 230 && T.stopPose(tk).pitch > 0 && /XR Australis/.test(tk.moment.s) && /Dark Sky Reserve/.test(tk.org) && T.PARK.nightSky.aurora, H.toFixed(0) + '°');
ok('te reo Māori names alongside English', ['Piopiotahi / Milford Sound', 'Doubtful Sound / Patea', 'Aoraki / Mount Cook', 'Haupapa / Tasman Glacier'].every((n) => T.STOPS.some((s) => s.name === n)));
console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);

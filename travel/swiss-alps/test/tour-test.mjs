// node travel/swiss-alps/test/tour-test.mjs   (pure tour maths, stops, facts plumbing, glide comfort)
import { runParkTests } from '../../shared/test/park-test.mjs';
const fail = await runParkTests(new URL('../', import.meta.url), {
  country: 'Switzerland', org: 'Swiss Alps', iso2: 'ch', durMax: 28, flowMax: 23,   // flow: no worse than Yosemite's legs (22.4 deg/s)
  species: ['ibex', 'chamois', 'marmot', 'golden-eagle', 'bearded-vulture', 'chough'],
  landmarks: [   // [stop, lat, lon, m, tolerance deg]: what each camera is about
    ['oeschinen', 46.4986, 7.7264, 1578, 25], ['oeschinen', 46.4886, 7.7720, 3661, 25],
    ['lauterbrunnen', 46.5897, 7.9055, 1000, 15],
    ['eiger', 46.5776, 8.0053, 3967, 12],
    ['jungfraujoch', 46.5006, 8.0538, 2750, 10],
    ['aletsch', 46.5006, 8.0538, 2750, 25],
    ['zermatt', 45.9763, 7.6586, 4478, 6],
    ['gornergrat', 45.9369, 7.8669, 4634, 20],
  ],
});
console.log(fail ? fail + ' FAILED' : 'ALL PASSED'); process.exit(fail ? 1 : 0);

// I'M HERE Travel Desk · The Swiss Alps: the stops and the page settings. The maths is shared (travel/shared/tour-core.js).
// Pure module (no DOM, no three.js), tested in Node: node travel/swiss-alps/test/tour-test.mjs
//
// World frame: metres, origin on the WGS84 ellipsoid between the Bernese Oberland and Zermatt, x = west, y = up, z = north.
// The stops span 60 km (Lake Oeschinen to Gornergrat), so the tour is curved: every heading and pitch is taken in the local
// horizon at the viewpoint. Elevations: swisstopo (the national survey); viewpoints are set well above the ground around
// them, and every camera looks at a real landmark.
import { createTour, FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt, fmtM } from '../shared/tour-core.js';
export { FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt, fmtM };

export const ORIGIN = { lat: 46.30, lon: 7.85 };   // the middle of the tour, above the Rhône valley near Visp
// EGM96 geoid height in the Swiss Alps is about +50 m (ellipsoid height = height above sea level + 50 m; Google 3D tiles use
// ellipsoid heights). Close enough for camera framing; nothing here is placed on the ground.
export const GEOID_M = 50;

// cam / look: [lat, lon, metres above sea level]. elevM: the place itself (data strip and Details). drift 'pan' (panDeg of
// slow yaw, default 3.5) or 'slide'. haze 0..1. golden: a rendered sunrise / golden-hour grade (labelled in Details); sun: the
// sun's direction for that stop ([west, up, north]). species: field guide ids (guide.js).
export const STOPS = [
  {
    id: 'oeschinen', name: 'Lake Oeschinen', loc: 'Kandersteg, Switzerland', elevM: 1578,
    cam: [46.5040, 7.7150, 2050], look: [46.4950, 7.7400, 1900], drift: 'pan', haze: 0.1,
    caption: 'Lake Oeschinen lies at 1,578 m above Kandersteg, under the cliffs and glaciers of the Blüemlisalp. Streams from the peaks fill it, and it drains away underground through the rock. It is part of the Swiss Alps Jungfrau-Aletsch UNESCO World Heritage Site.',
    species: ['chamois', 'marmot', 'golden-eagle', 'chough'],
  },
  {
    id: 'lauterbrunnen', name: 'Lauterbrunnen Valley', loc: 'Lauterbrunnen, Switzerland', elevM: 795, elevNote: '795 m · Staubbach Falls 297 m',
    cam: [46.6070, 7.9045, 1200], look: [46.5880, 7.9080, 1000], drift: 'pan', haze: 0.12,
    caption: 'Ice Age glaciers carved this U-shaped valley, and its rock walls rise hundreds of metres almost straight up. Staubbach Falls drops 297 m from a hanging valley, much of it in free fall, and turns to spray before it lands. Goethe saw it in 1779, and it inspired his poem "Song of the Spirits over the Waters".',
    species: ['chamois', 'golden-eagle', 'marmot'],
  },
  {
    id: 'eiger', name: 'Eiger North Face', loc: 'Grindelwald, Switzerland', elevM: 3967, elevNote: '3,967 m · face about 1,800 m',
    cam: [46.6120, 7.9930, 2450], look: [46.5820, 8.0040, 2900], drift: 'slide', slideM: 220, haze: 0.08,
    caption: 'The Eiger rises to 3,967 m, and its north face, the Nordwand, drops about 1,800 m toward Grindelwald. Anderl Heckmair, Ludwig Vörg, Heinrich Harrer and Fritz Kasparek made the first climb of the face in July 1938. The Jungfrau Railway runs through a tunnel inside the mountain, finished in 1912.',
    species: ['chough', 'golden-eagle', 'chamois', 'ibex'],
  },
  {
    id: 'jungfraujoch', name: 'Jungfraujoch and the Aletsch Glacier', loc: 'Jungfraujoch, Switzerland', elevM: 3454, elevNote: '3,454 m · Sphinx 3,571 m',
    cam: [46.5440, 7.9880, 3720], look: [46.5000, 8.0540, 3000], drift: 'pan', haze: 0.06,
    caption: 'Jungfraujoch station, at 3,454 m, is the highest railway station in Europe, open since 1912. From this saddle between the Mönch and the Jungfrau, the Aletsch Glacier begins its run south. It is the largest glacier in the Alps: about 22.6 km long, with ice more than 900 m thick at Konkordiaplatz.',
    species: ['chough', 'ibex', 'golden-eagle'],
  },
  {
    id: 'aletsch', name: 'The Aletsch from above', loc: 'Fiesch, Switzerland', elevM: 2927, elevNote: 'Eggishorn 2,927 m · glacier about 22.6 km',
    cam: [46.4300, 8.0900, 3900], look: [46.4800, 8.0450, 2800], drift: 'pan', haze: 0.08,
    caption: 'From high above the Eggishorn, the Aletsch Glacier sweeps down from Konkordiaplatz, where three great ice streams meet. The dark stripes along it are medial moraines: rock carried down where the streams join. The glacier has been shrinking since the mid-1800s and loses tens of metres of length most years.',
    species: ['bearded-vulture', 'golden-eagle', 'chamois', 'chough'],
  },
  {
    id: 'zermatt', name: 'Zermatt and the Matterhorn at sunrise', loc: 'Zermatt, Switzerland', elevM: 1608, elevNote: 'Zermatt 1,608 m · Matterhorn 4,478 m',
    cam: [46.0195, 7.7470, 2000], look: [45.9800, 7.6650, 3800], drift: 'pan', haze: 0.1, golden: true, goldenWords: 'Sunrise', sun: [-0.9, 0.18, -0.15],
    caption: 'At sunrise the Matterhorn catches the first light and glows above Zermatt while the village is still in shadow. The 4,478 m peak was first climbed on 14 July 1865 by Edward Whymper\'s party of seven; four of them died on the way down. Zermatt keeps out ordinary cars, so most visitors arrive by train.',
    species: ['ibex', 'marmot', 'chough', 'bearded-vulture'],
  },
  {
    id: 'gornergrat', name: 'Gornergrat panorama', loc: 'Zermatt, Switzerland', elevM: 3089, elevNote: '3,089 m · Monte Rosa 4,634 m',
    cam: [45.9835, 7.7855, 3300], look: [45.9450, 7.8350, 3600], drift: 'pan', panDeg: 18, haze: 0.06,
    caption: 'The Gornergrat Railway, open since 1898, climbs from Zermatt to 3,089 m, the highest open-air cog railway in Europe. Below the ridge, the Gorner Glacier flows from Monte Rosa, whose Dufourspitze (4,634 m) is the highest summit in Switzerland. On a clear day 29 peaks of 4,000 m or more stand around this ridge.',
    species: ['ibex', 'marmot', 'chough', 'golden-eagle'],
  },
];
export const HOLD_S = 25;   // auto-play: seconds at each stop

const K = createTour({ ORIGIN, GEOID_M, STOPS, curved: true, holdS: HOLD_S, glide: { liftMax: 18000, durMax: 28 }, weather: { timezone: 'Europe/Zurich', metric: true } });
export const { FRAME, toLocal, fromLocal, basisAt, stopPose, povPose, drift, legLift, legDuration, makeLeg, legPose, legPeakTurnRate, legPeakFlow, routeLine,
  weatherURL, parseWeather, fetchWeather } = K;
export const CURVED = true;

export const PARK = {
  id: 'swiss-alps', name: 'The Swiss Alps', short: 'Swiss Alps', guideTitle: 'SWISS ALPS', log: 'swiss-alps',
  units: 'metric', timezone: 'Europe/Zurich', tzLocale: 'en-GB',
  flag: { iso2: 'ch', name: 'Switzerland' }, type: 'Mountain range', org: 'Swiss Alps',
  icon: { d: 'M4 54 H116 M8 54 L30 24 L40 34 L58 8 L76 32 L84 24 L112 54 M52 16 L58 8 L64 17', w: 120, h: 60 },
  storageKey: 'imhere.travel',
  sun: [0.45, 0.6, -0.66],   // x = west: afternoon sun from the south-west
  hazeTopM: 3200,
  terrainN: [300, 240],
  about: '<p><b>The Swiss Alps</b>, aboard XR Aurora (IH-0000). Seven stops, from Lake Oeschinen and the Jungfrau region to Zermatt and the Matterhorn.</p>' +
    '<p>Screens: the tour glides between stops; drag to look around. Arrow keys: previous / next; space: auto-play. In VR the view blinks between stops; point and select.</p>' +
    '<p>Scenery: Google Photorealistic 3D Tiles (on the GitHub site), otherwise a rendered approximation. Weather: Open-Meteo, live. Elevations: swisstopo.</p>',
  notes: ['The Matterhorn at sunrise is a rendered grade over the daytime imagery.',
    'TODO webcams: Jungfraujoch, Zermatt and Gornergrat webcams not added; their image URLs could not be verified from the build sandbox.'],
  credits: [{ text: 'Elevations: swisstopo', href: 'https://www.swisstopo.admin.ch/' }, { text: 'Jungfrau-Aletsch World Heritage', href: 'https://whc.unesco.org/en/list/1037' }],
};

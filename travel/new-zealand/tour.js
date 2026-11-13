// I'M HERE Travel Desk · New Zealand: Fiordland and the Southern Alps. The stops and the page settings; the maths is shared
// (travel/shared/tour-core.js). Pure module (no DOM, no three.js), tested in Node: node travel/new-zealand/test/tour-test.mjs
//
// World frame: metres, origin on the WGS84 ellipsoid over the middle of the South Island's south-west, x = west, y = up,
// z = north. The stops span 330 km (Doubtful Sound to Lake Tekapo), so the tour is curved: every heading and pitch is taken in
// the local horizon at the viewpoint, and the long legs rise high (up to about 55 km) so the land never streams past fast.
// Te reo Māori names sit alongside English where they are the official names (Aoraki / Mount Cook, Piopiotahi / Milford
// Sound, Doubtful Sound / Patea, Haupapa / Tasman Glacier). Elevations: LINZ; facts: DOC and the sources in the credits.
import { createTour, FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt, fmtM } from '../shared/tour-core.js';
export { FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt, fmtM };

export const ORIGIN = { lat: -44.50, lon: 168.75 };
// EGM96 geoid height over the southern South Island is roughly +10 m (ellipsoid height = height above sea level + 10 m).
// Close enough for camera framing; nothing here is placed on the ground.
export const GEOID_M = 10;

// cam / look: [lat, lon, metres above sea level]. elevM: the place itself (weather is asked for at this height); elevShort:
// the words for the data strip when a number would mislead (sea level). night: a rendered night grade with stars and the
// aurora australis (labelled in Details). moment: a title shown once on arrival (screens). org: overrides the card's ORG.
export const STOPS = [
  {
    id: 'milford', name: 'Piopiotahi / Milford Sound', loc: 'Milford Sound, New Zealand', elevM: 0, elevShort: 'Sea level', elevNote: 'Sea level · Mitre Peak 1,683 m',
    cam: [-44.6580, 167.9100, 300], look: [-44.6340, 167.8580, 1200], drift: 'pan', haze: 0.16,
    caption: 'Piopiotahi / Milford Sound reaches about 15 km in from the Tasman Sea: a valley carved by glaciers, then flooded by the sea. Mitre Peak rises 1,683 m almost straight out of the water. With about 6.4 m of rain a year it is the wettest inhabited place in New Zealand, and after heavy rain hundreds of waterfalls pour off the walls.',
    species: ['tawaki', 'kekeno', 'bottlenose', 'kea', 'kereru'],
  },
  {
    id: 'stirling', name: 'Stirling Falls', loc: 'Milford Sound, New Zealand', elevM: 0, elevShort: 'Sea level', elevNote: 'Sea level · falls 151 m',
    cam: [-44.6125, 167.8610, 160], look: [-44.6079, 167.8668, 80], drift: 'slide', slideM: 120, haze: 0.14,
    caption: 'Stirling Falls drops 151 m from a hanging valley straight into the sea. Boats nose in close enough for the spray to soak the deck. Fur seals (kekeno) often rest on the rocks along this shore, and dolphins sometimes ride the bow waves.',
    species: ['kekeno', 'bottlenose', 'dusky', 'tawaki'],
  },
  {
    id: 'doubtful', name: 'Doubtful Sound / Patea', loc: 'Doubtful Sound, New Zealand', elevM: 0, elevShort: 'Sea level', elevNote: 'Sea level · up to 421 m deep',
    cam: [-45.3170, 166.9830, 1300], look: [-45.2700, 166.8800, 300], drift: 'pan', haze: 0.18,
    caption: 'Doubtful Sound / Patea is about 40 km long and up to 421 m deep, the deepest of the South Island\'s fiords. Captain Cook named it Doubtful Harbour in 1770, unsure he could sail back out if he went in. A small pod of about 70 bottlenose dolphins lives here year-round, closely watched by scientists.',
    species: ['bottlenose', 'tawaki', 'kekeno', 'dusky', 'takahe', 'kereru'],
  },
  {
    id: 'aoraki', name: 'Aoraki / Mount Cook', loc: 'Aoraki / Mount Cook, New Zealand', elevM: 3724,
    cam: [-43.7050, 170.0980, 1700], look: [-43.6000, 170.1380, 3000], drift: 'pan', haze: 0.08,
    caption: 'Aoraki / Mount Cook, 3,724 m, is the highest mountain in New Zealand and, to Ngāi Tahu, the most sacred of their ancestors. In 1991 a huge rock avalanche took about 10 m off the summit, and a 2014 survey measured it lower again after its ice cap thinned. Edmund Hillary trained on these slopes before Everest.',
    species: ['kea'],
  },
  {
    id: 'tasman', name: 'Haupapa / Tasman Glacier', loc: 'Aoraki / Mount Cook, New Zealand', elevM: 715, elevNote: 'Tasman Lake 715 m · glacier about 23.5 km',
    cam: [-43.7080, 170.1700, 1250], look: [-43.6200, 170.1950, 1100], drift: 'pan', haze: 0.08,
    caption: 'Haupapa / Tasman Glacier is New Zealand\'s longest glacier, about 23.5 km, down from 28 km through most of the 20th century. In the early 1970s there was no lake at its foot; meltwater ponds joined into Tasman Lake by 1990, and it keeps growing as the ice melts back. Icebergs break off the glacier face and drift across the lake.',
    species: ['kea'],
  },
  {
    id: 'tekapo', name: 'Lake Tekapo under the stars', loc: 'Lake Tekapo, New Zealand', elevM: 710, elevNote: 'Lake about 710 m · Mount John 1,029 m',
    cam: [-43.9750, 170.5150, 950], look: [-44.0800, 170.4300, 2800], drift: 'pan', panDeg: 6, haze: 0.05, night: true,
    org: 'Aoraki Mackenzie International Dark Sky Reserve',
    moment: { k: 'THE SOUTHERN LIGHTS', t: 'Aurora australis', s: 'The namesake of XR Australis · IH-0001' },
    caption: 'Lake Tekapo (Takapō) lies inside the Aoraki Mackenzie International Dark Sky Reserve, designated in 2012 and, at 4,367 km², the largest in the world at the time. Outdoor lighting is kept low, so the Milky Way and the Magellanic Clouds shine sharply, and the University of Canterbury\'s observatory stands on Mount John above the lake. On nights of strong solar activity the aurora australis, the southern lights, can glow low over the southern horizon.',
    species: ['kaki'],
  },
];
export const HOLD_S = 25;   // auto-play: seconds at each stop

const K = createTour({ ORIGIN, GEOID_M, STOPS, curved: true, holdS: HOLD_S, glide: { liftMax: 75000, durMax: 42 }, weather: { timezone: 'Pacific/Auckland', metric: true } });
export const { FRAME, toLocal, fromLocal, basisAt, stopPose, povPose, drift, legLift, legDuration, makeLeg, legPose, legPeakTurnRate, legPeakFlow, routeLine,
  weatherURL, parseWeather, fetchWeather } = K;
export const CURVED = true;

export const PARK = {
  id: 'new-zealand', name: 'Fiordland and the Southern Alps', short: 'New Zealand', guideTitle: 'NEW ZEALAND', log: 'new-zealand',
  units: 'metric', timezone: 'Pacific/Auckland', tzLocale: 'en-NZ',
  flag: { iso2: 'nz', name: 'New Zealand' }, type: 'National parks', org: 'Department of Conservation',
  icon: { d: 'M4 54 H116 M6 54 L26 20 L36 32 L52 10 L70 36 L80 28 L114 54 M14 54 Q40 46 60 50 T112 50', w: 120, h: 60 },
  storageKey: 'imhere.travel',
  sun: [-0.75, 0.55, 0.13],   // x = west, z = north: a mid-morning sun from the east-north-east (out of every stop's view)
  hazeTopM: 3000,
  nightSky: { aurora: true },
  terrainN: [300, 240],
  about: '<p><b>Fiordland and the Southern Alps</b>, aboard XR Aurora (IH-0000). Six stops: Milford Sound, Stirling Falls, Doubtful Sound, Aoraki / Mount Cook, the Tasman Glacier and Lake Tekapo at night.</p>' +
    '<p>Screens: the tour glides between stops, climbing high on the long legs across the island; drag to look around. Arrow keys: previous / next; space: auto-play. In VR the view blinks between stops; point and select.</p>' +
    '<p>Scenery: Google Photorealistic 3D Tiles (on the GitHub site), otherwise a rendered approximation. Weather: Open-Meteo, live. Facts: Department of Conservation, LINZ.</p>',
  notes: ['Lake Tekapo at night: the dark sky, stars and southern lights are rendered by I\'M HERE over the daytime imagery; the real aurora shows only on some nights.',
    'TODO webcams: Milford Sound and Aoraki / Mount Cook webcams not added; their image URLs could not be verified from the build sandbox.'],
  credits: [{ text: 'Facts: Department of Conservation', href: 'https://www.doc.govt.nz/' }, { text: 'Elevations: LINZ', href: 'https://www.linz.govt.nz/' },
    { text: 'Aoraki Mackenzie Dark Sky Reserve', href: 'https://www.darkskyreserve.org.nz/' }],
};

// I'M HERE Travel Desk · Yosemite tour: the stops and the park's page settings. The maths (frame, poses, glide, drift,
// route, weather) is shared by every park: travel/shared/tour-core.js. Pure module (no DOM, no three.js), tested in Node:
// node travel/yosemite/test/tour-test.mjs
//
// World frame (same convention as 737/google-scenery.js): metres, origin on the WGS84 ellipsoid under Yosemite Valley,
// x = west, y = up, z = north. Positions come from latitude / longitude / altitude through ECEF, so earth curvature is exact
// across the park (Mariposa Grove is 27 km from the origin, Tioga Pass 33 km).
import { createTour, FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt } from '../shared/tour-core.js';
export { FT, ecefFromLLH, localFrameMatrix, applyMatrix, mPerDegLat, mPerDegLon, clamp, smoother, angleBetween, POVS, POV_FRAMED, wmoText, fmtFt };

export const ORIGIN = { lat: 37.7456, lon: -119.5936 };   // Yosemite Valley (near the Village)
// EGM96 geoid height in the park is about -32 m: ellipsoid height = height above sea level - 32 m (Google 3D tiles use
// ellipsoid heights). Close enough for camera framing; nothing here is placed on the ground.
export const GEOID_M = -32;

// ------------------------------------------------------------------------------------------------------------- stops
// cam / look: [lat, lon, metres above sea level]. elevFt: the place itself (what the data strip and Details show).
// drift: how the still viewpoint breathes while you are there: 'pan' (a few degrees of slow yaw) or 'slide' (a slow sideways
// dolly, e.g. along the El Capitan wall). haze: 0..1 (Mariposa Grove: Google 3D trees are rough, so they sit in haze).
// golden: the scene is tinted for golden hour (a rendered grade over the imagery; labelled in Details).
// species: field guide ids (guide.js). Facts are from the National Park Service unless noted.
export const STOPS = [
  {
    id: 'tunnel', name: 'Tunnel View', loc: 'Yosemite Valley, CA', elevFt: 4407,
    cam: [37.7165, -119.6745, 1420], look: [37.7440, -119.5420, 1250], drift: 'pan', haze: 0.12,
    caption: 'Tunnel View sits at the east end of the Wawona Tunnel, finished in 1933. El Capitan stands on the left, Bridalveil Fall on the right, and Half Dome at the far end of the valley. Ice Age glaciers deepened and widened the valley the Merced River had cut.',
    species: ['fence-lizard', 'stellers-jay', 'mule-deer', 'black-bear', 'peregrine'],
  },
  {
    id: 'elcap', name: 'El Capitan', loc: 'Yosemite Valley, CA', elevFt: 7573,
    cam: [37.7228, -119.6418, 1660], look: [37.7322, -119.6372, 1760], drift: 'slide', slideM: 260, haze: 0.08,
    caption: 'El Capitan rises about 3,000 feet above the valley floor, one of the largest exposed granite monoliths in the world. Climbers usually spend several days on its big-wall routes, such as The Nose, first climbed in 1958. Peregrine falcons nest on its cliffs, and the park closes some routes while they do.',
    species: ['peregrine', 'stellers-jay', 'mule-deer', 'black-bear'],
  },
  {
    id: 'falls', name: 'Yosemite Falls', loc: 'Yosemite Valley, CA', elevFt: 6526,
    cam: [37.7425, -119.5918, 1460], look: [37.7535, -119.5965, 1640], drift: 'pan', haze: 0.1,
    caption: 'Yosemite Falls drops 2,425 feet in three parts: Upper Fall, the middle cascades and Lower Fall. It is among the tallest waterfalls in North America. Snowmelt makes it roar in May and June; by late summer it often runs dry until the winter storms.',
    species: ['mule-deer', 'black-bear', 'stellers-jay', 'fence-lizard'],
  },
  {
    id: 'taft', name: 'Taft Point', loc: 'Yosemite Valley, CA', elevFt: 7503,
    cam: [37.7150, -119.6050, 2340], look: [37.7420, -119.6186, 1700], drift: 'pan', haze: 0.12,
    caption: 'Taft Point stands on the south rim at about 7,500 feet, some 3,000 feet above the valley floor. Deep fissures split the granite near the edge. Across the valley are El Capitan and Yosemite Falls.',
    species: ['peregrine', 'fence-lizard', 'stellers-jay'],
  },
  {
    id: 'glacier', name: 'Glacier Point', loc: 'Yosemite Valley, CA', elevFt: 7214, golden: true,
    cam: [37.7315, -119.5728, 2250], look: [37.7459, -119.5332, 2330], drift: 'pan', haze: 0.18,
    caption: 'Glacier Point is 7,214 feet high, about 3,200 feet above Curry Village on the valley floor. Half Dome rises to 8,839 feet and takes the warm light late in the day. To its right, Vernal and Nevada Falls step down the Merced River.',
    species: ['peregrine', 'stellers-jay', 'black-bear', 'fence-lizard'],
  },
  {
    id: 'mariposa', name: 'Mariposa Grove', loc: 'Wawona, CA', elevFt: 5600, elevNote: '5,600–6,600 ft',
    cam: [37.4985, -119.6135, 2010], look: [37.5075, -119.5985, 1760], drift: 'pan', haze: 0.6,
    caption: 'Mariposa Grove is the largest grove of giant sequoias in Yosemite, with more than 500 mature trees. In 1864 President Lincoln signed the Yosemite Grant, which protected this grove and Yosemite Valley. The Grizzly Giant, one of its oldest trees, stands in the lower grove.',
    note: 'Google 3D shows these trees only as rough shapes, so the grove is seen from above, through haze.',
    species: ['sequoia', 'black-bear', 'stellers-jay', 'mule-deer'],
  },
  {
    id: 'tuolumne', name: 'Tuolumne Meadows', loc: 'Tuolumne Meadows, CA', elevFt: 8600, elevNote: '8,600 ft · Tioga Pass 9,943 ft',
    cam: [37.8728, -119.3905, 2900], look: [37.8998, -119.2209, 2300], drift: 'pan', haze: 0.1,
    caption: 'Tuolumne Meadows, at about 8,600 feet, is one of the largest subalpine meadows in the Sierra Nevada. The Tioga Road climbs east to Tioga Pass at 9,943 feet, the highest highway pass in California; it usually closes for snow from November until late spring. Endangered Sierra Nevada bighorn sheep live on the crest beyond.',
    species: ['bighorn', 'pika', 'mule-deer', 'black-bear'],
  },
];
export const HOLD_S = 25;   // auto-play: seconds at each stop

const K = createTour({ ORIGIN, GEOID_M, STOPS, curved: false, holdS: HOLD_S, weather: { timezone: 'America/Los_Angeles', metric: false } });
export const { FRAME, toLocal, fromLocal, basisAt, stopPose, povPose, drift, legLift, legDuration, makeLeg, legPose, legPeakTurnRate, legPeakFlow, routeLine,
  weatherURL, parseWeather, fetchWeather } = K;
export const CURVED = false;

// The page (travel/shared/tour-page.js) reads the park's own words and settings from here.
export const PARK = {
  id: 'yosemite', name: 'Yosemite National Park', short: 'Yosemite', guideTitle: 'YOSEMITE', log: 'yosemite',
  units: 'imperial', tzLabel: 'PT', timezone: 'America/Los_Angeles',
  flag: { iso2: 'us', name: 'USA' }, type: 'National park', org: 'National Park Service',
  icon: { d: 'M4 54 H116 M10 54 L34 30 L44 38 L62 14 Q80 6 86 26 L86 54 M86 30 L100 40 L112 54', w: 120, h: 60 },
  storageKey: 'imhere.travel',
  sun: [0.5, 0.55, -0.66],   // x = west: afternoon sun from the south-west
  terrainN: [320, 256],
  about: '<p><b>Yosemite National Park</b>, aboard XR Aurora (IH-0000). Seven stops, from Tunnel View to the high country.</p>' +
    '<p>Screens: the tour glides between stops; drag to look around. Arrow keys: previous / next; space: auto-play. In VR the view blinks between stops; point and select.</p>' +
    '<p>Scenery: Google Photorealistic 3D Tiles (on the GitHub site), otherwise a rendered approximation. Weather: Open-Meteo, live. Facts: National Park Service.</p>',
  notes: ['TODO webcams: NPS Yosemite webcams (Yosemite Falls, Half Dome, Tuolumne Meadows…) not added; their image URLs could not be verified from the build sandbox.'],
  credits: [{ text: 'Facts: National Park Service', href: 'https://www.nps.gov/yose/' }],
};

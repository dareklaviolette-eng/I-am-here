// I'M HERE Travel Desk · Yosemite tour: the stops, the geography and the camera path. Pure module (no DOM, no three.js),
// tested in Node: node travel/yosemite/test/tour-test.mjs
//
// World frame (same convention as 737/google-scenery.js): metres, origin on the WGS84 ellipsoid under Yosemite Valley,
// x = west, y = up, z = north. Positions come from latitude / longitude / altitude through ECEF, so earth curvature is exact
// across the park (Mariposa Grove is 27 km from the origin, Tioga Pass 33 km).

const D2R = Math.PI / 180;
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);

export const ORIGIN = { lat: 37.7456, lon: -119.5936 };   // Yosemite Valley (near the Village)
// EGM96 geoid height in the park is about -32 m: ellipsoid height = height above sea level - 32 m (Google 3D tiles use
// ellipsoid heights). Close enough for camera framing; nothing here is placed on the ground.
export const GEOID_M = -32;
export const FT = 0.3048;

export function ecefFromLLH(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p);
  const N = WGS_A / Math.sqrt(1 - WGS_E2 * sp * sp);
  return [(N + h) * cp * Math.cos(l), (N + h) * cp * Math.sin(l), (N * (1 - WGS_E2) + h) * sp];
}
// Column-major 4x4 (THREE.Matrix4.fromArray) taking ECEF metres to the local frame at (lat, lon, h).
export function localFrameMatrix(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const E = [-sl, cl, 0], Nn = [-sp * cl, -sp * sl, cp], U = [cp * cl, cp * sl, sp];
  const rows = [E.map((v) => -v), U, Nn];
  const P0 = ecefFromLLH(latDeg, lonDeg, h);
  const t = rows.map((r) => -(r[0] * P0[0] + r[1] * P0[1] + r[2] * P0[2]));
  return [rows[0][0], rows[1][0], rows[2][0], 0, rows[0][1], rows[1][1], rows[2][1], 0, rows[0][2], rows[1][2], rows[2][2], 0, t[0], t[1], t[2], 1];
}
export function applyMatrix(m, v) { return [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]); }
export const FRAME = localFrameMatrix(ORIGIN.lat, ORIGIN.lon, 0);
// latitude, longitude, metres above sea level -> [x, y, z] in the world frame
export function toLocal(lat, lon, altMsl) { return applyMatrix(FRAME, ecefFromLLH(lat, lon, altMsl + GEOID_M)); }
// and back (small-area approximation, good to a few metres here; used for weather, planes and the card)
export function mPerDegLat(lat) { const p = lat * D2R; return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p); }
export function mPerDegLon(lat) { const p = lat * D2R; return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p); }
export function fromLocal(x, y, z) {
  const kl = mPerDegLat(ORIGIN.lat), ko = mPerDegLon(ORIGIN.lat);
  let lat = ORIGIN.lat + z / kl, lon = ORIGIN.lon - x / ko, alt = y + (x * x + z * z) / (2 * 6371008.8);
  for (let i = 0; i < 2; i++) {   // two corrections through the exact forward transform: well under a metre
    const p = toLocal(lat, lon, alt); lat += (z - p[2]) / kl; lon -= (x - p[0]) / ko; alt += y - p[1];
  }
  return { lat, lon, altMsl: alt };
}

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

// ------------------------------------------------------------------------------------------------------- vectors
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };   // smootherstep: 0 speed at both ends

// A stop's camera: position, look target, heading (rad, 0 = north, + = east) and pitch (rad, + = up)
export function stopPose(s) {
  const pos = toLocal(...s.cam), look = toLocal(...s.look), d = sub(look, pos);
  return { pos, look, heading: Math.atan2(-d[0], d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), dist: len(d) };
}
// The tour views, aboard XR Aurora (IH-0000). Observation deck = the stop's own viewpoint seen from the craft's glass deck
// (the host draws the frame: aurora-placeholder.js now, shared/aurora/ later). Be There = the same viewpoint with no frame.
// God's eye = high above the scene, looking steeply down, with the viewpoint's direction still "forward" (up the screen).
// ('chase' is kept for hosts that want it: behind and above the tour point, looking along the route.)
export const POVS = [['deck', 'Observation deck'], ['bethere', 'Be There'], ['god', "God's eye"]];
export const POV_FRAMED = { deck: true, bethere: false, god: false };
export function povPose(s, pov) {
  const P = stopPose(s);
  if (pov === 'god') {
    const c = [(P.pos[0] + P.look[0]) / 2, Math.max(P.pos[1], P.look[1]), (P.pos[2] + P.look[2]) / 2];
    const up = clamp(P.dist * 1.2, 3000, 7000);
    const pitch = -72 * D2R, back = up / Math.tan(-pitch);   // a little behind the centre so the scene sits mid-screen
    return { pos: [c[0] + Math.sin(P.heading) * back, c[1] + up, c[2] - Math.cos(P.heading) * back], heading: P.heading, pitch };
  }
  if (pov === 'chase') {
    const back = 420, upM = 160;
    return { pos: [P.pos[0] + Math.sin(P.heading) * back, P.pos[1] + upM, P.pos[2] - Math.cos(P.heading) * back], heading: P.heading, pitch: Math.min(P.pitch, 0) - 6 * D2R };
  }
  return { pos: P.pos, heading: P.heading, pitch: P.pitch };
}

// The breathing at a stop (t seconds since arrival): an offset in metres and a yaw in radians. Slow (periods of ~50 s),
// small, and zero at t = 0 so arriving never jumps. VR uses only a gentle sideways slide (never a rotation).
export function drift(s, t, vr = false) {
  const w = 2 * Math.PI / 52, ramp = smoother(t / 6), sn = Math.sin(w * t) * ramp;
  const H = stopPose(s).heading, side = [-Math.cos(H), 0, -Math.sin(H)];   // world vector to the right of the heading (x = west)
  if (vr) { const a = 8 * sn; return { off: [side[0] * a, 0, side[2] * a], yaw: 0 }; }
  if (s.drift === 'slide') { const a = (s.slideM || 200) / 2 * sn; return { off: [side[0] * a, 0, side[2] * a], yaw: 0 }; }
  return { off: [0, 6 * sn, 0], yaw: 3.5 * D2R * sn };
}

// ---------------------------------------------------------------------------------------------------- the glide
// From one pose to the next: a cubic Bezier that rises over long legs (so the ground never streams past fast and nothing
// high is in the way), with an eased clock (smootherstep). Duration 10-20 s from distance and turn.
export function legLift(dist) { return dist > 6000 ? Math.min(dist * 0.35, 14000) : dist * 0.2 + 100; }
export function angleBetween(h0, h1) { let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
export function legDuration(a, b) {
  const dist = len(sub(b.pos, a.pos)), turn = Math.abs(angleBetween(a.heading, b.heading)) / D2R + Math.abs(b.pitch - a.pitch) / D2R;
  return clamp(10 + dist / 4000 + turn / 20, 10, 20);
}
export function makeLeg(a, b) {
  const dist = len(sub(b.pos, a.pos)), lift = legLift(dist), k = 0.22;
  const d = sub(b.pos, a.pos);
  const p1 = [a.pos[0] + d[0] * k, a.pos[1] + lift, a.pos[2] + d[2] * k], p2 = [b.pos[0] - d[0] * k, b.pos[1] + lift, b.pos[2] - d[2] * k];
  return { a, b, p1, p2, dist, lift, dur: legDuration(a, b), dh: angleBetween(a.heading, b.heading) };
}
// Pose at u in [0, 1] of the leg's time. Writes into out { pos, heading, pitch } (no allocations).
export function legPose(L, u, out) {
  const t = smoother(u), s = 1 - t, A = L.a.pos, B = L.b.pos;
  const c0 = s * s * s, c1 = 3 * s * s * t, c2 = 3 * s * t * t, c3 = t * t * t;
  for (let i = 0; i < 3; i++) out.pos[i] = c0 * A[i] + c1 * L.p1[i] + c2 * L.p2[i] + c3 * B[i];
  // turn: the heading takes the short way round; over high legs the view also tips down toward the land (and back)
  const tt = smoother(clamp((u - 0.08) / 0.84, 0, 1));
  out.heading = L.a.heading + L.dh * tt;
  const dip = Math.sin(Math.PI * t) * clamp(L.lift / 5000, 0, 1) * 30 * D2R;
  out.pitch = L.a.pitch + (L.b.pitch - L.a.pitch) * tt - dip;
  return out;
}
// Fastest angular rate on a leg (deg/s), for the comfort test: sampled.
export function legPeakTurnRate(L, n = 400) {
  const o = { pos: [0, 0, 0] }, p = { pos: [0, 0, 0] }; let best = 0;
  for (let i = 1; i <= n; i++) {
    legPose(L, (i - 1) / n, p); const h0 = p.heading, q0 = p.pitch; legPose(L, i / n, o);
    const r = Math.hypot(angleBetween(h0, o.heading), o.pitch - q0) / D2R / (L.dur / n); if (r > best) best = r;
  }
  return best;
}

// The route drawn in God's eye / Chase: every leg sampled (stop i -> i + 1), as flat [x, y, z, ...] arrays
export function routeLine(n = 40) {
  const out = [];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const L = makeLeg(povPose(STOPS[i], 'deck'), povPose(STOPS[i + 1], 'deck')), o = { pos: [0, 0, 0] };
    for (let j = 0; j <= n; j++) { legPose(L, j / n, o); out.push(o.pos[0], o.pos[1], o.pos[2]); }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- weather
// fetchWeather(fetchFn?) -> Promise<[{ tempF, text, windMph, windDir, isDay, time } | null] in stop order>
export async function fetchWeather(fetchFn = (u, o) => fetch(u, o), { timeoutMs = 12000 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  try {
    const r = await fetchFn(weatherURL(), ctl ? { signal: ctl.signal } : {});
    if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
    return parseWeather(await r.json());
  } finally { clearTimeout(tm); }
}
// Open-Meteo (free, no key, CORS): current conditions for every stop in one request, at each stop's own elevation.
export function weatherURL(stops = STOPS) {
  const f = (k) => stops.map(k).join(',');
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + f((s) => s.cam[0].toFixed(4)) + '&longitude=' + f((s) => s.cam[1].toFixed(4)) +
    '&elevation=' + f((s) => Math.round(s.elevFt * FT)) +
    '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles';
}
const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
  75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
export const wmoText = (c) => WMO[c] || (Number.isFinite(c) ? 'Code ' + c : '');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Open-Meteo answer (one object, or an array for several places) -> [{ tempF, text, windMph, windDir, isDay, time }] in stop order
export function parseWeather(j) {
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((x) => {
    const c = x && x.current; if (!c) return null;
    return { tempF: Math.round(c.temperature_2m), text: wmoText(c.weather_code), code: c.weather_code, windMph: Math.round(c.wind_speed_10m),
      windDir: Number.isFinite(c.wind_direction_10m) ? COMPASS[Math.round(c.wind_direction_10m / 45) % 8] : '', isDay: !!c.is_day, time: c.time || '' };
  });
}
export const fmtFt = (n) => Math.round(n).toLocaleString('en-US') + ' ft';

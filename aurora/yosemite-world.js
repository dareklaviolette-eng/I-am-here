// A small Yosemite world for the XR Aurora demo (the WORLD interface in shared/aurora/aurora.js). Used when
// travel/yosemite/tour.js is not on the site, or does not offer what Aurora needs. Facts: National Park Service.
// Scene frame: metres, x = west, y = up (ellipsoid height), z = north, origin on the ellipsoid in Yosemite Valley.
import { ecefFromLLH, localFrameMatrix, applyMatrix } from '../737/google-scenery.js';

export const ORIGIN = { lat: 37.7456, lon: -119.5936 };
export const GEOID_M = -32;   // EGM96 geoid height in the park: ellipsoid height = metres above sea level - 32
const FRAME = localFrameMatrix(ORIGIN.lat, ORIGIN.lon, 0);
export const toLocal = (lat, lon, altMsl) => applyMatrix(FRAME, ecefFromLLH(lat, lon, altMsl + GEOID_M));

export const STOPS = [
  { name: 'Tunnel View', lat: 37.7163, lon: -119.6758, alt: 1480, heading: 74, loc: 'Yosemite Valley, CA',
    caption: 'From the east end of the Wawona Tunnel: El Capitan on the left, Bridalveil Fall on the right and Half Dome at the far end of the valley. Glaciers deepened and widened the valley the Merced River had cut.' },
  { name: 'El Capitan', lat: 37.7262, lon: -119.6480, alt: 1560, heading: 38, loc: 'Yosemite Valley, CA',
    caption: 'El Capitan rises about 3,000 feet from the valley floor, one of the largest exposed granite monoliths in the world.' },
  { name: 'Yosemite Falls', lat: 37.7430, lon: -119.6010, alt: 1640, heading: 8, loc: 'Yosemite Valley, CA',
    caption: 'Yosemite Falls drops 2,425 feet in three sections, among the tallest waterfalls in North America. It runs strongest in late spring.' },
  { name: 'Half Dome', lat: 37.7385, lon: -119.5620, alt: 2150, heading: 72, loc: 'Yosemite Valley, CA',
    caption: 'Half Dome rises nearly 4,800 feet above the valley floor to 8,839 feet. Its sheer northwest face was shaped by glaciers and the granite cracking along vertical joints.' },
];
// the valley's centre line (for the fallback terrain) and the domes it should show
export const AXIS = [[37.712, -119.735], [37.7175, -119.665], [37.7225, -119.632], [37.733, -119.605], [37.741, -119.575], [37.744, -119.548], [37.738, -119.515]]
  .map(([la, lo]) => { const p = toLocal(la, lo, 1200); return [p[0], p[2]]; });
export const DOMES = [[37.7459, -119.5332, 2694, 900], [37.7340, -119.6377, 2307, 700]].map(([la, lo, h, r]) => { const p = toLocal(la, lo, h); return [p[0], p[2], h + GEOID_M, r]; });

const smoother = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
const angDiff = (a, b) => { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

export function createYosemiteWorld(stops = STOPS) {
  const P = stops.map((s) => toLocal(s.lat, s.lon, s.alt));
  const pose = { x: P[0][0], y: P[0][1], z: P[0][2], heading: stops[0].heading, moving: false };
  let leg = null;
  const W = {
    name: 'Yosemite', origin: ORIGIN, stops, index: 0, toLocal,
    start() { leg = null; W.index = 0; Object.assign(pose, { x: P[0][0], y: P[0][1], z: P[0][2], heading: stops[0].heading, moving: false }); },
    go(i) {
      i = ((i % stops.length) + stops.length) % stops.length; if (i === W.index && !leg) return;
      const a = [pose.x, pose.y, pose.z], b = P[i], d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      leg = { a, b, h0: pose.heading, dh: angDiff(pose.heading, stops[i].heading), t: 0, T: Math.max(10, Math.min(28, d / 160)), lift: Math.min(500, d * 0.12) };
      W.index = i;
    },
    next() { W.go(W.index + 1); }, prev() { W.go(W.index - 1); },
    update(dt) {
      if (!leg) { pose.moving = false; return pose; }
      leg.t += dt; const u = smoother(leg.t / leg.T), s = Math.sin(Math.PI * Math.min(1, leg.t / leg.T));
      pose.x = leg.a[0] + (leg.b[0] - leg.a[0]) * u; pose.z = leg.a[2] + (leg.b[2] - leg.a[2]) * u; pose.y = leg.a[1] + (leg.b[1] - leg.a[1]) * u + leg.lift * s;
      pose.heading = leg.h0 + leg.dh * u; pose.moving = true;
      if (leg.t >= leg.T) leg = null;
      return pose;
    },
    mapPoints() { return stops.map((s, i) => ({ name: s.name, x: P[i][0], z: P[i][2] })); },
    altMsl() { return pose.y - GEOID_M; },
  };
  return W;
}

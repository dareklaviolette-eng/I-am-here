// I'M HERE Travel Desk · Yosemite: the FALLBACK terrain, drawn when Google Photorealistic 3D Tiles cannot load (off the
// GitHub site where the key is accepted, offline, a refused key). It is a rendered approximation, labelled as such on the
// card: heights from about 40 known places (summits, rims, meadows; elevations from USGS / NPS), Yosemite Valley and the
// Merced canyon carved in, a little noise for texture, and colours from height and slope (meadow, forest, granite, snow).
// No network, no textures: one mesh with baked light, cheap enough for a headset.
import { toLocal, mPerDegLat, mPerDegLon, ORIGIN } from './tour.js';

// [lat, lon, metres above sea level]
const ANCHORS = [
  [37.7456, -119.5936, 1210], [37.7230, -119.6390, 1205], [37.7166, -119.6465, 1210], [37.7400, -119.5650, 1225],  // valley floor
  [37.7159, -119.6771, 1343],   // Tunnel View
  [37.7307, -119.5737, 2199], [37.7128, -119.6050, 2287], [37.7233, -119.5843, 2476], [37.7110, -119.6260, 2160],   // south rim
  [37.7570, -119.5965, 2010], [37.7600, -119.6200, 2290], [37.7480, -119.6620, 2150], [37.7650, -119.5750, 2100],  // north rim
  [37.7340, -119.6377, 2307],   // El Capitan
  [37.7330, -119.5150, 1860], [37.7400, -119.4100, 2200], [37.6955, -119.4268, 3496], [37.7000, -119.4700, 2900],  // Little Yosemite, Merced Lake, Clark Range
  [37.6633, -119.6630, 2200], [37.6458, -119.7105, 1900], [37.5369, -119.6555, 1220], [37.4790, -119.6390, 1530],  // Badger Pass, Chinquapin, Wawona, Fish Camp
  [37.5035, -119.5995, 1750], [37.5150, -119.5900, 1990], [37.5250, -119.5800, 2075], [37.5600, -119.5200, 2300],  // Mariposa Grove, Wawona Point
  [37.6750, -119.7840, 600], [37.7530, -119.8000, 1890], [37.8700, -119.6490, 2400], [37.9470, -119.7870, 1170],   // El Portal, Crane Flat, White Wolf, Hetch Hetchy
  [37.8300, -119.4670, 2484], [37.8735, -119.3590, 2621], [37.9107, -119.2581, 3031], [37.8460, -119.4000, 2900],  // Tenaya Lake, Tuolumne, Tioga Pass
  [37.7700, -119.5100, 2600], [37.8200, -119.5600, 2500], [37.8000, -119.6500, 2300], [37.6200, -119.5600, 2400],
  [37.9500, -119.1200, 2050], [37.8600, -119.1500, 2150], [37.9800, -119.3500, 3000], [37.5000, -119.8000, 1100],  // Mono basin edge, north, west foothills
  [37.6000, -119.3000, 2900], [37.8000, -119.2500, 3200], [37.9500, -119.5000, 2600], [37.5500, -119.4000, 2600],
];
// summits and domes: [lat, lon, summit m, radius m] (gaussian bumps on top of the base)
const PEAKS = [
  [37.7459, -119.5332, 2694, 700], [37.7650, -119.4900, 3025, 1600], [37.8998, -119.2209, 3981, 2600], [37.8778, -119.3511, 2873, 500],
  [37.8478, -119.4050, 3326, 900], [37.8460, -119.5110, 3307, 1500], [37.6913, -119.5329, 2773, 700], [37.9300, -119.2600, 3700, 1800],
  [37.7340, -119.6377, 2307, 500], [37.7233, -119.5843, 2476, 450], [37.5050, -119.5700, 2075, 900], [37.6955, -119.4268, 3496, 1500],
  [37.8570, -119.4500, 3000, 900], [37.8330, -119.3200, 3600, 1500], [37.7560, -119.6000, 2050, 400],
];
// Yosemite Valley (a flat floor with near-vertical walls) and the Merced canyon below it: [lat, lon, floor m]
const VALLEY = [[37.7166, -119.6700, 1200], [37.7225, -119.6420, 1205], [37.7300, -119.6200, 1208], [37.7390, -119.6020, 1210], [37.7440, -119.5880, 1212],
  [37.7420, -119.5700, 1220], [37.7470, -119.5560, 1240], [37.7560, -119.5440, 1290]];
const CANYON = [[37.7166, -119.6700, 1200], [37.7120, -119.7000, 1050], [37.6950, -119.7400, 800], [37.6750, -119.7840, 600], [37.6600, -119.8300, 450]];

const kLat = mPerDegLat(ORIGIN.lat), kLon = mPerDegLon(ORIGIN.lat);
const xy = (lat, lon) => [(lon - ORIGIN.lon) * kLon, (lat - ORIGIN.lat) * kLat];   // metres east, north
const A = ANCHORS.map(([la, lo, h]) => [...xy(la, lo), h]), Pk = PEAKS.map(([la, lo, h, r]) => [...xy(la, lo), h, r]);
const V = VALLEY.map(([la, lo, h]) => [...xy(la, lo), h]), C = CANYON.map(([la, lo, h]) => [...xy(la, lo), h]);
function nearSeg(pts, x, y) {   // distance to a polyline and the floor height there
  let best = Infinity, fh = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, ah] = pts[i], [bx, by, bh] = pts[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; fh = ah + (bh - ah) * t; }
  }
  return [best, fh];
}
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// height above sea level (m) at metres east / north of the origin
export function heightXY(x, y) {
  let ws = 0, hs = 0;
  for (const [ax, ay, h] of A) { const d2 = (x - ax) ** 2 + (y - ay) ** 2 + 4e5, w = 1 / (d2 * d2); ws += w; hs += w * h; }
  let h = hs / ws;
  for (const [px, py, ph, r] of Pk) { const d2 = (x - px) ** 2 + (y - py) ** 2, g = Math.exp(-d2 / (2 * r * r)); if (ph > h) h += (ph - h) * g; }
  let n = 0, amp = 1, f = 1 / 2500; for (let o = 0; o < 4; o++) { n += (vnoise(x * f, y * f) - 0.5) * amp; amp *= 0.5; f *= 2.1; }
  h += n * 160;
  const [dv, fv] = nearSeg(V, x, y);   // the valley: flat floor ~450 m either side of the river, walls over ~550 m
  if (dv < 1400) { const wall = fv + (h - fv) * sstep(430, 980, dv + (vnoise(x / 300, y / 300) - 0.5) * 120); h = Math.min(h, wall); }
  const [dc, fc] = nearSeg(C, x, y);   // the Merced canyon: a V
  if (dc < 2500) h = Math.min(h, fc + (h - fc) * sstep(60, 2400, dc));
  return h;
}
export const heightAt = (lat, lon) => heightXY(...xy(lat, lon));

// The mesh: n x n vertices over the park (Wawona to Tioga Pass), positions through the exact ECEF frame, baked light.
export function buildTerrain(THREE, { n = 320, south = 37.44, north = 37.98, west = -119.86, east = -119.14, sun = [0.55, 0.6, -0.58] } = {}) {
  const N = n * n, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), H = new Float32Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const lat = south + (north - south) * j / (n - 1), lon = west + (east - west) * i / (n - 1), k = j * n + i;
    const h = heightAt(lat, lon); H[k] = h; const p = toLocal(lat, lon, h); pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
  }
  const dx = (east - west) / (n - 1) * kLon, dy = (north - south) / (n - 1) * kLat;
  const L = Math.hypot(...sun), sx = sun[0] / L, sy = sun[1] / L, sz = sun[2] / L;   // sun in (east, up, north)
  const meadow = [0.56, 0.55, 0.33], forest = [0.20, 0.30, 0.18], granite = [0.70, 0.69, 0.66], snow = [0.93, 0.95, 0.98], scrub = [0.42, 0.40, 0.30];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, h = H[k];
    const hx = (H[j * n + Math.min(n - 1, i + 1)] - H[j * n + Math.max(0, i - 1)]) / (2 * dx), hy = (H[Math.min(n - 1, j + 1) * n + i] - H[Math.max(0, j - 1) * n + i]) / (2 * dy);
    const nl = Math.hypot(hx, 1, hy), ne = -hx / nl, nu = 1 / nl, nn = -hy / nl, slope = Math.acos(nu);
    const lit = Math.max(0, ne * sx + nu * sy + nn * sz), shade = 0.42 + 0.68 * lit;
    const r = vnoise(i * 0.7, j * 0.7);
    let c = h < 1600 ? (slope < 0.12 ? meadow : forest) : h < 2900 ? (r < 0.25 && slope < 0.3 ? scrub : forest) : scrub;
    const g = sstep(0.45, 0.8, slope + (r - 0.5) * 0.2);           // steep -> bare granite
    const s = sstep(3150, 3500, h + (r - 0.5) * 250) * (1 - sstep(0.7, 1.0, slope));   // high and not too steep -> snow
    for (let q = 0; q < 3; q++) col[k * 3 + q] = ((c[q] * (1 - g) + granite[q] * g) * (1 - s) + snow[q] * s) * shade;
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6); let t = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c;   // x = west mirrors the grid: this winding faces up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'yosemite-fallback-terrain';
  return mesh;
}

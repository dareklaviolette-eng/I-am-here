// I'M HERE Travel Desk · a kit for a park's FALLBACK terrain: what shows when Google Photorealistic 3D Tiles cannot load (off
// the GitHub site where the key is accepted, offline, a refused key). It is a rendered approximation, labelled as such on the
// card, built from a handful of known heights (summits, valley floors, lakes; from the national surveys) with valleys,
// fiords, glaciers and lakes carved in, a little noise for texture, and colours from height and slope. No network, no
// textures: one mesh with baked light, cheap enough for a headset. (Yosemite keeps its own travel/yosemite/terrain.js.)
//
// buildTerrainKit(THREE, spec, { n }) where spec = {
//   toLocal, origin: { lat, lon }, bounds: { south, north, west, east },
//   anchors: [[lat, lon, m]],                          the base surface (inverse-distance blend)
//   peaks:   [[lat, lon, m, radius m]],                summits (pointed bumps where higher than the base)
//   ridges:  [{ pts: [[lat, lon, m]], r }],            crests (a row of bumps along the line)
//   troughs: [{ pts: [[lat, lon, floor m]], half, wall, ice?, water? }]   valleys, glaciers (ice), fiords and long lakes (water)
//   lakes:   [{ lat, lon, a, b, rot, level }]          small round lakes (ellipse, metres; rot = degrees from north)
//   coast:   [[lat, lon], ...] north to south; the sea lies to the west of it (heights below 0 are water)
//   noise: metres, sun: [east, up, north], color(h, slope, lat, lon, r) -> [r, g, b] | null (the park's land colours)
// }
import { mPerDegLat, mPerDegLon } from './tour-core.js';

function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function nearSeg(pts, x, y) {   // distance to a polyline, the floor height there, and the signed side (for the coast)
  let best = Infinity, fh = 0, side = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, ah] = pts[i], [bx, by, bh] = pts[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; fh = (ah || 0) + ((bh || 0) - (ah || 0)) * t; side = dx * (y - ay) - dy * (x - ax); }
  }
  return [best, fh, side];
}

export function makeHeightField(spec) {
  const { origin } = spec, kLat = mPerDegLat(origin.lat), kLon = mPerDegLon(origin.lat);
  const xy = (lat, lon) => [(lon - origin.lon) * kLon, (lat - origin.lat) * kLat];   // metres east, north
  const A = (spec.anchors || []).map(([la, lo, h]) => [...xy(la, lo), h]);
  const Pk = (spec.peaks || []).map(([la, lo, h, r]) => [...xy(la, lo), h, r]);
  for (const rg of spec.ridges || []) {   // a crest: bumps every ~r/1.4 along the line
    for (let i = 0; i < rg.pts.length - 1; i++) {
      const [a, b] = [rg.pts[i], rg.pts[i + 1]], [ax, ay] = xy(a[0], a[1]), [bx, by] = xy(b[0], b[1]), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (rg.r / 1.4)));
      for (let k = 0; k < n; k++) { const t = k / n; Pk.push([ax + (bx - ax) * t, ay + (by - ay) * t, a[2] + (b[2] - a[2]) * t, rg.r]); }
    }
  }
  const TR = (spec.troughs || []).map((t) => ({ ...t, P: t.pts.map(([la, lo, h]) => [...xy(la, lo), h]) }));
  const LK = (spec.lakes || []).map((l) => ({ ...l, c: xy(l.lat, l.lon), cr: Math.cos((l.rot || 0) * Math.PI / 180), sr: Math.sin((l.rot || 0) * Math.PI / 180) }));
  const CO = spec.coast ? spec.coast.map(([la, lo]) => [...xy(la, lo), 0]) : null;
  const noise = spec.noise == null ? 140 : spec.noise;
  // -> { h, water, ice } at metres east / north of the origin
  function sample(x, y) {
    let ws = 0, hs = 0;
    for (const [ax, ay, h] of A) { const d2 = (x - ax) ** 2 + (y - ay) ** 2 + 4e6, w = 1 / (d2 * d2); ws += w; hs += w * h; }
    let h = hs / ws;
    for (const [px, py, ph, r] of Pk) { const d2 = (x - px) ** 2 + (y - py) ** 2; if (d2 > 9 * r * r) continue; const g = Math.exp(-1.3 * Math.pow(d2 / (r * r), 0.62)); if (ph > h) h += (ph - h) * g; }   // a pointed profile: horns, not domes
    let n = 0, amp = 1, f = 1 / 2500; for (let o = 0; o < 4; o++) { n += (vnoise(x * f, y * f) - 0.5) * amp; amp *= 0.5; f *= 2.1; }
    h += n * noise;
    let water = false, ice = false;
    for (const t of TR) {
      const [d, fl] = nearSeg(t.P, x, y); if (d > t.wall * 1.6) continue;
      const wall = fl + (h - fl) * sstep(t.half, t.wall, d + (vnoise(x / 300, y / 300) - 0.5) * t.half * 0.4);
      if (wall < h) h = wall;
      if (d < t.half * 0.92) { if (t.water) water = true; if (t.ice) ice = true; }
    }
    for (const l of LK) {
      const dx = x - l.c[0], dy = y - l.c[1], u = dx * l.sr + dy * l.cr, v = dx * l.cr - dy * l.sr, q = (u / l.a) ** 2 + (v / l.b) ** 2;
      if (q < 1) { h = l.level; water = true; } else if (q < 2.2) h = Math.min(h, l.level + (h - l.level) * sstep(1, 2.2, q));
    }
    if (CO) {   // the sea: west of the coast line (walking north to south, west is on the right: side < 0)
      const [d, , side] = nearSeg(CO, x, y);
      if (side < 0) { h = Math.min(h, -40 - d * 0.01); }
      else if (d < 2500) h = Math.min(h, h * sstep(0, 2500, d) + 5);
    }
    if (h <= 1) water = true;
    return { h: water && h < 1 ? -2 : h, water, ice };   // the sea and the fiords: a flat surface just below sea level
  }
  return { sample, xy, kLat, kLon };
}

export function buildTerrainKit(THREE, spec, { n = 320 } = {}) {
  const { bounds: B, toLocal } = spec, F = makeHeightField(spec);
  const aspect = ((B.east - B.west) * F.kLon) / ((B.north - B.south) * F.kLat);
  const nx = Math.max(32, Math.round(n * Math.sqrt(aspect))), ny = Math.max(32, Math.round(n / Math.sqrt(aspect)));
  const N = nx * ny, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), H = new Float32Array(N), W = new Uint8Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const lat = B.south + (B.north - B.south) * j / (ny - 1), lon = B.west + (B.east - B.west) * i / (nx - 1), k = j * nx + i;
    const s = F.sample(...F.xy(lat, lon)); H[k] = s.h; W[k] = s.water ? 1 : s.ice ? 2 : 0;
    const p = toLocal(lat, lon, s.h); pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
  }
  const dx = (B.east - B.west) / (nx - 1) * F.kLon, dy = (B.north - B.south) / (ny - 1) * F.kLat;
  const sun = spec.sun || [0.55, 0.6, -0.58], L = Math.hypot(...sun), sx = sun[0] / L, sy = sun[1] / L, sz = sun[2] / L;
  const forest = [0.20, 0.30, 0.18], meadow = [0.42, 0.52, 0.28], rock = [0.55, 0.53, 0.50], snow = [0.93, 0.95, 0.98], iceC = [0.80, 0.86, 0.90], water = [0.10, 0.22, 0.30];
  const snowAt = spec.snowline || 3000, treeAt = spec.treeline || 2000;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, h = H[k];
    const hx = (H[j * nx + Math.min(nx - 1, i + 1)] - H[j * nx + Math.max(0, i - 1)]) / (2 * dx), hy = (H[Math.min(ny - 1, j + 1) * nx + i] - H[Math.max(0, j - 1) * nx + i]) / (2 * dy);
    const nl = Math.hypot(hx, 1, hy), ne = -hx / nl, nu = 1 / nl, nn = -hy / nl, slope = Math.acos(nu);
    const lit = Math.max(0, ne * sx + nu * sy + nn * sz), shade = 0.42 + 0.68 * lit, r = vnoise(i * 0.7, j * 0.7);
    let c;
    if (W[k] === 1) c = water.map((v) => v / (0.42 + 0.68 * sy));   // water: flat, unshaded
    else {
      const lat = B.south + (B.north - B.south) * j / (ny - 1), lon = B.west + (B.east - B.west) * i / (nx - 1);
      c = (spec.color && spec.color(h, slope, lat, lon, r)) || (h < treeAt - 400 ? (slope < 0.15 ? meadow : forest) : h < treeAt ? forest : meadow);
      const g = sstep(0.5, 0.85, slope + (r - 0.5) * 0.2);                                  // steep -> bare rock
      const s = sstep(snowAt - 200, snowAt + 200, h + (r - 0.5) * 300) * (1 - sstep(0.75, 1.05, slope));   // high and not too steep -> snow
      c = c.map((v, q) => (v * (1 - g) + rock[q] * g) * (1 - s) + snow[q] * s);
      if (W[k] === 2) c = c.map((v, q) => v * 0.15 + iceC[q] * 0.85);
    }
    for (let q = 0; q < 3; q++) col[k * 3 + q] = c[q] * shade;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let t = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c;   // x = west mirrors the grid: this winding faces up
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'fallback-terrain'; mesh.frustumCulled = false;
  return mesh;
}

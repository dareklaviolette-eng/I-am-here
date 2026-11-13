// XR Aurora · procedural geometry. Craft frame: metres, y up, bow toward -z, lower (lounge) floor at y = 0.
// Everything static is merged per material (one draw call each); only parts that move (globe, drive rings, core) are
// separate meshes. No external models or textures: canvas atlases from panels.js.
//
//   Lounge (lower level): z -15 .. 0.6, glass dome over it, globe table at (0, 0, -6), curved sofas around it.
//   Helm (upper level):   platform y = 1.0, z 0.6 .. 9, three steps at the centre (x +-1.6), pilot seat (0, 1, 3.4) + two.
//   Temporal Drive:       (0, 1, 7.4) behind the helm, glass enclosure, three gimballed rings around a glowing core.
//   Exterior hull:        z -27 (bow) .. 17 (stern), glass lounge band along both sides, energy field around it.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATLAS, atlasPlane, screenPlane, glowTexture } from './panels.js';

export const L = {
  W: 7.2, H: 5.6, zNose: -15, zTaper: -9, zHelm: 0.6, zAft: 9, platY: 1.0,
  table: new THREE.Vector3(0, 0, -6), pilot: new THREE.Vector3(0, 1.0, 3.4), drive: new THREE.Vector3(0, 1.0, 7.4),
  ringPhi0: Math.PI - 75 * Math.PI / 180, ringPhiLen: 150 * Math.PI / 180, ringY0: 0.5, ringY1: 0.8, ringR0: 1.7, ringR1: 1.38,
};
const D2R = Math.PI / 180;
// interior section scale along z: 1 in the room, an ellipsoidal nose forward of zTaper
export function sec(z) { if (z >= L.zTaper) return 1; const t = (L.zTaper - z) / (L.zTaper - L.zNose); return Math.sqrt(Math.max(0, 1 - t * t)); }

// ------------------------------------------------------------------ batching: merge geometry per material key
class Batch {
  constructor() { this.m = new Map(); this.tmp = new THREE.Matrix4(); }
  add(key, geo, pos, rot, scl) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    if (pos || rot || scl) {
      const q = new THREE.Quaternion(); if (rot) q.setFromEuler(rot.isEuler ? rot : new THREE.Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0, rot[3] || 'XYZ'));
      const p = pos ? (pos.isVector3 ? pos : new THREE.Vector3(...pos)) : new THREE.Vector3();
      const s = scl ? (typeof scl === 'number' ? new THREE.Vector3(scl, scl, scl) : new THREE.Vector3(...scl)) : new THREE.Vector3(1, 1, 1);
      g.applyMatrix4(this.tmp.compose(p, q, s));
    }
    if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push(g);
    geo.dispose && geo !== g && geo.dispose();
    return this;
  }
  build(mats, group, name) {
    for (const [k, list] of this.m) {
      const g = mergeGeometries(list, false); list.forEach((x) => x.dispose());
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[k]); mesh.name = name + ':' + k; mesh.matrixAutoUpdate = false;
      if (k === 'glass' || k === 'decal' || k === 'holoGlass') mesh.renderOrder = 5;
      group.add(mesh);
    }
    this.m.clear(); return group;
  }
}

// ------------------------------------------------------------------ helpers
function rbox(w, h, d, r = 0.04) {   // rounded box (extruded rounded rectangle with a bevel), centred
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, W = w - 2 * r, H = h - 2 * r, c = r * 0.5;
  s.moveTo(x + c, y); s.lineTo(x + W - c, y); s.quadraticCurveTo(x + W, y, x + W, y + c); s.lineTo(x + W, y + H - c);
  s.quadraticCurveTo(x + W, y + H, x + W - c, y + H); s.lineTo(x + c, y + H); s.quadraticCurveTo(x, y + H, x, y + H - c); s.lineTo(x, y + c); s.quadraticCurveTo(x, y, x + c, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2); return g;
}
function lathe(pts, segs, phi0 = 0, phiLen = Math.PI * 2) { return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs, phi0, phiLen); }
class FnCurve extends THREE.Curve { constructor(fn) { super(); this.fn = fn; } getPoint(t, out = new THREE.Vector3()) { return this.fn(t, out); } }
function tube(fn, segs, radius, radial = 6, closed = false) { return new THREE.TubeGeometry(new FnCurve(fn), segs, radius, radial, closed); }
// a point on the interior shell: theta 0 = +x at the floor, pi/2 = the top, pi = -x at the floor; k = scale toward the axis
function shellPt(theta, z, k, out) { const s = sec(z) * k; return out.set(L.W * s * Math.cos(theta), L.H * s * Math.sin(theta), z); }

// ------------------------------------------------------------------ materials
export function makeMaterials(envMap) {
  const std = (o) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 0.9, ...o });
  const atlas = o => o;
  const M = {
    metal: std({ color: 0x2b3038, metalness: 0.85, roughness: 0.32 }),
    chrome: std({ color: 0xd2d6dc, metalness: 1, roughness: 0.16, envMapIntensity: 1.2 }),
    bronze: std({ color: 0xc9a46c, metalness: 1, roughness: 0.28, envMapIntensity: 1.1 }),
    panel: std({ color: 0x40464f, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide }),
    floor: std({ color: 0x161a20, metalness: 0.45, roughness: 0.2, envMapIntensity: 1.1 }),
    wood: std({ color: 0x4a3326, metalness: 0.05, roughness: 0.32, envMapIntensity: 0.8 }),
    fabric: std({ color: 0xcdbfa9, metalness: 0, roughness: 0.92, envMapIntensity: 0.5, side: THREE.DoubleSide }),
    cushion: std({ color: 0x4c5563, metalness: 0, roughness: 0.85, envMapIntensity: 0.4 }),
    leather: std({ color: 0x33363d, metalness: 0.1, roughness: 0.42 }),
    rug: std({ color: 0x5d5148, metalness: 0, roughness: 1, envMapIntensity: 0.3 }),
    plant: std({ color: 0x3f7b48, metalness: 0, roughness: 0.75, flatShading: true, envMapIntensity: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9cc8ee, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.11, depthWrite: false,
      side: THREE.DoubleSide, envMap, envMapIntensity: 0.55 }),
    warm: new THREE.MeshBasicMaterial({ color: 0xffb466, toneMapped: false }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x4fd6ff, toneMapped: false }),
    dark: new THREE.MeshBasicMaterial({ color: 0x05080d }),
    hull: std({ color: 0xffffff, vertexColors: true, metalness: 0.82, roughness: 0.26, envMapIntensity: 1.25, side: THREE.DoubleSide }),
    hullGlass: new THREE.MeshStandardMaterial({ color: 0x5a86b0, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false,
      side: THREE.DoubleSide, envMap, envMapIntensity: 1.3 }),
  };
  void atlas;
  return M;
}

// ------------------------------------------------------------------ interior
export function buildInterior(M, tex) {
  const root = new THREE.Group(); root.name = 'aurora-interior';
  const B = new Batch(), v = new THREE.Vector3();
  const { W, H, zNose, zHelm, zAft, platY } = L;

  // --- shell: parametric tube (glass above the sill in the lounge; side window band at the helm; metal elsewhere)
  {
    const NT = 40, NZ = 64, z0 = zNose, z1 = zAft;
    const pos = { glass: [], panel: [] }, P = new THREE.Vector3(), Q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const zAt = (j) => z0 + (z1 - z0) * j / NZ;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NT; i++) {
      const za = zAt(j), zb = zAt(j + 1), ta = i / NT * Math.PI, tb = (i + 1) / NT * Math.PI;
      shellPt(ta, za, 1, Q[0]); shellPt(tb, za, 1, Q[1]); shellPt(tb, zb, 1, Q[2]); shellPt(ta, zb, 1, Q[3]);
      P.copy(Q[0]).add(Q[1]).add(Q[2]).add(Q[3]).multiplyScalar(0.25);
      const lounge = P.z < zHelm, glass = lounge ? true : (P.y > platY + 0.75 && P.y < platY + 2.75);
      const arr = glass ? pos.glass : pos.panel;
      for (const k of [0, 1, 2, 0, 2, 3]) arr.push(Q[k].x, Q[k].y, Q[k].z);
    }
    for (const k of ['glass', 'panel']) { let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos[k], 3)); g = mergeVertices(g, 1e-4); g.computeVertexNormals(); B.add(k, g); }
  }
  // sill: a low wall following the shell from the floor up to 0.55 m, both sides and around the nose
  { const pos = [], n = 72, A = new THREE.Vector3(), Bv = new THREE.Vector3(), C2 = new THREE.Vector3(), D2 = new THREE.Vector3();
    const top = (z, sx, o) => { const s = sec(z), hs = L.H * s; const th = hs > 0.56 ? Math.asin(0.55 / hs) : Math.PI / 2; return shellPt(sx > 0 ? th : Math.PI - th, z, 0.999, o); };
    for (const sx of [1, -1]) for (let i = 0; i < n; i++) {
      const za = zNose + (zHelm - zNose) * i / n, zb = zNose + (zHelm - zNose) * (i + 1) / n;
      shellPt(sx > 0 ? 0 : Math.PI, za, 0.999, A); shellPt(sx > 0 ? 0 : Math.PI, zb, 0.999, Bv); top(zb, sx, C2); top(za, sx, D2);
      for (const q of [A, Bv, C2, A, C2, D2]) pos.push(q.x, q.y, q.z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); B.add('panel', g); }
  // aft bulkhead (half ellipse) and its light lines
  { const s = new THREE.Shape(); s.absellipse(0, 0, W, H, 0, Math.PI, false); s.lineTo(W, 0); B.add('panel', new THREE.ShapeGeometry(s, 24), [0, 0, zAft]);
    for (const x of [-2.6, -1.9, 1.9, 2.6]) B.add('cyan', new THREE.BoxGeometry(0.03, 3.2, 0.02), [x, platY + 2.2, zAft - 0.03]); }
  // --- dome ribs (lounge): arches + warm strips just inside them; longitudinal spines
  for (const z of [-12.5, -10, -7.5, -5, -2.5]) {
    B.add('chrome', tube((t, o) => shellPt(t * Math.PI, z, 0.996, o), 40, 0.05, 6));
    B.add('warm', tube((t, o) => shellPt(0.22 + t * (Math.PI - 0.44), z, 0.985, o), 36, 0.014, 4));
  }
  for (const th of [Math.PI / 2, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62]) {
    B.add('chrome', tube((t, o) => shellPt(th, zNose + 0.4 + t * (zHelm - zNose - 0.4), 0.996, o), 40, 0.045, 6));
  }
  // sill: warm strip at the foot of the glass, both sides
  for (const sx of [1, -1]) B.add('warm', tube((t, o) => { const z = zNose + 1.2 + t * (zHelm - zNose - 1.3), s = sec(z), y = 0.56, x = W * s * Math.sqrt(Math.max(0, 1 - (y / (H * s)) ** 2)); return o.set(sx * (x - 0.05), y, z); }, 48, 0.02, 4));
  // header arch between the lounge and the helm (wordmark on its forward face)
  B.add('metal', tube((t, o) => shellPt(t * Math.PI, zHelm, 0.985, o), 48, 0.2, 8));
  B.add('cyan', tube((t, o) => shellPt(0.12 + t * (Math.PI - 0.24), zHelm - 0.21, 0.965, o), 44, 0.015, 4));
  B.add('metal', rbox(2.6, 0.82, 0.1, 0.04), [0, H - 1.05, zHelm - 0.24]);
  B.add('cyan', new THREE.BoxGeometry(2.5, 0.015, 0.015), [0, H - 1.05 - 0.41, zHelm - 0.3]);
  for (const x of [-1.1, 1.1]) B.add('chrome', new THREE.CylinderGeometry(0.02, 0.02, 0.62, 6), [x, H - 0.33, zHelm - 0.22]);
  B.add('decal', atlasPlane(2.4, 0.6, ATLAS.wordmark), [0, H - 1.05, zHelm - 0.30], [0, Math.PI, 0]);
  // helm ceiling light lines
  for (const th of [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3]) B.add('warm', tube((t, o) => shellPt(th, zHelm + 0.4 + t * (zAft - zHelm - 0.8), 0.985, o), 12, 0.018, 4));

  // --- floors
  { const s = new THREE.Shape(), n = 40; s.moveTo(W * sec(zHelm) - 0.02, -zHelm);
    for (let i = 0; i <= n; i++) { const z = zHelm - (zHelm - zNose) * i / n; s.lineTo(W * sec(z) - 0.02, -z); }
    for (let i = n; i >= 0; i--) { const z = zHelm - (zHelm - zNose) * i / n; s.lineTo(-W * sec(z) + 0.02, -z); }
    const g = new THREE.ShapeGeometry(s, 1); g.rotateX(-Math.PI / 2); B.add('wood', g); }
  { const g = new THREE.PlaneGeometry(W * 2 * 0.985, zAft - zHelm); g.rotateX(-Math.PI / 2); B.add('floor', g, [0, platY, (zAft + zHelm) / 2]); }
  // rug + inlay rings around the globe table
  { const g = new THREE.CircleGeometry(2.75, 48); g.rotateX(-Math.PI / 2); B.add('rug', g, [L.table.x, 0.006, L.table.z]);
    const r1 = new THREE.RingGeometry(2.78, 2.81, 64); r1.rotateX(-Math.PI / 2); B.add('warm', r1, [L.table.x, 0.008, L.table.z]);
    const r2 = new THREE.RingGeometry(4.35, 4.37, 72); r2.rotateX(-Math.PI / 2); B.add('cyan', r2, [L.table.x, 0.008, L.table.z]); }
  // platform front (riser) and the three steps with glowing noses
  for (const sx of [1, -1]) {
    const w = W * 0.985 - 1.6; B.add('panel', new THREE.PlaneGeometry(w, platY), [sx * (1.6 + w / 2), platY / 2, zHelm], [0, Math.PI, 0]);
    B.add('warm', new THREE.BoxGeometry(w, 0.025, 0.03), [sx * (1.6 + w / 2), platY - 0.02, zHelm - 0.02]);
    B.add('cyan', new THREE.BoxGeometry(w, 0.02, 0.02), [sx * (1.6 + w / 2), 0.05, zHelm - 0.02]);
  }
  for (let k = 0; k < 3; k++) {
    const top = platY - 0.25 * (k + 1), zf = zHelm - 0.32 * (k + 1);
    B.add('metal', new THREE.BoxGeometry(3.2, top, zHelm - zf), [0, top / 2, (zHelm + zf) / 2]);
    B.add('floor', new THREE.PlaneGeometry(3.2, zHelm - zf).rotateX(-Math.PI / 2), [0, top + 0.002, (zHelm + zf) / 2]);
    B.add('warm', new THREE.BoxGeometry(3.2, 0.022, 0.03), [0, top - 0.02, zf - 0.005]);
  }
  // plaque on the riser, left of the steps: XR Aurora · IH-0000
  B.add('decal', atlasPlane(1.5, 0.19, ATLAS.plaque), [-2.65, 0.58, zHelm - 0.012], [0, Math.PI, 0]);
  // glass railing along the platform edge (both sides of the steps), chrome top rail with a warm underside strip
  for (const sx of [1, -1]) {
    const x0 = 1.75, x1 = 5.6, w = x1 - x0, cx = sx * (x0 + w / 2);
    B.add('glass', new THREE.PlaneGeometry(w, 0.9), [cx, platY + 0.48, zHelm + 0.08]);
    B.add('chrome', new THREE.CylinderGeometry(0.025, 0.025, w, 8).rotateZ(Math.PI / 2), [cx, platY + 0.95, zHelm + 0.08]);
    B.add('warm', new THREE.BoxGeometry(w, 0.012, 0.012), [cx, platY + 0.92, zHelm + 0.08]);
    for (const x of [x0, x1]) B.add('chrome', new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), [sx * x, platY + 0.475, zHelm + 0.08]);
  }

  // --- globe table (pedestal, glass top, rims); the ring menu band is a separate mesh (hover redraws)
  const T = L.table;
  B.add('metal', lathe([[0.0, 0], [1.0, 0], [1.12, 0.05], [1.02, 0.12], [0.95, 0.2], [1.2, 0.36], [1.62, 0.46], [1.7, 0.49], [L.ringR0 - 0.02, L.ringY0 - 0.01], [L.ringR1 - 0.02, L.ringY1 - 0.01], [1.36, 0.8], [0, 0.8]], 64), T);
  B.add('chrome', new THREE.TorusGeometry(L.ringR0 + 0.01, 0.028, 8, 80).rotateX(Math.PI / 2), [T.x, L.ringY0, T.z]);
  B.add('chrome', new THREE.TorusGeometry(L.ringR1, 0.025, 8, 72).rotateX(Math.PI / 2), [T.x, L.ringY1 + 0.005, T.z]);
  B.add('cyan', new THREE.TorusGeometry(1.26, 0.012, 6, 72).rotateX(Math.PI / 2), [T.x, 0.812, T.z]);
  B.add('warm', new THREE.TorusGeometry(1.05, 0.014, 6, 64).rotateX(Math.PI / 2), [T.x, 0.08, T.z]);
  B.add('warm', new THREE.TorusGeometry(1.64, 0.012, 6, 72).rotateX(Math.PI / 2), [T.x, 0.44, T.z]);
  B.add('holoGlass', new THREE.CircleGeometry(1.34, 64).rotateX(-Math.PI / 2), [T.x, 0.806, T.z]);
  // band behind the six items (rest of the circle): ticks
  { const g = lathe([[L.ringR0, L.ringY0], [L.ringR1, L.ringY1]], 40, L.ringPhi0 + L.ringPhiLen, Math.PI * 2 - L.ringPhiLen);
    const uv = g.attributes.uv, [u0, v0, u1, v1] = [0, 1 - 1024 / 1024, 1, 1 - 896 / 1024];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 4 % 1 * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    B.add('decal', g, [T.x, 0.002, T.z], null, [1.003, 1, 1.003]); }

  // --- sofas: lathe-swept around the table, two arcs (open toward the bow and toward the steps)
  const sofaProfile = [[3.0, 0.14], [3.0, 0.4], [3.04, 0.46], [3.5, 0.47], [3.56, 0.52], [3.6, 0.92], [3.7, 0.99], [3.84, 0.96], [3.86, 0.14]];
  const caps = (phi) => { const s = new THREE.Shape(sofaProfile.map((p) => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ShapeGeometry(s); g.rotateY(phi - Math.PI / 2); return g; };
  for (const [a, b] of [[0.62, 2.52], [-2.52, -0.62]]) {
    B.add('fabric', lathe(sofaProfile, 40, a, b - a), T);
    B.add('fabric', caps(a), T); B.add('fabric', caps(b), T);
    for (const ph of [a, b]) { B.add('fabric', new THREE.CapsuleGeometry(0.15, 0.62, 4, 12).rotateX(Math.PI / 2), [T.x + Math.sin(ph) * 3.45, 0.58, T.z + Math.cos(ph) * 3.45], [0, ph, 0]);
      B.add('fabric', rbox(0.28, 0.5, 0.9, 0.1), [T.x + Math.sin(ph) * 3.43, 0.34, T.z + Math.cos(ph) * 3.43], [0, ph, 0]); }
    B.add('metal', lathe([[2.98, 0.0], [2.98, 0.14], [3.88, 0.14], [3.88, 0.0]], 40, a, b - a), T);
    B.add('warm', lathe([[2.97, 0.03], [2.97, 0.05]], 40, a, b - a), T);
    // seat cushion seams and back pillows
    for (let k = 0; k < 5; k++) { const ph = a + (b - a) * (k + 0.5) / 5, r = 3.45;
      B.add(k % 2 ? 'cushion' : 'fabric', rbox(0.5, 0.42, 0.16, 0.07), [T.x + Math.sin(ph) * r, 0.7, T.z + Math.cos(ph) * r], [0.25, ph, 0, 'YXZ']); }
  }
  // the bow bench: a curved sofa at the nose that faces out through the glass (the Observation deck seat)
  { const prof = [[5.08, 0.14], [5.08, 0.4], [5.03, 0.46], [4.62, 0.47], [4.56, 0.52], [4.5, 0.9], [4.42, 0.97], [4.3, 0.94], [4.28, 0.14]];
    const a = Math.PI - 0.42, b = Math.PI + 0.42;
    B.add('fabric', lathe(prof, 28, a, b - a), T);
    const cap = (phi) => { const g = new THREE.ShapeGeometry(new THREE.Shape(prof.map((p) => new THREE.Vector2(p[0], p[1])))); g.rotateY(phi - Math.PI / 2); return g; };
    B.add('fabric', cap(a), T); B.add('fabric', cap(b), T);
    B.add('metal', lathe([[4.26, 0.0], [4.26, 0.14], [5.1, 0.14], [5.1, 0.0]], 28, a, b - a), T);
    B.add('warm', lathe([[5.11, 0.03], [5.11, 0.05]], 28, a, b - a), T);
    for (const ph of [a, b]) { B.add('fabric', new THREE.CapsuleGeometry(0.15, 0.56, 4, 12).rotateX(Math.PI / 2), [T.x + Math.sin(ph) * 4.69, 0.58, T.z + Math.cos(ph) * 4.69], [0, ph, 0]);
      B.add('fabric', rbox(0.28, 0.5, 0.84, 0.1), [T.x + Math.sin(ph) * 4.69, 0.34, T.z + Math.cos(ph) * 4.69], [0, ph, 0]); }
    for (let k = 0; k < 3; k++) { const ph = a + (b - a) * (k + 0.5) / 3; B.add(k === 1 ? 'cushion' : 'fabric', rbox(0.5, 0.4, 0.15, 0.07), [T.x + Math.sin(ph) * 4.66, 0.7, T.z + Math.cos(ph) * 4.66], [-0.25, ph, 0, 'YXZ']); } }
  // side tables with warm lamps at the sofa ends near the bow
  for (const ph of [2.75, -2.75]) {
    const x = T.x + Math.sin(ph) * 3.45, z = T.z + Math.cos(ph) * 3.45;
    B.add('chrome', new THREE.CylinderGeometry(0.32, 0.26, 0.5, 24), [x, 0.25, z]);
    B.add('warm', new THREE.CylinderGeometry(0.1, 0.12, 0.26, 16), [x, 0.66, z]);
    B.add('metal', new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), [x, 0.8, z]);
  }
  // planters: chrome pots + low-poly fronds
  const plant = (x, z, s) => {
    B.add('chrome', lathe([[0, 0], [0.32, 0], [0.42, 0.55], [0.4, 0.58], [0, 0.58]], 20).scale(s, s, s), [x, 0, z]);
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4, tilt = 0.5 + (k % 3) * 0.22, len = (0.9 + (k % 4) * 0.18) * s;
      const g = new THREE.ConeGeometry(0.16 * s, len, 4, 1); g.translate(0, len / 2, 0); g.scale(1, 1, 0.35);
      B.add('plant', g, [x, 0.55 * s, z], [tilt, a, 0, 'YXZ']);
    }
  };
  plant(-4.3, -11.6, 0.9); plant(4.3, -11.6, 0.9); plant(-2.3, -0.5, 0.75); plant(2.3, -0.5, 0.75); plant(-5.6, 2.2, 0.8); plant(5.6, 2.2, 0.8);

  // --- helm: three seats, curved console, five screens
  const seat = (x, z, yaw) => {
    const y = platY, R = [0, yaw, 0];
    const add = (k, g, p, r) => { const m = new THREE.Matrix4().makeRotationY(yaw); const pp = new THREE.Vector3(...p).applyMatrix4(m).add(new THREE.Vector3(x, y, z)); B.add(k, g, pp, r ? [r[0], yaw + (r[1] || 0), r[2] || 0, 'YXZ'] : R); };
    add('chrome', new THREE.CylinderGeometry(0.06, 0.08, 0.4, 12), [0, 0.2, 0]);
    add('chrome', new THREE.CylinderGeometry(0.34, 0.38, 0.04, 20), [0, 0.02, 0]);
    add('leather', rbox(0.62, 0.14, 0.6, 0.06), [0, 0.47, 0]);
    add('leather', rbox(0.6, 0.86, 0.14, 0.07), [0, 0.95, 0.3], [0.16, 0, 0]);
    add('leather', rbox(0.34, 0.2, 0.12, 0.05), [0, 1.48, 0.39], [0.16, 0, 0]);
    for (const sx of [1, -1]) { add('leather', rbox(0.1, 0.08, 0.48, 0.035), [sx * 0.36, 0.66, 0.02]); add('chrome', new THREE.BoxGeometry(0.03, 0.18, 0.04), [sx * 0.36, 0.56, 0.0]); }
    add('warm', new THREE.BoxGeometry(0.5, 0.015, 0.015), [0, 0.39, -0.29]);
  };
  seat(L.pilot.x, L.pilot.z, 0); seat(-1.95, 3.75, -0.2); seat(1.95, 3.75, 0.2);
  const P = L.pilot, cA = Math.PI - 64 * D2R, cLen = 128 * D2R;
  const cR = 1.85;
  B.add('panel', lathe([[cR - 0.42, 0], [cR - 0.4, 0.62], [cR - 0.48, 0.7], [cR - 0.46, 0.74], [cR + 0.06, 0.78], [cR + 0.1, 0.72], [cR + 0.04, 0]], 48, cA, cLen), [P.x, platY, P.z]);
  B.add('cyan', lathe([[cR + 0.075, 0.7], [cR + 0.07, 0.725]], 48, cA, cLen), [P.x, platY, P.z]);
  B.add('warm', lathe([[cR - 0.47, 0.715], [cR - 0.47, 0.73]], 48, cA, cLen), [P.x, platY, P.z]);
  B.add('warm', lathe([[cR + 0.04, 0.04], [cR + 0.04, 0.06]], 48, cA, cLen), [P.x, platY, P.z]);
  B.add('cyan', lathe([[cR + 0.06, 0.35], [cR + 0.062, 0.37]], 48, cA, cLen), [P.x, platY, P.z]);
  for (let k = -9; k <= 9; k++) { if (Math.abs(k) < 2) continue; const ph = Math.PI + k * 5.5 * D2R, r = cR - 0.3;
    B.add(k % 3 ? 'cyan' : 'warm', new THREE.BoxGeometry(0.07, 0.008, 0.05), [P.x + Math.sin(ph) * r, platY + 0.765, P.z + Math.cos(ph) * r], [0, ph, 0]); }
  const screens = [];
  [-44, -22, 0, 22, 44].forEach((deg, i) => {
    const ph = Math.PI + deg * D2R, r = cR - 0.05, x = P.x + Math.sin(ph) * r, z = P.z + Math.cos(ph) * r, y = platY + 0.99;
    const yaw = ph + Math.PI;   // face the pilot
    B.add('screen', screenPlane(0.66, 0.44, i), [x, y, z], [-0.2, yaw, 0, 'YXZ']);
    B.add('metal', rbox(0.72, 0.49, 0.04, 0.02), [x + Math.sin(ph) * 0.025, y, z + Math.cos(ph) * 0.025], [-0.2, yaw, 0, 'YXZ']);
    B.add('cyan', new THREE.BoxGeometry(0.6, 0.008, 0.008), [x + Math.sin(ph) * 0.04, y - 0.25, z + Math.cos(ph) * 0.04], [0, yaw, 0]);
    screens.push({ x, y, z, yaw });
  });

  // --- Temporal Drive enclosure (the moving parts are separate meshes below)
  const Dv = L.drive;
  B.add('metal', lathe([[0, 0], [1.42, 0], [1.42, 0.2], [1.3, 0.3], [0, 0.3]], 48), Dv);
  B.add('cyan', new THREE.TorusGeometry(1.27, 0.018, 6, 72).rotateX(Math.PI / 2), [Dv.x, Dv.y + 0.31, Dv.z]);
  B.add('glass', new THREE.CylinderGeometry(1.25, 1.25, 3.1, 48, 1, true), [Dv.x, Dv.y + 0.3 + 1.55, Dv.z]);
  B.add('metal', lathe([[1.42, 0], [1.42, 0.22], [0, 0.22], [0, 0.1], [1.25, 0.1], [1.25, 0]], 48), [Dv.x, Dv.y + 3.4, Dv.z]);
  B.add('warm', new THREE.TorusGeometry(1.43, 0.015, 6, 72).rotateX(Math.PI / 2), [Dv.x, Dv.y + 3.41, Dv.z]);
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6; B.add('chrome', new THREE.CylinderGeometry(0.035, 0.035, 3.1, 8), [Dv.x + Math.sin(a) * 1.3, Dv.y + 1.85, Dv.z + Math.cos(a) * 1.3]); }
  B.add('decal', atlasPlane(1.7, 0.21, ATLAS.drive), [Dv.x, Dv.y + 3.77, Dv.z - 1.0], [0, Math.PI, 0]);
  B.add('metal', new THREE.BoxGeometry(1.8, 0.3, 0.2), [Dv.x, Dv.y + 3.77, Dv.z - 0.9]);

  const mats = { ...M, decal: tex.decalMat, screen: tex.screenMat, holoGlass: tex.holoGlassMat };
  B.build(mats, root, 'interior');

  // --- moving / special meshes
  const dyn = {};
  // ring menu band (six items on the front 150 degrees)
  { const g = lathe([[L.ringR0, L.ringY0], [L.ringR1, L.ringY1]], 48, L.ringPhi0, L.ringPhiLen);
    const ring = new THREE.Mesh(g, tex.ringMat); ring.position.set(T.x, 0.004, T.z); ring.scale.set(1.004, 1, 1.004); ring.name = 'aurora-ring-menu'; ring.renderOrder = 6;
    root.add(ring); dyn.ring = ring; }
  // holographic Earth over the table + projector glow
  { const globe = new THREE.Mesh(new THREE.SphereGeometry(0.46, 48, 32), tex.globeMat); globe.position.set(T.x, 1.42, T.z); globe.name = 'aurora-globe'; globe.renderOrder = 8;
    root.add(globe); dyn.globe = globe;
    const pin = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    pin.scale.setScalar(0.09); globe.add(pin); dyn.pin = pin;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.006, 4, 96), M.cyan); halo.rotation.x = Math.PI / 2 - 0.25; halo.position.copy(globe.position); root.add(halo); dyn.halo = halo;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.15, 0.55, 48, 1, true), tex.beamMat); beam.position.set(T.x, 0.81 + 0.275, T.z); beam.renderOrder = 7; root.add(beam); }
  // Temporal Drive: three gimballed rings (outer spins about y, middle about x, inner about z) and the core
  { const c = new THREE.Vector3(Dv.x, Dv.y + 2.0, Dv.z);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 10, 72), M.bronze);
    const middle = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.042, 10, 64), M.chrome);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.036, 10, 56), M.bronze);
    outer.position.copy(c); outer.add(middle); middle.add(inner); middle.rotation.x = Math.PI / 2; inner.rotation.y = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.014, 4, 72), M.cyan); outer.add(band); band.position.z = 0.055;
    root.add(outer); dyn.rings = [outer, middle, inner];
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), new THREE.MeshBasicMaterial({ color: 0xe8fbff, toneMapped: false })); core.position.copy(c); root.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0x5fd0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    glow.scale.setScalar(2.6); glow.position.copy(c); glow.renderOrder = 9; root.add(glow);
    dyn.core = core; dyn.coreGlow = glow; }
  // the holographic list panel over the table (Destination), hidden until opened; faces the bow side (Command)
  { const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), tex.holoMat); p.position.set(T.x, 2.35, T.z - 0.35); p.rotation.set(-0.08, Math.PI, 0); p.visible = false; p.renderOrder = 20; p.name = 'aurora-holo-panel';
    root.add(p); dyn.holo = p; }
  // hit volumes (never drawn): the steps
  dyn.steps = { min: new THREE.Vector3(-1.65, 0, zHelm - 1.05), max: new THREE.Vector3(1.65, platY + 0.05, zHelm + 0.15) };
  dyn.screens = screens;
  return { root, dyn };
}

// ------------------------------------------------------------------ exterior hull (Chase / God's eye)
export const HULL = { z0: -36, z1: 26, cy: 1.5, Wh: 8.6, Hh: 4.5, n: 2.5 };
function hullScale(z) {   // [px, py, cyShift]
  if (z < -10) { const t = (-10 - z) / (-10 - HULL.z0); const p = Math.max(0, 1 - Math.pow(t, 2.1)); return [p, Math.pow(p, 1.4), -1.5 * t * t]; }
  if (z > 9) { const t = (z - 9) / (HULL.z1 - 9); const p = 1 - 0.66 * Math.pow(t, 1.4); return [p, p * (1 - 0.15 * t), 0.8 * t * t]; }
  return [1, 1, 0];
}
export function hullPt(theta, z, out, grow = 0) {
  const [px, py, dy] = hullScale(z), c = Math.cos(theta), s = Math.sin(theta), e = 2 / HULL.n;
  return out.set(Math.sign(c) * Math.pow(Math.abs(c), e) * (HULL.Wh * px + grow), HULL.cy + dy + Math.sign(s) * Math.pow(Math.abs(s), e) * (HULL.Hh * py + grow), z);
}
// the point on the hull's side (side = +1: +x, -1: -x) at height y, station z (bisection on theta); grow: offset outward
export function hullAtY(side, y, z, out, grow = 0) {
  let lo = side > 0 ? -Math.PI / 2 : Math.PI / 2, hi = side > 0 ? Math.PI / 2 : 3 * Math.PI / 2;
  for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; hullPt(mid, z, out); if ((out.y < y) === (side > 0)) lo = mid; else hi = mid; }
  return hullPt((lo + hi) / 2, z, out, grow);
}
export function buildExterior(M, tex) {
  const root = new THREE.Group(); root.name = 'aurora-exterior';
  const NT = 72, NZ = 110, Q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], C = new THREE.Vector3();
  const metal = [], glass = [], col = [];
  const zAt = (j) => HULL.z0 + (HULL.z1 - HULL.z0) * Math.pow(j / NZ, 0.92);
  const silver = new THREE.Color(0xc9d0d9), graphite = new THREE.Color(0x3a4048), tmpc = new THREE.Color();
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NT; i++) {
    const za = zAt(j), zb = zAt(j + 1), ta = i / NT * Math.PI * 2, tb = (i + 1) / NT * Math.PI * 2;
    hullPt(ta, za, Q[0]); hullPt(ta, zb, Q[1]); hullPt(tb, zb, Q[2]); hullPt(tb, za, Q[3]);
    C.copy(Q[0]).add(Q[1]).add(Q[2]).add(Q[3]).multiplyScalar(0.25);
    const band = C.z > -14.6 && C.z < 8.6 && C.y > 0.6 && C.y < 4.4 && Math.abs(C.x) > 2.0;
    const canopy = C.z > -14.2 && C.z < 0.4 && C.y >= 4.4;
    const into = band || canopy ? glass : metal;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      into.push(Q[k].x, Q[k].y, Q[k].z);
      if (into === metal) { const y = Q[k].y; const t = THREE.MathUtils.smoothstep(y, -1.6, -0.6); tmpc.copy(graphite).lerp(silver, t);
        if (y > -0.25 && y < -0.05) tmpc.multiplyScalar(0.55);   // a dark chine line
        col.push(tmpc.r, tmpc.g, tmpc.b); }
    }
  }
  let gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.Float32BufferAttribute(metal, 3)); gm.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  gm = mergeVertices(gm, 1e-4); gm.computeVertexNormals();
  const hull = new THREE.Mesh(gm, M.hull); hull.name = 'aurora-hull'; root.add(hull);
  let gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(glass, 3)); gg = mergeVertices(gg, 1e-4); gg.computeVertexNormals();
  const hg = new THREE.Mesh(gg, M.hullGlass); hg.renderOrder = 4; root.add(hg);
  // stern: a recessed glowing ring (an integrated emitter, no engine pods)
  const B = new Batch(), sternZ = HULL.z1;
  { const pts = []; for (let i = 0; i <= 64; i++) { hullPt(i / 64 * Math.PI * 2, sternZ, C); pts.push(new THREE.Vector2(C.x, C.y)); }
    const s = new THREE.Shape(pts); const g = new THREE.ShapeGeometry(s, 1); B.add('metal', g, [0, 0, sternZ]);
    const [sx, sy, sdy] = hullScale(sternZ);
    B.add('cyan', new THREE.TorusGeometry(1, 0.05, 6, 64), [0, HULL.cy + sdy, sternZ + 0.02], null, [HULL.Wh * sx * 0.72, HULL.Hh * sy * 0.72, 1]);
    B.add('cyan', new THREE.TorusGeometry(1, 0.035, 6, 64), [0, HULL.cy + sdy, sternZ + 0.02], null, [HULL.Wh * sx * 0.45, HULL.Hh * sy * 0.45, 1]); }
  // light lines along the glass band (bottom edge) and the chine, both sides
  for (const side of [1, -1]) {
    const line = (y, z0, z1, k, r) => B.add(k, tube((t, o) => hullAtY(side, y, z0 + (z1 - z0) * t, o, 0.05), 80, r, 5));
    line(0.55, -16.5, 13.5, 'cyan', 0.07); line(-0.15, -27, 20, 'cyan', 0.05); line(4.45, -14.5, 8.5, 'chrome', 0.09);
  }
  // dorsal spine: a low swept blade aft of the canopy
  { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(13, 0); s.quadraticCurveTo(12.5, 1.4, 9, 1.6); s.quadraticCurveTo(3, 1.3, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2 }); g.translate(0, 0, -0.25); g.rotateY(-Math.PI / 2);
    B.add('chrome', g, [0, HULL.cy + HULL.Hh - 0.25, 2.5]);
    B.add('cyan', new THREE.BoxGeometry(0.06, 0.05, 9), [0, HULL.cy + HULL.Hh + 0.95, 9.5]); }
  // ventral keel light
  B.add('cyan', new THREE.BoxGeometry(0.25, 0.05, 26), [0, HULL.cy - HULL.Hh + 0.02, -4]);
  // lettering on both flanks, aft of the glass band: i'm here · OMNIDIMENSIONAL DRIVE, and the name
  for (const side of [1, -1]) {
    const z = 13.2; hullAtY(side, 2.2, z, C, 0.12);
    B.add('decal', atlasPlane(7.2, 1.8, ATLAS.hullMark), [C.x, 2.2, z], [0, side * Math.PI / 2, 0]);
    hullAtY(side, 0.25, 12.8, C, 0.1);
    B.add('decal', atlasPlane(4.0, 0.5, ATLAS.hullName), [C.x, 0.25, 12.8], [0, side * Math.PI / 2, 0]);
  }
  const mats = { ...M, decal: tex.decalMat };
  B.build(mats, root, 'exterior');
  // energy field: an additive fresnel shell with slow flowing bands
  const fg = new THREE.SphereGeometry(1, 64, 40); fg.scale(12.5, 8.4, 37); fg.translate(0, HULL.cy, -5); fg.computeVertexNormals();
  const field = new THREE.Mesh(fg, tex.fieldMat); field.name = 'aurora-field'; field.renderOrder = 30; root.add(field);
  return { root, field };
}

// ------------------------------------------------------------------ shader / texture materials shared by both
export function makeFxMaterials(atlasTex, screenTex, ringTex, holoTex, globeTex) {
  const glow = glowTexture();
  const decalMat = new THREE.MeshBasicMaterial({ map: atlasTex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: 0.97 });
  const holoMat = new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
  const holoGlassMat = new THREE.MeshBasicMaterial({ color: 0x0a2a44, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const globeMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: globeTex }, t: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform float t; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vec4 m = texture2D(map, vUv); float land = m.r, coast = m.g;
        float lat = vUv.y * 18.0, lon = vUv.x * 36.0;
        float grid = max(1.0 - smoothstep(0.0, 0.06, abs(fract(lat) - 0.5) * 2.0 - 0.94) , 0.0) * 0.0;
        float gl = smoothstep(0.92, 1.0, abs(fract(lat) - 0.5) * 2.0) + smoothstep(0.94, 1.0, abs(fract(lon) - 0.5) * 2.0);
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float fres = pow(f, 2.2);
        float scan = 0.85 + 0.15 * sin(vUv.y * 220.0 - t * 3.0);
        vec3 sea = vec3(0.02, 0.12, 0.28), landc = vec3(0.25, 0.85, 1.0), coastc = vec3(0.75, 0.97, 1.0);
        vec3 c = mix(vec3(0.02, 0.10, 0.22), vec3(0.18, 0.62, 0.9) * scan, land) + coastc * coast * 0.5 + vec3(0.3, 0.75, 1.0) * gl * 0.25 + vec3(0.35, 0.8, 1.0) * fres * 0.7 + grid;
        float a = clamp(0.42 + land * 0.3 + coast * 0.2 + gl * 0.15 + fres * 0.5, 0.0, 0.95);
        gl_FragColor = vec4(c, a); }`,
  });
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.16 + 0.02; gl_FragColor = vec4(vec3(0.3, 0.75, 1.0) * a, a); }`,
  });
  const fieldMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, k: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float t; uniform float k; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.6);
        float b = sin(vP.z * 0.33 + t * 1.3 + sin(vP.y * 0.7 + t * 0.6) * 1.6) * 0.5 + 0.5;
        float b2 = sin(vP.z * 0.11 - t * 0.7 + vP.x * 0.3) * 0.5 + 0.5;
        float a = f * (0.25 + 0.75 * b * b) * (0.6 + 0.4 * b2) * 0.75 * k;
        vec3 c = mix(vec3(0.35, 0.78, 1.0), vec3(0.62, 0.48, 1.0), b2);
        gl_FragColor = vec4(c * a, a); }`,
  });
  return { decalMat, screenMat, ringMat, holoMat, holoGlassMat, globeMat, beamMat, fieldMat, glow };
}

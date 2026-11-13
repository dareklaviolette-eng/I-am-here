// XR Aurora · fallback outside world: a gradient sky dome (always) and a stylised glacial valley (only until real
// scenery, e.g. Google Photorealistic 3D Tiles, shows near the camera). Rendered, not real: pages label it as such.
// createBackdrop({ axis: [[x, z], ...] (the valley's centre line, scene metres), floorY, rimY, extent, centre: [x, z] })
//   -> { group, sky, terrain, update(camera), setTerrain(bool) }
import * as THREE from 'three';

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 5) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; a *= 0.5; } return s; }
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createBackdrop({ axis, floorY = 1220, rimY = 2250, extent = 26000, centre = [0, 0], domes = [], clear = [], sunDir = [0.45, 0.62, -0.64] } = {}) {
  const group = new THREE.Group(); group.name = 'aurora-backdrop';
  // ---- sky: big inverted sphere, gradient + sun glow; drawn first, never writes depth
  const sunV = new THREE.Vector3(...sunDir).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), new THREE.ShaderMaterial({
    uniforms: { sun: { value: sunV } }, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 sun; varying vec3 vD;
      void main(){ float h = clamp(vD.y, -0.2, 1.0);
        vec3 zen = vec3(0.17, 0.38, 0.72), hor = vec3(0.78, 0.86, 0.93), gnd = vec3(0.42, 0.45, 0.43);
        vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, min(1.0, -h * 6.0));
        float s = max(dot(normalize(vD), sun), 0.0); c += vec3(1.0, 0.86, 0.62) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -20; sky.frustumCulled = false; sky.name = 'aurora-sky'; group.add(sky);

  // ---- terrain: one heightfield mesh (vertex colours; haze baked by distance from the centre)
  const N = 220, half = extent / 2, pos = new Float32Array((N + 1) * (N + 1) * 3), col = new Float32Array((N + 1) * (N + 1) * 3);
  const segs = []; for (let i = 0; i + 1 < axis.length; i++) segs.push([axis[i], axis[i + 1]]);
  const distAxis = (x, z) => { let best = 1e9; for (const [a, b] of segs) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); const ex = a[0] + dx * t - x, ez = a[1] + dz * t - z; best = Math.min(best, Math.hypot(ex, ez)); } return best; };
  const H = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = centre[0] - half + extent * i / N, z = centre[1] - half + extent * j / N, d = distAxis(x, z);
    const n = fbm(x / 2400, z / 2400), n2 = fbm(x / 700 + 40, z / 700 - 13, 3);
    let h = floorY + (n2 - 0.5) * 30;
    h += (rimY - floorY) * sstep(380 + n * 260, 1250 + n * 500, d);          // sheer glacial walls
    h += 520 * sstep(1600, 9000, d) * (0.55 + n);                            // the high country beyond
    h += (n - 0.5) * 380 * sstep(900, 2500, d) + (n2 - 0.5) * 120 * sstep(500, 1400, d);
    for (const dm of domes) { const r = Math.hypot(x - dm[0], z - dm[1]); h = Math.max(h, dm[2] - Math.pow(Math.max(0, r) / dm[3], 2) * (dm[2] - floorY) * 0.9); }
    for (const cl of clear) { const r = Math.hypot(x - cl[0], z - cl[1]); if (r < cl[3]) h = Math.min(h, cl[2] + (r / cl[3]) ** 2 * 400); }   // keep the craft's parking spots clear
    H[j * (N + 1) + i] = h;
    const o = (j * (N + 1) + i) * 3; pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
  }
  const c = new THREE.Color(), forest = new THREE.Color(0x2f4a2c), meadow = new THREE.Color(0x5d7a3e), granite = new THREE.Color(0xb8b4aa), dark = new THREE.Color(0x6d6b66), snow = new THREE.Color(0xeef2f5), haze = new THREE.Color(0xb9cbdc);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, h = H[k], hx = H[k + (i < N ? 1 : -1)] - h, hz = H[k + (j < N ? N + 1 : -(N + 1))] - h;
    const slope = Math.min(1, Math.hypot(hx, hz) / (extent / N) / 1.4), x = pos[k * 3], z = pos[k * 3 + 2];
    c.copy(h < floorY + 60 ? meadow : forest).lerp(forest, sstep(floorY + 20, floorY + 120, h));
    c.lerp(granite, sstep(0.35, 0.75, slope)); c.lerp(dark, sstep(0.85, 1, slope) * 0.4 * hash(i, j));
    c.lerp(snow, sstep(2900, 3300, h) * (1 - slope * 0.6));
    c.multiplyScalar(0.92 + 0.16 * hash(i * 3, j * 7));
    c.lerp(haze, sstep(2500, 13000, Math.hypot(x - centre[0], z - centre[1])) * 0.85);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, d = a + N + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); terrain.name = 'aurora-fallback-terrain'; terrain.matrixAutoUpdate = false;
  group.add(terrain);
  const camW = new THREE.Vector3();
  return {
    group, sky, terrain,
    heightAt(x, z) { const i = Math.round((x - centre[0] + half) / extent * N), j = Math.round((z - centre[1] + half) / extent * N); if (i < 0 || j < 0 || i > N || j > N) return floorY; return H[j * (N + 1) + i]; },
    update(camera) { camera.getWorldPosition(camW); sky.position.copy(camW); sky.updateMatrixWorld(); },
    setTerrain(on) { terrain.visible = !!on; },
  };
}

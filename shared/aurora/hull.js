// XR Aurora · the exterior hull from the founder's Meshy model (shared/aurora/models/xr-aurora-hull.glb, built by
// meshy/build_aurora_hull.py: craft frame, metres, bow toward -z, 62 m long like the procedural hull it replaces).
// The texture carries no light, so the GLB holds a generated emissive map (warm lounge window band, blue aft nozzles);
// here: a chrome-friendly PMREM environment, soft additive glows at the two aft nozzles, and the hull lettering
// projected onto both flanks over the model's own (garbled) text panel. aurora.js keeps the procedural hull as the fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { canvas, texOf, glowTexture, SANS } from './panels.js';

export const HULL_URL = new URL('./models/xr-aurora-hull.glb', import.meta.url).href;
export const HULL_CREDIT = "3D hull: generated with Meshy (Pro license, owned by I'M HERE)";
// places on the model (craft frame), measured from orthographic renders of the source
const NOZZLES = [[0, 2.45, 25.4, 6.5], [0, -1.22, 25.4, 6.5]];                // [x, y, z, sprite size]
const PLATE = { z: 9.0, y: -0.55, w: 14.6, h: 3.7 };                          // the text panel aft of the window band

// the lettering: a dark plate, the name and the registration (transparent margin so clamped edges stay clear)
function plateTexture(name, reg) {
  const W = 1024, H = 260, c = canvas(W, H), g = c.getContext('2d');
  const r = 70, x = 14, y = 14, w = W - 28, h = H - 28;
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgb(16,26,40)'); gr.addColorStop(1, 'rgb(6,11,20)');
  g.fillStyle = gr; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(150,215,255,0.55)'; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(90,200,255,0.9)'; g.shadowBlur = 14; g.fillStyle = '#f2f8ff';
  g.font = `italic 800 112px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = '6px'; g.fillText(name, W / 2, 112);
  g.shadowBlur = 8; g.font = `600 52px ${SANS}`; if ('letterSpacing' in g) g.letterSpacing = '16px'; g.fillStyle = '#cfe9ff'; g.fillText(reg, W / 2, 198);
  const t = texOf(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// project a w x h rectangle onto the hull's side (side = +1: +x, -1: -x) around (y, z): the hull triangles under it,
// lifted a few centimetres along their normals, with UVs from the projector plane
function plateGeometry(geo, side, cy, cz, w, h) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
  const out = [], uv = [], nn = [], a = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = [0, 0, 0];
  for (let t = 0; t < idx.count; t += 3) {
    let inside = 0, facing = 0;
    for (let k = 0; k < 3; k++) {
      const i = idx.getX(t + k); tri[k] = i;
      a.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
      if (a.x * side > 2 && Math.abs(a.z - cz) < w / 2 + 0.6 && Math.abs(a.y - cy) < h / 2 + 0.6) inside++;
      if (n.x * side > 0.1) facing++;
    }
    if (inside === 0 || facing < 3) continue;
    for (let k = 0; k < 3; k++) {
      a.fromBufferAttribute(pos, tri[k]); n.fromBufferAttribute(nor, tri[k]);
      out.push(a.x + n.x * 0.04, a.y + n.y * 0.04, a.z + n.z * 0.04); nn.push(n.x, n.y, n.z);
      // viewer on this side, upright: text runs toward the bow on +x (right = -z), toward the stern on -x
      uv.push(0.5 + (-side * (a.z - cz)) / w, 0.5 + (a.y - cy) / h);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere(); return g;
}

// load the hull: resolves { root, mesh, glows, envMap, envRT } (not yet in the scene) or rejects (the caller keeps the fallback)
export function loadHull(renderer, { url = HULL_URL, name = 'XR AURORA', reg = 'IH-0000', timeout = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hull load timed out')), timeout);
    new GLTFLoader().load(url, (gltf) => {
      clearTimeout(timer);
      try {
        let mesh = null; gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) throw new Error('no mesh in ' + url);
        // reflections: a studio room (soft boxes) so the chrome reads as chrome from any side
        const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), envRT = pm.fromScene(room, 0.04), envMap = envRT.texture; pm.dispose();
        if (room.dispose) room.dispose(); else room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });   // only needed to bake the reflections
        const m = mesh.material;
        m.envMap = envMap; m.envMapIntensity = 1.0; m.emissive.set(0xffffff); m.emissiveIntensity = 1.1;
        m.side = THREE.FrontSide;   // the shell is closed; back faces only cost fill rate
        mesh.name = 'aurora-hull-meshy'; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        const root = new THREE.Group(); root.name = 'aurora-hull-meshy'; root.add(mesh);
        // lettering on both flanks
        const tex = plateTexture(name, reg);
        const plateMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          metalness: 0.35, roughness: 0.3, envMap, envMapIntensity: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
        for (const side of [1, -1]) {
          const p = new THREE.Mesh(plateGeometry(mesh.geometry, side, PLATE.y, PLATE.z, PLATE.w, PLATE.h), plateMat);
          p.name = 'aurora-hull-plate'; p.renderOrder = 3; p.matrixAutoUpdate = false; root.add(p);
        }
        // engine light: soft additive glows (depth-tested, so the hull hides what it should)
        const glows = new THREE.Group(); glows.name = 'aurora-hull-glows';
        const gt = glowTexture('rgba(235,250,255,1)', 'rgba(70,170,255,0.5)');
        const sm = new THREE.SpriteMaterial({ map: gt, color: 0x7fd2ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.9 });
        for (const [x, y, z, s] of NOZZLES) { const sp = new THREE.Sprite(sm); sp.position.set(x, y, z); sp.scale.setScalar(s); sp.renderOrder = 6; glows.add(sp); }
        root.add(glows);
        resolve({ root, mesh, glows, envMap, envRT });   // envRT: dispose it (not just envMap) to free the GPU memory
      } catch (er) { reject(er); }
    }, undefined, (er) => { clearTimeout(timer); reject(er); });
  });
}

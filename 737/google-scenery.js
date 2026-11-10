// I'M HERE — optional "Real scenery (Google 3D)" layer.
// Streams Google Photorealistic 3D Tiles with the 3d-tiles-renderer library and places them in the same
// local frame as the airport (origin at the airport reference point; x = west, y = up, z = north; metres).
//
// Pure maths (ecefFromLLH, localFrameMatrix) has no dependencies and is tested in Node (test/scenery-test.mjs).
// createGoogleScenery() runs only in the browser. Any failure throws, and the page falls back to flat ground.

const D2R = Math.PI / 180;
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);

// Library version: the 0.3 line works with three r165 (its three peer range is wide). Change here to upgrade.
export const TILES_LIB = 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.3/src/index.js';
export const TILES_PLUGINS = TILES_LIB.replace(/index\.js$/, 'plugins/index.js');   // only used by the 0.4+ plugin API
export const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/gltf/';
export const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';

// WGS84 latitude/longitude (degrees) + ellipsoid height (m) -> Earth-centred Earth-fixed metres (z = north pole)
export function ecefFromLLH(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p);
  const N = WGS_A / Math.sqrt(1 - WGS_E2 * sp * sp);
  return [(N + h) * cp * Math.cos(l), (N + h) * cp * Math.sin(l), (N * (1 - WGS_E2) + h) * sp];
}

// 4x4 matrix (column-major, as THREE.Matrix4.fromArray expects) taking ECEF metres to the airport frame:
// x = west, y = up, z = north, origin at (lat, lon, h).
export function localFrameMatrix(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const E = [-sl, cl, 0], Nn = [-sp * cl, -sp * sl, cp], U = [cp * cl, cp * sl, sp];
  const rows = [E.map((v) => -v), U, Nn];                 // west, up, north
  const P0 = ecefFromLLH(latDeg, lonDeg, h);
  const t = rows.map((r) => -(r[0] * P0[0] + r[1] * P0[1] + r[2] * P0[2]));
  return [rows[0][0], rows[1][0], rows[2][0], 0,
          rows[0][1], rows[1][1], rows[2][1], 0,
          rows[0][2], rows[1][2], rows[2][2], 0,
          t[0], t[1], t[2], 1];
}
export function applyMatrix(m, v) {   // helper for tests
  return [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * createGoogleScenery({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, onStatus })
 * -> Promise<{ holder, setOrigin(lat, lon, elevFt), setProbes([[x,z],...]), update(dt), setTint(hex), setOpacity(0..1), credits(), dispose() }>
 * setOpacity blends the tiles over the page's own render ("Realism"): a depth-only pre-pass draws the tiles' depth first,
 * then their colour with that opacity, so only the front surfaces show (no see-through interiors). Pixels the page marks
 * in the stencil buffer (stencil = 1: runway paint, markings, lights) are never covered by tiles. Needs a renderer with stencil.
 * holder: add to the moving world group and position it exactly like the airport group.
 */
export async function createGoogleScenery({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, onStatus = () => {} }) {
  if (!key) throw new Error('no Google key');
  // 1) Pre-flight: the key must be accepted for this web address (it is restricted to the GitHub Pages domain).
  onStatus('Checking Google 3D Tiles access…');
  const pre = await fetch(`${GOOGLE_ROOT}?key=${encodeURIComponent(key)}`);
  if (!pre.ok) {   // say why, in plain words: HTTP status + Google's own error message (key, referrer, billing, API not enabled...)
    let msg = '';
    try { const t = await pre.text(); try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { msg = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); } } catch (e) { /* no body */ }
    throw new Error(`Google 3D Tiles refused: HTTP ${pre.status}${pre.statusText ? ' ' + pre.statusText : ''}${msg ? ' - ' + msg : ''}`);
  }
  await pre.json();

  // 2) Library (same three.js instance via the page's import map)
  onStatus('Loading 3D tiles library…');
  const lib = await import(TILES_LIB);
  let tiles, hasDraco = false;
  if (lib.GoogleTilesRenderer) {                                       // 0.3.x API
    tiles = new lib.GoogleTilesRenderer(key);
  } else {                                                             // 0.4+ plugin API
    const plug = await import(TILES_PLUGINS);
    tiles = new lib.TilesRenderer();
    tiles.registerPlugin(new plug.GoogleCloudAuthPlugin({ apiToken: key }));
    if (plug.GLTFExtensionsPlugin) {
      const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
      tiles.registerPlugin(new plug.GLTFExtensionsPlugin({ dracoLoader: draco })); hasDraco = true;
    }
  }
  // Google tiles are Draco-compressed glTF: give the tile loader a Draco decoder (URLs carry ?session=… so allow a query)
  if (!hasDraco && tiles.manager && tiles.manager.addHandler) {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const gl = new GLTFLoader(tiles.manager); gl.setDRACOLoader(draco);
    tiles.manager.addHandler(/\.(gltf|glb)(\?.*)?$/i, gl);
  }
  tiles.errorTarget = 12;                     // a little coarser than default: lighter for headsets
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  // 3) Frames: holder (moves with the world) > align (vertical correction) > tiles.group (ECEF -> airport frame)
  const holder = new THREE.Group(); holder.name = 'google-3d-tiles';
  const align = new THREE.Group(); holder.add(align); align.add(tiles.group);
  const M = new THREE.Matrix4();
  let tint = new THREE.Color(0xffffff), loaded = 0, failed = 0, opacity = 1, lastError = '';
  const plainError = (e) => { const er = e && (e.error || e), m = er && (er.message || String(er)) || 'unknown error', u = e && e.url ? String(e.url).replace(/[?&]key=[^&]+/, '') : '';
    return 'tile failed to load: ' + m.slice(0, 160) + (u ? ' (' + u.slice(0, 80) + ')' : ''); };
  const stencilSkip = (m) => { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.NotEqualStencilFunc;
    m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp; };
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }); stencilSkip(depthMat);
  const colourMats = new Set();
  function applyOpacity(m) {
    m.transparent = opacity < 1; m.opacity = opacity; m.depthWrite = opacity >= 1; m.depthFunc = THREE.LessEqualDepth; m.needsUpdate = true;
  }

  const seen = new WeakSet();
  const onModel = (scene) => {
    if (!scene || seen.has(scene)) return; seen.add(scene); loaded++;
    const meshes = []; scene.traverse((o) => { if (o.isMesh && o.name !== 'depth-prepass') meshes.push(o); });   // collect first: we add children below
    meshes.forEach((o) => {
      o.renderOrder = -10;                    // after the sky, ground and the page's stencil-marked overlay
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && m.color) { m.userData.baseColor = m.color.clone(); m.color.copy(m.userData.baseColor).multiply(tint); }
      for (const m of mats) if (m) { stencilSkip(m); applyOpacity(m); colourMats.add(m); m.addEventListener('dispose', () => colourMats.delete(m)); }
      const d = new THREE.Mesh(o.geometry, depthMat); d.renderOrder = -12; d.frustumCulled = o.frustumCulled; d.name = 'depth-prepass';
      d.raycast = () => {};                   // probes hit the real tile, not its depth twin
      o.add(d);
    });
  };
  if (tiles.addEventListener) {
    tiles.addEventListener('load-model', (e) => onModel(e.scene));
    tiles.addEventListener('load-error', (e) => { failed++; lastError = plainError(e); });
  }
  tiles.onLoadModel = (scene) => onModel(scene);   // older 0.3 releases use a callback

  // Height: we do not know the local geoid height, so start at ellipsoid height = field elevation and then
  // measure the real ground under the touchdown zone with ray casts and shift the tiles so it sits at y = 0.
  let probes = [], probeClock = 0, probeCount = 0, aligned = false;
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function probe() {
    if (!probes.length) return;
    holder.updateMatrixWorld(true);
    const ys = [];
    for (const [x, z] of probes) {
      a.set(x, 4000, z); b.set(x, -4000, z); align.localToWorld(a); align.localToWorld(b);
      ray.set(a, b.sub(a).normalize()); ray.far = 8000;
      const hits = ray.intersectObject(tiles.group, true);
      if (hits.length) ys.push(align.worldToLocal(hits[0].point.clone()).y);
    }
    if (ys.length) {
      const y = median(ys);
      if (Math.abs(y) < 500) { align.position.y = -y; aligned = true; }
    }
  }

  return {
    holder, tiles,
    setOrigin(lat, lon, elevFt) {
      M.fromArray(localFrameMatrix(lat, lon, elevFt * 0.3048));
      M.decompose(tiles.group.position, tiles.group.quaternion, tiles.group.scale);
      tiles.group.matrix.copy(M);
      tiles.group.updateMatrixWorld(true);
      align.position.y = 0; aligned = false; probeCount = 0; probeClock = 1;
    },
    setProbes(list) { probes = list || []; probeCount = 0; probeClock = 1; },
    update(dt) {
      camera.updateMatrixWorld();
      tiles.setResolutionFromRenderer(camera, renderer);
      tiles.update();
      // re-measure the ground often at first (detail streams in), then every few seconds
      probeClock += dt;
      if (probeClock > (probeCount < 10 ? 1.5 : 5)) { probeClock = 0; probeCount++; try { probe(); } catch (e) { /* ignore */ } }
    },
    setTint(hex) {
      tint = new THREE.Color(hex);
      tiles.group.traverse((o) => { if (!o.isMesh) return; const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.userData.baseColor) m.color.copy(m.userData.baseColor).multiply(tint); });
    },
    stats: () => ({ loaded, failed, aligned, offset: align.position.y, lastError }),
    credits() {   // data attribution the tiles carry (required by Google)
      try {
        if (tiles.getAttributions) return tiles.getAttributions([]).filter((x) => x.type === 'string').map((x) => x.value).join('; ');
        if (tiles.getCreditsString) return tiles.getCreditsString();
      } catch (e) { /* ignore */ }
      return '';
    },
    setOpacity(a) {
      a = Math.max(0, Math.min(1, a)); if (Math.abs(a - opacity) < 0.004) return; opacity = a;
      for (const m of colourMats) applyOpacity(m);
    },
    dispose() { try { tiles.dispose(); } catch (e) { /* ignore */ } holder.removeFromParent(); depthMat.dispose(); },
  };
}

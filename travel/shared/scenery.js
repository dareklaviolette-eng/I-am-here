// I'M HERE Travel Desk · Google Photorealistic 3D Tiles for a whole region (adapted from 737/google-scenery.js, which stays
// the aviation copy: same pinned library, same auth / Draco plugins, same single 'load-model' listener).
// The tiles sit in the tour's world frame (the park's tour.js FRAME: x = west, y = up, z = north, metres), passed in as frame.
// No ground matching, no stencil: the tour never lands. Any failure throws, and the page keeps its fallback terrain.

export const TILES_LIB = 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.3.46/src/index.js';   // last 0.3: accepts three r165
export const TILES_PLUGINS = TILES_LIB.replace(/index\.js$/, 'plugins/index.js');
export const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/gltf/';
export const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out after ' + Math.round(ms / 1000) + ' s')), ms))]);
const noKey = (t) => String(t || '').replace(/([?&])key=[^&\s]+/g, '$1key=…');

// createRegionTiles({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, frame, onStatus })
//   -> { group, update(), setErrorTarget(n), setTint(hex), stats(), credits(), dispose() }
export async function createRegionTiles({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, frame, onStatus = () => {} }) {
  if (!key) throw new Error('no Google key');
  if (!frame || frame.length !== 16) throw new Error('no world frame');
  const say = (t) => { try { onStatus(t); } catch (e) { /* ignore */ } };
  say('Checking Google 3D Tiles access…');
  let pre;
  try { pre = await withTimeout(fetch(`${GOOGLE_ROOT}?key=${encodeURIComponent(key)}`), 15000, 'Google 3D Tiles check'); }
  catch (e) { throw new Error('could not reach Google 3D Tiles: ' + (e && e.message || e)); }
  if (!pre.ok) {
    let msg = ''; try { const j = await pre.json(); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { /* no body */ }
    throw new Error(`Google 3D Tiles refused: HTTP ${pre.status}${msg ? ' - ' + msg : ''}`);
  }
  say('Loading the 3D tiles library…');
  const lib = await withTimeout(import(TILES_LIB), 30000, '3D tiles library download');
  let plug = null; try { plug = await withTimeout(import(TILES_PLUGINS), 20000, '3D tiles plugins download'); } catch (e) { plug = null; }
  let tiles, hasDraco = false;
  if (plug && plug.GoogleCloudAuthPlugin && lib.TilesRenderer) {
    tiles = new lib.TilesRenderer(GOOGLE_ROOT);
    tiles.registerPlugin(new plug.GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
    if (plug.GLTFExtensionsPlugin) { tiles.registerPlugin(new plug.GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath(DRACO_PATH) })); hasDraco = true; }
  } else if (lib.GoogleTilesRenderer) tiles = new lib.GoogleTilesRenderer(key);
  else throw new Error('3D tiles library has no Google support (unexpected version)');
  if (!hasDraco && tiles.manager && tiles.manager.addHandler) {
    const gl = new GLTFLoader(tiles.manager); gl.setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH));
    tiles.manager.addHandler(/\.(gltf|glb)(\?.*)?$/i, gl);
  }
  tiles.errorTarget = 10;
  let tileCam = camera; tiles.setCamera(camera); tiles.setResolutionFromRenderer(camera, renderer);

  const group = new THREE.Group(); group.name = 'google-3d-tiles'; group.add(tiles.group);
  const M = new THREE.Matrix4().fromArray(frame);
  M.decompose(tiles.group.position, tiles.group.quaternion, tiles.group.scale); tiles.group.updateMatrixWorld(true);

  let loaded = 0, lastError = '', tint = new THREE.Color(0xffffff);
  const mats = new Set(), seen = new WeakSet();
  // ONE listener only (a second onLoadModel listener once made every tile fail silently on the 737 page). Never throws.
  const onModel = (scene) => {
    try {
      if (!scene || !scene.isObject3D || seen.has(scene)) return; seen.add(scene); loaded++;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (!m) continue;
          if (m.color) { m.userData.base = m.color.clone(); m.color.copy(m.userData.base).multiply(tint); }
          m.fog = true; mats.add(m); m.addEventListener('dispose', () => mats.delete(m));
        }
      });
    } catch (e) { lastError = 'tile setup: ' + (e && e.message || e); }
  };
  if (tiles.addEventListener) {
    tiles.addEventListener('load-model', (e) => onModel(e && e.scene));
    tiles.addEventListener('load-error', (e) => { const er = e && (e.error || e); lastError = 'tile failed: ' + noKey((er && er.message) || er).slice(0, 160); });
  } else tiles.onLoadModel = (s) => onModel(s && s.scene ? s.scene : s);
  say('Requesting Google 3D tiles…');
  return {
    group, tiles,
    update() {
      const xr = renderer.xr && renderer.xr.isPresenting ? renderer.xr.getCamera() : null, want = xr || camera;
      if (want !== tileCam) { try { tiles.deleteCamera(tileCam); } catch (e) { /* ignore */ } tiles.setCamera(want); tileCam = want; }
      if (xr) { const eye = xr.cameras && xr.cameras[0]; if (eye && eye.viewport && eye.viewport.w) tiles.setResolution(xr, eye.viewport.z, eye.viewport.w); }
      else { camera.updateMatrixWorld(); tiles.setResolutionFromRenderer(camera, renderer); }
      tiles.update();
    },
    setErrorTarget(n) { tiles.errorTarget = n; },
    setTint(hex) {
      tint.set(hex);
      for (const m of mats) if (m.userData.base) m.color.copy(m.userData.base).multiply(tint);
    },
    stats() { const s = tiles.stats || {}; return { loaded, visible: tiles.visibleTiles ? tiles.visibleTiles.size : 0, downloading: s.downloading || 0, parsing: s.parsing || 0, failed: s.failed || 0, lastError }; },
    credits() {
      try {
        if (tiles.getAttributions) return tiles.getAttributions([]).filter((x) => x.type === 'string').map((x) => x.value).join('; ');
        if (tiles.getCreditsString) return tiles.getCreditsString();
      } catch (e) { /* ignore */ }
      return '';
    },
    dispose() { try { tiles.dispose(); } catch (e) { /* ignore */ } group.removeFromParent(); },
  };
}

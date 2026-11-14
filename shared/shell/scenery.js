// One Google Photorealistic 3D Tiles instance for the whole shell (737/google-scenery.js: 3d-tiles-renderer 0.3.46 with the
// GoogleCloudAuthPlugin; its single 'load-model' listener is registered once, inside createGoogleScenery, never again).
// Stations that want real scenery ask for it; the shell moves the same instance to the new place (setOrigin) and keeps it
// across jumps (never loaded twice). Stations that don't need it (space, the sea) simply don't ask.
//
// const sc = createSceneryHost({ THREE, renderer, camera, scene, key })
//   const h = await sc.acquire({ lat, lon, elevFt = 0, parent })   -> handle | null (null: unavailable; use your fallback)
//     h.stats(), h.credits(), h.setTint(hex), h.holder, h.tiles
//   sc.release()        the station is leaving: the holder leaves the scene, the instance stays for the next station
//   sc.update(dt)       the shell calls this every frame while a station holds it
//   sc.status()         plain words for the card / debug; sc.setQuality(level) -> coarser tiles (never off)
const GOOGLE_KEY = 'AIzaSyD5_qsBFe74zBURZ8UTYFzz_7es3dPSM9A';   // the same domain-restricted key as the existing pages (GitHub Pages only)

export function createSceneryHost({ THREE, renderer, camera, key = GOOGLE_KEY, onStatus = () => {} }) {
  let inst = null, starting = null, failed = '', held = false, status = 'off', level = 0;
  async function start() {
    if (inst) return inst;
    if (failed) return null;
    if (!starting) starting = (async () => {
      try {
        const [{ createGoogleScenery }, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
          import('../../737/google-scenery.js'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js')]);
        inst = await createGoogleScenery({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, onStatus: (t) => { status = t; onStatus(t); } });
        inst.tiles.errorTarget = [12, 24, 48][level] || 48;
        return inst;
      } catch (e) {
        failed = String((e && e.message) || e || 'unavailable').replace(/[?&]key=[^&\s]+/g, '');
        status = 'Google 3D scenery unavailable: ' + failed; console.warn('[shell] ' + status);
        return null;
      }
    })();
    return starting;
  }
  const api = {
    async acquire({ lat, lon, elevFt = 0, parent }) {
      const s = await start(); if (!s) return null;
      s.setOrigin(lat, lon, elevFt); (parent || null) && parent.add(s.holder); held = true;
      return s;
    },
    release() { if (inst) inst.holder.removeFromParent(); held = false; },
    update(dt) { if (inst && held) { try { inst.update(dt); } catch (e) { failed = 'tiles update failed: ' + (e && e.message); api.release(); } } },
    setQuality(n) { level = n; if (inst && inst.tiles) inst.tiles.errorTarget = [12, 24, 48][n] || 48; },
    status: () => status, failed: () => failed, held: () => held, instance: () => inst,
  };
  return api;
}

// I'M HERE — optional "Real scenery (Google 3D)" layer.
// Streams Google Photorealistic 3D Tiles with the 3d-tiles-renderer library and places them in the same
// local frame as the airport (origin at the airport reference point; x = west, y = up, z = north; metres).
//
// Pure maths (ecefFromLLH, localFrameMatrix) has no dependencies and is tested in Node (test/scenery-test.mjs).
// createGoogleScenery() runs only in the browser. Any failure throws, and the page falls back to flat ground.

const D2R = Math.PI / 180;
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);

// Library version, pinned: 0.3.46 is the last 0.3 release and its peer range accepts three r165 (0.4 wants a newer three).
// Its plugin API (TilesRenderer + GoogleCloudAuthPlugin + GLTFExtensionsPlugin) is the pattern that worked on fly737/deck pages.
export const TILES_LIB = 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.3.46/src/index.js';
export const TILES_PLUGINS = TILES_LIB.replace(/index\.js$/, 'plugins/index.js');
export const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/gltf/';
export const GOOGLE_ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
// A tile counts as "real ground near the camera" when it is on screen, within NEAR_M of the camera and detailed
// (geometric error below NEAR_ERR m). Coarse continent-sized tiles sit far below the surface and must not count.
export const NEAR_M = 3000, NEAR_ERR = 200;

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
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out after ' + Math.round(ms / 1000) + ' s')), ms))]);
const noKey = (t) => String(t || '').replace(/([?&])key=[^&\s]+/g, '$1key=…');

/**
 * createGoogleScenery({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, onStatus })
 * -> Promise<{ holder, setOrigin(lat, lon, elevFt), setProbes([[x,z],...]), update(dt), setTint(hex), setOpacity(0..1), stats(), credits(), dispose() }>
 * stats(): { stage, requested, loaded, visible, near, failed, downloading, parsing, lastError, aligned, offset, cam:[x,y,z], camH, rootDist, opacity }
 *   near > 0 means detailed tiles are on screen close to the camera: only then should a page hide its own drawn ground.
 * setOpacity blends the tiles over the page's own render ("Realism"): a depth-only pre-pass draws the tiles' depth first,
 * then their colour with that opacity, so only the front surfaces show (no see-through interiors). Pixels the page marks
 * in the stencil buffer (stencil = 1: runway paint, markings, lights) are never covered by tiles. Needs a renderer with stencil.
 * holder: add to the moving world group and position it exactly like the airport group.
 * Every stage reports through onStatus and stats().stage, and every stage that waits on the network has a time limit.
 */
export async function createGoogleScenery({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key, onStatus = () => {} }) {
  if (!key) throw new Error('no Google key');
  let stage = '';
  const say = (t) => { stage = t; try { onStatus(t); } catch (e) { /* ignore */ } };
  // 1) Pre-flight: the key must be accepted for this web address (it is restricted to the GitHub Pages domain).
  say('Checking Google 3D Tiles access…');
  let pre;
  try { pre = await withTimeout(fetch(`${GOOGLE_ROOT}?key=${encodeURIComponent(key)}`), 15000, 'Google 3D Tiles check'); }
  catch (e) { throw new Error('could not reach Google 3D Tiles: ' + (e && e.message || e)); }
  if (!pre.ok) {   // say why, in plain words: HTTP status + Google's own error message (key, referrer, billing, API not enabled...)
    let msg = '';
    try { const t = await pre.text(); try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) { msg = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160); } } catch (e) { /* no body */ }
    throw new Error(`Google 3D Tiles refused: HTTP ${pre.status}${pre.statusText ? ' ' + pre.statusText : ''}${msg ? ' - ' + msg : ''}`);
  }
  await pre.json();

  // 2) Library (same three.js instance via the page's import map: "three" and "three/examples/jsm/" must be mapped)
  say('Loading 3D tiles library…');
  let lib, plug = null;
  try { lib = await withTimeout(import(TILES_LIB), 30000, '3D tiles library download'); }
  catch (e) { throw new Error('3D tiles library did not load: ' + (e && e.message || e)); }
  try { plug = await withTimeout(import(TILES_PLUGINS), 20000, '3D tiles plugins download'); } catch (e) { plug = null; }
  say('Starting Google 3D tiles…');
  let tiles, hasDraco = false, authPlugin = null;
  if (plug && plug.GoogleCloudAuthPlugin && lib.TilesRenderer) {          // plugin API (0.3.3x+ and 0.4+): the working pattern
    tiles = new lib.TilesRenderer(GOOGLE_ROOT);
    authPlugin = new plug.GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true });
    tiles.registerPlugin(authPlugin);
    if (plug.GLTFExtensionsPlugin) {
      const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
      tiles.registerPlugin(new plug.GLTFExtensionsPlugin({ dracoLoader: draco })); hasDraco = true;
    }
  } else if (lib.GoogleTilesRenderer) {                                  // old 0.3 API
    tiles = new lib.GoogleTilesRenderer(key);
  } else throw new Error('3D tiles library has no Google support (unexpected version)');
  // Google tiles are Draco-compressed glTF: give the tile loader a Draco decoder if no plugin did
  if (!hasDraco && tiles.manager && tiles.manager.addHandler) {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const gl = new GLTFLoader(tiles.manager); gl.setDRACOLoader(draco);
    tiles.manager.addHandler(/\.(gltf|glb)(\?.*)?$/i, gl);
  }
  tiles.errorTarget = 12;                     // a little coarser than default: lighter for headsets
  let tileCam = camera;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  // Count requests and catch errors. The 0.3 library logs tile failures with console.error and fires no event,
  // so listen there too (only messages about tiles), to show the last error in plain words.
  let requested = 0, loaded = 0, failedEv = 0, lastError = '';
  const fetcher = authPlugin && authPlugin.fetchData ? authPlugin : null;
  if (fetcher) { const f = fetcher.fetchData.bind(fetcher); fetcher.fetchData = (...a) => { requested++; return f(...a); }; }
  const origError = console.error;
  const errHook = function (...args) {
    try {
      const txt = args.map((a) => (a && a.message) || (typeof a === 'string' ? a : '')).join(' ');
      if (/TilesRenderer|tile|draco|gltf|googleapis/i.test(txt) || args.some((a) => a && a.stack && /3d-tiles|google-scenery/.test(a.stack))) lastError = noKey(txt).slice(0, 200);
    } catch (e) { /* ignore */ }
    return origError.apply(this, args);
  };
  console.error = errHook;

  // 3) Frames: holder (moves with the world) > align (vertical correction) > tiles.group (ECEF -> airport frame)
  const holder = new THREE.Group(); holder.name = 'google-3d-tiles';
  const align = new THREE.Group(); holder.add(align); align.add(tiles.group);
  const M = new THREE.Matrix4();
  let tint = new THREE.Color(0xffffff), opacity = 1;
  const plainError = (e) => { const er = e && (e.error || e), m = er && (er.message || String(er)) || 'unknown error', u = e && e.url ? noKey(e.url) : '';
    return 'tile failed to load: ' + m.slice(0, 160) + (u ? ' (' + u.slice(0, 80) + ')' : ''); };
  const stencilSkip = (m) => { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.NotEqualStencilFunc;
    m.stencilFail = m.stencilZFail = m.stencilZPass = THREE.KeepStencilOp; };
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }); stencilSkip(depthMat);
  const colourMats = new Set();
  function applyOpacity(m) {
    m.transparent = opacity < 1; m.opacity = opacity; m.depthWrite = opacity >= 1; m.depthFunc = THREE.LessEqualDepth; m.needsUpdate = true;
  }

  const seen = new WeakSet();
  // NEVER throw from here: an exception inside the library's 'load-model' event marks the tile as failed, silently.
  // (That was the bug: the old "tiles.onLoadModel = ..." line registered a second listener that got the event object,
  // threw "scene.traverse is not a function", and every tile failed while the counter still said "loaded".)
  const onModel = (scene) => {
    try {
      if (!scene || !scene.isObject3D || seen.has(scene)) return; seen.add(scene); loaded++;
      const meshes = []; scene.traverse((o) => { if (o.isMesh && o.name !== 'depth-prepass') meshes.push(o); });   // collect first: we add children below
      meshes.forEach((o) => {
        o.renderOrder = -10;                    // after the sky, ground and the page's stencil-marked overlay
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.color) { m.userData.baseColor = m.color.clone(); m.color.copy(m.userData.baseColor).multiply(tint); }
        for (const m of mats) if (m) { if (m.map) m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); stencilSkip(m); applyOpacity(m); colourMats.add(m); m.addEventListener('dispose', () => colourMats.delete(m)); }
        const d = new THREE.Mesh(o.geometry, depthMat); d.renderOrder = -12; d.frustumCulled = o.frustumCulled; d.name = 'depth-prepass';
        d.raycast = () => {};                   // probes hit the real tile, not its depth twin
        o.add(d);
      });
    } catch (e) { lastError = 'tile setup: ' + (e && e.message || e); }
  };
  if (tiles.addEventListener) {
    tiles.addEventListener('load-model', (e) => onModel(e && e.scene));
    tiles.addEventListener('load-error', (e) => { failedEv++; lastError = plainError(e); });   // 0.4+ only
  } else tiles.onLoadModel = (scene) => onModel(scene && scene.scene ? scene.scene : scene);

  // Height: we do not know the local geoid height, so start at ellipsoid height = field elevation and then
  // measure the real ground under the touchdown zone with ray casts and shift the tiles so it sits at y = 0.
  // Only measured once detailed tiles are on screen near the camera (coarse tiles sit hundreds of metres too low).
  let probes = [], probeClock = 0, probeCount = 0, aligned = false, near = 0, nearestM = Infinity;
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
  function countNear() {
    let n = 0, best = Infinity;
    for (const t of tiles.visibleTiles || []) {
      const d = t.__distanceFromCamera, err = t.geometricError;
      if (isFinite(d)) best = Math.min(best, d);
      if (d < NEAR_M && err < NEAR_ERR) n++;
    }
    near = n; nearestM = best;
  }
  const camW = new THREE.Vector3(), carto = {};
  function camInfo() {
    let cam = [NaN, NaN, NaN], camH = NaN, rootDist = NaN;
    try {
      tileCam.getWorldPosition(camW); const l = align.worldToLocal(camW.clone()); cam = [l.x, l.y, l.z];
      const info = tiles.cameraInfo && tiles.cameraInfo[0];
      if (info && info.position) {
        if (tiles.ellipsoid && tiles.ellipsoid.getPositionToCartographic) camH = tiles.ellipsoid.getPositionToCartographic(info.position, carto).height;
        const r = tiles.root; if (r && r.cached && r.cached.boundingVolume) rootDist = r.cached.boundingVolume.distanceToPoint(info.position);
      }
    } catch (e) { /* ignore */ }
    return { cam, camH, rootDist };
  }
  say('Requesting Google 3D tiles…');

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
      // In a headset the renderer draws with the XR camera: let the tiles pick detail for that one (as fly737 did)
      const xr = renderer.xr && renderer.xr.isPresenting ? renderer.xr.getCamera() : null, want = xr || camera;
      if (want !== tileCam) { try { tiles.deleteCamera(tileCam); } catch (e) { /* ignore */ } tiles.setCamera(want); tileCam = want; }
      if (xr) { const eye = xr.cameras && xr.cameras[0]; if (eye && eye.viewport && eye.viewport.w) tiles.setResolution(xr, eye.viewport.z, eye.viewport.w); }
      else { camera.updateMatrixWorld(); tiles.setResolutionFromRenderer(camera, renderer); }
      holder.updateWorldMatrix(true, true);   // the page moved the holder this frame: tiles must see the current frame
      tiles.update();
      countNear();
      // re-measure the ground often at first (detail streams in), then every few seconds
      probeClock += dt;
      if (near > 0 && probeClock > (probeCount < 10 ? 1.5 : 5)) { probeClock = 0; probeCount++; try { probe(); } catch (e) { /* ignore */ } }
      if (near > 0) stage = aligned ? 'Google 3D tiles on (ground matched)' : 'Google 3D tiles on';
      else if (loaded > 0) stage = 'Streaming Google 3D tiles (detail not near the camera yet)…';
    },
    setTint(hex) {
      tint = new THREE.Color(hex);
      tiles.group.traverse((o) => { if (!o.isMesh) return; const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.userData.baseColor) m.color.copy(m.userData.baseColor).multiply(tint); });
    },
    stats: () => {
      const s = tiles.stats || {}, f = Math.max(failedEv, s.failed || 0);
      return { stage, requested, loaded, visible: tiles.visibleTiles ? tiles.visibleTiles.size : 0, near, nearestM, failed: f,
        downloading: s.downloading || 0, parsing: s.parsing || 0, aligned, offset: align.position.y, opacity,
        lastError: lastError || (f ? f + ' tile(s) failed (see console)' : ''), ...camInfo() };
    },
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
    dispose() { if (console.error === errHook) console.error = origError; try { tiles.dispose(); } catch (e) { /* ignore */ } holder.removeFromParent(); depthMat.dispose(); },
  };
}

// Small debug readout, bottom left (pages show it when the URL has ?debug=1). lines() returns an array of strings.
export function debugOverlay(lines, { bottom = 60 } = {}) {
  const el = document.createElement('pre'); el.id = 'gsDebug';
  el.style.cssText = `position:fixed;left:6px;bottom:${bottom}px;z-index:9999;margin:0;padding:5px 7px;max-width:min(360px,70vw);` +
    'font:10px/1.35 ui-monospace,Menlo,monospace;color:#d8ffe9;background:rgba(0,0,0,.62);border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-word';
  document.body.appendChild(el);
  const tick = () => { try { el.textContent = lines().join('\n'); } catch (e) { el.textContent = 'debug: ' + e.message; } };
  tick(); setInterval(tick, 400);
  return el;
}
// Standard lines for the scenery part of the readout
export function debugLines(sc, extra = {}) {
  const f = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—');
  const out = [];
  if (extra.status) out.push('scenery: ' + extra.status);
  if (!sc) out.push('tiles: none yet');
  else {
    const s = sc.stats();
    out.push(`stage: ${s.stage}`,
      `tiles req ${s.requested} · loaded ${s.loaded} · visible ${s.visible} · near ${s.near} · failed ${s.failed}`,
      `queue dl ${s.downloading} · parse ${s.parsing} · nearest ${f(s.nearestM)} m`,
      `cam local x ${f(s.cam[0])} y ${f(s.cam[1])} z ${f(s.cam[2])} m`,
      `cam ellipsoid h ${f(s.camH)} m · root dist ${f(s.rootDist)} m`,
      `ground match ${s.aligned ? 'yes' : 'no'} (offset ${f(s.offset, 1)} m) · tile opacity ${f(s.opacity, 2)}`,
      `last error: ${s.lastError || 'none'}`);
  }
  for (const [k, v] of Object.entries(extra)) if (k !== 'status') out.push(`${k}: ${v}`);
  return out;
}

// I'M HERE XR shell: the one host page that loads any world (a station), so you jump from a ship to the XR Aurora and on
// without ever leaving VR. Station Rules v1 (Nov 14). The shell owns everything you carry everywhere:
//   renderer, scene, camera rig, the WebXR session, xr-safety (Exit VR, B / Y, watchdog quality levels, recenter), the blink
//   and the arrival moment, sound volume, the EFB (VR) / panel (screens), the I'M HERE card + top bar (screens), the one
//   Google 3D tiles instance (moved per station, never loaded twice), the concierge, the Be There reveal, and the registry.
// A station never builds its own copy of any of these. The contract is in shared/shell/STATION_KIT.md.
import * as THREE from 'three';
import { STATIONS, DEFAULT_STATION, getStation, allPlaces, placeById, placeFor } from './registry.js';
import { createConcierge } from './concierge.js';
import { createEFB } from './efb.js';
import { createEFBAccess } from './efb-access.js';
import { createBlink } from './blink.js';
import { createSceneryHost } from './scenery.js';
import { renderHero } from './reveal.js';
import { createSound } from './sound.js';
import { disposeDeep, parseHash, makeHash, wait } from './util.js';

const ARRIVAL_MIN_MS = 1400, ARRIVAL_MAX_LOAD_MS = 45000, LOOK_PITCH = -0.06;
const $ = (id) => document.getElementById(id);

export async function startShell({ host = $('view') } = {}) {
  const Q = new URLSearchParams(location.search), TEST = Q.has('test');
  // ------------------------------------------------------------------ renderer, scene, camera rig
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.name = 'shell';
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 200000);
  const rig = new THREE.Group(); rig.name = 'shell-rig'; rig.add(camera); scene.add(rig);
  const DEF = { fov: 62, near: 0.05, far: 200000, exposure: 1.0 };
  const fit = () => { if (renderer.xr.isPresenting) return; camera.aspect = innerWidth / innerHeight; camera.fov = camera.aspect < 0.8 ? Math.max(camera.fov, 80) : env.fov || DEF.fov; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
  addEventListener('resize', fit);
  let env = {};

  // ------------------------------------------------------------------ VR safety (shared/xr-safety.js): Exit VR on the EFB, B / Y, watchdog
  const sound = createSound();
  const blink = createBlink({ THREE, rig, camera });
  const scenery = createSceneryHost({ THREE, renderer, camera });
  let quality = 0;
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const XRS = window.ImHereXR ? window.ImHereXR.install({ THREE, renderer, scene, camera, scale: 0.9, rays: true, panel: false, exitButtons: [5],
    hint: 'Point + select · EFB at your left knee · B or Y: exit VR',
    onQuality: (n) => { quality = n; blink.fancy = n < 1 && !reduced; scenery.setQuality(n); if (cur) safe(() => cur.st.act({ type: 'quality', level: n })); } }) : null;
  if (reduced) blink.fancy = false;

  // ------------------------------------------------------------------ the concierge, the EFB and how you reach it
  const places = allPlaces();
  const concierge = createConcierge({ places, stations: STATIONS, fallbackPlace: 'boats:sydney' });
  const efb = createEFB({ onAction: efbAction, onQuery: (t) => concierge.quick(t, conciergeCtx()) });
  efb.set({ places, volume: sound.volume });
  const access = createEFBAccess({ THREE, renderer, rig, camera, efb, onPOV: (id) => povChange(id),
    dockData: () => ({ povs: efbData.povs || [], pov: efbData.pov, title: cur ? (cur.title || cur.meta.name) : '' }) });
  access.setVisible(false);
  let efbData = {}, recent = [];
  try { recent = JSON.parse(localStorage.getItem('imhere.xr.recent') || '[]').slice(0, 6); } catch (e) { recent = []; }
  efb.set({ recent });

  // screens: the EFB panel (the very same canvas) + the globe button that opens it
  const panelEl = $('efbPanel'), efbBtn = $('efbBtn');
  if (panelEl) {
    panelEl.appendChild(efb.canvas);
    const toPx = (ev) => { const r = efb.canvas.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * efb.canvas.width, (ev.clientY - r.top) / r.height * efb.canvas.height]; };
    efb.canvas.addEventListener('click', (ev) => { sound.unlock(); const [x, y] = toPx(ev); efb.click(x, y); });
    efb.canvas.addEventListener('mousemove', (ev) => { const [x, y] = toPx(ev); efb.hover(x, y); efb.canvas.style.cursor = efb.hitTest(x, y) ? 'pointer' : ''; });
    efb.canvas.addEventListener('mouseleave', () => efb.hover(null));
  }
  if (efbBtn) efbBtn.onclick = () => { sound.unlock(); if (panelOpen()) closePanel(); else openEFB('concierge'); };
  addEventListener('keydown', (ev) => {
    if (!panelOpen() || ev.metaKey || ev.ctrlKey) return;
    if (ev.key === 'Escape') { efb.back(); return; }
    if (efb.page === 'concierge' && (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Enter')) { efb.key(ev.key === ' ' ? 'space' : ev.key); ev.preventDefault(); }
  });
  function panelOpen() { return renderer.xr.isPresenting ? access.isOpen() : !!(panelEl && !panelEl.hidden); }
  function openEFB(page) {
    if (page === 'home') efb.home(); else if (page) { efb.home(); efb.go(page); }
    if (renderer.xr.isPresenting) access.open(); else if (panelEl) { panelEl.hidden = false; efb.flush(); }
  }
  function closePanel() { if (renderer.xr.isPresenting) access.stow(); else if (panelEl) panelEl.hidden = true; }
  setInterval(() => { efb.flush(); }, 120);   // EFB redraws happen here (on change, ~8 Hz max), never inside the frame loop

  function efbAction(type, val, arg) {
    sound.unlock();
    switch (type) {
      case 'stow': closePanel(); return;
      case 'pov': povChange(val); return;
      case 'list': if (cur) { const it = (efbData.list || []).find((x) => String(x.id) === String(val)); if (it && it.target) openReveal(targetReveal(it.target)); else safe(() => cur.st.act({ type: 'stop', id: val })); } return;
      case 'layer': if (cur) { const l = (efbData.layers || []).find((x) => x[0] === val); if (l && !l[3]) safe(() => cur.st.act({ type: 'layer', id: val, on: !l[2] })); } return;
      case 'time': if (cur) safe(() => cur.st.act({ type: 'time', mode: val })); return;
      case 'vol': sound.setVolume(sound.volume + (val === '+' ? 0.1 : -0.1)); efb.set({ volume: sound.volume }); return;
      case 'recenter': recenter(); return;
      case 'exit': if (XRS) XRS.exit('Exit VR on the EFB'); return;
      case 'pick': pickResult(val); return;
      case 'pickPlace': openReveal(placeReveal(val)); return;
      case 'bethere': beThere(val); return;
    }
  }
  function conciergeCtx() { return { targets: cur ? safe(() => cur.st.targets()) || [] : [], station: cur && cur.meta.id }; }
  function pickResult(r) {
    if (!r || r.soon) { toast((r && r.title) || 'Coming soon'); return; }
    if (r.targetId && cur) { const t = (safe(() => cur.st.targets()) || []).find((x) => x.id === r.targetId); if (t) { openReveal(targetReveal(t)); return; } }
    const p = r.placeId ? placeById(r.placeId) : null;
    if (p) { openReveal(placeReveal(p)); return; }
    if (r.station) openReveal({ kicker: 'Station', title: r.title, line: r.sub, tag: r.tag, go: { station: r.station, params: r.params || {} }, hero: heroFor(getStation(r.station), null) });
  }

  // ------------------------------------------------------------------ the Be There reveal
  function placeReveal(p) {
    const meta = getStation(p.station), here = cur && cur.meta.id === p.station && placeFor(p.station, cur.params) && placeFor(p.station, cur.params).id === p.id;
    return { kicker: meta ? meta.name : 'Be There', title: p.name, line: p.sub, tag: p.tag, here, go: { station: p.station, params: p.params }, place: p, hero: heroFor(meta, p) };
  }
  function targetReveal(t) {
    return { kicker: 'Be There', title: t.name, line: t.line, tag: t.tag, go: { station: t.station || (cur && cur.meta.id), params: t.params || null, targetId: t.id }, here: !!t.here,
      hero: t.hero ? () => Promise.resolve(t.hero(THREE)).then((r) => (r && r.object ? r : r ? { object: r } : null)) : null, photo: t.photo || null };
  }
  function heroFor(meta, place) { return meta && meta.hero ? () => meta.hero(THREE, place, renderer) : null; }
  let heroJob = 0, heroQueue = null;
  function openReveal(R) {
    const job = ++heroJob;
    efb.set({ reveal: Object.assign({ busy: !!R.hero, image: null, imageNote: R.photo ? R.photo.credit : '' }, R) });
    openEFB('reveal');
    if (R.photo && R.photo.src) {   // a licensed photo (none yet): load it, credit it
      const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { if (job === heroJob) efb.set({ reveal: Object.assign({}, efb.state.reveal, { image: im, busy: false }) }); }; im.src = R.photo.src;
      return;
    }
    if (!R.hero) return;
    Promise.resolve().then(R.hero).then((h) => {
      if (!h || job !== heroJob) { if (h && h.dispose) h.dispose(); return; }
      heroQueue = () => {   // drawn at the start of the next frame (outside the XR frame's own render)
        let img = null; try { img = renderHero(THREE, renderer, h.object); } catch (e) { console.warn('[shell] hero render', e); }
        try { if (!h.shared) disposeDeep(h.object); if (h.dispose) h.dispose(); } catch (e) { /* ignore */ }
        if (job === heroJob) efb.set({ reveal: Object.assign({}, efb.state.reveal, { image: img, busy: false, imageNote: h.note || 'Rendered' }) });
      };
    }).catch((e) => { console.warn('[shell] hero', e && e.message || e); if (job === heroJob) efb.set({ reveal: Object.assign({}, efb.state.reveal, { busy: false }) }); });
  }
  async function beThere(R) {
    if (!R || !R.go || R.here) return;
    const g = R.go;
    if (cur && g.station === cur.meta.id && g.targetId != null && !g.params) {   // same world: hop (blink, no reload)
      closePanel(); await blink.out(0.18); safe(() => cur.st.act({ type: 'target', id: g.targetId })); await blink.in(0.3); return;
    }
    closePanel(); jump(g.station, Object.assign({}, g.params || {}, g.targetId != null && g.params ? { target: g.targetId } : {}));
  }

  // ------------------------------------------------------------------ card + top bar (screens; in VR the card is on the EFB)
  const Card = window.ImHereCard, Bar = window.ImHereTopbar;
  const hereList = document.createElement('div'); hereList.className = 'side-list';
  const goList = document.createElement('div'); goList.className = 'side-list';
  for (const st of STATIONS.filter((s) => !s.hidden)) {
    const h = document.createElement('div'); h.className = 'side-h'; h.textContent = st.name; goList.appendChild(h);
    for (const p of (st.places || []).filter((x) => x.kind !== 'stop')) { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name; b.onclick = () => openReveal(placeReveal(p)); goList.appendChild(b); }
  }
  if (Card) Card.init({ zIndex: 1500, loc: '', org: "I'M HERE", sig: { source: 'Shell', tag: '' } });
  if (Bar) Bar.init({
    zIndex: 1600, storageKey: 'imhere.xr',
    sections: [{ id: 'here', title: 'Here', el: hereList, open: true }, { id: 'go', title: 'Where to', el: goList, open: false }],
    model: () => ({
      live: !!(cur && cur.card && cur.card.live), tag: true,
      data: cur && cur.card ? [['LOC', cur.card.loc], ['POV', cur.card.pov]].concat(efbData.data || []).filter((x) => x[1]) : [],
      pov: (efbData.povs || []).map(([id, l]) => ['pov:' + id, l, '', id === efbData.pov ? 'sel' : '']),
      layers: (efbData.layers || []).map(([id, l, on, dis]) => ['lay:' + id, l, dis ? 'soon' : '', dis ? 'dis' : on ? 'on' : 'off']),
      sideTitle: efbData.listTitle || '', sideItems: (efbData.list || []).map((it) => ['list:' + it.id, it.name, it.sub || '', it.sel ? 'sel' : '']),
      credit: cur && cur.credit ? cur.credit : null,
    }),
    onAction: (id) => {
      if (id.startsWith('pov:')) povChange(id.slice(4));
      else if (id.startsWith('lay:')) efbAction('layer', id.slice(4));
      else if (id.startsWith('list:')) efbAction('list', id.slice(5));
    },
  });
  function renderHere() {
    hereList.textContent = '';
    const t = document.createElement('div'); t.className = 'side-h'; t.textContent = efbData.listTitle || ''; hereList.appendChild(t);
    for (const it of efbData.list || []) { const b = document.createElement('button'); b.type = 'button'; b.textContent = it.name + (it.sub ? ' · ' + it.sub : ''); if (it.sel) b.setAttribute('aria-current', 'true'); b.onclick = () => efbAction('list', it.id); hereList.appendChild(b); }
  }

  // ------------------------------------------------------------------ toast (screens: DOM; VR: a small panel where you look, then it stays)
  const toastEl = $('toast'); let toastT = 0;
  const tc = document.createElement('canvas'); tc.width = 1024; tc.height = 112; const tg = tc.getContext('2d');
  const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace;
  const toastMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.068), new THREE.MeshBasicMaterial({ map: ttex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  toastMesh.renderOrder = 9500; toastMesh.visible = false; rig.add(toastMesh);
  let toastUntil = 0;
  const eT = new THREE.Euler(0, 0, 0, 'YXZ');
  function toast(text) {
    if (toastEl) { toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3200); }
    if (renderer.xr.isPresenting) {
      tg.clearRect(0, 0, 1024, 112); tg.fillStyle = 'rgba(8,18,32,0.9)'; tg.beginPath(); tg.roundRect ? tg.roundRect(4, 4, 1016, 104, 52) : tg.rect(4, 4, 1016, 104); tg.fill();
      tg.lineWidth = 3; tg.strokeStyle = 'rgba(111,220,255,0.8)'; tg.stroke(); tg.font = '600 46px system-ui,sans-serif'; tg.fillStyle = '#fff'; tg.textAlign = 'center'; tg.textBaseline = 'middle';
      tg.fillText(String(text).slice(0, 48), 512, 58); ttex.needsUpdate = true;
      eT.setFromQuaternion(camera.quaternion, 'YXZ');
      toastMesh.position.set(camera.position.x - Math.sin(eT.y) * 0.9, camera.position.y - 0.32, camera.position.z - Math.cos(eT.y) * 0.9); toastMesh.rotation.set(-0.3, eT.y, 0, 'YXZ');
      toastMesh.visible = true; toastUntil = performance.now() + 3200;
    }
  }

  // ------------------------------------------------------------------ the seat: where a station puts your eye (comfort rules shared by every ride)
  // VR: the rig stays level, your head moves freely in it; Recenter makes the way you face "forward" and your spot the seat.
  // Screens: drag to look around (yaw / pitch), the station sets the eye and the forward direction.
  const look = { yaw: 0, pitch: LOOK_PITCH }, rc = { x: 0, z: 0, yaw: 0 };
  let headY = null, heightAdj = 0;
  function placeSeat(x, y, z, yaw) {
    if (renderer.xr.isPresenting) {
      headY = headY == null ? camera.position.y || 1.6 : headY + (camera.position.y - headY) * 0.05;
      const R = yaw - rc.yaw, c = Math.cos(R), s = Math.sin(R);
      rig.rotation.set(0, R, 0, 'YXZ');
      rig.position.set(x - (rc.x * c + rc.z * s), y - (headY || 1.6) + heightAdj, z - (-rc.x * s + rc.z * c));
    } else {
      rig.position.set(x, y, z); rig.rotation.set(0, yaw, 0, 'YXZ');
      camera.position.set(0, 0, 0); camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    }
  }
  const eH = new THREE.Euler(0, 0, 0, 'YXZ');
  function recenter() {
    if (renderer.xr.isPresenting) { eH.setFromQuaternion(camera.quaternion, 'YXZ'); rc.yaw = eH.y; rc.x = camera.position.x; rc.z = camera.position.z; headY = camera.position.y; access.mount(); }
    else { look.yaw = 0; look.pitch = cur && cur.lookPitch != null ? cur.lookPitch : LOOK_PITCH; }
    if (cur) safe(() => cur.st.act({ type: 'recenter' }));
  }
  // screens: drag to look; tap = select in the world; mouse hover = hover (the station highlights its targets)
  const dom = renderer.domElement; let drag = null;
  dom.addEventListener('pointerdown', (ev) => { sound.unlock(); drag = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, moved: false }; });
  addEventListener('pointermove', (ev) => {
    if (drag) {
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 6) drag.moved = true;
      if (drag.moved && !(cur && cur.ownsCamera)) { look.yaw -= (ev.clientX - drag.x) * 0.0045; look.pitch = Math.max(-1.2, Math.min(1.0, look.pitch - (ev.clientY - drag.y) * 0.0035)); }
      drag.x = ev.clientX; drag.y = ev.clientY;
    } else if (ev.pointerType === 'mouse' && ev.target === dom && cur && cur.st.pointer) { screenRay(ev.clientX, ev.clientY); safe(() => cur.st.pointer('hover', rO, rD)); }
  });
  addEventListener('pointerup', (ev) => {
    const d = drag; drag = null;
    if (d && !d.moved && ev.target === dom && cur && cur.st.pointer) { screenRay(ev.clientX, ev.clientY); safe(() => cur.st.pointer('select', rO, rD)); }
  });
  const rO = new THREE.Vector3(), rD = new THREE.Vector3(), q = new THREE.Quaternion();
  function screenRay(cx, cy) {
    const r = dom.getBoundingClientRect();
    camera.updateMatrixWorld(); rO.setFromMatrixPosition(camera.matrixWorld);
    rD.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, 0.5).unproject(camera).sub(rO).normalize();
  }

  // ------------------------------------------------------------------ VR input: point + select (trigger or pinch); EFB first, then the station
  let session = null, xrRef = null;
  function poseRay(frame, src, ref) {
    const p = frame.getPose(src.targetRaySpace, ref); if (!p) return false;
    const t = p.transform.position, o = p.transform.orientation;
    rig.updateMatrixWorld();
    rO.set(t.x, t.y, t.z).applyMatrix4(rig.matrixWorld);
    rD.set(0, 0, -1).applyQuaternion(q.set(o.x, o.y, o.z, o.w)).transformDirection(rig.matrixWorld);
    return true;
  }
  function onSelectStart(ev) {
    try {
      sound.unlock();
      const ref = renderer.xr.getReferenceSpace(); if (!ref || !ev.frame || !poseRay(ev.frame, ev.inputSource, ref)) return;
      if (access.ray(rO, rD, true)) return;
      if (cur && cur.st.pointer) cur.st.pointer('select', rO, rD);
    } catch (e) { console.error('[shell] select', e); }
  }
  let hoverAt = 0;
  function xrHover(now) {
    if (now - hoverAt < 90) return; hoverAt = now;
    const frame = renderer.xr.getFrame && renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace(); if (!frame || !ref || !session) return;
    const srcs = session.inputSources;
    for (let i = 0; i < srcs.length; i++) {
      if (!poseRay(frame, srcs[i], ref)) continue;
      if (access.ray(rO, rD, false)) continue;
      if (cur && cur.st.pointer) cur.st.pointer('hover', rO, rD);
    }
    access.hoverEnd(); if (cur && cur.st.pointer) cur.st.pointer('hoverEnd');
  }
  const onRefReset = () => recenter();
  renderer.xr.addEventListener('sessionstart', () => {
    session = renderer.xr.getSession(); session.addEventListener('selectstart', onSelectStart);
    try { xrRef = renderer.xr.getReferenceSpace(); if (xrRef && xrRef.addEventListener) xrRef.addEventListener('reset', onRefReset); } catch (e) { xrRef = null; }
    rc.x = rc.z = rc.yaw = 0; headY = null; heightAdj = 0;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    if (panelEl) panelEl.hidden = true;
    if (Bar) Bar.setXR(true); if (Card && Card.setShown) Card.setShown(false);
    efb.set({ xr: true }); access.setVisible(true); setTimeout(() => access.mount(), 300);
    const vb = $('vrBtn'); if (vb) vb.hidden = true;
    if (cur) safe(() => cur.st.act({ type: 'xr', on: true }));
  });
  renderer.xr.addEventListener('sessionend', () => {
    if (session) session.removeEventListener('selectstart', onSelectStart); session = null;
    try { if (xrRef && xrRef.removeEventListener) xrRef.removeEventListener('reset', onRefReset); } catch (e) { /* ignore */ } xrRef = null;
    access.stow(); access.setVisible(false); toastMesh.visible = false;
    if (Bar) Bar.setXR(false); if (Card && Card.setShown) Card.setShown(true);
    efb.set({ xr: false }); camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    const vb = $('vrBtn'); if (vb) vb.hidden = false;
    fit(); if (cur) safe(() => cur.st.act({ type: 'xr', on: false }));
  });
  (async () => {
    const vb = $('vrBtn'); if (!vb || !navigator.xr || !navigator.xr.isSessionSupported) return;
    let ok = false; try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { ok = false; }
    if (!ok) return; vb.hidden = false;
    vb.onclick = async () => {
      sound.unlock(); if (renderer.xr.isPresenting) return;
      try { const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] }); await renderer.xr.setSession(s); }
      catch (e) { toast('VR could not start: ' + (e && e.message || e)); }
    };
  })();

  // ------------------------------------------------------------------ stations: load behind, blink + arrival, swap, unload
  let cur = null, jumping = false, queued = null, ready = false, jumps = 0, lastError = '';
  function safe(fn) { try { return fn(); } catch (e) { console.error('[shell] station', e); return undefined; } }
  function makeCtx(meta, root, params) {
    const listeners = [], timers = new Set();
    const ctx = {
      THREE, renderer, scene, camera, rig, root, params, meta, sound,
      isXR: () => renderer.xr.isPresenting, quality: () => quality,
      // the station's look of the world (applied when it arrives, reset when it leaves)
      setEnv(o) { Object.assign(ctx.env, o); if (cur && cur.ctx === ctx) applyEnv(ctx.env); },
      env: {},
      placeSeat, look, recenter, setLookPitch(p) { ctx.lookPitch = p; if (cur && cur.ctx === ctx) { cur.lookPitch = p; look.pitch = p; } },
      ownsCamera(b) { ctx._ownsCamera = !!b; if (cur && cur.ctx === ctx) cur.ownsCamera = !!b; },
      toast: (t) => { if (!cur || cur.ctx === ctx) toast(t); },
      setCard(d) { ctx._card = d; if (cur && cur.ctx === ctx) pushCard(d); },
      setEfb(d) { ctx._efb = Object.assign(ctx._efb || {}, d); if (cur && cur.ctx === ctx) pushEfb(ctx._efb); },
      setCredit(c) { ctx._credit = c; if (cur && cur.ctx === ctx) { cur.credit = c; efb.set({ credit: c ? c.text : '' }); if (Bar) Bar.update(); } },
      setTitle(t) { ctx._title = t; if (cur && cur.ctx === ctx) cur.title = t; },
      reveal: (t) => openReveal(targetReveal(t)),
      jump: (station, p) => jump(station, p),
      blink: async (fn) => { await blink.out(0.18); try { fn && fn(); } finally { await blink.in(0.3); } },
      // real scenery: the shell's one Google 3D tiles instance, given to this station when it arrives (null: use your fallback)
      wantScenery(o) { ctx._scenery = o; return new Promise((res) => { ctx._sceneryResolve = res; }); },
      // background loading must never block a frame for long (the VR watchdog): await ctx.yield() between pieces
      yield: () => new Promise((r) => setTimeout(r, 0)),
      // listeners and timers registered here are removed for you on unload (nothing left behind)
      on(target, type, fn, opt) { target.addEventListener(type, fn, opt); listeners.push([target, type, fn, opt]); },
      setInterval(fn, ms) { const id = setInterval(fn, ms); timers.add(['i', id]); return id; },
      setTimeout(fn, ms) { const id = setTimeout(fn, ms); timers.add(['t', id]); return id; },
      _cleanup() { listeners.forEach(([t, ty, fn, o]) => { try { t.removeEventListener(ty, fn, o); } catch (e) { /* ignore */ } }); listeners.length = 0; timers.forEach(([k, id]) => (k === 'i' ? clearInterval(id) : clearTimeout(id))); timers.clear(); },
    };
    return ctx;
  }
  function applyEnv(e) {
    env = e || {};
    scene.fog = e.fog || null; scene.background = e.background || null;
    camera.near = e.near || DEF.near; camera.far = e.far || DEF.far; camera.fov = e.fov || DEF.fov; renderer.toneMappingExposure = e.exposure || DEF.exposure;
    fit(); camera.updateProjectionMatrix();
  }
  function pushCard(d) {
    if (!cur) return; cur.card = d;
    if (Card) { Card.update(d); if (Card.setLive) Card.setLive(!!d.live); }
    efb.set({ card: d, tag: d.sig && d.sig.tag ? d.sig.tag : d.live ? 'LIVE' : '' });
    if (Bar) Bar.update();
  }
  let dockSig = '';
  function pushEfb(d) {
    efbData = d;
    efb.set({ stationName: (cur && (cur.title || cur.meta.name)) || '', povs: d.povs || [], pov: d.pov || '', listTitle: d.listTitle || '', list: d.list || [], layers: d.layers || [], time: d.time || [], status: d.status || '' });
    const sig = (d.pov || '') + '|' + (d.povs || []).map((p) => p[0]).join(',') + '|' + (cur && cur.title);
    if (sig !== dockSig) { dockSig = sig; access.redrawDock(); }
    renderHere(); if (Bar) Bar.update();
  }
  function povChange(id) { if (!cur) return; safe(() => cur.st.act({ type: 'pov', id })); }
  function titleFor(meta, params) { const p = placeFor(meta.id, params); return p ? p.name : meta.name; }
  async function precompile(root, e) {
    const tmp = new THREE.Scene(); tmp.fog = e.fog || null;
    try { if (renderer.compileAsync) await Promise.race([renderer.compileAsync(root, camera, tmp), wait(8000)]); else renderer.compile(root, camera, tmp); } catch (er) { /* compiles on first draw instead */ }
    const texs = new Set(); root.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture && v.image) texs.add(v); } });
    let n = 0; for (const t of texs) { try { renderer.initTexture(t); } catch (er) { /* ignore */ } if (++n % 6 === 0) await wait(0); }
  }
  function unloadCurrent() {
    if (!cur) return;
    const c = cur; cur = null;
    scenery.release();
    safe(() => c.st.unload());
    c.ctx._cleanup();
    // the rig and the camera are the shell's: put them back, then free anything the station left behind
    rig.removeFromParent(); scene.add(rig); rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.set(1, 1, 1);
    if (!renderer.xr.isPresenting) { camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); }
    if (camera.parent !== rig) rig.add(camera);
    disposeDeep(c.root, (o) => o === rig || o === camera);
    applyEnv({});
  }
  async function jump(stationId, params = {}, opts = {}) {
    if (jumping) { queued = [stationId, params, opts]; return; }
    let meta = getStation(stationId);
    if (!meta) { toast('Unknown station: ' + stationId); meta = getStation(DEFAULT_STATION); }
    params = Object.assign({}, meta.defaults || {}, params);
    jumping = true; const first = !cur; lastError = '';
    const title = titleFor(meta, params);
    let root = null, ctx = null, st = null;
    try {
      const mod = await meta.module();
      root = new THREE.Group(); root.name = 'station:' + meta.id;
      ctx = makeCtx(meta, root, params);
      st = mod.createStation(ctx);
      let pct = 0;
      const loading = Promise.resolve(st.load(params, (p, text) => { pct = p; blink.progress((text || title) + (p > 0 && p < 1 ? ' · ' + Math.round(p * 100) + '%' : '')); }));
      // load behind while the current world keeps running; then the blink and the arrival cover the rest
      if (!first) await Promise.race([loading.catch(() => {}), wait(500)]);
      if (XRS && XRS.grace) XRS.grace(4500);
      await blink.out(first ? 0.01 : 0.3);
      blink.arrive(title, true); sound.whoosh(1.8);
      const t0 = performance.now();
      await Promise.race([loading, wait(ARRIVAL_MAX_LOAD_MS).then(() => { throw new Error('loading took too long'); })]);
      await precompile(root, ctx.env);
      if (XRS && XRS.grace) XRS.grace(3000);
      unloadCurrent();
      cur = { meta, st, root, ctx, params, title: ctx._title || title, ownsCamera: !!ctx._ownsCamera, lookPitch: ctx.lookPitch, card: null, credit: ctx._credit || null };
      scene.add(root); applyEnv(ctx.env);
      look.yaw = 0; look.pitch = ctx.lookPitch != null ? ctx.lookPitch : LOOK_PITCH;
      if (ctx._scenery) { const want = ctx._scenery; scenery.acquire(Object.assign({ parent: root }, want)).then((h) => { if (ctx._sceneryResolve) ctx._sceneryResolve(cur && cur.ctx === ctx ? h : null); }); }
      pushEfb(ctx._efb || {}); if (ctx._card) pushCard(ctx._card); efb.set({ credit: ctx._credit ? ctx._credit.text : '' });
      safe(() => st.run(0, clock.elapsedTime));
      if (renderer.xr.isPresenting) { safe(() => st.act({ type: 'xr', on: true })); access.mount(); }
      jumps++;
      // remember the place, and keep the link in the address bar (a station link opens straight to it)
      const pl = placeFor(meta.id, params); if (pl) { recent = [{ title: pl.name, name: pl.name, placeId: pl.id, station: pl.station, params: pl.params, tag: pl.tag }].concat(recent.filter((r) => r.placeId !== pl.id)).slice(0, 6); try { localStorage.setItem('imhere.xr.recent', JSON.stringify(recent)); } catch (e) { /* ignore */ } }
      efb.set({ recent, here: pl ? pl.id : '' });
      const h = makeHash(meta.id, linkParams(params)); if (location.hash !== h) history.replaceState(null, '', h);
      document.title = "I'M HERE XR · " + (cur.title || meta.name);
      while (performance.now() - t0 < (first ? 600 : ARRIVAL_MIN_MS)) await wait(50);
      blink.arrive('', false); await blink.in(0.5);
      ready = true;
    } catch (e) {
      lastError = String((e && e.message) || e); console.error('[shell] jump to ' + stationId + ' failed:', e);
      if (st && st !== (cur && cur.st)) { safe(() => st.unload()); if (ctx) ctx._cleanup(); if (root) disposeDeep(root); }
      blink.arrive('', false); await blink.in(0.3);
      toast("Couldn't open " + title + ': ' + lastError);
      if (!cur && stationId !== 'example') { jumping = false; return jump('example', {}); }
    } finally {
      jumping = false;
      if (queued) { const qd = queued; queued = null; jump(qd[0], qd[1], qd[2]); }
    }
  }
  const linkParams = (p) => { const o = {}; for (const k of Object.keys(p)) if (['area', 'tour', 'stop', 'pov', 'sim', 'mmsi'].includes(k) && p[k] != null) o[k] = p[k]; return o; };
  addEventListener('hashchange', () => { const h = parseHash(location.hash); if (h.station && (!cur || h.station !== cur.meta.id || JSON.stringify(linkParams(h)) !== JSON.stringify(linkParams(cur.params)))) { const { station, ...rest } = h; jump(station, rest); } });

  // ------------------------------------------------------------------ the loop (no allocations here)
  const clock = new THREE.Clock();
  let vrPreview = false;   // tests / headless previews: show the VR EFB, dock and chips on a screen
  renderer.setAnimationLoop((time, frame) => {
    const dt = Math.min(0.1, clock.getDelta()), now = performance.now();
    if (heroQueue) { const f = heroQueue; heroQueue = null; f(); }
    if (cur) { try { cur.st.run(dt, clock.elapsedTime); } catch (e) { console.error('[shell] run', e); } }
    scenery.update(dt);
    if (renderer.xr.isPresenting) { access.update(dt, now); xrHover(now); if (toastMesh.visible && now > toastUntil) toastMesh.visible = false; }
    else if (vrPreview) access.update(dt, now);
    blink.update(dt);
    renderer.render(scene, camera);
  });

  // ------------------------------------------------------------------ start: the link opens straight to its station
  const h = parseHash(location.hash);
  const { station: startId, ...startParams } = h;
  const api = {
    THREE, renderer, scene, camera, rig, look, efb, access, concierge, blink, scenery, sound, jump, openEFB, closePanel, openReveal, placeReveal, recenter,
    get current() { return cur; }, get ready() { return ready; }, get jumping() { return jumping; }, get jumps() { return jumps; }, get lastError() { return lastError; },
    info: () => ({ station: cur && cur.meta.id, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, children: scene.children.length }),
    XRS,
    vrPreview(on) { vrPreview = !!on; access.setVisible(vrPreview); efb.set({ xr: vrPreview }); if (vrPreview) access.mount(); else access.stow(); },
  };
  window.__xr = api;
  jump(startId || DEFAULT_STATION, startParams);
  return api;
}

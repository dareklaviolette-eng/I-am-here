// I'M HERE Travel Desk · Yosemite National Park, the first demo tour, aboard XR Aurora (placeholder frame until shared/aurora/).
// Screens: a slow, eased glide between stops (10-20 s), a still, gently drifting viewpoint at each stop, Auto-play ~25 s a stop.
// VR: comfort first: a blink (fade to black and back) between stops and views, a slow slide at each stop, nothing turns you;
// the controls are world-mounted (shared/imhere-topbar.js), point + select only; shared/xr-safety.js gives B / Y exit,
// the Exit VR row on the card, the crash-proof loop and the frame-cost watchdog.
// Scenery: Google Photorealistic 3D Tiles on the GitHub site (the key is restricted to it); elsewhere, or if it fails, a
// rendered approximation (terrain.js), labelled as such. Weather: Open-Meteo, live. Planes: shared/layer-planes.js (off).
// I'M HERE Travel Desk · the tour page every park shares, aboard XR Aurora (placeholder frame until shared/aurora/).
// A park's index.html loads its own tour.js (stops + PARK settings, maths from tour-core.js), guide.js (field guide) and
// terrain.js (fallback scenery), then calls startTourPage({ T, guide, buildTerrain }).
// Screens: a slow, eased glide between stops (10-20 s; longer on tours that cross a country), a still, gently drifting
// viewpoint at each stop, Auto-play ~25 s a stop.
// VR: comfort first: a blink (fade to black and back) between stops and views, a slow slide at each stop, nothing turns you;
// the controls are world-mounted (shared/imhere-topbar.js), point + select only; shared/xr-safety.js gives B / Y exit,
// the Exit VR row on the card, the crash-proof loop and the frame-cost watchdog.
// Scenery: Google Photorealistic 3D Tiles on the GitHub site (the key is restricted to it); elsewhere, or if it fails, a
// rendered approximation (the park's terrain.js), labelled as such. Weather: Open-Meteo, live. Planes: shared/layer-planes.js (off).
// Night stops (s.night) and golden-hour stops (s.golden) are rendered grades over the imagery, labelled in Details.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createAuroraFrame } from './aurora-placeholder.js';
import { createNightSky } from './night-sky.js';

const GOOGLE_KEY = 'AIzaSyD5_qsBFe74zBURZ8UTYFzz_7es3dPSM9A';   // same key as 737/: restricted to dareklaviolette-eng.github.io

// The page's markup (the same for every park; ids are what the tests and the shared controls use)
function buildMarkup(P, first, n) {
  const body = document.body;
  const html = '<div id="view"></div>' +
    '<section id="cap" aria-live="polite"><div id="capHead"><span id="capStep"></span><span id="capTitle"></span><span id="capWx"></span></div>' +
    '<p id="capText"></p><p id="capNote" hidden></p><div id="capCtl">' +
    '<button class="cb" id="prevBtn" type="button" aria-label="Previous stop">‹ Prev</button>' +
    '<button class="cb" id="autoBtn" type="button" aria-pressed="true">❚❚ Auto</button>' +
    '<button class="cb" id="nextBtn" type="button" aria-label="Next stop">Next ›</button><span class="sp"></span>' +
    '<button class="cb" id="guideBtn" type="button" aria-pressed="false">Field guide</button>' +
    '<button class="cb" id="vrBtn" type="button" hidden>Enter VR</button></div><div id="prog"><i></i></div></section>' +
    '<aside id="efb" hidden aria-label="Field guide"><div id="efbHead"><span id="efbTitle"></span><button class="cb x" id="efbClose" type="button" aria-label="Close the field guide">✕</button></div>' +
    '<div id="efbTabs"><button class="cb" id="tabHere" type="button" aria-pressed="true">Here</button><button class="cb" id="tabAll" type="button" aria-pressed="false">All species</button></div>' +
    '<div id="efbList"></div></aside><div id="status" role="status"></div><div id="blink" aria-hidden="true"></div>';
  body.insertAdjacentHTML('afterbegin', html);
  document.getElementById('capStep').textContent = `STOP 1 / ${n}`; document.getElementById('capTitle').textContent = first.name;
  document.getElementById('efbTitle').textContent = 'FIELD GUIDE · ' + P.guideTitle;
}

export function startTourPage({ T, guide, buildTerrain }) {
const { SPECIES, SPECIES_ORDER } = guide;
const P = T.PARK, LOG = '[' + P.log + ']', METRIC = P.units === 'metric', CURVED = !!T.CURVED;
buildMarkup(P, T.STOPS[0], T.STOPS.length);
const QS = new URLSearchParams(location.search);
const ON_SITE = /github\.io$/i.test(location.hostname);
const USE_TILES = QS.get('tiles') === '0' ? false : (ON_SITE || QS.get('tiles') === '1');
const $ = (id) => document.getElementById(id);
const STOPS = T.STOPS, NSTOP = STOPS.length, D2R = Math.PI / 180;
const COARSE = matchMedia('(pointer: coarse)').matches;
const POV_NAME = Object.fromEntries(T.POVS);
// the local horizon at a world point, as a quaternion (identity for parks that keep one horizon: Yosemite)
const _bm = new THREE.Matrix4(), _bw = new THREE.Vector3(), _bu = new THREE.Vector3(), _bn = new THREE.Vector3();
function basisQuat(pos, q) {
  if (!CURVED) return q.identity();
  const B = T.basisAt(pos); _bm.makeBasis(_bw.fromArray(B.w), _bu.fromArray(B.u), _bn.fromArray(B.n)); return q.setFromRotationMatrix(_bm);
}
const qBasis = new THREE.Quaternion();

// ------------------------------------------------------------------------------------------------ renderer, scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, COARSE ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbfd3e6, 2e-5);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400000);
const rig = new THREE.Group(); rig.name = 'rig'; rig.add(camera); scene.add(rig);
let xrLevel = 0;
const XRS = window.ImHereXR ? window.ImHereXR.install({ THREE, renderer, scene, camera, scale: 0.9, rays: true, panel: false, exitButtons: [5],
  hint: 'Welcome aboard XR Aurora · B or Y: exit VR', onQuality: (n) => { xrLevel = n; applyDetail(); } }) : null;

// sky: a gradient dome around the eye, with a soft sun; golden hour warms it
const sky = new THREE.Mesh(new THREE.SphereGeometry(300000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, low: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 zen, hor, low, sunCol, sun; varying vec3 vD; void main(){ float h = vD.y; vec3 c = h > 0.0 ? mix(hor, zen, pow(min(1.0, h * 1.6), 0.6)) : mix(hor, low, min(1.0, -h * 5.0));' +
    'float s = max(dot(normalize(vD), normalize(sun)), 0.0); c += sunCol * (pow(s, 12.0) * 0.35 + pow(s, 600.0) * 1.2); gl_FragColor = vec4(c, 1.0);\n' +
    '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
}));
sky.renderOrder = -1000; sky.frustumCulled = false; scene.add(sky);
const SKY = { day: { zen: 0x3f6fa8, hor: 0xc9dbea, low: 0x9fb1c0, sun: 0xfff3dc, fog: 0xbfd3e6, tint: 0xffffff },
  gold: { zen: 0x3b4f80, hor: 0xf2c58e, low: 0xb08a6a, sun: 0xffc27a, fog: 0xe8c39a, tint: 0xffd9ae },
  night: { zen: 0x02040b, hor: 0x0b1326, low: 0x04070e, sun: 0x000000, fog: 0x0a1121, tint: 0x3a4766 } };
const tmpA = new THREE.Color(), tmpB = new THREE.Color();
const sunDir = new THREE.Vector3().fromArray(P.sun || [0.5, 0.55, -0.66]);   // x = west (Yosemite: afternoon sun from the south-west)
// night stops: stars and (where the park asks for it) the aurora, a rendered sky around the eye
const nightSky = createNightSky(THREE, P.nightSky || {}); scene.add(nightSky.group);

// fallback terrain (rendered approximation) until Google 3D shows
const fallback = buildTerrain(THREE, { n: COARSE ? (P.terrainN || [320, 256])[1] : (P.terrainN || [320, 256])[0] });
scene.add(fallback);
// route line + stop pins: shown in God's eye (drawn by I'M HERE)
const routeGeo = new THREE.BufferGeometry(); routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(T.routeLine(48), 3));
const route = new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0x7fe6f5, transparent: true, opacity: 0.75, fog: false, depthTest: false }));
route.renderOrder = 40; route.frustumCulled = false; route.visible = false; scene.add(route);
const pinGeo = new THREE.BufferGeometry(); pinGeo.setAttribute('position', new THREE.Float32BufferAttribute(STOPS.flatMap((s) => T.toLocal(...s.cam)), 3));
const pins = new THREE.Points(pinGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 9, sizeAttenuation: false, fog: false, depthTest: false }));
pins.renderOrder = 41; pins.frustumCulled = false; pins.visible = false; scene.add(pins);

// the craft (placeholder)
const aurora = createAuroraFrame(THREE); scene.add(aurora.group);

// ------------------------------------------------------------------------------------------------ Google 3D tiles
let tiles = null, tilesState = USE_TILES ? 'loading' : 'off', tilesWhy = USE_TILES ? '' : 'Google 3D loads on the GitHub site (its key is restricted there)', tilesShown = false;
function status(text, ms = 6000) { const s = $('status'); s.textContent = text; s.classList.remove('fade'); clearTimeout(status.t); if (ms) status.t = setTimeout(() => s.classList.add('fade'), ms); }
function applyDetail() {
  if (!tiles) return;
  const vr = renderer.xr.isPresenting;
  tiles.setErrorTarget(vr ? [16, 28, 48][xrLevel] : COARSE ? 12 : 8);
}
if (USE_TILES) {
  status('Loading Google 3D…', 0);
  import('./scenery.js').then((m) => m.createRegionTiles({ THREE, GLTFLoader, DRACOLoader, renderer, camera, key: GOOGLE_KEY, frame: T.FRAME, onStatus: (t) => status(t, 0) }))
    .then((t) => { tiles = t; scene.add(t.group); tilesState = 'on'; applyDetail(); status('Streaming Google 3D…', 0); })
    .catch((e) => { tilesState = 'failed'; tilesWhy = String((e && e.message) || e).replace(/key=[^&\s]+/g, 'key=…'); console.warn(LOG, 'Google 3D unavailable:', tilesWhy); status('Google 3D unavailable: rendered terrain shown'); });
} else status('Rendered terrain (Google 3D loads on the GitHub site)');

// ------------------------------------------------------------------------------------------------ tour state
const S = { i: 0, mode: 'hold', holdT: 0, leg: null, legT: 0, auto: QS.get('auto') !== '0', pov: 'deck', guide: false, guideTab: 'here',
  look: { yaw: 0, pitch: 0, at: 0 }, gold: 0, night: 0, haze: STOPS[0].haze, vrGuide: false, momentAt: {} };
const cur = { pos: [0, 0, 0], heading: 0, pitch: 0 };   // the camera now (screens), before the drag-to-look offset
const poseFor = (i, pov = S.pov) => T.povPose(STOPS[i], pov);
Object.assign(cur, poseFor(0)); cur.pos = cur.pos.slice();
const xrNow = () => renderer.xr.isPresenting;

function goTo(i, why = 'user') {
  i = ((i % NSTOP) + NSTOP) % NSTOP;
  if (xrNow()) { blink(() => { S.i = i; S.mode = 'hold'; S.holdT = 0; S.leg = null; placeRig(); moment(STOPS[i]); }); }
  else if (i === S.i && S.mode === 'hold') { S.holdT = 0; }
  else {
    const from = { pos: cur.pos.slice(), heading: cur.heading, pitch: cur.pitch };
    S.leg = T.makeLeg(from, poseFor(i)); S.legT = 0; S.mode = 'glide'; S.i = i;
  }
  S.vrGuide = false; renderCaption(); uiDirty();
}
function setPov(p) {
  if (!POV_NAME[p] || p === S.pov) return;
  if (xrNow()) { blink(() => { S.pov = p; placeRig(); uiDirty(); }); return; }
  S.pov = p;
  const from = { pos: cur.pos.slice(), heading: cur.heading, pitch: cur.pitch };
  S.leg = T.makeLeg(from, poseFor(S.i)); S.leg.dur = Math.min(S.leg.dur, 6); S.legT = 0; S.mode = 'glide';
  uiDirty();
}
function setAuto(on) { S.auto = !!on; if (S.auto && S.mode === 'hold' && S.holdT > T.HOLD_S) S.holdT = T.HOLD_S - 3; renderCaption(); uiDirty(); }

// a stop's own moment on arrival (s.moment = { k, t, s }): screens only, at most once every 10 minutes per stop
function moment(s) {
  if (!s || !s.moment || xrNow()) return;
  const now = performance.now(); if (S.momentAt[s.id] && now - S.momentAt[s.id] < 600000) return; S.momentAt[s.id] = now;
  const d = document.createElement('div'); d.className = 'tourMoment'; d.setAttribute('role', 'status');
  d.innerHTML = '<div class="aw-k"></div><div class="aw-t"></div><div class="aw-s"></div>';
  d.querySelector('.aw-k').textContent = s.moment.k || ''; d.querySelector('.aw-t').textContent = s.moment.t || ''; d.querySelector('.aw-s').textContent = s.moment.s || '';
  document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
  setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 1500); }, 6500);
}

// ------------------------------------------------------------------------------------------------ blink (VR comfort)
const blinkMesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }));
blinkMesh.renderOrder = 100000; blinkMesh.visible = false; blinkMesh.frustumCulled = false; camera.add(blinkMesh);
const BL = { on: false, t0: 0, fn: null, fired: false };
const BL_OUT = 350, BL_HOLD = 120, BL_IN = 450;
function blink(fn) {
  if (BL.on && !BL.fired) { const f0 = BL.fn; BL.fn = () => { f0 && f0(); fn && fn(); }; return; }
  BL.on = true; BL.t0 = performance.now(); BL.fn = fn; BL.fired = false;
}
function blinkStep(t) {
  if (!BL.on) return;
  const e = t - BL.t0; let a;
  if (e < BL_OUT) a = e / BL_OUT;
  else {   // fire at full black; a slow frame that skips the hold still fires (then fades in from black)
    if (!BL.fired) { BL.fired = true; BL.t0 = t - BL_OUT; try { BL.fn && BL.fn(); } catch (err) { console.error(LOG, 'blink', err); } }
    const e2 = t - BL.t0; a = e2 < BL_OUT + BL_HOLD ? 1 : Math.max(0, 1 - (e2 - BL_OUT - BL_HOLD) / BL_IN); if (a <= 0) BL.on = false;
  }
  const xr = xrNow(); blinkMesh.visible = xr && a > 0; blinkMesh.material.opacity = a;
  const v = xr ? '0' : a.toFixed(3); if ($('blink').style.opacity !== v) $('blink').style.opacity = v;
}

// ------------------------------------------------------------------------------------------------ VR placement
const VR_EYE = 1.4;   // the deck viewpoint sits this far above the rig floor (users stand or sit; the frame is drawn for it)
function placeRig(t = 0) {   // VR: the rig at the stop's viewpoint (+ a slow slide), facing the stop's heading; no rotation after
  const p = poseFor(S.i), d = T.drift(STOPS[S.i], S.holdT, true);
  rig.position.set(p.pos[0] + d.off[0], p.pos[1] - VR_EYE + d.off[1], p.pos[2] + d.off[2]);
  rig.rotation.set(0, Math.PI - p.heading, 0); if (CURVED) rig.quaternion.premultiply(basisQuat(p.pos, qBasis));
  cur.pos[0] = p.pos[0]; cur.pos[1] = p.pos[1]; cur.pos[2] = p.pos[2]; cur.heading = p.heading; cur.pitch = 0;
}

// ------------------------------------------------------------------------------------------------ screens: drag to look
{
  let drag = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { if (xrNow()) return; drag = { x: e.clientX, y: e.clientY, yaw: S.look.yaw, pitch: S.look.pitch }; el.setPointerCapture && el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return; const k = camera.fov * D2R / innerHeight;
    S.look.yaw = T.clamp(drag.yaw + (e.clientX - drag.x) * k, -1.2, 1.2); S.look.pitch = T.clamp(drag.pitch + (e.clientY - drag.y) * k, -0.6, 0.5); S.look.at = performance.now();
  });
  const up = () => { drag = null; S.look.at = performance.now(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ------------------------------------------------------------------------------------------------ weather (Open-Meteo)
const WX = { list: null, at: 0, err: '' };
async function refreshWeather() {
  try { const w = await T.fetchWeather(); if (w && w.some(Boolean)) { WX.list = w; WX.at = Date.now(); WX.err = ''; } }
  catch (e) { WX.err = String((e && e.message) || e); console.warn(LOG, 'weather:', WX.err); }
  renderCaption(); uiDirty();
}
refreshWeather(); setInterval(refreshWeather, 15 * 60000);
const wxNow = (i = S.i) => (WX.list && Date.now() - WX.at < 30 * 60000 ? WX.list[i] : null);
const wxLine = (w) => !w ? '' : METRIC ? `${w.tempC}°C (${w.tempF}°F) · ${w.text}${w.windKmh ? ' · wind ' + (w.windDir ? w.windDir + ' ' : '') + w.windKmh + ' km/h' : ''}`
  : `${w.tempF}°F · ${w.text}${w.windMph ? ' · wind ' + (w.windDir ? w.windDir + ' ' : '') + w.windMph + ' mph' : ''}`;
const wxTemp = (w) => (METRIC ? `${w.tempC}°C · ${w.tempF}°F` : w.tempF + '°F');
const wxWind = (w) => (METRIC ? (w.windDir + ' ' + w.windKmh + ' km/h') : (w.windDir + ' ' + w.windMph + ' mph')).trim();

// ------------------------------------------------------------------------------------------------ caption, field guide
// elevations: Yosemite in feet; metric parks in metres, with feet alongside in the card's Details
const elevShort = (s) => (METRIC ? T.fmtM(s.elevM) : T.fmtFt(s.elevFt));
const altWords = (m) => (METRIC ? T.fmtM(m) + ' (' + T.fmtFt(m / T.FT) + ')' : T.fmtFt(m / T.FT));
function stopElev(s) { return s.elevNote || (METRIC ? altWords(s.elevM) : T.fmtFt(s.elevFt)); }
function renderCaption() {
  const s = STOPS[S.i], w = wxNow();
  $('capStep').textContent = `STOP ${S.i + 1} / ${NSTOP}`;
  $('capTitle').textContent = s.name;
  $('capWx').textContent = w ? wxLine(w) : '';
  $('capText').textContent = s.caption;
  $('capNote').hidden = !s.note; $('capNote').textContent = s.note || '';
  $('autoBtn').textContent = S.auto ? '❚❚ Auto' : '▶ Auto'; $('autoBtn').setAttribute('aria-pressed', String(S.auto));
  $('autoBtn').setAttribute('aria-label', S.auto ? 'Pause auto-play' : 'Auto-play the tour');
  $('guideBtn').setAttribute('aria-pressed', String(S.guide));
  renderGuide(); renderSidebar();
}
function speciesCard(id, here) {
  const sp = SPECIES[id], d = document.createElement('article'); d.className = 'sp-card';
  const at = STOPS.filter((s) => s.species.includes(id)).map((s) => s.name).join(', ');
  d.innerHTML = '<h3></h3><div class="sci"></div><div class="tags"></div><p class="t"></p><p><span class="k">LOOK</span><span class="l"></span></p><p><span class="k">TOUR</span><span class="a"></span></p><div class="ph">Text-only card · photo to come</div>';
  d.querySelector('h3').textContent = sp.name; d.querySelector('.sci').textContent = sp.sci;
  const tags = d.querySelector('.tags'); const tg = (t, c) => { const x = document.createElement('span'); x.textContent = t; if (c) x.className = c; tags.appendChild(x); };
  tg(sp.kind.toUpperCase()); if (sp.status) tg(sp.status.toUpperCase(), 'end'); if (here) tg('HERE');
  d.querySelector('.t').textContent = sp.text; d.querySelector('.l').textContent = sp.look; d.querySelector('.a').textContent = at;
  return d;
}
function renderGuide() {
  $('efb').hidden = !S.guide || ImHereTopbar.state() === 'hidden';
  if (!S.guide) return;
  const here = STOPS[S.i].species, ids = S.guideTab === 'here' ? here : SPECIES_ORDER, key = S.guideTab + S.i;
  $('tabHere').textContent = 'Here · ' + STOPS[S.i].name; $('tabHere').setAttribute('aria-pressed', String(S.guideTab === 'here')); $('tabAll').setAttribute('aria-pressed', String(S.guideTab === 'all'));
  if ($('efbList').dataset.k === key) return; $('efbList').dataset.k = key; $('efbList').textContent = '';
  ids.forEach((id) => $('efbList').appendChild(speciesCard(id, here.includes(id))));
}
function openGuide(on = !S.guide, tab) { S.guide = on; document.body.classList.toggle('guide-open', on); if (tab) S.guideTab = tab; if (on) ImHereTopbar.setSide(false); renderCaption(); }
$('prevBtn').onclick = () => goTo(S.i - 1); $('nextBtn').onclick = () => goTo(S.i + 1);
$('autoBtn').onclick = () => setAuto(!S.auto); $('guideBtn').onclick = () => openGuide();
$('efbClose').onclick = () => openGuide(false); $('tabHere').onclick = () => openGuide(true, 'here'); $('tabAll').onclick = () => openGuide(true, 'all');
addEventListener('hashchange', () => { if (location.hash === '#guide') { openGuide(true, 'here'); history.replaceState(null, '', location.pathname + location.search); } });
addEventListener('keydown', (e) => {
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') goTo(S.i + 1); else if (e.key === 'ArrowLeft') goTo(S.i - 1); else if (e.key === ' ') { e.preventDefault(); setAuto(!S.auto); }
});

// sidebar (☰): Stops · Field guide · About
const sbStops = document.createElement('div'); sbStops.className = 'sb-list';
STOPS.forEach((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = '<span class="n"></span><span class="t"></span><span class="s"></span>';
  b.querySelector('.n').textContent = i + 1; b.querySelector('.t').textContent = s.name; b.querySelector('.s').textContent = elevShort(s);
  b.onclick = () => { goTo(i); ImHereTopbar.setSide(false); }; sbStops.appendChild(b); });
const sbGuide = document.createElement('div'); sbGuide.className = 'sb-list';
const gHere = document.createElement('button'); gHere.type = 'button'; gHere.onclick = () => openGuide(true, 'here'); sbGuide.appendChild(gHere);
const gAll = document.createElement('button'); gAll.type = 'button'; gAll.textContent = 'All species (' + SPECIES_ORDER.length + ')'; gAll.onclick = () => openGuide(true, 'all'); sbGuide.appendChild(gAll);
const sbAbout = document.createElement('div'); sbAbout.className = 'sb-about';
sbAbout.innerHTML = P.about;   // the park's own words (static HTML from its tour.js)
function renderSidebar() {
  [...sbStops.children].forEach((b, i) => b.setAttribute('aria-current', String(i === S.i)));
  gHere.textContent = 'Here · ' + STOPS[S.i].name + ' (' + STOPS[S.i].species.length + ')';
}

// ------------------------------------------------------------------------------------------------ the card + top bar
const MARK = window.ImHereCard, TB = window.ImHereTopbar;
const ICON = P.icon;
let LAY = null;   // { reg, LU, planes, markers, xr }: the shared Layers control (loaded below)
function sceneryWords() { return tilesShown ? 'Google 3D' : 'Rendered terrain'; }
function cardData() {
  const s = STOPS[S.i], w = wxNow(), live = !!w, gl = S.mode === 'glide';
  const prev = gl && S.leg ? STOPS.find((x) => x !== s && Math.hypot(...T.povPose(x, S.pov).pos.map((v, k) => v - S.leg.a.pos[k])) < 50) : null;
  const ll = T.fromLocal(...cur.pos);
  const rows = [['Aboard', 'XR Aurora (IH-0000)'], ['Stop', `${S.i + 1} of ${NSTOP} · ${s.name}`], ['Elevation', stopElev(s)],
    ['Position', `${ll.lat.toFixed(4)}°, ${ll.lon.toFixed(4)}° · ${altWords(ll.altMsl)}`]];
  if (w) rows.push(['Weather', wxLine(w)], ['Observed', (w.time || '').replace('T', ' ') + ' ' + tzLabel() + ' · Open-Meteo']);
  else rows.push(['Weather', WX.err ? 'not reachable right now' : 'loading…']);
  rows.push(['Scenery', tilesShown ? 'Google Photorealistic 3D Tiles (real imagery, not live)' : tilesState === 'on' ? 'Google 3D streaming…' : 'Rendered approximation (I\'M HERE): ' + (tilesWhy || 'Google 3D not loaded')]);
  if (S.gold > 0.05) rows.push(['Light', (s.goldenWords || 'Golden-hour') + ' grade: rendered over the imagery']);
  if (S.night > 0.05) rows.push(['Light', 'Night grade, stars' + (P.nightSky && P.nightSky.aurora ? ' and southern lights' : '') + ': rendered by I\'M HERE']);
  if (S.pov === 'god') rows.push(['Route', 'Line and stop pins drawn by I\'M HERE']);
  if (S.pov === 'deck') rows.push(['Craft', 'Observation deck frame: placeholder render']);
  return {
    thumb: { icon: ICON, label: P.short }, flag: P.flag, type: P.type,
    loc: s.loc, org: s.org || P.org, id: { label: 'STEP', value: `${S.i + 1}/${NSTOP} · ${s.name}` },
    rte: gl ? `${prev ? prev.name + ' ' : ''}→ ${s.name} · Glide` : `${s.name} · Hold`, route: (gl ? '→ ' : '') + s.name,
    pov: POV_NAME[S.pov], sig: live ? { source: sceneryWords() + ' · Open-Meteo weather' } : { source: sceneryWords(), tag: 'HIST' },
    time: live ? Date.now() : null,
    details: { rows, notes: [
      'Live: the weather only (Open-Meteo, refreshed every 15 min). The scenery is Google\'s captured imagery, not a live view.',
      ...P.notes,
    ], credits: [{ text: 'Field guide ›', href: '#guide' }, { text: 'Map data: Google 3D Tiles', href: 'https://developers.google.com/maps/documentation/tile/policies' },
      { text: 'Weather data by Open-Meteo.com (CC BY 4.0)', href: 'https://open-meteo.com/' }, ...P.credits, { text: 'Built with Claude AI' }] },
  };
}
let cardSig = '';
function updateCard() {
  if (!MARK) return;
  const d = cardData(), sig = JSON.stringify(d) + (d.time ? Math.floor(d.time / 60000) : '');
  if (sig !== cardSig) { cardSig = sig; MARK.update(d); }
  MARK.setLive(!!wxNow());
}
// the park's local time and zone words ('PT' for Yosemite; 'CET' / 'CEST', 'NZDT' / 'NZST' from the browser for the others)
function tzLabel() {
  if (P.tzLabel) return P.tzLabel;
  try { const p = new Intl.DateTimeFormat(P.tzLocale || 'en-GB', { timeZone: P.timezone, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName'); return p ? p.value : ''; } catch (e) { return ''; }
}
const localPT = () => { try { return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: P.timezone }) + ' ' + tzLabel(); } catch (e) { return ''; } };
function dataCells() {
  const s = STOPS[S.i], w = wxNow();
  return [['STOP', `${S.i + 1}/${NSTOP} ${s.name}`], ['ELEV', elevShort(s)], ['TEMP', w ? wxTemp(w) : '—'], ['WX', w ? w.text : '—'],
    ['WIND', w ? wxWind(w) : '—'], ['LOCAL', localPT()]];
}
function povItems() { return T.POVS.map(([id, n]) => ['pov:' + id, n, '', id === S.pov ? 'sel' : '']).concat(xrNow() ? [['recenter', 'Recenter', '', '']] : []); }
let creditText = '';
function tbModel() {
  return { live: !!wxNow(), tag: true, xrTag: true, data: dataCells(), pov: povItems(),
    layers: [['layer:planes', 'Planes', 'soon', 'dis'], ['layer:ships', 'Ships', 'soon', 'dis'], ['layer:wildlife', 'Wildlife', 'soon', 'dis'], ['layer:iss', 'ISS', 'soon', 'dis']],
    sideItems: STOPS.map((s, i) => ['stop:' + i, `${i + 1}  ${s.name}`, '', i === S.i ? 'sel' : '']).concat([['auto', S.auto ? 'Pause auto-play' : 'Auto-play', '', ''], ['guide', 'Field guide', '', '']]),
    sideTitle: 'Stops', credit: tilesShown ? { text: 'Google' + (creditText ? ' · ' + creditText : ''), short: 'Google', title: 'Google 3D Tiles' + (creditText ? ': ' + creditText : ''), href: 'https://developers.google.com/maps/documentation/tile/policies' } : null };
}
function onAction(id) {
  if (id.startsWith('pov:')) setPov(id.slice(4));
  else if (id.startsWith('stop:')) { goTo(+id.slice(5)); TB.setSide(false); }
  else if (id === 'recenter') blink(() => mountUI());
  else if (id === 'auto') setAuto(!S.auto);
  else if (id === 'guide') { if (xrNow()) { S.vrGuide = !S.vrGuide; TB.setSide(false); } else openGuide(true, 'here'); }
}
function uiDirty() { if (TB) TB.update(); if (TBX) TBX.dirty = true; if (CAPX) CAPX.sig = ''; }
if (MARK) MARK.init({ zIndex: 1500, ...cardData() });
if (TB) TB.init({ model: tbModel, onAction, storageKey: P.storageKey || 'imhere.travel', sections: [{ id: 'stops', title: 'Stops', el: sbStops, open: true }, { id: 'guide', title: 'Field guide', el: sbGuide }, { id: 'about', title: 'About', el: sbAbout }] });
renderCaption();

// the shared Layers control: Planes (live ADS-B near the viewpoint; off by default for travel), Ships / Wildlife / ISS "soon"
async function loadLayers() {
  try {
    const [WL, LU, LP] = await Promise.all([import('../../shared/world-layers.js'), import('../../shared/imhere-layers-ui.js'), import('../../shared/layer-planes.js')]);
    const reg = new WL.WorldLayers({ department: 'travel' });
    const planes = reg.register(LP.createPlanesLayer({ THREE }));
    const parent = new THREE.Group(); parent.name = 'planes-parent'; scene.add(parent);
    LAY = { reg, LU, planes, parent, own: { lat: 0, lon: 0, altFt: 0, gy: 0, fieldFt: 0, onGround: false, hex: '', callsign: '', night: false } };
    if (TB) TB.useExternalLayers((host) => LU.createLayersChip({ layers: reg, host }));
    LAY.markers = LU.createHoverMarkers({ THREE, scene, camera, renderer, layers: reg });
    if (TBX) { rig.add(renderer.xr.getController(0), renderer.xr.getController(1)); LAY.xr = LU.createLayersXR({ THREE, renderer, camera, layers: reg, anchor: TBX.layersAnchor }); }
  } catch (e) { console.warn(LOG, 'shared Layers not loaded (Planes shows "soon"):', e && e.message); }
}
function layersStep(dt) {
  if (!LAY) return;
  try {
    if (LAY.reg.isOn('planes')) {
      const p = xrNow() ? rig.position : null, x = p ? p.x : cur.pos[0], y = p ? p.y + VR_EYE : cur.pos[1], z = p ? p.z : cur.pos[2];
      const ll = T.fromLocal(x, y, z), o = LAY.own;
      o.lat = ll.lat; o.lon = ll.lon; o.altFt = ll.altMsl / T.FT; o.fieldFt = o.altFt; o.gy = y;
      if (CURVED) { o.gy = 0; LAY.parent.position.set(x, y, z); basisQuat([x, y, z], LAY.parent.quaternion); }   // the local horizon at the eye
      else LAY.parent.position.set(x, 0, z);
      LAY.parent.updateMatrixWorld();
    }
    LAY.reg.tick(LAY.parent, LAY.own, dt);
    LAY.markers.update();
    if (LAY.xr) { rig.updateMatrixWorld(true); LAY.xr.update(); }
  } catch (e) { console.error(LOG, 'layers', e); }
}

// ------------------------------------------------------------------------------------------------ VR controls (world-mounted)
const uiMount = new THREE.Group(); uiMount.name = 'imhere-ui-mount'; uiMount.visible = false; rig.add(uiMount);
const TBX = TB ? TB.xr(THREE, { cardWidth: 0.3 }) : null;
if (TBX) {
  TBX.attach(uiMount);
  if (TBX.card) { TBX.card.userData.onExitHover = (on) => MARK.xrExitHover && MARK.xrExitHover(on); if (XRS && XRS.exitTargets) XRS.exitTargets.push(TBX.card); }
}
let mountPending = false;
function mountUI() {   // on entering VR and on Recenter: in front of where you look, at eye height; then it stays put
  mountPending = false;
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  uiMount.position.set(camera.position.x, camera.position.y || 1.5, camera.position.z); uiMount.rotation.set(0, e.y, 0); uiMount.visible = true;
  if (TBX) TBX.dirty = true; if (CAPX) CAPX.sig = '';
}
// the narration panel in VR: low in front (like a dashboard), with ‹ Prev · Auto · Next › · Guide
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
const CAPX = (() => {
  const cw = 1024, ch = 420, wm = 0.78, hm = wm * ch / cw, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  mesh.renderOrder = 10000; mesh.frustumCulled = false; mesh.name = P.log + '-caption-xr';
  // 30 deg below eye level, 0.95 m away, tilted to face you
  const y = -Math.sin(30 * D2R) * 0.95, z = -Math.cos(30 * D2R) * 0.95; mesh.position.set(0, y, z); mesh.rotation.set(-Math.atan2(y, -z), 0, 0);
  uiMount.add(mesh);
  return { cv, g: cv.getContext('2d'), tex, mesh, cw, ch, wm, hm, hits: [], sig: '', hover: null };
})();
function wrap(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (let k = 0; k < words.length; k++) {
    const t = line ? line + ' ' + words[k] : words[k];
    if (g.measureText(t).width > maxW && line) { if (++n >= maxLines) { g.fillText(line + ' …', x, y); return y + lh; } g.fillText(line, x, y); y += lh; line = words[k]; } else line = t;
  }
  if (line) { g.fillText(line, x, y); y += lh; } return y;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawCapXR() {
  const P = CAPX, g = P.g, s = STOPS[S.i], w = wxNow(), hov = P.hover;
  const sig = JSON.stringify([S.i, S.auto, S.vrGuide, hov, w, Math.floor(S.holdT)]); if (sig === P.sig) return; P.sig = sig;
  g.clearRect(0, 0, P.cw, P.ch); P.hits = [];
  g.fillStyle = 'rgba(12,16,30,0.82)'; rr(g, 4, 4, P.cw - 8, P.ch - 8, 22); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2; g.stroke();
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = '500 24px ' + MONO; g.fillStyle = 'rgba(110,220,235,0.85)'; g.fillText(`STOP ${S.i + 1} / ${NSTOP}`, 32, 50);
  if (w) { g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(wxLine(w), P.cw - 32, 50); g.textAlign = 'left'; }
  g.font = '650 44px system-ui, sans-serif'; g.fillStyle = '#fff'; g.fillText(s.name, 32, 102);
  g.font = '400 27px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.88)';
  if (S.vrGuide) {
    let y = 142;
    s.species.forEach((id) => { const sp = SPECIES[id]; g.font = '600 26px system-ui, sans-serif'; g.fillStyle = '#fff'; g.fillText(sp.name + (sp.status ? '  ·  ' + sp.status : ''), 32, y);
      g.font = '400 22px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(sp.look.length > 70 ? sp.look.slice(0, 68) + '…' : sp.look, 32, y + 28); y += 58; });
  } else wrap(g, s.caption, 32, 144, P.cw - 64, 36, 5);
  const B = [['prev', '‹ Prev'], ['auto', S.auto ? '❚❚ Auto' : '▶ Auto'], ['next', 'Next ›'], ['guide', S.vrGuide ? 'Story' : 'Field guide']];
  const bw = 224, gap = 16, y0 = P.ch - 92, bh = 68; let x = 32;
  g.font = '500 28px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
  B.forEach(([id, t]) => { const on = hov === id || (id === 'auto' && S.auto) || (id === 'guide' && S.vrGuide);
    g.fillStyle = on ? 'rgba(43,81,112,0.95)' : 'rgba(255,255,255,0.08)'; rr(g, x, y0, bw, bh, 12); g.fill(); g.strokeStyle = hov === id ? 'rgba(160,220,255,0.95)' : 'rgba(255,255,255,0.3)'; g.stroke();
    g.fillStyle = '#fff'; g.fillText(t, x + bw / 2, y0 + bh / 2 + 1); P.hits.push([id, x, y0, bw, bh]); x += bw + gap; });
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if (S.auto) { const f = T.clamp(S.holdT / T.HOLD_S, 0, 1); g.fillStyle = 'rgba(110,220,235,0.7)'; g.fillRect(32, P.ch - 14, (P.cw - 64) * f, 4); }
  P.tex.needsUpdate = true;
}
const _mi = new THREE.Matrix4(), _lo = new THREE.Vector3(), _ld = new THREE.Vector3();
function capProbe(o, d) {   // -> button id, '' (on the panel) or null
  const P = CAPX; if (!uiMount.visible) return null;
  _mi.copy(P.mesh.matrixWorld).invert(); _lo.copy(o).applyMatrix4(_mi); _ld.copy(o).add(d).applyMatrix4(_mi).sub(_lo);
  if (Math.abs(_ld.z) < 1e-9) return null; const t = -_lo.z / _ld.z; if (t <= 0) return null;
  const x = _lo.x + _ld.x * t, y = _lo.y + _ld.y * t; if (Math.abs(x) > P.wm / 2 || Math.abs(y) > P.hm / 2) return null;
  const px = (x / P.wm + 0.5) * P.cw, py = (0.5 - y / P.hm) * P.ch;
  for (const r of P.hits) if (px >= r[1] && px <= r[1] + r[3] && py >= r[2] && py <= r[2] + r[4]) return r[0];
  return '';
}
function capAct(id) { if (id === 'prev') goTo(S.i - 1); else if (id === 'next') goTo(S.i + 1); else if (id === 'auto') setAuto(!S.auto); else if (id === 'guide') { S.vrGuide = !S.vrGuide; CAPX.sig = ''; } }
const _O = new THREE.Vector3(), _D = new THREE.Vector3(), _q = new THREE.Quaternion();
function rayFromSource(frame, src) {
  const ref = renderer.xr.getReferenceSpace(); if (!frame || !ref || !src || !src.targetRaySpace) return false;
  const pose = frame.getPose(src.targetRaySpace, ref); if (!pose) return false;
  const p = pose.transform.position, q = pose.transform.orientation; rig.updateMatrixWorld();
  _O.set(p.x, p.y, p.z).applyMatrix4(rig.matrixWorld); _D.set(0, 0, -1).applyQuaternion(_q.set(q.x, q.y, q.z, q.w)).transformDirection(rig.matrixWorld);
  return true;
}
let hoverAt = 0;
function xrHoverStep(t, frame) {
  if (t - hoverAt < 100) return; hoverAt = t;
  const ses = renderer.xr.getSession(); if (!frame || !ses) return;
  let ch = null;
  for (const src of ses.inputSources) {
    if (!rayFromSource(frame, src)) continue;
    if (TBX && uiMount.visible && TBX.hover(_O, _D)) continue;
    const c = capProbe(_O, _D); if (c && ch == null) ch = c;
  }
  if (TBX) TBX.hoverEnd(t);
  if (CAPX.hover !== ch) { CAPX.hover = ch; CAPX.sig = ''; }
}
function onXRSelect(ev) {
  try {
    if (!rayFromSource(ev.frame, ev.inputSource)) return;
    if (TBX && uiMount.visible && TBX.select(_O, _D)) return;   // top controls and the card (its Exit row belongs to xr-safety)
    if (LAY && LAY.xr && LAY.xr._regionAtRay && LAY.xr._regionAtRay(_O, _D)) return;   // the shared Layers chip handles its own select
    const c = capProbe(_O, _D); if (c) capAct(c);
  } catch (e) { console.error(LOG, 'select', e); }
}
renderer.xr.addEventListener('sessionstart', () => {
  const ses = renderer.xr.getSession(); ses.addEventListener('select', onXRSelect);
  TB && TB.setXR(true); TB && TB.setCard(true); S.mode = 'hold'; S.leg = null; S.vrGuide = false; placeRig(); mountPending = true; uiMount.visible = false;
  aurora.setShown(S.pov === 'deck'); applyDetail(); $('vrBtn').textContent = 'Exit VR'; uiDirty();
});
renderer.xr.addEventListener('sessionend', () => {
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); camera.quaternion.identity(); uiMount.visible = false;
  TB && TB.setXR(false); applyDetail(); $('vrBtn').textContent = 'Enter VR'; resize(); uiDirty();
});
function setupVR() {
  if (!navigator.xr || !navigator.xr.isSessionSupported) return;
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return; $('vrBtn').hidden = false;
    $('vrBtn').onclick = async () => {
      if (xrNow()) { try { renderer.xr.getSession().end(); } catch (e) { /* ignore */ } return; }
      try {
        const init = Object.assign({}, XRS && XRS.sessionInit ? XRS.sessionInit : {}); init.optionalFeatures = [...new Set(['local-floor'].concat(init.optionalFeatures || []))];
        await renderer.xr.setSession(await navigator.xr.requestSession('immersive-vr', init));
      } catch (e) { status('Could not start VR: ' + ((e && e.message) || e)); }
    };
  }).catch(() => {});
}
setupVR();

// ------------------------------------------------------------------------------------------------ frame
const clock = new THREE.Clock();
let slow = 0, frames = 0, xrFrames = 0;
const leg = { pos: [0, 0, 0], heading: 0, pitch: 0 };
function tourStep(dt) {
  if (S.mode === 'glide' && S.leg) {
    S.legT += dt;
    const u = Math.min(1, S.legT / S.leg.dur); T.legPose(S.leg, u, leg);
    cur.pos[0] = leg.pos[0]; cur.pos[1] = leg.pos[1]; cur.pos[2] = leg.pos[2]; cur.heading = leg.heading; cur.pitch = leg.pitch;
    if (u >= 1) { S.mode = 'hold'; S.holdT = 0; S.leg = null; uiDirty(); moment(STOPS[S.i]); }
  } else {
    S.holdT += dt;
    if (xrNow()) { const p = poseFor(S.i), d = T.drift(STOPS[S.i], S.holdT, true); rig.position.set(p.pos[0] + d.off[0], p.pos[1] - VR_EYE + (CURVED ? d.off[1] : 0), p.pos[2] + d.off[2]); }
    else {
      const p = poseFor(S.i), d = S.pov === 'god' ? { off: [0, 0, 0], yaw: T.drift(STOPS[S.i], S.holdT).yaw * 0.5 } : T.drift(STOPS[S.i], S.holdT);
      cur.pos[0] = p.pos[0] + d.off[0]; cur.pos[1] = p.pos[1] + d.off[1]; cur.pos[2] = p.pos[2] + d.off[2]; cur.heading = p.heading + d.yaw; cur.pitch = p.pitch;
    }
    if (S.auto && S.holdT >= T.HOLD_S && !BL.on) goTo(S.i + 1, 'auto');
  }
}
function lookStep(dt) {   // the drag offset eases home 5 s after you let go
  if (performance.now() - S.look.at > 5000) { const k = 1 - Math.exp(-dt / 1.6); S.look.yaw -= S.look.yaw * k; S.look.pitch -= S.look.pitch * k; }
}
function atmosphereStep(dt) {
  const s = STOPS[S.i], k = 1 - Math.exp(-dt / 3);
  S.gold += ((s.golden && S.mode === 'hold' ? 1 : s.golden ? 0.6 : 0) - S.gold) * k;
  S.night += ((s.night ? 1 : 0) - S.night) * k;
  S.haze += (s.haze - S.haze) * k;
  const u = sky.material.uniforms, g = S.gold, nt = S.night;   // nt = 0 everywhere but night stops: the day / golden grade as before
  for (const key of ['zen', 'hor', 'low']) u[key].value.copy(tmpA.set(SKY.day[key])).lerp(tmpB.set(SKY.gold[key]), g).lerp(tmpB.set(SKY.night[key]), nt);
  u.sunCol.value.copy(tmpA.set(SKY.day.sun)).lerp(tmpB.set(SKY.gold.sun), g).lerp(tmpB.set(SKY.night.sun), nt);
  u.sun.value.copy(sunDir); u.sun.value.y = 0.55 - 0.42 * g; u.sun.value.normalize();
  scene.fog.color.copy(tmpA.set(SKY.day.fog)).lerp(tmpB.set(SKY.gold.fog), g).lerp(tmpB.set(SKY.night.fog), nt);
  const alt = Math.max(0, (CURVED ? T.fromLocal(...cur.pos).altMsl : cur.pos[1]) - (P.hazeTopM || 2500));   // high above the park the air thins: less haze
  scene.fog.density = (1e-5 + S.haze * S.haze * 6e-4) / (1 + alt / 4000);
  nightSky.set(nt, clock.elapsedTime);
  const tint = tmpA.set(SKY.day.tint).lerp(tmpB.set(SKY.gold.tint), g).lerp(tmpB.set(SKY.night.tint), nt);
  fallback.material.color.copy(tint);
  if (tiles && (frames % 15 === 0)) tiles.setTint(tint.getHex());
}
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
function cameraStep() {
  if (xrNow()) { camera.near = 0.1; }
  else {
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    camera.position.set(cur.pos[0], cur.pos[1], cur.pos[2]);
    eul.set(T.clamp(cur.pitch + S.look.pitch, -1.5, 1.2), Math.PI - cur.heading - S.look.yaw, 0, 'YXZ'); camera.quaternion.setFromEuler(eul);
    if (CURVED) camera.quaternion.premultiply(basisQuat(cur.pos, qBasis));   // headings and pitches are in the local horizon
  }
  const vr = xrNow(), framed = T.POV_FRAMED[S.pov];
  aurora.setShown(framed);
  if (vr) aurora.place(rig.position.x, rig.position.y, rig.position.z, cur.heading, true); else aurora.place(cur.pos[0], cur.pos[1], cur.pos[2], cur.heading, false);
  if (CURVED) aurora.group.quaternion.premultiply(basisQuat(vr ? rig.position.toArray() : cur.pos, qBasis));
  route.visible = pins.visible = S.pov === 'god';
  camera.updateMatrixWorld();
}
let uiAt = 0;
function uiStep(t) {
  if (t - uiAt < 250) return; uiAt = t;
  const f = S.mode === 'hold' ? T.clamp(S.holdT / T.HOLD_S, 0, 1) : 0;
  $('prog').firstChild.style.width = (S.auto ? f * 100 : 0).toFixed(1) + '%';
  const hidden = TB && TB.state() === 'hidden';
  $('cap').hidden = hidden || xrNow(); $('efb').hidden = !S.guide || hidden || xrNow();
  updateCard(); if (TB) TB.update();
  if (tiles) {
    const st = tiles.stats();
    if (!tilesShown && st.visible > 25 && st.loaded > 25) { tilesShown = true; fallback.visible = false; status('Google 3D', 3000); uiDirty(); }
    if (frames % 8 === 0) creditText = tiles.credits();
    if (!tilesShown && st.lastError && st.failed > 20 && !st.loaded) { tilesWhy = st.lastError; }
  }
}
function frame(time, xrFrame) {
  const dt = Math.min(0.1, clock.getDelta()), t = performance.now(); frames++;
  if (xrNow()) xrFrames++;
  tourStep(dt); lookStep(dt); atmosphereStep(dt); cameraStep();
  blinkStep(t);
  sky.position.copy(camera.getWorldPosition(_lo));
  if (CURVED) basisQuat(sky.position.toArray(), sky.quaternion);
  nightSky.group.position.copy(sky.position); nightSky.group.quaternion.copy(sky.quaternion);
  if (xrNow()) {
    if (mountPending && xrFrames > 2) mountUI();
    if (TBX) TBX.step(t);
    drawCapXR(); xrHoverStep(t, xrFrame);
  }
  if (tiles) { try { tiles.update(); } catch (e) { console.error(LOG, 'tiles', e); } }
  layersStep(dt);
  uiStep(t);
  renderer.render(scene, camera);
}
function resize() {
  if (xrNow()) return;
  camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 62 : 55; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(frame);
aurora.welcome(document.body, P.name);
loadLayers();

// for tests and the console (__yos: the name the Yosemite harness has always used; __tour: the same object on every park)
window.__tour = window.__yos = {
  S, cur, STOPS, goTo, setPov, setAuto, blinking: () => BL.on, tiles: () => tiles, tilesShown: () => tilesShown, frames: () => frames,
  renderer, camera, rig, aurora, mounted: () => uiMount.visible, tb: () => TBX, cap: CAPX, uiMount,
  inRig: (o) => rig.matrixWorld.clone().invert().multiply(o.matrixWorld), card: () => TBX && TBX.card, nightSky, park: P,
};
}

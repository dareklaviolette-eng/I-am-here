// I'M HERE · XR Aurora (Aurora-class lead ship, REG IH-0000), v1: the shared craft every tour and department loads into.
// Procedural three.js r165 (no downloads). One room, two levels: the Observation Lounge (globe table + ring menu, curved
// sofas, glass dome) and, up three glowing steps, the Helm (pilot seat + two, curved console with five live screens),
// with the Temporal Drive behind it. Exterior hull + energy field for Chase and God's eye: the founder's Meshy model
// (models/xr-aurora-hull.glb via hull.js, loaded after mount); the procedural hull shows until then, and if it fails.
//
// HOST API
//   import { Aurora } from '../shared/aurora/aurora.js';
//   Aurora.mount({ scene, camera, renderer, dom?, onToast?(text), onPOV?(id, label), onRing?(id) -> true to take over,
//                  onDestination?(id), destinations?: [{ id, text, sub, dis, sel }], topbarXR?: ImHereTopbar.xr(...) })
//       Adds the craft to the scene and puts the camera inside it (camera -> rig -> craft). Call once.
//   Aurora.loadWorld(world)   ride a world (see WORLD below). Aurora calls world.update(dt) every frame.
//   Aurora.setPOV(id)         'deck' | 'helm' | 'command' | 'bethere' | 'chase' | 'god'  (fade-blink; instant on first call)
//   Aurora.update(dt)         call once per frame BEFORE renderer.render (the host owns the loop)
//   Aurora.toast(text)        a short message (DOM via onToast on screens; an in-world panel in VR)
//   Aurora.setScreens(data)   extra helm-screen data: { wx, temp, tracked: [{ name, info, live }] }
//   Aurora.setQuality(level)  0 full, 1 lighter (no field / point lights), 2 lightest; wire it to xr-safety onQuality
//   Aurora.hover(o, d) / Aurora.select(o, d)   world-space ray (THREE.Vector3s) against the craft's controls
//   Aurora.povs               [[id, label]]   Aurora.pov  current id   Aurora.craft / rig / camera / uiMount
//   Aurora.hull               'procedural' until the Meshy hull is in, then 'meshy'   Aurora.hullReady  a Promise of that
//   Aurora.credits            credit lines for the host's Details (the Meshy hull line)
//
// WORLD (a small interface a tour module exports; e.g. travel/<place>/tour.js or aurora/yosemite-world.js)
//   {
//     name: 'Yosemite Valley',
//     origin: { lat, lon },                 // scene frame origin: metres, x = west, y = up (ellipsoid h), z = north
//     stops: [{ name, lat, lon, alt, heading, caption }],   // alt metres above sea level; heading degrees true
//     index,                                // the current (or next) stop
//     start(), next(), prev(), go?(i),      // begin / move along the tour
//     update(dt) -> { x, y, z, heading, moving }            // where the craft is now (scene frame), heading in degrees true
//     mapPoints?() -> [{ name, x, z }]      // for the helm map (defaults to the stops through toLocal)
//     toLocal?(lat, lon, alt) -> [x, y, z]
//   }
//   The craft rides that pose (position exact, heading eased with a turn-rate limit). The camera is a child of the craft,
//   so the room never spins around you: only the world outside moves.
//
// VR: the host enters the session; Aurora reads the controllers (ray + select / pinch) itself: ring menu, steps (lounge <->
// helm with a blink), the Destination list, and the shared top bar's VR panels when topbarXR is given (world-mounted on
// uiMount: in front of where you look when a POV starts; nothing follows the head). No per-frame allocations.
import * as THREE from 'three';
import { staticAtlas, ringMenu, screensAtlas, holoPanel, toastPanel, globeTexture, RING_ITEMS } from './panels.js';
import { L, makeMaterials, makeFxMaterials, buildInterior, buildExterior } from './build.js';
import { loadHull, HULL_CREDIT } from './hull.js';

const D2R = Math.PI / 180;
export const POVS = [['deck', 'Observation deck'], ['helm', 'Helm'], ['command', 'Command'], ['bethere', 'Be There'], ['chase', 'Chase'], ['god', "God's eye"]];
// rig pose per POV in the craft frame: floor point p, facing yaw (0 = toward the bow), seated / standing eye height (screens),
// default pitch (screens); look: a point the camera aims at (outside POVs)
const POV = {
  deck: { p: [-0.55, 0, -0.85], lookIn: [-2.6, 0.95, -14], eye: 1.36, inside: true },
  helm: { p: [L.pilot.x, L.platY, L.pilot.z + 0.05], yaw: 0, eye: 1.22, pitch: -0.07, inside: true },
  command: { p: [0.9, 0, -9.6], lookIn: [0, 1.05, -1.5], eye: 1.68, inside: true },
  bethere: { p: [0, 0, -8.5], yaw: 0, eye: 1.2, pitch: -0.02, inside: false },
  chase: { p: [36, 9, 30], look: [0, 1.0, -7], eye: 0, inside: false, outside: true },
  god: { p: [35, 130, 70], look: [0, 0, -6], eye: 0, inside: false, outside: true },
};

// reflection environment: a dark, warm-lit lounge with a bright sky dome above (what the chrome and glass reflect)
function envRoom() {
  const sc = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(vec3(0.55, 0.66, 0.78), vec3(0.22, 0.38, 0.62), h) : mix(vec3(0.16, 0.14, 0.13), vec3(0.03, 0.035, 0.045), min(1.0, -h * 3.0)); gl_FragColor = vec4(c, 1.0); }' }));
  sc.add(dome);
  const box = (c, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); sc.add(m); };
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; box(0xffb060, Math.sin(a) * 7, 2.5, Math.cos(a) * 7, 2.5, 0.12, 0.12); }
  box(0x6fd8ff, 0, -2.5, -6, 6, 0.1, 0.1); box(0x6fd8ff, 0, -2.5, 6, 6, 0.1, 0.1);
  box(0xfff3e0, 3, 8, -2, 3, 0.2, 3);
  return sc;
}

function createAurora() {
  const A = { povs: POVS, pov: null, mounted: false, quality: 0, hull: 'procedural', credits: [HULL_CREDIT], hullReady: null };
  let scene, camera, renderer, opts, M, fx, interior, exterior, craft, rig, uiMount, fade2D, fadeVR, lights = [], sun, meshy = null;
  let world = null, pose = null, yaw = 0, yawInit = false, time = 0, look = { yaw: 0, pitch: 0 }, screensAt = 0, extra = {};
  let blink = null, ring, screens, holo, toastP, toastMesh, toastUntil = 0, holoOpen = false, hover = { ring: null, holo: null, steps: false };
  let xrMountPending = 0, xrFrames = 0, sessionRef = null;
  // preallocated temporaries
  const vO = new THREE.Vector3(), vD = new THREE.Vector3(), vT = new THREE.Vector3(), mInv = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const rayO = [new THREE.Vector3(), new THREE.Vector3()], rayD = [new THREE.Vector3(), new THREE.Vector3()];

  A.mount = function (o) {
    if (A.mounted) return A; A.mounted = true; opts = o || {};
    scene = o.scene; camera = o.camera; renderer = o.renderer;
    const pm = new THREE.PMREMGenerator(renderer), envScene = envRoom(), env = pm.fromScene(envScene, 0.02).texture; pm.dispose();
    M = makeMaterials(env);
    ring = ringMenu(); screens = screensAtlas(); holo = holoPanel(); toastP = toastPanel();
    fx = makeFxMaterials(staticAtlas(), screens.tex, ring.tex, holo.tex, globeTexture());
    fx.ringMat.map = ring.tex;
    interior = buildInterior(M, fx); exterior = buildExterior(M, fx);
    craft = new THREE.Group(); craft.name = 'XR Aurora'; craft.add(interior.root, exterior.root); scene.add(craft);
    rig = new THREE.Group(); rig.name = 'aurora-rig'; craft.add(rig);
    if (camera.parent) camera.parent.remove(camera); rig.add(camera); camera.position.set(0, 1.2, 0); camera.rotation.set(0, 0, 0, 'YXZ');
    uiMount = new THREE.Group(); uiMount.name = 'aurora-ui-mount'; rig.add(uiMount);
    // lights: soft sky fill, a sun (direction fixed in the world, follows the craft), warm lounge + cool drive accents
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a3128, 1.1); craft.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.2); scene.add(sun); scene.add(sun.target);
    const warm = new THREE.PointLight(0xffb36b, 30, 16, 2); warm.position.set(L.table.x, 4.2, L.table.z); craft.add(warm);
    const warm2 = new THREE.PointLight(0xffc285, 22, 10, 2); warm2.position.set(0, 4.2, 3.0); craft.add(warm2);
    const cool = new THREE.PointLight(0x58c8ff, 16, 8, 2); cool.position.set(L.drive.x, L.drive.y + 1.9, L.drive.z); craft.add(cool);
    lights = [warm, warm2, cool];
    // the globe pin (the world's origin, or Yosemite until a world loads)
    placePin(37.7456, -119.5936);
    // fades: DOM for screens, a black sphere around the head for VR
    fade2D = document.createElement('div'); fade2D.id = 'auroraFade';
    fade2D.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:1550;transition:none';
    document.body.appendChild(fade2D);
    fadeVR = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }));
    fadeVR.renderOrder = 100000; fadeVR.visible = false; fadeVR.frustumCulled = false; rig.add(fadeVR);
    toastMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.097), new THREE.MeshBasicMaterial({ map: toastP.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    toastMesh.renderOrder = 10001; toastMesh.visible = false; toastMesh.position.set(0, -0.1, -0.85); toastMesh.rotation.x = 0.12; uiMount.add(toastMesh);
    if (opts.topbarXR) opts.topbarXR.attach(uiMount);
    // pointer (screens): drag to look, tap to select, hover highlights
    const dom = opts.dom || renderer.domElement; let down = null;
    dom.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY, yaw: look.yaw, pitch: look.pitch, moved: false, id: ev.pointerId }; try { dom.setPointerCapture(ev.pointerId); } catch (er) { /* */ } });
    dom.addEventListener('pointermove', (ev) => {
      if (down && ev.pointerId === down.id) {
        const dx = ev.clientX - down.x, dy = ev.clientY - down.y; if (Math.hypot(dx, dy) > 6) down.moved = true;
        if (down.moved) { const k = 2.2 / Math.max(300, dom.clientHeight); look.yaw = down.yaw + dx * k; look.pitch = THREE.MathUtils.clamp(down.pitch + dy * k, -1.25, 1.1); }
      } else if (ev.pointerType === 'mouse') { screenRay(ev, vO, vD); A.hover(vO, vD); hoverEnd(); dom.style.cursor = hover.ring || hover.holo || hover.steps ? 'pointer' : ''; }
    });
    const up = (ev) => { if (!down || ev.pointerId !== down.id) return; const tap = !down.moved; down = null; if (tap) { screenRay(ev, vO, vD); A.select(vO, vD); } };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', () => { down = null; });
    // VR
    const xr = renderer.xr;
    xr.addEventListener('sessionstart', () => {
      const s = xr.getSession(); sessionRef = s; xrMountPending = 1; xrFrames = 0;
      camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
      if (s) s.addEventListener('selectstart', onSelectStart);
      applyPOV(A.pov || 'deck');
    });
    xr.addEventListener('sessionend', () => { sessionRef = null; fadeVR.visible = false; toastMesh.visible = false; applyPOV(A.pov || 'deck'); });
    A.craft = craft; A.rig = rig; A.camera = camera; A.uiMount = uiMount; A.interior = interior; A.exterior = exterior; A.materials = M;
    A.setPOV(opts.pov || 'deck', { instant: true });
    // the Meshy hull: swap it in when it arrives; the procedural hull stays as the fallback
    const proc = exterior.root.children.filter((o) => o !== exterior.field);
    A.hullReady = loadHull(renderer, { url: opts.hullUrl }).then((h) => {
      meshy = h; proc.forEach((o) => { o.visible = false; }); exterior.root.add(h.root); h.glows.visible = A.quality < 2;
      A.hull = 'meshy'; if (A.pov) applyVisibility(A.pov); return 'meshy';
    }).catch((er) => { console.warn('[Aurora] Meshy hull did not load; procedural hull stays:', er && er.message || er); return 'procedural'; });
    return A;
  };

  // ------------------------------------------------------------------ worlds
  A.loadWorld = function (w) {
    world = w || null; yawInit = false;
    if (world && world.origin) placePin(world.origin.lat, world.origin.lon);
    if (world && world.start) try { world.start(); } catch (er) { console.error('[Aurora] world.start', er); }
    screensAt = 0; return A;
  };
  function placePin(lat, lon) {
    const phi = (lon + 180) / 360 * Math.PI * 2, th = (90 - lat) * D2R, r = 0.535;
    interior.dyn.pin.position.set(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
    // turn the globe so the pin faces the lounge's bow side at start
    interior.dyn.globe.rotation.y = Math.atan2(interior.dyn.pin.position.x, interior.dyn.pin.position.z) * -1 + Math.PI;
  }

  // ------------------------------------------------------------------ POV
  A.setPOV = function (id, o = {}) {
    if (!POV[id]) return A;
    if (o.instant || !A.pov) { applyPOV(id); return A; }
    if (id === A.pov && !o.force) return A;
    blink = { t: 0, to: id, switched: false };
    return A;
  };
  function applyPOV(id) {
    const P = POV[id], prev = A.pov; A.pov = id;
    const vr = renderer.xr.isPresenting;
    rig.position.set(P.p[0], P.p[1], P.p[2]);
    let pitch = P.pitch || 0, yw = P.yaw || 0;
    if (P.lookIn) { const dx = P.lookIn[0] - P.p[0], dy = P.lookIn[1] - P.p[1] - P.eye, dz = P.lookIn[2] - P.p[2]; yw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    if (P.look) { const dx = P.look[0] - P.p[0], dy = P.look[1] - P.p[1] - (vr ? 1.6 : 0), dz = P.look[2] - P.p[2]; yw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    rig.rotation.set(0, yw, 0);
    look.yaw = 0; look.pitch = pitch;
    if (!vr) { camera.position.set(0, P.eye, 0); camera.rotation.set(pitch, 0, 0, 'YXZ'); }
    applyVisibility(id);
    // Observation deck is calm: the helm screens dim; Helm / Command: live
    fx.screenMat.color.setScalar(id === 'deck' || id === 'bethere' ? 0.28 : 1);
    if (holoOpen && !(id === 'command' || id === 'deck')) setHolo(false);
    if (vr) xrMountPending = 1;
    if (prev !== id && opts.onPOV) try { opts.onPOV(id, POVS.find((x) => x[0] === id)[1]); } catch (er) { console.error('[Aurora] onPOV', er); }
  }
  function applyVisibility(id) {
    const P = POV[id];
    // outside, the Meshy hull is opaque: the interior inside it would only cost draw calls (the procedural hull has see-through glass)
    interior.root.visible = id !== 'bethere' && !(P.outside && meshy);
    exterior.root.visible = !!P.outside;
    exterior.field.visible = !!P.outside && A.quality < 1;
  }
  function mountUI() {   // VR: the UI band sits where you look when the POV starts (rig space), and stays there
    e.setFromQuaternion(camera.quaternion, 'YXZ');
    uiMount.position.copy(camera.position); uiMount.rotation.set(0, e.y, 0);
    uiMount.updateMatrixWorld(true);
    if (opts.topbarXR) opts.topbarXR.dirty = true;
  }

  // ------------------------------------------------------------------ toasts, holo list
  A.toast = function (text) {
    if (opts.onToast) try { opts.onToast(text); } catch (er) { /* */ }
    toastP.draw(text); toastUntil = time + 3.2; toastMesh.visible = renderer.xr.isPresenting;
    return A;
  };
  function holoItems() { return opts.destinations || [{ id: 'here', text: 'Yosemite Valley, CA', sub: "You're here", sel: true }, { id: 'glacier-bay', text: 'Glacier Bay, AK', sub: 'Coming soon', dis: true }]; }
  function setHolo(on) {
    holoOpen = on; interior.dyn.holo.visible = on;
    if (on) holo.draw('DESTINATION', holoItems(), hover.holo);
  }
  A.openDestinations = () => setHolo(true);
  A.closeDestinations = () => setHolo(false);
  A.destinationsOpen = () => holoOpen;

  // ------------------------------------------------------------------ ray tests (world-space ray; no allocations)
  function toCraft(o, d) {   // into craft-local rayO[0], rayD[0]
    craft.updateMatrixWorld(); mInv.copy(craft.matrixWorld).invert();
    rayO[0].copy(o).applyMatrix4(mInv); rayD[0].copy(d).transformDirection(mInv);
  }
  function hitSteps(O, D) {
    if (!interior.root.visible) return -1;
    const b = interior.dyn.steps; let t0 = 0, t1 = 60;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(D[ax]) < 1e-9) { if (O[ax] < b.min[ax] || O[ax] > b.max[ax]) return -1; continue; }
      let a = (b.min[ax] - O[ax]) / D[ax], c = (b.max[ax] - O[ax]) / D[ax]; if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return -1;
    }
    return t0;
  }
  function hitRing(O, D) {   // the slanted band: x^2 + z^2 = (a + b y)^2 around the table
    if (!interior.root.visible) return null;
    const T = L.table, ox = O.x - T.x, oy = O.y, oz = O.z - T.z;
    const b = (L.ringR1 - L.ringR0) / (L.ringY1 - L.ringY0), a = L.ringR0 - b * L.ringY0;
    const A2 = D.x * D.x + D.z * D.z - b * b * D.y * D.y, B2 = 2 * (ox * D.x + oz * D.z - (a + b * oy) * b * D.y), C2 = ox * ox + oz * oz - (a + b * oy) * (a + b * oy);
    const disc = B2 * B2 - 4 * A2 * C2; if (disc < 0 || Math.abs(A2) < 1e-9) return null;
    const sq = Math.sqrt(disc);
    for (const t of [(-B2 - sq) / (2 * A2), (-B2 + sq) / (2 * A2)].sort((x, y) => x - y)) {
      if (t <= 0) continue; const y = oy + D.y * t; if (y < L.ringY0 || y > L.ringY1) continue;
      let phi = Math.atan2(ox + D.x * t, oz + D.z * t); phi = (phi - L.ringPhi0 + Math.PI * 4) % (Math.PI * 2);
      if (phi > L.ringPhiLen) return null;   // the back of the band: no item (and it hides nothing behind it)
      // facing check: only the near side
      return { t, id: RING_ITEMS[Math.min(RING_ITEMS.length - 1, Math.floor(phi / L.ringPhiLen * RING_ITEMS.length))][0] };
    }
    return null;
  }
  function hitHolo(o, d) {   // world ray -> item id at the list panel (or '' on the panel, null off it)
    if (!holoOpen) return null;
    const p = interior.dyn.holo; p.updateMatrixWorld(); mInv.copy(p.matrixWorld).invert();
    vT.copy(o).applyMatrix4(mInv); rayD[1].copy(o).add(d).applyMatrix4(mInv).sub(vT);
    if (Math.abs(rayD[1].z) < 1e-9) return null; const t = -vT.z / rayD[1].z; if (t <= 0) return null;
    const x = vT.x + rayD[1].x * t, y = vT.y + rayD[1].y * t, g = p.geometry.parameters;
    if (Math.abs(x) > g.width / 2 || Math.abs(y) > g.height / 2) return null;
    return holo.hit((x / g.width + 0.5) * holo.size[0], (0.5 - y / g.height) * holo.size[1]) || '';
  }
  let hv = { ring: null, holo: null, steps: false };
  A.hover = function (o, d) {
    const h = hitHolo(o, d); if (h !== null) { if (!hv.holo) hv.holo = h || null; return true; }
    toCraft(o, d); const r = hitRing(rayO[0], rayD[0]); if (r) { if (!hv.ring) hv.ring = r.id; return true; }
    if (hitSteps(rayO[0], rayD[0]) >= 0) { hv.steps = true; return true; }
    return false;
  };
  function hoverEnd() {
    if (hv.ring !== hover.ring) { hover.ring = hv.ring; ring.draw(hover.ring, holoOpen ? 'destination' : null); }
    if (hv.holo !== hover.holo) { hover.holo = hv.holo; if (holoOpen) holo.draw('DESTINATION', holoItems(), hover.holo); }
    hover.steps = hv.steps; hv.ring = null; hv.holo = null; hv.steps = false;
  }
  A.hoverEnd = hoverEnd;
  A.select = function (o, d) {
    const h = hitHolo(o, d);
    if (h !== null) { if (h) pickDestination(h); return true; }
    toCraft(o, d);
    const r = hitRing(rayO[0], rayD[0]); if (r) { ringAction(r.id); return true; }
    if (hitSteps(rayO[0], rayD[0]) >= 0) { A.setPOV(A.pov === 'helm' ? 'deck' : 'helm'); return true; }
    if (holoOpen) { setHolo(false); ring.draw(hover.ring, null); }
    return false;
  };
  function ringAction(id) {
    if (opts.onRing) { let took = false; try { took = opts.onRing(id) === true; } catch (er) { console.error('[Aurora] onRing', er); } if (took) return; }
    const label = RING_ITEMS.find((x) => x[0] === id)[1];
    if (id === 'destination') { setHolo(!holoOpen); ring.draw(hover.ring, holoOpen ? 'destination' : null); return; }
    if (id === 'time') { A.toast('Time travel · coming soon'); return; }
    A.toast(label.charAt(0) + label.slice(1).toLowerCase() + ' · coming soon');
  }
  function pickDestination(id) {
    const it = holoItems().find((x) => x.id === id); if (!it) return;
    if (opts.onDestination) { try { if (opts.onDestination(id) === true) return; } catch (er) { console.error('[Aurora] onDestination', er); } }
    if (it.dis) { A.toast(it.text.split(',')[0] + ' · coming soon'); return; }
    setHolo(false); ring.draw(hover.ring, null); A.toast("You're here: " + it.text);
  }
  function screenRay(ev, o, d) {
    const r = (opts.dom || renderer.domElement).getBoundingClientRect();
    vT.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1, 0.5);
    camera.updateMatrixWorld(); o.setFromMatrixPosition(camera.matrixWorld);
    d.copy(vT).unproject(camera).sub(o).normalize();
  }
  A.screenRay = screenRay;

  // ------------------------------------------------------------------ VR input (called from update while presenting)
  function onSelectStart(ev) {
    try {
      const ref = renderer.xr.getReferenceSpace(); if (!ref || !ev.frame) return;
      if (!poseRay(ev.frame, ev.inputSource, ref, vO, vD)) return;
      if (opts.topbarXR && opts.topbarXR.select(vO, vD)) return;
      A.select(vO, vD);
    } catch (er) { console.error('[Aurora] select', er); }
  }
  function poseRay(frame, src, ref, o, d) {
    const p = frame.getPose(src.targetRaySpace, ref); if (!p) return false;
    const t = p.transform.position, r = p.transform.orientation;
    rig.updateMatrixWorld();
    o.set(t.x, t.y, t.z).applyMatrix4(rig.matrixWorld);
    d.set(0, 0, -1).applyQuaternion(q.set(r.x, r.y, r.z, r.w)).transformDirection(rig.matrixWorld);
    return true;
  }
  function xrStep(now) {
    const frame = renderer.xr.getFrame && renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace();
    if (!frame || !ref || !sessionRef) return;
    xrFrames++;
    if (xrMountPending && xrFrames > 2) { xrMountPending = 0; mountUI(); }
    const srcs = sessionRef.inputSources;
    for (let i = 0; i < srcs.length; i++) {
      if (!poseRay(frame, srcs[i], ref, vO, vD)) continue;
      if (opts.topbarXR && opts.topbarXR.hover(vO, vD)) continue;
      A.hover(vO, vD);
    }
    if (opts.topbarXR) { opts.topbarXR.hoverEnd(now); opts.topbarXR.step(now); }
    hoverEnd();
    fadeVR.position.copy(camera.position);
  }

  // ------------------------------------------------------------------ screens
  A.setScreens = function (d) { Object.assign(extra, d || {}); screensAt = 0; return A; };
  const fmtLL = (v, p, n) => Math.abs(v).toFixed(4) + '° ' + (v >= 0 ? p : n);
  function screenData() {
    const now = new Date(), stop = world && world.stops ? world.stops[world.index || 0] : null;
    const d = { date: now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase(), time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) };
    if (stop) {
      d.place = stop.name; d.lat = fmtLL(stop.lat, 'N', 'S'); d.lon = fmtLL(stop.lon, 'E', 'W');
      d.alt = Math.round((pose ? world.altMsl ? world.altMsl() : stop.alt : stop.alt) / 0.3048).toLocaleString('en-US') + ' ft';
      d.guideTitle = stop.name; d.guide = stop.caption || '';
      d.mapTitle = (world.name || 'ROUTE').toUpperCase();
      const pts = world.mapPoints ? world.mapPoints() : null; d.map = pts || []; d.stop = world.index || 0;
    }
    const h = ((Math.PI - yaw) / D2R % 360 + 360) % 360; d.hdg = String(Math.round(h)).padStart(3, '0') + '°'; d.heading = h * D2R;
    d.me = pose ? { x: pose.x, z: pose.z } : { x: 0, z: 0 };
    d.wx = extra.wx || '—'; d.temp = extra.temp || '—'; d.tracked = extra.tracked || null;
    return d;
  }

  // ------------------------------------------------------------------ quality
  A.setQuality = function (n) {
    A.quality = n;
    lights.forEach((l) => { l.visible = n < 1; });
    exterior.field.visible = n < 1 && exterior.root.visible;
    interior.dyn.coreGlow.visible = n < 2;
    if (meshy) meshy.glows.visible = n < 2;
    return A;
  };

  // ------------------------------------------------------------------ per frame
  A.update = function (dt) {
    if (!A.mounted) return;
    dt = Math.min(0.1, Math.max(0, dt || 0)); time += dt;
    const now = performance.now(), vr = renderer.xr.isPresenting;
    // ride the world
    if (world && world.update) {
      let p = null; try { p = world.update(dt); } catch (er) { console.error('[Aurora] world.update', er); }
      if (p) {
        pose = p; craft.position.set(p.x, p.y, p.z);
        const target = Math.PI - (p.heading || 0) * D2R;
        if (!yawInit) { yaw = target; yawInit = true; }
        let dy = target - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const maxRate = 0.35 * dt, step = THREE.MathUtils.clamp(dy * Math.min(1, dt * 1.6), -maxRate, maxRate);   // gentle: never faster than 20 deg/s
        yaw += step; craft.rotation.set(0, yaw, 0);
      }
    }
    // sun: fixed direction in the world (afternoon, from the south-west), near the craft
    sun.position.set(craft.position.x + 400, craft.position.y + 700, craft.position.z - 300); sun.target.position.copy(craft.position);
    // living details
    const dyn = interior.dyn;
    if (interior.root.visible) {
      dyn.globe.rotation.y += dt * 0.12; dyn.halo.rotation.z += dt * 0.25; fx.globeMat.uniforms.t.value = time;
      dyn.rings[0].rotation.y += dt * 0.55; dyn.rings[1].rotation.x += dt * 0.8; dyn.rings[2].rotation.z += dt * 1.15;
      const pulse = 1 + 0.08 * Math.sin(time * 2.4); dyn.core.scale.setScalar(pulse); dyn.coreGlow.scale.setScalar(1.8 * pulse);
      dyn.pin.material.opacity = 0.65 + 0.35 * Math.sin(time * 3);
    }
    if (exterior.root.visible) fx.fieldMat.uniforms.t.value = time;
    uiMount.visible = vr;
    // screen (2D) look
    if (!vr) { camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ'); }
    // blink
    if (blink) {
      blink.t += dt;
      const outT = 0.18, inT = 0.3; let a;
      if (!blink.switched) { a = Math.min(1, blink.t / outT); if (blink.t >= outT) { blink.switched = true; blink.t = 0; applyPOV(blink.to); a = 1; } }
      else { a = 1 - Math.min(1, blink.t / inT); if (blink.t >= inT) { blink = null; a = 0; } }
      fade2D.style.opacity = vr ? '0' : String(a);
      fadeVR.visible = vr && a > 0; fadeVR.material.opacity = a;
    }
    // toast (VR panel)
    if (toastMesh.visible && time > toastUntil) toastMesh.visible = false;
    if (vr) xrStep(now);
    // helm screens: at most once a second, only when seen
    if (interior.root.visible && time - screensAt > 1) { screensAt = time; screens.update(screenData()); }
  };
  A.isBlinking = () => !!blink;
  A.hovered = () => ({ ring: hover.ring, holo: hover.holo, steps: hover.steps });
  A.screenData = () => screenData();
  return A;
}

export const Aurora = createAurora();
export default Aurora;

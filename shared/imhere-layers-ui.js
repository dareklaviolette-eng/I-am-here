// I'M HERE universal Layers control + the gaze/point marker for world layers (shared/world-layers.js).
//
// Screens (phone tap / mouse click): a small "◫ Layers ▾" chip fixed in the TOP-RIGHT corner: [ POV ▾ ][ ◫ Layers ▾ ], Layers in
//   the very corner (approved Nov 11 top controls). The POV chip is not built here: the cluster keeps an empty slot
//   (data-slot="pov") at its left; or a host (the shared top bar) mounts the chip: createLayersChip({ host }).
//   Tap opens a drop-down (DOWN the right side) of toggles (Planes, Ships, Wildlife, ISS); layers that do not exist yet show disabled, "soon".
//   It closes ~4 s after the last interaction, ~1.2 s after the mouse leaves it, on a tap elsewhere, or with Esc.
// VR (any WebXR headset): the same chip on a panel world-mounted top-right on the vehicle (createLayersXR({ anchor })), list
//   opening down, big targets; without an anchor it floats top-right with a lazy follow. Point a controller or hand ray at it and select (trigger or pinch).
//   Nothing else: no A/B/X/Y, thumbstick or grip. The page's own select handler should ignore selects that hit it:
//   if (ui.xr.pointing(controller)) return;
// Markers: a subtle tag "callsign · altitude · ↑" appears only on the item you gaze at (screen centre / headset) or point
//   at (mouse, a tap, a controller or hand ray). At most 3 at once, canvases repainted only when the words change.
// Style from the card spec: dark navy panel 60 %, hairline white 28 % border, cyan labels 70 %, white values 92 %, monospace.

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const CSS = `
.imh-chips{position:fixed;right:calc(10px + env(safe-area-inset-right));top:calc(10px + env(safe-area-inset-top));z-index:1490;display:flex;gap:8px;align-items:flex-start;font:12px/1.2 ${MONO};pointer-events:none}
.imh-chips>*{pointer-events:auto}
.imh-chips [data-slot=pov]:empty{width:var(--imh-pov-w,132px);pointer-events:none}
.imh-lay .imh-menu{z-index:1}
.imh-lay{position:relative}
.imh-chips button.imh-chip{background:rgba(10,18,32,.6);border:1px solid rgba(255,255,255,.28);color:rgba(255,255,255,.92);border-radius:17px;padding:8px 13px;font:inherit;
  letter-spacing:.06em;cursor:pointer;min-height:34px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);white-space:nowrap}
.imh-chips button.imh-chip:hover,.imh-chips button.imh-chip[aria-expanded=true]{background:rgba(22,36,58,.75)}
.imh-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:230px;background:rgba(10,18,32,.6);border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:4px;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.imh-menu[hidden]{display:none}
.imh-chips button.imh-row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;width:100%;gap:2px 12px;background:none;border:0;border-radius:7px;
  color:rgba(255,255,255,.92);font:inherit;padding:9px 10px;cursor:pointer;text-align:left;min-height:42px}
.imh-chips button.imh-row:hover:not(:disabled){background:rgba(255,255,255,.08)}
.imh-chips button.imh-row:disabled{cursor:default;opacity:1}
.imh-row .n{color:rgba(91,214,255,.7);letter-spacing:.08em;text-transform:uppercase}
.imh-row .v{color:rgba(255,255,255,.92);min-width:3.2em;text-align:right}
.imh-row .v.off{color:rgba(255,255,255,.5)}
.imh-row:disabled .n,.imh-row:disabled .v{color:rgba(255,255,255,.38)}
.imh-row .s{flex-basis:100%;color:rgba(255,255,255,.55);font-size:10.5px;letter-spacing:.02em;text-transform:none}
`;

// ------------------------------------------------------------------------------------------------ screen chip
// host (optional): an element that hosts the chip (e.g. the shared top bar's right corner). The chip is appended to it and
// no cluster of its own is made. Without a host: a fixed top-right cluster [ POV slot ][ ◫ Layers ▾ ], Layers in the corner.
export function createLayersChip({ layers, mount = document.body, host = null, closeMs = 4000, leaveMs = 1200 }) {
  if (!document.getElementById('imh-layers-style')) { const st = document.createElement('style'); st.id = 'imh-layers-style'; st.textContent = CSS; document.head.appendChild(st); }
  let cluster = host || document.querySelector('.imh-chips');
  if (!cluster) { cluster = document.createElement('div'); cluster.className = 'imh-chips'; const pov = document.createElement('div'); pov.dataset.slot = 'pov'; cluster.appendChild(pov); mount.appendChild(cluster); }
  const wrap = document.createElement('div'); wrap.className = 'imh-lay'; wrap.dataset.slot = 'layers';
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'imh-chip'; chip.textContent = '◫ Layers ▾';
  chip.setAttribute('aria-haspopup', 'menu'); chip.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.className = 'imh-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'World layers'); menu.hidden = true;
  wrap.append(menu, chip); cluster.appendChild(wrap);
  let open = false, closeAt = 0, timer = 0, sig = '';
  const touch = (ms = closeMs) => { closeAt = Date.now() + ms; };
  const rowEls = new Map();   // built once and updated in place (a row replaced under the pointer would swallow the click)
  function render(force) {
    const L = layers.list(), sg = JSON.stringify(L); if (sg === sig && !force) return; sig = sg;
    for (const it of L) {
      let r = rowEls.get(it.id);
      if (!r) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'imh-row'; b.dataset.layer = it.id; b.setAttribute('role', 'menuitemcheckbox');
        const n = document.createElement('span'); n.className = 'n'; const v = document.createElement('span'); v.className = 'v'; const x = document.createElement('span'); x.className = 's';
        b.append(n, v, x);
        b.addEventListener('click', (e) => { e.stopPropagation(); if (b.disabled) return; layers.toggle(it.id); touch(); render(true); });
        menu.appendChild(b); rowEls.set(it.id, (r = { b, n, v, x }));
      }
      r.b.disabled = !it.built; r.b.setAttribute('aria-checked', String(it.on));
      r.n.textContent = it.label; r.v.textContent = !it.built ? 'soon' : it.on ? 'ON' : 'OFF'; r.v.className = 'v' + (it.on ? '' : ' off');
      const st = it.built && it.on ? it.status : ''; r.x.textContent = st; r.x.hidden = !st;
    }
  }
  function setOpen(on) {
    open = on; menu.hidden = !on; chip.setAttribute('aria-expanded', String(on)); clearInterval(timer);
    if (on) { render(true); touch(); timer = setInterval(() => { if (Date.now() > closeAt) setOpen(false); else render(); }, 250); }
  }
  chip.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  wrap.addEventListener('pointermove', () => { if (open) touch(); });
  wrap.addEventListener('pointerenter', () => { if (open) touch(); });
  wrap.addEventListener('pointerleave', (e) => { if (open && e.pointerType === 'mouse') closeAt = Math.min(closeAt, Date.now() + leaveMs); });   // pointing away
  document.addEventListener('pointerdown', (e) => { if (open && !wrap.contains(e.target)) setOpen(false); }, true);
  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { setOpen(false); chip.focus(); } });
  const off = layers.onChange(() => { if (open) render(); });
  return { el: wrap, chip, menu, cluster, open: () => setOpen(true), close: () => setOpen(false), isOpen: () => open,
    dispose() { off(); clearInterval(timer); wrap.remove(); } };
}

// ------------------------------------------------------------------------------------------------ VR chip
// anchor (recommended, approved Nov 11 top-controls design): an Object3D the host world-mounts high on the vehicle (top
// right of the windshield / bridge window), facing the user (+z toward them); the chip's centre sits on it and the list opens
// DOWN. The host re-mounts the anchor on a seat change and on Recenter. Without an anchor the chip floats top-right with a
// lazy body-locked follow (fallback for pages without a vehicle).
export function createLayersXR({ THREE, renderer, camera, layers, anchor = null, place = { right: 0.30, down: -0.12, ahead: 0.62 }, width = 0.19, closeMs = 4000, awayMs = 1500 }) {
  const W = 512, H = 620, ROW = 112, CHIP_Y = 0, CHIP_H = 112, ROWS_Y = CHIP_Y + CHIP_H + 16;   // canvas layout (px): the chip on top, the list below it
  const k = width / W, Hm = H * k, off = (H / 2 - (CHIP_Y + CHIP_H / 2)) * k;   // geometry shifted so the chip centre is the origin
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(width, Hm); geo.translate(0, -off, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  mesh.name = 'imhere-layers-xr'; mesh.renderOrder = 99990; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.visible = false;
  let open = false, hover = null, sig = '', closeAt = 0, lastPointed = 0, anchorYaw = null;
  const inv = new THREE.Matrix4(), e3 = new THREE.Euler(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1),
    o = new THREE.Vector3(), d = new THREE.Vector3(), m3 = new THREE.Matrix4(), hitOut = { x: 0, y: 0 };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function draw() {
    const L = layers.list(), s = open + '|' + hover + '|' + JSON.stringify(L); if (s === sig) return; sig = s;
    g.clearRect(0, 0, W, H);
    g.lineWidth = 3; g.textBaseline = 'middle';
    if (open) {
      const top = ROWS_Y;
      g.fillStyle = 'rgba(10,18,32,.78)'; rr(4, top, W - 8, L.length * ROW, 26); g.fill(); g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
      L.forEach((it, i) => {
        const y = top + i * ROW;
        if (hover === it.id && it.built) { g.fillStyle = 'rgba(255,255,255,.14)'; rr(12, y + 8, W - 24, ROW - 16, 18); g.fill(); }
        g.font = `600 44px ${MONO}`; g.textAlign = 'left'; g.fillStyle = it.built ? 'rgba(91,214,255,.85)' : 'rgba(255,255,255,.38)';
        g.fillText(it.label.toUpperCase(), 34, y + (it.status ? ROW / 2 - 14 : ROW / 2));
        g.textAlign = 'right'; g.fillStyle = !it.built ? 'rgba(255,255,255,.38)' : it.on ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.5)';
        g.fillText(!it.built ? 'soon' : it.on ? 'ON' : 'OFF', W - 34, y + ROW / 2 - (it.status ? 14 : 0));
        if (it.status) { g.textAlign = 'left'; g.font = `400 26px ${MONO}`; g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(it.status.slice(0, 30), 34, y + ROW / 2 + 26); }
      });
    }
    g.fillStyle = hover === 'chip' ? 'rgba(26,44,70,.92)' : 'rgba(10,18,32,.78)'; rr(4, CHIP_Y, W - 8, CHIP_H, CHIP_H / 2); g.fill(); g.strokeStyle = 'rgba(255,255,255,.4)'; g.stroke();
    g.font = `600 50px ${MONO}`; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.95)'; g.fillText('◫ Layers ' + (open ? '▴' : '▾'), W / 2, CHIP_Y + CHIP_H / 2 + 2);
    tex.needsUpdate = true;
  }
  // ray (world) -> canvas px on the panel, or null
  function hitPx(origin, dir) {
    if (!mesh.visible) return null;
    o.copy(origin).applyMatrix4(inv); d.copy(dir).transformDirection(inv);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = -o.z / d.z; if (t <= 0 || t > 5) return null;
    const x = o.x + d.x * t, y = o.y + d.y * t + off;
    hitOut.x = (x / width + 0.5) * W; hitOut.y = (0.5 - y / Hm) * H;
    return hitOut.x >= 0 && hitOut.x <= W && hitOut.y >= 0 && hitOut.y <= H ? hitOut : null;
  }
  function regionAt(p) {
    if (!p) return null;
    if (p.y >= CHIP_Y && p.y <= CHIP_Y + CHIP_H) return 'chip';
    if (!open) return null;
    const L = layers.list(), top = ROWS_Y, i = Math.floor((p.y - top) / ROW);
    return p.y >= top && i >= 0 && i < L.length ? L[i].id : null;
  }
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function ctrlRegion(ctrl) {
    if (!ctrl || !mesh.visible) return null;
    _o.setFromMatrixPosition(ctrl.matrixWorld); m3.extractRotation(ctrl.matrixWorld); _d.set(0, 0, -1).applyMatrix4(m3).normalize();
    return regionAt(hitPx(_o, _d));
  }
  function act(region) {
    closeAt = Date.now() + closeMs;
    if (region === 'chip') { open = !open; return true; }
    if (region) { const it = layers.list().find((x) => x.id === region); if (it && it.built) layers.toggle(region); return true; }
    return false;
  }
  const ctrls = [0, 1].map((i) => renderer.xr.getController(i));
  for (const ct of ctrls) ct.addEventListener('selectstart', () => { const r = ctrlRegion(ct); if (r) { act(r); draw(); } });
  renderer.xr.addEventListener('sessionstart', () => { anchorYaw = null; open = false; sig = ''; });
  renderer.xr.addEventListener('sessionend', () => { mesh.visible = false; open = false; });
  // every frame (cheap; no allocations)
  function update() {
    if (!renderer.xr.isPresenting) { if (mesh.visible) mesh.visible = false; return; }
    if (anchor) {   // world-mounted on the vehicle: nothing follows the head
      if (mesh.parent !== anchor) anchor.add(mesh);
      anchor.updateWorldMatrix(true, false); mesh.matrix.identity(); mesh.matrixWorld.copy(anchor.matrixWorld); inv.copy(mesh.matrixWorld).invert();
    } else {
    const rig = camera.parent; if (!rig) return;
    if (mesh.parent !== rig) rig.add(mesh);
    // body-locked, lazy follow: trails the head's yaw, never more than ~26° off where you look
    e3.setFromQuaternion(camera.quaternion, 'YXZ'); const yaw = e3.y;
    if (anchorYaw === null) anchorYaw = yaw;
    const dy = Math.atan2(Math.sin(yaw - anchorYaw), Math.cos(yaw - anchorYaw));
    if (Math.abs(dy) > 0.45) anchorYaw += dy - (dy > 0 ? 0.45 : -0.45); else anchorYaw += dy * 0.02;
    const cy = Math.cos(anchorYaw), sy = Math.sin(anchorYaw), p = camera.position;
    v.set(p.x - sy * place.ahead + cy * place.right, p.y - place.down, p.z - cy * place.ahead - sy * place.right);
    q.setFromEuler(e3.set(-0.3, anchorYaw, 0, 'YXZ'));
    mesh.matrix.compose(v, q, one); mesh.matrixWorld.multiplyMatrices(rig.matrixWorld, mesh.matrix); inv.copy(mesh.matrixWorld).invert();
    }
    mesh.visible = true;
    let h = null; for (const ct of ctrls) { const r = ctrlRegion(ct); if (r) h = r; }
    const now = Date.now();
    if (h) lastPointed = now;
    if (h !== hover) { hover = h; if (h) closeAt = now + closeMs; }
    if (open && (now > closeAt || now - lastPointed > awayMs)) open = false;   // ~4 s idle, or pointing away
    draw();
  }
  draw();
  return { mesh, update, pointing: (ctrl) => !!ctrlRegion(ctrl), isOpen: () => open, hover: () => hover,
    rowOffset: (id) => { const L = layers.list(), i = L.findIndex((x) => x.id === id); return i < 0 ? null : (CHIP_Y + CHIP_H / 2 - (ROWS_Y + i * ROW + ROW / 2)) * k; },   // metres above the chip centre (negative: below; tests)
    open: () => { open = true; closeAt = Date.now() + closeMs; lastPointed = Date.now(); },
    _regionAtRay: (origin, dir) => regionAt(hitPx(origin, dir)) };
}

// ------------------------------------------------------------------------------------------------ gaze / point markers
// rayOk(origin, dir) (optional): false = this ray is looking at the inside of the vehicle (e.g. down at the instrument
// panel), so no marker is shown through it. A page passes its own cheap rule.
export function createHoverMarkers({ THREE, scene, camera, renderer, layers, dom = renderer.domElement, gazeDeg = 2.2, pointDeg = 1.6, ctrlDeg = 2.5, touchMs = 4000, rayOk = null }) {
  const N = 4, markers = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 72; const tex = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0.9 }));
    s.center.set(0.5, 0); s.renderOrder = 9990; s.visible = false; s.frustumCulled = false; s.name = 'imhere-layer-marker'; scene.add(s);
    markers.push({ s, c, g: c.getContext('2d'), tex, item: null, text: '', at: 0 });
  }
  const ptr = { ndc: new THREE.Vector2(), at: 0, mouse: false, inside: false }, rc = new THREE.Raycaster();
  dom.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; ptr.mouse = true; ptr.inside = true; ptr.at = performance.now(); setNdc(e); });
  dom.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') ptr.inside = false; });
  dom.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; ptr.mouse = false; ptr.at = performance.now(); setNdc(e); });   // a tap shows the marker for ~4 s
  function setNdc(e) { const r = dom.getBoundingClientRect(); ptr.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  const eye = new THREE.Vector3(), fwd = new THREE.Vector3(), m3 = new THREE.Matrix4(), ro = new THREE.Vector3(), rd = new THREE.Vector3();
  function paint(m, text) {
    const g = m.g; g.clearRect(0, 0, 512, 72); g.font = `600 34px ${MONO}`; const w = Math.min(500, g.measureText(text).width + 32);
    g.fillStyle = 'rgba(10,18,32,.6)'; g.beginPath(); g.roundRect ? g.roundRect(256 - w / 2, 6, w, 60, 12) : g.rect(256 - w / 2, 6, w, 60); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.92)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 37, 480); m.tex.needsUpdate = true;
  }
  let used = 0;
  function show(item) {
    for (let i = 0; i < used; i++) if (markers[i].item === item) return;   // already shown for another ray
    if (used >= N) return; const m = markers[used++];
    const now = performance.now();
    if (m.item !== item || now - m.at > 500) { const t = item.text(); m.at = now; if (t !== m.text || m.item !== item) { m.text = t; paint(m, t); } m.item = item; }
    const dx = item.x - eye.x, dy = item.y - eye.y, dz = item.z - eye.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const h = dist * 0.038;   // ~2.2° tall wherever it is (small, but readable in a headset)
    m.s.position.set(item.x, item.y + item.r * 0.2 + h * 0.25, item.z); m.s.scale.set(h * 512 / 72, h, 1); m.s.visible = true;
  }
  function ray(o, d, deg) { if (rayOk && !rayOk(o, d)) return; const it = layers.pick(o, d, deg); if (it) show(it); }
  function update() {
    used = 0;
    camera.getWorldPosition(eye);
    const vr = renderer.xr.isPresenting;
    fwd.set(0, 0, -1).transformDirection(camera.matrixWorld); ray(eye, fwd, gazeDeg);   // gaze
    if (!vr && ptr.at && (ptr.mouse ? ptr.inside && performance.now() - ptr.at < 15000 : performance.now() - ptr.at < touchMs)) {
      rc.setFromCamera(ptr.ndc, camera); ray(rc.ray.origin, rc.ray.direction, pointDeg);
    }
    if (vr) for (let i = 0; i < 2; i++) {
      const ct = renderer.xr.getController(i); if (!ct.visible) continue;
      ro.setFromMatrixPosition(ct.matrixWorld); m3.extractRotation(ct.matrixWorld); rd.set(0, 0, -1).applyMatrix4(m3).normalize(); ray(ro, rd, ctrlDeg);
    }
    for (let i = used; i < N; i++) if (markers[i].s.visible) { markers[i].s.visible = false; markers[i].item = null; }
  }
  return { update, markers, visibleCount: () => markers.filter((m) => m.s.visible).length, texts: () => markers.filter((m) => m.s.visible).map((m) => m.text) };
}

// All three together, for a page: const ui = createLayersUI({ THREE, renderer, scene, camera, layers }); ui.update() each frame.
export function createLayersUI(o) {
  const chip = createLayersChip(o), xr = createLayersXR(o), markers = createHoverMarkers(o);
  return { chip, xr, markers, update() { xr.update(); markers.update(); } };
}

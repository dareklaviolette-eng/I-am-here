// How you reach the EFB in VR (v1; the founder is still deciding, so this file is the only place that knows):
//   1. Kneeboard dock: a small EFB lying low at the left of your seat (seat-anchored, never follows your head).
//      Point + select it -> the EFB rises to reading height in front of you. Stow (⌄ on the EFB) or look away -> back down.
//   2. Wrist button: a small globe on the left controller / hand. Point the other hand at it + select -> same as 1.
//   3. Quick POV chips on the dock's edge: one select changes seat without opening anything.
// All three are plain point + select (trigger or pinch). Nothing here uses grips, buttons or sticks.
//
// createEFBAccess({ THREE, renderer, rig, camera, efb, onPOV(id), dockData() -> { povs: [[id, label]], pov, title } })
//   .update(dt, nowMs)  per frame in VR (no allocations)        .mount()  re-seat the dock in front of the seat (VR start,
//   .ray(o, d, press)   world ray: true when it hit one of ours   recenter, POV change)
//   .open() .stow() .isOpen()   .setVisible(bool)   .redrawDock()   .dispose()
import { MONO, SANS, GREEN, rrect, fitText } from './util.js';
import { EFB_W, EFB_H } from './efb.js';
import { drawGlobe } from './globe.js';

export function createEFBAccess({ THREE, renderer, rig, camera, efb, onPOV = () => {}, dockData = () => ({ povs: [], pov: '' }) }) {
  const PW = 0.40, PH = PW * EFB_H / EFB_W;   // the EFB: 40 x 53 cm, like a big tablet at arm's length
  const DW = 0.24, DH = 0.15, DCW = 512, DCH = 320;
  const tex = new THREE.CanvasTexture(efb.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.anisotropy = 4;
  const mat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
  // the EFB panel
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), mat(tex)); panel.name = 'efb-panel'; panel.renderOrder = 9000; panel.visible = false;
  // the dock (kneeboard) with its POV chips
  const dcv = document.createElement('canvas'); dcv.width = DCW; dcv.height = DCH; const dg = dcv.getContext('2d');
  const dtex = new THREE.CanvasTexture(dcv); dtex.colorSpace = THREE.SRGBColorSpace; dtex.generateMipmaps = false; dtex.minFilter = THREE.LinearFilter;
  const dock = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), mat(dtex)); dock.name = 'efb-dock'; dock.renderOrder = 8990;
  // the wrist button
  const wcv = document.createElement('canvas'); wcv.width = wcv.height = 128; const wg = wcv.getContext('2d');
  wg.beginPath(); wg.arc(64, 64, 60, 0, Math.PI * 2); wg.fillStyle = 'rgba(12,22,40,0.95)'; wg.fill(); wg.lineWidth = 6; wg.strokeStyle = 'rgba(150,215,255,0.85)'; wg.stroke();
  drawGlobe(wg, 64, 64, 44, 25, -40);
  const wtex = new THREE.CanvasTexture(wcv); wtex.colorSpace = THREE.SRGBColorSpace;
  const wrist = new THREE.Mesh(new THREE.CircleGeometry(0.028, 24), mat(wtex)); wrist.name = 'efb-wrist'; wrist.renderOrder = 8995; wrist.visible = false;
  wrist.position.set(0, 0.03, 0.06); wrist.rotation.set(-Math.PI / 2 + 0.5, 0, 0);   // on top of the wrist, tilted toward you
  const seat = new THREE.Group(); seat.name = 'efb-seat'; rig.add(seat);   // where the dock sits (re-mounted on VR start / recenter / POV)
  const read = new THREE.Group(); read.name = 'efb-read'; rig.add(read);   // where the EFB opens (in front of where you looked)
  seat.add(dock); read.add(panel);
  dock.position.set(-0.30, -0.58, -0.30); dock.rotation.set(-1.0, 0.45, 0, 'YXZ');
  // the grips: wrist button on the left one
  const grips = [0, 1].map((i) => { const gr = renderer.xr.getControllerGrip(i); rig.add(gr); return gr; });
  const onConn = (ev) => { const gr = ev.target; if (ev.data && ev.data.handedness === 'left') { gr.add(wrist); wrist.visible = true; } };
  const onDisc = (ev) => { if (wrist.parent === ev.target) { ev.target.remove(wrist); wrist.visible = false; } };
  grips.forEach((gr) => { gr.addEventListener('connected', onConn); gr.addEventListener('disconnected', onDisc); });

  let open = false, anim = 0, animDir = 0, awayT = 0, dockHits = [], dockHover = null, mounted = false, visible = true;
  const from = new THREE.Vector3(), to = new THREE.Vector3(), qFrom = new THREE.Quaternion(), qTo = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ'), vLo = new THREE.Vector3(), vLd = new THREE.Vector3(), mInv = new THREE.Matrix4(), v3 = new THREE.Vector3();
  const READ = new THREE.Vector3(0.0, -0.16, -0.52), READ_PITCH = -0.22;

  function headYaw() { e.setFromQuaternion(camera.quaternion, 'YXZ'); return e.y; }
  function mount() {   // the dock: low at the left of the seat, where the head is now (rig space); stays there
    seat.position.set(camera.position.x, camera.position.y, camera.position.z); seat.rotation.set(0, headYaw(), 0);
    seat.updateMatrixWorld(true); mounted = true; redrawDock();
  }
  function placeRead() { read.position.copy(seat.position); read.position.x = camera.position.x; read.position.z = camera.position.z; read.position.y = camera.position.y; read.rotation.set(0, headYaw(), 0); read.updateMatrixWorld(true); }
  function doOpen() {
    if (open) return; placeRead(); open = true; awayT = 0;
    // rise: from the dock's pose to reading height (both in the read group's space)
    dock.updateMatrixWorld(true); read.updateMatrixWorld(true);
    mInv.copy(read.matrixWorld).invert(); from.setFromMatrixPosition(dock.matrixWorld).applyMatrix4(mInv);
    to.copy(READ); qTo.setFromEuler(e.set(READ_PITCH, 0, 0, 'YXZ')); qFrom.copy(qTo);
    anim = 0; animDir = 1; panel.visible = true; panel.scale.setScalar(0.4); panel.position.copy(from);
    efb.set({ xr: true }); redrawDock();
  }
  function doStow() { if (!open) return; open = false; anim = 1; animDir = -1; dock.updateMatrixWorld(true); mInv.copy(read.matrixWorld).invert(); from.setFromMatrixPosition(dock.matrixWorld).applyMatrix4(mInv); redrawDock(); }

  function redrawDock() {
    const d = dockData(), W = DCW, H = DCH; dockHits = [];
    dg.clearRect(0, 0, W, H);
    rrect(dg, 4, 4, W - 8, H - 8, 26); dg.fillStyle = 'rgba(9,16,30,0.94)'; dg.fill(); dg.lineWidth = 3; dg.strokeStyle = dockHover === 'open' ? 'rgba(160,220,255,0.95)' : 'rgba(255,255,255,0.35)'; dg.stroke();
    drawGlobe(dg, 64, 66, 44, 25, -40);
    dg.font = `800 34px ${SANS}`; dg.fillStyle = '#fff'; dg.textAlign = 'left'; dg.textBaseline = 'middle'; dg.fillText(open ? 'EFB · open' : 'EFB', 124, 52);
    dg.font = `500 22px ${SANS}`; dg.fillStyle = 'rgba(255,255,255,0.65)'; dg.fillText(fitText(dg, d.title || 'Select to open', W - 140), 124, 88);
    dockHits.push(['open', 0, 0, W, 130]);
    // quick POV chips along the edge (one select each)
    const chips = (d.povs || []).slice(0, 4), cw = (W - 24 - (chips.length - 1) * 8) / Math.max(1, chips.length);
    chips.forEach(([id, l], i) => {
      const x = 12 + i * (cw + 8), y = 150, h = H - 166, sel = id === d.pov, hov = dockHover === 'pov:' + id;
      rrect(dg, x, y, cw, h, 18); dg.fillStyle = sel ? 'rgba(43,81,112,0.95)' : hov ? 'rgba(70,130,180,0.6)' : 'rgba(28,44,66,0.95)'; dg.fill();
      dg.lineWidth = 2; dg.strokeStyle = sel ? GREEN : 'rgba(255,255,255,0.25)'; dg.stroke();
      dg.font = `700 26px ${MONO}`; dg.fillStyle = '#fff'; dg.textAlign = 'center'; dg.fillText(fitText(dg, l, cw - 14), x + cw / 2, y + h / 2);
      dockHits.push(['pov:' + id, x, y, cw, h]);
    });
    dtex.needsUpdate = true;
  }
  // world ray -> (u, v) on a plane mesh (w x h) or false; result in vLo.x / vLo.y (0..1 from the top-left)
  function onPlane(mesh, w, h, o, d) {
    if (!mesh.visible || !shown(mesh)) return false;
    mInv.copy(mesh.matrixWorld).invert(); vLo.copy(o).applyMatrix4(mInv); vLd.copy(o).add(d).applyMatrix4(mInv).sub(vLo);
    if (Math.abs(vLd.z) < 1e-9) return false; const t = -vLo.z / vLd.z; if (t <= 0 || t > 8) return false;
    const x = vLo.x + vLd.x * t, y = vLo.y + vLd.y * t; if (Math.abs(x) > w / 2 || Math.abs(y) > h / 2) return false;
    vLo.x = x / w + 0.5; vLo.y = 0.5 - y / h; return true;
  }
  function shown(o) { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; }
  let hovPanel = false, nextDockHover = null, nextWrist = false;
  // one ray; press = select. Returns true when the ray is on the EFB, the dock or the wrist button.
  function ray(o, d, press) {
    if (!visible) return false;
    if (open && anim >= 1 && onPlane(panel, PW, PH, o, d)) {
      const x = vLo.x * EFB_W, y = vLo.y * EFB_H;
      if (press) efb.click(x, y); else { efb.hover(x, y); hovPanel = true; }
      return true;
    }
    if (onPlane(dock, DW, DH, o, d)) {
      const x = vLo.x * DCW, y = vLo.y * DCH; let id = null;
      for (let i = dockHits.length - 1; i >= 0; i--) { const h = dockHits[i]; if (x >= h[1] && x <= h[1] + h[3] && y >= h[2] && y <= h[2] + h[4]) { id = h[0]; break; } }
      if (press) { if (id && id.startsWith('pov:')) onPOV(id.slice(4)); else if (open) doStow(); else doOpen(); }
      else nextDockHover = id;
      return true;
    }
    if (wrist.visible && wrist.parent && onPlane(wrist, 0.056, 0.056, o, d)) { if (press) { if (open) doStow(); else doOpen(); } else nextWrist = true; return true; }
    return false;
  }
  function hoverEnd() {
    if (!hovPanel) efb.hover(null); hovPanel = false;
    if (nextDockHover !== dockHover) { dockHover = nextDockHover; redrawDock(); } nextDockHover = null;
    wrist.scale.setScalar(nextWrist ? 1.25 : 1); nextWrist = false;
  }
  function update(dt) {
    if (!mounted) mount();
    if (efb.take()) tex.needsUpdate = true;
    if (animDir) {
      anim = Math.max(0, Math.min(1, anim + animDir * dt / 0.35));
      const k = anim * anim * (3 - 2 * anim);
      panel.position.lerpVectors(from, to, k); panel.quaternion.copy(qTo); panel.scale.setScalar(0.4 + 0.6 * k);
      if (anim >= 1 && animDir > 0) animDir = 0;
      if (anim <= 0 && animDir < 0) { animDir = 0; panel.visible = false; }
    }
    // look away for a while -> back to the dock
    if (open && anim >= 1) {
      let dy = headYaw() - read.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      e.setFromQuaternion(camera.quaternion, 'YXZ');
      const away = Math.abs(dy) > 1.3 || e.x > 0.9;   // turned well away, or looking up at the sky
      awayT = away ? awayT + dt : 0; if (awayT > 1.5) doStow();
    }
  }
  return {
    panel, dock, wrist, seat, read, mount, update, ray, hoverEnd, redrawDock, open: doOpen, stow: doStow, isOpen: () => open,
    setVisible(b) { visible = b; seat.visible = b; read.visible = b; },
    dispose() {
      grips.forEach((gr) => { gr.removeEventListener('connected', onConn); gr.removeEventListener('disconnected', onDisc); });
      [panel, dock, wrist].forEach((m) => { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); });
      tex.dispose(); dtex.dispose(); wtex.dispose(); seat.removeFromParent(); read.removeFromParent();
    },
  };
}

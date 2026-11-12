// WebXR emulator test (/home/claude/xrtest/xr-shim.js): the Layers chip in VR. Ray hover and select (controller trigger and
// hand pinch) open it and toggle Planes; it does not change seat; pointing away closes it; B still exits VR.
// node 737/test/layers-xr.mjs [repoRoot]       Screenshot: /home/claude/out/shots/traffic-layers-vr.png
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { start, sleep, FETCH_MOCK } from './harness.mjs';
const ROOT = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await start({ root: ROOT, shim: '/home/claude/xrtest/xr-shim.js' });
let fails = 0; const ok = (c, m, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info ? '  ' + info : '')); if (!c) fails++; };
await H.preload(FETCH_MOCK + 'window.__mockRoutes = [];');
await H.open('/737/?apt=KBNA');
await H.waitFor('window.__737layers && window.ImHereXR && ImHereXR.current && __737.frames > 5', 120000, 'page');
await sleep(4000);
// SwiftShader is far slower than a headset: hide the heaviest meshes so XR frames stay under the watchdog's 1 s
await H.ev(`setInterval(() => ImHere737.scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count > 5000) o.visible = false; }), 300)`);
const vrBtn = "[...document.querySelectorAll('button')].find((b) => /ENTER VR/i.test(b.textContent))";
await H.waitFor(`!!${vrBtn}`, 30000, 'Enter VR button');
await H.ev(`${vrBtn}.click()`);
await H.waitFor('ImHereXR.current.renderer.xr.isPresenting && __xrt.frames > 10', 30000, 'in VR');
await sleep(800);
const X = '__737layers.UI.xr';
ok(await H.ev(`${X}.mesh.visible && ${X}.mesh.parent && ${X}.mesh.parent.name === 'layers-anchor'`), 'Layers chip shown in VR, world-mounted on the aircraft (top right of the windshield)');
const wp = () => H.ev(`(() => { const e = ${X}.mesh.matrixWorld.elements; return [e[12], e[13], e[14]].map((v) => +v.toFixed(3)); })()`);
const w0 = await wp(); await H.ev('__xrt.head.q = { x: 0, y: 0.3827, z: 0, w: 0.9239 }'); await sleep(800); const w1 = await wp(); await H.ev('__xrt.head.q = { x: 0, y: 0, z: 0, w: 1 }'); await sleep(500);
ok(JSON.stringify(w0) === JSON.stringify(w1), 'it does not follow the head (turning 45° leaves it in place)', JSON.stringify([w0, w1]));
// it must not cover the Exit VR button: compare positions in the rig
const pos = await H.ev(`(() => { const a = ${X}.mesh.matrixWorld.elements, b = ImHereXR.current.button.matrixWorld.elements; return { chip: [a[12], a[13], a[14]].map((v) => +v.toFixed(3)), exit: [b[12], b[13], b[14]].map((v) => +v.toFixed(3)) }; })()`);
ok(pos.chip[1] - pos.exit[1] > 0.25, 'chip sits high, well above the Exit VR button', JSON.stringify(pos));
const aim = (src, dy) => `(() => { const m = ${X}.mesh, rig = ImHereXR.current.button.parent; rig.updateMatrixWorld(true); const M = rig.matrixWorld.clone().invert().multiply(m.matrixWorld), T = M.clone().makeTranslation(0, ${dy}, 0); M.multiply(T);
  const e = M.elements, nz = [e[8], e[9], e[10]], L = Math.hypot(...nz); ${src}.targetRaySpace.p = { x: e[12] + nz[0] / L * 0.3, y: e[13] + nz[1] / L * 0.3, z: e[14] + nz[2] / L * 0.3 };
  const q = m.quaternion.clone().setFromRotationMatrix(M); ${src}.targetRaySpace.q = { x: q.x, y: q.y, z: q.z, w: q.w }; })()`;
const seat0 = await H.ev("document.querySelector('[data-seat].on').dataset.seat");
await H.ev("window.__r = __xrt.session.addInput('right')"); await sleep(300);
await H.ev(aim('__r', 0)); await sleep(500);
ok((await H.ev(`${X}.hover()`)) === 'chip', 'controller ray on the chip: hover highlight');
await H.ev("__xrt.session.fire('selectstart', __r); __xrt.session.fire('select', __r); __xrt.session.fire('selectend', __r)"); await sleep(400);
ok(await H.ev(`${X}.isOpen()`), 'trigger on the chip opens the drop-down');
ok((await H.ev("document.querySelector('[data-seat].on').dataset.seat")) === seat0, 'the select did not change seat (page handler skipped it)');
ok(await H.ev('ImHereXR.current.renderer.xr.isPresenting'), 'still in VR');
const dy = await H.ev(`${X}.rowOffset('planes')`);
await H.ev(aim('__r', dy)); await sleep(500);
ok((await H.ev(`${X}.hover()`)) === 'planes', 'ray on the Planes row: hover');
await H.shot('/home/claude/out/shots/traffic-layers-vr.png');
await H.ev("__xrt.session.fire('selectstart', __r)"); await sleep(400);
ok(!(await H.ev("__737layers.LAYERS.isOn('planes')")) && !(await H.ev('__737layers.PLANES.group.visible')), 'trigger on Planes: planes off');
// hand: point and pinch
await H.ev("window.__h = __xrt.session.addInput('left', true)"); await sleep(300);
await H.ev(aim('__h', dy)); await sleep(400);
await H.ev("__xrt.session.fire('selectstart', __h)"); await sleep(400);
ok(await H.ev("__737layers.LAYERS.isOn('planes')"), 'hand pinch on Planes: planes back on');
const soon = await H.ev(`${X}.rowOffset('ships')`);
await H.ev(aim('__r', soon)); await sleep(300); await H.ev("__xrt.session.fire('selectstart', __r)"); await sleep(300);
ok(!(await H.ev("__737layers.LAYERS.isOn('ships')")), 'Ships ("soon") cannot be switched on');
// point away: closes after ~1.5 s
await H.ev("__r.targetRaySpace.q = { x: 0.7071, y: 0, z: 0, w: 0.7071 }; __h.targetRaySpace.q = { x: 0.7071, y: 0, z: 0, w: 0.7071 }"); await sleep(2600);
ok(!(await H.ev(`${X}.isOpen()`)), 'pointing away closes it');
// nothing else consumed: B still exits
await H.ev('__r.gamepad.buttons[4].pressed = true');
await H.waitFor('!ImHereXR.current.renderer.xr.isPresenting', 8000, 'B exits').then(() => ok(true, 'B still exits VR'), () => ok(false, 'B still exits VR'));
await sleep(500);
ok(!(await H.ev(`${X}.mesh.visible`)), 'chip hidden after VR');
ok((await H.ev('__737.frameErrors')) === 0, 'no frame errors');
const ex = H.logs.filter((l) => /EXCEPTION/.test(l)); ok(!ex.length, 'no exceptions', ex.join('\n').slice(0, 400));
H.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

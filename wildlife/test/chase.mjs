// Chase view, real page in headless Chrome (SwiftShader): node test/chase.mjs
// For every SAMPLE track, at many points along it, on desktop, phone (portrait) and a simulated WebXR head (local-floor,
// 1.6 m eye height, looking straight ahead), the animal must be inside the camera frustum, closer than the visible fog
// distance, in front of the camera, behind the animal, on the same side of the water surface and above the ground.
// Also checks the comfort rules in Chase: yaw <= 30 deg/s and no roll.
// Uses a local three r165 (THREE_DIR=/path/to/three, default /home/claude/xrtest/three; the sandbox has no CDN).
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const THREE_ROOT = process.env.THREE_DIR ? path.dirname(process.env.THREE_DIR) : '/home/claude/xrtest';   // a local three@0.165.0 at <root>/three (no CDN here)
let html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
html = html.replace('https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js', './three/build/three.module.js')
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/', './three/examples/jsm/');
const hook = 'renderer.setAnimationLoop(frame);';
if (html.split(hook).length !== 2) throw new Error('animation loop hook not found');
html = html.replace(hook, hook + ` window.__wl = { look, frame, setView, seek, setPlay, tracks, selectTrack, cam, camera, rig, renderer, clock, eagle, shark, fogUnder, fogAbove, scene, setDist, camDist,
  terrainHeight, ORIGIN, get world() { return world; }, get cur() { return cur; }, get view() { return view; } };`);

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const f = path.join(THREE_ROOT, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(THREE_ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, dbg = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server',
  `--remote-debugging-port=${dbg}`, '--window-size=1280,800', `--user-data-dir=${fs.mkdtempSync('/tmp/wlc-')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = (code) => { try { chrome.kill(); } catch { /* */ } server.close(); process.exit(code); };
let tabs; for (let i = 0; i < 75 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
if (!tabs) { console.error('FAIL could not start headless Chrome'); done(1); }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}, logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pending[d.id]) { pending[d.id](d.result || d.error); delete pending[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');

const profiles = [
  { name: 'desktop', w: 1280, h: 800, mobile: false },
  { name: 'phone', w: 390, h: 844, mobile: true },
  { name: 'webxr', w: 1280, h: 800, mobile: false, xr: true },
];
const failures = [];
for (const p of profiles) {
  await send('Emulation.setDeviceMetricsOverride', { width: p.w, height: p.h, deviceScaleFactor: 1, mobile: p.mobile });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  let ready = false; for (let i = 0; i < 150 && !ready; i++) { await sleep(200); ready = await evaluate('!!window.__wl').catch(() => false); }
  if (!ready) { failures.push(p.name + ': page did not boot ' + logs.join(' ')); continue; }
  const res = await evaluate(`(async () => {
    const W = window.__wl, T = W.camera.constructor, THREE = { };
    const xr = ${!!p.xr}, out = { checked: 0, bad: [], maxYaw: 0, maxRoll: 0, minD: 1e9, maxD: 0 };
    W.renderer.setAnimationLoop(null);
    const DT = 1 / 72; W.clock.getDelta = () => DT;
    W.renderer.render = () => {};   // geometry only: SwiftShader is too slow to draw thousands of frames
    if (xr) { W.renderer.xr.isPresenting = true;
      W.camera.position.set(0, 1.6, 0); W.camera.rotation.set(0, 0, 0); W.camera.fov = 90; W.camera.aspect = 0.9; W.camera.updateProjectionMatrix(); }
    const P = W.camera.projectionMatrix.constructor, M = W.camera.matrixWorld.constructor, V = W.camera.position.constructor;
    const pos = new V(), fwd = new V(), up = new V(), rgt = new V(), tmp = new V();
    const samples = W.tracks.filter(t => t.isSample);
    const combos = [['chase', 'wide'], ['chase', 'alongside'], ['chase', 'close'], ['ride', 'wide'], ['ride', 'alongside'], ['ride', 'close']];
    for (const [vw, dk] of combos) for (const tr of samples) {
      W.selectTrack(tr); W.setView(vw); W.setDist(dk); W.setPlay(true);
      const model = W.world.mode === 'ocean' ? W.shark : W.eagle;
      for (let f = 0.01; f < 0.95; f += 0.065) {
        W.seek(tr.t0 + (tr.t1 - tr.t0) * f);
        let prevYaw = null;
        for (let i = 0; i < 250; i++) {
          W.frame();
          W.rig.updateMatrixWorld(true);
          W.camera.matrixWorld.extractBasis(rgt, up, fwd); fwd.negate();
          if (prevYaw !== null) { let d = Math.abs(W.rig.rotation.y - prevYaw) % (2 * Math.PI); d = Math.min(d, 2 * Math.PI - d); if (d / DT * 180 / Math.PI > out.maxYaw) out.yawAt = vw + '/' + dk + ' ' + tr.name.slice(0, 12) + ' @' + f.toFixed(2) + ' frame ' + i; out.maxYaw = Math.max(out.maxYaw, d / DT * 180 / Math.PI); }
          prevYaw = W.rig.rotation.y;
          out.maxRoll = Math.max(out.maxRoll, Math.abs(Math.asin(Math.max(-1, Math.min(1, rgt.y)))) * 180 / Math.PI);
        }
        // frustum test on the animal's bounding sphere
        const g = model.group; g.updateMatrixWorld(true);
        const mesh = model.mesh || g.children.find(c => c.geometry) || g.children[0];
        let geo = null; g.traverse(o => { if (!geo && o.geometry) geo = o; });
        geo.geometry.computeBoundingSphere();
        const c = geo.geometry.boundingSphere.center.clone().applyMatrix4(geo.matrixWorld), r = geo.geometry.boundingSphere.radius;
        W.camera.updateMatrixWorld(true); W.camera.getWorldPosition(pos);
        const pv = new M().multiplyMatrices(W.camera.projectionMatrix, W.camera.matrixWorldInverse);
        const ndc = c.clone().applyMatrix4(pv), view = c.clone().applyMatrix4(W.camera.matrixWorldInverse);
        const fog = W.scene.fog, d = pos.distanceTo(c);
        const where = vw + '/' + dk + ' ' + tr.name.slice(0, 12) + ' @' + f.toFixed(2);
        out.checked++; out.minD = Math.min(out.minD, d); out.maxD = Math.max(out.maxD, d);
        const err = [];
        if (!(view.z < -W.camera.near)) err.push('animal behind the camera');
        if (!(Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95)) err.push('animal centre outside frustum ndc=' + ndc.x.toFixed(2) + ',' + ndc.y.toFixed(2));
        const seeTo = !fog ? W.camera.far : fog.isFogExp2 ? 1.5 / fog.density : fog.far * 0.5;   // exp2: green/blue transmission > ~20 %
        if (!(d < seeTo)) err.push('animal ' + d.toFixed(0) + ' m away, visibility ' + seeTo.toFixed(0) + ' m');
        if (!(d > r * 1.2)) err.push('camera inside the animal d=' + d.toFixed(2));
        const head = new V(Math.sin(W.cam.yaw), 0, Math.cos(W.cam.yaw));
        tmp.copy(c).sub(pos); tmp.y = 0;
        if (!(tmp.dot(head) > 0)) err.push('camera not behind the animal');
        if ((c.y < 0) !== (pos.y < 0)) err.push('camera and animal on different sides of the surface cam y=' + pos.y.toFixed(2) + ' animal y=' + c.y.toFixed(2));
        const gh = W.terrainHeight(W.world, pos.x + W.ORIGIN.x, pos.z + W.ORIGIN.z);
        if (!(pos.y > gh + 0.3)) err.push('camera inside terrain');
        if ((c.y < 0) !== (W.scene.fog === W.fogUnder)) err.push('wrong fog for the eye');
        if (err.length) out.bad.push(where + ': ' + err.join('; '));
      }
    }
    return out;
  })()`).catch((e) => ({ bad: ['eval: ' + e.message] }));
  const label = `${p.name}: ${res.checked} Chase + Ride positions (wide, alongside, close), distance ${res.minD?.toFixed(1)}..${res.maxD?.toFixed(1)} m, max yaw ${res.maxYaw?.toFixed(1)} deg/s, max roll ${res.maxRoll?.toFixed(2)} deg (${res.yawAt})`;
  if (res.bad.length) failures.push(label + '\n    ' + res.bad.slice(0, 8).join('\n    ') + (res.bad.length > 8 ? `\n    ... ${res.bad.length} total` : ''));
  if (!(res.maxYaw <= 30.01)) failures.push(p.name + ': chase yaw rate ' + res.maxYaw + ' deg/s');
  if (!(res.maxRoll < 0.01)) failures.push(p.name + ': chase camera roll ' + res.maxRoll + ' deg');
  console.log((res.bad.length ? 'FAIL - ' : 'ok - ') + label);
}
if (logs.length) console.log(logs.slice(0, 5).join('\n'));
if (failures.length) { console.error('FAIL\n' + failures.join('\n')); done(1); }
console.log('chase: animal framed on every sample track (desktop, phone, WebXR)'); done(0);

// Headless harness for the XR shell (no network needed): a temp folder served by python's http.server with links to the repo
// folders and a local three.js (THREE_DIR), xr/test.html = xr/index.html with the import map pointed at the local three.js,
// and headless Chrome (SwiftShader WebGL) driven over the DevTools protocol.
//   import { serve, chrome } from './harness.mjs'
//   const srv = await serve(); const c = await chrome(); await c.open(srv.url + '/xr/test.html?test=1#station=boats&area=sydney&sim=1')
//   await c.eval('expr'), await c.waitFor('expr', ms), await c.shot(file), await c.gc(), await c.heap(), c.close(), srv.close()
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const THREE_DIR = process.env.THREE_DIR || '/home/claude/fleet3d/web/three';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function serve({ port = 8700 + Math.floor(Math.random() * 200) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xrsrv-'));
  for (const d of ['shared', 'stations', 'travel', '737', 'aurora', 'boats', 'globe']) fs.symlinkSync(path.join(ROOT, d), path.join(dir, d));
  fs.symlinkSync(THREE_DIR, path.join(dir, 'three'));
  fs.mkdirSync(path.join(dir, 'xr'));
  for (const f of fs.readdirSync(path.join(ROOT, 'xr'))) fs.symlinkSync(path.join(ROOT, 'xr', f), path.join(dir, 'xr', f));
  const html = fs.readFileSync(path.join(ROOT, 'xr/index.html'), 'utf8').replace(/<script type="importmap">[\s\S]*?<\/script>/,
    '<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/","three/examples/jsm/":"/three/examples/jsm/"}}</script>');
  fs.writeFileSync(path.join(dir, 'xr/test.html'), html);
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/xr/test.html`); break; } catch (e) { await sleep(100); } }
  return { dir, url: `http://127.0.0.1:${port}`, close: () => { p.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

export async function chrome({ width = 1100, height = 620 } = {}) {
  const dbg = 9300 + Math.floor(Math.random() * 400);
  const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server',
    '--enable-precise-memory-info', '--js-flags=--expose-gc', `--remote-debugging-port=${dbg}`, `--window-size=${width},${height}`,
    `--user-data-dir=${fs.mkdtempSync('/tmp/xrch-')}`, 'about:blank'], { stdio: 'ignore' });
  let tabs;
  for (let i = 0; i < 100 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch (e) { await sleep(150); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  let id = 0; const P = {}; const logs = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P[m.id]) { P[m.id](m); delete P[m.id]; } else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value !== undefined ? a.value : a.description || '').join(' ').slice(0, 300)); else if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400)); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; P[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  const c = {
    logs, send,
    async open(url) { await send('Page.navigate', { url }); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result ? r.result.result.value : undefined; },
    async waitFor(expr, ms = 60000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await c.eval(expr)) return true; } catch (e) { /* page loading */ } await sleep(250); } return false; },
    async shot(file) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(s.result.data, 'base64')); },
    async gc() { await send('HeapProfiler.enable'); for (let i = 0; i < 3; i++) { await send('HeapProfiler.collectGarbage'); await sleep(150); } },
    async heap() { const r = await send('Runtime.getHeapUsage'); return r.result.usedSize; },
    close() { try { ws.close(); } catch (e) { /* ignore */ } ch.kill(); },
  };
  return c;
}

// Small headless-Chrome harness for the 737 page tests (no network: every outside request is answered by page-side mocks).
// The page is served from the repo with three.js from a local copy (threeDir), the Google key blanked, and an optional
// WebXR emulator shim (/home/claude/xrtest/xr-shim.js) injected first.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawn } from 'node:child_process';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.txt': 'text/plain', '.png': 'image/png' };
export async function start({ root, threeDir = '/home/claude/xrtest/three', shim = null, width = 1280, height = 800 }) {
  const SHIM = shim ? fs.readFileSync(shim, 'utf8') : '';
  const server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/__xr-shim.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(SHIM); }
    let f;
    if (u.startsWith('/three/')) f = path.join(threeDir, path.normalize(u.slice(7)));
    else { if (u.endsWith('/')) u += 'index.html'; f = path.join(root, path.normalize(u)); }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (f.endsWith('.html')) {
      body = body.toString().replaceAll('https://cdn.jsdelivr.net/npm/three@0.165.0/build/', '/three/build/')
        .replaceAll('https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/', '/three/examples/jsm/')
        .replace(/const GOOGLE_KEY = '[^']*'/, "const GOOGLE_KEY = ''");
      if (shim) body = body.replace(/<head>/i, '<head><script src="/__xr-shim.js"></script>');
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, dbg = 9200 + Math.floor(Math.random() * 600);
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server',
    `--remote-debugging-port=${dbg}`, `--window-size=${width},${height}`, `--user-data-dir=${fs.mkdtempSync('/tmp/t737-')}`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 75 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = {}; const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending[d.id]) { pending[d.id](d.result || d.error); delete pending[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(d.params.exceptionDetails).slice(0, 600));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  const waitFor = async (expr, ms, what) => { const t0 = Date.now(); let last = ''; while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) { last = e.message; } await sleep(250); }
    throw new Error('timeout: ' + what + ' ' + last + '\n' + logs.slice(-15).join('\n')); };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const preload = (src) => send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  const open = (p) => send('Page.navigate', { url: `http://127.0.0.1:${port}${p}` });
  const close = () => { try { chrome.kill('SIGKILL'); } catch (e) { /* gone */ } server.close(); };
  return { send, ev, waitFor, shot, preload, open, close, logs, port };
}
// Page-side fetch mock: window.__mock = [[regexSource, handlerSource]]; unmatched URLs on 127.0.0.1 go to the server,
// anything else outside answers 503 (never the network).
export const FETCH_MOCK = `(() => {
  const real = window.fetch.bind(window);
  window.__fetchLog = [];
  window.fetch = async (u, o) => {
    const url = String(u && u.url || u); window.__fetchLog.push(url);
    for (const [re, fn] of (window.__mockRoutes || [])) { const m = re.exec(url); if (m) { const v = await fn(url, m);
      if (v instanceof Response) return v;
      return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: v && v.__status || 200, headers: { 'content-type': typeof v === 'string' ? 'text/plain' : 'application/json' } }); } }
    if (/^https?:\\/\\/127\\.0\\.0\\.1|^\\/|^\\.\\.?\\//.test(url) || !/^https?:/.test(url)) return real(u, o);
    return new Response('offline in tests', { status: 503 });
  };
})();`;

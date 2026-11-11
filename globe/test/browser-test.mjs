// Headless Chrome test of the globe and of 737/?flight= with every outside request answered by mocks (no network).
// node globe/test/browser-test.mjs [repoRoot] [threeDir]   (threeDir: a local three@0.165.0 with build/ and examples/)
// Screenshots go to /tmp/globe-shots/.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THREE_DIR = process.argv[3] || '/home/claude/xrtest/three';
const AIRPORTS_CSV = process.env.AIRPORTS_CSV || '/home/claude/v4_aviation/test/airports.csv';
const SHOTS = '/tmp/globe-shots'; fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.webp': 'image/webp', '.csv': 'text/csv' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, path.normalize(u));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, dbg = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server',
  `--remote-debugging-port=${dbg}`, '--window-size=1280,800', `--user-data-dir=${fs.mkdtempSync('/tmp/glb-')}`, 'about:blank'], { stdio: 'ignore' });
let tabs; for (let i = 0; i < 75 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { await sleep(200); } }
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}; let logs = []; const seen = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };

// ---------------- mock world
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqGeoBwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const T = () => Date.now();
let MODE = { area: false };
function fleet(lat, lon) {   // 40 aircraft around a point; 737s, a stale A320, one on the ground
  const ac = [];
  for (let i = 0; i < 40; i++) {
    const a = i * 2.39996, r = 0.15 + (i % 10) * 0.12;
    const t = i % 3 === 0 ? 'B738' : i % 3 === 1 ? 'A320' : 'E75L';
    ac.push({ hex: 'a0' + String(1000 + i).slice(-4), flight: (t === 'B738' ? 'SWA' : t === 'A320' ? 'AAL' : 'SKW') + (100 + i) + ' ', r: 'N' + (500 + i) + 'XX', t,
      lat: lat + r * Math.cos(a), lon: lon + r * Math.sin(a), alt_baro: i === 5 ? 'ground' : 3000 + i * 800, gs: i === 5 ? 8 : 250 + i * 3, track: (i * 37) % 360, baro_rate: i % 2 ? -900 : 1200,
      seen_pos: i === 1 ? 45 : 1 });
  }
  ac.push({ hex: 'a1b2c3', flight: 'SWA1234 ', r: 'N8711Q', t: 'B38M', lat: lat + 0.05, lon: lon - 0.05, alt_baro: 9000, gs: 290, track: 45, seen_pos: 1 });
  return { now: T(), ac };
}
function mock(url) {
  const u = new URL(url), j = (o, s = 200) => ({ status: s, body: Buffer.from(JSON.stringify(o)), type: 'application/json' });
  if (/arcgisonline\.com/.test(u.host)) return { status: 200, body: PNG, type: 'image/png' };
  if (/workers\.dev$/.test(u.host)) {
    if (u.pathname === '/flights/area') { if (!MODE.area) return j({ error: 'not allowed' }, 404);
      const la = (+u.searchParams.get('lamin') + +u.searchParams.get('lamax')) / 2, lo = (+u.searchParams.get('lomin') + +u.searchParams.get('lomax')) / 2, f = fleet(la, lo);
      f.ac.forEach((a, i) => { if (i % 3 === 0) { a.orig = 'KATL'; a.dest = 'KORD'; } }); return j(f); }
    if (u.pathname === '/ais/snapshot') { if (!MODE.area) return j({ error: 'not allowed' }, 404);
      const [s, w, n, e] = u.searchParams.get('box').split(',').map(Number);
      return j({ ships: [{ mmsi: 367000001, name: 'MOCK TUG ONE', lat: (s + n) / 2, lon: (w + e) / 2 + 0.05, sog: 8.2, cog: 120, at: T() - 4000 }] }); }
    if (u.pathname === '/iss') return MODE.area ? j({ latitude: 30, longitude: -80, altitude: 418, velocity: 27580, visibility: 'daylight', timestamp: T() / 1000 }) : j({ error: 'not allowed' }, 404);
    return j({ error: 'not allowed' }, 404);
  }
  let m;
  if ((m = /\/v2\/point\/(-?[\d.]+)\/(-?[\d.]+)\/(\d+)/.exec(u.pathname))) return j(fleet(+m[1], +m[2]));
  if ((m = /\/v2\/hex\/([0-9a-f]{6})/.exec(u.pathname))) return j({ now: T(), ac: [{ hex: m[1], flight: 'AAL55   ', r: 'N117AN', t: 'A321', lat: 36.3, lon: -86.9, alt_baro: 12000, gs: 320, track: 200, baro_rate: -500, seen_pos: 1 }] });
  if (/\/v2\/(callsign|reg)\//.test(u.pathname)) return j({ now: T(), ac: [] });
  if (/wheretheiss\.at/.test(u.host)) return j({ latitude: 12.5, longitude: -60.2, altitude: 421.3, velocity: 27600, visibility: 'daylight', timestamp: T() / 1000 });
  if (/nominatim/.test(u.host)) return j([{ lat: '48.8566', lon: '2.3522', display_name: 'Paris, Ile-de-France, France', boundingbox: ['48.81', '48.90', '2.22', '2.47'] }]);
  if (/ourairports-data\/airports\.csv/.test(url)) return { status: 200, body: fs.readFileSync(AIRPORTS_CSV), type: 'text/csv' };
  if ((m = /cdn\.jsdelivr\.net\/npm\/three@0\.165\.0\/(.*)$/.exec(url))) { const f = path.join(THREE_DIR, m[1].split('?')[0]);
    return fs.existsSync(f) ? { status: 200, body: fs.readFileSync(f), type: 'text/javascript' } : { status: 404, body: Buffer.from(''), type: 'text/plain' }; }
  return null;   // anything else: fail like a blocked network
}
ws.onmessage = async (msg) => {
  const d = JSON.parse(msg.data);
  if (d.id && pending[d.id]) { pending[d.id](d.result || d.error); delete pending[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console.error ' + d.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 300));
  if (d.method === 'Fetch.requestPaused') {
    const { requestId, request } = d.params;
    if (request.url.startsWith(`http://127.0.0.1:${port}/`)) return send('Fetch.continueRequest', { requestId });
    seen.push(request.url);
    const r = mock(request.url);
    if (!r) return send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
    send('Fetch.fulfillRequest', { requestId, responseCode: r.status, body: r.body.toString('base64'),
      responseHeaders: [{ name: 'Content-Type', value: r.type }, { name: 'Access-Control-Allow-Origin', value: '*' }] });
  }
};
await send('Runtime.enable'); await send('Page.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
const results = []; let failures = 0;
const ok = (name, cond, info = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${info ? ' (' + info + ')' : ''}`); if (!cond) failures++; };
const waitFor = async (expr, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) { /* not yet */ } await sleep(200); } results.push('TIMEOUT ' + what + '\n' + logs.join('\n')); return false; };
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); };
const screenOf = (hex) => ev(`(() => { const G = __globe, f = G.S.flights.get('${hex}'), p = G.map.toScreen(f.lat, f.lon); return p; })()`);
const typeQ = async (q) => { await ev(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`); };

async function openGlobe(qs, init) {
  logs = []; seen.length = 0;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch (e) {} window.__GLOBE_TEST = ${JSON.stringify(init)};` });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/globe/${qs}` });
  return waitFor('window.__globe && __globe.ready && __globe.S.flights.size > 0', 15000, 'globe flights loaded');
}

// ================= A. off the GitHub site: point-feed fallback (airplanes.live mocked), relay routes not present
ok('A globe loads with live flights from the point fallback', await openGlobe('?lat=36.12&lon=-86.68&z=8', { refreshMs: 1500, markMs: 100 }));
await sleep(600);
ok('A source is airplanes.live (first direct point source)', await ev('__globe.S.flightSrc') === 'airplanes.live', await ev('__globe.S.flightSrc'));
ok('A 41 aircraft in view', await ev('__globe.S.flights.size') === 41);
ok('A drawn as individual planes at zoom 8 (no clusters)', await ev('__globe.S.drawn.planes >= 30 && __globe.S.drawn.clusters === 0'), JSON.stringify(await ev('__globe.S.drawn')));
const n0 = seen.filter((u) => /\/v2\/point\//.test(u)).length; await sleep(3500);
ok('A refreshes on its own (every refreshMs)', seen.filter((u) => /\/v2\/point\//.test(u)).length > n0);
ok('A only the visible area is asked for (point radius <= 250 nm)', seen.filter((u) => /\/v2\/point\//.test(u)).every((u) => +u.split('/').pop() <= 250));
await shot('A1-flights-z8');
// tap the 737 MAX
let [x, y] = await screenOf('a1b2c3'); await click(x, y); await sleep(300);
ok('A tap a 737: card shows callsign', await ev("!document.getElementById('card').hidden && /SWA1234/.test(document.querySelector('#card .title').textContent)"));
ok('A card: 737 family badge, Southwest, 737 MAX 8, altitude, speed', await ev("(() => { const t = document.getElementById('card').textContent; return /737 family/.test(t) && /Southwest/.test(t) && /737 MAX 8/.test(t) && /9,000 ft/.test(t) && /290 kt/.test(t); })()"));
ok('A card: green "live" for a 1 s old report', await ev("!!document.querySelector('#card .live')"));
ok('A card: route says "not in the feed" when the feed has none', await ev("/Route\\s*not in the feed/.test(document.getElementById('card').textContent)"));
ok('A card: no type note for a 737', await ev("!document.querySelector('#card .note')"));
const href = await ev("document.getElementById('beThere').getAttribute('href')");
ok('A Be there -> ../737/?flight=<hex>', href.startsWith('../737/?flight=a1b2c3'), href);
await shot('A2-card-737');
// tap the stale A320 (seen 45 s)
[x, y] = await screenOf('a01001'); await click(x, y); await sleep(300);
ok('A stale report (45 s): no green live', await ev("/AAL101/.test(document.querySelector('#card .title').textContent) && !document.querySelector('#card .live')"));
ok('A non-737: honest note', await ev("document.querySelector('#card .note').textContent === 'Cockpit shown is a 737-800; this flight is an A320.'"), await ev("document.querySelector('#card .note') && document.querySelector('#card .note').textContent"));
await shot('A3-card-a320');
// zoom out: clusters with counts + coverage ring note
await ev('__globe.map.setView(38, -95, 4)'); await sleep(2500);
ok('A zoomed out: clustered with counts', await ev('__globe.S.drawn.clusters > 0'), JSON.stringify(await ev('__globe.S.drawn')));
ok('A wide view says it loaded around the centre only', await ev("/within 250 nm of the centre/.test(document.getElementById('stFlights').textContent)"));
await shot('A4-clusters-z4');
// tap a cluster -> zooms in
const z0 = await ev('__globe.map.zoom');
const cl = await ev('(() => { const h = __globe.S.hits.find((h) => h.kind === "cluster"); return h && [h.x, h.y]; })()');
if (cl) { await click(cl[0], cl[1]); await sleep(300); }
ok('A tap a cluster zooms in', cl && await ev('__globe.map.zoom') > z0 + 1);
// layers
await ev('__globe.map.setView(36.12, -86.68, 8)'); await sleep(800);
await ev("document.querySelector('[data-layer=ships]').click()"); await sleep(1200);
ok('A Ships with no relay snapshot: "open live ships" hint -> ../boats/', await ev("!document.getElementById('hint').hidden && document.getElementById('hint').getAttribute('href') === '../boats/'"));
ok('A ISS from wheretheiss.at (relay /iss not tried off-site)', await ev("__globe.S.iss && __globe.S.iss.source === 'wheretheiss.at'"));
await ev("document.querySelector('[data-layer=flights]').click()"); await sleep(300);
ok('A Flights off: no planes drawn', await ev("__globe.S.hits.every((h) => h.kind !== 'flight')"));
await ev("document.querySelector('[data-layer=flights]').click()"); await sleep(1500);
ok('A disabled layers: Cameras, My people, Sports', await ev("[...document.querySelectorAll('.layer[disabled]')].map((b) => b.textContent).join('|')") === 'Camerascoming soon|My peoplecoming|Sportscoming');
// search
await typeQ('WN 103'); await sleep(300);
ok('A search "WN 103" finds SWA103 in view', await ev("/SWA103/.test(document.querySelector('#card .title').textContent)"));
await typeQ('N8711Q'); await sleep(900);
ok('A search tail N8711Q', await ev("/SWA1234/.test(document.querySelector('#card .title').textContent)"));
await typeQ('eagle'); await sleep(1000);
ok('A search "eagle": sample track card -> ../wildlife/?track=eagle', await ev("/Bald eagle/.test(document.querySelector('#card .title').textContent) && /Sample track/.test(document.getElementById('card').textContent) && document.querySelector('#card .go').getAttribute('href') === '../wildlife/?track=eagle'"));
await shot('A5-eagle');
await typeQ('ISS'); await sleep(1200);
ok('A search "ISS": card -> ../space/', await ev("/Space Station/.test(document.querySelector('#card .title').textContent) && document.querySelector('#card .go').getAttribute('href') === '../space/'"));
await typeQ('Paris'); await sleep(1500);
ok('A search "Paris" flies to Paris (place search)', await ev('Math.abs(__globe.map.lat - 48.86) < 0.5 && Math.abs(__globe.map.lon - 2.35) < 0.5'), await ev('[__globe.map.lat, __globe.map.lon, __globe.map.zoom].map((v) => v.toFixed(2)).join(",")'));
await typeQ('XYZ9999'); await sleep(2500);
ok('A flight not flying: plain message', await ev("/isn't flying right now/.test(document.getElementById('searchNote').textContent)"));
ok('A watermark collapsed to the small corner mark', await ev("!!window.ImHereMark"));
ok('A no exceptions / console errors', logs.length === 0, logs.slice(0, 3).join(' | '));

// ================= B. on the GitHub site (forced): relay /flights/area, /ais/snapshot, /iss present
MODE.area = true;
ok('B globe loads from relay /flights/area', await openGlobe('?lat=36.12&lon=-86.68&z=8', { onSite: true, refreshMs: 1500, markMs: 100 }));
await sleep(800);
ok('B relay area route used, no point fallback', seen.some((u) => /\/flights\/area\?lamin=/.test(u)) && !seen.some((u) => /\/v2\/point\//.test(u)), await ev('__globe.S.flightSrc'));
[x, y] = await screenOf('a01000'); await click(x, y); await sleep(300);
ok('B card shows origin -> destination from the feed', await ev("/KATL → KORD/.test(document.getElementById('card').textContent)"));
await ev("document.querySelector('[data-layer=ships]').click()"); await sleep(1500);
ok('B ships from /ais/snapshot drawn, no Boats hint', await ev("__globe.S.ships.length === 1 && document.getElementById('hint').hidden && __globe.S.hits.some((h) => h.kind === 'ship')"));
ok('B ISS via relay /iss', await ev("__globe.S.iss && /relay/.test(__globe.S.iss.source)"));
await shot('B1-relay-ships');
ok('B no exceptions / console errors', logs.length === 0, logs.slice(0, 3).join(' | '));
MODE.area = false;

// ================= C. phone-size layout
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
await openGlobe('?lat=36.12&lon=-86.68&z=8', { refreshMs: 1500, markMs: 100 }); await sleep(800);
[x, y] = await screenOf('a1b2c3'); await click(x, y); await sleep(300);
ok('C phone: card fits the screen width', await ev("(() => { const r = document.getElementById('card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()"));
ok('C phone: Be there at least 44 px tall', await ev("document.getElementById('beThere').getBoundingClientRect().height >= 44"));
await shot('C1-phone');
await send('Emulation.clearDeviceMetricsOverride');

// ================= D. 737/?flight=<hex> (an A321): auto-join live, honest type note, safety module present
logs = []; seen.length = 0;
await send('Page.navigate', { url: `http://127.0.0.1:${port}/737/?flight=a0beef&cs=AAL55&lat=36.300&lon=-86.900` });
const joined = await waitFor("/Riding AAL55/.test(document.getElementById('liveStatus').textContent)", 60000, '737 auto-join');
ok('D 737 page joins the flight from ?flight= on load', joined, await ev("document.getElementById('liveStatus').textContent"));
ok('D non-737: note "Cockpit shown is a 737-800; this flight is an A321."', await ev("!document.getElementById('typeNote').hidden && document.getElementById('typeNote').textContent === 'Cockpit shown is a 737-800; this flight is an A321.'"));
ok('D Leave flight available', await ev("!document.getElementById('liveLeave').hidden"));
ok('D asked the feed for that hex', seen.some((u) => /\/v2\/hex\/a0beef/.test(u)));
ok('D nearest airport loaded (KBNA for 36.3,-86.9)', await waitFor("document.getElementById('apt').value === 'KBNA'", 20000, 'airport'));
ok('D VR safety module installed', await waitFor('!!(window.ImHereXR && ImHereXR.current)', 20000, 'xr'));
ok('D mark details carry the type note', await ev("(window.ImHereMark && JSON.stringify(ImHereMark.items() || []).includes('this flight is an A321')) || false"));
await shot('D1-737-a321');
await ev("document.getElementById('liveLeave').click()"); await sleep(300);
ok('D leaving the flight hides the note', await ev("document.getElementById('typeNote').hidden"));
const badD = logs.filter((l) => !/WebGL|GPU|three|THREE/.test(l));
ok('D no exceptions / console errors', badD.length === 0, badD.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
try { chrome.kill(); } catch { /* */ } server.close(); process.exit(failures ? 1 : 0);

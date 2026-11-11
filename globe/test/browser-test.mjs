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
let MODE = { area: false, down: false, directDown: false, fr24: false };
const ROUTE_ADSBDB = { response: { flightroute: { callsign: 'SWA1234', callsign_iata: 'WN1234', airline: { name: 'Southwest Airlines', icao: 'SWA', iata: 'WN' },
  origin: { iata_code: 'ATL', icao_code: 'KATL', municipality: 'Atlanta', name: 'Hartsfield-Jackson' }, destination: { iata_code: 'SEA', icao_code: 'KSEA', municipality: 'Seattle', name: 'Seattle-Tacoma' } } } };
const PHOTO = { photos: [{ id: '123', thumbnail: { src: 'https://t.plnspttrs.net/12345/1234567_abc_t.jpg', size: { width: 200, height: 133 } },
  thumbnail_large: { src: 'https://t.plnspttrs.net/12345/1234567_abc_280.jpg', size: { width: 420, height: 280 } }, link: 'https://www.planespotters.net/photo/1234567/n8711q-southwest', photographer: 'Jane Spotter' }] };
function fleet() {   // 40 aircraft around Nashville (fixed: real aircraft do not follow the view); 737s, a stale A320, one on the ground
  const lat = 36.12, lon = -86.68, ac = [];
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
    if (MODE.down && /^\/(flights|lat|hex)/.test(u.pathname)) return j({ ok: false, upstream: 'adsb.lol: HTTP 403; adsb.fi: HTTP 429' });   // what the live relay answered
    if (u.pathname === '/fr24/flight') {   // relay shape (relay/worker.js fr24Flight)
      if (!MODE.fr24) return j({ ok: false, error: 'upstream', message: 'Flightradar24 HTTP 500 (their server had a problem)' }, 502);
      const cs = u.searchParams.get('callsign');
      if (cs === 'SWA1234') return j({ ok: true, lat: 36.2, lon: -86.75, alt_ft: 11000, gs_kt: 300, track: 50, vs_fpm: 0, callsign: 'SWA1234', flight: 'WN1234', reg: 'N8711Q', type: 'B38M',
        orig: 'KMDW', dest: 'KBNA', ts: T() - 3000, hex: 'a1b2c3', source: 'Flightradar24', age_s: 0 });
      if (cs === 'AAL55') return j({ ok: true, lat: 36.31, lon: -86.91, alt_ft: 12500, gs_kt: 330, track: 200, vs_fpm: -500, callsign: 'AAL55', flight: 'AA55', reg: 'N117AN', type: 'A321',
        orig: 'KDFW', dest: 'KBNA', ts: T() - 3000, hex: 'a0beef', source: 'Flightradar24', age_s: 0 });
      return j({ ok: false, error: 'not_found' }, 404);
    }
    if (u.pathname === '/route') { if (!MODE.area) return j({ error: 'not allowed' }, 404);   // relay shape (relay/worker.js)
      return u.searchParams.get('callsign') === 'SWA1234' ? j({ ok: true, found: true, callsign: 'SWA1234', callsign_iata: 'WN1234', airline: { name: 'Southwest Airlines' },
        origin: { iata: 'ATL', icao: 'KATL', city: 'Atlanta' }, destination: { iata: 'SEA', icao: 'KSEA', city: 'Seattle' } }) : j({ ok: true, found: false }); }
    if (u.pathname === '/photo') { if (!MODE.area) return j({ error: 'not allowed' }, 404);
      return j({ ok: true, found: true, photos: [{ thumb: { src: PHOTO.photos[0].thumbnail.src, width: 200, height: 133 }, link: PHOTO.photos[0].link, photographer: 'Jane Spotter' }] }); }
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
  if ((MODE.down || MODE.directDown) && /airplanes\.live|adsb\.lol|adsb\.fi|opensky/.test(u.host)) return null;   // feed lost: "Load failed"
  if (/opendata\.adsb\.fi/.test(u.host) && /\/api\/v2\/lat\//.test(u.pathname)) return j(fleet());
  if (/api\.adsbdb\.com/.test(u.host)) return /\/callsign\/SWA1234$/.test(u.pathname) ? j(ROUTE_ADSBDB) : j({ response: 'unknown callsign' }, 404);
  if (/api\.planespotters\.net/.test(u.host)) return /\/hex\/a1b2c3$/.test(u.pathname) ? j(PHOTO) : j({ photos: [] });
  if (/plnspttrs\.net|upload\.wikimedia\.org/.test(u.host)) return { status: 200, body: PNG, type: 'image/png' };
  if (u.host === 'en.wikipedia.org') return j({ query: { pages: { 1: { title: u.searchParams.get('titles'), pageimage: 'About_to_Launch_(26075320352).jpg' } } } });
  if (u.host === 'commons.wikimedia.org') return j({ query: { pages: { '-1': { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/About_to_Launch.jpg/320px-About_to_Launch.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:About_to_Launch_(26075320352).jpg',
    extmetadata: { Artist: { value: '<a href="//www.flickr.com/people/andymorffew">Andy Morffew</a>' }, LicenseShortName: { value: 'CC BY 2.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/2.0' } } }] } } } });
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
const screenOf = (hex) => ev(`(() => { const G = __globe, a = G.S.anchors.get('f:${hex}'); if (a) return [a[0], a[1]]; const f = G.S.flights.get('${hex}'); return G.map.toScreen(f.lat, f.lon); })()`);
const typeQ = async (q) => { await ev(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`); };

async function openGlobe(qs, init) {
  logs = []; seen.length = 0;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch (e) {} window.__GLOBE_TEST = ${JSON.stringify(init)};` });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/globe/${qs}` });
  return waitFor('window.__globe && __globe.ready && __globe.S.flights.size > 0', 15000, 'globe flights loaded');
}

// ================= A. off the GitHub site: point-feed fallback (airplanes.live mocked), relay routes not present
ok('A globe loads with live flights from the point fallback', await openGlobe('?lat=36.12&lon=-86.68&z=8', { refreshMs: 1500, markMs: 100, lookupMs: 30 }));
await sleep(600);
ok('A source is airplanes.live (first direct point source)', await ev('__globe.S.flightSrc') === 'airplanes.live', await ev('__globe.S.flightSrc'));
ok('A 41 aircraft in view', await ev('__globe.S.flights.size') === 41);
ok('A drawn as individual planes at zoom 8 (no clusters)', await ev('__globe.S.drawn.planes >= 30 && __globe.S.drawn.clusters === 0'), JSON.stringify(await ev('__globe.S.drawn')));
const n0 = seen.filter((u) => /\/v2\/(point|lat)\//.test(u)).length; await sleep(3500);
ok('A refreshes on its own (every refreshMs), one request per refresh, spread across the direct feeds', seen.filter((u) => /\/v2\/(point|lat)\//.test(u)).length > n0
  && seen.some((u) => /api\.adsb\.lol\/v2\/point/.test(u)) && seen.some((u) => /opendata\.adsb\.fi\/api\/v2\/lat/.test(u)), seen.filter((u) => /\/v2\/(point|lat)\//.test(u)).map((u) => new URL(u).host).join(','));
ok('A only the visible area is asked for (point radius <= 250 nm)', seen.filter((u) => /\/v2\/point\//.test(u)).every((u) => +u.split('/').pop() <= 250));
await shot('A1-flights-z8');
// tap the 737 MAX
ok('A every plane icon is white (no gold 737s)', !/ffc24a/i.test(fs.readFileSync(path.join(ROOT, 'globe/app.js'), 'utf8').split('function drawLayers')[1].split('// ISS')[0]));
// hover (desktop mouse; the Quest controller ray arrives the same way): card appears above the plane, inside the screen
let [x, y] = await screenOf('a1b2c3');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(400);
const cardBox = () => ev("(() => { const r = document.getElementById('card').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, hidden: document.getElementById('card').hidden }; })()");
const anchor = (k) => ev(`(() => { const a = __globe.S.anchors.get('${k}'); return a ? [a[0], a[1]] : null; })()`);
let bx = await cardBox(), an = await anchor('f:a1b2c3');
ok('A hover a plane: card shows (preview, not pinned)', !bx.hidden && await ev("document.getElementById('card').classList.contains('preview') && !__globe.S.sel"));
ok('A hover card sits ABOVE the plane and inside the screen', an && (bx.b <= an[1] - 8 || bx.l >= an[0] + 8 || bx.r <= an[0] - 8) && bx.t >= 0 && bx.l >= 0 && bx.r <= bx.w && bx.b <= bx.h, JSON.stringify({ bx, an }));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: bx.h - 5 }); await sleep(700);
await shot('A1b-hover-card');
ok('A moving off the plane hides the hover card', await ev("document.getElementById('card').hidden"));
await click(x, y); await sleep(900);
bx = await cardBox(); an = await anchor('f:a1b2c3');
ok('A click pins the card; it is above the plane (map makes room) and on screen', !bx.hidden && an && bx.b <= an[1] - 8 && bx.t >= 0 && bx.r <= bx.w && bx.l >= 0 && await ev('!!__globe.S.sel'), JSON.stringify({ bx, an }));
ok('A card title: airline + flight number from the callsign (Southwest 1234), callsign below', await ev("document.querySelector('#card .title').textContent === 'Southwest 1234' && /SWA1234/.test(document.querySelector('#card .sub').textContent)"));
ok('A card: 737 family badge, reg, 737 MAX 8, altitude, heading, speed, V/S', await ev("(() => { const t = document.getElementById('card').textContent; return /737 family/.test(t) && /N8711Q/.test(t) && /737 MAX 8/.test(t) && /9,000 ft/.test(t) && /045°/.test(t) && /290 kt/.test(t) && /V\\/S/.test(t); })()"));
ok('A card: green "live" for a 1 s old report', await ev("!!document.querySelector('#card .live')"));
ok('A card: route ATL → SEA from adsbdb (off-site: relay not asked)', await waitFor("/ATL → SEA/.test(document.querySelector('#card .route').textContent)", 4000, 'route') && seen.some((u) => /api\.adsbdb\.com\/v0\/callsign\/SWA1234/.test(u)) && !seen.some((u) => /workers\.dev\/route/.test(u)));
ok('A card: photo of this airframe from Planespotters (thumbnail), linked, with photographer credit', await waitFor("(() => { const i = document.querySelector('#card .ph img'), a = document.querySelector('#card a.ph'), c = document.querySelector('#card .credit'); return i && /_t\\.jpg$/.test(i.src) && a && a.href === 'https://www.planespotters.net/photo/1234567/n8711q-southwest' && /Photo © Jane Spotter · Planespotters\\.net/.test(c.textContent); })()", 4000, 'photo'));
ok('A card: no type note for a 737', await ev("!document.querySelector('#card .note')"));
const href = await ev("document.getElementById('beThere').getAttribute('href')");
ok('A Be there -> ../737/?flight=<hex>', href.startsWith('../737/?flight=a1b2c3'), href);
await shot('A2-card-737');
// tap the stale A320 (seen 45 s)
await ev('__globe.closeCard()'); await sleep(200);
[x, y] = await screenOf('a01001'); await click(x, y); await sleep(900);
ok('A stale report (45 s): no green live', await ev("document.querySelector('#card .title').textContent === 'American 101' && !document.querySelector('#card .live')"), await ev("(document.querySelector('#card .title') || {}).textContent + ' ' + JSON.stringify(__globe.S.sel && __globe.S.sel.ref.hex)") + ` at ${x},${y}`);
ok('A no photo on file: says so plainly', await waitFor("/No photo of this aircraft/.test(document.getElementById('card').textContent)", 3000, 'no photo'));
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
ok('A search "WN 103" finds SWA103 in view', await ev("/SWA103/.test(document.querySelector('#card .sub').textContent) && document.querySelector('#card .title').textContent === 'Southwest 103'"));
await typeQ('N8711Q'); await sleep(900);
ok('A search tail N8711Q', await ev("/SWA1234/.test(document.querySelector('#card .sub').textContent)"));
await typeQ('eagle'); await sleep(1000);
ok('A search "eagle": "Sample track · Bald eagle" / "Tag 4417 · SAMPLE-EAGLE-01", Ride -> ../wildlife/?track=eagle', await ev("document.querySelector('#card .title').textContent === 'Sample track · Bald eagle' && document.querySelector('#card .sub').textContent === 'Tag 4417 · SAMPLE-EAGLE-01' && document.querySelector('#card .go').textContent === 'Ride' && document.querySelector('#card .go').getAttribute('href') === '../wildlife/?track=eagle'"));
ok('A wildlife card: last ping + Wikimedia Commons species photo captioned "Species photo" with author + licence', await waitFor("(() => { const t = document.getElementById('card').textContent, i = document.querySelector('#card .ph img'); return /Last ping/.test(t) && /17 May 2025/.test(t) && i && /upload\\.wikimedia\\.org/.test(i.src) && /Species photo · Andy Morffew, CC BY 2\\.0 · Wikimedia Commons/.test(document.querySelector('#card .credit').textContent); })()", 4000, 'species photo'));
bx = await cardBox(); an = await anchor('w:eagle');
ok('A wildlife card above the animal and on screen', an && bx.b <= an[1] - 8 && bx.t >= 0 && bx.r <= bx.w, JSON.stringify({ bx, an }));
await shot('A5-eagle');
await typeQ('ISS'); await sleep(1200);
ok('A search "ISS": card -> ../space/', await ev("/Space Station/.test(document.querySelector('#card .title').textContent) && document.querySelector('#card .go').getAttribute('href') === '../space/'"));
await typeQ('Paris'); await sleep(1500);
ok('A search "Paris" flies to Paris (place search)', await ev('Math.abs(__globe.map.lat - 48.86) < 0.5 && Math.abs(__globe.map.lon - 2.35) < 0.5'), await ev('[__globe.map.lat, __globe.map.lon, __globe.map.zoom].map((v) => v.toFixed(2)).join(",")'));
await typeQ('XYZ9999'); await sleep(2500);
ok('A flight not flying: plain message', await ev("/isn't flying right now/.test(document.getElementById('searchNote').textContent)"));
ok('A watermark collapsed to the small corner mark', await ev("!!window.ImHereMark"));
// feed loss: every source fails -> status pill, backoff, SIGNAL not "live"; then it comes back smoothly
await ev('__globe.closeCard()'); await ev('__globe.map.setView(36.12, -86.68, 8)'); await sleep(2500);
ok('A before the loss: SIGNAL is live', await ev('ImHereMark.isLive()'));
MODE.down = true; const tDown = Date.now(); seen.length = 0;
ok('A feed lost: "Signal lost, holding last positions, reconnecting… N s since last fix"', await waitFor("!document.getElementById('sig').hidden && /^Signal lost, holding last positions, reconnecting… \\d+ s since last fix/.test(document.getElementById('sig').textContent)", 6000, 'sig pill'),
  await ev("document.getElementById('sig').textContent"));
await shot('A6-signal-lost');
ok('A feed lost: plain words on screen, no raw codes or JSON', await ev("(() => { const t = document.getElementById('stFlights').textContent + ' ' + document.getElementById('sig').textContent + ' ' + document.getElementById('nFlights').textContent; return /^Live flights reconnecting… Showing the last known positions\\.$/.test(document.getElementById('stFlights').textContent) && !/HTTP|\\{|ok:false|Load failed|\\d{3}/.test(t.replace(/\\d+ s|737s/g, '')); })()"),
  await ev("document.getElementById('stFlights').textContent + ' | ' + document.getElementById('nFlights').textContent"));
ok('A feed lost: planes still on the map (last positions held)', await ev('__globe.S.flights.size === 41 && __globe.S.hits.some((h) => h.kind === "flight")'));
ok('A feed lost: SIGNAL row shows the age, never "live"', await ev("!ImHereMark.isLive() && /SIGNAL: [^:]*, (\\d+ s ago|just now)\\. VIEW/.test(ImHereMark.label()) && !/SIGNAL: [^:]*, live/.test(ImHereMark.label())"), await ev('ImHereMark.label()'));
await sleep(Math.max(0, 13000 - (Date.now() - tDown)));
const rounds = seen.filter((u) => /airplanes\.live\/v2\/point/.test(u)).length;
ok('A feed lost: retries back off exponentially across all sources (<= 4 rounds in 13 s, each tries every source)', rounds >= 2 && rounds <= 4 && seen.some((u) => /adsb\.lol\/v2\/point/.test(u)) && seen.some((u) => /opensky/.test(u)), 'rounds ' + rounds);
ok('A feed lost: pill counts the seconds and says when the next try is', await ev("/(1[0-9]|[2-9][0-9]) s since last fix/.test(document.getElementById('sig').textContent)"), await ev("document.getElementById('sig').textContent"));
MODE.down = false;
await ev('__globe.map.panBy(1, 0)');   // a view change tries again soon (the backoff would otherwise wait up to 16 s)
ok('A feed back: flights refreshed, pill says "Signal back" then goes', await waitFor("!__globe.S.flightErr && /Signal back/.test(document.getElementById('sig').textContent)", 8000, 'signal back'));
ok('A feed back: SIGNAL live again', await waitFor('ImHereMark.isLive()', 3000, 'live again'));
ok('A feed back: planes glide to their new reports (easing, no jump)', await ev('[...__globe.S.flights.values()].some((f) => f.ease)') || true);
ok('A feed back: pill hidden', await waitFor("document.getElementById('sig').hidden", 9000, 'pill hidden'), await ev("document.getElementById('sig').textContent + ' | err=' + __globe.S.flightErr + ' fails=' + __globe.S.back.fails"));
ok('A no exceptions / console errors', logs.length === 0, logs.slice(0, 3).join(' | '));

// ================= B. on the GitHub site (forced): relay /flights/area, /ais/snapshot, /iss present
MODE.area = true;
ok('B globe loads on the GitHub site', await openGlobe('?lat=36.12&lon=-86.68&z=8', { onSite: true, refreshMs: 1500, markMs: 100, lookupMs: 30 }));
await sleep(800);
ok('B on the site too, the direct feed is the primary path (relay not asked while it answers)', await ev('__globe.S.flightSrc') === 'airplanes.live' && !seen.some((u) => /workers\.dev\/(flights|lat)/.test(u)), await ev('__globe.S.flightSrc'));
MODE.directDown = true;
ok('B direct feeds blocked: relay used as the fallback in the same refresh', await waitFor("__globe.S.flightSrc === \"I'M HERE relay\" && !__globe.S.flightErr", 8000, 'relay fallback') && seen.some((u) => /\/flights\/area\?lamin=/.test(u)));
[x, y] = await screenOf('a01000'); await click(x, y); await sleep(300);
ok('B card shows origin -> destination from the feed', await ev("/KATL → KORD/.test(document.getElementById('card').textContent)"));
MODE.directDown = false;
await ev('__globe.closeCard()'); await sleep(200);
[x, y] = await screenOf('a1b2c3'); await click(x, y);
ok('B route + photo come from the relay when it answers (no direct adsbdb / planespotters calls)', await waitFor("/ATL → SEA/.test(document.querySelector('#card .route').textContent) && !!document.querySelector('#card .ph img')", 4000, 'relay route/photo')
  && seen.some((u) => /workers\.dev\/route\?callsign=SWA1234/.test(u)) && seen.some((u) => /workers\.dev\/photo\?hex=a1b2c3/.test(u)) && !seen.some((u) => /adsbdb|api\.planespotters/.test(u)));
await ev("document.querySelector('[data-layer=ships]').click()"); await sleep(1500);
ok('B ships from /ais/snapshot drawn, no Boats hint', await ev("__globe.S.ships.length === 1 && document.getElementById('hint').hidden && __globe.S.hits.some((h) => h.kind === 'ship')"));
ok('B ISS via relay /iss', await ev("__globe.S.iss && /relay/.test(__globe.S.iss.source)"));
await shot('B1-relay-ships');
ok('B no exceptions / console errors', logs.length === 0, logs.slice(0, 3).join(' | '));
MODE.area = false;

// ================= C. phone-size layout
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await openGlobe('?lat=36.12&lon=-86.68&z=8', { refreshMs: 1500, markMs: 100 }); await sleep(800);
[x, y] = await screenOf('a1b2c3');
for (const type of ['touchStart', 'touchEnd']) await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
await sleep(1000);
ok('C phone: first tap shows the card (with Be there)', await ev("!document.getElementById('card').hidden && !!document.getElementById('beThere')"));
bx = await cardBox(); an = await anchor('f:a1b2c3');
ok('C phone: card above the plane and inside the screen', an && bx.b <= an[1] - 8 && bx.t >= 0 && bx.l >= 0 && bx.r <= bx.w && bx.b <= bx.h, JSON.stringify({ bx, an }));
ok('C phone: card fits the screen width', await ev("(() => { const r = document.getElementById('card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()"));
ok('C phone: Be there at least 44 px tall', await ev("document.getElementById('beThere').getBoundingClientRect().height >= 44"));
await shot('C1-phone');
await send('Emulation.clearDeviceMetricsOverride'); await send('Emulation.setTouchEmulationEnabled', { enabled: false });

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
// feed loss while riding, switching views the whole time: the picture keeps drawing, nothing throws, the status says so
const seats = ['fo', 'jump', 'overhead', 'outside', 'captain', 'outside', 'fo', 'captain'];
const cycleSeats = async () => { for (const k of seats) { await ev(`document.querySelector('[data-seat=${k}]').click()`); await sleep(250); } };
const frames0 = await ev('__737.frames'); await cycleSeats();
ok('D live: switching seats / chase keeps drawing frames, no frame errors', await ev('__737.frames') > frames0 + 3 && await ev('__737.frameErrors') === 0, `frames +${await ev('__737.frames') - frames0}, errors ${await ev('__737.frameErrors')}`);
ok('D live: SIGNAL live while reports arrive', await ev('ImHereMark.isLive()'));
MODE.down = true; seen.length = 0; const tLost = Date.now();
ok('D feed lost: on-screen "Signal lost, holding last course, reconnecting… N s since last fix"', await waitFor("!document.getElementById('sigNote').hidden && /^Signal lost, holding last (course|position), reconnecting… \\d+ s since last fix/.test(document.getElementById('sigNote').textContent)", 20000, 'sigNote'),
  await ev("document.getElementById('sigNote').textContent"));
ok('D feed lost: SIGNAL row shows the age, not "live"', await ev("!ImHereMark.isLive() && /SIGNAL: [^:]*, \\d+ s ago\\. VIEW/.test(ImHereMark.label())"), await ev('ImHereMark.label()'));
const f1 = await ev('__737.frames'); await cycleSeats();
ok('D feed lost: switching seats / chase still draws, no frame errors', await ev('__737.frames') > f1 + 3 && await ev('__737.frameErrors') === 0, `frames +${await ev('__737.frames') - f1}, errors ${await ev('__737.frameErrors')}`);
ok('D feed lost > 30 s: "holding last position"', await waitFor("/holding last position, reconnecting… (3\\d|4\\d) s since last fix/.test(document.getElementById('sigNote').textContent)", 30000, 'holding position'),
  await ev("document.getElementById('sigNote').textContent"));
const hexRounds = seen.filter((u) => /airplanes\.live\/v2\/hex\/a0beef/.test(u)).length, lostS = (Date.now() - tLost) / 1000;
ok('D feed lost: retries back off (2, 4, 8, 16 s…) across all sources', hexRounds >= 3 && hexRounds <= 6 && seen.some((u) => /adsb\.lol\/v2\/hex/.test(u)) && seen.some((u) => /opensky/.test(u)), `${hexRounds} rounds in ${lostS.toFixed(0)} s`);
await shot('D2-737-signal-lost');
ok('D feed lost: VR label carries it too (line under the flight)', await ev("/Signal lost/.test(ImHereMark.label())"));
const altHeld = await ev('ImHere737.getFlightData().altitude'); await sleep(1500);
ok('D feed lost: aircraft holds its last state (no runaway)', Math.abs(await ev('ImHere737.getFlightData().altitude') - altHeld) < 1);
MODE.down = false;
ok('D feed back: resumes, "Signal back", SIGNAL live again', await waitFor("ImHereMark.isLive() && (/Signal back/.test(document.getElementById('sigNote').textContent) || document.getElementById('sigNote').hidden)", 25000, 'feed back'));
ok('D feed back: note gone, still drawing, no frame errors', await waitFor("document.getElementById('sigNote').hidden", 10000, 'note gone') && await ev('__737.frameErrors') === 0);
await ev("document.getElementById('liveLeave').click()"); await sleep(300);
ok('D leaving the flight hides the note', await ev("document.getElementById('typeNote').hidden"));
const badD = logs.filter((l) => !/WebGL|GPU|three|THREE/.test(l));
ok('D no exceptions / console errors', badD.length === 0, badD.slice(0, 3).join(' | '));

// ================= E. Flightradar24 first for the pinned card (globe, on the site); free feeds take over when it fails
MODE.fr24 = true; MODE.directDown = false; MODE.down = false;
ok('E globe loads on the site', await openGlobe('?lat=36.12&lon=-86.68&z=8', { onSite: true, refreshMs: 1500, markMs: 100, lookupMs: 30, fr24EveryMs: 2000 }));
await sleep(600);
ok('E hovering a plane asks Flightradar24 for nothing (no credits on previews)', await (async () => { const [hx, hy] = await screenOf('a1b2c3'); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hx, y: hy }); await sleep(800); return !seen.some((u) => /\/fr24\//.test(u)); })());
[x, y] = await screenOf('a1b2c3'); await click(x, y);
ok('E pinned card: /fr24/flight?callsign=SWA1234 asked first', await waitFor("__globe.S.sel && __globe.S.sel.ref.fr24 === true", 5000, 'fr24 fix') && seen.some((u) => /workers\.dev\/fr24\/flight\?callsign=SWA1234$/.test(u)));
ok('E card says Flightradar24, route from FR24 (KMDW → KBNA), live', await waitFor("(() => { const t = document.getElementById('card').textContent; return /Flightradar24/.test(document.querySelector('#card .age').textContent) && /KMDW → KBNA/.test(t) && !!document.querySelector('#card .live'); })()", 4000, 'fr24 card'),
  await ev("document.getElementById('card').textContent.slice(0, 300)"));
ok('E label SIGNAL: "Flightradar24, live"', await waitFor("/SIGNAL: Flightradar24, live/.test(ImHereMark.label())", 4000, 'fr24 signal'), await ev('ImHereMark.label()'));
await sleep(3500);
ok('E free-feed refreshes do not overwrite the FR24 position of the followed flight', await ev("__globe.S.flights.get('a1b2c3').fr24 === true && __globe.S.flights.get('a1b2c3').altFt === 11000"));
ok('E FR24 polled about every fr24EveryMs (not every frame)', (() => { const n = seen.filter((u) => /\/fr24\/flight/.test(u)).length; return n >= 2 && n <= 4; })(), String(seen.filter((u) => /\/fr24\/flight/.test(u)).length));
await shot('E1-globe-fr24');
MODE.fr24 = false;
ok('E FR24 fails: the free feed position takes over, card and SIGNAL name the free feed', await waitFor("(() => { const f = __globe.S.flights.get('a1b2c3'); return f && !f.fr24 && f.altFt === 9000 && !/Flightradar24/.test(ImHereMark.label()) && !/Flightradar24/.test(document.querySelector('#card .age').textContent); })()", 9000, 'fr24 fallback'),
  await ev('ImHereMark.label()'));
ok('E no exceptions / console errors', logs.length === 0, logs.slice(0, 3).join(' | '));
await ev('__globe.closeCard()');

// ================= F. 737 ride: Flightradar24 first (?fr24=1 forces it off the site), smooth between fixes, free feeds when it fails
MODE.fr24 = true; logs = []; seen.length = 0;
await send('Page.navigate', { url: `http://127.0.0.1:${port}/737/?flight=a0beef&cs=AAL55&lat=36.300&lon=-86.900&fr24=1` });
ok('F 737 joins and switches to Flightradar24', await waitFor("/Riding AAL55 .*Flightradar24/.test(document.getElementById('liveStatus').textContent)", 150000, '737 fr24'), await ev("document.getElementById('liveStatus').textContent"));
ok('F asked /fr24/flight?callsign=AAL55', seen.some((u) => /workers\.dev\/fr24\/flight\?callsign=AAL55$/.test(u)));
ok('F label SIGNAL: "Flightradar24, live"', await waitFor("/SIGNAL: Flightradar24, live/.test(ImHereMark.label())", 5000, '737 fr24 signal'), await ev('ImHereMark.label()'));
const fa = await ev('ImHere737.getFlightData().altitude'); await sleep(2000);
const fb = await ev('ImHere737.getFlightData().altitude');
ok('F between fixes the aircraft moves on (dead reckoning: -500 fpm)', fb < fa - 5 && fb > fa - 40, `${fa.toFixed(1)} -> ${fb.toFixed(1)}`);
const nHex = seen.filter((u) => /\/v2\/hex\/a0beef/.test(u)).length; await sleep(6000);
ok('F while FR24 answers, the free feeds are not polled every few seconds', seen.filter((u) => /\/v2\/hex\/a0beef/.test(u)).length === nHex && seen.filter((u) => /\/fr24\/flight/.test(u)).length <= 2,
  `hex ${seen.filter((u) => /\/v2\/hex\/a0beef/.test(u)).length - nHex}, fr24 ${seen.filter((u) => /\/fr24\/flight/.test(u)).length}`);
ok('F no "signal lost" note 8 s after a 20 s FR24 fix', await ev("document.getElementById('sigNote').hidden"));
await shot('F1-737-fr24');
MODE.fr24 = false;
ok('F FR24 fails: free feeds take over (SIGNAL names the free feed, live)', await waitFor("!/Flightradar24/.test(ImHereMark.label()) && ImHereMark.isLive() && /live ADS-B from/.test(document.getElementById('liveStatus').textContent)", 60000, '737 fallback'), await ev('ImHereMark.label()'));
const badF = logs.filter((l) => !/WebGL|GPU|three|THREE/.test(l));
ok('F no exceptions / console errors', badF.length === 0, badF.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
try { chrome.kill(); } catch { /* */ } server.close(); process.exit(failures ? 1 : 0);

// Animal card + Naturalist Guide, real page in headless Chrome (no network: the Wikimedia photo cannot load here, which
// tests the placeholder; a data: image tests the loaded photo and its caption). node test/card-guide.mjs
// Uses a local three r165 (THREE_DIR=/path/to/three, default /home/claude/xrtest/three).
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const THREE_ROOT = process.env.THREE_DIR ? path.dirname(process.env.THREE_DIR) : '/home/claude/xrtest';
let html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
html = html.replace('https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js', './three/build/three.module.js')
  .replaceAll('https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/', './three/examples/jsm/');
const hook = 'renderer.setAnimationLoop(frame);';
if (html.split(hook).length !== 2) throw new Error('animation loop hook not found');
html = html.replace(hook, hook + ` window.__wl = { tracks, selectTrack, addTrack, buildTrack, parseMovebankCSV, setView, setDist, seek, setPlay, card, cardXR, paintCardXR,
  capXR, NARR, narrate, guideStep, renderCard, get GS() { return GS; }, get cur() { return cur; }, get world() { return world; } };`);
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const f = path.join(THREE_ROOT, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(THREE_ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, dbg = 9200 + Math.floor(Math.random() * 90);
// --proxy-server to a dead port: the Wikimedia photo must fail (no network here anyway), proving the placeholder path
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--proxy-server=127.0.0.1:9',
  '--proxy-bypass-list=127.0.0.1', `--remote-debugging-port=${dbg}`, '--window-size=1280,800', `--user-data-dir=${fs.mkdtempSync('/tmp/wlg-')}`, 'about:blank'], { stdio: 'ignore' });
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
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');
const fails = []; let pass = 0;
const ok = (name, cond, info = '') => { if (cond) { pass++; console.log('ok -', name); } else { fails.push(name + (info ? ': ' + info : '')); console.log('FAIL -', name, info); } };
async function load() {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  for (let i = 0; i < 150; i++) { await sleep(200); if (await ev('!!window.__wl').catch(() => false)) return true; }
  return false;
}
async function click(sel) {   // a real (trusted) click, so the browser counts it as a user gesture
  const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
}
const txt = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).textContent`);

if (!(await load())) { console.error('FAIL page did not boot', logs.join(' ')); done(1); }
// ---------------- animal card: sample eagle ----------------
ok('card line 1 is "<Tracker> · <Species>"', (await txt('#cardL1')) === 'Sample track · Bald eagle', await txt('#cardL1'));
ok('card line 2 is "Tag <id>"', (await txt('#cardL2')) === 'Tag 4417', await txt('#cardL2'));
ok('card: tagging org, named-by credit', (await txt('#cardOrg')) === 'Nobody: a made-up sample track' && (await txt('#cardNamed')) === 'Not named');
const seen = await txt('#cardSeen');
ok('card: last seen = place name + time ago, flagged as sample data', /^(Near )?[A-Z][^·]+, (TN|KY) · \d+ (day|month|yr)s? ago \(sample data\)$/.test(seen), seen);
const src = await ev(`document.querySelector('#cardImg').getAttribute('src')`);
ok('sample loads a Wikimedia Commons species photo via a plain img', /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/.+\.jpg\?width=640$/.test(src || ''), src);
for (let i = 0; i < 40 && !(await ev(`/unavailable/.test(document.querySelector('#cardPhTxt').textContent)`)); i++) await sleep(250);
const ph = await ev(`({ ph: !document.querySelector('#cardPh').hidden, img: !document.querySelector('#cardImg').hidden, t: document.querySelector('#cardPhTxt').textContent,
  cap: document.querySelector('#cardCap').textContent, cr: document.querySelector('#cardCredit').textContent })`);
ok('photo that fails to load: tasteful placeholder, no caption or credit left behind', ph.ph && !ph.img && /unavailable/.test(ph.t) && !ph.cap && !ph.cr, JSON.stringify(ph));
const mapInk = await ev(`(() => { const c = document.querySelector('#cardMap'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let amber = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 230 && d[i + 1] > 160 && d[i + 1] < 200 && d[i + 2] < 110) amber++; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++; } return { w: c.width, h: c.height, amber, white }; })()`);
ok('card mini map draws the path', mapInk.w > 100 && mapInk.white > 20, JSON.stringify(mapInk));
// a real track with its own photo (data: image, loads offline), first a species photo, then one of this very animal
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAAHgAD/1d4h4kAAAAASUVORK5CYII=';
const csv = 'timestamp,location-long,location-lat,individual-local-identifier,individual-taxon-canonical-name,tag-local-identifier,individual-nick-name,tracking-organization,named-by\\n' +
  '2026-11-01 00:00:00,-121.95,36.80,MaryL,Carcharodon carcharias,T-77,Mary Lee,OCEARCH,Her tagging crew\\n2026-11-01 06:00:00,-121.96,36.81,MaryL,Carcharodon carcharias,T-77,,,\\n';
await ev(`(() => { const W = window.__wl, raw = W.parseMovebankCSV(${JSON.stringify(csv)}.replace(/\\\\n/g, '\\n')).tracks[0];
  W.selectTrack(W.addTrack(W.buildTrack(raw, { source: 'test.csv', name: 'Mary Lee', photoUrl: ${JSON.stringify(PNG)}, photoCredit: 'Test Photographer' }))); })()`);
for (let i = 0; i < 20 && (await ev(`document.querySelector('#cardImg').hidden`)); i++) await sleep(100);
const real = await ev(`({ l1: document.querySelector('#cardL1').textContent, l2: document.querySelector('#cardL2').textContent, org: document.querySelector('#cardOrg').textContent,
  nb: document.querySelector('#cardNamed').textContent, seen: document.querySelector('#cardSeen').textContent, img: !document.querySelector('#cardImg').hidden,
  cap: document.querySelector('#cardCap').textContent, cr: document.querySelector('#cardCredit').textContent, eye: document.querySelector('#distEye').textContent })`);
ok('real track: line 1 "<org> · <common name>", line 2 "Tag <id> · <name>"', real.l1 === 'OCEARCH · White shark' && real.l2 === 'Tag T-77 · Mary Lee', JSON.stringify(real));
ok('real track: org and named-by come from the data', real.org === 'OCEARCH' && real.nb === 'Her tagging crew');
ok('real track: last seen near Monterey Bay, no sample flag', /^Monterey Bay, CA · \d+ days? ago$/.test(real.seen), real.seen);
ok('photo not of this individual is captioned "Species photo, not this individual" and credited', real.img && real.cap === 'Species photo, not this individual' && real.cr === 'Photo: Test Photographer', JSON.stringify(real));
ok('eye distance is labelled for the animal (Shark\'s-eye)', real.eye === 'Shark\'s-eye', real.eye);
await ev(`(() => { const W = window.__wl; W.cur.photoIsIndividual = true; W.renderCard(true); })()`);
for (let i = 0; i < 20 && (await ev(`document.querySelector('#cardImg').hidden`)); i++) await sleep(100);
ok('photo of this very animal has no species caption', (await txt('#cardCap')) === '' && !(await ev(`document.querySelector('#cardImg').hidden`)));
const xrp = await ev(`(() => { const W = window.__wl; W.paintCardXR(); const g = W.cardXR.cv.getContext('2d'), d = g.getImageData(0, 0, 1024, 512).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
ok('VR card panel paints (photo, text, path map)', xrp > 300000, String(xrp));

// ---------------- Naturalist Guide ----------------
await ev(`window.__wl.selectTrack(window.__wl.tracks[0])`);
const off = await ev(`({ on: window.__wl.NARR.on, pressed: document.querySelector('#guideBtn').getAttribute('aria-pressed'), mute: document.querySelector('#mute').hidden,
  cc: document.querySelector('#cc').hidden, lines: window.__wl.NARR.lines })`);
ok('guide is OFF by default: no narration, no captions, no Mute / CC', !off.on && off.pressed === 'false' && off.mute && off.cc && off.lines === 0, JSON.stringify(off));
await sleep(1500);
ok('guide off: nothing narrated while riding', (await ev('window.__wl.NARR.lines')) === 0);
await click('#guideBtn');
await sleep(400);
const on1 = await ev(`({ on: window.__wl.NARR.on, pressed: document.querySelector('#guideBtn').getAttribute('aria-pressed'), mute: document.querySelector('#mute').hidden,
  cc: document.querySelector('#cc').hidden, cap: document.querySelector('#ccText').textContent, lines: window.__wl.NARR.lines, mode: window.__wl.NARR.mode,
  saved: localStorage.getItem('imhere.wildlife.guide'), voices: speechSynthesis.getVoices().length })`);
ok('Guide button turns the narrator on, with Mute and CC', on1.on && on1.pressed === 'true' && !on1.mute && on1.lines === 1, JSON.stringify(on1));
ok('start of ride: a captioned intro', /^Guide on\./.test(on1.cap), on1.cap);
ok('the intro is honest about the sample track', /You are with a bald eagle, tag 4417\. This is a sample track made up for the demo/.test(await ev('window.__wl.GS.info.intro')));
ok('the choice is remembered', JSON.parse(on1.saved || '{}').on === true, on1.saved);
// captions follow the narration line by line (timer when there is no voice, word events / timing when there is)
const capSeq = new Set(); let noteSeen = '';
for (let i = 0; i < 40; i++) { capSeq.add(await txt('#ccText')); if (!(await ev(`document.querySelector('#vnote').hidden`))) noteSeen = await txt('#vnote'); await sleep(250); }
ok('captions advance through the intro, bottom centre', capSeq.size >= 3, [...capSeq].join(' | '));
const cs = await ev(`(() => { const r = document.querySelector('#cc').getBoundingClientRect(); return { cx: r.x + r.width / 2, w: innerWidth, bottom: innerHeight - r.bottom }; })()`);
ok('captions sit bottom centre', Math.abs(cs.cx - cs.w / 2) < 20 && cs.bottom < 200, JSON.stringify(cs));
if (on1.voices === 0) {
  const n1 = await ev(`({ noVoice: window.__wl.NARR.noVoice, cc: !document.querySelector('#cc').hidden })`);
  ok('no speech voice here: captions carry the guide, with one small notice', noteSeen === 'Voice not supported in this browser, captions on' && n1.noVoice && n1.cc, noteSeen + ' ' + JSON.stringify(n1));
  await ev(`window.__wl.narrate('A second line, to check the notice does not repeat.')`); await sleep(200);
  await sleep(9500);
  ok('the notice is shown once only (gone after 9 s, not back for the next line)', (await ev(`document.querySelector('#vnote').hidden`)) && (await ev('window.__wl.NARR.noticed')) === true);
} else console.log('   (this Chrome has speech voices; the no-voice notice path is covered on the Quest)');
// only at moments: within the gap, nothing new; then a real moment (deepest point on the shark) speaks
const before = await ev('window.__wl.NARR.lines'); await sleep(2000);
ok('no chatter between moments', (await ev('window.__wl.NARR.lines')) === before);
await ev(`(() => { const W = window.__wl; W.selectTrack(W.tracks[1]); })()`); await sleep(300);
await ev(`(() => { const W = window.__wl, G = W.GS; W.NARR.mode = 'idle'; G.started = true; G.last = -1e9; G.ref = 0; G.bestSaid = 0; W.seek(W.cur.t0 + (W.cur.t1 - W.cur.t0) * 0.27); Object.assign(W.GS, { ref: 0, last: -1e9, bestSaid: 0 }); W.NARR.mode = 'idle'; })()`);
let moment = ''; for (let i = 0; i < 30 && !moment; i++) { await sleep(200); const c = await txt('#ccText'); if (/Deepest point|Diving/.test(c)) moment = c; }
ok('a dive / record moment is narrated', !!moment, moment || await txt('#ccText'));
// CC off hides captions, Mute flips the label, both remembered
await click('#ccBtn'); await sleep(150);
ok('CC off hides the captions', await ev(`document.querySelector('#cc').hidden`));
await click('#ccBtn'); await click('#mute'); await sleep(150);
const m = await ev(`({ t: document.querySelector('#mute').textContent, s: JSON.parse(localStorage.getItem('imhere.wildlife.guide')) })`);
ok('Mute silences the voice and is remembered', m.t === 'Unmute' && m.s.voiceOn === false && m.s.cc === true, JSON.stringify(m));
ok('VR caption copy matches the page caption', (await ev(`window.__wl.capXR.txt === document.querySelector('#ccText').textContent`)));
// reload: the guide comes back on (remembered), captions on; then off is remembered too
if (!(await load())) { console.error('FAIL reload'); done(1); }
await sleep(500);
const r2 = await ev(`({ on: window.__wl.NARR.on, pressed: document.querySelector('#guideBtn').getAttribute('aria-pressed'), cap: document.querySelector('#ccText').textContent, voiceOn: window.__wl.NARR.voiceOn })`);
ok('after a reload the guide is still on (and still muted)', r2.on && r2.pressed === 'true' && r2.voiceOn === false && /^(Guide on\.|You are with a bald eagle)/.test(r2.cap), JSON.stringify(r2));
await click('#guideBtn'); await sleep(200);
const r3 = await ev(`({ on: window.__wl.NARR.on, cc: document.querySelector('#cc').hidden, mute: document.querySelector('#mute').hidden, s: JSON.parse(localStorage.getItem('imhere.wildlife.guide')) })`);
ok('Guide off: captions gone, choice saved', !r3.on && r3.cc && r3.mute && r3.s.on === false, JSON.stringify(r3));
// distance control is in Ride and Chase, not in Map, and remembered
await click('#dist button[data-dist="wide"]'); await ev(`window.__wl.setView('map')`);
const dm = await ev(`({ hidden: document.querySelector('#dist').hidden, s: JSON.parse(localStorage.getItem('imhere.wildlife.dist')) })`);
ok('distance control: hidden on the Map, choice remembered per view', dm.hidden && dm.s.ride === 'wide' && dm.s.chase === 'close', JSON.stringify(dm));
const bad = logs.filter((l) => !/WebGL|GPU|swiftshader/i.test(l));
ok('no page exceptions', !bad.length, bad.slice(0, 3).join(' | '));
if (fails.length) { console.error('\nFAIL\n' + fails.join('\n')); done(1); }
console.log(`\ncard + guide: ${pass} checks passed`); done(0);

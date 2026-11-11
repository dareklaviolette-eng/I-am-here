// Offline tests of the relay's Flightradar24 routes: node relay/test/fr24-test.mjs
// fetch is mocked (FR24-format answers, synthetic); nothing touches the network. The key used here is a fake test value.
import { pathToFileURL, fileURLToPath } from 'url'; import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// clock we control (cache freshness, daily cap)
let NOW = Date.parse('2026-11-10T12:00:00Z'); const realNow = Date.now; Date.now = () => NOW;
const calls = []; let mode = 'ok';
const FAKE_KEY = 'test-key-not-real-123';
const rec = (o) => Object.assign({ fr24_id: '3a1b2c', hex: 'A1B2C3', callsign: 'SWA1234', lat: 36.12, lon: -86.68, track: 92, alt: 12000, gspeed: 310, vspeed: -640,
  squawk: '1234', timestamp: new Date(NOW - 4000).toISOString(), source: 'ADSB' }, o);
const full = (o) => rec(Object.assign({ flight: 'WN1234', type: 'B38M', reg: 'N8710M', orig_iata: 'MDW', orig_icao: 'KMDW', dest_iata: 'BNA', dest_icao: 'KBNA', eta: '2026-11-10T12:20:00Z' }, o));
globalThis.fetch = async (u, init) => {
  calls.push({ u: String(u), h: (init && init.headers) || {} });
  const r = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  if (mode === 'down') throw new TypeError('network down');
  if (mode === '401') return r(401, '{"message":"Unauthenticated: token ' + FAKE_KEY + '"}');
  if (/\/usage/.test(u)) return r(200, { data: [{ endpoint: 'live/flight-positions/light', request_count: 3, credits: 6 }, { endpoint: 'live/flight-positions/full', request_count: 1, credits: 8 }] });
  if (/callsigns=NOPE/.test(u)) return r(200, { data: [] });
  if (/flight-positions\/full/.test(u)) return r(200, { data: [full()] });
  if (/flight-positions\/light/.test(u) && /bounds=/.test(u)) return r(200, { data: [rec(), rec({ hex: 'abc001', callsign: 'AAL55', lat: 36.3, alt: 0, gspeed: 12 }), { hex: 'nopos' }] });
  if (/flight-positions\/light/.test(u)) return r(200, { data: [rec({ lat: 36.2, timestamp: new Date(NOW - 3000).toISOString() })] });
  return r(404, 'nope');
};
const W = (await import(pathToFileURL(path.join(here, '..', 'worker.js')))).default;
const env = { FR24_API_KEY: FAKE_KEY, FR24_DAILY_CAP: '44' };
const get = async (p, e = env) => { const res = await W.fetch(new Request('https://relay.example' + p), e); const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch (x) {} return { res, j, text }; };

// status without key: never echoes a key, says not configured, makes no upstream call
let r = await get('/fr24/status', {});
ok(r.res.status === 200 && r.j.configured === false && r.j.cap === 1500 && r.j.credits_used_today === 0 && !('usage' in r.j) && calls.length === 0, 'status without key: configured false, default cap 1500, no upstream call');
ok(r.res.headers.get('Access-Control-Allow-Origin') === 'https://dareklaviolette-eng.github.io', 'CORS header like the other routes');
r = await get('/fr24/flight?callsign=SWA1234', {});
ok(r.res.status === 503 && r.j.error === 'not_configured' && calls.length === 0, 'flight without key: 503 not_configured, no upstream call');

// first call per flight: full endpoint, normalized answer, right headers
r = await get('/fr24/flight?callsign=swa1234');
const c0 = calls[0];
ok(r.res.status === 200 && /\/api\/live\/flight-positions\/full\?callsigns=SWA1234$/.test(c0.u), 'first call uses /live/flight-positions/full?callsigns=SWA1234');
ok(c0.h.Authorization === 'Bearer ' + FAKE_KEY && c0.h['Accept-Version'] === 'v1' && c0.h.Accept === 'application/json', 'headers: Bearer token, Accept-Version v1, Accept json');
const f = r.j;
ok(f.lat === 36.12 && f.lon === -86.68 && f.alt_ft === 12000 && f.gs_kt === 310 && f.track === 92 && f.vs_fpm === -640 && f.callsign === 'SWA1234' && f.flight === 'WN1234'
  && f.reg === 'N8710M' && f.type === 'B38M' && f.orig === 'KMDW' && f.dest === 'KBNA' && f.ts === NOW - 4000 && f.source === 'Flightradar24' && f.hex === 'a1b2c3',
  'normalized {lat, lon, alt_ft, gs_kt, track, vs_fpm, callsign, flight, reg, type, orig, dest, ts, source}');
ok(!r.text.includes(FAKE_KEY), 'the key never appears in an answer');

// within 20 s: cached, no new call (many viewers share one)
NOW += 10000; const n1 = calls.length;
const many = await Promise.all([1, 2, 3].map(() => get('/fr24/flight?callsign=SWA1234')));
ok(calls.length === n1 && many.every((x) => x.j.lat === 36.12 && x.j.age_s === 10), 'within 20 s every viewer gets the cached answer (no upstream call)');
// after 20 s: light, keeps route/type from the full call
NOW += 11000;
const burst = await Promise.all([1, 2, 3].map(() => get('/fr24/flight?callsign=SWA1234')));
ok(calls.length === n1 + 1 && /flight-positions\/light\?callsigns=SWA1234$/.test(calls[calls.length - 1].u), 'after 20 s: one light call, shared by concurrent viewers');
ok(burst.every((x) => x.j.lat === 36.2 && x.j.type === 'B38M' && x.j.dest === 'KBNA' && x.j.reg === 'N8710M'), 'light answer keeps type, reg and route from the full call');
// after 10 min: full again
NOW += 600000; await get('/fr24/flight?callsign=SWA1234');
ok(/flight-positions\/full/.test(calls[calls.length - 1].u), 'full endpoint again after 10 min');

// other id kinds and validation
await get('/fr24/flight?flight=WN99'); ok(/full\?flights=WN99$/.test(calls[calls.length - 1].u), 'flight= -> flights=');
await get('/fr24/flight?reg=N8710M'); ok(/full\?registrations=N8710M$/.test(calls[calls.length - 1].u), 'reg= -> registrations=');
r = await get('/fr24/flight'); ok(r.res.status === 400 && r.j.ok === false, 'no id: 400');
r = await get('/fr24/flight?callsign=' + encodeURIComponent('A;DROP')); ok(r.res.status === 400, 'bad id: 400');
r = await get('/fr24/flight?callsign=NOPE'); ok(r.res.status === 404 && r.j.error === 'not_found', 'not airborne: 404 not_found');

// area: bounds rounded outward, limit capped at 300, cached 60 s
const nA = calls.length;
r = await get('/fr24/area?bounds=36.73,35.21,-87.4,-85.9&limit=5000');
const ua = calls[calls.length - 1].u;
ok(r.res.status === 200 && /light\?bounds=37\.0%2C35\.0%2C-87\.5%2C-85\.5&limit=300$/.test(ua), 'area: bounds N,S,W,E rounded outward to 0.5°, limit capped at 300');
ok(r.j.count === 2 && r.j.flights[1].on_ground === true && r.j.flights[0].alt === 12000 && r.j.flights[0].gs === 310, 'area: rows without a position dropped; alt/gs aliases for the globe');
NOW += 30000; await get('/fr24/area?bounds=36.9,35.1,-87.2,-85.6');
ok(calls.length === nA + 1, 'area: a nearby view within 60 s shares the cached answer');
r = await get('/fr24/area?bounds=35,36,-87,-86'); ok(r.res.status === 400, 'area: north below south is 400');

// cap: FR24_DAILY_CAP=44 -> 429 { error: "cap" } and no upstream call
r = await get('/fr24/status');
const used = r.j.credits_used_today;
ok(used === 8 + 2 + 8 + 8 + 8 + 8 + 2 && r.j.cap === 44 && r.j.over_cap === true && r.j.usage && r.j.usage.credits === 14, 'status: estimate (full 8, light 2), cap from FR24_DAILY_CAP, FR24 /usage summed');
ok(!r.text.includes(FAKE_KEY), 'status never shows the key');
NOW += 60000; const nC = calls.length;
r = await get('/fr24/flight?callsign=DAL9');
ok(r.res.status === 429 && r.j.error === 'cap' && calls.length === nC, 'over the cap: 429 {error:"cap"}, no upstream call');
r = await get('/fr24/flight?callsign=SWA1234');
ok(r.res.status === 429 && r.j.error === 'cap', 'over the cap: no stale answer served instead of the cap error');
// new UTC day: counter starts again
NOW = Date.parse('2026-11-11T00:00:05Z');
r = await get('/fr24/flight?callsign=DAL9');
ok(r.res.status === 200 && (await get('/fr24/status?usage=0')).j.credits_used_today === 8, 'new UTC day: counter resets');

// upstream errors: plain words, never the upstream body (which here echoes the key)
mode = '401'; r = await get('/fr24/flight?callsign=UAL1');
ok(r.res.status === 502 && /did not accept the API key/.test(r.j.message) && !r.text.includes(FAKE_KEY) && !r.text.includes('Unauthenticated'), '401 from FR24: clean JSON error, upstream body not passed on');
mode = 'down'; r = await get('/fr24/flight?callsign=UAL2');
ok(r.res.status === 502 && r.j.ok === false && /Flightradar24/.test(r.j.message), 'network failure: clean 502');
NOW += 25000; r = await get('/fr24/flight?callsign=DAL9');
ok(r.res.status === 200 && r.j.stale === true && r.j.lat === 36.12, 'upstream down: last good position served with stale:true');
mode = 'ok';
r = await get('/nothing'); ok(r.res.status === 404 && r.j.routes.includes('/fr24/flight'), 'route list names the fr24 routes');

Date.now = realNow;
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);

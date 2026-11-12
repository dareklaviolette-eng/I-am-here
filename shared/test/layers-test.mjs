// Offline unit tests: world-layer registry (shared/world-layers.js) and plane-traffic rules (shared/layer-planes.js).
// node shared/test/layers-test.mjs        (mock data only; nothing touches the network)
import { pathToFileURL, fileURLToPath } from 'node:url'; import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), imp = (p) => import(pathToFileURL(path.join(here, p)));
const WL = await imp('../world-layers.js'), LP = await imp('../layer-planes.js');
let fails = 0; const ok = (c, m, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info ? '  ' + info : '')); if (!c) fails++; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- range and altitude filter
const own = { lat: 36.12, lon: -86.68, altFt: 3000, fieldFt: 599, hex: 'aaaaaa', callsign: 'SWA444', onGround: false, nearAptNm: 5 };
ok(LP.trafficRangeNm(own) === 10, 'near an airport / low: 10 nm');
ok(LP.trafficRangeNm({ ...own, altFt: 35000, nearAptNm: 80 }) === 20, 'cruise: 20 nm');
ok(LP.trafficRangeNm({ ...own, altFt: 35000, nearAptNm: 3 }) === 10, 'high but over an airport: 10 nm');
ok(LP.trafficRangeNm({ ...own, altFt: 9000, nearAptNm: 80 }) === 10, 'below 10,000 ft: 10 nm');
ok(LP.trafficRangeNm({ ...own, onGround: true, altFt: 599, nearAptNm: 0 }) === 10, 'on the ground: 10 nm');
const T = 1_700_000_000_000, nmN = (nm) => own.lat + nm / 60;   // a point nm north
const mk = (o) => ({ hex: 'h' + Math.random().toString(16).slice(2, 7), flight: '', reg: '', type: 'B738', lat: own.lat, lon: own.lon, altFt: 3000, onGround: false, gs: 250, track: 90, vr: 0, fixAt: T - 2000, ...o });
const list = [
  mk({ hex: 'aaaaaa', lat: nmN(1) }),                      // the ownship by hex
  mk({ flight: 'SWA444 ', lat: nmN(1.2) }),                // the ownship by callsign
  mk({ hex: 'in5', lat: nmN(5), altFt: 7900 }),             // 4,900 ft above: in
  mk({ hex: 'out5', lat: nmN(5), altFt: 8100 }),            // 5,100 ft above: out
  mk({ hex: 'far', lat: nmN(10.5) }),                       // beyond 10 nm: out
  mk({ hex: 'near', lat: nmN(0.5) }),
  mk({ hex: 'gnd', lat: nmN(2), onGround: true, altFt: 0, gs: 12 }),   // taxiing: field elevation counts (2,401 ft below): in
  mk({ hex: 'noalt', lat: nmN(2), altFt: null }),           // airborne without altitude: cannot be placed
  mk({ hex: 'stale', lat: nmN(2), fixAt: T - 120000 }),     // last heard 2 min ago: not broadcasting
  { hex: 'nopos', altFt: 3000 },
];
const f = LP.filterTraffic(list, own, { now: T });
ok(f.map((x) => x.hex).join(',') === 'near,gnd,in5', 'filter: ownship, out-of-band, out-of-range, no-altitude, stale and position-less rows dropped; nearest first', f.map((x) => x.hex).join(','));
ok(LP.filterTraffic(list, { ...own, altFt: 35000, nearAptNm: 99 }, { now: T }).length === 0, 'cruise at FL350: low traffic outside the band');
const many = Array.from({ length: 120 }, (_, i) => mk({ hex: 'm' + i, lat: own.lat + (i % 11 - 5) / 120, lon: own.lon + (Math.floor(i / 11) - 5) / 100 }));
const capped = LP.filterTraffic(many, own, { now: T });
ok(capped.length === 40 && capped.every((x, i) => !i || capped[i - 1].distNm <= x.distNm), 'cap 40, nearest first');
ok(LP.filterTraffic(many, own, { now: T, max: 20 }).length === 20, 'cap can be lowered (VR watchdog)');

// ---------------------------------------------------------------- dead reckoning
const out = {};
const a = mk({ lat: 36, lon: -86, gs: 360, track: 90, vr: 1200, altFt: 5000, fixAt: T });
LP.deadReckon(a, T + 10000, out, own);
const dE = (out.lon - (-86)) * LP.mPerDegLon(36), dN = (out.lat - 36) * LP.mPerDegLat(36);
ok(Math.abs(dE - 360 * 0.514444 * 10) < 1 && Math.abs(dN) < 0.01, 'east at 360 kt for 10 s = 1,852 m east', dE.toFixed(1) + ' m');
ok(Math.abs(out.altFt - 5200) < 0.01, 'climbs 1,200 fpm for 10 s = +200 ft', out.altFt.toFixed(1));
LP.deadReckon(a, T + 300000, out, own); ok(Math.abs(out.t - 60) < 1e-9, 'extrapolation stops at 60 s');
LP.deadReckon(mk({ onGround: true, altFt: 0, gs: 15, track: 0, fixAt: T }), T + 30000, out, own);
ok(out.t === 10 && out.altFt === 599, 'ground: 10 s at most, at field elevation');
LP.deadReckon(mk({ gs: null, track: null, lat: 1, lon: 2, fixAt: T }), T + 5000, out, own); ok(out.lat === 1 && out.lon === 2, 'no speed/track: stays at its report');
LP.deadReckon(a, T - 5000, out, own); ok(out.t === 0, 'a report from the future is not run backwards');

// ---------------------------------------------------------------- TCAS symbol rules
const s = {};
LP.tcasSymbol(500, 3, 0, s); ok(s.proximate && s.text === '+05' && s.above && s.arrow === 0, 'within 6 nm, +500 ft: proximate (filled), "+05", no arrow');
LP.tcasSymbol(-1200, 6, -800, s); ok(s.proximate && s.text === '−12' && !s.above && s.arrow === -1, 'edge 6 nm / -1,200 ft: proximate, "−12", descending arrow');
LP.tcasSymbol(1300, 2, 600, s); ok(!s.proximate && s.text === '+13' && s.arrow === 1, '+1,300 ft: other traffic (hollow), climbing arrow');
LP.tcasSymbol(200, 6.5, 0, s); ok(!s.proximate, '6.5 nm: other traffic');
LP.tcasSymbol(30, 1, 499, s); ok(s.text === '00' && s.arrow === 0, 'co-altitude "00"; arrow only at 500 fpm or more');
LP.tcasSymbol(-12000, 1, 0, s); ok(s.text === '−99', 'clamped to two digits');
ok(LP.ndRangeNm('APPROACH') === 10 && LP.ndRangeNm('TAXI') === 10 && LP.ndRangeNm('CLIMB') === 20 && LP.ndRangeNm('DESCENT') === 20 && LP.ndRangeNm('CRUISE', 35000) === 40, 'ND range by phase: 10 / 20 / 40');
// drawTCAS on a recording canvas: filled vs stroked diamonds, labels, ground traffic skipped
const calls = []; const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])), set: (t, k, v) => { t[k] = v; return true; } });
const tg = [{ active: true, onGround: false, relE: 0, relN: 3 * 1852, relAlt: 500, vr: 0, distNm: 3 }, { active: true, onGround: false, relE: 5 * 1852, relN: 0, relAlt: 3000, vr: 900, distNm: 5 },
  { active: true, onGround: true, relE: 0, relN: 1852, relAlt: -2400, vr: 0, distNm: 1 }, { active: false }];
const n = LP.drawTCAS(ctx, tg, { R: 360, rangeNm: 10, trackDeg: 0 });
ok(n === 2, 'two airborne targets drawn; ground traffic and empty slots skipped');
ok(calls.filter((c) => c[0] === 'fill').length === 1 && calls.filter((c) => c[0] === 'fillText').map((c) => c[1]).join(',') === '+05,+30', 'one filled (proximate) diamond; tags "+05", "+30"');
const ft = calls.find((c) => c[0] === 'fillText' && c[1] === '+05'); ok(Math.abs(ft[2]) < 1e-9 && Math.abs(ft[3] - (-108 - 20)) < 1e-6, 'straight ahead at 3 nm of 10 (R 360 px): 108 px up, tag above');
ok(LP.markerText({ flight: 'SWA1234', vr: -900, onGround: false }, 12420) === 'SWA1234 · 12,400 ft · ↓' && LP.markerText({ flight: 'UAL9', vr: 0 }, 35000) === 'UAL9 · FL350'
  && LP.markerText({ hex: 'abc123', onGround: true, vr: 0 }, 599) === 'ABC123 · GND', 'marker words: callsign · altitude · arrow');

// ---------------------------------------------------------------- registry
const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
let clock = 1000; const now = () => clock;
const mkLayer = (id, impl = {}) => ({ id, label: id, refreshMs: 25000, calls: 0, data: null, updates: 0, vis: null,
  fetchNear(lat, lon, alt, signal) { this.calls++; this.lastSignal = signal; return impl.fetch ? impl.fetch(signal) : Promise.resolve({ n: this.calls }); },
  setData(d) { this.data = d; }, update() { this.updates++; }, pickables: () => impl.picks || [], setVisible(v) { this.vis = v; } });
const R = new WL.WorldLayers({ department: 'aviation', storage, now });
const P = R.register(mkLayer('planes'));
ok(R.isOn('planes') && P.vis === true, 'aviation: Planes on by default');
const M = new WL.WorldLayers({ department: 'maritime', storage, now }); M.register(mkLayer('planes')); M.register(mkLayer('ships'));
ok(!M.isOn('planes') && M.isOn('ships'), 'maritime: Ships on, Planes off');
const L = R.list(); ok(L.length === 4 && L[0].built && L[0].on && !L[1].built && !L[2].built && !L[3].built, 'menu: Planes built; Ships, Wildlife, ISS "soon"');
ok(!R.set('ships', true) && !R.isOn('ships'), 'a layer not built yet cannot be switched on');
const ownR = { lat: 36, lon: -86, altFt: 3000 };
R.tick(null, ownR, 0.016); await tick();
ok(P.calls === 1 && P.data && P.data.n === 1 && P.updates === 1, 'first tick fetches right away and draws');
clock += 10000; R.tick(null, ownR, 0.016); await tick(); ok(P.calls === 1, 'no refetch before 25 s');
clock += 16000; R.tick(null, ownR, 0.016); await tick(); ok(P.calls === 2, 'refetch after 25 s');
P.refetchNm = 4; clock += 9000; R.tick(null, { ...ownR, lat: 36.1 }, 0.016); await tick(); ok(P.calls === 3, 'early refetch after flying 6 nm (> 4 nm)');
// off: aborts the request in flight, stops drawing, persists
let pend; const Q = new WL.WorldLayers({ department: 'aviation', storage: null, now });
const QP = Q.register(mkLayer('planes', { fetch: (sig) => new Promise((res, rej) => { pend = { res, rej, sig }; sig.addEventListener && sig.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) }));
Q.tick(null, ownR, 0.016); ok(QP.calls === 1 && !pend.sig.aborted, 'request in flight');
Q.set('planes', false); ok(pend.sig.aborted && QP.vis === false, 'switching off cancels the request and hides the layer');
const u0 = QP.updates; Q.tick(null, ownR, 0.016); ok(QP.updates === u0 && QP.calls === 1, 'off: no drawing, no fetching');
R.set('planes', false); const R2 = new WL.WorldLayers({ department: 'aviation', storage, now }); R2.register(mkLayer('planes'));
ok(!R2.isOn('planes'), 'on/off is remembered for the session');
R.set('planes', true);
// back-off and 429
let failN = 0; const B = new WL.WorldLayers({ department: 'aviation', storage: null, now });
const BP = B.register(mkLayer('planes', { fetch: () => { failN++; return Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503 })); } }));
clock = 0; B.tick(null, ownR, 0); await tick(); await tick();
ok(B.state('planes').fails === 1 && B.state('planes').next === 15000, 'first failure: retry in 15 s', String(B.state('planes').next));
clock = 15000; B.tick(null, ownR, 0); await tick(); await tick(); ok(B.state('planes').next === 15000 + 30000, 'second failure: 30 s');
ok(WL.backoffMs(10, 0) === 300000 && WL.backoffMs(1, 429) === 300000, 'back-off capped at 5 min; HTTP 429 rests 5 min at once');
// pick: nearest in angle, within tolerance, behind ignored
const picks = [{ active: true, x: 0, y: 0, z: -1000, r: 20 }, { active: true, x: 60, y: 0, z: -1000, r: 20 }, { active: true, x: 0, y: 0, z: 1000, r: 20 }, { active: false, x: 0, y: 0, z: -500, r: 20 }];
const K = new WL.WorldLayers({ department: 'aviation', storage: null }); K.register(mkLayer('planes', { picks }));
const o = { x: 0, y: 0, z: 0 };
ok(K.pick(o, { x: 0, y: 0, z: -1 }, 2) === picks[0], 'pick: the item straight ahead');
const dd = { x: 0.055, y: 0, z: -1 }, l = Math.hypot(dd.x, dd.z); dd.x /= l; dd.z /= l;
ok(K.pick(o, dd, 2) === picks[1], 'pick: the item the ray points nearer to');
ok(K.pick(o, { x: 0, y: 0.2, z: -0.98 }, 2) === null, 'pick: nothing when pointing away (11°)');
ok(K.pick(o, { x: 0, y: 0, z: 1 }, 2) === picks[2], 'pick: works in any direction; inactive items ignored');
K.set('planes', false); ok(K.pick(o, { x: 0, y: 0, z: -1 }, 2) === null, 'pick: a hidden layer cannot be pointed at');
// ---------------------------------------------------------------- fetcher: free feeds first, FR24 area last, 429 respected
const SRC = [{ name: 'a', primary: true, point: () => 'https://a/x' }, { name: 'b', primary: true, point: () => 'https://b/x' }];
const resp = (status, j) => ({ ok: status === 200, status, json: async () => j });
const v2 = { now: Date.now(), ac: [{ hex: 'abc001', flight: 'X1', lat: 36, lon: -86, alt_baro: 4000, gs: 200, track: 10, category: 'A3' }] };
let hits = [];
let F1 = LP.createTrafficFetcher({ onSite: false, sources: SRC, fetchFn: async (u) => { hits.push(u); return u.startsWith('https://a') ? resp(429, {}) : resp(200, v2); } });
let r1 = await F1.fetchNear(36, -86, 13);
ok(r1.source === 'b' && r1.flights.length === 1 && r1.flights[0].category === 'A3', 'free feed answers (after a 429 from the first); ADS-B category kept');
ok(F1.pool.rest.get('a') > Date.now() + 100000, 'the source that said 429 rests 2 min');
hits = []; F1 = LP.createTrafficFetcher({ onSite: true, sources: SRC, fetchFn: async (u) => { hits.push(u); return u.includes('/fr24/area') ? resp(200, { ok: true, flights: [{ hex: 'f00001', callsign: 'DAL1', lat: 36, lon: -86, alt_ft: 5000, alt: 5000 }] }) : resp(503, {}); } });
r1 = await F1.fetchNear(36, -86, 13);
ok(r1.source === 'Flightradar24' && hits.filter((u) => u.includes('/fr24/area')).length === 1 && /bounds=36\.21\d,35\.78\d,/.test(hits.at(-1)), 'every free feed down: one Flightradar24 area call (bounds N,S,W,E)', hits.at(-1));
let e1 = null; try { await F1.fetchNear(36, -86, 13); } catch (e) { e1 = e; }
ok(e1 && hits.filter((u) => u.includes('/fr24/area')).length === 1, 'Flightradar24 not asked again within 60 s');
F1.state.fr24Next = 0; hits = [];
F1 = LP.createTrafficFetcher({ onSite: true, sources: SRC, fetchFn: async (u) => resp(429, { ok: false, error: 'cap' }) });
try { await F1.fetchNear(36, -86, 13); } catch (e) { e1 = e; }
ok(e1.status === 429 && F1.state.fr24Next > Date.now() + 800000, 'over the daily cap (429): Flightradar24 rests 15 min, the error says 429 (registry rests 5 min)');
const ac = new AbortController(); ac.abort();
try { await LP.createTrafficFetcher({ onSite: false, sources: SRC, fetchFn: async () => resp(200, v2) }).fetchNear(36, -86, 13, ac.signal); e1 = null; } catch (e) { e1 = e; }
ok(e1 && e1.name === 'AbortError', 'a cancelled refresh stops');
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

// I'M HERE globe: data layer (pure module: no DOM). Flights, ships, ISS, search helpers, clustering.
// Tested in Node: node globe/test/feeds-test.mjs
//
// Flights, in order (first that answers wins; each answer remembers what worked so the next refresh goes straight there):
//   1. relay /flights/area   (I'M HERE Worker; GitHub site only, CORS is locked to it). Shape: ADS-B Exchange v2 { ac:[...] }
//      or { flights:[...] } or a bare array; field names are read loosely (see normFlight).
//   2. the 737 page's point sources (737/live-flights.js): relay /lat/../lon/../dist/.., airplanes.live, adsb.lol, OpenSky.
//      A point query reaches at most 250 nm, so a wide view loads around its centre only (the page says so).
//   3. last resort: relay /fr24/area (Flightradar24 light positions, paid credits, cached 60 s on the relay; GitHub site only).
//   /flights/summary (if the relay has it) gives counts for views too wide to load aircraft.
// The flight on an open card is followed with Flightradar24 first (relay /fr24/flight, every 20 s; see app.js followFR24).
// Nothing is invented: a value the feed did not send stays null and the card says "not in the feed".
import { SOURCES, RELAY, COCKPIT_737, parseV2, parseOpenSky, distNm, getFlightJSON, SourcePool,
  fetchFR24, FR24Follow, FR24_NAME, FR24_FRESH_S, FR24_EXTRAP_MAX } from '../737/live-flights.js';
export { RELAY, COCKPIT_737, distNm, fetchFR24, FR24Follow, FR24_NAME, FR24_FRESH_S, FR24_EXTRAP_MAX };

export const ON_SITE = typeof location !== 'undefined' && /(^|\.)dareklaviolette-eng\.github\.io$/i.test(location.hostname);
export const FRESH_S = 30;          // "live" (green) only when the position report is younger than this
export const POINT_MAX_NM = 250;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(+v) ? +v : null);
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

// One aircraft from any of the shapes we accept -> the same record parseV2 makes (+ orig/dest when a feed sends them).
export function normFlight(a, receivedAt, feedNow) {
  if (!a) return null;
  const lat = num(a.lat ?? a.latitude), lon = num(a.lon ?? a.lng ?? a.longitude);
  if (lat === null || lon === null) return null;
  const ground = a.alt_baro === 'ground' || a.onGround === true || a.on_ground === true || a.gnd === true;
  const alt = ground ? 0 : num(a.alt_baro) ?? num(a.altFt) ?? num(a.alt) ?? num(a.alt_geom) ?? num(a.altitude);
  const seen = num(a.seen_pos) ?? num(a.seen) ?? num(a.ageS) ?? num(a.age) ?? 0;
  const base = feedNow && receivedAt - feedNow >= 0 && receivedAt - feedNow < 600000 ? feedNow : receivedAt;   // a cached relay answer is older
  const fixAt = num(a.fixAt) ?? (num(a.ts) !== null ? (+a.ts < 1e12 ? +a.ts * 1000 : +a.ts) : base - seen * 1000);
  return {
    hex: str(a.hex ?? a.icao24 ?? a.icao).toLowerCase().replace(/^~/, ''),
    flight: str(a.flight ?? a.callsign ?? a.cs), reg: str(a.r ?? a.reg ?? a.registration),
    type: str(a.t ?? a.type ?? a.typecode).toUpperCase(), desc: str(a.desc),
    lat, lon, altFt: alt, onGround: !!ground,
    gs: num(a.gs) ?? num(a.speed) ?? num(a.groundspeed), track: num(a.track) ?? num(a.true_heading) ?? num(a.heading) ?? num(a.trk),
    vr: num(a.baro_rate) ?? num(a.geom_rate) ?? num(a.vr) ?? 0,
    orig: str(a.orig ?? a.origin ?? a.from ?? a.dep ?? a.departure).toUpperCase(),
    dest: str(a.dest ?? a.destination ?? a.to ?? a.arr ?? a.arrival).toUpperCase(),
    fixAt,
  };
}
export function parseFlights(j, receivedAt = Date.now()) {
  const list = Array.isArray(j) ? j : (j && (j.ac || j.aircraft || j.flights || j.states)) || [];
  if (j && Array.isArray(j.states) && Array.isArray(j.states[0])) return parseOpenSky(j, receivedAt).map((f) => ({ ...f, orig: '', dest: '' }));
  const now = j && num(j.now) !== null ? (+j.now < 1e12 ? +j.now * 1000 : +j.now) : null;
  return list.map((a) => normFlight(a, receivedAt, now)).filter(Boolean);
}
export const is737 = (f) => COCKPIT_737.test(f.type || '');
export const ageS = (f, now = Date.now()) => Math.max(0, (now - f.fixAt) / 1000);
export const isLive = (f, now = Date.now()) => ageS(f, now) < (f.freshS || FRESH_S);   // FR24 fixes (every 20 s) carry freshS

// Bounds helpers. b = { s, w, n, e } in degrees (w may be > e across the antimeridian: we split that into two queries).
export function boundsCenter(b) { let e = b.e; if (e < b.w) e += 360; let lo = (b.w + e) / 2; if (lo > 180) lo -= 360; return [(b.s + b.n) / 2, lo]; }
export function boundsRadiusNm(b) { const [la, lo] = boundsCenter(b); return Math.max(distNm(la, lo, b.n, b.w), distNm(la, lo, b.s, b.e)); }
export function inBounds(b, lat, lon, padDeg = 0) {
  if (lat < b.s - padDeg || lat > b.n + padDeg) return false;
  if (b.e - b.w >= 360) return true;
  const w = b.w - padDeg, e = b.e + padDeg;
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e;
}
export function areaURL(b, base = RELAY) {
  const f = (x) => (+x).toFixed(3);
  return `${base}/flights/area?lamin=${f(b.s)}&lomin=${f(b.w)}&lamax=${f(b.n)}&lomax=${f(b.e)}&bbox=${f(b.s)},${f(b.w)},${f(b.n)},${f(b.e)}`;
}

async function getJSON(url, fetchFn, timeoutMs = 7000) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const to = ac && setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchFn(url, ac ? { signal: ac.signal, cache: 'no-store' } : undefined);
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { if (to) clearTimeout(to); }
}

// Flight loader. One instance per page. Primary: the DIRECT browser feeds (airplanes.live, adsb.lol, adsb.fi), one request per
// refresh, taken in turn (SourcePool); a source that fails rests (2 min after HTTP 429). Then the relay (point route, then
// /flights/area) and OpenSky. Any 404, non-JSON or { ok: false } from a relay route = "route unavailable": next path, same refresh.
export class FlightFeed {
  constructor({ fetchFn = (u, o) => fetch(u, o), onSite = ON_SITE, sources = SOURCES } = {}) {
    this.fetchFn = fetchFn; this.onSite = onSite; this.sources = sources; this.pool = new SourcePool(sources);
    this.relayArea = onSite ? null : false;      // null = unknown, true/false once tried
    this.relaySummary = onSite ? null : false;
    this.relayFind = onSite ? null : false;
    this.fr24AreaNext = 0;   // Flightradar24 area fallback: rests after a failure (cap / not set up: 15 min, else 1 min)
  }
  // -> { source, flights, coverage: 'view' | { lat, lon, nm } }
  async load(b) {
    const errs = [], radius = boundsRadiusNm(b);
    const [la, lo] = boundsCenter(b), nm = Math.max(5, Math.min(POINT_MAX_NM, Math.ceil(radius)));
    const order = this.pool.order(), relayArea = this.relayArea !== false && radius < 1500;
    for (const s of order) {
      if (s.opensky && relayArea) { const r = await this._area(b, errs); if (r) return r; }   // the relay's area route before OpenSky
      try {
        const j = await getFlightJSON(s.point(la, lo, nm), this.fetchFn, 6000), t = Date.now();
        this.pool.ok(s.name);
        const flights = (s.opensky ? parseOpenSky(j, t).map((f) => ({ ...f, orig: '', dest: '' })) : parseFlights(j, t));
        return { source: s.name, flights, coverage: radius > POINT_MAX_NM ? { lat: la, lon: lo, nm } : 'view' };
      } catch (e) { this.pool.fail(s.name, e.status); errs.push(s.name + ': ' + e.message); }
    }
    if (relayArea && !order.some((s) => s.opensky)) { const r = await this._area(b, errs); if (r) return r; }
    if (this.onSite && radius <= 600 && Date.now() >= this.fr24AreaNext) { const r = await this._fr24Area(b, errs); if (r) return r; }
    const err = new Error('No live flight source reachable (' + errs.join('; ') + ')'); err.all = errs; throw err;
  }
  async _area(b, errs) {
    try {
      const j = await getFlightJSON(areaURL(b), this.fetchFn, 6000), t = Date.now();
      this.relayArea = true;
      return { source: 'I\'M HERE relay', flights: parseFlights(j, t), coverage: 'view' };
    } catch (e) { if (e.status === 404 || e.status === 400) this.relayArea = false; errs.push('relay area: ' + e.message); return null; }
  }
  // Flightradar24 light positions for the view (bounds N,S,W,E; not across the antimeridian), only when every free feed failed.
  async _fr24Area(b, errs) {
    if (b.w >= b.e) return null;
    try {
      const f = (x) => (+x).toFixed(3);
      const j = await getFlightJSON(`${RELAY}/fr24/area?bounds=${f(b.n)},${f(b.s)},${f(b.w)},${f(b.e)}&limit=300`, this.fetchFn, 8000), t = Date.now();
      const flights = parseFlights(j, t).map((x) => ({ ...x, fr24: true, freshS: FR24_FRESH_S, extrapS: FR24_EXTRAP_MAX }));
      return { source: FR24_NAME, flights, coverage: 'view' };
    } catch (e) {
      this.fr24AreaNext = Date.now() + (e.status === 429 || e.status === 503 || e.status === 404 ? 900000 : 60000);
      errs.push('Flightradar24 area: ' + e.message); return null;
    }
  }
  // World/region counts for wide views, if the relay has /flights/summary. -> [{ lat, lon, n }] or null
  async summary(b) {
    if (this.relaySummary === false) return null;
    try {
      const f = (x) => (+x).toFixed(2);
      const j = await getJSON(`${RELAY}/flights/summary?lamin=${f(b.s)}&lomin=${f(b.w)}&lamax=${f(b.n)}&lomax=${f(b.e)}`, this.fetchFn);
      if (!j || j.ok === false) { this.relaySummary = false; return null; }
      this.relaySummary = true; return parseSummary(j);
    } catch (e) { if (e.status === 404 || e.status === 400) this.relaySummary = false; return null; }
  }
  // Find one flight anywhere by callsign / flight number / tail / hex. -> flight record or null
  async find(q) {
    const k = classifyQuery(q); if (!k.flightLike) return null;
    const tries = [];
    const direct = ['https://api.airplanes.live/v2/', 'https://api.adsb.lol/v2/'];
    for (const base of direct) {
      if (k.hex) tries.push({ url: base + 'hex/' + k.hex });
      for (const cs of k.callsigns) tries.push({ url: base + 'callsign/' + cs });
      if (k.reg) tries.push({ url: base + 'reg/' + k.reg });
    }
    if (this.relayFind !== false) tries.push({ url: `${RELAY}/flights/find?q=${encodeURIComponent(k.raw)}`, relay: true });   // relay last
    if (this.onSite && k.hex) tries.push({ url: `${RELAY}/hex/${k.hex}` });
    for (const t of tries) {
      try {
        const j = await getJSON(t.url, this.fetchFn, 6000); if (!j || j.ok === false) throw Object.assign(new Error('unavailable'), { status: 404 });
        const list = Array.isArray(j) || j.ac || j.aircraft || j.flights ? parseFlights(j) : [normFlight(j.flight || j, Date.now())].filter(Boolean);
        if (t.relay) this.relayFind = true;
        const hit = pickMatch(list, k); if (hit) return hit;
      } catch (e) { if (t.relay && (e.status === 404 || e.status === 400)) this.relayFind = false; }
    }
    return null;
  }
}
export function parseSummary(j) {
  const list = Array.isArray(j) ? j : (j && (j.cells || j.areas || j.summary || j.counts)) || [];
  return list.map((c) => ({ lat: num(c.lat ?? c.latitude ?? (Array.isArray(c) ? c[0] : null)), lon: num(c.lon ?? c.lng ?? c.longitude ?? (Array.isArray(c) ? c[1] : null)),
    n: num(c.n ?? c.count ?? c.total ?? (Array.isArray(c) ? c[2] : null)) })).filter((c) => c.lat !== null && c.lon !== null && c.n > 0);
}
function pickMatch(list, k) {
  const norm = (s) => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  return list.find((f) => (k.hex && f.hex === k.hex) || k.callsigns.includes(norm(f.flight)) || (k.reg && norm(f.reg) === k.reg)) || (list.length === 1 ? list[0] : null);
}

// Flight numbers people type (IATA "WN1234") -> callsigns in the feed (ICAO "SWA1234"). Common airlines only.
export const IATA_ICAO = { AA: 'AAL', UA: 'UAL', DL: 'DAL', WN: 'SWA', B6: 'JBU', AS: 'ASA', NK: 'NKS', F9: 'FFT', G4: 'AAY', HA: 'HAL', SY: 'SCX',
  AC: 'ACA', WS: 'WJA', BA: 'BAW', LH: 'DLH', AF: 'AFR', KL: 'KLM', EK: 'UAE', QR: 'QTR', EY: 'ETD', TK: 'THY', FR: 'RYR', U2: 'EZY', IB: 'IBE',
  VS: 'VIR', LX: 'SWR', OS: 'AUA', SK: 'SAS', AY: 'FIN', EI: 'EIN', TP: 'TAP', AZ: 'ITY', QF: 'QFA', NZ: 'ANZ', SQ: 'SIA', CX: 'CPA', JL: 'JAL',
  NH: 'ANA', KE: 'KAL', OZ: 'AAR', AM: 'AMX', CM: 'CMP', LA: 'LAN', AV: 'AVA', WK: 'EDW', W6: 'WZZ', VY: 'VLG', '5X': 'UPS', FX: 'FDX', MX: 'MXY', XP: 'CXP' };
export const AIRLINE_NAME = { AAL: 'American', UAL: 'United', DAL: 'Delta', SWA: 'Southwest', JBU: 'JetBlue', ASA: 'Alaska', NKS: 'Spirit', FFT: 'Frontier',
  AAY: 'Allegiant', HAL: 'Hawaiian', SCX: 'Sun Country', ACA: 'Air Canada', WJA: 'WestJet', BAW: 'British Airways', DLH: 'Lufthansa', AFR: 'Air France',
  KLM: 'KLM', UAE: 'Emirates', QTR: 'Qatar Airways', ETD: 'Etihad', THY: 'Turkish Airlines', RYR: 'Ryanair', EZY: 'easyJet', IBE: 'Iberia', VIR: 'Virgin Atlantic',
  SWR: 'Swiss', QFA: 'Qantas', SIA: 'Singapore Airlines', CPA: 'Cathay Pacific', JAL: 'Japan Airlines', ANA: 'ANA', KAL: 'Korean Air', AMX: 'Aeromexico',
  UPS: 'UPS', FDX: 'FedEx', ENY: 'Envoy', SKW: 'SkyWest', RPA: 'Republic', EDV: 'Endeavor', JIA: 'PSA', ASH: 'Mesa', QXE: 'Horizon', MXY: 'Breeze', CXP: 'Avelo',
  GTI: 'Atlas Air', WZZ: 'Wizz Air', VLG: 'Vueling', EIN: 'Aer Lingus', TAP: 'TAP', SAS: 'SAS', FIN: 'Finnair', ANZ: 'Air New Zealand', AAR: 'Asiana' };
export const TYPE_NAME = { B736: '737-600', B737: '737-700', B738: '737-800', B739: '737-900', B37M: '737 MAX 7', B38M: '737 MAX 8', B39M: '737 MAX 9', B3XM: '737 MAX 10',
  A319: 'A319', A320: 'A320', A321: 'A321', A20N: 'A320neo', A21N: 'A321neo', A333: 'A330-300', A359: 'A350-900', B752: '757-200', B763: '767-300',
  B772: '777-200', B77W: '777-300ER', B788: '787-8', B789: '787-9', B78X: '787-10', E75L: 'E175', E170: 'E170', CRJ9: 'CRJ-900', CRJ7: 'CRJ-700', BCS3: 'A220-300', BCS1: 'A220-100', B744: '747-400', B748: '747-8' };
export const typeName = (t) => (t ? TYPE_NAME[t] || t : '');
export function airlineOf(cs) { const m = /^([A-Z]{3})\d/.exec(String(cs || '').toUpperCase()); return m ? AIRLINE_NAME[m[1]] || '' : ''; }

// What did the person type? Flight-like (callsign, flight number, tail, ICAO hex) or something else (ship, animal, place).
export function classifyQuery(q) {
  const raw = String(q || '').trim(), u = raw.toUpperCase().replace(/\s+/g, '');
  const out = { raw, flightLike: false, hex: '', callsigns: [], reg: '' };
  if (!u) return out;
  if (/^[0-9A-F]{6}$/.test(u) && !/^[A-F]{6}$/.test(u)) out.hex = u.toLowerCase();
  const cs = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(u), fn = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(u);
  if (cs) out.callsigns.push(u);
  if (fn && /[A-Z]/.test(fn[1])) { const icao = IATA_ICAO[fn[1]]; if (icao) out.callsigns.push(icao + fn[2]); out.callsigns.push(u); }
  if (/^N[1-9][0-9A-Z]{0,4}$/.test(u) || /^[A-Z0-9]{1,2}-[A-Z0-9]{3,5}$/.test(raw.toUpperCase())) out.reg = u.replace(/-/g, '');
  out.callsigns = [...new Set(out.callsigns)];
  out.flightLike = !!(out.hex || out.callsigns.length || out.reg);
  return out;
}
// Local search among loaded things. items: [{ kind, id, label, keys: [strings], lat, lon, ref }]
export function searchLocal(items, q, limit = 8) {
  const u = String(q || '').trim().toUpperCase(); if (!u) return [];
  const k = classifyQuery(q), nu = u.replace(/[\s-]/g, '');
  const scored = [];
  for (const it of items) {
    let best = 0;
    for (const key of it.keys) {
      const K = String(key || '').toUpperCase(), nK = K.replace(/[\s-]/g, ''); if (!nK) continue;
      if (nK === nu || k.callsigns.includes(nK)) best = Math.max(best, 3);
      else if (nK.startsWith(nu) || K.split(/\s+/).some((w) => w.startsWith(u))) best = Math.max(best, 2);
      else if (nu.length >= 3 && nK.includes(nu)) best = Math.max(best, 1);
    }
    if (best) scored.push([best, it]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

// Ships: relay /ais/snapshot (if present). Accepts { ships:[...] } / { vessels:[...] } / array, aisstream-like or flat fields.
export function parseShips(j, receivedAt = Date.now()) {
  const list = Array.isArray(j) ? j : (j && (j.ships || j.vessels || j.data)) || [];
  return list.map((s) => {
    const m = s.MetaData || s.meta || {}, p = (s.Message && (s.Message.PositionReport || s.Message.StandardClassBPositionReport)) || s;
    const lat = num(p.lat ?? p.Latitude ?? m.latitude), lon = num(p.lon ?? p.Longitude ?? m.longitude);
    if (lat === null || lon === null) return null;
    const t = s.at ?? s.time ?? s.ts ?? m.time_utc;
    const at = t == null ? receivedAt : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(String(t).replace(' +0000 UTC', 'Z').replace(/(\.\d{3})\d+/, '$1'));
    return { mmsi: str(s.mmsi ?? m.MMSI ?? p.UserID), name: str(s.name ?? s.shipName ?? m.ShipName).replace(/@+$/, '').trim(), lat, lon,
      sog: num(p.sog ?? p.Sog), cog: num(p.cog ?? p.Cog ?? p.heading ?? p.TrueHeading), type: str(s.type ?? s.shipType), dest: str(s.dest ?? s.destination),
      fixAt: Number.isFinite(at) ? at : receivedAt };
  }).filter(Boolean);
}
export const AIS_MAX_BOX_DEG = 6;
export async function loadShips(b, { fetchFn = (u, o) => fetch(u, o), state = {}, onSite = ON_SITE } = {}) {
  if (!onSite) state.snapshot = false;           // the relay answers CORS only for the GitHub site
  if (state.snapshot === false) return null;
  const width = b.e - b.w >= 360 ? 360 : (b.e - b.w + 360) % 360 || 360, height = b.n - b.s;
  if (width > 40 || height > 30) return { tooWide: true, ships: [] };
  // the relay takes at most 6° x 6°: a wider view loads the middle of the view (the page says so)
  let box = b, clipped = false;
  if (width > AIS_MAX_BOX_DEG || height > AIS_MAX_BOX_DEG) {
    const [la, lo] = boundsCenter(b), h = AIS_MAX_BOX_DEG / 2 - 0.01;
    box = { s: Math.max(-90, la - h), n: Math.min(90, la + h), w: lo - h, e: lo + h }; clipped = true;
  }
  try {
    const j = await getJSON(`${RELAY}/ais/snapshot?box=${box.s.toFixed(3)},${box.w.toFixed(3)},${box.n.toFixed(3)},${box.e.toFixed(3)}`, fetchFn);
    state.snapshot = true; return { ships: parseShips(j), clipped };
  } catch (e) { if (e.status === 404 || e.status === 400 || e.status === 426) state.snapshot = false; return null; }
}

// ISS: relay /iss (if present) then wheretheiss.at directly (browser-friendly, no key).
export function parseISS(j, receivedAt = Date.now()) {
  if (!j) return null;
  const p = j.iss_position || j;
  const lat = num(p.latitude ?? p.lat), lon = num(p.longitude ?? p.lon);
  if (lat === null || lon === null) return null;
  const ts = num(j.timestamp ?? j.ts);
  return { lat, lon, altKm: num(j.altitude ?? j.altKm), kmh: num(j.velocity ?? j.kmh), visibility: str(j.visibility),
    fixAt: ts !== null ? (ts < 1e12 ? ts * 1000 : ts) : receivedAt };
}
export async function loadISS({ fetchFn = (u, o) => fetch(u, o), onSite = ON_SITE, state = {} } = {}) {
  const urls = [];
  if (onSite && state.relay !== false) urls.push(['relay', `${RELAY}/iss`]);
  urls.push(['wheretheiss.at', 'https://api.wheretheiss.at/v1/satellites/25544']);
  for (const [name, u] of urls) {
    try { const iss = parseISS(await getJSON(u, fetchFn)); if (iss) { if (name === 'relay') state.relay = true; return { ...iss, source: name === 'relay' ? 'wheretheiss.at via I\'M HERE relay' : name }; } }
    catch (e) { if (name === 'relay' && (e.status === 404 || e.status === 400)) state.relay = false; }
  }
  return null;
}

// Screen-space grid clustering. pts: [{ x, y, ... }] -> [{ x, y, n, items }]; single points come back with n = 1.
export function cluster(pts, cell = 56) {
  const grid = new Map();
  for (const p of pts) {
    const k = Math.floor(p.x / cell) + ',' + Math.floor(p.y / cell);
    let c = grid.get(k); if (!c) grid.set(k, (c = { sx: 0, sy: 0, n: 0, items: [] }));
    c.sx += p.x; c.sy += p.y; c.n++; c.items.push(p);
  }
  // second pass: merge neighbours whose bubbles would overlap (grid edges split dense spots)
  const out = [];
  for (const c of [...grid.values()].map((c) => ({ x: c.sx / c.n, y: c.sy / c.n, n: c.n, items: c.items })).sort((a, b) => b.n - a.n)) {
    const near = out.find((o) => Math.hypot(o.x - c.x, o.y - c.y) < cell * 0.75);
    if (!near) { out.push(c); continue; }
    near.x = (near.x * near.n + c.x * c.n) / (near.n + c.n); near.y = (near.y * near.n + c.y * c.n) / (near.n + c.n);
    near.n += c.n; near.items.push(...c.items);
  }
  return out;
}

// Dead reckoning for the map between refreshes (at most 30 s past the last report, like the cockpit).
export function predict(f, now = Date.now()) {
  const t = Math.max(0, Math.min(f.extrapS || 30, (now - f.fixAt) / 1000));   // FR24 fixes (every 20 s) carry extrapS
  if (!f.gs || f.track === null || f.onGround) return [f.lat, f.lon];
  const d = f.gs * 0.514444 * t, tr = f.track * Math.PI / 180, R = 6371008.8;
  return [f.lat + (d * Math.cos(tr)) / R * 180 / Math.PI, f.lon + (d * Math.sin(tr)) / (R * Math.cos(f.lat * Math.PI / 180)) * 180 / Math.PI];
}

// The 737 page link for one flight.
export function joinURL(f, base = '../737/') {
  const p = new URLSearchParams();
  p.set('flight', f.hex || (f.flight || f.reg || '').replace(/\s+/g, ''));
  if (f.flight) p.set('cs', f.flight.replace(/\s+/g, ''));
  p.set('lat', f.lat.toFixed(3)); p.set('lon', f.lon.toFixed(3));
  return base + '?' + p.toString();
}

// ------------------------------------------------------------------ card extras: route, aircraft photo, species photo
// Route (origin -> destination) for a callsign: relay /route?callsign= first on the GitHub site (when it answers), then
// adsbdb directly (https://api.adsbdb.com/v0/callsign/<cs>). Routes are looked up by callsign, so they can be out of date.
// Shapes read loosely: adsbdb { response: { flightroute: { origin: { iata_code, icao_code, municipality }, destination, airline } } },
// or { route | flightroute: ... }, or flat { orig/origin, dest/destination } with codes or objects.
const apCode = (a) => (a == null ? '' : typeof a === 'string' ? a.trim().toUpperCase() : str(a.iata_code ?? a.iata ?? a.icao_code ?? a.icao ?? a.code).toUpperCase());
const apCity = (a) => (a && typeof a === 'object' ? str(a.municipality ?? a.city ?? a.name) : '');
export function parseRoute(j) {
  if (!j || typeof j !== 'object') return null;
  const r = (j.response && typeof j.response === 'object' && (j.response.flightroute || j.response.route)) || j.flightroute || j.route || j;
  if (!r || typeof r !== 'object') return null;
  const o = r.origin ?? r.orig ?? r.from ?? r.dep ?? r.departure, d = r.destination ?? r.dest ?? r.to ?? r.arr ?? r.arrival;
  const orig = apCode(o), dest = apCode(d);
  if (!orig || !dest) return null;
  const al = r.airline && typeof r.airline === 'object' ? r.airline : null;
  return { orig, dest, origCity: apCity(o), destCity: apCity(d), airline: al ? str(al.name) : str(r.airline_name ?? r.airline),
    flightIata: str(r.callsign_iata ?? r.flight_iata ?? r.iata) };
}
// Planespotters photo of one airframe (https://api.planespotters.net/pub/photos/hex/<hex>): thumbnail only, with the
// photographer and the link back to the photo page, as their terms ask. Relay /photo?hex= first on the GitHub site.
export function parsePhoto(j) {
  const p = j && Array.isArray(j.photos) ? j.photos[0] : j && j.photo ? j.photo : null;
  if (!p) return null;
  const th = p.thumbnail || p.thumb || {}, src = str(th.src ?? th.url ?? (typeof p.thumbnail === 'string' ? p.thumbnail : ''));
  if (!/^https:\/\//.test(src)) return null;
  const size = th.size || {};
  return { src, w: num(size.width ?? th.width) || 200, h: num(size.height ?? th.height) || 133, link: /^https:\/\//.test(str(p.link)) ? str(p.link) : 'https://www.planespotters.net/',
    by: str(p.photographer ?? p.author) || 'unknown photographer' };
}
// Species photo for the SAMPLE wildlife tracks: the lead image of the species' Wikipedia article, from Wikimedia Commons,
// with the author and licence from Commons. Only a species picture: never a photo of the (made-up) tagged animal.
const stripTags = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
export function parseCommonsInfo(j) {
  const pages = j && j.query && j.query.pages, pg = pages && Object.values(pages)[0], ii = pg && pg.imageinfo && pg.imageinfo[0];
  if (!ii) return null;
  const src = str(ii.thumburl || ii.url); if (!/^https:\/\//.test(src)) return null;
  const m = ii.extmetadata || {}, v = (k) => (m[k] && m[k].value) || '';
  return { src, link: str(ii.descriptionurl) || 'https://commons.wikimedia.org/', by: stripTags(v('Artist')).slice(0, 80) || 'see Wikimedia Commons',
    license: stripTags(v('LicenseShortName')).slice(0, 40), licenseUrl: str(v('LicenseUrl')) };
}
export class CardLookups {
  constructor({ fetchFn = (u, o) => fetch(u, o), onSite = ON_SITE } = {}) {
    this.fetchFn = fetchFn; this.onSite = onSite; this.relay = { route: onSite ? null : false, photo: onSite ? null : false };
    this.cache = new Map();
  }
  // relay first (if it has the route and answers), then the direct API. A 404 from the relay means "no such route on it".
  async _try(kind, relayUrl, directUrl, parse) {
    if (this.relay[kind] !== false) {
      try { const j = await getJSON(relayUrl, this.fetchFn, 5000), v = parse(j); this.relay[kind] = true;
        if (v || (j && j.found === false)) return { v, via: 'relay' }; }   // the relay asked upstream already: "none on file" is an answer
      catch (e) { if (e.status === 404 && this.relay[kind] === null) this.relay[kind] = false; }
    }
    const v = parse(await getJSON(directUrl, this.fetchFn, 6000)); return { v, via: 'direct' };
  }
  _memo(key, fn) {   // one request per key; a failure is retried after a minute
    const c = this.cache.get(key); if (c && (c.ok || Date.now() - c.at < 60000)) return c.p;
    const e = { at: Date.now(), ok: false, settled: false };
    e.p = fn().then((r) => { e.ok = true; e.settled = true; return r; }, () => { e.settled = true; return null; }); this.cache.set(key, e); return e.p;
  }
  peek(key) { const c = this.cache.get(key); return c && c.ok ? c.val : undefined; }
  state(key) { const c = this.cache.get(key); return !c ? 'none' : !c.settled ? 'wait' : c.ok ? 'ok' : 'fail'; }   // fail: not reachable
  route(callsign) {
    const cs = String(callsign || '').toUpperCase().replace(/\s+/g, ''); if (!/^[A-Z0-9]{3,8}$/.test(cs)) return Promise.resolve(null);
    const key = 'route:' + cs;
    return this._memo(key, async () => { const r = await this._try('route', `${RELAY}/route?callsign=${cs}`, `https://api.adsbdb.com/v0/callsign/${cs}`, parseRoute);
      const val = r.v ? { ...r.v, via: r.via } : null; this.cache.get(key).val = val; return val; });
  }
  photo(hex) {
    const h = String(hex || '').toLowerCase(); if (!/^[0-9a-f]{6}$/.test(h)) return Promise.resolve(null);
    const key = 'photo:' + h;
    return this._memo(key, async () => { const r = await this._try('photo', `${RELAY}/photo?hex=${h}`, `https://api.planespotters.net/pub/photos/hex/${h}`, parsePhoto);
      this.cache.get(key).val = r.v; return r.v; });
  }
  species(wikiTitle) {
    const t = String(wikiTitle || ''); if (!t) return Promise.resolve(null);
    const key = 'species:' + t;
    return this._memo(key, async () => {
      const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=name&titles=${encodeURIComponent(t)}`, this.fetchFn);
      const pg = j && j.query && j.query.pages && Object.values(j.query.pages)[0], file = pg && pg.pageimage;
      if (!file) { this.cache.get(key).val = null; return null; }
      const info = parseCommonsInfo(await getJSON('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=320&titles=' +
        encodeURIComponent('File:' + file), this.fetchFn));
      this.cache.get(key).val = info; return info;
    });
  }
}
// "Southwest 1234" from SWA1234; null when the callsign is not airline-style or the airline is not known.
export function flightTitle(cs, airlineName = '') {
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(String(cs || '').toUpperCase().replace(/\s+/g, ''));
  if (!m) return null;
  const name = AIRLINE_NAME[m[1]] || airlineName.replace(/\s+(Air ?lines|Airways)$/i, '') || '';
  return name ? { airline: name, number: m[2], text: name + ' ' + m[2] } : null;
}

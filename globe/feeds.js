// I'M HERE globe: data layer (pure module: no DOM). Flights, ships, ISS, search helpers, clustering.
// Tested in Node: node globe/test/feeds-test.mjs
//
// Flights, in order (first that answers wins; each answer remembers what worked so the next refresh goes straight there):
//   1. relay /flights/area   (I'M HERE Worker; GitHub site only, CORS is locked to it). Shape: ADS-B Exchange v2 { ac:[...] }
//      or { flights:[...] } or a bare array; field names are read loosely (see normFlight).
//   2. the 737 page's point sources (737/live-flights.js): relay /lat/../lon/../dist/.., airplanes.live, adsb.lol, OpenSky.
//      A point query reaches at most 250 nm, so a wide view loads around its centre only (the page says so).
//   /flights/summary (if the relay has it) gives counts for views too wide to load aircraft.
// Nothing is invented: a value the feed did not send stays null and the card says "not in the feed".
import { SOURCES, RELAY, COCKPIT_737, parseV2, parseOpenSky, distNm } from '../737/live-flights.js';
export { RELAY, COCKPIT_737, distNm };

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
export const isLive = (f, now = Date.now()) => ageS(f, now) < FRESH_S;

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

// Flight loader with memory of what works. One instance per page.
export class FlightFeed {
  constructor({ fetchFn = (u, o) => fetch(u, o), onSite = ON_SITE, sources = SOURCES } = {}) {
    this.fetchFn = fetchFn; this.onSite = onSite; this.sources = sources;
    this.relayArea = onSite ? null : false;      // null = unknown, true/false once tried
    this.relaySummary = onSite ? null : false;
    this.relayFind = onSite ? null : false;
    this.pointPref = null;                        // name of the point source that answered last
  }
  // -> { source, flights, coverage: 'view' | { lat, lon, nm } , note }
  async load(b) {
    const errs = [];
    const radius = boundsRadiusNm(b);
    if (this.relayArea !== false && radius < 1500) {
      try {
        const j = await getJSON(areaURL(b), this.fetchFn), t = Date.now();
        this.relayArea = true;
        return { source: 'I\'M HERE relay (adsb.lol / adsb.fi)', flights: parseFlights(j, t), coverage: 'view' };
      } catch (e) { if (e.status === 404 || e.status === 400) this.relayArea = false; errs.push('relay area: ' + e.message); }
    }
    const [la, lo] = boundsCenter(b), nm = Math.max(5, Math.min(POINT_MAX_NM, Math.ceil(radius)));
    const order = this.pointPref ? [...this.sources].sort((x, y) => (y.name === this.pointPref) - (x.name === this.pointPref)) : this.sources;
    for (const s of order) {
      try {
        const j = await getJSON(s.point(la, lo, nm), this.fetchFn), t = Date.now();
        this.pointPref = s.name;
        const flights = (s.opensky ? parseOpenSky(j, t).map((f) => ({ ...f, orig: '', dest: '' })) : parseFlights(j, t));
        return { source: s.name, flights, coverage: radius > POINT_MAX_NM ? { lat: la, lon: lo, nm } : 'view' };
      } catch (e) { errs.push(s.name + ': ' + e.message); }
    }
    const err = new Error('No live flight source reachable (' + errs.join('; ') + ')'); err.all = errs; throw err;
  }
  // World/region counts for wide views, if the relay has /flights/summary. -> [{ lat, lon, n }] or null
  async summary(b) {
    if (this.relaySummary === false) return null;
    try {
      const f = (x) => (+x).toFixed(2);
      const j = await getJSON(`${RELAY}/flights/summary?lamin=${f(b.s)}&lomin=${f(b.w)}&lamax=${f(b.n)}&lomax=${f(b.e)}`, this.fetchFn);
      this.relaySummary = true; return parseSummary(j);
    } catch (e) { if (e.status === 404 || e.status === 400) this.relaySummary = false; return null; }
  }
  // Find one flight anywhere by callsign / flight number / tail / hex. -> flight record or null
  async find(q) {
    const k = classifyQuery(q); if (!k.flightLike) return null;
    const tries = [];
    if (this.relayFind !== false) tries.push({ url: `${RELAY}/flights/find?q=${encodeURIComponent(k.raw)}`, relay: true });
    const direct = ['https://api.airplanes.live/v2/', 'https://api.adsb.lol/v2/'];
    for (const base of direct) {
      if (k.hex) tries.push({ url: base + 'hex/' + k.hex });
      for (const cs of k.callsigns) tries.push({ url: base + 'callsign/' + cs });
      if (k.reg) tries.push({ url: base + 'reg/' + k.reg });
    }
    if (this.onSite && k.hex) tries.unshift({ url: `${RELAY}/hex/${k.hex}` });
    for (const t of tries) {
      try {
        const j = await getJSON(t.url, this.fetchFn, 6000), list = Array.isArray(j) || j.ac || j.aircraft || j.flights ? parseFlights(j) : [normFlight(j.flight || j, Date.now())].filter(Boolean);
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
  const t = Math.max(0, Math.min(30, (now - f.fixAt) / 1000));
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

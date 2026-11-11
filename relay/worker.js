// I'M HERE relay (Cloudflare Worker "imhere-flights"). Answers CORS only for the GitHub Pages site (SITE).
//
// Flights (each upstream tried in order with a short timeout: adsb.lol, adsb.fi, airplanes.live, then OpenSky anonymous;
// answers are cached about 5 s; if every upstream fails, the last good answer is served with stale:true and age_s):
//   GET /lat/<lat>/lon/<lon>/dist/<nm>, /hex/<hex>  (pages' original paths) -> ADS-B Exchange v2 shape { ac:[...], now, ... }
//   GET /flights/area?lat&lon&r  (r in nm, max 250; or bbox=s,w,n,e / lamin..lomax: centre + radius, clipped to 250 nm)
//   GET /flights/summary?bbox=s,w,n,e  -> grid counts { cells:[{lat,lon,n}], cell_deg, total }
//   GET /flights/find?q=  (ICAO hex, callsign, flight number like WN1234, or registration)
//   GET /flights/probe  -> which upstreams answer from here right now (diagnostic)
//   New flight routes answer { ok, source, now, count, flights:[{ hex, callsign, type, reg, lat, lon, alt_ft, gs_kt, track,
//   vs_fpm, on_ground, seen_s }] }; each flight also carries alt, gs, vr, seen (same values, names the globe page reads).
// Other:
//   GET /route?callsign=   -> adsbdb.com route (origin/destination with IATA/ICAO and names), cached 1 h
//   GET /photo?hex=|reg=   -> planespotters.net photo links with photographer + link for credit, cached 1 day.
//                             Planespotters' rules: show the photographer's name and link to the photo page; use the
//                             image URLs as given (not re-hosted or altered). This relay only passes the links on.
//   GET /iss               -> wheretheiss.at ISS position, cached about 3 s
//   GET /ais/snapshot?box=lat1,lon1,lat2,lon2 -> listens to aisstream for up to about 6 s, compact vessel list, cached 30 s
//   GET /metar/<ICAO>      -> aviationweather.gov METAR (used only if the browser cannot reach it)
//   wss /ais?box=...       -> aisstream PositionReport + ShipStaticData passed through (secret AISSTREAM_KEY stays here)
//   GET /ais/status, /ais/probe
// Errors are JSON in plain words: { ok:false, error:"..." }.
const SITE = "https://dareklaviolette-eng.github.io";
const UA = "imhere-prototype/1.0 (I'M HERE relay; +https://dareklaviolette-eng.github.io)";
const ALLOWED = /^\/(lat\/(-?[\d.]+)\/lon\/(-?[\d.]+)\/dist\/(\d+)|hex\/([0-9a-fA-F]{6}))$/;
const METAR = /^\/metar\/([A-Za-z0-9]{3,4})$/;
const AIS_UPSTREAM = "https://stream.aisstream.io/v0/stream";
const AIS_MAX_BOX_DEG = 6;
const MAX_NM = 250;
const FLIGHT_FRESH_S = 5, FLIGHT_KEEP_S = 900;

// ---------- small helpers ----------
const num = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" ? null : Number.isFinite(+v) ? +v : null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const words = (e) => String((e && e.message) || e || "unknown problem");
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status: status || 200, headers }); }
function oops(status, error, headers, extra) { return json(Object.assign({ ok: false, error }, extra || {}), status, headers); }
function httpWords(s) {
  return "HTTP " + s + (s === 429 ? " (rate limited)" : s === 403 ? " (refused)" : s === 404 ? " (not found)" : s >= 500 ? " (their server had a problem)" : "");
}
function timeoutMs(env, dflt) { const t = num(env && env.UPSTREAM_TIMEOUT_MS); return t && t > 0 ? t : dflt; }

// Fetch with a hard time limit that covers the body too. -> { status, ok, text }. Throws in plain words.
async function getText(url, ms, init) {
  const ac = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => { try { ac && ac.abort(); } catch (e) {} reject(new Error("no answer within " + (ms / 1000) + " s")); }, ms); });
  const work = (async () => {
    const reply = await fetch(url, Object.assign({}, init || {}, { signal: ac ? ac.signal : undefined,
      headers: Object.assign({ "User-Agent": UA, Accept: "application/json" }, (init && init.headers) || {}) }));
    return { status: reply.status, ok: !!reply.ok, text: await reply.text() };
  })();
  try { return await Promise.race([work, limit]); }
  catch (e) { if (e && e.name === "AbortError") throw new Error("no answer within " + (ms / 1000) + " s"); throw new Error(/no answer within/.test(words(e)) ? words(e) : "could not connect (" + words(e) + ")"); }
  finally { clearTimeout(timer); work.catch(() => {}); }
}
async function getJSON(url, ms, init) {
  const r = await getText(url, ms, init);
  if (!r.ok) { const e = new Error(httpWords(r.status)); e.status = r.status; e.text = r.text; throw e; }
  try { return JSON.parse(r.text); } catch (e) { throw new Error("answered with something that is not JSON"); }
}

// ---------- cache: in-memory (always works) + Cache API (works where the Worker has a cache) ----------
// Entries live for keep_s so they can be served as stale when every upstream fails.
const MEM = new Map();
const MEM_MAX = 400;
const CACHE_ORIGIN = "https://imhere-relay-cache.invalid/";
function memSet(key, e) { MEM.delete(key); MEM.set(key, e); while (MEM.size > MEM_MAX) MEM.delete(MEM.keys().next().value); }
function edgeCache() { try { return typeof caches !== "undefined" && caches && caches.default ? caches.default : null; } catch (e) { return null; } }
async function cacheGet(key, keepS) {
  const m = MEM.get(key);
  if (m && (Date.now() - m.at) / 1000 < m.keep) return m;
  const c = edgeCache(); if (!c) return null;
  try {
    const r = await c.match(new Request(CACHE_ORIGIN + encodeURIComponent(key)));
    if (!r) return null;
    const e = { at: +r.headers.get("x-at") || 0, keep: keepS, data: await r.json() };
    if ((Date.now() - e.at) / 1000 >= keepS) return null;
    memSet(key, e); return e;
  } catch (e) { return null; }
}
async function cachePut(key, e) {
  memSet(key, e);
  const c = edgeCache(); if (!c) return;
  try {
    await c.put(new Request(CACHE_ORIGIN + encodeURIComponent(key)), new Response(JSON.stringify(e.data),
      { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + Math.round(e.keep), "x-at": String(e.at) } }));
  } catch (x) {}
}
// -> { data, age_s, stale, why? }. Fresh hit, else produce(); on failure the last good data (stale) or throw.
async function cached(key, freshS, keepS, produce) {
  const hit = await cacheGet(key, keepS);
  const age = hit ? Math.max(0, (Date.now() - hit.at) / 1000) : null;
  if (hit && age < freshS) return { data: hit.data, age_s: age, stale: false };
  try {
    const data = await produce(hit && hit.data);
    await cachePut(key, { at: Date.now(), keep: keepS, data });
    return { data, age_s: 0, stale: false };
  } catch (err) {
    if (hit && !err.noStale) return { data: hit.data, age_s: age, stale: true, why: words(err) };
    throw err;
  }
}

// ---------- flight upstreams ----------
const V2 = [
  { name: "adsb.lol", base: "https://api.adsb.lol/v2/", area: (la, lo, r) => `lat/${la}/lon/${lo}/dist/${r}`, reg: "reg/" },
  { name: "adsb.fi", base: "https://opendata.adsb.fi/api/v2/", area: (la, lo, r) => `lat/${la}/lon/${lo}/dist/${r}`, reg: "registration/" },
  { name: "airplanes.live", base: "https://api.airplanes.live/v2/", area: (la, lo, r) => `point/${la}/${lo}/${r}`, reg: "reg/" },
];
const OPENSKY = "https://opensky-network.org/api/states/all";

function v2List(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const list = j.ac !== undefined ? j.ac : j.aircraft;
  if (list === null) return [];
  return Array.isArray(list) ? list : null;
}
function normV2(a) {
  const lat = num(a && a.lat), lon = num(a && a.lon);
  if (lat === null || lon === null) return null;
  const ground = a.alt_baro === "ground";
  const alt = ground ? 0 : num(a.alt_baro) ?? num(a.alt_geom);
  return { hex: String(a.hex || "").toLowerCase().replace(/^~/, ""), callsign: String(a.flight || "").trim() || null,
    type: String(a.t || "").trim().toUpperCase() || null, reg: String(a.r || "").trim() || null, lat, lon,
    alt_ft: alt === null ? null : Math.round(alt), gs_kt: r1(num(a.gs)), track: r1(num(a.track) ?? num(a.true_heading)),
    vs_fpm: num(a.baro_rate) ?? num(a.geom_rate), on_ground: ground, seen_s: r1(num(a.seen_pos) ?? num(a.seen) ?? 0) };
}
function normOpenSky(j) {
  const t = num(j && j.time) ?? Date.now() / 1000;
  return ((j && j.states) || []).map((s) => {
    const lat = num(s[6]), lon = num(s[5]);
    if (lat === null || lon === null) return null;
    const altM = num(s[7]) ?? num(s[13]), gs = num(s[9]), vs = num(s[11]);
    return { hex: String(s[0] || "").toLowerCase(), callsign: String(s[1] || "").trim() || null, type: null, reg: null, lat, lon,
      alt_ft: s[8] ? 0 : altM === null ? null : Math.round(altM / 0.3048), gs_kt: gs === null ? null : r1(gs / 0.514444),
      track: r1(num(s[10])), vs_fpm: vs === null ? null : Math.round(vs / 0.3048 * 60), on_ground: !!s[8],
      seen_s: r1(Math.max(0, t - (num(s[3]) ?? num(s[4]) ?? t))) };
  }).filter(Boolean);
}
// Normalized record -> ADS-B Exchange v2 record (for the original paths when only OpenSky answered)
function toV2(f) {
  return { hex: f.hex, flight: f.callsign || "", r: f.reg || undefined, t: f.type || undefined, lat: f.lat, lon: f.lon,
    alt_baro: f.on_ground ? "ground" : f.alt_ft, gs: f.gs_kt, track: f.track, baro_rate: f.vs_fpm, seen_pos: f.seen_s, seen: f.seen_s };
}
function boxAround(la, lo, nm) {
  const d = nm / 60, dl = d / Math.max(0.05, Math.cos(la * Math.PI / 180));
  return { s: Math.max(-90, la - d), n: Math.min(90, la + d), w: Math.max(-180, lo - dl), e: Math.min(180, lo + dl) };
}
function distNm(la1, lo1, la2, lo2) {
  const R = Math.PI / 180, a = Math.sin((la2 - la1) * R / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin((lo2 - lo1) * R / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// q: { kind: 'area', lat, lon, r } | { kind: 'hex', hex } | { kind: 'callsign', cs } | { kind: 'reg', reg }
// -> { source, flights:[normalized], raw?: text (v2 upstream answer, untouched) }. Throws with every upstream's reason.
async function fetchFlights(q, env, opts) {
  const ms = timeoutMs(env, 3500), errs = [];
  for (const u of V2) {
    const path = q.kind === "area" ? u.area(q.lat, q.lon, q.r) : q.kind === "hex" ? "hex/" + q.hex
      : q.kind === "callsign" ? "callsign/" + encodeURIComponent(q.cs) : u.reg + encodeURIComponent(q.reg);
    try {
      const r = await getText(u.base + path, ms);
      if (!r.ok) throw new Error(httpWords(r.status));
      let j; try { j = JSON.parse(r.text); } catch (e) { throw new Error("answered with something that is not JSON"); }
      const list = v2List(j);
      if (!list) throw new Error("answered in an unexpected shape");
      return { source: u.name, flights: list.map(normV2).filter(Boolean), raw: r.text };
    } catch (e) { errs.push(u.name + ": " + words(e)); }
  }
  if (q.kind === "area" || q.kind === "hex") {
    try {
      let url;
      if (q.kind === "hex") url = OPENSKY + "?icao24=" + q.hex;
      else { const b = boxAround(q.lat, q.lon, q.r); url = `${OPENSKY}?lamin=${b.s.toFixed(3)}&lomin=${b.w.toFixed(3)}&lamax=${b.n.toFixed(3)}&lomax=${b.e.toFixed(3)}`; }
      const j = await getJSON(url, Math.max(ms, timeoutMs(env, 5000)));
      if (!j || (j.states !== null && !Array.isArray(j.states))) throw new Error("answered in an unexpected shape");
      let flights = normOpenSky(j);
      if (q.kind === "area") flights = flights.filter((f) => distNm(q.lat, q.lon, f.lat, f.lon) <= q.r);
      return { source: "OpenSky", flights };
    } catch (e) { errs.push("OpenSky: " + words(e)); }
  } else errs.push("OpenSky: cannot search by " + (q.kind === "reg" ? "registration" : "callsign"));
  const err = new Error("No live flight feed answered (" + errs.join("; ") + ")");
  err.sources = errs;
  throw err;
}

function serveFlights(hit, extra, headers) {
  const age = hit.age_s, flights = hit.data.flights.filter((f) => !extra.filter || extra.filter(f)).map((f) => {
    const seen = r1((f.seen_s || 0) + age);
    return Object.assign({}, f, { seen_s: seen, alt: f.alt_ft, gs: f.gs_kt, vr: f.vs_fpm, seen });
  });
  const body = Object.assign({ ok: true, source: hit.data.source, now: Date.now() }, extra.info || {}, { count: flights.length, flights });
  if (hit.stale) Object.assign(body, { stale: true, age_s: Math.round(age), why: hit.why });
  return json(body, 200, withSource(headers, hit));
}
function withSource(headers, hit) {
  return Object.assign({}, headers, { "X-Relay-Source": hit.data.source || "", "X-Relay-Age": String(Math.round(hit.age_s || 0)) },
    hit.stale ? { "X-Relay-Stale": "1" } : {});
}
const flightKey = (q) => "fl:" + (q.kind === "area" ? `a:${q.lat},${q.lon},${q.r}` : q.kind === "hex" ? "h:" + q.hex : q.kind === "callsign" ? "c:" + q.cs : "r:" + q.reg);
const getFlights = (q, env) => cached(flightKey(q), FLIGHT_FRESH_S, FLIGHT_KEEP_S, async () => {
  const r = await fetchFlights(q, env);
  return { source: r.source, flights: r.flights };
});

// Original paths: answer in the ADS-B Exchange v2 shape the 737 / live / ride pages parse.
async function legacyFlights(m, env, headers) {
  const q = m[5] ? { kind: "hex", hex: m[5].toLowerCase() }
    : { kind: "area", lat: +(+m[2]).toFixed(4), lon: +(+m[3]).toFixed(4), r: Math.max(1, Math.min(MAX_NM, +m[4])) };
  if (q.kind === "area" && !(Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180)) return oops(400, "lat must be -90..90 and lon -180..180", headers);
  let hit;
  try {
    hit = await cached("v2:" + flightKey(q), FLIGHT_FRESH_S, FLIGHT_KEEP_S, async () => {
      const r = await fetchFlights(q, env);
      return { source: r.source, raw: r.raw || JSON.stringify({ ac: r.flights.map(toV2), now: Date.now(), msg: "converted from OpenSky" }) };
    });
  } catch (e) { return oops(502, words(e), headers, { sources: e.sources }); }
  const h = withSource(headers, hit);
  if (!hit.stale && hit.age_s < 0.5) return new Response(hit.data.raw, { headers: h });
  // From cache: add the cache age to each aircraft's "seen" so the page knows how old the position is.
  let j; try { j = JSON.parse(hit.data.raw); } catch (e) { return oops(502, "cached flight data was unreadable", headers); }
  const age = hit.age_s, list = v2List(j) || [];
  for (const a of list) {
    if (num(a.seen_pos) !== null) a.seen_pos = r1(+a.seen_pos + age);
    if (num(a.seen) !== null) a.seen = r1(+a.seen + age);
    if (num(a.seen_pos) === null && num(a.seen) === null) a.seen_pos = r1(age);
  }
  j.now = Date.now();
  if (hit.stale) Object.assign(j, { stale: true, age_s: Math.round(age), why: hit.why });
  return json(j, 200, h);
}

// ---------- /flights/* parameters ----------
function parseBBox(sp) {
  let v = null;
  if (sp.get("bbox")) v = sp.get("bbox").split(",").map(Number);
  else if (sp.has("lamin")) v = ["lamin", "lomin", "lamax", "lomax"].map((k) => Number(sp.get(k)));
  if (!v || v.length !== 4 || !v.every(Number.isFinite)) return null;
  const [s, w, n, e] = v;
  if (s >= n || Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) return null;
  return { s, w, n, e };
}
function bboxCenter(b) { let e = b.e; if (e < b.w) e += 360; let lo = (b.w + e) / 2; if (lo > 180) lo -= 360; return [(b.s + b.n) / 2, lo]; }
function inBBox(b, lat, lon) {
  if (lat < b.s || lat > b.n) return false;
  return b.w <= b.e ? lon >= b.w && lon <= b.e : lon >= b.w || lon <= b.e;
}
function bboxRadius(b) { const [la, lo] = bboxCenter(b); return Math.max(distNm(la, lo, b.n, b.w), distNm(la, lo, b.s, b.e), distNm(la, lo, b.n, b.e), distNm(la, lo, b.s, b.w)); }
const BBOX_HELP = "bbox must be south,west,north,east in degrees (or lamin, lomin, lamax, lomax)";

async function flightsArea(url, env, headers) {
  const sp = url.searchParams;
  let lat, lon, r, bbox = null;
  if (sp.has("lat") || sp.has("lon")) {
    lat = num(sp.get("lat")); lon = num(sp.get("lon")); r = sp.has("r") ? num(sp.get("r")) : 100;
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return oops(400, "lat and lon must be numbers (lat -90..90, lon -180..180)", headers);
    if (r === null || r <= 0) return oops(400, "r is the radius in nautical miles (1 to " + MAX_NM + ")", headers);
  } else {
    bbox = parseBBox(sp);
    if (!bbox) return oops(400, "give lat, lon and r (nautical miles, max " + MAX_NM + "), or " + BBOX_HELP, headers);
    [lat, lon] = bboxCenter(bbox); r = bboxRadius(bbox);
  }
  const want = r, clipped = r > MAX_NM;
  const q = { kind: "area", lat: +lat.toFixed(2), lon: +lon.toFixed(2), r: Math.max(1, Math.min(MAX_NM, Math.ceil(r))) };
  let hit;
  try { hit = await getFlights(q, env); } catch (e) { return oops(502, words(e), headers, { sources: e.sources }); }
  return serveFlights(hit, {
    filter: (f) => (bbox ? inBBox(bbox, f.lat, f.lon) : true) && distNm(lat, lon, f.lat, f.lon) <= Math.min(want, MAX_NM) + 1,
    info: { center: { lat: q.lat, lon: q.lon }, r_nm: q.r, clipped, coverage: { lat: q.lat, lon: q.lon, nm: q.r } },
  }, headers);
}

const NICE_CELLS = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 30];
async function flightsSummary(url, env, headers) {
  const b = parseBBox(url.searchParams);
  if (!b) return oops(400, BBOX_HELP, headers);
  const width = b.w <= b.e ? b.e - b.w : b.e - b.w + 360, height = b.n - b.s;
  const cell = NICE_CELLS.find((c) => c >= Math.max(width, height) / 16) || 30;
  const radius = bboxRadius(b);
  let hit, points, partial = null;
  const fromArea = async () => {
    const [la, lo] = bboxCenter(b);
    const q = { kind: "area", lat: +la.toFixed(2), lon: +lo.toFixed(2), r: Math.max(1, Math.min(MAX_NM, Math.ceil(radius))) };
    if (radius > MAX_NM) partial = { lat: q.lat, lon: q.lon, nm: q.r };
    const h = await getFlights(q, env);
    return { hit: h, points: h.data.flights.map((f) => [f.lat, f.lon]) };
  };
  try {
    if (radius <= MAX_NM) ({ hit, points } = await fromArea());
    else {
      try {
        // The whole world from OpenSky (anonymous: few calls a day), cached 10 min, kept 1 h for stale answers.
        hit = await cached("sum:world", 600, 3600, async () => {
          const j = await getJSON(OPENSKY, timeoutMs(env, 9000));
          if (!j || !Array.isArray(j.states)) throw new Error("OpenSky answered in an unexpected shape");
          return { source: "OpenSky", points: j.states.filter((s) => num(s[6]) !== null && num(s[5]) !== null).map((s) => [+(+s[6]).toFixed(2), +(+s[5]).toFixed(2)]) };
        });
        points = hit.data.points;
      } catch (e) {
        try { ({ hit, points } = await fromArea()); }
        catch (e2) { throw new Error("No flight feed answered for counts (OpenSky: " + words(e) + "; nearby feeds: " + words(e2) + ")"); }
      }
    }
  } catch (e) { return oops(502, words(e), headers); }
  const grid = new Map();
  let total = 0;
  for (const [la, lo] of points) {
    if (!inBBox(b, la, lo)) continue;
    total++;
    const k = Math.floor(la / cell) + "," + Math.floor(lo / cell);
    const c = grid.get(k) || { sl: 0, so: 0, n: 0 };
    c.sl += la; c.so += lo; c.n++; grid.set(k, c);
  }
  const cells = [...grid.values()].map((c) => ({ lat: +(c.sl / c.n).toFixed(2), lon: +(c.so / c.n).toFixed(2), n: c.n }));
  const body = { ok: true, source: hit.data.source, now: Date.now(), cell_deg: cell, total, cells };
  if (partial) Object.assign(body, { partial: true, coverage: partial });
  if (hit.stale) Object.assign(body, { stale: true, age_s: Math.round(hit.age_s), why: hit.why });
  return json(body, 200, withSource(headers, hit));
}

// Common airlines: flight number people type (IATA "WN1234") -> callsign in the feeds (ICAO "SWA1234")
const IATA_ICAO = { AA: "AAL", UA: "UAL", DL: "DAL", WN: "SWA", B6: "JBU", AS: "ASA", NK: "NKS", F9: "FFT", G4: "AAY", HA: "HAL", SY: "SCX",
  AC: "ACA", WS: "WJA", BA: "BAW", LH: "DLH", AF: "AFR", KL: "KLM", EK: "UAE", QR: "QTR", EY: "ETD", TK: "THY", FR: "RYR", U2: "EZY", IB: "IBE",
  VS: "VIR", LX: "SWR", OS: "AUA", SK: "SAS", AY: "FIN", EI: "EIN", TP: "TAP", AZ: "ITY", QF: "QFA", NZ: "ANZ", SQ: "SIA", CX: "CPA", JL: "JAL",
  NH: "ANA", KE: "KAL", OZ: "AAR", AM: "AMX", CM: "CMP", LA: "LAN", AV: "AVA", W6: "WZZ", VY: "VLG", "5X": "UPS", FX: "FDX", MX: "MXY", XP: "CXP", VA: "VOZ", JQ: "JST" };
function classify(raw) {
  const u = raw.toUpperCase().replace(/\s+/g, ""), tries = [];
  if (/^[0-9A-F]{6}$/.test(u)) tries.push({ kind: "hex", hex: u.toLowerCase() });
  if (/^[A-Z]{3}\d{1,4}[A-Z]{0,2}$/.test(u)) tries.push({ kind: "callsign", cs: u });
  const fn = /^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/.exec(u);
  if (fn && /[A-Z]/.test(fn[1]) && IATA_ICAO[fn[1]]) tries.push({ kind: "callsign", cs: IATA_ICAO[fn[1]] + fn[2] });
  if (/^N[1-9][0-9A-Z]{0,4}$/.test(u) || /^[A-Z0-9]{1,2}-[A-Z0-9]{2,5}$/.test(u)) tries.push({ kind: "reg", reg: u });
  else if (/^[A-Z0-9]{2,8}$/.test(u) && !tries.some((t) => t.kind === "callsign") && /[A-Z]/.test(u) && /\d/.test(u)) tries.push({ kind: "callsign", cs: u });
  return tries;
}
async function flightsFind(url, env, headers) {
  const raw = String(url.searchParams.get("q") || "").trim();
  if (!raw || raw.length > 12) return oops(400, "q is a flight to look for: ICAO hex (a1b2c3), callsign (SWA1234), flight number (WN1234) or registration (N8710M)", headers);
  const tries = classify(raw);
  if (!tries.length) return oops(400, "\"" + raw + "\" does not look like a hex code, callsign, flight number or registration", headers);
  const deadline = Date.now() + 15000, errs = [];
  let answered = null;
  for (const q of tries) {
    if (Date.now() > deadline) { errs.push("stopped: took too long"); break; }
    try {
      const hit = await getFlights(q, env);
      answered = answered || hit;
      if (hit.data.flights.length) return serveFlights(hit, { info: { q: raw, matched: q } }, headers);
    } catch (e) { errs.push(words(e)); }
  }
  if (!answered) return oops(502, errs.join("; ") || "No live flight feed answered", headers);
  return json({ ok: true, q: raw, source: answered.data.source, now: Date.now(), count: 0, flights: [],
    note: "No aircraft matching \"" + raw + "\" is in the live feeds right now (it may be on the ground with its transponder off, or outside coverage)." }, 200, headers);
}

async function flightsProbe(env, headers) {
  const out = {}, ms = timeoutMs(env, 3500);
  await Promise.all([...V2.map((u) => [u.name, u.base + u.area(36.12, -86.68, 30)]), ["OpenSky", OPENSKY + "?lamin=35.6&lomin=-87.3&lamax=36.6&lomax=-86.1"]].map(async ([name, u]) => {
    const t = Date.now();
    try { const r = await getText(u, ms); out[name] = { ok: r.ok, status: r.status, ms: Date.now() - t, why: r.ok ? undefined : httpWords(r.status) }; }
    catch (e) { out[name] = { ok: false, ms: Date.now() - t, why: words(e) }; }
  }));
  return json({ ok: Object.values(out).some((x) => x.ok), upstreams: out }, 200, headers);
}

// ---------- route, photo, ISS ----------
function airport(a) {
  if (!a || typeof a !== "object") return null;
  return { iata: a.iata_code || null, icao: a.icao_code || null, name: a.name || null, city: a.municipality || null,
    country: a.country_name || null, country_code: a.country_iso_name || null, lat: num(a.latitude), lon: num(a.longitude) };
}
async function route(url, env, headers) {
  const cs = String(url.searchParams.get("callsign") || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2,8}$/.test(cs)) return oops(400, "callsign must be 2 to 8 letters or digits, like SWA1234", headers);
  let hit;
  try {
    hit = await cached("route:" + cs, 3600, 86400, async () => {
      const r = await getText("https://api.adsbdb.com/v0/callsign/" + cs, timeoutMs(env, 5000));
      let j = null; try { j = JSON.parse(r.text); } catch (e) {}
      if (r.status === 404 || (j && typeof j.response === "string")) return { source: "adsbdb.com", found: false };
      if (!r.ok) throw new Error("adsbdb.com: " + httpWords(r.status));
      const fr = j && j.response && j.response.flightroute;
      if (!fr) throw new Error("adsbdb.com answered in an unexpected shape");
      const al = fr.airline;
      return { source: "adsbdb.com", found: true, callsign_icao: fr.callsign_icao || fr.callsign || cs, callsign_iata: fr.callsign_iata || null,
        airline: al ? { name: al.name || null, icao: al.icao || null, iata: al.iata || null, callsign: al.callsign || null, country: al.country || null } : null,
        origin: airport(fr.origin), destination: airport(fr.destination) };
    });
  } catch (e) { return oops(502, "Route lookup failed (" + words(e) + ")", headers); }
  const body = Object.assign({ ok: true, callsign: cs }, hit.data);
  if (!hit.data.found) body.note = "adsbdb.com has no route on file for " + cs;
  if (hit.stale) Object.assign(body, { stale: true, age_s: Math.round(hit.age_s) });
  return json(body, 200, headers);
}

async function photo(url, env, headers) {
  const hex = String(url.searchParams.get("hex") || "").trim().toLowerCase();
  const reg = String(url.searchParams.get("reg") || "").trim().toUpperCase();
  let kind, id;
  if (hex) { if (!/^[0-9a-f]{6}$/.test(hex)) return oops(400, "hex must be the 6-character ICAO code, like a1b2c3", headers); kind = "hex"; id = hex; }
  else if (reg) { if (!/^[A-Z0-9-]{2,10}$/.test(reg)) return oops(400, "reg must be a registration, like N8710M or G-EZAB", headers); kind = "reg"; id = reg; }
  else return oops(400, "give hex= (ICAO code) or reg= (registration)", headers);
  let hit;
  try {
    hit = await cached("photo:" + kind + ":" + id, 86400, 7 * 86400, async () => {
      const j = await getJSON(`https://api.planespotters.net/pub/photos/${kind}/${encodeURIComponent(id)}`, timeoutMs(env, 5000))
        .catch((e) => { throw new Error("planespotters.net: " + words(e)); });
      if (!j || !Array.isArray(j.photos)) throw new Error("planespotters.net answered in an unexpected shape");
      const img = (t) => (t && t.src ? { src: t.src, width: num(t.size && t.size.width), height: num(t.size && t.size.height) } : null);
      return { source: "planespotters.net", photos: j.photos.slice(0, 3).map((p) => ({ id: p.id || null, thumb: img(p.thumbnail), large: img(p.thumbnail_large),
        link: p.link || null, photographer: p.photographer || null, credit: "Photo: " + (p.photographer || "unknown") + " / Planespotters.net" })).filter((p) => p.thumb && p.link) };
    });
  } catch (e) { return oops(502, "Photo lookup failed (" + words(e) + ")", headers); }
  const body = { ok: true, [kind]: id, found: hit.data.photos.length > 0, source: hit.data.source, photos: hit.data.photos,
    terms: "Show the photographer's name and link the photo to its planespotters.net page; use the image as given." };
  if (hit.stale) Object.assign(body, { stale: true, age_s: Math.round(hit.age_s) });
  return json(body, 200, headers);
}

async function iss(env, headers) {
  let hit;
  try {
    hit = await cached("iss", 3, 1800, async () => {
      const j = await getJSON("https://api.wheretheiss.at/v1/satellites/25544", timeoutMs(env, 4000)).catch((e) => { throw new Error("wheretheiss.at: " + words(e)); });
      if (!j || num(j.latitude) === null || num(j.longitude) === null) throw new Error("wheretheiss.at answered without a position");
      return j;
    });
  } catch (e) { return oops(502, "ISS position unavailable (" + words(e) + ")", headers); }
  const body = Object.assign({}, hit.data, { ok: true, source: "wheretheiss.at" });
  if (hit.stale) Object.assign(body, { stale: true, age_s: Math.round(hit.age_s) });
  return json(body, 200, headers);
}

// ---------- ships ----------
function parseBox(text) {
  const n = String(text || "").split(",").map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const [la1, lo1, la2, lo2] = n;
  if (Math.abs(la1) > 90 || Math.abs(la2) > 90 || Math.abs(lo1) > 180 || Math.abs(lo2) > 180) return null;
  if (Math.abs(la1 - la2) > AIS_MAX_BOX_DEG || Math.abs(lo1 - lo2) > AIS_MAX_BOX_DEG) return null;
  return [[la1, lo1], [la2, lo2]];
}
// aisstream sends JSON as binary frames; turn every frame into text.
async function frameText(d) {
  if (typeof d === "string") return d;
  if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) return new TextDecoder().decode(d);
  if (d && typeof d.arrayBuffer === "function") return new TextDecoder().decode(await d.arrayBuffer());
  if (d && typeof d.text === "function") return await d.text();
  return String(d);
}
function aisTime(t) {
  const ms = t ? Date.parse(String(t).replace(" +0000 UTC", "Z").replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")) : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
}
function addAis(vessels, j) {
  const m = j && j.MetaData, msg = j && j.Message;
  if (!m || !msg) return;
  const mmsi = String(m.MMSI || "");
  if (!mmsi) return;
  const v = vessels.get(mmsi) || { mmsi, name: null, type: null, lat: null, lon: null, sog: null, cog: null, heading: null, length: null, beam: null, dest: null, last_seen: null, ts: 0 };
  const name = String(m.ShipName || "").replace(/@+/g, "").trim();
  if (name) v.name = name;
  const p = msg.PositionReport || msg.StandardClassBPositionReport || msg.ExtendedClassBPositionReport;
  const ts = aisTime(m.time_utc);
  if (p) {
    const lat = num(p.Latitude) ?? num(m.latitude), lon = num(p.Longitude) ?? num(m.longitude);
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && ts >= v.ts) {
      const sog = num(p.Sog), cog = num(p.Cog), hd = num(p.TrueHeading);
      Object.assign(v, { lat, lon, sog: sog !== null && sog < 102.3 ? sog : null, cog: cog !== null && cog < 360 ? cog : null,
        heading: hd !== null && hd < 360 ? hd : null, ts, last_seen: new Date(ts).toISOString() });
    }
  }
  const st = msg.ShipStaticData;
  if (st) {
    const d = st.Dimension || {};
    if (num(st.Type)) v.type = num(st.Type);
    const len = (num(d.A) || 0) + (num(d.B) || 0), beam = (num(d.C) || 0) + (num(d.D) || 0);
    if (len) v.length = len;
    if (beam) v.beam = beam;
    const dest = String(st.Destination || "").replace(/@+/g, "").trim();
    if (dest) v.dest = dest;
    if (!v.name && st.Name) v.name = String(st.Name).replace(/@+/g, "").trim() || null;
  }
  vessels.set(mmsi, v);
}
async function aisSnapshot(url, env, headers) {
  const box = parseBox(url.searchParams.get("box"));
  if (!box) return oops(400, "box must be lat1,lon1,lat2,lon2, at most " + AIS_MAX_BOX_DEG + " degrees across", headers);
  if (!env || !env.AISSTREAM_KEY) return oops(503, "the relay has no aisstream.io key yet (Worker secret AISSTREAM_KEY is not set)", headers);
  const listenMs = num(env.AIS_SNAPSHOT_MS) || 6000;
  const key = "ais:" + box.flat().map((x) => x.toFixed(2)).join(",");
  let hit;
  try {
    hit = await cached(key, 30, 1800, async (previous) => {
      let reply;
      try { reply = await fetch(AIS_UPSTREAM, { headers: { Upgrade: "websocket", "User-Agent": UA } }); }
      catch (e) { throw new Error("could not connect to aisstream.io (" + words(e) + ")"); }
      const ws = reply && reply.webSocket;
      if (!ws) throw new Error("aisstream.io did not accept the connection (HTTP " + (reply && reply.status) + ")");
      ws.accept();
      ws.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [box], FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"] }));
      const vessels = new Map();
      let messages = 0, problem = null;
      await new Promise((resolve) => {
        const t = setTimeout(resolve, listenMs);
        const done = () => { clearTimeout(t); resolve(); };
        ws.addEventListener("message", async (e) => {
          try {
            const j = JSON.parse(await frameText(e.data));
            if (j && j.error) { problem = "aisstream.io said: " + j.error; done(); return; }
            messages++; addAis(vessels, j);
          } catch (x) {}
        });
        ws.addEventListener("close", (e) => { if (!messages) problem = problem || "aisstream.io closed the feed (code " + e.code + (e.reason ? ": " + e.reason : "") + ")"; done(); });
        ws.addEventListener("error", () => { if (!messages) problem = problem || "aisstream.io connection error"; done(); });
      });
      try { ws.close(1000, "snapshot done"); } catch (x) {}
      if (problem && !messages) throw new Error(problem);
      // Keep ships from the previous snapshot of this box that reported in the last 15 min (moored ships report every few minutes).
      const now = Date.now();
      for (const v of (previous && previous.vessels) || []) if (!vessels.has(v.mmsi) && now - v.ts < 900000) vessels.set(v.mmsi, v);
      return { source: "aisstream.io", listened_s: listenMs / 1000, messages, vessels: [...vessels.values()].filter((v) => v.lat !== null) };
    });
  } catch (e) { return oops(502, words(e), headers); }
  const body = { ok: true, source: hit.data.source, box: box.flat(), now: Date.now(), listened_s: hit.data.listened_s, count: hit.data.vessels.length, vessels: hit.data.vessels };
  if (hit.age_s >= 0.5) body.age_s = Math.round(hit.age_s);
  if (hit.stale) Object.assign(body, { stale: true, why: hit.why });
  return json(body, 200, headers);
}

// ---------- router ----------
export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": SITE,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/ais/status") return new Response(JSON.stringify({ ais: true, key: !!(env && env.AISSTREAM_KEY) }), { headers });
      if (path === "/ais/probe") return aisProbe(env, headers);
      if (path === "/ais") return aisRelay(request, env, url, headers);
      if (path === "/ais/snapshot") return await aisSnapshot(url, env, headers);
      if (path === "/flights/area") return await flightsArea(url, env, headers);
      if (path === "/flights/summary") return await flightsSummary(url, env, headers);
      if (path === "/flights/find") return await flightsFind(url, env, headers);
      if (path === "/flights/probe") return await flightsProbe(env, headers);
      if (path === "/route") return await route(url, env, headers);
      if (path === "/photo") return await photo(url, env, headers);
      if (path === "/iss") return await iss(env, headers);
      const metar = METAR.exec(path);
      if (metar) {
        try {
          const r = await getText("https://aviationweather.gov/api/data/metar?format=json&ids=" + metar[1].toUpperCase(), timeoutMs(env, 6000));
          if (r.ok) return new Response(r.text, { headers });
        } catch (error) {}
        return new Response('{"error":"metar unavailable"}', { status: 502, headers });
      }
      const m = ALLOWED.exec(path);
      if (m) return await legacyFlights(m, env, headers);
      return new Response(JSON.stringify({ error: "not allowed", ok: false,
        routes: ["/flights/area", "/flights/summary", "/flights/find", "/route", "/photo", "/iss", "/ais/snapshot", "/metar/<ICAO>", "/lat/<lat>/lon/<lon>/dist/<nm>", "/hex/<hex>"] }), { status: 404, headers });
    } catch (e) {
      return oops(500, "the relay hit an unexpected problem (" + words(e) + ")", headers);
    }
  }
};

async function aisProbe(env, headers) {
  // Diagnostic: open aisstream for up to 12 s over Los Angeles and report what came back.
  if (!env || !env.AISSTREAM_KEY) return new Response(JSON.stringify({ ok: false, why: "no key" }), { headers });
  const out = { ok: false, opened: false, messages: 0, types: {}, first: null, closed: null, dataKind: null, decodeError: null };
  try {
    const reply = await fetch(AIS_UPSTREAM, { headers: { Upgrade: "websocket", "User-Agent": "imhere-prototype" } });
    const ws = reply.webSocket;
    if (!ws) return new Response(JSON.stringify({ ok: false, why: "upstream HTTP " + reply.status }), { headers });
    ws.accept(); out.opened = true;
    ws.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [[[33.3, -118.6], [34.0, -117.9]]] }));
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 20000);
      ws.addEventListener("message", async (e) => {
        out.messages++;
        const d = e.data; out.dataKind = out.dataKind || (typeof d === "string" ? "string" : (d && d.constructor && d.constructor.name) || typeof d);
        let text = "";
        try { text = await frameText(d); } catch (x) { out.decodeError = String(x && x.message || x); }
        if (out.first === null) out.first = text.slice(0, 300);
        try { const j = JSON.parse(text); const k = j.MessageType || (j.error ? "error" : "other"); out.types[k] = (out.types[k] || 0) + 1; } catch (x) {}
        if (out.messages >= 25) { clearTimeout(t); resolve(); }
      });
      ws.addEventListener("close", (e) => { out.closed = e.code + " " + (e.reason || ""); clearTimeout(t); resolve(); });
    });
    try { ws.close(1000, "probe done"); } catch (x) {}
    out.ok = out.messages > 0 && !out.types.error;
  } catch (error) { out.why = String(error && error.message || error); }
  return new Response(JSON.stringify(out, null, 1), { headers });
}

// Ships for Boats: aisstream.io refuses browser connections, so the page opens a WebSocket here and this
// Worker holds the aisstream key (secret AISSTREAM_KEY) and relays the stream for one bounding box.
// Control messages to the page: {"relay":"..."} (connected) and {"relayError":"..."} (plain-words reason), then close.
async function aisRelay(request, env, url, headers) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response('{"error":"WebSocket only: wss://<this worker>/ais?box=lat1,lon1,lat2,lon2"}', { status: 426, headers });
  }
  const origin = request.headers.get("Origin") || "";
  if (origin && origin !== SITE && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return new Response('{"error":"origin not allowed"}', { status: 403, headers });
  }
  // Always accept the page's socket, so a failure can be explained in words (browsers hide HTTP errors on WebSockets).
  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();
  const fail = (reason) => {
    try { server.send(JSON.stringify({ relayError: reason })); } catch (e) {}
    try { server.close(1011, reason.slice(0, 120)); } catch (e) {}
  };
  const box = parseBox(url.searchParams.get("box"));
  if (!box) { fail("bad area (box must be lat1,lon1,lat2,lon2, at most " + AIS_MAX_BOX_DEG + " degrees across)"); return new Response(null, { status: 101, webSocket: client }); }
  if (!env || !env.AISSTREAM_KEY) { fail("the relay has no aisstream.io key yet (Worker secret AISSTREAM_KEY is not set)"); return new Response(null, { status: 101, webSocket: client }); }

  let upstream;
  try {
    const reply = await fetch(AIS_UPSTREAM, { headers: { Upgrade: "websocket", "User-Agent": "imhere-prototype" } });
    upstream = reply.webSocket;
    if (!upstream) { fail("aisstream.io did not accept the connection (HTTP " + reply.status + ")"); return new Response(null, { status: 101, webSocket: client }); }
  } catch (error) {
    fail("could not connect to aisstream.io (" + (error && error.message || "network error") + ")");
    return new Response(null, { status: 101, webSocket: client });
  }
  upstream.accept();
  // aisstream closes the socket unless this subscription arrives within 3 seconds.
  upstream.send(JSON.stringify({ APIKey: env.AISSTREAM_KEY, BoundingBoxes: [box], FilterMessageTypes: ["PositionReport", "ShipStaticData"] }));
  try { server.send(JSON.stringify({ relay: "connected to aisstream.io" })); } catch (e) {}

  let open = true;
  const closeBoth = (code, reason) => {
    if (!open) return; open = false;
    try { upstream.close(1000, "done"); } catch (e) {}
    try { server.close(code || 1000, reason || "done"); } catch (e) {}
  };
  upstream.addEventListener("message", async (event) => {
    // Text frames go straight through (no await), binary frames are decoded first.
    try { const d = event.data; server.send(typeof d === "string" ? d : await frameText(d)); }
    catch (e) { try { server.send(JSON.stringify({ relayError: "relay could not pass on a ship report (" + (e && e.message || e) + ")" })); } catch (x) {} }
  });
  upstream.addEventListener("close", (event) => {
    if (!open) return;
    const why = "aisstream.io closed the feed (code " + event.code + (event.reason ? ": " + event.reason : "") + ")";
    try { server.send(JSON.stringify({ relayError: why })); } catch (e) {}
    closeBoth(1011, why.slice(0, 120));
  });
  upstream.addEventListener("error", () => {
    if (!open) return;
    try { server.send(JSON.stringify({ relayError: "aisstream.io connection error" })); } catch (e) {}
    closeBoth(1011, "upstream error");
  });
  server.addEventListener("close", () => closeBoth());
  server.addEventListener("error", () => closeBoth());
  return new Response(null, { status: 101, webSocket: client });
}

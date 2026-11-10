// I'M HERE — OurAirports converter.
// Fetches the free OurAirports world data (airports.csv + runways.csv) in the browser and turns any
// airport into the same data-file format as airports/KBNA.json, ready for buildAirport().
//
// Real data used: airport name, reference point, elevation, country, type; runway end idents,
// threshold coordinates, end elevations, displaced thresholds, width, lighted/closed flags.
// Assumed (OurAirports has no lighting-system detail): approach lights, PAPI, TDZ, centreline lights,
// marking class. Every assumption is written into the "verify" notes of the output.
//
// Pure functions (parseCSV, convertAirport) work in Node too; loadOurAirport() is for the browser.

export const OA_BASE = 'https://davidmegginson.github.io/ourairports-data/';
const CACHE_DAYS = 30;
const FT = 0.3048;

// ---------------------------------------------------------------------------
// CSV (RFC 4180): quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF, BOM.
// forEachRow calls cb(fields[]) per row; parseCSV returns { header, rows } with rows as objects.
// ---------------------------------------------------------------------------
export function forEachRow(text, cb) {
  let i = 0; const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  let row = [], field = '';
  while (i < n) {
    const ch = text[i];
    if (ch === '"' && field === '') {          // quoted field
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) { field += text.slice(i); i = n; break; }       // unterminated: take the rest
        field += text.slice(i, q); i = q + 1;
        if (text[i] === '"') { field += '"'; i++; } else break;      // "" -> "
      }
      continue;
    }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (row.length > 1 || row[0] !== '') cb(row);                  // skip blank lines
      row = [];
      continue;
    }
    // plain run of characters up to the next delimiter
    let j = i;
    while (j < n) { const c = text.charCodeAt(j); if (c === 44 || c === 10 || c === 13) break; j++; }
    field += text.slice(i, j); i = j;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') cb(row); }
}

export function parseCSV(text, filter) {
  let header = null; const rows = [];
  forEachRow(text, (f) => {
    if (!header) { header = f.map((h) => h.trim()); return; }
    const o = {}; for (let k = 0; k < header.length; k++) o[header[k]] = f[k] ?? '';
    if (!filter || filter(o)) rows.push(o);
  });
  return { header: header || [], rows };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const num = (v) => { if (v === undefined || v === null) return NaN; const s = String(v).trim(); return s === '' ? NaN : Number(s); };
const R_EARTH = 6371008.8, D2R = Math.PI / 180;
export function distanceFt(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  return 2 * R_EARTH * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)) / FT;
}
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const TYPE_RANK = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4, balloonport: 5, closed: 6 };
const WATER = /water/i;

// "02L" -> "2L". Returns null if the ident is not a normal runway number (e.g. "N", "H1", "36W").
function cleanIdent(s) {
  const m = /^0*(\d{1,2})([LCR]?)$/.exec(String(s || '').trim().toUpperCase());
  if (!m) return null; const n = +m[1];
  return n >= 1 && n <= 36 ? n + m[2] : null;
}
const identFromHeading = (h) => String(Math.round(h / 10) % 36 || 36);

// ---------------------------------------------------------------------------
// Find an airport row by ident / ICAO / GPS / IATA / local code (case-insensitive).
// ---------------------------------------------------------------------------
export function findAirport(airportRows, query) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return null;
  const fields = ['ident', 'icao_code', 'gps_code', 'iata_code', 'local_code'];
  for (const f of fields) {
    const hits = airportRows.filter((a) => (a[f] || '').toUpperCase() === q);
    if (hits.length) return hits.sort((a, b) => (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9))[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Convert one airport row + its runway rows into the KBNA.json format.
// ---------------------------------------------------------------------------
export function convertAirport(ap, runwayRows) {
  if (!ap) throw new Error('Airport not found');
  const country = (ap.iso_country || '').toUpperCase();
  const isUS = country === 'US';
  const large = ap.type === 'large_airport';
  const fieldElev = num(ap.elevation_ft);
  const elev = Number.isFinite(fieldElev) ? fieldElev : 0;
  const notes = [];   // airport-level verify notes
  if (!Number.isFinite(fieldElev)) notes.push('field elevation missing in OurAirports; 0 ft assumed');

  // 1) keep usable runways
  const usable = [];
  for (const r of runwayRows) {
    const tag = `${r.le_ident || '?'}/${r.he_ident || '?'}`;
    if (String(r.closed).trim() === '1') { notes.push(`runway ${tag} skipped: closed`); continue; }
    const la = num(r.le_latitude_deg), lo = num(r.le_longitude_deg), ha = num(r.he_latitude_deg), ho = num(r.he_longitude_deg);
    if (![la, lo, ha, ho].every(Number.isFinite)) { notes.push(`runway ${tag} skipped: missing end coordinates`); continue; }
    if (/^H\d*$/i.test(r.le_ident || '') || WATER.test(r.surface || '')) { notes.push(`runway ${tag} skipped: helipad/water`); continue; }
    const geoLen = distanceFt(la, lo, ha, ho);
    if (geoLen < 300) { notes.push(`runway ${tag} skipped: ends too close together (${geoLen.toFixed(0)} ft)`); continue; }
    usable.push({ r, la, lo, ha, ho, geoLen, tag });
  }
  if (!usable.length) throw new Error(`${ap.ident}: OurAirports has no open runway with both end coordinates`);
  usable.sort((a, b) => b.geoLen - a.geoLen);   // longest first (also wins any ident clash)
  const longest = usable[0];

  // 2) build runways
  const used = new Set(), runways = [];
  for (const u of usable) {
    const { r, la, lo, ha, ho, geoLen, tag } = u;
    const v = [];   // per-runway verify notes
    const lighted = String(r.lighted).trim() === '1';
    const lenData = num(r.length_ft), L = Number.isFinite(lenData) && lenData > 0 ? lenData : geoLen;
    if (Number.isFinite(lenData) && Math.abs(lenData - geoLen) > Math.max(100, 0.03 * lenData))
      v.push(`listed length ${lenData} ft but end coordinates are ${geoLen.toFixed(0)} ft apart (coordinates used)`);

    let width = num(r.width_ft);
    if (!(width > 0)) { width = L >= 8000 ? 150 : L >= 5000 ? 100 : 75; v.push(`width missing; ${width} ft assumed`); }
    else if (width > 300) { v.push(`width ${width} ft looks wrong; capped at 200 ft`); width = 200; }

    // end idents (real when they are normal runway numbers; otherwise from the true bearing)
    const brgLe = bearingDeg(la, lo, ha, ho), brgHe = (brgLe + 180) % 360;
    let leId = cleanIdent(r.le_ident), heId = cleanIdent(r.he_ident);
    if (!leId) { leId = identFromHeading(brgLe); v.push(`end "${r.le_ident}" renamed ${leId} from its true bearing`); }
    if (!heId) { heId = identFromHeading(brgHe); v.push(`end "${r.he_ident}" renamed ${heId} from its true bearing`); }
    if (used.has(leId) || used.has(heId) || leId === heId) { notes.push(`runway ${tag} skipped: duplicate runway number`); continue; }
    used.add(leId); used.add(heId);

    const hLe = num(r.le_heading_degT);
    if (Number.isFinite(hLe) && angDiff(hLe, brgLe) > 2) v.push(`listed heading ${hLe}° vs ${brgLe.toFixed(1)}° from coordinates (coordinates used)`);

    const endElev = (x) => { const e = num(x); return Number.isFinite(e) ? e : null; };
    const eLe = endElev(r.le_elevation_ft), eHe = endElev(r.he_elevation_ft);
    if (eLe === null || eHe === null) v.push('end elevation missing; field elevation used');
    const disp = (x) => { const d = num(x); return Number.isFinite(d) && d > 0 && d < L * 0.5 ? Math.round(d) : 0; };

    // ---- assumed lighting (OurAirports only says lighted yes/no) ----
    const appQual = lighted && large && L >= 7000;
    let apLe = '', apHe = '', tdzLe = false;
    if (appQual) {
      if (isUS) {
        if (u === longest) { apLe = 'ALSF2'; apHe = 'MALSR'; tdzLe = true; v.push(`approach lights assumed: ALSF2 + touchdown-zone lights on ${leId}, MALSR on ${heId}`); }
        else { apLe = 'MALSR'; v.push(`approach lights assumed: MALSR on ${leId}, none on ${heId}`); }
      } else { apLe = apHe = 'CALVERT'; v.push(`approach lights assumed: CALVERT on both ends`); }
    } else if (lighted) v.push('approach lights assumed: none');
    const papi = lighted ? 'left' : '';
    if (lighted) v.push('PAPI assumed on the left of both ends');
    const centre = lighted && large && L >= 8000;
    if (centre) v.push('centreline lights assumed');
    if (!lighted) v.push('runway not lighted (per OurAirports): no edge lights');
    const markings = (apLe || apHe) || (large && L >= 6000) ? 'precision' : (lighted && L >= 4000 ? 'nonprecision' : 'visual');
    v.push(`${markings} markings assumed`);
    const surf = (r.surface || '').trim();
    if (surf && !/^(asp|con|pem|bit|tar|asf|paved)/i.test(surf)) v.push(`surface "${surf}" drawn as concrete`);

    const pad = (s) => s.replace(/^(\d)(?!\d)/, '0$1');
    runways.push({
      id: `${pad(leId)}/${pad(heId)}`, width_ft: width, length_ft: Math.round(L), surface: surf,
      centerline_lights: centre, edge_lights: lighted ? 'HIRL' : 'none', markings,
      ends: [
        { id: leId, lat: la, lon: lo, elev_ft: eLe ?? elev, displaced_ft: disp(r.le_displaced_threshold_ft),
          approach: apLe, tdz: tdzLe, papi, reil: false, heading_true: +brgLe.toFixed(2) },
        { id: heId, lat: ha, lon: ho, elev_ft: eHe ?? elev, displaced_ft: disp(r.he_displaced_threshold_ft),
          approach: apHe, tdz: false, papi, reil: false, heading_true: +brgHe.toFixed(2) },
      ],
      verify: v.join('; '),
    });
  }
  if (!runways.length) throw new Error(`${ap.ident}: no usable runways`);

  // reference point: OurAirports position, unless it is far from the runways (then the runway centroid)
  let arp = [num(ap.latitude_deg), num(ap.longitude_deg)];
  const cLat = runways.reduce((s, r) => s + r.ends[0].lat + r.ends[1].lat, 0) / (2 * runways.length);
  const cLon = runways.reduce((s, r) => s + r.ends[0].lon + r.ends[1].lon, 0) / (2 * runways.length);
  if (!arp.every(Number.isFinite) || distanceFt(arp[0], arp[1], cLat, cLon) > 5 * 6076) {
    notes.push('airport position missing or far from runways; runway centre used'); arp = [cLat, cLon];
  }

  return {
    icao: (ap.ident || '').toUpperCase(), name: ap.name || ap.ident, iata: ap.iata_code || '',
    municipality: ap.municipality || '', region: ap.iso_region || '', type: ap.type || '',
    arp, elev_ft: elev, country, rules: isUS ? 'FAA' : 'ICAO',
    sources: 'OurAirports (ourairports.com, public domain): airport position, elevation, runway ends, widths, displaced thresholds, lighted/closed flags. ' +
             'Lighting systems are assumptions (see verify). Not for real-world navigation.',
    verify: notes, runways,
  };
}

// The runway end to fly to by default: `prefer` if the airport has it, else best approach lights, then longest runway.
export function defaultEnd(data, prefer) {
  if (prefer && data.runways.some((rw) => rw.ends.some((e) => e.id === prefer))) return prefer;
  const rank = { ALSF2: 0, ICAO_CAT2: 0, ALSF1: 1, CALVERT: 2, MALSR: 3, SSALR: 3, MALSF: 4, MALS: 5, ODALS: 6, '': 9 };
  let best = null, bestKey = Infinity;
  for (const rw of data.runways) for (const e of rw.ends) {
    const len = rw.length_ft || distanceFt(rw.ends[0].lat, rw.ends[0].lon, rw.ends[1].lat, rw.ends[1].lon);
    const key = (rank[e.approach || ''] ?? 8) * 1e6 - len;
    if (key < bestKey) { bestKey = key; best = e.id; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Browser loader with caching (IndexedDB, then localStorage, then memory). All storage is optional.
// ---------------------------------------------------------------------------
const mem = {};
function idb() {
  return new Promise((res, rej) => {
    try {
      if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
      const rq = indexedDB.open('imhere-ourairports', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('files');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    } catch (e) { rej(e); }
  });
}
async function cacheGet(key) {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => { const rq = db.transaction('files').objectStore('files').get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
    db.close(); if (v && v.text) return v;
  } catch (e) { /* no IndexedDB */ }
  try { const s = localStorage.getItem('oa:' + key); if (s) return JSON.parse(s); } catch (e) { /* no localStorage */ }
  return null;
}
async function cachePut(key, text) {
  const v = { t: Date.now(), text };
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    db.close(); return;
  } catch (e) { /* fall through */ }
  try { localStorage.setItem('oa:' + key, JSON.stringify(v)); } catch (e) { /* too big for localStorage: memory only */ }
}

async function getText(url, { fetchFn, onStatus, refresh }) {
  if (mem[url]) return mem[url];
  const cached = refresh ? null : await cacheGet(url);
  const fresh = cached && Date.now() - cached.t < CACHE_DAYS * 864e5;
  if (fresh) return (mem[url] = cached.text);
  try {
    onStatus?.(`Downloading ${url.split('/').pop()}…`);
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const text = await r.text();
    mem[url] = text; cachePut(url, text);   // do not wait for the cache write
    return text;
  } catch (e) {
    if (cached) { onStatus?.('Offline: using saved airport list'); return (mem[url] = cached.text); }   // stale beats nothing
    throw e;
  }
}

let airportIndex = null;   // parsed airports.csv, kept for the session
/**
 * loadOurAirport('KJFK', { base, fetchFn, onStatus }) -> Promise<airport data (KBNA.json format)>
 * base: folder holding airports.csv and runways.csv (default: OurAirports on GitHub Pages).
 */
// Nearest large/medium airport to a position (used when a joined live flight lands). -> { ident, name, distNm }
export async function nearestAirport(lat, lon, opts = {}) {
  const base = opts.base || OA_BASE;
  const o = { fetchFn: opts.fetchFn || ((u) => fetch(u)), onStatus: opts.onStatus, refresh: opts.refresh };
  const aText = await getText(base + 'airports.csv', o);
  if (!airportIndex || airportIndex.base !== base) airportIndex = { base, rows: parseCSV(aText).rows };
  let best = null, bd = Infinity;
  for (const r of airportIndex.rows) {
    if (r.type !== 'large_airport' && r.type !== 'medium_airport') continue;
    const la = +r.latitude_deg, lo = +r.longitude_deg; if (!Number.isFinite(la) || Math.abs(la - lat) > 1 || !Number.isFinite(lo)) continue;
    const d = distanceFt(lat, lon, la, lo); if (d < bd) { bd = d; best = r; }
  }
  return best ? { ident: (best.ident || '').toUpperCase(), name: best.name, municipality: best.municipality || '', region: best.iso_region || '', distNm: bd * 0.3048 / 1852 } : null;
}
export async function loadOurAirport(query, opts = {}) {
  const base = opts.base || OA_BASE;
  const o = { fetchFn: opts.fetchFn || ((u) => fetch(u)), onStatus: opts.onStatus, refresh: opts.refresh };
  const [aText, rText] = await Promise.all([getText(base + 'airports.csv', o), getText(base + 'runways.csv', o)]);
  if (!airportIndex || airportIndex.base !== base) {
    opts.onStatus?.('Reading airport list…');
    airportIndex = { base, rows: parseCSV(aText).rows };
  }
  const ap = findAirport(airportIndex.rows, query);
  if (!ap) throw new Error(`"${query}" not found in OurAirports`);
  const id = String(ap.id), ident = (ap.ident || '').toUpperCase();
  const rws = parseCSV(rText, (r) => String(r.airport_ref) === id || (r.airport_ident || '').toUpperCase() === ident).rows;
  return convertAirport(ap, rws);
}

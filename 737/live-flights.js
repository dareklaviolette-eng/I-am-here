// I'M HERE 737: "Join a real flight". Live ADS-B positions from free, key-less community feeds, smoothed for the cockpit.
//
// Sources (tried in order; all speak the ADS-B Exchange v2 JSON shape { ac: [...], now }):
//   I'M HERE relay  https://imhere-flights.bt4w8jn5ty.workers.dev  (on the GitHub site only; see RELAY below)
//   airplanes.live  https://api.airplanes.live/v2/  (free, non-commercial, about 1 request/s)
//   adsb.lol        https://api.adsb.lol/v2/        (free, ODbL data licence)
//   OpenSky         https://opensky-network.org/api/states/all  (anonymous, rate limited; different shape, converted)
// Check each source's current terms before any commercial use.
//
// Pure module (no three.js, no DOM): parsing, sorting, search and the Tracker (dead reckoning with easing,
// freshness, 30 s extrapolation limit). Tested in Node with a recorded-format sample: node test/live-test.mjs

// The I'M HERE flight relay (Cloudflare Worker "imhere-flights", relay/worker.js on the prototype branch): proxies adsb.lol,
// then adsb.fi, server-side, and answers CORS only for the GitHub Pages site. Used first there; elsewhere the browser
// falls through to the direct feeds below.
export const RELAY = 'https://imhere-flights.bt4w8jn5ty.workers.dev';
const onSite = typeof location !== 'undefined' && /(^|\.)dareklaviolette-eng\.github\.io$/i.test(location.hostname);
export const SOURCES = [
  ...(onSite ? [{ name: 'adsb.lol/adsb.fi (relay)', point: (la, lo, nm) => `${RELAY}/lat/${la.toFixed(4)}/lon/${lo.toFixed(4)}/dist/${Math.round(Math.min(250, nm))}`,
    hex: (h) => `${RELAY}/hex/${h}` }] : []),
  { name: 'airplanes.live', point: (la, lo, nm) => `https://api.airplanes.live/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${Math.min(250, nm)}`,
    hex: (h) => `https://api.airplanes.live/v2/hex/${h}` },
  { name: 'adsb.lol', point: (la, lo, nm) => `https://api.adsb.lol/v2/point/${la.toFixed(4)}/${lo.toFixed(4)}/${Math.min(250, nm)}`,
    hex: (h) => `https://api.adsb.lol/v2/hex/${h}` },
  { name: 'OpenSky', opensky: true,
    point: (la, lo, nm) => { const d = nm / 60; return `https://opensky-network.org/api/states/all?lamin=${(la - d).toFixed(3)}&lamax=${(la + d).toFixed(3)}&lomin=${(lo - d / Math.cos(la * Math.PI / 180)).toFixed(3)}&lomax=${(lo + d / Math.cos(la * Math.PI / 180)).toFixed(3)}`; },
    hex: (h) => `https://opensky-network.org/api/states/all?icao24=${h}` },
];
export const COCKPIT_737 = /^(B73[6-9]|B37M|B38M|B39M|B3XM|B73G)$/i;   // ICAO type designators we have a cockpit for
const NM = 1852, KT = 0.514444, FTM = 0.3048, R = 6371008.8, D2R = Math.PI / 180;

export function distNm(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * D2R / 2) ** 2 + Math.cos(la1 * D2R) * Math.cos(la2 * D2R) * Math.sin((lo2 - lo1) * D2R / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))) / NM;
}

// ADS-B Exchange v2 shape -> our flight records. Values a source does not send stay null (never invented).
export function parseV2(j, receivedAt = Date.now()) {
  const list = (j && (j.ac || j.aircraft)) || [];
  return list.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon)).map((a) => {
    const ground = a.alt_baro === 'ground';
    const alt = ground ? 0 : Number.isFinite(a.alt_baro) ? a.alt_baro : Number.isFinite(a.alt_geom) ? a.alt_geom : null;
    const seen = Number.isFinite(a.seen_pos) ? a.seen_pos : Number.isFinite(a.seen) ? a.seen : 0;
    return { hex: String(a.hex || '').toLowerCase().replace(/^~/, ''), flight: String(a.flight || '').trim(), reg: String(a.r || '').trim(),
      type: String(a.t || '').trim().toUpperCase(), desc: a.desc || '', lat: a.lat, lon: a.lon, altFt: alt, onGround: ground,
      gs: Number.isFinite(a.gs) ? a.gs : null, track: Number.isFinite(a.track) ? a.track : Number.isFinite(a.true_heading) ? a.true_heading : null,
      vr: Number.isFinite(a.baro_rate) ? a.baro_rate : Number.isFinite(a.geom_rate) ? a.geom_rate : 0,
      fixAt: receivedAt - seen * 1000 };
  });
}
// OpenSky /states/all -> same records (OpenSky has no aircraft type: those flights cannot be matched to the 737 cockpit)
export function parseOpenSky(j, receivedAt = Date.now()) {
  return ((j && j.states) || []).filter((s) => Number.isFinite(s[5]) && Number.isFinite(s[6])).map((s) => ({
    hex: String(s[0] || '').toLowerCase(), flight: String(s[1] || '').trim(), reg: '', type: '', desc: '', lat: s[6], lon: s[5],
    altFt: s[8] ? 0 : Number.isFinite(s[7]) ? s[7] / FTM : Number.isFinite(s[13]) ? s[13] / FTM : null, onGround: !!s[8],
    gs: Number.isFinite(s[9]) ? s[9] / KT : null, track: Number.isFinite(s[10]) ? s[10] : null,
    vr: Number.isFinite(s[11]) ? s[11] / FTM * 60 : 0, fixAt: Number.isFinite(s[3]) ? s[3] * 1000 : receivedAt }));
}

async function getJSON(url, fetchFn, timeoutMs = 6000) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const to = ac && setTimeout(() => ac.abort(), timeoutMs);
  try { const r = await fetchFn(url, ac ? { signal: ac.signal, cache: 'no-store' } : undefined); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { if (to) clearTimeout(to); }
}
// Try each source until one answers. Returns { source, flights } or throws with every source's error.
export async function fetchNearby(lat, lon, nm, { fetchFn = (u, o) => fetch(u, o), sources = SOURCES } = {}) {
  const errs = [];
  for (const s of sources) {
    try { const j = await getJSON(s.point(lat, lon, nm), fetchFn), t = Date.now();
      return { source: s.name, flights: (s.opensky ? parseOpenSky(j, t) : parseV2(j, t)) }; }
    catch (e) { errs.push(s.name + ': ' + e.message); }
  }
  throw new Error('No live flight source reachable (' + errs.join('; ') + ')');
}
export async function fetchHex(hex, { fetchFn = (u, o) => fetch(u, o), sources = SOURCES, prefer } = {}) {
  const order = prefer ? [...sources].sort((a, b) => (b.name === prefer) - (a.name === prefer)) : sources;
  const errs = [];
  for (const s of order) {
    try { const j = await getJSON(s.hex(hex), fetchFn), t = Date.now(); const f = (s.opensky ? parseOpenSky(j, t) : parseV2(j, t)).find((x) => x.hex === hex);
      if (f) return { source: s.name, flight: f }; errs.push(s.name + ': not in feed'); }
    catch (e) { errs.push(s.name + ': ' + e.message); }
  }
  throw new Error(errs.join('; '));
}

// 737s first (we only have that cockpit), then nearest. Adds distNm and is737.
export function sortFlights(list, lat, lon) {
  return list.map((f) => ({ ...f, distNm: distNm(lat, lon, f.lat, f.lon), is737: COCKPIT_737.test(f.type) }))
    .sort((a, b) => (b.is737 - a.is737) || (a.onGround - b.onGround) || (a.distNm - b.distNm));
}
export function searchFlights(list, q) {
  q = String(q || '').trim().toUpperCase().replace(/\s+/g, ''); if (!q) return list;
  return list.filter((f) => f.flight.toUpperCase().replace(/\s+/g, '').includes(q) || f.reg.toUpperCase().replace(/-/g, '').includes(q.replace(/-/g, '')) || f.hex.toUpperCase() === q);
}

// Dead reckoning between fixes, with easing so a new fix never makes the aircraft jump.
// state(now): position predicted from the last fix (up to EXTRAP_MAX s), plus a correction that fades out over EASE_S.
// live: data fresher than FRESH_S. After EXTRAP_MAX the aircraft holds its last state (frozen).
export const FRESH_S = 10, EXTRAP_MAX = 30, EASE_S = 2.5;
export class Tracker {
  constructor() { this.fix = null; this.corr = null; }
  predict(f, now) {
    const t = Math.max(0, Math.min(EXTRAP_MAX, (now - f.fixAt) / 1000));
    const gs = (f.gs || 0) * KT, tr = (f.track || 0) * D2R, d = f.onGround && (f.gs || 0) < 3 ? 0 : gs * t;
    const lat = f.lat + (d * Math.cos(tr)) / R / D2R, lon = f.lon + (d * Math.sin(tr)) / (R * Math.cos(f.lat * D2R)) / D2R;
    const altFt = f.altFt == null ? null : f.onGround ? 0 : Math.max(0, f.altFt + (f.vr || 0) * t / 60);
    return { lat, lon, altFt, gs: f.gs, track: f.track, vr: f.vr, onGround: f.onGround };
  }
  onFix(f, now = Date.now()) {
    if (this.fix && f.fixAt <= this.fix.fixAt) return false;   // stale or duplicate report
    if (this.fix) {   // ease from where we are showing it to the new prediction
      const a = this.state(now), b = this.predict(f, now);
      this.corr = { at: now, lat: a.lat - b.lat, lon: a.lon - b.lon, alt: (a.altFt ?? 0) - (b.altFt ?? 0), trk: ((a.track - b.track + 540) % 360) - 180 };
    }
    this.fix = f; return true;
  }
  state(now = Date.now()) {
    if (!this.fix) return null;
    const p = this.predict(this.fix, now), age = (now - this.fix.fixAt) / 1000;
    if (this.corr) {
      const k = Math.exp(-Math.max(0, now - this.corr.at) / 1000 / (EASE_S / 3));
      if (k < 0.002) this.corr = null;
      else { p.lat += this.corr.lat * k; p.lon += this.corr.lon * k; if (p.altFt != null) p.altFt += this.corr.alt * k;
        if (p.track != null && Number.isFinite(this.corr.trk)) p.track = (p.track + this.corr.trk * k + 360) % 360; }
    }
    return { ...p, ageS: age, live: age < FRESH_S, extrapolating: age >= FRESH_S && age < EXTRAP_MAX, frozen: age >= EXTRAP_MAX, fixAt: this.fix.fixAt };
  }
}

// Values ADS-B does not broadcast, derived from the live track (shown as "derived" in the provenance panel).
export function deriveCockpit(s, prevTrack, dt) {
  const gs = s.gs || 0, vr = s.vr || 0;
  const turn = prevTrack == null || !dt ? 0 : (((s.track - prevTrack + 540) % 360) - 180) / dt;             // deg/s
  const bank = Math.max(-30, Math.min(30, Math.atan((gs * KT) * turn * D2R / 9.81) / D2R));
  const fpa = gs > 30 ? Math.atan2(vr * FTM / 60, gs * KT) / D2R : 0;
  const pitch = s.onGround ? 0 : Math.max(-8, Math.min(18, fpa + 2.5));
  const n1 = s.onGround ? (gs > 60 ? 60 : 22) : Math.max(25, Math.min(95, 55 + vr / 60 + (gs > 250 ? 25 : 10)));
  return { bank, pitch, n1 };
}

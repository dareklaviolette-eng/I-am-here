// I'M HERE 737: live airport weather from METAR (aviationweather.gov Data API, free, no key).
// Pure module (no three.js / DOM): fetch with fallback through the I'M HERE relay, and parse into what the scene needs.
// Tested offline: node test/weather-test.mjs
//
// aviationweather.gov: https://aviationweather.gov/api/data/metar?ids=KBNA&format=json  -> [{ icaoId, obsTime, rawOb, wdir,
//   wspd, wgst, visib, wxString, clouds: [{ cover, base }] , ... }]. If the browser cannot reach it (CORS / blocked),
//   the relay route /metar/ICAO on the Cloudflare Worker (relay/worker.js) returns the same JSON.

export const AWC = (icao) => `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`;
export const RELAY_METAR = (icao) => `https://imhere-flights.bt4w8jn5ty.workers.dev/metar/${encodeURIComponent(icao)}`;
export const LIVE_MAX_MIN = 90;   // older than this is not "live" weather
const COVER = { SKC: 0, CLR: 0, NCD: 0, NSC: 0, CAVOK: 0, FEW: 0.2, SCT: 0.4, BKN: 0.72, OVC: 0.95, OVX: 1 };

export async function fetchMetar(icao, { fetchFn = (u, o) => fetch(u, o), urls = [AWC(icao), RELAY_METAR(icao)] } = {}) {
  const errs = [];
  for (const u of urls) {
    try {
      const r = await fetchFn(u, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(), m = Array.isArray(j) ? j[0] : j && j.data ? j.data[0] : j;
      if (!m || !m.rawOb) throw new Error('no METAR for ' + icao);
      return { ...parseMetar(m), via: /workers\.dev/.test(u) ? 'aviationweather.gov via relay' : 'aviationweather.gov' };
    } catch (e) { errs.push(e.message); }
  }
  throw new Error('METAR not reachable (' + errs.join('; ') + ')');
}

// Visibility in metres: "10+", "6", "1/2", 9999 (metres when given as a 4-digit metric value in raw)
function visMeters(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 100 ? v : v * 1609.34;
  const s = String(v).trim();
  if (/^\d+\+$/.test(s)) return parseFloat(s) * 1609.34 * 1.6;   // "10+": at least 10 statute miles
  if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split('/').map(Number); return a / b * 1609.34; }
  const n = parseFloat(s); return Number.isFinite(n) ? n * 1609.34 : null;
}
export function parseMetar(m) {
  const clouds = (m.clouds || []).filter((c) => c && c.cover in COVER && COVER[c.cover] > 0 && Number.isFinite(+c.base))
    .map((c) => ({ cover: c.cover, baseFt: +c.base, amount: COVER[c.cover] })).sort((a, b) => a.baseFt - b.baseFt).slice(0, 3);
  const wx = String(m.wxString || '');
  const precip = /SN|SG|PL|GS|GR/.test(wx) ? 'snow' : /RA|DZ|SH|TS/.test(wx) ? 'rain' : null;
  const intensity = /\+/.test(wx) ? 1 : /-/.test(wx) ? 0.35 : 0.65;
  const wdir = m.wdir === 'VRB' ? null : Number.isFinite(+m.wdir) ? +m.wdir : null;
  return {
    icao: m.icaoId || '', raw: m.rawOb, obsTime: Number.isFinite(+m.obsTime) ? +m.obsTime * 1000 : Date.parse(m.reportTime) || null,
    windDir: wdir, windKt: Number.isFinite(+m.wspd) ? +m.wspd : 0, gustKt: Number.isFinite(+m.wgst) ? +m.wgst : null, variable: m.wdir === 'VRB',
    visM: visMeters(m.visib), wx, precip: precip ? { kind: precip, intensity } : null, clouds,
  };
}
export function ageMin(w, now = Date.now()) { return w && w.obsTime ? (now - w.obsTime) / 60000 : Infinity; }
export function isLive(w, now = Date.now()) { return ageMin(w, now) <= LIVE_MAX_MIN; }
export function summary(w, now = Date.now()) {
  if (!w) return '';
  const sky = w.clouds.length ? w.clouds.map((c) => `${c.cover} ${c.baseFt.toLocaleString('en-US')} ft`).join(', ') : 'clear skies';
  const vis = w.visM == null ? '' : w.visM >= 16000 ? 'vis 10+ mi' : `vis ${(w.visM / 1609.34).toFixed(w.visM < 3200 ? 1 : 0)} mi`;
  const wind = w.windKt < 1 ? 'calm' : `wind ${w.variable ? 'VRB' : String(w.windDir).padStart(3, '0') + '°'} ${w.windKt} kt${w.gustKt ? ' G' + w.gustKt : ''}`;
  return [sky, vis, w.wx, wind].filter(Boolean).join(' · ') + ` (${Math.round(ageMin(w, now))} min old)`;
}
// Crosswind/headwind on a runway heading (deg true): + crosswind from the right
export function windComponents(w, rwyHdg) {
  if (!w || w.windDir == null || !w.windKt) return { cross: 0, head: 0 };
  const a = (w.windDir - rwyHdg) * Math.PI / 180;
  return { cross: w.windKt * Math.sin(a), head: w.windKt * Math.cos(a) };
}

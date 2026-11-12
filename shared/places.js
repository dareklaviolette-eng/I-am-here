// I'M HERE: offline reverse geocoding for the card's LOC row ("Westminster, CO", "Dubai, UAE"). No prepositions: LOC is
// just the place, and it switches to the next town as you fly into it (nearest place, looked up at most every 10 s by the page).
//
// Data: shared/places/index.json + tiles/<lat>_<lon>.txt, built by shared/places/build-places.mjs from GeoNames
// (CC BY 4.0, credit "GeoNames") or, until that file is installed, a small seed from the tz database (public domain).
// Only the tiles around the aircraft are loaded (3 x 3 tiles of 2°, a few KB each). Lookup: a 0.25° grid index.
// When the place file has nothing near (the seed is sparse), the page may pass the nearest airfield's town (OurAirports)
// as a fallback candidate: see pickPlace(). Nothing is invented: every name and coordinate comes from those files.
// Pure module (no DOM); fetchFn is injectable for tests.

export const COUNTRY_SHORT = { US: 'USA', AE: 'UAE', GB: 'UK', KR: 'South Korea', KP: 'North Korea', RU: 'Russia', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong',
  JP: 'Japan', IN: 'India', AU: 'Australia', NZ: 'New Zealand', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', PE: 'Peru',
  FR: 'France', DE: 'Germany', ES: 'Spain', PT: 'Portugal', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', IE: 'Ireland',
  SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland', IS: 'Iceland', PL: 'Poland', CZ: 'Czechia', GR: 'Greece', TR: 'Turkey', IL: 'Israel', EG: 'Egypt',
  SA: 'Saudi Arabia', QA: 'Qatar', ZA: 'South Africa', KE: 'Kenya', NG: 'Nigeria', SG: 'Singapore', TH: 'Thailand', VN: 'Vietnam', PH: 'Philippines',
  ID: 'Indonesia', MY: 'Malaysia', PK: 'Pakistan', IR: 'Iran', IQ: 'Iraq', UA: 'Ukraine', HU: 'Hungary', RO: 'Romania', BG: 'Bulgaria', HR: 'Croatia',
  RS: 'Serbia', MA: 'Morocco', DZ: 'Algeria', TN: 'Tunisia', CU: 'Cuba', DO: 'Dominican Rep.', PR: 'Puerto Rico', JM: 'Jamaica', BS: 'Bahamas', FJ: 'Fiji' };

const D2R = Math.PI / 180;
export function distNm(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * D2R / 2) ** 2 + Math.cos(la1 * D2R) * Math.cos(la2 * D2R) * Math.sin((lo2 - lo1) * D2R / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a))) / 1852;
}
// "Westminster, CO" (US: state postal code), "Dubai, UAE" (elsewhere: short country name), "" for nothing.
export function formatPlace(p) {
  if (!p || !p.name) return '';
  if (p.cc === 'US' || !p.cc) return p.admin1 ? p.name + ', ' + p.admin1 : p.name;
  return p.name + ', ' + (COUNTRY_SHORT[p.cc] || p.cc);
}
export function parseTile(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const f = line.split('\t'); if (f.length < 5) continue;
    const lat = +f[3], lon = +f[4]; if (!Number.isFinite(lat) || !Number.isFinite(lon) || !f[0]) continue;
    out.push({ name: f[0], admin1: f[1], cc: f[2], lat, lon });
  }
  return out;
}
// Grid index over places (cells of `cell` degrees). nearest() searches rings of cells outwards until no closer place can exist.
export class PlaceGrid {
  constructor(cell = 0.25) { this.cell = cell; this.cells = new Map(); this.size = 0; }
  _k(i, j) { return i * 4096 + j; }
  add(p) {
    const i = Math.floor(p.lat / this.cell), j = Math.floor(p.lon / this.cell), k = this._k(i, j);
    let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(p); this.size++;
  }
  nearest(lat, lon, maxNm = 60) {
    const i0 = Math.floor(lat / this.cell), j0 = Math.floor(lon / this.cell);
    const cellNm = this.cell * 60 * Math.max(0.05, Math.cos(Math.min(89, Math.abs(lat) + this.cell) * D2R));   // smallest cell side (lon direction)
    const R = Math.min(400, Math.ceil(maxNm / cellNm) + 1);
    let best = null, bd = Infinity;
    for (let r = 0; r <= R; r++) {
      if (best && (r - 1) * cellNm > bd) break;
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const c = this.cells.get(this._k(i0 + di, j0 + dj)); if (!c) continue;
        for (const p of c) { const d = distNm(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }
      }
    }
    return best && bd <= maxNm ? { ...best, distNm: bd } : null;
  }
}
// The place file may be sparse (the seed): a nearer airfield town (OurAirports municipality) wins when the file's
// nearest place is more than `preferNm` away. candidates: { name, admin1, cc, distNm, via }
export function pickPlace(fromFile, fromAirport, preferNm = 8) {
  if (fromFile && (fromFile.distNm <= preferNm || !fromAirport || fromFile.distNm <= fromAirport.distNm)) return { ...fromFile, via: fromFile.via || 'places' };
  if (fromAirport && fromAirport.name) return { ...fromAirport, via: 'airport' };
  return fromFile ? { ...fromFile, via: fromFile.via || 'places' } : null;
}

export function createPlaces({ base = '../shared/places/', fetchFn = (u) => fetch(u) } = {}) {
  let index = null, indexP = null; const tilesOn = new Set(), loading = new Map(), grid = new PlaceGrid();
  async function getIndex() {
    if (index) return index;
    if (!indexP) indexP = fetchFn(base + 'index.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => { index = { ...j, set: new Set(j.tiles || []) }; return index; }, (e) => { indexP = null; throw e; });
    return indexP;
  }
  async function ensure(lat, lon) {
    const ix = await getIndex(), T = ix.tileDeg || 2, a = Math.floor(lat / T) * T, b = Math.floor(lon / T) * T, jobs = [];
    for (const di of [-T, 0, T]) for (const dj of [-T, 0, T]) {
      let lo = b + dj; if (lo >= 180) lo -= 360; if (lo < -180) lo += 360;
      const k = (a + di) + '_' + lo; if (!ix.set.has(k) || tilesOn.has(k)) continue;
      if (!loading.has(k)) loading.set(k, fetchFn(base + 'tiles/' + k + '.txt').then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((t) => { for (const p of parseTile(t)) grid.add(p); tilesOn.add(k); }).finally(() => loading.delete(k)));
      jobs.push(loading.get(k).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  return {
    async nearest(lat, lon, maxNm = 150) { await ensure(lat, lon); return grid.nearest(lat, lon, maxNm); },
    info: () => (index ? { source: index.source, credit: index.credit, complete: !!index.complete, note: index.note } : null),
    stats: () => ({ tiles: tilesOn.size, places: grid.size }),
  };
}

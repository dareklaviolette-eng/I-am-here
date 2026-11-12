// Builds the I'M HERE offline place-name tiles (shared/places/index.json + tiles/*.txt) used by shared/places.js for LOC.
//
//   node shared/places/build-places.mjs geonames <cities1000.txt | cities500.txt> [--world-min-pop 15000] [--tile 2]
//       GeoNames "cities" dump (https://download.geonames.org/export/dump/, CC BY 4.0, credit "GeoNames").
//       Keeps every US place, and places elsewhere with at least --world-min-pop people (default 15,000) to keep it small.
//       Populated places only (feature class P), without neighbourhoods (PPLX) and historical/abandoned/destroyed places.
//   node shared/places/build-places.mjs zonetab /usr/share/zoneinfo/zone.tab
//       The small SEED shipped until the GeoNames file is installed: the tz database's zone cities (public domain).
//
// Output: one tab-separated line per place "name<TAB>admin1<TAB>country<TAB>lat<TAB>lon" (admin1 = US state postal code;
// empty elsewhere), grouped into tiles of --tile degrees (default 2) so a page loads only the tiles around the aircraft.
// Nothing is invented: every name and coordinate comes from the input file.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const [mode, file, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? +rest[i + 1] : d; };
const TILE = opt('--tile', 2), MINPOP = opt('--world-min-pop', 15000);
if (!mode || !file) { console.error('usage: build-places.mjs geonames <cities1000.txt> | zonetab <zone.tab>'); process.exit(1); }
const places = [];
let meta;
if (mode === 'geonames') {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const f = line.split('\t'); if (f.length < 15) continue;
    const [name, lat, lon, fclass, fcode, cc, admin1, pop] = [f[1], +f[4], +f[5], f[6], f[7], f[8], f[10], +f[14]];
    if (fclass !== 'P' || /^PPL[XHQW]$/.test(fcode) || !Number.isFinite(lat) || !Number.isFinite(lon) || !name) continue;
    if (cc !== 'US' && !(pop >= MINPOP)) continue;
    places.push({ name, admin1: cc === 'US' ? admin1 : '', cc, lat, lon });
  }
  meta = { source: 'GeoNames ' + path.basename(file), credit: 'Place names: GeoNames (geonames.org), CC BY 4.0', license: 'CC BY 4.0', complete: true,
    note: 'US: all places in the file; elsewhere: ' + MINPOP + '+ people' };
} else if (mode === 'zonetab') {
  // US zone -> state (the zone names are unambiguous; coordinates come from zone.tab itself)
  const ST = { New_York: 'NY', Detroit: 'MI', Louisville: 'KY', Monticello: 'KY', Indianapolis: 'IN', Vincennes: 'IN', Winamac: 'IN', Marengo: 'IN',
    Petersburg: 'IN', Vevay: 'IN', Chicago: 'IL', Tell_City: 'IN', Knox: 'IN', Menominee: 'MI', Center: 'ND', New_Salem: 'ND', Beulah: 'ND', Denver: 'CO',
    Boise: 'ID', Phoenix: 'AZ', Los_Angeles: 'CA', Anchorage: 'AK', Juneau: 'AK', Sitka: 'AK', Metlakatla: 'AK', Yakutat: 'AK', Nome: 'AK', Adak: 'AK', Honolulu: 'HI' };
  const dms = (s, n) => { const sign = s[0] === '-' ? -1 : 1, d = s.slice(1); const deg = +d.slice(0, n), min = +d.slice(n, n + 2), sec = d.length > n + 2 ? +d.slice(n + 2, n + 4) : 0; return sign * (deg + min / 60 + sec / 3600); };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [cc, co, zone] = line.split('\t'); const m = /^([+-]\d+)([+-]\d+)$/.exec(co || ''); if (!m || /^Antarctica|^Etc/.test(zone)) continue;
    const city = zone.split('/').pop(), lat = dms(m[1], 2), lon = dms(m[2], 3);
    if (cc === 'US' && !ST[city]) continue;
    places.push({ name: city.replace(/_/g, ' '), admin1: cc === 'US' ? ST[city] : '', cc, lat, lon });
  }
  meta = { source: 'tz database zone.tab (seed)', credit: 'Place names (seed): tz database zone cities, public domain', license: 'public domain', complete: false,
    note: 'Seed only: about ' + places.length + ' cities worldwide. Install the GeoNames file (see build-places.mjs) for every town.' };
} else { console.error('unknown mode ' + mode); process.exit(1); }

const key = (lat, lon) => Math.floor(lat / TILE) * TILE + '_' + Math.floor(lon / TILE) * TILE;
const tiles = new Map();
for (const p of places) { const k = key(p.lat, p.lon); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(p); }
const dir = path.join(OUT, 'tiles'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let bytes = 0;
for (const [k, list] of tiles) {
  const txt = list.map((p) => [p.name.replace(/[\t\n]/g, ' '), p.admin1, p.cc, p.lat.toFixed(4), p.lon.toFixed(4)].join('\t')).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, k + '.txt'), txt); bytes += txt.length;
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ version: 1, ...meta, built: new Date().toISOString().slice(0, 10), tileDeg: TILE,
  count: places.length, tiles: [...tiles.keys()].sort() }) + '\n');
console.log(`${places.length} places in ${tiles.size} tiles (${(bytes / 1024).toFixed(0)} KB) -> ${dir}`);

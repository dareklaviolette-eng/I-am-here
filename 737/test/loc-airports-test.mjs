// Offline tests: card LOC (shared/places.js) and the EFB nearest-airports list (ourairports.js nearestFromRows).
// node 737/test/loc-airports-test.mjs
// FIXTURES ONLY: the places and airports below are approximate positions typed for this test (around Rocky Mountain
// Metropolitan, KBJC). They are not shipped and are not a data source.
import { pathToFileURL, fileURLToPath } from 'node:url'; import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url)), imp = (p) => import(pathToFileURL(path.join(here, p)));
const P = await imp('../../shared/places.js'), OA = await imp('../ourairports.js'), AC = await imp('../../shared/aircraft-class.js');
let fails = 0; const ok = (c, m, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info ? '  ' + info : '')); if (!c) fails++; };

const FIX_PLACES = [['Westminster', 'CO', 'US', 39.8367, -105.0372], ['Broomfield', 'CO', 'US', 39.9205, -105.0867], ['Boulder', 'CO', 'US', 40.0150, -105.2705],
  ['Fort Collins', 'CO', 'US', 40.5853, -105.0844], ['Denver', 'CO', 'US', 39.7392, -104.9847], ['Dubai', '', 'AE', 25.2048, 55.2708]];
const tileText = (rows) => rows.map((r) => r.join('\t')).join('\n') + '\n';
// a fake places folder served by fetchFn
const T = 2, key = (la, lo) => Math.floor(la / T) * T + '_' + Math.floor(lo / T) * T, tiles = {};
for (const r of FIX_PLACES) (tiles[key(r[3], r[4])] ||= []).push(r);
let fetched = [];
const fetchFn = async (u) => { fetched.push(u);
  if (u.endsWith('index.json')) return { ok: true, json: async () => ({ tileDeg: T, tiles: Object.keys(tiles), source: 'fixture', credit: 'fixture', complete: true }) };
  const k = /tiles\/(.+)\.txt$/.exec(u); if (k && tiles[k[1]]) return { ok: true, text: async () => tileText(tiles[k[1]]) };
  return { ok: false, status: 404 }; };

const pl = P.createPlaces({ base: 'x/', fetchFn });
const at = async (la, lo) => P.formatPlace(await pl.nearest(la, lo));
ok(await at(39.84, -105.04) === 'Westminster, CO', 'over Westminster -> "Westminster, CO" (no preposition)', await at(39.84, -105.04));
ok(await at(39.912, -105.11) === 'Broomfield, CO', 'at KBJC -> nearest town "Broomfield, CO"');
ok(await at(40.02, -105.25) === 'Boulder, CO', 'flying into Boulder -> switches to "Boulder, CO"');
ok(await at(40.55, -105.08) === 'Fort Collins, CO', '"Fort Collins, CO"');
ok(fetched.filter((u) => u.includes('tiles/')).length <= 9, 'only the tiles around the aircraft are loaded', fetched.length + ' requests');
ok(await at(25.25, 55.3) === 'Dubai, UAE', 'outside the US: "City, Country" with a short country name');
ok(!/\b(Over|Near|Off)\b/.test(await at(39.84, -105.04)), 'never a preposition');
ok(P.formatPlace(null) === '', 'nothing -> empty');
// grid index agrees with brute force on random points
const g = new P.PlaceGrid(0.25), pts = []; let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 3000; i++) { const p = { name: 'p' + i, lat: 35 + rnd() * 10, lon: -110 + rnd() * 12 }; pts.push(p); g.add(p); }
let agree = 0;
for (let k = 0; k < 200; k++) { const la = 35 + rnd() * 10, lo = -110 + rnd() * 12; const b = pts.reduce((m, p) => (P.distNm(la, lo, p.lat, p.lon) < P.distNm(la, lo, m.lat, m.lon) ? p : m));
  if (g.nearest(la, lo, 200).name === b.name) agree++; }
ok(agree === 200, 'grid nearest == brute force (200 random points)', agree + '/200');
// sparse place file: a nearer airfield town wins
const far = { name: 'Denver', admin1: 'CO', cc: 'US', distNm: 14 }, apt = { name: 'Broomfield', admin1: 'CO', cc: 'US', distNm: 2 };
ok(P.pickPlace(far, apt).name === 'Broomfield' && P.pickPlace(far, apt).via === 'airport', 'sparse file (nearest 14 nm) -> nearer airfield town');
ok(P.pickPlace({ ...far, distNm: 3 }, apt).name === 'Denver', 'file place within 8 nm wins');

// at sea (for ship pages): town within 12 nm, water body 12-200 nm, "· International waters" beyond
ok(P.seaLoc(36.9, -75.9, { name: 'Virginia Beach', admin1: 'VA', cc: 'US', distNm: 8 }) === 'Virginia Beach, VA', 'at sea within 12 nm: the town');
ok(P.seaLoc(36, -74, { name: 'X', cc: 'US', distNm: 60 }) === 'Atlantic Ocean' && P.seaLoc(33.5, -121, { distNm: 50 }) === 'Pacific Ocean', 'at sea 12-200 nm: the ocean');
ok(P.seaLoc(30, -40, { distNm: 900 }) === 'Atlantic Ocean \u00b7 International waters', 'beyond 200 nm: "Atlantic Ocean · International waters"');
ok(P.oceanName(25, -90) === 'Gulf of Mexico' && P.oceanName(-10, 80) === 'Indian Ocean' && P.oceanName(35, 18) === 'Mediterranean Sea', 'named waters');
// ---- EFB nearest airports
const ROWS = [
  ['KBJC', 'medium_airport', 'Rocky Mountain Metropolitan Airport', 39.9088, -105.1172, 'Denver', 'US-CO'],
  ['KDEN', 'large_airport', 'Denver International Airport', 39.8617, -104.6731, 'Denver', 'US-CO'],
  ['KAPA', 'medium_airport', 'Centennial Airport', 39.5701, -104.8493, 'Denver', 'US-CO'],
  ['KBDU', 'small_airport', 'Boulder Municipal Airport', 40.0394, -105.2258, 'Boulder', 'US-CO'],
  ['KEIK', 'small_airport', 'Erie Municipal Airport', 40.0103, -105.0481, 'Erie', 'US-CO'],
  ['KFNL', 'medium_airport', 'Northern Colorado Regional Airport', 40.4518, -105.0113, 'Loveland', 'US-CO'],
  ['CO99', 'heliport', 'Some Heliport', 39.91, -105.10, 'Westminster', 'US-CO'],
  ['KLAX', 'large_airport', 'Los Angeles International Airport', 33.9425, -118.4081, 'Los Angeles', 'US-CA'],
].map(([ident, type, name, latitude_deg, longitude_deg, municipality, iso_region]) => ({ ident, type, name, latitude_deg, longitude_deg, municipality, iso_region, iso_country: 'US' }));
const own = [39.85, -105.05];   // a few nm south-east of KBJC
const jet = OA.nearestFromRows(ROWS, ...own, { n: 10 });
ok(jet.map((a) => a.ident).join(',') === 'KBJC,KDEN,KAPA,KFNL', 'airline ride: large+medium only, nearest first, far ones (KLAX) out', jet.map((a) => a.ident).join(','));
const gaList = OA.nearestFromRows(ROWS, ...own, { n: 10, types: ['large_airport', 'medium_airport', 'small_airport'] });
ok(gaList[0].ident === 'KBJC' && gaList.some((a) => a.ident === 'KBDU') && !gaList.some((a) => a.type === 'heliport'), 'GA ride: small fields included, heliports not', gaList.map((a) => a.ident).join(','));
ok(gaList.every((a, i) => !i || gaList[i - 1].distNm <= a.distNm), 'sorted by distance');
const b = gaList[0]; const pad3 = (v) => String(Math.round(v) % 360).padStart(3, '0');
const label = `${b.ident} ${b.distNm.toFixed(0)} nm ${pad3(b.brg)}°`;
ok(/^KBJC \d nm \d{3}°$/.test(label) && b.brg > 270 && b.brg < 360, 'label "KBJC 4 nm 3xx°" (true bearing to the field)', label);
ok(OA.nearestFromRows(ROWS, ...own, { n: 2 }).length === 2, 'n caps the list');
ok(AC.isGA('C172') && AC.isGA('SR22') && AC.isGA('', 'A1') && !AC.isGA('B738') && !AC.isGA('A320') && !AC.isGA('C25A'), 'GA detection (C172, SR22, A1 yes; B738, A320, CJ no)');
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

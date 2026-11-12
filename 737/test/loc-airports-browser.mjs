// Headless test of the 737 page: card LOC and the EFB nearest-airports list, riding a (mocked) Cessna 172 near KBJC.
// node 737/test/loc-airports-browser.mjs [repoRoot]   Screenshot: /home/claude/out/shots/loc-efb-nearest.png
// FIXTURES ONLY: approximate positions typed for this test; not shipped, not a data source.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { start, sleep, FETCH_MOCK } from './harness.mjs';
const ROOT = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const H = await start({ root: ROOT });
let fails = 0; const ok = (c, m, info = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (info ? '  ' + info : '')); if (!c) fails++; };

const AP_HDR = '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
const AP = [[1, 'KBJC', 'medium_airport', 'Rocky Mountain Metropolitan Airport', 39.9088, -105.1172, 5673, 'Denver', 'BJC'], [2, 'KDEN', 'large_airport', 'Denver International Airport', 39.8617, -104.6731, 5434, 'Denver', 'DEN'],
  [3, 'KAPA', 'medium_airport', 'Centennial Airport', 39.5701, -104.8493, 5885, 'Denver', 'APA'], [4, 'KBDU', 'small_airport', 'Boulder Municipal Airport', 40.0394, -105.2258, 5288, 'Boulder', ''],
  [5, 'KEIK', 'small_airport', 'Erie Municipal Airport', 40.0103, -105.0481, 5119, 'Erie', ''], [6, 'KFNL', 'medium_airport', 'Northern Colorado Regional Airport', 40.4518, -105.0113, 5016, 'Loveland', 'FNL'],
  [7, 'KLAX', 'large_airport', 'Los Angeles International Airport', 33.9425, -118.4081, 128, 'Los Angeles', 'LAX']]
  .map(([id, ident, type, name, la, lo, el, mun, iata]) => `${id},"${ident}","${type}","${name}",${la},${lo},${el},"NA","US","US-CO","${mun}","yes","${ident}","${iata}","${ident}","${iata}","","",""`).join('\n');
const RW = '"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"\n' +
  '9,1,"KBJC",9000,100,"ASP","1","0","12L",39.9150,-105.1300,5673,128,,"30R",39.8990,-105.1030,5660,308,';
const PLACES = [['Westminster', 'CO', 'US', 39.8367, -105.0372], ['Broomfield', 'CO', 'US', 39.9205, -105.0867], ['Boulder', 'CO', 'US', 40.015, -105.2705], ['Denver', 'CO', 'US', 39.7392, -104.9847]];
await H.preload(FETCH_MOCK + `
  const now = () => Date.now(), C172 = { hex: 'a1c172', flight: 'N172TS', r: 'N172TS', t: 'C172', lat: 39.842, lon: -105.045, alt_baro: 7400, gs: 95, track: 300, baro_rate: 0, seen_pos: 1 };
  window.__mockRoutes = [
    [/ourairports-data\\/airports\\.csv/, () => ${JSON.stringify(AP_HDR + '\n' + AP + '\n')}],
    [/ourairports-data\\/runways\\.csv/, () => ${JSON.stringify(RW + '\n')}],
    [/airports\\/KBJC\\.json/, () => new Response('', { status: 404 })],
    [/shared\\/places\\/index\\.json/, () => ({ tileDeg: 2, tiles: ['38_-106', '40_-106'], source: 'test fixture', credit: 'Place names: test fixture', complete: true })],
    [/shared\\/places\\/tiles\\/(.+)\\.txt/, (u, m) => (${JSON.stringify(PLACES)}).filter((p) => Math.floor(p[3] / 2) * 2 + '_' + Math.floor(p[4] / 2) * 2 === m[1]).map((p) => p.join('\\t')).join('\\n') + '\\n'],
    [/\\/hex\\/a1c172|icao24=a1c172/, () => ({ now: now(), ac: [C172] })],
    [/\\/point\\/|\\/lat\\//, () => ({ now: now(), ac: [C172] })],
  ];`);
await H.open('/737/?flight=a1c172&cs=N172TS&lat=39.842&lon=-105.045');
await H.waitFor('window.__737loc && window.__737efb && window.__737 && __737.frames > 5', 90000, 'page running');
await H.waitFor("__737loc.text === 'Westminster, CO'", 40000, 'LOC Westminster').catch((e) => console.log(e.message));
const loc = await H.ev('__737loc.text');
ok(loc === 'Westminster, CO', 'LOC names the nearest town: "Westminster, CO"', JSON.stringify(loc));
ok(!/\b(Over|Near|Off|Cruising|Climbing|On approach)\b/i.test(loc), 'LOC has no preposition / phrase');
await H.ev("(() => { const m = document.querySelector('.imh-mini'); if (m && m.offsetParent) m.click(); })()"); await sleep(800);
ok(await H.ev("[...document.querySelectorAll('.imh-box')].some((b) => /LOC[\\s\\S]{0,40}Westminster, CO/.test(b.textContent))"), 'the card LOC row shows it');
await H.waitFor('__737efb.near().list.length >= 5', 30000, 'nearest list');
const near = await H.ev('__737efb.near().list.map((a) => [a.ident, +a.distNm.toFixed(1), Math.round(a.brg), a.type])');
console.log('   nearest:', JSON.stringify(near));
ok(near.every((a, i) => !i || near[i - 1][1] <= a[1]), 'EFB nearest airports sorted by distance');
ok(near.some((a) => a[3] === 'small_airport'), 'riding a C172 (GA): small airfields listed (KEIK, KBDU)');
ok(!near.some((a) => a[0] === 'KLAX'), 'no far-away airports');
// show the Airport tab on the tablet and photograph it
await H.ev('__737efb.efb.click({ x: 95, y: 400 }); __737efb.zoom(__737efb.efb.mounts[0]); __737efb.efb.draw(true)'); await sleep(2500);
const labels = await H.ev(`(() => { const L = []; const b = __737efb.efb; for (let y = 288; y < 600; y += 60) for (const x of [220, 510]) { const k = b.btnAt({ x, y: y + 20 }); if (k) L.push(k.label); } return L; })()`);
console.log('   EFB:', JSON.stringify(labels));
ok(labels.length >= 5 && labels.every((l) => /^[A-Z0-9]{3,4} \d+ nm \d{3}°$/.test(l)), 'EFB buttons read like "KBJC 6 nm 120°"');
ok(/^[A-Z0-9]{3,4} \d+ nm \d{3}°$/.test(labels[0] || ''), 'first EFB entry format', labels[0]);
await H.shot('/home/claude/out/shots/loc-efb-nearest.png');
ok((await H.ev('__737.frameErrors')) === 0, 'no frame errors', String(await H.ev('__737.frameErrors')));
console.log(H.logs.filter((l) => /EXCEPTION/.test(l)).join('\n'));
H.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);

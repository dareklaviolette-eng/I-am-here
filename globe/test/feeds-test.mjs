// Offline tests of the globe data layer: node globe/test/feeds-test.mjs
// Mock feeds only (recorded-format, synthetic). Nothing here touches the network.
import { pathToFileURL, fileURLToPath } from 'url'; import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const F = await import(pathToFileURL(path.join(here, '..', 'feeds.js')));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const T = Date.now();
const V2 = { now: T, ac: [
  { hex: 'a1b2c3', flight: 'SWA1234 ', r: 'N8711Q', t: 'B738', lat: 36.2, lon: -86.7, alt_baro: 8000, gs: 280, track: 90, baro_rate: -800, seen_pos: 2 },
  { hex: 'abc001', flight: 'AAL55', r: 'N117AN', t: 'A321', lat: 36.0, lon: -86.5, alt_baro: 'ground', gs: 12, track: 180, seen_pos: 45 },
  { hex: '~zz0001', lat: 36.1, lon: -86.6 },
  { hex: 'nolat', flight: 'X' },
] };
const fl = F.parseFlights(V2, T);
ok(fl.length === 3 && fl[0].flight === 'SWA1234' && fl[0].type === 'B738' && fl[1].onGround && fl[1].altFt === 0, 'v2 parse: trimmed callsign, type, ground; rows without a position dropped');
ok(F.isLive(fl[0], T) && !F.isLive(fl[1], T), 'live only under 30 s (2 s live, 45 s not)');
ok(F.is737(fl[0]) && !F.is737(fl[1]), '737 family detected by ICAO type');
ok(fl[2].gs === null && fl[2].type === '' && fl[2].orig === '', 'missing values stay empty (never invented)');
const cached = F.parseFlights({ now: T - 20000, ac: [{ hex: 'a1', lat: 1, lon: 2, seen_pos: 15 }] }, T);
ok(!F.isLive(cached[0], T), 'a cached relay answer (feed "now" 20 s old + seen 15 s) is not called live');
const alt = F.parseFlights({ flights: [{ icao24: 'A1B2C4', callsign: 'DAL9', type: 'b739', latitude: 40, longitude: -80, altitude: 30000, speed: 450, heading: 270, origin: 'katl', destination: 'kord', ts: Math.floor(T / 1000) - 3 }] }, T);
ok(alt[0].hex === 'a1b2c4' && alt[0].flight === 'DAL9' && alt[0].altFt === 30000 && alt[0].gs === 450 && alt[0].orig === 'KATL' && alt[0].dest === 'KORD' && F.is737(alt[0]) && F.ageS(alt[0], T) < 4,
  'alternate field names (relay /flights/area guess): icao24, callsign, origin/destination, ts in seconds');
const os = F.parseFlights({ states: [['a1b2c3', 'SWA1234 ', 'US', 0, T / 1000 - 2, -86.745, 35.98, 1889, false, 108, 20.5, -4.5, null, 1900]] }, T);
ok(os.length === 1 && os[0].type === '' && Math.round(os[0].gs) === 210, 'OpenSky shape accepted');

// FlightFeed: DIRECT browser feeds first, one request per refresh, taken in turn; relay (point, then area) only as a fallback;
// any 404 / non-JSON / { ok:false } from a relay route = unavailable -> next path in the same refresh
const calls = []; let mode = { direct: 200, relayPoint: 'okfalse', area: 404 };
const mk = (j, s = 200) => ({ ok: s === 200, status: s, json: async () => j });
const fetchFn = async (u) => { calls.push(u);
  if (/flights\/area/.test(u)) return mode.area === 200 ? mk(V2) : mk({ error: 'not allowed' }, mode.area);
  if (/workers\.dev\/lat\//.test(u)) return mode.relayPoint === 'okfalse' ? mk({ ok: false, upstream: 'adsb.lol: HTTP 403' }) : mode.relayPoint === 'html' ? { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } } : mk(V2);
  if (/airplanes\.live|adsb\.lol/.test(u)) { if (mode.direct === 200) return mk(V2); if (mode.direct === 'blocked') throw new TypeError('Load failed'); return mk({}, mode.direct); }
  throw new TypeError('blocked'); };
const sources = [{ name: 'airplanes.live', primary: true, point: (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}` },
  { name: 'adsb.lol', primary: true, point: (la, lo, nm) => `https://api.adsb.lol/v2/point/${la}/${lo}/${nm}` },
  { name: 'relay-point', point: (la, lo, nm) => `https://imhere-flights.bt4w8jn5ty.workers.dev/lat/${la.toFixed(4)}/lon/${lo.toFixed(4)}/dist/${nm}` }];
const feed = new F.FlightFeed({ fetchFn, onSite: true, sources });
const b = { s: 35, n: 37, w: -88, e: -85 };
let r = await feed.load(b);
ok(r.source === 'airplanes.live' && r.flights.length === 3 && calls.length === 1, 'direct feed first: one request per refresh');
calls.length = 0; r = await feed.load(b);
ok(r.source === 'adsb.lol' && calls.length === 1, 'next refresh goes to the next direct feed (requests spread across sources)');
mode.direct = 'blocked'; mode.area = 200; calls.length = 0; r = await feed.load(b);
ok(/relay/.test(r.source) && r.flights.length === 3 && feed.relayArea === true && calls.some((u) => /workers\.dev\/lat\//.test(u)), 'direct feeds down, relay point answers {ok:false} -> relay /flights/area in the same refresh');
mode.relayPoint = 'html'; mode.area = 404; let err = '';
const feed3 = new F.FlightFeed({ fetchFn, onSite: true, sources }); try { await feed3.load(b); } catch (e) { err = e.message; }
ok(/No live flight source reachable/.test(err) && feed3.relayArea === false, 'non-JSON relay answer and a 404 area route are "unavailable" (error, never an empty list)');
calls.length = 0; try { await feed3.load(b); } catch (e) { /* */ }
ok(!calls.some((u) => /flights\/area/.test(u)), 'after a 404 the area route is not asked again');
mode = { direct: 429, relayPoint: 'okfalse', area: 404 };
const feed4 = new F.FlightFeed({ fetchFn, onSite: false, sources: sources.slice(0, 2) }); try { await feed4.load(b); } catch (e) { /* */ }
mode.direct = 200; calls.length = 0;
const p4 = new F.FlightFeed({ fetchFn, onSite: false, sources: sources.slice(0, 2) }); p4.pool.fail('airplanes.live', 429);
r = await p4.load(b);
ok(r.source === 'adsb.lol' && !calls.some((u) => /airplanes\.live/.test(u)), 'a source that answered 429 rests (the next one is asked)');
const offsite = new F.FlightFeed({ fetchFn, onSite: false, sources }); calls.length = 0;
await offsite.load(b);
ok(!calls.some((u) => /flights\/area/.test(u)), 'off the GitHub site the relay area route is not tried (CORS is locked to the site)');
r = await offsite.load({ s: 20, n: 50, w: -110, e: -70 });
ok(r.coverage !== 'view' && r.coverage.nm === 250, 'wide view: point query capped at 250 nm, coverage reported');
err = ''; try { await new F.FlightFeed({ fetchFn: async () => { throw new TypeError('blocked'); }, onSite: false, sources }).load(b); } catch (e) { err = e.message; }
ok(/No live flight source reachable/.test(err), 'clear error when every source fails');

// search classification
const q = (s) => F.classifyQuery(s);
ok(q('WN 1234').callsigns.includes('SWA1234'), 'IATA flight number WN1234 -> callsign SWA1234');
ok(q('swa1234').callsigns[0] === 'SWA1234' && q('SWA1234').flightLike, 'callsign');
ok(q('N8711Q').reg === 'N8711Q' && q('G-EUPT').reg === 'GEUPT', 'tails (N-number, dashed foreign)');
ok(q('a1b2c3').hex === 'a1b2c3', 'ICAO hex');
ok(!q('Paris').flightLike && !q('bald eagle').flightLike && !q('Maersk Essen').flightLike, 'places, animals and ship names are not flight-like');
const items = [{ kind: 'flight', label: 'SWA1234', keys: ['SWA1234', 'N8711Q', 'a1b2c3'] }, { kind: 'wild', label: 'Bald eagle', keys: ['Bald eagle', 'eagle'] }, { kind: 'iss', keys: ['ISS', 'space station'] }];
ok(F.searchLocal(items, 'WN1234')[0].kind === 'flight' && F.searchLocal(items, 'eagle')[0].kind === 'wild' && F.searchLocal(items, 'iss')[0].kind === 'iss' && F.searchLocal(items, 'n8711q')[0].kind === 'flight', 'local search: flight number, tail, animal, ISS');

// find(): relay /flights/find absent -> direct callsign endpoint
const f2 = new F.FlightFeed({ onSite: true, sources, fetchFn: async (u) => /flights\/find/.test(u) ? mk({}, 404) : /callsign\/SWA1234$/.test(u) ? mk(V2) : mk({ ac: [] }) });
const found = await f2.find('WN1234');
ok(found && found.hex === 'a1b2c3', 'find WN1234 worldwide via the direct callsign endpoint (relay only as a fallback)');

// ships / ISS / clustering / links
const ships = F.parseShips({ ships: [{ mmsi: 366999, name: 'TEST VESSEL@@', lat: 37.8, lon: -122.4, sog: 12.1, cog: 45, at: T - 5000 }, { MetaData: { MMSI: 1, ShipName: 'X', latitude: 1, longitude: 2, time_utc: '2026-11-10 12:00:00.123456789 +0000 UTC' } }] }, T);
ok(ships.length === 2 && ships[0].name === 'TEST VESSEL' && ships[1].mmsi === '1' && Number.isFinite(ships[1].fixAt), 'ship snapshot parse (flat and aisstream-like)');
const st = {}; const sr = await F.loadShips({ s: 37, n: 38, w: -123, e: -122 }, { onSite: true, state: st, fetchFn: async () => mk({ error: 'not allowed' }, 404) });
ok(sr === null && st.snapshot === false, 'no /ais/snapshot -> remembered, page shows the Boats hint');
ok((await F.loadShips({ s: 0, n: 40, w: -130, e: -60 }, { onSite: true, state: {}, fetchFn })).tooWide, 'ships: continent-wide view asks to zoom in');
const boxes = []; const sr2 = await F.loadShips({ s: 34, n: 42, w: -126, e: -118 }, { onSite: true, state: {}, fetchFn: async (u) => { boxes.push(u); return mk({ ships: [] }); } });
ok(sr2.clipped && /box=35\.010,-124\.990,40\.990,-119\.010/.test(boxes[0]), 'ships: 8° view clipped to the relay 6° box around the centre ' + boxes[0]);
const st3 = {}; ok(await F.loadShips({ s: 37, n: 38, w: -123, e: -122 }, { onSite: false, state: st3, fetchFn }) === null && st3.snapshot === false, 'ships off the GitHub site: Boats hint (relay CORS)');
const iss = F.parseISS({ latitude: 10.5, longitude: -40.2, altitude: 420.1, velocity: 27600, visibility: 'daylight', timestamp: Math.floor(T / 1000) });
ok(iss.lat === 10.5 && iss.altKm === 420.1 && Math.abs(iss.fixAt - T) < 1000, 'ISS (wheretheiss.at shape)');
const iss2 = await F.loadISS({ onSite: true, state: {}, fetchFn: async (u) => /workers\.dev\/iss/.test(u) ? mk({}, 404) : mk({ latitude: 1, longitude: 2, timestamp: T / 1000 }) });
ok(iss2 && iss2.source === 'wheretheiss.at', 'ISS: relay /iss missing -> wheretheiss.at');
const pts = Array.from({ length: 100 }, (_, i) => ({ x: (i % 10) * 10, y: Math.floor(i / 10) * 10 }));
const cl = F.cluster(pts, 50);
ok(cl.length === 4 && cl.reduce((a, c) => a + c.n, 0) === 100, 'grid clustering keeps every point and counts per area');
const [pl] = F.predict({ lat: 0, lon: 0, gs: 360, track: 0, fixAt: T - 60000 }, T);
ok(Math.abs(pl - 0.05) < 0.002, 'dead reckoning capped at 30 s (360 kt north -> 3 nm)');
const url = F.joinURL(fl[0]);
ok(url === '../737/?flight=a1b2c3&cs=SWA1234&lat=36.200&lon=-86.700', 'Be there link: ' + url);

// Flightradar24 through the relay (client side: 737/live-flights.js), mocked relay answers
const L = await import(pathToFileURL(path.join(here, '..', '..', '737', 'live-flights.js')));
ok(L.fr24Query({ flight: 'SWA1234 ', reg: 'N8711Q' }) === 'callsign=SWA1234' && L.fr24Query({ flight: '', reg: 'N8711Q' }) === 'reg=N8711Q' && L.fr24Query({ hex: 'a1b2c3' }) === null,
  'FR24 query: callsign first, then registration, nothing for a bare hex');
const FRJ = { ok: true, lat: 36.2, lon: -86.75, alt_ft: 11000, gs_kt: 300, track: 50, vs_fpm: -640, callsign: 'SWA1234', flight: 'WN1234', reg: 'N8711Q', type: 'b38m', orig: 'KMDW', dest: 'KBNA', ts: T - 3000, hex: 'A1B2C3', source: 'Flightradar24' };
const pr = L.parseFR24(FRJ, T);
ok(pr.hex === 'a1b2c3' && pr.flight === 'SWA1234' && pr.type === 'B38M' && pr.altFt === 11000 && pr.gs === 300 && pr.vr === -640 && pr.fixAt === T - 3000 && pr.orig === 'KMDW' && pr.fr24 === true,
  'FR24 relay answer -> flight record (callsign as flight, fix time from ts)');
ok(L.parseFR24({ ok: false, error: 'cap' }) === null, 'FR24 error answer is not a position');
const fr = (status, body) => async (u) => { fr.last = u; return { ok: status === 200, status, json: async () => body }; };
let got = await L.fetchFR24({ flight: 'SWA1234' }, { fetchFn: fr(200, FRJ) });
ok(got.source === 'Flightradar24' && got.flight.lat === 36.2 && /\/fr24\/flight\?callsign=SWA1234$/.test(fr.last), 'fetchFR24 asks RELAY/fr24/flight?callsign=');
const errOf = async (status, body) => { try { await L.fetchFR24({ flight: 'SWA1234' }, { fetchFn: fr(status, body) }); return null; } catch (e) { return e; } };
const eCap = await errOf(429, { ok: false, error: 'cap' }), eNo = await errOf(503, { ok: false, error: 'not_configured' }), eNf = await errOf(404, { ok: false, error: 'not_found' });
ok(eCap.code === 'cap' && eNo.code === 'not_configured' && eNf.code === 'not_found', 'fetchFR24 errors carry the relay code (cap, not_configured, not_found)');
const fol = new L.FR24Follow({ every: 20000 });
ok(fol.due(T) && !fol.healthy(T), 'follow: due at start, not yet healthy');
fol.ok(T); ok(!fol.due(T + 19000) && fol.due(T + 20000) && fol.healthy(T + 19000), 'follow: next FR24 call 20 s after a fix; healthy meanwhile');
fol.fail(eCap, T); ok(!fol.healthy(T) && !fol.due(T + 899000) && fol.due(T + 900000), 'follow: cap -> FR24 rests 15 min (free feeds meanwhile)');
fol.fail(eNf, T); ok(fol.due(T + 120000) && !fol.due(T + 119000), 'follow: not found -> retry in 2 min');
fol.fail(eNo, T); ok(!fol.due(T + 3599000), 'follow: not set up -> rests 1 h');
ok(!new L.FR24Follow({ enabled: false }).due(T), 'follow: off the GitHub site it is never due');
const tr = new L.Tracker();
tr.onFix({ lat: 36, lon: -86, altFt: 10000, gs: 360, track: 0, vr: 0, fixAt: T - 1000 }, T);
ok(!tr.onFix({ lat: 36, lon: -86, altFt: 10000, gs: 360, track: 0, vr: 0, fixAt: T - 3000 }, T), 'tracker: an older report is ignored');
ok(tr.onFix({ lat: 36.001, lon: -86, altFt: 10000, gs: 360, track: 0, vr: 0, fixAt: T - 3000 }, T, true), 'tracker: an older report is taken when switching source (force)');
tr.freshS = L.FR24_FRESH_S; tr.extrapMax = L.FR24_EXTRAP_MAX;
const st40 = tr.state(T + 37000), st90 = tr.state(T + 90000);
ok(st40.live && !st40.frozen && st40.lat > 36.05 && st90.frozen, 'tracker with FR24 limits: live 40 s after a fix, dead reckoning moves it on, holds after 75 s');
const fp = F.predict({ lat: 0, lon: 0, gs: 360, track: 0, fixAt: T - 60000, extrapS: 75 }, T)[0];
ok(Math.abs(fp - 0.1) < 0.003 && F.isLive({ fixAt: T - 40000, freshS: 50 }, T) && !F.isLive({ fixAt: T - 40000 }, T), 'globe: FR24 records dead-reckon up to 75 s and count as live up to 50 s');
// globe area fallback: /fr24/area only after every free source failed, on the site
const af = []; const areaFeed = new F.FlightFeed({ onSite: true, sources: sources.slice(0, 2), fetchFn: async (u) => { af.push(u); if (/fr24\/area/.test(u)) return mk({ ok: true, source: 'Flightradar24', now: T, flights: [{ ...FRJ, alt: 11000, gs: 300 }] }); throw new TypeError('blocked'); } });
r = await areaFeed.load(b);
ok(r.source === 'Flightradar24' && r.flights[0].hex === 'a1b2c3' && r.flights[0].fr24 && /fr24\/area\?bounds=37\.000,35\.000,-88\.000,-85\.000&limit=300$/.test(af[af.length - 1]) && af.filter((u) => /fr24/.test(u)).length === 1,
  'globe: FR24 area (bounds N,S,W,E, limit 300) only as the last fallback');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);

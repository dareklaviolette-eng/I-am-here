// I'M HERE globe hub: pick anything real on the map and "Be there".
// Layers: Flights (live ADS-B), Ships (relay snapshot, if the relay has one), Space (ISS), Wildlife (SAMPLE tracks).
// Only the visible area is loaded; wide views show counts instead of every icon.
import { TinyMap } from './map.js';
import { FlightFeed, is737, ageS, isLive, FRESH_S, predict, cluster, joinURL, typeName, airlineOf, classifyQuery, searchLocal,
  boundsRadiusNm, loadShips, loadISS, ON_SITE } from './feeds.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = window.__GLOBE_TEST || {};          // tests inject fetch and timing here
const fetchFn = TEST.fetch || ((u, o) => fetch(u, o));
const REFRESH_MS = TEST.refreshMs || 6000;

// ------------------------------------------------------------------ state
const LS = 'imhere.globe.';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS + 'state') || '{}'); } catch (e) { return {}; } })();
const on = Object.assign({ flights: true, ships: false, space: true, wildlife: true }, saved.layers || {});
const S = {
  flights: new Map(), flightSrc: '', flightAt: 0, flightErr: '', coverage: 'view', loadedBounds: null, busy: false, lastLoad: 0, summary: null, wide: false,
  ships: [], shipState: {}, shipAt: 0, shipNote: '', shipBusy: false,
  iss: null, issState: {}, issAt: 0,
  wild: [], sel: null, hits: [], pinned: null,
};
const feed = new FlightFeed({ fetchFn, onSite: TEST.onSite ?? ON_SITE });
window.__globe = { S, on, feed, get map() { return map; } };   // for tests and the console

// ------------------------------------------------------------------ map
const v0 = { lat: +params.get('lat') || saved.lat || 36.12, lon: +params.get('lon') || saved.lon || -86.68, zoom: +params.get('z') || saved.zoom || 7 };
const map = new TinyMap($('map'), {
  layers: [
    { url: TEST.tiles || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
    { url: TEST.labels || 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
  ],
  lat: v0.lat, lon: v0.lon, zoom: v0.zoom, minZoom: 2, maxZoom: 16,
  draw: drawLayers, onChange: viewChanged, onTap: tap,
});
$('zin').onclick = () => map.zoomAround(map.w / 2, map.h / 2, 1);
$('zout').onclick = () => map.zoomAround(map.w / 2, map.h / 2, -1);
let viewTimer = 0;
function viewChanged() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => { save(); refreshAll(true); }, 450);
}
function save() { try { localStorage.setItem(LS + 'state', JSON.stringify({ layers: on, lat: +map.lat.toFixed(4), lon: +map.lon.toFixed(4), zoom: +map.zoom.toFixed(2) })); } catch (e) { /* private mode */ } }

// ------------------------------------------------------------------ layer toggles
document.querySelectorAll('.layer[data-layer]').forEach((b) => {
  const k = b.dataset.layer; if (b.disabled) return;
  b.classList.toggle('on', !!on[k]); b.setAttribute('aria-pressed', !!on[k]);
  b.onclick = () => setLayer(k, !on[k]);
});
function setLayer(k, v) {
  on[k] = v; const b = document.querySelector(`.layer[data-layer="${k}"]`);
  if (b) { b.classList.toggle('on', v); b.setAttribute('aria-pressed', v); }
  if (!v && S.sel && S.sel.kind === ({ flights: 'flight', ships: 'ship', space: 'iss', wildlife: 'wild' })[k]) closeCard();
  save(); refreshAll(true); map.invalidate();
}
$('panelToggle').onclick = () => { const o = $('panel').classList.toggle('open'); $('panelToggle').setAttribute('aria-expanded', o); };

// ------------------------------------------------------------------ loading (only the visible area)
async function loadFlights(force) {
  if (!on.flights || S.busy) return;
  const b = map.bounds();
  if (!force && Date.now() - S.lastLoad < REFRESH_MS) return;
  S.busy = true; S.lastLoad = Date.now();
  try {
    const radius = boundsRadiusNm(b);
    S.wide = radius > 1500;
    if (S.wide) S.summary = await feed.summary(b); else S.summary = null;
    const r = await feed.load(b);
    const next = new Map();
    for (const f of r.flights) if (f.hex) next.set(f.hex, f);
    if (S.pinned && !next.has(S.pinned.hex)) next.set(S.pinned.hex, S.flights.get(S.pinned.hex) || S.pinned);   // a searched-for flight stays
    S.flights = next; S.flightSrc = r.source; S.flightAt = Date.now(); S.flightErr = ''; S.coverage = r.coverage; S.loadedBounds = b;
    if (S.sel && S.sel.kind === 'flight') { const f = S.flights.get(S.sel.ref.hex); if (f) S.sel.ref = f; }
  } catch (e) { S.flightErr = e.message; }
  finally { S.busy = false; status(); map.invalidate(); if (S.sel) renderCard(); }
}
async function loadShipsNow(force) {
  if (!on.ships || S.shipBusy) return;
  if (!force && Date.now() - S.shipAt < 20000) return;
  S.shipBusy = true; S.shipAt = Date.now();
  try {
    const r = await loadShips(map.bounds(), { fetchFn, state: S.shipState, onSite: TEST.onSite ?? ON_SITE });
    if (r === null) { S.ships = []; S.shipNote = S.shipState.snapshot === false ? 'Live ships open in Boats (no ship snapshot on the relay yet).' : 'Ships not reachable right now.'; }
    else if (r.tooWide) { S.shipNote = 'Zoom in to see ships.'; S.ships = []; }
    else { S.ships = r.ships; S.shipNote = `${r.ships.length} ships` + (r.clipped ? ' within 3° of the centre' : ' in view') + ` · AIS via I'M HERE relay`; }
  } finally { S.shipBusy = false; status(); map.invalidate(); }
}
async function loadIssNow(force) {
  if (!on.space) return;
  if (!force && Date.now() - S.issAt < 10000) return;
  S.issAt = Date.now();
  const r = await loadISS({ fetchFn, onSite: TEST.onSite ?? ON_SITE, state: S.issState });
  if (r) S.iss = r;
  status(); map.invalidate(); if (S.sel && S.sel.kind === 'iss') { S.sel.ref = S.iss; renderCard(); }
}
async function loadWild() {
  try { const j = await (await fetchFn('wildlife-samples.json')).json(); S.wild = j.tracks || []; map.invalidate(); } catch (e) { S.wild = []; }
}
function refreshAll(force) { loadFlights(force); loadShipsNow(force); loadIssNow(force); }
setInterval(() => { refreshAll(false); }, 1000);
setInterval(() => { if (on.flights && map.zoom >= 6) map.invalidate(); if (S.sel) renderCard(); }, 1000);   // planes move between reports
loadWild();

// ------------------------------------------------------------------ drawing
const PLANE = new Path2D('M0,-10 L1.6,-6 L1.6,-2 L9,2.5 L9,4.2 L1.6,2 L1.4,7 L4,9 L4,10.3 L0,9.3 L-4,10.3 L-4,9 L-1.4,7 L-1.6,2 L-9,4.2 L-9,2.5 L-1.6,-2 L-1.6,-6 Z');
const SHIP = new Path2D('M0,-8 L5,6 L0,3 L-5,6 Z');
function drawLayers(g, m) {
  const hits = []; const W = m.w, H = m.h, pad = 30, now = Date.now();
  const vis = (x, y) => x > -pad && y > -pad && x < W + pad && y < H + pad;
  // point-feed coverage ring (wide view loaded around its centre only)
  if (on.flights && S.coverage && S.coverage !== 'view') {
    const [cx, cy] = m.toScreen(S.coverage.lat, S.coverage.lon), [, ey] = m.toScreen(S.coverage.lat + S.coverage.nm / 60, S.coverage.lon);
    g.beginPath(); g.arc(cx, cy, Math.abs(cy - ey), 0, 2 * Math.PI); g.setLineDash([6, 6]); g.strokeStyle = 'rgba(255,194,74,.45)'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
  }
  // wildlife sample tracks
  if (on.wildlife) for (const t of S.wild) {
    g.beginPath(); let first = true, last = null;
    for (const [la, lo] of t.path) { const [x, y] = m.toScreen(la, lo); if (first) g.moveTo(x, y); else g.lineTo(x, y); first = false; last = [x, y]; }
    g.strokeStyle = 'rgba(255,138,61,.9)'; g.lineWidth = 2.5; g.setLineDash([7, 5]); g.stroke(); g.setLineDash([]);
    if (last && vis(...last)) {
      dot(g, last[0], last[1], 7, '#ff8a3d', S.sel && S.sel.kind === 'wild' && S.sel.ref.id === t.id);
      label(g, last[0] + 11, last[1] + 4, t.name + ' · Sample track', '#ffd2b3');
      hits.push({ x: last[0], y: last[1], r: 22, kind: 'wild', ref: t });
    }
  }
  // ships
  if (on.ships && S.ships.length) {
    const pts = []; for (const s of S.ships) { const [x, y] = m.toScreen(s.lat, s.lon); if (vis(x, y)) pts.push({ x, y, s }); }
    for (const c of pts.length > 250 || m.zoom < 7 ? cluster(pts, 52) : pts.map((p) => ({ ...p, n: 1, items: [p] }))) {
      if (c.n > 1) { bubble(g, c.x, c.y, c.n, 'rgba(79,209,232,.85)'); hits.push({ x: c.x, y: c.y, r: 20, kind: 'cluster' }); continue; }
      const s = c.items[0].s;
      g.save(); g.translate(c.x, c.y); g.rotate((s.cog || 0) * Math.PI / 180); g.fillStyle = '#4fd1e8'; g.strokeStyle = '#06202a'; g.lineWidth = 1.5; g.stroke(SHIP); g.fill(SHIP); g.restore();
      if (S.sel && S.sel.kind === 'ship' && S.sel.ref.mmsi === s.mmsi) ring(g, c.x, c.y);
      hits.push({ x: c.x, y: c.y, r: 18, kind: 'ship', ref: s });
    }
  }
  // flights
  if (on.flights) {
    if (S.summary && S.summary.length) for (const c of S.summary) { const [x, y] = m.toScreen(c.lat, c.lon); if (vis(x, y)) bubble(g, x, y, c.n, 'rgba(255,255,255,.35)'); }
    const pts = [];
    for (const f of S.flights.values()) { const [la, lo] = predict(f, now), [x, y] = m.toScreen(la, lo); if (vis(x, y)) pts.push({ x, y, f }); }
    const clustered = m.zoom < 7 || pts.length > 350;   // counts per area when zoomed out; single aircraft still draw as planes
    const groups = clustered ? cluster(pts, m.zoom < 5 ? 64 : 48) : pts.map((p) => ({ x: p.x, y: p.y, n: 1, items: [p] }));
    groups.sort((a, b) => (a.n === 1 && is737(a.items[0].f)) - (b.n === 1 && is737(b.items[0].f)));   // 737s drawn on top
    for (const c of groups) {
      if (c.n > 1) {
        const n737 = c.items.filter((p) => is737(p.f)).length;
        bubble(g, c.x, c.y, c.n, 'rgba(20,32,52,.88)', n737 ? '#ffc24a' : 'rgba(255,255,255,.7)');
        hits.push({ x: c.x, y: c.y, r: 22, kind: 'cluster' }); continue;
      }
      const f = c.items[0].f, b7 = is737(f), sel = S.sel && S.sel.kind === 'flight' && S.sel.ref.hex === f.hex;
      g.save(); g.translate(c.x, c.y); g.rotate((f.track || 0) * Math.PI / 180);
      const sc = f.onGround ? 0.75 : b7 ? 1.25 : 1; g.scale(sc, sc);
      g.lineWidth = 2.2 / sc; g.strokeStyle = 'rgba(0,0,0,.75)'; g.stroke(PLANE);
      g.fillStyle = f.onGround ? '#9fb0c0' : b7 ? '#ffc24a' : '#ffffff'; g.fill(PLANE); g.restore();
      if (sel) ring(g, c.x, c.y);
      if (b7 && m.zoom >= 8 && f.flight) label(g, c.x + 13, c.y - 8, f.flight, '#ffe3a3');
      hits.push({ x: c.x, y: c.y, r: 20, kind: 'flight', ref: f });
    }
    S.drawn = { planes: groups.filter((c) => c.n === 1).length, clusters: groups.filter((c) => c.n > 1).length, total: pts.length };
  }
  // ISS
  if (on.space && S.iss) {
    const [x, y] = m.toScreen(S.iss.lat, S.iss.lon);
    if (vis(x, y)) {
      g.save(); g.translate(x, y); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.fillRect(-12, -2, 24, 4); g.strokeRect(-12, -2, 24, 4); g.fillStyle = '#7fb2ff'; g.fillRect(-12, -7, 6, 14); g.fillRect(6, -7, 6, 14); g.strokeRect(-12, -7, 6, 14); g.strokeRect(6, -7, 6, 14);
      g.fillStyle = '#fff'; g.fillRect(-3, -4, 6, 8); g.restore();
      label(g, x + 16, y + 4, 'ISS', '#fff');
      if (S.sel && S.sel.kind === 'iss') ring(g, x, y);
      hits.push({ x, y, r: 24, kind: 'iss', ref: S.iss });
    }
  }
  S.hits = hits;
}
function dot(g, x, y, r, c, sel) { g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = c; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); if (sel) ring(g, x, y); }
function ring(g, x, y) { g.beginPath(); g.arc(x, y, 17, 0, 2 * Math.PI); g.lineWidth = 2.5; g.strokeStyle = '#5DCAA5'; g.stroke(); }
function bubble(g, x, y, n, fill, edge = 'rgba(255,255,255,.7)') {
  const r = 12 + Math.min(16, Math.log2(n + 1) * 3);
  g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = fill; g.fill(); g.lineWidth = 2; g.strokeStyle = edge; g.stroke();
  g.fillStyle = '#fff'; g.font = '600 12px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n), x, y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
function label(g, x, y, t, c) { g.font = '600 12px system-ui,sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(t, x, y); g.fillStyle = c; g.fillText(t, x, y); }

// ------------------------------------------------------------------ tap & card
function tap(x, y) {
  let best = null, bd = 1e9;
  for (const h of S.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { bd = d; best = h; } }
  if (!best) { closeCard(); return; }
  if (best.kind === 'cluster') { map.zoomAround(best.x, best.y, 2); return; }
  select(best.kind, best.ref);
}
function select(kind, ref) { S.sel = { kind, ref }; renderCard(); map.invalidate(); }
function closeCard() { S.sel = null; S.pinned = null; $('card').hidden = true; map.invalidate(); }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtAge = (s) => s < 90 ? Math.round(s) + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
const article = (t) => (/^[AEFHILMNORSX8]/i.test(t) ? 'an' : 'a');
const n0 = (v) => Math.round(v).toLocaleString('en-US');
function renderCard() {
  const c = $('card'), sel = S.sel; if (!sel) { c.hidden = true; return; }
  let h = '';
  if (sel.kind === 'flight') {
    const f = sel.ref, b7 = is737(f), a = ageS(f), live = isLive(f), name = f.flight || f.reg || f.hex.toUpperCase(), air = airlineOf(f.flight);
    const route = f.orig || f.dest ? `${esc(f.orig || '?')} → ${esc(f.dest || '?')}` : '<span style="color:var(--dim)">not in the feed</span>';
    h = `<div class="kind">Flight${b7 ? '<span class="badge">737 family</span>' : ''}</div><div class="title">${esc(name)}</div>
      <div class="sub">${esc([air, typeName(f.type) || 'type not reported', f.reg && f.reg !== name ? f.reg : ''].filter(Boolean).join(' · '))}</div>
      <dl><dt>Altitude</dt><dd>${f.onGround ? 'on the ground' : f.altFt != null ? n0(f.altFt) + ' ft' : 'not in the feed'}</dd>
      <dt>Speed</dt><dd>${f.gs != null ? n0(f.gs) + ' kt ground speed' : 'not in the feed'}</dd>
      <dt>Heading</dt><dd>${f.track != null ? String(Math.round(f.track)).padStart(3, '0') + '°' : '—'}${f.vr && Math.abs(f.vr) > 200 ? (f.vr > 0 ? ' · climbing ' : ' · descending ') + n0(Math.abs(f.vr)) + ' fpm' : ''}</dd>
      <dt>Route</dt><dd>${route}</dd></dl>
      <div class="age">${live ? '<span class="live">● live</span> · ' : ''}last report ${fmtAge(a)} · ${esc(S.flightSrc || 'ADS-B')}</div>
      ${b7 ? '' : `<div class="note">Cockpit shown is a 737-800; this flight is ${f.type ? article(typeName(f.type)) + ' ' + esc(typeName(f.type)) : 'of a type the feed did not report'}.</div>`}
      <a class="go" id="beThere" href="${esc(joinURL(f))}">Be there</a>`;
  } else if (sel.kind === 'ship') {
    const s = sel.ref, a = Math.max(0, (Date.now() - s.fixAt) / 1000);
    h = `<div class="kind">Ship</div><div class="title">${esc(s.name || 'MMSI ' + s.mmsi)}</div><div class="sub">${esc([s.type, s.mmsi ? 'MMSI ' + s.mmsi : ''].filter(Boolean).join(' · '))}</div>
      <dl><dt>Speed</dt><dd>${s.sog != null ? s.sog.toFixed(1) + ' kn' : 'not in the feed'}</dd><dt>Course</dt><dd>${s.cog != null ? Math.round(s.cog) + '°' : '—'}</dd>
      ${s.dest ? `<dt>Destination</dt><dd>${esc(s.dest)}</dd>` : ''}</dl>
      <div class="age">${a < 180 ? '<span class="live">● live</span> · ' : ''}last report ${fmtAge(a)} · AIS</div>
      <a class="go" href="../boats/">Be there</a><div class="age" style="margin-top:6px">Opens live ships (pick this ship there).</div>`;
  } else if (sel.kind === 'iss') {
    const s = sel.ref, a = Math.max(0, (Date.now() - s.fixAt) / 1000);
    h = `<div class="kind">Space</div><div class="title">International Space Station</div><div class="sub">NORAD 25544</div>
      <dl><dt>Altitude</dt><dd>${s.altKm != null ? n0(s.altKm) + ' km' : '—'}</dd><dt>Speed</dt><dd>${s.kmh != null ? n0(s.kmh) + ' km/h' : '—'}</dd>
      <dt>Over</dt><dd>${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°${s.visibility ? ' · ' + esc(s.visibility) : ''}</dd></dl>
      <div class="age">${a < FRESH_S ? '<span class="live">● live</span> · ' : ''}position ${fmtAge(a)} · ${esc(s.source)}</div>
      <a class="go" href="../space/">Be there</a>`;
  } else if (sel.kind === 'wild') {
    const t = sel.ref;
    h = `<div class="kind">Wildlife</div><div class="title">${esc(t.name)}</div><div class="sub">${esc(t.label)} · tag ${esc(t.tag)}</div>
      <div class="note">Sample track: synthetic, not real animal data. Real tracks (Movebank) can be loaded inside the ride.</div>
      <a class="go" href="../wildlife/?track=${encodeURIComponent(t.id)}">Be there</a>`;
  }
  c.innerHTML = '<button class="x" aria-label="Close">×</button>' + h; c.hidden = false;
  c.querySelector('.x').onclick = closeCard;
}

// ------------------------------------------------------------------ status lines + watermark
function status() {
  const nF = S.flights.size, n7 = [...S.flights.values()].filter(is737).length;
  $('nFlights').textContent = on.flights ? (S.flightErr && !nF ? 'not reachable' : `${nF} in view · ${n7} 737s`) : 'off';
  $('stFlights').textContent = !on.flights ? '' : S.flightErr ? 'Flights: ' + S.flightErr.slice(0, 160)
    : S.flightAt ? `Flights: ${S.flightSrc}, refreshed every ${REFRESH_MS / 1000} s.` + (S.coverage !== 'view' ? ` Wide view: aircraft within ${S.coverage.nm} nm of the centre${S.summary ? ', counts elsewhere' : ''}.` : '') : 'Flights: loading…';
  $('nShips').textContent = on.ships ? (S.ships.length ? S.ships.length + ' in view' : 'open Boats') : 'off';
  $('stShips').textContent = on.ships ? 'Ships: ' + (S.shipNote || 'loading…') : '';
  $('nSpace').textContent = on.space ? (S.iss ? 'ISS' : 'ISS · loading') : 'off';
  $('stSpace').textContent = on.space && !S.iss && S.issAt ? 'Space: ISS position not reachable right now.' : '';
  const showHint = on.ships && S.shipState.snapshot === false && map.zoom >= 4;
  $('hint').hidden = !showHint;
  $('dataCredit').textContent = [on.flights && S.flightSrc ? 'Flights: ' + S.flightSrc : '', on.space && S.iss ? 'ISS: ' + S.iss.source : ''].filter(Boolean).join(' · ');
  const MARK = window.ImHereMark; if (!MARK) return;
  const fresh = on.flights && [...S.flights.values()].some((f) => isLive(f));
  MARK.update({ signal: on.flights && S.flightAt ? { source: S.flightSrc, time: S.flightAt } : { text: 'Map' }, view: 'Satellite imagery (Esri), not live' });
  MARK.setLive(!!fresh);
}
if (window.ImHereMark) window.ImHereMark.init({ line1: "Globe · pick anything real", line2: 'Where do you want to be?', view: 'Satellite imagery (Esri), not live',
  items: [
    { kind: 'live', label: 'Aircraft', source: 'ADS-B community feeds (adsb.lol, adsb.fi, airplanes.live, OpenSky) via the I\'M HERE relay or directly' },
    { kind: 'live', label: 'Space station', source: 'wheretheiss.at' },
    { kind: 'sample', label: 'Animal tracks', source: 'Synthetic sample tracks from the Wildlife ride; not real animals' },
    { kind: 'recorded', label: 'Satellite map', source: 'Esri World Imagery: captured on past dates, not live' }] });
// keep the watermark small: collapse it to the corner mark right away
setTimeout(() => { try { window.ImHereMark && window.ImHereMark.dismiss && window.ImHereMark.dismiss(); } catch (e) { /* */ } }, TEST.markMs ?? 2500);

// ------------------------------------------------------------------ search: "Where do you want to be?"
const ANIMAL_KEYS = { eagle: ['eagle', 'bald eagle', 'bird', '4417'], shark: ['shark', 'white shark', 'great white', '2208'] };
function localItems() {
  const items = [];
  for (const f of S.flights.values()) items.push({ kind: 'flight', ref: f, label: f.flight || f.reg || f.hex.toUpperCase(),
    sub: [airlineOf(f.flight), typeName(f.type), f.reg].filter(Boolean).join(' · ') + ' · in view', keys: [f.flight, f.reg, f.hex] });
  for (const s of S.ships) items.push({ kind: 'ship', ref: s, label: s.name || 'MMSI ' + s.mmsi, sub: 'Ship · in view', keys: [s.name, s.mmsi] });
  for (const t of S.wild) items.push({ kind: 'wild', ref: t, label: t.name, sub: 'Wildlife · sample track', keys: [t.name, t.label, ...(ANIMAL_KEYS[t.id] || [])] });
  items.push({ kind: 'iss', ref: null, label: 'International Space Station', sub: 'Space · live position', keys: ['ISS', 'space station', 'international space station', 'space'] });
  items.push({ kind: 'link', ref: '../heart/', label: 'Heart', sub: 'Tour through the heart', keys: ['heart', 'body'] });
  return items;
}
let suggest = [];
$('q').addEventListener('input', () => { suggest = searchLocal(localItems(), $('q').value, 6); renderSugg(); note(''); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go($('q').value); } if (e.key === 'Escape') { $('q').value = ''; suggest = []; renderSugg(); } });
function renderSugg() {
  const ul = $('sugg'); ul.textContent = '';
  suggest.forEach((it) => { const li = document.createElement('li'), b = document.createElement('button');
    b.innerHTML = `${esc(it.label)}<small>${esc(it.sub)}</small>`; b.onclick = () => pick(it); li.appendChild(b); ul.appendChild(li); });
}
const note = (t) => { $('searchNote').textContent = t; };
function pick(it) {
  suggest = []; renderSugg(); $('q').blur();
  if (it.kind === 'flight') { S.pinned = it.ref; select('flight', it.ref); flyTo(it.ref.lat, it.ref.lon, Math.max(map.zoom, 8)); }
  else if (it.kind === 'ship') { select('ship', it.ref); flyTo(it.ref.lat, it.ref.lon, Math.max(map.zoom, 9)); }
  else if (it.kind === 'wild') { if (!on.wildlife) setLayer('wildlife', true); fitPath(it.ref.path); select('wild', it.ref); }
  else if (it.kind === 'iss') { if (!on.space) setLayer('space', true); const goIss = () => { if (S.iss) { select('iss', S.iss); flyTo(S.iss.lat, S.iss.lon, 4); } else note('Finding the ISS…'); };
    if (S.iss) goIss(); else loadIssNow(true).then(goIss); }
  else if (it.kind === 'link') location.href = it.ref;
}
function flyTo(lat, lon, z) { map.setView(lat, lon, z, { animate: true }); }
function fitPath(path) {
  let s = 90, n = -90, w = 180, e = -180; for (const [la, lo] of path) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const span = Math.max(n - s, (e - w) * Math.cos((s + n) / 2 * Math.PI / 180), 0.01);
  flyTo((s + n) / 2, (w + e) / 2, Math.max(3, Math.min(13, Math.log2(map.h / 256 * 360 / span / 1.6) - 0.3)));
}
async function go(q) {
  q = String(q || '').trim(); if (!q) return;
  const local = searchLocal(localItems(), q, 6);
  if (local.length) { pick(local[0]); return; }
  const k = classifyQuery(q);
  if (k.flightLike) {
    note(`Looking for ${q.toUpperCase()} worldwide…`);
    const f = await feed.find(q).catch(() => null);
    if (f) {
      if (!on.flights) setLayer('flights', true);
      S.flights.set(f.hex, f); S.pinned = f; select('flight', f); flyTo(f.lat, f.lon, 8); note('');
      return;
    }
    if (!/\s/.test(q) && /\d/.test(q)) { note(`${q.toUpperCase()} isn't flying right now (or isn't broadcasting ADS-B). Try the callsign, e.g. SWA1234, or the tail, e.g. N8711Q.`); return; }
  }
  note(`Finding ${q}…`);
  try {
    const r = await fetchFn('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
    const j = await r.json(), p = j && j[0];
    if (!p) { note(`Nothing called "${q}" found.`); return; }
    const bb = (p.boundingbox || []).map(Number), span = bb.length === 4 ? Math.max(bb[1] - bb[0], bb[3] - bb[2]) : 0.2;
    flyTo(+p.lat, +p.lon, Math.max(3, Math.min(13, Math.log2(360 / Math.max(span, 0.01)) + 0.5)));
    note(`${p.display_name.split(',').slice(0, 3).join(',')} · place search © OpenStreetMap`);
  } catch (e) { note('Place search is not reachable right now.'); }
}

// ------------------------------------------------------------------ start
status(); refreshAll(true);
if (params.get('q')) { $('q').value = params.get('q'); setTimeout(() => go(params.get('q')), 300); }
window.__globe.ready = true;

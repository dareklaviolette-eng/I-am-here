// I'M HERE globe hub: pick anything real on the map and "Be there".
// Layers: Flights (live ADS-B), Ships (relay snapshot, if the relay has one), Space (ISS), Wildlife (SAMPLE tracks).
// Only the visible area is loaded; wide views show counts instead of every icon.
import { TinyMap } from './map.js';
import { FlightFeed, is737, ageS, isLive, FRESH_S, predict, cluster, joinURL, typeName, airlineOf, classifyQuery, searchLocal,
  boundsRadiusNm, loadShips, loadISS, ON_SITE, CardLookups, flightTitle, fetchFR24, FR24Follow, FR24_NAME, FR24_FRESH_S, FR24_EXTRAP_MAX } from './feeds.js';
import { Backoff } from '../737/live-flights.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const TEST = window.__GLOBE_TEST || {};          // tests inject fetch and timing here
const fetchFn = TEST.fetch || ((u, o) => fetch(u, o));
const REFRESH_MS = TEST.refreshMs || 12000;   // one flight request per refresh (the free feeds allow about 1/s; we stay far below)
const DEBUG = params.get('debug') === '1';      // raw error details only with ?debug=1

// ------------------------------------------------------------------ state
const LS = 'imhere.globe.';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS + 'state') || '{}'); } catch (e) { return {}; } })();
const on = Object.assign({ flights: true, ships: false, space: true, wildlife: true }, saved.layers || {});
const S = {
  flights: new Map(), flightSrc: '', flightAt: 0, flightErr: '', coverage: 'view', loadedBounds: null, busy: false, lastLoad: 0, summary: null, wide: false,
  ships: [], shipState: {}, shipAt: 0, shipNote: '', shipBusy: false,
  iss: null, issState: {}, issAt: 0,
  wild: [], sel: null, hover: null, hits: [], anchors: new Map(), pinned: null,
  // feed loss: retry with exponential backoff (2, 4, 8, 16, then every 30 s; each try goes through every source again)
  back: new Backoff({ base: 2000, max: 30000, normal: REFRESH_MS }), backAt: 0, animUntil: 0,
};
const feed = new FlightFeed({ fetchFn, onSite: TEST.onSite ?? ON_SITE });
const looks = new CardLookups({ fetchFn, onSite: TEST.onSite ?? ON_SITE });
// The flight on a pinned card (tap/click, not a hover preview) follows Flightradar24 first: relay /fr24/flight every 20 s,
// dead reckoning between fixes; when FR24 fails the free feeds' positions take over again (FR24Follow rests, then retries).
const FR = { follow: new FR24Follow({ enabled: !!(TEST.onSite ?? ON_SITE) && params.get('fr24') !== '0', every: TEST.fr24EveryMs || undefined }), hex: null, busy: false };
window.__globe = { S, on, feed, looks, FR, get map() { return map; } };   // for tests and the console

// ------------------------------------------------------------------ map
const v0 = { lat: +params.get('lat') || saved.lat || 36.12, lon: +params.get('lon') || saved.lon || -86.68, zoom: +params.get('z') || saved.zoom || 7 };
const map = new TinyMap($('map'), {
  layers: [
    { url: TEST.tiles || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
    { url: TEST.labels || 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maxZoom: 18 },
  ],
  lat: v0.lat, lon: v0.lon, zoom: v0.zoom, minZoom: 2, maxZoom: 16,
  draw: drawLayers, onChange: viewChanged, onTap: tap, onHover: hover,
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
  const b = map.bounds(), t0 = Date.now();
  if (S.back.fails) { if (!S.back.due(t0) && !(force && t0 - S.lastLoad > 2000)) return; }   // feed down: back off (a new view may try sooner)
  else if (!force && t0 - S.lastLoad < REFRESH_MS) return;
  S.busy = true; S.lastLoad = t0;
  try {
    const radius = boundsRadiusNm(b);
    S.wide = radius > 1500;
    if (S.wide) S.summary = await feed.summary(b); else S.summary = null;
    const r = await feed.load(b);
    const next = new Map(), now = Date.now();
    for (const f of r.flights) {
      if (!f.hex) continue;
      const old = S.flights.get(f.hex);
      if (old && old.fr24 && FR.hex === f.hex && FR.follow.healthy(now)) { next.set(f.hex, old); continue; }   // followed with FR24
      if (old) {   // glide from where the plane is drawn to the new report (no jumps, also after a signal gap)
        const a = dispPos(old, now), p = predict(f, now), dla = a[0] - p[0], dlo = ((a[1] - p[1] + 540) % 360) - 180;
        if (Math.abs(dla) + Math.abs(dlo) > 1e-6 && Math.abs(dla) + Math.abs(dlo) < 3) f.ease = { dla, dlo, at: now };
      }
      next.set(f.hex, f);
    }
    if (S.pinned && !next.has(S.pinned.hex)) next.set(S.pinned.hex, S.flights.get(S.pinned.hex) || S.pinned);   // a searched-for flight stays
    if (S.back.fails || S.flightErr) S.backAt = now;   // "Signal back" for a moment
    S.flights = next; S.flightSrc = r.source; S.flightAt = now; S.flightErr = ''; S.coverage = r.coverage; S.loadedBounds = b;
    S.back.ok(now);
    for (const o of [S.sel, S.hover]) if (o && o.kind === 'flight') { const f = S.flights.get(o.ref.hex); if (f) o.ref = f; }
    animate(EASE_MS);
  } catch (e) { S.flightErr = e.message; S.back.fail(Date.now(), e.message); }
  finally { S.busy = false; status(); map.invalidate(); if (shown()) renderCard(); }
}
const EASE_MS = 1500;
function dispPos(f, now = Date.now()) {
  const p = predict(f, now);
  if (f.ease) {
    const k = 1 - (now - f.ease.at) / EASE_MS;
    if (k > 0) { const e = k * k * (3 - 2 * k); return [p[0] + f.ease.dla * e, p[1] + f.ease.dlo * e]; }
    f.ease = null;
  }
  return p;
}
function animate(ms) {   // redraw every frame for a moment (planes gliding to their new reports)
  const run = S.animUntil < Date.now(); S.animUntil = Math.max(S.animUntil, Date.now() + ms);
  if (!run) return;
  const step = () => { map.invalidate(); if (Date.now() < S.animUntil) requestAnimationFrame(step); };
  requestAnimationFrame(step);
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
function refreshAll(force) { loadFlights(force); loadShipsNow(force); loadIssNow(force); followFR24(); }
async function followFR24() {
  const sel = S.sel && S.sel.kind === 'flight' && on.flights ? S.sel : null;
  if (!sel) { FR.hex = null; return; }
  const hex = sel.ref.hex;
  if (FR.hex !== hex) { FR.hex = hex; FR.follow.reset(); }
  if (FR.busy || !FR.follow.due()) return;
  FR.busy = true;
  try {
    const r = await fetchFR24(sel.ref, { fetchFn });
    if (!S.sel || S.sel.kind !== 'flight' || S.sel.ref.hex !== hex) return;   // card closed or another flight picked meanwhile
    FR.follow.ok();
    const now = Date.now(), old = S.flights.get(hex) || S.sel.ref, g = { ...old };
    for (const [k, v] of Object.entries(r.flight)) if (v !== '' && v !== null && v !== undefined && k !== 'hex') g[k] = v;
    if (!old.fr24 && old.fixAt > r.flight.fixAt + 10000) {   // the free feed is clearly newer: keep its position, take FR24's details only
      for (const k of ['lat', 'lon', 'altFt', 'onGround', 'gs', 'track', 'vr', 'fixAt']) g[k] = old[k];
      g.fr24 = false;
    } else {
      Object.assign(g, { fr24: true, freshS: FR24_FRESH_S, extrapS: FR24_EXTRAP_MAX });
      const a = dispPos(old, now), p = predict(g, now), dla = a[0] - p[0], dlo = ((a[1] - p[1] + 540) % 360) - 180;
      g.ease = Math.abs(dla) + Math.abs(dlo) > 1e-6 && Math.abs(dla) + Math.abs(dlo) < 3 ? { dla, dlo, at: now } : null;
    }
    S.flights.set(hex, g);
    for (const o of [S.sel, S.hover]) if (o && o.kind === 'flight' && o.ref.hex === hex) o.ref = g;
    if (S.pinned && S.pinned.hex === hex) S.pinned = g;
    animate(EASE_MS);
  } catch (e) { if (FR.hex === hex) FR.follow.fail(e); }
  finally { FR.busy = false; status(); map.invalidate(); if (shown()) renderCard(); }
}
setInterval(() => { refreshAll(false); }, 1000);
setInterval(() => { if (on.flights && map.zoom >= 6) map.invalidate(); if (shown()) renderCard(); status(); }, 1000);   // planes move between reports
loadWild();

// ------------------------------------------------------------------ drawing
const PLANE = new Path2D('M0,-10 L1.6,-6 L1.6,-2 L9,2.5 L9,4.2 L1.6,2 L1.4,7 L4,9 L4,10.3 L0,9.3 L-4,10.3 L-4,9 L-1.4,7 L-1.6,2 L-9,4.2 L-9,2.5 L-1.6,-2 L-1.6,-6 Z');
const SHIP = new Path2D('M0,-8 L5,6 L0,3 L-5,6 Z');
function drawLayers(g, m) {
  const hits = [], anchors = new Map(); const W = m.w, H = m.h, pad = 30, now = Date.now();
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
      hits.push({ x: last[0], y: last[1], r: 22, kind: 'wild', ref: t }); anchors.set('w:' + t.id, last);
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
      hits.push({ x: c.x, y: c.y, r: 18, kind: 'ship', ref: s }); anchors.set('s:' + s.mmsi, [c.x, c.y]);
    }
  }
  // flights
  if (on.flights) {
    if (S.summary && S.summary.length) for (const c of S.summary) { const [x, y] = m.toScreen(c.lat, c.lon); if (vis(x, y)) bubble(g, x, y, c.n, 'rgba(255,255,255,.35)'); }
    const pts = [];
    for (const f of S.flights.values()) { const [la, lo] = dispPos(f, now), [x, y] = m.toScreen(la, lo); if (vis(x, y)) pts.push({ x, y, f }); }
    const clustered = m.zoom < 7 || pts.length > 350;   // counts per area when zoomed out; single aircraft still draw as planes
    const groups = clustered ? cluster(pts, m.zoom < 5 ? 64 : 48) : pts.map((p) => ({ x: p.x, y: p.y, n: 1, items: [p] }));
    groups.sort((a, b) => (a.n === 1 && is737(a.items[0].f)) - (b.n === 1 && is737(b.items[0].f)));   // 737s drawn on top
    for (const c of groups) {
      if (c.n > 1) {
        const n737 = c.items.filter((p) => is737(p.f)).length;
        bubble(g, c.x, c.y, c.n, 'rgba(20,32,52,.88)', n737 ? '#ffffff' : 'rgba(255,255,255,.7)');
        hits.push({ x: c.x, y: c.y, r: 22, kind: 'cluster' }); continue;
      }
      const f = c.items[0].f, b7 = is737(f), sel = S.sel && S.sel.kind === 'flight' && S.sel.ref.hex === f.hex;
      // every plane icon is white with a thin dark outline; a little dimmer while the feed is lost and its report is old
      g.save(); g.translate(c.x, c.y); g.rotate((f.track || 0) * Math.PI / 180);
      const sc = f.onGround ? 0.75 : b7 ? 1.2 : 1; g.scale(sc, sc);
      if (S.flightErr && !isLive(f, now)) g.globalAlpha = 0.6;
      g.lineWidth = 2.2 / sc; g.strokeStyle = 'rgba(0,0,0,.75)'; g.stroke(PLANE);
      g.fillStyle = '#ffffff'; g.fill(PLANE); g.restore();
      if (sel) ring(g, c.x, c.y);
      if (b7 && m.zoom >= 8 && f.flight) label(g, c.x + 13, c.y - 8, f.flight, '#ffffff');
      hits.push({ x: c.x, y: c.y, r: 20, kind: 'flight', ref: f }); anchors.set('f:' + f.hex, [c.x, c.y]);
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
      hits.push({ x, y, r: 24, kind: 'iss', ref: S.iss }); anchors.set('iss', [x, y]);
    }
  }
  S.hits = hits; S.anchors = anchors;
  placeCard();
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

// ------------------------------------------------------------------ hover / tap & card
// Desktop (and the Quest browser's controller ray): hovering an item shows its card; a click pins it. Phone: the first tap
// shows the card, then "Be there". The card sits ABOVE the item and inside the screen (beside it only when there is no room
// above while just hovering; a tap or click pans the map to make room).
const keyOf = (kind, ref) => !ref ? '' : kind === 'flight' ? 'f:' + ref.hex : kind === 'ship' ? 's:' + ref.mmsi : kind === 'wild' ? 'w:' + ref.id : kind === 'iss' ? 'iss' : '';
function shown() { return S.hover || S.sel; }
function hitAt(x, y) {
  let best = null, bd = 1e9;
  for (const h of S.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { bd = d; best = h; } }
  return best;
}
function tap(x, y) {
  const best = hitAt(x, y);
  if (!best) { closeCard(); return; }
  if (best.kind === 'cluster') { map.zoomAround(best.x, best.y, 2); return; }
  S.hover = null; select(best.kind, best.ref, { room: true });
}
let hoverClear = 0, overCard = false;
function hover(x, y) {
  const h = x == null ? null : hitAt(x, y);
  $('map').style.cursor = h ? 'pointer' : '';
  if (h && h.kind !== 'cluster') {
    clearTimeout(hoverClear);
    if (keyOf(h.kind, h.ref) !== keyOf(S.hover && S.hover.kind, S.hover && S.hover.ref)) {
      S.hover = keyOf(h.kind, h.ref) === keyOf(S.sel && S.sel.kind, S.sel && S.sel.ref) ? null : { kind: h.kind, ref: h.ref };
      renderCard(); map.invalidate();
    }
    return;
  }
  if (S.hover && !overCard) unhoverSoon();
}
function unhoverSoon() {   // a short grace period so the pointer can travel from the item onto its card
  clearTimeout(hoverClear);
  hoverClear = setTimeout(() => { if (!overCard && S.hover) { S.hover = null; renderCard(); map.invalidate(); } }, 350);
}
$('card').addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { overCard = true; clearTimeout(hoverClear); } });
$('card').addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') { overCard = false; if (S.hover) unhoverSoon(); } });
function select(kind, ref, { room = false } = {}) {
  S.sel = { kind, ref }; S.hover = null; S.selAt = room ? Date.now() : 0; renderCard(); map.invalidate();
  if (room) requestAnimationFrame(makeRoom);
}
function closeCard() { S.sel = null; S.hover = null; S.pinned = null; renderCard(); map.invalidate(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && shown() && document.activeElement !== $('q')) closeCard(); });
window.__globe.closeCard = closeCard;
// pan the map down just enough that the card fits above the item (the item stays on screen)
function makeRoom() {
  const c = $('card'), cur = shown(); if (c.hidden || !cur) return;
  const [, y] = anchorOf(cur), need = c.offsetHeight + CARD_GAP + 12 - y;   // a little slack: moving planes, rounding
  if (need > 0) map.panBy(0, Math.min(need, map.h - 26 - y));
}
const CARD_GAP = 22;
function anchorOf(cur) {
  const a = S.anchors.get(keyOf(cur.kind, cur.ref)); if (a) return a;
  const r = cur.ref;
  if (cur.kind === 'flight') { const [la, lo] = dispPos(r); return map.toScreen(la, lo); }
  if (cur.kind === 'wild') { const p = r.path[r.path.length - 1]; return map.toScreen(p[0], p[1]); }
  return map.toScreen(r.lat, r.lon);
}
function placeCard() {
  const c = $('card'), cur = shown(); if (c.hidden || !cur) return;
  const [x, y] = anchorOf(cur), W = map.w, H = map.h, m = 8;
  const off = !(x > -12 && y > -12 && x < W + 12 && y < H + 12);
  if (c.style.visibility !== (off ? 'hidden' : '')) c.style.visibility = off ? 'hidden' : '';
  const w = c.offsetWidth, h = c.offsetHeight;
  let left = Math.max(m, Math.min(W - w - m, x - w / 2)), top = y - CARD_GAP - h;
  if (top < m - 2) {   // no room above (while hovering): beside the item rather than over it, still inside the screen
    top = Math.max(m, Math.min(H - h - m, y - h / 2));
    if (x + CARD_GAP + w <= W - m) left = x + CARD_GAP; else if (x - CARD_GAP - w >= m) left = x - CARD_GAP - w;
  }
  const t = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
  if (c.style.transform !== t) c.style.transform = t;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtAge = (s) => s < 90 ? Math.round(s) + ' s ago' : s < 5400 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago';
const article = (t) => (/^[AEFHILMNORSX8]/i.test(t) ? 'an' : 'a');
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const dim = (t) => `<span class="dim">${t}</span>`;
const setHTML = (el, h) => { if (el && el._h !== h) { el._h = h; el.innerHTML = h; return true; } return false; };
// route / photo lookups start once a card has been up for a moment (sweeping the mouse across planes asks for nothing)
let lookT = 0;
function startLookups(cur) {
  clearTimeout(lookT);
  lookT = setTimeout(() => {
    const now = shown(); if (!now || keyOf(now.kind, now.ref) !== keyOf(cur.kind, cur.ref)) return;
    const done = () => { if (shown()) renderCard(); };
    if (cur.kind === 'flight') {
      const f = cur.ref;
      if (f.flight && !(f.orig && f.dest)) looks.route(f.flight).then(done);
      looks.photo(f.hex).then(done);
    } else if (cur.kind === 'wild' && cur.ref.wiki) looks.species(cur.ref.wiki).then(done);
  }, TEST.lookupMs ?? 250);
}
function photoHTML(key, alt, credit) {
  const v = looks.peek(key);
  if (v === undefined) return looks.state(key) === 'fail' ? '' : `<div class="ph wait">Looking for a photo…</div>`;   // not reachable: no photo block
  if (!v) return credit === 'plane' ? `<div class="phnone">No photo of this aircraft on Planespotters.net</div>` : '';
  if (credit === 'plane') {
    return `<a class="ph" href="${esc(v.link)}" target="_blank" rel="noopener" title="Photo page on Planespotters.net"><img src="${esc(v.src)}" alt="${esc(alt)}" width="${v.w}" height="${v.h}" referrerpolicy="no-referrer-when-downgrade"></a>
      <div class="credit">Photo © <a href="${esc(v.link)}" target="_blank" rel="noopener">${esc(v.by)}</a> · <a href="https://www.planespotters.net/" target="_blank" rel="noopener">Planespotters.net</a></div>`;
  }
  return `<a class="ph" href="${esc(v.link)}" target="_blank" rel="noopener" title="Photo page on Wikimedia Commons"><img src="${esc(v.src)}" alt="${esc(alt)}"></a>
    <div class="credit"><b>Species photo</b> · <a href="${esc(v.link)}" target="_blank" rel="noopener">${esc(v.by)}</a>${v.license ? ', ' + (v.licenseUrl ? `<a href="${esc(v.licenseUrl)}" target="_blank" rel="noopener">${esc(v.license)}</a>` : esc(v.license)) : ''} · Wikimedia Commons</div>`;
}
function cardParts(sel) {
  const P = { head: '', photo: '', data: '', go: '' };
  if (sel.kind === 'flight') {
    const f = sel.ref, b7 = is737(f), a = ageS(f), live = isLive(f), cs = (f.flight || '').replace(/\s+/g, '');
    const rt = f.orig && f.dest ? { orig: f.orig, dest: f.dest, via: 'feed' } : cs ? looks.peek('route:' + cs.toUpperCase()) : null;
    const ft = flightTitle(cs, rt && rt.airline || ''), title = ft ? ft.text : cs || f.reg || f.hex.toUpperCase();
    const sub = [ft || !cs ? cs : '', rt && rt.flightIata && ft ? 'flight ' + rt.flightIata : '', f.reg && f.reg !== title ? f.reg : '', typeName(f.type) || 'type not reported'].filter(Boolean);
    const route = rt ? `${esc(rt.orig)} → ${esc(rt.dest)}${rt.origCity && rt.destCity ? ` <small>${esc(rt.origCity)} to ${esc(rt.destCity)}</small>` : ''}`
      : rt === null || !/^[A-Z0-9]{3,8}$/i.test(cs) ? dim('Route not on file') : looks.state('route:' + cs.toUpperCase()) === 'fail' ? dim('Route not reachable right now') : dim('Route: looking up…');
    P.head = `<div class="kind">Flight${b7 ? '<span class="badge">737 family</span>' : ''}</div><div class="title">${esc(title)}</div>
      <div class="sub">${esc(sub.join(' · '))}</div><div class="route" title="${rt && rt.via !== 'feed' ? 'Route on file for this callsign (adsbdb.com); can be out of date' : ''}">${route}</div>`;
    P.photo = photoHTML('photo:' + f.hex, 'Photo of ' + (f.reg || title), 'plane');
    const vs = f.vr && Math.abs(f.vr) > 100 ? (f.vr > 0 ? '+' : '−') + n0(Math.abs(f.vr)) + ' fpm' : f.onGround ? '—' : 'level';
    P.data = `<dl><dt>Altitude</dt><dd>${f.onGround ? 'on the ground' : f.altFt != null ? n0(f.altFt) + ' ft' : dim('not in the feed')}</dd>
      <dt>Heading</dt><dd>${f.track != null ? String(Math.round(f.track)).padStart(3, '0') + '°' : '—'}</dd>
      <dt>Speed</dt><dd>${f.gs != null ? n0(f.gs) + ' kt' : dim('not in the feed')}</dd>
      <dt>V/S</dt><dd>${vs}</dd></dl>
      <div class="age">${live ? '<span class="live">● live</span> · ' : ''}last report ${fmtAge(a)} · ${esc(f.fr24 ? FR24_NAME : S.flightSrc || 'ADS-B')}${rt && rt.via !== 'feed' ? ' · route: adsbdb.com' : ''}</div>`;
    P.go = `${b7 ? '' : `<div class="note">Cockpit shown is a 737-800; this flight is ${f.type ? article(typeName(f.type)) + ' ' + esc(typeName(f.type)) : 'of a type the feed did not report'}.</div>`}
      <a class="go" id="beThere" href="${esc(joinURL(f))}">Be there</a>`;
  } else if (sel.kind === 'ship') {
    const s = sel.ref, a = Math.max(0, (Date.now() - s.fixAt) / 1000);
    P.head = `<div class="kind">Ship</div><div class="title">${esc(s.name || 'MMSI ' + s.mmsi)}</div><div class="sub">${esc([s.type, s.mmsi ? 'MMSI ' + s.mmsi : ''].filter(Boolean).join(' · '))}</div>`;
    P.data = `<dl><dt>Speed</dt><dd>${s.sog != null ? s.sog.toFixed(1) + ' kn' : 'not in the feed'}</dd><dt>Course</dt><dd>${s.cog != null ? Math.round(s.cog) + '°' : '—'}</dd>
      ${s.dest ? `<dt>Destination</dt><dd>${esc(s.dest)}</dd>` : ''}</dl>
      <div class="age">${a < 180 ? '<span class="live">● live</span> · ' : ''}last report ${fmtAge(a)} · AIS</div>`;
    P.go = `<a class="go" href="../boats/">Be there</a><div class="age" style="margin-top:6px">Opens live ships (pick this ship there).</div>`;
  } else if (sel.kind === 'iss') {
    const s = sel.ref, a = Math.max(0, (Date.now() - s.fixAt) / 1000);
    P.head = `<div class="kind">Space</div><div class="title">International Space Station</div><div class="sub">NORAD 25544</div>`;
    P.data = `<dl class="one"><dt>Altitude</dt><dd>${s.altKm != null ? n0(s.altKm) + ' km' : '—'}</dd><dt>Speed</dt><dd>${s.kmh != null ? n0(s.kmh) + ' km/h' : '—'}</dd>
      <dt>Over</dt><dd>${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}°${s.visibility ? ' · ' + esc(s.visibility) : ''}</dd></dl>
      <div class="age">${a < FRESH_S ? '<span class="live">● live</span> · ' : ''}position ${fmtAge(a)} · ${esc(s.source)}</div>`;
    P.go = `<a class="go" href="../space/">Be there</a>`;
  } else if (sel.kind === 'wild') {
    const t = sel.ref, ping = t.lastPing ? new Date(t.lastPing) : null;
    const pingTxt = ping && !isNaN(ping) ? ping.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—';
    P.head = `<div class="kind">Wildlife</div><div class="title">${esc((t.tracker || 'Sample track') + ' · ' + (t.species || t.name))}</div>
      <div class="sub">${esc('Tag ' + t.tag + ' · ' + (t.animal || t.label))}</div>`;
    P.photo = t.wiki ? photoHTML('species:' + t.wiki, (t.species || t.name) + ' (species photo)', 'species') : '';
    P.data = `<dl class="one"><dt>Last ping</dt><dd>${esc(pingTxt)}${/sample/i.test(t.tracker || 'sample') ? ' ' + dim('(sample time)') : ''}</dd>${t.sci ? `<dt>Species</dt><dd><i>${esc(t.sci)}</i></dd>` : ''}</dl>
      <div class="note">Sample track: synthetic, not real animal data. The photo shows the species, not this animal. Real tracks (Movebank) can be loaded inside the ride.</div>`;
    P.go = `<a class="go" href="../wildlife/?track=${encodeURIComponent(t.id)}">Ride</a>`;
  }
  return P;
}
function renderCard() {
  const c = $('card'), cur = shown();
  if (!cur) { if (!c.hidden) c.hidden = true; c.dataset.key = ''; return; }
  const key = keyOf(cur.kind, cur.ref);
  if (c.dataset.key !== key) {
    c.dataset.key = key;
    c.innerHTML = '<button class="x" aria-label="Close">×</button><div class="c-head"></div><div class="c-photo"></div><div class="c-data"></div><div class="c-go"></div>';
    c.querySelector('.x').onclick = closeCard;
    startLookups(cur);
  }
  const P = cardParts(cur);
  let grew = setHTML(c.querySelector('.c-head'), P.head);
  grew = setHTML(c.querySelector('.c-photo'), P.photo) || grew;
  grew = setHTML(c.querySelector('.c-data'), P.data) || grew;
  grew = setHTML(c.querySelector('.c-go'), P.go) || grew;
  c.classList.toggle('preview', cur === S.hover);
  c.hidden = false; placeCard();
  // a card just pinned by a tap/click whose route or photo arrived: keep room for it above the item
  if (grew && cur === S.sel && S.selAt && Date.now() - S.selAt < 6000) requestAnimationFrame(makeRoom);
}

// ------------------------------------------------------------------ status lines + watermark
function status() {
  const nF = S.flights.size, n7 = [...S.flights.values()].filter(is737).length;
  $('nFlights').textContent = on.flights ? (S.flightErr && !nF ? 'reconnecting…' : `${nF} in view · ${n7} 737s` + (S.flightErr ? ' (last known)' : '')) : 'off';
  $('stFlights').textContent = !on.flights ? '' : S.flightErr ? 'Live flights reconnecting…' + (nF ? ' Showing the last known positions.' : '') + (DEBUG ? ' [' + S.flightErr.slice(0, 400) + ']' : '')
    : S.flightAt ? `Flights: ${S.flightSrc}, refreshed every ${REFRESH_MS / 1000} s.` + (S.coverage !== 'view' ? ` Wide view: aircraft within ${S.coverage.nm} nm of the centre${S.summary ? ', counts elsewhere' : ''}.` : '') : 'Flights: loading…';
  $('nShips').textContent = on.ships ? (S.ships.length ? S.ships.length + ' in view' : 'open Boats') : 'off';
  $('stShips').textContent = on.ships ? 'Ships: ' + (S.shipNote || 'loading…') : '';
  $('nSpace').textContent = on.space ? (S.iss ? 'ISS' : 'ISS · loading') : 'off';
  $('stSpace').textContent = on.space && !S.iss && S.issAt ? 'Space: ISS position not reachable right now.' : '';
  const showHint = on.ships && S.shipState.snapshot === false && map.zoom >= 4;
  $('hint').hidden = !showHint;
  $('dataCredit').textContent = [on.flights && S.flightSrc ? 'Flights: ' + S.flightSrc : '', on.space && S.iss ? 'ISS: ' + S.iss.source : ''].filter(Boolean).join(' · ');
  // newest position report we hold (the feed's own fix time, not when we asked)
  let lastFix = 0; for (const f of S.flights.values()) if (f.fixAt > lastFix && f.fixAt <= Date.now() + 5000) lastFix = f.fixAt;
  sigPill(lastFix);
  const MARK = window.ImHereMark; if (!MARK) return;
  // a pinned flight followed with Flightradar24: SIGNAL names Flightradar24 and that flight's own report age
  const sf = S.sel && S.sel.kind === 'flight' && on.flights && S.sel.ref.fr24 ? S.sel.ref : null;
  const fresh = sf ? isLive(sf) : on.flights && !S.flightErr && [...S.flights.values()].some((f) => isLive(f));
  MARK.update({ signal: sf ? { source: FR24_NAME, time: sf.fixAt } : on.flights && S.flightAt ? { source: S.flightSrc, time: lastFix || S.flightAt } : { text: 'Map' },
    view: 'Satellite imagery (Esri), not live' });
  MARK.setLive(!!fresh);   // SIGNAL shows "live" only while reports are under 30 s old; otherwise their age
}
// "Signal lost, holding last positions, reconnecting… 42 s since last fix" while the flight feed is down
function sigPill(lastFix) {
  const el = $('sig'), now = Date.now();
  let t = '', back = false;
  if (on.flights && S.flightErr) {
    const wait = S.busy ? 0 : S.back.waitS(now), age = lastFix ? Math.round((now - lastFix) / 1000) : 0;
    t = (S.flights.size ? `Signal lost, holding last positions, reconnecting… ${age} s since last fix` : 'No flight signal yet, reconnecting…') + (wait > 2 ? ` · next try in ${wait} s` : '');
  } else if (on.flights && S.backAt && now - S.backAt < 4000) { t = 'Signal back: flights catching up'; back = true; }
  if (!t) { if (!el.hidden) el.hidden = true; return; }
  if (el.textContent !== t) el.textContent = t;
  el.classList.toggle('back', back); el.hidden = false;
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
function flyTo(lat, lon, z) { map.setView(lat, lon, z, { animate: true }); clearTimeout(flyRoom); flyRoom = setTimeout(makeRoom, 760); }   // then room for the card above
let flyRoom = 0;
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

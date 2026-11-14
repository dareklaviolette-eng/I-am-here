// I'M HERE EFB: the one control in VR, and the same panel on phone / tablet / desktop. A 2D canvas UI that looks like our
// web page (card spec look: dark navy, hairline borders, cyan labels, white values, monospace). In VR the canvas is a texture
// on a floating panel (seat-anchored; see efb-access.js); on screens the very same canvas sits in a DOM panel.
// Everything is one point + select (trigger or pinch), a tap or a click. No grips, buttons or sticks needed.
//
// Pages (Back steps down one level):
//   home       the ride: card (LOC ORG ID RTE POV SIG DATE TIME), POV seats, Stops / Ships nearby, Around me, Time, sound
//   concierge  "Where do you want to be?" + our own keyboard + 1-3 result cards; Expand -> the globe
//   globe      the full globe with every place we have (tap a pin -> its Be There reveal)
//   reveal     Be There: the big image (2/3 of the panel), name, one line, LIVE / HIST tag, the big Be There button
// The small globe top-left on every page opens the concierge.
//
// const efb = createEFB({ onAction(type, arg), onQuery(text) -> results })
//   efb.canvas, efb.set(partial state), efb.go(page), efb.back(), efb.page, efb.click(x, y) (canvas px), efb.hover(x, y | null)
//   efb.key(k) (typing from a physical keyboard on screens), efb.dirty (true when the canvas changed since the last take())
// Drawing happens only when something changed (state, hover, the clock once a second); never in the frame loop itself.
import { MONO, SANS, GREEN, AMBER, rrect, fitText, wrapText } from './util.js';
import { drawGlobe, project } from './globe.js';

export const EFB_W = 768, EFB_H = 1024;
const BG = 'rgba(9,16,30,0.94)', LINE = 'rgba(255,255,255,0.22)', LABEL = 'rgba(110,220,235,0.72)', VAL = 'rgba(255,255,255,0.92)', DIM = 'rgba(255,255,255,0.6)';
const HOV = 'rgba(70,130,180,0.55)', SEL = 'rgba(43,81,112,0.95)', BTN = 'rgba(28,44,66,0.95)';
const TAGC = { LIVE: GREEN, HIST: AMBER, SIM: AMBER, RENDERED: '#9fd8ff', SOON: 'rgba(255,255,255,0.55)' };
const KEYS = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"], ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', ',', '⌫'], ['clear', 'space', 'go']];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function createEFB({ onAction = () => {}, onQuery = () => [] } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = EFB_W; canvas.height = EFB_H;
  const g = canvas.getContext('2d');
  const S = { xr: false, stationName: '', tag: '', card: {}, povs: [], pov: '', listTitle: '', list: [], listPage: 0, layers: [], time: [], status: '',
    volume: 0.7, places: [], here: '', recent: [], query: '', results: [], reveal: null, globe: { lat: 20, lon: 0 }, hint: '', credit: '' };
  let stack = ['home'], hits = [], hover = null, dirty = true, drawPending = true, clockSig = '';
  const miniGlobe = document.createElement('canvas'); miniGlobe.width = miniGlobe.height = 64;
  let miniDrawn = false, bigGlobe = null, bigSig = '';
  const api = { canvas, get page() { return stack[stack.length - 1]; }, get dirty() { return dirty; }, state: S };

  api.set = (p) => { Object.assign(S, p); invalidate(); return api; };
  api.go = (page) => { if (api.page !== page) stack.push(page); if (stack.length > 5) stack.splice(1, 1); invalidate(); return api; };
  api.home = () => { stack = ['home']; invalidate(); };
  api.back = () => { if (stack.length > 1) stack.pop(); else onAction('stow'); invalidate(); };
  api.take = () => { const d = dirty; dirty = false; return d; };
  function invalidate() { drawPending = true; }
  // redraw now if needed (the shell calls this from a timer, ~8 Hz, and once a second the clock row changes)
  api.flush = () => {
    const cs = clockSig1();
    if (cs !== clockSig && api.page === 'home') { clockSig = cs; drawPending = true; }
    if (!drawPending) return false;
    drawPending = false; draw(); dirty = true; return true;
  };
  function clockSig1() { const d = new Date(); return d.getHours() + ':' + d.getMinutes(); }

  // ------------------------------------------------------------------ input
  function hitAt(x, y) { for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (x >= h[1] && x <= h[1] + h[3] && y >= h[2] && y <= h[2] + h[4]) return h; } return null; }
  api.hitTest = (x, y) => { const h = hitAt(x, y); return h ? h[0] : null; };
  api.hover = (x, y) => { const h = x == null ? null : hitAt(x, y), id = h ? h[0] : null; if (id !== hover) { hover = id; invalidate(); } return !!h; };
  api.click = (x, y) => { const h = hitAt(x, y); if (!h) return false; press(h[0], h[5]); return true; };
  api.key = (k) => { if (api.page !== 'concierge') return false; typeKey(k); return true; };
  function typeKey(k) {
    if (k === '⌫' || k === 'Backspace') S.query = S.query.slice(0, -1);
    else if (k === 'clear') S.query = '';
    else if (k === 'space' || k === ' ') S.query += S.query && !S.query.endsWith(' ') ? ' ' : '';
    else if (k === 'go' || k === 'Enter') { if (S.results[0]) onAction('pick', S.results[0]); return; }
    else if (k.length === 1 && S.query.length < 40) S.query += k;
    else return;
    S.results = S.query.trim() ? onQuery(S.query) || [] : [];
    invalidate();
  }
  function press(id, arg) {
    const [kind, val] = splitId(id);
    switch (kind) {
      case 'globe': if (api.page === 'concierge') api.home(); else { stack = ['home', 'concierge']; invalidate(); } return;
      case 'back': api.back(); return;
      case 'close': onAction('stow'); return;
      case 'expand': api.go('globe'); return;
      case 'key': typeKey(val); return;
      case 'res': if (S.results[+val]) onAction('pick', S.results[+val]); return;
      case 'recent': if (S.recent[+val]) onAction('pick', Object.assign({ fromRecent: true }, S.recent[+val])); return;
      case 'pin': { const p = S.places.find((x) => x.id === val); if (p) onAction('pickPlace', p); return; }
      case 'rot': { const d = { l: [0, -30], r: [0, 30], u: [15, 0], d: [-15, 0] }[val]; S.globe.lat = Math.max(-75, Math.min(75, S.globe.lat + d[0])); S.globe.lon = ((S.globe.lon + d[1] + 540) % 360) - 180; invalidate(); return; }
      case 'gfilter': S.globeFilter = S.globeFilter === val ? '' : val; invalidate(); return;
      case 'listup': S.listPage = Math.max(0, S.listPage - 1); invalidate(); return;
      case 'listdown': S.listPage++; invalidate(); return;
      case 'bethere': onAction('bethere', S.reveal); return;
      default: onAction(kind, val, arg);
    }
  }
  const splitId = (id) => { const i = id.indexOf(':'); return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]; };

  // ------------------------------------------------------------------ drawing kit
  function hit(id, x, y, w, h, arg) { hits.push([id, x, y, w, h, arg]); }
  function button(id, x, y, w, h, label, o = {}) {
    const on = hover === id;
    rrect(g, x, y, w, h, o.r == null ? 12 : o.r);
    g.fillStyle = o.fill || (o.sel ? SEL : on ? HOV : BTN); g.fill();
    g.lineWidth = o.sel || on ? 2 : 1; g.strokeStyle = o.sel ? 'rgba(160,220,255,0.85)' : on ? 'rgba(160,220,255,0.7)' : LINE; g.stroke();
    g.fillStyle = o.dis ? 'rgba(255,255,255,0.38)' : o.color || VAL; g.font = o.font || `600 26px ${MONO}`; g.textAlign = o.align || 'center'; g.textBaseline = 'middle';
    const tx = o.align === 'left' ? x + 18 : x + w / 2;
    g.fillText(fitText(g, label, w - 24), tx, y + h / 2 + 1);
    if (o.sub) { g.font = `500 19px ${SANS}`; g.fillStyle = DIM; g.fillText(fitText(g, o.sub, w - 24), tx, y + h - 16); }
    if (!o.dis) hit(id, x, y, w, h, o.arg);
  }
  function tagPill(t, x, y, right) {
    if (!t) return 0;
    g.font = `700 20px ${MONO}`; const w = g.measureText(t).width + 26, X = right ? x - w : x;
    rrect(g, X, y, w, 34, 17); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = TAGC[t] || DIM; g.stroke();
    g.fillStyle = TAGC[t] || DIM; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, X + w / 2, y + 18);
    return w;
  }
  function label(t, x, y, o = {}) { g.font = o.font || `600 20px ${MONO}`; g.fillStyle = o.color || LABEL; g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); }
  function header(title, opts = {}) {
    // small globe top-left (every page): tap -> concierge
    if (!miniDrawn) { const mg = miniGlobe.getContext('2d'); drawGlobe(mg, 32, 32, 30, 25, -40); miniDrawn = true; }
    const gh = hover === 'globe';
    g.save(); g.beginPath(); g.arc(52, 52, 36, 0, Math.PI * 2); g.fillStyle = gh ? HOV : 'rgba(20,34,56,0.9)'; g.fill();
    g.lineWidth = 2; g.strokeStyle = gh ? 'rgba(160,220,255,0.9)' : 'rgba(150,215,255,0.5)'; g.stroke(); g.restore();
    g.drawImage(miniGlobe, 20, 20, 64, 64); hit('globe', 12, 12, 82, 82);
    let x = 108;
    if (stack.length > 1) { button('back', x, 22, 124, 60, '‹ Back', { font: `600 22px ${MONO}` }); x += 138; }
    g.font = `800 30px ${SANS}`; g.fillStyle = VAL; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tagW = opts.tag ? 140 : 0;
    g.fillText(fitText(g, title, EFB_W - x - 96 - tagW), x, 54);
    if (opts.tag) tagPill(opts.tag, EFB_W - 100, 37, true);
    button('close', EFB_W - 86, 22, 66, 60, S.xr ? '⌄' : '×', { font: `700 30px ${SANS}` });
    g.fillStyle = LINE; g.fillRect(16, 104, EFB_W - 32, 1);
  }
  function section(t, y) { label(t.toUpperCase(), 24, y, { font: `700 19px ${MONO}`, color: 'rgba(110,220,235,0.62)' }); }

  // ------------------------------------------------------------------ pages
  function draw() {
    hits = [];
    g.clearRect(0, 0, EFB_W, EFB_H);
    rrect(g, 2, 2, EFB_W - 4, EFB_H - 4, 28); g.fillStyle = BG; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.28)'; g.stroke();
    // watermark
    g.save(); g.font = `900 22px "Arial Black",Arial,sans-serif`; g.fillStyle = 'rgba(255,255,255,0.06)'; g.textAlign = 'right'; g.fillText("i'm here", EFB_W - 26, EFB_H - 18); g.restore();
    const p = api.page;
    if (p === 'concierge') drawConcierge(); else if (p === 'globe') drawGlobePage(); else if (p === 'reveal') drawReveal(); else drawHome();
  }
  function drawHome() {
    header(S.stationName || "I'M HERE", { tag: S.tag });
    const c = S.card || {}; let y = 140;
    // caption: type · country · REG
    const cap = [c.type, c.flag && c.flag.name, c.reg ? 'REG ' + c.reg : ''].filter(Boolean).join(' · ');
    if (cap) { g.font = `500 21px ${MONO}`; g.fillStyle = 'rgba(255,255,255,0.55)'; g.textAlign = 'left'; g.fillText(fitText(g, cap, EFB_W - 48), 24, y); y += 34; }
    const t = c.time ? new Date(c.live ? Date.now() : c.time) : new Date();
    const rows = [['LOC', c.loc], ['ORG', c.org], [(c.id && c.id.label) || 'ID', c.id && c.id.value], ['RTE', c.rte], ['POV', c.pov],
      ['SIG', c.sig ? [c.sig.source, c.sig.tag || (c.live ? 'LIVE' : '')].filter(Boolean).join(' · ') : ''],
      ['DATE', String(t.getDate()).padStart(2, '0') + ' ' + MON[t.getMonth()] + ' ' + String(t.getFullYear()).slice(2)],
      ['TIME', t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })]];
    for (const [k, v] of rows) {
      if (!v) continue;
      const small = k === 'DATE' || k === 'TIME';
      label(k, 24, y + 4, { font: `600 ${small ? 18 : 20}px ${MONO}`, color: small ? 'rgba(110,220,235,0.55)' : LABEL });
      g.font = `600 ${small ? 21 : 25}px ${MONO}`; g.fillStyle = small ? 'rgba(255,255,255,0.7)' : VAL; g.textAlign = 'left';
      if (k === 'SIG' && c.sig) {
        const src = c.sig.source || '', tg = c.sig.tag || (c.live ? 'LIVE' : '');
        g.fillText(fitText(g, src, 420), 112, y + 4); const w = g.measureText(fitText(g, src, 420)).width;
        if (tg) { g.fillStyle = TAGC[tg] || (c.live ? GREEN : AMBER); g.fillText(' · ' + tg, 112 + w, y + 4); }
      } else g.fillText(fitText(g, v, EFB_W - 140), 112, y + 4);
      y += small ? 30 : 36;
    }
    y += 6; g.fillStyle = LINE; g.fillRect(16, y, EFB_W - 32, 1); y += 34;
    // POV seats
    if (S.povs.length) {
      section('POV', y); y += 12;
      let x = 24; const h = 54;
      for (const [id, l] of S.povs) {
        g.font = `600 22px ${MONO}`; const w = Math.max(96, g.measureText(l).width + 34);
        if (x + w > EFB_W - 24) { x = 24; y += h + 10; }
        button('pov:' + id, x, y, w, h, l, { sel: id === S.pov, font: `600 22px ${MONO}`, r: 27 });
        x += w + 10;
      }
      y += h + 30;
    }
    // Stops / Ships nearby (a page of 4, with ▲ ▼)
    if (S.list && S.list.length) {
      section(S.listTitle || 'Stops', y);
      const per = 4, pages = Math.ceil(S.list.length / per); if (S.listPage >= pages) S.listPage = pages - 1;
      if (pages > 1) {
        label((S.listPage + 1) + ' / ' + pages, EFB_W - 190, y, { color: DIM });
        button('listup', EFB_W - 120, y - 30, 46, 40, '▲', { dis: S.listPage === 0, font: `600 18px ${SANS}` });
        button('listdown', EFB_W - 68, y - 30, 46, 40, '▼', { dis: S.listPage >= pages - 1, font: `600 18px ${SANS}` });
      }
      y += 14;
      for (const it of S.list.slice(S.listPage * per, S.listPage * per + per)) {
        button('list:' + it.id, 24, y, EFB_W - 48, 62, '', { sel: it.sel });
        const tw = it.tag ? tagPill(it.tag, EFB_W - 40, y + 14, true) + 16 : 0;
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.font = `600 23px ${MONO}`; g.fillStyle = VAL; g.fillText(fitText(g, it.name, EFB_W - 100 - tw), 42, it.sub ? y + 28 : y + 39);
        if (it.sub) { g.font = `500 18px ${SANS}`; g.fillStyle = DIM; g.fillText(fitText(g, it.sub, EFB_W - 100 - tw), 42, y + 52); }
        y += 70;
      }
      y += 18;
    } else if (S.status) { g.font = `500 22px ${SANS}`; g.fillStyle = DIM; g.textAlign = 'left'; g.fillText(fitText(g, S.status, EFB_W - 48), 24, y); y += 40; }
    // Around me (layers)
    if (S.layers.length && y < EFB_H - 200) {
      section('Around me', y); y += 12; let x = 24;
      for (const [id, l, on, dis] of S.layers) {
        g.font = `600 21px ${MONO}`; const w = g.measureText(l + (dis ? ' · soon' : '')).width + 34;
        if (x + w > EFB_W - 24) { x = 24; y += 60; }
        button('layer:' + id, x, y, w, 50, l + (dis ? ' · soon' : ''), { sel: on && !dis, dis, font: `600 21px ${MONO}`, r: 25 });
        x += w + 10;
      }
      y += 76;
    }
    // bottom row: Time · sound · Recenter · Exit VR (and the imagery / data credit just above it: Google 3D tiles need it shown)
    const by = EFB_H - 96; let x = 24;
    if (S.credit) { g.font = `500 17px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.6)'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(fitText(g, S.credit, EFB_W - 48), 24, by - 14); }
    for (const [id, l, sel, dis] of S.time || []) { button('time:' + id, x, by, 104, 60, l, { sel, dis, font: `700 21px ${MONO}`, color: dis ? null : id === 'live' ? GREEN : AMBER }); x += 112; }
    button('vol:-', x + 6, by, 56, 60, '−', { font: `700 28px ${SANS}` });
    g.font = `600 19px ${MONO}`; g.fillStyle = DIM; g.textAlign = 'center'; g.fillText('♪ ' + Math.round(S.volume * 10), x + 98, by + 33);
    button('vol:+', x + 134, by, 56, 60, '+', { font: `700 28px ${SANS}` });
    if (S.xr) {
      button('recenter', EFB_W - 330, by, 140, 60, 'Recenter', { font: `600 21px ${MONO}` });
      button('exit', EFB_W - 180, by, 156, 60, 'Exit VR', { fill: hover === 'exit' ? '#e0303a' : '#b81f28', font: `800 23px ${SANS}` });
    }
  }
  function drawConcierge() {
    header('Where do you want to be?');
    let y = 128;
    // the field
    rrect(g, 24, y, EFB_W - 48 - 150, 70, 14); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(150,215,255,0.6)'; g.stroke();
    g.font = `600 28px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (S.query) { g.fillStyle = VAL; g.fillText(fitText(g, S.query, EFB_W - 260) + '▏', 42, y + 36); }
    else { g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillText('a place, a ship, "whales"…', 42, y + 36); }
    button('expand', EFB_W - 164, y, 140, 70, '⤢ Globe', { font: `600 24px ${MONO}` });
    y += 96;
    if (S.results.length) {
      S.results.forEach((r, i) => {
        const on = hover === 'res:' + i, h = 104;
        rrect(g, 24, y, EFB_W - 48, h, 16); g.fillStyle = on ? HOV : r.soon ? 'rgba(30,30,40,0.8)' : BTN; g.fill(); g.lineWidth = on ? 2 : 1; g.strokeStyle = on ? 'rgba(160,220,255,0.8)' : LINE; g.stroke();
        g.font = `700 27px ${SANS}`; g.fillStyle = r.soon ? DIM : VAL; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.fillText(fitText(g, r.title, EFB_W - 260), 46, y + 44);
        g.font = `500 20px ${SANS}`; g.fillStyle = DIM; g.fillText(fitText(g, r.sub || '', EFB_W - 130), 46, y + 78);
        if (r.tag) tagPill(r.tag, EFB_W - 80, y + 18, true);
        if (!r.soon) { g.font = `700 34px ${SANS}`; g.fillStyle = 'rgba(160,220,255,0.8)'; g.textAlign = 'right'; g.fillText('›', EFB_W - 42, y + 64); hit('res:' + i, 24, y, EFB_W - 48, h); }
        y += h + 12;
      });
    } else {
      section(S.recent.length ? 'Recent' : 'Try', y + 8); y += 22;
      const items = S.recent.length ? S.recent.slice(0, 4) : null;
      if (items) items.forEach((r, i) => { button('recent:' + i, 24, y, EFB_W - 48, 62, r.title || r.name, { align: 'left', font: `600 23px ${MONO}`, sub: '' }); y += 70; });
      else { g.font = `500 22px ${SANS}`; g.fillStyle = DIM; g.textAlign = 'left'; ['Sydney Harbour', 'whales', 'Matterhorn', 'superyachts'].forEach((t, i) => g.fillText('“' + t + '”', 40 + (i % 2) * 330, y + 30 + Math.floor(i / 2) * 40)); }
    }
    // our keyboard (VR and screens; a physical keyboard types too)
    const ky = EFB_H - 5 * 74 - 18, kw = (EFB_W - 48 - 9 * 8) / 10;
    KEYS.forEach((row, r) => {
      let x = 24;
      row.forEach((k) => {
        const w = k === 'space' ? kw * 5 + 32 : k === 'clear' || k === 'go' ? kw * 2.5 + 12 : kw;
        button('key:' + k, x, ky + r * 74, w, 64, k === 'space' ? 'space' : k === 'go' ? 'Go ›' : k, { font: `600 ${k.length > 1 ? 22 : 28}px ${MONO}`, r: 10,
          fill: k === 'go' ? (hover === 'key:go' ? '#2f8a5a' : '#21704a') : null });
        x += w + 8;
      });
    });
  }
  function drawGlobePage() {
    header('The globe · where to go');
    const cx = EFB_W / 2, cy = 470, r = 300, sig = S.globe.lat + ',' + S.globe.lon;
    if (!bigGlobe || bigSig !== sig) { bigGlobe = bigGlobe || document.createElement('canvas'); const bg = bigGlobe; bg.width = bg.height = r * 2; drawGlobe(bg.getContext('2d'), r, r, r, S.globe.lat, S.globe.lon); bigSig = sig; }
    g.drawImage(bigGlobe, cx - r, cy - r);
    const pt = {};
    const list = S.places.filter((p) => p.kind !== 'stop' && (!S.globeFilter || p.station === S.globeFilter));
    for (const p of list) {
      if (!project(p.lat, p.lon, cx, cy, r, S.globe.lat, S.globe.lon, pt)) continue;
      const here = p.id === S.here, on = hover === 'pin:' + p.id;
      g.beginPath(); g.arc(pt.x, pt.y, on ? 15 : 11, 0, Math.PI * 2); g.fillStyle = p.station === 'boats' ? '#4fd1ff' : '#ffd36b'; g.fill();
      g.lineWidth = here ? 5 : 2; g.strokeStyle = here ? GREEN : '#0b1626'; g.stroke();
      if (on || here) { g.font = `700 22px ${SANS}`; g.textAlign = 'center'; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 5; g.strokeText(p.name, pt.x, pt.y - 22); g.fillText(p.name, pt.x, pt.y - 22); }
      hit('pin:' + p.id, pt.x - 24, pt.y - 24, 48, 48);
    }
    // rotate (select only)
    button('rot:l', 24, cy - 40, 64, 80, '◀', { font: `600 26px ${SANS}` }); button('rot:r', EFB_W - 88, cy - 40, 64, 80, '▶', { font: `600 26px ${SANS}` });
    button('rot:u', cx - 40, 128, 80, 52, '▲', { font: `600 22px ${SANS}` }); button('rot:d', cx - 40, cy + r - 30, 80, 52, '▼', { font: `600 22px ${SANS}` });
    // layers of the globe = where to go
    let y = EFB_H - 150; section('Layers', y); y += 14; let x = 24;
    for (const [id, l] of [['boats', 'Live ships'], ['aurora', 'Aurora tours']]) { button('gfilter:' + id, x, y, 220, 56, l, { sel: S.globeFilter === id, font: `600 22px ${MONO}`, r: 28 }); x += 232; }
    g.font = `500 19px ${SANS}`; g.fillStyle = DIM; g.textAlign = 'left'; g.fillText('Tap a pin', x + 8, y + 34);
  }
  function drawReveal() {
    const R = S.reveal || {};
    header(R.kicker || 'Be There', { tag: R.tag });
    const ix = 24, iy = 120, iw = EFB_W - 48, ih = Math.round((EFB_H - 120) * 0.62);
    rrect(g, ix, iy, iw, ih, 18); g.save(); g.clip();
    const grd = g.createLinearGradient(0, iy, 0, iy + ih); grd.addColorStop(0, '#203a5a'); grd.addColorStop(1, '#0b1422'); g.fillStyle = grd; g.fillRect(ix, iy, iw, ih);
    if (R.image) {
      const im = R.image, s = Math.max(iw / im.width, ih / im.height), w = im.width * s, h = im.height * s;
      g.drawImage(im, ix + (iw - w) / 2, iy + (ih - h) / 2, w, h);
    } else { g.font = `600 26px ${SANS}`; g.fillStyle = DIM; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(R.busy ? 'Rendering…' : '', ix + iw / 2, iy + ih / 2); }
    g.restore();
    rrect(g, ix, iy, iw, ih, 18); g.lineWidth = 1.5; g.strokeStyle = LINE; g.stroke();
    if (R.imageNote) { g.font = `500 17px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.7)'; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillText(R.imageNote, ix + iw - 14, iy + ih - 14); }
    let y = iy + ih + 52;
    g.font = `800 38px ${SANS}`; g.fillStyle = VAL; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(fitText(g, R.title || '', EFB_W - 60 - (R.tag ? 0 : 0)), 28, y);
    y += 40; g.font = `500 23px ${SANS}`; g.fillStyle = DIM;
    for (const l of wrapText(g, R.line || '', EFB_W - 56, 2)) { g.fillText(l, 28, y); y += 30; }
    const bh = 92, by = EFB_H - bh - 26;
    if (R.go) button('bethere', 24, by, EFB_W - 48, bh, R.here ? "You're here" : 'Be There', { fill: R.here ? 'rgba(40,60,80,0.9)' : hover === 'bethere' ? '#2aa86e' : '#1f8a5a', font: `800 40px ${SANS}`, dis: !!R.here, r: 20 });
  }
  api.draw = () => { draw(); dirty = true; };
  return api;
}

/* I'M HERE card v1 (spec: card_spec_v1.md, reference look: card-test.html). SOURCE OF TRUTH: iah-proto/shared/imhere-card.js
   (mirrored in v_maritime/src/imhere-card.js; the boats build inlines it). Self-contained, no dependencies; the only network
   use is the flag image (flag-icons on jsdelivr) when the page passes flag.iso2.

   Top-left, inside the safe area. Collapsed by default: the hollow lowercase "i'm here" mark, a small thumbnail, LOC, route,
   and "<id> · LIVE" (green, only while setLive(true)) or "<id> · HIST <age>". Tap the card to expand / collapse. Expanded:
   photo slot, caption row (flag + country | REG + type), the line, LOC / ORG / <ID> / RTE / POV / SIG / DATE / TIME (rows with
   no value are hidden, order never changes), footer (imagery credit | "ⓘ Details"). Details opens a small panel inside the
   card and does NOT collapse it.

   API
     ImHereCard.init({ zIndex, ...data })   ImHereCard.update({ ...data })
       data: thumb    { icon: { d, w, h }, label } (an SVG path, drawn as a line icon) or { src, alt }
             photo    same shape as thumb (defaults to thumb); photoNote: small text in the photo slot
             flag     { iso2, name }       reg   'IMO 9811000' (shown after "REG"; numbers over 10 chars -> "…" + last 8)
             type     'Container ship'     loc   'San Pedro, CA'      org   'Mediterranean Shipping Co.'
             id       { label: 'NAME', value: 'MSC ANNA' }     rte  '→ Long Beach · Underway'    pov  'Helm'
             route    collapsed route line ('→ Long Beach')    sig  { source: 'AIS', tag: 'SIM' (optional, amber) }
             time     ms of the data (DATE / TIME and the HIST age; DATE / TIME show now while live)
             footer   { text, href }      details { rows: [[k, v]], notes: [text], credits: [{ text, href }] }
     ImHereCard.setLive(bool) / isLive() / expand() / collapse() / toggle() / isExpanded()
     ImHereCard.openDetails() / closeDetails() / detailsOpen() / text()   (text(): the card as plain text)
     ImHereCard.xrPanel(THREE, { width, exitRow }) -> THREE.Mesh of the COLLAPSED card for VR (canvas, kept up to date);
       mesh.userData.exitRect = { cx, cy, w, h } for the VR safety layer's exitTargets; ImHereCard.xrExitHover(bool).
   CSS variables on <html> (pages keep their own panels clear of the card):
     --imc-hc / --imc-wc  bottom edge / right edge of the COLLAPSED card (px from the top / left of the viewport)
     --imc-h  / --imc-w   the same for the card as it is now (expanded or not) */
(function () {
  'use strict';
  if (window.ImHereCard) return;
  var MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
  var MARKF = '"Arial Black","Helvetica Neue",Arial,sans-serif';
  var GREEN = '#7ef0a2', AMBER = '#ffbf47';
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var FLAG_URL = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';
  var CSS =
    '.imc{position:fixed;left:calc(10px + env(safe-area-inset-left));top:calc(10px + env(safe-area-inset-top));z-index:var(--imc-z,1500);' +
    'box-sizing:border-box;width:min(290px,calc(100vw - 130px));max-height:calc(100dvh - 20px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow:auto;' +
    'overscroll-behavior:contain;background:rgba(12,16,30,.6);border:.5px solid rgba(255,255,255,.28);border-radius:7px;color:rgba(255,255,255,.92);' +
    'font:13px/1.3 ' + MONO + ';letter-spacing:normal;text-align:left;text-shadow:none;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
    'user-select:none;-webkit-user-select:none;pointer-events:auto;margin:0}' +
    '.imc *{box-sizing:border-box}.imc [hidden]{display:none!important}' +
    '.imc:focus-visible{outline:2px solid #7cc4ff;outline-offset:1px}' +
    '.imc-wm{font-family:' + MARKF + ';font-size:26px;font-weight:900;letter-spacing:2px;line-height:1.1;color:transparent;' +
    '-webkit-text-stroke:.5px rgba(255,255,255,.85);padding:8px 11px 3px;white-space:nowrap}' +
    '@supports not (-webkit-text-stroke:.5px #fff){.imc-wm{color:rgba(255,255,255,.35)}}' +
    '.imc-ico{width:100%;height:100%;display:block}' +
    '.imc-ph{margin:3px 11px 0;border:.5px solid rgba(255,255,255,.3);aspect-ratio:3/2;background:rgba(255,255,255,.12);position:relative;overflow:hidden;' +
    'display:flex;align-items:center;justify-content:center}' +
    '.imc-ph .imc-ico{width:82%;height:82%}.imc-ph img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.imc-pn{position:absolute;right:4px;bottom:3px;font-size:9px;color:rgba(255,255,255,.55)}' +
    '.imc-cap{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:5px 11px 0;font-size:11px;color:rgba(255,255,255,.55);line-height:1.35}' +
    '.imc-fb{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:40px;max-width:46%;text-align:center}' +
    '.imc-fl{width:24px;height:18px;opacity:.85;display:block;object-fit:cover;border:.5px solid rgba(255,255,255,.3)}' +
    '.imc-rg{text-align:right;margin-left:auto}' +
    '.imc-ln{border-top:.5px solid rgba(255,255,255,.2);margin-top:5px;padding:3px 0 4px}' +
    '.imc-r{display:grid;grid-template-columns:38px 1fr;padding:1px 11px;align-items:baseline}' +
    '.imc-l{font-size:11px;color:rgba(110,220,235,.7)}.imc-v{font-size:13px;overflow-wrap:anywhere}' +
    '.imc-s .imc-l{color:rgba(110,220,235,.55)}.imc-s .imc-v{font-size:11px;color:rgba(255,255,255,.7)}' +
    '.imc-g{color:' + GREEN + '}.imc-a{color:' + AMBER + '}' +
    '.imc-cr{display:flex;justify-content:space-between;align-items:center;border-top:.5px solid rgba(255,255,255,.2);padding:4px 11px;font-size:11px;color:rgba(255,255,255,.55)}' +
    '.imc-cr a{color:inherit;text-decoration:none}' +
    '.imc-det{cursor:pointer;padding:6px 0 6px 10px;margin:-6px 0}.imc-det:focus-visible{outline:2px solid #7cc4ff}' +
    '.imc-dp{border-top:.5px solid rgba(255,255,255,.2);padding:5px 11px 8px;font-size:11px;line-height:1.4;color:rgba(255,255,255,.75);cursor:auto;user-select:text;-webkit-user-select:text}' +
    '.imc-dp .imc-r{padding:1px 0;grid-template-columns:52px 1fr}.imc-dp p{margin:4px 0 0}.imc-dp a{color:#a9d3ff}' +
    '.imc-dh{color:rgba(110,220,235,.7);margin-top:6px}' +
    '.imc-mini{display:none;align-items:center;gap:9px;padding:2px 9px 8px}' +
    '.imc-t{width:66px;aspect-ratio:3/2;border:.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);overflow:hidden;flex:none;' +
    'display:flex;align-items:center;justify-content:center}.imc-t img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.imc-t .imc-ico{width:86%;height:86%}' +
    '.imc-ma{min-width:0}.imc-m1{font-size:13px;line-height:1.35;overflow-wrap:anywhere}.imc-m2{font-size:11px;line-height:1.35;color:rgba(255,255,255,.7);overflow-wrap:anywhere}' +
    '.imc.min{width:min(230px,calc(100vw - 130px))}.imc.min .imc-wm{font-size:17px;padding:6px 9px 3px}' +
    '.imc.min .imc-ph,.imc.min .imc-cap,.imc.min .imc-ln,.imc.min .imc-cr,.imc.min .imc-dp{display:none!important}.imc.min .imc-mini{display:flex}';

  var S = { thumb: null, photo: null, photoNote: '', flag: null, reg: '', type: '', loc: '', org: '', id: null, rte: '', pov: '', route: '',
    sig: null, time: null, footer: null, details: null, live: false, expanded: false, det: false, z: 1500, mounted: false };
  var card, els = {}, lastSig = '', lastDet = '', xr = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ms) { var d = new Date(ms); return pad(d.getDate()) + ' ' + MON[d.getMonth()] + ' ' + pad(d.getFullYear() % 100); }
  function fmtTime(ms) { var d = new Date(ms), h = d.getHours(); return ((h % 12) || 12) + ':' + pad(d.getMinutes()) + (h < 12 ? ' AM' : ' PM'); }
  function fmtAge(ms) {
    if (!(ms >= 0)) return '';
    var s = Math.round(ms / 1000);
    if (s < 90) return s + ' s';
    if (s < 5400) return Math.round(s / 60) + ' min';
    if (s < 172800) return Math.round(s / 3600) + ' h';
    return Math.round(s / 86400) + ' d';
  }
  function shortReg(r) {   // "IMO 9811000" stays; a number longer than 10 characters -> "…" + its last 8
    r = String(r || ''); var m = /^(.*?\s)?(\S+)$/.exec(r); if (!m) return r;
    return m[2].length > 10 ? (m[1] || '') + '…' + m[2].slice(-8) : r;
  }
  // status word for SIG / the collapsed line: ['LIVE', green] | ['SIM', amber] | ['HIST 3 min', amber]
  function status() {
    var g = S.sig || {};
    if (g.tag) return [g.tag, 'imc-a'];
    if (S.live) return ['LIVE', 'imc-g'];
    var age = S.time ? fmtAge(Date.now() - S.time) : '';
    return ['HIST' + (age ? ' ' + age : ''), 'imc-a'];
  }
  function when() { return S.live ? Date.now() : S.time; }
  function rows() {   // fixed order; empty rows hidden
    var st = status(), g = S.sig || {}, t = when(), R = [];
    if (S.loc) R.push(['LOC', S.loc]);
    if (S.org) R.push(['ORG', S.org]);
    if (S.id && S.id.value) R.push([S.id.label || 'ID', S.id.value]);
    if (S.rte) R.push(['RTE', S.rte]);
    if (S.pov) R.push(['POV', S.pov]);
    if (g.source || st) R.push(['SIG', (g.source ? g.source + ' · ' : ''), st]);
    if (t) { R.push(['DATE', fmtDate(t), null, true]); R.push(['TIME', fmtTime(t), null, true]); }
    return R;
  }
  function miniLines() {
    var st = status(), idv = S.id && S.id.value ? S.id.value : (S.sig && S.sig.source) || '';
    return [S.loc || '', S.route || '', [idv, st]];
  }
  function text() {   // plain text (tests, aria-label)
    var M = miniLines(), out = ["i'm here"];
    if (!S.expanded) { out.push(M[0], M[1], (M[2][0] ? M[2][0] + ' · ' : '') + M[2][1][0]); return out.filter(Boolean).join('\n'); }
    if (S.flag && S.flag.name) out.push(S.flag.name);
    if (S.reg) out.push('REG ' + shortReg(S.reg));
    if (S.type) out.push(S.type);
    rows().forEach(function (r) { out.push(r[0] + ' ' + r[1] + (r[2] ? r[2][0] : '')); });
    if (S.det) out.push(els.dp.innerText || els.dp.textContent);
    return out.filter(Boolean).join('\n');
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function picture(p, small) {   // a line icon (SVG path) or an image
    if (!p) return null;
    if (p.icon && p.icon.d) {
      var s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 ' + (p.icon.w || 120) + ' ' + (p.icon.h || 60));
      s.setAttribute('class', 'imc-ico'); s.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS(SVGNS, 'path'); path.setAttribute('d', p.icon.d); path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(255,255,255,.82)'); path.setAttribute('stroke-width', small ? '2.2' : '1.4');
      path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('vector-effect', 'non-scaling-stroke');
      s.appendChild(path); return s;
    }
    if (p.src) { var im = new Image(); im.alt = p.alt || ''; im.src = p.src; im.decoding = 'async'; return im; }
    return null;
  }
  function setPic(host, p, small, keep) {
    var k = JSON.stringify(p || null);
    if (host._k === k) return; host._k = k;
    while (host.firstChild && host.firstChild !== keep) host.removeChild(host.firstChild);
    var n = picture(p, small); if (n) host.insertBefore(n, keep || null);
  }

  function render() {
    if (!S.mounted) return;
    var R = rows(), M = miniLines();
    var sig = JSON.stringify([R, M, S.flag, S.reg, S.type, S.footer, S.expanded, S.det, S.photoNote, S.thumb && JSON.stringify(S.thumb).length, S.photo && JSON.stringify(S.photo).length]);
    if (sig !== lastSig) {
      lastSig = sig;
      card.classList.toggle('min', !S.expanded);
      card.setAttribute('aria-expanded', String(S.expanded));
      setPic(els.t, S.thumb, true);
      setPic(els.ph, S.photo || S.thumb, false, els.pn);
      els.pn.textContent = S.photoNote || ''; els.pn.hidden = !S.photoNote;
      els.m1.textContent = M[0]; els.m1.hidden = !M[0];
      els.m2.textContent = M[1]; els.m2.hidden = !M[1];
      els.m3.textContent = M[2][0] ? M[2][0] + ' · ' : ''; var sp = el('span', M[2][1][1], M[2][1][0]); els.m3.appendChild(sp);
      // caption row
      var f = S.flag || {};
      els.fb.hidden = !(f.iso2 || f.name);
      var want = f.iso2 ? FLAG_URL + String(f.iso2).toLowerCase() + '.svg' : '';
      if (els.fl.getAttribute('data-src') !== want) { els.fl.setAttribute('data-src', want); if (want) els.fl.src = want; else els.fl.removeAttribute('src'); }
      els.fl.hidden = !want; els.fl.alt = f.name ? f.name + ' flag' : '';
      els.fn.textContent = f.name || '';
      els.rg.textContent = '';
      if (S.reg) els.rg.appendChild(document.createTextNode('REG ' + shortReg(S.reg)));
      if (S.reg && S.type) els.rg.appendChild(el('br'));
      if (S.type) els.rg.appendChild(document.createTextNode(S.type));
      els.cap.hidden = els.fb.hidden && !S.reg && !S.type;
      // rows
      els.ln.textContent = '';
      R.forEach(function (r) {
        var d = el('div', 'imc-r' + (r[3] ? ' imc-s' : '')); d.appendChild(el('span', 'imc-l', r[0]));
        var v = el('span', 'imc-v', r[1]); if (r[2]) v.appendChild(el('span', r[2][1], r[2][0])); d.appendChild(v); els.ln.appendChild(d);
      });
      // footer
      els.fl2.textContent = '';
      var ft = S.footer || {};
      if (ft.text) { if (ft.href) { var a = el('a', null, ft.text); a.href = ft.href; a.target = '_blank'; a.rel = 'noopener'; a.addEventListener('click', function (e) { e.stopPropagation(); }); els.fl2.appendChild(a); } else els.fl2.textContent = ft.text; }
      els.det.setAttribute('aria-expanded', String(S.det));
      els.dp.hidden = !S.det;
      card.setAttribute('aria-label', "I'M HERE card. " + text().replace(/\n/g, '. '));
      drawXR();
    }
    renderDetails(); measure();
  }
  function renderDetails() {
    if (!S.det) return;
    var D = S.details || {}, k = JSON.stringify(D);
    if (k === lastDet) return; lastDet = k;
    var dp = els.dp; dp.textContent = '';
    (D.rows || []).forEach(function (r) { if (!r || r[1] == null || r[1] === '') return; var d = el('div', 'imc-r'); d.appendChild(el('span', 'imc-l', r[0])); d.appendChild(el('span', null, String(r[1]))); dp.appendChild(d); });
    (D.notes || []).forEach(function (n) { if (n) dp.appendChild(el('p', null, n)); });
    if (D.credits && D.credits.length) {
      dp.appendChild(el('div', 'imc-dh', 'Credits'));
      D.credits.forEach(function (c) {
        var p = el('p'); if (c.href) { var a = el('a', null, c.text); a.href = c.href; a.target = '_blank'; a.rel = 'noopener'; p.appendChild(a); } else p.textContent = c.text || c;
        dp.appendChild(p);
      });
    }
  }
  var lastM = '';
  function measure() {
    if (!S.mounted) return;
    var r = card.getBoundingClientRect(), root = document.documentElement.style;
    var h = Math.round(r.bottom) + 'px', w = Math.round(r.right) + 'px';
    if (!S.expanded) { root.setProperty('--imc-hc', h); root.setProperty('--imc-wc', w); }
    if (h + w !== lastM) { lastM = h + w; root.setProperty('--imc-h', h); root.setProperty('--imc-w', w); }
  }
  function setExpanded(on) { on = !!on; if (on === S.expanded) return; S.expanded = on; if (!on) S.det = false; render(); }
  function setDet(on) { on = !!on; if (on === S.det) return; S.det = on; lastDet = ''; if (on) S.expanded = true; render(); }
  function mount() {
    if (S.mounted) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', mount); return; }
    if (!document.getElementById('imc-style')) { var st = el('style', null, CSS); st.id = 'imc-style'; document.head.appendChild(st); }
    card = el('div', 'imc min'); card.id = 'imh-card'; card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
    card.title = 'Tap to expand or minimize';
    card.appendChild(el('div', 'imc-wm', "i'm here"));
    var mini = el('div', 'imc-mini'); els.t = el('div', 'imc-t'); mini.appendChild(els.t);
    var ma = el('div', 'imc-ma'); els.m1 = el('div', 'imc-m1'); els.m2 = el('div', 'imc-m2'); els.m3 = el('div', 'imc-m2');
    ma.appendChild(els.m1); ma.appendChild(els.m2); ma.appendChild(els.m3); mini.appendChild(ma); card.appendChild(mini);
    els.ph = el('div', 'imc-ph'); els.pn = el('span', 'imc-pn'); els.ph.appendChild(els.pn); card.appendChild(els.ph);
    els.cap = el('div', 'imc-cap'); els.fb = el('div', 'imc-fb'); els.fl = el('img', 'imc-fl'); els.fl.decoding = 'async';
    els.fl.addEventListener('error', function () { els.fl.hidden = true; });
    els.fn = el('span'); els.fb.appendChild(els.fl); els.fb.appendChild(els.fn); els.cap.appendChild(els.fb);
    els.rg = el('div', 'imc-rg'); els.cap.appendChild(els.rg); card.appendChild(els.cap);
    els.ln = el('div', 'imc-ln'); card.appendChild(els.ln);
    var cr = el('div', 'imc-cr'); els.fl2 = el('span'); els.det = el('span', 'imc-det', 'ⓘ Details');
    els.det.setAttribute('role', 'button'); els.det.setAttribute('tabindex', '0'); els.det.setAttribute('aria-label', 'Details: credits and identifiers');
    cr.appendChild(els.fl2); cr.appendChild(els.det); card.appendChild(cr);
    els.dp = el('div', 'imc-dp'); els.dp.hidden = true; card.appendChild(els.dp);
    // Details toggles its panel and never collapses the card; taps inside the panel do nothing
    function det(e) { e.stopPropagation(); setDet(!S.det); }
    els.det.addEventListener('click', det);
    els.det.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); det(e); } });
    els.dp.addEventListener('click', function (e) { e.stopPropagation(); });
    card.addEventListener('click', function () { setExpanded(!S.expanded); });
    card.addEventListener('keydown', function (e) {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!S.expanded); }
      else if (e.key === 'Escape') setExpanded(false);
    });
    ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel', 'mousedown'].forEach(function (ev) {   // keep taps off the 3D view underneath
      card.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });
    document.body.appendChild(card);
    S.mounted = true;
    document.documentElement.style.setProperty('--imc-z', String(S.z));
    render();
    addEventListener('resize', measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(card);
    setInterval(render, 1000);   // ages, DATE / TIME while live
  }
  function apply(o) {
    if (!o) return;
    ['thumb', 'photo', 'flag', 'id', 'sig', 'footer', 'details'].forEach(function (k) { if (o[k] !== undefined) S[k] = o[k] || null; });
    ['photoNote', 'reg', 'type', 'loc', 'org', 'rte', 'pov', 'route'].forEach(function (k) { if (o[k] !== undefined) S[k] = o[k] == null ? '' : String(o[k]); });
    if (o.time !== undefined) S.time = o.time || null;
    if (o.zIndex != null) S.z = +o.zIndex || 1500;
  }

  // ---- VR: the collapsed card on a canvas (no images: the icon is drawn from its path, so the texture is never tainted)
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, t, w) { t = String(t || ''); if (g.measureText(t).width <= w) return t; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
  var XW = 512, XBODY = 236, XEXIT = 58;
  function xrHeight() { return XBODY + (xr && xr.exitRow ? XEXIT : 0); }
  function exitRect(m) {
    var w = m.userData.imhW, H = xr.canvas.height, s = w / XW, top = H - 6 - XEXIT, bot = H - 6;
    m.userData.exitRect = xr.exitRow ? { cx: 0, cy: (H / 2 - (top + bot) / 2) * s, w: (XW - 12) * s, h: XEXIT * s } : null;
  }
  function xrResize(H) {
    var T = xr.THREE, c = xr.canvas; c.height = H;
    var tex = new T.CanvasTexture(c); if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    xr.meshes.forEach(function (m) { m.material.map = tex; m.material.needsUpdate = true; var w = m.userData.imhW; m.geometry.dispose(); m.geometry = new T.PlaneGeometry(w, w * H / XW); exitRect(m); });
    xr.tex.dispose(); xr.tex = tex;
  }
  function drawXR() {
    if (!xr) return;
    if (xr.canvas.height !== xrHeight()) xrResize(xrHeight());
    var c = xr.canvas, g = c.getContext('2d'), W = c.width, H = c.height, M = miniLines();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,16,30,0.78)'; rr(g, 3, 3, W - 6, H - 6, 16); g.fill();   // denser than on screens: legible over any scene
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2; g.stroke();
    g.textBaseline = 'alphabetic'; if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.font = '900 46px ' + MARKF; g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.strokeText("i'm here", 24, 56);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    var tx = 24, ty = 78, tw = 150, th = 100;   // thumbnail
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(tx, ty, tw, th); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.5; g.strokeRect(tx, ty, tw, th);
    var ic = S.thumb && S.thumb.icon;
    if (ic && ic.d && typeof Path2D !== 'undefined') {
      var iw = ic.w || 120, ih = ic.h || 60, k = Math.min((tw - 16) / iw, (th - 16) / ih);
      g.save(); g.translate(tx + (tw - iw * k) / 2, ty + (th - ih * k) / 2); g.scale(k, k);
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3 / k; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(new Path2D(ic.d)); g.restore();
    }
    var lx = tx + tw + 18, lw = W - lx - 22;
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = '500 30px ' + MONO; g.fillText(fit(g, M[0], lw), lx, ty + 30);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '400 25px ' + MONO; g.fillText(fit(g, M[1], lw), lx, ty + 64);
    g.font = '400 23px ' + MONO;
    var st = M[2][1], sep = M[2][0] ? ' · ' : '', sw = g.measureText(sep + st[0]).width;
    var it = M[2][0] ? fit(g, M[2][0], Math.max(40, lw - sw)) + sep : '';
    g.fillText(it, lx, ty + 96); g.fillStyle = st[1] === 'imc-g' ? GREEN : AMBER; g.fillText(st[0], lx + g.measureText(it).width, ty + 96);
    if (xr.exitRow) {
      var ey = H - 6 - XEXIT;
      g.save(); rr(g, 3, ey, W - 6, XEXIT + 3, 14); g.clip();
      g.fillStyle = xr.exitHover ? 'rgba(200,32,42,0.75)' : 'rgba(200,32,42,0.22)'; g.fillRect(0, ey, W, XEXIT + 6); g.restore();
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(3, ey, W - 6, 2);
      g.fillStyle = xr.exitHover ? '#fff' : '#ffb3b6'; g.font = '600 28px ' + MONO; g.fillText('Exit VR', 24, ey + 39);
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '400 22px ' + MONO; g.textAlign = 'right'; g.fillText('or press B / Y', W - 24, ey + 38); g.textAlign = 'left';
    }
    xr.tex.needsUpdate = true;
  }
  function xrPanel(THREE, o) {
    o = o || {};
    if (!xr) {
      var c = document.createElement('canvas'); c.width = XW; c.height = XBODY;
      var tex = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      xr = { canvas: c, tex: tex, THREE: THREE, meshes: [], exitRow: false, exitHover: false };
    }
    if (o.exitRow && !xr.exitRow) { xr.exitRow = true; xrResize(xrHeight()); }
    var w = o.width || 0.24;
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * xr.canvas.height / XW), new THREE.MeshBasicMaterial({ map: xr.tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
    m.userData.imhW = w; xr.meshes.push(m);
    m.renderOrder = 10000; m.frustumCulled = false; m.name = 'imhere-mark-xr';
    m.position.set(o.x != null ? o.x : -0.3, o.y != null ? o.y : -0.24, o.z != null ? o.z : -1);
    m.rotation.x = 0.2;
    exitRect(m); drawXR(); return m;
  }

  window.ImHereCard = {
    init: function (o) { apply(o); mount(); lastSig = ''; render(); return this; },
    update: function (o) { apply(o); render(); return this; },
    setLive: function (on) { on = !!on; if (on !== S.live) { S.live = on; render(); } return this; },
    isLive: function () { return S.live; },
    expand: function () { setExpanded(true); return this; }, collapse: function () { setExpanded(false); return this; },
    toggle: function () { setExpanded(!S.expanded); return this; }, isExpanded: function () { return S.expanded; },
    openDetails: function () { setDet(true); return this; }, closeDetails: function () { setDet(false); return this; },
    detailsOpen: function () { return S.det; }, text: text, xrPanel: xrPanel,
    xrExitHover: function (on) { on = !!on; if (xr && xr.exitRow && on !== xr.exitHover) { xr.exitHover = on; drawXR(); } }
  };
})();

/* I'M HERE top controls (card_spec_v1.md, "FINAL top controls", Nov 11). SOURCE OF TRUTH: iah-proto/shared/imhere-topbar.js
   (mirrored in v_maritime/src/imhere-topbar.js; the boats build inlines it). Plain script, no dependencies; works with
   window.ImHereCard (shared/imhere-card.js) when the page has it. First user: boats. Built so aviation can adopt it.

   Left:   [ ☰ ] [ i'm here • | ‹ › ]    ☰ = sidebar (sections: › collapsed, ⌄ open). Tag = the I'M HERE card below it
                                         (dot green = live, amber = HIST). ‹ / › = their own tap zones on the tag's right
                                         edge (split button): › slides the data out, ‹ folds it back, then hides all.
   Right corner, fixed: [ POV ▾ ] [ ◫ Layers ▾ ]   (Layers in the very corner; menus open down the right side)
   States: 'full' (data out) | 'compact' (default) | 'hidden' (one faint dot top-left, big invisible tap area, one-time
   hint "Tap the dot to bring it back"). ‹: full -> compact -> hidden. Dot: hidden -> compact. ›: compact -> full.
   Attribution bug, bottom-right, in every state (Google 3D tiles or, as on boats, Esri imagery): faint, legible, adaptive.
   Everything is one tap / click, or in VR one point + select (trigger or pinch). No buttons, sticks or grips.

   API
     ImHereTopbar.init({ model, onAction, dataEl, sections, zIndex, storageKey })
       model() -> { live, tag (show the tag), data: [[k, v]], pov: items, layers: items, sideItems: items (VR list),
                    sideTitle, credit: { text, href } | null, layersLabel }
         items: [[id, text, sub, flags]]  flags (space separated): sel | on | off | dis | keep (menu stays open)
       onAction(id): page actions (menu items, VR list rows). Control ids are handled here: side, tag, more, less, dot,
         pov, layers, menu:close.
       dataEl: optional DOM element shown as the data (e.g. a helm strip); else model().data is drawn as cells.
       sections: [{ id, title, el, open }] the sidebar (the elements are moved inside it).
     ImHereTopbar.update()  ImHereTopbar.act(id)  state() / setState(s)  sideOpen() / setSide(b)  cardOpen() / setCard(b)
       menu() ('pov' | 'layers' | null)  setMenu(m)  setXR(bool) (hides the screen controls while presenting)
     ImHereTopbar.xr(THREE, { cardWidth }) -> X (VR, world-mounted: the page owns the mount; nothing here follows the head)
       X.attach(group)  adds the controls to a group whose origin is the eye at mount time, forward -z (call once)
       X.step(nowMs)    redraws what changed (signatures; at most 10 Hz)
       X.ray(o, d) -> { key, id } | null    (world-space ray, THREE.Vector3s; no allocations)
       X.select(o, d) -> true when a control took it      X.hover(o, d) / X.hoverEnd()  (call for each ray, then end)
       X.card  the I'M HERE card mesh (register it as a VR safety exit target: its Exit VR row)
     CSS variables on <html>: --ihb-top (px under the controls: where a card / list can start), --ihb-z */
(function () {
  'use strict';
  if (window.ImHereTopbar) return;
  var MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
  var MARKF = '"Arial Black","Helvetica Neue",Arial,sans-serif';
  var GREEN = '#7ef0a2', AMBER = '#ffbf47', CYAN = 'rgba(110,220,235,0.8)';
  var CSS =
    '.ihb{font:13px/1.2 ' + MONO + ';color:rgba(255,255,255,.92);-webkit-tap-highlight-color:transparent}' +
    '.ihb [hidden]{display:none!important}' +
    '.ihb-b{font:inherit;color:inherit;background:rgba(12,16,30,.6);border:.5px solid rgba(255,255,255,.28);border-radius:7px;min-height:44px;min-width:44px;padding:0 10px;' +
    'display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);margin:0;box-sizing:border-box}' +
    '.ihb-b:hover{border-color:rgba(160,220,255,.7)}.ihb-b:focus-visible{outline:2px solid #7cc4ff;outline-offset:1px}' +
    '.ihb-b[aria-pressed="true"],.ihb-b[aria-expanded="true"]{background:rgba(43,81,112,.78);border-color:rgba(160,220,255,.7)}' +
    '.ihb-left{position:fixed;top:calc(10px + env(safe-area-inset-top));left:calc(10px + env(safe-area-inset-left));display:flex;gap:6px;z-index:var(--ihb-z,1600)}' +
    '.ihb-side-b{font-size:20px}' +
    '.ihb-split{display:flex;border-radius:7px}.ihb-split .ihb-b{border-radius:0}.ihb-split .ihb-b:first-child{border-radius:7px 0 0 7px}.ihb-split .ihb-b:last-child{border-radius:0 7px 7px 0}' +
    '.ihb-split .ihb-arr{border-left:0;min-width:40px;padding:0 6px;font-size:20px}' +
    '.ihb-mark{font:900 17px/1 ' + MARKF + ';letter-spacing:1.5px;color:transparent;-webkit-text-stroke:.5px rgba(255,255,255,.85);white-space:nowrap}' +
    '@supports not (-webkit-text-stroke:.5px #fff){.ihb-mark{color:rgba(255,255,255,.5)}}' +
    '.ihb-dotc{width:9px;height:9px;border-radius:50%;background:' + AMBER + ';flex:none}.ihb-dotc.live{background:' + GREEN + '}' +
    '.ihb-data{position:fixed;top:calc(10px + env(safe-area-inset-top));z-index:calc(var(--ihb-z,1600) - 10);min-height:44px;display:flex;align-items:center;gap:8px;padding:3px 8px;' +
    'background:rgba(6,16,26,.82);border:1px solid rgba(255,255,255,.16);border-radius:12px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-variant-numeric:tabular-nums;box-sizing:border-box;overflow:auto;max-height:30dvh}' +
    '.ihb-cells{display:flex;flex-wrap:wrap;gap:2px 14px;margin:0}.ihb-cells dt{font-size:9.5px;letter-spacing:.08em;color:rgba(110,220,235,.7)}.ihb-cells dd{margin:0;font-weight:600;white-space:nowrap}' +
    '.ihb-right{position:fixed;top:calc(10px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));display:flex;gap:6px;z-index:var(--ihb-z,1600)}' +
    '.ihb-right .ihb-b{white-space:nowrap}' +
    '@media (max-width:430px){.ihb-lay-t{display:none}}' +
    '.ihb-dd{position:fixed;top:calc(62px + env(safe-area-inset-top));right:calc(10px + env(safe-area-inset-right));z-index:calc(var(--ihb-z,1600) + 10);min-width:230px;max-width:calc(100vw - 20px);' +
    'max-height:calc(100dvh - 80px);overflow:auto;display:flex;flex-direction:column;gap:2px;padding:5px;background:rgba(12,16,30,.88);border:.5px solid rgba(255,255,255,.28);border-radius:9px;' +
    '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-sizing:border-box}' +
    '.ihb-dd button{display:flex;align-items:center;gap:10px;text-align:left;background:none;border:0;border-radius:7px;min-height:44px;padding:6px 10px;font:14px ' + MONO + ';color:rgba(255,255,255,.92);cursor:pointer}' +
    '.ihb-dd button:hover:not(:disabled){background:rgba(60,110,150,.6)}.ihb-dd button[aria-current="true"]{background:rgba(40,80,110,.65)}' +
    '.ihb-dd button:disabled{color:rgba(255,255,255,.4);cursor:default}.ihb-dd .s{margin-left:auto;padding-left:12px;font-size:11px;color:rgba(255,255,255,.55)}' +
    '.ihb-dd .box{width:16px;height:16px;border:2px solid currentColor;border-radius:3px;flex:none;box-sizing:border-box}.ihb-dd .box.on{background:' + GREEN + ';border-color:' + GREEN + '}' +
    '.ihb-dot{position:fixed;top:env(safe-area-inset-top);left:env(safe-area-inset-left);width:72px;height:72px;background:none;border:0;padding:0;cursor:pointer;z-index:var(--ihb-z,1600)}' +
    '.ihb-dot span{position:absolute;left:20px;top:20px;width:14px;height:14px;border-radius:50%;background:' + AMBER + ';opacity:.55;box-shadow:0 0 0 1px rgba(0,0,0,.35)}' +
    '.ihb-dot span.live{background:' + GREEN + '}' +
    '.ihb-hint{position:fixed;top:calc(22px + env(safe-area-inset-top));left:calc(60px + env(safe-area-inset-left));z-index:var(--ihb-z,1600);padding:6px 10px;border-radius:7px;background:rgba(12,16,30,.75);' +
    'font:13px ' + MONO + ';color:#fff;pointer-events:none;transition:opacity .6s}' +
    '.ihb-sidebar{position:fixed;left:calc(10px + env(safe-area-inset-left));top:calc(var(--ihb-top,60px) + env(safe-area-inset-top));width:min(260px,calc(100vw - 20px));' +
    'max-height:calc(100dvh - var(--ihb-top,60px) - 70px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow:auto;z-index:calc(var(--ihb-z,1600) - 20);background:rgba(12,16,30,.82);' +
    'border:.5px solid rgba(255,255,255,.28);border-radius:9px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);overscroll-behavior:contain}' +
    '.ihb-sec+.ihb-sec{border-top:.5px solid rgba(255,255,255,.18)}' +
    '.ihb-sech{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;min-height:44px;padding:0 12px;font:600 13px ' + MONO + ';color:rgba(110,220,235,.85);cursor:pointer;text-align:left}' +
    '.ihb-sech .c{width:14px;color:rgba(255,255,255,.7)}' +
    '.ihb-credit{position:fixed;right:calc(8px + env(safe-area-inset-right));bottom:calc(6px + env(safe-area-inset-bottom));z-index:calc(var(--ihb-z,1600) - 30);font:600 11px/1.2 system-ui,sans-serif;' +
    'letter-spacing:.02em;color:rgba(255,255,255,.62);text-decoration:none;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.12);' +
    'text-shadow:0 0 2px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.45);mix-blend-mode:normal;pointer-events:auto}';

  var O = null, S = { state: 'compact', side: false, card: true, menu: null, menuAt: 0, xr: false, hintShown: false }, E = {}, mounted = false, layT = 0, leaveT = 0;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function flags(f) { return ' ' + (f || '') + ' '; }
  function has(f, k) { return flags(f).indexOf(' ' + k + ' ') >= 0; }
  function M() { try { return (O && O.model && O.model()) || {}; } catch (e) { return {}; } }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function mount() {
    if (mounted) return; if (!document.body) { document.addEventListener('DOMContentLoaded', mount); return; }
    mounted = true;
    var st = el('style', null, CSS); st.id = 'ihb-style'; document.head.appendChild(st);
    var root = el('div', 'ihb'); root.id = 'ihb';
    var left = E.left = el('div', 'ihb-left');
    E.side = el('button', 'ihb-b ihb-side-b', '☰'); E.side.type = 'button'; E.side.id = 'ihbSide'; E.side.setAttribute('aria-label', 'Sidebar: ships, search, departments, settings');
    var split = E.split = el('div', 'ihb-split');
    E.tag = el('button', 'ihb-b'); E.tag.type = 'button'; E.tag.id = 'ihbTag'; E.tag.setAttribute('aria-label', "I'M HERE card");
    E.tag.appendChild(el('span', 'ihb-mark', "i'm here")); E.dotc = el('span', 'ihb-dotc'); E.tag.appendChild(E.dotc);
    E.less = el('button', 'ihb-b ihb-arr', '‹'); E.less.type = 'button'; E.less.id = 'ihbLess';
    E.arr = el('button', 'ihb-b ihb-arr', '›'); E.arr.type = 'button'; E.arr.id = 'ihbArrow'; E.arr.setAttribute('aria-label', 'Slide the data out');
    split.appendChild(E.tag); split.appendChild(E.less); split.appendChild(E.arr); left.appendChild(E.side); left.appendChild(split);
    E.data = el('div', 'ihb-data'); E.data.id = 'ihbData';
    if (O.dataEl) E.data.appendChild(O.dataEl); else { E.cells = el('dl', 'ihb-cells'); E.data.appendChild(E.cells); }
    var right = E.right = el('div', 'ihb-right');
    E.pov = el('button', 'ihb-b', 'POV ▾'); E.pov.type = 'button'; E.pov.id = 'ihbPov'; E.pov.setAttribute('aria-haspopup', 'menu');
    E.lay = el('button', 'ihb-b'); E.lay.type = 'button'; E.lay.id = 'ihbLayers'; E.lay.setAttribute('aria-haspopup', 'menu'); E.lay.setAttribute('aria-label', 'Layers');
    E.lay.appendChild(document.createTextNode('◫ ')); E.lay.appendChild(el('span', 'ihb-lay-t', 'Layers ')); E.lay.appendChild(document.createTextNode('▾'));
    right.appendChild(E.pov); right.appendChild(E.lay);
    E.ddPov = el('div', 'ihb-dd'); E.ddPov.id = 'ihbPovMenu'; E.ddPov.setAttribute('role', 'menu'); E.ddPov.setAttribute('aria-label', 'Point of view');
    E.ddLay = el('div', 'ihb-dd'); E.ddLay.id = 'ihbLayMenu'; E.ddLay.setAttribute('role', 'menu'); E.ddLay.setAttribute('aria-label', 'Layers');
    E.dot = el('button', 'ihb-dot'); E.dot.type = 'button'; E.dot.id = 'ihbDot'; E.dot.setAttribute('aria-label', 'Show the controls'); E.dotS = el('span'); E.dot.appendChild(E.dotS);
    E.hint = el('div', 'ihb-hint', 'Tap the dot to bring it back'); E.hint.hidden = true;
    E.sidebar = el('aside', 'ihb-sidebar'); E.sidebar.id = 'ihbSidebar';
    E.secs = [];
    (O.sections || []).forEach(function (sc) {
      var s = el('section', 'ihb-sec'), h = el('button', 'ihb-sech'), c = el('span', 'c'), t = el('span', null, sc.title);
      h.type = 'button'; h.appendChild(c); h.appendChild(t); s.appendChild(h); var body = el('div', 'ihb-secb'); if (sc.el) body.appendChild(sc.el); s.appendChild(body);
      var rec = { id: sc.id, open: !!sc.open, h: h, c: c, body: body };
      h.addEventListener('click', function () { rec.open = !rec.open; render(); });
      E.secs.push(rec); E.sidebar.appendChild(s);
    });
    E.credit = el('a', 'ihb-credit'); E.credit.id = 'ihbCredit'; E.credit.target = '_blank'; E.credit.rel = 'noopener';
    [left, E.data, right, E.ddPov, E.ddLay, E.dot, E.hint, E.sidebar, E.credit].forEach(function (x) { root.appendChild(x); });
    document.body.appendChild(root);
    E.root = root;
    E.side.addEventListener('click', function () { act('side'); });
    E.tag.addEventListener('click', function () { act('tag'); });
    E.arr.addEventListener('click', function () { act('more'); });
    E.less.addEventListener('click', function () { act('less'); });
    E.dot.addEventListener('click', function () { act('dot'); });
    E.pov.addEventListener('click', function (e) { e.stopPropagation(); act('pov'); });
    E.lay.addEventListener('click', function (e) { e.stopPropagation(); act('layers'); });
    [E.ddPov, E.ddLay].forEach(function (dd) {
      dd.addEventListener('click', function (e) { e.stopPropagation(); var b = e.target.closest && e.target.closest('button[data-id]'); if (b && !b.disabled) act(b.getAttribute('data-id')); });
      dd.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { clearTimeout(leaveT); leaveT = setTimeout(function () { setMenu(null); }, 1200); } });
      dd.addEventListener('pointerenter', function () { clearTimeout(leaveT); if (S.menu === 'layers') armLay(); });
    });
    document.addEventListener('pointerdown', function (e) { if (S.menu && !(e.target.closest && e.target.closest('.ihb-dd,#ihbPov,#ihbLayers'))) setMenu(null); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.menu) setMenu(null); });
    // keep taps on the controls off the 3D view underneath
    [left, right, E.ddPov, E.ddLay, E.dot, E.sidebar, E.data].forEach(function (x) { ['pointerdown', 'pointermove', 'touchstart', 'wheel'].forEach(function (ev) { x.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); }); });
    addEventListener('resize', layout);
    if (window.ResizeObserver) { var ro = new ResizeObserver(layout); ro.observe(left); ro.observe(right); ro.observe(E.data); }
  }
  function armLay() { clearTimeout(layT); layT = setTimeout(function () { if (S.menu === 'layers') setMenu(null); }, 4000); }
  function setMenu(m) {
    if (m === S.menu) return; S.menu = m; S.menuAt = performance.now(); clearTimeout(layT);
    if (m === 'layers') armLay();
    render();
  }
  function setState(s) {
    if (s !== 'full' && s !== 'compact' && s !== 'hidden') return;
    S.state = s; if (s === 'hidden') { S.menu = null; S.side = false; }
    if (s === 'hidden' && !S.hintShown && !store((O.storageKey || 'imhere.topbar') + '.hint')) {
      S.hintShown = true; store((O.storageKey || 'imhere.topbar') + '.hint', '1');
      E.hint.hidden = false; E.hint.style.opacity = '1';
      setTimeout(function () { E.hint.style.opacity = '0'; setTimeout(function () { E.hint.hidden = true; }, 700); }, 4000);
    }
    render();
  }
  function act(id) {
    var m = M();
    if (id === 'side') { S.side = !S.side; if (S.side) S.card = false; S.menu = null; }
    else if (id === 'tag') { S.card = !S.card; if (S.card) S.side = false; }
    else if (id === 'more') { if (S.state === 'compact') S.state = 'full'; }
    else if (id === 'less') { setState(S.state === 'full' ? 'compact' : 'hidden'); return; }
    else if (id === 'dot') { S.state = 'compact'; if (S.xr) { S.card = true; S.side = false; } E.hint.hidden = true; }
    else if (id === 'pov' || id === 'layers') { setMenu(S.menu === id ? null : id); return; }
    else if (id === 'menu:close') { setMenu(null); return; }
    else if (id === 'card') { var Cd = window.ImHereCard; if (Cd) Cd.toggle(); }
    else {
      var items = (S.menu === 'pov' ? m.pov : S.menu === 'layers' ? m.layers : null) || [], it = null;
      for (var i = 0; i < items.length; i++) if (items[i][0] === id) it = items[i];
      if (it && has(it[3], 'dis')) return;
      if (it && !has(it[3], 'keep')) S.menu = null; else if (it) { S.menuAt = performance.now(); if (S.menu === 'layers') armLay(); }
      if (O.onAction) try { O.onAction(id); } catch (e) { console.error('[topbar] action', id, e); }
    }
    render();
  }
  var menuSig = {};
  function fill(dd, items, key) {
    dd.hidden = !items; if (!items) { menuSig[key] = ''; return; }
    var sig = JSON.stringify(items); if (menuSig[key] === sig) return; menuSig[key] = sig;
    dd.textContent = '';
    items.forEach(function (it) {
      var b = el('button'); b.type = 'button'; b.setAttribute('data-id', it[0]); b.setAttribute('role', 'menuitem'); var f = it[3];
      if (has(f, 'dis')) { b.disabled = true; }
      if (has(f, 'on') || has(f, 'off')) { b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(has(f, 'on'))); }
      if (has(f, 'sel')) b.setAttribute('aria-current', 'true');
      if (has(f, 'on') || has(f, 'off') || (has(f, 'dis') && it[2])) b.appendChild(el('span', 'box' + (has(f, 'on') ? ' on' : '')));
      b.appendChild(el('span', 't', it[1])); if (it[2]) b.appendChild(el('span', 's', it[2]));
      dd.appendChild(b);
    });
  }
  function render() {
    if (!mounted) return;
    var m = M(), hidden = S.state === 'hidden', tag = !!m.tag, live = !!m.live;
    E.left.hidden = hidden; E.right.hidden = hidden; E.dot.hidden = !hidden;
    E.split.hidden = !tag;
    E.dotc.className = 'ihb-dotc' + (live ? ' live' : ''); E.dotS.className = live ? 'live' : '';
    E.side.setAttribute('aria-pressed', String(S.side)); E.tag.setAttribute('aria-pressed', String(S.card));
    E.arr.hidden = S.state === 'full'; E.less.setAttribute('aria-label', S.state === 'full' ? 'Fold the data back' : 'Hide the controls');
    var dataOn = !hidden && tag && S.state === 'full';
    E.data.hidden = !dataOn;
    if (dataOn && E.cells) {
      var sig = JSON.stringify(m.data || []); if (E.cells._s !== sig) { E.cells._s = sig; E.cells.textContent = ''; (m.data || []).forEach(function (kv) { var d = el('div'); d.appendChild(el('dt', null, kv[0])); d.appendChild(el('dd', null, kv[1])); E.cells.appendChild(d); }); }
    }
    E.pov.setAttribute('aria-expanded', String(S.menu === 'pov')); E.lay.setAttribute('aria-expanded', String(S.menu === 'layers'));
    E.lay.setAttribute('aria-label', m.layersLabel || 'Layers');
    fill(E.ddPov, !hidden && S.menu === 'pov' ? (m.pov || []) : null, 'pov');
    fill(E.ddLay, !hidden && S.menu === 'layers' ? (m.layers || []) : null, 'lay');
    E.sidebar.hidden = hidden || !S.side;
    E.secs.forEach(function (r) { r.c.textContent = r.open ? '⌄' : '›'; r.h.setAttribute('aria-expanded', String(r.open)); r.body.hidden = !r.open; });
    var cr = m.credit; E.credit.hidden = !cr;
    if (cr) { if (E.credit.textContent !== cr.text) E.credit.textContent = cr.text; if (cr.href) E.credit.href = cr.href; else E.credit.removeAttribute('href'); E.credit.title = cr.title || cr.text; }
    E.root.hidden = S.xr;
    var C = window.ImHereCard;
    if (C && C.setShown) C.setShown(!S.xr && !hidden && tag && S.card && !S.side);
    layout();
    if (X) X.dirty = true;
  }
  function layout() {
    if (!mounted) return;
    var root = document.documentElement.style, lr = E.left.getBoundingClientRect(), rr = E.right.getBoundingClientRect();
    var top = (S.state === 'hidden' ? 10 : lr.bottom) + 6;
    if (!E.data.hidden) {
      var avail = rr.left - lr.right - 16;
      if (avail >= 240) { E.data.style.left = (lr.right + 8) + 'px'; E.data.style.right = (innerWidth - rr.left + 8) + 'px'; E.data.style.top = ''; }
      else { E.data.style.left = '10px'; E.data.style.right = '10px'; E.data.style.top = (lr.bottom + 6) + 'px'; }
      var db = E.data.getBoundingClientRect(); top = Math.max(top, db.bottom + 6);   // the card / sidebar start under the data too
    }
    var v = Math.round(top) + 'px';
    if (root.getPropertyValue('--ihb-top') !== v) { root.setProperty('--ihb-top', v); root.setProperty('--imc-top', v); }
  }

  /* ---------------- VR: the same controls as canvas panels, world-mounted by the page ---------------- */
  var X = null;
  function xr(THREE, opts) {
    if (X) return X;
    opts = opts || {};
    function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function bg(g, x, y, w, h, on) { g.fillStyle = on ? 'rgba(40,70,100,0.92)' : 'rgba(12,16,30,0.78)'; rrect(g, x, y, w, h, 14); g.fill(); g.strokeStyle = on ? 'rgba(160,220,255,0.9)' : 'rgba(255,255,255,0.3)'; g.lineWidth = 2; g.stroke(); }
    function fit(g, t, w) { t = String(t == null ? '' : t); if (g.measureText(t).width <= w) return t; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
    function panel(key, cw, ch, wm) {
      var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      var tex = new THREE.CanvasTexture(cv); if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      var hm = wm * ch / cw;
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      mesh.renderOrder = 10000; mesh.frustumCulled = false; mesh.name = 'imhere-topbar-' + key;
      return { key: key, cv: cv, g: cv.getContext('2d'), tex: tex, mesh: mesh, cw: cw, ch: ch, wm: wm, hm: hm, hits: [], sig: '', hover: null, drawnW: cw, drawnH: ch };
    }
    var P = { left: panel('left', 1500, 100, 1.05), right: panel('right', 540, 100, 0.38), menu: panel('menu', 540, 820, 0.38), side: panel('side', 540, 760, 0.38), credit: panel('credit', 360, 52, 0.17) };
    var KEYS = ['menu', 'side', 'right', 'left'];
    var leftG = new THREE.Group(), rightG = new THREE.Group(), lowG = new THREE.Group();
    leftG.name = 'imhere-topbar-leftgroup'; rightG.name = 'imhere-topbar-rightgroup';
    // left edge of the left panel at the group origin; top edges at the group origin
    leftG.add(P.left.mesh); P.left.mesh.position.set(P.left.wm / 2, -P.left.hm / 2, 0);
    leftG.add(P.side.mesh); P.side.mesh.position.set(P.side.wm / 2, -P.left.hm - 0.012 - P.side.hm / 2, 0);
    rightG.add(P.right.mesh); P.right.mesh.position.set(-P.right.wm / 2, -P.right.hm / 2, 0);
    rightG.add(P.menu.mesh); P.menu.mesh.position.set(-P.menu.wm / 2, -P.right.hm - 0.012 - P.menu.hm / 2, 0.003);
    lowG.add(P.credit.mesh); P.credit.mesh.position.set(-P.credit.wm / 2, P.credit.hm / 2, 0);
    var CW = opts.cardWidth || 0.3, Card = window.ImHereCard;
    var card = Card && Card.xrPanel ? Card.xrPanel(THREE, { exitRow: true, expandable: true, width: CW }) : null;
    if (card) { leftG.add(card); card.position.set(CW / 2, 0, 0); }
    function face(o, x, y, z) { o.position.set(x, y, z); o.rotation.set(-Math.atan2(y, Math.hypot(x, z)), Math.atan2(-x, -z), 0, 'YXZ'); }
    // one band high along the top of the windshield (+16 deg): left group from 30 deg left, the corner to 26 deg right
    face(leftG, -0.6, 0.36, -1.0); face(rightG, 0.52, 0.36, -1.05); face(lowG, 0.62, -0.42, -1.0);
    function drawLeft(m) {
      var p = P.left, g = p.g, H = p.ch, h = p.hover, st = S.state, tag = !!m.tag || !!m.xrTag;
      var sig = JSON.stringify([st, tag, S.side, S.card, !!m.live, h, st === 'full' ? m.data : 0]); if (sig === p.sig) return; p.sig = sig;
      g.clearRect(0, 0, p.cw, H); p.hits = [];
      if (st === 'hidden') {   // one faint dot, big hit area
        g.fillStyle = m.live ? GREEN : AMBER; g.globalAlpha = h === 'dot' ? 0.95 : 0.6; g.beginPath(); g.arc(48, H / 2, 16, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        p.hits.push(['dot', 0, 0, 120, H]); p.tex.needsUpdate = true; return;
      }
      bg(g, 4, 4, 92, H - 8, h === 'side' || S.side); g.fillStyle = '#fff'; for (var i = -1; i <= 1; i++) g.fillRect(28, H / 2 + i * 14 - 3, 44, 6); p.hits.push(['side', 0, 0, 100, H]);
      if (!tag) { p.tex.needsUpdate = true; return; }
      bg(g, 104, 4, 222, H - 8, h === 'tag' || S.card);
      g.font = '900 34px ' + MARKF; g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.textBaseline = 'middle'; g.strokeText("i'm here", 120, H / 2 + 2);
      g.fillStyle = m.live ? GREEN : AMBER; g.beginPath(); g.arc(304, H / 2, 11, 0, Math.PI * 2); g.fill(); p.hits.push(['tag', 100, 0, 228, H]);
      g.font = '600 46px ' + MONO; g.textAlign = 'center';
      bg(g, 330, 4, 76, H - 8, h === 'less'); g.fillStyle = '#fff'; g.fillText('‹', 368, H / 2 + 2); p.hits.push(['less', 328, 0, 80, H]);
      if (st !== 'full') { bg(g, 410, 4, 76, H - 8, h === 'more'); g.fillStyle = '#fff'; g.fillText('›', 448, H / 2 + 2); p.hits.push(['more', 408, 0, 80, H]); }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      if (st === 'full' && m.data && m.data.length) {
        var x = 436, x0 = 414;
        g.fillStyle = 'rgba(6,16,26,0.82)'; rrect(g, x0, 4, p.cw - x0 - 4, H - 8, 14); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2; g.stroke();
        for (var k = 0; k < m.data.length; k++) {
          var kv = m.data[k]; g.font = '400 19px ' + MONO; var kw = g.measureText(kv[0]).width; g.font = '600 27px ' + MONO; var vw = g.measureText(kv[1]).width, w = Math.max(kw, vw);
          if (x + w > p.cw - 20) break;
          g.font = '400 19px ' + MONO; g.fillStyle = CYAN; g.fillText(kv[0], x, 38); g.font = '600 27px ' + MONO; g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillText(kv[1], x, 74); x += w + 28;
        }
      }
      p.tex.needsUpdate = true;
    }
    function drawRight(m) {
      var p = P.right, g = p.g, H = p.ch, h = p.hover;
      var sig = JSON.stringify([S.state, S.menu, h]); if (sig === p.sig) return; p.sig = sig;
      g.clearRect(0, 0, p.cw, H); p.hits = [];
      if (S.state === 'hidden') { p.tex.needsUpdate = true; return; }
      g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = '500 28px ' + MONO;
      bg(g, 4, 4, 236, H - 8, h === 'pov' || S.menu === 'pov'); g.fillStyle = '#fff'; g.fillText('POV ▾', 122, H / 2 + 2); p.hits.push(['pov', 0, 0, 244, H]);
      bg(g, 250, 4, 286, H - 8, h === 'layers' || S.menu === 'layers'); g.fillStyle = '#fff'; g.fillText('◫ Layers ▾', 393, H / 2 + 2); p.hits.push(['layers', 246, 0, 294, H]);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; p.tex.needsUpdate = true;
    }
    function drawList(p, items, title) {
      var g = p.g, W = p.cw, h = p.hover;
      var sig = JSON.stringify([items, title, h]); if (sig === p.sig) return; p.sig = sig;
      g.clearRect(0, 0, W, p.ch); p.hits = [];
      var RH = 70, top = title ? 56 : 8, H = Math.min(p.ch, top + items.length * RH + 10);
      g.fillStyle = 'rgba(12,16,30,0.88)'; rrect(g, 3, 3, W - 6, H - 6, 16); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2; g.stroke();
      if (title) { g.font = '600 22px ' + MONO; g.fillStyle = CYAN; g.fillText(title, 22, 38); }
      items.forEach(function (it, i) {
        var y = top + i * RH; if (y + RH > p.ch) return;
        var f = it[3], dis = has(f, 'dis'), hov = !dis && h === it[0];
        if (hov || has(f, 'sel')) { g.fillStyle = hov ? 'rgba(60,110,150,0.85)' : 'rgba(40,80,110,0.6)'; rrect(g, 10, y + 3, W - 20, RH - 6, 10); g.fill(); }
        var box = has(f, 'on') || has(f, 'off') || (dis && it[2]);
        if (box) { g.strokeStyle = dis ? 'rgba(255,255,255,0.3)' : '#fff'; g.lineWidth = 3; g.strokeRect(24, y + 22, 26, 26); if (has(f, 'on')) { g.fillStyle = GREEN; g.fillRect(29, y + 27, 16, 16); } }
        var tx = box ? 66 : 24;
        g.font = '500 28px ' + MONO; g.fillStyle = dis ? 'rgba(255,255,255,0.4)' : '#fff'; g.fillText(fit(g, it[1], W - tx - 20 - (it[2] ? 130 : 0)), tx, y + 45);
        if (it[2]) { g.font = '400 20px ' + MONO; g.fillStyle = dis ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)'; g.textAlign = 'right'; g.fillText(fit(g, it[2], 200), W - 22, y + 44); g.textAlign = 'left'; }
        if (!dis) p.hits.push([it[0], 0, y, W, RH]);
      });
      p.drawnH = H; p.tex.needsUpdate = true;
    }
    function drawCredit(m) {
      var p = P.credit, g = p.g, cr = m.credit, sig = JSON.stringify(cr || null); if (sig === p.sig) return; p.sig = sig;
      g.clearRect(0, 0, p.cw, p.ch); if (!cr) { p.tex.needsUpdate = true; return; }
      g.font = '600 26px system-ui,sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 6; g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(fit(g, cr.short || cr.text, p.cw - 16), p.cw - 8, p.ch / 2);
      g.shadowBlur = 0; g.textAlign = 'left'; p.tex.needsUpdate = true;
    }
    var at = 0;
    X = {
      left: leftG, right: rightG, low: lowG, card: card, panels: P, dirty: true,
      attach: function (group) { group.add(leftG, rightG, lowG); },
      step: function (now) {
        if (!X.dirty && now - at < 250) return; if (now - at < 100) return;   // at most 10 Hz, at least 4 Hz
        at = now; X.dirty = false;
        var m = M(), hidden = S.state === 'hidden';
        drawLeft(m); drawRight(m); drawCredit(m);
        var items = !hidden && S.menu ? (S.menu === 'pov' ? m.pov : m.layers) : null;
        P.menu.mesh.visible = !!items; if (items) drawList(P.menu, items, S.menu === 'pov' ? 'POV' : 'Layers');
        P.side.mesh.visible = !hidden && S.side; if (P.side.mesh.visible) drawList(P.side, m.sideItems || [], m.sideTitle || '');
        P.credit.mesh.visible = !!m.credit;
        if (card) {
          card.visible = !hidden && (!!m.tag || !!m.xrTag);
          if (Card.xrShowBody) Card.xrShowBody(S.card && !S.side);
          card.position.set(CW / 2, -P.left.hm - 0.012 - (card.userData.height || 0.2) / 2, 0);
        }
      },
      ray: function (o, d) { return probe(o, d); },
      hover: function (o, d) { var h = probe(o, d); if (h && !hov.key) { hov.key = h.key; hov.id = h.id; } return h; },
      hoverEnd: function (now) {
        KEYS.forEach(function (k) { var want = hov.key === k ? hov.id : null; if (P[k].hover !== want) { P[k].hover = want; P[k].sig = ''; X.dirty = true; } });
        if (hov.key === 'menu' || hov.key === 'right') menuSeen = now;
        if (S.menu && now - Math.max(menuSeen, S.menuAt) > 1500) setMenu(null);   // pointing away closes the menu
        hov.key = null; hov.id = null;
      },
      select: function (o, d) { var h = probe(o, d); if (!h) return false; if (h.id) { menuSeen = performance.now(); act(h.id); } return true; }
    };
    var hov = { key: null, id: null }, menuSeen = 0;
    var mi = new THREE.Matrix4(), lo = new THREE.Vector3(), ld = new THREE.Vector3(), R = { key: null, id: null };
    function shown(o) { for (var x = o; x; x = x.parent) if (!x.visible) return false; return true; }
    function probe(o, d) {
      for (var i = 0; i < KEYS.length; i++) {
        var p = P[KEYS[i]]; if (!shown(p.mesh)) continue;
        mi.copy(p.mesh.matrixWorld).invert(); lo.copy(o).applyMatrix4(mi); ld.copy(o).add(d).applyMatrix4(mi).sub(lo);
        if (Math.abs(ld.z) < 1e-9) continue; var t = -lo.z / ld.z; if (t <= 0) continue;
        var x = lo.x + ld.x * t, y = lo.y + ld.y * t; if (Math.abs(x) > p.wm / 2 || Math.abs(y) > p.hm / 2) continue;
        var px = (x / p.wm + 0.5) * p.cw, py = (0.5 - y / p.hm) * p.ch, id = null;
        for (var j = 0; j < p.hits.length; j++) { var r = p.hits[j]; if (px >= r[1] && px <= r[1] + r[3] && py >= r[2] && py <= r[2] + r[4]) { id = r[0]; break; } }
        if (id != null || ((p.key === 'menu' || p.key === 'side') && py <= p.drawnH)) { R.key = p.key; R.id = id; return R; }
      }
      if (card && shown(card) && Card.xrHitTest) {
        mi.copy(card.matrixWorld).invert(); lo.copy(o).applyMatrix4(mi); ld.copy(o).add(d).applyMatrix4(mi).sub(lo);
        if (Math.abs(ld.z) > 1e-9) { var t2 = -lo.z / ld.z; if (t2 > 0) { var r2 = Card.xrHitTest(card, lo.x + ld.x * t2, lo.y + ld.y * t2); if (r2) { R.key = 'card'; R.id = r2 === 'exit' ? null : 'card'; return R; } } }
      }
      return null;
    }
    return X;
  }

  window.ImHereTopbar = {
    init: function (o) { O = o || {}; if (O.zIndex) document.documentElement.style.setProperty('--ihb-z', String(O.zIndex)); mount(); render(); return this; },
    update: function () { render(); return this; },
    act: function (id) { act(id); return this; },
    state: function () { return S.state; }, setState: function (s) { setState(s); return this; },
    sideOpen: function () { return S.side; }, setSide: function (b) { S.side = !!b; if (S.side) S.card = false; render(); return this; },
    cardOpen: function () { return S.card; }, setCard: function (b) { S.card = !!b; if (S.card) S.side = false; render(); return this; },
    menu: function () { return S.menu; }, setMenu: function (m) { setMenu(m); return this; },
    setXR: function (on) { on = !!on; if (on !== S.xr) { S.xr = on; S.menu = null; render(); } return this; },
    section: function (id, open) { E.secs && E.secs.forEach(function (r) { if (r.id === id) r.open = !!open; }); render(); return this; },
    xr: xr
  };
})();

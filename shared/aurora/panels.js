// XR Aurora · canvas-drawn surfaces: the static decal atlas (wordmark, plaques, hull lettering), the helm screens atlas,
// the ring menu band, the holographic list panel, the in-world toast, the globe's land texture and a soft glow sprite.
// Every canvas is drawn once or only when its words change (signatures), never per frame.
import * as THREE from 'three';
import { decodeLand, LAND_W, LAND_H } from './earth-land.js';

export const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
export const MARKF = '"Arial Black","Helvetica Neue",Arial,sans-serif';
export const SANS = '"Helvetica Neue",Arial,system-ui,sans-serif';
const CYAN = '#6fdcff', CYAN_D = 'rgba(110,220,235,0.72)', WHITE = 'rgba(255,255,255,0.92)', AMBER = '#ffbf47', GREEN = '#7ef0a2';

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function texOf(c, { mips = true } = {}) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}
export function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function fit(g, t, w) { t = String(t == null ? '' : t); if (g.measureText(t).width <= w) return t; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
function wrap(g, text, x, y, w, lh, maxLines) {
  const words = String(text || '').split(/\s+/); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(t).width > w && line) { if (n === maxLines - 1) { g.fillText(fit(g, line + ' ' + words.slice(i).join(' '), w), x, y + n * lh); return n + 1; } g.fillText(line, x, y + n * lh); n++; line = words[i]; }
    else line = t;
  }
  if (line) { g.fillText(line, x, y + n * lh); n++; }
  return n;
}

// ------------------------------------------------------------------ static atlas (1024 x 1024), one material for all decals
// rect: [x, y, w, h] in canvas px. uvRect() turns it into [u0, v0, u1, v1] (flipY: v = 1 - y / H).
export const ATLAS = {
  wordmark: [0, 0, 1024, 256], plaque: [0, 256, 1024, 128], drive: [0, 384, 1024, 128],
  hullMark: [0, 512, 1024, 256], hullName: [0, 768, 1024, 128], ringBack: [0, 896, 1024, 128],
};
export function uvRect(r, W = 1024, H = 1024) { return [r[0] / W, 1 - (r[1] + r[3]) / H, (r[0] + r[2]) / W, 1 - r[1] / H]; }
// a plane of size w x h whose UVs cover one atlas rect
export function atlasPlane(w, h, rect) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [u0, v0, u1, v1] = uvRect(rect);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}
function hollowMark(g, text, x, y, size, { stroke = 'rgba(255,255,255,0.92)', glow = 'rgba(90,200,255,0.9)', lw = 3 } = {}) {
  g.font = `900 ${size}px ${MARKF}`; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.save(); g.shadowColor = glow; g.shadowBlur = size * 0.35; g.lineWidth = lw * 1.6; g.strokeStyle = glow; g.strokeText(text, x, y); g.restore();
  g.lineWidth = lw; g.strokeStyle = stroke; g.strokeText(text, x, y);
}
export function staticAtlas() {
  const c = canvas(1024, 1024), g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  // "i'm here" wordmark: hollow lowercase, heavy wide font (the I'M HERE mark), soft cyan glow
  g.textAlign = 'center'; g.letterSpacing = '6px';
  hollowMark(g, "i'm here", 512, 118, 150, { lw: 4 });
  g.font = `600 30px ${SANS}`; g.fillStyle = 'rgba(150,220,255,0.85)'; g.letterSpacing = '14px'; g.fillText('OMNIDIMENSIONAL EXPLORATION CRAFT', 512, 222);
  // plaque: XR Aurora · IH-0000 (brushed dark panel, champagne lettering)
  { const [x, y, w, h] = ATLAS.plaque; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#2b2f36'); gr.addColorStop(1, '#14171c');
    g.fillStyle = gr; rrect(g, x + 6, y + 6, w - 12, h - 12, 18); g.fill(); g.lineWidth = 4; g.strokeStyle = '#c9a76b'; g.stroke();
    g.letterSpacing = '8px'; g.fillStyle = '#e9d3a6'; g.font = `700 50px ${SANS}`; g.fillText('XR AURORA · IH-0000', 512, y + 56);
    g.letterSpacing = '10px'; g.font = `500 22px ${SANS}`; g.fillStyle = 'rgba(233,211,166,0.7)'; g.fillText('OMNI-CLASS · FLAGSHIP', 512, y + 100); }
  // TEMPORAL DRIVE label (dark glass, cyan)
  { const [x, y, w, h] = ATLAS.drive; g.fillStyle = 'rgba(8,18,30,0.92)'; rrect(g, x + 120, y + 14, w - 240, h - 28, 40); g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(111,220,255,0.9)'; g.stroke();
    g.letterSpacing = '12px'; g.font = `700 52px ${SANS}`; g.fillStyle = '#bff0ff'; g.save(); g.shadowColor = CYAN; g.shadowBlur = 16; g.fillText('TEMPORAL DRIVE', 512, y + 66); g.restore(); }
  // hull lettering: i'm here · OMNIDIMENSIONAL DRIVE (on the hull, transparent ground)
  { const y = ATLAS.hullMark[1]; g.letterSpacing = '6px'; hollowMark(g, "i'm here", 512, y + 100, 132, { lw: 4, stroke: 'rgba(225,245,255,0.95)', glow: 'rgba(80,190,255,0.8)' });
    g.letterSpacing = '16px'; g.font = `600 36px ${SANS}`; g.fillStyle = 'rgba(200,236,255,0.92)'; g.fillText('OMNIDIMENSIONAL DRIVE', 512, y + 206); }
  { const y = ATLAS.hullName[1]; g.letterSpacing = '18px'; g.font = `700 54px ${SANS}`; g.fillStyle = 'rgba(30,40,52,0.9)'; g.fillText('XR AURORA  IH-0000', 512, y + 64); }
  // the ring band's back (plain glowing ticks, behind the six items)
  { const [x, y, w, h] = ATLAS.ringBack; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(20,60,90,0.9)'); gr.addColorStop(1, 'rgba(6,16,28,0.95)');
    g.fillStyle = gr; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(111,220,255,0.55)'; for (let i = 0; i < 64; i++) g.fillRect(x + i * 16 + 4, y + 50, 3, i % 4 ? 18 : 34); }
  g.letterSpacing = '0px'; g.textAlign = 'left';
  return texOf(c);
}

// ------------------------------------------------------------------ ring menu band (2048 x 256): six items + hover
export const RING_ITEMS = [['destination', 'DESTINATION'], ['time', 'TIME'], ['scale', 'SCALE'], ['phase', 'PHASE'], ['share', 'SHARE'], ['systems', 'SYSTEMS']];
function icon(g, id, cx, cy, s, col) {
  g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = s * 0.08; g.lineCap = 'round'; g.lineJoin = 'round';
  const r = s / 2;
  if (id === 'destination') { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx - r * 0.86, cy - r * 0.5); g.lineTo(cx + r * 0.86, cy - r * 0.5); g.moveTo(cx - r * 0.86, cy + r * 0.5); g.lineTo(cx + r * 0.86, cy + r * 0.5); g.stroke(); }
  else if (id === 'time') { g.beginPath(); g.moveTo(cx - r * 0.7, cy - r); g.lineTo(cx + r * 0.7, cy - r); g.lineTo(cx - r * 0.7, cy + r); g.lineTo(cx + r * 0.7, cy + r); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(cx - r * 0.3, cy + r * 0.75); g.lineTo(cx + r * 0.3, cy + r * 0.75); g.lineTo(cx, cy + r * 0.35); g.closePath(); g.fill(); }
  else if (id === 'scale') { for (let k = 0; k < 3; k++) { const y = cy - r * 0.55 + k * r * 0.55; g.beginPath(); g.moveTo(cx - r, y); g.lineTo(cx, y - r * 0.35); g.lineTo(cx + r, y); g.lineTo(cx, y + r * 0.35); g.closePath(); g.stroke(); } }
  else if (id === 'phase') { g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.87, cy - r * 0.5); g.lineTo(cx + r * 0.87, cy + r * 0.5); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.87, cy + r * 0.5); g.lineTo(cx - r * 0.87, cy - r * 0.5); g.closePath(); g.stroke();
    g.setLineDash([s * 0.08, s * 0.08]); g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.moveTo(cx - r * 0.87, cy - r * 0.5); g.lineTo(cx + r * 0.87, cy + r * 0.5); g.stroke(); g.setLineDash([]); }
  else if (id === 'share') { const p = [[cx - r * 0.6, cy - r * 0.1], [cx + r * 0.6, cy - r * 0.1], [cx, cy - r * 0.35]];
    for (const [x, y] of p) { g.beginPath(); g.arc(x, y - r * 0.25, r * 0.22, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y + r * 0.55, r * 0.38, Math.PI, 0); g.stroke(); } }
  else if (id === 'systems') { g.beginPath(); g.arc(cx, cy, r * 0.42, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62); g.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95); g.stroke(); }
    g.beginPath(); g.arc(cx, cy, r * 0.75, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
export function ringMenu() {
  const c = canvas(2048, 256), g = c.getContext('2d'), tex = texOf(c);
  let sig = '';
  function draw(hover, active) {
    const s = hover + '|' + active; if (s === sig) return; sig = s;
    const W = c.width, H = c.height, n = RING_ITEMS.length, cw = W / n;
    g.clearRect(0, 0, W, H);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(18,48,78,0.96)'); bg.addColorStop(1, 'rgba(5,12,24,0.98)');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(111,220,255,0.9)'; g.fillRect(0, 0, W, 5); g.fillRect(0, H - 4, W, 4);
    RING_ITEMS.forEach(([id, label], i) => {
      const x = i * cw, on = id === hover, act = id === active;
      if (on || act) { g.fillStyle = on ? 'rgba(80,190,255,0.38)' : 'rgba(80,190,255,0.2)'; rrect(g, x + 10, 14, cw - 20, H - 28, 22); g.fill();
        g.lineWidth = 4; g.strokeStyle = 'rgba(160,235,255,0.95)'; g.stroke(); }
      if (i) { g.fillStyle = 'rgba(111,220,255,0.35)'; g.fillRect(x - 1, 30, 2, H - 60); }
      icon(g, id, x + cw / 2, 92, 92, on ? '#ffffff' : '#9fe8ff');
      g.font = `700 34px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? '#ffffff' : '#d4f4ff';
      g.letterSpacing = '3px'; g.fillText(label, x + cw / 2, 196); g.letterSpacing = '0px';
    });
    tex.needsUpdate = true;
  }
  draw(null, null);
  return { tex, draw };
}

// ------------------------------------------------------------------ helm screens atlas: 5 cells of 408 x 272 in 2048 x 272
export const SCREEN_W = 408, SCREEN_H = 272, SCREEN_N = 5;
export function screensAtlas() {
  const c = canvas(2048, 272), g = c.getContext('2d'), tex = texOf(c, { mips: false });
  const sigs = new Array(SCREEN_N).fill('');
  function frame(i, title, live) {
    const x = i * 410, W = SCREEN_W, H = SCREEN_H;
    g.beginPath(); g.rect(x, 0, W, H); g.clip();
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#071a2c'); bg.addColorStop(1, '#030b16'); g.fillStyle = bg; g.fillRect(x, 0, W, H);
    g.strokeStyle = 'rgba(111,220,255,0.10)'; g.lineWidth = 1; for (let k = 0; k < W; k += 24) { g.beginPath(); g.moveTo(x + k + 0.5, 0); g.lineTo(x + k + 0.5, H); g.stroke(); }
    for (let k = 0; k < H; k += 24) { g.beginPath(); g.moveTo(x, k + 0.5); g.lineTo(x + W, k + 0.5); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = 'rgba(111,220,255,0.75)'; rrect(g, x + 3, 3, W - 6, H - 6, 12); g.stroke();
    g.fillStyle = 'rgba(111,220,255,0.18)'; g.fillRect(x + 6, 6, W - 12, 34);
    g.font = `700 19px ${MONO}`; g.fillStyle = '#bff0ff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(title, x + 16, 24);
    if (live) { g.fillStyle = live === 'LIVE' ? GREEN : AMBER; g.textAlign = 'right'; g.font = `700 15px ${MONO}`; g.fillText('● ' + live, x + W - 14, 24); g.textAlign = 'left'; }
    return x;
  }
  function rows(x, list, y0 = 66, lh = 30) {
    list.forEach(([k, v], j) => { const y = y0 + j * lh; g.font = `500 15px ${MONO}`; g.fillStyle = CYAN_D; g.fillText(k, x + 16, y);
      g.font = `600 20px ${MONO}`; g.fillStyle = WHITE; g.fillText(fit(g, v, SCREEN_W - 130), x + 112, y); });
  }
  const draw = {
    0(d) { const x = frame(0, 'LOCATION · WEATHER', null);
      rows(x, [['PLACE', d.place || '—'], ['LAT', d.lat || '—'], ['LON', d.lon || '—'], ['ALT', d.alt || '—'], ['HDG', d.hdg || '—'], ['WX', d.wx || '—'], ['TEMP', d.temp || '—']], 62, 29); },
    1(d) { const x = frame(1, 'TRACKED SUBJECTS', null);
      const list = d.tracked && d.tracked.length ? d.tracked : null;
      if (list) list.slice(0, 6).forEach((t, j) => { const y = 66 + j * 32; g.fillStyle = t.live ? GREEN : AMBER; g.beginPath(); g.arc(x + 22, y, 5, 0, 7); g.fill();
        g.font = `600 18px ${MONO}`; g.fillStyle = WHITE; g.fillText(fit(g, t.name, 230), x + 36, y); g.font = `500 14px ${MONO}`; g.fillStyle = CYAN_D; g.textAlign = 'right'; g.fillText(fit(g, t.info || '', 120), x + SCREEN_W - 14, y); g.textAlign = 'left'; });
      else { g.font = `600 19px ${MONO}`; g.fillStyle = WHITE; g.fillText('No tracked subjects', x + 16, 78);
        g.font = `500 15px ${MONO}`; g.fillStyle = CYAN_D; wrap(g, 'Layers will add live planes, ships and tagged wildlife here.', x + 16, 116, SCREEN_W - 32, 22, 4); }
    },
    2(d) { const x = frame(2, 'MAP · ' + (d.mapTitle || 'ROUTE'), null), W = SCREEN_W, H = SCREEN_H;
      const pts = d.map || [], cx = x + W / 2, cy = 40 + (H - 40) / 2;
      if (pts.length) {
        let r = 1; for (const p of pts) r = Math.max(r, Math.abs(p.x - d.me.x), Math.abs(p.z - d.me.z));
        const k = Math.min((W - 60) / 2, (H - 70) / 2) / (r * 1.15);
        const X = (p) => cx - (p.x - d.me.x) * k, Y = (p) => cy - (p.z - d.me.z) * k;   // x = west, z = north: north up
        g.strokeStyle = 'rgba(111,220,255,0.55)'; g.lineWidth = 2; g.setLineDash([6, 6]); g.beginPath(); pts.forEach((p, j) => (j ? g.lineTo(X(p), Y(p)) : g.moveTo(X(p), Y(p)))); g.stroke(); g.setLineDash([]);
        pts.forEach((p, j) => { g.fillStyle = j === d.stop ? '#ffffff' : 'rgba(111,220,255,0.9)'; g.beginPath(); g.arc(X(p), Y(p), j === d.stop ? 6 : 4, 0, 7); g.fill();
          g.font = `500 13px ${MONO}`; g.fillStyle = 'rgba(220,245,255,0.8)'; g.fillText(fit(g, p.name, 120), X(p) + 8, Y(p) - 8); });
        const sb = 1000 * k; if (sb > 20 && sb < W - 40) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 16, H - 22, sb, 3); g.font = `500 12px ${MONO}`; g.fillText('1 km', x + 20 + sb, H - 20); }
      }
      g.save(); g.translate(cx, cy); g.rotate(d.heading || 0); g.fillStyle = AMBER; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.restore();
      g.font = `700 14px ${MONO}`; g.fillStyle = 'rgba(220,245,255,0.8)'; g.fillText('N', x + W - 26, 58);
    },
    3(d) { const x = frame(3, 'FIELD GUIDE', null);
      g.font = `700 20px ${MONO}`; g.fillStyle = WHITE; g.fillText(fit(g, d.guideTitle || '—', SCREEN_W - 32), x + 16, 64);
      g.font = `500 15px ${SANS}`; g.fillStyle = 'rgba(215,240,255,0.88)'; wrap(g, d.guide || '', x + 16, 96, SCREEN_W - 32, 21, 8); },
    4(d) { const x = frame(4, 'TEMPORAL COORDINATES', null);
      rows(x, [['DATE', d.date || '—'], ['TIME', d.time || '—'], ['ERA', 'Present day'], ['TARGET', 'Now']], 66, 32);
      g.font = `700 16px ${MONO}`; g.fillStyle = AMBER; g.fillText('STATUS  Locked · time travel soon', x + 16, 66 + 4 * 32 + 6); },
  };
  function update(d, only) {
    let changed = false;
    for (let i = 0; i < SCREEN_N; i++) {
      if (only != null && only !== i) continue;
      const s = JSON.stringify(SIG_FIELDS[i].map((k) => d[k])); if (s === sigs[i]) continue; sigs[i] = s;
      g.save(); draw[i](d); g.restore(); changed = true;
    }
    if (changed) tex.needsUpdate = true;
  }
  const SIG_FIELDS = [['place', 'lat', 'lon', 'alt', 'hdg', 'wx', 'temp'], ['tracked'], ['map', 'me', 'heading', 'stop', 'mapTitle'], ['guideTitle', 'guide'], ['date', 'time']];
  return { tex, update };
}
// UVs of screen i inside the atlas
export function screenPlane(w, h, i) { return atlasPlaneIn(w, h, [i * 410, 0, SCREEN_W, SCREEN_H], 2048, 272); }
export function atlasPlaneIn(w, h, r, W, H) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [u0, v0, u1, v1] = uvRect(r, W, H);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

// ------------------------------------------------------------------ holographic list panel (1024 x 640) above the globe table
export function holoPanel() {
  const c = canvas(1024, 640), g = c.getContext('2d'), tex = texOf(c, { mips: false });
  let sig = '', hits = [];
  function draw(title, items, hover) {
    const s = JSON.stringify([title, items, hover]); if (s === sig) return; sig = s; hits = [];
    g.clearRect(0, 0, 1024, 640);
    const H = 96 + items.length * 112 + 24;
    g.fillStyle = 'rgba(6,22,40,0.82)'; rrect(g, 8, 8, 1008, H - 16, 28); g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(111,220,255,0.9)'; g.stroke();
    g.font = `700 40px ${MONO}`; g.fillStyle = '#bff0ff'; g.textBaseline = 'middle'; g.fillText(title, 44, 60);
    items.forEach((it, i) => {
      const y = 96 + i * 112, on = hover === it.id && !it.dis;
      if (on || it.sel) { g.fillStyle = on ? 'rgba(80,170,230,0.5)' : 'rgba(60,120,170,0.35)'; rrect(g, 28, y + 6, 968, 100, 18); g.fill(); }
      g.font = `600 44px ${SANS}`; g.fillStyle = it.dis ? 'rgba(255,255,255,0.5)' : '#ffffff'; g.fillText(it.text, 60, y + 46);
      if (it.sub) { g.font = `500 28px ${SANS}`; g.fillStyle = it.dis ? 'rgba(255,191,71,0.85)' : 'rgba(126,240,162,0.95)'; g.fillText(it.sub, 60, y + 86); }
      hits.push([it.id, y, 112]);
    });
    tex.needsUpdate = true;
  }
  // canvas px -> item id
  function hit(px, py) { for (const [id, y, h] of hits) if (py >= y && py < y + h && px > 20 && px < 1004) return id; return null; }
  return { tex, draw, hit, size: [1024, 640] };
}

// ------------------------------------------------------------------ toast (in-world, 1024 x 160)
export function toastPanel() {
  const c = canvas(1024, 160), g = c.getContext('2d'), tex = texOf(c, { mips: false });
  function draw(text) {
    g.clearRect(0, 0, 1024, 160); g.font = `600 52px ${SANS}`; const w = Math.min(1000, g.measureText(text).width + 90);
    g.fillStyle = 'rgba(8,18,32,0.86)'; rrect(g, 512 - w / 2, 14, w, 132, 66); g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(111,220,255,0.8)'; g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fit(g, text, 940), 512, 82); g.textAlign = 'left';
    tex.needsUpdate = true;
  }
  return { tex, draw };
}

// ------------------------------------------------------------------ globe land texture (1024 x 512; r = land, g = coast)
export function globeTexture() {
  const land = decodeLand(), W = 1024, H = 512, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x * 2, sy = y * 2, i = sy * LAND_W + sx;
    const v = land[i] + land[i + 1] + land[i + LAND_W] + land[i + LAND_W + 1];
    const o = ((H - 1 - y) * W + x) * 4; data[o] = v * 63; data[o + 1] = v > 0 && v < 4 ? 255 : 0; data[o + 2] = 0; data[o + 3] = 255;
  }
  // coast: land pixels next to sea
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const o = (y * W + x) * 4; if (data[o] < 128) continue;
    if (data[o - 4] < 128 || data[o + 4] < 128 || data[o - W * 4] < 128 || data[o + W * 4] < 128) data[o + 1] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  void LAND_H;
  return t;
}

// ------------------------------------------------------------------ soft round glow (additive sprites)
export function glowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(120,220,255,0.45)') {
  const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.18, mid); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return texOf(c);
}

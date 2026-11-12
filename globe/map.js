// I'M HERE globe: a small slippy map on one <canvas> (Web Mercator, raster tiles, pan / wheel / pinch / tap).
// Written for this page instead of a map library: no third-party script to load, one canvas to draw (light on the
// Quest browser and phones), and the layers draw straight onto it.
const TILE = 256, MAXLAT = 85.05112878, D2R = Math.PI / 180;

export function lonToX(lon, z) { return (lon + 180) / 360 * TILE * 2 ** z; }
export function latToY(lat, z) { const s = Math.sin(Math.max(-MAXLAT, Math.min(MAXLAT, lat)) * D2R); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; }
export function xToLon(x, z) { return x / (TILE * 2 ** z) * 360 - 180; }
export function yToLat(y, z) { const n = Math.PI - 2 * Math.PI * y / (TILE * 2 ** z); return Math.atan(Math.sinh(n)) / D2R; }

export class TinyMap {
  // layers: [{ url: 'https://.../{z}/{y}/{x}', maxZoom }]; draw(ctx, map) is called after the tiles each frame.
  // onTap(x, y, e) on a tap/click; onHover(x, y, e) on pointer moves with nothing pressed (x = null when it leaves).
  constructor(canvas, { layers, minZoom = 2, maxZoom = 17, lat = 36.12, lon = -86.68, zoom = 7, draw, onChange, onTap, onHover }) {
    Object.assign(this, { canvas, layers, minZoom, maxZoom, lat, lon, zoom, draw, onChange, onTap, onHover });
    this.ctx = canvas.getContext('2d');
    this.cache = new Map(); this.pending = 0; this.frameQueued = false; this.w = 0; this.h = 0;
    this.pointers = new Map(); this.anim = null;
    this.resize(); this._bind();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.invalidate(true);
  }
  // --- projection helpers (screen = CSS pixels)
  worldSize(z = this.zoom) { return TILE * 2 ** z; }
  centerPx(z = this.zoom) { return [lonToX(this.lon, z), latToY(this.lat, z)]; }
  toScreen(lat, lon) {
    const [cx, cy] = this.centerPx(), W = this.worldSize();
    let x = lonToX(lon, this.zoom) - cx; x -= Math.round(x / W) * W;   // nearest copy of the world
    return [x + this.w / 2, latToY(lat, this.zoom) - cy + this.h / 2];
  }
  toLatLon(sx, sy) {
    const [cx, cy] = this.centerPx();
    const lon = wrapLon(xToLon(cx + sx - this.w / 2, this.zoom));
    return [yToLat(cy + sy - this.h / 2, this.zoom), lon];
  }
  bounds() {
    const [n, w] = this.toLatLon(0, 0), [s, e] = this.toLatLon(this.w, this.h);
    const span = this.w / this.worldSize() * 360;
    return span >= 360 ? { s, n, w: -180, e: 180 } : { s, n, w, e };
  }
  // --- view changes
  setView(lat, lon, zoom = this.zoom, { animate = false } = {}) {
    zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    if (!animate) { this.anim = null; this.lat = clampLat(lat); this.lon = wrapLon(lon); this.zoom = zoom; this.changed(); return; }
    const from = { lat: this.lat, lon: this.lon, zoom: this.zoom }, t0 = performance.now(), dur = 700;
    let dl = wrapLon(lon) - from.lon; dl -= Math.round(dl / 360) * 360;
    this.anim = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.lat = clampLat(from.lat + (lat - from.lat) * e); this.lon = wrapLon(from.lon + dl * e); this.zoom = from.zoom + (zoom - from.zoom) * e;
      if (k >= 1) { this.anim = null; this.zoom = zoom; }
      this.changed();
    };
    this.invalidate();
  }
  zoomAround(sx, sy, dz) {
    const z2 = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + dz)); if (z2 === this.zoom) return;
    const [la, lo] = this.toLatLon(sx, sy);
    this.zoom = z2;
    const [px, py] = [lonToX(lo, z2), latToY(la, z2)];
    const cx = px - (sx - this.w / 2), cy = py - (sy - this.h / 2);
    this.lon = wrapLon(xToLon(cx, z2)); this.lat = clampLat(yToLat(cy, z2)); this.changed();
  }
  panBy(dx, dy) {
    const [cx, cy] = this.centerPx();
    this.lon = wrapLon(xToLon(cx - dx, this.zoom)); this.lat = clampLat(yToLat(Math.max(0, Math.min(this.worldSize(), cy - dy)), this.zoom)); this.changed();
  }
  changed() { this.invalidate(); if (this.onChange) this.onChange(this); }
  invalidate() {
    if (this.frameQueued) return; this.frameQueued = true;
    requestAnimationFrame((now) => { this.frameQueued = false; if (this.anim) this.anim(now); this.render(); });
  }
  // --- tiles
  tile(L, z, x, y) {
    const n = 2 ** z; x = ((x % n) + n) % n; if (y < 0 || y >= n) return null;
    const key = L + '/' + z + '/' + x + '/' + y; let t = this.cache.get(key);
    if (t) { this.cache.delete(key); this.cache.set(key, t); return t; }   // LRU touch
    if (this.pending > 24) return null;
    const img = new Image(); t = { img, ok: false }; img.decoding = 'async';
    img.onload = () => { t.ok = true; this.pending--; this.invalidate(); };
    img.onerror = () => { t.bad = true; this.pending--; };
    this.pending++; img.src = this.layers[L].url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    this.cache.set(key, t);
    if (this.cache.size > 400) { for (const k of this.cache.keys()) { const o = this.cache.get(k); if (o.ok || o.bad) { this.cache.delete(k); if (this.cache.size <= 340) break; } } }
    return t;
  }
  peek(L, z, x, y) { const n = 2 ** z; x = ((x % n) + n) % n; const t = this.cache.get(L + '/' + z + '/' + x + '/' + y); return t && t.ok ? t : null; }
  render() {
    const g = this.ctx, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0a1424'; g.fillRect(0, 0, this.w, this.h);
    this.layers.forEach((layer, L) => {
      const zt = Math.max(0, Math.min(layer.maxZoom || 19, Math.round(this.zoom))), s = 2 ** (this.zoom - zt), size = TILE * s;
      const [cx, cy] = this.centerPx(zt), ox = this.w / 2 - cx * s, oy = this.h / 2 - cy * s;
      const x0 = Math.floor(-ox / size), x1 = Math.floor((this.w - ox) / size), y0 = Math.max(0, Math.floor(-oy / size)), y1 = Math.min(2 ** zt - 1, Math.floor((this.h - oy) / size));
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const dx = ox + tx * size, dy = oy + ty * size, t = this.tile(L, zt, tx, ty);
        if (t && t.ok) { g.drawImage(t.img, dx, dy, size + 0.5, size + 0.5); continue; }
        if (L) continue;   // only the base layer borrows a coarser tile while loading
        for (let up = 1; up <= 4 && zt - up >= 0; up++) {
          const p = this.peek(L, zt - up, tx >> up, ty >> up); if (!p) continue;
          const k = 2 ** up, sx = ((tx % k) + k) % k * TILE / k, sy = ((ty % k) + k) % k * TILE / k;
          g.drawImage(p.img, sx, sy, TILE / k, TILE / k, dx, dy, size + 0.5, size + 0.5); break;
        }
      }
    });
    if (this.draw) this.draw(g, this);
  }
  // --- input: drag to pan, wheel / pinch / double-tap to zoom, tap to pick
  _bind() {
    const c = this.canvas; c.style.touchAction = 'none';
    let down = null, lastTap = null, pinch = null;
    // canvas-relative CSS px from clientX/Y (offsetX/Y is unreliable for touch pointers on iOS Safari and with page zoom)
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    // a tap may drift a little: a finger rolls, a Quest controller ray shakes. Measured as distance from where it went down
    // (not summed over every move event), with more room for touch / pen than for a mouse.
    const slop = (e) => (e.pointerType === 'mouse' ? 10 : 14);
    c.addEventListener('pointerdown', (e) => {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: events still reach the canvas */ }
      const [x, y] = pos(e); this.pointers.set(e.pointerId, [x, y]); this.anim = null;
      if (this.pointers.size === 1) down = { x, y, t: performance.now(), far: false };
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: this.zoom }; down = null; }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId), [x, y] = pos(e);
      // hover (mouse, pen, or the Quest browser's controller ray): nothing pressed; touch has no hover (tap instead)
      if (!prev) { if (e.pointerType !== 'touch' && this.onHover) this.onHover(x, y, e); return; }
      this.pointers.set(e.pointerId, [x, y]);
      if (this.pointers.size === 2 && pinch) {
        const [a, b] = [...this.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomAround((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.z + Math.log2(d / pinch.d) - this.zoom);
      } else if (this.pointers.size === 1) {
        if (down && !down.far && Math.hypot(x - down.x, y - down.y) > slop(e)) { down.far = true; this.panBy(x - down.x, y - down.y); return; }
        if (!down || down.far) this.panBy(x - prev[0], y - prev[1]);
      }
    });
    const up = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId); if (this.pointers.size < 2) pinch = null;
      if (down && !down.far && e.type === 'pointerup' && performance.now() - down.t < 700) {
        const now = performance.now(), { x, y } = down;   // the point it went down on, not where it drifted to
        if (lastTap && now - lastTap.t < 300 && e.pointerType !== 'mouse' && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) { this.zoomAround(x, y, 1); lastTap = null; }
        else { lastTap = { t: now, x, y }; if (this.onTap) this.onTap(x, y, e); }
      }
      down = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !this.pointers.size && this.onHover) this.onHover(null, null, e); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.anim = null; const [x, y] = pos(e); this.zoomAround(x, y, Math.max(-1, Math.min(1, -e.deltaY / (e.deltaMode ? 3 : 240)))); }, { passive: false });
    c.addEventListener('dblclick', (e) => { e.preventDefault(); const [x, y] = pos(e); this.zoomAround(x, y, 1); });
    addEventListener('resize', () => this.resize());
  }
}
const clampLat = (v) => Math.max(-80, Math.min(80, v));
const wrapLon = (v) => ((v + 540) % 360 + 360) % 360 - 180;

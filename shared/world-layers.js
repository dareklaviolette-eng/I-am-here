// I'M HERE world layers: every real thing around you (planes, ships, wildlife, the ISS) is one layer with the same interface.
// Pure module (no DOM, no three.js): the registry, refresh timing, cancellation, back-off, on/off state with defaults per
// department, and pointing (which item is the user looking or pointing at). Tested in Node: node shared/test/world-layers-test.mjs
//
// A layer is an object:
//   id, label                         'planes', 'Planes'
//   refreshMs                         number, or (ownship) => ms                        (how often fetchNear runs while on)
//   refetchNm                         optional: refetch early when the ownship moved this far since the last fetch
//   fetchNear(lat, lon, altFt, signal, ownship) -> Promise<data>                       (live data near a point; honour signal)
//   setData(data, now, ownship)       a fetch answered (runs off the frame loop: may allocate)
//   update(parent, ownship, dt, now)  every frame while on: move / draw; NO allocations here
//   pickables() -> array of { active, x, y, z, r, text() }  world-space points the user can look or point at
//   setVisible(on), dispose()
//   status() -> short words for the Layers menu (optional), markItem() -> card "Details" row (optional)
// Adding ships or wildlife = one new layer file + LAYER_CATALOG already lists them (shown as "soon" until registered).

export const LAYER_CATALOG = [
  { id: 'planes', label: 'Planes' },
  { id: 'ships', label: 'Ships' },
  { id: 'wildlife', label: 'Wildlife' },
  { id: 'iss', label: 'ISS' },
];
// Approved spec: aviation = Planes on, maritime = Ships on, wildlife = that animal on. Everything else off.
export const DEPARTMENT_DEFAULTS = { aviation: ['planes'], maritime: ['ships'], wildlife: ['wildlife'], space: ['iss'], globe: [] };

export const BACKOFF = { first: 15000, max: 300000, rate429: 300000, minGap: 8000 };
// Wait after the n-th consecutive failure (n >= 1). HTTP 429 (rate limit / daily credit cap) rests at least 5 min.
export function backoffMs(fails, status) {
  const b = Math.min(BACKOFF.max, BACKOFF.first * 2 ** Math.max(0, fails - 1));
  return status === 429 ? Math.max(b, BACKOFF.rate429) : b;
}
const isAbort = (e) => e && (e.name === 'AbortError' || e.aborted === true);
const nmBetween = (la1, lo1, la2, lo2) => Math.hypot(la2 - la1, (lo2 - lo1) * Math.cos(la1 * Math.PI / 180)) * 60;

export class WorldLayers {
  constructor({ department = 'aviation', storage, now = () => Date.now(), makeController } = {}) {
    this.department = department; this.now = now;
    this.storage = storage !== undefined ? storage : (() => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (e) { return null; } })();
    this.makeController = makeController || (() => (typeof AbortController === 'function' ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } }));
    this.layers = new Map(); this.st = new Map(); this.listeners = new Set();
    this.on = new Set(DEPARTMENT_DEFAULTS[department] || []);
    const saved = this._load(); if (saved) this.on = new Set(saved);
  }
  _key() { return 'imhere.layers.' + this.department; }
  _load() { try { const v = this.storage && this.storage.getItem(this._key()); const a = v ? JSON.parse(v) : null; return Array.isArray(a) ? a : null; } catch (e) { return null; } }
  _save() { try { if (this.storage) this.storage.setItem(this._key(), JSON.stringify([...this.on])); } catch (e) { /* private mode */ } }
  register(layer) {
    for (const k of ['id', 'fetchNear', 'setData', 'update', 'pickables']) if (!layer || layer[k] === undefined) throw new Error('layer is missing ' + k);
    this.layers.set(layer.id, layer);
    this.st.set(layer.id, { next: 0, ctl: null, busy: false, fails: 0, lastOk: 0, lastErr: '', status: 0, lat: null, lon: null });
    if (layer.setVisible) layer.setVisible(this.on.has(layer.id));
    this._emit(); return layer;
  }
  get(id) { return this.layers.get(id) || null; }
  isOn(id) { return this.layers.has(id) && this.on.has(id); }
  // Every catalogue entry with its state: built = a layer exists for it (otherwise the menu shows it as "soon").
  list() {
    return LAYER_CATALOG.map((c) => { const L = this.layers.get(c.id), s = this.st.get(c.id);
      return { id: c.id, label: (L && L.label) || c.label, built: !!L, on: !!L && this.on.has(c.id),
        status: L && this.on.has(c.id) && L.status ? L.status(this.now()) : '', failing: !!(s && s.fails) }; });
  }
  set(id, on) {
    const L = this.layers.get(id); if (!L) return false;
    on = !!on; if (on === this.on.has(id)) return true;
    const s = this.st.get(id);
    if (on) { this.on.add(id); s.next = 0; s.fails = 0; }
    else { this.on.delete(id); if (s.ctl) { try { s.ctl.abort(); } catch (e) { /* ignore */ } } s.ctl = null; s.busy = false; }
    if (L.setVisible) L.setVisible(on);
    this._save(); this._emit(); return true;
  }
  toggle(id) { return this.set(id, !this.on.has(id)); }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { /* a listener must not break the others */ } } }

  // Call every frame with the ownship { lat, lon, altFt, ... }. Starts due fetches (one at a time per layer) and draws.
  tick(parent, own, dt, now = this.now()) {
    for (const [id, L] of this.layers) {
      if (!this.on.has(id)) continue;
      const s = this.st.get(id);
      if (!s.busy && own && Number.isFinite(own.lat) && Number.isFinite(own.lon)) {
        let due = now >= s.next;
        if (!due && L.refetchNm && s.lat !== null && !s.fails && now - s.startAt >= BACKOFF.minGap && nmBetween(s.lat, s.lon, own.lat, own.lon) > L.refetchNm) due = true;
        if (due) this._fetch(id, L, s, own, now);
      }
      L.update(parent, own, dt, now);
    }
  }
  _fetch(id, L, s, own, now) {
    const ctl = this.makeController(); s.ctl = ctl; s.busy = true; s.startAt = now; s.lat = own.lat; s.lon = own.lon;
    const every = typeof L.refreshMs === 'function' ? L.refreshMs(own) : L.refreshMs || 25000;
    s.next = now + every;
    let p; try { p = Promise.resolve(L.fetchNear(own.lat, own.lon, own.altFt, ctl.signal, own)); } catch (e) { p = Promise.reject(e); }
    return p.then((data) => {
      if (s.ctl !== ctl || !this.on.has(id)) return;   // switched off or superseded meanwhile
      s.fails = 0; s.lastErr = ''; s.status = 0; s.lastOk = this.now(); s.next = s.lastOk + every;
      L.setData(data, s.lastOk, own); this._emit();
    }, (e) => {
      if (s.ctl !== ctl || isAbort(e) || ctl.signal.aborted) return;
      s.fails++; s.lastErr = String((e && e.message) || e); s.status = (e && e.status) || 0;
      s.next = this.now() + backoffMs(s.fails, s.status);
      if (L.onError) try { L.onError(e, s.fails); } catch (e2) { /* ignore */ }
      this._emit();
    }).finally(() => { if (s.ctl === ctl) { s.busy = false; s.ctl = null; } });
  }
  state(id) { const s = this.st.get(id); return s ? { fails: s.fails, lastOk: s.lastOk, lastErr: s.lastErr, next: s.next, busy: s.busy, status: s.status } : null; }

  // Which item is the ray (origin o, unit direction d, world space) pointing at? The item with the smallest angle off the
  // ray, within maxDeg plus the item's own angular radius. -> the pickable or null. No allocations.
  pick(o, d, maxDeg = 2.5, skip = null) {
    let best = null, bestA = Infinity;
    for (const [id, L] of this.layers) {
      if (!this.on.has(id)) continue;
      const P = L.pickables();
      for (let i = 0; i < P.length; i++) {
        const p = P[i]; if (!p.active || p === skip) continue;
        const vx = p.x - o.x, vy = p.y - o.y, vz = p.z - o.z, dist = Math.sqrt(vx * vx + vy * vy + vz * vz); if (dist < 1e-6) continue;
        const c = (vx * d.x + vy * d.y + vz * d.z) / dist; if (c <= 0) continue;
        const ang = Math.acos(Math.min(1, c)) * 180 / Math.PI, allow = maxDeg + Math.atan2(p.r || 0, dist) * 180 / Math.PI;
        if (ang <= allow && ang - allow < bestA) { bestA = ang - allow; best = p; }
      }
    }
    return best;
  }
  dispose() {
    for (const [id, L] of this.layers) { const s = this.st.get(id); if (s.ctl) try { s.ctl.abort(); } catch (e) { /* ignore */ } if (L.dispose) L.dispose(); }
    this.layers.clear(); this.listeners.clear();
  }
}

// I'M HERE — Airport kit.
// Turns an airport data file (runway ends, lighting) into runways, FAA-standard markings and lights.
// generateAirport() is plain math (no 3D library) so it can be checked anywhere;
// buildAirport() turns the result into three.js objects.
//
// Frames: airport-local metres, origin at the airport reference point, y up, z = north, x = west
// (this matches the cockpit world frame: heading 0 looks along +z, heading 90 along -x).

const FT = 0.3048;
const WHITE = [1.0, 0.93, 0.8], YELLOW = [1.0, 0.75, 0.15], RED = [1.0, 0.08, 0.04],
      GREEN = [0.25, 1.0, 0.45], STROBE = [1.0, 1.0, 1.0];

export function toLocal(arp, lat, lon) {
  const p = arp[0] * Math.PI / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  const east = (lon - arp[1]) * mLon, north = (lat - arp[0]) * mLat;
  return [-east, north];
}

// ---------------------------------------------------------------------------
// Rule books (all distances in feet). FAA: AC 150/5340-1 & -30. ICAO: Annex 14 Vol I.
// ---------------------------------------------------------------------------
const M = 1 / FT;   // metres -> feet
export const RULES = {
  FAA: {
    thrStart: 20, thrLen: 150, stripeW: 5.75, stripes: (w) => (w >= 200 ? 16 : w >= 150 ? 12 : w >= 100 ? 8 : 4),
    desigGap: 20, charH: 60, charW: 20, charGap: 12, letterGap: 20, leadingZero: false,
    clLen: 120, clGap: 80, clW: 3, sideW: 3,
    aim: (lda) => (lda >= 4200 ? 1020 : lda >= 3000 ? 1000 : 0), aimLen: 150, aimW: 30, inner: 36,
    tdz: [[500, 3], [1500, 2], [2000, 2], [2500, 1], [3000, 1]], tdzLen: 75, tdzW: 6, tdzGap: 5,
    edgeStep: 200, caution: 2000, clStep: 50, clRed: 1000, clAlt: 3000, tdzLightEnd: 3000, tdzLightStep: 100, papiAt: 1000,
  },
  ICAO: {
    thrStart: 6 * M, thrLen: 30 * M, stripeW: 1.8 * M, stripes: (w) => { const m = w * FT; return m >= 60 ? 16 : m >= 45 ? 12 : m >= 30 ? 8 : m >= 23 ? 6 : 4; },
    desigGap: 12 * M, charH: 9 * M, charW: 3.6 * M, charGap: 1.8 * M, letterGap: 6 * M, leadingZero: true,
    clLen: 30 * M, clGap: 20 * M, clW: 0.9 * M, sideW: 0.9 * M,
    aim: (lda) => (lda >= 2400 * M ? 400 * M : lda >= 1200 * M ? 300 * M : lda >= 800 * M ? 250 * M : 150 * M), aimLen: 60 * M, aimW: 10 * M, inner: 10 * M,
    tdz: [[150 * M, 3], [300 * M, 3], [600 * M, 2], [750 * M, 2], [900 * M, 1], [1050 * M, 1]], tdzLen: 22.5 * M, tdzW: 3 * M, tdzGap: 1.5 * M,
    edgeStep: 60 * M, caution: 600 * M, clStep: 15 * M, clRed: 300 * M, clAlt: 900 * M, tdzLightEnd: 900 * M, tdzLightStep: 30 * M, papiAt: 400 * M,
  },
};
// Approach lighting systems: length, centreline barrette spacing, crossbars [distance, half-width],
// red side rows (to distance), sequenced flashers [from, to, step]
export const APPROACH = {
  ALSF2:     { len: 2400, step: 100, bars: [[500, 37], [1000, 50]], side: 900, flash: [1000, 2400, 100], wing: true },
  ALSF1:     { len: 2400, step: 100, bars: [[1000, 50]], side: 200, flash: [1000, 2400, 100], wing: true },
  SSALR:     { len: 1400, step: 200, bars: [[1000, 35]], flash: [1600, 2400, 200] },
  MALSR:     { len: 1400, step: 200, bars: [[1000, 35]], flash: [1600, 2400, 200] },
  MALSF:     { len: 1400, step: 200, bars: [[1000, 35]], flash: [1000, 1400, 200] },
  MALS:      { len: 1400, step: 200, bars: [[1000, 35]] },
  ODALS:     { len: 1500, step: 300, bars: [], flash: [300, 1500, 300], noSteady: true },
  CALVERT:   { len: 900 * M, step: 30 * M, bars: [[150 * M, 15 * M], [300 * M, 30 * M], [450 * M, 19 * M], [600 * M, 22.5 * M], [750 * M, 26 * M]] },
  ICAO_CAT2: { len: 900 * M, step: 30 * M, bars: [[150 * M, 15 * M], [300 * M, 30 * M], [450 * M, 19 * M], [600 * M, 22.5 * M], [750 * M, 26 * M]], side: 270 * M, wing: true },
};

export function generateAirport(data) {
  const out = { grass: [], shoulder: [], runway: [], rubber: [], markings: [], glyphs: [], lights: [], papi: [], ends: {} };
  const R = RULES[data.rules || (data.country && data.country !== 'US' ? 'ICAO' : 'FAA')];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (const rw of data.runways) {
    const [EA, EB] = rw.ends;
    const A = toLocal(data.arp, EA.lat, EA.lon), B = toLocal(data.arp, EB.lat, EB.lon);
    const Lm = Math.hypot(B[0] - A[0], B[1] - A[1]), L = Lm / FT;      // length in feet
    const W = rw.width_ft, hw = W / 2, sc = Math.min(1, W / 150);    // narrower runways: scale lateral layout
    const precision = rw.markings !== 'visual' && rw.markings !== 'nonprecision';
    for (const p of [A, B]) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }

    // runway frame for travel from end E: s along (ft), t to the pilot's right (ft)
    const frame = (O, D) => {
      const ux = (D[0] - O[0]) / Lm, uz = (D[1] - O[1]) / Lm, rx = -uz, rz = ux;
      return { O, u: [ux, uz], r: [rx, rz], pt: (s, t, y = 0) => [O[0] + (ux * s + rx * t) * FT, y, O[1] + (uz * s + rz * t) * FT] };
    };
    const fA = frame(A, B), fB = frame(B, A);
    const quad = (f, s0, s1, t0, t1, list, uvScale) => {
      const a = f.pt(s0, t0), b = f.pt(s1, t0), c = f.pt(s1, t1), d = f.pt(s0, t1);
      list.push({ v: [a, d, c, a, c, b], uv: uvScale ? [[t0, s0], [t1, s0], [t1, s1], [t0, s0], [t1, s1], [t0, s1]].map(([t, s]) => [t / uvScale, s / uvScale]) : null });
    };
    const tri = (f, p, list) => list.push({ v: p.map(([s, t]) => f.pt(s, t)), uv: null });
    const sym = (f, s0, s1, t0, w, list) => { quad(f, s0, s1, t0, t0 + w, list); quad(f, s0, s1, -t0 - w, -t0, list); };

    // surfaces (drawn once per runway)
    const shoulder = rw.shoulder_ft ?? (W >= 150 ? 25 : W >= 100 ? 10 : 0);
    if (shoulder) quad(fA, -10, L + 10, -hw - shoulder, hw + shoulder, out.shoulder);
    quad(fA, 0, L, -hw, hw, out.runway, 25);
    if (precision) sym(fA, 0, L, hw - 1 - R.sideW, R.sideW, out.markings);   // side stripes

    const both = [[EA, EB, fA], [EB, EA, fB]];
    for (const [E, F, f] of both) {
      const d = E.displaced_ft || 0, dF = F.displaced_ft || 0, lda = L - d;
      out.ends[E.id] = { O: f.O, u: f.u, r: f.r, L_ft: L, displaced_ft: d, elev_ft: E.elev_ft, width_ft: W, aim_ft: d + (R.aim(lda) || 1000) };

      // ---- markings ----
      if (d > 0) {   // displaced threshold: bar + arrows
        quad(f, d - 10, d, -hw, hw, out.markings);
        for (let s = 40; s + 165 < d - 10; s += 200) {
          quad(f, s, s + 120, -1.5, 1.5, out.markings);
          tri(f, [[s + 120, -7.5], [s + 165, 0], [s + 120, 7.5]], out.markings);
        }
        for (const t of [-0.3, -0.1, 0.1, 0.3]) tri(f, [[d - 55, t * W - 7.5], [d - 15, t * W], [d - 55, t * W + 7.5]], out.markings);
      }
      const nStr = R.stripes(W) / 2, sw = R.stripeW;
      for (let k = 0; k < nStr; k++) sym(f, d + R.thrStart, d + R.thrStart + R.thrLen, sw + k * 2 * sw, sw, out.markings);
      const n0 = parseInt(E.id, 10), num = R.leadingZero ? String(n0).padStart(2, '0') : String(n0), letter = E.id.replace(/^\d+/, '');
      let sDes = d + R.thrStart + R.thrLen + R.desigGap;
      if (letter) { out.glyphs.push({ f, s: sDes, text: letter, h: R.charH, w: R.charW, gap: R.charGap }); sDes += R.charH + R.letterGap; }
      out.glyphs.push({ f, s: sDes, text: num, h: R.charH, w: R.charW, gap: R.charGap });
      const desEnd = sDes + R.charH + 40;
      // centreline (once per runway, between the two designators)
      const desEndF = dF + R.thrStart + R.thrLen + R.desigGap + R.charH * (F.id.replace(/^\d+/, '') ? 2 : 1) + R.letterGap + 40;
      if (E === EA) for (let s = desEnd; s + R.clLen <= L - desEndF; s += R.clLen + R.clGap) quad(f, s, s + R.clLen, -R.clW / 2, R.clW / 2, out.markings);
      // aiming point + touchdown zone (precision runways)
      const aim = R.aim(lda), inner = R.inner * sc;
      if (aim) sym(f, d + aim, d + aim + R.aimLen, inner, R.aimW * sc, out.markings);
      if (precision) for (const [s, n] of R.tdz) {
        if (d + s + R.tdzLen > d + lda / 2 || Math.abs(s - aim) < 50) continue;
        for (let k = 0; k < n; k++) sym(f, d + s, d + s + R.tdzLen, inner + k * (R.tdzW + R.tdzGap) * sc, R.tdzW * sc, out.markings);
      }
      if (precision) quad(f, d + 600, d + 3000, -28 * sc, 28 * sc, out.rubber, 1);

      // ---- lights, as seen by an aircraft landing from E (fixtures face back toward E) ----
      const toward = [-f.u[0], 0, -f.u[1]];
      const L_ = (s, t, c, size, y = 0.35, flash = null, dir = toward) => out.lights.push({ p: f.pt(s, t, y), c, size, dir, flash });
      if (rw.edge_lights !== 'none') for (let s = 0; s <= L + 1; s += Math.min(R.edgeStep, L / 6)) for (const t of [-hw - 2, hw + 2]) {
        const c = s < d ? RED : (precision && s > L - R.caution) ? YELLOW : WHITE; L_(s, t, c, rw.edge_lights === 'MIRL' ? 0.4 : 0.55);
      }
      if (rw.edge_lights !== 'none') for (let t = -hw; t <= hw + 0.1; t += 10) { L_(d, t, GREEN, 0.6, 0.3); L_(L, t, RED, 0.5, 0.3); }
      if (rw.centerline_lights) for (let s = R.clStep * 1.5; s <= L - R.clStep * 1.5; s += R.clStep) {
        const rem = L - s, i = Math.round(s / R.clStep);
        L_(s, 0, rem < R.clRed ? RED : rem < R.clAlt ? (i % 2 ? RED : WHITE) : WHITE, 0.35, 0.05);
      }
      if (E.tdz) for (let s = d + R.tdzLightStep; s <= d + R.tdzLightEnd; s += R.tdzLightStep)
        for (const sg of [-1, 1]) for (const t of [36, 41, 46]) L_(s, sg * t * sc, WHITE, 0.32, 0.05);
      const sys = APPROACH[E.approach || ''];
      if (sys) {
        if (!sys.noSteady) for (let b = sys.step; b <= sys.len + 0.1; b += sys.step) for (let t = -7; t <= 7.1; t += 3.5) L_(d - b, t, WHITE, 0.7, 1.2);
        for (const [at, half] of sys.bars) for (let t = -half; t <= half + 0.1; t += 5) if (Math.abs(t) > 8) L_(d - at, t, WHITE, 0.7, 1.2);
        if (sys.side) for (let b = 100; b <= sys.side + 0.1; b += sys.step === 100 ? 100 : sys.step) for (const sg of [-1, 1]) for (const t of [36, 41, 46]) L_(d - b, sg * t * sc, RED, 0.6, 1.0);
        if (sys.wing) for (let t = -hw - 50; t <= hw + 50.1; t += 5) if (Math.abs(t) > hw) L_(d, t, GREEN, 0.6, 0.6);
        if (sys.flash) {   // the "rabbit": outermost first, twice a second
          const [f0, f1, st] = sys.flash, n = Math.round((f1 - f0) / st) + 1;
          for (let b = f1, k = 0; b >= f0 - 0.1; b -= st, k++) L_(d - b, 0, STROBE, 1.3, 1.6, [0.5, (k / n) * 0.42, 0.06]);
        }
      }
      if (E.reil) for (const sg of [-1, 1]) L_(d, sg * (hw + 40), STROBE, 1.1, 0.8, [1.0, 0, 0.05]);
      if (E.papi === 'left' || E.papi === 'right') {   // PAPI: 4 boxes, colour depends on your angle
        const sg = E.papi === 'left' ? -1 : 1, g = E.papi_angle || 3, angs = [g + 0.5, g + 0.17, g - 0.17, g - 0.5];
        for (let i = 0; i < 4; i++) {
          out.papi.push({ index: out.lights.length, ang: angs[i] });
          L_(d + (aim || R.papiAt), sg * (hw + 50 + i * 30), RED, 1.0, 0.8);
        }
      }
    }
  }
  // grass apron around everything
  const m = 600;
  const g = (x, z) => [x, 0, z];
  out.grass.push({ v: [g(minX - m, minZ - m), g(minX - m, maxZ + m), g(maxX + m, maxZ + m), g(minX - m, minZ - m), g(maxX + m, maxZ + m), g(maxX + m, minZ - m)],
                   uv: [[0, 0], [0, 1], [1, 1], [0, 0], [1, 1], [1, 0]].map(([a, b]) => [a * (maxX - minX + 2 * m) / 40, b * (maxZ - minZ + 2 * m) / 40]) });
  out.bounds = { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
  return out;
}

// ---------------------------------------------------------------------------
// three.js build
// ---------------------------------------------------------------------------
export function buildAirport(THREE, data) {
  const gen = generateAirport(data);
  const group = new THREE.Group(); group.name = data.icao;

  const geom = (list) => {
    const pos = [], uv = [], nrm = [];
    for (const q of list) { for (const v of q.v) { pos.push(...v); nrm.push(0, 1, 0); }
      if (q.uv) for (const t of q.uv) uv.push(...t); else for (let i = 0; i < q.v.length; i++) uv.push(0, 0); }
    const gm = new THREE.BufferGeometry();
    gm.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gm.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    gm.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return gm;
  };
  const canvasTex = (w, h, draw, repeat = true) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const concrete = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#a7a6a0'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) { const v = 150 + rnd() * 30 | 0; x.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(70,70,68,0.08)'; x.fillRect(0, rnd() * h, w, 1); }   // grooving texture
    x.strokeStyle = 'rgba(55,55,52,0.7)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);                       // slab joints
  });
  const grassT = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#5f7a3c'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(120,150,70,0.25)'; x.fillRect(0, 0, w / 2, h);
    for (let i = 0; i < 3000; i++) { x.fillStyle = rnd() > 0.5 ? 'rgba(40,60,25,0.25)' : 'rgba(140,160,90,0.2)'; x.fillRect(rnd() * w, rnd() * h, 2, 2); }
  });
  const rubberT = canvasTex(128, 512, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) { x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(w * (0.2 + rnd() * 0.6), rnd() * h, 2 + rnd() * 3, 30 + rnd() * 120); }
    x.globalCompositeOperation = 'destination-in'; const v = x.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.15, 'rgba(0,0,0,1)'); v.addColorStop(0.7, 'rgba(0,0,0,0.6)'); v.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = v; x.fillRect(0, 0, w, h);
  }, false);
  // flat airport layers are painted in order under everything else (no depth fighting on coplanar paint)
  const layer = (list, mat, order) => {
    Object.assign(mat, { depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geom(list), mat); m.renderOrder = order; m.frustumCulled = false; group.add(m); return m;
  };
  layer(gen.grass, new THREE.MeshLambertMaterial({ map: grassT }), -8);
  layer(gen.shoulder, new THREE.MeshLambertMaterial({ color: 0x55575a }), -7);
  layer(gen.runway, new THREE.MeshLambertMaterial({ map: concrete }), -6);
  const rub = geom(gen.rubber); { const uv = rub.attributes.uv; for (let i = 0; i < uv.count; i++) {  // per-quad 0..1 uvs
    const k = i % 6; const map = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]][k]; uv.setXY(i, map[0], map[1]); } }
  { const m = new THREE.Mesh(rub, new THREE.MeshLambertMaterial({ map: rubberT, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    m.renderOrder = -5; m.frustumCulled = false; group.add(m); }
  layer(gen.markings, new THREE.MeshLambertMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide }), -4);

  // runway designators from a glyph atlas (60 ft tall characters)
  const chars = '0123456789LCR', cw = 64, ch = 192;
  const atlas = canvasTex(cw * chars.length, ch, (x) => {
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    [...chars].forEach((c, i) => { x.save(); x.translate(i * cw + cw / 2, ch / 2); x.scale(0.62, 1.55);
      x.font = 'bold 120px "Arial Narrow", Arial, sans-serif'; x.fillText(c, 0, 6); x.restore(); });
  }, false);
  const gp = [], guv = [], gn = [];
  for (const g of gen.glyphs) {
    const n = g.text.length, w = g.w, gap = g.gap, total = n * w + (n - 1) * gap;
    [...g.text].forEach((c, i) => {
      const t0 = -total / 2 + i * (w + gap), t1 = t0 + w, s0 = g.s, s1 = g.s + g.h, ci = chars.indexOf(c);
      const u0 = ci / chars.length, u1 = (ci + 1) / chars.length;
      const P = (s, t) => g.f.pt(s, t);
      for (const [s, t, u, v] of [[s0, t0, u0, 0], [s1, t0, u0, 1], [s1, t1, u1, 1], [s0, t0, u0, 0], [s1, t1, u1, 1], [s0, t1, u1, 0]]) {
        gp.push(...P(s, t)); guv.push(u, v); gn.push(0, 1, 0); }
    });
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
  gg.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
  { const m = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    m.renderOrder = -3; m.frustumCulled = false; group.add(m); }

  // lights: one draw call, sized in metres but never smaller than a visible point
  const N = gen.lights.length;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), dir = new Float32Array(N * 3), flash = new Float32Array(N * 3);
  gen.lights.forEach((l, i) => { pos.set(l.p, i * 3); col.set(l.c, i * 3); size[i] = l.size; dir.set(l.dir || [0, 0, 0], i * 3); if (l.flash) flash.set(l.flash, i * 3); });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); lg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  lg.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); lg.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  lg.setAttribute('aFlash', new THREE.BufferAttribute(flash, 3));
  const uniforms = { uScale: { value: 500 }, uIntensity: { value: 1 }, uTime: { value: 0 } };
  const lights = new THREE.Points(lg, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aSize; attribute vec3 aDir; attribute vec3 aFlash;
      uniform float uScale, uIntensity, uTime; varying vec3 vColor;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0); vec4 mv = viewMatrix * wp; float dist = max(-mv.z, 0.1);
        float vis = 1.0;
        if (dot(aDir, aDir) > 0.0) { vec3 dw = normalize(mat3(modelMatrix) * aDir); vis = smoothstep(-0.05, 0.35, dot(dw, normalize(cameraPosition - wp.xyz))); }
        float on = 1.0; if (aFlash.x > 0.0) on = step(fract((uTime - aFlash.y) / aFlash.x), aFlash.z) * 2.5;
        float atten = clamp(1.6 - dist / 12000.0, 0.35, 1.0);
        vColor = aColor * vis * on * uIntensity * atten;
        gl_PointSize = (vis * on < 0.01 || mv.z > 0.0) ? 0.0 : clamp(aSize * projectionMatrix[1][1] * uScale / dist, 2.0, 40.0);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vColor;
      void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard;
        gl_FragColor = vec4(vColor * (exp(-d * 6.0) * 1.4 + 0.15 * (1.0 - d)), 1.0); }`,
  }));
  lights.renderOrder = -2; lights.frustumCulled = false; group.add(lights);

  const camLocal = new THREE.Vector3();
  function update(time, camera, renderer, intensity) {
    uniforms.uTime.value = time; uniforms.uIntensity.value = intensity;
    uniforms.uScale.value = renderer.xr.isPresenting ? 900 : renderer.domElement.height * 0.5;
    // PAPI: white if you are above that box's angle, red if below
    camera.getWorldPosition(camLocal); group.worldToLocal(camLocal);
    for (const p of gen.papi) {
      const i = p.index * 3, dx = camLocal.x - pos[i], dz = camLocal.z - pos[i + 2], dy = camLocal.y - pos[i + 1];
      const a = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI, w = a > p.ang ? 1 : 0;
      col[i] = 1; col[i + 1] = w ? 0.93 : 0.08; col[i + 2] = w ? 0.8 : 0.04;
    }
    lg.attributes.aColor.needsUpdate = true;
  }
  return { group, update, ends: gen.ends, data };
}

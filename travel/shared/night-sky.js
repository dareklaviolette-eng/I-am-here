// I'M HERE Travel Desk · the rendered night sky for night stops: stars, and (when the park asks: { aurora: true }) a faint
// aurora australis low over the southern horizon. Everything here is drawn by I'M HERE (the page labels it in Details); the
// real southern lights show only on nights of strong geomagnetic activity.
// createNightSky(THREE, { aurora }) -> { group, set(night 0..1, seconds) }
//   group  in the scene; the page keeps it on the eye (position) and in the local horizon (quaternion), like the sky dome.
//          Local frame: x = west, y = up, z = north (so south is -z).
// Light: ~1,800 star points and one 96 x 6 strip; additive, no depth writes, hidden entirely by day.
export function createNightSky(THREE, { aurora = false, stars = 1800, seed = 7 } = {}) {
  const group = new THREE.Group(); group.name = 'night-sky'; group.visible = false;
  let r = seed >>> 0; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  // stars: a random sky with a denser band (a hint of the Milky Way) tilted across it; brightness and colour vary a little
  const R = 240000, pos = new Float32Array(stars * 3), col = new Float32Array(stars * 3);
  const band = new THREE.Vector3(0.35, 0.25, -0.9).normalize();   // the band's pole (any tilt reads well)
  for (let i = 0; i < stars; i++) {
    const v = new THREE.Vector3();
    for (let k = 0; k < 200; k++) {   // uniform on the sphere (rejection), above the horizon; every third star keeps to the band
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); const L = v.length(); if (L < 0.05 || L > 1) continue; v.divideScalar(L);
      if (v.y < -0.02) v.y = -v.y;
      if (i % 3 === 0 && Math.abs(v.dot(band)) > 0.18) continue;
      break;
    }
    pos[i * 3] = v.x * R; pos[i * 3 + 1] = v.y * R; pos[i * 3 + 2] = v.z * R;
    const b = 0.35 + Math.pow(rnd(), 3) * 0.65, warm = rnd();
    col[i * 3] = b * (warm > 0.8 ? 1 : 0.85); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (warm < 0.25 ? 1 : 0.92);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sm = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const starPts = new THREE.Points(sg, sm); starPts.frustumCulled = false; starPts.renderOrder = -900; group.add(starPts);

  // aurora australis: a curtain 200 km away from south-east to south-west, from ~1 deg to ~13 deg above the horizon.
  // Green low down, fading to a faint red-magenta at the top, with slowly drifting vertical rays.
  let aur = null;
  if (aurora) {
    const N = 96, M = 6, D = 200000, y0 = 3500, y1 = 47000, a0 = 130, a1 = 230, p = [], uv = [], idx = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) {
      const az = (a0 + (a1 - a0) * i / N) * Math.PI / 180, v = j / M, wob = Math.sin(i * 0.21) * 9000 + Math.sin(i * 0.07 + 1.3) * 14000;
      p.push(-Math.sin(az) * (D + wob), y0 + (y1 - y0) * v, Math.cos(az) * (D + wob)); uv.push(i / N, v);
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { t: { value: 0 }, a: { value: 0 } },
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float t, a; varying vec2 vU;\n' +
        'float h(float x){ return fract(sin(x * 127.1) * 43758.5453); }\n' +
        'float n(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }\n' +
        'void main(){ float x = vU.x * 46.0 + t * 0.05, rays = 0.45 + 0.55 * n(x) * n(x * 2.7 + 5.0 + t * 0.03);\n' +
        '  float v = vU.y, base = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.35, 1.0, v));\n' +
        '  float edge = smoothstep(0.0, 0.18, vU.x) * (1.0 - smoothstep(0.82, 1.0, vU.x)) * (0.65 + 0.35 * n(vU.x * 6.0 + t * 0.02));\n' +
        '  vec3 green = vec3(0.25, 1.0, 0.55), red = vec3(0.85, 0.25, 0.6); vec3 c = mix(green, red, smoothstep(0.25, 0.85, v));\n' +
        '  gl_FragColor = vec4(c * rays * base * edge * a, 1.0); }',
    });
    aur = new THREE.Mesh(g, m); aur.frustumCulled = false; aur.renderOrder = -890; group.add(aur);
  }
  return {
    group,
    set(night, sec = 0) {
      const on = night > 0.02; group.visible = on; if (!on) return;
      sm.opacity = Math.min(1, night * 1.1);
      if (aur) { aur.material.uniforms.a.value = 0.55 * night; aur.material.uniforms.t.value = sec; }
    },
  };
}

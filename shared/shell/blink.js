// The blink (every POV change and jump) and the arrival moment (jumps): fade to black, stars stretch past you
// (Aurora-style, 1-3 s, covering the loading), then the new world fades in. Plain fade at lower quality
// (xr-safety level >= 1) or when the system asks for reduced motion.
// Works the same in VR (a black sphere and the star tunnel around your head, in the rig) and on screens (the same 3D
// tunnel in front of the camera, plus a DOM fade for the page).
//
// const b = createBlink({ THREE, rig, camera }); scene loop: b.update(dt)  (no allocations)
//   await b.out(sec)        fade to black          await b.in(sec)   fade back in
//   b.arrive(title, on)     the star tunnel on / off (only shown when b.fancy)       b.progress(text)
//   b.fancy = false         plain fade only (the shell sets it from the quality level)
export function createBlink({ THREE, rig, camera }) {
  // black sphere around the head (VR) and a DOM veil (screens)
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  sphere.name = 'shell-blink'; sphere.renderOrder = 99990; sphere.frustumCulled = false; sphere.visible = false; rig.add(sphere);
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:2500;display:flex;align-items:flex-end;justify-content:center';
  const vtxt = document.createElement('div'); vtxt.style.cssText = 'margin-bottom:12vh;font:600 15px ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#9fe8ff;opacity:.9;text-transform:uppercase';
  veil.appendChild(vtxt); document.body.appendChild(veil);
  // the star tunnel: N streaks on a cylinder around the travel axis, rushing past (head and tail per streak)
  const N = 700, pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 4);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.2 + Math.pow(Math.random(), 0.6) * 9, z = Math.random(), sp = 0.6 + Math.random() * 0.8, hue = Math.random();
    for (let k = 0; k < 2; k++) { const j = i * 2 + k; pos[j * 3] = Math.cos(a) * r; pos[j * 3 + 1] = Math.sin(a) * r; pos[j * 3 + 2] = k; seed[j * 4] = z; seed[j * 4 + 1] = sp; seed[j * 4 + 2] = hue; seed[j * 4 + 3] = k; }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const uni = { uT: { value: 0 }, uStretch: { value: 0 }, uAlpha: { value: 0 } };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    vertexShader: `attribute vec4 seed; uniform float uT, uStretch; varying float vA; varying vec3 vC;
      void main(){ float L = 90.0; float z = -L + mod(seed.x * L + uT * seed.y * 60.0 * (0.25 + uStretch), L);
        float len = 0.05 + uStretch * 9.0 * seed.y; float zz = z - seed.w * len;
        vA = smoothstep(-L, -L * 0.6, z) * (1.0 - smoothstep(-3.0, 0.0, z));
        vC = mix(vec3(0.65, 0.85, 1.0), vec3(1.0, 0.95, 0.85), seed.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, zz, 1.0); }`,
    fragmentShader: 'uniform float uAlpha; varying float vA; varying vec3 vC; void main(){ gl_FragColor = vec4(vC, vA * uAlpha); }',
  });
  const tunnel = new THREE.LineSegments(geo, lineMat); tunnel.name = 'shell-arrival'; tunnel.frustumCulled = false; tunnel.renderOrder = 99995; tunnel.visible = false; rig.add(tunnel);
  // a glow ahead (where you are going)
  const gc = document.createElement('canvas'); gc.width = gc.height = 128; const gg = gc.getContext('2d');
  const gr = gg.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(160,220,255,0.6)'); gr.addColorStop(1, 'rgba(60,120,255,0)');
  gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(gc);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false, toneMapped: false }));
  glow.position.z = -60; glow.renderOrder = 99994; tunnel.add(glow);
  // the arrival caption (VR): "ARRIVING · SYDNEY HARBOUR"
  const cc = document.createElement('canvas'); cc.width = 1024; cc.height = 96; const cg = cc.getContext('2d');
  const capTex = new THREE.CanvasTexture(cc); capTex.colorSpace = THREE.SRGBColorSpace;
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.15), new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0, fog: false, toneMapped: false }));
  cap.position.set(0, -0.35, -2.4); cap.renderOrder = 99996; tunnel.add(cap);

  const b = { fancy: true, alpha: 0, target: 0, rate: 4, stretch: 0, on: false, resolve: null, t: 0, capText: '' };
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  function drawCap(t) {
    if (t === b.capText) return; b.capText = t;
    cg.clearRect(0, 0, 1024, 96); cg.font = '600 40px ui-monospace,Menlo,monospace'; cg.textAlign = 'center'; cg.textBaseline = 'middle';
    cg.fillStyle = 'rgba(159,232,255,0.95)'; if ('letterSpacing' in cg) cg.letterSpacing = '8px'; cg.fillText(String(t).toUpperCase(), 512, 50); capTex.needsUpdate = true;
    vtxt.textContent = t;
  }
  function fade(to, sec) {
    return new Promise((res) => { if (b.resolve) b.resolve(); b.target = to; b.rate = 1 / Math.max(0.05, sec); b.resolve = res; if (Math.abs(b.alpha - to) < 1e-3) { b.alpha = to; const r = b.resolve; b.resolve = null; apply(); r(); } });
  }
  function apply() {
    sphere.visible = b.alpha > 0.001; sphere.material.opacity = b.alpha;
    veil.style.opacity = String(b.alpha); veil.style.pointerEvents = b.alpha > 0.5 ? 'auto' : 'none';
  }
  return {
    get busy() { return b.alpha > 0.001 || !!b.resolve; },
    get fancy() { return b.fancy; }, set fancy(v) { b.fancy = !!v; },
    out: (sec = 0.25) => fade(1, sec),
    in: (sec = 0.45) => fade(0, sec),
    arrive(title, on = true) {
      b.on = on && b.fancy;
      if (on) {
        drawCap(title ? 'Arriving · ' + title : 'Arriving');
        // the tunnel points where you look now (then stays: it does not follow the head)
        tunnel.position.copy(camera.position); e.setFromQuaternion(camera.quaternion, 'YXZ'); tunnel.rotation.set(0, e.y, 0, 'YXZ');
        b.t = 0; b.stretch = 0;
      }
      vtxt.style.visibility = on && !b.on ? 'visible' : 'hidden';   // the tunnel carries its own caption
      // screens: with the tunnel on, the page's black comes from the 3D sphere (the tunnel draws over it); the DOM veil
      // only hides the page's controls. Plain fade: the veil is black.
      veil.style.background = b.on ? 'transparent' : '#000';
      document.body.classList.toggle('xr-arriving', !!b.on);
    },
    progress(t) { drawCap(t); },
    update(dt) {
      if (b.alpha !== b.target) {
        const s = b.rate * dt; b.alpha = b.target > b.alpha ? Math.min(b.target, b.alpha + s) : Math.max(b.target, b.alpha - s);
        apply(); if (b.alpha === b.target && b.resolve) { const r = b.resolve; b.resolve = null; r(); }
      }
      sphere.position.copy(camera.position);
      // tunnel: in while on, out when off (faster)
      const want = b.on ? 1 : 0; b.stretch += (want - b.stretch) * Math.min(1, dt * (b.on ? 1.6 : 4));
      const vis = b.stretch > 0.01 && b.fancy;
      tunnel.visible = vis;
      if (vis) { b.t += dt; uni.uT.value = b.t; uni.uStretch.value = b.stretch; uni.uAlpha.value = Math.min(1, b.stretch * 1.4); glow.material.opacity = b.stretch * 0.8; cap.material.opacity = b.stretch; tunnel.position.copy(camera.position); }
    },
    dispose() {
      [sphere, tunnel, glow, cap].forEach((m) => { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); });
      glowTex.dispose(); capTex.dispose(); veil.remove();
    },
  };
}

// Be There reveal images: a real photo only where we already hold a licence for it; otherwise our own 3D hero render of the
// model, drawn once into a render target, nicely lit, and read back into a 2D canvas the EFB can show (VR and screens).
// renderHero(THREE, renderer, object, { w, h, yaw }) -> canvas. Called between frames (never inside the XR frame's own
// render): the shell queues it and runs it at the start of the next frame.
export function renderHero(THREE, renderer, object, { w = 720, h = 480, yaw = -0.75, pitch = 0.22 } = {}) {
  const scene = new THREE.Scene();
  // studio: a soft sky / sea gradient behind, a key light, a cool rim and a warm fill
  const bgc = document.createElement('canvas'); bgc.width = 4; bgc.height = 256; const bg = bgc.getContext('2d');
  const gr = bg.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2c5b8a'); gr.addColorStop(0.62, '#9cc4e4'); gr.addColorStop(0.63, '#1d4d6e'); gr.addColorStop(1, '#0a2236');
  bg.fillStyle = gr; bg.fillRect(0, 0, 4, 256);
  const bgTex = new THREE.CanvasTexture(bgc); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x2a3a44, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.8); key.position.set(-3, 4, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 1.6); rim.position.set(4, 2, -4); scene.add(rim);
  const pivot = new THREE.Group(); pivot.add(object); scene.add(pivot);
  // frame it: fit the bounding sphere, three-quarter view from the bow side
  pivot.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object), sph = box.getBoundingSphere(new THREE.Sphere());
  object.position.sub(sph.center);
  const cam = new THREE.PerspectiveCamera(30, w / h, Math.max(0.01, sph.radius / 100), sph.radius * 20);
  // distance: start from the sphere, then fit the box's eight corners to ~90% of the frame (long hulls fill the picture)
  let dist = sph.radius / Math.sin(cam.fov * Math.PI / 360);
  const lo = box.min.clone().sub(sph.center), hi = box.max.clone().sub(sph.center), v = new THREE.Vector3();
  for (let it = 0; it < 3; it++) {
    cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    let ext = 0;
    for (let k = 0; k < 8; k++) { v.set(k & 1 ? hi.x : lo.x, k & 2 ? hi.y : lo.y, k & 4 ? hi.z : lo.z).project(cam); ext = Math.max(ext, Math.abs(v.x), Math.abs(v.y)); }
    if (ext > 0) dist *= ext / 0.9;
  }
  cam.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist); cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const prevTarget = renderer.getRenderTarget(), xrOn = renderer.xr.enabled, prevTM = renderer.toneMapping;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  try {
    renderer.xr.enabled = false; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);   // WebGL rows are bottom-up
    out.getContext('2d').putImageData(img, 0, 0);
  } finally {
    renderer.setRenderTarget(prevTarget); renderer.xr.enabled = xrOn; renderer.toneMapping = prevTM;
    rt.dispose(); bgTex.dispose(); pivot.remove(object); object.position.add(sph.center);
  }
  return out;
}

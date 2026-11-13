// PLACEHOLDER for the I'M HERE craft XR Aurora (Omni-class flagship, REG IH-0000). To be swapped for shared/aurora/ when it
// lands: the tour only uses this small interface.
//   createAuroraFrame(THREE) -> { group, setShown(bool), place(x, y, z, heading, vr), welcome(host?, today?), NAME, REG }
//     group     add once to the scene (screens) or the rig (VR); place() moves it with the viewpoint every frame
//     setShown  the Observation deck shows it; Be There and God's eye hide it
//     place     screens: the eye at (x, y, z), facing heading (rad, 0 = north, + = east); the frame turns with the yaw only
//               VR: (x, y, z) is the rig floor (the user's own head moves inside); the deck floor sits at the rig floor
// What it draws (very light: ~1,500 triangles, no transparency over the whole view, no textures): the glass dome's rim
// overhead, the deck's floor edge below, and a few slim ribs to the sides and behind (never in front of you).
export const NAME = 'XR Aurora', REG = 'IH-0000';
export function createAuroraFrame(THREE) {
  const group = new THREE.Group(); group.name = 'aurora-placeholder';
  const inner = new THREE.Group(); group.add(inner);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xbfe9f5, transparent: true, opacity: 0.3, fog: false, toneMapped: false, depthWrite: false });
  const ribMat = new THREE.MeshBasicMaterial({ color: 0x9fc6d6, transparent: true, opacity: 0.22, fog: false, toneMapped: false, depthWrite: false });
  const deckMat = new THREE.MeshBasicMaterial({ color: 0x0b1424, transparent: true, opacity: 0.82, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x6edceb, transparent: true, opacity: 0.4, fog: false, toneMapped: false, depthWrite: false });
  const EYE = 1.1, R_RIM = 2.8, R_DECK = 2.4;   // eye 1.1 m above the deck (seated); the rim ~21 deg up, the deck edge ~25 deg down
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R_RIM, 0.016, 6, 96), rimMat); rim.rotation.x = Math.PI / 2; rim.position.y = EYE; inner.add(rim);
  const rim2 = new THREE.Mesh(new THREE.TorusGeometry(R_RIM * 0.62, 0.02, 5, 56), ribMat); rim2.rotation.x = Math.PI / 2; rim2.position.y = EYE + 1.15; inner.add(rim2);
  const deck = new THREE.Mesh(new THREE.RingGeometry(R_DECK - 0.5, R_DECK, 72, 1), deckMat); deck.rotation.x = -Math.PI / 2; deck.position.y = -EYE; inner.add(deck);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R_DECK - 0.5, 48), new THREE.MeshBasicMaterial({ color: 0x0a1220, transparent: true, opacity: 0.55, fog: false, toneMapped: false, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -EYE + 0.002; inner.add(floor);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R_DECK, 0.01, 5, 96), edgeMat); edge.rotation.x = Math.PI / 2; edge.position.y = -EYE + 0.01; inner.add(edge);
  // ribs: from the deck edge up to the rim and over toward the crown, at the sides and behind only
  for (const deg of [70, 115, 160, 200, 245, 290]) {
    const a = deg * Math.PI / 180, pts = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10, r = R_DECK + (R_RIM - R_DECK) * Math.min(1, u * 1.6) - (u > 0.62 ? (u - 0.62) * 2.8 : 0), y = -EYE + u * (2 * EYE + 1.15);
      pts.push(new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r)); }
    const rib = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 5, false), ribMat); inner.add(rib);
  }
  group.traverse((o) => { if (o.isMesh) { o.renderOrder = 50; o.frustumCulled = false; } });
  let shown = true;
  return {
    group, NAME, REG,
    setShown(on) { shown = !!on; group.visible = shown; },
    shown: () => shown,
    place(x, y, z, heading, vr) {
      group.position.set(x, y + (vr ? EYE : 0), z);
      group.rotation.set(0, Math.PI - heading, 0);   // local -z (the front) -> the heading (world: north = +z, east = -x)
    },
    // "Welcome aboard XR Aurora" on screens (a toast that fades); VR shows it as the entry hint
    welcome(host = document.body, today = 'Yosemite National Park') {
      const d = document.createElement('div'); d.id = 'auroraWelcome'; d.setAttribute('role', 'status');
      d.innerHTML = '<div class="aw-k">I\'M HERE · OMNI-CLASS · ' + REG + '</div><div class="aw-t">Welcome aboard ' + NAME + '</div><div class="aw-s"></div>';
      d.querySelector('.aw-s').textContent = 'Today: ' + today;
      host.appendChild(d); requestAnimationFrame(() => d.classList.add('on'));
      setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 1200); }, 4200);
      return d;
    },
  };
}

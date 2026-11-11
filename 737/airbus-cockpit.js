// I'M HERE 737 page: which flight deck you sit in. A320-family flights (A318/A319/A320/A321 and the neos) get the Airbus
// cockpit; everything else keeps the 737-800 shell. ?cockpit=airbus (or ?cockpit=737) forces one for testing.
//
// Model: "Airbus Cockpit Interior" by davidolaleye1, CC-BY-4.0
//   https://sketchfab.com/3d-models/airbus-cockpit-interior-06ca045e131b4cfdac76ddbd55ed3b4a
// Optimized for Quest into ./models/airbus/airbus-cockpit.glb (WebP textures, no normal maps, no window glass).
// GLB frame: metres, +y up, +z toward the nose, +x toward the captain (left) side, x = 0 on the centreline.
//
// The page keeps working in the 737 shell's own model units (aircraft group scaled by S). This module puts the Airbus
// model in the same group so its captain's eye lands at the 737 captain's eye height (so the page's ground/eye maths stay
// valid), and moves the live display units, the EFB tablets, the seats and the dome light onto the Airbus panel.

export const A320_FAMILY = /^(A318|A319|A320|A321|A19N|A20N|A21N)$/i;
const NAMES = { A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo' };
export const isAirbusType = (t) => A320_FAMILY.test(String(t || '').trim());
export const airbusName = (t) => NAMES[String(t || '').trim().toUpperCase()] || '';
export const AIRBUS_URL = 'https://sketchfab.com/3d-models/airbus-cockpit-interior-06ca045e131b4cfdac76ddbd55ed3b4a';
export const AIRBUS_CREDIT = '"Airbus Cockpit Interior" by davidolaleye1 (Sketchfab), CC-BY-4.0';

// Measured from the GLB (metres). Eye points: seated, head just ahead of the seat back, ~0.75 m above the cushion.
const A = {
  captain:  { eye: [ 0.71, 1.57, 3.22], at: [ 0.71, 1.36, 5.56] },
  fo:       { eye: [-0.71, 1.57, 3.22], at: [-0.71, 1.36, 5.56] },
  jump:     { eye: [ 0.00, 1.62, 1.90], at: [ 0.00, 1.05, 4.00] },
  overhead: { eye: [ 0.66, 1.53, 3.20], at: [ 0.25, 2.45, 3.70] },
  dome: [0, 2.3, 2.9],
  // the six display units: centre, unit normal toward the pilots, "up" along the glass, glass height (m)
  screens: {
    cptPFD: { c: [ 0.9585, 1.0618, 4.0563], n: [-0.302, 0, -0.953], up: [0, 1, 0], h: 0.259, w: 0.380 },
    cptND:  { c: [ 0.5496, 1.0633, 4.1191], n: [0, 0, -1],          up: [0, 1, 0], h: 0.259, w: 0.380 },
    upper:  { c: [ 0.0005, 1.0633, 4.1191], n: [0, 0, -1],          up: [0, 1, 0], h: 0.259, w: 0.380 },
    foND:   { c: [-0.5495, 1.0633, 4.1191], n: [0, 0, -1],          up: [0, 1, 0], h: 0.259, w: 0.380 },
    foPFD:  { c: [-0.9572, 1.0635, 4.0568], n: [ 0.302, 0, -0.953], up: [0, 1, 0], h: 0.259, w: 0.380 },
    lower:  { c: [ 0.0005, 0.8317, 3.9880], n: [0, 0.852, -0.523],  up: [0, 0.523, 0.852], h: 0.259, w: 0.380 },
  },
  efb: { captain: [1.27, 1.22, 3.42], fo: [-1.27, 1.22, 3.42] },
};

// opts: { THREE, GLTFLoader, aircraft, S, SEATS, displays, mounts, url, onChange(kind) }
export function createCockpitSwitch(o) {
  const { THREE, aircraft, S, SEATS, displays, mounts } = o;
  const forced = String(o.force || '').toLowerCase();
  const FORCE = /^(airbus|a32\d|a3xx)$/.test(forced) ? 'airbus' : /^(737|b737|boeing)$/.test(forced) ? 'b737' : null;
  // originals, to put the 737 back exactly as it was
  const orig = {
    seats: Object.fromEntries(['captain', 'fo', 'jump', 'overhead'].map((k) => [k, { eye: [...SEATS[k].eye], at: [...SEATS[k].at] }])),
    disp: displays.map((d) => ({ p: d.mesh.position.clone(), q: d.mesh.quaternion.clone(), s: d.mesh.scale.clone() })),
    efb: (mounts || []).map((m) => ({ p: m.grp.position.clone(), q: m.grp.quaternion.clone() })),
  };
  // Airbus metres -> aircraft-group units: captain eye on the 737 captain eye height and fore/aft spot, centreline kept
  const ce = A.captain.eye, k0 = orig.seats.captain.eye;
  const OFF = [0, k0[1] - ce[1] / S, k0[2] - ce[2] / S];
  const mu = (a) => [OFF[0] + a[0] / S, OFF[1] + a[1] / S, OFF[2] + a[2] / S];
  let kind = 'b737', want = FORCE || 'b737', root = null, loading = null, shell737 = null, failed = false, seatKey = 'captain';

  function load() {
    if (root || loading) return loading;
    loading = new Promise((resolve) => {
      new o.GLTFLoader().load(o.url || './models/airbus/airbus-cockpit.glb', (gltf) => {
        root = gltf.scene; root.name = 'cockpitAirbus';
        root.traverse((m) => {
          if (!m.isMesh) return;
          const s = m.material;   // Lambert like the 737 shell: cheap on Quest, the textures carry the detail
          m.material = new THREE.MeshLambertMaterial({ map: s.map, emissiveMap: s.emissiveMap || null, emissive: s.emissiveMap ? 0xffffff : 0x000000,
            side: THREE.DoubleSide, name: s.name });
          s.dispose();
        });
        // black glass behind each live display (hides the model's placeholder screens)
        const glass = new THREE.MeshBasicMaterial({ color: 0x050607, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        for (const sc of Object.values(A.screens)) {
          const g = new THREE.Mesh(new THREE.PlaneGeometry(sc.w * 1.01, sc.h * 1.01), glass);
          g.quaternion.copy(screenQuat(sc)); g.position.set(...sc.c).addScaledVector(new THREE.Vector3(...sc.n), 0.0015);
          root.add(g);
        }
        root.scale.setScalar(1 / S); root.position.set(...OFF); root.visible = false;
        aircraft.add(root); aircraft.updateMatrixWorld(true);
        root.traverse((m) => { m.updateMatrix(); m.matrixAutoUpdate = false; });
        root.matrixAutoUpdate = true;
        resolve(true);
      }, undefined, (err) => { failed = true; console.warn('[cockpit] Airbus model failed to load; keeping the 737', err); resolve(false); });
    });
    return loading;
  }
  function screenQuat(sc) {
    const z = new THREE.Vector3(...sc.n).normalize(), y = new THREE.Vector3(...sc.up);
    y.addScaledVector(z, -y.dot(z)).normalize(); const x = new THREE.Vector3().crossVectors(y, z);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  function apply(k) {
    const ab = k === 'airbus';
    kind = k;
    if (shell737) shell737.visible = !ab;
    if (root) root.visible = ab && !(SEATS[seatKey] && SEATS[seatKey].orbit);
    for (const key of ['captain', 'fo', 'jump', 'overhead']) {
      const s = ab ? { eye: mu(A[key].eye), at: mu(A[key].at) } : orig.seats[key];
      SEATS[key].eye = [...s.eye]; SEATS[key].at = [...s.at];
    }
    displays.forEach((d, i) => {
      const sc = A.screens[d.id];
      if (!ab || !sc) { d.mesh.position.copy(orig.disp[i].p); d.mesh.quaternion.copy(orig.disp[i].q); d.mesh.scale.copy(orig.disp[i].s); return; }
      const side = sc.h * 0.96 / S;   // square unit centred on the (wider) glass
      const geo = d.mesh.geometry.parameters;
      d.mesh.scale.set(side / geo.width, side / geo.height, 1);
      d.mesh.quaternion.copy(screenQuat(sc));
      d.mesh.position.set(...mu(sc.c)).addScaledVector(new THREE.Vector3(...sc.n), 0.003 / S);
    });
    (mounts || []).forEach((m, i) => {
      if (!ab) { m.grp.position.copy(orig.efb[i].p); m.grp.quaternion.copy(orig.efb[i].q); return; }
      m.grp.position.set(...mu(A.efb[m.side] || A.efb.captain));
      aircraft.updateMatrixWorld(true);
      m.grp.lookAt(aircraft.localToWorld(new THREE.Vector3(...SEATS[m.side === 'fo' ? 'fo' : 'captain'].eye)));
    });
    aircraft.updateMatrixWorld(true);
    if (o.onChange) o.onChange(k);
  }
  async function set(k) {
    want = FORCE || k;
    if (want === kind) return kind;
    if (want === 'airbus') { const ok = await load(); if (!ok || want !== 'airbus') return kind; }
    apply(want); return kind;
  }
  const api = {
    get kind() { return kind; },
    get forced() { return FORCE; },
    get failed() { return failed; },
    isAirbus: () => kind === 'airbus',
    has: (type) => isAirbusType(type),
    // the 737 shell arrives asynchronously: hide it straight away if the Airbus is already showing
    attach737(shell) { shell737 = shell; shell.visible = kind !== 'airbus'; },
    // pick the cockpit for an ICAO type designator (null / unknown -> 737)
    forType(type) { return set(isAirbusType(type) ? 'airbus' : 'b737'); },
    // called from setSeat: hide the Airbus interior in the outside (chase) view; it is wider than the 737 exterior
    onSeat(k) { seatKey = k; if (root) root.visible = kind === 'airbus' && !(SEATS[k] && SEATS[k].orbit); },
    domeAt: () => (kind === 'airbus' ? mu(A.dome) : [0, 2.6, 0.9]),
    ready: () => (FORCE === 'airbus' ? set('airbus') : Promise.resolve(kind)),
  };
  if (FORCE === 'airbus') set('airbus');
  return api;
}

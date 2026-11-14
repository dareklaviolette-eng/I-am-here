// Adapter: a Travel Desk tour module (travel/<park>/tour.js: STOPS with cam / look, stopPose, makeLeg, legPose, toLocal,
// FRAME, CURVED, PARK) -> the WORLD interface of shared/aurora/aurora.js. Returns null when the module does not offer those
// pieces. Every park works: Yosemite (one horizon) and the curved tours (the Swiss Alps, New Zealand), where headings are
// taken in the LOCAL horizon at each point. For those the pose carries basis { w, u, n } (unit world vectors pointing west,
// up and north at the craft), which Aurora uses to sit the craft level there (the same basis tour-page.js turns its rig with).
// update(dt) allocates nothing: the basis is worked out with scalar maths into preallocated arrays.
const D2R = Math.PI / 180;
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);

// The local horizon at a world point, written into B = { w, u, n } (no allocations). F: the tour's FRAME (column-major 4x4,
// ECEF -> world). Matches tour-core.js basisAt (geodetic latitude / longitude of the point) to well under a millidegree.
export function basisInto(F, x, y, z, B) {
  // world -> ECEF: e = R^T (p - t)
  const px = x - F[12], py = y - F[13], pz = z - F[14];
  const ex = F[0] * px + F[1] * py + F[2] * pz, ey = F[4] * px + F[5] * py + F[6] * pz, ez = F[8] * px + F[9] * py + F[10] * pz;
  const lon = Math.atan2(ey, ex), p = Math.hypot(ex, ey);
  let lat = Math.atan2(ez, p * (1 - WGS_E2));
  for (let i = 0; i < 3; i++) {
    const s = Math.sin(lat), N = WGS_A / Math.sqrt(1 - WGS_E2 * s * s), h = p / Math.max(1e-9, Math.cos(lat)) - N;
    lat = Math.atan2(ez, p * (1 - WGS_E2 * N / (N + h)));
  }
  const sa = Math.sin(lat), ca = Math.cos(lat), sl = Math.sin(lon), cl = Math.cos(lon);
  rot(F, sl, -cl, 0, B.w); rot(F, ca * cl, ca * sl, sa, B.u); rot(F, -sa * cl, -sa * sl, ca, B.n);
  return B;
}
function rot(F, a, b, c, o) { o[0] = F[0] * a + F[4] * b + F[8] * c; o[1] = F[1] * a + F[5] * b + F[9] * c; o[2] = F[2] * a + F[6] * b + F[10] * c; }

export function worldFromTour(m, { name = 'Yosemite', origin } = {}) {
  if (!m || !Array.isArray(m.STOPS) || !m.stopPose || !m.makeLeg || !m.legPose || !m.toLocal) return null;
  const curved = !!m.CURVED && Array.isArray(m.FRAME) && m.FRAME.length === 16;
  const poses = m.STOPS.map((s) => m.stopPose(s));
  const stops = m.STOPS.map((s, i) => ({ id: s.id, name: s.name, lat: s.cam[0], lon: s.cam[1], alt: s.cam[2], heading: (poses[i].heading / D2R + 360) % 360,
    caption: s.caption || '', loc: s.loc || '', src: s }));
  const geoid = typeof m.GEOID_M === 'number' ? m.GEOID_M : 0;
  const pose = { x: 0, y: 0, z: 0, heading: 0, moving: false, basis: curved ? { w: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1] } : null },
    out = { pos: [0, 0, 0], heading: 0, pitch: 0 };
  let leg = null, t = 0;
  const setPose = (p, h) => { pose.x = p[0]; pose.y = p[1]; pose.z = p[2]; pose.heading = h / D2R; if (curved) basisInto(m.FRAME, p[0], p[1], p[2], pose.basis); };
  const W = {
    name, origin: origin || m.ORIGIN, stops, index: 0, toLocal: m.toLocal, curved, park: m.PARK || null, tour: m,
    start() { leg = null; W.index = 0; setPose(poses[0].pos, poses[0].heading); pose.moving = false; },
    go(i) {
      i = ((i % stops.length) + stops.length) % stops.length; if (i === W.index && !leg) return;
      const from = { pos: [pose.x, pose.y, pose.z], heading: pose.heading * D2R, pitch: poses[W.index].pitch };
      leg = m.makeLeg(from, poses[i]); t = 0; W.index = i;
    },
    next() { W.go(W.index + 1); }, prev() { W.go(W.index - 1); },
    update(dt) {
      if (!leg) { pose.moving = false; return pose; }
      t += dt; const u = Math.min(1, t / leg.dur); m.legPose(leg, u, out); setPose(out.pos, out.heading); pose.moving = true;
      if (u >= 1) leg = null;
      return pose;
    },
    mapPoints() { return stops.map((s, i) => ({ name: s.name, x: poses[i].pos[0], z: poses[i].pos[2] })); },
    // metres above sea level: on a curved tour the ground falls away from the origin's horizon (2 km at 170 km), so go
    // through fromLocal (called about once a second, for the helm screen)
    altMsl() { return curved && m.fromLocal ? m.fromLocal(pose.x, pose.y, pose.z).altMsl : pose.y - geoid; },
  };
  W.start();
  return W;
}

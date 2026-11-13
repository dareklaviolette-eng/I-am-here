// Adapter: travel/yosemite/tour.js (the Travel Desk's pure tour module: STOPS with cam / look, stopPose, makeLeg, legPose,
// toLocal) -> the WORLD interface of shared/aurora/aurora.js. Returns null when the module does not offer those pieces.
const D2R = Math.PI / 180;
export function worldFromTour(m, { name = 'Yosemite', origin } = {}) {
  if (!m || !Array.isArray(m.STOPS) || !m.stopPose || !m.makeLeg || !m.legPose || !m.toLocal) return null;
  const poses = m.STOPS.map((s) => m.stopPose(s));
  const stops = m.STOPS.map((s, i) => ({ id: s.id, name: s.name, lat: s.cam[0], lon: s.cam[1], alt: s.cam[2], heading: (poses[i].heading / D2R + 360) % 360,
    caption: s.caption || '', loc: s.loc || '' }));
  const geoid = typeof m.GEOID_M === 'number' ? m.GEOID_M : 0;
  const pose = { x: 0, y: 0, z: 0, heading: 0, moving: false }, out = { pos: [0, 0, 0], heading: 0, pitch: 0 };
  let leg = null, t = 0;
  const setPose = (p, h) => { pose.x = p[0]; pose.y = p[1]; pose.z = p[2]; pose.heading = h / D2R; };
  const W = {
    name, origin: origin || m.ORIGIN, stops, index: 0, toLocal: m.toLocal,
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
    altMsl() { return pose.y - geoid; },
  };
  W.start();
  return W;
}

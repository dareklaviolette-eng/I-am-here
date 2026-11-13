// I'M HERE Travel Desk · the shared tour maths: one pure module (no DOM, no three.js) that every park's tour.js builds on.
// A park's tour.js keeps its own data (ORIGIN, STOPS, PARK) and gets its frame, poses, glide, drift, route and weather from
// createTour(); it re-exports them under the same names, so hosts (travel/shared/tour-page.js, aurora/tour-world.js) see one
// interface for every park.
//
// World frame (same convention as 737/google-scenery.js): metres, origin on the WGS84 ellipsoid under the park's ORIGIN,
// x = west, y = up, z = north. Positions come from latitude / longitude / altitude through ECEF, so earth curvature is exact.
// curved: true (tours that span 50-350 km: the Alps, New Zealand) also measures headings and pitches in the LOCAL horizon at
// each point (basisAt), so a viewpoint 170 km from the origin still has a level horizon; the page turns the camera with the
// same basis. curved: false (Yosemite) keeps the origin's horizon everywhere, exactly as before (the park is 33 km across).

const D2R = Math.PI / 180;
const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
export const FT = 0.3048;

export function ecefFromLLH(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p);
  const N = WGS_A / Math.sqrt(1 - WGS_E2 * sp * sp);
  return [(N + h) * cp * Math.cos(l), (N + h) * cp * Math.sin(l), (N * (1 - WGS_E2) + h) * sp];
}
// Column-major 4x4 (THREE.Matrix4.fromArray) taking ECEF metres to the local frame at (lat, lon, h).
export function localFrameMatrix(latDeg, lonDeg, h = 0) {
  const p = latDeg * D2R, l = lonDeg * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const E = [-sl, cl, 0], Nn = [-sp * cl, -sp * sl, cp], U = [cp * cl, cp * sl, sp];
  const rows = [E.map((v) => -v), U, Nn];
  const P0 = ecefFromLLH(latDeg, lonDeg, h);
  const t = rows.map((r) => -(r[0] * P0[0] + r[1] * P0[1] + r[2] * P0[2]));
  return [rows[0][0], rows[1][0], rows[2][0], 0, rows[0][1], rows[1][1], rows[2][1], 0, rows[0][2], rows[1][2], rows[2][2], 0, t[0], t[1], t[2], 1];
}
export function applyMatrix(m, v) { return [0, 1, 2].map((i) => m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i]); }
export function mPerDegLat(lat) { const p = lat * D2R; return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p); }
export function mPerDegLon(lat) { const p = lat * D2R; return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p); }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };   // smootherstep: 0 speed at both ends
export function angleBetween(h0, h1) { let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// The tour views, aboard XR Aurora (IH-0000). Observation deck = the stop's own viewpoint seen from the craft's glass deck
// (the host draws the frame). Be There = the same viewpoint with no frame. God's eye = high above the scene, looking
// steeply down, with the viewpoint's direction still "forward". ('chase' is kept for hosts that want it.)
export const POVS = [['deck', 'Observation deck'], ['bethere', 'Be There'], ['god', "God's eye"]];
export const POV_FRAMED = { deck: true, bethere: false, god: false };

const WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow',
  75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };
export const wmoText = (c) => WMO[c] || (Number.isFinite(c) ? 'Code ' + c : '');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const fmtFt = (n) => Math.round(n).toLocaleString('en-US') + ' ft';
export const fmtM = (n) => Math.round(n).toLocaleString('en-US') + ' m';

// createTour({ ORIGIN, GEOID_M, STOPS, curved, holdS, glide: { liftMax, durMax }, weather: { timezone, metric } })
export function createTour({ ORIGIN, GEOID_M = 0, STOPS, curved = false, holdS = 25, glide = {}, weather = {} }) {
  const LIFT_MAX = glide.liftMax || 14000, DUR_MAX = glide.durMax || 20;
  const FRAME = localFrameMatrix(ORIGIN.lat, ORIGIN.lon, 0);
  // latitude, longitude, metres above sea level -> [x, y, z] in the world frame
  function toLocal(lat, lon, altMsl) { return applyMatrix(FRAME, ecefFromLLH(lat, lon, altMsl + GEOID_M)); }
  // and back (small-area start, then corrections through the exact forward transform: well under a metre)
  function fromLocal(x, y, z) {
    const kl = mPerDegLat(ORIGIN.lat), ko = mPerDegLon(ORIGIN.lat);
    let lat = ORIGIN.lat + z / kl, lon = ORIGIN.lon - x / ko, alt = y + (x * x + z * z) / (2 * 6371008.8);
    for (let i = 0; i < (curved ? 4 : 2); i++) {
      const p = toLocal(lat, lon, alt); lat += (z - p[2]) / kl; lon -= (x - p[0]) / ko; alt += y - p[1];
    }
    return { lat, lon, altMsl: alt };
  }
  // The local horizon at a world point: unit world vectors pointing west, up and north there. Identity when not curved.
  const ID = { w: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1] };
  function basisAt(p) {
    if (!curved) return ID;
    const ll = fromLocal(p[0], p[1], p[2]), a = ll.lat * D2R, l = ll.lon * D2R, sa = Math.sin(a), ca = Math.cos(a), sl = Math.sin(l), cl = Math.cos(l);
    const R = (v) => [FRAME[0] * v[0] + FRAME[4] * v[1] + FRAME[8] * v[2], FRAME[1] * v[0] + FRAME[5] * v[1] + FRAME[9] * v[2], FRAME[2] * v[0] + FRAME[6] * v[1] + FRAME[10] * v[2]];
    return { w: R([sl, -cl, 0]), u: R([ca * cl, ca * sl, sa]), n: R([-sa * cl, -sa * sl, ca]) };
  }
  const toBasis = (B, d) => [dot(d, B.w), dot(d, B.u), dot(d, B.n)];
  const fromBasis = (B, v) => [0, 1, 2].map((i) => B.w[i] * v[0] + B.u[i] * v[1] + B.n[i] * v[2]);

  // A stop's camera: position, look target, heading (rad, 0 = north, + = east) and pitch (rad, + = up)
  function stopPose(s) {
    const pos = toLocal(...s.cam), look = toLocal(...s.look), d = sub(look, pos);
    if (!curved) return { pos, look, heading: Math.atan2(-d[0], d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])), dist: len(d) };
    const q = toBasis(basisAt(pos), d);
    return { pos, look, heading: Math.atan2(-q[0], q[2]), pitch: Math.atan2(q[1], Math.hypot(q[0], q[2])), dist: len(d) };
  }
  function povPose(s, pov) {
    const P = stopPose(s);
    if (pov === 'god') {
      const pitch = -72 * D2R;
      if (!curved) {
        const c = [(P.pos[0] + P.look[0]) / 2, Math.max(P.pos[1], P.look[1]), (P.pos[2] + P.look[2]) / 2];
        const up = clamp(P.dist * 1.2, 3000, 7000), back = up / Math.tan(-pitch);   // a little behind the centre so the scene sits mid-screen
        return { pos: [c[0] + Math.sin(P.heading) * back, c[1] + up, c[2] - Math.cos(P.heading) * back], heading: P.heading, pitch };
      }
      const B = basisAt(P.pos), lp = toBasis(B, sub(P.look, P.pos));
      const c = [lp[0] / 2, Math.max(0, lp[1]), lp[2] / 2];
      const up = clamp(P.dist * 1.2, 3000, s.godMax || 9000), back = up / Math.tan(-pitch);
      const o = fromBasis(B, [c[0] + Math.sin(P.heading) * back, c[1] + up, c[2] - Math.cos(P.heading) * back]);
      const pos = [P.pos[0] + o[0], P.pos[1] + o[1], P.pos[2] + o[2]];
      return { pos, heading: P.heading, pitch };
    }
    if (pov === 'chase') {
      const back = 420, upM = 160;
      const off = curved ? fromBasis(basisAt(P.pos), [Math.sin(P.heading) * back, upM, -Math.cos(P.heading) * back]) : [Math.sin(P.heading) * back, upM, -Math.cos(P.heading) * back];
      return { pos: [P.pos[0] + off[0], P.pos[1] + off[1], P.pos[2] + off[2]], heading: P.heading, pitch: Math.min(P.pitch, 0) - 6 * D2R };
    }
    return { pos: P.pos, heading: P.heading, pitch: P.pitch };
  }

  // The breathing at a stop (t seconds since arrival): an offset in metres and a yaw in radians. Slow (periods of ~52 s),
  // small, and zero at t = 0 so arriving never jumps. VR uses only a gentle sideways slide (never a rotation).
  // s.drift: 'pan' (yaw, s.panDeg degrees, default 3.5) or 'slide' (a sideways dolly of s.slideM metres).
  function drift(s, t, vr = false) {
    const w = 2 * Math.PI / 52, ramp = smoother(t / 6), sn = Math.sin(w * t) * ramp;
    const H = stopPose(s).heading;
    let side = [-Math.cos(H), 0, -Math.sin(H)];   // world vector to the right of the heading (x = west)
    if (curved) side = fromBasis(basisAt(toLocal(...s.cam)), side);
    if (vr) { const a = 8 * sn; return { off: [side[0] * a, curved ? side[1] * a : 0, side[2] * a], yaw: 0 }; }
    if (s.drift === 'slide') { const a = (s.slideM || 200) / 2 * sn; return { off: [side[0] * a, curved ? side[1] * a : 0, side[2] * a], yaw: 0 }; }
    if (curved) { const B = basisAt(toLocal(...s.cam)); return { off: [B.u[0] * 6 * sn, B.u[1] * 6 * sn, B.u[2] * 6 * sn], yaw: (s.panDeg || 3.5) * D2R * sn }; }
    return { off: [0, 6 * sn, 0], yaw: 3.5 * D2R * sn };
  }

  // From one pose to the next: a cubic Bezier that rises over long legs (so the ground never streams past fast and nothing
  // high is in the way), with an eased clock (smootherstep). Duration 10 s up to DUR_MAX from distance and turn.
  function legLift(dist) { return dist > 6000 ? Math.min(dist * 0.35, LIFT_MAX) : dist * 0.2 + 100; }
  function legDuration(a, b) {
    const dist = len(sub(b.pos, a.pos)), turn = Math.abs(angleBetween(a.heading, b.heading)) / D2R + Math.abs(b.pitch - a.pitch) / D2R;
    return clamp(10 + dist / 4000 + turn / 20, 10, DUR_MAX);
  }
  function makeLeg(a, b) {
    const dist = len(sub(b.pos, a.pos)), lift = legLift(dist), k = 0.22;
    const d = sub(b.pos, a.pos);
    let p1, p2;
    if (!curved) { p1 = [a.pos[0] + d[0] * k, a.pos[1] + lift, a.pos[2] + d[2] * k]; p2 = [b.pos[0] - d[0] * k, b.pos[1] + lift, b.pos[2] - d[2] * k]; }
    else {   // rise along the local vertical at the middle of the leg; the chord's own climb is left out, as on flat legs
      const up = basisAt([(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2]).u, hd = d.map((v, i) => v - up[i] * dot(d, up));
      p1 = [0, 1, 2].map((i) => a.pos[i] + hd[i] * k + up[i] * lift); p2 = [0, 1, 2].map((i) => b.pos[i] - hd[i] * k + up[i] * lift);
    }
    return { a, b, p1, p2, dist, lift, dur: legDuration(a, b), dh: angleBetween(a.heading, b.heading) };
  }
  // Pose at u in [0, 1] of the leg's time. Writes into out { pos, heading, pitch } (no allocations).
  function legPose(L, u, out) {
    const t = smoother(u), s = 1 - t, A = L.a.pos, B = L.b.pos;
    const c0 = s * s * s, c1 = 3 * s * s * t, c2 = 3 * s * t * t, c3 = t * t * t;
    for (let i = 0; i < 3; i++) out.pos[i] = c0 * A[i] + c1 * L.p1[i] + c2 * L.p2[i] + c3 * B[i];
    // turn: the heading takes the short way round; over high legs the view also tips down toward the land (and back)
    const tt = smoother(clamp((u - 0.08) / 0.84, 0, 1));
    out.heading = L.a.heading + L.dh * tt;
    const dip = Math.sin(Math.PI * t) * clamp(L.lift / 5000, 0, 1) * 30 * D2R;
    out.pitch = L.a.pitch + (L.b.pitch - L.a.pitch) * tt - dip;
    return out;
  }
  // Fastest angular rate on a leg (deg/s), for the comfort test: sampled.
  function legPeakTurnRate(L, n = 400) {
    const o = { pos: [0, 0, 0] }, p = { pos: [0, 0, 0] }; let best = 0;
    for (let i = 1; i <= n; i++) {
      legPose(L, (i - 1) / n, p); const h0 = p.heading, q0 = p.pitch; legPose(L, i / n, o);
      const r = Math.hypot(angleBetween(h0, o.heading), o.pitch - q0) / D2R / (L.dur / n); if (r > best) best = r;
    }
    return best;
  }
  // Fastest "ground flow" on a leg (deg/s): speed over height above the ground (sea level here; a comfort proxy).
  function legPeakFlow(L, n = 400, groundM = 0) {
    const o = { pos: [0, 0, 0] }, p = { pos: [0, 0, 0] }; let best = 0;
    for (let i = 1; i <= n; i++) {
      legPose(L, (i - 1) / n, p); legPose(L, i / n, o);
      const v = len(sub(o.pos, p.pos)) / (L.dur / n), h = Math.max(200, fromLocal(...o.pos).altMsl - groundM);
      best = Math.max(best, v / h / D2R);
    }
    return best;
  }

  // The route drawn in God's eye: every leg sampled (stop i -> i + 1), as flat [x, y, z, ...] arrays
  function routeLine(n = 40) {
    const out = [];
    for (let i = 0; i < STOPS.length - 1; i++) {
      const L = makeLeg(povPose(STOPS[i], 'deck'), povPose(STOPS[i + 1], 'deck')), o = { pos: [0, 0, 0] };
      for (let j = 0; j <= n; j++) { legPose(L, j / n, o); out.push(o.pos[0], o.pos[1], o.pos[2]); }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------- weather
  // Open-Meteo (free, no key, CORS): current conditions for every stop in one request, at each stop's own elevation.
  // Imperial tours (Yosemite) ask for °F and mph; metric tours for °C and km/h (°F is worked out for the US reader).
  const metric = !!weather.metric, tz = weather.timezone || 'America/Los_Angeles';
  const elevMOf = (s) => (s.elevFt != null ? s.elevFt * FT : s.elevM);
  function weatherURL(stops = STOPS) {
    const f = (k) => stops.map(k).join(',');
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + f((s) => s.cam[0].toFixed(4)) + '&longitude=' + f((s) => s.cam[1].toFixed(4)) +
      '&elevation=' + f((s) => Math.round(elevMOf(s))) +
      '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day' + (metric ? '&temperature_unit=celsius&wind_speed_unit=kmh' : '&temperature_unit=fahrenheit&wind_speed_unit=mph') +
      '&timezone=' + encodeURIComponent(tz);
  }
  // Open-Meteo answer (one object, or an array for several places) -> [{ tempF, tempC?, text, windMph | windKmh, windDir, isDay, time }]
  function parseWeather(j) {
    const arr = Array.isArray(j) ? j : [j];
    return arr.map((x) => {
      const c = x && x.current; if (!c) return null;
      const dir = Number.isFinite(c.wind_direction_10m) ? COMPASS[Math.round(c.wind_direction_10m / 45) % 8] : '';
      if (!metric) return { tempF: Math.round(c.temperature_2m), text: wmoText(c.weather_code), code: c.weather_code, windMph: Math.round(c.wind_speed_10m), windDir: dir, isDay: !!c.is_day, time: c.time || '' };
      return { tempC: Math.round(c.temperature_2m), tempF: Math.round(c.temperature_2m * 9 / 5 + 32), text: wmoText(c.weather_code), code: c.weather_code,
        windKmh: Math.round(c.wind_speed_10m), windDir: dir, isDay: !!c.is_day, time: c.time || '' };
    });
  }
  // fetchWeather(fetchFn?) -> Promise<[...] | null in stop order>
  async function fetchWeather(fetchFn = (u, o) => fetch(u, o), { timeoutMs = 12000 } = {}) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
    try {
      const r = await fetchFn(weatherURL(), ctl ? { signal: ctl.signal } : {});
      if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
      return parseWeather(await r.json());
    } finally { clearTimeout(tm); }
  }

  return { ORIGIN, GEOID_M, FRAME, STOPS, CURVED: curved, HOLD_S: holdS, toLocal, fromLocal, basisAt, stopPose, povPose, drift, legLift, legDuration, makeLeg, legPose,
    legPeakTurnRate, legPeakFlow, routeLine, weatherURL, parseWeather, fetchWeather, elevMOf };
}

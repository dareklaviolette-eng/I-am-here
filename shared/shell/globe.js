// EFB globe: an orthographic Earth drawn into a 2D canvas (the same land mask as the Aurora's holo globe and the space page:
// Natural Earth 1:50m land, public domain, shared/aurora/earth-land.js). Drawn only when the view changes, never per frame.
import { decodeLand, LAND_W, LAND_H } from '../aurora/earth-land.js';

const D2R = Math.PI / 180;
let MASK = null, MW = 0, MH = 0;
function mask() {   // the land mask, downsampled to 1024 x 512 once
  if (MASK) return MASK;
  const full = decodeLand(); MW = 1024; MH = 512; MASK = new Uint8Array(MW * MH);
  const fx = LAND_W / MW, fy = LAND_H / MH;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) MASK[y * MW + x] = full[Math.floor(y * fy) * LAND_W + Math.floor(x * fx)];
  return MASK;
}

// draw the globe (radius r px) centred on (lat0, lon0) into ctx at (cx, cy)
export function drawGlobe(ctx, cx, cy, r, lat0, lon0, opts = {}) {
  const m = mask(), size = Math.ceil(r * 2), img = ctx.createImageData(size, size), d = img.data;
  const sp = Math.sin(lat0 * D2R), cp = Math.cos(lat0 * D2R);
  const ocean = opts.ocean || [14, 46, 78], land = opts.land || [74, 150, 112], rim = opts.rim || [120, 210, 255];
  for (let j = 0; j < size; j++) {
    const y = (r - j - 0.5) / r;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - r) / r, rr = x * x + y * y, k = (j * size + i) * 4;
      if (rr > 1) { d[k + 3] = 0; continue; }
      const z = Math.sqrt(1 - rr);
      // inverse orthographic: point on the unit sphere -> lat / lon
      const lat = Math.asin(y * cp + z * sp), lon = lon0 * D2R + Math.atan2(x, z * cp - y * sp);
      let u = ((lon / D2R + 180) / 360) % 1; if (u < 0) u += 1;
      const v = (90 - lat / D2R) / 180;
      const isLand = m[Math.min(MH - 1, Math.floor(v * MH)) * MW + Math.min(MW - 1, Math.floor(u * MW))];
      const c = isLand ? land : ocean, shade = 0.55 + 0.45 * z, edge = rr > 0.93 ? (rr - 0.93) / 0.07 : 0;
      d[k] = c[0] * shade * (1 - edge) + rim[0] * edge; d[k + 1] = c[1] * shade * (1 - edge) + rim[1] * edge; d[k + 2] = c[2] * shade * (1 - edge) + rim[2] * edge; d[k + 3] = 255;
    }
  }
  // via a scratch canvas so the circle composites over what is already drawn
  const s = (opts.scratch && opts.scratch.width >= size) ? opts.scratch : document.createElement('canvas');
  if (s.width < size) { s.width = size; s.height = size; }
  const sg = s.getContext('2d'); sg.clearRect(0, 0, size, size); sg.putImageData(img, 0, 0);
  ctx.drawImage(s, 0, 0, size, size, cx - r, cy - r, size, size);
  return s;
}
// screen position of (lat, lon) on that globe, or null when on the far side
export function project(lat, lon, cx, cy, r, lat0, lon0, out = {}) {
  const p = lat * D2R, l = (lon - lon0) * D2R, p0 = lat0 * D2R;
  const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
  if (cosc < 0.05) return null;
  out.x = cx + r * Math.cos(p) * Math.sin(l);
  out.y = cy - r * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l));
  return out;
}

// I'M HERE XR shell: small helpers shared by the shell and the stations. No three.js import: pass THREE where needed.
export const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace';
export const MARKF = '"Arial Black","Helvetica Neue",Arial,sans-serif';
export const SANS = '"Helvetica Neue",Arial,system-ui,sans-serif';
export const GREEN = '#7ef0a2', AMBER = '#ffbf47', CYAN = 'rgba(110,220,235,0.8)';

// every texture a material or a shader's uniforms point at
const TEX_KEYS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap',
  'normalMap', 'roughnessMap', 'specularMap', 'gradientMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
  'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'anisotropyMap', 'specularIntensityMap', 'specularColorMap'];
export function disposeMaterial(m, seen) {
  if (!m || (seen && seen.has(m))) return; if (seen) seen.add(m);
  for (const k of TEX_KEYS) { const t = m[k]; if (t && t.isTexture && (!seen || !seen.has(t))) { if (seen) seen.add(t); t.dispose(); } }
  if (m.uniforms) for (const k in m.uniforms) {
    const v = m.uniforms[k] && m.uniforms[k].value;
    if (v && v.isTexture && (!seen || !seen.has(v))) { if (seen) seen.add(v); v.dispose(); }
    else if (Array.isArray(v)) v.forEach((x) => { if (x && x.isTexture) x.dispose(); });
  }
  m.dispose();
}
// Remove obj from its parent and free every geometry, material and texture under it (render targets too, when an object
// carries userData.renderTarget). keep(o) -> true skips an object (and what it holds), e.g. the camera rig.
export function disposeDeep(obj, keep) {
  if (!obj) return;
  const seen = new Set();
  const visit = (o) => {
    if (keep && keep(o)) return;
    for (let i = o.children.length - 1; i >= 0; i--) visit(o.children[i]);
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    if (o.isInstancedMesh && o.dispose) { try { o.dispose(); } catch (e) { /* ignore */ } }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => disposeMaterial(m, seen));
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    if (o.userData && o.userData.renderTarget && o.userData.renderTarget.dispose) o.userData.renderTarget.dispose();
    if (o.dispose && (o.isLight || o.isCSS)) { try { o.dispose(); } catch (e) { /* ignore */ } }
    if (o.parent && o !== obj) o.parent.remove(o);
  };
  visit(obj);
  obj.removeFromParent();
}

export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function fitText(g, t, w) {
  t = String(t == null ? '' : t); if (g.measureText(t).width <= w) return t;
  while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}
// wrap text into at most maxLines lines of width w (the last one ellipsised)
export function wrapText(g, t, w, maxLines) {
  const words = String(t || '').split(/\s+/).filter(Boolean), out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(test).width <= w || !line) { line = test; continue; }
    out.push(line); line = words[i];
    if (out.length === maxLines - 1) { line = words.slice(i).join(' '); break; }
  }
  if (line) out.push(out.length === maxLines - 1 ? fitText(g, line, w) : line);
  return out.slice(0, maxLines);
}
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const D2R = Math.PI / 180;
// "#station=boats&area=sydney" <-> { station: 'boats', area: 'sydney' }
export function parseHash(h) {
  const out = {}; String(h || '').replace(/^#/, '').split('&').forEach((kv) => { if (!kv) return; const i = kv.indexOf('='); const k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i)); out[k] = i < 0 ? '1' : decodeURIComponent(kv.slice(i + 1)); });
  return out;
}
export function makeHash(station, params) {
  const p = Object.assign({ station }, params || {});
  return '#' + Object.keys(p).filter((k) => p[k] != null && p[k] !== '').map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
}
export function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
// let a frame go by (loading in the background must never block a frame for long: the VR watchdog is watching)
export function nextFrame() { return new Promise((r) => (typeof requestAnimationFrame === 'function' ? setTimeout(r, 0) : setTimeout(r, 0))); }

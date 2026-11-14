# Build shared/aurora/models/xr-aurora-hull.glb from the founder's Meshy export (run with python3 -I build_hull.py SRC.glb OUT.glb).
# Source: one mesh, nose toward -x, y up, about 1.9 x 0.35 x 0.42 units. Output: the craft frame of build.js (metres, y up,
# bow toward -z), scaled to the procedural hull's length (62 m, z -36 .. 26). Textures re-encoded as WebP for Quest;
# an emissive map is generated: warm glow on the lounge window band, blue on the two aft nozzles.
import sys, io, json, struct, numpy as np
from PIL import Image, ImageDraw, ImageFilter
SRC, OUT = sys.argv[1], sys.argv[2]
CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}
b = open(SRC, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + L]); B = b[20 + L + 8:]
def acc(i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; n = NC[a['type']]
    r = np.frombuffer(B, CT[a['componentType']], a['count'] * n, v.get('byteOffset', 0) + a.get('byteOffset', 0))
    return r.reshape(a['count'], n) if n > 1 else r
def img(i):
    v = j['bufferViews'][j['images'][j['textures'][i]['source']]['bufferView']]
    return Image.open(io.BytesIO(B[v['byteOffset']:v['byteOffset'] + v['byteLength']]))
pr = j['meshes'][0]['primitives'][0]; mat = j['materials'][0]
P = acc(pr['attributes']['POSITION']).astype(np.float64); N = acc(pr['attributes']['NORMAL']).astype(np.float64)
UV = acc(pr['attributes']['TEXCOORD_0']).astype(np.float32); I = acc(pr['indices']).astype(np.uint32).reshape(-1, 3)
bc = img(mat['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB')
mr = img(mat['pbrMetallicRoughness']['metallicRoughnessTexture']['index']).convert('RGB')
nm = img(mat['normalTexture']['index']).convert('RGB')

# ---- emissive map (source frame): rasterise the chosen triangles in UV space
ES = 1024
C = P[I].mean(1); fn = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
# window band: a lozenge on each flank, x -0.91 .. 0.22, y about -0.126 .. 0.034 (measured on an orthographic side render)
ex, ey, ea, eb = -0.345, -0.046, 0.575, 0.08
d = ((C[:, 0] - ex) / ea) ** 2 + ((C[:, 1] - ey) / eb) ** 2
halfw = np.interp(C[:, 0], np.arange(-0.95, 0.96, 0.1), [0.06, 0.1, 0.13, 0.155, 0.17, 0.176, 0.183, 0.188, 0.187, 0.183, 0.188, 0.198, 0.205, 0.18, 0.155, 0.135, 0.123, 0.11, 0.08, 0.06])
band = (d < 1.0) & (np.abs(fn[:, 2]) > 0.35) & (np.abs(C[:, 2]) > 0.8 * halfw)
# the two aft nozzles on the centreline: upper y 0.02, lower y -0.09, r ~0.055
def near(cy, cz, r): return (C[:, 0] > 0.8) & (fn[:, 0] > 0.2) & ((C[:, 1] - cy) ** 2 + (C[:, 2] - cz) ** 2 < r * r)
nozzle = near(0.02, 0, 0.058) | near(-0.09, 0, 0.058)
def raster(tris, value):   # per-texel value(source positions [n,3], triangle index) over the triangles' UV footprints
    out = np.zeros((ES, ES), np.float32)
    for k in tris:
        uv = UV[I[k]].astype(np.float64) * ES - 0.5; p = P[I[k]]
        x0, y0 = np.floor(uv.min(0)).astype(int) - 1; x1, y1 = np.ceil(uv.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, ES - 1), min(y1, ES - 1)
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        a, b_, c = uv; den = (b_[1] - c[1]) * (a[0] - c[0]) + (c[0] - b_[0]) * (a[1] - c[1])
        if abs(den) < 1e-12: continue
        l1 = ((b_[1] - c[1]) * (gx - c[0]) + (c[0] - b_[0]) * (gy - c[1])) / den
        l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den; l3 = 1 - l1 - l2
        ins = (l1 > -0.08) & (l2 > -0.08) & (l3 > -0.08)
        if not ins.any(): continue
        pos = l1[ins, None] * p[0] + l2[ins, None] * p[1] + l3[ins, None] * p[2]
        v = value(pos, k); yy, xx = gy[ins], gx[ins]
        out[yy, xx] = np.maximum(out[yy, xx], v)
    return out
def bandv(pos, k):
    dd = ((pos[:, 0] - ex) / ea) ** 2 + ((pos[:, 1] - ey) / eb) ** 2
    return np.clip((1.0 - dd) / 0.25, 0, 1) ** 0.8
cand = (d < 1.8) & (np.abs(fn[:, 2]) > 0.35) & (np.abs(C[:, 2]) > 0.8 * halfw)
mw = Image.fromarray((raster(np.nonzero(cand)[0], bandv) * 255).astype(np.uint8))
mb = Image.fromarray((raster(np.nonzero(nozzle)[0], lambda pos, k: np.ones(len(pos))) * 255).astype(np.uint8))
mw = mw.filter(ImageFilter.MaxFilter(3)); mb = mb.filter(ImageFilter.MaxFilter(3))
base = np.asarray(bc.resize((ES, ES), Image.BILINEAR)).astype(np.float32) / 255
lum = base.mean(2, keepdims=True)
w = np.asarray(mw).astype(np.float32)[..., None] / 255; bl = np.asarray(mb).astype(np.float32)[..., None] / 255
# the glass reads warm where the texture is mid/dark (the lounge behind it); the bright chrome mullions stay mostly unlit
warmc = np.array([1.0, 0.64, 0.30], np.float32) * (0.55 + 0.45 * np.clip(1.2 - lum, 0, 1))
bluec = np.array([0.32, 0.78, 1.0], np.float32) * (0.6 + 0.6 * lum)
em = np.clip(w * warmc + bl * bluec, 0, 1)
emi = Image.fromarray((em * 255).astype(np.uint8))
print('band tris', cand.sum(), 'nozzle tris', nozzle.sum())
emi.save('/tmp/hv/emissive.png')

# ---- geometry into the craft frame: source x (nose -x) -> craft z (bow -z); source z -> craft -x; scale to 62 m
K = 62.0 / (P[:, 0].max() - P[:, 0].min()); Z0 = -36.0 - K * P[:, 0].min(); Y0 = 1.5 - K * (P[:, 1].max() + P[:, 1].min()) / 2
Po = np.c_[-K * P[:, 2], K * P[:, 1] + Y0, K * P[:, 0] + Z0].astype(np.float32)
No = np.c_[-N[:, 2], N[:, 1], N[:, 0]]; No /= np.linalg.norm(No, axis=1, keepdims=True) + 1e-12
print('scale', K, 'bounds', Po.min(0), Po.max(0))
info = {'scale': K, 'z0': Z0, 'y0': Y0}

bin_ = bytearray(); views = []; accs = []; images = []; textures = []
def addview(bb, target=None):
    while len(bin_) % 4: bin_.append(0)
    views.append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(bb), **({'target': target} if target else {})}); bin_.extend(bb); return len(views) - 1
def addimg(im, size, name, q=82, lossless=False):
    if im.size[0] > size: im = im.resize((size, size), Image.LANCZOS)
    o = io.BytesIO(); im.save(o, 'WEBP', quality=q, method=6, lossless=lossless); data = o.getvalue()
    images.append({'bufferView': addview(data), 'mimeType': 'image/webp', 'name': name})
    textures.append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(images) - 1}}})
    print('  tex', name, size, len(data)); return len(textures) - 1
tb = addimg(bc, 2048, 'baseColor', 82); tm = addimg(mr, 1024, 'metallicRoughness', 85); tn = addimg(nm, 2048, 'normal', 88); te = addimg(emi, ES, 'emissive', 80)
pa = len(accs); accs.append({'bufferView': addview(Po.tobytes(), 34962), 'componentType': 5126, 'count': len(Po), 'type': 'VEC3', 'min': Po.min(0).tolist(), 'max': Po.max(0).tolist()})
N4 = np.zeros((len(No), 4), np.int8); N4[:, :3] = np.clip(np.round(No * 127), -127, 127)
nv = addview(N4.tobytes(), 34962); views[nv]['byteStride'] = 4
na = len(accs); accs.append({'bufferView': nv, 'componentType': 5120, 'count': len(N4), 'type': 'VEC3', 'normalized': True})
ua = len(accs); accs.append({'bufferView': addview(UV.tobytes(), 34962), 'componentType': 5126, 'count': len(UV), 'type': 'VEC2'})
Ii = I.reshape(-1).astype(np.uint16 if len(Po) < 65536 else np.uint32)
ia = len(accs); accs.append({'bufferView': addview(Ii.tobytes(), 34963), 'componentType': 5123 if Ii.dtype == np.uint16 else 5125, 'count': len(Ii), 'type': 'SCALAR'})
material = {'name': 'xr-aurora-hull', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': tb}, 'metallicRoughnessTexture': {'index': tm}},
            'normalTexture': {'index': tn}, 'emissiveTexture': {'index': te}, 'emissiveFactor': [1, 1, 1]}
gl = {'asset': {'version': '2.0', 'generator': "I'M HERE build_hull.py", 'extras': {'title': 'XR Aurora hull', 'source': 'Generated with Meshy by I\'M HERE',
        'license': "Meshy Pro license, owned by I'M HERE", 'frame': 'metres, y up, bow toward -z (shared/aurora/build.js craft frame)', **info}},
      'extensionsUsed': ['EXT_texture_webp', 'KHR_mesh_quantization'], 'extensionsRequired': ['EXT_texture_webp', 'KHR_mesh_quantization'],
      'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'name': 'xr-aurora-hull', 'mesh': 0}],
      'meshes': [{'name': 'xr-aurora-hull', 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na, 'TEXCOORD_0': ua}, 'indices': ia, 'material': 0}]}],
      'materials': [material], 'textures': textures, 'images': images, 'samplers': [{'magFilter': 9729, 'minFilter': 9987}],
      'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}]}
while len(bin_) % 4: bin_.append(0)
gl['buffers'][0]['byteLength'] = len(bin_)
js = json.dumps(gl, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js); f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)
print('wrote', OUT, len(open(OUT, 'rb').read()))

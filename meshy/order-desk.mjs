// Meshy model order desk. Each meshy/requests/<name>.json without a meshy/results/<name>.json gets generated.
// Request: { "image": "meshy/inputs/x.png" | "image_url": "https://...", "texture_prompt": "...",
//            "texture_image": "meshy/inputs/y.png", "target_polycount": 30000, "enable_pbr": true, "notes": "..." }
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.MESHY_API_KEY, CAP = +(process.env.DAILY_CAP || 5), API = 'https://api.meshy.ai/openapi/v1/image-to-3d';
if (!KEY) { console.log('MESHY_API_KEY secret is not set; nothing to do.'); process.exit(0); }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const today = new Date().toISOString().slice(0, 10);
const results = fs.readdirSync('meshy/results').filter((f) => f.endsWith('.json'));
let usedToday = results.filter((f) => { try { return JSON.parse(fs.readFileSync('meshy/results/' + f)).date === today; } catch { return false; } }).length;
const dataUri = (p) => `data:image/${path.extname(p).slice(1).replace('jpg', 'jpeg')};base64,` + fs.readFileSync(p).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of fs.readdirSync('meshy/requests').filter((f) => f.endsWith('.json'))) {
  const name = f.replace(/\.json$/, ''), out = `meshy/results/${name}.json`;
  if (fs.existsSync(out)) continue;
  if (usedToday >= CAP) { console.log(`Daily cap ${CAP} reached; ${name} waits for tomorrow.`); continue; }
  const r = JSON.parse(fs.readFileSync('meshy/requests/' + f));
  const body = { image_url: r.image ? dataUri(r.image) : r.image_url, should_texture: r.should_texture ?? true, enable_pbr: r.enable_pbr ?? true,
    should_remesh: true, target_polycount: r.target_polycount ?? 30000, target_formats: ['glb'] };
  if (r.texture_prompt) body.texture_prompt = r.texture_prompt;
  if (r.texture_image) body.texture_image_url = dataUri(r.texture_image);
  if (r.symmetry_mode) body.symmetry_mode = r.symmetry_mode;
  console.log('Ordering', name);
  const res = await fetch(API, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.result) { fs.writeFileSync(out, JSON.stringify({ name, date: today, status: 'ERROR', http: res.status, error: j }, null, 2)); usedToday++; continue; }
  let t;
  for (let i = 0; i < 240; i++) {
    await sleep(10000);
    t = await (await fetch(`${API}/${j.result}`, { headers: H })).json();
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(t.status)) break;
  }
  const rec = { name, date: today, task_id: j.result, status: t?.status, notes: r.notes || '', error: t?.task_error || null };
  if (t?.status === 'SUCCEEDED' && t.model_urls?.glb) {
    fs.writeFileSync(`meshy/models/${name}.glb`, Buffer.from(await (await fetch(t.model_urls.glb)).arrayBuffer()));
    if (t.thumbnail_url) fs.writeFileSync(`meshy/models/${name}.png`, Buffer.from(await (await fetch(t.thumbnail_url)).arrayBuffer()));
    rec.model = `meshy/models/${name}.glb`;
  }
  fs.writeFileSync(out, JSON.stringify(rec, null, 2)); usedToday++;
  console.log(name, rec.status);
}

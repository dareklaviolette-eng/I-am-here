// I'M HERE concierge v1: "Where do you want to be?" -> 1 to 3 result cards. Rules only (no AI yet), instant, offline.
// Pure module (no DOM, no three.js), tested in Node: node xr/test/concierge-test.mjs
//
// What the rules match, best first:
//   - ship names and MMSI numbers in the current station (live targets: ctx.targets)
//   - station names, area / port names, tour names and tour stop names (the stations' meta.places)
//   - keywords ("reef", "whales", "Alaska", "Matterhorn"); places we don't have yet answer "Coming soon" plus the nearest
//     thing we do have (SOON below)
// Unknown words -> one "Coming soon" card plus the default beautiful place.
//
// Built as a pipeline so an AI step can be added later without touching callers:
//   const c = createConcierge({ places, stations, steps: [rulesStep, myAiStep] });
//   await c.ask(text, ctx)  -> [{ kind, title, sub, tag, station, params, placeId, targetId, soon, score }]
// A step is (query, ctx, sofar) => results | Promise<results>; the pipeline stops at the first step that returns results
// with score >= 50 (rules answered confidently), else it lets the next step add or replace.

// places we don't have yet, and the nearest thing we do have (place id) - the maritime / space briefs, Nov 14
export const SOON = [
  { words: ['reef', 'great barrier reef', 'barrier reef', 'coral', 'manta', 'turtles', 'heron island'], title: 'Great Barrier Reef', near: 'boats:sydney', why: 'Aurora ocean tour, coming soon' },
  { words: ['mariana', 'mariana trench', 'trench', 'challenger deep', 'deep sea', 'snailfish'], title: 'Mariana Trench', near: 'boats:sydney', why: 'Aurora ocean tour, coming soon' },
  { words: ['glacier bay', 'hubbard', 'hubbard glacier', 'kenai', 'kenai fjords', 'skagway', 'ketchikan'], title: 'Glacier Bay, Alaska', near: 'boats:juneau', why: 'Rendered cruise coming soon; live ships May to Sep' },
  { words: ['iss', 'space station', 'space', 'orbit', 'astronaut', 'satellite', 'satellites', 'starlink'], title: 'The ISS', near: 'aurora:swiss-alps', why: 'Space station, coming soon' },
  { words: ['moon', 'mars', 'saturn', 'jupiter', 'sun', 'planets', 'nebula', 'black hole'], title: 'Space', near: 'aurora:new-zealand:tekapo', why: 'Space station, coming soon' },
  { words: ['flight', 'flights', 'plane', 'planes', 'cockpit', '737', 'airport', 'fly'], title: 'Aviation', near: 'aurora:swiss-alps', why: 'Aviation station, coming soon in VR (the 737 page works today)' },
  { words: ['shark', 'great white', 'wildlife', 'eagle', 'grizzly', 'bear'], title: 'Wildlife', near: 'boats:juneau', why: 'Wildlife station, coming soon' },
  { words: ['venice', 'amsterdam', 'canals', 'danube', 'rhine', 'nile', 'amazon', 'norway', 'fjords norway', 'greek islands', 'hong kong', 'star ferry', 'seattle', 'st barths', 'antibes', 'fort lauderdale', 'miami'],
    title: 'More waters', near: 'boats:monaco', why: 'Coming soon to Boats' },
];

export function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
const STOP = new Set(['the', 'a', 'an', 'to', 'i', 'want', 'be', 'go', 'take', 'me', 'show', 'at', 'in', 'on', 'of', 'see', 'somewhere', 'please', 'where', 'with', 'some', 'my', 'and', 'id', 'like', 'lets', 'let', 'us', 'fly', 'ride']);
const tokens = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));
const PLURAL = (t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

function scoreText(q, qt, text) {   // how well the query fits one name / keyword (0..100)
  const n = norm(text); if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q) && q.length >= 3) return 85;
  if (q.length >= 4 && (' ' + n + ' ').includes(' ' + q + ' ')) return 75;
  if (!qt.length) return 0;
  const words = n.split(' ').map(PLURAL);
  let hit = 0;
  for (const t of qt) { const p = PLURAL(t); if (words.some((w) => w === p || (p.length >= 3 && w.startsWith(p)))) hit++; }
  if (hit === qt.length) return 60 + Math.min(10, hit * 3);
  return hit ? 25 * hit / qt.length : 0;
}

// the rules step
export function rulesStep(query, ctx = {}) {
  const q = norm(query), qt = tokens(query), out = [];
  if (!q) return [];
  const places = ctx.places || [], byId = new Map(places.map((p) => [p.id, p]));
  // 1) live targets in the current station: MMSI (digits) or ship names
  const digits = q.replace(/\D/g, '');
  for (const t of ctx.targets || []) {
    let s = 0;
    if (digits.length >= 6 && t.mmsi != null && String(t.mmsi).startsWith(digits)) s = String(t.mmsi) === digits ? 100 : 80;
    else s = Math.max(scoreText(q, qt, t.name), 0);
    if (s >= 60) out.push({ kind: 'target', title: t.name, sub: t.line || '', tag: t.tag || 'LIVE', station: t.station || ctx.station, params: t.params || null, targetId: t.id, score: s + 2 });
  }
  // 2) stations, places (areas, tours, stops) by name, then keywords
  for (const st of ctx.stations || []) {
    if (st.hidden) continue;
    const s = Math.max(scoreText(q, qt, st.name), scoreText(q, qt, st.dept), scoreText(q, qt, st.title || ''));
    if (s >= 60) out.push({ kind: 'station', title: st.name, sub: st.title || '', tag: '', station: st.id, params: Object.assign({}, st.defaults || {}), placeId: null, score: s - 5 });
  }
  for (const p of places) {
    let s = scoreText(q, qt, p.name), kw = 0;
    for (const k of p.keywords || []) kw = Math.max(kw, scoreText(q, qt, k));
    // a stop wins on its own name; on a keyword alone its tour (or another place) is the better answer
    s = Math.max(s, kw ? (p.kind === 'stop' ? Math.min(70, kw - 20) : Math.min(90, kw - 10)) : 0);
    if (p.kind === 'stop' && s < 75) s -= 8;
    if (s >= 50) out.push({ kind: p.kind || 'place', title: p.name, sub: p.sub || '', tag: p.tag || '', station: p.station, params: p.params, placeId: p.id, score: s });
  }
  // 3) coming soon (+ the nearest thing we have)
  for (const so of SOON) {
    let s = 0; for (const w of so.words) s = Math.max(s, scoreText(q, qt, w));
    if (s >= 60 && !out.some((r) => r.score >= s)) {
      out.push({ kind: 'soon', title: so.title, sub: so.why, tag: 'SOON', soon: true, score: s });
      const n = byId.get(so.near);
      if (n) out.push({ kind: n.kind || 'place', title: n.name, sub: 'Nearest we have now · ' + (n.sub || ''), tag: n.tag || '', station: n.station, params: n.params, placeId: n.id, score: s - 1 });
    }
  }
  return dedupe(out).slice(0, 3);
}
function dedupe(list) {
  list.sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [], groups = new Set();
  for (const r of list) {
    const k = r.kind === 'soon' ? 'soon:' + r.title : (r.targetId ? 't:' + r.targetId : r.placeId || 's:' + r.station);
    if (seen.has(k)) continue; seen.add(k);
    // variety: one card per tour (its stops only when named outright), so "glacier" offers the Alps, NZ and Alaska
    const grp = r.placeId ? r.placeId.split(':').slice(0, 2).join(':') : k;
    if (r.kind === 'stop' && groups.has(grp) && r.score < 85) continue;
    groups.add(grp); out.push(r);
  }
  return out;
}

export function createConcierge({ places = [], stations = [], steps = [rulesStep], fallbackPlace = 'boats:sydney' } = {}) {
  const byId = new Map(places.map((p) => [p.id, p]));
  async function ask(text, ctx = {}) {
    const c = Object.assign({ places, stations }, ctx);
    let res = [];
    for (const step of steps) {
      const r = await step(text, c, res);
      if (Array.isArray(r) && r.length) { res = r; if (r[0].score >= 50) break; }
    }
    if (!res.length && norm(text)) {   // unknown: say so, and offer the default beautiful place
      const f = byId.get(fallbackPlace);
      res = [{ kind: 'soon', title: 'Coming soon: "' + String(text).trim().slice(0, 40) + '"', sub: "We're not there yet", tag: 'SOON', soon: true, score: 1 }];
      if (f) res.push({ kind: f.kind || 'place', title: f.name, sub: 'Somewhere beautiful now · ' + (f.sub || ''), tag: f.tag || '', station: f.station, params: f.params, placeId: f.id, score: 0 });
    }
    return res.slice(0, 3);
  }
  // synchronous rules only (the EFB uses it while typing)
  function quick(text, ctx = {}) { return rulesStep(text, Object.assign({ places, stations }, ctx)); }
  return { ask, quick, places, stations };
}

// node xr/test/concierge-test.mjs : the rules concierge answers the way the founder would expect (no AI, no network).
import { createConcierge, norm } from '../../shared/shell/concierge.js';
import boats from '../../stations/boats/meta.js';
import aurora from '../../stations/aurora/meta.js';
import example from '../../stations/example/meta.js';

const stations = [boats, aurora, example];
const places = [].concat(...stations.filter((s) => !s.hidden).map((s) => s.places));
const c = createConcierge({ places, stations, fallbackPlace: 'boats:sydney' });
let fails = 0;
const ok = (cond, msg, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg + (cond ? '' : '  got: ' + JSON.stringify(extra))); if (!cond) fails++; };
const first = async (q, ctx) => (await c.ask(q, ctx))[0] || {};
const ids = async (q, ctx) => (await c.ask(q, ctx)).map((r) => r.placeId || r.kind + ':' + r.title);

ok(norm('Zürich  Opera-House!') === 'zurich opera house', 'normalises accents and punctuation');
let r;
r = await first('Sydney'); ok(r.placeId === 'boats:sydney', '"Sydney" -> Sydney Harbour', r);
r = await first('sydney harbour'); ok(r.placeId === 'boats:sydney' && r.score >= 85, '"sydney harbour" -> exact place', r);
r = await first('Matterhorn'); ok(r.placeId === 'aurora:swiss-alps:zermatt', '"Matterhorn" -> the Zermatt stop on the Swiss Alps tour', r);
r = await first('whales'); ok(r.placeId === 'boats:juneau', '"whales" -> Juneau (whale watching)', r);
r = await first('Alaska'); ok(r.placeId === 'boats:juneau', '"Alaska" -> Juneau', r);
r = await c.ask('reef'); ok(r[0].soon && r[0].title === 'Great Barrier Reef' && r[1] && r[1].placeId === 'boats:sydney', '"reef" -> Coming soon + nearest (Sydney)', r);
r = await c.ask('mariana trench'); ok(r[0].soon && r.length >= 2, '"mariana trench" -> Coming soon + something we have', r);
r = await first('superyachts'); ok(r.placeId === 'boats:monaco', '"superyachts" -> Monaco', r);
r = await first('take me to yosemite falls'); ok(r.placeId === 'aurora:yosemite:falls', '"take me to yosemite falls" -> the stop', r);
r = await first('the swiss alps'); ok(r.placeId === 'aurora:swiss-alps', '"the swiss alps" -> the tour', r);
r = await first('penguins'); ok(r.placeId === 'boats:antarctica', '"penguins" -> Antarctic Peninsula', r);
r = await first('caribbean'); ok(['boats:usvi', 'boats:nassau', 'boats:cozumel'].includes(r.placeId), '"caribbean" -> a Caribbean port', r);
r = await first('home'); ok(r.placeId === 'boats:cumberland', '"home" -> Old Hickory Lake', r);
r = await first('boats'); ok(r.station === 'boats', '"boats" -> the Boats station', r);
r = await first('ISS'); ok(r.soon && /ISS/.test(r.title), '"ISS" -> Coming soon (space)', r);
r = await c.ask('xyzzy plugh'); ok(r[0].soon && /Coming soon/.test(r[0].title) && r[1] && r[1].placeId === 'boats:sydney', 'unknown -> Coming soon + the default beautiful place', r);
r = await c.ask(''); ok(r.length === 0, 'empty -> nothing', r);
const targets = [{ id: 366999001, mmsi: 366999001, name: 'MSC ANNA', line: 'Container ship', tag: 'LIVE', station: 'boats' }, { id: 503123456, mmsi: 503123456, name: 'SIRIUS', line: 'Ferry', tag: 'LIVE', station: 'boats' }];
r = await first('msc anna', { targets }); ok(r.targetId === 366999001, 'ship name in the current station -> that ship', r);
r = await first('503123456', { targets }); ok(r.targetId === 503123456, 'MMSI -> that ship', r);
r = await c.ask('glacier'); ok(r.length >= 1 && r.length <= 3, '"glacier" -> 1 to 3 cards: ' + (await ids('glacier')).join(', '), r);
ok((await c.ask('a')).length <= 3, 'never more than 3 cards');
// the pipeline takes an extra (AI) step later: a confident rules answer stops there, an unknown goes on to the next step
let called = 0;
const c2 = createConcierge({ places, stations, steps: [(q, ctx) => import('../../shared/shell/concierge.js').then((m) => m.rulesStep(q, ctx)), async () => { called++; return [{ kind: 'place', title: 'AI pick', score: 40 }]; }] });
await c2.ask('Sydney'); ok(called === 0, 'pipeline: confident rules answer does not call the next step');
r = await c2.ask('somewhere quiet with dolphins at dusk'); ok(called === 1, 'pipeline: an unknown request reaches the next (AI) step', r);
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);

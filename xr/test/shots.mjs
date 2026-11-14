// node xr/test/shots.mjs [outdir] [only]  : headless screenshots of the shell (sim data, no network): each station, the EFB
// pages on screens, the Be There reveal, and the arrival moment. Default outdir /tmp/xr-shots.
import { serve, chrome } from './harness.mjs';
const OUT = process.argv[2] || '/tmp/xr-shots', ONLY = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await serve();
const shots = [
  ['example', '#station=example', null],
  ['boats-helm', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(4000); }],
  ['boats-chase', '#station=boats&area=sydney&sim=1&pov=chase', async (c) => { await sleep(4000); }],
  ['boats-efb-home', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(3000); await c.eval("__xr.openEFB('home')"); await sleep(600); }],
  ['boats-concierge', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(2000); await c.eval("__xr.openEFB('concierge'); for (const k of 'matterhorn') __xr.efb.key(k)"); await sleep(600); }],
  ['boats-globe', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(2000); await c.eval("__xr.openEFB('globe'); __xr.efb.state.globe.lat=-10; __xr.efb.state.globe.lon=140; __xr.efb.set({})"); await sleep(1200); }],
  ['boats-reveal-ship', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(4000); await c.eval("(()=>{const t=__xr.current.st.targets().find(x=>!x.here); __xr.openReveal && __xr.current.ctx.reveal(t);})()"); await sleep(4000); }],
  ['reveal-aurora', '#station=example', async (c) => { await sleep(1500); await c.eval("__xr.openReveal(__xr.placeReveal(__xr.concierge.places.find(p=>p.id==='aurora:swiss-alps')))"); await sleep(9000); }],
  ['aurora-deck', '#station=aurora&tour=swiss-alps', async (c) => { await sleep(6000); }],
  ['aurora-chase', '#station=aurora&tour=swiss-alps&pov=chase', async (c) => { await sleep(8000); }],
  ['aurora-yosemite-helm', '#station=aurora&tour=yosemite&pov=helm', async (c) => { await sleep(6000); }],
  ['vr-dock', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(3000); await c.eval("__xr.look.pitch=-0.75; __xr.look.yaw=0.5; __xr.vrPreview(true)"); await sleep(1200); }],
  ['vr-efb-open', '#station=boats&area=sydney&sim=1', async (c) => { await sleep(3000); await c.eval("__xr.vrPreview(true); __xr.access.open()"); await sleep(800); await c.eval("__xr.look.pitch=-0.25; __xr.look.yaw=0.1"); await sleep(1500); }],
  ['vr-efb-aurora', '#station=aurora&tour=new-zealand', async (c) => { await sleep(5000); await c.eval("__xr.vrPreview(true); __xr.access.open()"); await sleep(2000); }],
  ['arrival', '#station=example', async (c) => { await sleep(1500); await c.eval("__xr.blink.out(0.01); __xr.blink.arrive('Juneau, Alaska', true); __xr.blink.progress('Arriving · Juneau, Alaska · 64%')"); await sleep(1800); }],
];
for (const [name, hash, act] of shots) {
  if (ONLY && !name.includes(ONLY)) continue;
  const c = await chrome();
  await c.open(srv.url + '/xr/test.html?test=1' + hash);
  const ok = await c.waitFor('window.__xr && __xr.ready', 90000);
  if (act) await act(c);
  await sleep(800);
  await c.shot(`${OUT}/${name}.png`);
  const info = await c.eval('window.__xr ? JSON.stringify(__xr.info()) + " err=" + __xr.lastError : "no shell"');
  console.log((ok ? 'ok  ' : 'NOT READY ') + name + ' ' + info);
  const errs = c.logs.filter((l) => /^(error|exception)/.test(l) && !/Failed to load resource|ERR_|net::|tile|google|jsdelivr|relay|WebSocket|aisstream|arcgis|openstreetmap|open-meteo/i.test(l));
  if (errs.length) console.log('   console: ' + errs.slice(0, 4).join('\n   '));
  c.close();
}
srv.close();

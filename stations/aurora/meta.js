// Aurora tours station: the XR Aurora flying the Travel Desk tours (travel/<tour>/tour.js). What the shell knows before it
// loads: the tours and their stops (names must match the tour modules: xr/test/station-test.mjs checks).
export const DEFAULT_TOUR = 'swiss-alps';

export const TOURS = [
  { id: 'swiss-alps', name: 'The Swiss Alps', sub: 'Eiger, Jungfraujoch, the Matterhorn at sunrise', lat: 46.30, lon: 7.85,
    keywords: ['alps', 'switzerland', 'swiss', 'mountains', 'snow', 'glacier', 'europe'],
    stops: [['oeschinen', 'Lake Oeschinen', ['lake']], ['lauterbrunnen', 'Lauterbrunnen Valley', ['waterfall', 'staubbach']], ['eiger', 'Eiger North Face', ['eiger', 'climbing']],
      ['jungfraujoch', 'Jungfraujoch and the Aletsch Glacier', ['jungfrau', 'glacier']], ['aletsch', 'The Aletsch from above', ['glacier', 'aletsch']],
      ['zermatt', 'Zermatt and the Matterhorn at sunrise', ['matterhorn', 'zermatt', 'sunrise']], ['gornergrat', 'Gornergrat panorama', ['panorama', 'gornergrat']]] },
  { id: 'yosemite', name: 'Yosemite Valley', sub: 'El Capitan, Half Dome, Yosemite Falls', lat: 37.7456, lon: -119.5936,
    keywords: ['yosemite', 'california', 'national park', 'half dome', 'usa', 'granite'],
    stops: [['tunnel', 'Tunnel View', ['view']], ['elcap', 'El Capitan', ['el capitan', 'climbing']], ['falls', 'Yosemite Falls', ['waterfall']],
      ['taft', 'Taft Point', ['cliff']], ['glacier', 'Glacier Point', ['half dome']], ['mariposa', 'Mariposa Grove', ['sequoia', 'trees', 'giant sequoias']],
      ['tuolumne', 'Tuolumne Meadows', ['meadow']]] },
  { id: 'new-zealand', name: 'Fiordland and the Southern Alps', sub: 'Milford Sound, Aoraki / Mount Cook, Lake Tekapo', lat: -44.6, lon: 168.9,
    keywords: ['new zealand', 'fiordland', 'fjord', 'fiord', 'southern alps', 'nz'],
    stops: [['milford', 'Piopiotahi / Milford Sound', ['milford', 'fjord', 'fiord']], ['stirling', 'Stirling Falls', ['waterfall']], ['doubtful', 'Doubtful Sound / Patea', ['dolphins', 'fjord']],
      ['aoraki', 'Aoraki / Mount Cook', ['mount cook', 'mountain']], ['tasman', 'Haupapa / Tasman Glacier', ['glacier']], ['tekapo', 'Lake Tekapo under the stars', ['stars', 'night sky', 'milky way', 'southern lights']]] },
];

const meta = {
  id: 'aurora', name: 'XR Aurora tours', dept: 'travel', title: 'Fly the XR Aurora',
  blocks: ['ride', 'stops', 'targets', 'time', 'pov'],
  povs: [['deck', 'Observation deck'], ['helm', 'Helm'], ['command', 'Command'], ['bethere', 'Be There'], ['chase', 'Chase'], ['god', "God's eye"]],
  defaults: { tour: DEFAULT_TOUR },
  needs: { scenery: true },
  places: [].concat(...TOURS.map((t) => [
    { id: 'aurora:' + t.id, station: 'aurora', params: { tour: t.id }, name: t.name, sub: t.sub, lat: t.lat, lon: t.lon, keywords: t.keywords, tag: 'RENDERED', kind: 'tour' },
    ...t.stops.map(([sid, name, kw], i) => ({ id: 'aurora:' + t.id + ':' + sid, station: 'aurora', params: { tour: t.id, stop: String(i) }, name, sub: t.name + ' · stop ' + (i + 1),
      lat: t.lat, lon: t.lon, keywords: kw, tag: 'RENDERED', kind: 'stop', parent: 'aurora:' + t.id })),
  ])),
  module: () => import('./station.js'),
  // Be There reveal image: the XR Aurora herself (the founder's Meshy hull), drawn by the shell's hero renderer
  async hero(THREE, place, renderer) {
    const { loadHull } = await import('../../shared/aurora/hull.js');
    const h = await loadHull(renderer, { timeout: 20000 });
    const holder = new THREE.Group(); holder.add(h.root); holder.rotation.y = 1.9;   // three-quarter view from the bow
    return { object: holder, dispose: () => { if (h.envRT) h.envRT.dispose(); }, note: 'Rendered: the XR Aurora' };
  },
};
export default meta;

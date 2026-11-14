// Example station: the smallest complete station, to copy when you start a new one (see shared/shell/STATION_KIT.md).
// hidden: true keeps it off the globe and out of the concierge; it still opens from its link: /xr/#station=example
const meta = {
  id: 'example', name: 'Example station', dept: 'example', title: 'A quiet sea (template)', hidden: true,
  blocks: ['ride', 'stops', 'targets', 'pov'],
  povs: [['seat', 'Seat'], ['chase', 'Chase']],
  defaults: {},
  needs: { scenery: false },
  places: [{ id: 'example:sea', station: 'example', params: {}, name: 'A quiet sea', sub: 'The example station', lat: 0, lon: -30, keywords: ['example', 'template'], tag: 'RENDERED', kind: 'place' }],
  module: () => import('./station.js'),
};
export default meta;

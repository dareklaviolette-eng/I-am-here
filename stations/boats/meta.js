// Boats station: what the shell knows before the station loads (concierge, globe, links, the Be There reveal).
// The areas themselves (boxes, centres, notes) live in ais-core.js (generated from boats/index.html); ids here must match
// (xr/test/station-test.mjs checks). Order = beauty and wonder first, cargo ports at the bottom (maritime brief, Nov 14).

// The default start: the most beautiful place with live ships. One constant, change it here.
export const DEFAULT_AREA = 'sydney';

export const AREA_ORDER = [
  // [id, short name, sub line, lat, lon, keywords, hero ship kind]
  ['sydney', 'Sydney Harbour', 'Ferries, sailboats and cruise ships at the Opera House', -33.855, 151.22, ['opera house', 'australia', 'harbour bridge', 'ferry', 'ferries', 'sydney'], 'ferry'],
  ['juneau', 'Juneau, Alaska', 'Inside Passage: cruise ships and whale-watch boats (May to Sep)', 58.30, -134.42, ['alaska', 'inside passage', 'whales', 'whale', 'whale watching', 'glacier bay', 'humpback', 'orca', 'cruise'], 'cruise'],
  ['monaco', 'Monaco', 'Superyachts in Port Hercule and offshore', 43.735, 7.425, ['superyacht', 'superyachts', 'yacht', 'yachts', 'riviera', 'french riviera', 'grand prix', 'mediterranean'], 'yacht'],
  ['usvi', 'St. Thomas and St. John', 'US Virgin Islands: catamarans, ferries, cruise ships', 18.33, -64.88, ['caribbean', 'virgin islands', 'catamaran', 'st thomas', 'st john', 'beach', 'turquoise'], 'ferry'],
  ['nassau', 'Nassau, Bahamas', 'Cruise ships, ferries and tour boats', 25.07, -77.35, ['bahamas', 'caribbean', 'cruise', 'cruise ship'], 'cruise'],
  ['cozumel', 'Cozumel, Mexico', 'Cruise ships and the Playa del Carmen ferries', 20.48, -86.98, ['mexico', 'caribbean', 'cruise', 'dive', 'diving', 'playa del carmen'], 'cruise'],
  ['antarctica', 'Antarctic Peninsula', 'Expedition ships in the Gerlache Strait (Nov to Mar)', -64.80, -63.20, ['antarctica', 'antarctic', 'penguins', 'penguin', 'icebergs', 'expedition', 'polar'], 'cruise'],
  ['cumberland', 'Old Hickory Lake', 'Barge tows on the Cumberland River, Nashville', 36.27, -86.65, ['home', 'nashville', 'tennessee', 'old hickory', 'cumberland', 'lake', 'river'], 'tow'],
  ['newyork', 'New York Harbor', 'Ferries, tugs and container ships', 40.66, -74.05, ['new york', 'statue of liberty', 'manhattan', 'staten island ferry'], 'ferry'],
  ['gibraltar', 'Strait of Gibraltar', 'Between Spain and Morocco', 35.98, -5.55, ['gibraltar', 'spain', 'morocco'], 'container'],
  // cargo ports last (test links)
  ['losangeles', 'Los Angeles / Long Beach', 'Busiest US port: container ships and tugs', 33.70, -118.22, ['long beach', 'los angeles', 'port', 'cargo', 'container'], 'container'],
  ['rotterdam', 'Rotterdam', "Europe's largest port", 51.95, 4.15, ['rotterdam', 'netherlands', 'port', 'cargo'], 'container'],
  ['singapore', 'Singapore Strait', 'Hundreds of ships in the anchorages', 1.22, 103.85, ['singapore', 'strait', 'cargo', 'tanker'], 'tanker'],
  ['channel', 'Dover Strait', "The world's busiest shipping lane", 51.02, 1.42, ['english channel', 'dover', 'calais', 'channel'], 'ferry'],
  ['neworleans', 'New Orleans', 'Ocean ships and tows on the Mississippi', 29.94, -90.05, ['new orleans', 'mississippi', 'river'], 'tow'],
  ['houston', 'Houston Ship Channel', 'Tankers and tugs to Galveston Bay', 29.62, -95.02, ['houston', 'texas', 'tanker', 'galveston'], 'tanker'],
];

// hero ship for a kind (a stand-in vessel the ship kit can build; never presented as a real ship)
export const HERO_VESSEL = {
  ferry: { mmsi: 503000101, name: 'HARBOUR FERRY', shipType: 60, dims: { A: 30, B: 8, C: 5, D: 5 } },
  cruise: { mmsi: 311000102, name: 'EXPEDITION', shipType: 60, dims: { A: 220, B: 60, C: 18, D: 18 } },
  yacht: { mmsi: 215000103, name: 'SUPERYACHT', shipType: 37, dims: { A: 40, B: 12, C: 5, D: 5 } },
  container: { mmsi: 636000104, name: 'MSC HERO', shipType: 70, dims: { A: 220, B: 60, C: 20, D: 20 } },
  tanker: { mmsi: 538000105, name: 'TANKER', shipType: 80, dims: { A: 150, B: 40, C: 16, D: 16 } },
  tow: { mmsi: 367000106, name: 'RIVER TOW', shipType: 31, dims: { A: 150, B: 12, C: 16, D: 16 } },
};

const meta = {
  id: 'boats', name: 'Boats', dept: 'maritime', title: 'Ride a real ship',
  blocks: ['ride', 'stops', 'targets', 'time', 'pov'],
  povs: [['captain', 'Helm'], ['deck', 'Bow'], ['aft', 'Aft'], ['port', 'Port'], ['stbd', 'Starboard'], ['chase', 'Chase'], ['god', "God's eye"]],
  defaults: { area: DEFAULT_AREA },
  needs: { scenery: false },
  // concierge + globe entries
  places: AREA_ORDER.map(([id, name, sub, lat, lon, keywords, hero]) => ({ id: 'boats:' + id, station: 'boats', params: { area: id }, name, sub, lat, lon, keywords, hero, tag: 'LIVE', kind: 'area' })),
  module: () => import('./station.js'),
  // Be There reveal image for a place (no licensed photos yet): a 3D hero render of a typical ship there
  async hero(THREE, place, renderer) {
    const [{ createShipKit }, { AISCore }] = await Promise.all([import('./ships3d.js'), import('./ais-core.js')]);
    const holder = new THREE.Group();
    const kit = createShipKit(THREE, AISCore, { scene: holder, renderer, CAT_COLORS: {} });
    kit.sky.visible = false; kit.nearWater.visible = false; kit.farWater.visible = false;
    const v = HERO_VESSEL[(place && place.hero) || 'ferry'] || HERO_VESSEL.ferry;
    const m = kit.buildModel(v); m.label.visible = false; m.wake.visible = false;
    holder.add(m.group);
    return { object: holder, dispose: () => { kit.disposeGroup(m.group); kit.dispose(); }, note: 'Rendered: a typical ship here' };
  },
};
export default meta;

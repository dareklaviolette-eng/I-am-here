// I'M HERE XR station registry: every station the shell can jump to. A station is a folder stations/<id>/ with
//   meta.js     (light: names, blocks, POV seats, places for the concierge and the globe, how to load the station)
//   station.js  (export function createStation(ctx): the six calls of the station contract; loaded only on a jump)
// Adding a station = one folder + one line below. See shared/shell/STATION_KIT.md.
import boats from '../../stations/boats/meta.js';
import aurora from '../../stations/aurora/meta.js';
import example from '../../stations/example/meta.js';

export const STATIONS = [boats, aurora, example];
export const DEFAULT_STATION = 'boats';

export function getStation(id) { return STATIONS.find((s) => s.id === id) || null; }
export function allPlaces() { return [].concat(...STATIONS.filter((s) => !s.hidden).map((s) => s.places || [])); }
export function placeById(id) { return allPlaces().find((p) => p.id === id) || null; }
// a place for a station + params (for the globe pin "you are here", recent places)
export function placeFor(station, params) {
  const ps = allPlaces().filter((p) => p.station === station);
  const p = params || {};
  return ps.find((x) => x.params && Object.keys(x.params).every((k) => String(p[k]) === String(x.params[k])) && Object.keys(x.params).length === Object.keys(p).filter((k) => k !== 'pov' && k !== 'sim' && k !== 'mmsi').length)
    || ps.find((x) => x.params && Object.keys(x.params).every((k) => String(p[k]) === String(x.params[k])) && x.kind !== 'stop')
    || ps.find((x) => x.params && Object.keys(x.params).every((k) => String(p[k]) === String(x.params[k])))
    || null;
}

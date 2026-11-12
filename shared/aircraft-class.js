// I'M HERE: rough aircraft size class from the ICAO type designator (or the ADS-B emitter category when the type is missing).
// Pure module (no DOM, no three.js). Used by the plane-traffic layer (true-scale models) and the 737 page (GA rides list
// small airfields on the EFB). Lengths are typical overall lengths for the class, in metres.
//
// ADS-B emitter categories (DO-260B): A1 light (< 15,500 lb), A2 small, A3 large, A4 high-vortex large (757), A5 heavy,
// A6 high performance, A7 rotorcraft, B1 glider, B2 lighter-than-air, B4 ultralight, B6 UAV.

const GA = /^(C1\d\d|C2\d\d|C3\d\d|C4\d\d|C77R|P28|P32|P46|PA\d|SR2|S22T|BE\d|DA[1-6]|M20|TBM|PC12|PC6|AA[15]|RV\d|J3|DR40|TB[12]\d|LA4|GLAS|AT[3-8]P|AC\d\d|PTS|EV97|CRUZ|SIRA|ECHO|TAMPICO)/;
const HELI = /^(R22|R44|R66|EC\d\d|H\d\d|AS\d\d|AS3\d|B06|B407|B412|B429|B47G|S76|S92|A109|A119|A139|A169|AW\d\d|UH1|H60|EH10|BK17|MD52|MD60|NH90)/;
const HEAVY = /^(A30[0-9B]|A310|A3[3-5]\d|A38\d|B7[4678]\d|B7[4678][A-Z]|MD11|IL96|A124|AN22|C5M$|C17$|DC10|L101)/;
const NARROW = /^(B73|B3[7-9]M|B3XM|B75|A31\d|A32\d|A19N|A20N|A21N|BCS|E19|E29|MD8|MD9|B712|C919)/;
const REGIONAL = /^(E1[3-7]\d|E75|E170|CRJ|DH8|AT4|AT7|SF34|J41|D328|F100|F70|B462|RJ\d)/;
const BIZ = /^(C5\d\d|C25|C6\d\d|C7\d\d|C68A|C700|GLF|GL[5-7X]|GLEX|CL[36]\d|LJ\d|E5[05]P|E545|E550|F2TH|F900|FA\d|H25|PRM1|HDJT|PC24|SF50|EA50|BE40)/;

export const CLASS_LEN_M = { light: 8.5, heli: 12, biz: 20, regional: 30, narrow: 38, heavy: 64, unknown: 32 };

// -> 'light' | 'heli' | 'biz' | 'regional' | 'narrow' | 'heavy' | 'unknown'
export function sizeClass(type, category) {
  const t = String(type || '').trim().toUpperCase(), c = String(category || '').trim().toUpperCase();
  if (t) {
    if (HELI.test(t)) return 'heli';
    if (HEAVY.test(t)) return 'heavy';
    if (NARROW.test(t)) return 'narrow';
    if (REGIONAL.test(t)) return 'regional';
    if (BIZ.test(t)) return 'biz';
    if (GA.test(t)) return 'light';
  }
  if (c === 'A1' || c === 'B1' || c === 'B4') return 'light';
  if (c === 'A7') return 'heli';
  if (c === 'A5') return 'heavy';
  if (c === 'A3' || c === 'A4') return 'narrow';
  if (c === 'A2') return 'biz';
  return 'unknown';
}
export const lengthM = (type, category) => CLASS_LEN_M[sizeClass(type, category)];
// General aviation: light aircraft and helicopters (they use small airfields).
export const isGA = (type, category) => { const k = sizeClass(type, category); return k === 'light' || k === 'heli'; };

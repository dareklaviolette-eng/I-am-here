# Credits

Third-party assets used in I'M HERE.

## 3D models

- **Airbus A320 flight deck** (`737/models/airbus/airbus-cockpit.glb`, used for A320-family rides on the 737 page):
  "Airbus Cockpit Interior" by davidolaleye1
  (https://sketchfab.com/3d-models/airbus-cockpit-interior-06ca045e131b4cfdac76ddbd55ed3b4a),
  licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
  Changes: textures resized and converted to WebP, normal/roughness maps and window glass removed, meshes re-based to metres.
- **Boeing 737-800 flight deck** (`737/shell.gltf`): "Boeing 737-800 Cockpit" by hakai315
  (https://sketchfab.com/3d-models/boeing-737-800-cockpit-d463256f98654b36af019d2d88bd5bbe), CC BY 4.0, optimized.

## Data

- **Place names for the card's LOC row** (`shared/places/`, built by `shared/places/build-places.mjs`):
  - Shipped now: a small seed of the tz database's zone cities (`zone.tab`, public domain).
  - To be installed: GeoNames `cities1000.txt` or `cities500.txt` (https://download.geonames.org/export/dump/),
    CC BY 4.0, credit "GeoNames" (https://www.geonames.org/). Rebuild with
    `node shared/places/build-places.mjs geonames cities1000.txt`.
  - Until then, when the seed has no town nearby, LOC uses the nearest airfield's town from OurAirports (public domain).
- **Airports** (EFB nearest airports, LOC fallback): OurAirports (https://ourairports.com/data/), public domain.
- **Plane traffic layer** (737 page, `shared/layer-planes.js`): live ADS-B from airplanes.live, adsb.lol, adsb.fi, OpenSky
  (free, non-commercial terms; check before commercial use); Flightradar24 via the I'M HERE relay as the last fallback.

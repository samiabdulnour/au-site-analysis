# Data sources (all free, no API key, verified reachable)

The office's manual sources (Google Maps, smappen, NSW Planning Portal spatial
viewer, Nearmap) are replaced with programmatic equivalents:

| need | manual source | programmatic substitute |
|---|---|---|
| Geocoding | Google Maps | NSW Spatial `NSW_Geocoded_Addressing_Theme/FeatureServer/1` (AddressPoint) |
| Lot boundary (site) | Planning Portal | NSW Spatial `NSW_Land_Parcel_Property_Theme/FeatureServer/8` (Lot) |
| Rail corridor | — | same service, layer 7 (RailwayCorridor) |
| Zoning / HOB / FSR / Heritage | NSW Planning Portal spatial viewer | `mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer` — 0 Heritage, 1 FSR, 2 Land Zoning, 5 Height of Building |
| Aerial imagery | Nearmap / Google | NSW SIX `maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export` (bbox export, EPSG:3857) |
| POIs, streets, bus stops/routes, stations | Google Maps | OSM Overpass API (`overpass-api.de`) |
| Walking isochrones | smappen | Valhalla public server (`valhalla1.openstreetmap.de/isochrone`), pedestrian costing, 5/10 min |

Notes:

- All ArcGIS endpoints accept `f=geojson` on `/query`, and envelope
  (`geometryType=esriGeometryEnvelope`) or point intersect queries in
  EPSG:3857 (`inSR=3857&outSR=3857`).
- AddressPoint `address` field format: `26 CAMPSIE STREET CAMPSIE` (uppercase,
  full street-type word, no state/postcode). Ranged addresses (26-30) exist
  for some properties; otherwise expand the range to individual numbers.
- SIX imagery export: JPEG, tested at 512–4096 px. Mosaic if a request
  exceeds the service max size.
- Overpass and Valhalla are shared public infrastructure — keep request rate
  low (one call per generation) and set generous timeouts.

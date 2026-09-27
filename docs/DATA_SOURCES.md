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
| Streets, POIs, stations, parks | Google Maps | NSW Spatial Transport Theme + Features of Interest (see below) |
| Bus stops | Google Maps | TfNSW Trip Planner API `v1/tp/coord` (`TFNSW_API_KEY` in `.env`, free from opendata.transport.nsw.gov.au); fallback OSM Overpass |
| Bus route lines | Google Maps | OSM Overpass API (soft-fail) |
| Walking isochrones | smappen | Valhalla public server (`valhalla1.openstreetmap.de/isochrone`), pedestrian costing, 5/10 min |
| Contours (site sheet) | survey | NSW Spatial `NSW_Elevation_and_Depth_Theme/FeatureServer/2` (2 m); inside the City of Sydney, its `Terrain_Contours/FeatureServer/0` (1 m, 2020 aerial survey, CC BY 4.0) |
| Trees with a size (site sheet) | site visit / arborist | City of Sydney `Trees/FeatureServer/0` on `services1.arcgis.com/cNVyNtjGVZybOQWZ` (height, canopy spread, species; CC BY 4.0) inside the LGA; OSM `natural=tree` with `diameter_crown` / `height` / `circumference` where tagged; nominal 6 m otherwise |
| Kerbside parking, car parks | site visit | OSM `parking:*` road tags (both schemes), `amenity=parking`, `amenity=parking_space`; kerb position from the cadastral lots |
| Ground for sight lines | — | NSW SIX `public/NSW_5M_Elevation/ImageServer` (`getSamples` along the line, DFSI 2019) |
| Water bodies and coast (view targets) | — | NSW Spatial `NSW_Water_Theme/FeatureServer` — 6 HydroArea (named bays, rivers, lakes), 4 Coastline |

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

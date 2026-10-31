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
| Kerb lines (Kingfisher and Flamingo site sheets) | survey | Indicative, `src/lib/kerbs.ts`: a footpath's width out from the NSW cadastre's lot boundary on the street side; the width from OSM `footway=sidewalk` lines as Overture Maps republishes them (`theme=transportation/type=segment`, class `footway`, subclass `sidewalk`; ODbL) where mapped, else typical by the road's NSW function hierarchy (5 m arterial to 3.5 m local; a lane's kerb 0.6 m off the boundary), the corners rounded to a 3.5 m return; OSM `barrier=kerb` lines drawn as mapped. NSW publishes no kerbs or footpath edges as open data |
| Kerbside parking, car parks | site visit | OSM `parking:*` road tags (both schemes), `amenity=parking`, `amenity=parking_space`; kerb position from the cadastral lots |
| Ground for sight lines | — | NSW SIX `public/NSW_5M_Elevation/ImageServer` (`getSamples` along the line, DFSI 2019) |
| Services (site sheet) | BYDA enquiry | City of Sydney `Drainage_pipes`, `Drainage_pits`, `Light_poles` (`FeatureServer/0` on `services1.arcgis.com/cNVyNtjGVZybOQWZ`, CC BY 4.0) inside the LGA; Geoscience Australia `services.ga.gov.au/gis/rest/services/Electricity_Infrastructure/MapServer` 2 power lines, 0 substations (CC BY 4.0); OSM `power=line/minor_line/cable/substation/transformer`, `man_made=street_cabinet/pipeline`, `manhole=*` (ODbL). Trial, off by default (`SERVICES_TRIAL=endeavour`): Endeavour Energy `data.endeavourenergy.com.au` datasets `conductors_hv_lv_sl_ug`, `endeavourenergy_poles`, `networkassets_otherassets`, `distribution-substation-available-capacity` (labelled ODbL; the portal's terms say use only — licence to be confirmed). Licence-less or contradicted layers are left out on purpose (see `src/fetch/services.ts`) |
| Ownership pattern (capacity study) | title searches | NSW Spatial `NSW_Land_Parcel_Property_Theme/FeatureServer/12` (Property: one row per address, `propid`, `valnetpropertytype` 3 strata / 4 under a strata plan, `valnetlotcount`) with the Lot layer's `planlabel` (SP = strata plan); unit addresses per `propid` size each scheme |
| Plan registration date (capacity study) | NSW LRS plan search, paid | the Lot layer's `createdate`: the plan's registration date for every plan after the digital cadastre was built (all older plans carry 1993-09-07); a strata plan's date tells when its building went up or was converted |
| Council land (capacity study) | council asset register | City of Sydney `Parks/FeatureServer/0` (polygons) and `CouncilFacilities/FeatureServer/0` (points) on `services1.arcgis.com/cNVyNtjGVZybOQWZ`; State land from ePlanning `Planning_Portal_GPI/MapServer/302` |
| Development status (capacity study) | council DA tracker | City of Sydney `Development_Monitoring/FeatureServer/0` (polygons: `DA_Number`, `DevelopmentType`, `Status_1` Lodged / Approved / Construction Commenced / Completed, `Lodged`, `Determined`, `Completion`, `Priv_Dwgs`, `LevelsAbove`, `GFA`, `DateExtracted`); live applications from the Online DA API as the deck reads it |
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

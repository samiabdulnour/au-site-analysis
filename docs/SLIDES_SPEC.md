# Overall analysis slides (mode 4: `slides`) — specification and data study

The fourth mode is not a drawing sheet. It is the *content* part of a
feasibility study or architectural design report: the "Context" and "Site
Analysis" chapters that sit before the design, as A3 landscape pages that mix
a text column with small maps, diagrams, photo panels and tables.

The target was learned from an SSDA architectural design report (fjcstudio,
5 Blue Street North Sydney, Appendix F part 1, pages 15–32: *2. Context*,
*Site Analysis*, *Opportunities and Constraints*, plus the *Connecting With
Country* booklet appended to it).
The structure is the same one every office uses for this chapter, so the
slide set below is generic; only the graphic template is the office's.

This document does two things: it fixes the slide set the generator should
produce, and it records — endpoint by endpoint, verified on 2026-09-27 from
this repository's environment — which of that content can be fetched from the
web, which can be computed from what is fetched, and which has to stay
manual. `docs/DATA_SOURCES.md` lists what the three existing modes already
use; everything there carries over.

## 1. The reference deck, page by page

What each page of the sample carries, and how much of it a generator can do.
"Auto" means drawn or written from data without a person; "assist" means the
data is fetched and laid out but the person is expected to edit; "manual"
means a placeholder.

| p. | Page | What is on it | Verdict |
|---|---|---|---|
| 15 | CBD Level Analysis — Wider Site Context | ~15 km location map: suburbs, LGA wash, harbour, rail line, motorway, major centres as dots, 2/5 km circles round the site; 4 paragraphs of narrative | map auto; narrative assist |
| 16 | North Sydney Character | narrative; three photo strips: Place / Heritage / Landscape | photos assist (open-licence photos near the site); narrative assist |
| 17 | Planning Overview | 4 small maps: Land Zoning, Building Heights, Heritage, LMR context + SSDA projects; legends | auto |
| 18 | The CBD (aerial photo) | oblique aerial | manual (no free obliques); vertical aerial auto |
| 19 | Site Surroundings | precinct map: city core / Lavender Bay character areas, primary connections, station, numbered landmarks; narrative | map assist (character areas are drawn by hand); landmarks auto |
| 20 | North Sydney Local Planning Statement | council Public Domain Strategy extracts; narrative | manual (council PDFs), links auto |
| 21 | Topography and City Grid | street-grid diagram on aerial; long section across the precinct to the harbour with the skyline; narrative | grid auto; section auto from the 5 m DEM; skyline auto from building heights |
| 22 | Future Context — proposed development | four render thumbnails of approved towers; skyline model with approved envelopes | list of applications auto; renders manual; schematic envelopes auto |
| 23 | Future Context — section and 3D | section through the CBD core; 3D massing model | schematic auto; model manual |
| 24 | Height Plane Study | section, 3D of LEP height envelopes (RL 65 / RL 130 / 8.5 m / 12 m) | LEP envelopes auto (HOB in m and in RL); model view manual |
| 25 | Ground Plane Relationship | axonometric of station / plaza / retail levels; pedestrian links map; street photo | links map assist; axon manual |
| 26 | LEP Height Analysis | photos of a physical model | manual |
| 29 | Existing Site Condition | six site photos with a keyed plan | photos assist (street-level imagery), site visit manual |
| 30 | Site Analysis I | three diagrams: Urban Context (links, city core), Active links (active edges, green links, cycle), Green Connections (parks, walkability circles) | auto/assist |
| 31 | Site Analysis II | Urban Grid, Solar Amenity (sun path), Views (view sectors with named destinations) | auto |
| 32 | Opportunities and Constraints | two diagrams and two narratives | assist: the layers are automatic, the judgement is not |
| — | Connecting With Country (the booklet appended after p. 32) | acknowledgement, Country mapping (foreshore, ridgeline, walking track, engravings, national parks), traditional custodians, materials and pattern references | mapping partly auto (see §3.10); the cultural content is the office's with Knowledge Holders, never generated |

## 2. Format

- **A3 landscape, 420 × 297 mm** (the sample is 1191 × 842 pt), full bleed,
  one HTML page per slide, printed with the same headless Chromium as the
  sheets. Text column on the left (~30 %), figure field on the right; a
  fixed footer with the tool's name, the address and the page number.
- Composed in the active graphic template (`neutral`), so the deck matches
  the three sheets. Slide chrome is a new module beside `chrome.ts`; the map
  drawing code is the existing renderers at small scale, not new code.
- Outputs in `out/<slug>/`: `OVERALL_ANALYSIS.pdf`; `slides/NN_<name>.png`
  (one image per slide, for InDesign or PowerPoint); `overall.json` (every
  number and every fetched record, with source URL and retrieval time);
  `overall.md` (the narrative placeholders with the data sentences already
  written, for pasting into Word).
- Narrative: every slide in the reference carries 100–200 words of prose.
  The generator writes only what follows from data ("The site is 120 m from
  North Sydney Station and inside the 400 m TOD area…") and leaves the
  interpretive paragraph as a marked placeholder. It does not invent
  character.
- Options: `--type slides`, plus the existing `--scale`/`--rotate` where a
  slide reuses a sheet. Web: a fourth cell in the DRAWING row with a sample.

## 3. The slide set

Eighteen slides in two parts, in the order the reference uses. For each:
what is drawn, where it comes from (§4 has the endpoints), what stays manual.

### Part A — Context

**01 Location.** ~22 × 13 km window at 1:75,000, self-drawn from the
Administrative Boundaries, Water and Transport themes (the local government
areas as the land, the harbour and sea left blue, the bays and rivers, rail,
motorways and arterials, suburb names, the site's LGA washed), the site, 2
and 5 km rings, stations and the centres of The Sydney Plan nearest the site
(CBDs, major and activity centres). Text: suburb, LGA, the former planning
district and the region, distances to the CBD and the nearest centres and
stations (computed). *Manual:* the centres are a static table transcribed
from The Sydney Plan's Appendix D (no open layer exists; see §5). The DPE
light basemap was tried first and dropped: a cached tile service, its labels
come out too small at A3.

**02 Character.** Wikipedia summary paragraph for the suburb as the seed text;
the places within 1.5 km with articles of their own, numbered on the aerial
of the planning window; a strip of open-licence photographs within ~800 m
from Wikimedia Commons, each with its author and licence line (the
street-level frames of KartaView and Mapillary are slide 12's). *Manual:*
the office replaces the seed text with its reading and the photos with its
own.

**03 Planning overview.** Four maps at ~1:8000 from the ePlanning layers:
Zoning; Height of Building (in m *and* in m RL — North Sydney's map is RL
based, see §6); Heritage (LEP items, conservation areas, State Heritage
Register curtilages); and Housing policy: TOD sites, accelerated TOD
precincts, Town Centres (low- and mid-rise policy), SSD sites, planning
precincts and planning proposals on exhibition. Legends from the data.

**04 Planning controls at the site.** The development-summary controls plus
what the sheets do not carry: local provisions (design excellence, key sites,
active street frontages, sun access protection, centre maps), SEPP overlays
(Housing SEPP chapters that apply, BASIX climate zone, rail and metro corridor
protection zones, coastal and harbour catchment maps), contributions (SIC and
Housing and Productivity Contribution), the DCP with its PDF link, the
regional plan, the district, and the council's 5-year housing target. Every
row carries its legislation link. *Manual:* the land-use table (permitted and
prohibited uses) — legislation.nsw.gov.au cannot be read by a machine (§5).

**05 Strategic context.** The State Land Use Plan, the regional plan at the
point (The Sydney Plan since 13 August 2026, which replaced the Greater
Sydney Region Plan of 2018 and the five district plans; the 2041 regional
plans elsewhere), the council's LSPS from the Planning Portal's index of
every statement, the plan, the DCP, the contributions and the housing
target: names, one line each, status and links. *Manual:* the extracts, the
local housing strategy (not indexed) and any centre, precinct or public
domain strategy.

**06 Topography and grid.** Hillshade and contours from the 5 m DEM with the
road hierarchy over it; a section line chosen through the site along the
main fall (site to water where there is water) sampled from the DEM, drawn
as a profile with the site and RLs marked; the building skyline along the
same line from building heights (§4.9). Text: site RL range, fall, aspect.

**07 Development activity.** All applications within ~1 km lodged in the last
five years from the Online DA API, filtered to what shapes context (storeys ≥
4 or cost ≥ $5 M or dwellings ≥ 10): a map of dots coloured by status and a
table (address, type, storeys, dwellings, cost, status, lodged, determined).
Planning proposals on exhibition, TOD and accelerated precincts on the same
map. State significant applications from the Department's Major Projects
register join them as S-numbered diamonds (its listing and each project's
page, §7). A schematic future skyline is optional: storeys × 3.1 m at each
DA. *Manual:* renders.

**08 Built form and height planes.** Figure-ground with buildings classed by
height (Overture / OSM; the storeys of a determined DA on the lot where
neither has a height, hatched), the LEP height envelope at the site extruded from
the parcel (RL maps converted with the DEM), neighbours' heights, and the
section from slide 06 with the envelopes on it. *Manual:* 3D model views.

**09 Movement.** The context-sheet content at slide scale: stations incl.
Metro, bus stops (TfNSW key) and routes, walking isochrones, cycleways
(TfNSW dataset or OSM), pedestrian links, active frontages (LEP layer),
one-way streets and road hierarchy. Three small diagrams: Urban context,
Active links, Green connections (this is the reference's page 30).

**10 Green and public domain.** Tree canopy raster (2022) with the site's
canopy %, Green Grid assets, open space and parks with names, public
facilities, NPWS estate, water bodies. Walkability rings to parks.

### Part B — Site

**11 The site.** Site plan on the aerial; lot/DP, cadastral area, frontage
lengths, zone, HOB, FSR, heritage, easements (geometry only), land value
history (five annual values), recent sales within ~300 m, the existing
building's footprint, height and levels where recorded, imagery date, State
government and Crown parcels nearby.

**12 Existing site condition.** Street-level photographs facing the site
from Google Street View (with a key) and KartaView / Mapillary, keyed to a
plan by bearing; the 1943 aerial beside
today's for a then-and-now pair. *Manual:* the site visit replaces these.

**13 Grid, sun and views.** Urban grid orientation (dominant street bearings
from the road network); sun path diagram computed for the site (21 June and
21 December, hourly azimuth and altitude) with neighbouring building heights
as an overshadowing hint; view sectors by direction to named destinations
(water bodies, headlands, the CBD skyline, parks, landmarks from the place
and heritage layers) with the DEM deciding whether the ground rises or falls
that way.

**14 Environmental constraints.** Bushfire prone land, flood planning (where
an LEP maps it), acid sulfate soils, airport noise (where an LEP maps it),
coastal and riparian maps, scenic protection, mine subsidence, obstacle
limitation surface, soil landscape; rail corridor protection zone and road
hierarchy as noise sources. Each with "mapped / not mapped at this site" so
an absence is stated, not implied.

**15 Country.** The layers that exist: Local Aboriginal Land Council, native
title status (NNTT), gazetted Aboriginal Places nearby, pre-1750 plant
community at the site, soil landscape, watercourses and the foreshore,
ridgelines from the DEM, national parks and headlands, and a note that an
AHIMS search is required (the ASDST likelihood model is public; AHIMS is
not). *Manual, always:* the cultural narrative, language and place-name
content, which the office develops with Knowledge Holders.

**16 People and market.** ABS Census 2021 for the site's SA2 (and LGA):
median age, household and personal income, rent and mortgage, household
size, dwelling structure mix, tenure, method of travel to work; population
2001–2025 and the TZP24 projection to 2066; the council housing target;
land value trend and sales from slide 11; school catchments and enrolments.

**17 Opportunities and constraints.** Two diagrams assembled from the layers
already fetched (station and TOD proximity, active edges, open space, views,
solar orientation, heritage adjacency, corridor protection zones, hazards)
with a templated list of statements the person edits.

**18 Sources.** Every dataset used with its currency date, the imagery
capture date, the LEP map amendment dates, retrieval timestamps. Generated
from `overall.json`.

## 4. What can be fetched — verified endpoints

All reached from this repository's environment on 2026-09-27 with plain
HTTPS. "Key" says whether a credential is needed. The existing helpers
(`queryByExtent`, `queryByPoint`, `retryFetch`) fit everything marked ArcGIS.

### 4.1 NSW Planning Portal property API (no key)

The calls the Planning Portal Spatial Viewer itself makes. One request returns
every planning layer that touches a property, with legislation links.

```
GET https://api.apps1.nsw.gov.au/planning/viewersf/V1/ePlanningApi/address?a=5%20BLUE%20STREET%20NORTH%20SYDNEY
  -> [{ address, propId, GURASID }, …]            (substring match; pick the exact address)
GET …/ePlanningApi/layerintersect?type=property&id=<propId>&layers=epi
  -> zoning, height (value + units, e.g. 185 m(RL)), FSR, lot size, heritage item
     (number, name, significance), local provisions, land application, SHR
     curtilage, LALC, regional plan, tree canopy % 2019/2022, each with legislationUrl
GET …/ePlanningApi/layerintersect?type=property&id=<propId>&layers=sepp
  -> every SEPP and SEPP map that applies
GET …/ePlanningApi/boundary?id=<propId>&Type=property   -> property polygon (3857)
```

### 4.2 ePlanning ArcGIS services (no key) — `mapprod3.environment.nsw.gov.au/arcgis/rest/services`

Already used: `Planning/EPI_Primary_Planning_Layers` (0 Heritage, 1 FSR, 2
Zoning, 3 Land Reservation Acquisition, 4 Lot Size, 5 HOB, 6 Land
Application). New, all verified with a point or envelope query:

| Service | Layers of interest | Notes |
|---|---|---|
| `ePlanning/Planning_Portal_Principal_Planning` | 221 State Heritage Register curtilage, 16 EPI heritage, 14 HOB, 19 zoning, 22 min lot size, 25 min dwelling density, 26 foreshore building line | the viewer's own copies, same fields |
| `ePlanning/Planning_Portal_Development_Control` | 220 DCP by LGA (PLAN_NAME + FILE_NAME = PDF URL), 219 contributions plan by LGA, 218 SIC, 223 local provisions, 224 active street frontages, 769 active frontages map, 225 additional permitted uses, 226 key sites, 227 urban release area | DCP link verified for North Sydney |
| `ePlanning/Planning_Portal_Local_Provisions` | 200 LEP local-provision map types: design excellence, sun access protection, built character, special character areas, incentive height/FSR, affordable housing, centre maps, airport buffer… | `identify` at a point returns whichever apply |
| `ePlanning/Planning_Portal_Hazard` | 229 bushfire prone land, 230 flood planning map, 232 landslide risk | flood planning holds only 12 EPIs' maps (622 polygons statewide); most Sydney councils keep flood maps outside the LEP |
| `ePlanning/Planning_Portal_Protection` | 234 acid sulfate soils, 235 airport noise, 236 drinking water catchment, 237 groundwater vulnerability, 239 obstacle limitation surface, 240/1024 riparian, 241 salinity, 242 scenic protection, 243 terrestrial biodiversity, 244 wetlands, 245 environmentally sensitive land, 365 NPWS estate | airport noise holds 5 EPIs; Sydney Airport's ANEF is not among them |
| `ePlanning/Planning_Portal_SEPP` | 348 layers: TOD Sites Map, Accelerated TOD Precincts, Town Centres Map, Low and Mid Rise Housing Exclusion Map, Sydney Metro Corridor Protection Zone, Sydney Trains Corridor Protection Zone, Foreshores and Waterways Area, Strategic Foreshore Sites, SEPP 19 bushland, BASIX climate zones, coastal maps, growth centres, precinct SEPP maps | `identify?layers=all` at the site returned 17 hits |
| `Planning/SEPP_Housing_2021` | 3 TOD Sites Map (PRECINCT, lot LABEL), 4 Accelerated TOD Precincts, 5 Deferred TOD, 6 Town Centres Map, 2 STRA | TOD verified at Turrella |
| `Planning/SEPP_Planning_Systems_2021` | 3 State Significant Development Sites, 2 State and Regional Development subject land | Luna Park, Opera House, Darling Harbour in the test window |
| `Planning/SEPP_Transport_and_Infrastructure_2021` | 3 interim rail corridor, 4 Sydney Metro West tunnel, 5–7 CBD Metro zones and station extents, 8–10 HOB/zoning/special provisions | |
| `Planning/SEPP_Resilience_and_Hazards_2021` | coastal wetlands, littoral rainforest, coastal environment and use areas | |
| `Planning/SEPP_Precincts_Eastern_Harbour_City_2021` (and Central River, Western Parkland, Regional) | precinct FSR, zoning, HOB, GFA, additional permitted uses | |
| `Planning/DPIE_PlanningPrecincts` | 0 planning precinct points with Status, 4 precinct polygons, 5 district boundary, 6 LALC, 1–3 railway/motorway/primary road | |
| `Planning/Administrative_Boundary` | 1 planning district (NORTH at the sample), 2 regional growth boundary, 0 SIC | |
| `ePlanning/Planning_Portal_Tree_Canopy` | 1 canopy 2022, 0 canopy 2019 | `identify` gives canopy %; `export…&layers=show:1&transparent=true` gives the raster as PNG |
| `ePlanning/Planning_Portal_Public_Spaces` | 252 Green Grid existing green assets (name, class, District/Regional significance), 260 open space, 262 public facilities | |
| `ePlanning/Planning_Portal_Contributions` | 148/416/180 Housing and Productivity Contribution zones, 218 SIC, 219 contribution plans | |
| `ePlanning/Planning_Portal_GPI` | 302 State government land parcels (lot refs, area) | |
| `ePlanning/Planning_Portal_Crown_Land` | 258 Crown land, 312 reserves, 313 leases, 314 licences | |
| `ePlanning/Planning_Portal_Subsidence_Advisory` | 248 mine subsidence district | |
| `ePlanning/Planning_Proposal_Public`, `Planning_Proposal_Deferred` | planning proposals on exhibition, by LEP map type | none near the sample site at the time |
| `ePlanning/SydneyTrain_ISEPP` | 1 corridor protection zone, 2 infrastructure protection zone, 0 level crossings | |
| `HMS/Heritage` | 6 State Heritage Register polygons (ITEMNAME, ADDRESS, LISTINGNO, LISTING_DATE, PLANNO, TYPE), 9 LEP items (H_ID, H_NAME, SIG), 14 s170 registers, 16 SEPP heritage, 8 Aboriginal Places, 3/7 interim heritage orders, 12 NPWS estate, 19 world heritage, 0 a statewide POI layer (schools, parks, churches, shopping centres, post offices, courts) | the SHI item pages (`hms.heritage.nsw.gov.au`) sit behind a WAF: use the register attributes, link only |
| `Cultural/Aboriginal_Sites_Decision_Support_Tool_ASDST` | likelihood, accumulated impact and survey-priority rasters | public model; not AHIMS |
| `Soil_Landscape/Sydney` | soil landscape name, process (GYMEA, erosional at the sample) | `identify` |
| `Soil/AcidSulfateSoilRisk_*` | ASS risk | |
| `VIS/SVTM_NSW_1750_PCT` (and `_Extant_PCT`) | pre-1750 plant community type, class and formation (PCT 3594 Sydney Coastal Sandstone Foreshores Forest at the sample) | `identify`; "Not classified" where the model has no answer |
| `Fire/BFPL` | bushfire prone land, category | `identify` and `export` verified |
| `Tenure/NPWS_AllManagedLand`, `Tenure/Land_Tenure_NSW` | reserves, tenure | |
| `Basemap/DPEBasemap` | light grey/blue basemap | `export…&f=image` verified: the right base for slide 01 |
| `Planning/DA_Tracking`, `Planning/Planning_Portal_Application_Tracking` | 321 k DA/CDC records with storeys, dwellings, cost, X/Y | **stale: nothing after 2023-04-29**; use §4.3 |

Query shapes (all ArcGIS REST):

```
…/MapServer/<layer>/query?where=1%3D1&geometry={"x":151.2073,"y":-33.8412,"spatialReference":{"wkid":4326}}
   &geometryType=esriGeometryPoint&inSR=4326&outFields=*&outSR=4326&returnGeometry=false&f=json
…/MapServer/identify?geometry={"x":…,"y":…}&geometryType=esriGeometryPoint&sr=4326&layers=all
   &tolerance=2&mapExtent=<w,s,e,n>&imageDisplay=400,400,96&returnGeometry=false&f=json
…/MapServer/export?bbox=<3857>&bboxSR=3857&imageSR=3857&size=800,800&format=png32&transparent=true&f=image
```

### 4.3 Online DA API (no key) — the current development activity

```
GET https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA      (and …/OnlineCDC)
headers: PageSize: 100   PageNumber: 1
         filters: {"filters":{"CouncilName":["North Sydney Council"],"LodgementDateFrom":"2024-01-01","LodgementDateTo":"2026-09-27"}}
```

Parameters travel in **headers**, not the query string (a query string gets
`Required parameters for OnlineDA endpoint is not met`). Filters per the data
dictionary (`online-da-api-v2.0.pdf` on the Planning Portal open data site):
`CouncilName[]`, `ApplicationType`, `DevelopmentCategory[]` (Residential,
Commercial, Industrial, Recreational, Other), `ApplicationStatus[]`,
`CostOfDevelopmentFrom/To`, `LodgementDateFrom/To`. Records carry
`PlanningPortalApplicationNumber`, status, type, dates, `CostOfDevelopment`,
`NumberOfNewDwellings`, `NumberOfStoreys`, `DevelopmentType[]`,
`DeterminationAuthority`, `Location[]` with `X`/`Y`, address and `Lot`/`PlanLabel`.
Updated daily; covers everything lodged on the portal since 2019 (all
councils since July 2021). 132 applications came back for North Sydney
Council for June–September 2025. There is no spatial filter, so filter by
council and date and clip to the window locally. `PageSize` 2000 is accepted
and the body carries `TotalCount`: 9,794 records for the Council of the City
of Sydney over five years, five pages at about 7 s each; North Sydney 2,210,
Inner West 8,026, Bayside 2,945. `CouncilName` must be the dictionary's
spelling ("Council of the City of Sydney", "Inner West Council"); an unknown
name returns an empty page, not an error.

### 4.4 NSW Spatial Services (no key) — `portal.spatial.nsw.gov.au/server/rest/services`

Already used: addressing, cadastre lots, rail corridors, transport theme
roads and rail, FOI points and areas, elevation contours. New:

| Layer | Use |
|---|---|
| `NSW_Administrative_Boundaries_Theme/FeatureServer` 1 LocalAboriginalLandCouncil, 2 Suburb, 8 LGA, 5 Parish, 7 MinesSubsidenceDistrict, 12–15 ABS SA4–SA1 | slide 01, 15, 16 |
| `NSW_Land_Parcel_Property_Theme/FeatureServer` 9 Easement (geometry, no purpose text), 12 Property, 1 RoadCentreline | slide 11 |
| `NSW_FOI_Transport_Facilities/FeatureServer/1` | stations, Metro included (Victoria Cross came back) |
| `NSW_Water_Theme/FeatureServer` 6 HydroArea, 2 NamedWatercourse, 5 HydroLine | water for slides 01, 10, 15 |
| `NSW_FOI_Education_Facilities`, `_Health_Facilities`, `_Emergency_Service_Facilities` | amenity by function |
| `Hosted/TfNSW_Offstreet_Parking_Public`, `Hosted/NSW_BushFire_Prone_Land` | listed, not tested |
| `https://portal.spatial.nsw.gov.au/tileservices/Hosted/HistoricalImagery1943/MapServer/tile/{z}/{y}/{x}` | the 1943 Sydney aerial as Web Mercator PNG tiles; level 18 (about half a metre a pixel) is the finest that answers — 19 is a 404 — and there is no tile outside the Sydney region (`export` is not offered). In use on slide 12 |

### 4.5 SIX Maps (no key) — `maps.six.nsw.gov.au/arcgis/rest/services/public`

| Service | Use |
|---|---|
| `NSW_5M_Elevation/ImageServer/getSamples?geometry={"paths":[[[lon,lat],…]],"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPolyline&sampleCount=200&returnFirstValueOnly=true&f=json` | elevation profile along any line: sections, fall, RL of the site, conversion of RL height limits to metres above ground. For a whole window ask `exportImage` for `format=tiff&pixelType=F32` instead: one uncompressed tiled float GeoTIFF (1.3 MB, five seconds for 559 × 459 cells), where `getSamples` on a thousand-point multipoint takes twenty seconds. The service also renders a `Hillshade` rendering rule server-side; the model is photogrammetric (DFSI 2019), so railway cuttings and big roofs leave marks in it |
| `NSW_Imagery_Dates/MapServer/identify` | capture date and resolution of the aerial at the site (16/02/2022, 7 cm at the sample) — the caption every aerial should carry |
| `Valuation/MapServer` 9 Urban Property Boundary (`identify` → `propid`), 5 Urban Property Valuations (`where=propid=…` → five annual land values `val1_lv…val5_lv` with base dates, zone, valuation basis), 1 Urban Property Sales (by envelope: price, `sale_date`, area, strata flag, address) | slides 11 and 16; the Valuer General's own site blocks automation, this does not. Several property polygons can overlap at one point (strata schemes, stratum lots), so pick by the site's address and prefer a non-stratum basis; values come as text (" $381,000"), `prop_area` is blank for a stratum, `sale_date` reads "16 July 2026", `strata` holds the scheme's propid (0 when not strata) and `deal_props` > 1 marks a multi-property dealing whose price is the whole dealing's |
| `NSW_Base_Map`, `NSW_Topo_Map` `/export` | topographic-style alternatives to the DPE basemap |
| `NSW_POI/MapServer/0` | points of interest |

### 4.6 Statistics — ABS (no key)

- Boundaries and lookups: `https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/{SA1,SA2,SA3,LGA,SAL,POA}/MapServer/0/query` by point → codes and names (SA2 121041417 "North Sydney - Lavender Bay" at the sample).
- Data: the SDMX API at **`data.api.abs.gov.au`** (the other hostname,
  `api.data.abs.gov.au`, is refused by this environment's proxy). Send
  `Accept: application/vnd.sdmx.data+json`.

```
…/rest/data/ABS,C21_G02_SA2,1.0.0/.121041417..?dimensionAtObservation=AllDimensions
   -> medians: age 38, personal income $1,683/wk, household income $2,709/wk,
      rent $600/wk, mortgage $2,850/mo, household size 1.9 (sample SA2)
…/rest/data/ABS,C21_G36_SA2,1.0.0/..121041417..     dwelling structure
…/rest/data/ABS,C21_G37_SA2,1.0.0/..121041417..     tenure and landlord type
…/rest/data/ABS,C21_G62_SA2,1.0.0/..121041417..     method of travel to work
…/rest/data/ABS,C21_G01_SA2,1.0.0/..121041417..     selected person characteristics
…/rest/data/ABS,ABS_ANNUAL_ERP_ASGS2021/ERP.SA2.121041417.A   population 2001 onwards
```

The key is positional: G02 has four dimensions (`MEDAVG.REGION.REGION_TYPE.STATE`),
the other census tables five, so the SA2 code sits in the second or third slot:
G36 `.D.<code>..` (dwellings, not persons), G37 `._T.<code>..` (all dwelling
structures), G62 `.3.<code>..` (persons), G01 `3..<code>..`. The SA2+ flows
answer the capital-city codes too (`1GSYD` Greater Sydney, `1RNSW` the rest
of the state), so the benchmark is one more key in the same flow; LGAs have
their own flows (`C21_G02_LGA` and so on, keyed by the 2021 LGA code).
Every table also exists as `_SAL` (suburb) and `_POA`.

Learned in use: leave the version segment empty (`ABS,<flow>,/<key>`) to get
the latest — `ABS_ANNUAL_ERP_ASGS2021` is at 1.2.0 and `1.0.0` returns a 404;
in SDMX-JSON 2.0 the structure sits at `data.structures[0]`, not `structure`.
The LGA population series is re-issued each year as its own flow
(`ERP_LGA2025`, key `ERP..<lga>.A`). SEIFA 2021 is published:
`ABS_SEIFA2021_SA2` (and `_LGA`, `_SAL`, `_POA`, `_SA1`) with key
`<code>.IRSAD+IRSD+IER+IEO.SCORE+RWAD+RWSD` — score, decile within Australia,
decile within the state. Census night (10 August 2021) fell in Sydney's
lockdown: two thirds of North Sydney's workers "worked at home" and public
transport is a fraction of its normal share, so the travel table is a
lockdown snapshot and the slide says so.

### 4.7 Projections, targets, schools, transport files

| Source | What | How |
|---|---|---|
| TfNSW Open Data, TZP24 | population and dwellings 2021–2066 by travel zone and by LGA | CSV downloads (LGA file 36 KB; TZ population file 3.3 MB); no key. The travel-zone file carries `SA2_CODE21` and `LGA_NAME21`, so an SA2 projection is the sum of its zones (20 zones for North Sydney - Lavender Bay); the LGA file names LGAs the ABS way ("Bayside (NSW)") |
| planning.nsw.gov.au | the council's 5-year housing target and the ABS headline numbers | `…/the-planning-system/housing/housing-targets/<lga-slug>-councils-snapshot` (North Sydney: 5,900 homes by 2029); 43 councils only; an HTML page, so keep a static table as the fallback |
| data.nsw.gov.au | school intake zones (8.4 MB shapefile); master dataset of school locations and enrolments (CSV/JSON) | downloads, cache monthly. The master dataset (1.3 MB CSV, 2,210 government schools) has latitude and longitude, `latest_year_enrolment_FTE`, `Level_of_schooling`, `Selective_school`, `ICSEA_value` — used by slide 16; non-government schools are not in it |
| TfNSW Open Data | cycleway network shapefile, statewide, updated monthly (12.6 MB) | download, cache monthly; or OSM `highway=cycleway` / `cycleway=*` |
| TfNSW Trip Planner and traffic-volume APIs | stop departures and service frequency; traffic counts | the existing `TFNSW_API_KEY` |

### 4.8 Photographs and text (no key unless stated)

| Source | What | Notes |
|---|---|---|
| Wikimedia Commons `w/api.php?action=query&list=geosearch&gscoord=<lat>|<lon>&gsradius=800&gsnamespace=6` then `prop=imageinfo|coordinates&iiprop=url|extmetadata|size|mime&iiurlwidth=1024` | open-licence photos near the site with author and licence | send a descriptive `User-Agent`; the shared address is rate-limited (429) even so, so the calls are paced and retried. Attribution is a condition of the licence: printed under each photo. In use on slide 02 |
| Wikipedia `api/rest_v1/page/summary/<Title>` and `w/api.php?action=query&list=geosearch` then `prop=description` for the titles | the suburb summary paragraph and its lead image; articles within 1.5 km as the named places (a place vocabulary keeps companies, electorates and people out) | same User-Agent rule and the same 429s. In use on slide 02 |
| KartaView `POST https://api.openstreetcam.org/1.0/list/nearby-photos/` (`lat`, `lng`, `radius`, `ipp`); the v2 `photo/?lat=&lng=&radius=` search refuses radii over 150 m | street-level frames with camera position, heading, date, contributor and thumbnail paths | no key; coverage is patchy and old in places (2019 at the samples, one contributor); about half the frames carry no heading, so the direction of travel between a frame's neighbours in its sequence stands in. In use on slide 12 |
| Mapillary `https://graph.mapillary.com/images?bbox=…&fields=id,thumb_1024_url,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,creator,sequence,is_pano` | dense recent street-level imagery | free client token from the Mapillary developer page, sent as `access_token`; reachable, refuses without a token (HTTP 500, "Invalid OAuth 2.0 Access Token"). Graph API v4: `bbox` is left,bottom,right,top and must be under 0.01 square degrees (a 250 m radius is a four-hundredth of that), 2,000 images a call at most, 10,000 searches a minute per app; the structure-from-motion position and heading are preferred to the camera's own and 360° frames skipped. Read on slide 12 when `MAPILLARY_TOKEN` is set; checked against the documentation, not exercised here (no token) |
| Google Street View Static API (`streetview/metadata`, free, and `streetview` images) | best coverage | a Google Cloud key with billing (10,000 images a month free, then US$7 a thousand); Google's terms bar print and storing images outside its services. `src/fetch/streetView.ts` probes 12 m out from each side of the site, lets the metadata service say which sides face a street, and frames each frontage; the cadastre and the footprints set aside panoramas inside another lot or building (the service's "outdoor" takes in some shop interiors) and views through a neighbour. Read on slide 12 when `GOOGLE_MAPS_API_KEY` is set; exercised at the six samples in September 2026 |

### 4.9 Building heights

| Source | Result at the sample (1.5 × 1.7 km window) | Notes |
|---|---|---|
| Overture Maps buildings, GeoParquet on S3 (`s3://overturemaps-us-west-2/release/<release>/theme=buildings/type=building/`) via DuckDB `read_parquet` with a bbox predicate | 2,615 footprints, 690 with `height`, 1,177 with `num_floors`, tallest 158 m | 103 s cold through this environment's proxy; in production either cache the Sydney extract on the volume or run the query once a month. The `overturemaps` CLI returned nothing through the proxy; DuckDB worked |
| OSM `way["building"]` with `height` / `building:levels` | the site sheet already fetches this | public Overpass mirrors were all down at test time; the local Overpass the deployer installs is the answer |

Where neither has a height, the storeys of a determined application on
the footprint's cadastral lot (slide 07's feed) stand in, and the slide
says so: the map hatches those footprints over their band, the legend
counts them, the section dashes them and labels them "(DA)", and slides
11, 13, 17 and 18 carry the provenance where they quote or count a height.
Only determined, unrefused applications count (a proposal under assessment
belongs to slide 07), the latest determination on the lot speaks for it,
and a footprint under 60 m² takes no more than three storeys from it, so a
tower's consent does not stand on the shed beside it. Against the North
Sydney window's 31 footprints that carry both, the application's storeys
are within one of the source's 84 % of the time. The fallback is modest:
13 of Waterloo's 424 footprints without a height, 7 of Marrickville's 366,
39 of North Sydney's 657, 5 of Botany's 197 and 10 of Orange's 398 (2 to
6 %). A default by zone is not drawn: the footprints still without a height
stay grey, and the text gives the height limits over them and the zones
they stand in instead (510 of North Sydney's 618 stand under an 8.5 m
limit, two storeys at most; 190 of Orange's 388 under 12 m), which bounds
them without inventing a height. `test/heights.mts` checks the selection
on made-up lots.

### 4.10 Country

| Source | What |
|---|---|
| Administrative Boundaries 1 / DPIE_PlanningPrecincts 6 | Local Aboriginal Land Council (METROPOLITAN at the sample) |
| NNTT `https://services2.arcgis.com/rzk7fNEt0xoEp3cX/ArcGIS/rest/services/NNTT_Custodial_AGOL/FeatureServer` 6 determinations, 7 registered claims, 4 ILUAs, 0 prescribed bodies corporate | native title status by point (none at the sample, as expected in Sydney) |
| HMS/Heritage 8 | gazetted Aboriginal Places |
| VIS/SVTM_NSW_1750_PCT, Soil_Landscape/Sydney, Water theme, DEM ridgelines, NPWS estate | the pre-colonial landscape layers the reference maps by hand |
| ASDST | a public likelihood model; the slide states that an AHIMS search is required and that AHIMS itself is not open |

### 4.11 Climate

Open-Meteo archive (ERA5): `https://archive-api.open-meteo.com/v1/archive?latitude=&longitude=&start_date=2023-01-01&end_date=2023-12-31&hourly=wind_speed_10m,wind_direction_10m&timezone=Australia%2FSydney` → 8,760 hourly rows for a wind rose, no key. The climate-normals endpoint is rate-limited per IP (it refused from this shared address); the Bureau of Meteorology blocks scripted access outright. The sun path needs no fetch: it is a computation from latitude, longitude and date (SunCalc-style).

## 5. What cannot be fetched, and what to do instead

| Content | Why not | Instead |
|---|---|---|
| Land-use table (permitted / prohibited uses), zone objectives, clause text | `legislation.nsw.gov.au` sits behind a Cloudflare bot check that also stops headless Chromium; AustLII likewise | print the legislation link the API gives for every control; the person pastes the table |
| State Significant Development applications (the Major Projects register) as a feed | a Pega case system with no open feed; the tracker's JSON of every project (`/state-significant-projects-spatial-data`) answered 503 through September 2026 | the register's HTML listing and project pages, parsed and cached (slide 07, §7); SSD *sites* from the SEPP layer |
| Site visit photographs, oblique aerials, renders, physical-model photos, 3D views | not data | placeholders sized for them; street-level and 1943 imagery as stand-ins |
| The reference's character areas (its site-surroundings page: "city core", "Lavender Bay", the precinct edges) | a designer's judgement about how places read, not a dataset; no one publishes it | the evidence is on the slides — the zones and heritage conservation areas (03), the height bands (08), the 1943 and today pair (12), the named places (02) — and the boundaries are drawn by hand over them; that page's landmarks, connections and station are slides 02 and 09 |
| Council strategies (LSPS, housing strategies, public domain strategies, character statements), DCP text | the Planning Portal indexes every council's LSPS as an HTML page of links (128 in September 2026), which slide 05 parses; the other strategies are PDFs on council sites with no index; only the DCP has a mapped link | the LSPS by parsing; the rest by hand, with rows left for them on slide 05 |
| Metropolitan, major and activity centres as a layer | The Sydney Plan (2026) publishes its network of centres as a map and types them LGA by LGA in Appendix D, not as data | a static list of the 30 centres (three CBDs, thirteen major, fourteen activity) and four emerging activity centres, with a point each, in `src/data/centres.ts` |
| Sydney Airport ANEF, most councils' flood maps | not in the ePlanning layers (5 and 12 EPIs respectively) | state "not mapped in the LEP" and point to the council flood study; ANEF by hand |
| Geology | Geoscience Australia refused this proxy (403), GSNSW's GeoServer exposes no geology in its default workspace, SEED's API answered empty | soil landscape stands in; geology by hand |
| AHIMS Aboriginal sites | registered users only, by law | the note on slide 15 |
| Nation / language boundaries | the AIATSIS map is not open data | LALC and NNTT are the open proxies; the name of Country comes from the council's acknowledgement, kept in the curated LGA table |
| Easement purposes, title, ownership, strata | NSW LRS, paid | easement geometry only, flagged "purpose unknown" |
| Utilities (water, sewer, power) | not open beyond OSM fragments | BYDA remains manual |
| Heritage inventory pages (statement of significance, photos) | `hms.heritage.nsw.gov.au` answers 403 from a server | register attributes from the ArcGIS layer; link the page |

## 6. Things learned on the way

- **Height of Building in RL.** North Sydney's HOB map is in `m(RL)` (75 and
  185 m RL at the sample), not metres above ground. The API reports the
  units; the DEM profile turns an RL limit into a height above the site.
  The development summary should print the unit too.
- **`DA_Tracking` is a 2023 snapshot.** Its maximum lodgement date is
  2023-04-29. The Online DA API is the live source.
- **Two ABS hostnames.** `data.api.abs.gov.au` works, `api.data.abs.gov.au`
  does not through the proxy used here.
- **Wikimedia wants a User-Agent.** Anonymous requests from a shared address
  are throttled at once.
- **`prop_area` can be blank** in the Valuation layer for stratum lots.
- **`layers=all`** on the property API returns nothing; ask for `epi` and
  `sepp` separately.
- **Overpass** public mirrors were unreachable throughout the test; the local
  Overpass is not optional for this mode either.
- **Request budget.** A full deck is roughly 60–80 requests: ~35 ArcGIS
  queries and 6 raster exports, 2–5 DA API pages (cached a day per
  council), 6 ABS calls, 3 Wikimedia
  calls, one Open-Meteo call, one DEM profile, and the buildings query. It
  is the same serial queue and the same courtesy toward the same free
  services as the sheets; the buildings and cycleway extracts should be
  cached on the volume, not fetched per deck.

## 7. Status

Implemented: all eighteen slides — 01 (location), 02 (character), 03
(planning overview), 04 (planning controls), 05 (strategic context), 06
(topography), 07 (development activity), 08 (built form), 09 (movement), 10
(green and public domain), 11 (the site), 12 (existing site condition), 13 (grid, sun and views), 14
(environmental constraints), 15 (Country), 16 (people and market), 17
(opportunities and constraints) and 18 (sources) —
`src/render/slides.ts`, `src/render/minimap.ts`, `src/render/charts.ts`,
`src/render/terrainMap.ts`, `src/fetch/planning.ts`, `src/fetch/terrain.ts`,
`src/fetch/buildings.ts` with `src/py/overture_buildings.py`,
`src/fetch/movement.ts`, `src/fetch/greenSpace.ts`, `src/fetch/constraints.ts`, `src/fetch/site.ts`, `src/fetch/photos.ts`,
`src/fetch/location.ts` with `src/data/centres.ts`, `src/fetch/character.ts`, `src/fetch/strategies.ts`,
`src/lib/solar.ts` and `src/lib/shadows.ts` with the plan sheet's `src/fetch/views.ts`,
`src/fetch/country.ts` with `src/lib/ridges.ts`,
`src/fetch/da.ts`, `src/fetch/abs.ts`, `src/fetch/tzp24.ts`,
`src/fetch/valuation.ts`, `src/fetch/schools.ts` (gathered by
`src/fetch/people.ts`), `runSlidesPipeline` in `src/pipeline.ts`; `--type
slides` on the CLI and the `slides` drawing on the web. The maps use the
statutory LEP colours read from the ePlanning renderers
(`src/render/lepPalette.ts`).

Slide 01 draws its own location map rather than a basemap picture
(`src/fetch/location.ts`): over a 296 × 170 mm panel at 1:75,000 (22.2 ×
12.75 km) it reads the local government areas and lays them down as the land
— the harbour and Botany Bay's waters are the layer's "unincorporated" areas
and the open sea is the gap between the polygons, so both come out blue with
no coastline fetch — then the water theme's bays, harbours and rivers, the
railways, the roads of function hierarchy 1 to 3 (4,882 segments at Waterloo)
and the suburbs for their names, everything asked for generalised
(`maxAllowableOffset`) since a lot's corner means nothing at that scale;
the whole window fetches in about four seconds and is cached a month. The
site's LGA is washed, the 2 and 5 km rings drawn, the train and metro
stations dotted and the nearest named, the suburbs lettered in grey where a
polygon shows enough area, and the centres marked by type — a square for a
CBD, a filled dot for a major centre, a hollow one for an activity centre —
and named before the suburbs take the room. The centres are the static table
in `src/data/centres.ts`: The Sydney Plan's thirty (three CBDs, thirteen
major centres and fourteen activity centres, read with their types from the
jobs blocks of its Appendix D) and the four emerging activity centres its
corridor descriptions name, each with a point at the station or the core.
Distances are straight lines from the geocoded point, the CBD at Sydney Town
Hall; the text gives the region, the former district, the council, the
nearest centres and stations and the water in the window. The scale bar
gained kilometre lengths for this scale.

Slide 02 reads Wikipedia and Wikimedia Commons (`src/fetch/character.ts`)
through a paced, retrying fetch with a descriptive User-Agent, since the
shared address draws 429s regardless: the suburb's article by its REST
summary (the "<Suburb>, New South Wales" title first, then the bare name
where the article carries no qualifier, a namesake elsewhere rejected), the
articles placed within 1.5 km by geosearch with their one-line descriptions
in one call, kept where the description names a kind of place and not a
company, an electorate or a person; and the geotagged photographs within
800 m, their author, licence, date and size read in one imageinfo call,
kept where the licence is open and the title and description do not say car,
event or portrait, scored for naming the suburb or one of its places and for
nearness, spread across spots, series and authors, eight at most, the
1024 px thumbnails saved as `commons_<n>.jpg`. The article's lead image
joins them when it is on Commons. The aerial over the planning window is
exported with its own prefix. The slide sets the summary as a quoted seed
paragraph with its attribution, numbers the places on the aerial, tables
them with distance and direction, and captions each photograph with its
title, author, licence and distance; empty cells are placeholders for the
office's photographs. At the samples the four suburbs had articles, 11 to 40
places within 1.5 km and 33 to 50 usable photographs each.

Slide 05 resolves the documents (`src/fetch/strategies.ts`): the planning
region from the Department's Administrative Boundary service (layer 2,
`REGION_NAME`: Greater Sydney at the Sydney samples, Central West and Orana
at Orange) matched to a static table of the regional plans and their pages
under plans-by-region; the council's LSPS from the Planning Portal's index
page of every statement (128 links, parsed once a month and matched on the
council's words after "City of", "Council" and "Shire" go, so "North Sydney"
never answers for "Sydney"; the City of Sydney's link carries no ".pdf"
ending, so the bucket path counts too); the plan, its legislation link, the
DCPs, the contributions and the housing target from what the deck already
holds. The Sydney Plan commenced on 13 August 2026 and replaced the Greater
Sydney Region Plan and the five district plans, so the former district is
shown as superseded and the LSPS as in force until the council reviews it
against the plan from mid-2027; the State Land Use Plan and its Centres
Framework head the table. Rows the data cannot fill — the local housing
strategy, a centre or precinct strategy, the public domain plan — are left
as placeholders. The documents themselves are not read: each line says what
the document is, not what it says.

Slide 06 takes the 5 m elevation model over the tall panel as one float
GeoTIFF from the SIX image service (`exportImage`, `format=tiff`,
`pixelType=F32`, uncompressed and tiled; 464 × 381 cells at 2.5 m in five
seconds), parses it in `src/fetch/terrain.ts`, and draws its own hillshade
(Horn's method, north-west light, flat ground left white) as a PNG under
the State's 2 m contours, the roads and the site. The section lines are
planned from a plane fitted to the model within 30 m of the site: A–A′
down the fall (towards the nearest water where the site is flat), B–B′
across it, both spanning the window; the sections are sampled from the
grid every 2.5 m with the site and any water flagged, and drawn with a
vertical exaggeration chosen to fit. The site's levels are the 2nd and 98th
percentiles of the cells inside it, its grade that fall over its length
along the fall.

Slide 08 reads building footprints for the tall panel from Overture Maps:
a Python script runs DuckDB against the buildings theme of a release in
Overture's public bucket with a bounding-box predicate (1,608 footprints
for the North Sydney window in 103 s cold through this environment's
proxy; 416 with a measured height, 710 with storeys, the tallest 158 m).
The duckdb wheel is in the image; where it or the bucket is missing the
fetch falls back to OpenStreetMap through Overpass (`way["building"]` and
multipolygon relations, `height` and `building:levels`), and the answer is
cached on the volume for a month either way, since both sources move
monthly. `OVERTURE_RELEASE` names the release (default the one tested).
Heights come measured or as storeys × 3.1 m; where a footprint has
neither, the storeys of a determined application on its cadastral lot
stand in (`withDaStoreys` in `src/fetch/buildings.ts`, applied by the
pipeline once slide 07's feed is clipped: the latest determination on the
lot, never a refused, withdrawn or still-open one, and a footprint under
60 m² takes at most three storeys, so a tower's consent does not stand on
the shed beside it), hatched on the map and counted in the legend;
footprints with none of these are grey, and the text gives the height
limits over them and the zones they stand in rather than a default. The
map is a figure-ground by height band on the sequential blue ramp; the
histogram counts storeys within 250 m and marks the LEP height plane;
section A–A′ carries the buildings the line meets as blocks on the ground
(dashed where the storeys are a DA's, faint and one storey where the
height is unknown) and the height plane over the site, converted from RL
with the elevation model where the LEP limits in RL. Slides 11, 13 and 17
read the same heights and say where a DA supplied one. The 3D model views
remain the author's.

Slide 09 gathers, each part soft: walking isochrones from the site at 5,
10 and 15 minutes (the public Valhalla server, under a second); bus stops
from Transport for NSW where `TFNSW_API_KEY` is set, else OpenStreetMap;
bus and tram routes, cycleways (`highway=cycleway` and the `cycleway*`
tags, classed separated, lane or shared), footways, paths, steps and
pedestrian streets, and one-way streets, in one Overpass query; and the
LEP's active street frontages from ePlanning layer 224 (Sydney LEP 2012
maps eight polygons in the Waterloo window; 32 LGAs map one at all, North
Sydney and the Inner West do not). The State's transport theme holds no
stops or cycleways: its facility points are stations, interchanges and
wharves, its crossings bridges and tunnels. The stations table reads the
wide strip's stations, so the nearest counts even beyond the tall panel;
Sydney Metro's own stations are recognised by name, since the State layer
calls them railway stations. Where OpenStreetMap does not answer (the
public mirrors were down throughout development; the deployer's local
Overpass is the answer) the slide says which layers are unknown rather
than drawing them empty. The wide strip fetches major roads (function
hierarchy 5 and above), rail, stations, water and suburb polygons for a
4.7 × 1.6 km window.

Slide 10 reads the tree canopy from `Planning_Portal_Tree_Canopy` layer 1,
which is not a raster but the Greater Sydney canopy of 2022 by modified
mesh block: each block carries its canopy share, its vegetation shares by
height band (0–3, 3–10, 10–15, over 15 m) and its land-use category
(Residential, Road, Recreational, Commercial, Water…). The wide strip's
2,000–2,400 blocks come generalised to about 3 m (`maxAllowableOffset`, in
degrees since the output is 4326) in two pages and under a megabyte, and
are cached a month; the slide draws them as a choropleth on the layer's own
breaks and weights them by the area that falls inside each window, water
blocks left out of the land, so the figures are "the site's block", "the
window" and "the strip" rather than a point sample. The dataset stops at
Greater Sydney's edge: outside it the slide says so and the strip shows the
recreation and conservation zones of the wider area instead, with a note.
Open space is the RE1, RE2 and C1–C3 zone polygons over the tall panel
(fetched for that panel, since the planning panel's zoning is shorter), and
where the Greater Sydney Green Grid reaches, its existing assets
(`Planning_Portal_Public_Spaces` layer 252: ASSET_NAME, LAY_CLASS among
Parks and Gardens, Sports, Bushland, Civic, Waterfront, OSL, Cemetery, Golf
Course, Operational…, SIGNIFICANCE Local, District or Regional) stand for
the parks, merged by name since a park comes as several parcels; a zone
polygon the Grid already covers (centroid inside, or bounding boxes
overlapping by 60 %) is not counted twice, and unnamed slivers under 500 m²
stay in the drawing but out of the count. Park names otherwise come from
the open-space points (layer 260, the POI types Park, Sports Field, Picnic
Area…). Public facilities are layer 262 (libraries, museums, galleries,
community facilities: sparse, two museums in the North Sydney window) plus
the State's building-complex points classed by name (school, childcare,
library, pool, health, community, culture), since the layer's type codes
have no published domain. The NPWS estate comes from
`Tenure/NPWS_AllManagedLand` (named, unlike the Protection theme's copy).
Street trees come from the same council registry as the site sheet
(`src/fetch/trees.ts`), drawn at crown size: 2,442 in the Waterloo window.
Distances are from the site's boundary, so a park across the lane reads as
adjoining rather than 0 m.

Slide 14 reads twenty-one constraint layers over the planning panel from a
registry in `src/fetch/constraints.ts`: the plans' own maps on ePlanning
(`Planning_Portal_Hazard` 230 flood planning and 232 landslide;
`Planning_Portal_Protection` 234 acid sulfate soils, 241 salinity, 238
mineral land, 237 groundwater vulnerability, 236 drinking water catchment,
the six riparian and watercourse layers 240/1024/784/751/740/590 that
different plans use, 244 wetlands, 243/768/591 biodiversity, 245/604/737
environmentally sensitive land, 242 scenic protection, 235 airport noise,
239 obstacle limitation surface), and the State layers (229 the RFS bushfire
prone land map, Subsidence Advisory 248, the Resilience and Hazards SEPP's
coastal wetlands, littoral rainforest, coastal environment and coastal use
areas, the Sydney Trains corridor and infrastructure protection zones and
the Sydney Metro corridor protection zone, the Transport and Infrastructure
SEPP's future infrastructure corridors). The State layers reject a query
that names the plan fields, so each source says whether it carries them.
A plan's map that is empty in the window is followed by one
`returnCountOnly` query for the plan's name, so the table can say "not
mapped by this LEP" (twelve plans map flood planning, five map ANEF
contours, eleven map an obstacle limitation surface) rather than leave a
blank; the check runs against the local plan found in the window plus the
plan at the site, since the zone at the site may come from a SEPP (Three
Ports land at Botany). The two maps draw the statutory colours read from
the ePlanning renderers, broad washes first and narrow features last;
proximity areas, infrastructure protection zones and vegetation buffers
hatch. The soil landscape comes from the Sydney 1:100,000 sheet
(`Soil_Landscape/Sydney`), the one published as a service; outside it the
slide says so. Noise sources are the arterial roads within 60 m of the
boundary and railways within 120 m, from the base layers already fetched.
Geology, contamination and the airports' ANEF contours remain by hand.

Slide 11 fits the lots into a tall panel at the smallest round scale (200
to 5,000) that keeps them within 55 % of it each way, and lays the SIX
aerial under the plan (`fetchAerial` with its own file prefix, so a run of
both sheets keeps both sets of tiles); the capture date and resolution come
from SIX Maps' `NSW_Imagery_Dates` layer (the Sydney block, 7 cm, from
January 2021; Orange, 10 cm, 2012). The boundary lengths are computed from
the digital cadastre and printed along each outer edge (an edge two of the
site's lots share is left out); the corner levels are the elevation
model's, so the plan says "indicative to about a metre"; frontages are the
edges a named road runs along — its centreline within 18 m of the edge and
within 35° of its bearing, so a lane that ends at the boundary or the
street round the corner does not count — summed per road. The
existing building is the footprint whose centroid lies on the lot (or most
of whose vertices do), with its storeys and height where Overture has them,
and the neighbours' footprints touching the boundary are named by height and
direction. The plan areas come from the Lot layer's `planlotarea` (often
null, so the cadastre's computed area leads); the easement layer (cadastre
layer 9) carries geometry and width but no purpose, and is empty around most
urban lots; the neighbours' numbers are the geocoded addressing points.
The block panel at 1:4000 draws the single-property sales of the last two
years within 300 m sized by price (strata hollow), the State government
land parcels (`Planning_Portal_GPI` 302), Crown land (258) and Crown
reserves (312), and a 300 m ring. The land value and the sales are the
Valuer General's, already fetched for slide 16.

Slide 12 reads KartaView's nearby-photos listing within 250 m of the site
(`src/fetch/photos.ts`, cached a week) and keeps the frames whose view cone
takes the site in: the site's centre or a corner within 40° of the camera's
heading and the camera within 120 m of the boundary, a frame on the lot
itself left out. About half the frames carry no heading, so those take the
direction of travel between their neighbours in the sequence, and the
slide's fine print says so. The frames are chosen one per side of the site
first (eight sides, by the camera's bearing from the centre), then the sides
with fewest, each new camera at least 20 m from the ones chosen and never a
second frame of the same drive within 60 m looking the same way; when fewer
than three face the site, a frame within 60 m that looks along the street is
added and captioned as such; six at most, numbered clockwise from north.
The large thumbnails (1280 px) are saved beside the deck as `photo_<n>.jpg`,
each captioned with the street the camera stood in (the nearest named
centreline within 25 m), its distance and direction from the site, the
direction of view, the contributor and the month, and the licence
(CC BY-SA 4.0), which asks for exactly that attribution. Mapillary is read
the same way when `MAPILLARY_TOKEN` is set (the free client token; its
structure-from-motion position and heading are preferred to the camera's
own and 360° frames are skipped; the call matches the Graph API v4
documentation but has not been exercised here, where no token is set);
Wikimedia Commons is not used here, its photographs being landmarks rather
than the street. The plan keys the frames at the smallest round scale from
1:1000 that holds every camera and the site, with each camera's view cone;
the empty cells of the six are placeholders naming a side no open frame
looks at, sized for the site visit's photographs. The then-and-now pair is
one panel at 1:2500 drawn twice, 70.5 × 95 mm each, 176 × 238 m of ground:
the 1943 aerial survey of Sydney as the level-18 tiles of Spatial Services'
tile service placed at their Mercator extents (about half a metre a pixel,
the finest level served; no tile outside the Sydney region, so at Orange the
slide says so), and today's SIX imagery exported over the same extent, both
with the site outlined and today's dated from the imagery-dates layer. At
the samples KartaView held 28 to 274 frames within the radius, all by one
contributor in 2019; at Waterloo and Botany six face the site, at
Marrickville one and at North Sydney none, the frames there running along
other streets, so those slides carry placeholders.

With `GOOGLE_MAPS_API_KEY` set, Google Street View comes first
(`src/fetch/streetView.ts`). The site's outline is simplified to its convex
hull, nearly straight runs merged, and from the middle of each side a probe
12 m out asks the free metadata service for the nearest outdoor panorama
within 25 m. The side is a street frontage when that panorama stands on its
outer side within 45 m, not far past its ends, sees its middle within 60° of
square, and stands in the street with the site in view. "Outdoor" is
Google's word and takes in some shop interiors, so the cadastre and the
footprints decide: a camera more than 2 m inside a lot that is not the
site's, or inside a footprint, is set aside, and so is one whose sight line
passes more than 2 m through a neighbour's footprint or crosses more than
8 m of other lots (a footpath strip or a setback is narrower). Each frontage
gets a frame square to it, its field of view wide enough to take it in (55°
to 100°); then a frame at each corner between two frontages; two oblique
frames of each frontage longer than 30 m, from past its ends, within 72° of
square; and the street both ways from each frontage's camera, as the site
visit's brief asks; six at most, one per panorama and direction. The images
are 640 × 372, the grid cell's shape, shown uncropped so Google's marks stay
on them, captioned with the month of capture and the panorama's own credit
(Google's, or the contributor's), and saved in the deck's folder only; the
key goes into the download and nowhere else. The open frames fill the cells
Street View leaves, away from its cameras. At the samples in September 2026:
Bondi Beach two frontages (Campbell Parade and Roscoe Street) and six
frames, with three panoramas set aside (a shoe shop's interior from 2010, a
car-park entry and a neighbour's façade); North Sydney two and six; Waterloo
four and six; Orange two and six, captured in 2026; Marrickville one,
framed square and along Illawarra Road both ways; Botany none, its one
panorama nearby being inside the neighbour's building, so the open frames
carry that slide.

Slide 13 fetches nothing new but the views. The street grid is the bearing
of every road segment in the window, length-weighted and folded to 0–180° in
5° bins, each smoothed with half its neighbours; the primary axis is the
fullest bin, the secondary the fullest at least 30° from it, and the site's
long boundary is set against the nearer of the two (within 5° is "on the
grid"), its frontages named by the compass point they face. The sun's
altitude and azimuth are computed in `src/lib/solar.ts` (the NOAA solar
geometry, checked against Sydney's published rise, noon and set times) for
21 June in standard time and for 21 December and the equinox in daylight
time; the polar diagram samples the day every five minutes. The shadows are
`src/lib/shadows.ts`: every footprint with a recorded height that is not
the site's own is cast as the convex hull of the footprint and its copy
moved H / tan(altitude) away from the sun, in the map's metres; the site is
sampled on a grid of up to 1,600 points and the shaded share is the points
inside any hull, the largest caster named. A terrace row that Overture holds
as one footprint would shade its own lot, so the footprint the site stands
in is left out and the slide says so. Overture's heights are patchy in the
older suburbs (none of the terraces around 770 Elizabeth Street Waterloo
carries one), so where no footprint within shadow reach has a height the
slide says that instead of claiming the site keeps its sun, and where some
do the text gives how many of the buildings within 60 m have one. The
shadow panel is the site panel at 1:1000 or coarser, footprints drawn over
the shadows so both read. The
views are the plan sheet's `assessViews`: the skylines within their range,
the named water bodies and the coast from the NSW Water theme, the parks
touching the site, each sight line from an eye just under the height limit
(`eyeAboveGround`) profiled over the 5 m elevation model. On a panel at the
wide strip's scale a clear line gets a ±8° cone and a blocked one a dashed
line to the point where the ground rises across it; the table lists them
all. Buildings and trees are not tested, and the text says so. The views
are computed in the pipeline's second stage, one elevation profile per
target, and travel in the bundle.

Slide 17 fetches nothing: `ocFacts` calls the other slides' facts functions
and turns what they found into statements, each an opportunity or a
constraint with a theme, a sentence and, where it has one, a point on a
diagram. The rules are plain: the nearest stations within 1.5 km and the
bus stops within 400 m; the housing-policy map at the site, or the nearest
within 800 m; the active street frontage at the site or within 400 m; a
frontage that faces north, or an east–west long axis, as an opportunity and
a north–south axis as a constraint; the winter sun's sweep always, with the
neighbours' shading as a constraint from 10 % of the site; the nearest park
and the parks within five minutes; the nearest public facility within
600 m; the clear sight lines; the applications of scale within the diagram;
the height plane against the neighbourhood's median storeys; the controls;
heritage on the site, the nearest item within 120 m and the State register
within 300 m; every constraint layer at the site and the nearest three
within the diagram; the arterial roads within 60 m and rail within 120 m as
noise; buildings three or more storeys over the height plane within the
diagram; a fall of a metre or more; easements; the buildings on the lot and
those on the boundary; the street trees within 30 m where an inventory is
open. Nine of each are kept, the rest go to the deck's JSON. The two
diagrams are drawn at 1:4000 (1:8000 for a very large site) from the layers
already in the bundle, and the numbers on them key to the two lists; a
statement with no place of its own sits in a row of numbers under the site.
The text says what the statements are — templates from the data, not a
judgement of merit — and leaves the design response to the author.

Slide 18 is generated from the bundle the deck's JSON is made of, so it
states only what the run actually read. `sourcesFacts` lists every dataset
under its publisher — the department's ePlanning services and the Planning
Portal APIs, Spatial Services, the other State agencies, the ABS, the
council where its open data was used, the open and community sources, and
a last row for what the tool computes — each with the slides it served, its
currency or edition, its retrieval time and its attribution and licence.
Currency comes from the layers themselves: the zoning, height and heritage
maps' `CURRENCY_DATE` and `AMENDMENT` at the site (or the latest in the
window), the FSR and lot-size maps' dates from the property report, the
constraint layers' currency per plan, the imagery block's capture date and
resolution, the census and canopy years, the land values' base dates, the
development feed's range and count, Overture's release. Retrieval is the
deck's own timestamp, or the cache's fill date where a block came from the
volume (footprints for thirty days, the development feed for a day, the
census tables for a month) and the slide says so. The sentences give the
layers' own dates in one line, name what is computed rather than sourced,
list what must still be obtained outside the open data (the survey, the
title search, the geotechnical, contamination and acoustic reports, the
flood study, the ANEF contours, the site visit), repeat the run's warnings (an Overpass mirror that did not
answer, a feed that came back incomplete) and state the licence position
as the publishers give it. The table has a fixed box and a busy council
area fills it (fifty-odd rows at Bondi Beach), so the printer measures it
in the page and steps its type down until the last row is inside, to three
quarters of its size, rather than clipping the rows below the fold.

Slide 15 reads the layers of Country that are open (`src/fetch/country.ts`,
each part soft): the National Native Title Tribunal's determinations,
registered claims and Indigenous land use agreements at the geocoded point
and counted over the strip (the hosted service wants a JSON point and
`outFields=*`); the gazetted Aboriginal Places within 10 km from the
State's heritage service, with their gazettal date and the register's
restricted flag, whose geometry it publishes generalised; the pre-1750
plant community at the site by `identify` on the State Vegetation Type Map
and the map itself exported over the strip as the State draws it — the
layer draws only between 1:100,000 and 1:25,001 and the service reckons
scale from pixels and dpi, so the picture is asked for at two metres a
pixel with a dpi that puts it at 1:30,000 — with a small BMP export read
for the colours, each colour covering a hundredth of the strip identified
once for its name, so the legend lists the communities by share in the
map's own colours; the watercourses and the coastline of the water theme;
the Local Aboriginal Land Council areas; the NPWS estate; the ASDST
combined-features likelihood and survey priority at the site, read as the
model's relative values of 999 and named as such; and a second elevation
grid at 8 m over the strip, for a hillshade and for the ridgelines
(`src/lib/ridges.ts`: after a light smoothing, a cell is a crest when,
along two or more of the four axes, it stands above the ground on both
sides at one of three reaches — a metre over two cells, two metres over
five, four metres over ten, so the broad ridges count as well as the sharp
ones — in a window with three metres of relief; the crest cells are chained
into polylines). The map is the wide strip at 1:16000: hillshade, the
pre-1750 communities, water, courses named, crests, parks, the gazetted
places (an edge arrow for one beyond the strip), the land council boundary
where two meet, the suburbs lightly. The table gives each layer's answer at
the site; the note states that AHIMS is not open and is not read, that a
search and where advised a due-diligence assessment precede works, and that
the name of Country, the language, the place names and the narrative are
developed with Knowledge Holders, not generated. Slide 17 carries a Country
constraint and slide 18 the new sources.

The local environmental plans' own Aboriginal heritage items are read too:
the ePlanning heritage map (`EPI_Primary_Planning_Layers/0`) over the strip,
its four Aboriginal classes (Aboriginal Object, Aboriginal Place of Heritage
Significance, Item - Aboriginal, Conservation Area - Aboriginal). Few plans
schedule any: 71 items in 16 plans across NSW in September 2026, among them
Waverley's rock engravings, shelters and an open campsite with burials
around Bondi, Eurobodalla's conservation areas and Balranald's items. They
are washed in the heritage map's gold with a square at each and named where
there is room, tabled with their number and distance, and named in the text
("none scheduled in the strip" elsewhere); an item within 500 m joins slide
17's Country constraint. At 154 Campbell Parade Bondi Beach four are in the
strip, the nearest an open campsite and burials 143 m east.

Slide 16 looks the site up in the ASGS (SA2, LGA, suburb, capital-city
region), reads the five census tables for the SA2, the LGA and the capital
city (Greater Sydney, or the rest of the state elsewhere), the ABS population
series for the SA2 and the LGA, SEIFA 2021, the TZP24 projection (the SA2's
summed from its travel zones, the LGA's from the LGA file), the Valuer
General's five land values of the property at the point, the sales register
within 400 m and the government schools within 2 km. The figure field is a
row of seven figures, the population line with its projection, a
three-column comparison table, four paired-bar profiles (age, dwelling
structure, tenure, travel to work) against the benchmark, the land value
columns and the most recent sales. School catchment polygons (an 8 MB
shapefile) are left for the amenity slide. Census tables, the projection
files and the school dataset are cached on the volume for a month
(`src/lib/cache.ts`), the population series for a week.

Slide 07 reads the Online DA feed for the site's council over the last five
years (`--da-years`), never earlier than July 2021 when lodgement through the
portal became mandatory, and clips to the map window locally since the feed
has no spatial filter. A council's five years is 2,000–10,000 records, paged
2,000 at a time with three pages in flight, so the feed is cached under
`out/.cache/da/` for a day and a second deck in the same council costs
nothing. The council name sent must be the API's own spelling (`COUNCILS` in
`src/fetch/da.ts` lists the 130 names; the LGA layer's `councilname` is
matched exactly, then by stem). "Of scale" means storeys ≥ 4, dwellings ≥ 10
or cost ≥ $5 M, unless every development type is house-scale (alterations,
dual occupancies, pools, tree work, strata subdivision…), which then needs
ten dwellings and $2 M — applicants type "4 storeys" into a deck application
and the existing unit count into a strata subdivision. Records are grouped by
lot and street so a DA and its modifications make one numbered site. The
feed's statuses are Determined (it never says approved or refused), Under
Assessment, Additional Information Requested, On Exhibition, Pending Court
Appeal, Deferred Commencement, Operational consent requested/issued,
Withdrawn, Rejected (not accepted at lodgement) and Cancelled; the slide
groups them as determined, active, before the court and withdrawn. Planning
proposals come from the identify operation on
`ePlanning/Planning_Proposal_Public`.

State significant applications come from the Department's Major Projects
register (`src/fetch/majorProjects.ts`), which has no API. Its listing
(`/major-projects/projects`) is a server-rendered page of cards, nine to a
page, filtered by council area (`lga`, the ids of its own select), case
type and stage; each card gives the application number, the stage, the case
type, the council area, the title and the address. Each project's page adds
the development type, the decision, the determination date, the decider,
the last modification, the modifications with their stages, the
description and the Department's point for the project (a geofield in the
page's settings). The deck reads the listing for every council area the
window touches (the harbour's unincorporated area skipped), State
significant development and infrastructure only (288 for the City of
Sydney, 65 North Sydney, 47 Bayside, 44 Inner West, 5 Orange), cached a
week, and every listed project's page, cached a week while it is in the
process and two months once settled: 288 pages and 66 s the first time for
the City of Sydney, from the cache after. The tracker's JSON of every
project (`/state-significant-projects-spatial-data`) would be one call but
answered 503 throughout. On the slide the projects whose point falls in the
window and that are in the process or determined in the last ten years are
S-numbered diamonds in the status colours (in the process first, then the
latest determined), the top six rows of the table with number, stage,
decision, modifications and determination date, and "on the site" when the
point falls on the site's lots; older approvals and the withdrawn or lapsed
(SEARs expired) are counted in the text, not drawn. The register gives no
lodgement dates. At 5 Blue Street North Sydney the register's own
application for the site is S1; at Marrickville a residential flat building
99 m away is at the Prepare EIS stage; at Waterloo the Metro Quarter concept
and five stages of the Waterloo Estate (South) sit in the window.
`test/major-projects.mts` checks the parsers on trimmed copies of the
markup.

Council open data is a per-LGA hook: the City of Sydney's data hub
(`data.cityofsydney.nsw.gov.au`, ArcGIS feature services under
`services1.arcgis.com/cNVyNtjGVZybOQWZ`) is read for sites in that LGA —
Sydney DCP 2012 building height in storeys, street frontage heights, active
frontages and setbacks (`src/fetch/cityOfSydney.ts`). The same hub holds the
Floor Space and Employment Survey (jobs, businesses and internal floor area
per block, 2007–2022), the Barani Aboriginal history places, street trees,
contours, parks and the separated cycleway network, which slides 15, 16, 09
and 10 should take from it when the site is in the City. It covers that LGA
only; everywhere else the statewide layers stand.

## 8. Suggested order of work

1. Slide chrome (A3, text column, figure grid, footer) and the PDF/PNG/JSON
   outputs, with slides 03 and 04 first: they are the existing sheets' data
   at a new size plus the property API.
2. Slides 07 (Online DA API) and 16 (ABS, TZP24, housing target): tables and
   dots, the highest value per hour of work.
3. Slides 06, 08 and 13: the DEM profile, building heights and the sun path —
   the three computations, shared by all of them.
4. Slides 01, 09, 10, 11, 14, 15: layer work over what already exists.
5. Slides 02 and 12: photo panels and the licence lines.
6. Slides 05, 17, 18 and the narrative placeholders.

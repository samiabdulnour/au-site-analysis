# Context Analysis sheet — specification

Learned from the reference sheets in `examples/` (Fuse Architects DA/SSDA
packages: Campsie 2539, Randwick 2612, Regents Park 2521, Maroubra 2524,
Kogarah 2614, plus the full packages in `examples/packages/`). This document
is the target the generator reproduces.

## Layout variants observed

The office uses one shared sheet language (title block, legend structure,
T/B symbols, walking isochrones or distance circles, curated POI fills) with
several context-analysis *bases*:

- **A. Zoning wash over aerial** — semi-transparent LEP-zoning colors over a
  washed orthophoto (2539 Campsie, 2612 Randwick, 2521 Regents Park,
  2524 Maroubra, 2614 Kogarah). **← the variant this generator produces.**
- **B. Greyscale aerial + selective highlights** — desaturated photo, only
  POI/land-use highlights colored, orange dashed 400/800 m circles,
  neighbourhood name labels, precinct outlines (2430/DA2522 Arncliffe).
- **C. Mobility/heritage focus** — bike routes (on/off-road), pedestrian
  paths, primary/secondary street highlights, heritage conservation hatching,
  200/400/800 m circles, amenity icon set (2504 Parramatta).
- **D. Flat figure-ground pastel** — no aerial; flat land-use colors with
  water bodies, white double-headed arrow street labels, LMR housing area
  dashed boundaries, isochrones with pedestrian icons (2546 Oatley).

Signature elements worth adopting into the generator regardless of variant:
white double-headed street arrows with the name set along them (A, D),
water bodies (D), heritage conservation hatch (C), child care / aged care
outline category (D).

## Sheet format

- **A1 landscape, 841 × 594 mm**, full bleed.
- Left ~690 mm: the **map field** (single large map).
- Right ~150 mm: the **title block column** (white, vertical rules separating
  it from the map).
- Scale **1:2000 – 1:3000 @ A1**, noted as e.g. `1:3000 @ A1   A3@50%`.
- Sheet number `DA 003` / `SSDA 003` (context analysis is sheet 3 of the
  package), drawing title `CONTEXT ANALYSIS`.

## Map field

Layered bottom → top:

1. **Aerial photo base** — recent orthophoto, washed out (white overlay /
   reduced saturation ≈ 40–60 %) so overlays dominate.
2. **Land-use / zoning overlays** — semi-transparent (~55–70 %) colored
   polygons following lot boundaries. Categories seen (legend labels):
   - `SITE` — red; solid red fill for small sites or red dashed outline
   - `MEDICAL` — crimson/pink
   - `EDUCATION` — blue
   - `EMPLOYMENT HUB` — yellow
   - `MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL` — magenta
   - `ACTIVE RETAIL` — light purple/lilac
   - `OPEN SPACE` — green
   - `COMMUNITY HUB` / `COMMUNITY / PLACES OF WORSHIP` — pale cyan
   - `R2 LOW DENSITY RESIDENTIAL  HOB 8.5-9m` — grey-brown
   - `R3 MEDIUM DENSITY RESIDENTIAL  HOB 8.5m` — tan
   - `R4 HIGH DENSITY RESIDENTIAL  HOB 15m` — red
   - `B2 LOCAL CENTRE HOB 21m`, `E1 LOCAL CENTRE`, `E2 COMMERCIAL CENTRE` —
     pink / light violet
   - `E4 GENERAL INDUSTRIAL` — purple
   - `SP2 INFRASTRUCTURE` — pale violet or yellow
   - `RAILWAY TRACKS` — orange corridor band
   - `GENERAL HERITAGE SITE` — hatched or tan patches
   - `CBD BOUNDARY` — yellow outline
   The categories are *curated*: raw LEP zoning is the base, but named
   institutions (schools, hospitals, civic buildings) are colored by their
   function regardless of zone, and labeled by name.
3. **Transport symbols**
   - `T` in a circle — train station (labeled, e.g. `CAMPSIE TRAIN STATION`)
   - `B` in a blue circle — bus stops (every stop in extent)
   - dashed blue line — bus routes; dashed pink — tram/light-rail routes
   - orange band — railway tracks (from cadastral rail corridor)
4. **Walkability isochrones** — 400 m / 5 min and 800 m / 10 min *walking
   network* isochrones centered on the site, drawn as irregular dashed
   outlines (pink/magenta, green, or black per project), each labeled
   (`400m (5-min walk)`, `800m/ 10minute walk`). One example (Regents Park)
   uses plain dashed circles instead.
5. **Labels**
   - Street names: uppercase, small, following the road alignment.
   - POI names: uppercase bold, dark grey/black, white halo, at feature
     centroid (schools, parks, reserves, hospitals, civic buildings,
     churches, clubs, notable retail).
   - White double-headed arrows along key streets (movement/connection).
6. **Pedestrian links** — yellow or blue dashed arrows where relevant.

## Title block column (top → bottom)

1. File name + print date line (tiny).
2. **NOTE** block — standard disclaimers (fixed text).
3. **Legend** — heading `CONTEXT ANALYSIS`; swatch + label per category,
   only categories present on the map.
4. **ISSUE / REVISION table** — `REVISION ID | AMENDMENT | DATE`.
5. **FUSE ARCHITECTS** wordmark + studio address/contact block.
6. **CLIENT** block.
7. `PRELIMINARY` stamp (red outline box) when not for submission.
8. North arrow (circle, N tick) + scale bar.
9. **SITE ADDRESS** block.
10. **JOB NO**, CHECKED / DRAWN, DATE, SCALE.
11. **PROJECT STATUS** (`DEVELOPMENT APPLICATION`, `STATE SIGNIFICANT
    DEVELOPMENT APPLICATION`, `PRELIMINARY`).
12. **DRAWING TITLE** (`CONTEXT ANALYSIS`), **SHEET NO** + **REVISION**.

## Typography & colors

- Sans-serif throughout (Arial/Helvetica family), uppercase labels.
- Palette (approximate, sampled from examples):

| category        | fill      |
|-----------------|-----------|
| site            | `#e8402a` |
| medical         | `#e64c7e` |
| education       | `#4f8fd9` |
| employment      | `#eef04a` |
| mixed use       | `#e957c9` |
| active retail   | `#d9b3e6` |
| open space      | `#8fd158` |
| community       | `#bfe9e0` |
| R2              | `#c4a6a0` |
| R3              | `#e6d3a3` |
| R4              | `#e85a50` |
| local centre    | `#f0b3c8` |
| commercial      | `#d9c2ee` |
| industrial      | `#a06ee0` |
| infrastructure  | `#cbbce8` |
| railway         | `#f0912d` |
| bus route       | `#3d7edb` (dashed) |
| isochrone 400   | `#e6007e` (dashed) |
| isochrone 800   | `#cc4da6` (dashed) |

The generator's own palettes (`src/render/template.ts`) take their colours
from the NSW Standard Instrument LEP zoning map instead, as the ePlanning Land
Zoning layer (`EPI_Primary_Planning_Layers/MapServer/2`) draws it. `nsw` uses
them exactly, opaque as the layer draws them (its transparency is 0); `classic`
keeps the hues and evens out lightness and chroma so they survive being laid
over a photo:

| LEP zone                         | LEP colour            | category         |
|----------------------------------|-----------------------|------------------|
| R2 Low Density (also R5, RU)     | `#ffa6a3`             | r2               |
| R3 Medium Density (also R1)      | `#ff776e`             | r3               |
| R4 High Density                  | `#ff483b`             | r4               |
| E1 Local Centre (also B1, B2)    | `#99ccff`             | localCentre      |
| E2 Commercial Centre, E3         | `#b4c6e7`, `#8ea9db`  | commercial       |
| MU1 Mixed Use (also B4)          | `#959dc2`             | mixedUse         |
| E4, E5 (also IN1–IN4)            | `#9999ff`, `#9966ff`  | industrial       |
| SP2 Infrastructure (also SP1)    | `#ffff70`             | infrastructure   |
| RE1 Public Recreation            | `#55ff00`             | openSpace        |
| W1, W2 Waterways                 | `#d9fff2`, `#99ffdd`  | water            |
| heritage item (Heritage map)     | `#dbbb7b`             | heritage hatch   |

C1–C4 are ochre on the LEP map (`#e69900` … `#ffda96`) but the category model
draws them as open space, so they take its green. Transport symbols use TfNSW's
mode colours: trains `#f6891f`, buses `#00b5ef`, light rail `#ee343f`.

# au-site-analysis — the autonomous site analyst

Give it a NSW street address; it produces the curated site-analysis drawings
an architectural office prepares when entering the DA (Development
Application) stage — fetched entirely from open data, no site visit, no
screenshots.

Planned report sections: executive summary, regional context, site context,
sun analysis, heritage context, transport and access, walkability, public
space, amenities, planning controls, SWOT, design opportunities, design
response / massing ideas.

**Current stage: sheet 1 — CONTEXT ANALYSIS** (see `docs/SHEET_SPEC.md` for
the target format learned from `examples/`, and `docs/DATA_SOURCES.md` for
the open-data endpoints used).

## Usage

```bash
npm install
npm run generate -- "26-30 Campsie St, Campsie NSW 2194"
```

### Web interface

```bash
npm run serve        # http://localhost:3000  (PORT=… to change)
```

One page: type a NSW address, pick a scale, GENERATE. Progress streams while
the pipeline fetches and composes; the finished A1 PDF opens in the browser.
Jobs queue one at a time so simultaneous users don't hammer the public data
services. Put `TFNSW_API_KEY=…` in `.env` for authoritative bus stops.

There is no authentication — host it inside the office network or behind a
reverse proxy with auth if exposed further.

Output lands in `out/<address-slug>/`:

- `data/` — everything fetched (GeoJSON bundle + aerial tiles), kept for
  reproducibility and debugging
- `sheet.html` — the composed sheet (open in a browser to inspect)
- `CONTEXT_ANALYSIS.pdf` — A1 landscape sheet

Options (after `--`): `--scale 3000` (default 3000), `--job 2539`,
`--client "Name"`, `--status "DEVELOPMENT APPLICATION"`, `--sheet "DA 003"`.

## How it works

```
address
  → geocode (NSW Spatial addressing)
  → site lot polygon (NSW cadastre)
  → in parallel, for the sheet extent around the site:
      zoning + height-of-building + heritage   (NSW ePlanning)
      rail corridors                           (NSW cadastre)
      aerial imagery                           (NSW SIX)
      streets, POIs, bus stops/routes, stations (OSM Overpass)
      5/10-min walking isochrones              (Valhalla)
  → curate land-use categories (zoning as base; schools/hospitals/civic
    overridden by function, labeled by name)
  → compose A1 sheet (SVG/HTML in the office graphic style)
  → print to PDF (headless Chromium)
```

## Repository is private

`examples/` contains real project sheets used as the style/content reference
— do not make this repository public.

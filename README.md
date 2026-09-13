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

One address field with the drawing options as a table of cells under it —
one font, one size, hairline rules, yellow for what is chosen or what to
press. Hovering an option shows a real sheet generated for the same demo
address, so the comparison is like for like. `/about` explains the tool to
anyone who lands on it: what the three drawings contain, where the data
comes from, and what the output must not be relied on for. The generator
itself sits behind the access code. Sample thumbnails live in `web/samples/`
and are served from `/samples/<name>.jpg` (whitelisted names only).

Progress streams while the pipeline fetches and composes; the finished A1 PDF
opens in the browser. Jobs run one at a time so simultaneous users don't
hammer the public data services, and the page reports queue position and a
rough ETA rather than an anonymous spinner. Put `TFNSW_API_KEY=…` in `.env`
for authoritative bus stops.

To refresh the samples, generate the three sheets for the demo address and
re-render them:

```bash
# neutral: the previews have to match what the public side draws
npm run generate -- "1 Bay Street, Botany NSW 2019" --type both --template neutral
npm run generate -- "1 Bay Street, Botany NSW 2019" --type summary --template neutral
python3 - <<'EOF'
import pymupdf
src = 'out/1-bay-street-botany-nsw-2019/'
for name, f in [('context','CONTEXT_ANALYSIS.pdf'), ('site','SITE_ANALYSIS.pdf'),
                ('summary','DEVELOPMENT_SUMMARY.pdf')]:
    pymupdf.open(src+f)[0].get_pixmap(dpi=54).pil_save(
        f'web/samples/{name}.jpg', format='JPEG', quality=76, optimize=True)
EOF
```

### Two doors

`/` is the public entrance and `/fuse` the office one. They serve the same
page and the same generator; what separates them is the graphic template.
`fuse` is the office's own house style, so only the office door draws with it
and the public one draws `neutral`. Each door has exactly one template, so
neither shows the template row — a list of one is not a choice. It is a list
rather than a flag so that adding the office's second style later brings the
row back without any other change.

Each door takes its own code and no other: the public code is refused at
`/fuse` and the office code is refused at `/`. A door that opens to the other
entrance's key is not a separate door, however little it grants. A session
from one entrance is not a session at the other either — arriving at `/fuse`
with a public cookie asks for the office code.

The page tells the server which door it is. A client can lie about that, but
lying only narrows what it may present a code for — claiming the office door
still requires the office code — so the secret stays the only thing that
grants anything. Set both in `/etc/site-analyst.env`:

```
ACCESS_CODE=…            # public
FUSE_ACCESS_CODE=…       # office; omit and /fuse simply has no code that opens it
```

The allow-list is applied to the job, not to the page (`TIER_TEMPLATES` in
`src/server.ts`). A public session that posts `template: "fuse"` straight to
`/api/jobs` gets a neutral sheet — hiding a button only stops the people who
use buttons. Each door derives its own session cookie, so changing one code
signs out that door and leaves the other alone.

Sample thumbnails are rendered in `neutral`, since that is what the public
side produces, and illustrate drawing type, scale and orientation rather than
template, so one set serves both doors. `tpl-fuse.jpg` and `tpl-neutral.jpg`
are kept for the template row to use whenever a door offers a choice again.

Authentication: set `ACCESS_CODE=<shared code>` (env or `.env`) — visitors
must enter it once and get a 30-day session cookie. Login attempts and job
submissions are rate-limited per IP, and job outputs are deleted after 24h.
`ALLOW_NO_AUTH=1` disables the gate for local use only.

The code lives in `/etc/site-analyst.env` on the server and never in the repo,
so rotating it is a change on the host rather than a deploy:

```bash
sed -i 's/^ACCESS_CODE=.*/ACCESS_CODE=<new code>/' /etc/site-analyst.env
/opt/site-analyst/deploy/update.sh --force     # --force: the commit has not changed
```

Every existing session dies with the old code — the cookie is an HMAC of it —
so everyone signs in again. If the deploy prints `deferring`, a sheet is
generating; run it again once `"busy"` is false.

### What a deploy is allowed to cost

Nothing that anyone is waiting on. The auto-deployer replaces the container
whenever `main` moves, so anything the app keeps only in memory or only in the
container's own filesystem is gone every few minutes of active development.

`out/` is therefore a host volume (`SITE_OUT`, default
`/var/lib/site-analyst/out`), and the job list is mirrored to
`out/web/jobs.json` on every state change and read back at boot. A visitor who
generated a sheet before the deploy still has their download link afterwards;
what was mid-flight comes back as `interrupted by a server restart — run
again`, because the pipeline's work was in the process that died. The same
volume carries the OSM disk cache (`out/.cache/osm`), which is what keeps
sheets generating while Overpass is down — it used to be discarded on every
deploy, so the outage protection was reset just as often as the code changed.

Retention has two ceilings, swept hourly rather than only after a job (an idle
server reclaimed nothing before, which matters on a disk shared with a 27GB
Overpass database): 24h of age, and `WEB_OUT_BUDGET_MB` of total size (default
4096, floor 256) with the oldest sheets going first. A record whose files the
sweep took is dropped with them, so a stale link 404s instead of failing at the
download.

### Asking twice

An identical request is answered with the sheet already drawn for it rather
than by drawing it again — instantly, instead of one to three minutes of
somebody else's public data services. Identical means the address and every
option that changes the drawing; the typed address is normalised for case,
punctuation and spacing, so `1 Bay Street, Botany` and `1 BAY STREET BOTANY,`
are one request. Two genuinely different spellings of the same address are
still two, because the geocode that would settle it happens inside the pipeline
this is avoiding — and the type-ahead hands back one canonical string, which is
what most repeats are.

A request that matches one still running follows it instead of queueing behind
it, so two people asking at once do not draw the sheet twice.

The page says which it got — `this sheet was drawn 20 minutes ago — reusing
it` — because an instant PDF is otherwise indistinguishable from a stale one,
and offers `generate a fresh one` beside the claim, which posts `fresh: true`
and runs the pipeline regardless. Reuse is checked before the rate limit, since
the 12-an-hour budget exists to protect the upstream services and a sheet that
is already drawn does not touch them; a forced fresh run does spend it.

Nothing is cached beyond the retention window above, so a reused sheet is at
most 24h old.

### Status view

`/status` is the office's window onto what the server has been doing: version
and uptime, whether the local Overpass is actually serving, queue depth, how
much of the output budget the sheets are using and how much room is left on the
volume underneath — and the last 24 hours of jobs with their address, options,
door, duration, size, and, for the ones that failed, the reason.

`/api/version` stays the public window and says only whether the thing is up.
This one names addresses people searched for and why their sheets failed, so it
answers the office tier and nothing else: no session and a public session both
get `403 Office access only`, and the link to it appears on the page only once
the office code has been given. The page itself is served to anyone — it holds
nothing — and says to sign in at the office door.

It refreshes every ten seconds. A failing job is the thing it exists for, so
the reason sits under the address in red rather than behind a click; the
running job is the yellow row; and `volume free` is the number to look at first
when sheets start failing for no reason the log explains, because the Overpass
database shares that disk.

### Local OpenStreetMap (recommended for production)

The public Overpass network is frequently unavailable, which costs the site
sheet its trees, driveways, parking zones and street furniture. Run a local
Overpass seeded with the NSW extract instead:

On a server running the auto-deployer this installs itself: every pass runs
`deploy/ensure-overpass.sh`, which launches the Overpass container if it is
missing (~266MB download, then 30–90 min building the database inside the
container), keeps it running, and — once it actually answers queries — writes
`OVERPASS_LOCAL` into `/etc/site-analyst.env` and redeploys the app. Progress
is in `/var/log/site-analyst-overpass.log`; `GET /api/version` reports
`"osm": "local"` when the switch has happened.

Anywhere else, run it by hand:

```bash
bash deploy/setup-overpass.sh
```

**Keeping it accurate.** The extract carries no diff stream, so
`ensure-overpass.sh` rebuilds the database from a fresh download every
`OVERPASS_REFRESH_DAYS` (default 7, matching how often BBBike regenerates it)
at `OVERPASS_REFRESH_HOUR_UTC` (default 16:00 UTC ≈ 02:00–03:00 Sydney). The
rebuild takes the local database offline for 10–20 minutes; queries fall back
to the public mirrors meanwhile, so sheets keep generating. The OSM disk cache
also drops from 30 days to 6 hours whenever `OVERPASS_LOCAL` is set, so a
cached answer cannot outlive the database it came from.

Both containers share the `site-net` docker network, so the app resolves
Overpass by container name (`http://overpass-nsw/api/interpreter`); a port
published on the host loopback would not be reachable from the app container.
`OVERPASS_LOCAL` is tried first for every OSM query; the public mirrors and
the 30-day disk cache remain as fallbacks, so nothing breaks while the local
database is still building — or if it is never installed at all.

Needs ~12GB free disk; the setup script refuses to start below that.

### Domain

`site-analyst.com` is served by Caddy on the host, which terminates TLS and
proxies to the app on `127.0.0.1:3100`. Two DNS records at the registrar point
the name here — an `A` record for `@` and one for `www`, both the server's IPv4
address — and `deploy/ensure-domain.sh` adds the Caddy site block on the next
deploy pass. Caddy asks Let's Encrypt for the certificate on the first request
for the name, so DNS has to resolve here and port 80 has to be reachable
before that can succeed. `www` redirects to the bare domain.

The script only ever appends, so whatever served the host before keeps
working, and it is a no-op once the Caddyfile names the domain. There is no
shell access to the host from where it is written, so it validates the edited
config before reloading and restores the backup if either step fails; the
outcome shows up as `"domain"` in `GET /api/version`. Set `SITE_DOMAIN` in
`/etc/site-analyst.env` to use a different name.

### Public deployment (Docker)

```bash
docker build -t site-analyst .
docker run -p 3000:3000 -e ACCESS_CODE=… -e TFNSW_API_KEY=… site-analyst
```

The image bundles Chromium and fonts; `examples/` and `.env` are excluded
from the build context (`.dockerignore`) so the private reference sheets
never leave the repo. Works as-is on Fly.io, Railway, Render or any VPS —
put it behind HTTPS (the session cookie is marked Secure when the
`x-forwarded-proto: https` header is present).

Output lands in `out/<address-slug>/`:

- `data/` — everything fetched (GeoJSON bundle + aerial tiles), kept for
  reproducibility and debugging
- `sheet.html` — the composed sheet (open in a browser to inspect)
- `CONTEXT_ANALYSIS.pdf` — A1 landscape sheet
- `CONTEXT_ANALYSIS_CAD.zip` — CAD package for ArchiCAD: `CONTEXT_ANALYSIS.dxf`
  in real-world meters on the MGA2020 grid, one layer per data class, every
  name prefixed `SA_` so the tool's layers are obvious in a merged project
  file (SA_SITE, SA_CADASTRE, SA_ZONE-*, SA_INST-*, SA_HERITAGE, SA_ROADS,
  SA_ROAD-NAMES, SA_RAIL-*, SA_BUS-*, SA_ISOCHRONE-*, SA_LABELS-POI,
  SA_AERIAL), plus georeferenced aerial JPEGs
  with `.jgw` world files and an import README. A true `.dwg` is added
  automatically when the free ODA File Converter is installed on the host
  (download from opendesign.com, then it is found on PATH or via
  `ODA_CONVERTER=/path/to/ODAFileConverter`); ArchiCAD imports the DXF
  natively either way.

Every drawing also exports in an open, editable format:

- **Context analysis** and **site analysis** — `*_CAD.zip` containing a DXF in
  real-world meters on the MGA2020 grid, one `SA_`-prefixed layer per data
  class, plus a true `.dwg` when the ODA File Converter is installed. Site geometry is written at
  true ground scale, so it drops straight under a survey.
- **Development summary** — `.csv` (opens in Excel, pastes into a Word or
  InDesign table) and `.json` for anything reading the controls
  programmatically. A table is data, not geometry, so DXF would only produce
  loose text entities.

### Graphic templates

A template is the sheet's appearance — typeface, text scale, line and fill
colours, the land-use palette and the symbol family. Content is identical
between templates; only the look changes. They live in
`src/render/template.ts`, so a new house style is a data change.

- `fuse` — the office style the sheets were reverse-engineered from (default)
- `neutral` — restrained palette, one accent, survives a mono print

Fonts are limited to what the runtime image installs (Liberation, DejaVu).
Naming an absent font does not fail; it silently falls back and the sheet
comes out in the wrong face, so add the package to the `Dockerfile` first.

Options (after `--`): `--type context|site|summary|both`, `--template fuse|neutral`, `--scale 3000` (default 3000), `--job 2539`,
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

### Street names

A through street carries its name in the white double-headed arrow band; a
laneway gets a plain black label along the line. Neither of the two fields NSW
publishes decides this on its own — Dickson Lane is classified `LocalRoad`
exactly like Hall Street, and plenty of real streets have no lane count
recorded — so the rule combines them: function hierarchy 7+ (service lane,
track, path, access way), a name ending in LANE/WALK/PATH/TRACK, or a recorded
single lane means laneway, otherwise street.

The road network arrives split at every intersection, so the pieces of each
street are chained back into continuous runs before labelling; without that, a
band could never span a junction and an arterial would come out looking like a
laneway. A long street repeats its name up to three times. Every label — street
and place name alike — reserves the ground it covers, and place names go first
because they belong to a parcel and cannot move, so a street name slides along
its road to find clear space or is dropped rather than overprinted.

## Repository is private

`examples/` contains real project sheets used as the style/content reference
— do not make this repository public.

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
npm run generate -- "1 Bay Street, Botany NSW 2019" --type both
npm run generate -- "1 Bay Street, Botany NSW 2019" --type summary
python3 - <<'EOF'
import pymupdf
src = 'out/1-bay-street-botany-nsw-2019/'
for name, f in [('context','CONTEXT_ANALYSIS.pdf'), ('site','SITE_ANALYSIS.pdf'),
                ('summary','DEVELOPMENT_SUMMARY.pdf')]:
    pymupdf.open(src+f)[0].get_pixmap(dpi=54).pil_save(
        f'web/samples/{name}.jpg', format='JPEG', quality=76, optimize=True)
EOF
```

`context.jpg` is the default palette. The other two palette previews are the
same fetched data drawn again, which asks nothing more of the public services:

```bash
node --import tsx --input-type=module - <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
import { renderSheet } from './src/render/sheet.ts';
import { withTemplate } from './src/render/template.ts';
import { htmlToPdf } from './src/render/pdf.ts';
const dir = 'out/1-bay-street-botany-nsw-2019';
const bundle = JSON.parse(readFileSync(`${dir}/data/bundle.json`, 'utf8'));
const meta = { jobNo: '', client: '', status: '', sheetNo: '', revision: '',
               checked: '', drawn: '', date: '', preliminary: false };
for (const t of ['nsw', 'neutral']) {
  writeFileSync(`${dir}/sheet-${t}.html`, withTemplate(t, () => renderSheet(bundle, meta)));
  await htmlToPdf(`${dir}/sheet-${t}.html`, `${dir}/CONTEXT_${t}.pdf`);
}
EOF
python3 - <<'EOF'
import pymupdf
for t in ['nsw', 'neutral']:
    pymupdf.open(f'out/1-bay-street-botany-nsw-2019/CONTEXT_{t}.pdf')[0].get_pixmap(dpi=54).pil_save(
        f'web/samples/tpl-{t}.jpg', format='JPEG', quality=76, optimize=True)
EOF
```

`web/samples/og.jpg` is the image a shared link previews with, drawn from
`web/og-card.html` — a crop of `context.jpg` over a strip naming the tool. Redraw
it whenever that sample changes:

```bash
node - <<'EOF'
import { chromium } from 'playwright-core';
import { globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({
  executablePath: globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0]
    ?? process.env.CHROMIUM_PATH,
  args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(process.cwd() + '/web/og-card.html').href);
await page.$eval('.art img', (el) => { el.src = 'samples/context.jpg'; });
await page.waitForFunction(() => {
  const i = document.querySelector('.art img'); return i.complete && i.naturalWidth > 0; });
await page.screenshot({ path: 'web/samples/og.jpg', type: 'jpeg', quality: 86 });
await browser.close();
EOF
```

### One door, and an operator code

`/` is the only entrance. There used to be a second at `/fuse` for the office's
own house style, but that sheet is drawn by an ArchiCAD plugin now, and a door
whose only privilege was a graphic template had nothing left to grant.

What did not go with it is the operator permission. `/status` names the
addresses people searched for and why their sheets failed, and it had been
riding on the office tier because that was the only notion of "privileged" this
server had. It takes its own credential now:

```
ACCESS_CODE=…    # generates drawings
ADMIN_CODE=…     # also opens /status; omit and nothing opens it
```

The operator code is a superset — it generates as well — so an operator holds
one session rather than two, and the link to `/status` appears on the page only
once that code has been given. `/api/status` refuses everyone else regardless,
since hiding a link only stops the people who use links.

`ADMIN_CODE` is its own secret and is deliberately not inherited from the office
code that used to gate the house style. Those grant different things: one drew a
template, this one shows every address anyone searched for and why their sheets
failed. Promoting the old code to this one would have quietly widened what that
secret was worth, so `FUSE_ACCESS_CODE` is simply gone — delete it from
`/etc/site-analyst.env` and choose a fresh `ADMIN_CODE`.

Until one is set, nothing opens `/status`. That is the right way for it to fail:
an ops view that is closed until someone deliberately opens it, rather than one
that stays open on a credential nobody meant to repurpose.

Authentication: visitors enter `ACCESS_CODE` once and get a 30-day session
cookie. Login attempts and job submissions are rate-limited per IP, and job
outputs are deleted after 24h. `ALLOW_NO_AUTH=1` disables the gate for local use
only.

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

Retention has two ceilings, swept hourly rather than only after a job, since an
idle server reclaimed nothing before: 24h of age, and `WEB_OUT_BUDGET_MB` of
total size (default 4096, floor 256) with the oldest sheets going first. What
the sheets are really competing for is the free space the Overpass database
needs to rebuild — that rebuild is a fresh download rather than a diff and
refuses to start below 12GB free, so unbounded retention would not fill the
volume so much as quietly stop the data under the sheets being refreshed. A record whose files the
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

### Several at once

A dozen sites is an ordinary afternoon, and submitting them one at a time means
coming back every two minutes to start the next. `ADD` puts the address in the
field onto a list instead of running it; `GENERATE 5` runs the list. Collected
one at a time rather than pasted in as free text, because the type-ahead is
what keeps each address exact and a mistyped one is a sheet that fails two
minutes later.

A batch is nothing but a named list of ordinary jobs. They queue on the same
serial queue, in the same order, and each goes through the same reuse check, so
a batch of twelve where five were drawn this morning runs seven. Two spellings
of one address inside a batch share a single job, and the hour's budget is
charged for the sheets it will actually draw rather than the rows submitted.

It is deliberately not concurrency. Jobs still run one at a time, which keeps
the promise this tool makes to the four free services it is a guest of.

What stopped being a reason is the graphic template. It was a module-level
global in `src/render/template.ts`, read from forty-five places across the
renderers, and two simultaneous renders would not have failed — the second's
`setTemplate` would have changed the palette out from under the first, and out
would have come a sheet in the wrong house style, silently, and only when two
jobs happened to overlap.

Threading it through forty-five call sites was one answer. `withTemplate()` is
the other: the active template is per-async-context rather than per-process, so
a render keeps its own across every await it makes, however deep, and the
drawing code is untouched. `test/template-isolation.mts` holds both mechanisms
to the same interleaving and requires the old one to leak and the new one not
to — a test that only proves something while it can still see the bug it was
written for.

The DXF export no longer runs through `spawnSync`, which blocked the event loop
for its whole duration: for the seconds it took, the server answered nothing at
all — no progress for the visitor waiting on that sheet, and no response to
anyone else. (`src/cli.ts` still uses it, and should: a one-shot process has
nothing else to serve.)

`POST /api/batches` takes `{ addresses: [...], sheet, scale, rotate, template }`
and at most twelve, one hour's worth of the per-IP job budget. All or nothing:
half a batch accepted is worse than none, since there is no way to tell from
the outside which half. `GET /api/batches/<id>` reports a row per address, and
`GET /api/batches/<id>/zip` returns the finished sheets named by address. The
rows stay on screen once the run ends — which of the twelve worked is the
reason for running a batch in the first place.

Batches live in `out/web/batches.json`, beside the job index rather than inside
it: that file is an array an older container still reads, and a rollback that
met an object there would find no jobs at all.

### Status view

`/status` is the operator's window onto what the server has been doing: version
and uptime, whether the local Overpass is actually serving, queue depth, how
much of the output budget the sheets are using and how much room is left on the
volume underneath — and the last 24 hours of jobs with their address, options,
door, duration, size, and, for the ones that failed, the reason.

`/api/version` stays the public window and says only whether the thing is up.
This one names addresses people searched for and why their sheets failed, so it
answers the operator code and nothing else: no session and an ordinary session
both get `403 Operator access only`, and the link to it appears on the page only
once that code has been given. The page itself is served to anyone — it holds
nothing — and says to sign in with the operator code.

It refreshes every ten seconds. A failing job is the thing it exists for, so
the reason sits under the address in red rather than behind a click; the
running job is the yellow row; and `volume free` is the number to look at first
when sheets start failing for no reason the log explains, because the Overpass
database shares that disk.

### Whether the deployer is alive

It once was not, for six days, and nothing said so. An expired credential made
`git fetch` fail on the deployer's first command; `set -euo pipefail` ended the
pass there, so `ensure-domain.sh` and `ensure-overpass.sh` never ran either, and
`/api/version` went on serving the `domain` and `osmSetup` lines that earlier
passes had left behind. From outside the host it looked like a healthy server
that simply had no new commits. The only record was a log on a machine nobody
had logged into for a fortnight.

So `deploy/update.sh` now reports itself, from a trap rather than a line at the
end — `set -e` exits from wherever the failure is, and where it got to is the
thing worth knowing:

```
deployed a34daa6c1 2026-09-13T02:50:03Z     # the good case
up-to-date a34daa6c1 2026-09-13T02:55:01Z   # nothing new
deferred 3/6 2026-09-13T03:00:01Z           # a sheet is generating
unhealthy a34daa6c1 2026-09-13T02:52:10Z    # built and ran, never answered
FAILED fetch rc=128 2026-09-13T02:50:01Z    # the six-day case
```

It lands in `/var/lib/site-analyst/deploy.status` and is published at
`GET /api/version` as `deploy`, alongside the age in seconds. Public, like the
rest of that endpoint and deliberately so: being unable to see this from off
the host was the whole failure, and it carries nothing but a sha that endpoint
already publishes and a stage name.

The age is half of it. `up-to-date` from a deployer that stopped running last
week reads exactly like `up-to-date` from one that ran a minute ago, so
`/status` shows the age beside the text and marks the row red when it is a
`FAILED`, or when nothing has been written for fifteen minutes — three missed
passes of a five-minute cron, by which point it has stopped rather than merely
not run yet.

### The public door

A visitor arriving from a search result used to be shown a password field and
nothing else. The landing now says what the tool is before it asks for a code —
what it draws, from what, and what comes out — with `/about` a click away. The
operator sees the same page; there is only one now.

`robots.txt` and `sitemap.xml` are generated per request rather than kept as
files, so they follow the domain the app is actually served on instead of
naming one that `SITE_DOMAIN` could disagree with. `/api/` and `/status`
are disallowed: not secrets — the code is what grants anything — but nothing
that belongs in a search result.

A shared link previews with `og.jpg`, a 1200×630 card drawn from
`web/og-card.html`. A whole A1 sheet scaled to that width is a grey field of
unreadable lines, so the card crops one to about the size it is read at and
puts the name under it. `og:url`, `og:image` and the canonical link have to be
absolute, and a scraper resolves them without ever seeing the request, so the
pages write `%ORIGIN%` and the server fills it in from the host it was asked
for.

### Trees, parking bays and views on the site sheet

Three things the site sheet draws that the data has to be coaxed into:

- **Trees at canopy size.** Every tree is drawn as its canopy at ground scale
  rather than a fixed dot. The size is the recorded one where a council
  publishes its inventory under an open licence (City of Sydney: 49,640 trees
  with height and spread, CC BY 4.0), estimated from height or trunk where OSM
  tags one, and a nominal 6 m otherwise — drawn dashed, so the sheet never
  claims a measurement it does not have. Adding a council is one entry in
  `TREE_SOURCES` in `src/fetch/trees.ts`; an inventory with no licence
  statement does not qualify, however good it is.
- **Kerbside bays.** OSM tags parking on the road way; the cadastre says where
  the kerb is (the road reserve is the gap between the lot boundaries either
  side, less a verge). Bays are set out along that kerb at AS/NZS 2890.5
  sizes — 6.0 m parallel, 2.6 m at 90°, 3.7 m along the kerb at 45° — one
  quad per bay, none where a driveway crosses, with the count in the legend.
  Off-street car parks and individually mapped bays are drawn as OSM has
  them. The count is kerb length divided by bay length, not a survey.
- **Potential views.** The nearest skyline, the water within reach and the
  park next door are the candidates; each sight line is tested against NSW's
  5 m elevation surface from just under the site's LEP height limit, and a
  cone is drawn at the site edge, as the office draws them, only where the
  ground leaves the line clear. Buildings and trees in between are not open
  data, so the legend says: ground only.

Where a council publishes finer contours under an open licence (City of
Sydney: 1 m, from a 2020 aerial survey), they replace the state's 2 m contours
when they cover the whole sheet, and the legend names the source. Same
registry pattern: `CONTOUR_SOURCES` in `src/fetch/siteData.ts`.

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
colours and the land-use palette. Content is identical between templates; only
the look changes. They live in `src/render/template.ts`, so a new house style is
a data change.

There are three, and they differ only in the context sheet's colours:

- `classic` — the default: the NSW planning colours, softened into one pastel
  family, over a greyscale aerial.
- `nsw` — the Planning Portal's zoning colours exactly, solid and on white with
  no aerial: the base to restyle a palette from.
- `neutral` — the restrained palette with a single accent that these replaced
  as the default. It still survives a mono print.

The site and summary sheets come out the same in all three, so the page offers
the choice (the PALETTE row) for the context drawing alone, and the server draws
the other two in the default whatever it is sent — an option the page does not
show would otherwise split one request into three and draw the same sheet once
per palette. `--template` on the command line follows the same rule.

The hues are the ones NSW zoning is already read in: the Standard Instrument
LEP zoning map's, as the ePlanning zoning layer itself draws them — pink
deepening to red with residential density, blues for centres, violets for mixed
use and industry, yellow for special purposes, green for recreation, aqua for
waterways — so a planner sees R3 or E1 before reaching the legend. What that map
does not colour follows the office sheets (education blue, medical magenta,
child care outlined), and transport takes TfNSW's mode colours: orange trains,
blue buses, red light rail.

The LEP map prints those flat and at full strength on white, and `nsw` does
the same: fills opaque, as the Planning Portal draws its zoning layer, because
at part opacity every zone blends with the ground under it and no pixel on the
sheet is the NSW value any more. Solid, each zone is exactly its colour and can
be selected straight off the sheet. Its site is a black outline rather than the
house red, which is R4's red. Over a photograph at part opacity the same colours
turn to mud, so `classic` keeps the hues and evens out lightness and chroma
across them (in OKLCH, where equal numbers look equal), and draws the aerial in
greyscale so terracotta roofs stop tinting every fill laid over them. The
greyscale is a luminosity blend onto white rather than a filter, which keeps the
tiles as JPEGs in the PDF; a viewer that ignores blend modes simply shows the
photo in colour. A palette with no aerial leaves the tiles out of the PDF
altogether. Check a palette change on a real sheet, not on the legend: an
airport is one very large SP2 zone, and a yellow that looks right as a swatch
goes olive over forty hectares of grey tarmac.

The renderers read the active template from an async context rather than a
parameter, so `withTemplate()` also takes a `Template` outright — which is what
lets `test/template-isolation.mts` hold two fixtures apart without registering
either.

Fonts are limited to what the runtime image installs (Liberation, DejaVu).
Naming an absent font does not fail; it silently falls back and the sheet
comes out in the wrong face, so add the package to the `Dockerfile` first.

Options (after `--`): `--type context|site|summary|both`, `--template classic|nsw|neutral`
(default classic), `--scale 3000` (default 3000), `--job 2539`,
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
  → compose A1 sheet (SVG/HTML in the active graphic template)
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

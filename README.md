# au-site-analysis — the autonomous site analyst

Give it a NSW street address; it produces the curated site-analysis drawings
an architectural office prepares when entering the DA (Development
Application) stage — fetched entirely from open data, no site visit, no
screenshots.

Planned report sections: executive summary, regional context, site context,
sun analysis, heritage context, transport and access, walkability, public
space, amenities, planning controls, SWOT, design opportunities, design
response / massing ideas.

The fourth mode, `slides`, is the content part of a feasibility study or
design report: an A3 overall-analysis deck (context, planning, development
activity, topography, built form, movement, site, sun and views, constraints,
Country, people and market, opportunities). `docs/SLIDES_SPEC.md` fixes its
slide set and records which of that content can be fetched from the web,
endpoint by endpoint, and which stays manual.

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
for authoritative bus stops. The deck's existing-condition slide takes Google
Street View frames of each street frontage with `GOOGLE_MAPS_API_KEY=…` (a
Google Cloud key whose project has the Street View Static API enabled; add
`GOOGLE_MAPS_SIGNING_SECRET=…` if the project signs its URLs), and
Mapillary's frames with `MAPILLARY_TOKEN=…` (a free client token); without
either it reads KartaView alone. On the server they go in
`/etc/site-analyst.env`, which the deployer passes to the container.

To refresh the samples, generate the three sheets for the demo address and
re-render them (the context scale thumbnails `context-2000.jpg`,
`context-4000.jpg` and `context-5000.jpg` come from the same address at
`--scale 2000`, `4000` and `5000`, and the STYLE row's `context-kingfisher.jpg`
and `context-heron.jpg` from the matching `--template`, rendered the same way):

```bash
npm run generate -- "1 Bay Street, Botany NSW 2019" --type both
npm run generate -- "1 Bay Street, Botany NSW 2019" --type summary
npm run generate -- "1 Bay Street, Botany NSW 2019" --type slides   # slides.jpg comes from slides/03_planning_overview.png
python3 - <<'EOF'
import pymupdf
src = 'out/1-bay-street-botany-nsw-2019/'
for name, f in [('context','CONTEXT_ANALYSIS.pdf'), ('site','SITE_ANALYSIS.pdf'),
                ('summary','DEVELOPMENT_SUMMARY.pdf')]:
    pymupdf.open(src+f)[0].get_pixmap(dpi=54).pil_save(
        f'web/samples/{name}.jpg', format='JPEG', quality=76, optimize=True)
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

### Zones, neighbours, sun and wind on the site sheet

The site sheet no longer writes the neighbours' zone on the map. Each zone is
a hatch in its family's ink (the active template's palette) with a fine
outline and no fill, so the aerial stays visible under it; the pattern is the
category's texture (lines where it has none) and its strength the category's,
and the legend names each zone once. Nothing is drawn over the site.

Each neighbouring building carries two short lines: its street number(s) and
its storeys — `26` over `3ST` (a run of numbers on one building reads
`32–34`). Storeys are Overture's count, or its measured height at 3.1 m a
storey, or OpenStreetMap's `building:levels` where Overture has neither; with
no height anywhere the building keeps its number and no storey line. Street
names are plain bold text along the road, without the white arrow band, slid
along it clear of the labels already set. The numbers and street names are white, and every word on the map and in the
legend is set in Arial Narrow (Liberation Sans Narrow on the server).

Every word on the map is one size. Potential views are a telescope just
outside the site edge, aimed along the bearing, with what it found — the
distance and "TERRAIN CLEAR" — written under it, along its line, in the site
pen's lettering. The site itself — boundary, corners,
dimensions and levels — is a deep red, apart from that coral pen.

The sun, the winds and the noise are drawn in one hand, in the template's
site ink and open white-filled marks: a hand-drawn sun — a disc with
flame-like rays — at the summer and winter sunrise and sunset, on a solid
summer arc and a dashed winter arc, each arc marked with a dot and the time at
every solar hour; the prevailing winds as three widening arrows blowing in
toward the site, stopping short of a sun from the same quarter. Noise — the
busy roads and the railway — is drawn like the wind but in blue, white in a
blue pen, beside the source on the site's side: three wavy lines side by side,
each swelling toward its middle and tapering at its ends. A view's distance and "TERRAIN CLEAR" are set in two rows. The
sun, wind and view lettering is set heavy. Contours are green; the cadastre
and the neighbours' building outlines are white over the aerial.

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

There are three: Flamingo, the default, Kingfisher and Heron.

**Flamingo** (`flamingo`) sits on plain paper. Four tints, each a family —
peach for the residential zones, sand for the centres, teal for open space and
the institutions, blue for water, grey for the rest — with the categories
inside a family told apart by tone and by texture (dots, hatch, cross-hatch,
drawn as real lines so they print crisply) rather than by another colour. The
residential tiers step from a bare blush (R2) through peach (R3) to a deeper
salmon with hatch (R4). The site is the one accent, coral. Every building
footprint (Overture, OpenStreetMap as the fallback) is filled white with a
hairline of its ground's family ink, so a block reads as white figures on a
tint and not as more of the white street; the streets are white strips over
the tints, the road reserve scaled from the function hierarchy, named in a
narrow deep green (Arial Narrow where it is installed, Liberation Sans Narrow
on the server). The stops and stations are solid roundels with a white
letter, the bus routes a faint dotted line, the railway a red dotted line, and
the walking catchments green dotted lines with "5 MIN" and "10 MIN" written
along them, twice per ring, on clear straight stretches.

**Kingfisher** (`kingfisher`) is Flamingo in the palette of a masterplan
reference, sampled from it: every zone a pale ground with its buildings filled
in the family's strong colour (`footprints: 'colour'`). The residential zones
take the warm colours — yellow ground with orange buildings for R2, pink for
R3, cyan for R4, peach for mixed use — and green is kept for green space alone,
open space the deep mint with black dots. The local and commercial centres and
retail are the blue family, told apart by texture, the institutions lavender,
industry grey on stone; water the bright cyan, the site and heritage in magenta
and purple, the railway orange. The legend swatch shows a few buildings on
their ground. The sampled colours are eased by about a fifth of their
saturation so the sheet sits a little quieter than the image. Streets, numbered
places and the dotted lines are Flamingo's, but the street names and the number
discs are a light leaf green, in the hue of the reference's fields.

**Heron** (`heron`) is the office sheet the restyle began from: the aerial,
in greyscale (`aerialTone: 'grey'`), with the lots and every building as heavy
white lines over it (`lots: 'white'`, `footprints: 'outline'`) and all its
text in white Arial Narrow (institutions' number discs a reddish brown, parks' green, `discInk` and `discParkInk`), under a light
white veil with the tints at full strength over it (the palette
sampled from that sheet's legend — tan mixed use and centres, peach
residential, mint open space, the institutions in outlined slate blues), no
building footprints and no white street strips, every street named in plain
bold black straight on the photo (no arrow bands or outline;
`streetLabels: 'band'` brings the bands back), and the walking
catchments as continuous green lines at reduced opacity with solid green walker discs. From Flamingo it
takes the solid stop roundels, the red dotted railway and the numbered
places with their key, the discs in black.

The retired ids still resolve: `flamingo-white` to Flamingo, `flamingo-2` to
Kingfisher, and
`flamingo-aerial`, `redfern-white` and `redfern-aerial`, like any unknown id,
to the default.

Common to all: the only words on the map are the street names. Every
institution and park carries a number instead, a solid disc with the number
knocked out, and the legend carries the key: the institutions in the legend's
category order, then the open spaces, then the stations under their roundel
letter. The key has only the column the legend leaves it, so past twenty-four
entries its rows tighten, and when a wide window would still overrun it the
places nearest the site are kept and the rest go, from the map as well as the
key. The aerial tiles are fetched whatever the template; the CAD export
carries them on its own layer.

What differs between templates beyond colour is declared on the template:
`ground` (`paper` or `aerial`, with `veil` and `tintScale` for the aerial), `footprints`
(`white`, `colour`, `outline` or `none`), `lots` (`faint` or `white`), `streets` (`white` or `none`), `streetLabels`
(`plain` or `band`),
`isochrone` (`band`, `line`, `dotted` or `walkers`), `roundel` (`ring` or `solid`), `busLine`
(`dashed` or `dotted`), `railLine` (`sleepers` or `dotted`), `streetFont`
and `streetInk`, and each category's `texture`, `textureColor` and `figure`
(the hairline ink of a white footprint). The CLI takes `--template`; the web
picker has a STYLE row and the job request carries `template`, an unknown one
falling back to the default. The office style that sat beside these left with
the office door, and took the elaborate compass rose with it — that was the
only thing the `symbols` field ever selected between, so it went too.

The renderers read the active template from an async context rather than a
parameter, so `withTemplate()` also takes a `Template` outright — which is what
lets `test/template-isolation.mts` hold two apart while only one is registered.

Fonts are limited to what the runtime image installs (Liberation — the 1.07
line Debian bookworm ships, which includes Liberation Sans Narrow for the
street names — and DejaVu).
Naming an absent font does not fail; it silently falls back and the sheet
comes out in the wrong face, so add the package to the `Dockerfile` first.

Options (after `--`): `--type context|site|summary|slides|both`, `--scale 3000` (default 3000;
the web picker offers 1:2000, 1:3000, 1:4000 and 1:5000, the server accepts 1000 to 6000),
`--template flamingo|kingfisher|heron` (the graphic template, see Templates below),
`--slides-scale 8000` (the deck's map panels), `--da-years 5` (the deck's
development window), `--job 2539`, `--client "Name"`,
`--status "DEVELOPMENT APPLICATION"`, `--sheet "DA 003"`.

### The deck

`--type slides` draws the OVERALL ANALYSIS deck: A3 landscape pages for the
content part of a feasibility study or design report, specified in
`docs/SLIDES_SPEC.md`. All eighteen slides of the spec exist. First *location*: the
site in its region at 1:75,000 — the local government areas as the land
(the harbour and the sea left blue), the water, the railways and arterial
roads, the stations, the suburbs named, 2 and 5 km rings round the site, and
the centres of The Sydney Plan (2026) by type — with the distance to the
Sydney CBD, the nearest centres and stations, and the region, the former
district and the council. Then *character*: Wikipedia's summary of the suburb
as the seed text, the places within 1.5 km with articles of their own,
numbered on an aerial of the planning window, and a strip of open-licence
photographs within 800 m from Wikimedia Commons, each credited as its licence
asks, all of which the office's own reading and photographs replace. Then
the planning pair: a
*planning overview* of four maps at 1:8000 around the site (land zoning in the
statutory colours, height of building, heritage with the State Heritage
Register, and the housing-policy maps — TOD areas, town centres, State
significant development sites, precincts) and *planning controls at the site*,
a table of every mapped control with its source and currency: zone, height
(with its units, since some LEPs limit in RL), FSR, lot size, heritage,
local provisions, SEPP maps, the DCP with its link, contributions, tree
canopy and the council's housing target. Then *strategic context*: the
documents over the site, top down and one line each with their links — the
State Land Use Plan, the regional plan at the point (The Sydney Plan since
13 August 2026, which replaced the 2018 Region Plan and the five district
plans; the 2041 regional plans elsewhere), the council's local strategic
planning statement from the Planning Portal's index, the plan, the DCP, the
contributions and the housing target — with the extracts left to the author.
Then *topography*: the landform
at 1:8000 as a hillshade from the State's 5 m elevation model with the 2 m
contours, roads and rail over it and two section lines through the site,
A–A′ down the steepest fall and B–B′ across it, each drawn as a section
with the site and its levels marked; the text gives the site's RL range,
fall, grade and aspect and where the high ground and the water are. Then
*built form*: every building footprint in the window coloured by height
band (Overture Maps, read from its public bucket by DuckDB through
`src/py/overture_buildings.py`; OpenStreetMap through Overpass when DuckDB
or Overture is not there; where neither gives a height, the storeys of a
determined development application on the lot, hatched and said so), the
storeys of the buildings within 250 m as a
histogram with the LEP height plane marked on it, and section A–A′ again
with the buildings it meets drawn at their heights and the height plane
dashed over the site. Then *movement*: roads by function, rail and
stations, the walking isochrones from the site (Valhalla, 5, 10 and 15
minutes), bus stops (Transport for NSW with the key, else OpenStreetMap),
bus routes, cycleways, footways and one-way streets (OpenStreetMap through
Overpass) and the LEP's active street frontages, with a table of the
nearest stations and a wide walking-reach strip at 1:16000 naming the
suburbs and stations around. Then *green and public domain*: the parks and
reserves around the site (the recreation and conservation zones, and the
Greater Sydney Green Grid's named assets where the Grid reaches), the
National Parks estate, the public facilities — schools, childcare, libraries,
pools, health and community centres — the council's street trees drawn at
crown size where an inventory is open (City of Sydney), the walking
isochrones again, four figures (the canopy on the site's block, the share of
the window that is public open space, the nearest park, the facilities), a
table of the nearest open spaces with area, distance and walk band, and a
wide strip of the 2022 tree canopy by mesh block, against the Region Plan's
40 % target. Then *environmental constraints*: two maps of what the
State's hazard, protection, coastal and corridor layers put around the site
(bushfire prone land, flood planning, landslide, acid sulfate soils,
salinity, mine subsidence, groundwater and drinking-water catchments,
riparian land and wetlands, the coastal maps, biodiversity and scenic
protection, airport noise and obstacle limitation surfaces, rail corridor
and future infrastructure corridors) and a table that gives every layer a
definite answer — at the site with its class, nearest in the window, none in
the window, or not mapped by this LEP at all, checked plan-wide so an
absence is stated rather than implied — with the arterial roads and
railways beside the site as noise sources and the soil landscape at the
site. Then *Country*: the open layers of Country over the wide strip — the
pre-1750 plant communities of the State Vegetation Type Map over the land's
shape, with the watercourses, the coast, the crests read from the elevation
model, the National Parks estate and the gazetted Aboriginal Places — with
the Local Aboriginal Land Council, the National Native Title Tribunal's
registers at the site and over the strip, the plant community and the soil
landscape at the site, the nearest watercourse and foreshore, the site's
level against the nearest crest, the gazetted places within 10 km and the
public ASDST likelihood model; the slide states that AHIMS is not open and
that a search precedes any works, and that the name of Country, the language
and the cultural narrative are the office's to develop with Knowledge
Holders, not generated. Then *the site*: the site plan on the aerial at a round scale that
fits the lot, with the boundary lengths from the digital cadastre, the
corner levels from the elevation model, the existing footprint and its
height, the neighbours' numbers and the street names, the easement
geometry where the cadastre has any; a table of what the open data says
before the survey and the title search (lot and plan, areas, frontages,
zone, height, FSR, lot size, heritage, the existing building, levels,
easements, land value, sales, public land, the imagery's capture date);
and the block at 1:4000 with the last two years of single-property sales
within 300 m sized by price, the State government and Crown parcels, and a
table of the latest sales. Then *existing site condition*: with a Google
key, Street View frames of each street frontage (square to it, at the
corners, oblique to the long ones and along the street both ways), kept only
where the camera stands in the street and sees the site past its neighbours;
then the open street-level frames that look at the site (KartaView, no key;
Mapillary with a client token), one per side of the site where there is one;
all keyed by number to a plan of the camera positions with each view cone
and captioned with the street, the distance and direction from the site, the
direction of view, the source or contributor and the month; the 1943 aerial survey of Sydney beside
today's imagery over the same ground at 1:2500; and, where no open frame
covers a side, placeholders sized for the site visit's photographs, which
replace all of these. Then *grid, sun and views*: the bearings of the
street grid (the roads in the window, length-weighted, in 5° bins, drawn as
a rose) and the site's long axis against them; the sun path computed for the
site (21 June in standard time, 21 December and the equinox in daylight
time, the hours marked) with sunrise, the noon altitude and sunset; the
neighbours' shadows over the site on 21 June at 9 am, noon and 3 pm, cast
from the footprints and their recorded heights at the site plan's scale,
with the share of the site each hour leaves in shadow; and the sight lines
from an eye just under the height limit, over the 5 m elevation model, to
the skylines within range, the named water and the coast and the park next
door — a cone where the ground leaves the line clear, a dashed line to the
point where it rises across it — with a table of them. Then *development
activity*: every
application lodged in the council area over the last five years, from the
Planning Portal's Online DA feed, clipped to the window around the site. The
ones of a scale that shapes the context — four storeys, ten dwellings or
$5 M and up, house-scale work discounted — are numbered on the map, coloured
by status and sized by cost, over the TOD and precinct washes and any planning
proposal on exhibition; beside it four figures (applications, sites of scale,
dwellings proposed, value), lodgements per year and a table of the largest
sites as lodged, with storeys, dwellings, cost, status and dates. The feed is
council-wide and slow, so it is cached on the volume for a day
(`out/.cache/da/`); `--da-years 5` sets the window. The State significant
applications come from the Department's Major Projects register, which has
no feed: its listing for the council area and each project's page are read
and cached (`out/.cache/majorprojects/`, a week), and the projects in the
window are drawn as S-numbered diamonds and head the table with their
stage, decision and date, one on the site flagged as such. Then *people and market*:
the site's SA2 and LGA against Greater Sydney (or the rest of the state) from
the 2021 Census — medians, age profile, dwelling structure, tenure, travel to
work — with the ABS population series since 2001 and the TZP24 projection to
2066, SEIFA 2021, the Valuer General's land values of the site and the sales
register within 400 m, and the nearest government schools with their
enrolments. Census tables, projections and the school dataset are cached on
the volume for a month. Last, *opportunities and constraints*: two diagrams
at 1:4000 around the site assembled from the layers the other slides fetched
— reach, the housing-policy maps, active edges, open space, the clear sight
lines and the winter sun's sweep on one; heritage, the hazard and corridor
layers, the busy roads, the neighbours' winter shadows, the fall, easements
and street trees on the other — with numbered markers keyed to two lists of
templated statements (up to nine each) that the data supports and the author
edits: the nearest station and its walk, the TOD or town-centre map, which
frontage faces north, what shades the site, the controls, the heritage item
next door, the arterial road on one edge, the fall across the lot. And
*sources*: every dataset the deck read, grouped by publisher, with the slides
it served, its currency or edition (the LEP maps' currency dates and
amendments, the aerial's capture date, the census and canopy years, the land
values' base dates, the development feed's range, the Overture release), when
it was retrieved or when its cache was filled, and the attribution and
licence; with the layers' own dates, what is computed rather than sourced,
what remains to be obtained outside the open data, and the run's warnings.
Each slide carries the sentences that follow from the data and a marked
placeholder for the author's narrative. Outputs: `OVERALL_ANALYSIS.pdf`, `slides/<id>.png` per slide and
`overall.json` with everything the deck says.

Where a council publishes its own DCP mapping as open data — the City of
Sydney does — the deck reads it too, for the sites in that LGA: building
height in storeys, street frontage heights, active frontages, setbacks.

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

On the context sheet every street carries its name as plain bold text set
along, and centred on, its white strip; the width of the strip already says
whether it is an arterial or a lane (Heron, with no strips, sets the same
black name straight on the aerial). The white double-headed arrow band survives
on the site sheet only, where a through street carries its name in the band and
a laneway gets a plain label. Neither of the two fields NSW publishes decides
that on its own — Dickson Lane is classified `LocalRoad` exactly like Hall
Street, and plenty of real streets have no lane count recorded — so the rule
combines them: function hierarchy 7+ (service lane, track, path, access way), a
name ending in LANE/WALK/PATH/TRACK, or a recorded single lane means laneway,
otherwise street.

The road network arrives split at every intersection, so the pieces of each
street are chained back into continuous runs before labelling; without that, a
name could never span a junction and an arterial would come out looking like a
laneway. A long street repeats its name up to three times. Every label — street
and place name alike — reserves the ground it covers, and place names go first
because they belong to a parcel and cannot move, so a street name slides along
its road to find clear space or is dropped rather than overprinted.

## Repository is private

`examples/` contains real project sheets used as the style/content reference
— do not make this repository public.

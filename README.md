# au-site-analysis — the autonomous site analyst

Give it a NSW street address; it produces the curated site-analysis drawings
an architectural office prepares when entering the DA (Development
Application) stage — fetched entirely from open data, no site visit, no
screenshots.

Planned report sections: executive summary, regional context, site context,
sun analysis, heritage context, transport and access, walkability, public
space, amenities, planning controls, SWOT, design opportunities, design
response / massing ideas.

The options table offers four drawings: **context**, **site**, **yield** and
**site report**. The yield (`--type yield`) took the development summary's
place: see *The planning yield* below. The site report is the `slides` mode,
relabelled on the page and in `/about`; its API value, its files and its CLI
`--type` are still `slides`. The summary is still drawn for a request that
names it (`--type summary`, `sheet: "summary"`), so older batches keep working.

The site report, `slides`, is the content part of a feasibility study or
design report: an overall-analysis deck (context, planning, development
activity, topography, built form, movement, site, sun and views, constraints,
Country, people and market, opportunities). Each A3 landscape sheet is laid
out as a book spread that folds at its vertical centre into two A4 pages —
the left page the title, narrative and side column, the right page the
figures, with running heads, facing folios and fold ticks — so the printed
deck binds into an A4 booklet. `docs/SLIDES_SPEC.md` fixes its
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
press. Under the table, a frame of its own shows the expected result: the
sheet the chosen options produce — drawing, scale, north and style together —
drawn for an example address, the picture alone. It follows what is picked,
not what the pointer is over. `/about` explains the tool to
anyone who lands on it: what the four drawings contain, where the data
comes from, and what the output must not be relied on for. The generator
itself sits behind a free account (see *Free, one site, and subscription* below), and
`/pricing` compares the two sides. Sample thumbnails live in `web/samples/`
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

With the key, slide 02 shows each numbered place from the street (the
camera aimed at the place's building, a view blocked by another building
refused) and slide 12 walks the site's street end to end in eight frames.
To control a picture by hand, put `photo_overrides.json` in the address's
output folder and run again:

```json
{ "places": { "1": { "lat": -33.8925, "lon": 151.2070, "heading": 95, "fov": 70 }, "5": { "skip": true } },
  "street": { "3": { "heading": 270 } } }
```

A camera point takes the nearest panorama to it; `heading`, `pitch` and
`fov` turn it; `skip` drops the frame.

The frame's pictures are `web/samples/result-<sheet>-<scale>-<rotate>-<style>.jpg`
for the two maps (the context sheet in each of its four templates, the site
sheet in each of its themes), `result-yield.jpg` for the yield and
`result-slides-1.jpg`, `-2`… for the site report's pages, which have no
styles — one for every
combination the table offers, the names `web/app.js` asks for. A combination without one says so in the frame
rather than showing a broken image. They are drawn for 150 George Street,
Parramatta; to redraw them, or to move them to another address (and change
`EXAMPLE_ADDRESS` in `web/app.js` to match):

```bash
pip install pymupdf      # rasterises the PDFs
npm run samples -- "150 George Street, Parramatta NSW 2150"
# or a part at a time: --only context | site | yield | slides (| summary, which the table no longer offers)
```

Or let GitHub draw them: **Actions → samples → Run workflow**
(`.github/workflows/samples.yml`) runs the same script on GitHub's runner,
inside the image the server runs, so it needs nothing installed and reaches
every service the pipelines read. Pick which drawing (`site` by default) and
the address. Started on `main`, it pushes the pictures to a new branch,
`samples/run-<n>`, and opens a pull request into `main`. If the repository
does not let Actions open pull requests, the run's summary links to opening
one by hand. Started on another branch, it commits them to that branch. A
run in which any data source failed (any `WARN` line in its log) commits
nothing and lists the failures in its summary, since its pictures would be
missing that source's layer; `allow_warnings` overrides that when the gap is
known. It only ever runs when started by hand, so like `checks` it never
spends the public services' capacity on its own. The TfNSW, Google Maps and
Mapillary keys are read from repository secrets of the same names when they
are set.

Each scale and orientation is fetched once and drawn in every style,
since a style changes how a sheet looks and never what it fetches. The
site report's frame turns through its pages, one every second and a half, from
`result-slides-1.jpg` until a number has no picture; the pointer over it
holds the page and a click turns it.

`web/samples/context.jpg`, the Botany context sheet, stays only as the source
of the link-preview card below.

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

### Free, one site, and subscription

Every account generates every drawing, from the same data, drawn the same way;
what differs is what can be taken away:

| | free | one site | subscription |
|---|---|---|---|
| PDF | stamped with the watermark | clean, for that address | clean |
| CAD (DXF/DWG) | — | for that address | yes |
| data (CSV, JSON) | — | for that address | yes |
| lasts | — | 30 days | while subscribed |

A site is bought from its drawing: under a free account's finished sheet,
UNLOCK THIS SITE goes to Stripe for one card payment, and back to the same
drawing, now clean. It covers every drawing of that address at any scale or
style, matched on the address with case, punctuation and spacing ignored. A
site is what most offices need once per project; the subscription is for
whoever screens sites every week.

`src/plans.ts` is that table in code, and every download route reads it, so a
new privilege is a new column there rather than a new condition in the server.

**Accounts.** Anyone can make one on `/` with an email and a password (`SIGN
UP`), and starts on the free side. Accounts live in `out/accounts/accounts.json`
on the host volume, beside the job index and written the same way, with scrypt
password hashes; the key that signs session cookies is `SESSION_SECRET`, or,
unset, one made once and kept in the same directory, so a deploy signs nobody
out. `ACCESS_CODE` still works and carries the subscription, so the office keeps
clean PDFs and CAD without an account; unset it once everyone has one.
`SUBSCRIPTION_EMAILS=a@x.com,b@y.com` gives those accounts the subscription
without charge, which is also the way to see the subscriber's side before
billing is switched on.

**The watermark.** Put it in `assets/watermark/watermark.png`. It is stamped on
each page when a free account downloads, not when the sheet is drawn, so the
sheet on disk stays clean and one job serves both sides: a subscriber asking
for an address a free account has just drawn gets it at once, clean. Until the
file is there, the words `SITE ANALYST · FREE` stand in. If stamping fails the
download is refused rather than served clean.

**Payment.** Stripe Checkout sells both, and Stripe's customer portal manages
the subscription (card, invoices, cancelling), so no card number reaches this
server. To switch it on, in Stripe's dashboard:

1. Make a product with a recurring price; its `price_…` id is `STRIPE_PRICE_ID`.
   Make another with a one-off price for a site; its id is `STRIPE_SITE_PRICE_ID`.
   Either can be left out, and that way to pay stays closed.
2. Add a webhook endpoint at `https://<domain>/api/billing/webhook` sending
   `checkout.session.completed` and `customer.subscription.created`, `.updated`
   and `.deleted`; its signing secret is `STRIPE_WEBHOOK_SECRET`.
3. Save the customer portal's settings once (Settings → Billing → Customer
   portal), or MANAGE BILLING has nothing to open.

Then in `/etc/site-analyst.env`:

```
STRIPE_SECRET_KEY=sk_live_…     # sk_test_… to try it first
STRIPE_PRICE_ID=price_…           # the subscription
STRIPE_SITE_PRICE_ID=price_…      # one site
STRIPE_WEBHOOK_SECRET=whsec_…
PRICE_LABEL=A$49 a month          # what /pricing says each costs
SITE_PRICE_LABEL=A$79
```

Unset, `/pricing` says subscriptions open soon and the free side works alone.
`/api/version` reports whether `billing` is on. Once it is, `/status` asks Stripe
what it has and says, a line each: which Stripe account the key belongs to and
whether it is live or test, each price and whether it is the right kind
(recurring for the subscription, one-off for a site), the webhook endpoint and any event it is
missing, whether the customer portal is saved, and whether an event has arrived
signed with `STRIPE_WEBHOOK_SECRET` — Stripe never shows the secret again, so
use the endpoint's "send test event" once and this line turns to `matches`. The
same lines go to `docker logs site-analyst` at every start. A subscription is on while Stripe calls it `active`
or `trialing`; the webhook moves the account back to free when it lapses, and
on again when a retried payment lands.

The routes: `POST /api/signup` and `/api/login` (`{email, password}`, or
`{code}` as before), `POST /api/billing/checkout` and `/api/billing/portal`
and `/api/billing/unlock` (`{job}`; each answers `{url}` to send the browser
to), and the webhook. `/api/me` reports the session's `plan`, its `grants`, its
`account` with the sites it has bought, and which ways to pay are open;
`/api/jobs/<id>` reports what this viewer may take of that drawing (`grants`)
and, where the site can be bought, its price (`unlock`). A free account asking
for `/cad` or `/data` of a site it has not bought gets `402`. `test/plans.mts` drives all of it on a
planted sheet, without drawing anything or calling Stripe.

### One door, and an operator code

`/` is the only entrance. There used to be a second at `/fuse` for the office's
own house style, but that sheet is drawn by an ArchiCAD plugin now, and a door
whose only privilege was a graphic template had nothing left to grant.

What did not go with it is the operator permission. `/status` names the
addresses people searched for and why their sheets failed, and it had been
riding on the office tier because that was the only notion of "privileged" this
server had. It takes its own credential now:

```
ACCESS_CODE=…    # generates drawings, with the subscription; optional
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

Authentication: visitors sign in with an account, or enter `ACCESS_CODE` once,
and either way get a 30-day session cookie. Login attempts, sign-ups and job
submissions are rate-limited per IP, and job outputs are deleted after 24h.
`ALLOW_NO_AUTH=1` disables the gate for local use only, and only while no
`ACCESS_CODE` is set.

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
coming back every two minutes to start the next. The page used to collect them
with an `ADD` button beside GENERATE; that is gone, to keep the bar to the
address and the one button, and the page runs one address at a time. Running
several at once is still the batch endpoint below.

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
`GET /api/batches/<id>/zip` returns the finished sheets named by address.

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
outline, so the aerial stays visible under it; the pattern is the
category's texture (lines where it has none) and its strength the category's,
and the legend names each zone once. A theme can also tint each zone in its
category's fill under the hatch (`zoneTint`, the tint's opacity), multiplied
into the photograph so the roofs and trees still show through it. Nothing is
drawn over the site.

Each neighbouring building carries two short lines: its street number(s) and
its storeys — `26` over `3ST` (a run of numbers on one building reads
`32–34`). Storeys are Overture's count, or its measured height at 3.1 m a
storey, or OpenStreetMap's `building:levels` where Overture has neither; with
no height anywhere the building keeps its number and no storey line. Street
names are plain bold text along the road, without the white arrow band, slid
along it clear of the labels already set. The numbers and street names are white, and every word on the map and in the
legend is set in Arial Narrow (Liberation Sans Narrow on the server).

Every word on the map is one size, which a theme can scale as a whole
(`textScale`; Heron sets it a fifth larger). Potential views are a telescope just
outside the site edge, aimed along the bearing, with what it found — the
distance and "TERRAIN CLEAR" — written under it, along its line, in the site
pen's lettering. The site itself — boundary, corners,
dimensions and levels — is in Heron's red, and the sun, winds and views are drawn
in grey, so the site reads first and the analysis quietly round it.

The sun, the winds and the noise are drawn in one hand, in open white-filled
marks (in Heron the sun and the winds in grey, the noise in blue): a sun drawn as an open jagged crown
of twelve teeth round a plain circle, four of them short, broad flames — at the summer and winter sunrise and sunset, on a solid
summer arc and a dashed winter arc, each arc marked with a dot and the time at
every solar hour; the prevailing winds as three widening arrows blowing in
toward the site, stopping short of a sun from the same quarter. Noise — the
busy roads and the railway — is drawn like the wind but in blue, white in a
blue pen, beside the source on the site's side: one continuous band, swaying
gently and swelling a little along its length. A view's distance and "TERRAIN CLEAR" are set in two rows. The
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

- **Services, where the licence allows.** The pipes, pits, poles and lines
  next to the site come from publishers that release them under an open
  licence, and nowhere else: City of Sydney's stormwater pipes (with their
  diameter), drainage pits (with their invert level) and light poles (CC BY
  4.0, inside the LGA), Geoscience Australia's high-voltage lines and
  substations (CC BY 4.0, everywhere), and what OpenStreetMap maps (ODbL):
  overhead lines, cables, pipelines, substations and transformers, street
  cabinets and manholes. Adding a publisher is one entry in
  `SERVICE_SOURCES` in `src/fetch/services.ts`. A public layer with no licence
  statement does not qualify, nor one whose terms contradict its label: that
  leaves out Parramatta's, Canterbury-Bankstown's and Bayside's stormwater,
  Essential Energy's network and Before You Dig's Look Up and Live layers.
  Endeavour Energy's portal (ODbL on the datasets, use-only terms on the
  portal) is wired in as a trial, off unless asked for with
  `SERVICES_TRIAL=endeavour` or `--trial-services endeavour`: its cables
  (11 kV labelled), poles, pillars and substations with today's spare kVA,
  every row of the legend marked TRIAL until Endeavour confirms the ODbL in
  writing. Water and sewer mains, gas, electrical cables and telecom pits are
  not open anywhere; every site sheet says, under its legend, that what it
  draws is open data only and no substitute for a Before You Dig enquiry. The
  colours are AS 5488.1's for marking buried services: electricity orange
  (underground dashed, overhead solid, high voltage heavier in a deeper
  orange), water blue, stormwater green, sewer cream (darkened to read on
  paper), gas yellow, communications black. The CAD export carries the
  services on `SA_SERVICES-<KIND>` layers in the same colours.
- **The trees by the site, with their data.** The trees within 15 m of the
  boundary are numbered T1, T2… nearest first (sixteen at most) and listed in
  the legend with what their source recorded — species, height, canopy and
  trunk — and, where a trunk diameter is recorded, their tree protection zone
  is drawn dashed: AS 4970-2009's 12 × DBH, between 2 and 15 m.

The licences' attributions are folded by holder ("Trees, contours, drainage
and light poles © City of Sydney, CC BY 4.0") and printed under the date, or
at the foot of the legend when they run longer than a line.

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
- **Planning yield** — `PLANNING_YIELD.csv` (section, item, controls,
  proposed, compliance) and `PLANNING_YIELD.json`, the table with the numbers
  behind it: every tier's setbacks and areas, the floor-by-floor floor area,
  the mix, the parking and the affordable-housing scenario.
- **Development summary** — `.csv` (opens in Excel, pastes into a Word or
  InDesign table) and `.json` for anything reading the controls
  programmatically. A table is data, not geometry, so DXF would only produce
  loose text entities.

### Graphic templates

A template is the sheet's appearance — typeface, text scale, line and fill
colours and the land-use palette. Content is identical between templates; only
the look changes. They live in `src/render/template.ts`, so a new house style is
a data change.

Templates are the context sheet's. The site analysis has its own themes (see
Site analysis themes below), and the yield, the development summary and the
deck have none: they are always drawn in the default template.

There are four: Flamingo, the default, Kingfisher, Heron and Canary.

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
narrow light cucumber green (Arial Narrow where it is installed, Liberation Sans Narrow
on the server); the parks' number discs share that green and the institutions'
discs take the sand family's light brown. The stops and stations are solid roundels with a white
letter, the bus routes a faint dotted line, the railway a red dotted line, and
the walking catchments green dotted lines with "5 MIN" and "10 MIN" written
along them, twice per ring, on clear straight stretches. Where the sheet holds
more than one train station they are numbered T1, T2… nearest the site first
(light rail L1, L2…), on the map and in the key, in every template. A bus or
light rail stop that would overlap a station or another stop is left off, so
a pair of stops either side of a road reads as one roundel.

**Kingfisher** (`kingfisher`) is Flamingo in the palette of a masterplan
reference, sampled from it: every zone a pale ground with its buildings filled
in the family's strong colour (`footprints: 'colour'`). The residential zones
take the warm colours — yellow ground with orange buildings for R2, pink for
R3, cyan for R4, peach for mixed use — and green is kept for green space alone,
open space the deep mint with black dots. The local and commercial centres and
retail are the blue family, told apart by texture, the institutions lavender,
industry grey on stone; water the bright cyan, the site and heritage in magenta
and purple, the railway orange. The legend swatch shows a few buildings on
their ground. The colours are exactly those the reference prints. Streets, numbered
places and the dotted lines are Flamingo's, but the street names and the institutions' number discs
are the reference's peach, the parks' discs a light leaf green, and the lots
and every building are drawn in a heavy white line.

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

**Canary** (`canary`, formerly Conure) is Heron with the zoning in exactly
the NSW ePlanning Land Zoning colours (`zoning: 'lep'`): each zone code in its
statutory fill, keyed by code and name (R2 LOW DENSITY RESIDENTIAL, E1 LOCAL
CENTRE, SP2 INFRASTRUCTURE…), with no institution or railway tints laid over
it and heritage in the ePlanning item tan. The numbered places are black discs, and
the walking catchments plain black lines with their time and distance written
along them ("5 MIN · 400M", `isochrone: 'labelled'`) instead of walker
medallions. The aerial, lines and lettering are Heron's.

The retired ids still resolve: `flamingo-white` to Flamingo, `flamingo-2` to
Kingfisher, `conure` to Canary, and
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

### Site analysis themes

The site sheet does not take the context templates. It has themes of its own,
listed in `SITE_THEMES` in `src/render/template.ts`; each names the template
it draws on for what it does not set itself (the typeface and the zones'
palette), and the sheet sets the rest — its `look` (`SiteLook`): the face, the
veil and the aerial's tone, the site's pen and dash, how the zones, heritage,
neighbours, streets, suns, winds, noise, views and kerbside parking are drawn,
and in which inks. There are four, on the aerial or on paper:

**Heron** (`heron`, the default) — the aerial with the zones hatched, in the
Heron template's colours. The aerial goes grey outside the site (`aerial: 'grey'`, by the
same saturation blend as the context sheet), so the lot alone keeps its
colour; the zones are hatched and tinted in Heron's palette (tan centres and
mixed use, peach residential, mint open space, slate institutions; the tint
at 0.55, multiplied into the grey photograph, since Heron's tints are too pale
to read as a hatch alone), the site, its levels and its boundary dimensions
are in Heron's red, and the fall arrow in its slate; the FALL and AREA are
written in the red too, plain on the photograph like the levels, with no box
and no white edge (`fallWords: 'plain'`). Every word on the map is set a fifth
larger than the other site themes' (`textScale: 1.2`). The
neighbours' numbers and storeys and the street names are white over a fine
white outline of each building, noise in blue, and the climate is drawn
quietly as before: the sun, its path, its hours and words, the telescopes and
the winds in one grey, the contours in a lighter grey. The sun is an open
crown of twelve uneven teeth round a plain circle, the four on the diagonals
drawn out as short, broad flames. It draws on Heron. It was called Dove (on
Flamingo's palette, with the site in a deeper red) and before that Cardinal
(with the sun in mustard and the winds and views in red); a request that still
names `dove` or `cardinal` is drawn in Heron.

In every style, the services' words (11 kV, Ø 375, DS 1616 · 969 kVA spare) are
plain Arial with no white halo. Where no open tree data reaches the site (no
council register, nothing in OpenStreetMap within 15 m), the legend says so
instead of leaving the trees out without a word.

**Kingfisher** (`kingfisher`) — Kingfisher on paper, with no aerial: the
zones as Kingfisher's pale grounds with their textures, laid on the lots only
so the roads stay white (water is drawn whole), every building in its zone
family's strong colour with a white edge and its number in white (a quiet grey
on the site and where no zone is mapped), the white cadastre, Kingfisher's
grotesk, its peach street names and its magenta site. The suns are the
office's own drawn suns (`src/render/climateSymbols.ts`, traced from its
symbol sheet) in yellow, a different one at each solstice rise and set, and
the winds its triple arrows in light blue, set on the sun path's summer ring
at their bearing and pointing in at the site, slid along the ring off a sun
from the same quarter; both are large (a sun 44 mm across, a wind 80 mm long
on the A1). The ring is a bold yellow line, solid in summer and dashed in
winter, and carries no hours. Views are plain outlined triangles opening
from the site edge, their distance written beyond the open end or, where a
sun's name is there, beside it. No word has a white edge, and FALL and AREA
sit straight on the site. It was called Kookaburra; a request that still
names `kookaburra` is drawn in Kingfisher.

**Flamingo** (`flamingo`) — Kingfisher's sheet in Flamingo's palette: the
same paper, marks, suns, winds and views, with the zones as Flamingo's tints
and textures, every building in its zone family's ink (peach, sand, teal,
grey), the site in Flamingo's coral and the street names in its green. It
draws on Flamingo, and its look is Kingfisher's with only those inks changed,
so a change to Kingfisher's marks carries over.

With no photograph to show them, Kingfisher and Flamingo draw the kerbs, indicatively
(`src/lib/kerbs.ts`): NSW publishes no kerbs or footpath edges as open data
(the state's roads are centre lines only, a few metres out), so each kerb
runs a footpath's width out from the lot boundary on the street side. The
width is measured where OpenStreetMap maps the footpath (Overture Maps'
sidewalks, `src/fetch/footways.ts`; a sidewalk is mapped along its middle,
so the width is twice its distance from the boundary) and typical for the
street's class elsewhere (5 m on an arterial to 3.5 m on a local street),
never closer than a lane's width to the reserve's middle. A lane has no
footpath, so its kerb stands 0.6 m off the boundary, and so does a street
too narrow for one. Along one block face of one street the width is
averaged, so the line does not shift at every lot. Each frontage's kerb runs
straight on to meet the next, and every corner is then rounded to a 3.5 m
kerb return (less where the lot is too near), so the line runs unbroken
along a street, turns each corner and crossroads in one arc and swings into
each lane the same way; a corner splay or curve that runs with neither
street carries the footpath round between them. Where the boundary has no
street at all (a park, a back fence) the kerb ends in a return. A kerb
OpenStreetMap maps as a line is drawn as it is. The legend calls the line
indicative. The kerbs are worked out once, when the site bundle is built
(`kerbs` in `site_bundle.json`; an older bundle has none, and the sheet works
them out as it draws), so the CAD export carries the same lines, whatever the
sheet's style: `SA_KERBS-INDICATIVE`, dashed, for the estimate, and
`SA_KERBS-OSM` for the kerbs OpenStreetMap maps itself.

**Canary** (`canary`) — the office's classic site sheet (the DA 004s at
Arncliffe, Cabramatta and Randwick in `examples/packages`) drawn in the
colours of the context sheet's Canary, so the two drawings of a package match.
The aerial outside the site is greyed (`aerial: 'grey'`) under the same veil,
and the zones are filled in exactly the NSW ePlanning colours (`zones: 'lep'`,
at the context sheet's strength), keyed in the legend by code and name; the
site itself keeps the photograph's colours. The site is a dash in Canary's red
with its levels in the same red, and its boundary dimensions and fall arrow in
its slate; the FALL and AREA words are in the site's red too, set straight on
the site with no box and no white edge (`fallWords: 'plain'`, `fallInk`). The
street names are plain bold black along the road.

The sun, the winds and the views are one black dashed circle about the site,
after the office's view diagrams. Around the outside the winds are only
written (`wind: 'circle'`): each name set along the circle, upright whichever
way the sheet is turned, outside a black hatched band over the quarter it
blows from. Around the inside are the views (`views: 'circle'`): each clear
sight line a white band on the circle with its name inside it; a view whose
name would run into a better-ranked one's is left off. Further in are four
plain suns, open discs with eight rays, where the sun rises and sets at
the two solstices, each named (WINTER SUNRISE, SUMMER SUNSET…) toward the
centre, with no hours (`sun: 'circle'`). North is a black arrowhead standing
out of the circle with N beyond it. The circle sits clear of the lot with room
for the suns' names inside it, and short of the sheet's edge with the winds'
names outside it.

Noise is a navy zigzag beside the busy roads and the railway, and kerbside
parking one hatched street parking zone. The LEP's heritage items are hatched
in the ePlanning tan and its conservation areas in the ePlanning red. Each
neighbour's number and storeys are written in black straight on the map, with
no box behind them and no zone name (the colour under it says the zone), and
the height of building at it in black under them (`HOB = 18m`, or
`HOB = RL 211` where the plan limits by level; `neighbours: 'black'`). No contours: the fall arrow and the levels give the
ground. Its inks are read from the context Canary, so a change to that palette
carries over. It draws on Flamingo for the title block and is set in Arial.
The site bundle now carries the LEP height and heritage layers over the sheet
for it (`heights`, `heritage`); a bundle from before them draws its neighbours
without the height line.

The web picker shows the site sheet's themes in the STYLE row when the site
sheet is chosen, and no STYLE row for the yield or the site report; the job request
carries the theme in `template`, and the server keeps only a theme valid for
the sheet (`themeFor()`). The CLI takes `--site-theme`.

The renderers read the active template from an async context rather than a
parameter, so `withTemplate()` also takes a `Template` outright — which is what
lets `test/template-isolation.mts` hold two apart while only one is registered.

Fonts are limited to what the runtime image installs (Liberation — the 1.07
line Debian bookworm ships, which includes Liberation Sans Narrow for the
street names — and DejaVu).
Naming an absent font does not fail; it silently falls back and the sheet
comes out in the wrong face, so add the package to the `Dockerfile` first.

Options (after `--`): `--type context|site|yield|slides|summary|both`, `--scale 3000` (default 3000;
the web picker offers 1:2000, 1:3000, 1:4000 and 1:5000, the server accepts 1000 to 6000),
`--site-scale 500` (the site sheet's; the web picker offers auto, 1:250, 1:500 and 1:1000, starting on auto;
auto, or left out, takes the tightest of 1:200, 1:250, 1:300, 1:400, 1:500, 1:600, 1:750 and 1:1000 that fits the lot),
`--template flamingo|kingfisher|heron|canary` (the context sheet's template, see Templates below),
`--site-theme heron|kingfisher|flamingo|canary` (the site sheet's theme),
`--slides-scale 8000` (the deck's map panels), `--da-years 5` (the deck's
development window), `--job 2539`, `--client "Name"`,
`--status "DEVELOPMENT APPLICATION"`, `--sheet "DA 003"`.

### The planning yield

`--type yield` draws PLANNING YIELD, an A1 sheet in the office frame: what the
controls let the site hold, as a feasibility study first states it. The left
half is the office's development summary (DA 002) with the column the
generated summary had to leave empty now filled — CONTROLS, PROPOSED and
COMPLIANCE — for the site, the project summary, the LEP, the parking, the
Apartment Design Guide and the Housing SEPP. Under it, ruled as the same
table, the schedule of tiers — storeys, use, setbacks, envelope, plate and
floor area, each tier's number in the ring the plan draws it in — then the
apartments, a row for each kind in the mix with its share, ADG 4D-1's least
area for it, its own area, how many there are and the area they take, and
the assumptions the study rests on (floor to floor, efficiencies, the mix,
the plates, the nearest station).

The right half draws the study. The indicative massing as an axonometric,
seen from the main street's corner, among the neighbours at their recorded
heights (Overture; dashed where none is recorded), with each tier's envelope
dashed and the height of building plane over the site. Over each neighbour,
in pale dashed glass, its future: its own footprint raised to the whole 3.1 m
storeys its LEP height of building holds, where its zone permits flats (R1,
R3, R4, MU1, E1, E2, B1–B4), never lowered — the way sun-study's future
context reads it — and no higher than its floor space ratio allows: the land
it stands on by the ratio (its lot, shared between the buildings on it by
footprint, and never less than its own footprint), spread over its footprint
at the study's efficiency, offices in a commercial zone and apartments
elsewhere (`futureHeight()` in `src/lib/yield.ts`). So where the height is an
airspace RL, as in Parramatta's CBD, the ratio sets the neighbours' futures
as it sets the proposal. The bundle carries each neighbour's zone, height,
ratio and land, and the future is worked out when the sheet is drawn, so an
efficiency changed in `yield_assumptions.json` carries to it. The proposal's
outline is drawn over everything, so a future neighbour in front of it does
not hide it, and a future far above what stands runs out of the frame, as the
height plane does, the frame saying how high it goes. Under the massing, the
envelope in plan at a round scale, the
width of the half, on the ground the site analysis draws, kept to black and
grey: the lot lines, the kerbs (`src/lib/kerbs.ts`, indicative), the
neighbours' buildings, and on each numbered neighbour its street number, zone
and height of building (`NO. 13–17`, `R4 · HOB = 28m`), written inside its
building where they fit and on its lot where there is no building to hold
them; the street names along the roads. Over it each tier's envelope and plate, the tiers numbered in the band
that is each one's own, toward the middle of the main street frontage.

The study (`src/lib/yield.ts`, tested in `test/yield.mts`) works on the lot in
local metres:

- **Building type, from the zone.** Residential flat buildings in R1, R3 and
  R4; shop-top housing — shops on the ground floor, apartments above — in MU1,
  E1 and the old business zones; offices over a podium in E2–E5, B3, B5–B7 and
  IN1–IN2; nothing apartment-shaped elsewhere (R2, the recreation, special
  purpose and conservation zones), where the sheet gives the FSR's floor area
  alone. Permissibility is the LEP's land use table's to confirm.
- **Storeys, from the height.** A 4.5 m retail ground floor in a mixed zone,
  3.1 m residential storeys, 3.8 m commercial, and 1.5 m kept under the
  height for the roof and plant. A height mapped as an RL (Parramatta CBD's
  `m(RL)`) is read above the ground the contours give at the corners.
- **The envelope, in tiers.** Each boundary is a street frontage (a named road
  within 20 m and 35° of it), the rear (facing away from the main frontage) or
  a side. Apartments step back from the side and rear boundaries by ADG 3F's
  separations — 6 m to four storeys, 9 m to eight, 12 m above — and 6 m from
  the street in a residential zone. In a centre the shops fill the lot, the
  podium (four storeys) is built to the street and side boundaries and kept
  6 m off the rear, and the tower above steps 3 m back from the street. The
  envelope is found on a grid, each cell tested against each boundary's
  setback, so an L-shaped lot keeps both wings.
- **The plates.** Apartments are held to ADG 2E's 18 m depth — a perimeter
  round a courtyard that keeps the separation across it, on a wide lot — and
  a residential tower (nine storeys and up) to a 750 m² plate, centred by
  eroding the envelope evenly.
- **The floor area.** Storey by storey up the tiers, until the height runs
  out or the floor space ratio does; the sheet says which governs. No FSR
  mapped: the height does. GFA is taken from each storey's plate (its gross
  building area, the office template's BEA) by the template's building
  efficiencies, as sun-study's yield analysis keeps them: 72.5% residential,
  95% retail, 85% commercial; the net lettable area is 85% of residential
  GFA and 90% of retail and commercial.
- **To the height.** Where the FSR would stop the building below its
  height at full plates, the plates above the shops and the podium are
  slimmed by one share until the ratio's floor area reaches the top storey
  the height holds: the same floor area and apartments, taller and slimmer —
  a perimeter block's wings shallower round a wider courtyard, a block or a
  tower set further in. 9-11 Thallon St rises to 8 storeys at 82% plates;
  150 George St, Parramatta becomes its podium and a 52-storey tower of
  828 m² plates to RL 207.6. No plate is slimmed under 250 m²
  (`minPlateSqm`); `"reachHeight": false` in `yield_assumptions.json` keeps
  full plates and stops the building where the ratio runs out.
- **Apartments.** The net lettable (saleable) area over the mix's
  average size, shared out by the mix. The mix is the office's feasibility
  template, as sun-study's yield analysis keeps it: no studios, 20% one
  bedroom, 70% two, 10% three and no four-bedroom flats, at 35, 50, 75, 100
  and 120 m² — an average of 72.5 m², each at or over ADG 4D-1's minimum
  (35, 50, 70, 90, and 12 m² more a bedroom over three). Four bedrooms park
  at the three-bedroom rate, the Guide's being for three or more.
- **Parking.** Within 800 m of a station or light rail stop, ADG 3J-1 caps a
  council's rates at the Guide to Traffic Generating Developments': its CBD
  rates in Parramatta and Sydney CBDs (0.4, 0.7 and 1.2 a dwelling, a visitor
  space per seven), its sub-regional centres' elsewhere (0.6, 0.9, 1.4, one per
  five). Beyond 800 m a typical DCP's rates stand in, and say so. Retail and
  offices at one space per 100 m² near a station, per 40 m² beyond; bicycles,
  motorcycles (one per fifty car spaces) and the basement levels the spaces
  need at 30 m² each over 90% of the site.
- **The ADG checks.** Communal open space (25%), deep soil (7%, with its
  minimum dimension by site area, against the ground the ground floor leaves),
  the separations, apartment sizes against 4D-1's minima; solar access and
  cross-ventilation are marked for the design to test.
- **The Housing SEPP.** The in-fill affordable housing bonus — up to 30% more
  FSR and height for 15% affordable housing — as a second run of the study,
  and a note where the site is in a TOD area, whose controls may apply instead.

Every one of these numbers is in `DEFAULT_ASSUMPTIONS` and can be overridden
from `yield_assumptions.json` in the address's output folder (the CLI's
`out/<slug>/`), any subset of the fields:

```json
{ "mix": { "studio": 0.05, "one": 0.25, "two": 0.55, "three": 0.15, "four": 0 },
  "sizes": { "two": 85 }, "podiumStoreys": 3, "towerPlateMax": 850,
  "parking": { "one": 0.5, "two": 1, "three": 1.5, "visitor": 0.2, "basis": "the council's DCP" } }
```

The sheet prints the ones a run used. It is a feasibility figure, not a design:
DCP setbacks, street wall heights, solar access and overshadowing are the
design's to test, and mapped controls are not a planning certificate. Outputs:
`PLANNING_YIELD.pdf`, `.csv`, `.json`, and `data/yield.json` (the bundle, which
redraws with no refetch). A bundle from before the future heights, the lots'
zones and numbers and the kerbs still draws: without the future neighbours
and the plan's labels, its kerbs worked out from the lots and the roads.

### The deck

`--type slides` draws the OVERALL ANALYSIS deck: A3 landscape spreads (each folding into two A4 pages) for the
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
the Aboriginal heritage the open registers map over the strip: the LEPs'
scheduled Aboriginal items and the two plans' maps of Aboriginal cultural
landscapes (Lake Macquarie's sensitive Aboriginal landscapes, Moree Plains'
places of Aboriginal cultural significance), Heritage NSW's Aboriginal
Heritage Impact Permit boundaries, active or expired, and the Indigenous
places of the National and Commonwealth Heritage Lists and of the Register
of the National Estate, labelled an archive with no statutory force (a
nomination is said to be one, not a listing: the Sydney Cultural Crescent
Rock Art nomination takes in most of the Sydney samples' strips). With
them the Local Aboriginal Land Council, the National Native Title Tribunal's
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
point where it rises across it — with a table of them; and summer and winter
wind roses from NASA POWER's hourly reanalysis over the last five years, with
the frontages that face the prevailing winds named. Then *development
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
black name straight on the aerial). The white double-headed arrow band is no
longer drawn in any style, the site sheet's Canary having dropped it; a context
template can still ask for it (`streetLabels: 'band'`), and then a through
street carries its name in the band and a laneway gets a plain label. Neither of the two fields NSW publishes decides
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

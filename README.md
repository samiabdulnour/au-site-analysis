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
activity, topography, height of buildings, built form, movement, site, sun and views, constraints,
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
itself sits behind a free account (see *Free, one address, and subscription* below), and
`/pricing` compares the two sides. Sample thumbnails live in `web/samples/`
and are served from `/samples/<name>.jpg` (whitelisted names only).

While a sheet is drawn the page shows one word for where it is — queued (and
how many are ahead, with a rough ETA), drawing, done — over a yellow bar. The
pipeline does not know its own fraction, so the bar is filled by time, quickly
at first and ever more slowly, and only reaches the end when the server says
done; what the pipeline is fetching stays in the server's log, not the page. Where
there is a mouse, the pointer is a turning sun the whole time, over the button
and anywhere else on the page: Flamingo's sun, eight tapered rays round a disc
as the site sheets draw it at sunrise and sunset, in the page's yellow with a
black hairline. The result's picture cannot be dragged and takes no pointer
while a drawing is made: a press on it began a native image drag, and the
system's arrow came back beside the sun. The system can also show its cursor
again without the page asking (macOS does after a press on some things), and
a browser sets a cursor afresh only when it changes, so while a drawing is
made the page alternates, at every pointer move or press, between `none` and
a transparent 2 × 2 cursor image of its own, each as invisible as the other:
an arrow that came back goes with the next move or press.
Once done, the page shows the drawing itself as a picture about 2400 px wide
(`preview.jpg`, taken in the same Chromium session that prints the PDF: under
a megabyte against an A1 PDF's several megabytes; a deck's is its first page
at about 3200 px) with the downloads
under it — the PDF is downloaded rather than opened in the browser, which
could take a long while at that size. Dashed and dotted lines are cut to the
map or panel they are drawn in before they are printed (`src/lib/dashes.ts`):
Chromium writes every dash into the PDF as a shape of its own, the ones a clip
hides as well, and bus routes running kilometres past the map's edge and dotted
textures drawn across the whole of it once made context sheets of 85 MB and
site report decks of 41 MB, which PDF.js, the viewer in most browsers and chat
apps, could not draw in two minutes. The picture is the same for every plan,
like the examples. Jobs run in a pool of `WORKERS` (one by default), and
what they may ask of each public data service is counted across all of them,
so simultaneous users don't hammer it — see *Many at once* below. Put `TFNSW_API_KEY=…` in `.env`
for authoritative bus stops. The deck's existing-condition slide takes Google
Street View frames of each street frontage with `GOOGLE_MAPS_API_KEY=…` (a
Google Cloud key whose project has the Street View Static API enabled, and the
Map Tiles API for the streetscape page's 3D tiles; add
`GOOGLE_MAPS_SIGNING_SECRET=…` if the project signs its URLs, and take it out
with a key from another project, since a signature is the project's), and
Mapillary's frames with `MAPILLARY_TOKEN=…` (a free client token); without
either it reads KartaView alone. On the server they go in
`/etc/site-analyst.env`, which the deployer passes to the container.

With the key, slide 03 shows each numbered place from the street (the
camera aimed at the place's building, a view blocked by another building
refused) and slide 13 walks the site's street end to end in eight frames.
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
sheet in each of its themes), `result-yield-1-<style>.jpg`, `-2-<style>`… for the yield's
pages in each of the four styles (the frame turns through them in the style
picked), and `result-slides-1.jpg`, `-2`… for the site report's, in the
default style — one for every
combination the table offers, the names `web/app.js` asks for. A combination without one says so in the frame
rather than showing a broken image. They are drawn for 150 George Street,
Parramatta; to redraw them, or to move them to another address (and change
`EXAMPLE_ADDRESS` in `web/app.js` to match):

```bash
pip install pymupdf      # rasterises the PDFs
npm run samples -- "150 George Street, Parramatta NSW 2150"
# or a part at a time: --only context | site | yield | slides (| summary, which the table no longer offers)
# or only the link-preview card, from the context sheet already drawn: npm run samples -- --only card
# or the welcome animation's sheets, for their own addresses: npm run samples -- --only hero
```

The welcome's two animated windows and *How it works*' one (`web/hero.js`)
turn through `hero-1.jpg` … `hero-27.jpg`, sheets drawn for addresses around
NSW rather than the frame's example: the maps 1 to 14, a context or site
sheet each in one of the four styles (Sydney, Wollongong, Katoomba,
Woollahra, Newcastle, Blacktown, Manly, Orange, Coffs Harbour, Wagga Wagga,
Byron Bay, Taree, Armidale, Kiama); the yield's pages 15 to 18 (Manly,
Wollongong, Newcastle), in the four styles mixed; and the site report's 19 to
27 (Katoomba, Orange, and Newcastle's streetscape on Google's 3D tiles), in
its default style. `HERO` in `src/samples.ts` names each frame's address,
drawing, scale, orientation, style and page, and `--only hero` (a `hero` run of
the workflow) redraws the set at the frame's size, one pipeline a map and
one an address for the decks; `HERO_FRAMES=16,27` redraws those frames alone.
A page an address no longer takes leaves its picture as it was. The
illustrations cut in among them, `art-1` … `art-8`, are the studio's
graphics, resized once from their 4961 × 3508 originals, and are not drawn
here.

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

`web/samples/og.jpg` is the image a shared link previews with, drawn from
`web/og-card.html` — a crop of the context sheet the landing page opens on
(`result-context-3000-north-flamingo.jpg`) over a strip naming the tool. The
script redraws it whenever it draws the context sheets, by hand or in the
workflow, and `--only card` (a `card` run of the workflow) redraws it alone,
after a change to the card itself. Each redraw writes the picture's hash into
the `?v=` on the `og:image` and `twitter:image` tags of `index.html` and
`about.html`, since a scraper keeps a picture by its URL and would go on
showing the old card under the old one; the workflow commits those two pages
with the pictures.

### Free, one address, and subscription

Anyone generates every drawing, with or without an account, from the same
data, drawn the same way, and sees it on the page; what differs is what can be
taken away:

| | no account | free account | one address | subscription |
|---|---|---|---|---|
| drawing on the page | yes | yes | yes | yes |
| PDF | — | stamped with the watermark | clean, for that address | clean |
| CAD (DXF/DWG) | — | — | for that address | yes |
| data (CSV, JSON) | — | — | for that address | yes |
| lasts | — | — | 30 days | while subscribed |

Without an account the finished drawing shows as its picture (the job's
`preview.jpg`, the same for every plan) with SIGN UP FREE TO DOWNLOAD THE PDF
under it, which opens the account form and brings the visitor back to the same
drawing, now with its watermarked PDF. The server refuses the PDF and the
batch zip to a visitor without a session (401, since a free account is all it
takes), so the page offers only what the server will serve.

An address is bought from any of its drawings: under a finished sheet the
viewer cannot take clean, a line says what unlocking gives, and UNLOCK THIS
ADDRESS goes to Stripe for one payment and back to the same drawing, now
clean. A visitor without an account is asked to make one on the way — buying
is what an account is for — and carries straight on to Stripe. It covers
every drawing of that address — context, site, yield and site report — at any
scale or style, matched on the address with case, punctuation and spacing
ignored. It is named for the address rather than the site because "this site"
read as this one drawing. An address is what most offices need once per
project; the subscription is for whoever screens sites every week. (The code
and its settings still say site: `STRIPE_SITE_PRICE_ID`, `unlockSite`.)

`src/plans.ts` is that table in code, and every download route reads it, so a
new privilege is a new column there rather than a new condition in the server.

**Terms of use.** `/terms` (`web/terms.html`) says what every drawing is: made
from open public data as it stands when it is drawn, with no guarantee that the
data is complete, current or correct, and no substitute for a s10.7 certificate,
a survey or professional advice. Every footer says so, and that using the site
is accepting the terms; sign-up asks nothing more. An account stores the version
in force when it was made (`TERMS_VERSION` in `src/terms.ts`, the page's version
line) and when, carried through the emailed link from the sign-up form.
The same sentence stands before every payment: on `/pricing`, beside UNLOCK THIS
ADDRESS, and above the pay button on Stripe's Checkout page (`custom_text`).
Accounts from before the terms carry no version. The page is a plain-language
draft and wants a lawyer's reading before it is relied on.

**Accounts.** Drawing never asks for one: the tool is the landing page, and
the account form opens only from SIGN IN in the nav, from SIGN UP FREE TO
DOWNLOAD THE PDF under a drawing (the PDF starts with an account), from an
unlock or the pricing page (buying starts with one too), and from the emailed
verification and reset links. Anyone can make one with an email and a
password (`SIGN UP`, with the terms agreed to), and starts on the free side,
with watermarked PDFs. What holds the open side
down is the per-IP budgets (12 sheets an hour, and the sign-in and sign-up
limiters), the bounded worker pool, and for a visitor without a session the
human check and a ceiling on guests' sheets (see *Bots* below). Accounts live in `out/accounts/accounts.json`
on the host volume, beside the job index and written the same way, with scrypt
password hashes; the key that signs session cookies is `SESSION_SECRET`, or,
unset, one made once and kept in the same directory, so a deploy signs nobody
out. `ACCESS_CODE` still works and carries the subscription, so the office keeps
clean PDFs and CAD without an account; unset it once everyone has one.
`SUBSCRIPTION_EMAILS=a@x.com,b@y.com` gives those accounts the subscription
without charge, which is also the way to see the subscriber's side before
billing is switched on — once the address is verified: an account still
waiting on its verification click gets nothing from the list, or anyone could
claim a listed address that had not signed up yet. On a server without email
there is no verifying, so list only addresses that already have accounts.

**Email: sign-up and password reset.** With email on, a sign-up is not an
account until its mailbox answers: `SIGN UP` emails a link (`/?confirm=…`),
the page it opens has a `FINISH SIGNING UP` button, and the press makes the
account, verified, and signs that browser in. A press rather than the link's
own opening, because mail scanners open every link in a message. Until then
the address and the password's hash wait in `out/accounts/pending.json` for
24 hours. Every sign-up is answered alike, so the form does not say which
addresses are taken; a taken address is emailed "you already have an
account" instead of a link. An account somebody made on an address and never
verified (before this, sign-up made the account at once) is left as it is,
but a sign-up from that address gets a link, and the press hands the account
to whoever proved the mailbox, with their password, signing the other out.
The sign-in form's `reset` emails a password-reset link, which opens the page
asking for the new password; setting it signs that browser in and every other
one out (the cookie's signature covers the password hash). Each link's token
is random and stored only as its SHA-256, so neither file ever holds anything
that opens an account. One inbox is sent at most three emails an hour and ten
a day, and the server at most `EMAIL_MAX_PER_HOUR` (100) in all, with a
warning in the log when it holds some back: the forms mail whatever address is
typed into them, and a mailbox used to flood strangers is one its host
suspends.

They go out one of two ways (`src/email.ts`). Through a mailbox of your own
over SMTP — Namecheap Private Email, for one — in `/etc/site-analyst.env`:

```
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465                                     # SSL; 587 for STARTTLS
SMTP_USER=no-reply@site-analyst.com               # the mailbox's full address
SMTP_PASS='the mailbox password'
EMAIL_FROM='Site Analyst <no-reply@site-analyst.com>'
```

or through [Resend](https://resend.com)'s REST API, with plain fetch the way the
server talks to Stripe:

```
RESEND_API_KEY=re_…                               # resend.com, with the sending domain verified
EMAIL_FROM='Site Analyst <no-reply@site-analyst.com>'
```

SMTP wins when both are set, and the container's log says which at start
(`email smtp`, `email resend` or `email off`). Keep the quotes: the deployer
reads the file with bash, where an unquoted `<` is a syntax error that stops
the deploy, and a password's `$` or space would be taken apart. Over SMTP,
`EMAIL_FROM` must be the mailbox itself or one of its aliases — a mail server
refuses, or marks as spam, mail "from" an address it does not hold — and the
domain wants the mail host's SPF and DKIM records, or the links land in spam
(Namecheap adds them itself when it runs the DNS). The host has to be allowed
to connect out on port 465 or 587; many cloud providers block both until
asked. Sending is not awaited on sign-up, so a failure shows only in the log;
the page's RESEND button awaits it, which makes it the quickest test.

With neither way complete nothing is sent and both features switch themselves
off: `SIGN UP` makes the account at once, as it did before email, and the
reset form says this server cannot email a link. Accounts from before
verification existed count as verified — the feature arriving must not lock
out everyone already signed up.

**Bots.** Sign-up, the reset email and sign-in are what a bot fills in, and
a new sheet is what a bot without an account asks for — the one request that
costs the public data services anything — so they carry these defences on top
of the per-IP limits:

- **A human check**, [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/)
  (`src/human.ts`), which asks most people nothing and the rest to tick a
  box. It stands in front of every sign-up and reset email, in front of
  sign-in after three wrong passwords at one account or five from one
  address — never a lockout, which would let a stranger keep an owner out —
  and in front of every new sheet or batch from a visitor without a session,
  with a widget of its own under the address bar. A sheet already drawn is
  handed back without asking, and a session (an account, which passed the
  check at sign-up, or a code) is never asked.
  Make a widget for the domain on the Turnstile page of a free Cloudflare
  account (the DNS stays where it is), then in `/etc/site-analyst.env`:

  ```
  TURNSTILE_SITE_KEY=0x4AAA…        # public: it goes to the page
  TURNSTILE_SECRET_KEY=0x4AAA…      # this server's alone
  ```

  Unset, there is no check. Then ten wrong passwords at one account in
  fifteen minutes hold it for the rest of the window instead, whichever
  addresses they came from. If Cloudflare does not answer, the check refuses
  rather than lets through, and says so in the log.
- **A honeypot**, a field off the page that only a bot fills in: it is
  answered like anyone, and nothing is made or sent.
- **The email caps** above, so the forms cannot be turned on strangers'
  inboxes however many addresses a bot comes from.
- **A ceiling on guests' sheets**: `GUEST_JOBS_PER_HOUR` (default 30) new
  sheets an hour for every visitor without a session together, whichever
  addresses they come from, so a bot spread over many addresses — or one that
  pays to have the check solved — cannot take the queue from everyone signed
  in. Past it, a visitor is told to sign up free to carry on. It holds with or
  without Turnstile; `0` leaves guests only the sheets already drawn, a switch
  for a bad hour.

The per-IP limits read the address Caddy adds as the last `X-Forwarded-For`
entry, not the first, which is whatever the visitor sent. They are held in
memory, so a deploy clears them; a visitor cannot make a deploy happen.

**The watermark.** The office's bird sheet, `assets/watermark/watermark.pdf`:
one vector page laid over the whole of each page at 30% opacity, with
`site-analyst.com` in the bottom-left corner, in the margin under the map (the
folder's README says how to replace the birds; a `watermark.png` there is used
instead when the PDF is missing). It is stamped when a free account downloads, not when the
sheet is drawn, so the sheet on disk stays clean and one job serves both sides:
a subscriber asking for an address a free account has just drawn gets it at
once, clean. Without either file, the words `SITE ANALYST · FREE` stand in. If
stamping fails the download is refused rather than served clean.

**Payment.** Stripe Checkout sells both, and Stripe's customer portal manages
the subscription (card, invoices, cancelling), so no card number reaches this
server. To switch it on, in Stripe's dashboard:

1. Make a product with a recurring price; its `price_…` id is `STRIPE_PRICE_ID`.
   Make another with a one-off price for a site; its id is `STRIPE_SITE_PRICE_ID`.
   Either can be left out, and that way to pay stays closed.
2. Add a webhook endpoint at `https://<domain>/api/billing/webhook` sending
   `checkout.session.completed` and `.async_payment_succeeded`, and
   `customer.subscription.created`, `.updated` and `.deleted`; its signing
   secret is `STRIPE_WEBHOOK_SECRET`. The second is a site paid for by a
   method that settles days later, which the dashboard's payment-method
   settings decide whether to offer.
3. Save the customer portal's settings once (Settings → Billing → Customer
   portal), or MANAGE BILLING has nothing to open.

Then in `/etc/site-analyst.env`:

```
STRIPE_SECRET_KEY=sk_live_…     # sk_test_… to try it first
STRIPE_PRICE_ID=price_…           # the subscription
STRIPE_SITE_PRICE_ID=price_…      # one site
STRIPE_WEBHOOK_SECRET=whsec_…
PRICE_LABEL='A$49 a month'        # what /pricing says each costs
SITE_PRICE_LABEL='A$79'
```

The labels are in single quotes because the deployer reads this file as bash,
under `set -u`: unquoted, `A$49` is the shell's `$4`, unset, and the deploy
stops there with `$4: unbound variable` (the running container is left as it
was, but nothing deploys until the line is fixed). A space unquoted ends the
value.

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

Authentication: drawing needs none — the site is open, and a visitor without
a session sees each drawing on the page but downloads nothing; such a visitor
meets the human check and the guests' ceiling instead (*Bots* above). Signing in (an
account, or `ACCESS_CODE` once) sets a 30-day session cookie and is what
downloads, buying, clean PDFs and the office's grants hang off. Login attempts, sign-ups and job
submissions are rate-limited per IP, and job outputs are deleted after 24h.
`ALLOW_NO_AUTH=1` is for local use only, and only while no `ACCESS_CODE` is
set: everything granted, no sign-in offered.

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
what was mid-flight comes back as `interrupted by a server restart, run
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
queue, in the same order, and each goes through the same reuse check, so
a batch of twelve where five were drawn this morning runs seven. Two spellings
of one address inside a batch share a single job, and the hour's budget is
charged for the sheets it will actually draw rather than the rows submitted.

A batch gets no workers of its own. It shares the pool with everyone else, so
one office submitting a dozen holds the site up for the next visitor only for
as long as the pool takes to get through them.

Jobs used to run strictly one at a time, for two reasons. The first was the
promise this tool makes to the free services it is a guest of; that is now
kept by a count per service rather than by the queue (*Many at once*, below).
The second was the graphic template. It was a module-level
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

### Many at once

`WORKERS=n` draws n sheets at once, each in a process of its own
(`src/worker.ts`, forked by the server for one job and gone when it is done),
and the rest wait in order. One is the default, which behaves as the site
always has. A process rather than more of the server's own loop because
composing a sheet and encoding its PNGs is CPU on the main thread — ten jobs
in one loop would take turns with each other and with every page request —
and because a job that crashes or leaks then takes only itself down.

What the workers share is counted in the server, not in each worker
(`src/lib/slots.ts`): a worker asks for a slot over the channel it was forked
with, and a dead worker's slots go back when it exits.

- **Requests to one host** — `UPSTREAM_PER_HOST`, default 16, or
  `UPSTREAM_LIMITS="mapprod3.environment.nsw.gov.au=8,…"` for one host. Every
  outbound request goes through `src/lib/http.ts`, which holds the host's slot
  until the body has been read. This is what keeps the promise the serial queue
  used to: however many sheets are drawing, a service sees at most that many
  requests at once. The local Overpass, and anything else on this machine or
  the Docker network, is ours and not counted.
- **Printing browsers** — `PRINT_SLOTS`, default 2. A sheet's memory peaks in
  Chromium, so it is the number printing at once, not the number of jobs, that
  the machine has to hold.

Printing side by side once cost a sheet half its drawing. A page opened on
Playwright's `networkidle` alone was printed when no request had been in flight
for half a second, which on a busy machine came before Chromium had finished
parsing the sheet's HTML: about one print in a dozen, with four or eight at
once, was a valid PDF with the map up to its zoning and a blank title block.
Memory was not the cause; eight A1 context sheets printing together held
under 3 GB more than the machine at rest, about 350 MB a browser. The pages now
wait for their `load` (`src/render/pdf.ts`), and every PDF is read back
(`src/render/printCheck.ts`): a sheet for its title block and its pictures, a
deck for every page, each with its number and title or its footer, which the
page draws last, and its pictures. A short print is printed once more and then
fails the job, with the PDF moved aside, so a sheet or deck that is served is
whole. `scripts/print-stress.ts` prints sheets side by
side, in processes of their own, and reports what each PDF lacks.

`JOB_TIMEOUT_MS` (default 20 minutes) stops a job that has hung on a service
that never answers, so it cannot hold a worker for good. The queue position and
the wait the page shows count rounds of the pool, and `/status` shows the
workers and any slot something is waiting for.

The shared caches under `out/.cache` are written beside and moved into place,
so one job never reads another's half-written census table.

How many workers a machine takes is measured, not guessed:

```bash
npx tsx scripts/loadtest.ts --workers 10 --levels 5,10,30 --sheet context
```

boots a server of its own on throwaway directories with that many workers,
submits each level's sheets together, each for a different address, follows
every one to the end, and reports how long the lot took, each one's wait and
drawing time, what failed and why, and the machine's CPU and memory peaks
(`out/loadtest/<time>.json`). `--sheet mix` takes the four kinds in turn,
`--base` tests a server already running. The sheets are real and fetch from the
real services, within the per-host slots: run the big levels where the data is
held locally. As a rule of thumb from one sheet of each kind, measured on four
cores: a sheet keeps about a core busy while it composes and holds 1.2–1.8 GB
while it prints.

### Batches

`POST /api/batches` takes `{ addresses: [...], sheet, scale, rotate, template }`
and at most twelve, one hour's worth of the per-IP job budget. All or nothing:
half a batch accepted is worse than none, since there is no way to tell from
the outside which half. `GET /api/batches/<id>` reports a row per address, and
`GET /api/batches/<id>/zip` returns the finished sheets named by address.

Batches live in `out/web/batches.json`, beside the job index rather than inside
it: that file is an array an older container still reads, and a rollback that
met an object there would find no jobs at all.

### Identifying this tool

Being a good guest is also being a recognisable one. The firewall in front of a
government endpoint decides whether to trust a request largely from its
`User-Agent`, and whether that identity resolves to something a human can look
up; an anonymous request — what Node's `fetch` sends by default, a bare `node`
— is what such a firewall blocks. So every outbound request carries one
identity, defined once in `src/lib/http.ts` and attached by `retryFetch` to any
request that does not set its own, naming the tool and linking this repository
with the `+URL` convention:

```
au-site-analysis/1.0 (NSW architectural site-analysis tool; +https://github.com/samiabdulnour/au-site-analysis)
```

The link is the point. A provider who looks it up lands on
[`SECURITY.md`](SECURITY.md), which says what the tool fetches, how lightly (one
address at a time, cached, backed off on 429/503), and how to reach or block the
operator. The running site serves the same record at `/.well-known/security.txt`
(RFC 9116), so the identity holds from both ends — the request points at the
repo, and the site points back at the same policy.

`SITE_ANALYSIS_CONTACT` adds a direct contact to that identity. Set it to an
email or a URL and it is appended to the `User-Agent`, sent as a `From` header,
and listed first in `security.txt`, so a provider has someone to email before
reaching for a block. Like the rest, it lives in `/etc/site-analyst.env`:

```
SITE_ANALYSIS_CONTACT=hi@site-analyst.com
```

Unset, the identity still names the tool and links the repo — only the direct
contact is missing, and `security.txt` keeps its GitHub advisory and issues
links regardless.

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
dimensions and levels — is in Heron's one colour, and the sun, winds and views are drawn
in grey, so the site reads first and the analysis quietly round it.

The sun, the winds and the noise are drawn in one hand, in open white-filled
marks (in Heron the sun, the winds and the noise in grey): a sun drawn as an open jagged crown
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
Site analysis themes below). The yield and the site report take the same four
names and are drawn in that style's palette (see *The decks' styles* below);
the development summary has none and is always drawn in the default template.

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
industry grey on stone; water the bright cyan, heritage purple, the railway
orange. The site is a red terracotta (`#c8553a`), drawn as its site sheet
draws it (`siteMark` on the template, 2026-11): the lot in a pale tint of the
red, on white so the zone under it does not muddy it, inside a dash-dot line
of the red and a white contour that lifts it off the tints round it; what
stands on the lot in the full red, in a white edge. It was the reference's
pale salmon at 0.55 in a dashed line, which the decks keep as `site`. The legend swatch shows a few buildings on
their ground. The other colours are exactly those the reference prints. Streets, numbered
places and the dotted lines are Flamingo's, but the street names and the institutions' number discs
are the reference's peach, the parks' discs a light leaf green, and the lots
and every building are drawn in a heavy white line. The lots lie under the
buildings, as part of the ground they stand on, so a lot line never cuts
across a building's fill.

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

**Heron** (`heron`, the default) — a conventional black-and-white drawing
over the aerial, with one colour (2026-11; the yield and the site report go
the same way, see Heron mono below):
- **The photograph** is grey all over, the lot's own too (`aerial: 'mono'`,
  by the same saturation blend as the context sheet), and a white veil
  (`veil: 0.74`) lifts everything round the lot, so black lines read on it.
- **The lines are black**, not white: the cadastre, the outline of each
  numbered building, the street names, the neighbours' numbers and storeys,
  the fall arrow, the sun and its path, the winds, the telescopes and the
  noise (`lotInk`, `outlineInk`, `streetInk`, …). The contours are dotted, in
  a mid grey (`contourDots`), as a site plan draws them.
- **The zones are hatches, not shades** (`zoneTint: 0`, `hatchInk`): every
  zone in the same black, told apart by its pattern alone. The pattern is
  the category's `hatch` in Heron's mono categories:
  - residential in lines falling to the right, tighter as the density rises
    (R2 wide, R3, R4 tight);
  - the centres cross-hatched, the commercial tighter than the local;
  - mixed use in upright lines;
  - industry and infrastructure in lines rising to the right, the industry
    tighter;
  - open space dotted, water in flat lines.
- **The one colour** is the brick red `#c0533f` (`HERON_ACCENT`): the site's
  dash-dot boundary, its levels, its boundary dimensions and the FALL and AREA
  words, which sit plain on the photograph (`fallWords: 'plain'`).
- Every word on the map is set a fifth larger than the other site themes'
  (`textScale: 1.2`). The sun is an open crown of twelve uneven teeth round a
  plain circle, the four on the diagonals drawn out as short, broad flames;
  the winter path is dashed, the summer path solid.

It draws on Heron's mono template (`HERON_MONO`). It was called Dove (on
Flamingo's palette, with the site in a deeper red) and before that Cardinal
(with the sun in mustard and the winds and views in red); a request that
still names `dove` or `cardinal` is drawn in Heron.

In every style, the services' words (11 kV, Ø 375, DS 1616 · 969 kVA spare) are
plain Arial with no white halo. Where no open tree data reaches the site (no
council register, nothing in OpenStreetMap within 15 m), the legend says so
instead of leaving the trees out without a word.

**Kingfisher** (`kingfisher`) — Kingfisher on paper, with no aerial: the
zones as Kingfisher's pale grounds with their textures, laid on the lots only
so the roads stay white (water is drawn whole), every building in its zone
family's strong colour with a white edge and its number in white (a quiet grey
where no zone is mapped), the white cadastre, Kingfisher's
grotesk and its peach street names. The site is in a red terracotta
(`#c8553a`, 2026-11; it was the palette's magenta), the same as on the
context sheet, chosen to sit with the palette's peach and coral: its dash-dot
boundary, its corners and levels, the lot in a pale tint of it (`siteTint`)
and what stands on the lot in the terracotta itself (`siteFigure`), where it
was a quiet grey. How that building is drawn is the look's `siteFigureStyle`.
Kingfisher's is `fillContour`: filled in the terracotta inside a thick white
contour, which lifts it off the lot's tint. The others are the buildings' fine
white edge (unset), white and hatched inside the white contour (the hatch's
line and spacing are `siteFigureHatch`), or white, plain or hatched, inside a
thick contour of the terracotta. Flamingo's site sheet keeps its coral site; its building on
the lot takes the coral as its outline and hatch. The climate is drawn in
the office's marks for this palette (`src/render/climateSymbols.ts`, taken
as drawn from its symbol sheet): each solstice's sun path a nearly solid
crescent in warm yellow, deepest at noon and running from amber at its points
to its brightest yellow in the middle (summer outer, winter inner), with the
office's small rayed sun in orange at each rise and set; each wind a smaller
translucent blue crescent (15 mm deep, sweeping 48°) over the quarter it
blows from, on the summer ring and slid along it
off a sun from the same quarter, carrying three white broken-shaft arrows
pointing in at the site; each view a green triangle opening from the site
edge with the eye white in it, its distance written beyond the open end or,
where a sun's name is there, beside it. The wind crescents go down before the
suns, so a sun stands on its wind's band. No word has a white edge, and FALL
and AREA sit straight on the site. It was called Kookaburra; a request that
still names `kookaburra` is drawn in Kingfisher.

**Flamingo** (`flamingo`) — the same paper and plan drawn as the context
sheet's Flamingo draws them: the zones as Flamingo's tints and textures,
every building white in a heavy 0.8 mm outline of its zone family's ink (sand,
peach, teal, grey) so it stands clear of its tinted ground, the cadastre
in the context sheet's fine grey over them, the site in Flamingo's coral, the
street names and the neighbours' numbers and storeys in its green. The
climate is the office's other set of marks, each a pale peach shape in a fine
blue outline: a sun of eight tapered rays at each solstice rise and set, on
the summer arc dashed in yellow and the winter arc dotted; the winds, two
curled arrowheads one behind the other, on the summer ring pointing in, the
ring carried on round the side the sun never reaches dashed in blue; the
views a small wedge pointing back at the site and the eye in a widening
triangle. It draws on Flamingo and shares Kingfisher's paper, kerbs and
lettering.

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
centre, with no hours (`sun: 'circle'`). Each solstice's path joins its
sunrise to its sunset over north as an arc of a circle about the site, the
climate circle drawn smaller: the summer path solid, 17 mm inside the ring,
the winter one dashed and 17 mm further in, so the three stand evenly apart,
each path with its two suns on it.
North is a black arrowhead standing
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
sheet is chosen, and the same four names for the yield and the site report; the job request
carries the theme in `template`, and the server keeps only a theme valid for
the sheet (`themeFor()`). The CLI takes `--site-theme`.

### The decks' styles

**Heron's site report is black and white alone** (Z.'s markup of the Heron
deck for 86, 88-90, 94 Maroubra Road, 2026-11: "do not use different
colours for Heron; just make the site a thick line and the trees black with
a hatch"). It draws on its own template, `HERON_PLAIN`
(`templateFor('slides', 'heron')`, `plain: true`), where the yield and the
A1 site sheet keep `HERON_MONO` and its one colour. What follows from it:

- *No red anywhere*: the site's pen, the narrative, the accent's ink family
  (the bars of a chart, a constraint's number, a heritage outline) and the
  walking bands' ramp are black on greys; the site's own land-use category
  is white. `test/heron-mono.mts` holds every ink of the report to a grey.
- *The site is a heavy line*: `siteMark` (`src/render/minimap.ts`) draws it
  as a 0.9 mm dash-dot black line with white under it, so it stands clear of
  a photograph, a hatch or a tone alike, and fills nothing inside it. It is
  one outline round the whole site: an amalgamation's lots are joined
  (`siteOutlineRings`, their corners rounded to a centimetre so two that
  meet do meet, a gap between them no boundary) and the lines between them
  are left to the cadastre, where each lot was outlined and the site read
  as three. Every style's site outline, the black edge over a red map and
  the site on the ground of the built form page take the same joined ring; the
  keys show the same line in a box (`siteSwatch`), and the site plan and the
  condition page take the same boundary. The region's ring and Country's
  dot are black.
- *The zoning map is the context analysis's*: the planning overview, the one
  page that is a zoning map, takes the mapping method of Heron's context
  sheet ("the hatches there are quite confusing; use the same mapping
  method, colours and style, which you use in context analysis for Heron"):
  that sheet's land-use tints at its opacities (the residential zones in
  warm pinks deepening with density, the centres in tans, open space in
  green) over the photograph in grey under its veil, the cadastre in white,
  its heritage ink (`heronContextLook()` in `src/render/template.ts`). Eleven
  hatches in one black ink over the cadastre's fine lines did not read
  apart. The zones' bars and the key take the same tints; the zone codes and
  the street names are black, the names on the streets' white strips; the
  site stays the heavy black line. Every other page keeps the report's own
  black and white categories.
- *The hatches end on a line*: the streets' casing is a firm dark grey and
  heavier (`greyBase`, `overLayers`), so every block has a contour and a
  zone's hatch stops at it; the cadastre is a grey firm enough to read with
  no tint under it; Country's plant communities are each outlined along
  their own edge (`paintMasks` paints a fill's outline along its mask's
  edge), so two patterns that meet have a line between them.
- *The trees are hatched*: on the built form page each crown is ruled in
  black inside its black contour (`crownPicture`'s `hatch`), so the trees
  stand apart from the white buildings; on the green page each tree is a
  black circle, hatched.
- *The capacity study's tick and cross are black*, and a single title's
  outline a firm dark grey.
- *The photographs keep their colours* ("photos can have colours"): what is
  drawn has no colour, but the aerials, the street and the places print as
  they were taken. The report no longer asks for its pictures in grey
  (`--photos: grey` in `deckCss()`, which `greyPhotos` in
  `src/render/pdf.ts` acts on, is now the yield's alone), and the site's
  line, black with white under it, reads on a colour photograph as it did
  on a grey one. The streetscape's ground is a heavy line with no dark band
  under the street; its wrapper says `data-photos="colour"`, so its faces
  stay in colour in any deck that prints its other pictures grey.

The yield and the site report take the four styles of the two maps, under
the same names, and read each style's palette from its context template
(`deckLook()` and `deckFamilies()` in `src/render/template.ts`). The site
colour sets the site; the narrative on the left of each spread is set in
the colour its map and its diagrams share (the biggest community's on
Country, the motorways' on Location, the policy area's on Strategic
context, the site's contour on Topography, the determined lots' green on
Development activity, the bands' blue on Movement, the shadows' on Grid,
sun and views, the market's orange on People and market), and in black
where no one colour leads the page. The zones take the
land-use categories, with their textures, as the context sheet of that style
tints the land, or in Canary each zone code in its NSW ePlanning colour; the
yield's plan tints each neighbour's lot the same way. The atlas kit's five
ink families are drawn from the same categories, and a map takes whichever
of them tell its data apart: colour carries the data on every page, from
across the palette, and no page is held to one family. Ordered data (the
storeys, the metres, the hours of shadow) runs up the palette's ramp, cool
to warm (`paletteRamp`, `heatFills`), and the key shows the ramp as a strip.
The text on a map wears no outline: not a white halo on paper, and not a
black one on the white words over the aerial (zone codes, street names,
the places' names), which stand on the photograph as they are.
The storeys' ramp runs across the palette in every style, Heron's included
(`heightRamp`): the height of buildings page, the massing and the built form page take it, so a city reads in many colours. Kingfisher and Flamingo draw
the massing and the built form page light and glossy
(`massingInks().gloss` and `.pastel`): pastel cuts of the same colours on a
near-white ground, the faces lit bright and barely shaded, the roofs
lighter, the edges softer, and each building casting a
soft blue shadow on the ground instead, its footprint swept away from the
light by its height; Heron and Canary shade the faces themselves, in the
full colours.

Canary marks a building's walls with a hatch (`WALL_HATCH` in
`src/render/axonometric.ts`): a wall turned from the light is hatched as shade,
lines at 45° in a darker cut of the wall's own colour, 0.14 mm wide and 0.9 mm
apart on a wall turned full from the light, opening as the wall turns toward
it; a wall turned to the light is left plain, as is one coloured by its hours
of sun. The lines are drawn and clipped to each wall, not a pattern fill, which
the print would rasterise. Flamingo and Kingfisher, light and glossy with their
shadows on the ground, leave every wall plain: no hatch at all, the storeys
ruled across what is built on the site. (All three laid a pattern of small dark
squares flat over every wall.)

In Canary, whose neighbours stand in their zones' ePlanning colours at full
strength, the site is as saturated as they are and a colour none of them takes:
the yield's scheme is Canary's yellow (its shops' and offices' floors E1's and
E2's colours at the same strength), what stands on the site today the deeper of
its yellows, and the report's built form draws the site's building in the
site's red at full strength. The other styles keep their own tints for the
site.

The 3D views' trees and people follow the style (`lookOf` in
`src/render/axonometric.ts`).
- **Flamingo** follows an illustrator's flat isometric town (Z.'s references of
  2026-11): flat shapes in a few colours on a cream ground, everything that
  moves drawn in line.
  - **Trees:** flat shapes in vector, no outline, shading or shadow
    (`flatCrownSvg` in `src/render/crowns.ts`): a three-lobed crown, a round
    one, a six-sided one, a bell, a conifer's triangle, a cypress's pointed
    oval, a shield ruled down its length and, for a few of the smallest, a low
    bush. Each stands on a thin trunk whose line runs up into the crown with a
    branch or two off it, a short bar on the ground at its foot.
  - **Colour:** two deep teals tree by tree, a lighter one for the shields and
    half the cypresses and bushes (`FLAT_TEAL`); the lines in a crown are a
    deeper cut of its own teal. About one tree in fourteen is left in paper:
    the streets' cream with the figures' line round its crown.
  - **Bars and shadows:** the bar at a tree's foot is pale orange on the paper
    and a thin cut of the tree's teal on a park's green. The buildings' cast
    shadows are flat, in the same pale orange.
  - **People:** in line and in vector (`linePersonSvg` in
    `src/render/people.ts`), after Z.'s sheet of the people: soft, loose
    figures with one thin near-black line round every part and no face.
    - Colour: each part is the cream of the streets, but for the hair, which
      is dark, and some of the clothes, which take one of four flat colours (a
      yellow, an orange, a pale blue, a teal): the trousers, skirt or shorts of
      about half the people, a top now and then, the book or the bag in a hand.
    - Clothes: a loose top with rounded shoulders and full sleeves gathered at
      the wrist; wide trousers flaring to a curved hem, slim ones, a skirt or
      shorts over slender legs; flat shoes. Each sleeve is joined to the body
      at the shoulder (`sleeve`): no line crosses it, the body's outline runs
      into the sleeve's, and the arm parts from the body at the armpit.
    - Poses: standing with the arms folded, a hand on a hip, both, in the
      pockets, waving, or at the sides; walking with the arms swinging, a book
      held up, or a bag on its strap.
    - Hair: short, in a bun, a tail, long and loose, or under a brimmed hat.
    - A pale orange bar lies on the ground under the feet.
  - **Size:** the people are at the town's own scale (`LINE_FIGURE_SIZE`, 1),
    and as many as Kingfisher draws. The line round each part is 0.04 m in the
    scene, so a figure a millimetre tall on paper still reads. (They were tried
    at three times life, as the references draw theirs; set the constant over
    2 and there are fewer of them to suit.)
  - **Cyclists** likewise (`lineRiderSvg`): thin spoked wheels and frame in
    the pen alone, the rider leaning to the bars, a helmet.
  - **Traffic:** Kingfisher's drawn vehicles (below) in line alone, without
    the people's colours: every part in the streets' cream with the one
    near-black line, the windows and the wheels in outline, a pale orange patch
    on the road under each.
  - **Town:** a yellowish cream ground, as the references' paper, the streets
    a shade lighter (`massingInks()`). The line down the middle of each street
    is short dashes drawn in outline and laid on the road (`ROAD_DASH`: 1.7 m
    long, 0.42 m wide, one every 4.2 m), where the other styles rule a dashed
    line.
- **People, Kingfisher:** flat figures after an illustrator's isometric people
  (`src/render/people.ts`):
  - bright tops, trousers or a dress, a face and its hair (short, long or in
    a bun), arms that swing and legs apart when they walk, now and then a bag;
  - a little larger than life;
  - walking the footpaths (some in twos), facing the way they walk, and
    gathered in the parks.
- **Kingfisher** follows an illustrated masterplan and its elevation trees,
  with one thin contour of dark slate (`CONTOUR`) round every tree, person,
  cyclist and vehicle, so they read as one drawing:
  - **Crowns:** a plain mass of leaves in the tree's green with a broken, leafy
    edge and a few small gaps through it at random (one to four, outlined as
    the crown is). The wood, in a terracotta cut of Kingfisher's red, is
    hidden by the leaves as a tree's is: it shows in the trunk, in an arch the
    crown's underside opens round it (where the trunk forks and the lower limbs
    climb into the leaves), and through a gap where a limb passes behind it.
  - **Forms:** round, upright, a fuller oval, three-massed, a cypress for a
    tenth of the small trees and a conifer, a cone broad at its foot, for about
    one tree in eight. None is squat, and each broadleaf form has three ways of
    branching. There is no shadow.
  - **Habit:** each tree stands its own way:
    - half on a single trunk forking in the arch under the crown;
    - some on a trunk forking low into two;
    - some on two or three stems from the ground;
    - a conifer or a cypress on a short trunk.

    Its bare trunk is from a little to well over its crown's radius, so the
    crowns sit low or high, and each crown is a little taller or broader.
  - **Town:** a warm near-white ground, as its pavements; the streets a cool
    pale lilac grey with their kerbs a shade deeper and the line down them
    barely there; the lots faint and the parks a pale sage (`massingInks()`).
  - **Traffic:** each vehicle a body drawn from its side profile and carried
    across its width:
    - a car's bonnet, raked windscreen, roof and rear window;
    - a van's short nose;
    - a truck's cab on its chassis with its box;
    - an articulated truck's long-nosed prime mover and trailer;
    - a bus's band of glass in panes.

    Each has dark glass and wheels with their hubs on the side turned to the
    camera. The colours are Kingfisher's: mostly warm whites and light greys,
    its terracotta, mint, pale and deep blue among them.
- **Cyclists**, in Kingfisher, are painted as its people are: a figure on a
  bicycle, facing the way they ride.
- **Trees off the road:** in every style, a crown read off the aerial over a
  street is moved out past the nearer kerb onto the verge, or left out where
  there is no room there.
- **Colour:** each style's trees are in its own green:
  - Flamingo's two deep teals, and a lighter one for its shields;
  - Kingfisher's mint (`massingInks().tree`), in two close cuts, and a soft
    yellow-green for about one tree in five.
- **Canary and the white model** keep the plain discs and slips.
- **Heron** draws a line model (see Heron mono): its trees are the canopies'
  pictures in white, their contour and limbs black.

A drawing holds a few thousand trees. Kingfisher's leafy canopies are too much
to print as vectors tree by tree (tens of megabytes a drawing), so each crown
is painted once as a small picture (`src/render/crowns.ts`) and placed at every
tree that takes it:
- a shape (Kingfisher's five forms by three branchings), in its green, at one
  of three sizes, its outline as wide in the scene as the others';
- its people likewise, thirty of them, each placed facing either way;
- the PDF keeps each picture once, so the illustrated pages print no larger
  than the plain ones did.

Flamingo's flat trees and line figures are a few plain paths each, so they
stay in vector: each form (in each teal, at each of the three sizes) and each
figure is drawn once in the drawing's defs and placed with a `<use>`. The
report's built form, some five thousand trees, prints at about 2.4 MB.

`npx tsx test/trees.mts` checks the pictures and each style's look.

**Heron mono.** Heron's yield and site report are a conventional
black-and-white drawing set with one colour (2026-11), as its site sheet is:
black lines, hatches in place of shades, dashed and dotted lines where a map
needs them to be read, nothing saturated. Its context sheet keeps the office
palette.
- **Template.** `templateFor` gives the decks and the site sheet Heron's mono
  template (`HERON_MONO`, `src/render/template.ts`) and the context sheet
  Heron's own. The mono template sets the decks on white paper, so they draw
  in the line technique (hatches, lines and patches), as Flamingo and
  Kingfisher do, not in tones over the photograph.
- **Inks.** The lines, the hatches and the words are black (`HERON_INK`: the
  families' `line`, `deep` and `text`); a light grey is kept for a ground
  where a figure needs one. The accent, Heron's brick red `#c0533f`
  (`HERON_ACCENT`), is for the site, the narrative and what constrains.
- **Zones.** A zone is its category's hatch in black on white
  (`categoryFill`), the same patterns as the site sheet's at the deck's
  scale. Over the photograph of the yield's first plan the paper under the
  hatch is a veil, so the roofs still show.
- **Lines told apart by their dash.**
  - The region map's railways are the classic railway: black with white
    sleeper dashes, so they read apart from the motorways' solid black.
  - A separation that holds only with a blank face is dashed black; one that
    holds is solid black, one that falls short is in the accent.
  - The rings, the council boundaries, the walks and the conservation areas
    keep their dashes and dots.
- **Patterns for what was colour.** The Country page's pre-1750 plant
  communities are each a pattern of their own (dots, hatches either way,
  upright and flat lines, cross-hatch, waves) on the bare paper, the
  hillshade under them.
- **3D views: a line model**, after an architect's axonometric
  (`src/render/axonometric.ts`, `LINE`):
  - the massing views (the yield's and the report's built form)
    are black and white, with no colour at all, the accent included:
    whatever ink or fill they are given goes to the grey of its own
    lightness (`greyOf`), the site is a black dash-dot boundary on the
    ground with no tint, and the height plane over it a fine black dashed
    outline;
  - the compliance views keep their colour: the walls and roofs in their
    bands of sun hours, the site in the accent;
  - every building is a white volume in a black outline, with no shade on
    its faces;
  - the buildings' outlines are sized on paper, millimetres whatever the
    drawing's scale (`LINE_MM`): a neighbour's 0.2 mm, what is built 0.3 mm
    inside a 0.55 mm outline, a storey's line 0.08 mm. The other styles'
    strokes scale with the drawing, so a town drawn small, as on the built
    form page, had hairlines;
  - there are no grey fills in the massing views: a building given a tone
    (a neighbour's band of storeys, what stands on the site, a shop's
    floors) is white, its walls hatched so the tone reads as shade: the
    closer the darker the tone (`lineHatchPitch`: 1.7 mm for the palest
    down to 0.6 mm), closest on the wall turned from the light and opening
    to nearly twice the spacing on one turned full to it, in a firmer line
    for what is built on the site; the roof stays white;
  - what is built on the site carries the heaviest outline, its storeys
    ruled across its walls and nothing else on them: a massing is a volume,
    not a facade design, so no windows are drawn (`LINE_WINDOWS`, which can
    also draw frames, ribbons or a curtain wall's uprights on the wall as it
    stands);
  - the trees are white canopies in their contour with their limbs drawn
    fine, the people and the traffic white in outline;
  - each ground surface has a hatch of its own (`groundHatch`), sized on
    paper whatever the drawing's scale: a park's lawn closely hatched, rising
    to the right; a lot's garden lightly stippled; the carriageway finely
    ruled across; the footpaths and verges white;
  - under each tree a closer hatch laid the other way, its shadow on
    whatever surface it falls; the buildings cast none;
  - the hatches are lines and dots clipped to each surface, over the frame
    alone, not SVG pattern fills: in print Chromium turns a pattern fill into
    a picture of the shape it fills, and the yield went from 27 to 63 MB with
    them; as lines it is 30;
  - the lots and kerbs are fine grey lines;
  - on the report's built form page the low buildings are plain white and
    the taller ones' walls hatched, closer band by band, so the storeys
    still read; its key draws each band as a small block with the same
    hatch on its walls.
- **Plans: line plans**, after an architect's site plan:
  - a building is white in a heavy black outline (`LINE_BUILDING` on the
    yield's plans; `grain()` on the report's maps, finer at their scale);
  - what is built on the site has the heaviest outline on the sheet;
  - on the yield's path plans a tree is a circle at its crown's size with its
    centre marked, the kerbs and lot lines are fine and grey, and only the
    parks are hatched, lightly; each lot's zone is written on it, and the
    first page's plan keeps its zone hatches over the photograph.
- **Sun hours: the context sheet's colours.** The heat map of sun hours on
  the compliance views (walls, roofs and the key) is the one place the decks
  take colour beside the accent. Its seven bands are `HERON_SUN`: exactly
  the colours Heron's context sheet prints, cool to warm as the other
  styles' bands run:
  - none: the slate of its dimensions (`#3c4c5a`);
  - under 1 h: the grey-blue of its winds (`#6d8a99`);
  - 1–2 h: its schools' pale slate (`#b8d1d7`);
  - 2–3 h: the green of its ten-minute walk (`#6aaf88`);
  - 3–4 h: its retail's sand (`#ecd4ac`);
  - 4–5 h: its commercial centres' tan (`#daa66f`);
  - 5 h and over: the site's red (`#cf4a2e`).
- **Ramps and marks.** The storeys of the height of buildings page and the
  landform's contours run in greys, black and white like the rest; the ramp
  ordered lines run up (the walks' bands) goes from grey to the accent; the
  cars of the 3D views are white; the compliance ticks are black and the
  crosses in the accent.
- **Photographs print in grey**: the aerials, Street View and the places'
  pictures. The page asks for it (`--photos: grey` on its root), and the print
  (`src/render/pdf.ts`) makes each picture grey in the page, as a JPEG, before
  it prints. A CSS filter would grey them on the screen, but in print Chromium
  rasterises the page round a filtered picture, uncompressed: the report went
  from 49 to 121 MB. As done, it stays at about 50.
- **Test.** `npx tsx test/heron-mono.mts` checks that:
  - every ink the decks and the site sheet take in Heron is a grey or the
    accent, and Kingfisher's are not, so the check can fail;
  - the decks are on paper in the line technique, and the site sheet's
    linework is black with no shade under its hatches;
  - each zone category and each plant community has a pattern of its own;
  - a page asking for grey prints its pictures grey and as themselves.

Canary has a punchy sheet of its own (`CANARY_INK`): its red, its yellow, its
lime and its lilac-blue. How a style renders the data differs as its ground does (`technique` on the deck look): Flamingo
and Kingfisher work in hatches, lines and patches on paper (the landform as
contours alone, coloured up the ramp by height, the pre-1750 communities
dotted, the development lots hatched; the storeys are tones up the ramp in
every style, a hatch reading badly at a footprint's size), and so does
Heron since it went black and white (Heron mono, above);
Canary works in tones over the photograph (the landform in a heat
ramp, the storeys and the communities flat). The charts are flat tones in
every style: a bar, a span of a time line, a wedge of a wind rose is its ink
at an opacity, never a pattern (`chartFill` in `src/render/atlasKit.ts`
turns any patterned fill into its ink at the pattern's weight before a bar
is drawn, so no page can hatch a chart), since the patterns do not read at
a bar's size — the height limits in the accent, the site's solid and the
rest lighter; the controls page in black alone, what the plan allows
deepest, what stands lighter, the neighbourhood lightest; the plans' time
line one ink at four tones. The deck's type is Arial in every style, on
its maps and diagrams as on its pages (`MAP_FONT`), whatever face the
style's own sheets are set in: the style is in the colour, not the face. The winter shadows are in the
transit family's blue, deepened, which differs by style. The marks of the development page carry
pictograms, a tick, an hourglass, the scales' beam, a cross, and a star for
a State significant application, so a status reads without the key. The
ground follows the style too, paper for Flamingo, Kingfisher and Heron and the
greyed aerial under the style's veil for Canary (the planning page has
the Character page's photograph; the yield reads one over the site's
surroundings, lays it under its plan and skews it into the axonometric's
ground plane, whose projection is affine, so the plan's picture goes in as
one matrix). The buildings on a plan follow it as well: white in a hairline
of their zone family's ink (Flamingo; Heron's in black), filled in the family's colour with a
white edge (Kingfisher), a white line round the photograph's roofs
(Canary), or a quiet grey where an older yield bundle has no
photograph. The page's type stays the report's Arial in every
style; the style is in the colour, not the face.

`scripts/recompose.ts` redraws a kept bundle (`KEEP_BUNDLE=1`, for the yield
as for the site report) in any style, a page at a time, without fetching.

The frame on the landing page shows the yield's and the site report's pages
in the default style whichever is picked: their pages are many, and one set
stands for them all.

The renderers read the active template from an async context rather than a
parameter, so `withTemplate()` also takes a `Template` outright — which is what
lets `test/template-isolation.mts` hold two apart while only one is registered.

Fonts are limited to what the runtime image installs (Liberation — the 1.07
line Debian bookworm ships, which includes Liberation Sans Narrow for the
street names — and DejaVu).
Naming an absent font does not fail; it silently falls back and the sheet
comes out in the wrong face, so add the package to the `Dockerfile` first.

Options (after `--`): `--type context|site|yield|slides|streetscape|summary|both`, `--scale 3000` (default 3000;
the web picker offers 1:2000, 1:3000, 1:4000 and 1:5000, the server accepts 1000 to 6000),
`--site-scale 500` (the site sheet's; the web picker offers auto, 1:250, 1:500 and 1:1000, starting on auto;
auto, or left out, takes the tightest of 1:200, 1:250, 1:300, 1:400, 1:500, 1:600, 1:750 and 1:1000 that fits the lot),
`--template flamingo|kingfisher|heron|canary` (the context sheet's template, see Templates below),
`--site-theme heron|kingfisher|flamingo|canary` (the site sheet's theme),
`--slides-scale 8000` (the deck's map panels), `--da-years 5` (the deck's
development window), `--half-length 95` (how far the streetscape runs either
way from the site, metres), `--job 2539`, `--client "Name"`,
`--status "DEVELOPMENT APPLICATION"`, `--sheet "DA 003"`.

### The planning yield

**What stands, its compliance, and an amalgamated site** (Z.'s notes on the
yield for 86, 88-90, 94 Maroubra Road, 2026-11):

- *"It builds a smaller thing than it is."* The path that rebuilds what
  stands now holds what stands, the whole of it. The summary of what stands
  and the path were read apart: the summary rounded a height into storeys
  and counted every building; the path took a roof allowance off each height
  first, rounded down, and left out a building with no recorded height. So
  four buildings of about 1,743 m² were "rebuilt to what stands" as three of
  707 m². Both now take one reading (`standingStoreys()` in
  `src/lib/yield.ts`): every building, at the same storeys, so the path's
  gross building area is the summary's. And what stands is stated on the
  paths' own measure (`standsFloor()` in `src/render/yieldSheet.ts`): the
  paths' figures are gross floor area and the LEP's ratio is on it, but what
  stands was given as gross building area, so the same bulk read as
  1,743 m² standing and 1,261 m² rebuilt, and as "≈ 0.6:1" against a 0.50:1
  it is under. The table, the bars and the page now give what stands'
  floor area (≈ 1,261 m², ≈ 0.41:1) with its gross building area beside it;
  a bundle with no outlines of what stands keeps the gross building area,
  labelled as that. The height chart's limit reads 9.5 m, not "10 m".
- *"Always show compliance for current structures on site, after for the
  designed massings."* What stands today has compliance pages of its own,
  always and first (`Stands today: shadow` and `Stands today: solar
  access`, straight after its spread: its sun, the shadow it
  casts, its separations), whether or not rebuilding it is a path; the
  designed massings' sheets follow. The path that rebuilds what stands is
  the same massing, so it has no second sheet.
- *"For multiple sites analysed you need to amalgamate the site."* The lots
  of several addresses were already joined into one boundary and one area,
  but in a low density zone the study designed nothing on it (the LEP's
  land use table takes no apartment building there), so the only massing
  drawn was each lot's own house, rebuilt. The study now reads the Housing
  SEPP's **low and mid-rise housing** controls (chapter 6, `src/lib/lmr.ts`):
  within 800 m of a nominated town centre they permit, in R1 and R2, a
  residential flat building to 9.5 m and 0.8:1 on a lot of at least 500 m²
  and 12 m wide, and the study draws that scheme across the whole site,
  every lot of the amalgamation as one (`Low and mid-rise housing`, a path
  with its own page, controls rows and compliance pages). The town centre
  is the nearest of the Housing SEPP's town-centres map, read to 800 m
  round the site; the distance is the straight line from the site's
  boundary to the centre's mapped edge, where the SEPP's is a walking
  distance, and the land the policy leaves out (constraints, heritage,
  some councils' excluded land) is not checked: the page says both, and
  that eligibility is to confirm with a planner. The mid-rise standards of
  R3 and R4 are not read; those zones keep the LEP's own paths.
- *"The volume is obviously filled and should be higher."* … *"It should
  be unified, one full volume."* … *"Like this without the hole in the
  middle."* The low-rise scheme was first drawn as the study's usual
  building: two storeys in a ring round the whole site with a slot of a
  courtyard in it, because the study keeps 1.5 m of every height for roof
  and plant (two floors were all that left under 9.5 m) and holds an
  apartment building to 18 m of depth. It is now the envelope itself, **one
  solid volume** (`envelope: true` on `computeYield()`): the whole of the
  land inside the setbacks, nothing held out of it for a courtyard or a
  tower's plate, to the whole of its height (`LMR_ROOF_M`, 0.2 m: three
  floors of 3.1 m and a flat roof with no plant or lift overrun over it,
  9.5 m; the policy sets a height and not a storey count, councils read it
  as two to three storeys, and `yield_assumptions.json`'s own
  `roofAllowance` stands where set). An envelope holds more than its
  building, so its floor area is the ratio's and not the volume's: the
  0.8:1 is spread over every storey, each the same share of its plate, and
  the page says what share of the envelope that is, and that the plan
  inside it (its depth, its courts, its apartments' sun) is the design's to
  resolve. At Maroubra: an L of three storeys to 9.5 m, 2,457 m² (0.80:1,
  67% of the 3,671 m² the envelope would hold), 28 apartments and 36
  parking spaces. 9.5 m is the policy's limit in R1 and R2: more height is
  a rezoning's, not this path's. (Between the two it was drawn as three
  separate buildings on the office's feasible footprints; that reading is
  gone.)
- *"Can we place the compliance sheet right after the scenario page?"* …
  *"Split solar and shadow with setbacks to two different pages."* …
  *"Make the isometry here for the full half page and remove the plan: the
  plan is visible in shadow. Shadow will be page two."* Every option's
  compliance was one sheet, all of them after the last path: two massings
  105 mm wide over a plan 147 mm high. Each option is now three pages
  running: its spread, the massing alone over the whole right page; its
  **shadow** and separation, the plan the whole page; its **solar
  access**, the two sun-coloured massings one over the other, the width of
  the page each (`deckOrder()`, `complianceSheets()`, `schemeFigures()` in
  `src/render/yieldSheet.ts`). The overview's page column follows. Two
  things the larger plan showed are put right with it: a frontage's street
  name, written where its road could not carry it, stood 8 to 14 m off the
  site's edge at the middle of it whatever was there (Glanfield Street, a
  lane, was written across the houses beyond it and through a storey
  number) and now stands 4.5 mm of sheet off the edge, along it to where
  nothing is written; a name along a road is written only where the road
  runs straight under it. And the overview's lot line, which ran into the
  controls beside it with three lots written out, gives several as
  lot/plan (`3 lots: 1/DP965310, 10/DP1118472, 1/DP36591`, `lotsShort()`).
- *"The shadow should be the same scale as plans. Can you merge shadow and
  plans, so the shadow looks more like plan? Also keep the rule with full
  isometry everywhere. If there is nothing interesting for compliance,
  don't show the shadow or plan at all."* … *"The previous shadow was
  better. Just update the scale and colours."* … *"I am not convinced by
  the plan shadow graphics. Can it be the plan like it was before, just
  with shadows? Try different iterations."* … *"Is it possible to make the
  surrounding buildings black and white, without zone? Zones are only
  visible on the second page."* … *"White buildings, hour by hour."* The
  shadow page's drawing went through four versions on the way (the
  report's sun page at 1:1 000; the scheme's shadow alone on the path's
  numbered plan; the sun page in the plans' colours; a board of seven
  shadow styles and three ways of drawing the neighbours). What was
  chosen: the path's plan at the overview's scale, the neighbours white in
  a black line with their street numbers and no zone on them, and every
  building's shadow hour by hour in soft grey layers, the envelope's own
  at 9 am, noon and 3 pm outlined. (The ground coloured by its hours of
  sun, in the solar access diagram's bands, was tried after that: "no,
  colourful shadows are not ideal".) Every path's spread is the isometric
  alone, and a path's only plan is its shadow page, so the paths with
  nothing to test have no plan and no shadow page.
- *"These two are not matching by style or colour. Let's keep the aerial
  map there, but simplify the zoning. For the isometry in the yield
  probably don't show the zoning in 3D, just white neighbour buildings."*
  The overview's plan tinted every lot by its zone over the photograph and
  wrote the zone and height on each, and the page after it drew the town
  in the zones' reds and blues. Now the photograph is the first page: a
  zone is an area inside one line of its colour, its code and height of
  building written once on it, and each lot keeps its street number alone
  (`YIELD_OVERVIEW_ZONES` draws the alternatives: a light tint in the
  line, the tint alone, or each lot tinted as before; Heron keeps its
  hatches). And every massing of the deck is a white model, a path's own
  spread as the solar access views already were: the neighbours white at
  their heights, the scheme and what stands the only colours. The zones
  are the overview's alone.
- *"Our site, very thick black. The yellows should be the same
  everywhere."* The site's boundary is one solid black line on every
  drawing of the deck, 1.4 mm on a plan and 1 mm on the ground of a
  massing (`SITE_LINE`; over the first page's photograph it stands on a
  white casing). It was the accent's, fine and dashed, with a tint of it
  on the ground. And the scheme is one yellow wherever it is drawn: the
  plan's plate is solid (it stood at 55%, paler than the isometric beside
  it), the massing's roof is the colour itself and not lit (`roofFill`),
  the height plane over it has no tint to shift it, and what stands on the
  site takes the same yellow (Canary gave it the deeper of its two).
- *"Do the compliance sheets for every scenario produced … even for
  this"* (the path that rebuilds what stands). Every path with a spread
  has its compliance pages after it: the rebuilt path, which had none
  because its massing is what stands, and a scheme with no apartments,
  which has its shadow page alone with the yield's criterion on it.
- *"If there is nothing, don't print it."* "Within the controls" had a
  spread of its own even in a zone the study draws no building type for:
  every figure a dash, over the height plane alone. A path that builds
  nothing now has no spread (`drawnPath()`); it keeps its row in the
  overview's table, with no page, and the overview says why. At Maroubra
  the deck runs from what stands and its rebuilding straight to the low
  and mid-rise scheme; a site with no path at all is its overview and its
  controls.

`--type yield` draws PLANNING YIELD: what the controls let the site hold, as a
feasibility study first states it, laid out as the site report is — A3
landscape spreads, the left page for what is said (the figures, the tables and
the key, the narrative in red down its left column, the sources at its foot)
and the right page for the drawings, run to its edges as the report's maps
are, each named in a white box in its corner — and printed the same way, one PDF page
and one PNG (`yield/<page>.png`) a spread. There is a spread for each path the
site may take, so a site with more paths has more pages:

1. **Planning yield** — the site (area, lot, frontage) and its controls (zone,
   height of building, floor space ratio and the floor area it gives), then
   the paths side by side (`scenarioRows()`, also in the CSV and the JSON):
   each one's storeys, height, floor area, FSR, units, parking, compliance and
   the page it is drawn on, and the floor area and height of each as bars
   against the FSR's floor area and the height of building. The right page is
   the site among its neighbours in plan over the aerial photograph: each
   zone an area in one line of its colour with its code and height of
   building written once, each numbered neighbour's street number on its
   lot. It is the one page that shows the zones.
2. **Stands today**, where the building sources record a building on the site
   — its storeys, height, footprint and indicative gross building area (each
   footprint by its storeys), the ratio that makes on the site against the
   LEP's, and the same bars. The right page draws it at its recorded height
   among the neighbours, a white model, the whole page. Where the sources have the footprint
   but no height, the height is read from Google's 3D meshes and the storeys
   are that height at 3.1 m each, or at the study's 3.8 m office floor where
   the source calls the building an office, a shop or another workplace
   (Overture's class, or OpenStreetMap's building tag, which the merge now
   carries onto an Overture footprint that has none: a four-storey office
   reads about 16 m, five storeys of 3.1 m and four of 3.8); where they have
   no footprint on the lot at all, footprint and height alike are traced from
   the meshes; the page says which, and credits the meshes.
3. **Rebuilt to what stands**, where what stands holds more than the controls
   give: a building over today's controls need not come down to them. Kept and
   refurbished, or rebuilt on its own footprint to its own height under a
   clause 4.6 variation argued on adding no bulk to what stands (existing use
   rights carrying a use the zone has since dropped), it keeps its bulk.
   `computeRetained()` in `src/lib/yield.ts` builds it: each building's
   footprint a plate, its storeys the study's floor heights under its
   recorded height, the zone's uses on them (apartments where the zone takes
   none), no floor space ratio over it; the floor area, apartments and parking
   as for any scheme. It is marked to confirm, not compliant, since the
   variation is the consent authority's to grant — a planner's call.
4. **Within the controls** — the scheme inside the LEP's height and FSR and
   the ADG's separations: its building type, storeys, floor area, apartments,
   saleable area and parking; the controls it is held to (height, FSR, floor
   area, minimum lot size, ADG 2E depth and 3E deep soil) with a mark each;
   the schedule of tiers — storeys, use, setbacks, plate and floor area, each
   tier's number in the ring the plan draws it in — and the apartments, a row
   for each kind in the mix with its share, ADG 4D-1's least area for it, its
   own area, how many there are and the area they take. Not drawn where
   the zone takes no building type the study draws (a low density zone):
   there is nothing to show, and the overview says so.
5. **Reshaped to comply** — the envelope within the controls laid out again
   in the office's feasible footprints so that it meets the ADG's sun
   (`src/lib/reshape.ts`, tested in `test/reshape.mts`):
   - **The footprints:** single-loaded 12 m deep, its gallery on the face
     with least sun; double-loaded 18 m along an east–west axis, its
     apartments running through to the north; double-loaded 22 m along a
     north–south axis, facing east and west; each 15 to 45 m long, a
     double-loaded one at least as long as it is deep.
   - **Where they stand:** in rows within the setbacks (6 m from the street,
     the ADG's half separation from the side and rear boundaries for their
     storeys), the rows and the buildings in a row the ADG's full separation
     apart (12, 18 or 24 m). The rows run along the main frontage, across
     it, or true east–west or north–south.
   - **How high:** to the height of building and held to the floor space
     ratio. All the buildings take one height, or the northern row is a
     storey or two lower, or the rows step down to the north, since a
     building shades the one south of it.
   - **Which layout:** they are read from the most floor area down, each
     one's apartments for their sun (every half hour, then confirmed at the
     quarter hours). The first that meets 4A-1 and 4A-2 is the scheme; where
     none does, the nearest, and it says so.
   - **Its pages:** its own spread (the schedule names each building's plan)
     and its own compliance pages; the floor area it gives up against the
     envelope is the floor area the sun costs.
6. **TOD controls** — where the site is in a TOD area of the Housing SEPP
   (chapter 5, part 2, `src/lib/tod.ts`, tested in `test/tod.mts`):
   - **What it allows:** residential flat buildings in the residential and
     local centre zones to 22 m and 2.5:1, shop-top housing in the local
     centre and commercial zones to 24 m and 2.5:1, each the LEP's where
     more generous.
   - **What it asks:** a lot at least 21 m wide at the street, and 2% of the
     floor area as affordable housing in perpetuity where the scheme is
     2,000 m² or more.
   - **Its pages:** its own spread and compliance pages, drawn only where it
     lifts the LEP's height or ratio on a lot wide enough.
   - **Where a council's alternative replaced it:** Ku-ring-gai's for
     Gordon, Killara, Lindfield and Roseville, in its LEP from
     14 November 2025 (State Environmental Planning Policy Amendment
     (Ku-ring-gai Station Precincts) 2025), within about 800 m of the
     stations; and Belmore, Canterbury, Croydon (in part), Lakemba, North
     Wollongong, Punchbowl, St Marys Metro, Wiley Park and Cockle Creek.
     The LEP's maps already carry the alternative's heights and ratios, so
     there is no extra path.
   - **What the sheets say there:** the controls table, the compliance
     criteria and the spreads' sources name the alternative and the date it
     began. They also say what its maps set that the study does not read
     (affordable housing up to 10% on key sites and 2% across parts of the
     precincts, key sites, active frontages, the low- and mid-rise
     exclusion), and the savings for applications lodged by 13 June 2025.
   - **Deferred and accelerated precincts** are named in the controls table.
7. **Affordable housing bonus** — the same for the Housing SEPP's in-fill
   bonus, 30% more height and FSR for 15% affordable housing, eligibility to
   confirm; drawn only where it gains floor area or apartments.
8. **Envelope to the height** — the setbacks filled to the height plane with
   the FSR set aside, the case a clause 4.6 variation or a planning proposal
   has to carry, marked non-compliant; drawn only where the FSR stops the
   scheme below the height.
9. **Compliance**, for every option with a spread, straight after that
   spread: does its envelope comply? Two pages where the option holds
   apartments, the shadow's alone where it holds none (an office scheme,
   with the yield's criterion on it). The path that rebuilds what stands
   has its pages too, though its massing is what stands. What each
   criterion asks is written in full, in a line of small print under its
   own row, on the first option's pages (the ADG clause and its wording, how
   the yield's most is worked out, what "built out" means).
   - **Shadow** (`…_shadow_and_separation`), the page after the option's
     spread, and its plan. On the left overshadow impact (3B-2) and building
     separation (3F-1), a mark each; the shadow it adds, by the land it
     falls on (residential lots, heritage items, parks and reserves: how
     many lie in its reach, how many it shades, the most it adds and when,
     and the lots it takes below the hours a DCP commonly asks of half their
     open ground); each building near and its separation, today and built
     out. On the right, the whole page, the option's plan at the overview's
     scale (`PLAN_ROOM`), its neighbours in black and white: the lots
     untinted, every building white in a black line with its street number
     and no zone on it (the zones are the overview's), the kerbs, the
     future footprints dashed, each tier of the scheme in its use's colour
     with its envelope dashed and its number as in the schedule (what
     stands, as its own spread draws it). Under the buildings, every
     building's shadow each hour from 9 am to 3 pm, one soft grey layer
     over the last, so the ground darkens with the hours it is in shade;
     the envelope's own at 9 am, noon and 3 pm outlined and named. What the
     envelope adds, the lots it shades and each separation are in the
     tables beside it. `YIELD_SHADOW_LOOK` (JSON, read when the page is
     drawn) overrides any part of that look, for further iterations: which
     hours, whose shadows, the hatch on what the envelope adds
     (`addedGround()`), the separations as dimensions, the neighbours black
     or grey.
   - **Solar access** (`…_solar_access`), the page after that. On the left
     solar access (4A-1 with the hours, again built out, and 4A-2 with
     none) and yield (its floor area against the most the controls allow
     it); the sun on each facade and the roof, by the way each looks, its
     area, its average hours and the share with the hours asked, today and
     built out; and the apartments storey by storey, how many have the
     hours and how many no sun (in bands of storeys over eight). On the
     right the massing twice, the width of the page each and close on the
     building, from the street corner over the same from the opposite one,
     so every face is seen, the town round it a white model (neighbours,
     futures, trees, traffic and ground in white and greys) so only the
     scheme's colours read: each facade cell (a storey high, about 3 m
     wide) and each roof cell (about 3 m square, on what the tiers above
     leave open) in its band of hours, blues under two, the lorikeet's
     green, yellow, orange and red from two.

   Every path's own spread draws its massing alone, the whole right page
   and framed close (14 m of town round the site): its plan is the shadow's,
   the page after. A path with no massing to test (what stands with no
   outline) has that one spread and no plan or shadow page. It
   was one sheet an option, every option's after the last path, the two
   massings side by side over a plan of its own, and each path's spread its
   massing over a second plan: see Z.'s notes below.
10. **Controls and assumptions** — the assumptions the study rests on (floor
   to floor, efficiencies, the mix, the plates, the parking rates, the nearest
   station) on the left; on the right, the full table the office's
   development summary (DA 002) keeps — CONTROLS, PROPOSED and COMPLIANCE for
   the LEP, the parking, the Apartment Design Guide and the Housing SEPP.

A page's text column has to end above its key, and the printer measures it
once the page is laid out (`fitSlides()` in `src/render/pdf.ts`): a yield
spread's tables close up, to four fifths of their size at most, where they
would reach the key, and a column that still stands on it is named in the
log (`WARN page …: its text column runs … mm into its key`) rather than
printed through the key without a word. `npx tsx test/print-check.mts` lays
a made-up deck out in each style, checks that every column ends above its
key, and that a column with more in it than its page holds is caught.

Each drawn path's right page is its indicative massing as an axonometric,
seen from the main street's corner, among the neighbours at their recorded
heights (Overture, its gaps filled from OpenStreetMap, and where neither
records a height Google's 3D meshes over the massing's window, read as the
site report reads them — see *Heights from the meshes*; dashed where none
of them has one), with each tier's envelope
dashed and the LEP's height of building plane over the site. Round it, in pale dashed glass,
the future context (`src/lib/futureContext.ts`, tested in
`test/future-context.mts` and `test/yield-futures.mts`): what the neighbours may
build, as the office's building envelope assumptions have it. On each lot
within 120 m that may redevelop (zoned for flats, R1, R3, R4, MU1, E1, E2,
B1–B4, with a height of building of three storeys or more, and not held by the
capacity study), the largest feasible footprint its envelope holds: 22 m deep
where its long faces look east and west (ten apartments a floor), 18 m
double-loaded along an east–west axis (eight), 12 m single-loaded either way,
at most 45 m long and at least 15 m; the envelope the lot set back 6 m from a
street and, from its other boundaries, by the ADG's half separation for the
storeys it rises to (6, 9 and 12 m), the footprint along the street, nearest
it. It rises to the lot's height of building at 3.1 m a storey, and where the
floor space ratio would stop it short, the footprint shortens so the floor
area the ratio gives still reaches the height. A lot too narrow for any
footprint alone, or held below its height by the setbacks, is joined with the
next lot along in the same zone, as owners amalgamate, up to three lots, kept
where the joined lots use the land better, the lots nearest the site first.
A lot still too small, or one the capacity study holds (a strata scheme, a
heritage item, a mature or a small site), stands as it is. The neighbours on
a lot that redevelops stand today and give way to it built out: the
compliance pages test the sun and the separations against both. A height
mapped as an RL is not read for a lot (its ground is not known), and the
bundle carries each lot's zone, height and ratio (a bundle from before the
lots' ratios reads a building's on the lot). The proposal's
outline is drawn over everything, so a future neighbour in front of it does
not hide it, and a future far above what stands runs out of the frame, as the
height plane does, the frame saying how high it goes. The massing is drawn
after the poster maps of a city (`src/render/axonometric.ts`, the drawing
the site report's built form page shares): every neighbour in its
zone's colour, bold, as the plan beneath tints its lot (the ePlanning colour
where the style keeps it, the category's elsewhere), so the plan and the
massing agree (in Canary its walls turned from the light hatched as shade), on a cream ground of
the activity family — paper in every style. The key names every zone on
the plan, code and name (`R1 General Residential`, `MU1 Mixed Use`), each
with its colour: the lot's tint and, on the spreads that draw the
neighbours in their zones' inks, a block of that ink on it, so the page
says which colour is which zone rather than only that each is its zone's. The photograph goes under the
first page's plan in every style, and under no other page. The town runs to
the frame's every edge: the frame is fitted to the site and 40 m of town
round it (`FOCUS_M` in `src/render/yieldSheet.ts`, at the height of what
stands or is built on the site, or of the plane over it where it is near),
and the town is drawn 230 m out from the site, cut at the frame's edges, so
the pipeline reads the streets, lots, zones, controls, trees and neighbours
260 m round the site (`MASSING_M` in `src/pipeline.ts`).
The ground the massing stands on is drawn too: the streets as surfaces, kerb to kerb
(`src/lib/carriageway.ts`: each centreline swept out to the kerb lines where
the sheet has them, to its class's typical width where it has none, the
sweeps joined so a junction is one surface), white with the kerb as their
edge and a dashed line down the middle; the parks in the living green; the
trees, each a crown on a trunk, which the projection draws as a
circle (a sphere's outline), read off the aerial's green
(`src/lib/crowns.ts`: the photograph's green where it has a canopy's light
and shade, peeled into discs, the widest first, so a line of street trees is
a chain of crowns and a lawn is no tree) and merged with the trees
OpenStreetMap or an open council inventory records, which stand in for the
crowns read at them — none on a footprint, and none on the site where a
scheme stands on it, each a bold green with its light to the north-west;
and the traffic, a vehicle every so often down each street
on the left of its axis, none down a lane (`placeTraffic()` in
`src/render/axonometric.ts`, tested in `test/traffic.mts`). Most are cars,
a body with a cabin, in the families' solid colours in turn; among them
delivery vans, white mostly, a box behind a cab and a bonnet; rigid trucks,
a pale box on its chassis behind a cab; on the arterials and above,
articulated trucks, a trailer behind a long-nosed prime mover; and buses, a
skirt in the blue family under a band of glass and a white roof. The mix
goes by the street's class (a rigid truck now and then even down a local
street, a bus on the collector streets and above), the slots nearest the
site taking it first so the frame shows a bit of each. The site report's
built form page keeps its buses to the bus routes OpenStreetMap maps (a
local street a route runs down takes a collector's mix; where Overpass did
not answer, the class decides); the yield has no routes and goes by the
class. A vehicle that would stand over a kerb, a building or another vehicle
gives way to the next smaller that fits. And the people: a walker every so
often along each street's footpath, a body on the ground with a head over
it, and a rider every so often down the kerb side of the lane, two wheels
and a frame with the body over them, in the traffic's colours and a dark
grey in turn, none where a building or a vehicle stands and none on the
site. The sources line says they are there for scale, not counted. The bundle carries the trees (`trees`), read when the yield is fetched;
a bundle from before them draws the streets and no trees. Under the massing, the
envelope in plan at a round scale, on the ground the site analysis draws, kept to black and
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
  GFA and 90% of retail and commercial. Where the FSR governs, a leaner
  efficiency builds the same floor area higher.
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
  the separations, apartment sizes against 4D-1's minima; cross-ventilation is
  marked for the design to test. Solar access and overshadowing are tested on
  the massing, as the next two points say.
- **Sun to the apartments (ADG 4A-1, 4A-2).** `src/lib/solarAccess.ts`, tested
  in `test/solar-access.mts`, gives each drawn path's apartments their hours
  of sun on 21 June between 9 am and 3 pm AEST, by the quarter hour. The study
  knows how many apartments each storey holds, not where, so each storey's
  facade is shared among them in equal lengths: the plate's outline, a
  courtyard's too, less any wall built to a side or rear boundary, where no
  window can go. An apartment has the sun when at least a metre of its
  facade, a metre above its floor, does (the ADG's 1 m² on the living room's
  glass, the living room taken to be on its sunniest face). The line to the
  sun is tested against the neighbours at their recorded heights (a nominal
  two storeys where none is recorded) and the scheme's own tiers. The share
  with the hours asked (two in the Greater Sydney Region's councils and in
  Newcastle and Wollongong, three elsewhere, `adgSunHours()`) is set against
  4A-1's 70%, and the share with none against 4A-2's 15%. Both are given again
  with the neighbours built to their futures, where any rises. The hours are
  counted in all, as the ADG's criteria read; `"sun": { "continuous": true }`
  counts the longest unbroken run instead, for a council that reads them so,
  and the pages say which. The solar access page's massing colours each
  apartment's facade yellow where it has the hours.
- **Sun on each facade and roof.** `facadeSun()` in `src/lib/solarAccess.ts`
  gives every face of a scheme its hours, storey by storey in cells about
  3 m wide, read 1 m above each floor, and `roofSun()` every roof, the plate
  each tier's roof is less the tiers above it, in cells about 3 m square
  (clipped by `polyclip-ts`), both today and built out; the compliance
  sheets colour the massing's cells by their band of hours
  (`sunBands()` in `src/render/facadeElevation.ts`: seven bands, loriini's,
  none, under 1, 1–2, 2–3, 3–4, 4–5 and 5 hours and over, after the rainbow
  lorikeet: three blues short of two hours, a green where a face just makes
  them, then yellow, orange and #FF5A3D for the most sun; each style takes
  its own blues and greens). The same module can unfold the faces into
  strips (`unfoldedFacades`), which no sheet prints yet.
- **The shadow it adds (ADG 3B-2).** The ground the scheme puts in shadow at
  each hour from 9 am to 3 pm that is in sun today (the neighbours and what
  stands on the site casting theirs), sampled every 1.5 m over the open
  ground of the parks (RE1, C1), the LEP's heritage items and the residential
  lots (R1–R5) it can reach; the ground under a roof is left out. The table
  gives each kind's most and its hour, and the residential lots it shades,
  with those it takes below a common DCP test (half the lot's open ground in
  sun for the same hours), which pass it today. The ADG asks overshadowing
  minimised, a judgement, so a path that adds shadow takes the dash, and one
  that adds none the tick. The bundle carries the heritage items' outlines
  (`heritageItems`); one from before them says the items were not measured.
  The ground is flat and the trees cast no shadow: the figures are a test of
  the massing, for a solar access study to confirm.
- **Separation (ADG 3F-1).** `src/lib/separation.ts`, tested in
  `test/separation.mts`: the least distance in plan from each built tier to
  each building within 24 m, in the band of storeys the two share, against
  the separation the ADG asks between buildings: 12 m between habitable
  rooms up to four storeys, 18 m from five to eight, 24 m from nine, and 9,
  13.5 and 18 m where one face is blank. Which faces have windows is the
  design's, so a distance between the two figures holds only if one is
  blank. A neighbour's storeys are its height at 3.1 m (two where none is
  recorded), today and as its controls let it rise; a building across a
  street is left to the street and the DCP, and a tier built to its side
  boundaries (a podium, the shops) has blank walls there and is not
  measured. The envelope already keeps half of each separation to every
  boundary, so a shortfall is a neighbour's nearness to its own.
- **The Housing SEPP.** The in-fill affordable housing bonus — up to 30% more
  FSR and height for 15% affordable housing — as a second run of the study,
  and a note where the site is in a TOD area, whose controls may apply instead.

Every one of these numbers is in `DEFAULT_ASSUMPTIONS` and can be overridden
from `yield_assumptions.json` in the address's output folder (the CLI's
`out/<slug>/`), any subset of the fields:

```json
{ "mix": { "studio": 0.05, "one": 0.25, "two": 0.55, "three": 0.15, "four": 0 },
  "sizes": { "two": 85 }, "podiumStoreys": 3, "towerPlateMax": 850,
  "parking": { "one": 0.5, "two": 1, "three": 1.5, "visitor": 0.2, "basis": "the council's DCP" },
  "sun": { "hours": 3, "neighbourHours": 3, "continuous": true } }
```

(`sun.hours` sets the hours of mid-winter sun the apartments are held to in
place of ADG 4A-1's for the council, `sun.neighbourHours` those the
neighbours' open ground is (unset, the first), and `sun.continuous` asks
them unbroken.)

The deck prints the ones a run used. It is a feasibility figure, not a design:
DCP setbacks and street wall heights are the design's to test, the sun and
shadow figures are indicative, and mapped controls are not a planning
certificate. Outputs:
`PLANNING_YIELD.pdf` and `PLANNING_YIELD.booklet.pdf` (see *The cover and the booklet*), a PNG a spread in
`yield/`, `.csv`, `.json`, and
`data/yield.json` (the bundle, which redraws with no refetch). A bundle from
before the future heights, the lots' zones and numbers and the kerbs still
draws: without the future neighbours and the plan's labels, its kerbs worked
out from the lots and the roads; one from before the outlines of what stands
gives its figures without drawing it.

### The deck

`--type slides` draws the OVERALL ANALYSIS deck: A3 landscape spreads (each folding into two A4 pages) for the
content part of a feasibility study or design report, specified in
`docs/SLIDES_SPEC.md`. All eighteen slides of the spec exist. The deck
opens on *Country*, as an acknowledgement of the Traditional Custodians (the
page is described below with the layers it holds); then *location*: the
site in its region at 1:100,000 — in Heron and Canary over the region's
photograph in grey under the veil; in Flamingo and Kingfisher the land's
shape banded every 40 m from the elevation model, hatched under its hillshade,
with contours every 20 m traced from the model and a kilometre grid from
the site, the national parks and reserves, the sea in the water's tint and
the harbour, the rivers and the lakes named, the
council areas outlined and named with the site's own tinted, the motorways
cased over the arterial roads, the railways a plain yellow line cased in
white as the motorways are, not a track symbol, and their stations, the suburbs
named, 2, 5 and 10 km rings round the site, and the centres of The Sydney
Plan (2026) by type — with the distance to the Sydney CBD, the nearest
centres, stations and reserves, and the region, the former district and the
council. Then *character*: Wikipedia's summary of the suburb
as the seed text, the places within 1.5 km with articles of their own,
numbered on an aerial of the planning window, and the first eight of them
pictured: each in its own photograph where Commons holds one freely — the
image Wikidata gives the article's item (P18) or the article's lead image,
whichever Commons' own record of the file (its name, description,
categories and where it was taken) says is the place, Wikidata's first; a
montage or a skyline that names no place is not it (the Central Synagogue's
P18 was a montage of Sydney), nor a photograph geotagged more than 1.5 km
away (`judgePlacePhoto` in `src/fetch/character.ts`) — credited with its
author and licence; else from the street where Google Street View is keyed (the nearest
panorama, which can stand in a tunnel, a car park or a museum's hall, so it
comes second); else from above. A photograph of a plan, a logo, a room or a
sign is passed over, and a portrait one is cropped from near its top. All of
it is what the office's own reading and photographs replace. Next to
it the *streetscape*, the street seen before the plans are read:
the site's street as two elevations across the spread, as `--type
streetscape` draws it (both faces on the one spread, every building whole,
the tallest included: the deck's window is the first of 1:1000, 1:1250,
1:1500 and 1:2000 at which the street long enough to fill the spread has its
tallest buildings whole by their recorded heights, `runStreetscapePipeline`
with `fit: 'deck'` and `deckWindows()`, so a low street is drawn 390 m long
at 1:1000 and a street of towers longer and smaller; the meshes are rendered
as high as the tallest building stands and some sky, as fine as the scale
needs; the page then measures the meshes' roofs again and takes the largest
scale that holds them, `layoutFaces` with `whole`; the buildings' lines, heights and
levels over the faces, the conservation areas bracketed, a tower that runs
past its band's top cut there as the meshes are, its tag kept inside the
band; see *The streetscape* below), laid out as the built form page (after height of buildings)
is (the drawing across the whole spread under the deck's heading, no rule
under the subtitle, a lead over the right-hand page, the sources in two
columns across the foot): Street View's photographs laid on Google's
Photorealistic 3D Tiles, and nothing else. The deck takes the page only
where the tiles reach the street, which they do in the cities and not in
every town (Orange and Katoomba have none): a collage of flat Street View
frames reads as a mess, and blocks at their recorded heights are no
streetscape, so a street the tiles miss, a run without
`GOOGLE_MAPS_API_KEY`, a failure, or `DECK_STREETSCAPE=0` leaves the page
out, and the deck fetches no frames to rectify. The recorded heights
(`faceSkyline` in `src/fetch/streetscape.ts`: the footprints on the face's
side within 35 m of its building line, at their heights over the ground,
the tallest where they overlap) choose the deck's window. Then
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
contributions and the housing target — with the extracts left to the author;
the map holds the housing-policy areas and precincts, each kind in a colour
of its own with a pictogram at its heart (a train for a TOD area, a square
for a town centre, a star for a State significant site, a pennant for a
precinct), and when none lies on the block's page it widens, as far as
1:25 000, until the nearest two do, over the region's roads and rail, the
sea under the land (the council areas are the land; the harbour and the bays
are the boundary layer's unincorporated areas and the open sea the gaps
between them) and the railways in the key; the site's ink made vivid and
cased in white, so a speck at 1:25 000 is seen. On the region maps — this one and
the location's — the railways are a plain line like the motorways', in
yellow and cased in white, not a track symbol, with the stations as discs.
Then *topography*: the landform
at 1:5000: the ground's ramp after the old survey sheets (`terrainRamp()`
in `src/render/atlasKit.ts`: sand on the flats, pink then salmon up the
slopes, violet and the deep blue on the heights, each step the style's own
family, so Heron's is terracotta and indigo and Canary's sharper); in
Heron and Canary the ground in 5 m bands washed along it under a strong
hillshade from the State's 5 m elevation model; in Flamingo and Kingfisher
no fill at all, the contours alone, traced from the model every metre (the
fives heavier and numbered), each coloured by its height up the same ramp,
darkened to read as a line; with the 2 m contours numbered along the index
ones, the water named, the high and low points of the page and the site's
level marked, roads and rail over it and two section lines through the site
(the ground under each section in the map's bands; no water is marked on
them, since the model's level where a line crosses a river read wrong),
A–A′ down the steepest fall and B–B′ across it, each drawn as a section
with the site and its levels marked; the text gives the site's RL range,
fall, grade and aspect and where the high ground and the water are. Then
*height of buildings*: every building footprint in the window coloured by height
band (Overture Maps, read from its public bucket by DuckDB through
`src/py/overture_buildings.py`, its gaps filled from OpenStreetMap through
Overpass — a footprint Overture misses joins, and a footprint it holds with
no height takes OSM's height or storeys; OpenStreetMap alone when DuckDB
or Overture is not there; where no source gives a height, Google's 3D
meshes where the deck has them — see *Heights from the meshes* below — else
the storeys of a determined development application on the lot, hatched
and said so), the
storeys of the buildings within 250 m as a
histogram with the LEP height plane marked on it, and section A–A′ again
with the buildings it meets drawn at their heights and the height plane
dashed over the site. Then *built form*
(`formAtlas`), laid out as the streetscape page is: the
drawing across the whole spread under the deck's heading, a lead over the
right-hand page, the sources across the foot. It is the city 300 m
round the site as the yield's massing draws it (`src/render/axonometric.ts`),
the camera off the nearest street looking down 35°, every building in the
colour of its height band as the height of buildings page keys them, windowed, dashed
where no height is recorded; the site's own building in the site's ink, all
keyed as every page's key is, in one column on a white ground padded
alike all round, over the drawing's bottom-right corner, above the
sources' second column (the foot's two columns aligned at their top; a
little block in each storeys' colour, lit as the drawing lights its
buildings, the dashed block of no recorded height and the site's own); the
streets white kerb to kerb (the kerbs worked out from the cadastre), the
parks green, the trees read off the aerial as crowns (`green.crowns`, 330 m
round the site, `lib/crowns.ts`), a little traffic, people on the footpaths
and bicycles at the kerbs. Then *movement*: roads by function, rail and
stations, the walking reach from the site (Valhalla) in bands of three
minutes to fifteen, each band's edge a dashed line in its own colour up the
style's ramp, the warmest nearest, its minutes written on it in the same
colour, over the buildings as a quiet
figure-ground in the family's palest tint, so the blocks read and the
streets between them stay white; the walks themselves from the site to each
place the page lists within fifteen minutes (its parks, schools, halls,
stops and stations), routed on foot on the network by the public router
when the deck is read (`routes` in the movement data), each a thin
translucent line in the family's deepest ink, so a street many walks share
darkens, with an arrowhead where each arrives, the place's dot in its
family (the living green for a park, the activity orange for a school or a
hall, the transit blue for a stop) and numbered to the key; every station
within the reach is routed too, listed or not, and its walk drawn heaviest
with its minutes and metres along it, the corridors of the place; under all
of them every street the reach holds, as a faint mesh in the same ink, the
paths of the place that the walks pick out (no straight lines to the
stations: the walk is the way, not the bearing); the journeys to the
Sydney CBD and the nearest major centre by car and by bicycle from the
public router, as bars of minutes; the car parks OpenStreetMap maps, on the
map as P marks sized by their tagged capacity and as bars of the walk to
the nearest, with their spaces, bus stops (Transport for NSW with the key, else OpenStreetMap),
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
site. The map stands on the aerial, greyed and veiled as the planning
overview's is, in the styles that stand on one: on paper alone it was a
blank with a few washes on it. *Country*, the first page: the open layers of Country over the wide strip — the
pre-1750 plant communities of the State Vegetation Type Map over the land's
shape, each named in the key beside its own swatch (the site's said so), with
no chart of their shares, with the watercourses, the coast, the crests read from the elevation
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
Holders, not generated. The land council areas are named large across the
ground they hold, and no road, rail or cadastre is drawn: the land as it lay,
with contours every 10 m from the model over the communities as a hint of its shape. A motif for an area's ground is its people's to give: the
map draws one over a land council area only where a tile has been placed at
`assets/motifs/<land-council-name>.svg` (or `.png`) with their permission,
and borrows no art style of its own. Then *the site*: the site plan on the aerial at a round scale that
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
neighbours' shadows over the site on 21 June, every hour from 9 am to 3 pm,
each hour one translucent layer over the last so that the depth of the
tint is the hours in shadow, cast from the footprints and their recorded
heights at 1:1000 (the sun path, the street-bearings rose and the wind
roses are drawn in the same ink as the shadows, its lighter cuts for the
lesser arcs and the lighter winds, so the page is one colour), with the share of the site each hour leaves in shadow
and the share that keeps the sun all day; and the sight lines
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
placeholder for the author's narrative. Outputs: `OVERALL_ANALYSIS.pdf` (and its booklet, see *The cover and
the booklet* below), `slides/<id>.png` per slide and `overall.json` with everything the deck says.

Where a council publishes its own DCP mapping as open data — the City of
Sydney does — the deck reads it too, for the sites in that LGA: building
height in storeys, street frontage heights, active frontages, setbacks.

Spread 08b is the capacity and opportunity study (see *The capacity and
opportunity site study* above) as a page of the deck: the same rules from
`src/lib/capacity.ts`, drawn on the template over one A4 page at 1:2000, the
author's marks from `capacity_overrides.json` beside the output. The yield
study reads the same study over its neighbours: a neighbour's future form is
raised only where the study finds development potential, and a strata
scheme, a heritage item, a mature development or a site under 250 m² stands
as it is; its last spread says how many were held, and `PLANNING_YIELD.json`
lists each neighbour's reading.

### Corrections from the Maroubra markup (2026-11)

Z.'s marked-up Canary deck for 86, 88-90, 94 Maroubra Road, page by page:

- *Topography*: the ground's ramp is the hypsometric tints of a topographic
  map, green on the low ground through a pale yellow and sand to a
  terracotta brown on the heights (`HYPSOMETRIC`, `terrainRamp()` in
  `src/render/atlasKit.ts`), the same in every colour style; it was drawn
  from each style's families, which on Canary was a page of pinks under a
  red site. Heron's stays in greys.
- *Capacity and opportunity*: the site is all its properties, flats on a
  deposited plan are a single title, and a lot narrower than 9 m is a small
  site (*The capacity and opportunity site study*, below).
- *Height of buildings*: every height is read a second time (*A second look
  at the heights*).
- *Built form*: the drawing fills its frame to the border, 600 m of the
  town across the spread with the site at its middle and the town running
  out past every edge (`AxoScene.frameM`, `frameReachM()` in
  `src/render/axonometric.ts`), where fitting everything within 300 m drew a
  round town in the middle of the sheet with the frame's corners empty. Only
  what can show in the frame is drawn, so the page is no heavier; the lead
  still counts the buildings within 300 m.
- *Movement*: the lines of walking time lie over the streets, not under
  them (a white street broke each line at every crossing), and the key of
  places is drawn last, so a car park's mark or a stop in its corner lies
  under its white ground.
- *Grid, sun and views*: the streets lie under the shadows, which fall
  across a street as they do across a yard.
- *Environmental constraints*: a page with nothing mapped says so in a
  panel of its own under the map's name (`mapNote`: a head over a hairline
  and a line of the key's small caps, on the key's white ground), where it
  was one line of small type across the middle of the map, over the site.
- *Opportunities and constraints*: the streets lie over the parks' ground
  and under everything the page hatches or rules (the shadows, the sight
  lines, the walking reach), and a sight line's ground is a veil, not a
  white fill, so the blocks it crosses show through it.

### The cover and the booklet

Both decks open on a cover, page 1 of the deck, so the spreads after it are
numbered from 2. There are two covers, for the two ways a deck is read
(`src/render/slides.ts`, after Z.'s layouts of 2026-11):

- **The slides' cover** (`coverPage`) is one composition across the A3 spread,
  in every style: the SITE ANALYST mark over a rule, the deck's name in two
  lines of 27 mm capitals (SITE / REPORT, PLANNING / YIELD), a rule, the site's
  street and suburb with its lot, area and zone beside it, then the picture
  (303 by 182 mm) with the contents down its right, a number and a title a
  spread. The small print (what the deck is and is not, who made it and on
  which day) sits top right.
- **The booklet's cover** (`bookletCover`) is the spread cut in two down the
  fold, its right half the front and its left the back. Flamingo and Kingfisher
  have the picture on the front, under the mark, the name and the site, to the
  page's edges; their back carries the deck's name, the site and the contents.
  Heron and Canary have no picture (`coverHasPicture`): the contents are on the
  front, under the name and the site, and the back carries the deck's name and
  the site alone. Every back closes on the small print in two columns.

The picture is the place's trees as a speckle (`src/lib/coverPicture.ts`):
every tree the deck holds is a fleck of its own, the site in the middle, drawn
at 1:2000 in cells of half a millimetre, in a blue-grey on a pale sage.
- A small tree is a dot of the heart of its crown (0.6 of its width); a tree
  6 m across or more is the lit side of its crown, a crescent open away from
  the light (the north-west). So trees side by side stay apart and the ground
  between them stays open, where the canopy drawn whole ran into patches.
- The trees are the crowns the decks already read off the aerial's green
  (`src/lib/crowns.ts`: the yield's `trees`, the report's `green.crowns`), with
  the trees a council or OpenStreetMap records among them. A street's trees
  fall in a line, a garden's in a cluster, a reserve's in a field of crescents.
- It is the grain of the place, not a map of it: no site mark, no streets.
- The cells are traced into one vector outline, so nothing in it is a raster
  for a viewer to smooth, and Heron, black and white and its one colour, inks
  it in the two colours' greys.
- Trees that stop short of the picture at 1:2000 are drawn closer in, as far
  as 1:1200. A report that holds the aerial's green but no crowns has them
  read off that green when it is drawn (`prepareRasters`); a deck with no trees
  at all has the picture's ground alone.

`npx tsx test/covers.mts` checks the speckle (the dot, the crescent, trees side
by side left apart), the outline (its area the cells' own, holes and corners
included) and which style's cover carries what.

Each deck is also imposed as a booklet (`src/render/booklet.ts`), kept beside
its PDF as `PLANNING_YIELD.booklet.pdf` or `OVERALL_ANALYSIS.booklet.pdf`. Each
A3 landscape side holds two A4 pages, and the sides come in saddle-stitch
order. Printed double-sided on A3, flipped on the short edge, the sheets
stacked as they come out, folded down the middle and stapled twice on the fold,
they make an A4 portrait booklet:
- The cover's right half is the front and its left half the back.
- Each spread keeps its two halves face to face, as drawn.
- Blank pages go in before the back where the pages fall short of a four.

A thin grey dashed line down the middle of every side marks the fold. Printed
on A4 instead, the same file folds to an A5 booklet.

A spread drawn across both pages with the site in the middle would put the site
in the fold, under the staples. The booklet prints its own version of such a
spread, in which the drawing slides sideways within its frame until the site's
outline is 22 mm clear of the fold (the shorter way, to the right where the two
are even); the heading, lead, key and sources stay where they are. In the report
that is *Built form* (09b), the city drawn round the site. The booklet's cover
is printed the same way, in place of the slides' cover:
- `renderSlides` and `renderYieldDeck` return these spreads as `booklet`: their
  HTML, and the deck page each stands in for (0 the cover).
- `printBooklet` (`src/render/pdf.ts`) prints them beside the deck as
  `OVERALL_ANALYSIS.booklet-spreads.pdf` or `PLANNING_YIELD.booklet-spreads.pdf`
  (with its HTML and PNGs), then imposes the booklet with them in place.
- The deck's own page is left out of the booklet altogether.

The A3 slides keep the drawing as it was. A deck imposed on demand by the
server (one drawn before this) has none of these spreads: its booklet folds the
deck's own first page round it. Each half is the spread's
own page, drawn once into the booklet and shown through a window, so the
booklet is hardly larger than the deck. The CLI and `scripts/recompose.ts`
impose it after the deck; `npx tsx test/booklet.mts` checks the order and reads
an imposed deck back as printed.

On the page, PRINT under STYLE (for REPORT and YIELD) picks which of the two the
PDF link downloads: SLIDES, the A3 spreads with their cover, or BOOKLET. It is
not part of what is drawn, so switching it keeps a finished drawing and only
moves its link (`/api/jobs/<id>/pdf?download&print=booklet`, saved as
`…_BOOKLET.pdf`). A deck drawn before booklets existed is imposed on its first
such download and kept beside it; the deck's PNGs show whether it has a cover,
and without one its first spread still opens on pages 2 and 3. A free account's
booklet is stamped with the watermark like its slides.

### The decks' type and alignment

The site report and the yield are set to the office's template (Z. 2026-10)
and to its designer's proof corrections of 2026-11, which every page of both
decks keeps:

- **One last line.** Every page has a last line, 284.7 mm from the sheet's top
  (`Z_BASE`, `ATLAS_BASE` in `src/render/minimap.ts`). The sources' last
  baseline, the key's last line of words or the foot of its last symbol
  (whichever is lower), a right page's closing note and the foot of every
  map's scale bar end on it. The printer (`SETTLE_BASE` in
  `src/render/pdf.ts`) measures each as Chromium set it and moves it onto the
  line, so it holds whatever the number of lines or the shape of a symbol.
- **The scale bar** stands in the map name's column, 8 mm in from the fold,
  its words under the name's, in a box as white and opaque as the name's —
  on every right-page map of the report and every full-width plan of the
  yield. The map's name sits centred in its box.
- **Keys** are rows under hairlines, the symbol at the left, 6 pt caps beside
  it; no symbol taller than its row. A key on a drawing that fills the
  spread (built form) is set the same way on a white ground; a list keyed
  on a map (the movement page's places) is set as the left page's charts
  are, 6 pt and tracked, a hairline between rows.
- **Tables** end on their last row's words, with no rule under it; symbols
  in a row are centred on its capitals.
- **Charts** keep every value after its bar inside the column: where one
  would run past it, the axis runs on to the next round figure.
- **Text** never breaks between a figure and its unit (`375 km`, `27 %`,
  `$297 K`, `4 storeys`), inside a date (`1 Oct 2015`, `2026-11-02`) or a
  scale (`1:10 000`) — `keepTogether()` in `src/render/slides.ts` glues them.
- **The narrative** takes the page's colour: its chart's, or the site's where
  the page draws the site in its ink; grey on the sources page.
- **A spread-wide page** (streetscape, built form) sets its sources in two
  columns, each as wide as its page's text frame (12–198 mm under the
  title's rule, 222–408 mm on the right), both ending on the last line; the
  printer splits the paragraph where its lines halve (`SPLIT_COLUMNS`). A
  streetscape face's credit sits on the line under its name.
- **Ticks and crosses** are drawn with square ends and sharp corners, without
  a white outline.

### The capacity and opportunity site study

`npm run capacity -- "<address>"` draws the context plan an urban designer
prepares to show which lots around a site are likely, or unlikely, to
redevelop in the short to medium term: an A3 landscape sheet at 1:2000, the
blocks around the site (620 × 594 m) over the faded aerial and the cadastre,
every property outlined by ownership (a single title in white, a strata
scheme filled yellow, a heritage building in orange with a fine hatch, a
mature development patched grey), a tick on the lots with development
potential and a cross on those with low potential (strata, heritage, public
land, mature development), the site in red; a white panel on the left with
the legend, the sources, the plan's title and scale, and north. Outputs
`out/capacity/<slug>/diagram.png` and `diagram.pdf` (4961 × 3508 px, A3 at
300 dpi); `--notes my-notes.html` puts the author's own paragraphs at the top
of the panel, `--overrides marks.json` sets the marks the data cannot see
(a new building on a single title from before the council's register
begins, read off the aerial: `{"121-129 CROWN STREET": {"symbol": "mature",
"note": "new"}}`, keyed by the start of the address as the register writes
it, and the sheet's fine print counts them), `--out` names the folder and `--redraw` draws again
from what was already fetched. `examples/capacity_study/` holds the sheet for
70-76 Riley Street, Darlinghurst, with its overrides file and the notes that
fill the panel (the site's State significant application and the likelihood
of redevelopment around it).

What the sheet reads, all open data (`scripts/capacity_study.ts` fetches,
`src/lib/capacity.ts` classifies, as it does for the deck's spread 08b, `render.py` draws):

- *Ownership* from the NSW cadastre and its property register: a property is
  a strata scheme where a strata plan sits under it, or where the register files
  its addresses as under a strata plan (schemes on stratum lots); the unit
  addresses registered against the scheme are its lot count. Three or more
  unit addresses on a title say so only where the cadastre gave no lot under
  it to read the plan from: where its lots are known and all on a deposited
  plan, the units are flats or shops in one ownership, which is one owner to
  deal with and a single title (94 Maroubra Road, four flats on Lot 1
  DP 306910, was drawn as a strata scheme of four until this was read).
  Everything else on a deposited plan is single ownership. The site is every
  property its lots make up, not only the one under its geocoded point: an
  amalgamation of several addresses is several rows of the register, and each
  of them is the site, none of them its own neighbour (86, 88-90 and 94
  Maroubra Road were drawn as the middle address alone, with a cross on 94
  and "the site adjoins 86 Maroubra Road"). Council land is the council's parks and facilities layers
  (the City of Sydney publishes them), State land the ePlanning State
  government land layer. None of this is a title search, and the sheet says so.
- *Heritage items* from the LEP heritage layer.
- *Development* from the council's development monitoring register where it
  publishes one (City of Sydney: applications lodged, approved, under
  construction and completed, with storeys, dwellings and floor space, which
  reaches back only to 2021) and the Planning Portal's Online DA API for live
  applications of a scale that shapes context, alterations to what stands
  left out.
- *When a site was last significantly developed*: the register's completions,
  and the registration of a strata scheme of five or more lots, which follows
  a new building or a substantial conversion. The cadastre's record date for a
  lot is its plan's registration date for every plan after the digital
  cadastre was built in September 1993 (older plans all carry that date, and
  are left undated), so a strata plan dates a building back to then.
- *The marks*, in the style's palette (strata ownership a wash of the
  activity family, a heritage item a hatch of the red, the mature development
  a dotted patch of the transit blue, a tick in the living green, a cross in
  the red): a dotted patch (mature development, unlikely to develop) on a
  site significantly developed in the past 20 years (a strata scheme of five
  or more lots registered, or a new building, or an addition or conversion of
  four storeys, five dwellings or 1,000 m², completed on the register, or the
  author's overrides), with the year under it, and on a site with a current
  approval, construction or live application for a new building; a cross (low
  development potential) on every mature development, on strata ownership
  (the lot count printed under it on a scheme of more than 30 lots), on a
  heritage item, on public land and on a small site, under 250 m² or
  narrower than 9 m (a terrace's lot or one half of a semi-detached pair,
  277 m² at 6.1 m wide along Maroubra Road: the width is the lesser side of
  the title's least bounding rectangle, and 9 m parts those from a detached
  house's lot at 10 m and over), which has
  little ability to develop above its current status; a tick (development
  potential) on every other property. Lane stubs and slivers under 40 m² carry no mark.

### The streetscape

`--type streetscape` draws STREETSCAPE: the site's street as two elevations on
one A3 landscape sheet, the site's side above and the side across the road
below, each as a viewer standing in the street sees it, so the two run
opposite ways, at one true scale (the largest round scale at which the
street's length fits the sheet's width and the site's own building fits its
band whole, with a little sky over it: 1:500 for the default 190 m,
`--half-length 95` either way from the site, where nothing on the site
stands taller than its band). Each band takes what it must have, and the
two share what the page has left in proportion to what they want, so the
site's band can stand taller than the other's. The sheet caps a band at
60 m over the ground, cutting a narrow tower; the deck's page does not (see
above): there the window's length and scale follow the street's tallest
buildings, 388 m at 1:1000 at 150 George Street. Under each face every
property's frontage is dashed off and named by its address, the roads and
lanes that come in are named upright in their gaps, and the site is marked in
red between dashed lines, with the stretch across the road from it marked too.

The street is the address's own, its centreline from the NSW Transport
Theme, and `s` is the distance along it, zero opposite the site. From the
centreline every metre a ray goes out square to each side; the first boundary
of the NSW property layer it meets is that metre's frontage, with the
property's own address (a corner lot keeps its other street's), and a ray that
meets nothing near the side's building line is a gap.

**The faces: Street View photographs on Google's 3D city model**
(`--source photo`, the default). The geometry is Google's Photorealistic 3D
Tiles (the Map Tiles API, on the same `GOOGLE_MAPS_API_KEY`, which must have it
and the Street View Static API enabled). The tileset is walked from its root,
opening only the boxes that meet the street's corridor and refining each to the
finest mesh with under 0.6 m of error (`src/fetch/tiles3d.ts`); the meshes stay
in memory, as Google's terms ask, and one root request is the session Google
bills, 1,000 a month free. In a headless Chromium with WebGL in software,
three.js carries them from Earth-centred coordinates into the site's
east-north-up frame in double precision (`src/render/elevation3d.ts`).

For each face rays are cast down on the footpath at the boundary first. The
meshes are one surface draped over everything, with no ground under a canopy
or an awning, so the ground line is the 5 m elevation model's, lifted by the
low fifth of what the rays read over it (21.9 m at Riley Street: the geoid,
the meshes standing on the ellipsoid where the model stands in AHD). Then an
orthographic camera stands on the centreline square to the face, its near
plane on the centreline, so the other side's buildings and trees are cut away,
and its far plane 35 m behind the boundary, so the next street's towers are
left out. The meshes' own textures are the base; over them each Street View
frame (a panorama every 7 m, turned square to the face, low for the footpath
and high for the storeys over it) is projected from where its camera stood,
on the meshes' heights, as a slide projector would. A point takes a frame's
colour where the frame saw it clear: a depth map rendered from the camera says
whether anything stood between (nothing within 4 m of it counts, since the
meshes draw a street tree as a lump the camera on a car's roof is often
inside), and a surface the frame saw nearly edge-on, its normal read from the
position picture's own slopes, is left to another frame. Where several frames
saw a point, the one that saw it largest and most square, nearest along the
street, wins. The street's trees (what stands in the reserve more than 2.5 m
in front of the boundary, and the meshes' green nearer it) keep the meshes'
texture, one material for every tree, and so does what no frame saw clear: a
roof, or the upper floors behind a canopy from every camera. At Riley Street
the photographs hold about two fifths of each face, the rest trees and roofs.
The picture is 24 pixels a metre (300 dpi at 1:500), on a white sky (the page's own paper), over a
band of ground, and runs as high as the face's tallest buildings: nothing
leans, the facades are the photographs, each at its own depth, and the trees
stand where they stand.

`--source mesh` draws the meshes' own textures alone. Google serves these
tiles only to Cloud projects billed outside the European Economic Area (since
8 July 2025 an EEA project gets 403, "not available for your account and
region"), and its finest meshes over Darlinghurst carry 2 m of error, so the
trees are lumps and the outlines are soft, though the textures are sharper
than the meshes. At 70-76 Riley Street in October 2026: 47 meshes, 5.6 MB, 18
panoramas, the whole drawing in under a minute.

**Without the Map Tiles API** (or `--source montage`), the faces are the
Street View frames alone, each rectified onto its side's boundary by its
homography, a CSS `matrix3d`, so the frames meet where the street does, and
not one over a road the Transport Theme puts in a tunnel (the Cross City
Tunnel's are filed as outdoor). What stands in front of the boundary reads
larger and a building set back from it smaller, as in any montage. Without a
key, the faces are their ground and frontages alone. `STREETSCAPE_SOURCE`
sets the source for the server, as `--source` does for the command line.

**Building lines** (`--overlay`). Over the 3D faces, each frontage's building
is drawn gently, a veil of white over the picture with a hairline edge: its
roofline in steps where it changes by more than a metre, down to the ground at
the lot lines, floor lines in white at 3.1 m a storey of its measured height
(evenly spaced, not surveyed), and over its tallest step its height over the
ground and its level in AHD (`21.9 m · 7 ST`, `RL 34.0`), the site's in a pale
red. The tops are read from the render itself: the meshes again with
the camera's near plane a metre short of the building line, so the street's
trees and the awnings over the footpath are cut away and what stands behind
them shows, each column's highest pixel that is not green. At Riley Street the
lines sit on the meshes' buildings to within a metre; over the image model's
picture (`scripts/streetscape-ai.ts import … --overlay`) they show where it
drew lower or higher than the street stands. `--fill none` draws the outlines
alone, and `--fill heritage` tints each building by its contribution to its
conservation area instead of the white veil.

**Heritage.** Each face is read against the LEP's heritage layer (the NSW
Planning EPI layer: conservation areas and heritage items, everywhere in NSW)
and, in the City of Sydney, the DCP 2012 map of building contributions
(contributing, neutral, detracting), each 3 m behind its frontage's boundary,
where its building stands: every 2 m along the frontage (three points at
least), a rating by the most of them, an item where any falls in one
(`src/fetch/streetscapeHeritage.ts`). The conservation areas are bracketed and
named over each face's band, and the sheet's lead says which the street runs
through and how its frontages are rated. With `--fill heritage` the buildings
are tinted sandstone (contributing), white (neutral) or slate (detracting),
unrated ones left clear, the LEP's items outlined in deep red and numbered
once over the run of frontages they cover, with a legend. A corner or a deep
lot can read its neighbour's polygon, so the sheet says the plan's own maps and
schedule govern. At Riley Street, 680 m through Woolloomooloo (C71), William
Street South (C16), East Sydney (C13) and Oxford Street (C17): of 78 rated
frontages 70 contribute, 3 are neutral and 5 detract, and 20 LEP items front
the street.

**A long street** (`--scale 1000`). The sheet takes the largest round scale
at which the window fits A3; `--scale` forces one, on a sheet as long as the
window then needs at A3's height (Riley Street's 680 m at 1:1000 is 710 ×
297 mm), each band as tall as its tallest measured roof (the third highest
metre of the roofs, so a mast is passed over and a narrow tower is not). Over
a long window the street bends, so its axis is the line that best fits its
centreline within the window, not the chord between its farthest points, which
put Riley Street's building lines 24 m out at ±340 m. A face wider than 8,000
pixels is rendered in pieces of whole metres, the camera moved along the axis
for each, and stitched. `--through "Oxford Street"` runs the window on, at the
end nearer that cross street, 40 m past where it crosses (its carriageway and
a little of the far side), so a conservation area's edge at a main road shows
whole; the axis stays the street's within `--half-length` of the site, so the
rest of the drawing is the same picture, moved by the new columns at one end
and any new rows over higher ground (at Riley Street, to within the JPEG's
noise). Its window ran on from 340 to 422 m through Oxford Street, and the 32
image-model tiles already laid went back on, the manifest's boxes moved by as
much, with only the new 82 m to ask for.

Outputs: `STREETSCAPE.pdf` and `streetscape.png`, the pictures and
`data/streetscape_bundle.json` beside them. The overall analysis draws it
too, as the page after character, with the building lines; the image-model
pass below is never part of it. It runs in the image's own Chromium
(Debian's, WebGL in SwiftShader): Riley Street's photographs on the 3D tiles
took 50 s there.

**Through an image model.** The 3D faces can go through an image model that
edits a picture in place (Artlist's Nano Banana Pro, at 21:9 and 4K), which
redraws the meshes' lumps as trees and their melted roofs as roofs, and cleans
the seams between photographs, as an illustrative sheet beside the measured
one. Artlist is reached through its connector in a Claude session (or its own
app), not from this server, so it is three steps:

```bash
npx tsx scripts/streetscape-ai.ts export out/<slug>
```

cuts each face into tiles of the model's frames, each as tall as the street it
holds stands (its ground to just over its roofs), in the widest frame (21:9,
then 16:9, 3:2, 4:3, 1:1) that leaves it no more than two fifths sky, and
overlapping its neighbour by 8 m, into `data/ai/`, with `manifest.json` placing them and the prompt to
ask (to keep the photographed facades, or, for meshes alone, to redraw them). Each tile goes through the model, and its answer is saved beside it as
`<tile>.ai.png`. Then

```bash
npx tsx scripts/streetscape-ai.ts import out/<slug> --model "Nano Banana Pro"
```

checks each answer against its tile, lays it back and prints
`STREETSCAPE_AI.pdf`, labelled AI-enhanced and illustrative
(`STREETSCAPE_AI_HERITAGE.pdf` with `--fill heritage`, `STREETSCAPE_AI_LINES.pdf`
with `--fill none`; `--scale` as for the measured sheet). `sheet` in place of
`import` draws the sheet again from the tiles already laid. An answer that
built on more than a quarter of its tile's sky has redrawn the street rather
than cleaned it (given a strip of street under a band of sky, the model
repeated the street in the sky), so it is refused, named, and the face keeps
its own picture there until it is asked again. One that kept the street is put
back where it slipped to (the shift that best lays its edges on the tile's: 13
px, half a metre, for one Riley Street tile), scaled into its box so a metre is
still a metre, and crossfaded with its neighbour over their overlap. Given the
photographs on the meshes, the model keeps the real facades and redraws the
trees and what no photograph saw; given the meshes alone (`--source mesh`), it
invents the facades, and the sheet says so. At Riley Street the meshes alone
went through whole once a tile holding the 24 m block beside low terraces,
half sky in 21:9 (refused twice, prompt or no), was cut 16:9 instead. Along
680 m of it (32 tiles), 3 of the first 29 answers were refused: one went
through when asked to leave the grey under its trees open, and the other two
stacked the street again through four answers each, a sloping run under a
tall end and a low terrace under one tall tree; each was cut again by hand into
shorter frames (two 16:9; a 3:2, a 1:1 for the tree, a 4:3), entries in
`manifest.json` in place of the one, and all went through. Exporting
again moves the earlier tiles, and any answers, to `data/ai-<when>/`; an
answer can be copied back where its tile is unchanged.

### Heights from the meshes

The open footprint sources carry a height on a quarter of their buildings
and a storey count on half; around a Bondi Road site neither had a height
on any neighbour, and both missed most of the shopping strip's lots. The
streetscape reads its elevations off Google's Photorealistic 3D Tiles, and
the deck now reads the same meshes for the rest of the page: with
`GOOGLE_MAPS_API_KEY` set, the meshes over the 1:5 000 window are fetched as
the streetscape fetches them over its street (`src/fetch/tiles3d.ts`), at a
geometric error of 6 m rather than the streetscape's half-metre: over a
Bondi page (1,050 × 1,485 m) Google's tree gives more than 1,500 meshes at
4 m, which is past the cap and was why the first live run read none, 431
at 6 m (tiles of 2 and 4 m) and 133 at 10 m; a page that holds more than
`MESH_HEIGHTS_MAX_TILES` (900) at the error asked is tried again at 10 m,
then 16 m, since the walk gives up before it fetches a mesh. The page the
elevations are
drawn on (`src/render/elevation3d.ts`) renders them once from straight
above, into a grid of heights a metre apart with a flag where the meshes'
own picture is green; and the meshes are let go. Google's terms bar keeping
them, and nothing of them is written anywhere: what is kept is a number a
building. From the grid (`src/lib/meshHeights.ts`, which has no network and
is tested on grids drawn for it, and on a box in a glTF built for the test
and rendered the same way): a footprint with no height, or only a consent's
storeys, takes its roof — the 80th percentile of the surface inside it, read
where the picture is not green, since a tree over a roof is the tree — over
its ground, the 15th percentile of the surface within 8 m round it leaving
out what other footprints hold, which is the street and the yards; under
2.5 m nothing stands. A built lot with no footprint at all
(`src/lib/gapLots.ts`, the lots the height of buildings page hatched as
gaps in the data) gets one traced from the surface: every cell of it that
rises 3 m over the lot's ground and is not green is built, each patch of
those of 25 m² or more is a footprint, its edges traced round the cells and
the stair-steps smoothed to the wall lines, its height the patch's roof over
the ground. The source's measured heights and storey counts stand; a
determined application's storeys fill only what the meshes could not. The
height of buildings page, the built form, the shadows and the sources page
say how many heights and footprints came from the meshes, and credit Google
and the providers the meshes name. `DECK_MESH_HEIGHTS=0` leaves the meshes
out of the deck; `MESH_HEIGHTS_ERROR_M` sets the error the tree of tiles is
walked down to (6 m by default); `MESH_HEIGHTS_MINUTES` (6) is how long the
meshes may take to come and be read before the deck goes on without them.
A fault in the reading is logged and the footprints stay as the sources gave
them: a deck is never lost to it. The log says how many heights were read
and how many footprints traced when the meshes are read, and again in the
summary line the fetches end on (`mesh-heights:` and `traced:`), which is
the line still in the page's tail of the log when the drawing is done.
The planning yield reads the same meshes over its massing's window (about
600 m across, a few dozen meshes at 6 m), for the neighbours and for what
stands on the site alike, whose lot is traced too when the sources have no
footprint on it; its key, its sources lines and its JSON say so and carry
the credit.
`npx tsx scripts/patch_bundle.ts out/<slug> mesh` reads the meshes into a
kept bundle, so a deck drawn before can be recomposed with the heights
without fetching the rest again. One
root request to the Map Tiles API a
deck, as the streetscape costs, in a session of its own (one more for each
coarser level tried). Read over the Bondi page with Overture's 2,573
footprints: 431 meshes in 16 s, a height on 1,323 of the footprints that
had none, the rest sheds under 2.5 m or specks under 4 m², and against the
37 the source gave storeys for, the meshes read a median 1.2 m higher (a
pitched roof's 80th percentile against storeys × 3.1), 78 % within a
storey. `GOOGLE_MAPS_API_KEY=header` says a proxy in front of the process
adds the key to the tile requests as `X-Goog-Api-Key`, and none goes in the
query.

### A second look at the heights

A source's height was taken as it stood, and one wrong tag drew a tower. At
Maroubra a mapper typed a house's street number into its height
(OpenStreetMap way 1436151685, 62 Boyce Road, `height=62`, which Overture
carried), and the house stood 62 m, twenty storeys: the tallest building on
the height of buildings page, in the massing, the shadows and the
narrative. Every height is now read twice (`src/lib/heightCheck.ts`, pure
arithmetic, `test/height-check.mts`):

- *Against the meshes*, where they are read: the surface gives every
  footprint a height of its own, the sources' included, and a source's
  height grossly apart from it (by more than 8 m and more than six tenths of
  the greater) gives way to the meshes' reading. Over the Maroubra page 199
  of the sources' heights were checked and 14 replaced: the house, 62 m to
  5.6 m, and thirteen blocks the sources had at one or two storeys that
  stand seven to ten (Pacific Square at 6 m, read 33.5 m). The 185 the
  meshes bore out agree to a median 1.8 m (a pitched roof over storeys ×
  3.1), and keep their source's height with the meshes' beside it.
- *Against the footprint and the plan*, where no mesh spoke: a height over
  25 m that is more than five times its footprint's lesser side and more
  than three times the height limit mapped over it (eight times the lesser
  side where no limit is mapped) is set aside, and the building is drawn as
  one with no recorded height. 62 m on 10 × 17 m under a 9.5 m limit fails;
  a slab, or a pencil tower under a limit that allows it, stands.
- *The meshes' own readings*, which take a tree for a roof where its picture
  is not green: a height the meshes read over 12 m, more than one and a half
  times the lesser side, and under no limit (a park) or more than 1.4 times
  it, is a tree or a mast. A source's footprint keeps its place with no
  height; one traced from the meshes alone is not drawn (a 21 m "building"
  of 78 m² in Nagle Park).

What was set aside stays on the building (`doubted`: what it said, from
where, and why), the log names each one so the tag can be mended upstream,
the height and built form pages' sources say how many heights were checked
and how many were not taken, and `overall.json` lists them
(`builtForm.doubted`). `npx tsx scripts/patch_bundle.ts out/<slug> mesh`
applies it to a kept bundle; `… heights` applies the footprint test alone.

## How it works

```
address
  → geocode (NSW Spatial addressing)
  → site lot polygons: every lot of each property an address names (NSW cadastre)
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

### Several addresses as one site

An amalgamation is typed as one address with its numbers as a range or a
list on the one street: `91-109 Riley Street, Darlinghurst` or
`134, 136, 136A, 138 Showground Rd, Castle Hill`. The geocoder finds each
number however the register files it (91-93, 95-97, 99-107 and 109 for the
first), and every drawing takes the lots of all of them as one site: one
outline, one area, every lot in the site's description, and the yield worked
on the whole. The sheets name the site by all its addresses in street order,
`91-93, 95-97, 99-107, 109 RILEY STREET DARLINGHURST`.

The register answers some questions in a second and others in a minute and a
half, so the geocoder (`src/fetch/geocode.ts`) asks the quick ones first. Each
number is looked up exactly; once one of the site's addresses is found, the
rest of the street within 250 m of it is read in one query and every number it
covers is taken from that. Where no number is an address of its own (none of
91, 93 … 107 is), the Planning Portal's address search names the properties
there, and they anchor the same query. Only what is still missing is looked up
by number prefix (`address LIKE '91-%'`), the query that cold can take 45 to
over 100 s: a few at a time, each given two minutes, and called off once the
site is complete. Before this a range spent most of the job's twenty minutes on
prefix lookups that were given sixty seconds each, never finished, and failed
the sheet with `The operation was aborted due to timeout`. A number the
register still does not answer for leaves a `WARN` that the site may be
missing its lots, and a register that answers nothing fails with a message
saying so rather than "not found".

A site is the properties its addresses name, not only the lots their points
sit on. 99-107 Riley Street is three lots under one address, its point on the
southern one; each address's property is read from the cadastre's property
layer and every lot inside it is taken (`fetchSiteLots()` in
`src/fetch/nsw.ts`). A property of more than 40 lots or 5 ha, a campus or a
corridor rather than a site, keeps only the lot under the address.

Lots that still do not join, a lane or a lot no address names between them,
are drawn about the largest piece, and the log says so with a `WARN` line.
A range from an odd number to an odd one, or even to even, keeps to that
side of the street, as the register does. A corner or through site whose
lots front two streets cannot yet be typed as one address.

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

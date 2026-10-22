# Security & crawler identity

This document is the public record for the HTTP client that
**au-site-analysis** runs. If you operate a firewall, WAF, or data API and you
see requests from this tool, this page tells you what it is, how it behaves,
and how to reach or block its operator. The tool points every request here: the
`User-Agent` it sends carries this repository's URL, and the running site
serves the same reference at `/.well-known/security.txt`.

## What the tool is

au-site-analysis generates architectural site-analysis drawings for a NSW
street address, entirely from open data — no site visit, no scraping of private
or authenticated content. To do that it makes a small number of server-to-server
requests, per address analysed, to **public and NSW-government open-data
endpoints** (planning registers, ABS statistics, OpenStreetMap/Overpass,
imagery and terrain services, and similar). It reads published data only.

## How to recognise its requests

Every outbound request identifies itself with this `User-Agent`:

```
au-site-analysis/1.0 (NSW architectural site-analysis tool; +https://github.com/samiabdulnour/au-site-analysis)
```

The `+URL` is the convention (as Googlebot and others use) for "the operator
documents this client here." The identity is defined in exactly one place in
the source — `src/lib/http.ts` (`USER_AGENT`) — and applied to every request,
so it does not vary between endpoints. When the operator configures a contact
(see below), it is appended to the `User-Agent` and sent as a `From:` header.

## How it behaves (why it is a good citizen)

- **Low volume.** Requests are driven by a human analysing one address at a
  time, not a continuous crawl. There is no link-following or site-wide
  spidering.
- **Cached.** Responses are cached on disk (for example, Overpass answers for
  up to 30 days), so repeated analysis of the same area does not re-fetch.
- **Backs off.** All requests go through a shared helper
  (`src/lib/http.ts`, `retryFetch`) that retries transient failures
  (`408, 425, 429, 500, 502, 503, 504, 522, 524`) with **exponential backoff
  and jitter**, and honours timeouts. A `429` or `503` is treated as "slow
  down," not retried aggressively.
- **Fails quietly.** An endpoint that refuses or is unavailable is reported in
  the run and skipped; the tool does not hammer a source that has said no.

## Contact

The operator can set the `SITE_ANALYSIS_CONTACT` environment variable (an email
address or a URL) to publish a direct contact in the `User-Agent`, the `From:`
header, and `security.txt`. Otherwise, reach the operator through this
repository:

- Report a vulnerability: <https://github.com/samiabdulnour/au-site-analysis/security/advisories/new>
- General issues: <https://github.com/samiabdulnour/au-site-analysis/issues>

## If you need to block it

Blocking by the `User-Agent` substring `au-site-analysis` is reliable and
specific — the string is stable and unique to this tool. Please also open an
issue so the operator can stop sending requests to your service rather than
retrying against a block.

## Reporting a vulnerability in this project

Use the GitHub security advisory link above for anything sensitive; use regular
issues for everything else. There is no separate disclosure inbox.

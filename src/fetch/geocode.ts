// Address string -> point(s) via NSW Spatial Geocoded Addressing Theme.
//
// NSW addressing quirks this handles:
//  - ranged parents: "212 Bondi Rd" is stored only as "212-218 BONDI ROAD"
//  - unit noise: "212/115 BONDI ROAD" is unit 212 at no. 115 — must NOT match
//  - suffixed numbers: 212A; unit inputs: "5/212 Bondi Rd" -> parent 212
//  - locality mismatches: user's suburb vs the official locality

import { queryByExtent, queryWhere, type GeoJSONFC, type QueryOpts } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, type Extent, type XY } from '../lib/geo.js';
import { retryFetch } from '../lib/http.js';

const ADDRESS_POINT =
  'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1';
/** The Planning Portal's own property search, the one src/fetch/planning.ts reads property reports from. */
const PP_ADDRESS = 'https://api.apps1.nsw.gov.au/planning/viewersf/V1/ePlanningApi/address';

const STREET_TYPES: Record<string, string> = {
  st: 'STREET', rd: 'ROAD', ave: 'AVENUE', av: 'AVENUE', hwy: 'HIGHWAY',
  pde: 'PARADE', dr: 'DRIVE', ln: 'LANE', pl: 'PLACE', cres: 'CRESCENT',
  cr: 'CRESCENT', ct: 'COURT', bvd: 'BOULEVARD', blvd: 'BOULEVARD', tce: 'TERRACE',
  esp: 'ESPLANADE', cct: 'CIRCUIT', gr: 'GROVE', cl: 'CLOSE', wy: 'WAY',
};
const TYPE_WORDS = new Set([...Object.values(STREET_TYPES),
  'STREET', 'ROAD', 'AVENUE', 'HIGHWAY', 'PARADE', 'DRIVE', 'LANE', 'PLACE',
  'CRESCENT', 'COURT', 'BOULEVARD', 'TERRACE', 'ESPLANADE', 'CIRCUIT', 'GROVE',
  'CLOSE', 'WAY', 'MALL', 'ROW', 'WALK', 'PLAZA', 'CIRCLE', 'RISE', 'SQUARE']);

export interface GeocodeResult {
  points: XY[];
  center: XY;
  matchedAddresses: string[];
  query: string;
}

export interface ParsedAddress {
  numbers: string[];
  street: string;    // "BONDI ROAD"
  locality: string;  // "BONDI" (may be '')
}

/** "5/212 Bondi Rd, Bondi NSW 2026" -> numbers ["212"], street "BONDI ROAD", locality "BONDI" */
export function parseAddress(input: string): ParsedAddress {
  let s = input.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(NSW|AUSTRALIA)\b/g, '').replace(/\b\d{4}\b/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(UNIT|SHOP|SUITE|LEVEL|APT|APARTMENT)\s+\w+[,/]?\s+/, '');
  s = s.replace(/^\w+\//, ''); // "5/212 …" -> "212 …"
  const { nums, rest } = splitNumbers(s);
  if (!nums.length || !rest) {
    throw new Error(`Cannot parse address: "${input}" — use e.g. "212 Bondi Rd, Bondi NSW"`);
  }
  const words = rest.split(' ').map((w) => STREET_TYPES[w.toLowerCase()] ?? w);
  // split street / locality at the LAST street-type word
  let typeIdx = -1;
  for (let i = 0; i < words.length; i++) if (TYPE_WORDS.has(words[i])) typeIdx = i;
  const street = (typeIdx >= 0 ? words.slice(0, typeIdx + 1) : words).join(' ');
  const locality = typeIdx >= 0 ? words.slice(typeIdx + 1).join(' ') : '';
  return { numbers: expandNumbers(nums), street, locality };
}

/**
 * Consume the leading house-number tokens. NSW registers a multi-lot parent as
 * a list — "134, 136, 136A, 138 SHOWGROUND ROAD" — so there may be several,
 * mixed with ranges. Commas are already spaces by the time this runs.
 */
function splitNumbers(s: string): { nums: string[]; rest: string } {
  const parts = s.split(' ').filter(Boolean);
  const nums: string[] = [];
  let i = 0;
  for (; i < parts.length; i++) {
    if (!/^\d+[A-Z]?(?:-\d+[A-Z]?)?$/.test(parts[i])) break;
    nums.push(parts[i]);
  }
  // Never swallow the whole string: a street name can begin with a number
  // ("7 Hills Road"), so always leave at least one token for the street.
  if (i >= parts.length) return { nums: nums.slice(0, 1), rest: parts.slice(1).join(' ') };
  return { nums, rest: parts.slice(i).join(' ') };
}

/** "212-218" -> 212, 214, 216, 218, plus the range itself. */
function expandNumbers(nums: string[]): string[] {
  const out: string[] = [];
  for (const tok of nums) {
    const r = tok.match(/^(\d+)[A-Z]?-(\d+)[A-Z]?$/);
    if (r) {
      const a = parseInt(r[1]), b = parseInt(r[2]);
      const step = (b - a) % 2 === 0 ? 2 : 1;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n += step) out.push(String(n));
    }
    out.push(tok);
  }
  return [...new Set(out)];
}

const sql = (s: string) => s.replace(/'/g, "''");

interface Candidate { address: string; housenumber: string; lon: number; lat: number }

const candidatesOf = (fc: GeoJSONFC): Candidate[] => fc.features
  .filter((f) => f.geometry)
  .map((f) => ({
    address: f.properties.address as string,
    housenumber: String(f.properties.housenumber ?? ''),
    lon: f.geometry!.coordinates[0],
    lat: f.geometry!.coordinates[1],
  }));

async function fetchCandidates(where: string, cap = 200, q: QueryOpts = {}): Promise<Candidate[]> {
  return candidatesOf(await queryWhere(ADDRESS_POINT, where, 'address,housenumber', cap, q));
}

// How long each kind of lookup is given against the address layer, measured
// against it. An exact address is the index's own question and answers in
// well under a second. So does every address on one street inside a few
// hundred metres: the spatial index narrows it to a block before the street is
// matched. A number prefix ("91%") is meant to be on the address index too,
// and often is (0.7 s), but cold it measured 45 to over 100 s for the same
// shape of query, and the unanchored street scan longer still. At sixty
// seconds a try such a query never finished, so its retries never found the
// server's cache warm either, and five of them in turn for each number of a
// range ran the site report past its own limit: "The operation was aborted
// due to timeout". The slow kinds are given long enough to finish once.
const EXACT: QueryOpts = { timeoutMs: 30_000, attempts: 3 };
const NEAR: QueryOpts = { timeoutMs: 30_000, attempts: 2 };
const PREFIX: QueryOpts = { timeoutMs: 120_000, attempts: 2 };
const SCAN: QueryOpts = { timeoutMs: 150_000, attempts: 1 };
/** However many prefixes are asked, they are given this long together: the sheet has its own twenty minutes. */
const PREFIX_BUDGET_MS = 240_000;
const HINT: QueryOpts = { timeoutMs: 45_000, attempts: 1 };
/** How far round an address already found the rest of its street is looked for. */
const NEAR_M = 250;
/** How many prefix lookups are in flight at once: the address layer is shared with every other job. */
const RACE_WIDTH = 4;

/**
 * Prefix lookups, `RACE_WIDTH` at a time, called off together when `done()`
 * says the site is complete or when the budget runs out. What the budget cut
 * short, asked or not yet asked, is reported to `unanswered`.
 */
async function prefixLookups(
  lookups: { n: string; anchor: string }[],
  ask: (l: { n: string; anchor: string }, signal: AbortSignal) => Promise<void>,
  done: () => boolean,
  pending: (n: string) => boolean,
  unanswered: (n: string, e: unknown) => void,
): Promise<void> {
  const stop = new AbortController();
  const outOfTime = new Error(`the address register's number lookups took more than ${PREFIX_BUDGET_MS / 1000} s together`);
  const budget = setTimeout(() => stop.abort(outOfTime), PREFIX_BUDGET_MS);
  try {
    await inTurn(lookups, RACE_WIDTH, async (l) => {
      if (stop.signal.aborted || !pending(l.n)) return;
      try {
        await ask(l, stop.signal);
        if (done()) stop.abort();
      } catch (e) {
        if (!stop.signal.aborted) unanswered(l.n, e);
      }
    });
  } finally { clearTimeout(budget); }
  if (stop.signal.reason === outOfTime) for (const l of lookups) if (pending(l.n)) unanswered(l.n, outOfTime);
}

/** Runs `fn` over `items`, `width` at a time, in order. */
async function inTurn<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** The prefixes a number is looked up by: a short bare prefix is not selective ('1%' is a third of the register). */
const anchorsOf = (n: string) => (n.length >= 3 ? [`${n}%`] : [`${n} %`, `${n}-%`]);

/**
 * The Planning Portal's search for "<number> <street> <locality>": the
 * register's own spellings of properties on that street, about a second each
 * however cold. It answers "91 RILEY STREET DARLINGHURST" with "91-93 RILEY
 * STREET DARLINGHURST 2010" and "SHOP 1 91-93 …", and "19 HASSALL STREET
 * PARRAMATTA" with the units of "17-19 …"; what comes back is cut to the
 * street address — the unit, the shop and the postcode taken off — and kept
 * only where it is on the street asked about.
 */
async function portalSearch(n: string, tail: string): Promise<string[]> {
  const res = await retryFetch(`${PP_ADDRESS}?a=${encodeURIComponent(`${n} ${tail}`)}`, {}, { attempts: 2, timeoutMs: 20_000, label: 'Planning Portal address search' });
  if (!res.ok) throw new Error(`Planning Portal address search -> HTTP ${res.status}`);
  const text = await res.text();
  const rows: { address?: unknown }[] = text ? JSON.parse(text) : [];
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => streetAddressOf(String(r.address ?? ''), tail)).filter((a): a is string => !!a))];
}

/** "SHOP 1 91-93 RILEY STREET DARLINGHURST 2010" -> "91-93 RILEY STREET DARLINGHURST", where that is on `tail`. */
export function streetAddressOf(found: string, tail: string): string | undefined {
  const s = found.toUpperCase().replace(/\s+/g, ' ').trim().replace(/ \d{4}$/, '');
  if (!s.endsWith(` ${tail}`)) return undefined;
  const hn = s.slice(0, -tail.length).trim().split(' ').pop() ?? '';
  return /^\d+[A-Z]?(?:-\d+[A-Z]?)?$/.test(hn) ? `${hn} ${tail}` : undefined;
}


/**
 * Does this candidate's house number cover the requested street number?
 * The field itself may be a list — "134, 136, 136A, 138" — so any one part
 * covering the wanted number is a match.
 */
function covers(hn: string, want: string): boolean {
  if (hn.includes('/')) return false;             // unit at another number
  return hn.split(/[,\s]+/).filter(Boolean).some((part) => coversPart(part, want));
}

function coversPart(hn: string, want: string): boolean {
  if (hn === want) return true;
  if (hn.replace(/[A-Z]$/, '') === want) return true;  // 212A covers 212
  const range = hn.match(/^(\d+)[A-Z]?-(\d+)[A-Z]?$/);
  if (range) {
    const n = parseInt(want), a = parseInt(range[1]), b = parseInt(range[2]);
    if (n < Math.min(a, b) || n > Math.max(a, b)) return false;
    // ranges are parity-sided (odd/even street sides): 211-215 must not cover 212
    if (a % 2 === b % 2 && n % 2 !== a % 2) return false;
    return true;
  }
  return false;
}

export async function geocode(input: string, log: (m: string) => void = () => {}): Promise<GeocodeResult> {
  const { numbers, street, locality } = parseAddress(input);
  const tail = locality ? `${street} ${locality}` : street;
  const found = new Map<string, Candidate>();

  // Which requested numbers are accounted for? A multi-lot site is only drawn
  // correctly if every lot is found: "134, 136, 136A, 138" matches 136/136A/138
  // exactly while 134 is registered as "134-134A", so stopping at the first
  // hit would silently drop a lot from the boundary.
  const wanted = numbers.filter((x) => !x.includes('-'));
  const outstanding = () =>
    wanted.filter((n) => ![...found.values()].some((c) => covers(c.housenumber, n)));

  // What the register did not answer, kept apart from what it answered with
  // nothing: a number it was never asked about is not a number it lacks.
  const unanswered = new Set<string>();
  const reasons: string[] = [];
  const failed = (what: string, e: any) => {
    unanswered.add(what);
    if (reasons.length < 3) reasons.push(e?.message ?? String(e));
  };

  // Stage A: exact matches (fast path, covers most single addresses). A few at
  // a time: a long range is many numbers, each its own indexed lookup.
  let exactAnswered = 0;
  await inTurn(numbers, 6, async (n) => {
    try {
      for (const c of await fetchCandidates(`address = '${sql(`${n} ${tail}`)}'`, 5, EXACT)) found.set(c.address, c);
      exactAnswered++;
    } catch (e) { failed(n, e); }
  });
  if (!exactAnswered) throw registerTimeout(input, reasons, log);

  // Stage B: the rest of the street round what is found. "91-107 Riley St"
  // is filed as 91-93, 95-97 and 99-107: once one of them is found, the others
  // are a few doors along, and one query inside a block finds them all where a
  // prefix lookup a number would each scan the register. Each address found is
  // looked round once.
  const lookedRound = new Set<string>();
  const near = async (around: Candidate[], signal?: AbortSignal) => {
    const fresh = around.filter((c) => !lookedRound.has(c.address));
    if (!fresh.length || !outstanding().length) return;
    for (const c of fresh) lookedRound.add(c.address);
    try {
      const pool = candidatesOf(await queryByExtent(ADDRESS_POINT, aroundExtent(fresh, NEAR_M), 'address,housenumber',
        `address LIKE '%${sql(tail)}' AND housenumber NOT LIKE '%/%'`, {}, { ...NEAR, signal }));
      const open = outstanding();
      for (const c of pool) if (open.some((n) => covers(c.housenumber, n))) found.set(c.address, c);
    } catch { /* a shortcut only: the prefix lookups below still ask for what is left */ }
  };
  await near([...found.values()]);

  // Stage C: when none of what is left is an address of its own ("91-107
  // Riley St": not one of 91, 93 … 107 is), the Planning Portal's search for
  // a few of the numbers names the properties there, each then found exactly
  // and looked round as above. The register is not asked to scan for them.
  if (outstanding().length) {
    const named = new Set<string>();
    await Promise.all(outstanding().slice(0, 3).map(async (n) => {
      try { for (const a of await portalSearch(n, tail)) named.add(a); }
      catch { /* a shortcut only, as the block is */ }
    }));
    const anchors: Candidate[] = [];
    await inTurn([...named].filter((a) => !found.has(a)).slice(0, 6), 6, async (a) => {
      try { anchors.push(...await fetchCandidates(`address = '${sql(a)}'`, 5, EXACT)); }
      catch { /* as above */ }
    });
    const open = outstanding();
    for (const c of anchors) if (open.some((n) => covers(c.housenumber, n))) found.set(c.address, c);
    await near(anchors);
  }

  // Stage D: ranged parents and suffixed numbers whose address starts with the
  // wanted number ("134-134A", "212A"), for what is still not found. Anchored
  // on the number so the address index can apply. One query per number rather
  // than a single OR: an OR of two prefixes makes the optimizer abandon the
  // index (0.7s -> 49s measured). Raced a few at a time, since some prefixes
  // answer in a second and others in a minute and a half: the first to find
  // one of the site's addresses has the rest found round it (stage B), and
  // the lookups still in flight are then called off.
  if (outstanding().length) {
    await prefixLookups(
      outstanding().slice(0, 8).flatMap((n) => anchorsOf(n).map((anchor) => ({ n, anchor }))),
      async ({ n, anchor }, signal) => {
        const pool = await fetchCandidates(
          `address LIKE '${sql(anchor)}' AND address LIKE '%${sql(tail)}'` +
          ` AND housenumber NOT LIKE '%/%'`, 60, { ...PREFIX, signal });
        const hits = pool.filter((c) => covers(c.housenumber, n));
        for (const c of hits) found.set(c.address, c);
        await near(hits, signal);
      },
      () => !outstanding().length,
      (n) => outstanding().includes(n),
      failed,
    );
  }

  // Stage E (slow, unindexed): a number *inside* a range starts with a
  // different number — 214 lives in "212-218" — so the prefix above cannot
  // find it. The Portal's search (stage C) usually has by now; a full scan is
  // the last resort, when nothing at all was found, and only when the register
  // answered the lookups above: if those went unanswered, this one would too.
  if (!found.size && !unanswered.size) {
    try {
      const pool = await fetchCandidates(
        `address LIKE '%${sql(tail)}' AND housenumber NOT LIKE '%/%'`, 800, SCAN);
      for (const n of wanted) {
        for (const c of pool) if (covers(c.housenumber, n)) found.set(c.address, c);
      }
    } catch (e) { failed('street', e); }
  }

  // Stage F: drop the locality (the official suburb may differ from the one
  // the user typed) — but only accept candidates that still mention it.
  if (!found.size && locality && !unanswered.size) {
    const matching: Candidate[] = [];
    await prefixLookups(
      wanted.slice(0, 8).flatMap((n) => anchorsOf(n).map((anchor) => ({ n, anchor }))),
      async ({ n, anchor }, signal) => {
        const pool = await fetchCandidates(
          `address LIKE '${sql(anchor)}' AND address LIKE '%${sql(street)}%'` +
          ` AND housenumber NOT LIKE '%/%'`, 60, { ...PREFIX, signal });
        for (const c of pool) if (covers(c.housenumber, n)) matching.push(c);
      },
      () => false,
      () => true,
      failed,
    );
    const preferred = matching.filter((c) => c.address.includes(locality));
    for (const c of preferred) found.set(c.address, c);

    // Never silently substitute a different suburb. "1 George St, Sydney" has
    // matches in Glendale, Goulburn and Canley Heights; drawing one of those
    // as the site would be a wrong sheet rather than a visible failure.
    if (!found.size && matching.length) {
      const elsewhere = [...new Set(matching.map((c) => c.address))].slice(0, 5);
      throw new Error(
        `Address not found in ${locality}: "${input}". ` +
        `Same street number elsewhere in NSW: ${elsewhere.join('; ')}.`);
    }
  }

  if (!found.size) {
    // "Not found" would send the user off to retype an address that is fine.
    if (unanswered.size) throw registerTimeout(input, reasons, log);
    // Offer real alternatives on the same street rather than a bare failure.
    let hint = '';
    try {
      const fc = await queryWhere(ADDRESS_POINT,
        `address LIKE '%${sql(street)}%' AND housenumber NOT LIKE '%/%'`, 'address', 400, HINT);
      const nearby = [...new Set(fc.features.map((f) => f.properties.address as string))]
        .filter(Boolean)
        .filter((a) => !locality || a.includes(locality))
        .sort((a, b) => {
          const na = parseInt(a), nb = parseInt(b), want = parseInt(numbers[0]);
          return Math.abs(na - want) - Math.abs(nb - want);
        })
        .slice(0, 4);
      if (nearby.length) hint = ` Nearby on this street: ${nearby.join('; ')}.`;
    } catch { /* hint is best-effort */ }
    throw new Error(`Address not found: "${input}".${hint}`);
  }

  // Found, but not all of it: a number the register never answered for may be
  // a lot missing from the site, and the sheet should say so.
  const missing = outstanding().filter((n) => unanswered.has(n));
  if (missing.length) {
    log(`  WARN the NSW address register did not answer for no. ${missing.join(', ')} (${reasons[0] ?? 'no reason given'}): ` +
      'if those are part of the site, their lots are missing from it. Try again, or name each address.');
  }

  const points = [...found.values()].map((c) => lonLatToMercator({ lon: c.lon, lat: c.lat }));
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
  return {
    points,
    center,
    matchedAddresses: [...found.keys()],
    query: input,
  };
}

/** The Web Mercator box round some addresses, `m` metres clear of them each way. */
function aroundExtent(around: Candidate[], m: number): Extent {
  const pts = around.map((c) => lonLatToMercator({ lon: c.lon, lat: c.lat }));
  const r = m * mercatorScaleFactor(around[0].lat);
  return {
    xmin: Math.min(...pts.map((p) => p.x)) - r, ymin: Math.min(...pts.map((p) => p.y)) - r,
    xmax: Math.max(...pts.map((p) => p.x)) + r, ymax: Math.max(...pts.map((p) => p.y)) + r,
  };
}

/** The register, not the address, is why nothing was found: said so, with what to do. */
function registerTimeout(input: string, reasons: string[], log: (m: string) => void): Error {
  log(`  the NSW address register did not answer: ${reasons.join('; ') || 'no reason given'}`);
  return new Error(
    `The NSW address register did not answer in time for "${input}". ` +
    'Try again in a few minutes, or pick the address from the suggestions as you type.');
}

/**
 * The site's address as a sheet names it. One address is itself. Several on
 * one street, an amalgamation, are their numbers in street order before the
 * street they share ("91-93, 95-97, 99-107, 109 RILEY STREET DARLINGHURST"),
 * not whichever the register returned first; on different streets, each in
 * full. Undefined when nothing matched.
 */
export function siteAddressOf(matched: string[]): string | undefined {
  const all = [...new Set(matched.filter(Boolean))];
  if (all.length <= 1) return all[0];
  const split = (a: string) => {
    const tokens = a.split(' ');
    // The register writes a list with commas ("134, 136, 136A, 138 …"), so a
    // number is the last of its list where no comma follows: "7 7 HILLS ROAD"
    // is number 7 of 7 Hills Road, not numbers 7 and 7.
    let i = 0;
    while (i < tokens.length - 1 && /^\d+[A-Z]?(?:-\d+[A-Z]?)?,$/.test(tokens[i])) i++;
    if (i < tokens.length - 1 && /^\d+[A-Z]?(?:-\d+[A-Z]?)?$/.test(tokens[i])) i++;
    return { numbers: tokens.slice(0, i).map((t) => t.replace(/,$/, '')), rest: tokens.slice(i).join(' ') };
  };
  const parts = all.map(split);
  const first = (p: { numbers: string[] }) => parseInt(p.numbers[0] ?? '') || 0;
  parts.sort((a, b) => first(a) - first(b) || a.numbers.join().localeCompare(b.numbers.join()));
  if (parts.every((p) => p.numbers.length && p.rest === parts[0].rest))
    return `${[...new Set(parts.flatMap((p) => p.numbers))].join(', ')} ${parts[0].rest}`;
  return all.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).join('; ');
}

/**
 * Type-ahead suggestions from the NSW address register. Accepts partial input
 * ("26 campsie st") and returns official address strings for a picker.
 */
export async function suggestAddresses(q: string, limit = 8): Promise<string[]> {
  const raw = q.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (raw.length < 4) return [];
  const cleaned = raw.replace(/\b(NSW|AUSTRALIA)\b/g, '').replace(/\b\d{4}\b/g, '')
    .replace(/^(UNIT|SHOP|SUITE|LEVEL|APT)\s+\w+[,/]?\s+/, '').replace(/^\w+\//, '')
    .replace(/\s+/g, ' ').trim();
  const { nums, rest } = splitNumbers(cleaned);
  if (!nums.length || !rest) return [];
  const num = nums[0];
  // A typed range is only sometimes how the register stores the site. "212
  // Bondi" finds "212-218 BONDI ROAD BONDI" because that range is one record,
  // but 26-30 Campsie Street is filed as 26, 28 and 30 separately, so a
  // "26-30%" prefix matches nothing. Search the leading number too, and judge
  // coverage against it — that is the number the caller actually asked about.
  const first = num.match(/^(\d+)/)?.[1] ?? num;

  // Expand abbreviated street types wherever they appear, then split the
  // street from any typed locality at the last street-type word.
  const words = rest.split(' ').map((w) => STREET_TYPES[w.toLowerCase()] ?? w);
  let typeIdx = -1;
  for (let i = 0; i < words.length; i++) if (TYPE_WORDS.has(words[i])) typeIdx = i;
  const street = (typeIdx >= 0 ? words.slice(0, typeIdx + 1) : words).join(' ');
  const locality = typeIdx >= 0 ? words.slice(typeIdx + 1).join(' ') : '';

  const out = new Map<string, string>();
  const add = (a: string) => { if (a && !out.has(a)) out.set(a, a); };

  // One query, and its shape matters. Anchoring on the number puts this on the
  // layer's address index and narrows to a handful of rows before the street
  // wildcard is applied: ~0.7s. Two forms that look equivalent are not —
  // measured against this layer:
  //   address LIKE '134%' AND address LIKE '%SHOWGROUND%'   0.7s   <- this
  //   (address LIKE 'A%' OR address LIKE 'B%') AND …         49s   OR kills it
  //   address LIKE '%SHOWGROUND ROAD%'                       31s   unindexed
  // The number prefix also catches "134-134A" and "134A", so the ranged and
  // suffixed parents come back without a second pass.
  // A bare "<num>%" is only selective for longer numbers: '1%' matches 1, 10,
  // 100, 1000… — a third of the register, and it measured 84s. Anchor short
  // numbers with the delimiter that must follow them instead.
  const prefixes = (n: string) => n.length >= 3
    ? [`${n}%`]                         // 134% also catches 134A and 134-134A
    : [`${n} %`, `${n}-%`];             // 1 GEORGE…, 1-3 GEORGE…
  const anchors = [...new Set(num === first ? prefixes(num) : [`${num}%`, ...prefixes(first)])];

  // In parallel: these are separate round trips to a service that takes about
  // a second each, and run in sequence a two-anchor lookup was costing seven.
  await Promise.all(anchors.map(async (anchor) => {
    try {
      const fc = await queryWhere(ADDRESS_POINT,
        `address LIKE '${sql(anchor)}' AND address LIKE '%${sql(street)}%'` +
        ` AND housenumber NOT LIKE '%/%'`,
        'address,housenumber', 60);
      for (const f of fc.features) {
        if (covers(String(f.properties.housenumber ?? ''), first)) {
          add(f.properties.address as string);
        }
      }
    } catch { /* best effort */ }
  }));

  // Rank. The street wildcard is unanchored, so it also matches the suburb —
  // "212 bondi" returns 212 Birrell Street BONDI JUNCTION alongside 212 Bondi
  // Road. Both are worth offering, but the one whose street is what was typed
  // goes first: drop the leading number and see if the rest starts with it.
  const streetOf = (a: string) => a.replace(/^\S+\s+/, '');
  // The locality has to match at the end, where the suburb is: "26 Campsie
  // Street Wilton" contains "CAMPSIE" in its street name and would otherwise
  // outrank the Campsie address the typing was heading for.
  const score = (a: string) =>
    (streetOf(a).startsWith(street) ? 0 : 2) + (locality && a.endsWith(locality) ? 0 : 1);
  return [...out.keys()]
    .sort((a, b) => score(a) - score(b) || a.length - b.length || a.localeCompare(b))
    .slice(0, limit);
}

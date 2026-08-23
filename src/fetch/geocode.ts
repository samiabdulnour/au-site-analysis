// Address string -> point(s) via NSW Spatial Geocoded Addressing Theme.
//
// NSW addressing quirks this handles:
//  - ranged parents: "212 Bondi Rd" is stored only as "212-218 BONDI ROAD"
//  - unit noise: "212/115 BONDI ROAD" is unit 212 at no. 115 — must NOT match
//  - suffixed numbers: 212A; unit inputs: "5/212 Bondi Rd" -> parent 212
//  - locality mismatches: user's suburb vs the official locality

import { queryWhere, type GeoJSONFC } from '../lib/arcgis.js';
import { lonLatToMercator, type XY } from '../lib/geo.js';

const ADDRESS_POINT =
  'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1';

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

async function fetchCandidates(where: string, cap = 200): Promise<Candidate[]> {
  const fc: GeoJSONFC = await queryWhere(ADDRESS_POINT, where, 'address,housenumber', cap);
  return fc.features
    .filter((f) => f.geometry)
    .map((f) => ({
      address: f.properties.address as string,
      housenumber: String(f.properties.housenumber ?? ''),
      lon: f.geometry!.coordinates[0],
      lat: f.geometry!.coordinates[1],
    }));
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

export async function geocode(input: string): Promise<GeocodeResult> {
  const { numbers, street, locality } = parseAddress(input);
  const tail = locality ? `${street} ${locality}` : street;
  const found = new Map<string, Candidate>();

  // Stage A: exact matches (fast path, covers most single addresses)
  for (const n of numbers) {
    for (const c of await fetchCandidates(`address = '${sql(`${n} ${tail}`)}'`, 5))
      found.set(c.address, c);
  }

  // Which requested numbers does stage A actually account for? A multi-lot
  // site is only drawn correctly if every lot is found: "134, 136, 136A, 138"
  // matches 136/136A/138 exactly while 134 is registered as "134-134A", so
  // stopping at the first hit would silently drop a lot from the boundary.
  const wanted = numbers.filter((x) => !x.includes('-'));
  const outstanding = () =>
    wanted.filter((n) => ![...found.values()].some((c) => covers(c.housenumber, n)));

  // Stage B: ranged parents and suffixed numbers whose address starts with the
  // wanted number ("134-134A", "212A"). Anchored on the number so the address
  // index applies — the unanchored form below costs ~31s against this layer.
  // One query per outstanding number rather than a single OR: an OR of two
  // prefixes makes the optimizer abandon the index (0.7s -> 49s measured).
  for (const n of outstanding().slice(0, 8)) {
    // Same selectivity rule as the type-ahead: a short bare prefix is not one.
    for (const anchor of n.length >= 3 ? [`${n}%`] : [`${n} %`, `${n}-%`]) {
      const pool = await fetchCandidates(
        `address LIKE '${sql(anchor)}' AND address LIKE '%${sql(tail)}'` +
        ` AND housenumber NOT LIKE '%/%'`, 60);
      for (const c of pool) if (covers(c.housenumber, n)) found.set(c.address, c);
    }
  }

  // Stage B2 (slow, unindexed): a number *inside* a range starts with a
  // different number — 214 lives in "212-218" — so the prefix above cannot
  // find it. Only worth a full scan when nothing at all was found.
  if (!found.size) {
    const pool = await fetchCandidates(
      `address LIKE '%${sql(tail)}' AND housenumber NOT LIKE '%/%'`, 800);
    for (const n of wanted) {
      for (const c of pool) if (covers(c.housenumber, n)) found.set(c.address, c);
    }
  }

  // Stage C: drop the locality (the official suburb may differ from the one
  // the user typed) — but only accept candidates that still mention it.
  if (!found.size && locality) {
    const matching: Candidate[] = [];
    for (const n of wanted.slice(0, 8)) {
      for (const anchor of n.length >= 3 ? [`${n}%`] : [`${n} %`, `${n}-%`]) {
        const pool = await fetchCandidates(
          `address LIKE '${sql(anchor)}' AND address LIKE '%${sql(street)}%'` +
          ` AND housenumber NOT LIKE '%/%'`, 60);
        for (const c of pool) if (covers(c.housenumber, n)) matching.push(c);
      }
    }
    const preferred = matching.filter((c) => c.address.includes(locality));
    for (const c of preferred) found.set(c.address, c);

    // Never silently substitute a different suburb. "1 George St, Sydney" has
    // matches in Glendale, Goulburn and Canley Heights; drawing one of those
    // as the site would be a wrong sheet rather than a visible failure.
    if (!found.size && matching.length) {
      const near = [...new Set(matching.map((c) => c.address))].slice(0, 5);
      throw new Error(
        `Address not found in ${locality}: "${input}". ` +
        `Same street number elsewhere in NSW: ${near.join('; ')}.`);
    }
  }

  if (!found.size) {
    // Offer real alternatives on the same street rather than a bare failure.
    let hint = '';
    try {
      const fc = await queryWhere(ADDRESS_POINT,
        `address LIKE '%${sql(street)}%' AND housenumber NOT LIKE '%/%'`, 'address', 400);
      const near = [...new Set(fc.features.map((f) => f.properties.address as string))]
        .filter(Boolean)
        .filter((a) => !locality || a.includes(locality))
        .sort((a, b) => {
          const na = parseInt(a), nb = parseInt(b), want = parseInt(numbers[0]);
          return Math.abs(na - want) - Math.abs(nb - want);
        })
        .slice(0, 4);
      if (near.length) hint = ` Nearby on this street: ${near.join('; ')}.`;
    } catch { /* hint is best-effort */ }
    throw new Error(`Address not found: "${input}".${hint}`);
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

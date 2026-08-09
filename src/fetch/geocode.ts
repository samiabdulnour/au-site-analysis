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
  const m = s.match(/^(\d+[A-Z]?)(?:\s*-\s*(\d+[A-Z]?))?\s+(.*)$/);
  if (!m) throw new Error(`Cannot parse address: "${input}" — use e.g. "212 Bondi Rd, Bondi NSW"`);
  const [, from, to, rest] = m;
  const words = rest.split(' ').map((w) => STREET_TYPES[w.toLowerCase()] ?? w);
  // split street / locality at the LAST street-type word
  let typeIdx = -1;
  for (let i = 0; i < words.length; i++) if (TYPE_WORDS.has(words[i])) typeIdx = i;
  const street = (typeIdx >= 0 ? words.slice(0, typeIdx + 1) : words).join(' ');
  const locality = typeIdx >= 0 ? words.slice(typeIdx + 1).join(' ') : '';
  const numbers: string[] = [];
  if (to) {
    const a = parseInt(from), b = parseInt(to);
    const step = (b - a) % 2 === 0 ? 2 : 1;
    for (let n = a; n <= b; n += step) numbers.push(String(n));
    numbers.push(`${from}-${to}`);
  } else {
    numbers.push(from);
  }
  return { numbers, street, locality };
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

/** Does this candidate's house number cover the requested street number? */
function covers(hn: string, want: string): boolean {
  if (hn.includes('/')) return false;             // unit at another number
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

  // Stage B: ranged parents and suffixed numbers on the same street+locality
  if (!found.size) {
    const pool = await fetchCandidates(
      `address LIKE '%${sql(tail)}' AND housenumber NOT LIKE '%/%'`, 800);
    for (const n of numbers.filter((x) => !x.includes('-'))) {
      for (const c of pool) if (covers(c.housenumber, n)) found.set(c.address, c);
    }
  }

  // Stage C: drop the locality (official suburb may differ) — prefer
  // candidates whose address still mentions the user's locality.
  if (!found.size && locality) {
    const pool = await fetchCandidates(
      `address LIKE '%${sql(street)}%' AND housenumber NOT LIKE '%/%'`, 800);
    const matching: Candidate[] = [];
    for (const n of numbers.filter((x) => !x.includes('-'))) {
      for (const c of pool) if (covers(c.housenumber, n)) matching.push(c);
    }
    const preferred = matching.filter((c) => c.address.includes(locality));
    for (const c of (preferred.length ? preferred : matching)) found.set(c.address, c);
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
  const m = cleaned.match(/^(\d+[A-Z]?)(?:\s*-\s*\d+[A-Z]?)?\s+(.*)$/);
  if (!m) return [];
  const [, num, rest] = m;

  // Expand abbreviated street types wherever they appear, then split the
  // street from any typed locality at the last street-type word.
  const words = rest.split(' ').map((w) => STREET_TYPES[w.toLowerCase()] ?? w);
  let typeIdx = -1;
  for (let i = 0; i < words.length; i++) if (TYPE_WORDS.has(words[i])) typeIdx = i;
  const street = (typeIdx >= 0 ? words.slice(0, typeIdx + 1) : words).join(' ');
  const locality = typeIdx >= 0 ? words.slice(typeIdx + 1).join(' ') : '';

  const out = new Map<string, string>();
  const add = (a: string) => { if (a && !out.has(a)) out.set(a, a); };

  // Pass 1: prefix match on "<number> <street>" (fast, covers most typing).
  try {
    const fc = await queryWhere(ADDRESS_POINT,
      `address LIKE '${sql(`${num} ${street}`)}%' AND housenumber NOT LIKE '%/%'`,
      'address', 60);
    for (const f of fc.features) add(f.properties.address as string);
  } catch { /* best effort */ }

  // Pass 2: street-wide search filtered by number coverage — finds ranged
  // parents ("212" inside "212-218") and localities the user did not type.
  if (out.size < 3) {
    try {
      const fc = await queryWhere(ADDRESS_POINT,
        `address LIKE '%${sql(street)}%' AND housenumber NOT LIKE '%/%'`,
        'address,housenumber', 600);
      for (const f of fc.features) {
        const hn = String(f.properties.housenumber ?? '');
        if (covers(hn, num)) add(f.properties.address as string);
      }
    } catch { /* best effort */ }
  }

  // Rank: typed locality first, then shortest/alphabetical.
  const all = [...out.keys()];
  const pref = locality ? all.filter((a) => a.includes(locality)) : [];
  const rest2 = all.filter((a) => !pref.includes(a));
  const rank = (arr: string[]) => arr.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return [...rank(pref), ...rank(rest2)].slice(0, limit);
}

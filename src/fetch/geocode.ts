// Address string -> point(s) via NSW Spatial Geocoded Addressing Theme.

import { queryWhere, type GeoJSONFC } from '../lib/arcgis.js';
import { lonLatToMercator, type XY } from '../lib/geo.js';

const ADDRESS_POINT =
  'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1';

const STREET_TYPES: Record<string, string> = {
  st: 'STREET', rd: 'ROAD', ave: 'AVENUE', av: 'AVENUE', hwy: 'HIGHWAY',
  pde: 'PARADE', dr: 'DRIVE', ln: 'LANE', pl: 'PLACE', cres: 'CRESCENT',
  cr: 'CRESCENT', ct: 'COURT', bvd: 'BOULEVARD', blvd: 'BOULEVARD', tce: 'TERRACE',
};

export interface GeocodeResult {
  /** All matched address points (a ranged address like 26-30 yields several). */
  points: XY[];
  /** Centroid of the matched points, EPSG:3857. */
  center: XY;
  matchedAddresses: string[];
  query: string;
}

/** "26-30 Campsie St, Campsie NSW 2194" -> { numbers: ["26","28","30"], street: "CAMPSIE STREET", locality: "CAMPSIE" } */
export function parseAddress(input: string) {
  let s = input.toUpperCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(NSW|AUSTRALIA)\b/g, '').replace(/\b\d{4}\b/g, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+[A-Z]?)(?:\s*-\s*(\d+[A-Z]?))?\s+(.*)$/);
  if (!m) throw new Error(`Cannot parse address: "${input}"`);
  const [, from, to, rest] = m;
  const words = rest.split(' ').map((w) => STREET_TYPES[w.toLowerCase()] ?? w);
  const numbers: string[] = [];
  if (to) {
    const a = parseInt(from), b = parseInt(to);
    const step = (b - a) % 2 === 0 ? 2 : 1;
    for (let n = a; n <= b; n += step) numbers.push(String(n));
    numbers.push(`${from}-${to}`); // ranged form may exist as its own address point
  } else {
    numbers.push(from);
  }
  return { numbers, rest: words.join(' ') };
}

export async function geocode(input: string): Promise<GeocodeResult> {
  const { numbers, rest } = parseAddress(input);
  const points: XY[] = [];
  const matched: string[] = [];
  for (const n of numbers) {
    const where = `address = '${n} ${rest.replace(/'/g, "''")}'`;
    const fc: GeoJSONFC = await queryWhere(ADDRESS_POINT, where, 'address,housenumber');
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      points.push(lonLatToMercator({ lon, lat }));
      matched.push(f.properties.address);
    }
  }
  if (!points.length) {
    // Fallback: LIKE search on street + first number
    const where = `address LIKE '${numbers[0]} ${rest.replace(/'/g, "''")}%'`;
    const fc = await queryWhere(ADDRESS_POINT, where, 'address,housenumber', 5);
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      points.push(lonLatToMercator({ lon, lat }));
      matched.push(f.properties.address);
    }
  }
  if (!points.length) throw new Error(`Address not found: "${input}"`);
  const center = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
  return { points, center, matchedAddresses: [...new Set(matched)], query: input };
}

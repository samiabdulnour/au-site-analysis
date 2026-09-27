// Trees with a size.
//
// OpenStreetMap knows where many street trees stand but almost never how big
// they are: across inner Sydney, 37 of 24,638 mapped trees carry a crown
// diameter. Councils that run a tree inventory know both, and a few publish it
// under an open licence. Those are listed here and take precedence; OSM fills
// in around them; and every tree comes out with a canopy figure, marked as
// measured, estimated from height or trunk, or nominal — so the sheet can draw
// each one at ground scale and say which is which.
//
// Adding a council is one entry in TREE_SOURCES: a public ArcGIS layer, the
// bbox it covers, and which of its fields carry height, canopy, trunk and
// species. Only inventories with an explicit open licence belong here — a
// public service with no licence statement (Parramatta's 34,000 existing
// trees, for one) is not the same as permission to redraw it on a DA sheet.

import { queryByExtent } from '../lib/arcgis.js';
import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox, lonLatToMercator, mercatorScaleFactor } from '../lib/geo.js';

export interface SiteTree {
  lon: number;
  lat: number;
  /** Canopy diameter to draw, metres. Always set. */
  canopyM: number;
  /** Where canopyM came from: recorded by the source, derived from height or
   *  trunk, or the nominal street-tree size. */
  canopySource: 'measured' | 'estimated' | 'nominal';
  heightM?: number;
  dbhCm?: number;
  /** Botanical name where recorded. */
  species?: string;
  common?: string;
  /** 'osm' or the id of the TREE_SOURCES entry. */
  source: string;
}

export interface TreeSource {
  id: string;
  name: string;
  /** Printed on the sheet's data line, so the licence's attribution is met. */
  attribution: string;
  /** ArcGIS feature layer URL (…/FeatureServer/0). Points only. */
  layer: string;
  /** lon/lat bbox the inventory covers; a site outside it is never queried. */
  extent: { west: number; south: number; east: number; north: number };
  fields: {
    height?: string;   // metres
    canopy?: string;   // canopy diameter / spread, metres
    dbh?: string;      // trunk diameter at breast height, cm
    species?: string;
    common?: string;
  };
  /** Leave a record out (a stump, a vacant planting site). */
  keep?: (attrs: Record<string, any>) => boolean;
}

export const TREE_SOURCES: TreeSource[] = [
  {
    id: 'cityofsydney',
    name: 'City of Sydney tree inventory',
    attribution: 'Trees © City of Sydney, CC BY 4.0',
    layer: 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Trees/FeatureServer/0',
    // The LGA: Rozelle Bay to Centennial Park, Millers Point to Rosebery.
    extent: { west: 151.17, south: -33.93, east: 151.24, north: -33.85 },
    fields: {
      height: 'TreeHeight',
      canopy: 'TreeCanopyNS',
      dbh: 'DBH_in_cm',
      species: 'SpeciesName',
      common: 'CommonName',
    },
    keep: (a) => (a.Tree_Status ?? 'Tree') === 'Tree',
  },
];

/** The nominal canopy of a street tree nobody has measured, metres. */
export const NOMINAL_CANOPY_M = 6;

/**
 * Canopy diameter from whatever is recorded. A measured spread wins; a height
 * gives a crown about 0.6× as wide (open-grown urban trees run 0.5–0.8); a
 * trunk gives about 0.2 m of crown per centimetre of DBH (a 40 cm trunk under
 * an 8 m crown). Anything else is the nominal size.
 */
export function resolveCanopy(rec: { canopyM?: number; heightM?: number; dbhCm?: number }):
  { canopyM: number; canopySource: SiteTree['canopySource'] } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (rec.canopyM && rec.canopyM > 0) return { canopyM: clamp(rec.canopyM, 1, 40), canopySource: 'measured' };
  if (rec.heightM && rec.heightM > 0) return { canopyM: clamp(rec.heightM * 0.6, 2, 25), canopySource: 'estimated' };
  if (rec.dbhCm && rec.dbhCm > 0) return { canopyM: clamp(rec.dbhCm * 0.2, 2, 25), canopySource: 'estimated' };
  return { canopyM: NOMINAL_CANOPY_M, canopySource: 'nominal' };
}

/** "8", "8 m", "8.5m", "800 cm" -> metres; anything unparseable -> undefined. */
export function parseMetres(v: unknown): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(m|cm|ft|')?$/);
  if (!m) return undefined;
  let n = parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  if (m[2] === 'cm') n /= 100;
  else if (m[2] === 'ft' || m[2] === "'") n *= 0.3048;
  return n > 0 ? n : undefined;
}

/** An OSM natural=tree node with its tags -> a SiteTree. */
export function treeFromOsm(lon: number, lat: number, t: Record<string, string>): SiteTree {
  const heightM = parseMetres(t.height) ?? parseMetres(t.est_height);
  // circumference is the trunk girth in metres; DBH is its diameter in cm
  const circ = parseMetres(t.circumference);
  const dbhCm = circ ? (circ / Math.PI) * 100 : undefined;
  const species = t.species ?? (t.genus ? t.genus : undefined);
  return {
    lon, lat,
    ...resolveCanopy({ canopyM: parseMetres(t.diameter_crown), heightM, dbhCm }),
    heightM, dbhCm,
    species,
    common: t['species:en'] ?? t['genus:en'],
    source: 'osm',
  };
}

function covers(src: TreeSource, b: { south: number; west: number; north: number; east: number }): boolean {
  const e = src.extent;
  return b.west <= e.east && b.east >= e.west && b.south <= e.north && b.north >= e.south;
}

/** The council inventories covering this extent, in registry order. */
export function sourcesFor(extent: Extent): TreeSource[] {
  const b = extentToLonLatBbox(extent);
  return TREE_SOURCES.filter((s) => covers(s, b));
}

/** Council-inventory trees in the extent, from every source that covers it. */
export async function fetchCouncilTrees(extent: Extent, log?: (m: string) => void): Promise<SiteTree[]> {
  const out: SiteTree[] = [];
  for (const src of sourcesFor(extent)) {
    const f = src.fields;
    const fields = [f.height, f.canopy, f.dbh, f.species, f.common].filter(Boolean).join(',') || '*';
    const fc = await queryByExtent(src.layer, extent, fields);
    let n = 0;
    for (const feat of fc.features) {
      if (feat.geometry?.type !== 'Point') continue;
      const a = feat.properties;
      if (src.keep && !src.keep(a)) continue;
      const num = (k?: string) => {
        if (!k) return undefined;
        const v = Number(a[k]);
        return Number.isFinite(v) && v > 0 ? v : undefined;
      };
      const heightM = num(f.height), dbhCm = num(f.dbh);
      out.push({
        lon: feat.geometry.coordinates[0],
        lat: feat.geometry.coordinates[1],
        ...resolveCanopy({ canopyM: num(f.canopy), heightM, dbhCm }),
        heightM, dbhCm,
        species: f.species && a[f.species] ? String(a[f.species]) : undefined,
        common: f.common && a[f.common] ? String(a[f.common]) : undefined,
        source: src.id,
      });
      n++;
    }
    log?.(`  ${src.name}: ${n} trees`);
  }
  return out;
}

/**
 * Council trees first; an OSM tree standing within `toleranceM` of one is the
 * same tree mapped twice and is dropped.
 */
export function mergeTrees(council: SiteTree[], osm: SiteTree[], toleranceM = 4): SiteTree[] {
  if (!council.length) return osm;
  const pts = council.map((t) => lonLatToMercator(t));
  const k = mercatorScaleFactor(council[0].lat);
  const tol = toleranceM * k;
  const kept = osm.filter((t) => {
    const p = lonLatToMercator(t);
    return !pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < tol);
  });
  return [...council, ...kept];
}

// Building footprints with heights for the deck's window. Overture Maps
// first — footprints for the whole state with a measured height on a
// quarter of them and storeys on half — read from its public bucket by
// DuckDB through a small Python script (the wheel is in the image;
// without it the script says so and we move on). OpenStreetMap through
// Overpass fills Overture's gaps and is the fallback when Overture gives
// nothing: around a Bondi Road site Overture had no height at all on any
// neighbour and no footprint on 27 numbered lots within 120 m, all of
// which OpenStreetMap carries. The merged answer is cached on the volume
// for a month, since all these sources move monthly.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassQuery } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { extentToLonLatBbox, lonLatToMercator, mercatorScaleFactor, ringCentroid, type Extent } from '../lib/geo.js';
import { pointInRing } from './planning.js';
import type { GeoJSONFC } from '../lib/arcgis.js';
import type { DaRecord } from './da.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'py', 'overture_buildings.py');
/** Storeys to metres when only the storey count is known. */
export const METRES_PER_STOREY = 3.1;

export interface Building {
  id: string;
  source: 'overture' | 'osm';
  /** Outer rings (and holes) in lon/lat. */
  rings: number[][][];
  heightM?: number;
  /** Storeys: the source's count, or a determined application's where the source has neither height nor storeys (`da`). */
  floors?: number;
  /** The height the deck draws: measured, or storeys × 3.1 m, or nothing. */
  estimatedHeightM?: number;
  heightFrom: 'measured' | 'floors' | 'da' | 'none';
  /** The application on the footprint's lot whose storeys stand in for a height, when one does (slide 07's feed). */
  da?: { pan: string; storeys: number; status: string; determined?: string; lodged?: string; address: string; types: string[] };
  name?: string;
  kind?: string;
  centroid: [number, number];
}

export interface BuildingsData {
  source: 'overture' | 'osm' | 'none';
  release?: string;
  buildings: Building[];
  fetchedAt: string;
  note?: string;
}

const run = (cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number | null }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, env: process.env }, (err, stdout) => {
      resolve({ stdout: String(stdout ?? ''), code: err ? ((err as any).code ?? 1) : 0 });
    });
  });

function finish(b: Omit<Building, 'estimatedHeightM' | 'heightFrom' | 'centroid'>): Building | null {
  if (!b.rings.length || b.rings[0].length < 4) return null;
  const heightFrom = b.heightM ? 'measured' : b.floors ? 'floors' : 'none';
  return {
    ...b, heightFrom,
    estimatedHeightM: b.heightM ?? (b.floors ? b.floors * METRES_PER_STOREY : undefined),
    centroid: ringCentroid(b.rings[0]),
  };
}

const geomRings = (g: any): number[][][] => {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
};

async function fromOverture(extent: Extent, log: (m: string) => void): Promise<BuildingsData | null> {
  const probe = await run('python3', ['-c', 'import duckdb'], 20_000);
  if (probe.code !== 0) { log('  buildings: duckdb is not installed, trying OpenStreetMap'); return null; }
  const bb = extentToLonLatBbox(extent);
  const started = Date.now();
  const res = await run('python3', [SCRIPT, String(bb.west), String(bb.south), String(bb.east), String(bb.north)], 15 * 60_000);
  let data: any;
  try { data = JSON.parse(res.stdout); } catch { throw new Error(`Overture script gave no JSON (exit ${res.code})`); }
  if (data.error) throw new Error(`Overture: ${data.error}`);
  const buildings: Building[] = [];
  for (const r of data.buildings ?? []) {
    const b = finish({
      id: String(r.id), source: 'overture', rings: geomRings(r.geometry),
      heightM: r.height > 0 ? Number(r.height) : undefined, floors: r.floors > 0 ? Number(r.floors) : undefined,
      name: r.name || undefined, kind: [r.subtype, r.class].filter(Boolean).join(' · ') || undefined,
    });
    if (b) buildings.push(b);
  }
  log(`  buildings: ${buildings.length} from Overture ${data.release} in ${Math.round((Date.now() - started) / 1000)} s`);
  return { source: 'overture', release: String(data.release), buildings, fetchedAt: new Date().toISOString() };
}

const num = (v: unknown): number | undefined => {
  const m = String(v ?? '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

async function fromOsm(extent: Extent, log: (m: string) => void): Promise<BuildingsData> {
  const bb = extentToLonLatBbox(extent);
  const box = `${bb.south},${bb.west},${bb.north},${bb.east}`;
  const data = await overpassQuery(`[out:json][timeout:90];(way["building"](${box});relation["building"]["type"="multipolygon"](${box}););out geom;`, { log });
  const buildings: Building[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const heightM = num(tags.height) ?? (num(tags['building:height']));
    const floors = num(tags['building:levels']);
    const name = tags.name || undefined;
    const kind = tags.building && tags.building !== 'yes' ? String(tags.building) : undefined;
    let rings: number[][][] = [];
    if (el.type === 'way' && Array.isArray(el.geometry)) rings = [el.geometry.map((g: any) => [g.lon, g.lat])];
    else if (el.type === 'relation') {
      for (const m of el.members ?? []) if (m.type === 'way' && m.role === 'outer' && Array.isArray(m.geometry)) rings.push(m.geometry.map((g: any) => [g.lon, g.lat]));
    }
    const b = finish({ id: `${el.type}/${el.id}`, source: 'osm', rings, heightM, floors, name, kind });
    if (b) buildings.push(b);
  }
  log(`  buildings: ${buildings.length} from OpenStreetMap`);
  return { source: 'osm', buildings, fetchedAt: new Date().toISOString() };
}

// ---- storeys from the development applications ------------------------------------
//
// Where a footprint has neither a height nor a storey count, the storeys of a
// determined application on its cadastral lot (the Online DA feed that slide
// 07 reads) stand in: what the council consented to, typed in by the
// applicant for the building as altered or as new, so a description of what
// stands or was approved to stand, not a survey. Against the North Sydney
// window's 31 footprints that carry both, the application's storeys are
// within one of the source's 84 % of the time. Only determined, unrefused
// applications count (a proposal under assessment belongs to slide 07, not
// to the built form), the latest determination on the lot speaks for it, and
// a footprint too small to be a building of the kind takes no more than three
// storeys from it, so a tower's consent does not stand on the shed beside it.

/** A footprint under this size (a garage, a kiosk) takes at most DA_SMALL_MAX_STOREYS from an application. */
export const DA_SMALL_FOOTPRINT_SQM = 60;
export const DA_SMALL_MAX_STOREYS = 3;

const bboxOf = (r: number[][]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};

/** Ground area of a lon/lat ring in square metres. */
export function ringAreaSqm(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const pts = ring.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  const k = mercatorScaleFactor(ringCentroid(ring)[1]);
  return Math.abs(a) / 2 / (k * k);
}

/** Whether an application's storeys may stand in for a height: determined and not refused, with a storey count and a location. */
export const daGivesStoreys = (r: DaRecord): boolean =>
  r.statusClass === 'determined' && !/refus/i.test(r.status) && (r.storeys ?? 0) >= 1 && r.lon !== undefined && r.lat !== undefined;

/**
 * The buildings with the storeys of a determined application on their lot
 * where the source gave neither a height nor a storey count; the rest as
 * they were. Pure: the cache holds the source's answer, this is applied on
 * the way out, once the applications are known.
 */
export function withDaStoreys(data: BuildingsData, lots: GeoJSONFC, applications: DaRecord[]): BuildingsData {
  const candidates = applications.filter(daGivesStoreys);
  if (!candidates.length || !data.buildings.some((b) => !b.estimatedHeightM)) return data;
  const lotRings = lots.features.flatMap((f) => geomRings(f.geometry)).filter((r) => r.length >= 4).map((r) => ({ r, bb: bboxOf(r) }));
  const lotOf = (x: number, y: number) => lotRings.findIndex(({ r, bb }) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && pointInRing(x, y, r));
  const byLot = new Map<number, DaRecord[]>();
  for (const r of candidates) {
    const i = lotOf(r.lon!, r.lat!);
    if (i >= 0) (byLot.get(i) ?? byLot.set(i, []).get(i)!).push(r);
  }
  if (!byLot.size) return data;
  // the latest determination on the lot speaks for it
  const when = (r: DaRecord) => r.determined ?? r.lodged ?? '';
  const buildings = data.buildings.map((b): Building => {
    if (b.estimatedHeightM) return b;
    const i = lotOf(b.centroid[0], b.centroid[1]);
    const rs = i >= 0 ? byLot.get(i) : undefined;
    if (!rs) return b;
    const r = [...rs].sort((p, q) => when(q).localeCompare(when(p)))[0];
    const storeys = Math.round(r.storeys!);
    if (storeys > DA_SMALL_MAX_STOREYS && ringAreaSqm(b.rings[0]) < DA_SMALL_FOOTPRINT_SQM) return b;
    return {
      ...b, floors: storeys, estimatedHeightM: storeys * METRES_PER_STOREY, heightFrom: 'da',
      da: { pan: r.pan, storeys, status: r.status, determined: r.determined, lodged: r.lodged, address: r.address, types: r.developmentTypes },
    };
  });
  return { ...data, buildings };
}

/**
 * The primary source's footprints, filled in from a supplement where the
 * primary is silent: a supplement building whose centroid stands inside no
 * primary footprint joins, and a primary footprint with no height at all
 * takes the height or storeys of a supplement building whose centroid it
 * holds. Nothing of the primary's own is replaced. Pure, so the filling is
 * tested without a network.
 */
export function mergeBuildings(primary: BuildingsData, supplement: BuildingsData): BuildingsData {
  if (!supplement.buildings.length || !primary.buildings.length) return primary.buildings.length ? primary : supplement;
  const prim = primary.buildings.map((b) => ({ b, bb: bboxOf(b.rings[0]) }));
  const hostOf = (x: number, y: number) =>
    prim.find(({ b, bb }) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && pointInRing(x, y, b.rings[0]))?.b;
  const added: Building[] = [];
  const donors = new Map<string, Building>();
  for (const sb of supplement.buildings) {
    const host = hostOf(sb.centroid[0], sb.centroid[1]);
    if (!host) { added.push(sb); continue; }
    if (!host.estimatedHeightM && sb.estimatedHeightM && !donors.has(host.id)) donors.set(host.id, sb);
  }
  if (!added.length && !donors.size) return primary;
  const buildings = primary.buildings
    .map((b): Building => {
      const d = donors.get(b.id);
      return d ? { ...b, heightM: d.heightM, floors: d.floors, estimatedHeightM: d.estimatedHeightM, heightFrom: d.heightFrom } : b;
    })
    .concat(added);
  const word = supplement.source === 'osm' ? 'OpenStreetMap' : supplement.source;
  return { ...primary, buildings, note: [primary.note, `${added.length} footprints and ${donors.size} heights from ${word}`].filter(Boolean).join('; ') };
}

/** Every building footprint touching the extent, with what is known of its height. */
export async function fetchBuildings(extent: Extent, log: (m: string) => void = () => {}): Promise<BuildingsData> {
  const key = ['xmin', 'ymin', 'xmax', 'ymax'].map((k) => Math.round(extent[k as keyof Extent])).join('_');
  let data: BuildingsData;
  try {
    // The kind is versioned: a cache written before the OpenStreetMap fill
    // would otherwise serve its gaps for a month.
    data = await cachedJson('buildings-v2', key, 30 * DAY_MS, async (): Promise<BuildingsData> => {
      let overture: BuildingsData | null = null;
      try {
        overture = await fromOverture(extent, log);
      } catch (e: any) {
        log(`  WARN Overture buildings failed: ${e?.message ?? e}; trying OpenStreetMap`);
      }
      if (!overture?.buildings.length) return await fromOsm(extent, log);
      // An Overpass outage costs only the fill, not the sheet.
      try {
        const merged = mergeBuildings(overture, await fromOsm(extent, log));
        if (merged.note) log(`  buildings: ${merged.note}`);
        return merged;
      } catch (e: any) {
        log(`  WARN OpenStreetMap supplement failed: ${e?.message ?? e}; Overture alone`);
        return overture;
      }
    });
  } catch (e: any) {
    // Neither source answered, and that is not cached: an outage is gone by
    // the next sheet, where a cached "none" drew every sheet of this window
    // without buildings for a month, and said nothing after the first.
    log(`  WARN OpenStreetMap buildings failed: ${e?.message ?? e}`);
    data = { source: 'none', buildings: [], fetchedAt: new Date().toISOString(), note: String(e?.message ?? e) };
  }
  // the centroid is recomputed on the way out, so a cache written before the centroid arithmetic was fixed still reads right
  return { ...data, buildings: data.buildings.map((b) => ({ ...b, centroid: ringCentroid(b.rings[0]) })) };
}

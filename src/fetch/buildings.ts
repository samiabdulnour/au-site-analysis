// Building footprints with heights for the deck's window. Overture Maps
// first — footprints for the whole state with a measured height on a
// quarter of them and storeys on half — read from its public bucket by
// DuckDB through a small Python script (the wheel is in the image;
// without it the script says so and we move on). OpenStreetMap through
// Overpass is the fallback: fewer heights, but the deployer's local
// Overpass always answers. Either answer is cached on the volume for a
// month, since both sources move monthly.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpassQuery } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { extentToLonLatBbox, type Extent } from '../lib/geo.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'py', 'overture_buildings.py');
/** Storeys to metres when only the storey count is known. */
export const METRES_PER_STOREY = 3.1;

export interface Building {
  id: string;
  source: 'overture' | 'osm';
  /** Outer rings (and holes) in lon/lat. */
  rings: number[][][];
  heightM?: number;
  floors?: number;
  /** The height the deck draws: measured, or storeys × 3.1 m, or nothing. */
  estimatedHeightM?: number;
  heightFrom: 'measured' | 'floors' | 'none';
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

function ringCentroid(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-14) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

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

/** Every building footprint touching the extent, with what is known of its height. */
export async function fetchBuildings(extent: Extent, log: (m: string) => void = () => {}): Promise<BuildingsData> {
  const key = ['xmin', 'ymin', 'xmax', 'ymax'].map((k) => Math.round(extent[k as keyof Extent])).join('_');
  return cachedJson('buildings', key, 30 * DAY_MS, async () => {
    try {
      const o = await fromOverture(extent, log);
      if (o && o.buildings.length) return o;
    } catch (e: any) {
      log(`  WARN Overture buildings failed: ${e?.message ?? e}; trying OpenStreetMap`);
    }
    try {
      return await fromOsm(extent, log);
    } catch (e: any) {
      log(`  WARN OpenStreetMap buildings failed: ${e?.message ?? e}`);
      return { source: 'none', buildings: [], fetchedAt: new Date().toISOString(), note: String(e?.message ?? e) };
    }
  });
}

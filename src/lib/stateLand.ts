// State government land: the NSW Government Property Index, read from a file
// that ships with the app.
//
// The Department of Planning published the index once, as it stood on
// 12 October 2022 (131,231 lots: 43,718 from the Government Property Register,
// 87,513 that lie on Crown land), and served it from the Planning Portal's map
// server (ePlanning/Planning_Portal_GPI, layer 302). That service was withdrawn
// in November 2026 and nothing took its place: no NSW agency serves who owns a
// lot, and the cadastre's own authority code does not tell a school or a
// hospital from a house. The index's open-data record still lists the one
// release, so the sheets read that release, packed here, and say its date.
//
// The file (scripts/pack_state_land.ts writes it):
//
//   bytes 0-3   "GPI1"
//   bytes 4-7   the gzipped header's length, uint32 little endian
//   then        the header, gzipped JSON (StateLandAbout and the list of blocks)
//   then        the blocks, one after another, each gzipped JSON:
//               [[lot reference, source, [ring, …]], …], a ring a flat list of
//               steps x, y, x, y … in millionths of a degree, each from the
//               point before it (the first from zero)
//
// A lot lies in the block of the grid cell its bounding box is centred in, on
// the coarsest grid level whose cells are no smaller than the box: cells of
// 0.05 degrees on level 0, twice that on each level up. So a lot reaches at
// most half a cell beyond its own, and a window reads the few cells it touches
// on each level, never the file.

import { closeSync, openSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { GeoJSONFC } from './arcgis.js';
import { mercatorToLonLat, type Extent } from './geo.js';

/** Where the index had a lot from: the Government Property Register, or its lying on Crown land. */
export const STATE_LAND_SOURCES = ['GPR_OPENDATA_LOT', 'CROWNLANDPOLY_LOT'] as const;
export type StateLandSource = typeof STATE_LAND_SOURCES[number];

/** One lot of the index: its reference as lot/section/plan ("1/-/DP1194390"), where the index had it from, its rings in lon/lat. */
export interface StateParcel { lotRef: string; source: StateLandSource; rings: number[][][] }

/** What the file says of itself. */
export interface StateLandAbout {
  title: string;
  /** The day the index stood as published, ISO. */
  snapshot: string;
  publisher: string;
  licence: string;
  /** Where the packed copy was read from, and the day. */
  from: string;
  retrieved: string;
  parcels: number;
  bySource: Record<StateLandSource, number>;
}

/** The index as shipped. */
export const STATE_LAND_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'state-land', 'nsw-government-property-index-2022-10-12.pack');

const MAGIC = 'GPI1';
/** Steps to a degree: a millionth of a degree is about 0.1 m on the ground. */
const PER_DEGREE = 1e6;
/** The finest grid's cell, in degrees: about 5 km. */
const CELL = 0.05;

interface Header extends StateLandAbout { perDegree: number; cell: number; /** level, column, row, bytes, parcels: in the order the blocks lie in the file. */ blocks: [number, number, number, number, number][] }
type Box = [number, number, number, number];
type Packed = [string, number, number[][]];

const boxOf = (rings: number[][][]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};

/** A ring on the file's grid of millionths of a degree, a point that repeats the one before it dropped. */
function snapped(ring: number[][]): number[][] {
  const out: number[][] = [];
  for (const [x, y] of ring) {
    const p = [Math.round(x * PER_DEGREE), Math.round(y * PER_DEGREE)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}

/**
 * The index as one file. A ring that closes on fewer than three corners once
 * snapped (a sliver under 0.1 m) is left out, and a lot left with no ring is
 * not written: `dropped` counts those.
 */
export function packStateLand(parcels: StateParcel[], about: Omit<StateLandAbout, 'parcels' | 'bySource'>): { file: Buffer; about: StateLandAbout; dropped: number } {
  const cells = new Map<string, { at: [number, number, number]; rows: Packed[] }>();
  const bySource = Object.fromEntries(STATE_LAND_SOURCES.map((s) => [s, 0])) as Record<StateLandSource, number>;
  let kept = 0, dropped = 0;
  for (const p of parcels) {
    const source = STATE_LAND_SOURCES.indexOf(p.source);
    if (source < 0) throw new Error(`a lot from ${p.source}, which the index does not name`);
    const rings = p.rings.map(snapped).filter((r) => r.length >= 4);
    if (!rings.length) { dropped++; continue; }
    const [x0, y0, x1, y1] = boxOf(rings);
    const level = Math.max(0, Math.ceil(Math.log2(Math.max(x1 - x0, y1 - y0, 1) / PER_DEGREE / CELL)));
    const cell = CELL * 2 ** level;
    const at: [number, number, number] = [level, Math.floor((x0 + x1) / 2 / PER_DEGREE / cell), Math.floor((y0 + y1) / 2 / PER_DEGREE / cell)];
    const key = at.join('/');
    if (!cells.has(key)) cells.set(key, { at, rows: [] });
    cells.get(key)!.rows.push([p.lotRef, source, rings.map((r) => { const steps: number[] = []; let px = 0, py = 0; for (const [x, y] of r) { steps.push(x - px, y - py); px = x; py = y; } return steps; })]);
    bySource[p.source]++; kept++;
  }
  const order = [...cells.values()].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]);
  const blocks = order.map((c) => gzipSync(Buffer.from(JSON.stringify(c.rows)), { level: 9 }));
  const full: StateLandAbout = { ...about, parcels: kept, bySource };
  const header: Header = { ...full, perDegree: PER_DEGREE, cell: CELL, blocks: order.map((c, i) => [...c.at, blocks[i].length, c.rows.length]) };
  const head = gzipSync(Buffer.from(JSON.stringify(header)), { level: 9 });
  const lead = Buffer.alloc(8);
  lead.write(MAGIC, 0, 'latin1');
  lead.writeUInt32LE(head.length, 4);
  return { file: Buffer.concat([lead, head, ...blocks]), about: full, dropped };
}

/** Does a polygon's ring set meet a box: a corner of one inside the other, or an edge crossing. */
function meets(rings: number[][][], [bx0, by0, bx1, by1]: Box): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x0, y0] = r[j], [x1, y1] = r[i];
      if (x1 >= bx0 && x1 <= bx1 && y1 >= by0 && y1 <= by1) return true;
      // the edge against the box, clipped side by side
      let t0 = 0, t1 = 1, out = false;
      const dx = x1 - x0, dy = y1 - y0;
      for (const [p, q] of [[-dx, x0 - bx0], [dx, bx1 - x0], [-dy, y0 - by0], [dy, by1 - y0]]) {
        if (p === 0) { if (q < 0) { out = true; break; } continue; }
        const t = q / p;
        if (p < 0) { if (t > t1) { out = true; break; } if (t > t0) t0 = t; } else { if (t < t0) { out = true; break; } if (t < t1) t1 = t; }
      }
      if (!out) return true;
      // the box's corner within the rings, counted even-odd
      if ((y0 > by0) !== (y1 > by0) && bx0 < x0 + ((by0 - y0) / dy) * dx) inside = !inside;
    }
  }
  return inside;
}

/** An open index: what it says of itself, and its lots in a lon/lat box. */
export interface StateLandIndex { about: StateLandAbout; parcelsIn(box: Box): StateParcel[]; close(): void }

export function openStateLand(file = STATE_LAND_FILE): StateLandIndex {
  let fd: number;
  try { fd = openSync(file, 'r'); } catch (e: any) { throw new Error(`the Government Property Index file cannot be opened (${file}): ${e?.code ?? e?.message ?? e}`); }
  const read = (at: number, bytes: number): Buffer => { const b = Buffer.alloc(bytes); if (readSync(fd, b, 0, bytes, at) !== bytes) throw new Error(`the Government Property Index file is cut short (${file})`); return b; };
  const lead = read(0, 8);
  if (lead.toString('latin1', 0, 4) !== MAGIC) { closeSync(fd); throw new Error(`not a Government Property Index file (${file})`); }
  const headBytes = lead.readUInt32LE(4);
  const { blocks, perDegree, cell: cell0, ...about }: Header = JSON.parse(gunzipSync(read(8, headBytes)).toString());
  const where = new Map<string, [number, number]>();
  const levels = new Set<number>();
  let at = 8 + headBytes;
  for (const [level, ix, iy, bytes] of blocks) { where.set(`${level}/${ix}/${iy}`, [at, bytes]); levels.add(level); at += bytes; }
  return {
    about,
    parcelsIn(box) {
      const out: StateParcel[] = [];
      for (const level of levels) {
        const cell = cell0 * 2 ** level;
        // a lot reaches half a cell past its own at most
        for (let ix = Math.floor((box[0] - cell / 2) / cell); ix <= Math.floor((box[2] + cell / 2) / cell); ix++) {
          for (let iy = Math.floor((box[1] - cell / 2) / cell); iy <= Math.floor((box[3] + cell / 2) / cell); iy++) {
            const hit = where.get(`${level}/${ix}/${iy}`);
            if (!hit) continue;
            for (const [lotRef, source, packed] of JSON.parse(gunzipSync(read(hit[0], hit[1])).toString()) as Packed[]) {
              const rings = packed.map((steps) => { const r: number[][] = []; let x = 0, y = 0; for (let i = 0; i < steps.length; i += 2) { x += steps[i]; y += steps[i + 1]; r.push([x / perDegree, y / perDegree]); } return r; });
              if (meets(rings, box)) out.push({ lotRef, source: STATE_LAND_SOURCES[source], rings });
            }
          }
        }
      }
      return out;
    },
    close() { closeSync(fd); },
  };
}

let shipped: StateLandIndex | undefined;
const theIndex = (): StateLandIndex => (shipped ??= openStateLand());

/** The index's lots that meet a window, the window in Web Mercator as the map layers take it. */
export function stateLandIn(extent: Extent): StateParcel[] {
  const sw = mercatorToLonLat({ x: extent.xmin, y: extent.ymin }), ne = mercatorToLonLat({ x: extent.xmax, y: extent.ymax });
  return theIndex().parcelsIn([sw.lon, sw.lat, ne.lon, ne.lat]);
}

/**
 * The same lots as the withdrawn layer answered a window with: features with
 * LOTREF, SOURCE and PLANLABEL, each a polygon of its rings in lon/lat.
 */
export function stateLandFeatures(extent: Extent): GeoJSONFC {
  return { type: 'FeatureCollection', features: stateLandIn(extent).map((p) => ({ type: 'Feature' as const, geometry: { type: 'Polygon', coordinates: p.rings }, properties: { LOTREF: p.lotRef, SOURCE: p.source, PLANLABEL: p.lotRef.split('/').slice(2).join('/') } })) };
}

/** What the shipped index says of itself: its date above all. */
export const stateLandAbout = (): StateLandAbout => theIndex().about;

/** The index's date as the sheets print it: "12 October 2022". */
export const STATE_LAND_AS_AT = '12 October 2022';

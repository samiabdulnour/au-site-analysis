// What the 3D meshes say stands on the ground: the heights of the footprints
// the open sources carry without one, and the footprints of the built lots
// they carry nothing on at all.
//
// The meshes (Google's Photorealistic 3D Tiles, fetch/tiles3d.ts) are a
// single surface draped over everything, read here from straight above as a
// grid of heights a metre apart (render/elevation3d.ts renderSurface), with a
// flag where the meshes' own picture is green (a tree, a lawn). A footprint's
// roof is the high side of the surface inside it, read where the picture is
// not green, since a tree over a roof is the tree; its ground is the low side
// of the surface round it, which is the street and the yards, leaving out
// what other footprints hold. Their difference is the building's height. On a
// lot with no footprint, every cell that rises three metres over the lot's
// ground and is not green is built; the patches those cells make are traced
// round their edges, the stair-steps of the grid smoothed to the wall lines,
// and each patch of a shed's size or more is a footprint with a height of its
// own. The streetscape reads the same meshes for its elevations; this is the
// same surface, seen from above, over the whole page.
//
// Everything here is arithmetic on the grid, with no network: the fetch and
// the render are in fetch/meshHeights.ts, and the tests draw their own grids.

import { pointInRing } from '../fetch/planning.js';
import { ringCentroid } from './geo.js';
import type { Building, BuildingsData } from '../fetch/buildings.js';

export type XY = [number, number];

/** The surface the meshes make, from above: a grid of heights in a local frame of metres. */
export interface HeightField {
  /** East and north of the centre of cell (0, 0), the south-west cell, metres in the frame; a cell's side in metres. */
  x0: number; y0: number; cell: number;
  cols: number; rows: number;
  /** Row-major from the south-west: the surface's height in the frame's metres; NaN where the meshes hold nothing. */
  z: Float32Array;
  /** Row-major as `z`: 1 where the meshes' own picture is green there, else 0. */
  green: Uint8Array;
}

/**
 * A frame of metres on the ground round a point, east and north, for the footprints (lon/lat) and the field
 * (metres) to meet in: a degree of longitude and of latitude in metres at the origin, which over a page is the
 * east-north-up frame the meshes are rendered in to the centimetre.
 */
export interface LocalFrame { lon0: number; lat0: number; mPerDegE: number; mPerDegN: number }

export function localFrame(origin: { lon: number; lat: number }): LocalFrame {
  const p = (origin.lat * Math.PI) / 180;
  return {
    lon0: origin.lon, lat0: origin.lat,
    mPerDegN: 111_132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    mPerDegE: 111_412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}
export const toXY = (f: LocalFrame, lon: number, lat: number): XY => [(lon - f.lon0) * f.mPerDegE, (lat - f.lat0) * f.mPerDegN];
export const toLonLat = (f: LocalFrame, x: number, y: number): [number, number] => [f.lon0 + x / f.mPerDegE, f.lat0 + y / f.mPerDegN];

/** The share of the cells inside a footprint the roof is read at: the ridge of a pitched roof stands higher, a parapet's gutter lower. */
const ROOF_PERCENTILE = 0.8;
/** The share of the cells round a footprint the ground is read at: the street and the yards are the low ones, a tree's crown or a neighbour's roof the high. */
const GROUND_PERCENTILE = 0.15;
/** How far round a footprint the ground is sought, metres. */
const GROUND_REACH_M = 8;
/** Under this the meshes show nothing standing: a slab, a fence, a coarse mesh's error. */
export const MIN_BUILDING_M = 2.5;
/** Over this is no building but a hole in the meshes or a tower in the wrong place. */
const MAX_BUILDING_M = 400;
/** What a cell on an empty lot must rise over the lot's ground to count as built, metres. */
export const BUILT_RISE_M = 3;
/** A patch of built cells under this is a shed, a tank or a lump of the mesh, not a building. */
export const MIN_FOOTPRINT_SQM = 25;
/** How far a traced outline may stray from the cells' stair-steps when they are smoothed to a wall line, metres. */
const SIMPLIFY_M = 0.9;

const percentile = (vals: number[], p: number): number => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

const bboxOf = (rings: XY[][]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};
const inRings = (x: number, y: number, rings: XY[][]) => pointInRing(x, y, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, y, h));

/** The cells whose centres lie in the rings (the first the outer ring, the rest holes), as indices into the field. */
export function cellsIn(f: HeightField, rings: XY[][]): number[] {
  if (!rings[0] || rings[0].length < 4) return [];
  const bb = bboxOf(rings);
  const c0 = Math.max(0, Math.floor((bb.x0 - f.x0) / f.cell)), c1 = Math.min(f.cols - 1, Math.ceil((bb.x1 - f.x0) / f.cell));
  const r0 = Math.max(0, Math.floor((bb.y0 - f.y0) / f.cell)), r1 = Math.min(f.rows - 1, Math.ceil((bb.y1 - f.y0) / f.cell));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inRings(f.x0 + c * f.cell, f.y0 + r * f.cell, rings)) out.push(r * f.cols + c);
  return out;
}

/** The cells within `reach` metres of the rings' box whose centres lie outside the rings. */
function cellsAround(f: HeightField, rings: XY[][], reach: number): number[] {
  const bb = bboxOf(rings);
  const c0 = Math.max(0, Math.floor((bb.x0 - reach - f.x0) / f.cell)), c1 = Math.min(f.cols - 1, Math.ceil((bb.x1 + reach - f.x0) / f.cell));
  const r0 = Math.max(0, Math.floor((bb.y0 - reach - f.y0) / f.cell)), r1 = Math.min(f.rows - 1, Math.ceil((bb.y1 + reach - f.y0) / f.cell));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!inRings(f.x0 + c * f.cell, f.y0 + r * f.cell, rings)) out.push(r * f.cols + c);
  return out;
}

/** A mask of the field with 1 on every cell some footprint holds. */
export function occupancy(f: HeightField, footprints: XY[][][]): Uint8Array {
  const m = new Uint8Array(f.cols * f.rows);
  for (const rings of footprints) for (const i of cellsIn(f, rings)) m[i] = 1;
  return m;
}

/**
 * A footprint's height from the surface: the roof the 80th percentile of the surface inside it (read where the
 * picture is not green, when enough of it is not), the ground the 15th percentile round it within 8 m, leaving
 * out the cells other footprints hold; null where the meshes hold too little of either, or nothing stands.
 */
export function footprintHeight(f: HeightField, rings: XY[][], occupied?: Uint8Array): { heightM: number; roofZ: number; groundZ: number } | null {
  const inside = cellsIn(f, rings).filter((i) => Number.isFinite(f.z[i]));
  if (inside.length < 4) return null;
  const bare = inside.filter((i) => !f.green[i]);
  const roofZ = percentile((bare.length >= Math.max(4, inside.length * 0.3) ? bare : inside).map((i) => f.z[i]), ROOF_PERCENTILE);
  const around = cellsAround(f, rings, GROUND_REACH_M).filter((i) => Number.isFinite(f.z[i]) && !occupied?.[i]);
  if (around.length < 8) return null;
  const groundZ = percentile(around.map((i) => f.z[i]), GROUND_PERCENTILE);
  const heightM = roofZ - groundZ;
  return heightM >= MIN_BUILDING_M && heightM <= MAX_BUILDING_M ? { heightM, roofZ, groundZ } : null;
}

/** The connected patches (four ways) of the cells set in `mask`, each as its cells' indices. */
function patches(f: HeightField, mask: Uint8Array): number[][] {
  const seen = new Uint8Array(mask.length);
  const out: number[][] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const c = i % f.cols, r = (i - c) / f.cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= f.cols || rr >= f.rows) continue;
        const j = rr * f.cols + cc;
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    out.push(cells);
  }
  return out;
}

/**
 * The outlines of a set of cells, traced round their edges with the cells on the left: the outer edges run
 * counter-clockwise, a hole's clockwise. Where the patch touches itself at a corner the trace turns right, so
 * the two parts become two outlines rather than one that crosses itself. Vertices at the cells' corners.
 */
export function traceOutlines(f: HeightField, cells: number[]): XY[][] {
  const set = new Set(cells);
  const has = (c: number, r: number) => c >= 0 && r >= 0 && c < f.cols && r < f.rows && set.has(r * f.cols + c);
  // a cell's corners: (c, r) is its south-west corner in corner coordinates, (c + 1, r + 1) its north-east
  const key = (x: number, y: number) => `${x},${y}`;
  const edges = new Map<string, [number, number, number, number][]>();   // from a corner: the edges leaving it (x0, y0, x1, y1)
  const put = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (edges.get(k) ?? edges.set(k, []).get(k)!).push([x0, y0, x1, y1]); };
  for (const i of cells) {
    const c = i % f.cols, r = (i - c) / f.cols;
    if (!has(c, r - 1)) put(c, r, c + 1, r);             // south edge, eastward
    if (!has(c + 1, r)) put(c + 1, r, c + 1, r + 1);     // east edge, northward
    if (!has(c, r + 1)) put(c + 1, r + 1, c, r + 1);     // north edge, westward
    if (!has(c - 1, r)) put(c, r + 1, c, r);             // west edge, southward
  }
  const loops: XY[][] = [];
  const corner = (x: number, y: number): XY => [f.x0 + (x - 0.5) * f.cell, f.y0 + (y - 0.5) * f.cell];
  for (const [, list] of edges) {
    while (list.length) {
      const first = list.shift()!;
      const loop: [number, number][] = [[first[0], first[1]], [first[2], first[3]]];
      let [dx, dy] = [first[2] - first[0], first[3] - first[1]];
      for (let guard = 0; guard < 1e6; guard++) {
        const [x, y] = loop[loop.length - 1];
        if (x === first[0] && y === first[1]) break;
        const next = edges.get(key(x, y));
        if (!next?.length) break;
        // the rightmost turn first: the tightest way round the cell the edge came along
        let pick = 0, best = Infinity;
        next.forEach((e, k) => { const cross = dx * (e[3] - e[1]) - dy * (e[2] - e[0]); if (cross < best) { best = cross; pick = k; } });
        const e = next.splice(pick, 1)[0];
        loop.push([e[2], e[3]]);
        dx = e[2] - e[0]; dy = e[3] - e[1];
      }
      if (loop.length >= 4) loops.push(loop.map(([x, y]) => corner(x, y)));
    }
  }
  return loops;
}

/** Twice the signed area of a closed ring: positive counter-clockwise. */
const area2 = (ring: XY[]) => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a; };

/** Douglas–Peucker on an open line. */
function simplifyLine(pts: XY[], tol: number): XY[] {
  if (pts.length <= 2) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let far = 0, at = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol || at < 0) return [a, b];
  return [...simplifyLine(pts.slice(0, at + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(at), tol)];
}

/** A closed ring smoothed to its wall lines: Douglas–Peucker from its first vertex, then again from halfway round, so no stair-step is kept for being the start. */
export function simplifyRing(ring: XY[], tol = SIMPLIFY_M): XY[] {
  let r = simplifyLine(ring, tol);
  if (r.length > 4) {
    const open = r.slice(0, -1), h = Math.floor(open.length / 2);
    const turned = [...open.slice(h), ...open.slice(0, h)];
    r = simplifyLine([...turned, turned[0]], tol);
  }
  return r;
}

export interface TracedFootprint { rings: XY[][]; heightM: number; areaSqm: number }

/**
 * The footprints on a lot the sources hold none for: every cell in the lot that rises BUILT_RISE_M over the lot's
 * ground (the low side of the surface over the lot and round it) and is not green in the meshes' picture is built;
 * each patch of them of MIN_FOOTPRINT_SQM or more is a footprint, its outline traced and smoothed, its height the
 * patch's roof over the ground.
 */
export function gapFootprints(f: HeightField, lotRings: XY[][], occupied?: Uint8Array): TracedFootprint[] {
  const inLot = cellsIn(f, lotRings).filter((i) => Number.isFinite(f.z[i]));
  const cellSqm = f.cell * f.cell;
  if (inLot.length * cellSqm < MIN_FOOTPRINT_SQM) return [];
  const around = [...inLot, ...cellsAround(f, lotRings, GROUND_REACH_M)].filter((i) => Number.isFinite(f.z[i]) && !occupied?.[i]);
  if (around.length < 8) return [];
  const groundZ = percentile(around.map((i) => f.z[i]), GROUND_PERCENTILE);
  const mask = new Uint8Array(f.cols * f.rows);
  for (const i of inLot) if (!occupied?.[i] && !f.green[i] && f.z[i] - groundZ >= BUILT_RISE_M) mask[i] = 1;
  const out: TracedFootprint[] = [];
  for (const cells of patches(f, mask)) {
    if (cells.length * cellSqm < MIN_FOOTPRINT_SQM) continue;
    const loops = traceOutlines(f, cells).map((l) => simplifyRing(l)).filter((l) => l.length >= 4);
    const outers = loops.filter((l) => area2(l) > 0 && area2(l) / 2 >= MIN_FOOTPRINT_SQM);
    const holes = loops.filter((l) => area2(l) < 0 && -area2(l) / 2 >= 4);
    const heightM = percentile(cells.map((i) => f.z[i]), ROOF_PERCENTILE) - groundZ;
    if (heightM < MIN_BUILDING_M || heightM > MAX_BUILDING_M) continue;
    for (const outer of outers) {
      const own = holes.filter((h) => pointInRing(h[0][0], h[0][1], outer));
      out.push({ rings: [outer, ...own], heightM, areaSqm: area2(outer) / 2 - own.reduce((a, h) => a - area2(h) / 2, 0) });
    }
  }
  return out;
}

/**
 * The buildings with what the meshes add: a height on every footprint that had none (or only a determined
 * application's storeys, which is a consent, not a measure), and a footprint on every built lot the sources
 * left empty. The source's measured heights and storey counts stand. `gapLots` are the lots with no footprint
 * (lib/gapLots.ts), in lon/lat like the footprints. Pure: the field is read, nothing is fetched.
 */
export function withMeshHeights(data: BuildingsData, field: HeightField, frame: LocalFrame, gapLots: number[][][][], meta: { meshes: number; errorM: number; credits: string[] }): BuildingsData {
  const xy = (rings: number[][][]): XY[][] => rings.map((r) => r.map(([lon, lat]) => toXY(frame, lon, lat)));
  const footprints = data.buildings.map((b) => xy(b.rings));
  const occupied = occupancy(field, footprints);
  let heights = 0;
  const buildings = data.buildings.map((b, i): Building => {
    if (b.heightFrom === 'measured' || b.heightFrom === 'floors') return b;
    const h = footprintHeight(field, footprints[i], occupied);
    if (!h) return b;
    heights++;
    const heightM = Math.round(h.heightM * 10) / 10;
    return { ...b, heightM, floors: undefined, estimatedHeightM: heightM, heightFrom: 'mesh', da: undefined };
  });
  const traced: Building[] = [];
  gapLots.forEach((lot, k) => {
    for (const t of gapFootprints(field, xy(lot), occupied)) {
      const rings = t.rings.map((r) => r.map(([x, y]) => toLonLat(frame, x, y)));
      const heightM = Math.round(t.heightM * 10) / 10;
      traced.push({ id: `mesh/${k}/${traced.length}`, source: 'mesh', rings, heightM, estimatedHeightM: heightM, heightFrom: 'mesh', centroid: ringCentroid(rings[0]) });
    }
  });
  if (!heights && !traced.length) return data;
  const mesh = { heights, footprints: traced.length, ...meta };
  const note = [data.note, `${heights} heights and ${traced.length} footprints from Google's 3D meshes`].filter(Boolean).join('; ');
  return { ...data, buildings: [...buildings, ...traced], note, mesh };
}

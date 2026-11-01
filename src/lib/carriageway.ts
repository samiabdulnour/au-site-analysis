// Carriageways as surfaces, for the massing's axonometric.
//
// The sheets draw a street as its centreline and its kerb lines; the
// axonometric wants the road itself, a surface the kerbs bound, with its
// junctions joined. Each street's centreline is swept out to its kerbs — as
// far as the kerb lines stand from it where the sheet has them (lib/kerbs.ts),
// a typical half-width for its class where it has none — and the sweeps are
// joined into one surface. Everything is planar, in local metres.

import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import type { XY } from './geo.js';

export interface RoadLine { coords: XY[]; hierarchy: number; name?: string }
export interface Carriageway {
  /** The surface: each polygon's rings, the first outer, the rest holes. */
  polygons: XY[][][];
  /** Each street's axis down the middle of its carriageway, for a centreline and the traffic on it. */
  axes: { road: RoadLine; axis: XY[]; left: number; right: number }[];
}

/** A street's typical half-width kerb to kerb by its class (NSW topographic hierarchy: 1 motorway … 6 local, 7–8 lanes); a path has none. */
export function typicalHalfWidthM(hierarchy: number): number {
  return hierarchy <= 2 ? 8 : hierarchy === 3 ? 7 : hierarchy === 4 ? 6 : hierarchy === 5 ? 5.5 : hierarchy === 6 ? 4.5 : hierarchy <= 8 ? 3 : 0;
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

/** The nearest point of a segment to p, and how far it is. */
function nearestOnSegment(p: XY, a: XY, b: XY): { q: XY; d: number } {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { q, d: Math.hypot(p.x - q.x, p.y - q.y) };
}

/**
 * How far a street's kerbs stand from its centreline, left and right of its
 * direction: the median over samples along it of the nearest kerb line within
 * reach on each side; the class's typical width where fewer than three
 * samples find one.
 */
export function kerbHalfWidths(road: RoadLine, kerbs: XY[][], reachM = 14): { left: number; right: number; measured: boolean } {
  const typical = typicalHalfWidthM(road.hierarchy);
  const lefts: number[] = [], rights: number[] = [];
  const c = road.coords;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    for (let s = 2.5; s < len; s += 5) {
      const p = { x: a.x + t.x * s, y: a.y + t.y * s };
      let bestL = Infinity, bestR = Infinity;
      for (const k of kerbs) for (let j = 1; j < k.length; j++) {
        // only a kerb running with the street: a crossing street's kerb is not this one's
        const kl = Math.hypot(k[j].x - k[j - 1].x, k[j].y - k[j - 1].y);
        if (!kl || Math.abs(((k[j].x - k[j - 1].x) * t.x + (k[j].y - k[j - 1].y) * t.y) / kl) < 0.85) continue;
        const { q, d } = nearestOnSegment(p, k[j - 1], k[j]);
        if (d > reachM) continue;
        const side = t.x * (q.y - p.y) - t.y * (q.x - p.x);   // > 0: to the left of the direction
        if (side > 0) bestL = Math.min(bestL, d); else bestR = Math.min(bestR, d);
      }
      if (bestL < Infinity) lefts.push(bestL);
      if (bestR < Infinity) rights.push(bestR);
    }
  }
  const clamp = (v: number) => Math.max(2.5, Math.min(12, v));
  const l = lefts.length >= 3 ? clamp(median(lefts)) : NaN, r = rights.length >= 3 ? clamp(median(rights)) : NaN;
  // one side measured: the other takes it, a street being about symmetrical about its centreline
  const left = Number.isFinite(l) ? l : Number.isFinite(r) ? r : typical;
  const right = Number.isFinite(r) ? r : Number.isFinite(l) ? l : typical;
  return { left, right, measured: Number.isFinite(l) || Number.isFinite(r) };
}

/** A sixteen-sided disc. */
const disc = (c: XY, r: number): XY[] => Array.from({ length: 16 }, (_, i) => ({ x: c.x + r * Math.cos((i / 16) * 2 * Math.PI), y: c.y + r * Math.sin((i / 16) * 2 * Math.PI) }));

/** A polyline's sweep: a quadrilateral a segment, a disc at each inner vertex to round the join, the whole shifted to its carriageway's middle where the kerbs stand unevenly. */
function sweep(line: XY[], left: number, right: number): XY[][] {
  const out: XY[][] = [];
  const shift = (left - right) / 2, half = (left + right) / 2;
  const normals: XY[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) { normals.push(normals[normals.length - 1] ?? { x: 0, y: 1 }); continue; }
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    normals.push(n);
    out.push([
      { x: a.x + n.x * left, y: a.y + n.y * left }, { x: b.x + n.x * left, y: b.y + n.y * left },
      { x: b.x - n.x * right, y: b.y - n.y * right }, { x: a.x - n.x * right, y: a.y - n.y * right },
    ]);
  }
  for (let i = 1; i < line.length - 1; i++) {
    const n0 = normals[i - 1], n1 = normals[i];
    const nx = n0.x + n1.x, ny = n0.y + n1.y, nl = Math.hypot(nx, ny) || 1;
    out.push(disc({ x: line[i].x + (nx / nl) * shift, y: line[i].y + (ny / nl) * shift }, half));
  }
  return out;
}

/** The streets' surfaces, kerb to kerb, joined; paths and tracks (hierarchy 9 and above) have none. */
export function carriageways(roads: RoadLine[], kerbs: XY[][]): Carriageway {
  const pieces: XY[][] = [];
  const axes: Carriageway['axes'] = [];
  for (const road of roads) {
    if (road.coords.length < 2 || typicalHalfWidthM(road.hierarchy) <= 0) continue;
    const { left, right } = kerbHalfWidths(road, kerbs);
    pieces.push(...sweep(road.coords, left, right));
    // the axis: the centreline shifted to the carriageway's middle
    const shift = (left - right) / 2;
    const axis = road.coords.map((p, i) => {
      const a = road.coords[Math.max(0, i - 1)], b = road.coords[Math.min(road.coords.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - ((b.y - a.y) / len) * shift, y: p.y + ((b.x - a.x) / len) * shift };
    });
    axes.push({ road, axis, left, right });
  }
  if (!pieces.length) return { polygons: [], axes };
  const close = (rg: XY[]) => [...rg, rg[0]].map((p) => [p.x, p.y]);
  let polygons: XY[][][] = [];
  try {
    const fc = featureCollection(pieces.map((rg) => polygon([close(rg)])));
    const joined = pieces.length === 1 ? fc.features[0] : (turfUnion(fc) as any);
    const g = joined?.geometry;
    const polys: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    polygons = polys.map((rings) => rings.map((rg) => rg.slice(0, -1).map(([x, y]) => ({ x, y }))));
  } catch {
    polygons = pieces.map((rg) => [rg]);
  }
  return { polygons, axes };
}

/** Points along a polyline every `step` metres from `offset`, each with the line's direction there. */
export function alongLine(line: XY[], step: number, offset = 0): { p: XY; t: XY }[] {
  const out: { p: XY; t: XY }[] = [];
  let next = offset, run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    while (next <= run + len) {
      const s = next - run;
      out.push({ p: { x: a.x + t.x * s, y: a.y + t.y * s }, t });
      next += step;
    }
    run += len;
  }
  return out;
}

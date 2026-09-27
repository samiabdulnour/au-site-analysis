// Kerbside parking bays from a road centreline.
//
// OpenStreetMap tags parking on the road way itself: which side, and sometimes
// whether the cars stand parallel, at an angle or at ninety degrees. It does
// not say where the kerb is. The cadastre does, near enough: the road reserve
// is the gap between the lot boundaries either side of the centreline, and the
// kerb sits a verge's width inside it. So each bay run is set out at the kerb
// found that way, at the AS/NZS 2890.5 on-street bay sizes, one quad per bay,
// and a bay that a driveway crosses is left out.
//
// Everything here is pure geometry on lon/lat input, so both the sheet and the
// CAD export draw the same bays and the test can drive it with a made-up
// street.

import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor, type XY } from './geo.js';

export type Orientation = 'parallel' | 'diagonal' | 'perpendicular';
export type LonLat = [number, number];

export interface ParkingLaneIn {
  coords: LonLat[];
  side: 'left' | 'right' | 'both';
  orientation?: Orientation;
  /** OSM highway class, which bounds how far out the kerb can plausibly be. */
  highway?: string;
}

/**
 * The furthest the kerb can be from the centreline for a road of this class,
 * ground metres. The cadastre answer is usually right; where the centreline
 * runs through a large parcel, or a lane's reserve is not the gap the lots
 * leave, the ray finds a boundary a block away, and this is what stops the
 * bays landing in somebody's yard.
 */
export function maxKerbM(highway?: string): number {
  switch (highway) {
    case 'service': case 'living_street': case 'pedestrian': case 'track': return 4;
    case 'residential': case 'unclassified': return 8;
    case 'tertiary': case 'tertiary_link': return 10;
    default: return 14;
  }
}

export interface ParkingBand {
  side: 'left' | 'right';
  orientation: Orientation;
  /** One closed ring (lon/lat) per bay. */
  bays: LonLat[][];
  /** Kerb offset from the centreline that was used, ground metres. */
  kerbM: number;
}

/** AS/NZS 2890.5 on-street bays: length along the kerb × depth from it. */
export const BAY: Record<Orientation, { pitchM: number; depthM: number }> = {
  parallel: { pitchM: 6.0, depthM: 2.2 },
  diagonal: { pitchM: 3.7, depthM: 4.9 },       // 45°: 2.6 m wide bays, 3.7 m along the kerb
  perpendicular: { pitchM: 2.6, depthM: 5.4 },
};

/** Where the kerb is assumed when the cadastre gives no answer, ground metres. */
const DEFAULT_RESERVE_HALF_M = 10;

/**
 * The verge between the lot boundary and the kerb. Sydney's 20 m residential
 * reserve carries a 12.8 m carriageway, so about 3.6 m a side; narrow lanes
 * have less, arterials more.
 */
export function vergeM(reserveWidthM: number): number {
  return Math.min(5, Math.max(2.5, reserveWidthM * 0.18));
}

/** First intersection distance of the ray p + t·d (t>0) with segment ab, or null. */
function raySegment(p: XY, d: XY, a: XY, b: XY): number | null {
  const ex = b.x - a.x, ey = b.y - a.y;
  const den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
  const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
  if (t <= 0 || u < 0 || u > 1) return null;
  return t;
}

/** Nearest lot boundary along a perpendicular from p, ground metres, within reach. */
function reserveHalf(p: XY, n: XY, lots: XY[][], k: number, reachM: number): number | null {
  let best: number | null = null;
  const reach = reachM * k;
  for (const ring of lots) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      // cheap reject: both ends further than reach in x or y
      if (Math.min(a.x, b.x) > p.x + reach || Math.max(a.x, b.x) < p.x - reach) continue;
      if (Math.min(a.y, b.y) > p.y + reach || Math.max(a.y, b.y) < p.y - reach) continue;
      const t = raySegment(p, n, a, b);
      if (t != null && t <= reach && (best == null || t < best)) best = t;
    }
  }
  return best == null ? null : best / k;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Point and unit direction at arc length s along a polyline (mercator). */
function along(pts: XY[], cum: number[], s: number): { p: XY; d: XY } {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const L = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / L));
  const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, d: { x: dx, y: dy } };
}

/** Distance from p to segment ab. */
function pointSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** No parking this close to a cross street's centreline (the road rules say 10 m from the intersection). */
const INTERSECTION_CLEAR_M = 10;

/**
 * Set out the bays for every tagged run. `lots` are lot rings and `breaks`
 * are driveway lines, both lon/lat; a bay within 3.5 m of a driveway point is
 * dropped so the run stops either side of the crossing. `crossings` are the
 * road centrelines: a bay within 10 m of one that crosses the run (rather
 * than running with it) is an intersection mouth, and is dropped too.
 */
export function buildParkingBands(
  lanes: ParkingLaneIn[],
  lots: number[][][],
  breaks: LonLat[][] = [],
  crossings: LonLat[][] = [],
): ParkingBand[] {
  const out: ParkingBand[] = [];
  if (!lanes.length) return out;
  const lotsM: XY[][] = lots.map((r) => r.map(([lon, lat]) => lonLatToMercator({ lon, lat })));
  const breakPts: XY[] = breaks.flat().map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const crossSegs: { a: XY; b: XY; dir: XY }[] = [];
  for (const line of crossings) {
    const m = line.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
    for (let i = 1; i < m.length; i++) {
      const L = Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) || 1;
      crossSegs.push({ a: m[i - 1], b: m[i], dir: { x: (m[i].x - m[i - 1].x) / L, y: (m[i].y - m[i - 1].y) / L } });
    }
  }
  /** Within reach of a road segment that crosses the run, not one that runs with it. */
  const atIntersection = (c: XY, d: XY, reach: number): boolean =>
    crossSegs.some((s) => Math.abs(s.dir.x * d.x + s.dir.y * d.y) < Math.cos(Math.PI / 6) && pointSegment(c, s.a, s.b) < reach);

  for (const lane of lanes) {
    const pts = lane.coords.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
    if (pts.length < 2) continue;
    const k = mercatorScaleFactor(lane.coords[0][1]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1];
    if (total < 3 * k) continue;
    const orientation: Orientation = lane.orientation ?? 'parallel';
    const { pitchM, depthM } = BAY[orientation];
    const sides: ('left' | 'right')[] = lane.side === 'both' ? ['left', 'right'] : [lane.side];

    for (const side of sides) {
      // left of travel is the left-hand normal in a y-up frame
      const sgn = side === 'left' ? 1 : -1;
      const normalAt = (d: XY): XY => ({ x: -d.y * sgn, y: d.x * sgn });

      // kerb: median reserve half-width along the run, less a verge
      const halves: number[] = [];
      const step = Math.max(8 * k, total / 12);
      for (let s = step / 2; s < total; s += step) {
        const { p, d } = along(pts, cum, s);
        const h = reserveHalf(p, normalAt(d), lotsM, k, 40);
        // Keep the close answers: a lane's reserve is narrow, and dropping
        // them leaves only the gaps and the median of a block away.
        if (h != null && h >= 1.5) halves.push(h);
      }
      const half = halves.length ? median(halves) : DEFAULT_RESERVE_HALF_M;
      let kerbM = half - vergeM(half * 2);
      if (kerbM < 2.5) kerbM = Math.max(2.5, half * 0.6);
      kerbM = Math.min(kerbM, maxKerbM(lane.highway));
      const inner = (kerbM - depthM) * k, outer = kerbM * k;
      // an angled bay's lines run 45° to the kerb: shear the inner edge along the run
      const shear = orientation === 'diagonal' ? depthM * k : 0;

      const bays: LonLat[][] = [];
      const pitch = pitchM * k;
      const startM = 1.5 * k; // a bay never starts on the run's very end vertex
      for (let s = startM; s + pitch <= total - startM; s += pitch) {
        const A = along(pts, cum, s), B = along(pts, cum, s + pitch);
        const nA = normalAt(A.d), nB = normalAt(B.d);
        const q: XY[] = [
          { x: A.p.x + nA.x * outer, y: A.p.y + nA.y * outer },
          { x: B.p.x + nB.x * outer, y: B.p.y + nB.y * outer },
          { x: B.p.x + nB.x * inner + B.d.x * shear, y: B.p.y + nB.y * inner + B.d.y * shear },
          { x: A.p.x + nA.x * inner + A.d.x * shear, y: A.p.y + nA.y * inner + A.d.y * shear },
        ];
        const cx = (q[0].x + q[2].x) / 2, cy = (q[0].y + q[2].y) / 2;
        const reach = 3.5 * k + pitch / 2;
        if (breakPts.some((b) => Math.hypot(b.x - cx, b.y - cy) < reach)) continue;
        if (atIntersection({ x: cx, y: cy }, A.d, INTERSECTION_CLEAR_M * k)) continue;
        const ring = q.map((p) => { const ll = mercatorToLonLat(p); return [ll.lon, ll.lat] as LonLat; });
        ring.push(ring[0]);
        bays.push(ring);
      }
      if (bays.length) out.push({ side, orientation, bays, kerbM: +kerbM.toFixed(2) });
    }
  }
  return out;
}

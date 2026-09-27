// Ground level at a point, from contour lines.
//
// Between two contours the ground is taken to run straight from one to the
// other, so the level at a point is found by walking across the slope to the
// first contour each way and interpolating by distance. The walk is tried in
// twelve directions and the shortest crossing pair wins: that is the steepest
// line through the point, the one the ground actually follows. Taking the two
// nearest contours by distance is not enough — the second-nearest is as often
// the next line down the far side of the nearest as the one across from it,
// which put a corner 0.5 m low on a sheet with 1 m contours.

import type { XY } from './geo.js';

/** A contour in ground metres (x east, y north). */
export interface ContourM { z: number; pts: XY[] }

interface Crossing { z: number; t: number }

/** Every contour the ray P + t·d (t > 0) crosses within reach, nearest first. */
function crossings(P: XY, d: XY, contours: ContourM[], reach: number): Crossing[] {
  const out: Crossing[] = [];
  for (const c of contours) {
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i];
      if (Math.min(a.x, b.x) > P.x + reach || Math.max(a.x, b.x) < P.x - reach) continue;
      if (Math.min(a.y, b.y) > P.y + reach || Math.max(a.y, b.y) < P.y - reach) continue;
      const ex = b.x - a.x, ey = b.y - a.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - P.x) * ey - (a.y - P.y) * ex) / den;
      const u = ((a.x - P.x) * d.y - (a.y - P.y) * d.x) / den;
      if (t > 0.02 && t <= reach && u >= 0 && u <= 1) out.push({ z: c.z, t });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The nearest point of any contour to P, with its level and distance. */
function nearest(P: XY, contours: ContourM[]): { z: number; d: number; q: XY } | null {
  let best: { z: number; d: number; q: XY } | null = null;
  for (const c of contours) {
    for (let i = 1; i < c.pts.length; i++) {
      const a = c.pts[i - 1], b = c.pts[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / L2)) : 0;
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(P.x - q.x, P.y - q.y);
      if (!best || d < best.d) best = { z: c.z, d, q };
    }
  }
  return best;
}

const DIRECTIONS = 12;

/**
 * The level at P, or null when no contour is within reach. `intervalM` bounds
 * how far the ground can be extrapolated past the last contour on a slope.
 */
export function levelAt(P: XY, contours: ContourM[], intervalM: number, reachM = 80): number | null {
  const near = nearest(P, contours);
  if (!near) return null;
  if (near.d < 0.05) return near.z;

  // Across the slope: the steepest pair of different levels either side.
  let best: { z: number; span: number } | null = null;
  for (let i = 0; i < DIRECTIONS; i++) {
    const a = (Math.PI * i) / DIRECTIONS;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const fwd = crossings(P, d, contours, reachM);
    const back = crossings(P, { x: -d.x, y: -d.y }, contours, reachM);
    if (!fwd.length || !back.length || fwd[0].z === back[0].z) continue;
    const f = fwd[0], b = back[0];
    const span = f.t + b.t;
    if (!best || span < best.span) best = { z: b.z + ((f.z - b.z) * b.t) / span, span };
  }
  if (best) return best.z;

  // No two levels bracket the point: it is past the last contour on a slope,
  // or one level wraps it (a knoll inside a closed loop, a gully in a bend).
  // Either way the ground is read by walking to the nearest contour and on
  // through it to the next level, and carrying that slope back across the
  // point — at most one interval, since no further line was crossed.
  const n = { x: (near.q.x - P.x) / near.d, y: (near.q.y - P.y) / near.d };
  const along = crossings(P, n, contours, reachM * 3);
  const first = along[0] ?? { z: near.z, t: near.d };
  const second = along.find((c) => c.z !== first.z);
  if (!second) return first.z;
  const perM = (first.z - second.z) / Math.max(0.1, second.t - first.t);
  return first.z + Math.sign(perM) * Math.min(intervalM, Math.abs(perM) * first.t);
}

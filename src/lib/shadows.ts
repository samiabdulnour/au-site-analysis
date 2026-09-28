// The shadow a building throws: its footprint swept along the shadow vector
// (height over the tangent of the sun's altitude, away from the sun) and
// closed with a convex hull. Exact for a convex footprint and a fair hint
// for any other, which is what a study of the neighbours' winter shadows
// needs before anyone models the block.

import type { XY } from './geo.js';

/** Monotone-chain convex hull, counter-clockwise. */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: XY[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/**
 * The ground shadow of a footprint (Mercator coordinates) of `heightM` under
 * a sun at `altitudeDeg` and `azimuthDeg`; `k` is the Mercator scale factor
 * at the site, so ground metres become map units. Null when the sun is down
 * or so low the shadow runs off any drawing (altitude under 3°).
 */
export function shadowHull(ring: XY[], heightM: number, altitudeDeg: number, azimuthDeg: number, k: number): XY[] | null {
  if (altitudeDeg < 3 || !(heightM > 0)) return null;
  const lengthM = heightM / Math.tan((altitudeDeg * Math.PI) / 180);
  // the shadow falls away from the sun
  const away = ((azimuthDeg + 180) * Math.PI) / 180;
  const dx = Math.sin(away) * lengthM * k, dy = Math.cos(away) * lengthM * k;
  const swept = ring.concat(ring.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  return convexHull(swept);
}

/** Point in a polygon, for the shadow samples. */
export function inHull(p: XY, hull: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const a = hull[i], b = hull[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

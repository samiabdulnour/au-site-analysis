// Plane geometry on closed rings, for the Country slide's heritage layers: a
// ring clipped to a box, whether a set of rings covers a box, whether a
// point is inside, the gap between two sets of rings, and how much of one
// set another covers. Rings are [x, y] arrays, closed or not; the functions
// work in whatever plane units they are given (lon/lat for clipping to the
// strip, Web Mercator for distances and areas).

export interface Box { xmin: number; ymin: number; xmax: number; ymax: number }

const open = (ring: number[][]) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);

/** A ring clipped to a box (Sutherland–Hodgman), closed, or null when nothing of it is left. */
export function clipRing(ring: number[][], b: Box): number[][] | null {
  let pts = open(ring);
  const sides: [(p: number[]) => boolean, (p: number[], q: number[]) => number[]][] = [
    [(p) => p[0] >= b.xmin, (p, q) => [b.xmin, p[1] + ((b.xmin - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]],
    [(p) => p[0] <= b.xmax, (p, q) => [b.xmax, p[1] + ((b.xmax - p[0]) / (q[0] - p[0])) * (q[1] - p[1])]],
    [(p) => p[1] >= b.ymin, (p, q) => [p[0] + ((b.ymin - p[1]) / (q[1] - p[1])) * (q[0] - p[0]), b.ymin]],
    [(p) => p[1] <= b.ymax, (p, q) => [p[0] + ((b.ymax - p[1]) / (q[1] - p[1])) * (q[0] - p[0]), b.ymax]],
  ];
  for (const [inside, cut] of sides) {
    if (!pts.length) break;
    const out: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); } else if (inside(prev)) out.push(cut(prev, cur));
    }
    pts = out;
  }
  return pts.length >= 3 ? [...pts, pts[0]] : null;
}

/** A ring's area, unsigned, reckoned about its first vertex so that small rings far from the origin keep their digits. */
export function ringArea(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const [x0, y0] = ring[0];
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - x0) * (ring[i][1] - y0) - (ring[i][0] - x0) * (ring[j][1] - y0);
  return Math.abs(a) / 2;
}

/** Rings clipped to a box, the empty ones dropped. */
export const clipRings = (rings: number[][][], b: Box): number[][][] => rings.map((r) => clipRing(r, b)).filter((r): r is number[][] => r !== null);

/** Whether a point is inside a set of rings, by the even-odd rule (a hole is a ring inside another). */
export function inRings(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a segment reaches into a box (Liang–Barsky). */
export function segmentMeetsBox(p: number[], q: number[], b: Box): boolean {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  for (const [den, num] of [[-dx, p[0] - b.xmin], [dx, b.xmax - p[0]], [-dy, p[1] - b.ymin], [dy, b.ymax - p[1]]]) {
    if (den === 0) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/** Whether a set of rings takes in the whole of a box: its corners are inside and no edge reaches into it. */
export function coversBox(rings: number[][][], b: Box): boolean {
  const corners = [[b.xmin, b.ymin], [b.xmax, b.ymin], [b.xmax, b.ymax], [b.xmin, b.ymax]];
  if (!corners.every(([x, y]) => inRings(x, y, rings))) return false;
  for (const r of rings) for (let i = 0; i + 1 < r.length; i++) if (segmentMeetsBox(r[i], r[i + 1], b)) return false;
  return true;
}

/** The nearest point of a segment to a point. */
function onSegment(p: number[], a: number[], q: number[]): number[] {
  const dx = q[0] - a[0], dy = q[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/** The nearest point of a set of rings' edges to a point, and how far it is. */
export function nearestOnRings(p: number[], rings: number[][][]): { d: number; x: number; y: number } | null {
  let best: { d: number; x: number; y: number } | null = null;
  for (const r of rings) for (let i = 0; i + 1 < r.length; i++) {
    const [x, y] = onSegment(p, r[i], r[i + 1]);
    const d = Math.hypot(x - p[0], y - p[1]);
    if (!best || d < best.d) best = { d, x, y };
  }
  return best;
}

const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Where two segments cross each other, or null. */
function crossing(a: number[], b: number[], c: number[], d: number[]): number[] | null {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) return null;
  const t = d1 / (d1 - d2);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

/**
 * The gap between two sets of rings and the point of `b` where it is
 * shortest: the shortest distance between their edges, nil where the edges
 * cross, and nil where one set lies inside the other.
 */
export function ringsGap(a: number[][][], b: number[][][]): { d: number; x: number; y: number } | null {
  const best = { d: Infinity, x: 0, y: 0 };
  for (const ra of a) for (let i = 0; i + 1 < ra.length; i++) {
    const n = nearestOnRings(ra[i], b);
    if (n && n.d < best.d) Object.assign(best, n);
    if (best.d > 0) for (const rb of b) for (let j = 0; j + 1 < rb.length; j++) {
      const p = crossing(ra[i], ra[i + 1], rb[j], rb[j + 1]);
      if (p) { Object.assign(best, { d: 0, x: p[0], y: p[1] }); break; }
    }
  }
  for (const rb of b) for (const p of rb) {
    const n = nearestOnRings(p, a);
    if (n && n.d < best.d) Object.assign(best, { d: n.d, x: p[0], y: p[1] });
  }
  if (!Number.isFinite(best.d)) return null;
  if (best.d > 0) {
    // one inside the other: no edge meets, yet there is no gap
    const pa = a.find((r) => r.length)?.[0], pb = b.find((r) => r.length)?.[0];
    if ((pa && inRings(pa[0], pa[1], b)) || (pb && inRings(pb[0], pb[1], a))) best.d = 0;
  }
  return best;
}

/**
 * How much of the area inside `site` also lies inside `rings`, by a grid of
 * sample points over the site (some 1,600 of them): the area both hold, the
 * site's own area, and the share, in the plane's units.
 */
export function overlapArea(site: number[][][], rings: number[][][]): { area: number; siteArea: number; share: number } {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const r of site) for (const [x, y] of r) { xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y); }
  if (!Number.isFinite(xmin) || xmax <= xmin || ymax <= ymin) return { area: 0, siteArea: 0, share: 0 };
  const step = Math.sqrt(((xmax - xmin) * (ymax - ymin)) / 1600);
  let inSite = 0, inBoth = 0;
  for (let y = ymin + step / 2; y < ymax; y += step) for (let x = xmin + step / 2; x < xmax; x += step) {
    if (!inRings(x, y, site)) continue;
    inSite++;
    if (inRings(x, y, rings)) inBoth++;
  }
  const cell = step * step;
  return { area: inBoth * cell, siteArea: inSite * cell, share: inSite ? inBoth / inSite : 0 };
}

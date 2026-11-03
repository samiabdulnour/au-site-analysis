// Dashed and dotted lines cut to the drawing they are seen in.
//
// Chromium prints a dashed stroke to PDF as one filled outline per dash: a
// dotted line's every dot is its own closed shape of eight curves. A clip
// hides what falls outside it but does not keep it out of the file, so a bus
// route running kilometres past the map's edge, or a dotted texture drawn
// across the whole map and clipped to a few zones, puts every dot it would
// have drawn into the PDF. A context sheet's bus routes alone came to 120,000
// dots, 98 of every 100 of them off the map: an 85 MB PDF that PDF.js, the
// viewer in most browsers, had not drawn after half an hour.
//
// So a dashed line is cut to its box before it is written. Each piece kept
// starts a whole number of dash periods along the line from where the line
// started, so the dash pattern, which begins again at every piece, puts every
// dash and dot where the uncut line put it.

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }

/** The length of one repeat of an SVG stroke-dasharray, or undefined for a solid line. An odd list repeats twice over, as SVG reads it. */
export function dashPeriod(dasharray: string | undefined): number | undefined {
  const parts = (dasharray ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  const sum = parts.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return undefined;
  return parts.length % 2 ? sum * 2 : sum;
}

/** The part [t0, t1] of the segment a→b inside the rectangle (Liang–Barsky), or null when none of it is. */
function clipSegment(a: Pt, b: Pt, r: Rect): [number, number] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0] - r.x], [dx, r.x + r.w - a[0]], [-dy, a[1] - r.y], [dy, r.y + r.h - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}

/**
 * The pieces of a polyline that come within `margin` of the box, each
 * starting a whole number of `period`s from the line's own start, so a dash
 * pattern of that period puts its dashes where it put them on the whole line.
 * A line wholly inside comes back whole, as the same array; one wholly
 * outside comes back as nothing. Without a period the pieces are cut at the
 * box, as a solid line can be.
 */
export function clipDashed(pts: Pt[], box: Rect, period?: number, margin = 0): Pt[][] {
  if (pts.length < 2) return [];
  const r = { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin };
  const inside = (p: Pt) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  if (pts.every(inside)) return [pts];
  // where along the line (by length) it is inside the box, as merged intervals
  const at: number[] = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = at[i + 1] - at[i];
    if (!(len > 0)) continue;
    const t = clipSegment(pts[i], pts[i + 1], r);
    if (!t) continue;
    // each piece goes back to the last whole period before it enters
    const s0 = period ? Math.floor((at[i] + t[0] * len) / period) * period : at[i] + t[0] * len;
    const s1 = at[i] + t[1] * len;
    const last = spans[spans.length - 1];
    if (last && s0 <= last[1] + 1e-9) last[1] = Math.max(last[1], s1);
    else spans.push([s0, s1]);
  }
  // the line between two lengths along it, its corners included
  const pointAt = (s: number, i: number): Pt => {
    const len = at[i + 1] - at[i];
    const t = len > 0 ? Math.min(1, Math.max(0, (s - at[i]) / len)) : 0;
    return [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])];
  };
  const out: Pt[][] = [];
  let i = 0;
  for (const [s0, s1] of spans) {
    while (i + 2 < pts.length && at[i + 1] <= s0) i++;
    const piece: Pt[] = [pointAt(s0, i)];
    let j = i;
    while (j + 2 < pts.length && at[j + 1] < s1) { j++; piece.push(pts[j]); }
    piece.push(pointAt(s1, j));
    if (piece.length >= 2) out.push(piece);
    i = j;
  }
  return out;
}

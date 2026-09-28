// Ridgelines from an elevation grid: the cells that stand above their
// neighbours along two or more directions, chained into polylines. A
// landscape reading, not a survey: it marks the crests the ground makes,
// which is what a Country map wants, and leaves the flat ground alone.

import type { DemGrid } from '../fetch/terrain.js';

export interface RidgeOptions {
  /** The distances looked across, in cells, each with the rise a crest must show over the ground that far away on both sides, in metres; the broader ones find the broad ridges. */
  scales?: [number, number][];
  /** How far a crest must stand above the ground two cells away along a direction, in metres (the first scale, when `scales` is not given). */
  riseM?: number;
  /** Local relief a 7 × 7 window must show for a crest to count, in metres; flat suburbs give none. */
  reliefM?: number;
  /** Directions (of the four axes) along which a cell must be a local maximum. */
  minDirections?: number;
}

/** Polylines of ridge cells in the grid's Mercator coordinates. */
export function ridgeLines(g: DemGrid, o: RidgeOptions = {}): { x: number; y: number; z: number }[][] {
  const scales: [number, number][] = o.scales ?? [[2, o.riseM ?? 1.0], [5, 2.0], [10, 4.0]];
  const reliefM = o.reliefM ?? 3, minDir = o.minDirections ?? 2;
  const reach = Math.max(...scales.map(([d]) => d));
  const { cols, rows } = g;
  const at = (r: number, c: number) => g.values[r * cols + c];
  // a light 3 × 3 smoothing takes the model's step noise out of the test
  const z = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      const v = at(rr, cc);
      if (Number.isFinite(v)) { s += v; n++; }
    }
    z[r * cols + c] = n ? s / n : NaN;
  }
  const zz = (r: number, c: number) => z[r * cols + c];
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const ridge = new Uint8Array(cols * rows);
  const m = Math.max(3, reach);
  for (let r = m; r < rows - m; r++) for (let c = m; c < cols - m; c++) {
    const v = zz(r, c);
    if (!Number.isFinite(v)) continue;
    let crest = false;
    for (const [d, riseM] of scales) {
      let hits = 0;
      for (const [dr, dc] of dirs) {
        const a = zz(r + d * dr, c + d * dc), b = zz(r - d * dr, c - d * dc);
        if (Number.isFinite(a) && Number.isFinite(b) && v - Math.max(a, b) >= riseM) hits++;
      }
      if (hits >= minDir) { crest = true; break; }
    }
    if (!crest) continue;
    // thin the broad crests to their spine: the cell must top both of its immediate neighbours along some axis
    let spine = false;
    for (const [dr, dc] of dirs) { const a = zz(r + dr, c + dc), b = zz(r - dr, c - dc); if (Number.isFinite(a) && Number.isFinite(b) && v >= a && v >= b && (v > a || v > b)) { spine = true; break; } }
    if (!spine) continue;
    let lo = Infinity, hi = -Infinity;
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) { const w = zz(r + dr, c + dc); if (Number.isFinite(w)) { if (w < lo) lo = w; if (w > hi) hi = w; } }
    if (hi - lo >= reliefM) ridge[r * cols + c] = 1;
  }
  // chain neighbouring ridge cells into polylines, preferring the straight continuation
  const seen = new Uint8Array(cols * rows);
  const cellXY = (r: number, c: number) => ({ x: g.xmin + (c + 0.5) * g.cellX, y: g.ymax - (r + 0.5) * g.cellY, z: zz(r, c) });
  const nbrs = (r: number, c: number) => {
    const out: [number, number][] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && ridge[rr * cols + cc] && !seen[rr * cols + cc]) out.push([rr, cc]); }
    return out;
  };
  const lines: { x: number; y: number; z: number }[][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!ridge[r * cols + c] || seen[r * cols + c]) continue;
    // walk both ways from the seed
    const walk = (r0: number, c0: number, pr: number, pc: number) => {
      const out: [number, number][] = [];
      let cr = r0, cc = c0, lr = pr, lc = pc;
      for (let i = 0; i < 10_000; i++) {
        const cands = nbrs(cr, cc);
        if (!cands.length) break;
        const ddr = cr - lr, ddc = cc - lc;
        cands.sort((p, q) => (Math.abs((p[0] - cr) - ddr) + Math.abs((p[1] - cc) - ddc)) - (Math.abs((q[0] - cr) - ddr) + Math.abs((q[1] - cc) - ddc)));
        const [nr, nc] = cands[0];
        seen[nr * cols + nc] = 1;
        out.push([nr, nc]);
        lr = cr; lc = cc; cr = nr; cc = nc;
      }
      return out;
    };
    seen[r * cols + c] = 1;
    const fwd = walk(r, c, r, c);
    const back = walk(r, c, fwd[0]?.[0] ?? r, fwd[0]?.[1] ?? c);
    const cells: [number, number][] = [...back.reverse(), [r, c], ...fwd];
    if (cells.length < 5) continue;
    lines.push(cells.filter((_, i) => i % 2 === 0 || i === cells.length - 1).map(([rr, cc]) => cellXY(rr, cc)));
  }
  return lines.sort((a, b) => b.length - a.length);
}

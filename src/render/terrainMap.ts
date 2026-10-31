// What the topography slide computes from the elevation grid: the hillshade
// raster, the two section lines through the site (along the fall and across
// it), the samples along them, and the site's own levels and fall.

import { demAt, demGradient, type DemGrid } from '../fetch/terrain.js';
import { lonLatToMercator, mercatorToLonLat, type Extent, type XY } from '../lib/geo.js';
import { pointInRing } from '../fetch/planning.js';
import { greyPng, pngDataUri } from './png.js';
import { encodeRgbaPng } from '../lib/png.js';

/**
 * Horn's hillshade from the north-west, flat ground left white and slopes
 * that face away from the light shaded, so it sits under linework rather
 * than competing with it.
 */
/**
 * A toned relief picture, ready to print: the ground in bands of `stepM` (or none), the hillshade multiplied over
 * them at `shade`, the result run from white to `dark`. One opaque RGB image, so no viewer has a filter or a blend to get wrong.
 */
/** How the bands are hatched: the cells' size on the paper, a line ink a band (the lowest band stays plain), the line's weight and the spacing from the lowest hatched band to the highest. */
export interface ReliefHatch { mmPerCell: number; inks: string[]; lineMm?: number; maxPeriodMm?: number; minPeriodMm?: number; /** The ground between a band's lines: paper (0) or a tint of the band's ink, this much of it. */ bgTint?: number }

/** The grid at `u` times its resolution, bilinear, so a pattern painted on it has the pixels to be crisp. */
export function upsampleGrid(g: DemGrid, u: number): DemGrid {
  if (u <= 1) return g;
  const cols = g.cols * u, rows = g.rows * u;
  const values = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r++) {
    const fy = Math.min(g.rows - 1, Math.max(0, (r + 0.5) / u - 0.5)), r0 = Math.floor(fy), r1 = Math.min(g.rows - 1, r0 + 1), ty = fy - r0;
    for (let c = 0; c < cols; c++) {
      const fx = Math.min(g.cols - 1, Math.max(0, (c + 0.5) / u - 0.5)), c0 = Math.floor(fx), c1 = Math.min(g.cols - 1, c0 + 1), tx = fx - c0;
      const a = g.values[r0 * g.cols + c0], b = g.values[r0 * g.cols + c1], d = g.values[r1 * g.cols + c0], e = g.values[r1 * g.cols + c1];
      values[r * cols + c] = Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(d) && Number.isFinite(e) ? (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty : NaN;
    }
  }
  return { ...g, cols, rows, cellX: g.cellX / u, cellY: g.cellY / u, values };
}

/** The spacing of a hatched band's lines, in millimetres: the lowest hatched band the widest, the highest the tightest. */
export function hatchPeriodMm(band: number, bands: number, h: ReliefHatch): number {
  const maxP = h.maxPeriodMm ?? 2.2, minP = h.minPeriodMm ?? 0.7;
  return maxP - (maxP - minP) * ((band - 1) / Math.max(1, bands - 2));
}

export function reliefDataUri(g0: DemGrid, dark: string, opts: { stepM?: number; lo?: number; hi?: number; bandWeight?: number; shade?: number; /** A colour a band, low to high, in place of the ramp toward `dark`. */ colours?: string[]; /** The bands as hatching rather than tones: the grid is upsampled so the lines are crisp. */ hatch?: ReliefHatch } = {}): string {
  const up = opts.hatch ? Math.max(1, Math.ceil(4 / opts.hatch.mmPerCell)) : 1;
  const g = upsampleGrid(g0, up);
  const pxPerMm = opts.hatch ? up / opts.hatch.mmPerCell : 1;
  const hs = hillshadeGrey(g);
  const d = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
  const step = opts.stepM, lo = opts.lo ?? g.min, hi = opts.hi ?? g.max, bw = opts.bandWeight ?? 0.62, shade = opts.shade ?? 0.45;
  const bands = step ? Math.max(1, Math.ceil((hi - lo) / step)) : 1;
  const cols = step && opts.colours?.length ? opts.colours.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))) : null;
  const hatch = step && opts.hatch ? opts.hatch : null;
  const hatchInks = hatch ? hatch.inks.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))) : null;
  const lineW = hatch ? Math.max(1, (hatch.lineMm ?? 0.16) * pxPerMm) : 0;
  const periods = hatch ? Array.from({ length: bands }, (_, k) => (k === 0 ? 0 : Math.max(2, Math.round(hatchPeriodMm(k, bands, hatch) * pxPerMm)))) : null;
  const rgba = new Uint8Array(g.cols * g.rows * 4);
  for (let i = 0; i < g.cols * g.rows; i++) {
    const v = g.values[i];
    if (hatchInks && periods && Number.isFinite(v)) {
      // the lowest band plain paper, each band above it hatched in its ink, tighter up the slope; the hillshade over the paper
      const band = Math.min(bands - 1, Math.max(0, Math.floor((v - lo) / step!)));
      const sh = 1 - shade * (1 - hs[i] / 255);
      const period = periods[band];
      const x = i % g.cols, y = Math.floor(i / g.cols);
      const ink = hatchInks[Math.min(hatchInks.length - 1, band)];
      if (period && (x + y) % period < lineW) {
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = ink[c];
      } else {
        const bt = period ? (hatch!.bgTint ?? 0) : 0;
        for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round((255 - (255 - ink[c]) * bt) * sh);
      }
      rgba[i * 4 + 3] = 255;
      continue;
    }
    if (cols && Number.isFinite(v)) {
      // the band's own colour, the hillshade over it
      const band = Math.min(bands - 1, Math.max(0, Math.floor((v - lo) / step!)));
      const base = cols[Math.min(cols.length - 1, Math.round((band / Math.max(1, bands - 1)) * (cols.length - 1)))];
      const sh = 1 - shade * (1 - hs[i] / 255);
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(base[c] * sh);
      rgba[i * 4 + 3] = 255;
      continue;
    }
    let t = 1; // 1 is paper, 0 is the dark ink
    if (Number.isFinite(v)) {
      if (step) t -= (Math.min(bands - 1, Math.max(0, Math.floor((v - lo) / step))) / Math.max(1, bands - 1)) * bw;
      t *= 1 - shade * (1 - hs[i] / 255);
    }
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(d[c] + (255 - d[c]) * t);
    rgba[i * 4 + 3] = 255;
  }
  return `data:image/png;base64,${encodeRgbaPng(g.cols, g.rows, rgba).toString('base64')}`;
}

/** The heat ramp the landform is banded in: blue on the low ground, through green and yellow, to red on the high. */
export const HEAT_RAMP = ['#4a5fc1', '#2f9bd6', '#36b48e', '#8ccf49', '#e6d83a', '#f4a52a', '#e65d2c', '#b4222c'];
/** `bands` colours read evenly along a ramp, low to high: the relief's bands and the key's swatches share them. */
export function rampColours(bands: number, ramp = HEAT_RAMP): string[] {
  const rgb = ramp.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
  return Array.from({ length: bands }, (_, k) => {
    const u = bands > 1 ? (k / (bands - 1)) * (ramp.length - 1) : 0;
    const a = Math.floor(u), b = Math.min(ramp.length - 1, a + 1), f = u - a;
    return `#${rgb[a].map((v, c) => Math.round(v + (rgb[b][c] - v) * f).toString(16).padStart(2, '0')).join('')}`;
  });
}
/** The hatched bands as fills for the map's key: the lowest plain, the rest lined in their inks at the spacing the picture uses. */
export function reliefBandHatches(bands: number, h: ReliefHatch): { bg?: string; kind?: 'hatch'; ink?: string; step?: number; w?: number }[] {
  const tintOf = (hex: string, k: number) => { const n = parseInt(hex.slice(1), 16); return `#${[16, 8, 0].map((sh) => Math.round(255 - (255 - ((n >> sh) & 255)) * k).toString(16).padStart(2, '0')).join('')}`; };
  return Array.from({ length: bands }, (_, k) => { const ink = h.inks[Math.min(h.inks.length - 1, k)]; return k === 0 ? { bg: '#ffffff' } : { bg: tintOf(ink, h.bgTint ?? 0), kind: 'hatch' as const, ink, step: hatchPeriodMm(k, bands, h), w: h.lineMm ?? 0.16 }; });
}

/**
 * Contour lines traced from the grid by marching squares, in Mercator, one list of polylines a level: for the
 * regional map, whose contours no service draws at its scale. The segments of a level are chained end to end
 * and each line smoothed once, so a 60 m grid's steps do not show.
 */
export function isolines(g: DemGrid, levels: number[]): { level: number; lines: XY[][] }[] {
  const at = (c: number, r: number) => g.values[r * g.cols + c];
  const px = (c: number) => g.xmin + (c + 0.5) * g.cellX, py = (r: number) => g.ymax - (r + 0.5) * g.cellY;
  const out: { level: number; lines: XY[][] }[] = [];
  for (const level of levels) {
    const segs: [XY, XY][] = [];
    for (let r = 0; r < g.rows - 1; r++) for (let c = 0; c < g.cols - 1; c++) {
      const a = at(c, r), b = at(c + 1, r), d = at(c + 1, r + 1), e = at(c, r + 1);
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(d) && Number.isFinite(e))) continue;
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (d >= level ? 2 : 0) | (e >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const lerp = (v0: number, v1: number) => (level - v0) / (v1 - v0 || 1e-9);
      const top = (): XY => ({ x: px(c) + lerp(a, b) * g.cellX, y: py(r) });
      const right = (): XY => ({ x: px(c + 1), y: py(r) - lerp(b, d) * g.cellY });
      const bottom = (): XY => ({ x: px(c) + lerp(e, d) * g.cellX, y: py(r + 1) });
      const left = (): XY => ({ x: px(c), y: py(r) - lerp(a, e) * g.cellY });
      const centre = (a + b + d + e) / 4 >= level;
      switch (idx) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), top()]); break;
        case 5: if (centre) { segs.push([left(), top()]); segs.push([bottom(), right()]); } else { segs.push([left(), bottom()]); segs.push([top(), right()]); } break;
        case 10: if (centre) { segs.push([top(), right()]); segs.push([left(), bottom()]); } else { segs.push([left(), top()]); segs.push([bottom(), right()]); } break;
      }
    }
    // chain the segments: each end keyed to the cell grid's resolution
    const key = (p: XY) => `${Math.round((p.x - g.xmin) / g.cellX * 4)},${Math.round((g.ymax - p.y) / g.cellY * 4)}`;
    const ends = new Map<string, number[]>();
    segs.forEach((sg, i) => { for (const p of sg) { const k = key(p); (ends.get(k) ?? ends.set(k, []).get(k)!).push(i); } });
    const used = new Uint8Array(segs.length);
    const lines: XY[][] = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line: XY[] = [segs[i][0], segs[i][1]];
      for (const dir of [1, 0] as const) {
        for (;;) {
          const end = dir ? line[line.length - 1] : line[0];
          const next = (ends.get(key(end)) ?? []).find((j) => !used[j]);
          if (next === undefined) break;
          used[next] = 1;
          const [p, q] = segs[next];
          const far = key(p) === key(end) ? q : p;
          if (dir) line.push(far); else line.unshift(far);
        }
      }
      if (line.length >= 3) lines.push(line);
    }
    // one pass of corner cutting, the ends kept
    const smooth = (pts: XY[]): XY[] => {
      if (pts.length < 3) return pts;
      const o: XY[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1]; o.push({ x: 0.75 * p.x + 0.25 * q.x, y: 0.75 * p.y + 0.25 * q.y }, { x: 0.25 * p.x + 0.75 * q.x, y: 0.25 * p.y + 0.75 * q.y }); }
      o.push(pts[pts.length - 1]);
      return o;
    };
    out.push({ level, lines: lines.map(smooth) });
  }
  return out;
}

/** The band colours reliefDataUri prints on flat ground: `bands` steps from the paper toward `dark`, for the map's key. */
export function reliefBandColours(dark: string, bands: number, bandWeight = 0.62): string[] {
  const d = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
  return Array.from({ length: bands }, (_, k) => {
    const t = 1 - (k / Math.max(1, bands - 1)) * bandWeight;
    return `#${d.map((v) => Math.round(v + (255 - v) * t).toString(16).padStart(2, '0')).join('')}`;
  });
}

/** The hillshade, one byte a cell, lit from `azimuth` at `altitude`. */
export function hillshadeGrey(g: DemGrid, azimuth = 315, altitude = 45, zFactor = 1): Uint8Array {
  const zen = ((90 - altitude) * Math.PI) / 180;
  let azm = 360 - azimuth + 90; if (azm >= 360) azm -= 360;
  const az = (azm * Math.PI) / 180;
  const cx = g.cellX * g.groundPerUnit, cy = g.cellY * g.groundPerUnit;
  const flat = Math.cos(zen);
  const px = new Uint8Array(g.cols * g.rows);
  const at = (c: number, r: number) => {
    const v = g.values[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))];
    return Number.isFinite(v) ? v : NaN;
  };
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const a = at(c - 1, r - 1), b = at(c, r - 1), cc = at(c + 1, r - 1), d = at(c - 1, r), f = at(c + 1, r), gg = at(c - 1, r + 1), h = at(c, r + 1), i = at(c + 1, r + 1);
    if ([a, b, cc, d, f, gg, h, i].some((v) => Number.isNaN(v))) { px[r * g.cols + c] = 255; continue; }
    const dzdx = ((cc + 2 * f + i) - (a + 2 * d + gg)) / (8 * cx);
    const dzdy = ((gg + 2 * h + i) - (a + 2 * b + cc)) / (8 * cy);
    const slope = Math.atan(zFactor * Math.hypot(dzdx, dzdy));
    let aspect: number;
    if (dzdx !== 0) { aspect = Math.atan2(dzdy, -dzdx); if (aspect < 0) aspect += 2 * Math.PI; }
    else aspect = dzdy > 0 ? Math.PI / 2 : dzdy < 0 ? 1.5 * Math.PI : 0;
    const hs = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(az - aspect);
    px[r * g.cols + c] = Math.round(255 * Math.min(1, Math.max(0, hs / flat)));
  }
  return px;
}

export function hillshadeDataUri(g: DemGrid, azimuth = 315, altitude = 45, zFactor = 1): string {
  return pngDataUri(greyPng(g.cols, g.rows, hillshadeGrey(g, azimuth, altitude, zFactor)));
}

export interface Section {
  id: string;            // "A" — the ends are A and A′
  from: XY;              // Mercator
  to: XY;
  /** Bearing of travel from `from` to `to`, degrees clockwise from north. */
  bearing: number;
  lengthM: number;
}

export interface SectionSample { d: number; rl: number; site: boolean; water: boolean }

const bearingOf = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const bearingName = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** Clip the line through `c` with direction (dx, dy) to the extent; returns the parameters t of both ends. */
function clipLine(c: XY, dx: number, dy: number, e: Extent): [number, number] | null {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, q] of [[-dx, c.x - e.xmin], [dx, e.xmax - c.x], [-dy, c.y - e.ymin], [dy, e.ymax - c.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return t0 < t1 ? [t0, t1] : null;
}

/**
 * The section lines: A–A′ down the steepest fall at the site (or towards
 * the nearest water where the site is flat, or east–west failing that),
 * B–B′ across it, both through the site centre and spanning the window.
 */
export function planSections(g: DemGrid, centre: XY, extent: Extent, waterRings: number[][][]): { a: Section; b: Section; slope: { east: number; north: number } | null } {
  const grad = demGradient(g, centre.x, centre.y, 30);
  let dx = 1, dy = 0;
  const steep = grad && Math.hypot(grad.east, grad.north) >= 0.004;
  if (steep && grad) { const m = Math.hypot(grad.east, grad.north); dx = -grad.east / m; dy = -grad.north / m; }
  else {
    // Flat ground: run the long section towards the nearest water, if the window has any.
    let best: { d: number; x: number; y: number } | null = null;
    for (const ring of waterRings) for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 400))) {
      const p = lonLatToMercator({ lon: ring[i][0], lat: ring[i][1] });
      const d = Math.hypot(p.x - centre.x, p.y - centre.y);
      if (d > 1 && (!best || d < best.d)) best = { d, x: p.x, y: p.y };
    }
    if (best) { dx = (best.x - centre.x) / best.d; dy = (best.y - centre.y) / best.d; }
  }
  const make = (id: string, ux: number, uy: number): Section => {
    const t = clipLine(centre, ux, uy, extent) ?? [-1, 1];
    // Keep the ends a little inside the window so their labels fit.
    const inset = 12 / g.groundPerUnit;
    const from = { x: centre.x + ux * (t[0] + inset), y: centre.y + uy * (t[0] + inset) };
    const to = { x: centre.x + ux * (t[1] - inset), y: centre.y + uy * (t[1] - inset) };
    return { id, from, to, bearing: bearingOf(ux, uy), lengthM: Math.hypot(to.x - from.x, to.y - from.y) * g.groundPerUnit };
  };
  // A–A′ runs downhill; B–B′ from the left of that direction to the right.
  return { a: make('A', dx, dy), b: make('B', -dy, dx), slope: grad };
}

/** Elevations every `stepM` along a section, flagged where the line crosses the site and water. */
export function sampleSection(g: DemGrid, s: Section, siteRings: number[][][], waterRings: number[][][], stepM = 2.5): SectionSample[] {
  const n = Math.max(2, Math.round(s.lengthM / stepM));
  const out: SectionSample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = s.from.x + (s.to.x - s.from.x) * f, y = s.from.y + (s.to.y - s.from.y) * f;
    const rl = demAt(g, x, y);
    if (rl === undefined) continue;
    const ll = mercatorToLonLat({ x, y });
    const inside = (rings: number[][][]) => rings.some((r) => pointInRing(ll.lon, ll.lat, r));
    out.push({ d: f * s.lengthM, rl, site: inside(siteRings), water: inside(waterRings) });
  }
  return out;
}

export interface SiteLevels {
  /** The 2nd and 98th percentiles of the cells inside the site, so one odd cell at a boundary does not set the fall. */
  min: number; max: number;
  absoluteMin: number; absoluteMax: number;
  mean: number; cells: number;
  /** The site's length measured along the direction of the fall. */
  extentAlongFallM: number;
}

/** The levels of the cells inside the site, and the site's length along the fall direction. */
export function siteLevels(g: DemGrid, siteRings: number[][][], fall: { x: number; y: number } | null): SiteLevels | null {
  const zs: number[] = [];
  const merc = siteRings.map((r) => r.map(([lon, lat]) => { const m = lonLatToMercator({ lon, lat }); return [m.x, m.y]; }));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of merc) for (const [x, y] of r) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  if (!Number.isFinite(bx0)) return null;
  const c0 = Math.max(0, Math.floor((bx0 - g.xmin) / g.cellX)), c1 = Math.min(g.cols - 1, Math.ceil((bx1 - g.xmin) / g.cellX));
  const r0 = Math.max(0, Math.floor((g.ymax - by1) / g.cellY)), r1 = Math.min(g.rows - 1, Math.ceil((g.ymax - by0) / g.cellY));
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const x = g.xmin + (col + 0.5) * g.cellX, y = g.ymax - (row + 0.5) * g.cellY;
    if (!merc.some((r) => pointInRing(x, y, r))) continue;
    const z = g.values[row * g.cols + col];
    if (Number.isFinite(z)) zs.push(z);
  }
  if (zs.length < 2) {
    // A lot smaller than a cell: read its corners instead.
    for (const r of merc) for (const [x, y] of r) { const z = demAt(g, x, y); if (z !== undefined) zs.push(z); }
  }
  if (!zs.length) return null;
  let along = 0;
  if (fall) {
    let lo = Infinity, hi = -Infinity;
    for (const r of merc) for (const [x, y] of r) { const t = x * fall.x + y * fall.y; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    along = (hi - lo) * g.groundPerUnit;
  }
  zs.sort((a, b) => a - b);
  const q = (f: number) => zs[Math.min(zs.length - 1, Math.max(0, Math.round(f * (zs.length - 1))))];
  return { min: q(0.02), max: q(0.98), absoluteMin: zs[0], absoluteMax: zs[zs.length - 1], mean: zs.reduce((a, b) => a + b, 0) / zs.length, cells: zs.length, extentAlongFallM: along };
}

/** Where the grid is highest and lowest, and how far from a point that is. */
export function gridExtremes(g: DemGrid, from: XY): { max: { rl: number; distanceM: number; bearing: number }; min: { rl: number; distanceM: number; bearing: number } } {
  let iMax = -1, iMin = -1;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (!Number.isFinite(v)) continue;
    if (iMax < 0 || v > g.values[iMax]) iMax = i;
    if (iMin < 0 || v < g.values[iMin]) iMin = i;
  }
  const where = (i: number) => {
    const x = g.xmin + ((i % g.cols) + 0.5) * g.cellX, y = g.ymax - (Math.floor(i / g.cols) + 0.5) * g.cellY;
    return { rl: g.values[i], distanceM: Math.hypot(x - from.x, y - from.y) * g.groundPerUnit, bearing: bearingOf(x - from.x, y - from.y) };
  };
  return { max: where(iMax), min: where(iMin) };
}

/** The nearest vertex of any water polygon to a point: distance and direction. */
export function nearestWater(waterRings: number[][][], from: XY, groundPerUnit: number): { distanceM: number; bearing: number } | null {
  let best: { d: number; x: number; y: number } | null = null;
  for (const ring of waterRings) for (const [lon, lat] of ring) {
    const p = lonLatToMercator({ lon, lat });
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (!best || d < best.d) best = { d, x: p.x, y: p.y };
  }
  return best ? { distanceM: best.d * groundPerUnit, bearing: bearingOf(best.x - from.x, best.y - from.y) } : null;
}

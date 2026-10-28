// Patterns and tints painted into pictures. A map that draws a raster mask (the green
// of the aerial, the pre-1750 vegetation) through an SVG <mask> prints as a soft mask,
// which some PDF viewers fill solid. So the fill is painted into a PNG here, at three
// times the mask's resolution so the lines and dots stay crisp, and the map places the
// picture as it is. The land's shape goes the same way: the hillshade is multiplied
// into the picture's colours rather than blended over them on the page.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePng, encodeRgbaPng } from '../lib/png.js';
import { AERIAL_GREEN_FILL, VEG_1750_MAX, VEG_1750_OTHER, veg1750Fills, PATTERN_SCALE, PATTERN_WEIGHT, type Fill } from './atlasKit.js';
import { mercatorScaleFactor, mercatorToLonLat, type Extent } from '../lib/geo.js';
import { hillshadeGrey } from './terrainMap.js';
import { panelExtent } from './minimap.js';
import type { DemGrid } from '../fetch/terrain.js';

const UP = 3;
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Whether a point, in map millimetres, falls on a fill's pattern stroke. */
function onStroke(f: Fill, x: number, y: number): boolean {
  const step = (f.step ?? 0.8) * PATTERN_SCALE, w = (f.w ?? 0.18) * PATTERN_WEIGHT;
  const m = (v: number) => ((v % step) + step) % step;
  if (f.kind === 'vlines') return Math.abs(m(x) - step / 2) < w / 2;
  if (f.kind === 'hlines') return Math.abs(m(y) - step / 2) < w / 2;
  if (f.kind === 'dots') {
    const row = Math.floor(y / step), off = row % 2 ? step / 2 : 0;
    const cx = Math.floor((x - off) / step) * step + off + step / 2, cy = row * step + step / 2;
    return Math.hypot(x - cx, y - cy) < w;
  }
  if (f.kind === 'waves') { const amp = step / 3, yy = y - amp * Math.sin((x / (2 * step)) * 2 * Math.PI); return Math.abs(m(yy) - step / 2) < w / 2; }
  return false;
}

export interface PaintOptions {
  /** A ground laid under every layer over the whole picture, so nothing of it stays transparent. */
  ground?: string;
  /** The light on each point, 0 dark to 1 lit, by the picture's fractions across and down: every colour is multiplied by it, so the land's shape is in the picture itself and no viewer has a blend to get wrong. */
  shade?: (u: number, v: number) => number;
}

/**
 * Paint each mask with its fill: the ground where the mask is white, the pattern's strokes over it. `mmPerPx` is how
 * many map millimetres one mask pixel covers. Later layers paint over earlier ones; the rest stays transparent, unless
 * a ground is given.
 */
export async function paintMasks(dataDir: string, layers: { mask: string; fill: Fill }[], mmPerPx: number, out: string, opts: PaintOptions = {}): Promise<{ file: string; width: number; height: number } | null> {
  const masks = [];
  for (const l of layers) { const m = decodePng(new Uint8Array(await readFile(join(dataDir, l.mask)))); if (m) masks.push({ m, fill: l.fill }); }
  if (!masks.length) return null;
  const W = masks[0].m.width * UP, H = masks[0].m.height * UP, mm = mmPerPx / UP;
  const px = new Uint8Array(W * H * 4);
  const shade = opts.shade;
  const put = (k: number, c: number[], x: number, y: number) => {
    const s = shade ? shade(x / W, y / H) : 1;
    px[k] = Math.round(c[0] * s); px[k + 1] = Math.round(c[1] * s); px[k + 2] = Math.round(c[2] * s); px[k + 3] = 255;
  };
  if (opts.ground) {
    const g = rgb(opts.ground);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put((y * W + x) * 4, g, x, y);
  }
  for (const { m, fill } of masks) {
    const bg = fill.bg ? rgb(fill.bg) : null, ink = fill.ink ? rgb(fill.ink) : null;
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / UP);
      for (let x = 0; x < W; x++) {
        if (m.data[(sy * m.width + Math.floor(x / UP)) * 4] < 128) continue;
        const c = ink && onStroke(fill, x * mm, y * mm) ? ink : bg;
        if (!c) continue;
        put((y * W + x) * 4, c, x, y);
      }
    }
  }
  await writeFile(join(dataDir, out), encodeRgbaPng(W, H, px));
  return { file: out, width: W, height: H };
}

/** How dark a slope turned from the light goes on slide 15, and how much the gentle relief of a city is exaggerated to show it. */
const COUNTRY_SHADE = 0.55, COUNTRY_Z = 1.6;
/** The elevation model is smoothed this far (cells, each way) and this many times before the shading: the valleys and the ridges stay, the cuttings and the embankments of the modern city go. */
const COUNTRY_BLUR = 3, COUNTRY_BLUR_PASSES = 2;

/** The grid's values run through a box blur of `radius` cells, `passes` times, the cells without a value left out of every mean. */
function smoothed(g: DemGrid, radius: number, passes: number): DemGrid {
  let v = Float64Array.from(g.values);
  for (let pass = 0; pass < passes; pass++) {
    for (const horizontal of [true, false]) {
      const out = new Float64Array(v.length);
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        let sum = 0, n = 0;
        for (let d = -radius; d <= radius; d++) {
          const rr = horizontal ? r : r + d, cc = horizontal ? c + d : c;
          if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
          const x = v[rr * g.cols + cc];
          if (Number.isFinite(x)) { sum += x; n++; }
        }
        out[r * g.cols + c] = n && Number.isFinite(v[r * g.cols + c]) ? sum / n : NaN;
      }
      v = out;
    }
  }
  return { ...g, values: Array.from(v) };
}

/** The light over a picture of `extent` from the elevation model's hillshade, by the picture's fractions across and down; lit where the model has no cell. */
function demShade(dem: DemGrid, extent: Extent): (u: number, v: number) => number {
  const hs = hillshadeGrey(smoothed(dem, COUNTRY_BLUR, COUNTRY_BLUR_PASSES), 315, 45, COUNTRY_Z);
  return (u, v) => {
    const x = extent.xmin + u * (extent.xmax - extent.xmin), y = extent.ymax - v * (extent.ymax - extent.ymin);
    const col = Math.floor((x - dem.xmin) / dem.cellX), row = Math.floor((dem.ymax - y) / dem.cellY);
    if (col < 0 || row < 0 || col >= dem.cols || row >= dem.rows) return 1;
    return 1 - COUNTRY_SHADE * (1 - hs[row * dem.cols + col] / 255);
  };
}

/** The masks are read at this step (pixels) for the label spots: a community's edge to the metre is not the question, its room is. */
const SPOT_STEP = 4;

/**
 * Where a community's name can go: the cell of its mask, inside `window`, farthest from the community's edge (a
 * chamfer distance over the mask at a step, the window's edge counting as an edge), and that distance in metres.
 * Null when the community is off the window.
 */
function labelSpot(m: { width: number; height: number; data: Uint8Array }, extent: Extent, window: Extent, metresPerUnit: number): { x: number; y: number; clearM: number } | null {
  const D = SPOT_STEP, w = Math.ceil(m.width / D), h = Math.ceil(m.height / D);
  const ux = (extent.xmax - extent.xmin) / m.width, uy = (extent.ymax - extent.ymin) / m.height;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= w || r >= h ? 0 : d[r * w + c]);
  const d = new Float64Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const px = Math.min(m.width - 1, c * D + (D >> 1)), py = Math.min(m.height - 1, r * D + (D >> 1));
    const x = extent.xmin + (px + 0.5) * ux, y = extent.ymax - (py + 0.5) * uy;
    const inWindow = x >= window.xmin && x <= window.xmax && y >= window.ymin && y <= window.ymax;
    d[r * w + c] = inWindow && m.data[(py * m.width + px) * 4] >= 128 ? Infinity : 0;
  }
  // two passes of the 3-4 chamfer: the distance to the nearest cell outside, in thirds of a cell
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (d[r * w + c]) d[r * w + c] = Math.min(d[r * w + c], at(c - 1, r) + 3, at(c, r - 1) + 3, at(c - 1, r - 1) + 4, at(c + 1, r - 1) + 4);
  for (let r = h - 1; r >= 0; r--) for (let c = w - 1; c >= 0; c--) if (d[r * w + c]) d[r * w + c] = Math.min(d[r * w + c], at(c + 1, r) + 3, at(c, r + 1) + 3, at(c + 1, r + 1) + 4, at(c - 1, r + 1) + 4);
  let best = 0, bi = -1;
  for (let i = 0; i < d.length; i++) if (d[i] > best) { best = d[i]; bi = i; }
  if (bi < 0) return null;
  const c = bi % w, r = Math.floor(bi / w);
  return { x: extent.xmin + (c * D + D / 2) * ux, y: extent.ymax - (r * D + D / 2) * uy, clearM: (best / 3) * D * ux * metresPerUnit };
}

/** The painted pictures the slides place: the aerial's green on slide 10, the pre-1750 communities on slide 15 with the land's shape in them, and where each community's name can go. Kept on the bundle. */
export async function prepareRasters(sb: any, dataDir: string, bleedScale: number, countryScale: number): Promise<void> {
  const k = mercatorScaleFactor(mercatorToLonLat(sb.geocode.center).lat);
  const mmAcross = (e: { xmin: number; xmax: number }, scale: number) => (((e.xmax - e.xmin) / k) * 1000) / scale;
  const vm = sb.green?.vegetation;
  if (vm) {
    const r = await paintMasks(dataDir, [{ mask: vm.file, fill: AERIAL_GREEN_FILL }], mmAcross(vm.extent, bleedScale) / vm.pxWidth, 'vegetation_paint.png').catch(() => null);
    vm.paint = r?.file;
  }
  const veg = sb.country?.vegetation;
  if (veg?.image) {
    const classes = (veg.classes ?? []).filter((c: { mask?: string }) => c.mask).slice(0, VEG_1750_MAX);
    const fills = veg1750Fills(classes);
    const dem: DemGrid | null = sb.country?.dem ?? null;
    const r = await paintMasks(dataDir, classes.map((c: { mask: string }, i: number) => ({ mask: c.mask, fill: fills[i] })), mmAcross(veg.image.extent, countryScale) / veg.image.pxWidth, 'veg1750_paint.png',
      { ground: VEG_1750_OTHER, shade: dem ? demShade(dem, veg.image.extent) : undefined }).catch(() => null);
    veg.paint = r?.file;
    // where each name goes: the page's window, or the whole picture for a bundle kept before the page had its own panel
    const window: Extent = sb.countryPanel ? panelExtent({ ...sb.countryPanel, scale: countryScale }) : veg.image.extent;
    for (const c of classes as { mask: string; label?: { x: number; y: number; clearM: number } }[]) {
      const m = await readFile(join(dataDir, c.mask)).then((buf) => decodePng(new Uint8Array(buf))).catch(() => null);
      c.label = m ? labelSpot(m, veg.image.extent, window, 1 / k) ?? undefined : undefined;
    }
  }
}

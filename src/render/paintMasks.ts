// Patterns painted into pictures. A map that draws a raster mask (the green of the
// aerial, the pre-1750 vegetation) through an SVG <mask> prints as a soft mask, which
// some PDF viewers fill solid. So the pattern is painted into a transparent PNG here,
// at three times the mask's resolution so the lines and dots stay crisp, and the map
// places the picture as it is.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePng, encodeRgbaPng } from '../lib/png.js';
import { AERIAL_GREEN_FILL, VEG_1750_FILLS, PATTERN_SCALE, PATTERN_WEIGHT, type Fill } from './atlasKit.js';
import { mercatorScaleFactor, mercatorToLonLat } from '../lib/geo.js';

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

/**
 * Paint each mask with its fill: the ground where the mask is white, the pattern's strokes over it. `mmPerPx` is how
 * many map millimetres one mask pixel covers. Later layers paint over earlier ones; the rest stays transparent.
 */
export async function paintMasks(dataDir: string, layers: { mask: string; fill: Fill }[], mmPerPx: number, out: string): Promise<{ file: string; width: number; height: number } | null> {
  const masks = [];
  for (const l of layers) { const m = decodePng(new Uint8Array(await readFile(join(dataDir, l.mask)))); if (m) masks.push({ m, fill: l.fill }); }
  if (!masks.length) return null;
  const W = masks[0].m.width * UP, H = masks[0].m.height * UP, mm = mmPerPx / UP;
  const px = new Uint8Array(W * H * 4);
  for (const { m, fill } of masks) {
    const bg = fill.bg ? rgb(fill.bg) : null, ink = fill.ink ? rgb(fill.ink) : null;
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / UP);
      for (let x = 0; x < W; x++) {
        if (m.data[(sy * m.width + Math.floor(x / UP)) * 4] < 128) continue;
        const k = (y * W + x) * 4;
        const c = ink && onStroke(fill, x * mm, y * mm) ? ink : bg;
        if (!c) continue;
        px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
      }
    }
  }
  await writeFile(join(dataDir, out), encodeRgbaPng(W, H, px));
  return { file: out, width: W, height: H };
}

/** The painted pictures the slides place: the aerial's green on slide 10, the pre-1750 communities on slide 15. Kept on the bundle. */
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
    const classes = (veg.classes ?? []).filter((c: { mask?: string }) => c.mask).slice(0, VEG_1750_FILLS.length);
    const r = await paintMasks(dataDir, classes.map((c: { mask: string }, i: number) => ({ mask: c.mask, fill: VEG_1750_FILLS[i] })), mmAcross(veg.image.extent, countryScale) / veg.image.pxWidth, 'veg1750_paint.png').catch(() => null);
    veg.paint = r?.file;
  }
}

// Aerial imagery from NSW SIX Maps (public, no key). Exports the sheet extent
// as JPEG tiles; tiles are placed side by side in the HTML so no stitching
// library is needed.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Extent } from '../lib/geo.js';
import { retryFetch } from '../lib/http.js';
import { decodePng, encodeGreyPng } from '../lib/png.js';

const EXPORT = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export';
const MAX_PX = 4000; // stay under the service's export cap

export interface AerialTile {
  file: string;
  /** Fraction of the full extent covered by this tile. */
  left: number; top: number; width: number; height: number;
}

export interface AerialResult { tiles: AerialTile[]; pxWidth: number; pxHeight: number; /** The Web Mercator window the tiles cover, so a map at another scale can place them. */ extent?: Extent }

export async function fetchAerial(
  extent: Extent,
  targetPxWidth: number,
  outDir: string,
  /** File name prefix, so two sheets' tiles can share one data folder. */
  prefix = 'aerial',
): Promise<AerialResult> {
  await mkdir(outDir, { recursive: true });
  const aspect = (extent.ymax - extent.ymin) / (extent.xmax - extent.xmin);
  // Never request beyond the imagery's native resolution (~7.5cm in metro
  // NSW) — the export endpoint 500s on sub-resolution requests.
  const maxPx = Math.floor((extent.xmax - extent.xmin) / 0.09);
  const pxW = Math.min(targetPxWidth, maxPx);
  const pxH = Math.round(pxW * aspect);
  const cols = Math.ceil(pxW / MAX_PX);
  const rows = Math.ceil(pxH / MAX_PX);
  const tiles: AerialTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = extent.xmin + ((extent.xmax - extent.xmin) * c) / cols;
      const x1 = extent.xmin + ((extent.xmax - extent.xmin) * (c + 1)) / cols;
      // row 0 is the TOP of the image
      const y1 = extent.ymax - ((extent.ymax - extent.ymin) * r) / rows;
      const y0 = extent.ymax - ((extent.ymax - extent.ymin) * (r + 1)) / rows;
      const w = Math.round(pxW / cols);
      const h = Math.round(pxH / rows);
      // The export service rejects requests above a per-area pixel ceiling
      // (it 500s rather than clamping), and the ceiling varies by suburb —
      // so step the request down until it is accepted.
      let buf: Buffer | null = null;
      let rw = w, rh = h;
      for (let step = 0; step < 5 && !buf; step++) {
        const params = new URLSearchParams({
          bbox: `${x0},${y0},${x1},${y1}`,
          bboxSR: '3857',
          imageSR: '3857',
          size: `${Math.round(rw)},${Math.round(rh)}`,
          format: 'jpg',
          compressionQuality: '70',
          f: 'image',
        });
        try {
          const res = await retryFetch(`${EXPORT}?${params}`, {}, {
            attempts: step === 0 ? 3 : 2, timeoutMs: 120_000, label: 'aerial export',
          });
          if (res.ok) {
            const b = Buffer.from(await res.arrayBuffer());
            if (b.length >= 1000) buf = b;
          }
        } catch { /* fall through to a smaller request */ }
        if (!buf) { rw = Math.round(rw / 1.6); rh = Math.round(rh / 1.6); }
        if (rw < 500) break;
      }
      if (!buf) throw new Error('aerial imagery unavailable for this extent');
      const file = `${prefix}_${r}_${c}.jpg`;
      await writeFile(join(outDir, file), buf);
      tiles.push({ file, left: c / cols, top: r / rows, width: 1 / cols, height: 1 / rows });
    }
  }
  return { tiles, pxWidth: pxW, pxHeight: pxH, extent };
}

/** Where the aerial is green: trees, gardens and grass read from NSW Imagery itself, which no inventory misses. */
export interface VegetationMask { file: string; extent: Extent; pxWidth: number; pxHeight: number; sharePct: number; /** The mask painted with the slide's pattern (render/paintMasks.ts). */ paint?: string }

/**
 * The aerial over `extent` at about `mPerPx` a pixel, as PNG, and a greyscale mask of its green: a pixel is
 * vegetation where green leads red and blue and the pixel is not bright (roofs, paving and water are not).
 * The mask is opened and closed once so single pixels drop and canopies close.
 */
export async function fetchVegetationMask(extent: Extent, outDir: string, mPerPx = 0.8, groundPerUnit = 1): Promise<VegetationMask> {
  await mkdir(outDir, { recursive: true });
  const wM = (extent.xmax - extent.xmin) * groundPerUnit, hM = (extent.ymax - extent.ymin) * groundPerUnit;
  const pxW = Math.min(MAX_PX, Math.round(wM / mPerPx)), pxH = Math.min(MAX_PX, Math.round(hM / mPerPx));
  const params = new URLSearchParams({ bbox: `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`, bboxSR: '3857', imageSR: '3857', size: `${pxW},${pxH}`, format: 'png24', f: 'image' });
  const res = await retryFetch(`${EXPORT}?${params}`, {}, { attempts: 3, timeoutMs: 120_000, label: 'aerial for the vegetation mask' });
  if (!res.ok) throw new Error(`vegetation mask export ${res.status}`);
  const img = decodePng(new Uint8Array(await res.arrayBuffer()));
  if (!img) throw new Error('vegetation mask export did not decode');
  const { width: W, height: H, data } = img;
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const exg = 2 * g - r - b;
    m[i] = exg > 14 && g < 175 && g > r && g >= b ? 1 : 0;
  }
  const morph = (src: Uint8Array, keep: (n: number) => boolean) => {
    const out = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += src[(y + dy) * W + x + dx];
      out[y * W + x] = keep(n) ? 1 : 0;
    }
    return out;
  };
  m = morph(morph(m, (n) => n >= 4), (n) => n >= 3);
  const grey = new Uint8Array(W * H);
  let count = 0;
  for (let i = 0; i < W * H; i++) { grey[i] = m[i] ? 255 : 0; count += m[i]; }
  const file = 'vegetation_mask.png';
  await writeFile(join(outDir, file), encodeGreyPng(W, H, grey));
  return { file, extent, pxWidth: W, pxHeight: H, sharePct: Math.round((count / (W * H)) * 1000) / 10 };
}

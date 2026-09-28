// Aerial imagery from NSW SIX Maps (public, no key). Exports the sheet extent
// as JPEG tiles; tiles are placed side by side in the HTML so no stitching
// library is needed.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Extent } from '../lib/geo.js';
import { retryFetch } from '../lib/http.js';

const EXPORT = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/export';
const MAX_PX = 4000; // stay under the service's export cap

export interface AerialTile {
  file: string;
  /** Fraction of the full extent covered by this tile. */
  left: number; top: number; width: number; height: number;
}

export interface AerialResult { tiles: AerialTile[]; pxWidth: number; pxHeight: number }

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
  return { tiles, pxWidth: pxW, pxHeight: pxH };
}

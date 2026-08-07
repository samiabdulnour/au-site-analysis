// Aerial imagery from NSW SIX Maps (public, no key). Exports the sheet extent
// as JPEG tiles; tiles are placed side by side in the HTML so no stitching
// library is needed.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Extent } from '../lib/geo.js';

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
): Promise<AerialResult> {
  await mkdir(outDir, { recursive: true });
  const aspect = (extent.ymax - extent.ymin) / (extent.xmax - extent.xmin);
  const pxW = targetPxWidth;
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
      const params = new URLSearchParams({
        bbox: `${x0},${y0},${x1},${y1}`,
        bboxSR: '3857',
        imageSR: '3857',
        size: `${w},${h}`,
        format: 'jpg',
        f: 'image',
      });
      const res = await fetch(`${EXPORT}?${params}`, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`aerial export HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`aerial export returned ${buf.length} bytes`);
      const file = `aerial_${r}_${c}.jpg`;
      await writeFile(join(outDir, file), buf);
      tiles.push({ file, left: c / cols, top: r / rows, width: 1 / cols, height: 1 / rows });
    }
  }
  return { tiles, pxWidth: pxW, pxHeight: pxH };
}

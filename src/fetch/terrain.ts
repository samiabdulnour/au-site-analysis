// The ground: NSW's statewide 5 m elevation model (photogrammetric, DFSI
// 2019) through the SIX Maps image service, as one float GeoTIFF for the
// map window. One request brings the whole grid — point sampling on the
// same service takes twenty seconds a thousand points — and the grid then
// gives the hillshade, the sections, the site's levels and its fall.

import { retryFetch } from '../lib/http.js';
import { mercatorScaleFactor, mercatorToLonLat, type Extent } from '../lib/geo.js';

const DEM = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer';

export interface DemGrid {
  /** Web Mercator extent; cell (0, 0) is the north-west corner. */
  xmin: number; ymin: number; xmax: number; ymax: number;
  cols: number; rows: number;
  /** Cell size in Mercator units. */
  cellX: number; cellY: number;
  /** Ground metres per Mercator unit at the window's latitude. */
  groundPerUnit: number;
  /** Row-major from the north-west, metres AHD; NaN where the model has no value. */
  values: number[];
  min: number;
  max: number;
  source: string;
}

/** A single-band 32-bit float TIFF, tiled or stripped, uncompressed — what the image service exports. */
export function parseFloatTiff(b: Uint8Array): { width: number; height: number; data: Float32Array } | null {
  if (b.length < 8) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const le = b[0] === 0x49;
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) return null;
  const ifd = u32(4), n = u16(ifd);
  const tags = new Map<number, { type: number; count: number; off: number }>();
  for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), off: e + 8 }); }
  const vals = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) return [];
    const size = t.type === 3 ? 2 : t.type === 4 ? 4 : 1;
    const src = t.count * size <= 4 ? t.off : u32(t.off);
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) out.push(size === 2 ? u16(src + i * 2) : size === 4 ? u32(src + i * 4) : b[src + i]);
    return out;
  };
  const width = vals(256)[0], height = vals(257)[0];
  if (!width || !height) return null;
  if ((vals(259)[0] ?? 1) !== 1 || (vals(258)[0] ?? 32) !== 32 || (vals(339)[0] ?? 3) !== 3) return null;
  const data = new Float32Array(width * height).fill(NaN);
  const tw = vals(322)[0], th = vals(323)[0];
  if (tw && th) {
    const offs = vals(324), cnts = vals(325), tilesX = Math.ceil(width / tw);
    offs.forEach((o, t) => {
      const tx = t % tilesX, ty = Math.floor(t / tilesX), cnt = Math.floor(cnts[t] / 4);
      for (let i = 0; i < cnt; i++) {
        const x = tx * tw + (i % tw), y = ty * th + Math.floor(i / tw);
        if (x < width && y < height) data[y * width + x] = dv.getFloat32(o + i * 4, le);
      }
    });
  } else {
    const offs = vals(273), cnts = vals(279), rps = vals(278)[0] || height;
    offs.forEach((o, s) => {
      const cnt = Math.floor(cnts[s] / 4), base = s * rps * width;
      for (let i = 0; i < cnt && base + i < data.length; i++) data[base + i] = dv.getFloat32(o + i * 4, le);
    });
  }
  return { width, height, data };
}

/** The elevation model over `extent` at about `cellGroundM` metres a cell, or null when the service has nothing there. */
export async function fetchDemGrid(extent: Extent, cellGroundM = 2.5): Promise<DemGrid | null> {
  const lat = mercatorToLonLat({ x: (extent.xmin + extent.xmax) / 2, y: (extent.ymin + extent.ymax) / 2 }).lat;
  const k = mercatorScaleFactor(lat);
  const cols = Math.max(8, Math.min(4000, Math.round((extent.xmax - extent.xmin) / (cellGroundM * k))));
  const rows = Math.max(8, Math.min(4000, Math.round((extent.ymax - extent.ymin) / (cellGroundM * k))));
  const url = `${DEM}/exportImage?` + new URLSearchParams({
    bbox: `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`, bboxSR: '3857', imageSR: '3857', size: `${cols},${rows}`,
    format: 'tiff', pixelType: 'F32', interpolation: 'RSP_BilinearInterpolation', f: 'image',
  });
  const res = await retryFetch(url, {}, { attempts: 3, timeoutMs: 90_000, label: 'elevation model' });
  if (!res.ok) throw new Error(`elevation model HTTP ${res.status}`);
  const tiff = parseFloatTiff(new Uint8Array(await res.arrayBuffer()));
  if (!tiff) return null;
  const values = new Array<number>(tiff.data.length);
  let min = Infinity, max = -Infinity, valid = 0;
  for (let i = 0; i < tiff.data.length; i++) {
    const v = tiff.data[i];
    // The service marks no-data with the float minimum; nothing in NSW is below the Dead Sea.
    if (!Number.isFinite(v) || v < -500) { values[i] = NaN; continue; }
    const r = Math.round(v * 100) / 100;
    values[i] = r; valid++;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  if (!valid) return null;
  return {
    xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax,
    cols: tiff.width, rows: tiff.height,
    cellX: (extent.xmax - extent.xmin) / tiff.width, cellY: (extent.ymax - extent.ymin) / tiff.height,
    groundPerUnit: 1 / k, values, min, max,
    source: 'NSW 5 m elevation model (stereo imagery, DFSI 2019) via SIX Maps',
  };
}

/** The elevation at a Mercator point, bilinear between cell centres; undefined off the grid or over no-data. */
export function demAt(g: DemGrid, x: number, y: number): number | undefined {
  const fx = (x - g.xmin) / g.cellX - 0.5, fy = (g.ymax - y) / g.cellY - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const at = (cx: number, cy: number) => {
    const xx = Math.min(g.cols - 1, Math.max(0, cx)), yy = Math.min(g.rows - 1, Math.max(0, cy));
    return g.values[yy * g.cols + xx];
  };
  if (fx < -0.5 || fy < -0.5 || fx > g.cols - 0.5 || fy > g.rows - 0.5) return undefined;
  const tx = fx - x0, ty = fy - y0;
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  if ([a, b, c, d].some((v) => !Number.isFinite(v))) {
    const nearest = at(Math.round(fx), Math.round(fy));
    return Number.isFinite(nearest) ? nearest : undefined;
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * The ground's gradient around a point, in metres of rise per ground metre
 * eastwards and northwards: a plane fitted by least squares to every cell
 * within `radiusGroundM`, so a few noisy cells do not swing it.
 */
export function demGradient(g: DemGrid, x: number, y: number, radiusGroundM = 25): { east: number; north: number } | null {
  const r = radiusGroundM / g.groundPerUnit;
  const c0 = Math.max(0, Math.floor((x - r - g.xmin) / g.cellX)), c1 = Math.min(g.cols - 1, Math.ceil((x + r - g.xmin) / g.cellX));
  const r0 = Math.max(0, Math.floor((g.ymax - (y + r)) / g.cellY)), r1 = Math.min(g.rows - 1, Math.ceil((g.ymax - (y - r)) / g.cellY));
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const z = g.values[row * g.cols + col];
    if (!Number.isFinite(z)) continue;
    const px = (g.xmin + (col + 0.5) * g.cellX - x) * g.groundPerUnit, py = (g.ymax - (row + 0.5) * g.cellY - y) * g.groundPerUnit;
    if (px * px + py * py > radiusGroundM * radiusGroundM) continue;
    n++; sx += px; sy += py; sz += z; sxx += px * px; syy += py * py; sxy += px * py; sxz += px * z; syz += py * z;
  }
  if (n < 6) return null;
  // Normal equations for z = a x + b y + c, with the means removed.
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  if (Math.abs(det) < 1e-9) return null;
  return { east: (cxz * cyy - cyz * cxy) / det, north: (cyz * cxx - cxz * cxy) / det };
}

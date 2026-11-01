// Tree crowns read off the aerial.
//
// No inventory holds the trees of most streets, and OpenStreetMap maps a few
// of them with no size. The photograph does show them: the mask of its green
// (fetch/imagery.ts) is a map of the canopy, and a canopy is drawn as crowns by
// peeling discs off it — the widest disc the canopy holds first, then the
// widest of what is left, down to a disc too small to be a tree. A line of
// street trees comes out as a chain of crowns, a park's canopy as a crowd of
// them. A lawn is green too, but flat: a crown is only read where the
// photograph has the light and shade of a canopy (its local contrast), so a
// lawn or a green roof gives none.

import type { Extent } from './geo.js';
import { lonLatToMercator, mercatorToLonLat } from './geo.js';

export interface Crown { x: number; y: number; r: number }

/** A tree the yield draws: a crown read off the photograph, or one recorded by a council or OpenStreetMap. */
export interface YieldTree {
  lon: number;
  lat: number;
  /** Crown diameter, metres. */
  canopyM: number;
  /** 'aerial' where the crown is read off the photograph's green; 'osm' or a council inventory's id where the tree is recorded. */
  source: string;
}

/**
 * The exact Euclidean distance transform (Felzenszwalb & Huttenlocher): each
 * masked pixel's distance to the nearest unmasked one, in pixels; the image's
 * edge counts as unmasked, so a canopy cut by the frame is not read as deeper
 * than it is.
 */
export function distanceTransform(mask: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e10;
  const f = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f[y * W + x] = mask[y * W + x] && x > 0 && y > 0 && x < W - 1 && y < H - 1 ? INF : 0;
  const n = Math.max(W, H);
  const g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const dt1d = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
  };
  // columns, then rows
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) g[y] = f[y * W + x];
    dt1d(H);
    for (let y = 0; y < H; y++) f[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) g[x] = f[y * W + x];
    dt1d(W);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * Crowns peeled off a mask: the widest disc the mask holds, then the widest of
 * what it leaves, each at least `minR` and at most `maxR` pixels across its
 * radius. A new crown's centre must stand clear of the ones placed (by
 * `spacing` of their radius, the whole disc unless set lower): a disc centred
 * inside a placed crown adds nothing of the canopy but the grid's slack, and
 * would draw one tree twice; the next crown of a wide canopy starts at the
 * last one's edge and reaches past it, so they overlap as a canopy does.
 */
export function crownsFromMask(mask: Uint8Array, W: number, H: number, opts: { minR: number; maxR: number; spacing?: number }): Crown[] {
  const spacing = opts.spacing ?? 1;
  const dt = distanceTransform(mask, W, H);
  const cand: number[] = [];
  for (let i = 0; i < W * H; i++) if (dt[i] >= opts.minR) cand.push(i);
  cand.sort((a, b) => dt[b] - dt[a]);
  const taken = new Uint8Array(W * H);
  const out: Crown[] = [];
  for (const i of cand) {
    if (taken[i]) continue;
    const r = Math.min(dt[i], opts.maxR), x = i % W, y = (i - x) / W;
    out.push({ x, y, r });
    const keep = r * spacing, k2 = keep * keep, R = Math.ceil(keep);
    for (let dy = -R; dy <= R; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W || dx * dx + dy * dy > k2) continue;
        taken[yy * W + xx] = 1;
      }
    }
  }
  return out;
}

/** The local contrast of a greyscale image: the standard deviation of a (2·half+1)² window about each pixel, 0–255. */
export function localContrast(lum: Uint8Array, W: number, H: number, half = 2): Uint8Array {
  // summed-area tables of the value and its square
  const S = new Float64Array((W + 1) * (H + 1)), Q = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let rs = 0, rq = 0;
    for (let x = 1; x <= W; x++) {
      const v = lum[(y - 1) * W + x - 1];
      rs += v; rq += v * v;
      S[y * (W + 1) + x] = S[(y - 1) * (W + 1) + x] + rs;
      Q[y * (W + 1) + x] = Q[(y - 1) * (W + 1) + x] + rq;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - half), x1 = Math.min(W, x + half + 1), y0 = Math.max(0, y - half), y1 = Math.min(H, y + half + 1);
    const n = (x1 - x0) * (y1 - y0);
    const sum = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
    const sq = Q[y1 * (W + 1) + x1] - Q[y0 * (W + 1) + x1] - Q[y1 * (W + 1) + x0] + Q[y0 * (W + 1) + x0];
    const mean = sum / n;
    out[y * W + x] = Math.min(255, Math.round(Math.sqrt(Math.max(0, sq / n - mean * mean))));
  }
  return out;
}

/** The mask kept where each pixel has at least `n` set among itself and its eight neighbours: a wash (n = 2–3) closes a canopy, a tighter count (5–6) drops specks. */
export function morph(mask: Uint8Array, W: number, H: number, n: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += mask[(y + dy) * W + x + dx];
    out[y * W + x] = c >= n ? 1 : 0;
  }
  return out;
}

/**
 * The trees of a photograph: its green where the photograph has a canopy's
 * light and shade, read as crowns and placed on the ground. A crown within
 * `clearM` of a recorded tree is that tree, and the recorded one is kept.
 */
export function treesFromAerial(
  px: { width: number; height: number; extent: Extent; mPerPx: number; green: Uint8Array; contrast: Uint8Array },
  known: { lon: number; lat: number; canopyM: number; source: string }[] = [],
  opts: { minCanopyM?: number; maxCanopyM?: number; contrast?: number; clearM?: number } = {},
): YieldTree[] {
  const { width: W, height: H } = px;
  const minR = (opts.minCanopyM ?? 3) / 2 / px.mPerPx, maxR = (opts.maxCanopyM ?? 14) / 2 / px.mPerPx, gate = opts.contrast ?? 16;
  let m: Uint8Array = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = px.green[i] && px.contrast[i] >= gate ? 1 : 0;
  m = morph(morph(m, W, H, 3), W, H, 4);
  const crowns = crownsFromMask(m, W, H, { minR, maxR });
  const e = px.extent, sx = (e.xmax - e.xmin) / W, sy = (e.ymax - e.ymin) / H;
  const out: YieldTree[] = known.map((t) => ({ lon: t.lon, lat: t.lat, canopyM: t.canopyM, source: t.source }));
  const clear = opts.clearM ?? 3;
  const clearPx = clear / px.mPerPx;
  // the recorded trees in pixel space, to keep a read crown off them
  const kpx = known.map((t) => { const [mx, my] = lonLatToPx(t.lon, t.lat); return { x: mx, y: my }; });
  function lonLatToPx(lon: number, lat: number): [number, number] {
    const m = lonLatToMercator({ lon, lat });
    return [(m.x - e.xmin) / sx, (e.ymax - m.y) / sy];
  }
  for (const c of crowns) {
    if (kpx.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < clearPx)) continue;
    const ll = mercatorToLonLat({ x: e.xmin + (c.x + 0.5) * sx, y: e.ymax - (c.y + 0.5) * sy });
    out.push({ lon: Math.round(ll.lon * 1e6) / 1e6, lat: Math.round(ll.lat * 1e6) / 1e6, canopyM: Math.round(2 * c.r * px.mPerPx * 10) / 10, source: 'aerial' });
  }
  return out;
}

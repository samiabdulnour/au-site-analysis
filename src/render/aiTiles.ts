// The streetscape's elevations through an image model and back: Artlist's
// Nano Banana Pro, or any model that edits a picture in place.
//
// A face is far wider than any model's frame (190 m by 30 m against 21:9 at
// most), and a model given a frame with room to spare fills it: asked to
// sharpen a strip of street under a band of sky, it repeated the street in
// the sky, or zoomed it until it filled the frame. So the face is cut into
// tiles of the model's own shape, each as tall as the street it holds stands
// (its ground to just over its roofs), so the street fills it, overlapping,
// and each tile's box in the elevation's pixels is written down
// (`ai/manifest.json`, with the prompt to ask). What comes back is checked
// against its tile: one that built on its sky is refused, and the face keeps
// its own picture there; one that kept the street is put back where it
// slipped to (models nudge a picture by a few pixels), scaled into its box so
// a metre is still a metre, and faded into its neighbour over their overlap.
// Given the photographs on the meshes, the model keeps the real facades
// (signs, murals, windows) and redraws the trees, the seams and what no
// photograph saw; given the meshes alone, it invents the facades the meshes
// blur, and the drawing says which it had.
//
// The models are reached through Artlist's connector, which a Claude session
// holds and this process does not, so the round trip is three steps:
// `scripts/streetscape-ai.ts export`, the tiles through the model, and
// `scripts/streetscape-ai.ts import`, which draws the sheet again as
// STREETSCAPE_AI.pdf beside the measured one.

import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './pdf.js';
import type { Elevation } from './elevation3d.js';

/** The model's widest frame, width over height. */
export const AI_ASPECT = 21 / 9;
/** How much neighbouring tiles share, metres: the width the fade runs over. */
export const AI_OVERLAP_M = 8;
/** The most of a tile's sky an answer may build on: one that fills the sky has redrawn the street, not cleaned it. */
export const AI_MAX_FILL = 0.25;
/** What the model is asked, tile by tile. */
export const AI_PROMPT = 'Make this one crisp, consistent photograph of the same street elevation. Keep the photographed facades exactly as they are, with their real windows, doors, signs and shopfronts; only clean up the seams, the colour differences between patches and the blurry, melted 3D-scan parts (roofs, trees, upper floors) into sharp realistic surfaces and natural leafy street trees. Keep the exact framing and scale: every building, roofline, window, tree and the ground line stays exactly where and as large as it is. The plain pale grey areas are open sky: leave them empty and pale grey. Do not zoom, crop, stretch, repeat, add or remove anything; keep the flat straight-on view.';
/** The ground band under the street and the room over its roofs that a tile keeps, metres. */
const BELOW_M = 1.5, ABOVE_M = 1.5;
/** The least a tile stands over its highest ground, metres: a run of low walls and gaps still gets a frame a model can read. */
const MIN_STREET_M = 8;
/** How far an answer may have slipped against its tile and still be put back, as a share of the tile's width and height. */
const SLIP = 0.03;

export interface AiTile { n: number; file: string; x0: number; y0: number; x1: number; y1: number }
/** A face's tiles, and the width neighbouring ones fade into each other over (pixels). */
export interface AiFace { side: 1 | -1; elevation: string; overlap: number; tiles: AiTile[] }
export interface AiManifest { aspect: string; prompt: string; faces: AiFace[] }
/** A face laid back: its new picture, the tiles laid on it, those refused, and how far each laid one had slipped (pixels). */
export interface AiLaid { side: 1 | -1; file: string; tiles: number; of: number; refused: { file: string; fill: number }[]; slips: { file: string; dx: number; dy: number }[] }

type TileFace = Pick<Elevation, 'width' | 'height' | 'ppm' | 'zTop' | 'ground' | 'tops' | 'side' | 'sAtLeft' | 'sAtRight'>;

/**
 * The tiles of a face, left to right in the elevation's pixels: each the shortest that holds its run, from just under
 * its lowest ground to just over its roofs (the 98th percentile of its metres' tops), as wide as the model's frame
 * makes that; the next starts AI_OVERLAP_M before it ends, and the last ends at the face's end.
 */
export function planAiTiles(e: TileFace, aspect = AI_ASPECT): AiTile[] {
  const x = (s: number) => ((s - e.sAtLeft) / (e.sAtRight - e.sAtLeft)) * e.width;
  const y = (z: number) => Math.min(e.height, Math.max(0, Math.round((e.zTop - z) * e.ppm)));
  const tops = e.tops.map((t) => ({ x: x(t.s), z: t.z })), ground = e.ground.map((g) => ({ x: x(g.s), z: g.z }));
  const band = (a: number, b: number) => {
    const near = ground.filter((g) => g.x >= a - e.ppm && g.x <= b + e.ppm).map((g) => g.z);
    const zs = near.length ? near : ground.map((g) => g.z);
    const ts = tops.filter((t) => t.x >= a && t.x <= b).map((t) => t.z).sort((m, n) => m - n);
    const roof = Math.max(ts[Math.floor((ts.length - 1) * 0.98)] ?? -Infinity, Math.max(...zs) + MIN_STREET_M);
    return { y0: y(roof + ABOVE_M), y1: y(Math.min(...zs) - BELOW_M) };
  };
  // a tile's width is its height in the model's shape, and the height it needs is what stands in that width; a wider
  // run never stands lower, so the first height that holds its own run is the tile that fits the street there closest
  const fit = (edge: number, leftward: boolean, least = 0) => {
    const run = (w: number): [number, number] => (leftward ? [edge - w, edge] : [edge, edge + w]);
    let h = Math.max(Math.round((MIN_STREET_M + ABOVE_M + BELOW_M) * e.ppm), Math.ceil(least / aspect));
    let b = band(...run(Math.round(h * aspect)));
    while (b.y1 - b.y0 > h && h < e.height) b = band(...run(Math.round(++h * aspect)));
    const w = Math.min(e.width, Math.round(h * aspect)), y0 = Math.max(0, b.y1 - h);
    const x0 = leftward ? edge - w : edge;
    return { x0, x1: x0 + w, y0, y1: y0 + h };
  };
  const overlap = Math.round(AI_OVERLAP_M * e.ppm);
  const boxes = [fit(0, false)];
  while (boxes[boxes.length - 1].x1 < e.width) {
    const last = boxes[boxes.length - 1];
    const from = Math.max(last.x1 - overlap, last.x0 + 1), next = fit(from, false);
    if (next.x1 < e.width) { boxes.push(next); continue; }
    // the last runs back from the face's end at least as far as the overlap with the one before, or, where a tile
    // reaching back over that one too stands little taller (or that one would be all but hidden), takes its place
    const alone = fit(e.width, true, e.width - from), before = boxes[boxes.length - 2];
    const both = fit(e.width, true, e.width - (before ? Math.max(before.x1 - overlap, before.x0 + 1) : 0));
    const hidden = alone.x0 - (before ? before.x1 : 0) < overlap, taller = (both.y1 - both.y0) / (alone.y1 - alone.y0);
    if (taller <= 1.25 || (hidden && taller <= 1.5)) boxes[boxes.length - 1] = both;
    else boxes.push(alone);
  }
  const face = e.side > 0 ? 'l' : 'r';
  return boxes.map((b, i) => ({ n: i + 1, file: `ai/${face}_${i + 1}.png`, ...b }));
}

/** A page with nothing but a canvas, its files served from `dataDir`. */
async function canvasPage<T>(dataDir: string, fn: (page: import('playwright-core').Page) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // tsx names the functions it compiles with a helper of its own, which code handed to the page still calls
    await page.addInitScript({ content: 'window.__name = (f) => f;' });
    await page.route('http://canvas.local/**', async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' });
      if (path.includes('..')) return route.fulfill({ status: 404 });
      try {
        const body = await readFile(join(dataDir, path.slice(1)));
        return route.fulfill({ contentType: path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg', body });
      } catch { return route.fulfill({ status: 404 }); }
    });
    await page.goto('http://canvas.local/');
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Each face's tiles, cut from its elevation into `data/ai/`, and the manifest that places them. An earlier cut, with
 * any answers to it, is moved aside whole to `data/ai-<when>/`: an answer only ever lies on the tile it was cut from.
 */
export async function exportAiTiles(elevations: (Elevation | null)[], dataDir: string): Promise<AiManifest> {
  const dir = join(dataDir, 'ai');
  try {
    await rename(dir, `${dir}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(dir, { recursive: true });
  const faces: AiFace[] = elevations.filter((e): e is Elevation => !!e).map((e) => ({ side: e.side, elevation: e.file, overlap: Math.round(AI_OVERLAP_M * e.ppm), tiles: planAiTiles(e) }));
  await canvasPage(dataDir, async (page) => {
    for (const f of faces) {
      const pngs = await page.evaluate(async ({ src, tiles }) => {
        const img = new Image();
        img.src = '/' + src;
        await img.decode();
        return tiles.map((t) => {
          const c = document.createElement('canvas');
          c.width = t.x1 - t.x0; c.height = t.y1 - t.y0;
          c.getContext('2d')!.drawImage(img, t.x0, t.y0, c.width, c.height, 0, 0, c.width, c.height);
          return c.toDataURL('image/png');
        });
      }, { src: f.elevation, tiles: f.tiles });
      for (const [i, t] of f.tiles.entries()) await writeFile(join(dataDir, t.file), Buffer.from(pngs[i].split(',')[1], 'base64'));
    }
  });
  const manifest: AiManifest = { aspect: '21:9', prompt: AI_PROMPT, faces };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** The model's answer for a tile, where there is one: `ai/<face>_<n>.ai.png` (or .jpg, .webp). */
async function answerFor(dataDir: string, t: AiTile): Promise<string | null> {
  for (const ext of ['png', 'jpg', 'webp']) {
    const f = t.file.replace(/\.png$/, `.ai.${ext}`);
    try { await access(join(dataDir, f)); return f; } catch { /* the next */ }
  }
  return null;
}

/**
 * The model's tiles laid back on their faces. Each answer is checked against its tile first: one that built on more
 * than AI_MAX_FILL of the tile's sky is refused; the rest are scaled into their boxes, moved back by however far
 * they slipped (the shift that best lays their edges on the tile's), crossfaded with the tile before over the face's
 * fade width where it ends, faded out at the right only where no answer follows, and into what is under their top.
 * Writes `elevation_<face>_ai.jpg` where any tile was laid.
 */
export async function importAiTiles(manifest: AiManifest, dataDir: string, background: string): Promise<AiLaid[]> {
  const out: AiLaid[] = [];
  await canvasPage(dataDir, async (page) => {
    for (const f of manifest.faces) {
      const answers = await Promise.all(f.tiles.map((t) => answerFor(dataDir, t)));
      const back = f.tiles.map((t, i) => ({ ...t, answer: answers[i] })).filter((t): t is AiTile & { answer: string } => !!t.answer);
      if (!back.length) { out.push({ side: f.side, file: f.elevation, tiles: 0, of: f.tiles.length, refused: [], slips: [] }); continue; }
      const r = await page.evaluate(async ({ src, tiles, all, fade, background, maxFill, slip }) => {
        const load = async (u: string) => { const im = new Image(); im.src = '/' + u; await im.decode(); return im; };
        const pixels = (im: HTMLImageElement, w: number, h: number) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const x = c.getContext('2d')!;
          x.imageSmoothingQuality = 'high';
          x.drawImage(im, 0, 0, w, h);
          return x.getImageData(0, 0, w, h).data;
        };
        // a picture's edges: how much its brightness changes to the right and down
        const edges = (d: Uint8ClampedArray, w: number, h: number) => {
          const g = new Float32Array(w * h), e = new Float32Array(w * h);
          for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
          for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) e[y * w + x] = Math.abs(g[y * w + x + 1] - g[y * w + x]) + Math.abs(g[(y + 1) * w + x] - g[y * w + x]);
          return e;
        };
        // how well the answer's edges, moved by (dx, dy), lie on the tile's, over all but a margin of m
        const fit = (a: Float32Array, b: Float32Array, w: number, h: number, m: number, dx: number, dy: number) => {
          let ab = 0, aa = 0, bb = 0;
          for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
            const p = a[y * w + x], q = b[(y - dy) * w + x - dx];
            ab += p * q; aa += p * p; bb += q * q;
          }
          return ab / Math.sqrt(aa * bb || 1);
        };
        const best = (a: Float32Array, b: Float32Array, w: number, h: number, mx: number, my: number, cx = 0, cy = 0, r = Infinity) => {
          let top = { dx: 0, dy: 0, c: -1 };
          const m = Math.max(mx, my) + 1;
          for (let dy = Math.max(-my, cy - r); dy <= Math.min(my, cy + r); dy++) for (let dx = Math.max(-mx, cx - r); dx <= Math.min(mx, cx + r); dx++) {
            const c = fit(a, b, w, h, m, dx, dy);
            if (c > top.c) top = { dx, dy, c };
          }
          return top;
        };
        const sky = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
        const isSky = (d: Uint8ClampedArray, i: number) => Math.hypot(d[i * 4] - sky[0], d[i * 4 + 1] - sky[1], d[i * 4 + 2] - sky[2]) < 14;

        const base = await load(src);
        const c = document.createElement('canvas');
        c.width = base.naturalWidth; c.height = base.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(base, 0, 0);
        const refused: { file: string; fill: number }[] = [], slips: { file: string; dx: number; dy: number }[] = [];
        const checked: { t: (typeof tiles)[number]; answer: HTMLImageElement; w: number; h: number; dx: number; dy: number }[] = [];
        for (const t of tiles) {
          const w = t.x1 - t.x0, h = t.y1 - t.y0;
          const [tile, answer] = await Promise.all([load(t.file), load(t.answer)]);
          // the sky the answer built on, over a coarse grid of the tile
          const gw = 112, gh = Math.max(8, Math.round((gw * h) / w));
          const ti = pixels(tile, gw, gh), an = pixels(answer, gw, gh);
          let open = 0, built = 0;
          for (let i = 0; i < gw * gh; i++) if (isSky(ti, i)) { open++; if (!isSky(an, i)) built++; }
          const fill = open ? built / open : 0;
          if (fill > maxFill) { refused.push({ file: t.answer, fill }); continue; }
          // where it slipped to: found on a quarter-size copy, then to the pixel
          const qw = Math.round(w / 4), qh = Math.round(h / 4);
          const coarse = best(edges(pixels(tile, qw, qh), qw, qh), edges(pixels(answer, qw, qh), qw, qh), qw, qh, Math.ceil((slip * w) / 4), Math.ceil((slip * h) / 4));
          const ea = edges(pixels(tile, w, h), w, h), eb = edges(pixels(answer, w, h), w, h);
          const fine = best(ea, eb, w, h, Math.ceil(slip * w) + 4, Math.ceil(slip * h) + 4, coarse.dx * 4, coarse.dy * 4, 3);
          checked.push({ t, answer, w, h, dx: fine.dx, dy: fine.dy });
          slips.push({ file: t.answer, dx: fine.dx, dy: fine.dy });
        }
        const laid = checked.map((k) => k.t.n);
        for (const { t, answer, w, h, dx, dy } of checked) {
          const layer = document.createElement('canvas');
          layer.width = w; layer.height = h;
          const lc = layer.getContext('2d')!;
          lc.drawImage(answer, dx, dy, w, h);
          // over the tile before: hidden under it, then in over the fade's width up to its end where it was laid (the
          // one before stays whole to its end), or in from the tile's own start where it was not; out at the end only
          // where no answer follows to cover it
          const before = all.filter((o) => o.n !== t.n && o.x0 < t.x0 && o.x1 > t.x0), after = all.filter((o) => o.n !== t.n && o.x1 > t.x1 && o.x0 < t.x1);
          const left = before.reduce((m, o) => Math.max(m, o.x1 - t.x0), 0), fl = Math.min(left, fade);
          const fr = after.some((o) => !laid.includes(o.n)) ? Math.min(after.reduce((m, o) => Math.max(m, t.x1 - o.x0), 0), fade) : 0;
          const [a0, a1] = before.some((o) => laid.includes(o.n)) ? [left - fl, left] : [0, fl];
          lc.globalCompositeOperation = 'destination-in';
          const gx = lc.createLinearGradient(0, 0, w, 0);
          const at = (px: number) => Math.min(1, Math.max(0, px / w));
          gx.addColorStop(at(a0), fl ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
          gx.addColorStop(at(a1), 'rgba(0,0,0,1)');
          gx.addColorStop(Math.max(at(a1), at(w - fr)), 'rgba(0,0,0,1)');
          gx.addColorStop(1, fr ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)');
          lc.fillStyle = gx;
          lc.fillRect(0, 0, w, h);
          const gy = lc.createLinearGradient(0, 0, 0, h);
          gy.addColorStop(0, 'rgba(0,0,0,0)');
          gy.addColorStop(Math.min(0.2, 24 / h), 'rgba(0,0,0,1)');
          gy.addColorStop(1, 'rgba(0,0,0,1)');
          lc.fillStyle = gy;
          lc.fillRect(0, 0, w, h);
          ctx.drawImage(layer, t.x0, t.y0);
        }
        // the sheet's sky under anything a fade left thin
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, c.width, c.height);
        return { jpeg: checked.length ? c.toDataURL('image/jpeg', 0.9) : '', refused, slips };
      }, { src: f.elevation, tiles: back, all: f.tiles, fade: f.overlap, background, maxFill: AI_MAX_FILL, slip: SLIP });
      const tiles = r.slips.length;
      const file = tiles ? f.elevation.replace(/\.jpg$/, '_ai.jpg') : f.elevation;
      if (tiles) await writeFile(join(dataDir, file), Buffer.from(r.jpeg.split(',')[1], 'base64'));
      out.push({ side: f.side, file, tiles, of: f.tiles.length, refused: r.refused, slips: r.slips });
    }
  });
  return out;
}

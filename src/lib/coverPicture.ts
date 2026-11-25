// The cover's picture: the trees of the place as a speckle.
//
// Every tree a deck holds (the crowns read off the aerial's green, lib/crowns.ts,
// and the trees a council or OpenStreetMap records) is a fleck of its own, the
// site in the middle, drawn at 1:2000 in cells of half a millimetre: a small
// tree a dot of the heart of its crown, a tree six metres across or more the
// lit side of its crown, a crescent open away from the light. A blue-grey
// speckle on a pale sage ground: the grain of the place, not a map of it. A
// street's trees fall in a line, a garden's in a cluster, a reserve's in a
// field of crescents, and the ground between the crowns stays open, where the
// canopy drawn whole ran together into patches.
//
// A deck with no crowns but a reading of the aerial's green has the crowns
// read off that (crownsFromMask) and drawn the same way.
//
// The cells are traced into one outline, so the picture is a single vector
// shape: no raster for a viewer to smooth, no seams between the squares, and a
// style that prints in black and white inks it in its own greys.

import { crownsFromMask } from './crowns.js';

/** The picture's ground and its trees. */
export const COVER_GROUND = '#e3ebe4';
export const COVER_CANOPY = '#c4cbd6';
/** A cell on paper, mm, and the scale the picture is drawn at where the trees reach that far. */
export const COVER_CELL_MM = 0.5;
export const COVER_SCALE = 2000;
/** The field's size on paper, mm: as wide as the slides cover's picture, as tall as the booklet front's. */
export const COVER_FIELD = { w: 312, h: 204 };
/** A crown this wide or wider, m, is drawn as its lit side; a smaller one as a dot `COVER_HEART` of its width. */
export const COVER_CRESCENT_M = 6;
export const COVER_HEART = 0.6;
/** Toward the light, on a picture with north up (x east, y south): the north-west, an afternoon's sun in New South Wales. */
const LIGHT = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
/** A crescent: the crown less the disc of its shade, that disc `SHADE.r` of the crown's radius and pushed `SHADE.off` of it from the light. */
const SHADE = { off: 0.45, r: 0.86 };

/** The speckle in cells: `nx` by `ny` of them, each `cellMm` on paper at 1:`scale`, 1 where the cell is a tree's. */
export interface CoverCells { nx: number; ny: number; cellMm: number; scale: number; cells: Uint8Array; sharePct: number }

/** A reading of the aerial's green: `green[y * width + x]` non-zero where the pixel is, each pixel `mPerPx` of ground. */
export interface GreenRaster { width: number; height: number; mPerPx: number; green: ArrayLike<number> }

/** A crown on the ground: metres east and south of the picture's middle, and its radius. */
export interface CoverCrown { x: number; y: number; r: number }

const share = (cells: Uint8Array) => { let n = 0; for (const v of cells) n += v; return Math.round((n / Math.max(1, cells.length)) * 1000) / 10; };

/** The crowns as the cover's cells at 1:`scale`: each a dot of its heart, or the lit side of a wide one. */
export function speckle(crowns: CoverCrown[], scale = COVER_SCALE, field = COVER_FIELD): CoverCells {
  const nx = Math.ceil(field.w / COVER_CELL_MM), ny = Math.ceil(field.h / COVER_CELL_MM);
  const cellM = (COVER_CELL_MM * scale) / 1000;
  const cells = new Uint8Array(nx * ny);
  for (const c of crowns) {
    const cx = nx / 2 + c.x / cellM, cy = ny / 2 + c.y / cellM, r = c.r / cellM;
    const lit = 2 * c.r >= COVER_CRESCENT_M;
    // a dot is never less than a cell: a tree with no crown recorded still marks the ground
    const reach = lit ? r : Math.max(0.55, r * COVER_HEART);
    const sx = cx - LIGHT.x * r * SHADE.off, sy = cy - LIGHT.y * r * SHADE.off, shade = r * SHADE.r;
    for (let j = Math.max(0, Math.floor(cy - reach)); j <= Math.min(ny - 1, Math.ceil(cy + reach)); j++) {
      for (let i = Math.max(0, Math.floor(cx - reach)); i <= Math.min(nx - 1, Math.ceil(cx + reach)); i++) {
        const x = i + 0.5, y = j + 0.5;
        if (Math.hypot(x - cx, y - cy) > reach) continue;
        if (lit && Math.hypot(x - sx, y - sy) <= shade) continue;
        cells[j * nx + i] = 1;
      }
    }
  }
  return { nx, ny, cellMm: COVER_CELL_MM, scale, cells, sharePct: share(cells) };
}

/**
 * The trees a deck holds as the cover's speckle, round `centre`. Drawn at 1:2000 where the trees reach the field's
 * edges at that scale; closer in, as far as 1:1200, where a deck's trees stop short of them (a handful of recorded
 * trees are left at 1:2000: they say nothing of how far the deck looked).
 */
export function coverCellsFromTrees(trees: { lon: number; lat: number; canopyM: number }[], centre: { lon: number; lat: number }, field = COVER_FIELD): CoverCells | undefined {
  if (!trees.length) return undefined;
  const mLat = 111_320, mLon = mLat * Math.cos((centre.lat * Math.PI) / 180);
  const crowns = trees.map((t) => ({ x: (t.lon - centre.lon) * mLon, y: -(t.lat - centre.lat) * mLat, r: (t.canopyM || 0) / 2 }));
  let scale = COVER_SCALE;
  if (crowns.length >= 60) {
    // how far the trees reach east-west and north-south, the stray few left out
    const at = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length * 0.98)];
    const fit = Math.min((2 * at(crowns.map((c) => Math.abs(c.x))) * 1000) / field.w, (2 * at(crowns.map((c) => Math.abs(c.y))) * 1000) / field.h);
    scale = Math.round(Math.max(COVER_SCALE * 0.6, Math.min(COVER_SCALE, fit)));
  }
  return speckle(crowns, scale, field);
}

/**
 * The middle of a reading of the aerial's green as the cover's speckle, for a deck that holds the reading but no
 * crowns: the crowns are read off it (3 to 14 m across, as the decks' own are) and drawn as any others. At 1:2000
 * where the reading reaches the field's edges at that scale, closer in where it does not, and never so close that a
 * cell is finer than the reading.
 */
export function coverCells(src: GreenRaster, field = COVER_FIELD): CoverCells {
  const fit = Math.min((src.width * src.mPerPx * 1000) / field.w, (src.height * src.mPerPx * 1000) / field.h);
  const finest = (src.mPerPx * 1000) / COVER_CELL_MM;
  const scale = Math.round(Math.max(finest, Math.min(COVER_SCALE, fit)));
  const mask = src.green instanceof Uint8Array ? src.green : Uint8Array.from(src.green as ArrayLike<number>, (v) => (v ? 1 : 0));
  // crowns that stand clear of each other (a whole crown apart), so a wide canopy or a lawn reads as trees side by
  // side and not as one patch
  const crowns = crownsFromMask(mask, src.width, src.height, { minR: 1.5 / src.mPerPx, maxR: 7 / src.mPerPx, spacing: 2 });
  return speckle(crowns.map((c) => ({ x: (c.x + 0.5 - src.width / 2) * src.mPerPx, y: (c.y + 0.5 - src.height / 2) * src.mPerPx, r: c.r * src.mPerPx })), scale, field);
}

/**
 * The cells' outline as one SVG path, in cells (a unit a cell): every edge between a tree's cell and the ground,
 * chained into closed loops, the tree on the right, runs of edges in a line joined. Filled by the even-odd rule.
 */
export function coverPath(c: CoverCells): string {
  const { nx, ny, cells } = c, VX = nx + 1;
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < ny ? cells[j * nx + i] : 0);
  // each vertex's outgoing edges, a bit a direction: 0 right, 1 down, 2 left, 3 up
  const out = new Uint8Array(VX * (ny + 1));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!cells[j * nx + i]) continue;
      if (!at(i, j - 1)) out[j * VX + i] |= 1;                // its top, left to right
      if (!at(i + 1, j)) out[j * VX + i + 1] |= 2;            // its right, downward
      if (!at(i, j + 1)) out[(j + 1) * VX + i + 1] |= 4;      // its foot, right to left
      if (!at(i - 1, j)) out[(j + 1) * VX + i] |= 8;          // its left, upward
    }
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const parts: string[] = [];
  for (let v0 = 0; v0 < out.length; v0++) {
    while (out[v0]) {
      let dir = out[v0] & 1 ? 0 : out[v0] & 2 ? 1 : out[v0] & 4 ? 2 : 3;
      let x = v0 % VX, y = (v0 - x) / VX, run = 0, runDir = dir;
      const segs: string[] = [`M${x} ${y}`];
      const flush = () => { if (run) segs.push(`${runDir % 2 ? 'v' : 'h'}${runDir === 0 || runDir === 1 ? run : -run}`); run = 0; };
      for (;;) {
        out[y * VX + x] &= ~(1 << dir);
        if (dir !== runDir) { flush(); runDir = dir; }
        run++;
        x += DX[dir]; y += DY[dir];
        if (y * VX + x === v0) break;
        // where two cells meet at a corner, the turn to the right keeps the loop to its own cell
        const m = out[y * VX + x];
        const next = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => m & (1 << d));
        if (next === undefined) break;
        dir = next;
      }
      flush();
      parts.push(`${segs.join('')}z`);
    }
  }
  return parts.join('');
}

/**
 * The picture, `w` by `h` mm: the ground, and on it the trees' cells, the field's middle at the picture's. Without
 * cells, the ground alone.
 */
export function coverPictureSvg(c: CoverCells | undefined, w: number, h: number, inks: { ground: string; canopy: string } = { ground: COVER_GROUND, canopy: COVER_CANOPY }): string {
  const d = c ? coverPath(c) : '';
  const tx = c ? (w - c.nx * c.cellMm) / 2 : 0, ty = c ? (h - c.ny * c.cellMm) / 2 : 0;
  return `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" data-cover-picture="${c ? `${c.sharePct}` : 'none'}" style="display:block"><rect x="0" y="0" width="${w}" height="${h}" fill="${inks.ground}"/>${d ? `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${c!.cellMm})" d="${d}" fill="${inks.canopy}" fill-rule="evenodd"/>` : ''}</svg>`;
}

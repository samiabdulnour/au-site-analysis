// The cover's picture: the canopy of the place as a field of small squares.
//
// The green of the aerial (trees, gardens and lawns: fetch/imagery.ts) is read
// into cells about a metre and a half across and drawn at 1:2000, 0.8 mm a
// cell, the site in the middle: a blue-grey speckle on a pale sage ground, the
// grain of the place and not a map of it. Where a deck has no reading of the
// aerial (one fetched before the cover asked for it), the trees it does hold
// are drawn as their crowns in the same cells.
//
// The cells are traced into one outline, so the picture is a single vector
// shape: no raster for a viewer to smooth, no seams between the squares, and a
// style that prints in black and white inks it in its own greys.

/** The picture's ground and its canopy. */
export const COVER_GROUND = '#e3ebe4';
export const COVER_CANOPY = '#c4cbd6';
/** A cell on paper, mm, and the scale the picture is drawn at where the reading reaches that far. */
export const COVER_CELL_MM = 0.8;
export const COVER_SCALE = 2000;
/** The field's size on paper, mm: as wide as the slides cover's picture, as tall as the booklet front's. */
export const COVER_FIELD = { w: 312, h: 204 };

/** The canopy in cells: `nx` by `ny` of them, each `cellMm` on paper at 1:`scale`, 1 where the cell is canopy. */
export interface CoverCells { nx: number; ny: number; cellMm: number; scale: number; cells: Uint8Array; sharePct: number }

/** A reading of the aerial's green: `green[y * width + x]` non-zero where the pixel is, each pixel `mPerPx` of ground. */
export interface GreenRaster { width: number; height: number; mPerPx: number; green: ArrayLike<number> }

const share = (cells: Uint8Array) => { let n = 0; for (const v of cells) n += v; return Math.round((n / Math.max(1, cells.length)) * 1000) / 10; };

/**
 * The middle of a reading of the aerial's green as the cover's cells: a cell is canopy where half its ground or more
 * is green. Drawn at 1:2000 where the reading reaches the field's edges at that scale, closer in where it does not,
 * and never finer than the reading itself.
 */
export function coverCells(src: GreenRaster, field = COVER_FIELD): CoverCells {
  const nx = Math.ceil(field.w / COVER_CELL_MM), ny = Math.ceil(field.h / COVER_CELL_MM);
  const fit = Math.min((src.width * src.mPerPx * 1000) / field.w, (src.height * src.mPerPx * 1000) / field.h);
  const finest = (src.mPerPx * 1000) / COVER_CELL_MM;
  const scale = Math.round(Math.max(finest, Math.min(COVER_SCALE, fit)));
  const f = ((COVER_CELL_MM * scale) / 1000) / src.mPerPx;      // pixels of the reading a cell
  const x0 = src.width / 2 - (nx * f) / 2, y0 = src.height / 2 - (ny * f) / 2;
  const cells = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const ya = Math.round(y0 + j * f), yb = Math.max(ya + 1, Math.round(y0 + (j + 1) * f));
    for (let i = 0; i < nx; i++) {
      const xa = Math.round(x0 + i * f), xb = Math.max(xa + 1, Math.round(x0 + (i + 1) * f));
      let on = 0, all = 0;
      for (let y = Math.max(0, ya); y < Math.min(src.height, yb); y++) for (let x = Math.max(0, xa); x < Math.min(src.width, xb); x++) { all++; if (src.green[y * src.width + x]) on++; }
      cells[j * nx + i] = all && on * 2 >= all ? 1 : 0;
    }
  }
  return { nx, ny, cellMm: COVER_CELL_MM, scale, cells, sharePct: share(cells) };
}

/** The trees a deck holds as the cover's cells, each a disc of its crown round `centre`: for a deck with no reading of the aerial. */
export function coverCellsFromTrees(trees: { lon: number; lat: number; canopyM: number }[], centre: { lon: number; lat: number }, field = COVER_FIELD): CoverCells | undefined {
  if (!trees.length) return undefined;
  const nx = Math.ceil(field.w / COVER_CELL_MM), ny = Math.ceil(field.h / COVER_CELL_MM), scale = COVER_SCALE;
  const cellM = (COVER_CELL_MM * scale) / 1000;
  const mLat = 111_320, mLon = mLat * Math.cos((centre.lat * Math.PI) / 180);
  const cells = new Uint8Array(nx * ny);
  for (const t of trees) {
    const cx = nx / 2 + ((t.lon - centre.lon) * mLon) / cellM, cy = ny / 2 - ((t.lat - centre.lat) * mLat) / cellM;
    const r = Math.max(0.6, (t.canopyM || 4) / 2 / cellM);
    for (let j = Math.max(0, Math.floor(cy - r)); j <= Math.min(ny - 1, Math.ceil(cy + r)); j++) {
      for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(nx - 1, Math.ceil(cx + r)); i++) {
        if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= r) cells[j * nx + i] = 1;
      }
    }
  }
  return { nx, ny, cellMm: COVER_CELL_MM, scale, cells, sharePct: share(cells) };
}

/**
 * The cells' outline as one SVG path, in cells (a unit a cell): every edge between a canopy cell and the ground,
 * chained into closed loops, the canopy on the right, runs of edges in a line joined. Filled by the even-odd rule.
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
 * The picture, `w` by `h` mm: the ground, and on it the canopy's cells, the field's middle at the picture's. Without
 * cells, the ground alone.
 */
export function coverPictureSvg(c: CoverCells | undefined, w: number, h: number, inks: { ground: string; canopy: string } = { ground: COVER_GROUND, canopy: COVER_CANOPY }): string {
  const d = c ? coverPath(c) : '';
  const tx = c ? (w - c.nx * c.cellMm) / 2 : 0, ty = c ? (h - c.ny * c.cellMm) / 2 : 0;
  return `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" data-cover-picture="${c ? `${c.sharePct}` : 'none'}" style="display:block"><rect x="0" y="0" width="${w}" height="${h}" fill="${inks.ground}"/>${d ? `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${c!.cellMm})" d="${d}" fill="${inks.canopy}" fill-rule="evenodd"/>` : ''}</svg>`;
}

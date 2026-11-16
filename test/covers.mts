/* The decks' covers (src/render/slides.ts) and their picture (src/lib/coverPicture.ts).
 *
 * The picture: a reading of the aerial's green cut into the cover's cells (a cell canopy where half its ground is
 * green; 1:2000 where the reading reaches the field's edges, closer in where it does not, never finer than the
 * reading), the trees a deck holds drawn as crowns where it has no reading, and the cells traced into one outline
 * whose area is the cells' own, holes and corners included.
 *
 * The covers: the slides' as one composition with the picture in every style; the booklet's cut in two down the fold,
 * the picture on its front for Flamingo and Kingfisher and the contents there for Heron and Canary; Heron's picture
 * in greys; every spread in the contents; the mark and the name drawn last, for the print check. Nothing here asks a
 * network.
 *
 *   npx tsx test/covers.mts
 */

import { coverCells, coverCellsFromTrees, coverPath, coverPictureSvg, COVER_CELL_MM, COVER_FIELD, COVER_GROUND, COVER_CANOPY, type CoverCells } from '../src/lib/coverPicture.js';
import { coverPage, bookletCover, coverHasPicture, coverSite, coverCredit, type Cover } from '../src/render/slides.js';
import { withTemplate, templateFor, greyOf } from '../src/render/template.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// ---- the cells ----

const NX = Math.ceil(COVER_FIELD.w / COVER_CELL_MM), NY = Math.ceil(COVER_FIELD.h / COVER_CELL_MM);
{
  // a reading wider than the field at 1:2000: 2000 x 1500 px at 0.5 m, a green square 100 m across in its middle
  const W = 2000, H = 1500, green = new Uint8Array(W * H);
  for (let y = H / 2 - 100; y < H / 2 + 100; y++) for (let x = W / 2 - 100; x < W / 2 + 100; x++) green[y * W + x] = 1;
  const c = coverCells({ width: W, height: H, mPerPx: 0.5, green });
  check('cells: the field in 0.8 mm cells', c.nx === NX && c.ny === NY && c.cellMm === 0.8, `${c.nx} x ${c.ny}`);
  check('cells: 1:2000 where the reading reaches the field\'s edges', c.scale === 2000, String(c.scale));
  // 100 m at 1.6 m a cell: 62 or 63 cells a side, in the field's middle
  const n = c.cells.reduce((t, v) => t + v, 0), side = Math.sqrt(n);
  check('cells: a 100 m square is some 62 cells a side', Math.abs(side - 62.5) < 1.5, String(side));
  check('cells: the reading\'s middle is the field\'s', c.cells[(NY >> 1) * NX + (NX >> 1)] === 1 && c.cells[0] === 0);
  check('cells: the share of canopy, in per cent', Math.abs(c.sharePct - (n / (NX * NY)) * 100) < 0.06, String(c.sharePct));

  // a reading that stops short of the field at 1:2000 is drawn closer in, so it still fills the field
  const small = coverCells({ width: 1100, height: 1100, mPerPx: 0.5, green: new Uint8Array(1100 * 1100).fill(1) });
  check('cells: a smaller reading is drawn closer in', small.scale < 2000 && small.scale === Math.round((1100 * 0.5 * 1000) / COVER_FIELD.w), String(small.scale));
  check('cells: and fills the field', small.sharePct === 100, String(small.sharePct));
  // a coarse reading (a wide site's, capped in pixels) is never drawn finer than it was read
  const coarse = coverCells({ width: 900, height: 900, mPerPx: 2.5, green: new Uint8Array(900 * 900) });
  check('cells: a coarse reading keeps a cell to a pixel or more', coarse.scale === Math.round((2.5 * 1000) / COVER_CELL_MM), String(coarse.scale));
  // half green and half not, pixel by pixel in stripes two wide: a cell of three pixels is canopy by its majority
  const stripes = new Uint8Array(1800 * 1200);
  for (let i = 0; i < stripes.length; i++) stripes[i] = (i % 1800) % 4 < 2 ? 1 : 0;
  const s = coverCells({ width: 1800, height: 1200, mPerPx: 0.5, green: stripes });
  check('cells: a cell is canopy where half its ground or more is green', s.sharePct > 35 && s.sharePct < 100, String(s.sharePct));
}

// ---- the trees, for a deck with no reading ----
{
  check('trees: none, no picture', coverCellsFromTrees([], { lon: 151.16, lat: -33.76 }) === undefined);
  const centre = { lon: 151.16, lat: -33.76 };
  const c = coverCellsFromTrees([{ ...centre, canopyM: 16 }, { lon: centre.lon + 0.001, lat: centre.lat, canopyM: 0 }], centre)!;
  // a 16 m crown at 1.6 m a cell: a disc 10 cells across, some 78 cells; a tree with no crown still marks the ground
  const n = c.cells.reduce((t, v) => t + v, 0);
  check('trees: a crown is a disc of its width', n > 70 && n < 100 && c.cells[(NY >> 1) * NX + (NX >> 1)] === 1, String(n));
  // 0.001 degrees of longitude at this latitude is some 92.5 m: 58 cells east
  const east = (NX >> 1) + Math.round((0.001 * 111_320 * Math.cos((centre.lat * Math.PI) / 180)) / 1.6);
  check('trees: each stands where it is', c.cells[(NY >> 1) * NX + east] === 1, String(east));
  check('trees: at 1:2000', c.scale === 2000);
}

// ---- the outline ----

/** A path's loops as vertex lists, and the area inside them by the shoelace (the sign telling a hole from an island). */
function loops(d: string): { pts: [number, number][]; area: number }[] {
  return d.split('z').filter(Boolean).map((part) => {
    const m = /^M(-?\d+) (-?\d+)(.*)$/.exec(part)!;
    let x = Number(m[1]), y = Number(m[2]);
    const pts: [number, number][] = [[x, y]];
    for (const seg of m[3].matchAll(/([hv])(-?\d+)/g)) { if (seg[1] === 'h') x += Number(seg[2]); else y += Number(seg[2]); pts.push([x, y]); }
    let a = 0;
    for (let i = 0; i + 1 < pts.length; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    return { pts, area: a / 2 };
  });
}
const grid = (rows: string[]): CoverCells => {
  const nx = rows[0].length, ny = rows.length, cells = new Uint8Array(nx * ny);
  rows.forEach((r, j) => [...r].forEach((ch, i) => { cells[j * nx + i] = ch === '#' ? 1 : 0; }));
  return { nx, ny, cellMm: 0.8, scale: 2000, cells, sharePct: 0 };
};
{
  check('outline: nothing where there is no canopy', coverPath(grid(['...', '...'])) === '');
  const one = coverPath(grid(['...', '.#.', '...']));
  check('outline: a cell is a square', one === 'M1 1h1v1h-1v-1z', one);
  const bar = loops(coverPath(grid(['.....', '.###.', '.....'])));
  check('outline: a run of cells is one side, not three', bar.length === 1 && bar[0].pts.length === 5, JSON.stringify(bar));
  const ring = loops(coverPath(grid(['###', '#.#', '###'])));
  check('outline: a hole is a loop of its own, turned the other way', ring.length === 2 && ring[0].area * ring[1].area < 0 && Math.abs(ring[0].area + ring[1].area) === 8, JSON.stringify(ring.map((l) => l.area)));
  const corner = loops(coverPath(grid(['#.', '.#'])));
  check('outline: cells that meet at a corner stay two', corner.length === 2 && corner.every((l) => Math.abs(l.area) === 1), JSON.stringify(corner.map((l) => l.area)));
  // any field: every loop closes, and the area inside is the cells'
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const rows = Array.from({ length: 40 }, () => Array.from({ length: 60 }, () => (rnd() < 0.45 ? '#' : '.')).join(''));
  const g = grid(rows), ls = loops(coverPath(g));
  const filled = g.cells.reduce((t, v) => t + v, 0);
  check('outline: every loop closes', ls.every((l) => l.pts[0][0] === l.pts[l.pts.length - 1][0] && l.pts[0][1] === l.pts[l.pts.length - 1][1]));
  check('outline: the area inside is the cells\'', Math.abs(ls.reduce((t, l) => t + l.area, 0)) === filled, `${ls.reduce((t, l) => t + l.area, 0)} of ${filled}`);
  const svg = coverPictureSvg(g, 303, 181.7);
  check('picture: the ground, then the canopy in one even-odd path', svg.includes(`fill="${COVER_GROUND}"`) && svg.includes(`fill="${COVER_CANOPY}" fill-rule="evenodd"`) && (svg.match(/<path /g) ?? []).length === 1);
  check('picture: no raster, no pattern, no mask', !/<image|<pattern|<mask/.test(svg));
  check('picture: without cells, the ground alone', !coverPictureSvg(undefined, 303, 181.7).includes('<path'));
}

// ---- the covers ----
{
  const cover: Cover = {
    deck: 'Site report',
    site: coverSite('2-4 Culworth Avenue, Killara NSW 2071'),
    details: ['Lot 1 DP 123456 · 2,989 m²', 'R4 High Density Residential'],
    contents: Array.from({ length: 20 }, (_, i) => ({ n: String(i + 1).padStart(2, '0'), title: `Spread ${i + 1}` })),
    note: 'An analysis to start a design from.',
    credit: coverCredit('2026-11-16T02:00:00Z'),
    picture: grid(['.#.', '###', '.#.']),
  };
  check('site: the street and the suburb, without the State and the postcode', cover.site === '2-4 Culworth Avenue Killara', cover.site);
  check('site: an address already short is left alone', coverSite('2-4 CULWORTH AVENUE KILLARA') === '2-4 CULWORTH AVENUE KILLARA');
  check('credit: who made it, and the day', cover.credit.length === 3 && /^Generated with Site Analyst, 16 November 2026$/.test(cover.credit[0]), cover.credit[0]);
  check('styles: the booklet\'s picture is Flamingo\'s and Kingfisher\'s', coverHasPicture('flamingo') && coverHasPicture('kingfisher') && !coverHasPicture('heron') && !coverHasPicture('canary'));

  const rows = (html: string) => (html.match(/<div style="grid-template-columns:/g) ?? []).length;
  const lastMark = (html: string) => html.lastIndexOf('data-print-check') > html.lastIndexOf('cv-contents') && html.lastIndexOf('data-print-check') > html.lastIndexOf('data-cover-picture');
  for (const style of ['flamingo', 'kingfisher', 'heron', 'canary']) {
    const { slides, booklet } = withTemplate(templateFor('slides', style), () => ({ slides: coverPage(cover), booklet: bookletCover(cover) }));
    check(`${style}: the slides' cover is one composition with the picture`, /data-cover="slides"/.test(slides) && (slides.match(/data-cover-picture/g) ?? []).length === 1);
    check(`${style}: its contents list every spread once`, rows(slides) === 20 && rows(booklet) === 20, `${rows(slides)}, ${rows(booklet)}`);
    check(`${style}: the name in two lines, the mark over it`, /cv-title[^>]*>Site<br>report</.test(slides) && />Site Analyst</.test(slides) && /cv-title[^>]*>Site<br>report</.test(booklet));
    check(`${style}: the mark and the name drawn last, for the print check`, lastMark(slides) && lastMark(booklet));
    check(`${style}: one page each`, (slides.match(/<section /g) ?? []).length === 1 && (booklet.match(/<section /g) ?? []).length === 1 && /id="00_cover"/.test(slides) && /id="00_cover"/.test(booklet));
    const pictured = style === 'flamingo' || style === 'kingfisher';
    check(`${style}: the booklet's front ${pictured ? 'has the picture' : 'has the contents and no picture'}`, pictured
      ? /data-cover="booklet-picture"/.test(booklet) && (booklet.match(/data-cover-picture/g) ?? []).length === 1
      : /data-cover="booklet"/.test(booklet) && !/data-cover-picture/.test(booklet));
    // the front is the right half: with the picture, the contents are on the back; without, on the front
    const left = Number(/cv-contents" style="left:([\d.]+)mm/.exec(booklet)?.[1]);
    check(`${style}: the booklet's contents on its ${pictured ? 'back' : 'front'}`, pictured ? left < 210 : left > 210, String(left));
    // the site is named on the front, and on the back
    check(`${style}: the site on both halves of the booklet`, (booklet.match(/>2-4 Culworth Avenue Killara</g) ?? []).length === 2 && (slides.match(/>2-4 Culworth Avenue Killara</g) ?? []).length === 1);
    const inks = style === 'heron' ? [greyOf(COVER_GROUND), greyOf(COVER_CANOPY)] : [COVER_GROUND, COVER_CANOPY];
    check(`${style}: the picture in ${style === 'heron' ? 'greys' : 'its sage and blue-grey'}`, inks.every((ink) => slides.includes(`fill="${ink}"`)), inks.join(' '));
  }
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('covers: all checks pass');

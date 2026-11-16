/* The decks' covers (src/render/slides.ts) and their picture (src/lib/coverPicture.ts).
 *
 * The picture: a speckle of the deck's trees, each a fleck of its own in half-millimetre cells (a small tree a dot of
 * the heart of its crown, a wide one the lit side of its crown, a crescent open away from the light; trees that
 * stand side by side left apart, not run together), at 1:2000 or closer in where the trees stop short of the field;
 * for a deck with a reading of the aerial's green but no crowns, the crowns read off the reading; and the cells
 * traced into one outline whose area is the cells' own, holes and corners included.
 *
 * The covers: the slides' as one composition with the picture in every style; the booklet's cut in two down the fold,
 * the picture on its front for Flamingo and Kingfisher and the contents there for Heron and Canary; Heron's picture
 * in greys; every spread in the contents; the mark and the name drawn last, for the print check. Nothing here asks a
 * network.
 *
 *   npx tsx test/covers.mts
 */

import { coverCells, coverCellsFromTrees, coverPath, coverPictureSvg, speckle, COVER_CELL_MM, COVER_FIELD, COVER_GROUND, COVER_CANOPY, COVER_CRESCENT_M, COVER_HEART, type CoverCells } from '../src/lib/coverPicture.js';
import { coverPage, bookletCover, coverHasPicture, coverSite, coverCredit, type Cover } from '../src/render/slides.js';
import { withTemplate, templateFor, greyOf } from '../src/render/template.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// ---- the speckle ----

const NX = Math.ceil(COVER_FIELD.w / COVER_CELL_MM), NY = Math.ceil(COVER_FIELD.h / COVER_CELL_MM);
const MX = NX >> 1, MY = NY >> 1;
const count = (c: CoverCells) => c.cells.reduce((t, v) => t + v, 0);
const on = (c: CoverCells, dx: number, dy: number) => c.cells[(MY + dy) * NX + MX + dx] === 1;
{
  check('grain: half a millimetre a cell, a metre of ground at 1:2000', COVER_CELL_MM === 0.5 && speckle([]).nx === NX && speckle([]).ny === NY && speckle([]).scale === 2000);
  // a small tree: a dot of the heart of its crown, where it stands
  const small = speckle([{ x: 0.5, y: 0.5, r: 2 }]);
  const heart = Math.PI * (2 * COVER_HEART) ** 2;
  check('a small tree is a dot of its heart', on(small, 0, 0) && Math.abs(count(small) - heart) <= 3 && count(small) < Math.PI * 4, `${count(small)} cells for a heart of ${heart.toFixed(1)}`);
  check('a tree with no crown recorded still marks the ground', count(speckle([{ x: 0.5, y: 0.5, r: 0 }])) === 1);
  // a wide tree: the lit side of its crown (the north-west, up and left), open to the south-east, its middle bare
  const wide = speckle([{ x: 0.5, y: 0.5, r: 6 }]);
  check('a wide tree is a crescent: its lit side drawn', on(wide, -3, -3) && on(wide, -4, 0) && on(wide, 0, -4), `${count(wide)}`);
  check('a wide tree is a crescent: its middle and its shaded side bare', !on(wide, 0, 0) && !on(wide, 3, 3) && !on(wide, 2, 0));
  check('a wide tree is a crescent: less than half its crown, and no cell beyond it', count(wide) < (Math.PI * 36) / 2 && count(wide) > 20 && !on(wide, -6, -6) && !on(wide, -8, 0), `${count(wide)}`);
  check('the crescent begins at six metres across', count(speckle([{ x: 0.5, y: 0.5, r: COVER_CRESCENT_M / 2 }])) > 0 && !on(speckle([{ x: 0.5, y: 0.5, r: COVER_CRESCENT_M / 2 }]), 0, 0) && on(speckle([{ x: 0.5, y: 0.5, r: COVER_CRESCENT_M / 2 - 0.1 }]), 0, 0));
  // a row of street trees 5 m apart, each 4 m across: flecks with the ground between them, not one bar
  const row = speckle(Array.from({ length: 9 }, (_, i) => ({ x: (i - 4) * 5 + 0.5, y: 0.5, r: 2 })));
  const line = Array.from({ length: 45 }, (_, i) => (on(row, i - 22, 0) ? '#' : '.')).join('');
  check('trees side by side stay apart', (line.match(/#+/g) ?? []).length === 9, line);
  // closer in, everything is larger on paper
  const near = speckle([{ x: 0.5, y: 0.5, r: 6 }], 1200);
  check('closer in, a crown is larger on paper', near.scale === 1200 && count(near) > count(wide) * 2, `${count(near)} against ${count(wide)}`);
}

// ---- the trees a deck holds ----
{
  const centre = { lon: 151.16, lat: -33.76 };
  check('trees: none, no picture', coverCellsFromTrees([], centre) === undefined);
  // 0.001 degrees of longitude at this latitude is some 92.5 m: 93 cells east at a metre a cell
  const c = coverCellsFromTrees([{ ...centre, canopyM: 4 }, { lon: centre.lon + 0.001, lat: centre.lat, canopyM: 4 }, { lon: centre.lon, lat: centre.lat + 0.0005, canopyM: 4 }], centre)!;
  const east = Math.round(0.001 * 111_320 * Math.cos((centre.lat * Math.PI) / 180)), north = Math.round(0.0005 * 111_320);
  check('trees: each stands where it is, north up', on(c, 0, 0) && on(c, east, 0) && on(c, 0, -north) && !on(c, 0, north), `${east} east, ${north} north`);
  check('trees: a handful are drawn at 1:2000', c.scale === 2000);
  // a deck's crowns over 500 m square: short of the field's 624 m across at 1:2000, so drawn closer in
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const mLon = 111_320 * Math.cos((centre.lat * Math.PI) / 180);
  const many = (half: number) => Array.from({ length: 2000 }, () => ({ lon: centre.lon + ((rnd() * 2 - 1) * half) / mLon, lat: centre.lat + ((rnd() * 2 - 1) * half) / 111_320, canopyM: 3 + rnd() * 8 }));
  const short = coverCellsFromTrees(many(250), centre)!;
  check('trees: where they stop short of the field, the picture is drawn closer in', short.scale < 1700 && short.scale > 1500, String(short.scale));
  const wide = coverCellsFromTrees(many(400), centre)!;
  check('trees: where they reach its edges, at 1:2000', wide.scale === 2000, String(wide.scale));
  check('trees: never closer than 1:1200', coverCellsFromTrees(many(60), centre)!.scale === 1200);
  // a speckle: the ground stays open between the crowns
  check('trees: a speckle, most of the ground open', wide.sharePct > 2 && wide.sharePct < 30, String(wide.sharePct));
}

// ---- a reading of the aerial's green, for a deck with no crowns ----
{
  // a reading wider than the field at 1:2000: 2000 x 1500 px at 0.5 m, a green square 100 m across in its middle
  const W = 2000, H = 1500, green = new Uint8Array(W * H);
  for (let y = H / 2 - 100; y < H / 2 + 100; y++) for (let x = W / 2 - 100; x < W / 2 + 100; x++) green[y * W + x] = 1;
  const c = coverCells({ width: W, height: H, mPerPx: 0.5, green });
  check('reading: 1:2000 where it reaches the field\'s edges', c.scale === 2000 && c.nx === NX && c.ny === NY, String(c.scale));
  // the square is 100 cells a side round the middle: crowns read off it, drawn as crescents, and nothing beyond it
  let inside = 0, outside = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (c.cells[j * NX + i]) { if (Math.abs(i - MX) <= 51 && Math.abs(j - MY) <= 51) inside++; else outside++; }
  check('reading: its green is read as crowns, where it is', inside > 800 && outside === 0, `${inside} inside, ${outside} outside`);
  check('reading: speckled, not filled', inside < 100 * 100 * 0.6, String(inside));
  // a reading that stops short of the field at 1:2000 is drawn closer in
  const small = coverCells({ width: 1100, height: 1100, mPerPx: 0.5, green: new Uint8Array(1100 * 1100) });
  check('reading: a smaller one is drawn closer in', small.scale === Math.round((1100 * 0.5 * 1000) / COVER_FIELD.w), String(small.scale));
  // a coarse reading (a wide site's, capped in pixels) is never drawn finer than it was read
  const coarse = coverCells({ width: 900, height: 900, mPerPx: 2.5, green: new Uint8Array(900 * 900) });
  check('reading: a coarse one keeps a cell to a pixel or more', coarse.scale === Math.round((2.5 * 1000) / COVER_CELL_MM), String(coarse.scale));
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

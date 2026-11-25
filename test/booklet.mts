/* The booklet (src/render/booklet.ts): a deck's A3 spreads imposed to fold into an A4 booklet.
 *
 * The page order (the cover's right half the front, each spread on two facing pages, the cover's left half the
 * back, blank pages to make up fours), the sides of the sheets in saddle-stitch order, and a deck of made-up spreads
 * imposed: its sides A3 landscape, as many as the sheets need, each half where it belongs (each half painted a colour
 * of its own, read back with poppler's pdftoppm where it is installed); a page drawn in two streams; a spread the
 * booklet prints otherwise in its place, the deck's own page left out, and a mismatched one refused. Nothing here asks
 * a network.
 *
 *   npx tsx test/booklet.mts
 */

import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bookletPages, bookletSides, imposeBooklet, bookletPathOf } from '../src/render/booklet.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const say = (p: ReturnType<typeof bookletPages>[number]) => (p ? `${p.spread}${p.half[0]}` : '—');

// ---- the order ----

// a cover and 11 spreads: 24 pages, none blank
const p12 = bookletPages(12);
check('order: a cover and eleven spreads make 24 pages', p12.length - 1 === 24);
check('order: the front is the cover\'s right half, the back its left', say(p12[1]) === '0r' && say(p12[24]) === '0l');
check('order: each spread on two facing pages, left then right', [2, 4, 6, 22].every((n) => p12[n]?.half === 'left' && p12[n + 1]?.half === 'right' && p12[n]?.spread === p12[n + 1]?.spread && p12[n]!.spread === n / 2), p12.map(say).join(' '));
check('order: no page blank where the spreads fill the fours', p12.slice(1).every(Boolean));
// a cover and 10: 22 pages of matter, two blank before the back
const p11 = bookletPages(11);
check('order: short of a four, a blank spread before the back', p11.length - 1 === 24 && !p11[22] && !p11[23] && say(p11[24]) === '0l' && say(p11[21]) === '10r', p11.map(say).join(' '));
// an older deck with no cover: its first spread still on pages 2 and 3, behind a blank front
const pNo = bookletPages(3, false);
check('order: no cover, a blank front and back, the spreads as before', !pNo[1] && say(pNo[2]) === '0l' && say(pNo[3]) === '0r' && !pNo[pNo.length - 1], pNo.map(say).join(' '));

// ---- the sides ----

const s8 = bookletSides(8);
check('sides: an 8-page booklet, its outer sheet 8|1 and 2|7, its inner 6|3 and 4|5', JSON.stringify(s8) === JSON.stringify([[8, 1], [2, 7], [6, 3], [4, 5]]), JSON.stringify(s8));
const s24 = bookletSides(24);
check('sides: every page once, two to a side, each pair summing to N + 1', s24.length === 12 && new Set(s24.flat()).size === 24 && s24.every(([l, r]) => l + r === 25));

// ---- a deck imposed ----

const dir = mkdtempSync(join(tmpdir(), 'booklet-'));
const W = (420 / 25.4) * 72, H = (297 / 25.4) * 72;
// each half of each spread painted a colour of its own: red the spread, green the half
const deck = await PDFDocument.create();
const shade = (i: number, half: 'L' | 'R') => [i * 50, half === 'L' ? 60 : 200, 120];
for (let i = 0; i < 5; i++) {
  const page = deck.addPage([W, H]);
  for (const half of ['L', 'R'] as const) {
    const [r, g, b] = shade(i, half);
    page.drawRectangle({ x: half === 'L' ? 0 : W / 2, y: 0, width: W / 2, height: H, color: rgb(r / 255, g / 255, b / 255) });
  }
}
const src = join(dir, 'DECK.pdf');
writeFileSync(src, await deck.save());
const dest = bookletPathOf(src);
check('impose: the booklet beside the deck', dest === join(dir, 'DECK.booklet.pdf'));
const done = await imposeBooklet(src, dest);
const out = await PDFDocument.load(readFileSync(dest));
// a cover and four spreads: 10 pages of matter, 12 in the booklet, three sheets, six sides
check('impose: a cover and four spreads, three sheets of six sides', done.pages === 12 && done.sheets === 3 && out.getPageCount() === 6, JSON.stringify(done));
check('impose: every side A3 landscape, as the deck', out.getPages().every((pg) => Math.abs(pg.getWidth() - W) < 0.5 && Math.abs(pg.getHeight() - H) < 0.5));
// read back as printed, where poppler is here: the colour at the middle of each side's two slots
// the booklet's own version of a spread, its halves in colours of their own
const ALT = { L: [250, 20, 20], R: [20, 20, 250] };
const name = (rgbPx: number[]) => {
  if (rgbPx.every((v) => v > 235)) return '—';
  for (const half of ['L', 'R'] as const) if (ALT[half].every((v, k) => Math.abs(v - rgbPx[k]) < 12)) return `A${half}`;
  for (let i = 0; i < 5; i++) for (const half of ['L', 'R'] as const) if (shade(i, half).every((v, k) => Math.abs(v - rgbPx[k]) < 12)) return `S${i}${half}`;
  return `?${rgbPx.join(',')}`;
};
const seen: string[] = [];
for (let k = 1; k <= out.getPageCount(); k++) {
  const ppm = spawnSync('pdftoppm', ['-r', '20', '-f', String(k), '-l', String(k), '-ppm', dest], { maxBuffer: 1 << 26 });
  if (ppm.status !== 0) break;
  const buf = ppm.stdout as Buffer, head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString('latin1'))!;
  const w = Number(head[1]), h = Number(head[2]), px = buf.subarray(head[0].length);
  const at = (x: number, y: number) => { const o = (Math.round(y) * w + Math.round(x)) * 3; return [px[o], px[o + 1], px[o + 2]]; };
  seen.push(`${name(at(w / 4, h / 2))}|${name(at((3 * w) / 4, h / 2))}`);
}
// a page drawn in two content streams (the left half in one, the right in the other): joined into one form
const two = await PDFDocument.create();
const tp = two.addPage([W, H]);
const paint = (x: number, [r, g, b]: number[]) => two.context.register(two.context.flateStream(`q ${r / 255} ${g / 255} ${b / 255} rg ${x} 0 ${W / 2} ${H} re f Q`));
tp.node.set(PDFName.of('Contents'), two.context.obj([paint(0, shade(4, 'L')), paint(W / 2, shade(4, 'R'))]));
const twoSrc = join(dir, 'TWO.pdf');
writeFileSync(twoSrc, await two.save());
await imposeBooklet(twoSrc, bookletPathOf(twoSrc));
const twoSides = (await PDFDocument.load(readFileSync(bookletPathOf(twoSrc)))).getPageCount();
check('impose: a cover alone, one sheet', twoSides === 2, String(twoSides));

/** The colours at the middle of each slot of side `k` of `pdf`, or nothing where poppler is not here. */
const slots = (pdf: string, k: number) => {
  const ppm = spawnSync('pdftoppm', ['-r', '20', '-f', String(k), '-l', String(k), '-ppm', pdf], { maxBuffer: 1 << 26 });
  if (ppm.status !== 0) return undefined;
  const buf = ppm.stdout as Buffer, head = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(buf.subarray(0, 40).toString('latin1'))!;
  const w = Number(head[1]), h = Number(head[2]), px = buf.subarray(head[0].length);
  const at = (x: number, y: number) => { const o = (Math.round(y) * w + Math.round(x)) * 3; return [px[o], px[o + 1], px[o + 2]]; };
  return `${name(at(w / 4, h / 2))}|${name(at((3 * w) / 4, h / 2))}`;
};
const twoSeen = slots(bookletPathOf(twoSrc), 1);
if (twoSeen) check('impose: both streams of a page drawn, each half in its slot', twoSeen === 'S4L|S4R', twoSeen);

if (seen.length) {
  // pages: 1 = S0R, 2/3 = S1, 4/5 = S2, 6/7 = S3, 8/9 = S4, 10/11 blank, 12 = S0L
  // sides: [12|1] [2|11] [10|3] [4|9] [8|5] [6|7]
  const want = ['S0L|S0R', 'S1L|—', '—|S1R', 'S2L|S4R', 'S4L|S2R', 'S3L|S3R'];
  check('impose: each half on its side and in its slot, as printed', JSON.stringify(seen) === JSON.stringify(want), JSON.stringify(seen));
}

// ---- a spread the booklet prints otherwise, in its place ----

const altDoc = await PDFDocument.create();
const ap = altDoc.addPage([W, H]);
for (const half of ['L', 'R'] as const) { const [r, g, b] = ALT[half]; ap.drawRectangle({ x: half === 'L' ? 0 : W / 2, y: 0, width: W / 2, height: H, color: rgb(r / 255, g / 255, b / 255) }); }
const altPath = join(dir, 'DECK.booklet-spreads.pdf');
writeFileSync(altPath, await altDoc.save());
const swapped = join(dir, 'SWAPPED.pdf');
await imposeBooklet(src, swapped, { spreads: { path: altPath, pages: [2] } });
const swappedSeen: string[] = [];
for (let k = 1; k <= 6; k++) { const at = slots(swapped, k); if (!at) break; swappedSeen.push(at); }
if (swappedSeen.length) {
  const want = ['S0L|S0R', 'S1L|—', '—|S1R', 'AL|S4R', 'S4L|AR', 'S3L|S3R'];
  check('spreads: the booklet\'s own spread in the deck\'s place, the rest as they were', JSON.stringify(swappedSeen) === JSON.stringify(want), JSON.stringify(swappedSeen));
}
// the page it replaces is not carried along unseen: no stream in the booklet paints spread 2's colours
const streams = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((m) => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; } });
const paints = (texts: string[], [r, g, b]: number[]) => texts.some((t) => t.includes(`${r / 255} ${g / 255} ${b / 255} rg`));
check('spreads: the test can see a spread\'s colours in a booklet', paints(streams(readFileSync(dest)), shade(2, 'L')));
check('spreads: the deck\'s own page left out where the booklet prints its own', !paints(streams(readFileSync(swapped)), shade(2, 'L')) && !paints(streams(readFileSync(swapped)), shade(2, 'R')));
// a spreads PDF that does not match its places is refused, not imposed wrong
let refused = 0;
for (const pages of [[2, 3], [9]]) await imposeBooklet(src, join(dir, 'BAD.pdf'), { spreads: { path: altPath, pages } }).catch(() => { refused += 1; });
check('spreads: a count or a page that does not match is refused', refused === 2, String(refused));

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('booklet: all checks pass');

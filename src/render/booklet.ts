// The booklet: a deck's A3 spreads imposed so that, printed double-sided on A3
// (flipped on the short edge), the sheets stacked as printed, folded down the
// middle and stapled twice on the fold, they make an A4 portrait booklet.
//
// Every spread of the decks is two A4 pages side by side: the words on the
// left, the drawing on the right. In the booklet the two stay together, face
// to face, as they were drawn: the cover's right half is the front (page 1),
// each spread after it takes the next two pages (2 and 3, 4 and 5, …), and
// the cover's left half is the back (the last page). A saddle-stitched
// booklet's pages come in fours, a sheet folded once, so where the spreads
// fall short a blank spread goes in before the back.
//
// Each side of a sheet is an A3 landscape page holding two A4 pages, the
// outermost sheet first: its front carries the back cover and the front cover,
// its other side the first spread; the sheet inside it the next. Each half is
// the spread's own page drawn once into the new PDF and shown through a window
// of its half (a form XObject drawn twice and clipped, made of the page's own
// content stream as it was compressed), so the booklet is hardly bigger than
// the deck. A thin grey dashed line down the middle of every side marks the
// fold.
//
// A spread can be printed otherwise for the booklet (BookletSpreads): the
// report's built form, the city drawn across both pages round the site, has
// the site moved off the fold, where the staples and the gutter would take it.
// Those spreads are printed on their own and stand in for the deck's.
//
// A deck printed before it had a cover (an older drawing) has its first spread
// as page 2 and 3 all the same, behind a blank front and before a blank back.

import {
  PDFDocument, PDFObjectCopier, PDFName, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream, type PDFPageLeaf, type PDFPage,
  rgb, LineCapStyle, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, concatTransformationMatrix, drawObject,
} from 'pdf-lib';
import { readFile, writeFile, rename } from 'node:fs/promises';

/**
 * The spreads a deck's booklet prints otherwise: their HTML, one section a spread in the deck's own styles, and for
 * each the deck's PDF page (0 the cover) it stands in for.
 */
export interface BookletSpreads { html: string; spreads: number[] }

/** A booklet page: which spread of the deck, and which half of it; null for a blank page. */
export type BookletPage = { spread: number; half: 'left' | 'right' } | null;

/**
 * The booklet's pages in reading order, 1 to N (index 0 unused), for a deck of `spreads` spreads whose first is its
 * cover (or, `cover` false, which has none): N a multiple of four.
 */
export function bookletPages(spreads: number, cover = true): BookletPage[] {
  const content = cover ? spreads - 1 : spreads;     // the spreads between the covers
  const n = Math.max(4, Math.ceil((2 + 2 * content) / 4) * 4);
  const pages: BookletPage[] = Array.from({ length: n + 1 }, () => null);
  const first = cover ? 1 : 0;
  if (cover) { pages[1] = { spread: 0, half: 'right' }; pages[n] = { spread: 0, half: 'left' }; }
  for (let k = 0; k < content; k++) {
    pages[2 + 2 * k] = { spread: first + k, half: 'left' };
    pages[3 + 2 * k] = { spread: first + k, half: 'right' };
  }
  return pages;
}

/** The sides of the sheets in print order, outermost sheet first, each its left and right page numbers (1 to N). */
export function bookletSides(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < n / 4; j++) {
    out.push([n - 2 * j, 1 + 2 * j]);          // the outside of the sheet
    out.push([2 + 2 * j, n - 1 - 2 * j]);      // the inside
  }
  return out;
}

/**
 * The fold's mark: a thin grey line of short dashes, a dotted line in print, down the middle of a side. Dashes, not
 * round-capped dots of no length: every viewer and printer draws a dash, and not all of them such a dot.
 */
const FOLD = { thickness: 0.4, color: rgb(0.62, 0.62, 0.62), dashArray: [0.7, 1.6], lineCap: LineCapStyle.Butt };

/** A page of the deck in the booklet: its form XObject, and where its media box starts. */
type Form = { ref: PDFRef; x: number; y: number };

/**
 * Each page of `src` as a form XObject in `out`, the resources they share (fonts, patterns, pictures) copied once.
 * The page's content stream becomes the form, its bytes as they were compressed: pdf-lib's embedPages keeps the
 * copied stream and writes a recompressed form beside it, every drawing in the deck twice. A page drawn in several
 * streams has them joined into one.
 */
function pagesAsForms(src: PDFDocument, out: PDFDocument, skip: ReadonlySet<number> = new Set()): (Form | undefined)[] {
  const copier = PDFObjectCopier.for(src.context, out.context);
  const ctx = out.context;
  return src.getPages().map((page, i) => {
    // a page the booklet prints otherwise is not copied at all, or it would be carried along unseen
    if (skip.has(i)) return undefined;
    const node = copier.copy(page.node) as PDFPageLeaf;
    // the copy carries what the page inherited (its box, its resources) as its own
    const box = node.MediaBox();
    const { x, y } = box.asRectangle();
    const form = { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: box, Resources: node.get(PDFName.of('Resources')) };
    const contents = node.get(PDFName.of('Contents'));
    const single = contents instanceof PDFArray && contents.size() === 1 ? contents.get(0) : contents;
    const one = single instanceof PDFRef ? ctx.lookup(single) : undefined;
    if (single instanceof PDFRef && one instanceof PDFRawStream) {
      for (const [k, v] of Object.entries(form)) if (v !== undefined) one.dict.set(PDFName.of(k), typeof v === 'string' ? PDFName.of(v) : ctx.obj(v as never));
      return { ref: single, x, y };
    }
    // several streams (or none): decoded, joined and compressed afresh, the copies dropped
    const refs = contents instanceof PDFArray ? contents.asArray().filter((r): r is PDFRef => r instanceof PDFRef) : contents instanceof PDFRef ? [contents] : [];
    const parts = refs.map((r) => ctx.lookup(r)).filter((st): st is PDFRawStream => st instanceof PDFRawStream).map((st) => decodePDFRawStream(st).decode());
    const joined = new Uint8Array(parts.reduce((n, b) => n + b.length + 1, 0));
    let at = 0;
    for (const b of parts) { joined.set(b, at); joined[at + b.length] = 0x0a; at += b.length + 1; }
    for (const r of refs) ctx.delete(r);
    return { ref: ctx.register(ctx.flateStream(joined, form as never)), x, y };
  });
}

/**
 * The deck at `srcPath` imposed as a booklet at `destPath` (written whole, then moved into place). Returns its page
 * count (the booklet's) and its sheets of paper.
 */
export async function imposeBooklet(
  srcPath: string, destPath: string,
  opts: { cover?: boolean; /** a PDF of spreads printed for the booklet, and the deck page each replaces, in order */ spreads?: { path: string; pages: number[] } } = {},
): Promise<{ pages: number; sheets: number }> {
  const src = await PDFDocument.load(await readFile(srcPath));
  const out = await PDFDocument.create();
  out.setTitle(`${src.getTitle() ?? 'Site Analyst'} — booklet`);
  out.setCreator('Site Analyst');
  const count = src.getPageCount();
  if (!count) throw new Error('the deck has no pages');
  const { width: W, height: H } = src.getPage(0).getSize();
  // each spread drawn into the booklet once, and shown through either half
  const at = opts.spreads?.pages ?? [];
  const alt = at.length ? await PDFDocument.load(await readFile(opts.spreads!.path)) : undefined;
  if (alt && alt.getPageCount() !== at.length) throw new Error(`the booklet's own spreads are ${alt.getPageCount()} pages for ${at.length} places`);
  if (at.some((k) => !(Number.isInteger(k) && k >= 0 && k < count))) throw new Error(`a booklet spread stands for a page the deck has not (${at.join(', ')} of ${count})`);
  const forms = pagesAsForms(src, out, new Set(at));
  if (alt) pagesAsForms(alt, out).forEach((f, j) => { forms[at[j]] = f; });
  const pages = bookletPages(count, opts.cover ?? true);
  const n = pages.length - 1;
  const place = (side: PDFPage, at: BookletPage, slot: 0 | 1) => {
    if (!at) return;
    const x0 = slot * (W / 2), f = forms[at.spread]!;
    const name = side.node.newXObject('Spread', f.ref);
    // the window: this slot's half of the side; the spread drawn so that its own half falls in it
    side.pushOperators(
      pushGraphicsState(), rectangle(x0, 0, W / 2, H), clip(), endPath(),
      concatTransformationMatrix(1, 0, 0, 1, x0 - (at.half === 'right' ? W / 2 : 0) - f.x, -f.y), drawObject(name),
      popGraphicsState(),
    );
  };
  for (const [l, r] of bookletSides(n)) {
    const side = out.addPage([W, H]);
    place(side, pages[l], 0);
    place(side, pages[r], 1);
    side.drawLine({ start: { x: W / 2, y: 0 }, end: { x: W / 2, y: H }, ...FOLD });
  }
  const tmp = `${destPath}.part`;
  await writeFile(tmp, await out.save());
  await rename(tmp, destPath);
  return { pages: n, sheets: n / 4 };
}

/** Where a deck's booklet is kept: beside its PDF, the same name with `.booklet`. */
export const bookletPathOf = (pdfPath: string) => pdfPath.replace(/\.pdf$/i, '.booklet.pdf');

/** Where the spreads a booklet prints otherwise are kept: beside the deck, `.booklet-spreads` (and its HTML, its PNGs). */
export const bookletSpreadsPathOf = (pdfPath: string) => pdfPath.replace(/\.pdf$/i, '.booklet-spreads.pdf');

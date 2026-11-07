// Did the print come out whole?
//
// A PDF can come out short and still be a valid file. One context sheet in
// about a dozen, printed while other prints ran, lost every map layer above
// the zoning and its whole title-block column, and nothing in the file said
// so: Chromium had printed the page before it finished parsing its HTML
// (src/render/pdf.ts, open, which now waits for the page's load). So that no
// other way a print falls short is handed over either, the page says, before
// it is printed, what the PDF must hold, and the PDF is read back to see that
// it does:
//
//   loaded   the page had been parsed to its end, since a half-parsed page
//            promises only what it has reached;
//   pages    a deck's every slide, each a page of its own;
//   text     every element marked `data-print-check`, by its letters and
//            digits, on the page it prints on and as often as it shows
//            there: a sheet's title-block address and drawing title, a deck
//            page's number and title or its footer, which each page draws
//            last of all;
//   images   at least as many distinct pictures as the page draws, so a sheet
//            on an aerial that came out without its photograph is caught too.
//
// The PDF is read with pdf-lib, already a dependency, since the runtime image
// has no poppler: text through each font's ToUnicode map (Chromium writes one
// for every font, Type 3 and Type 0 alike), and through /ActualText where a
// ligature stands for several letters.

import { readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TITLE_X, SHEET_W } from './chrome.js';
import {
  PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream, PDFStream,
  decodePDFRawStream, type PDFObject,
} from 'pdf-lib';

// ---- what the page promises ---------------------------------------------------

/** What a page says its PDF must hold. */
export interface PrintExpectation {
  /** The text of each `data-print-check` element that prints, once per element, with the page (from 0) it prints on. */
  marks: { text: string; page: number }[];
  /** The URLs of the raster images drawn on the printed pages. */
  images: string[];
  /** How many pages the PDF must have: a deck's `section.slide`s, each a page, or the one page of a sheet. */
  pages: number;
  /**
   * Whether the document had been parsed to its end. A page read half parsed
   * names no more than it has reached, so its marks are no promise at all.
   */
  complete: boolean;
}

/**
 * Run in the page, before it is printed: the marked text and the pictures on
 * the first `maxPages` pages, each `pageHeightPx` tall (a sheet prints its
 * first page alone, a deck all of them). In a deck every `section.slide` is a
 * page of its own, so what is inside one is on that page. A mark counts when
 * it is shown, measured by its contents, so a mark around absolutely placed
 * children counts too. A picture counts when it is a raster, shown, and on a
 * printed page; one in <defs>, a pattern or a mask may never be drawn, so it
 * does not.
 */
export const EXPECTATION = `((pageHeightPx, maxPages) => {
  const sections = Array.from(document.querySelectorAll('section.slide'));
  const box = (el, contents) => {
    if (!contents) return el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };
  const pageOf = (el, r) => {
    const s = el.closest('section.slide');
    return s ? sections.indexOf(s) : Math.max(0, Math.floor((r.top + scrollY) / pageHeightPx));
  };
  const shown = (el, contents) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0) return -1;
      if (e.hidden) return -1;
    }
    const r = box(el, contents);
    if (!(r.width > 0 && r.height > 0 && r.bottom + scrollY > 0 && r.right > 0)) return -1;
    const page = pageOf(el, r);
    return page < maxPages ? page : -1;
  };
  const marks = [];
  for (const el of document.querySelectorAll('[data-print-check]')) {
    const text = (el.textContent || '').trim();
    const page = text ? shown(el, true) : -1;
    if (page >= 0) marks.push({ text, page });
  }
  const images = new Set();
  const raster = /^data:image\\/(png|jpe?g|webp|gif)[;,]|\\.(png|jpe?g|webp|gif)([?#].*)?$/i;
  for (const el of document.querySelectorAll('image, img')) {
    if (el.closest('defs, pattern, mask, clipPath, symbol, marker')) continue;
    const href = el.tagName.toLowerCase() === 'img'
      ? (el.complete && el.naturalWidth > 0 ? el.currentSrc || el.src : '')
      : (el.href && el.href.baseVal ? new URL(el.href.baseVal, document.baseURI).href : '');
    if (href && raster.test(href) && shown(el, false) >= 0) images.add(href);
  }
  const pages = Math.max(1, Math.min(sections.length || 1, maxPages));
  return { marks, images: [...images], pages, complete: document.readyState === 'complete' };
})`;

// ---- what the PDF holds -------------------------------------------------------

/** What a printed PDF holds: the text of each page, and its distinct pictures. */
export interface PdfContents {
  pages: string[];
  images: number;
}

type Value = number | boolean | null | Uint8Array | { name: string } | Value[] | { dict: Map<string, Value> } | { op: string };
const isName = (v: any): v is { name: string } => v && typeof v === 'object' && 'name' in v;
const isDict = (v: any): v is { dict: Map<string, Value> } => v && typeof v === 'object' && 'dict' in v;

// Each byte's class: 1 whitespace, 2 a delimiter, 0 anything else.
const CLS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) CLS[c] = 1;
for (const c of [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]) CLS[c] = 2;
const ESCAPES: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };

/**
 * The tokens of a content stream (or a CMap, which is written the same way),
 * one operator at a time with the operands before it: every operator, or
 * only those in `wanted`. Most of a drawing is paths, numbers and the
 * operators that draw them, which the check never reads: a number's value is
 * not kept (it stands as 0), and an operator not wanted is passed over
 * without a word to the caller, which reads a large deck several times as
 * fast.
 */
function* operations(src: Uint8Array, wanted?: Set<string>): Generator<{ op: string; args: Value[] }> {
  let i = 0;
  const n = src.length;
  const stack: Value[][] = [[]];          // arrays and dicts being built
  const push = (v: Value) => stack[stack.length - 1].push(v);
  const hex = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

  while (i < n) {
    const c = src[i];
    const cls = CLS[c];
    if (cls === 1) { i++; continue; }
    if (cls === 0) {
      // a number or an operator
      let j = i + 1;
      while (j < n && CLS[src[j]] === 0) j++;
      if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) { push(0); i = j; continue; }
      let word = '';
      for (let k = i; k < j; k++) word += String.fromCharCode(src[k]);
      i = j;
      if (word === 'true' || word === 'false') { push(word === 'true'); continue; }
      if (word === 'null') { push(null); continue; }
      if (stack.length > 1) { push({ op: word }); continue; }   // a keyword inside an array or dict: not an operator
      if (word === 'ID') {
        // inline image data runs to EI, between whitespace
        stack[0] = [];
        i++;
        while (i < n && !(src[i] === 0x45 && src[i + 1] === 0x49 && CLS[src[i - 1]] === 1 && (i + 2 >= n || CLS[src[i + 2]] === 1))) i++;
        i += 2;
        continue;
      }
      if (wanted && !wanted.has(word)) { stack[0].length = 0; continue; }
      const args = stack[0];
      stack[0] = [];
      yield { op: word, args };
      continue;
    }
    if (c === 0x25) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue; }      // % comment
    if (c === 0x2f) {                                                                         // /Name
      let j = i + 1;
      while (j < n && CLS[src[j]] === 0) j++;
      let name = '';
      for (let k = i + 1; k < j; k++) {
        if (src[k] === 0x23 && k + 2 < j && hex(src[k + 1]) >= 0 && hex(src[k + 2]) >= 0) { name += String.fromCharCode(hex(src[k + 1]) * 16 + hex(src[k + 2])); k += 2; }
        else name += String.fromCharCode(src[k]);
      }
      push({ name });
      i = j;
      continue;
    }
    if (c === 0x28) {                                                                         // (literal)
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const b = src[i];
        if (b === 0x5c) {
          const e = src[i + 1];
          if (e in ESCAPES) { out.push(ESCAPES[e]); i += 2; }
          else if (e >= 0x30 && e <= 0x37) {
            let v = 0, k = 0;
            while (k < 3 && src[i + 1 + k] >= 0x30 && src[i + 1 + k] <= 0x37) { v = v * 8 + src[i + 1 + k] - 0x30; k++; }
            out.push(v & 0xff);
            i += 1 + k;
          } else if (e === 13) { i += src[i + 2] === 10 ? 3 : 2; }
          else if (e === 10) { i += 2; }
          else { i += 1; }
          continue;
        }
        if (b === 0x28) depth++;
        else if (b === 0x29 && --depth === 0) { i++; break; }
        out.push(b);
        i++;
      }
      push(Uint8Array.from(out));
      continue;
    }
    if (c === 0x3c && src[i + 1] === 0x3c) { stack.push([]); i += 2; continue; }
    if (c === 0x3e && src[i + 1] === 0x3e) {
      const items = stack.length > 1 ? stack.pop()! : [];
      const dict = new Map<string, Value>();
      for (let k = 0; k + 1 < items.length; k += 2) if (isName(items[k])) dict.set((items[k] as { name: string }).name, items[k + 1]);
      push({ dict });
      i += 2;
      continue;
    }
    if (c === 0x3c) {                                                                         // <hex>
      const out: number[] = [];
      let hi = -1;
      i++;
      while (i < n && src[i] !== 0x3e) {
        const h = hex(src[i++]);
        if (h < 0) continue;
        if (hi < 0) hi = h; else { out.push(hi * 16 + h); hi = -1; }
      }
      if (hi >= 0) out.push(hi * 16);
      i++;
      push(Uint8Array.from(out));
      continue;
    }
    if (c === 0x5b) { stack.push([]); i++; continue; }
    if (c === 0x5d) { const items = stack.length > 1 ? stack.pop()! : []; push(items); i++; continue; }
    i++;                                                                                      // ) > { } out of place, or PostScript braces in a CMap
  }
}

/** The operators the text and the drawn forms are read from. */
const TEXT_OPS = new Set(['Tf', 'Tj', "'", '"', 'TJ', 'BMC', 'BDC', 'EMC', 'Do']);
/** The CMap operators a ToUnicode map is read from. */
const CMAP_OPS = new Set(['endcodespacerange', 'endbfchar', 'endbfrange']);

/** UTF-16BE, as a ToUnicode map and /ActualText (behind its BOM) write it. */
function utf16be(b: Uint8Array): string {
  let s = '';
  for (let k = 0; k + 1 < b.length; k += 2) s += String.fromCharCode((b[k] << 8) | b[k + 1]);
  return s;
}

/** A PDF text string: UTF-16BE behind a byte-order mark, else (near enough) Latin-1. */
function textString(b: Uint8Array): string {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return utf16be(b.subarray(2));
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder().decode(b.subarray(3));
  return String.fromCharCode(...b);
}

const bytesToNumber = (b: Uint8Array) => b.reduce((v, x) => v * 256 + x, 0);

interface FontReader { width: number; map: Map<number, string>; simple: boolean }

/** A ToUnicode CMap: codes to text, and how many bytes a code takes. */
function readCMap(src: Uint8Array): { width: number; map: Map<number, string> } {
  const map = new Map<number, string>();
  let width = 0;
  for (const { op, args } of operations(src, CMAP_OPS)) {
    if (op === 'endcodespacerange') {
      for (const a of args) if (a instanceof Uint8Array && a.length) { width = width || a.length; }
    } else if (op === 'endbfchar') {
      for (let k = 0; k + 1 < args.length; k += 2) {
        const [from, to] = [args[k], args[k + 1]];
        if (from instanceof Uint8Array && to instanceof Uint8Array) {
          map.set(bytesToNumber(from), utf16be(to));
          width = width || from.length;
        }
      }
    } else if (op === 'endbfrange') {
      for (let k = 0; k + 2 < args.length; k += 3) {
        const [lo, hi, to] = [args[k], args[k + 1], args[k + 2]];
        if (!(lo instanceof Uint8Array) || !(hi instanceof Uint8Array)) continue;
        const a = bytesToNumber(lo), b = bytesToNumber(hi);
        width = width || lo.length;
        if (b - a > 0xffff) continue;
        for (let code = a; code <= b; code++) {
          if (Array.isArray(to)) {
            const t = to[code - a];
            if (t instanceof Uint8Array) map.set(code, utf16be(t));
          } else if (to instanceof Uint8Array && to.length >= 2) {
            // the last UTF-16 unit counts up through the range
            const units = Array.from({ length: to.length >> 1 }, (_, u) => (to[2 * u] << 8) | to[2 * u + 1]);
            units[units.length - 1] += code - a;
            map.set(code, String.fromCharCode(...units));
          }
        }
      }
    }
  }
  return { width, map };
}

/**
 * The text a PDF's pages show, and how many distinct pictures it holds.
 * Pages run in order; within a page, text runs in the order it was drawn, so a
 * line set as one run reads as one string.
 */
export async function readPdf(src: string | Uint8Array): Promise<PdfContents> {
  const bytes = typeof src === 'string' ? await readFile(src) : src;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const ctx = doc.context;
  const look = (o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const decoded = (s: PDFObject | undefined): Uint8Array | undefined => {
    const st = look(s);
    if (st instanceof PDFRawStream) {
      try { return decodePDFRawStream(st).decode(); } catch { return undefined; }
    }
    if (st instanceof PDFStream) {
      try { return st.getContents(); } catch { return undefined; }
    }
    return undefined;
  };
  const dictOf = (o: PDFObject | undefined): PDFDict | undefined => {
    const v = look(o);
    if (v instanceof PDFDict) return v;
    if (v instanceof PDFStream) return v.dict;
    return undefined;
  };

  const fonts = new Map<PDFObject, FontReader>();
  const fontReader = (fontObj: PDFObject | undefined): FontReader => {
    const key = fontObj ?? PDFName.of('none');
    const known = fonts.get(key);
    if (known) return known;
    const d = dictOf(fontObj);
    const subtype = d?.lookup(PDFName.of('Subtype'));
    const simple = !(subtype instanceof PDFName && subtype.asString() === '/Type0');
    const tu = d ? decoded(d.get(PDFName.of('ToUnicode'))) : undefined;
    const cmap = tu ? readCMap(tu) : { width: 0, map: new Map<number, string>() };
    const reader = { width: cmap.width || (simple ? 1 : 2), map: cmap.map, simple };
    fonts.set(key, reader);
    return reader;
  };
  const show = (font: FontReader | undefined, b: Uint8Array): string => {
    if (!font) return String.fromCharCode(...b);
    let s = '';
    for (let k = 0; k + font.width <= b.length; k += font.width) {
      const code = bytesToNumber(b.subarray(k, k + font.width));
      s += font.map.get(code) ?? (font.simple ? String.fromCharCode(code) : '');
    }
    return s;
  };

  const pages: string[] = [];
  for (const page of doc.getPages()) {
    let text = '';
    const seen = new Set<PDFObject>();
    const run = (content: Uint8Array, resources: PDFDict | undefined, depth: number) => {
      let font: FontReader | undefined;
      // Marked content: a span with /ActualText stands for the glyphs inside it.
      const marks: boolean[] = [];
      let actual = 0;
      const emit = (s: string) => { if (!actual) text += s; };
      for (const { op, args } of operations(content, TEXT_OPS)) {
        switch (op) {
          case 'Tf': {
            const name = args[0];
            const fontDict = dictOf(resources?.get(PDFName.of('Font')));
            font = isName(name) ? fontReader(fontDict?.get(PDFName.of(name.name))) : undefined;
            break;
          }
          case 'Tj': case "'":
            if (args[0] instanceof Uint8Array) emit(show(font, args[0]));
            break;
          case '"':
            if (args[2] instanceof Uint8Array) emit(show(font, args[2]));
            break;
          case 'TJ':
            if (Array.isArray(args[0])) for (const part of args[0]) if (part instanceof Uint8Array) emit(show(font, part));
            break;
          case 'BMC': marks.push(false); break;
          case 'BDC': {
            let props: Map<string, Value> | undefined;
            if (isDict(args[1])) props = args[1].dict;
            const at = props?.get('ActualText');
            if (at instanceof Uint8Array) {
              if (!actual) text += textString(at);
              actual++;
              marks.push(true);
            } else marks.push(false);
            break;
          }
          case 'EMC':
            if (marks.pop()) actual--;
            break;
          case 'Do': {
            if (!isName(args[0]) || depth > 12) break;
            const xobjects = dictOf(resources?.get(PDFName.of('XObject')));
            const ref = xobjects?.get(PDFName.of(args[0].name));
            const xo = look(ref);
            if (!(xo instanceof PDFStream) || seen.has(xo)) break;
            const sub = xo.dict.lookup(PDFName.of('Subtype'));
            if (!(sub instanceof PDFName) || sub.asString() !== '/Form') break;
            seen.add(xo);
            const inner = decoded(xo);
            if (inner) run(inner, dictOf(xo.dict.get(PDFName.of('Resources'))) ?? resources, depth + 1);
            seen.delete(xo);
            break;
          }
        }
      }
    };
    const contents = look(page.node.get(PDFName.of('Contents')));
    const parts: Uint8Array[] = [];
    if (contents instanceof PDFArray) for (const c of contents.asArray()) { const b = decoded(c); if (b) parts.push(b); }
    else { const b = decoded(contents); if (b) parts.push(b); }
    const content = new Uint8Array(parts.reduce((s, p) => s + p.length + 1, 0));
    let off = 0;
    for (const p of parts) { content.set(p, off); off += p.length; content[off++] = 10; }
    run(content, page.node.Resources(), 0);
    pages.push(text);
  }

  // The pictures: image XObjects, less the soft masks that are only another's alpha.
  const images: PDFRawStream[] = [];
  const masks = new Set<PDFObject>();
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const sub = obj.dict.lookup(PDFName.of('Subtype'));
    if (!(sub instanceof PDFName) || sub.asString() !== '/Image') continue;
    images.push(obj as PDFRawStream);
    for (const key of ['SMask', 'Mask']) {
      const m = obj.dict.get(PDFName.of(key));
      if (m instanceof PDFRef) masks.add(ctx.lookup(m)!);
    }
  }
  return { pages, images: images.filter((im) => !masks.has(im)).length };
}

// ---- the comparison -----------------------------------------------------------

/**
 * Text reduced to its letters and digits, lower case: what survives the trip
 * through any font. Spacing, line breaks, a non-breaking space and a dash drawn
 * from a fallback font all fall away, so a match is a match of the words.
 */
export const letters = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const occurrences = (hay: string, needle: string) => {
  let n = 0;
  for (let k = hay.indexOf(needle); k >= 0; k = hay.indexOf(needle, k + needle.length)) n++;
  return n;
};

/**
 * The distinct pictures behind the page's images, by their bytes rather than
 * their names: Chromium writes a picture once however many times it is drawn,
 * and the same photograph under two names may be written once too. A picture
 * that cannot be read here (a remote URL) is not counted, so the count stays
 * one the PDF must reach.
 */
function distinctPictures(urls: string[]): number {
  const hashes = new Set<string>();
  for (const url of urls) {
    let bytes: Buffer | undefined;
    try {
      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        const meta = url.slice(5, comma);
        bytes = meta.endsWith(';base64') ? Buffer.from(url.slice(comma + 1), 'base64') : Buffer.from(decodeURIComponent(url.slice(comma + 1)));
      } else if (url.startsWith('file:')) {
        const path = fileURLToPath(url.replace(/[?#].*$/, ''));
        if (existsSync(path) && statSync(path).size > 0) bytes = readFileSync(path);
      }
    } catch { bytes = undefined; }
    if (bytes?.length) hashes.add(createHash('sha1').update(bytes).digest('hex'));
  }
  return hashes.size;
}

/**
 * What the page promised and the PDF does not hold, in words; empty when the
 * print is whole. Each mark is looked for on its own page, so one page's
 * footer cannot answer for another's.
 */
export function missingFromPdf(pdf: PdfContents, expect: PrintExpectation): string[] {
  const missing: string[] = [];
  if (!expect.complete) missing.push('whatever the page had not loaded yet when it printed');
  if (pdf.pages.length < expect.pages) missing.push(`${expect.pages - pdf.pages.length} of ${expect.pages} pages`);
  const hays = pdf.pages.map(letters);
  const wanted = new Map<string, { key: string; text: string; page: number; n: number }>();
  for (const m of expect.marks) {
    const key = letters(m.text);
    if (!key) continue;
    const w = wanted.get(`${m.page}:${key}`);
    if (w) w.n++; else wanted.set(`${m.page}:${key}`, { key, text: m.text.replace(/\s+/g, ' ').trim(), page: m.page, n: 1 });
  }
  for (const { key, text, page, n } of wanted.values()) {
    const found = occurrences(hays[page] ?? '', key);
    if (found >= n) continue;
    const where = expect.pages > 1 ? ` on page ${page + 1}` : '';
    missing.push(n === 1 ? `the text "${text}"${where}` : `the text "${text}"${where} (${found} of ${n})`);
  }
  const pictures = distinctPictures(expect.images);
  if (pdf.images < pictures) missing.push(`${pictures - pdf.images} of ${pictures} picture${pictures === 1 ? '' : 's'}`);
  return missing;
}

/** A print that came out without part of its page, twice. */
export class IncompletePrintError extends Error {
  constructor(readonly pdfPath: string, readonly missing: string[]) {
    super(`the PDF came out incomplete twice, without ${missing.join(', ')}; run it again`);
    this.name = 'IncompletePrintError';
  }
}

/** Reads the PDF back and names what it lacks. */
export async function checkPrint(pdfPath: string, expect: PrintExpectation): Promise<string[]> {
  return missingFromPdf(await readPdf(pdfPath), expect);
}

/**
 * The share of a sheet's title-block column that is ink, page one rasterised
 * at 15 dpi: about 0.12 for a whole A1 context sheet, 0.00 to 0.02 for one
 * whose print stopped short. The column alone, from its own left edge: the
 * right-hand 13 % of the page takes in the map's last 7 mm too, which on a
 * short print can still be drawn. A measure for looking at a print by hand
 * (scripts/print-stress.ts, test/print-check.mts), not part of the check: it
 * needs poppler's pdftoppm, which the runtime image does not carry, and is
 * undefined without it. "Ink" is darker than 230 of 255, so the column's fine
 * grey type at that resolution counts.
 */
export function titleColumnInk(pdfPath: string): number | undefined {
  const r = spawnSync('pdftoppm', ['-r', '15', '-f', '1', '-l', '1', '-gray', pdfPath], { maxBuffer: 64 << 20 });
  if (r.status !== 0 || !r.stdout?.length) return undefined;
  const pgm = r.stdout as Buffer;
  const head = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString('latin1'));
  if (!head) return undefined;
  const [w, h] = [Number(head[1]), Number(head[2])];
  const px = pgm.subarray(head[0].length);
  const x0 = Math.ceil(w * (TITLE_X / SHEET_W)) + 1;     // the column alone, clear of the map's edge
  let ink = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x < w; x++) if (px[y * w + x] < 230) ink++;
  return ink / ((w - x0) * h);
}

/** Where a PDF that failed its check is kept, out of the name anything serves. */
export const incompletePath = (pdfPath: string) => pdfPath.replace(/\.pdf$/i, '') + '.incomplete.pdf';

/**
 * Prints with `attempt`, which prints to `pdfPath` and returns what the PDF
 * lacks, and prints once more if it lacks anything: the browser is closed in
 * between, which gives its memory back, and the second print waits its turn
 * for a slot like any other. A second incomplete print throws, and the PDF is
 * moved aside, so that what is left under its name is never a sheet with its
 * map half drawn: a job that fails says so, a job that is done is whole.
 */
export async function printWhole(pdfPath: string, attempt: () => Promise<string[]>, log: (m: string) => void): Promise<void> {
  const first = await attempt();
  if (!first.length) return;
  log(`WARN the PDF came out without ${first.join(', ')}; printing it again`);
  const second = await attempt();
  if (!second.length) return;
  await rename(pdfPath, incompletePath(pdfPath)).catch(() => {});
  throw new IncompletePrintError(incompletePath(pdfPath), second);
}

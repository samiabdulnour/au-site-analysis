// Print the composed sheet to PDF with the pre-installed Chromium.

import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHEET_W, SHEET_H } from './sheet.js';
import { acquire } from '../lib/slots.js';
import { EXPECTATION, checkPrint, printWhole, type PrintExpectation } from './printCheck.js';
import { imposeBooklet, bookletPathOf, bookletSpreadsPathOf, type BookletSpreads } from './booklet.js';
import { writeFile, readFile } from 'node:fs/promises';

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'];
  for (const root of roots) {
    // a root where `chromium` is a file, not a folder (one Playwright layout), makes the glob throw rather than miss;
    // Playwright's newer builds unpack to chrome-linux64, the older ones to chrome-linux
    const find = (pattern: string) => { try { return globSync(pattern); } catch { return [] as string[]; } };
    for (const pattern of [`${root}/chromium-*/chrome-linux/chrome`, `${root}/chromium-*/chrome-linux64/chrome`, `${root}/chromium/chrome-linux/chrome`, `${root}/chromium/chrome-linux64/chrome`]) {
      const hits = find(pattern);
      if (hits.length) return hits[0];
    }
    if (existsSync(`${root}/chromium`)) {
      const hits = find(`${root}/chromium/**/chrome`);
      if (hits.length) return hits[0];
    }
  }
  return undefined;
}

/**
 * A browser, once a print slot is free (src/lib/slots.ts). A job's memory
 * peaks here, at several hundred megabytes for an A1 sheet, so with jobs side
 * by side it is the number of browsers open at once, not the number of jobs,
 * that the machine has to hold. The slot goes back when the browser closes or
 * dies, whichever comes first.
 */
export async function launch(extraArgs: string[] = []): Promise<Browser> {
  const release = await acquire('chromium');
  try {
    const executablePath = findChromium();
    const args = [...(process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), ...extraArgs];
    const browser = await chromium.launch({ executablePath, headless: true, args });
    browser.on('disconnected', release);
    return browser;
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * A page's HTML, opened and waited for until all of it is there: parsed, its
 * pictures in, nothing more being fetched, its fonts ready.
 *
 * Not on Playwright's 'networkidle' alone, which these pages were opened on
 * and which counts from the last request in flight, not from the document's
 * load. A sheet is one local file with its pictures beside it: the file is
 * read in one request, and on a machine busy with other prints its 1.5 MB of
 * SVG can still be parsing when 500 ms have passed with nothing in flight.
 * The print then took the document as far as it had been parsed: a context
 * sheet with its map up to the zoning and a blank title block, a valid PDF,
 * about one print in a dozen with four or eight printing at once
 * (scripts/print-stress.ts). 'load' waits for the parser and for every
 * picture, which delay it; the network then settles for anything asked for
 * after it.
 */
async function open(page: Page, htmlPath: string): Promise<void> {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 120_000 });
  await page.evaluate(() => (document as any).fonts?.ready.then(() => true));
  await greyPhotos(page, htmlPath);
}

/**
 * A drawing that asks for its photographs in grey (Heron, black and white and one colour: `--photos: grey` on its
 * root) has each one made grey in the page before it prints: the aerials, the street, the places, every picture it
 * takes from beside it (`data/…`). Each is read here, its pixels made grey in a canvas and put back as a JPEG (a PNG
 * where it may be transparent), so the PDF keeps a compressed photograph. A CSS filter on the pictures would do it
 * on the screen, but in print Chromium rasterises the page round a filtered picture, uncompressed: the report went
 * from 49 to 121 MB.
 */
async function greyPhotos(page: Page, htmlPath: string): Promise<void> {
  const want = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--photos').trim() === 'grey');
  if (!want) return;
  // (a part of the page that keeps its photographs' colours says so, `data-photos="colour"`: the streetscape's faces)
  const refs: string[] = await page.evaluate(() => [...new Set([
    ...[...document.querySelectorAll('img')].filter((el) => !el.closest('[data-photos="colour"]')).map((el) => el.getAttribute('src')),
    ...[...document.querySelectorAll('image')].filter((el) => !el.closest('[data-photos="colour"]')).map((el) => el.getAttribute('href')),
  ].filter((r): r is string => !!r && r.startsWith('data/')))]);
  const dir = dirname(htmlPath);
  for (const ref of refs) {
    let bytes: Buffer;
    try { bytes = await readFile(join(dir, decodeURI(ref))); } catch { continue; }
    const png = /\.png$/i.test(ref);
    await page.evaluate(async ({ ref, b64, png }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([raw], { type: png ? 'image/png' : 'image/jpeg' }));
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d')!;
      cx.drawImage(bmp, 0, 0);
      const img = cx.getImageData(0, 0, cv.width, cv.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      cx.putImageData(img, 0, 0);
      const url = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9);
      // decoded before it goes in, so the print does not catch a picture still loading
      const probe = new Image();
      probe.src = url;
      await probe.decode();
      for (const el of document.querySelectorAll('img')) if (el.getAttribute('src') === ref && !el.closest('[data-photos="colour"]')) el.setAttribute('src', url);
      for (const el of document.querySelectorAll('image')) if (el.getAttribute('href') === ref && !el.closest('[data-photos="colour"]')) el.setAttribute('href', url);
    }, { ref, b64: bytes.toString('base64'), png });
  }
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.decode().catch(() => undefined))));
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true)))));
}

/**
 * How wide, in pixels, the picture of a finished drawing is that the page shows
 * once it is done: the drawing at a glance, the size of the examples (the
 * frame's width on a 2× screen, sharp there), and nowhere near enough to
 * print. An A1 PDF can be tens of megabytes; this is under a megabyte, so the
 * result shows at once.
 */
export const PREVIEW_WIDTH = 2400;

/**
 * A sheet, printed and then read back (src/render/printCheck.ts): a PDF can
 * come out short and still be a valid file, so the page names what must be in
 * it, and a print without it is printed again, once, and then fails the job
 * rather than being handed over.
 */
export async function htmlToPdf(htmlPath: string, pdfPath: string, previewPath?: string, log: (m: string) => void = console.warn): Promise<void> {
  await printWhole(pdfPath, () => printSheetOnce(htmlPath, pdfPath, previewPath), log);
}

/**
 * One print of a sheet, read back: what its PDF lacks, empty when it is
 * whole. The picture is taken only of a whole print, in the same browser.
 * htmlToPdf's single attempt, and what scripts/print-stress.ts runs side by side.
 */
export async function printSheetOnce(htmlPath: string, pdfPath: string, previewPath?: string): Promise<string[]> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await open(page, htmlPath);
    // Only the first page is printed, so only what is on it is expected.
    const expected: PrintExpectation = await page.evaluate(`${EXPECTATION}(${(SHEET_H / 25.4) * 96}, 1)`);
    await page.pdf({
      path: pdfPath,
      width: `${SHEET_W}mm`,
      height: `${SHEET_H}mm`,
      printBackground: true,
      pageRanges: '1',
    });
    const missing = await checkPrint(pdfPath, expected);
    if (missing.length) return missing;
    if (previewPath) {
      // The sheet again in a page of its printed size, laid out for print as
      // the PDF was, and scaled down as it is drawn rather than afterwards.
      // A drawing without its picture is still a drawing, so a failure here
      // costs the picture and nothing else.
      try {
        const width = Math.ceil((SHEET_W / 25.4) * 96), height = Math.ceil((SHEET_H / 25.4) * 96);
        const shot = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: PREVIEW_WIDTH / width });
        await shot.emulateMedia({ media: 'print' });
        await open(shot, htmlPath);
        await shot.screenshot({ path: previewPath, type: 'jpeg', quality: 80 });
      } catch { /* no picture this time */ }
    }
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * A page of one fixed pixel size (the capacity study's sheet) as a PNG at that
 * size and, when asked, a one-page PDF of the same size, from one browser.
 */
export async function printPage(
  htmlPath: string,
  size: { width: number; height: number },
  out: { png?: string; pdf?: string },
): Promise<void> {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: size });
    await open(page, htmlPath);
    if (out.png) await page.screenshot({ path: out.png, type: 'png' });
    if (out.pdf) await page.pdf({ path: out.pdf, width: `${size.width}px`, height: `${size.height}px`, printBackground: true, pageRanges: '1' });
  } finally {
    await browser.close();
  }
}

/** A page drawn at one fixed size, such as the link-preview card, as a JPEG of its viewport. */
export async function htmlToJpeg(
  htmlPath: string,
  jpgPath: string,
  size: { width: number; height: number },
  quality: number,
): Promise<void> {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: size });
    await open(page, htmlPath);
    await page.screenshot({ path: jpgPath, type: 'jpeg', quality });
  } finally {
    await browser.close();
  }
}

/**
 * Run in the page before it is printed, where the text is actually measured
 * (a string, because the page's DOM is not this program's).
 *
 * A box marked `data-fit` (the sources table) holds more than its fixed
 * height can promise, and it clips: its first child's type steps down until
 * nothing is hidden, to three quarters of its size, rather than losing the
 * last rows unseen. Where even that is not enough, the rows that would be
 * cut are hidden whole (a heading left without its rows with them) and the
 * box's `data-fit-note` element is shown under the last one, its
 * `data-text` with {n} for the rows left out.
 *
 * A text column whose paragraphs would run into its fine print steps its
 * type down too, to seven eighths of its size: the fine print stays where
 * it is and whole. So do the planning yield's tables where they would run
 * into the page's key, to four fifths of theirs.
 */
const FIT_BOXES = `(() => {
  for (const box of document.querySelectorAll('[data-fit]')) {
    const inner = box.firstElementChild;
    if (!inner) continue;
    const base = parseFloat(getComputedStyle(inner).fontSize);
    for (let k = 1; box.scrollHeight > box.clientHeight + 1 && k > 0.76; ) {
      k -= 0.025;
      inner.style.fontSize = (base * k).toFixed(3) + 'px';
    }
    const note = box.dataset.fitNote ? document.getElementById(box.dataset.fitNote) : null;
    if (!note || box.scrollHeight <= box.clientHeight + 1) continue;
    note.hidden = false;
    const limit = box.getBoundingClientRect().bottom - note.getBoundingClientRect().height - 2;
    const rows = Array.from(box.querySelectorAll('tbody tr'));
    const shown = [];
    let left = 0;
    for (const r of rows) {
      if (r.getBoundingClientRect().bottom > limit) { r.style.visibility = 'hidden'; if (!r.classList.contains('grp')) left++; }
      else shown.push(r);
    }
    while (shown.length && shown[shown.length - 1].classList.contains('grp')) shown.pop().style.visibility = 'hidden';
    const last = shown[shown.length - 1];
    const top = last ? last.getBoundingClientRect().bottom : box.getBoundingClientRect().top;
    note.textContent = (note.dataset.text || '{n} more').replace('{n}', String(left));
    note.style.top = (top - note.offsetParent.getBoundingClientRect().top + 2).toFixed(1) + 'px';
  }
  // a yield spread whose tables run into its key (three tiers, a long key, the sun's rows) closes them up a little,
  // to four fifths of their size, keeping 1.5 mm clear of the key
  for (const flow of document.querySelectorAll('.zflow')) {
    const key = flow.closest('.slide') && flow.closest('.slide').querySelector('.zleg');
    const tables = Array.from(flow.querySelectorAll('table.yt'));
    if (!key || !tables.length) continue;
    const over = () => flow.getBoundingClientRect().bottom > key.getBoundingClientRect().top - 5.7;
    const base = tables.map((t) => parseFloat(getComputedStyle(t).fontSize));
    for (let k = 1; over() && k > 0.81; ) {
      k -= 0.025;
      tables.forEach((t, i) => { t.style.fontSize = (base[i] * k).toFixed(3) + 'px'; });
    }
  }
  // a slide's text column whose paragraphs run into its fine print (a long list of views, a busy council) closes up a little
  for (const col of document.querySelectorAll('.text')) {
    const fine = Array.from(col.children).find((c) => c.classList.contains('fine'));
    const flow = Array.from(col.children).filter((c) => c !== fine);
    if (!fine || !flow.length) continue;
    const over = () => Math.max(...flow.map((c) => c.getBoundingClientRect().bottom)) > fine.getBoundingClientRect().top - 4;
    const base = parseFloat(getComputedStyle(col).fontSize);
    for (let k = 1; over() && k > 0.88; ) {
      k -= 0.025;
      col.style.fontSize = (base * k).toFixed(3) + 'px';
    }
  }
})()`;

/**
 * A paragraph set in two columns that must both end on one line (Z. 2026-11): CSS columns fill top down and leave
 * the second a line short. A box marked `data-split` holds two columns, the paragraph in the first; the lines are
 * counted as the browser set them, and from the first word of the line after the larger half on, the words move to
 * the second column, which the box then stands on the same foot as the first. A line that begins inside a word the
 * browser hyphenated starts the second column at that whole word.
 */
const SPLIT_COLUMNS = `(() => {
  for (const box of document.querySelectorAll('[data-split]')) {
    const [a, b] = box.children;
    const text = a && a.firstChild;
    if (!b || !text || text.nodeType !== 3 || a.childNodes.length !== 1) continue;
    const range = document.createRange();
    range.selectNodeContents(a);
    const lines = Array.from(range.getClientRects()).filter((q) => q.width > 0);
    if (lines.length < 2) continue;
    const cutTop = lines[Math.ceil(lines.length / 2)].top;
    const s = text.data;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(text, mid); range.setEnd(text, mid + 1);
      if (range.getBoundingClientRect().top >= cutTop - 0.5) hi = mid; else lo = mid + 1;
    }
    let cut = lo;
    if (cut > 0 && s[cut - 1] !== ' ') { const sp = s.lastIndexOf(' ', cut - 1); if (sp > 0) cut = sp + 1; }
    if (cut <= 0 || cut >= s.length) continue;
    a.textContent = s.slice(0, cut).replace(/ +$/, '');
    b.textContent = s.slice(cut);
    b.hidden = false;
  }
})()`;

/**
 * The atlas's last line (Z. 2026-11). A page marks it in `data-base`, in mm from its top, and marks what must end on
 * it with `data-settle`: the sources, the key, a right page's closing note. Each is measured as the browser set it —
 * the baseline of its lowest words, or the foot of its lowest symbol, whichever is lower — and moved by the difference,
 * so the words and the symbols end on one line whatever their number of lines and whatever the symbol's shape. It
 * moves by its `bottom`, or by its `top` where it is marked `data-settle="top"`.
 */
const SETTLE_BASE = `(() => {
  const PX_PER_MM = 96 / 25.4;
  // Arial and its metric twins hang 0.212 em below the baseline, which the browser lays out rounded to the pixel
  const DESCENT = 0.212;
  const lowestInk = (root) => {
    let low = -Infinity;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const host = n.parentElement;
      if (!host || !n.textContent.trim() || host.closest('svg')) continue;
      const st = getComputedStyle(host);
      if (st.visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const q of range.getClientRects()) if (q.width > 0) low = Math.max(low, q.bottom - Math.round(DESCENT * parseFloat(st.fontSize)));
    }
    for (const svg of root.querySelectorAll('svg')) {
      const sr = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
      const k = vb && vb.width ? Math.min(sr.width / vb.width, sr.height / vb.height) : 1;
      for (const el of svg.querySelectorAll('rect, circle, ellipse, path, line, polyline, polygon')) {
        // a pattern's strokes stay inside the clip of the shape they fill, whose ground or outline is drawn too
        if (el.closest('clipPath, defs, pattern, mask, [clip-path]')) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        const stroked = st.stroke !== 'none' && parseFloat(st.strokeWidth) > 0;
        const filled = st.fill !== 'none' && el.tagName !== 'line' && el.tagName !== 'polyline';
        if (!stroked && !filled) continue;
        const b = el.getBoundingClientRect();
        low = Math.max(low, b.bottom + (stroked ? (parseFloat(st.strokeWidth) * k) / 2 : 0));
      }
    }
    return low;
  };
  for (const slide of document.querySelectorAll('section.slide[data-base]')) {
    const line = slide.getBoundingClientRect().top + parseFloat(slide.dataset.base) * PX_PER_MM;
    for (const el of slide.querySelectorAll('[data-settle]')) {
      const low = lowestInk(el);
      if (!Number.isFinite(low)) continue;
      const shift = line - low;
      if (Math.abs(shift) < 0.02 || Math.abs(shift) > 8 * PX_PER_MM) continue;
      const st = getComputedStyle(el);
      if (el.dataset.settle === 'top') el.style.top = (parseFloat(st.top) + shift).toFixed(3) + 'px';
      else el.style.bottom = (parseFloat(st.bottom) - shift).toFixed(3) + 'px';
    }
  }
})()`;

/**
 * Run in the page once it is fitted and settled: the yield's spreads whose text column still stands on its key, each
 * by its page's id and the millimetres its last block runs past the key's top. The tables close up by a fifth and no
 * more (FIT_BOXES), so a column that needs more than that has more in it than its page holds, and its rows print
 * through the key's (2–4 Culworth Avenue, Killara: a table of the criteria under a compliance sheet's three others).
 * Nothing here moves anything: the print says so, and the page's composition is what has to change.
 */
const FLOW_OVERRUNS = `(() => {
  const PX_PER_MM = 96 / 25.4;
  const out = [];
  for (const flow of document.querySelectorAll('.zflow')) {
    const slide = flow.closest('.slide');
    const key = slide && slide.querySelector('.zleg');
    const last = flow.lastElementChild;
    if (!key || !last || !flow.querySelector('table.yt')) continue;
    const by = (last.getBoundingClientRect().bottom - key.getBoundingClientRect().top) / PX_PER_MM;
    if (by > 0.05) out.push({ id: slide.id, byMm: Math.round(by * 10) / 10 });
  }
  return out;
})()`;

/** A text column that stands on its page's key after the fitting: the page's id, and by how many millimetres. */
export interface FlowOverrun { id: string; byMm: number }

/**
 * A deck's pages fitted in the browser, as they are before they print: the boxes fitted, the split columns split,
 * the last lines settled, in that order. Returns the text columns that still stand on their keys (FLOW_OVERRUNS),
 * none on a deck composed within its pages.
 */
export async function fitSlides(page: Page): Promise<FlowOverrun[]> {
  await page.evaluate(FIT_BOXES);
  await page.evaluate(SPLIT_COLUMNS);
  await page.evaluate(SETTLE_BASE);
  return await page.evaluate(FLOW_OVERRUNS) as FlowOverrun[];
}

/**
 * A deck: every `.slide` section becomes one page of the PDF, and — in the
 * same browser session — one PNG, named after the section's id, for the
 * office's InDesign or PowerPoint. Returns the PNG paths written.
 *
 * The PDF is read back as a sheet's is (src/render/printCheck.ts): every page
 * there, each with its marked number and title or footer, and every picture.
 * A short print is printed again, PNGs and all, once, and then fails the job.
 */
export async function printSlides(
  htmlPath: string,
  pdfPath: string,
  pngDir: string,
  size: { widthMm: number; heightMm: number },
  previewPath?: string,
  log: (m: string) => void = console.warn,
): Promise<string[]> {
  let pngs: string[] = [];
  await printWhole(pdfPath, async () => {
    const once = await printSlidesOnce(htmlPath, pdfPath, pngDir, size, previewPath, log);
    pngs = once.pngs;
    return once.missing;
  }, log);
  return pngs;
}

/** One print of a deck, read back: its PNGs, and what its PDF lacks (the PNGs are only made of a whole print). */
async function printSlidesOnce(
  htmlPath: string,
  pdfPath: string,
  pngDir: string,
  size: { widthMm: number; heightMm: number },
  previewPath?: string,
  log: (m: string) => void = console.warn,
): Promise<{ pngs: string[]; missing: string[] }> {
  const browser = await launch();
  const pngs: string[] = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await open(page, htmlPath);
    // a column the fitting could not keep off its key still prints, and is said: its rows are under the key's
    for (const o of await fitSlides(page)) log(`WARN page ${o.id}: its text column runs ${o.byMm} mm into its key`);
    // After the boxes are fitted and the lines settled: a row they hid is not expected.
    const expected: PrintExpectation = await page.evaluate(`${EXPECTATION}(${(size.heightMm / 25.4) * 96}, Infinity)`);
    await page.pdf({
      path: pdfPath,
      width: `${size.widthMm}mm`,
      height: `${size.heightMm}mm`,
      printBackground: true,
    });
    const missing = await checkPrint(pdfPath, expected);
    if (missing.length) return { pngs, missing };
    mkdirSync(pngDir, { recursive: true });
    const sections = page.locator('section.slide');
    const n = await sections.count();
    for (let i = 0; i < n; i++) {
      const el = sections.nth(i);
      const id = (await el.getAttribute('id')) || `slide_${String(i + 1).padStart(2, '0')}`;
      const file = join(pngDir, `${id.replace(/[^a-z0-9_-]/gi, '_')}.png`);
      // A page is 297 mm, not a whole number of pixels: shot by its own box it takes in the
      // last row of the page before, a hairline of whatever bled to that page's foot. Rounded inward.
      const bb = await el.boundingBox();
      if (bb) {
        const y0 = Math.ceil(bb.y), y1 = Math.floor(bb.y + bb.height);
        await page.screenshot({ path: file, type: 'png', fullPage: true, clip: { x: Math.round(bb.x), y: y0, width: Math.round(bb.width), height: y1 - y0 } });
      } else await el.screenshot({ path: file, type: 'png' });
      pngs.push(file);
    }
    // The deck's picture is its first page at the PNGs' two pixels to the CSS
    // pixel: about 3200 px across an A3 page, the frame's width on a 2× screen
    // with room to spare, as the sheets' previews are (PREVIEW_WIDTH).
    if (previewPath && n) {
      await sections.first().screenshot({ path: previewPath, type: 'jpeg', quality: 80, scale: 'device' })
        .catch(() => { /* no picture this time */ });
    }
  } finally {
    await browser.close();
  }
  return { pngs, missing: [] };
}

/**
 * A deck's booklet (src/render/booklet.ts) beside its PDF. The spreads it prints otherwise (the report's built form,
 * its site moved off the fold) are printed first, beside the deck as `.booklet-spreads` with their HTML and PNGs;
 * then the deck is imposed with them in their places. Returns the booklet's path.
 */
export async function printBooklet(
  deckPdf: string,
  spreads: BookletSpreads | undefined,
  size: { widthMm: number; heightMm: number },
  log: (m: string) => void = console.warn,
): Promise<string> {
  const dest = bookletPathOf(deckPdf);
  let alt: { path: string; pages: number[] } | undefined;
  if (spreads?.spreads.length) {
    const path = bookletSpreadsPathOf(deckPdf), stem = path.replace(/\.pdf$/i, '');
    await writeFile(`${stem}.html`, spreads.html);
    await printSlides(`${stem}.html`, path, stem, size, undefined, log);
    alt = { path, pages: spreads.spreads };
  }
  await imposeBooklet(deckPdf, dest, { spreads: alt });
  return dest;
}

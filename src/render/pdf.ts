// Print the composed sheet to PDF with the pre-installed Chromium.

import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHEET_W, SHEET_H } from './sheet.js';
import { acquire } from '../lib/slots.js';
import { EXPECTATION, checkPrint, printWhole, type PrintExpectation } from './printCheck.js';

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
    const once = await printSlidesOnce(htmlPath, pdfPath, pngDir, size, previewPath);
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
): Promise<{ pngs: string[]; missing: string[] }> {
  const browser = await launch();
  const pngs: string[] = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await open(page, htmlPath);
    await page.evaluate(FIT_BOXES);
    await page.evaluate(SPLIT_COLUMNS);
    await page.evaluate(SETTLE_BASE);
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

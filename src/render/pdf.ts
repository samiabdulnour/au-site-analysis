// Print the composed sheet to PDF with the pre-installed Chromium.

import { chromium, type Browser } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHEET_W, SHEET_H } from './sheet.js';
import { acquire } from '../lib/slots.js';

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'];
  for (const root of roots) {
    // Playwright's newer builds unpack to chrome-linux64; the older ones to chrome-linux.
    for (const pattern of [`${root}/chromium-*/chrome-linux/chrome`, `${root}/chromium-*/chrome-linux64/chrome`, `${root}/chromium/chrome-linux/chrome`, `${root}/chromium/chrome-linux64/chrome`]) {
      const hits = globSync(pattern);
      if (hits.length) return hits[0];
    }
    if (existsSync(`${root}/chromium`)) {
      const hits = globSync(`${root}/chromium/**/chrome`);
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
async function launch(): Promise<Browser> {
  const release = await acquire('chromium');
  try {
    const executablePath = findChromium();
    const args = process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
    const browser = await chromium.launch({ executablePath, headless: true, args });
    browser.on('disconnected', release);
    return browser;
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * How wide, in pixels, the picture of a finished drawing is that the page shows
 * once it is done: the drawing at a glance, about the size of the examples, and
 * nowhere near enough to print. An A1 PDF can be tens of megabytes; this is a
 * few hundred kilobytes, so the result shows at once.
 */
export const PREVIEW_WIDTH = 1200;

export async function htmlToPdf(htmlPath: string, pdfPath: string, previewPath?: string): Promise<void> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.pdf({
      path: pdfPath,
      width: `${SHEET_W}mm`,
      height: `${SHEET_H}mm`,
      printBackground: true,
      pageRanges: '1',
    });
    if (previewPath) {
      // The sheet again in a page of its printed size, laid out for print as
      // the PDF was, and scaled down as it is drawn rather than afterwards.
      // A drawing without its picture is still a drawing, so a failure here
      // costs the picture and nothing else.
      try {
        const width = Math.ceil((SHEET_W / 25.4) * 96), height = Math.ceil((SHEET_H / 25.4) * 96);
        const shot = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: PREVIEW_WIDTH / width });
        await shot.emulateMedia({ media: 'print' });
        await shot.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 120_000 });
        await shot.screenshot({ path: previewPath, type: 'jpeg', quality: 80 });
      } catch { /* no picture this time */ }
    }
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
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 120_000 });
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
 * it is and whole.
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
 * A deck: every `.slide` section becomes one page of the PDF, and — in the
 * same browser session — one PNG, named after the section's id, for the
 * office's InDesign or PowerPoint. Returns the PNG paths written.
 */
export async function printSlides(
  htmlPath: string,
  pdfPath: string,
  pngDir: string,
  size: { widthMm: number; heightMm: number },
  previewPath?: string,
): Promise<string[]> {
  const browser = await launch();
  const pngs: string[] = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.evaluate(FIT_BOXES);
    await page.pdf({
      path: pdfPath,
      width: `${size.widthMm}mm`,
      height: `${size.heightMm}mm`,
      printBackground: true,
    });
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
    // The deck's picture is its first page, at one pixel to the CSS pixel
    // rather than the PNGs' two.
    if (previewPath && n) {
      await sections.first().screenshot({ path: previewPath, type: 'jpeg', quality: 80, scale: 'css' })
        .catch(() => { /* no picture this time */ });
    }
  } finally {
    await browser.close();
  }
  return pngs;
}

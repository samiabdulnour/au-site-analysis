// Print the composed sheet to PDF with the pre-installed Chromium.

import { chromium, type Browser } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHEET_W, SHEET_H } from './sheet.js';

function findChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'];
  for (const root of roots) {
    for (const pattern of [`${root}/chromium-*/chrome-linux/chrome`, `${root}/chromium/chrome-linux/chrome`]) {
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

async function launch(): Promise<Browser> {
  const executablePath = findChromium();
  const args = process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
  return chromium.launch({ executablePath, headless: true, args });
}

export async function htmlToPdf(htmlPath: string, pdfPath: string): Promise<void> {
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
  } finally {
    await browser.close();
  }
}

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
): Promise<string[]> {
  const browser = await launch();
  const pngs: string[] = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle', timeout: 120_000 });
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
      await el.screenshot({ path: file, type: 'png' });
      pngs.push(file);
    }
  } finally {
    await browser.close();
  }
  return pngs;
}

// Print the composed sheet to PDF with the pre-installed Chromium.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { globSync } from 'node:fs';
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

export async function htmlToPdf(htmlPath: string, pdfPath: string): Promise<void> {
  const executablePath = findChromium();
  const args = process.env.CHROMIUM_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
  const browser = await chromium.launch({ executablePath, headless: true, args });
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

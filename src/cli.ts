// CLI: npm run generate -- "26-30 Campsie St, Campsie NSW 2194" [--scale 3000] …

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Load .env (TFNSW_API_KEY etc.) without a dependency.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
import { runPipeline } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { htmlToPdf } from './render/pdf.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const address = process.argv.slice(2).find((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1]?.startsWith('--') !== true);
if (!address) {
  console.error('usage: npm run generate -- "<address>" [--scale 3000] [--job N] [--client X] [--status S] [--sheet "DA 003"]');
  process.exit(1);
}

const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join('out', slug);

const office = JSON.parse(await readFile('config/office.json', 'utf8'));

// All identifying fields default to blank — the sheet is a template the
// office completes per project (pass --job/--client/--status/… to fill).
const meta: SheetMeta = {
  jobNo: arg('job', '')!,
  client: arg('client', '')!,
  status: arg('status', '')!,
  sheetNo: arg('sheet', '')!,
  revision: arg('revision', '')!,
  checked: arg('checked', '')!,
  drawn: arg('drawn', '')!,
  date: arg('date', '')!,
  preliminary: (arg('status', '') ?? '').toUpperCase().includes('PRELIM'),
  office,
};

const bundle = await runPipeline(address, {
  scale: Number(arg('scale', '3000')),
  mapWidthMm: MAP_W,
  mapHeightMm: MAP_H,
  outDir,
  log: (m) => console.log(m),
});

console.log('composing sheet…');
const html = renderSheet(bundle, meta);
const htmlPath = join(outDir, 'sheet.html');
await writeFile(htmlPath, html);

console.log('printing PDF…');
const pdfPath = join(outDir, 'CONTEXT_ANALYSIS.pdf');
await htmlToPdf(htmlPath, pdfPath);
console.log(`done:\n  ${htmlPath}\n  ${pdfPath}`);

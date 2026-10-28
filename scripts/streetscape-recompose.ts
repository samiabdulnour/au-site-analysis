// Compose the streetscape's faces again from the frames already fetched, and
// draw the sheet again, without asking Google or the NSW services for
// anything: after a change to src/py/streetscape_montage.py or the sheet.
//   npm run generate -- "<address>" --type streetscape --source montage   (once)
//   npx tsx scripts/streetscape-recompose.ts out/<slug> [--no-sky] [--skip-drives 2024-10] [--calibrate]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composeMontages } from '../src/render/montage.js';
import { renderStreetscape } from '../src/render/streetscape.js';
import { printSlides } from '../src/render/pdf.js';
import { SLIDE_W, SLIDE_H } from '../src/render/slides.js';
import { FRAME_REACH_M } from '../src/fetch/streetscape.js';
import type { StreetscapeBundle } from '../src/pipeline.js';
import type { SheetMeta } from '../src/render/sheet.js';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: npx tsx scripts/streetscape-recompose.ts out/<slug> [--no-sky]'); process.exit(1); }
const bundlePath = join(outDir, 'data', 'streetscape_bundle.json');
const b = JSON.parse(await readFile(bundlePath, 'utf8')) as StreetscapeBundle;
if (!b.frames.length) { console.error('the bundle holds no Street View frames to compose'); process.exit(1); }
const started = Date.now();
const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const skipDrives = (flag('--skip-drives') ?? process.env.STREETSCAPE_SKIP_DRIVES)?.split(',').map((d) => d.trim()).filter(Boolean);
const montages = await composeMontages(b.plan, b.frames, join(outDir, 'data'), { reachM: FRAME_REACH_M, sky: !process.argv.includes('--no-sky'), skipDrives, calibrate: process.argv.includes('--calibrate'), log: (m) => console.log(m) });
for (const [i, m] of (montages ?? []).entries()) {
  if (m) console.log(`  face ${i}: ${m.panoramas} of ${m.candidates} panoramas (${m.drive ? `the ${m.drive} drive first; ` : ''}${m.dates.join(', ')}), ${Math.round(m.columnsCovered * 100)} % reached, foliage ${Math.round(m.foliageShare * 100)} %, sky ${Math.round(m.skyShare * 100)} %`);
}
b.montages = montages ?? undefined;
b.elevations = undefined;
b.generatedAt = new Date().toISOString();
await writeFile(bundlePath, JSON.stringify(b));
const meta: SheetMeta = { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false };
const htmlPath = join(outDir, 'streetscape.html');
await writeFile(htmlPath, renderStreetscape(b, meta));
const pngs = await printSlides(htmlPath, join(outDir, 'STREETSCAPE.pdf'), outDir, { widthMm: SLIDE_W, heightMm: SLIDE_H });
console.log(`recomposed in ${((Date.now() - started) / 1000).toFixed(0)} s: ${pngs.join(', ')}`);

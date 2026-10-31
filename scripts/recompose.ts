// Re-compose a deck from a kept bundle, without fetching anything.
//   KEEP_BUNDLE=1 npm run generate -- "<address>" --type slides|yield      (once)
//   npx tsx scripts/recompose.ts out/<slug> [--sheet slides|yield] [--theme flamingo|kingfisher|heron|canary] [--only 01,03]
// The pages go beside the deck as <sheet>-<theme>.html/.pdf and a folder of PNGs of the same
// name, so several styles of one bundle can stand side by side; with no theme named, the deck's
// own files are written, as the generator writes them.
import { readFile, writeFile } from 'node:fs/promises';
import { deserialize } from 'node:v8';
import { join } from 'node:path';
import { renderSlides, SLIDE_W, SLIDE_H } from '../src/render/slides.js';
import { renderYieldDeck } from '../src/render/yieldSheet.js';
import { printSlides } from '../src/render/pdf.js';
import { prepareRasters } from '../src/render/paintMasks.js';
import { BLEED_SCALE, COUNTRY_SCALE } from '../src/pipeline.js';
import { withTemplate, templateFor } from '../src/render/template.js';

const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(`--${name}`); return i > -1 ? argv[i + 1] : undefined; };
const outDir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!outDir) { console.error('usage: npx tsx scripts/recompose.ts out/<slug> [--sheet slides|yield] [--theme id] [--only 01,03]'); process.exit(1); }
const sheet = arg('sheet') ?? 'slides';
const theme = arg('theme');
// ONLY=02,03 (or --only) keeps just those pages, printed beside the deck rather than over it
const only = (arg('only') ?? process.env.ONLY)?.split(',').map((x) => x.trim()).filter(Boolean);
const opts = { theme };

let html: string;
if (sheet === 'yield') {
  const { yb, meta } = deserialize(await readFile(join(outDir, 'yield.bundle')));
  html = renderYieldDeck(yb, meta, opts).html;
} else {
  const { sb, meta } = deserialize(await readFile(join(outDir, 'slides.bundle')));
  // a bundle kept before a scale change takes the current scales (its data covers the wider window)
  sb.bleedPanel = { ...sb.bleedPanel, scale: BLEED_SCALE };
  if (sb.countryPanel) sb.countryPanel = { ...sb.countryPanel, scale: COUNTRY_SCALE };
  // the painted pictures take the style's green, so they are painted under its template
  await withTemplate(templateFor('slides', theme), () => prepareRasters(sb, join(outDir, 'data'), BLEED_SCALE, COUNTRY_SCALE));
  html = renderSlides(sb, meta, opts).html;
}
if (only?.length) html = html.replace(/<section class="slide[^"]*" id="([^"]+)">[\s\S]*?<\/section>/g, (m, id: string) => (only.some((o) => id.startsWith(o)) ? m : ''));
const stem = theme ? `${sheet}-${theme}${only?.length ? '-only' : ''}` : sheet === 'yield' ? (only?.length ? 'yield_only' : 'yield_deck') : only?.length ? 'slides_only' : 'slides';
const pdfName = theme ? `${stem}.pdf` : sheet === 'yield' ? (only?.length ? 'YIELD_ONLY.pdf' : 'PLANNING_YIELD.pdf') : only?.length ? 'SLIDES_ONLY.pdf' : 'OVERALL_ANALYSIS.pdf';
const htmlPath = join(outDir, `${stem}.html`);
await writeFile(htmlPath, html);
const pngs = await printSlides(htmlPath, join(outDir, pdfName), join(outDir, theme ? stem : sheet === 'yield' ? (only?.length ? 'yield_only' : 'yield') : only?.length ? 'slides_only' : 'slides'), { widthMm: SLIDE_W, heightMm: SLIDE_H });
console.log(`recomposed ${pngs.length} ${sheet} page${pngs.length === 1 ? '' : 's'}${theme ? ` in ${theme}` : ''}: ${pngs.join(', ')}`);

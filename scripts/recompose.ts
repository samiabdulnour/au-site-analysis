// Re-compose the slide deck from a kept bundle, without fetching anything.
//   KEEP_BUNDLE=1 npm run generate -- "<address>" --type slides   (once)
//   npx tsx scripts/recompose.ts out/<slug>                        (after each edit)
import { readFile, writeFile } from 'node:fs/promises';
import { deserialize } from 'node:v8';
import { join } from 'node:path';
import { renderSlides, SLIDE_W, SLIDE_H } from '../src/render/slides.js';
import { printSlides } from '../src/render/pdf.js';

const outDir = process.argv[2];
if (!outDir) { console.error('usage: npx tsx scripts/recompose.ts out/<slug>'); process.exit(1); }
const { sb, meta } = deserialize(await readFile(join(outDir, 'slides.bundle')));
let { html } = renderSlides(sb, meta);
// ONLY=02,03 keeps just those slides, printed beside the deck rather than over it
const only = process.env.ONLY?.split(',').map((x) => x.trim()).filter(Boolean);
if (only?.length) html = html.replace(/<section class="slide[^"]*" id="([^"]+)">[\s\S]*?<\/section>/g, (m, id: string) => (only.some((o) => id.startsWith(o)) ? m : ''));
const htmlPath = join(outDir, only?.length ? 'slides_only.html' : 'slides.html');
await writeFile(htmlPath, html);
const pngs = await printSlides(htmlPath, join(outDir, only?.length ? 'SLIDES_ONLY.pdf' : 'OVERALL_ANALYSIS.pdf'), join(outDir, only?.length ? 'slides_only' : 'slides'), { widthMm: SLIDE_W, heightMm: SLIDE_H });
console.log(`recomposed ${pngs.length} slides`);

// The streetscape's elevations through an image model and back (src/render/aiTiles.ts).
//   npx tsx scripts/streetscape-ai.ts export out/<slug>        cut the faces into tiles: data/ai/*.png
//   (each tile through the model, its answer saved beside it as <tile>.ai.png)
//   npx tsx scripts/streetscape-ai.ts import out/<slug> [--model "Nano Banana Pro"]
//                                                              lay them back: STREETSCAPE_AI.pdf
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportAiTiles, importAiTiles, type AiManifest } from '../src/render/aiTiles.js';
import { SCAPE_SKY } from '../src/render/elevation3d.js';
import { renderStreetscape } from '../src/render/streetscape.js';
import { printSlides } from '../src/render/pdf.js';
import { SLIDE_W, SLIDE_H } from '../src/render/slides.js';
import type { StreetscapeBundle } from '../src/pipeline.js';

const [step, outDir] = process.argv.slice(2);
const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
if (!outDir || (step !== 'export' && step !== 'import')) {
  console.error('usage: npx tsx scripts/streetscape-ai.ts export|import out/<slug> [--model "Nano Banana Pro"]');
  process.exit(1);
}
const dataDir = join(outDir, 'data');
const b = JSON.parse(await readFile(join(dataDir, 'streetscape_bundle.json'), 'utf8')) as StreetscapeBundle;
if (!b.elevations?.some(Boolean)) { console.error('no elevations: draw the streetscape with the 3D tiles first'); process.exit(1); }

if (step === 'export') {
  const m = await exportAiTiles(b.elevations, dataDir);
  for (const f of m.faces) console.log(`${f.side > 0 ? 'left' : 'right'} face: ${f.tiles.map((t) => `${t.file} (${t.aspect})`).join(', ')}`);
  console.log(`ask the model for each tile in its frame, with this prompt, and save its answer beside the tile as <tile>.ai.png\n\n${m.prompt}`);
} else {
  const manifest = JSON.parse(await readFile(join(dataDir, 'ai', 'manifest.json'), 'utf8')) as AiManifest;
  const faces = await importAiTiles(manifest, dataDir, SCAPE_SKY);
  for (const f of faces) {
    for (const r of f.refused) console.log(`${r.file} refused: it built on ${Math.round(r.fill * 100)}% of its tile's sky, so it redrew the street rather than cleaning it; ask again`);
    for (const s of f.slips) if (s.dx || s.dy) console.log(`${s.file} had slipped ${Math.abs(s.dx)} px ${s.dx > 0 ? 'left' : 'right'} and ${Math.abs(s.dy)} px ${s.dy > 0 ? 'up' : 'down'}: put back`);
  }
  const tiles = faces.reduce((t, f) => t + f.tiles, 0), of = faces.reduce((t, f) => t + f.of, 0);
  if (!tiles) { console.error('no answers laid: save each tile\'s as data/ai/<tile>.ai.png'); process.exit(1); }
  const elevations = b.elevations.map((e) => { const f = e && faces.find((x) => x.side === e.side && x.tiles); return e && f ? { ...e, file: f.file } : e; });
  const sides = faces.filter((f) => f.tiles).map((f) => f.side);
  const ai: StreetscapeBundle = { ...b, elevations, ai: { model: flag('model') ?? 'an image model', tiles, of, sides } };
  await writeFile(join(dataDir, 'streetscape_bundle_ai.json'), JSON.stringify(ai));
  const html = join(outDir, 'streetscape_ai.html');
  await writeFile(html, renderStreetscape(ai, { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false }));
  await printSlides(html, join(outDir, 'STREETSCAPE_AI.pdf'), join(outDir, 'ai'), { widthMm: SLIDE_W, heightMm: SLIDE_H });
  console.log(`${tiles} of ${of} tiles laid back: ${join(outDir, 'STREETSCAPE_AI.pdf')}`);
}

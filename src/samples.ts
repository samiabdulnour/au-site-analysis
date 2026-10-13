// The landing page's EXPECTED RESULT frame shows what the options table will
// produce, so it needs a picture for every combination of it — drawing ×
// scale × north × style — not one per option. This draws them all for one
// address:
//
//   npm run samples -- "150 George Street, Parramatta NSW 2150" [--only context|site|summary|slides]
//
// and writes web/samples/result-<sheet>[-<scale>-<rotate>]-<template>.jpg,
// the names web/app.js asks for. The data is fetched once per scale and
// orientation and drawn in each style from the same bundle, since a style
// changes how a sheet looks and never what it fetches. `--only` splits the
// run, which is twenty-odd pipelines' worth of public services' time.
//
// Rasterising goes through pymupdf, as the other samples do (pip install
// pymupdf). The scales and orientations below must match the options table's.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
import { runPipeline, runSitePipeline, runSummaryPipeline, runSlidesPipeline } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { renderSiteSheet } from './render/siteSheet.js';
import { renderSummarySheet } from './render/summarySheet.js';
import { renderSlides, PANEL_W, PANEL_H, DA_PANEL_H, SLIDE_W, SLIDE_H } from './render/slides.js';
import { htmlToPdf, printSlides } from './render/pdf.js';
import { TEMPLATES, withTemplate } from './render/template.js';

const CONTEXT_SCALES = [2000, 3000, 4000, 5000];
const SITE_SCALES = [0, 200, 250, 500];   // 0 is auto, the tightest that fits the lot
const ROTATIONS = ['north', 'auto'] as const;
// The deck's slide the frame shows, as the old slides sample did.
const SLIDE = '03_planning_overview';
// About 1190 px across an A1 sheet: sharp at the frame's width on a 2× screen,
// and around 150 kB a picture, one per combination of the table.
const DPI = 36;
const QUALITY = 72;

const address = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
if (!address) {
  console.error('usage: npm run samples -- "<address>" [--only context|site|summary|slides]');
  process.exit(1);
}
const only = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : undefined; })();
const want = (sheet: string) => !only || only === sheet;

const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const root = join('out', 'samples', slug);
const samples = join('web', 'samples');
const meta: SheetMeta = {
  jobNo: '', client: '', status: '', sheetNo: '', revision: '',
  checked: '', drawn: '', date: '', preliminary: false,
};
const log = (m: string) => console.log(m);

/** Page one of a PDF, or a PNG, as the frame's JPEG. */
function toJpeg(src: string, name: string) {
  const out = join(samples, `result-${name}.jpg`);
  const py = `
import sys, pymupdf
from PIL import Image
src, out, dpi, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
if src.endswith('.pdf'):
    pymupdf.open(src)[0].get_pixmap(dpi=dpi).pil_save(out, format='JPEG', quality=q, optimize=True)
else:
    im = Image.open(src).convert('RGB')
    w = round(841 / 25.4 * dpi)   # an A1 sheet's width at that dpi, so a slide fills the frame the same
    im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(out, 'JPEG', quality=q, optimize=True)
`;
  const r = spawnSync('python3', ['-c', py, src, out, String(DPI), String(QUALITY)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`rasterising ${src}: ${r.stderr.slice(-400)}`);
  console.log(`  wrote ${out}`);
}

/** One bundle drawn in every style: `draw` returns the PDF or PNG for one. */
async function eachTemplate(name: string, draw: (template: string) => Promise<string>) {
  for (const t of TEMPLATES) {
    const file = await withTemplate(t.id, () => draw(t.id));
    toJpeg(file, `${name}-${t.id}`);
  }
}

await mkdir(samples, { recursive: true });

if (want('context')) {
  for (const rotate of ROTATIONS) {
    for (const scale of CONTEXT_SCALES) {
      const outDir = join(root, `context-${scale}-${rotate}`);
      log(`context 1:${scale}, ${rotate}`);
      const bundle = await runPipeline(address, { scale, mapWidthMm: MAP_W, mapHeightMm: MAP_H, outDir, rotate, log });
      await eachTemplate(`context-${scale}-${rotate}`, async (t) => {
        const html = join(outDir, `sheet-${t}.html`);
        const pdf = join(outDir, `CONTEXT_ANALYSIS-${t}.pdf`);
        await writeFile(html, renderSheet(bundle, meta));
        await htmlToPdf(html, pdf);
        return pdf;
      });
    }
  }
}

if (want('site')) {
  for (const rotate of ROTATIONS) {
    for (const scale of SITE_SCALES) {
      const outDir = join(root, `site-${scale}-${rotate}`);
      log(`site ${scale ? `1:${scale}` : 'auto'}, ${rotate}`);
      const bundle = await runSitePipeline(address, {
        mapWidthMm: MAP_W, mapHeightMm: MAP_H, outDir, scale: scale || undefined, rotate, log,
      });
      await eachTemplate(`site-${scale}-${rotate}`, async (t) => {
        const html = join(outDir, `site_sheet-${t}.html`);
        const pdf = join(outDir, `SITE_ANALYSIS-${t}.pdf`);
        await writeFile(html, renderSiteSheet(bundle, meta));
        await htmlToPdf(html, pdf);
        return pdf;
      });
    }
  }
}

if (want('summary')) {
  const outDir = join(root, 'summary');
  log('summary');
  const bundle = await runSummaryPipeline(address, { outDir, log });
  await eachTemplate('summary', async (t) => {
    const html = join(outDir, `summary_sheet-${t}.html`);
    const pdf = join(outDir, `DEVELOPMENT_SUMMARY-${t}.pdf`);
    await writeFile(html, renderSummarySheet(bundle, meta));
    await htmlToPdf(html, pdf);
    return pdf;
  });
}

if (want('slides')) {
  const outDir = join(root, 'slides');
  log('slides');
  const bundle = await runSlidesPipeline(address, {
    outDir, panelWmm: PANEL_W, panelHmm: PANEL_H, daPanelHmm: DA_PANEL_H, log,
  });
  await eachTemplate('slides', async (t) => {
    const html = join(outDir, `slides-${t}.html`);
    const pngDir = join(outDir, `slides-${t}`);
    await writeFile(html, renderSlides(bundle, meta).html);
    await printSlides(html, join(outDir, `OVERALL_ANALYSIS-${t}.pdf`), pngDir, { widthMm: SLIDE_W, heightMm: SLIDE_H });
    return join(pngDir, `${SLIDE}.png`);
  });
}

console.log('done');

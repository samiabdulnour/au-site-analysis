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
import { runPipeline, runSitePipeline, runSummaryPipeline, runSlidesPipeline } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { setTemplate, DEFAULT_TEMPLATE, isTemplateId } from './render/template.js';
import { renderSiteSheet } from './render/siteSheet.js';
import { renderSummarySheet } from './render/summarySheet.js';
import { summaryCsv, summaryJson } from './export/summaryExport.js';
import { renderSlides, slidesFacts, PANEL_W, PANEL_H, DA_PANEL_H, SLIDE_W, SLIDE_H } from './render/slides.js';
import { htmlToPdf, printSlides } from './render/pdf.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

const address = process.argv.slice(2).find((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1]?.startsWith('--') !== true);
if (!address) {
  console.error('usage: npm run generate -- "<address>" [--type context|site|summary|slides|both] [--scale 3000] [--slides-scale 8000] [--template flamingo|flamingo-2|heron] [--job N] [--client X] [--status S] [--sheet "DA 003"]');
  process.exit(1);
}

const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join('out', slug);


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
};

const sheetType = arg('type', 'context')!; // context | site | summary | slides | both (the three sheets)
const rotate = arg('rotate', 'north') === 'auto' ? 'auto' as const : 'north' as const;
// The graphic template, process-wide for the CLI (it renders one address and exits).
{
  const want = arg('template', DEFAULT_TEMPLATE)!;
  if (!isTemplateId(want)) { console.error(`unknown template "${want}"; using ${DEFAULT_TEMPLATE}`); }
  setTemplate(want);
}
const outputs: string[] = [];

if (sheetType === 'context' || sheetType === 'both') {
  const bundle = await runPipeline(address, {
    scale: Number(arg('scale', '3000')),
    mapWidthMm: MAP_W,
    mapHeightMm: MAP_H,
    outDir,
    rotate,
    log: (m) => console.log(m),
  });
  console.log('composing context analysis…');
  const htmlPath = join(outDir, 'sheet.html');
  await writeFile(htmlPath, renderSheet(bundle, meta));
  const pdfPath = join(outDir, 'CONTEXT_ANALYSIS.pdf');
  await htmlToPdf(htmlPath, pdfPath);
  outputs.push(pdfPath);

  console.log('exporting CAD (DXF/DWG)…');
  const { spawnSync } = await import('node:child_process');
  const cad = spawnSync('python3', ['src/export/dxf_export.py', outDir], { encoding: 'utf8' });
  if (cad.status === 0) { console.log(cad.stdout.trim()); outputs.push(join(outDir, 'CONTEXT_ANALYSIS_CAD.zip')); }
  else console.warn(`CAD export failed: ${cad.stderr?.slice(-400)}`);
}

if (sheetType === 'site' || sheetType === 'both') {
  const siteScale = arg('site-scale', '');
  const sb = await runSitePipeline(address, {
    mapWidthMm: MAP_W,
    mapHeightMm: MAP_H,
    outDir,
    scale: siteScale ? Number(siteScale) : undefined,
    rotate,
    log: (m) => console.log(m),
  });
  console.log('composing site analysis…');
  const siteHtmlPath = join(outDir, 'site_sheet.html');
  await writeFile(siteHtmlPath, renderSiteSheet(sb, { ...meta, sheetNo: meta.sheetNo || '' }));
  const sitePdfPath = join(outDir, 'SITE_ANALYSIS.pdf');
  await htmlToPdf(siteHtmlPath, sitePdfPath);
  outputs.push(sitePdfPath);

  console.log('exporting site CAD (DXF/DWG)…');
  const { spawnSync } = await import('node:child_process');
  const cad = spawnSync('python3', ['src/export/site_dxf_export.py', outDir], { encoding: 'utf8' });
  if (cad.status === 0) { console.log(cad.stdout.trim()); outputs.push(join(outDir, 'SITE_ANALYSIS_CAD.zip')); }
  else console.warn(`site CAD export failed: ${cad.stderr?.slice(-400)}`);
}

if (sheetType === 'summary' || sheetType === 'both') {
  const sub = await runSummaryPipeline(address, { outDir, log: (m) => console.log(m) });
  console.log('composing development summary…');
  const sumHtmlPath = join(outDir, 'summary_sheet.html');
  await writeFile(sumHtmlPath, renderSummarySheet(sub, { ...meta, sheetNo: meta.sheetNo || '' }));
  const sumPdfPath = join(outDir, 'DEVELOPMENT_SUMMARY.pdf');
  await htmlToPdf(sumHtmlPath, sumPdfPath);
  outputs.push(sumPdfPath);

  const csvPath = join(outDir, 'DEVELOPMENT_SUMMARY.csv');
  const jsonPath = join(outDir, 'DEVELOPMENT_SUMMARY.json');
  await writeFile(csvPath, summaryCsv(sub));
  await writeFile(jsonPath, summaryJson(sub));
  outputs.push(csvPath, jsonPath);
}

if (sheetType === 'slides') {
  const sb = await runSlidesPipeline(address, {
    outDir,
    scale: Number(arg('slides-scale', '8000')),
    panelWmm: PANEL_W,
    panelHmm: PANEL_H,
    daPanelHmm: DA_PANEL_H,
    daYears: Number(arg('da-years', '5')),
    log: (m) => console.log(m),
  });
  console.log('composing overall analysis slides…');
  const { html } = renderSlides(sb, meta);
  const slidesHtmlPath = join(outDir, 'slides.html');
  await writeFile(slidesHtmlPath, html);
  const deckPath = join(outDir, 'OVERALL_ANALYSIS.pdf');
  const pngs = await printSlides(slidesHtmlPath, deckPath, join(outDir, 'slides'), { widthMm: SLIDE_W, heightMm: SLIDE_H });
  const factsPath = join(outDir, 'overall.json');
  await writeFile(factsPath, JSON.stringify(slidesFacts(sb), null, 2));
  outputs.push(deckPath, ...pngs, factsPath);
}

console.log(`done:\n  ${outputs.join('\n  ')}`);

// One sheet, start to finish: fetch, compose, print, export. What a job does,
// apart from the server's bookkeeping around it, so that it can run in a
// process of its own (src/worker.ts) while the server goes on answering.

import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, runSitePipeline, runSummaryPipeline, runYieldPipeline, runSlidesPipeline, BLEED_SCALE, COUNTRY_SCALE } from './pipeline.js';
import { prepareRasters } from './render/paintMasks.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { renderSiteSheet } from './render/siteSheet.js';
import { renderSummarySheet } from './render/summarySheet.js';
import { summaryCsv, summaryJson } from './export/summaryExport.js';
import { renderYieldDeck, yieldCsv, yieldJson } from './render/yieldSheet.js';
import { renderSlides, slidesFacts, PANEL_W, PANEL_H, DA_PANEL_H, SLIDE_W, SLIDE_H } from './render/slides.js';
import { withTemplate, templateFor, type SheetKind } from './render/template.js';
import { htmlToPdf, printSlides } from './render/pdf.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What a job asks for: everything that changes the drawing. */
export interface SheetSpec {
  address: string;
  sheet: SheetKind;
  scale: number;            // 0 = auto (site sheets, slides)
  rotate: 'north' | 'auto';
  template: string;
}

/** What it leaves behind, as paths inside its directory. */
export interface DrawnSheet {
  pdfPath: string;
  cadPath?: string;
  dataPath?: string;   // CSV for table sheets, JSON for the deck
}

/**
 * The picture of a finished drawing the page shows when it is done, beside its
 * PDF (src/render/pdf.ts). Found by name rather than kept on the job, so the
 * job index needs nothing new and a sheet drawn before there were pictures
 * simply has none.
 */
export const previewOf = (dir: string) => join(dir, 'preview.jpg');

/**
 * The DXF export is a python script. It ran through spawnSync, which blocks the
 * event loop for its whole duration — so for the seconds it took, this server
 * answered nothing at all: no progress for the visitor waiting on that sheet,
 * and no response to anyone else on the site. Nothing about it was ever
 * required to be synchronous.
 *
 * Returns whether the script exited cleanly; the caller still checks that the
 * zip it was supposed to write is actually there.
 */
async function runCadExport(script: string, outDir: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('python3', [join(ROOT, 'src', 'export', script), outDir]);
    return true;
  } catch {
    return false;     // missing ezdxf/pyproj, or a site the exporter cannot draw
  }
}

/**
 * The template is bound to this sheet's async context rather than set globally,
 * so the render reads its own and nothing else's — the one thing that had to
 * be true before jobs could ever overlap.
 */
export async function drawSheet(spec: SheetSpec, outDir: string, log: (m: string) => void): Promise<DrawnSheet> {
  return withTemplate(templateFor(spec.sheet, spec.template), () => drawBody(spec, outDir, log));
}

async function drawBody(spec: SheetSpec, outDir: string, log: (m: string) => void): Promise<DrawnSheet> {
  const meta: SheetMeta = {
    jobNo: '', client: '', status: '', sheetNo: '', revision: '',
    checked: '', drawn: '', date: '', preliminary: false,
  };
  if (spec.sheet === 'yield') {
    const yb = await runYieldPipeline(spec.address, { outDir, log });
    log('composing planning yield…');
    const htmlPath = join(outDir, 'yield_deck.html');
    await writeFile(htmlPath, renderYieldDeck(yb, meta).html);
    log('printing PDF…');
    const pdfPath = join(outDir, 'PLANNING_YIELD.pdf');
    await printSlides(htmlPath, pdfPath, join(outDir, 'yield'), { widthMm: SLIDE_W, heightMm: SLIDE_H }, previewOf(outDir));
    // Like the summary it replaces, a table: CSV for Excel, JSON for the numbers behind it.
    const csvPath = join(outDir, 'PLANNING_YIELD.csv');
    await writeFile(csvPath, yieldCsv(yb));
    await writeFile(join(outDir, 'PLANNING_YIELD.json'), yieldJson(yb));
    return { pdfPath, dataPath: csvPath };
  }
  if (spec.sheet === 'summary') {
    const sub = await runSummaryPipeline(spec.address, { outDir, log });
    log('composing development summary…');
    const htmlPath = join(outDir, 'summary_sheet.html');
    await writeFile(htmlPath, renderSummarySheet(sub, meta));
    log('printing PDF…');
    const pdfPath = join(outDir, 'DEVELOPMENT_SUMMARY.pdf');
    await htmlToPdf(htmlPath, pdfPath, previewOf(outDir));
    // A table's open format is data, not CAD: CSV opens in Excel, JSON is
    // there for anything reading the controls programmatically.
    const csvPath = join(outDir, 'DEVELOPMENT_SUMMARY.csv');
    await writeFile(csvPath, summaryCsv(sub));
    await writeFile(join(outDir, 'DEVELOPMENT_SUMMARY.json'), summaryJson(sub));
    return { pdfPath, dataPath: csvPath };
  }
  if (spec.sheet === 'site') {
    const sb = await runSitePipeline(spec.address, {
      mapWidthMm: MAP_W,
      mapHeightMm: MAP_H,
      outDir,
      scale: spec.scale || undefined,   // 0 => auto-fit
      rotate: spec.rotate,
      log,
    });
    log('composing site analysis…');
    const htmlPath = join(outDir, 'site_sheet.html');
    await writeFile(htmlPath, renderSiteSheet(sb, meta, spec.template));
    log('printing PDF…');
    const pdfPath = join(outDir, 'SITE_ANALYSIS.pdf');
    await htmlToPdf(htmlPath, pdfPath, previewOf(outDir));
    log('exporting CAD (DXF/DWG)…');
    const zip = join(outDir, 'SITE_ANALYSIS_CAD.zip');
    if (await runCadExport('site_dxf_export.py', outDir) && existsSync(zip)) return { pdfPath, cadPath: zip };
    log('CAD export unavailable for this run');
    return { pdfPath };
  }
  if (spec.sheet === 'slides') {
    const sb = await runSlidesPipeline(spec.address, {
      outDir,
      scale: spec.scale || undefined,
      panelWmm: PANEL_W,
      panelHmm: PANEL_H,
      daPanelHmm: DA_PANEL_H,
      log,
    });
    log('composing overall analysis slides…');
    await prepareRasters(sb, join(outDir, 'data'), BLEED_SCALE, COUNTRY_SCALE);
    const htmlPath = join(outDir, 'slides.html');
    await writeFile(htmlPath, renderSlides(sb, meta).html);
    log('printing PDF and slide images…');
    const pdfPath = join(outDir, 'OVERALL_ANALYSIS.pdf');
    await printSlides(htmlPath, pdfPath, join(outDir, 'slides'), { widthMm: SLIDE_W, heightMm: SLIDE_H }, previewOf(outDir));
    // The deck's open format is its facts: everything it says, as JSON.
    const factsPath = join(outDir, 'overall.json');
    await writeFile(factsPath, JSON.stringify(slidesFacts(sb), null, 2));
    return { pdfPath, dataPath: factsPath };
  }
  const bundle = await runPipeline(spec.address, {
    scale: spec.scale,
    mapWidthMm: MAP_W,
    mapHeightMm: MAP_H,
    outDir,
    rotate: spec.rotate,
    log,
  });
  log('composing context analysis…');
  const htmlPath = join(outDir, 'sheet.html');
  await writeFile(htmlPath, renderSheet(bundle, meta));
  log('printing PDF…');
  const pdfPath = join(outDir, 'CONTEXT_ANALYSIS.pdf');
  await htmlToPdf(htmlPath, pdfPath, previewOf(outDir));
  log('exporting CAD (DXF/DWG)…');
  const zip = join(outDir, 'CONTEXT_ANALYSIS_CAD.zip');
  if (await runCadExport('dxf_export.py', outDir) && existsSync(zip)) return { pdfPath, cadPath: zip };
  log('CAD export unavailable for this run');
  return { pdfPath };
}

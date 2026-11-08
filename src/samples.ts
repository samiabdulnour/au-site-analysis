// The landing page's EXPECTED RESULT frame shows what the options table will
// produce, so it needs a picture for every combination of it — drawing ×
// scale × north × style — not one per option. This draws them all for one
// address:
//
//   npm run samples -- "150 George Street, Parramatta NSW 2150" [--only context|site|yield|summary|slides]
//
// and writes web/samples/result-<sheet>[-<scale>-<rotate>][-<theme>].jpg
// (context in each template, site in each site theme, the summary once, the
// yield's every page in each of the four styles as result-yield-1-<style>.jpg,
// -2-<style>…) and the site report's every page as
// result-slides-1.jpg, -2…, in the default style, which the frame turns through,
// the names web/app.js asks for. The data is fetched once per scale and
// orientation and drawn in each style from the same bundle, since a style
// changes how a sheet looks and never what it fetches. `--only` splits the
// run, which is twenty-odd pipelines' worth of public services' time.
//
// Drawing the context sheets also redraws web/samples/og.jpg, the card a
// shared link previews with, since it is a crop of one of them. `--only card`
// redraws the card alone, from the sheet already drawn, and needs no address:
//
//   npm run samples -- --only card
//
// Rasterising goes through pymupdf, as the other samples do (pip install
// pymupdf). The scales and orientations below must match the options table's.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
import { runPipeline, runSitePipeline, runSummaryPipeline, runYieldPipeline, runSlidesPipeline, BLEED_SCALE, COUNTRY_SCALE } from './pipeline.js';
import { renderSheet, MAP_W, MAP_H, type SheetMeta } from './render/sheet.js';
import { renderSiteSheet } from './render/siteSheet.js';
import { renderSummarySheet } from './render/summarySheet.js';
import { renderYieldDeck } from './render/yieldSheet.js';
import { renderSlides, PANEL_W, PANEL_H, DA_PANEL_H, SLIDE_W, SLIDE_H } from './render/slides.js';
import { prepareRasters } from './render/paintMasks.js';
import { htmlToPdf, htmlToJpeg, printSlides } from './render/pdf.js';
import { TEMPLATES, SITE_THEMES, withTemplate } from './render/template.js';

const CONTEXT_SCALES = [2000, 3000, 4000, 5000];
const SITE_SCALES = [0, 250, 500, 1000];   // 0 is auto, the tightest that fits the lot
const ROTATIONS = ['north', 'auto'] as const;
/** The decks' four styles, as web/app.js offers them for the yield. */
const DECK_STYLES = ['flamingo', 'kingfisher', 'heron', 'canary'] as const;
// About 2380 px across an A1 sheet: the frame is up to about 900 px wide on the
// page, so this is its width on a 2× screen, sharp there, and around half a
// megabyte a picture, one per combination of the table.
const DPI = 72;
const QUALITY = 74;

const only = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : undefined; })();
const want = (sheet: string) => !only || only === sheet;
const samples = join('web', 'samples');
const log = (m: string) => console.log(m);

/**
 * The link-preview card, web/og-card.html, as og.jpg. The pages name it with
 * the picture's hash in a ?v=, rewritten here: a scraper keeps a picture by
 * its URL, so the old card would go on being shown under the old one.
 */
async function drawCard() {
  const card = join(samples, 'og.jpg');
  await htmlToJpeg(join('web', 'og-card.html'), card, { width: 1200, height: 630 }, 86);
  const v = createHash('sha256').update(readFileSync(card)).digest('hex').slice(0, 8);
  for (const page of ['index.html', 'about.html']) {
    const file = join('web', page);
    const html = readFileSync(file, 'utf8');
    const tag = /\/samples\/og\.jpg(\?v=[a-z0-9]*)?"/g;
    if (html.search(tag) < 0) throw new Error(`${file} no longer names /samples/og.jpg`);
    await writeFile(file, html.replace(tag, `/samples/og.jpg?v=${v}"`));
  }
  console.log(`  wrote ${card}, named ?v=${v}`);
}

// The card is a crop of a picture already drawn, so it needs no address.
if (only === 'card') {
  log('card');
  await drawCard();
  process.exit(0);
}

const addressArg = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
// The welcome's sheets have their addresses in HERO below; the frame's samples take the one given.
if (!addressArg && only !== 'hero') {
  console.error('usage: npm run samples -- "<address>" [--only context|site|yield|summary|slides]');
  console.error('       npm run samples -- --only card');
  console.error('       npm run samples -- --only hero');
  process.exit(1);
}

const slugOf = (a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const root = join('out', 'samples', addressArg ? slugOf(addressArg) : 'hero');
const meta: SheetMeta = {
  jobNo: '', client: '', status: '', sheetNo: '', revision: '',
  checked: '', drawn: '', date: '', preliminary: false,
};

/** Page one of a PDF, or a PNG, as a JPEG at the frame's size, written to `out`. */
function rasterise(src: string, out: string) {
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
/** Page one of a PDF, or a PNG, as the frame's JPEG, result-<name>.jpg. */
const toJpeg = (src: string, name: string) => rasterise(src, join(samples, `result-${name}.jpg`));

// ---- the welcome's animated windows -------------------------------------------
//
// web/hero.js turns through sheets drawn for addresses around NSW, hero-1.jpg
// … hero-27.jpg, so the welcome never shows the frame's example: the maps 1
// to 14, a context or site sheet each in one of the four styles; the yield's
// pages 15 to 18, in the four styles mixed; and the site report's pages 19 to
// 27, in its default style, Newcastle's streetscape on Google's 3D tiles among
// them. Each frame names its address, drawing, scale, orientation, style and
// page here, so the set is redrawn in the current look at the frame's size,
// one pipeline a map and one an address for the decks:
//
//   npm run samples -- --only hero
//
// A deck page an address no longer takes (a yield's rebuilt path where what
// stands no longer exceeds the controls, a streetscape the tiles miss) leaves
// its picture as it was, and the log says so without the pipelines' WARN word.
type HeroFrame = { n: number; address: string } & (
  | { sheet: 'context' | 'site'; scale: number; rotate: 'north' | 'auto'; style: string }
  | { sheet: 'yield'; page: string; style: string }
  | { sheet: 'slides'; page: string });
const SYDNEY = '56 Pitt Street, Sydney NSW 2000', WOLLONGONG = '88-90 Crown Street, Wollongong NSW 2500',
  KATOOMBA = '17-45 Katoomba Street, Katoomba NSW 2780', WOOLLAHRA = '102 Queen Street, Woollahra NSW 2025',
  NEWCASTLE = '45 Hunter Street, Newcastle NSW 2300', BLACKTOWN = '7 Marion Street, Blacktown NSW 2148',
  MANLY = '30 The Corso, Manly NSW 2095', ORANGE = '120-122 Summer Street, Orange NSW 2800',
  COFFS = '22 Harbour Drive, Coffs Harbour NSW 2450', WAGGA = '8 Baylis Street, Wagga Wagga NSW 2650',
  BYRON = '59 Jonson Street, Byron Bay NSW 2481', TAREE = '45 High Street, Taree NSW 2430',
  ARMIDALE = '189 Beardy Street, Armidale NSW 2350', KIAMA = '36 Bong Bong Street, Kiama NSW 2533';
const HERO: HeroFrame[] = [
  { n: 1, address: SYDNEY, sheet: 'context', scale: 3000, rotate: 'north', style: 'kingfisher' },
  { n: 2, address: WOLLONGONG, sheet: 'site', scale: 0, rotate: 'north', style: 'heron' },
  { n: 3, address: KATOOMBA, sheet: 'context', scale: 2000, rotate: 'north', style: 'canary' },
  { n: 4, address: WOOLLAHRA, sheet: 'site', scale: 0, rotate: 'auto', style: 'flamingo' },
  { n: 5, address: NEWCASTLE, sheet: 'context', scale: 4000, rotate: 'north', style: 'flamingo' },
  { n: 6, address: BLACKTOWN, sheet: 'context', scale: 3000, rotate: 'north', style: 'heron' },
  { n: 7, address: MANLY, sheet: 'context', scale: 2000, rotate: 'north', style: 'kingfisher' },
  { n: 8, address: ORANGE, sheet: 'context', scale: 4000, rotate: 'north', style: 'heron' },
  { n: 9, address: COFFS, sheet: 'site', scale: 0, rotate: 'north', style: 'kingfisher' },
  { n: 10, address: WAGGA, sheet: 'context', scale: 5000, rotate: 'north', style: 'canary' },
  { n: 11, address: BYRON, sheet: 'site', scale: 250, rotate: 'north', style: 'canary' },
  { n: 12, address: TAREE, sheet: 'context', scale: 3000, rotate: 'north', style: 'flamingo' },
  { n: 13, address: ARMIDALE, sheet: 'context', scale: 2000, rotate: 'north', style: 'flamingo' },
  { n: 14, address: KIAMA, sheet: 'site', scale: 250, rotate: 'north', style: 'heron' },
  { n: 15, address: MANLY, sheet: 'yield', page: 'within_controls', style: 'heron' },
  { n: 16, address: WOLLONGONG, sheet: 'yield', page: 'envelope_to_height', style: 'canary' },
  { n: 17, address: NEWCASTLE, sheet: 'yield', page: 'rebuilt_as_stands', style: 'kingfisher' },
  { n: 18, address: WOLLONGONG, sheet: 'yield', page: 'stands_today', style: 'flamingo' },
  { n: 19, address: KATOOMBA, sheet: 'slides', page: '03_character' },
  { n: 20, address: KATOOMBA, sheet: 'slides', page: '07_topography' },
  { n: 21, address: KATOOMBA, sheet: 'slides', page: '10_movement' },
  { n: 22, address: KATOOMBA, sheet: 'slides', page: '17_opportunities_constraints' },
  { n: 23, address: ORANGE, sheet: 'slides', page: '04_planning_overview' },
  { n: 24, address: ORANGE, sheet: 'slides', page: '11_green_public_domain' },
  { n: 25, address: ORANGE, sheet: 'slides', page: '16_people_and_market' },
  { n: 26, address: KATOOMBA, sheet: 'slides', page: '09b_built_form' },
  { n: 27, address: NEWCASTLE, sheet: 'slides', page: '03b_streetscape' },
];

if (only === 'hero') {
  await mkdir(samples, { recursive: true });
  // HERO_FRAMES=16,27 redraws those frames alone (a page that changed, a trial of one address).
  const asked = process.env.HERO_FRAMES?.split(',').map(Number).filter(Boolean);
  const frames = asked?.length ? HERO.filter((f) => asked.includes(f.n)) : HERO;
  const heroOut = (n: number) => join(samples, `hero-${n}.jpg`);
  /** The deck page a frame asks for, from a print's PNGs, as its picture; none, and the picture stands. */
  const pickPage = (pngs: string[], f: { n: number; page: string; address: string }) => {
    const png = pngs.find((p) => basename(p).includes(f.page));
    if (png) rasterise(png, heroOut(f.n));
    else log(`  hero-${f.n}: ${f.address} takes no ${f.page} page now; its picture is kept as it was`);
  };
  // the maps, one pipeline each
  for (const f of frames) {
    if (f.sheet !== 'context' && f.sheet !== 'site') continue;
    const outDir = join(root, `${slugOf(f.address)}-${f.sheet}-${f.scale}-${f.rotate}`);
    log(`hero-${f.n}: ${f.sheet} ${f.scale ? `1:${f.scale}` : 'auto'}, ${f.rotate}, ${f.style} — ${f.address}`);
    if (f.sheet === 'context') {
      const bundle = await runPipeline(f.address, { scale: f.scale, mapWidthMm: MAP_W, mapHeightMm: MAP_H, outDir, rotate: f.rotate, log });
      const html = join(outDir, `sheet-${f.style}.html`), pdf = join(outDir, `CONTEXT_ANALYSIS-${f.style}.pdf`);
      await withTemplate(f.style, async () => { await writeFile(html, renderSheet(bundle, meta)); await htmlToPdf(html, pdf); });
      rasterise(pdf, heroOut(f.n));
    } else {
      const bundle = await runSitePipeline(f.address, { mapWidthMm: MAP_W, mapHeightMm: MAP_H, outDir, scale: f.scale || undefined, rotate: f.rotate, log });
      const html = join(outDir, `site_sheet-${f.style}.html`), pdf = join(outDir, `SITE_ANALYSIS-${f.style}.pdf`);
      await writeFile(html, renderSiteSheet(bundle, meta, f.style));
      await htmlToPdf(html, pdf);
      rasterise(pdf, heroOut(f.n));
    }
  }
  // the yield's pages: one pipeline an address, the deck drawn in each style its frames ask for
  const byAddress = <T extends HeroFrame>(frames: T[]) => [...frames.reduce((m, f) => m.set(f.address, [...(m.get(f.address) ?? []), f]), new Map<string, T[]>())];
  for (const [addr, ff] of byAddress(frames.filter((f): f is HeroFrame & { sheet: 'yield' } => f.sheet === 'yield'))) {
    const outDir = join(root, `${slugOf(addr)}-yield`);
    log(`hero-${ff.map((f) => f.n).join(',')}: yield — ${addr}`);
    const bundle = await runYieldPipeline(addr, { outDir, log });
    for (const f of ff) {
      const html = join(outDir, `yield_deck_${f.style}.html`);
      await writeFile(html, renderYieldDeck(bundle, meta, { theme: f.style }).html);
      const pages = await printSlides(html, join(outDir, `PLANNING_YIELD_${f.style}.pdf`), join(outDir, `pages_${f.style}`), { widthMm: SLIDE_W, heightMm: SLIDE_H });
      pickPage(pages, f);
    }
  }
  // the site report's pages: one pipeline an address, in the default style
  for (const [addr, ff] of byAddress(frames.filter((f): f is HeroFrame & { sheet: 'slides' } => f.sheet === 'slides'))) {
    const outDir = join(root, `${slugOf(addr)}-slides`);
    log(`hero-${ff.map((f) => f.n).join(',')}: site report — ${addr}`);
    const bundle = await runSlidesPipeline(addr, { outDir, panelWmm: PANEL_W, panelHmm: PANEL_H, daPanelHmm: DA_PANEL_H, log });
    await prepareRasters(bundle, join(outDir, 'data'), BLEED_SCALE, COUNTRY_SCALE);
    const html = join(outDir, 'slides.html');
    await writeFile(html, renderSlides(bundle, meta).html);
    const pages = await printSlides(html, join(outDir, 'OVERALL_ANALYSIS.pdf'), join(outDir, 'slides'), { widthMm: SLIDE_W, heightMm: SLIDE_H });
    for (const f of ff) pickPage(pages, f);
  }
  console.log('done');
  process.exit(0);
}
// the hero run has left above; every other run was given an address
const address = addressArg!;

/** One context bundle drawn in every template: `draw` returns the PDF for one. */
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
  log('card');
  await drawCard();
}

if (want('site')) {
  for (const rotate of ROTATIONS) {
    for (const scale of SITE_SCALES) {
      const outDir = join(root, `site-${scale}-${rotate}`);
      log(`site ${scale ? `1:${scale}` : 'auto'}, ${rotate}`);
      const bundle = await runSitePipeline(address, {
        mapWidthMm: MAP_W, mapHeightMm: MAP_H, outDir, scale: scale || undefined, rotate, log,
      });
      // The site sheet has its own themes, not the context templates.
      for (const t of SITE_THEMES) {
        const html = join(outDir, `site_sheet-${t.id}.html`);
        const pdf = join(outDir, `SITE_ANALYSIS-${t.id}.pdf`);
        await writeFile(html, renderSiteSheet(bundle, meta, t.id));
        await htmlToPdf(html, pdf);
        toJpeg(pdf, `site-${scale}-${rotate}-${t.id}`);
      }
    }
  }
}

if (want('yield')) {
  const outDir = join(root, 'yield');
  log('yield');
  const bundle = await runYieldPipeline(address, { outDir, log });
  // Pages in each of the four styles, as the frame turns through them in the style picked: result-yield-1-<style>.jpg,
  // -2-<style>…, drawn from the one bundle, and the old numbers past the new last page taken away.
  for (const theme of DECK_STYLES) {
    const html = join(outDir, `yield_deck_${theme}.html`);
    await writeFile(html, renderYieldDeck(bundle, meta, { theme }).html);
    const pages = await printSlides(html, join(outDir, `PLANNING_YIELD_${theme}.pdf`), join(outDir, `pages_${theme}`), { widthMm: SLIDE_W, heightMm: SLIDE_H });
    pages.forEach((png, i) => toJpeg(png, `yield-${i + 1}-${theme}`));
    for (let n = pages.length + 1; existsSync(join(samples, `result-yield-${n}-${theme}.jpg`)); n++) rmSync(join(samples, `result-yield-${n}-${theme}.jpg`));
  }
  for (let n = 1; existsSync(join(samples, `result-yield-${n}.jpg`)); n++) rmSync(join(samples, `result-yield-${n}.jpg`));
  rmSync(join(samples, 'result-yield.jpg'), { force: true });
}

if (want('summary')) {
  const outDir = join(root, 'summary');
  log('summary');
  const bundle = await runSummaryPipeline(address, { outDir, log });
  // The summary has no themes: one picture.
  {
    const html = join(outDir, 'summary_sheet.html');
    const pdf = join(outDir, 'DEVELOPMENT_SUMMARY.pdf');
    await writeFile(html, renderSummarySheet(bundle, meta));
    await htmlToPdf(html, pdf);
    toJpeg(pdf, 'summary');
  }
}

if (want('slides')) {
  const outDir = join(root, 'slides');
  log('slides');
  const bundle = await runSlidesPipeline(address, {
    outDir, panelWmm: PANEL_W, panelHmm: PANEL_H, daPanelHmm: DA_PANEL_H, log,
  });
  // The site report's pages, in the default style: every one in order, numbered
  // from 1, and the old numbers past the new last page taken away, since the
  // frame turns through them until one is missing.
  {
    const html = join(outDir, 'slides.html');
    const pngDir = join(outDir, 'slides');
    await prepareRasters(bundle, join(outDir, 'data'), BLEED_SCALE, COUNTRY_SCALE);
    await writeFile(html, renderSlides(bundle, meta).html);
    const pages = await printSlides(html, join(outDir, 'OVERALL_ANALYSIS.pdf'), pngDir, { widthMm: SLIDE_W, heightMm: SLIDE_H });
    pages.forEach((png, i) => toJpeg(png, `slides-${i + 1}`));
    for (let n = pages.length + 1; existsSync(join(samples, `result-slides-${n}.jpg`)); n++) rmSync(join(samples, `result-slides-${n}.jpg`));
    rmSync(join(samples, 'result-slides.jpg'), { force: true });
  }
}

console.log('done');

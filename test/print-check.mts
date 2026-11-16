/* A print that came out short is caught, printed again, and never handed over.
 *
 * Chromium printed about one context sheet in a dozen, with four or eight
 * printing at once, before its HTML had finished parsing: the map as far as
 * its zoning, the title block blank, a valid PDF a third smaller than the
 * whole one. The pages now wait for their load (src/render/pdf.ts, open), and
 * the PDF is read back after it is printed (src/render/printCheck.ts) for the
 * title block and the pictures the page drew.
 *
 * A small sheet is composed in the shared title block (src/render/chrome.ts)
 * over a map of its own: an aerial, zoning, a bus route, street names, all
 * made up here, nothing fetched. Then:
 *
 *   - printed by htmlToPdf it is whole, and its text holds the title block;
 *   - its HTML cut off after the zoning, as the half-parsed print came out,
 *     fails the check for the address and the drawing title, and (where
 *     poppler's pdftoppm is installed) its title column is all but blank;
 *   - printed without its aerial, it fails for the picture;
 *   - a page read before it finished loading fails whatever its PDF holds;
 *   - printWhole prints a second time after one short print, and after two
 *     throws, with the PDF moved aside;
 *   - htmlToPdf on a page whose title block never reaches the print throws,
 *     and leaves nothing under the PDF's name;
 *   - a deck of three atlas pages (src/render/slides.ts) prints whole, each
 *     page ending with its marked number and title; cut off partway through
 *     page two it is caught for its last page and for page two's mark, which
 *     no other page's can stand in for; and printSlides fails a deck that
 *     prints short twice, with no PNGs left behind;
 *   - a planning yield deck of a made-up site with houses hard against its
 *     boundaries and lots round it that redevelop, laid out in the browser in
 *     each deck style and fitted as it is before it prints, keeps its text
 *     columns on their pages: every compliance sheet's ends above its key,
 *     the first's with what each criterion asks written under its row. A
 *     column with more in it than its page holds (as the criteria's own
 *     table once was under a compliance sheet's three: 2–4 Culworth Avenue,
 *     Killara, printed it through the key) is caught on its key, and the
 *     print says so.
 *
 * Needs Chromium: CHROMIUM_PATH, or the Playwright browsers.
 *
 *   CHROMIUM_NO_SANDBOX=1 npx tsx test/print-check.mts
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sheetHtml, MAP_W, MAP_H } from '../src/render/chrome.js';
import { encodeRgbaPng } from '../src/lib/png.js';
import { htmlToPdf, printSheetOnce, printSlides, launch, fitSlides } from '../src/render/pdf.js';
import { renderYieldDeck, type YieldBundle } from '../src/render/yieldSheet.js';
import { DECK_THEMES } from '../src/render/template.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';
import { atlasPage, deckCss, SLIDE_W, SLIDE_H, type Slide } from '../src/render/slides.js';
import {
  EXPECTATION, checkPrint, readPdf, missingFromPdf, letters, printWhole, titleColumnInk,
  incompletePath, IncompletePrintError, type PrintExpectation,
} from '../src/render/printCheck.js';
import { SHEET_H } from '../src/render/sheet.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const dir = mkdtempSync(join(tmpdir(), 'print-check-'));
mkdirSync(join(dir, 'data'));

// ---- a sheet of our own --------------------------------------------------------

// An aerial of noise, so it is a picture of some size and not a flat colour.
{
  const w = 480, h = 360, px = new Uint8Array(w * h * 4);
  let seed = 7;
  for (let i = 0; i < px.length; i += 4) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    px[i] = 90 + (seed & 63); px[i + 1] = 100 + ((seed >> 8) & 63); px[i + 2] = 80 + ((seed >> 16) & 63); px[i + 3] = 255;
  }
  writeFileSync(join(dir, 'data', 'aerial.png'), encodeRgbaPng(w, h, px));
}

const ADDRESS = '26, 28, 30 CAMPSIE STREET CAMPSIE';
const AFTER_ZONING = '<!-- above the zoning -->';
const layers = [
  `<image href="data/aerial.png" x="0" y="0" width="${MAP_W}" height="${MAP_H}" preserveAspectRatio="none"/>`,
  ...Array.from({ length: 24 }, (_, k) =>
    `<rect x="${30 + (k % 6) * 110}" y="${30 + Math.floor(k / 6) * 130}" width="95" height="115" fill="${['#f4c7b8', '#d98c74', '#a8d5c8', '#f2dfb0'][k % 4]}" fill-opacity="0.8"/>`),
  AFTER_ZONING,
  `<path d="M20,280 L690,300" stroke="#334488" stroke-width="0.9" stroke-dasharray="3,1.9" fill="none"/>`,
  ...['BEAMISH ST', 'CAMPSIE ST', 'NINTH AVE', 'NORTH PDE'].map((s, k) =>
    `<text x="${60 + k * 160}" y="${270 - k * 40}" font-size="4.9" font-weight="700" fill="#4a8a5a">${s}</text>`),
  `<g transform="translate(300,300)"><circle r="3.4" fill="#334488"/><text y="1.6" text-anchor="middle" font-size="4.5" fill="#fff">B</text></g>`,
];
const legendSvg = ['SITE', 'R2 LOW DENSITY RESIDENTIAL', 'BUS STOPS', 'BUS ROUTE'].map((l, k) =>
  `<g transform="translate(0,${7 + k * 10})"><rect x="6.3" y="0" width="23" height="6.5" fill="#d98c74"/><text x="34.1" y="3.5" font-size="2.7" fill="#222">${l}</text></g>`).join('');
const html = sheetHtml({
  meta: { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false },
  address: '26-30 Campsie St, Campsie NSW 2194',
  generatedAt: '2026-11-03T00:00:00Z',
  siteAddress: ADDRESS,
  scale: 3000,
  rotationDeg: 0,
  drawingTitle: 'CONTEXT ANALYSIS',
  legendHeading: 'CONTEXT ANALYSIS',
  legendSvg,
  layers,
});
const write = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, body); return p; };
const wholeHtml = write('sheet.html', html);

/** What a page promises, read as the printer reads it, once it has loaded: a sheet's first page, or every page of a deck. */
async function expectationOf(htmlPath: string, pageHeightMm = SHEET_H, maxPages = 1): Promise<PrintExpectation> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    return await page.evaluate(`${EXPECTATION}(${(pageHeightMm / 25.4) * 96}, ${maxPages})`) as PrintExpectation;
  } finally {
    await browser.close();
  }
}

const expected = await expectationOf(wholeHtml);
check('the page marks its address and its drawing title', expected.marks.length === 2 && expected.pages === 1 &&
  expected.marks.every((m) => m.page === 0) &&
  expected.marks.some((m) => letters(m.text).includes(letters(ADDRESS))) && expected.marks.some((m) => letters(m.text).includes('drawingtitle')),
  JSON.stringify(expected.marks));
check('the page names its aerial', expected.images.length === 1 && expected.images[0].endsWith('/data/aerial.png'), JSON.stringify(expected.images));
check('the page had loaded', expected.complete);

// ---- whole --------------------------------------------------------------------

const logged: string[] = [];
const wholePdf = join(dir, 'CONTEXT_ANALYSIS.pdf');
await htmlToPdf(wholeHtml, wholePdf, join(dir, 'preview.jpg'), (m) => logged.push(m));
check('a whole sheet prints the first time', logged.length === 0 && existsSync(wholePdf), logged.join(' | '));
check('and its picture is taken', existsSync(join(dir, 'preview.jpg')));
const whole = await readPdf(wholePdf);
check('its PDF reads back with the title block', letters(whole.pages[0]).includes(letters(`SITE ADDRESS${ADDRESS}`)) && letters(whole.pages[0]).includes('drawingtitlecontextanalysis'),
  JSON.stringify(whole.pages[0].slice(-120)));
check('and with the street names', letters(whole.pages[0]).includes('beamishst'));
check('and its one picture', whole.images === 1, `${whole.images}`);
check('nothing is missing from it', missingFromPdf(whole, expected).length === 0, missingFromPdf(whole, expected).join('; '));

// ---- cut short, as a half-parsed page printed ------------------------------------

const cutHtml = write('sheet_cut.html', html.slice(0, html.indexOf(AFTER_ZONING)));
const cutPdf = join(dir, 'CONTEXT_ANALYSIS_cut.pdf');
// The cut page's own marks are not there to be expected: it is checked
// against what the whole page promised, as the server's page would have been.
await printSheetOnce(cutHtml, cutPdf);
const cutMissing = await checkPrint(cutPdf, expected);
check('a print cut off after the zoning is caught', cutMissing.length === 2 &&
  cutMissing.some((m) => m.includes(ADDRESS)) && cutMissing.some((m) => m.includes('DRAWING TITLE')), cutMissing.join('; '));
check('its picture is still there, so the picture is not what failed it', !cutMissing.some((m) => m.includes('picture')));
const inkWhole = titleColumnInk(wholePdf), inkCut = titleColumnInk(cutPdf);
if (inkWhole === undefined || inkCut === undefined) console.log('     (no pdftoppm: the title column\'s ink is not measured)');
else check('and its title column is all but blank', inkCut < 0.02 && inkWhole > 5 * inkCut, `ink ${inkWhole.toFixed(3)} whole, ${inkCut.toFixed(3)} cut`);

// ---- without its aerial ---------------------------------------------------------

const bareHtml = write('sheet_bare.html', html.replace('data/aerial.png', 'data/not-there.png'));
const barePdf = join(dir, 'CONTEXT_ANALYSIS_bare.pdf');
await printSheetOnce(bareHtml, barePdf);
const bareMissing = await checkPrint(barePdf, expected);
check('a print without its aerial is caught', bareMissing.length === 1 && bareMissing[0] === '1 of 1 picture', bareMissing.join('; '));

// ---- read before it had loaded ------------------------------------------------------

check('a page read before it finished loading fails, whatever its PDF holds',
  missingFromPdf(whole, { ...expected, complete: false }).length === 1);

// ---- once more, then fail -------------------------------------------------------------

{
  const pdf = join(dir, 'retry.pdf');
  const said: string[] = [];
  let n = 0;
  await printWhole(pdf, async () => { writeFileSync(pdf, readFileSync(wholePdf)); return n++ === 0 ? ['the text "X"'] : []; }, (m) => said.push(m));
  check('one short print is printed again', n === 2 && existsSync(pdf) && said.length === 1 && said[0].startsWith('WARN'), said.join(' | '));

  n = 0;
  let thrown: unknown;
  try {
    await printWhole(pdf, async () => { writeFileSync(pdf, readFileSync(cutPdf)); n++; return ['the text "X"']; }, () => {});
  } catch (e) { thrown = e; }
  check('two short prints fail, after exactly two', thrown instanceof IncompletePrintError && n === 2, String(thrown));
  check('and the short PDF is moved out of its name', !existsSync(pdf) && existsSync(incompletePath(pdf)));
}

// ---- a sheet whose title block never prints ------------------------------------------

{
  // Shown on screen, hidden in print: the page promises a title block its PDF can never hold.
  const neverHtml = write('sheet_never.html', html.replace('</style>', '@media print { [data-print-check] { visibility: hidden } }\n</style>'));
  const pdf = join(dir, 'NEVER.pdf');
  const said: string[] = [];
  let thrown: unknown;
  try { await htmlToPdf(neverHtml, pdf, join(dir, 'never.jpg'), (m) => said.push(m)); } catch (e) { thrown = e; }
  check('htmlToPdf fails a sheet that prints short twice', thrown instanceof IncompletePrintError &&
    (thrown as Error).message.includes('incomplete twice') && (thrown as Error).message.includes(ADDRESS), String(thrown));
  check('after one warning and a second print', said.length === 1 && said[0].includes('printing it again'), said.join(' | '));
  check('with no PDF and no picture left to serve', !existsSync(pdf) && existsSync(incompletePath(pdf)) && !existsSync(join(dir, 'never.jpg')));
}

// ---- a deck ------------------------------------------------------------------------------

{
  // Three atlas pages, as the site report and the yield draw them, the second with the aerial on its right-hand page.
  const slide = (n: number, title: string, figure = ''): Slide => ({
    id: `0${n}_${title.toLowerCase()}`, title, subtitle: `${title} · Campsie · 1:4000`,
    narrative: 'What the street asks of the site.', textHtml: `<p>${title} of the site and its street, page ${n}.</p>`,
    figureHtml: figure, sources: 'Sources: made up for this test.',
  });
  const slides = [
    slide(1, 'Location'),
    slide(2, 'Character', `<div class="abs" style="left:222mm;top:20mm;width:186mm;height:250mm"><img src="data/aerial.png" style="width:100%;height:100%;object-fit:cover"></div>`),
    slide(3, 'Movement'),
  ];
  const deck = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>${deckCss()}</style></head><body>${slides.map((s, i) => atlasPage(s, i)).join('\n')}</body></html>`;
  const deckHtml = write('deck.html', deck);
  const size = { widthMm: SLIDE_W, heightMm: SLIDE_H };
  const deckExpected = await expectationOf(deckHtml, SLIDE_H, Infinity);
  check('a deck marks each page\'s number and title, on its own page', deckExpected.pages === 3 &&
    deckExpected.marks.map((m) => `${m.page}:${letters(m.text)}`).join(' ') === '0:01location 1:02character 2:03movement',
    JSON.stringify(deckExpected.marks));
  check('and names its one picture', deckExpected.images.length === 1, JSON.stringify(deckExpected.images));

  const said: string[] = [];
  const deckPdf = join(dir, 'DECK.pdf');
  const pngs = await printSlides(deckHtml, deckPdf, join(dir, 'deck'), size, join(dir, 'deck.jpg'), (m) => said.push(m));
  check('a whole deck prints the first time, a PNG a page', said.length === 0 && pngs.length === 3 && pngs.every((p) => existsSync(p)), said.join(' | '));
  const read = await readPdf(deckPdf);
  check('each page ends with its mark: drawn after everything else on it',
    read.pages.length === 3 && read.pages.every((p, i) => letters(p).endsWith(letters(deckExpected.marks[i].text))),
    read.pages.map((p) => JSON.stringify(p.slice(-30))).join(' '));
  check('nothing is missing from it', missingFromPdf(read, deckExpected).length === 0, missingFromPdf(read, deckExpected).join('; '));
  check('one page\'s mark is not found on another', missingFromPdf(read, { ...deckExpected, marks: [{ ...deckExpected.marks[0], page: 1 }] }).length === 1);

  // Cut off partway through page two, after its drawing and before its number and title, as a half-parsed deck printed.
  const second = deck.indexOf('<section', deck.indexOf('<section') + 1);
  const cutDeckHtml = write('deck_cut.html', deck.slice(0, deck.indexOf('<div data-print-check>', second)));
  const cutDeckPdf = join(dir, 'DECK_cut.pdf');
  await printSlides(cutDeckHtml, cutDeckPdf, join(dir, 'deck_cut'), size);
  const cutDeck = await checkPrint(cutDeckPdf, deckExpected);
  check('a deck cut off partway through page two is caught: the last page, and page two\'s mark',
    cutDeck.length === 3 && cutDeck[0] === '1 of 3 pages' && cutDeck.some((m) => m.includes('CHARACTER') || m.includes('Character')) && cutDeck.some((m) => m.endsWith('on page 2')) && cutDeck.some((m) => m.endsWith('on page 3')),
    cutDeck.join('; '));

  // Shown on screen, hidden in print: every page promises a mark its PDF can never hold.
  const neverDeck = write('deck_never.html', deck.replace('</style>', '@media print { [data-print-check] { visibility: hidden } }\n</style>'));
  const pdf = join(dir, 'DECK_never.pdf');
  const warned: string[] = [];
  let thrown: unknown;
  try { await printSlides(neverDeck, pdf, join(dir, 'deck_never'), size, join(dir, 'deck_never.jpg'), (m) => warned.push(m)); } catch (e) { thrown = e; }
  check('printSlides fails a deck that prints short twice, after one warning', thrown instanceof IncompletePrintError && warned.length === 1 &&
    (thrown as Error).message.includes('on page 3'), String(thrown));
  check('with no PDF, no PNGs and no picture left to serve', !existsSync(pdf) && existsSync(incompletePath(pdf)) &&
    !existsSync(join(dir, 'deck_never')) && !existsSync(join(dir, 'deck_never.jpg')));
}

// ---- a yield deck's text columns keep to their pages -----------------------------------------

{
  // A 40 x 50 m site in R4, a street along the south. Houses stand hard against it on the east, the west and the north,
  // and the lots east and west may redevelop: a compliance sheet with each of its three tables full, the separations
  // today and built out. (The site of test/yield-futures.mts, with more neighbours.)
  const ORIGIN = lonLatToMercator({ lon: 151.215, lat: -33.875 });
  const K = mercatorScaleFactor(-33.875);
  const ll = (xM: number, yM: number): [number, number] => { const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K }); return [p.lon, p.lat]; };
  const rect = (x: number, y: number, w: number, h: number): [number, number][] => [ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)];
  const house = (x: number, y: number, zone = 'R4') => ({ rings: [rect(x, y, 9, 12)], heightM: 6.2, known: true, controls: zone === 'R4' ? { zone, hobM: 18.6, fsr: 1.3 } : { zone } });
  const parcel = (x: number, w: number, numbers: string[]) => ({ rings: [rect(x, 0, w, 50)], numbers, zone: 'R4', hob: { value: 18.6, units: 'm' }, fsr: 1.3 });
  const bundle = {
    address: 'test', siteAddress: '1 TEST STREET TESTVILLE', generatedAt: '2026-11-16T00:00:00Z', lotDescription: 'Lot 1 DP 1', siteAreaSqm: 2000, areaIsCadastral: true,
    controls: { zoneCode: 'R4', zonePurpose: 'High Density Residential', maxHeightM: 18.6, heightUnits: 'm', fsr: 1.3, heritage: [] },
    siteRing: rect(0, 0, 40, 50), frontages: ['TEST ST', null, null, null], policyAtSite: [], kerbs: [], buildingsSource: 'osm', existing: [],
    roads: [{ name: 'TEST ST', hierarchy: 6, coords: [ll(-200, -10), ll(300, -10)] }],
    parcels: [parcel(40, 50, ['2']), parcel(-15, 15, ['1']), parcel(-30, 15, ['3']), parcel(-45, 15, ['5']),
      { rings: [rect(0, 52, 40, 40)], numbers: ['7'], zone: 'R2', hob: { value: 9.5, units: 'm' }, fsr: 0.5 }],
    context: [house(43, 4), house(43, 30), house(-12, 4), house(-12, 30), house(4, 55, 'R2'), house(24, 55, 'R2')],
  } as unknown as YieldBundle;
  const meta = { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false };

  /** Where each page's text column ends, its key begins and its last line stands, in mm from the page's top. */
  const COLUMNS = `[...document.querySelectorAll('section.slide.atlas')].map(function (sl) {
    var top = sl.getBoundingClientRect().top, flow = sl.querySelector('.zflow'), key = sl.querySelector('.zleg');
    var mm = function (v) { return (v - top) * 25.4 / 96; };
    var table = flow && flow.querySelector('table.yt');
    return { id: sl.id, end: flow && flow.lastElementChild ? mm(flow.lastElementChild.getBoundingClientRect().bottom) : null,
      key: key ? mm(key.getBoundingClientRect().top) : null, base: Number(sl.dataset.base),
      blocks: flow ? flow.children.length : 0, rows: flow ? flow.querySelectorAll('table.yt tbody tr').length : 0,
      notes: flow ? flow.querySelectorAll('table.yt tr.yn').length : 0, tablePx: table ? parseFloat(getComputedStyle(table).fontSize) : null };
  })`;
  interface Column { id: string; end: number | null; key: number | null; base: number; blocks: number; rows: number; notes: number; tablePx: number | null }
  const said = (cs: Column[]) => cs.map((c) => `${c.id.slice(0, 2)}: ${c.end?.toFixed(1)} of ${(c.key ?? c.base).toFixed(1)}`).join(', ');

  const browser = await launch();
  try {
    for (const theme of DECK_THEMES) {
      const htmlPath = write(`yield-${theme}.html`, renderYieldDeck(bundle, meta, { theme }).html);
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      const overruns = await fitSlides(page);
      const columns = await page.evaluate(COLUMNS) as Column[];
      const sheets = columns.filter((c) => /_compliance$/.test(c.id)), lastPage = columns[columns.length - 1];
      if (theme === DECK_THEMES[0]) {
        check('the yield deck has its compliance sheets, each with three tables, the separations today and built out',
          sheets.length >= 3 && sheets.every((c) => c.blocks === 3 && c.rows >= 14) && /_controls_and_assumptions$/.test(lastPage.id),
          sheets.map((c) => `${c.id}: ${c.blocks} blocks, ${c.rows} rows`).join('; '));
        check('the first sheet writes out what each criterion asks, under its row', sheets[0].notes >= 5 && sheets.slice(1).every((c) => c.notes === 0), sheets.map((c) => c.notes).join(', '));
      }
      check(`${theme}: every compliance sheet's text column ends above its key`, sheets.length >= 3 && sheets.every((c) => c.end !== null && c.key !== null && c.end <= c.key - 1.5), said(sheets));
      check(`${theme}: every other spread's does too`, columns.filter((c) => c.key !== null && c.end !== null && c.rows > 0).every((c) => c.end! <= c.key! - 1.5), said(columns.filter((c) => c.key !== null && c.end !== null && c.rows > 0)));
      check(`${theme}: the fitting leaves no column on its key`, overruns.length === 0, JSON.stringify(overruns));
      await page.close();
    }

    // More under a compliance sheet's tables than the page holds over its key, as the criteria's own table was: the
    // sheet's last table set four times more.
    const htmlPath = join(dir, `yield-${DECK_THEMES[0]}.html`);
    const OVERFILL = `(() => {
      const first = [...document.querySelectorAll('section.slide.atlas')].find((sl) => sl.id.endsWith('_compliance'));
      const flow = first.querySelector('.zflow'), last = flow.lastElementChild;
      for (let i = 0; i < 4; i++) flow.appendChild(last.cloneNode(true));
      return first.id;
    })()`;
    {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      const sheet = await page.evaluate(OVERFILL) as string;
      const overruns = await fitSlides(page);
      const column = (await page.evaluate(COLUMNS) as Column[]).find((c) => c.id === sheet)!;
      check('a column with more in it than its page holds is caught on its key, its tables closed up as far as they go',
        overruns.length === 1 && overruns[0].id === sheet && overruns[0].byMm > 5 && column.tablePx !== null && column.tablePx < 8.2,
        `${JSON.stringify(overruns)}, tables at ${column.tablePx} px`);
      await page.close();
      // and the print says so
      const wrongHtml = write('yield-wrong.html', readFileSync(htmlPath, 'utf8').replace('</body>', `<script>${OVERFILL}</script></body>`));
      const warned: string[] = [];
      await printSlides(wrongHtml, join(dir, 'YIELD_wrong.pdf'), join(dir, 'yield_wrong'), { widthMm: SLIDE_W, heightMm: SLIDE_H }, undefined, (m) => warned.push(m));
      check('and the print says which page, and by how much', warned.length === 1 && warned[0].startsWith(`WARN page ${sheet}: its text column runs `) && warned[0].endsWith(' mm into its key'), warned.join(' | '));
    }
  } finally {
    await browser.close();
  }
}

rmSync(dir, { recursive: true, force: true });
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');

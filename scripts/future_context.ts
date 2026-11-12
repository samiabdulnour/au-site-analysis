// The future-context scenarios over a capacity study: how the blocks round the
// site might redevelop, as three A3 landscape sheets, one a scenario, each a
// plan at 1:500 on the clean aerial beside an axonometric massing and an
// indicative yield (storeys, GFA, FSR, and where density parity with the site
// lands). The scenarios are the author's, in a JSON file that names each
// parcel by its register address and each building by its footprint type,
// storeys and the street or party wall its long axis follows; the footprints
// are fitted to the real cadastre here.
//
//   npm run capacity -- "70-76 Riley Street, Darlinghurst NSW 2010" --out out/capacity/riley
//   npm run future -- out/capacity/riley --scenarios examples/capacity_study/70-76-riley-street-darlinghurst.future.json
//   npm run future -- out/capacity/riley --scenarios … --redraw      (draw again from what was fetched)
//   npm run future -- out/capacity/riley --scenarios … --redraw --sun-context   (read the 300 m the sun reaches)
//
// Over the context plan's reading (analysis.json: every property's polygon,
// the lots, the roads) it fetches, once, what the sheets need beyond it: the
// aerial at its native resolution over the study window, the LEP's height of
// buildings and floor space ratio layers over it, and the height the 3D tiles
// give each property in the window (the Map Tiles API, with
// GOOGLE_MAPS_API_KEY, or 'header' where a proxy in front of this process
// adds the key), so what stands today is measured rather than assumed. The
// drawing is scripts/capacity_study/future_context.py; the pages are
// printed with the deck's Chromium and bound into one PDF.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { fetchAerial } from '../src/fetch/imagery.js';
import { fetchFloorSpaceRatio, fetchHeightOfBuilding } from '../src/fetch/nsw.js';
import { meshSurfaceOver } from '../src/fetch/meshHeights.js';
import { footprintHeight, toXY, type XY } from '../src/lib/meshHeights.js';
import { mercatorToLonLat, type Extent } from '../src/lib/geo.js';
import { printPage } from '../src/render/pdf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((x, i) => !x.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const scenarios = flag('--scenarios');
if (!dir || !scenarios) { console.error('usage: npm run future -- out/capacity/<slug> --scenarios scenarios.json [--redraw]'); process.exit(1); }
const out = resolve(dir);
if (!existsSync(join(out, 'analysis.json'))) { console.error(`${out}/analysis.json is not there: run npm run capacity for the address first`); process.exit(1); }
const log = (m: string) => console.error(m);
const redraw = args.includes('--redraw') && existsSync(join(out, 'future.json'));

/** The plan's window: the sheet's plan at 1:500 is 184 × 216 mm, 92 × 108 ground metres, centred on the study blocks. */
const PLAN_M = { w: 92, h: 108 };
const MARGIN_M = 40;

/** How far round the site the sun study reads what stands: a tower this far off can still shade the site on the
 *  mid-winter morning, when the sun is 19° up; north, east and west of it, and a little south. */
const SUN_REACH_M = 300;

if (!redraw) await fetchStudy();
if (!redraw || args.includes('--sun-context')) await fetchSunContext();


async function fetchSunContext(): Promise<void> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim() || (process.env.GOOGLE_MAPS_KEY_IN_HEADER === '1' ? 'header' : undefined);
  if (!key) { log('  no GOOGLE_MAPS_API_KEY: the sun study keeps the study window\'s buildings alone'); return; }
  const a = JSON.parse(await readFile(join(out, 'analysis.json'), 'utf8'));
  const f = JSON.parse(await readFile(join(out, 'future.json'), 'utf8'));
  const k: number = a.k;
  const props = Object.values(a.props) as { propid: number; geom: number[][][]; centroid: [number, number]; isSite?: boolean }[];
  const site = props.find((p) => p.isSite)!;
  const [cx, cy] = site.centroid;
  const win: Extent = { xmin: cx - SUN_REACH_M * k, xmax: cx + SUN_REACH_M * k, ymin: cy - 80 * k, ymax: cy + SUN_REACH_M * k };
  log(`the sun's reach: ${2 * SUN_REACH_M} × ${SUN_REACH_M + 80} m round the site, what stands there off the 3D tiles`);
  let surface: Awaited<ReturnType<typeof meshSurfaceOver>> | null = null;
  try { surface = await meshSurfaceOver(key, win, log); } catch (e: any) { log(`  WARN the sun's reach: ${e?.message ?? e}`); return; }
  const rings = (geom: number[][][]): XY[][] => geom.map((r) => r.map(([x, y]) => { const ll = mercatorToLonLat({ x, y }); return toXY(surface!.frame, ll.lon, ll.lat); }));
  let read = 0;
  for (const p of props) {
    if (!p.geom?.length || f.heights[String(p.propid)] || p.centroid[0] < win.xmin || p.centroid[0] > win.xmax || p.centroid[1] < win.ymin || p.centroid[1] > win.ymax) continue;
    const h = footprintHeight(surface.field, rings(p.geom));
    if (h) { f.heights[String(p.propid)] = h; read++; }
  }
  f.sunContext = { reachM: SUN_REACH_M, meshes: surface.meshes, read };
  await writeFile(join(out, 'future.json'), JSON.stringify(f));
  log(`  the sun's reach: ${read} more properties read off ${surface.meshes} meshes`);
}

async function fetchStudy(): Promise<void> {
  const a = JSON.parse(await readFile(join(out, 'analysis.json'), 'utf8'));
  const sc = JSON.parse(await readFile(resolve(scenarios!), 'utf8')) as { blocks: string[][] };
  const k: number = a.k;
  const props = Object.values(a.props) as { propid: number; base: string; geom: number[][][]; centroid: [number, number]; isSite?: boolean }[];
  const site = props.find((p) => p.isSite)!;
  const named = sc.blocks.flat();
  const inStudy = props.filter((p) => p.isSite || named.some((n) => p.base === n || p.base.startsWith(`${n} `)));
  const xs = inStudy.flatMap((p) => p.geom.flat().map((q) => q[0])), ys = inStudy.flatMap((p) => p.geom.flat().map((q) => q[1]));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const win: Extent = { xmin: cx - (PLAN_M.w / 2 + MARGIN_M) * k, xmax: cx + (PLAN_M.w / 2 + MARGIN_M) * k, ymin: cy - (PLAN_M.h / 2 + MARGIN_M) * k, ymax: cy + (PLAN_M.h / 2 + MARGIN_M) * k };
  log(`the study window: ${PLAN_M.w + 2 * MARGIN_M} × ${PLAN_M.h + 2 * MARGIN_M} m about ${site.base}`);
  const soft = async <T,>(name: string, p: Promise<T>, fallback: T): Promise<T> => {
    try { const r = await p; log(`  ${name}`); return r; } catch (e: any) { log(`  WARN ${name}: ${e?.message ?? e}`); return fallback; }
  };
  const empty = { type: 'FeatureCollection', features: [] };
  // the aerial at the imagery's own resolution (fetchAerial holds a request to it), the LEP's layers over the window
  const [aerial, hob, fsr] = await Promise.all([
    soft('aerial over the study', fetchAerial(win, 4000, join(out, 'data'), 'future'), null),
    soft('LEP height of buildings', fetchHeightOfBuilding(win), empty),
    soft('LEP floor space ratio', fetchFloorSpaceRatio(win), empty),
  ]);
  if (!aerial) throw new Error('no aerial over the study window');
  // what stands: each property's height from the 3D tiles' surface, where there is a key for them
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim() || (process.env.GOOGLE_MAPS_KEY_IN_HEADER === '1' ? 'header' : undefined);
  const heights: Record<string, { heightM: number; roofZ: number; groundZ: number } | null> = {};
  let mesh: { meshes: number; errorM: number; credits: string[] } | null = null;
  if (key) {
    const surface = await soft('3D-tile heights', meshSurfaceOver(key, win, log), null);
    if (surface) {
      mesh = { meshes: surface.meshes, errorM: surface.errorM, credits: surface.credits };
      const rings = (geom: number[][][]): XY[][] => geom.map((r) => r.map(([x, y]) => { const ll = mercatorToLonLat({ x, y }); return toXY(surface.frame, ll.lon, ll.lat); }));
      let read = 0;
      for (const p of props) {
        if (!p.geom?.length || p.centroid[0] < win.xmin || p.centroid[0] > win.xmax || p.centroid[1] < win.ymin || p.centroid[1] > win.ymax) continue;
        const h = footprintHeight(surface.field, rings(p.geom));
        heights[String(p.propid)] = h;
        if (h) read++;
      }
      log(`  heights: ${read} of the window's properties read off ${surface.meshes} meshes`);
    }
  } else log('  no GOOGLE_MAPS_API_KEY: the retained buildings keep their assumed storeys');
  await writeFile(join(out, 'future.json'), JSON.stringify({ window: win, aerial, hob, fsr, heights, mesh, fetchedAt: new Date().toISOString() }));
}

// draw, then the mid-winter sun over the drawing's massing where Loriini is beside this repository (or LORIINI names
// it), then draw again with the sun on the sheets; print, bind
const run = promisify(execFile);
const python = process.env.PYTHON || 'python3';
const draw = async () => {
  const { stdout, stderr } = await run(python, ['-I', join(HERE, 'capacity_study', 'future_context.py'), out, resolve(scenarios!)], { maxBuffer: 64 * 1024 * 1024 });
  if (stderr.trim()) log(stderr.trim());
  log(`  future_context.py: ${stdout.trim()}`);
};
await draw();
const loriini = process.env.LORIINI || (existsSync(join(HERE, '..', '..', 'loriini', 'src')) ? join(HERE, '..', '..', 'loriini') : undefined);
if (loriini && !args.includes('--no-sun')) {
  try {
    const { stdout } = await run(python, ['-I', join(HERE, 'capacity_study', 'future_solar.py'), out], { env: { ...process.env, LORIINI: loriini }, maxBuffer: 64 * 1024 * 1024 });
    log(`  future_solar.py: ${stdout.trim()}`);
    await draw();
  } catch (e: any) { log(`  WARN the sun study did not run: ${e?.message ?? e}`); }
} else log('  no Loriini beside this repository (LORIINI unset): the sheets carry no sun study');
const { width, height, pages, summary, options, sun: sunPages = 0 } = JSON.parse(await readFile(join(out, 'future-page.json'), 'utf8')) as { width: number; height: number; pages: number; summary?: boolean | number; options?: boolean; sun?: number };
// future.pdf: the overview over every scenario, then a sheet for each in the overview's form; future-detail.pdf: the
// sheets in full (the plan at 1:500, the massing, the yield, the assumptions); future-sun.pdf: the sun's proof for
// our own apartments, a sheet a scenario
const print = async (name: string, into: PDFDocument) => {
  await printPage(join(out, `${name}.html`), { width, height }, { png: join(out, `${name}.png`), pdf: join(out, `${name}.pdf`) });
  const one = await PDFDocument.load(await readFile(join(out, `${name}.pdf`)));
  for (const p of await into.copyPages(one, one.getPageIndices())) into.addPage(p);
  log(`  printed ${name}`);
};
const each = Array.from({ length: pages }, (_, i) => i + 1);
// the overview runs over as many sheets as the scenarios need (eight a sheet at most)
const overview = typeof summary === 'number' ? Array.from({ length: summary }, (_, i) => `future-summary-${i + 1}`) : summary ? ['future-summary'] : [];
const main = [...overview, ...(options ? each.map((i) => `future-option-${i}`) : [])];
const detail = each.map((i) => `future-${i}`);
const bound = await PDFDocument.create();
for (const name of main) await print(name, bound);
const full = await PDFDocument.create();
for (const name of detail) await print(name, full);
// future-sun.pdf: the sun's proof for the site's own apartments, a sheet a scenario, where the plans gave them
const proof = Array.from({ length: sunPages }, (_, i) => `future-sun-${i + 1}`);
const sunDoc = await PDFDocument.create();
for (const name of proof) await print(name, sunDoc);
await writeFile(join(out, main.length ? 'future.pdf' : 'future-detail.pdf'), await (main.length ? bound : full).save());
if (main.length) await writeFile(join(out, 'future-detail.pdf'), await full.save());
if (proof.length) await writeFile(join(out, 'future-sun.pdf'), await sunDoc.save());
console.log([...main, ...detail, ...proof].map((n) => join(out, `${n}.png`)).concat(join(out, 'future.pdf'), ...(main.length ? [join(out, 'future-detail.pdf')] : []), ...(proof.length ? [join(out, 'future-sun.pdf')] : [])).join('\n'));

// The capacity and opportunity site study: the context plan an urban designer
// draws to show which lots around a site are likely, or unlikely, to
// redevelop in the short to medium term. An A3 landscape sheet at 1:2000:
// the blocks around the site over the faded aerial and the cadastre, every
// property outlined by ownership (a single title in white, a strata scheme
// filled, a heritage building in orange), a tick on the lots with
// development potential, a cross on those with none (strata ownership,
// heritage items, public land) and a dot on mature development (a site
// significantly developed in the past 20 years, or one with a current
// approval or construction), the site in red; a legend on the left.
//
//   npm run capacity -- "70-76 Riley Street, Darlinghurst NSW 2010"
//   npm run capacity -- "<address>" --notes my-notes.html --out out/capacity/riley
//   npm run capacity -- "<address>" --overrides marks.json   (the author's marks where the data cannot see: a new
//                                                             building on a single title before the register begins)
//   npm run capacity -- "<address>" --redraw      (draw again from what was fetched, after an edit to the scripts)
//
// Everything comes from the open data the deck already reads (geocoder,
// cadastre, imagery, ePlanning, the Online DA API) plus the cadastre's
// property register, whose unit addresses size each strata scheme, the
// cadastre's record dates, which date a strata plan's registration, and the
// council's development monitoring and parks layers where it publishes them
// (the City of Sydney does). The reading and the drawing are two small Python
// scripts beside this file; the page is printed with the deck's Chromium.
// Ownership is read from plan types and public-land layers, not from title
// searches, and says so on the sheet.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { queryByExtent, queryByPoint, type GeoJSONFC } from '../src/lib/arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat, type Extent } from '../src/lib/geo.js';
import { geocode, parseAddress } from '../src/fetch/geocode.js';
import { fetchAerial } from '../src/fetch/imagery.js';
import { fetchSiteControls, fetchSiteLots } from '../src/fetch/nsw.js';
import { apiCouncilName, clipToExtent, fetchCouncilApplications, PORTAL_MANDATED } from '../src/fetch/da.js';
import { printPage } from '../src/render/pdf.js';
import { classifyCapacity, registerRecords, inWindow, capacityCounts, type CapacityOverrides } from '../src/lib/capacity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const CADASTRE = `${PORTAL}/NSW_Land_Parcel_Property_Theme/FeatureServer`;
const EPI = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer';
const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const IMAGERY_DATES = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery_Dates/MapServer/0';
/** The City of Sydney's open data; other councils' registers are not on a service this script knows. */
const COS = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services';
/** Ground metres fetched around the site: the A3 sheet at 1:2000 shows 620 x 594 m of it, the site at centre. */
const FETCH_W = 700, FETCH_H = 680;

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const address = args.find((x, i) => !x.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!address) { console.error('usage: npm run capacity -- "<address>" [--notes notes.html] [--out out/capacity/<slug>]'); process.exit(1); }
const slug = address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = resolve(flag('--out') ?? join(HERE, '..', 'out', 'capacity', slug));
const notes = flag('--notes') ? resolve(flag('--notes')!) : undefined;
const redraw = args.includes('--redraw') && existsSync(join(out, 'bundle.json')) && existsSync(join(out, 'da.json'));
const log = (m: string) => console.error(m);
const empty: GeoJSONFC = { type: 'FeatureCollection', features: [] };
const soft = async <T,>(name: string, p: Promise<T>, fallback: T): Promise<T> => {
  try { const r = await p; log(`  ${name}`); return r; } catch (e: any) { log(`  WARN ${name}: ${e?.message ?? e}`); return fallback; }
};

await mkdir(join(out, 'data'), { recursive: true });
// the author's overrides.json, keyed by the start of a property's address as the register writes it
// ("121-129 CROWN STREET"), each { symbol: 'mature' | 'none' | 'potential', note?: 'built 2019' }
if (flag('--overrides')) await copyFile(resolve(flag('--overrides')!), join(out, 'overrides.json'));
if (!redraw) await fetchWindow();

async function fetchWindow(): Promise<void> {
log(`geocoding ${address}`);
const geo = await geocode(address);
const centre = geo.center;
const lat = mercatorToLonLat(centre).lat;
const k = mercatorScaleFactor(lat);
const extent: Extent = { xmin: centre.x - (FETCH_W / 2) * k, xmax: centre.x + (FETCH_W / 2) * k, ymin: centre.y - (FETCH_H / 2) * k, ymax: centre.y + (FETCH_H / 2) * k };
log(`fetching the window (${FETCH_W} x ${FETCH_H} m) around ${geo.matchedAddresses.join('; ')}`);

const imageryDate = async () => {
  const fc = await queryByPoint(IMAGERY_DATES, centre, 'BlockName,BlockType,BlockStartDate,Resolution_cm');
  const p = fc.features[0]?.properties;
  if (!p) return null;
  const ms = Number(p.BlockStartDate);
  return { block: String(p.BlockName ?? ''), type: String(p.BlockType ?? ''), date: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : undefined, resolutionCm: Number(p.Resolution_cm) || undefined };
};
const [siteLots, lots, props, roadNames, heritage, stateLand, crownLand, parks, facilities, devMon, controls, imagery, aerial] = await Promise.all([
  soft('site lots', fetchSiteLots(geo.points), empty),
  soft('lots', queryByExtent(`${CADASTRE}/8`, extent, 'lotidstring,planlabel,plannumber,lotnumber,sectionnumber,planlotarea,planlotareaunits,stratumlevel,hasstratum,classsubtype,createdate'), empty),
  soft('property register', queryByExtent(`${CADASTRE}/12`, extent, 'propid,address,housenumber,propertytype,valnetpropertytype,valnetpropertystatus,valnetlotcount,dissolveparcelcount,superlot'), empty),
  soft('road names', queryByExtent(`${CADASTRE}/1`, extent, 'roadnamelabel'), empty),
  soft('heritage', queryByExtent(`${EPI}/0`, extent, 'LAY_CLASS,H_NAME,SIG,EPI_NAME'), empty),
  soft('State government land', queryByExtent(`${M3}/Planning_Portal_GPI/MapServer/302`, extent, 'LOTREF,SOURCE,PLANLABEL'), empty),
  soft('Crown land', queryByExtent(`${M3}/Planning_Portal_Crown_Land/MapServer/258`, extent, 'Area_H,DISPOSALSTATUS'), empty),
  soft('council parks', queryByExtent(`${COS}/Parks/FeatureServer/0`, extent, 'Name,Type'), empty),
  soft('council facilities', queryByExtent(`${COS}/CouncilFacilities/FeatureServer/0`, extent, 'Name,Address,Suburb'), empty),
  soft('development monitoring', queryByExtent(`${COS}/Development_Monitoring/FeatureServer/0`, extent, 'StNumber,StName,Suburb,MajorUse,DA_Number,DevelopmentType,Lodged,Determined,Completion,Status_1,Priv_Dwgs,LevelsAbove,GFA,DateExtracted'), empty),
  soft('controls at the site', fetchSiteControls(centre), null),
  soft('imagery date', imageryDate(), null),
  soft('aerial', fetchAerial(extent, 4400, join(out, 'data'), 'aerial'), null),
]);
if (!aerial) throw new Error('no aerial for this window');
// the council's applications on the Planning Portal, clipped to the window
const council = apiCouncilName(undefined, controls?.lgaName);
let near: unknown[] = [];
if (council) {
  const feed = await soft('Online DA feed', fetchCouncilApplications(council, PORTAL_MANDATED, new Date().toISOString().slice(0, 10), log), null);
  if (feed) near = clipToExtent(feed.records, extent, 0.1);
} else log(`  WARN no Online DA council for "${controls?.lgaName}"`);
await writeFile(join(out, 'da.json'), JSON.stringify({ council, near }));

// what the sheet says the site is
const matched = geo.matchedAddresses[0] ?? address;
const parsed = parseAddress(matched);
const tc = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const number = matched.replace(new RegExp(`\\s+${parsed.street}.*$`), '');
const caption = `${number} ${tc(parsed.street)}${parsed.locality ? `, ${tc(parsed.locality)}` : ''}`;
const lotDescription = siteLots.features.map((f) => {
  const [lot, , plan] = String(f.properties.lotidstring ?? '').split('/');
  return plan ? `Lot ${lot || '-'} ${plan.replace(/^([A-Z]+)(\d)/, '$1 $2')}` : String(f.properties.lotidstring ?? '');
}).join(', ');
await writeFile(join(out, 'bundle.json'), JSON.stringify({
  centre, lat, k, extent, lots, props, roadNames, heritage, stateLand, crownLand, parks, facilities, devMon, controls, imagery, aerial,
  meta: { address, matched: geo.matchedAddresses, caption, lotDescription }, fetchedAt: new Date().toISOString(),
}));
}

// read: the same rules as the deck's spread 07b (src/lib/capacity.ts), written in the shape the drawing reads
await writeAnalysis(out, log);
// draw, print
const run = promisify(execFile);
for (const step of [['render.py', out, ...(notes ? [notes] : [])]]) {
  const { stdout, stderr } = await run('python3', ['-I', join(HERE, 'capacity_study', step[0]), ...step.slice(1)], { maxBuffer: 64 * 1024 * 1024 });
  if (stderr.trim()) log(stderr.trim());
  log(`  ${step[0]}: ${stdout.trim()}`);
}
const { width, height } = JSON.parse(await readFile(join(out, 'page.json'), 'utf8')) as { width: number; height: number };
await printPage(join(out, 'diagram.html'), { width, height }, { png: join(out, 'diagram.png'), pdf: join(out, 'diagram.pdf') });
console.log(`${join(out, 'diagram.png')}\n${join(out, 'diagram.pdf')}`);


/**
 * The reading of bundle.json and da.json with src/lib/capacity.ts, written as analysis.json for render.py: every
 * property with its geometry in Web Mercator, its kind, its marks and what dates it; the lots, the heritage items,
 * the parks, the council's register and the roads, in the same metres. The drawing's own rules (the site alone, the
 * symbol on each parcel) read these fields.
 */
async function writeAnalysis(dir: string, say: (m: string) => void): Promise<void> {
  const bundle = JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8'));
  const da = JSON.parse(await readFile(join(dir, 'da.json'), 'utf8')) as { near: any[] };
  const overrides = await readFile(join(dir, 'overrides.json'), 'utf8').then((t) => JSON.parse(t) as CapacityOverrides).catch(() => ({} as CapacityOverrides));
  const toM = (rings: number[][][]) => rings.map((r) => r.map(([lon, lat]) => { const m = lonLatToMercator({ lon, lat }); return [m.x, m.y]; }));
  const ringsOf = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
  const parks = (bundle.parks?.features ?? []).map((f: any) => ({ kind: 'council' as const, name: f.properties?.Name, rings: ringsOf(f.geometry) })).filter((l: any) => l.rings.length);
  const stateLand = (bundle.stateLand?.features ?? []).map((f: any) => ({ kind: 'state' as const, name: f.properties?.LOTREF, rings: ringsOf(f.geometry) })).filter((l: any) => l.rings.length);
  const facilities = (bundle.facilities?.features ?? []).filter((f: any) => f.geometry?.type === 'Point').map((f: any) => ({ name: String(f.properties?.Name ?? ''), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  const register = registerRecords(bundle.devMon ?? { type: 'FeatureCollection', features: [] });
  const result = classifyCapacity({ centre: bundle.centre, properties: bundle.props, lots: bundle.lots, heritage: bundle.heritage, publicLand: [...stateLand, ...parks], facilities, register, applications: da.near, overrides, options: { thisYear: Number(String(bundle.fetchedAt ?? '').slice(0, 4)) || new Date().getFullYear() } });
  const site = result.site;
  const props: Record<string, any> = {};
  for (const q of result.properties) {
    props[String(q.propid)] = {
      propid: q.propid, base: q.base, geom: q.ringsM, centroid: [q.centroidM.x, q.centroidM.y], areaM2: q.areaM2, kind: q.kind, strata: q.strata, units: q.units,
      strataPlans: q.strataPlans, heritageItem: q.heritageItem ?? null, inHCA: q.inHca ?? null, developed: q.developed, active: q.active.map((d) => ({ da: d.da, status: d.status, type: d.type, levels: d.levels, dwellings: d.dwellings })),
      liveDa: q.liveDa.map((d) => ({ pan: d.pan, status: d.status })), override: q.override ?? null, isSite: q.isSite, mark: q.mark === 'cross' ? 'x' : 'tick', note: q.note,
      lots: q.lots, ...(q.isSite ? { neighbours: result.neighbours } : {}),
    };
  }
  const roads = (bundle.roadNames?.features ?? []).map((f: any) => ({ name: f.properties?.roadnamelabel, paths: (f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry ? [f.geometry.coordinates] : []).map((path: number[][]) => path.map(([lon, lat]) => { const m = lonLatToMercator({ lon, lat }); return [m.x, m.y]; })) }));
  const analysis = {
    k: bundle.k, extent: bundle.extent, centre: bundle.centre, aerial: bundle.aerial, imagery: bundle.imagery, controls: bundle.controls, meta: bundle.meta, fetchedAt: bundle.fetchedAt,
    strataMax: result.options.strataMax, recentYears: result.options.recentYears, since: result.since, smallScheme: result.options.smallScheme, smallSite: result.options.smallSite,
    props, lots: result.lots.map((l) => ({ id: l.id, plan: l.plan, rings: toM(l.rings), areaM2: l.areaM2, registered: l.registered, propid: l.propid })),
    heritageItems: (bundle.heritage?.features ?? []).filter((f: any) => String(f.properties?.LAY_CLASS ?? '').startsWith('Item')).map((f: any) => ({ name: f.properties?.H_NAME, rings: toM(ringsOf(f.geometry)) })),
    parks: parks.map((l: any) => ({ name: l.name, rings: toM(l.rings) })),
    devmon: register.map((d) => ({ address: d.address, da: d.da, type: d.type, status: d.status, completion: d.completion, extracted: d.extracted })),
    roads,
  };
  await writeFile(join(dir, 'analysis.json'), JSON.stringify(analysis));
  const visible = inWindow(result, bundle.extent);
  const counts = capacityCounts(visible, result.options);
  say(`  read: ${result.properties.length} parcels (${result.duplicates} duplicate rows), ${counts.potential} with potential, ${counts.low} low, ${counts.mature} mature; site ${site?.base ?? 'not found'} ${site?.areaM2 ?? ''} m²; neighbours ${result.neighbours.map((n) => `${n.base} (${n.sharedM} m)`).join('; ') || 'none'}`);
}

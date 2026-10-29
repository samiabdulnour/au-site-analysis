// The capacity and opportunity site study: the context plan an urban designer
// draws to show which lots around a site are likely, or unlikely, to
// redevelop in the short to medium term. An A3 landscape sheet at 1:2000:
// the blocks around the site over the faded aerial and the cadastre, every
// property outlined by ownership (a single title in white, a strata scheme
// filled, a heritage building in orange), a tick on the lots with
// development potential, a cross on those with none (heritage items, public
// land) and a dot on mature development (a strata scheme of more than 30
// lots, a site significantly developed in the past 20 years, or one with a
// current approval or construction), the site in red; a legend on the left.
//
//   npm run capacity -- "70-76 Riley Street, Darlinghurst NSW 2010"
//   npm run capacity -- "<address>" --notes my-notes.html --out out/capacity/riley
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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// read, draw, print
const run = promisify(execFile);
for (const step of [['analyse.py', out], ['render.py', out, ...(notes ? [notes] : [])]]) {
  const { stdout, stderr } = await run('python3', ['-I', join(HERE, 'capacity_study', step[0]), ...step.slice(1)], { maxBuffer: 64 * 1024 * 1024 });
  if (stderr.trim()) log(stderr.trim());
  log(`  ${step[0]}: ${stdout.trim()}`);
}
const { width, height } = JSON.parse(await readFile(join(out, 'page.json'), 'utf8')) as { width: number; height: number };
await printPage(join(out, 'diagram.html'), { width, height }, { png: join(out, 'diagram.png'), pdf: join(out, 'diagram.pdf') });
console.log(`${join(out, 'diagram.png')}\n${join(out, 'diagram.pdf')}`);

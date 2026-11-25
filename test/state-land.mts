/* State government land: the NSW Government Property Index as the app ships it
 * (src/lib/stateLand.ts). Made-up lots are packed and read back through a
 * window, then the shipped file is read: what it says of itself, known public
 * and private sites, and every lot of the State once. Nothing here asks a
 * network: the index's map service is withdrawn, which is why it ships.
 *
 *   npx tsx test/state-land.mts
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStateLand, packStateLand, stateLandAbout, stateLandFeatures, stateLandIn, STATE_LAND_AS_AT, STATE_LAND_FILE, type StateParcel } from '../src/lib/stateLand.js';
import { lonLatToMercator } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failures.push(`${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };
const refs = (ps: StateParcel[]) => ps.map((p) => p.lotRef).sort().join(' ');
const rect = (x: number, y: number, w: number, h: number): number[][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];

// ---- made-up lots, packed and read back ----
{
  const made: StateParcel[] = [
    { lotRef: '1/-/DP1', source: 'GPR_OPENDATA_LOT', rings: [rect(151.0011111, -33.8022222, 0.0004, 0.0003)] },                 // a house lot
    { lotRef: '2/-/DP1', source: 'GPR_OPENDATA_LOT', rings: [rect(151.0498, -33.8005, 0.0006, 0.0004)] },                       // across a grid cell's edge (151.05)
    { lotRef: '3/7/DP2', source: 'CROWNLANDPOLY_LOT', rings: [rect(149.0, -35.2, 0.9, 0.7)] },                                  // the size of a district: several levels up
    { lotRef: '4/-/DP3', source: 'CROWNLANDPOLY_LOT', rings: [rect(151.2, -33.9, 0.01, 0.01), rect(151.203, -33.897, 0.004, 0.004).reverse()] }, // a lot with a hole
    { lotRef: '5/-/DP3', source: 'GPR_OPENDATA_LOT', rings: [[[151.3, -33.7], [151.31, -33.7], [151.3, -33.69], [151.3, -33.7]]] }, // a triangle
    { lotRef: '6/-/DP4', source: 'GPR_OPENDATA_LOT', rings: [rect(151.4, -33.6, 0.00000004, 0.00000004)] },                     // a sliver that closes on itself at 0.1 m
  ];
  const { file, about, dropped } = packStateLand(made, { title: 'made up', snapshot: '2022-10-12', publisher: 'no one', licence: 'none', from: 'this test', retrieved: '2026-11-22' });
  check('a sliver under the grid is left out and counted', dropped === 1 && about.parcels === 5, { dropped, parcels: about.parcels });
  check('the lots are counted by where the index had them from', about.bySource.GPR_OPENDATA_LOT === 3 && about.bySource.CROWNLANDPOLY_LOT === 2, about.bySource);
  const dir = mkdtempSync(join(tmpdir(), 'state-land-'));
  const path = join(dir, 'made.pack');
  writeFileSync(path, file);
  const ix = openStateLand(path);
  check('the file says what it was packed as', ix.about.snapshot === '2022-10-12' && ix.about.title === 'made up' && ix.about.parcels === 5, ix.about);
  const one = ix.parcelsIn([151.0012, -33.8021, 151.0013, -33.802]);
  check('a window inside a lot finds it, though none of its corners is in the window', refs(one) === '1/-/DP1' && one[0].source === 'GPR_OPENDATA_LOT', refs(one));
  const back = one[0]?.rings[0] ?? [];
  check('a lot comes back to a millionth of a degree, closed', back.length === 5 && back.every(([x, y], i) => Math.abs(x - made[0].rings[0][i][0]) <= 5.1e-7 && Math.abs(y - made[0].rings[0][i][1]) <= 5.1e-7) && back[0][0] === back[4][0] && back[0][1] === back[4][1], back);
  check('a lot across a cell\'s edge is found from either side', refs(ix.parcelsIn([151.0497, -33.8004, 151.04985, -33.8003])) === '2/-/DP1' && refs(ix.parcelsIn([151.0503, -33.8004, 151.0509, -33.8003])) === '2/-/DP1');
  check('a district-sized lot is found from a street-sized window deep inside it, with its section', refs(ix.parcelsIn([149.5, -34.9, 149.501, -34.899])) === '3/7/DP2' && refs(ix.parcelsIn([149.89, -34.51, 149.91, -34.49])) === '3/7/DP2' && ix.parcelsIn([149.91, -34.49, 149.92, -34.48]).length === 0, refs(ix.parcelsIn([149.5, -34.9, 149.501, -34.899])));
  check('a window in a lot\'s hole does not find the lot', !ix.parcelsIn([151.2045, -33.8955, 151.2055, -33.8945]).some((p) => p.lotRef === '4/-/DP3'), refs(ix.parcelsIn([151.2045, -33.8955, 151.2055, -33.8945])));
  check('a window on the hole\'s edge does', ix.parcelsIn([151.2025, -33.8955, 151.2035, -33.8945]).some((p) => p.lotRef === '4/-/DP3'));
  check('a window in a triangle\'s empty corner does not find it, though their boxes overlap', !ix.parcelsIn([151.308, -33.692, 151.309, -33.691]).some((p) => p.lotRef === '5/-/DP3'));
  check('a window that only an edge crosses finds the triangle', ix.parcelsIn([151.3045, -33.6955, 151.3055, -33.6945]).some((p) => p.lotRef === '5/-/DP3'));
  check('a window beside everything finds nothing', ix.parcelsIn([152.5, -33.0, 152.6, -32.9]).length === 0);
  check('the whole map finds each lot once', refs(ix.parcelsIn([140, -38, 160, -28])) === '1/-/DP1 2/-/DP1 3/7/DP2 4/-/DP3 5/-/DP3', refs(ix.parcelsIn([140, -38, 160, -28])));
  ix.close();
  writeFileSync(path, Buffer.from('not the index at all'));
  let said = '';
  try { openStateLand(path); } catch (e: any) { said = String(e?.message ?? e); }
  check('another file is refused by name', /not a Government Property Index file/.test(said), said);
  said = '';
  try { openStateLand(join(dir, 'missing.pack')); } catch (e: any) { said = String(e?.message ?? e); }
  check('a missing file says so, for the pipeline\'s warning', /cannot be opened/.test(said), said);
  rmSync(dir, { recursive: true, force: true });
}

// ---- the file the app ships ----
const about = stateLandAbout();
check('the shipped index is the release of 12 October 2022, and the sheets print that date', about.snapshot === '2022-10-12' && STATE_LAND_AS_AT === '12 October 2022' && /Government Property Index/.test(about.title), about);
check('it holds the release\'s lots but the one sliver: 43,717 from the property register, 87,513 on Crown land', about.parcels === 131_230 && about.bySource.GPR_OPENDATA_LOT === 43_717 && about.bySource.CROWNLANDPOLY_LOT === 87_513, about);
check('it says where it was read from and when', /arcgis/.test(about.from) && /^\d{4}-\d\d-\d\d$/.test(about.retrieved), about);
check('it is the size the README says: 16 MB', Math.abs(readFileSync(STATE_LAND_FILE).length / 1e6 - 16.3) < 0.5, readFileSync(STATE_LAND_FILE).length);

const ix = openStateLand();
const at = (lat: number, lon: number) => ix.parcelsIn([lon, lat, lon, lat]);
const hospital = at(-33.8035, 150.9876), parliament = at(-33.8672, 151.2127), square = at(-33.8097, 151.0048), stadium = at(-33.8474, 151.0655);
check('Westmead Hospital is the property register\'s', refs(hospital) === '1/-/DP1194390' && hospital[0].source === 'GPR_OPENDATA_LOT', refs(hospital));
check('Parliament House is the property register\'s', refs(parliament) === '1823/-/DP841390' && parliament[0].source === 'GPR_OPENDATA_LOT', refs(parliament));
check('Sydney Olympic Park\'s stadium lot is the property register\'s', refs(stadium) === '4001/-/DP1004512', refs(stadium));
check('Prince Alfred Square, Parramatta, is Crown land', refs(square) === '1/-/DP724837' && square[0].source === 'CROWNLANDPOLY_LOT', refs(square));
check('an office tower at 150 George Street, Parramatta, is not in the index', at(-33.8137, 151.0086).length === 0, refs(at(-33.8137, 151.0086)));
check('flats at 2-4 Culworth Avenue, Killara, are not in the index', at(-33.7655, 151.1622).length === 0, refs(at(-33.7655, 151.1622)));

// A window the index's map layer was asked on the day the file was packed: the same lots, split the same way.
const parramatta = ix.parcelsIn([150.975, -33.835, 151.035, -33.795]);
check('three kilometres of Parramatta hold the 453 lots the layer answered with: 371 and 82', parramatta.length === 453 && parramatta.filter((p) => p.source === 'GPR_OPENDATA_LOT').length === 371, `${parramatta.length} ${parramatta.filter((p) => p.source === 'GPR_OPENDATA_LOT').length}`);
const t0 = performance.now();
const killara = ix.parcelsIn([151.14, -33.78, 151.18, -33.75]);
check('two kilometres of Killara hold the 79 the layer answered with, read in well under a second', killara.length === 79 && performance.now() - t0 < 500, `${killara.length} in ${(performance.now() - t0).toFixed(0)} ms`);

// The window as the pipelines pass it, in Web Mercator, and the answer in the withdrawn layer's shape.
const sw = lonLatToMercator({ lon: 150.975, lat: -33.835 }), ne = lonLatToMercator({ lon: 151.035, lat: -33.795 });
const extent = { xmin: sw.x, ymin: sw.y, xmax: ne.x, ymax: ne.y };
check('a Web Mercator window reads the same lots', stateLandIn(extent).length === 453, stateLandIn(extent).length);
const fc = stateLandFeatures(extent);
const hosp = fc.features.find((f) => f.properties.LOTREF === '1/-/DP1194390');
check('the answer is shaped as the layer\'s was: LOTREF, SOURCE and PLANLABEL on a polygon of lon/lat rings', fc.features.length === 453 && !!hosp && hosp.properties.SOURCE === 'GPR_OPENDATA_LOT' && hosp.properties.PLANLABEL === 'DP1194390' && hosp.geometry?.type === 'Polygon' && Math.abs(hosp.geometry.coordinates[0][0][0] - 150.98) < 0.02 && Math.abs(hosp.geometry.coordinates[0][0][1] + 33.8) < 0.02, hosp?.properties);

// Every lot of the State, once: nothing lost between the grid's levels, nothing read twice.
const all = ix.parcelsIn([140, -38, 160, -28]);
check('the whole State reads every lot once', all.length === about.parcels && all.filter((p) => p.source === 'CROWNLANDPOLY_LOT').length === about.bySource.CROWNLANDPOLY_LOT, all.length);
check('every lot has a reference of lot/section/plan and a closed ring of four points or more', all.every((p) => /^[^/]*\/[^/]*\/\S/.test(p.lotRef) && p.rings.length > 0 && p.rings.every((r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1])), all.find((p) => !/^[^/]*\/[^/]*\/\S/.test(p.lotRef) || !p.rings.every((r) => r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]))?.lotRef);
check('every lot lies in New South Wales', all.every((p) => p.rings.every((r) => r.every(([x, y]) => x > 140.9 && x < 159.2 && y > -37.6 && y < -28.1))));
ix.close();

// The withdrawn layer is asked nowhere.
for (const f of ['src/fetch/site.ts', 'src/fetch/capacity.ts', 'scripts/capacity_study.ts']) check(`${f} no longer asks the withdrawn map layer`, !/Planning_Portal_GPI/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));

if (failures.length) { console.error(`state-land: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`state-land: ${about.parcels} lots as at ${STATE_LAND_AS_AT}, ${parramatta.length} of them in three kilometres of Parramatta; all checks pass`);

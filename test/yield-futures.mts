/* The yield study's future context and the capacity study: on each lot round
 * the site that may redevelop, the largest feasible footprint its envelope
 * holds (lib/futureContext.ts), lots joined where one is too narrow; a lot the
 * capacity study reads as of low potential (a strata scheme, a heritage item,
 * a mature or a small site) stands as it is, and is counted as held. On a
 * made-up site and made-up lots; nothing is fetched.
 *
 *   npx tsx test/yield-futures.mts
 */

import { yieldStudy, renderYieldDeck, type YieldBundle } from '../src/render/yieldSheet.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

const ORIGIN = lonLatToMercator({ lon: 151.215, lat: -33.875 });
const K = mercatorScaleFactor(-33.875);
const ll = (xM: number, yM: number): [number, number] => { const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K }); return [p.lon, p.lat]; };
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)];

// A 40 x 50 m site in R4 under an 18.6 m height, a street along the south (y = −10). To the east a wide lot of 50 m;
// to the west three house lots of 15 m; further east a lot the capacity study holds (a strata scheme); north, an R2 lot.
const site = rect(0, 0, 40, 50);
const house = (x: number, mark?: 'tick' | 'cross') => ({
  rings: [rect(x + 3, 8, 9, 15)], heightM: 6.2, known: true, controls: { zone: 'R4', hobM: 18.6, fsr: 1.3 },
  ...(mark ? { capacity: { address: `${x} TEST ST`, mark, mature: false, ...(mark === 'cross' ? { reason: 'strata scheme of 12 lots' } : {}) } } : {}),
});
const parcel = (x: number, w: number, zone: string, numbers: string[]) => ({ rings: [rect(x, 0, w, 50)], numbers, zone, hob: { value: 18.6, units: 'm' }, fsr: 1.3 });
const bundle = {
  address: 'test', siteAddress: 'TEST', generatedAt: '2026-11-11T00:00:00Z', lotDescription: 'Lot 1 DP 1', siteAreaSqm: 2000, areaIsCadastral: true,
  controls: { zoneCode: 'R4', zonePurpose: 'High Density Residential', maxHeightM: 18.6, heightUnits: 'm', fsr: 1.3, heritage: [] },
  siteRing: site, frontages: ['TEST ST', null, null, null], policyAtSite: [], kerbs: [], buildingsSource: 'osm', existing: [],
  roads: [{ name: 'TEST ST', hierarchy: 6, coords: [ll(-200, -10), ll(300, -10)] }],
  parcels: [
    parcel(40, 50, 'R4', ['2']),                                              // wide: a building of its own
    parcel(-15, 15, 'R4', ['1']), parcel(-30, 15, 'R4', ['3']), parcel(-45, 15, 'R4', ['5']),   // house lots: joined
    parcel(90, 40, 'R4', ['4']),                                              // held by the capacity study
    { rings: [rect(0, 60, 40, 40)], numbers: ['7'], zone: 'R2', hob: { value: 9.5, units: 'm' }, fsr: 0.5 },   // R2: a house
  ],
  context: [house(40, 'tick'), house(-15), house(90, 'cross'), { rings: [rect(10, 70, 12, 12)], heightM: 6.2, known: true, controls: { zone: 'R2' } }],
  capacity: { since: 2006, smallSite: 250, strataMax: 30, overridden: 0 },
} as unknown as YieldBundle;

const s = yieldStudy(bundle);
const f = s.future;
const lotsOf = (n: string) => f.buildings.filter((fb) => /No\. /.test(fb.name) && fb.name.includes(n));
check('the wide lot takes a building of its own', lotsOf('No. 2,').length === 1 && f.buildings.find((fb) => fb.name.startsWith('No. 2,'))!.lots.length === 1,
  JSON.stringify(f.buildings.map((fb) => ({ name: fb.name, lots: fb.lots, type: fb.type, l: fb.lengthM, st: fb.storeys }))));
check('the house lots are joined, the one nearest the site first', f.buildings.some((fb) => fb.lots.length >= 2 && fb.lots[0] === 1),
  JSON.stringify(f.buildings.map((fb) => fb.lots)));
check('a feasible footprint: 12, 18 or 22 m deep, at most 45 m long, six storeys under 18.6 m', f.buildings.every((fb) => [12, 18, 22].includes(fb.depthM) && fb.lengthM <= 45 && fb.storeys <= 6 && fb.storeys >= 3));
check('the held lot stands as it is, and is counted', f.held === 1 && !f.buildings.some((fb) => fb.lots.includes(4)));
check('the R2 lot stays a house', !f.buildings.some((fb) => fb.lots.includes(5)));
check('the buildings on a lot that redevelops give way to it, built out', f.replaced[0] === true && f.replaced[1] === true && f.replaced[2] === false && f.replaced[3] === false, JSON.stringify(f.replaced));

// The deck: the futures drawn as glass on their own footprints, the key and the assumptions say how they are made
const meta = { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false };
const deck = renderYieldDeck(bundle, meta);
const within = deck.slides.find((sl) => sl.id.endsWith('_within_controls'))!;
check('the key names the footprint futures', (within.legend ?? []).some((e) => /a feasible footprint on each lot/.test(e.label)));
const assumptions = deck.slides.find((sl) => sl.id.endsWith('_controls_and_assumptions'))!;
check('the assumptions say how the futures are made, and count them', /largest feasible footprint/.test(assumptions.figureHtml) && /1 held as the capacity study reads them/.test(assumptions.figureHtml));
check('the compliance sheet tests the separations built out', /built out/.test(deck.slides.find((sl) => sl.id.endsWith('_compliance'))?.figureHtml ?? ''));

// Without the capacity study nothing is held
const free = yieldStudy({ ...bundle, capacity: undefined, context: bundle.context.map(({ capacity: _c, ...c }) => c) } as unknown as YieldBundle);
check('without the study nothing is held, and the strata lot redevelops too', free.future.held === 0 && free.future.buildings.some((fb) => fb.lots.includes(4)));

if (failures.length) { console.error(`yield futures: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`yield futures: ${f.buildings.length} buildings on ${f.lots} lots, ${f.held} held; all checks pass`);

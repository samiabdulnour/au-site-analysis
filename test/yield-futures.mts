/* The yield study's neighbours and the capacity study: a neighbour whose
 * controls would let it rise is raised to its future only where the capacity
 * study reads development potential; one it reads as low (a strata scheme,
 * a heritage item, a mature or a small site) stands as it is, and is counted
 * as held. On a made-up site and two made-up neighbours; nothing is fetched.
 *
 *   npx tsx test/yield-futures.mts
 */

import { yieldStudy, type YieldBundle } from '../src/render/yieldSheet.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

const ORIGIN = lonLatToMercator({ lon: 151.215, lat: -33.875 });
const K = mercatorScaleFactor(-33.875);
const ll = (xM: number, yM: number): [number, number] => { const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K }); return [p.lon, p.lat]; };
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)];

// A 40 x 25 m site in R4 under an 18 m height and a 2:1 ratio, a street along its south edge; each neighbour a two-storey
// building of 300 m² on a 900 m² lot, whose controls let it rise to five storeys.
const site = rect(0, 0, 40, 25);
const neighbour = (x: number, capacity?: { address: string; mark: 'tick' | 'cross'; mature: boolean; reason?: string }) => ({
  rings: [rect(x, 0, 15, 20)], heightM: 6.2, known: true,
  controls: { zone: 'R4', hobM: 18, fsr: 2, landSqm: 900 },
  ...(capacity ? { capacity } : {}),
});
const bundle = {
  address: 'test', siteAddress: 'TEST', generatedAt: '2026-10-31T00:00:00Z', lotDescription: 'Lot 1 DP 1', siteAreaSqm: 1000, areaIsCadastral: true,
  controls: { zoneCode: 'R4', zonePurpose: 'High Density Residential', maxHeightM: 18, heightUnits: 'm', fsr: 2, heritage: [] },
  siteRing: site, frontages: [true, false, false, false], policyAtSite: [], roads: [], parcels: [], kerbs: [], buildingsSource: 'osm', existing: [],
  context: [
    neighbour(45),                                                                                            // no study: rises as before
    neighbour(-20, { address: '1 TEST STREET', mark: 'tick', mature: false }),                                 // potential: rises
    neighbour(65, { address: '3 TEST STREET', mark: 'cross', mature: false, reason: 'strata scheme of 22 lots' }), // low: stands
    neighbour(85, { address: '5 TEST STREET', mark: 'cross', mature: true, reason: 'mature development' }),       // mature: stands
  ],
  capacity: { since: 2006, smallSite: 250, strataMax: 30, overridden: 0 },
} as unknown as YieldBundle;

const s = yieldStudy(bundle);
check('a neighbour the study has not read rises to its controls', (s.futures[0] ?? 0) > 6.2, String(s.futures[0]));
check('a neighbour with development potential rises', (s.futures[1] ?? 0) > 6.2, String(s.futures[1]));
check('a strata scheme stands as it is', s.futures[2] === undefined, String(s.futures[2]));
check('a mature development stands as it is', s.futures[3] === undefined, String(s.futures[3]));
check('the two held are counted', s.futuresHeld === 2, String(s.futuresHeld));

// Without the study every neighbour whose controls allow it rises, and nothing is held.
const before = yieldStudy({ ...bundle, capacity: undefined, context: bundle.context.map(({ capacity: _c, ...c }) => c) } as unknown as YieldBundle);
check('without the study all four rise', before.futures.every((f) => (f ?? 0) > 6.2) && before.futuresHeld === 0, JSON.stringify(before.futures));

if (failures.length) { console.error(`yield futures: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`yield futures: ${s.futures.filter(Boolean).length} of ${s.futures.length} neighbours rise, ${s.futuresHeld} held; all checks pass`);

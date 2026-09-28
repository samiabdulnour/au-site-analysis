/* The storeys-from-the-DA fallback for building footprints, on made-up lots.
 *
 * Pure geometry and record selection: which application on a footprint's
 * cadastral lot may lend it a storey count, which footprints take one, and
 * what stays as it was. Nothing here asks a network, so it can say exactly
 * what a change broke.
 *
 *   npx tsx test/heights.mts
 */

import { withDaStoreys, ringAreaSqm, daGivesStoreys, METRES_PER_STOREY, type Building, type BuildingsData } from '../src/fetch/buildings.js';
import type { DaRecord } from '../src/fetch/da.js';
import type { GeoJSONFC } from '../src/lib/arcgis.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor, ringCentroid } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// A local metre grid around a Sydney latitude, through the library's own
// projection so the assertions see what the code sees.
const ORIGIN = lonLatToMercator({ lon: 151.2, lat: -33.9 });
const K = mercatorScaleFactor(-33.9);
const ll = (xM: number, yM: number): [number, number] => {
  const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K });
  return [p.lon, p.lat];
};
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];

// Three lots in a row, 20 × 30 m each.
const lots: GeoJSONFC = {
  type: 'FeatureCollection',
  features: [rect(0, 0, 20, 30), rect(20, 0, 40, 30), rect(40, 0, 60, 30)].map((ring) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })),
};

const building = (id: string, ring: number[][], extra: Partial<Building> = {}): Building => ({ id, source: 'overture', rings: [ring], heightFrom: 'none', centroid: ringCentroid(ring), ...extra });
const buildings: Building[] = [
  building('a-unknown', rect(2, 2, 12, 12)),                                   // lot A, 100 m², no height
  building('a-floors', rect(2, 15, 12, 25), { floors: 2, estimatedHeightM: 2 * METRES_PER_STOREY, heightFrom: 'floors' }),
  building('b-shed', rect(22, 2, 26, 7)),                                      // lot B, 20 m²
  building('b-unknown', rect(22, 10, 37, 20)),                                 // lot B, 150 m²
  building('c-unknown', rect(42, 2, 52, 12)),                                  // lot C, whose only application is under assessment
  building('off-lot', rect(70, 2, 80, 12)),                                    // on no lot
];
const data: BuildingsData = { source: 'overture', release: '2026-08-20.0', buildings, fetchedAt: '2026-09-28T00:00:00Z' };

const da = (pan: string, status: string, statusClass: DaRecord['statusClass'], storeys: number | undefined, at: [number, number], determined?: string, lodged?: string): DaRecord =>
  ({ pan, type: 'Development Application', status, statusClass, storeys, developmentTypes: ['Dwelling house'], address: `${pan} TEST STREET`, lon: at[0], lat: at[1], determined, lodged });
const applications: DaRecord[] = [
  da('A-old', 'Determined', 'determined', 3, ll(10, 15), '2022-03-01'),
  da('A-new', 'Determined', 'determined', 4, ll(5, 5), '2024-06-01'),
  da('A-refused', 'Determined - Refused', 'determined', 12, ll(6, 6), '2025-01-01'),
  da('A-withdrawn', 'Withdrawn', 'withdrawn', 9, ll(7, 7), undefined, '2025-02-01'),
  da('A-nostoreys', 'Determined', 'determined', undefined, ll(8, 8), '2025-03-01'),
  da('B-tower', 'Operational consent issued', 'determined', 10, ll(30, 15), '2023-01-01'),
  da('C-proposal', 'Under Assessment', 'active', 6, ll(50, 5), undefined, '2026-01-01'),
];

// ---- ground area ----------------------------------------------------------------
check('ringAreaSqm of a 10 × 10 m square', Math.abs(ringAreaSqm(rect(0, 0, 10, 10)) - 100) < 1, `${ringAreaSqm(rect(0, 0, 10, 10)).toFixed(2)} m²`);
check('ringAreaSqm of a degenerate ring', ringAreaSqm([ll(0, 0), ll(1, 1)]) === 0);

// ---- which applications may lend storeys -----------------------------------------
check('a determined application with storeys gives', daGivesStoreys(applications[0]));
check('a refused one does not', !daGivesStoreys(applications[2]));
check('a withdrawn one does not', !daGivesStoreys(applications[3]));
check('one without storeys does not', !daGivesStoreys(applications[4]));
check('one under assessment does not', !daGivesStoreys(applications[6]));

// ---- the fallback -----------------------------------------------------------------
const out = withDaStoreys(data, lots, applications);
const by = (id: string) => out.buildings.find((b) => b.id === id)!;
check('pure: the input buildings are untouched', buildings.every((b) => b.heightFrom !== 'da' && b.da === undefined));
check('lot A: the latest determination lends its storeys', by('a-unknown').heightFrom === 'da' && by('a-unknown').floors === 4 && by('a-unknown').da?.pan === 'A-new', JSON.stringify(by('a-unknown').da));
check('lot A: the height is storeys × 3.1 m', Math.abs((by('a-unknown').estimatedHeightM ?? 0) - 4 * METRES_PER_STOREY) < 1e-9);
check('lot A: a footprint with its own storeys keeps them', by('a-floors').heightFrom === 'floors' && by('a-floors').floors === 2 && !by('a-floors').da);
check('lot B: a real footprint takes the ten storeys', by('b-unknown').heightFrom === 'da' && by('b-unknown').floors === 10 && by('b-unknown').da?.status === 'Operational consent issued');
check('lot B: a 20 m² shed does not take ten storeys', by('b-shed').heightFrom === 'none' && by('b-shed').floors === undefined && by('b-shed').estimatedHeightM === undefined);
check('lot C: a proposal under assessment lends nothing', by('c-unknown').heightFrom === 'none');
check('off every lot: nothing changes', by('off-lot').heightFrom === 'none');
check('the source and release are kept', out.source === 'overture' && out.release === '2026-08-20.0' && out.fetchedAt === data.fetchedAt);

// nothing to do: the same object comes back
check('no candidate application: the same data back', withDaStoreys(data, lots, [applications[6], applications[3]]) === data);
const allKnown: BuildingsData = { ...data, buildings: buildings.map((b) => ({ ...b, floors: 1, estimatedHeightM: METRES_PER_STOREY, heightFrom: 'floors' as const })) };
check('every footprint with a height: the same data back', withDaStoreys(allKnown, lots, applications) === allKnown);
check('no lots: the same data back', withDaStoreys(data, { type: 'FeatureCollection', features: [] }, applications) === data);
// a small footprint may still take a low storey count
const low = withDaStoreys(data, lots, [da('B-low', 'Determined', 'determined', 2, ll(30, 15), '2024-01-01')]);
check('lot B: a 20 m² shed takes two storeys', low.buildings.find((b) => b.id === 'b-shed')?.floors === 2 && low.buildings.find((b) => b.id === 'b-shed')?.heightFrom === 'da');
// a lodged date orders an application that has no determination date
const undated = withDaStoreys(data, lots, [da('A-late', 'Determined', 'determined', 7, ll(5, 5), undefined, '2025-09-01'), applications[1]]);
check('lot A: the lodged date stands in for a missing determination date', undated.buildings.find((b) => b.id === 'a-unknown')?.floors === 7);

if (failures.length) {
  console.error(`heights: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('heights: all checks passed');

/* The yield study on made-up lots.
 *
 * Geometry and arithmetic only: which storeys a height holds, how the ADG's
 * separations and the podium step the envelope, where the floor space ratio
 * stops the building, and the apartments and parking that floor area makes.
 * Nothing here asks a network.
 *
 *   npx tsx test/yield.mts
 */

import { computeYield, storeysUnder, archetypeFor, edgeKinds, ringArea, DEFAULT_ASSUMPTIONS, PARKING_RATES, type XY } from '../src/lib/yield.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const rect = (w: number, h: number): XY[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

// ---- storeys under a height ---------------------------------------------------
check('a 22 m residential height holds 6 storeys at 3.1 m with 1.5 m kept for the roof', storeysUnder(22, 3.1, 3.1, 1.5) === 6, String(storeysUnder(22, 3.1, 3.1, 1.5)));
check('a 4.5 m retail ground floor takes the first storey', storeysUnder(24, 4.5, 3.1, 1.5) === 6, String(storeysUnder(24, 4.5, 3.1, 1.5)));
check('a height under one storey holds none', storeysUnder(3, 3.1, 3.1, 1.5) === 0);

// ---- zones --------------------------------------------------------------------
check('R4 builds apartments', archetypeFor('R4') === 'residential');
check('MU1 builds shop-top housing', archetypeFor('MU1') === 'mixed');
check('E2 builds offices', archetypeFor('E2') === 'commercial');
check('R2 builds no apartments', archetypeFor('R2') === 'none');

// ---- edges: a lot fronting the south, its rear to the north --------------------
{
  const kinds = edgeKinds(rect(30, 40), [true, false, false, false]);
  check('the street edge is the front', kinds[0] === 'front', kinds.join(','));
  check('the opposite edge is the rear', kinds[2] === 'rear', kinds.join(','));
  check('the other two are sides', kinds[1] === 'side' && kinds[3] === 'side', kinds.join(','));
  // The same ring wound the other way round still reads the same.
  const cw = [...rect(30, 40)].reverse();          // edges now: left, top, right, bottom
  const k2 = edgeKinds(cw, [false, false, false, true]);
  check('winding does not change which edge is the rear', k2[1] === 'rear' && k2[3] === 'front', k2.join(','));
}

// ---- a 40 × 50 m R4 lot, 22 m and 1.5:1 ------------------------------------------
{
  const ring = rect(40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 22, fsr: 1.5 });
  check('R4: the height holds six storeys', y.storeysByHeight === 6, String(y.storeysByHeight));
  const t1 = y.tiers[0];
  // 6 m off every boundary for storeys 1–4: (40 − 12) × (50 − 12).
  check('R4: storeys 1–4 sit 6 m off every boundary', near(t1.envelopeSqm, 28 * 38, 12), t1.envelopeSqm.toFixed(1));
  const t2 = y.tiers[1];
  // Storeys 5–6: 6 m from the street, 9 m from the sides and the rear: (40 − 18) × (50 − 6 − 9).
  check('R4: storeys 5–6 step back to 9 m from the sides and rear', near(t2.envelopeSqm, 22 * 35, 12), t2.envelopeSqm.toFixed(1));
  check('R4: the floor space ratio caps the floor area', near(y.gfa, 1.5 * 2000, 1) && y.governs === 'fsr', `${y.gfa.toFixed(0)} ${y.governs}`);
  check('R4: fewer storeys are built than the height allows', y.storeys < y.storeysByHeight, `${y.storeys} of ${y.storeysByHeight}`);
  // 3000 m² × 0.85 / 75.5 m² = 33.8 → 33 apartments.
  check('R4: the apartments are the saleable area over the average size', y.units.total === 33, String(y.units.total));
  check('R4: the mix adds up', y.units.studio + y.units.one + y.units.two + y.units.three === y.units.total);
  const r = DEFAULT_ASSUMPTIONS.parking;
  const want = Math.ceil(y.units.studio * r.studio + y.units.one * r.one + y.units.two * r.two + y.units.three * r.three) + Math.ceil(y.units.total * r.visitor);
  check('R4: parking is the mix at its rates, plus visitors', y.parking.total === want, `${y.parking.total} vs ${want}`);
  check('R4: the ADG asks a 6 m deep soil dimension on a site over 1500 m²', y.adg.deepSoil.minDimension === 6);
}

// ---- a 30 × 40 m MU1 lot on a corner, 40 m, no FSR mapped ---------------------------
{
  const ring = rect(30, 40);
  const y = computeYield({ ring, fronts: [true, true, false, false], siteAreaSqm: 1200, zone: 'MU1', hobM: 40 });
  check('MU1: the height governs where no FSR is mapped', y.governs === 'height' && y.gfaByFsr === undefined);
  const ground = y.tiers[0];
  check('MU1: the shops fill the lot', near(ground.envelopeSqm, 1200, 10) && ground.use === 'retail', ground.envelopeSqm.toFixed(0));
  const podium = y.tiers[1];
  // Built to both streets and the side, 6 m off the rear (the west edge, opposite the longer east frontage).
  check('MU1: the podium keeps 6 m off the rear only', near(podium.envelopeSqm, 1200 - 6 * 40, 12), podium.envelopeSqm.toFixed(0));
  check('MU1: retail floor area is counted apart from the apartments', y.gfaByUse.retail > 0 && y.gfaByUse.residential > 0);
  check('MU1: the storeys follow the height', y.storeys === y.storeysByHeight, `${y.storeys} vs ${y.storeysByHeight}`);
}

// ---- an L-shaped lot: the envelope is eroded per edge, not clipped by half-planes ------
{
  // A 40 × 40 square with its north-east 20 × 20 corner missing; the street along the south.
  const ring: XY[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 40 }, { x: 0, y: 40 }];
  const y = computeYield({ ring, fronts: [true, false, false, false, false, false], siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 12, fsr: 3 });
  // 6 m off every edge: the L of arms 8 m wide (20 − 12) — two 28 × 8 arms sharing an 8 × 8 corner.
  const want = 28 * 8 * 2 - 8 * 8;
  check('L lot: both wings keep their envelope', near(y.tiers[0].envelopeSqm, want, 14), `${y.tiers[0].envelopeSqm.toFixed(0)} vs ${want}`);
}

// ---- a wide R4 lot: a perimeter of 18 m round a courtyard -------------------------------
{
  const ring = rect(90, 90);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: 8100, zone: 'R4', hobM: 12, fsr: 4 });
  const t = y.tiers[0];
  check('wide lot: the plate is held to the building depth', t.held === 'depth' && t.plateSqm < t.envelopeSqm * 0.8, `${t.held} ${t.plateSqm.toFixed(0)} of ${t.envelopeSqm.toFixed(0)}`);
  // 78 × 78 envelope, an 18 m perimeter: 78² − 42².
  check('wide lot: the perimeter is 18 m deep', near(t.plateSqm, 78 * 78 - 42 * 42, 60), t.plateSqm.toFixed(0));
}

// ---- a residential tower is held to its plate -------------------------------------------
{
  const ring = rect(60, 60);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: 3600, zone: 'MU1', hobM: 90 });
  const tower = y.tiers.find((t) => t.from >= 9)!;
  check('tower: the plate is held to its size', tower.held === 'tower' && near(tower.plateSqm, DEFAULT_ASSUMPTIONS.towerPlateMax, 40), `${tower.held} ${tower.plateSqm.toFixed(0)}`);
}

// ---- overrides ---------------------------------------------------------------------------
{
  const ring = rect(40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: 2000, zone: 'R4', hobM: 22, fsr: 1.5, assumptions: { parking: { ...PARKING_RATES.cbd } } });
  check('an override replaces a rate set', y.assumptions.parking.two === 0.7 && y.assumptions.mix.two === DEFAULT_ASSUMPTIONS.mix.two);
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('yield: all checks pass');

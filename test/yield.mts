/* The yield study on made-up lots.
 *
 * Geometry and arithmetic only: which storeys a height holds, how the ADG's
 * separations and the podium step the envelope, where the floor space ratio
 * stops the building, the apartments and parking that floor area makes, how
 * high a neighbour may rise, and where the plan writes each tier's number.
 * Nothing here asks a network.
 *
 *   npx tsx test/yield.mts
 */

import { computeYield, storeysUnder, archetypeFor, edgeKinds, ringArea, futureHeight, withFour, existingSummary, DEFAULT_ASSUMPTIONS, PARKING_RATES, UNIT_KINDS, ADG_MINIMUM, type XY } from '../src/lib/yield.js';
import { tierSpot, frontageMiddle, yieldStudy, scenarioRows, type YieldBundle } from '../src/render/yieldSheet.js';

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
  // The office's mix averages 72.5 m²: 3000 m² × 0.85 / 72.5 m² = 35.2 → 35 apartments.
  check('R4: the office mix averages 72.5 m²', near(y.averageUnitSqm, 72.5, 1e-9), String(y.averageUnitSqm));
  check('R4: the apartments are the saleable area over the average size', y.units.total === 35, String(y.units.total));
  check('R4: the mix adds up', UNIT_KINDS.reduce((t, k) => t + y.units[k], 0) === y.units.total);
  check('R4: no studios or four-bedroom flats in the office mix', y.units.studio === 0 && y.units.four === 0);
  check('R4: the mix shares the units by its shares (7, 25, 3)', y.units.one === 7 && y.units.two === 25 && y.units.three === 3, `${y.units.one} ${y.units.two} ${y.units.three}`);
  check('R4: every size in the office mix meets ADG 4D-1', UNIT_KINDS.every((k) => DEFAULT_ASSUMPTIONS.sizes[k] >= ADG_MINIMUM[k]));
  const r = DEFAULT_ASSUMPTIONS.parking;
  const want = Math.ceil(UNIT_KINDS.reduce((t, k) => t + y.units[k] * r[k], 0)) + Math.ceil(y.units.total * r.visitor);
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
  // The office template's efficiencies: 95% of the plate for the shops, 72.5% for the apartments.
  const shop = y.floors.find((f) => f.use === 'retail')!, flat = y.floors.find((f) => f.use === 'residential')!;
  check('MU1: the shops take 95% of their plate as GFA', near(shop.gfa / shop.gba, 0.95, 1e-9), String(shop.gfa / shop.gba));
  check('MU1: the apartments take 72.5% of theirs', near(flat.gfa / flat.gba, 0.725, 1e-9), String(flat.gfa / flat.gba));
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

// ---- four bedrooms ----------------------------------------------------------------------
{
  const ring = rect(40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: 2000, zone: 'R4', hobM: 22, fsr: 1.5,
    assumptions: { mix: { studio: 0, one: 0.2, two: 0.5, three: 0.2, four: 0.1 } } });
  check('four: a share of four-bedroom flats is counted', y.units.four > 0 && UNIT_KINDS.reduce((t, k) => t + y.units[k], 0) === y.units.total, JSON.stringify(y.units));
  check('four: four bedrooms park at the three-bedroom rate', y.assumptions.parking.four === y.assumptions.parking.three);
  // A rate set from yield_assumptions.json that names three bedrooms and not four gives four bedrooms the same.
  check('four: a three-bedroom rate given alone carries to four', withFour({ ...PARKING_RATES.subRegional }, { three: 2 }).four === 2);
  check('four: a four-bedroom rate given is kept', withFour({ ...PARKING_RATES.subRegional }, { three: 2, four: 2.5 }).four === 2.5);
}

// ---- overrides ---------------------------------------------------------------------------
{
  const ring = rect(40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: 2000, zone: 'R4', hobM: 22, fsr: 1.5, assumptions: { parking: { ...PARKING_RATES.cbd } } });
  check('an override replaces a rate set', y.assumptions.parking.two === 0.7 && y.assumptions.mix.two === DEFAULT_ASSUMPTIONS.mix.two);
}

// ---- the neighbours' future ----------------------------------------------------------------
{
  const R4 = (hobM?: number, fsr?: number, landSqm?: number) => ({ zone: 'R4', hobM, fsr, landSqm });
  // Height alone (no FSR mapped): the whole storeys under it.
  const f = futureHeight(R4(22), 300, 6.2);
  check('future: an R4 neighbour of two storeys rises to the whole storeys under 22 m', f !== undefined && near(f, 7 * 3.1, 1e-6), String(f));
  check('future: R2 stays a house', futureHeight({ zone: 'R2', hobM: 22 }, 300, 6.2) === undefined);
  check('future: a zone code is read whatever its case and spacing', futureHeight({ zone: ' mu1 ', hobM: 30 }, 300, 9) !== undefined);
  check('future: a building at its control is its own future', futureHeight(R4(22), 300, 21.7) === undefined);
  check('future: a building over its control is never lowered', futureHeight(R4(12), 300, 30) === undefined);
  check('future: no control, no future', futureHeight(R4(), 300, 6.2) === undefined);
  // Two storeys assumed: 8 m holds two at 3.1 m and is no rise; 9.5 m holds three.
  const unknown = futureHeight(R4(9.5), 300, undefined);
  check('future: a height not recorded stands at two storeys', futureHeight(R4(8), 300, undefined) === undefined && futureHeight(R4(8), 300, 0) === undefined
    && unknown !== undefined && near(unknown, 9.3, 1e-6), `${futureHeight(R4(8), 300, undefined)} ${unknown}`);
  // The FSR caps it: a 600 m² lot at 2:1 holds 1200 m² of GFA; on a 250 m² footprint at 72.5%
  // that is 1200 / (250 × 0.725) = 6.6 → 6 storeys, under the 28 m height's 9.
  const capped = futureHeight(R4(28, 2, 600), 250, 6.2);
  check('future: the floor space ratio caps the storeys', capped !== undefined && near(capped, 6 * 3.1, 1e-6), String(capped));
  // An airspace RL far above: the ratio governs (Parramatta CBD: 203 m, FSR 10:1, a 500 m² lot, a 400 m² footprint, offices at 85%).
  const cbd = futureHeight({ zone: 'E2', hobM: 203, fsr: 10, landSqm: 500 }, 400, 20);
  check('future: in a CBD the ratio, not the airspace, sets the height', cbd !== undefined && near(cbd, 14 * 3.1, 1e-6), String(cbd));
  // Land less than the footprint (a building over several lots, or a lot shared): at least its footprint.
  const wide = futureHeight(R4(60, 3, 100), 1000, 6.2);
  check('future: the land is at least the footprint', wide !== undefined && near(wide, 4 * 3.1, 1e-6), String(wide));
  check('future: the ratio alone, where no height is mapped', futureHeight(R4(undefined, 2, 600), 250, 6.2) !== undefined);
  check('future: a ratio that holds no more than stands is no rise', futureHeight(R4(28, 0.5, 600), 250, 6.2) === undefined);
  // A leaner efficiency holds fewer storeys from the same floor area.
  const lean = futureHeight(R4(28, 2, 600), 250, 6.2, { residentialEfficiency: 0.95, commercialEfficiency: 0.85 });
  check('future: the efficiency is the study\'s', lean !== undefined && near(lean, 5 * 3.1, 1e-6), String(lean));
}

// ---- the tier numbers in plan ------------------------------------------------------------------
{
  const sq = (x0: number, y0: number, x1: number, y1: number): XY[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const inside = (p: XY, r: XY[]) => p.x > Math.min(...r.map((q) => q.x)) && p.x < Math.max(...r.map((q) => q.x)) && p.y > Math.min(...r.map((q) => q.y)) && p.y < Math.max(...r.map((q) => q.y));
  const lower = sq(0, 0, 40, 30), upper = sq(4, 4, 36, 26);
  const one = tierSpot([lower], [upper], [], 1, 3)!;
  check('labels: the lower tier is numbered in its own band, clear of its edges', !!one && inside(one, lower) && !inside(one, upper)
    && Math.min(one.x, 40 - one.x, one.y, 30 - one.y) >= 1 && Math.min(Math.abs(one.x - 4), Math.abs(one.x - 36), Math.abs(one.y - 4), Math.abs(one.y - 26)) >= 1, JSON.stringify(one));
  const two = tierSpot([upper], [], [one], 1, 3)!;
  check('labels: the upper tier is numbered inside it, apart from the first', !!two && inside(two, upper) && Math.hypot(two.x - one.x, two.y - one.y) >= 3, JSON.stringify(two));
  // Identical envelopes leave no band: the second number still goes in, apart from the first.
  const same = tierSpot([lower], [lower], [], 1, 3)!, next = tierSpot([lower], [], [same], 1, 3)!;
  check('labels: a tier with no band of its own is still numbered, apart', !!same && !!next && inside(same, lower) && Math.hypot(next.x - same.x, next.y - same.y) >= 3);
  check('labels: a tier with no envelope is not numbered', tierSpot([], [], [], 1, 3) === undefined);
}

// ---- the middle of the street frontage -----------------------------------------------------
{
  // A frontage the cadastre draws as two edges is one run: its middle is the run's, not either edge's.
  const ring: XY[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }];
  const m = frontageMiddle(ring, ['MAIN STREET', 'MAIN STREET', null, null, null]);
  check('frontage: the middle of a run of two edges', !!m && near(m.x, 25, 1e-6) && near(m.y, 0, 1e-6), JSON.stringify(m));
  // A run across the ring's seam (the last edge and the first) is still one: 30 m down, then 20 m along, its middle 25 m in.
  const seam = frontageMiddle(ring, ['SIDE ROAD', null, null, null, 'SIDE ROAD']);
  check('frontage: a run across the seam is one run', !!seam && near(seam.x, 0, 1e-6) && near(seam.y, 5, 1e-6), JSON.stringify(seam));
  check('frontage: the longer street wins', (() => { const q = frontageMiddle(ring, ['A ST', null, 'B ST', null, null]); return !!q && near(q.x, 50, 1e-6) && near(q.y, 15, 1e-6); })());
  check('frontage: no street, no middle', frontageMiddle(ring, [null, null, null, null, null]) === undefined);
}

// ---- what stands today -------------------------------------------------------------------
{
  check('stands: nothing standing, nothing said', existingSummary([]) === undefined);
  const one = existingSummary([{ footprintSqm: 980, heightM: 37.2 }])!;
  check('stands: one building, storeys from its height', one.count === 1 && one.storeys === 12 && one.known && near(one.gbaSqm!, 980 * 12, 1), JSON.stringify(one));
  const two = existingSummary([{ footprintSqm: 400, storeys: 3 }, { footprintSqm: 200, heightM: 6.2 }])!;
  check('stands: the tallest speaks, the floor areas add', two.storeys === 3 && near(two.gbaSqm!, 400 * 3 + 200 * 2, 1) && two.footprintSqm === 600, JSON.stringify(two));
  const dumb = existingSummary([{ footprintSqm: 500 }])!;
  check('stands: no height anywhere, no floor area guessed', !dumb.known && dumb.storeys === undefined && dumb.gbaSqm === undefined && dumb.footprintSqm === 500);
}

// ---- the scenarios -------------------------------------------------------------------------
{
  // A 40 × 50 m R4 lot whose FSR (1.5) stops the building below its height (22 m): every path diverges.
  const ringLL: [number, number][] = [[151.2, -33.9], [151.20043, -33.9], [151.20043, -33.89955], [151.2, -33.89955], [151.2, -33.9]];
  const bundle: YieldBundle = {
    address: 'TEST', siteAddress: 'TEST', generatedAt: 't', lotDescription: '—', areaIsCadastral: true,
    siteAreaSqm: 2000, controls: { zoneCode: 'R4', maxHeightM: 22, fsr: 1.5, heritage: [] },
    siteRing: ringLL, frontages: ['TEST ST', null, null, null], roads: [], context: [], buildingsSource: 'none', policyAtSite: [],
    existing: [{ footprintSqm: 900, heightM: 37.2 }],
  };
  const s = yieldStudy(bundle);
  check('scenarios: the ratio stops the base below the height', s.base.governs === 'fsr' && s.base.storeys < s.base.storeysByHeight);
  const rows = scenarioRows(bundle, s);
  const ids = rows.map((r) => r.id).join(',');
  check('scenarios: all four paths, what stands first', ids === 'standsToday,withinControls,affordableBonus,envelopeToHeight', ids);
  const today = rows[0], base = rows[1], bonus = rows[2], max = rows[3];
  check('scenarios: what stands is indicative GBA with no mark', today.storeys === '~12' && /GBA/.test(today.gfa ?? '') && today.ok === undefined, JSON.stringify(today));
  check('scenarios: the drawn scheme complies', base.ok === true && /DRAWN/.test(base.label));
  check('scenarios: the bonus waits on eligibility', bonus.ok === null && /eligibility/.test(bonus.note));
  check('scenarios: the maxed envelope does not comply, and names the path', max.ok === false && /clause 4.6|planning proposal/.test(max.note));
  check('scenarios: the maxed envelope reaches the height and holds more', s.max!.storeys === s.base.storeysByHeight && s.max!.gfa > s.base.gfa + 1);
  // Where the envelope, not the ratio, governs, there is no envelope-to-the-height path.
  const openB: YieldBundle = { ...bundle, controls: { zoneCode: 'R4', maxHeightM: 22, heritage: [] }, existing: [] };
  const s2 = yieldStudy(openB);
  const ids2 = scenarioRows(openB, s2).map((r) => r.id).join(',');
  check('scenarios: no ratio, no maxed-envelope path and nothing standing', ids2 === 'withinControls,affordableBonus', ids2);
  // A 16 m sliver: the separations eat every storey over four, so the bonus gains nothing and is no path.
  const dLon = 16 / (111320 * Math.cos((-33.9 * Math.PI) / 180)), dLat = 40 / 110574;
  const sliver: YieldBundle = {
    ...bundle, existing: [],
    controls: { zoneCode: 'R4', maxHeightM: 40, heritage: [] },
    siteRing: [[151.21, -33.9], [151.21 + dLon, -33.9], [151.21 + dLon, -33.9 + dLat], [151.21, -33.9 + dLat], [151.21, -33.9]],
    siteAreaSqm: 16 * 40,
  };
  const s3 = yieldStudy(sliver);
  check('scenarios: a bonus the envelope eats is no path', s3.bonus !== undefined && scenarioRows(sliver, s3).map((r) => r.id).join(',') === 'withinControls',
    scenarioRows(sliver, s3).map((r) => r.id).join(','));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('yield: all checks pass');

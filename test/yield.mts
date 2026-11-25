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
import { sunBands, bandOf } from '../src/render/facadeElevation.js';
import { withTemplate, deckFamilies, vivid } from '../src/render/template.js';
import { zoneFill } from '../src/render/lepPalette.js';
import { tierSpot, frontageMiddle, yieldStudy, scenarioRows, yieldRows, noSchemeSentence, renderYieldDeck, yieldCsv, yieldJson, isTestPage, lotsShort, type YieldBundle, type Parcel } from '../src/render/yieldSheet.js';

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
  check('scenarios: all five paths, what stands first, the reshaped one after the controls', ids === 'standsToday,withinControls,reshaped,affordableBonus,envelopeToHeight', ids);
  const today = rows[0], base = rows[1], reshaped = rows[2], bonus = rows[3], max = rows[4];
  check('scenarios: the reshaped scheme complies, keeps to the controls, and says how it stands', reshaped.ok === true && /RESHAPED TO COMPLY/.test(reshaped.label) && /feasible footprints/.test(reshaped.note) && /row/.test(reshaped.note)
    && !!s.reshaped && s.reshaped.y.gfa <= (bundle.controls.fsr ?? Infinity) * (bundle.siteAreaSqm ?? 0) + 1 && s.reshaped.y.heightM <= (bundle.controls.maxHeightM ?? Infinity) + 1e-6, JSON.stringify(reshaped));
  check('scenarios: what stands is indicative GBA with no mark', today.storeys === '~12' && /GBA/.test(today.gfa ?? '') && today.ok === undefined, JSON.stringify(today));
  check('scenarios: the drawn scheme complies', base.ok === true && /DRAWN/.test(base.label));
  check('scenarios: the bonus waits on eligibility', bonus.ok === null && /eligibility/.test(bonus.note));
  check('scenarios: the maxed envelope does not comply, and names the path', max.ok === false && /clause 4.6|planning proposal/.test(max.note));
  check('scenarios: the maxed envelope reaches the height and holds more', s.max!.storeys === s.base.storeysByHeight && s.max!.gfa > s.base.gfa + 1);
  // Where the envelope, not the ratio, governs, there is no envelope-to-the-height path.
  const openB: YieldBundle = { ...bundle, controls: { zoneCode: 'R4', maxHeightM: 22, heritage: [] }, existing: [] };
  const s2 = yieldStudy(openB);
  const ids2 = scenarioRows(openB, s2).map((r) => r.id).join(',');
  check('scenarios: no ratio, no maxed-envelope path and nothing standing', ids2 === 'withinControls,reshaped,affordableBonus', ids2);
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

  // What stands over the controls is a path of its own: kept, or rebuilt on its footprint to its height.
  const inner = [[151.20005, -33.89995], [151.20038, -33.89995], [151.20038, -33.8996], [151.20005, -33.8996], [151.20005, -33.89995]];
  const tall: YieldBundle = { ...bundle, existing: [{ footprintSqm: 1060, heightM: 37.2, rings: [inner] }] };
  const st = yieldStudy(tall);
  const tallIds = scenarioRows(tall, st).map((r) => r.id).join(',');
  check('rebuilt: a building over the controls keeps its bulk as a path', tallIds === 'standsToday,rebuiltAsStands,withinControls,reshaped,affordableBonus,envelopeToHeight', tallIds);
  // (the storeys what stands is read at, 37.2 m at 3.1 m a storey: the same twelve the summary of what stands counts,
  // where the path took a roof off the height first and built eleven, less than stands)
  check('rebuilt: the storeys what stands is read at, more floor area than the controls give, no ratio over it',
    !!st.retained && st.retained.storeys === 12 && st.retained.storeys === existingSummary(tall.existing!)!.storeys && st.retained.gfa > st.base.gfa * 2 && st.retained.tiers.every((t) => t.existing), JSON.stringify(st.retained && { storeys: st.retained.storeys, gfa: st.retained.gfa, base: st.base.gfa }));
  check('rebuilt: it waits on a variation, not marked compliant', scenarioRows(tall, st)[1].ok === null);
  // Rebuilt to what stands holds what stands, the whole of it (Z. 2026-11, on 86, 88-90, 94 Maroubra Road: "it builds
  // a smaller thing than it is"): every building, the one with no recorded height too, each at the storeys the
  // summary of what stands reads it at, so the path's gross building area is the summary's.
  {
    const sq = (x: number, y: number, w: number, h: number) => { const mE = 111320 * Math.cos((-33.9 * Math.PI) / 180), mN = 110574; const X = (v: number) => 151.20005 + v / mE, Y = (v: number) => -33.89995 + v / mN; return [[X(x), Y(y)], [X(x + w), Y(y)], [X(x + w), Y(y + h)], [X(x), Y(y + h)], [X(x), Y(y)]]; };
    const four: YieldBundle = { ...bundle, controls: { ...bundle.controls, zoneCode: 'R2', maxHeightM: 9.5, fsr: 0.5 }, existing: [
      { footprintSqm: 175, heightM: 7.7, rings: [sq(0, 0, 12.5, 14)] }, { footprintSqm: 185, heightM: 10.4, rings: [sq(14, 0, 12.5, 14.8)] },
      { footprintSqm: 216, heightM: 10.4, rings: [sq(0, 16, 13.5, 16)] }, { footprintSqm: 190, rings: [sq(15, 17, 12.5, 15.2)] },
    ] };
    const sf = yieldStudy(four), ex = existingSummary(four.existing!)!;
    check('what stands: four buildings, the tallest three storeys', ex.count === 4 && ex.storeys === 3 && Math.abs(ex.gbaSqm! - (175 * 2 + 185 * 3 + 216 * 3 + 190)) < 1, JSON.stringify(ex));
    check('rebuilt: every building that stands is rebuilt, the one of no recorded height too', sf.standing?.tiers.length === 4, String(sf.standing?.tiers.length));
    check('rebuilt: at the storeys what stands is read at', sf.standing?.storeys === 3 && sf.standing.tiers.map((t) => t.to).sort().join(',') === '1,2,3,3', JSON.stringify(sf.standing?.tiers.map((t) => t.to)));
    check('rebuilt: its gross building area is what stands, not less', !!sf.standing && Math.abs(sf.standing.gba - ex.gbaSqm!) < ex.gbaSqm! * 0.02, `${sf.standing?.gba} against ${ex.gbaSqm}`);
    check('rebuilt: over the controls, it is a path', sf.retained === sf.standing && scenarioRows(four, sf).some((r) => r.id === 'rebuiltAsStands'));
    // the compliance of what stands comes first, and the path that rebuilds it (the same massing) has no second sheet
    const deck = renderYieldDeck(four, { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false });
    const ids = deck.slides.map((sl) => sl.id);
    const comp = ids.filter((i) => isTestPage(i));
    check('compliance: the current structures\' pages are there, first', comp.length >= 2 && /stands_today_shadow_and_separation$/.test(comp[0]) && /stands_today_solar_access$/.test(comp[1]), comp.join(' '));
    // Z. 2026-11: "do the compliance sheets for every scenario produced", "even for this" (the path that rebuilds what stands)
    const rebuiltAt = ids.findIndex((i) => /_rebuilt_as_stands$/.test(i));
    check('compliance: every scenario with a spread has its pages, the path that rebuilds what stands too', rebuiltAt > 0 && /_rebuilt_as_stands_shadow_and_separation$/.test(ids[rebuiltAt + 1] ?? '') && /_rebuilt_as_stands_solar_access$/.test(ids[rebuiltAt + 2] ?? ''), ids.join(' '));
    // Z. 2026-11: "place the compliance sheet right after the scenario page"; "shadow will be page two"
    const at = ids.findIndex((i) => /_stands_today$/.test(i));
    check('compliance: straight after the page of what it tests, the shadow and its plan second, the sun third', at > 0 && ids[at + 1] === comp[0] && ids[at + 2] === comp[1], ids.join(' '));
    // a building under the controls is no path, but its compliance is still shown, before the designed massings'
    const lowB: YieldBundle = { ...bundle, existing: [{ footprintSqm: 1060, heightM: 6.2, rings: [inner] }] };
    const lowS = yieldStudy(lowB), lowDeck = renderYieldDeck(lowB, { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false });
    const lowComp = lowDeck.slides.map((sl) => sl.id).filter((i) => isTestPage(i));
    check('compliance: what stands under the controls is no path, yet its compliance is shown', lowS.retained === undefined && !!lowS.standing && /stands_today_shadow_and_separation$/.test(lowComp[0] ?? '') && /stands_today_solar_access$/.test(lowComp[1] ?? ''), lowComp.join(' '));
    check('compliance: then the designed massings\'', lowComp.length >= 4 && lowComp.slice(2).every((i) => !/stands_today/.test(i)), lowComp.join(' '));
  }

  // The low and mid-rise housing controls: in a low density zone near a town centre, one scheme across the whole site.
  {
    const r2: YieldBundle = { ...bundle, controls: { ...bundle.controls, zoneCode: 'R2', maxHeightM: 9.5, fsr: 0.5 }, existing: [], lmrCentre: { name: 'Maroubra Junction town centre', distanceM: 20 } };
    const sr = yieldStudy(r2);
    check('LMR: R2 by a town centre is read: a flat building to 9.5 m and 0.8:1', sr.lmr?.permits === 'residentialFlatBuilding' && sr.lmr.hobM === 9.5 && sr.lmr.fsr === 0.8 && sr.lmr.band === 'inner' && sr.lmr.lifts === true, JSON.stringify(sr.lmr));
    check('LMR: the zone alone gives no scheme; the policy gives one on the whole site', sr.base.archetype === 'none' && !!sr.lmrY && sr.lmrY.archetype === 'residential' && sr.lmrY.gfa > 0 && sr.lmrY.gfa <= 0.8 * (r2.siteAreaSqm ?? 0) + 1, JSON.stringify(sr.lmrY && { storeys: sr.lmrY.storeys, gfa: sr.lmrY.gfa }));
    // Z. 2026-11, on the two-storey ring the envelope drew round the whole site: "the volume is obviously filled and
    // should be higher"; then, on three separate buildings drawn in its place: "it should be unified, one full
    // volume", "like this without the hole in the middle". The scheme is the envelope itself, to the whole of its
    // 9.5 m: one solid volume, three storeys, no courtyard held in it.
    check('LMR: three storeys under the 9.5 m, to the height and not over it', sr.lmrY?.storeys === 3 && Math.abs((sr.lmrY?.heightM ?? 0) - 9.5) < 1e-6, `${sr.lmrY?.storeys} storeys, ${sr.lmrY?.heightM} m`);
    const lt = sr.lmrY!.tiers;
    check('LMR: one volume, the envelope itself: nothing held out of it, no hole in it', lt.length === 1 && lt[0].from === 1 && lt[0].to === 3 && Math.abs(lt[0].plateSqm - lt[0].envelopeSqm) < 1e-6 && lt[0].plate.length === 1 && lt[0].held === undefined, JSON.stringify(lt.map((t) => [t.from, t.to, Math.round(t.plateSqm), Math.round(t.envelopeSqm), t.plate.length, t.held])));
    const perStorey = [1, 2, 3].map((n) => sr.lmrY!.floors.filter((f) => f.storey === n).reduce((t, f) => t + f.gfa, 0));
    check('LMR: floor area on every storey of it, the same on each', perStorey.every((g) => g > 0 && Math.abs(g - perStorey[0]) < 1e-6), perStorey.map((g) => Math.round(g)).join(' / '));
    const capL = 0.8 * (r2.siteAreaSqm ?? 0);
    check('LMR: the ratio governs a volume that holds more than it allows', sr.lmrY!.gfaCapacity > capL ? sr.lmrY!.governs === 'fsr' && Math.abs(sr.lmrY!.gfa - capL) < 1 : sr.lmrY!.governs === 'envelope' && Math.abs(sr.lmrY!.gfa - sr.lmrY!.gfaCapacity) < 1, `${sr.lmrY!.governs}: ${Math.round(sr.lmrY!.gfa)} of ${Math.round(sr.lmrY!.gfaCapacity)}, the ratio ${Math.round(capL)}`);
    // the same land and height without the option: the study's usual building, its depth held, a courtyard in it
    const lowRise = { ...DEFAULT_ASSUMPTIONS, roofAllowance: 0.2 };
    const held = computeYield({ ring: sr.ring, fronts: sr.fronts, siteAreaSqm: r2.siteAreaSqm ?? 0, zone: 'R2', hobM: 9.5, fsr: 0.8, archetype: 'residential', assumptions: lowRise });
    const solid = computeYield({ ring: sr.ring, fronts: sr.fronts, siteAreaSqm: r2.siteAreaSqm ?? 0, zone: 'R2', hobM: 9.5, fsr: 0.8, archetype: 'residential', assumptions: lowRise, envelope: true });
    const plateOf = (y: { tiers: { from: number; plateSqm: number }[] }) => y.tiers.filter((t) => t.from === 1).reduce((t, x) => t + x.plateSqm, 0);
    check('LMR: the option alone makes the difference: the same envelope, none of it held', Math.abs(solid.tiers[0].envelopeSqm - held.tiers[0].envelopeSqm) < 1e-6 && plateOf(solid) >= plateOf(held) && Math.abs(plateOf(solid) - solid.tiers[0].envelopeSqm) < 1e-6, `${Math.round(plateOf(solid))} m² against ${Math.round(plateOf(held))} held, the envelope ${Math.round(solid.tiers[0].envelopeSqm)}`);
    check('LMR: the scheme is that volume', Math.abs(plateOf(sr.lmrY!) - plateOf(solid)) < 1e-6 && sr.lmrY!.storeys === solid.storeys);
    check('LMR: an envelope never holds more floor area than the ratio allows', solid.gfa <= capL + 1 && sr.lmrY!.gfa <= capL + 1);
    check('LMR: deep soil is measured off the whole of its plate', Math.abs(sr.lmrY!.adg.deepSoil.groundFreeSqm - Math.max(0, (r2.siteAreaSqm ?? 0) - plateOf(sr.lmrY!))) < 1, `${Math.round(sr.lmrY!.adg.deepSoil.groundFreeSqm)} m² clear of ${Math.round(plateOf(sr.lmrY!))} m² on ${Math.round(r2.siteAreaSqm ?? 0)}`);
    check('LMR: yield_assumptions.json\'s own roof allowance stands', yieldStudy({ ...r2, assumptions: { roofAllowance: 1.5 } }).lmrY?.storeys !== 3);
    // Z. 2026-11, on the spread of "within the controls" here, every figure a dash over the height plane alone: "if
    // there is nothing, don't print it". The path keeps its row in the overview's table, with no page.
    const r2Deck = renderYieldDeck(r2, { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false });
    const r2Ids = r2Deck.slides.map((sl) => sl.id).join(',');
    check('a path that builds nothing has no spread: the deck goes from the overview to the scheme the policy gives', r2Ids === '01_planning_yield,02_low_mid_rise,03_low_mid_rise_shadow_and_separation,04_low_mid_rise_solar_access,05_controls_and_assumptions', r2Ids);
    check('…and keeps its row in the overview, with no page', /Within the controls<\/td>(?:.(?!<\/tr>))*>—<\/td><\/tr>/.test(r2Deck.slides[0].figureHtml) && /Low and mid-rise housing<\/td>(?:.(?!<\/tr>))*>02<\/td><\/tr>/.test(r2Deck.slides[0].figureHtml));
    const bare = renderYieldDeck({ ...r2, lmrCentre: undefined }, { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false }).slides.map((sl) => sl.id).join(',');
    check('…and a site with no path at all is its overview and its controls', bare === '01_planning_yield,02_controls_and_assumptions', bare);
    check('LMR: it is a path, after the controls', scenarioRows(r2, sr).map((r) => r.id).join(',') === 'withinControls,lowMidRise', scenarioRows(r2, sr).map((r) => r.id).join(','));
    const far = yieldStudy({ ...r2, lmrCentre: { name: 'Maroubra Junction town centre', distanceM: 950 } });
    check('LMR: beyond 800 m it does not apply', far.lmr === undefined && far.lmrY === undefined);
    check('LMR: with no town centre read, nothing changes', yieldStudy({ ...r2, lmrCentre: undefined }).lmrY === undefined);
    const r4 = yieldStudy({ ...bundle, lmrCentre: { name: 'X town centre', distanceM: 20 } });
    check('LMR: a zone that takes apartments already keeps its own paths', r4.lmr === undefined && r4.lmrY === undefined);
    const small = yieldStudy({ ...r2, siteAreaSqm: 420 });
    check('LMR: a lot under 500 m² is told so and gets no scheme', small.lmr?.bigEnough === false && small.lmrY === undefined);
  }
  const low: YieldBundle = { ...bundle, existing: [{ footprintSqm: 1060, heightM: 6.2, rings: [inner] }] };
  check('rebuilt: a building under the controls is no path of its own', yieldStudy(low).retained === undefined);

  // ---- the deck, of the same lots: a spread a path ----

  const meta = { jobNo: '', client: '', status: '', sheetNo: '', revision: '', checked: '', drawn: '', date: '', preliminary: false };
  const deck = (b: YieldBundle) => renderYieldDeck(b, meta);
  const all = deck(bundle);
  const pages = all.slides.map((sl) => sl.id).join(',');
  // Z. 2026-11: "place the compliance sheet right after the scenario page"; "split solar and shadow with setbacks to
  // two different pages"; "shadow will be page two". Each option: its spread, its shadow and separation, its solar access.
  check('deck: the paths side by side, a spread each with its shadow and its solar access straight after it, the controls last', pages === ['01_planning_yield', '02_stands_today',
    ...['within_controls', 'reshaped', 'affordable_bonus', 'envelope_to_height'].flatMap((x, i) => [`${String(3 + 3 * i).padStart(2, '0')}_${x}`, `${String(4 + 3 * i).padStart(2, '0')}_${x}_shadow_and_separation`, `${String(5 + 3 * i).padStart(2, '0')}_${x}_solar_access`]),
    '15_controls_and_assumptions'].join(','), pages);
  check('overview: several lots in one line of the figure, as lot/plan, the rest counted', lotsShort('Lot 1 - DP 965310') === 'Lot 1 - DP 965310' && lotsShort('Lot 1 - DP 965310; Lot 10 - DP 1118472; Lot 1 - DP 36591') === '3 lots: 1/DP965310, 10/DP1118472, 1/DP36591'
    && /^5 lots: .* \+ 3 more$/.test(lotsShort('Lot 1 - DP 965310; Lot 10 - DP 1118472; Lot 1 - DP 36591; Lot 4 - DP 12345; Lot 5 - DP 12345')) && lotsShort(undefined) === '—');
  // Z. 2026-11, on the first page's aerial with every lot tinted and written with its zone, beside a massing in the
  // zones' colours: "these two are not matching by style or colour. Let's keep the aerial map there, but simplify the
  // zoning." Over the photograph a zone is an area in one line of its colour, named once; a lot has its number alone.
  {
    const dLon = 1 / (111320 * Math.cos((33.9 * Math.PI) / 180)), dLat = 1 / 110574;
    const lot = (x: number, y: number, w: number, h: number) => { const x0 = 151.20043 + x * dLon, y0 = -33.9 + y * dLat; return [[x0, y0], [x0 + w * dLon, y0], [x0 + w * dLon, y0 + h * dLat], [x0, y0 + h * dLat], [x0, y0]]; };
    const merc = (lon: number, lat: number) => ({ x: (lon * 20037508.34) / 180, y: (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180) });
    const sw = merc(151.199, -33.901), ne = merc(151.202, -33.898);
    const pictured = { ...bundle,
      parcels: [{ rings: [lot(2, 0, 15, 40)], numbers: ['2'], zone: 'R4', hob: { value: 18.6, units: 'm' } }, { rings: [lot(17, 0, 15, 40)], numbers: ['4'], zone: 'R4', hob: { value: 18.6, units: 'm' } },
        { rings: [lot(2, 60, 30, 30)], numbers: ['9'], zone: 'R2', hob: { value: 9.5, units: 'm' } }],
      aerial: { tiles: [{ file: 'aerial-0.jpg', left: 0, top: 0, width: 1, height: 1 }], pxWidth: 100, pxHeight: 100, extent: { xmin: sw.x, ymin: sw.y, xmax: ne.x, ymax: ne.y } } } as unknown as YieldBundle;
    const first = (bd: YieldBundle, theme?: string) => renderYieldDeck(bd, meta, theme ? { theme } : {}).slides[0];
    const ov = first(pictured), n = (re: RegExp) => (ov.figureHtml.match(re) ?? []).length;
    check('overview: the photograph kept, each zone an area in one line of its colour, no lot tinted', /<image href="data\/aerial-0\.jpg"/.test(ov.figureHtml) && n(/data-zone-edge="1"/g) === 2 && n(/data-zone-area="1"/g) === 0,
      `${n(/data-zone-edge="1"/g)} edges, ${n(/data-zone-area="1"/g)} tints`);
    check('overview: a zone and its height written once an area, not on every lot; each lot its number alone', n(/data-zone-label="1"/g) === 2 && n(/R4 · HOB = 18\.6m/g) === 1 && n(/>NO\. 2</g) === 1 && n(/>NO\. 4</g) === 1,
      `${n(/data-zone-label="1"/g)} labels, ${n(/R4 · HOB = 18\.6m/g)} of R4`);
    check('overview: the key names the zones by their lines, the lots by their numbers', (ov.legend ?? []).some((e) => /each with its street number/.test(e.label)) && !(ov.legend ?? []).some((e) => /tinted by its zone/.test(e.label)));
    process.env.YIELD_OVERVIEW_ZONES = 'lots';
    const old = first(pictured).figureHtml;
    delete process.env.YIELD_OVERVIEW_ZONES;
    check('overview: each lot tinted and written with its zone is still to be had', !/data-zone-edge/.test(old) && (old.match(/R4 · HOB = 18\.6m/g) ?? []).length === 2);
    check('overview: Heron keeps its hatches over the photograph', !/data-zone-edge/.test(first(pictured, 'heron').figureHtml));
  }
  check('deck: every page an A3 atlas spread', (all.html.match(/<section class="slide atlas"/g) ?? []).length === 15);
  // Several drawings in one document: an id used twice would clip one with another's frame.
  const used = [...all.html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const twice = used.filter((v, i) => used.indexOf(v) !== i);
  check('deck: no id is used twice', twice.length === 0, [...new Set(twice)].slice(0, 5).join(', '));
  check('deck: the kept bulk gets its spread, after what stands and its two pages', deck(tall).slides.slice(1, 5).map((sl) => sl.id).join(',') === '02_stands_today,03_stands_today_shadow_and_separation,04_stands_today_solar_access,05_rebuilt_as_stands', deck(tall).slides.map((sl) => sl.id).join(','));
  check('deck: fewer paths, fewer pages', deck(openB).slides.length === 11 && deck(sliver).slides.length === 5,
    `${deck(openB).slides.length}, ${deck(sliver).slides.length}`);
  check('deck: the overview names each path\'s page', /Envelope to the height<\/td>(?:.(?!<\/tr>))*>12<\/td>/.test(all.html) && /Reshaped to comply<\/td>(?:.(?!<\/tr>))*>06<\/td>/.test(all.html));

  // ---- sun and shadow at mid winter, on the same lots ----
  const sunRows = yieldRows(bundle, s);
  const r4a = sunRows.find((r) => r.label === '4A. SOLAR AND DAYLIGHT ACCESS');
  check('sun: the controls table gives the share with two hours, and marks it', !!r4a && /^\d+% \(\d+ of \d+\)/.test(r4a.proposed?.[0] ?? '') && typeof r4a.ok === 'boolean', JSON.stringify(r4a));
  check('sun: the council not known, two hours are said to be assumed', /two hours assumed/.test(r4a?.controls?.join(' ') ?? ''), JSON.stringify(r4a?.controls));
  check('sun: no direct sunlight has its row', sunRows.some((r) => r.label === '4A. NO DIRECT SUNLIGHT'));
  // the yield's own pages say nothing of the sun: it has a spread of its own, after each path's
  const page = (id: string) => all.slides.find((sl) => sl.id === id)!;
  check('sun: the overview and the path\'s spread carry no sun', !/Sun 2\sh|of sun/.test(page('01_planning_yield').figureHtml + (page('01_planning_yield').narrative ?? ''))
    && !/stroke-width="0\.07"/.test(page('03_within_controls').figureHtml) && !/sun/i.test(page('03_within_controls').narrative ?? ''));
  check('sun: the scenarios still carry each drawn path\'s share for the open formats', scenarioRows(bundle, s).filter((r) => r.id !== 'standsToday').every((r) => /^\d+%$/.test(r.sun ?? '')),
    JSON.stringify(scenarioRows(bundle, s).map((r) => r.sun)));
  const shade = page('04_within_controls_shadow_and_separation'), solar = page('05_within_controls_solar_access');
  // the apartments' panels on the massing (axonometric cells, outlined at 0.07), and the key's yellow
  // What each criterion asks, in full, is a line of small print under its own row on the first option's pages, and on no other's.
  // It was a table of its own under the others ("Assessment criteria"), which ran into the page's key: no such block now.
  const notes = (html: string) => [...html.matchAll(/<tr class="yn"><td colspan="4">([^<]*)<\/td><\/tr>/g)].map((m) => m[1]);
  const bonusShade = page('10_affordable_bonus_shadow_and_separation'), bonusSolar = page('11_affordable_bonus_solar_access');
  check('compliance: two pages an option, titled for it, what the criteria ask written out only on the first option\'s', shade.title === 'Within the controls: shadow' && solar.title === 'Within the controls: solar access'
    && bonusShade.title === 'Affordable bonus: shadow' && bonusSolar.title === 'Affordable bonus: solar access'
    && notes(shade.figureHtml).length >= 2 && notes(solar.figureHtml).length >= 3 && notes(bonusShade.figureHtml).length + notes(bonusSolar.figureHtml).length === 0, `${notes(shade.figureHtml).length} and ${notes(solar.figureHtml).length} on the first, ${notes(bonusShade.figureHtml).length + notes(bonusSolar.figureHtml).length} on the third`);
  check('compliance: each criterion\'s note under its own row, on the page that tests it, none in a block of its own', ['ADG 3B-2', 'ADG 3F-1'].every((t) => notes(shade.figureHtml).some((n) => n.startsWith(t)))
    && ['ADG 4A-1', 'ADG 4A-2', 'The most floor area allowed'].every((t) => notes(solar.figureHtml).some((n) => n.startsWith(t)))
    && /<tr class="noted"><td>Building separation<\/td>[\s\S]*?<\/tr><tr class="yn"><td colspan="4">ADG 3F-1/.test(shade.figureHtml) && !/Assessment criteria/.test(all.html), [...notes(shade.figureHtml), ...notes(solar.figureHtml)].join(' | '));
  check('compliance: the criteria split between the two pages, each marked: the shadow and the separation; the sun and the yield', ['Overshadow impact', 'Building separation'].every((t) => shade.figureHtml.includes(`<td>${t}</td>`) && !solar.figureHtml.includes(`<td>${t}</td>`))
    && ['Solar access, 2 h', 'Solar access, none', 'Yield'].every((t) => solar.figureHtml.includes(`<td>${t}</td>`) && !shade.figureHtml.includes(`<td>${t}</td>`))
    && shade.figureHtml.indexOf('Overshadow impact') < shade.figureHtml.indexOf('<td>Building separation</td>') && solar.figureHtml.indexOf('Solar access, 2 h') < solar.figureHtml.indexOf('<td>Yield</td>'));
  check('compliance: yield within the controls is 100% and ticked; filled to the height, over and crossed', /<td>Yield<\/td>(?:.(?!<\/tr>))*100%(?:.(?!<\/tr>))*M0\.6,2\.1/.test(solar.figureHtml)
    && /<td>Yield<\/td>(?:.(?!<\/tr>))*1\d\d%(?:.(?!<\/tr>))*M1,0\.6/.test(page('14_envelope_to_height_solar_access').figureHtml));
  // Z. 2026-11: "the roof shouldn't be counted, coloured like that: we care only for facades, not the roof"
  // Z. 2026-11: "make the roof white". The solar access views' roofs white, as every roof of the scheme now is.
  check('solar access: the roofs white', /<path d="[^"]+" fill="#ffffff" fill-rule="evenodd" stroke="#000000"/.test(solar.figureHtml));
  check('compliance: the sun on each facade, by the way it looks; no roof in it', />Sun on each facade</.test(solar.figureHtml) && !/the roof/.test(solar.figureHtml.slice(0, solar.figureHtml.indexOf('<svg')))
    && !/<td>roof, all tiers<\/td>/.test(solar.figureHtml) && /<td>N<\/td>/.test(solar.figureHtml) && !/Its roof has/.test(solar.narrative ?? ''));
  check('solar access: the apartments storey by storey, their number the option\'s', /Apartments, storey by storey/.test(solar.figureHtml) && !/Apartments, storey by storey/.test(shade.figureHtml));
  // Solar access: two massings, one over the other, every facade and the roof coloured by its band of hours (flat
  // cells, white-edged), and no plan: the plan is the shadow's, the page before.
  const hasPlan = (html: string) => html.includes('<clipPath id="plan-');
  check('solar access: the massing from the street corner over the same from the opposite one, the page theirs, no plan on it', ['From the street corner', 'From the opposite corner'].every((t) => solar.figureHtml.includes(t)) && !hasPlan(solar.figureHtml)
    && (solar.figureHtml.match(/stroke="#ffffff" stroke-width="0\.07"/g) ?? []).length > 50 && (solar.legend ?? []).some((e) => /^Facades, hours of sun/.test(e.label)) && (solar.legend ?? []).some((e) => /roofs, white: not counted/.test(e.label))
    && !(solar.legend ?? []).some((e) => /laid over the last|Separation:/.test(e.label)));
  check('shadow: the plan the whole page, no massing on it, its key the shadows\'', hasPlan(shade.figureHtml) && !/From the street corner/.test(shade.figureHtml) && /height="297mm"/.test(shade.figureHtml)
    && (shade.legend ?? []).some((e) => /shadows on 21 June, each hour/.test(e.label)) && !(shade.legend ?? []).some((e) => /Facades, hours of sun/.test(e.label)));
  check('shadow: the land its shadow falls on, counted', /The shadow it adds/.test(shade.figureHtml) && ['residential lots', 'heritage items', 'parks and reserves'].every((t) => shade.figureHtml.includes(`<td>${t}</td>`)));
  // Z. 2026-11: "make the isometry here for the full half page and remove the plan: the plan is visible in shadow";
  // "keep the rule with full isometry everywhere; if there is nothing interesting for compliance, don't show the
  // shadow or plan at all". Every path's own spread draws its massing alone, the whole page; its plan is the page
  // after, with its shadow, where it has apartments to test, and nowhere where it has none.
  const own = page('03_within_controls');
  check('a path\'s spread: its massing the whole page, its plan on the page after', !hasPlan(own.figureHtml) && /height="297mm"/.test(own.figureHtml) && /Its plan is on page 04, with its shadow and its separations/.test(own.sources ?? ''), (own.sources ?? '').slice(-200));
  check('a path\'s spread: one with nothing to test draws its massing the whole page too, and has no plan anywhere', !hasPlan(page('02_stands_today').figureHtml) && /height="297mm"/.test(page('02_stands_today').figureHtml) && !/Its plan is on page/.test(page('02_stands_today').sources ?? '')
    && all.slides.filter((sl) => hasPlan(sl.figureHtml)).map((sl) => sl.id).join(',') === ['01_planning_yield', '04_within_controls', '07_reshaped', '10_affordable_bonus', '13_envelope_to_height'].map((x, i) => (i ? `${x}_shadow_and_separation` : x)).join(','),
    all.slides.filter((sl) => hasPlan(sl.figureHtml)).map((sl) => sl.id).join(','));
  check('the pages point to each other', /Its apartments' sun is on page 05/.test(shade.sources ?? '') && /Its plan, its shadow and its separations are on page 04/.test(solar.sources ?? '') && /Every assumption is on page 15/.test(shade.sources ?? ''));
  {
    // an office scheme: no apartment's sun to test, but its shadow and its separations are; the yield's criterion goes with them
    const officeDeck = deck({ ...bundle, controls: { ...bundle.controls, zoneCode: 'E2' } }), oIds = officeDeck.slides.map((sl) => sl.id);
    const oShade = officeDeck.slides.find((sl) => /_within_controls_shadow_and_separation$/.test(sl.id));
    check('compliance: a scheme with no apartments has its shadow page alone, the yield\'s criterion on it', !!oShade && !oIds.some((i) => /_within_controls_solar_access$/.test(i))
      && oShade.figureHtml.includes('<td>Yield</td>') && !/Its apartments' sun is on page/.test(oShade.sources ?? '') && oIds.indexOf(oShade.id) === oIds.findIndex((i) => /_within_controls$/.test(i)) + 1, oIds.join(','));
  }
  check('compliance: the plan draws the shadow at 9, 12 and 3', /9 AM/.test(shade.figureHtml) && /12 PM/.test(shade.figureHtml) && /3 PM/.test(shade.figureHtml), (shade.figureHtml.match(/\d+ [AP]M/g) ?? []).join(','));
  // Z. 2026-11: "the shadow should be the same scale as plans"; then, on a version that drew the shadow on the path's
  // numbered plan and left the neighbours' shadows out: "the previous shadow was better: just update the scale and
  // colours, keep the shadows with the same information". The report's sun page as it was, at the overview's scale and
  // in the plans' colours.
  const scaleOf = (html: string) => (html.match(/class="abs maplabel[^"]*"[^>]*>[^<]*?1:([\d ]+)/) ?? html.match(/1:([\d ]+) ·/) ?? [])[1];
  check('shadow: its plan at the overview\'s scale', !!scaleOf(shade.figureHtml) && scaleOf(shade.figureHtml) === scaleOf(page('01_planning_yield').figureHtml), `${scaleOf(shade.figureHtml)} against ${scaleOf(page('01_planning_yield').figureHtml)}`);
  check('shadow: the path\'s plan, each tier badged as in the schedule; no zone written on it', /<circle cx="[\d.]+" cy="[\d.]+" r="2\.2" fill="#ffffff"/.test(shade.figureHtml)
    && !/HOB =/.test(shade.figureHtml) && (shade.legend ?? []).some((e) => /Envelope of each tier, numbered as in the schedule/.test(e.label)));
  // the bands of sun hours in each style's own palette: six, blue short of two hours and warm from two, the neighbours apart
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const sunOf = (st: string) => withTemplate(st, () => ({ bands: sunBands(), f: deckFamilies(), none: bandOf(0).fill, four: bandOf(4.5).fill, top: bandOf(5.5).fill }));
  const styles = ['flamingo', 'kingfisher', 'canary'].map(sunOf), heronSun = sunOf('heron');
  const apart = (bands: { fill: string }[]) => bands.slice(1).every((x, i) => { const p2 = rgb(bands[i].fill), q2 = rgb(x.fill); return Math.hypot(p2[0] - q2[0], p2[1] - q2[1], p2[2] - q2[2]) > 40; });
  // Heron's are its context sheet's colours, run as the lorikeet runs: slates short of two hours, its walks' green at
  // two, sand and tan from three, the sheet's red (not the lorikeet's) for the most sun
  check('sun bands: Heron\'s seven in its context sheet\'s colours, slates short of two hours, green at two, warm from three, its red on top, each apart from the next', heronSun.bands.length === 7
    && heronSun.bands.slice(0, 3).every((x) => { const [r, , b2] = rgb(x.fill); return b2 > r; }) && (([r, g, b2]) => g > r && g > b2)(rgb(heronSun.bands[3].fill))
    && heronSun.bands.slice(4).every((x) => { const [r, , b2] = rgb(x.fill); return r > b2; }) && heronSun.top.toLowerCase() === '#cf4a2e' && heronSun.four !== heronSun.top && apart(heronSun.bands), JSON.stringify(heronSun.bands.map((y) => y.fill)));
  check('sun bands: seven in each colour style after the lorikeet, blues short of two hours, green at two, warm from three, each apart from the next', styles.every(({ bands }) => bands.length === 7
    && bands.slice(0, 3).every((x) => { const [r, , b2] = rgb(x.fill); return b2 > r; }) && (([r, g, b2]) => g > r && g > b2)(rgb(bands[3].fill))
    && bands.slice(4).every((x) => { const [r, , b2] = rgb(x.fill); return r > b2; })
    && apart(bands)),
    JSON.stringify(styles.map((x) => x.bands.map((y) => y.fill))));
  check('sun bands: each colour style its own blues, every one topped by #FF5A3D at five hours and over; a boundary belongs to the band above', new Set([...styles, heronSun].map((x) => x.none)).size === 4
    && styles.every((x) => x.top === '#FF5A3D' && x.four !== x.top) && bandOf(0).label === 'none' && bandOf(0.25).label === 'under 1 h' && bandOf(2).label === '2–3 h' && bandOf(1.75).label === '1–2 h' && bandOf(4.5).label === '4–5 h' && bandOf(5).label === '5 h and over');
  // the plan as the report's sun page draws it: every hour 9 to 3 a translucent layer, the buildings with their storeys,
  // set in Arial; in the plans' colours, the scheme's plate on paper over its own shadow in its use's colour
  const planSvg = shade.figureHtml.slice(shade.figureHtml.indexOf('<clipPath id="plan-within'));
  // Z. 2026-11: "the shadow of our design should have a different colour than the others". The envelope's in the
  // style's accent, the neighbours' in grey; each an hour a soft layer that darkens what is under it.
  const accentInk = (planSvg.match(/<g opacity="0\.15" style="mix-blend-mode:multiply"><path d="[^"]+" fill="(#[0-9a-fA-F]{6})" fill-rule="evenodd"\/>/) ?? [])[1];
  check('shadow: the envelope\'s own shadow an hour a layer, 9 to 3, in a colour of its own and not the neighbours\' grey', (planSvg.match(/<g opacity="0\.15" style="mix-blend-mode:multiply">/g) ?? []).length === 7 && !!accentInk && accentInk.toLowerCase() !== '#3a3c41',
    `${(planSvg.match(/<g opacity="0\.15"/g) ?? []).length} layers in ${accentInk}`);
  check('shadow: the envelope\'s own at 9 am, 12 pm and 3 pm outlined, in its colour', (planSvg.match(new RegExp(`fill="none" stroke="${accentInk}" stroke-width="0\\.25" stroke-dasharray="1\\.2,0\\.8"`, 'g')) ?? []).length === 3, String((planSvg.match(/stroke-dasharray="1\.2,0\.8"/g) ?? []).length));
  check('shadow: no hatch on it by default', !/data-added/.test(planSvg));
  // Z. 2026-11: "don't do white outlines on texts". No word of a plan has a halo.
  const overviewPlan = page('01_planning_yield').figureHtml.slice(page('01_planning_yield').figureHtml.indexOf('<clipPath id="plan-'));
  check('no word on a plan has a white outline round it', !/paint-order="stroke"/.test(planSvg) && !/paint-order="stroke"/.test(overviewPlan));
  // Z. 2026-11: "the yellows should be the same everywhere". The plan's plate is solid, in the colour its massing's roof
  // and its key have (it stood at 55%, paler on the plan than on the isometric beside it).
  const plateFill = /<path data-plate="1" d="[^"]+" fill="(#[0-9a-fA-F]{6})" fill-rule="evenodd" stroke="#000000"/.exec(planSvg)?.[1];
  check('shadow: the built plate solid, in the colour of its massing and its key', !!plateFill && !/data-plate="1"[^>]*fill-opacity/.test(planSvg)
    && page('03_within_controls').figureHtml.includes(`fill="${plateFill}"`) && (shade.legend ?? []).some((e) => e.swatch.includes(`fill="${plateFill}"`)), String(plateFill));
  // Z. 2026-11: "our site, very thick black". One solid black line, on the plan and on the ground of every massing.
  check('the site a very thick black line on the plan and on the massing\'s ground, no dashes, no accent', /<path data-site="1" d="[^"]+" fill="none" stroke="#000000" stroke-width="1\.4" stroke-linejoin="round"\/>/.test(planSvg)
    && /<path data-site d="[^"]+" fill="none" stroke="#000000" stroke-width="1" stroke-linejoin="round"\/>/.test(page('03_within_controls').figureHtml)
    && /<path data-site d="[^"]+" fill="none" stroke="#000000" stroke-width="1" stroke-linejoin="round"\/>/.test(solar.figureHtml)
    && (shade.legend ?? []).some((e) => e.label === 'The site' && /stroke="#000000" stroke-width="0\.7"/.test(e.swatch)));
  check('shadow: the key names the neighbours\' shadows hour by hour, the envelope\'s own in its colour with its three outlined, the separations, and the neighbours by their street numbers',
    (shade.legend ?? []).some((e) => /The neighbours' shadows on 21 June, each hour 9 am – 3 pm laid over the last/.test(e.label) && e.swatch.includes('#3a3c41'))
    && (shade.legend ?? []).some((e) => /own shadow, the same hours, in its own colour; at 9 am, 12 pm and 3 pm outlined/.test(e.label) && e.swatch.includes(String(accentInk)))
    && (shade.legend ?? []).some((e) => /Building separation, apart \/ asked/.test(e.label)) && (shade.legend ?? []).some((e) => /each lot with its street number/.test(e.label)) && !(shade.legend ?? []).some((e) => /zone/.test(e.label)));
  check('compliance: a lone option gets its two pages', deck(sliver).slides.some((sl) => sl.id === '03_within_controls_shadow_and_separation') && deck(sliver).slides.some((sl) => sl.id === '04_within_controls_solar_access'), deck(sliver).slides.map((sl) => sl.id).join(','));
  check('sun: what stands is given no sun', scenarioRows(bundle, s)[0].sun === undefined);
  const orange: YieldBundle = { ...bundle, controls: { ...bundle.controls, lgaName: 'ORANGE' } };
  check('sun: three hours asked outside Sydney, Newcastle and Wollongong', /receive 3 hours direct/.test(JSON.stringify(yieldRows(orange))) && /<td>Solar access, 3\sh<\/td>/.test(deck(orange).slides.find((sl) => isTestPage(sl.id, 'solar'))!.figureHtml));
  const unbroken: YieldBundle = { ...bundle, assumptions: { sun: { continuous: true } } };
  check('sun: yield_assumptions.json can ask the hours unbroken, and the pages say so', /unbroken/.test(JSON.stringify(yieldRows(unbroken))) && /in one unbroken run/.test(deck(unbroken).slides.find((sl) => isTestPage(sl.id, 'solar'))!.sources ?? ''));
  // a two-storey building 2 m off the site's east boundary: 8 m from the scheme's first tier, short of the 12 m and the 9 m
  const m = 1 / (111320 * Math.cos((33.9 * Math.PI) / 180));
  const east = [[151.20043 + 2 * m, -33.8999], [151.20043 + 12 * m, -33.8999], [151.20043 + 12 * m, -33.89965], [151.20043 + 2 * m, -33.89965], [151.20043 + 2 * m, -33.8999]];
  const close: YieldBundle = { ...bundle, context: [{ rings: [east], heightM: 6.2, known: true }] };
  // Heron's line plans, after an architect's site plan: a neighbour white in a heavy black outline, a tree a circle
  // with its centre marked, what is built in the heaviest outline; the massing a line model, its faces unshaded
  {
    // (a neighbour's lot beside the site, so there is a garden to stipple)
    const lotE = [[151.20043 + 1 * m, -33.9], [151.20043 + 30 * m, -33.9], [151.20043 + 30 * m, -33.89955], [151.20043 + 1 * m, -33.89955], [151.20043 + 1 * m, -33.9]];
    const treed = { ...close, lots: [[lotE]], trees: [{ lon: 151.20043 + 20 * m, lat: -33.89975, canopyM: 6, source: 'aerial' }] } as YieldBundle;
    // (a path's plan is its shadow's page; its massing its own spread's)
    const heronDeck = renderYieldDeck(treed, meta, { theme: 'heron' });
    const hp = heronDeck.slides.find((sl) => sl.id === '04_within_controls_shadow_and_separation')!.figureHtml + heronDeck.slides.find((sl) => sl.id === '03_within_controls')!.figureHtml;
    check('heron: the plan a line plan, its buildings white in a heavy black outline, what is built in the heaviest', /fill="#ffffff" stroke="#111111" stroke-width="0\.45"/.test(hp) && /stroke="#000000" stroke-width="0\.6"/.test(hp), hp.slice(hp.indexOf('#111111') - 80, hp.indexOf('#111111') + 60));
    check('heron: the massing a line model, the built in the heaviest outline, the gardens stippled in line', /fill="none" stroke="#000000" stroke-width="[\d.]+" stroke-linejoin="round"\/>/.test(hp) && !hp.includes('@@pw') && /data-ground="yard"/.test(hp) && !/fill="url\(#axo-(lawn|yard|road|shade)-/.test(hp));
    const kDeck = renderYieldDeck(treed, meta, { theme: 'kingfisher' });
    const kp = kDeck.slides.find((sl) => sl.id === '04_within_controls_shadow_and_separation')!.figureHtml;
    check('heron: the line plan is Heron\'s alone', !/stroke="#111111" stroke-width="0\.45"/.test(kp) && !/stroke="#000000" stroke-width="0\.6"/.test(kp));
    // Z. 2026-11: "don't do yellow buildings anywhere"; "colour should have only what we really care about in a
    // drawing, the rest can be black and white … or have colourful outlines, but not fills". What is built is white in
    // a black line in every style; it was Canary's yellow, Flamingo's salmon, Kingfisher's pale blue.
    // (a path's plan is its shadow's page: the scheme's plate is read there, its walls on its own spread)
    const cDeck = renderYieldDeck(treed, meta, { theme: 'canary' });
    const cp = cDeck.slides.find((sl) => sl.id === '04_within_controls_shadow_and_separation')!.figureHtml;
    const plate = (html: string) => /<path data-plate="1" d="[^"]+" fill="(#[0-9a-f]{6})" fill-rule="evenodd" stroke="#000000" stroke-width="0\.5"/.exec(html)?.[1];
    const fDeck = renderYieldDeck(treed, meta, { theme: 'flamingo' });
    const fp = fDeck.slides.find((sl) => sl.id === '04_within_controls_shadow_and_separation')!.figureHtml;
    check('every style: the scheme white in a black line on the plan, no colour in its fill', [cp, kp, fp].every((h) => plate(h) === '#ffffff'), `${plate(cp)} ${plate(kp)} ${plate(fp)}`);
    const keyFills = [cDeck, kDeck, fDeck].flatMap((d) => d.slides.flatMap((sl) => (sl.legend ?? []).filter((e) => /Indicative massing|What stands on the site/.test(e.label)).map((e) => /fill="(#[0-9a-f]{6})"/.exec(e.swatch)?.[1])));
    check('every style: the keys draw what is built white', keyFills.length > 0 && keyFills.every((f) => f === '#ffffff'), keyFills.join(' '));
    const massWalls = [cDeck, kDeck, fDeck].map((d) => d.slides.find((sl) => sl.id === '03_within_controls')!.figureHtml);
    check('every style: the massing white in a black line, its roof white', massWalls.every((h) => /<path d="[^"]+" fill="#ffffff" fill-rule="evenodd" stroke="#000000" stroke-width="0\.3"/.test(h)));
    const walls = [heronDeck, kDeck, cDeck].map((d) => d.slides.find((sl) => sl.id === '03_within_controls')!.figureHtml);
    check('no style patterns its walls with squares', ![hp, kp, cp, ...walls].some((h) => h.includes('axo-win') || /<pattern id="axo-/.test(h)));
  }
  const r3f = yieldRows(close).find((r) => r.label === '3F. VISUAL PRIVACY');
  const closePlan = deck(close).slides.find((sl) => isTestPage(sl.id, 'shadow'))!.figureHtml, closeSolar = deck(close).slides.find((sl) => isTestPage(sl.id, 'solar'))!.figureHtml;
  check('shadow: a neighbour white in a black line, no zone\'s colour on it, with its shadow', /fill="#ffffff" stroke="#1c1c1c" stroke-width="0\.3" stroke-linejoin="round"\/>/.test(closePlan)
    && /<g opacity="0\.1" style="mix-blend-mode:multiply"><path d="[^"]+" fill="#3a3c41" fill-rule="nonzero"\/>/.test(closePlan));
  // Z. 2026-11, after the neighbours went black and white: "use colours for zoning for plan and isometry, but only on
  // outlines; don't make very colourful fills or shades". A neighbour is white in a line of its zone's colour, on the
  // plan and in the white model, the zones keyed by their lines; Heron, black and white and one colour, has none.
  {
    const lotOf = (x0: number, x1: number) => [[151.20043 + x0 * m, -33.9], [151.20043 + x1 * m, -33.9], [151.20043 + x1 * m, -33.89955], [151.20043 + x0 * m, -33.89955], [151.20043 + x0 * m, -33.9]];
    const zoned = { ...bundle, context: [{ rings: [east], heightM: 6.2, known: true, controls: { zone: 'R4' } }], parcels: [{ rings: [lotOf(1, 30)], numbers: ['2'], zone: 'R4' }] } as unknown as YieldBundle;
    const zd = deck(zoned), zPlan = zd.slides.find((sl) => isTestPage(sl.id, 'shadow'))!, zIso = zd.slides.find((sl) => sl.id === '03_within_controls')!, zSolar = zd.slides.find((sl) => isTestPage(sl.id, 'solar'))!;
    const line = /<path data-zone-line="1" d="[^"]+" fill="#ffffff" stroke="(#[0-9a-f]{6})" stroke-width="0\.5" stroke-linejoin="round"\/>/.exec(zPlan.figureHtml)?.[1];
    check('zones: on the plan a neighbour white, in a line of its zone\'s colour', !!line && line !== '#1c1c1c' && line !== '#ffffff' && !/fill="#ffffff" stroke="#1c1c1c" stroke-width="0\.3"/.test(zPlan.figureHtml), String(line));
    check('zones: in the white model the same line round the same neighbour, its walls white and grey', [zIso, zSolar].every((sl) => new RegExp(`fill="#[0-9a-f]{6}" stroke="${line}" stroke-width="0\\.3"`).test(sl.figureHtml))
      && !new RegExp(`fill="${line}"`).test(zIso.figureHtml), String(line));
    check('zones: keyed by their lines on each of the three pages', [zPlan, zIso, zSolar].every((sl) => (sl.legend ?? []).some((e) => /^R4\b/.test(e.label) && e.swatch.includes(`stroke="${line}"`) && /fill="none"/.test(e.swatch))
      && (sl.legend ?? []).some((e) => /outlined in its zone's colour/.test(e.label))));
    check('zones: no fill of a zone\'s colour anywhere on the plan', !/data-zone-area/.test(zPlan.figureHtml));
    process.env.YIELD_ZONE_EDGES = '0';
    const plain = deck(zoned).slides.find((sl) => isTestPage(sl.id, 'shadow'))!;
    delete process.env.YIELD_ZONE_EDGES;
    check('zones: the plain outlines are still to be had', !/data-zone-line/.test(plain.figureHtml) && /fill="#ffffff" stroke="#1c1c1c" stroke-width="0\.3"/.test(plain.figureHtml) && !(plain.legend ?? []).some((e) => /zone/.test(e.label)));
    const hz = renderYieldDeck(zoned, meta, { theme: 'heron' }).slides.find((sl) => isTestPage(sl.id, 'shadow'))!;
    check('zones: Heron has no zone\'s line', !/data-zone-line/.test(hz.figureHtml) && !(hz.legend ?? []).some((e) => /zone's colour/.test(e.label)));
  }
  const withLook = <T,>(look: object, f: () => T): T => { process.env.YIELD_SHADOW_LOOK = JSON.stringify(look); try { return f(); } finally { delete process.env.YIELD_SHADOW_LOOK; } };
  // Z. 2026-11, with a contour plot in reds, oranges and pinks and a shadow-range diagram: "can you try to make the
  // shadow on the shadow plan look like this in Canary style?" In Canary the envelope's shadow is contours: each band
  // the ground in it so many of the seven hours, a gradient across it from pink (the morning side) to orange (the
  // afternoon side), palest at one hour, deepest at seven; the hours named at its far end and not outlined.
  {
    const cShade = renderYieldDeck(close, meta, { theme: 'canary' }).slides.find((sl) => isTestPage(sl.id, 'shadow'))!;
    const bandIds = [...cShade.figureHtml.matchAll(/<path data-band="(\d)" d="[^"]+" fill="url\(#plan-band-[^"]+\)" fill-rule="evenodd"/g)].map((x) => Number(x[1]));
    const grads = [...cShade.figureHtml.matchAll(/<linearGradient id="plan-band-[^"]+" gradientUnits="userSpaceOnUse"[^>]*><stop offset="0" stop-color="(#[0-9a-f]{6})"\/><stop offset="1" stop-color="(#[0-9a-f]{6})"\/><\/linearGradient>/g)].map((x) => [x[1], x[2]]);
    const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((t, v) => t + v, 0);
    check('canary shadow: the envelope\'s shadow in four contour bands, palest out to deepest in', bandIds.length === 4 && bandIds.every((k, i) => k === i + 1) && grads.length === bandIds.length
      && grads.every(([from, to], i) => i === 0 || (lum(from) < lum(grads[i - 1][0]) && lum(to) < lum(grads[i - 1][1]))), JSON.stringify({ bandIds, grads }));
    check('canary shadow: each band pink on the morning side, orange on the afternoon side', grads.every(([from, to]) => parseInt(from.slice(5, 7), 16) >= parseInt(to.slice(5, 7), 16) - 4 && parseInt(to.slice(3, 5), 16) >= parseInt(from.slice(3, 5), 16)), JSON.stringify(grads));
    check('canary shadow: not laid in layers of one ink, and its hours named and not outlined', !/<g opacity="0\.15" style="mix-blend-mode:multiply"><path d="[^"]+" fill="[^"]+" fill-rule="evenodd"\/>/.test(cShade.figureHtml)
      && !/stroke-dasharray="1\.2,0\.8"/.test(cShade.figureHtml) && /font-weight="700" fill="#[0-9a-f]{6}">9 AM</.test(cShade.figureHtml));
    check('canary shadow: the key names the bands', (cShade.legend ?? []).some((e) => /in bands: the ground in it one or two hours \(palest\) to all seven \(deepest\); pink on the morning side, orange on the afternoon side/.test(e.label)));
    const swept = withLook({ ownStyle: 'sweep' }, () => renderYieldDeck(close, meta, { theme: 'canary' }).slides.find((sl) => isTestPage(sl.id, 'shadow'))!);
    check('canary shadow, asked for: a sweep, each hour its own colour, outlined and named', (swept.figureHtml.match(/<g data-sweep="1"/g) ?? []).length === 7 && /data-sweep[\s\S]*>10 AM</.test(swept.figureHtml)
      && (swept.legend ?? []).some((e) => /each in its own colour \(pink at 9 am to lilac at 3 pm\)/.test(e.label)));
    check('the other styles keep the hours laid over each other', !/data-band=/.test(closePlan));
    // Z. 2026-11: "swap for Canary". The contours' colours exact swatches of Canary's palette: the pinks of its
    // residential zones and the oranges of its C zones.
    const palette = new Set(['R1', 'R2', 'R3', 'R4', 'R5', 'C1', 'C2', 'C3', 'C4', 'E2', 'E3'].map((z) => zoneFill(z).toLowerCase()));
    check('canary shadow: each band\'s colours a swatch of the palette', grads.flat().every((c) => palette.has(c.toLowerCase())), grads.flat().join(' '));
    // Z. 2026-11, on the massing's grey walls: "try to make a colourful volume shadow here, don't use grey". On a path's
    // own spread each neighbour's walls are shaded toward its zone's colour, what is built toward Canary's light blue;
    // the solar access views keep theirs neutral, their colour the facades' sun.
    {
      const zoned2 = { ...close, context: [{ rings: [east], heightM: 6.2, known: true, controls: { zone: 'R2' } }] } as unknown as YieldBundle;
      const cz = renderYieldDeck(zoned2, meta, { theme: 'canary' });
      const spread = cz.slides.find((sl) => sl.id === '03_within_controls')!.figureHtml, sol = cz.slides.find((sl) => isTestPage(sl.id, 'solar'))!.figureHtml;
      const fills = (h: string) => [...h.matchAll(/<path d="[^"]+" fill="(#[0-9a-f]{6})" stroke="#[0-9a-f]{6}" stroke-width="0\.3"/g)].map((x) => x[1]);
      const hue = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return r - Math.min(g, b); };
      check('iso shade: a neighbour\'s walls shaded toward its zone\'s colour, not grey', fills(spread).some((f) => hue(f) > 20), fills(spread).join(' '));
      check('iso shade: what is built shaded toward a light blue', /fill="#[0-9a-f]{6}" stroke="#000000" stroke-width="0\.3"/.test(spread) && [...spread.matchAll(/<path d="[^"]+" fill="(#[0-9a-f]{6})" stroke="#000000" stroke-width="0\.3"/g)].some((x) => { const [r, , b] = [1, 3, 5].map((i) => parseInt(x[1].slice(i, i + 2), 16)); return b - r > 15; }));
      check('iso shade: the solar access views keep the neighbours neutral', fills(sol).every((f) => hue(f) <= 4), fills(sol).join(' '));
      process.env.YIELD_ISO_SHADE = 'grey';
      const greyed = renderYieldDeck(zoned2, meta, { theme: 'canary' }).slides.find((sl) => sl.id === '03_within_controls')!.figureHtml;
      delete process.env.YIELD_ISO_SHADE;
      check('iso shade: the grey is still to be had', fills(greyed).every((f) => hue(f) <= 4));
    }
    // Z. 2026-11: "make the dims there black". The separations on the plan in black, dashed where only a blank face holds.
    check('canary shadow: the separations black, their distance with what is asked', / fill="#000000" data-dim="1">8\.0 \/ 12 m</.test(cShade.figureHtml)
      && (cShade.legend ?? []).some((e) => /Building separation, apart \/ asked/.test(e.label) && !/#2f8f55|#c8372d|#c98a12/.test(e.swatch)));
    // Z. 2026-11: "try colourful shadow with neighbour buildings too". Asked for, the neighbours' shadows are contours
    // of their own (Canary's blues) under the envelope's, or every building's together as one set of contours.
    const gBlue = withLook({ ground: 'contours', gRamp: 'blue' }, () => renderYieldDeck(close, meta, { theme: 'canary' }).slides.find((sl) => isTestPage(sl.id, 'shadow'))!);
    check('canary shadow, asked for: the neighbours\' shadows as contours of their own, under the envelope\'s', /data-ground-band="1"/.test(gBlue.figureHtml) && /data-band="1"/.test(gBlue.figureHtml)
      && gBlue.figureHtml.indexOf('data-ground-band') < gBlue.figureHtml.indexOf('data-band=') && !/fill-rule="nonzero"/.test(gBlue.figureHtml)
      && (gBlue.legend ?? []).some((e) => /The neighbours' shadows on 21 June, 9 am – 3 pm, in bands/.test(e.label)));
    const gAll = withLook({ ground: 'all' }, () => renderYieldDeck(close, meta, { theme: 'canary' }).slides.find((sl) => isTestPage(sl.id, 'shadow'))!);
    check('canary shadow, asked for: every building\'s shadow as one set of contours, the envelope\'s reach outlined', /data-ground-band="1"/.test(gAll.figureHtml) && !/data-band="1"/.test(gAll.figureHtml)
      && /stroke-dasharray="1\.2,0\.8"/.test(gAll.figureHtml) && (gAll.legend ?? []).some((e) => /Every building's shadow on 21 June, 9 am – 3 pm, in bands/.test(e.label)));
    check('canary shadow: by default the neighbours\' shadows stay grey, hour by hour', !/data-ground-band/.test(cShade.figureHtml) && /fill-rule="nonzero"/.test(cShade.figureHtml));
  }
  check('shadow: the envelope\'s shadow over the neighbours\', in its own colour', new RegExp(`<g opacity="0\\.15" style="mix-blend-mode:multiply"><path d="[^"]+" fill="${accentInk}" fill-rule="evenodd"/>`).test(closePlan)
    && closePlan.indexOf('fill-rule="nonzero"') < closePlan.indexOf(`fill="${accentInk}" fill-rule="evenodd"`));
  // Z. 2026-11: "the building separation needs to be visible in the drawing, don't put it into text". Each separation a
  // dimension on the plan with what is asked of it; no table of them in the text column.
  check('separation: on the drawing, a dimension with what is asked of it; no table of it in the text', / data-dim="1">8\.0 \/ 12 m</.test(closePlan)
    && !/<td>building to the east<\/td>/.test(closePlan) && !/>Building separation<\/div>|<h\d[^>]*>Building separation</.test(closePlan.slice(0, closePlan.indexOf('<svg'))) && /<td>Building separation<\/td>/.test(closePlan),
    closePlan.match(/<text[^>]*data-dim="1">[^<]*</)?.[0]);
  // The plan's other marks are still to be had (YIELD_SHADOW_LOOK overrides the look, for iterations): the hatch on
  // what the envelope adds and the dimensions.
  const shadowOf = (bd: YieldBundle) => deck(bd).slides.find((sl) => isTestPage(sl.id, 'shadow'))!;
  const fullPlan = withLook({ hatch: true, dims: true, shaded: true }, () => shadowOf(close).figureHtml);
  check('shadow, asked for: hatched where only the envelope shades the ground', /<g data-added="1">.*?<clipPath/.test(fullPlan));
  check('shadow, asked for: the dimensions can be left off', !/data-dim/.test(withLook({ dims: false }, () => shadowOf(close).figureHtml)));
  // every massing of the deck a white model, a path's own spread too: no zone's colour in 3D (Z. 2026-11: "for the
  // isometry probably don't show the zoning in 3D, just white neighbour buildings")
  check('the massings a white model, the neighbours white, on the solar access page and on the path\'s own spread', /fill="#ffffff" fill-rule="evenodd" stroke="#8f8f8f" stroke-width="0\.12"/.test(closeSolar)
    && /fill="#ffffff" fill-rule="evenodd" stroke="#8f8f8f" stroke-width="0\.12"/.test(deck(close).slides.find((sl) => sl.id === '03_within_controls')!.figureHtml)
    && !(deck(close).slides.find((sl) => sl.id === '03_within_controls')!.legend ?? []).some((e) => /zone/i.test(e.label))
    && (deck(close).slides.find((sl) => sl.id === '03_within_controls')!.legend ?? []).some((e) => /Neighbours in white at their heights/.test(e.label)));
  check('separation: a building nearer than the separation is short, and the table says so', !!r3f && r3f.ok === false && /1 building within 24 m: 1 short/.test(r3f.proposed?.join(' ') ?? ''), JSON.stringify(r3f));
  const closeComp = deck(close).slides.find((sl) => sl.id === '04_within_controls_shadow_and_separation')!;
  check('separation: the page still marks the criterion, short', /<td>Building separation<\/td>(?:.(?!<\/tr>))*1 short today/.test(closeComp.figureHtml));
  check('separation: no building near, nothing short', yieldRows(bundle).find((r) => r.label === '3F. VISUAL PRIVACY')?.ok === true);
  // the distance is written as a dimension is: turned to its line and standing off it, not across it; over a line that runs
  // across the sheet, and left of one that runs up it, read from the sheet's right (a building 2 m off the north boundary)
  const mN = 1 / 110574;
  const north = [[151.2001, -33.89955 + 2 * mN], [151.2003, -33.89955 + 2 * mN], [151.2003, -33.89955 + 12 * mN], [151.2001, -33.89955 + 12 * mN], [151.2001, -33.89955 + 2 * mN]];
  const dimsOf = (html: string) => [...html.matchAll(/<text transform="translate\([^)]+\) rotate\((-?[\d.]+)\)" y="(-?[\d.]+)"[^>]*data-dim="1">([^<]+)<\/text>/g)].map((d) => ({ turn: Number(d[1]), y: Number(d[2]), label: d[3] }));
  const dims = dimsOf(withLook({ dims: true }, () => shadowOf({ ...bundle, context: [{ rings: [east], heightM: 6.2, known: true }, { rings: [north], heightM: 6.2, known: true }] }).figureHtml));
  check('separation: each distance is written along its dimension line and off it, a line up the sheet read from the right', dims.length === 2 && dims.every((d) => d.y < 0)
    && dims.find((d) => d.label === '8.0 / 12 m')?.turn === 0 && dims.find((d) => d.label !== '8.0 / 12 m')?.turn === -90, JSON.stringify(dims));
  check('separation: no distance is left written across its line', (fullPlan.match(/data-dim="1"/g) ?? []).length === 1 && dimsOf(fullPlan).length === 1);
  const told: YieldBundle = { ...bundle, assumptions: { sun: { hours: 3 } } };
  check('sun: yield_assumptions.json sets the hours', /receive 3 hours direct/.test(JSON.stringify(yieldRows(told))) && /from yield_assumptions\.json/.test(JSON.stringify(yieldRows(told))));
  // a residential lot just south of the site takes its shadow; the parks take none; heritage items, with no outlines, are not measured
  const southLot: Parcel = { rings: [[[151.2, -33.9003], [151.20043, -33.9003], [151.20043, -33.90002], [151.2, -33.90002], [151.2, -33.9003]]], zone: 'R2' };
  const withHome: YieldBundle = { ...bundle, parcels: [southLot] };
  const r3b = yieldRows(withHome).find((r) => r.label === '3B. OVERSHADOWING');
  const said3b = r3b?.proposed?.join(' | ') ?? '';
  check('shadow: a residential lot to the south is shaded, and said so', !!r3b && /homes: [\d,]+ m² at \d/.test(said3b) && /1 lot shaded/.test(said3b) && r3b.ok === null, said3b);
  check('shadow: the parks take none; heritage items not measured without their outlines', /parks: none/.test(said3b) && /heritage items: not measured/.test(said3b), said3b);
  const r3bNone = yieldRows({ ...bundle, parcels: [{ ...southLot, rings: [southLot.rings[0].map(([x, yy]) => [x, yy + 0.0012])] }], heritageItems: [] }).find((r) => r.label === '3B. OVERSHADOWING');
  check('shadow: a lot to the north takes none, and the row is ticked', !!r3bNone && r3bNone.ok === true && /homes: none/.test(r3bNone.proposed?.join(' ') ?? ''), JSON.stringify(r3bNone));
  const json = JSON.parse(yieldJson(bundle));
  check('sun: the JSON carries each drawn path\'s sun', json.sun?.paths?.withinControls?.apartments?.total === s.base.units.total && Array.isArray(json.sun.paths.withinControls.apartments.hours)
    && !!json.sun.paths.envelopeToHeight, JSON.stringify(Object.keys(json.sun?.paths ?? {})));
  check('sun: the CSV states it', /4A\. SOLAR AND DAYLIGHT ACCESS/.test(yieldCsv(bundle)) && /of units with 2 h mid-winter sun/.test(yieldCsv(bundle)));

  // ---- no envelope mapped: a mixed use lot with neither a height of building nor a floor space ratio ----
  // (212 Boorowa Street, Young: Hilltops LEP 2022 maps neither) — the study says so, and draws and ticks nothing.
  const bare: YieldBundle = { ...bundle, controls: { zoneCode: 'MU1', zonePurpose: 'Mixed Use', epiName: 'Test Local Environmental Plan', heritage: [] }, existing: [] };
  const sb = yieldStudy(bare);
  check('no envelope: the study knows why there is no scheme', sb.noScheme === 'noHeight' && sb.base.storeys === 0 && sb.bonus === undefined && sb.max === undefined, JSON.stringify({ why: sb.noScheme, bonus: !!sb.bonus }));
  const bareRows = scenarioRows(bare, sb);
  check('no envelope: the controls\' path is not drawn and takes no mark', bareRows.length === 1 && bareRows[0].id === 'withinControls' && bareRows[0].ok === undefined
    && bareRows[0].storeys === undefined && /NOT DRAWN/.test(bareRows[0].label) && /no height of building and no floor space ratio/.test(bareRows[0].note), JSON.stringify(bareRows));
  const bareDeck = deck(bare);
  check('no envelope: the overview and the controls, no spread of nothing', bareDeck.slides.map((sl) => sl.id).join(',') === '01_planning_yield,02_controls_and_assumptions', bareDeck.slides.map((sl) => sl.id).join(','));
  check('no envelope: nothing reads "0 storeys" or "0 m²"', !/\b0 storeys|\b0 m²|\b0 sqm/.test(bareDeck.html));
  check('no envelope: the narrative says why', /maps no height of building and no floor space ratio at the site/.test(bareDeck.slides[0].narrative ?? ''));
  check('no envelope: no parking or ADG rows ticked against nothing', !yieldRows(bare, sb).some((r) => r.label === 'PARKING' || r.label === 'APARTMENT DESIGN GUIDE'));
  check('no envelope: the overview gives the path no page', /Within the controls<\/td>(?:.(?!<\/tr>))*>—<\/td><\/tr>/.test(bareDeck.html));
  // An RL height over ground of no known level: the height cannot be read in storeys.
  const rlB: YieldBundle = { ...bare, controls: { ...bare.controls, maxHeightM: 52, heightUnits: 'RL', fsr: 2 } };
  const sr = yieldStudy(rlB);
  check('no envelope: an RL over unknown ground is said so, with the ratio\'s floor area', sr.noScheme === 'rlUnknown' && /RL 52/.test(noSchemeSentence(rlB, sr)) && /4,000 m² of floor area/.test(noSchemeSentence(rlB, sr)), noSchemeSentence(rlB, sr));
  // The scheme the lot had keeps its spread and its tick.
  check('no envelope: a mapped height still draws its scheme', yieldStudy(openB).noScheme === undefined && scenarioRows(openB)[0].ok === true);

  // ---- a zone and nothing else: no height, no ratio, no plan's name ----
  // The path within the controls gives no storeys or floor area, and takes no tick in its scenario row, the overview or the CSV.
  const TICK = 'M0.6,2.1 L1.9,3.3 L4.4,0.6';   // the ✓ okMark draws
  const ZERO = /\b0 storeys|\b0 ?m²|\b0 sqm|\b0 ?m to the roof/;
  const pathRow = (html: string) => html.match(/<td>Within the controls<\/td>.*?<\/tr>/)?.[0] ?? '';
  const zoneOnly: YieldBundle = { ...bundle, controls: { zoneCode: 'MU1', heritage: [] }, existing: [] };
  const sz = yieldStudy(zoneOnly);
  const zRows = scenarioRows(zoneOnly, sz);
  const zDeck = deck(zoneOnly), zCsv = yieldCsv(zoneOnly);
  check('zone only: no scheme, and the path within the controls gives no figures and takes no mark', sz.noScheme === 'noHeight' && zRows.length === 1
    && zRows[0].ok === undefined && zRows[0].storeys === undefined && zRows[0].gfa === undefined && sz.bonus === undefined && sz.max === undefined, JSON.stringify(zRows));
  check('zone only: nothing reads "0 storeys" or "0 m²", in the deck or the CSV', !ZERO.test(zDeck.html) && !ZERO.test(zCsv), (zDeck.html + zCsv).match(ZERO)?.[0]);
  check('zone only: the overview\'s row takes no tick', !!pathRow(zDeck.html) && !pathRow(zDeck.html).includes(TICK), pathRow(zDeck.html));
  check('zone only: no path is compliant in the CSV', !/^SCENARIOS,.*,yes\r?$/m.test(zCsv), zCsv.split('\r\n').filter((l) => l.startsWith('SCENARIOS')).join(' | '));
  check('zone only: the narrative says the LEP sets no height or ratio, and leaves the envelope to the DCP',
    /The LEP maps no height of building and no floor space ratio at the site/.test(zDeck.slides[0].narrative ?? '') && /DCP/.test(zDeck.slides[0].narrative ?? ''), zDeck.slides[0].narrative);

  // ---- a zone that takes no building type: the study builds nothing, so the path is not a ticked scheme of 0 m² ----
  const noType: [string, YieldBundle['controls']][] = [
    ['R2 with a height and a ratio', { zoneCode: 'R2', maxHeightM: 8.5, fsr: 0.5, heritage: [] }],
    ['R2 with neither', { zoneCode: 'R2', heritage: [] }],
  ];
  for (const [name, controls] of noType) {
    const nb: YieldBundle = { ...bundle, controls, existing: [] };
    const ns = yieldStudy(nb);
    const nr = scenarioRows(nb, ns).find((r) => r.id === 'withinControls')!;
    const nDeck = deck(nb), row = pathRow(nDeck.html);
    check(`no building type (${name}): the path gives no figures and takes no mark`, ns.base.archetype === 'none' && nr.ok === undefined && nr.storeys === undefined && nr.gfa === undefined
      && !/show this one/.test(nr.note), JSON.stringify(nr));
    check(`no building type (${name}): the overview's row has no tick and no zero`, !!row && !row.includes(TICK) && !/>0<\/td>/.test(row), row);
    check(`no building type (${name}): nothing reads "0 storeys" or "0 m²"`, !ZERO.test(nDeck.html) && !ZERO.test(yieldCsv(nb)), (nDeck.html + yieldCsv(nb)).match(ZERO)?.[0]);
  }

  // ---- a lot too narrow for the setbacks: the height holds storeys, the setbacks leave no plate ----
  // 10 m wide, 30 m deep, 12 m (three storeys): 6 m off each side leaves nothing. The reason is the setbacks, not the height.
  const nLon = 10 / (111320 * Math.cos((-33.9 * Math.PI) / 180)), nLat = 30 / 110574;
  const narrow: YieldBundle = {
    ...bundle, existing: [], siteAreaSqm: 300,
    controls: { zoneCode: 'R4', maxHeightM: 12, heritage: [] },
    siteRing: [[151.21, -33.9], [151.21 + nLon, -33.9], [151.21 + nLon, -33.9 + nLat], [151.21, -33.9 + nLat], [151.21, -33.9]],
  };
  const sn = yieldStudy(narrow), nSay = noSchemeSentence(narrow, sn);
  check('narrow lot: the setbacks, not the height, leave no scheme', sn.noScheme === 'noPlate' && sn.base.storeysByHeight === 3 && sn.base.storeys === 0, JSON.stringify({ why: sn.noScheme, byHeight: sn.base.storeysByHeight }));
  check('narrow lot: the sentence names the storeys the height holds and the setbacks that leave no plate',
    /holds 3 storeys/.test(nSay) && /6 m from the side/.test(nSay) && /no floor plate/.test(nSay) && !/no room for a storey/.test(nSay), nSay);
  const nDeck = deck(narrow);
  check('narrow lot: no spread of nothing, no "0 storeys", no tick on the path', nDeck.slides.map((sl) => sl.id).join(',') === '01_planning_yield,02_controls_and_assumptions'
    && !ZERO.test(nDeck.html) && !pathRow(nDeck.html).includes(TICK), nDeck.slides.map((sl) => sl.id).join(','));
  // What stands on it is not told the LEP maps no envelope: a height is mapped.
  const narrowStanding = deck({ ...narrow, existing: [{ footprintSqm: 120, heightM: 6.2 }] });
  const standsNarr = narrowStanding.slides.find((sl) => /stands_today/.test(sl.id))?.narrative ?? '';
  check('narrow lot: what stands is not told the LEP maps no envelope', !!standsNarr && !/maps no envelope/.test(standsNarr), standsNarr);
  // A height under one storey is still the height's doing.
  const lowB: YieldBundle = { ...bundle, existing: [], controls: { zoneCode: 'R4', maxHeightM: 4, heritage: [] } };
  const lowS = yieldStudy(lowB);
  check('too low: a height under one storey says so', lowS.noScheme === 'tooLow' && /no room for a storey/.test(noSchemeSentence(lowB, lowS)), String(lowS.noScheme));

  // ---- transport oriented development ----
  // In a TOD area of the Housing SEPP, an R2 lot 9.5 m and 0.5:1 under its LEP takes a residential flat building to
  // 22 m and 2.5:1: a path of its own, with its spread and its compliance sheet, the 2% affordable housing named.
  const todB: YieldBundle = { ...bundle, existing: [], policyAtSite: [{ kind: 'tod', name: 'Homebush' }], controls: { zoneCode: 'R2', maxHeightM: 9.5, fsr: 0.5, heritage: [] } };
  const todS = yieldStudy(todB), todRows = scenarioRows(todB, todS), todRow = todRows.find((r) => r.id === 'tod');
  check('TOD: the SEPP lifts an R2 lot to 22 m and 2.5:1, a path of its own', !!todRow && todRow.ok === true && /TOD CONTROLS/.test(todRow.label) && /Homebush TOD area/.test(todRow.note) && /2% of the floor area/.test(todRow.note)
    && !!todS.todY && todS.todY.heightM <= 22 + 1e-6 && todS.todY.gfa <= 2.5 * 2000 + 1 && todS.todY.gfa > 0.5 * 2000, JSON.stringify(todRow));
  const todDeck = deck(todB), todIds = todDeck.slides.map((sl) => sl.id);
  check('TOD: its spread and its two compliance pages', todIds.some((x) => /_tod$/.test(x)) && todIds.some((x) => /_tod_shadow_and_separation$/.test(x)) && todIds.some((x) => /_tod_solar_access$/.test(x)), todIds.join(','));
  const todSpread = todDeck.slides.find((sl) => /_tod$/.test(sl.id))!;
  check('TOD: the spread holds it to the TOD\'s height, ratio, lot width and affordable housing', /22m \(TOD\)/.test(todSpread.figureHtml) && /2\.50:1 \(TOD\)/.test(todSpread.figureHtml) && /Lot width \(TOD\)/.test(todSpread.figureHtml) && /Affordable housing \(TOD\)/.test(todSpread.figureHtml));
  check('TOD: the controls table says what the SEPP permits', yieldRows(todB, todS).some((r) => r.label === 'TRANSPORT ORIENTED DEVELOPMENT' && /residential flat buildings to 22 m/.test((r.controls ?? []).join(' '))));
  // Where the LEP is already more generous, the SEPP lifts nothing: no path, the table says so.
  const richB: YieldBundle = { ...todB, controls: { zoneCode: 'R4', maxHeightM: 30, fsr: 3, heritage: [] } };
  const richS = yieldStudy(richB);
  check('TOD: an LEP more generous than the SEPP stands, and no TOD path', !richS.todY && !scenarioRows(richB, richS).some((r) => r.id === 'tod') && /already match or better/.test(yieldRows(richB, richS).find((r) => r.label === 'TRANSPORT ORIENTED DEVELOPMENT')?.controls?.join(' ') ?? ''));
  // In Ku-ring-gai's Killara precinct the alternative replaced the SEPP's TOD: its maps are the LEP's, named as such.
  const krgB: YieldBundle = { ...bundle, existing: [], policyAtSite: [], station: { name: 'KILLARA RAILWAY STATION', distanceM: 287 },
    controls: { zoneCode: 'R4', maxHeightM: 18.5, fsr: 1.3, lgaName: 'KU-RING-GAI', epiName: 'Ku-ring-gai Local Environmental Plan 2015', heritage: [] } };
  const krgS = yieldStudy(krgB), krgDeck = deck(krgB);
  check('Ku-ring-gai: the alternative TOD read, no TOD path', krgS.tod?.regime === 'alternative' && krgS.tod.name === 'Killara' && !krgS.todY, JSON.stringify(krgS.tod));
  const krgRow = yieldRows(krgB, krgS).find((r) => r.label === 'STATION PRECINCT, ALTERNATIVE TOD');
  check('Ku-ring-gai: the controls table names the alternative, when it began, and what it does not read', !!krgRow && /Ku-ring-gai's Killara station precinct/.test(krgRow.controls!.join(' ')) && /14 November 2025/.test(krgRow.controls!.join(' '))
    && /affordable housing/.test(krgRow.controls!.join(' ')) && /13 June 2025/.test(krgRow.controls!.join(' ')), JSON.stringify(krgRow));
  const krgComp = krgDeck.slides.find((sl) => isTestPage(sl.id, 'solar'))!;
  check('Ku-ring-gai: the yield criterion names the alternative TOD', /Ku-ring-gai's alternative TOD controls/.test(krgComp.figureHtml));
  check('Ku-ring-gai: the spread\'s sources say the LEP\'s are the alternative\'s', /Ku-ring-gai's alternative TOD controls, in force from 14 November 2025/.test(krgDeck.slides.find((sl) => /_within_controls$/.test(sl.id))!.sources ?? ''));
  // Beyond the precinct, or in another council, none of this.
  check('Ku-ring-gai: 900 m out, no precinct', yieldStudy({ ...krgB, station: { name: 'KILLARA RAILWAY STATION', distanceM: 900 } }).tod === undefined);
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('yield: all checks pass');

// PLANNING YIELD — what the controls let the site hold (sheet DA 002's
// successor in the options table), laid out as the site report is.
//
// A3 spreads, the left page for what is said and the right for the
// drawings: first the paths the site may take side by side over the site and
// its neighbours; then a spread for each path — what stands today, the scheme
// within the controls, the affordable housing bonus, the envelope filled to
// the height — its figures, controls, schedule and mix beside its indicative
// massing among the neighbours (each one's future dashed over it) and its
// envelope in plan; last, the development summary's CONTROLS, PROPOSED and
// COMPLIANCE table with the assumptions the study (lib/yield.ts) rests on.
//
// It is a feasibility figure, not a design: the envelope is the controls'
// and the ADG's, the plates are held to a building depth or a tower size, and
// every assumption — floor heights, efficiencies, the mix, the parking rates —
// is printed in the deck and can be changed in `yield_assumptions.json`
// beside the output.

import { esc } from './chrome.js';
import { tpl, withTemplate, templateFor, deckLook, withDeckOptions, tint, type DeckLook } from './template.js';
import { shortStreetName, type SheetMeta } from './sheet.js';
import { atlasPage, deckCss, zFlow, zBlock, zTable, brief, type Slide, type DeckRenderOptions } from './slides.js';
import { INK, zFigures, zBars, niceAxis, fillShape, categoryFill, type Fill } from './atlasKit.js';
import { catById, zoneToCategory } from './model.js';
import { zoneFill } from './lepPalette.js';
import { LEP_OPACITY } from './sheet.js';
import type { LegendEntry } from './minimap.js';
import { estimateKerbs, type KerbLine } from '../lib/kerbs.js';
import type { SummaryData } from './summarySheet.js';
import type { TopoRoad } from '../fetch/nswTopo.js';
import type { PolicyKind } from '../fetch/planning.js';
import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat } from '../lib/geo.js';
import {
  computeYield, computeRetained, edgeKinds, ringArea, withFour, futureHeight, existingSummary, PARKING_RATES, DEFAULT_ASSUMPTIONS, UNIT_KINDS, ADG_MINIMUM,
  type XY, type YieldAssumptions, type YieldResult, type Use, type Tier, type UnitKind, type FutureControls, type ExistingBuilding,
} from '../lib/yield.js';

export interface YieldBundle extends SummaryData {
  generatedAt: string;
  siteAddress: string;
  /** The site's outer boundary, lon/lat, closed. */
  siteRing: [number, number][];
  /** Per edge (siteRing[i] → siteRing[i+1]): the street running along it, if one. */
  frontages: (string | null)[];
  /** The ground at the corners, m AHD, where the contours reach. */
  groundRL?: { min: number; max: number; mean: number };
  /** The nearest railway or light rail station, straight line. */
  station?: { name: string; distanceM: number };
  /** The CBD of The Sydney Plan the site stands in (within 1.5 km of its point). */
  cbd?: { name: string; distanceM: number };
  policyAtSite: { kind: PolicyKind; name: string }[];
  roads: TopoRoad[];
  /** The lots around, with what the plan writes on them. A bundle from before them has `lots` instead. */
  parcels?: Parcel[];
  /** The lots around, as rings (lon/lat): the older bundle's, with nothing on them. */
  lots?: number[][][][];
  /** Indicative kerb lines (lib/kerbs.ts); an older bundle has none, and the plan works them out. */
  kerbs?: KerbLine[];
  /**
   * The neighbours' footprints with their heights, for the massing's context,
   * and what each one's future is read from (lib/yield.ts futureHeight): its
   * zone, height of building, floor space ratio and land. A bundle from
   * before the floor space ratio carries the future itself instead
   * (`futureM`, by the height alone); one from before the futures, neither.
   */
  context: { rings: number[][][]; heightM: number; known: boolean; controls?: FutureControls; futureM?: number }[];
  buildingsSource: string;
  /** What stands on the site today: each building whose centroid is inside the boundary. A bundle from before them has none. */
  existing?: ExistingBuilding[];
  /** From `yield_assumptions.json` beside the output, when there is one. */
  assumptions?: Partial<YieldAssumptions>;
}

/** A lot round about: its rings (lon/lat), its street numbers, and the zone and height of building at it. */
export interface Parcel {
  rings: number[][][];
  numbers?: string[];
  zone?: string;
  hob?: { value: number; units: string };
}

/** The lots, from a bundle of either age. */
const parcelsOf = (b: YieldBundle): Parcel[] => b.parcels ?? (b.lots ?? []).map((rings) => ({ rings }));

// ---- the study --------------------------------------------------------------

export interface YieldStudy {
  base: YieldResult;
  /** The in-fill affordable housing bonus, where the zone takes apartments. */
  bonus?: YieldResult;
  /** The envelope filled to the height, where the floor space ratio stops the base below it. */
  max?: YieldResult;
  /** What stands, rebuilt on its footprints to its height, where that holds more than the controls give. */
  retained?: YieldResult;
  ring: XY[];
  fronts: boolean[];
  toLocal: (lon: number, lat: number) => XY;
  /** The height limit as mapped, and in metres above the ground where it is an RL. */
  hob?: { value: number; rl: boolean; metres?: number };
  parkingSet: keyof typeof PARKING_RATES | 'custom';
  frontageLengths: { name: string; lengthM: number }[];
  /** Each neighbour's future height where it would rise, in the order of the bundle's context. */
  futures: (number | undefined)[];
}

export function yieldStudy(b: YieldBundle): YieldStudy {
  const ringLL = b.siteRing;
  const ms = ringLL.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const n = ms.length > 1 && ms[0].x === ms[ms.length - 1].x && ms[0].y === ms[ms.length - 1].y ? ms.length - 1 : ms.length;
  const cx = ms.slice(0, n).reduce((t, p) => t + p.x, 0) / n, cy = ms.slice(0, n).reduce((t, p) => t + p.y, 0) / n;
  const k = mercatorScaleFactor(mercatorToLonLat({ x: cx, y: cy }).lat);
  const toLocal = (lon: number, lat: number): XY => { const m = lonLatToMercator({ lon, lat }); return { x: (m.x - cx) / k, y: (m.y - cy) / k }; };
  const ring = ms.slice(0, n).map((m) => ({ x: (m.x - cx) / k, y: (m.y - cy) / k }));
  const fronts = ring.map((_, i) => !!b.frontages[i]);

  const c = b.controls;
  const rl = /rl|ahd/i.test(c.heightUnits ?? '');
  const hob = c.maxHeightM ? { value: c.maxHeightM, rl, metres: rl ? (b.groundRL ? c.maxHeightM - b.groundRL.mean : undefined) : c.maxHeightM } : undefined;

  // The parking rates: the Guide's within 800 m of a station (its CBD rates in a CBD), a typical DCP's beyond.
  const near = (b.station?.distanceM ?? Infinity) <= 800;
  const parkingSet: YieldStudy['parkingSet'] = b.assumptions?.parking ? 'custom' : near ? (b.cbd ? 'cbd' : 'subRegional') : 'dcp';
  const assumptions: Partial<YieldAssumptions> = { ...b.assumptions, parking: withFour({ ...(parkingSet === 'custom' ? DEFAULT_ASSUMPTIONS.parking : PARKING_RATES[parkingSet]), ...b.assumptions?.parking }, b.assumptions?.parking) };

  const area = b.siteAreaSqm ?? 0;
  const base = computeYield({ ring, fronts, siteAreaSqm: area, zone: c.zoneCode, hobM: hob?.metres, fsr: c.fsr, assumptions });
  const bonusK = 1 + (assumptions.affordableBonus ?? DEFAULT_ASSUMPTIONS.affordableBonus);
  const bonus = base.archetype === 'residential' || base.archetype === 'mixed'
    ? computeYield({ ring, fronts, siteAreaSqm: area, zone: c.zoneCode, hobM: hob?.metres ? hob.metres * bonusK : undefined, fsr: c.fsr ? c.fsr * bonusK : undefined, assumptions })
    : undefined;
  // The same envelope with no ratio over it, where the ratio is what stops the base.
  const max = base.gfaCapacity > base.gfa + 1
    ? computeYield({ ring, fronts, siteAreaSqm: area, zone: c.zoneCode, hobM: hob?.metres, assumptions })
    : undefined;

  const byName = new Map<string, number>();
  ring.forEach((p, i) => {
    const name = b.frontages[i];
    if (!name) return;
    const q = ring[(i + 1) % ring.length];
    byName.set(name, (byName.get(name) ?? 0) + Math.hypot(q.x - p.x, q.y - p.y));
  });
  const frontageLengths = [...byName].map(([name, lengthM]) => ({ name, lengthM })).sort((p, q) => q.lengthM - p.lengthM);
  const futures = b.context.map((cb) => {
    if (!cb.controls) return cb.futureM;
    const rg = (cb.rings[0] ?? []).map(([lon, lat]) => toLocal(lon, lat));
    return futureHeight(cb.controls, rg.length >= 3 ? ringArea(rg) : 0, cb.known ? cb.heightM : undefined, base.assumptions);
  });
  // What stands, kept or rebuilt to its own envelope: a path only where it holds more than the controls give.
  const standing = (b.existing ?? []).map((e) => ({
    rings: (e.rings ?? []).map((rg) => rg.map(([lon, lat]) => toLocal(lon, lat))).filter((rg) => rg.length >= 3),
    heightM: e.heightM ?? (e.storeys ? e.storeys * base.assumptions.residentialF2F : 0),
  })).filter((e) => e.rings.length && e.heightM > 0);
  const kept = standing.length ? computeRetained({ ring, fronts, siteAreaSqm: area, zone: c.zoneCode, assumptions, standing }) : undefined;
  const retained = kept && kept.gfa > base.gfa + 1 ? kept : undefined;
  return { base, bonus, max, retained, ring, fronts, toLocal, hob, parkingSet, frontageLengths, futures };
}

// ---- the table's rows ---------------------------------------------------------

export interface YieldRow {
  label?: string;
  controls?: string[];
  proposed?: string[];
  /** true complies, false does not, null for a row the design has still to answer. */
  ok?: boolean | null;
  section?: boolean;
  head?: boolean;
}

const fmt = (v: number, dp = 0) => v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const sqm = (v: number) => `${fmt(Math.round(v))} sqm`;
const m1 = (v: number) => `${fmt(v, v % 1 ? 1 : 0)}m`;
const ARCH_WORDS: Record<YieldResult['archetype'], string> = {
  residential: 'Residential flat building',
  mixed: 'Shop-top housing: shops on the ground floor, apartments above',
  commercial: 'Commercial building: offices over a podium',
  none: 'No apartment or commercial building type for this zone',
};
const USE_WORD: Record<Use, string> = { retail: 'retail', residential: 'residential', commercial: 'commercial' };
const titleWords = (t: string) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const rate = (v: number) => (v < 1 && v > 0 && Math.abs(1 / v - Math.round(1 / v)) < 0.01 ? `1 per ${Math.round(1 / v)}` : fmt(v, v % 1 ? 1 : 0));

const UNIT_NAME: Record<UnitKind, string> = { studio: 'Studio', one: '1 Bedroom', two: '2 Bedroom', three: '3 Bedroom', four: '4 Bedroom' };
const UNIT_SHORT: Record<UnitKind, string> = { studio: 'studio', one: '1 bed', two: '2 bed', three: '3 bed', four: '4 bed' };

/** The kinds of apartment the mix has a share of (or that a count landed on), smallest first. */
const inMix = (y: YieldResult): UnitKind[] => UNIT_KINDS.filter((k) => y.assumptions.mix[k] > 0 || y.units[k] > 0);

export function yieldRows(b: YieldBundle, s: YieldStudy = yieldStudy(b)): YieldRow[] {
  const y = s.base, a = y.assumptions, c = b.controls, A = b.siteAreaSqm ?? 0;
  const rows: YieldRow[] = [];
  const apartments = y.archetype === 'residential' || y.archetype === 'mixed';
  const storeyWord = (n: number) => `${n} ${n === 1 ? 'storey' : 'storeys'}`;

  rows.push({ label: 'SITE INFO', section: true });
  rows.push({ label: 'ADDRESS', controls: [b.siteAddress] });
  rows.push({ label: 'DP', controls: [b.lotDescription] });
  rows.push({ label: 'SITE AREA', controls: A ? [sqm(A), '(cadastral boundary, confirm against survey)'] : ['—'] });
  rows.push({ label: 'FRONTAGES', controls: s.frontageLengths.length ? s.frontageLengths.map((f) => `${f.name}: ${fmt(f.lengthM, 1)}m`) : ['No street frontage found along the boundary'] });
  if (b.groundRL) rows.push({ label: 'GROUND LEVEL', controls: [`RL ${b.groundRL.min.toFixed(1)}–${b.groundRL.max.toFixed(1)} AHD at the corners`] });
  const ex = existingSummary(b.existing ?? []);
  if (ex) rows.push({ label: 'STANDS TODAY', controls: [
    `${ex.count === 1 ? 'a building' : `${ex.count} buildings`} of ${ex.storeys ? `~${ex.storeys} storeys${ex.heightM ? ` (${m1(Math.round(ex.heightM * 10) / 10)})` : ''}` : 'unrecorded height'}, ${sqm(ex.footprintSqm)} footprint`,
    'on the site — redevelopment forgoes it (see SCENARIOS)'] });

  rows.push({ label: 'PROJECT SUMMARY', section: true });
  if (y.archetype === 'none') {
    rows.push({ label: 'BUILDING TYPE', controls: [`${c.zoneCode ?? 'The zone'} ${c.zonePurpose ?? ''} takes no residential flat building,`.replace(/\s+/g, ' '), 'shop-top housing or office building: the study gives the', 'floor space ratio\'s floor area alone.'] });
  } else {
    rows.push({ label: 'BUILDING TYPE', controls: [ARCH_WORDS[y.archetype]] });
    if (apartments) rows.push({
      label: 'RESIDENTIAL MIX',
      controls: [
        ...inMix(y).map((k) => `${UNIT_NAME[k]}: ${y.units[k]}`),
        `TOTAL UNITS: ${y.units.total}`,
      ],
    });
    const pct = (v: number) => `${fmt(v * 100, (v * 100) % 1 ? 1 : 0)}%`;
    if (y.gfaByUse.retail) rows.push({ label: 'RETAIL AREA (sqm)', controls: [`${sqm(y.gfaByUse.retail)} GFA, ground floor`, `${sqm(y.gfaByUse.retail * a.retailNlaRatio)} NLA at ${pct(a.retailNlaRatio)}`] });
    if (y.gfaByUse.commercial) rows.push({ label: 'COMMERCIAL AREA (sqm)', controls: [`${sqm(y.gfaByUse.commercial)} GFA`, `${sqm(y.gfaByUse.commercial * a.commercialNlaRatio)} NLA at ${pct(a.commercialNlaRatio)}`] });
    rows.push({ label: 'GROSS FLOOR AREA', controls: [`${sqm(y.gfa)}${A ? ` (FSR ${(y.gfa / A).toFixed(2)}:1)` : ''}`, y.governs === 'fsr' ? 'the floor space ratio governs' : y.governs === 'envelope' ? 'the envelope governs: the FSR is not reached' : 'no FSR is mapped: the height governs'] });
    rows.push({ label: 'BUILDING', controls: [`${storeyWord(y.storeys)}, ${m1(Math.round(y.heightM * 10) / 10)} to the roof${y.storeys < y.storeysByHeight ? ` (the height allows ${y.storeysByHeight})` : ''}`] });
    const kindsOfSpace = [apartments ? `${y.parking.residents} resident, ${y.parking.visitors} visitor` : '', y.parking.nonResidential ? `${y.parking.nonResidential} ${y.gfaByUse.retail ? 'retail' : 'commercial'}` : ''].filter(Boolean).join(', ');
    rows.push({ label: 'CAR PARKING', controls: [
      `${kindsOfSpace}: ${y.parking.total} spaces`,
      `${y.parking.basementLevels} basement ${y.parking.basementLevels === 1 ? 'level' : 'levels'}`] });
  }

  const lep = (c.epiName ?? 'LOCAL ENVIRONMENTAL PLAN').toUpperCase().replace('LOCAL ENVIRONMENTAL PLAN', 'LEP');
  rows.push({ label: lep, section: true });
  rows.push({ head: true });
  rows.push({ label: 'LAND USE', controls: [[c.zoneCode, c.zonePurpose].filter(Boolean).join(' - ') || '—'], proposed: y.archetype === 'none' ? ['—'] : [ARCH_WORDS[y.archetype], 'permissibility to confirm in the land use table'], ok: y.archetype === 'none' ? null : true });
  if (s.hob) {
    const ctl = s.hob.rl ? [`RL ${fmt(s.hob.value, 1)}`, s.hob.metres ? `about ${m1(Math.round(s.hob.metres))} above the ground` : 'ground level unknown'] : [m1(s.hob.value)];
    const top = y.heightM ? (s.hob.rl && b.groundRL ? [`RL ${fmt(b.groundRL.mean + y.heightM, 1)}`, `${m1(Math.round(y.heightM * 10) / 10)}, ${storeyWord(y.storeys)}`] : [`${m1(Math.round(y.heightM * 10) / 10)}, ${storeyWord(y.storeys)}`]) : ['—'];
    rows.push({ label: 'BUILDING HEIGHT', controls: ctl, proposed: top, ok: y.heightM ? y.heightM <= (s.hob.metres ?? Infinity) + 1e-6 : null });
  } else rows.push({ label: 'BUILDING HEIGHT', controls: ['No height of building control mapped'], proposed: ['—'], ok: null });
  rows.push({ label: 'FLOOR SPACE RATIO', controls: [c.fsr ? `${c.fsr.toFixed(2)}:1` : 'No FSR control mapped'], proposed: [A && y.gfa ? `${(y.gfa / A).toFixed(2)}:1` : '—'], ok: c.fsr && y.gfa ? y.gfa <= c.fsr * A + 1 : null });
  rows.push({ label: 'GROSS FLOOR AREA', controls: c.fsr && A ? [sqm(c.fsr * A), `(${c.fsr.toFixed(2)} x ${sqm(A)} site area)`] : ['—'], proposed: y.gfa ? [sqm(y.gfa)] : ['—'], ok: c.fsr && y.gfa ? y.gfa <= c.fsr * A + 1 : null });
  rows.push({ label: 'MIN. LOT SIZE', controls: [c.minLotSizeSqm ? sqm(c.minLotSizeSqm) : 'No minimum lot size mapped'], proposed: [A ? sqm(A) : '—'], ok: c.minLotSizeSqm && A ? A >= c.minLotSizeSqm : null });
  rows.push({ label: 'HERITAGE', controls: c.heritage.length ? c.heritage.map((h) => `${h.name}${h.significance ? ` (${h.significance})` : ''}`) : ['No heritage item mapped on the site'], proposed: c.heritage.length ? ['A heritage impact statement is needed'] : ['—'], ok: c.heritage.length ? null : undefined });

  if (y.archetype !== 'none') {
    const basis = s.parkingSet === 'custom' ? 'from yield_assumptions.json' : PARKING_RATES[s.parkingSet].basis;
    rows.push({ label: 'PARKING', section: true });
    rows.push({ head: true });
    if (apartments) {
      const p = a.parking, u = y.units;
      // Four bedrooms at the three-bedroom rate, as the Guide's "three or more" reads, unless set apart.
      const fourApart = p.four !== p.three;
      rows.push({ label: 'RESIDENTIAL CAR PARKING', controls: [
        `${rate(p.one)} space per studio and 1 bedroom`, `${rate(p.two)} per 2 bedroom, ${rate(p.three)} per 3 bedroom${fourApart ? `, ${rate(p.four)} per 4 bedroom` : ' or more'}`, `(${basis})`],
        proposed: [`${fmt(u.studio + u.one)} x ${fmt(p.one, 1)} + ${fmt(u.two)} x ${fmt(p.two, 1)} + ${fmt(u.three + (fourApart ? 0 : u.four))} x ${fmt(p.three, 1)}${fourApart && u.four ? ` + ${fmt(u.four)} x ${fmt(p.four, 1)}` : ''}`, `= ${y.parking.residents} spaces`], ok: true });
      rows.push({ label: 'VISITOR CAR PARKING', controls: [`${rate(p.visitor)} dwellings`.replace(/^1 per (\d+) dwellings$/, '1 space per $1 dwellings')], proposed: [`= ${y.parking.visitors} spaces`], ok: true });
    }
    if (y.gfaByUse.retail || y.gfaByUse.commercial) rows.push({ label: `${y.gfaByUse.retail ? 'RETAIL' : 'COMMERCIAL'} CAR PARKING`, controls: [`${rate(a.parking.nonResidentialPerSqm)} sqm GFA`.replace(/^1 per (\d+) sqm GFA$/, '1 space per $1 sqm GFA')], proposed: [`= ${y.parking.nonResidential} spaces`], ok: true });
    rows.push({ label: 'BICYCLE PARKING', controls: [apartments ? `${rate(a.bicycles.perDwelling)} per dwelling, ${rate(a.bicycles.visitorPerDwelling)} visitors` : '', y.gfaByUse.retail || y.gfaByUse.commercial ? `${rate(a.bicycles.nonResidentialPerSqm)} sqm of other floor area` : ''].filter(Boolean), proposed: [`= ${y.parking.bicycles} spaces`], ok: true });
    rows.push({ label: 'MOTORCYCLE PARKING', controls: [`1 space per ${a.motorcycleEvery} car spaces`], proposed: [`= ${y.parking.motorcycles} spaces`], ok: true });
    rows.push({ label: 'BASEMENT', controls: [`${a.basementSqmPerSpace} sqm a car space with its aisles,`, `${Math.round(a.basementCoverage * 100)}% of the site a level`], proposed: [`${y.parking.total} spaces: ${y.parking.basementLevels} ${y.parking.basementLevels === 1 ? 'level' : 'levels'}`] });
  }

  if (apartments) {
    rows.push({ label: 'APARTMENT DESIGN GUIDE', section: true });
    rows.push({ head: true });
    const held = y.tiers.some((t) => t.held === 'depth');
    rows.push({ label: '2E. BUILDING DEPTH', controls: ['12–18m glass line to glass line'], proposed: [held ? `plates held to ${m1(a.maxDepth)} deep` : 'the envelope is within the depth'], ok: true });
    rows.push({ label: '3D. COMMUNAL OPEN SPACE', controls: ['Minimum 25% of the site', `= ${sqm(y.adg.communalOpenSpaceSqm)}`], proposed: ['on the podium roof or the ground: to design'], ok: null });
    const ds = y.adg.deepSoil;
    rows.push({ label: '3E. DEEP SOIL ZONE', controls: [`7% of the site${ds.minDimension ? `, ${ds.minDimension}m minimum dimension` : ''}`, `= ${sqm(ds.requiredSqm)}`], proposed: ds.possible ? [`${sqm(ds.groundFreeSqm)} of the site is clear of the ground floor`, 'the basement must stay out of it'] : ['not within this envelope:', 'ADG 3E allows alternatives in centres'], ok: ds.possible });
    rows.push({ label: '3F. VISUAL PRIVACY', controls: [`${a.adgSide4}m to side and rear boundaries to 4 storeys,`, `${a.adgSide8}m to 8 storeys, ${a.adgSide9}m above`], proposed: ['built into the envelope'], ok: true });
    rows.push({ label: '4A. SOLAR AND DAYLIGHT ACCESS', controls: ['70% of apartments receive 2 hours direct', 'sunlight 9 am – 3 pm at mid winter'], proposed: ['to be tested in design'], ok: null });
    rows.push({ label: '4B. NATURAL VENTILATION', controls: ['60% of apartments cross ventilated', 'in the first nine storeys'], proposed: ['to be tested in design'], ok: null });
    const kinds = inMix(y);
    rows.push({ label: '4D. APARTMENT SIZE', controls: ['Studio 35, 1 bed 50, 2 bed 70, 3 bed 90 sqm,', '12 sqm more a bedroom over three (+5 sqm for a second bathroom)'],
      proposed: [`${kinds.map((k) => `${UNIT_SHORT[k]} ${fmt(a.sizes[k])}`).join(', ')} sqm assumed`], ok: kinds.every((k) => a.sizes[k] >= ADG_MINIMUM[k]) });
  }

  const tod = b.policyAtSite.find((p) => p.kind === 'tod' || p.kind === 'todAccelerated');
  if (s.bonus || tod) {
    rows.push({ label: 'HOUSING SEPP', section: true });
    if (s.bonus) {
      const x = s.bonus;
      const pct = Math.round((a.affordableBonus) * 100);
      rows.push({ label: 'IN-FILL AFFORDABLE HOUSING', controls: [`Up to ${pct}% more FSR and height where at`, 'least 15% of the GFA is affordable housing', 'for 15 years (eligibility to confirm)'],
        proposed: x.gfa <= y.gfa + 1
          ? ['no gain here: the envelope, not the FSR or the height, governs']
          : [`${sqm(x.gfa)} GFA, ${storeyWord(x.storeys)}`, `${x.units.total} units, about ${Math.round(x.units.total * 0.15)} affordable`] });
    }
    if (tod) rows.push({ label: 'TRANSPORT ORIENTED DEVELOPMENT', controls: [`The site is in the ${tod.name} TOD area:`, 'the SEPP\'s TOD controls may apply in place', 'of the LEP\'s (Housing SEPP chapter 5)'] });
  }
  return rows;
}

/** A tier's number in its ring: the plan's mark, and the schedule's key to it. */
function tierBadge(x: number, y: number, n: number, r = 2): string {
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="#ffffff" stroke="${ENVELOPE}" stroke-width="0.25"/>` +
    `<text x="${x.toFixed(2)}" y="${(y + r * 0.47).toFixed(2)}" text-anchor="middle" font-size="${(r * 1.3).toFixed(2)}" font-weight="700" fill="${ENVELOPE}">${n}</text>`;
}

// ---- the drawings ------------------------------------------------------------------

/** Each use's colour in the massing and the plan: the legacy deck's three, or the style's own tints for the residential, retail and commercial land. */
const USE_FILL: Record<Use, string> = { residential: '#f0c9a6', retail: '#e69ea1', commercial: '#a9cfe9' };
const USE_CATEGORY: Record<Use, string> = { residential: 'r4', retail: 'retail', commercial: 'commercial' };
function useFill(u: Use): string {
  const look = deckLook();
  if (look.legacy) return USE_FILL[u];
  const c = catById()[USE_CATEGORY[u]];
  return c ? tint(c.fill, Math.min(1, c.opacity + 0.2)) : USE_FILL[u];
}
const CONTEXT_FILL = '#e9e9e6', CONTEXT_EDGE = '#a3a39e';
/** The site's pen: the legacy's red, or the style's accent. */
const siteInk = () => { const look = deckLook(); return look.legacy ? SITE_RED : look.accent; };
/** The lot in a zone, as the style's context sheet tints the land: its category's fill and texture, or its ePlanning colour; nothing under the legacy deck, whose plan is black and grey. */
function lotFill(zone: string | undefined, look: DeckLook): { key: string; fill: Fill } | null {
  if (look.legacy || !zone) return null;
  if (look.zones === 'lep') return { key: zone.toUpperCase(), fill: { bg: tint(zoneFill(zone), LEP_OPACITY) } };
  const cat = zoneToCategory(zone), c = cat ? catById()[cat] : undefined;
  return c ? { key: c.id, fill: categoryFill(c, 'paper') } : null;
}
/** A neighbour's future, over what stands: a pale glass, dashed, light enough to see the proposal through. */
const FUTURE_FILL = '#e4ebf3', FUTURE_EDGE = '#8495a8', FUTURE_OPACITY = 0.3, FUTURE_DASH = '1.4,0.8';
const SITE_RED = '#c8372d', ENVELOPE = '#5b6670';
/** What stands on the site today, where a scenario keeps it. */
const STANDING_FILL = '#c9c7c0';

/** What a page draws on the site: a scheme of the study's, or what stands there today, or neither (the site alone). */
interface Scheme { y?: YieldResult; standing?: { rings: XY[][]; heightM?: number; storeys?: number }[] }

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}

/** The storey heights the study builds to: the bottom and the top of storey s. */
function storeyZ(y: YieldResult): { bottom: (s: number) => number; top: (s: number) => number } {
  const a = y.assumptions;
  const g = y.archetype === 'mixed' ? a.groundRetailF2F : y.archetype === 'commercial' ? a.commercialF2F : a.residentialF2F;
  const t = y.archetype === 'commercial' ? a.commercialF2F : a.residentialF2F;
  return { bottom: (s) => (s <= 1 ? 0 : g + (s - 2) * t), top: (s) => g + (s - 1) * t };
}

interface Prism { rings: XY[][]; z0: number; z1: number; fill: string; edge: string; edgeW: number; storeys?: number[]; dashed?: boolean; dash?: string; opacity?: number }

/**
 * The axonometric: the camera stands off the main frontage's corner, looking
 * down 35°, so the street front and one side face the reader. Solids are drawn
 * far to near, faces turned from the camera left out; the envelope and the
 * height plane go over them as dashed lines.
 */
function axonometric(b: YieldBundle, s: YieldStudy, box: { x: number; y: number; w: number; h: number }, scheme: Scheme, id: string): string {
  const y = scheme.y;
  const kinds = edgeKinds(s.ring, s.fronts);
  // The main frontage's outward normal; the camera stands out along it, turned 40° to take in a side.
  let signed = 0;
  for (let i = 0; i < s.ring.length; i++) { const u = s.ring[i], v = s.ring[(i + 1) % s.ring.length]; signed += u.x * v.y - v.x * u.y; }
  let nx = 0, ny = -1, best = -1;
  s.ring.forEach((p, i) => {
    if (kinds[i] !== 'front') return;
    const q = s.ring[(i + 1) % s.ring.length], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy);
    if (l > best) { best = l; nx = signed > 0 ? dy / l : -dy / l; ny = signed > 0 ? -dx / l : dx / l; }
  });
  const turn = (40 * Math.PI) / 180;
  const cam = { x: nx * Math.cos(turn) - ny * Math.sin(turn), y: nx * Math.sin(turn) + ny * Math.cos(turn) };
  const d = { x: -cam.x, y: -cam.y };                 // the view direction, horizontal
  const r = { x: d.y, y: -d.x };                       // the screen's right
  const elev = (35 * Math.PI) / 180, sinE = Math.sin(elev), cosE = Math.cos(elev);
  const P = (p: XY, z: number): [number, number] => [p.x * r.x + p.y * r.y, -((p.x * d.x + p.y * d.y) * sinE + z * cosE)];
  const depth = (p: XY) => p.x * d.x + p.y * d.y;

  // What is drawn: the neighbours within reach, the built tiers, the envelope and the height plane.
  const reach = Math.max(...s.ring.map((p) => Math.hypot(p.x, p.y))) + 70;
  const prisms: { key: number; group: Prism[] }[] = [];
  b.context.forEach((cb, i) => {
    const rings = [cb.rings[0]?.map(([lon, lat]) => s.toLocal(lon, lat)) ?? []].filter((rg) => rg.length >= 3);
    if (!rings.length) return;
    const cen = rings[0].reduce((t, p) => ({ x: t.x + p.x / rings[0].length, y: t.y + p.y / rings[0].length }), { x: 0, y: 0 });
    if (Math.hypot(cen.x, cen.y) > reach) return;
    const z1 = cb.known ? cb.heightM : 6.2;
    const group: Prism[] = [{ rings, z0: 0, z1, fill: CONTEXT_FILL, edge: CONTEXT_EDGE, edgeW: 0.12, dashed: !cb.known }];
    // What it may rise to under its own controls, over what stands.
    const future = s.futures[i];
    if (future && future > z1) group.push({ rings, z0: z1, z1: future, fill: FUTURE_FILL, edge: FUTURE_EDGE, edgeW: 0.12, dashed: true, dash: FUTURE_DASH, opacity: FUTURE_OPACITY });
    prisms.push({ key: depth(cen), group });
  });
  const z = y ? storeyZ(y) : undefined;
  const built: Prism[] = [];
  if (y && z) for (const t of y.tiers) {
    const top = Math.min(t.to, y.storeys);
    if (top < t.from || !t.plate.length) continue;
    built.push({ rings: t.plate, z0: z.bottom(t.from), z1: z.top(top), fill: useFill(t.use), edge: '#3a3a3a', edgeW: 0.16, storeys: Array.from({ length: top - t.from }, (_, i) => z.top(t.from + i)) });
  }
  // What stands, at its recorded height, its storeys ruled; one with none recorded at a nominal two, dashed.
  for (const e of scheme.standing ?? []) {
    const known = !!(e.heightM || e.storeys);
    const top = e.heightM ?? (e.storeys ? e.storeys * 3.1 : 6.2);
    const n = e.storeys ?? Math.max(1, Math.round(top / 3.1));
    built.push({ rings: e.rings, z0: 0, z1: top, fill: STANDING_FILL, edge: '#3a3a3a', edgeW: 0.16, dashed: !known, storeys: Array.from({ length: n - 1 }, (_, i) => ((i + 1) * top) / n) });
  }
  prisms.push({ key: 0, group: built });
  prisms.sort((p, q) => q.key - p.key);

  // Light from the north-west and above: a face is lit by how squarely it turns to it.
  const light = { x: -0.55, y: 0.83 };
  const parts: string[] = [];
  const poly = (pts: [number, number][]) => `M${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}Z`;
  // The ground: the lots round about and the site.
  const ground: string[] = [];
  for (const lot of parcelsOf(b)) for (const rg of lot.rings) {
    const pts = rg.map(([lon, lat]) => s.toLocal(lon, lat));
    if (pts.some((p) => Math.hypot(p.x, p.y) > reach + 20)) continue;
    ground.push(`<path d="${poly(pts.map((p) => P(p, 0)))}" fill="none" stroke="#c9c9c4" stroke-width="0.12"/>`);
  }
  const SITE = siteInk();
  ground.push(`<path d="${poly(s.ring.map((p) => P(p, 0)))}" fill="${SITE}" fill-opacity="0.08" stroke="${SITE}" stroke-width="0.35"/>`);
  const prismSvg = (pr: Prism) => {
    const out: string[] = [];
    const dash = pr.dashed ? ` stroke-dasharray="${pr.dash ?? '0.8,0.6'}"` : '';
    const alpha = pr.opacity != null ? ` fill-opacity="${pr.opacity}"` : '';
    for (const rg of pr.rings) {
      let sa = 0;
      for (let i = 0; i < rg.length; i++) { const u = rg[i], v = rg[(i + 1) % rg.length]; sa += u.x * v.y - v.x * u.y; }
      const faces = rg.map((p, i) => {
        const q = rg[(i + 1) % rg.length], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        const m = sa > 0 ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
        return { p, q, m, mid: depth({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) };
      }).filter((f) => f.m.x * d.x + f.m.y * d.y < 0).sort((f, g) => g.mid - f.mid);
      for (const f of faces) {
        const lit = 0.72 + 0.28 * Math.max(0, f.m.x * light.x + f.m.y * light.y);
        out.push(`<path d="${poly([P(f.p, pr.z0), P(f.q, pr.z0), P(f.q, pr.z1), P(f.p, pr.z1)])}" fill="${shade(pr.fill, lit)}"${alpha} stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${dash}/>`);
        for (const zz of pr.storeys ?? []) {
          const [x1, y1] = P(f.p, zz), [x2, y2] = P(f.q, zz);
          out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${shade(pr.fill, 0.62)}" stroke-width="0.08"/>`);
        }
      }
    }
    out.push(`<path d="${pr.rings.map((rg) => poly(rg.map((p) => P(p, pr.z1)))).join('')}" fill="${shade(pr.fill, 1.12)}"${alpha} fill-rule="evenodd" stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${dash}/>`);
    return out.join('');
  };
  // The outer edge of what the prisms cover on paper: every face, joined.
  const silhouette = (group: Prism[]): string => {
    const faces: number[][][][] = [];
    const add = (pts: [number, number][]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u[0] * v[1] - v[0] * u[1]; }
      if (Math.abs(a) > 1e-6) faces.push([[...pts, pts[0]]]);
    };
    for (const pr of group) for (const rg of pr.rings) {
      add(rg.map((p) => P(p, pr.z1)));
      rg.forEach((p, i) => { const q = rg[(i + 1) % rg.length]; add([P(p, pr.z0), P(q, pr.z0), P(q, pr.z1), P(p, pr.z1)]); });
    }
    if (!faces.length) return '';
    try {
      const joined = turfUnion(featureCollection(faces.map((f) => polygon(f)))) as any;
      const g = joined?.geometry;
      const rings: number[][][] = g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : [];
      return `<path d="${rings.map((rg) => poly(rg.slice(0, -1) as [number, number][])).join('')}" fill="none" stroke="#2e2e2e" stroke-width="0.24" stroke-linejoin="round"/>`;
    } catch { return ''; }
  };
  for (const { group } of prisms) for (const pr of group) parts.push(prismSvg(pr));
  // The proposal's outline over everything, so a future neighbour in front of it does not lose it.
  if (s.futures.some(Boolean)) parts.push(silhouette(built));

  // The envelope each tier is allowed, dashed at its top; the height plane over the site.
  const over: string[] = [];
  if (y && z) for (const t of y.tiers) {
    const zt = z.top(t.to);
    for (const rg of t.envelope) over.push(`<path d="${poly(rg.map((p) => P(p, zt)))}" fill="none" stroke="${ENVELOPE}" stroke-width="0.22" stroke-dasharray="1.6,1"/>`);
  }
  if (s.hob?.metres) {
    const hz = s.hob.metres;
    over.push(`<path d="${poly(s.ring.map((p) => P(p, hz)))}" fill="${SITE}" fill-opacity="0.05" stroke="${SITE}" stroke-width="0.3" stroke-dasharray="2.4,1.2"/>`);
    for (const p of s.ring) { const [x1, y1] = P(p, 0), [x2, y2] = P(p, hz); over.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${SITE}" stroke-width="0.12" stroke-dasharray="1,1"/>`); }
  }

  // Fit it all to the box. A height plane far above everything built (an
  // airspace RL in a CBD) is not fitted: it runs out of the frame, and the
  // frame says where it is. Nor is a neighbour's future far above what
  // stands: it is cut at the same height, so a CBD's towers-to-be do not
  // shrink the proposal to a speck, and the frame says how high they go.
  const pts: [number, number][] = [];
  let tallest = 0;
  for (const { group } of prisms) for (const pr of group) if (pr.fill !== FUTURE_FILL) tallest = Math.max(tallest, pr.z1);
  const cap = Math.max(tallest, 12) * 1.6;
  let futureTop = 0;
  for (const { group } of prisms) for (const pr of group) {
    const z1 = pr.fill === FUTURE_FILL ? Math.min(pr.z1, cap) : pr.z1;
    if (pr.fill === FUTURE_FILL) futureTop = Math.max(futureTop, pr.z1);
    for (const rg of pr.rings) for (const p of rg) pts.push(P(p, pr.z0), P(p, z1));
  }
  const planeZ = s.hob?.metres ?? 0;
  const planeFits = planeZ <= cap;
  for (const p of s.ring) pts.push(P(p, 0), P(p, planeFits ? planeZ : Math.max(tallest, 12) * 1.25));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min(box.w / (x1 - x0 || 1), box.h / (y1 - y0 || 1));
  const tx = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k, ty = box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  // Strokes are set in sheet millimetres: divide them back out of the scale.
  const note = (line: number, ink: string, text: string) =>
    `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + 4 + line * 4).toFixed(1)}" text-anchor="middle" font-size="2.8" fill="${ink}" stroke="#ffffff" stroke-width="1.4" paint-order="stroke">${esc(text)}</text>`;
  const notes: string[] = [];
  if (s.hob?.metres && !planeFits) notes.push(note(notes.length, SITE, `HEIGHT OF BUILDING PLANE ${s.hob.rl ? `RL ${fmt(s.hob.value, 1)}, ` : ''}${fmt(Math.round(planeZ))}m ABOVE THE GROUND, ABOVE THE FRAME`));
  if (futureTop > cap) notes.push(note(notes.length, FUTURE_EDGE, `NEIGHBOURS' FUTURE HEIGHTS RUN ABOVE THE FRAME, TO ${fmt(Math.round(futureTop))}m`));
  const above = notes.join('');
  return `<defs><clipPath id="axo-${id}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>
    <g clip-path="url(#axo-${id})"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})">
    <g style="vector-effect:non-scaling-stroke">${ground.join('')}${parts.join('')}${over.join('')}</g></g></g>${above}`;
}

const KERB_INK = '#8a8a8a', LOT_INK = '#b4b4ae', STREET_INK = '#555555';

/** "26", or "26–30" for a lot with a run of numbers, ranged or one by one. */
function numberLine(nums: string[]): string {
  if (nums.length <= 1) return (nums[0] ?? '').replace('-', '–');
  const ints = nums.flatMap((t) => t.split('-')).map((t) => parseInt(t, 10));
  if (!ints.every((v) => Number.isFinite(v))) return nums[0];
  const lo = Math.min(...ints), hi = Math.max(...ints);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** "HOB = 18m", or "HOB = RL 45" where the plan limits height by level, as the site analysis writes it. */
const hobLine = (h: { value: number; units: string }) => {
  const fig = h.value % 1 ? h.value.toFixed(1) : String(h.value);
  return /rl|ahd/i.test(h.units) ? `HOB = RL ${fig}` : `HOB = ${fig}m`;
};

interface PlanResult { svg: string; scale: number; kerbs: KerbLine[] }

/**
 * The envelope in plan, north up, at a round scale, on the ground the site
 * analysis draws, kept to black and grey: the lot lines, the kerbs, the
 * buildings, and in each neighbour's building its street number, zone and
 * height of building; the street names along the roads. Over it each tier's
 * envelope and plate, numbered.
 */
/**
 * `room` is how much wider than the site the plan is drawn; `inset` keeps
 * the north and the bar off the page's edge where the plan runs to it, and
 * `keepOut` holds the boxes (sheet millimetres) a label laid over it covers.
 */
function planView(b: YieldBundle, s: YieldStudy, box: { x: number; y: number; w: number; h: number }, scheme: Scheme, id: string,
  opts: { room?: number; inset?: number; keepOut?: [number, number, number, number][] } = {}): PlanResult {
  const room = opts.room ?? 1.35, inset = opts.inset ?? 0;
  const y = scheme.y;
  const xs = s.ring.map((p) => p.x), ys = s.ring.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const scale = [100, 200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000].find((sc) => (w * room * 1000) / sc <= box.w && (h * room * 1000) / sc <= box.h) ?? 5000;
  const mm = 1000 / scale;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const at = (p: XY): [number, number] => [box.x + box.w / 2 + (p.x - cx) * mm, box.y + box.h / 2 - (p.y - cy) * mm];
  const P = (p: XY): string => at(p).map((v) => v.toFixed(2)).join(',');
  const path = (rg: XY[]) => `M${rg.map(P).join('L')}Z`;
  const line = (rg: XY[]) => `M${rg.map(P).join('L')}`;
  const local = (rg: number[][]) => rg.map(([lon, lat]) => s.toLocal(lon, lat));
  // What is written is kept apart: each word's box, in sheet millimetres.
  type Box = [number, number, number, number];
  const taken: Box[] = [...(opts.keepOut ?? [])];
  const clear = (bx: Box) => bx[0] >= box.x + 1 && bx[2] <= box.x + box.w - 1 && bx[1] >= box.y + 1 && bx[3] <= box.y + box.h - 1
    && !taken.some((t) => bx[0] < t[2] && bx[2] > t[0] && bx[1] < t[3] && bx[3] > t[1]);
  const out: string[] = [];

  // The ground: the lot lines and the kerbs. Each lot, and each building, is
  // also cut to the frame, for where a label can go.
  const fx = box.w / 2 / mm, fy = box.h / 2 / mm;
  const inFrame = (rg: XY[]) => clipRect(rg, cx - fx, cy - fy, cx + fx, cy + fy);
  const centre = (rg: XY[]) => rg.reduce((t, p) => ({ x: t.x + p.x / rg.length, y: t.y + p.y / rg.length }), { x: 0, y: 0 });
  const parcels = parcelsOf(b).map((pc) => {
    const rings = pc.rings.map(local);
    const shown = rings.map(inFrame).filter((rg) => rg.length >= 3);
    return { ...pc, local: rings, shown, site: inRing(centre(rings[0] ?? []), s.ring) };
  });
  const look = deckLook(), t = tpl();
  const within = (p: XY, rs: XY[][]) => rs.filter((rg) => inRing(p, rg)).length % 2 === 1;
  // Under a style, each lot in its zone's tint, as the style's context sheet
  // tints the land, the lots alone so the streets stay white; the site is
  // left to its own marks. The legacy plan is black and grey.
  if (!look.legacy) {
    const byKey = new Map<string, { fill: Fill; ds: string[] }>();
    for (const pc of parcels) {
      if (pc.site) continue;
      const lf = lotFill(pc.zone, look);
      if (!lf) continue;
      (byKey.get(lf.key) ?? byKey.set(lf.key, { fill: lf.fill, ds: [] }).get(lf.key)!).ds.push(...pc.local.map(path));
    }
    const bb = { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h };
    for (const { fill, ds } of byKey.values()) out.push(fillShape(ds.join(''), bb, fill));
  }
  const lotLine = look.legacy ? `stroke="${LOT_INK}" stroke-width="0.15"` : look.lots === 'white' ? 'stroke="#ffffff" stroke-width="0.3"' : `stroke="${t.road}" stroke-width="0.15" opacity="0.6"`;
  out.push(`<path d="${parcels.flatMap((pc) => pc.local.map(path)).join('')}" fill="none" ${lotLine}/>`);
  let kerbs = b.kerbs;
  if (!kerbs) {
    try { kerbs = estimateKerbs(parcels.flatMap((pc) => pc.rings), b.roads, [], []); } catch { kerbs = []; }
  }
  if (kerbs.length) out.push(`<path d="${kerbs.map((kl) => line(local(kl.coords))).join('')}" fill="none" stroke="${KERB_INK}" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"/>`);
  const blds = b.context.map((cb) => local(cb.rings[0] ?? [])).filter((rg) => rg.length >= 3);
  // The buildings as the style draws them: white in a hairline of their
  // zone family's ink, filled in the family's colour with a white edge, or
  // a quiet grey (the legacy, and the aerial styles with no photograph here).
  for (const rg of blds) {
    const zone = look.legacy || look.buildings === 'grey' ? undefined : parcels.find((pc) => !pc.site && within(centre(rg), pc.local))?.zone;
    const cat = zone ? zoneToCategory(zone) : null, c = cat ? catById()[cat] : undefined;
    const ink = c?.figure ?? c?.stroke ?? (look.buildings === 'white' ? t.road : '#d9d9d6');
    out.push(look.legacy || look.buildings === 'grey' ? `<path d="${path(rg)}" fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.12"/>`
      : look.buildings === 'white' ? `<path d="${path(rg)}" fill="#ffffff" stroke="${ink}" stroke-width="0.3" stroke-linejoin="round"/>`
        : `<path d="${path(rg)}" fill="${ink}" stroke="#ffffff" stroke-width="0.3" stroke-linejoin="round"/>`);
  }

  // What stands on the site, where the scheme is what stands.
  for (const e of scheme.standing ?? []) out.push(`<path d="${e.rings.map(path).join('')}" fill="${STANDING_FILL}" fill-rule="evenodd" stroke="#3a3a3a" stroke-width="0.2"/>`);
  // The study: the plates, widest tier first so the narrower ones over it stay visible; each tier's envelope; the site.
  const tiers = y ? [...y.tiers].sort((p, q) => q.envelopeSqm - p.envelopeSqm) : [];
  for (const t of tiers) {
    const built = t.from <= y!.storeys;
    if (t.plate.length) out.push(`<path d="${t.plate.map(path).join('')}" fill="${useFill(t.use)}" fill-opacity="${built ? 0.55 : 0.18}" fill-rule="evenodd" stroke="none"/>`);
  }
  y?.tiers.forEach((t, i) => { for (const rg of t.envelope) out.push(`<path d="${path(rg)}" fill="none" stroke="${ENVELOPE}" stroke-width="0.3" stroke-dasharray="${['2,1', '1.2,1.2', '3,1,0.8,1', '0.6,0.9'][i % 4]}"/>`); });
  out.push(`<path d="${path(s.ring)}" fill="none" stroke="${siteInk()}" stroke-width="0.6" stroke-dasharray="3,1.2"/>`);

  // North, and a bar of round metres, first: what is written later keeps off them.
  const nx = box.x + box.w - 7 - inset, ny = box.y + 8 + inset;
  out.push(`<g transform="translate(${nx},${ny})"><path d="M0,-4.4 L1.6,3.6 L0,2 L-1.6,3.6 Z" fill="#1c1c1c"/><text y="-5.6" text-anchor="middle" font-size="2.8" font-weight="700">N</text></g>`);
  taken.push([nx - 4, ny - 9, nx + 4, ny + 5]);
  const bar = [5, 10, 20, 50, 100].find((m) => m * mm >= 18) ?? 100;
  const bx = box.x + 2 + inset, by = box.y + box.h - 3 - inset;
  out.push(`<path d="M${bx},${by - 1.4} V${by} H${bx + bar * mm} V${by - 1.4} M${bx + (bar * mm) / 2},${by} V${by - 0.8}" fill="none" stroke="#1c1c1c" stroke-width="0.25"/><text x="${bx}" y="${by - 2.2}" font-size="2.4">0</text><text x="${(bx + bar * mm).toFixed(2)}" y="${by - 2.2}" text-anchor="middle" font-size="2.4">${bar}m</text>`);
  taken.push([bx - 1, by - 5, bx + bar * mm + 4, by + 1]);

  // Each tier's number in the band of the envelope that is its own, keyed to
  // the schedule, drawn toward the middle of the main street frontage so the
  // numbers read in from the street.
  const R = 2.2;
  const placed: XY[] = [];
  const anchor = frontageMiddle(s.ring, b.frontages);
  y?.tiers.forEach((t, i) => {
    const spot = tierSpot(t.envelope, y.tiers.slice(i + 1).flatMap((u) => u.envelope), placed, (R + 0.5) / mm, (2 * R + 1) / mm, t.plate, anchor);
    if (!spot) return;
    placed.push(spot);
    const [px, py] = at(spot);
    out.push(tierBadge(px, py, i + 1, R));
    taken.push([px - R - 0.4, py - R - 0.4, px + R + 0.4, py + R + 0.4]);
  });

  // The street names, as the site analysis sets them: bold, along the chord
  // through the middle of the road's longest run in the frame, slid along it
  // until clear of what is written.
  const FS = 2.8;
  const runs = new Map<string, { pts: [number, number][]; len: number }>();
  for (const r of b.roads) {
    if (!r.name) continue;
    const pts = local(r.coords).map(at).filter(([px, py]) => px > box.x - 20 && px < box.x + box.w + 20 && py > box.y - 20 && py < box.y + box.h + 20);
    if (pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const cur = runs.get(r.name);
    if (!cur || len > cur.len) runs.set(r.name, { pts, len });
  }
  const named = new Set<string>();
  const defs: string[] = [];
  for (const [name, r] of runs) {
    const label = shortStreetName(name).toUpperCase();
    const textLen = label.length * (FS * 0.62 + 0.5) + 2;
    const cum = [0];
    for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total < textLen) continue;
    const along = (d: number): [number, number] => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * t, r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * t];
    };
    const half = Math.min(total / 2, textLen / 2 + 6);
    for (const k of [0, 1, -1, 2, -2, 3, -3]) {
      const c = total / 2 + k * 12;
      if (c - half < 0 || c + half > total) continue;
      let p0 = along(c - half), p1 = along(c + half);
      if (p0[0] > p1[0]) [p0, p1] = [p1, p0];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < textLen) continue;
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const W = Math.abs(textLen * Math.cos(ang)) + Math.abs(FS * Math.sin(ang)), H = Math.abs(textLen * Math.sin(ang)) + Math.abs(FS * Math.cos(ang));
      const bx2: Box = [mx - W * 0.4, my - H * 0.4, mx + W * 0.4, my + H * 0.4];
      if (!clear(bx2)) continue;
      taken.push(bx2);
      const rid = `${id}-rd${defs.length}`;
      defs.push(`<path id="${rid}" d="M${p0[0].toFixed(2)},${p0[1].toFixed(2)}L${p1[0].toFixed(2)},${p1[1].toFixed(2)}" fill="none"/>`);
      out.push(`<text font-size="${FS}" font-weight="700" letter-spacing="0.5" dy="${(FS * 0.36).toFixed(2)}" fill="${look.legacy ? STREET_INK : look.streetInk}"><textPath href="#${rid}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
      named.add(name);
      break;
    }
  }
  // A frontage whose road could not carry its name is named outside the site's edge.
  const done = new Set<string>();
  let sa = 0;
  for (let j = 0; j < s.ring.length; j++) { const u = s.ring[j], v = s.ring[(j + 1) % s.ring.length]; sa += u.x * v.y - v.x * u.y; }
  s.ring.forEach((p, i) => {
    const name = b.frontages[i];
    if (!name || named.has(name) || done.has(name)) return;
    done.add(name);
    const q = s.ring[(i + 1) % s.ring.length];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const n = sa > 0 ? { x: (q.y - p.y) / l, y: -(q.x - p.x) / l } : { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
    const off = 6 * (scale / 500) + 2;
    const [lx, ly] = at({ x: mid.x + n.x * off, y: mid.y + n.y * off });
    let ang = (-Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    out.push(`<text transform="translate(${lx.toFixed(2)},${ly.toFixed(2)}) rotate(${ang.toFixed(1)})" y="1" text-anchor="middle" font-size="${FS}" font-weight="700" letter-spacing="0.5" fill="${look.legacy ? STREET_INK : look.streetInk}">${esc(shortStreetName(name).toUpperCase())}</text>`);
  });

  // On each numbered neighbour: its number, then its zone and height of
  // building, written in its building where they fit (the largest on the lot),
  // else on the lot; the lots next to the site first.
  const F1 = 2.6, F2 = 2.3, LH = 3.1;
  const labelled = parcels.filter((pc) => !pc.site && pc.numbers?.length && pc.shown.length)
    .map((pc) => ({ pc, d: Math.min(...(pc.local[0] ?? []).map((p) => Math.min(...s.ring.map((q) => Math.hypot(p.x - q.x, p.y - q.y))))) }))
    .sort((p, q) => p.d - q.d);
  for (const { pc } of labelled) {
    const lines = [`NO. ${numberLine(pc.numbers!)}`, [pc.zone, pc.hob ? hobLine(pc.hob) : ''].filter(Boolean).join(' · ')].filter(Boolean);
    const wMm = Math.max(lines[0].length * F1 * 0.66, (lines[1]?.length ?? 0) * F2 * 0.6) + 2.4, hMm = lines.length * LH + 0.8;
    const hw = wMm / 2 / mm, hh = hMm / 2 / mm;
    // The label's box, its corners and the middles of its sides, all inside the outline.
    const fits = (p: XY, rs: XY[][]) => [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].every(([u, v]) => within({ x: p.x + u * hw, y: p.y + v * hh }, rs));
    const inLot = blds.filter((rg) => within(centre(rg), pc.local)).map((rg) => inFrame(rg)).filter((rg) => rg.length >= 3).sort((p, q) => ringArea(q) - ringArea(p));
    let spot: XY | undefined;
    for (const rg of inLot) {
      const p = tierSpot([rg], [], [], hh, 0);
      if (p && fits(p, [rg])) { spot = p; break; }
    }
    spot ??= tierSpot(pc.shown, [], [], hh, 0);
    if (!spot) continue;
    const [px, py] = at(spot);
    const bx2: Box = [px - wMm / 2, py - hMm / 2, px + wMm / 2, py + hMm / 2];
    if (!clear(bx2)) continue;
    taken.push(bx2);
    const y0 = py - ((lines.length - 1) * LH) / 2 + F1 * 0.36;
    lines.forEach((t, i) => out.push(`<text x="${px.toFixed(2)}" y="${(y0 + i * LH).toFixed(2)}" text-anchor="middle" font-size="${i ? F2 : F1}" font-weight="${i ? 400 : 700}" fill="#111111">${esc(t)}</text>`));
  }

  return {
    svg: `<defs><clipPath id="plan-${id}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath>${defs.join('')}</defs><g clip-path="url(#plan-${id})">${out.join('')}</g>`,
    scale, kerbs,
  };
}

/** The middle of the longest run of boundary along one street: where the tier numbers are drawn toward. */
export function frontageMiddle(ring: XY[], frontages: (string | null)[]): XY | undefined {
  const n = ring.length;
  if (!frontages.some(Boolean)) return undefined;
  // Start where a street's run begins, so no run is cut in two at the ring's seam.
  const start = Math.max(0, frontages.findIndex((f, i) => f && frontages[(i - 1 + n) % n] !== f));
  let best: XY[] = [], run: XY[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n, name = frontages[i];
    if (!(run.length && name && frontages[(i - 1 + n) % n] === name)) {
      if (pathLength(run) > pathLength(best)) best = run;
      run = name ? [ring[i]] : [];
    }
    if (name) run.push(ring[(i + 1) % n]);
  }
  if (pathLength(run) > pathLength(best)) best = run;
  let left = pathLength(best) / 2;
  for (let i = 1; i < best.length; i++) {
    const l = Math.hypot(best[i].x - best[i - 1].x, best[i].y - best[i - 1].y);
    if (l >= left) { const t = left / (l || 1); return { x: best[i - 1].x + (best[i].x - best[i - 1].x) * t, y: best[i - 1].y + (best[i].y - best[i - 1].y) * t }; }
    left -= l;
  }
  return best[best.length - 1];
}

const pathLength = (pts: XY[]) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

/** The ring cut to a rectangle: Sutherland–Hodgman, one pass a side, the rectangle being convex. */
function clipRect(rg: XY[], x0: number, y0: number, x1: number, y1: number): XY[] {
  const sides: [(p: XY) => boolean, (a: XY, b: XY) => XY][] = [
    [(p) => p.x >= x0, (a, b) => ({ x: x0, y: a.y + ((x0 - a.x) * (b.y - a.y)) / (b.x - a.x) })],
    [(p) => p.x <= x1, (a, b) => ({ x: x1, y: a.y + ((x1 - a.x) * (b.y - a.y)) / (b.x - a.x) })],
    [(p) => p.y >= y0, (a, b) => ({ x: a.x + ((y0 - a.y) * (b.x - a.x)) / (b.y - a.y), y: y0 })],
    [(p) => p.y <= y1, (a, b) => ({ x: a.x + ((y1 - a.y) * (b.x - a.x)) / (b.y - a.y), y: y1 })],
  ];
  let pts = rg;
  for (const [inside, cut] of sides) {
    const next: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      if (inside(b)) { if (!inside(a)) next.push(cut(a, b)); next.push(b); }
      else if (inside(a)) next.push(cut(a, b));
    }
    pts = next;
    if (!pts.length) break;
  }
  return pts;
}

/** Inside the ring, by crossings. */
function inRing(p: XY, rg: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    if (rg[i].y > p.y !== rg[j].y > p.y && p.x < ((rg[j].x - rg[i].x) * (p.y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) inside = !inside;
  }
  return inside;
}

/** From a point to the nearest point of a segment. */
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Where a tier's number goes in plan: inside its envelope and, where it can,
 * outside the envelopes of the tiers above it — the band that is its own —
 * and on the plate built there, clear of the band's edges and of the numbers
 * already placed. Of the spots where the mark sits clear, the one nearest
 * `toward` (the envelope's middle when not given); where none is, the
 * roomiest. Found on a grid over the envelope; `fit` is the clearance the mark
 * needs from an edge and `apart` from another mark's centre, in metres.
 */
export function tierSpot(env: XY[][], above: XY[][], placed: XY[], fit: number, apart: number, plate: XY[][] = [], toward?: XY): XY | undefined {
  const rings = env.filter((rg) => rg.length >= 3), over = above.filter((rg) => rg.length >= 3), built = plate.filter((rg) => rg.length >= 3);
  if (!rings.length) return undefined;
  const all = rings.flat();
  const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x));
  const y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
  const mid = toward ?? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const step = Math.max(x1 - x0, y1 - y0) / 80 || 1;
  const within = (p: XY, rs: XY[][]) => rs.filter((rg) => inRing(p, rg)).length % 2 === 1;
  const edge = (p: XY, rs: XY[][]) => { let d = Infinity; for (const rg of rs) for (let i = 0; i < rg.length; i++) d = Math.min(d, segDist(p, rg[i], rg[(i + 1) % rg.length])); return d; };
  let best: { p: XY; rank: number } | undefined;
  for (let x = x0 + step / 2; x < x1; x += step) for (let yy = y0 + step / 2; yy < y1; yy += step) {
    const p = { x, y: yy };
    if (!within(p, rings)) continue;
    const own = !within(p, over), onPlate = !built.length || within(p, built);
    const room = Math.min(edge(p, rings), own ? edge(p, over) : Infinity, onPlate && built.length ? edge(p, built) : Infinity);
    const score = Math.min(room - fit, Math.min(Infinity, ...placed.map((q) => Math.hypot(p.x - q.x, p.y - q.y) - apart)));
    // Clear and its own beats clear, clear beats cramped; on the plate breaks a tie; then the middle, or the room.
    const clear = score >= 0;
    const rank = (clear ? (own ? 4e6 : 2e6) : 0) + (onPlate ? 1e6 : 0) + (clear ? -Math.hypot(p.x - mid.x, p.y - mid.y) : score);
    if (!best || rank > best.rank) best = { p, rank };
  }
  return best?.p;
}

// ---- the scenarios ---------------------------------------------------------------------

/** One path the site may take, for the SCENARIOS table, the CSV and the JSON: display figures, not geometry. */
export interface Scenario {
  id: 'standsToday' | 'rebuiltAsStands' | 'withinControls' | 'affordableBonus' | 'envelopeToHeight';
  label: string;
  note: string;
  storeys?: string;
  heightM?: number;
  gfa?: string;
  fsr?: string;
  units?: string;
  parking?: string;
  /** true complies, false does not, null needs a gate passed (eligibility), undefined takes no mark (what stands). */
  ok?: boolean | null;
}

/**
 * The paths an investor weighs, each against the same site: what stands
 * today (indicative, from the recorded footprints and heights), what stands
 * kept or rebuilt to its own envelope where it holds more than the controls
 * give (a clause 4.6 variation argued on the bulk that stands), the scheme
 * within the LEP's controls and the ADG's separations (the one the drawings
 * show), the Housing SEPP's in-fill affordable housing bonus, and the
 * envelope filled to the height — what the setbacks and the height plane
 * hold with the floor space ratio set aside, the case a clause 4.6
 * variation or a planning proposal has to carry.
 */
export function scenarioRows(b: YieldBundle, s: YieldStudy = yieldStudy(b)): Scenario[] {
  const A = b.siteAreaSqm ?? 0;
  const out: Scenario[] = [];
  const ex = existingSummary(b.existing ?? []);
  if (ex) out.push({
    id: 'standsToday', label: 'STANDS TODAY',
    note: `${ex.count === 1 ? 'the building that stands' : `the ${ex.count} buildings that stand`}, from the recorded footprint${ex.known ? ' and height' : ' alone: no height is recorded'}; not a survey`,
    storeys: ex.storeys ? `~${ex.storeys}` : undefined,
    heightM: ex.heightM ? Math.round(ex.heightM * 10) / 10 : undefined,
    gfa: ex.gbaSqm ? `≈ ${sqm(ex.gbaSqm)} GBA` : undefined,
    fsr: ex.gbaSqm && A ? `≈ ${(ex.gbaSqm / A).toFixed(1)}:1` : undefined,
  });
  const fill = (y: YieldResult) => ({
    storeys: fmt(y.storeys), heightM: Math.round(y.heightM * 10) / 10, gfa: sqm(y.gfa),
    fsr: A && y.gfa ? `${(y.gfa / A).toFixed(2)}:1` : undefined,
    units: y.units.total ? fmt(y.units.total) : undefined,
    parking: y.parking.total ? fmt(y.parking.total) : undefined,
  });
  if (s.retained) out.push({
    id: 'rebuiltAsStands', label: 'REBUILT TO WHAT STANDS',
    note: 'what stands, kept and refurbished or rebuilt on its footprint to its height: over the LEP\'s controls, a clause 4.6 variation argued on the bulk that stands (existing use rights for a use the zone has dropped); to confirm with a planner',
    ...fill(s.retained), ok: null,
  });
  out.push({
    id: 'withinControls', label: 'WITHIN THE CONTROLS — DRAWN',
    note: 'the LEP\'s height and floor space ratio and the ADG\'s separations: the massing, the plan and the schedule show this one',
    ...fill(s.base), ok: true,
  });
  // A bonus the envelope eats (no more floor area or units than the base) is no path at all.
  if (s.bonus && (s.bonus.gfa > s.base.gfa + 1 || s.bonus.units.total > s.base.units.total)) out.push({
    id: 'affordableBonus', label: 'AFFORDABLE HOUSING BONUS',
    note: `the Housing SEPP's in-fill bonus, ${Math.round((s.base.assumptions.affordableBonus) * 100)}% more FSR and height for 15% affordable housing (≈ ${fmt(Math.round(s.bonus.units.total * 0.15))} units for 15 years); eligibility to confirm`,
    ...fill(s.bonus), ok: null,
  });
  if (s.max) {
    const permitted = b.controls.fsr ? `${Math.round(b.controls.fsr * 100) / 100}:1` : undefined;
    out.push({
      id: 'envelopeToHeight', label: 'ENVELOPE TO THE HEIGHT',
      note: `the setbacks filled to the height plane${permitted ? `: over the LEP's FSR ${permitted}` : ''} — the case a clause 4.6 variation or a planning proposal has to carry`,
      ...fill(s.max), ok: false,
    });
  }
  return out;
}

// ---- the deck -------------------------------------------------------------------------
//
// The yield prints as the site report does: A3 spreads, the left page for
// what is said — the figures, the tables, the key — and the right for the
// drawings. The first spread sets the paths side by side over the site and
// its neighbours; each path then has its own spread, its massing over its
// plan; the last holds the controls table and the assumptions.

/** The right page's field, for the table that sits in its margins: its left, width, top and foot. */
const RX = 222, RW = 186, RTOP = 11.6, RFOOT = 285;
/** The right page itself, which the drawings run to the edges of, as the report's maps do. */
const PAGE_X = 210, PAGE_W = 210, PAGE_H = 297;
/** The name over a drawing: the report's white box in its corner, 8 mm in. */
const LABEL_IN = 8;

const area = (v: number) => `${fmt(Math.round(v))} m²`;
const m2 = (t: string) => t.replace(/ sqm\b/g, ' m²');
const ratio = (gfa: number, A: number) => (A && gfa ? `${(gfa / A).toFixed(2)}:1` : '—');
/** A ratio of an estimate, to one place. */
const about = (gba: number, A: number) => (A && gba ? `≈ ${(gba / A).toFixed(1)}:1` : '—');
const storeyWord = (n: number) => `${n} ${n === 1 ? 'storey' : 'storeys'}`;
const ARCH_SHORT: Record<YieldResult['archetype'], string> = {
  residential: 'Residential flat building', mixed: 'Shop-top housing', commercial: 'Commercial building', none: 'None studied for the zone',
};
const SCENARIO_TITLE: Record<Scenario['id'], string> = {
  standsToday: 'Stands today', rebuiltAsStands: 'Rebuilt to what stands', withinControls: 'Within the controls', affordableBonus: 'Affordable housing bonus', envelopeToHeight: 'Envelope to the height',
};

/** The ✓, the ✗ or the dash of a compliance cell. */
function okMark(ok: boolean | null | undefined): string {
  if (ok === undefined) return '';
  const body = ok === null ? '<line x1="1" y1="2" x2="4" y2="2" stroke="#878787" stroke-width="0.45"/>'
    : ok ? '<path d="M0.6,2.1 L1.9,3.3 L4.4,0.6" fill="none" stroke="#2f8f55" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M1,0.6 L4,3.4 M4,0.6 L1,3.4" stroke="#c8372d" stroke-width="0.55" stroke-linecap="round"/>';
  return `<svg class="mk" viewBox="0 0 5 4" width="3.4mm" height="2.7mm" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** A tier's number, as the plan draws it. */
const tierKey = (n: number) => `<span class="ytier">${n}</span>`;

interface TRow { cells: string[]; cls?: string }
/**
 * A table in the template's manner: grey 6 pt heads, a hairline under each row; `r` marks a column set right. Cells are HTML.
 * `fixed` holds the columns to their widths whatever the cells hold, so a table met on page after page stands the same on each.
 */
function ytable(cols: { head: string; r?: boolean; w?: string }[], rows: TRow[], fixed = false): string {
  const cg = `<colgroup>${cols.map((c) => `<col${c.w ? ` style="width:${c.w}"` : ''}>`).join('')}</colgroup>`;
  const head = `<tr>${cols.map((c) => `<th${c.r ? ' class="r"' : ''}>${esc(c.head)}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr${row.cls ? ` class="${row.cls}"` : ''}>${row.cells.map((c, i) => `<td${cols[i]?.r ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="yt${fixed ? ' yf' : ''}">${cg}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** A drawing's name, in the white box the report sets in a map's corner; `top` is the drawing's. */
const mapLabel = (top: number, parts: string[]) =>
  `<div class="abs maplabel" style="left:${PAGE_X + LABEL_IN}mm;top:${top + LABEL_IN}mm">${esc(parts.filter(Boolean).join(' · '))}</div>`;

/** The box the name covers, in the drawing's millimetres, for the plan's own words to keep off (6 pt tracked caps, padded). */
const labelBox = (parts: string[]): [number, number, number, number] =>
  [LABEL_IN - 1, LABEL_IN - 1, LABEL_IN + parts.filter(Boolean).join(' · ').length * 1.42 + 6, LABEL_IN + 5.5];

/** A drawing across the right page, edge to edge, from `top` down `h`; drawn into a box at the origin. */
const bleedFigure = (top: number, h: number, inner: string) =>
  `<svg class="abs" style="left:${PAGE_X}mm;top:${top}mm" width="${PAGE_W}mm" height="${h}mm" viewBox="0 0 ${PAGE_W} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="${tpl().font}" fill="${tpl().ink}">${inner}</svg>`;

/** The deck's inks for this render: the family its figures are drawn in (the legacy's red, or the style's accent's), its narrative's ink, its site's pen. */
function inks() {
  const look = deckLook();
  const F = look.legacy ? INK.red : look.family;
  return { look, F, accent: look.legacy ? INK.red.text : look.accent, site: look.legacy ? SITE_RED : look.accent };
}

/** The key's swatches, in its 5 × 3.6 box. */
function keySwatches() {
  const { look, site } = inks();
  const t = tpl();
  const neighbours = look.legacy || look.buildings === 'grey' ? `fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.15"`
    : look.buildings === 'white' ? `fill="#ffffff" stroke="${t.road}" stroke-width="0.3"` : `fill="#c2c2bc" stroke="#ffffff" stroke-width="0.3"`;
  const lot = look.legacy ? `stroke="${LOT_INK}" stroke-width="0.15"` : look.lots === 'white' ? `fill="#eeeeea" stroke="#ffffff" stroke-width="0.3"` : `stroke="${t.road}" stroke-width="0.15" opacity="0.6"`;
  return {
    site: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="${site}" fill-opacity="0.08" stroke="${site}" stroke-width="0.3" stroke-dasharray="1,0.4"/>`,
    use: (u: Use) => `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="${useFill(u)}" stroke="#3a3a3a" stroke-width="0.15"/>`,
    standing: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="${STANDING_FILL}" stroke="#3a3a3a" stroke-width="0.15"/>`,
    envelope: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="none" stroke="${ENVELOPE}" stroke-width="0.25" stroke-dasharray="0.8,0.5"/>`,
    plane: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="${site}" fill-opacity="0.05" stroke="${site}" stroke-width="0.25" stroke-dasharray="1.2,0.6"/>`,
    neighbours: `<path d="M0.4,0.5H4.6V3.1H0.4Z" ${neighbours}/>`,
    future: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="${FUTURE_FILL}" fill-opacity="0.6" stroke="${FUTURE_EDGE}" stroke-width="0.2" stroke-dasharray="0.7,0.4"/>`,
    kerb: `<line x1="0.3" y1="1.8" x2="4.7" y2="1.8" stroke="${KERB_INK}" stroke-width="0.3"/>`,
    lot: `<path d="M0.4,0.5H4.6V3.1H0.4Z" fill="none" ${lot}/>`,
  };
}

/** The scenarios' fills in the bar charts: one family, told apart by pattern. */
function barFills(): Record<Scenario['id'], Fill> {
  const { F } = inks();
  return {
    standsToday: { bg: '#ffffff', kind: 'vlines', ink: F.line, step: 0.55, w: 0.16, outline: F.line, outlineW: 0.12 },
    rebuiltAsStands: { bg: '#ffffff', kind: 'waves', ink: F.deep, step: 0.8, w: 0.14, outline: F.line, outlineW: 0.12 },
    withinControls: { bg: F.mid },
    affordableBonus: { bg: '#ffffff', kind: 'dots', ink: F.deep, step: 0.8, w: 0.12, outline: F.line, outlineW: 0.12 },
    envelopeToHeight: { bg: '#ffffff', kind: 'hlines', ink: F.line, step: 0.55, w: 0.16, outline: F.line, outlineW: 0.12 },
  };
}

interface Path { sc: Scenario; y?: YieldResult }

/** What each drawn path rests on, for its page's foot. */
const PATH_BASIS: Record<Scenario['id'], string> = {
  standsToday: '',
  rebuiltAsStands: 'This path keeps the bulk that stands: over the LEP\'s height and floor space ratio, it needs a clause 4.6 variation (or the building kept and refurbished), and existing use rights where the zone no longer permits the use; to confirm with a planner.',
  withinControls: 'This path keeps to the LEP\'s height of building and floor space ratio.',
  affordableBonus: 'This path takes the Housing SEPP\'s in-fill affordable housing bonus (chapter 2, part 2, division 1); the site\'s eligibility is to confirm.',
  envelopeToHeight: 'This path sets the floor space ratio aside: it needs a clause 4.6 variation or a planning proposal.',
};

/** The paths, each with the study's result behind it (none for what stands). */
function pathsOf(b: YieldBundle, s: YieldStudy): Path[] {
  const of: Record<Scenario['id'], YieldResult | undefined> = { standsToday: undefined, rebuiltAsStands: s.retained, withinControls: s.base, affordableBonus: s.bonus, envelopeToHeight: s.max };
  return scenarioRows(b, s).map((sc) => ({ sc, y: of[sc.id] }));
}

/** What stands, in the study's metres. */
const standingOf = (b: YieldBundle, s: YieldStudy) => (b.existing ?? []).filter((e) => e.rings?.length)
  .map((e) => ({ rings: e.rings!.map((rg) => rg.map(([lon, lat]) => s.toLocal(lon, lat))).filter((rg) => rg.length >= 3), heightM: e.heightM, storeys: e.storeys }))
  .filter((e) => e.rings.length);

/** The page's second line: the zone, the height and the ratio, as the report writes them. */
function subtitleOf(b: YieldBundle, s: YieldStudy): string {
  const c = b.controls;
  return [b.siteAddress, [c.zoneCode, c.zonePurpose].filter(Boolean).join(' '), s.hob ? `HOB ${s.hob.rl ? `RL ${fmt(s.hob.value, 1)}` : m1(s.hob.value)}` : '', c.fsr ? `FSR ${c.fsr.toFixed(2)}:1` : '']
    .filter(Boolean).join(' · ');
}

const NOT_A_DESIGN = 'A feasibility study, not a design: the envelope follows the mapped LEP controls and the ADG\'s separations; DCP setbacks, street wall heights, solar access and overshadowing are for the design to test. Mapped controls are not a s10.7 planning certificate.';

/** The key to the massing and the plan of a path's spread. */
function schemeLegend(b: YieldBundle, s: YieldStudy, y: YieldResult | undefined, standing: boolean, kerbs: boolean): LegendEntry[] {
  const KEY = keySwatches();
  const out: LegendEntry[] = [{ swatch: KEY.site, label: 'The site' }];
  if (standing) out.push({ swatch: KEY.standing, label: 'What stands on the site, recorded height' });
  for (const u of ['residential', 'retail', 'commercial'] as Use[]) if (y?.tiers.some((t) => t.use === u)) out.push({ swatch: KEY.use(u), label: `Indicative massing, ${USE_WORD[u]}` });
  if (y?.tiers.length) out.push({ swatch: KEY.envelope, label: 'Envelope of each tier' });
  if (s.hob?.metres) out.push({ swatch: KEY.plane, label: 'The LEP\'s height of building plane' });
  out.push({ swatch: KEY.neighbours, label: `Neighbours at their heights (${b.buildingsSource === 'overture' ? 'Overture' : 'OSM'}; dashed: not recorded)` });
  if (s.futures.some(Boolean)) out.push({ swatch: KEY.future, label: 'Neighbours\' future, to their LEP height and FSR' });
  if (kerbs) out.push({ swatch: KEY.kerb, label: 'Kerb line, indicative' });
  return out;
}

/** The two drawings of a path's right page: its massing over its plan. */
function schemeFigures(b: YieldBundle, s: YieldStudy, scheme: Scheme, id: string, massingNote: string, massingTitle = 'Indicative massing'): { html: string; kerbs: boolean } {
  // The massing over the top half, its neighbours out to the page's edges; the plan under it, to the edges and the foot.
  const AXO_H = 150, PLAN_TOP = AXO_H, PLAN_H = PAGE_H - PLAN_TOP;
  const planName = (scale: number) => ['Plan', `1:${fmt(scale).replace(',', ' ')}`, scheme.y?.tiers.length ? 'tiers numbered as in the schedule' : ''];
  const plan = planView(b, s, { x: 0, y: 0, w: PAGE_W, h: PLAN_H }, scheme, id, { inset: 6, keepOut: [labelBox(planName(5000))] });
  return {
    html: bleedFigure(0, AXO_H, axonometric(b, s, { x: 2, y: LABEL_IN + 9, w: PAGE_W - 4, h: AXO_H - LABEL_IN - 11 }, scheme, id)) + mapLabel(0, [massingTitle, massingNote]) +
      bleedFigure(PLAN_TOP, PLAN_H, plan.svg) + mapLabel(PLAN_TOP, planName(plan.scale)),
    kerbs: plan.kerbs.length > 0,
  };
}

/** Floor area and height, path by path, against what the controls give. */
function pathBars(b: YieldBundle, s: YieldStudy, paths: Path[]): string[] {
  const A = b.siteAreaSqm ?? 0, c = b.controls;
  const BAR_FILL = barFills(), R = inks().F;
  const ex = existingSummary(b.existing ?? []);
  const gfaRows = paths.map((p) => ({ id: p.sc.id, v: p.y ? p.y.gfa : ex?.gbaSqm ?? 0, approx: !p.y })).filter((r) => r.v > 0)
    .map((r) => ({ name: SCENARIO_TITLE[r.id], value: r.v, label: `${r.approx ? '≈ ' : ''}${fmt(Math.round(r.v))} m²${r.approx ? ' GBA' : ''}`, fill: BAR_FILL[r.id] }));
  const hRows = paths.map((p) => ({ id: p.sc.id, v: p.y ? p.y.heightM : ex?.heightM ?? 0 })).filter((r) => r.v > 0)
    .map((r) => ({ name: SCENARIO_TITLE[r.id], value: r.v, label: m1(Math.round(r.v * 10) / 10), fill: BAR_FILL[r.id] }));
  const out: string[] = [];
  const ref = c.fsr && A ? { value: c.fsr * A, label: `FSR ${c.fsr.toFixed(2)}:1`, ink: R.deep } : undefined;
  if (gfaRows.length) { const ax = niceAxis(Math.max(...gfaRows.map((r) => r.value), ref?.value ?? 0)); out.push(zBlock('Floor area · m²', zBars(gfaRows, ax.max, ax.step, { ref }))); }
  const hRef = s.hob?.metres ? { value: s.hob.metres, label: `HOB ${m1(Math.round(s.hob.metres))}`, ink: R.deep } : undefined;
  if (hRows.length) { const ax = niceAxis(Math.max(...hRows.map((r) => r.value), hRef?.value ?? 0)); out.push(zBlock('Height · m', zBars(hRows, ax.max, ax.step, { ref: hRef }))); }
  return out;
}

/** Spread one: the paths side by side, over the site and its neighbours. */
function overviewSlide(b: YieldBundle, s: YieldStudy, paths: Path[]): Slide {
  const A = b.siteAreaSqm ?? 0, c = b.controls, y = s.base;
  const ex = existingSummary(b.existing ?? []);
  const front = s.frontageLengths[0];
  const figs = zFigures([
    ['site area, cadastre', A ? area(A) : '—'],
    ['lot', b.lotDescription || '—'],
    ['frontage', front ? `${shortStreetName(front.name)} ${fmt(front.lengthM, 1)} m${s.frontageLengths.length > 1 ? ` + ${s.frontageLengths.length - 1} more` : ''}` : 'none found'],
  ], [
    ['zone', [c.zoneCode, c.zonePurpose].filter(Boolean).join(' ') || 'not mapped'],
    ['height of building', s.hob ? `${s.hob.rl ? `RL ${fmt(s.hob.value, 1)}${s.hob.metres ? ` · about ${m1(Math.round(s.hob.metres))}` : ''}` : m1(s.hob.value)}` : 'not mapped'],
    ['floor space ratio', c.fsr ? `${c.fsr.toFixed(2)}:1${A ? ` · ${area(c.fsr * A)}` : ''}` : 'not mapped'],
  ], 9.6);
  const table = ytable(
    [{ head: 'Path', w: '36mm' }, { head: 'Storeys', r: true }, { head: 'Height', r: true }, { head: 'Floor area', r: true }, { head: 'FSR', r: true }, { head: 'Units', r: true }, { head: 'Cars', r: true }, { head: '', w: '5mm' }, { head: 'Page', r: true }],
    paths.map((p, i) => ({
      cls: p.sc.id === 'withinControls' ? 'hi' : undefined,
      cells: [esc(SCENARIO_TITLE[p.sc.id]), esc(p.sc.storeys ?? '—'), p.sc.heightM ? esc(m1(p.sc.heightM)) : '—',
        esc(p.y ? fmt(Math.round(p.y.gfa)) : ex?.gbaSqm ? `≈ ${fmt(Math.round(ex.gbaSqm))}` : '—'), esc(p.sc.fsr ?? '—'), esc(p.sc.units ?? '—'), esc(p.sc.parking ?? '—'), okMark(p.sc.ok), String(i + 2).padStart(2, '0')],
    })));
  const blocks = [zBlock('The site', figs, 'The controls'), zBlock('The paths', table), ...pathBars(b, s, paths)];
  const name = (scale: number) => ['The site and its neighbours', `1:${fmt(scale).replace(',', ' ')}`, 'their numbers, zones and heights'];
  const plan = planView(b, s, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, {}, 'site', { room: 2.4, inset: 6, keepOut: [labelBox(name(5000))] });
  const right = bleedFigure(0, PAGE_H, plan.svg) + mapLabel(0, name(plan.scale));
  const KEY = keySwatches();
  const legend: LegendEntry[] = [{ swatch: KEY.site, label: 'The site' }, { swatch: KEY.neighbours, label: 'Buildings round about' }, { swatch: KEY.lot, label: inks().look.legacy ? 'Lot boundaries, NSW cadastre' : 'Lot boundaries, NSW cadastre, each lot in its zone\'s colour' }];
  if (plan.kerbs.length) legend.push({ swatch: KEY.kerb, label: 'Kerb line, indicative' });
  const exceeds = ex?.gbaSqm && ex.gbaSqm > Math.max(...paths.filter((p) => p.y && p.sc.id !== 'rebuiltAsStands').map((p) => p.y!.gba), 0);
  const narrative = brief([
    y.archetype === 'none'
      ? `${c.zoneCode ?? 'The zone'} takes no residential flat building, shop-top housing or office building: the floor space ratio gives ${A && c.fsr ? area(c.fsr * A) : 'the floor area'} alone.`
      : `Within the controls the site holds ${y.archetype === 'mixed' ? 'shop-top housing' : y.archetype === 'commercial' ? 'a commercial building' : 'a residential flat building'} of ${storeyWord(y.storeys)}: ${area(y.gfa)} of floor area${y.units.total ? `, ${fmt(y.units.total)} apartments` : ''}${y.parking.total ? ` and ${fmt(y.parking.total)} parking spaces` : ''}.`,
    exceeds && s.retained ? `What stands today, about ${ex!.storeys ?? '?'} storeys and ${about(ex!.gbaSqm!, A)}, is over the controls, and need not come down to them: kept, or rebuilt to its own envelope under a clause 4.6 variation, it holds about ${area(s.retained.gfa)}${s.retained.units.total ? ` and ${fmt(s.retained.units.total)} apartments` : ''}.`
      : exceeds ? `What stands today, about ${ex!.storeys ?? '?'} storeys and ${about(ex!.gbaSqm!, A)}, exceeds every path: redevelopment within the controls would cut the floor area.`
      : ex?.gbaSqm && y.gfa ? `What stands today holds about ${area(ex.gbaSqm)}${y.gfa > ex.gbaSqm ? `: redevelopment within the controls adds about ${area(y.gfa - ex.gbaSqm)}` : ''}.` : '',
    s.bonus && paths.some((p) => p.sc.id === 'affordableBonus') ? `The affordable housing bonus adds ${area(s.bonus.gfa - y.gfa)}${s.bonus.units.total > y.units.total ? ` and ${fmt(s.bonus.units.total - y.units.total)} apartments` : ''}.` : '',
    s.max ? `Filled to the height, the envelope holds ${area(s.max.gfa)}, the case for a clause 4.6 variation or a planning proposal.` : '',
  ]);
  return { id: '01_planning_yield', title: 'Planning yield', subtitle: subtitleOf(b, s), textHtml: '', figureHtml: zFlow(blocks) + right, full: true,
    narrative, accent: inks().accent, legend, sources: `${NOT_A_DESIGN} Site area from the NSW cadastre: confirm against survey. Retrieved ${b.generatedAt.slice(0, 10)}.` };
}

/** A path's spread: its figures, its controls, its schedule and its mix; its massing over its plan. */
function schemeSlide(b: YieldBundle, s: YieldStudy, p: Path, n: number, last: number): Slide {
  const y = p.y!, a = y.assumptions, c = b.controls, A = b.siteAreaSqm ?? 0;
  const id = p.sc.id;
  const apartments = y.units.total > 0;
  const k = id === 'affordableBonus' ? 1 + a.affordableBonus : 1;
  const pct = Math.round(a.affordableBonus * 100);
  const figs = zFigures([
    ['building type', ARCH_SHORT[y.archetype]],
    ['storeys · height', y.storeys ? `${y.storeys} · ${m1(Math.round(y.heightM * 10) / 10)} to the roof` : '—'],
    ['gross floor area · FSR', y.gfa ? `${area(y.gfa)} · ${ratio(y.gfa, A)}` : '—'],
  ], [
    apartments ? ['apartments', `${fmt(y.units.total)} · average ${fmt(y.averageUnitSqm, 1)} m²`] : ['commercial floor area', y.gfaByUse.commercial ? `${area(y.gfaByUse.commercial)} GFA · ${area(y.gfaByUse.commercial * a.commercialNlaRatio)} NLA` : '—'],
    apartments ? ['saleable area · retail', `${area(y.nsa)} NSA${y.gfaByUse.retail ? ` · ${area(y.gfaByUse.retail * a.retailNlaRatio)} retail NLA` : ''}`] : ['retail', y.gfaByUse.retail ? `${area(y.gfaByUse.retail)} GFA` : '—'],
    ['car parking', y.parking.total ? `${fmt(y.parking.total)} spaces · ${y.parking.basementLevels} basement ${y.parking.basementLevels === 1 ? 'level' : 'levels'}` : '—'],
  ], 9.6);
  // Against the controls: the LEP's (lifted by the bonus on its spread), and the ADG's that the drawing answers.
  const ctl: TRow[] = [];
  if (s.hob) {
    const limitM = s.hob.metres ? s.hob.metres * k : undefined;
    const hob = s.hob.rl ? `RL ${fmt(s.hob.value, 1)}` : m1(s.hob.value);
    ctl.push({ cells: ['Height of building', esc(k > 1 ? `${hob} + ${pct}%` : hob),
      esc(y.heightM ? `${m1(Math.round(y.heightM * 10) / 10)}, ${storeyWord(y.storeys)}` : '—'), okMark(limitM && y.heightM ? y.heightM <= limitM + 1e-6 : null)] });
  }
  if (c.fsr) ctl.push({ cells: ['Floor space ratio', esc(`${c.fsr.toFixed(2)}:1${k > 1 ? ` + ${pct}%` : ''}`), esc(ratio(y.gfa, A)), okMark(y.gfa ? y.gfa <= c.fsr * k * A + 1 : null)] });
  if (c.fsr && A) ctl.push({ cells: ['Gross floor area', esc(area(c.fsr * k * A)), esc(y.gfa ? area(y.gfa) : '—'), okMark(y.gfa ? y.gfa <= c.fsr * k * A + 1 : null)] });
  if (c.minLotSizeSqm) ctl.push({ cells: ['Minimum lot size', esc(area(c.minLotSizeSqm)), esc(A ? area(A) : '—'), okMark(A ? A >= c.minLotSizeSqm : null)] });
  if (apartments) {
    ctl.push(id === 'rebuiltAsStands'
      ? { cells: ['ADG 2E building depth', '12–18 m', 'as it stands: to test', okMark(null)] }
      : { cells: ['ADG 2E building depth', '12–18 m', esc(y.tiers.some((t) => t.held === 'depth') ? `plates held to ${m1(a.maxDepth)}` : 'within the depth'), okMark(true)] });
    const ds = y.adg.deepSoil;
    ctl.push({ cells: ['ADG 3E deep soil', esc(area(ds.requiredSqm)), esc(ds.possible ? `${area(ds.groundFreeSqm)} clear` : 'not in this envelope'), okMark(ds.possible)] });
  }
  // Each path's tables keep the same columns, page after page: the widths are the widest any path needs.
  const ctlTable = ytable([{ head: 'Control', w: '38mm' }, { head: id === 'affordableBonus' ? 'Permitted, with the bonus' : 'Permitted', w: '50mm' }, { head: 'This path' }, { head: '', w: '5mm' }], ctl, true);
  // The schedule, tier by tier, keyed to the plan's numbers.
  const set = (v: number) => fmt(v, v % 1 ? 1 : 0);
  const gfaOf = (t: Tier) => y.floors.filter((f) => f.storey >= t.from && f.storey <= t.to).reduce((sum, f) => sum + f.gfa, 0);
  const sched: TRow[] = y.tiers.map((t, i) => {
    const built = Math.max(0, Math.min(t.to, y.storeys) - t.from + 1);
    const st = t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`;
    const held = t.held === 'tower' ? ', tower plate' : t.held === 'depth' ? `, ${m1(a.maxDepth)} deep` : '';
    return { cls: built ? undefined : 'dim', cells: [tierKey(i + 1), esc(built && built < t.to - t.from + 1 ? `${st} (${built} built)` : st), esc(USE_WORD[t.use] + held),
      esc(t.existing ? 'as it stands' : `${set(t.front)} / ${set(t.side)} / ${set(t.rear)} m`), esc(area(t.plateSqm)), esc(built ? area(gfaOf(t)) : 'not built')] };
  });
  if (y.tiers.length) sched.push({ cls: 'tot', cells: ['Total', esc(storeyWord(y.storeys)), '', '', esc(area(y.gba)), esc(area(y.gfa))] });
  const schedTable = y.tiers.length
    ? ytable([{ head: 'Tier', w: '9mm' }, { head: 'Storeys', w: '22mm' }, { head: 'Use', w: '24mm' }, { head: 'Setbacks F / S / R', w: '28mm' }, { head: 'Plate GBA', r: true }, { head: 'GFA', r: true, w: '18mm' }], sched, true)
    : '<div class="ynote">No building type is studied for this zone: the floor space ratio\'s floor area alone.</div>';
  const blocks = [zBlock('The scheme', figs), zBlock('Against the controls', ctlTable), zBlock('Schedule', schedTable)];
  if (apartments) {
    const kinds = inMix(y);
    const pc = (v: number) => `${fmt(v * 100, (v * 100) % 1 ? 1 : 0)}%`;
    const mixRows: TRow[] = kinds.map((kd) => ({ cells: [esc(UNIT_NAME[kd]), esc(pc(a.mix[kd])), esc(area(ADG_MINIMUM[kd])), esc(area(a.sizes[kd])), esc(fmt(y.units[kd])), esc(area(y.units[kd] * a.sizes[kd]))] }));
    mixRows.push({ cls: 'tot', cells: ['Total', '', '', esc(`avg ${fmt(y.averageUnitSqm, 1)} m²`), esc(fmt(y.units.total)), esc(area(kinds.reduce((t, kd) => t + y.units[kd] * a.sizes[kd], 0)))] });
    blocks.push(zBlock('Apartments', ytable([{ head: 'Unit', w: '24mm' }, { head: 'Share', r: true, w: '16mm' }, { head: 'ADG 4D min.', r: true, w: '28mm' }, { head: 'Area each', r: true, w: '24mm' }, { head: 'Units', r: true, w: '14mm' }, { head: 'Area', r: true }], mixRows, true)));
  }
  const figures = schemeFigures(b, s, { y }, id, y.storeys ? `${storeyWord(y.storeys)} · ${area(y.gfa)} GFA${y.units.total ? ` · ${fmt(y.units.total)} units` : ''}` : 'the height plane over the site');
  const governs = y.governs === 'fsr' ? `The floor space ratio governs: the height would allow ${y.storeysByHeight} storeys.` : y.governs === 'envelope' ? 'The setbacks and the height govern: the floor space ratio is not reached.' : 'No floor space ratio is mapped: the height governs.';
  const what = `${storeyWord(y.storeys)}, ${m1(Math.round(y.heightM * 10) / 10)} to the roof: ${area(y.gfa)} of floor area (${ratio(y.gfa, A)})${y.units.total ? `, ${fmt(y.units.total)} apartments` : ''}${y.parking.total ? ` and ${fmt(y.parking.total)} parking spaces` : ''}`;
  const narrative = id === 'withinControls'
    ? brief([y.archetype === 'none' ? `${c.zoneCode ?? 'The zone'} takes no residential flat building, shop-top housing or office building.` : `Within the LEP's height and floor space ratio and the ADG's separations, the site holds ${what}.`, y.archetype === 'none' ? '' : governs])
    : id === 'affordableBonus'
      ? brief([`With ${pct}% more height and floor space ratio for 15% affordable housing, held for 15 years, the Housing SEPP's in-fill bonus gives ${what}.`,
        `That is ${area(y.gfa - s.base.gfa)}${y.units.total > s.base.units.total ? ` and ${fmt(y.units.total - s.base.units.total)} apartments` : ''} more than within the controls, about ${fmt(Math.round(y.units.total * 0.15))} of them affordable. Eligibility to confirm.`])
      : id === 'rebuiltAsStands'
        ? brief([`Kept and refurbished, or rebuilt on its footprint to the height it stands at, what stands holds ${what}.`,
          `That is ${area(y.gfa - s.base.gfa)}${y.units.total > s.base.units.total ? ` and ${fmt(y.units.total - s.base.units.total)} apartments` : ''} more than within the controls. Over the LEP's height and floor space ratio, it needs a clause 4.6 variation, argued on adding no bulk to what stands${y.archetype === 'residential' && s.base.archetype === 'none' ? ', and existing use rights for apartments the zone no longer permits' : ''}; to confirm with a planner.`])
      : brief([`Filled to the height plane within the setbacks, the envelope holds ${what}.`,
        c.fsr ? `That is ${area(y.gfa - s.base.gfa)} over the LEP's ${c.fsr.toFixed(2)}:1: the case a clause 4.6 variation or a planning proposal has to carry.` : '']);
  return { id: `${String(n).padStart(2, '0')}_${id.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)}`, title: SCENARIO_TITLE[id], subtitle: subtitleOf(b, s), textHtml: '',
    figureHtml: zFlow(blocks) + figures.html, full: true, narrative, accent: id === 'envelopeToHeight' ? inks().F.deep : inks().accent,
    legend: schemeLegend(b, s, y, false, figures.kerbs), sources: `${NOT_A_DESIGN} ${PATH_BASIS[id]} Every assumption is on page ${String(last).padStart(2, '0')}.` };
}

const COUNT_WORD = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** What stands today: the building or buildings on the site, set against the paths. */
function standingSlide(b: YieldBundle, s: YieldStudy, paths: Path[], n: number): Slide {
  const A = b.siteAreaSqm ?? 0, c = b.controls;
  const ex = existingSummary(b.existing ?? [])!;
  const standing = standingOf(b, s);
  const figs = zFigures([
    ['buildings on the site', fmt(ex.count)],
    ['storeys · height', ex.storeys ? `~${ex.storeys}${ex.heightM ? ` · ${m1(Math.round(ex.heightM * 10) / 10)}` : ''}` : 'not recorded'],
    ['footprint', area(ex.footprintSqm)],
  ], [
    ['gross building area', ex.gbaSqm ? `≈ ${area(ex.gbaSqm)}` : 'not known without a height'],
    ['on the site', ex.gbaSqm && A ? about(ex.gbaSqm, A) : '—'],
    ['the LEP permits', c.fsr ? `${c.fsr.toFixed(2)}:1${A ? ` · ${area(c.fsr * A)}` : ''}` : 'no FSR mapped'],
  ], 9.6);
  const blocks = [zBlock('What stands', figs), ...pathBars(b, s, paths)];
  const figures = schemeFigures(b, s, { standing }, 'standing', standing.length ? 'at its recorded height, among the neighbours' : 'no outline of what stands in this bundle', 'What stands');
  const best = Math.max(...paths.filter((p) => p.y && p.sc.id !== 'rebuiltAsStands').map((p) => p.y!.gba), 0);
  const narrative = brief([
    `${ex.count === 1 ? 'A building' : `${COUNT_WORD[ex.count] ?? ex.count} buildings`} of ${ex.storeys ? `about ${ex.storeys} storeys` : 'unrecorded height'} ${ex.count === 1 ? 'stands' : 'stand'} on the site today, ${area(ex.footprintSqm)} on the ground${ex.gbaSqm ? ` and about ${area(ex.gbaSqm)} of floor${A ? `, ${about(ex.gbaSqm, A)}` : ''}` : ''}${c.fsr ? ` against the LEP's ${c.fsr.toFixed(2)}:1` : ''}.`,
    ex.gbaSqm && ex.gbaSqm > best
      ? `It is over today's controls: they have tightened since it was built, and redevelopment within them would cut the floor area.${s.retained ? ' The bulk need not be given up: kept, or rebuilt to its own envelope, it is the next spread\'s path.' : ' Its value is in what stands.'}`
      : ex.gbaSqm ? `Redevelopment within the controls would hold ${area(s.base.gfa)}, ${(s.base.gfa / ex.gbaSqm).toFixed(1)} times what stands.` : '',
  ]);
  return { id: `${String(n).padStart(2, '0')}_stands_today`, title: 'Stands today', subtitle: subtitleOf(b, s), textHtml: '', figureHtml: zFlow(blocks) + figures.html, full: true,
    narrative, accent: inks().accent, legend: schemeLegend(b, s, undefined, standing.length > 0, figures.kerbs),
    sources: `What stands is read from the recorded footprints and heights (${b.buildingsSource === 'overture' ? 'Overture, OSM where it has none' : 'OSM'}), its floor area each footprint by its storeys: indicative, not a survey.` };
}

/** The last spread: the assumptions on the left, the controls table in full on the right. */
function controlsSlide(b: YieldBundle, s: YieldStudy, n: number): Slide {
  const y = s.base, a = y.assumptions;
  const apartments = y.archetype === 'residential' || y.archetype === 'mixed';
  const pc = (v: number) => `${fmt(v * 100, (v * 100) % 1 ? 1 : 0)}%`;
  const EFFICIENCIES = ['residentialEfficiency', 'commercialEfficiency', 'retailEfficiency', 'nsaRatio', 'commercialNlaRatio', 'retailNlaRatio'] as const;
  const officeEfficiencies = EFFICIENCIES.every((k) => a[k] === DEFAULT_ASSUMPTIONS[k]);
  const officeMix = UNIT_KINDS.every((k) => a.mix[k] === DEFAULT_ASSUMPTIONS.mix[k] && a.sizes[k] === DEFAULT_ASSUMPTIONS.sizes[k]);
  const rows = [
    { label: 'floor to floor', value: `${y.archetype === 'mixed' ? `${a.groundRetailF2F} m retail ground floor, ` : ''}${y.archetype === 'commercial' ? `${a.commercialF2F} m commercial` : `${a.residentialF2F} m residential`}` },
    { label: 'roof and plant', value: `${a.roofAllowance} m kept under the height of building` },
    { label: 'efficiency', value: apartments
      ? `GFA ${pc(a.residentialEfficiency)} of GBA residential${y.archetype === 'mixed' ? `, ${pc(a.retailEfficiency)} retail` : ''}; NSA ${pc(a.nsaRatio)} of residential GFA${y.archetype === 'mixed' ? `, retail NLA ${pc(a.retailNlaRatio)}` : ''}`
      : `GFA ${pc(a.commercialEfficiency)} of GBA; NLA ${pc(a.commercialNlaRatio)} of GFA`, note: officeEfficiencies ? 'the office\'s feasibility template' : 'from yield_assumptions.json' },
    ...(apartments ? [
      { label: 'mix', value: `${inMix(y).map((k) => `${pc(a.mix[k])} ${UNIT_SHORT[k]} at ${fmt(a.sizes[k])} m²`).join(', ')}`, note: officeMix ? 'the office\'s feasibility template' : 'from yield_assumptions.json' },
      { label: 'plates', value: `held to ${m1(a.maxDepth)} deep; towers to ${area(a.towerPlateMax)} GBA` },
    ] : []),
    { label: 'parking rates', value: s.parkingSet === 'custom' ? 'from yield_assumptions.json' : PARKING_RATES[s.parkingSet].basis },
    { label: 'nearest station', value: b.station ? `${titleWords(b.station.name)}, ${fmt(b.station.distanceM)} m` : 'none within 1.2 km' },
    { label: 'affordable housing bonus', value: `${Math.round(a.affordableBonus * 100)}% more height and FSR for 15% affordable housing` },
  ];
  // The table, its site and summary sections left to the first spread.
  const table: string[] = [];
  let skip = false;
  for (const r of yieldRows(b, s)) {
    if (r.section) { skip = r.label === 'SITE INFO' || r.label === 'PROJECT SUMMARY'; if (!skip) table.push(`<tr class="sec"><td colspan="4">${esc(r.label ?? '')}</td></tr>`); continue; }
    if (skip) continue;
    if (r.head) { table.push('<tr class="hd"><td></td><td>Controls</td><td>Proposed</td><td></td></tr>'); continue; }
    const cell = (v?: string[]) => (v ?? []).filter(Boolean).map((t) => `<div>${esc(m2(t))}</div>`).join('');
    table.push(`<tr><td class="l">${esc(r.label ?? '')}</td><td${r.proposed ? '' : ' colspan="2"'}>${cell(r.controls)}</td>${r.proposed ? `<td>${cell(r.proposed)}</td>` : ''}<td>${okMark(r.ok)}</td></tr>`);
  }
  const right = `<div class="abs" data-fit style="left:${RX}mm;top:${RTOP}mm;width:${RW}mm;height:${RFOOT - RTOP}mm;overflow:hidden"><div class="ytw"><table class="yt yc"><colgroup><col style="width:42mm"><col><col><col style="width:5mm"></colgroup><tbody>${table.join('')}</tbody></table></div></div>`;
  return { id: `${String(n).padStart(2, '0')}_controls_and_assumptions`, title: 'Controls and assumptions', subtitle: subtitleOf(b, s), textHtml: '',
    figureHtml: zFlow([zBlock('The assumptions', zTable(rows))]) + right, full: true, accent: inks().accent,
    narrative: 'Every figure rests on these assumptions. Each can be changed in yield_assumptions.json beside the output, and the study drawn again. The table sets the scheme within the controls against each control.',
    sources: `Controls from the NSW ePlanning layers at the site; the Apartment Design Guide; the Housing SEPP 2021. ${NOT_A_DESIGN.replace(/^A feasibility study, not a design: [^;]+; /, '')}` };
}

/** The planning yield as a deck: the A3 spreads of the site report, in one of the maps' styles (the active template's where unnamed). */
export function renderYieldDeck(b: YieldBundle, meta: SheetMeta, opts: DeckRenderOptions = {}): { html: string; slides: Slide[] } {
  return withTemplate(templateFor('yield', opts.theme ?? tpl().id), () => withDeckOptions(opts, () => drawYieldDeck(b, meta)));
}

function drawYieldDeck(b: YieldBundle, _meta: SheetMeta): { html: string; slides: Slide[] } {
  const s = yieldStudy(b);
  const paths = pathsOf(b, s);
  const slides: Slide[] = [overviewSlide(b, s, paths)];
  paths.forEach((p) => slides.push(p.y ? schemeSlide(b, s, p, slides.length + 1, paths.length + 2) : standingSlide(b, s, paths, slides.length + 1)));
  slides.push(controlsSlide(b, s, slides.length + 1));
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(b.siteAddress)} — PLANNING YIELD</title>
<style>
${deckCss()}${YIELD_CSS}</style></head>
<body>${slides.map((sl, i) => atlasPage(sl, i)).join('\n')}</body></html>`;
  return { html, slides };
}

/** The yield's tables, in the atlas pages' type: 6 pt grey heads, 7.5 pt rows, hairlines. */
const YIELD_CSS = `
  .slide.atlas table.yt { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 7.5pt; }
  .slide.atlas table.yt.yf { table-layout: fixed; }
  .slide.atlas .ytw { font-size: 7.5pt; }
  .slide.atlas .ytw table.yt { font-size: 1em; }
  .slide.atlas table.yt th { font-size: 0.8em; line-height: 1.4; letter-spacing: 0.09em; text-transform: uppercase; font-weight: 400; color: #878787; text-align: left; padding: 1.2mm 1.4mm 0.7mm 0; vertical-align: bottom; white-space: nowrap; }
  .slide.atlas table.yt td { line-height: 1.3; padding: 0.75mm 1.4mm 0.85mm 0; border-bottom: 0.18mm solid #878787; vertical-align: top; }
  .slide.atlas table.yt .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .slide.atlas table.yt th:last-child, .slide.atlas table.yt td:last-child { padding-right: 0; }
  .slide.atlas table.yt tr.tot td { font-weight: 700; }
  .slide.atlas table.yt tr.hi td { font-weight: 700; }
  .slide.atlas table.yt tr.dim td { color: #878787; }
  .slide.atlas table.yt svg.mk { display: block; margin-top: 0.15mm; }
  .slide.atlas table.yc td.l { font-size: 0.8em; letter-spacing: 0.09em; text-transform: uppercase; padding-top: 1.1mm; }
  .slide.atlas table.yc tr.sec td { font-size: 1.33em; line-height: 1.15; padding: 4mm 0 1mm; border-bottom: 0.18mm solid #000000; }
  .slide.atlas table.yc tr:first-child td { padding-top: 0.6mm; }
  .slide.atlas table.yc tr.hd td { font-size: 0.8em; letter-spacing: 0.09em; text-transform: uppercase; color: #878787; padding: 1mm 1.4mm 0.6mm 0; }
  .slide.atlas .ytier { display: inline-block; width: 3.4mm; height: 3.4mm; border-radius: 1.7mm; border: 0.25mm solid ${ENVELOPE}; color: ${ENVELOPE}; font-size: 6pt; line-height: 2.95mm; text-align: center; font-weight: 700; box-sizing: border-box; }
  .slide.atlas .ynote { font-size: 8pt; line-height: 3.4mm; padding-top: 1.5mm; }
  .slide.atlas .zh span.zn { left: auto; right: 0; top: 1.4mm; font-size: 6pt; letter-spacing: 0.09em; text-transform: uppercase; color: #878787; }
`;

// ---- the open formats -------------------------------------------------------------

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV: section, item, controls, proposed, compliance. */
export function yieldCsv(b: YieldBundle): string {
  const s = yieldStudy(b);
  const lines = [['SECTION', 'ITEM', 'CONTROLS', 'PROPOSED', 'COMPLIANCE'].join(',')];
  let section = '';
  for (const r of yieldRows(b, s)) {
    if (r.section) { section = r.label ?? ''; continue; }
    if (r.head) continue;
    lines.push([section, r.label ?? '', (r.controls ?? []).filter(Boolean).join(' '), (r.proposed ?? []).filter(Boolean).join(' '),
      r.ok === true ? 'yes' : r.ok === false ? 'no' : r.ok === null ? 'to design' : ''].map(csvCell).join(','));
  }
  for (const sc of scenarioRows(b, s)) {
    const figures = [sc.storeys && `${sc.storeys} storeys`, sc.heightM && m1(sc.heightM), sc.gfa, sc.fsr && `FSR ${sc.fsr}`,
      sc.units && `${sc.units} units`, sc.parking && `${sc.parking} spaces`].filter(Boolean).join(', ');
    lines.push(['SCENARIOS', sc.label, sc.note, figures,
      sc.ok === true ? 'yes' : sc.ok === false ? 'no' : sc.ok === null ? 'to confirm' : ''].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** The study as JSON: the table, and the numbers behind it, with the outlines left out. */
export function yieldJson(b: YieldBundle): string {
  const s = yieldStudy(b);
  const strip = (y?: YieldResult) => y && { ...y, tiers: y.tiers.map(({ envelope: _e, plate: _p, ...t }) => t) };
  return JSON.stringify({
    address: b.address, siteAddress: b.siteAddress, lotDescription: b.lotDescription, siteAreaSqm: b.siteAreaSqm,
    siteAreaSource: 'NSW cadastre (confirm against survey)', planningControls: b.controls, groundRL: b.groundRL,
    station: b.station, cbd: b.cbd, policyAtSite: b.policyAtSite, frontages: s.frontageLengths, heightLimit: s.hob,
    parkingRates: s.parkingSet, standsToday: existingSummary(b.existing ?? []),
    study: strip(s.base), affordableHousingBonus: strip(s.bonus), envelopeToHeight: strip(s.max), rebuiltAsStands: strip(s.retained),
    scenarios: scenarioRows(b, s),
    table: yieldRows(b, s).filter((r) => !r.section && !r.head),
  }, null, 2);
}

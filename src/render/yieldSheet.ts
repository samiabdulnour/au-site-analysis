// PLANNING YIELD — what the controls let the site hold (sheet DA 002's
// successor in the options table).
//
// The left half is the development summary the office issues, with the
// column the generated summary had to leave empty now filled: CONTROLS,
// PROPOSED and COMPLIANCE, the proposal being the yield study's
// (lib/yield.ts), and under it the schedule of tiers, storeys and floor area
// with the assumptions the study rests on. The right half draws that study:
// the indicative massing as an axonometric among the neighbours at their
// recorded heights, with what each may rise to under its own height control
// dashed over it, and the envelope in plan with its setback tiers numbered.
//
// It is a feasibility figure, not a design: the envelope is the controls'
// and the ADG's, the plates are held to a building depth or a tower size, and
// every assumption — floor heights, efficiencies, the mix, the parking rates —
// is printed in the notes and can be changed in `yield_assumptions.json`
// beside the output.

import { FRAME_L, FRAME_T, esc, sheetHtml, SWATCH_X, SWATCH_W, LABEL_X } from './chrome.js';
import { tpl, withTemplate, DEFAULT_TEMPLATE } from './template.js';
import { wrapLabel, shortStreetName, type SheetMeta } from './sheet.js';
import { estimateKerbs, type KerbLine } from '../lib/kerbs.js';
import type { SummaryData } from './summarySheet.js';
import type { TopoRoad } from '../fetch/nswTopo.js';
import type { PolicyKind } from '../fetch/planning.js';
import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat } from '../lib/geo.js';
import {
  computeYield, edgeKinds, ringArea, withFour, futureHeight, PARKING_RATES, DEFAULT_ASSUMPTIONS, UNIT_KINDS, ADG_MINIMUM,
  type XY, type YieldAssumptions, type YieldResult, type Use, type Tier, type UnitKind, type FutureControls,
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
  return { base, bonus, ring, fronts, toLocal, hob, parkingSet, frontageLengths, futures };
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

// ---- the table, drawn -----------------------------------------------------------

const TAB_L = 45.6, TAB_R = 384;
const COL_LABEL = 46.3, COL_CONTROLS = 104, COL_PROPOSED = 236, COL_OK = 368;
const TITLE_Y = 20.5, TABLE_TOP = 26.8, TITLE_SIZE = 8.23;
const BODY = 3.3, LEAD = 4.35, PAD_TOP = 4.6, ROW_MIN = 6.4, ROW_SECTION = 8.2, RULE_W = 0.12;
/** A one-line row, as the table works its height out. */
const ROW_ONE = Math.max(ROW_MIN, PAD_TOP + 2.2);

const txt = (x: number, y: number, s: string, bold = false, size = BODY, fill?: string, anchor = 'start') =>
  `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}"${bold ? ' font-weight="700"' : ''}${fill ? ` fill="${fill}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;

/** The label column breaks a clause number onto its own line, as the office's summary does; bold capitals run about 0.7 of the size. */
function labelLines(label: string): string[] {
  const clause = label.match(/^(\d+[A-Z]?\.)\s+(.+)$/);
  const maxChars = Math.floor((COL_CONTROLS - COL_LABEL - 3) / (BODY * 0.7));
  return [...(clause ? [clause[1]] : []), ...wrapLabel(clause ? clause[2] : label, maxChars)];
}

/** A cell's lines broken to its column's width (regular text, about 0.52 of the size a character). */
function wrapCell(lines: string[] | undefined, widthMm: number): string[] {
  const max = Math.floor(widthMm / (BODY * 0.52));
  const out: string[] = [];
  for (const line of lines ?? []) {
    let cur = '';
    for (const w of line.split(' ')) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > max && cur) { out.push(cur); cur = w; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

/** The ✓, the ✗ or the dash of the compliance column. */
function mark(x: number, y: number, ok: boolean | null | undefined): string {
  if (ok === undefined) return '';
  if (ok === null) return `<line x1="${x - 1.6}" y1="${y - 1.1}" x2="${x + 1.6}" y2="${y - 1.1}" stroke="#8a8a8a" stroke-width="0.35"/>`;
  return ok
    ? `<path d="M${x - 2},${y - 1.2} L${x - 0.6},${y + 0.3} L${x + 2.2},${y - 3}" fill="none" stroke="#2f8f55" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M${x - 1.7},${y - 2.9} L${x + 1.7},${y + 0.3} M${x + 1.7},${y - 2.9} L${x - 1.7},${y + 0.3}" stroke="#c8372d" stroke-width="0.55" stroke-linecap="round"/>`;
}

const rule = (y: number) => `<line x1="${TAB_L}" y1="${y.toFixed(2)}" x2="${TAB_R}" y2="${y.toFixed(2)}" stroke="${tpl().ink}" stroke-width="${RULE_W}"/>`;

/** The rows from `top` down, ruled; where the last rule fell. */
function renderTable(rows: YieldRow[], top: number): { svg: string; bottom: number } {
  const out: string[] = [];
  let y = top;
  out.push(rule(y));
  for (const r of rows) {
    const lab = !r.section && !r.head && r.label ? labelLines(r.label) : [];
    // A row with no proposal lets its controls run on over the proposed column.
    const ctl = wrapCell(r.controls, (r.proposed ? COL_PROPOSED : TAB_R) - COL_CONTROLS - 4);
    const prop = wrapCell(r.proposed, COL_OK - COL_PROPOSED - 4);
    const lines = Math.max(ctl.length || 1, prop.length || 1, lab.length, 1);
    const h = r.section ? ROW_SECTION : Math.max(ROW_MIN, PAD_TOP + (lines - 1) * LEAD + 2.2);
    const base = y + PAD_TOP;
    if (r.section) out.push(txt(COL_LABEL, base + 0.6, r.label ?? '', true));
    else if (r.head) out.push(txt(COL_CONTROLS, base, 'CONTROLS', true), txt(COL_PROPOSED, base, 'PROPOSED', true), txt(COL_OK + 6, base, 'COMPLIANCE', true, BODY * 0.8, undefined, 'end'));
    else {
      lab.forEach((line, i) => out.push(txt(COL_LABEL, base + i * LEAD, line, true)));
      ctl.forEach((line, i) => { if (line) out.push(txt(COL_CONTROLS, base + i * LEAD, line)); });
      prop.forEach((line, i) => { if (line) out.push(txt(COL_PROPOSED, base + i * LEAD, line)); });
      out.push(mark(COL_OK + 2, base, r.ok));
    }
    y += h;
    out.push(rule(y));
  }
  return { svg: out.join(''), bottom: y };
}

/** A tier's number in its ring: the plan's mark, and the schedule's key to it. */
function tierBadge(x: number, y: number, n: number, r = 2): string {
  return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="#ffffff" stroke="${ENVELOPE}" stroke-width="0.25"/>` +
    `<text x="${x.toFixed(2)}" y="${(y + r * 0.47).toFixed(2)}" text-anchor="middle" font-size="${(r * 1.3).toFixed(2)}" font-weight="700" fill="${ENVELOPE}">${n}</text>`;
}

/**
 * The schedule, under the summary and ruled as it is: one row per tier keyed
 * to the plan's numbers, and the totals. Each column is set out for its
 * longest entry, the areas set right so their digits line up.
 */
function renderSchedule(y: YieldResult, top: number): { svg: string; bottom: number } {
  const out: string[] = [];
  const C = { storeys: 62, use: 96, setbacks: 162, envelope: 262, plate: 320, gfa: TAB_R - 3 };
  let yy = top;
  out.push(rule(yy));
  out.push(txt(COL_LABEL, yy + PAD_TOP + 0.6, 'SCHEDULE', true));
  yy += ROW_SECTION;
  out.push(rule(yy));
  // A row's cells are worked out when it is set, at the row's own height.
  const row = (cells: () => string[]) => { out.push(...cells()); yy += ROW_ONE; out.push(rule(yy)); };
  row(() => {
    const b = yy + PAD_TOP;
    return [txt(COL_LABEL, b, 'TIER', true), txt(C.storeys, b, 'STOREYS', true), txt(C.use, b, 'USE', true), txt(C.setbacks, b, 'SETBACKS FRONT / SIDE / REAR', true),
      txt(C.envelope, b, 'ENVELOPE', true, BODY, undefined, 'end'), txt(C.plate, b, 'PLATE GBA', true, BODY, undefined, 'end'), txt(C.gfa, b, 'GFA', true, BODY, undefined, 'end')];
  });
  if (!y.tiers.length) {
    row(() => [txt(C.storeys, yy + PAD_TOP, 'No building type is studied for this zone: the floor space ratio\'s floor area alone.')]);
    return { svg: out.join(''), bottom: yy };
  }
  const gfaOf = (t: Tier) => y.floors.filter((f) => f.storey >= t.from && f.storey <= t.to).reduce((sum, f) => sum + f.gfa, 0);
  const a = y.assumptions;
  y.tiers.forEach((t, i) => {
    const built = Math.max(0, Math.min(t.to, y.storeys) - t.from + 1);
    const ink = built ? undefined : '#9a9a9a';
    const st = t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`;
    const held = t.held === 'tower' ? `, tower plate to ${sqm(a.towerPlateMax)}` : t.held === 'depth' ? `, ${m1(a.maxDepth)} deep` : '';
    const set = (v: number) => fmt(v, v % 1 ? 1 : 0);
    row(() => {
      const b = yy + PAD_TOP;
      return [tierBadge(COL_LABEL + 2.6, b - 1.1, i + 1, 2.3), txt(C.storeys, b, built && built < t.to - t.from + 1 ? `${st} (${built} built)` : st, false, BODY, ink),
        txt(C.use, b, USE_WORD[t.use] + held, false, BODY, ink), txt(C.setbacks, b, `${set(t.front)} / ${set(t.side)} / ${set(t.rear)}m`, false, BODY, ink),
        txt(C.envelope, b, sqm(t.envelopeSqm), false, BODY, ink, 'end'), txt(C.plate, b, sqm(t.plateSqm), false, BODY, ink, 'end'), txt(C.gfa, b, built ? sqm(gfaOf(t)) : 'not built', false, BODY, ink, 'end')];
    });
  });
  row(() => {
    const b = yy + PAD_TOP;
    return [txt(COL_LABEL, b, 'TOTAL', true), txt(C.storeys, b, `${y.storeys} ${y.storeys === 1 ? 'storey' : 'storeys'}`, true), txt(C.plate, b, sqm(y.gba), true, BODY, undefined, 'end'), txt(C.gfa, b, sqm(y.gfa), true, BODY, undefined, 'end')];
  });
  // The apartments: each kind in the mix with its share, the ADG's least
  // area for it, its own area, how many there are and the area they take.
  if (y.units.total) {
    const kinds = inMix(y);
    const pc = (v: number) => `${fmt(v * 100, (v * 100) % 1 ? 1 : 0)}%`;
    row(() => {
      const b = yy + PAD_TOP;
      return [txt(COL_LABEL, b, 'UNIT', true), txt(C.storeys, b, 'SHARE', true), txt(C.setbacks, b, 'ADG 4D MINIMUM', true),
        txt(C.envelope, b, 'AREA EACH', true, BODY, undefined, 'end'), txt(C.plate, b, 'UNITS', true, BODY, undefined, 'end'), txt(C.gfa, b, 'AREA', true, BODY, undefined, 'end')];
    });
    for (const k of kinds) row(() => {
      const b = yy + PAD_TOP;
      return [txt(COL_LABEL, b, UNIT_SHORT[k].toUpperCase(), true), txt(C.storeys, b, pc(a.mix[k])), txt(C.setbacks, b, sqm(ADG_MINIMUM[k])),
        txt(C.envelope, b, sqm(a.sizes[k]), false, BODY, undefined, 'end'), txt(C.plate, b, fmt(y.units[k]), false, BODY, undefined, 'end'), txt(C.gfa, b, sqm(y.units[k] * a.sizes[k]), false, BODY, undefined, 'end')];
    });
    row(() => {
      const b = yy + PAD_TOP;
      return [txt(COL_LABEL, b, 'TOTAL', true), txt(C.envelope, b, `average ${fmt(y.averageUnitSqm, 1)} sqm`, true, BODY, undefined, 'end'),
        txt(C.plate, b, fmt(y.units.total), true, BODY, undefined, 'end'), txt(C.gfa, b, sqm(kinds.reduce((t, k) => t + y.units[k] * a.sizes[k], 0)), true, BODY, undefined, 'end')];
    });
  }
  return { svg: out.join(''), bottom: yy };
}

// ---- the drawings ------------------------------------------------------------------

/** Each use's colour in the massing and the plan. */
const USE_FILL: Record<Use, string> = { residential: '#f0c9a6', retail: '#e69ea1', commercial: '#a9cfe9' };
const CONTEXT_FILL = '#e9e9e6', CONTEXT_EDGE = '#a3a39e';
/** A neighbour's future, over what stands: a pale glass, dashed, light enough to see the proposal through. */
const FUTURE_FILL = '#e4ebf3', FUTURE_EDGE = '#8495a8', FUTURE_OPACITY = 0.3, FUTURE_DASH = '1.4,0.8';
const SITE_RED = '#c8372d', ENVELOPE = '#5b6670';

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
function axonometric(b: YieldBundle, s: YieldStudy, box: { x: number; y: number; w: number; h: number }): string {
  const y = s.base;
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
  const z = storeyZ(y);
  const built: Prism[] = [];
  for (const t of y.tiers) {
    const top = Math.min(t.to, y.storeys);
    if (top < t.from || !t.plate.length) continue;
    built.push({ rings: t.plate, z0: z.bottom(t.from), z1: z.top(top), fill: USE_FILL[t.use], edge: '#3a3a3a', edgeW: 0.16, storeys: Array.from({ length: top - t.from }, (_, i) => z.top(t.from + i)) });
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
  ground.push(`<path d="${poly(s.ring.map((p) => P(p, 0)))}" fill="${SITE_RED}" fill-opacity="0.08" stroke="${SITE_RED}" stroke-width="0.35"/>`);
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
  for (const t of y.tiers) {
    const zt = z.top(t.to);
    for (const rg of t.envelope) over.push(`<path d="${poly(rg.map((p) => P(p, zt)))}" fill="none" stroke="${ENVELOPE}" stroke-width="0.22" stroke-dasharray="1.6,1"/>`);
  }
  if (s.hob?.metres) {
    const hz = s.hob.metres;
    over.push(`<path d="${poly(s.ring.map((p) => P(p, hz)))}" fill="${SITE_RED}" fill-opacity="0.05" stroke="${SITE_RED}" stroke-width="0.3" stroke-dasharray="2.4,1.2"/>`);
    for (const p of s.ring) { const [x1, y1] = P(p, 0), [x2, y2] = P(p, hz); over.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${SITE_RED}" stroke-width="0.12" stroke-dasharray="1,1"/>`); }
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
  if (s.hob?.metres && !planeFits) notes.push(note(notes.length, SITE_RED, `HEIGHT OF BUILDING PLANE ${s.hob.rl ? `RL ${fmt(s.hob.value, 1)}, ` : ''}${fmt(Math.round(planeZ))}m ABOVE THE GROUND, ABOVE THE FRAME`));
  if (futureTop > cap) notes.push(note(notes.length, FUTURE_EDGE, `NEIGHBOURS' FUTURE HEIGHTS RUN ABOVE THE FRAME, TO ${fmt(Math.round(futureTop))}m`));
  const above = notes.join('');
  return `<defs><clipPath id="axoclip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>
    <g clip-path="url(#axoclip)"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})">
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
function planView(b: YieldBundle, s: YieldStudy, box: { x: number; y: number; w: number; h: number }): PlanResult {
  const y = s.base;
  const xs = s.ring.map((p) => p.x), ys = s.ring.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const scale = [100, 200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000].find((sc) => (w * 1.35 * 1000) / sc <= box.w && (h * 1.35 * 1000) / sc <= box.h) ?? 5000;
  const mm = 1000 / scale;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const at = (p: XY): [number, number] => [box.x + box.w / 2 + (p.x - cx) * mm, box.y + box.h / 2 - (p.y - cy) * mm];
  const P = (p: XY): string => at(p).map((v) => v.toFixed(2)).join(',');
  const path = (rg: XY[]) => `M${rg.map(P).join('L')}Z`;
  const line = (rg: XY[]) => `M${rg.map(P).join('L')}`;
  const local = (rg: number[][]) => rg.map(([lon, lat]) => s.toLocal(lon, lat));
  // What is written is kept apart: each word's box, in sheet millimetres.
  type Box = [number, number, number, number];
  const taken: Box[] = [];
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
  out.push(`<path d="${parcels.flatMap((pc) => pc.local.map(path)).join('')}" fill="none" stroke="${LOT_INK}" stroke-width="0.15"/>`);
  let kerbs = b.kerbs;
  if (!kerbs) {
    try { kerbs = estimateKerbs(parcels.flatMap((pc) => pc.rings), b.roads, [], []); } catch { kerbs = []; }
  }
  if (kerbs.length) out.push(`<path d="${kerbs.map((kl) => line(local(kl.coords))).join('')}" fill="none" stroke="${KERB_INK}" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round"/>`);
  const blds = b.context.map((cb) => local(cb.rings[0] ?? [])).filter((rg) => rg.length >= 3);
  for (const rg of blds) out.push(`<path d="${path(rg)}" fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.12"/>`);

  // The study: the plates, widest tier first so the narrower ones over it stay visible; each tier's envelope; the site.
  const tiers = [...y.tiers].sort((p, q) => q.envelopeSqm - p.envelopeSqm);
  for (const t of tiers) {
    const built = t.from <= y.storeys;
    if (t.plate.length) out.push(`<path d="${t.plate.map(path).join('')}" fill="${USE_FILL[t.use]}" fill-opacity="${built ? 0.55 : 0.18}" fill-rule="evenodd" stroke="none"/>`);
  }
  y.tiers.forEach((t, i) => { for (const rg of t.envelope) out.push(`<path d="${path(rg)}" fill="none" stroke="${ENVELOPE}" stroke-width="0.3" stroke-dasharray="${['2,1', '1.2,1.2', '3,1,0.8,1', '0.6,0.9'][i % 4]}"/>`); });
  out.push(`<path d="${path(s.ring)}" fill="none" stroke="${SITE_RED}" stroke-width="0.6" stroke-dasharray="3,1.2"/>`);

  // North, and a bar of round metres, first: what is written later keeps off them.
  const nx = box.x + box.w - 7, ny = box.y + 8;
  out.push(`<g transform="translate(${nx},${ny})"><path d="M0,-4.4 L1.6,3.6 L0,2 L-1.6,3.6 Z" fill="#1c1c1c"/><text y="-5.6" text-anchor="middle" font-size="2.8" font-weight="700">N</text></g>`);
  taken.push([nx - 4, ny - 9, nx + 4, ny + 5]);
  const bar = [5, 10, 20, 50, 100].find((m) => m * mm >= 18) ?? 100;
  const bx = box.x + 2, by = box.y + box.h - 3;
  out.push(`<path d="M${bx},${by - 1.4} V${by} H${bx + bar * mm} V${by - 1.4} M${bx + (bar * mm) / 2},${by} V${by - 0.8}" fill="none" stroke="#1c1c1c" stroke-width="0.25"/><text x="${bx}" y="${by - 2.2}" font-size="2.4">0</text><text x="${(bx + bar * mm).toFixed(2)}" y="${by - 2.2}" text-anchor="middle" font-size="2.4">${bar}m</text>`);
  taken.push([bx - 1, by - 5, bx + bar * mm + 4, by + 1]);

  // Each tier's number in the band of the envelope that is its own, keyed to
  // the schedule, drawn toward the middle of the main street frontage so the
  // numbers read in from the street.
  const R = 2.2;
  const placed: XY[] = [];
  const anchor = frontageMiddle(s.ring, b.frontages);
  y.tiers.forEach((t, i) => {
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
      const id = `yrd${defs.length}`;
      defs.push(`<path id="${id}" d="M${p0[0].toFixed(2)},${p0[1].toFixed(2)}L${p1[0].toFixed(2)},${p1[1].toFixed(2)}" fill="none"/>`);
      out.push(`<text font-size="${FS}" font-weight="700" letter-spacing="0.5" dy="${(FS * 0.36).toFixed(2)}" fill="${STREET_INK}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
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
    out.push(`<text transform="translate(${lx.toFixed(2)},${ly.toFixed(2)}) rotate(${ang.toFixed(1)})" y="1" text-anchor="middle" font-size="${FS}" font-weight="700" letter-spacing="0.5" fill="${STREET_INK}">${esc(shortStreetName(name).toUpperCase())}</text>`);
  });

  // On each numbered neighbour: its number, then its zone and height of
  // building, written in its building where they fit (the largest on the lot),
  // else on the lot; the lots next to the site first.
  const F1 = 2.6, F2 = 2.3, LH = 3.1;
  const labelled = parcels.filter((pc) => !pc.site && pc.numbers?.length && pc.shown.length)
    .map((pc) => ({ pc, d: Math.min(...(pc.local[0] ?? []).map((p) => Math.min(...s.ring.map((q) => Math.hypot(p.x - q.x, p.y - q.y))))) }))
    .sort((p, q) => p.d - q.d);
  const within = (p: XY, rs: XY[][]) => rs.filter((rg) => inRing(p, rg)).length % 2 === 1;
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
    svg: `<defs><clipPath id="planclip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath>${defs.join('')}</defs><g clip-path="url(#planclip)">${out.join('')}</g>`,
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

// ---- the sheet -------------------------------------------------------------------------

/** The planning yield: no themes, drawn in the default template like the summary it replaces. */
export function renderYieldSheet(b: YieldBundle, meta: SheetMeta): string {
  return withTemplate(DEFAULT_TEMPLATE, () => drawYieldSheet(b, meta));
}

function drawYieldSheet(b: YieldBundle, meta: SheetMeta): string {
  const s = yieldStudy(b);
  const y = s.base, a = y.assumptions;
  const rows = yieldRows(b, s);
  const ink = tpl().ink;

  // The left half: the summary, then the schedule and what it rests on, ruled as one table.
  const apartments = y.archetype === 'residential' || y.archetype === 'mixed';
  const pc = (v: number) => `${fmt(v * 100, (v * 100) % 1 ? 1 : 0)}%`;
  const EFFICIENCIES = ['residentialEfficiency', 'commercialEfficiency', 'retailEfficiency', 'nsaRatio', 'commercialNlaRatio', 'retailNlaRatio'] as const;
  const officeEfficiencies = EFFICIENCIES.every((k) => a[k] === DEFAULT_ASSUMPTIONS[k]);
  const assumptionRows: YieldRow[] = [
    { label: 'ASSUMPTIONS', section: true },
    { label: 'FLOOR TO FLOOR', controls: [`${y.archetype === 'mixed' ? `${a.groundRetailF2F}m retail ground floor, ` : ''}${y.archetype === 'commercial' ? `${a.commercialF2F}m commercial` : `${a.residentialF2F}m residential`}`] },
    { label: 'ROOF AND PLANT', controls: [`${a.roofAllowance}m kept under the height of building`] },
    { label: 'EFFICIENCY', controls: [`${officeEfficiencies ? 'the office\'s feasibility template' : 'from yield_assumptions.json'}: ${apartments
      ? `GFA ${pc(a.residentialEfficiency)} of GBA residential${y.archetype === 'mixed' ? `, ${pc(a.retailEfficiency)} retail` : ''}; NLA (saleable) ${pc(a.nsaRatio)} of residential GFA${y.archetype === 'mixed' ? `, ${pc(a.retailNlaRatio)} retail` : ''}`
      : `GFA ${pc(a.commercialEfficiency)} of GBA; NLA ${pc(a.commercialNlaRatio)} of GFA`}`] },
    ...(apartments ? [
      { label: 'MIX', controls: [`${UNIT_KINDS.every((k) => a.mix[k] === DEFAULT_ASSUMPTIONS.mix[k] && a.sizes[k] === DEFAULT_ASSUMPTIONS.sizes[k]) ? 'the office\'s feasibility template' : 'from yield_assumptions.json'}: ${inMix(y).map((k) => `${pc(a.mix[k])} ${UNIT_SHORT[k]} at ${fmt(a.sizes[k])} sqm`).join(', ')}; average ${fmt(y.averageUnitSqm, 1)} sqm`] },
      { label: 'PLATES', controls: [`held to ${m1(a.maxDepth)} deep; towers to ${sqm(a.towerPlateMax)} GBA`] },
    ] : []),
    { label: 'NEAREST STATION', controls: [b.station ? `${titleWords(b.station.name)}, ${fmt(b.station.distanceM)}m` : 'none within 1.2 km'] },
    { label: 'TO CHANGE', controls: ['every figure here is set in yield_assumptions.json beside the output'] },
  ];
  const summary = renderTable(rows, TABLE_TOP);
  const sched = renderSchedule(y, summary.bottom + 6);
  const notes = renderTable(assumptionRows, sched.bottom);
  const left = txt(COL_LABEL, TITLE_Y, 'PLANNING YIELD', true, TITLE_SIZE) + summary.svg + sched.svg + notes.svg;

  // The right half: the massing over the envelope plan, the plan the width of the half.
  const RX = 398, RW = 327, BOTTOM = 562.8;
  const right: string[] = [];
  const heading = (x: number, yy: number, t: string, note?: string) =>
    txt(x, yy, t, true, 4.2) + (note ? txt(x + t.length * 2.75 + 4, yy, note, false, 3, '#6a6a6a') : '');
  right.push(heading(RX, TITLE_Y, 'INDICATIVE MASSING', y.storeys ? `${y.storeys} storeys · ${sqm(y.gfa)} GFA${y.units.total ? ` · ${y.units.total} units` : ''}` : 'the height plane over the site'));
  right.push(`<line x1="${RX}" y1="${TABLE_TOP}" x2="${RX + RW}" y2="${TABLE_TOP}" stroke="${ink}" stroke-width="${RULE_W}"/>`);
  right.push(axonometric(b, s, { x: RX, y: TABLE_TOP + 4, w: RW, h: 280 }));
  const PY = TABLE_TOP + 292;
  const plan = planView(b, s, { x: RX, y: PY + 10, w: RW, h: BOTTOM - PY - 10 });
  right.push(heading(RX, PY + 4.6, 'ENVELOPE', `plan 1:${fmt(plan.scale)} · tiers numbered as in the schedule`), `<line x1="${RX}" y1="${PY + 7}" x2="${RX + RW}" y2="${PY + 7}" stroke="${ink}" stroke-width="${RULE_W}"/>`, plan.svg);

  // The legend column: the massing's key, then what the sheet is and is not.
  let legend = '';
  let ly = 7;
  const row = (swatch: string, label: string) => {
    const lines = wrapLabel(label, 26);
    legend += `<g transform="translate(0,${ly})">${swatch}${lines.map((l, i) => `<text x="${LABEL_X}" y="${3.5 + i * 3.2}" font-size="2.6" fill="#222">${esc(l)}</text>`).join('')}</g>`;
    ly += Math.max(10, lines.length * 3.2 + 4);
  };
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${SITE_RED}" fill-opacity="0.08" stroke="${SITE_RED}" stroke-width="0.6" stroke-dasharray="3,1.2"/>`, 'SITE');
  for (const u of ['residential', 'retail', 'commercial'] as Use[]) if (y.tiers.some((t) => t.use === u)) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${USE_FILL[u]}" stroke="#3a3a3a" stroke-width="0.2"/>`, `INDICATIVE MASSING, ${USE_WORD[u].toUpperCase()}`);
  if (y.tiers.length) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${ENVELOPE}" stroke-width="0.4" stroke-dasharray="1.6,1"/>`, 'ENVELOPE OF EACH TIER');
  if (s.hob?.metres) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${SITE_RED}" fill-opacity="0.05" stroke="${SITE_RED}" stroke-width="0.4" stroke-dasharray="2.4,1.2"/>`, 'HEIGHT OF BUILDING PLANE');
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.25"/>`, `NEIGHBOURS AT THEIR HEIGHTS (${b.buildingsSource === 'overture' ? 'OVERTURE' : 'OSM'}; DASHED: NOT RECORDED)`);
  // The plan's kerbs.
  if (plan.kerbs.length) row(`<line x1="${SWATCH_X}" y1="3.25" x2="${SWATCH_X + SWATCH_W}" y2="3.25" stroke="${KERB_INK}" stroke-width="0.35"/>`, 'KERB LINE (INDICATIVE)');
  const futures = s.futures.some(Boolean);
  if (futures) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${FUTURE_FILL}" fill-opacity="${FUTURE_OPACITY}" stroke="${FUTURE_EDGE}" stroke-width="0.3" stroke-dasharray="${FUTURE_DASH}"/>`, "NEIGHBOURS' FUTURE HEIGHT, TO THEIR LEP HEIGHT AND FSR");
  const notesText = [
    'A feasibility study, not a design:',
    'the envelope follows the mapped LEP',
    'controls and the ADG\'s separations;',
    'DCP setbacks, street wall heights,',
    'solar access and overshadowing are',
    'for the design to test.',
    '',
    'Mapped controls are not a s10.7',
    'planning certificate.',
    ...(futures ? [
      '',
      'Future neighbours: each building in',
      'a zone that permits flats (R1, R3,',
      'R4, MU1, E1, E2, B1–B4), raised to',
      'the whole 3.1m storeys its LEP',
      'height of building allows, and no',
      'more than its lot\'s floor space',
      'ratio holds on its footprint; never',
      'lowered.',
    ] : []),
  ];
  ly += 2;
  legend += `<text x="0" y="${ly}" font-size="2.9" font-weight="700" fill="${ink}">NOTES</text>`;
  notesText.forEach((l, i) => { legend += `<text x="0" y="${(ly + 4.4 + i * 3.2).toFixed(1)}" font-size="2.4" fill="#333">${esc(l)}</text>`; });

  return sheetHtml({
    meta,
    address: b.address,
    generatedAt: b.generatedAt,
    siteAddress: b.siteAddress,
    scale: 0,
    rotationDeg: 0,
    drawingTitle: 'PLANNING YIELD',
    legendHeading: 'LEGEND',
    legendSvg: `<g font-family="${tpl().font}">${legend}</g>`,
    layers: [`<g transform="translate(${-FRAME_L},${-FRAME_T})" font-family="${tpl().font}" fill="${ink}">${left}${right.join('')}</g>`],
    noMap: true,
  });
}

// ---- the open formats -------------------------------------------------------------

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The table as CSV: section, item, controls, proposed, compliance. */
export function yieldCsv(b: YieldBundle): string {
  const lines = [['SECTION', 'ITEM', 'CONTROLS', 'PROPOSED', 'COMPLIANCE'].join(',')];
  let section = '';
  for (const r of yieldRows(b)) {
    if (r.section) { section = r.label ?? ''; continue; }
    if (r.head) continue;
    lines.push([section, r.label ?? '', (r.controls ?? []).filter(Boolean).join(' '), (r.proposed ?? []).filter(Boolean).join(' '),
      r.ok === true ? 'yes' : r.ok === false ? 'no' : r.ok === null ? 'to design' : ''].map(csvCell).join(','));
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
    parkingRates: s.parkingSet, study: strip(s.base), affordableHousingBonus: strip(s.bonus),
    table: yieldRows(b, s).filter((r) => !r.section && !r.head),
  }, null, 2);
}

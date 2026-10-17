// PLANNING YIELD — what the controls let the site hold (sheet DA 002's
// successor in the options table).
//
// The left half is the development summary the office issues, with the
// column the generated summary had to leave empty now filled: CONTROLS,
// PROPOSED and COMPLIANCE, the proposal being the yield study's
// (lib/yield.ts). The right half draws that study: the indicative massing as
// an axonometric among the neighbours at their recorded heights, the envelope
// in plan with its setback tiers, and the schedule of storeys and floor area.
//
// It is a feasibility figure, not a design: the envelope is the controls'
// and the ADG's, the plates are held to a building depth or a tower size, and
// every assumption — floor heights, efficiencies, the mix, the parking rates —
// is printed in the notes and can be changed in `yield_assumptions.json`
// beside the output.

import { FRAME_L, FRAME_T, esc, sheetHtml, SWATCH_X, SWATCH_W, LABEL_X } from './chrome.js';
import { tpl, withTemplate, DEFAULT_TEMPLATE } from './template.js';
import { wrapLabel, type SheetMeta } from './sheet.js';
import type { SummaryData } from './summarySheet.js';
import type { TopoRoad } from '../fetch/nswTopo.js';
import type { PolicyKind } from '../fetch/planning.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat } from '../lib/geo.js';
import {
  computeYield, edgeKinds, PARKING_RATES, DEFAULT_ASSUMPTIONS,
  type XY, type YieldAssumptions, type YieldResult, type Use, type Tier,
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
  /** The lots around, as rings (lon/lat), for the plan. */
  lots: number[][][][];
  /** The neighbours' footprints with their heights, for the massing's context. */
  context: { rings: number[][][]; heightM: number; known: boolean }[];
  buildingsSource: string;
  /** From `yield_assumptions.json` beside the output, when there is one. */
  assumptions?: Partial<YieldAssumptions>;
}

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
  const assumptions: Partial<YieldAssumptions> = { ...b.assumptions, parking: { ...(parkingSet === 'custom' ? DEFAULT_ASSUMPTIONS.parking : PARKING_RATES[parkingSet]), ...b.assumptions?.parking } };

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
  return { base, bonus, ring, fronts, toLocal, hob, parkingSet, frontageLengths };
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
        ...(y.units.studio ? [`Studio: ${y.units.studio}`] : []),
        `1 Bedroom: ${y.units.one}`, `2 Bedroom: ${y.units.two}`, `3 Bedroom: ${y.units.three}`,
        `TOTAL UNITS: ${y.units.total}`,
      ],
    });
    if (y.gfaByUse.retail) rows.push({ label: 'RETAIL AREA (sqm)', controls: [`${sqm(y.gfaByUse.retail)} GFA, ground floor`] });
    if (y.gfaByUse.commercial) rows.push({ label: 'COMMERCIAL AREA (sqm)', controls: [`${sqm(y.gfaByUse.commercial)} GFA`, `${sqm(y.gfaByUse.commercial * 0.9)} NLA at 90%`] });
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
      rows.push({ label: 'RESIDENTIAL CAR PARKING', controls: [
        `${rate(p.one)} space per studio and 1 bedroom`, `${rate(p.two)} per 2 bedroom, ${rate(p.three)} per 3 bedroom`, `(${basis})`],
        proposed: [`${fmt(u.studio + u.one)} x ${fmt(p.one, 1)} + ${fmt(u.two)} x ${fmt(p.two, 1)} + ${fmt(u.three)} x ${fmt(p.three, 1)}`, `= ${y.parking.residents} spaces`], ok: true });
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
    const sz = a.sizes;
    rows.push({ label: '4D. APARTMENT SIZE', controls: ['Studio 35, 1 bed 50, 2 bed 70, 3 bed 90 sqm', '(+5 sqm for a second bathroom)'], proposed: [`${sz.studio}, ${sz.one}, ${sz.two} and ${sz.three} sqm assumed`], ok: sz.studio >= 35 && sz.one >= 50 && sz.two >= 70 && sz.three >= 90 });
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

function renderTable(rows: YieldRow[]): string {
  const out: string[] = [];
  const rule = (y: number) => `<line x1="${TAB_L}" y1="${y.toFixed(2)}" x2="${TAB_R}" y2="${y.toFixed(2)}" stroke="${tpl().ink}" stroke-width="${RULE_W}"/>`;
  out.push(txt(COL_LABEL, TITLE_Y, 'PLANNING YIELD', true, TITLE_SIZE));
  let y = TABLE_TOP;
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
  return out.join('');
}

// ---- the drawings ------------------------------------------------------------------

/** Each use's colour in the massing and the plan. */
const USE_FILL: Record<Use, string> = { residential: '#f0c9a6', retail: '#e69ea1', commercial: '#a9cfe9' };
const CONTEXT_FILL = '#e9e9e6', CONTEXT_EDGE = '#a3a39e';
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

interface Prism { rings: XY[][]; z0: number; z1: number; fill: string; edge: string; edgeW: number; storeys?: number[]; dashed?: boolean }

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
  for (const cb of b.context) {
    const rings = [cb.rings[0]?.map(([lon, lat]) => s.toLocal(lon, lat)) ?? []].filter((rg) => rg.length >= 3);
    if (!rings.length) continue;
    const cen = rings[0].reduce((t, p) => ({ x: t.x + p.x / rings[0].length, y: t.y + p.y / rings[0].length }), { x: 0, y: 0 });
    if (Math.hypot(cen.x, cen.y) > reach) continue;
    prisms.push({ key: depth(cen), group: [{ rings, z0: 0, z1: cb.known ? cb.heightM : 6.2, fill: CONTEXT_FILL, edge: CONTEXT_EDGE, edgeW: 0.12, dashed: !cb.known }] });
  }
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
  for (const lot of b.lots) for (const rg of lot) {
    const pts = rg.map(([lon, lat]) => s.toLocal(lon, lat));
    if (pts.some((p) => Math.hypot(p.x, p.y) > reach + 20)) continue;
    ground.push(`<path d="${poly(pts.map((p) => P(p, 0)))}" fill="none" stroke="#c9c9c4" stroke-width="0.12"/>`);
  }
  ground.push(`<path d="${poly(s.ring.map((p) => P(p, 0)))}" fill="${SITE_RED}" fill-opacity="0.08" stroke="${SITE_RED}" stroke-width="0.35"/>`);
  const prismSvg = (pr: Prism) => {
    const out: string[] = [];
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
        out.push(`<path d="${poly([P(f.p, pr.z0), P(f.q, pr.z0), P(f.q, pr.z1), P(f.p, pr.z1)])}" fill="${shade(pr.fill, lit)}" stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${pr.dashed ? ' stroke-dasharray="0.8,0.6"' : ''}/>`);
        for (const zz of pr.storeys ?? []) {
          const [x1, y1] = P(f.p, zz), [x2, y2] = P(f.q, zz);
          out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${shade(pr.fill, 0.62)}" stroke-width="0.08"/>`);
        }
      }
    }
    out.push(`<path d="${pr.rings.map((rg) => poly(rg.map((p) => P(p, pr.z1)))).join('')}" fill="${shade(pr.fill, 1.12)}" fill-rule="evenodd" stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${pr.dashed ? ' stroke-dasharray="0.8,0.6"' : ''}/>`);
    return out.join('');
  };
  for (const { group } of prisms) for (const pr of group) parts.push(prismSvg(pr));

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
  // frame says where it is.
  const pts: [number, number][] = [];
  let tallest = 0;
  for (const { group } of prisms) for (const pr of group) { tallest = Math.max(tallest, pr.z1); for (const rg of pr.rings) for (const p of rg) pts.push(P(p, pr.z0), P(p, pr.z1)); }
  const planeZ = s.hob?.metres ?? 0;
  const planeFits = planeZ <= Math.max(tallest, 12) * 1.6;
  for (const p of s.ring) pts.push(P(p, 0), P(p, planeFits ? planeZ : Math.max(tallest, 12) * 1.25));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min(box.w / (x1 - x0 || 1), box.h / (y1 - y0 || 1));
  const tx = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k, ty = box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  // Strokes are set in sheet millimetres: divide them back out of the scale.
  const above = s.hob?.metres && !planeFits
    ? `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + 4).toFixed(1)}" text-anchor="middle" font-size="2.8" fill="${SITE_RED}" stroke="#ffffff" stroke-width="1.4" paint-order="stroke">HEIGHT OF BUILDING PLANE ${s.hob.rl ? `RL ${fmt(s.hob.value, 1)}, ` : ''}${fmt(Math.round(planeZ))}m ABOVE THE GROUND, ABOVE THE FRAME</text>`
    : '';
  return `<defs><clipPath id="axoclip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>
    <g clip-path="url(#axoclip)"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})">
    <g style="vector-effect:non-scaling-stroke">${ground.join('')}${parts.join('')}${over.join('')}</g></g></g>${above}`;
}

/** The envelope in plan, north up, at a round scale: the lots, the neighbours, each tier's envelope and plate, the frontages named. */
function planView(b: YieldBundle, s: YieldStudy, box: { x: number; y: number; w: number; h: number }): { svg: string; scale: number } {
  const y = s.base;
  const xs = s.ring.map((p) => p.x), ys = s.ring.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const scale = [100, 200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000].find((sc) => (w * 1.35 * 1000) / sc <= box.w && (h * 1.35 * 1000) / sc <= box.h) ?? 5000;
  const mm = 1000 / scale;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const P = (p: XY): string => `${(box.x + box.w / 2 + (p.x - cx) * mm).toFixed(2)},${(box.y + box.h / 2 - (p.y - cy) * mm).toFixed(2)}`;
  const path = (rg: XY[]) => `M${rg.map(P).join('L')}Z`;
  const out: string[] = [];
  for (const lot of b.lots) for (const rg of lot) out.push(`<path d="${path(rg.map(([lon, lat]) => s.toLocal(lon, lat)))}" fill="none" stroke="#cfcfca" stroke-width="0.15"/>`);
  for (const cb of b.context) { const rg = cb.rings[0]; if (rg) out.push(`<path d="${path(rg.map(([lon, lat]) => s.toLocal(lon, lat)))}" fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.12"/>`); }
  // Widest tier first, so the narrower plates over it stay visible.
  const tiers = [...y.tiers].sort((p, q) => q.envelopeSqm - p.envelopeSqm);
  for (const t of tiers) {
    const built = t.from <= y.storeys;
    if (t.plate.length) out.push(`<path d="${t.plate.map(path).join('')}" fill="${USE_FILL[t.use]}" fill-opacity="${built ? 0.55 : 0.18}" fill-rule="evenodd" stroke="none"/>`);
  }
  y.tiers.forEach((t, i) => { for (const rg of t.envelope) out.push(`<path d="${path(rg)}" fill="none" stroke="${ENVELOPE}" stroke-width="0.3" stroke-dasharray="${['2,1', '1.2,1.2', '3,1,0.8,1', '0.6,0.9'][i % 4]}"/>`); });
  out.push(`<path d="${path(s.ring)}" fill="none" stroke="${SITE_RED}" stroke-width="0.6" stroke-dasharray="3,1.2"/>`);
  // Each tier's number at its envelope's middle, keyed to the schedule.
  y.tiers.forEach((t, i) => {
    const rg = t.envelope[0];
    if (!rg) return;
    const c = rg.reduce((a, p) => ({ x: a.x + p.x / rg.length, y: a.y + p.y / rg.length }), { x: 0, y: 0 });
    const [px, py] = P({ x: c.x + i * 2.5 * (scale / 500), y: c.y - i * 2.5 * (scale / 500) }).split(',').map(Number);
    out.push(`<circle cx="${px}" cy="${py}" r="2" fill="#ffffff" stroke="${ENVELOPE}" stroke-width="0.25"/><text x="${px}" y="${(py + 1).toFixed(2)}" text-anchor="middle" font-size="2.6" font-weight="700" fill="${ENVELOPE}">${i + 1}</text>`);
  });
  // The frontages named outside their edge.
  const done = new Set<string>();
  s.ring.forEach((p, i) => {
    const name = b.frontages[i];
    if (!name || done.has(name)) return;
    done.add(name);
    const q = s.ring[(i + 1) % s.ring.length];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    let sa = 0;
    for (let j = 0; j < s.ring.length; j++) { const u = s.ring[j], v = s.ring[(j + 1) % s.ring.length]; sa += u.x * v.y - v.x * u.y; }
    const n = sa > 0 ? { x: (q.y - p.y) / l, y: -(q.x - p.x) / l } : { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
    const off = 6 * (scale / 500) + 2;
    const [lx, ly] = P({ x: mid.x + n.x * off, y: mid.y + n.y * off }).split(',').map(Number);
    let ang = (-Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    out.push(`<text transform="translate(${lx},${ly}) rotate(${ang.toFixed(1)})" y="1" text-anchor="middle" font-size="2.8" font-weight="700" letter-spacing="0.5" fill="#555">${esc(name.toUpperCase())}</text>`);
  });
  // North, and a bar of round metres.
  const nx = box.x + box.w - 7, ny = box.y + 8;
  out.push(`<g transform="translate(${nx},${ny})"><path d="M0,-4.4 L1.6,3.6 L0,2 L-1.6,3.6 Z" fill="#1c1c1c"/><text y="-5.6" text-anchor="middle" font-size="2.8" font-weight="700">N</text></g>`);
  const bar = [5, 10, 20, 50, 100].find((m) => m * mm >= 18) ?? 100;
  const bx = box.x + 2, by = box.y + box.h - 3;
  out.push(`<path d="M${bx},${by - 1.4} V${by} H${bx + bar * mm} V${by - 1.4} M${bx + (bar * mm) / 2},${by} V${by - 0.8}" fill="none" stroke="#1c1c1c" stroke-width="0.25"/><text x="${bx}" y="${by - 2.2}" font-size="2.4">0</text><text x="${(bx + bar * mm).toFixed(2)}" y="${by - 2.2}" text-anchor="middle" font-size="2.4">${bar}m</text>`);
  return { svg: `<defs><clipPath id="planclip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs><g clip-path="url(#planclip)">${out.join('')}</g>`, scale };
}

/** The schedule: one row per tier, keyed to the plan's numbers, and the totals. */
function schedule(y: YieldResult, x: number, top: number, w: number): string {
  const out: string[] = [];
  const cols = [0, 7, 30, 52, 81, 103, 125].map((c) => x + (c * w) / 150);
  const fs = 2.75, lh = 4.6;
  const head = ['', 'STOREYS', 'USE', 'SETBACKS F/S/R', 'ENVELOPE', 'PLATE GBA', 'GFA'];
  head.forEach((t, i) => out.push(txt(cols[i], top, t, true, fs * 0.92)));
  out.push(`<line x1="${x}" y1="${(top + 1.4).toFixed(2)}" x2="${x + w}" y2="${(top + 1.4).toFixed(2)}" stroke="#1c1c1c" stroke-width="0.15"/>`);
  let yy = top + lh + 0.6;
  const gfaOf = (t: Tier) => y.floors.filter((f) => f.storey >= t.from && f.storey <= t.to).reduce((sum, f) => sum + f.gfa, 0);
  y.tiers.forEach((t, i) => {
    const built = Math.max(0, Math.min(t.to, y.storeys) - t.from + 1);
    const ink = built ? undefined : '#9a9a9a';
    const st = t.from === t.to ? `${t.from}` : `${t.from}–${t.to}`;
    out.push(txt(cols[0], yy, String(i + 1), true, fs, ink), txt(cols[1], yy, built && built < t.to - t.from + 1 ? `${st} (${built} built)` : st, false, fs, ink),
      txt(cols[2], yy, USE_WORD[t.use] + (t.held ? (t.held === 'tower' ? ', tower plate' : ', depth held') : ''), false, fs, ink),
      txt(cols[3], yy, `${fmt(t.front, t.front % 1 ? 1 : 0)} / ${fmt(t.side, t.side % 1 ? 1 : 0)} / ${fmt(t.rear, t.rear % 1 ? 1 : 0)}m`, false, fs, ink),
      txt(cols[4], yy, sqm(t.envelopeSqm), false, fs, ink), txt(cols[5], yy, sqm(t.plateSqm), false, fs, ink), txt(cols[6], yy, built ? sqm(gfaOf(t)) : 'not built', false, fs, ink));
    yy += lh;
  });
  out.push(`<line x1="${x}" y1="${(yy - lh + 1.4).toFixed(2)}" x2="${x + w}" y2="${(yy - lh + 1.4).toFixed(2)}" stroke="#1c1c1c" stroke-width="0.15"/>`);
  out.push(txt(cols[1], yy + 0.4, `${y.storeys}`, true, fs), txt(cols[2], yy + 0.4, 'total', true, fs), txt(cols[5], yy + 0.4, sqm(y.gba), true, fs), txt(cols[6], yy + 0.4, sqm(y.gfa), true, fs));
  return out.join('');
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

  // The right half: the massing over the envelope plan and the schedule.
  const RX = 398, RW = 327;
  const right: string[] = [];
  const heading = (x: number, yy: number, t: string, note?: string) =>
    txt(x, yy, t, true, 4.2) + (note ? txt(x + t.length * 2.75 + 4, yy, note, false, 3, '#6a6a6a') : '');
  right.push(heading(RX, TITLE_Y, 'INDICATIVE MASSING', y.storeys ? `${y.storeys} storeys · ${sqm(y.gfa)} GFA${y.units.total ? ` · ${y.units.total} units` : ''}` : 'the height plane over the site'));
  right.push(`<line x1="${RX}" y1="${TABLE_TOP}" x2="${RX + RW}" y2="${TABLE_TOP}" stroke="${ink}" stroke-width="${RULE_W}"/>`);
  right.push(axonometric(b, s, { x: RX, y: TABLE_TOP + 4, w: RW, h: 318 }));
  const PY = TABLE_TOP + 330;
  const plan = planView(b, s, { x: RX, y: PY + 10, w: 150, h: 196 });
  right.push(heading(RX, PY + 4.6, 'ENVELOPE', `plan 1:${fmt(plan.scale)}`), `<line x1="${RX}" y1="${PY + 7}" x2="${RX + 150}" y2="${PY + 7}" stroke="${ink}" stroke-width="${RULE_W}"/>`, plan.svg);
  const SX = RX + 162, SW = RW - 162;
  right.push(heading(SX, PY + 4.6, 'SCHEDULE'), `<line x1="${SX}" y1="${PY + 7}" x2="${SX + SW}" y2="${PY + 7}" stroke="${ink}" stroke-width="${RULE_W}"/>`);
  if (y.tiers.length) right.push(schedule(y, SX, PY + 13, SW));
  else right.push(txt(SX, PY + 13, 'No building type is studied for this zone.', false, 3));
  // What the schedule rests on, under it.
  const apartments = y.archetype === 'residential' || y.archetype === 'mixed';
  const assumptionLines = [
    `Floor to floor: ${y.archetype === 'mixed' ? `${a.groundRetailF2F}m retail ground floor, ` : ''}${y.archetype === 'commercial' ? `${a.commercialF2F}m commercial` : `${a.residentialF2F}m residential`};`,
    `${a.roofAllowance}m kept under the height for the roof and plant.`,
    apartments ? `GFA is ${Math.round(a.residentialEfficiency * 100)}% of GBA residential, ${Math.round(a.commercialEfficiency * 100)}% retail;` : `GFA is ${Math.round(a.commercialEfficiency * 100)}% of GBA.`,
    apartments ? `saleable area ${Math.round(a.nsaRatio * 100)}% of residential GFA.` : '',
    apartments ? `Mix: ${[a.mix.studio ? `${Math.round(a.mix.studio * 100)}% studio` : '', `${Math.round(a.mix.one * 100)}% 1 bed`, `${Math.round(a.mix.two * 100)}% 2 bed`, `${Math.round(a.mix.three * 100)}% 3 bed`].filter(Boolean).join(', ')}; average ${fmt(y.averageUnitSqm, 1)} sqm.` : '',
    apartments ? `Plates held to ${a.maxDepth}m deep and towers to ${sqm(a.towerPlateMax)} GBA.` : '',
    b.station ? `Nearest station or stop: ${titleWords(b.station.name)}, ${fmt(b.station.distanceM)}m.` : 'No station within 1.2 km.',
  ].filter(Boolean);
  const ny = PY + 18 + (y.tiers.length + 2) * 4.6 + 6;
  right.push(txt(SX, ny, 'ASSUMPTIONS', true, 2.9));
  assumptionLines.forEach((l, i) => right.push(txt(SX, ny + 4.4 + i * 3.7, l, false, 2.6, '#454545')));
  right.push(txt(SX, ny + 4.4 + assumptionLines.length * 3.7 + 2, 'Every figure can be changed in yield_assumptions.json.', false, 2.6, '#6a6a6a'));

  // The legend column: the massing's key, then what the sheet is and is not.
  let legend = '';
  let ly = 7;
  const row = (swatch: string, label: string) => {
    legend += `<g transform="translate(0,${ly})">${swatch}${wrapLabel(label, 26).map((l, i) => `<text x="${LABEL_X}" y="${3.5 + i * 3.2}" font-size="2.6" fill="#222">${esc(l)}</text>`).join('')}</g>`;
    ly += 10;
  };
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${SITE_RED}" fill-opacity="0.08" stroke="${SITE_RED}" stroke-width="0.6" stroke-dasharray="3,1.2"/>`, 'SITE');
  for (const u of ['residential', 'retail', 'commercial'] as Use[]) if (y.tiers.some((t) => t.use === u)) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${USE_FILL[u]}" stroke="#3a3a3a" stroke-width="0.2"/>`, `INDICATIVE MASSING, ${USE_WORD[u].toUpperCase()}`);
  if (y.tiers.length) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${ENVELOPE}" stroke-width="0.4" stroke-dasharray="1.6,1"/>`, 'ENVELOPE OF EACH TIER');
  if (s.hob?.metres) row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${SITE_RED}" fill-opacity="0.05" stroke="${SITE_RED}" stroke-width="0.4" stroke-dasharray="2.4,1.2"/>`, 'HEIGHT OF BUILDING PLANE');
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${CONTEXT_FILL}" stroke="${CONTEXT_EDGE}" stroke-width="0.25"/>`, `NEIGHBOURS AT THEIR HEIGHTS (${b.buildingsSource === 'overture' ? 'OVERTURE' : 'OSM'}; DASHED: NOT RECORDED)`);
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
    layers: [`<g transform="translate(${-FRAME_L},${-FRAME_T})" font-family="${tpl().font}" fill="${ink}">${renderTable(rows)}${right.join('')}</g>`],
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

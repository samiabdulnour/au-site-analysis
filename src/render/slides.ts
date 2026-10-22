// OVERALL ANALYSIS — the A3 landscape deck that is the content part of a
// feasibility study or design report (docs/SLIDES_SPEC.md). Each slide is a
// text column on the left and a figure field on the right; the maps are the
// sheet renderers' data at panel size, the tables are HTML.
//
// This file holds the deck chrome and the two planning slides (spec 03 and
// 04). Later slides are further functions returning a Slide.

import type { DemGrid } from '../fetch/terrain.js';
import type { Extent } from '../lib/geo.js';
import type { SlidesBundle } from '../pipeline.js';
import type { SheetMeta } from './sheet.js';
import type { GeoJSONFeature } from '../lib/arcgis.js';
import { tpl, withTemplate, DECK_TEMPLATE } from './template.js';
import { INK, AERIAL_GREEN_FILL, VEG_1750_FILLS, fillShape, swatchOf, barOf, zHead, zBars, zFigures, zCircles, zSpans, zPairs, zLine, niceAxis, z6, zSvg, Z_W, Z_TRACK, type Fill } from './atlasKit.js';
import { esc } from './chrome.js';
import {
  panelProjector, panelExtent, baseLayers, overLayers, panelFurniture, furnitureBox, siteMark, siteLabelPoint, stationMode, ringsPath, fcPath, ringStats, clippedStats, hatchPath, dotsPath, bboxOf, t2Text, t2Width, railSymbol,
  legendSvg, swatchFill, swatchHatch, swatchLine, swatchDots, LabelSpacer, type Proj, type Panel, type LegendEntry, type FurnitureCorner,
} from './minimap.js';
import { zoneFill, heritageStyle, hobRamp, POLICY_STYLE } from './lepPalette.js';
import { geomRings, isRealPolicyArea, pointInRing, titleCase, type PolicyArea, type PolicyKind } from '../fetch/planning.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import { isSignificant, siteKey, parseSiteAddress, sameLot, money, type DaRecord, type DaStatusClass, type SiteAddress } from '../fetch/da.js';
import type { PeopleData } from '../fetch/people.js';
import type { CensusProfile, DwellingMix, TenureMix, TravelMix, PersonsProfile, YearValue } from '../fetch/abs.js';
import type { Sale } from '../fetch/valuation.js';
import { lineWithProjection, pairedBars, columns, sectionSvg } from './charts.js';
import { hillshadeDataUri, reliefDataUri, planSections, sampleSection, siteLevels, gridExtremes, nearestWater, bearingName } from './terrainMap.js';
import { METRES_PER_STOREY, type Building } from '../fetch/buildings.js';
import type { CyclewayKind } from '../fetch/movement.js';
import type { FacilityKind } from '../fetch/greenSpace.js';
import { CONSTRAINT_DEFS, type ConstraintGroup } from '../fetch/constraints.js';
import type { PublicParcel } from '../fetch/site.js';
import { demAt } from '../fetch/terrain.js';
import { CHART, niceScale } from './charts.js';
import type { XY } from '../lib/geo.js';
import { sunPosition, sunTimes, sunPath, civilToUtc, fmtClock } from '../lib/solar.js';
import { shadowHull, inHull } from '../lib/shadows.js';
import type { ViewKind } from '../fetch/views.js';
import { MAX_PHOTOS, type StreetPhoto } from '../fetch/photos.js';
import { PROBE_OUT_M as SV_PROBE_OUT_M } from '../fetch/streetView.js';
import { windLobes, sectorTotals, WIND_CLASSES_KMH, type WindRose } from '../fetch/wind.js';
import { inRings, nearestOnRings, overlapArea, ringsGap } from '../lib/rings.js';
import { CENTRES, SYDNEY_CBD, CENTRE_KIND_WORD } from '../data/centres.js';
import type { MajorProject } from '../fetch/majorProjects.js';

export const SLIDE_W = 420;
export const SLIDE_H = 297;
// The A3 sheet folds at its vertical centre into a spread of two A4 pages:
// the left page carries the title, the narrative and the side column, the
// right page the figures. Nothing but a deliberate full-spread figure may
// cross the fold.
const FOLD = 210;
const INNER = 9;                          // margin each side of the fold
const MARGIN_L = 15, MARGIN_R = 15;       // the outer margins
const L_X = MARGIN_L;                     // left page content
const L_W = FOLD - INNER - L_X;           // 186
const TEXT_W = 88;                        // the narrative column's measure
const AUX_X = L_X + TEXT_W + 8;           // the left page's side column: tiles, keys, small tables
const AUX_W = L_X + L_W - AUX_X;          // 90
const FIELD_X = FOLD + INNER;             // 219 — the right page is the figure field
const FIELD_W = SLIDE_W - MARGIN_R - FIELD_X;  // 186
// A full-page map panel, and the half panel two of which share a row.
export const PANEL_W = 186;
export const PANEL_H = 122;
export const DA_PANEL_H = 122;
const HALF_W = 90, HALF_H = 59;
const FIELD_Y = 40;
const GUTTER = 6;
const PANEL_TITLE_H = 5;
const LEGEND_H = 19.5;
const LEGEND_ROWS = 5;
const HALF_LEGEND_H = 26, HALF_LEGEND_ROWS = 7;
const FOOT_Y = SLIDE_H - 10;              // the per-page footer line

export interface Slide {
  id: string; title: string; subtitle: string; textHtml: string; figureHtml: string;
  /** The figure page is one borderless map to the sheet's edges: no right-page chrome, no fold ticks. */
  bleed?: boolean;
  /** One map across the whole spread, the text set in its white ground. */
  full?: boolean;
  /** An atlas page's sources, set small and grey at the foot of the narrative column. */
  sources?: string;
  /** The author's prompt, bold, in the slide's colour, in the narrative column. */
  narrative?: string;
  /** The slide's colour: the narrative's ink, matched to its map. */
  accent?: string;
  /** The key, as hairline-ruled rows at the foot of the right column. */
  legend?: LegendEntry[];
  /** Where the narrative column starts, when a figure sits above it on the left page. */
  textY?: number;
}

// ---- shared bits ------------------------------------------------------------

const fmtDate = (ms: unknown): string => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
};
const fmtNum = (n: number, dp = 0) => n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const para = (s: string) => `<p>${esc(s)}</p>`;
const placeholder = (s: string) => `<p class="ph">${esc(s)}</p>`;

function heightLabel(v: unknown, units: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = String(units ?? 'm');
  return /RL/i.test(u) ? `RL ${fmtNum(n, n % 1 ? 1 : 0)}` : `${fmtNum(n, n % 1 ? 1 : 0)} m`;
}

/** Heights sort metres first, then reduced levels, each ascending. */
function heightKey(v: unknown, units: unknown): number {
  const n = Number(v) || 0;
  return (/RL/i.test(String(units ?? '')) ? 100_000 : 0) + n;
}

/**
 * Legend classes for height of building. Up to ten distinct values are shown
 * as they are; a CBD window with forty is banded, metres first, then reduced
 * levels — the panel labels still carry the exact figure.
 */
interface HeightClass { order: number; label: string }
function heightClassifier(distinct: { value: number; units: string }[]): (value: number, units: string) => HeightClass {
  if (distinct.length <= 10) {
    return (value, units) => ({ order: heightKey(value, units), label: heightLabel(value, units) });
  }
  const mBands: [number, string][] = [[9, 'up to 9 m'], [12, '9–12 m'], [15, '12–15 m'], [20, '15–20 m'], [30, '20–30 m'], [50, '30–50 m'], [100, '50–100 m'], [Infinity, 'over 100 m']];
  const rlBands: [number, string][] = [[60, 'RL up to 60'], [100, 'RL 60–100'], [150, 'RL 100–150'], [200, 'RL 150–200'], [Infinity, 'RL over 200']];
  return (value, units) => {
    const rl = /RL/i.test(units);
    const bands = rl ? rlBands : mBands;
    const i = bands.findIndex(([max]) => value <= max);
    return { order: (rl ? 100 : 0) + (i < 0 ? bands.length : i), label: bands[i < 0 ? bands.length - 1 : i][1] };
  };
}

/** Rough width of a bold label in mm, for keeping labels apart. */
const labelW = (text: string, size: number) => text.length * size * 0.64 + 0.8;

/** One readable line for a SEPP map at the site, without the API's repetition. */
function seppLine(epiName: string, title: string, type: string, cls: string): string {
  const short = (x: string) => x.replace(/State Environmental Planning Policy/g, 'SEPP').replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  const push = (x: string) => {
    const v = short(x);
    if (!v || v === '<Null>') return;
    if (parts.some((q) => q.toLowerCase().includes(v.toLowerCase()))) return;
    parts.push(v);
  };
  if (title && (title.includes('SEPP') || title.includes('State Environmental'))) push(title);
  else { push(epiName); push(title); }
  push(type); push(cls);
  return parts.join(' — ').replace(/ - /g, ' – ');
}

function distanceM(a: { x: number; y: number }, lon: number, lat: number, k: number): number {
  const m = lonLatToMercator({ lon, lat });
  return Math.hypot(m.x - a.x, m.y - a.y) / k;
}

/** Largest ring of a feature and its stats, or null. */
function mainRing(f: GeoJSONFeature, proj: Proj) {
  let best: { ring: number[][]; area: number; cx: number; cy: number } | null = null;
  for (const r of geomRings(f.geometry)) {
    const s = ringStats(r, proj);
    if (!best || s.area > best.area) best = { ring: r, ...s };
  }
  return best;
}

const label = (x: number, y: number, text: string, size = 2.2, fill = '#2a3534') =>
  `<text x="${x.toFixed(1)}" y="${(y + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${fill}" stroke="#ffffff" stroke-width="${(size * 0.22).toFixed(2)}" paint-order="stroke">${esc(text)}</text>`;

/** The key as the template sets it: a hairline over each row, the swatch at the left, 6 pt caps beside it. */
/** The key: one column under the bars' column, or two across the flow when it runs past four rows, so the graphs keep their room. */
function zLegend(entries: LegendEntry[]): string {
  const row = (e: LegendEntry) => `<div class="zrow"><svg class="zsw" viewBox="0 0 5 3.6" preserveAspectRatio="xMinYMid meet" xmlns="http://www.w3.org/2000/svg">${e.swatch}</svg><span>${esc(e.label)}</span></div>`;
  if (entries.length <= LEGEND_ONE_COLUMN) return `<div class="abs zleg">${entries.map(row).join('')}</div>`;
  const half = Math.ceil(entries.length / 2);
  // both columns hang from the same top, so their rows line up
  const top = (297 - 12.2 - half * 8.52).toFixed(2);
  // one hairline across both columns at the top, the gap between them included
  return `<div class="abs zrule" style="left:75.33mm;width:122.67mm;top:${top}mm"></div><div class="abs zleg zleg2" style="left:75.33mm;bottom:auto;top:${top}mm">${entries.slice(0, half).map(row).join('')}</div><div class="abs zleg zleg2" style="bottom:auto;top:${top}mm">${entries.slice(half).map(row).join('')}</div>`;
}
const LEGEND_ONE_COLUMN = 4;

/** A T3 word inside a graph: the body style, one size, one weight, ink. */
const t3Text = (x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="2.7" font-weight="400" fill="${tpl().ink}">${esc(text)}</text>`;

function panelSvg(inner: string, id: string, w = PANEL_W, h = PANEL_H): string {
  return `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-${id}"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath></defs>
    <g clip-path="url(#clip-${id})" font-family="${tpl().font}">${inner}</g>
    <rect x="0.1" y="0.1" width="${(w - 0.2).toFixed(1)}" height="${(h - 0.2).toFixed(1)}" fill="none" stroke="${tpl().rule}" stroke-width="0.2"/>
  </svg>`;
}

interface PanelOut { title: string; note: string; svg: string; legend: LegendEntry[] }

function panelBlock(p: PanelOut, col: number, row: number, id: string): string {
  const x = FIELD_X + col * (HALF_W + GUTTER);
  const y = FIELD_Y + row * (PANEL_TITLE_H + HALF_H + HALF_LEGEND_H + GUTTER);
  const leg = legendSvg(p.legend, HALF_W, HALF_LEGEND_ROWS, 1.9);
  return `<div class="abs ptitle sm" style="left:${x}mm;top:${y}mm;width:${HALF_W}mm">${esc(p.title)}<span class="pnote">${esc(p.note)}</span></div>
    <div class="abs" style="left:${x}mm;top:${y + PANEL_TITLE_H}mm">${panelSvg(p.svg, id, HALF_W, HALF_H)}</div>
    <svg class="abs" style="left:${x}mm;top:${y + PANEL_TITLE_H + HALF_H + 1.5}mm" width="${HALF_W}mm" height="${HALF_LEGEND_H}mm" viewBox="0 0 ${HALF_W} ${HALF_LEGEND_H}" xmlns="http://www.w3.org/2000/svg">${leg.svg}</svg>`;
}

// ---- the facts the two slides share -----------------------------------------

export interface PlanningFacts {
  zoneAtSite?: { code: string; name: string; epi: string; amendment?: string; commenced?: string; currency?: string; lga?: string };
  hobAtSite?: { value: number; units: string; label: string; rl: boolean };
  fsrAtSite?: number;
  lotSizeAtSite?: number;
  heritageAtSite: { kind: 'item' | 'conservationArea' | 'shr'; name: string; id?: string; significance?: string }[];
  heritageNearby: { items: number; conservationAreas: number; shr: number; nearestShr?: { name: string; listingNo: string; distanceM: number } };
  zonesInWindow: { code: string; name: string; areaShare: number }[];
  heightsInWindow: { label: string; units: string; value: number }[];
  policyAtSite: { kind: PolicyKind; name: string; source: string }[];
  policyInWindow: { kind: PolicyKind; name: string }[];
  localProvisions: string[];
  seppMaps: string[];
  seppLandApplication: number;
  canopy?: { y2022?: number; y2019?: number };
  regionalPlan?: string;
  legislationUrl?: string;
  shrOnSite?: { name: string; listingNo: string };
}

export function planningFacts(b: SlidesBundle): PlanningFacts {
  const proj = panelProjector(b.panel);
  const centre = b.panel.center;
  const cLL = mercatorToLonLat(centre);
  const k = 1 / Math.cos((cLL.lat * Math.PI) / 180);
  const contains = (f: GeoJSONFeature) => geomRings(f.geometry).some((r) => pointInRing(cLL.lon, cLL.lat, r));

  // Zone at the site: the polygon that contains the centre, else the point query.
  const zf = b.zoning.features.find(contains);
  const zoneAtSite = zf
    ? { code: String(zf.properties.SYM_CODE ?? ''), name: String(zf.properties.LAY_CLASS ?? ''), epi: String(zf.properties.EPI_NAME ?? ''),
        amendment: zf.properties.AMENDMENT ? String(zf.properties.AMENDMENT) : undefined,
        commenced: fmtDate(zf.properties.COMMENCED_DATE) || undefined, currency: fmtDate(zf.properties.CURRENCY_DATE) || undefined,
        lga: zf.properties.LGA_NAME ? String(zf.properties.LGA_NAME) : undefined }
    : b.controls.zoneCode
      ? { code: b.controls.zoneCode, name: b.controls.zonePurpose ?? '', epi: b.controls.epiName ?? '' }
      : undefined;

  const hf = b.hob.features.find((f) => contains(f) && Number(f.properties.MAX_B_H) > 0);
  const hobAtSite = hf
    ? { value: Number(hf.properties.MAX_B_H), units: String(hf.properties.UNITS ?? 'm'),
        label: heightLabel(hf.properties.MAX_B_H, hf.properties.UNITS), rl: /RL/i.test(String(hf.properties.UNITS ?? '')) }
    : b.controls.maxHeightM
      ? { value: b.controls.maxHeightM, units: 'm', label: `${fmtNum(b.controls.maxHeightM, b.controls.maxHeightM % 1 ? 1 : 0)} m`, rl: false }
      : undefined;

  const heritageAtSite: PlanningFacts['heritageAtSite'] = [];
  for (const f of b.heritage.features) {
    if (!contains(f)) continue;
    const cls = String(f.properties.LAY_CLASS ?? '');
    heritageAtSite.push({
      kind: /Conservation Area/i.test(cls) ? 'conservationArea' : 'item',
      name: String(f.properties.H_NAME ?? cls), id: f.properties.H_ID ? String(f.properties.H_ID) : undefined,
      significance: f.properties.SIG ? String(f.properties.SIG) : undefined,
    });
  }
  let shrOnSite: PlanningFacts['shrOnSite'];
  for (const f of b.shr.features) {
    if (!contains(f)) continue;
    shrOnSite = { name: String(f.properties.ITEMNAME ?? ''), listingNo: String(f.properties.LISTINGNO ?? '') };
    heritageAtSite.push({ kind: 'shr', name: shrOnSite.name, id: `SHR ${shrOnSite.listingNo}`, significance: 'State' });
  }

  // Distinct items and areas, not polygons: an item with three lots is one item.
  const itemIds = new Set<string>(), caNames = new Set<string>();
  for (const f of b.heritage.features) {
    const cls = String(f.properties.LAY_CLASS ?? '');
    if (/Conservation Area/i.test(cls)) caNames.add(String(f.properties.H_NAME ?? f.properties.H_ID ?? f.properties.OBJECTID));
    else itemIds.add(String(f.properties.H_ID ?? f.properties.H_NAME ?? f.properties.OBJECTID));
  }
  const items = itemIds.size, cas = caNames.size;
  const shrCount = new Set(b.shr.features.map((f) => String(f.properties.LISTINGNO ?? f.properties.ITEMNAME))).size;
  let nearestShr: PlanningFacts['heritageNearby']['nearestShr'];
  for (const f of b.shr.features) {
    const m = mainRing(f, proj);
    if (!m) continue;
    const [clon, clat] = centroidLL(m.ring);
    const d = distanceM(centre, clon, clat, k);
    if (!nearestShr || d < nearestShr.distanceM)
      nearestShr = { name: String(f.properties.ITEMNAME ?? ''), listingNo: String(f.properties.LISTINGNO ?? ''), distanceM: Math.round(d / 10) * 10 };
  }

  // Zones in the window by share of projected area.
  const zoneArea = new Map<string, { name: string; area: number }>();
  let totalZ = 0;
  for (const f of b.zoning.features) {
    const code = String(f.properties.SYM_CODE ?? '?');
    let a = 0;
    for (const r of geomRings(f.geometry)) a += clippedStats(r, proj, b.panel).area;
    totalZ += a;
    const e = zoneArea.get(code) ?? { name: String(f.properties.LAY_CLASS ?? ''), area: 0 };
    e.area += a; zoneArea.set(code, e);
  }
  const zonesInWindow = [...zoneArea.entries()].map(([code, e]) => ({ code, name: e.name, areaShare: totalZ ? e.area / totalZ : 0 }))
    .sort((a, b2) => b2.areaShare - a.areaShare);

  const heights = new Map<string, { label: string; units: string; value: number }>();
  for (const f of b.hob.features) {
    const l = heightLabel(f.properties.MAX_B_H, f.properties.UNITS);
    if (l) heights.set(l, { label: l, units: String(f.properties.UNITS ?? 'm'), value: Number(f.properties.MAX_B_H) });
  }
  const heightsInWindow = [...heights.values()].sort((a, b2) => heightKey(a.value, a.units) - heightKey(b2.value, b2.units));

  // A bundle fetched before the "Not Applicable" filter can still carry DPHI's between-precincts polygons.
  const realPolicy = b.policy.filter((p) => isRealPolicyArea(p.name));
  const policyAtSite = realPolicy.filter((p) => p.rings.some((r) => pointInRing(cLL.lon, cLL.lat, r)))
    .map((p) => ({ kind: p.kind, name: p.name, source: p.source }));
  const seenP = new Set<string>();
  const policyInWindow = realPolicy.filter((p) => { const key = `${p.kind}|${p.name}`; if (seenP.has(key)) return false; seenP.add(key); return true; })
    .map((p) => ({ kind: p.kind, name: p.name }));

  // The property API: local provisions, SEPP maps, canopy, regional plan, legislation link.
  const localProvisions: string[] = [];
  const seppMaps: string[] = [];
  let seppLandApplication = 0;
  const canopy: PlanningFacts['canopy'] = {};
  let regionalPlan: string | undefined;
  let legislationUrl: string | undefined;
  const seppSeen = new Set<string>();
  const addSepp = (s: string) => { if (s && !seppSeen.has(s)) { seppSeen.add(s); seppMaps.push(s); } };
  for (const g of b.property?.epi ?? []) {
    const name = g.layerName;
    for (const r of g.results) {
      if (/Local Provisions/i.test(name)) {
        const t = [r.title, r.Type && r.Type !== r.title ? r.Type : '', r.Class && r.Class !== r.Type && r.Class !== '<Null>' ? r.Class : ''].filter(Boolean).join(' — ');
        if (t && !localProvisions.includes(t)) localProvisions.push(t);
      } else if (/Tree Canopy Cover 2022/i.test(name)) canopy.y2022 = Number(r['Canopy %']) || undefined;
      else if (/Tree Canopy Cover 2019/i.test(name)) canopy.y2019 = Number(r['Canopy %']) || undefined;
      else if (/Regional Plan/i.test(name)) regionalPlan = r.title;
      else if (/Special Provisions/i.test(name)) addSepp(seppLine(r['EPI Name'] ?? '', r.title ?? '', r.Type ?? '', r.Class ?? ''));
      else if (/Land Zoning/i.test(name) && r.legislationUrl) legislationUrl = r.legislationUrl;
    }
  }
  for (const g of b.property?.sepp ?? []) {
    for (const r of g.results) {
      if (r.Type === 'Land Application') { seppLandApplication++; continue; }
      addSepp(seppLine(r['EPI Name'] || g.layerName, r.title && r.title !== r['EPI Name'] ? r.title : '', r.Type ?? '', r.Class ?? ''));
    }
  }

  return {
    zoneAtSite, hobAtSite, fsrAtSite: b.controls.fsr, lotSizeAtSite: b.controls.minLotSizeSqm,
    heritageAtSite, heritageNearby: { items, conservationAreas: cas, shr: shrCount, nearestShr },
    zonesInWindow, heightsInWindow, policyAtSite, policyInWindow,
    localProvisions, seppMaps, seppLandApplication, canopy, regionalPlan, legislationUrl, shrOnSite,
  };
}

function centroidLL(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

const POLICY_WORD: Record<PolicyKind, string> = {
  tod: 'Transport Oriented Development area', todAccelerated: 'accelerated TOD precinct', todDeferred: 'deferred TOD area',
  townCentre: 'town centre under the low and mid-rise housing policy', ssdSite: 'State significant development site', precinct: 'planning precinct',
};

export interface PlanningSentences { where: string; controls: string; zones?: string; heights?: string; heritage: string; policy: string; councilDcp?: string }

/** The sentences that follow from the data; the interpretation stays with the author. */
export function planningSentences(b: SlidesBundle, f: PlanningFacts): PlanningSentences {
  const out: string[] = [];
  const ctx = b.context;
  const where = [
    ctx.suburb?.name ? `in ${titleCase(ctx.suburb.name)}` : '',
    ctx.lga?.name ? `in the ${titleCase(ctx.lga.name)} local government area${ctx.lga.council ? ` (${titleCase(ctx.lga.council)})` : ''}` : '',
    ctx.district ? `in the ${ctx.district} District` : '',
  ].filter(Boolean).join(', ');
  const epi = f.zoneAtSite?.epi || b.controls.epiName;
  out.push(`${b.siteAddress} lies ${where || 'in New South Wales'}.` +
    (epi ? ` The applying instrument is the ${epi}${f.zoneAtSite?.amendment ? ` (${f.zoneAtSite.amendment}${f.zoneAtSite.commenced ? `, commenced ${f.zoneAtSite.commenced}` : ''})` : ''}.` : ' No local environmental plan is mapped at the site.'));

  const controls: string[] = [];
  if (f.zoneAtSite) controls.push(`zoned ${f.zoneAtSite.code}${f.zoneAtSite.name ? ` ${f.zoneAtSite.name}` : ''}`);
  if (f.hobAtSite) controls.push(`a maximum building height of ${f.hobAtSite.label}${f.hobAtSite.rl ? ' (a reduced level, not a height above ground)' : ''}`);
  else controls.push('no height of building control mapped');
  controls.push(f.fsrAtSite ? `a floor space ratio of ${f.fsrAtSite.toFixed(2)}:1` : 'no floor space ratio control mapped');
  if (f.lotSizeAtSite) controls.push(`a minimum lot size of ${fmtNum(f.lotSizeAtSite)} m²`);
  out.push(`The site is ${controls.join(', ')}.`);

  if (f.zonesInWindow.length) {
    const top = f.zonesInWindow.slice(0, 4).map((z) => `${z.code}${z.name ? ` ${z.name}` : ''} (${Math.round(z.areaShare * 100)} %)`);
    out.push(`The window around it carries ${f.zonesInWindow.length} zone${f.zonesInWindow.length === 1 ? '' : 's'}, by area: ${top.join(', ')}.`);
  }
  if (f.heightsInWindow.length) {
    const m = f.heightsInWindow.filter((h) => !/RL/i.test(h.units));
    const rl = f.heightsInWindow.filter((h) => /RL/i.test(h.units));
    const span = (xs: typeof m, what: string) =>
      xs.length === 1 ? `a ${what} of ${xs[0].label}` : `${what}s from ${xs[0].label} to ${xs[xs.length - 1].label}`;
    const bits: string[] = [];
    if (m.length) bits.push(span(m, 'height'));
    if (rl.length) bits.push(span(rl, 'reduced-level limit'));
    out.push(`Mapped height controls in the window run to ${bits.join(' and ')}${f.heightsInWindow.length > 1 ? ` (${f.heightsInWindow.length} distinct values)` : ''}.`);
  }

  const hs = f.heritageAtSite;
  const siteHer = hs.length
    ? `The site ${hs.some((h) => h.kind === 'item') ? 'is a listed heritage item' : ''}${hs.some((h) => h.kind === 'item') && hs.some((h) => h.kind === 'conservationArea') ? ' and ' : ''}${hs.some((h) => h.kind === 'conservationArea') ? 'sits in a heritage conservation area' : ''}${hs.some((h) => h.kind === 'shr') ? `${hs.length > 1 ? ', and' : ''} is on the State Heritage Register` : ''}: ${hs.map((h) => `${h.name}${h.id ? ` (${h.id}${h.significance ? `, ${h.significance}` : ''})` : ''}`).join('; ')}.`
    : 'The site is not a listed heritage item and is not in a conservation area.';
  const near = f.heritageNearby;
  out.push(`${siteHer} ${near.items} heritage item${near.items === 1 ? '' : 's'} and ${near.conservationAreas} conservation area${near.conservationAreas === 1 ? '' : 's'} fall in the window` +
    (near.nearestShr ? `; the nearest State Heritage Register item is ${near.nearestShr.name} (SHR ${near.nearestShr.listingNo}), about ${fmtNum(near.nearestShr.distanceM)} m away.` : '.'));

  if (f.policyAtSite.length) {
    out.push(`Housing policy: the site is inside ${f.policyAtSite.map((p) => `the ${p.name} ${POLICY_WORD[p.kind]}`).join(' and ')}.`);
  } else if (f.policyInWindow.length) {
    const kinds = [...new Set(f.policyInWindow.map((p) => POLICY_WORD[p.kind]))];
    out.push(`Housing policy: the site is outside every mapped policy area; the window holds ${kinds.join(', ')} (${f.policyInWindow.slice(0, 4).map((p) => p.name).join(', ')}).`);
  } else {
    out.push('Housing policy: no Transport Oriented Development area, town centre, State significant development site or planning precinct is mapped in this window.');
  }
  if (b.cos) {
    const c = b.cos;
    const bits = [
      c.storeysAtSite ? `a building height of ${c.storeysAtSite} storeys at the site` : 'no height in storeys at the site (Central Sydney and the LEP-height areas are not mapped in storeys)',
      c.frontageHeightsNearSite.length ? `street frontage heights of ${c.frontageHeightsNearSite.join(' and ')} storeys along the site's streets` : '',
      c.activeFrontageNearSite ? 'an active street frontage requirement on the frontage' : '',
      c.setbacksNearSite.length ? `setbacks of ${c.setbacksNearSite.join(', ')}` : '',
    ].filter(Boolean);
    out.push(`The City of Sydney's own DCP mapping adds ${bits.join(', ')}.`);
  }
  // Positional up to here; named from here on, so a slide can pick its own.
  const hasZones = f.zonesInWindow.length > 0, hasHeights = f.heightsInWindow.length > 0;
  let i = 2;
  const zones = hasZones ? out[i++] : undefined;
  const heights = hasHeights ? out[i++] : undefined;
  return { where: out[0], controls: out[1], zones, heights, heritage: out[i], policy: out[i + 1], councilDcp: b.cos ? out[i + 2] : undefined };
}

export const sentenceList = (s: PlanningSentences): string[] =>
  [s.where, s.controls, s.zones, s.heights, s.heritage, s.policy, s.councilDcp].filter((x): x is string => Boolean(x));

// ---- slide 01: location -----------------------------------------------------------

const LAND_FILL = '#f6e3d7';
const LGA_LINE = '#dcb6a0';
const RING_KM = [2, 5];
/** How many centres the table and the map name at most. */
const CENTRES_LISTED = 8;

const stationShort = (name: string) => tidyName(titleCase(name.replace(/\s+(RAILWAY|LIGHT RAIL|METRO|TRAIN)?\s*STATION$/i, '').replace(/\s+(SLR|LIGHT RAIL)?\s*STOP$/i, '').replace(/\s+STATION$/i, '')));

/** Where the site sits in the region: the areas, the centres, the stations and the water around it, with distances. */
export function locationFacts(b: SlidesBundle) {
  const loc = b.location;
  const p = loc.panel;
  const proj = panelProjector(p);
  const centreLL = mercatorToLonLat(b.panel.center);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number): XY => { const m = lonLatToMercator({ lon, lat }); return { x: (m.x - b.panel.center.x) / k, y: (m.y - b.panel.center.y) / k }; };
  const distBearing = (lon: number, lat: number) => { const q = toM(lon, lat); return { distanceM: Math.hypot(q.x, q.y), bearing: ((Math.atan2(q.x, q.y) * 180) / Math.PI + 360) % 360 }; };
  const onMap = (lon: number, lat: number) => { const [x, y] = proj(lon, lat); return x >= 0 && x <= p.wMm && y >= 0 && y <= p.hMm; };
  // the centres of the plan, nearest first
  const centres = CENTRES.map((c) => ({ ...c, ...distBearing(c.lon, c.lat), onMap: onMap(c.lon, c.lat), kindWord: CENTRE_KIND_WORD[c.kind] })).sort((a, b2) => a.distanceM - b2.distanceM);
  const cbd = { ...SYDNEY_CBD, ...distBearing(SYDNEY_CBD.lon, SYDNEY_CBD.lat) };
  const cbds = centres.filter((c) => c.kind === 'cbd');
  // the stations, nearest first, with their mode
  const stations = loc.stations.map((s) => ({ name: stationShort(s.name), raw: s.name, mode: stationMode(s.name), lon: s.lon, lat: s.lat, ...distBearing(s.lon, s.lat) })).sort((a, b2) => a.distanceM - b2.distanceM);
  const seenStation = new Set<string>();
  const uniqueStations = stations.filter((s) => { const key = `${s.name}|${s.mode}`; if (seenStation.has(key)) return false; seenStation.add(key); return true; });
  // the named water in the window: the large bodies, by the nearest point of their generalised outline
  const water = loc.water.filter((w) => w.name && /BAY|HARBOUR|RIVER|LAKE|LAGOON|OCEAN|SEA|ESTUARY/i.test(w.kind ?? '')).slice(0, 5).map((w) => {
    let best = { d: Infinity, lon: 0, lat: 0 };
    for (const r of w.rings) for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 400))) { const q = toM(r[i][0], r[i][1]); const d = Math.hypot(q.x, q.y); if (d < best.d) best = { d, lon: r[i][0], lat: r[i][1] }; }
    return { name: tidyName(titleCase(w.name)), kind: w.kind, distanceM: Math.round(best.d), bearing: best.d < Infinity ? distBearing(best.lon, best.lat).bearing : 0 };
  }).sort((a, b2) => a.distanceM - b2.distanceM).filter((w, i, arr) => arr.findIndex((o) => o.name === w.name) === i);
  const lgaName = b.context.lga?.name;
  const lgaPolys = lgaName ? loc.lgas.filter((l) => l.name.toUpperCase() === lgaName.toUpperCase()) : [];
  return {
    panel: p, widthKm: Math.round(((p.wMm / 1000) * p.scale) / 100) / 10, heightKm: Math.round(((p.hMm / 1000) * p.scale) / 100) / 10,
    suburb: b.context.suburb?.name ? titleCase(b.context.suburb.name) : undefined,
    lga: b.context.lga ? { name: titleCase(b.context.lga.name), council: titleCase(b.context.lga.council) } : undefined,
    district: b.context.district, region: b.strategies.region.name, regionPlan: b.strategies.region.plan?.name,
    cbd, cbds: cbds.map(({ onMap: _o, ...c }) => c),
    centres: centres.map(({ onMap: _o, ...c }) => c).slice(0, CENTRES_LISTED), centresOnMap: centres.filter((c) => c.onMap).length, centresAll: centres.length,
    stations: uniqueStations.slice(0, 6), stationsWithin5km: uniqueStations.filter((s) => s.distanceM <= 5000 && s.mode !== 'light rail').length, stopsWithin5km: uniqueStations.filter((s) => s.distanceM <= 5000 && s.mode === 'light rail').length, stationsOk: loc.stations.length > 0,
    water: water.slice(0, 3),
    lgaOnMap: lgaPolys.length > 0, layers: { lgas: loc.lgas.length, roads: loc.roads.length, rail: loc.rail.train.length + loc.rail.tram.length, suburbs: loc.suburbs.length, water: loc.water.length },
  };
}

export function locationSentences(b: SlidesBundle, f: ReturnType<typeof locationFacts>): string[] {
  const out: string[] = [];
  const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${fmtNum(Math.round(m / 10) * 10)} m`);
  const dir = compassWord;
  const where = [f.suburb ? `at ${f.suburb}` : '', f.lga ? `in the ${f.lga.name} local government area` : '', f.district ? `in what was the ${f.district} District` : '', f.region ? `of the ${f.region} region` : ''].filter(Boolean).join(', ');
  out.push(`The site is ${where || 'at the geocoded point'}, ${km(f.cbd.distanceM)} ${dir((f.cbd.bearing + 180) % 360)} of the Sydney CBD (Town Hall) in a straight line${f.cbds.length > 1 ? `; ${listWords(f.cbds.filter((c) => c.name !== SYDNEY_CBD.name).map((c) => `${c.name} is ${km(c.distanceM)} ${dir(c.bearing)}`))}` : ''}.`);
  const near = f.centres.filter((c) => c.kind !== 'cbd').slice(0, 3);
  if (near.length && near[0].distanceM <= 15_000) out.push(`The Sydney Plan's centres nearest the site are ${listWords(near.map((c) => `${c.name} (${c.kindWord}) ${km(c.distanceM)} ${dir(c.bearing)}`))}; ${f.centresOnMap ? `${numWord(f.centresOnMap)} of its centres fall within the ${f.widthKm} × ${f.heightKm} km map` : 'none of its other centres falls on the map'}.`);
  else if (near.length) out.push(`None of The Sydney Plan's centres lies within the window: the nearest is ${near[0].name} (${near[0].kindWord}), ${km(near[0].distanceM)} ${dir(near[0].bearing)}; the site is outside the plan's region.`);
  if (f.stations.length) out.push(`The nearest station is ${f.stations[0].name} (${f.stations[0].mode}), ${km(f.stations[0].distanceM)} ${dir(f.stations[0].bearing)}${f.stations.length > 1 ? `, then ${listWords(f.stations.slice(1, 3).map((s) => `${s.name} ${km(s.distanceM)} ${dir(s.bearing)}`))}` : ''}; ${f.stationsWithin5km ? `${fmtNum(f.stationsWithin5km)} train and metro station${f.stationsWithin5km === 1 ? '' : 's'}` : 'no train or metro station'}${f.stopsWithin5km ? ` and ${fmtNum(f.stopsWithin5km)} light rail stop${f.stopsWithin5km === 1 ? '' : 's'}` : ''} within 5 km.`);
  else if (f.stationsOk) out.push('No station lies on the map.');
  else out.push('The station layer did not answer for this run.');
  if (f.water.length) out.push(`${listWords(f.water.map((w) => `${w.name} ${w.distanceM < 300 ? 'at the site' : `${km(w.distanceM)} ${dir(w.bearing)}`}`))} ${f.water.length === 1 ? 'is' : 'are'} the water in the window.`);
  return out;
}

export function locationSlide(b: SlidesBundle): Slide {
  const t = tpl();
  const loc = b.location;
  const f = locationFacts(b);
  const sentences = locationSentences(b, f);
  const sources = `Sources: NSW Spatial Services administrative boundaries, water, transport and transport-facility themes, generalised for the scale; the centres from The Sydney Plan (2026) and the NSW Centres Framework; distances are straight lines from the site's geocoded point, the CBD at Sydney Town Hall. Retrieved ${b.generatedAt.slice(0, 10)}.`;

  // ---- the map
  const p = loc.panel;
  const proj = panelProjector(p);
  const centreLL = mercatorToLonLat(b.panel.center);
  const [sx, sy] = proj(centreLL.lon, centreLL.lat);
  const mmPerM = 1000 / p.scale;
  // The location map is monochrome: the terracotta family over an unprinted sea, cut to a disc 13 km round the site.
  const LOC = { deep: '#6e331d', rail: '#5d3327', road: '#a98d76', road2: '#bba188', road3: '#d9c8b8', name: '#7c4a33', soft: '#b59685' };
  const DISC_R = 130;
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#ffffff"/>`];
  const legend: LegendEntry[] = [];
  const land = loc.lgas.filter((l) => !l.unincorporated);
  if (land.length) {
    parts.push(`<path d="${land.map((l) => ringsPath(l.rings, proj)).join('')}" fill="${LAND_FILL}" fill-rule="evenodd" stroke="none"/>`);
    // farm dams and ponds under about half a hectare are specks at this scale, so they stay off
    const drawn = loc.water.filter((w) => w.rings.reduce((a, r) => a + clippedStats(r, proj, p).area, 0) >= 0.8);
    if (drawn.length) parts.push(`<path d="${drawn.map((w) => ringsPath(w.rings, proj)).join('')}" fill="#ffffff" fill-rule="evenodd" stroke="none"/>`);
    parts.push(`<path d="${land.map((l) => ringsPath(l.rings, proj)).join('')}" fill="none" stroke="${LGA_LINE}" stroke-width="0.3" stroke-linejoin="round"/>`);
    legend.push({ swatch: swatchFill(LAND_FILL, LGA_LINE), label: 'Local government areas; the harbour and the sea unprinted' });
  } else parts.push(emptyNote(['The boundary layers did not answer for this window.']));
  const lgaName = b.context.lga?.name?.toUpperCase();
  const mine = loc.lgas.filter((l) => lgaName && l.name.toUpperCase() === lgaName);
  if (mine.length) {
    parts.push(`<path d="${mine.map((l) => ringsPath(l.rings, proj)).join('')}" fill="${LOC.road3}" fill-opacity="0.5" stroke="${LOC.deep}" stroke-width="0.45" fill-rule="evenodd" stroke-linejoin="round"/>`);
    legend.push({ swatch: `<rect x="0" y="0.2" width="5" height="3" fill="${LOC.road3}" fill-opacity="0.5" stroke="${LOC.deep}" stroke-width="0.3"/>`, label: `${titleCase(b.context.lga!.name)} local government area` });
  }
  // roads by hierarchy, then rail with its dashes
  const byH = new Map<number, string[]>();
  for (const r of loc.roads) (byH.get(r.hierarchy) ?? byH.set(r.hierarchy, []).get(r.hierarchy)!).push(ringsPath([r.coords], proj, false));
  for (const [h, ds] of [...byH.entries()].sort((a, b2) => b2[0] - a[0])) parts.push(`<path d="${ds.join('')}" fill="none" stroke="${h <= 1 ? LOC.road : h <= 2 ? LOC.road2 : LOC.road3}" stroke-width="${h <= 1 ? 0.55 : h <= 2 ? 0.38 : 0.2}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (loc.roads.length) legend.push({ swatch: swatchLine(LOC.road, 0.55), label: 'Motorways, highways and arterial roads' });
  if (loc.rail.train.length) {
    const d = loc.rail.train.map((l) => ringsPath([l], proj, false)).join('');
    parts.push(railSymbol(d, LOC.rail));
    legend.push({ swatch: `<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${LOC.rail}" stroke-width="0.2"/><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${LOC.rail}" stroke-width="1.05" stroke-dasharray="0.16,1.3"/>`, label: 'Railways' });
  }
  if (loc.rail.tram.length) parts.push(`<path d="${loc.rail.tram.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${LOC.rail}" stroke-width="0.35" stroke-dasharray="0.8,0.8"/>`);
  // the rings
  for (const kmR of RING_KM) {
    const r = kmR * 1000 * mmPerM;
    parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${LOC.deep}" stroke-width="0.35" stroke-dasharray="2.2,1.3"/>`);
    parts.push(t2Text(sx + r * 0.7071 + 2.2, sy + r * 0.7071 + 2.6, `${kmR} km`));
  }
  legend.push({ swatch: swatchLine(LOC.deep, 0.35, '2.2,1.3'), label: '2 and 5 km from the site' });
  const spacer = new LabelSpacer(p.wMm, p.hMm, 120);
  spacer.take(sx, sy, 6, 6);
  spacer.take(sx + 3.2 + labelW('SITE', 2.6) / 2, sy, labelW('SITE', 2.6), 3.2);
  // the plan's centres first, by type, each named where a spot is free
  const centreMarks: string[] = [];
  const centreNamed = new Set<string>();
  for (const c of CENTRES) {
    const [x, y] = proj(c.lon, c.lat);
    if (x < 3 || y < 3 || x > p.wMm - 3 || y > p.hMm - 3) continue;
    const mark = c.kind === 'cbd' ? `<rect x="${(x - 1.7).toFixed(1)}" y="${(y - 1.7).toFixed(1)}" width="3.4" height="3.4" fill="${LOC.deep}" stroke="#ffffff" stroke-width="0.4"/>`
      : c.kind === 'major' ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${LOC.deep}" stroke="#ffffff" stroke-width="0.4"/>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3" fill="#ffffff" stroke="${LOC.deep}" stroke-width="0.5"/>`;
    centreMarks.push(mark);
    const w = t2Width(c.name);
    const spots: [number, number, 'start' | 'end' | 'middle'][] = [[x + 3.6 + w / 2, y, 'start'], [x - 3.6 - w / 2, y, 'end'], [x, y - 4, 'middle'], [x, y + 4.4, 'middle']];
    for (const [lx, ly, anchor] of spots) {
      if (!spacer.take(lx, ly, w, 2.8)) continue;
      const tx = anchor === 'start' ? x + 3.6 : anchor === 'end' ? x - 3.6 : x;
      centreMarks.push(t2Text(tx, ly, c.name, anchor));
      centreNamed.add(c.name.toUpperCase().replace(/ CBD$/, ''));
      break;
    }
    // the mark's own room is kept only once its name has had first pick of the spots beside it
    spacer.take(x, y, 3, 3);
  }
  if (centreMarks.length) {
    legend.push({ swatch: `<rect x="0.8" y="0.2" width="3.4" height="3.4" fill="${LOC.deep}"/>`, label: 'CBD (The Sydney Plan)' });
    legend.push({ swatch: `<circle cx="2.5" cy="1.9" r="1.6" fill="${LOC.deep}"/>`, label: 'Major centre' });
    legend.push({ swatch: `<circle cx="2.5" cy="1.9" r="1.3" fill="#ffffff" stroke="${LOC.deep}" stroke-width="0.5"/>`, label: 'Activity centre' });
  }
  // stations: the train and metro ones dotted, the nearest named
  const stationDots: string[] = [];
  const stationNames: string[] = [];
  for (const s of loc.stations) { if (stationMode(s.name) === 'light rail') continue; const [x, y] = proj(s.lon, s.lat); stationDots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.8" fill="#ffffff" stroke="${LOC.rail}" stroke-width="0.35"/>`); }
  if (stationDots.length) legend.push({ swatch: `<circle cx="2.5" cy="1.9" r="0.9" fill="#ffffff" stroke="${LOC.rail}" stroke-width="0.35"/>`, label: 'Train and metro stations' });
  // suburb names last, the largest in the window first, the site's own bolder, a centre's name not repeated
  const suburbLabels: string[] = [];
  const mySuburb = b.context.suburb?.name?.toUpperCase();
  const subs = loc.suburbs.map((s) => { let best = { area: 0, cx: 0, cy: 0 }; for (const r of s.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; } return { name: s.name, ...best }; }).filter((s) => s.area > 25).sort((a, b2) => b2.area - a.area);
  for (const s of subs.slice(0, 0)) {
    if (centreNamed.has(s.name.toUpperCase())) continue;
    const own = s.name.toUpperCase() === mySuburb;
    const text = tidyName(titleCase(s.name)).toUpperCase();
    const size = own ? 2.3 : 2.0;
    if (spacer.take(s.cx, s.cy, labelW(text, size) * 1.06, size + 0.8)) suburbLabels.push(`<text x="${s.cx.toFixed(1)}" y="${(s.cy + 0.7).toFixed(1)}" text-anchor="middle" font-size="${size}" letter-spacing="0.08em" font-weight="${own ? 700 : 400}" fill="${own ? LOC.name : LOC.soft}">${esc(text)}</text>`);
  }
  // the site last
  parts.push(...suburbLabels, ...stationDots, ...stationNames, ...centreMarks);
  parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.4" fill="${t.site}" stroke="#ffffff" stroke-width="0.6"/>`);
  legend.unshift({ swatch: `<circle cx="2.5" cy="1.9" r="1.6" fill="${t.site}"/>`, label: 'The site' });
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-location"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-location)" font-family="${t.font}">${parts.join('\n')}</g>
    <g font-family="${t.font}">${panelFurniture(p, 'right')}</g>
  </svg>`;
  const legendHtml = legend.map((e) => `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${e.swatch}</svg><span>${esc(e.label)}</span></div>`).join('');

  // ---- the figures and the table
  const km = (m: number) => (m >= 950 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${fmtNum(Math.round(m / 10) * 10)} m`);
  const near = f.centres.find((c) => c.kind !== 'cbd');
  const tiles = [
    { v: km(f.cbd.distanceM), l: `to the Sydney CBD (Town Hall), ${compassWord(f.cbd.bearing)}` },
    { v: near ? near.name : '—', l: near ? `nearest ${near.kindWord} of The Sydney Plan · ${km(near.distanceM)} ${compassWord(near.bearing)}` : 'no centre of the plan in reach' },
    { v: f.stations[0]?.name ?? '—', l: f.stations[0] ? `nearest station (${f.stations[0].mode}) · ${km(f.stations[0].distanceM)} ${compassWord(f.stations[0].bearing)}` : 'no station in the window' },
    { v: f.lga?.name ?? '—', l: `local government area${f.district ? ` · ${f.district} (former district)` : ''}${f.region ? ` · ${f.region} region` : ''}` },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const rows = f.centres.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.kindWord)}</td><td class="r">${km(c.distanceM)}</td><td>${esc(compassWord(c.bearing))}</td></tr>`).join('');
  const table = `<table class="da"><thead><tr><th>Centre</th><th>Type</th><th class="r">Distance</th><th>Direction</th></tr></thead><tbody>${rows}</tbody></table>`;
  const figure = `<div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">The region · 1:${fmtNum(p.scale).replace(',', ' ')}</div>`;
  const textHtml = sentences.slice(1).map(para).join('');
  const narrative = sentences[0];
  void tiles; void table; void legendHtml;
  const sub = [[b.siteAddress, f.lga ? f.lga.name : ''].filter(Boolean).join(' '), `${km(f.cbd.distanceM)} from the Sydney CBD`, near ? `${near.name} ${km(near.distanceM)}` : ''].filter(Boolean).join(' · ');
  return { id: '01_location', title: 'Location', subtitle: sub, textHtml, figureHtml: figure, bleed: true, sources, narrative, accent: '#f5a470', legend };
}

// ---- slide 02: character ----------------------------------------------------------

const WIKI_PLACE_COLOUR = '#2c4c9c';
const CHARACTER_PHOTOS = 8;
/** The seed paragraph is cut at a sentence end near this length, so it sits in the column with the rest. */
const EXTRACT_CHARS = 820;

function clipSentences(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.” '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return cut > max * 0.5 ? head.slice(0, cut + 1) : `${head.trimEnd()}…`;
}

/** What the open sources say and show of the place: the article, the places with articles near the site, the photographs and the aerial. */
export function characterFacts(b: SlidesBundle) {
  const c = b.character;
  const proj = panelProjector(b.panel);
  const suburb = b.context.suburb?.name ? titleCase(b.context.suburb.name) : undefined;
  const wp = c.wikipedia.summary;
  const extract = wp ? clipSentences(wp.extract, EXTRACT_CHARS) : '';
  const places = c.places.items.map((p, i) => {
    const [x, y] = proj(p.lon, p.lat);
    return { n: i + 1, ...p, side: compassWord(p.bearing), onMap: x >= 1 && x <= PANEL_W - 1 && y >= 1 && y <= PANEL_H - 1 };
  });
  const photos = c.photos.items.map((p) => ({
    ...p,
    caption: `${p.n} · ${p.title}${p.date ? `, ${p.date.slice(0, 4)}` : ''} · ${p.author ?? 'author not recorded'} · ${p.licence} · Wikimedia Commons${p.lead ? ' (the article\'s image)' : p.distanceM !== undefined ? ` · ${fmtNum(p.distanceM)} m ${compassWord(p.bearing ?? 0)} of the site` : ''}`,
  }));
  const authors = [...new Set(photos.map((p) => p.author).filter((a): a is string => Boolean(a)))];
  const years = photos.map((p) => p.date?.slice(0, 4)).filter((y): y is string => Boolean(y)).sort();
  const img = b.site.imagery;
  return {
    suburb,
    wikipedia: wp ? { title: wp.title, shortTitle: wp.title.replace(/, (New South Wales|Sydney)$/, ''), description: wp.description, url: wp.url, extract, clipped: extract.length < wp.extract.replace(/\s+/g, ' ').trim().length } : null,
    wikipediaNote: c.wikipedia.note,
    places, placesOk: c.places.ok, placesNote: c.places.note, placesRadiusM: c.places.radiusM,
    photos, photosOk: c.photos.ok, photosNote: c.photos.note, photoCandidates: c.photos.candidates, photosRadiusM: c.photos.radiusM, authors, yearRange: years.length ? { first: years[0], last: years[years.length - 1] } : null,
    aerial: c.aerial ? { tiles: c.aerial.tiles.length, block: img?.block, date: img?.date, resolutionCm: img?.resolutionCm } : null,
    placeholders: Math.max(0, CHARACTER_PHOTOS - photos.length),
  };
}

export function characterSentences(b: SlidesBundle, f: ReturnType<typeof characterFacts>): string[] {
  const out: string[] = [];
  const who = f.suburb ?? 'the suburb';
  if (f.wikipedia) out.push(`Wikipedia's article on ${f.wikipedia.shortTitle}${f.wikipedia.description ? ` (${f.wikipedia.description})` : ''} is the seed text below${f.wikipedia.clipped ? ', cut at a sentence' : ''}; it is the encyclopaedia's account, CC BY-SA 4.0, not the office's reading of the place.`);
  else out.push(`Wikipedia ${f.wikipediaNote ? `did not answer for this run (${f.wikipediaNote})` : `has no article for ${who}`}, so the seed text is the author's.`);
  if (f.places.length) {
    const lead = f.places.slice(0, 4).map((p) => `${p.title}${p.description ? ` (${p.description})` : ''} ${fmtNum(p.distanceM)} m ${p.side}`);
    out.push(`${capFirst(numWord(f.places.length))} place${f.places.length === 1 ? ' has an article' : 's have articles'} of ${f.places.length === 1 ? 'its' : 'their'} own within ${(f.placesRadiusM / 1000).toFixed(1)} km: ${listWords(lead)}${f.places.length > 4 ? ` and ${f.places.length - 4} more, listed at right` : ''}.`);
  } else if (f.placesOk) out.push(`No place within ${(f.placesRadiusM / 1000).toFixed(1)} km has a Wikipedia article of its own.`);
  else out.push(`Wikipedia's place search did not answer for this run${f.placesNote ? ` (${f.placesNote})` : ''}.`);
  if (f.photos.length) {
    const by = f.authors.length === 1 ? `by ${f.authors[0]}` : `by ${numWord(f.authors.length)} contributors`;
    const when = f.yearRange ? (f.yearRange.first === f.yearRange.last ? `, ${f.yearRange.first}` : `, ${f.yearRange.first} to ${f.yearRange.last}`) : '';
    out.push(`${capFirst(numWord(f.photos.length))} open-licence photograph${f.photos.length === 1 ? '' : 's'} within ${f.photosRadiusM} m ${f.photos.length === 1 ? 'is' : 'are'} on Wikimedia Commons ${by}${when}${f.photoCandidates > f.photos.length ? `, chosen from ${f.photoCandidates}` : ''}, each credited under its frame; the office's photographs replace them.`);
  } else if (f.photosOk) out.push(`Wikimedia Commons holds no usable open-licence photograph within ${f.photosRadiusM} m of the site${f.photoCandidates ? '' : ''}; the placeholders are sized for the office's own.`);
  else out.push(`Wikimedia Commons did not answer for this run${f.photosNote ? ` (${f.photosNote})` : ''}; the placeholders are sized for the office's photographs.`);
  if (f.aerial) out.push(`The aerial shows the grain of the place at 1:${fmtNum(b.panel.scale)}${f.aerial.date ? `, as captured ${fmtIso(f.aerial.date)}` : ''}, with the places numbered on it.`);
  return out;
}

export function characterSlide(b: SlidesBundle): Slide {
  const t = tpl();
  const f = characterFacts(b);
  const c = b.character;
  const sentences = characterSentences(b, f);
  const quote = f.wikipedia ? `<div class="quote"><p>${esc(f.wikipedia.extract)}</p><div class="qsrc">— Wikipedia, "${esc(f.wikipedia.title)}", CC BY-SA 4.0 · ${esc(f.wikipedia.url)}</div></div>` : '';
  const textHtml = sentences.map(para).join('') + quote +
    placeholder('Narrative — for the author: the character of the place as the office reads it — the street pattern and its grain, the building stock and its periods, the uses and the life of the street, the landmarks and the gaps, what the photographs show and what they miss.') +
    `<div class="fine">Sources: Wikipedia${f.wikipedia ? ` (the article "${esc(f.wikipedia.title)}", text CC BY-SA 4.0)` : ''} and its geosearch for the articles placed within ${(f.placesRadiusM / 1000).toFixed(1)} km; Wikimedia Commons for the photographs within ${f.photosRadiusM} m, each under the licence credited with it, cropped to the strip; NSW Imagery via SIX Maps${f.aerial?.block ? ` (${esc(titleCase(f.aerial.block))} block${f.aerial.date ? `, captured ${fmtIso(f.aerial.date)}` : ''}${f.aerial.resolutionCm ? `, ${f.aerial.resolutionCm} cm` : ''})` : ''}; cadastre from NSW Spatial Services. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;

  // ---- the aerial over the planning window, the places numbered on it
  const p = b.panel;
  const proj = panelProjector(p);
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#f5eee0"/>`];
  if (c.aerial) for (const tile of c.aerial.tiles) parts.push(`<image href="data/${tile.file}" x="${(tile.left * p.wMm).toFixed(2)}" y="${(tile.top * p.hMm).toFixed(2)}" width="${(tile.width * p.wMm).toFixed(2)}" height="${(tile.height * p.hMm).toFixed(2)}" preserveAspectRatio="none"/>`);
  else parts.push(emptyNote(['The aerial imagery did not answer for this window.']));
  parts.push(siteMark(b.base, proj, 'both'));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 40);
  for (const pl of f.places) {
    if (!pl.onMap) continue;
    const [x, y] = proj(pl.lon, pl.lat);
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.4" fill="${WIKI_PLACE_COLOUR}" stroke="#ffffff" stroke-width="0.4"/><text x="${x.toFixed(2)}" y="${(y + 0.9).toFixed(2)}" text-anchor="middle" font-size="2.5" font-weight="600" fill="#ffffff">${pl.n}</text>`);
    spacer.take(x, y, 5, 5);
  }
  for (const pl of f.places) {
    if (!pl.onMap) continue;
    const [x, y] = proj(pl.lon, pl.lat);
    const text = pl.title;
    const w = labelW(text, 2.1);
    if (spacer.take(x + 3.2 + w / 2, y, w, 2.8)) parts.push(`<text x="${(x + 3.2).toFixed(1)}" y="${(y + 0.75).toFixed(1)}" font-size="2.1" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${esc(text)}</text>`);
  }
  parts.push(panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-character"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-character)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // ---- the places table
  const rows = f.places.map((pl) => `<tr><td class="n">${pl.n}</td><td><b>${esc(pl.title)}</b>${pl.description ? `<span class="dim"> · ${esc(pl.description)}</span>` : ''}${pl.onMap ? '' : '<span class="dim"> · beyond the aerial</span>'}</td><td class="r">${fmtNum(pl.distanceM)} m ${esc(pl.side)}</td></tr>`).join('');
  const table = f.places.length
    ? `<table class="da cons"><thead><tr><th class="n">#</th><th>Place with an article of its own</th><th class="r">From the site</th></tr></thead><tbody>${rows}</tbody></table>`
    : emptyBox(PANEL_W, 30, f.placesOk ? `No place within ${(f.placesRadiusM / 1000).toFixed(1)} km has a Wikipedia article of its own.` : 'Wikipedia\'s place search did not answer for this run.');

  // ---- the photographs, four across, placeholders for the office's own
  const cells: string[] = [];
  for (let i = 0; i < CHARACTER_PHOTOS; i++) {
    const ph = f.photos[i];
    if (ph) cells.push(`<div class="frame"><div class="img"><img src="data/${esc(ph.file)}" alt=""><span class="key plc">${ph.n}</span></div><div class="cap">${esc(ph.caption)}</div></div>`);
    else cells.push(`<div class="frame ph"><div class="img">Office photograph</div><div class="cap">${esc(`${i + 1} · for the author: the office's photograph of the place, credited`)}</div></div>`);
  }
  const rowY = FIELD_Y + PANEL_TITLE_H + PANEL_H + 3;
  const figure = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">The place from above<span class="pnote">1:${fmtNum(p.scale)}${f.aerial?.date ? ` · captured ${fmtIso(f.aerial.date)}` : ''} · the places with articles numbered</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${rowY}mm;width:${FIELD_W}mm">Photographs<span class="pnote">${f.photos.length ? `open-licence frames within ${f.photosRadiusM} m from Wikimedia Commons · the office's photographs replace them` : 'placeholders sized for the office\'s photographs'}</span></div>
    <div class="abs photos four" style="left:${FIELD_X}mm;top:${rowY + PANEL_TITLE_H}mm;width:${FIELD_W}mm">${cells.join('')}</div>
    <div class="abs" style="left:${AUX_X}mm;top:${FIELD_Y}mm;width:${AUX_W}mm;height:${SLIDE_H - FIELD_Y - 14}mm;overflow:hidden">
      <div class="ptitle sm">Places nearby<span class="pnote">within ${(f.placesRadiusM / 1000).toFixed(1)} km, nearest first</span></div>
      ${table}
    </div>`;
  const sub = [b.siteAddress, f.suburb ?? '', f.places.length ? `${f.places.length} place${f.places.length === 1 ? '' : 's'} with articles` : '', f.photos.length ? `${f.photos.length} open photograph${f.photos.length === 1 ? '' : 's'}` : 'no open photograph'].filter(Boolean).join(' · ');
  return { id: '02_character', title: 'Character', subtitle: sub, textHtml, figureHtml: figure };
}

/** A numbered marker on an aerial: white disc, black hairline, the number in 6 pt. */
const aerialKey = (x: number, y: number, n: number | string, r = 1.9) =>
  `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="#ffffff" stroke="#000000" stroke-width="0.25"/><text x="${x.toFixed(2)}" y="${(y + 0.74).toFixed(2)}" text-anchor="middle" font-size="2.117" font-family="Arial, 'Liberation Sans', sans-serif" fill="#000000">${esc(String(n))}</text>`;
/** A 6 pt word on an aerial: white, haloed in black. */
const a6 = (x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start') =>
  `<text x="${x.toFixed(2)}" y="${(y + 0.75).toFixed(2)}" text-anchor="${anchor}" font-size="2.117" letter-spacing="0.19" font-family="Arial, 'Liberation Sans', sans-serif" fill="#ffffff" stroke="#000000" stroke-width="0.55" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
/** Aerial tiles laid over a panel: by the window they cover where the fetch kept it, else as fractions of the panel. */
const aerialTiles = (tiles: { file: string; left: number; top: number; width: number; height: number }[], p: Panel, extent?: Extent) => {
  let X0 = 0, Y0 = 0, W = p.wMm, H = p.hMm;
  if (extent) {
    const proj = panelProjector(p);
    const nw = mercatorToLonLat({ x: extent.xmin, y: extent.ymax }), se = mercatorToLonLat({ x: extent.xmax, y: extent.ymin });
    const [x0, y0] = proj(nw.lon, nw.lat), [x1, y1] = proj(se.lon, se.lat);
    X0 = x0; Y0 = y0; W = x1 - x0; H = y1 - y0;
  }
  return tiles.map((tile) => `<image href="data/${tile.file}" x="${(X0 + tile.left * W - 0.02).toFixed(2)}" y="${(Y0 + tile.top * H - 0.02).toFixed(2)}" width="${(tile.width * W + 0.04).toFixed(2)}" height="${(tile.height * H + 0.04).toFixed(2)}" preserveAspectRatio="none"/>`).join('');
};
/** The template's photographs: two to a row, each 59 mm wide, a number on the frame and a 6 pt credit under it. */
const zPhotos = (cells: { file?: string; svg?: string; n: number | string; caption: string; whole?: boolean }[]) =>
  `<div class="zphoto">${cells.map((c) => `<div class="f"><div class="im">${c.svg ?? (c.file ? `<img src="data/${esc(c.file)}" alt=""${c.whole ? ' style="object-fit:contain;background:#000"' : ''}>` : '')}</div><div class="c">${esc(c.caption)}</div></div>`).join('')}</div>`;
/** A frame of aerial: the tiles of a fetch drawn into the template's 59.33 × 39.5 mm photograph, an optional overlay in its millimetres. */
const aerialFrame = (aerial: { tiles: { file: string; left: number; top: number; width: number; height: number }[] }, overlay = '', w = 59.33, h = 39.5) =>
  `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block">${aerial.tiles.map((tile) => `<image href="data/${tile.file}" x="${(tile.left * w - 0.02).toFixed(2)}" y="${(tile.top * h - 0.02).toFixed(2)}" width="${(tile.width * w + 0.04).toFixed(2)}" height="${(tile.height * h + 0.04).toFixed(2)}" preserveAspectRatio="none"/>`).join('')}${overlay}</svg>`;

/** Character on the template: the aerial over the full page with the places numbered on it; the encyclopaedia's account, the places, the photographs. */
export function characterAtlas(b0: SlidesBundle): Slide {
  const p = b0.bleedPanel;
  const b: SlidesBundle = { ...b0, panel: p };
  const t = tpl();
  const O = INK.orange;
  const f = characterFacts(b);
  const c = b.character;
  const proj = panelProjector(p);
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#f2f2f2"/>`];
  if (c.aerial) parts.push(aerialTiles(c.aerial.tiles, p, c.aerial.extent));
  parts.push(siteMark(b.base, proj, 'both'));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const marks: string[] = [], names: string[] = [];
  for (const pl of f.places) {
    const [x, y] = proj(pl.lon, pl.lat);
    if (x < 3 || y < 3 || x > p.wMm - 3 || y > p.hMm - 3) continue;
    marks.push(aerialKey(x, y, pl.n));
    spacer.take(x, y, 4.4, 4.4);
  }
  for (const pl of f.places) {
    const [x, y] = proj(pl.lon, pl.lat);
    if (x < 3 || y < 3 || x > p.wMm - 3 || y > p.hMm - 3) continue;
    const w = pl.title.length * 1.6 + 1;
    for (const [lx, anchor] of [[x + 3, 'start'], [x - 3, 'end']] as [number, 'start' | 'end'][]) if (spacer.take(anchor === 'start' ? lx + w / 2 : lx - w / 2, y, w, 2.8)) { names.push(a6(lx, y, pl.title, anchor)); break; }
  }
  parts.push(...marks, ...names, panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('char02', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    { swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="#ffffff" stroke="#000000" stroke-width="0.25"/>`, label: `A place with a Wikipedia article of its own, numbered nearest first` },
    SITE_KEY(t),
  ];
  const limit = keyTop(legend.length) - 6;
  const blocks: string[] = [];
  let y = 44;
  if (f.wikipedia) {
    const text = clipSentences(f.wikipedia.extract, 560);
    blocks.push(zBlock(`The suburb · ${f.wikipedia.shortTitle}`, `<div class="zr" style="padding-left:0;border-bottom:0"><div class="v">${esc(text)}</div></div>`));
    y += blockH(Math.ceil(text.length / 82) * 3.4 + 4);
  }
  const views = (c.placeViews ?? []).slice(0, 8);
  // as many rows of two as the page holds above the key
  const rowH = 39.5 + 3 + 6.2;
  const nViews = Math.min(views.length, 2 * Math.max(1, Math.floor((limit - y - 6.21 - 3 - 7.5) / rowH)));
  const photoH = 6.21 + 3 + Math.ceil(nViews / 2) * rowH + 7.5;
  const nPlaces = Math.max(0, Math.min(f.places.length, 10, Math.floor((limit - y - photoH - blockH(10)) / 3.95)));
  if (nPlaces >= 3) {
    const rows = f.places.slice(0, nPlaces).map((pl) => ({ name: shorten(`${pl.n}  ${pl.title}`, 40), value: pl.distanceM, label: `${fmtNum(pl.distanceM)} m ${pl.side}`, fill: { bg: O.solid } as Fill }));
    const ax = niceAxis(Math.max(...rows.map((r) => r.value)));
    blocks.push(zBlock(`Places nearby · from the site, m`, zBars(rows, ax.max, ax.step), `${f.places.length} within ${(f.placesRadiusM / 1000).toFixed(1)} km`));
  }
  if (nViews) {
    // from the street where Street View stands near the place, else from above
    const svs = c.placeStreetViews ?? [];
    const monthYear = (d?: string) => (d ? new Date(`${d}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
    const cells = views.slice(0, nViews).map((v) => {
      const pl = f.places.find((q) => q.n === v.n);
      const sv = svs.find((q) => q.n === v.n);
      const where = `${v.n} ${v.title}${pl ? ` · ${fmtNum(pl.distanceM)} m ${pl.side}` : ''}`;
      return sv ? { file: sv.file, n: v.n, caption: `${where} · Street View${sv.date ? `, ${monthYear(sv.date)}` : ''} © Google` } : { svg: aerialFrame(v.aerial), n: v.n, caption: `${where} · from above` };
    });
    const street = cells.filter((cl) => 'file' in cl && cl.file).length;
    blocks.push(zBlock(street ? 'The places from the street' : 'The places from above', zPhotos(cells), street ? 'Google Street View' : `NSW Imagery${f.aerial?.date ? ` · ${fmtIso(f.aerial.date)}` : ''}`));
  }
  const sources = `Sources: Wikipedia${f.wikipedia ? `, "${f.wikipedia.title}", ${f.wikipedia.url.replace(/^https?:\/\//, '')}, text CC BY-SA 4.0,` : ''} and its geosearch for the places with articles within ${(f.placesRadiusM / 1000).toFixed(1)} km; NSW Imagery via SIX Maps for the aerial${f.aerial?.date ? `, captured ${fmtIso(f.aerial.date)}` : ''}${(c.placeStreetViews ?? []).length ? '; Google Street View Static API for the places from the street, each from the panorama nearest it, © Google' : ''}. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b0, f.places.length ? `${f.places.length} place${f.places.length === 1 ? '' : 's'} with articles within ${(f.placesRadiusM / 1000).toFixed(1)} km` : '');
  return { id: '02_character', title: 'Character', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, `The place from above${f.aerial?.date ? ` · ${fmtIso(f.aerial.date)}` : ''}`, p, zFlow(blocks)), bleed: true, sources, accent: O.text, legend,
    narrative: brief([f.places.length ? `${capFirst(numWord(f.places.length))} place${f.places.length === 1 ? '' : 's'} within ${(f.placesRadiusM / 1000).toFixed(1)} km ${f.places.length === 1 ? 'has an article' : 'have articles'} of ${f.places.length === 1 ? 'its' : 'their'} own; the nearest are ${listWords(f.places.slice(0, 3).map((pl) => `${pl.title} ${fmtNum(pl.distanceM)} m ${pl.side}`))}.` : '']) };
}

// ---- slide 05: strategic context ---------------------------------------------------

const STATE_PLAN_URL = 'https://www.planning.nsw.gov.au/the-planning-system/the-state-plan';
const SYDNEY_PLAN_COMMENCED = '2026-08-13';

interface StrategyRow {
  level: 'State' | 'Region' | 'District' | 'Local' | 'Statutory' | 'Contributions' | 'By hand';
  document: string;
  line: string;
  status: string;
  url?: string;
  /** Whether the row is a placeholder the author fills. */
  manual?: boolean;
}

/** The documents over the site, top down, each with the one line the deck can say about it and its link. */
/** "COUNCIL OF THE CITY OF SYDNEY" -> "City of Sydney"; "INNER WEST COUNCIL" stays "Inner West Council". */
const councilDisplay = (council?: string, lga?: string) => {
  const c = council ? titleCase(council).replace(/^Council Of The /i, '').replace(/\bOf\b/g, 'of').replace(/\bThe\b/g, 'the').replace(/\bAnd\b/g, 'and') : lga ? `${titleCase(lga)} Council` : 'the council';
  return c;
};

export function strategicFacts(b: SlidesBundle, planning: PlanningFacts) {
  const st = b.strategies;
  const ctx = b.context;
  const rows: StrategyRow[] = [];
  const council = councilDisplay(ctx.lga?.council, ctx.lga?.name);
  const isSydney = st.region.plan?.region === 'Greater Sydney' || (!st.region.name && Boolean(ctx.district));
  rows.push({ level: 'State', document: 'NSW State Land Use Plan and its technical appendices (the State Plan)', line: 'the State\'s land use policies and, in Appendix E, the NSW Centres Framework of four centre types the regional plans apply', status: 'in force · 2026', url: STATE_PLAN_URL });
  if (st.region.plan) {
    const pl = st.region.plan;
    rows.push({ level: 'Region', document: pl.name, line: pl.region === 'Greater Sydney' ? 'one strategic framework for the 33 councils of the Sydney region: where housing and jobs grow, in well-located centres and corridors' : `the regional plan for ${pl.region}: the vision, the objectives and the strategies for the region's places to 2041`, status: pl.note ? pl.note : `in force${pl.year ? ` · ${pl.year}` : ''}`, url: pl.url });
  } else rows.push({ level: 'Region', document: st.region.ok ? `regional plan for ${st.region.name ?? 'this region'}` : 'regional plan', line: st.region.ok ? 'the planning region was read but no plan in the deck\'s table matches it' : 'the planning-regions layer did not answer for this run', status: 'to confirm', manual: true });
  if (isSydney) rows.push({ level: 'District', document: ctx.district ? `${ctx.district} District Plan (2018)` : 'the former district plan', line: 'the five district plans of the Greater Sydney Commission set the district\'s priorities and each council\'s housing target', status: `superseded by The Sydney Plan on ${fmtIso(SYDNEY_PLAN_COMMENCED)}` });
  if (st.lsps.entry) rows.push({ level: 'Local', document: st.lsps.entry.title, line: 'the council\'s 20-year land use vision, planning priorities and structure plan under section 3.9 of the Act', status: `${st.lsps.entry.year ?? 'in force'}${isSydney ? ' · reviewed against The Sydney Plan from mid-2027' : ''}`, url: st.lsps.entry.url });
  else rows.push({ level: 'Local', document: `${council}'s Local Strategic Planning Statement`, line: st.lsps.ok ? `not found in the Planning Portal's index of ${st.lsps.indexed} statements` : `the Portal's index did not answer for this run${st.lsps.note ? ` (${st.lsps.note})` : ''}`, status: 'to find', manual: true });
  rows.push({ level: 'Local', document: `${council}'s local housing strategy`, line: 'where the council plans its housing target: the sites, the centres and the sequence', status: 'not indexed — on the council\'s site', manual: true });
  const epi = b.controls.epiName ?? planning.zoneAtSite?.epi;
  rows.push({ level: 'Statutory', document: epi ?? 'the local environmental plan', line: `the zone, the height, the floor space ratio and the local provisions at the site${planning.zoneAtSite ? ` (${planning.zoneAtSite.code}${planning.zoneAtSite.name ? ` ${planning.zoneAtSite.name}` : ''})` : ''}`, status: planning.zoneAtSite?.currency ? `map current ${fmtAnyDate(planning.zoneAtSite.currency) ?? planning.zoneAtSite.currency}` : 'in force', url: planning.legislationUrl });
  if (ctx.dcp) rows.push({ level: 'Statutory', document: ctx.dcp.name, line: `the council's detailed controls: setbacks, design, parking, landscape${ctx.dcps.length > 1 ? `; ${ctx.dcps.length - 1} further plan${ctx.dcps.length > 2 ? 's' : ''} mapped at the site (${ctx.dcps.slice(1, 4).map((d) => d.name).join('; ')}${ctx.dcps.length > 4 ? ` and ${ctx.dcps.length - 4} more, listed on slide 04` : ''})` : ''}`, status: 'in force', url: ctx.dcp.url });
  else rows.push({ level: 'Statutory', document: 'development control plan', line: 'no DCP is mapped at the site in the development-control layer', status: 'to confirm', manual: true });
  const contrib = ctx.contributions;
  if (contrib.length) {
    const groups = new Map<string, { name: string; detail?: string }[]>();
    for (const c of contrib) (groups.get(c.kind) ?? groups.set(c.kind, []).get(c.kind)!).push({ name: c.name, detail: c.detail });
    for (const [kind, items] of groups) {
      const link = items.map((i) => i.detail).find((d) => d && /^https?:\/\//i.test(d));
      rows.push({ level: 'Contributions', document: kind, line: items.map((i) => `${i.name}${i.detail && !/^https?:\/\//i.test(i.detail) ? ` (${i.detail})` : ''}`).join('; '), status: 'applies at the site', url: link });
    }
  } else rows.push({ level: 'Contributions', document: 'contributions plans', line: 'no State or local contributions plan is mapped at the site in the ePlanning layers', status: 'none mapped' });
  if (b.housingTarget) rows.push({ level: 'Local', document: `${council}'s housing target`, line: `${fmtNum(b.housingTarget.homes)} new homes by ${b.housingTarget.by}, set by the State`, status: 'current', url: b.housingTarget.url });
  rows.push({ level: 'By hand', document: 'Centre, precinct or place strategy', line: 'the council\'s or the Department\'s strategy for the centre or precinct the site sits in, where one exists', status: 'for the author', manual: true });
  rows.push({ level: 'By hand', document: 'Public domain plan and local character statements', line: 'streetscape, materials and the character the council describes for this place', status: 'for the author', manual: true });
  const linked = rows.filter((r) => r.url).length;
  return { rows, linked, region: st.region, lsps: st.lsps.entry, isSydney, district: ctx.district, council };
}

export function strategicSentences(b: SlidesBundle, f: ReturnType<typeof strategicFacts>): string[] {
  const out: string[] = [];
  const pl = f.region.plan;
  if (pl && f.isSydney) out.push(`The site sits in the Sydney region under The Sydney Plan, which commenced on ${fmtIso(SYDNEY_PLAN_COMMENCED)} and replaced the Greater Sydney Region Plan of 2018${f.district ? ` and the ${f.district} District Plan` : ' and the five district plans'}; it applies the State Land Use Plan and its centres framework.`);
  else if (pl) out.push(`The site sits in the ${pl.region} region under the ${pl.name}${pl.year ? ` (${pl.year})` : ''}, the Department's regional plan, which applies the State Land Use Plan.`);
  else out.push('The planning region at the site could not be matched to a regional plan on this run; the row is left to confirm.');
  if (f.lsps) out.push(`${f.council ?? 'The council'}'s local strategic planning statement, ${f.lsps.title}${f.lsps.year ? ` (${f.lsps.year})` : ''}, is the local vision the plan sits over${f.isSydney ? ', in force until the council reviews it against The Sydney Plan from mid-2027' : ''}; its priorities and structure plan are the author's to extract.`);
  else out.push(`${f.council ?? 'The council'}'s local strategic planning statement was not found in the Planning Portal's index, so its row is left to find.`);
  const statutory = f.rows.filter((r) => r.level === 'Statutory');
  const contrib = f.rows.filter((r) => r.level === 'Contributions' && !/none mapped/.test(r.status));
  out.push(`The statutory layer is ${listWords(statutory.map((r) => r.document))}${contrib.length ? `, with ${listWords(contrib.map((r) => r.document.replace(/ — .*$/, '').toLowerCase()))} applying` : ''}${b.housingTarget ? `; the council's target is ${fmtNum(b.housingTarget.homes)} homes by ${b.housingTarget.by}` : ''}. ${f.linked} of the ${f.rows.length} rows carry a link; the extracts stay the author's.`);
  return out;
}

export function strategicSlide(b: SlidesBundle, planning: PlanningFacts): Slide {
  const f = strategicFacts(b, planning);
  const sentences = strategicSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Extracts — for the author: the plan\'s directions for this place (the centre, the corridor, the precinct), the statement\'s planning priorities that touch the site and its structure plan, and the local strategies — housing, centres, public domain — with their maps.') +
    `<div class="fine">Sources: the Department's planning-regions layer for the region at the site; the Planning Portal's index of local strategic planning statements (${b.strategies.lsps.indexed ? `${fmtNum(b.strategies.lsps.indexed)} statements listed` : 'not read'}); the Department's plans-by-region pages for the regional plans' names and links; the local plan, the DCP and the contributions layers from ePlanning and the Planning Portal's property report; the housing target from the Department's council snapshot. The documents themselves are not read: the lines are what each is, not what it says. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const short = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\?.*$/, '').replace(/\/$/, '');
  const rows = f.rows.map((r) => `<tr${r.manual ? ' class="manual"' : ''}><th>${esc(r.level)}</th><td><b>${esc(r.document)}</b></td><td>${esc(r.line)}</td><td class="status">${esc(r.status)}</td><td class="lnk">${r.url ? `<a href="${esc(r.url)}">${esc(short(r.url).length > 70 ? `${short(r.url).slice(0, 68)}…` : short(r.url))}</a>` : (r.manual ? '<span class="dim">by hand</span>' : '—')}</td></tr>`).join('');
  const table = `<table class="da strat"><thead><tr><th>Level</th><th>Document</th><th>What it is</th><th>Status</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table>`;
  const figure = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">The documents over the site<span class="pnote">top down · one line each · the extracts are the author's</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${FIELD_W}mm">${table}</div>`;
  const sub = [b.siteAddress, f.region.plan?.name ?? '', f.lsps ? 'LSPS linked' : 'LSPS to find', `${f.linked} links`].filter(Boolean).join(' · ');
  return { id: '05_strategic_context', title: 'Strategic context', subtitle: sub, textHtml, figureHtml: figure };
}

/** Strategic context on the template: the policy areas round the site mapped, the plans over it on a time line, then listed. */
export function strategicAtlas(b0: SlidesBundle, planning: PlanningFacts): Slide {
  const p = b0.bleedPanel;
  const b: SlidesBundle = { ...b0, panel: p, daPanel: p };
  const t = tpl();
  const R = INK.red;
  const f = strategicFacts(b0, planning);
  const POLICY_FILL: Record<PolicyKind, Fill> = {
    townCentre: { bg: R.light, outline: R.mid, outlineW: 0.2 },
    tod: { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.75, w: 0.16, outline: R.line, outlineW: 0.25 },
    todAccelerated: { bg: '#ffffff', kind: 'vlines', ink: R.deep, step: 0.45, w: 0.16, outline: R.deep, outlineW: 0.25 },
    todDeferred: { bg: '#ffffff', kind: 'dots', ink: R.line, step: 0.9, w: 0.12, outline: R.line, outlineW: 0.25 },
    ssdSite: { bg: '#ffffff', kind: 'hlines', ink: R.line, step: 0.7, w: 0.16, outline: R.deep, outlineW: 0.3 },
    precinct: { outline: R.deep, outlineW: 0.45, dash: '1.6 0.8' },
  };
  const ORDER: PolicyKind[] = ['townCentre', 'tod', 'todAccelerated', 'todDeferred', 'ssdSite', 'precinct'];
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  const present: PolicyKind[] = [];
  const cands: { area: number; cx: number; cy: number; text: string }[] = [];
  for (const kind of ORDER) {
    const areas = b.policy.filter((a) => a.kind === kind);
    const onPage = areas.filter((a) => a.rings.some((r) => clippedStats(r, proj, p).area > 0));
    if (!onPage.length) continue;
    present.push(kind);
    parts.push(fillShape(onPage.map((a) => ringsPath(a.rings, proj)).join(''), box, POLICY_FILL[kind]));
    const byName = new Map<string, { area: number; cx: number; cy: number }>();
    for (const a of onPage) for (const r of a.rings) { const st = clippedStats(r, proj, p); const cur = byName.get(a.name); if (st.area > 0 && (!cur || st.area > cur.area)) byName.set(a.name, st); }
    for (const [name, st] of byName) cands.push({ ...st, text: shorten(name, 34) });
  }
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const labels: string[] = [];
  for (const c of cands.sort((x, y) => y.area - x.area)) {
    const w = c.text.length * 1.6 + 1;
    for (const [lx, ly] of [[c.cx, c.cy], [c.cx, c.cy - 4], [c.cx, c.cy + 4]] as [number, number][]) if (spacer.take(lx, ly, w, 2.8)) { labels.push(m6(lx, ly, c.text)); break; }
  }
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('strat05', p, parts.join('\n'));

  // ---- the plans on a time line: from the year each began to the year it ends, open where it runs on
  const now = new Date(b.generatedAt).getUTCFullYear();
  const yearsIn = (s: string) => [...s.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  const spans = f.rows.filter((r) => !r.manual && !/housing target/i.test(r.document)).map((r) => {
    const st = yearsIn(r.status), doc = yearsIn(r.document), line = yearsIn(r.line);
    const from = r.level === 'Statutory' || r.level === 'District' ? (doc[0] ?? st[0]) : (st[0] ?? doc[doc.length - 1] ?? line[0]);
    const to = /superseded|replaced|repealed/i.test(r.status) ? st[st.length - 1] : undefined;
    const fill: Fill = to !== undefined ? { bg: '#ffffff', outline: R.line, outlineW: 0.25, dash: '0.8 0.5' }
      : r.level === 'State' || r.level === 'Region' ? { bg: R.mid }
      : r.level === 'Contributions' ? { bg: '#ffffff', kind: 'dots', ink: R.deep, step: 0.7, w: 0.12, outline: R.line, outlineW: 0.12 }
      : r.level === 'Statutory' ? { bg: R.solid }
      : { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.55, w: 0.16, outline: R.line, outlineW: 0.12 };
    return from ? { name: shorten(r.document.replace(/\s*\(.*?\)\s*/g, ' ').trim(), 40), from, to, fill } : null;
  }).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const blocks: string[] = [];
  const y0 = Math.min(2010, ...spans.map((s) => s.from)) , y1 = Math.max(now + 6, 2030);
  if (spans.length) blocks.push(zBlock('The plans over the site · in force', zSpans(spans, Math.floor(y0 / 5) * 5, Math.ceil(y1 / 5) * 5, now + (new Date(b.generatedAt).getUTCMonth() / 12))));
  const list = f.rows.filter((r) => !r.manual).map((r) => ({ label: r.level, value: r.document, note: r.status }));
  blocks.push(zBlock('The documents, top down', zTable(list)));
  const legend: LegendEntry[] = [
    ...present.map((k) => ({ swatch: swatchOf(POLICY_FILL[k]), label: POLICY_STYLE[k].label })),
    ...(present.length ? [] : [{ swatch: '', label: 'No TOD area, town centre, State significant site or precinct on the page' }]),
    SITE_KEY(t),
  ];
  const sources = `Sources: the Department's planning-regions layer and plans-by-region pages; the Planning Portal's index of local strategic planning statements; the local plan, the DCP and the contributions from ePlanning and the property report; TOD, town-centre, State significant site and precinct maps from the Housing and Planning Systems SEPP layers and DPHI. The documents themselves are not read. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b0, f.region.plan?.name ?? '', f.lsps ? 'local strategic planning statement linked' : 'local strategic planning statement to find', b0.housingTarget ? `target ${fmtNum(b0.housingTarget.homes)} homes by ${b0.housingTarget.by}` : '');
  return { id: '05_strategic_context', title: 'Strategic context', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Housing policy and precincts', p, zFlow(blocks)), bleed: true, sources, accent: R.text, legend,
    narrative: brief([strategicSentences(b0, f)[0], b0.housingTarget ? `The City's housing target is ${fmtNum(b0.housingTarget.homes)} new homes by ${b0.housingTarget.by}.` : '', planning.policyAtSite.length ? `The site is inside ${planning.policyAtSite.map((q) => `the ${q.name} ${POLICY_WORD[q.kind]}`).join(' and ')}.` : 'The site is outside every mapped housing policy area and precinct.']) };
}

// ---- slide 03: planning overview ----------------------------------------------

function zoningPanel(b: SlidesBundle, proj: Proj, facts: PlanningFacts): PanelOut {
  const byCode = new Map<string, string[]>();
  const cands: { area: number; cx: number; cy: number; text: string }[] = [];
  for (const f of b.zoning.features) {
    const code = String(f.properties.SYM_CODE ?? '?');
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(ringsPath(rings, proj));
    for (const r of rings) {
      const s = clippedStats(r, proj, b.panel);
      if (s.area > 14) cands.push({ ...s, text: code });
    }
  }
  const labels = placeLabels(cands, 2.1);
  const fills = [...byCode.entries()].map(([code, ds]) =>
    `<g fill="${zoneFill(code)}" fill-opacity="0.85" stroke="#6a7572" stroke-width="0.08" fill-rule="evenodd">${ds.map((d) => `<path d="${d}"/>`).join('')}</g>`).join('');
  const svg = baseLayers(b.base, proj, b.panel, { lots: false }) + fills + baseLotsHairline(b, proj) + labels.join('') + overLayers(b.base, proj, b.panel) + panelFurniture(b.panel);
  const legend = facts.zonesInWindow.map((z) => ({ swatch: swatchFill(zoneFill(z.code)), label: `${z.code} ${z.name}`.trim() }));
  const epi = facts.zoneAtSite?.epi ? `${facts.zoneAtSite.epi}${facts.zoneAtSite.currency ? ` · currency ${facts.zoneAtSite.currency}` : ''}` : 'NSW ePlanning land zoning';
  return { title: 'Land zoning', note: epi, svg, legend };
}

function placeLabels(cands: { area: number; cx: number; cy: number; text: string; fill?: string }[], size: number, max = 60): string[] {
  const spacer = new LabelSpacer(PANEL_W, PANEL_H, max);
  const out: string[] = [];
  for (const c of cands.sort((a, b2) => b2.area - a.area)) {
    if (spacer.take(c.cx, c.cy, labelW(c.text, size), size * 1.25)) out.push(label(c.cx, c.cy, c.text, size, c.fill));
  }
  return out;
}

function baseLotsHairline(b: SlidesBundle, proj: Proj): string {
  if (!b.base.lots.features.length) return '';
  const d = b.base.lots.features.map((f) => ringsPath(geomRings(f.geometry), proj)).join('');
  return `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.12" opacity="0.75"/>`;
}

function hobPanel(b: SlidesBundle, proj: Proj, facts: PlanningFacts): PanelOut {
  const classify = heightClassifier(facts.heightsInWindow);
  const classes = new Map<string, HeightClass>();
  const byClass = new Map<string, string[]>();
  const cands: { area: number; cx: number; cy: number; text: string }[] = [];
  for (const f of b.hob.features) {
    const l = heightLabel(f.properties.MAX_B_H, f.properties.UNITS);
    if (!l) continue;
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    const c = classify(Number(f.properties.MAX_B_H), String(f.properties.UNITS ?? 'm'));
    classes.set(c.label, c);
    (byClass.get(c.label) ?? byClass.set(c.label, []).get(c.label)!).push(ringsPath(rings, proj));
    for (const r of rings) {
      const s = clippedStats(r, proj, b.panel);
      if (s.area > 14) cands.push({ ...s, text: l.replace(/ m$/, '') });
    }
  }
  const order = [...classes.values()].sort((a, b2) => a.order - b2.order).map((c) => c.label);
  const colour = new Map(order.map((l, i) => [l, hobRamp(i, order.length)]));
  const fills = order.map((l) =>
    `<g fill="${colour.get(l)}" fill-opacity="0.9" stroke="#6a7572" stroke-width="0.08" fill-rule="evenodd">${(byClass.get(l) ?? []).map((d) => `<path d="${d}"/>`).join('')}</g>`).join('');
  const labels = placeLabels(cands, 2);
  const svg = baseLayers(b.base, proj, b.panel, { lots: false }) + fills + baseLotsHairline(b, proj) + labels.join('') + overLayers(b.base, proj, b.panel) +
    (order.length ? '' : emptyNote(['No height of building map in this window'])) + panelFurniture(b.panel);
  const legend = order.map((l) => ({ swatch: swatchFill(colour.get(l)!), label: l }));
  const rl = facts.heightsInWindow.some((h) => /RL/i.test(h.units));
  const banded = facts.heightsInWindow.length > 10;
  return { title: 'Height of building', note: `${banded ? `${facts.heightsInWindow.length} distinct limits, banded · ` : ''}${rl ? 'RL limits are levels above datum' : 'height above ground'}`, svg, legend };
}

/** A note in the panel's top-left corner, boxed, where it covers nothing that matters. */
function emptyNote(lines: string[]): string {
  const w = Math.max(...lines.map((l) => l.length)) * 2.4 * 0.55 + 6;
  return `<g><rect x="3" y="3" width="${w.toFixed(1)}" height="${(lines.length * 3.6 + 2.4).toFixed(1)}" fill="#ffffff" fill-opacity="0.92" stroke="#c9c0b0" stroke-width="0.2"/>` +
    lines.map((l, i) => `<text x="6" y="${(6.6 + i * 3.6).toFixed(1)}" font-size="2.4" fill="#6a7572">${esc(l)}</text>`).join('') + '</g>';
}

function heritagePanel(b: SlidesBundle, proj: Proj, facts: PlanningFacts): PanelOut {
  const parts: string[] = [];
  const legendMap = new Map<string, LegendEntry>();
  const centre = mercatorToLonLat(b.panel.center);
  const k = 1 / Math.cos((centre.lat * Math.PI) / 180);
  let hi = 0;
  const cands: { area: number; cx: number; cy: number; text: string; fill?: string }[] = [];
  for (const f of b.heritage.features) {
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    const st = heritageStyle(f.properties.LAY_CLASS);
    const d = ringsPath(rings, proj);
    if (st.hatch) {
      parts.push(hatchPath(d, `hh${hi++}`, st.fill, bboxOf(rings, proj), 1.4));
      legendMap.set(st.label, { swatch: swatchHatch(st.fill), label: st.label });
    } else {
      parts.push(`<path d="${d}" fill="${st.fill}" fill-opacity="0.9" stroke="#8a6a3c" stroke-width="0.15" fill-rule="evenodd"/>`);
      legendMap.set(st.label, { swatch: swatchFill(st.fill, '#8a6a3c'), label: st.label });
      const m = mainRing(f, proj);
      if (m && f.properties.H_ID) {
        const [clon, clat] = centroidLL(m.ring);
        const d = distanceM(b.panel.center, clon, clat, k);
        if (d < 320) cands.push({ area: 1000 - d, cx: m.cx, cy: m.cy, text: String(f.properties.H_ID), fill: '#5a4426' });
      }
    }
  }
  if (b.shr.features.length) {
    const d = b.shr.features.map((f) => ringsPath(geomRings(f.geometry), proj)).join('');
    parts.push(`<path d="${d}" fill="none" stroke="#7c2f22" stroke-width="0.55"/>`);
    legendMap.set('shr', { swatch: swatchLine('#7c2f22', 0.7), label: 'State Heritage Register curtilage' });
  }
  const labels = placeLabels(cands, 1.8, 30);
  const empty = parts.length ? '' : emptyNote(['No heritage item or conservation area in this window']);
  const svg = baseLayers(b.base, proj, b.panel) + parts.join('') + labels.join('') + overLayers(b.base, proj, b.panel) + empty + panelFurniture(b.panel);
  const n = facts.heritageNearby;
  return { title: 'Heritage', note: `${n.items} items · ${n.conservationAreas} conservation areas · ${n.shr} SHR in window`, svg, legend: [...legendMap.values()] };
}

function policyPanel(b: SlidesBundle, proj: Proj, facts: PlanningFacts): PanelOut {
  const order: PolicyKind[] = ['townCentre', 'tod', 'todAccelerated', 'todDeferred', 'ssdSite', 'precinct'];
  const parts: string[] = [];
  const legend: LegendEntry[] = [];
  const cands: { area: number; cx: number; cy: number; text: string; fill?: string }[] = [];
  for (const kind of order) {
    const areas = b.policy.filter((p) => p.kind === kind);
    if (!areas.length) continue;
    const st = POLICY_STYLE[kind];
    const d = areas.map((a) => ringsPath(a.rings, proj)).join('');
    parts.push(`<path d="${d}" fill="${st.fill}" fill-opacity="0.45" stroke="${st.stroke}" stroke-width="${st.fill === 'none' ? 0.55 : 0.2}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} fill-rule="evenodd"/>`);
    legend.push({ swatch: st.fill === 'none' ? swatchLine(st.stroke, 0.6, st.dash) : swatchFill(st.fill, st.stroke), label: st.label });
    // One label per distinct name, on its largest polygon.
    const byName = new Map<string, { area: number; cx: number; cy: number }>();
    for (const a of areas) for (const r of a.rings) {
      const s = clippedStats(r, proj, b.panel);
      const cur = byName.get(a.name);
      if (s.area > 0 && (!cur || s.area > cur.area)) byName.set(a.name, s);
    }
    for (const [name, s] of byName)
      cands.push({ ...s, text: name.length > 26 ? `${name.slice(0, 24)}…` : name, fill: st.stroke });
  }
  const labels = placeLabels(cands, 2, 20);
  const empty = parts.length ? '' : emptyNote(['No TOD area, town centre, State significant development site', 'or planning precinct is mapped in this window']);
  const svg = baseLayers(b.base, proj, b.panel) + parts.join('') + labels.join('') + overLayers(b.base, proj, b.panel) + empty + panelFurniture(b.panel);
  const at = facts.policyAtSite.length ? `site inside: ${facts.policyAtSite.map((p) => p.name).join(', ')}` : 'site outside every mapped policy area';
  return { title: 'Housing policy and precincts', note: at, svg, legend };
}

export function planningOverviewSlide(b: SlidesBundle, facts: PlanningFacts): Slide {
  const hp: Panel = { ...b.panel, wMm: HALF_W, hMm: HALF_H };
  const hb: SlidesBundle = { ...b, panel: hp };
  const proj = panelProjector(hp);
  const panels = [zoningPanel(hb, proj, facts), hobPanel(hb, proj, facts), heritagePanel(hb, proj, facts), policyPanel(hb, proj, facts)];
  const figureHtml = panels.map((p, i) => panelBlock(p, i % 2, Math.floor(i / 2), `p${i}`)).join('\n');
  const sentences = sentenceList(planningSentences(b, facts));
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: how the planning framework reads for this site, where it is moving (rezonings, precinct plans, policy reforms) and what that implies for the brief.') +
    `<div class="fine">Four maps at 1:${fmtNum(b.panel.scale)}, north up, ${fmtNum(Math.round((HALF_W / 1000) * b.panel.scale))} × ${fmtNum(Math.round((HALF_H / 1000) * b.panel.scale))} m each. Zoning, height and heritage from NSW ePlanning (EPI_Primary_Planning_Layers); the State Heritage Register from Heritage NSW; TOD, town-centre and SSD maps from the Housing and Planning Systems SEPP layers; precincts from DPHI. Retrieved ${b.generatedAt.slice(0, 10)}. Mapped controls, not a planning certificate.</div>`;
  const sub = [b.siteAddress, b.context.lga?.name ? titleCase(b.context.lga.name) : '', b.context.district ? `${b.context.district} District` : ''].filter(Boolean).join(' · ');
  return { id: '03_planning_overview', title: 'Planning overview', subtitle: sub, textHtml, figureHtml };
}

/** The zones of the window in groups, each group one pattern of the red family; the code is written on the map. */
const ZONE_GROUPS: { key: string; label: string; test: (code: string, name: string) => boolean; fill: Fill }[] = [
  { key: 'res', label: 'Residential zones', test: (c, n) => /residential/i.test(n) || /^R\d/.test(c), fill: { bg: INK.red.light, outline: INK.red.mid, outlineW: 0.12 } },
  { key: 'centre', label: 'Centres, mixed use, business and commercial zones', test: (c, n) => /mixed|business|commercial|centre|enterprise|productivity/i.test(n) || /^(MU|B\d|E[123]$)/.test(c), fill: { bg: '#ffffff', kind: 'vlines', ink: INK.red.line, step: 0.75, w: 0.16, outline: INK.red.mid, outlineW: 0.12 } },
  { key: 'ind', label: 'Industrial and employment zones', test: (c, n) => /industr|employment/i.test(n) || /^(IN\d|E[45]$)/.test(c), fill: { bg: '#ffffff', kind: 'hlines', ink: INK.red.line, step: 0.75, w: 0.16, outline: INK.red.mid, outlineW: 0.12 } },
  { key: 'sp', label: 'Special purposes, infrastructure and railways', test: (c, n) => /special|infrastructure|railway/i.test(n) || /^(SP\d|RLWY)/.test(c), fill: { bg: '#ffffff', kind: 'dots', ink: INK.red.deep, step: 0.9, w: 0.12, outline: INK.red.mid, outlineW: 0.12 } },
  { key: 'rec', label: 'Recreation and conservation zones', test: (c, n) => /recreation|conservation|environmental|national park|nature/i.test(n) || /^(RE\d|C\d)/.test(c), fill: { bg: '#ffffff', kind: 'waves', ink: INK.red.mid, step: 1.1, w: 0.16, outline: INK.red.mid, outlineW: 0.12 } },
  { key: 'other', label: 'Waterways, unzoned and other zones', test: () => true, fill: { bg: '#ffffff', outline: INK.red.mid, outlineW: 0.2 } },
];
const zoneGroup = (code: string, name: string) => ZONE_GROUPS.find((g) => g.test(code, name))!;

/** Planning overview on the template: zones in the red family's patterns, heritage drawn over them, the heights charted. */
export function planningAtlas(b0: SlidesBundle): Slide {
  const p = b0.bleedPanel;
  const b: SlidesBundle = { ...b0, panel: p, daPanel: p };
  const t = tpl();
  const R = INK.red;
  const f = planningFacts(b);
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p, { lots: false }))];
  const byGroup = new Map<string, string[]>();
  const cands: { area: number; cx: number; cy: number; text: string }[] = [];
  for (const ft of b.zoning.features) {
    const code = String(ft.properties.SYM_CODE ?? '?'), name = String(ft.properties.LAY_CLASS ?? '');
    const rings = geomRings(ft.geometry);
    if (!rings.length) continue;
    const g = zoneGroup(code, name);
    (byGroup.get(g.key) ?? byGroup.set(g.key, []).get(g.key)!).push(ringsPath(rings, proj));
    for (const r of rings) { const st = clippedStats(r, proj, p); if (st.area > 60) cands.push({ ...st, text: code }); }
  }
  for (const g of ZONE_GROUPS) { const ds = byGroup.get(g.key); if (ds) parts.push(fillShape(ds.join(''), box, g.fill)); }
  if (b.base.lots.features.length) parts.push(`<path d="${b.base.lots.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.1" opacity="0.8"/>`);
  // heritage over the zones: conservation areas dashed, items outlined, the State register's curtilages heavy
  const cas = b.heritage.features.filter((ft) => /Conservation Area/i.test(String(ft.properties.LAY_CLASS ?? '')));
  const items = b.heritage.features.filter((ft) => !/Conservation Area/i.test(String(ft.properties.LAY_CLASS ?? '')));
  if (items.length) parts.push(`<path d="${items.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="#ffffff" fill-opacity="0.55" stroke="${R.deep}" stroke-width="0.22" fill-rule="evenodd"/>`);
  if (cas.length) parts.push(`<path d="${cas.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="${R.deep}" stroke-width="0.45" stroke-dasharray="1.4 0.7" fill-rule="evenodd"/>`);
  if (b.shr.features.length) parts.push(`<path d="${b.shr.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="${R.deep}" stroke-width="0.8" fill-rule="evenodd"/>`);
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 120);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const labels: string[] = [];
  for (const c of cands.sort((x, y) => y.area - x.area)) if (spacer.take(c.cx, c.cy, c.text.length * 1.6 + 1, 2.8)) labels.push(m6(c.cx, c.cy, c.text));
  parts.push(...labels, siteMark(b.base, proj, 'both'), siteEdge(b, proj), panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('plan03', p, parts.join('\n'));

  // ---- the key
  const present = ZONE_GROUPS.filter((g) => byGroup.has(g.key));
  const legend: LegendEntry[] = [
    ...present.map((g) => ({ swatch: swatchOf(g.fill), label: g.label })),
    ...(items.length ? [{ swatch: `<rect x="0.2" y="0.6" width="4.6" height="2.4" fill="#ffffff" stroke="${R.deep}" stroke-width="0.22"/>`, label: 'Heritage item, local plan' }] : []),
    ...(cas.length ? [{ swatch: `<rect x="0.3" y="0.6" width="4.4" height="2.4" fill="none" stroke="${R.deep}" stroke-width="0.4" stroke-dasharray="1.4 0.7"/>`, label: 'Heritage conservation area' }] : []),
    ...(b.shr.features.length ? [{ swatch: `<rect x="0.4" y="0.7" width="4.2" height="2.2" fill="none" stroke="${R.deep}" stroke-width="0.7"/>`, label: 'State Heritage Register curtilage' }] : []),
    SITE_KEY(t),
  ];
  const limit = keyTop(legend.length) - 6;

  // ---- the text page
  const z = f.zoneAtSite;
  const hs = f.heritageAtSite;
  const figs = zFigures([
    ['zone at the site', z ? `${z.code} ${z.name}` : 'not mapped'],
    ['height of building', f.hobAtSite ? f.hobAtSite.label : 'not mapped'],
    ['floor space ratio', f.fsrAtSite ? `${f.fsrAtSite.toFixed(2)}:1` : 'not mapped'],
  ], [
    ['heritage at the site', hs.length ? shorten(hs.map((h) => `${h.name}${h.id ? ` (${h.id})` : ''}`).join(' · '), 44) : 'none'],
    ['heritage items · conservation areas on the page', `${fmtNum(f.heritageNearby.items)} · ${fmtNum(f.heritageNearby.conservationAreas)}`],
    ['nearest State Heritage Register item', f.heritageNearby.nearestShr ? shorten(`${f.heritageNearby.nearestShr.name} · ${fmtNum(f.heritageNearby.nearestShr.distanceM)} m`, 44) : 'none on the page'],
  ], 9.6);
  let y = 44 + blockH(6.3 + 3 * 9.6);
  const blocks = [zBlock('The controls', figs, 'Heritage')];
  const zoneRows = f.zonesInWindow.filter((zz) => zz.areaShare >= 0.01).slice(0, 8).map((zz) => ({ name: shorten(`${zz.code}  ${zz.name}`, 42), value: zz.areaShare * 100, label: fmtPct(zz.areaShare * 100), fill: zz.code === z?.code ? { bg: R.solid } as Fill : zoneGroup(zz.code, zz.name).fill }));
  if (zoneRows.length) {
    const ax = niceAxis(Math.max(...zoneRows.map((r) => r.value)));
    blocks.push(zBlock('Zones on the page · share of the land, %', zBars(zoneRows, ax.max, ax.step)));
    y += blockH(barsH(zoneRows.length));
  }
  // the height limits by the share of the page they cover; the site's own solid
  const hobShare = new Map<string, { label: string; value: number; key: number; share: number }>();
  for (const ft of b.hob.features) {
    const l = heightLabel(ft.properties.MAX_B_H, ft.properties.UNITS);
    if (!l) continue;
    const share = pageShare(geomRings(ft.geometry), proj, p);
    const e = hobShare.get(l) ?? { label: l, value: Number(ft.properties.MAX_B_H), key: heightKey(ft.properties.MAX_B_H, ft.properties.UNITS), share: 0 };
    e.share += share; hobShare.set(l, e);
  }
  const room = Math.max(0, Math.floor((limit - y - blockH(10)) / 3.95));
  const hobRows = [...hobShare.values()].filter((h) => h.share >= 0.005).sort((x, y2) => y2.share - x.share).slice(0, Math.min(9, room)).sort((x, y2) => x.key - y2.key)
    .map((h) => ({ name: h.label === f.hobAtSite?.label ? `${h.label} · the site` : h.label, value: h.share * 100, label: fmtPct(h.share * 100), fill: h.label === f.hobAtSite?.label ? { bg: R.solid } as Fill : { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.55, w: 0.16, outline: R.line, outlineW: 0.12 } as Fill }));
  if (hobRows.length) {
    const ax = niceAxis(Math.max(...hobRows.map((r) => r.value)));
    blocks.push(zBlock('Height limits on the page · share of the land, %', zBars(hobRows, ax.max, ax.step)));
  }
  const sources = `Sources: zoning, height of building and heritage from NSW ePlanning (EPI primary planning layers); the State Heritage Register from Heritage NSW; roads, rail, water and cadastre from NSW Spatial Services. Mapped controls, not a planning certificate. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b0, z ? `${z.code} ${z.name}` : '', f.hobAtSite ? `HOB ${f.hobAtSite.label}` : '', b0.context.district ? `${b0.context.district} District` : '');
  return { id: '03_planning_overview', title: 'Planning overview', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Zoning and heritage', p, zFlow(blocks)), bleed: true, sources, accent: R.text, legend,
    narrative: brief([z ? `The site is zoned ${z.code} ${z.name}, with a height of building of ${f.hobAtSite?.label ?? 'no mapped limit'} and a floor space ratio of ${f.fsrAtSite ? `${f.fsrAtSite.toFixed(2)}:1` : 'none mapped'}.` : '', hs.length ? `It is ${listWords(hs.map((h) => h.kind === 'conservationArea' ? `in the ${h.name} conservation area` : h.kind === 'shr' ? `on the State Heritage Register as ${h.name}` : `a listed heritage item, ${h.name}`))}.` : 'It is not a heritage item and not in a conservation area.', f.zonesInWindow[0] ? `${f.zonesInWindow[0].code} ${f.zonesInWindow[0].name} covers ${fmtPct(f.zonesInWindow[0].areaShare * 100)} of the land on the map.` : '']) };
}

// ---- slide 04: planning controls at the site ---------------------------------

interface Row { label: string; value: string[]; source: string; link?: string }

export function controlRows(b: SlidesBundle, f: PlanningFacts): Row[] {
  const rows: Row[] = [];
  const ctx = b.context;
  const zoneSrc = f.zoneAtSite ? `NSW ePlanning · ${f.zoneAtSite.epi}${f.zoneAtSite.currency ? ` · currency ${f.zoneAtSite.currency}` : ''}` : 'NSW ePlanning';
  rows.push({ label: 'Site', value: [b.siteAddress, b.lotDescription, b.siteAreaSqm ? `${fmtNum(b.siteAreaSqm, 1)} m² (cadastral boundary — confirm against survey)` : ''].filter(Boolean), source: 'NSW Spatial Services cadastre' });
  rows.push({ label: 'Administrative context', value: [
    ctx.lga ? `${titleCase(ctx.lga.name)} LGA${ctx.lga.council ? ` — ${titleCase(ctx.lga.council)}` : ''}` : '',
    ctx.suburb ? `${titleCase(ctx.suburb.name)}${ctx.suburb.postcode ? ` ${ctx.suburb.postcode}` : ''}` : '',
    ctx.district ? `${ctx.district} District${f.regionalPlan ? ` · ${f.regionalPlan} Region Plan` : ''}` : (f.regionalPlan ? `${f.regionalPlan} Region Plan` : ''),
    ctx.lalc ? `${ctx.lalc.local} Local Aboriginal Land Council` : '',
  ].filter(Boolean), source: 'NSW Administrative Boundaries · DPHI district boundary' });
  rows.push({ label: 'Instrument', value: [
    f.zoneAtSite?.epi || b.controls.epiName || 'No local environmental plan mapped',
    [f.zoneAtSite?.amendment, f.zoneAtSite?.commenced ? `commenced ${f.zoneAtSite.commenced}` : '', f.zoneAtSite?.currency ? `map currency ${f.zoneAtSite.currency}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean), source: zoneSrc, link: f.legislationUrl });
  rows.push({ label: 'Zone', value: [f.zoneAtSite ? `${f.zoneAtSite.code} ${f.zoneAtSite.name}`.trim() : 'Not mapped'], source: zoneSrc, link: f.legislationUrl });
  rows.push({ label: 'Height of building', value: [
    f.hobAtSite ? f.hobAtSite.label : 'No height of building control mapped',
    f.hobAtSite?.rl ? 'A reduced level: the permissible height above ground is this RL less the ground level of the site.' : '',
  ].filter(Boolean), source: 'NSW ePlanning · Height of Buildings Map' });
  rows.push({ label: 'Floor space ratio', value: [f.fsrAtSite ? `${f.fsrAtSite.toFixed(2)}:1${b.siteAreaSqm ? ` → ${fmtNum(f.fsrAtSite * b.siteAreaSqm)} m² GFA on the cadastral area` : ''}` : 'No floor space ratio control mapped'], source: 'NSW ePlanning · Floor Space Ratio Map' });
  rows.push({ label: 'Minimum lot size', value: [f.lotSizeAtSite ? `${fmtNum(f.lotSizeAtSite)} m²` : 'No minimum lot size mapped'], source: 'NSW ePlanning · Lot Size Map' });
  const her = f.heritageAtSite.length
    ? f.heritageAtSite.map((h) => `${h.kind === 'conservationArea' ? 'Conservation area: ' : h.kind === 'shr' ? 'State Heritage Register: ' : 'Heritage item: '}${h.name}${h.id ? ` (${h.id}${h.significance ? `, ${h.significance}` : ''})` : ''}`)
    : ['Not a heritage item; not in a heritage conservation area'];
  const n = f.heritageNearby;
  her.push(`${n.items} items and ${n.conservationAreas} conservation areas in the map window` + (n.nearestShr ? `; nearest SHR item ${n.nearestShr.name} (SHR ${n.nearestShr.listingNo}), ~${fmtNum(n.nearestShr.distanceM)} m` : ''));
  rows.push({ label: 'Heritage', value: her, source: 'NSW ePlanning · Heritage Map · Heritage NSW State Heritage Register' });
  rows.push({ label: 'Local provisions', value: f.localProvisions.length ? f.localProvisions.slice(0, 8) : ['None mapped at the site'], source: 'Planning Portal property API · LEP local-provision maps' });
  const pol = f.policyAtSite.length
    ? f.policyAtSite.map((p) => `Inside the ${p.name} ${POLICY_WORD[p.kind]} (${p.source})`)
    : ['Not in a Transport Oriented Development area, accelerated or deferred precinct, mapped town centre or State significant development site'];
  if (!f.policyAtSite.length && f.policyInWindow.length)
    pol.push(`In the map window: ${f.policyInWindow.slice(0, 5).map((p) => `${p.name} (${POLICY_WORD[p.kind]})`).join('; ')}`);
  rows.push({ label: 'Housing SEPP and precincts', value: pol, source: 'SEPP (Housing) 2021 · SEPP (Planning Systems) 2021 · DPHI precincts' });
  const seppValue = [
    ...f.seppMaps.slice(0, 9),
    f.seppMaps.length > 9 ? `+ ${f.seppMaps.length - 9} more` : '',
    f.seppLandApplication ? `Land application of ${f.seppLandApplication} further statewide SEPP maps` : '',
  ].filter(Boolean);
  rows.push({ label: 'Other SEPP maps at the site', value: seppValue.length ? seppValue : ['Property API returned no SEPP maps'], source: 'Planning Portal property API' });
  rows.push({ label: 'Development control plan', value: ctx.dcps.length
    ? ctx.dcps.slice(0, 4).map((d, i) => `${d.name}${i === 0 && ctx.dcps.length > 1 ? ' (general)' : ''}`).concat(ctx.dcps.length > 4 ? [`+ ${ctx.dcps.length - 4} more themed plans`] : [])
    : ['No DCP link published for this council on the Planning Portal'], source: 'Planning Portal · DCP by LGA', link: ctx.dcp?.url });
  if (b.cos) {
    const c = b.cos;
    rows.push({ label: 'Council DCP mapping', value: [
      c.storeysAtSite ? `Building height in storeys at the site: ${c.storeysAtSite}` : 'Building height in storeys: not mapped at the site (LEP height applies)',
      c.frontageHeightsNearSite.length ? `Street frontage height along the site's streets: ${c.frontageHeightsNearSite.join(', ')} storeys` : '',
      `Active street frontage on the frontage: ${c.activeFrontageNearSite ? 'yes' : 'not mapped'}`,
      c.setbacksNearSite.length ? `Setbacks: ${c.setbacksNearSite.join('; ')}` : '',
      c.dcpNames.length ? `Maps: ${c.dcpNames.join('; ')}` : '',
    ].filter(Boolean), source: c.source });
  }
  const contribLines = [...new Set(ctx.contributions.map((c) => `${c.kind}: ${c.name}${c.detail && !/^https?:/.test(c.detail) ? ` — ${c.detail}` : ''}`))];
  rows.push({ label: 'Contributions', value: contribLines.length
    ? contribLines.slice(0, 6)
    : ['No Special Infrastructure Contribution or Housing and Productivity Contribution area mapped at the site'], source: 'Planning Portal contributions layers' });
  if (f.canopy?.y2022 || f.canopy?.y2019)
    rows.push({ label: 'Tree canopy', value: [[f.canopy.y2022 ? `${f.canopy.y2022.toFixed(1)} % (2022)` : '', f.canopy.y2019 ? `${f.canopy.y2019.toFixed(1)} % (2019)` : ''].filter(Boolean).join(' · ')], source: 'Greater Sydney Tree Canopy Cover · property' });
  if (b.housingTarget)
    rows.push({ label: 'Council housing target', value: [`${fmtNum(b.housingTarget.homes)} new homes completed by ${b.housingTarget.by}${ctx.lga ? ` (${titleCase(ctx.lga.council || ctx.lga.name)})` : ''}`], source: 'planning.nsw.gov.au housing targets', link: b.housingTarget.url });
  return rows;
}

export function planningControlsSlide(b: SlidesBundle, facts: PlanningFacts): Slide {
  const rows = controlRows(b, facts);
  const table = `<table class="controls"><thead><tr><th style="width:46mm">Control</th><th>At the site</th><th style="width:78mm">Source · currency</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${r.value.map((v) => `<div>${esc(v)}</div>`).join('')}</td><td class="src">${esc(r.source)}${r.link ? `<div class="lnk"><a href="${esc(r.link)}">${esc(r.link.replace(/^https?:\/\//, '').slice(0, 70))}${r.link.length > 78 ? '…' : ''}</a></div>` : ''}</td></tr>`).join('') +
    `</tbody></table>`;
  const s = planningSentences(b, facts);
  const textHtml = [s.controls, s.heights, s.heritage, s.policy, s.councilDcp].filter((x): x is string => Boolean(x)).map(para).join('') +
    placeholder('Narrative — for the author: what the controls allow in envelope and use, which clauses bite (height in RL, design excellence, key-site provisions, affordable housing), and what a permissibility check of the land use table says. The land use table itself is behind the legislation link: it cannot be fetched by a machine.') +
    `<div class="fine">Every row is the mapped control at the geocoded point, read from the NSW ePlanning layers and the Planning Portal property API on ${b.generatedAt.slice(0, 10)}. Mapped controls are not a s10.7 planning certificate.</div>`;
  const sub = [b.siteAddress, facts.zoneAtSite ? `${facts.zoneAtSite.code} ${facts.zoneAtSite.name}` : '', facts.hobAtSite ? `HOB ${facts.hobAtSite.label}` : ''].filter(Boolean).join(' · ');
  return { id: '04_planning_controls', title: 'Planning controls at the site', subtitle: sub, textHtml, figureHtml: `<div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">${table}</div>` };
}

/** Planning controls on the template: what the controls allow, charted, beside the table of every control at the site. */
export function controlsAtlas(b: SlidesBundle, facts: PlanningFacts): Slide {
  const t = tpl();
  const R = INK.red;
  const rows = controlRows(b, facts);
  // the right page: the controls, one row each, the source in grey beside them
  const short = (u: string) => u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\?.*$/, '');
  const table = rows.map((r) => {
    const vals = r.value.length > 6 ? [...r.value.slice(0, 5), `+ ${r.value.length - 5} more, listed in the deck's JSON`] : r.value;
    return `<div class="zr zr3"><div class="l">${esc(r.label)}</div><div class="v">${vals.map((v) => `<div>${esc(v)}</div>`).join('')}</div><div class="s">${esc(r.source)}${r.link ? `<br>${esc(shorten(short(r.link), 64))}` : ''}</div></div>`;
  }).join('');
  const right = `<div class="abs" style="left:${FOLD + 12}mm;top:11.6mm;width:186mm">${`<div class="zh"><span>Control</span><span style="left:46mm">At the site</span><span style="left:134mm">Source · currency</span></div>`}${table}</div>`;

  // ---- the left page: what the controls give, in floor area and in height
  const area = b.siteAreaSqm;
  const gfa = facts.fsrAtSite && area ? facts.fsrAtSite * area : undefined;
  const bf = builtFormFacts({ ...b, daPanel: b.bleedPanel }, facts);
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const k = mercatorScaleFactor(mercatorToLonLat(b.panel.center).lat);
  const ringM2 = (ring: number[][]) => { let s2 = 0; const pts = ring.map(([lon, lat]) => lonLatToMercator({ lon, lat })); for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; s2 += a.x * c.y - c.x * a.y; } return Math.abs(s2 / 2) / (k * k); };
  const onSite = b.buildings.buildings.filter((bd) => siteRings.some((r) => pointInRing(bd.centroid[0], bd.centroid[1], r)));
  const footprint = onSite.reduce((a, bd) => a + ringM2(bd.rings[0] ?? []), 0);
  const hobStoreys = facts.hobAtSite && !facts.hobAtSite.rl ? Math.max(1, Math.floor(facts.hobAtSite.value / METRES_PER_STOREY)) : bf.envelope?.storeys;
  const figs = zFigures([
    ['site area, cadastre', area ? `${fmtNum(area)} m²` : '—'],
    ['zone', facts.zoneAtSite ? `${facts.zoneAtSite.code} ${facts.zoneAtSite.name}` : 'not mapped'],
    ['minimum lot size', facts.lotSizeAtSite ? `${fmtNum(facts.lotSizeAtSite)} m²` : 'not mapped'],
  ], [
    ['floor space ratio', facts.fsrAtSite ? `${facts.fsrAtSite.toFixed(2)}:1` : 'not mapped'],
    ['gross floor area it allows', gfa ? `${fmtNum(gfa)} m²` : '—'],
    ['height of building', facts.hobAtSite ? `${facts.hobAtSite.label}${hobStoreys ? ` · about ${hobStoreys} storeys` : ''}` : 'not mapped'],
  ], 9.6);
  const blocks = [zBlock('The site', figs, 'What the controls allow')];
  const areaRows = [
    ...(area ? [{ name: 'Site area, cadastre', value: area, label: `${fmtNum(area)} m²`, fill: { bg: '#ffffff', outline: '#000000', outlineW: 0.18 } as Fill }] : []),
    ...(footprint > 1 ? [{ name: 'Existing footprint, Overture', value: footprint, label: `${fmtNum(footprint)} m² · ${fmtPct(pct(footprint, area || footprint))}`, fill: { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.55, w: 0.16, outline: R.line, outlineW: 0.12 } as Fill }] : []),
    ...(gfa ? [{ name: `Floor area at ${facts.fsrAtSite!.toFixed(2)}:1`, value: gfa, label: `${fmtNum(gfa)} m²`, fill: { bg: R.mid } as Fill }] : []),
  ];
  if (areaRows.length) { const ax = niceAxis(Math.max(...areaRows.map((r) => r.value))); blocks.push(zBlock('Floor area · m²', zBars(areaRows, ax.max, ax.step))); }
  const stRows = [
    ...(hobStoreys ? [{ name: `LEP height ${facts.hobAtSite?.label ?? ''}`, value: hobStoreys, label: `${hobStoreys} st`, fill: { bg: R.mid } as Fill }] : []),
    ...(b.cos?.storeysAtSite ? [{ name: 'Council DCP, height in storeys', value: Number(b.cos.storeysAtSite), label: `${b.cos.storeysAtSite} st`, fill: { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.55, w: 0.16, outline: R.line, outlineW: 0.12 } as Fill }] : []),
    ...(bf.near.medianStoreys ? [{ name: `Median within ${bf.near.radiusM} m`, value: bf.near.medianStoreys, label: `${bf.near.medianStoreys} st`, fill: { bg: '#ffffff', kind: 'dots', ink: R.deep, step: 0.8, w: 0.12, outline: R.line, outlineW: 0.12 } as Fill }] : []),
  ];
  if (stRows.length) { const ax = niceAxis(Math.max(...stRows.map((r) => r.value))); blocks.push(zBlock('Height · storeys', zBars(stRows, ax.max, ax.step))); }
  const legend: LegendEntry[] = [
    { swatch: swatchOf({ bg: R.mid }), label: 'What the local plan allows' },
    { swatch: swatchOf({ bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.55, w: 0.16, outline: R.line, outlineW: 0.12 }), label: 'What stands or what the DCP adds' },
    { swatch: swatchOf({ bg: '#ffffff', kind: 'dots', ink: R.deep, step: 0.8, w: 0.12, outline: R.line, outlineW: 0.12 }), label: 'The neighbourhood, slide 08' },
  ];
  void t;
  const sources = `Every row is the mapped control at the geocoded point, read from the NSW ePlanning layers and the Planning Portal property API; floor area on the cadastral area, storeys at ${METRES_PER_STOREY} m. Mapped controls are not a s10.7 planning certificate. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, facts.zoneAtSite ? `${facts.zoneAtSite.code} ${facts.zoneAtSite.name}` : '', facts.hobAtSite ? `HOB ${facts.hobAtSite.label}` : '', facts.fsrAtSite ? `FSR ${facts.fsrAtSite.toFixed(2)}:1` : '');
  void legend;
  return { id: '04_planning_controls', title: 'Planning controls', subtitle: sub, textHtml: '', figureHtml: zFlow(blocks) + right, full: true, sources, accent: R.text,
    narrative: brief([gfa ? `At ${facts.fsrAtSite!.toFixed(2)}:1 the floor space ratio gives ${fmtNum(gfa)} m² of floor area on the ${fmtNum(area!)} m² site.` : '', facts.hobAtSite ? `The ${facts.hobAtSite.label} height of building holds about ${hobStoreys} storeys${b.cos?.storeysAtSite ? `, as the council's DCP maps (${b.cos.storeysAtSite} storeys)` : ''}${bf.near.medianStoreys ? `, against a median of ${bf.near.medianStoreys} within ${bf.near.radiusM} m` : ''}.` : '', facts.heritageAtSite.length ? 'The heritage listing and the conservation area bring their own controls and a heritage impact statement.' : '']) };
}

// ---- slide 07: development activity ---------------------------------------------

// Identity colours for the dots: the first three slots of the validated
// categorical palette (all pairs clear the colour-vision floors). Withdrawn
// applications are hollow rings, so their state is a shape, not a fourth hue.
const STATUS_STYLE: Record<DaStatusClass, { fill: string; stroke: string; hollow?: boolean; label: string }> = {
  determined: { fill: '#2f7d6d', stroke: '#2f7d6d', label: 'Determined (the feed does not say approved or refused)' },
  active:     { fill: '#c96f3b', stroke: '#c96f3b', label: 'Under assessment, on exhibition or awaiting information' },
  appeal:     { fill: '#2c4c9c', stroke: '#2c4c9c', label: 'Before the Land and Environment Court' },
  withdrawn:  { fill: '#ffffff', stroke: '#8a918c', hollow: true, label: 'Withdrawn, rejected or cancelled' },
};
const STATUS_ORDER: DaStatusClass[] = ['determined', 'active', 'appeal', 'withdrawn'];

export interface DaSite {
  n: number;
  key: string;
  address: string;
  primary: DaRecord;
  records: DaRecord[];
  modifications: number;
  cost?: number;
  dwellings?: number;
  storeys?: number;
  /** How far over the thresholds the site is: $5 M, ten dwellings or four storeys each count as 1. */
  score: number;
  statusClass: DaStatusClass;
  statusText: string;
  lon: number;
  lat: number;
}

const scaleScore = (cost?: number, dwellings?: number, storeys?: number) =>
  Math.max((cost ?? 0) / 5e6, (dwellings ?? 0) / 10, (storeys ?? 0) / 4);

/**
 * A DA and its modifications are one site, and so are two spellings of one
 * lot; the latest DA speaks for it. Sites come back largest first and are
 * numbered in that order, so the table's top rows are the precedents.
 */
export function groupSites(records: DaRecord[]): DaSite[] {
  const groups: { key: string; parsed: SiteAddress | null; rs: DaRecord[] }[] = [];
  const byKey = new Map<string, number>();
  for (const r of records) {
    if (!isSignificant(r) || r.lon === undefined || r.lat === undefined) continue;
    const k = siteKey(r.address) || r.pan;
    let i = byKey.get(k);
    if (i === undefined) { i = groups.length; byKey.set(k, i); groups.push({ key: k, parsed: parseSiteAddress(r.address), rs: [] }); }
    groups[i].rs.push(r);
  }
  // Unite the groups that name one lot: overlapping street numbers on the
  // same street, or one geocode shared by spellings that agree on the street.
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  const kin = (a: SiteAddress | null, b: SiteAddress | null) => !a || !b || a.street.startsWith(b.street) || b.street.startsWith(a.street);
  const byCoord = new Map<string, number>();
  groups.forEach((g, i) => {
    for (const r of g.rs) {
      const c = `${r.lon!.toFixed(5)},${r.lat!.toFixed(5)}`;
      const j = byCoord.get(c);
      if (j === undefined) byCoord.set(c, i);
      else if (kin(g.parsed, groups[j].parsed)) union(i, j);
    }
  });
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i].parsed, b2 = groups[j].parsed;
      if (a && b2 && sameLot(a, b2)) union(i, j);
    }
  const merged = new Map<number, DaRecord[]>();
  groups.forEach((g, i) => { const root = find(i); (merged.get(root) ?? merged.set(root, []).get(root)!).push(...g.rs); });

  const sites: DaSite[] = [];
  for (const [root, rs] of merged) {
    const byDate = [...rs].sort((a, b2) => (b2.lodged ?? '').localeCompare(a.lodged ?? ''));
    const das = byDate.filter((r) => /^Development Application/i.test(r.type));
    const primary = (das.length ? das : byDate)[0];
    const max = (f: (r: DaRecord) => number | undefined) => rs.reduce<number | undefined>((m, r) => { const v = f(r); return v && (!m || v > m) ? v : m; }, undefined);
    const mods = rs.filter((r) => /Modification/i.test(r.type)).length;
    const liveMod = byDate.find((r) => /Modification/i.test(r.type) && r.statusClass === 'active');
    const cost = primary.cost && primary.cost <= 2e9 ? primary.cost : max((r) => (r.cost && r.cost <= 2e9 ? r.cost : undefined));
    const dwellings = primary.dwellings ?? max((r) => r.dwellings);
    const storeys = primary.storeys ?? max((r) => r.storeys);
    sites.push({
      n: 0, key: groups[root].key, address: tidyAddress(primary.address, parseSiteAddress(primary.address)), primary, records: rs, modifications: mods,
      cost, dwellings, storeys, score: scaleScore(cost, dwellings, storeys),
      statusClass: primary.statusClass,
      statusText: primary.status + (liveMod ? ' · modification under assessment' : mods ? ` · ${mods} modification${mods > 1 ? 's' : ''}` : ''),
      lon: primary.lon!, lat: primary.lat!,
    });
  }
  sites.sort((a, b2) => b2.score - a.score || (b2.primary.lodged ?? '').localeCompare(a.primary.lodged ?? ''));
  sites.forEach((st, i) => { st.n = i + 1; });
  return sites;
}

/** The address as a table reads it: from the street number on, no state or postcode, title case. */
function tidyAddress(a: string, parsed: SiteAddress | null = null): string {
  const t = (parsed ? parsed.display : a.replace(/,?\s*(NSW|New South Wales)\b.*$/i, '').replace(/\s+\d{4}\s*$/, '')).replace(/\s+/g, ' ').trim();
  return t === t.toUpperCase() ? titleCase(t) : t;
}

const dotRadius = (cost?: number) => (cost ? Math.min(6.5, 1.5 + 1.9 * Math.sqrt(cost / 1e7)) : 1.5);

const fmtMonthYear = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
};
const fmtShortDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Australia/Sydney' });
};

export interface DevelopmentFacts {
  available: boolean;
  council?: string;
  from?: string;
  to?: string;
  applications: number;
  significant: number;
  sites: DaSite[];
  byStatus: Record<DaStatusClass, number>;
  dwellings: number;
  cost: number;
  perYear: { year: number; count: number; partial: boolean }[];
  largest?: DaSite;
  proposals: SlidesBundle['proposals'];
  /** State significant applications from the Department's register with their point in the window, S-numbered: in process first, then the latest determined. */
  stateSignificant: { ok: boolean; note?: string; lgas: string[]; listed: number; sites: SsdSite[]; nearestBeyond?: MajorProject; fetchedAt?: string;
    /** In the window but not drawn: approvals older than SSD_RECENT_YEARS, and applications withdrawn or whose SEARs lapsed. */
    older: number; withdrawn: number; olderThan: string };
}

/** Approvals older than this are counted, not drawn: the DA feed reaches five years back, a State significant project takes longer to build. */
const SSD_RECENT_YEARS = 10;
/** "City of Sydney" reads "the City of Sydney" in a sentence. */
const theArea = (name: string) => (/^(City|Municipality|Council) of\b/i.test(name) ? `the ${name}` : name);

export interface SsdSite extends MajorProject { n: string; onSite: boolean }

/** The register's addresses end in "Nsw 2017" or "New South Wales Australia" as often as not. */
const tidyRegisterAddress = (a?: string) => (a ?? '').replace(/,?\s*(New South Wales|NSW)\b.*$/i, '').replace(/,?\s+\d{4}\s*$/, '').replace(/\s+/g, ' ').trim();
const shorten = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, t.lastIndexOf(' ', max - 1) > max * 0.6 ? t.lastIndexOf(' ', max - 1) : max - 1)}…`);
/** A project's name for a sentence: its title, shortened. */
const ssdName = (p: MajorProject) => shorten(p.title.replace(/\s+/g, ' ').trim(), 80);
/** Where a project stands, as the register says it: the decision and its month, withdrawn, or the stage it is at. */
const ssdStage = (p: MajorProject) => p.stageClass === 'determined' ? `${p.decision ?? 'Determined'}${p.determined ? ` ${fmtMonthYear(p.determined)}` : ''}` : p.stageClass === 'withdrawn' ? 'Withdrawn' : (p.status || p.stage || 'In process');
const ssdStagePhrase = (p: MajorProject) => p.stageClass === 'determined' ? `${(p.decision ?? 'determined').toLowerCase()}${p.determined ? ` ${fmtMonthYear(p.determined)}` : ''}` : p.stageClass === 'withdrawn' ? 'withdrawn' : `at the ${p.status || p.stage || 'assessment'} stage`;

export function developmentFacts(b: SlidesBundle): DevelopmentFacts {
  const recs = b.applications;
  const sites = groupSites(recs);
  const byStatus: Record<DaStatusClass, number> = { determined: 0, active: 0, appeal: 0, withdrawn: 0 };
  for (const st of sites) byStatus[st.statusClass]++;
  const fromYear = Number((b.daMeta?.from ?? '').slice(0, 4)) || new Date().getFullYear() - 5;
  const thisYear = new Date().getFullYear();
  // The first year is partial too unless the window opens in its first week.
  const from = b.daMeta?.from ?? '';
  const firstPartial = (Number(from.slice(5, 7)) || 1) > 1 || (Number(from.slice(8, 10)) || 1) > 7;
  const perYear: DevelopmentFacts['perYear'] = [];
  for (let y = fromYear; y <= thisYear; y++)
    perYear.push({ year: y, count: recs.filter((r) => Number((r.lodged ?? '').slice(0, 4)) === y).length, partial: y === thisYear || (y === fromYear && firstPartial) });
  const largest = sites[0];
  // The register's projects with their point in the window, the ones in process first, then the latest determined.
  const mp = b.majorProjects;
  const ext = panelExtent(b.daPanel);
  const inWindow = (p: MajorProject) => { const q = lonLatToMercator({ lon: p.lon!, lat: p.lat! }); return q.x >= ext.xmin && q.x <= ext.xmax && q.y >= ext.ymin && q.y <= ext.ymax; };
  const lotRings = b.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const order = (p: MajorProject) => (p.stageClass === 'active' ? 0 : p.stageClass === 'determined' ? 1 : 2);
  const located = (mp?.projects ?? []).filter((p) => p.lon !== undefined && p.lat !== undefined);
  const cutoff = new Date(Date.now() - SSD_RECENT_YEARS * 365.25 * 86400e3).toISOString().slice(0, 10);
  const inWin = located.filter(inWindow);
  const older = inWin.filter((p) => p.stageClass === 'determined' && p.determined && p.determined < cutoff).length;
  const withdrawn = inWin.filter((p) => p.stageClass === 'withdrawn').length;
  const ssd: SsdSite[] = inWin.filter((p) => p.stageClass === 'active' || (p.stageClass === 'determined' && !(p.determined && p.determined < cutoff)))
    .sort((p, q) => order(p) - order(q) || (order(p) === 1 ? (q.determined ?? '').localeCompare(p.determined ?? '') : 0) || p.distanceM - q.distanceM)
    .map((p, i) => ({ ...p, n: `S${i + 1}`, onSite: lotRings.some((r) => pointInRing(p.lon!, p.lat!, r)) }));
  return {
    available: Boolean(b.daMeta), council: b.daMeta?.council, from: b.daMeta?.from, to: b.daMeta?.to,
    applications: recs.length, significant: recs.filter(isSignificant).length, sites, byStatus,
    dwellings: sites.reduce((n, st) => n + (st.dwellings ?? 0), 0),
    cost: sites.reduce((n, st) => n + (st.cost ?? 0), 0),
    perYear, largest, proposals: b.proposals,
    stateSignificant: { ok: Boolean(mp?.ok), note: mp?.note, lgas: (mp?.lgas ?? []).map((l) => l.name), listed: mp?.listed ?? 0, sites: ssd, nearestBeyond: located.find((p) => !inWindow(p) && p.stageClass !== 'withdrawn'), fetchedAt: mp?.fetchedAt, older, withdrawn, olderThan: cutoff.slice(0, 4) },
  };
}

export function developmentSentences(b: SlidesBundle, d: DevelopmentFacts, f: PlanningFacts): string[] {
  const out: string[] = [];
  const w = Math.round((b.daPanel.wMm / 1000) * b.daPanel.scale), h = Math.round((b.daPanel.hMm / 1000) * b.daPanel.scale);
  if (!d.available) {
    out.push(`The NSW Planning Portal's Online DA feed could not be read for this council when the deck was generated, so the map shows the policy areas only.`);
  } else {
    const years = Math.max(1, (new Date(d.to!).getTime() - new Date(d.from!).getTime()) / (365.25 * 86400e3));
    out.push(`Since ${fmtMonthYear(d.from)}, ${fmtNum(d.applications)} development applications, modifications and reviews were lodged with ${d.council} inside the ${fmtNum(w)} × ${fmtNum(h)} m window, about ${fmtNum(Math.round(d.applications / years))} a year.`);
    if (d.sites.length) {
      const st = d.byStatus;
      const bits = [
        st.determined ? `${st.determined} determined` : '',
        st.active ? `${st.active} under assessment or on exhibition` : '',
        st.appeal ? `${st.appeal} before the Court` : '',
        st.withdrawn ? `${st.withdrawn} withdrawn or rejected` : '',
      ].filter(Boolean);
      out.push(`${d.significant} of them, on ${d.sites.length} site${d.sites.length === 1 ? '' : 's'}, are of a scale that shapes context (four storeys, ten dwellings or $5 M and more): ${bits.join(', ')}. Together they propose ${fmtNum(d.dwellings)} dwellings at a stated cost of ${money(d.cost)}.`);
      if (d.largest) {
        const l = d.largest;
        const desc = [...new Set(l.primary.developmentTypes)].slice(0, 3).join(', ');
        out.push(`The largest is ${l.address}: ${desc ? `${desc.toLowerCase()}, ` : ''}${l.storeys ? `${l.storeys} storeys, ` : ''}${l.dwellings ? `${l.dwellings} dwellings, ` : ''}${l.cost ? `${money(l.cost)}, ` : ''}${l.primary.status.toLowerCase()} (lodged ${fmtMonthYear(l.primary.lodged)}).`);
      }
    } else {
      out.push(`None of them is of a scale that shapes context (four storeys, ten dwellings or $5 M and more): the activity here is house-scale.`);
    }
  }
  const s = d.stateSignificant;
  if (!s.ok) out.push(`The Department's Major Projects register could not be read for this run${s.note ? ` (${s.note})` : ''}, so no State significant application is shown.`);
  else if (s.sites.length) {
    const act = s.sites.filter((p) => p.stageClass === 'active').length, det = s.sites.length - act;
    const mix = s.sites.length === 1 ? '' : ` (${listWords([act ? `${act} in preparation or assessment` : '', det ? `${det} determined since ${s.olderThan}` : ''].filter(Boolean))})`;
    const asideN = s.older + s.withdrawn;
    const aside = asideN ? `; ${asideN === 1 ? 'one more' : `${asideN} more`} (${listWords([s.older ? `${s.older === 1 ? 'an' : s.older} approval${s.older === 1 ? '' : 's'} before ${s.olderThan}` : '', s.withdrawn ? `${s.withdrawn === 1 && !s.older ? '' : `${s.withdrawn} `}withdrawn or lapsed` : ''].filter(Boolean))}) ${asideN === 1 ? 'is' : 'are'} counted, not drawn` : '';
    let t = `The Department's Major Projects register lists ${fmtNum(s.listed)} State significant application${s.listed === 1 ? '' : 's'} for ${listWords(s.lgas.map(theArea))}; ${s.sites.length === 1 ? 'one in the window is drawn as a diamond' : `${s.sites.length} in the window are drawn as diamonds${mix}`}${aside}.`;
    const on = s.sites.find((p) => p.onSite);
    if (on) t += ` ${on.n} is on the site itself: ${ssdName(on)} (${on.number}, ${ssdStagePhrase(on)}).`;
    const next = s.sites.find((p) => p.stageClass === 'active' && !p.onSite);
    if (next) t += ` The nearest in process is ${next.n}, ${ssdName(next)}, ${fmtNum(next.distanceM)} m to the ${bearingName(next.bearing)} (${next.number}, ${ssdStagePhrase(next)}).`;
    else { const latest = s.sites.find((p) => p.stageClass === 'determined' && !p.onSite); if (latest) t += ` The latest determined is ${latest.n}, ${ssdName(latest)} (${latest.number}, ${ssdStagePhrase(latest)}).`; }
    out.push(t);
  } else {
    const nb = s.nearestBeyond;
    out.push(`None of the ${fmtNum(s.listed)} State significant applications the Department's Major Projects register lists for ${listWords(s.lgas.map(theArea))} is in process or determined since ${s.olderThan} in the window${s.older || s.withdrawn ? ` (${listWords([s.older ? `${s.older} older approval${s.older === 1 ? '' : 's'}` : '', s.withdrawn ? `${s.withdrawn} withdrawn or lapsed` : ''].filter(Boolean))} there)` : ''}${nb ? `; the nearest is ${ssdName(nb)} (${nb.number}, ${ssdStagePhrase(nb)}), ${nb.distanceM >= 1000 ? `${(nb.distanceM / 1000).toFixed(1)} km` : `${fmtNum(nb.distanceM)} m`} to the ${bearingName(nb.bearing)}` : ''}.`);
  }
  if (d.proposals.length) {
    out.push(`${d.proposals.length} planning proposal map${d.proposals.length === 1 ? ' is' : 's are'} on public exhibition in the window: ${[...new Set(d.proposals.map((p) => p.name))].slice(0, 3).join('; ')}.`);
  } else {
    out.push('No planning proposal is on public exhibition in the window.');
  }
  if (f.policyAtSite.length) out.push(`The site is inside ${f.policyAtSite.map((p) => `the ${p.name} ${POLICY_WORD[p.kind]}`).join(' and ')}, drawn as a wash on the map.`);
  return out;
}

function developmentMap(b: SlidesBundle, d: DevelopmentFacts, numbered: number, ssdNumbered: number): string {
  const p = b.daPanel;
  const proj = panelProjector(p);
  const parts: string[] = [baseLayers(b.base, proj, p)];
  // Policy areas as a wash, so the dots read against them.
  for (const kind of ['townCentre', 'tod', 'todAccelerated', 'todDeferred', 'ssdSite', 'precinct'] as PolicyKind[]) {
    const areas = b.policy.filter((a) => a.kind === kind);
    if (!areas.length) continue;
    const st = POLICY_STYLE[kind];
    parts.push(`<path d="${areas.map((a) => ringsPath(a.rings, proj)).join('')}" fill="${st.fill}" fill-opacity="0.16" stroke="${st.stroke}" stroke-opacity="0.6" stroke-width="${st.fill === 'none' ? 0.45 : 0.15}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} fill-rule="evenodd"/>`);
  }
  // The site's outline and label go on last, over any dot on or beside it.
  parts.push(overLayers(b.base, proj, p, 'wash'));
  // Every other application: a small grey dot, the texture of activity.
  const seen = new Set<string>();
  const minor: string[] = [];
  for (const r of b.applications) {
    if (isSignificant(r) || r.lon === undefined || r.lat === undefined) continue;
    const key = `${r.lon.toFixed(5)},${r.lat.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [x, y] = proj(r.lon, r.lat);
    minor.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.55"/>`);
  }
  parts.push(`<g fill="#b3b3b3">${minor.join('')}</g>`);
  // Sites of scale whose centre is on the map, big first so the small stay
  // visible, ringed in white. Numbers go on after every circle, so none is
  // covered; a number that has no room inside its circle sits beside it.
  const placed = d.sites
    .map((st) => { const [x, y] = proj(st.lon, st.lat); return { st, x, y, r: dotRadius(st.cost) }; })
    .filter((q) => q.x >= 0 && q.y >= 0 && q.x <= p.wMm && q.y <= p.hMm)
    .sort((a, b2) => b2.r - a.r);
  // The scale bar takes the corner with the least site under it, bottom-left first.
  const under = (corner: FurnitureCorner) => {
    const bx = furnitureBox(p, corner);
    return placed.reduce((sum, q) => {
      const dx = q.x - Math.max(bx.x0, Math.min(q.x, bx.x1)), dy = q.y - Math.max(bx.y0, Math.min(q.y, bx.y1));
      return sum + (dx * dx + dy * dy < q.r * q.r ? q.r : 0);
    }, 0);
  };
  let corner: FurnitureCorner = 'left', least = Infinity;
  for (const c of ['left', 'right', 'topLeft', 'topRight'] as FurnitureCorner[]) { const u = under(c); if (u < least) { least = u; corner = c; } }
  const fb = furnitureBox(p, corner);
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take((fb.x0 + fb.x1) / 2, (fb.y0 + fb.y1) / 2, fb.x1 - fb.x0 - 2, fb.y1 - fb.y0 - 2);
  const siteLabel = siteLabelPoint(b.base, proj);
  if (siteLabel) spacer.take(siteLabel.cx, siteLabel.cy - 0.8, labelW('SITE', 2.4), 2.6);
  // State significant applications: diamonds, their room taken before the numbers look for theirs.
  const DR = 2.5;
  const ssdPlaced = d.stateSignificant.sites.map((st) => { const [x, y] = proj(st.lon!, st.lat!); return { st, x, y }; })
    .filter((q) => q.x >= 0 && q.y >= 0 && q.x <= p.wMm && q.y <= p.hMm);
  for (const q of ssdPlaced) spacer.take(q.x, q.y, DR * 2, DR * 2);
  const dots: string[] = [];
  const labels: string[] = [];
  for (const { st, x, y, r } of placed) {
    const sty = STATUS_STYLE[st.statusClass];
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 0.35).toFixed(2)}" fill="#ffffff"/>` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${sty.fill}" fill-opacity="${sty.hollow ? 1 : 0.92}" stroke="${sty.stroke}" stroke-width="${sty.hollow ? 0.5 : 0.25}"/>`);
  }
  for (const { st, x, y, r } of placed) {
    if (st.n > numbered) continue;
    const text = String(st.n);
    const w = labelW(text, 2), h = 2.4;
    if (r >= 2.3 && spacer.take(x, y, w + 0.6, h)) {
      labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" font-weight="600" fill="${STATUS_STYLE[st.statusClass].hollow ? '#454f4b' : '#ffffff'}">${text}</text>`);
      continue;
    }
    const spots: [number, number][] = [[x + r + 1.2 + w / 2, y], [x - r - 1.2 - w / 2, y], [x, y - r - 1.6], [x, y + r + 1.6]];
    for (const [lx, ly] of spots) if (spacer.take(lx, ly, w, h)) { labels.push(label(lx, ly, text, 2, '#2a3534')); break; }
  }
  const diamonds: string[] = [];
  const dia = (x: number, y: number, r: number) => `M${x.toFixed(2)},${(y - r).toFixed(2)}L${(x + r).toFixed(2)},${y.toFixed(2)}L${x.toFixed(2)},${(y + r).toFixed(2)}L${(x - r).toFixed(2)},${y.toFixed(2)}Z`;
  for (const { st, x, y } of ssdPlaced) {
    const sty = STATUS_STYLE[st.stageClass];
    diamonds.push(`<path d="${dia(x, y, DR + 0.45)}" fill="#ffffff"/><path d="${dia(x, y, DR)}" fill="${sty.fill}" stroke="${sty.stroke}" stroke-width="${sty.hollow ? 0.5 : 0.25}"/>`);
  }
  for (const { st, x, y } of ssdPlaced) {
    if (Number(st.n.slice(1)) > ssdNumbered) continue;
    if (st.n.length <= 2) { labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.65).toFixed(1)}" text-anchor="middle" font-size="1.75" font-weight="600" fill="${STATUS_STYLE[st.stageClass].hollow ? '#454f4b' : '#ffffff'}">${st.n}</text>`); continue; }
    const w = labelW(st.n, 1.9);
    for (const [lx, ly] of [[x + DR + 1 + w / 2, y], [x - DR - 1 - w / 2, y], [x, y - DR - 1.6], [x, y + DR + 1.6]] as [number, number][])
      if (spacer.take(lx, ly, w, 2.3)) { labels.push(label(lx, ly, st.n, 1.9, '#2a3534')); break; }
  }
  parts.push(dots.join(''), diamonds.join(''), labels.join(''), siteMark(b.base, proj, 'outline'), panelFurniture(p, corner));
  return `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-da"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-da)" font-family="${tpl().font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${tpl().rule}" stroke-width="0.2"/>
  </svg>`;
}

/** Applications lodged per year: one series, thin columns, values on the caps. */
function yearChart(d: DevelopmentFacts, wMm: number, hMm: number): string {
  const t = tpl();
  const years = d.perYear;
  if (!years.length) return '';
  const max = Math.max(1, ...years.map((y) => y.count));
  const left = 2, right = 2, top = 7, bottom = 5.5;
  const plotH = hMm - top - bottom;
  const slot = (wMm - left - right) / years.length;
  const barW = Math.min(5.5, slot * 0.55);
  const parts: string[] = [];
  const monthOf = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-AU', { month: 'short', timeZone: 'Australia/Sydney' }) : '');
  const notes: string[] = [];
  if (years.length > 1 && years[0].partial) notes.push(`${years[0].year} from ${monthOf(d.from)}`);
  if (years[years.length - 1].partial) notes.push(`${years[years.length - 1].year} to ${monthOf(d.to)}`);
  parts.push(`<text x="0" y="3" font-size="2.3" font-weight="600" fill="${t.ink}">Applications lodged per year in the window` +
    (notes.length ? `<tspan font-weight="400" fill="#737c77"> · ${esc(notes.join(' · '))}</tspan>` : '') + `</text>`);
  const base = top + plotH;
  parts.push(`<line x1="${left}" y1="${base.toFixed(1)}" x2="${(wMm - right).toFixed(1)}" y2="${base.toFixed(1)}" stroke="#c9c9c9" stroke-width="0.15"/>`);
  years.forEach((y, i) => {
    const h = (y.count / max) * plotH;
    const x = left + i * slot + (slot - barW) / 2;
    const yTop = base - h;
    const rr = Math.min(0.8, h / 2);
    const fill = y.partial ? '#9aa6a0' : t.dimension;
    if (h > 0)
      parts.push(`<path d="M${x.toFixed(2)},${base.toFixed(2)} V${(yTop + rr).toFixed(2)} Q${x.toFixed(2)},${yTop.toFixed(2)} ${(x + rr).toFixed(2)},${yTop.toFixed(2)} H${(x + barW - rr).toFixed(2)} Q${(x + barW).toFixed(2)},${yTop.toFixed(2)} ${(x + barW).toFixed(2)},${(yTop + rr).toFixed(2)} V${base.toFixed(2)} Z" fill="${fill}"/>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(yTop - 1).toFixed(2)}" text-anchor="middle" font-size="2.1" fill="${t.ink}">${y.count}</text>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(base + 3.2).toFixed(2)}" text-anchor="middle" font-size="2.1" fill="#6a7572">${y.year}</text>`);
  });
  return `<svg width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block" font-family="${t.font}">${parts.join('')}</svg>`;
}

/** A circle swatch for the key, filled after the kit. */
const circleSwatch = (f: Fill, r = 1.45) => fillShape(`M${(2.5 - r).toFixed(2)},1.8a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`, { x0: 2.5 - r, y0: 1.8 - r, x1: 2.5 + r, y1: 1.8 + r }, f, 1.54);

/** A 6 pt word on a map, haloed in white: the template's map labels. */
const m6 = (x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'middle') =>
  `<text x="${x.toFixed(2)}" y="${(y + 0.75).toFixed(2)}" text-anchor="${anchor}" font-size="2.117" letter-spacing="0.19" font-family="Arial, 'Liberation Sans', sans-serif" fill="#000000" stroke="#ffffff" stroke-width="0.5" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;

/** The base every template map stands on: white ground, the cadastre and the roads in greys, rail as track. */
const greyBase = (t: ReturnType<typeof tpl>) => ({ ...t, water: '#eef3f6', road: '#c9c9c9', rail: '#8a8a8a', transit: '#6f6f6f', busRoute: '#9a9a9a' });


/** The narrative: the slide's own facts in two or three sentences, cut where the next would run past `max`. */
const brief = (parts: (string | undefined | false | null)[], max = 430) => {
  let out = '';
  for (const part of parts) { if (!part) continue; const next = out ? `${out} ${part}` : part; if (out && next.length > max) break; out = next; }
  return out;
};
const firstSentence = (text: string) => { const m = text.replace(/\s+/g, ' ').match(/^.*?[.!?](\s|$)/); return (m ? m[0] : text).trim(); };

/** A full-page map's SVG: one A4 page, clipped to it. */
const bleedSvg = (id: string, p: Panel, inner: string) =>
  `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block"><defs><clipPath id="clip-${id}"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs><g clip-path="url(#clip-${id})" font-family="Arial, 'Liberation Sans', sans-serif">${inner}</g></svg>`;
/** The figure page: the map to the sheet's edges, its name and scale in the corner, and the left page's flow. */
const atlasFigure = (mapSvg: string, label: string, p: Panel | null, flow: string) =>
  `<div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div><div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">${esc(label)}${p ? ` · 1:${fmtNum(p.scale).replace(',', ' ')}` : ''}</div>${flow}`;
/** The subtitle: the address and the council area on the first line, the figures after. */
const atlasSub = (b: SlidesBundle, ...rest: (string | undefined | false | null)[]) => {
  const lga = b.context.lga?.name ? titleCase(b.context.lga.name) : '';
  return [`${b.siteAddress}${lga ? ` ${lga}` : ''}`, ...rest].filter(Boolean).join(' · ');
};
/** The left page's column of blocks, from under the second rule. */
const zFlow = (blocks: string[], top = 44) => `<div class="zflow" style="top:${top}mm">${blocks.join('')}</div>`;
const zBlock = (head: string, body: string, right?: string) => `<div class="zblk">${zHead(head, right)}${body}</div>`;
/** The template's rows: a 6 pt label, an 8 pt value, a hairline under each; a grey 6 pt note under the value. */
const zTable = (rows: { label: string; value: string | string[]; note?: string; dim?: boolean }[]) =>
  rows.map((r) => `<div class="zr${r.dim ? ' dim' : ''}"><div class="l">${esc(r.label)}</div><div class="v">${(Array.isArray(r.value) ? r.value : [r.value]).map((v) => `<div>${esc(v)}</div>`).join('')}${r.note ? `<div class="n">${esc(r.note)}</div>` : ''}</div></div>`).join('');
/** A square key for the legend: the site. */
const SITE_KEY = (t: ReturnType<typeof tpl>): LegendEntry => ({ swatch: `<path d="M1.2,0.6H3.8V3H1.2Z" fill="${t.site}"/>`, label: 'The site' });
/** Open street-level frames further than this from the site's boundary stand in another street and do not show it. */
const FRONTAGE_REACH_M = 25;
const angleGap = (a: number, b2: number) => { const d = Math.abs((((a - b2) % 360) + 360) % 360); return d > 180 ? 360 - d : d; };
/** The site's outline in black over its red mark, where the map itself is red. */
const siteEdge = (b: SlidesBundle, proj: Proj) => `<path d="${b.base.siteLots.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#000000" stroke-width="0.35" stroke-linejoin="round"/>`;
/** The site's rings and their bounding box on a map, for the spacer to keep clear. */
const keepSiteClear = (b: SlidesBundle, proj: Proj, spacer: LabelSpacer) => {
  const rings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  if (rings.length) { const sb = bboxOf(rings, proj); spacer.take((sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2, sb.x1 - sb.x0 + 2, sb.y1 - sb.y0 + 2); }
};
/** The share of the page each feature group covers, clipped to the page. */
const pageShare = (rings: number[][][], proj: Proj, p: Panel) => rings.reduce((a, r) => a + clippedStats(r, proj, p).area, 0) / (p.wMm * p.hMm);

/** Development activity on the template: the red family, the status told by pattern. */
export function developmentAtlas(b0: SlidesBundle, facts: PlanningFacts): Slide {
  // the applications whose lot lies on the page: the feed was read over a wider window
  const pe0 = panelExtent(b0.bleedPanel);
  const onPage = (r: DaRecord) => { if (r.lon === undefined || r.lat === undefined) return false; const m = lonLatToMercator({ lon: r.lon, lat: r.lat }); return m.x >= pe0.xmin && m.x <= pe0.xmax && m.y >= pe0.ymin && m.y <= pe0.ymax; };
  const b: SlidesBundle = { ...b0, daPanel: b0.bleedPanel, applications: b0.applications.filter(onPage) };
  const t = tpl();
  const d = developmentFacts(b);
  const R = INK.red;
  const STATUS_FILL: Record<DaStatusClass, Fill> = {
    determined: { bg: R.mid, outline: R.solid, outlineW: 0.2 },
    active: { bg: '#ffffff', kind: 'vlines', ink: R.line, step: 0.7, w: 0.2, outline: R.line, outlineW: 0.3 },
    appeal: { bg: '#ffffff', kind: 'vlines', ink: R.deep, step: 0.45, w: 0.22, outline: R.deep, outlineW: 0.3 },
    withdrawn: { bg: '#ffffff', outline: R.solid, outlineW: 0.3, dash: '0.8 0.5' },
  };
  const STATUS_WORD: Record<DaStatusClass, string> = {
    determined: 'Determined (the feed does not say approved or refused)',
    active: 'Under assessment, on exhibition or awaiting information',
    appeal: 'Before the Land and Environment Court',
    withdrawn: 'Withdrawn, rejected or cancelled',
  };

  // ---- the map, over the whole figure page
  const p = b.bleedPanel;
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p)), withTemplate(gt, () => overLayers(b.base, proj, p, 'none'))];
  const seen = new Set<string>();
  const minor: string[] = [];
  for (const r of b.applications) {
    if (isSignificant(r) || r.lon === undefined || r.lat === undefined) continue;
    const key = `${r.lon.toFixed(5)},${r.lat.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [x, y] = proj(r.lon, r.lat);
    minor.push(`M${x.toFixed(2)},${y.toFixed(2)}h0`);
  }
  parts.push(`<path d="${minor.join('')}" stroke="${R.mid}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`);
  const byCost = [...d.sites].sort((x, y) => (y.cost ?? 0) - (x.cost ?? 0));
  const charted = new Set(byCost.slice(0, 7).map((st) => st.n));
  const placed = d.sites.map((st) => { const [x, y] = proj(st.lon, st.lat); return { st, x, y, r: dotRadius(st.cost) }; })
    .filter((q) => q.x >= 0 && q.y >= 0 && q.x <= p.wMm && q.y <= p.hMm).sort((a, b2) => b2.r - a.r);
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take(36, 10, 64, 10);
  const circle = (x: number, y: number, r: number) => `M${(x - r).toFixed(2)},${y.toFixed(2)}a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(2 * r).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-2 * r).toFixed(2)},0Z`;
  for (const q of placed) parts.push(`<circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="${(q.r + 0.4).toFixed(2)}" fill="#ffffff"/>` + fillShape(circle(q.x, q.y, q.r), { x0: q.x - q.r, y0: q.y - q.r, x1: q.x + q.r, y1: q.y + q.r }, STATUS_FILL[q.st.statusClass]));
  const DR = 2.4;
  const dia = (x: number, y: number, r: number) => `M${x.toFixed(2)},${(y - r).toFixed(2)}L${(x + r).toFixed(2)},${y.toFixed(2)}L${x.toFixed(2)},${(y + r).toFixed(2)}L${(x - r).toFixed(2)},${y.toFixed(2)}Z`;
  const ssd = d.stateSignificant.sites.map((st) => { const [x, y] = proj(st.lon!, st.lat!); return { st, x, y }; }).filter((q) => q.x >= 0 && q.y >= 0 && q.x <= p.wMm && q.y <= p.hMm);
  for (const q of ssd) {
    parts.push(`<path d="${dia(q.x, q.y, DR + 0.45)}" fill="#ffffff"/>` + fillShape(dia(q.x, q.y, DR), { x0: q.x - DR, y0: q.y - DR, x1: q.x + DR, y1: q.y + DR }, STATUS_FILL[q.st.stageClass as DaStatusClass] ?? STATUS_FILL.active));
    spacer.take(q.x, q.y, DR * 2, DR * 2);
  }
  const labels: string[] = [];
  for (const q of placed) {
    if (!charted.has(q.st.n)) continue;
    const text = String(q.st.n), w = text.length * 1.6 + 0.8;
    const spots: [number, number][] = [[q.x + q.r + 1.2 + w / 2, q.y], [q.x - q.r - 1.2 - w / 2, q.y], [q.x, q.y - q.r - 1.8], [q.x, q.y + q.r + 1.8]];
    for (const [lx, ly] of spots) if (spacer.take(lx, ly, w, 2.6)) { labels.push(m6(lx, ly, text)); break; }
  }
  for (const q of ssd) {
    const text = q.st.n, w = text.length * 1.6 + 0.8;
    for (const [lx, ly] of [[q.x + DR + 1.2 + w / 2, q.y], [q.x - DR - 1.2 - w / 2, q.y], [q.x, q.y - DR - 1.8]] as [number, number][]) if (spacer.take(lx, ly, w, 2.6)) { labels.push(m6(lx, ly, text)); break; }
  }
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-dev"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-dev)" font-family="${t.font}">${parts.join('\n')}</g></svg>`;

  // ---- the text page
  const figs = zFigures([
    ['applications lodged', fmtNum(d.applications)],
    ['of scale, on sites', `${fmtNum(d.significant)} on ${fmtNum(d.sites.length)}`],
  ], [
    ['dwellings proposed · stated cost', `${fmtNum(d.dwellings)} · ${d.cost ? money(d.cost) : '—'}`],
    ['State significant applications', fmtNum(d.stateSignificant.sites.length)],
  ], 9.6);
  // where and when: each site of scale on its year's row, at its distance from the site, sized by its cost
  const c0 = lonLatToMercator(mercatorToLonLat(p.center)), k0 = mercatorScaleFactor(mercatorToLonLat(p.center).lat);
  const distOf = (lon: number, lat: number) => { const m = lonLatToMercator({ lon, lat }); return Math.hypot(m.x - c0.x, m.y - c0.y) / k0; };
  const pts = d.sites.map((st) => ({ st, dist: distOf(st.lon, st.lat), year: Number((st.primary.lodged ?? '').slice(0, 4)) })).filter((q) => q.year);
  const dx = niceAxis(Math.max(100, ...pts.map((q) => q.dist)));
  const SC = { AX: 6.3, ROW0: 11.5, ROWH: 7.2, X0: 40, X1: Z_W - 4 };
  const SX = (m: number) => SC.X0 + (Math.min(m, dx.max) / dx.max) * (SC.X1 - SC.X0);
  const maxCost = Math.max(1, ...pts.map((q) => q.st.cost ?? 0));
  const sg: string[] = [];
  const rowsY = d.perYear.map((y, i) => ({ ...y, y: SC.ROW0 + i * SC.ROWH }));
  const scY1 = SC.ROW0 + (rowsY.length - 0.5) * SC.ROWH;
  for (let v = 0; v <= dx.max + 1e-9; v += dx.step) {
    sg.push(z6(SX(v), SC.AX, v === 0 ? '0' : `${fmtNum(v)} m`, v === 0 ? 'start' : 'middle'));
    sg.push(`<line x1="${SX(v).toFixed(2)}" y1="${(SC.ROW0 - SC.ROWH / 2).toFixed(2)}" x2="${SX(v).toFixed(2)}" y2="${scY1.toFixed(2)}" stroke="#878787" stroke-width="0.18" stroke-linecap="round" stroke-dasharray="0 0.36"/>`);
  }
  for (const r of rowsY) {
    const n = pts.filter((q) => q.year === r.year).length;
    sg.push(z6(0, r.y - 2.6, `${r.year}${r.partial ? (r === rowsY[0] ? ' from ' + fmtMonthYear(d.from).split(' ')[0] : ' to ' + fmtMonthYear(d.to).split(' ')[0]) : ''}`), z6(0, r.y + 0.1, `${fmtNum(r.count)} lodged · ${n} of scale`).replace('fill="#000000"', 'fill="#878787"'));
    sg.push(`<line x1="${SC.X0}" y1="${r.y.toFixed(2)}" x2="${SC.X1}" y2="${r.y.toFixed(2)}" stroke="#878787" stroke-width="0.12"/>`);
  }
  for (const q of [...pts].sort((a2, b2) => (b2.st.cost ?? 0) - (a2.st.cost ?? 0))) {
    const r = rowsY.find((x) => x.year === q.year); if (!r) continue;
    const rad = 0.6 + 2.6 * Math.sqrt((q.st.cost ?? 0) / maxCost), x = SX(q.dist);
    sg.push(`<circle cx="${x.toFixed(2)}" cy="${r.y.toFixed(2)}" r="${(rad + 0.25).toFixed(2)}" fill="#ffffff"/>` + fillShape(`M${(x - rad).toFixed(2)},${r.y.toFixed(2)}a${rad.toFixed(2)},${rad.toFixed(2)} 0 1,0 ${(2 * rad).toFixed(2)},0a${rad.toFixed(2)},${rad.toFixed(2)} 0 1,0 ${(-2 * rad).toFixed(2)},0Z`, { x0: x - rad, y0: r.y - rad, x1: x + rad, y1: r.y + rad }, STATUS_FILL[q.st.statusClass]));
  }
  // the site at the axis' origin
  sg.push(`<path d="M${(SC.X0 - 0.9).toFixed(2)},${(scY1 + 0.6).toFixed(2)}h1.8v1.8h-1.8Z" fill="${t.site}"/>`);
  const scatter = zSvg(scY1 + 3, sg.join(''));
  const scatterH = scY1 + 3;
  const mapKm = `${((p.wMm * p.scale) / 1e6).toFixed(1)} × ${((p.hMm * p.scale) / 1e6).toFixed(1)} km`;
  const method = zTable([
    { label: 'Counted', value: `Every application on the Planning Portal since ${fmtMonthYear(d.from)} on the ${mapKm} of the map.` },
    { label: 'Of scale', value: 'Four storeys, ten dwellings or $5 M and more; one site a lot.' },
    { label: 'State significant', value: "The State's own register, S-numbered, not in the council's count." },
  ]);
  const years = d.perYear;
  const ya = niceAxis(Math.max(1, ...years.map((y) => y.count)));
  const yearRows = years.map((y, i) => ({
    name: `${y.year}${y.partial ? (i === 0 ? ` from ${fmtMonthYear(d.from).split(' ')[0]}` : ` to ${fmtMonthYear(d.to).split(' ')[0]}`) : ''}`,
    value: y.count, label: fmtNum(y.count),
    fill: y.partial ? STATUS_FILL.active : { bg: R.mid },
  }));
  const legend: LegendEntry[] = [
    ...(['determined', 'active', 'appeal', 'withdrawn'] as DaStatusClass[]).filter((k) => d.byStatus[k] || d.stateSignificant.sites.some((q) => q.stageClass === k)).map((k) => ({ swatch: circleSwatch(STATUS_FILL[k]), label: STATUS_WORD[k] })),
    { swatch: `<circle cx="1.1" cy="2.4" r="0.7" fill="${R.mid}"/><circle cx="3.4" cy="1.8" r="1.4" fill="${R.mid}"/>`, label: 'Circle area follows the stated cost; numbers match the chart' },
    { swatch: `<circle cx="2.5" cy="1.8" r="0.45" fill="${R.mid}"/>`, label: 'Every other application lodged in the period' },
    ...(d.stateSignificant.sites.length ? [{ swatch: `<path d="M2.5,0.2L4.1,1.8L2.5,3.4L0.9,1.8Z" fill="${R.mid}"/>`, label: "State significant application, the Department's register, S-numbered" }] : []),
    { swatch: `<path d="M1.2,0.6H3.8V3H1.2Z" fill="${t.site}"/>`, label: 'The site' },
  ];
  const legendN = legend.length;
  // the cost chart takes the rows the page holds above the key, after the figures, the scatter and the method
  const free = keyTop(legendN) - 6 - (44 + blockH(6.3 + 2 * 9.6) + blockH(scatterH) + 38);
  void ya; void yearRows;
  const top = byCost.slice(0, Math.max(0, Math.min(7, Math.floor((free - blockH(10)) / 3.95))));
  const ca = niceAxis(Math.max(1, ...top.map((st) => (st.cost ?? 0) / 1e6)));
  const costRows = top.map((st) => ({
    name: `${st.n}  ${shorten(st.address.replace(/\s+(Redfern|Surry Hills|Waterloo|Chippendale|Darlington|Eveleigh|Alexandria|Zetland|Rosebery)$/i, ''), 34)}`,
    value: (st.cost ?? 0) / 1e6,
    label: `${st.cost ? money(st.cost) : '—'}${st.dwellings ? ` · ${st.dwellings} dw` : ''}`,
    fill: STATUS_FILL[st.statusClass],
  }));
  const flow = `<div class="zflow" style="top:44mm">
    <div class="zblk">${zHead('The pipeline', 'On this map')}${figs}</div>
    <div class="zblk">${zHead('Sites of scale · when', 'and how far from the site')}${scatter}</div>
    <div class="zblk">${zHead('How it is counted')}${method}</div>
    ${top.length >= 3 ? `<div class="zblk">${zHead('Sites of scale · stated cost, $ M')}${zBars(costRows, ca.max, ca.step)}</div>` : ''}
  </div>`;
  const sources = `Sources: NSW Planning Portal Online DA API, every application lodged on the portal since July 2021 on the land the map covers; storeys, dwellings and costs as lodged by the applicant, "determined" not saying approved or refused; complying development certificates are not in the feed. State significant applications from the Department's Major Projects register. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const lga = b.context.lga?.name ? titleCase(b.context.lga.name) : '';
  const sub = [`${b.siteAddress}${lga ? ` ${lga}` : ''}`, d.available ? `${fmtNum(d.applications)} applications since ${fmtMonthYear(d.from)}` : 'feed unavailable', d.stateSignificant.sites.length ? `${d.stateSignificant.sites.length} State significant` : ''].filter(Boolean).join(' · ');
  const figureHtml = `<div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">Development activity · 1:${fmtNum(p.scale).replace(',', ' ')}</div>
    ${flow}`;
  void facts;
  return { id: '07_development_activity', title: 'Development activity', subtitle: sub, textHtml: '', figureHtml, bleed: true, sources, accent: R.text, legend,
    narrative: brief([`Since ${fmtMonthYear(d.from)}, ${fmtNum(d.applications)} applications were lodged on the land this map covers, about ${fmtNum(Math.round(d.applications / Math.max(1, d.perYear.length - 1)))} a year.`, `${fmtNum(d.significant)} of them, on ${fmtNum(d.sites.length)} sites, are of a scale that shapes the place — four storeys, ten dwellings or $5 M and more — and propose ${fmtNum(d.dwellings)} dwellings${d.cost ? ` at a stated ${money(d.cost)}` : ''}.`]) };
}

export function developmentSlide(b: SlidesBundle, facts: PlanningFacts): Slide {
  const d = developmentFacts(b);
  const x0 = FIELD_X, y0 = FIELD_Y;
  const rightX = AUX_X;
  const rightW = AUX_W;
  const mapTitle = d.available
    ? `Applications lodged since ${fmtMonthYear(d.from)} · ${d.council}`
    : 'Development applications · feed unavailable';
  const tiles = [
    { v: fmtNum(d.applications), l: 'applications in the window' },
    { v: fmtNum(d.sites.length), l: 'sites of scale' },
    { v: fmtNum(d.dwellings), l: 'dwellings proposed on them' },
    { v: d.cost ? money(d.cost) : '—', l: 'stated cost of development' },
  ].map((tl) => `<div class="tile"><div class="tv">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const legend = STATUS_ORDER.map((k) => {
    const sty = STATUS_STYLE[k];
    return `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><circle cx="2.5" cy="1.8" r="1.5" fill="${sty.fill}" stroke="${sty.stroke}" stroke-width="${sty.hollow ? 0.45 : 0.2}"/></svg><span>${esc(sty.label)}</span></div>`;
  }).join('') +
    `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><circle cx="1" cy="1.8" r="0.9" fill="#948f85"/><circle cx="3.4" cy="1.8" r="1.6" fill="#948f85"/></svg><span>Circle area follows the stated cost; numbers match the table</span></div>` +
    `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><circle cx="2.5" cy="1.8" r="0.55" fill="#b3b3b3"/></svg><span>Every other application lodged in the period</span></div>` +
    (d.stateSignificant.sites.length ? `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><path d="M2.5,0.15 L4.15,1.8 L2.5,3.45 L0.85,1.8 Z" fill="#948f85"/></svg><span>State significant application from the Department's register, S-numbered, coloured by stage</span></div>` : '');
  const chartH = 32;
  const right = `<div class="abs ptitle sm" style="left:${rightX}mm;top:${y0}mm;width:${rightW}mm">Scale of activity</div>
    <div class="abs tiles two" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 1}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 32}mm;width:${rightW}mm">${legend}</div>
    <div class="abs" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 74 + (d.stateSignificant.sites.length ? 6 : 0)}mm;width:${rightW}mm">${yearChart(d, rightW, chartH)}</div>`;

  // Rows until the table would run into the footer: about 5 mm a line, and
  // the address and status columns wrap past roughly 50 and 34 characters.
  const LINE_MM = 2.95, ROW_PAD_MM = 2.05, TABLE_BUDGET_MM = 106, MORE_MM = 5;
  const rowMm = (st: DaSite) => Math.max(1, Math.ceil(st.statusText.length / 22), Math.ceil(st.address.length / 26), Math.ceil(Math.min(([...new Set(st.primary.developmentTypes)].join(', ') || st.primary.type).length, 72) / 42)) * LINE_MM + ROW_PAD_MM;
  // The State significant applications take the top rows, six at most, and leave the rest to the council's.
  const ssdSite = (q: SsdSite) => shorten(tidyRegisterAddress(q.address) || q.title, 100);
  const ssdDev = (q: SsdSite) => shorten(tidyRegisterAddress(q.address) && q.title.toLowerCase().startsWith(tidyRegisterAddress(q.address).toLowerCase()) && q.description ? q.description : q.title, 72);
  const ssdStatus = (q: SsdSite) => `${q.number} · ${ssdStage(q)}${q.modifications.length ? ` · ${q.modifications.length} modification${q.modifications.length === 1 ? '' : 's'}` : ''}${q.onSite ? ' · on the site' : ''}`;
  const ssdRowMm = (q: SsdSite) => Math.max(1, Math.ceil(ssdStatus(q).length / 22), Math.ceil(ssdSite(q).length / 26), Math.ceil(ssdDev(q).length / 42)) * LINE_MM + ROW_PAD_MM;
  const ssdShown: SsdSite[] = [];
  let used = 0;
  for (const q of d.stateSignificant.sites.slice(0, 6)) { const h = ssdRowMm(q); if (used + h > TABLE_BUDGET_MM * 0.55) break; ssdShown.push(q); used += h; }
  const ssdRest = d.stateSignificant.sites.length - ssdShown.length;
  if (ssdRest > 0) used += MORE_MM;
  const shown: DaSite[] = [];
  for (const st of d.sites) { const h = rowMm(st); if (used + h > TABLE_BUDGET_MM) break; shown.push(st); used += h; }
  while (shown.length < d.sites.length && shown.length && used + MORE_MM > TABLE_BUDGET_MM) used -= rowMm(shown.pop()!);
  const rows = shown.map((st) => {
    const types = [...new Set(st.primary.developmentTypes)].join(', ');
    const dev = types.length > 72 ? `${types.slice(0, 70)}…` : types || st.primary.type;
    return `<tr><td class="n">${st.n}</td><td>${esc(st.address)}</td><td>${esc(dev)}</td>` +
      `<td class="r">${st.storeys ?? ''}</td><td class="r">${st.dwellings ?? ''}</td><td class="r">${st.cost ? esc(money(st.cost)) : ''}</td>` +
      `<td><span class="dot" style="background:${STATUS_STYLE[st.statusClass].fill};border-color:${STATUS_STYLE[st.statusClass].stroke}"></span>${esc(st.statusText)}</td>` +
      `<td>${esc(fmtShortDate(st.primary.lodged))}</td><td>${esc(fmtShortDate(st.primary.determined))}</td></tr>`;
  }).join('');
  const ssdRows = ssdShown.map((q) => {
    const sty = STATUS_STYLE[q.stageClass];
    return `<tr><td class="n">${q.n}</td><td>${esc(ssdSite(q))}</td><td>${esc(ssdDev(q))}</td><td class="r"></td><td class="r"></td><td class="r"></td>` +
      `<td><span class="dot dia" style="background:${sty.fill};border-color:${sty.stroke}"></span>${esc(ssdStatus(q))}</td><td></td><td>${esc(fmtShortDate(q.determined))}</td></tr>`;
  }).join('') + (ssdRest > 0 ? `<tr><td></td><td colspan="8" class="more">+ ${ssdRest} more State significant application${ssdRest > 1 ? 's' : ''} in the window, diamonds without a number, all in overall.json</td></tr>` : '');
  const rest = d.sites.length - shown.length;
  const more = rest > 0 ? `<tr><td></td><td colspan="8" class="more">+ ${rest} smaller site${rest > 1 ? 's' : ''} of scale, unnumbered on the map, all in overall.json</td></tr>` : '';
  const empty = !d.sites.length ? `<tr><td></td><td colspan="8" class="more">${d.available ? 'No application of scale in the window for this period' : 'The feed was not available'}</td></tr>` : '';
  const table = `<table class="da"><thead><tr><th class="n">#</th><th style="width:38mm">Site</th><th>Development as lodged</th><th class="r" style="width:8mm">St</th><th class="r" style="width:9mm">Dw</th><th class="r" style="width:11mm">Cost</th><th style="width:30mm">Status</th><th style="width:11mm">Lodged</th><th style="width:12mm">Determined</th></tr></thead><tbody>${ssdRows}${rows}${more}${empty}</tbody></table>`;

  const sentences = developmentSentences(b, d, facts);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the pipeline says about the pace and direction of change here, which approvals set the built-form precedent for this site, and which are worth a site visit or a read of the approved plans.') +
    `<div class="fine">Source: NSW Planning Portal Online DA API, updated daily, every application lodged on the portal since councils were required onto it in July 2021. Council-wide feed clipped to the window; storeys, dwellings and costs as lodged by the applicant; "determined" does not say approved or refused. Complying development certificates are not in this feed. State significant applications (S-numbered diamonds) come from the Department's Major Projects register: its listing for the council area and each project's page, placed at the register's point, with the decision and date the page gives; the register does not give lodgement dates. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, d.council ?? '', d.available ? `${fmtNum(d.applications)} applications since ${fmtMonthYear(d.from)}` : '', d.stateSignificant.sites.length ? `${d.stateSignificant.sites.length} State significant` : ''].filter(Boolean).join(' · ');
  const figureHtml = `<div class="abs ptitle" style="left:${x0}mm;top:${y0}mm;width:${PANEL_W}mm">${esc(mapTitle)}</div>
    <div class="abs" style="left:${x0}mm;top:${y0 + PANEL_TITLE_H}mm">${developmentMap(b, d, shown.length, ssdShown.length)}</div>
    ${right}
    <div class="abs" style="left:${x0}mm;top:${y0 + PANEL_TITLE_H + DA_PANEL_H + 4}mm;width:${FIELD_W}mm">${table}</div>`;
  return { id: '07_development_activity', title: 'Development activity', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 16: people and market ---------------------------------------------

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : NaN);
const fmtPct = (v: number, dp = 0) => (Number.isFinite(v) ? `${v.toFixed(dp)} %` : '—');
const dollars = (n?: number) => (n ? `$${fmtNum(n)}` : '—');
const shortName = (s: string) => s.replace(/\s*\(.*\)$/, '');
/** "WATERLOO TOWN HALL, 770 ELIZABETH ST, WATERLOO NSW 2017" → "770 ELIZABETH ST": the street address without a building name, suburb or state. */
const streetOnly = (a: string) => { const m = a.match(/\d[^,]*[A-Za-z][^,]*/); return (m ? m[0] : a.split(',')[0]).replace(/\s+NSW\b.*$/i, '').trim(); };

function dwellingShares(d?: DwellingMix) {
  if (!d || !d.occupied) return null;
  const base = Math.max(1, d.occupied - d.notStated);
  const flats = d.flatsLow + d.flatsMid + d.flatsHigh + d.flatsOther;
  return {
    occupied: d.occupied, separateHouse: pct(d.separateHouse, base), semiDetached: pct(d.semiDetached, base),
    flatsLow: pct(d.flatsLow, base), flatsMid: pct(d.flatsMid, base), flatsHigh: pct(d.flatsHigh, base),
    other: pct(d.other + d.flatsOther, base), flats: pct(flats, base), unoccupied: pct(d.unoccupied, d.occupied + d.unoccupied),
  };
}
function tenureShares(t?: TenureMix) {
  if (!t || !t.total) return null;
  const base = Math.max(1, t.total - t.notStated);
  return {
    ownedOutright: pct(t.ownedOutright, base), mortgage: pct(t.mortgage, base), rentedPrivate: pct(t.rentedPrivate, base),
    rentedSocial: pct(t.rentedSocial, base), other: pct(t.otherTenure, base), renting: pct(t.rentedPrivate + t.rentedSocial, base),
  };
}
/** Shares of the employed people who worked on census day, at home or away. */
function travelShares(t?: TravelMix) {
  if (!t || !t.total) return null;
  const base = Math.max(1, t.total - t.didNotGoToWork - t.notStated);
  return { workers: base, car: pct(t.car, base), publicTransport: pct(t.publicTransport, base), active: pct(t.active, base), workedAtHome: pct(t.workedAtHome, base), other: pct(t.other, base) };
}
function ageShares(p?: PersonsProfile) {
  if (!p) return null;
  const total = p.ages.reduce((s, a) => s + a.persons, 0);
  return total ? p.ages.map((a) => ({ label: a.label, share: pct(a.persons, total) })) : null;
}
function personShares(p?: PersonsProfile) {
  if (!p || !p.persons) return null;
  return { persons: p.persons, bornOverseas: pct(p.bornElsewhere, p.bornInAustralia + p.bornElsewhere), otherLanguage: pct(p.otherLanguage, p.englishOnly + p.otherLanguage) };
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The register around the site: single-property dealings of the last `months` months, strata and land apart. */
function salesSummary(sales: Sale[], months = 24) {
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  const iso = cutoff.toISOString().slice(0, 10);
  const recent = sales.filter((s) => s.date >= iso && s.properties === 1);
  const strata = recent.filter((s) => s.strata), land = recent.filter((s) => !s.strata);
  const perSqm = land.filter((s) => s.areaSqm && s.areaSqm > 0).map((s) => s.price / s.areaSqm!);
  return {
    register: sales.length, months, count: recent.length,
    strata: { count: strata.length, median: median(strata.map((s) => s.price)) },
    land: { count: land.length, median: median(land.map((s) => s.price)), medianPerSqm: median(perSqm) },
    latest: sales.slice(0, 7),
  };
}

function populationFacts(p: PeopleData) {
  const at = (s: YearValue[], y: number) => s.find((v) => v.year === y)?.value;
  const latest = p.erpSa2[p.erpSa2.length - 1];
  const base2016 = at(p.erpSa2, 2016);
  const proj = p.tzp24?.sa2 ?? [], lgaProj = p.tzp24?.lga ?? [];
  const lgaLatest = p.erpLga[p.erpLga.length - 1];
  return {
    latest, since2016Pct: latest && base2016 ? pct(latest.value - base2016, base2016) : NaN,
    proj2041: at(proj, 2041), proj2066: at(proj, 2066), projFrom: proj[0],
    lgaLatest, lgaProj2041: at(lgaProj, 2041), lgaProj2066: at(lgaProj, 2066),
  };
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export function peopleSentences(b: SlidesBundle): string[] {
  const p = b.people;
  if (!p) return ['The ABS region lookup failed when the deck was generated, so this slide has no statistics.'];
  const out: string[] = [];
  const sa2 = p.regions.sa2, bench = p.benchmark, prof = p.sa2;
  const benchName = bench ? shortName(bench.name) : '';
  const pop = populationFacts(p);
  if (pop.latest) {
    let s = `${sa2.name} (SA2${sa2.areaSqkm ? `, ${fmtNum(sa2.areaSqkm, 1)} km²` : ''}) had ${fmtNum(pop.latest.value)} residents at June ${pop.latest.year}`;
    if (Number.isFinite(pop.since2016Pct)) s += `, ${pop.since2016Pct >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(pop.since2016Pct))} on 2016`;
    if (pop.proj2041 && pop.proj2066) s += `; TZP24 projects ${fmtNum(pop.proj2041)} by 2041 and ${fmtNum(pop.proj2066)} by 2066`;
    s += '.';
    if (pop.lgaLatest && p.regions.lga) s += ` ${shortName(p.regions.lga.name)} LGA: ${fmtNum(pop.lgaLatest.value)} in ${pop.lgaLatest.year}${pop.lgaProj2041 ? `, ${fmtNum(pop.lgaProj2041)} projected by 2041` : ''}.`;
    out.push(s);
  }
  if (prof) {
    const m = prof.medians, bm = bench?.medians, ps = personShares(prof.persons);
    const vs = (v?: number, b2?: number, f: (n: number) => string = (n) => fmtNum(n)) => (v ? `${f(v)}${b2 ? ` (${benchName} ${f(b2)})` : ''}` : '');
    const bits: string[] = [];
    if (m.medianAge) bits.push(`Median age ${vs(m.medianAge, bm?.medianAge)}`);
    if (ps) bits.push(`${fmtPct(ps.bornOverseas)} born overseas`, `${fmtPct(ps.otherLanguage)} speak a language other than English at home`);
    if (m.householdIncomeWk) bits.push(`median household income ${vs(m.householdIncomeWk, bm?.householdIncomeWk, (n) => `$${fmtNum(n)}`)} a week`);
    let s = bits.length ? `${bits.join('; ')}.` : '';
    const dec = p.seifaSa2?.irsad.decileState;
    if (dec) s += ` SEIFA advantage-and-disadvantage decile ${dec} of 10 within NSW${dec >= 9 ? ', among the most advantaged areas' : dec <= 2 ? ', among the most disadvantaged areas' : ''}.`;
    if (s) out.push(s.trim());
    const ds = dwellingShares(prof.dwellings), ts = tenureShares(prof.tenure), bds = dwellingShares(bench?.dwellings), bts = tenureShares(bench?.tenure);
    if (ds && ts) {
      let h = `${fmtPct(ds.flats)} of the ${fmtNum(ds.occupied)} occupied dwellings are flats${bds ? ` (${benchName} ${fmtPct(bds.flats)})` : ''}`;
      if (ds.flatsHigh >= 10) h += `, ${fmtPct(ds.flatsHigh)} in blocks of nine storeys or more`;
      h += `; ${fmtPct(ts.renting)} of households rent${bts ? ` (${fmtPct(bts.renting)})` : ''}; ${fmtPct(ds.unoccupied)} of dwellings were unoccupied on census night${bds ? ` (${fmtPct(bds.unoccupied)})` : ''}.`;
      if (m.rentWk || m.mortgageMo) h += ` Median rent ${dollars(m.rentWk)} a week${bm?.rentWk ? ` (${dollars(bm.rentWk)})` : ''}, median mortgage ${dollars(m.mortgageMo)} a month.`;
      out.push(h);
    }
    const tr = travelShares(prof.travel);
    if (tr) out.push(`On census day, 10 August 2021, under the COVID-19 restrictions, ${fmtPct(tr.workedAtHome)} of workers worked from home, ${fmtPct(tr.car)} drove or rode, ${fmtPct(tr.publicTransport)} took public transport and ${fmtPct(tr.active)} walked or cycled.`);
  }
  const mk: string[] = [];
  const lv = p.landValues;
  if (lv && lv.values.length) {
    const last = lv.values[lv.values.length - 1], first = lv.values[0];
    const peak = lv.values.reduce((a, v) => (v.value > a.value ? v : a), lv.values[0]);
    mk.push(`The land value of ${titleCase(streetOnly(lv.address))}${lv.stratum ? ' (a stratum)' : ''} is ${money(last.value)} at ${last.baseDate}, ${last.value >= first.value ? 'up' : 'down'} from ${money(first.value)} in ${first.year}${peak.year !== last.year && peak.year !== first.year ? ` after a peak of ${money(peak.value)} in ${peak.year}` : ''}.`);
  }
  if (p.sales.length) {
    const ss = salesSummary(p.sales);
    let s = `${fmtNum(ss.register)} sales are on the register within ${p.salesRadiusM} m`;
    if (ss.count) {
      const parts: string[] = [];
      if (ss.strata.count) parts.push(`${ss.strata.count} strata at a median ${money(ss.strata.median!)}`);
      if (ss.land.count) parts.push(`${ss.land.count} whole propert${ss.land.count === 1 ? 'y' : 'ies'} (houses, land or buildings) at a median ${money(ss.land.median!)}${ss.land.medianPerSqm ? ` ($${fmtNum(ss.land.medianPerSqm)} per m² of land)` : ''}`);
      s += `; ${ss.count} changed hands in the last ${ss.months} months: ${parts.join(', ')}`;
    }
    mk.push(`${s}.`);
  }
  if (mk.length) out.push(mk.join(' '));
  if (p.schools.length) {
    const sc = p.schools.slice(0, 4).map((s) => `${s.name} (${km(s.distanceM)}${s.enrolment ? `, ${fmtNum(s.enrolment)} students` : ''}${/fully|partially/i.test(s.selective ?? '') ? ', selective' : ''})`);
    out.push(`Nearest government schools: ${sc.join('; ')}.`);
  }
  return out;
}

export function peopleFacts(b: SlidesBundle) {
  const p = b.people;
  if (!p) return { available: false as const, sentences: peopleSentences(b) };
  const prof = (c: CensusProfile | null) => c && {
    level: c.level, code: c.code, name: c.name, medians: c.medians, persons: personShares(c.persons), ages: ageShares(c.persons),
    dwellings: dwellingShares(c.dwellings), tenure: tenureShares(c.tenure), travel: travelShares(c.travel),
    counts: { dwellings: c.dwellings, tenure: c.tenure, travel: c.travel, persons: c.persons },
  };
  return {
    available: true as const, regions: p.regions, sa2: prof(p.sa2), lga: prof(p.lga), benchmark: prof(p.benchmark),
    population: { sa2: p.erpSa2, lga: p.erpLga, benchmark: p.erpBenchmark, summary: populationFacts(p) },
    projections: p.tzp24, seifa: { sa2: p.seifaSa2, lga: p.seifaLga },
    landValues: p.landValues, sales: { ...salesSummary(p.sales), radiusM: p.salesRadiusM, all: p.sales },
    schools: { radiusM: p.schoolsRadiusM, list: p.schools },
    sentences: peopleSentences(b),
    caveats: [
      'Census night, 10 August 2021, fell in the COVID-19 lockdowns (Greater Sydney and, that week, some regions): worked-at-home is inflated and the travel modes deflated.',
      'Land values are the Valuer General\'s as at 1 July each year; sales as recorded on the register, single-property dealings only in the medians.',
    ],
  };
}

/** People and market on the template: the sales round the site to the sheet's edges; the people charted against Greater Sydney. */
export function peopleAtlas(b: SlidesBundle): Slide {
  const t = tpl();
  const O = INK.orange;
  const f = peopleFacts(b);
  const p: Panel = { ...b.bleedPanel, scale: 4000 };
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const WHOLE: Fill = { bg: O.solid, outline: O.deep, outlineW: 0.2 };
  const STRATA: Fill = { bg: '#ffffff', kind: 'vlines', ink: O.deep, step: 0.5, w: 0.16, outline: O.deep, outlineW: 0.25 };
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  if (b.buildings.buildings.length) parts.push(`<path d="${b.buildings.buildings.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="#f4f4f4" stroke="#d6d6d6" stroke-width="0.1" fill-rule="evenodd"/>`);
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const cLL = mercatorToLonLat(p.center);
  const [cx, cy] = proj(cLL.lon, cLL.lat);
  const sales = f.available ? f.sales.all : [];
  const radiusM = f.available ? f.sales.radiusM : 400;
  parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${((radiusM * 1000) / p.scale).toFixed(2)}" fill="none" stroke="#000000" stroke-width="0.25" stroke-dasharray="1.4 0.8"/>`);
  const cutoff = (() => { const d = new Date(b.generatedAt); d.setMonth(d.getMonth() - SALES_MONTHS); return d.toISOString().slice(0, 10); })();
  const recent = sales.filter((s) => s.properties === 1 && s.date >= cutoff);
  const older = sales.filter((s) => !(s.properties === 1 && s.date >= cutoff));
  if (older.length) parts.push(`<path d="${older.map((s) => { const [x, y] = proj(s.lon, s.lat); return `M${x.toFixed(2)},${y.toFixed(2)}h0`; }).join('')}" stroke="${O.mid}" stroke-width="0.9" stroke-linecap="round" fill="none"/>`);
  const maxP = Math.max(1, ...recent.map((s) => s.price));
  const circle = (x: number, y: number, r: number) => `M${(x - r).toFixed(2)},${y.toFixed(2)}a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(2 * r).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-2 * r).toFixed(2)},0Z`;
  for (const s of [...recent].sort((x, y) => y.price - x.price)) {
    const [x, y] = proj(s.lon, s.lat);
    const r = 0.9 + 3.2 * Math.sqrt(s.price / maxP);
    parts.push(fillShape(circle(x, y, r), { x0: x - r, y0: y - r, x1: x + r, y1: y + r }, s.strata ? STRATA : WHOLE));
  }
  const spacer = new LabelSpacer(p.wMm, p.hMm, 30);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const labels: string[] = [];
  for (const s of [...recent].filter((x) => !x.strata).sort((x, y) => y.price - x.price).slice(0, 8)) {
    const [x, y] = proj(s.lon, s.lat);
    const text = money(s.price);
    for (const [lx, ly] of [[x + 5 + text.length * 0.8, y], [x - 5 - text.length * 0.8, y], [x, y - 5]] as [number, number][]) if (spacer.take(lx, ly, text.length * 1.6 + 1, 2.8)) { labels.push(m6(lx, ly, text)); break; }
  }
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  void box;
  const mapSvg = bleedSvg('people16', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    { swatch: circleSwatch(WHOLE, 1.3), label: `Whole-property sales, last ${SALES_MONTHS} months, sized by price` },
    { swatch: circleSwatch(STRATA, 1.3), label: 'Strata sales, the same months' },
    { swatch: `<circle cx="2.5" cy="1.8" r="0.45" fill="${O.mid}"/>`, label: 'Earlier sales and multi-property dealings on the register' },
    { swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="none" stroke="#000000" stroke-width="0.25" stroke-dasharray="1 0.6"/>`, label: `${radiusM} m from the site` },
    SITE_KEY(t),
  ];
  const limit = keyTop(legend.length) - 6;
  const blocks: string[] = [];
  if (f.available && f.sa2) {
    const s2 = f.sa2, bm = f.benchmark, pop = f.population.summary;
    const m = s2.medians, mb = bm?.medians;
    const vs = (a?: number, bv?: number, pre = '', post = '') => (a === undefined ? '—' : `${pre}${fmtNum(a)}${post}${bv !== undefined ? ` · ${pre}${fmtNum(bv)}${post} Greater Sydney` : ''}`);
    const figs = zFigures([
      [`residents of ${s2.name} (SA2), ${pop.latest?.year ?? ''}`, pop.latest ? fmtNum(pop.latest.value) : '—'],
      ['since 2016 · projected 2041', `${Number.isFinite(pop.since2016Pct) ? `${pop.since2016Pct >= 0 ? '+' : '−'}${fmtPct(Math.abs(pop.since2016Pct))}` : '—'} · ${pop.proj2041 ? fmtNum(pop.proj2041) : '—'}`],
      ['median age', vs(m.medianAge, mb?.medianAge)],
    ], [
      ['median household income, a week', vs(m.householdIncomeWk, mb?.householdIncomeWk, '$')],
      ['median rent, a week', vs(m.rentWk, mb?.rentWk, '$')],
      ['sales within the ring, 24 months', `${f.sales.count} · strata median ${f.sales.strata.median ? money(f.sales.strata.median) : '—'} · whole ${f.sales.land.median ? money(f.sales.land.median) : '—'}`],
    ], 9.6);
    blocks.push(zBlock(`${s2.name} · Census 2021`, figs, 'The market'));
    let y = 44 + blockH(6.3 + 3 * 9.6);
    const proj24 = f.projections?.sa2 ?? [];
    const line = zLine(f.population.sa2.map((v) => ({ year: v.year, value: v.value })), proj24.filter((v) => v.year > (f.population.sa2[f.population.sa2.length - 1]?.year ?? 0)).map((v) => ({ year: v.year, value: v.value })), 22, (v) => fmtNum(v));
    if (line && y + blockH(30) < limit) { blocks.push(zBlock(`Population · ${s2.name} (SA2)`, line, 'TZP24 projection dashed')); y += blockH(30); }
    const SA: Fill = { bg: O.solid }, GS: Fill = { bg: '#ffffff', kind: 'vlines', ink: O.deep, step: 0.45, w: 0.14, outline: O.deep, outlineW: 0.1 };
    const keys: [string, string] = [`${s2.name}`, 'Greater Sydney'];
    const d = s2.dwellings, db = bm?.dwellings;
    if (d && db) {
      const rows = [['Separate house', d.separateHouse, db.separateHouse], ['Semi-detached or terrace', d.semiDetached, db.semiDetached], ['Flats, 1–3 storeys', d.flatsLow, db.flatsLow], ['Flats, 4–8 storeys', d.flatsMid, db.flatsMid], ['Flats, 9 storeys or more', d.flatsHigh, db.flatsHigh]].map(([name, a, bb]) => ({ name: String(name), a: Number(a) || 0, b: Number(bb) || 0 }));
      const h = 10.9 + rows.length * 6.5 - 1.2;
      if (y + blockH(h) < limit) { const ax = niceAxis(Math.max(...rows.flatMap((r) => [r.a, r.b]))); blocks.push(zBlock('Dwellings by structure · %', zPairs(rows, ax.max, ax.step, keys, SA, GS))); y += blockH(h); }
    }
    const tn = s2.tenure, tb = bm?.tenure;
    if (tn && tb) {
      const rows = [['Owned outright', tn.ownedOutright, tb.ownedOutright], ['With a mortgage', tn.mortgage, tb.mortgage], ['Rented privately', tn.rentedPrivate, tb.rentedPrivate], ['Social housing', tn.rentedSocial, tb.rentedSocial]].map(([name, a, bb]) => ({ name: String(name), a: Number(a) || 0, b: Number(bb) || 0 }));
      const h = 10.9 + rows.length * 6.5 - 1.2;
      if (y + blockH(h) < limit) { const ax = niceAxis(Math.max(...rows.flatMap((r) => [r.a, r.b]))); blocks.push(zBlock('Households by tenure · %', zPairs(rows, ax.max, ax.step, keys, SA, GS))); y += blockH(h); }
    }
  } else blocks.push(zBlock('People', `<div class="zr" style="padding-left:0"><div class="v">${esc(f.sentences[0] ?? 'The census and the register did not answer for this run.')}</div></div>`));
  const sources = `Sources: ABS Census 2021 (G01, G02, G36, G37, G62) for the SA2 and Greater Sydney; ABS estimated resident population at 30 June; TfNSW Travel Zone Projections 2024; NSW Valuer General land values and sales register via SIX Maps. Census night, 10 August 2021, fell in the COVID-19 lockdowns. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, f.available && f.sa2 ? `${f.sa2.name} (SA2)` : '', 'against Greater Sydney');
  return { id: '16_people_and_market', title: 'People and market', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, `Sales within ${radiusM} m`, p, zFlow(blocks)), bleed: true, sources, accent: O.text, legend,
    narrative: brief(f.available ? [peopleSentences(b)[0], f.sa2?.tenure ? `${fmtPct(f.sa2.tenure.renting)} of households rent, against ${fmtPct(f.benchmark?.tenure?.renting ?? NaN)} across Greater Sydney.` : ''] : [peopleSentences(b)[0]]) };
}

export function peopleSlide(b: SlidesBundle): Slide {
  const p = b.people;
  const t = tpl();
  const sentences = peopleSentences(b);
  const benchName = p?.benchmark ? shortName(p.benchmark.name) : 'the capital city';
  const textHtml = sentences.map(para).join('') +
    placeholder("Narrative — for the author: who the market is here (households, incomes, tenure), what the pipeline and the projections mean for demand, and how the site's land value and the sales around it frame the feasibility.") +
    `<div class="fine">Sources: ABS Census 2021 (tables G01, G02, G36, G37, G62) for the SA2, the LGA and ${esc(benchName)}; ABS estimated resident population at 30 June; TfNSW Travel Zone Projections 2024; ABS SEIFA 2021; NSW Valuer General land values and sales register via SIX Maps; NSW Department of Education master dataset (government schools only). Census night, 10 August 2021, fell in the COVID-19 lockdowns (Greater Sydney's and, that week, some regions'), so worked-at-home is inflated and the travel modes deflated. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, p ? `${p.regions.sa2.name} (SA2)` : '', p?.regions.lga ? `${shortName(p.regions.lga.name)} LGA` : '', p ? `against ${benchName}` : ''].filter(Boolean).join(' · ');
  if (!p) {
    return { id: '16_people_and_market', title: 'People and market', subtitle: sub, textHtml,
      figureHtml: `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">Statistics unavailable<span class="pnote">the ABS region lookup failed for this point</span></div>` };
  }

  const prof = p.sa2 ?? p.lga, bench = p.benchmark;
  const pop = populationFacts(p);
  const ds = dwellingShares(prof?.dwellings), bds = dwellingShares(bench?.dwellings);
  const ts = tenureShares(prof?.tenure), bts = tenureShares(bench?.tenure);
  const tr = travelShares(prof?.travel), btr = travelShares(bench?.travel);
  const ag = ageShares(prof?.persons), bag = ageShares(bench?.persons);
  const m = prof?.medians, bm = bench?.medians;
  const subjectLabel = prof?.level === 'LGA' ? 'LGA' : 'SA2';

  // Row A: the headline figures.
  const cmp = (v: string | undefined) => (v && bench ? ` (${benchName} ${v})` : '');
  const tiles = [
    { v: pop.latest ? fmtNum(pop.latest.value) : '—', l: pop.latest ? `residents of ${shortName(p.regions.sa2.name)} (SA2), June ${pop.latest.year}` : 'no population series for this SA2' },
    { v: Number.isFinite(pop.since2016Pct) ? `${pop.since2016Pct >= 0 ? '+' : '−'}${fmtPct(Math.abs(pop.since2016Pct))}` : '—', l: `since 2016${pop.proj2041 ? ` · TZP24: ${fmtNum(pop.proj2041)} by 2041` : ''}` },
    { v: m?.medianAge ? String(m.medianAge) : '—', l: `median age${cmp(bm?.medianAge ? String(bm.medianAge) : undefined)}` },
    { v: m?.householdIncomeWk ? dollars(m.householdIncomeWk) : '—', l: `median household income a week${cmp(bm?.householdIncomeWk ? dollars(bm.householdIncomeWk) : undefined)}` },
    { v: m?.rentWk ? dollars(m.rentWk) : '—', l: `median rent a week${cmp(bm?.rentWk ? dollars(bm.rentWk) : undefined)}` },
    { v: ds ? fmtPct(ds.flats) : '—', l: `of dwellings are flats${cmp(bds ? fmtPct(bds.flats) : undefined)}` },
    { v: ts ? fmtPct(ts.renting) : '—', l: `of households rent${cmp(bts ? fmtPct(bts.renting) : undefined)}` },
  ].map((tl) => `<div class="tile"><div class="tv">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');

  // Row B: the population line and the comparison table.
  const halfW = (FIELD_W - GUTTER) / 2;
  const rowB = FIELD_Y, chartH = 52;
  const hist = p.erpSa2, proj = p.tzp24?.sa2 ?? [];
  const popChart = lineWithProjection({
    w: halfW, h: chartH, font: t.font, history: hist, projection: proj,
    historyLabel: `ABS estimated resident population ${hist[0]?.year ?? ''}–${hist[hist.length - 1]?.year ?? ''}`,
    projectionLabel: proj.length ? `TZP24 projection ${proj[0].year}–${proj[proj.length - 1].year}` : '',
  });
  const cols: { head: string; c: CensusProfile | null; seifa: number | undefined }[] = [
    { head: `${shortName(p.regions.sa2.name)} (SA2)`, c: p.sa2, seifa: p.seifaSa2?.irsad.decileState },
    { head: p.regions.lga ? `${shortName(p.regions.lga.name)} (LGA)` : 'LGA', c: p.lga, seifa: p.seifaLga?.irsad.decileState },
    { head: benchName, c: bench, seifa: undefined },
  ];
  type Cell = (c: CensusProfile) => string;
  const rows: [string, Cell][] = [
    ['People counted', (c) => (c.persons?.persons ? fmtNum(c.persons.persons) : '—')],
    ['Median age', (c) => (c.medians.medianAge ? String(c.medians.medianAge) : '—')],
    ['Median personal income, a week', (c) => dollars(c.medians.personalIncomeWk)],
    ['Median household income, a week', (c) => dollars(c.medians.householdIncomeWk)],
    ['Median rent, a week', (c) => dollars(c.medians.rentWk)],
    ['Median mortgage, a month', (c) => dollars(c.medians.mortgageMo)],
    ['Average household size', (c) => (c.medians.householdSize ? c.medians.householdSize.toFixed(1) : '—')],
    ['Flats, share of dwellings', (c) => fmtPct(dwellingShares(c.dwellings)?.flats ?? NaN)],
    ['Renting, share of households', (c) => fmtPct(tenureShares(c.tenure)?.renting ?? NaN)],
    ['Unoccupied on census night', (c) => fmtPct(dwellingShares(c.dwellings)?.unoccupied ?? NaN)],
    ['Born overseas', (c) => fmtPct(personShares(c.persons)?.bornOverseas ?? NaN)],
    ['Language other than English at home', (c) => fmtPct(personShares(c.persons)?.otherLanguage ?? NaN)],
  ];
  const table = `<table class="cmp"><thead><tr><th>Census 2021</th>${cols.map((c) => `<th>${esc(c.head)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map(([label, cell]) => `<tr><td>${esc(label)}</td>${cols.map((c, i) => `<td${i === 0 ? ' class="hi"' : ''}>${c.c ? esc(cell(c.c)) : '—'}</td>`).join('')}</tr>`).join('') +
    `<tr><td>SEIFA advantage decile, NSW (10 = most)</td>${cols.map((c, i) => `<td${i === 0 ? ' class="hi"' : ''}>${c.seifa ? c.seifa : '—'}</td>`).join('')}</tr>` +
    `</tbody></table>`;

  // Row C: four profiles against the benchmark.
  const rowC = rowB + PANEL_TITLE_H + Math.max(chartH, 70) + 3, smallH = 48;
  const qW = halfW;
  const pair = (rowsIn: { label: string; a: number; b?: number }[], labelW?: number) =>
    pairedBars({ w: qW, h: smallH, font: t.font, rows: rowsIn, aLabel: subjectLabel, bLabel: bench ? benchName : undefined, unit: ' %', labelW });
  const charts: { title: string; svg: string }[] = [
    { title: 'Age', svg: ag ? pair(ag.map((a, i) => ({ label: a.label, a: a.share, b: bag?.[i]?.share })), 12) : '' },
    { title: 'Dwelling structure', svg: ds ? pair([
      { label: 'Separate house', a: ds.separateHouse, b: bds?.separateHouse }, { label: 'Semi or terrace', a: ds.semiDetached, b: bds?.semiDetached },
      { label: 'Flats, 1–3 storeys', a: ds.flatsLow, b: bds?.flatsLow }, { label: 'Flats, 4–8', a: ds.flatsMid, b: bds?.flatsMid },
      { label: 'Flats, 9 or more', a: ds.flatsHigh, b: bds?.flatsHigh }, { label: 'Other', a: ds.other, b: bds?.other }], 24) : '' },
    { title: 'Tenure', svg: ts ? pair([
      { label: 'Owned outright', a: ts.ownedOutright, b: bts?.ownedOutright }, { label: 'Mortgage', a: ts.mortgage, b: bts?.mortgage },
      { label: 'Rented privately', a: ts.rentedPrivate, b: bts?.rentedPrivate }, { label: 'Social housing', a: ts.rentedSocial, b: bts?.rentedSocial },
      { label: 'Other', a: ts.other, b: bts?.other }], 24) : '' },
    { title: 'Travel to work, census day', svg: tr ? pair([
      { label: 'Car or motorbike', a: tr.car, b: btr?.car }, { label: 'Public transport', a: tr.publicTransport, b: btr?.publicTransport },
      { label: 'Walked or cycled', a: tr.active, b: btr?.active }, { label: 'Worked at home', a: tr.workedAtHome, b: btr?.workedAtHome },
      { label: 'Other', a: tr.other, b: btr?.other }], 24) : '' },
  ];
  const chartCells = charts.map((c, i) => {
    const x = FIELD_X + (i % 2) * (qW + GUTTER);
    const yC = rowC + Math.floor(i / 2) * (PANEL_TITLE_H + smallH + 3);
    return `<div class="abs ptitle sm" style="left:${x}mm;top:${yC}mm;width:${qW}mm">${esc(c.title)}</div>
      <div class="abs" style="left:${x}mm;top:${yC + PANEL_TITLE_H}mm">${c.svg || emptyBox(qW, smallH, 'not in the census tables for this region')}</div>`;
  }).join('');

  // Row D: the site's land value and the sales around it.
  const rowD = rowC + 2 * (PANEL_TITLE_H + smallH + 3) + 1, marketH = 42;
  const lvW = AUX_W, lvY = FIELD_Y + 96, salesX = FIELD_X, salesW = FIELD_W;
  const lv = p.landValues;
  const lvTitle = lv ? `Land value · ${titleCase(streetOnly(lv.address))}` : 'Land value';
  const lvNote = lv ? [lv.zone ? lv.zone.split(' - ')[0] : '', lv.stratum ? 'stratum' : '', lv.areaSqm ? `${fmtNum(lv.areaSqm)} m²` : ''].filter(Boolean).join(' · ') : 'no property at the point';
  const lvChart = lv && lv.values.length
    ? columns({ w: lvW, h: marketH, font: t.font, values: lv.values.map((v) => ({ label: String(v.year), value: v.value, text: money(v.value) })) })
    : emptyBox(lvW, marketH, 'the Valuation service has no land value for this property');
  const ss = salesSummary(p.sales);
  const statBits: string[] = [];
  if (ss.count) {
    statBits.push(`Last ${ss.months} months: ${ss.count} single-property sales`);
    if (ss.strata.count) statBits.push(`strata ${ss.strata.count}, median ${money(ss.strata.median!)}`);
    if (ss.land.count) statBits.push(`whole properties ${ss.land.count}, median ${money(ss.land.median!)}${ss.land.medianPerSqm ? ` · $${fmtNum(ss.land.medianPerSqm)}/m² of land` : ''}`);
  } else if (p.sales.length) statBits.push(`No sale in the last ${ss.months} months`);
  const saleRows = ss.latest.map((s) => `<tr><td>${esc(fmtShortDate(s.date))}</td><td>${esc(titleCase(s.address.replace(/,?\s*NSW.*$/i, '')))}</td><td class="r">${esc(money(s.price))}</td>` +
    `<td>${s.properties > 1 ? `${s.properties} properties` : s.strata ? 'Strata' : 'Whole property'}</td><td class="r">${s.areaSqm ? fmtNum(s.areaSqm) : ''}</td>` +
    `<td class="r">${!s.strata && s.areaSqm && s.properties === 1 ? `$${fmtNum(s.price / s.areaSqm)}` : ''}</td><td class="r">${s.distanceM} m</td></tr>`).join('');
  const salesTable = p.sales.length
    ? `<div class="stat">${esc(statBits.join(' · '))}${ss.latest.some((s) => s.properties > 1) ? ' · a dealing of several properties shows the whole dealing\'s price' : ''}</div><table class="da"><thead><tr><th style="width:16mm">Sold</th><th>Address</th><th class="r" style="width:16mm">Price</th><th style="width:20mm">Type</th><th class="r" style="width:14mm">Land m²</th><th class="r" style="width:16mm">$/m²</th><th class="r" style="width:12mm">Away</th></tr></thead><tbody>${saleRows}</tbody></table>`
    : emptyBox(salesW, marketH, `no sale on the register within ${p.salesRadiusM} m`);

  const figureHtml = `
    <div class="abs tiles col" style="left:${AUX_X}mm;top:${FIELD_Y}mm;width:${AUX_W}mm">${tiles}</div>
    <div class="abs ptitle sm" style="left:${AUX_X}mm;top:${lvY}mm;width:${AUX_W}mm">${esc(lvTitle)}<span class="pnote">${esc(lvNote)}</span></div>
    <div class="abs" style="left:${AUX_X}mm;top:${lvY + PANEL_TITLE_H}mm">${lvChart}</div>
    <div class="abs ptitle sm" style="left:${FIELD_X}mm;top:${rowB}mm;width:${halfW}mm">Population · ${esc(p.regions.sa2.name)}<span class="pnote">SA2, June each year</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${rowB + PANEL_TITLE_H}mm">${popChart || emptyBox(halfW, chartH, 'no population series for this SA2')}</div>
    <div class="abs ptitle sm" style="left:${FIELD_X + halfW + GUTTER}mm;top:${rowB}mm;width:${halfW}mm">Census 2021 against ${esc(benchName)}</div>
    <div class="abs" style="left:${FIELD_X + halfW + GUTTER}mm;top:${rowB + PANEL_TITLE_H}mm;width:${halfW}mm">${table}</div>
    ${chartCells}
    <div class="abs ptitle" style="left:${salesX}mm;top:${rowD}mm;width:${salesW}mm">Sales within ${p.salesRadiusM} m<span class="pnote">${fmtNum(p.sales.length)} on the register, most recent first</span></div>
    <div class="abs" style="left:${salesX}mm;top:${rowD + PANEL_TITLE_H}mm;width:${salesW}mm">${salesTable}</div>`;
  return { id: '16_people_and_market', title: 'People and market', subtitle: sub, textHtml, figureHtml };
}

function emptyBox(w: number, h: number, note: string): string {
  return `<div style="width:${w}mm;height:${h}mm;border:0.15mm solid ${tpl().rule};display:flex;align-items:center;justify-content:center;font-size:2.2mm;color:#777;text-align:center;padding:0 4mm">${esc(note)}</div>`;
}

// ---- slide 06: topography ---------------------------------------------------

const CONTOUR = '#ae8d55';

/** What the terrain says about the site: levels, fall, aspect, the sections and the window's relief. */
export function terrainFacts(b: SlidesBundle) {
  const g = b.terrain.dem;
  if (!g) return null;
  const p = b.daPanel;
  const extent = panelExtent(p);
  const centre = p.center;
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const waterRings = b.base.water.features.flatMap((f) => geomRings(f.geometry));
  const plan = planSections(g, centre, extent, waterRings);
  const fallDir = plan.slope && Math.hypot(plan.slope.east, plan.slope.north) > 1e-6
    ? { x: -plan.slope.east / Math.hypot(plan.slope.east, plan.slope.north), y: -plan.slope.north / Math.hypot(plan.slope.east, plan.slope.north) }
    : null;
  const site = siteLevels(g, siteRings, fallDir);
  const sections = [plan.a, plan.b].map((s) => {
    const samples = sampleSection(g, s, siteRings, waterRings);
    const rls = samples.map((x) => x.rl);
    return { ...s, samples, from: { ...s.from }, to: { ...s.to }, rlFrom: samples[0]?.rl, rlTo: samples[samples.length - 1]?.rl, rlMin: Math.min(...rls), rlMax: Math.max(...rls), crossesWater: samples.some((x) => x.water) };
  });
  // The grade at the site: its own fall over its own length when it is big enough to measure, else the fitted plane's.
  const planePct = plan.slope ? Math.hypot(plan.slope.east, plan.slope.north) * 100 : 0;
  const slopePct = site && site.extentAlongFallM >= 10 && site.max - site.min >= 0.3 ? ((site.max - site.min) / site.extentAlongFallM) * 100 : planePct;
  const WATER_WORD = /\b(RIVER|CREEK|BAY|HARBOUR|HARBOR|LAKE|LAGOON|COVE|DAM|CANAL|POND|RESERVOIR|CHANNEL|INLET|ESTUARY|SEA|OCEAN|BASIN|WETLAND|SWAMP)\b/i;
  const waterRaw = String(b.base.water.features[0]?.properties?.hydroname ?? '');
  const elevations = [...new Set(b.terrain.contours.map((c) => c.elevation))].sort((x, y) => x - y);
  const interval = b.terrain.contourIntervalM ?? (elevations.length > 1 ? Math.min(...elevations.slice(1).map((e, i) => e - elevations[i]).filter((d) => d > 0)) : undefined);
  return {
    source: g.source,
    cellM: Math.round(g.cellX * g.groundPerUnit * 100) / 100,
    window: { minRl: g.min, maxRl: g.max, high: gridExtremes(g, centre).max, low: gridExtremes(g, centre).min },
    site,
    slope: plan.slope ? { pct: slopePct, fallBearing: fallDir ? plan.a.bearing : undefined, faces: fallDir ? bearingName(plan.a.bearing) : undefined, oneIn: slopePct > 0.05 ? Math.round(100 / slopePct) : undefined } : null,
    sections,
    water: nearestWater(waterRings, centre, g.groundPerUnit),
    waterName: WATER_WORD.test(waterRaw) ? titleCase(waterRaw) : undefined,
    contours: { count: b.terrain.contours.length, intervalM: interval, source: b.terrain.contourSource ?? 'NSW Spatial Services elevation theme', attribution: b.terrain.contourAttribution },
  };
}

export function terrainSentences(b: SlidesBundle, f: ReturnType<typeof terrainFacts>): string[] {
  if (!f) return ['The elevation model could not be read for this window when the deck was generated.'];
  const out: string[] = [];
  const rl = (v: number) => `RL ${(v > -0.5 && v < 0 ? 0 : v).toFixed(1)}`;
  if (f.site) {
    const fall = f.site.max - f.site.min;
    let s = `The site lies between ${rl(f.site.min)} and ${rl(f.site.max)} m AHD`;
    if (fall >= 0.5 && f.slope?.faces) {
      s += `, falling ${fall.toFixed(1)} m to the ${f.slope.faces}`;
      if (f.site.extentAlongFallM >= 10) s += ` across ${fmtNum(Math.round(f.site.extentAlongFallM))} m`;
      if (f.slope.oneIn) s += `, a grade of about ${f.slope.pct.toFixed(f.slope.pct < 3 ? 1 : 0)} % (1 in ${f.slope.oneIn})`;
      s += '.';
    } else s += `: near level${f.slope && f.slope.pct >= 0.3 && f.slope.faces ? `, with the ground tending to the ${f.slope.faces}` : ''}.`;
    out.push(s);
  }
  const w = f.window;
  let win = `Within the ${fmtNum(Math.round((b.daPanel.wMm / 1000) * b.daPanel.scale))} × ${fmtNum(Math.round((b.daPanel.hMm / 1000) * b.daPanel.scale))} m window the ground runs from ${rl(w.minRl)} to ${rl(w.maxRl)}: the high point is ${fmtNum(Math.round(w.high.distanceM))} m to the ${bearingName(w.high.bearing)}`;
  if (f.water) win += `, and ${f.waterName ?? 'the water'} lies ${fmtNum(Math.round(f.water.distanceM))} m to the ${bearingName(f.water.bearing)}`;
  else win += `, the low point ${fmtNum(Math.round(w.low.distanceM))} m to the ${bearingName(w.low.bearing)}`;
  out.push(`${win}.`);
  const [a, bb] = f.sections;
  if (a && bb) {
    const dir = (s: typeof a) => `${bearingName((s.bearing + 180) % 360)} to ${bearingName(s.bearing)}`;
    out.push(`Section A–A′ runs ${fmtNum(Math.round(a.lengthM))} m ${dir(a)} down the fall through the site, from ${rl(a.rlFrom ?? 0)} at A to ${a.crossesWater ? 'the water' : rl(a.rlTo ?? 0)} at A′; B–B′ crosses it, ${fmtNum(Math.round(bb.lengthM))} m ${dir(bb)}, between ${rl(bb.rlMin)} and ${rl(bb.rlMax)}.`);
  }
  out.push(`${f.contours.count ? `${/NSW|State/i.test(f.contours.source) ? `Contours at ${f.contours.intervalM ?? 2} m are the State's mapped contours` : `The contours are the ${f.contours.source}`}; ` : 'No mapped contour falls in this window; '}the hillshade, the sections and the levels come from the 5 m elevation model at ${f.cellM} m cells, a photogrammetric surface and not a survey: read its levels as indicative to about a metre.`);
  return out;
}

export function terrainSlide(b: SlidesBundle): Slide {
  const f = terrainFacts(b);
  const t = tpl();
  const sentences = terrainSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the fall means for levels, access and views, where the building meets the ground, how the section reads against the neighbours and the ridge or the water, and whether cut, fill or a split level is the answer.') +
    `<div class="fine">Sources: NSW 5 m elevation model (stereo imagery, DFSI 2019) via SIX Maps; contours from ${esc(f?.contours.source ?? 'NSW Spatial Services')}${f?.contours.attribution ? ` (${esc(f.contours.attribution)})` : ''}; roads, rail and cadastre from NSW Spatial Services. Levels in metres AHD. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f?.site ? `RL ${f.site.min.toFixed(1)}–${f.site.max.toFixed(1)}` : '', f?.slope?.faces && f.site && f.site.max - f.site.min >= 0.5 ? `falls to the ${f.slope.faces}` : ''].filter(Boolean).join(' · ');
  if (!f || !b.terrain.dem) {
    return { id: '06_topography', title: 'Topography', subtitle: sub, textHtml,
      figureHtml: `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">Elevation unavailable<span class="pnote">the 5 m elevation model did not answer for this window</span></div>` };
  }
  const g = b.terrain.dem;
  const p = b.daPanel;
  const proj = panelProjector(p);
  const mproj = (x: number, y: number) => proj(mercatorToLonLat({ x, y }).lon, mercatorToLonLat({ x, y }).lat);

  // The map: hillshade, water, contours, roads and the site, the section lines.
  const parts: string[] = [];
  parts.push(`<image x="0" y="0" width="${p.wMm}" height="${p.hMm}" preserveAspectRatio="none" opacity="0.72" href="${hillshadeDataUri(g)}"/>`);
  if (b.base.water.features.length) parts.push(`<path d="${fcPath(b.base.water, proj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  const elevations = [...new Set(b.terrain.contours.map((c) => c.elevation))].sort((x, y) => x - y);
  const interval = f.contours.intervalM ?? 2;
  const indexEvery = interval >= 10 ? 5 * interval : interval * 5;
  const labels: string[] = [];
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  for (const c of b.terrain.contours) {
    const index = Math.abs(c.elevation / indexEvery - Math.round(c.elevation / indexEvery)) < 1e-6;
    parts.push(`<path d="${ringsPath([c.coords as number[][]], proj, false)}" fill="none" stroke="${CONTOUR}" stroke-width="${index ? 0.32 : 0.16}" stroke-opacity="${index ? 0.95 : 0.7}" stroke-linejoin="round"/>`);
    if (index && c.coords.length > 6) {
      // label the index contour once, near its middle, where there is room
      const mid = c.coords[Math.floor(c.coords.length / 2)];
      const [x, y] = proj(mid[0], mid[1]);
      const text = `${c.elevation}`;
      if (x > 4 && y > 4 && x < p.wMm - 4 && y < p.hMm - 4 && spacer.take(x, y, labelW(text, 1.9) + 1, 2.4))
        labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.65).toFixed(1)}" text-anchor="middle" font-size="1.9" font-weight="600" fill="${CONTOUR}" stroke="#ffffff" stroke-width="0.45" paint-order="stroke">${text}</text>`);
    }
  }
  parts.push(labels.join(''));
  parts.push(overLayers(b.base, proj, p));
  // section lines with their end marks
  for (const s of f.sections) {
    const [x1, y1] = mproj(s.from.x, s.from.y), [x2, y2] = mproj(s.to.x, s.to.y);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-width="1.1" stroke-opacity="0.85"/>` +
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${t.dimension}" stroke-width="0.4" stroke-dasharray="2.2,1.1"/>`);
    for (const [x, y, text] of [[x1, y1, s.id], [x2, y2, `${s.id}′`]] as [number, number, string][])
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#ffffff" stroke="${t.dimension}" stroke-width="0.35"/><text x="${x.toFixed(1)}" y="${(y + 0.9).toFixed(1)}" text-anchor="middle" font-size="2.4" font-weight="600" fill="${t.dimension}">${esc(text)}</text>`);
  }
  parts.push(panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-topo"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-topo)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right of the map: the figures, the legend, section B–B′.
  const rightX = AUX_X, rightW = AUX_W;
  const tiles = [
    { v: f.site ? `${f.site.min.toFixed(1)}–${f.site.max.toFixed(1)}` : '—', l: 'RL range of the site, m AHD' },
    { v: f.site ? `${(f.site.max - f.site.min).toFixed(1)} m` : '—', l: f.slope?.faces && f.site && f.site.max - f.site.min >= 0.5 ? `fall across the site, to the ${f.slope.faces}` : 'fall across the site' },
    { v: f.slope ? `${f.slope.pct.toFixed(f.slope.pct < 3 ? 1 : 0)} %` : '—', l: f.slope?.oneIn ? `grade at the site (1 in ${f.slope.oneIn})` : 'grade at the site' },
    { v: `${Math.max(0, Math.round(f.window.minRl))}–${Math.round(f.window.maxRl)}`, l: 'RL range of the window' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const legend = [
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="#d8cfc0"/><rect x="0" y="0.3" width="2.5" height="3" fill="#ececec"/></svg>`, 'Hillshade from the 5 m elevation model, lit from the north-west'],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><line x1="0" y1="2.6" x2="5" y2="2.6" stroke="${CONTOUR}" stroke-width="0.2"/><line x1="0" y1="1.2" x2="5" y2="1.2" stroke="${CONTOUR}" stroke-width="0.4"/></svg>`, `Contours at ${interval} m, every ${indexEvery} m heavier and labelled`],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${t.dimension}" stroke-width="0.4" stroke-dasharray="1.4,0.7"/></svg>`, 'Section lines A–A′ (down the fall) and B–B′ (across it)'],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="${t.water}"/></svg>`, 'Water'],
  ].map(([sw, txt]) => `<div class="lg">${sw}<span>${esc(txt)}</span></div>`).join('');
  const secB = f.sections[1] ? sectionSvg({ w: rightW, h: 60, font: t.font, samples: f.sections[1].samples, from: 'B', to: 'B′', siteColour: t.site, waterColour: t.water }) : { svg: '', ve: 1 };
  const secA = f.sections[0] ? sectionSvg({ w: FIELD_W, h: 96, font: t.font, samples: f.sections[0].samples, from: 'A', to: 'A′', siteColour: t.site, waterColour: t.water }) : { svg: '', ve: 1 };
  const secTitle = (s: (typeof f.sections)[number], ve: number) => `Section ${s.id}–${s.id}′<span class="pnote">${bearingName((s.bearing + 180) % 360)} to ${bearingName(s.bearing)} · ${fmtNum(Math.round(s.lengthM))} m · RL ${s.rlMin.toFixed(0)} to ${s.rlMax.toFixed(0)} · vertical exaggeration ${ve % 1 ? ve.toFixed(1) : ve}×</span>`;
  const yB = FIELD_Y + PANEL_TITLE_H + 52;
  const yA = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Landform<span class="pnote">1:${fmtNum(p.scale)} · hillshade, contours, sections</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles two" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 30}mm;width:${rightW}mm">${legend}</div>
    ${f.sections[1] ? `<div class="abs ptitle" style="left:${rightX}mm;top:${yB}mm;width:${rightW}mm">${secTitle(f.sections[1], secB.ve)}</div>
    <div class="abs" style="left:${rightX}mm;top:${yB + PANEL_TITLE_H}mm">${secB.svg}</div>` : ''}
    ${f.sections[0] ? `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${yA}mm;width:${FIELD_W}mm">${secTitle(f.sections[0], secA.ve)}</div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yA + PANEL_TITLE_H}mm">${secA.svg}</div>` : ''}`;
  return { id: '06_topography', title: 'Topography', subtitle: sub, textHtml, figureHtml };
}

/** A picture of the elevation grid placed on a map by the grid's corners, as it is. */
function demPicture(g: DemGrid, proj: Proj, href: string): string {
  const nw = mercatorToLonLat({ x: g.xmin, y: g.ymax }), se = mercatorToLonLat({ x: g.xmax, y: g.ymin });
  const [x0, y0] = proj(nw.lon, nw.lat), [x1, y1] = proj(se.lon, se.lat);
  return `<image x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${(x1 - x0).toFixed(2)}" height="${(y1 - y0).toFixed(2)}" preserveAspectRatio="none" href="${href}"/>`;
}

const SECTION_AX = 11;
/** A section of the ground after the template: the scale chosen to fill the column, the heights stretched where the relief is slight, the ground in poché, the site's run in red. */
function groundSection(sec: SectionLine, from: string, to: string, ink: string, maxH = 44, fixedVe?: number): { svg: string; scale: number; ve: number } | null {
  const s = sec.samples;
  if (s.length < 2) return null;
  const L = sec.lengthM, AX = SECTION_AX;
  const scale = Math.round((L * 1000) / (Z_W - AX));
  const sx = (Z_W - AX) / L;
  const rls = s.map((q) => q.rl), lo = Math.min(...rls), hi = Math.max(...rls), relief = Math.max(1, hi - lo);
  const ve = fixedVe ?? [1, 2, 5, 10, 20, 25, 50].filter((v) => relief * sx * v <= Math.min(26, maxH - 16)).pop() ?? 1;
  const sy = sx * ve, TOP = 9.5, POCHE = 3;
  const X = (d: number) => AX + d * sx, Y = (rl: number) => TOP + (hi - rl) * sy;
  const base = Y(lo) + POCHE;
  const g: string[] = [];
  const stepRl = [1, 2, 5, 10, 20, 50].find((st) => relief / st <= 4) ?? 50;
  for (let v = Math.ceil(lo / stepRl) * stepRl; v <= hi + 1e-9; v += stepRl) {
    g.push(`<line x1="${AX}" y1="${Y(v).toFixed(2)}" x2="${Z_W}" y2="${Y(v).toFixed(2)}" stroke="#878787" stroke-width="0.18" stroke-linecap="round" stroke-dasharray="0 0.36"/>`);
    g.push(z6(0, Y(v) - 1.1, `RL ${v}`));
  }
  const line = s.map((q, i) => `${i ? 'L' : 'M'}${X(q.d).toFixed(2)},${Y(q.rl).toFixed(2)}`).join('');
  g.push(fillShape(`${line}L${X(L).toFixed(2)},${base.toFixed(2)}L${X(0).toFixed(2)},${base.toFixed(2)}Z`, { x0: X(0), y0: TOP, x1: X(L), y1: base }, { bg: '#ffffff', kind: 'hlines', ink, step: 0.5, w: 0.1 }));
  g.push(`<path d="${line}" fill="none" stroke="#000000" stroke-width="0.25" stroke-linejoin="round"/>`);
  const run = s.filter((q) => q.site);
  if (run.length) {
    g.push(`<path d="${run.map((q, i) => `${i ? 'L' : 'M'}${X(q.d).toFixed(2)},${Y(q.rl).toFixed(2)}`).join('')}" fill="none" stroke="${tpl().site}" stroke-width="1.1" stroke-linecap="butt"/>`);
    const mid = run[Math.floor(run.length / 2)];
    g.push(`<line x1="${X(mid.d).toFixed(2)}" y1="3.6" x2="${X(mid.d).toFixed(2)}" y2="${(Y(mid.rl) - 1).toFixed(2)}" stroke="${tpl().site}" stroke-width="0.18"/>`);
    g.push(z6(X(mid.d) + 1, 0.4, `the site · RL ${mid.rl.toFixed(1)}`));
  }
  g.push(z6(X(0), base + 1.2, from), z6(X(L), base + 1.2, to, 'end'));
  const step = [50, 100, 200, 250, 500, 1000].find((st) => L / st <= 6) ?? 1000;
  for (let d = step; d < L - step / 3; d += step) g.push(z6(X(d), base + 1.2, `${fmtNum(d)} m`, 'middle'));
  return { svg: zSvg(base + 4.4, g.join('')), scale, ve };
}

/** Topography on the template: the ground in sage — hillshade, contours, the two sections. */
export function topographyAtlas(b0: SlidesBundle): Slide {
  const p = b0.bleedPanel;
  const b: SlidesBundle = { ...b0, panel: p, daPanel: p };
  const t = tpl();
  const S = INK.sage;
  const f = terrainFacts(b);
  const g = b.terrain.dem;
  const sub = atlasSub(b0, f?.site ? `RL ${f.site.min.toFixed(1)}–${f.site.max.toFixed(1)}` : '', f?.slope?.faces && f.site && f.site.max - f.site.min >= 0.5 ? `falls to the ${f.slope.faces}` : '');
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#ffffff"/>`];
  // a monochrome topographic map: the ground in sage bands every 5 m, the hillshade multiplied over it, the contours
  // one scale for both sections, the shorter filling the column and the longer cropped to it
  const secScale = Math.min(...(f?.sections ?? []).map((s) => fillScale(s.lengthM, Z_W - SECTION_AX)));
  const sections = (f?.sections ?? []).map((s) => cropSection(s, secScale, Z_W - SECTION_AX));
  if (g && f) {
    const lo = Math.floor(Math.max(0, f.window.minRl) / 5) * 5, hi = Math.ceil(f.window.maxRl / 5) * 5;
    parts.push(demPicture(g, proj, reliefDataUri(g, S.deep, { stepM: 5, lo, hi })));
  }
  if (b.base.water.features.length) parts.push(`<path d="${fcPath(b.base.water, proj)}" fill="#ffffff" stroke="${S.deep}" stroke-width="0.2" fill-rule="evenodd"/>`);
  const interval = f?.contours.intervalM ?? 2;
  const indexEvery = interval >= 10 ? 5 * interval : interval * 5;
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const minor: string[] = [], major: string[] = [], labels: string[] = [];
  for (const c of b.terrain.contours) {
    const index = Math.abs(c.elevation / indexEvery - Math.round(c.elevation / indexEvery)) < 1e-6;
    (index ? major : minor).push(ringsPath([c.coords as number[][]], proj, false));
    if (index && c.coords.length > 6) {
      const mid = c.coords[Math.floor(c.coords.length / 2)];
      const [x, y] = proj(mid[0], mid[1]);
      const text = `${c.elevation}`;
      if (x > 4 && y > 4 && x < p.wMm - 4 && y < p.hMm - 4 && spacer.take(x, y, text.length * 1.6 + 1, 2.6)) labels.push(m6(x, y, text));
    }
  }
  parts.push(`<path d="${minor.join('')}" fill="none" stroke="#4f4f40" stroke-width="0.1" stroke-opacity="0.7" stroke-linejoin="round"/>`);
  parts.push(`<path d="${major.join('')}" fill="none" stroke="#4f4f40" stroke-width="0.28" stroke-linejoin="round"/>`);
  // the streets and the rail as a topographic map draws them: faint, one ink
  parts.push(withTemplate({ ...gt, road: '#b9b9a6', rail: '#8f8f7c', transit: '#8f8f7c', busRoute: '#b9b9a6' }, () => overLayers(b.base, proj, p, 'none')));
  const mproj = (m: XY) => { const l = mercatorToLonLat(m); return proj(l.lon, l.lat); };
  for (const s of sections) {
    const [x1, y1] = mproj(s.from), [x2, y2] = mproj(s.to);
    parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#000000" stroke-width="0.25" stroke-dasharray="2.4 0.8 0.4 0.8"/>`);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    for (const [x, y, sg, text] of [[x1, y1, -1, s.id], [x2, y2, 1, `${s.id}′`]] as [number, number, number, string][]) {
      const lx = Math.min(p.wMm - 4, Math.max(4, x + sg * ux * 3)), ly = Math.min(p.hMm - 4, Math.max(4, y + sg * uy * 3));
      spacer.take(lx, ly, 4, 3); labels.push(m6(lx, ly, text));
    }
  }
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('topo06', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    { swatch: `<rect x="0" y="0.6" width="1.7" height="2.4" fill="${S.light}"/><rect x="1.7" y="0.6" width="1.7" height="2.4" fill="${S.solid}"/><rect x="3.4" y="0.6" width="1.6" height="2.4" fill="${S.deep}"/>`, label: 'The ground in bands of 5 m, darker up the slope; hillshade lit from the north-west' },
    { swatch: `<line x1="0" y1="2.6" x2="5" y2="2.6" stroke="${S.deep}" stroke-width="0.15"/><line x1="0" y1="1.1" x2="5" y2="1.1" stroke="${S.deep}" stroke-width="0.4"/>`, label: `Contours every ${interval} m, every ${indexEvery} m heavier and numbered` },
    { swatch: `<path d="M0,1.8H5" stroke="#000000" stroke-width="0.25" stroke-dasharray="2.4 0.8 0.4 0.8"/>`, label: 'Section lines: A–A′ down the fall, B–B′ across it' },
    SITE_KEY(t),
  ];
  const limit = keyTop(legend.length) - 6;
  const blocks: string[] = [];
  let y = 44;
  if (f) {
    const figs = zFigures([
      ['the site, m AHD', f.site ? `RL ${f.site.min.toFixed(1)}–${f.site.max.toFixed(1)}` : '—'],
      ['fall across the site', f.site ? `${(f.site.max - f.site.min).toFixed(1)} m${f.slope?.faces ? ` to the ${f.slope.faces}` : ''}` : '—'],
      ['grade at the site', f.slope ? `${f.slope.pct.toFixed(f.slope.pct < 3 ? 1 : 0)} %${f.slope.oneIn ? ` · 1 in ${f.slope.oneIn}` : ''}` : '—'],
    ], [
      ['the page, m AHD', `RL ${Math.max(0, Math.round(f.window.minRl))}–${Math.round(f.window.maxRl)}`],
      ['the high point', `RL ${f.window.high.rl.toFixed(1)} · ${fmtNum(Math.round(f.window.high.distanceM / 10) * 10)} m ${bearingName(f.window.high.bearing)}`],
      ['the low point', `RL ${f.window.low.rl.toFixed(1)} · ${fmtNum(Math.round(f.window.low.distanceM / 10) * 10)} m ${bearingName(f.window.low.bearing)}`],
    ], 9.6);
    blocks.push(zBlock('The site', figs, 'The page'));
    y += blockH(6.3 + 3 * 9.6);
    // and one vertical exaggeration: the largest both sections' relief allows in their room
    const roomEach = (limit - y) / Math.max(1, sections.length) - 6.21 - 7.5;
    const sxC = 1000 / secScale;
    const commonVe = [1, 2, 5, 10, 20, 25, 50].filter((v) => sections.every((s) => { const r = s.samples.map((q) => q.rl); return Math.max(1, Math.max(...r) - Math.min(...r)) * sxC * v <= Math.min(26, roomEach - 16); })).pop() ?? 1;
    for (const [i, s] of sections.entries()) {
      const room = (limit - y) / (sections.length - i) - 6.21 - 7.5;
      const sec = groundSection(s, s.id, `${s.id}′`, S.deep, room, commonVe);
      if (!sec) continue;
      const head = `Section ${s.id}–${s.id}′ · ${bearingName((s.bearing + 180) % 360)} to ${bearingName(s.bearing)} · 1:${fmtNum(sec.scale).replace(',', ' ')}${sec.ve > 1 ? ` · heights ×${sec.ve}` : ''}`;
      blocks.push(zBlock(head, sec.svg));
      y += blockH(room);
    }
  }
  const sources = `Sources: NSW 5 m elevation model (stereo imagery, DFSI 2019) via SIX Maps; contours from ${f?.contours.source ?? 'NSW Spatial Services'}${f?.contours.attribution ? ` (${f.contours.attribution})` : ''}; roads, rail and cadastre from NSW Spatial Services. Levels in metres AHD, indicative to about a metre. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  return { id: '06_topography', title: 'Topography', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Landform', p, zFlow(blocks)), bleed: true, sources, accent: S.text, legend,
    narrative: brief(f ? [terrainSentences(b, f)[0], `On the map the ground runs from RL ${Math.round(f.window.minRl)} to RL ${Math.round(f.window.maxRl)}; the high point is ${fmtNum(Math.round(f.window.high.distanceM / 10) * 10)} m to the ${bearingName(f.window.high.bearing)}.`] : ['The elevation model did not answer for this run.']) };
}

// ---- slide 08: built form ----------------------------------------------------

/** Height bands by storeys, on the sequential blue ramp; no height is a neutral grey. */
const HEIGHT_BANDS: { label: string; maxM: number; fill: string }[] = [
  { label: '1–2 storeys', maxM: 7.5, fill: '#d6e7e0' },
  { label: '3–4', maxM: 14, fill: '#a8cdc2' },
  { label: '5–8', maxM: 27, fill: '#6ba998' },
  { label: '9–15', maxM: 50, fill: '#35766a' },
  { label: '16 and more', maxM: Infinity, fill: '#1f4a40' },
];
const NO_HEIGHT_FILL = '#ddd5c6';
const bandOf = (h?: number) => (h ? HEIGHT_BANDS.find((b) => h <= b.maxM)! : null);
const storeysOf = (h: number) => Math.max(1, Math.round(h / METRES_PER_STOREY));

export function builtFormFacts(b: SlidesBundle, planning: PlanningFacts) {
  const data = b.buildings;
  const all = data.buildings;
  const centre = b.daPanel.center;
  const k = mercatorScaleFactor(mercatorToLonLat(centre).lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const dist = (bd: Building) => { const m = toM(bd.centroid[0], bd.centroid[1]); return Math.hypot(m.x - centre.x, m.y - centre.y) / k; };
  const bearing = (bd: Building) => { const m = toM(bd.centroid[0], bd.centroid[1]); return ((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360; };
  const withHeight = all.filter((x) => x.estimatedHeightM);
  const onSite = all.filter((x) => siteRings.some((r) => pointInRing(x.centroid[0], x.centroid[1], r)));
  const near = all.filter((x) => dist(x) <= 250 && !onSite.includes(x));
  const nearHeights = near.map((x) => x.estimatedHeightM!).filter(Boolean).sort((p, q) => p - q);
  const medianNearM = nearHeights.length ? nearHeights[Math.floor(nearHeights.length / 2)] : undefined;
  const storeyCounts = new Map<number, number>();
  for (const h of nearHeights) { const st = Math.min(20, storeysOf(h)); storeyCounts.set(st, (storeyCounts.get(st) ?? 0) + 1); }
  const tallest = [...withHeight].sort((p, q) => q.estimatedHeightM! - p.estimatedHeightM!).slice(0, 5)
    .map((x) => ({ name: x.name, heightM: x.estimatedHeightM!, storeys: x.floors ?? storeysOf(x.estimatedHeightM!), from: x.heightFrom, distanceM: Math.round(dist(x)), bearing: bearing(x) }));
  const neighbours = all.filter((x) => !onSite.includes(x) && dist(x) <= 45).sort((p, q) => dist(p) - dist(q)).slice(0, 4)
    .map((x) => ({ name: x.name, heightM: x.estimatedHeightM, storeys: x.estimatedHeightM ? (x.floors ?? storeysOf(x.estimatedHeightM)) : undefined, from: x.heightFrom, distanceM: Math.round(dist(x)), bearing: bearing(x), kind: x.kind }));
  // The footprints still without a height: the zones they stand in and the height limits over them (as far as the planning window reaches) bound them without inventing a height.
  const unknown = all.filter((x) => !x.estimatedHeightM);
  const zonePolys = b.zoning.features.map((f) => ({ code: String(f.properties.SYM_CODE ?? '?'), name: String(f.properties.LAY_CLASS ?? ''), rings: geomRings(f.geometry) }));
  const hobPolys = b.hob.features.filter((f) => Number(f.properties.MAX_B_H) > 0 && !/RL/i.test(String(f.properties.UNITS ?? ''))).map((f) => ({ m: Number(f.properties.MAX_B_H), rings: geomRings(f.geometry) }));
  const zoneCounts = new Map<string, { code: string; name: string; count: number }>();
  const ceilingCounts = new Map<number, number>();
  for (const x of unknown) {
    const [lon, lat] = x.centroid;
    const z = zonePolys.find((zp) => zp.rings.some((r) => pointInRing(lon, lat, r)));
    if (z) { const e = zoneCounts.get(z.code) ?? { code: z.code, name: z.name, count: 0 }; e.count++; zoneCounts.set(z.code, e); }
    const hc = hobPolys.find((hp) => hp.rings.some((r) => pointInRing(lon, lat, r)));
    if (hc) ceilingCounts.set(hc.m, (ceilingCounts.get(hc.m) ?? 0) + 1);
  }
  const unknownZones = [...zoneCounts.values()].sort((p, q) => q.count - p.count).slice(0, 3);
  const unknowns = {
    count: unknown.length,
    zones: unknownZones, zonesShare: unknown.length ? unknownZones.reduce((s, z) => s + z.count, 0) / unknown.length : 0,
    ceilings: [...ceilingCounts.entries()].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([m, count]) => ({ m, storeys: Math.max(1, Math.floor(m / METRES_PER_STOREY)), count })),
  };
  // The LEP height plane over the site's ground.
  const site = b.terrain.dem ? siteLevels(b.terrain.dem, siteRings, null) : null;
  const hob = planning.hobAtSite;
  let envelope: { label: string; topRl?: number; aboveGroundM?: number; storeys?: number } | null = null;
  if (hob) {
    if (hob.rl) {
      const above = site ? hob.value - site.mean : undefined;
      envelope = { label: hob.label, topRl: hob.value, aboveGroundM: above, storeys: above && above > 0 ? Math.max(1, Math.floor(above / METRES_PER_STOREY)) : undefined };
    } else envelope = { label: hob.label, topRl: site ? site.mean + hob.value : undefined, aboveGroundM: hob.value, storeys: Math.max(1, Math.floor(hob.value / METRES_PER_STOREY)) };
  }
  return {
    source: data.source, release: data.release, note: data.note,
    count: all.length,
    measured: all.filter((x) => x.heightFrom === 'measured').length,
    fromStoreys: all.filter((x) => x.heightFrom === 'floors').length,
    fromDa: all.filter((x) => x.heightFrom === 'da').length,
    bands: HEIGHT_BANDS.map((bd) => ({ label: bd.label, count: withHeight.filter((x) => bandOf(x.estimatedHeightM) === bd).length })).concat([{ label: 'no height', count: all.length - withHeight.length }]),
    unknowns,
    near: { radiusM: 250, count: near.length, withHeight: nearHeights.length, medianM: medianNearM, medianStoreys: medianNearM ? storeysOf(medianNearM) : undefined,
      above8: nearHeights.filter((h) => storeysOf(h) > 8).length, storeys: [...storeyCounts.entries()].sort((p, q) => p[0] - q[0]).map(([st, n]) => ({ storeys: st, count: n })) },
    tallest, neighbours,
    onSite: onSite.map((x) => ({ name: x.name, heightM: x.estimatedHeightM, storeys: x.estimatedHeightM ? (x.floors ?? storeysOf(x.estimatedHeightM)) : undefined, from: x.heightFrom, kind: x.kind })),
    siteGroundRl: site?.mean, envelope,
  };
}

export function builtFormSentences(b: SlidesBundle, f: ReturnType<typeof builtFormFacts>): string[] {
  const out: string[] = [];
  const src = f.source === 'overture' ? `Overture Maps${f.release ? ` (release ${f.release})` : ''}` : f.source === 'osm' ? 'OpenStreetMap' : '';
  if (!f.count) return [`No building footprints could be read for this window when the deck was generated${f.note ? ` (${f.note})` : ''}.`];
  const known = f.measured + f.fromStoreys + f.fromDa;
  const from = [
    f.measured ? `${fmtNum(f.measured)} measured` : '',
    f.fromStoreys ? `${fmtNum(f.fromStoreys)} from a storey count at ${METRES_PER_STOREY} m a storey` : '',
    f.fromDa ? `${fmtNum(f.fromDa)} from the storeys of a determined development application on the lot (slide 07), hatched on the map` : '',
  ].filter(Boolean);
  out.push(`The window holds ${fmtNum(f.count)} buildings from ${src}; ${known ? `${fmtPct(pct(known, f.count))} carry a height: ${listWords(from)}` : 'none carries a height'}.`);
  if (f.unknowns.count) {
    const u = f.unknowns;
    const cap = (c: { m: number; storeys: number; count: number }, first: boolean) => `${fmtNum(c.count)} under ${first ? 'a height limit of ' : ''}${fmtNum(c.m, c.m % 1 ? 1 : 0)} m (${numWord(c.storeys)} storey${c.storeys === 1 ? '' : 's'} at most)`;
    const bounds = u.ceilings.length ? `; ${u.ceilings.map((c, i) => cap(c, i === 0)).join(' and ')}` : '';
    const zones = u.zones.length ? `${bounds ? ',' : ';'} ${u.zonesShare >= 0.5 ? 'mostly' : 'among them'} in ${listWords(u.zones.map((z) => `${z.code}${z.name ? ` ${z.name}` : ''} (${fmtNum(z.count)})`))}` : '';
    out.push(`The ${fmtNum(u.count)} without a height are drawn grey${bounds}${zones}.`);
  }
  if (f.near.withHeight) {
    let s = `Within ${f.near.radiusM} m of the site the typical building is ${f.near.medianStoreys} storey${f.near.medianStoreys === 1 ? '' : 's'} (median of ${fmtNum(f.near.withHeight)} with a height)`;
    if (f.near.above8) s += `; ${fmtPct(pct(f.near.above8, f.near.withHeight))} rise above eight storeys`;
    s += '.';
    if (f.tallest[0]) { const t0 = f.tallest[0]; s += ` The tallest with a recorded height in the window is ${t0.name ?? 'a building'} ${fmtNum(Math.round(t0.distanceM))} m to the ${bearingName(t0.bearing)}, ${Math.round(t0.heightM)} m (${t0.storeys} storeys${t0.from === 'measured' ? '' : t0.from === 'da' ? ', the storeys of a DA on the lot' : ', from its storey count'}).`; }
    out.push(s);
  }
  if (f.onSite.length) {
    const withH = f.onSite.filter((x) => x.heightM);
    const n = f.onSite.length;
    const list = withH.map((x) => `${x.storeys} storey${x.storeys === 1 ? '' : 's'} (${Math.round(x.heightM!)} m${x.from === 'da' ? ', the storeys of a determined DA on the lot' : ''})`).join(', ');
    out.push(!withH.length
      ? `The site carries ${n === 1 ? 'a building' : `${n} buildings`} with no recorded height.`
      : n === 1 ? `The site carries a building of ${list}.`
      : withH.length === n ? `The site carries ${n} buildings of ${list}.`
      : `The site carries ${n} buildings, ${withH.length === 1 ? 'one' : withH.length} with a recorded height: ${list}.`);
  }
  if (f.envelope) {
    const e = f.envelope;
    if (e.aboveGroundM !== undefined && f.siteGroundRl !== undefined)
      out.push(e.topRl !== undefined && /RL/i.test(e.label)
        ? `The LEP height of building at the site is ${e.label}: ${e.aboveGroundM > 0 ? `${e.aboveGroundM.toFixed(1)} m above the site's mean ground level of RL ${f.siteGroundRl.toFixed(1)}, about ${e.storeys} storey${e.storeys === 1 ? '' : 's'}` : 'at or below the site\'s ground level of RL ' + f.siteGroundRl.toFixed(1)}.`
        : `The LEP height of building at the site is ${e.label} above ground, about ${e.storeys} storey${e.storeys === 1 ? '' : 's'}${e.topRl !== undefined ? `, a top of about RL ${e.topRl.toFixed(1)} on the site's mean ground of RL ${f.siteGroundRl.toFixed(1)}` : ''}.`);
    else out.push(`The LEP height of building at the site is ${e.label}.`);
  } else out.push('No height of building control is mapped at the site.');
  if (f.neighbours.length) {
    const parts = f.neighbours.map((n) => `${n.name ? n.name : 'a building'} ${n.distanceM} m to the ${bearingName(n.bearing)}${n.heightM ? `, ${n.storeys} storey${n.storeys === 1 ? '' : 's'} (${Math.round(n.heightM)} m${n.from === 'da' ? ', DA' : ''})` : ', height unknown'}`);
    out.push(`Nearest neighbours: ${parts.join('; ')}.`);
  }
  return out;
}

export function builtFormSlide(b: SlidesBundle, planning: PlanningFacts): Slide {
  const f = builtFormFacts(b, planning);
  const t = tpl();
  const sentences = builtFormSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the surrounding scale is and where it is changing, how the height plane at the site compares with the neighbours and the approvals of slide 07, which frontages and setbacks the fabric suggests, and where the 3D model views should look from.') +
    `<div class="fine">Sources: ${f.source === 'overture' ? 'Overture Maps Foundation buildings (footprints and heights from OpenStreetMap, Microsoft, Esri Community Maps and Google Open Buildings; ODbL and CDLA Permissive 2.0)' : f.source === 'osm' ? 'OpenStreetMap contributors (ODbL)' : 'no building source answered'}; heights measured or ${METRES_PER_STOREY} m a storey, else the storeys of a determined application on the lot from the NSW Planning Portal's Online DA API; the LEP height of building from the ePlanning layer, converted with the 5 m elevation model where it is a reduced level. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f.envelope ? `HOB ${f.envelope.label}` : 'no HOB mapped', f.near.medianStoreys ? `neighbourhood median ${f.near.medianStoreys} storeys` : ''].filter(Boolean).join(' · ');
  const p = b.daPanel;
  const proj = panelProjector(p);
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#ffffff"/>`);
  if (b.base.water.features.length) parts.push(`<path d="${fcPath(b.base.water, proj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  // Footprints, palest first so the tall ones sit on top where they overlap.
  const drawn = [...b.buildings.buildings].sort((x, y) => (x.estimatedHeightM ?? 0) - (y.estimatedHeightM ?? 0));
  for (const bd of drawn) {
    const band = bandOf(bd.estimatedHeightM);
    parts.push(`<path d="${ringsPath(bd.rings, proj)}" fill="${band ? band.fill : NO_HEIGHT_FILL}" fill-rule="evenodd" stroke="#ffffff" stroke-width="0.08"/>`);
  }
  // The footprints whose storeys come from an application on the lot wear a white hatch over their band.
  const fromDa = drawn.filter((bd) => bd.heightFrom === 'da');
  if (fromDa.length) parts.push(`<path d="${fromDa.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="url(#da-hatch)" fill-rule="evenodd"/>`);
  parts.push(overLayers(b.base, proj, p, 'outline'));
  // The A–A′ section line, as on the topography slide.
  const terrain = terrainFacts(b);
  const secA = terrain?.sections[0];
  if (secA) {
    const ll = (xy: { x: number; y: number }) => { const l = mercatorToLonLat(xy); return proj(l.lon, l.lat); };
    const [x1, y1] = ll(secA.from), [x2, y2] = ll(secA.to);
    parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ffffff" stroke-width="1.1" stroke-opacity="0.85"/>` +
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${t.dimension}" stroke-width="0.4" stroke-dasharray="2.2,1.1"/>`);
    for (const [x, y, text] of [[x1, y1, 'A'], [x2, y2, 'A′']] as [number, number, string][])
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#ffffff" stroke="${t.dimension}" stroke-width="0.35"/><text x="${x.toFixed(1)}" y="${(y + 0.9).toFixed(1)}" text-anchor="middle" font-size="2.4" font-weight="600" fill="${t.dimension}">${esc(text)}</text>`);
  }
  parts.push(panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-built"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath><pattern id="da-hatch" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1" stroke="#ffffff" stroke-width="0.3"/></pattern></defs>
    <g clip-path="url(#clip-built)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, legend, the storeys of the neighbourhood against the height plane.
  const rightX = AUX_X, rightW = AUX_W;
  const known = f.measured + f.fromStoreys + f.fromDa;
  const tiles = [
    { v: fmtNum(f.count), l: 'buildings in the window' },
    { v: f.count ? fmtPct(pct(known, f.count)) : '—', l: f.fromDa ? 'with a height: measured, from storeys or from a DA' : 'with a height, measured or from storeys' },
    { v: f.near.medianStoreys ? `${f.near.medianStoreys}` : '—', l: `storeys, median within ${f.near.radiusM} m of the site` },
    { v: f.envelope ? (f.envelope.storeys ? `${f.envelope.storeys}` : '—') : '—', l: f.envelope ? `storeys within the LEP height plane (${f.envelope.label})` : 'no height of building control mapped' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const legend = HEIGHT_BANDS.map((bd, i) => `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="${bd.fill}"/></svg><span>${esc(bd.label)} · ${fmtNum(f.bands[i].count)}</span></div>`).join('') +
    (f.fromDa ? `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><defs><pattern id="da-hatch-lg" patternUnits="userSpaceOnUse" width="1" height="1" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1" stroke="#ffffff" stroke-width="0.3"/></pattern></defs><rect x="0" y="0.3" width="5" height="3" fill="${HEIGHT_BANDS[1].fill}"/><rect x="0" y="0.3" width="5" height="3" fill="url(#da-hatch-lg)"/></svg><span>hatched: storeys from a determined DA on the lot · ${fmtNum(f.fromDa)}</span></div>` : '') +
    `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="${NO_HEIGHT_FILL}"/></svg><span>no height known · ${fmtNum(f.bands[5].count)}</span></div>`;
  const maxSt = Math.max(1, ...f.near.storeys.map((s) => s.storeys), f.envelope?.storeys ?? 0);
  const hist = Array.from({ length: Math.min(20, maxSt) }, (_, i) => { const st = i + 1; const n = f.near.storeys.find((s) => s.storeys === st)?.count ?? 0; return { label: st === 20 ? '20+' : String(st), value: n, text: n ? String(n) : '' }; });
  const histSvg = f.near.withHeight ? columns({ w: rightW, h: 46, font: t.font, values: hist,
    marker: f.envelope?.storeys ? { index: Math.min(19, f.envelope.storeys - 1), label: `LEP ${f.envelope.label}`, colour: t.site } : undefined }) : emptyBox(rightW, 46, 'no building heights within 250 m');

  // Bottom: section A–A′ with the buildings it meets and the height plane over the site.
  let sectionHtml = '';
  if (secA && b.terrain.dem) {
    const samples = secA.samples;
    const L = secA.lengthM;
    const at = (d: number) => { const fr = d / L; const x = secA.from.x + (secA.to.x - secA.from.x) * fr, y = secA.from.y + (secA.to.y - secA.from.y) * fr; return mercatorToLonLat({ x, y }); };
    const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
    // Which building each sample sits in, by centroid proximity first, then the ring test.
    const blocks: NonNullable<Parameters<typeof sectionSvg>[0]['blocks']> = [];
    let current: { bd: Building; d0: number; rls: number[] } | null = null;
    const flush = (dEnd: number) => {
      if (!current) return;
      const h = current.bd.estimatedHeightM;
      const ground = Math.min(...current.rls);
      const onSite = siteRings.some((r) => pointInRing(current!.bd.centroid[0], current!.bd.centroid[1], r));
      blocks.push({ d0: current.d0, d1: dEnd, top: ground + (h ?? METRES_PER_STOREY), site: onSite, unknown: !h, approx: current.bd.heightFrom === 'da', label: h && dEnd - current.d0 > 25 ? `${current.bd.floors ?? storeysOf(h)} st${current.bd.heightFrom === 'da' ? ' (DA)' : ''}` : undefined });
      current = null;
    };
    for (const s of samples) {
      const ll = at(s.d);
      let hit: Building | undefined;
      for (const bd of b.buildings.buildings) {
        if (Math.abs(bd.centroid[0] - ll.lon) > 0.003 || Math.abs(bd.centroid[1] - ll.lat) > 0.003) continue;
        if (pointInRing(ll.lon, ll.lat, bd.rings[0])) { hit = bd; break; }
      }
      if (hit && current && current.bd === hit) { current.rls.push(s.rl); continue; }
      if (current) flush(s.d);
      if (hit) current = { bd: hit, d0: s.d, rls: [s.rl] };
    }
    if (current) flush(samples[samples.length - 1].d);
    const siteRun = samples.filter((s) => s.site);
    const envelope = f.envelope && f.envelope.topRl !== undefined && siteRun.length
      ? { d0: siteRun[0].d, d1: siteRun[siteRun.length - 1].d, top: f.envelope.topRl, label: `HOB ${f.envelope.label}` } : undefined;
    const sec = sectionSvg({ w: FIELD_W, h: 96, font: t.font, samples, from: 'A', to: 'A′', siteColour: t.site, waterColour: t.water, blocks, envelope });
    const yA = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
    sectionHtml = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${yA}mm;width:${FIELD_W}mm">Section A–A′ with the buildings it meets<span class="pnote">${bearingName((secA.bearing + 180) % 360)} to ${bearingName(secA.bearing)} · ${fmtNum(Math.round(L))} m · heights measured or ${METRES_PER_STOREY} m a storey, dashed where the storeys are a DA's, faint and one storey where unknown · vertical exaggeration ${sec.ve % 1 ? sec.ve.toFixed(1) : sec.ve}×</span></div>
      <div class="abs" style="left:${FIELD_X}mm;top:${yA + PANEL_TITLE_H}mm">${sec.svg}</div>`;
  }
  const yHist = FIELD_Y + PANEL_TITLE_H + 76;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Built form<span class="pnote">1:${fmtNum(p.scale)} · footprints by height</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles two" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 30}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${yHist}mm;width:${rightW}mm">Storeys within ${f.near.radiusM} m<span class="pnote">${fmtNum(f.near.withHeight)} buildings with a height</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yHist + PANEL_TITLE_H}mm">${histSvg}</div>
    ${sectionHtml}`;
  return { id: '08_built_form', title: 'Built form and height planes', subtitle: sub, textHtml, figureHtml };
}

/** The storey bands on the template: one sage ink, the height told by pattern — open, sparse lines, dense lines, tint, tint and lines. */
const SAGE = INK.sage;
const BAND_FILL: Fill[] = [
  { bg: '#ffffff', outline: SAGE.deep, outlineW: 0.12 },
  { bg: '#ffffff', kind: 'vlines', ink: SAGE.deep, step: 0.95, w: 0.13, outline: SAGE.deep, outlineW: 0.12 },
  { bg: '#ffffff', kind: 'vlines', ink: SAGE.deep, step: 0.45, w: 0.13, outline: SAGE.deep, outlineW: 0.12 },
  { bg: SAGE.solid, outline: SAGE.deep, outlineW: 0.12 },
  { bg: SAGE.solid, kind: 'vlines', ink: SAGE.deep, step: 0.45, w: 0.16, outline: SAGE.deep, outlineW: 0.15 },
];
const NO_HEIGHT: Fill = { bg: SAGE.light, kind: 'dots', ink: SAGE.deep, step: 1.1, w: 0.09 };
const bandFill = (h?: number): Fill => { const bd = bandOf(h); return bd ? BAND_FILL[HEIGHT_BANDS.indexOf(bd)] : NO_HEIGHT; };
/** Below the free space a flow may take, the key rises from the foot of the page: 8.52 mm a row, 12.2 mm up. */
const keyTop = (entries: number) => 297 - 12.2 - (entries > LEGEND_ONE_COLUMN ? Math.ceil(entries / 2) : entries) * 8.52;
/** The height a block of the kit takes in the flow: head, body, gap. */
const blockH = (body: number) => 6.21 + body + 7.5;
const barsH = (rows: number, ref = false) => 10 + rows * 3.95 + (ref ? 4 : 0);

type SectionLine = NonNullable<ReturnType<typeof terrainFacts>>['sections'][number];
/** The stretch of a section centred on the site, as long as the column holds at the scale given. */
function cropSection(sec: SectionLine, scale: number, widthMm = Z_W): SectionLine {
  const len = (widthMm * scale) / 1000;
  const L = sec.lengthM;
  if (L <= len) return sec;
  const run = sec.samples.filter((q) => q.site);
  const mid = run.length ? (run[0].d + run[run.length - 1].d) / 2 : L / 2;
  const d0 = Math.max(0, Math.min(L - len, mid - len / 2));
  const at = (d: number) => ({ x: sec.from.x + (sec.to.x - sec.from.x) * (d / L), y: sec.from.y + (sec.to.y - sec.from.y) * (d / L) });
  return { ...sec, lengthM: len, from: at(d0), to: at(d0 + len), samples: sec.samples.filter((q) => q.d >= d0 - 1e-6 && q.d <= d0 + len + 1e-6).map((q) => ({ ...q, d: q.d - d0 })) };
}
/** The round scale a section fills its width at, the ends that run past it cropped: the largest whose drawing is at least as long as the width. */
const fillScale = (lengthM: number, widthMm: number) => [500, 1000, 1250, 2000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 50000].filter((x) => (lengthM * 1000) / x >= widthMm - 1e-6).pop() ?? 500;

/** Section A–A′ after the template: true scale where it reads, the ground in poché, buildings in their storey pattern, the height plane dashed. */
function atlasSection(b: SlidesBundle, sec: SectionLine, envelope: ReturnType<typeof builtFormFacts>['envelope'], maxH: number): { svg: string; scale: number; ve: number; h: number } | null {
  const samples = sec.samples;
  if (samples.length < 2) return null;
  const L = sec.lengthM;
  const scale = Math.round((L * 1000) / Z_W);
  const sx = Z_W / L;
  const at = (d: number) => { const fr = d / L; return mercatorToLonLat({ x: sec.from.x + (sec.to.x - sec.from.x) * fr, y: sec.from.y + (sec.to.y - sec.from.y) * fr }); };
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const blocks: { d0: number; d1: number; ground: number; h?: number; site: boolean }[] = [];
  let cur: { bd: Building; d0: number; rls: number[] } | null = null;
  const flush = (dEnd: number) => {
    if (!cur) return;
    const onSite = siteRings.some((r) => pointInRing(cur!.bd.centroid[0], cur!.bd.centroid[1], r));
    blocks.push({ d0: cur.d0, d1: dEnd, ground: Math.min(...cur.rls), h: cur.bd.estimatedHeightM, site: onSite });
    cur = null;
  };
  for (const s of samples) {
    const ll = at(s.d);
    let hit: Building | undefined;
    for (const bd of b.buildings.buildings) {
      if (Math.abs(bd.centroid[0] - ll.lon) > 0.003 || Math.abs(bd.centroid[1] - ll.lat) > 0.003) continue;
      if (pointInRing(ll.lon, ll.lat, bd.rings[0])) { hit = bd; break; }
    }
    if (hit && cur && cur.bd === hit) { cur.rls.push(s.rl); continue; }
    if (cur) flush(s.d);
    if (hit) cur = { bd: hit, d0: s.d, rls: [s.rl] };
  }
  if (cur) flush(samples[samples.length - 1].d);
  const lo = Math.min(...samples.map((s) => s.rl)), groundHi = Math.max(...samples.map((s) => s.rl));
  const siteRun = samples.filter((s) => s.site);
  const envTop = envelope?.topRl !== undefined && siteRun.length ? envelope.topRl : -Infinity;
  const tallest = Math.max(groundHi, envTop, ...blocks.map((bk) => bk.ground + (bk.h ?? METRES_PER_STOREY)));
  const hi = Math.min(tallest, Math.max(groundHi + 45, envTop + 4));
  // true scale unless the fabric would read as a line
  const ve = (hi - lo) * sx < 9 ? 2 : 1;
  const sy = sx * ve;
  const TOP = 6.3, POCHE = 3.2;
  let h = TOP + (hi - lo) * sy + POCHE + 4.2;
  if (h > maxH) return null;
  const X = (d: number) => d * sx;
  const Y = (rl: number) => TOP + (hi - rl) * sy;
  const base = Y(lo) + POCHE;
  const g: string[] = [];
  const line = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.d).toFixed(2)},${Y(s.rl).toFixed(2)}`).join('');
  const groundD = `${line}L${X(L).toFixed(2)},${base.toFixed(2)}L${X(0).toFixed(2)},${base.toFixed(2)}Z`;
  const clipId = `asec${Math.random().toString(36).slice(2, 7)}`;
  g.push(`<clipPath id="${clipId}"><rect x="0" y="${(TOP - 0.2).toFixed(2)}" width="${Z_W}" height="${(base - TOP).toFixed(2)}"/></clipPath><g clip-path="url(#${clipId})">`);
  const cut: string[] = [];
  for (const bk of blocks) {
    if (bk.d1 - bk.d0 < 0.5) continue;
    const top = bk.ground + (bk.h ?? METRES_PER_STOREY);
    const x0 = X(bk.d0), x1 = X(bk.d1), y0 = Y(top), y1 = Y(bk.ground);
    // every building outlined, so the neighbours read; each runs a little below the ground, which is drawn over it
    const f: Fill = { ...(bk.site ? { bg: tpl().site } : bandFill(bk.h)), outline: bk.site ? tpl().site : '#000000', outlineW: 0.15 };
    const yb = y1 + 1.2;
    g.push(fillShape(`M${x0.toFixed(2)},${y0.toFixed(2)}H${x1.toFixed(2)}V${yb.toFixed(2)}H${x0.toFixed(2)}Z`, { x0, y0, x1, y1: yb }, f));
    if (top > hi + 0.5 && bk.h) cut.push(z6((x0 + x1) / 2, TOP - 2.9, `↑${Math.round(bk.h / METRES_PER_STOREY)}`, 'middle'));
  }
  g.push('</g>');
  g.push(fillShape(groundD, { x0: X(0), y0: Y(groundHi), x1: X(L), y1: base }, { bg: '#ffffff', kind: 'hlines', ink: SAGE.deep, step: 0.5, w: 0.1 }));
  g.push(`<path d="${line}" fill="none" stroke="#000000" stroke-width="0.25" stroke-linejoin="round"/>`, ...cut);
  // the LEP height of building along the line: the plane over the ground, dashed, its value at each change
  const hobs = b.hob.features.filter((ft) => Number(ft.properties.MAX_B_H) > 0 && !/RL/i.test(String(ft.properties.UNITS ?? ''))).map((ft) => ({ m: Number(ft.properties.MAX_B_H), rings: geomRings(ft.geometry) }));
  const runs: { m: number; pts: [number, number][] }[] = [];
  for (const q of samples) {
    if (q.site) { runs.push({ m: NaN, pts: [] }); continue; }
    const ll = at(q.d);
    const hp = hobs.find((hb) => hb.rings.some((r) => pointInRing(ll.lon, ll.lat, r)));
    const last = runs[runs.length - 1];
    if (!hp) { if (last && last.pts.length) runs.push({ m: NaN, pts: [] }); continue; }
    if (!last || last.m !== hp.m) runs.push({ m: hp.m, pts: [] });
    runs[runs.length - 1].pts.push([X(q.d), Y(Math.min(hi, q.rl + hp.m))]);
  }
  const lepRuns = runs.filter((r) => r.pts.length > 1 && Number.isFinite(r.m));
  // each run the whole envelope: up from the ground at its start, along the plane, down to the ground at its end
  const groundY = (x: number) => { const d = x / sx; const q = samples.reduce((a, s2) => (Math.abs(s2.d - d) < Math.abs(a.d - d) ? s2 : a)); return Y(q.rl); };
  if (lepRuns.length) g.push(`<path d="${lepRuns.map((r) => { const [x0] = r.pts[0], [x1] = r.pts[r.pts.length - 1]; return `M${x0.toFixed(2)},${groundY(x0).toFixed(2)}L${r.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}L${x1.toFixed(2)},${groundY(x1).toFixed(2)}`; }).join('')}" fill="none" stroke="#000000" stroke-width="0.2" stroke-dasharray="0.6 0.5"/>`);
  let lastLabelX = -Infinity;
  for (const r of lepRuns) {
    const [x0, y0] = r.pts[0], [x1] = r.pts[r.pts.length - 1];
    if (x1 - x0 < 8 || x0 - lastLabelX < 14) continue;
    g.push(z6(x0 + 0.6, y0 - 3, `${fmtNum(r.m, r.m % 1 ? 1 : 0)} m`).replace('<text ', '<text stroke="#ffffff" stroke-width="0.6" paint-order="stroke" '));
    lastLabelX = x0;
  }
  if (envTop > -Infinity) {
    const d0 = siteRun[0].d, d1 = siteRun[siteRun.length - 1].d;
    const gAt = (d: number) => samples.reduce((a, s) => (Math.abs(s.d - d) < Math.abs(a.d - d) ? s : a)).rl;
    g.push(`<path d="M${X(d0).toFixed(2)},${Y(gAt(d0)).toFixed(2)}V${Y(envTop).toFixed(2)}H${X(d1).toFixed(2)}V${Y(gAt(d1)).toFixed(2)}" fill="none" stroke="${tpl().site}" stroke-width="0.3" stroke-dasharray="0.9 0.6"/>`);
    g.push(z6(X(d1) + 1.2, Y(envTop) - 1.1, `LEP ${envelope!.label}`));
  }
  g.push(z6(X(0), base + 1.2, 'A'), z6(X(L), base + 1.2, 'A′', 'end'));
  const step = L > 1200 ? 200 : L > 600 ? 100 : 50;
  for (let d = step; d < L - step / 3; d += step) g.push(z6(X(d), base + 1.2, `${d} m`, 'middle'));
  h = base + 4.2;
  return { svg: zSvg(h, g.join('')), scale, ve, h };
}

/** Built form on the template: the sage family, the storeys told by pattern. */
export function builtFormAtlas(b0: SlidesBundle, planning: PlanningFacts): Slide {
  const b: SlidesBundle = { ...b0, daPanel: b0.bleedPanel };
  const t = tpl();
  const f = builtFormFacts(b, planning);
  const p = b.bleedPanel;
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p, { lots: false }))];
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const groups = new Map<Fill, string[]>();
  for (const bd of b.buildings.buildings) { const fl = bandFill(bd.estimatedHeightM); (groups.get(fl) ?? groups.set(fl, []).get(fl)!).push(ringsPath(bd.rings, proj)); }
  for (const fl of [NO_HEIGHT, ...BAND_FILL]) { const ds = groups.get(fl); if (ds) parts.push(fillShape(ds.join(''), box, fl)); }
  const fromDa = b.buildings.buildings.filter((bd) => bd.heightFrom === 'da');
  if (fromDa.length) parts.push(`<path d="${fromDa.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="none" stroke="${SAGE.line}" stroke-width="0.4" fill-rule="evenodd"/>`);
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  // the section line, as on the topography slide
  const terrain = terrainFacts(b0);
  const secA = terrain?.sections[0] ? cropSection(terrain.sections[0], Math.min(2500, fillScale(terrain.sections[0].lengthM, Z_W))) : undefined;
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take(36, 10, 64, 10);
  const labels: string[] = [];
  if (secA) {
    const ll = (xy: { x: number; y: number }) => { const l = mercatorToLonLat(xy); return proj(l.lon, l.lat); };
    const [x1, y1] = ll(secA.from), [x2, y2] = ll(secA.to);
    parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#000000" stroke-width="0.25" stroke-dasharray="2.4 0.8 0.4 0.8"/>`);
    const ux = (x2 - x1) / Math.hypot(x2 - x1, y2 - y1), uy = (y2 - y1) / Math.hypot(x2 - x1, y2 - y1);
    for (const [x, y, s, text] of [[x1, y1, -1, 'A'], [x2, y2, 1, 'A′']] as [number, number, number, string][]) {
      const lx = x + s * ux * 2.6, ly = y + s * uy * 2.6;
      spacer.take(lx, ly, 3, 3);
      labels.push(m6(lx, ly, text));
    }
  }
  // the tallest buildings on the page carry their storeys
  const tallest = b.buildings.buildings.filter((bd) => bd.estimatedHeightM).map((bd) => { const [x, y] = proj(bd.centroid[0], bd.centroid[1]); return { bd, x, y }; })
    .filter((q) => q.x > 4 && q.y > 14 && q.x < p.wMm - 4 && q.y < p.hMm - 14).sort((q, r) => r.bd.estimatedHeightM! - q.bd.estimatedHeightM!).slice(0, 8);
  for (const q of tallest) {
    const text = String(q.bd.floors ?? storeysOf(q.bd.estimatedHeightM!)), w = text.length * 1.6 + 0.8;
    for (const [lx, ly] of [[q.x, q.y], [q.x + w, q.y], [q.x - w, q.y], [q.x, q.y - 2.8], [q.x, q.y + 2.8]] as [number, number][]) if (spacer.take(lx, ly, w, 2.6)) { labels.push(m6(lx, ly, text)); break; }
  }
  parts.push(siteMark(b.base, proj, 'both'), ...labels, panelFurniture(p, 'left'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-built-atlas"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-built-atlas)" font-family="${t.font}">${parts.join('\n')}</g></svg>`;

  // ---- the key first, so the flow knows where it must stop
  const legend: LegendEntry[] = [
    ...HEIGHT_BANDS.map((bd, i) => ({ swatch: swatchOf(BAND_FILL[i]), label: `${i ? bd.label : '1–2'} storeys · ${fmtNum(f.bands[i].count)}`.replace('and more storeys', 'storeys and more') })),
    { swatch: swatchOf(NO_HEIGHT), label: `No height recorded · ${fmtNum(f.bands[5].count)}` },
    ...(fromDa.length ? [{ swatch: `<rect x="0.2" y="0.6" width="4.6" height="2.4" fill="#ffffff" stroke="${SAGE.line}" stroke-width="0.4"/>`, label: `Storeys from a determined DA on the lot · ${fmtNum(fromDa.length)}` }] : []),
    ...(secA ? [{ swatch: `<path d="M0,1.8H5" stroke="#000000" stroke-width="0.25" stroke-dasharray="2.4 0.8 0.4 0.8"/>`, label: 'Section line A–A′; numbers on the map are storeys' }] : []),
    ...(secA ? [{ swatch: `<path d="M0,1.8H5" stroke="#000000" stroke-width="0.2" stroke-dasharray="0.6 0.5"/>`, label: 'LEP height of building along the section, in metres' }] : []),
    { swatch: `<path d="M1.2,0.6H3.8V3H1.2Z" fill="${t.site}"/>`, label: 'The site' },
  ];
  const limit = keyTop(legend.length) - 6;

  // ---- the text page
  const known = f.measured + f.fromStoreys + f.fromDa;
  const e = f.envelope;
  const onSiteSt = f.onSite.filter((x) => x.storeys).map((x) => x.storeys!);
  const t0 = f.tallest[0];
  const figs = zFigures([
    ['buildings on the page', fmtNum(f.count)],
    ['with a recorded height', f.count ? fmtPct(pct(known, f.count)) : '—'],
    ['tallest recorded on the page', t0 ? `${Math.round(t0.heightM)} m (${t0.storeys} st) · ${fmtNum(t0.distanceM)} m ${bearingName(t0.bearing)}` : '—'],
  ], [
    ['LEP height of building', e ? e.label : 'not mapped'],
    ['storeys within the plane', e?.storeys ? `about ${e.storeys}` : '—'],
    ['on the site today', onSiteSt.length ? `${Math.max(...onSiteSt)} storey${Math.max(...onSiteSt) === 1 ? '' : 's'}` : f.onSite.length ? 'height not recorded' : 'no building'],
  ], 9.6);
  let y = 44 + blockH(6.3 + 3 * 9.6);
  const blocks: string[] = [`<div class="zblk">${zHead('The fabric', 'At the site')}${figs}</div>`];
  // heights against the plane: what is around, what is allowed
  const rows: { name: string; value: number; label: string; fill: Fill }[] = [];
  // the nearest buildings whose height is known, and the run of storeys within 250 m
  const c0 = p.center, k0 = mercatorScaleFactor(mercatorToLonLat(c0).lat);
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const geo = (bd: Building) => { const m = lonLatToMercator({ lon: bd.centroid[0], lat: bd.centroid[1] }); return { d: Math.hypot(m.x - c0.x, m.y - c0.y) / k0, brg: ((Math.atan2(m.x - c0.x, m.y - c0.y) * 180) / Math.PI + 360) % 360 }; };
  const nearKnown = b.buildings.buildings.filter((bd) => bd.estimatedHeightM && !siteRings.some((r) => pointInRing(bd.centroid[0], bd.centroid[1], r)))
    .map((bd) => ({ bd, ...geo(bd) })).filter((q) => q.d <= f.near.radiusM);
  const st = (bd: Building) => bd.floors ?? storeysOf(bd.estimatedHeightM!);
  const tall250 = [...nearKnown].sort((q, r) => r.bd.estimatedHeightM! - q.bd.estimatedHeightM!)[0];
  if (tall250) rows.push({ name: `Tallest within ${f.near.radiusM} m · ${fmtNum(Math.round(tall250.d))} m ${bearingName(tall250.brg)}`, value: st(tall250.bd), label: `${st(tall250.bd)} st · ${Math.round(tall250.bd.estimatedHeightM!)} m`, fill: bandFill(tall250.bd.estimatedHeightM) });
  if (f.near.medianStoreys) rows.push({ name: `Median within ${f.near.radiusM} m`, value: f.near.medianStoreys, label: `${f.near.medianStoreys} st`, fill: bandFill(f.near.medianM) });
  for (const q of [...nearKnown].sort((x, z) => x.d - z.d).slice(0, 4)) rows.push({ name: `Nearest known · ${fmtNum(Math.round(q.d))} m ${bearingName(q.brg)}`, value: st(q.bd), label: `${st(q.bd)} st · ${Math.round(q.bd.estimatedHeightM!)} m`, fill: bandFill(q.bd.estimatedHeightM) });
  const siteKnown = f.onSite.filter((x) => x.storeys);
  rows.push(siteKnown.length
    ? { name: 'On the site today', value: Math.max(...siteKnown.map((x) => x.storeys!)), label: `${Math.max(...siteKnown.map((x) => x.storeys!))} st`, fill: { bg: t.site } }
    : { name: 'On the site today', value: 0, label: f.onSite.length ? 'height not recorded' : 'no building', fill: { bg: t.site } });
  const hAx = niceAxis(Math.max(1, ...rows.map((r) => r.value), e?.storeys ?? 0));
  if (rows.length) {
    blocks.push(`<div class="zblk">${zHead('Heights against the plane · storeys')}${zBars(rows, hAx.max, hAx.step, e?.storeys ? { ref: { value: e.storeys, label: `LEP ${e.label}`, ink: t.site } } : {})}</div>`);
    y += blockH(barsH(rows.length, !!e?.storeys));
  }
  if (secA) {
    const sec = atlasSection(b0, secA, e, limit - y - 6.21);
    if (sec) blocks.push(`<div class="zblk">${zHead(`Section A–A′ · 1:${fmtNum(sec.scale).replace(',', ' ')}${sec.ve > 1 ? ` · heights ×${sec.ve}` : ''}`)}${sec.svg}</div>`);
  }
  const flow = `<div class="zflow" style="top:44mm">${blocks.join('')}</div>`;
  const src = f.source === 'overture' ? `Overture Maps Foundation buildings${f.release ? ` (release ${f.release})` : ''}, footprints and heights from OpenStreetMap, Microsoft, Esri Community Maps and Google Open Buildings (ODbL, CDLA Permissive 2.0)` : f.source === 'osm' ? 'OpenStreetMap contributors (ODbL)' : 'no building source answered';
  const sources = `Sources: ${src}; heights measured, or ${METRES_PER_STOREY} m a storey, else the storeys of a determined application on the lot (NSW Planning Portal); the LEP height of building from the ePlanning layer; ground from the 5 m elevation model. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const lga = b.context.lga?.name ? titleCase(b.context.lga.name) : '';
  const sub = [`${b.siteAddress}${lga ? ` ${lga}` : ''}`, e ? `HOB ${e.label}` : 'no HOB mapped', f.near.medianStoreys ? `median ${f.near.medianStoreys} storeys within ${f.near.radiusM} m` : ''].filter(Boolean).join(' · ');
  const figureHtml = `<div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">Built form · 1:${fmtNum(p.scale).replace(',', ' ')}</div>
    ${flow}`;
  return { id: '08_built_form', title: 'Built form', subtitle: sub, textHtml: '', figureHtml, bleed: true, sources, accent: SAGE.text, legend,
    narrative: brief([f.near.medianStoreys ? `Within ${f.near.radiusM} m of the site the typical building is ${f.near.medianStoreys} storeys.` : '', e?.storeys ? `The ${e.label} height of building allows about ${e.storeys} at the site${f.near.medianStoreys ? `, ${e.storeys >= 2 * f.near.medianStoreys ? 'twice' : 'more than'} the neighbourhood's` : ''}.` : '', t0 ? `The tallest with a recorded height on the map, ${t0.name ?? 'a tower'}, is ${Math.round(t0.heightM)} m (${t0.storeys} storeys), ${fmtNum(t0.distanceM)} m away to the ${bearingName(t0.bearing)}.` : '']) };
}

// ---- slide 09: movement ------------------------------------------------------

const ISO_MINUTES = [5, 10, 15];
const ISO_FILL: Record<number, string> = { 5: '#2f7d6d', 10: '#6ba998', 15: '#a8cdc2' };
const CYCLE_COLOUR = '#2c4c9c';
const FRONTAGE_COLOUR = '#d9825b';
const FOOTWAY_COLOUR = '#8a918c';

const roadWord = (h: number) => (h <= 2 ? 'motorway or highway' : h === 3 ? 'arterial road' : h === 4 ? 'sub-arterial road' : h === 5 ? 'collector road' : 'local street');
const stationKind = stationMode;
const tidyStation = (name: string) => titleCase(name.replace(/\s+(RAILWAY|TRAIN)?\s*STATION$/i, '').replace(/\s+(SLR|LIGHT RAIL)\s+STOP$/i, '').replace(/\s+METRO$/i, ' Metro'));
/** Walking minutes as every slide states them: straight-line distance at 80 m a minute, the fine print's rule. */
const walkMinutes = (distanceM: number) => Math.max(1, Math.round(distanceM / 80));

/** Length of a lon/lat line in ground metres. */
function lineLengthM(coords: number[][]): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = lonLatToMercator({ lon: coords[i - 1][0], lat: coords[i - 1][1] }), b = lonLatToMercator({ lon: coords[i][0], lat: coords[i][1] });
    m += Math.hypot(b.x - a.x, b.y - a.y) * Math.cos((coords[i][1] * Math.PI) / 180);
  }
  return m;
}

/** The wide strip's lettering, shared by the slides that carry one: suburbs, stations, the site, the tall panel's window and the scale bar. */
function wideStripLabels(b: SlidesBundle, wproj: Proj, wp: Panel): string {
  const t = tpl();
  const p = b.daPanel;
  const out: string[] = [];
  const wspacer = new LabelSpacer(wp.wMm, wp.hMm, 60);
  const [sx, sy] = wproj(mercatorToLonLat(p.center).lon, mercatorToLonLat(p.center).lat);
  wspacer.take(sx, sy, 6, 6);
  // suburbs, at the centroid of what falls inside the strip
  for (const ft of b.wide.suburbs.features) {
    const name = String(ft.properties?.suburbname ?? '');
    if (!name) continue;
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of geomRings(ft.geometry)) { const s = clippedStats(r, wproj, wp); if (s.area > best.area) best = s; }
    if (best.area < 150) continue;
    const text = titleCase(name);
    if (wspacer.take(best.cx, best.cy, labelW(text, 2.2) + 1, 3)) out.push(`<text x="${best.cx.toFixed(1)}" y="${(best.cy + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" letter-spacing="0.08em" fill="#8a918c" stroke="#ffffff" stroke-width="0.5" paint-order="stroke">${esc(text.toUpperCase())}</text>`);
  }
  for (const s of b.wide.base.stations) {
    const [x, y] = wproj(s.lon, s.lat);
    if (x < 2 || y < 2 || x > wp.wMm - 2 || y > wp.hMm - 2) continue;
    const text = tidyStation(s.name);
    if (wspacer.take(x + 3 + labelW(text, 2) / 2, y, labelW(text, 2), 2.6)) out.push(label(x + 3 + labelW(text, 2) / 2, y, text, 2, '#2a3534'));
  }
  out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.2" fill="#ffffff" stroke="${t.site}" stroke-width="0.6"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="0.9" fill="${t.site}"/>`);
  // the tall panel's window, so the two maps tie together
  const [wx0, wy0] = wproj(mercatorToLonLat({ x: panelExtent(p).xmin, y: panelExtent(p).ymax }).lon, mercatorToLonLat({ x: panelExtent(p).xmin, y: panelExtent(p).ymax }).lat);
  const [wx1, wy1] = wproj(mercatorToLonLat({ x: panelExtent(p).xmax, y: panelExtent(p).ymin }).lon, mercatorToLonLat({ x: panelExtent(p).xmax, y: panelExtent(p).ymin }).lat);
  out.push(`<rect x="${wx0.toFixed(1)}" y="${wy0.toFixed(1)}" width="${(wx1 - wx0).toFixed(1)}" height="${(wy1 - wy0).toFixed(1)}" fill="none" stroke="${t.dimension}" stroke-width="0.3" stroke-dasharray="1.2,0.8"/>`);
  out.push(panelFurniture(wp, 'right'));
  return out.join('\n');
}

export function movementFacts(b: SlidesBundle) {
  const mv = b.movement;
  const centre = b.daPanel.center;
  const k = mercatorScaleFactor(mercatorToLonLat(centre).lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const distM = (lon: number, lat: number) => { const m = toM(lon, lat); return Math.hypot(m.x - centre.x, m.y - centre.y) / k; };
  const bearing = (lon: number, lat: number) => { const m = toM(lon, lat); return ((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360; };
  const walkBand = (lon: number, lat: number) => { for (const min of ISO_MINUTES) { const iso = mv.isochrones.find((i) => i.minutes === min); if (iso && iso.rings.some((r) => pointInRing(lon, lat, r))) return min; } return null; };
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const siteMerc = siteRings.flat().map(([lon, lat]) => toM(lon, lat));
  // Stations from the wide base, so the nearest one counts even beyond the tall panel.
  const seenStations = new Set<string>();
  const stations = [...b.wide.base.stations, ...b.base.stations]
    .filter((s) => { const key = s.name.toUpperCase(); if (seenStations.has(key)) return false; seenStations.add(key); return true; })
    .map((s) => ({ name: tidyStation(s.name), kind: stationKind(s.name), distanceM: Math.round(distM(s.lon, s.lat)), bearing: bearing(s.lon, s.lat), walkBand: walkBand(s.lon, s.lat), walkMin: walkMinutes(distM(s.lon, s.lat)) }))
    .sort((p, q) => p.distanceM - q.distanceM).slice(0, 8);
  const stops = mv.busStops.map((s) => ({ ...s, distanceM: distM(s.lon, s.lat) }));
  const cycleLength = (kind?: CyclewayKind) => Math.round(mv.cycleways.filter((c) => !kind || c.kind === kind).reduce((n, c) => n + lineLengthM(c.coords), 0));
  const nearestCycle = mv.cycleways.reduce<{ distanceM: number; name?: string; kind: CyclewayKind } | null>((best, c) => {
    for (const [lon, lat] of c.coords) { const d = distM(lon, lat); if (!best || d < best.distanceM) best = { distanceM: d, name: c.name, kind: c.kind }; }
    return best;
  }, null);
  // The roads the site fronts: a segment with a vertex within 25 m of the site's boundary.
  const near = (coords: number[][], maxM: number) => coords.some(([lon, lat]) => { const m = toM(lon, lat); return siteMerc.some((s) => Math.hypot(s.x - m.x, s.y - m.y) / k <= maxM); });
  const frontage = new Map<string, number>();
  for (const r of b.base.roads) if (r.name && near(r.coords, 25)) frontage.set(titleCase(r.name), Math.min(frontage.get(titleCase(r.name)) ?? 99, r.hierarchy));
  const onewayNear = [...new Set(mv.onewayRoads.filter((r) => r.name && near(r.coords, 200)).map((r) => titleCase(r.name!)))].slice(0, 5);
  const afRings = mv.activeFrontages.features.flatMap((f) => geomRings(f.geometry));
  const centreLL = mercatorToLonLat(centre);
  const activeAtSite = afRings.some((r) => pointInRing(centreLL.lon, centreLL.lat, r)) || afRings.some((r) => siteRings.some((sr) => sr.some(([lon, lat]) => pointInRing(lon, lat, r))));
  const isoAreas = mv.isochrones.map((iso) => ({ minutes: iso.minutes, areaHa: Math.round(iso.rings.reduce((a, r) => { let s = 0; const pts = r.map(([lon, lat]) => toM(lon, lat)); for (let i = 0; i < pts.length - 1; i++) s += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y; return a + Math.abs(s / 2); }, 0) / (k * k) / 1e4) }));
  return {
    stations,
    bus: { source: mv.busStopSource, within400: stops.filter((s) => s.distanceM <= 400).length, within800: stops.filter((s) => s.distanceM <= 800).length, total: stops.length, routes: mv.busRouteCount, nearest: stops.sort((p, q) => p.distanceM - q.distanceM)[0] ? { name: stops[0].name, distanceM: Math.round(stops[0].distanceM) } : null },
    cycle: { osm: mv.osm, separatedM: cycleLength('separated'), laneM: cycleLength('lane'), sharedM: cycleLength('shared'), nearest: nearestCycle ? { ...nearestCycle, distanceM: Math.round(nearestCycle.distanceM) } : null },
    foot: { osm: mv.osm, links: mv.footways.length, lengthM: Math.round(mv.footways.reduce((n, c) => n + lineLengthM(c), 0)) },
    frontage: [...frontage.entries()].map(([name, h]) => ({ name, hierarchy: h, word: roadWord(h) })).sort((p, q) => p.hierarchy - q.hierarchy),
    oneway: { osm: mv.osm, near: onewayNear },
    activeFrontage: { atSite: activeAtSite, count: mv.activeFrontages.features.length, epi: mv.activeFrontages.features[0]?.properties?.EPI_NAME as string | undefined },
    isochrones: isoAreas,
  };
}

/**
 * What each walking band actually holds — stations, parks, bus stops and
 * public facilities inside the 5, 10 and 15 minute isochrones — so the
 * slide can say what is reached, not only how far the lines run.
 */
export function walkReachFacts(b: SlidesBundle, f: ReturnType<typeof movementFacts>) {
  const mv = b.movement;
  const bandOf = (lon: number, lat: number) => { for (const min of ISO_MINUTES) { const iso = mv.isochrones.find((i) => i.minutes === min); if (iso && iso.rings.some((r) => pointInRing(lon, lat, r))) return min; } return null; };
  const parksWithin = new Map(greenFacts(b).openSpace.within.map((w) => [w.minutes, w.parks]));
  const facilityBands = b.green.facilities.map((x) => ({ kind: x.kind, band: bandOf(x.lon, x.lat) }));
  const stopBands = mv.busStops.map((s) => bandOf(s.lon, s.lat));
  return f.isochrones.map((i) => ({
    minutes: i.minutes, areaHa: i.areaHa,
    stations: f.stations.filter((s) => s.walkBand !== null && s.walkBand <= i.minutes).map((s) => ({ name: s.name, kind: s.kind })),
    parks: parksWithin.get(i.minutes) ?? 0,
    busStops: stopBands.filter((bd) => bd !== null && bd <= i.minutes).length,
    facilities: facilityBands.filter((x) => x.band !== null && x.band <= i.minutes).length,
    schools: facilityBands.filter((x) => x.band !== null && x.band <= i.minutes && x.kind === 'school').length,
  }));
}

export function movementSentences(b: SlidesBundle, f: ReturnType<typeof movementFacts>): string[] {
  const out: string[] = [];
  if (f.stations.length) {
    const s = f.stations.slice(0, 3).map((st, i) => (i
      ? `${st.name} (${st.kind}) ${fmtNum(st.distanceM)} m ${bearingName(st.bearing)}, about ${st.walkMin} min`
      : `${st.name} (${st.kind}) is ${fmtNum(st.distanceM)} m to the ${bearingName(st.bearing)}, about a ${st.walkMin}-minute walk`));
    out.push(`${s.join('; ')} (straight line at 80 m a minute).`);
  } else out.push('No railway, metro or light rail station lies within the wide window.');
  if (f.bus.total) out.push(`${f.bus.within400} bus stop${f.bus.within400 === 1 ? '' : 's'} within 400 m and ${f.bus.within800} within 800 m${f.bus.routes ? `, on ${f.bus.routes} route${f.bus.routes === 1 ? '' : 's'} through the window` : ''} (${f.bus.source === 'tfnsw' ? 'Transport for NSW' : 'OpenStreetMap'}).`);
  else out.push(`Bus stops could not be read: they come from Transport for NSW with a key, else from OpenStreetMap, and neither answered.`);
  if (f.cycle.osm) {
    const bits = [f.cycle.separatedM ? `${fmtNum(f.cycle.separatedM)} m of separated cycleway` : '', f.cycle.laneM ? `${fmtNum(f.cycle.laneM)} m of on-road lanes` : '', f.cycle.sharedM ? `${fmtNum(f.cycle.sharedM)} m of shared paths` : ''].filter(Boolean);
    let s = bits.length ? `The window has ${bits.join(', ')}` : 'The window has no mapped cycleway';
    if (f.cycle.nearest) s += `; the nearest${f.cycle.nearest.name ? `, ${f.cycle.nearest.name},` : ''} is ${fmtNum(f.cycle.nearest.distanceM)} m from the site`;
    s += `. ${f.foot.links ? `${fmtNum(f.foot.links)} pedestrian links (footways, paths and steps, ${fmtNum(f.foot.lengthM)} m) thread the blocks` : 'No pedestrian link is mapped off the streets'}.`;
    out.push(s);
  } else out.push('Cycleways, pedestrian links and one-way streets come from OpenStreetMap, which did not answer when the deck was generated.');
  if (f.frontage.length) {
    // Group the frontages by kind: "Miller Street and Blues Point Road, collector roads, and Blue Street, a local street".
    const groups = new Map<string, string[]>();
    for (const r of f.frontage) (groups.get(r.word) ?? groups.set(r.word, []).get(r.word)!).push(r.name);
    const phrase = [...groups.entries()].map(([word, names]) => `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}, ${names.length > 1 ? `${word}s` : `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`}`);
    let s = `The site fronts ${phrase.length > 1 ? `${phrase.slice(0, -1).join(', ')}, and ${phrase[phrase.length - 1]}` : phrase[0]}.`;
    if (f.oneway.near.length) s += ` One-way nearby: ${f.oneway.near.join(', ')}.`;
    out.push(s);
  }
  if (f.activeFrontage.count) out.push(f.activeFrontage.atSite ? `The site is within the LEP's active street frontage area${f.activeFrontage.epi ? ` (${f.activeFrontage.epi})` : ''}: ground-floor uses that address the street are required there.` : `The LEP maps active street frontages nearby${f.activeFrontage.epi ? ` (${f.activeFrontage.epi})` : ''}, but not at the site.`);
  else out.push('No active street frontage is mapped in this window (the ePlanning layer covers the LEPs that map one).');
  if (f.isochrones.length) {
    const reach = walkReachFacts(b, f);
    const stWord = (ss: { kind: string }[]) => (ss.every((s) => s.kind === 'light rail') ? 'light rail stop' : 'station');
    const bits = reach.map((r) => {
      const what = [
        r.stations.length ? (r.stations.length === 1 ? `${r.stations[0].name} ${r.stations[0].kind === 'light rail' ? 'light rail stop' : 'station'}` : `${r.stations.length} ${stWord(r.stations)}s`) : '',
        r.parks ? `${r.parks === 1 ? 'one park' : `${r.parks} parks`}` : '',
        r.busStops ? `${r.busStops} bus stop${r.busStops === 1 ? '' : 's'}` : '',
        r.facilities ? `${r.facilities} public facilit${r.facilities === 1 ? 'y' : 'ies'}` : '',
      ].filter(Boolean);
      return `within ${r.minutes} minutes ${what.length ? listWords(what) : `${fmtNum(r.areaHa)} ha of streets and nothing mapped`}`;
    });
    out.push(`On foot from the site, on the mapped street and path network: ${bits.join('; ')}.`);
  }
  return out;
}

export function movementSlide(b: SlidesBundle): Slide {
  const f = movementFacts(b);
  const t = tpl();
  const mv = b.movement;
  const sentences = movementSentences(b, f);
  const textHtml = sentences.slice(0, 3).map(para).join('') +
    `<div class="fine">Sources: NSW Spatial Services roads (function hierarchy), rail and stations; walking isochrones from Valhalla on OpenStreetMap; bus stops from ${f.bus.source === 'tfnsw' ? 'Transport for NSW' : f.bus.source === 'osm' ? 'OpenStreetMap' : 'Transport for NSW or OpenStreetMap (neither answered)'}; bus routes, cycleways, footways and one-way streets from OpenStreetMap contributors (ODbL); active street frontages from the ePlanning development-control layers. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f.stations[0] ? `${f.stations[0].name} ${fmtNum(f.stations[0].distanceM)} m` : '', f.frontage.length ? `fronts ${f.frontage.slice(0, 2).map((r) => r.name).join(' and ')}${f.frontage.length > 2 ? ` and ${f.frontage.length - 2} more` : ''}` : ''].filter(Boolean).join(' · ');

  // The movement map bleeds over the whole figure page, monochrome in the navy family.
  const MOVE = { iso: { 5: '#2c4c9c', 10: '#7b90c9', 15: '#b7c1e3' } as Record<number, string>, cycle: '#16244f', foot: '#9aa5c4', frontage: '#16244f', water: '#e8edf5', road: '#a9b2c6', rail: '#232e4c' };
  const mt = { ...t, water: MOVE.water, road: MOVE.road, rail: MOVE.rail };
  const p = b.bleedPanel;
  const proj = panelProjector(p);
  const parts: string[] = [withTemplate(mt, () => baseLayers(b.base, proj, p))];
  for (const iso of [...mv.isochrones].sort((x, y) => y.minutes - x.minutes)) {
    parts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="${MOVE.iso[iso.minutes] ?? '#b7c1e3'}" fill-opacity="0.08" stroke="${MOVE.iso[iso.minutes] ?? '#b7c1e3'}" stroke-width="0.45" stroke-dasharray="1.6,1" fill-rule="evenodd"/>`);
  }
  if (mv.activeFrontages.features.length) parts.push(`<path d="${fcPath(mv.activeFrontages, proj)}" fill="${MOVE.frontage}" fill-opacity="0.55" stroke="${MOVE.frontage}" stroke-width="0.25" fill-rule="evenodd"/>`);
  parts.push(withTemplate(mt, () => overLayers(b.base, proj, p, 'wash')));
  if (mv.busRoutes.length) parts.push(`<path d="${mv.busRoutes.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${t.busRoute}" stroke-width="0.5" stroke-dasharray="1.2,0.9" stroke-linecap="round"/>`);
  if (mv.footways.length) parts.push(`<path d="${mv.footways.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${MOVE.foot}" stroke-width="0.25" stroke-dasharray="0.5,0.5"/>`);
  for (const kind of ['shared', 'lane', 'separated'] as CyclewayKind[]) {
    const ls = mv.cycleways.filter((c) => c.kind === kind);
    if (ls.length) parts.push(`<path d="${ls.map((l) => ringsPath([l.coords], proj, false)).join('')}" fill="none" stroke="${MOVE.cycle}" stroke-width="${kind === 'separated' ? 0.6 : 0.4}"${kind === 'separated' ? '' : ' stroke-dasharray="1.4,0.8"'} stroke-linecap="round"/>`);
  }
  if (mv.busStops.length) parts.push(`<g>${mv.busStops.map((s) => { const [x, y] = proj(s.lon, s.lat); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.9" fill="${t.busRoute}" stroke="#ffffff" stroke-width="0.3"/>`; }).join('')}</g>`);
  // isochrone labels where each ring crosses the panel's centre line
  // Each ring's minutes go where the ring is clear: the station roundels, the site, the map's own label and
  // scale bar are reserved first, then the ring's points are tried from the top round to the sides.
  const isoSpacer = new LabelSpacer(p.wMm, p.hMm, 40);
  { const [cx0, cy0] = proj(mercatorToLonLat(p.center).lon, mercatorToLonLat(p.center).lat); isoSpacer.take(cx0, cy0, 10, 10); }
  isoSpacer.take(30, 10, 56, 10);
  // Station roundels keep their room, then each station on the map is named,
  // so the reader sees what the isochrones reach, not only anonymous letters.
  const panelStations = [...b.base.stations, ...b.wide.base.stations].filter((st) => { const [x, y] = proj(st.lon, st.lat); return x >= 2 && y >= 2 && x <= p.wMm - 2 && y <= p.hMm - 2; });
  for (const st of panelStations) { const [x, y] = proj(st.lon, st.lat); isoSpacer.take(x, y, 6, 6); }
  const namedStations = new Set<string>();
  for (const st of panelStations) {
    const key = st.name.toUpperCase();
    if (namedStations.has(key)) continue;
    namedStations.add(key);
    const [x, y] = proj(st.lon, st.lat);
    const text = tidyStation(st.name);
    const w = labelW(text, 2);
    // each candidate clears the 6 × 6 mm box reserved on the roundel itself, past the spacer's own margins
    for (const [lx, ly] of [[x + 4.0 + w / 2, y], [x - 4.0 - w / 2, y], [x, y - 5.2], [x, y + 5.4]] as [number, number][]) {
      if (isoSpacer.take(lx, ly, w, 2.6)) { parts.push(label(lx, ly, text, 2, MOVE.rail)); break; }
    }
  }
  for (const iso of mv.isochrones) {
    const text = `${iso.minutes} min`, w = t2Width(text);
    const pts = (iso.rings[0]?.map(([lon, lat]) => proj(lon, lat)) ?? []).filter((q) => q[0] > 8 && q[0] < p.wMm - 8 && q[1] > 14 && q[1] < p.hMm - 16);
    const order = [...pts].sort((q, r) => q[1] - r[1]);
    const tries = [...order.slice(0, 12), ...[...pts].sort((q, r) => q[0] - r[0]).slice(0, 8), ...[...pts].sort((q, r) => r[0] - q[0]).slice(0, 8)];
    for (const [x, y] of tries) {
      if (!isoSpacer.take(x, y - 2.2, w + 2, 4)) continue;
      parts.push(t2Text(x, y - 2.2, text, 'middle'));
      break;
    }
  }
  parts.push(siteMark(b.base, proj, 'outline'), panelFurniture(p, 'left'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-move"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-move)" font-family="${t.font}">${parts.join('\n')}</g>
  </svg>`;

  // Right: figures, legend, stations table.
  const rightX = AUX_X, rightW = AUX_W;
  const st0 = f.stations[0];
  const tiles = [
    { v: st0 ? `${fmtNum(st0.distanceM)} m` : '—', l: st0 ? `to ${st0.name} (${st0.kind}), about ${st0.walkMin} min on foot` : 'no station in the wide window' },
    { v: f.bus.total ? String(f.bus.within400) : '—', l: f.bus.total ? `bus stops within 400 m · ${f.bus.within800} within 800 m` : 'bus stops: no source answered' },
    { v: f.cycle.osm ? (f.cycle.nearest ? `${fmtNum(f.cycle.nearest.distanceM)} m` : 'none') : '—', l: f.cycle.osm ? (f.cycle.nearest ? `to the nearest cycleway (${f.cycle.nearest.kind})` : 'no cycleway mapped in the window') : 'cycleways: OpenStreetMap did not answer' },
    { v: f.frontage.length ? String(f.frontage.length) : '—', l: f.frontage.length ? `street frontage${f.frontage.length === 1 ? '' : 's'}: ${[...new Set(f.frontage.map((r) => (f.frontage.filter((q) => q.word === r.word).length > 1 ? `${r.word}s` : r.word)))].join(', ')}` : 'no named road within 25 m of the site' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const sw = (inner: string) => `<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${inner}</svg>`;
  const legendRows: [string, string][] = [
    [sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${MOVE.road}" stroke-width="0.9"/><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="#ffffff" stroke-width="0.6"/>`), 'Roads by function: motorways and arterials heaviest, local streets finest'],
    [sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${MOVE.rail}" stroke-width="0.2"/><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${MOVE.rail}" stroke-width="1.05" stroke-dasharray="0.16,1.3"/>`), 'Rail; stations as T, M (metro) or L (light rail)'],
    [sw(`<path d="M0,1.8 H5" stroke="${MOVE.iso[5]}" stroke-width="0.45" stroke-dasharray="1.6,1"/>`), 'Walking isochrones from the site: 5, 10 and 15 minutes'],
  ];
  if (mv.busStops.length || mv.busRoutes.length) legendRows.push([sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${t.busRoute}" stroke-width="0.5" stroke-dasharray="1.2,0.9"/><circle cx="2.5" cy="1.8" r="0.9" fill="${t.busRoute}" stroke="#ffffff" stroke-width="0.3"/>`), `Bus ${mv.busRoutes.length ? 'routes and ' : ''}stops (${f.bus.source === 'tfnsw' ? 'Transport for NSW' : 'OpenStreetMap'})`]);
  if (mv.cycleways.length) legendRows.push([sw(`<line x1="0" y1="1.2" x2="5" y2="1.2" stroke="${MOVE.cycle}" stroke-width="0.6"/><line x1="0" y1="2.6" x2="5" y2="2.6" stroke="${MOVE.cycle}" stroke-width="0.4" stroke-dasharray="1.4,0.8"/>`), 'Cycleways: separated solid, on-road lanes and shared paths dashed']);
  if (mv.footways.length) legendRows.push([sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${MOVE.foot}" stroke-width="0.25" stroke-dasharray="0.5,0.5"/>`), 'Footways, paths and steps off the streets']);
  if (mv.activeFrontages.features.length) legendRows.push([sw(`<rect x="0" y="0.6" width="5" height="2.4" fill="${MOVE.frontage}" fill-opacity="0.55"/>`), 'LEP active street frontage']);
  const legend = legendRows.map(([s, txt]) => `<div class="lg">${s}<span>${esc(txt)}</span></div>`).join('');
  const stationRows = f.stations.slice(0, 4).map((s) => `<tr><td>${esc(s.name.replace(/ Light Rail Stop$/, ''))} · ${esc(s.kind)}</td><td class="r">${fmtNum(s.distanceM)} m</td></tr>`).join('');
  const stationTable = f.stations.length
    ? `<table class="da"><thead><tr><th>Station</th><th class="r" style="width:18mm">Distance</th></tr></thead><tbody>${stationRows}</tbody></table>`
    : '';

  // The left page, after the office's template (Z. 2026-10): its graphs drawn at her coordinates, in page millimetres.
  const PT = 25.4 / 72;
  const S6 = 6 * PT, S10 = 10 * PT;
  const base = (top: number, size: number) => top + 0.905 * size;
  const txt = (x: number, top: number, text: string, size = S6, anchor: 'start' | 'middle' | 'end' = 'start', track = 0.09) =>
    `<text x="${x.toFixed(2)}" y="${base(top, size).toFixed(2)}" text-anchor="${anchor}" font-size="${size.toFixed(3)}" letter-spacing="${(track * size).toFixed(3)}" fill="#000000">${esc(text)}</text>`;
  const hair = (x0: number, x1: number, y: number) => `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#878787" stroke-width="0.18"/>`;
  const X0 = 75.33, X1 = 198, C2 = 138.67;
  const g: string[] = [];

  // Reach on foot · Bus
  g.push(txt(X0, 44.0, 'Reach on foot', S10, 'start', 0), txt(C2, 44.0, 'Bus', S10, 'start', 0), hair(X0, X1, 50.23));
  const isoA = [...f.isochrones].sort((x, y) => y.areaHa - x.areaHa).slice(0, 3);
  const R0 = 29.52, CX = 104.97, BOTTOM = 116.85, STEP = 5.5;
  const RING = [
    { fill: '#f9fafd', stroke: '#86a9da', w: 0.35, dash: 1.45 },
    { fill: '#eff1f9', stroke: '#0068b3', w: 0.41, dash: 1.69 },
    { fill: '#dfe4f1', stroke: '#312783', w: 0.44, dash: 1.63 },
  ];
  const maxHa = Math.max(1, ...isoA.map((i) => i.areaHa));
  const circ = isoA.map((iso, k) => { const r = R0 * Math.sqrt(iso.areaHa / maxHa); const cy = BOTTOM - k * STEP - r; return { ...iso, r, cy, top: cy - r }; });
  circ.forEach((c, k) => g.push(`<circle cx="${CX}" cy="${c.cy.toFixed(2)}" r="${c.r.toFixed(2)}" fill="${RING[k].fill}" stroke="${RING[k].stroke}" stroke-width="${RING[k].w}" stroke-dasharray="${RING[k].dash} ${RING[k].dash}"/>`));
  // each label centred in the band between its circle's top and the next one in; the last in its circle.
  // The second line says what the band holds — stations, parks, bus stops — not its hectares, which nobody reads.
  const reach = walkReachFacts(b, f);
  const bandLine = (minutes: number, areaHa: number) => {
    const r = reach.find((q) => q.minutes === minutes);
    if (!r) return `${fmtNum(areaHa)} ha`;
    const stWord = r.stations.length === 1 ? (r.stations[0].kind === 'light rail' ? 'stop' : 'station') : (r.stations.every((s) => s.kind === 'light rail') ? 'stops' : 'stations');
    const parts2 = [
      r.stations.length ? `${r.stations.length} ${stWord}` : '',
      r.parks ? `${r.parks} park${r.parks === 1 ? '' : 's'}` : '',
      !r.stations.length || !r.parks ? (r.busStops ? `${r.busStops} bus stop${r.busStops === 1 ? '' : 's'}` : (r.schools ? `${r.schools} school${r.schools === 1 ? '' : 's'}` : '')) : '',
    ].filter(Boolean).slice(0, 2);
    return parts2.length ? parts2.join(' · ') : `${fmtNum(areaHa)} ha`;
  };
  const labelTop = circ.map((c, k) => (k < circ.length - 1 ? (c.top + circ[k + 1].top) / 2 : c.cy) - 2.3);
  circ.forEach((c, k) => g.push(txt(CX, labelTop[k], `${c.minutes} min`, S6, 'middle'), txt(CX, labelTop[k] + 2.5, bandLine(c.minutes, c.areaHa), S6, 'middle')));
  const busTop = labelTop.length === 3 ? labelTop : [62.3, 79.1, 95.2];
  const bus: [string, string][] = [
    ['bus stops within 400 m', f.bus.total ? String(f.bus.within400) : '—'],
    ['within 800 m', f.bus.total ? String(f.bus.within800) : '—'],
    ['routes on the map', f.bus.routes ? String(f.bus.routes) : '—'],
  ];
  bus.forEach(([l, v], k) => g.push(txt(C2, busTop[k], l), txt(C2, busTop[k] + 2.5, v)));

  // a bar chart as the template draws it: names down the left, a scale over the right column, dotted gridlines, pale bars
  const ROWH = 3.95, BAR = 1.65, TRACK0 = 138.67;
  const chart = (head: string, headTop: number, rows: { name: string; value: number; label: string; dash?: string }[], max: number, step: number, span: number, axisOff = 12.5, rowsOff = 3.7) => {
    g.push(txt(X0, headTop, head, S10, 'start', 0), hair(X0, X1, headTop + 6.21));
    const axisTop = headTop + axisOff, rowsTop = axisTop + rowsOff;
    const X = (v: number) => TRACK0 + (v / max) * span;
    const gy0 = rowsTop - 0.6, gy1 = rowsTop + rows.length * ROWH - 0.15;
    for (let v = 0; v <= max + 1e-9; v += step) {
      g.push(txt(X(v), axisTop, String(v), S6, v === 0 ? 'start' : 'middle'));
      g.push(`<line x1="${X(v).toFixed(2)}" y1="${gy0.toFixed(2)}" x2="${X(v).toFixed(2)}" y2="${gy1.toFixed(2)}" stroke="#878787" stroke-width="0.18" stroke-linecap="round" stroke-dasharray="0 0.36"/>`);
    }
    rows.forEach((r, i) => {
      const top = rowsTop + i * ROWH, yb = top + 0.6 + BAR / 2, end = X(Math.min(r.value, max));
      g.push(txt(X0, top, r.name));
      g.push(`<line x1="${(TRACK0 - 0.09).toFixed(2)}" y1="${yb.toFixed(2)}" x2="${end.toFixed(2)}" y2="${yb.toFixed(2)}" stroke="#a7dcf8" stroke-width="${BAR}"${r.dash ? ` stroke-dasharray="${r.dash}"` : ''}/>`);
      g.push(txt(end + 1.0, top, r.label));
    });
  };

  // Stations on foot: minutes at 80 m a minute
  const minsOf = (m: number) => m / 80;
  const seen = new Set<string>();
  const shown = f.stations.filter((st) => { const k2 = `${st.name.replace(/ (Slr|Light Rail) Stop$/i, '')}|${st.kind}`; if (seen.has(k2)) return false; seen.add(k2); return true; }).slice(0, 5);
  const maxMin = Math.max(15, Math.ceil(Math.max(0, ...shown.map((st) => minsOf(st.distanceM))) / 5) * 5);
  if (shown.length) chart('Stations on foot', 126.2, shown.map((st) => ({ name: `${st.name.replace(/ (Slr|Light Rail) Stop$/i, '')} ${st.kind}`, value: minsOf(st.distanceM), label: `${walkMinutes(st.distanceM)} min` })), maxMin, 5, 59.24);

  // The network in the window: kilometres, each kind in its own texture
  const net = [
    { name: 'Separated cycleways', m: f.cycle.separatedM },
    { name: 'On-road cycle lanes', m: f.cycle.laneM, dash: '2.26 1.21' },
    { name: 'Shared paths', m: f.cycle.sharedM, dash: '0.92 0.77' },
    { name: 'Footways, paths and steps', m: f.foot.lengthM, dash: '0.59 0.46' },
  ];
  const maxKm = Math.max(10, Math.ceil(Math.max(...net.map((n) => n.m / 1000)) / 10) * 10);
  const kmStep = maxKm <= 50 ? 10 : maxKm <= 100 ? 20 : 50;
  if (f.cycle.osm) chart('The network on the map', 169.6, net.map((n) => ({ name: n.name, value: n.m / 1000, label: `${(n.m / 1000).toFixed(1)} km`, dash: n.dash })), Math.ceil(maxKm / kmStep) * kmStep, kmStep, 58.78, 11.0, 4.0);

  const graphs = `<svg class="abs" style="left:0;top:0" width="${FOLD}mm" height="${SLIDE_H}mm" viewBox="0 0 ${FOLD} ${SLIDE_H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, 'Liberation Sans', sans-serif">${g.join('')}</svg>`;
  const keyRows: LegendEntry[] = legendRows.map(([sv, label]) => ({ swatch: sv.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''), label }));
  const sources = `Sources: NSW Spatial Services roads, rail and stations; walking isochrones from Valhalla on OpenStreetMap; bus stops from ${f.bus.source === 'tfnsw' ? 'Transport for NSW' : 'OpenStreetMap'}; bus routes, cycleways and footways from OpenStreetMap contributors (ODbL); active street frontages from the ePlanning development-control layers; walking minutes are straight-line distance at 80 m a minute. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const figureHtml = `
    <div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">Movement · 1:${fmtNum(p.scale).replace(',', ' ')}</div>
    ${graphs}`;
  void stationTable; void tiles; void textHtml;
  const lga = b.context.lga?.name ? titleCase(b.context.lga.name) : '';
  const subT = [`${b.siteAddress}${lga ? ` ${lga}` : ''}`, f.stations[0] ? `${f.stations[0].name} ${fmtNum(f.stations[0].distanceM)} m` : ''].filter(Boolean).join(' · ');
  // The narrative: the stations, then what the walking bands hold, then the bus line.
  const sens = movementSentences(b, f);
  const reachSentence = sens.find((s2) => s2.startsWith('On foot from the site'));
  const narrative = brief([sens[0], reachSentence, sens[1]]);
  return { id: '09_movement', title: 'Movement', subtitle: subT, textHtml: '', figureHtml, bleed: true, sources, narrative, accent: '#0068b3', legend: keyRows };
}

// ---- slide 10: green and public domain -------------------------------------

/** Canopy classes for the strip: one hue, light to dark, on the dataset's own breaks. */
const CANOPY_CLASSES = [
  { max: 10, fill: '#eef2e4', label: 'under 10 %' },
  { max: 20, fill: '#cfe4d0', label: '10–20 %' },
  { max: 30, fill: '#a8cdb4', label: '20–30 %' },
  { max: 40, fill: '#79ae8e', label: '30–40 %' },
  { max: Infinity, fill: '#4c8a68', label: 'over 40 %' },
];
const canopyFill = (pct: number) => (CANOPY_CLASSES.find((c) => pct < c.max) ?? CANOPY_CLASSES[CANOPY_CLASSES.length - 1]).fill;
const OPEN_SPACE_STYLE: Record<string, { fill: string; stroke: string; word: string }> = {
  RE1: { fill: '#cfe4d0', stroke: '#7fae8c', word: 'public recreation reserve' },
  RE2: { fill: '#e6efe3', stroke: '#aecbb2', word: 'private recreation land' },
  C1: { fill: '#accdb0', stroke: '#6f9e7b', word: 'national park or nature reserve' },
  C2: { fill: '#accdb0', stroke: '#6f9e7b', word: 'conservation land' },
  C3: { fill: '#bcd7bc', stroke: '#6f9e7b', word: 'environmental management land' },
};
const PARK_GREEN = '#37715a', GREEN_GRID_COLOUR = '#37715a', NPWS_COLOUR = '#2f6b50', TREE_DOT = '#4c8a68';
/** Green Grid classes that are open space people use, as against cemeteries, golf courses and operational land. */
const PARK_CLASSES = new Set(['Parks and Gardens', 'Sports', 'Bushland', 'Waterfront', 'Civic', 'OSL', 'Community Purpose', 'Heritage and Cultural']);
const GREEN_GRID_WORD: Record<string, string> = {
  'Parks and Gardens': 'park', Sports: 'sportsground', Bushland: 'bushland', Waterfront: 'foreshore', Civic: 'civic space', OSL: 'open space', 'Community Purpose': 'community land',
  'Heritage and Cultural': 'heritage or cultural land', Cemetery: 'cemetery', 'Golf Course': 'golf course', Operational: 'operational land', Special: 'special use', 'Undeveloped or Unspecified': 'undeveloped land', None: 'open space',
};
const SIG_RANK: Record<string, number> = { Regional: 3, District: 2, Local: 1 };
const FACILITY_LETTER: Record<FacilityKind, string> = { school: 'S', childcare: 'K', library: 'L', community: 'C', pool: 'P', health: 'H', culture: 'A' };
const FACILITY_WORD: Record<FacilityKind, [string, string]> = {
  school: ['school', 'schools'], childcare: ['childcare centre or preschool', 'childcare centres and preschools'], library: ['library', 'libraries'], community: ['community facility', 'community facilities'],
  pool: ['pool or leisure centre', 'pools and leisure centres'], health: ['hospital or health centre', 'hospitals and health centres'], culture: ['museum, gallery or theatre', 'museums, galleries and theatres'],
};
const FACILITY_SHORT: Record<FacilityKind, [string, string]> = { school: ['school', 'schools'], childcare: ['childcare', 'childcare'], library: ['library', 'libraries'], community: ['community', 'community'], pool: ['pool', 'pools'], health: ['health', 'health'], culture: ['museum', 'museums'] };
const CANOPY_CAT_WORD: Record<string, string> = { 'Hospital/Medical': 'hospital', Road: 'road-reserve', Other: 'other' };
const canopyCatWord = (c: string) => CANOPY_CAT_WORD[c] ?? c.toLowerCase();
const NAME_ACRONYMS = new Set(['PCYC', 'RSL', 'TAFE', 'UTS', 'UNSW', 'ACU', 'YMCA', 'YWCA', 'CBD', 'ANZAC', 'NSW']);
const tidyName = (s: string) => s.trim().replace(/[,.;:\s]+$/, '').replace(/([/-]\s?|\b[A-Za-z]['’])([a-z])/g, (_m, p, c) => p + c.toUpperCase()).replace(/['’]S\b/g, "'s").replace(/\bMc([a-z])/g, (_m, c) => `Mc${c.toUpperCase()}`)
  .replace(/\b(And|Of|The)\b(?!$)/g, (m, _w, off) => (off === 0 ? m : m.toLowerCase())).replace(/\b[A-Za-z]{2,5}\b/g, (w) => (NAME_ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w)).replace(/\s+/g, ' ');
/** Closer than this to the site's boundary, an open space adjoins it. */
const ADJOINS_M = 12;
const walkPhrase = (m: number | null) => (m === 5 ? 'within a five-minute walk' : m === 10 ? 'five to ten minutes on foot' : m === 15 ? 'ten to fifteen minutes on foot' : 'beyond a fifteen-minute walk');
const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

interface OpenSpaceEntity {
  name?: string; kind: string; cls?: string; significance?: string; source: 'greengrid' | 'zoning'; rings: number[][][];
  areaHa: number; distanceM: number; bearing: number; walkBand: number | null; park: boolean; windowMm2: number;
}

export function greenFacts(b: SlidesBundle) {
  const g = b.green;
  const p = b.daPanel;
  const proj = panelProjector(p);
  const centre = p.center;
  const centreLL = mercatorToLonLat(centre);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const siteMerc = siteRings.flat().map(([lon, lat]) => toM(lon, lat));
  const distFromSite = (lon: number, lat: number) => { const m = toM(lon, lat); let d = Infinity; for (const s of siteMerc) d = Math.min(d, Math.hypot(s.x - m.x, s.y - m.y)); return d / k; };
  const bearingFrom = (lon: number, lat: number) => { const m = toM(lon, lat); return ((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360; };
  const ringAreaM2 = (ring: number[][]) => { let s = 0; const pts = ring.map(([lon, lat]) => toM(lon, lat)); for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; s += a.x * c.y - c.x * a.y; } return Math.abs(s / 2) / (k * k); };
  const isos = b.movement?.isochrones ?? [];
  const walkBand = (rings: number[][][]): number | null => {
    for (const min of ISO_MINUTES) {
      const iso = isos.find((i) => i.minutes === min);
      if (!iso) continue;
      for (const r of rings) { const step = Math.max(1, Math.floor(r.length / 80)); for (let i = 0; i < r.length; i += step) if (iso.rings.some((ir) => pointInRing(r[i][0], r[i][1], ir))) return min; }
    }
    return null;
  };
  const nearestVertex = (rings: number[][][]) => { let best = { d: Infinity, lon: centreLL.lon, lat: centreLL.lat }; for (const r of rings) for (const [lon, lat] of r) { const d = distFromSite(lon, lat); if (d < best.d) best = { d, lon, lat }; } return best; };
  const windowArea = (rings: number[][][]) => rings.reduce((a, r) => a + clippedStats(r, proj, p).area, 0);
  const make = (o: Omit<OpenSpaceEntity, 'areaHa' | 'distanceM' | 'bearing' | 'walkBand' | 'windowMm2'>): OpenSpaceEntity => {
    const nv = nearestVertex(o.rings);
    return { ...o, areaHa: Math.round(o.rings.reduce((a, r) => a + ringAreaM2(r), 0) / 100) / 100, distanceM: Math.round(nv.d), bearing: bearingFrom(nv.lon, nv.lat), walkBand: walkBand(o.rings), windowMm2: windowArea(o.rings) };
  };

  // The open spaces: Green Grid assets merged by name where the Grid reaches, and every recreation or conservation zone polygon the Grid does not already cover, named by the open-space point inside it.
  const merged = new Map<string, { name: string; cls: string; significance: string; rings: number[][][] }>();
  for (const a of g.greenGrid) {
    const name = tidyName(a.name) || 'Unnamed open space';
    const key = name.toUpperCase();
    const cur = merged.get(key);
    if (cur) { cur.rings.push(...a.rings); if ((SIG_RANK[a.significance] ?? 0) > (SIG_RANK[cur.significance] ?? 0)) cur.significance = a.significance; }
    else merged.set(key, { name, cls: a.cls, significance: a.significance, rings: [...a.rings] });
  }
  const spaces: OpenSpaceEntity[] = [];
  for (const a of merged.values()) spaces.push(make({ name: a.name, kind: GREEN_GRID_WORD[a.cls] ?? a.cls.toLowerCase(), cls: a.cls, significance: a.significance, source: 'greengrid', rings: a.rings, park: PARK_CLASSES.has(a.cls) }));
  // A zone polygon a Green Grid asset already stands for (either's centroid inside the other, or the same name) is not counted twice; the rest merge by the name of the point inside them, and unnamed slivers under 500 m² are left to the drawing.
  const ggRings = g.greenGrid.flatMap((a) => a.rings);
  const ggCentroids = g.greenGrid.map((a) => centroidLL(a.rings.slice().sort((r1, r2) => ringAreaM2(r2) - ringAreaM2(r1))[0]));
  const bbox = (rings: number[][][]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1 }; };
  const ggBoxes = g.greenGrid.map((a) => bbox(a.rings));
  // how much of a zone polygon's bounding box a Green Grid asset's covers
  const boxOverlap = (zb: ReturnType<typeof bbox>) => Math.max(0, ...ggBoxes.map((gb) => { const w = Math.min(zb.x1, gb.x1) - Math.max(zb.x0, gb.x0), h = Math.min(zb.y1, gb.y1) - Math.max(zb.y0, gb.y0); const za = (zb.x1 - zb.x0) * (zb.y1 - zb.y0); return w > 0 && h > 0 && za > 0 ? (w * h) / za : 0; }));
  const zoneByName = new Map<string, { name?: string; code: string; rings: number[][][] }>();
  for (const z of g.openSpace) {
    const big = z.rings.slice().sort((r1, r2) => ringAreaM2(r2) - ringAreaM2(r1))[0];
    const c = centroidLL(big);
    if (ggRings.some((r) => pointInRing(c[0], c[1], r)) || ggCentroids.some((gc) => z.rings.some((r) => pointInRing(gc[0], gc[1], r))) || (g.greenGrid.length && boxOverlap(bbox(z.rings)) >= 0.6)) continue;
    const inside = g.parkPoints.filter((pt) => z.rings.some((r) => pointInRing(pt.lon, pt.lat, r)));
    const named = inside.find((pt) => pt.kind === 'Park') ?? inside[0];
    const name = named ? tidyName(named.name) : undefined;
    if (name && merged.has(name.toUpperCase())) continue;
    const key = name ? `${z.code}:${name.toUpperCase()}` : `${z.code}:#${zoneByName.size}`;
    const cur = zoneByName.get(key);
    if (cur) cur.rings.push(...z.rings); else zoneByName.set(key, { name, code: z.code, rings: [...z.rings] });
  }
  for (const z of zoneByName.values()) {
    const st = OPEN_SPACE_STYLE[z.code];
    const e = make({ name: z.name, kind: st?.word ?? z.code, source: 'zoning', rings: z.rings, park: z.code === 'RE1' });
    if (e.name || e.areaHa >= 0.05) spaces.push(e);
  }
  spaces.sort((x, y) => x.distanceM - y.distanceM);
  const parks = spaces.filter((s) => s.park);

  // Public open space as a share of the window's land (the RE1 zone, clipped to the window; water taken out of the land).
  const mm2ToHa = (p.scale / 1000) ** 2 / 1e4;
  const windowMm2 = p.wMm * p.hMm;
  const waterMm2 = Math.min(windowMm2, b.base.water.features.flatMap((f) => geomRings(f.geometry)).reduce((a, r) => a + clippedStats(r, proj, p).area, 0));
  const re1Mm2 = g.openSpace.filter((z) => z.code === 'RE1').reduce((a, z) => a + windowArea(z.rings), 0);
  const landMm2 = Math.max(1, windowMm2 - waterMm2);

  // Canopy: the site's mesh block, and area-weighted shares over the window and the strip (water blocks left out of the land).
  const blocks = g.canopy.blocks;
  const siteBlock = blocks.find((bl) => bl.rings.some((r) => pointInRing(centreLL.lon, centreLL.lat, r))) ?? null;
  const weighted = (pr: Proj, panel: Panel) => {
    let a = 0, ap = 0, a10 = 0, av = 0;
    const cats = new Map<string, { a: number; ap: number }>();
    for (const bl of blocks) {
      if (bl.cat === 'Water') continue;
      let area = 0;
      for (const r of bl.rings) area += clippedStats(r, pr, panel).area;
      if (area <= 0) continue;
      a += area; ap += area * bl.pct; a10 += area * bl.over10Pct; av += area * bl.vegPct;
      const c = cats.get(bl.cat) ?? { a: 0, ap: 0 }; c.a += area; c.ap += area * bl.pct; cats.set(bl.cat, c);
    }
    if (!a) return null;
    return { pct: ap / a, over10Pct: a10 / a, vegPct: av / a, byCategory: [...cats.entries()].map(([cat, c]) => ({ cat, pct: c.ap / c.a, shareOfLandPct: (c.a / a) * 100 })).sort((x, y) => y.shareOfLandPct - x.shareOfLandPct) };
  };

  const facilities = g.facilities.map((f) => ({ ...f, name: tidyName(f.name), distanceM: Math.round(distFromSite(f.lon, f.lat)), bearing: bearingFrom(f.lon, f.lat) })).sort((x, y) => x.distanceM - y.distanceM);
  const facilityCounts = (Object.keys(FACILITY_WORD) as FacilityKind[]).map((kind) => ({ kind, n: facilities.filter((f) => f.kind === kind).length })).filter((c) => c.n);
  const crowns = g.trees.points.map((t) => t.canopyM).sort((x, y) => x - y);
  const npws = g.npws.map((n) => { const nv = nearestVertex(n.rings); return { name: n.name, type: n.type, distanceM: Math.round(nv.d), bearing: bearingFrom(nv.lon, nv.lat) }; }).sort((x, y) => x.distanceM - y.distanceM);

  return {
    windowM: { w: Math.round((p.wMm / 1000) * p.scale), h: Math.round((p.hMm / 1000) * p.scale) },
    wideKm: { w: Math.round(((b.wide.panel.wMm / 1000) * b.wide.panel.scale) / 100) / 10, h: Math.round(((b.wide.panel.hMm / 1000) * b.wide.panel.scale) / 100) / 10 },
    canopy: {
      covered: g.canopy.covered, year: g.canopy.year, source: g.canopy.source, targetPct: 40,
      siteBlock: siteBlock ? { pct: siteBlock.pct, over10Pct: siteBlock.over10Pct, vegPct: siteBlock.vegPct, areaHa: siteBlock.areaHa, cat: siteBlock.cat, type: siteBlock.type } : null,
      window: weighted(proj, p), wide: weighted(panelProjector(b.wide.panel), b.wide.panel),
    },
    openSpace: {
      publicHa: Math.round(re1Mm2 * mm2ToHa * 10) / 10, publicShareOfLandPct: (re1Mm2 / landMm2) * 100, zonesPresent: [...new Set(g.openSpace.map((z) => z.code))],
      spaces, parks: parks.length, nearest: parks[0] ?? null, largest: parks.slice().sort((x, y) => y.areaHa - x.areaHa)[0] ?? null,
      within: isos.length ? ISO_MINUTES.map((m) => ({ minutes: m, parks: parks.filter((s) => s.walkBand !== null && s.walkBand <= m).length })) : [],
      greenGrid: { assets: merged.size, districtOrRegional: [...merged.values()].filter((a) => (SIG_RANK[a.significance] ?? 0) >= 2).map((a) => ({ name: a.name, significance: a.significance })) },
    },
    facilities, facilityCounts,
    trees: { count: g.trees.points.length, nearSite: g.trees.points.filter((t) => distFromSite(t.lon, t.lat) <= 30).length, medianCrownM: crowns.length ? crowns[Math.floor(crowns.length / 2)] : null, source: g.trees.source ?? null },
    npws,
  };
}

export function greenSentences(b: SlidesBundle, f: ReturnType<typeof greenFacts>): string[] {
  const out: string[] = [];
  const c = f.canopy;
  if (c.covered && c.siteBlock) {
    const sb = c.siteBlock;
    let s = `Tree canopy covered ${fmtPct(sb.pct)} of the site's mesh block in ${c.year} (${sb.areaHa >= 0.1 ? `${fmtNum(sb.areaHa, 1)} ha of ${canopyCatWord(sb.cat)} land` : `a ${canopyCatWord(sb.cat)} block of ${fmtNum(Math.round(sb.areaHa * 1e4))} m²`})`;
    if (c.window) s += `, ${fmtPct(c.window.pct)} of the land in the ${fmtNum(f.windowM.w)} × ${fmtNum(f.windowM.h)} m window`;
    if (c.wide) s += ` and ${fmtPct(c.wide.pct)} across the ${f.wideKm.w} × ${f.wideKm.h} km strip`;
    s += `, against the Region Plan's ${c.targetPct} % target for Greater Sydney.`;
    if (sb.over10Pct > 0) s += ` Vegetation over 10 m tall covers ${fmtPct(sb.over10Pct)} of the block.`;
    out.push(s);
    const cat = (name: string) => c.window?.byCategory.find((x) => x.cat === name);
    const road = cat('Road'), res = cat('Residential'), rec = cat('Recreational');
    if (road && res) out.push(`Within the window the canopy is ${fmtPct(road.pct)} over the road reserves${rec ? `, ${fmtPct(res.pct)} over residential blocks and ${fmtPct(rec.pct)} over recreation land` : ` and ${fmtPct(res.pct)} over residential blocks`}.`);
  } else if (c.covered) out.push(`The site's block is not among the mapped canopy mesh blocks; across the window's land the ${c.year} canopy is ${c.window ? fmtPct(c.window.pct) : 'unknown'}, against the Region Plan's ${c.targetPct} % target.`);
  else out.push(`The Greater Sydney tree canopy dataset (${c.year}) does not reach this window, so canopy cover is not mapped here.`);

  const o = f.openSpace;
  if (o.parks && o.nearest && o.largest) {
    const name = (s: OpenSpaceEntity) => s.name ?? `an unnamed ${s.kind}`;
    const one = o.parks === 1;
    const count = one ? 'one park or reserve' : `${o.parks} parks and reserves`;
    let s = o.publicHa > 0
      ? `Public open space (RE1) covers ${fmtNum(o.publicHa, 1)} ha of the window, ${fmtPct(o.publicShareOfLandPct)} of its land, in ${count}`
      : `${one ? 'One park or reserve falls' : `${count} fall`} in the window, none of it zoned RE1`;
    s += o.nearest.distanceM < ADJOINS_M
      ? `. ${one ? `${name(o.nearest).replace(/^an /, 'An ')} (${fmtNum(o.nearest.areaHa, 1)} ha)` : `The nearest, ${name(o.nearest)},`} adjoins the site on its ${bearingName(o.nearest.bearing)} side`
      : `. ${one ? `${name(o.nearest)} (${fmtNum(o.nearest.areaHa, 1)} ha)` : `The nearest, ${name(o.nearest)},`} is ${fmtNum(o.nearest.distanceM)} m to the ${bearingName(o.nearest.bearing)}${o.nearest.walkBand ? `, ${walkPhrase(o.nearest.walkBand)}` : ''}`;
    s += one ? '.' : o.largest !== o.nearest ? `; the largest is ${name(o.largest)}, ${fmtNum(o.largest.areaHa, 1)} ha.` : `, and at ${fmtNum(o.largest.areaHa, 1)} ha the largest.`;
    out.push(s);
    if (o.greenGrid.assets) {
      const dr = o.greenGrid.districtOrRegional;
      const bySig = ['Regional', 'District'].map((sig) => ({ sig, names: dr.filter((a) => a.significance === sig).map((a) => a.name) })).filter((x) => x.names.length);
      const sig = bySig.length ? `; ${bySig.map((x) => `${listWords(x.names)} ${x.names.length === 1 ? 'is' : 'are'} of ${x.sig.toLowerCase()} significance`).join(' and ')}` : '';
      if (one && o.greenGrid.assets === 1) out.push(`It is a Green Grid asset${bySig.length ? `, of ${bySig[0].sig.toLowerCase()} significance` : ', of local significance'}.`);
      else out.push(`${o.greenGrid.assets === 1 ? 'One' : o.greenGrid.assets} of the window's open spaces ${o.greenGrid.assets === 1 ? 'is a Green Grid asset' : 'are Green Grid assets'}${sig || (o.greenGrid.assets === 1 ? ', of local significance' : ', all of local significance')}.`);
    }
    if (o.within.length && !one) {
      const w = (m: number) => o.within.find((x) => x.minutes === m)?.parks ?? 0;
      out.push(`On foot from the site, ${w(5)} of them ${w(5) === 1 ? 'lies' : 'lie'} within five minutes and ${w(10)} within ten.`);
    }
  } else out.push('No park or reserve falls within the window: no land zoned for public recreation and no Green Grid asset.');

  if (f.facilities.length) {
    const groups = f.facilityCounts.map(({ kind, n }) => `${n === 1 ? (/^[aeiou]/.test(FACILITY_WORD[kind][0]) ? 'an' : 'a') + ' ' + FACILITY_WORD[kind][0] : FACILITY_WORD[kind][1]}: ${f.facilities.filter((x) => x.kind === kind).slice(0, 4).map((x) => x.name).join(', ')}${n > 4 ? ` and ${n - 4} more` : ''}`);
    out.push(`Public facilities in the window: ${groups.join('; ')}.`);
  } else out.push('No school, childcare centre, library, pool, health or community facility is mapped in the window.');
  if (f.trees.count) out.push(`${f.trees.source?.name ?? 'The council inventory'} records ${fmtNum(f.trees.count)} trees in the window${f.trees.nearSite ? `, ${f.trees.nearSite} of them within 30 m of the site` : ''}${f.trees.medianCrownM ? `; the typical crown is ${fmtNum(f.trees.medianCrownM)} m across` : ''}.`);
  if (f.npws.length) out.push(`${f.npws[0].name} (${f.npws[0].type.toLowerCase()}) lies ${fmtNum(f.npws[0].distanceM)} m to the ${bearingName(f.npws[0].bearing)}.`);
  return out;
}

export function greenSlide(b: SlidesBundle): Slide {
  const f = greenFacts(b);
  const g = b.green;
  const t = tpl();
  const sentences = greenSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the green network offers the site and what the site can give back (a through-link, a frontage to the park, canopy on the street), where the deep soil and the big trees should go, and which public facilities the new residents will use.') +
    `<div class="fine">Sources: tree canopy from NSW ePlanning's Greater Sydney Tree Canopy Cover 2022 (2 m Geoscape surface features by modified mesh block); recreation and conservation zones from EPI_Primary_Planning_Layers; Green Grid existing assets, open-space and facility points from the ePlanning public-spaces layers; NPWS estate from DCCEEW; schools and facilities also from NSW Spatial Services features of interest${f.trees.source ? `; ${f.trees.source.attribution}` : ''}; walking isochrones from Valhalla on OpenStreetMap; roads, rail, water and cadastre from NSW Spatial Services. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f.canopy.siteBlock ? `canopy ${fmtPct(f.canopy.siteBlock.pct)} on the block` : '', f.openSpace.nearest ? `${f.openSpace.nearest.name ?? 'open space'} ${f.openSpace.nearest.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(f.openSpace.nearest.distanceM)} m`}` : ''].filter(Boolean).join(' · ');

  // The tall panel: open space, the Green Grid, the NPWS estate, walking reach, street trees, facilities.
  const p = b.daPanel;
  const proj = panelProjector(p);
  const parts: string[] = [baseLayers(b.base, proj, p)];
  for (const code of ['RE2', 'C3', 'C2', 'C1', 'RE1']) {
    const zs = g.openSpace.filter((z) => z.code === code);
    if (!zs.length) continue;
    const st = OPEN_SPACE_STYLE[code];
    const d = zs.map((z) => ringsPath(z.rings, proj)).join('');
    parts.push(`<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="0.2" fill-rule="evenodd"/>`);
    if (code === 'RE1') parts.push(dotsPath(d, 'osdots', st.stroke, bboxOf(zs.flatMap((z) => z.rings), proj), 2, 0.26, 0.7));
  }
  let hatchId = 0;
  for (const n of g.npws) parts.push(hatchPath(ringsPath(n.rings, proj), `npws${hatchId++}`, NPWS_COLOUR, bboxOf(n.rings, proj), 1.4));
  if (g.greenGrid.length) parts.push(`<path d="${g.greenGrid.map((a) => ringsPath(a.rings, proj)).join('')}" fill="none" stroke="${GREEN_GRID_COLOUR}" stroke-width="0.35" stroke-dasharray="1.2,0.7" fill-rule="evenodd"/>`);
  const isos = b.movement?.isochrones ?? [];
  for (const iso of [...isos].sort((x, y) => y.minutes - x.minutes))
    parts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="none" stroke="${ISO_FILL[iso.minutes] ?? '#a8cdc2'}" stroke-width="0.45" stroke-dasharray="1.6,1" fill-rule="evenodd"/>`);
  parts.push(overLayers(b.base, proj, p, 'wash'));
  if (g.trees.points.length) {
    const mmPerM = 1000 / p.scale;
    parts.push(`<g fill="${TREE_DOT}" fill-opacity="0.55" stroke="${TREE_DOT}" stroke-width="0.1">${g.trees.points.map((tr) => { const [x, y] = proj(tr.lon, tr.lat); const r = Math.min(1.6, Math.max(0.28, (tr.canopyM / 2) * mmPerM)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/>`; }).join('')}</g>`);
  }
  const spacer = new LabelSpacer(p.wMm, p.hMm, 40);
  const isoSpacer = spacer;
  // the site's outline and its name keep their room
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  if (siteRings.length) { const sb = bboxOf(siteRings, proj); spacer.take((sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2 - 1.5, sb.x1 - sb.x0 + 2, sb.y1 - sb.y0 + 5); }
  for (const iso of isos) {
    const pts = iso.rings[0]?.map(([lon, lat]) => proj(lon, lat)) ?? [];
    const top = pts.filter((q) => q[0] > 3 && q[0] < p.wMm - 3 && q[1] > 3 && q[1] < p.hMm - 3).sort((q, r) => q[1] - r[1])[0];
    if (top && isoSpacer.take(top[0], top[1] - 1.5, 9, 2.6)) parts.push(label(top[0], top[1] - 1.5, `${iso.minutes} min`, 2, ISO_FILL[iso.minutes] ?? '#6ba998'));
  }
  // Park names at the centroid of what falls inside the window, largest first.
  const labels: string[] = [];
  for (const s of [...f.openSpace.spaces].sort((x, y) => y.windowMm2 - x.windowMm2)) {
    if (!s.name || s.windowMm2 < 10) continue;
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of s.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    const size = s.windowMm2 > 60 ? 2.1 : 1.85;
    if (spacer.take(best.cx, best.cy, labelW(s.name, size), size * 1.3)) labels.push(`<text x="${best.cx.toFixed(1)}" y="${(best.cy + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="600" fill="${PARK_GREEN}" stroke="#ffffff" stroke-width="${(size * 0.22).toFixed(2)}" paint-order="stroke">${esc(s.name)}</text>`);
  }
  for (const n of g.npws) {
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of n.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    if (best.area > 10 && spacer.take(best.cx, best.cy, labelW(n.name, 2.1), 2.8)) labels.push(label(best.cx, best.cy, n.name, 2.1, NPWS_COLOUR));
  }
  // Facilities: a lettered square and the name beside it.
  const facilityMarks: string[] = [];
  for (const fa of f.facilities) {
    const [x, y] = proj(fa.lon, fa.lat);
    if (x < 1 || y < 1 || x > p.wMm - 1 || y > p.hMm - 1) continue;
    facilityMarks.push(`<rect x="${(x - 1.25).toFixed(1)}" y="${(y - 1.25).toFixed(1)}" width="2.5" height="2.5" fill="${t.ink}" stroke="#ffffff" stroke-width="0.3"/><text x="${x.toFixed(1)}" y="${(y + 0.6).toFixed(1)}" text-anchor="middle" font-size="1.7" font-weight="600" fill="#ffffff">${FACILITY_LETTER[fa.kind]}</text>`);
    const w = labelW(fa.name, 1.85);
    for (const [lx, ly] of [[x + 1.9 + w / 2, y], [x - 1.9 - w / 2, y], [x, y + 2.9], [x, y - 2.9], [x, y + 5.4], [x, y - 5.4]] as [number, number][])
      if (spacer.take(lx, ly, w, 2.5)) { labels.push(label(lx, ly, fa.name, 1.85, '#2a3534')); break; }
  }
  parts.push(...facilityMarks, ...labels, siteMark(b.base, proj, 'outline'), panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-green"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-green)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, legend, the open-space table.
  const rightX = AUX_X, rightW = AUX_W;
  const near = f.openSpace.nearest;
  const c = f.canopy;
  const tiles = [
    { v: c.siteBlock ? fmtPct(c.siteBlock.pct) : '—', l: c.siteBlock ? `tree canopy ${c.year} on the site's mesh block${c.window ? ` · ${fmtPct(c.window.pct)} across the window` : ''}` : c.covered ? 'canopy: the site\'s block is not in the dataset' : 'canopy: the Greater Sydney dataset does not reach here' },
    { v: f.openSpace.zonesPresent.includes('RE1') ? fmtPct(f.openSpace.publicShareOfLandPct) : '—', l: f.openSpace.zonesPresent.includes('RE1') ? `of the window's land is public open space (RE1) · ${fmtNum(f.openSpace.publicHa, 1)} ha` : 'no land zoned for public recreation in the window' },
    { v: near ? (near.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(near.distanceM)} m`) : '—', l: near ? (near.distanceM < ADJOINS_M ? `${near.name ?? `a ${near.kind}`} on the site's ${bearingName(near.bearing)} boundary` : `to ${near.name ?? `the nearest ${near.kind}`}${near.walkBand ? `, within ${near.walkBand} min on foot` : ''}`) : 'no park or reserve in the window' },
    { v: f.facilities.length ? String(f.facilities.length) : '—', l: f.facilities.length ? `public facilit${f.facilities.length === 1 ? 'y' : 'ies'}: ${f.facilityCounts.map(({ kind, n }) => `${n} ${FACILITY_SHORT[kind][n === 1 ? 0 : 1]}`).join(', ')}` : 'no school, library, pool or community facility mapped' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const sw = (inner: string) => `<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${inner}</svg>`;
  const legendRows: [string, string][] = [];
  const zonesPresent = f.openSpace.zonesPresent;
  if (zonesPresent.includes('RE1')) legendRows.push([sw(`<rect x="0" y="0.4" width="5" height="2.8" fill="${OPEN_SPACE_STYLE.RE1.fill}" stroke="${OPEN_SPACE_STYLE.RE1.stroke}" stroke-width="0.25"/>`), 'Public open space (RE1 public recreation zone)']);
  if (zonesPresent.includes('RE2')) legendRows.push([sw(`<rect x="0" y="0.4" width="5" height="2.8" fill="${OPEN_SPACE_STYLE.RE2.fill}" stroke="${OPEN_SPACE_STYLE.RE2.stroke}" stroke-width="0.25"/>`), 'Private recreation (RE2)']);
  if (zonesPresent.some((z) => z.startsWith('C'))) legendRows.push([sw(`<rect x="0" y="0.4" width="5" height="2.8" fill="${OPEN_SPACE_STYLE.C2.fill}" stroke="${OPEN_SPACE_STYLE.C2.stroke}" stroke-width="0.25"/>`), `Conservation zones (${zonesPresent.filter((z) => z.startsWith('C')).join(', ')})`]);
  if (g.greenGrid.length) legendRows.push([sw(`<rect x="0.3" y="0.4" width="4.4" height="2.8" fill="none" stroke="${GREEN_GRID_COLOUR}" stroke-width="0.35" stroke-dasharray="1.2,0.7"/>`), 'Green Grid existing asset (Greater Sydney Green Grid), named']);
  if (g.npws.length) legendRows.push([sw(`<rect x="0" y="0.4" width="5" height="2.8" fill="none" stroke="${NPWS_COLOUR}" stroke-width="0.3"/><line x1="0" y1="3.2" x2="2.8" y2="0.4" stroke="${NPWS_COLOUR}" stroke-width="0.22"/><line x1="2.2" y1="3.2" x2="5" y2="0.4" stroke="${NPWS_COLOUR}" stroke-width="0.22"/>`), 'National Parks and Wildlife Service estate']);
  if (g.trees.points.length) legendRows.push([sw(`<circle cx="1.2" cy="1.8" r="0.5" fill="${TREE_DOT}" fill-opacity="0.6"/><circle cx="2.6" cy="1.8" r="0.8" fill="${TREE_DOT}" fill-opacity="0.6"/><circle cx="4.2" cy="1.8" r="0.6" fill="${TREE_DOT}" fill-opacity="0.6"/>`), `Trees at crown size (${f.trees.source?.name ?? 'council inventory'})`]);
  if (f.facilities.length) legendRows.push([sw(`<rect x="1.25" y="0.55" width="2.5" height="2.5" fill="${t.ink}"/><text x="2.5" y="2.4" text-anchor="middle" font-size="1.7" font-weight="600" fill="#ffffff">${FACILITY_LETTER[f.facilityCounts[0].kind]}</text>`), `Public facilities: ${f.facilityCounts.map(({ kind }) => `${FACILITY_LETTER[kind]} ${FACILITY_WORD[kind][0]}`).join(', ')}`]);
  if (isos.length) legendRows.push([sw(`<path d="M0,1.8 H5" stroke="${ISO_FILL[5]}" stroke-width="0.45" stroke-dasharray="1.6,1"/>`), `Walking isochrones from the site: ${isos.map((i) => i.minutes).sort((x, y) => x - y).join(', ')} minutes`]);
  if (c.covered) legendRows.push([sw(CANOPY_CLASSES.map((cl, i) => `<rect x="${i}" y="0.4" width="1" height="2.8" fill="${cl.fill}"/>`).join('') + `<rect x="0" y="0.4" width="5" height="2.8" fill="none" stroke="#a9a69b" stroke-width="0.15"/>`), `Tree canopy ${c.year} by mesh block, in the strip below: ${CANOPY_CLASSES[0].label} to ${CANOPY_CLASSES[CANOPY_CLASSES.length - 1].label}`]);
  const legend = legendRows.map(([s, txt]) => `<div class="lg">${s}<span>${esc(txt)}</span></div>`).join('');
  const yTable = FIELD_Y + PANEL_TITLE_H + 32 + legendRows.length * 3.7 + 4;
  const tableRoom = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H - (yTable + PANEL_TITLE_H);
  const maxRows = Math.max(2, Math.min(7, Math.floor((tableRoom - 6) / 4.7)));
  const kindWord = (s: OpenSpaceEntity) => `${s.kind}${s.significance && (SIG_RANK[s.significance] ?? 0) >= 2 ? ` · ${s.significance.toLowerCase()}` : ''}`;
  const rows = f.openSpace.spaces.filter((s) => s.park).slice(0, maxRows).map((s) => `<tr><td>${esc(s.name ?? `Unnamed ${s.kind}`)}</td><td>${esc(kindWord(s))}</td><td class="r">${s.areaHa >= 0.1 ? `${fmtNum(s.areaHa, 1)} ha` : `${fmtNum(Math.round(s.areaHa * 1e4))} m²`}</td><td class="r">${s.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(s.distanceM)} m`}</td><td>${esc(bearingName(s.bearing))}</td><td>${isos.length ? (s.walkBand ? `within ${s.walkBand} min` : 'over 15 min') : '—'}</td></tr>`).join('');
  const table = rows
    ? `<table class="da"><thead><tr><th>Open space</th><th style="width:30mm">Kind</th><th class="r" style="width:14mm">Area</th><th class="r" style="width:14mm">Distance</th><th style="width:17mm">Direction</th><th style="width:20mm">On foot</th></tr></thead><tbody>${rows}</tbody></table>`
    : emptyBox(rightW, 24, 'no park or reserve within the window');

  // Bottom: the canopy strip.
  const wp = b.wide.panel;
  const wproj = panelProjector(wp);
  const wparts: string[] = [`<rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}" fill="#ffffff"/>`];
  const wideZones = g.openSpaceWide ?? [];
  if (c.covered) {
    const byClass = new Map<string, string[]>();
    for (const bl of g.canopy.blocks) { if (bl.cat === 'Water') continue; const fill = canopyFill(bl.pct); (byClass.get(fill) ?? byClass.set(fill, []).get(fill)!).push(ringsPath(bl.rings, wproj)); }
    for (const [fill, ds] of byClass) wparts.push(`<path d="${ds.join('')}" fill="${fill}" stroke="#ffffff" stroke-width="0.08" fill-rule="evenodd"/>`);
  } else {
    for (const code of ['RE2', 'C3', 'C2', 'C1', 'RE1']) {
      const zs = wideZones.filter((z) => z.code === code);
      if (!zs.length) continue;
      const st = OPEN_SPACE_STYLE[code];
      wparts.push(`<path d="${zs.map((z) => ringsPath(z.rings, wproj)).join('')}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="0.15" fill-rule="evenodd"/>`);
    }
  }
  if (b.wide.base.water.features.length) wparts.push(`<path d="${fcPath(b.wide.base.water, wproj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  wparts.push(overLayers(b.wide.base, wproj, wp, 'none'));
  wparts.push(wideStripLabels(b, wproj, wp));
  if (c.covered) {
    // the class key, inside the strip
    let x = 3;
    const keyParts: string[] = [];
    keyParts.push(`<text x="${x}" y="3.1" font-size="2" font-weight="600" fill="#454f4b">Canopy ${c.year}</text>`);
    x += labelW(`Canopy ${c.year}`, 2) + 1.5;
    for (const cl of CANOPY_CLASSES) {
      keyParts.push(`<rect x="${x.toFixed(1)}" y="0.9" width="2.8" height="2.8" fill="${cl.fill}" stroke="#a9a69b" stroke-width="0.15"/><text x="${(x + 3.6).toFixed(1)}" y="3.1" font-size="2" fill="#454f4b">${esc(cl.label)}</text>`);
      x += 3.6 + labelW(cl.label, 2) + 1.2;
    }
    wparts.push(`<g transform="translate(2.5,2.5)"><rect x="-1" y="-0.6" width="${(x - 1).toFixed(1)}" height="5" fill="#ffffff" fill-opacity="0.92" stroke="#c9c0b0" stroke-width="0.2"/>${keyParts.join('')}</g>`);
  } else wparts.push(emptyNote([`The Greater Sydney tree canopy dataset does not reach this window${wideZones.length ? ': the recreation and conservation zones instead' : ''}.`]));
  const wideSvg = `<svg width="${wp.wMm}mm" height="${wp.hMm}mm" viewBox="0 0 ${wp.wMm} ${wp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-canopy"><rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-canopy)" font-family="${t.font}">${wparts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${wp.wMm - 0.2}" height="${wp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  const yWide = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Green and public domain<span class="pnote">1:${fmtNum(p.scale)}</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles two" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 30}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${yTable}mm;width:${rightW}mm">Open space<span class="pnote">nearest first · distance from the site boundary</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yTable + PANEL_TITLE_H}mm;width:${rightW}mm">${table}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yWide}mm;width:${FIELD_W}mm">${c.covered ? `Tree canopy ${c.year}` : 'Open space around the site'}<span class="pnote">1:${fmtNum(wp.scale)} · ${c.covered ? `canopy share of each mesh block${c.wide ? ` · ${fmtPct(c.wide.pct)} of the strip's land` : ''}` : 'recreation and conservation zones · canopy is not mapped here'} · the dashed box is the map above</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yWide + PANEL_TITLE_H}mm">${wideSvg}</div>`;
  return { id: '10_green_public_domain', title: 'Green and public domain', subtitle: sub, textHtml, figureHtml };
}

/** Green and public domain on the template: the green family, the kind of open space told by pattern. */
export function greenAtlas(b0: SlidesBundle): Slide {
  const b: SlidesBundle = { ...b0, daPanel: b0.bleedPanel };
  const t = tpl();
  const f = greenFacts(b);
  const g = b.green;
  const G = INK.green;
  const ZONE_FILL: Record<string, Fill> = {
    RE1: { bg: G.mid, outline: G.solid, outlineW: 0.2 },
    RE2: { bg: '#ffffff', kind: 'vlines', ink: G.line, step: 0.8, w: 0.15, outline: G.solid, outlineW: 0.2 },
    C: { bg: '#ffffff', kind: 'dots', ink: G.deep, step: 0.9, w: 0.12, outline: G.solid, outlineW: 0.2 },
  };
  const NPWS_FILL: Fill = { bg: '#ffffff', kind: 'hlines', ink: G.deep, step: 0.7, w: 0.14, outline: G.deep, outlineW: 0.2 };
  const VEG_FILL: Fill = AERIAL_GREEN_FILL;
  const GRID_DASH = '1.2 0.7';
  const p = b.bleedPanel;
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  for (const [key, codes] of [['RE2', ['RE2']], ['C', ['C3', 'C2', 'C1']], ['RE1', ['RE1']]] as [string, string[]][]) {
    const zs = g.openSpace.filter((z) => codes.includes(z.code));
    if (zs.length) parts.push(fillShape(zs.map((z) => ringsPath(z.rings, proj)).join(''), box, ZONE_FILL[key]));
  }
  if (g.npws.length) parts.push(fillShape(g.npws.map((n) => ringsPath(n.rings, proj)).join(''), box, NPWS_FILL));
  if (g.greenGrid.length) parts.push(`<path d="${g.greenGrid.map((a) => ringsPath(a.rings, proj)).join('')}" fill="none" stroke="${G.deep}" stroke-width="0.3" stroke-dasharray="${GRID_DASH}" fill-rule="evenodd"/>`);
  // the green of the aerial, as the canopy: every tree and garden the photograph shows, in dots under the inventoried crowns
  const vm = g.vegetation;
  if (vm?.paint) {
    // painted beforehand into a transparent picture: an SVG mask would print as a soft mask some viewers fill solid
    const nw = mercatorToLonLat({ x: vm.extent.xmin, y: vm.extent.ymax }), se = mercatorToLonLat({ x: vm.extent.xmax, y: vm.extent.ymin });
    const [x0, y0] = proj(nw.lon, nw.lat), [x1, y1] = proj(se.lon, se.lat);
    parts.push(`<image href="data/${vm.paint}" x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${(x1 - x0).toFixed(2)}" height="${(y1 - y0).toFixed(2)}" preserveAspectRatio="none"/>`);
  }
  if (g.trees.points.length) {
    const mmPerM = 1000 / p.scale;
    parts.push(`<g fill="none" stroke="${G.deep}" stroke-width="0.13">${g.trees.points.map((tr) => { const [x, y] = proj(tr.lon, tr.lat); if (x < -2 || y < -2 || x > p.wMm + 2 || y > p.hMm + 2) return ''; const r = Math.min(1.6, Math.max(0.3, (tr.canopyM / 2) * mmPerM)); return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`; }).join('')}</g>`);
  }
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take(36, 10, 64, 10);
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  if (siteRings.length) { const sb = bboxOf(siteRings, proj); spacer.take((sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2, sb.x1 - sb.x0 + 2, sb.y1 - sb.y0 + 2); }
  const marks: string[] = [];
  for (const fa of f.facilities) {
    const [x, y] = proj(fa.lon, fa.lat);
    if (x < 2 || y < 2 || x > p.wMm - 2 || y > p.hMm - 2) continue;
    marks.push(`<rect x="${(x - 1.3).toFixed(2)}" y="${(y - 1.3).toFixed(2)}" width="2.6" height="2.6" fill="#000000" stroke="#ffffff" stroke-width="0.3"/><text x="${x.toFixed(2)}" y="${(y + 0.68).toFixed(2)}" text-anchor="middle" font-size="1.9" font-family="Arial, 'Liberation Sans', sans-serif" fill="#ffffff">${FACILITY_LETTER[fa.kind]}</text>`);
    spacer.take(x, y, 3, 3);
  }
  const labels: string[] = [];
  for (const s of [...f.openSpace.spaces].sort((x, y) => y.windowMm2 - x.windowMm2)) {
    if (!s.name || s.windowMm2 < 25 || labels.length >= 10) continue;
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of s.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    const w = s.name.length * 1.6 + 0.8;
    if (spacer.take(best.cx, best.cy, w, 2.6)) labels.push(m6(best.cx, best.cy, s.name));
  }
  parts.push(...marks, siteMark(b.base, proj, 'both'), ...labels, panelFurniture(p, 'left'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-green-atlas"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-green-atlas)" font-family="${t.font}">${parts.join('\n')}</g></svg>`;

  // ---- the key
  const zones = f.openSpace.zonesPresent;
  const legend: LegendEntry[] = [
    ...(zones.includes('RE1') ? [{ swatch: swatchOf(ZONE_FILL.RE1), label: 'Public open space, RE1 public recreation zone' }] : []),
    ...(zones.includes('RE2') ? [{ swatch: swatchOf(ZONE_FILL.RE2), label: 'Private recreation, RE2' }] : []),
    ...(zones.some((z) => z.startsWith('C')) ? [{ swatch: swatchOf(ZONE_FILL.C), label: `Conservation zones, ${zones.filter((z) => z.startsWith('C')).sort().join(', ')}` }] : []),
    ...(g.npws.length ? [{ swatch: swatchOf(NPWS_FILL), label: 'National Parks and Wildlife Service estate' }] : []),
    ...(g.greenGrid.length ? [{ swatch: `<rect x="0.3" y="0.6" width="4.4" height="2.4" fill="none" stroke="${G.deep}" stroke-width="0.3" stroke-dasharray="${GRID_DASH}"/>`, label: 'Greater Sydney Green Grid asset, named on the map' }] : []),
    ...(g.vegetation?.paint ? [{ swatch: swatchOf(VEG_FILL), label: `Trees, gardens and lawns, read from the aerial${b.site.imagery?.date ? ` of ${b.site.imagery.date.slice(0, 4)}` : ''}` }] : []),
    ...(g.trees.points.length ? [{ swatch: `<g fill="none" stroke="${G.deep}" stroke-width="0.2"><circle cx="1.1" cy="2.2" r="0.7"/><circle cx="3.3" cy="1.6" r="1.2"/></g>`, label: `Trees at crown size, ${f.trees.source?.name ?? 'council inventory'}` }] : []),
    ...(f.facilities.length ? [{ swatch: `<rect x="1.2" y="0.5" width="2.6" height="2.6" fill="#000000"/><text x="2.5" y="2.48" text-anchor="middle" font-size="1.9" fill="#ffffff">${FACILITY_LETTER[f.facilityCounts[0].kind]}</text>`, label: `Public facilities: ${f.facilityCounts.map(({ kind }) => `${FACILITY_LETTER[kind]} ${FACILITY_SHORT[kind][0]}`).join(', ')}` }] : []),
    { swatch: `<path d="M1.2,0.6H3.8V3H1.2Z" fill="${t.site}"/>`, label: 'The site' },
  ];
  const limit = keyTop(legend.length) - 6;

  // ---- the text page
  const c = f.canopy, o = f.openSpace;
  const near = o.nearest;
  const figs = zFigures([
    ["tree canopy on the site's block", c.siteBlock ? fmtPct(c.siteBlock.pct) : '—'],
    ['tree canopy across the page', c.window ? fmtPct(c.window.pct) : '—'],
    ['trees in the council inventory', f.trees.count ? fmtNum(f.trees.count) : '—'],
  ], [
    ['public open space, RE1', zones.includes('RE1') ? `${fmtNum(o.publicHa, 1)} ha · ${fmtPct(o.publicShareOfLandPct)} of the land` : 'none zoned'],
    ['parks and reserves on the page', fmtNum(o.parks)],
    ['the nearest', near ? `${shorten(near.name ?? near.kind, 28)} · ${near.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(near.distanceM)} m`}` : '—'],
  ], 9.6);
  let y = 44 + blockH(6.3 + 3 * 9.6);
  const blocks: string[] = [`<div class="zblk">${zHead('Canopy', 'Open space')}${figs}</div>`];
  if (c.covered && (c.siteBlock || c.window)) {
    const AGG: Fill = { bg: G.mid }, CAT: Fill = { bg: '#ffffff', kind: 'vlines', ink: G.line, step: 0.55, w: 0.16, outline: G.line, outlineW: 0.12 };
    const rows = [
      ...(c.siteBlock ? [{ name: "The site's mesh block", value: c.siteBlock.pct, label: fmtPct(c.siteBlock.pct), fill: { bg: G.solid } as Fill }] : []),
      ...(c.window ? [{ name: 'Across the page', value: c.window.pct, label: fmtPct(c.window.pct), fill: AGG }] : []),
      ...(c.wide ? [{ name: `Across the ${f.wideKm.w} × ${f.wideKm.h} km strip`, value: c.wide.pct, label: fmtPct(c.wide.pct), fill: AGG }] : []),
      ...(c.window?.byCategory ?? []).filter((x) => x.shareOfLandPct >= 4).slice(0, 4).map((x) => ({ name: `${capFirst(canopyCatWord(x.cat))} land · ${fmtPct(x.shareOfLandPct)} of the page`, value: x.pct, label: fmtPct(x.pct), fill: CAT })),
    ];
    const ax = niceAxis(Math.max(c.targetPct, ...rows.map((r) => r.value)));
    blocks.push(`<div class="zblk">${zHead(`Tree canopy ${c.year} · share of the land, %`)}${zBars(rows, ax.max, ax.step, { ref: { value: c.targetPct, label: `Region Plan target ${c.targetPct} %`, ink: G.deep } })}</div>`);
    y += blockH(barsH(rows.length, true));
  }
  const spaceFill = (s: OpenSpaceEntity): Fill => /conservation|national park|environmental/i.test(s.kind) ? ZONE_FILL.C : s.park ? { bg: G.mid } : ZONE_FILL.RE2;
  const parks = o.spaces.filter((s) => s.name || s.areaHa >= 0.2);
  const fit = (n: number) => Math.max(0, Math.min(n, Math.floor((limit - y - blockH(10)) / 3.95)));
  const nParks = fit(Math.min(7, parks.length));
  if (nParks) {
    const rows = parks.slice(0, nParks).map((s) => ({
      name: shorten(s.name ?? `Unnamed ${s.kind}`, 36),
      value: s.distanceM, label: `${s.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(s.distanceM)} m`} · ${s.areaHa >= 0.1 ? `${fmtNum(s.areaHa, 1)} ha` : `${fmtNum(Math.round(s.areaHa * 1e4))} m²`}`,
      fill: spaceFill(s),
    }));
    const ax = niceAxis(Math.max(100, ...rows.map((r) => r.value)));
    blocks.push(`<div class="zblk">${zHead('Open space from the site boundary · m')}${zBars(rows, ax.max, ax.step)}</div>`);
    y += blockH(barsH(rows.length));
  }
  const nFac = fit(f.facilityCounts.length);
  if (nFac) {
    const rows = [...f.facilityCounts].sort((x, z) => z.n - x.n).slice(0, nFac).map(({ kind, n }) => {
      const nearest = f.facilities.find((x) => x.kind === kind)!;
      return { name: `${FACILITY_LETTER[kind]}  ${capFirst(FACILITY_WORD[kind][1])}`, value: n, label: `${n} · nearest ${fmtNum(nearest.distanceM)} m`, fill: { bg: '#ffffff', kind: 'hlines', ink: '#000000', step: 0.5, w: 0.12, outline: '#000000', outlineW: 0.12 } as Fill };
    });
    const ax = niceAxis(Math.max(4, ...rows.map((r) => r.value)));
    blocks.push(`<div class="zblk">${zHead('Public facilities on the page')}${zBars(rows, ax.max, ax.step)}</div>`);
  }
  const flow = `<div class="zflow" style="top:44mm">${blocks.join('')}</div>`;
  const sources = `Sources: tree canopy from NSW ePlanning's Greater Sydney Tree Canopy Cover ${c.year} (2 m Geoscape surface features by mesh block); recreation and conservation zones from the EPI primary planning layers; Green Grid assets, open-space and facility points from the ePlanning public-spaces layers; NPWS estate from DCCEEW${f.trees.source ? `; ${f.trees.source.attribution}` : ''}; walking isochrones from Valhalla on OpenStreetMap. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const lga = b.context.lga?.name ? titleCase(b.context.lga.name) : '';
  const sub = [`${b.siteAddress}${lga ? ` ${lga}` : ''}`, c.siteBlock ? `canopy ${fmtPct(c.siteBlock.pct)} on the block` : '', near ? `${near.name ?? 'open space'} ${near.distanceM < ADJOINS_M ? 'adjoins' : `${fmtNum(near.distanceM)} m`}` : ''].filter(Boolean).join(' · ');
  const figureHtml = `<div class="abs" style="left:${FOLD}mm;top:0">${mapSvg}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">Green and public domain · 1:${fmtNum(p.scale).replace(',', ' ')}</div>
    ${flow}`;
  return { id: '10_green_public_domain', title: 'Green and public domain', subtitle: sub, textHtml: '', figureHtml, bleed: true, sources, accent: G.text, legend,
    narrative: brief([c.siteBlock && c.window ? `Tree canopy covers ${fmtPct(c.siteBlock.pct)} of the site's block and ${fmtPct(c.window.pct)} of the land on the map, against the Region Plan's ${c.targetPct} % target.` : '', near ? `The nearest open space, ${near.name ?? near.kind}, is ${near.distanceM < ADJOINS_M ? 'next to the site' : `${fmtNum(near.distanceM)} m to the ${bearingName(near.bearing)}`}${o.within.length ? `; ${o.within.find((w) => w.minutes === 5)?.parks ?? 0} parks lie within a five-minute walk` : ''}.` : '']) };
}

// ---- slide 14: environmental constraints -----------------------------------

/** The statutory colours of the constraint maps, read from the ePlanning renderers; one colour, or one per class. */
const CONSTRAINT_FILL: Record<string, string | Record<string, string>> = {
  bushfire: { 'Vegetation Category 1': '#ff0000', 'Vegetation Category 2': '#ffd200', 'Vegetation Category 3': '#ff8000', 'Vegetation Buffer': '#ffff73' },
  flood: '#73b2ff', landslide: '#e69800', subsidence: '#e6e600',
  ass: { 'Class 1': '#00c5ff', 'Class 2': '#ff00c5', 'Class 2a': '#ff00c5', 'Class 2b': '#ff0078', 'Class 3': '#ffbee8', 'Class 4': '#df73ff', 'Class 5': '#ffffbe' },
  salinity: '#ff0000', mineral: '#cc6666', groundwater: '#99fffd', drinkingWater: '#8cf1fc',
  riparian: { 'Riparian Land': '#b3e096', Watercourse: '#00c5ea', Wetland: '#00c5ea', 'Environmentally Sensitive Land': '#00c5ea' },
  wetlands: '#c9fff9',
  coastalWetlands: { 'Coastal Wetlands': '#006fff', 'Coastal Wetlands Proximity Area': '#0070ff', 'Littoral Rainforest': '#38a800', 'Littoral Rainforest Proximity Area': '#38a800' },
  coastalEnvironment: '#bed2ff', coastalUse: '#ffa77f',
  biodiversity: { 'Terrestrial biodiversity': '#00a884', Biodiversity: '#95c26f', 'Areas of biodiversity significance': '#d3ffbe', 'Areas of high biodiversity significance': '#38a800', 'Key Fish Habitat': '#005ce6', 'Remnant Native Vegetation': '#95c26f' },
  sensitiveLand: { 'Environmental Protection Land': '#55ff00', 'Environmentally Sensitive Land': '#55ff00', 'Environmentally Significant Land': '#d1ff73', 'Natural resource sensitivity': '#b3e096' },
  scenic: '#ffa699',
  airportNoise: { 'ANEF 20–25': '#ffffbe', 'ANEF 25–30': '#ffd500', 'ANEF 30–35': '#ffa0a0', 'ANEF 35–40': '#f56464', 'ANEF 40+': '#e60000', Runway: '#686868' },
  ols: 'none',
  railCorridor: { 'Corridor protection zone': '#ffaa00', 'Infrastructure protection zone': '#c500ff', 'Sydney Metro corridor protection zone': '#168388' },
  futureCorridor: '#ffff73',
};
const CONSTRAINT_FALLBACK_FILL = '#bdbbb3';
/** Classes drawn as a hatch rather than a fill: buffers and zones around a thing rather than the thing. */
const HATCHED_CLASS = /Proximity|Infrastructure protection|Environmentally Sensitive Land|Vegetation Buffer/;
const constraintFill = (id: string, cls: string): string => {
  const f = CONSTRAINT_FILL[id];
  if (!f) return CONSTRAINT_FALLBACK_FILL;
  if (typeof f === 'string') return f;
  return f[cls] ?? Object.values(f)[0] ?? CONSTRAINT_FALLBACK_FILL;
};
const GROUP_ORDER: ConstraintGroup[] = ['hazard', 'soil', 'water', 'coast', 'ecology', 'aviation', 'corridor'];
/** Drawing order on the maps: the broad washes first, the narrow features last, so a coastal area never hides a creek. */
const DRAW_RANK: Record<string, number> = {
  ass: 1, drinkingWater: 1, coastalEnvironment: 1, groundwater: 2, salinity: 2, subsidence: 2, coastalUse: 2, mineral: 3, scenic: 3, biodiversity: 4, sensitiveLand: 4,
  flood: 5, airportNoise: 5, wetlands: 5, landslide: 6, riparian: 6, bushfire: 7, coastalWetlands: 7, ols: 8, railCorridor: 8, futureCorridor: 8,
};
const classCompare = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const GROUP_WORD: Record<ConstraintGroup, string> = { hazard: 'hazards', soil: 'soils', water: 'water', coast: 'coast', ecology: 'ecology', aviation: 'aviation', corridor: 'corridors' };
/** A plan's name as the slide says it. */
const shortEpi = (s: string) => s.replace(/Local Environmental Plan/i, 'LEP').replace(/State Environmental Planning Policy/i, 'SEPP');
/** "Wetland" and "Wetlands" are the same word for the purpose of not saying it twice. */
const sameWord = (a: string, b: string) => a.toLowerCase().replace(/s$/, '') === b.toLowerCase().replace(/s$/, '');
const fmtIso = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

type ConstraintStatus = 'at-site' | 'nearby' | 'none-in-window' | 'not-mapped-by-lep' | 'unavailable';
interface ConstraintFact {
  id: string; title: string; group: ConstraintGroup; panel: 'A' | 'B'; epiBased: boolean; instrument?: string; absentNote?: string;
  status: ConstraintStatus;
  atSite: string[];
  nearest: { cls: string; distanceM: number; bearing: number } | null;
  classesInWindow: string[];
  epi?: string; currency?: string;
  /** For a plan's own map with nothing in the window: whether the plan maps it anywhere. */
  lepMapsAny: boolean | null;
  partial: boolean;
}

export function constraintsFacts(b: SlidesBundle) {
  const c = b.constraints;
  const p = b.panel;
  const centre = p.center;
  const centreLL = mercatorToLonLat(centre);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const siteMerc = siteRings.flat().map(([lon, lat]) => toM(lon, lat));
  const distFromSite = (lon: number, lat: number) => { const m = toM(lon, lat); let d = Infinity; for (const s of siteMerc) d = Math.min(d, Math.hypot(s.x - m.x, s.y - m.y)); return d / k; };
  const bearingFrom = (lon: number, lat: number) => { const m = toM(lon, lat); return ((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360; };
  const touchesSite = (rings: number[][][]) => {
    if (rings.some((r) => pointInRing(centreLL.lon, centreLL.lat, r))) return true;
    if (siteRings.some((sr) => sr.some(([lon, lat]) => rings.some((r) => pointInRing(lon, lat, r))))) return true;
    for (const r of rings) { const step = Math.max(1, Math.floor(r.length / 200)); for (let i = 0; i < r.length; i += step) if (siteRings.some((sr) => pointInRing(r[i][0], r[i][1], sr))) return true; }
    return false;
  };
  const facts: ConstraintFact[] = CONSTRAINT_DEFS.map((def) => {
    const layer = c.layers.find((l) => l.id === def.id) ?? { id: def.id, features: [], errors: def.sources.map((s) => s.url), lepMapsAny: null };
    const atSite = [...new Set(layer.features.filter((f) => touchesSite(f.rings)).map((f) => f.cls))];
    let nearest: ConstraintFact['nearest'] = null;
    if (!atSite.length) for (const f of layer.features) for (const r of f.rings) { const step = Math.max(1, Math.floor(r.length / 300)); for (let i = 0; i < r.length; i += step) { const d = distFromSite(r[i][0], r[i][1]); if (!nearest || d < nearest.distanceM) nearest = { cls: f.cls, distanceM: d, bearing: bearingFrom(r[i][0], r[i][1]) }; } }
    if (nearest) nearest = { ...nearest, distanceM: Math.round(nearest.distanceM) };
    const allFailed = layer.errors.length >= def.sources.length && !layer.features.length;
    const status: ConstraintStatus = atSite.length ? 'at-site' : layer.features.length ? 'nearby' : allFailed ? 'unavailable' : def.epiBased && layer.lepMapsAny === false ? 'not-mapped-by-lep' : 'none-in-window';
    const first = layer.features.find((f) => atSite.includes(f.cls)) ?? layer.features[0];
    return {
      id: def.id, title: def.title, group: def.group, panel: def.panel, epiBased: def.epiBased, instrument: def.instrument, absentNote: def.absentNote,
      status, atSite, nearest, classesInWindow: [...new Set(layer.features.map((f) => f.cls))], epi: first?.epi, currency: first?.currency, lepMapsAny: layer.lepMapsAny,
      partial: layer.errors.length > 0 && !allFailed,
    };
  });
  // Noise sources: arterial and higher roads within 60 m of the boundary, railways within 120 m.
  const near = (coords: number[][], maxM: number) => coords.some(([lon, lat]) => distFromSite(lon, lat) <= maxM);
  const roads = new Map<string, number>();
  for (const r of b.base.roads) if (r.name && r.hierarchy <= 3 && near(r.coords, 60)) roads.set(titleCase(r.name), Math.min(roads.get(titleCase(r.name)) ?? 99, r.hierarchy));
  const railNear = b.base.rail.train.some((l) => near(l, 120));
  const tramNear = b.base.rail.tram.some((l) => near(l, 60));
  const lep = c.epiChecked ?? b.controls.epiName;
  return {
    windowM: { w: Math.round((p.wMm / 1000) * p.scale), h: Math.round((p.hMm / 1000) * p.scale) },
    lep, lepShort: lep ? shortEpi(lep) : undefined,
    constraints: facts,
    atSite: facts.filter((f) => f.status === 'at-site'),
    nearby: facts.filter((f) => f.status === 'nearby').sort((x, y) => (x.nearest?.distanceM ?? 0) - (y.nearest?.distanceM ?? 0)),
    notMappedByLep: facts.filter((f) => f.status === 'not-mapped-by-lep'),
    mappedElsewhere: facts.filter((f) => f.status === 'none-in-window' && f.epiBased && f.lepMapsAny === true),
    noneInWindow: facts.filter((f) => f.status === 'none-in-window' && (!f.epiBased || f.lepMapsAny !== true)),
    unavailable: facts.filter((f) => f.status === 'unavailable'),
    noise: { roads: [...roads.entries()].map(([name, h]) => ({ name, hierarchy: h, word: roadWord(h) })).sort((x, y) => x.hierarchy - y.hierarchy), rail: railNear, tram: tramNear },
    soil: c.soil, soilNote: c.soilNote,
  };
}

export function constraintsSentences(b: SlidesBundle, f: ReturnType<typeof constraintsFacts>): string[] {
  const out: string[] = [];
  const clsList = (xs: string[]) => listWords(xs);
  const instrumentOf = (x: ConstraintFact) => (x.epiBased ? (x.epi ? shortEpi(x.epi) : f.lepShort ?? 'the LEP') : x.instrument ?? 'the State layer');
  const named = (x: ConstraintFact, classes: string[]) => `${x.title.toLowerCase()}${classes.length && !classes.every((cl) => sameWord(cl, x.title)) ? ` (${clsList(classes)})` : ''}`;
  if (f.atSite.length) {
    // grouped by the instrument and its currency, so a plan is named once
    const groups = new Map<string, string[]>();
    for (const x of f.atSite) { const key = `${instrumentOf(x)}'s map${x.currency ? ` (current to ${fmtIso(x.currency)})` : ''}`; (groups.get(key) ?? groups.set(key, []).get(key)!).push(named(x, x.atSite)); }
    out.push(`Mapped at the site: ${[...groups.entries()].map(([inst, items]) => `${listWords(items)} on ${inst}`).join('; ')}.`);
  } else out.push('No mapped hazard, soil, water, coastal, ecological or corridor constraint touches the site.');
  if (f.nearby.length) {
    const items = f.nearby.slice(0, 6).map((x) => `${named(x, x.nearest ? [x.nearest.cls] : [])} ${fmtNum(x.nearest!.distanceM)} m to the ${bearingName(x.nearest!.bearing)}`);
    out.push(`Within the ${fmtNum(f.windowM.w)} × ${fmtNum(f.windowM.h)} m window but not on the site: ${items.join('; ')}${f.nearby.length > 6 ? `; and ${f.nearby.length - 6} more` : ''}.`);
  }
  if (f.notMappedByLep.length && f.lepShort) {
    const notes = [...new Set(f.notMappedByLep.map((x) => x.absentNote).filter(Boolean))] as string[];
    out.push(`${f.lepShort} has no map for ${clsList(f.notMappedByLep.map((x) => x.title.toLowerCase()))}${notes.length ? `; ${listWords(notes)}` : ''}.`);
  }
  if (f.mappedElsewhere.length && f.lepShort) out.push(`${f.lepShort} maps ${clsList(f.mappedElsewhere.map((x) => x.title.toLowerCase()))} elsewhere in the local government area, none within the window.`);
  const stateNone = f.noneInWindow.filter((x) => !x.epiBased);
  if (stateNone.length) out.push(`The State's maps put no ${clsList(stateNone.map((x) => x.title.toLowerCase()))} in the window.`);
  const unknownLep = f.noneInWindow.filter((x) => x.epiBased);
  if (unknownLep.length && !f.lep) out.push(`Whether the plan maps ${clsList(unknownLep.map((x) => x.title.toLowerCase()))} at all could not be checked: the plan's name was not read.`);
  if (f.noise.roads.length || f.noise.rail || f.noise.tram) {
    const groups = new Map<string, string[]>();
    for (const r of f.noise.roads) (groups.get(r.word) ?? groups.set(r.word, []).get(r.word)!).push(r.name);
    const roadPhrase = [...groups.entries()].map(([word, names]) => `${listWords(names)}, ${names.length > 1 ? `${word}s` : `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`}`);
    const bits = [...roadPhrase, f.noise.rail ? 'a railway within 120 m' : '', f.noise.tram ? 'a light rail line within 60 m' : ''].filter(Boolean);
    out.push(`Noise sources: ${listWords(bits)}, to design the envelope and the glazing for.`);
  } else out.push('No arterial road runs within 60 m of the site and no railway within 120 m: no major noise source is mapped beside it.');
  if (f.soil) out.push(sameWord(f.soil.name, f.soil.process)
    ? `The ${f.soil.sheet} soil landscape sheet maps the site as ${f.soil.name.toLowerCase()}; geology is not open data and stays a desk-study item.`
    : `The soil landscape is ${titleCase(f.soil.name)} (${f.soil.process.toLowerCase()}), from the ${f.soil.sheet} soil landscape sheet; geology is not open data and stays a desk-study item.`);
  else out.push(`Soil landscape: ${f.soilNote ?? 'not read'}; soils and geology stay desk-study items.`);
  if (f.unavailable.length) out.push(`Could not be read when the deck was generated: ${clsList(f.unavailable.map((x) => x.title.toLowerCase()))}.`);
  return out;
}

function constraintPanel(b: SlidesBundle, proj: Proj, f: ReturnType<typeof constraintsFacts>, which: 'A' | 'B', title: string): PanelOut {
  const c = b.constraints;
  const parts: string[] = [baseLayers(b.base, proj, b.panel, { lots: false })];
  const legend: LegendEntry[] = [];
  let hatchId = 0;
  const defs = CONSTRAINT_DEFS.filter((d) => d.panel === which).sort((x, y) => (DRAW_RANK[x.id] ?? 5) - (DRAW_RANK[y.id] ?? 5));
  for (const def of defs) {
    const layer = c.layers.find((l) => l.id === def.id);
    if (!layer?.features.length) continue;
    const byClass = new Map<string, number[][][]>();
    for (const ft of layer.features) (byClass.get(ft.cls) ?? byClass.set(ft.cls, []).get(ft.cls)!).push(...ft.rings);
    for (const [cls, rings] of [...byClass.entries()].sort((x, y) => classCompare(x[0], y[0]))) {
      const fill = constraintFill(def.id, cls);
      const d = ringsPath(rings, proj);
      // the legend names the class alone when the class already says what it is
      const label = sameWord(cls, def.title) || (def.sources.length === 1 && def.sources[0].fixedClass) ? def.title
        : cls.toLowerCase().includes(def.title.split(' ')[0].toLowerCase()) ? cls : `${def.title}: ${cls}`;
      if (fill === 'none') {
        parts.push(`<path d="${d}" fill="none" stroke="#a80000" stroke-width="0.5" fill-rule="evenodd"/>`);
        legend.push({ swatch: swatchFill('none', '#a80000'), label });
      } else if (HATCHED_CLASS.test(cls)) {
        parts.push(hatchPath(d, `cp${which}${hatchId++}`, fill === '#ffff73' ? '#b3a000' : fill, bboxOf(rings, proj), 1.3));
        legend.push({ swatch: swatchHatch(fill === '#ffff73' ? '#b3a000' : fill), label });
      } else {
        parts.push(`<path d="${d}" fill="${fill}" fill-opacity="${(DRAW_RANK[def.id] ?? 5) <= 2 ? 0.45 : 0.6}" stroke="${fill === '#ffffbe' || fill === '#ffff73' ? '#8a8a00' : '#6a7572'}" stroke-width="0.15" fill-rule="evenodd"/>`);
        legend.push({ swatch: swatchFill(fill), label });
      }
    }
  }
  if (which === 'B') {
    // arterial roads emphasised, as noise sources
    const arterials = b.base.roads.filter((r) => r.hierarchy <= 3);
    if (arterials.length) {
      parts.push(`<path d="${arterials.map((r) => ringsPath([r.coords], proj, false)).join('')}" fill="none" stroke="#4a4a4a" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.75"/>`);
      legend.push({ swatch: swatchLine('#4a4a4a', 1.1), label: 'Arterial roads and above (traffic noise)' });
    }
  }
  parts.push(baseLotsHairline(b, proj), overLayers(b.base, proj, b.panel), panelFurniture(b.panel));
  const present = defs.filter((d) => c.layers.find((l) => l.id === d.id)?.features.length);
  if (!present.length) parts.push(emptyNote([`No ${which === 'A' ? 'hazard or soil' : 'water, coastal, ecological, aviation or corridor'} map has anything in this window.`]));
  const note = present.length ? `${present.length} of ${defs.length} layers present · 1:${fmtNum(b.panel.scale)}` : `none of ${defs.length} layers present · 1:${fmtNum(b.panel.scale)}`;
  return { title, note, svg: parts.join('\n'), legend };
}

/** The patterns of the green family in the order the constraint maps take them. */
const GREEN_SEQ = (G: typeof INK.green): Fill[] => [
  { bg: G.light, outline: G.solid, outlineW: 0.2 },
  { bg: '#ffffff', kind: 'vlines', ink: G.line, step: 0.75, w: 0.16, outline: G.solid, outlineW: 0.2 },
  { bg: '#ffffff', kind: 'hlines', ink: G.deep, step: 0.75, w: 0.16, outline: G.deep, outlineW: 0.2 },
  { bg: '#ffffff', kind: 'dots', ink: G.deep, step: 0.9, w: 0.12, outline: G.solid, outlineW: 0.2 },
  { bg: '#ffffff', kind: 'waves', ink: G.line, step: 1.1, w: 0.16, outline: G.solid, outlineW: 0.2 },
  { bg: '#ffffff', kind: 'vlines', ink: G.deep, step: 0.4, w: 0.16, outline: G.deep, outlineW: 0.2 },
  { bg: G.mid, outline: G.deep, outlineW: 0.2 },
  { outline: G.deep, outlineW: 0.45, dash: '1.4 0.7' },
];

/** Environmental constraints on the template: every mapped constraint on the page in the green family's patterns; the full list as a matrix of answers. */
export function constraintsAtlas(b0: SlidesBundle): Slide {
  const p = b0.bleedPanel;
  const b: SlidesBundle = { ...b0, panel: p, daPanel: p };
  const t = tpl();
  const G = INK.green;
  const f = constraintsFacts(b);
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const seq = GREEN_SEQ(G);
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  const legend: LegendEntry[] = [];
  const fillOf = new Map<string, Fill>();
  const cands: { area: number; cx: number; cy: number; text: string }[] = [];
  for (const layer of b.constraints.layers) {
    const onPage = layer.features.filter((ft) => ft.rings.some((r) => clippedStats(r, proj, p).area > 0));
    if (!onPage.length) continue;
    const fact = f.constraints.find((c) => c.id === layer.id);
    // a layer over most of the page is a sparse pattern on the white, so the streets and the rest still read through it
    const share = pageShare(onPage.flatMap((ft) => ft.rings), proj, p);
    const fl: Fill = share > 0.35 ? { kind: 'dots', ink: G.deep, step: 1.6, w: 0.12, outline: G.solid, outlineW: 0.2 } : seq[fillOf.size % seq.length];
    fillOf.set(layer.id, fl);
    parts.push(fillShape(onPage.map((ft) => ringsPath(ft.rings, proj)).join(''), box, fl));
    const classes = [...new Set(onPage.map((ft) => ft.cls))];
    const title = fact?.title ?? layer.id;
    if (classes.length === 1 && classes[0].toLowerCase().includes(title.toLowerCase())) classes.length = 0;
    legend.push({ swatch: swatchOf(fl), label: `${title}${classes.length === 1 ? `: ${classes[0]}` : classes.length ? `: ${classes.slice(0, 3).join(', ')}${classes.length > 3 ? '…' : ''}` : ''}` });
    if (classes.length > 1) for (const ft of onPage) for (const r of ft.rings) { const st = clippedStats(r, proj, p); if (st.area > 80) cands.push({ ...st, text: ft.cls.replace(/^Class\s+/i, '') }); }
  }
  // the traffic noise: the arterial roads and above within the page
  const noisy = b.base.roads.filter((r) => r.hierarchy <= 3);
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  if (noisy.length) {
    parts.push(`<path d="${noisy.map((r) => ringsPath([r.coords], proj, false)).join('')}" fill="none" stroke="${G.deep}" stroke-width="0.6" stroke-linecap="round"/>`);
    legend.push({ swatch: `<path d="M0,1.8H5" stroke="${G.deep}" stroke-width="0.6"/>`, label: 'Arterial roads and above: traffic noise' });
  }
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const labels: string[] = [];
  for (const c of cands.sort((x, y) => y.area - x.area)) if (spacer.take(c.cx, c.cy, c.text.length * 1.6 + 1, 2.8)) labels.push(m6(c.cx, c.cy, c.text));
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  if (!fillOf.size) parts.push(m6(p.wMm / 2, p.hMm / 2, 'No hazard or protection layer is mapped on this page'));
  const mapSvg = bleedSvg('cons14', p, parts.join('\n'));
  legend.push(SITE_KEY(t));
  const limit = keyTop(legend.length) - 6;

  // ---- the matrix: one row a constraint, its answer at the site and on the page
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmtNum(m)} m`);
  const rows = f.constraints.filter((c) => c.status !== 'not-mapped-by-lep' && c.status !== 'unavailable');
  const AX = 6.3, ROWS = AX + 3.7, ROWH = 3.95;
  const C1 = Z_TRACK + 1.6, C2 = Z_TRACK + 13.6, C3 = Z_TRACK + 21;
  const g: string[] = [z6(C1, AX, 'site', 'middle'), z6(C2, AX, 'page', 'middle'), z6(C3, AX, 'the answer')];
  rows.forEach((c, i) => {
    const top = ROWS + i * ROWH, cy = top + 1.45;
    const grey = c.status === 'not-mapped-by-lep' || c.status === 'none-in-window' || c.status === 'unavailable';
    g.push(z6(0, top, c.title).replace('fill="#000000"', `fill="${grey ? '#878787' : '#000000'}"`));
    if (i) g.push(`<line x1="0" y1="${(top - 0.85).toFixed(2)}" x2="${Z_W}" y2="${(top - 0.85).toFixed(2)}" stroke="#878787" stroke-width="0.1" stroke-dasharray="0 0.36" stroke-linecap="round"/>`);
    const fl = fillOf.get(c.id);
    const mark = (x: number) => fl ? `<g transform="translate(${(x - 2.1).toFixed(2)},${(cy - 1.35).toFixed(2)})">${fillShape('M0,0H4.2V2.7H0Z', { x0: 0, y0: 0, x1: 4.2, y1: 2.7 }, fl, 1.3)}</g>` : `<circle cx="${x}" cy="${cy.toFixed(2)}" r="1" fill="#000000"/>`;
    if (c.status === 'at-site') g.push(mark(C1));
    else g.push(`<line x1="${C1 - 1}" y1="${cy.toFixed(2)}" x2="${C1 + 1}" y2="${cy.toFixed(2)}" stroke="#878787" stroke-width="0.2"/>`);
    if (c.status === 'at-site' || c.status === 'nearby') g.push(mark(C2));
    else g.push(`<line x1="${C2 - 1}" y1="${cy.toFixed(2)}" x2="${C2 + 1}" y2="${cy.toFixed(2)}" stroke="#878787" stroke-width="0.2"/>`);
    const answer = c.status === 'at-site' ? c.atSite.join(', ')
      : c.status === 'nearby' && c.nearest ? `${c.nearest.cls}, ${km(c.nearest.distanceM)} ${bearingName(c.nearest.bearing)}`
      : c.status === 'not-mapped-by-lep' ? `no such map in ${f.lepShort ?? 'the plan'}`
      : c.status === 'unavailable' ? 'the layer did not answer'
      : 'none on the page';
    g.push(z6(C3, top, shorten(answer, 34)).replace('fill="#000000"', `fill="${grey ? '#878787' : '#000000'}"`));
  });
  const matrix = zSvg(ROWS + rows.length * ROWH, g.join(''));
  const figs = zFigures([
    ['mapped at the site', f.atSite.length ? shorten(f.atSite.map((c) => `${c.title}${c.atSite.length ? ` (${c.atSite.join(', ')})` : ''}`).join(' · '), 46) : 'none'],
    ['on the page, not at the site', f.nearby.length ? `${f.nearby.length} · nearest ${f.nearby[0].title.toLowerCase()} ${f.nearby[0].nearest ? km(f.nearby[0].nearest.distanceM) : ''}` : 'none'],
  ], [
    ['soil landscape', f.soil ? `${f.soil.name} (${f.soil.process})` : 'not read'],
    ['noise sources', [...f.noise.roads.map((r) => `${r.name}, ${r.word}`), f.noise.rail ? 'railway within 120 m' : ''].filter(Boolean).join(' · ') || 'none within 60 m'],
  ], 9.6);
  const blocks = [zBlock('At the site', figs, 'Around it')];
  const y = 44 + blockH(6.3 + 2 * 9.6);
  void y;
  blocks.push(zBlock('Layers', matrix, `${rows.length} mapped for this place`));
  const sources = `Mapped constraints from the State's layers, not a site investigation: NSW ePlanning hazard and protection layers (the plan's own maps, checked plan-wide where the page is empty); NSW RFS bushfire prone land; SEPP (Resilience and Hazards) coastal maps; SEPP (Transport and Infrastructure) corridors; Subsidence Advisory NSW; NSW soil landscapes. Contamination, geotechnical, flood and acoustic studies are separate. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b0, f.atSite.length ? `${f.atSite.length} mapped at the site` : 'none mapped at the site', f.lepShort ?? '');
  return { id: '14_environmental_constraints', title: 'Environmental constraints', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Hazards and protections', p, zFlow(blocks)), bleed: true, sources, accent: G.text, legend,
    narrative: brief([f.atSite.length ? `Mapped at the site: ${listWords(f.atSite.map((c) => `${c.title.toLowerCase()}${c.atSite.length ? ` (${c.atSite.join(', ')})` : ''}`))}.` : 'No hazard or protection layer is mapped at the site.', f.noise.roads.length ? `${listWords(f.noise.roads.map((r) => r.name))} ${f.noise.roads.length === 1 ? 'is' : 'are'} the noise source${f.noise.roads.length === 1 ? '' : 's'} to design for.` : '', f.nearby[0]?.nearest ? `The nearest other constraint, ${f.nearby[0].title.toLowerCase()}, begins ${fmtNum(f.nearby[0].nearest.distanceM)} m to the ${bearingName(f.nearby[0].nearest.bearing)}.` : '']) };
}

export function constraintsSlide(b: SlidesBundle): Slide {
  const f = constraintsFacts(b);
  const hp: Panel = { ...b.panel, wMm: HALF_W, hMm: HALF_H };
  const hb: SlidesBundle = { ...b, panel: hp };
  const proj = panelProjector(hp);
  const panels = [constraintPanel(hb, proj, f, 'A', 'Hazards and soils'), constraintPanel(hb, proj, f, 'B', 'Water, coast, ecology and corridors')];
  const sentences = constraintsSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: which constraints shape the envelope and the ground floor (flood levels, acid sulfate soils, the rail corridor, the coastal maps), which are only due diligence, and which studies to commission (geotechnical, contamination, flood, acoustic, bushfire).') +
    `<div class="fine">Mapped constraints from the State's layers, not a site investigation: contamination, geotechnical, flood and acoustic studies are separate. Sources: NSW ePlanning hazard and protection layers (the plans' own maps, with a plan-wide check where the window is empty); NSW RFS bushfire prone land; SEPP (Resilience and Hazards) 2021 coastal maps; SEPP (Transport and Infrastructure) 2021 corridor and infrastructure protection zones; Subsidence Advisory NSW; NSW soil landscapes (Sydney sheet); roads, rail, water and cadastre from NSW Spatial Services. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, `${f.atSite.length} mapped at the site`, f.lepShort ?? ''].filter(Boolean).join(' · ');

  const statusText = (x: ConstraintFact): string => {
    if (x.status === 'at-site') return `Yes${x.atSite.every((cl) => sameWord(cl, x.title)) ? '' : ` — ${x.atSite.join(', ')}`}`;
    if (x.status === 'nearby') return 'No';
    if (x.status === 'not-mapped-by-lep') return `Not mapped by ${f.lepShort ?? 'this LEP'}`;
    if (x.status === 'unavailable') return 'Could not be read';
    return 'No';
  };
  const windowText = (x: ConstraintFact): string => {
    if (x.status === 'at-site') return x.classesInWindow.length > 1 ? `also ${x.classesInWindow.filter((cl) => !x.atSite.includes(cl)).join(', ') || 'the same class'} nearby` : 'at the site';
    if (x.status === 'nearby' && x.nearest) return `${sameWord(x.nearest.cls, x.title) ? '' : `${x.nearest.cls}, `}${fmtNum(x.nearest.distanceM)} m ${bearingName(x.nearest.bearing)}`;
    if (x.status === 'not-mapped-by-lep') return 'no such map in the plan';
    if (x.status === 'unavailable') return 'layer did not answer';
    if (x.epiBased && x.lepMapsAny === true) return 'none in the window (mapped elsewhere in the LGA)';
    if (x.epiBased && x.lepMapsAny === null) return 'none in the window';
    return 'none in the window';
  };
  const sourceText = (x: ConstraintFact): string => {
    const inst = x.epiBased ? (x.epi ? shortEpi(x.epi) : f.lepShort ?? 'LEP map') : x.instrument ?? '';
    return `${inst}${x.currency ? ` · ${fmtIso(x.currency)}` : ''}${x.partial ? ' · part of the layer did not answer' : ''}`;
  };
  const rows = GROUP_ORDER.flatMap((g) => f.constraints.filter((x) => x.group === g)).map((x) =>
    `<tr${x.status === 'at-site' ? ' class="hit"' : ''}><td>${esc(x.title)}</td><td>${esc(GROUP_WORD[x.group])}</td><td>${esc(statusText(x))}</td><td>${esc(windowText(x))}</td><td>${esc(sourceText(x))}</td></tr>`).join('');
  const table = `<table class="da cons"><thead><tr><th style="width:36mm">Constraint</th><th style="width:13mm">Group</th><th style="width:33mm">At the site</th><th style="width:52mm">In the window</th><th>Instrument · map currency</th></tr></thead><tbody>${rows}</tbody></table>`;
  const yTable = FIELD_Y + PANEL_TITLE_H + HALF_H + HALF_LEGEND_H + GUTTER + 1;
  const figureHtml = panels.map((p, i) => panelBlock(p, i, 0, `c${i}`)).join('\n') + `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yTable}mm;width:${FIELD_W}mm">Constraints at the site<span class="pnote">every layer, with its answer · "not mapped by the LEP" means the plan has no such map, checked plan-wide</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yTable + PANEL_TITLE_H}mm;width:${FIELD_W}mm">${table}</div>`;
  return { id: '14_environmental_constraints', title: 'Environmental constraints', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 11: the site -------------------------------------------------------

const PUBLIC_LAND_COLOUR: Record<PublicParcel['kind'], string> = { state: '#2c4c9c', crown: '#2f6b50', reserve: '#79ae8e' };
const PUBLIC_LAND_WORD: Record<PublicParcel['kind'], string> = { state: 'State government land', crown: 'Crown land', reserve: 'Crown reserve' };
const SALES_RADIUS_M = 300;
const SALES_MONTHS = 24;

interface SiteEdge { a: XY; b: XY; lengthM: number; bearing: number; mid: XY; normal: { x: number; y: number }; shared: boolean }

const FRONTAGE_DIST_M = 18;
const FRONTAGE_ANGLE_DEG = 35;
const segDistM = (q: XY, a: XY, c: XY) => { const dx = c.x - a.x, dy = c.y - a.y; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)); };
/**
 * The named road that runs along a boundary edge: its centreline within 18 m
 * of the edge's midpoint and within 35° of the edge's bearing, so a lane that
 * ends at the boundary or the street round the corner is not a frontage.
 */
function roadAlongEdge(mid: XY, bearing: number, roads: SlidesBundle['base']['roads'], k: number, toM: (lon: number, lat: number) => XY): { name: string; hierarchy: number; d: number } | null {
  let best: { name: string; hierarchy: number; d: number } | null = null;
  for (const r of roads) {
    if (!r.name) continue;
    const pts = r.coords.map(([lon, lat]) => toM(lon, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      const rb = ((Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y) * 180) / Math.PI + 360) % 360;
      let da = Math.abs(rb - bearing) % 180; if (da > 90) da = 180 - da;
      if (da > FRONTAGE_ANGLE_DEG) continue;
      const d = segDistM(mid, pts[i], pts[i + 1]) / k;
      if (d <= FRONTAGE_DIST_M && (!best || d < best.d)) best = { name: titleCase(r.name), hierarchy: r.hierarchy, d };
    }
  }
  return best;
}

/**
 * The site's boundary edges, with an outward normal each (an edge another of
 * the site's lots shares is internal and left out), and its street
 * frontages: the named roads that run along the edges, with the length each
 * runs for and the compass bearing its longest edge faces. Slides 11 and 12
 * both ask.
 */
function siteBoundary(b: SlidesBundle) {
  const k = mercatorScaleFactor(mercatorToLonLat(b.panel.center).lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const ringsMerc = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry)).map((r) => r.map(([lon, lat]) => toM(lon, lat)));
  const bearingOf = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const segDist = (q: XY, a: XY, c: XY) => { const dx = c.x - a.x, dy = c.y - a.y; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)); };
  const ringAreaM2 = (pts: XY[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u.x * v.y - v.x * u.y; } return a / 2 / (k * k); };
  const edges: SiteEdge[] = [];
  ringsMerc.forEach((ring, ri) => {
    const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
    const ccw = ringAreaM2(pts) > 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const lengthM = Math.hypot(c.x - a.x, c.y - a.y) / k;
      if (lengthM < 0.3) continue;
      const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const dx = (c.x - a.x), dy = (c.y - a.y), l = Math.hypot(dx, dy);
      const normal = ccw ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
      const shared = ringsMerc.some((other, oi) => oi !== ri && other.some((q, j) => j < other.length - 1 && segDist(mid, q, other[j + 1]) * (1 / k) < 0.5));
      edges.push({ a, b: c, lengthM, bearing: bearingOf(dx, dy), mid, normal, shared });
    }
  });
  const outer = edges.filter((e) => !e.shared);
  // Frontages: the edges a named road runs along (its centreline within 18 m of the edge and within 35° of its bearing).
  const frontage = new Map<string, { lengthM: number; hierarchy: number; longest: SiteEdge }>();
  for (const e of outer) {
    const best = roadAlongEdge(e.mid, e.bearing, b.base.roads, k, toM);
    if (!best) continue;
    const cur = frontage.get(best.name) ?? { lengthM: 0, hierarchy: best.hierarchy, longest: e };
    cur.lengthM += e.lengthM;
    if (e.lengthM > cur.longest.lengthM) cur.longest = e;
    frontage.set(best.name, cur);
  }
  const frontages = [...frontage.entries()].map(([name, v]) => ({ name, lengthM: Math.round(v.lengthM * 10) / 10, hierarchy: v.hierarchy, word: roadWord(v.hierarchy), faces: Math.round(bearingOf(v.longest.normal.x, v.longest.normal.y)) })).sort((x, y) => y.lengthM - x.lengthM);
  return { k, toM, ringsMerc, outer, frontages };
}

export function siteFacts(b: SlidesBundle) {
  const s = b.site;
  const p = s.sitePanel;
  const { k, toM, ringsMerc, outer, frontages } = siteBoundary(b);
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const siteMerc = ringsMerc.flat();
  const distFromSite = (m: XY) => { let d = Infinity; for (const q of siteMerc) d = Math.min(d, Math.hypot(q.x - m.x, q.y - m.y)); return d / k; };
  const bearingOf = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const bearingFrom = (m: XY) => bearingOf(m.x - p.center.x, m.y - p.center.y);
  const ringAreaM2 = (pts: XY[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u.x * v.y - v.x * u.y; } return a / 2 / (k * k); };

  // Corners: the vertices where the boundary turns, with the elevation model's level at each.
  const g = b.terrain.dem;
  const corners: { x: number; y: number; rl?: number; turn: number; bearing: number }[] = [];
  for (const ring of ringsMerc) {
    const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length], cur = pts[i], next = pts[(i + 1) % pts.length];
      const b1 = bearingOf(cur.x - prev.x, cur.y - prev.y), b2 = bearingOf(next.x - cur.x, next.y - cur.y);
      let turn = Math.abs(b2 - b1); if (turn > 180) turn = 360 - turn;
      if (turn < 25) continue;
      corners.push({ x: cur.x, y: cur.y, rl: g ? demAt(g, cur.x, cur.y) : undefined, turn, bearing: bearingFrom(cur) });
    }
  }
  const cornerRls = corners.map((c) => c.rl).filter((v): v is number => v !== undefined);
  const levels = cornerRls.length ? { min: Math.min(...cornerRls), max: Math.max(...cornerRls), fallM: Math.max(...cornerRls) - Math.min(...cornerRls),
    high: corners.filter((c) => c.rl !== undefined).sort((x, y) => y.rl! - x.rl!)[0], low: corners.filter((c) => c.rl !== undefined).sort((x, y) => x.rl! - y.rl!)[0] } : null;

  // The existing buildings: the lot's area is sampled on a grid, and a footprint that covers any of it is on the site
  // (Overture often draws a terrace row as one footprint, so its centroid says little); the neighbours' footprints touch the boundary.
  const inside = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  const siteAreaSqm = b.siteAreaSqm ?? Math.abs(ringsMerc.reduce((a, r) => a + ringAreaM2(r), 0));
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const q of siteMerc) { sx0 = Math.min(sx0, q.x); sy0 = Math.min(sy0, q.y); sx1 = Math.max(sx1, q.x); sy1 = Math.max(sy1, q.y); }
  const stepM = Math.max(0.5, Math.sqrt(Math.max(1, siteAreaSqm) / 1600));
  const samples: [number, number][] = [];
  for (let x = sx0; x <= sx1; x += stepM * k) for (let y = sy0; y <= sy1; y += stepM * k) { const ll = mercatorToLonLat({ x, y }); if (inside(ll.lon, ll.lat)) samples.push([ll.lon, ll.lat]); }
  const onSite: { heightM?: number; floors?: number; estimatedHeightM?: number; heightFrom: string; areaSqm: number; coveredSqm: number; name?: string; beyondLot: boolean }[] = [];
  const adjoining: { heightM?: number; floors?: number; estimatedHeightM?: number; bearing: number; distanceM: number }[] = [];
  const covered = new Set<number>();
  for (const bd of b.buildings.buildings) {
    const ring = bd.rings[0] ?? [];
    if (ring.length < 4) continue;
    const pts = ring.map(([lon, lat]) => toM(lon, lat));
    const hits = samples.map((q, i) => (bd.rings.some((r) => pointInRing(q[0], q[1], r)) ? i : -1)).filter((i) => i >= 0);
    if (hits.length && samples.length && hits.length / samples.length >= 0.03) {
      for (const i of hits) covered.add(i);
      const areaSqm = Math.abs(ringAreaM2(pts));
      const coveredSqm = (hits.length / samples.length) * siteAreaSqm;
      onSite.push({ heightM: bd.heightM, floors: bd.floors, estimatedHeightM: bd.estimatedHeightM, heightFrom: bd.heightFrom, areaSqm, coveredSqm, name: bd.name, beyondLot: areaSqm > coveredSqm * 1.5 });
    } else {
      let d = Infinity; for (const q of pts) d = Math.min(d, distFromSite(q));
      if (d <= 2.5) adjoining.push({ heightM: bd.heightM, floors: bd.floors, estimatedHeightM: bd.estimatedHeightM, bearing: bearingOf(toM(bd.centroid[0], bd.centroid[1]).x - p.center.x, toM(bd.centroid[0], bd.centroid[1]).y - p.center.y), distanceM: Math.round(d) });
    }
  }
  const footprintSqm = samples.length ? (covered.size / samples.length) * siteAreaSqm : 0;

  // Land values and the sales around.
  const lv = b.people?.landValues ?? null;
  const values = lv ? [...lv.values].sort((x, y) => x.year - y.year) : [];
  const latest = values[values.length - 1], first = values[0];
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - SALES_MONTHS);
  const sales = (b.people?.sales ?? []).filter((x) => x.distanceM <= SALES_RADIUS_M && x.properties === 1 && x.date >= cutoff.toISOString().slice(0, 10)).sort((x, y) => (x.date < y.date ? 1 : -1));
  const median = (xs: number[]) => { if (!xs.length) return null; const s2 = [...xs].sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]; };

  // Public land in the block panel, nearest first.
  const publicLand = s.publicLand.map((pl) => { let d = Infinity, at = p.center; for (const r of pl.rings) for (const [lon, lat] of r) { const m = toM(lon, lat); const dd = distFromSite(m); if (dd < d) { d = dd; at = m; } } return { kind: pl.kind, label: pl.label, detail: pl.detail, areaHa: pl.areaHa, distanceM: Math.round(d), bearing: bearingFrom(at) }; }).sort((x, y) => x.distanceM - y.distanceM);

  return {
    panelScale: p.scale, blockScale: s.blockPanel.scale,
    lots: { description: b.lotDescription, count: b.base.siteLots.features.length, cadastreAreaSqm: Math.round(siteAreaSqm), planAreaSqm: s.lots.reduce((a, l) => a + (l.planAreaSqm ?? 0), 0) || null, stratum: s.lots.some((l) => l.stratum) },
    edges: outer.map((e) => ({ lengthM: Math.round(e.lengthM * 100) / 100, bearing: Math.round(e.bearing) })),
    perimeterM: Math.round(outer.reduce((a, e) => a + e.lengthM, 0) * 10) / 10,
    frontages,
    corners: corners.map((c) => ({ rl: c.rl === undefined ? undefined : Math.round(c.rl * 10) / 10, bearing: Math.round(c.bearing) })),
    levels: levels ? { min: Math.round(levels.min * 10) / 10, max: Math.round(levels.max * 10) / 10, fallM: Math.round(levels.fallM * 10) / 10, highBearing: levels.high?.bearing, lowBearing: levels.low?.bearing } : null,
    controls: b.controls,
    buildings: { source: b.buildings.source, onSite, footprintSqm: Math.round(footprintSqm), coveragePct: siteAreaSqm ? Math.min(100, (footprintSqm / siteAreaSqm) * 100) : 0, adjoining },
    easements: s.easements.map((e) => ({ type: e.type, widthM: e.widthM })),
    landValue: lv && latest ? { latest: latest.value, latestDate: latest.baseDate, first: first.value, firstYear: first.year, latestYear: latest.year, changePct: first.value ? ((latest.value - first.value) / first.value) * 100 : null, areaSqm: lv.areaSqm, stratum: lv.stratum, values } : null,
    sales: { radiusM: SALES_RADIUS_M, months: SALES_MONTHS, count: sales.length, median: median(sales.map((x) => x.price)), strata: sales.filter((x) => x.strata).length, recent: sales.slice(0, 8) },
    publicLand,
    imagery: s.imagery, aerial: Boolean(s.aerial),
    neighbours: s.neighbours.length,
  };
}

export function siteSentences(b: SlidesBundle, f: ReturnType<typeof siteFacts>): string[] {
  const out: string[] = [];
  const c = f.controls;
  // the lot and its frontage
  let s = `The site is ${f.lots.description}${f.lots.count > 1 ? ` (${f.lots.count} lots)` : ''}, ${fmtNum(f.lots.cadastreAreaSqm)} m² by the cadastre${f.lots.planAreaSqm ? ` (${fmtNum(Math.round(f.lots.planAreaSqm))} m² by the plan)` : ''}`;
  if (f.frontages.length) s += `, fronting ${listWords(f.frontages.map((fr) => `${fr.name} for ${fmtNum(fr.lengthM, 1)} m (${/^[aeiou]/i.test(fr.word) ? 'an' : 'a'} ${fr.word})`))}`;
  else s += ', with no named road within 18 m of its boundary';
  s += `; its boundary runs ${fmtNum(f.perimeterM, 1)} m${f.edges.length <= 6 ? ` in ${f.edges.length} sides of ${f.edges.map((e) => fmtNum(e.lengthM, 1)).join(', ')} m` : ` in ${f.edges.length} sides`}.`;
  out.push(s);
  // controls
  if (c.zoneCode || c.maxHeightM || c.fsr) {
    const bits = [c.zoneCode ? `zoned ${c.zoneCode}${c.zonePurpose ? ` ${c.zonePurpose}` : ''}` : '', c.maxHeightM ? `height of buildings ${fmtNum(c.maxHeightM, 1)} m` : '', c.fsr ? `floor space ratio ${c.fsr}:1` : '', c.minLotSizeSqm ? `minimum lot ${fmtNum(c.minLotSizeSqm)} m²` : ''].filter(Boolean);
    out.push(`Under ${c.epiName ? shortEpi(c.epiName) : 'the plan'} it is ${listWords(bits)}${c.heritage?.length ? `; heritage: ${listWords(c.heritage.map((h: any) => (typeof h === 'string' ? h : h.name ?? h.id ?? 'listed item')))}` : '; no heritage listing on the lot'}. The controls slide carries the rest.`);
  }
  // the existing building
  if (f.buildings.onSite.length) {
    const tallest = [...f.buildings.onSite].sort((x, y) => (y.estimatedHeightM ?? 0) - (x.estimatedHeightM ?? 0))[0];
    const h = (tallest.floors ? `${tallest.floors} storey${tallest.floors === 1 ? '' : 's'}${tallest.heightM ? `, ${fmtNum(tallest.heightM, 1)} m` : ''}` : tallest.heightM ? `${fmtNum(tallest.heightM, 1)} m high` : 'no recorded height') +
      (tallest.heightFrom === 'da' ? ' (the storeys of a determined DA on the lot, slide 08)' : '');
    out.push(`${f.buildings.source === 'overture' ? 'Overture Maps' : 'OpenStreetMap'} has ${f.buildings.onSite.length === 1 ? 'one building' : `${f.buildings.onSite.length} buildings`} on the lot, ${h}, covering ${fmtNum(f.buildings.footprintSqm)} m², ${fmtPct(f.buildings.coveragePct)} of the site${f.buildings.onSite.some((x) => x.beyondLot) ? ' (a footprint extends beyond the lot)' : ''}${f.buildings.adjoining.length ? `; ${f.buildings.adjoining.length === 1 ? 'the neighbour on the boundary is' : `${f.buildings.adjoining.length === 2 ? 'two' : f.buildings.adjoining.length} neighbours stand on the boundary:`} ${listWords(f.buildings.adjoining.slice(0, 3).map((n) => `${n.floors ? `${n.floors} storey${n.floors === 1 ? '' : 's'}` : n.estimatedHeightM ? `about ${fmtNum(n.estimatedHeightM)} m high` : 'of unknown height'} to the ${bearingName(n.bearing)}`))}` : ''}.`);
  } else out.push(`${f.buildings.source === 'none' ? 'No footprint source answered' : 'The footprint data has no building on the lot'}; the existing building, if any, is for the site visit.`);
  // levels
  if (f.levels) out.push(f.levels.fallM >= 0.3
    ? `The elevation model puts the corners between RL ${f.levels.min.toFixed(1)} (${bearingName(f.levels.lowBearing ?? 0)}) and RL ${f.levels.max.toFixed(1)} (${bearingName(f.levels.highBearing ?? 0)}), a fall of ${f.levels.fallM.toFixed(1)} m across the lot, indicative to about a metre.`
    : `The elevation model has the lot level to within ${f.levels.fallM.toFixed(1)} m, around RL ${f.levels.min.toFixed(1)}.`);
  // easements
  out.push(f.easements.length
    ? `The cadastre shows ${f.easements.length === 1 ? 'one easement' : `${f.easements.length} easements`} in the site plan's window${f.easements.some((e) => e.widthM) ? ` (${listWords([...new Set(f.easements.filter((e) => e.widthM).map((e) => `${fmtNum(e.widthM!, 1)} m wide`))])})` : ''}; its purpose is not open data, so the title search decides what it carries.`
    : "The cadastre's easement layer shows none in the site plan's window; the title search is still the reference.");
  // land value and sales
  if (f.landValue) {
    const lv = f.landValue;
    let t = `The Valuer General's land value is ${money(lv.latest)} at ${fmtIso(lv.latestDate)}`;
    if (lv.changePct !== null && lv.latestYear !== lv.firstYear) t += `, ${lv.changePct >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(lv.changePct))} on ${lv.firstYear}`;
    if (lv.stratum) t += ' (a stratum value)';
    t += '.';
    if (f.sales.count) t += ` Within ${f.sales.radiusM} m, ${f.sales.count} single-property sale${f.sales.count === 1 ? '' : 's'} in the last ${f.sales.months} months${f.sales.strata ? ` (${f.sales.strata} strata)` : ''}, median ${money(f.sales.median!)}; the latest, ${streetOnly(f.sales.recent[0].address)} at ${money(f.sales.recent[0].price)} in ${fmtMonthYear(f.sales.recent[0].date)}.`;
    else t += ` No single-property sale within ${f.sales.radiusM} m in the last ${f.sales.months} months.`;
    out.push(t);
  } else if (f.sales.count) out.push(`Within ${f.sales.radiusM} m, ${f.sales.count} single-property sales in the last ${f.sales.months} months, median ${money(f.sales.median!)}.`);
  // public land
  if (f.publicLand.length) {
    const byKind = (['state', 'crown', 'reserve'] as const).map((kd) => ({ kd, items: f.publicLand.filter((x) => x.kind === kd) })).filter((x) => x.items.length);
    out.push(`Public land in the block: ${listWords(byKind.map((x) => `${x.items.length} ${x.kd === 'state' ? 'State government parcel' : x.kd === 'crown' ? 'Crown land parcel' : 'Crown reserve'}${x.items.length === 1 ? '' : 's'}`))}; the nearest, ${f.publicLand[0].label}${f.publicLand[0].detail && f.publicLand[0].kind === 'reserve' ? ` (${f.publicLand[0].detail})` : ''}, ${f.publicLand[0].distanceM < ADJOINS_M ? 'adjoins the site' : `is ${fmtNum(f.publicLand[0].distanceM)} m to the ${bearingName(f.publicLand[0].bearing)}`}.`);
  } else out.push(`No State government or Crown parcel is mapped in the ${fmtNum(Math.round((PANEL_W / 1000) * f.blockScale))} × ${fmtNum(Math.round((100 / 1000) * f.blockScale))} m block panel.`);
  return out;
}

export function siteSlide(b: SlidesBundle): Slide {
  const f = siteFacts(b);
  const s = b.site;
  const t = tpl();
  const sentences = siteSentences(b, f);
  const img = f.imagery;
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the site visit found (the building, its condition and use, the trees, the levels and retaining walls, the services in the street), what the title says (easements, covenants, ownership) and what the survey must confirm before the envelope is drawn.') +
    `<div class="fine">Sources: NSW cadastre (lots, plan areas, easement geometry); NSW Imagery via SIX Maps${img ? ` (${titleCase(img.block)} block${img.date ? `, captured ${fmtIso(img.date)}` : ''}${img.resolutionCm ? `, ${img.resolutionCm} cm` : ''})` : ''}; controls from ePlanning; building footprints from ${b.buildings.source === 'overture' ? 'Overture Maps' : 'OpenStreetMap contributors (ODbL)'}; levels from the NSW 5 m elevation model; land values and sales from the Valuer General; State government and Crown land from the ePlanning GPI and Crown land layers; addresses from the NSW geocoded addressing theme. Cadastral dimensions and areas are computed from the digital cadastre, not the survey plan. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f.lots.description, `${fmtNum(f.lots.cadastreAreaSqm)} m²`, f.frontages[0] ? `fronts ${f.frontages[0].name}` : ''].filter(Boolean).join(' · ');

  // The site plan on the aerial.
  const p = s.sitePanel;
  const proj = panelProjector(p);
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#f5eee0"/>`];
  if (s.aerial) for (const tile of s.aerial.tiles) parts.push(`<image href="data/${tile.file}" x="${(tile.left * p.wMm).toFixed(2)}" y="${(tile.top * p.hMm).toFixed(2)}" width="${(tile.width * p.wMm).toFixed(2)}" height="${(tile.height * p.hMm).toFixed(2)}" preserveAspectRatio="none"/>`);
  else parts.push(emptyNote(['The aerial imagery did not answer for this window.']));
  // cadastre, in white over the aerial
  if (b.base.lots.features.length) parts.push(`<path d="${b.base.lots.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.25" opacity="0.85"/>`);
  let hatchId = 0;
  for (const e of s.easements) parts.push(hatchPath(ringsPath(e.rings, proj), `ease${hatchId++}`, '#dca62e', bboxOf(e.rings, proj), 1.1));
  // the buildings on the lot, and the neighbours' footprints, as white outlines
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const insideSite = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  const lotCentreLL = mercatorToLonLat(p.center);
  const onSiteFootprints = b.buildings.buildings.filter((bd) => insideSite(bd.centroid[0], bd.centroid[1]) || bd.rings.some((r) => pointInRing(lotCentreLL.lon, lotCentreLL.lat, r)) || (bd.rings[0] ?? []).some(([lon, lat]) => insideSite(lon, lat)));
  if (onSiteFootprints.length) parts.push(`<path d="${onSiteFootprints.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.45" stroke-dasharray="1.4,0.8" fill-rule="evenodd"/>`);
  // the site outline
  parts.push(`<path d="${ringsPath(siteRings, proj)}" fill="${t.site}" fill-opacity="0.08" stroke="${t.site}" stroke-width="0.7" fill-rule="evenodd"/>`);
  // dimensions along the outer edges, the text upright
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  const mmPerM = 1000 / p.scale;
  const ringsMerc = siteRings.map((r) => r.map(([lon, lat]) => lonLatToMercator({ lon, lat })));
  const projM = (m: XY) => { const ll = mercatorToLonLat(m); return proj(ll.lon, ll.lat); };
  const labels: string[] = [];
  const edgeLabels = (() => {
    const out: string[] = [];
    const k = mercatorScaleFactor(mercatorToLonLat(p.center).lat);
    const segDist = (q: XY, a: XY, c: XY) => { const dx = c.x - a.x, dy = c.y - a.y; const l2 = dx * dx + dy * dy; const tt = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - (a.x + tt * dx), q.y - (a.y + tt * dy)); };
    ringsMerc.forEach((ring, ri) => {
      const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
      let area = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; area += u.x * v.y - v.x * u.y; }
      const ccw = area > 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        const lengthM = Math.hypot(c.x - a.x, c.y - a.y) / k;
        if (lengthM * mmPerM < 5) continue;
        const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        if (ringsMerc.some((other, oi) => oi !== ri && other.some((q, j) => j < other.length - 1 && segDist(mid, q, other[j + 1]) / k < 0.5))) continue;
        const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy);
        const n = ccw ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
        const [mx, my] = projM(mid);
        const [nx, ny] = projM({ x: mid.x + n.x * l * 0.01, y: mid.y + n.y * l * 0.01 });
        const nl = Math.hypot(nx - mx, ny - my) || 1;
        const off = 2.2;
        const lx = mx + ((nx - mx) / nl) * off, ly = my + ((ny - my) / nl) * off;
        const [ax, ay] = projM(a), [cx, cy] = projM(c);
        let rot = (Math.atan2(cy - ay, cx - ax) * 180) / Math.PI;
        if (rot > 90 || rot < -90) rot += 180;
        const text = `${lengthM.toFixed(2)}`;
        if (spacer.take(lx, ly, labelW(text, 2.1), 2.6)) out.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="2.1" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${text}</text>`);
      }
    });
    return out;
  })();
  labels.push(...edgeLabels);
  // corner levels
  const g = b.terrain.dem;
  if (g) {
    const cs = ringsMerc.flatMap((ring) => {
      const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
      return pts.map((cur, i) => {
        const prev = pts[(i + pts.length - 1) % pts.length], next = pts[(i + 1) % pts.length];
        const b1 = Math.atan2(cur.x - prev.x, cur.y - prev.y), b2 = Math.atan2(next.x - cur.x, next.y - cur.y);
        let turn = Math.abs(((b2 - b1) * 180) / Math.PI) % 360; if (turn > 180) turn = 360 - turn;
        return { cur, turn };
      }).filter((c) => c.turn >= 25);
    });
    for (const c of cs) {
      const rl = demAt(g, c.cur.x, c.cur.y);
      if (rl === undefined) continue;
      const [x, y] = projM(c.cur);
      const dxc = x - p.wMm / 2, dyc = y - p.hMm / 2, dl = Math.hypot(dxc, dyc) || 1;
      const lx = x + (dxc / dl) * 4.5, ly = y + (dyc / dl) * 4.5;
      const text = `RL ${rl.toFixed(1)}`;
      if (spacer.take(lx, ly, labelW(text, 1.9), 2.5)) labels.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.55" fill="#ffffff" stroke="${t.site}" stroke-width="0.3"/>` + `<text x="${lx.toFixed(1)}" y="${(ly + 0.65).toFixed(1)}" text-anchor="middle" font-size="1.9" fill="#ffffff" stroke="#000000" stroke-width="0.32" paint-order="stroke">${text}</text>`);
    }
  }
  // the building's height on the lot
  for (const bd of onSiteFootprints) {
    const [x, y] = proj(bd.centroid[0], bd.centroid[1]);
    const text = bd.floors ? `${bd.floors} st${bd.heightM ? ` · ${fmtNum(bd.heightM)} m` : ''}` : bd.heightM ? `${fmtNum(bd.heightM)} m` : 'existing';
    if (spacer.take(x, y, labelW(text, 2), 2.6)) labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.7).toFixed(1)}" text-anchor="middle" font-size="2" font-weight="600" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${esc(text)}</text>`);
  }
  // road names along their centrelines, and the neighbours' numbers
  for (const r of b.base.roads) {
    if (!r.name) continue;
    // the centreline densified, so a road that only crosses the panel still offers a point inside it
    const raw = r.coords.map(([lon, lat]) => proj(lon, lat));
    const dense: [number, number][] = [];
    for (let i = 0; i < raw.length - 1; i++) { const [x1, y1] = raw[i], [x2, y2] = raw[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let j = 0; j < n; j++) dense.push([x1 + ((x2 - x1) * j) / n, y1 + ((y2 - y1) * j) / n]); }
    if (raw.length) dense.push(raw[raw.length - 1]);
    const pts = dense.filter(([x, y]) => x > 4 && x < p.wMm - 4 && y > 4 && y < p.hMm - 4);
    if (pts.length < 2) continue;
    const i = Math.floor(pts.length / 2);
    const [x1, y1] = pts[Math.max(0, i - 1)], [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
    let rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; if (rot > 90 || rot < -90) rot += 180;
    const text = titleCase(r.name);
    const [x, y] = pts[i];
    if (spacer.take(x, y, labelW(text, 2.3), 3)) labels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="2.3" letter-spacing="0.06em" fill="#ffffff" stroke="#000000" stroke-width="0.4" paint-order="stroke">${esc(text.toUpperCase())}</text>`);
  }
  for (const n of s.neighbours) {
    const [x, y] = proj(n.lon, n.lat);
    if (x < 2 || y < 2 || x > p.wMm - 2 || y > p.hMm - 2) continue;
    if (spacer.take(x, y, labelW(n.housenumber, 1.9), 2.4)) labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.65).toFixed(1)}" text-anchor="middle" font-size="1.9" fill="#ffffff" stroke="#000000" stroke-width="0.3" paint-order="stroke">${esc(n.housenumber)}</text>`);
  }
  parts.push(...labels, panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-site"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-site)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures and the facts table.
  const rightX = AUX_X, rightW = AUX_W;
  const c = f.controls;
  const lv = f.landValue;
  const tiles = [
    { v: `${fmtNum(f.lots.cadastreAreaSqm)} m²`, l: `site area by the cadastre${f.lots.count > 1 ? ` · ${f.lots.count} lots` : ''}${f.lots.planAreaSqm ? ` · plan ${fmtNum(Math.round(f.lots.planAreaSqm))} m²` : ''}` },
    { v: f.frontages[0] ? `${fmtNum(f.frontages[0].lengthM, 1)} m` : '—', l: f.frontages[0] ? `frontage to ${f.frontages[0].name}${f.frontages.length > 1 ? ` · ${f.frontages.slice(1).map((fr) => `${fmtNum(fr.lengthM, 1)} m to ${fr.name}`).join(', ')}` : ''}` : 'no named road within 18 m of the boundary' },
    { v: [c.zoneCode, c.maxHeightM ? `${fmtNum(c.maxHeightM, c.maxHeightM % 1 ? 1 : 0)} m` : '', c.fsr ? `${c.fsr}:1` : ''].filter(Boolean).join(' · ') || '—', l: `zone · height of buildings · FSR${c.epiName ? ` (${shortEpi(c.epiName)})` : ''}` },
    { v: lv ? money(lv.latest) : '—', l: lv ? `land value at ${fmtIso(lv.latestDate)}${lv.changePct !== null && lv.latestYear !== lv.firstYear ? ` · ${lv.changePct >= 0 ? '+' : '−'}${fmtPct(Math.abs(lv.changePct))} since ${lv.firstYear}` : ''}` : 'no land value at the point' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const rows: [string, string][] = [
    ['Lot and plan', `${f.lots.description}${f.lots.stratum ? ' · stratum lot' : ''}`],
    ['Area', `${fmtNum(f.lots.cadastreAreaSqm)} m² (cadastre)${f.lots.planAreaSqm ? ` · ${fmtNum(Math.round(f.lots.planAreaSqm))} m² (plan)` : ' · no plan area recorded'}`],
    ['Boundary', `${fmtNum(f.perimeterM, 1)} m in ${f.edges.length} sides${f.edges.length <= 6 ? `: ${f.edges.map((e) => fmtNum(e.lengthM, 1)).join(' · ')} m` : ''}`],
    ['Frontage', f.frontages.length ? f.frontages.map((fr) => `${fr.name} ${fmtNum(fr.lengthM, 1)} m (${fr.word})`).join(' · ') : 'none to a named road'],
    ['Zone', c.zoneCode ? `${c.zoneCode}${c.zonePurpose ? ` ${c.zonePurpose}` : ''}` : 'not read'],
    ['Height of buildings', c.maxHeightM ? `${fmtNum(c.maxHeightM, 1)} m` : 'not mapped'],
    ['Floor space ratio', c.fsr ? `${c.fsr}:1` : 'not mapped'],
    ['Minimum lot size', c.minLotSizeSqm ? `${fmtNum(c.minLotSizeSqm)} m²` : 'not mapped'],
    ['Heritage', c.heritage?.length ? c.heritage.map((h: any) => (typeof h === 'string' ? h : h.name ?? h.id ?? 'listed item')).join(' · ') : 'none on the lot'],
    ['Existing building', f.buildings.onSite.length ? `${f.buildings.onSite.length === 1 ? 'one footprint' : `${f.buildings.onSite.length} footprints`}, ${fmtNum(f.buildings.footprintSqm)} m² (${fmtPct(f.buildings.coveragePct)} of the site)${f.buildings.onSite[0].floors ? `, ${f.buildings.onSite[0].floors} st` : ''}${f.buildings.onSite[0].heightM ? `, ${fmtNum(f.buildings.onSite[0].heightM, 1)} m` : ''}` : f.buildings.source === 'none' ? 'no footprint source answered' : 'no footprint on the lot'],
    ['Levels', f.levels ? `RL ${f.levels.min.toFixed(1)}–${f.levels.max.toFixed(1)} at the corners · fall ${f.levels.fallM.toFixed(1)} m (5 m elevation model)` : 'elevation model not read'],
    ['Easements', f.easements.length ? `${f.easements.length} in the window (cadastre geometry; purpose not open data)` : 'none in the cadastre layer'],
    ['Land value', lv ? `${money(lv.latest)} at ${fmtIso(lv.latestDate)}${lv.values.length > 1 ? ` · ${lv.values.map((v) => `${v.year} ${money(v.value)}`).join(', ')}` : ''}` : 'no property at the point'],
    ['Sales within 300 m', f.sales.count ? `${f.sales.count} in ${f.sales.months} months${f.sales.strata ? ` (${f.sales.strata} strata)` : ''} · median ${money(f.sales.median!)}` : 'none in the last 24 months'],
    ['Public land in the block', f.publicLand.length ? `${f.publicLand.length} parcel${f.publicLand.length === 1 ? '' : 's'} · nearest ${f.publicLand[0].label}, ${f.publicLand[0].distanceM < ADJOINS_M ? 'adjoining' : `${fmtNum(f.publicLand[0].distanceM)} m ${bearingName(f.publicLand[0].bearing)}`}` : 'none mapped'],
    ['Aerial imagery', img ? `${titleCase(img.block)} block${img.date ? `, captured ${fmtIso(img.date)}` : ''}${img.resolutionCm ? `, ${img.resolutionCm} cm` : ''}` : 'capture date not read'],
  ];
  const factsTable = `<table class="da cons facts"><tbody>${rows.map(([lab, val]) => `<tr><th>${esc(lab)}</th><td>${esc(val)}</td></tr>`).join('')}</tbody></table>`;

  // Bottom left: the block, the sales and the public land.
  const bp = s.blockPanel;
  const bproj = panelProjector(bp);
  const bparts: string[] = [baseLayers(b.base, bproj, bp)];
  for (const kind of ['state', 'crown', 'reserve'] as const) {
    const items = s.publicLand.filter((x) => x.kind === kind);
    if (!items.length) continue;
    const d = items.map((x) => ringsPath(x.rings, bproj)).join('');
    if (kind === 'reserve') bparts.push(`<path d="${d}" fill="${PUBLIC_LAND_COLOUR[kind]}" fill-opacity="0.45" stroke="${PUBLIC_LAND_COLOUR[kind]}" stroke-width="0.25" fill-rule="evenodd"/>`);
    else bparts.push(hatchPath(d, `pl${kind}`, PUBLIC_LAND_COLOUR[kind], bboxOf(items.flatMap((x) => x.rings), bproj), 1.2));
  }
  bparts.push(overLayers(b.base, bproj, bp, 'wash'));
  // the 300 m ring
  const [scx, scy] = bproj(mercatorToLonLat(bp.center).lon, mercatorToLonLat(bp.center).lat);
  bparts.push(`<circle cx="${scx.toFixed(1)}" cy="${scy.toFixed(1)}" r="${((SALES_RADIUS_M * 1000) / bp.scale).toFixed(1)}" fill="none" stroke="${t.dimension}" stroke-width="0.3" stroke-dasharray="1.4,0.9"/>`);
  const maxPrice = Math.max(1, ...f.sales.recent.map((x) => x.price), ...(b.people?.sales ?? []).filter((x) => x.distanceM <= SALES_RADIUS_M).map((x) => x.price));
  const allSales = (b.people?.sales ?? []).filter((x) => x.distanceM <= SALES_RADIUS_M && x.properties === 1 && x.date >= (() => { const d = new Date(); d.setMonth(d.getMonth() - SALES_MONTHS); return d.toISOString().slice(0, 10); })());
  for (const sale of allSales) {
    const [x, y] = bproj(sale.lon, sale.lat);
    const r = 0.6 + 1.8 * Math.sqrt(sale.price / maxPrice);
    bparts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${sale.strata ? '#ffffff' : CHART.accent}" fill-opacity="${sale.strata ? 0.9 : 0.7}" stroke="${CHART.accent}" stroke-width="0.3"/>`);
  }
  bparts.push(siteMark(b.base, bproj, 'outline'), panelFurniture(bp, 'right'));
  const blockSvg = `<svg width="${bp.wMm}mm" height="${bp.hMm}mm" viewBox="0 0 ${bp.wMm} ${bp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-block"><rect x="0" y="0" width="${bp.wMm}" height="${bp.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-block)" font-family="${t.font}">${bparts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${bp.wMm - 0.2}" height="${bp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;
  // Bottom right: the legend and the sales table.
  const sw = (inner: string) => `<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${inner}</svg>`;
  const legendRows: [string, string][] = [
    [sw(`<circle cx="1.4" cy="1.8" r="0.9" fill="${CHART.accent}" fill-opacity="0.7" stroke="${CHART.accent}" stroke-width="0.3"/><circle cx="3.6" cy="1.8" r="1.2" fill="#ffffff" stroke="${CHART.accent}" stroke-width="0.3"/>`), `Single-property sales in the last ${SALES_MONTHS} months, sized by price; strata hollow`],
    [sw(`<circle cx="2.5" cy="1.8" r="1.5" fill="none" stroke="${t.dimension}" stroke-width="0.3" stroke-dasharray="1.4,0.9"/>`), `${SALES_RADIUS_M} m from the site`],
  ];
  for (const kind of ['state', 'crown', 'reserve'] as const) if (s.publicLand.some((x) => x.kind === kind)) legendRows.push([sw(kind === 'reserve' ? `<rect x="0" y="0.4" width="5" height="2.8" fill="${PUBLIC_LAND_COLOUR[kind]}" fill-opacity="0.45" stroke="${PUBLIC_LAND_COLOUR[kind]}" stroke-width="0.25"/>` : `<rect x="0" y="0.4" width="5" height="2.8" fill="none" stroke="${PUBLIC_LAND_COLOUR[kind]}" stroke-width="0.3"/><line x1="0" y1="3.2" x2="2.8" y2="0.4" stroke="${PUBLIC_LAND_COLOUR[kind]}" stroke-width="0.22"/><line x1="2.2" y1="3.2" x2="5" y2="0.4" stroke="${PUBLIC_LAND_COLOUR[kind]}" stroke-width="0.22"/>`), PUBLIC_LAND_WORD[kind]]);
  const legend = legendRows.map(([sv, txt]) => `<div class="lg">${sv}<span>${esc(txt)}</span></div>`).join('');
  const saleRows = f.sales.recent.map((x) => `<tr><td>${esc(streetOnly(x.address))}</td><td class="r">${money(x.price)}</td><td>${esc(fmtMonthYear(x.date))}</td><td>${x.strata ? 'strata' : x.areaSqm ? `${fmtNum(x.areaSqm)} m²` : 'land'}</td><td class="r">${fmtNum(x.distanceM)} m</td></tr>`).join('');
  const salesTable = f.sales.recent.length
    ? `<table class="da cons"><thead><tr><th>Sale</th><th class="r" style="width:20mm">Price</th><th style="width:16mm">When</th><th style="width:16mm">Land</th><th class="r" style="width:14mm">From site</th></tr></thead><tbody>${saleRows}</tbody></table>`
    : emptyBox(rightW, 24, `no single-property sale within ${SALES_RADIUS_M} m in the last ${SALES_MONTHS} months`);

  const yBlock = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">The site<span class="pnote">1:${fmtNum(p.scale)} · boundary lengths in metres from the digital cadastre · corner levels from the 5 m elevation model</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yBlock}mm;width:${PANEL_W}mm">The block<span class="pnote">1:${fmtNum(bp.scale)} · sales within ${SALES_RADIUS_M} m and the public land around</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yBlock + PANEL_TITLE_H}mm">${blockSvg}</div>
    <div class="abs" style="left:${rightX}mm;top:${FIELD_Y}mm;width:${rightW}mm;height:${SLIDE_H - FIELD_Y - 14}mm;overflow:hidden">
      <div class="tiles two">${tiles}</div>
      <div class="ptitle sm aux-t">Site facts<span class="pnote">open data, before the survey and the title search</span></div>
      ${factsTable}
      <div class="ptitle sm aux-t">Recent sales<span class="pnote">latest first · within ${SALES_RADIUS_M} m · Valuer General</span></div>
      ${salesTable}
      <div class="legend" style="margin-top:2.5mm">${legend}</div>
    </div>`;
  return { id: '11_the_site', title: 'The site', subtitle: sub, textHtml, figureHtml };
}

/** The site on the template: the aerial at the site's scale to the sheet's edges, its dimensions and levels on it; the value, the sales and the facts beside. */
export function siteAtlas(b: SlidesBundle): Slide {
  const f = siteFacts(b);
  const s = b.site;
  const t = tpl();
  const S = INK.sage;
  const img = f.imagery;
  // The site plan on the aerial.
  const p = s.sitePanel;
  const proj = panelProjector(p);
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#ffffff"/>`];
  if (s.aerial) for (const tile of s.aerial.tiles) parts.push(`<image href="data/${tile.file}" x="${(tile.left * p.wMm).toFixed(2)}" y="${(tile.top * p.hMm).toFixed(2)}" width="${(tile.width * p.wMm).toFixed(2)}" height="${(tile.height * p.hMm).toFixed(2)}" preserveAspectRatio="none"/>`);
  else parts.push(emptyNote(['The aerial imagery did not answer for this window.']));
  // cadastre, in white over the aerial
  if (b.base.lots.features.length) parts.push(`<path d="${b.base.lots.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.25" opacity="0.85"/>`);
  let hatchId = 0;
  for (const e of s.easements) parts.push(hatchPath(ringsPath(e.rings, proj), `ease${hatchId++}`, INK.sage.solid, bboxOf(e.rings, proj), 1.1));
  // the buildings on the lot, and the neighbours' footprints, as white outlines
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const insideSite = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  const lotCentreLL = mercatorToLonLat(p.center);
  const onSiteFootprints = b.buildings.buildings.filter((bd) => insideSite(bd.centroid[0], bd.centroid[1]) || bd.rings.some((r) => pointInRing(lotCentreLL.lon, lotCentreLL.lat, r)) || (bd.rings[0] ?? []).some(([lon, lat]) => insideSite(lon, lat)));
  if (onSiteFootprints.length) parts.push(`<path d="${onSiteFootprints.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.45" stroke-dasharray="1.4,0.8" fill-rule="evenodd"/>`);
  // the site outline
  parts.push(`<path d="${ringsPath(siteRings, proj)}" fill="${t.site}" fill-opacity="0.08" stroke="${t.site}" stroke-width="0.7" fill-rule="evenodd"/>`);
  // dimensions along the outer edges, the text upright
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  const mmPerM = 1000 / p.scale;
  const ringsMerc = siteRings.map((r) => r.map(([lon, lat]) => lonLatToMercator({ lon, lat })));
  const projM = (m: XY) => { const ll = mercatorToLonLat(m); return proj(ll.lon, ll.lat); };
  const labels: string[] = [];
  const edgeLabels = (() => {
    const out: string[] = [];
    const k = mercatorScaleFactor(mercatorToLonLat(p.center).lat);
    const segDist = (q: XY, a: XY, c: XY) => { const dx = c.x - a.x, dy = c.y - a.y; const l2 = dx * dx + dy * dy; const tt = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - (a.x + tt * dx), q.y - (a.y + tt * dy)); };
    ringsMerc.forEach((ring, ri) => {
      const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
      let area = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; area += u.x * v.y - v.x * u.y; }
      const ccw = area > 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length];
        const lengthM = Math.hypot(c.x - a.x, c.y - a.y) / k;
        if (lengthM * mmPerM < 5) continue;
        const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
        if (ringsMerc.some((other, oi) => oi !== ri && other.some((q, j) => j < other.length - 1 && segDist(mid, q, other[j + 1]) / k < 0.5))) continue;
        const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy);
        const n = ccw ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
        const [mx, my] = projM(mid);
        const [nx, ny] = projM({ x: mid.x + n.x * l * 0.01, y: mid.y + n.y * l * 0.01 });
        const nl = Math.hypot(nx - mx, ny - my) || 1;
        const off = 2.2;
        const lx = mx + ((nx - mx) / nl) * off, ly = my + ((ny - my) / nl) * off;
        const [ax, ay] = projM(a), [cx, cy] = projM(c);
        let rot = (Math.atan2(cy - ay, cx - ax) * 180) / Math.PI;
        if (rot > 90 || rot < -90) rot += 180;
        const text = `${lengthM.toFixed(2)}`;
        if (spacer.take(lx, ly, labelW(text, 2.5), 2.6)) out.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="2.117" letter-spacing="0.19" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${text}</text>`);
      }
    });
    return out;
  })();
  labels.push(...edgeLabels);
  // corner levels
  const g = b.terrain.dem;
  if (g) {
    const cs = ringsMerc.flatMap((ring) => {
      const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
      return pts.map((cur, i) => {
        const prev = pts[(i + pts.length - 1) % pts.length], next = pts[(i + 1) % pts.length];
        const b1 = Math.atan2(cur.x - prev.x, cur.y - prev.y), b2 = Math.atan2(next.x - cur.x, next.y - cur.y);
        let turn = Math.abs(((b2 - b1) * 180) / Math.PI) % 360; if (turn > 180) turn = 360 - turn;
        return { cur, turn };
      }).filter((c) => c.turn >= 25);
    });
    for (const c of cs) {
      const rl = demAt(g, c.cur.x, c.cur.y);
      if (rl === undefined) continue;
      const [x, y] = projM(c.cur);
      const dxc = x - p.wMm / 2, dyc = y - p.hMm / 2, dl = Math.hypot(dxc, dyc) || 1;
      const lx = x + (dxc / dl) * 4.5, ly = y + (dyc / dl) * 4.5;
      const text = `RL ${rl.toFixed(1)}`;
      if (spacer.take(lx, ly, labelW(text, 2.5), 2.5)) labels.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.55" fill="#ffffff" stroke="${t.site}" stroke-width="0.3"/>` + `<text x="${lx.toFixed(1)}" y="${(ly + 0.65).toFixed(1)}" text-anchor="middle" font-size="2.117" letter-spacing="0.19" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${text}</text>`);
    }
  }
  // the building's height on the lot
  for (const bd of onSiteFootprints) {
    const [x, y] = proj(bd.centroid[0], bd.centroid[1]);
    const text = bd.floors ? `${bd.floors} st${bd.heightM ? ` · ${fmtNum(bd.heightM)} m` : ''}` : bd.heightM ? `${fmtNum(bd.heightM)} m` : 'existing';
    if (spacer.take(x, y, labelW(text, 2.5), 2.6)) labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.7).toFixed(1)}" text-anchor="middle" font-size="2.117" letter-spacing="0.19" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${esc(text)}</text>`);
  }
  // road names along their centrelines, and the neighbours' numbers
  for (const r of b.base.roads) {
    if (!r.name) continue;
    // the centreline densified, so a road that only crosses the panel still offers a point inside it
    const raw = r.coords.map(([lon, lat]) => proj(lon, lat));
    const dense: [number, number][] = [];
    for (let i = 0; i < raw.length - 1; i++) { const [x1, y1] = raw[i], [x2, y2] = raw[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let j = 0; j < n; j++) dense.push([x1 + ((x2 - x1) * j) / n, y1 + ((y2 - y1) * j) / n]); }
    if (raw.length) dense.push(raw[raw.length - 1]);
    const pts = dense.filter(([x, y]) => x > 4 && x < p.wMm - 4 && y > 4 && y < p.hMm - 4);
    if (pts.length < 2) continue;
    const i = Math.floor(pts.length / 2);
    const [x1, y1] = pts[Math.max(0, i - 1)], [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
    let rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; if (rot > 90 || rot < -90) rot += 180;
    const text = titleCase(r.name);
    const [x, y] = pts[i];
    if (spacer.take(x, y, labelW(text, 2.5), 3)) labels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="2.117" letter-spacing="0.19" fill="#ffffff" stroke="#000000" stroke-width="0.4" paint-order="stroke">${esc(text.toUpperCase())}</text>`);
  }
  for (const n of s.neighbours) {
    const [x, y] = proj(n.lon, n.lat);
    if (x < 2 || y < 2 || x > p.wMm - 2 || y > p.hMm - 2) continue;
    if (spacer.take(x, y, labelW(n.housenumber, 2.5), 2.4)) labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.65).toFixed(1)}" text-anchor="middle" font-size="2.117" letter-spacing="0.19" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${esc(n.housenumber)}</text>`);
  }
  parts.push(...labels, panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('site11', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    { swatch: `<rect x="0.4" y="0.6" width="4.2" height="2.4" fill="${t.site}" fill-opacity="0.08" stroke="${t.site}" stroke-width="0.5"/>`, label: 'The site, the digital cadastre; boundary lengths in metres' },
    { swatch: `<circle cx="1.2" cy="1.8" r="0.55" fill="#ffffff" stroke="${t.site}" stroke-width="0.3"/><path d="M2.4,1.8H5" stroke="#000000" stroke-width="0.2"/>`, label: 'Corner levels, RL m AHD, from the 5 m elevation model' },
    ...(onSiteFootprints.length ? [{ swatch: `<rect x="0.4" y="0.6" width="4.2" height="2.4" fill="#9a9a9a" stroke="#ffffff" stroke-width="0.4" stroke-dasharray="1.4 0.8"/>`, label: 'The building on the lot, Overture footprint' }] : []),
    ...(s.easements.length ? [{ swatch: swatchOf({ bg: '#ffffff', kind: 'vlines', ink: S.solid, step: 0.6, w: 0.2 }), label: 'Easements, cadastre geometry' }] : []),
  ];
  const limit = keyTop(legend.length) - 6;
  const c = f.controls, lv = f.landValue;
  const figs = zFigures([
    ['site area', `${fmtNum(f.lots.cadastreAreaSqm)} m² cadastre${f.lots.planAreaSqm ? ` · ${fmtNum(Math.round(f.lots.planAreaSqm))} m² plan` : ''}`],
    ['frontage', f.frontages[0] ? `${fmtNum(f.frontages[0].lengthM, 1)} m to ${f.frontages[0].name}` : 'none to a named road'],
    ['boundary', `${fmtNum(f.perimeterM, 1)} m in ${f.edges.length} sides`],
  ], [
    ['zone · height · floor space ratio', [c.zoneCode, c.maxHeightM ? `${fmtNum(c.maxHeightM, c.maxHeightM % 1 ? 1 : 0)} m` : '', c.fsr ? `${c.fsr}:1` : ''].filter(Boolean).join(' · ') || '—'],
    ['levels at the corners', f.levels ? `RL ${f.levels.min.toFixed(1)}–${f.levels.max.toFixed(1)} · fall ${f.levels.fallM.toFixed(1)} m` : '—'],
    ['land value', lv ? `${money(lv.latest)} at ${fmtIso(lv.latestDate)}` : '—'],
  ], 9.6);
  let y = 44 + blockH(6.3 + 3 * 9.6);
  const blocks = [zBlock('The lot', figs, 'The controls and the value')];
  if (lv && lv.values.length > 1) {
    const rows = lv.values.map((v, i) => ({ name: String(v.year), value: v.value / 1e6, label: money(v.value), fill: i === lv.values.length - 1 ? { bg: S.solid } as Fill : { bg: '#ffffff', kind: 'vlines', ink: S.deep, step: 0.55, w: 0.14, outline: S.deep, outlineW: 0.12 } as Fill }));
    const ax = niceAxis(Math.max(...rows.map((r) => r.value)));
    blocks.push(zBlock(`Land value · $ M${lv.changePct !== null ? ` · ${lv.changePct >= 0 ? '+' : '−'}${fmtPct(Math.abs(lv.changePct))} since ${lv.firstYear}` : ''}`, zBars(rows, ax.max, ax.step)));
    y += blockH(barsH(rows.length));
  }
  const nSales = Math.max(0, Math.min(f.sales.recent.length, Math.floor((limit - y - blockH(10)) / 3.95)));
  if (nSales) {
    const rows = f.sales.recent.slice(0, nSales).map((x) => ({ name: shorten(`${tidyName(titleCase(streetOnly(x.address)))} · ${fmtNum(x.distanceM)} m`, 40), value: x.price / 1e6, label: `${money(x.price)} · ${fmtMonthYear(x.date)}`, fill: x.strata ? { bg: '#ffffff', kind: 'vlines', ink: S.deep, step: 0.55, w: 0.14, outline: S.deep, outlineW: 0.12 } as Fill : { bg: S.solid } as Fill }));
    const ax = niceAxis(Math.max(...rows.map((r) => r.value)));
    blocks.push(zBlock(`Sales within ${f.sales.radiusM} m · $ M`, zBars(rows, ax.max, ax.step), `${f.sales.count} in ${f.sales.months} months · median ${f.sales.median ? money(f.sales.median) : '—'}`));
  }
  const sources = `Sources: NSW cadastre; NSW Imagery via SIX Maps${img ? ` (${titleCase(img.block)} block${img.date ? `, captured ${fmtIso(img.date)}` : ''}${img.resolutionCm ? `, ${img.resolutionCm} cm` : ''})` : ''}; controls from ePlanning; footprints from ${b.buildings.source === 'overture' ? 'Overture Maps' : 'OpenStreetMap'}; levels from the 5 m elevation model; land values and sales from the Valuer General (solid whole properties, lined strata). Dimensions from the digital cadastre, not the survey. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, f.lots.description && f.lots.description !== '—' ? f.lots.description : '', `${fmtNum(f.lots.cadastreAreaSqm)} m²`, f.frontages[0] ? `fronts ${f.frontages[0].name}` : '');
  return { id: '11_the_site', title: 'The site', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'The site', p, zFlow(blocks)), bleed: true, sources, accent: S.text, legend,
    narrative: brief([`The site is ${fmtNum(f.lots.cadastreAreaSqm)} m²${f.frontages.length ? `, fronting ${listWords(f.frontages.map((fr) => `${fr.name} for ${fmtNum(fr.lengthM, 1)} m`))}` : ''}.`, f.levels ? `Its corners fall ${f.levels.fallM.toFixed(1)} m, from RL ${f.levels.max.toFixed(1)} to RL ${f.levels.min.toFixed(1)}.` : '', lv ? `The land value is ${money(lv.latest)} at ${fmtIso(lv.latestDate)}${lv.changePct !== null && lv.latestYear !== lv.firstYear ? `, ${lv.changePct >= 0 ? 'up' : 'down'} ${fmtPct(Math.abs(lv.changePct))} since ${lv.firstYear}` : ''}.` : '']) };
}

// ---- slide 12: existing site condition ------------------------------------------

const CAMERA_COLOUR = '#2c4c9c';
/** Between the two panels of the then-and-now pair. */
const PAIR_GAP = 4;
/** Round scales the camera plan may take; the smallest that holds every camera and the site wins. */
const PLAN_SCALES = [1000, 1250, 1500, 2000, 2500, 3000];
const NUM_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const numWord = (n: number) => NUM_WORDS[n] ?? fmtNum(n);
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthYear = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const SOURCE_WORD: Record<StreetPhoto['source'], string> = { kartaview: 'KartaView', mapillary: 'Mapillary', google: 'Google Street View' };

/** The frames with where each was taken from, the plan that keys them, the sides no frame covers and the pair's coverage. */
export function photosFacts(b: SlidesBundle) {
  const ph = b.photos;
  const centreLL = mercatorToLonLat(b.panel.center);
  const k = mercatorScaleFactor(centreLL.lat);
  // the street a camera stands in: the nearest named road centreline within 25 m
  const streetOf = (lon: number, lat: number): string | undefined => {
    const q = lonLatToMercator({ lon, lat });
    let best: { name: string; d: number } | null = null;
    for (const r of b.base.roads) {
      if (!r.name) continue;
      for (let i = 0; i < r.coords.length - 1; i++) {
        const a = lonLatToMercator({ lon: r.coords[i][0], lat: r.coords[i][1] }), c = lonLatToMercator({ lon: r.coords[i + 1][0], lat: r.coords[i + 1][1] });
        const d = segDistM(q, a, c) / k;
        if (d <= 25 && (!best || d < best.d)) best = { name: titleCase(r.name), d };
      }
    }
    return best?.name;
  };
  const photos = ph.photos.map((p) => {
    const street = streetOf(p.lon, p.lat);
    const side = compassWord(p.bearingFromSite), look = compassWord(p.heading), when = monthYear(p.date);
    const where = p.distanceM < 3 ? 'at the boundary' : `${fmtNum(p.distanceM)} m ${side} of the site`;
    const aim = p.facing === 'street' ? ' along the street' : p.view === 'corner' ? ' at the corner' : p.view === 'oblique' ? ', oblique to the frontage' : '';
    const caption = `${p.n} · from ${street ?? 'the street'}, ${where}, looking ${look}${aim} · ${SOURCE_WORD[p.source]}${p.author ? ` (${p.author})` : ''}${when ? `, ${when}` : ''} · ${p.licence}`;
    return { ...p, street, side, look, when, caption };
  });
  const facingCount = photos.filter((p) => p.facing === 'site').length;
  // the plan: the smallest round scale that keeps every camera and the site clear of the edges
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const pts: [number, number][] = [...photos.map((p) => [p.lon, p.lat] as [number, number]), ...siteRings.flatMap((r) => r.map(([lon, lat]) => [lon, lat] as [number, number]))];
  const fits = (scale: number) => { const proj = panelProjector({ center: b.panel.center, scale, wMm: PANEL_W, hMm: PANEL_H }); return pts.every(([lon, lat]) => { const [x, y] = proj(lon, lat); return x > 6 && x < PANEL_W - 6 && y > 6 && y < PANEL_H - 6; }); };
  const scale = photos.length ? (PLAN_SCALES.find(fits) ?? PLAN_SCALES[PLAN_SCALES.length - 1]) : Math.max(1500, PLAN_SCALES.find(fits) ?? 1500);
  const planPanel: Panel = { center: b.panel.center, scale, wMm: PANEL_W, hMm: PANEL_H };
  // the street frontages no frame looks at the site from, for the sentence and the placeholders: a neighbour's side is
  // photographed from the street too, so the compass points round the site are not what the visit has to cover
  const frontages = siteBoundary(b).frontages;
  const coveredStreets = new Set(photos.filter((p) => p.facing === 'site' && p.street).map((p) => p.street!));
  const uncoveredFrontages = frontages.filter((fr) => !coveredStreets.has(fr.name)).map((fr) => ({ name: fr.name, faces: compassWord(fr.faces) }));
  const placeholders = Array.from({ length: Math.max(0, MAX_PHOTOS - photos.length) }, (_, i) => uncoveredFrontages[i]?.name);
  const rangeOf = (ps: typeof photos) => { const ds = ps.map((p) => p.date).filter((d): d is string => Boolean(d)).sort(); return ds.length ? { first: ds[0], last: ds[ds.length - 1] } : null; };
  const streetsOf = (ps: typeof photos) => [...new Set(ps.map((p) => p.street).filter((s): s is string => Boolean(s)))];
  const sourcesOf = (ps: typeof photos) => [...new Set(ps.map((p) => SOURCE_WORD[p.source]))];
  // Google's frames and the open ones are credited and dated apart: one is a licence, the other a contributor's gift
  const byGoogle = photos.filter((p) => p.source === 'google'), open = photos.filter((p) => p.source !== 'google');
  const pp = ph.pair.panel;
  const then = ph.pair.then;
  const thenCoverage: 'full' | 'partial' | 'none' = then.tiles.length ? (then.missing ? 'partial' : 'full') : 'none';
  return {
    radiusM: ph.radiusM,
    kartaview: ph.kartaview,
    mapillary: ph.mapillary,
    /** Absent for decks cached before Street View was read. */
    google: ph.google,
    photos, facingCount, streets: streetsOf(photos), sources: sourcesOf(photos),
    dateRange: rangeOf(photos),
    googleFrames: {
      count: byGoogle.length, streets: streetsOf(byGoogle), dateRange: rangeOf(byGoogle),
      frontage: byGoogle.filter((p) => p.view === 'frontage').length, corner: byGoogle.filter((p) => p.view === 'corner').length, oblique: byGoogle.filter((p) => p.view === 'oblique').length, street: byGoogle.filter((p) => p.view === 'street').length,
      licences: [...new Set(byGoogle.map((p) => p.licence))],
    },
    openFrames: {
      count: open.length, streets: streetsOf(open), dateRange: rangeOf(open), sources: sourcesOf(open),
      authors: [...new Set(open.map((p) => p.author).filter((s): s is string => Boolean(s)))],
      licence: open[0]?.licence,
    },
    planPanel, frontages: frontages.map((fr) => fr.name), uncoveredFrontages, placeholders,
    pair: {
      panel: pp, widthM: Math.round((pp.wMm / 1000) * pp.scale), heightM: Math.round((pp.hMm / 1000) * pp.scale),
      then: thenCoverage, thenTiles: then.tiles.length, thenMissing: then.missing, thenSource: then.source,
      now: ph.pair.now ? { tiles: ph.pair.now.tiles.length, imagery: b.site.imagery } : null,
    },
  };
}

export function photosSentences(b: SlidesBundle, f: ReturnType<typeof photosFacts>): string[] {
  const out: string[] = [];
  const n = f.photos.length, facing = f.facingCount;
  const kv = f.kartaview, mly = f.mapillary, g = f.google, G = f.googleFrames, O = f.openFrames;
  const taken = (r: { first: string; last: string } | null) => (r ? (monthYear(r.first) === monthYear(r.last) ? `taken in ${monthYear(r.first)}` : `taken between ${monthYear(r.first)} and ${monthYear(r.last)}`) : 'undated');
  const openBy = () => { const src = O.sources.join(' and '); return O.authors.length === 1 ? `by ${src} contributor ${O.authors[0]}` : `by ${src} contributors`; };
  // Street View first where it was read: what stands in front of the site, or why nothing does; nothing is said where no key was set
  if (G.count) {
    const what = [
      G.frontage ? (G.frontage === 1 ? `one square to ${g?.frontages === 1 ? 'its' : 'a'} street frontage` : `${numWord(G.frontage)} square to its street frontages`) : '',
      G.corner ? (G.corner === 1 ? 'one at the corner' : `${numWord(G.corner)} at its corners`) : '',
      G.oblique ? (G.oblique === 1 ? 'one oblique to a long frontage' : `${numWord(G.oblique)} oblique to its long frontages`) : '',
      G.street ? (G.street === 1 ? 'one along the street' : G.street === 2 && (g?.frontages ?? 0) <= 1 ? 'two along the street each way' : `${numWord(G.street)} along the streets`) : '',
    ].filter(Boolean);
    const shows = G.street ? `${G.count === 1 ? 'shows' : 'show'} the site and its street${G.streets.length > 1 ? 's' : ''}` : `${G.count === 1 ? 'looks' : 'look'} at the site`;
    out.push(`${capFirst(numWord(G.count))} Google Street View ${G.count === 1 ? 'frame' : 'frames'} ${shows}${G.streets.length ? ` from ${listWords(G.streets)}` : ''}, ${taken(G.dateRange)}${G.count > 1 && what.length ? `: ${listWords(what)}` : ''}.`);
    if (O.count) out.push(`${capFirst(numWord(O.count))} open ${O.count === 1 ? 'frame' : 'frames'}${O.streets.length ? ` from ${listWords(O.streets)}` : ''} ${openBy()}, ${taken(O.dateRange)}, ${O.count === 1 ? 'fills the cell' : 'fill the cells'} Street View leaves.`);
  } else if (g?.ok) out.push(g.frontages ? 'Google Street View\'s frames of the site did not download on this run.' : `Google Street View has no panorama in front of the site${g.sides ? `'s ${numWord(g.sides)} sides` : ''}.`);
  else if (g?.note && !/^not read/.test(g.note)) out.push('Google Street View did not answer for this run.');
  const mlyNote = mly.ok || G.count ? '' : ' (Mapillary is not read without a client token)';
  if (n) {
    if (!G.count) {
      const along = n - facing;
      out.push(`${capFirst(numWord(n))} open street-level ${n === 1 ? 'frame looks' : 'frames look'} at the site${along ? ` (${along === 1 ? 'one of them' : `${numWord(along)} of them`} along the street rather than at it)` : ''}${f.streets.length ? ` from ${listWords(f.streets)}` : ''}, ${taken(f.dateRange)} ${openBy()}.`);
    }
    const lastMs = f.dateRange ? Date.parse(f.dateRange.last) : NaN;
    const ageYears = Number.isFinite(lastMs) ? (Date.parse(b.generatedAt) - lastMs) / (365.25 * 24 * 3600e3) : NaN;
    const age = Number.isFinite(ageYears) && ageYears >= 1 ? `The newest is ${ageYears >= 2 ? `${Math.round(ageYears)} years` : 'over a year'} old, so the frontage and the street may have changed since; the` : 'The';
    const frame = G.count ? 'frame' : 'open frame';
    const unc = f.uncoveredFrontages;
    out.push(`${age} frames stand in until the site visit${unc.length ? `, which also covers the ${listWords(unc.map((u) => u.name))} ${unc.length === 1 ? 'frontage' : 'frontages'}, where no ${frame} looks at the site` : ''}${f.placeholders.length ? '; the placeholders are sized for its photographs' : ''}.`);
  } else if (kv.ok && kv.frames) {
    out.push(`KartaView holds ${fmtNum(kv.frames)} frames within ${f.radiusM} m of the site, but none of them looks at it${mlyNote}, so the site visit supplies the photographs; the placeholders are sized for them, and the plan and the aerial pair carry the slide until then.`);
  } else if (kv.ok) {
    out.push(`No open street-level frame lies within ${f.radiusM} m of the site${mlyNote}, so the site visit supplies the photographs; the placeholders are sized for them, and the plan and the aerial pair carry the slide until then.`);
  } else {
    out.push(`KartaView did not answer for this run${mlyNote}, so no open street-level frame is shown; the site visit supplies the photographs and the placeholders are sized for them.`);
  }
  const pr = f.pair;
  const nowDate = pr.now?.imagery?.date ? ` of ${fmtIso(pr.now.imagery.date)}` : '';
  if (pr.then !== 'none') out.push(`The 1943 aerial survey of Sydney sits beside today's capture${nowDate}: the same ${pr.widthM} × ${pr.heightM} m of ground at 1:${fmtNum(pr.panel.scale)}, north up, for the block's grain, its buildings and its trees then and now${pr.then === 'partial' ? '; the survey stops part-way across the panel' : ''}.`);
  else if (pr.now) out.push(`The State's 1943 aerial survey covers the Sydney region only and has no tile here, so the pair shows today's capture${nowDate} alone.`);
  else out.push('Neither the 1943 aerial survey nor today\'s imagery answered for the pair on this run.');
  return out;
}

export function photosSlide(b: SlidesBundle): Slide {
  const t = tpl();
  const ph = b.photos;
  const f = photosFacts(b);
  const img = b.site.imagery;
  const sentences = photosSentences(b, f);
  const imgWords = img ? ` (${titleCase(img.block)} block${img.date ? `, captured ${fmtIso(img.date)}` : ''}${img.resolutionCm ? `, ${img.resolutionCm} cm` : ''})` : '';
  const g = f.google, G = f.googleFrames, O = f.openFrames;
  // Google's part of the fine print: how its frames were found, or why there are none; decks read before it say nothing
  const googleFine = !g ? '' : g.ok
    ? `Google Street View Static API (${G.licences.length ? G.licences.join(', ') : '© Google'}): its free metadata service asked for the outdoor panorama nearest a point ${SV_PROBE_OUT_M} m out from the middle of each side of the site's outline, and found ${!g.sides ? 'no outline to probe' : g.frontages ? `one in front of ${numWord(g.frontages)} of its ${numWord(g.sides)} sides` : `none in front of its ${numWord(g.sides)} sides`}${g.offStreet ? `, setting aside ${numWord(g.offStreet)} that stood inside another lot or a building or looked through a neighbour's (the NSW cadastre and the footprints)` : ''}${G.count ? `; each frame looks at a frontage square on, at a corner or obliquely${G.street ? ', or along the street from a frontage\'s camera' : ''}, with a field of view wide enough to take it in, uncropped and dated to the month of capture` : ''}; `
    : g.note && !/^not read/.test(g.note) ? 'Google Street View did not answer for this run; ' : 'Google Street View not read (no API key); ';
  const openFine = O.count ? `open street-level frames from ${listWords(O.sources)} (the contributors named under each frame, ${O.licence}): the frames within ${f.radiusM} m of the site whose view cone takes it in, one per side where there is one${G.count ? ', away from Street View\'s cameras' : ''}, cropped to the grid; headings without a record are read from the camera's track` : `KartaView's nearby-photos listing within ${f.radiusM} m of the site`;
  const textHtml = sentences.map(para).join('') +
    placeholder('Site visit — for the author: the visit\'s photographs replace these frames, keyed to the plan: each face of the site from the street, the street both ways, the neighbours\' interfaces, the trees, the levels and retaining walls, the services in the footpath, the building\'s fabric and condition.') +
    `<div class="fine">Sources: ${googleFine}${openFine}; ${f.mapillary.ok ? 'Mapillary read with a client token' : 'Mapillary not read (no client token)'}; the 1943 aerial survey from NSW Spatial Services' Historical Imagery 1943 tile service (level 18, about half a metre a pixel); today's aerial NSW Imagery via SIX Maps${imgWords}; cadastre, roads and footprints as on slide 11. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;

  // ---- the camera plan
  const p = f.planPanel;
  const proj = panelProjector(p);
  const parts: string[] = [baseLayers(b.base, proj, p)];
  if (b.buildings.buildings.length) parts.push(`<path d="${b.buildings.buildings.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="#e8e5df" stroke="#cdc8bf" stroke-width="0.12" fill-rule="evenodd"/>`);
  parts.push(overLayers(b.base, proj, p, 'both'));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  const camXY = f.photos.map((c) => proj(c.lon, c.lat));
  for (const [x, y] of camXY) spacer.take(x, y, 7, 7);
  const fb = furnitureBox(p, 'left');
  spacer.take((fb.x0 + fb.x1) / 2, (fb.y0 + fb.y1) / 2, fb.x1 - fb.x0, fb.y1 - fb.y0);
  // road names along their centrelines, once each, the longest run of a name first
  const named = new Set<string>();
  for (const r of [...b.base.roads].sort((u, v) => v.coords.length - u.coords.length)) {
    if (!r.name || named.has(r.name)) continue;
    const raw = r.coords.map(([lon, lat]) => proj(lon, lat));
    const dense: [number, number][] = [];
    for (let i = 0; i < raw.length - 1; i++) { const [x1, y1] = raw[i], [x2, y2] = raw[i + 1]; const nn = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3)); for (let j = 0; j < nn; j++) dense.push([x1 + ((x2 - x1) * j) / nn, y1 + ((y2 - y1) * j) / nn]); }
    if (raw.length) dense.push(raw[raw.length - 1]);
    const pts = dense.filter(([x, y]) => x > 4 && x < p.wMm - 4 && y > 4 && y < p.hMm - 4);
    if (pts.length < 2) continue;
    const text = titleCase(r.name).toUpperCase();
    const w = labelW(text, 2.1) + 1.2, h = 2.8;
    // the middle of the run first, then either side of it, on the line or beside it, until a spot is free of the cameras, the other names, the scale bar and the edges
    let placed = false;
    for (const frac of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
      if (placed) break;
      const i = Math.min(pts.length - 1, Math.max(0, Math.round((pts.length - 1) * frac)));
      const [x1, y1] = pts[Math.max(0, i - 1)], [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
      let rot = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; if (rot > 90 || rot < -90) rot += 180;
      const rad = (rot * Math.PI) / 180;
      // the label's footprint once rotated
      const bw = Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h, bh = Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h;
      const nx = -Math.sin(rad), ny = Math.cos(rad);
      for (const off of [0, 6, -6]) {
        const x = pts[i][0] + nx * off, y = pts[i][1] + ny * off;
        if (!spacer.take(x, y, bw, bh)) continue;
        named.add(r.name); placed = true;
        // a white slip under the name masks the centreline, which would otherwise show through the word gaps
        parts.push(`<g transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${(x - w / 2).toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" fill="#ffffff" fill-opacity="0.92"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="2.1" letter-spacing="0.06em" fill="#59625d">${esc(text)}</text></g>`);
        break;
      }
    }
  }
  // the view cones, then the numbered cameras over them
  const coneR = 9;
  f.photos.forEach((c, i) => {
    const [x, y] = camXY[i];
    const half = c.fov ? c.fov / 2 : 22;
    const a0 = ((c.heading - half) * Math.PI) / 180, a1 = ((c.heading + half) * Math.PI) / 180;
    const x0 = x + coneR * Math.sin(a0), y0 = y - coneR * Math.cos(a0), x1 = x + coneR * Math.sin(a1), y1 = y - coneR * Math.cos(a1);
    parts.push(`<path d="M${x.toFixed(2)},${y.toFixed(2)} L${x0.toFixed(2)},${y0.toFixed(2)} A${coneR},${coneR} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${CAMERA_COLOUR}" fill-opacity="${c.facing === 'site' ? 0.22 : 0.12}" stroke="${CAMERA_COLOUR}" stroke-width="0.2" stroke-opacity="0.6"/>`);
  });
  f.photos.forEach((c, i) => {
    const [x, y] = camXY[i];
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.5" fill="${CAMERA_COLOUR}" stroke="#ffffff" stroke-width="0.4"/><text x="${x.toFixed(2)}" y="${(y + 0.95).toFixed(2)}" text-anchor="middle" font-size="2.6" font-weight="600" fill="#ffffff">${c.n}</text>`);
  });
  if (!f.photos.length) parts.push(emptyNote([...(g?.ok && !g.frontages ? ['Street View has no panorama in front of the site.'] : []), ph.kartaview.ok ? (ph.kartaview.frames ? `None of the ${fmtNum(ph.kartaview.frames)} open frames within ${ph.radiusM} m looks at the site.` : `No open street-level frame within ${ph.radiusM} m.`) : 'KartaView did not answer for this run.']));
  parts.push(panelFurniture(p, 'left'));
  const planSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-cams"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-cams)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // ---- then and now: the same ground twice
  const pp = ph.pair.panel;
  const pe = panelExtent(pp);
  const pproj = panelProjector(pp);
  const sx = pp.wMm / (pe.xmax - pe.xmin), sy = pp.hMm / (pe.ymax - pe.ymin);
  const tag = (text: string) => `<g><rect x="1.5" y="1.5" width="${(labelW(text, 2.6) + 1.6).toFixed(1)}" height="4.6" fill="#ffffff" fill-opacity="0.92"/><text x="2.3" y="4.9" font-size="2.6" font-weight="600" fill="${t.ink}">${esc(text)}</text></g>`;
  const pairSvg = (id: string, inner: string[]) => `<svg width="${pp.wMm}mm" height="${pp.hMm}mm" viewBox="0 0 ${pp.wMm} ${pp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="${id}"><rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}"/></clipPath></defs>
    <g clip-path="url(#${id})" font-family="${t.font}">${inner.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${pp.wMm - 0.2}" height="${pp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;
  const thenParts: string[] = [`<rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}" fill="#e9e6df"/>`];
  // each tile at its Mercator place, a hair over size so the seams do not show
  for (const tl of ph.pair.then.tiles) thenParts.push(`<image href="data/${tl.file}" x="${((tl.xmin - pe.xmin) * sx - 0.03).toFixed(2)}" y="${((pe.ymax - tl.ymax) * sy - 0.03).toFixed(2)}" width="${((tl.xmax - tl.xmin) * sx + 0.06).toFixed(2)}" height="${((tl.ymax - tl.ymin) * sy + 0.06).toFixed(2)}" preserveAspectRatio="none"/>`);
  if (!ph.pair.then.tiles.length) thenParts.push(emptyNote(['The 1943 survey covers the', 'Sydney region only: no tile here.']));
  thenParts.push(siteMark(b.base, pproj, 'outline'), tag('1943'));
  const nowParts: string[] = [`<rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}" fill="#f5eee0"/>`];
  if (ph.pair.now) for (const tile of ph.pair.now.tiles) nowParts.push(`<image href="data/${tile.file}" x="${(tile.left * pp.wMm).toFixed(2)}" y="${(tile.top * pp.hMm).toFixed(2)}" width="${(tile.width * pp.wMm).toFixed(2)}" height="${(tile.height * pp.hMm).toFixed(2)}" preserveAspectRatio="none"/>`);
  else nowParts.push(emptyNote(['The aerial imagery did not', 'answer for this window.']));
  nowParts.push(siteMark(b.base, pproj, 'outline'), tag(img?.date ? img.date.slice(0, 4) : 'Today'), panelFurniture(pp, 'right'));

  // ---- the frames, keyed to the plan; placeholders sized for the site visit's own
  const cells: string[] = [];
  for (let i = 0; i < MAX_PHOTOS; i++) {
    const c = f.photos[i];
    if (c) cells.push(`<div class="frame"><div class="img"><img src="data/${esc(c.file)}" alt=""${c.source === 'google' ? ' class="whole"' : ''}><span class="key">${c.n}</span></div><div class="cap">${esc(c.caption)}</div></div>`);
    else {
      const street = f.placeholders[i - f.photos.length];
      cells.push(`<div class="frame ph"><div class="img">${esc(street ? `Site visit photograph: the site from ${street}` : 'Site visit photograph')}</div><div class="cap">${esc(`${i + 1} · site visit — for the author: ${street ? `the site from ${street}` : 'a frame from the visit'}, keyed on the plan`)}</div></div>`);
    }
  }

  const X2 = AUX_X;
  const rowY = FIELD_Y + PANEL_TITLE_H + PANEL_H + 3;
  const figure = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Camera positions<span class="pnote">1:${fmtNum(p.scale)} · ${f.photos.length ? 'each wedge the direction of view of the frame below' : 'no open frame to key'}</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${planSvg}</div>
    <div class="abs ptitle sm" style="left:${X2}mm;top:${FIELD_Y}mm;width:${AUX_W}mm">Then and now<span class="pnote">1:${fmtNum(pp.scale)} · the 1943 survey over today's imagery${img?.date ? ` (${fmtIso(img.date)})` : ''}</span></div>
    <div class="abs" style="left:${X2}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${pairSvg('clip-then', thenParts)}</div>
    <div class="abs" style="left:${X2}mm;top:${FIELD_Y + PANEL_TITLE_H + pp.hMm + 2}mm">${pairSvg('clip-now', nowParts)}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${rowY}mm;width:${FIELD_W}mm">Street level<span class="pnote">${f.photos.length ? `${G.count ? `Google Street View${O.count ? ' and open' : ''} frames ${G.street ? 'of the site and its street' : 'that look at the site'}` : 'open frames that look at the site'}, keyed to the plan · the site visit replaces them` : 'placeholders sized for the site visit\'s photographs'}</span></div>
    <div class="abs photos" style="left:${FIELD_X}mm;top:${rowY + PANEL_TITLE_H}mm;width:${FIELD_W}mm">${cells.join('')}</div>`;
  const n = f.photos.length;
  const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const framesWord = G.count ? (O.count ? `${G.count} Street View and ${plural(O.count, 'open frame')}` : plural(G.count, 'Street View frame')) : n ? plural(n, 'open street-level frame') : g?.ok ? 'no street-level frame' : 'no open street-level frame';
  const sub = [b.siteAddress, framesWord, f.pair.then !== 'none' ? '1943 and today' : 'today\'s aerial only'].filter(Boolean).join(' · ');
  return { id: '12_existing_site_condition', title: 'Existing site condition', subtitle: sub, textHtml, figureHtml: figure };
}

/** Existing site condition on the template: 1943 over today on the full page, the cameras keyed on today's half; the frames down the left. */
export function conditionAtlas(b: SlidesBundle): Slide {
  const t = tpl();
  const O = INK.orange;
  const ph = b.photos;
  const f = photosFacts(b);
  const img = b.site.imagery;
  const pp = ph.pair.panel;
  const pe = panelExtent(pp);
  const pproj = panelProjector(pp);
  const sx = pp.wMm / (pe.xmax - pe.xmin), sy = pp.hMm / (pe.ymax - pe.ymin);
  const half = (id: string, inner: string) => `<svg width="${pp.wMm}mm" height="${pp.hMm}mm" viewBox="0 0 ${pp.wMm} ${pp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block"><defs><clipPath id="${id}"><rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}"/></clipPath></defs><g clip-path="url(#${id})">${inner}</g></svg>`;
  const then: string[] = [`<rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}" fill="#e6e6e6"/>`];
  for (const tl of ph.pair.then.tiles) then.push(`<image href="data/${tl.file}" x="${((tl.xmin - pe.xmin) * sx - 0.03).toFixed(2)}" y="${((pe.ymax - tl.ymax) * sy - 0.03).toFixed(2)}" width="${((tl.xmax - tl.xmin) * sx + 0.06).toFixed(2)}" height="${((tl.ymax - tl.ymin) * sy + 0.06).toFixed(2)}" preserveAspectRatio="none"/>`);
  then.push(siteMark(b.base, pproj, 'outline'));
  const now: string[] = [`<rect x="0" y="0" width="${pp.wMm}" height="${pp.hMm}" fill="#e6e6e6"/>`];
  if (ph.pair.now) now.push(aerialTiles(ph.pair.now.tiles, pp));
  now.push(siteMark(b.base, pproj, 'outline'));
  // the frames that look at the site from its own frontages; frames from further streets do not show it
  const series = ph.series ?? [];
  const frames = series.length ? [] : f.photos.filter((cam) => cam.source === 'google' || cam.distanceM <= FRONTAGE_REACH_M);
  const coneR = 12;
  // the street end to end: a short cone each, square to the side it shows, so they sit side by side along the street
  for (const fr of series) {
    const [x, y] = pproj(fr.lon, fr.lat);
    const r = 9, h2 = fr.fov / 2;
    const a0 = ((fr.heading - h2) * Math.PI) / 180, a1 = ((fr.heading + h2) * Math.PI) / 180;
    now.push(fillShape(`M${x.toFixed(2)},${y.toFixed(2)}L${(x + r * Math.sin(a0)).toFixed(2)},${(y - r * Math.cos(a0)).toFixed(2)}A${r},${r} 0 0 1 ${(x + r * Math.sin(a1)).toFixed(2)},${(y - r * Math.cos(a1)).toFixed(2)}Z`, { x0: x - r, y0: y - r, x1: x + r, y1: y + r }, { bg: '#ffffff', kind: 'vlines', ink: O.deep, step: 0.5, w: 0.18, outline: O.deep, outlineW: 0.3 }));
  }
  for (const fr of series) { const [x, y] = pproj(fr.lon, fr.lat); now.push(aerialKey(x, y, fr.n, 1.7)); }
  for (const cam of frames) {
    const [x, y] = pproj(cam.lon, cam.lat);
    const h2 = cam.fov ? cam.fov / 2 : 22;
    const a0 = ((cam.heading - h2) * Math.PI) / 180, a1 = ((cam.heading + h2) * Math.PI) / 180;
    now.push(fillShape(`M${x.toFixed(2)},${y.toFixed(2)}L${(x + coneR * Math.sin(a0)).toFixed(2)},${(y - coneR * Math.cos(a0)).toFixed(2)}A${coneR},${coneR} 0 0 1 ${(x + coneR * Math.sin(a1)).toFixed(2)},${(y - coneR * Math.cos(a1)).toFixed(2)}Z`, { x0: x - coneR, y0: y - coneR, x1: x + coneR, y1: y + coneR }, { bg: '#ffffff', kind: 'vlines', ink: O.deep, step: 0.5, w: 0.18, outline: O.deep, outlineW: 0.3 }));
  }
  frames.forEach((cam, i) => { const [x, y] = pproj(cam.lon, cam.lat); now.push(aerialKey(x, y, i + 1)); });
  now.push(panelFurniture(pp, 'left'));
  const figure = `<div class="abs" style="left:${FOLD}mm;top:0">${half('cond-then', then.join(''))}</div>
    <div class="abs" style="left:${FOLD}mm;top:${pp.hMm}mm">${half('cond-now', now.join(''))}</div>
    <div class="abs zrule" style="left:${FOLD}mm;top:${pp.hMm}mm;width:${pp.wMm}mm;border-top:0.35mm solid #ffffff"></div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:8mm">1943 · the aerial survey · 1:${fmtNum(pp.scale).replace(',', ' ')}</div>
    <div class="abs maplabel" style="left:${FOLD + 8}mm;top:${pp.hMm + 8}mm">${img?.date ? img.date.slice(0, 4) : 'Today'} · NSW Imagery</div>`;

  // eight frames: the street-level ones from the frontages first, then the site's edges from above at 7 cm, clockwise from north
  const sf = siteFacts(b);
  const compass = (h: number) => bearingName(h);
  const monthYear = (d?: string) => (d ? new Date(`${d}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  const cells: { file?: string; svg?: string; n: number | string; caption: string; whole?: boolean }[] = series.length
    ? series.map((fr) => ({ file: fr.file, n: fr.n, caption: `${fr.n} ${tidyName(titleCase(fr.street))}, ${Math.abs(fr.alongM) < 12 ? 'at the site' : `${fmtNum(Math.abs(Math.round(fr.alongM / 5) * 5))} m ${fr.alongM < 0 ? 'before' : 'past'} the site`} · looking ${compass(fr.heading)}${fr.side === 'site' ? ', the site\'s side' : ', the far side'} · ${monthYear(fr.date)} © Google` }))
    : frames.slice(0, 8).map((cam, i) => ({ file: cam.file, n: i + 1, caption: `${i + 1} ${cam.caption.replace(/^\d+ · /, '')}` }));
  const sp = b.site.sitePanel;
  if (b.site.aerial && cells.length < 8) {
    const sproj = panelProjector(sp);
    const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
    const bb = bboxOf(siteRings, sproj);
    const VIEW = 600, fw = 59.33, fh = 39.5, vw = (fw * VIEW) / sp.scale, vh = (fh * VIEW) / sp.scale;
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const spots: { name: string; bearing: number; x: number; y: number }[] = [
      { name: 'north', bearing: 0, x: cx, y: bb.y0 }, { name: 'north-east', bearing: 45, x: bb.x1, y: bb.y0 }, { name: 'east', bearing: 90, x: bb.x1, y: cy }, { name: 'south-east', bearing: 135, x: bb.x1, y: bb.y1 },
      { name: 'south', bearing: 180, x: cx, y: bb.y1 }, { name: 'south-west', bearing: 225, x: bb.x0, y: bb.y1 }, { name: 'west', bearing: 270, x: bb.x0, y: cy }, { name: 'north-west', bearing: 315, x: bb.x0, y: bb.y0 },
    ];
    const tiles = b.site.aerial.tiles.map((tile) => `<image href="data/${tile.file}" x="${(tile.left * sp.wMm).toFixed(2)}" y="${(tile.top * sp.hMm).toFixed(2)}" width="${(tile.width * sp.wMm + 0.04).toFixed(2)}" height="${(tile.height * sp.hMm + 0.04).toFixed(2)}" preserveAspectRatio="none"/>`).join('');
    const outline = `<path d="${ringsPath(siteRings, sproj)}" fill="none" stroke="${t.site}" stroke-width="${(0.45 * sp.scale / VIEW).toFixed(2)}" stroke-linejoin="round"/>`;
    const facing = (bearing: number) => sf.frontages.find((fr) => angleGap(fr.faces, bearing) <= 30);
    for (const sv of spots) {
      if (cells.length >= 8) break;
      const fr = facing(sv.bearing);
      const svg = `<svg width="${fw}mm" height="${fh}mm" viewBox="${(sv.x - vw / 2).toFixed(2)} ${(sv.y - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" style="display:block"><rect x="0" y="0" width="${sp.wMm}" height="${sp.hMm}" fill="#e6e6e6"/>${tiles}${outline}</svg>`;
      const n = cells.length + 1;
      cells.push({ svg, n, caption: `${n} The ${sv.name} ${sv.name.includes('-') ? 'corner' : 'side'}${fr ? `, to ${fr.name}` : ''} · 1:${VIEW} from above` });
    }
  }
  const streetName = series[0] ? tidyName(titleCase(series[0].street)) : '';
  const blocks = series.length ? [zBlock(`${streetName}, end to end`, zPhotos(cells), 'Google Street View')] : [zBlock(frames.length ? 'Street level and from above' : 'The site from above', zPhotos(cells), `NSW Imagery${img?.resolutionCm ? ` ${img.resolutionCm} cm` : ''}${img?.date ? ` · ${fmtIso(img.date)}` : ''}`)];
  if (series.length) blocks.length = 1;
  const sources = `Sources: ${series.length ? `Google Street View Static API, ${streetName} in ${series.length} frames about ${Math.round(Math.abs(series[series.length - 1].alongM - series[0].alongM) / Math.max(1, series.length - 1))} m apart, © Google; ` : ''}${frames.length ? `street-level frames from ${listWords([...new Set(frames.map((cam) => cam.source === 'google' ? 'Google Street View' : 'KartaView'))])}, credited under each; ` : ''}the 1943 aerial survey from NSW Spatial Services' Historical Imagery; today's aerial NSW Imagery via SIX Maps${img?.date ? `, captured ${fmtIso(img.date)}` : ''}${img?.resolutionCm ? `, ${img.resolutionCm} cm` : ''}${frames.length < 8 ? '; where no camera stands in front of a side, that side is shown from above' : ''}. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, f.pair.then !== 'none' ? '1943 and today' : "today's aerial", series.length ? `${streetName} in ${series.length} frames` : frames.length ? `${frames.length} street-level frame${frames.length === 1 ? '' : 's'}` : 'the edges from above');
  const pe2 = panelExtent(pp), k2 = mercatorScaleFactor(mercatorToLonLat(pp.center).lat);
  const narrative = brief([
    `The 1943 aerial survey sits over today's capture${img?.date ? ` of ${fmtIso(img.date)}` : ''}: the same ${fmtNum(Math.round((pe2.xmax - pe2.xmin) / k2))} × ${fmtNum(Math.round((pe2.ymax - pe2.ymin) / k2))} m at 1:${fmtNum(pp.scale)}, north up, for the grain of the block then and now.`,
    sf.buildings.onSite.length ? `Today ${sf.buildings.onSite.length === 1 ? 'one building covers' : `${sf.buildings.onSite.length} buildings cover`} ${fmtPct(sf.buildings.coveragePct)} of the lot.` : '',
    series.length ? `${capFirst(numWord(series.length))} Street View frames walk ${streetName} past the site, square to each side in turn.` : frames.length ? `${capFirst(numWord(frames.length))} street-level frame${frames.length === 1 ? ' looks' : 's look'} at the site from its frontages.` : `The frames show the site's edges from above at 1:600.`,
  ]);
  return { id: '12_existing_site_condition', title: 'Existing site condition', subtitle: sub, textHtml: '', figureHtml: figure + zFlow(blocks), bleed: true, sources, accent: O.text,
    narrative };
}

// ---- slide 13: grid, sun and views --------------------------------------------

const SUN_COLOUR = '#dca62e';
const SHADOW_HOURS: { hour: number; label: string; fill: string; opacity: number }[] = [
  { hour: 9, label: '9 am', fill: '#4a5a62', opacity: 0.14 },
  { hour: 12, label: 'noon', fill: '#4a5a62', opacity: 0.22 },
  { hour: 15, label: '3 pm', fill: '#4a5a62', opacity: 0.14 },
];
const VIEW_COLOUR: Record<ViewKind, string> = { city: '#2c4c9c', water: '#3e7e9c', ocean: '#3e7e9c', park: '#4c8a68' };
const VIEW_WORD: Record<ViewKind, string> = { city: 'skyline', water: 'water', ocean: 'ocean', park: 'park' };
/** A view target named so prose reads: "the Parramatta skyline", not a bare "Parramatta". */
const viewPhrase = (v: { label: string; kind: ViewKind | string }) => (v.kind === 'city' && !/skyline/i.test(v.label) ? `the ${v.label} skyline` : v.label);
/** Clock offsets the deck uses: standard time for the winter day, daylight time for the summer one. */
const AEST = 10, AEDT = 11;
const SOLAR_YEAR = 2026;
const compass16 = (deg: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const compassWord = (deg: number) => bearingName(deg);
/** The sixteen points in words, for the way a wind blows from: "north-north-east". */
const WIND_POINTS = ['north', 'north-north-east', 'north-east', 'east-north-east', 'east', 'east-south-east', 'south-east', 'south-south-east', 'south', 'south-south-west', 'south-west', 'west-south-west', 'west', 'west-north-west', 'north-west', 'north-north-west'];
const windFrom = (deg: number) => WIND_POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
/** "north-easterly", "westerly". */
const windly = (deg: number) => `${windFrom(deg)}erly`;
/** "north-easterlies", "southerlies". */
const windlies = (deg: number) => `${windFrom(deg)}erlies`;

export function sunViewFacts(b: SlidesBundle) {
  const centreLL = mercatorToLonLat(b.panel.center);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const ringsMerc = siteRings.map((r) => r.map(([lon, lat]) => toM(lon, lat)));

  // The street grid: the roads' segment bearings, length-weighted, folded to 0–180 in 5° bins.
  const bins = new Array(36).fill(0) as number[];
  let totalLen = 0;
  for (const r of b.base.roads) {
    const pts = r.coords.map(([lon, lat]) => toM(lon, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      const len = Math.hypot(dx, dy) / k;
      if (len < 2) continue;
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180;
      bins[Math.floor(bearing / 5) % 36] += len; totalLen += len;
    }
  }
  const smooth = bins.map((_, i) => bins[(i + 35) % 36] * 0.5 + bins[i] + bins[(i + 1) % 36] * 0.5);
  const primaryBin = smooth.indexOf(Math.max(...smooth));
  const primaryDeg = (primaryBin * 5 + 2.5) % 180;
  const awayFrom = (i: number, j: number) => Math.min(Math.abs(i - j), 36 - Math.abs(i - j));
  let secondaryBin = -1;
  for (let i = 0; i < 36; i++) if (awayFrom(i, primaryBin) >= 6 && (secondaryBin < 0 || smooth[i] > smooth[secondaryBin])) secondaryBin = i;
  const secondaryDeg = secondaryBin >= 0 ? (secondaryBin * 5 + 2.5) % 180 : null;
  const share = (bin: number) => (totalLen ? ([bin - 1, bin, bin + 1].reduce((a, i) => a + bins[((i % 36) + 36) % 36], 0) / totalLen) * 100 : 0);

  // The site's long axis and its frontages' facing.
  let longest = { lengthM: 0, bearing: 0 };
  const frontFaces: { name: string; facing: number; lengthM: number }[] = [];
  for (const ring of ringsMerc) {
    const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
    let area = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; area += u.x * v.y - v.x * u.y; }
    const ccw = area > 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) / k;
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      if (len > longest.lengthM) longest = { lengthM: len, bearing: bearing % 180 };
      const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const outward = ((bearing + (ccw ? 90 : -90)) + 360) % 360;
      const best = roadAlongEdge(mid, bearing, b.base.roads, k, toM);
      if (best) { const cur = frontFaces.find((f) => f.name === best.name); if (cur) { cur.lengthM += len; } else frontFaces.push({ name: best.name, facing: outward, lengthM: len }); }
    }
  }
  // how far the site's long axis sits from the nearer grid axis
  const axisGap = (a: number, b2: number) => { let d = Math.abs(a - b2) % 180; if (d > 90) d = 180 - d; return d; };
  const offGrid = Math.round(Math.min(axisGap(longest.bearing, primaryDeg), secondaryDeg === null ? 90 : axisGap(longest.bearing, secondaryDeg)));
  // the row the site stands in, when one footprint covers the lot and runs on: its neighbours cannot be told apart from the site's own building
  const sharedRow = b.buildings.buildings.some((bd) => bd.rings.some((r) => pointInRing(mercatorToLonLat(b.site.sitePanel.center).lon, mercatorToLonLat(b.site.sitePanel.center).lat, r)) && (bd.rings[0] ?? []).filter(([lon, lat]) => !siteRings.some((sr) => pointInRing(lon, lat, sr))).length > (bd.rings[0] ?? []).length * 0.5);

  // The sun: the two solstices and the equinox, in the clock people keep on those days.
  const sun = {
    winter: { ...sunTimes(centreLL.lat, centreLL.lon, SOLAR_YEAR, 6, 21, AEST), offset: AEST, hours: [9, 12, 15].map((h) => ({ hour: h, ...sunPosition(centreLL.lat, centreLL.lon, civilToUtc(SOLAR_YEAR, 6, 21, h * 60, AEST)) })) },
    summer: { ...sunTimes(centreLL.lat, centreLL.lon, SOLAR_YEAR, 12, 21, AEDT), offset: AEDT, hours: [9, 12, 15].map((h) => ({ hour: h, ...sunPosition(centreLL.lat, centreLL.lon, civilToUtc(SOLAR_YEAR, 12, 21, h * 60, AEDT)) })) },
    equinox: { ...sunTimes(centreLL.lat, centreLL.lon, SOLAR_YEAR, 3, 21, AEDT), offset: AEDT },
  };

  // The neighbours' shadows on 21 June at 9, noon and 3: every footprint with a height that is not the site's own.
  const inside = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  const siteAreaSqm = b.siteAreaSqm ?? 0;
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const r of ringsMerc) for (const q of r) { sx0 = Math.min(sx0, q.x); sy0 = Math.min(sy0, q.y); sx1 = Math.max(sx1, q.x); sy1 = Math.max(sy1, q.y); }
  const stepM = Math.max(0.5, Math.sqrt(Math.max(1, siteAreaSqm) / 1600));
  const samples: XY[] = [];
  for (let x = sx0; x <= sx1; x += stepM * k) for (let y = sy0; y <= sy1; y += stepM * k) { const ll = mercatorToLonLat({ x, y }); if (inside(ll.lon, ll.lat)) samples.push({ x, y }); }
  const lotCentre = mercatorToLonLat(b.site.sitePanel.center);
  type Bldg = (typeof b.buildings.buildings)[number];
  const notSite = (bd: Bldg) => bd.rings[0]?.length >= 4 && !inside(bd.centroid[0], bd.centroid[1]) && !bd.rings.some((r) => pointInRing(lotCentre.lon, lotCentre.lat, r));
  const casters = b.buildings.buildings.filter((bd) => bd.estimatedHeightM && notSite(bd));
  // a footprint is within reach when its shadow length plus its own span could touch the lot
  const siteSpanM = Math.max(sx1 - sx0, sy1 - sy0) / k;
  const inReach = (bd: Bldg, altitudeDeg: number) => {
    const c = toM(bd.centroid[0], bd.centroid[1]);
    const reachM = bd.estimatedHeightM! / Math.tan((Math.max(3, altitudeDeg) * Math.PI) / 180) + 60;
    return Math.hypot(c.x - b.site.sitePanel.center.x, c.y - b.site.sitePanel.center.y) / k <= reachM + siteSpanM;
  };
  const lowestAlt = Math.min(...sun.winter.hours.map((h) => h.altitudeDeg));
  const castersInReach = casters.filter((bd) => inReach(bd, lowestAlt)).length;
  // how far the known heights cover the block: the footprints within 60 m of the boundary
  const distFromSiteM = (bd: Bldg) => { const c = toM(bd.centroid[0], bd.centroid[1]); let d = Infinity; for (const r of ringsMerc) for (const q of r) d = Math.min(d, Math.hypot(q.x - c.x, q.y - c.y)); return d / k; };
  const nearBuildings = b.buildings.buildings.filter((bd) => notSite(bd) && distFromSiteM(bd) <= 60);
  const near = { total: nearBuildings.length, withHeight: nearBuildings.filter((bd) => bd.estimatedHeightM).length, fromDa: nearBuildings.filter((bd) => bd.heightFrom === 'da').length };
  const shadows = SHADOW_HOURS.map((sh) => {
    const pos = sun.winter.hours.find((h) => h.hour === sh.hour)!;
    const hulls: { hull: XY[]; heightM: number; floors?: number; bearing: number; hits: number; lon: number; lat: number }[] = [];
    const shaded = new Set<number>();
    for (const bd of casters) {
      if (!inReach(bd, pos.altitudeDeg)) continue;
      const ring = bd.rings[0].map(([lon, lat]) => toM(lon, lat));
      const c = toM(bd.centroid[0], bd.centroid[1]);
      const hull = shadowHull(ring, bd.estimatedHeightM!, pos.altitudeDeg, pos.azimuthDeg, k);
      if (!hull) continue;
      let hits = 0;
      samples.forEach((q, i) => { if (inHull(q, hull)) { hits++; shaded.add(i); } });
      hulls.push({ hull, heightM: bd.estimatedHeightM!, floors: bd.floors, bearing: ((Math.atan2(c.x - b.site.sitePanel.center.x, c.y - b.site.sitePanel.center.y) * 180) / Math.PI + 360) % 360, hits, lon: bd.centroid[0], lat: bd.centroid[1] });
    }
    const main = hulls.filter((h) => h.hits).sort((x, y) => y.hits - x.hits)[0];
    return { ...sh, altitudeDeg: pos.altitudeDeg, azimuthDeg: pos.azimuthDeg, shadedPct: samples.length ? (shaded.size / samples.length) * 100 : 0, hulls, mainCaster: main ? { heightM: main.heightM, floors: main.floors, bearing: main.bearing, sharePct: (main.hits / Math.max(1, samples.length)) * 100, lon: main.lon, lat: main.lat } : null };
  });

  // The wind: each season's prevailing runs of sectors, and the frontages that face one (its middle within 45° of the way the frontage faces).
  const wd = b.wind;
  const faceOn = (fr: { facing: number }, deg: number) => { const d = Math.abs((((fr.facing - deg) % 360) + 540) % 360 - 180); return d <= 45; };
  const lobes = wd?.ok ? { summer: windLobes(wd.summer), winter: windLobes(wd.winter), summerAfternoon: windLobes(wd.summerAfternoon), winterMorning: windLobes(wd.winterMorning) } : null;
  const exposure = lobes ? (['summer', 'winter'] as const).flatMap((season) => lobes[season].map((l, i) => ({ season, lobe: i, centre: l.centre, frontages: frontFaces.filter((fr) => faceOn(fr, l.centre)).map((fr) => ({ name: fr.name, facingWord: compassWord(fr.facing) })) })).filter((e) => e.frontages.length)) : [];
  const wind = wd ? { ok: wd.ok, note: wd.note, years: wd.years, lat: wd.lat, lon: wd.lon, elevationM: wd.elevationM, fetchedAt: wd.fetchedAt, summer: wd.summer, winter: wd.winter, summerAfternoon: { meanKmh: wd.summerAfternoon.meanKmh, hours: wd.summerAfternoon.hours }, winterMorning: { meanKmh: wd.winterMorning.meanKmh, hours: wd.winterMorning.hours }, lobes, exposure } : null;

  const views = b.views?.views ?? [];
  return {
    wind,
    grid: { primaryDeg: Math.round(primaryDeg), secondaryDeg: secondaryDeg === null ? null : Math.round(secondaryDeg), primarySharePct: share(primaryBin), secondarySharePct: secondaryBin >= 0 ? share(secondaryBin) : 0, bins, roadsLengthM: Math.round(totalLen), siteAxisDeg: Math.round(longest.bearing), offGridDeg: offGrid, frontages: frontFaces.map((f) => ({ ...f, facingWord: compass16(f.facing), facingName: bearingName(f.facing), lengthM: Math.round(f.lengthM * 10) / 10 })) },
    sun,
    shadows: shadows.map((s) => ({ hour: s.hour, label: s.label, altitudeDeg: Math.round(s.altitudeDeg * 10) / 10, azimuthDeg: Math.round(s.azimuthDeg), shadedPct: s.shadedPct, casters: s.hulls.filter((h) => h.hits).length, mainCaster: s.mainCaster })),
    shadowHulls: shadows.map((s) => ({ hour: s.hour, hulls: s.hulls.map((h) => h.hull) })),
    castersWithHeight: casters.length, castersInReach, near, buildingsSource: b.buildings.source, sharedRow,
    views: views.map((v) => ({ label: titleCase(v.label), kind: v.kind, bearingDeg: Math.round(v.bearingDeg), distanceM: Math.round(v.distanceM), clear: v.clear, blockedAtM: v.blockedAtM === undefined ? undefined : Math.round(v.blockedAtM), cone: Boolean(v.cone), eyeRL: v.eyeRL, targetRL: v.targetRL })),
    eyeAboveM: b.views?.eyeAboveM ?? null,
  };
}

export function sunViewSentences(b: SlidesBundle, f: ReturnType<typeof sunViewFacts>): string[] {
  const out: string[] = [];
  const g = f.grid;
  if (g.roadsLengthM) {
    let s = `The streets around the site run at ${g.primaryDeg}°${g.secondaryDeg !== null ? ` and ${g.secondaryDeg}°` : ''} from north (the length-weighted bearings of the roads in the window, ${fmtPct(g.primarySharePct)}${g.secondaryDeg !== null ? ` and ${fmtPct(g.secondarySharePct)}` : ''} of their length)`;
    s += `; the site's long boundary lies at ${g.siteAxisDeg}°, ${g.offGridDeg <= 5 ? 'on the grid' : `${g.offGridDeg}° off the grid`}`;
    if (g.frontages.length) s += `, and its frontage to ${listWords(g.frontages.map((fr) => `${fr.name} faces ${fr.facingName}`))}`;
    out.push(s + '.');
  }
  const w = f.sun.winter, su = f.sun.summer;
  out.push(`On 21 June the sun rises at ${fmtClock(w.rise)} and sets at ${fmtClock(w.set)} (AEST), reaching ${w.noonAltitudeDeg.toFixed(0)}° at solar noon (${fmtClock(w.noon)}); between 9 am and 3 pm it stands ${Math.min(...w.hours.map((h) => h.altitudeDeg)).toFixed(0)}° to ${Math.max(...w.hours.map((h) => h.altitudeDeg)).toFixed(0)}° above the horizon, from the ${compassWord(w.hours[0].azimuthDeg)} round to the ${compassWord(w.hours[2].azimuthDeg)}. On 21 December it is up from ${fmtClock(su.rise)} to ${fmtClock(su.set)} (AEDT) and ${su.noonAltitudeDeg.toFixed(0)}° high at ${fmtClock(su.noon)}, so the north face is in sun all winter and the west face takes the summer afternoon.`);
  const wi = f.wind;
  if (wi?.ok && wi.lobes && wi.lobes.summer.length && wi.lobes.winter.length) {
    const L = wi.lobes;
    const two = (ls: typeof L.summer) => `the ${windFrom(ls[0].centre)} (${fmtPct(ls[0].pct)}${ls === L.summer ? ` of the hours${L.summerAfternoon[0] ? `; ${windly(L.summerAfternoon[0].centre)} in the afternoons at ${Math.round(wi.summerAfternoon.meanKmh)} km/h` : ''}` : ''})${ls[1] ? ` and the ${windFrom(ls[1].centre)} (${fmtPct(ls[1].pct)})` : ''}`;
    let s = `Over ${wi.years[0]}–${wi.years[1]} NASA's reanalysis has the summer wind from ${two(L.summer)}, the winter wind from ${two(L.winter)}.`;
    // each frontage that faces a prevailing wind, once: "the Kellick Street frontage takes the summer north-easterlies and the winter north-north-westerlies"
    // and a wind both seasons share is named once: "the summer and winter west-south-westerlies"
    const byFront = new Map<string, Map<string, string[]>>();
    for (const e of wi.exposure) for (const fr of e.frontages) {
      const winds = byFront.get(fr.name) ?? byFront.set(fr.name, new Map()).get(fr.name)!;
      (winds.get(windlies(e.centre)) ?? winds.set(windlies(e.centre), []).get(windlies(e.centre))!).push(e.season);
    }
    const faces = [...byFront.entries()].map(([name, winds], i) => `the ${name} frontage ${i ? '' : 'takes '}${listWords([...winds.entries()].map(([w, seasons]) => `the ${listWords(seasons)} ${w}`))}`);
    if (faces.length) s += ` ${capFirst(faces.join(', '))}.`;
    out.push(`${s} It is the region's wind, not the site's: buildings and landform channel and shelter it.`);
  } else if (wi && !wi.ok) out.push('NASA\'s reanalysis did not answer for this run, so no wind rose is drawn.');
  if (f.castersInReach) {
    const sh = f.shadows;
    const worst = [...sh].sort((x, y) => y.shadedPct - x.shadedPct)[0];
    const bits = sh.map((s, i) => `${fmtPct(s.shadedPct)}${i === 0 ? ' of the site' : ''} at ${s.label}`);
    let s = `On 21 June the neighbours' shadows (${f.buildingsSource === 'overture' ? 'Overture' : 'OpenStreetMap'} footprints and heights) cover ${listWords(bits)}`;
    if (f.sharedRow) s += ' (the row the site stands in is one footprint, so its own neighbours are left out)';
    if (worst.mainCaster && worst.shadedPct >= 1) s += `; the ${worst.label} shadow is mostly the ${worst.mainCaster.floors ? `${worst.mainCaster.floors}-storey` : `${fmtNum(worst.mainCaster.heightM)} m`} building to the ${compassWord(worst.mainCaster.bearing)}`;
    const partial = f.near.total > 0 && f.near.withHeight < f.near.total;
    const daNote = f.near.fromDa ? `; ${f.near.fromDa === f.near.withHeight ? (f.near.withHeight === 1 ? 'that one' : f.near.withHeight === 2 ? 'both' : 'all of them') : f.near.fromDa === 1 ? 'one of them' : `${f.near.fromDa} of them`} the storeys of a determined DA on the lot` : '';
    const coverage = partial
      ? (f.near.withHeight === 0 ? ` (none of the ${f.near.total} buildings within 60 m has a known height)` : ` (${f.near.withHeight} of the ${f.near.total} buildings within 60 m ${f.near.withHeight === 1 ? 'has' : 'have'} a known height${daNote})`)
      : f.near.fromDa ? ` (${f.near.total === 1 ? 'the one building' : `all ${f.near.total} buildings`} within 60 m ${f.near.total === 1 ? 'has' : 'have'} a height${daNote})` : '';
    s += sh.every((x) => x.shadedPct < 1) ? `: the site keeps its winter sun${partial ? ' as far as the known heights go' : ''}${coverage}.` : `${coverage}. A model of the block is the next step; this is footprints and known heights only.`;
    out.push(s);
  } else out.push(`No building within shadow reach of the site has a known height${f.near.total && !f.near.withHeight ? ` (none of the ${f.near.total} ${f.buildingsSource === 'overture' ? 'Overture' : 'OpenStreetMap'} footprints within 60 m carries one)` : ''}, so no winter shadow can be drawn; the block model is the next step.`);
  if (f.views.length) {
    const clear = f.views.filter((v) => v.clear === true), blocked = f.views.filter((v) => v.clear === false), unchecked = f.views.filter((v) => v.clear === undefined);
    const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmtNum(m)} m`);
    const vs = (v: typeof f.views[number]) => `${v.label} (${VIEW_WORD[v.kind]}, ${km(v.distanceM)} to the ${compassWord(v.bearingDeg)})`;
    let s = '';
    if (clear.length) s += `From an eye ${f.eyeAboveM !== null ? `${fmtNum(f.eyeAboveM)} m above the site, just under the height limit` : 'at the height limit'}, the ground leaves the line clear to ${listWords(clear.map(vs))}`;
    if (blocked.length) s += `${s ? '; ' : 'From the eye at the height limit '}the ground rises across the line to ${listWords(blocked.map((v) => `${vs(v)}${v.blockedAtM ? `, at ${km(v.blockedAtM)}` : ''}`))}`;
    if (unchecked.length) s += `${s ? '; ' : ''}${listWords(unchecked.map(vs))} could not be checked`;
    out.push(`${s}. Buildings are not open data, so a clear line means the land does not rule the view out.`);
  } else out.push('No skyline, water or park lies within view range of the site, or the view check did not run.');
  return out;
}

function sunPathSvg(f: ReturnType<typeof sunViewFacts>, lat: number, lon: number, size: number, font: string): string {
  const R = size / 2 - 7, cx = size / 2, cy = size / 2;
  const pt = (alt: number, az: number): [number, number] => { const r = (R * (90 - alt)) / 90; const a = (az * Math.PI) / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  const parts: string[] = [];
  for (const alt of [0, 30, 60]) parts.push(`<circle cx="${cx}" cy="${cy}" r="${((R * (90 - alt)) / 90).toFixed(1)}" fill="${alt === 0 ? '#ffffff' : 'none'}" stroke="#c9c7c0" stroke-width="${alt === 0 ? 0.3 : 0.2}"/>`);
  for (const alt of [30, 60]) parts.push(`<text x="${(cx + 0.6).toFixed(1)}" y="${(cy - (R * (90 - alt)) / 90 + 2).toFixed(1)}" font-size="1.6" fill="#9aa19b">${alt}°</text>`);
  for (let az = 0; az < 360; az += 30) { const [x1, y1] = pt(0, az), [x2, y2] = pt(-6, az); parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9aa19b" stroke-width="0.25"/>`); }
  for (const [az, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) { const [x, y] = pt(-12, az); parts.push(`<text x="${x.toFixed(1)}" y="${(y + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" font-weight="600" fill="#454f4b">${txt}</text>`); }
  // the grid axes through the centre
  for (const d of [f.grid.primaryDeg, f.grid.secondaryDeg].filter((x): x is number => x !== null)) { const [x1, y1] = pt(0, d), [x2, y2] = pt(0, d + 180); parts.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#bdbbb3" stroke-width="0.3" stroke-dasharray="1,1"/>`); }
  const arcs: [string, number, number, number, string, string][] = [['21 Dec', 12, 21, AEDT, SUN_COLOUR, ''], ['21 Mar / 21 Sep', 3, 21, AEDT, '#c8963f', '1.2,0.8'], ['21 Jun', 6, 21, AEST, '#a4682b', '']];
  for (const [label, m, d, off, colour, dash] of arcs) {
    const path = sunPath(lat, lon, SOLAR_YEAR, m, d, off, 5).filter((s) => s.altitudeDeg >= 0);
    if (!path.length) continue;
    const dpath = path.map((s, i) => { const [x, y] = pt(s.altitudeDeg, s.azimuthDeg); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
    parts.push(`<path d="${dpath}" fill="none" stroke="${colour}" stroke-width="0.7"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    for (const s of path.filter((q) => q.clockMin % 60 === 0)) {
      const [x, y] = pt(s.altitudeDeg, s.azimuthDeg);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.7" fill="${colour}"/>`);
      if (label === '21 Jun' || label === '21 Dec') parts.push(`<text x="${x.toFixed(1)}" y="${(y - 1.3).toFixed(1)}" text-anchor="middle" font-size="1.5" fill="#6a7572">${s.clockMin / 60}</text>`);
    }
    const mid = path[Math.floor(path.length / 2)];
    const [lx, ly] = pt(mid.altitudeDeg + 7, mid.azimuthDeg);
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 0.6).toFixed(1)}" text-anchor="middle" font-size="1.7" font-weight="600" fill="${colour}">${esc(label)}</text>`);
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="0.9" fill="${tpl().site}"/>`);
  return `<svg width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" font-family="${font}" style="display:block">${parts.join('')}</svg>`;
}

function gridRoseSvg(f: ReturnType<typeof sunViewFacts>, size: number, font: string): string {
  const R = size / 2 - 7, cx = size / 2, cy = size / 2;
  const max = Math.max(1, ...f.grid.bins);
  const parts: string[] = [`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#ffffff" stroke="#c9c7c0" stroke-width="0.3"/>`];
  for (const [az, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) { const a = (az * Math.PI) / 180; parts.push(`<text x="${(cx + (R + 4) * Math.sin(a)).toFixed(1)}" y="${(cy - (R + 4) * Math.cos(a) + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" font-weight="600" fill="#454f4b">${txt}</text>`); }
  f.grid.bins.forEach((v, i) => {
    if (!v) return;
    const r = (R * v) / max;
    for (const base of [i * 5, i * 5 + 180]) {
      const a0 = ((base - 0.2) * Math.PI) / 180, a1 = ((base + 5.2) * Math.PI) / 180;
      parts.push(`<path d="M${cx},${cy} L${(cx + r * Math.sin(a0)).toFixed(2)},${(cy - r * Math.cos(a0)).toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${(cx + r * Math.sin(a1)).toFixed(2)},${(cy - r * Math.cos(a1)).toFixed(2)} Z" fill="${CHART.accent}" fill-opacity="0.75"/>`);
    }
  });
  // the site's long axis
  const a = (f.grid.siteAxisDeg * Math.PI) / 180;
  parts.push(`<line x1="${(cx - R * Math.sin(a)).toFixed(1)}" y1="${(cy + R * Math.cos(a)).toFixed(1)}" x2="${(cx + R * Math.sin(a)).toFixed(1)}" y2="${(cy - R * Math.cos(a)).toFixed(1)}" stroke="${tpl().site}" stroke-width="0.6" stroke-dasharray="1.6,1"/>`);
  parts.push(`<text x="${cx}" y="${(size - 1).toFixed(1)}" text-anchor="middle" font-size="1.7" fill="#6a7572">street bearings by length · site axis ${f.grid.siteAxisDeg}°</text>`);
  return `<svg width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" font-family="${font}" style="display:block">${parts.join('')}</svg>`;
}

/** The wind's speed classes, light to dark in the deck's accent blue: one hue, so more wind reads darker. */
const WIND_RAMP = ['#c3cde8', '#8fa3d4', '#3d5a94', '#243a66'];

/** A wind rose: sixteen petals of the hours the wind blows from each point, stacked by speed class, on rings every `step` % up to `top` %. */
function windRoseSvg(rose: WindRose, size: number, font: string, top: number, step: number): string {
  const R = size / 2 - 4.5, cx = size / 2, cy = size / 2;
  const r = (pct: number) => (R * pct) / top;
  const P = (rr: number, a: number) => `${(cx + rr * Math.sin(a)).toFixed(2)},${(cy - rr * Math.cos(a)).toFixed(2)}`;
  const parts: string[] = [`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#ffffff" stroke="#cfc5b2" stroke-width="0.3"/>`];
  // the rings as whole multiples of the step, so 15 prints as 15 and not 15.000000000000002
  const rings = Array.from({ length: Math.round(top / step) }, (_, i) => Math.round((i + 1) * step * 100) / 100);
  for (const q of rings.slice(0, -1)) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r(q).toFixed(2)}" fill="none" stroke="#d6d4cc" stroke-width="0.2" stroke-dasharray="0.8,0.6"/>`);
  for (const [az, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const) { const a = (az * Math.PI) / 180; parts.push(`<text x="${(cx + (R + 2.6) * Math.sin(a)).toFixed(1)}" y="${(cy - (R + 2.6) * Math.cos(a) + 0.7).toFixed(1)}" text-anchor="middle" font-size="2" font-weight="600" fill="#454f4b">${txt}</text>`); }
  const half = (8.4 * Math.PI) / 180;
  rose.pct.forEach((row, sector) => {
    const a = (sector * 22.5 * Math.PI) / 180;
    let acc = 0;
    row.forEach((v, c) => {
      if (v <= 0) return;
      const r0 = r(acc), r1 = r(acc + v);
      acc += v;
      const d = r0 < 0.05
        ? `M${cx},${cy} L${P(r1, a - half)} A${r1.toFixed(2)},${r1.toFixed(2)} 0 0 1 ${P(r1, a + half)} Z`
        : `M${P(r0, a - half)} L${P(r1, a - half)} A${r1.toFixed(2)},${r1.toFixed(2)} 0 0 1 ${P(r1, a + half)} L${P(r0, a + half)} A${r0.toFixed(2)},${r0.toFixed(2)} 0 0 0 ${P(r0, a - half)} Z`;
      parts.push(`<path d="${d}" fill="${WIND_RAMP[c]}" stroke="#ffffff" stroke-width="0.12"/>`);
    });
  });
  // the rings' values down the south-east diagonal, haloed where a petal passes
  for (const q of rings) { const a = (135 * Math.PI) / 180; parts.push(`<text x="${(cx + r(q) * Math.sin(a) + 0.5).toFixed(1)}" y="${(cy - r(q) * Math.cos(a) + 0.6).toFixed(1)}" font-size="1.5" fill="#737c77" stroke="#ffffff" stroke-width="0.5" paint-order="stroke">${q} %</text>`); }
  return `<svg width="${size}mm" height="${size}mm" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" font-family="${font}" style="display:block">${parts.join('')}</svg>`;
}

export function sunViewSlide(b: SlidesBundle): Slide {
  const f = sunViewFacts(b);
  const t = tpl();
  const centreLL = mercatorToLonLat(b.panel.center);
  const sentences = sunViewSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: where the living rooms and the private open space should face, which frontage gets the morning and which the afternoon, what the neighbours\' winter shadows leave for the ground floor and the courtyard, and which views are worth a window, a terrace or a roof.') +
    `<div class="fine">Sun positions computed for the site (NOAA solar geometry) for 21 June in AEST and 21 December and the equinox in AEDT; shadows from ${b.buildings.source === 'overture' ? 'Overture Maps' : 'OpenStreetMap'} footprints and their heights (measured, from storeys, or the storeys of a determined DA on the lot, as slide 08 marks them), the site's own buildings left out; street bearings from NSW Spatial Services roads in the window; sight lines from the eye just under the height limit over the NSW 5 m elevation surface to the skylines, the named water and coast and the park next door. Buildings are not tested against the sight lines.${f.wind?.ok ? ` Wind: hourly at 10 m in the MERRA-2 reanalysis cell over the site, ${f.wind.years[0]}–${f.wind.years[1]}, from the NASA Langley Research Center POWER Project, funded through the NASA Earth Science/Applied Science Program.` : ''} Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const worstShadow = [...f.shadows].sort((x, y) => y.shadedPct - x.shadedPct)[0];
  const clearViews = f.views.filter((v) => v.clear === true);
  const sub = [b.siteAddress, `grid ${f.grid.primaryDeg}°`, f.grid.frontages[0] ? `frontage faces ${f.grid.frontages[0].facingWord}` : '', clearViews.length ? `${clearViews.length} clear view${clearViews.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');

  // The shadow plan: the block around the site at a scale that holds the winter shadows.
  const sp: Panel = { center: b.site.sitePanel.center, scale: Math.max(1000, b.site.sitePanel.scale), wMm: PANEL_W, hMm: DA_PANEL_H };
  const proj = panelProjector(sp);
  const projM = (m: XY) => { const ll = mercatorToLonLat(m); return proj(ll.lon, ll.lat); };
  const parts: string[] = [baseLayers(b.base, proj, sp)];
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const insideSite = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  // the shadows on the ground, then the footprints over them so the buildings stay legible, then the site
  const neighbours = b.buildings.buildings.filter((bd) => !insideSite(bd.centroid[0], bd.centroid[1]));
  for (const sh of f.shadowHulls) {
    const style = SHADOW_HOURS.find((x) => x.hour === sh.hour)!;
    if (!sh.hulls.length) continue;
    const d = sh.hulls.map((h) => `M${h.map((q, i) => { const [x, y] = projM(q); return `${i ? 'L' : ''}${x.toFixed(1)},${y.toFixed(1)}`; }).join('')}Z`).join('');
    parts.push(`<path d="${d}" fill="${style.fill}" fill-opacity="${style.opacity}" stroke="${style.fill}" stroke-width="0.15" stroke-opacity="0.4" fill-rule="nonzero"/>`);
  }
  if (neighbours.length) parts.push(`<path d="${neighbours.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="#e6e3dc" stroke="#8a877f" stroke-width="0.2" fill-rule="evenodd"/>`);
  parts.push(overLayers(b.base, proj, sp, 'both'));
  // heights on the tallest neighbours near the site
  const spacer = new LabelSpacer(sp.wMm, sp.hMm, 24);
  for (const bd of [...neighbours].filter((x) => x.estimatedHeightM).sort((x, y) => (y.estimatedHeightM ?? 0) - (x.estimatedHeightM ?? 0)).slice(0, 14)) {
    const [x, y] = proj(bd.centroid[0], bd.centroid[1]);
    if (x < 3 || y < 3 || x > sp.wMm - 3 || y > sp.hMm - 3) continue;
    const text = bd.floors ? `${bd.floors} st` : `${fmtNum(bd.estimatedHeightM!)} m`;
    if (spacer.take(x, y, labelW(text, 1.8), 2.3)) parts.push(label(x, y, text, 1.8, '#454f4b'));
  }
  // the sun's direction at each hour, drawn at the panel edge
  for (const s of f.shadows) {
    const a = (s.azimuthDeg * Math.PI) / 180;
    const cx = sp.wMm / 2, cy = sp.hMm / 2;
    const rEdge = Math.min(cx, cy) - 6;
    const x = cx + rEdge * Math.sin(a), y = cy - rEdge * Math.cos(a);
    const x2 = cx + (rEdge - 6) * Math.sin(a), y2 = cy - (rEdge - 6) * Math.cos(a);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${SUN_COLOUR}" stroke-width="0.7" stroke-linecap="round"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${SUN_COLOUR}"/>`);
    parts.push(label(x, y + 4.2, `${s.label} · ${s.altitudeDeg.toFixed(0)}°`, 1.9, '#9a7420'));
  }
  parts.push(panelFurniture(sp, 'right'));
  if (!f.castersInReach) parts.push(emptyNote(['No building within shadow reach of the site has a known height, so no shadow is drawn.']));
  else if (f.near.total && !f.near.withHeight) parts.push(emptyNote([`None of the ${f.near.total} buildings within 60 m has a known height; the shadows drawn are the further buildings' only.`]));
  const shadowSvg = `<svg width="${sp.wMm}mm" height="${sp.hMm}mm" viewBox="0 0 ${sp.wMm} ${sp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-shadow"><rect x="0" y="0" width="${sp.wMm}" height="${sp.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-shadow)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${sp.wMm - 0.2}" height="${sp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, the sun path and the street rose, the legend.
  const rightX = AUX_X, rightW = AUX_W;
  const tiles = [
    { v: `${f.grid.primaryDeg}°${f.grid.secondaryDeg !== null ? ` · ${f.grid.secondaryDeg}°` : ''}`, l: `street grid bearings from north · site axis ${f.grid.siteAxisDeg}°, ${f.grid.offGridDeg <= 5 ? 'on the grid' : `${f.grid.offGridDeg}° off`}` },
    { v: f.grid.frontages[0] ? f.grid.frontages[0].facingWord : '—', l: f.grid.frontages[0] ? `${f.grid.frontages[0].name} frontage faces${f.grid.frontages.length > 1 ? ` · ${f.grid.frontages.slice(1).map((fr) => `${fr.name} ${fr.facingWord}`).join(', ')}` : ''}` : 'no frontage to a named road' },
    { v: `${f.sun.winter.noonAltitudeDeg.toFixed(0)}°`, l: `winter noon sun (21 June, ${fmtClock(f.sun.winter.noon)} AEST) · ${f.sun.summer.noonAltitudeDeg.toFixed(0)}° on 21 December` },
    { v: f.castersInReach ? fmtPct(worstShadow.shadedPct) : '—', l: f.castersInReach ? `of the site in neighbours' shadow at ${worstShadow.label} on 21 June · ${f.shadows.filter((s) => s !== worstShadow).map((s) => `${s.label} ${fmtPct(s.shadedPct)}`).join(' · ')}${f.near.total && f.near.withHeight < f.near.total ? ` · heights known for ${f.near.withHeight} of ${f.near.total} buildings within 60 m` : ''}` : 'no known height within shadow reach of the site' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const diagW = Math.min(62, (rightW - GUTTER) / 2);
  const sw = (inner: string) => `<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${inner}</svg>`;
  const legendRows: [string, string][] = [
    [sw(`<rect x="0" y="0.4" width="5" height="2.8" fill="#dcd9d2" stroke="#8a877f" stroke-width="0.2"/>`), `Neighbouring footprints (${b.buildings.source === 'overture' ? 'Overture' : 'OpenStreetMap'}), the tallest labelled in storeys`],
    [sw(SHADOW_HOURS.map((s, i) => `<rect x="${i * 1.7}" y="0.4" width="1.6" height="2.8" fill="${s.fill}" fill-opacity="${s.opacity}"/>`).join('')), 'Their shadows on 21 June at 9 am, noon and 3 pm (darker where they overlap)'],
    [sw(`<circle cx="2.5" cy="1.8" r="1.4" fill="${SUN_COLOUR}"/>`), 'The sun\'s direction and altitude at those hours'],
    [sw(`<path d="M0.5,3 Q2.5,-0.5 4.5,3" fill="none" stroke="${SUN_COLOUR}" stroke-width="0.7"/>`), 'Sun path: 21 December (AEDT), the equinox dashed, 21 June (AEST); hours marked; the site at the centre'],
    [sw(`<path d="M2.5,1.8 L4.5,0.4 A2.4,2.4 0 0 1 4.8,1.6 Z" fill="${CHART.accent}" fill-opacity="0.75"/>`), 'Street bearings by length, folded to both directions; the site\'s long axis dashed'],
  ];
  const legend = legendRows.map(([s, txt]) => `<div class="lg">${s}<span>${esc(txt)}</span></div>`).join('');

  // Bottom: the views.
  const vp: Panel = { center: b.panel.center, scale: b.wide.panel.scale, wMm: PANEL_W, hMm: b.wide.panel.hMm };
  const vproj = panelProjector(vp);
  const vparts: string[] = [`<rect x="0" y="0" width="${vp.wMm}" height="${vp.hMm}" fill="#ffffff"/>`];
  if (b.wide.base.water.features.length) vparts.push(`<path d="${fcPath(b.wide.base.water, vproj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  vparts.push(overLayers(b.wide.base, vproj, vp, 'none'));
  const [vx, vy] = vproj(centreLL.lon, centreLL.lat);
  const reach = Math.hypot(vp.wMm, vp.hMm);
  const vspacer = new LabelSpacer(vp.wMm, vp.hMm, 30);
  for (const v of [...f.views].sort((x, y) => Number(Boolean(y.clear)) - Number(Boolean(x.clear)) || x.distanceM - y.distanceM)) {
    const a = (v.bearingDeg * Math.PI) / 180;
    const distMm = Math.min(reach, (v.distanceM * 1000) / vp.scale);
    const ex = vx + distMm * Math.sin(a), ey = vy - distMm * Math.cos(a);
    const colour = VIEW_COLOUR[v.kind];
    if (v.clear) {
      const half = (8 * Math.PI) / 180;
      const p1 = [vx + distMm * Math.sin(a - half), vy - distMm * Math.cos(a - half)], p2 = [vx + distMm * Math.sin(a + half), vy - distMm * Math.cos(a + half)];
      vparts.push(`<path d="M${vx.toFixed(1)},${vy.toFixed(1)} L${p1[0].toFixed(1)},${p1[1].toFixed(1)} L${p2[0].toFixed(1)},${p2[1].toFixed(1)} Z" fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-width="0.3"/>`);
    } else {
      const blockMm = v.blockedAtM ? Math.min(distMm, (v.blockedAtM * 1000) / vp.scale) : distMm;
      vparts.push(`<line x1="${vx.toFixed(1)}" y1="${vy.toFixed(1)}" x2="${(vx + blockMm * Math.sin(a)).toFixed(1)}" y2="${(vy - blockMm * Math.cos(a)).toFixed(1)}" stroke="${colour}" stroke-width="0.4" stroke-dasharray="1.2,0.9"/>`);
      if (v.blockedAtM && blockMm < distMm) vparts.push(`<line x1="${(vx + blockMm * Math.sin(a) - 1.6 * Math.cos(a)).toFixed(1)}" y1="${(vy - blockMm * Math.cos(a) - 1.6 * Math.sin(a)).toFixed(1)}" x2="${(vx + blockMm * Math.sin(a) + 1.6 * Math.cos(a)).toFixed(1)}" y2="${(vy - blockMm * Math.cos(a) + 1.6 * Math.sin(a)).toFixed(1)}" stroke="${colour}" stroke-width="0.6"/>`);
    }
    // the label where the line meets the panel edge, or at the target when that is inside
    const inset = 6;
    const dirX = Math.sin(a), dirY = -Math.cos(a);
    const tX = dirX > 1e-9 ? (vp.wMm - inset - vx) / dirX : dirX < -1e-9 ? (inset - vx) / dirX : Infinity;
    const tY = dirY > 1e-9 ? (vp.hMm - inset - vy) / dirY : dirY < -1e-9 ? (inset - vy) / dirY : Infinity;
    const blockMmLabel = v.clear === false && v.blockedAtM ? Math.min(distMm, (v.blockedAtM * 1000) / vp.scale) + 3 : Infinity;
    const tEdge = Math.min(distMm, tX, tY, blockMmLabel);
    const lx = vx + Math.max(8, tEdge - 2) * dirX, ly = vy + Math.max(8, tEdge - 2) * dirY;
    const text = `${v.label} ${v.distanceM >= 1000 ? `${(v.distanceM / 1000).toFixed(1)} km` : `${fmtNum(v.distanceM)} m`}${v.clear ? '' : v.clear === false ? ' · blocked' : ' · unchecked'}`;
    if (vspacer.take(lx, ly, labelW(text, 1.9), 2.5)) vparts.push(label(lx, ly, text, 1.9, colour));
  }
  vparts.push(`<circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="2" fill="#ffffff" stroke="${t.site}" stroke-width="0.6"/><circle cx="${vx.toFixed(1)}" cy="${vy.toFixed(1)}" r="0.8" fill="${t.site}"/>`, panelFurniture(vp, 'right'));
  if (!f.views.length) vparts.push(emptyNote(['No skyline, water or park within view range, or the check did not run.']));
  const viewsSvg = `<svg width="${vp.wMm}mm" height="${vp.hMm}mm" viewBox="0 0 ${vp.wMm} ${vp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-views"><rect x="0" y="0" width="${vp.wMm}" height="${vp.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-views)" font-family="${t.font}">${vparts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${vp.wMm - 0.2}" height="${vp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;
  // The wind, bottom-aligned with the views map; the views table keeps the rows that fit above it.
  const WIND_ROSE_MM = 42;
  const yViewsTop = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const windOn = Boolean(f.wind?.ok && f.wind.summer.hours && f.wind.winter.hours);
  const yViewsTable = FIELD_Y + PANEL_TITLE_H + 33 + PANEL_TITLE_H + Math.min(62, (AUX_W - GUTTER) / 2) + 26;
  const windTop = yViewsTable + 42;
  const maxViewRows = windOn ? Math.max(3, Math.floor((windTop - 3 - (yViewsTable + PANEL_TITLE_H) - 5.5) / 4.4)) : Infinity;
  const shownViews = f.views.slice(0, maxViewRows);
  const viewRows = shownViews.map((v) => `<tr${v.clear ? ' class="hit"' : ''}><td>${esc(v.label)}</td><td>${esc(VIEW_WORD[v.kind])}</td><td class="r">${v.bearingDeg}° ${esc(compass16(v.bearingDeg))}</td><td class="r">${v.distanceM >= 1000 ? `${(v.distanceM / 1000).toFixed(1)} km` : `${fmtNum(v.distanceM)} m`}</td><td>${v.clear === true ? 'clear over the ground' : v.clear === false ? `ground rises${v.blockedAtM ? ` at ${v.blockedAtM >= 1000 ? `${(v.blockedAtM / 1000).toFixed(1)} km` : `${fmtNum(v.blockedAtM)} m`}` : ''}` : v.kind === 'park' ? 'adjoins the site' : 'not checked'}</td></tr>`).join('');
  const moreViews = f.views.length - shownViews.length;
  const viewTable = f.views.length
    ? `<table class="da cons"><thead><tr><th>View to</th><th style="width:16mm">Kind</th><th class="r" style="width:20mm">Bearing</th><th class="r" style="width:16mm">Distance</th><th style="width:40mm">Sight line</th></tr></thead><tbody>${viewRows}${moreViews ? `<tr><td colspan="5">${moreViews} more in the deck's JSON (overall.json)</td></tr>` : ''}</tbody></table>`
    : emptyBox(rightW, 24, 'no candidate view within range');
  let windHtml = '';
  if (windOn && f.wind) {
    const w = f.wind;
    const { step, top } = niceScale(Math.max(...sectorTotals(w.summer), ...sectorTotals(w.winter)), 3);
    const cap = (label: string, rose: WindRose) => `${label} · mean ${Math.round(rose.meanKmh)} km/h · calm ${rose.calmPct < 1 ? rose.calmPct.toFixed(1) : Math.round(rose.calmPct)} %`;
    const legendX = rightX;
    const classes = WIND_CLASSES_KMH.map((lo, i) => (i + 1 < WIND_CLASSES_KMH.length ? `${lo}–${WIND_CLASSES_KMH[i + 1]} km/h` : `${lo} km/h and over`));
    const wlegend = classes.map((txt, i) => `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.4" width="5" height="2.8" fill="${WIND_RAMP[i]}"/></svg><span>${esc(txt)}</span></div>`).join('') +
      `<div class="lg" style="margin-top:1.2mm"><span>Petals: the share of the hours the wind blows from each point; rings every ${Math.round(step * 100) / 100} %. Calm is under ${WIND_CLASSES_KMH[0]} km/h.</span></div>`;
    windHtml = `
    <div class="abs ptitle" style="left:${rightX}mm;top:${windTop}mm;width:${rightW}mm">Wind<span class="pnote">hourly at 10 m, ${w.years[0]}–${w.years[1]} · NASA POWER, the MERRA-2 reanalysis cell over the site · the region's wind, not the site's</span></div>
    <div class="abs" style="left:${rightX}mm;top:${windTop + PANEL_TITLE_H}mm">${windRoseSvg(w.summer, WIND_ROSE_MM, t.font, top, step)}<div class="wcap">${esc(cap('Summer, Dec–Feb', w.summer))}</div></div>
    <div class="abs" style="left:${rightX + WIND_ROSE_MM + GUTTER}mm;top:${windTop + PANEL_TITLE_H}mm">${windRoseSvg(w.winter, WIND_ROSE_MM, t.font, top, step)}<div class="wcap">${esc(cap('Winter, Jun–Aug', w.winter))}</div></div>
    <div class="abs legend" style="left:${legendX}mm;top:${windTop + PANEL_TITLE_H + WIND_ROSE_MM + 10.5}mm;width:${rightW}mm">${wlegend}</div>`;
  }

  const yViews = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Winter shadows<span class="pnote">1:${fmtNum(sp.scale)} · the neighbours' shadows on 21 June at 9 am, noon and 3 pm (AEST)</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${shadowSvg}</div>
    <div class="abs tiles two" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 33}mm;width:${diagW}mm">Sun path<span class="pnote">altitude and azimuth at the site</span></div>
    <div class="abs" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 33 + PANEL_TITLE_H}mm">${sunPathSvg(f, centreLL.lat, centreLL.lon, diagW, t.font)}</div>
    <div class="abs ptitle" style="left:${rightX + diagW + GUTTER}mm;top:${FIELD_Y + PANEL_TITLE_H + 33}mm;width:${diagW}mm">Street grid<span class="pnote">bearings of the roads in the window</span></div>
    <div class="abs" style="left:${rightX + diagW + GUTTER}mm;top:${FIELD_Y + PANEL_TITLE_H + 33 + PANEL_TITLE_H}mm">${gridRoseSvg(f, diagW, t.font)}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 33 + PANEL_TITLE_H + diagW + 2}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yViews}mm;width:${PANEL_W}mm">Views<span class="pnote">1:${fmtNum(vp.scale)} · sight lines from the eye at the height limit; cones where the ground leaves them clear</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yViews + PANEL_TITLE_H}mm">${viewsSvg}</div>
    <div class="abs ptitle sm" style="left:${rightX}mm;top:${yViewsTable}mm;width:${rightW}mm">Candidate views<span class="pnote">the ground tested, not the buildings</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yViewsTable + PANEL_TITLE_H}mm;width:${rightW}mm">${viewTable}</div>${windHtml}`;
  return { id: '13_grid_sun_views', title: 'Grid, sun and views', subtitle: sub, textHtml, figureHtml };
}

/** The template's round diagrams share a frame: a hairline circle, N E S W in 6 pt outside it. */
const roseFrame = (cx: number, cy: number, R: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${R}" fill="#ffffff" stroke="#878787" stroke-width="0.18"/>` +
  ([[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const).map(([az, txt]) => { const a = (az * Math.PI) / 180; return z6(cx + (R + 2.4) * Math.sin(a), cy - (R + 2.4) * Math.cos(a) - 1.1, txt, 'middle'); }).join('');

/** The sun path after the template: the three arcs in one ink — June solid and heavy, December solid, the equinox dashed — the hours ticked. */
function zSunPath(f: ReturnType<typeof sunViewFacts>, lat: number, lon: number, x0: number, size: number, ink: string): string {
  const R = size / 2 - 4, cx = x0 + size / 2, cy = size / 2 + 6.3;
  const pt = (alt: number, az: number): [number, number] => { const r = (R * (90 - alt)) / 90; const a = (az * Math.PI) / 180; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; };
  const g: string[] = [roseFrame(cx, cy, R)];
  for (const alt of [30, 60]) g.push(`<circle cx="${cx}" cy="${cy}" r="${((R * (90 - alt)) / 90).toFixed(2)}" fill="none" stroke="#878787" stroke-width="0.18" stroke-dasharray="0 0.36" stroke-linecap="round"/>`);
  const arcs: [string, number, number, number, number, string][] = [['21 Dec', 12, 21, AEDT, 0.35, ''], ['equinox', 3, 21, AEDT, 0.25, '0.9 0.6'], ['21 Jun', 6, 21, AEST, 0.6, '']];
  for (const [label, m, d, off, w, dash] of arcs) {
    const path = sunPath(lat, lon, SOLAR_YEAR, m, d, off, 5).filter((q) => q.altitudeDeg >= 0);
    if (!path.length) continue;
    g.push(`<path d="${path.map((q, i) => { const [x, y] = pt(q.altitudeDeg, q.azimuthDeg); return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`; }).join('')}" fill="none" stroke="${label === '21 Jun' ? '#000000' : ink}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    for (const q of path.filter((z) => z.clockMin % 60 === 0)) { const [x, y] = pt(q.altitudeDeg, q.azimuthDeg); g.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="0.35" fill="${label === '21 Jun' ? '#000000' : ink}"/>`); }
    const top = path.reduce((a, q) => (q.altitudeDeg > a.altitudeDeg ? q : a));
    const [lx, ly] = pt(top.altitudeDeg, top.azimuthDeg);
    g.push(z6(lx, ly - 3.2, `${label} · ${top.altitudeDeg.toFixed(0)}°`, 'middle'));
  }
  g.push(`<circle cx="${cx}" cy="${cy}" r="0.8" fill="${tpl().site}"/>`);
  void f;
  return g.join('');
}

/** The street grid after the template: the roads' bearings by length as petals in the family's tint, the site's long axis dashed red. */
function zGridRose(f: ReturnType<typeof sunViewFacts>, x0: number, size: number, ink: string): string {
  const R = size / 2 - 4, cx = x0 + size / 2, cy = size / 2 + 6.3;
  const max = Math.max(1, ...f.grid.bins);
  const g: string[] = [roseFrame(cx, cy, R)];
  const petals: string[] = [];
  f.grid.bins.forEach((v, i) => {
    if (!v) return;
    const r = (R * v) / max;
    for (const base of [i * 5, i * 5 + 180]) { const a0 = ((base - 0.2) * Math.PI) / 180, a1 = ((base + 5.2) * Math.PI) / 180; petals.push(`M${cx},${cy}L${(cx + r * Math.sin(a0)).toFixed(2)},${(cy - r * Math.cos(a0)).toFixed(2)}A${r.toFixed(2)},${r.toFixed(2)} 0 0 1 ${(cx + r * Math.sin(a1)).toFixed(2)},${(cy - r * Math.cos(a1)).toFixed(2)}Z`); }
  });
  g.push(`<path d="${petals.join('')}" fill="${ink}"/>`);
  const a = (f.grid.siteAxisDeg * Math.PI) / 180;
  g.push(`<line x1="${(cx - R * Math.sin(a)).toFixed(2)}" y1="${(cy + R * Math.cos(a)).toFixed(2)}" x2="${(cx + R * Math.sin(a)).toFixed(2)}" y2="${(cy - R * Math.cos(a)).toFixed(2)}" stroke="${tpl().site}" stroke-width="0.4" stroke-dasharray="1.2 0.8"/>`);
  return g.join('');
}

/** A wind rose after the template: sixteen petals stacked by speed, each class its own pattern of the one ink. */
function zWindRose(rose: WindRose, x0: number, size: number, top: number, step: number, fills: Fill[]): string {
  const R = size / 2 - 4, cx = x0 + size / 2, cy = size / 2 + 6.3;
  const r = (pct: number) => (R * pct) / top;
  const P = (rr: number, a: number) => `${(cx + rr * Math.sin(a)).toFixed(2)},${(cy - rr * Math.cos(a)).toFixed(2)}`;
  const g: string[] = [roseFrame(cx, cy, R)];
  const rings = Array.from({ length: Math.round(top / step) }, (_, i) => Math.round((i + 1) * step * 100) / 100);
  for (const q of rings.slice(0, -1)) g.push(`<circle cx="${cx}" cy="${cy}" r="${r(q).toFixed(2)}" fill="none" stroke="#878787" stroke-width="0.18" stroke-dasharray="0 0.36" stroke-linecap="round"/>`);
  const half = (8.4 * Math.PI) / 180;
  const byClass: string[][] = fills.map(() => []);
  rose.pct.forEach((row, sector) => {
    const a = (sector * 22.5 * Math.PI) / 180;
    let acc = 0;
    row.forEach((v, c) => {
      if (v <= 0) return;
      const r0 = r(acc), r1 = r(acc + v);
      acc += v;
      byClass[Math.min(c, fills.length - 1)].push(r0 < 0.05 ? `M${cx},${cy}L${P(r1, a - half)}A${r1.toFixed(2)},${r1.toFixed(2)} 0 0 1 ${P(r1, a + half)}Z` : `M${P(r0, a - half)}L${P(r1, a - half)}A${r1.toFixed(2)},${r1.toFixed(2)} 0 0 1 ${P(r1, a + half)}L${P(r0, a + half)}A${r0.toFixed(2)},${r0.toFixed(2)} 0 0 0 ${P(r0, a - half)}Z`);
    });
  });
  byClass.forEach((ds, c) => { if (ds.length) g.push(fillShape(ds.join(''), { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R }, fills[c])); });
  const a = (135 * Math.PI) / 180;
  for (const q of rings) g.push(z6(cx + r(q) * Math.sin(a) + 0.6, cy - r(q) * Math.cos(a) - 0.6, `${q} %`).replace('<text ', '<text stroke="#ffffff" stroke-width="0.6" paint-order="stroke" '));
  return g.join('');
}

/** Grid, sun and views on the template: the winter shadows at 1:1000 to the sheet's edges, the sun, the grid and the wind as round diagrams. */
export function sunAtlas(b: SlidesBundle): Slide {
  const f = sunViewFacts(b);
  const t = tpl();
  const S = INK.sage;
  const centreLL = mercatorToLonLat(b.panel.center);
  const p: Panel = { center: b.site.sitePanel.center, scale: 1000, wMm: 210, hMm: 297 };
  const proj = panelProjector(p);
  const projM = (m: XY) => { const ll = mercatorToLonLat(m); return proj(ll.lon, ll.lat); };
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const SHADE: Record<number, Fill> = {
    9: { kind: 'vlines', ink: S.deep, step: 0.7, w: 0.16, outline: S.deep, outlineW: 0.12, rule: 'nonzero' },
    12: { kind: 'dots', ink: '#000000', step: 0.8, w: 0.12, outline: S.deep, outlineW: 0.12, rule: 'nonzero' },
    15: { kind: 'hlines', ink: S.deep, step: 0.7, w: 0.16, outline: S.deep, outlineW: 0.12, rule: 'nonzero' },
  };
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  for (const sh of f.shadowHulls) {
    if (!sh.hulls.length || !SHADE[sh.hour]) continue;
    const d = sh.hulls.map((h) => `M${h.map((q, i) => { const [x, y] = projM(q); return `${i ? 'L' : ''}${x.toFixed(2)},${y.toFixed(2)}`; }).join('')}Z`).join('');
    parts.push(fillShape(d, box, SHADE[sh.hour]));
  }
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const neighbours = b.buildings.buildings.filter((bd) => !siteRings.some((r) => pointInRing(bd.centroid[0], bd.centroid[1], r)));
  if (neighbours.length) parts.push(`<path d="${neighbours.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="#ffffff" stroke="#6f6f6f" stroke-width="0.18" fill-rule="evenodd"/>`);
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  spacer.take(40, 10, 72, 10);
  keepSiteClear(b, proj, spacer);
  const labels: string[] = [];
  for (const bd of [...neighbours].filter((x) => x.estimatedHeightM).sort((x, y) => (y.estimatedHeightM ?? 0) - (x.estimatedHeightM ?? 0)).slice(0, 24)) {
    const [x, y] = proj(bd.centroid[0], bd.centroid[1]);
    if (x < 4 || y < 14 || x > p.wMm - 4 || y > p.hMm - 14) continue;
    const text = String(bd.floors ?? storeysOf(bd.estimatedHeightM!));
    if (spacer.take(x, y, text.length * 1.6 + 1, 2.6)) labels.push(m6(x, y, text));
  }
  parts.push(...labels, siteMark(b.base, proj, 'both'), panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('sun13', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    ...SHADOW_HOURS.map((h) => ({ swatch: swatchOf({ ...SHADE[h.hour], bg: '#ffffff' }), label: `Neighbours' shadows, 21 June, ${h.label}` })),
    { swatch: `<rect x="0.4" y="0.6" width="4.2" height="2.4" fill="#ffffff" stroke="#6f6f6f" stroke-width="0.2"/>`, label: 'Neighbouring footprints; numbers are storeys' },
    SITE_KEY(t),
  ];
  const worst = [...f.shadows].sort((x, y) => y.shadedPct - x.shadedPct)[0];
  const clear = f.views.filter((v) => v.clear === true);
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmtNum(m)} m`);
  const figs = zFigures([
    ['street grid · site axis', `${f.grid.primaryDeg}°${f.grid.secondaryDeg !== null ? ` and ${f.grid.secondaryDeg}°` : ''} · ${f.grid.siteAxisDeg}°${f.grid.offGridDeg <= 5 ? ', on the grid' : ''}`],
    ['the frontages face', f.grid.frontages.length ? f.grid.frontages.map((fr) => `${fr.name} ${fr.facingWord}`).join(' · ') : '—'],
    ['winter noon sun, 21 June', `${f.sun.winter.noonAltitudeDeg.toFixed(0)}° · ${f.sun.summer.noonAltitudeDeg.toFixed(0)}° on 21 December`],
  ], [
    ['the site in shadow, 21 June', f.castersInReach && worst ? `${fmtPct(worst.shadedPct)} at ${worst.label} at most` : 'no known height in reach'],
    ['clear views from the height limit', clear.length ? shorten(clear.map((v) => `${v.label} ${km(v.distanceM)}`).join(' · '), 46) : 'none clear over the ground'],
    ['wind, the region', f.wind?.ok ? `${Math.round(f.wind.summer.meanKmh)} km/h summer · ${Math.round(f.wind.winter.meanKmh)} km/h winter` : 'not read'],
  ], 9.6);
  const D = 46;
  const blocks = [zBlock('Grid and sun', figs, 'Shadow, views, wind')];
  blocks.push(zBlock('Sun path at the site', zSvg(D + 6.3 + 2, zSunPath(f, centreLL.lat, centreLL.lon, 0, D, S.deep) + zGridRose(f, Z_TRACK, D, S.solid)), 'Street bearings by length · site axis'));
  if (f.wind?.ok && f.wind.summer.hours && f.wind.winter.hours) {
    const w = f.wind;
    const { step, top } = niceScale(Math.max(...sectorTotals(w.summer), ...sectorTotals(w.winter)), 3);
    const fills: Fill[] = [
      { bg: S.light, outline: S.deep, outlineW: 0.1 },
      { bg: '#ffffff', kind: 'vlines', ink: S.deep, step: 0.7, w: 0.14, outline: S.deep, outlineW: 0.1 },
      { bg: '#ffffff', kind: 'vlines', ink: S.deep, step: 0.35, w: 0.14, outline: S.deep, outlineW: 0.1 },
      { bg: '#000000' },
    ];
    const caption = (rose: WindRose, x: number) => z6(x, D + 6.3 + 1, `mean ${Math.round(rose.meanKmh)} km/h · calm ${rose.calmPct < 1 ? rose.calmPct.toFixed(1) : Math.round(rose.calmPct)} %`);
    const classes = WIND_CLASSES_KMH.map((lo, i) => (i + 1 < WIND_CLASSES_KMH.length ? `${lo}–${WIND_CLASSES_KMH[i + 1]}` : `${lo}+ km/h`));
    const key = classes.map((c, i) => `<g transform="translate(${(Z_TRACK + i * 15).toFixed(2)},${(D + 6.3 + 4.6).toFixed(2)})">${fillShape('M0,0.4H5V3.2H0Z', { x0: 0, y0: 0.4, x1: 5, y1: 3.2 }, fills[i], 1.54)}</g>${z6(Z_TRACK + i * 15 + 5.8, D + 6.3 + 4.85, c)}`).join('');
    blocks.push(zBlock(`Wind, summer · ${w.years[0]}–${w.years[1]}`, zSvg(D + 6.3 + 9, zWindRose(w.summer, 0, D, top, step, fills) + zWindRose(w.winter, Z_TRACK, D, top, step, fills) + caption(w.summer, 0) + caption(w.winter, Z_TRACK) + key), 'Wind, winter'));
  }
  const sources = `Sources: sun positions computed for the site (NOAA solar geometry), 21 June in AEST; shadows from ${b.buildings.source === 'overture' ? 'Overture Maps' : 'OpenStreetMap'} footprints and their heights, the site's own left out; street bearings from NSW Spatial Services roads; sight lines from the eye at the height limit over the 5 m elevation model, buildings not tested.${f.wind?.ok ? ` Wind: hourly at 10 m, MERRA-2 via the NASA Langley Research Center POWER Project — the region's wind, not the site's.` : ''} Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, `grid ${f.grid.primaryDeg}°`, f.grid.frontages[0] ? `${f.grid.frontages[0].name} faces ${f.grid.frontages[0].facingName}` : '', clear.length ? `${clear.length} clear view${clear.length === 1 ? '' : 's'}` : '');
  return { id: '13_grid_sun_views', title: 'Grid, sun and views', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Winter shadows, 21 June', p, zFlow(blocks)), bleed: true, sources, accent: S.text, legend,
    narrative: brief([f.grid.frontages.length ? `The site's frontages face ${listWords(f.grid.frontages.map((fr) => `${fr.facingName} to ${fr.name}`))}, on a street grid at ${f.grid.primaryDeg}°.` : '', `On 21 June the sun reaches ${f.sun.winter.noonAltitudeDeg.toFixed(0)}° at noon${f.castersInReach && worst ? `, and the neighbours' shadows cover at most ${fmtPct(worst.shadedPct)} of the site` : ''}.`, clear.length ? `From the height limit the ground leaves clear views to ${listWords(clear.slice(0, 3).map((v) => viewPhrase(v)))}.` : '']) };
}

// ---- the deck -----------------------------------------------------------------

// ---- slide 17: opportunities and constraints ------------------------------

const OC_SCALE = 4000;
const OPP_COLOUR = '#2f7d6d';
const CON_COLOUR = '#ba4530';
const NOISE_COLOUR = '#d9825b';
const SHADOW_FILL = '#4a5a62';
const NORTHISH = /^(N|NNE|NNW|NE|NW)$/;
const POLICY_KIND_WORD: Record<string, string> = { tod: 'TOD area', todAccelerated: 'accelerated TOD precinct', todDeferred: 'deferred TOD area', townCentre: 'town centre', ssdSite: 'State significant development site', precinct: 'planning precinct' };
/** "The Marrickville TOD area", "the Waterloo town centre (Danks Street)": the kind's word only when the name lacks it. */
const policyPhrase = (name: string, kind: string) => { const word = POLICY_KIND_WORD[kind] ?? kind; return /town centre|tod\b|precinct|development site/i.test(name) ? name : `${name} ${word}`; };
const POLICY_NOTE: Record<string, string> = {
  tod: "the Housing SEPP's transport-oriented development provisions apply where the zone is eligible",
  todAccelerated: 'an accelerated TOD precinct, rezoned under the Housing SEPP',
  todDeferred: 'a deferred TOD area',
  townCentre: "the Housing SEPP's low and mid-rise housing provisions apply where the zone is eligible",
  ssdSite: 'a State significant development site',
  precinct: 'a planning precinct with controls of its own',
};
const GROUP_THEME: Record<ConstraintGroup, string> = { hazard: 'Hazard', soil: 'Soils', water: 'Water', coast: 'Coast', ecology: 'Ecology', aviation: 'Aviation', corridor: 'Corridor' };

type OcMark = { lon: number; lat: number; edge?: false } | { bearing: number; edge: true; label?: string };
export interface OcStatement { n: number; theme: string; text: string; mark: OcMark | null }

/** The winter sun's positions through the working day (21 June, AEST, every quarter hour), for the arc on the diagram. */
function winterSunArc(lat: number, lon: number): { clockMin: number; azimuthDeg: number; altitudeDeg: number }[] {
  return sunPath(lat, lon, SOLAR_YEAR, 6, 21, AEST, 15).filter((s) => s.clockMin >= 9 * 60 && s.clockMin <= 15 * 60);
}

/**
 * The statements the deck's data supports, as a starting list for the author:
 * what the site has going for it and what it must answer to, each keyed to
 * a point on one of the two diagrams where it has one.
 */
export function ocFacts(b: SlidesBundle, planning: PlanningFacts) {
  const centre = b.site.sitePanel.center;
  const centreLL = mercatorToLonLat(centre);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const ringsMerc = siteRings.map((r) => r.map(([lon, lat]) => toM(lon, lat)));
  const siteEdges: [XY, XY][] = [];
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const r of ringsMerc) {
    for (let i = 0; i < r.length - 1; i++) siteEdges.push([r[i], r[i + 1]]);
    for (const q of r) { sx0 = Math.min(sx0, q.x); sy0 = Math.min(sy0, q.y); sx1 = Math.max(sx1, q.x); sy1 = Math.max(sy1, q.y); }
  }
  const siteSpanM = Number.isFinite(sx1) ? Math.max(sx1 - sx0, sy1 - sy0) / k : 20;
  const distToSiteM = (lon: number, lat: number) => { const q = toM(lon, lat); let d = Infinity; for (const [a, c] of siteEdges) d = Math.min(d, segDistM(q, a, c)); return d / k; };
  const nearestVertex = (rings: number[][][]): { lon: number; lat: number; d: number } | null => {
    let best: { lon: number; lat: number; d: number } | null = null;
    for (const r of rings) { const step = Math.max(1, Math.floor(r.length / 400)); for (let i = 0; i < r.length; i += step) { const d = distToSiteM(r[i][0], r[i][1]); if (!best || d < best.d) best = { lon: r[i][0], lat: r[i][1], d }; } }
    return best;
  };
  const containsSite = (rings: number[][][]) => rings.some((r) => pointInRing(centreLL.lon, centreLL.lat, r));
  const bearingTo = (lon: number, lat: number) => { const q = toM(lon, lat); return ((Math.atan2(q.x - centre.x, q.y - centre.y) * 180) / Math.PI + 360) % 360; };
  const distC = (lon: number, lat: number) => { const q = toM(lon, lat); return Math.hypot(q.x - centre.x, q.y - centre.y) / k; };
  const scale = b.site.sitePanel.scale >= 2500 ? 2 * OC_SCALE : OC_SCALE;
  const panel: Panel = { center: centre, scale, wMm: HALF_W, hMm: 76 };
  const halfWm = ((panel.wMm / 1000) * scale) / 2, halfHm = ((panel.hMm / 1000) * scale) / 2;
  const reachM = Math.hypot(halfWm, halfHm);
  const inPanel = (lon: number, lat: number) => { const q = toM(lon, lat); return Math.abs(q.x - centre.x) / k <= halfWm - 6 * (scale / 1000) && Math.abs(q.y - centre.y) / k <= halfHm - 6 * (scale / 1000); };
  const markAt = (lon: number, lat: number): OcMark => (inPanel(lon, lat) ? { lon, lat } : { bearing: bearingTo(lon, lat), edge: true });
  const atBearing = (bearing: number, dM: number): OcMark => { const a = (bearing * Math.PI) / 180; const ll = mercatorToLonLat({ x: centre.x + Math.sin(a) * dM * k, y: centre.y + Math.cos(a) * dM * k }); return markAt(ll.lon, ll.lat); };
  const dir = (deg: number) => compassWord(deg);
  const mDist = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${fmtNum(Math.round(d))} m`);
  const mv = movementFacts(b), gr = greenFacts(b), cs = constraintsFacts(b), sv = sunViewFacts(b), bf = builtFormFacts(b, planning), tf = terrainFacts(b), sf = siteFacts(b), dv = developmentFacts(b);
  const opp: Omit<OcStatement, 'n'>[] = [], con: Omit<OcStatement, 'n'>[] = [];
  const topOfSite: OcMark | null = Number.isFinite(sy1) ? (() => { const ll = mercatorToLonLat({ x: (sx0 + sx1) / 2, y: sy1 + 6 * k }); return { lon: ll.lon, lat: ll.lat } as OcMark; })() : null;

  // Transport: the nearest stations, and the bus stops within 400 m.
  const stationPts = [...b.base.stations, ...b.wide.base.stations].map((s) => ({ ...s, d: distC(s.lon, s.lat) })).sort((x, y) => x.d - y.d);
  const stations = mv.stations.filter((s) => s.distanceM <= 1500).slice(0, 2);
  if (stations.length) {
    const pt = stationPts[0];
    const mark = pt ? markAt(pt.lon, pt.lat) : null;
    opp.push({ theme: 'Transport', text: `${listWords(stations.map((s) => `${s.name} ${s.kind === 'light rail' ? 'light rail stop' : `${s.kind} station`} ${mDist(s.distanceM)} to the ${dir(s.bearing)} (about ${s.walkMin} min on foot)`))}.`, mark: mark?.edge ? { ...mark, label: `${stations[0].name} ${fmtNum(stations[0].distanceM)} m` } : mark });
  }
  if (mv.bus.within400) opp.push({ theme: 'Transport', text: `${mv.bus.within400} bus stop${mv.bus.within400 === 1 ? '' : 's'} within 400 m${mv.bus.routes ? ` on ${mv.bus.routes} route${mv.bus.routes === 1 ? '' : 's'}` : ''}${mv.bus.source === 'osm' ? ' (OpenStreetMap)' : ''}.`, mark: null });

  // Policy: the housing-policy maps at or near the site.
  if (planning.policyAtSite.length) {
    const p0 = planning.policyAtSite[0];
    opp.push({ theme: 'Policy', text: `Within the ${listWords(planning.policyAtSite.map((p) => policyPhrase(p.name, p.kind)))}: ${POLICY_NOTE[p0.kind] ?? 'its provisions apply'}.`, mark: null });
  } else {
    let best: { area: PolicyArea; v: { lon: number; lat: number; d: number } } | null = null;
    for (const area of b.policy) { if (!isRealPolicyArea(area.name)) continue; const v = nearestVertex(area.rings); if (v && (!best || v.d < best.v.d)) best = { area, v }; }
    if (best && best.v.d <= 800) opp.push({ theme: 'Policy', text: `The ${policyPhrase(best.area.name, best.area.kind)} begins ${mDist(best.v.d)} to the ${dir(bearingTo(best.v.lon, best.v.lat))}: ${POLICY_NOTE[best.area.kind] ?? 'its provisions apply'} there.`, mark: markAt(best.v.lon, best.v.lat) });
  }

  // Active edges.
  if (mv.activeFrontage.atSite) opp.push({ theme: 'Active edge', text: `The LEP maps an active street frontage on the site${mv.activeFrontage.epi ? ` (${shortEpi(mv.activeFrontage.epi)})` : ''}: ground-floor uses that address the street.`, mark: null });
  else if (mv.activeFrontage.count) {
    const v = nearestVertex(b.movement.activeFrontages.features.flatMap((f) => geomRings(f.geometry)));
    if (v && v.d <= 400) opp.push({ theme: 'Active edge', text: `Active street frontages are mapped ${mDist(v.d)} to the ${dir(bearingTo(v.lon, v.lat))}: the centre's retail edge is within reach.`, mark: markAt(v.lon, v.lat) });
  }

  // Orientation and sun.
  const northFront = sv.grid.frontages.filter((fr) => NORTHISH.test(fr.facingWord));
  const axisEW = Math.abs(sv.grid.siteAxisDeg - 90) <= 30;
  if (northFront.length) opp.push({ theme: 'Orientation', text: `The frontage to ${listWords(northFront.map((fr) => fr.name))} faces ${listWords([...new Set(northFront.map((fr) => fr.facingName))])}: living rooms and open space can take the winter sun from the street side.`, mark: topOfSite });
  else if (axisEW) opp.push({ theme: 'Orientation', text: `The long axis runs east–west (${sv.grid.siteAxisDeg}°), so a long boundary faces north: a north-facing rear or courtyard is available.`, mark: topOfSite });
  else con.push({ theme: 'Orientation', text: `The long axis runs ${sv.grid.siteAxisDeg <= 30 || sv.grid.siteAxisDeg >= 150 ? 'north–south' : `at ${sv.grid.siteAxisDeg}°`}${sv.grid.frontages.length ? ` with the frontage facing ${listWords([...new Set(sv.grid.frontages.map((fr) => fr.facingName))])}` : ''}: winter sun comes over a side boundary, so the northern setback and the neighbour's height there decide the sun access.`, mark: topOfSite });
  const w = sv.sun.winter;
  const worst = [...sv.shadows].sort((x, y) => y.shadedPct - x.shadedPct)[0];
  const shadeClause = sv.near.total && !sv.near.withHeight ? '; no neighbour within 60 m has a known height, so the shadow study is still open'
    : sv.castersInReach && worst ? (worst.shadedPct < 1 ? '; the neighbours with known heights leave it in sun' : worst.shadedPct < 10 ? `; the neighbours with known heights shade at most ${fmtPct(worst.shadedPct)} of the site` : '') : '';
  const siteDiagM = Number.isFinite(sx1) ? Math.hypot(sx1 - sx0, sy1 - sy0) / k : 10;
  const arcRadiusM = Math.max(siteDiagM / 2 + (5 * scale) / 1000, (11 * scale) / 1000);
  opp.push({ theme: 'Sun', text: `Winter sun (21 June) from the ${dir(w.hours[0].azimuthDeg)} at 9 am to the ${dir(w.hours[2].azimuthDeg)} at 3 pm, ${w.noonAltitudeDeg.toFixed(0)}° high at noon${shadeClause}.`, mark: atBearing(w.hours[1].azimuthDeg, arcRadiusM) });
  if (sv.castersInReach && worst && worst.shadedPct >= 10) {
    const mc = worst.mainCaster;
    con.push({ theme: 'Overshadowing', text: `${mc ? `The ${mc.floors ? `${mc.floors}-storey` : `${fmtNum(mc.heightM)} m`} building to the ${dir(mc.bearing)} shades` : 'The neighbours shade'} ${fmtPct(worst.shadedPct)} of the site at ${worst.label} on 21 June${sv.shadows.filter((s) => s !== worst).map((s) => `, ${fmtPct(s.shadedPct)} at ${s.label}`).join('')}: the sunlit part of the site is the north-west or north-east corner, depending on the hour.`, mark: mc ? markAt(mc.lon, mc.lat) : null });
  }

  // Open space and amenity.
  const np = gr.openSpace.nearest;
  if (np) {
    const v = nearestVertex(np.rings);
    const within5 = gr.openSpace.within.find((x) => x.minutes === 5)?.parks ?? 0;
    opp.push({ theme: 'Open space', text: `${np.name ?? `Unnamed ${np.kind}`}${np.areaHa >= 0.1 ? ` (${fmtNum(np.areaHa, 1)} ha)` : ''} ${np.distanceM <= 12 ? 'adjoins the site' : `${mDist(np.distanceM)} to the ${dir(np.bearing)}`}${within5 ? `; ${within5 === 1 ? 'one park' : `${within5} parks`} within 5 minutes' walk` : ''}.`, mark: v ? markAt(v.lon, v.lat) : null });
  }
  const fac = [...gr.facilities].sort((x, y) => x.distanceM - y.distanceM).find((x) => x.distanceM <= 600);
  if (fac) opp.push({ theme: 'Amenity', text: `${fac.name} (${FACILITY_WORD[fac.kind][0]}) ${mDist(fac.distanceM)} to the ${dir(fac.bearing)}${gr.facilities.length > 1 ? `; ${gr.facilities.length} public facilities in the window` : ''}.`, mark: markAt(fac.lon, fac.lat) });

  // Views.
  const clearViews = sv.views.filter((v) => v.clear === true && v.kind !== 'park');
  if (clearViews.length) opp.push({ theme: 'Views', text: `The ground leaves the line clear to ${listWords(clearViews.slice(0, 4).map((v) => `${v.label} (${VIEW_WORD[v.kind]}, ${mDist(v.distanceM)} to the ${dir(v.bearingDeg)})`))}${clearViews.length > 4 ? ` and ${clearViews.length - 4} more (slide 13)` : ''} from ${sv.eyeAboveM !== null ? `${fmtNum(sv.eyeAboveM)} m up` : 'the height limit'}; buildings in the way are not tested.`, mark: { bearing: clearViews[0].bearingDeg, edge: true } });

  // Change around the site.
  const daNear = dv.sites.filter((s) => inPanel(s.lon, s.lat)).map((s) => ({ ...s, d: distC(s.lon, s.lat) })).sort((x, y) => x.d - y.d);
  const ssdNear = dv.stateSignificant.sites.filter((q) => q.stageClass !== 'withdrawn' && inPanel(q.lon!, q.lat!)).sort((x, y) => x.distanceM - y.distanceM);
  const ssdOn = ssdNear.find((q) => q.onSite);
  const daBit = daNear.length ? `${daNear.length === 1 ? 'one application' : `${daNear.length} applications`} of scale lodged with the council${dv.from ? ` since ${dv.from.slice(0, 4)}` : ''}${daNear[0].storeys ? `, the nearest ${daNear[0].storeys} storeys ${mDist(daNear[0].d)} to the ${dir(bearingTo(daNear[0].lon, daNear[0].lat))}` : ''}` : '';
  if (ssdNear.length) {
    const lead = ssdOn ?? ssdNear[0];
    const ssdBit = `${ssdNear.length === 1 ? 'one State significant application' : `${ssdNear.length} State significant applications`}, ${ssdOn ? `${ssdOn.number} on the site itself` : `${ssdNear.length === 1 ? '' : 'the nearest '}${lead.number} ${mDist(lead.distanceM)} to the ${dir(lead.bearing)}`} (${ssdStagePhrase(lead)})`;
    opp.push({ theme: 'Change', text: `Within the diagram: ${daBit ? `${daBit}, and ${ssdBit}` : ssdBit}. The block is changing (slide 07).`, mark: ssdOn ? null : markAt(lead.lon!, lead.lat!) });
  } else if (daNear.length) opp.push({ theme: 'Change', text: `${capFirst(daBit.replace(' lodged with the council', ' lodged within the diagram'))}: the block is changing (slide 07).`, mark: markAt(daNear[0].lon, daNear[0].lat) });

  // Scale: the height plane against the neighbours.
  const env = bf.envelope, med = bf.near.medianStoreys;
  if (env?.storeys && med) {
    if (env.storeys >= med + 2) opp.push({ theme: 'Scale', text: `The height plane allows about ${env.storeys} storeys (${env.label}) where the buildings within 250 m are typically ${med}: room to add scale.`, mark: null });
    else con.push({ theme: 'Scale', text: `The height plane allows about ${env.storeys} storeys (${env.label}) against a neighbourhood median of ${med}${bf.near.above8 ? ` and ${bf.near.above8} building${bf.near.above8 === 1 ? '' : 's'} over 8 storeys within 250 m` : ''}.`, mark: null });
  }

  // Controls.
  const c = b.controls;
  const bits = [
    planning.zoneAtSite ? `zone ${planning.zoneAtSite.code} ${planning.zoneAtSite.name}` : c.zoneCode ? `zone ${c.zoneCode} ${c.zonePurpose ?? ''}`.trim() : '',
    planning.hobAtSite ? `height ${planning.hobAtSite.label}` : c.maxHeightM ? `height ${c.maxHeightM} m` : 'no height of buildings mapped',
    planning.fsrAtSite ? `FSR ${planning.fsrAtSite}:1` : c.fsr ? `FSR ${c.fsr}:1` : 'no FSR mapped',
    planning.lotSizeAtSite ? `minimum lot ${fmtNum(planning.lotSizeAtSite)} m²` : '',
  ].filter(Boolean);
  con.unshift({ theme: 'Controls', text: `${bits.join(' · ')}${planning.zoneAtSite?.epi ? ` (${shortEpi(planning.zoneAtSite.epi)})` : ''}.`, mark: null });
  // Country: the search that is required, and what the open proxies say
  const co = b.country;
  const nearPlace = co.places[0];
  const cf = countryFacts(b);
  const lepNear = cf.lepAboriginal.items.find((i) => i.distanceM <= 500);
  // a permit to harm Aboriginal objects over or beside the site, an LEP landscape map, a place on the national lists (a nomination or the archived register binds nothing, so neither is said here)
  const permitNear = cf.ahips.permits.find((q) => q.distanceM <= 200);
  const areaNear = cf.lepAreas.areas.find((a) => a.distanceM <= 200);
  const listedNear = cf.lists.places.find((q) => q.list !== 'RNE' && !q.nominated && q.distanceM <= 500);
  con.push({ theme: 'Country', text: `Aboriginal cultural heritage: an AHIMS search is required before works (the register is not open)${permitNear ? `; ${permitNear.onSite ? `AHIP ${permitNear.id} (${clipWords(permitNear.project, 60)}, ${permitState(permitNear)}) covers the site` : `a permit to harm Aboriginal objects (AHIP ${permitNear.id}, ${permitState(permitNear)}) ${permitNear.distanceM <= 3 ? 'adjoins the site' : `${mDist(permitNear.distanceM)} to the ${dir(permitNear.bearing)}`}`}` : ''}${areaNear ? `; ${areaNear.onSite ? 'the site is in' : areaNear.distanceM <= 3 ? "the site's edge meets" : `land ${mDist(areaNear.distanceM)} to the ${dir(areaNear.bearing)} is in`} ${/^[aeiou]/i.test(areaNear.cls) ? 'an' : 'a'} ${areaNear.cls} (${areaNear.epi})` : ''}${lepNear ? `; ${lepNear.onSite ? 'the site is' : `${lepNear.name}${lepNear.id ? ` (${lepNear.id})` : ''}, ${mDist(lepNear.distanceM)} to the ${dir(lepNear.bearing)}, is`} an Aboriginal heritage item in the ${lepNear.epi} schedule${lepNear.onSite ? ` (${lepNear.name})` : ''}` : ''}${listedNear ? `; ${listedNear.name} (${listedNear.status} on the ${LIST_WORD[listedNear.list]}) ${listedNear.onSite ? 'takes in the site' : `${mDist(listedNear.distanceM)} to the ${dir(listedNear.bearing)}`}` : ''}${nearPlace && nearPlace.distanceM <= 2000 ? `; ${nearPlace.name}, a gazetted Aboriginal Place, ${mDist(nearPlace.distanceM)} to the ${dir(nearPlace.bearing)}` : ''}${co.nativeTitle.atSite.length ? `; ${listWords(co.nativeTitle.atSite.map((r) => r.name))} over the site (NNTT)` : ''}${co.asdst.ok && co.asdst.likelihood !== null && co.asdst.likelihood >= 500 ? `; the ASDST model rates the site's likelihood ${co.asdst.likelihood} of ${co.asdst.scaleMax}` : ''}.`, mark: permitNear && !permitNear.onSite && permitNear.distanceM > 3 ? atBearing(permitNear.bearing, permitNear.distanceM) : !permitNear && nearPlace && nearPlace.distanceM <= 2000 ? markAt(nearPlace.lon, nearPlace.lat) : null });
  if (planning.lotSizeAtSite && b.siteAreaSqm && b.siteAreaSqm < planning.lotSizeAtSite) con.push({ theme: 'Controls', text: `The site (${fmtNum(b.siteAreaSqm)} m²) is under the minimum lot size of ${fmtNum(planning.lotSizeAtSite)} m²: no subdivision without a variation.`, mark: null });

  // Heritage: on the site, adjoining or near, and the State register.
  if (planning.heritageAtSite.length) con.push({ theme: 'Heritage', text: `${listWords(planning.heritageAtSite.map((h) => `${h.name}${h.kind === 'conservationArea' ? ' (conservation area)' : h.kind === 'shr' ? ' (State Heritage Register)' : h.significance ? ` (${h.significance.toLowerCase()} significance)` : ''}`))} on the site: the conservation controls and a heritage impact statement apply.`, mark: null });
  const heritageNear = b.heritage.features
    .filter((f) => !/conservation/i.test(String(f.properties?.LAY_CLASS ?? '')) && !containsSite(geomRings(f.geometry)))
    .map((f) => ({ f, v: nearestVertex(geomRings(f.geometry)) }))
    .filter((x): x is { f: GeoJSONFeature; v: { lon: number; lat: number; d: number } } => Boolean(x.v && x.v.d <= 120))
    .sort((x, y) => x.v.d - y.v.d);
  if (heritageNear.length) {
    const h = heritageNear[0];
    const name = titleCase(String(h.f.properties?.H_NAME ?? 'Heritage item'));
    con.push({ theme: 'Heritage', text: `${name} ${h.v.d <= 3 ? 'adjoins the site' : `${mDist(h.v.d)} to the ${dir(bearingTo(h.v.lon, h.v.lat))}`}${heritageNear.length > 1 ? `; ${heritageNear.length} heritage items within 120 m` : ''}: the item's setting and the views to it.`, mark: markAt(h.v.lon, h.v.lat) });
  }
  const shr = planning.heritageNearby.nearestShr;
  if (shr && shr.distanceM <= 300 && !planning.heritageAtSite.some((h) => h.kind === 'shr')) con.push({ theme: 'Heritage', text: `${shr.name} (State Heritage Register) ${mDist(shr.distanceM)} away.`, mark: null });

  // Hazards, protections and corridors at the site and within the diagram.
  for (const row of cs.atSite) con.push({ theme: GROUP_THEME[row.group], text: `${row.title}${row.atSite.length && !row.atSite.every((x) => sameWord(x, row.title)) ? `: ${row.atSite.join(', ')}` : ''} at the site${row.epi ? ` (${shortEpi(row.epi)}${row.currency ? `, map of ${fmtIso(row.currency)}` : ''})` : row.instrument ? ` (${row.instrument})` : ''}.`, mark: null });
  for (const row of cs.nearby.filter((r) => r.nearest && r.nearest.distanceM <= reachM).slice(0, 3)) con.push({ theme: 'Nearby', text: `${row.title}${!sameWord(row.nearest!.cls, row.title) ? ` (${row.nearest!.cls})` : ''} ${mDist(row.nearest!.distanceM)} to the ${dir(row.nearest!.bearing)}.`, mark: atBearing(row.nearest!.bearing, row.nearest!.distanceM) });

  // Noise.
  if (cs.noise.roads.length) {
    const r0 = cs.noise.roads[0];
    const v = nearestVertex(b.base.roads.filter((r) => r.name && titleCase(r.name) === r0.name).map((r) => r.coords as number[][]));
    con.push({ theme: 'Noise', text: `${listWords(cs.noise.roads.map((r) => `${r.name} (${r.word})`))} within 60 m of the boundary${v ? `, to the ${dir(bearingTo(v.lon, v.lat))}` : ''}: traffic noise on that edge.`, mark: v ? markAt(v.lon, v.lat) : null });
  }
  if (cs.noise.rail || cs.noise.tram) {
    const v = nearestVertex([...(cs.noise.rail ? b.base.rail.train : []), ...(cs.noise.tram ? b.base.rail.tram : [])] as number[][][]);
    con.push({ theme: 'Noise', text: `${cs.noise.rail ? 'Railway' : 'Light rail'} within 120 m${v ? `, to the ${dir(bearingTo(v.lon, v.lat))}` : ''}: noise and vibration${[...cs.atSite, ...cs.nearby].some((r) => r.id === 'railCorridor') ? ', and the corridor protection zone (SEPP)' : ''}.`, mark: v ? markAt(v.lon, v.lat) : null });
  }

  // Tall neighbours.
  const tall = bf.tallest.filter((x) => x.distanceM <= reachM && x.storeys && (!env?.storeys || x.storeys >= env.storeys + 3)).slice(0, 2);
  if (tall.length) con.push({ theme: 'Scale', text: `${listWords(tall.map((x) => `${x.storeys ? `${x.storeys}-storey` : `${fmtNum(x.heightM)} m`} ${x.name ? titleCase(x.name) : 'building'} ${mDist(x.distanceM)} to the ${dir(x.bearing)}`))}: overlooking and outlook to design for.`, mark: atBearing(tall[0].bearing, tall[0].distanceM) });

  // Levels.
  const lv = sf.levels;
  if (lv && lv.fallM >= 1) con.push({ theme: 'Levels', text: `Falls ${fmtNum(lv.fallM, 1)} m across the site${lv.lowBearing !== undefined ? ` to the ${dir(lv.lowBearing)}` : ''} (RL ${fmtNum(lv.min, 1)}–${fmtNum(lv.max, 1)}${tf?.slope?.oneIn ? `, 1 in ${tf.slope.oneIn}` : ''}): levels, cut and fill, and the survey to confirm.`, mark: lv.lowBearing !== undefined ? atBearing(lv.lowBearing, siteSpanM / 2 + 3) : null });
  else if (tf?.slope && tf.slope.pct >= 2 && tf.slope.fallBearing !== undefined) con.push({ theme: 'Levels', text: `The ground falls to the ${tf.slope.faces} at ${fmtNum(tf.slope.pct, 1)} %${tf.slope.oneIn ? ` (1 in ${tf.slope.oneIn})` : ''}.`, mark: atBearing(tf.slope.fallBearing, siteSpanM / 2 + 3) });

  // Title: easements.
  if (b.site.easements.length) {
    const v = nearestVertex(b.site.easements.flatMap((e) => e.rings));
    const widths = [...new Set(b.site.easements.filter((e) => e.widthM).map((e) => `${fmtNum(e.widthM!, 1)} m`))];
    con.push({ theme: 'Title', text: `${b.site.easements.length === 1 ? 'An easement' : `${b.site.easements.length} easements`} in the cadastre's easement layer${widths.length ? ` (${listWords(widths)} wide)` : ''}; the title search gives the purpose.`, mark: v ? markAt(v.lon, v.lat) : null });
  }

  // What stands there now, and what stands on the boundary.
  if (sf.buildings.onSite.length) {
    const storeys = [...new Set(sf.buildings.onSite.filter((x) => x.floors).map((x) => `${x.floors} storeys`))];
    con.push({ theme: 'Existing', text: `${sf.buildings.onSite.length === 1 ? 'One building' : `${sf.buildings.onSite.length} buildings`} on the lot covering ${fmtPct(sf.buildings.coveragePct)} of it${storeys.length ? ` (${listWords(storeys)})` : ''}: demolition, retention or adaptation to decide.`, mark: null });
  }
  if (sf.buildings.adjoining.length) {
    const dirs = [...new Set(sf.buildings.adjoining.map((a) => dir(a.bearing)))];
    const known = sf.buildings.adjoining.filter((a) => a.floors);
    con.push({ theme: 'Neighbours', text: `Neighbours built to the boundary on the ${listWords(dirs)}${known.length ? ` (${listWords(known.map((a) => `${a.floors} storeys to the ${dir(a.bearing)}`))})` : ''}: party walls, windows and setbacks along those edges.`, mark: atBearing(sf.buildings.adjoining[0].bearing, siteSpanM / 2 + 3) });
  }

  // Trees along the frontages, where a council inventory is open.
  if (gr.trees.nearSite) {
    const nearTrees = b.green.trees.points.map((tr) => ({ ...tr, d: distToSiteM(tr.lon, tr.lat) })).filter((tr) => tr.d <= 30).sort((x, y) => x.d - y.d);
    con.push({ theme: 'Trees', text: `${gr.trees.nearSite} street tree${gr.trees.nearSite === 1 ? '' : 's'} within 30 m of the boundary${gr.trees.medianCrownM ? `, median crown ${fmtNum(gr.trees.medianCrownM)} m` : ''} (${gr.trees.source?.name ?? 'council inventory'}): retain, protect or offset.`, mark: nearTrees[0] ? markAt(nearTrees[0].lon, nearTrees[0].lat) : null });
  }

  const OPP_ORDER = ['Transport', 'Policy', 'Orientation', 'Sun', 'Open space', 'Views', 'Active edge', 'Amenity', 'Change', 'Scale'];
  const CON_ORDER = ['Controls', 'Country', 'Heritage', 'Overshadowing', 'Hazard', 'Soils', 'Water', 'Coast', 'Ecology', 'Aviation', 'Corridor', 'Noise', 'Orientation', 'Levels', 'Existing', 'Neighbours', 'Title', 'Trees', 'Scale', 'Nearby'];
  const rank = (order: string[]) => (x: Omit<OcStatement, 'n'>) => { const i = order.indexOf(x.theme); return i < 0 ? order.length : i; };
  // the lists below the diagrams hold about 94 mm each; a statement takes its lines at roughly 116 characters a line
  const fit = (xs: Omit<OcStatement, 'n'>[], order: string[]): { kept: OcStatement[]; dropped: number } => {
    const sorted = [...xs].map((x, i) => ({ x, i })).sort((a, c) => rank(order)(a.x) - rank(order)(c.x) || a.i - c.i).map((q) => q.x);
    const kept: OcStatement[] = [];
    let used = 0;
    for (const st of sorted) { const lines = Math.ceil((st.theme.length + st.text.length + 3) / 56); const h = lines * 3.1 + 1.4; if (used + h > 118 || kept.length >= 12) break; used += h; kept.push({ ...st, n: kept.length + 1 }); }
    return { kept, dropped: sorted.length - kept.length };
  };
  const o = fit(opp, OPP_ORDER), c2 = fit(con, CON_ORDER);
  return {
    scale, panel,
    opportunities: o.kept, constraints: c2.kept,
    dropped: { opportunities: o.dropped, constraints: c2.dropped },
    sunArc: winterSunArc(centreLL.lat, centreLL.lon),
    stationsBeyond: stations.filter((s) => { const pt = stationPts.find((q) => Math.abs(q.d - s.distanceM) < 2); return !pt || !inPanel(pt.lon, pt.lat); }).map((s) => ({ ...s, marked: o.kept.some((st) => st.theme === 'Transport' && st.mark?.edge && Math.abs(((st.mark as { bearing: number }).bearing - s.bearing + 540) % 360 - 180) < 3) })),
    /** The other slides' facts, for the drawing; stripped from the deck's JSON, where they already appear under their own slides. */
    draw: { mv, gr, cs, sv, bf, sf, tf },
  };
}

export function ocSentences(_b: SlidesBundle, f: ReturnType<typeof ocFacts>): string[] {
  const out: string[] = [];
  const o = f.opportunities, c = f.constraints;
  out.push(`${o.length} opportunit${o.length === 1 ? 'y' : 'ies'} and ${c.length} constraint${c.length === 1 ? '' : 's'} follow from the deck's data, numbered on the two diagrams at 1:${fmtNum(f.scale)} around the site; each is a starting sentence for the author to keep, reword or strike${f.dropped.opportunities + f.dropped.constraints ? `, and ${f.dropped.opportunities + f.dropped.constraints} more sit in the deck's JSON` : ''}.`);
  if (o.length) out.push(`For the site: ${o.slice(0, 3).map((s) => s.text).join(' ')}`);
  if (c.length) out.push(`Against it: ${c.slice(0, 3).map((s) => s.text.charAt(0).toUpperCase() + s.text.slice(1)).join(' ')}`);
  out.push('Nothing here is a judgement of merit: a constraint is a matter the design must answer, an opportunity a matter it can use, and the same fact (a tall neighbour, a busy road, a fall across the site) can be either.');
  return out;
}

/** A numbered marker, nudged off anything already placed. */
function ocMarker(x: number, y: number, n: number, colour: string, spacer: LabelSpacer, edgeBearing?: number, edgeLabel?: string): string {
  const tries: [number, number][] = [[0, 0], [3.4, 0], [-3.4, 0], [0, 3.4], [0, -3.4], [3.4, 3.4], [-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [6.8, 0], [-6.8, 0]];
  let px = x, py = y;
  for (const [dx, dy] of tries) { if (spacer.take(x + dx, y + dy, 5.2, 5.2)) { px = x + dx; py = y + dy; break; } }
  const arrow = edgeBearing === undefined ? '' : (() => {
    const a = (edgeBearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const tipX = px + ux * 4.6, tipY = py + uy * 4.6, bx = px + ux * 2.4, by = py + uy * 2.4;
    return `<path d="M${(bx - uy * 1.3).toFixed(1)},${(by + ux * 1.3).toFixed(1)} L${tipX.toFixed(1)},${tipY.toFixed(1)} L${(bx + uy * 1.3).toFixed(1)},${(by - ux * 1.3).toFixed(1)} Z" fill="${colour}"/>`;
  })();
  let text = '';
  if (edgeLabel && edgeBearing !== undefined) {
    const a = (edgeBearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const w = labelW(edgeLabel, 1.9);
    const lx = px - ux * (3.4 + w / 2) + (Math.abs(ux) < 0.5 ? 0 : 0), ly = py - uy * 4.2 + (Math.abs(uy) < 0.5 ? 3.6 : 0);
    if (spacer.take(lx, ly, w, 2.5)) text = label(lx, ly, edgeLabel, 1.9, colour);
  }
  return `${arrow}<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="${colour}" stroke="#ffffff" stroke-width="0.4"/><text x="${px.toFixed(1)}" y="${(py + 0.9).toFixed(1)}" text-anchor="middle" font-size="2.6" font-weight="600" fill="#ffffff">${n}</text>${text}`;
}

/** Opportunities and constraints on the template: one page at the diagram's scale, what the site can use in green and what it must answer in red, both numbered to the lists. */
export function ocAtlas(b: SlidesBundle, planning: PlanningFacts): Slide {
  const t = tpl();
  const G = INK.green, R = INK.red;
  const f = ocFacts(b, planning);
  const { gr, sv } = f.draw;
  const p: Panel = { center: f.panel.center, scale: f.panel.scale, wMm: 210, hMm: 297 };
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const cLL = mercatorToLonLat(p.center);
  const [cx, cy] = proj(cLL.lon, cLL.lat);
  const mmPerM = 1000 / p.scale;
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const sb = siteRings.length ? bboxOf(siteRings, proj) : { x0: cx - 3, y0: cy - 3, x1: cx + 3, y1: cy + 3 };
  const parts: string[] = [withTemplate(gt, () => baseLayers(b.base, proj, p))];
  if (b.buildings.buildings.length) parts.push(`<path d="${b.buildings.buildings.map((bd) => ringsPath(bd.rings, proj)).join('')}" fill="#f2f2f2" stroke="#d6d6d6" stroke-width="0.1" fill-rule="evenodd"/>`);
  const legend: LegendEntry[] = [];
  // ---- what the site can use, in green
  const PARK: Fill = { bg: G.mid, outline: G.solid, outlineW: 0.2 };
  const spaces = gr.openSpace.spaces.filter((sp) => sp.rings.some((r) => clippedStats(r, proj, p).area > 0));
  if (spaces.length) { parts.push(fillShape(spaces.map((sp) => ringsPath(sp.rings, proj)).join(''), box, PARK)); legend.push({ swatch: swatchOf(PARK), label: 'Parks and reserves' }); }
  const isos = b.movement.isochrones.filter((iso) => iso.minutes <= 10);
  for (const iso of isos) parts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="none" stroke="${G.deep}" stroke-width="${iso.minutes === 5 ? 0.45 : 0.3}" stroke-dasharray="1.6 0.9" fill-rule="evenodd"/>`);
  if (isos.length) legend.push({ swatch: `<path d="M0,1.8H5" stroke="${G.deep}" stroke-width="0.4" stroke-dasharray="1.6 0.9"/>`, label: `Walking reach from the site, ${isos.map((i) => i.minutes).sort((x, y) => x - y).join(' and ')} minutes` });
  const VIEW: Fill = { bg: '#ffffff', kind: 'vlines', ink: G.line, step: 0.7, w: 0.15, outline: G.deep, outlineW: 0.2 };
  const reach = Math.hypot(p.wMm, p.hMm);
  const clearViews = sv.views.filter((v) => v.clear === true && v.kind !== 'park');
  for (const v of clearViews) {
    const a = (v.bearingDeg * Math.PI) / 180, h = (8 * Math.PI) / 180, dMm = Math.min(reach, v.distanceM * mmPerM);
    const d = `M${cx.toFixed(2)},${cy.toFixed(2)}L${(cx + dMm * Math.sin(a - h)).toFixed(2)},${(cy - dMm * Math.cos(a - h)).toFixed(2)}L${(cx + dMm * Math.sin(a + h)).toFixed(2)},${(cy - dMm * Math.cos(a + h)).toFixed(2)}Z`;
    parts.push(fillShape(d, box, VIEW));
  }
  if (clearViews.length) legend.push({ swatch: swatchOf(VIEW), label: 'Clear sight lines from the height limit, slide 13' });
  // ---- what it must answer, in red
  const HCA: Fill = { outline: R.deep, outlineW: 0.45, dash: '1.4 0.7' };
  const cas = b.heritage.features.filter((ft) => /Conservation Area/i.test(String(ft.properties.LAY_CLASS ?? '')));
  const items = b.heritage.features.filter((ft) => !/Conservation Area/i.test(String(ft.properties.LAY_CLASS ?? '')));
  const ITEM: Fill = { bg: R.light, outline: R.deep, outlineW: 0.22 };
  if (items.length) { parts.push(fillShape(items.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join(''), box, ITEM)); legend.push({ swatch: swatchOf(ITEM), label: 'Heritage items' }); }
  if (cas.length) { parts.push(fillShape(cas.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join(''), box, HCA)); legend.push({ swatch: swatchOf(HCA), label: 'Heritage conservation areas' }); }
  if (sv.castersInReach) {
    const SH: Fill = { kind: 'hlines', ink: R.line, step: 0.6, w: 0.14, rule: 'nonzero' };
    const ds = sv.shadowHulls.filter((x) => x.hour !== 12 && x.hulls.length).map((sh) => sh.hulls.map((hull) => `M${hull.map((q, i) => { const ll = mercatorToLonLat(q); const [x, y] = proj(ll.lon, ll.lat); return `${i ? 'L' : ''}${x.toFixed(2)},${y.toFixed(2)}`; }).join('')}Z`).join('')).join('');
    if (ds) { parts.push(fillShape(ds, box, SH)); legend.push({ swatch: swatchOf({ ...SH, bg: '#ffffff' }), label: "Neighbours' shadows, 9 am and 3 pm, 21 June" }); }
  }
  parts.push(withTemplate(gt, () => overLayers(b.base, proj, p, 'none')));
  const busy = b.base.roads.filter((r) => r.hierarchy <= 4);
  if (busy.length) { parts.push(`<path d="${busy.map((r) => ringsPath([r.coords], proj, false)).join('')}" fill="none" stroke="${R.line}" stroke-width="0.55" stroke-linecap="round"/>`); legend.push({ swatch: `<path d="M0,1.8H5" stroke="${R.line}" stroke-width="0.55"/>`, label: 'Arterial and sub-arterial roads: traffic noise' }); }
  // ---- the numbers
  const spacer = new LabelSpacer(p.wMm, p.hMm, 60);
  spacer.take(40, 10, 72, 10);
  spacer.take((sb.x0 + sb.x1) / 2, (sb.y0 + sb.y1) / 2, sb.x1 - sb.x0 + 2, sb.y1 - sb.y0 + 2);
  const edgePoint = (bearing: number): [number, number] => {
    const a = (bearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a), inset = 6;
    const tX = ux > 1e-9 ? (p.wMm - inset - cx) / ux : ux < -1e-9 ? (inset - cx) / ux : Infinity;
    const tY = uy > 1e-9 ? (p.hMm - 20 - cy) / uy : uy < -1e-9 ? (16 - cy) / uy : Infinity;
    const tt = Math.min(tX, tY);
    return [cx + ux * tt, cy + uy * tt];
  };
  const marks: string[] = [];
  const marker = (x: number, y: number, n: number, colour: string, edge?: number) => {
    let px = x, py = y;
    for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4], [4, -4], [-4, 4], [8, 0], [-8, 0]] as [number, number][]) if (spacer.take(x + dx, y + dy, 4.4, 4.4)) { px = x + dx; py = y + dy; break; }
    const arrow = edge === undefined ? '' : (() => { const a = (edge * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a); const bx = px + ux * 2.2, by = py + uy * 2.2; return `<path d="M${(bx - uy * 1.1).toFixed(2)},${(by + ux * 1.1).toFixed(2)}L${(px + ux * 4).toFixed(2)},${(py + uy * 4).toFixed(2)}L${(bx + uy * 1.1).toFixed(2)},${(by - ux * 1.1).toFixed(2)}Z" fill="${colour}"/>`; })();
    marks.push(`${arrow}<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2" fill="${colour}" stroke="#ffffff" stroke-width="0.35"/><text x="${px.toFixed(2)}" y="${(py + 0.74).toFixed(2)}" text-anchor="middle" font-size="2.117" fill="#ffffff">${n}</text>`);
  };
  const place = (list: OcStatement[], colour: string, row: number) => {
    const chips = list.filter((q) => !q.mark);
    chips.forEach((s, i) => { const per = Math.min(chips.length, 5); marker((sb.x0 + sb.x1) / 2 + ((i % 5) - (per - 1) / 2) * 4.8, sb.y1 + 4.4 + (row + Math.floor(i / 5)) * 4.8, s.n, colour); });
    for (const s of list) { if (!s.mark) continue; if (s.mark.edge) { const [x, y] = edgePoint(s.mark.bearing); marker(x, y, s.n, colour, s.mark.bearing); } else { const [x, y] = proj(s.mark.lon, s.mark.lat); marker(x, y, s.n, colour); } }
  };
  place(f.opportunities, G.deep, 0);
  place(f.constraints, R.deep, Math.ceil(f.opportunities.filter((q) => !q.mark).length / 5));
  parts.push(siteMark(b.base, proj, 'both'), siteEdge(b, proj), ...marks, panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('oc17', p, parts.join('\n'));
  legend.unshift(
    { swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="${G.deep}"/>`, label: 'An opportunity, numbered to the list; an arrow points beyond the page' },
    { swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="${R.deep}"/>`, label: 'A constraint, numbered to the list' },
  );
  legend.push(SITE_KEY(t));
  const list = (items: OcStatement[], colour: string) => `<div class="zlist">${items.map((s) => `<div class="it"><span class="no" style="background:${colour}">${s.n}</span><b>${esc(s.theme)}</b> – ${esc(s.text)}</div>`).join('')}</div>`;
  const flow = `<div class="zflow" style="top:44mm">
    <div class="zh"><span>Opportunities · ${f.opportunities.length}</span><span style="left:${Z_TRACK}mm">Constraints · ${f.constraints.length}</span></div>
    <div style="display:grid;grid-template-columns:59.33mm 59.33mm;column-gap:4mm;margin-top:3mm">${list(f.opportunities, G.deep)}${list(f.constraints, R.deep)}</div></div>`;
  const sources = `Assembled from the layers the other slides read, at 1:${fmtNum(p.scale).replace(',', ' ')} round the site: stations and walking reach (09), policy maps (05), open space (10), sight lines and the winter sun (13), heritage (03), constraint layers (14), heights (08), the cadastre (11) and the applications (07). Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, `${f.opportunities.length} opportunities`, `${f.constraints.length} constraints`);
  return { id: '17_opportunities_constraints', title: 'Opportunities and constraints', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'Opportunities and constraints', p, flow), bleed: true, sources, accent: G.text, legend,
    narrative: brief([`${capFirst(numWord(f.opportunities.length))} opportunities and ${numWord(f.constraints.length)} constraints follow from the deck's data, numbered on the plan.`, 'A constraint is a matter the design must answer, an opportunity a matter it can use; the same fact — a tall neighbour, a busy road, a fall across the site — can be either.']) };
}

export function ocSlide(b: SlidesBundle, planning: PlanningFacts): Slide {
  const t = tpl();
  const f = ocFacts(b, planning);
  const { mv, gr, cs, sv, bf } = f.draw;
  const p = f.panel;
  const proj = panelProjector(p);
  const centreLL = mercatorToLonLat(p.center);
  const [cx, cy] = proj(centreLL.lon, centreLL.lat);
  const mmPerM = 1000 / p.scale;
  const siteRings = b.base.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of siteRings) for (const [lon, lat] of r) { const [x, y] = proj(lon, lat); bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  if (!Number.isFinite(bx0)) { bx0 = cx - 3; by0 = cy - 3; bx1 = cx + 3; by1 = cy + 3; }
  const siteR = Math.hypot(bx1 - bx0, by1 - by0) / 2;
  const insideSite = (lon: number, lat: number) => siteRings.some((r) => pointInRing(lon, lat, r));
  const inset = 5;
  const edgePoint = (bearing: number): [number, number] => {
    const a = (bearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const tX = ux > 1e-9 ? (p.wMm - inset - cx) / ux : ux < -1e-9 ? (inset - cx) / ux : Infinity;
    const tY = uy > 1e-9 ? (p.hMm - inset - cy) / uy : uy < -1e-9 ? (inset - cy) / uy : Infinity;
    const tt = Math.min(tX, tY);
    return [cx + ux * tt, cy + uy * tt];
  };
  const markers = (items: OcStatement[], colour: string, spacer: LabelSpacer): string => {
    const out: string[] = [];
    // site-wide statements sit in a row under the site, placed first so the located markers move round them
    const chips = items.filter((q) => !q.mark);
    chips.forEach((s, i) => {
      const perRow = Math.min(chips.length, 4);
      const x = (bx0 + bx1) / 2 + ((i % 4) - (perRow - 1) / 2) * 5.6;
      const y = by1 + 4.2 + Math.floor(i / 4) * 5.6;
      out.push(ocMarker(x, y, s.n, colour, spacer));
    });
    for (const s of items) {
      if (!s.mark) continue;
      if (s.mark.edge) {
        const [x, y] = edgePoint(s.mark.bearing);
        out.push(ocMarker(x, y, s.n, colour, spacer, s.mark.bearing, s.mark.label));
      } else {
        const [x, y] = proj(s.mark.lon, s.mark.lat);
        out.push(ocMarker(x, y, s.n, colour, spacer));
      }
    }
    return out.join('');
  };
  const touches = (rings: number[][][]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (const [lon, lat] of r) { const [x, y] = proj(lon, lat); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return x1 >= 0 && y1 >= 0 && x0 <= p.wMm && y0 <= p.hMm; };
  const frame = (inner: string[], id: string) => `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-${id}"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-${id})" font-family="${t.font}">${inner.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // ---- Opportunities: reach, policy, edges, open space, views, sun.
  const oParts: string[] = [baseLayers(b.base, proj, p)];
  const oLegend: LegendEntry[] = [];
  const policyKinds = new Set<string>();
  for (const area of b.policy) {
    const st = POLICY_STYLE[area.kind];
    if (!st || !touches(area.rings)) continue;
    const d = ringsPath(area.rings, proj);
    // the TOD and town-centre maps come lot by lot, so they are washed without outlines; the outline-only kinds keep their dashes
    oParts.push(st.fill === 'none' ? `<path d="${d}" fill="none" stroke="${st.stroke}" stroke-width="0.4"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} fill-rule="evenodd"/>` : `<path d="${d}" fill="${st.fill}" fill-opacity="0.18" stroke="none" fill-rule="evenodd"/>`);
    if (!policyKinds.has(area.kind)) { policyKinds.add(area.kind); oLegend.push({ swatch: swatchFill(st.fill === 'none' ? 'none' : st.fill, st.stroke, st.dash), label: st.label }); }
  }
  const spacesIn = gr.openSpace.spaces.filter((sp) => touches(sp.rings));
  if (spacesIn.length) {
    oParts.push(`<path d="${spacesIn.map((sp) => ringsPath(sp.rings, proj)).join('')}" fill="${PARK_GREEN}" fill-opacity="0.28" stroke="${PARK_GREEN}" stroke-width="0.2" fill-rule="evenodd"/>`);
    oLegend.push({ swatch: swatchFill(PARK_GREEN, PARK_GREEN), label: 'Parks and reserves' });
  }
  if (b.movement.activeFrontages.features.some((ft) => touches(geomRings(ft.geometry)))) {
    oParts.push(`<path d="${fcPath(b.movement.activeFrontages, proj)}" fill="${FRONTAGE_COLOUR}" fill-opacity="0.55" stroke="${FRONTAGE_COLOUR}" stroke-width="0.25" fill-rule="evenodd"/>`);
    oLegend.push({ swatch: swatchFill(FRONTAGE_COLOUR, FRONTAGE_COLOUR), label: 'LEP active street frontage' });
  }
  const isos = b.movement.isochrones.filter((iso) => iso.minutes <= 10).sort((x, y) => y.minutes - x.minutes);
  for (const iso of isos) oParts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="none" stroke="${ISO_FILL[iso.minutes] ?? '#a8cdc2'}" stroke-width="0.5" stroke-dasharray="1.6,1" fill-rule="evenodd"/>`);
  if (isos.length) oLegend.push({ swatch: swatchLine(ISO_FILL[5], 0.5, '1.6,1'), label: `Walking reach from the site: ${isos.map((i) => i.minutes).sort((x, y) => x - y).join(' and ')} minutes` });
  oParts.push(overLayers(b.base, proj, p, 'wash'));
  const oSpacer = new LabelSpacer(p.wMm, p.hMm, 40);
  oSpacer.take((bx0 + bx1) / 2, (by0 + by1) / 2, bx1 - bx0 + 2, by1 - by0 + 2);
  // isochrone labels at each ring's northmost point inside the panel
  for (const iso of isos) {
    const pts = iso.rings[0]?.map(([lon, lat]) => proj(lon, lat)).filter(([x, y]) => x > 8 && x < p.wMm - 8 && y > 6 && y < p.hMm - 6) ?? [];
    const top = pts.sort((q, r) => q[1] - r[1])[0];
    if (top && oSpacer.take(top[0], top[1] - 1.6, 9, 2.6)) oParts.push(label(top[0], top[1] - 1.6, `${iso.minutes} min`, 2, ISO_FILL[iso.minutes] ?? '#6ba998'));
  }
  // view cones where the ground leaves the line clear
  const reachMm = Math.hypot(p.wMm, p.hMm);
  const clearViews = sv.views.filter((v) => v.clear === true && v.kind !== 'park');
  for (const v of clearViews) {
    const a = (v.bearingDeg * Math.PI) / 180, half = (8 * Math.PI) / 180;
    const dMm = Math.min(reachMm, v.distanceM * mmPerM);
    const colour = VIEW_COLOUR[v.kind];
    oParts.push(`<path d="M${cx.toFixed(1)},${cy.toFixed(1)} L${(cx + dMm * Math.sin(a - half)).toFixed(1)},${(cy - dMm * Math.cos(a - half)).toFixed(1)} L${(cx + dMm * Math.sin(a + half)).toFixed(1)},${(cy - dMm * Math.cos(a + half)).toFixed(1)} Z" fill="${colour}" fill-opacity="0.13" stroke="${colour}" stroke-width="0.3"/>`);
    const [lx, ly] = edgePoint(v.bearingDeg);
    const text = `${v.label} ${v.distanceM >= 1000 ? `${(v.distanceM / 1000).toFixed(1)} km` : `${fmtNum(v.distanceM)} m`}`;
    const tx = lx - Math.sin(a) * 9, ty = ly + Math.cos(a) * 9;
    if (oSpacer.take(tx, ty, labelW(text, 1.9), 2.5)) oParts.push(label(tx, ty, text, 1.9, colour));
  }
  if (clearViews.length) oLegend.push({ swatch: `<path d="M0,3.2 L5,0.4 L5,3.2 Z" fill="${VIEW_COLOUR.city}" fill-opacity="0.3" stroke="${VIEW_COLOUR.city}" stroke-width="0.3"/>`, label: 'Clear sight line (slide 13); the target lies beyond the edge' });
  // the nearest park, linked
  const np = gr.openSpace.nearest;
  if (np && np.distanceM > 12) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const r of np.rings) for (const [lon, lat] of r) { const [x, y] = proj(lon, lat); const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; } }
    if (best) oParts.push(`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${best[0].toFixed(1)}" y2="${best[1].toFixed(1)}" stroke="${PARK_GREEN}" stroke-width="0.4" stroke-dasharray="1.4,1"/>`);
  }
  // the winter sun's sweep around the site
  const arcR = Math.max(siteR + 5, 11);
  const arc = f.sunArc.map((s) => { const a = (s.azimuthDeg * Math.PI) / 180; return [cx + arcR * Math.sin(a), cy - arcR * Math.cos(a)] as [number, number]; });
  if (arc.length > 1) {
    oParts.push(`<path d="M${arc.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}" fill="none" stroke="${SUN_COLOUR}" stroke-width="0.8" stroke-linecap="round"/>`);
    for (const h of sv.sun.winter.hours) {
      const a = (h.azimuthDeg * Math.PI) / 180;
      const x = cx + arcR * Math.sin(a), y = cy - arcR * Math.cos(a);
      oParts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${h.hour === 12 ? 1.6 : 1.1}" fill="${SUN_COLOUR}" stroke="#ffffff" stroke-width="0.3"/>`);
      const lx = cx + (arcR + 3.6) * Math.sin(a), ly = cy - (arcR + 3.6) * Math.cos(a);
      const text = h.hour === 12 ? `noon · ${h.altitudeDeg.toFixed(0)}°` : h.hour === 9 ? '9 am' : '3 pm';
      if (oSpacer.take(lx, ly, labelW(text, 1.9), 2.5)) oParts.push(label(lx, ly, text, 1.9, '#9a7420'));
    }
    const mid = arc[Math.floor(arc.length / 2)];
    if (mid && oSpacer.take(mid[0], mid[1] - 6.2, labelW('winter sun', 1.9), 2.5)) oParts.push(label(mid[0], mid[1] - 6.2, 'winter sun', 1.9, '#9a7420'));
    oLegend.push({ swatch: `<path d="M0.4,3.2 Q2.5,-0.8 4.6,3.2" fill="none" stroke="${SUN_COLOUR}" stroke-width="0.8"/>`, label: 'Winter sun round the site, 9 am to 3 pm on 21 June' });
  }
  // stations beyond the diagram: an arrow at the edge with the distance
  for (const s of f.stationsBeyond.filter((st) => !st.marked)) {
    const [x, y] = edgePoint(s.bearing);
    const a = (s.bearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    oParts.push(`<line x1="${(x - ux * 7).toFixed(1)}" y1="${(y - uy * 7).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${t.site}" stroke-width="0.5"/><path d="M${(x - uy * 1.3 - ux * 2.2).toFixed(1)},${(y + ux * 1.3 - uy * 2.2).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(x + uy * 1.3 - ux * 2.2).toFixed(1)},${(y - ux * 1.3 - uy * 2.2).toFixed(1)} Z" fill="${t.site}"/>`);
    const text = `${s.name} ${fmtNum(s.distanceM)} m`;
    const tx = x - ux * 10 - uy * 0, ty = y - uy * 10 + 3.2 * (uy < 0 ? 1 : -1);
    if (oSpacer.take(tx, ty, labelW(text, 1.9), 2.5)) oParts.push(label(tx, ty, text, 1.9, t.site));
  }
  if (b.base.stations.some((st) => { const [x, y] = proj(st.lon, st.lat); return x >= 0 && y >= 0 && x <= p.wMm && y <= p.hMm; }) || f.stationsBeyond.length) oLegend.push({ swatch: `<circle cx="2.5" cy="1.8" r="1.7" fill="#ffffff" stroke="${t.site}" stroke-width="0.4"/><text x="2.5" y="2.7" text-anchor="middle" font-size="2.4" font-weight="600" fill="${t.site}">T</text>`, label: 'Stations; an edge arrow points to one beyond the diagram' });
  oParts.push(markers(f.opportunities, OPP_COLOUR, oSpacer));
  oParts.push(siteMark(b.base, proj, 'outline'), panelFurniture(p, 'right'));

  // ---- Constraints: heritage, hazards and corridors, noise, shadows, levels, title, trees.
  const cParts: string[] = [baseLayers(b.base, proj, p)];
  const cLegend: LegendEntry[] = [];
  let hatchId = 0;
  const defs = [...CONSTRAINT_DEFS].sort((x, y) => (DRAW_RANK[x.id] ?? 5) - (DRAW_RANK[y.id] ?? 5));
  const drawnLayers: string[] = [];
  for (const def of defs) {
    const layer = b.constraints.layers.find((l) => l.id === def.id);
    if (!layer?.features.length) continue;
    const byClass = new Map<string, number[][][]>();
    for (const ft of layer.features) if (touches(ft.rings)) (byClass.get(ft.cls) ?? byClass.set(ft.cls, []).get(ft.cls)!).push(...ft.rings);
    let any = false;
    for (const [cls, rings] of byClass) {
      const fill = constraintFill(def.id, cls);
      const d = ringsPath(rings, proj);
      if (fill === 'none') cParts.push(`<path d="${d}" fill="none" stroke="#a80000" stroke-width="0.5" fill-rule="evenodd"/>`);
      else if (HATCHED_CLASS.test(cls)) cParts.push(hatchPath(d, `oc${hatchId++}`, fill === '#ffff73' ? '#b3a000' : fill, bboxOf(rings, proj), 1.3));
      else cParts.push(`<path d="${d}" fill="${fill}" fill-opacity="${(DRAW_RANK[def.id] ?? 5) <= 2 ? 0.4 : 0.55}" stroke="#6a7572" stroke-width="0.15" fill-rule="evenodd"/>`);
      if (!any) {
        any = true;
        cLegend.push({ swatch: fill === 'none' ? swatchFill('none', '#a80000') : HATCHED_CLASS.test(cls) ? swatchHatch(fill === '#ffff73' ? '#b3a000' : fill) : swatchFill(fill), label: def.title });
        drawnLayers.push(def.id);
      }
    }
  }
  const heritageKinds = new Map<string, LegendEntry>();
  let hh = 0;
  for (const ft of b.heritage.features) {
    const rings = geomRings(ft.geometry);
    if (!rings.length || !touches(rings)) continue;
    const st = heritageStyle(ft.properties?.LAY_CLASS);
    const d = ringsPath(rings, proj);
    if (st.hatch) { cParts.push(hatchPath(d, `oh${hh++}`, st.fill, bboxOf(rings, proj), 2.2)); heritageKinds.set(st.label, { swatch: swatchHatch(st.fill), label: st.label }); }
    else { cParts.push(`<path d="${d}" fill="${st.fill}" fill-opacity="0.85" stroke="#8a6a3c" stroke-width="0.2" fill-rule="evenodd"/>`); heritageKinds.set(st.label, { swatch: swatchFill(st.fill, '#8a6a3c'), label: st.label }); }
  }
  const shrIn = b.shr.features.filter((ft) => touches(geomRings(ft.geometry)));
  if (shrIn.length) { cParts.push(`<path d="${shrIn.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#7c2f22" stroke-width="0.5"/>`); heritageKinds.set('shr', { swatch: swatchLine('#7c2f22', 0.5), label: 'State Heritage Register curtilage' }); }
  cLegend.push(...heritageKinds.values());
  // the Country slide's permits to harm Aboriginal objects and the LEPs' Aboriginal landscape maps, where they reach the diagram
  const lepAreasIn = (b.country.lepAboriginalAreas?.areas ?? []).filter((a) => a.coversStrip || touches(a.rings));
  for (const [i, a] of lepAreasIn.entries()) {
    const col = LEP_LANDSCAPE_COLOUR(a.map);
    const bb = bboxOf(a.rings, proj);
    cParts.push(a.coversStrip ? hatchPath(`M0,0H${p.wMm}V${p.hMm}H0Z`, `ocab${i}`, col, { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm }, 1.6)
      : hatchPath(ringsPath(a.rings, proj), `ocab${i}`, col, { x0: Math.max(bb.x0, -2), y0: Math.max(bb.y0, -2), x1: Math.min(bb.x1, p.wMm + 2), y1: Math.min(bb.y1, p.hMm + 2) }, 1.6));
    cLegend.push({ swatch: swatchHatch(col), label: `${a.cls} (${shortEpi(a.epi)})` });
  }
  const permitsIn = (b.country.ahips?.permits ?? []).filter((q) => touches(q.rings));
  if (permitsIn.length) {
    const today = b.generatedAt.slice(0, 10), active = (q: (typeof permitsIn)[number]) => q.status === 'ACTIVE' && (!q.expires || q.expires >= today);
    for (const q of permitsIn) cParts.push(`<path d="${ringsPath(q.rings, proj)}" fill="${AHIP_COLOUR}" fill-opacity="0.12" stroke="${AHIP_COLOUR}" stroke-width="0.5"${active(q) ? '' : ' stroke-dasharray="1.4,0.8"'} fill-rule="nonzero"/>`);
    cLegend.push({ swatch: swatchFill(AHIP_COLOUR, AHIP_COLOUR, permitsIn.some((q) => !active(q)) ? '1.4,0.8' : undefined).replace('fill="', 'fill-opacity="0.3" fill="'), label: `Aboriginal Heritage Impact Permit boundary${permitsIn.some((q) => !active(q)) ? ', dashed where expired' : ''}` });
  }
  cParts.push(overLayers(b.base, proj, p, 'wash'));
  // busy roads as noise sources
  const busy = b.base.roads.filter((r) => r.hierarchy <= 4);
  if (busy.length) {
    for (const h of [4, 3, 2, 1]) { const ds = busy.filter((r) => r.hierarchy === h).map((r) => ringsPath([r.coords], proj, false)).join(''); if (ds) cParts.push(`<path d="${ds}" fill="none" stroke="${NOISE_COLOUR}" stroke-width="${h <= 3 ? 1.5 : 0.9}" stroke-opacity="${h <= 3 ? 0.5 : 0.4}" stroke-linecap="round" stroke-linejoin="round"/>`); }
    cLegend.push({ swatch: swatchLine(NOISE_COLOUR, 1.4), label: 'Arterial and sub-arterial roads: traffic noise' });
  }
  // the neighbours' winter shadows, morning and afternoon
  if (sv.castersInReach) {
    for (const sh of sv.shadowHulls.filter((x) => x.hour !== 12)) {
      if (!sh.hulls.length) continue;
      cParts.push(`<path d="${sh.hulls.map((hull) => `M${hull.map((q, i) => { const ll = mercatorToLonLat(q); const [x, y] = proj(ll.lon, ll.lat); return `${i ? 'L' : ''}${x.toFixed(1)},${y.toFixed(1)}`; }).join('')}Z`).join('')}" fill="${SHADOW_FILL}" fill-opacity="0.13" stroke="none" fill-rule="nonzero"/>`);
    }
    cLegend.push({ swatch: `<rect x="0" y="0.4" width="5" height="2.8" fill="${SHADOW_FILL}" fill-opacity="0.26"/>`, label: "Neighbours' shadows at 9 am and 3 pm on 21 June" });
  }
  const cSpacer = new LabelSpacer(p.wMm, p.hMm, 40);
  cSpacer.take((bx0 + bx1) / 2, (by0 + by1) / 2, bx1 - bx0 + 2, by1 - by0 + 2);
  // the tall neighbours, labelled in storeys
  const envStoreys = bf.envelope?.storeys ?? 0;
  for (const bd of b.buildings.buildings.filter((x) => x.floors && x.floors >= Math.max(5, envStoreys + 3) && !insideSite(x.centroid[0], x.centroid[1])).sort((x, y) => (y.floors ?? 0) - (x.floors ?? 0)).slice(0, 10)) {
    const [x, y] = proj(bd.centroid[0], bd.centroid[1]);
    if (x < 3 || y < 3 || x > p.wMm - 3 || y > p.hMm - 3) continue;
    const text = `${bd.floors} st`;
    if (cSpacer.take(x, y, labelW(text, 1.8), 2.3)) cParts.push(label(x, y, text, 1.8, '#454f4b'));
  }
  // easements, trees and the fall
  if (b.site.easements.length) {
    const rings = b.site.easements.flatMap((e) => e.rings);
    cParts.push(hatchPath(ringsPath(rings, proj), 'oc-ease', t.dimension, bboxOf(rings, proj), 1));
    cLegend.push({ swatch: swatchHatch(t.dimension), label: 'Easement (cadastre)' });
  }
  const nearTrees = b.green.trees.points.filter((tr) => { const [x, y] = proj(tr.lon, tr.lat); return x >= 0 && y >= 0 && x <= p.wMm && y <= p.hMm && Math.hypot(x - cx, y - cy) <= siteR + 30 * mmPerM; });
  if (nearTrees.length) {
    cParts.push(nearTrees.map((tr) => { const [x, y] = proj(tr.lon, tr.lat); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(0.5, (tr.canopyM / 2) * mmPerM).toFixed(2)}" fill="${TREE_DOT}" fill-opacity="0.45" stroke="${TREE_DOT}" stroke-width="0.2"/>`; }).join(''));
    cLegend.push({ swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="${TREE_DOT}" fill-opacity="0.45" stroke="${TREE_DOT}" stroke-width="0.2"/>`, label: 'Street trees near the site, at crown size' });
  }
  const fallDir = f.draw.sf.levels?.lowBearing ?? f.draw.tf?.slope?.fallBearing;
  const fallM = f.draw.sf.levels?.fallM ?? 0;
  if (fallDir !== undefined && (fallM >= 1 || (f.draw.tf?.slope?.pct ?? 0) >= 2)) {
    const a = (fallDir * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const len = Math.min(Math.max(siteR * 1.6, 8), 16);
    const x0 = cx - ux * len / 2, y0 = cy - uy * len / 2, x1 = cx + ux * len / 2, y1 = cy + uy * len / 2;
    cParts.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${t.dimension}" stroke-width="0.6"/><path d="M${(x1 - uy * 1.4 - ux * 2.4).toFixed(1)},${(y1 + ux * 1.4 - uy * 2.4).toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} L${(x1 + uy * 1.4 - ux * 2.4).toFixed(1)},${(y1 - ux * 1.4 - uy * 2.4).toFixed(1)} Z" fill="${t.dimension}"/>`);
    const text = fallM >= 1 ? `falls ${fmtNum(fallM, 1)} m` : `falls ${fmtNum(f.draw.tf?.slope?.pct ?? 0, 1)} %`;
    for (const [tx, ty] of [[x1 + ux * 3 + 5 * (ux >= 0 ? 1 : -1), y1 + uy * 3], [x1 - uy * 6, y1 + ux * 6], [x1 + uy * 6, y1 - ux * 6], [x0 - ux * 3 - 5 * (ux >= 0 ? 1 : -1), y0 - uy * 3]]) {
      if (cSpacer.take(tx, ty, labelW(text, 1.9), 2.5)) { cParts.push(label(tx, ty, text, 1.9, t.dimension)); break; }
    }
    cLegend.push({ swatch: `<line x1="0" y1="1.8" x2="4" y2="1.8" stroke="${t.dimension}" stroke-width="0.6"/><path d="M3,0.6 L5,1.8 L3,3 Z" fill="${t.dimension}"/>`, label: 'The fall across the site (elevation model)' });
  }
  cParts.push(markers(f.constraints, CON_COLOUR, cSpacer));
  cParts.push(siteMark(b.base, proj, 'outline'), panelFurniture(p, 'right'));

  // ---- The page.
  const sub = [b.siteAddress, `${f.opportunities.length} opportunities`, `${f.constraints.length} constraints`, `1:${fmtNum(p.scale)}`].join(' · ');
  const sentences = ocSentences(b, f);
  const text = sentences.map((s) => `<p>${esc(s)}</p>`).join('') +
    placeholder('Narrative — for the author: which of these decide the scheme, which are answered by the controls already, and what the site visit and the survey add; then the design response to each.') +
    `<div class="fine">Assembled from the layers the other slides fetched, at 1:${fmtNum(p.scale)} around the site: stations and walking reach (slide 09), the housing-policy maps (03), open space and facilities (10), sight lines and the winter sun (13), the LEP heritage layer (03), the constraint layers (14), footprints and heights (08), the cadastre (11), the elevation model (06) and the applications of scale (07). The statements are templates from that data, for the author to edit. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const legendTop = FIELD_Y + PANEL_TITLE_H + p.hMm + 1.5;
  const listY = legendTop + HALF_LEGEND_H + 3;
  const listH = SLIDE_H - 12 - listY;
  const list = (title: string, items: OcStatement[], colour: string, x: number, dropped: number) => `<div class="abs" style="left:${x}mm;top:${listY}mm;width:${HALF_W}mm;height:${listH}mm;overflow:hidden">
    <div class="ptitle sm">${esc(title)}<span class="pnote">${items.length ? `${items.length} from the data${dropped ? ` · ${dropped} more in the JSON` : ''}` : 'nothing in the data'}</span></div>
    ${items.length ? items.map((s) => `<div class="oc"><span class="n" style="background:${colour}">${s.n}</span><span class="t"><b>${esc(s.theme)}</b> · ${esc(s.text)}</span></div>`).join('') : emptyBox(HALF_W, 20, 'no statement follows from the fetched layers')}
  </div>`;
  const panelHtml = (title: string, note: string, svg: string, legend: LegendEntry[], col: number) => {
    const x = FIELD_X + col * (HALF_W + GUTTER);
    const leg = legendSvg(legend, HALF_W, HALF_LEGEND_ROWS, 1.8);
    return `<div class="abs ptitle sm" style="left:${x}mm;top:${FIELD_Y}mm;width:${HALF_W}mm">${esc(title)}<span class="pnote">${esc(note)}</span></div>
    <div class="abs" style="left:${x}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${svg}</div>
    <svg class="abs" style="left:${x}mm;top:${legendTop}mm" width="${HALF_W}mm" height="${HALF_LEGEND_H}mm" viewBox="0 0 ${HALF_W} ${HALF_LEGEND_H}" xmlns="http://www.w3.org/2000/svg">${leg.svg}</svg>`;
  };
  const figure =
    panelHtml('Opportunities', `1:${fmtNum(p.scale)} · reach, edges, views, sun`, frame(oParts, 'oc-opp'), oLegend, 0) +
    panelHtml('Constraints', `1:${fmtNum(p.scale)} · heritage, hazards, noise, shadows`, frame(cParts, 'oc-con'), cLegend, 1) +
    list('Opportunities', f.opportunities, OPP_COLOUR, FIELD_X, f.dropped.opportunities) +
    list('Constraints', f.constraints, CON_COLOUR, FIELD_X + HALF_W + GUTTER, f.dropped.constraints);
  void mv; void cs;
  return { id: '17_opportunities_constraints', title: 'Opportunities and constraints', subtitle: sub, textHtml: text, figureHtml: figure };
}

// ---- slide 18: sources -------------------------------------------------------

interface SourceRow { dataset: string; used: string; currency: string; retrieved: string; attribution: string }
interface SourceGroup { publisher: string; rows: SourceRow[] }

const ATTR = {
  dphi: '© State of NSW (Planning, Housing and Infrastructure) · CC BY 4.0',
  portal: '© State of NSW (Planning, Housing and Infrastructure) · Planning Portal terms of use',
  spatial: '© Spatial Services, NSW Department of Customer Service · CC BY 4.0',
  vg: '© State of NSW (Valuer General) · CC BY 4.0',
  tfnsw: '© Transport for NSW · CC BY 4.0',
  education: '© State of NSW (Department of Education) · CC BY 4.0',
  dcceew: '© State of NSW (Climate Change, Energy, the Environment and Water) · CC BY 4.0',
  heritage: '© State of NSW (Heritage NSW) · CC BY 4.0',
  ahip: '© State of NSW (Heritage NSW) · CC BY 3.0 AU',
  lists: '© Commonwealth of Australia (Climate Change, Energy, the Environment and Water) · CC BY 3.0 AU (the lists), CC BY 4.0 (the RNE)',
  abs: '© Commonwealth of Australia (Australian Bureau of Statistics) · CC BY 4.0',
  overture: '© Overture Maps Foundation · ODbL and CDLA Permissive 2.0',
  osm: '© OpenStreetMap contributors · ODbL',
  valhalla: 'FOSSGIS Valhalla instance on OpenStreetMap data · ODbL',
  kartaview: '© KartaView contributors · CC BY-SA 4.0',
  wikipedia: 'Wikipedia contributors · text CC BY-SA 4.0',
  commons: 'Wikimedia Commons contributors · each file under its own licence, credited on the slide',
  mapillary: '© Mapillary contributors · CC BY-SA 4.0',
  google: '© Google · Google Maps Platform Terms of Service',
  nasa: 'NASA Langley Research Center POWER Project · free to use, acknowledged as the project asks',
  none: '—',
};

/** A date as the slide prints it, from an ISO string, epoch milliseconds or the property API's d-m-yyyy. */
function fmtAnyDate(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e11) return fmtIso(new Date(v).toISOString().slice(0, 10));
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return fmtIso(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return fmtIso(s.slice(0, 10));
  return s;
}

export function sourcesFacts(b: SlidesBundle, planning: PlanningFacts) {
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
  const deckDay = day(b.generatedAt);
  const retrieved = (iso?: string) => { const d = day(iso); return d && d !== deckDay ? `${d} (cache)` : deckDay; };
  const centreLL = mercatorToLonLat(b.panel.center);
  const contains = (f: GeoJSONFeature) => geomRings(f.geometry).some((r) => pointInRing(centreLL.lon, centreLL.lat, r));
  type LepStamp = { epi?: string; currency?: string; amendment?: string; where: 'at the site' | 'in the window' };
  const stampOf = (f: GeoJSONFeature, where: LepStamp['where']): LepStamp => ({ epi: f.properties?.EPI_NAME ? String(f.properties.EPI_NAME) : undefined, currency: fmtAnyDate(f.properties?.CURRENCY_DATE), amendment: f.properties?.AMENDMENT ? String(f.properties.AMENDMENT) : undefined, where });
  const layerStamp = (fc: SlidesBundle['zoning']): LepStamp | null => {
    const at = fc.features.find(contains);
    if (at) return stampOf(at, 'at the site');
    let best: GeoJSONFeature | undefined;
    for (const f of fc.features) if (!best || Number(f.properties?.CURRENCY_DATE ?? 0) > Number(best.properties?.CURRENCY_DATE ?? 0)) best = f;
    return best ? stampOf(best, 'in the window') : null;
  };
  const propStamp = (re: RegExp): LepStamp | null => {
    for (const h of b.property?.epi ?? []) if (re.test(h.layerName)) { const r = h.results?.[0] as Record<string, string> | undefined; if (r) return { epi: r['EPI Name'], currency: fmtAnyDate(r['Currency Date']), amendment: r['Amendment'], where: 'at the site' }; }
    return null;
  };
  const lepLine = (x: LepStamp | null, fallback: string) => (x ? `${x.epi ? shortEpi(x.epi) : 'LEP'}${x.currency ? `, map current ${x.currency}` : ''}${x.amendment ? ` (${x.amendment})` : ''}${x.where === 'in the window' ? ' — latest in the window' : ''}` : fallback);
  const n = (k: number, one: string, many = `${one}s`) => (k === 0 ? `no ${many}` : `${fmtNum(k)} ${k === 1 ? one : many}`);

  const groups: SourceGroup[] = [];

  // NSW Planning.
  const A: SourceRow[] = [];
  const zone = planning.zoneAtSite ? { epi: planning.zoneAtSite.epi, currency: fmtAnyDate(planning.zoneAtSite.currency), amendment: planning.zoneAtSite.amendment, where: 'at the site' as const } : layerStamp(b.zoning);
  A.push({ dataset: 'Land zoning map (EPI Primary Planning Layers)', used: '03 · 04 · 10 · 17', currency: lepLine(zone, 'no zone mapped at the site'), retrieved: deckDay, attribution: ATTR.dphi });
  A.push({ dataset: 'Height of buildings map', used: '03 · 04 · 08 · 17', currency: lepLine(layerStamp(b.hob) ?? propStamp(/Height of Building/i), 'no height of buildings map at the site'), retrieved: deckDay, attribution: ATTR.dphi });
  const fsr = propStamp(/Floor Space Ratio/i), lot = propStamp(/Lot Size/i);
  A.push({ dataset: 'Floor space ratio and minimum lot size maps', used: '04 · 11 · 17', currency: [fsr ? `FSR: ${lepLine(fsr, '')}` : 'no FSR map at the site', lot ? `lot size: ${lepLine(lot, '')}` : 'no lot size map at the site'].join('; '), retrieved: deckDay, attribution: ATTR.dphi });
  A.push({ dataset: 'Heritage map (items and conservation areas)', used: '03 · 04 · 17', currency: `${lepLine(layerStamp(b.heritage), 'no heritage map in the window')}; ${n(b.heritage.features.length, 'feature')} in the window`, retrieved: deckDay, attribution: ATTR.dphi });
  if (b.shr.features.length) A.push({ dataset: 'State Heritage Register curtilages (Heritage NSW)', used: '03 · 17', currency: `${n(b.shr.features.length, 'listing')} in the window; the register as published`, retrieved: deckDay, attribution: ATTR.heritage });
  const policySources = [...new Set(b.policy.map((a) => a.source))];
  A.push({ dataset: 'Housing-policy and precinct maps (TOD sites, accelerated precincts, town centres, SSD sites, planning precincts)', used: '03 · 07 · 17', currency: policySources.length ? `in the window: ${policySources.map((s) => s.replace(/^SEPP \(Housing\) 2021 — /, 'Housing SEPP: ').replace(/^SEPP \(Planning Systems\) 2021 — /, 'Planning Systems SEPP: ')).join('; ')}` : 'none of these maps reaches the window', retrieved: deckDay, attribution: ATTR.dphi });
  const afEpi = b.movement.activeFrontages.features[0]?.properties?.EPI_NAME as string | undefined;
  A.push({ dataset: 'Development control layers: DCP boundaries, contributions plans, active street frontages', used: '04 · 09 · 17', currency: [b.context.dcp ? b.context.dcp.name : 'no DCP mapped at the site', b.context.contributions.length ? n(b.context.contributions.length, 'contributions entry', 'contributions entries') : 'no contributions plan mapped', afEpi ? `active frontages of ${shortEpi(afEpi)}` : 'no active frontage in the window'].join('; '), retrieved: deckDay, attribution: ATTR.dphi });
  const withFeatures = b.constraints.layers.filter((l) => l.features.length);
  const lepStamps = [...new Set(withFeatures.flatMap((l) => l.features.filter((f) => f.epi && f.currency).map((f) => `${shortEpi(f.epi!)} (${fmtAnyDate(f.currency)})`)))];
  const stateLayers = withFeatures.map((l) => CONSTRAINT_DEFS.find((d) => d.id === l.id)).filter((d): d is (typeof CONSTRAINT_DEFS)[number] => Boolean(d && !d.epiBased)).map((d) => d.instrument ?? d.title);
  A.push({ dataset: 'Hazard, protection, coastal and corridor maps (21 layers: the plans\' own maps, RFS bushfire prone land, mine subsidence districts, the coastal and transport SEPPs)', used: '14 · 17', currency: `${n(b.constraints.layers.length, 'layer')} read, ${withFeatures.length} with features in the window${lepStamps.length ? `; LEP maps current ${[...new Set(lepStamps)].join(', ')}` : ''}${stateLayers.length ? `; State layers: ${[...new Set(stateLayers)].join(', ')}` : ''}${b.constraints.epiChecked ? `; absence checked plan-wide against ${shortEpi(b.constraints.epiChecked)}` : ''}`, retrieved: retrieved(b.constraints.fetchedAt), attribution: ATTR.dphi });
  A.push({ dataset: 'Greater Sydney tree canopy by modified mesh block', used: '10', currency: b.green.canopy.covered ? `${b.green.canopy.year} edition (${b.green.canopy.source.replace(/ \(NSW ePlanning\)/, '')})` : 'the Greater Sydney canopy dataset does not reach this site', retrieved: retrieved(b.green.fetchedAt), attribution: ATTR.dphi });
  A.push({ dataset: 'Public spaces: Green Grid assets, open-space and public-facility points', used: '10 · 17', currency: `${n(b.green.greenGrid.length, 'Green Grid asset')}, ${n(b.green.parkPoints.length, 'open-space point')}, ${n(b.green.facilities.filter((f) => f.source === 'eplanning').length, 'facility point')} in the window; as published`, retrieved: retrieved(b.green.fetchedAt), attribution: ATTR.dphi });
  const pl = b.site.publicLand;
  A.push({ dataset: 'Government land: State land (GPI), Crown land and Crown reserves', used: '11', currency: pl.length ? `${n(pl.filter((x) => x.kind === 'state').length, 'State parcel')}, ${n(pl.filter((x) => x.kind === 'crown').length, 'Crown land parcel')}, ${n(pl.filter((x) => x.kind === 'reserve').length, 'Crown reserve')} in the block; as published` : 'none in the block', retrieved: retrieved(b.site.fetchedAt), attribution: ATTR.dphi });
  A.push({ dataset: 'Planning proposals (public exhibition layer)', used: '07', currency: b.proposals.length ? `${n(b.proposals.length, 'proposal')} on exhibition in the window` : 'none on exhibition in the window', retrieved: deckDay, attribution: ATTR.dphi });
  A.push({ dataset: 'Planning Portal property report API (the layers at the geocoded point)', used: '04 · 14', currency: b.property ? `${n(b.property.epi.length + b.property.sepp.length, 'layer hit')} at the point; the maps\' own currency dates` : 'did not answer for this run', retrieved: deckDay, attribution: ATTR.portal });
  const mpr = b.majorProjects;
  A.push({ dataset: 'Major Projects register: State significant development and infrastructure (listing and project pages)', used: '07 · 17', currency: mpr?.ok ? `${mpr.lgas.map((l) => `${l.name} ${fmtNum(l.listed)}`).join(', ')} listed; ${n(mpr.read, 'project page')} read, ${n(mpr.located, 'point')}; the register's stages as shown on the day` : (mpr?.note ?? 'not read for this run'), retrieved: retrieved(mpr?.fetchedAt), attribution: ATTR.portal });
  A.push({ dataset: 'Online DA API (development applications lodged through the portal)', used: '07 · 17', currency: b.daMeta ? `${b.daMeta.council}: ${n(b.daMeta.total, 'application')} lodged ${fmtIso(b.daMeta.from)} to ${fmtIso(b.daMeta.to)}${b.daMeta.complete ? '' : ' (feed incomplete)'}` : 'not read for this run', retrieved: retrieved(b.daMeta?.fetchedAt), attribution: ATTR.portal });
  A.push({ dataset: 'Council housing target (department snapshot page)', used: '04', currency: b.housingTarget ? `${fmtNum(b.housingTarget.homes)} new homes by ${b.housingTarget.by}` : 'no snapshot page found for this council', retrieved: deckDay, attribution: ATTR.dphi });
  const sg = b.strategies;
  A.push({ dataset: 'Planning regions layer (Administrative Boundary service) and the plans-by-region pages', used: '01 · 05', currency: sg.region.ok ? `${sg.region.name ?? 'no region'} at the site${sg.region.plan ? ` → ${sg.region.plan.name}` : ''}` : 'the regions layer did not answer', retrieved: retrieved(sg.fetchedAt), attribution: ATTR.dphi });
  A.push({ dataset: 'The Sydney Plan (2026) and the NSW Centres Framework: the centres and their types, transcribed', used: '01', currency: `version 1.0, commenced 13 Aug 2026; ${n(CENTRES.length, 'centre')} of the plan's first three types with a point each`, retrieved: 'transcribed at build', attribution: ATTR.dphi });
  A.push({ dataset: 'Planning Portal index of local strategic planning statements', used: '05', currency: sg.lsps.ok ? `${n(sg.lsps.indexed, 'statement')} listed; ${sg.lsps.entry ? `${sg.lsps.entry.title}` : 'none matched the council'}` : `did not answer${sg.lsps.note ? ` (${sg.lsps.note})` : ''}`, retrieved: retrieved(sg.fetchedAt), attribution: ATTR.portal });
  groups.push({ publisher: 'NSW Department of Planning, Housing and Infrastructure — ePlanning spatial services and the Planning Portal', rows: A });

  // NSW Spatial Services.
  const B: SourceRow[] = [];
  B.push({ dataset: 'Geocoded addressing theme (the site point)', used: 'all', currency: `matched ${b.geocode.matchedAddresses.slice(0, 2).map((a) => titleCase(a)).join('; ')}${b.geocode.points.length > 1 ? ` (${b.geocode.points.length} address points)` : ''}`, retrieved: deckDay, attribution: ATTR.spatial });
  B.push({ dataset: 'Land parcel and property theme: lots, plan lot areas, easement geometry', used: 'all maps · 11', currency: `${b.lotDescription}; ${n(b.base.lots.features.length, 'lot')} in the window; ${n(b.site.easements.length, 'easement')} in the site plan\'s window; current at retrieval`, retrieved: deckDay, attribution: ATTR.spatial });
  B.push({ dataset: 'Transport theme: roads by function, railways, stations', used: 'all maps · 01 · 09 · 13 · 17', currency: `${n(b.base.roads.length, 'road segment')}, ${n(b.base.rail.train.length + b.base.rail.tram.length, 'rail line')}, ${n(b.base.stations.length, 'station')} in the window; current at retrieval`, retrieved: deckDay, attribution: ATTR.spatial });
  B.push({ dataset: 'Water theme: water bodies, coastline, watercourses, hydro names', used: 'all maps · 01 · 13 · 15', currency: `${n(b.base.water.features.length, 'water feature')} in the window; ${n(b.country.water.courses.length, 'watercourse line')} over the strip; current at retrieval`, retrieved: deckDay, attribution: ATTR.spatial });
  B.push({ dataset: 'Administrative boundaries: LGA, suburb, Local Aboriginal Land Council areas, district', used: '01 · 04 · 09 · 15 · 16', currency: [b.context.lga?.name ? titleCase(b.context.lga.name) : '', b.context.suburb?.name ? titleCase(b.context.suburb.name) : '', b.context.lalc?.local ? `${titleCase(b.context.lalc.local)} LALC` : '', b.context.district ? `${b.context.district} district` : ''].filter(Boolean).join(', ') || 'not resolved', retrieved: deckDay, attribution: ATTR.spatial });
  const foi = b.green.facilities.filter((f) => f.source === 'foi').length;
  B.push({ dataset: 'Features of interest: complexes and parks', used: '10', currency: `${n(foi, 'facility', 'facilities')} from the complexes layer; park names`, retrieved: retrieved(b.green.fetchedAt), attribution: ATTR.spatial });
  const dem = b.terrain.dem;
  B.push({ dataset: 'NSW 5 m elevation model (image service)', used: '06 · 08 · 11 · 13 · 15 · 17', currency: dem ? `${dem.source}; ${fmtNum(dem.cols)} × ${fmtNum(dem.rows)} cells over the tall panel${b.country.dem ? `, a second grid at 8 m over the strip for the crests` : ''}` : 'not read for this run', retrieved: deckDay, attribution: ATTR.spatial });
  if (!/City of Sydney/i.test(b.terrain.contourSource ?? '')) B.push({ dataset: 'Contours', used: '06', currency: b.terrain.contours.length ? `${b.terrain.contourSource ?? 'NSW contours'}${b.terrain.contourIntervalM ? `, ${b.terrain.contourIntervalM} m interval` : ''}; ${n(b.terrain.contours.length, 'line')} in the window` : 'none in the window', retrieved: deckDay, attribution: ATTR.spatial });
  const img = b.site.imagery;
  B.push({ dataset: 'NSW Imagery (aerial) and the imagery-dates layer (SIX Maps)', used: '02 · 11 · 12', currency: img ? `${titleCase(img.block)} block${img.date ? `, captured ${fmtIso(img.date)}` : ''}${img.resolutionCm ? `, ${img.resolutionCm} cm` : ''}` : b.site.aerial ? 'capture date not published for this block' : 'no aerial for this run', retrieved: retrieved(b.site.fetchedAt), attribution: ATTR.spatial });
  const then = b.photos.pair.then;
  B.push({ dataset: 'Historical Imagery 1943: the Sydney aerial survey as a tile service', used: '12', currency: then.tiles.length ? `1943 survey; ${n(then.tiles.length, 'tile')} at level ${then.zoom} over the pair's panel${then.missing ? `, ${n(then.missing, 'tile')} missing` : ''}` : 'no tile at this site (the survey covers the Sydney region)', retrieved: retrieved(b.photos.fetchedAt), attribution: ATTR.spatial });
  groups.push({ publisher: 'NSW Spatial Services (Department of Customer Service) — Spatial Collaboration Portal and SIX Maps', rows: B });

  // Other State agencies.
  const C: SourceRow[] = [];
  const lv = b.people?.landValues;
  const vals = lv ? [...lv.values].sort((x, y) => x.year - y.year) : [];
  C.push({ dataset: 'Valuer General: land values of the property and the property sales register', used: '11 · 16 · 17', currency: [lv && vals.length ? `${n(vals.length, 'land value')}, base dates ${vals[0].baseDate} to ${vals[vals.length - 1].baseDate}` : 'no land value at the point', b.people ? `${n(b.people.sales.length, 'sale')} within ${b.people.salesRadiusM} m` : 'sales not read'].join('; '), retrieved: retrieved(b.people?.fetchedAt), attribution: ATTR.vg });
  C.push({ dataset: 'Transport for NSW: bus stops (Trip Planner API) and Travel Zone Projections 2024', used: '09 · 16', currency: [b.movement.busStopSource === 'tfnsw' ? `${n(b.movement.busStops.length, 'bus stop')} in the window` : b.movement.busStopSource === 'osm' ? 'the Transport for NSW key was not set, so the stops came from OpenStreetMap' : 'bus stops: neither Transport for NSW nor OpenStreetMap answered', b.people?.tzp24 ? `${b.people.tzp24.source}, to 2066` : 'projections not read'].join('; '), retrieved: retrieved(b.movement.fetchedAt), attribution: ATTR.tfnsw });
  C.push({ dataset: 'Department of Education: government schools master dataset (locations and enrolments)', used: '16', currency: b.people ? `${n(b.people.schools.length, 'government school')} within ${b.people.schoolsRadiusM / 1000} km; latest enrolment year in the dataset` : 'not read', retrieved: retrieved(b.people?.fetchedAt), attribution: ATTR.education });
  C.push({ dataset: 'National Parks and Wildlife Service estate (managed land)', used: '10 · 17', currency: b.green.npws.length ? `${n(b.green.npws.length, 'reserve')} in the window` : 'no reserve in the window', retrieved: retrieved(b.green.fetchedAt), attribution: ATTR.dcceew });
  const co = b.country;
  const lepAb = co.lepAboriginal;
  const lepAreas = co.lepAboriginalAreas;
  C.push({ dataset: 'LEP maps: the heritage maps\' Aboriginal objects, places, items and conservation areas (EPI Primary Planning Layers), and the Aboriginal Cultural Significance and Sensitive Aboriginal Landscape maps (Local Provisions)', used: '15 · 17', currency: [!lepAb ? 'items not read for this deck' : lepAb.ok ? (lepAb.items.length ? `${n(lepAb.items.length, 'item')} scheduled in the strip (${[...new Set(lepAb.items.map((i) => shortEpi(i.epi)))].join(', ')})` : 'no item scheduled in the strip') : 'the heritage maps did not answer for this run',
    !lepAreas ? '' : lepAreas.ok ? (lepAreas.areas.length ? lepAreas.areas.map((a) => `${a.map} of the ${shortEpi(a.epi)}${a.currency ? `, current ${fmtIso(a.currency)}` : ''}`).join('; ') : 'no landscape map over the strip (only the Moree Plains and Lake Macquarie plans have one)') : 'the landscape maps did not answer for this run'].filter(Boolean).join('; '), retrieved: retrieved(co.fetchedAt), attribution: ATTR.dphi });
  C.push({ dataset: 'Heritage NSW: gazetted Aboriginal Places (via the State heritage service)', used: '15 · 17', currency: co.placesOk ? `${n(co.places.length, 'place')} within ${co.placesRadiusM / 1000} km; the register as published, locations generalised where restricted` : 'did not answer for this run', retrieved: retrieved(co.fetchedAt), attribution: ATTR.heritage });
  const ahips = co.ahips;
  if (ahips) C.push({ dataset: 'Heritage NSW: Aboriginal Heritage Impact Permit boundaries (permits under the National Parks and Wildlife Act 1974)', used: '15 · 17', currency: ahips.ok ? `${n(ahips.permits.length, 'permit')} over the strip${ahips.permits.length ? `, ${ahips.permits.filter((q) => q.status === 'ACTIVE' && (!q.expires || q.expires >= b.generatedAt.slice(0, 10))).length} active` : ''}; the layer leaves out permits whose boundaries were poor or missing, which the AHIP public register lists` : 'did not answer for this run', retrieved: retrieved(co.fetchedAt), attribution: ATTR.ahip });
  C.push({ dataset: 'State Vegetation Type Map: pre-1750 plant community types (5 m)', used: '15', currency: co.vegetation.ok ? `${co.vegetation.atSite ? `${co.vegetation.atSite.pct} at the site; ` : ''}${n(co.vegetation.classes.length, 'community', 'communities')} read across the strip` : 'did not answer for this run', retrieved: retrieved(co.fetchedAt), attribution: ATTR.dcceew });
  C.push({ dataset: 'Aboriginal Sites Decision Support Tool (ASDST v7.5, 2020): likelihood and survey-priority models', used: '15 · 17', currency: co.asdst.ok ? `model of 2020, read at the site (${co.asdst.likelihood ?? '—'} of ${co.asdst.scaleMax}); AHIMS itself is not open and not read` : 'did not answer for this run', retrieved: retrieved(co.fetchedAt), attribution: ATTR.dcceew });
  C.push({ dataset: 'Soil landscapes (eSPADE), Sydney 1:100,000 sheet', used: '14', currency: b.constraints.soil ? `${titleCase(b.constraints.soil.name)} landscape at the site (${b.constraints.soil.sheet} sheet)` : (b.constraints.soilNote ?? 'the site lies outside the published sheet'), retrieved: retrieved(b.constraints.fetchedAt), attribution: ATTR.dcceew });
  groups.push({ publisher: 'Other NSW agencies', rows: C });

  // Commonwealth.
  const D: SourceRow[] = [];
  const p = b.people;
  D.push({ dataset: 'ABS Census of Population and Housing 2021 (tables G01, G02, G36, G37, G62)', used: '16', currency: p ? `${[p.sa2 ? `SA2 ${p.sa2.name}` : '', p.lga ? `LGA ${p.lga.name}` : '', p.benchmark ? p.benchmark.name : ''].filter(Boolean).join(', ')}; census night 10 August 2021` : 'not read', retrieved: retrieved(p?.fetchedAt), attribution: ATTR.abs });
  const erpYears = p?.erpSa2.length ? `${p.erpSa2[0].year}–${p.erpSa2[p.erpSa2.length - 1].year}` : '';
  D.push({ dataset: 'ABS estimated resident population (annual), SEIFA 2021 and ASGS 2021 boundaries', used: '16', currency: p ? `${erpYears ? `population ${erpYears}` : 'no population series'}; SEIFA 2021 ${p.seifaSa2 ? 'read' : 'not read'}; regions ${[p.regions.sa2?.name, p.regions.lga?.name, p.regions.gccsa?.name].filter(Boolean).join(', ')}` : 'not read', retrieved: retrieved(p?.fetchedAt), attribution: ATTR.abs });
  D.push({ dataset: 'National Native Title Tribunal registers: determinations, registered claims, Indigenous land use agreements', used: '15 · 17', currency: co.nativeTitle.ok ? `${n(co.nativeTitle.atSite.length, 'record')} over the site; in the strip ${co.nativeTitle.inWindow.determinations} determination, ${co.nativeTitle.inWindow.claims} claim, ${co.nativeTitle.inWindow.iluas} ILUA${co.nativeTitle.currency ? `; registers current ${fmtIso(co.nativeTitle.currency)}` : ''}` : 'did not answer for this run', retrieved: retrieved(co.fetchedAt), attribution: '© Commonwealth of Australia (National Native Title Tribunal) · CC BY 4.0' });
  const lists = co.heritageLists;
  if (lists) {
    const nat = lists.places.filter((q) => q.list !== 'RNE'), rne = lists.places.filter((q) => q.list === 'RNE');
    const silent = [!lists.read.nhl ? 'the National Heritage List' : '', !lists.read.chl ? 'the Commonwealth Heritage List' : '', !lists.read.rne ? 'the RNE' : ''].filter(Boolean);
    D.push({ dataset: 'National and Commonwealth Heritage Lists, and the Register of the National Estate (closed in 2007, an archive): Indigenous places', used: '15 · 17', currency: [nat.length ? nat.map((q) => `${q.name} (${q.list}, ${/^nominated/i.test(q.status) ? 'nominated, not listed' : q.status.toLowerCase()}${q.coversStrip ? ', over the whole strip' : ''})`).join('; ') : 'no Indigenous place of the two lists in the strip', `${n(rne.length, 'RNE place')} in the strip`, silent.length ? `${listWords(silent)} did not answer for this run` : ''].filter(Boolean).join('; '), retrieved: retrieved(co.fetchedAt), attribution: ATTR.lists });
  }
  groups.push({ publisher: `Commonwealth — Australian Bureau of Statistics, the National Native Title Tribunal${lists ? ' and the Department of Climate Change, Energy, the Environment and Water' : ''}`, rows: D });

  // Councils.
  const E: SourceRow[] = [];
  if (b.cos) E.push({ dataset: 'City of Sydney open data: Sydney DCP 2012 layers (storeys, frontage heights, active frontages, setbacks)', used: '04', currency: `${b.cos.dcpNames.length ? b.cos.dcpNames.slice(0, 3).join(', ') + (b.cos.dcpNames.length > 3 ? ` and ${b.cos.dcpNames.length - 3} more` : '') : b.cos.source}; as published`, retrieved: deckDay, attribution: '© City of Sydney · CC BY 4.0' });
  if (/City of Sydney/i.test(b.terrain.contourSource ?? '')) E.push({ dataset: 'City of Sydney contours', used: '06', currency: `${b.terrain.contourSource}${b.terrain.contourIntervalM ? `, ${b.terrain.contourIntervalM} m interval` : ''}; ${n(b.terrain.contours.length, 'line')} in the window`, retrieved: deckDay, attribution: (b.terrain.contourAttribution ?? '© City of Sydney · CC BY 4.0').replace(/^Contours /, '').replace(/,\s*CC BY/, ' · CC BY') });
  if (b.green.trees.source) E.push({ dataset: b.green.trees.source.name, used: '10 · 17', currency: `${n(b.green.trees.points.length, 'tree')} in the window, with canopy widths`, retrieved: retrieved(b.green.fetchedAt), attribution: /CC BY/i.test(b.green.trees.source.attribution) ? b.green.trees.source.attribution.replace(/^Trees /, '').replace(/,\s*CC BY/, ' · CC BY') : `${b.green.trees.source.attribution.replace(/^Trees /, '')} · CC BY 4.0` });
  if (E.length) groups.push({ publisher: 'Councils', rows: E });

  // Open and community data.
  const F: SourceRow[] = [];
  F.push({ dataset: b.buildings.source === 'overture' ? 'Overture Maps Foundation buildings (footprints, heights and storeys)' : b.buildings.source === 'osm' ? 'OpenStreetMap buildings via Overpass (Overture was not available)' : 'Building footprints', used: '08 · 11 · 12 · 13 · 17', currency: b.buildings.source === 'none' ? (b.buildings.note ?? 'none read') : `${b.buildings.source === 'overture' ? `release ${b.buildings.release ?? 'unknown'}; ` : ''}${n(b.buildings.buildings.length, 'footprint')} in the window, ${n(b.buildings.buildings.filter((x) => x.estimatedHeightM).length, 'height')}${b.buildings.buildings.some((x) => x.heightFrom === 'da') ? `, ${b.buildings.buildings.filter((x) => x.heightFrom === 'da').length} of them the storeys of a determined DA on the lot (Online DA API)` : ''}`, retrieved: retrieved(b.buildings.fetchedAt), attribution: b.buildings.source === 'overture' ? ATTR.overture : b.buildings.source === 'osm' ? ATTR.osm : ATTR.none });
  F.push({ dataset: 'OpenStreetMap via Overpass: bus routes, cycleways, footways, one-way streets', used: '09 · 10', currency: b.movement.osm ? `read; ${n(b.movement.cycleways.length, 'cycleway')}, ${n(b.movement.footways.length, 'footway')}, ${n(b.movement.busRoutes.length, 'bus route')} in the window` : 'not available at retrieval (the Overpass mirror did not answer), so slide 09 shows the State layers only', retrieved: retrieved(b.movement.fetchedAt), attribution: ATTR.osm });
  F.push({ dataset: 'Valhalla walking isochrones on the OpenStreetMap network', used: '09 · 10 · 17', currency: b.movement.isochrones.length ? `${b.movement.isochrones.map((i) => i.minutes).sort((x, y) => x - y).join(', ')} minutes from the site; the network as the instance holds it` : 'not answered for this run', retrieved: retrieved(b.movement.fetchedAt), attribution: ATTR.valhalla });
  const ch = b.character;
  F.push({ dataset: 'Wikipedia: the suburb\'s article and the articles placed within 1.5 km', used: '02', currency: ch.wikipedia.ok ? `"${ch.wikipedia.summary!.title}"; ${n(ch.places.items.length, 'place')} with articles within ${ch.places.radiusM / 1000} km` : `no article read${ch.wikipedia.note ? ` (${ch.wikipedia.note})` : ''}`, retrieved: retrieved(ch.fetchedAt), attribution: ATTR.wikipedia });
  F.push({ dataset: 'Wikimedia Commons: geotagged photographs within 800 m, with author and licence', used: '02', currency: ch.photos.ok ? `${n(ch.photos.candidates, 'usable photograph')}, ${n(ch.photos.items.length, 'photograph')} shown` : `did not answer${ch.photos.note ? ` (${ch.photos.note})` : ''}`, retrieved: retrieved(ch.fetchedAt), attribution: ATTR.commons });
  const kv = b.photos.kartaview, mly = b.photos.mapillary;
  const kvPhotos = b.photos.photos.filter((p) => p.source === 'kartaview'), mlyPhotos = b.photos.photos.filter((p) => p.source === 'mapillary');
  // Street View dates its panoramas to the month, which prints as the month
  const frameDay = (d: string) => (d.length === 7 ? fmtIso(d).replace(/^\d+ /, '') : fmtIso(d));
  const frameDates = (ps: typeof kvPhotos) => { const ds = ps.map((p) => p.date).filter((d): d is string => Boolean(d)).sort(); return ds.length ? (ds[0].slice(0, 7) === ds[ds.length - 1].slice(0, 7) ? `taken ${fmtIso(ds[0]).replace(/^\d+ /, '')}` : `taken ${frameDay(ds[0])} to ${frameDay(ds[ds.length - 1])}`) : 'undated'; };
  F.push({ dataset: 'KartaView street-level frames (nearby-photos listing and thumbnails)', used: '12', currency: kv.ok ? `${n(kv.frames, 'frame')} within ${b.photos.radiusM} m, ${n(kv.withHeading, 'frame')} with a recorded heading; ${kvPhotos.length ? `${n(kvPhotos.length, 'frame')} shown, ${frameDates(kvPhotos)}` : 'none faces the site'}` : `did not answer for this run${kv.note ? ` (${kv.note})` : ''}`, retrieved: retrieved(b.photos.fetchedAt), attribution: ATTR.kartaview });
  if (mly.ok) F.push({ dataset: 'Mapillary street-level frames (Graph API images)', used: '12', currency: `${n(mly.frames, 'frame')} within ${b.photos.radiusM} m; ${mlyPhotos.length ? `${n(mlyPhotos.length, 'frame')} shown, ${frameDates(mlyPhotos)}` : 'none faces the site'}`, retrieved: retrieved(b.photos.fetchedAt), attribution: ATTR.mapillary });
  const wnd = b.wind;
  if (wnd) F.push({ dataset: 'NASA POWER hourly wind at 10 m (the MERRA-2 reanalysis)', used: '13', currency: wnd.ok ? `${wnd.years[0]}–${wnd.years[1]}, ${fmtNum(wnd.annual.hours)} hours for the cell over the site (0.5° × 0.625°)` : `did not answer for this run${wnd.note ? ` (${wnd.note})` : ''}`, retrieved: retrieved(wnd.fetchedAt), attribution: ATTR.nasa });
  groups.push({ publisher: 'Open and community data', rows: F });

  // Google Street View, where it was read or tried: a licence, not open data, so a group of its own.
  const gsv = b.photos.google, gsvPhotos = b.photos.photos.filter((p) => p.source === 'google');
  if (gsv && (gsv.ok || (gsv.note && !/^not read/.test(gsv.note)))) {
    const why = (gsv.note ?? '').replace(/^Street View metadata answered /, '').split('. ')[0];
    groups.push({ publisher: 'Google Maps Platform', rows: [{ dataset: 'Google Street View Static API: the panoramas in front of the site (metadata) and a frame of each', used: '12', currency: gsv.ok ? `${n(gsv.frontages, 'side')} of the site's ${fmtNum(gsv.sides)} with a panorama in front; ${gsvPhotos.length ? `${n(gsvPhotos.length, 'frame')} shown, ${frameDates(gsvPhotos)}` : 'no frame shown'}` : `did not answer for this run${why ? ` (${why})` : ''}`, retrieved: retrieved(b.photos.fetchedAt), attribution: ATTR.google }] });
  }

  // Computed.
  groups.push({ publisher: 'Computed by the tool, not sourced', rows: [
    { dataset: 'Solar geometry (NOAA), the neighbours\' shadows, sight lines over the elevation model, street bearings, boundary lengths, corner levels, walking bands and the statements of slide 17', used: '06 · 11 · 13 · 17', currency: 'derived from the layers above at generation; methods in each slide\'s notes', retrieved: deckDay, attribution: ATTR.none },
  ] });

  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  const cached = [
    b.buildings.fetchedAt && day(b.buildings.fetchedAt) !== deckDay ? `the building footprints (${fmtIso(day(b.buildings.fetchedAt))})` : '',
    b.daMeta?.fetchedAt && day(b.daMeta.fetchedAt) !== deckDay ? `the development feed (${fmtIso(day(b.daMeta.fetchedAt))})` : '',
    b.people?.fetchedAt && day(b.people.fetchedAt) !== deckDay ? `the census and population tables (${fmtIso(day(b.people.fetchedAt))})` : '',
  ].filter(Boolean);
  const dates = [
    img?.date ? `the aerial was flown ${fmtIso(img.date)}` : '',
    'the census is 2021',
    b.green.canopy.covered ? `the canopy ${b.green.canopy.year}` : '',
    zone?.currency ? `the ${zone.epi ? shortEpi(zone.epi) : 'LEP'} zoning map is current at ${zone.currency}` : '',
    vals.length ? `the land value at ${vals[vals.length - 1].baseDate}` : '',
    b.daMeta ? `the development feed runs to ${fmtIso(b.daMeta.to)}` : '',
    b.buildings.release ? `the footprints are Overture's ${b.buildings.release} release` : '',
  ].filter(Boolean);
  return { total, publishers: groups.length, deckDay, groups, cached, dates, warnings: b.warnings.map((w) => w.replace(/^WARN\s*/, '').replace(/ -> /g, ' returned ')) };
}

export function sourcesSentences(b: SlidesBundle, f: ReturnType<typeof sourcesFacts>): string[] {
  const out: string[] = [];
  out.push(`${f.total} datasets from ${f.publishers} publishers went into this deck, read on ${fmtIso(f.deckDay)}${f.cached.length ? `; ${listWords(f.cached)} came from the volume's cache` : ''}.`);
  if (f.dates.length) out.push(`Each layer carries its own date: ${f.dates.join('; ')}.`);
  out.push('Computed in the tool rather than sourced: the solar geometry and the neighbours\' shadows, the sight lines over the elevation model, the street bearings, the boundary lengths and corner levels from the cadastre and the model, and the walking bands from Valhalla; each is described where it appears.');
  out.push('Still to obtain outside the open data: the survey, the title search (and the easements\' purposes), geotechnical and contamination reports, an acoustic assessment, the council\'s flood study, the airports\' ANEF contours and the site visit.');
  if (f.warnings.length) out.push(`This run logged ${f.warnings.length === 1 ? 'one warning' : `${f.warnings.length} warnings`}: ${f.warnings.join('; ')}.`);
  out.push(`Attribution is as each publisher asks and the licences are as stated at retrieval, mostly Creative Commons Attribution 4.0 for State and Commonwealth data and the Open Database Licence for OpenStreetMap and the footprints derived from it${b.photos.photos.some((p) => p.source === 'google') ? '; the Street View frames are Google\'s, shown under the Google Maps Platform terms for this electronic deck only' : ''}; confirm before republishing.`);
  return out;
}

/** Sources on the template: the publishers charted on the left, every dataset listed on the right in 6 pt rows. */
export function sourcesAtlas(b: SlidesBundle, planning: PlanningFacts): Slide {
  const f = sourcesFacts(b, planning);
  const groups = [...f.groups].sort((x, y) => y.rows.length - x.rows.length);
  const rows = groups.slice(0, 12).map((g) => ({ name: shorten(g.publisher, 40), value: g.rows.length, label: String(g.rows.length), fill: { bg: '#878787' } as Fill }));
  const ax = niceAxis(Math.max(1, ...rows.map((r) => r.value)));
  const figs = zFigures([['datasets', fmtNum(f.total)], ['publishers', fmtNum(f.publishers)]], [['read on', f.deckDay], ['every value with its retrieval', 'overall.json, beside the PDF']], 9.6);
  const blocks = [zBlock('The deck', figs, 'Its record'), zBlock('Datasets by publisher', zBars(rows, ax.max, ax.step))];
  // the right page: one 6 pt row a dataset, grouped by publisher, until the page is full
  const TOP = 18, BOTTOM = 297 - 12, GAP = 3.2;
  const nRows = f.groups.reduce((a, g) => a + g.rows.length, 0);
  // the rows open up to fill the page, between 2.9 and 4.6 mm
  const ROW = Math.max(2.9, Math.min(4.6, (BOTTOM - TOP - f.groups.length * (GAP + 4)) / Math.max(1, nRows)));
  let y = TOP, shown = 0;
  const lines: string[] = [];
  const cell = (x: number, w: number, text: string, grey = false) => `<div style="position:absolute;left:${x}mm;width:${w}mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${grey ? 'color:#878787;' : ''}">${esc(text)}</div>`;
  for (const g of f.groups) {
    if (y + ROW * 2 > BOTTOM) break;
    lines.push(`<div class="abs" style="left:${FOLD + 12}mm;top:${(y + 1.2).toFixed(2)}mm;width:186mm;height:2.9mm;font-size:6pt;letter-spacing:0.09em;text-transform:uppercase;border-bottom:0.18mm solid #878787;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.publisher)}</div>`);
    y += 2.9 + 2.2;
    for (const r of g.rows) {
      if (y + ROW > BOTTOM) break;
      lines.push(`<div class="abs" style="left:${FOLD + 12}mm;top:${y.toFixed(2)}mm;width:186mm;height:${ROW}mm;font-size:6pt;line-height:${ROW}mm;letter-spacing:0.04em">${cell(0, 78, r.dataset)}${cell(80, 22, r.used)}${cell(104, 60, r.currency, true)}${cell(166, 20, r.retrieved, true)}</div>`);
      y += ROW; shown++;
    }
    y += GAP;
  }
  const head = `<div class="abs zh" style="left:${FOLD + 12}mm;top:10mm;width:186mm"><span>Dataset</span><span style="left:80mm">Slides</span><span style="left:104mm">Currency or edition</span><span style="left:166mm">Retrieved</span></div>`;
  const more = f.total - shown;
  const note = more > 0 ? `<div class="abs zsrc" style="left:${FOLD + 12}mm;bottom:6mm;width:186mm">${more === 1 ? 'One more dataset' : `${more} more datasets`}, and every attribution and licence, in the deck's JSON (overall.json).</div>` : '';
  const sources = `Generated from the deck's JSON, which carries every value with its retrieval time. Currency is the publisher's map or edition date where the layer states one; retrieved is when the deck read the service or its cache was filled. Attributions and licences are listed there in full.`;
  const sub = atlasSub(b, `${f.total} datasets`, `${f.publishers} publishers`, `retrieved ${f.deckDay}`);
  return { id: '18_sources', title: 'Sources', subtitle: sub, textHtml: '', figureHtml: zFlow(blocks) + head + lines.join('') + note, full: true, sources, accent: '#000000',
    narrative: `${capFirst(numWord(f.total))} datasets from ${numWord(f.publishers)} publishers, read on ${f.deckDay}. Every value in the deck carries its source and the time it was read in overall.json, beside the PDF.` };
}

export function sourcesSlide(b: SlidesBundle, planning: PlanningFacts): Slide {
  const f = sourcesFacts(b, planning);
  const sentences = sourcesSentences(b, f);
  const text = sentences.map((s) => `<p>${esc(s)}</p>`).join('') +
    placeholder('Narrative — for the author: what was obtained outside the open data (the survey, the title, the reports) and its dates, and any dataset replaced by a better one.') +
    `<div class="fine">Generated from the deck's JSON (overall.json), which carries every value with its retrieval time. Currency is the publisher's map or edition date where the layer states one; retrieved is when this deck read the service, or when its cache was filled. Slide numbers are those of the specification.</div>`;
  const rows = f.groups.map((g) => `<tr class="grp"><td colspan="5">${esc(g.publisher)}</td></tr>` + g.rows.map((r) => `<tr><td>${esc(r.dataset)}</td><td class="used">${esc(r.used)}</td><td>${esc(r.currency)}</td><td class="ret">${esc(r.retrieved)}</td><td class="attr">${esc(r.attribution)}</td></tr>`).join('')).join('');
  const table = `<table class="da src"><thead><tr><th style="width:68mm">Dataset</th><th style="width:26mm">Used on slides</th><th style="width:86mm">Currency or edition</th><th style="width:22mm">Retrieved</th><th>Attribution and licence</th></tr></thead><tbody>${rows}</tbody></table>`;
  // data-fit: the printer steps the table's type down until the last row is inside the box, and past its smallest
  // shows the note under the rows that fit, counting the ones left out
  const figure = `<div class="abs" data-fit data-fit-note="src-more" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm;height:${SLIDE_H - FIELD_Y - 12}mm;overflow:hidden">${table}</div>
    <div class="abs" id="src-more" hidden data-text="{n} more datasets did not fit on this slide; the deck's JSON (overall.json) lists every one, with its currency, retrieval and attribution." style="left:${FIELD_X}mm;width:${FIELD_W}mm;font-size:2.1mm;line-height:1.3;color:#6a7572"></div>`;
  const sub = [b.siteAddress, `${f.total} datasets`, `${f.publishers} publishers`, `retrieved ${f.deckDay}`].join(' · ');
  return { id: '18_sources', title: 'Sources', subtitle: sub, textHtml: text, figureHtml: figure };
}

// ---- slide 15: Country -------------------------------------------------------

const RIDGE_COLOUR = '#8a6a3c';
const PLACE_COLOUR = '#b5703a';
/** The ePlanning heritage map's own colour for Aboriginal heritage, with a darker edge. */
const LEP_ABORIGINAL_FILL = '#e3b53a', LEP_ABORIGINAL_EDGE = '#8a6a3c';
/** The LEP maps of Aboriginal cultural landscapes, hatched: the Sensitive Aboriginal Landscape Map in a darker shade of ePlanning's green, the Aboriginal Cultural Significance Map in the heritage edge colour. */
const LEP_LANDSCAPE_COLOUR = (map: string) => (/sensitive/i.test(map) ? '#00866a' : LEP_ABORIGINAL_EDGE);
const AHIP_COLOUR = '#7c4a9e';
/** How many impact permits carry their number on a map: the nearest few, the legend counting the rest. */
const AHIP_NAMED = 8;
const LIST_COLOUR = '#9e2b27', RNE_COLOUR = '#737c77';
const LIST_WORD: Record<string, string> = { NHL: 'National Heritage List', CHL: 'Commonwealth Heritage List', RNE: 'Register of the National Estate' };
/** A list's status in words: whether the place is listed, only nominated, or, on the archived register, how far it got. */
/** Where a permit, a listed place or a mapped landscape lies from the site: over it, at its edge (a boundary drawn along the lot's), or how far and which way. */
const besideWords = (q: { onSite: boolean; distanceM: number; bearing: number }, over = 'over the site') => {
  if (q.onSite) return over;
  if (q.distanceM <= 3) return "at the site's edge";
  return `${q.distanceM >= 1000 ? `${(q.distanceM / 1000).toFixed(1)} km` : `${fmtNum(q.distanceM)} m`} to the ${compassWord(q.bearing)}`;
};
/** Text cut at a word to at most `max` characters, with an ellipsis where it was cut. */
const clipWords = (str: string, max: number) => (str.length > max ? `${str.slice(0, max).replace(/[\s,;:–-]+\S*$/, '')}…` : str);
/** A permit's state in words: active to its expiry, expired, or as the register has it. */
const permitState = (p: { active: boolean; status: string; expires?: string }) =>
  p.active ? (p.expires ? `active to ${fmtMonthYear(p.expires)}` : 'active') : p.status === 'EXPIRED' || p.status === 'ACTIVE' ? (p.expires ? `expired ${fmtMonthYear(p.expires)}` : 'expired') : p.status.toLowerCase();
const listStatus = (list: string, status: string) => {
  const s = status.toLowerCase();
  if (list === 'RNE') return s.startsWith('indicative') ? 'indicative place, never assessed' : s.startsWith('interim') ? 'on the interim list' : 'registered';
  return s.startsWith('nominated') ? 'nominated, not listed' : s.startsWith('within') ? 'within a listed place' : 'listed';
};
const CREEK_COLOUR = '#3e7e9c';
const NT_KIND_WORD: Record<string, string> = { determination: 'native title determination', claim: 'registered native title claim', ilua: 'Indigenous land use agreement' };

export function countryFacts(b: SlidesBundle) {
  const c = b.country;
  const wp = b.wide.panel;
  const centre = b.panel.center;
  const centreLL = mercatorToLonLat(centre);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const dist = (m: XY) => Math.hypot(m.x - centre.x, m.y - centre.y) / k;
  const bear = (m: XY) => ((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360;
  const ext = panelExtent(wp);
  const inStrip = (m: XY) => m.x >= ext.xmin && m.x <= ext.xmax && m.y >= ext.ymin && m.y <= ext.ymax;

  // the named watercourses, nearest first
  const named = new Map<string, { name: string; distanceM: number; bearing: number; perenniality: string }>();
  for (const w of c.water.courses) {
    if (!w.name) continue;
    let best = Infinity, bm: XY | null = null;
    for (const [lon, lat] of w.coords) { const m = toM(lon, lat); const d = dist(m); if (d < best) { best = d; bm = m; } }
    if (!bm) continue;
    const cur = named.get(w.name);
    if (!cur || best < cur.distanceM) named.set(w.name, { name: titleCase(w.name), distanceM: Math.round(best), bearing: Math.round(bear(bm)), perenniality: w.perenniality });
  }
  const courses = [...named.values()].sort((x, y) => x.distanceM - y.distanceM);

  // the foreshore: the coastline, else the edge of the nearest water body in the strip
  let shore: { distanceM: number; bearing: number; kind: 'coast' | 'water' } | null = null;
  const consider = (lon: number, lat: number, kind: 'coast' | 'water') => { const m = toM(lon, lat); const d = dist(m); if (!shore || d < shore.distanceM) shore = { distanceM: Math.round(d), bearing: Math.round(bear(m)), kind }; };
  for (const path of c.water.coastline) for (const [lon, lat] of path) consider(lon, lat, 'coast');
  if (!shore) for (const ft of b.wide.base.water.features) for (const r of geomRings(ft.geometry)) { const step = Math.max(1, Math.floor(r.length / 400)); for (let i = 0; i < r.length; i += step) consider(r[i][0], r[i][1], 'water'); }

  // the land's shape from the wide grid: the site's level, the nearest and the highest crest
  const dem = c.dem;
  const siteRl = dem ? demAt(dem, centre.x, centre.y) : undefined;
  // the nearest crest that stands above the site, and the highest in the strip
  let nearestRidge: { distanceM: number; bearing: number; rl: number } | null = null, highestRidge: { distanceM: number; bearing: number; rl: number } | null = null;
  for (const line of c.ridges) for (const p of line) {
    const d = dist(p);
    if (p.z >= (siteRl ?? -Infinity) + 2 && (!nearestRidge || d < nearestRidge.distanceM)) nearestRidge = { distanceM: Math.round(d), bearing: Math.round(bear(p)), rl: Math.round(p.z * 10) / 10 };
    if (!highestRidge || p.z > highestRidge.rl) highestRidge = { distanceM: Math.round(d), bearing: Math.round(bear(p)), rl: Math.round(p.z * 10) / 10 };
  }
  const landMin = dem ? Math.max(0, Math.round(dem.min)) : undefined, landMax = dem ? Math.round(dem.max) : undefined;

  const places = c.places.map((p) => ({ name: p.name, gazetted: p.gazetted, hectares: p.hectares, restricted: p.restricted, lalc: p.lalc ? titleCase(p.lalc) : undefined, distanceM: p.distanceM, bearing: p.bearing, inStrip: inStrip(toM(p.lon, p.lat)) }));
  const lalcsInStrip = [...new Set(c.lalcs.map((l) => titleCase(l.local)))];
  const siteLalc = b.context.lalc ? { local: b.context.lalc.local, regional: b.context.lalc.regional } : lalcsInStrip.length === 1 ? { local: lalcsInStrip[0], regional: titleCase(c.lalcs[0].regional) } : null;
  const npws = [...new Set(c.npws.map((n) => tidyName(titleCase(n.name))))];
  const veg = c.vegetation;
  // the LEPs' Aboriginal heritage items: distance to the nearest edge, on the site when either holds the other
  const siteRings = b.siteLots.features.flatMap((ft) => geomRings(ft.geometry));
  const lepItems = (c.lepAboriginal?.items ?? []).map((it) => {
    const onSite = it.rings.some((r) => pointInRing(centreLL.lon, centreLL.lat, r)) || siteRings.some((r) => pointInRing(it.lon, it.lat, r));
    let near = Infinity, nm: XY = toM(it.lon, it.lat);
    for (const r of it.rings) for (const [lon, lat] of r) { const m = toM(lon, lat); const d = dist(m); if (d < near) { near = d; nm = m; } }
    return { id: it.id, name: it.name, cls: it.cls, significance: it.significance, epi: shortEpi(it.epi), lon: it.lon, lat: it.lat, onSite, distanceM: onSite ? 0 : Math.round(near), bearing: Math.round(bear(nm)), inStrip: inStrip(toM(it.lon, it.lat)) };
  }).sort((x, y) => x.distanceM - y.distanceM);
  // the permits, the lists' places and the plans' landscape maps: on the site when they take in a twentieth of it or 100 m²
  // (a permit drawn to the kerb can graze a lot by a sliver), else the gap from the site's edge to theirs
  const merc = (rs: number[][][]) => rs.map((r) => r.map(([lon, lat]) => { const m = toM(lon, lat); return [m.x, m.y]; }));
  const siteM = merc(siteRings);
  const relate = (rs: number[][][], covers = false): { onSite: boolean; distanceM: number; bearing: number } => {
    if (covers) return { onSite: true, distanceM: 0, bearing: 0 };
    const rm = merc(rs);
    const ov = siteM.length ? overlapArea(siteM, rm) : null;
    const onSite = ov ? ov.share >= 0.05 || ov.area / (k * k) >= 100 : inRings(centre.x, centre.y, rm);
    const at = siteM.length ? ringsGap(siteM, rm) : nearestOnRings([centre.x, centre.y], rm);
    if (!at) return { onSite, distanceM: onSite ? 0 : Infinity, bearing: 0 };
    return { onSite, distanceM: onSite ? 0 : Math.round(at.d / k), bearing: Math.round(bear({ x: at.x, y: at.y })) };
  };
  const today = b.generatedAt.slice(0, 10);
  const ahips = (c.ahips?.permits ?? []).map((p) => ({
    id: p.id, project: p.project, applicant: p.applicant, decided: p.decided, expires: p.expires, status: p.status,
    active: p.status === 'ACTIVE' && (!p.expires || p.expires >= today), lon: p.lon, lat: p.lat, ...relate(p.rings),
  })).sort((x, y) => x.distanceM - y.distanceM || Number(y.active) - Number(x.active));
  const listed = (c.heritageLists?.places ?? []).map((p) => ({
    list: p.list, id: p.id, name: p.name, status: listStatus(p.list, p.status), nominated: /^nominated/i.test(p.status), hectares: p.hectares, listed: p.listed, coversStrip: p.coversStrip, lon: p.lon, lat: p.lat, ...relate(p.rings, p.coversStrip),
  })).sort((x, y) => Number(x.list === 'RNE') - Number(y.list === 'RNE') || x.distanceM - y.distanceM);
  const lepAreas = (c.lepAboriginalAreas?.areas ?? []).map((a) => ({ epi: shortEpi(a.epi), map: a.map, cls: a.cls, coversStrip: a.coversStrip, ...relate(a.rings, a.coversStrip) })).sort((x, y) => x.distanceM - y.distanceM);
  return {
    stripKm: { w: Math.round(((wp.wMm / 1000) * wp.scale) / 100) / 10, h: Math.round(((wp.hMm / 1000) * wp.scale) / 100) / 10 },
    lalc: siteLalc, lalcsInStrip,
    nativeTitle: c.nativeTitle,
    vegetation: { ok: veg.ok, atSite: veg.atSite, classes: veg.classes.slice(0, 6), hasImage: Boolean(veg.image), source: veg.source },
    soil: b.constraints.soil, soilNote: b.constraints.soilNote,
    courses: courses.slice(0, 5), courseLines: c.water.courses.length, waterOk: c.water.ok,
    shore: shore as { distanceM: number; bearing: number; kind: 'coast' | 'water' } | null,
    landform: { siteRl: siteRl === undefined ? null : Math.round(siteRl * 10) / 10, nearestRidge, highestRidge, min: landMin ?? null, max: landMax ?? null, ridgeLines: c.ridges.length, hasDem: Boolean(dem) },
    npws,
    places: places.slice(0, 6), placeCount: c.places.length, placesRadiusM: c.placesRadiusM, placesOk: c.placesOk,
    asdst: c.asdst,
    lepAboriginal: { read: c.lepAboriginal !== undefined, ok: Boolean(c.lepAboriginal?.ok), items: lepItems, epis: [...new Set(lepItems.map((i) => i.epi))] },
    lepAreas: { read: c.lepAboriginalAreas !== undefined, ok: Boolean(c.lepAboriginalAreas?.ok), areas: lepAreas },
    ahips: { read: c.ahips !== undefined, ok: Boolean(c.ahips?.ok), permits: ahips, active: ahips.filter((p) => p.active).length },
    lists: { read: c.heritageLists !== undefined, answered: c.heritageLists?.read ?? { nhl: false, chl: false, rne: false }, places: listed },
    fetchedAt: c.fetchedAt,
  };
}

export function countrySentences(_b: SlidesBundle, f: ReturnType<typeof countryFacts>): string[] {
  const out: string[] = [];
  const dir = compassWord;
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmtNum(m)} m`);
  const nt = f.nativeTitle;
  const others = f.lalcsInStrip.filter((l) => !f.lalc || l.toLowerCase() !== f.lalc.local.toLowerCase());
  let s1 = f.lalc ? `The site is in the ${f.lalc.local} Local Aboriginal Land Council area${f.lalc.regional ? ` (${f.lalc.regional} region)` : ''}${others.length ? `; the strip also takes in the ${listWords(others)} Land Council area${others.length === 1 ? '' : 's'}` : ''}.` : 'The Local Aboriginal Land Council at the site could not be read for this run.';
  if (nt.ok) {
    const inWin = [nt.inWindow.determinations ? `${nt.inWindow.determinations === 1 ? 'a determination area' : `${nt.inWindow.determinations} determination areas`}` : '', nt.inWindow.claims ? `${nt.inWindow.claims === 1 ? 'a registered claim' : `${nt.inWindow.claims} registered claims`}` : '', nt.inWindow.iluas ? `${nt.inWindow.iluas === 1 ? 'an Indigenous land use agreement' : `${nt.inWindow.iluas} Indigenous land use agreements`}` : ''].filter(Boolean);
    s1 += nt.atSite.length
      ? ` The National Native Title Tribunal's registers show ${listWords(nt.atSite.map((r) => `${r.name} (${NT_KIND_WORD[r.kind]}${r.detail ? `: ${r.detail.toLowerCase()}` : ''}${r.date ? `, ${fmtIso(r.date)}` : ''})`))} over the site.`
      : ` The National Native Title Tribunal's registers show no determination, registered claim or Indigenous land use agreement over the site${inWin.length ? `, though ${listWords(inWin)} reach${inWin.length === 1 && !/s\b/.test(inWin[0]) ? 'es' : ''} the strip` : ''}${nt.currency ? ` (registers current ${fmtIso(nt.currency)})` : ''}.`;
  } else s1 += " The National Native Title Tribunal's registers did not answer for this run.";
  out.push(s1);
  const v = f.vegetation;
  if (v.atSite && v.atSite.pct !== 'Not classified') {
    const rest = v.classes.filter((x) => x.pctId !== v.atSite!.pctId).slice(0, 2);
    const own = v.classes.find((x) => x.pctId === v.atSite!.pctId);
    out.push(`Before 1750 the site stood in ${v.atSite.pct} (plant community type ${v.atSite.pctId}${v.atSite.cls ? `, of the ${v.atSite.cls}` : ''}) on the State's reconstruction${f.soil ? `, over the ${titleCase(f.soil.name)} soil landscape${f.soil.process ? `, ${f.soil.process.toLowerCase()} in origin` : ''}` : ''}${own || rest.length ? `; across the strip it was ${listWords([own ? `${fmtPct(own.sharePct)} that community` : '', ...rest.map((x) => `${fmtPct(x.sharePct)} ${x.pct}`)].filter(Boolean))}` : ''}.`);
  } else if (v.ok) out.push(`The State's pre-1750 vegetation model does not classify the site itself${v.classes.length ? `; the strip was ${listWords(v.classes.slice(0, 3).map((x) => `${fmtPct(x.sharePct)} ${x.pct}`))}` : ''}${f.soil ? `. The soil landscape is ${titleCase(f.soil.name)}` : ''}.`);
  else out.push(`The pre-1750 vegetation model did not answer for this run${f.soil ? `; the soil landscape at the site is ${titleCase(f.soil.name)}` : ''}.`);
  const lf = f.landform;
  let s3 = f.courses[0] ? `The nearest mapped watercourse is ${f.courses[0].name}, ${km(f.courses[0].distanceM)} to the ${dir(f.courses[0].bearing)}${f.courses[0].perenniality !== 'unknown' ? ` (${f.courses[0].perenniality})` : ''}${f.courses.length > 1 ? `, then ${listWords(f.courses.slice(1, 3).map((w) => `${w.name} ${km(w.distanceM)} ${dir(w.bearing)}`))}` : ''}` : f.waterOk ? "No named watercourse is mapped in the strip; the older creek lines of a built-up area run in pipes and the State's lines are what is left above ground" : 'The watercourse layer did not answer for this run';
  if (f.shore) s3 += `; the ${f.shore.kind === 'coast' ? 'foreshore' : "nearest water body's edge"} is ${km(f.shore.distanceM)} to the ${dir(f.shore.bearing)}`;
  s3 += '.';
  if (lf.hasDem) s3 += ` The site sits at RL ${lf.siteRl ?? '—'}${lf.nearestRidge ? `, ${km(lf.nearestRidge.distanceM)} ${dir(lf.nearestRidge.bearing)} of the nearest crest above it (RL ${lf.nearestRidge.rl})` : lf.ridgeLines ? ', with no crest above it in the strip' : ''}; the strip runs from RL ${lf.min} to ${lf.max}${lf.highestRidge && (!lf.nearestRidge || lf.highestRidge.rl !== lf.nearestRidge.rl) ? `, its highest crest ${km(lf.highestRidge.distanceM)} to the ${dir(lf.highestRidge.bearing)} at RL ${lf.highestRidge.rl}` : ''}${lf.ridgeLines ? '' : '; no crest stands out of it at the model\'s resolution'}.`;
  out.push(s3);
  if (f.placesOk) {
    out.push(f.placeCount
      ? `${f.placeCount === 1 ? 'One gazetted Aboriginal Place lies' : `${f.placeCount} gazetted Aboriginal Places lie`} within ${f.placesRadiusM / 1000} km: ${listWords(f.places.slice(0, 3).map((p) => `${p.name} ${km(p.distanceM)} to the ${dir(p.bearing)}${p.gazetted ? ` (gazetted ${p.gazetted.slice(0, 4)})` : ''}`))}${f.places.some((p) => p.restricted) ? '; where a place\'s location is restricted the register shows it generalised' : ''}.${f.npws.length ? ` ${listWords(f.npws)} of the National Parks estate ${f.npws.length === 1 ? 'lies' : 'lie'} in the strip.` : ''}`
      : `No gazetted Aboriginal Place lies within ${f.placesRadiusM / 1000} km of the site.${f.npws.length ? ` ${listWords(f.npws)} of the National Parks estate ${f.npws.length === 1 ? 'lies' : 'lie'} in the strip.` : ''}`);
  } else out.push('The register of gazetted Aboriginal Places did not answer for this run.');
  const lep = f.lepAboriginal;
  // the two plans that map Aboriginal cultural landscapes, said after the items
  const areas = f.lepAreas.ok ? f.lepAreas.areas : [];
  const areaWords = areas.length ? ` ${listWords(areas.slice(0, 2).map((a) => `the ${a.epi} maps ${a.coversStrip ? 'the whole strip' : a.onSite ? 'the site' : a.distanceM <= 3 ? "land at the site's edge" : `land ${km(a.distanceM)} to the ${dir(a.bearing)}`} as ${/^[aeiou]/i.test(a.cls) ? 'an' : 'a'} ${a.cls}`)).replace(/^the/, 'The')}, where a local provision of the plan applies.` : '';
  if (!lep.read) { if (areaWords) out.push(areaWords.trim()); /* a deck cached before the LEP items were read */ } else if (lep.ok) {
    const items = lep.items, on = items.find((i) => i.onSite);
    out.push((items.length
      ? `${items.length === 1 ? 'One Aboriginal heritage item is' : `${items.length} Aboriginal heritage items are`} scheduled in the strip by ${listWords(lep.epis)}${on ? `, the site itself among them (${on.name}${on.id ? `, ${on.id}` : ''})` : ''}: ${listWords(items.filter((i) => !i.onSite).slice(0, 3).map((i) => `${i.name} (${i.cls}${i.id ? ` ${i.id}` : ''}${i.significance ? `, ${i.significance.toLowerCase()} significance` : ''}) ${km(i.distanceM)} to the ${dir(i.bearing)}`))}${items.length - (on ? 1 : 0) > 3 ? `, and ${numWord(items.length - (on ? 1 : 0) - 3)} more` : ''}.`
      : 'No local environmental plan schedules an Aboriginal heritage item in the strip; few plans in NSW schedule any.') + areaWords);
  } else out.push(`The LEP heritage maps did not answer for this run, so their Aboriginal items are not shown.${areaWords}`);
  // the permits Heritage NSW has granted to harm Aboriginal objects, and the national lists' Indigenous places
  const ah = f.ahips, li = f.lists;
  const bits: string[] = [];
  if (ah.read) {
    if (!ah.ok) bits.push("Heritage NSW's layer of Aboriginal Heritage Impact Permits did not answer for this run.");
    else if (!ah.permits.length) bits.push('No Aboriginal Heritage Impact Permit boundary falls in the strip (the layer leaves out a few permits; the public register lists them all).');
    else {
      const on = ah.permits.filter((p) => p.onSite), rest = ah.permits.filter((p) => !p.onSite);
      const word = (p: (typeof ah.permits)[number]) => `${p.project || 'a project'} (AHIP ${p.id}, ${permitState(p)})`;
      const one = ah.permits.length === 1, shown = on.length ? 2 : 3;
      bits.push(`${one ? 'One Aboriginal Heritage Impact Permit, allowing' : `${capFirst(numWord(ah.permits.length))} Aboriginal Heritage Impact Permits, each allowing`} harm to Aboriginal objects for a project, cover${one ? 's' : ''} land in the strip${on.length ? `, the site among it: ${listWords(on.map(word))}` : ''}${rest.length ? `${on.length ? '; beyond the site,' : ':'} ${listWords(rest.slice(0, shown).map((p) => `${word(p)} ${besideWords(p)}`))}${rest.length > shown ? `, and ${numWord(rest.length - shown)} more` : ''}` : ''}.`);
    }
  }
  if (li.read) {
    const covers = li.places.filter((p) => p.coversStrip), nat = li.places.filter((p) => !p.coversStrip && p.list !== 'RNE'), rne = li.places.filter((p) => !p.coversStrip && p.list === 'RNE');
    // a place in words: a nomination is not a listing, and a big one says how big
    const what = (p: (typeof li.places)[number]) => `${p.nominated ? `a nomination to the ${LIST_WORD[p.list]} (not a listing)` : `${p.status === 'listed' ? 'a place' : p.status} on the ${LIST_WORD[p.list]}`}${p.hectares && p.hectares >= 1000 ? ` that takes in ${fmtNum(Math.round(p.hectares / 100))} km²` : ''}`;
    for (const p of covers) bits.push(p.list === 'RNE' ? `The whole strip lies within ${p.name} (${p.status}) on the Register of the National Estate, closed in 2007 and kept as an archive with no statutory force.` : `The whole strip lies within the ${p.name}, ${what(p)}.`);
    for (const p of nat.filter((q) => q.onSite).slice(0, 2)) bits.push(`The site lies within the ${p.name}, ${what(p)}.`);
    const natNear = nat.filter((q) => !q.onSite);
    if (natNear.length) bits.push(`${listWords(natNear.slice(0, 3).map((p) => `${p.name}, ${what(p)}, lies ${besideWords(p)}`)).replace(/^./, (x) => x.toUpperCase())}${natNear.length > 3 ? `, and ${numWord(natNear.length - 3)} more places on the lists` : ''}.`);
    if (rne.length) bits.push(`The Register of the National Estate, closed in 2007 and kept as an archive with no statutory force, records ${listWords(rne.slice(0, 3).map((p) => `${p.name} (${p.status}) ${besideWords(p)}`))}${rne.length > 3 ? `, and ${numWord(rne.length - 3)} more` : ''}.`);
    const silent = [!li.answered.nhl ? 'National Heritage List' : '', !li.answered.chl ? 'Commonwealth Heritage List' : '', !li.answered.rne ? 'Register of the National Estate' : ''].filter(Boolean);
    if (!covers.length && !nat.length && !rne.length && !silent.length) bits.push('No Indigenous place of the National or Commonwealth Heritage Lists, or of the archived Register of the National Estate, is in the strip.');
    else if (!nat.length && !rne.length && !silent.length) bits.push('No other Indigenous place of the national lists is in the strip.');
    if (silent.length) bits.push(`The ${listWords(silent)} did not answer for this run.`);
  }
  if (bits.length) out.push(bits.join(' '));
  out.push(`Registered Aboriginal sites are held in AHIMS, which is not open data: an AHIMS search precedes any works.${f.asdst.ok && f.asdst.likelihood !== null ? ` The public ASDST model puts the site's combined-features likelihood at ${f.asdst.likelihood} of ${f.asdst.scaleMax}${f.asdst.surveyPriority !== null ? ` and its survey priority at ${f.asdst.surveyPriority}` : ''}: a relative model of where sites are likely, not a record of them.` : ''}`);
  out.push('The name of Country, the language, the place names and the cultural narrative are not generated here: the office develops them with Knowledge Holders and the Land Council.');
  return out;
}

/** Country on the template: the land's shape and its pre-1750 plant communities over a full page at the strip's scale, each community its own green pattern; the open records charted beside. */
export function countryAtlas(b: SlidesBundle): Slide {
  const t = tpl();
  const G = INK.green;
  const c = b.country;
  const f = countryFacts(b);
  const p = b.countryPanel;
  const proj = panelProjector(p);
  const gt = greyBase(t);
  const box = { x0: 0, y0: 0, x1: p.wMm, y1: p.hMm };
  const VEG: Fill[] = VEG_1750_FILLS;
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#ffffff"/>`];
  if (c.dem) parts.push(demPicture(c.dem, proj, reliefDataUri(c.dem, '#8fa597', { shade: 1 })));
  const veg = c.vegetation;
  const classes = veg.classes.filter((cl) => cl.mask).slice(0, VEG.length);
  if (veg.image && classes.length) {
    const e = veg.image.extent;
    const nw = mercatorToLonLat({ x: e.xmin, y: e.ymax }), se = mercatorToLonLat({ x: e.xmax, y: e.ymin });
    const [x0, y0] = proj(nw.lon, nw.lat), [x1, y1] = proj(se.lon, se.lat);
    if (veg.paint) parts.push(`<image href="data/${veg.paint}" x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${(x1 - x0).toFixed(2)}" height="${(y1 - y0).toFixed(2)}" preserveAspectRatio="none"/>`);
  }
  // water: the harbour and the sea unprinted, the coast and the courses drawn
  const wb = b.wide.base;
  if (wb.water.features.length) parts.push(`<path d="${fcPath(wb.water, proj)}" fill="#ffffff" fill-rule="evenodd" stroke="${G.deep}" stroke-width="0.25"/>`);
  if (c.water.coastline.length) parts.push(`<path d="${c.water.coastline.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${G.deep}" stroke-width="0.3"/>`);
  for (const w of c.water.courses) parts.push(`<path d="${ringsPath([w.coords], proj, false)}" fill="none" stroke="${G.deep}" stroke-width="${w.hierarchy === 'major' ? 0.6 : 0.4}" stroke-linecap="round"${w.perenniality === 'perennial' ? '' : ' stroke-dasharray="1.4 0.8"'}/>`);
  parts.push(withTemplate(gt, () => overLayers(wb, proj, p, 'none')));
  if (c.ridges.length) parts.push(`<path d="${c.ridges.map((line) => `M${line.map((q, i) => { const ll = mercatorToLonLat(q); const [x, y] = proj(ll.lon, ll.lat); return `${i ? 'L' : ''}${x.toFixed(2)},${y.toFixed(2)}`; }).join('')}`).join('')}" fill="none" stroke="#000000" stroke-width="0.35" stroke-dasharray="1.8 0.9" stroke-linecap="round"/>`);
  const spacer = new LabelSpacer(p.wMm, p.hMm, 80);
  spacer.take(40, 10, 72, 10);
  const cLL = mercatorToLonLat(b.panel.center);
  const [sx, sy] = proj(cLL.lon, cLL.lat);
  spacer.take(sx, sy, 6, 6);
  const labels: string[] = [];
  if (c.lalcs.length > 1) {
    parts.push(`<path d="${c.lalcs.map((l) => ringsPath(l.rings, proj)).join('')}" fill="none" stroke="#000000" stroke-width="0.5" stroke-dasharray="3 1 0.6 1"/>`);
    for (const l of c.lalcs) { let best = { area: 0, cx: 0, cy: 0 }; for (const r of l.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; } const text = `${titleCase(l.local)} Land Council`.toUpperCase(); if (best.area > 200 && spacer.take(best.cx, best.cy, text.length * 1.6 + 1, 2.8)) labels.push(m6(best.cx, best.cy, text)); }
  }
  const permits = c.ahips?.permits ?? [];
  const state = new Map(f.ahips.permits.map((q) => [q.id, q.active]));
  for (const pm of permits) parts.push(`<path d="${ringsPath(pm.rings, proj)}" fill="#ffffff" fill-opacity="0.6" stroke="#000000" stroke-width="0.3" fill-rule="nonzero"${state.get(pm.id) ? '' : ' stroke-dasharray="1 0.6"'}/>`);
  // A busy council area holds ninety-odd permits: named one and all they carpet
  // the map, so only the nearest few carry their number and the legend counts the rest.
  const namedPermits = new Set([...f.ahips.permits].sort((x2, y2) => x2.distanceM - y2.distanceM).slice(0, AHIP_NAMED).map((q) => q.id));
  for (const pm of permits) {
    if (!namedPermits.has(pm.id)) continue;
    let best = { area: 0, cx: 0, cy: 0 }; for (const r of pm.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    const [x, y] = best.area > 0 ? [best.cx, best.cy] : proj(pm.lon, pm.lat);
    if (x < 3 || y < 3 || x > p.wMm - 3 || y > p.hMm - 3) continue;
    const text = `AHIP ${pm.id}`;
    for (const [lx, ly] of [[x, y - 3], [x, y + 3], [x + 8, y]] as [number, number][]) if (spacer.take(lx, ly, text.length * 1.6 + 1, 2.6)) { labels.push(m6(lx, ly, text)); break; }
  }
  // the suburbs, for finding one's way
  for (const s of b.wide.suburbs.features) {
    let best = { area: 0, cx: 0, cy: 0 }; for (const r of geomRings(s.geometry)) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    const text = String(s.properties?.suburbname ?? '').toUpperCase();
    if (text && best.area > 300 && spacer.take(best.cx, best.cy, text.length * 1.6 + 1, 2.8)) labels.push(m6(best.cx, best.cy, text).replace('fill="#000000"', 'fill="#6f6f6f"'));
  }
  parts.push(...labels, `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="1.8" fill="${t.site}" stroke="#ffffff" stroke-width="0.5"/>`, panelFurniture(p, 'left'));
  const mapSvg = bleedSvg('country15', p, parts.join('\n'));

  const legend: LegendEntry[] = [
    ...(classes.length ? [{ swatch: swatchOf({ ...VEG[0], bg: '#ffffff' }), label: 'Pre-1750 plant communities, each its own pattern, as charted' }] : []),
    { swatch: `<path d="M0,2.4C1.5,0.6 3.5,3 5,1.2" fill="none" stroke="${G.deep}" stroke-width="0.4"/>`, label: 'Watercourses, dashed where not perennial; the land in hillshade' },
    ...(c.ridges.length ? [{ swatch: `<path d="M0,1.8H5" stroke="#000000" stroke-width="0.35" stroke-dasharray="1.8 0.9"/>`, label: 'Crests read from the elevation model' }] : []),
    ...(c.lalcs.length > 1 ? [{ swatch: `<path d="M0,1.8H5" stroke="#000000" stroke-width="0.5" stroke-dasharray="3 1 0.6 1"/>`, label: 'Local Aboriginal Land Council boundary' }] : []),
    ...(permits.length ? [{ swatch: `<rect x="0.4" y="0.6" width="4.2" height="2.4" fill="#ffffff" stroke="#000000" stroke-width="0.3" stroke-dasharray="1 0.6"/>`, label: `Aboriginal Heritage Impact Permit, dashed where expired${permits.length > AHIP_NAMED ? `; ${permits.length} on the page, the nearest ${AHIP_NAMED} numbered` : ''}` }] : []),
    { swatch: `<circle cx="2.5" cy="1.8" r="1.3" fill="${t.site}"/>`, label: 'The site' },
  ];
  const limit = keyTop(legend.length) - 6;
  const vAt = f.vegetation.atSite;
  const figs = zFigures([
    ['land council', f.lalc ? `${titleCase(f.lalc.local)} LALC` : '—'],
    ['native title', f.nativeTitle.atSite.length ? f.nativeTitle.atSite.map((n: { name?: string }) => n.name ?? 'a matter').join(' · ') : 'none over the site'],
    ['before 1750, at the site', vAt ? shorten(`${vAt.pct}${vAt.pctId ? ` (PCT ${vAt.pctId})` : ''}`, 46) : '—'],
  ], [
    ['soil landscape', f.soil ? `${f.soil.name} (${f.soil.process})` : '—'],
    ['the ground', f.landform.siteRl !== null ? `RL ${f.landform.siteRl}${f.landform.nearestRidge ? ` · crest ${fmtNum(f.landform.nearestRidge.distanceM)} m ${bearingName(f.landform.nearestRidge.bearing)}` : ''}` : '—'],
    ['ASDST likelihood · AHIMS', `${f.asdst.likelihood !== null ? `${f.asdst.likelihood} of ${f.asdst.scaleMax}` : '—'} · a search before any works`],
  ], 9.6);
  let y = 44 + blockH(6.3 + 3 * 9.6);
  const blocks = [zBlock('Country at the site', figs, 'The land')];
  if (classes.length) {
    const rows = classes.map((cl, i) => ({ name: shorten(cl.pct, 42), value: cl.sharePct, label: fmtPct(cl.sharePct, cl.sharePct < 10 ? 1 : 0), fill: { ...VEG[i], bg: '#ffffff', outline: G.deep, outlineW: 0.12 } as Fill }));
    const ax = niceAxis(Math.max(...rows.map((r) => r.value)));
    blocks.push(zBlock('Plant communities before 1750 · share of the land, %', zBars(rows, ax.max, ax.step)));
    y += blockH(barsH(rows.length));
  }
  const recs = [
    { label: 'Impact permits', value: f.ahips.permits.length ? `${f.ahips.permits.length} on the page · ${f.ahips.active} active` : 'none on the page', note: f.ahips.permits[0] ? `nearest AHIP ${f.ahips.permits[0].id}, ${fmtNum(f.ahips.permits[0].distanceM)} m ${bearingName(f.ahips.permits[0].bearing)}` : undefined },
    { label: 'Aboriginal Places', value: f.placeCount ? `${f.placeCount} within ${fmtNum(f.placesRadiusM / 1000)} km` : `none gazetted within ${fmtNum(f.placesRadiusM / 1000)} km` },
    { label: 'Heritage lists', value: f.lists.places.length ? f.lists.places.slice(0, 2).map((q: { name: string; status: string }) => `${q.name} — ${q.status}`).join(' · ') : 'none' },
    { label: 'Local plan items', value: f.lepAboriginal.items.length ? `${f.lepAboriginal.items.length} scheduled` : 'none scheduled on the page' },
  ];
  if (y + blockH(recs.length * 7.5) < limit + 10) blocks.push(zBlock('The open records', zTable(recs)));
  const sources = `Sources: NSW Spatial Services administrative boundaries; the National Native Title Tribunal's registers; the NSW State Vegetation Type Map, pre-1750 plant community types (DCCEEW); NSW soil landscapes; Heritage NSW Aboriginal Places and impact permits; the national heritage lists and the archived Register of the National Estate; the ASDST model (DCCEEW); the 5 m elevation model at 8 m. AHIMS is not open data. The name of Country, its language and stories are developed with Knowledge Holders, not generated. Retrieved ${b.generatedAt.slice(0, 10)}.`;
  const sub = atlasSub(b, f.lalc ? `${titleCase(f.lalc.local)} LALC` : '', vAt ? vAt.pct : '', 'AHIMS search required');
  return { id: '15_country', title: 'Country', subtitle: sub, textHtml: '', figureHtml: atlasFigure(mapSvg, 'The land before 1750', p, zFlow(blocks)), bleed: true, sources, accent: G.text, legend,
    narrative: brief([f.lalc ? `The site lies in the ${titleCase(f.lalc.local)} Local Aboriginal Land Council area.` : '', vAt ? `Before 1750 the ground here carried ${vAt.pct}${classes[1] ? `, between ${classes.slice(0, 3).filter((cl) => cl.pct !== vAt.pct).slice(0, 2).map((cl) => cl.pct).join(' and ')}` : ''}.` : '', 'An AHIMS search is required before any works; the name of Country and its stories are for Knowledge Holders to give.']) };
}

export function countrySlide(b: SlidesBundle): Slide {
  const t = tpl();
  const c = b.country;
  const f = countryFacts(b);
  const wp = b.wide.panel;
  const wproj = panelProjector(wp);
  const centreLL = mercatorToLonLat(b.panel.center);
  const [sx, sy] = wproj(centreLL.lon, centreLL.lat);
  const parts: string[] = [`<rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}" fill="#f4efe6"/>`];
  const legend: LegendEntry[] = [];
  // the land's shape, then the pre-1750 communities over it
  if (c.dem) parts.push(`<image x="0" y="0" width="${wp.wMm}" height="${wp.hMm}" preserveAspectRatio="none" opacity="0.8" href="${hillshadeDataUri(c.dem)}"/>`);
  if (c.vegetation.image) {
    parts.push(`<image x="0" y="0" width="${wp.wMm}" height="${wp.hMm}" preserveAspectRatio="none" opacity="0.55" href="data/${c.vegetation.image.file}"/>`);
    legend.push({ swatch: `<rect x="0" y="0.4" width="2.5" height="2.8" fill="${f.vegetation.classes[0]?.colour ?? '#d561ad'}" fill-opacity="0.6"/><rect x="2.5" y="0.4" width="2.5" height="2.8" fill="${f.vegetation.classes[1]?.colour ?? '#58c924'}" fill-opacity="0.6"/>`, label: 'Pre-1750 plant community types, listed at right' });
  }
  if (c.dem) legend.push({ swatch: `<rect x="0" y="0.4" width="5" height="2.8" fill="#b9b0a0"/>`, label: 'The land\'s shape (5 m elevation model, hillshade)' });
  // water: bodies, coast, courses
  if (b.wide.base.water.features.length) parts.push(`<path d="${fcPath(b.wide.base.water, wproj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  if (c.water.coastline.length) parts.push(`<path d="${c.water.coastline.map((p) => ringsPath([p], wproj, false)).join('')}" fill="none" stroke="${CREEK_COLOUR}" stroke-width="0.4"/>`);
  if (b.wide.base.water.features.length || c.water.coastline.length) legend.push({ swatch: swatchFill(t.water, CREEK_COLOUR), label: 'Water bodies and the coastline' });
  const spacer = new LabelSpacer(wp.wMm, wp.hMm, 60);
  spacer.take(sx, sy, 7, 7);
  // no label under the scale bar and north arrow
  const fb = furnitureBox(wp, 'right');
  spacer.take((fb.x0 + fb.x1) / 2, (fb.y0 + fb.y1) / 2, fb.x1 - fb.x0, fb.y1 - fb.y0);
  if (c.water.courses.length) {
    const byStyle = new Map<string, string[]>();
    for (const w of c.water.courses) { const key = `${w.hierarchy}|${w.perenniality}`; (byStyle.get(key) ?? byStyle.set(key, []).get(key)!).push(ringsPath([w.coords], wproj, false)); }
    for (const [key, ds] of byStyle) {
      const [hier, per] = key.split('|');
      const width = hier === 'major' ? 0.75 : hier === 'secondary' ? 0.55 : 0.4;
      parts.push(`<path d="${ds.join('')}" fill="none" stroke="${CREEK_COLOUR}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${per === 'perennial' ? '' : ' stroke-dasharray="1.6,1"'}/>`);
    }
    legend.push({ swatch: swatchLine(CREEK_COLOUR, 0.6), label: 'Watercourses, dashed where not perennial' });
    // names along the courses, once each
    const done = new Set<string>();
    for (const w of [...c.water.courses].filter((x) => x.name).sort((x, y) => y.coords.length - x.coords.length)) {
      if (done.has(w.name!)) continue;
      const pts = w.coords.map(([lon, lat]) => wproj(lon, lat)).filter(([x, y]) => x > 6 && y > 4 && x < wp.wMm - 6 && y < wp.hMm - 4);
      if (pts.length < 2) continue;
      const mid = pts[Math.floor(pts.length / 2)];
      const text = titleCase(w.name!);
      if (spacer.take(mid[0], mid[1] - 2.2, labelW(text, 2.1), 2.6)) { parts.push(`<text x="${mid[0].toFixed(1)}" y="${(mid[1] - 1.5).toFixed(1)}" text-anchor="middle" font-size="2.1" font-weight="600" fill="${CREEK_COLOUR}" stroke="#ffffff" stroke-width="0.45" paint-order="stroke">${esc(text)}</text>`); done.add(w.name!); }
    }
  }
  // the crests
  if (c.ridges.length) {
    parts.push(`<path d="${c.ridges.map((line) => `M${line.map((p, i) => { const ll = mercatorToLonLat(p); const [x, y] = wproj(ll.lon, ll.lat); return `${i ? 'L' : ''}${x.toFixed(1)},${y.toFixed(1)}`; }).join('')}`).join('')}" fill="none" stroke="${RIDGE_COLOUR}" stroke-width="0.5" stroke-opacity="0.8" stroke-dasharray="1.8,0.9" stroke-linecap="round"/>`);
    legend.push({ swatch: swatchLine(RIDGE_COLOUR, 0.5, '1.8,0.9'), label: 'Ridgelines read from the elevation model' });
  }
  // the National Parks estate
  if (c.npws.length) {
    const npwsD = c.npws.map((n) => ringsPath(n.rings, wproj)).join('');
    parts.push(`<path d="${npwsD}" fill="${NPWS_COLOUR}" fill-opacity="0.14" stroke="${NPWS_COLOUR}" stroke-width="0.35" fill-rule="evenodd"/>`);
    parts.push(dotsPath(npwsD, 'npwsdots', NPWS_COLOUR, bboxOf(c.npws.flatMap((n) => n.rings), wproj), 2.1, 0.26, 0.6));
    for (const n of c.npws) { let best = { area: 0, cx: 0, cy: 0 }; for (const r of n.rings) { const s = clippedStats(r, wproj, wp); if (s.area > best.area) best = s; } const text = tidyName(titleCase(n.name)); if (best.area > 40 && spacer.take(best.cx, best.cy, labelW(text, 2.1), 2.6)) parts.push(label(best.cx, best.cy, text, 2.1, NPWS_COLOUR)); }
    legend.push({ swatch: swatchFill(NPWS_COLOUR, NPWS_COLOUR), label: 'National Parks and Wildlife Service estate' });
  }
  // land council areas, where more than one reaches the strip
  if (f.lalcsInStrip.length > 1) {
    parts.push(`<path d="${c.lalcs.map((l) => ringsPath(l.rings, wproj)).join('')}" fill="none" stroke="#5a4426" stroke-width="0.6" stroke-dasharray="3,1.4"/>`);
    for (const l of c.lalcs) { let best = { area: 0, cx: 0, cy: 0 }; for (const r of l.rings) { const s = clippedStats(r, wproj, wp); if (s.area > best.area) best = s; } const text = `${titleCase(l.local)} LALC`; if (best.area > 100 && spacer.take(best.cx, best.cy, labelW(text, 2.3), 3)) parts.push(label(best.cx, best.cy, text, 2.3, '#5a4426')); }
    legend.push({ swatch: swatchLine('#5a4426', 0.6, '3,1.4'), label: 'Local Aboriginal Land Council boundary' });
  }
  // the LEPs' maps of Aboriginal cultural landscapes, hatched in the map's colour; one that takes in the whole strip is said in the legend, not drawn over everything
  const defs: string[] = [];
  const onMap = (x: number, y: number) => x >= 0 && y >= 0 && x <= wp.wMm && y <= wp.hMm;
  const bestSpot = (rs: number[][][]) => { let best = { area: 0, cx: 0, cy: 0 }; for (const r of rs) { const st = clippedStats(r, wproj, wp); if (st.area > best.area) best = st; } return best; };
  const clipName = (str: string, max = 34) => (str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str);
  // (hatched as clipped lines, as the other hatches are: a pattern rasterises blurrily in the PDF)
  const inMap = (bb: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: Math.max(bb.x0, -2), y0: Math.max(bb.y0, -2), x1: Math.min(bb.x1, wp.wMm + 2), y1: Math.min(bb.y1, wp.hMm + 2) });
  for (const [i, a] of (c.lepAboriginalAreas?.areas ?? []).entries()) {
    const col = LEP_LANDSCAPE_COLOUR(a.map);
    if (a.coversStrip) { legend.push({ swatch: swatchHatch(col), label: `The whole strip: ${a.cls} (${shortEpi(a.epi)})` }); continue; }
    // named in the legend: its areas are many and large, and a label on each would crowd the places and items over them
    parts.push(hatchPath(ringsPath(a.rings, wproj), `lepab${i}`, col, inMap(bboxOf(a.rings, wproj)), 1.5));
    legend.push({ swatch: swatchHatch(col), label: `${a.cls} (${shortEpi(a.epi)})` });
  }
  // the national lists' Indigenous places: listed ones washed, nominations dashed, the archived register's dotted and grey; one that takes in the whole strip is said in the legend
  const listsIn = c.heritageLists?.places ?? [];
  for (const [i, p] of listsIn.filter((q) => !q.coversStrip).entries()) {
    const rne = p.list === 'RNE', nominated = /^nominated/i.test(p.status), col = rne ? RNE_COLOUR : LIST_COLOUR;
    const d = ringsPath(p.rings, wproj), spot = bestSpot(p.rings);
    // a wash for a listed place of a size the strip can show; a nomination, or a place that fills much of the strip, is its edge
    // with a band of tint inside it, so the side it takes in reads at a glance
    const washed = !rne && !nominated && spot.area < 0.4 * wp.wMm * wp.hMm;
    if (!washed && !rne) {
      defs.push(`<clipPath id="list-in-${i}"><path d="${d}" clip-rule="nonzero"/></clipPath>`);
      parts.push(`<path d="${d}" fill="none" stroke="${col}" stroke-opacity="0.2" stroke-width="3" clip-path="url(#list-in-${i})"/>`);
    }
    parts.push(`<path d="${d}" fill="${washed ? col : 'none'}" fill-opacity="0.12" stroke="${col}" stroke-width="${rne ? 0.45 : 0.55}"${rne ? ' stroke-dasharray="0.5,0.7" stroke-linecap="round"' : nominated ? ' stroke-dasharray="2,1"' : ''} fill-rule="nonzero"/>`);
    // the name inside the place: at its middle in the strip, else a little way off it, wherever the other labels leave room
    const text = clipName(p.name), inside = p.rings.map((r) => r.map(([lon, lat]) => wproj(lon, lat)));
    if (spot.area > 0) for (const [dx, dy] of [[0, 0], [0, -10], [0, 10], [-45, 0], [45, 0], [-90, 0], [90, 0], [-45, -20], [45, 20]] as [number, number][]) {
      const x = spot.cx + dx, y = spot.cy + dy;
      if (x < 20 || x > wp.wMm - 20 || y < 5 || y > wp.hMm - 5 || !inRings(x, y, inside)) continue;
      if (spacer.take(x, y, labelW(text, 2), 2.6)) { parts.push(label(x, y, text, 2, col)); break; }
    }
  }
  for (const p of listsIn.filter((q) => q.coversStrip)) legend.push({ swatch: `<rect x="0.3" y="0.4" width="4.4" height="2.6" fill="none" stroke="${p.list === 'RNE' ? RNE_COLOUR : LIST_COLOUR}" stroke-width="0.35" stroke-dasharray="1.2,0.6"/>`, label: `The whole strip: ${p.name}, ${p.list === 'RNE' ? `${listStatus(p.list, p.status)} on the archived RNE` : /^nominated/i.test(p.status) ? `nominated to the ${LIST_WORD[p.list]}, not listed` : `${listStatus(p.list, p.status)} on the ${LIST_WORD[p.list]}`}` });
  const natIn = listsIn.filter((q) => !q.coversStrip && q.list !== 'RNE'), nominatedIn = natIn.filter((q) => /^nominated/i.test(q.status));
  if (natIn.length) legend.push(nominatedIn.length === natIn.length
    ? { swatch: `<rect x="0.3" y="0.4" width="4.4" height="2.6" fill="none" stroke="${LIST_COLOUR}" stroke-width="0.4" stroke-dasharray="2,1"/>`, label: `Indigenous place nominated to the ${listWords([...new Set(natIn.map((q) => LIST_WORD[q.list]))])}, not listed` }
    : { swatch: swatchFill(LIST_COLOUR, LIST_COLOUR, nominatedIn.length ? '2,1' : undefined).replace('fill="', 'fill-opacity="0.25" fill="'), label: `Indigenous place on the National or Commonwealth Heritage List${nominatedIn.length ? ', dashed where only nominated' : ''}` });
  if (listsIn.some((q) => !q.coversStrip && q.list === 'RNE')) legend.push({ swatch: `<rect x="0.3" y="0.4" width="4.4" height="2.6" fill="none" stroke="${RNE_COLOUR}" stroke-width="0.4" stroke-dasharray="0.5,0.7" stroke-linecap="round"/>`, label: 'Indigenous place on the Register of the National Estate (archived 2007, not statutory)' });
  // Heritage NSW's permits to harm Aboriginal objects, dashed where the permit has run out
  const permits = c.ahips?.permits ?? [];
  if (permits.length) {
    const state = new Map(f.ahips.permits.map((q) => [q.id, q.active]));
    for (const p of permits) parts.push(`<path d="${ringsPath(p.rings, wproj)}" fill="${AHIP_COLOUR}" fill-opacity="0.16" stroke="${AHIP_COLOUR}" stroke-width="0.45" fill-rule="nonzero"${state.get(p.id) ? '' : ' stroke-dasharray="1.4,0.8"'}/>`);
    // A busy council area holds a hundred permits: naming every one carpets the
    // map, so only the nearest few carry their number and the legend counts the rest.
    const named = new Set([...f.ahips.permits].sort((x, y) => x.distanceM - y.distanceM).slice(0, AHIP_NAMED).map((q) => q.id));
    for (const p of permits) {
      if (!named.has(p.id)) continue;
      const spot = bestSpot(p.rings), text = `AHIP ${p.id}`;
      const [x, y] = spot.area > 0 ? [spot.cx, spot.cy] : wproj(p.lon, p.lat);
      if (!onMap(x, y)) continue;
      // a permit over a lot or two is a speck at this scale: a dot marks it, and the name goes beside the dot
      const small = spot.area < 4, w = labelW(text, 1.9);
      if (small) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="${AHIP_COLOUR}" stroke="#ffffff" stroke-width="0.3"/>`);
      for (const [lx, ly] of (small ? [[x, y - 2.6], [x, y + 3.2], [x + w / 2 + 1.8, y + 0.2], [x - w / 2 - 1.8, y + 0.2]] : [[x, y], [x, y - 3], [x, y + 3]]) as [number, number][]) if (spacer.take(lx, ly, w, 2.4)) { parts.push(label(lx, ly, text, 1.9, AHIP_COLOUR)); break; }
    }
    legend.push({ swatch: swatchFill(AHIP_COLOUR, AHIP_COLOUR, [...state.values()].some((v) => !v) ? '1.4,0.8' : undefined).replace('fill="', 'fill-opacity="0.3" fill="'), label: `Aboriginal Heritage Impact Permit boundary (Heritage NSW)${[...state.values()].some((v) => !v) ? ', dashed where expired' : ''}${permits.length > AHIP_NAMED ? `; ${permits.length} on the page, the nearest ${AHIP_NAMED} numbered` : ''}` });
  }
  // gazetted Aboriginal Places: in the strip drawn, beyond it pointed to
  const placesIn = c.places.filter((p) => { const [x, y] = wproj(p.lon, p.lat); return x >= 0 && y >= 0 && x <= wp.wMm && y <= wp.hMm; });
  for (const p of placesIn) {
    const [x, y] = wproj(p.lon, p.lat);
    if (p.rings.length) parts.push(`<path d="${ringsPath(p.rings, wproj)}" fill="${PLACE_COLOUR}" fill-opacity="0.3" stroke="${PLACE_COLOUR}" stroke-width="0.5" fill-rule="evenodd"/>`);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${PLACE_COLOUR}" stroke="#ffffff" stroke-width="0.35"/>`);
    const text = p.name;
    if (spacer.take(x, y - 3.2, labelW(text, 2.1), 2.6)) parts.push(label(x, y - 3.2, text, 2.1, PLACE_COLOUR));
  }
  const beyond = c.places.filter((p) => !placesIn.includes(p)).slice(0, 3);
  for (const p of beyond) {
    const a = (p.bearing * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
    const inset = 5;
    const tX = ux > 1e-9 ? (wp.wMm - inset - sx) / ux : ux < -1e-9 ? (inset - sx) / ux : Infinity;
    const tY = uy > 1e-9 ? (wp.hMm - inset - sy) / uy : uy < -1e-9 ? (inset - sy) / uy : Infinity;
    const tt = Math.min(tX, tY);
    const x = sx + ux * tt, y = sy + uy * tt;
    parts.push(`<path d="M${(x - uy * 1.4 - ux * 2.6).toFixed(1)},${(y + ux * 1.4 - uy * 2.6).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(x + uy * 1.4 - ux * 2.6).toFixed(1)},${(y - ux * 1.4 - uy * 2.6).toFixed(1)} Z" fill="${PLACE_COLOUR}"/>`);
    const text = `${p.name} ${p.distanceM >= 1000 ? `${(p.distanceM / 1000).toFixed(1)} km` : `${fmtNum(p.distanceM)} m`}`;
    const lx = x - ux * (4 + labelW(text, 2) / 2), ly = y - uy * 4 + (Math.abs(uy) < 0.5 ? 3.4 : 0);
    if (spacer.take(lx, ly, labelW(text, 2), 2.6)) parts.push(label(lx, ly, text, 2, PLACE_COLOUR));
  }
  if (c.places.length) legend.push({ swatch: `<circle cx="2.5" cy="1.8" r="1.5" fill="${PLACE_COLOUR}" stroke="#ffffff" stroke-width="0.3"/>`, label: `Gazetted Aboriginal Place${beyond.length ? '; an edge arrow points to one beyond the strip' : ''}` });
  // the LEPs' Aboriginal heritage items: the scheduled land washed, a small square at each so a single lot still shows, the item's name where there is room
  const lepIn = (c.lepAboriginal?.items ?? []).filter((it) => { const [x, y] = wproj(it.lon, it.lat); return x >= -2 && y >= -2 && x <= wp.wMm + 2 && y <= wp.hMm + 2; });
  if (lepIn.length) {
    parts.push(`<path d="${lepIn.map((it) => ringsPath(it.rings, wproj)).join('')}" fill="${LEP_ABORIGINAL_FILL}" fill-opacity="0.45" stroke="${LEP_ABORIGINAL_EDGE}" stroke-width="0.35" fill-rule="evenodd"/>`);
    for (const it of lepIn) {
      const [x, y] = wproj(it.lon, it.lat);
      parts.push(`<rect x="${(x - 1.1).toFixed(1)}" y="${(y - 1.1).toFixed(1)}" width="2.2" height="2.2" fill="${LEP_ABORIGINAL_FILL}" stroke="${LEP_ABORIGINAL_EDGE}" stroke-width="0.35"/>`);
    }
    for (const it of [...lepIn].sort((p, q) => p.name.length - q.name.length)) {
      const [x, y] = wproj(it.lon, it.lat);
      const text = it.name.length > 34 ? `${it.name.slice(0, 33).trimEnd()}…` : it.name;
      for (const [lx, ly] of [[x, y + 3.4], [x, y - 2.6], [x + labelW(text, 1.9) / 2 + 2, y + 0.6], [x - labelW(text, 1.9) / 2 - 2, y + 0.6]] as [number, number][])
        if (spacer.take(lx, ly - 0.7, labelW(text, 1.9), 2.4)) { parts.push(label(lx, ly, text, 1.9, LEP_ABORIGINAL_EDGE)); break; }
    }
    legend.push({ swatch: `<rect x="0.6" y="0.5" width="3.8" height="2.6" fill="${LEP_ABORIGINAL_FILL}" fill-opacity="0.6" stroke="${LEP_ABORIGINAL_EDGE}" stroke-width="0.3"/>`, label: 'Aboriginal heritage item in the LEP heritage schedule' });
  }
  // the suburbs, lightly, for orientation
  for (const ft of b.wide.suburbs.features) {
    const name = String(ft.properties?.suburbname ?? '');
    if (!name) continue;
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of geomRings(ft.geometry)) { const s = clippedStats(r, wproj, wp); if (s.area > best.area) best = s; }
    if (best.area < 150) continue;
    const text = titleCase(name);
    if (spacer.take(best.cx, best.cy, labelW(text, 2.1) + 1, 3)) parts.push(`<text x="${best.cx.toFixed(1)}" y="${(best.cy + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.1" letter-spacing="0.08em" fill="#6f665a" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">${esc(text.toUpperCase())}</text>`);
  }
  parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.2" fill="#ffffff" stroke="${t.site}" stroke-width="0.6"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="0.9" fill="${t.site}"/>`);
  legend.push({ swatch: `<circle cx="2.5" cy="1.8" r="1.6" fill="#ffffff" stroke="${t.site}" stroke-width="0.5"/><circle cx="2.5" cy="1.8" r="0.7" fill="${t.site}"/>`, label: 'The site' });
  parts.push(panelFurniture(wp, 'right'));
  if (!c.dem && !c.vegetation.image && !c.water.courses.length) parts.push(emptyNote(['The Country layers did not answer for this run.']));
  const mapSvg = `<svg width="${wp.wMm}mm" height="${wp.hMm}mm" viewBox="0 0 ${wp.wMm} ${wp.hMm}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="display:block">
    <defs><clipPath id="clip-country"><rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}"/></clipPath>${defs.join('')}</defs>
    <g clip-path="url(#clip-country)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${wp.wMm - 0.2}" height="${wp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;
  const leg = legendSvg(legend, FIELD_W, Math.min(6, Math.max(4, Math.ceil(legend.length / 2))), 2.05);

  // ---- the table, the communities and the note
  const dir = compassWord;
  const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${fmtNum(m)} m`);
  const nt = f.nativeTitle;
  const clip = (str: string, max: number) => (str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str);
  const rows: [string, string][] = [
    ['Land Council', f.lalc ? `${f.lalc.local} Local Aboriginal Land Council${f.lalc.regional ? ` · ${f.lalc.regional} regional council` : ''}${f.lalcsInStrip.length > 1 ? ` · the strip also takes in ${listWords(f.lalcsInStrip.filter((l) => l.toLowerCase() !== f.lalc!.local.toLowerCase()))}` : ''}` : 'not read'],
    ['Native title', nt.ok ? (nt.atSite.length ? nt.atSite.map((r) => `${r.name} — ${NT_KIND_WORD[r.kind]}${r.detail ? `, ${r.detail.toLowerCase()}` : ''}${r.date ? ` (${fmtIso(r.date)})` : ''}`).join(' · ') : `none over the site (no determination, registered claim or ILUA)${nt.inWindow.determinations + nt.inWindow.claims + nt.inWindow.iluas ? ` · in the strip: ${[nt.inWindow.determinations ? `${nt.inWindow.determinations} determination` : '', nt.inWindow.claims ? `${nt.inWindow.claims} claim` : '', nt.inWindow.iluas ? `${nt.inWindow.iluas} ILUA` : ''].filter(Boolean).join(', ')}` : ''}${nt.currency ? ` · registers current ${fmtIso(nt.currency)}` : ''}`) : 'the NNTT registers did not answer'],
    ['Pre-1750 vegetation', f.vegetation.atSite ? `${f.vegetation.atSite.pct}${f.vegetation.atSite.pctId && f.vegetation.atSite.pctId !== '0' ? ` (PCT ${f.vegetation.atSite.pctId})` : ''}${f.vegetation.atSite.cls ? ` · ${f.vegetation.atSite.cls}` : ''}${f.vegetation.atSite.formation ? ` · ${f.vegetation.atSite.formation}` : ''}` : f.vegetation.ok ? 'not classified at the site' : 'the vegetation model did not answer'],
    ['Soil landscape', f.soil ? `${titleCase(f.soil.name)}${f.soil.process ? ` (${f.soil.process.toLowerCase()})` : ''} · ${f.soil.sheet} sheet` : (f.soilNote ?? 'outside the published sheet')],
    ['Watercourses', f.courses.length ? `${f.courses.slice(0, 3).map((w) => `${w.name} ${km(w.distanceM)} ${dir(w.bearing)}${w.perenniality !== 'unknown' ? `, ${w.perenniality}` : ''}`).join(' · ')}${f.courseLines > f.courses.length ? ` · ${f.courseLines - f.courses.length} unnamed line${f.courseLines - f.courses.length === 1 ? '' : 's'} in the strip` : ''}` : f.waterOk ? `no named watercourse in the strip${f.courseLines ? ` · ${f.courseLines} unnamed line${f.courseLines === 1 ? '' : 's'}` : ''}` : 'not read'],
    ['Foreshore', f.shore ? `${f.shore.kind === 'coast' ? 'coastline' : 'water body'} ${km(f.shore.distanceM)} to the ${dir(f.shore.bearing)}` : 'no coast or water body in the strip'],
    ['Landform', f.landform.hasDem ? `site RL ${f.landform.siteRl ?? '—'}${f.landform.nearestRidge ? ` · nearest crest above it ${km(f.landform.nearestRidge.distanceM)} ${dir(f.landform.nearestRidge.bearing)} at RL ${f.landform.nearestRidge.rl}` : f.landform.ridgeLines ? ' · no crest above the site in the strip' : ' · no crest stands out at the model\'s resolution'}${f.landform.highestRidge ? ` · highest crest RL ${f.landform.highestRidge.rl}, ${km(f.landform.highestRidge.distanceM)} ${dir(f.landform.highestRidge.bearing)}` : ''} · the strip RL ${f.landform.min}–${f.landform.max}` : 'the elevation model did not answer'],
    ['National parks', f.npws.length ? f.npws.join(' · ') : 'none in the strip'],
    ['Aboriginal Places', f.placesOk ? (f.placeCount ? `${f.placeCount} gazetted within ${f.placesRadiusM / 1000} km: ${f.places.slice(0, 4).map((p) => `${p.name} ${km(p.distanceM)} ${dir(p.bearing)}${p.gazetted ? ` (${p.gazetted.slice(0, 4)})` : ''}${p.restricted ? ', location generalised' : ''}`).join(' · ')}` : `none gazetted within ${f.placesRadiusM / 1000} km`) : 'the register did not answer'],
    ['LEP Aboriginal heritage', [
      !f.lepAboriginal.read ? 'items not read for this deck' : f.lepAboriginal.ok ? (f.lepAboriginal.items.length ? `${f.lepAboriginal.items.length} item${f.lepAboriginal.items.length === 1 ? '' : 's'} scheduled in the strip (${f.lepAboriginal.epis.join(', ')}): ${f.lepAboriginal.items.slice(0, 4).map((i) => `${i.name}${i.id ? ` ${i.id}` : ''} ${i.onSite ? 'on the site' : `${km(i.distanceM)} ${dir(i.bearing)}`}`).join(' · ')}${f.lepAboriginal.items.length > 4 ? ` · ${f.lepAboriginal.items.length - 4} more` : ''}` : 'no item scheduled in the strip') : 'the heritage maps did not answer',
      !f.lepAreas.read ? '' : f.lepAreas.ok ? (f.lepAreas.areas.length ? f.lepAreas.areas.map((a) => `${a.cls} (${a.epi}) ${a.coversStrip ? 'over the whole strip' : besideWords(a)}`).join(' · ') : 'no Aboriginal landscape or significance map over the strip') : 'the landscape maps did not answer',
    ].filter(Boolean).join(' · ')],
    ['Impact permits (AHIP)', !f.ahips.read ? 'not read for this deck' : f.ahips.ok ? (f.ahips.permits.length ? `${f.ahips.permits.length} in the strip${f.ahips.active ? `, ${f.ahips.active} active` : ''}: ${f.ahips.permits.slice(0, 3).map((q) => `${q.id} ${clipWords(q.project || 'unnamed project', 48)}, ${permitState(q)}, ${besideWords(q)}`).join(' · ')}${f.ahips.permits.length > 3 ? ` · ${f.ahips.permits.length - 3} more` : ''}` : 'no permit boundary in the strip (the layer leaves out a few; the public register lists all)') : "Heritage NSW's layer did not answer"],
    ['Heritage lists', !f.lists.read ? 'not read for this deck' : (() => {
      const nat = f.lists.places.filter((q) => q.list !== 'RNE');
      const silent = [!f.lists.answered.nhl ? 'NHL' : '', !f.lists.answered.chl ? 'CHL' : ''].filter(Boolean);
      const size = (q: (typeof nat)[number]) => (q.hectares && q.hectares >= 1000 ? ` (${fmtNum(Math.round(q.hectares / 100))} km²)` : '');
      return [...nat.slice(0, 3).map((q) => `${q.name} — ${q.nominated ? `nominated to the ${LIST_WORD[q.list]}, not listed` : `${q.status} on the ${LIST_WORD[q.list]}`} · ${q.coversStrip ? `covers the whole strip${size(q)}` : q.onSite ? `takes in the site${size(q)}` : besideWords(q)}`),
        nat.length > 3 ? `${nat.length - 3} more` : '', !nat.length && !silent.length ? 'no Indigenous place of the National or Commonwealth Heritage List in the strip' : '', silent.length ? `the ${silent.join(' and ')} did not answer` : ''].filter(Boolean).join(' · ');
    })()],
    ['RNE (archived)', !f.lists.read ? 'not read for this deck' : !f.lists.answered.rne ? 'the archive did not answer' : (() => {
      const rne = f.lists.places.filter((q) => q.list === 'RNE');
      return `closed in 2007, not statutory · ${rne.length ? `${rne.slice(0, 3).map((q) => `${q.name} (${q.status}) ${q.coversStrip ? 'over the whole strip' : besideWords(q)}`).join(' · ')}${rne.length > 3 ? ` · ${rne.length - 3} more` : ''}` : 'no Indigenous place in the strip'}`;
    })()],
    ['ASDST', f.asdst.ok && f.asdst.likelihood !== null ? `combined-features likelihood ${f.asdst.likelihood} of ${f.asdst.scaleMax} at the site${f.asdst.surveyPriority !== null ? ` · survey priority ${f.asdst.surveyPriority}` : ''} · a relative model, not a register` : 'the model did not answer'],
    ['AHIMS', 'not open data · a search is required before any works'],
  ];
  const table = `<table class="da facts"><tbody>${rows.map(([kk, vv]) => `<tr><th>${esc(kk)}</th><td>${esc(vv)}</td></tr>`).join('')}</tbody></table>`;
  // the communities in the strip, in the map's colours
  const classes = f.vegetation.classes;
  const barW = 18, barX = AUX_W - barW - 9, rowH = 7.6, vegH = classes.length ? classes.length * rowH + 6 : 0;
  const vegSvg = classes.length ? `<svg width="${AUX_W}mm" height="${vegH}mm" viewBox="0 0 ${AUX_W} ${vegH}" xmlns="http://www.w3.org/2000/svg" font-family="${t.font}">
    <text x="0" y="3" font-size="2.3" font-weight="600" fill="${t.ink}">Pre-1750 plant communities across the strip<tspan font-weight="400" fill="#737c77"> · share of its area (State Vegetation Type Map)</tspan></text>
    ${classes.map((k, i) => { const y = 6 + i * rowH; const w = Math.max(0.6, (k.sharePct / Math.max(1, classes[0].sharePct)) * barW); return `<rect x="0" y="${(y + 0.6).toFixed(1)}" width="4" height="4" fill="${k.colour}" stroke="#777" stroke-width="0.15"/>` +
      `<text x="6" y="${(y + 2.4).toFixed(1)}" font-size="2.25" font-weight="600" fill="${t.ink}">${esc(clip(k.pct, 36))}${k.pctId && k.pctId !== '0' ? `<tspan font-weight="400" fill="#737c77"> · PCT ${esc(k.pctId)}</tspan>` : ''}</text>` +
      `<text x="6" y="${(y + 5.3).toFixed(1)}" font-size="1.9" fill="#737c77">${esc(clip([k.cls, k.formation].filter(Boolean).join(' · '), 52))}</text>` +
      `<rect x="${barX.toFixed(1)}" y="${(y + 0.9).toFixed(1)}" width="${w.toFixed(1)}" height="3.4" fill="${k.colour}" fill-opacity="0.85"/>` +
      `<text x="${(barX + w + 1.4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-size="2.2" font-weight="600" fill="${t.ink}">${fmtPct(k.sharePct)}</text>`; }).join('')}
  </svg>` : '';
  const note = `<div class="cnote"><p><b>AHIMS.</b> Registered Aboriginal sites and places are held in the Aboriginal Heritage Information Management System, which is not open data and is not read here. An AHIMS search — and, where it, the landform, the ASDST model or the community advise it, a due-diligence assessment and consultation under the National Parks and Wildlife Act — comes before any ground disturbance.</p><p><b>Country.</b> The name of Country, the language, the place names and the cultural narrative are not generated from these layers: the office develops them with Knowledge Holders and the ${f.lalc ? `${esc(f.lalc.local)} ` : ''}Local Aboriginal Land Council. The layers here are the open proxies — land council, native title, the pre-1750 forest, the creeks and the crests.</p></div>`;

  const sentences = countrySentences(b, f);
  const text = sentences.map((s) => `<p>${esc(s)}</p>`).join('') +
    placeholder('Acknowledgement of Country and the cultural narrative — with Knowledge Holders: whose Country, its name and language, and which features of it (the crest, the creek line, the foreshore, the pre-1750 forest) the design answers to.') +
    `<div class="fine">Sources: NSW Spatial Services administrative boundaries (Local Aboriginal Land Councils); the National Native Title Tribunal's registers of determinations, claims and Indigenous land use agreements; the Aboriginal items of the LEPs' heritage maps and the Aboriginal landscape maps of their local provisions (ePlanning); Heritage NSW's gazetted Aboriginal Places (via the State's heritage service) and Aboriginal Heritage Impact Permit boundaries; the Indigenous places of the National and Commonwealth Heritage Lists and of the Register of the National Estate, an archive since 2007 (DCCEEW); the NSW State Vegetation Type Map, pre-1750 plant community types, and the Aboriginal Sites Decision Support Tool model (DCCEEW); the soil landscape sheet; NSW Spatial Services water theme; the NPWS estate; the 5 m elevation model at 8 m over the strip, its crests read as the cells that stand above their neighbours. AHIMS is not read. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const legendTop = FIELD_Y + PANEL_TITLE_H + wp.hMm + 1.5;
  const belowY = legendTop + leg.heightMm + 3;
  const belowH = SLIDE_H - 12 - belowY;
  const figure = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">Country<span class="pnote">1:${fmtNum(wp.scale)} · ${f.stripKm.w} × ${f.stripKm.h} km · the pre-1750 plant communities over the land's shape, with the watercourses, the crests and the Aboriginal heritage layers</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <svg class="abs" style="left:${FIELD_X}mm;top:${legendTop}mm" width="${FIELD_W}mm" height="${leg.heightMm}mm" viewBox="0 0 ${FIELD_W} ${leg.heightMm}" xmlns="http://www.w3.org/2000/svg">${leg.svg}</svg>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${belowY}mm;width:${FIELD_W}mm">Country at the site<span class="pnote">the open layers, read at the geocoded point and over the strip</span></div>
    <div class="abs" data-fit data-fit-note="country-more" style="left:${FIELD_X}mm;top:${belowY + PANEL_TITLE_H}mm;width:${FIELD_W}mm;height:${belowH - PANEL_TITLE_H}mm;overflow:hidden">${table}</div>
    <div class="abs" id="country-more" hidden data-text="{n} more rows did not fit; the deck's JSON (overall.json) holds them all." style="left:${FIELD_X}mm;width:${FIELD_W}mm;font-size:2.1mm;line-height:1.3;color:#6a7572"></div>
    <div class="abs" style="left:${AUX_X}mm;top:${FIELD_Y}mm;width:${AUX_W}mm;height:${SLIDE_H - FIELD_Y - 14}mm;overflow:hidden">
      ${vegSvg}
      <div style="margin-top:${classes.length ? 2 : 0}mm">${note}</div>
    </div>`;
  const onSitePermit = f.ahips.permits.find((q) => q.onSite), onSiteArea = f.lepAreas.areas.find((a) => a.onSite);
  const sub = [b.siteAddress, f.lalc ? `${f.lalc.local} LALC` : '', f.vegetation.atSite?.pct ?? '', onSiteArea ? onSiteArea.cls : '', onSitePermit ? `AHIP ${onSitePermit.id} over the site` : '', 'AHIMS search required'].filter(Boolean).join(' · ');
  return { id: '15_country', title: 'Country', subtitle: sub, textHtml: text, figureHtml: figure };
}

/** The overall analysis deck: it has no themes, and is always drawn in its own template. */
export function renderSlides(b: SlidesBundle, meta: SheetMeta): { html: string; slides: Slide[] } {
  return withTemplate(DECK_TEMPLATE, () => drawSlides(b, meta));
}

function drawSlides(b: SlidesBundle, meta: SheetMeta): { html: string; slides: Slide[] } {
  const facts = planningFacts(b);
  const slides = [locationSlide(b), characterAtlas(b), planningAtlas(b), controlsAtlas(b, facts), strategicAtlas(b, facts), topographyAtlas(b), developmentAtlas(b, facts), builtFormAtlas(b, facts), movementSlide(b), greenAtlas(b), siteAtlas(b), conditionAtlas(b), sunAtlas(b), constraintsAtlas(b), countryAtlas(b), peopleAtlas(b), ocAtlas(b, facts), sourcesAtlas(b, facts)];
  const t = tpl();
  const footerLeft = ['SITE ANALYST — OVERALL ANALYSIS', b.siteAddress, meta.client ? `for ${meta.client}` : '', meta.jobNo ? `job ${meta.jobNo}` : ''].filter(Boolean).join(' · ');
  // The atlas page, after the office's template (Z. 2026-10): measurements in mm from her A3 spread.
  const atlasPage = (s: Slide, i: number) => {
    const [line1, ...rest] = s.subtitle.split(' · ');
    return `
<section class="slide atlas" id="${esc(s.id)}">
  <div class="abs znum" style="left:12mm;top:10.6mm">${String(i + 1).padStart(2, '0')}</div>
  <div class="abs znum" style="left:75.3mm;top:10.6mm">${esc(s.title)}</div>
  <div class="abs zrule" style="left:12mm;top:20mm;width:186mm"></div>
  <div class="abs zsub" style="left:75.3mm;top:23.8mm;width:122.7mm">${esc(line1)}${rest.length ? `<br>${rest.map(esc).join('<span class="zbar">|</span>')}` : ''}</div>
  <div class="abs zrule" style="left:75.33mm;top:35mm;width:122.67mm"></div>
  ${s.narrative ? `<div class="abs znarr" style="left:12mm;top:43.9mm;width:58.5mm;color:${s.accent ?? '#000000'}">${esc(s.narrative)}</div>` : ''}
  ${s.textHtml ? `<div class="abs zbody" style="left:75.3mm;top:44mm;width:122.7mm">${s.textHtml}</div>` : ''}
  ${s.figureHtml}
  ${s.legend?.length ? zLegend(s.legend) : ''}
  ${s.sources ? `<div class="abs zsrc" style="left:12mm;bottom:11.6mm;width:58.5mm">${esc(s.sources)}</div>` : ''}
</section>`;
  };
  const pages = slides.map((s, i) => s.bleed || s.full ? atlasPage(s, i) : `
<section class="slide${s.bleed || s.full ? ' atlas' : ''}" id="${esc(s.id)}">
  <div class="abs rh" style="left:${L_X}mm;top:10mm;width:${s.full ? 115 : L_W}mm"><span>Overall analysis</span>${s.full ? '' : `<span>${esc(b.siteAddress)}</span>`}</div>
  ${s.bleed || s.full ? '' : `<div class="abs rh" style="left:${FIELD_X}mm;top:10mm;width:${FIELD_W}mm"><span>${esc(s.title)}</span><span>${String(i + 1).padStart(2, '0')} / ${slides.length}</span></div>
  <div class="abs foldtick" style="left:${FOLD}mm;top:3mm"></div>
  <div class="abs foldtick" style="left:${FOLD}mm;top:${SLIDE_H - 7}mm"></div>`}
  <div class="abs title" style="left:${L_X}mm;top:17.5mm;width:${s.full ? 115 : L_W}mm">${esc(s.title)}</div>
  <div class="abs subtitle" style="left:${L_X}mm;top:26.5mm;width:${s.full ? 115 : L_W}mm">${esc(s.subtitle)}</div>
  <div class="abs text" style="left:${L_X}mm;top:${s.textY ?? FIELD_Y}mm;width:${TEXT_W}mm;height:${SLIDE_H - (s.textY ?? FIELD_Y) - 16}mm">${s.textHtml}</div>
  ${s.figureHtml}
  <div class="abs foot" style="left:${L_X}mm;top:${FOOT_Y}mm;width:${s.full ? 115 : L_W}mm"><span>${s.bleed || s.full ? '' : esc(footerLeft)}</span><span>${s.full ? '' : i * 2 + 1}</span></div>
  ${s.bleed || s.full ? `<div class="abs foot" style="left:${FIELD_X}mm;top:${FOOT_Y}mm;width:${FIELD_W}mm"><span></span><span style="background:#ffffff;padding:0 1.6mm">${s.full ? `${i * 2 + 1}–${i * 2 + 2}` : i * 2 + 2}</span></div>` : `<div class="abs foot" style="left:${FIELD_X}mm;top:${FOOT_Y}mm;width:${FIELD_W}mm"><span>generated ${esc(b.generatedAt.slice(0, 10))}</span><span>${i * 2 + 2}</span></div>`}
</section>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(b.siteAddress)} — OVERALL ANALYSIS</title>
<style>
  @page { size: ${SLIDE_W}mm ${SLIDE_H}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { font-family: ${t.font}; background: ${t.paper}; color: ${t.ink}; }
  .slide { position: relative; width: ${SLIDE_W}mm; height: ${SLIDE_H}mm; overflow: hidden; background: ${t.paper}; page-break-after: always; break-after: page; }
  .slide:last-child { page-break-after: auto; break-after: auto; }
  .abs { position: absolute; }
  .title { font-size: 6.6mm; font-weight: 500; letter-spacing: -0.015em; line-height: 1; }
  .rh { display: flex; justify-content: space-between; font-size: 2.0mm; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #8a918c; }
  .foldtick { width: 0; height: 4mm; border-left: 0.15mm solid ${t.rule}; }
  .ptitle.sm { font-size: 2.4mm; }
  .aux-t { position: static; height: auto; line-height: 1.25; white-space: normal; margin: 3mm 0 1mm; }
  .ptitle.sm .pnote { font-size: 1.95mm; margin-left: 1.6mm; }
  .maplabel { font-size: 2.4mm; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; background: #ffffff; padding: 1mm 2.2mm 1mm 2mm; }
  .maplabel .pnote { font-weight: 400; letter-spacing: 0.02em; text-transform: none; color: #737c77; font-size: 2.2mm; margin-left: 2mm; }
  .statrows .tile { border-top: 0.15mm solid ${t.ink}; padding: 1.8mm 0 2.6mm; }
  .statrows .tv { font-size: 6.2mm; }
  .tiles.col { grid-template-columns: 1fr; gap: 2.6mm; }
  .tiles.two { grid-template-columns: repeat(2, 1fr); gap: 2.6mm; }
  .subtitle { font-size: 2.7mm; color: #6a7572; letter-spacing: 0.02em; margin-top: 0.4mm; }
  .text { font-size: 3.05mm; line-height: 1.38; overflow: hidden; }
  .text p { margin-bottom: 2.6mm; }
  .text p.ph { color: #8a918c; border-left: 0.4mm solid #d8cfc0; padding-left: 2.2mm; }
  .text .fine { position: absolute; bottom: 0; left: 0; right: 0; font-size: 2.1mm; line-height: 1.3; color: #6a7572; }
  .ptitle { font-size: 2.65mm; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; line-height: ${PANEL_TITLE_H}mm; height: ${PANEL_TITLE_H}mm; white-space: nowrap; overflow: hidden; }
  .pnote { font-weight: 400; color: #737c77; font-size: 2.2mm; margin-left: 2.4mm; letter-spacing: 0; text-transform: none; }
  table.controls { width: 100%; border-collapse: collapse; font-size: 2.55mm; line-height: 1.32; }
  table.controls th, table.controls td { text-align: left; vertical-align: top; padding: 1.15mm 2mm 1.15mm 0; border-top: 0.15mm solid ${t.rule}; }
  table.controls thead th { font-size: 2.2mm; letter-spacing: 0.04em; text-transform: uppercase; color: #6a7572; font-weight: 600; border-top: 0; padding-bottom: 0.8mm; }
  table.controls tbody th { font-weight: 600; }
  table.controls td.src { color: #6a7572; font-size: 2.25mm; }
  table.controls .lnk a { color: #6a7572; text-decoration: none; word-break: break-all; }
  .foot { display: flex; justify-content: space-between; font-size: 2.1mm; color: #6a7572; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .tile { border-top: 0.2mm solid ${t.ink}; padding-top: 1.6mm; }
  .tv { font-size: 5.4mm; font-weight: 500; line-height: 1.05; letter-spacing: -0.015em; }
  .tl { font-size: 2.1mm; color: #6a7572; margin-top: 0.8mm; line-height: 1.25; }
  .tiles.seven { grid-template-columns: repeat(7, 1fr); gap: 2.4mm; }
  .tiles.seven .tv { font-size: 4.9mm; }
  .tv.long { font-size: 4.1mm; }
  table.cmp { width: 100%; border-collapse: collapse; font-size: 2.3mm; line-height: 1.25; }
  table.cmp th, table.cmp td { text-align: right; vertical-align: top; padding: 0.85mm 0 0.85mm 1.5mm; border-top: 0.15mm solid ${t.rule}; font-variant-numeric: tabular-nums; }
  table.cmp th:first-child, table.cmp td:first-child { text-align: left; padding-left: 0; }
  table.cmp thead th { font-size: 2.0mm; letter-spacing: 0.04em; text-transform: uppercase; color: #6a7572; border-top: 0; padding-bottom: 0.7mm; font-weight: 600; }
  table.cmp td.hi { font-weight: 600; }
  .stat { font-size: 2.2mm; color: #454f4b; line-height: 1.3; margin-bottom: 1mm; }
  .legend { font-size: 2.15mm; color: #454f4b; line-height: 1.3; }
  .lg { display: flex; align-items: flex-start; gap: 1.6mm; margin-bottom: 0.7mm; }
  .lg svg { flex: none; margin-top: 0.1mm; }
  table.da { width: 100%; border-collapse: collapse; font-size: 2.3mm; line-height: 1.28; }
  table.da th, table.da td { text-align: left; vertical-align: top; padding: 0.95mm 1.6mm 0.95mm 0; border-top: 0.15mm solid ${t.rule}; }
  table.da thead th { font-size: 2.05mm; letter-spacing: 0.04em; text-transform: uppercase; color: #6a7572; border-top: 0; padding-bottom: 0.7mm; }
  table.da .n { width: 5mm; font-weight: 600; }
  table.da .r { text-align: right; padding-right: 3mm; font-variant-numeric: tabular-nums; }
  table.da .more { color: #6a7572; }
  table.da .dot { display: inline-block; width: 2.2mm; height: 2.2mm; border-radius: 50%; border: 0.25mm solid; margin-right: 1.2mm; vertical-align: -0.3mm; }
  table.da .dot.dia { border-radius: 0.2mm; transform: rotate(45deg) scale(0.8); }
  table.da.cons { font-size: 2.2mm; line-height: 1.22; }
  table.da.cons th, table.da.cons td { padding: 0.7mm 1.4mm 0.7mm 0; }
  table.da.cons tr.hit td { font-weight: 600; }
  table.da.cons tr.hit td:first-child { border-left: 0.6mm solid ${t.site}; padding-left: 1.2mm; }
  table.da.facts th { width: 33mm; font-weight: 600; font-size: 2.2mm; text-transform: none; letter-spacing: 0; color: #454f4b; text-align: left; vertical-align: top; }
  .cnote { border-left: 0.6mm solid #b5703a; background: #f4ebdd; padding: 2mm 3mm; font-size: 2.35mm; line-height: 1.34; }
  .cnote p + p { margin-top: 1.2mm; }
  .cnote b { font-weight: 600; }
  /* spacing in em: the printer steps the type down to fit the box, and the rows close up with it */
  table.da.src { font-size: 2.0mm; line-height: 1.22; }
  table.da.src th, table.da.src td { padding: 0.275em 0.8em 0.275em 0; }
  table.da.src thead th { font-size: 0.95em; }
  table.da.src tr.grp td { font-weight: 600; padding-top: 0.85em; border-top: 0.3mm solid #a9a69b; color: #2a3534; }
  table.da.src td.used, table.da.src td.ret { font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.da.src td.attr { color: #59625d; }
  .wcap { width: 46mm; margin-top: 0.8mm; font-size: 1.9mm; line-height: 1.25; color: #6a7572; text-align: center; }
  .oc { display: flex; align-items: flex-start; gap: 1.8mm; font-size: 2.35mm; line-height: 1.32; margin-top: 1.4mm; padding-right: 2mm; }
  .oc .n { flex: 0 0 4.2mm; height: 4.2mm; border-radius: 2.1mm; color: #fff; font-weight: 600; font-size: 2.2mm; text-align: center; line-height: 4.2mm; margin-top: 0.1mm; }
  .oc .t b { font-weight: 600; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm 4mm; }
  .frame .img { position: relative; height: 40mm; background: #f1e9dc; overflow: hidden; }
  .frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .frame img.whole { object-fit: contain; }
  .frame .key { position: absolute; left: 2mm; top: 2mm; width: 6mm; height: 6mm; border-radius: 50%; background: ${CAMERA_COLOUR}; border: 0.35mm solid #fff; color: #fff; font-weight: 600; font-size: 2.9mm; line-height: 5.3mm; text-align: center; }
  .frame .cap { font-size: 2.05mm; line-height: 1.3; color: #454f4b; margin-top: 1mm; }
  .frame.ph .img { display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 8mm; border: 0.3mm dashed #cdc4b4; background: #f7f1e6; color: #9aa19b; font-size: 2.4mm; }
  .frame.ph .cap { color: #8a918c; }
  .photos.four { grid-template-columns: repeat(4, 1fr); gap: 2.5mm 3mm; }
  .photos.four .frame .img { height: 33mm; }
  .frame .key.plc { background: #2c4c9c; }
  .quote { border-left: 0.5mm solid #d8cfc0; padding: 0.4mm 0 0.4mm 2.6mm; margin: 0 0 2.6mm; }
  .quote p { font-size: 2.75mm; line-height: 1.36; margin-bottom: 1.2mm; }
  .qsrc { font-size: 2.05mm; color: #737c77; word-break: break-all; }
  .dim { color: #737c77; font-weight: 400; }
  table.da.strat { font-size: 2.25mm; line-height: 1.28; }
  table.da.strat th { width: auto; }
  table.da.strat tbody th { font-weight: 600; font-size: 2.05mm; letter-spacing: 0.04em; text-transform: uppercase; color: #6a7572; width: 16mm; padding-top: 1.3mm; }
  table.da.strat td { padding: 1.1mm 2mm 1.1mm 0; }
  table.da.strat td.status { width: 30mm; color: #59625d; }
  table.da.strat td.lnk { width: 34mm; }
  table.da.strat td.lnk a { color: #6a7572; text-decoration: none; word-break: break-all; font-size: 2.0mm; }
  table.da.strat tr.manual td { color: #8a918c; }
  table.da.strat tr.manual td b { font-weight: 600; }
  .slide.atlas { font-family: Arial, 'Liberation Sans', 'Helvetica Neue', Helvetica, sans-serif; color: #000000; }
  .slide.atlas .znum { font-size: 14pt; font-weight: 700; letter-spacing: 0.08em; line-height: 1.15; text-transform: uppercase; white-space: nowrap; }
  .slide.atlas .zrule { height: 0; border-top: 0.18mm solid #878787; }
  .slide.atlas .zsub { font-size: 8pt; line-height: 3.4mm; letter-spacing: 0.025em; text-transform: uppercase; }
  .slide.atlas .zbar { font-size: 8.4pt; padding: 0 0.15mm; }
  .slide.atlas .znarr { font-size: 10pt; font-weight: 700; line-height: 4.23mm; letter-spacing: 0.01em; hyphens: auto; }
  .slide.atlas .zbody, .slide.atlas .zbody p { font-size: 10pt; line-height: 4.23mm; hyphens: auto; }
  .slide.atlas .zbody p { margin: 0 0 4.23mm; }
  .slide.atlas .zsrc { font-size: 8pt; line-height: 3.4mm; color: #878787; hyphens: auto; overflow-wrap: anywhere; }
  .slide.atlas .zleg { left: 138.67mm; width: 59.33mm; bottom: 12.2mm; }
  .slide.atlas .zleg2 .zrow:first-child { border-top-color: transparent; }
  .slide.atlas .zrow { position: relative; border-top: 0.18mm solid #878787; min-height: 8.52mm; padding: 0.7mm 0 1mm 11.43mm; }
  .slide.atlas .zrow span { display: block; font-size: 6pt; line-height: 2.55mm; letter-spacing: 0.09em; text-transform: uppercase; hyphens: auto; }
  .slide.atlas .zsw { position: absolute; left: 0; top: 1.05mm; width: 7.7mm; height: 5.54mm; overflow: visible; }
  .slide.atlas .zflow { position: absolute; left: 75.33mm; width: 122.67mm; }
  .slide.atlas .zh { position: relative; height: 6.21mm; border-bottom: 0.18mm solid #878787; font-size: 10pt; line-height: 1.15; }
  .slide.atlas .zh span { position: absolute; left: 0; top: 0; white-space: nowrap; }
  .slide.atlas .zblk { margin-bottom: 7.5mm; }
  .slide.atlas .zr { position: relative; border-bottom: 0.18mm solid #878787; padding: 1.0mm 0 1.2mm 63.34mm; min-height: 3.4mm; }
  .slide.atlas .zr .l { position: absolute; left: 0; top: 1.35mm; width: 60mm; font-size: 6pt; line-height: 2.55mm; letter-spacing: 0.09em; }
  .slide.atlas .zr .v { font-size: 8pt; line-height: 3.4mm; hyphens: auto; overflow-wrap: anywhere; }
  .slide.atlas .zr .n { font-size: 6pt; line-height: 2.55mm; letter-spacing: 0.09em; color: #878787; margin-top: 0.5mm; overflow-wrap: anywhere; }
  .slide.atlas .zr.dim .v, .slide.atlas .zr.dim .l { color: #878787; }
  .slide.atlas .zr3 { display: grid; grid-template-columns: 46mm 88mm 52mm; padding-left: 0; }
  .slide.atlas .zr3 .l { position: static; width: auto; padding-top: 0.35mm; }
  .slide.atlas .zr3 .v { padding-right: 4mm; }
  .slide.atlas .zr3 .s { padding-top: 0.35mm; font-size: 6pt; line-height: 2.55mm; letter-spacing: 0.06em; color: #878787; overflow-wrap: anywhere; }
  .slide.atlas .zphoto { margin-top: 3mm; display: grid; grid-template-columns: 59.33mm 59.33mm; column-gap: 4mm; row-gap: 3mm; }
  .slide.atlas .zphoto .f { position: relative; }
  .slide.atlas .zphoto .im { width: 59.33mm; height: 39.5mm; overflow: hidden; background: #f2f2f2; display: flex; align-items: center; justify-content: center; font-size: 6pt; letter-spacing: 0.09em; text-transform: uppercase; color: #878787; }
  .slide.atlas .zphoto .im img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .slide.atlas .zphoto .k { position: absolute; left: 1.5mm; top: 1.5mm; min-width: 3.6mm; height: 3.6mm; border-radius: 1.8mm; background: #ffffff; font-size: 6pt; line-height: 3.6mm; text-align: center; }
  .slide.atlas .zphoto .c { font-size: 6pt; line-height: 2.55mm; letter-spacing: 0.06em; margin-top: 0.8mm; color: #000000; hyphens: auto; }
  .slide.atlas .zlist .it { position: relative; padding: 0 0 2.2mm 5.4mm; font-size: 8pt; line-height: 3.4mm; hyphens: auto; }
  .slide.atlas .zlist .it .no { position: absolute; left: 0; top: 0.2mm; width: 3.6mm; height: 3.6mm; border-radius: 1.8mm; font-size: 6pt; line-height: 3.6mm; text-align: center; color: #ffffff; }
  .slide.atlas .zlist .it b { font-weight: 700; }
  .slide.atlas .maplabel { font-size: 6pt; letter-spacing: 0.09em; text-transform: uppercase; background: #ffffff; padding: 1.3mm 2.4mm; line-height: 1.2; }
</style></head>
<body>${pages}</body></html>`;
  return { html, slides };
}

/** Everything the deck says, as data: the JSON beside the PDF. */
export function slidesFacts(b: SlidesBundle) {
  const facts = planningFacts(b);
  return {
    address: b.address,
    siteAddress: b.siteAddress,
    generatedAt: b.generatedAt,
    window: { scale: b.panel.scale, widthM: Math.round((PANEL_W / 1000) * b.panel.scale), heightM: Math.round((PANEL_H / 1000) * b.panel.scale), centre: mercatorToLonLat(b.panel.center) },
    site: { lotDescription: b.lotDescription, siteAreaSqm: b.siteAreaSqm, areaSource: 'NSW cadastre (confirm against survey)' },
    context: b.context,
    controlsAtSite: b.controls,
    planning: facts,
    housingTarget: b.housingTarget,
    councilDcp: b.cos,
    development: (() => { const d = developmentFacts(b); return { ...d, sentences: developmentSentences(b, d, facts) }; })(),
    people: peopleFacts(b),
    movement: (() => { const f = movementFacts(b); return { ...f, sentences: movementSentences(b, f) }; })(),
    theSite: (() => { const f = siteFacts(b); return { ...f, sentences: siteSentences(b, f) }; })(),
    location: (() => { const f = locationFacts(b); return { ...f, sentences: locationSentences(b, f) }; })(),
    character: (() => { const f = characterFacts(b); return { ...f, sentences: characterSentences(b, f) }; })(),
    strategic: (() => { const f = strategicFacts(b, facts); return { ...f, sentences: strategicSentences(b, f) }; })(),
    existingCondition: (() => { const f = photosFacts(b); return { ...f, sentences: photosSentences(b, f) }; })(),
    sunViews: (() => { const f = sunViewFacts(b); const { shadowHulls: _h, ...rest } = f; return { ...rest, sentences: sunViewSentences(b, f) }; })(),
    constraints: (() => { const f = constraintsFacts(b); return { ...f, sentences: constraintsSentences(b, f) }; })(),
    country: (() => { const f = countryFacts(b); return { ...f, sentences: countrySentences(b, f) }; })(),
    opportunitiesConstraints: (() => { const f = ocFacts(b, facts); const { draw: _d, panel: _p, sunArc: _a, ...rest } = f; return { ...rest, sentences: ocSentences(b, f) }; })(),
    sources: (() => { const f = sourcesFacts(b, facts); return { ...f, sentences: sourcesSentences(b, f) }; })(),
    green: (() => { const f = greenFacts(b); return { ...f, openSpace: { ...f.openSpace, spaces: f.openSpace.spaces.map(({ rings: _r, ...s }) => s), nearest: f.openSpace.nearest && (({ rings: _r, ...s }) => s)(f.openSpace.nearest), largest: f.openSpace.largest && (({ rings: _r, ...s }) => s)(f.openSpace.largest) }, sentences: greenSentences(b, f) }; })(),
    builtForm: (() => { const f = builtFormFacts(b, facts); return { ...f, sentences: builtFormSentences(b, f) }; })(),
    terrain: (() => { const f = terrainFacts(b); return f ? { ...f, sections: f.sections.map((s) => ({ ...s, samples: s.samples.filter((_, i) => i % 4 === 0) })), sentences: terrainSentences(b, f) } : { available: false, sentences: terrainSentences(b, f) }; })(),
    propertyApi: b.property,
    sentences: planningSentences(b, facts),
    sentenceList: sentenceList(planningSentences(b, facts)),
    warnings: b.warnings,
  };
}

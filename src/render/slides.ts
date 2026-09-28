// OVERALL ANALYSIS — the A3 landscape deck that is the content part of a
// feasibility study or design report (docs/SLIDES_SPEC.md). Each slide is a
// text column on the left and a figure field on the right; the maps are the
// sheet renderers' data at panel size, the tables are HTML.
//
// This file holds the deck chrome and the two planning slides (spec 03 and
// 04). Later slides are further functions returning a Slide.

import type { SlidesBundle } from '../pipeline.js';
import type { SheetMeta } from './sheet.js';
import type { GeoJSONFeature } from '../lib/arcgis.js';
import { tpl } from './template.js';
import { esc } from './chrome.js';
import {
  panelProjector, panelExtent, baseLayers, overLayers, panelFurniture, furnitureBox, siteMark, siteLabelPoint, stationMode, ringsPath, fcPath, ringStats, clippedStats, hatchPath, bboxOf,
  legendSvg, swatchFill, swatchHatch, swatchLine, LabelSpacer, type Proj, type Panel, type LegendEntry, type FurnitureCorner,
} from './minimap.js';
import { zoneFill, heritageStyle, hobRamp, POLICY_STYLE } from './lepPalette.js';
import { geomRings, pointInRing, titleCase, type PolicyArea, type PolicyKind } from '../fetch/planning.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import { isSignificant, siteKey, parseSiteAddress, sameLot, money, type DaRecord, type DaStatusClass, type SiteAddress } from '../fetch/da.js';
import type { PeopleData } from '../fetch/people.js';
import type { CensusProfile, DwellingMix, TenureMix, TravelMix, PersonsProfile, YearValue } from '../fetch/abs.js';
import type { Sale } from '../fetch/valuation.js';
import { lineWithProjection, pairedBars, columns, sectionSvg } from './charts.js';
import { hillshadeDataUri, planSections, sampleSection, siteLevels, gridExtremes, nearestWater, bearingName } from './terrainMap.js';
import { METRES_PER_STOREY, type Building } from '../fetch/buildings.js';
import type { CyclewayKind } from '../fetch/movement.js';
import type { FacilityKind } from '../fetch/greenSpace.js';
import { CONSTRAINT_DEFS, type ConstraintGroup } from '../fetch/constraints.js';
import type { PublicParcel } from '../fetch/site.js';
import { demAt } from '../fetch/terrain.js';
import { CHART } from './charts.js';
import type { XY } from '../lib/geo.js';

export const SLIDE_W = 420;
export const SLIDE_H = 297;
// The figure field is a 2 × 2 grid of map panels; these are one panel's map area.
export const PANEL_W = 145;
export const PANEL_H = 95;
// The development-activity map: one column wide, the height of a panel with its legend.
export const DA_PANEL_H = 119;

const MARGIN_L = 14, MARGIN_R = 12;
const TEXT_W = 88;                       // the text column
const FIELD_X = MARGIN_L + TEXT_W + 10;  // 112
const FIELD_W = SLIDE_W - FIELD_X - MARGIN_R;  // 296
const FIELD_Y = 36;
const GUTTER = 6;
const PANEL_TITLE_H = 5;
const LEGEND_H = 19.5;
const LEGEND_ROWS = 5;

export interface Slide { id: string; title: string; subtitle: string; textHtml: string; figureHtml: string }

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

const label = (x: number, y: number, text: string, size = 2.2, fill = '#222') =>
  `<text x="${x.toFixed(1)}" y="${(y + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${fill}" stroke="#ffffff" stroke-width="${(size * 0.22).toFixed(2)}" paint-order="stroke">${esc(text)}</text>`;

function panelSvg(inner: string, id: string): string {
  return `<svg width="${PANEL_W}mm" height="${PANEL_H}mm" viewBox="0 0 ${PANEL_W} ${PANEL_H}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-${id}"><rect x="0" y="0" width="${PANEL_W}" height="${PANEL_H}"/></clipPath></defs>
    <g clip-path="url(#clip-${id})" font-family="${tpl().font}">${inner}</g>
    <rect x="0.1" y="0.1" width="${PANEL_W - 0.2}" height="${PANEL_H - 0.2}" fill="none" stroke="${tpl().rule}" stroke-width="0.2"/>
  </svg>`;
}

interface PanelOut { title: string; note: string; svg: string; legend: LegendEntry[] }

function panelBlock(p: PanelOut, col: number, row: number, id: string): string {
  const x = FIELD_X + col * (PANEL_W + GUTTER);
  const y = FIELD_Y + row * (PANEL_TITLE_H + PANEL_H + LEGEND_H + GUTTER);
  const leg = legendSvg(p.legend, PANEL_W, LEGEND_ROWS, 2.05);
  return `<div class="abs ptitle" style="left:${x}mm;top:${y}mm;width:${PANEL_W}mm">${esc(p.title)}<span class="pnote">${esc(p.note)}</span></div>
    <div class="abs" style="left:${x}mm;top:${y + PANEL_TITLE_H}mm">${panelSvg(p.svg, id)}</div>
    <svg class="abs" style="left:${x}mm;top:${y + PANEL_TITLE_H + PANEL_H + 1.5}mm" width="${PANEL_W}mm" height="${LEGEND_H}mm" viewBox="0 0 ${PANEL_W} ${LEGEND_H}" xmlns="http://www.w3.org/2000/svg">${leg.svg}</svg>`;
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

  const policyAtSite = b.policy.filter((p) => p.rings.some((r) => pointInRing(cLL.lon, cLL.lat, r)))
    .map((p) => ({ kind: p.kind, name: p.name, source: p.source }));
  const seenP = new Set<string>();
  const policyInWindow = b.policy.filter((p) => { const key = `${p.kind}|${p.name}`; if (seenP.has(key)) return false; seenP.add(key); return true; })
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
    `<g fill="${zoneFill(code)}" fill-opacity="0.85" stroke="#555" stroke-width="0.08" fill-rule="evenodd">${ds.map((d) => `<path d="${d}"/>`).join('')}</g>`).join('');
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
    `<g fill="${colour.get(l)}" fill-opacity="0.9" stroke="#555" stroke-width="0.08" fill-rule="evenodd">${(byClass.get(l) ?? []).map((d) => `<path d="${d}"/>`).join('')}</g>`).join('');
  const labels = placeLabels(cands, 2);
  const svg = baseLayers(b.base, proj, b.panel, { lots: false }) + fills + baseLotsHairline(b, proj) + labels.join('') + overLayers(b.base, proj, b.panel) +
    (order.length ? '' : emptyNote(['No height of building map in this window'])) + panelFurniture(b.panel);
  const legend = order.map((l) => ({ swatch: swatchFill(colour.get(l)!), label: l }));
  const rl = facts.heightsInWindow.some((h) => /RL/i.test(h.units));
  const banded = facts.heightsInWindow.length > 10;
  return { title: 'Height of building', note: `${banded ? `${facts.heightsInWindow.length} distinct limits, banded · ` : ''}${rl ? 'RL limits are reduced levels above datum, not heights above ground' : 'maximum height above ground'}`, svg, legend };
}

/** A note in the panel's top-left corner, boxed, where it covers nothing that matters. */
function emptyNote(lines: string[]): string {
  const w = Math.max(...lines.map((l) => l.length)) * 2.4 * 0.55 + 6;
  return `<g><rect x="3" y="3" width="${w.toFixed(1)}" height="${(lines.length * 3.6 + 2.4).toFixed(1)}" fill="#ffffff" fill-opacity="0.9" stroke="#bbb" stroke-width="0.2"/>` +
    lines.map((l, i) => `<text x="6" y="${(6.6 + i * 3.6).toFixed(1)}" font-size="2.4" fill="#555">${esc(l)}</text>`).join('') + '</g>';
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
      parts.push(`<path d="${d}" fill="${st.fill}" fill-opacity="0.9" stroke="#6b4e1e" stroke-width="0.15" fill-rule="evenodd"/>`);
      legendMap.set(st.label, { swatch: swatchFill(st.fill, '#6b4e1e'), label: st.label });
      const m = mainRing(f, proj);
      if (m && f.properties.H_ID) {
        const [clon, clat] = centroidLL(m.ring);
        const d = distanceM(b.panel.center, clon, clat, k);
        if (d < 320) cands.push({ area: 1000 - d, cx: m.cx, cy: m.cy, text: String(f.properties.H_ID), fill: '#3b2a10' });
      }
    }
  }
  if (b.shr.features.length) {
    const d = b.shr.features.map((f) => ringsPath(geomRings(f.geometry), proj)).join('');
    parts.push(`<path d="${d}" fill="none" stroke="#7a1b1b" stroke-width="0.55"/>`);
    legendMap.set('shr', { swatch: swatchLine('#7a1b1b', 0.7), label: 'State Heritage Register curtilage' });
  }
  const labels = placeLabels(cands, 1.8, 30);
  const empty = parts.length ? '' : emptyNote(['No heritage item or conservation area in this window']);
  const svg = baseLayers(b.base, proj, b.panel) + parts.join('') + labels.join('') + overLayers(b.base, proj, b.panel) + empty + panelFurniture(b.panel);
  const n = facts.heritageNearby;
  return { title: 'Heritage', note: `${n.items} items · ${n.conservationAreas} conservation areas · ${n.shr} State Heritage Register items in window`, svg, legend: [...legendMap.values()] };
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
  const proj = panelProjector(b.panel);
  const panels = [zoningPanel(b, proj, facts), hobPanel(b, proj, facts), heritagePanel(b, proj, facts), policyPanel(b, proj, facts)];
  const figureHtml = panels.map((p, i) => panelBlock(p, i % 2, Math.floor(i / 2), `p${i}`)).join('\n');
  const sentences = sentenceList(planningSentences(b, facts));
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: how the planning framework reads for this site, where it is moving (rezonings, precinct plans, policy reforms) and what that implies for the brief.') +
    `<div class="fine">Four maps at 1:${fmtNum(b.panel.scale)}, north up, ${fmtNum(Math.round((PANEL_W / 1000) * b.panel.scale))} × ${fmtNum(Math.round((PANEL_H / 1000) * b.panel.scale))} m each. Zoning, height and heritage from NSW ePlanning (EPI_Primary_Planning_Layers); the State Heritage Register from Heritage NSW; TOD, town-centre and SSD maps from the Housing and Planning Systems SEPP layers; precincts from DPHI. Retrieved ${b.generatedAt.slice(0, 10)}. Mapped controls, not a planning certificate.</div>`;
  const sub = [b.siteAddress, b.context.lga?.name ? titleCase(b.context.lga.name) : '', b.context.district ? `${b.context.district} District` : ''].filter(Boolean).join(' · ');
  return { id: '03_planning_overview', title: 'Planning overview', subtitle: sub, textHtml, figureHtml };
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

// ---- slide 07: development activity ---------------------------------------------

// Identity colours for the dots: the first three slots of the validated
// categorical palette (all pairs clear the colour-vision floors). Withdrawn
// applications are hollow rings, so their state is a shape, not a fourth hue.
const STATUS_STYLE: Record<DaStatusClass, { fill: string; stroke: string; hollow?: boolean; label: string }> = {
  determined: { fill: '#2a78d6', stroke: '#2a78d6', label: 'Determined (the feed does not say approved or refused)' },
  active:     { fill: '#eb6834', stroke: '#eb6834', label: 'Under assessment, on exhibition or awaiting information' },
  appeal:     { fill: '#1baf7a', stroke: '#1baf7a', label: 'Before the Land and Environment Court' },
  withdrawn:  { fill: '#ffffff', stroke: '#7a7a7a', hollow: true, label: 'Withdrawn, rejected or cancelled' },
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
}

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
  return {
    available: Boolean(b.daMeta), council: b.daMeta?.council, from: b.daMeta?.from, to: b.daMeta?.to,
    applications: recs.length, significant: recs.filter(isSignificant).length, sites, byStatus,
    dwellings: sites.reduce((n, st) => n + (st.dwellings ?? 0), 0),
    cost: sites.reduce((n, st) => n + (st.cost ?? 0), 0),
    perYear, largest, proposals: b.proposals,
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
  if (d.proposals.length) {
    out.push(`${d.proposals.length} planning proposal map${d.proposals.length === 1 ? ' is' : 's are'} on public exhibition in the window: ${[...new Set(d.proposals.map((p) => p.name))].slice(0, 3).join('; ')}.`);
  } else {
    out.push('No planning proposal is on public exhibition in the window.');
  }
  if (f.policyAtSite.length) out.push(`The site is inside ${f.policyAtSite.map((p) => `the ${p.name} ${POLICY_WORD[p.kind]}`).join(' and ')}, drawn as a wash on the map.`);
  return out;
}

function developmentMap(b: SlidesBundle, d: DevelopmentFacts, numbered: number): string {
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
      labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" font-weight="700" fill="${STATUS_STYLE[st.statusClass].hollow ? '#333' : '#ffffff'}">${text}</text>`);
      continue;
    }
    const spots: [number, number][] = [[x + r + 1.2 + w / 2, y], [x - r - 1.2 - w / 2, y], [x, y - r - 1.6], [x, y + r + 1.6]];
    for (const [lx, ly] of spots) if (spacer.take(lx, ly, w, h)) { labels.push(label(lx, ly, text, 2, '#222')); break; }
  }
  parts.push(dots.join(''), labels.join(''), siteMark(b.base, proj, 'outline'), panelFurniture(p, corner));
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
  parts.push(`<text x="0" y="3" font-size="2.3" font-weight="700" fill="${t.ink}">Applications lodged per year in the window` +
    (notes.length ? `<tspan font-weight="400" fill="#666"> · ${esc(notes.join(' · '))}</tspan>` : '') + `</text>`);
  const base = top + plotH;
  parts.push(`<line x1="${left}" y1="${base.toFixed(1)}" x2="${(wMm - right).toFixed(1)}" y2="${base.toFixed(1)}" stroke="#c9c9c9" stroke-width="0.15"/>`);
  years.forEach((y, i) => {
    const h = (y.count / max) * plotH;
    const x = left + i * slot + (slot - barW) / 2;
    const yTop = base - h;
    const rr = Math.min(0.8, h / 2);
    const fill = y.partial ? '#8a97a3' : t.dimension;
    if (h > 0)
      parts.push(`<path d="M${x.toFixed(2)},${base.toFixed(2)} V${(yTop + rr).toFixed(2)} Q${x.toFixed(2)},${yTop.toFixed(2)} ${(x + rr).toFixed(2)},${yTop.toFixed(2)} H${(x + barW - rr).toFixed(2)} Q${(x + barW).toFixed(2)},${yTop.toFixed(2)} ${(x + barW).toFixed(2)},${(yTop + rr).toFixed(2)} V${base.toFixed(2)} Z" fill="${fill}"/>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(yTop - 1).toFixed(2)}" text-anchor="middle" font-size="2.1" fill="${t.ink}">${y.count}</text>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(base + 3.2).toFixed(2)}" text-anchor="middle" font-size="2.1" fill="#555">${y.year}</text>`);
  });
  return `<svg width="${wMm}mm" height="${hMm}mm" viewBox="0 0 ${wMm} ${hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block" font-family="${t.font}">${parts.join('')}</svg>`;
}

export function developmentSlide(b: SlidesBundle, facts: PlanningFacts): Slide {
  const d = developmentFacts(b);
  const x0 = FIELD_X, y0 = FIELD_Y;
  const rightX = FIELD_X + PANEL_W + GUTTER;
  const rightW = FIELD_W - PANEL_W - GUTTER;
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
    `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><circle cx="1" cy="1.8" r="0.9" fill="#888"/><circle cx="3.4" cy="1.8" r="1.6" fill="#888"/></svg><span>Circle area follows the stated cost; numbers match the table</span></div>` +
    `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><circle cx="2.5" cy="1.8" r="0.55" fill="#b3b3b3"/></svg><span>Every other application lodged in the period</span></div>`;
  const chartH = 40;
  const right = `<div class="abs ptitle" style="left:${rightX}mm;top:${y0}mm;width:${rightW}mm">Scale of activity</div>
    <div class="abs tiles" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 1}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 22}mm;width:${rightW}mm">${legend}</div>
    <div class="abs" style="left:${rightX}mm;top:${y0 + PANEL_TITLE_H + 52}mm;width:${rightW}mm">${yearChart(d, rightW, chartH)}</div>`;

  // Rows until the table would run into the footer: about 5 mm a line, and
  // the address and status columns wrap past roughly 50 and 34 characters.
  const LINE_MM = 2.95, ROW_PAD_MM = 2.05, TABLE_BUDGET_MM = 112, MORE_MM = 5;
  const rowMm = (st: DaSite) => Math.max(1, Math.ceil(st.statusText.length / 34), Math.ceil(st.address.length / 50)) * LINE_MM + ROW_PAD_MM;
  const shown: DaSite[] = [];
  let used = 0;
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
  const rest = d.sites.length - shown.length;
  const more = rest > 0 ? `<tr><td></td><td colspan="8" class="more">+ ${rest} smaller site${rest > 1 ? 's' : ''} of scale, unnumbered on the map, all in overall.json</td></tr>` : '';
  const empty = !d.sites.length ? `<tr><td></td><td colspan="8" class="more">${d.available ? 'No application of scale in the window for this period' : 'The feed was not available'}</td></tr>` : '';
  const table = `<table class="da"><thead><tr><th class="n">#</th><th style="width:58mm">Site</th><th>Development as lodged</th><th class="r" style="width:11mm">Storeys</th><th class="r" style="width:13mm">Dwellings</th><th class="r" style="width:15mm">Cost</th><th style="width:44mm">Status</th><th style="width:15mm">Lodged</th><th style="width:15mm">Determined</th></tr></thead><tbody>${rows}${more}${empty}</tbody></table>`;

  const sentences = developmentSentences(b, d, facts);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: what the pipeline says about the pace and direction of change here, which approvals set the built-form precedent for this site, and which are worth a site visit or a read of the approved plans.') +
    `<div class="fine">Source: NSW Planning Portal Online DA API, updated daily, every application lodged on the portal since councils were required onto it in July 2021. Council-wide feed clipped to the window; storeys, dwellings and costs as lodged by the applicant; "determined" does not say approved or refused. Complying development certificates and State significant applications are not in this feed. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, d.council ?? '', d.available ? `${fmtNum(d.applications)} applications since ${fmtMonthYear(d.from)}` : ''].filter(Boolean).join(' · ');
  const figureHtml = `<div class="abs ptitle" style="left:${x0}mm;top:${y0}mm;width:${PANEL_W}mm">${esc(mapTitle)}</div>
    <div class="abs" style="left:${x0}mm;top:${y0 + PANEL_TITLE_H}mm">${developmentMap(b, d, shown.length)}</div>
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
  const rowB = FIELD_Y + 26, chartH = 71;
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
  const rowC = rowB + chartH + PANEL_TITLE_H + GUTTER, smallH = 66;
  const qW = (FIELD_W - 3 * GUTTER) / 4;
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
    const x = FIELD_X + i * (qW + GUTTER);
    return `<div class="abs ptitle" style="left:${x}mm;top:${rowC}mm;width:${qW}mm">${esc(c.title)}</div>
      <div class="abs" style="left:${x}mm;top:${rowC + PANEL_TITLE_H}mm">${c.svg || emptyBox(qW, smallH, 'not in the census tables for this region')}</div>`;
  }).join('');

  // Row D: the site's land value and the sales around it.
  const rowD = rowC + PANEL_TITLE_H + smallH + GUTTER, marketH = 50;
  const lvW = 95, salesX = FIELD_X + lvW + GUTTER, salesW = FIELD_W - lvW - GUTTER;
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
    <div class="abs tiles seven" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${FIELD_W}mm">${tiles}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${rowB}mm;width:${halfW}mm">Population · ${esc(p.regions.sa2.name)}<span class="pnote">SA2, June each year</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${rowB + PANEL_TITLE_H}mm">${popChart || emptyBox(halfW, chartH, 'no population series for this SA2')}</div>
    <div class="abs ptitle" style="left:${FIELD_X + halfW + GUTTER}mm;top:${rowB}mm;width:${halfW}mm">Census 2021 against ${esc(benchName)}</div>
    <div class="abs" style="left:${FIELD_X + halfW + GUTTER}mm;top:${rowB + PANEL_TITLE_H}mm;width:${halfW}mm">${table}</div>
    ${chartCells}
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${rowD}mm;width:${lvW}mm">${esc(lvTitle)}<span class="pnote">${esc(lvNote)}</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${rowD + PANEL_TITLE_H}mm">${lvChart}</div>
    <div class="abs ptitle" style="left:${salesX}mm;top:${rowD}mm;width:${salesW}mm">Sales within ${p.salesRadiusM} m<span class="pnote">${fmtNum(p.sales.length)} on the register, most recent first</span></div>
    <div class="abs" style="left:${salesX}mm;top:${rowD + PANEL_TITLE_H}mm;width:${salesW}mm">${salesTable}</div>`;
  return { id: '16_people_and_market', title: 'People and market', subtitle: sub, textHtml, figureHtml };
}

function emptyBox(w: number, h: number, note: string): string {
  return `<div style="width:${w}mm;height:${h}mm;border:0.15mm solid ${tpl().rule};display:flex;align-items:center;justify-content:center;font-size:2.2mm;color:#777;text-align:center;padding:0 4mm">${esc(note)}</div>`;
}

// ---- slide 06: topography ---------------------------------------------------

const CONTOUR = '#a07c3f';

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
        labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.65).toFixed(1)}" text-anchor="middle" font-size="1.9" font-weight="700" fill="${CONTOUR}" stroke="#ffffff" stroke-width="0.45" paint-order="stroke">${text}</text>`);
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
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#ffffff" stroke="${t.dimension}" stroke-width="0.35"/><text x="${x.toFixed(1)}" y="${(y + 0.9).toFixed(1)}" text-anchor="middle" font-size="2.4" font-weight="700" fill="${t.dimension}">${esc(text)}</text>`);
  }
  parts.push(panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-topo"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-topo)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right of the map: the figures, the legend, section B–B′.
  const rightX = FIELD_X + PANEL_W + GUTTER, rightW = FIELD_W - PANEL_W - GUTTER;
  const tiles = [
    { v: f.site ? `${f.site.min.toFixed(1)}–${f.site.max.toFixed(1)}` : '—', l: 'RL range of the site, m AHD' },
    { v: f.site ? `${(f.site.max - f.site.min).toFixed(1)} m` : '—', l: f.slope?.faces && f.site && f.site.max - f.site.min >= 0.5 ? `fall across the site, to the ${f.slope.faces}` : 'fall across the site' },
    { v: f.slope ? `${f.slope.pct.toFixed(f.slope.pct < 3 ? 1 : 0)} %` : '—', l: f.slope?.oneIn ? `grade at the site (1 in ${f.slope.oneIn})` : 'grade at the site' },
    { v: `${Math.max(0, Math.round(f.window.minRl))}–${Math.round(f.window.maxRl)}`, l: 'RL range of the window' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const legend = [
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="#cfcfcf"/><rect x="0" y="0.3" width="2.5" height="3" fill="#ececec"/></svg>`, 'Hillshade from the 5 m elevation model, lit from the north-west'],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><line x1="0" y1="2.6" x2="5" y2="2.6" stroke="${CONTOUR}" stroke-width="0.2"/><line x1="0" y1="1.2" x2="5" y2="1.2" stroke="${CONTOUR}" stroke-width="0.4"/></svg>`, `Contours at ${interval} m, every ${indexEvery} m heavier and labelled`],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${t.dimension}" stroke-width="0.4" stroke-dasharray="1.4,0.7"/></svg>`, 'Section lines A–A′ (down the fall) and B–B′ (across it)'],
    [`<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="${t.water}"/></svg>`, 'Water'],
  ].map(([sw, txt]) => `<div class="lg">${sw}<span>${esc(txt)}</span></div>`).join('');
  const secB = f.sections[1] ? sectionSvg({ w: rightW, h: 60, font: t.font, samples: f.sections[1].samples, from: 'B', to: 'B′', siteColour: t.site, waterColour: t.water }) : { svg: '', ve: 1 };
  const secA = f.sections[0] ? sectionSvg({ w: FIELD_W, h: 96, font: t.font, samples: f.sections[0].samples, from: 'A', to: 'A′', siteColour: t.site, waterColour: t.water }) : { svg: '', ve: 1 };
  const secTitle = (s: (typeof f.sections)[number], ve: number) => `Section ${s.id}–${s.id}′<span class="pnote">${bearingName((s.bearing + 180) % 360)} to ${bearingName(s.bearing)} · ${fmtNum(Math.round(s.lengthM))} m · RL ${s.rlMin.toFixed(0)} to ${s.rlMax.toFixed(0)} · vertical exaggeration ${ve % 1 ? ve.toFixed(1) : ve}×</span>`;
  const yB = FIELD_Y + PANEL_TITLE_H + 24 + 3 + 24;
  const yA = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Landform<span class="pnote">1:${fmtNum(p.scale)} · hillshade, contours, sections</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 24}mm;width:${rightW}mm">${legend}</div>
    ${f.sections[1] ? `<div class="abs ptitle" style="left:${rightX}mm;top:${yB}mm;width:${rightW}mm">${secTitle(f.sections[1], secB.ve)}</div>
    <div class="abs" style="left:${rightX}mm;top:${yB + PANEL_TITLE_H}mm">${secB.svg}</div>` : ''}
    ${f.sections[0] ? `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${yA}mm;width:${FIELD_W}mm">${secTitle(f.sections[0], secA.ve)}</div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yA + PANEL_TITLE_H}mm">${secA.svg}</div>` : ''}`;
  return { id: '06_topography', title: 'Topography', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 08: built form ----------------------------------------------------

/** Height bands by storeys, on the sequential blue ramp; no height is a neutral grey. */
const HEIGHT_BANDS: { label: string; maxM: number; fill: string }[] = [
  { label: '1–2 storeys', maxM: 7.5, fill: '#b7d3f6' },
  { label: '3–4', maxM: 14, fill: '#86b6ef' },
  { label: '5–8', maxM: 27, fill: '#3987e5' },
  { label: '9–15', maxM: 50, fill: '#1c5cab' },
  { label: '16 and more', maxM: Infinity, fill: '#0d366b' },
];
const NO_HEIGHT_FILL = '#cbc9c2';
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
    .map((x) => ({ name: x.name, heightM: x.estimatedHeightM!, storeys: x.floors ?? storeysOf(x.estimatedHeightM!), measured: x.heightFrom === 'measured', distanceM: Math.round(dist(x)), bearing: bearing(x) }));
  const neighbours = all.filter((x) => !onSite.includes(x) && dist(x) <= 45).sort((p, q) => dist(p) - dist(q)).slice(0, 4)
    .map((x) => ({ name: x.name, heightM: x.estimatedHeightM, storeys: x.estimatedHeightM ? (x.floors ?? storeysOf(x.estimatedHeightM)) : undefined, distanceM: Math.round(dist(x)), bearing: bearing(x), kind: x.kind }));
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
    bands: HEIGHT_BANDS.map((bd) => ({ label: bd.label, count: withHeight.filter((x) => bandOf(x.estimatedHeightM) === bd).length })).concat([{ label: 'no height', count: all.length - withHeight.length }]),
    near: { radiusM: 250, count: near.length, withHeight: nearHeights.length, medianM: medianNearM, medianStoreys: medianNearM ? storeysOf(medianNearM) : undefined,
      above8: nearHeights.filter((h) => storeysOf(h) > 8).length, storeys: [...storeyCounts.entries()].sort((p, q) => p[0] - q[0]).map(([st, n]) => ({ storeys: st, count: n })) },
    tallest, neighbours,
    onSite: onSite.map((x) => ({ name: x.name, heightM: x.estimatedHeightM, storeys: x.estimatedHeightM ? (x.floors ?? storeysOf(x.estimatedHeightM)) : undefined, kind: x.kind })),
    siteGroundRl: site?.mean, envelope,
  };
}

export function builtFormSentences(b: SlidesBundle, f: ReturnType<typeof builtFormFacts>): string[] {
  const out: string[] = [];
  const src = f.source === 'overture' ? `Overture Maps${f.release ? ` (release ${f.release})` : ''}` : f.source === 'osm' ? 'OpenStreetMap' : '';
  if (!f.count) return [`No building footprints could be read for this window when the deck was generated${f.note ? ` (${f.note})` : ''}.`];
  const known = f.measured + f.fromStoreys;
  out.push(`The window holds ${fmtNum(f.count)} buildings from ${src}; ${fmtPct(pct(known, f.count))} carry a height, ${fmtNum(f.measured)} measured and ${fmtNum(f.fromStoreys)} from a storey count at ${METRES_PER_STOREY} m a storey. The rest are drawn grey.`);
  if (f.near.withHeight) {
    let s = `Within ${f.near.radiusM} m of the site the typical building is ${f.near.medianStoreys} storey${f.near.medianStoreys === 1 ? '' : 's'} (median of ${fmtNum(f.near.withHeight)} with a height)`;
    if (f.near.above8) s += `; ${fmtPct(pct(f.near.above8, f.near.withHeight))} rise above eight storeys`;
    s += '.';
    if (f.tallest[0]) { const t0 = f.tallest[0]; s += ` The tallest in the window is ${t0.name ?? 'a building'} ${fmtNum(Math.round(t0.distanceM))} m to the ${bearingName(t0.bearing)}, ${Math.round(t0.heightM)} m (${t0.storeys} storeys${t0.measured ? '' : ', from its storey count'}).`; }
    out.push(s);
  }
  if (f.onSite.length) {
    const withH = f.onSite.filter((x) => x.heightM);
    const n = f.onSite.length;
    const list = withH.map((x) => `${x.storeys} storey${x.storeys === 1 ? '' : 's'} (${Math.round(x.heightM!)} m)`).join(', ');
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
    const parts = f.neighbours.map((n) => `${n.name ? n.name : 'a building'} ${n.distanceM} m to the ${bearingName(n.bearing)}${n.heightM ? `, ${n.storeys} storey${n.storeys === 1 ? '' : 's'} (${Math.round(n.heightM)} m)` : ', height unknown'}`);
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
    `<div class="fine">Sources: ${f.source === 'overture' ? 'Overture Maps Foundation buildings (footprints and heights from OpenStreetMap, Microsoft, Esri Community Maps and Google Open Buildings; ODbL and CDLA Permissive 2.0)' : f.source === 'osm' ? 'OpenStreetMap contributors (ODbL)' : 'no building source answered'}; heights measured or ${METRES_PER_STOREY} m a storey; the LEP height of building from the ePlanning layer, converted with the 5 m elevation model where it is a reduced level. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
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
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="#ffffff" stroke="${t.dimension}" stroke-width="0.35"/><text x="${x.toFixed(1)}" y="${(y + 0.9).toFixed(1)}" text-anchor="middle" font-size="2.4" font-weight="700" fill="${t.dimension}">${esc(text)}</text>`);
  }
  parts.push(panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-built"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-built)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, legend, the storeys of the neighbourhood against the height plane.
  const rightX = FIELD_X + PANEL_W + GUTTER, rightW = FIELD_W - PANEL_W - GUTTER;
  const known = f.measured + f.fromStoreys;
  const tiles = [
    { v: fmtNum(f.count), l: 'buildings in the window' },
    { v: f.count ? fmtPct(pct(known, f.count)) : '—', l: 'with a height, measured or from storeys' },
    { v: f.near.medianStoreys ? `${f.near.medianStoreys}` : '—', l: `storeys, median within ${f.near.radiusM} m of the site` },
    { v: f.envelope ? (f.envelope.storeys ? `${f.envelope.storeys}` : '—') : '—', l: f.envelope ? `storeys within the LEP height plane (${f.envelope.label})` : 'no height of building control mapped' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const legend = HEIGHT_BANDS.map((bd, i) => `<div class="lg"><svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6"><rect x="0" y="0.3" width="5" height="3" fill="${bd.fill}"/></svg><span>${esc(bd.label)} · ${fmtNum(f.bands[i].count)}</span></div>`).join('') +
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
      blocks.push({ d0: current.d0, d1: dEnd, top: ground + (h ?? METRES_PER_STOREY), site: onSite, unknown: !h, label: h && dEnd - current.d0 > 25 ? `${current.bd.floors ?? storeysOf(h)} st` : undefined });
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
    sectionHtml = `<div class="abs ptitle" style="left:${FIELD_X}mm;top:${yA}mm;width:${FIELD_W}mm">Section A–A′ with the buildings it meets<span class="pnote">${bearingName((secA.bearing + 180) % 360)} to ${bearingName(secA.bearing)} · ${fmtNum(Math.round(L))} m · heights measured or ${METRES_PER_STOREY} m a storey, dashed where unknown · vertical exaggeration ${sec.ve % 1 ? sec.ve.toFixed(1) : sec.ve}×</span></div>
      <div class="abs" style="left:${FIELD_X}mm;top:${yA + PANEL_TITLE_H}mm">${sec.svg}</div>`;
  }
  const yHist = FIELD_Y + PANEL_TITLE_H + 24 + 3 + 30;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Built form<span class="pnote">1:${fmtNum(p.scale)} · footprints by height</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 24}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${yHist}mm;width:${rightW}mm">Storeys within ${f.near.radiusM} m<span class="pnote">${fmtNum(f.near.withHeight)} buildings with a height</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yHist + PANEL_TITLE_H}mm">${histSvg}</div>
    ${sectionHtml}`;
  return { id: '08_built_form', title: 'Built form and height planes', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 09: movement ------------------------------------------------------

const ISO_MINUTES = [5, 10, 15];
const ISO_FILL: Record<number, string> = { 5: '#2a78d6', 10: '#5598e7', 15: '#9ec5f4' };
const CYCLE_COLOUR = '#008300';
const FRONTAGE_COLOUR = '#eb6834';
const FOOTWAY_COLOUR = '#7a7a7a';

const roadWord = (h: number) => (h <= 2 ? 'motorway or highway' : h === 3 ? 'arterial road' : h === 4 ? 'sub-arterial road' : h === 5 ? 'collector road' : 'local street');
const stationKind = stationMode;
const tidyStation = (name: string) => titleCase(name.replace(/\s+(RAILWAY|TRAIN)?\s*STATION$/i, '').replace(/\s+METRO$/i, ' Metro'));

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
    if (wspacer.take(best.cx, best.cy, labelW(text, 2.2) + 1, 3)) out.push(`<text x="${best.cx.toFixed(1)}" y="${(best.cy + 0.8).toFixed(1)}" text-anchor="middle" font-size="2.2" letter-spacing="0.08em" fill="#7a7a7a" stroke="#ffffff" stroke-width="0.5" paint-order="stroke">${esc(text.toUpperCase())}</text>`);
  }
  for (const s of b.wide.base.stations) {
    const [x, y] = wproj(s.lon, s.lat);
    if (x < 2 || y < 2 || x > wp.wMm - 2 || y > wp.hMm - 2) continue;
    const text = tidyStation(s.name);
    if (wspacer.take(x + 3 + labelW(text, 2) / 2, y, labelW(text, 2), 2.6)) out.push(label(x + 3 + labelW(text, 2) / 2, y, text, 2, '#222'));
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
    .map((s) => ({ name: tidyStation(s.name), kind: stationKind(s.name), distanceM: Math.round(distM(s.lon, s.lat)), bearing: bearing(s.lon, s.lat), walkBand: walkBand(s.lon, s.lat) }))
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

export function movementSentences(b: SlidesBundle, f: ReturnType<typeof movementFacts>): string[] {
  const out: string[] = [];
  const band = (m: number | null) => (m === 5 ? 'within a five-minute walk' : m === 10 ? 'five to ten minutes on foot' : m === 15 ? 'ten to fifteen minutes on foot' : 'beyond a fifteen-minute walk');
  if (f.stations.length) {
    const s = f.stations.slice(0, 3).map((st, i) => `${st.name} (${st.kind}) ${i ? '' : 'is '}${fmtNum(st.distanceM)} m to the ${bearingName(st.bearing)}, ${band(st.walkBand)}`);
    out.push(`${s.join('; ')}.`);
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
  if (f.isochrones.length) out.push(`On foot from the site: ${f.isochrones.map((i) => `${i.minutes} minutes reach ${fmtNum(i.areaHa)} ha`).join(', ')}, on the mapped street and path network.`);
  return out;
}

export function movementSlide(b: SlidesBundle): Slide {
  const f = movementFacts(b);
  const t = tpl();
  const mv = b.movement;
  const sentences = movementSentences(b, f);
  const textHtml = sentences.map(para).join('') +
    placeholder('Narrative — for the author: how people will arrive and leave (rail, bus, bike, on foot, by car), which frontage is the address and which is the service side, where the active edge belongs, and what the walking catchments say about the mix.') +
    `<div class="fine">Sources: NSW Spatial Services roads (function hierarchy), rail and stations; walking isochrones from Valhalla on OpenStreetMap; bus stops from ${f.bus.source === 'tfnsw' ? 'Transport for NSW' : f.bus.source === 'osm' ? 'OpenStreetMap' : 'Transport for NSW or OpenStreetMap (neither answered)'}; bus routes, cycleways, footways and one-way streets from OpenStreetMap contributors (ODbL); active street frontages from the ePlanning development-control layers. Retrieved ${b.generatedAt.slice(0, 10)}.</div>`;
  const sub = [b.siteAddress, f.stations[0] ? `${f.stations[0].name} ${fmtNum(f.stations[0].distanceM)} m` : '', f.frontage.length ? `fronts ${f.frontage.slice(0, 2).map((r) => r.name).join(' and ')}${f.frontage.length > 2 ? ` and ${f.frontage.length - 2} more` : ''}` : ''].filter(Boolean).join(' · ');

  // The movement map over the tall panel.
  const p = b.daPanel;
  const proj = panelProjector(p);
  const parts: string[] = [baseLayers(b.base, proj, p)];
  for (const iso of [...mv.isochrones].sort((x, y) => y.minutes - x.minutes)) {
    parts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="${ISO_FILL[iso.minutes] ?? '#9ec5f4'}" fill-opacity="0.10" stroke="${ISO_FILL[iso.minutes] ?? '#9ec5f4'}" stroke-width="0.45" stroke-dasharray="1.6,1" fill-rule="evenodd"/>`);
  }
  if (mv.activeFrontages.features.length) parts.push(`<path d="${fcPath(mv.activeFrontages, proj)}" fill="${FRONTAGE_COLOUR}" fill-opacity="0.55" stroke="${FRONTAGE_COLOUR}" stroke-width="0.25" fill-rule="evenodd"/>`);
  parts.push(overLayers(b.base, proj, p, 'wash'));
  if (mv.busRoutes.length) parts.push(`<path d="${mv.busRoutes.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${t.busRoute}" stroke-width="0.5" stroke-dasharray="1.2,0.9" stroke-linecap="round"/>`);
  if (mv.footways.length) parts.push(`<path d="${mv.footways.map((l) => ringsPath([l], proj, false)).join('')}" fill="none" stroke="${FOOTWAY_COLOUR}" stroke-width="0.25" stroke-dasharray="0.5,0.5"/>`);
  for (const kind of ['shared', 'lane', 'separated'] as CyclewayKind[]) {
    const ls = mv.cycleways.filter((c) => c.kind === kind);
    if (ls.length) parts.push(`<path d="${ls.map((l) => ringsPath([l.coords], proj, false)).join('')}" fill="none" stroke="${CYCLE_COLOUR}" stroke-width="${kind === 'separated' ? 0.6 : 0.4}"${kind === 'separated' ? '' : ' stroke-dasharray="1.4,0.8"'} stroke-linecap="round"/>`);
  }
  if (mv.busStops.length) parts.push(`<g>${mv.busStops.map((s) => { const [x, y] = proj(s.lon, s.lat); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.9" fill="${t.busRoute}" stroke="#ffffff" stroke-width="0.3"/>`; }).join('')}</g>`);
  // isochrone labels where each ring crosses the panel's centre line
  const isoSpacer = new LabelSpacer(p.wMm, p.hMm, 20);
  for (const iso of mv.isochrones) {
    const pts = iso.rings[0]?.map(([lon, lat]) => proj(lon, lat)) ?? [];
    const top = pts.filter((q) => q[0] > 3 && q[0] < p.wMm - 3 && q[1] > 3 && q[1] < p.hMm - 3).sort((q, r) => q[1] - r[1])[0];
    if (top && isoSpacer.take(top[0], top[1] - 1.5, 9, 2.6)) parts.push(label(top[0], top[1] - 1.5, `${iso.minutes} min`, 2, ISO_FILL[iso.minutes] ?? '#5598e7'));
  }
  parts.push(siteMark(b.base, proj, 'outline'), panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-move"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-move)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, legend, stations table.
  const rightX = FIELD_X + PANEL_W + GUTTER, rightW = FIELD_W - PANEL_W - GUTTER;
  const st0 = f.stations[0];
  const tiles = [
    { v: st0 ? `${fmtNum(st0.distanceM)} m` : '—', l: st0 ? `to ${st0.name} (${st0.kind})${st0.walkBand ? `, within ${st0.walkBand} min on foot` : ''}` : 'no station in the wide window' },
    { v: f.bus.total ? String(f.bus.within400) : '—', l: f.bus.total ? `bus stops within 400 m · ${f.bus.within800} within 800 m` : 'bus stops: no source answered' },
    { v: f.cycle.osm ? (f.cycle.nearest ? `${fmtNum(f.cycle.nearest.distanceM)} m` : 'none') : '—', l: f.cycle.osm ? (f.cycle.nearest ? `to the nearest cycleway (${f.cycle.nearest.kind})` : 'no cycleway mapped in the window') : 'cycleways: OpenStreetMap did not answer' },
    { v: f.frontage.length ? String(f.frontage.length) : '—', l: f.frontage.length ? `street frontage${f.frontage.length === 1 ? '' : 's'}: ${[...new Set(f.frontage.map((r) => (f.frontage.filter((q) => q.word === r.word).length > 1 ? `${r.word}s` : r.word)))].join(', ')}` : 'no named road within 25 m of the site' },
  ].map((tl) => `<div class="tile"><div class="tv${tl.v.length > 9 ? ' long' : ''}">${esc(tl.v)}</div><div class="tl">${esc(tl.l)}</div></div>`).join('');
  const sw = (inner: string) => `<svg width="5mm" height="3.6mm" viewBox="0 0 5 3.6">${inner}</svg>`;
  const legendRows: [string, string][] = [
    [sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="#6f6f6f" stroke-width="0.9"/><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="#ffffff" stroke-width="0.6"/>`), 'Roads by function: motorways and arterials heaviest, local streets finest'],
    [sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${t.rail}" stroke-width="0.7"/><line x1="0" y1="1.8" x2="5" y2="1.8" stroke="#ffffff" stroke-width="0.32" stroke-dasharray="1.6,1.6"/>`), 'Rail; stations as T, M (metro) or L (light rail)'],
    [sw(`<path d="M0,1.8 H5" stroke="${ISO_FILL[5]}" stroke-width="0.45" stroke-dasharray="1.6,1"/>`), 'Walking isochrones from the site: 5, 10 and 15 minutes'],
  ];
  if (mv.busStops.length || mv.busRoutes.length) legendRows.push([sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${t.busRoute}" stroke-width="0.5" stroke-dasharray="1.2,0.9"/><circle cx="2.5" cy="1.8" r="0.9" fill="${t.busRoute}" stroke="#ffffff" stroke-width="0.3"/>`), `Bus ${mv.busRoutes.length ? 'routes and ' : ''}stops (${f.bus.source === 'tfnsw' ? 'Transport for NSW' : 'OpenStreetMap'})`]);
  if (mv.cycleways.length) legendRows.push([sw(`<line x1="0" y1="1.2" x2="5" y2="1.2" stroke="${CYCLE_COLOUR}" stroke-width="0.6"/><line x1="0" y1="2.6" x2="5" y2="2.6" stroke="${CYCLE_COLOUR}" stroke-width="0.4" stroke-dasharray="1.4,0.8"/>`), 'Cycleways: separated solid, on-road lanes and shared paths dashed']);
  if (mv.footways.length) legendRows.push([sw(`<line x1="0" y1="1.8" x2="5" y2="1.8" stroke="${FOOTWAY_COLOUR}" stroke-width="0.25" stroke-dasharray="0.5,0.5"/>`), 'Footways, paths and steps off the streets']);
  if (mv.activeFrontages.features.length) legendRows.push([sw(`<rect x="0" y="0.6" width="5" height="2.4" fill="${FRONTAGE_COLOUR}" fill-opacity="0.55"/>`), 'LEP active street frontage']);
  const legend = legendRows.map(([s, txt]) => `<div class="lg">${s}<span>${esc(txt)}</span></div>`).join('');
  const stationRows = f.stations.slice(0, 6).map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.kind)}</td><td class="r">${fmtNum(s.distanceM)} m</td><td>${esc(bearingName(s.bearing))}</td><td>${s.walkBand ? `within ${s.walkBand} min` : 'over 15 min'}</td></tr>`).join('');
  const stationTable = f.stations.length
    ? `<table class="da"><thead><tr><th>Station</th><th style="width:16mm">Mode</th><th class="r" style="width:16mm">Distance</th><th style="width:20mm">Direction</th><th style="width:22mm">On foot</th></tr></thead><tbody>${stationRows}</tbody></table>`
    : emptyBox(rightW, 30, 'no station within the wide window');

  // Bottom: the walking-reach strip.
  const wp = b.wide.panel;
  const wproj = panelProjector(wp);
  const wparts: string[] = [`<rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}" fill="#ffffff"/>`];
  if (b.wide.base.water.features.length) wparts.push(`<path d="${fcPath(b.wide.base.water, wproj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  for (const iso of [...mv.isochrones].sort((x, y) => y.minutes - x.minutes))
    wparts.push(`<path d="${ringsPath(iso.rings, wproj)}" fill="${ISO_FILL[iso.minutes] ?? '#9ec5f4'}" fill-opacity="0.28" stroke="${ISO_FILL[iso.minutes] ?? '#9ec5f4'}" stroke-width="0.3" fill-rule="evenodd"/>`);
  wparts.push(overLayers(b.wide.base, wproj, wp, 'none'));
  wparts.push(wideStripLabels(b, wproj, wp));
  const wideSvg = `<svg width="${wp.wMm}mm" height="${wp.hMm}mm" viewBox="0 0 ${wp.wMm} ${wp.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-wide"><rect x="0" y="0" width="${wp.wMm}" height="${wp.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-wide)" font-family="${t.font}">${wparts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${wp.wMm - 0.2}" height="${wp.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  const yTable = FIELD_Y + PANEL_TITLE_H + 24 + 3 + 6 * 4.3 + 4;
  const yWide = FIELD_Y + PANEL_TITLE_H + DA_PANEL_H + GUTTER;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">Movement<span class="pnote">1:${fmtNum(p.scale)}</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 24}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${yTable}mm;width:${rightW}mm">Stations<span class="pnote">nearest first, from the wide window</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yTable + PANEL_TITLE_H}mm;width:${rightW}mm">${stationTable}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yWide}mm;width:${FIELD_W}mm">Walking reach<span class="pnote">1:${fmtNum(wp.scale)} · 5, 10 and 15 minutes on foot from the site · the dashed box is the map above</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yWide + PANEL_TITLE_H}mm">${wideSvg}</div>`;
  return { id: '09_movement', title: 'Movement', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 10: green and public domain -------------------------------------

/** Canopy classes for the strip: one hue, light to dark, on the dataset's own breaks. */
const CANOPY_CLASSES = [
  { max: 10, fill: '#eef4e6', label: 'under 10 %' },
  { max: 20, fill: '#cfe3bd', label: '10–20 %' },
  { max: 30, fill: '#a3cc8e', label: '20–30 %' },
  { max: 40, fill: '#6fae5f', label: '30–40 %' },
  { max: Infinity, fill: '#3d8a3a', label: 'over 40 %' },
];
const canopyFill = (pct: number) => (CANOPY_CLASSES.find((c) => pct < c.max) ?? CANOPY_CLASSES[CANOPY_CLASSES.length - 1]).fill;
const OPEN_SPACE_STYLE: Record<string, { fill: string; stroke: string; word: string }> = {
  RE1: { fill: '#c9e2b4', stroke: '#8fbf7a', word: 'public recreation reserve' },
  RE2: { fill: '#e7efdc', stroke: '#b3cba3', word: 'private recreation land' },
  C1: { fill: '#b5d4a3', stroke: '#6f9f5c', word: 'national park or nature reserve' },
  C2: { fill: '#b5d4a3', stroke: '#6f9f5c', word: 'conservation land' },
  C3: { fill: '#c3dbb2', stroke: '#6f9f5c', word: 'environmental management land' },
};
const PARK_GREEN = '#2f6b2f', GREEN_GRID_COLOUR = '#2f7a3a', NPWS_COLOUR = '#1f6b2f', TREE_DOT = '#3a7d3a';
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
const tidyName = (s: string) => s.trim().replace(/[,.;:\s]+$/, '').replace(/([/'’-]\s?)([a-z])/g, (_m, p, c) => p + c.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c) => `Mc${c.toUpperCase()}`)
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
    parts.push(`<path d="${zs.map((z) => ringsPath(z.rings, proj)).join('')}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="0.2" fill-rule="evenodd"/>`);
  }
  let hatchId = 0;
  for (const n of g.npws) parts.push(hatchPath(ringsPath(n.rings, proj), `npws${hatchId++}`, NPWS_COLOUR, bboxOf(n.rings, proj), 1.4));
  if (g.greenGrid.length) parts.push(`<path d="${g.greenGrid.map((a) => ringsPath(a.rings, proj)).join('')}" fill="none" stroke="${GREEN_GRID_COLOUR}" stroke-width="0.35" stroke-dasharray="1.2,0.7" fill-rule="evenodd"/>`);
  const isos = b.movement?.isochrones ?? [];
  for (const iso of [...isos].sort((x, y) => y.minutes - x.minutes))
    parts.push(`<path d="${ringsPath(iso.rings, proj)}" fill="none" stroke="${ISO_FILL[iso.minutes] ?? '#9ec5f4'}" stroke-width="0.45" stroke-dasharray="1.6,1" fill-rule="evenodd"/>`);
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
    if (top && isoSpacer.take(top[0], top[1] - 1.5, 9, 2.6)) parts.push(label(top[0], top[1] - 1.5, `${iso.minutes} min`, 2, ISO_FILL[iso.minutes] ?? '#5598e7'));
  }
  // Park names at the centroid of what falls inside the window, largest first.
  const labels: string[] = [];
  for (const s of [...f.openSpace.spaces].sort((x, y) => y.windowMm2 - x.windowMm2)) {
    if (!s.name || s.windowMm2 < 10) continue;
    let best = { area: 0, cx: 0, cy: 0 };
    for (const r of s.rings) { const st = clippedStats(r, proj, p); if (st.area > best.area) best = st; }
    const size = s.windowMm2 > 60 ? 2.1 : 1.85;
    if (spacer.take(best.cx, best.cy, labelW(s.name, size), size * 1.3)) labels.push(`<text x="${best.cx.toFixed(1)}" y="${(best.cy + size * 0.35).toFixed(1)}" text-anchor="middle" font-size="${size}" font-style="italic" font-weight="700" fill="${PARK_GREEN}" stroke="#ffffff" stroke-width="${(size * 0.22).toFixed(2)}" paint-order="stroke">${esc(s.name)}</text>`);
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
    facilityMarks.push(`<rect x="${(x - 1.25).toFixed(1)}" y="${(y - 1.25).toFixed(1)}" width="2.5" height="2.5" fill="${t.ink}" stroke="#ffffff" stroke-width="0.3"/><text x="${x.toFixed(1)}" y="${(y + 0.6).toFixed(1)}" text-anchor="middle" font-size="1.7" font-weight="700" fill="#ffffff">${FACILITY_LETTER[fa.kind]}</text>`);
    const w = labelW(fa.name, 1.85);
    for (const [lx, ly] of [[x + 1.9 + w / 2, y], [x - 1.9 - w / 2, y], [x, y + 2.9], [x, y - 2.9], [x, y + 5.4], [x, y - 5.4]] as [number, number][])
      if (spacer.take(lx, ly, w, 2.5)) { labels.push(label(lx, ly, fa.name, 1.85, '#222')); break; }
  }
  parts.push(...facilityMarks, ...labels, siteMark(b.base, proj, 'outline'), panelFurniture(p, 'right'));
  const mapSvg = `<svg width="${p.wMm}mm" height="${p.hMm}mm" viewBox="0 0 ${p.wMm} ${p.hMm}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <defs><clipPath id="clip-green"><rect x="0" y="0" width="${p.wMm}" height="${p.hMm}"/></clipPath></defs>
    <g clip-path="url(#clip-green)" font-family="${t.font}">${parts.join('\n')}</g>
    <rect x="0.1" y="0.1" width="${p.wMm - 0.2}" height="${p.hMm - 0.2}" fill="none" stroke="${t.rule}" stroke-width="0.2"/>
  </svg>`;

  // Right: figures, legend, the open-space table.
  const rightX = FIELD_X + PANEL_W + GUTTER, rightW = FIELD_W - PANEL_W - GUTTER;
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
  if (f.facilities.length) legendRows.push([sw(`<rect x="1.25" y="0.55" width="2.5" height="2.5" fill="${t.ink}"/><text x="2.5" y="2.4" text-anchor="middle" font-size="1.7" font-weight="700" fill="#ffffff">${FACILITY_LETTER[f.facilityCounts[0].kind]}</text>`), `Public facilities: ${f.facilityCounts.map(({ kind }) => `${FACILITY_LETTER[kind]} ${FACILITY_WORD[kind][0]}`).join(', ')}`]);
  if (isos.length) legendRows.push([sw(`<path d="M0,1.8 H5" stroke="${ISO_FILL[5]}" stroke-width="0.45" stroke-dasharray="1.6,1"/>`), `Walking isochrones from the site: ${isos.map((i) => i.minutes).sort((x, y) => x - y).join(', ')} minutes`]);
  if (c.covered) legendRows.push([sw(CANOPY_CLASSES.map((cl, i) => `<rect x="${i}" y="0.4" width="1" height="2.8" fill="${cl.fill}"/>`).join('') + `<rect x="0" y="0.4" width="5" height="2.8" fill="none" stroke="#999" stroke-width="0.15"/>`), `Tree canopy ${c.year} by mesh block, in the strip below: ${CANOPY_CLASSES[0].label} to ${CANOPY_CLASSES[CANOPY_CLASSES.length - 1].label}`]);
  const legend = legendRows.map(([s, txt]) => `<div class="lg">${s}<span>${esc(txt)}</span></div>`).join('');
  const yTable = FIELD_Y + PANEL_TITLE_H + 24 + legendRows.length * 3.7 + 4;
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
    keyParts.push(`<text x="${x}" y="3.1" font-size="2" font-weight="700" fill="#333">Canopy ${c.year}</text>`);
    x += labelW(`Canopy ${c.year}`, 2) + 1.5;
    for (const cl of CANOPY_CLASSES) {
      keyParts.push(`<rect x="${x.toFixed(1)}" y="0.9" width="2.8" height="2.8" fill="${cl.fill}" stroke="#999" stroke-width="0.15"/><text x="${(x + 3.6).toFixed(1)}" y="3.1" font-size="2" fill="#333">${esc(cl.label)}</text>`);
      x += 3.6 + labelW(cl.label, 2) + 1.2;
    }
    wparts.push(`<g transform="translate(2.5,2.5)"><rect x="-1" y="-0.6" width="${(x - 1).toFixed(1)}" height="5" fill="#ffffff" fill-opacity="0.92" stroke="#bbb" stroke-width="0.2"/>${keyParts.join('')}</g>`);
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
    <div class="abs tiles" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 24}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${yTable}mm;width:${rightW}mm">Open space<span class="pnote">nearest first · distance from the site boundary</span></div>
    <div class="abs" style="left:${rightX}mm;top:${yTable + PANEL_TITLE_H}mm;width:${rightW}mm">${table}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yWide}mm;width:${FIELD_W}mm">${c.covered ? `Tree canopy ${c.year}` : 'Open space around the site'}<span class="pnote">1:${fmtNum(wp.scale)} · ${c.covered ? `canopy share of each mesh block${c.wide ? ` · ${fmtPct(c.wide.pct)} of the strip's land` : ''}` : 'recreation and conservation zones · canopy is not mapped here'} · the dashed box is the map above</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yWide + PANEL_TITLE_H}mm">${wideSvg}</div>`;
  return { id: '10_green_public_domain', title: 'Green and public domain', subtitle: sub, textHtml, figureHtml };
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
        parts.push(`<path d="${d}" fill="${fill}" fill-opacity="${(DRAW_RANK[def.id] ?? 5) <= 2 ? 0.45 : 0.6}" stroke="${fill === '#ffffbe' || fill === '#ffff73' ? '#8a8a00' : '#555'}" stroke-width="0.15" fill-rule="evenodd"/>`);
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

export function constraintsSlide(b: SlidesBundle): Slide {
  const f = constraintsFacts(b);
  const proj = panelProjector(b.panel);
  const panels = [constraintPanel(b, proj, f, 'A', 'Hazards and soils'), constraintPanel(b, proj, f, 'B', 'Water, coast, ecology and corridors')];
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
  const table = `<table class="da cons"><thead><tr><th style="width:52mm">Constraint</th><th style="width:18mm">Group</th><th style="width:60mm">At the site</th><th style="width:78mm">In the window</th><th>Instrument · map currency</th></tr></thead><tbody>${rows}</tbody></table>`;
  const yTable = FIELD_Y + PANEL_TITLE_H + PANEL_H + LEGEND_H + GUTTER + 1;
  const figureHtml = panels.map((p, i) => panelBlock(p, i, 0, `c${i}`)).join('\n') + `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yTable}mm;width:${FIELD_W}mm">Constraints at the site<span class="pnote">every layer, with its answer · "not mapped by the LEP" means the plan has no such map, checked plan-wide</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yTable + PANEL_TITLE_H}mm;width:${FIELD_W}mm">${table}</div>`;
  return { id: '14_environmental_constraints', title: 'Environmental constraints', subtitle: sub, textHtml, figureHtml };
}

// ---- slide 11: the site -------------------------------------------------------

const PUBLIC_LAND_COLOUR: Record<PublicParcel['kind'], string> = { state: '#2a78d6', crown: '#1f6b2f', reserve: '#8fbf7a' };
const PUBLIC_LAND_WORD: Record<PublicParcel['kind'], string> = { state: 'State government land', crown: 'Crown land', reserve: 'Crown reserve' };
const SALES_RADIUS_M = 300;
const SALES_MONTHS = 24;

interface SiteEdge { a: XY; b: XY; lengthM: number; bearing: number; mid: XY; normal: { x: number; y: number }; shared: boolean }

export function siteFacts(b: SlidesBundle) {
  const s = b.site;
  const p = s.sitePanel;
  const centreLL = mercatorToLonLat(b.panel.center);
  const k = mercatorScaleFactor(centreLL.lat);
  const toM = (lon: number, lat: number) => lonLatToMercator({ lon, lat });
  const siteRings = b.base.siteLots.features.flatMap((f) => geomRings(f.geometry));
  const ringsMerc = siteRings.map((r) => r.map(([lon, lat]) => toM(lon, lat)));
  const siteMerc = ringsMerc.flat();
  const distFromSite = (m: XY) => { let d = Infinity; for (const q of siteMerc) d = Math.min(d, Math.hypot(q.x - m.x, q.y - m.y)); return d / k; };
  const bearingOf = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const bearingFrom = (m: XY) => bearingOf(m.x - p.center.x, m.y - p.center.y);
  const segDist = (q: XY, a: XY, c: XY) => { const dx = c.x - a.x, dy = c.y - a.y; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0; return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)); };
  const ringAreaM2 = (pts: XY[]) => { let a = 0; for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u.x * v.y - v.x * u.y; } return a / 2 / (k * k); };

  // Boundary edges, with an outward normal for the dimension text; an edge another of the site's lots shares is internal.
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
  // Frontages: the edges whose midpoint lies within 18 m of a named road's centreline.
  const frontage = new Map<string, { lengthM: number; hierarchy: number }>();
  for (const e of outer) {
    let best: { name: string; hierarchy: number; d: number } | null = null;
    for (const r of b.base.roads) {
      if (!r.name) continue;
      const pts = r.coords.map(([lon, lat]) => toM(lon, lat));
      for (let i = 0; i < pts.length - 1; i++) { const d = segDist(e.mid, pts[i], pts[i + 1]) / k; if (!best || d < best.d) best = { name: titleCase(r.name), hierarchy: r.hierarchy, d }; }
    }
    if (best && best.d <= 18) { const cur = frontage.get(best.name) ?? { lengthM: 0, hierarchy: best.hierarchy }; cur.lengthM += e.lengthM; frontage.set(best.name, cur); }
  }
  const frontages = [...frontage.entries()].map(([name, v]) => ({ name, lengthM: Math.round(v.lengthM * 10) / 10, hierarchy: v.hierarchy, word: roadWord(v.hierarchy) })).sort((x, y) => y.lengthM - x.lengthM);

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
    const h = tallest.floors ? `${tallest.floors} storey${tallest.floors === 1 ? '' : 's'}${tallest.heightM ? `, ${fmtNum(tallest.heightM, 1)} m` : ''}` : tallest.heightM ? `${fmtNum(tallest.heightM, 1)} m high` : 'no recorded height';
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
  const parts: string[] = [`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="#f4f2ee"/>`];
  if (s.aerial) for (const tile of s.aerial.tiles) parts.push(`<image href="data/${tile.file}" x="${(tile.left * p.wMm).toFixed(2)}" y="${(tile.top * p.hMm).toFixed(2)}" width="${(tile.width * p.wMm).toFixed(2)}" height="${(tile.height * p.hMm).toFixed(2)}" preserveAspectRatio="none"/>`);
  else parts.push(emptyNote(['The aerial imagery did not answer for this window.']));
  // cadastre, in white over the aerial
  if (b.base.lots.features.length) parts.push(`<path d="${b.base.lots.features.map((ft) => ringsPath(geomRings(ft.geometry), proj)).join('')}" fill="none" stroke="#ffffff" stroke-width="0.25" opacity="0.85"/>`);
  let hatchId = 0;
  for (const e of s.easements) parts.push(hatchPath(ringsPath(e.rings, proj), `ease${hatchId++}`, '#ffd200', bboxOf(e.rings, proj), 1.1));
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
        if (spacer.take(lx, ly, labelW(text, 2.1), 2.6)) out.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})" text-anchor="middle" dominant-baseline="middle" font-size="2.1" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${text}</text>`);
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
    if (spacer.take(x, y, labelW(text, 2), 2.6)) labels.push(`<text x="${x.toFixed(1)}" y="${(y + 0.7).toFixed(1)}" text-anchor="middle" font-size="2" font-weight="700" fill="#ffffff" stroke="#000000" stroke-width="0.35" paint-order="stroke">${esc(text)}</text>`);
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
  const rightX = FIELD_X + PANEL_W + GUTTER, rightW = FIELD_W - PANEL_W - GUTTER;
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
  const ySales = yBlock + PANEL_TITLE_H + legendRows.length * 3.7 + 3;
  const figureHtml = `
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${FIELD_Y}mm;width:${PANEL_W}mm">The site<span class="pnote">1:${fmtNum(p.scale)} · boundary lengths in metres from the digital cadastre · corner levels from the 5 m elevation model</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${FIELD_Y + PANEL_TITLE_H}mm">${mapSvg}</div>
    <div class="abs tiles" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H}mm;width:${rightW}mm">${tiles}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 25}mm;width:${rightW}mm">Site facts<span class="pnote">what the open data says before the survey and the title search</span></div>
    <div class="abs" style="left:${rightX}mm;top:${FIELD_Y + PANEL_TITLE_H + 25 + PANEL_TITLE_H}mm;width:${rightW}mm">${factsTable}</div>
    <div class="abs ptitle" style="left:${FIELD_X}mm;top:${yBlock}mm;width:${PANEL_W}mm">The block<span class="pnote">1:${fmtNum(bp.scale)} · sales within ${SALES_RADIUS_M} m and the public land around</span></div>
    <div class="abs" style="left:${FIELD_X}mm;top:${yBlock + PANEL_TITLE_H}mm">${blockSvg}</div>
    <div class="abs legend" style="left:${rightX}mm;top:${yBlock + PANEL_TITLE_H}mm;width:${rightW}mm">${legend}</div>
    <div class="abs ptitle" style="left:${rightX}mm;top:${ySales}mm;width:${rightW}mm">Recent sales<span class="pnote">latest first · single-property sales within ${SALES_RADIUS_M} m · Valuer General</span></div>
    <div class="abs" style="left:${rightX}mm;top:${ySales + PANEL_TITLE_H}mm;width:${rightW}mm">${salesTable}</div>`;
  return { id: '11_the_site', title: 'The site', subtitle: sub, textHtml, figureHtml };
}

// ---- the deck -----------------------------------------------------------------

export function renderSlides(b: SlidesBundle, meta: SheetMeta): { html: string; slides: Slide[] } {
  const facts = planningFacts(b);
  const slides = [planningOverviewSlide(b, facts), planningControlsSlide(b, facts), terrainSlide(b), developmentSlide(b, facts), builtFormSlide(b, facts), movementSlide(b), greenSlide(b), siteSlide(b), constraintsSlide(b), peopleSlide(b)];
  const t = tpl();
  const footerLeft = ['SITE ANALYST — OVERALL ANALYSIS', b.siteAddress, meta.client ? `for ${meta.client}` : '', meta.jobNo ? `job ${meta.jobNo}` : ''].filter(Boolean).join(' · ');
  const pages = slides.map((s, i) => `
<section class="slide" id="${esc(s.id)}">
  <div class="abs title" style="left:${MARGIN_L}mm;top:12mm;width:${SLIDE_W - MARGIN_L - MARGIN_R}mm">${esc(s.title)}</div>
  <div class="abs subtitle" style="left:${MARGIN_L}mm;top:20.5mm;width:${SLIDE_W - MARGIN_L - MARGIN_R}mm">${esc(s.subtitle)}</div>
  <div class="abs text" style="left:${MARGIN_L}mm;top:${FIELD_Y}mm;width:${TEXT_W}mm;height:${SLIDE_H - FIELD_Y - 16}mm">${s.textHtml}</div>
  ${s.figureHtml}
  <div class="abs foot" style="left:${MARGIN_L}mm;right:${MARGIN_R}mm;top:${SLIDE_H - 8.5}mm"><span>${esc(footerLeft)}</span><span>generated ${esc(b.generatedAt.slice(0, 10))} · ${i + 1} / ${slides.length}</span></div>
</section>`).join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(b.siteAddress)} — OVERALL ANALYSIS</title>
<style>
  @page { size: ${SLIDE_W}mm ${SLIDE_H}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { font-family: ${t.font}; background: #fff; color: ${t.ink}; }
  .slide { position: relative; width: ${SLIDE_W}mm; height: ${SLIDE_H}mm; overflow: hidden; background: #fff; page-break-after: always; break-after: page; }
  .slide:last-child { page-break-after: auto; break-after: auto; }
  .abs { position: absolute; }
  .title { font-size: 6.4mm; font-weight: 400; letter-spacing: -0.01em; line-height: 1; }
  .subtitle { font-size: 3mm; color: #555; }
  .text { font-size: 3.05mm; line-height: 1.38; overflow: hidden; }
  .text p { margin-bottom: 2.6mm; }
  .text p.ph { color: #7a7a7a; font-style: italic; border-left: 0.4mm solid #cfcfcf; padding-left: 2.2mm; }
  .text .fine { position: absolute; bottom: 0; left: 0; right: 0; font-size: 2.1mm; line-height: 1.3; color: #555; }
  .ptitle { font-size: 3.1mm; font-weight: 700; line-height: ${PANEL_TITLE_H}mm; height: ${PANEL_TITLE_H}mm; white-space: nowrap; overflow: hidden; }
  .pnote { font-weight: 400; color: #666; font-size: 2.2mm; margin-left: 2.4mm; }
  table.controls { width: 100%; border-collapse: collapse; font-size: 2.55mm; line-height: 1.32; }
  table.controls th, table.controls td { text-align: left; vertical-align: top; padding: 1.15mm 2mm 1.15mm 0; border-top: 0.15mm solid ${t.rule}; }
  table.controls thead th { font-size: 2.2mm; letter-spacing: 0.04em; text-transform: uppercase; color: #555; font-weight: 700; border-top: 0; padding-bottom: 0.8mm; }
  table.controls tbody th { font-weight: 700; }
  table.controls td.src { color: #555; font-size: 2.25mm; }
  table.controls .lnk a { color: #555; text-decoration: none; word-break: break-all; }
  .foot { display: flex; justify-content: space-between; font-size: 2.1mm; color: #555; border-top: 0.15mm solid ${t.rule}; padding-top: 1.1mm; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .tile { border-top: 0.3mm solid ${t.ink}; padding-top: 1.4mm; }
  .tv { font-size: 5.4mm; font-weight: 600; line-height: 1.05; letter-spacing: -0.01em; }
  .tl { font-size: 2.1mm; color: #555; margin-top: 0.8mm; line-height: 1.25; }
  .tiles.seven { grid-template-columns: repeat(7, 1fr); gap: 2.4mm; }
  .tiles.seven .tv { font-size: 4.9mm; }
  .tv.long { font-size: 4.1mm; }
  table.cmp { width: 100%; border-collapse: collapse; font-size: 2.3mm; line-height: 1.25; }
  table.cmp th, table.cmp td { text-align: right; vertical-align: top; padding: 0.85mm 0 0.85mm 1.5mm; border-top: 0.15mm solid ${t.rule}; font-variant-numeric: tabular-nums; }
  table.cmp th:first-child, table.cmp td:first-child { text-align: left; padding-left: 0; }
  table.cmp thead th { font-size: 2.0mm; letter-spacing: 0.04em; text-transform: uppercase; color: #555; border-top: 0; padding-bottom: 0.7mm; font-weight: 700; }
  table.cmp td.hi { font-weight: 700; }
  .stat { font-size: 2.2mm; color: #333; line-height: 1.3; margin-bottom: 1mm; }
  .legend { font-size: 2.15mm; color: #333; line-height: 1.3; }
  .lg { display: flex; align-items: flex-start; gap: 1.6mm; margin-bottom: 0.7mm; }
  .lg svg { flex: none; margin-top: 0.1mm; }
  table.da { width: 100%; border-collapse: collapse; font-size: 2.3mm; line-height: 1.28; }
  table.da th, table.da td { text-align: left; vertical-align: top; padding: 0.95mm 1.6mm 0.95mm 0; border-top: 0.15mm solid ${t.rule}; }
  table.da thead th { font-size: 2.05mm; letter-spacing: 0.04em; text-transform: uppercase; color: #555; border-top: 0; padding-bottom: 0.7mm; }
  table.da .n { width: 5mm; font-weight: 700; }
  table.da .r { text-align: right; padding-right: 3mm; font-variant-numeric: tabular-nums; }
  table.da .more { color: #555; font-style: italic; }
  table.da .dot { display: inline-block; width: 2.2mm; height: 2.2mm; border-radius: 50%; border: 0.25mm solid; margin-right: 1.2mm; vertical-align: -0.3mm; }
  table.da.cons { font-size: 2.2mm; line-height: 1.22; }
  table.da.cons th, table.da.cons td { padding: 0.7mm 1.4mm 0.7mm 0; }
  table.da.cons tr.hit td { font-weight: 600; }
  table.da.cons tr.hit td:first-child { border-left: 0.6mm solid ${t.site}; padding-left: 1.2mm; }
  table.da.facts th { width: 33mm; font-weight: 600; font-size: 2.2mm; text-transform: none; letter-spacing: 0; color: #333; text-align: left; vertical-align: top; }
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
    constraints: (() => { const f = constraintsFacts(b); return { ...f, sentences: constraintsSentences(b, f) }; })(),
    green: (() => { const f = greenFacts(b); return { ...f, openSpace: { ...f.openSpace, spaces: f.openSpace.spaces.map(({ rings: _r, ...s }) => s), nearest: f.openSpace.nearest && (({ rings: _r, ...s }) => s)(f.openSpace.nearest), largest: f.openSpace.largest && (({ rings: _r, ...s }) => s)(f.openSpace.largest) }, sentences: greenSentences(b, f) }; })(),
    builtForm: (() => { const f = builtFormFacts(b, facts); return { ...f, sentences: builtFormSentences(b, f) }; })(),
    terrain: (() => { const f = terrainFacts(b); return f ? { ...f, sections: f.sections.map((s) => ({ ...s, samples: s.samples.filter((_, i) => i % 4 === 0) })), sentences: terrainSentences(b, f) } : { available: false, sentences: terrainSentences(b, f) }; })(),
    propertyApi: b.property,
    sentences: planningSentences(b, facts),
    sentenceList: sentenceList(planningSentences(b, facts)),
    warnings: b.warnings,
  };
}

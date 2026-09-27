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
  panelProjector, baseLayers, overLayers, panelFurniture, furnitureBox, siteMark, siteLabelPoint, ringsPath, ringStats, clippedStats, hatchPath, bboxOf,
  legendSvg, swatchFill, swatchHatch, swatchLine, LabelSpacer, type Proj, type LegendEntry, type FurnitureCorner,
} from './minimap.js';
import { zoneFill, heritageStyle, hobRamp, POLICY_STYLE } from './lepPalette.js';
import { geomRings, pointInRing, titleCase, type PolicyArea, type PolicyKind } from '../fetch/planning.js';
import { lonLatToMercator, mercatorToLonLat } from '../lib/geo.js';
import { isSignificant, siteKey, parseSiteAddress, sameLot, money, type DaRecord, type DaStatusClass, type SiteAddress } from '../fetch/da.js';

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

// ---- the deck -----------------------------------------------------------------

export function renderSlides(b: SlidesBundle, meta: SheetMeta): { html: string; slides: Slide[] } {
  const facts = planningFacts(b);
  const slides = [planningOverviewSlide(b, facts), planningControlsSlide(b, facts), developmentSlide(b, facts)];
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
    propertyApi: b.property,
    sentences: planningSentences(b, facts),
    sentenceList: sentenceList(planningSentences(b, facts)),
    warnings: b.warnings,
  };
}

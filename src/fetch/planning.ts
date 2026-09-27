// Planning layers for the OVERALL ANALYSIS slides — what the sheets do not
// carry. All NSW ePlanning / Spatial Services ArcGIS layers except the
// Planning Portal's own property API, which answers every EPI map at a
// property in one call, with legislation links, and a council housing-target
// page, which is HTML. Every fetch here is individually soft: a missing layer
// costs a row or a legend entry, never the deck.

import { queryByExtent, queryByPoint, type GeoJSONFC, type GeoJSONFeature } from '../lib/arcgis.js';
import { retryFetch } from '../lib/http.js';
import type { Extent, XY } from '../lib/geo.js';

const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
const EPI = `${M3}/Planning/EPI_Primary_Planning_Layers/MapServer`;
const HOUSING = `${M3}/Planning/SEPP_Housing_2021/MapServer`;
const HMS = `${M3}/HMS/Heritage/MapServer`;
const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const PP_API = 'https://api.apps1.nsw.gov.au/planning/viewersf/V1/ePlanningApi';

const EMPTY: GeoJSONFC = { type: 'FeatureCollection', features: [] };
const CURRENCY = 'EPI_NAME,AMENDMENT,PUBLISHED_DATE,COMMENCED_DATE,CURRENCY_DATE,LGA_NAME';

// ---- the four map panels ---------------------------------------------------

export const fetchZoningDetailed = (extent: Extent) =>
  queryByExtent(`${EPI}/2`, extent, `SYM_CODE,LAY_CLASS,${CURRENCY}`);

export const fetchHobDetailed = (extent: Extent) =>
  queryByExtent(`${EPI}/5`, extent, `MAX_B_H,UNITS,MAX_B_H_M,MAX_B_H_RL,LAY_CLASS,${CURRENCY}`);

export const fetchFsrDetailed = (extent: Extent) =>
  queryByExtent(`${EPI}/1`, extent, `FSR,LAY_CLASS,${CURRENCY}`);

export const fetchHeritageDetailed = (extent: Extent) =>
  queryByExtent(`${EPI}/0`, extent, `LAY_CLASS,H_ID,H_NAME,SIG,${CURRENCY}`);

/** State Heritage Register curtilages from the Heritage NSW register layer. */
export const fetchShrCurtilages = (extent: Extent) =>
  queryByExtent(`${HMS}/6`, extent, 'ITEMNAME,LISTINGNO,ADDRESS,TYPE,LISTING_DATE');

export type PolicyKind = 'tod' | 'todAccelerated' | 'todDeferred' | 'townCentre' | 'ssdSite' | 'precinct';
export interface PolicyArea { kind: PolicyKind; name: string; rings: number[][][]; source: string }

/**
 * The housing-policy maps: Transport Oriented Development areas and their
 * accelerated and deferred precincts, the Town Centres map that anchors the
 * low- and mid-rise housing policy, State significant development sites and
 * the department's planning precincts. Each layer fails on its own.
 */
export async function fetchPolicyAreas(extent: Extent, log: (m: string) => void = () => {}): Promise<PolicyArea[]> {
  const specs: { kind: PolicyKind; url: string; fields: string; name: (p: Record<string, any>) => string; source: string }[] = [
    { kind: 'tod', url: `${HOUSING}/3`, fields: 'LAY_CLASS,PRECINCT,MAP_NAME',
      name: (p) => titleCase(p.PRECINCT) || 'TOD area', source: 'SEPP (Housing) 2021 — Transport Oriented Development Sites Map' },
    { kind: 'todAccelerated', url: `${HOUSING}/4`, fields: 'LAY_CLASS,LABEL,MAP_NAME',
      name: (p) => p.LABEL || p.LAY_CLASS || 'Accelerated TOD precinct', source: 'SEPP (Housing) 2021 — Accelerated TOD Precincts Rezoning Areas Map' },
    { kind: 'todDeferred', url: `${HOUSING}/5`, fields: 'LAY_CLASS,LABEL,MAP_NAME',
      name: (p) => p.LABEL || p.LAY_CLASS || 'Deferred TOD area', source: 'SEPP (Housing) 2021 — Deferred Transport Oriented Development Areas Map' },
    { kind: 'townCentre', url: `${HOUSING}/6`, fields: 'LAY_CLASS,LABEL,LGA_NAME,MAP_NAME',
      name: (p) => p.LABEL || p.LAY_CLASS || 'Town centre', source: 'SEPP (Housing) 2021 — Town Centres Map' },
    { kind: 'ssdSite', url: `${M3}/Planning/SEPP_Planning_Systems_2021/MapServer/3`, fields: 'LAY_CLASS,MAP_NAME',
      name: (p) => p.LAY_CLASS || 'SSD site', source: 'SEPP (Planning Systems) 2021 — State Significant Development Sites Map' },
    { kind: 'precinct', url: `${M3}/Planning/DPIE_PlanningPrecincts/MapServer/4`, fields: 'LAY_NAME,LABEL,PRECINCT,CATEGORY',
      name: (p) => p.PRECINCT || p.LABEL || p.LAY_NAME || 'Planning precinct', source: 'DPHI planning precincts' },
  ];
  const out: PolicyArea[] = [];
  await Promise.all(specs.map(async (s) => {
    try {
      const fc = await queryByExtent(s.url, extent, s.fields);
      for (const f of fc.features) {
        const rings = geomRings(f.geometry);
        if (rings.length) out.push({ kind: s.kind, name: s.name(f.properties), rings, source: s.source });
      }
    } catch (e: any) {
      log(`  WARN ${s.kind} layer failed: ${e?.message ?? e}`);
    }
  }));
  return out;
}

/** Water bodies for the map base (harbour, rivers, lakes). */
export const fetchWaterAreas = (extent: Extent) =>
  queryByExtent(`${PORTAL}/NSW_Water_Theme/FeatureServer/6`, extent, 'hydroname,hydrotype');

// ---- what applies AT the site ---------------------------------------------

export interface PlanningContext {
  lga?: { name: string; council: string };
  suburb?: { name: string; postcode?: string };
  district?: string;
  lalc?: { local: string; regional: string };
  /** The DCPs mapped at the point; the first is the general one, the rest site- or theme-specific. */
  dcp?: { name: string; url?: string };
  dcps: { name: string; url?: string }[];
  contributions: { kind: string; name: string; detail?: string }[];
}

export async function fetchPlanningContext(point: XY, log: (m: string) => void = () => {}): Promise<PlanningContext> {
  const at = async (url: string, fields = '*'): Promise<Record<string, any>[]> => {
    try { return (await queryByPoint(url, point, fields)).features.map((f) => f.properties); }
    catch (e: any) { log(`  WARN ${url.split('/').slice(-3).join('/')} failed: ${e?.message ?? e}`); return []; }
  };
  const ADMIN = `${PORTAL}/NSW_Administrative_Boundaries_Theme/FeatureServer`;
  const DC = `${M3}/ePlanning/Planning_Portal_Development_Control/MapServer`;
  const CONTRIB = `${M3}/ePlanning/Planning_Portal_Contributions/MapServer`;
  const [lga, suburb, lalc, district, dcp, sic, hpcBase, hpcBio, hpcTransport, localPlan] = await Promise.all([
    at(`${ADMIN}/8`, 'lganame,councilname'),
    at(`${ADMIN}/2`, 'suburbname,postcode'),
    at(`${ADMIN}/1`, 'localcouncilname,regionalcouncilname'),
    at(`${M3}/Planning/Administrative_Boundary/MapServer/1`, 'DISTRICT_NAME'),
    at(`${DC}/220`, 'PLAN_NAME,FILE_NAME,COUNCIL_NAME'),
    at(`${CONTRIB}/218`),
    at(`${CONTRIB}/148`),
    at(`${CONTRIB}/416`),
    at(`${CONTRIB}/180`),
    at(`${DC}/219`),
  ]);

  // FILE_NAME is a URL for most councils and a stray character for a few. A
  // council can have several DCPs over one point (City of Sydney has a general
  // one and themed ones); the general plan — no " - " qualifier, shortest
  // name — leads.
  const seenDcp = new Set<string>();
  const dcps = dcp
    .map((r) => ({ name: String(r.PLAN_NAME ?? '').trim(), url: /^https?:\/\//i.test(String(r.FILE_NAME ?? '')) ? String(r.FILE_NAME) : undefined }))
    .filter((d) => d.name && !seenDcp.has(d.name) && seenDcp.add(d.name))
    .sort((a, b) => Number(/ - /.test(a.name)) - Number(/ - /.test(b.name)) || a.name.length - b.name.length);

  const contributions: PlanningContext['contributions'] = [];
  for (const s of sic) {
    contributions.push({
      kind: 'Special Infrastructure Contribution',
      name: String(s.SIC_AREA ?? s.ACT_NAME ?? 'SIC area'),
      detail: [s.RATE_RESIDENTIAL && `residential ${s.RATE_RESIDENTIAL}`, s.RATE_INDUSTRIAL && `industrial ${s.RATE_INDUSTRIAL}`]
        .filter(Boolean).join(', ') || undefined,
    });
  }
  const hpc = (rows: Record<string, any>[], component: string) => {
    for (const r of rows) {
      const name = String(r.RULESET_NAME ?? r.PART_NAME ?? r.Plan_Name ?? r.PLAN_NAME ?? r.LABEL ?? 'applies');
      const plan = String(r.Plan_Name ?? r.PLAN_NAME ?? '');
      contributions.push({
        kind: `Housing and Productivity Contribution — ${component}`,
        name,
        detail: plan && plan !== name ? plan : undefined,
      });
    }
  };
  hpc(hpcBase, 'base'); hpc(hpcBio, 'strategic biodiversity'); hpc(hpcTransport, 'transport project');
  for (const r of localPlan) {
    contributions.push({
      kind: 'Local contributions plan',
      name: String(r.PLAN_NAME ?? r.Plan_Name ?? 'council contributions plan'),
      detail: /^https?:\/\//i.test(String(r.FILE_NAME ?? '')) ? String(r.FILE_NAME) : undefined,
    });
  }

  return {
    lga: lga[0] ? { name: String(lga[0].lganame ?? ''), council: String(lga[0].councilname ?? '') } : undefined,
    suburb: suburb[0] ? { name: String(suburb[0].suburbname ?? ''), postcode: suburb[0].postcode ? String(suburb[0].postcode) : undefined } : undefined,
    district: district[0]?.DISTRICT_NAME ? titleCase(String(district[0].DISTRICT_NAME)) : undefined,
    lalc: lalc[0] ? { local: titleCase(String(lalc[0].localcouncilname ?? '')), regional: titleCase(String(lalc[0].regionalcouncilname ?? '')) } : undefined,
    dcp: dcps[0],
    dcps,
    contributions,
  };
}

// ---- the Planning Portal property API -------------------------------------

export interface PropertyLayerHit { id: string; layerName: string; results: Record<string, string>[] }
export interface PropertyReport {
  propId: number;
  address: string;
  /** Every EPI map that touches the property: zoning, height, FSR, heritage, local provisions, canopy… */
  epi: PropertyLayerHit[];
  /** Every SEPP and SEPP map that applies. */
  sepp: PropertyLayerHit[];
}

async function ppJson(path: string): Promise<any> {
  const res = await retryFetch(`${PP_API}/${path}`, {}, { attempts: 3, timeoutMs: 45_000, label: 'planning portal api' });
  if (!res.ok) throw new Error(`planning portal api HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * The address search matches substrings ("5 BLUE STREET" also finds "36 BLUE
 * STREET" units and the street itself), so candidates are checked against the
 * site: the first whose property boundary contains the geocoded point wins.
 */
export async function fetchPropertyReport(matchedAddress: string, center: XY, log: (m: string) => void = () => {}): Promise<PropertyReport | null> {
  try {
    const q = matchedAddress.toUpperCase().replace(/\s+/g, ' ').trim();
    const candidates: { address: string; propId: number }[] = (await ppJson(`address?a=${encodeURIComponent(q)}`)) ?? [];
    if (!candidates.length) { log('  planning portal api: no property for this address'); return null; }
    const exact = candidates.filter((c) => String(c.address).toUpperCase().startsWith(q));
    const ordered = [...exact, ...candidates.filter((c) => !exact.includes(c))].slice(0, 6);
    let chosen = ordered[0];
    for (const c of ordered) {
      try {
        const b = await ppJson(`boundary?id=${c.propId}&Type=property`);
        const rings: number[][][] = b?.[0]?.geometry?.rings ?? [];
        if (rings.some((r) => pointInRing(center.x, center.y, r))) { chosen = c; break; }
      } catch { /* try the next candidate */ }
    }
    const [epi, sepp] = await Promise.all([
      ppJson(`layerintersect?type=property&id=${chosen.propId}&layers=epi`).catch(() => []),
      ppJson(`layerintersect?type=property&id=${chosen.propId}&layers=sepp`).catch(() => []),
    ]);
    const norm = (rows: any): PropertyLayerHit[] => (Array.isArray(rows) ? rows : []).map((g: any) => ({
      id: String(g.id ?? ''), layerName: String(g.layerName ?? ''),
      results: (Array.isArray(g.results) ? g.results : []).map((r: any) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]))),
    }));
    return { propId: Number(chosen.propId), address: String(chosen.address), epi: norm(epi), sepp: norm(sepp) };
  } catch (e: any) {
    log(`  WARN planning portal api failed: ${e?.message ?? e}`);
    return null;
  }
}

// ---- the council's housing target -----------------------------------------

export interface HousingTarget { homes: number; by: number; url: string }

/**
 * planning.nsw.gov.au publishes a snapshot page per council with its 5-year
 * completions target. HTML, and only the 43 councils that were given one, so
 * this is best effort: a page that is not there is simply no row.
 */
export async function fetchHousingTarget(lgaName: string): Promise<HousingTarget | null> {
  const slug = lgaName.toLowerCase().replace(/\bcity of\b|\bcouncil\b|\bthe\b|\bmunicipality of\b/g, '').trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  const url = `https://www.planning.nsw.gov.au/the-planning-system/housing/housing-targets/${slug}-councils-snapshot`;
  try {
    const res = await retryFetch(url, { headers: { 'User-Agent': 'site-analyst (housing target lookup)' } },
      { attempts: 2, timeoutMs: 20_000, label: 'housing target' });
    if (!res.ok) return null;
    const text = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/(\d{1,3}(?:,\d{3})*)\s+New completed homes by (\d{4})/i);
    if (!m) return null;
    return { homes: Number(m[1].replace(/,/g, '')), by: Number(m[2]), url };
  } catch { return null; }
}

// ---- small helpers ----------------------------------------------------------

export function geomRings(geometry: GeoJSONFeature['geometry']): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function titleCase(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and');
}

export { EMPTY as EMPTY_FC };

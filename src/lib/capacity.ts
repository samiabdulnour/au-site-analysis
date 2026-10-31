// The capacity and opportunity study's reading of the blocks around a site:
// every property classified by ownership (a single title, a strata scheme
// and its size, council or State land), by heritage listing, by when it was
// last significantly developed, and by what is approved or under
// construction on it; then a mark on each — a tick for development
// potential, a cross for low potential — and a grey patch on the mature
// development. Pure geometry and record selection on the register's rows,
// so the slide and the standalone sheet (scripts/capacity_study.ts) read the
// same rules, and the test can say what a change broke.

import { isSignificant, type DaRecord } from '../fetch/da.js';
import type { GeoJSONFC, GeoJSONFeature } from './arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat, type Extent, type XY } from './geo.js';

export interface CapacityOptions {
  /** A strata scheme of more than this many lots is printed with its count. */
  strataMax: number;
  /** A site significantly developed within these years is mature development. */
  recentYears: number;
  /** A strata scheme under this many lots is not, by itself, a significant development. */
  smallScheme: number;
  /** A title under this many square metres has little ability to develop above its current status. */
  smallSite: number;
  /** The year the study is made, for the window. */
  thisYear: number;
}
export const CAPACITY_DEFAULTS: CapacityOptions = { strataMax: 30, recentYears: 20, smallScheme: 5, smallSite: 250, thisYear: new Date().getFullYear() };

/** What the author knows that the data does not, keyed by the start of the address as the register writes it. */
export type CapacityOverride = { symbol?: 'mature' | 'none' | 'potential'; note?: string };
export type CapacityOverrides = Record<string, CapacityOverride>;

/** One row of a council's development register (the City of Sydney publishes one), with its polygon. */
export interface RegisterRecord {
  address: string; da?: string; type: string; status: string;
  lodged?: string; determined?: string; completion?: string;
  dwellings: number; levels: number; gfa: number;
  /** lon/lat rings. */
  rings: number[][][];
  extracted?: string;
}
/** Land that is not for sale: a park, a council facility's lot, State government land. */
export interface PublicLand { kind: 'council' | 'state'; name?: string; rings: number[][][] }
export interface FacilityPoint { name: string; lon: number; lat: number }

export interface CapacityInputs {
  /** The site's point, Web Mercator. */
  centre: XY;
  /** The cadastre's property register (layer 12): one row per address, with propid, address, valnetpropertytype, valnetlotcount. */
  properties: GeoJSONFC;
  /** The cadastre's lots (layer 8) with lotidstring, planlabel, classsubtype and createdate. */
  lots: GeoJSONFC;
  /** The LEP heritage layer: LAY_CLASS and H_NAME. */
  heritage: GeoJSONFC;
  publicLand: PublicLand[];
  facilities: FacilityPoint[];
  register: RegisterRecord[];
  /** The Planning Portal's applications over the window, as the deck reads them. */
  applications: DaRecord[];
  overrides?: CapacityOverrides;
  options?: Partial<CapacityOptions>;
}

export type CapacityKind = 'site' | 'council' | 'state' | 'developing' | 'strata' | 'single';
export type CapacityMark = 'tick' | 'cross';
export interface Developed { year: number; how: 'built' | 'strata'; detail: string }

export interface CapacityProperty {
  propid: number;
  /** The address without a unit, as the register writes it. */
  base: string;
  /** lon/lat rings of the property's polygon. */
  rings: number[][][];
  /** Web Mercator rings, for the geometry. */
  ringsM: number[][][];
  centroidM: XY;
  centroid: { lon: number; lat: number };
  areaM2: number;
  kind: CapacityKind;
  strata: boolean;
  /** Unit addresses in the register (the register's lot count where a strata plan is recorded, if larger). */
  units: number;
  strataPlans: string[];
  strataRegistered?: string;
  heritageItem?: string;
  inHca?: string;
  developed: Developed | null;
  active: RegisterRecord[];
  liveDa: DaRecord[];
  override?: CapacityOverride;
  isSite: boolean;
  /** Patched grey: a mature development. */
  mature: boolean;
  mark: CapacityMark;
  /** Printed under the mark: the year it was developed, "approved", the lot count of a large scheme, or the author's note. */
  note?: string;
  lots: string[];
}

export interface CapacityLot { id: string; plan?: string; rings: number[][][]; areaM2: number; registered?: string; propid?: number }

export interface CapacityResult {
  options: CapacityOptions;
  /** The first year of the window: a site developed since is mature. */
  since: number;
  properties: CapacityProperty[];
  lots: CapacityLot[];
  site: CapacityProperty | null;
  /** The titles that share a boundary with the site, longest first. */
  neighbours: { base: string; sharedM: number; kind: CapacityKind; strata: boolean; units: number; heritageItem?: string }[];
  /** The register's second record of one parcel, left out. */
  duplicates: number;
}

// ---- geometry, about each ring's first vertex: at Web Mercator magnitudes the raw shoelace terms cancel to the last digits of a double

const ringsOf = (g: GeoJSONFeature['geometry']): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const toM = (rings: number[][][]): number[][][] => rings.map((r) => r.map(([lon, lat]) => { const m = lonLatToMercator({ lon, lat }); return [m.x, m.y]; }));

export function ringArea(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const [x0, y0] = ring[0];
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    a += (ax - x0) * (by - y0) - (bx - x0) * (ay - y0);
  }
  return a / 2;
}
export function ringCentre(ring: number[][]): XY {
  const a = ringArea(ring);
  if (Math.abs(a) < 1e-6 || ring.length < 3) { let sx = 0, sy = 0; for (const p of ring) { sx += p[0]; sy += p[1]; } return { x: sx / ring.length, y: sy / ring.length }; }
  const [x0, y0] = ring[0];
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const x1 = ring[i][0] - x0, y1 = ring[i][1] - y0, x2 = ring[(i + 1) % ring.length][0] - x0, y2 = ring[(i + 1) % ring.length][1] - y0;
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return { x: x0 + cx / (6 * a), y: y0 + cy / (6 * a) };
}
const outer = (rings: number[][][]) => rings.reduce((best, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(best)) ? r : best), rings[0]);
function pip(p: XY, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
/** Inside the largest ring and in none of the holes. */
export function inRingsM(p: XY, rings: number[][][]): boolean {
  if (!rings.length) return false;
  const o = outer(rings);
  if (!pip(p, o)) return false;
  return !rings.some((r) => r !== o && pip(p, r));
}
const distPtSeg = (p: number[], a: number[], b: number[]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};
/** Metres of r1's boundary that lie along r2's (mercator metres, divided by k for the ground). */
function sharedBoundary(r1: number[][][], r2: number[][][], tol = 0.3): number {
  const a = outer(r1), b = outer(r2);
  const near = (p: number[]) => { for (let i = 0; i < b.length; i++) if (distPtSeg(p, b[i], b[(i + 1) % b.length]) < tol) return true; return false; };
  let L = 0;
  for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; if (near(p) && near(q)) L += Math.hypot(p[0] - q[0], p[1] - q[1]); }
  return L;
}

const isoDay = (v: unknown): string | undefined => { const n = Number(v); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : undefined; };
const yearOf = (iso?: string) => Number((iso ?? '').slice(0, 4)) || 0;

/** A development that changes the built form: a new building, or an addition or conversion of four storeys, five dwellings or 1,000 m² of floor space. */
export const majorWork = (d: RegisterRecord) => d.type === 'New Building' || ((d.type === 'Addition' || d.type === 'Conversion') && (d.levels >= 4 || d.dwellings >= 5 || d.gfa >= 1000));
const ACTIVE_STATUS = new Set(['Lodged', 'Approved', 'Construction Commenced']);
const ALTER = /alteration|addition|fitout|fit-out|change of use|use of/i;
/** A live application of a scale that shapes context and is not alterations to what stands. */
export const liveNewBuild = (r: DaRecord) => r.statusClass === 'active' && isSignificant(r) && !(r.developmentTypes.some((t) => ALTER.test(t)) && (r.dwellings ?? 0) < 10 && (r.storeys ?? 0) < 4);

/** The register's rows as records: a council's development register with its dates as epoch milliseconds or ISO days. */
export function registerRecords(fc: GeoJSONFC): RegisterRecord[] {
  const out: RegisterRecord[] = [];
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : isoDay(v));
  for (const f of fc.features) {
    const p = f.properties, rings = ringsOf(f.geometry);
    if (!rings.length) continue;
    out.push({
      address: `${p.StNumber ?? ''} ${p.StName ?? ''}`.trim(), da: p.DA_Number ? String(p.DA_Number) : undefined, type: String(p.DevelopmentType ?? ''), status: String(p.Status_1 ?? ''),
      lodged: day(p.Lodged), determined: day(p.Determined), completion: day(p.Completion),
      dwellings: Number(p.Priv_Dwgs) || 0, levels: Number(p.LevelsAbove) || 0, gfa: Number(p.GFA) || 0, rings, extracted: day(p.DateExtracted),
    });
  }
  return out;
}

export function classifyCapacity(input: CapacityInputs): CapacityResult {
  const options: CapacityOptions = { ...CAPACITY_DEFAULTS, ...(input.options ?? {}) };
  const since = options.thisYear - options.recentYears;
  const k = mercatorScaleFactor(mercatorToLonLat(input.centre).lat);
  const overrides = Object.fromEntries(Object.entries(input.overrides ?? {}).map(([key, v]) => [key.toUpperCase().trim(), v]));

  // ---- the register: one record per propid, its unit addresses counted
  interface Row { propid: number; addresses: Set<string>; units: Set<string>; valtype: Set<number>; lotcount: number; rings: number[][][]; ringsM: number[][][]; areaMm: number }
  const rows = new Map<number, Row>();
  for (const f of input.properties.features) {
    const p = f.properties;
    const pid = Number(p.propid);
    if (!Number.isFinite(pid)) continue;
    const row = rows.get(pid) ?? rows.set(pid, { propid: pid, addresses: new Set(), units: new Set(), valtype: new Set(), lotcount: Number(p.valnetlotcount) || 0, rings: [], ringsM: [], areaMm: -1 }).get(pid)!;
    const addr = String(p.address ?? '').trim();
    if (addr) { row.addresses.add(addr); if (addr.includes('/')) row.units.add(addr.split(' ')[0]); }
    if (p.valnetpropertytype != null) row.valtype.add(Number(p.valnetpropertytype));
    const rings = ringsOf(f.geometry);
    if (rings.length) {
      const rm = toM(rings), a = Math.abs(ringArea(outer(rm)));
      if (a > row.areaMm) { row.rings = rings; row.ringsM = rm; row.areaMm = a; }
    }
  }

  // ---- the lots, each linked to the property that holds its centroid
  const lots: CapacityLot[] = [];
  const spUnder = new Map<number, string[]>(), spRegistered = new Map<number, string>();
  const props: { row: Row; centroidM: XY }[] = [...rows.values()].filter((r) => r.rings.length).map((row) => ({ row, centroidM: ringCentre(outer(row.ringsM)) }));
  for (const f of input.lots.features) {
    const rings = ringsOf(f.geometry);
    if (!rings.length) continue;
    const rm = toM(rings), c = ringCentre(outer(rm));
    const p = f.properties;
    const created = isoDay(p.createdate);
    // the cadastre's record date is the plan's registration date for plans after the digital cadastre was built (September 1993)
    const registered = created && created >= '1994-01-01' ? created : undefined;
    const holder = props.find((q) => inRingsM(c, q.row.ringsM));
    const lot: CapacityLot = { id: String(p.lotidstring ?? ''), plan: p.planlabel ? String(p.planlabel) : undefined, rings, areaM2: Math.round(Math.abs(ringArea(outer(rm))) / (k * k)), registered, propid: holder?.row.propid };
    lots.push(lot);
    if (holder && lot.plan?.startsWith('SP')) {
      (spUnder.get(holder.row.propid) ?? spUnder.set(holder.row.propid, []).get(holder.row.propid)!).push(lot.id);
      if (registered && registered > (spRegistered.get(holder.row.propid) ?? '')) spRegistered.set(holder.row.propid, registered);
    }
  }

  // ---- the overlays
  const items = input.heritage.features.filter((f) => String(f.properties.LAY_CLASS ?? '').startsWith('Item')).map((f) => ({ name: String(f.properties.H_NAME ?? 'Heritage item'), ringsM: toM(ringsOf(f.geometry)) })).filter((h) => h.ringsM.length);
  const hcas = input.heritage.features.filter((f) => String(f.properties.LAY_CLASS ?? '').startsWith('Conservation')).map((f) => ({ name: String(f.properties.H_NAME ?? ''), ringsM: toM(ringsOf(f.geometry)) })).filter((h) => h.ringsM.length);
  const publicM = input.publicLand.map((l) => ({ ...l, ringsM: toM(l.rings) })).filter((l) => l.ringsM.length);
  const facilityM = input.facilities.map((f) => { const m = lonLatToMercator({ lon: f.lon, lat: f.lat }); return { ...f, m }; });
  const register = input.register.map((d) => ({ d, ringsM: toM(d.rings) })).filter((d) => d.ringsM.length);
  const liveDas = input.applications.filter((r) => r.lon !== undefined && r.lat !== undefined && liveNewBuild(r)).map((r) => ({ r, m: lonLatToMercator({ lon: r.lon!, lat: r.lat! }) }));

  // ---- the classification, one parcel counted once
  const out: CapacityProperty[] = [];
  const seen: XY[] = [];
  let duplicates = 0;
  for (const { row, centroidM } of props) {
    if (seen.some((c) => Math.hypot(c.x - centroidM.x, c.y - centroidM.y) < 0.5 * k)) { duplicates++; continue; }
    seen.push(centroidM);
    const addresses = [...row.addresses].sort((a, b) => Number(a.includes('/')) - Number(b.includes('/')) || a.localeCompare(b));
    const base = addresses.find((a) => !a.includes('/')) ?? addresses[0] ?? '';
    const strataPlans = spUnder.get(row.propid) ?? [];
    // strata where the cadastre holds a strata plan under the property, where the register files its addresses as
    // under a strata plan (schemes on stratum lots), or where three or more unit addresses share the title
    const strata = strataPlans.length > 0 || row.valtype.has(4) || row.units.size >= 3;
    const units = strataPlans.length ? Math.max(row.units.size, row.lotcount) : row.units.size;
    const heritageItem = items.find((h) => inRingsM(centroidM, h.ringsM))?.name;
    const inHca = hcas.find((h) => inRingsM(centroidM, h.ringsM))?.name;
    const publicHit = publicM.find((l) => inRingsM(centroidM, l.ringsM)) ?? (facilityM.some((f) => inRingsM(f.m, row.ringsM)) ? { kind: 'council' as const } : undefined);
    const onIt = register.filter((x) => inRingsM(centroidM, x.ringsM) || inRingsM(ringCentre(outer(x.ringsM)), row.ringsM)).map((x) => x.d);
    const active = onIt.filter((d) => ACTIVE_STATUS.has(d.status) && majorWork(d));
    const recent = onIt.filter((d) => d.status === 'Completed' && yearOf(d.completion) >= since && majorWork(d));
    const liveDa = liveDas.filter((x) => inRingsM(x.m, row.ringsM)).map((x) => x.r);
    const strataRegistered = spRegistered.get(row.propid);
    const developedList: Developed[] = recent.map((d) => ({ year: yearOf(d.completion), how: 'built' as const, detail: `${d.type.toLowerCase()} completed ${yearOf(d.completion)}${d.da ? `, ${d.da}` : ''}` }));
    if (strataRegistered && yearOf(strataRegistered) >= since && units >= options.smallScheme) developedList.push({ year: yearOf(strataRegistered), how: 'strata', detail: `strata scheme of ${units} lots registered ${yearOf(strataRegistered)}` });
    const developed = developedList.length ? developedList.reduce((a, b) => (b.year > a.year ? b : a)) : null;
    const override = Object.entries(overrides).find(([key]) => base.toUpperCase().startsWith(key))?.[1];
    const isSite = inRingsM(input.centre, row.ringsM);
    const kind: CapacityKind = isSite ? 'site' : publicHit ? publicHit.kind : active.length || liveDa.length ? 'developing' : strata ? 'strata' : 'single';
    const o = override?.symbol;
    const mature = o === 'mature' ? true : o === 'potential' || o === 'none' ? false : kind === 'developing' || developed !== null;
    const areaM2 = Math.round(row.areaMm / (k * k));
    const cross = o === 'none' || o === 'mature' || mature || kind === 'council' || kind === 'state' || !!heritageItem || strata || areaM2 < options.smallSite;
    const mark: CapacityMark = o === 'potential' ? 'tick' : cross ? 'cross' : 'tick';
    let note: string | undefined;
    if (mature) note = developed ? `${developed.how} ${developed.year}` : kind === 'developing' ? 'approved' : undefined;
    if (!note && strata && units > options.strataMax) note = `${units} lots`;
    if (override?.note) note = String(override.note);
    const c = mercatorToLonLat(centroidM);
    out.push({
      propid: row.propid, base, rings: row.rings, ringsM: row.ringsM, centroidM, centroid: c, areaM2, kind, strata, units, strataPlans, strataRegistered,
      heritageItem, inHca, developed, active, liveDa, override, isSite, mature: isSite ? false : mature, mark: isSite ? 'tick' : mark, note: isSite ? undefined : note,
      lots: lots.filter((l) => l.propid === row.propid).map((l) => l.id),
    });
  }
  const site = out.find((p) => p.isSite) ?? null;
  const neighbours = site
    ? out.filter((p) => p !== site && Math.hypot(p.centroidM.x - site.centroidM.x, p.centroidM.y - site.centroidM.y) / k < 120)
      .map((p) => ({ base: p.base, sharedM: Math.round((sharedBoundary(p.ringsM, site.ringsM) / k) * 10) / 10, kind: p.kind, strata: p.strata, units: p.units, heritageItem: p.heritageItem }))
      .filter((n) => n.sharedM >= 3).sort((a, b) => b.sharedM - a.sharedM)
    : [];
  return { options, since, properties: out, lots, site, neighbours, duplicates };
}

/** The properties whose centroid lies in the window, the site apart. */
export function inWindow(result: CapacityResult, extent: Extent): CapacityProperty[] {
  return result.properties.filter((p) => !p.isSite && p.centroidM.x >= extent.xmin && p.centroidM.x <= extent.xmax && p.centroidM.y >= extent.ymin && p.centroidM.y <= extent.ymax);
}

export interface CapacityCounts { properties: number; potential: number; low: number; mature: number; strata: number; heritage: number; publicLand: number; overridden: number; small: number }
export function capacityCounts(visible: CapacityProperty[], options: CapacityOptions): CapacityCounts {
  return {
    properties: visible.length,
    potential: visible.filter((p) => p.mark === 'tick').length,
    low: visible.filter((p) => p.mark === 'cross').length,
    mature: visible.filter((p) => p.mature).length,
    strata: visible.filter((p) => p.strata).length,
    heritage: visible.filter((p) => p.heritageItem).length,
    publicLand: visible.filter((p) => p.kind === 'council' || p.kind === 'state').length,
    overridden: visible.filter((p) => p.override).length,
    small: visible.filter((p) => !p.strata && !p.heritageItem && !p.mature && !p.override && p.kind === 'single' && p.areaM2 < options.smallSite).length,
  };
}

/** The parcel whose polygon holds a point, if any. */
export function propertyAt(result: CapacityResult, lon: number, lat: number): CapacityProperty | undefined {
  const m = lonLatToMercator({ lon, lat });
  return result.properties.find((p) => inRingsM(m, p.ringsM));
}

/** Why a parcel's development potential is low, in a few words, or undefined where it is not. */
export function lowReason(p: CapacityProperty, options: CapacityOptions): string | undefined {
  if (p.mark !== 'cross') return undefined;
  const o = p.override?.symbol;
  if (o === 'none' || o === 'mature') return p.override?.note ? `${o === 'mature' ? 'mature development' : 'low potential'} (${p.override.note})` : o === 'mature' ? 'mature development' : 'low potential, the author\'s reading';
  if (p.kind === 'council') return 'council land';
  if (p.kind === 'state') return 'State government land';
  if (p.kind === 'developing') return 'a current approval or construction';
  if (p.developed) return `mature development (${p.developed.detail})`;
  if (p.heritageItem) return `heritage item (${p.heritageItem})`;
  if (p.strata) return `strata scheme of ${p.units} lot${p.units === 1 ? '' : 's'}`;
  if (p.areaM2 < options.smallSite) return `a site of ${p.areaM2} m², under ${options.smallSite} m²`;
  return 'low potential';
}

// NSW government layers: cadastre (site lots, rail corridors) and ePlanning
// (zoning, height of building, heritage).

import { queryByExtent, queryByPoint, type GeoJSONFC, type GeoJSONFeature } from '../lib/arcgis.js';
import { lonLatToMercator, type Extent, type XY } from '../lib/geo.js';

const CADASTRE = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer';
const EPI = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer';

/**
 * The site's lots: every lot of each property an address point falls on.
 *
 * An address point sits on one lot, but a property is often several. 99-107
 * Riley Street, Darlinghurst is three lots under one address, its point on the
 * southern one; taking only the lot under the point left the other two out,
 * and an amalgamation of 91-93, 95-97, 99-107 and 109 fell into two pieces
 * with a gap where those two lots are. The cadastre's property layer gives
 * each property's outline and how many lots it dissolves from; the lots are
 * the ones whose inside lies within that outline. The cadastre has no join
 * from lot to property, and the server's own "within" test fails on edges the
 * two layers share, so a point inside each lot is tested here instead.
 *
 * A property of more lots or more ground than any one development site (a
 * campus, a rail corridor, a farm) keeps only the lot under the address.
 */
export async function fetchSiteLots(points: XY[]): Promise<GeoJSONFC> {
  const seen = new Set<string>();
  const features: GeoJSONFeature[] = [];
  const add = (f: GeoJSONFeature) => {
    const id = f.properties.lotidstring ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0]);
    if (seen.has(id)) return;
    seen.add(id);
    features.push(f);
  };
  const properties = new Map<string, GeoJSONFeature>();
  for (const p of points) {
    const [lots, props] = await Promise.all([
      queryByPoint(`${CADASTRE}/8`, p, 'lotidstring,plannumber'),
      // The lot under the point is enough to draw a site, so a failed property query costs only the rest of its lots.
      queryByPoint(`${CADASTRE}/12`, p, 'propid,address,dissolveparcelcount,valnetlotcount')
        .catch(() => ({ type: 'FeatureCollection', features: [] }) as GeoJSONFC),
    ]);
    for (const f of lots.features) add(f);
    for (const f of props.features) {
      if (!f.geometry) continue;
      properties.set(String(f.properties.propid ?? JSON.stringify(f.geometry.coordinates[0]?.[0])), f);
    }
  }
  for (const prop of properties.values()) {
    const rings: number[][][] = prop.geometry!.coordinates;
    const count = Math.max(Number(prop.properties.dissolveparcelcount) || 0, Number(prop.properties.valnetlotcount) || 0);
    if (count === 1) continue;                                    // the lot under the point is the property
    if (count > PROPERTY_MAX_LOTS || ringsAreaSqm(rings) > PROPERTY_MAX_SQM) continue;
    let candidates: GeoJSONFC;
    try { candidates = await queryByExtent(`${CADASTRE}/8`, ringsExtent(rings), 'lotidstring,plannumber'); }
    catch { continue; }
    for (const f of candidates.features) {
      if (f.geometry?.type !== 'Polygon') continue;
      const inside = interiorPoint(f.geometry.coordinates);
      if (inside && inRings(inside, rings)) add(f);
    }
  }
  return { type: 'FeatureCollection', features };
}

/** More lots or more ground than this, and a property is not taken whole as a site. */
const PROPERTY_MAX_LOTS = 40;
const PROPERTY_MAX_SQM = 50_000;

/** The Web Mercator box around lon/lat rings, as queryByExtent takes it. */
function ringsExtent(rings: number[][][]): Extent {
  const pts = rings.flat().map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  return {
    xmin: Math.min(...pts.map((p) => p.x)), ymin: Math.min(...pts.map((p) => p.y)),
    xmax: Math.max(...pts.map((p) => p.x)), ymax: Math.max(...pts.map((p) => p.y)),
  };
}

/** Ground area of lon/lat rings, holes taken out by the even-odd rule, in square metres. */
function ringsAreaSqm(rings: number[][][]): number {
  let total = 0;
  for (const ring of rings) {
    const lat0 = (ring[0]?.[1] ?? 0) * Math.PI / 180;
    const mx = 111_320 * Math.cos(lat0), my = 110_540;
    let s = 0;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      s += (ring[b][0] * mx + ring[a][0] * mx) * (ring[a][1] * my - ring[b][1] * my);
    }
    total += s / 2;
  }
  return Math.abs(total);
}

/** Is the point inside the rings, by the even-odd rule (so holes and separate parts both count right)? */
export function inRings([x, y]: number[], rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xa, ya] = ring[a], [xb, yb] = ring[b];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}

/**
 * A point well inside a polygon: the middle of the widest span a horizontal
 * line through it cuts, the line tried at mid-height first. A centroid can
 * fall outside an L-shaped lot; this cannot.
 */
export function interiorPoint(rings: number[][][]): [number, number] | null {
  const ys = rings.flat().map((c) => c[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (const t of [0.5, 0.37, 0.63, 0.25, 0.75]) {
    const y = y0 + (y1 - y0) * t;
    const xs: number[] = [];
    for (const ring of rings) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a], [xb, yb] = ring[b];
        if ((ya > y) !== (yb > y)) xs.push(((xb - xa) * (y - ya)) / (yb - ya) + xa);
      }
    }
    xs.sort((p, q) => p - q);
    let best: [number, number] | null = null, width = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > width) { width = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
    if (best) return best;
  }
  return null;
}

export const fetchRailCorridors = (extent: Extent) =>
  queryByExtent(`${CADASTRE}/7`, extent, 'cadid');

export const fetchZoning = (extent: Extent) =>
  queryByExtent(`${EPI}/2`, extent, 'SYM_CODE,LAY_CLASS,PURPOSE,EPI_NAME,LGA_NAME');

export const fetchHeightOfBuilding = (extent: Extent) =>
  queryByExtent(`${EPI}/5`, extent, 'MAX_B_H,UNITS,LAY_CLASS');

export const fetchFloorSpaceRatio = (extent: Extent) =>
  queryByExtent(`${EPI}/1`, extent, 'FSR');

export const fetchHeritage = (extent: Extent) =>
  queryByExtent(`${EPI}/0`, extent, 'LAY_CLASS,H_NAME,SIG');

/**
 * The planning controls that apply AT the site, for the development summary
 * table. Queried by point, not by extent: a sheet extent spans several zones,
 * but the summary must state the one that governs this lot.
 */
export interface SiteControls {
  epiName?: string;      // "Georges River Local Environmental Plan 2021"
  lgaName?: string;      // "GEORGES RIVER"
  zoneCode?: string;     // "R2"
  zonePurpose?: string;  // "Low Density Residential"
  maxHeightM?: number;   // MAX_B_H, metres — or an RL where heightUnits says so
  heightUnits?: string;  // "m", or "m(RL)" where the plan limits height by level (Parramatta CBD)
  fsr?: number;          // 0.55 -> printed as "0.55:1"
  minLotSizeSqm?: number;
  heritage: { name: string; significance?: string }[];
}

export async function fetchSiteControls(point: XY): Promise<SiteControls> {
  // One missing control must not cost the whole sheet, so each is independent.
  const at = async (layer: number, fields: string) => {
    try {
      const fc = await queryByPoint(`${EPI}/${layer}`, point, fields);
      return fc.features[0]?.properties ?? null;
    } catch { return null; }
  };

  const [zone, hob, fsr, lot, her] = await Promise.all([
    at(2, 'SYM_CODE,LAY_CLASS,PURPOSE,EPI_NAME,LGA_NAME'),
    at(5, 'MAX_B_H,UNITS'),
    at(1, 'FSR,EPI_NAME'),
    at(4, 'LOT_SIZE,UNITS'),
    (async () => {
      try {
        const fc = await queryByPoint(`${EPI}/0`, point, 'LAY_CLASS,H_NAME,SIG');
        return fc.features
          .map((f) => ({
            name: String(f.properties.H_NAME ?? f.properties.LAY_CLASS ?? '').trim(),
            significance: f.properties.SIG ? String(f.properties.SIG) : undefined,
          }))
          .filter((h) => h.name);
      } catch { return []; }
    })(),
  ]);

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    epiName: zone?.EPI_NAME ? String(zone.EPI_NAME) : undefined,
    lgaName: zone?.LGA_NAME ? String(zone.LGA_NAME) : undefined,
    zoneCode: zone?.SYM_CODE ? String(zone.SYM_CODE) : undefined,
    // PURPOSE is null throughout this layer; the readable zone name is
    // LAY_CLASS ("Low Density Residential").
    zonePurpose: String(zone?.LAY_CLASS ?? zone?.PURPOSE ?? '').trim() || undefined,
    maxHeightM: num(hob?.MAX_B_H),
    heightUnits: hob?.UNITS ? String(hob.UNITS) : undefined,
    fsr: num(fsr?.FSR),
    minLotSizeSqm: num(lot?.LOT_SIZE),
    heritage: her as { name: string; significance?: string }[],
  };
}

// NSW government layers: cadastre (site lots, rail corridors) and ePlanning
// (zoning, height of building, heritage).

import { queryByExtent, queryByPoint, type GeoJSONFC } from '../lib/arcgis.js';
import type { Extent, XY } from '../lib/geo.js';

const CADASTRE = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer';
const EPI = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer';

export async function fetchSiteLots(points: XY[]): Promise<GeoJSONFC> {
  const seen = new Set<string>();
  const features = [];
  for (const p of points) {
    const fc = await queryByPoint(`${CADASTRE}/8`, p, 'lotidstring,plannumber');
    for (const f of fc.features) {
      const id = f.properties.lotidstring ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0]);
      if (seen.has(id)) continue;
      seen.add(id);
      features.push(f);
    }
  }
  return { type: 'FeatureCollection', features };
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

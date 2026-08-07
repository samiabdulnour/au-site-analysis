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

export const fetchHeritage = (extent: Extent) =>
  queryByExtent(`${EPI}/0`, extent, 'LAY_CLASS,H_NAME,SIG');

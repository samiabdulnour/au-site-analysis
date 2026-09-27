// Minimal ArcGIS REST query client. Uses f=json (Esri JSON) because some NSW
// servers 503 on f=geojson, and converts to GeoJSON-shaped features locally.
// All queries request outSR=4326 so coordinates are lon/lat.

import type { Extent, XY } from './geo.js';
import { retryFetch } from './http.js';

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: any } | null;
  properties: Record<string, any>;
}
export interface GeoJSONFC { type: 'FeatureCollection'; features: GeoJSONFeature[] }

async function getJson(url: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await retryFetch(`${url}?${qs}`, {}, {
    attempts: 5, timeoutMs: 60_000, label: url,
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${url} -> ${JSON.stringify(data.error)}`);
  return data;
}

function esriToGeoJson(data: any): GeoJSONFC {
  const features: GeoJSONFeature[] = [];
  for (const f of data.features ?? []) {
    let geometry: GeoJSONFeature['geometry'] = null;
    const g = f.geometry;
    if (g) {
      if (g.rings) geometry = { type: 'Polygon', coordinates: g.rings };
      else if (g.paths) geometry = { type: 'MultiLineString', coordinates: g.paths };
      else if (g.x !== undefined) geometry = { type: 'Point', coordinates: [g.x, g.y] };
    }
    features.push({ type: 'Feature', geometry, properties: f.attributes ?? {} });
  }
  return { type: 'FeatureCollection', features };
}

const BASE_PARAMS = { f: 'json', outSR: '4326' };

export async function queryByExtent(
  layerUrl: string,
  extent: Extent,
  outFields = '*',
  where = '1=1',
  /** Further query parameters, e.g. maxAllowableOffset to generalise geometry. */
  extra: Record<string, string> = {},
): Promise<GeoJSONFC> {
  const features: GeoJSONFeature[] = [];
  let offset = 0;
  for (;;) {
    const data = await getJson(`${layerUrl}/query`, {
      ...BASE_PARAMS,
      where,
      geometry: JSON.stringify({ ...extent, spatialReference: { wkid: 3857 } }),
      geometryType: 'esriGeometryEnvelope',
      inSR: '3857',
      spatialRel: 'esriSpatialRelIntersects',
      outFields,
      resultOffset: String(offset),
      ...extra,
    });
    const fc = esriToGeoJson(data);
    features.push(...fc.features);
    if (!data.exceededTransferLimit || !fc.features.length) break;
    offset += fc.features.length;
    if (offset > 20_000) break; // safety valve
  }
  return { type: 'FeatureCollection', features };
}

export async function queryByPoint(
  layerUrl: string,
  point: XY,
  outFields = '*',
): Promise<GeoJSONFC> {
  const data = await getJson(`${layerUrl}/query`, {
    ...BASE_PARAMS,
    where: '1=1',
    geometry: JSON.stringify({ x: point.x, y: point.y, spatialReference: { wkid: 3857 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '3857',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
  });
  return esriToGeoJson(data);
}

export async function queryByGeometry(
  layerUrl: string,
  geometry: object,
  geometryType: string,
  outFields = '*',
): Promise<GeoJSONFC> {
  const data = await getJson(`${layerUrl}/query`, {
    ...BASE_PARAMS,
    where: '1=1',
    geometry: JSON.stringify(geometry),
    geometryType,
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
  });
  return esriToGeoJson(data);
}

export async function queryWhere(
  layerUrl: string,
  where: string,
  outFields = '*',
  resultRecordCount?: number,
): Promise<GeoJSONFC> {
  const params: Record<string, string> = { ...BASE_PARAMS, where, outFields };
  if (resultRecordCount) params.resultRecordCount = String(resultRecordCount);
  return esriToGeoJson(await getJson(`${layerUrl}/query`, params));
}

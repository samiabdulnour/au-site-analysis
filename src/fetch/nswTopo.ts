// NSW topographic/POI layers — roads with names, railways, stations, parks,
// named building complexes — plus cadastral property polygons for coloring
// institutions. These replace OSM for everything except bus stops/routes.

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import type { Extent } from '../lib/geo.js';

const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const TRANSPORT = `${PORTAL}/NSW_Transport_Theme/FeatureServer`;
const FOI = `${PORTAL}/NSW_Features_of_Interest_Category/FeatureServer`;
const FOI_TRANSPORT = `${PORTAL}/NSW_FOI_Transport_Facilities/FeatureServer`;
const CADASTRE = `${PORTAL}/NSW_Land_Parcel_Property_Theme/FeatureServer`;

export interface TopoRoad { name: string; hierarchy: number; coords: [number, number][] }
export interface NamedPoint { name: string; lon: number; lat: number }

function lineCoords(fc: GeoJSONFC): { paths: [number, number][][]; props: Record<string, any>[] } {
  const paths: [number, number][][] = [];
  const props: Record<string, any>[] = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const many = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const p of many) { paths.push(p); props.push(f.properties); }
  }
  return { paths, props };
}

export async function fetchRoads(extent: Extent): Promise<TopoRoad[]> {
  const fc = await queryByExtent(`${TRANSPORT}/5`, extent,
    'roadnamebase,roadnametype,functionhierarchy', 'roadnamebase IS NOT NULL');
  const { paths, props } = lineCoords(fc);
  return paths.map((coords, i) => ({
    name: [props[i].roadnamebase, props[i].roadnametype].filter(Boolean).join(' '),
    hierarchy: props[i].functionhierarchy ?? 6,
    coords,
  }));
}

export interface RailLines { train: [number, number][][]; tram: [number, number][][] }

/** Railway centrelines split into heavy rail vs light rail/tram (classsubtype 2). */
export async function fetchRailLines(extent: Extent): Promise<RailLines> {
  const fc = await queryByExtent(`${TRANSPORT}/7`, extent, 'railwayname,classsubtype');
  const { paths, props } = lineCoords(fc);
  const out: RailLines = { train: [], tram: [] };
  paths.forEach((p, i) => (props[i].classsubtype === 2 ? out.tram : out.train).push(p));
  return out;
}

export interface NamedArea { name: string; lon: number; lat: number; areaM2: number }

/** Named cultural areas (parks, reserves, ovals…) with centroids for labeling. */
export async function fetchNamedAreas(extent: Extent): Promise<NamedArea[]> {
  const fc = await queryByExtent(`${FOI}/9`, extent, 'generalname,generalculturaltype',
    'generalname IS NOT NULL');
  const out: NamedArea[] = [];
  for (const f of fc.features) {
    if (!f.geometry || !f.properties.generalname) continue;
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    if (!rings.length || rings[0].length < 3) continue;
    let best = rings[0], bestA = 0;
    for (const r of rings) {
      const a = Math.abs(ringAreaDeg(r));
      if (a > bestA) { bestA = a; best = r; }
    }
    const [lon, lat] = ringCentroidLocal(best);
    // deg² -> m² rough conversion at Sydney latitudes
    out.push({ name: f.properties.generalname, lon, lat, areaM2: bestA * 111_320 * 92_400 });
  }
  return out;
}

function ringAreaDeg(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++)
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

function ringCentroidLocal(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

function namedPoints(fc: GeoJSONFC): NamedPoint[] {
  return fc.features
    .filter((f) => f.geometry?.type === 'Point' && f.properties.generalname)
    .map((f) => ({
      name: f.properties.generalname as string,
      lon: f.geometry!.coordinates[0],
      lat: f.geometry!.coordinates[1],
    }));
}

export async function fetchTrainStations(extent: Extent): Promise<NamedPoint[]> {
  const fc = await queryByExtent(`${FOI_TRANSPORT}/1`, extent, 'generalname');
  return namedPoints(fc);
}

/** Parks, reserves, ovals, gardens — labels for the open-space zoning fills. */
export async function fetchParkPoints(extent: Extent): Promise<NamedPoint[]> {
  const fc = await queryByExtent(`${FOI}/2`, extent, 'generalname,generalculturaltype',
    'generalname IS NOT NULL');
  return namedPoints(fc);
}

/** Named building complexes: schools, hospitals, churches, civic, retail… */
export async function fetchComplexPoints(extent: Extent): Promise<NamedPoint[]> {
  const fc = await queryByExtent(`${FOI}/3`, extent, 'generalname,buildingcomplextype',
    'generalname IS NOT NULL');
  return namedPoints(fc);
}

/** All lot boundaries in the extent — drawn as a thin cadastral overlay. */
export async function fetchAllLots(extent: Extent): Promise<GeoJSONFC> {
  return queryByExtent(`${CADASTRE}/8`, extent, 'objectid');
}

/** Property polygons containing the given points (one multipoint query). */
export async function fetchPropertiesAt(points: { lon: number; lat: number }[]): Promise<GeoJSONFC> {
  if (!points.length) return { type: 'FeatureCollection', features: [] };
  const { queryByGeometry } = await import('../lib/arcgis.js');
  return queryByGeometry(`${CADASTRE}/12`, {
    points: points.map((p) => [p.lon, p.lat]),
    spatialReference: { wkid: 4326 },
  }, 'esriGeometryMultipoint', 'propid');
}

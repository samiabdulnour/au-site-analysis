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

export async function fetchRailLines(extent: Extent): Promise<[number, number][][]> {
  const fc = await queryByExtent(`${TRANSPORT}/7`, extent, 'railwayname');
  return lineCoords(fc).paths;
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

/** Property polygons containing the given points (one multipoint query). */
export async function fetchPropertiesAt(points: { lon: number; lat: number }[]): Promise<GeoJSONFC> {
  if (!points.length) return { type: 'FeatureCollection', features: [] };
  const { queryByGeometry } = await import('../lib/arcgis.js');
  return queryByGeometry(`${CADASTRE}/12`, {
    points: points.map((p) => [p.lon, p.lat]),
    spatialReference: { wkid: 4326 },
  }, 'esriGeometryMultipoint', 'propid');
}

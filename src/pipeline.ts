// Orchestrates all fetches for one address and saves the data bundle.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geocode, type GeocodeResult } from './fetch/geocode.js';
import { fetchSiteLots, fetchRailCorridors, fetchZoning, fetchHeightOfBuilding, fetchHeritage } from './fetch/nsw.js';
import { fetchRoads, fetchRailLines, fetchTrainStations, fetchParkPoints, fetchComplexPoints, fetchPropertiesAt, type TopoRoad, type NamedPoint } from './fetch/nswTopo.js';
import { fetchAerial, type AerialResult } from './fetch/imagery.js';
import { fetchBusData, type BusData } from './fetch/osm.js';
import { fetchBusStopsTfnsw } from './fetch/tfnsw.js';
import { fetchIsochrones, type Isochrone } from './fetch/isochrones.js';
import { sheetExtent, mercatorToLonLat, type Extent } from './lib/geo.js';
import type { GeoJSONFC } from './lib/arcgis.js';
import { keywordCategory } from './render/model.js';

export interface CategorizedPoint extends NamedPoint { cat: string | null }
export interface InstitutionPoly { cat: string; rings: number[][][] }

export interface Bundle {
  address: string;
  geocode: GeocodeResult;
  extent: Extent;
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  siteLots: GeoJSONFC;
  railCorridors: GeoJSONFC;
  zoning: GeoJSONFC;
  hob: GeoJSONFC;
  heritage: GeoJSONFC;
  roads: TopoRoad[];
  railLines: [number, number][][];
  stations: NamedPoint[];
  parkPoints: NamedPoint[];
  complexPoints: CategorizedPoint[];
  institutionPolys: InstitutionPoly[];
  bus: BusData;
  isochrones: Isochrone[];
  aerial: AerialResult;
  generatedAt: string;
}

export interface PipelineOpts {
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  outDir: string;
  aerialPxWidth?: number;
  log?: (msg: string) => void;
}

export async function runPipeline(address: string, opts: PipelineOpts): Promise<Bundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);

  const extent = sheetExtent(geo.center, opts.mapWidthMm, opts.mapHeightMm, opts.scale);
  const centerLL = mercatorToLonLat(geo.center);

  log('fetching site lots, planning layers, topo, imagery, bus data, isochrones…');
  const emptyFC: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const soft = <T>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  const [siteLots, railCorridors, zoning, hob, heritage, roads, railLines, stations, parkPoints, rawComplex, bus, isochrones, aerial] =
    await Promise.all([
      fetchSiteLots(geo.points),
      soft(fetchRailCorridors(extent), emptyFC, 'rail corridors'),
      fetchZoning(extent),
      soft(fetchHeightOfBuilding(extent), emptyFC, 'height of building'),
      soft(fetchHeritage(extent), emptyFC, 'heritage'),
      fetchRoads(extent),
      soft(fetchRailLines(extent), [], 'rail lines'),
      soft(fetchTrainStations(extent), [], 'train stations'),
      soft(fetchParkPoints(extent), [], 'park points'),
      soft(fetchComplexPoints(extent), [], 'complex points'),
      soft(fetchBusData(extent), { busStops: [], busRouteSegments: [] }, 'bus route lines (OSM)'),
      soft(fetchIsochrones(centerLL), [], 'isochrones'),
      fetchAerial(extent, opts.aerialPxWidth ?? 3200, dataDir),
    ]);

  // Bus stops: TfNSW when a key is configured (authoritative), else the OSM
  // stops that came with the route query.
  const tfnswKey = process.env.TFNSW_API_KEY;
  if (tfnswKey) {
    const stops = await soft(fetchBusStopsTfnsw(extent, tfnswKey), null, 'bus stops (TfNSW)');
    if (stops) bus.busStops = stops;
    log(`  bus stops from TfNSW: ${bus.busStops.length}`);
  }

  const complexPoints: CategorizedPoint[] = rawComplex.map((p) => ({ ...p, cat: keywordCategory(p.name) }));

  // Color the property parcels of categorized institutions (schools blue, etc.)
  const fillable = complexPoints.filter((p) => p.cat && p.cat !== 'community');
  const props = await soft(fetchPropertiesAt(fillable), emptyFC, 'institution properties');
  // A multipoint query loses which point matched which polygon — recover by
  // point-in-polygon so each parcel takes its institution's category.
  const institutionPolys: InstitutionPoly[] = [];
  for (const f of props.features) {
    if (!f.geometry) continue;
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat();
    const hit = fillable.find((p) => rings.some((r: number[][]) => pointInRing(p.lon, p.lat, r)));
    if (hit?.cat) institutionPolys.push({ cat: hit.cat, rings });
  }

  log(`  lots:${siteLots.features.length} zoning:${zoning.features.length} roads:${roads.length} ` +
      `stations:${stations.length} parks:${parkPoints.length} complexes:${complexPoints.length} ` +
      `instPolys:${institutionPolys.length} busStops:${bus.busStops.length} isochrones:${isochrones.length}`);

  const bundle: Bundle = {
    address,
    geocode: geo,
    extent,
    scale: opts.scale,
    mapWidthMm: opts.mapWidthMm,
    mapHeightMm: opts.mapHeightMm,
    siteLots,
    railCorridors,
    zoning,
    hob,
    heritage,
    roads,
    railLines,
    stations,
    parkPoints,
    complexPoints,
    institutionPolys,
    bus,
    isochrones,
    aerial,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dataDir, 'bundle.json'), JSON.stringify(bundle));
  return bundle;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

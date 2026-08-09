// Orchestrates all fetches for one address and saves the data bundle.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geocode, type GeocodeResult } from './fetch/geocode.js';
import { fetchSiteLots, fetchRailCorridors, fetchZoning, fetchHeightOfBuilding, fetchHeritage } from './fetch/nsw.js';
import { fetchRoads, fetchRailLines, fetchTrainStations, fetchParkPoints, fetchComplexPoints, fetchNamedAreas, fetchAllLots, fetchPropertiesAt, type TopoRoad, type NamedPoint, type RailLines, type NamedArea } from './fetch/nswTopo.js';
import { fetchAerial, type AerialResult } from './fetch/imagery.js';
import { fetchBusData, type BusData } from './fetch/osm.js';
import { fetchBusStopsTfnsw } from './fetch/tfnsw.js';
import { fetchIsochrones, type Isochrone } from './fetch/isochrones.js';
import { mercatorScaleFactor, mercatorToLonLat, lonLatToMercator, viewBounds, type Extent, type MapView } from './lib/geo.js';
import type { GeoJSONFC } from './lib/arcgis.js';
import { keywordCategory } from './render/model.js';

export interface CategorizedPoint extends NamedPoint { cat: string | null }
export interface InstitutionPoly { cat: string; name: string; rings: number[][][] }

export interface Bundle {
  address: string;
  geocode: GeocodeResult;
  extent: Extent;      // axis-aligned fetch bounds (covers the rotated view)
  view: MapView;       // the (possibly rotated) map window
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  siteLots: GeoJSONFC;
  allLots: GeoJSONFC;
  railCorridors: GeoJSONFC;
  zoning: GeoJSONFC;
  hob: GeoJSONFC;
  heritage: GeoJSONFC;
  roads: TopoRoad[];
  railLines: RailLines;
  stations: NamedPoint[];
  parkPoints: NamedPoint[];
  parkAreas: NamedArea[];
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
  /** 'north' = north up (default); 'auto' = rotate so the site's longest
   *  boundary edge runs horizontally (better fit for elongated sites). */
  rotate?: 'north' | 'auto';
  aerialPxWidth?: number;
  log?: (msg: string) => void;
}

/** Angle (deg, mercator CCW-from-east) of the longest outer-ring edge of the
 *  site lots, snapped into (-45, 45] so the map never turns on its head. */
function siteLongEdgeDeg(siteLots: GeoJSONFC): number {
  let best = 0, bestLen = 0;
  for (const f of siteLots.features) {
    const rings = f.geometry?.type === 'Polygon' ? f.geometry.coordinates
      : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const a = lonLatToMercator({ lon: ring[i - 1][0], lat: ring[i - 1][1] });
        const b = lonLatToMercator({ lon: ring[i][0], lat: ring[i][1] });
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > bestLen) { bestLen = len; best = Math.atan2(b.y - a.y, b.x - a.x); }
      }
    }
  }
  let deg = (best * 180) / Math.PI;
  while (deg > 45) deg -= 90;
  while (deg <= -45) deg += 90;
  return deg;
}

export async function runPipeline(address: string, opts: PipelineOpts): Promise<Bundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);

  // Site lots come first: the rotation option needs the boundary geometry.
  const siteLots = await fetchSiteLots(geo.points);
  let rotationDeg = 0;
  if (opts.rotate === 'auto' && siteLots.features.length) {
    rotationDeg = siteLongEdgeDeg(siteLots);
    if (Math.abs(rotationDeg) < 3) rotationDeg = 0; // effectively north-up
    log(`  map rotation: ${rotationDeg.toFixed(1)}° (longest site edge horizontal)`);
  }
  const lat = mercatorToLonLat(geo.center).lat;
  const k = mercatorScaleFactor(lat);
  const view: MapView = {
    cx: geo.center.x,
    cy: geo.center.y,
    halfW: ((opts.mapWidthMm / 1000) * opts.scale * k) / 2,
    halfH: ((opts.mapHeightMm / 1000) * opts.scale * k) / 2,
    rotationDeg,
  };
  const extent = viewBounds(view);
  const centerLL = mercatorToLonLat(geo.center);

  log('fetching site lots, planning layers, topo, imagery, bus data, isochrones…');
  const emptyFC: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const soft = <T>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  const emptyBus: BusData = { busStops: [], busRouteSegments: [], tramStops: [], tramRouteSegments: [] };
  const [railCorridors, allLots, zoning, hob, heritage, roads, railLines, stations, parkPoints, parkAreas, rawComplex, bus, isochrones, aerial] =
    await Promise.all([
      soft(fetchRailCorridors(extent), emptyFC, 'rail corridors'),
      soft(fetchAllLots(extent), emptyFC, 'cadastral lots'),
      fetchZoning(extent),
      soft(fetchHeightOfBuilding(extent), emptyFC, 'height of building'),
      soft(fetchHeritage(extent), emptyFC, 'heritage'),
      fetchRoads(extent),
      soft(fetchRailLines(extent), { train: [], tram: [] }, 'rail lines'),
      soft(fetchTrainStations(extent), [], 'train stations'),
      soft(fetchParkPoints(extent), [], 'park points'),
      soft(fetchNamedAreas(extent), [], 'named areas'),
      soft(fetchComplexPoints(extent), [], 'complex points'),
      soft(fetchBusData(extent), emptyBus, 'bus/tram data (OSM)'),
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
    if (hit?.cat) institutionPolys.push({ cat: hit.cat, name: hit.name, rings });
  }

  log(`  lots:${siteLots.features.length} zoning:${zoning.features.length} roads:${roads.length} ` +
      `stations:${stations.length} parks:${parkPoints.length} complexes:${complexPoints.length} ` +
      `instPolys:${institutionPolys.length} busStops:${bus.busStops.length} isochrones:${isochrones.length}`);

  const bundle: Bundle = {
    address,
    geocode: geo,
    extent,
    view,
    scale: opts.scale,
    mapWidthMm: opts.mapWidthMm,
    mapHeightMm: opts.mapHeightMm,
    siteLots,
    allLots,
    railCorridors,
    zoning,
    hob,
    heritage,
    roads,
    railLines,
    stations,
    parkPoints,
    parkAreas,
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

// ---------------------------------------------------------------------------
// SITE ANALYSIS pipeline: a site-scale bundle (~1:200-1:500) with the site
// outline (lots unioned), contours for levels, neighbours and street
// furniture. Shares the geocode/lots/rotation logic with the context sheet.

import { fetchContours, fetchNeighbourAddresses, fetchSiteFurniture, type ContourLine, type NeighbourAddress, type SiteFurniture } from './fetch/siteData.js';
import turfUnion from '@turf/union';
import { featureCollection } from '@turf/helpers';

export interface SiteBundle {
  address: string;
  geocode: GeocodeResult;
  extent: Extent;
  view: MapView;
  scale: number;
  siteLots: GeoJSONFC;
  siteRing: [number, number][];   // outer boundary of the unioned site, lonlat
  allLots: GeoJSONFC;
  roads: TopoRoad[];
  railLines: RailLines;
  contours: ContourLine[];
  neighbours: NeighbourAddress[];
  furniture: SiteFurniture;
  busStops: { name?: string; lon: number; lat: number }[];
  aerial: AerialResult;
  generatedAt: string;
}

export interface SitePipelineOpts {
  mapWidthMm: number;
  mapHeightMm: number;
  outDir: string;
  scale?: number;                 // omit for auto (fit site + margin)
  rotate?: 'north' | 'auto';
  log?: (msg: string) => void;
}

const SITE_SCALES = [200, 250, 300, 400, 500, 600, 750];

export async function runSitePipeline(address: string, opts: SitePipelineOpts): Promise<SiteBundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);
  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');

  // union of lots -> single outer boundary
  const polys = siteLots.features.filter((f) => f.geometry);
  let ring: [number, number][];
  if (polys.length === 1) {
    ring = geomOuter(polys[0].geometry);
  } else {
    const merged = turfUnion(featureCollection(polys as any)) as any;
    ring = geomOuter(merged?.geometry ?? polys[0].geometry);
  }

  // rotation from the union's longest edge
  let rotationDeg = 0;
  if (opts.rotate === 'auto') {
    rotationDeg = siteLongEdgeDeg({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] });
    if (Math.abs(rotationDeg) < 3) rotationDeg = 0;
  }

  // center on the site's bbox center; auto-scale to fit with margin
  const ringM = ring.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const r = (-rotationDeg * Math.PI) / 180;
  const cosr = Math.cos(r), sinr = Math.sin(r);
  const cx0 = ringM.reduce((s, p) => s + p.x, 0) / ringM.length;
  const cy0 = ringM.reduce((s, p) => s + p.y, 0) / ringM.length;
  let ux0 = 1e15, ux1 = -1e15, uy0 = 1e15, uy1 = -1e15;
  for (const p of ringM) {
    const u = (p.x - cx0) * cosr - (p.y - cy0) * sinr;
    const v = (p.x - cx0) * sinr + (p.y - cy0) * cosr;
    ux0 = Math.min(ux0, u); ux1 = Math.max(ux1, u);
    uy0 = Math.min(uy0, v); uy1 = Math.max(uy1, v);
  }
  const lat = mercatorToLonLat({ x: cx0, y: cy0 }).lat;
  const k = mercatorScaleFactor(lat);
  const marginM = 55 * k; // ground margin around the site, in mercator meters
  let scale = opts.scale ?? 0;
  if (!scale) {
    for (const s of SITE_SCALES) {
      const halfW = ((opts.mapWidthMm / 1000) * s * k) / 2;
      const halfH = ((opts.mapHeightMm / 1000) * s * k) / 2;
      if ((ux1 - ux0) / 2 + marginM <= halfW && (uy1 - uy0) / 2 + marginM <= halfH) { scale = s; break; }
    }
    if (!scale) scale = SITE_SCALES[SITE_SCALES.length - 1];
  }
  log(`  site sheet scale 1:${scale}${rotationDeg ? `, rotation ${rotationDeg.toFixed(1)}°` : ''}`);

  const view: MapView = {
    cx: cx0, cy: cy0,
    halfW: ((opts.mapWidthMm / 1000) * scale * k) / 2,
    halfH: ((opts.mapHeightMm / 1000) * scale * k) / 2,
    rotationDeg,
  };
  const extent = viewBounds(view);

  const emptyFurniture: SiteFurniture = { trees: [], hydrants: [], powerPoles: [], streetLamps: [], onewayRoads: [] };
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  log('fetching contours, lots, roads, neighbours, furniture, imagery…');
  const [contours, allLots, roads, railLines, neighbours, furniture, aerial] = await Promise.all([
    soft(fetchContours(extent), [], 'contours'),
    soft(fetchAllLots(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'lots'),
    soft(fetchRoads(extent), [], 'roads'),
    soft(fetchRailLines(extent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchNeighbourAddresses(extent), [], 'neighbour addresses'),
    soft(fetchSiteFurniture(extent), emptyFurniture, 'street furniture (OSM)'),
    fetchAerial(extent, 3600, dataDir),
  ]);

  let busStops: { name?: string; lon: number; lat: number }[] = [];
  if (process.env.TFNSW_API_KEY) {
    busStops = await soft(fetchBusStopsTfnsw(extent, process.env.TFNSW_API_KEY), [], 'bus stops (TfNSW)');
  }

  log(`  contours:${contours.length} lots:${allLots.features.length} roads:${roads.length} ` +
      `neighbours:${neighbours.length} trees:${furniture.trees.length} busStops:${busStops.length}`);

  const bundle: SiteBundle = {
    address, geocode: geo, extent, view, scale,
    siteLots, siteRing: ring, allLots, roads, railLines, contours, neighbours, furniture,
    busStops, aerial, generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dataDir, 'site_bundle.json'), JSON.stringify(bundle));
  return bundle;
}

function geomOuter(geometry: any): [number, number][] {
  if (geometry.type === 'Polygon') return geometry.coordinates[0];
  if (geometry.type === 'MultiPolygon') {
    let best: [number, number][] = geometry.coordinates[0][0];
    let bestN = 0;
    for (const poly of geometry.coordinates) {
      if (poly[0].length > bestN) { bestN = poly[0].length; best = poly[0]; }
    }
    return best;
  }
  throw new Error(`unexpected site geometry: ${geometry.type}`);
}

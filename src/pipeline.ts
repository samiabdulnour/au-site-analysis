// Orchestrates all fetches for one address and saves the data bundle.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geocode, type GeocodeResult } from './fetch/geocode.js';
import { fetchSiteLots, fetchRailCorridors, fetchZoning, fetchHeightOfBuilding, fetchFloorSpaceRatio, fetchHeritage, fetchSiteControls } from './fetch/nsw.js';
import { fetchRoads, fetchRailLines, fetchTrainStations, fetchParkPoints, fetchComplexPoints, fetchNamedAreas, fetchAllLots, fetchPropertiesAt, fetchProperties, type TopoRoad, type NamedPoint, type RailLines, type NamedArea } from './fetch/nswTopo.js';
import { fetchAerial, fetchVegetationMask, type AerialResult } from './fetch/imagery.js';
import { addressStreet, fetchStreetSeries } from './fetch/streetView.js';
import { planStreetscape, planPoint, fetchStreetscapeFrames, FRAME_PX, type StreetscapePlan, type ScapeFrame, type Face } from './fetch/streetscape.js';
import { fetchStreetTiles, enuFrame } from './fetch/tiles3d.js';
import { renderElevations, SCAPE_SKY, type Elevation, type FaceView } from './render/elevation3d.js';
import { fetchBusData, type BusData } from './fetch/osm.js';
import { fetchBusStopsTfnsw } from './fetch/tfnsw.js';
import { fetchIsochrones, type Isochrone } from './fetch/isochrones.js';
import { mercatorScaleFactor, mercatorToLonLat, lonLatToMercator, viewBounds, type Extent, type LonLat, type MapView } from './lib/geo.js';
import { queryByPoint, queryByExtent, type GeoJSONFC } from './lib/arcgis.js';
import { keywordCategory } from './render/model.js';
import { setTemplate } from './render/template.js';
import type { SummaryBundle } from './render/summarySheet.js';
import type { YieldBundle } from './render/yieldSheet.js';
import { CENTRES } from './data/centres.js';
import { levelAt, type ContourM } from './lib/levels.js';
import { futureHeight, ringArea, type ExistingBuilding, type FutureControls } from './lib/yield.js';
import {
  fetchZoningDetailed, fetchHobDetailed, fetchHeritageDetailed, fetchShrCurtilages, fetchPolicyAreas, isRealPolicyArea,
  fetchWaterAreas, fetchPlanningContext, fetchPropertyReport, fetchHousingTarget,
  type PolicyArea, type PlanningContext, type PropertyReport, type HousingTarget,
} from './fetch/planning.js';
import { panelExtent, type Panel, type BaseData } from './render/minimap.js';
import { fetchCityOfSydneyDcp, type CityOfSydneyDcp } from './fetch/cityOfSydney.js';
import { fetchCouncilApplications, apiCouncilName, clipToExtent, PORTAL_MANDATED, type DaRecord } from './fetch/da.js';
import { fetchPlanningProposals, type PlanningProposal } from './fetch/planning.js';
import { fetchPeopleData, type PeopleData } from './fetch/people.js';
import { fetchDemGrid, demAt, type DemGrid } from './fetch/terrain.js';
import { fetchBuildings, withDaStoreys, METRES_PER_STOREY, type BuildingsData } from './fetch/buildings.js';
import { fetchFootways, type FootwaysData } from './fetch/footways.js';
import { fetchMajorProjects, emptyMajorProjects, type MajorProjectsData } from './fetch/majorProjects.js';
import { fetchWind, emptyWind, type WindData } from './fetch/wind.js';
import { fetchMovement, type MovementData } from './fetch/movement.js';
import { fetchGreenSpace, type GreenData } from './fetch/greenSpace.js';
import { fetchConstraints, checkLepCoverage, type ConstraintsData } from './fetch/constraints.js';
import { fetchSiteData, type SiteData } from './fetch/site.js';
import type { SiteControls } from './fetch/nsw.js';

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
  /** Building footprints across the window, drawn as the grain inside the blocks. */
  buildings: BuildingsData;
  generatedAt: string;
}

export interface PipelineOpts {
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  outDir: string;
  /** 'north' = north up (default); 'auto' = rotate so the site lies with its
   *  long side horizontal (its bounding rectangle's long axis along the sheet). */
  rotate?: 'north' | 'auto';
  aerialPxWidth?: number;
  log?: (msg: string) => void;
}

/** Angle (deg, mercator CCW-from-east) of the longest outer-ring edge of the
 *  site lots, snapped into (-45, 45] so the map never turns on its head. */
/**
 * The turn that lays the site with its long side horizontal: the long axis
 * of the site's minimum-area bounding rectangle, as an angle in (-90°, 90°].
 * The rectangle is tried along every boundary edge (the minimum one always
 * lies along an edge of the hull, and so of the boundary), so an irregular or
 * multi-lot site still reads by its overall shape, not by one long edge. The
 * sheet is landscape, so the long side lying along it also fits it best.
 */
export function siteLongEdgeDeg(siteLots: GeoJSONFC): number {
  const pts: { x: number; y: number }[] = [];
  const edges: number[] = [];
  for (const f of siteLots.features) {
    const rings = f.geometry?.type === 'Polygon' ? f.geometry.coordinates
      : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
    for (const ring of rings) {
      const m = ring.map(([lon, lat]: number[]) => lonLatToMercator({ lon, lat }));
      pts.push(...m);
      for (let i = 1; i < m.length; i++)
        if (Math.hypot(m[i].x - m[i - 1].x, m[i].y - m[i - 1].y) > 0.01) edges.push(Math.atan2(m[i].y - m[i - 1].y, m[i].x - m[i - 1].x));
    }
  }
  if (pts.length < 3 || !edges.length) return 0;
  let bestArea = Infinity, axis = 0;
  for (const t of edges) {
    const c = Math.cos(t), s = Math.sin(t);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const { x, y } of pts) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-6) { bestArea = area; axis = u1 - u0 >= v1 - v0 ? t : t + Math.PI / 2; }
  }
  // An axis has no direction: fold it into (-90°, 90°].
  let deg = (axis * 180) / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg <= -90) deg += 180;
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
  const noBuildings: BuildingsData = { source: 'none', buildings: [], fetchedAt: new Date().toISOString() };
  const [railCorridors, allLots, zoning, hob, heritage, roads, railLines, stations, parkPoints, parkAreas, rawComplex, bus, isochrones, aerial, buildings] =
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
      soft(fetchBuildings(extent, log), noBuildings, 'buildings'),
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
      `instPolys:${institutionPolys.length} busStops:${bus.busStops.length} isochrones:${isochrones.length} buildings:${buildings.buildings.length}/${buildings.source}`);

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
    buildings,
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
// SITE ANALYSIS pipeline: a site-scale bundle (~1:200-1:1000) with the site
// outline (lots unioned), contours for levels, neighbours and street
// furniture. Shares the geocode/lots/rotation logic with the context sheet.

import { fetchContours, fetchNeighbourAddresses, fetchSiteFurniture, emptyFurniture, type ContourLine, type ContourSet, type NeighbourAddress, type SiteFurniture } from './fetch/siteData.js';
import { fetchCouncilTrees, mergeTrees, TREE_SOURCES } from './fetch/trees.js';
import { fetchServices, emptyServices, type ServicesData } from './fetch/services.js';
import { assessViews, eyeAboveGround, type ViewTarget } from './fetch/views.js';
import { fetchCountry, EMPTY_COUNTRY, type CountryData } from './fetch/country.js';
import { fetchPhotos, emptyPhotos, type PhotosData } from './fetch/photos.js';
import { fetchLocation, emptyLocation, type LocationData } from './fetch/location.js';
import { fetchCharacter, emptyCharacter, type CharacterData } from './fetch/character.js';
import { fetchStrategies, emptyStrategies, type StrategiesData } from './fetch/strategies.js';
import { buildParkingBands, type ParkingBand } from './lib/parking.js';
import { estimateKerbs, type KerbLine } from './lib/kerbs.js';
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
  zoning: GeoJSONFC;
  /** The LEP's height of building map over the sheet, for the neighbours' boxes (older bundles: none). */
  heights?: GeoJSONFC;
  /** The LEP's heritage items and conservation areas over the sheet (older bundles: none). */
  heritage?: GeoJSONFC;
  /** The services an open licence lets the sheet draw (fetch/services.ts; older bundles: none). */
  services?: ServicesData;
  /** OpenStreetMap's sidewalks from Overture, which set the kerb lines' footpath width (fetch/footways.ts; older bundles: none). */
  footways?: FootwaysData;
  contours: ContourLine[];
  /** Interval and origin of the contours drawn (older bundles: 2 m, NSW). */
  contourIntervalM?: number;
  contourSource?: string;
  neighbours: NeighbourAddress[];
  furniture: SiteFurniture;
  /** Kerbside bays set out from the tagged runs and the cadastre. */
  parkingBands?: ParkingBand[];
  /** Indicative kerb lines (lib/kerbs.ts), for the sheet and the CAD export (older bundles: none; the sheet works them out). */
  kerbs?: KerbLine[];
  /** Potential views, each with its sight line checked where one could be. */
  views?: ViewTarget[];
  /** Height above the site's ground the sight lines were taken from. */
  eyeAboveM?: number;
  /** Attribution lines the data licences ask for, printed on the sheet. */
  attributions?: string[];
  busStops: { name?: string; lon: number; lat: number }[];
  /** Footprints with what is known of their height, for the neighbours' storey labels. */
  buildings?: BuildingsData;
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

const SITE_SCALES = [200, 250, 300, 400, 500, 600, 750, 1000];

export async function runSitePipeline(address: string, opts: SitePipelineOpts): Promise<SiteBundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);
  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');

  const ring = siteOuterRing(siteLots);

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

  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  log('fetching contours, lots, roads, neighbours, furniture, trees, imagery…');
  const nswContours: ContourSet = { lines: [], intervalM: 2, source: 'NSW Spatial Services' };
  const noBuildings: BuildingsData = { source: 'none', buildings: [], fetchedAt: new Date().toISOString() };
  const emptyFc: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const [contourSet, allLots, roads, railLines, zoning, heights, heritage, services, neighbours, furniture, aerial, councilTrees, parkPoints, controls, buildings, footways] = await Promise.all([
    soft(fetchContours(extent, log), nswContours, 'contours'),
    soft(fetchAllLots(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'lots'),
    soft(fetchRoads(extent), [], 'roads'),
    soft(fetchRailLines(extent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchZoning(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'zoning'),
    soft(fetchHeightOfBuilding(extent), emptyFc, 'height of building'),
    soft(fetchHeritage(extent), emptyFc, 'heritage'),
    soft(fetchServices(extent, log), emptyServices(), 'services'),
    soft(fetchNeighbourAddresses(extent), [], 'neighbour addresses'),
    soft(fetchSiteFurniture(extent), emptyFurniture(), 'street furniture (OSM)'),
    fetchAerial(extent, 3600, dataDir),
    soft(fetchCouncilTrees(extent, log), [], 'council trees'),
    soft(fetchParkPoints(extent), [], 'park points'),
    soft(fetchSiteControls(geo.center), null, 'site controls'),
    soft(fetchBuildings(extent, log), noBuildings, 'buildings'),
    soft(fetchFootways(extent, log), { source: 'none', lines: [], fetchedAt: new Date().toISOString() } as FootwaysData, 'footways'),
  ]);

  let busStops: { name?: string; lon: number; lat: number }[] = [];
  if (process.env.TFNSW_API_KEY) {
    busStops = await soft(fetchBusStopsTfnsw(extent, process.env.TFNSW_API_KEY), [], 'bus stops (TfNSW)');
  }

  // Trees: the council's inventory where there is one, OSM around it.
  const osmTrees = furniture.trees.length;
  furniture.trees = mergeTrees(councilTrees, furniture.trees);

  // Kerbside bays, set out at the kerb the cadastre implies.
  const lotRings = allLots.features.flatMap((f) => ringsOf(f.geometry));
  const parkingBands = buildParkingBands(furniture.parkingLanes, lotRings,
    furniture.driveways.map((d) => d.coords), roads.map((r) => r.coords));
  const bays = parkingBands.reduce((n, b) => n + b.bays.length, 0);
  // Kerb lines, worked out once here so the sheet and the CAD export draw the same ones.
  let kerbs: KerbLine[] = [];
  try { kerbs = estimateKerbs(lotRings, roads, footways.lines, furniture.kerbs ?? []); }
  catch (e) { log(`  kerbs: not worked out (${(e as Error).message})`); }

  log(`  contours:${contourSet.lines.length} (${contourSet.intervalM} m) lots:${allLots.features.length} roads:${roads.length} ` +
      `neighbours:${neighbours.length} trees:${furniture.trees.length} (council ${councilTrees.length}, osm ${osmTrees}) ` +
      `parking bays:${bays} kerb lines:${kerbs.length} car parks:${furniture.carParks.length} busStops:${busStops.length}`);

  // Sight lines to the skyline, the water and the park next door.
  log('checking sight lines over the terrain…');
  const siteLL = mercatorToLonLat({ x: cx0, y: cy0 });
  const { views, eyeAboveM } = await soft(
    assessViews({ site: siteLL, siteRing: ring, hobM: controls?.maxHeightM, zoning, parkPoints, log }),
    { views: [], eyeAboveM: eyeAboveGround(controls?.maxHeightM) },
    'views',
  );

  const attributions = [
    ...TREE_SOURCES.filter((s) => councilTrees.some((t) => t.source === s.id)).map((s) => s.attribution),
    ...(contourSet.attribution ? [contourSet.attribution] : []),
    ...services.sources.map((s) => s.attribution),
  ];
  if (services.sources.length) log(`  services: ${services.sources.map((s) => `${s.name} (${s.count})`).join(', ')}`);

  const bundle: SiteBundle = {
    address, geocode: geo, extent, view, scale,
    siteLots, siteRing: ring, allLots, roads, railLines, zoning, heights, heritage, services, footways,
    contours: contourSet.lines, contourIntervalM: contourSet.intervalM, contourSource: contourSet.source,
    neighbours, furniture, parkingBands, kerbs, views, eyeAboveM, attributions,
    busStops, buildings, aerial, generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dataDir, 'site_bundle.json'), JSON.stringify(bundle));
  return bundle;
}

/** The outer boundary of the site's lots, unioned: one ring, lon/lat. */
function siteOuterRing(siteLots: GeoJSONFC): [number, number][] {
  const polys = siteLots.features.filter((f) => f.geometry);
  if (polys.length === 1) return geomOuter(polys[0].geometry);
  const merged = turfUnion(featureCollection(polys as any)) as any;
  return geomOuter(merged?.geometry ?? polys[0].geometry);
}

function ringsOf(geometry: any): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
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

// ---------------------------------------------------------------------------
// DEVELOPMENT SUMMARY — no map, so no extent, imagery or OSM: just the lots
// and the planning controls that apply at the site.

export async function runSummaryPipeline(
  address: string,
  opts: { outDir: string; log?: (m: string) => void },
): Promise<SummaryBundle> {
  const log = opts.log ?? (() => {});
  await mkdir(join(opts.outDir, 'data'), { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);

  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');

  log('reading planning controls at the site…');
  const controls = await fetchSiteControls(geo.center);
  log(`  ${[controls.epiName, controls.zoneCode].filter(Boolean).join(' · ') || 'no LEP mapped'}`);

  const bundle: SummaryBundle = {
    address,
    siteAddress: geo.matchedAddresses[0] ?? address,
    generatedAt: new Date().toISOString(),
    lotDescription: describeLots(siteLots),
    siteAreaSqm: lotsAreaSqm(siteLots, geo.center),
    areaIsCadastral: true,
    controls,
  };
  await writeFile(join(opts.outDir, 'data', 'summary.json'), JSON.stringify(bundle, null, 2));
  return bundle;
}

// ---------------------------------------------------------------------------
// PLANNING YIELD — the summary's controls, and what they let the site hold:
// the lot's boundary with the streets along it, the ground's level, the
// nearest station (which decides the parking rates), the housing-policy maps
// at the site, and the neighbours' footprints with their heights for the
// massing's context, each with what its zone, height of building and floor
// space ratio let it rise to. For the plan, drawn as the site analysis draws its ground: each
// lot's street numbers, zone and height of building, and the kerbs. The study
// itself is computed when the sheet is drawn (render/yieldSheet.ts), so an
// edited `yield_assumptions.json` beside the output needs no refetch.

export async function runYieldPipeline(
  address: string,
  opts: { outDir: string; log?: (m: string) => void },
): Promise<YieldBundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);
  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');
  const ring = siteOuterRing(siteLots);

  // Windows around the site: the streets, lots and levels close by, the
  // neighbours' footprints a little further, the stations within reach.
  const ringM = ring.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const cx = ringM.reduce((t, p) => t + p.x, 0) / ringM.length, cy = ringM.reduce((t, p) => t + p.y, 0) / ringM.length;
  const k = mercatorScaleFactor(mercatorToLonLat({ x: cx, y: cy }).lat);
  const reach = Math.max(...ringM.map((p) => Math.hypot(p.x - cx, p.y - cy))) / k;
  const around = (m: number): Extent => ({ xmin: cx - (reach + m) * k, ymin: cy - (reach + m) * k, xmax: cx + (reach + m) * k, ymax: cy + (reach + m) * k });

  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });
  log('reading planning controls, streets, levels, stations and the neighbours…');
  const emptyFc: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const noBuildings: BuildingsData = { source: 'none', buildings: [], fetchedAt: new Date().toISOString() };
  const [controls, roads, lots, contourSet, stations, policy, buildings, zoning, hob, fsr, addresses, footways] = await Promise.all([
    fetchSiteControls(geo.center),
    soft(fetchRoads(around(110)), [], 'roads'),
    soft(fetchAllLots(around(110)), emptyFc, 'lots'),
    soft(fetchContours(around(40), log), { lines: [], intervalM: 2, source: 'NSW Spatial Services' } as ContourSet, 'contours'),
    soft(fetchTrainStations(around(1200)), [], 'stations'),
    soft(fetchPolicyAreas(around(5), log), [], 'housing policy maps'),
    soft(fetchBuildings(around(110), log), noBuildings, 'buildings'),
    soft(fetchZoning(around(110)), emptyFc, 'zoning'),
    soft(fetchHeightOfBuilding(around(110)), emptyFc, 'height of building'),
    soft(fetchFloorSpaceRatio(around(110)), emptyFc, 'floor space ratio'),
    soft(fetchNeighbourAddresses(around(110)), [] as NeighbourAddress[], 'addresses'),
    soft(fetchFootways(around(110), log), { source: 'none', lines: [], fetchedAt: new Date().toISOString() } as FootwaysData, 'footways'),
  ]);
  log(`  ${[controls.epiName, controls.zoneCode, controls.maxHeightM ? `HOB ${controls.maxHeightM} ${controls.heightUnits ?? 'm'}` : '', controls.fsr ? `FSR ${controls.fsr}:1` : ''].filter(Boolean).join(' · ') || 'no LEP mapped'}`);

  // Each boundary edge: the named street running along it, if one does (its
  // centreline within 20 m of the edge's middle and within 35° of its bearing).
  const toM = ([lon, lat]: number[]) => { const m = lonLatToMercator({ lon, lat }); return { x: (m.x - cx) / k, y: (m.y - cy) / k }; };
  const frontages = ring.slice(0, -1).map((_, i) => {
    const a = toM(ring[i]), b = toM(ring[(i + 1) % ring.length]);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return null;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const eb = Math.atan2(b.y - a.y, b.x - a.x);
    let best: { name: string; d: number } | null = null;
    for (const r of roads) {
      const pts = r.coords.map(toM);
      for (let j = 1; j < pts.length; j++) {
        const p = pts[j - 1], q = pts[j], dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((mid.x - p.x) * dx + (mid.y - p.y) * dy) / l2));
        const d = Math.hypot(mid.x - (p.x + t * dx), mid.y - (p.y + t * dy));
        let da = Math.abs(Math.atan2(dy, dx) - eb) % Math.PI;
        if (da > Math.PI / 2) da = Math.PI - da;
        if (d <= 20 && da <= (35 * Math.PI) / 180 && (!best || d < best.d)) best = { name: r.name, d };
      }
    }
    return best?.name ?? null;
  });

  // The ground at the corners, from the contours.
  const contoursM: ContourM[] = contourSet.lines.map((c) => ({ z: c.elevation, pts: c.coords.map(toM) }));
  const levels = ring.slice(0, -1).map((p) => levelAt(toM(p), contoursM, contourSet.intervalM)).filter((v): v is number => v != null);
  const groundRL = levels.length ? { min: Math.min(...levels), max: Math.max(...levels), mean: levels.reduce((t, v) => t + v, 0) / levels.length } : undefined;

  const centreLL = mercatorToLonLat({ x: cx, y: cy });
  const metres = (lon: number, lat: number) => { const m = lonLatToMercator({ lon, lat }); return Math.hypot(m.x - cx, m.y - cy) / k; };
  const nearest = stations.map((s) => ({ name: s.name, distanceM: Math.round(metres(s.lon, s.lat)) })).sort((p, q) => p.distanceM - q.distanceM)[0];
  const cbd = CENTRES.filter((c) => c.kind === 'cbd').map((c) => ({ name: c.name, kind: c.kind, distanceM: Math.round(metres(c.lon, c.lat)) })).sort((p, q) => p.distanceM - q.distanceM)[0];
  const policyAtSite = policy.filter((pa) => isRealPolicyArea(pa.name) && pa.rings.some((r) => pointInRingLL(centreLL.lon, centreLL.lat, r))).map((pa) => ({ kind: pa.kind, name: pa.name }));

  // The neighbours' footprints with what is known of their height; one with
  // none stands in at a nominal two storeys, drawn as such. Each also carries
  // what its future is read from (lib/yield.ts futureHeight, worked out when
  // the sheet is drawn so a changed efficiency carries): its zone, its height
  // of building — a control mapped as an RL read above the ground the
  // contours give at the building — its floor space ratio, and the land it
  // stands on, its lot shared between the buildings on it by footprint.
  const siteRingLL = ring;
  // Even-odd over every ring, so a point in a polygon's hole is outside it.
  const at = (fc: GeoJSONFC, lon: number, lat: number) =>
    fc.features.find((f) => ringsOf(f.geometry).filter((rg) => pointInRingLL(lon, lat, rg)).length % 2 === 1)?.properties;
  const areaM = (rings: number[][][]) => rings.reduce((t, rg, i) => t + (i ? -1 : 1) * ringArea(rg.map(toM)), 0);
  const lotRingsAll = lots.features.map((f) => ringsOf(f.geometry)).filter((r) => r.length);
  const lotOf = (lon: number, lat: number) => lotRingsAll.findIndex((rings) => rings.filter((rg) => pointInRingLL(lon, lat, rg)).length % 2 === 1);
  // What stands on the site today is kept, not dropped: the sheet states it
  // and the scenarios stand against it.
  const existing: ExistingBuilding[] = buildings.buildings
    .filter((bd) => pointInRingLL(bd.centroid[0], bd.centroid[1], siteRingLL))
    .map((bd) => ({
      footprintSqm: Math.round(areaM(bd.rings.slice(0, 1))),
      ...(bd.heightM || bd.estimatedHeightM ? { heightM: Math.round((bd.heightM ?? bd.estimatedHeightM!) * 10) / 10 } : {}),
      ...(bd.floors ? { storeys: bd.floors } : {}),
      rings: bd.rings.slice(0, 1),
    }))
    .filter((e) => e.footprintSqm >= 25);   // a shed says nothing about the site's use
  const standing = buildings.buildings.filter((bd) => !pointInRingLL(bd.centroid[0], bd.centroid[1], siteRingLL))
    .map((bd) => ({ bd, footprint: areaM(bd.rings.slice(0, 1)), lot: lotOf(bd.centroid[0], bd.centroid[1]) }));
  const footprintOnLot = new Map<number, number>();
  for (const s of standing) if (s.lot >= 0) footprintOnLot.set(s.lot, (footprintOnLot.get(s.lot) ?? 0) + s.footprint);
  const context = standing.map(({ bd, footprint, lot }) => {
    const heightM = bd.estimatedHeightM ?? bd.heightM ?? (bd.floors ? bd.floors * METRES_PER_STOREY : 0);
    const [lon, lat] = bd.centroid;
    const h = at(hob, lon, lat), value = Number(h?.MAX_B_H);
    let hobM: number | undefined = Number.isFinite(value) && value > 0 ? value : undefined;
    if (hobM && /rl|ahd/i.test(String(h?.UNITS ?? ''))) {
      const g = levelAt(toM([lon, lat]), contoursM, contourSet.intervalM);
      hobM = g == null ? undefined : hobM - g;
    }
    const zone = at(zoning, lon, lat)?.SYM_CODE, f = Number(at(fsr, lon, lat)?.FSR);
    const landSqm = lot >= 0 ? (areaM(lotRingsAll[lot]) * footprint) / (footprintOnLot.get(lot) || footprint) : undefined;
    const controls: FutureControls = {
      ...(zone ? { zone: String(zone).trim() } : {}),
      ...(hobM ? { hobM: Math.round(hobM * 10) / 10 } : {}),
      ...(Number.isFinite(f) && f > 0 ? { fsr: f } : {}),
      ...(landSqm ? { landSqm: Math.round(landSqm) } : {}),
    };
    return { rings: bd.rings, heightM, known: !!(bd.estimatedHeightM ?? bd.heightM ?? bd.floors), controls, footprint };
  });
  log(`  neighbours: ${context.length}, ${context.filter((c) => futureHeight(c.controls, c.footprint, c.known ? c.heightM : undefined)).length} with a future height over today's`);
  if (existing.length) log(`  stands today: ${existing.length} building${existing.length > 1 ? 's' : ''} on the site${existing.some((e) => e.storeys || e.heightM) ? '' : ', no height recorded'}`);

  // Each lot with what the plan writes on it: its street numbers (the address
  // points inside it), and the zone and height of building at a point inside it.
  const near = (lon: number, lat: number) => metres(lon, lat) < reach + 110;
  const parcels = lots.features.map((f) => {
    const rings = ringsOf(f.geometry);
    const inside = (lon: number, lat: number) => rings.filter((rg) => pointInRingLL(lon, lat, rg)).length % 2 === 1;
    const numbers = [...new Set(addresses.filter((a) => inside(a.lon, a.lat)).map((a) => a.housenumber.toUpperCase()))];
    const [lon, lat] = interiorLL(rings);
    const z = at(zoning, lon, lat), h = at(hob, lon, lat), v = Number(h?.MAX_B_H);
    return {
      rings,
      ...(numbers.length ? { numbers } : {}),
      ...(z?.SYM_CODE ? { zone: String(z.SYM_CODE).trim() } : {}),
      ...(Number.isFinite(v) && v > 0 ? { hob: { value: v, units: String(h?.UNITS ?? 'm') } } : {}),
    };
  }).filter((pc) => pc.rings.length && pc.rings[0].some(([lon, lat]) => near(lon, lat)));

  // The kerbs, as the site sheet places them: a footpath's width out from the boundary.
  let kerbs: KerbLine[] = [];
  try { kerbs = estimateKerbs(lots.features.flatMap((f) => ringsOf(f.geometry)), roads, footways.lines, []); }
  catch (e) { log(`  kerbs: not worked out (${(e as Error).message})`); }
  kerbs = kerbs.filter((kl) => kl.coords.some(([lon, lat]) => near(lon, lat)));
  log(`  plan: ${parcels.length} lots, ${parcels.filter((pc) => pc.numbers).length} numbered, ${kerbs.length} kerb lines`);

  let assumptions: YieldBundle['assumptions'];
  try { assumptions = JSON.parse(await readFile(join(opts.outDir, 'yield_assumptions.json'), 'utf8')); log('  assumptions from yield_assumptions.json'); } catch { /* the defaults */ }

  const bundle: YieldBundle = {
    address,
    siteAddress: geo.matchedAddresses[0] ?? address,
    generatedAt: new Date().toISOString(),
    lotDescription: describeLots(siteLots),
    siteAreaSqm: lotsAreaSqm(siteLots, geo.center),
    areaIsCadastral: true,
    controls,
    siteRing: ring,
    frontages,
    groundRL,
    station: nearest,
    cbd: cbd && cbd.distanceM <= 1500 ? cbd : undefined,
    policyAtSite,
    roads: roads.filter((r) => r.coords.some(([lon, lat]) => near(lon, lat))),
    parcels,
    kerbs,
    context: context.map(({ footprint: _f, ...c }) => c),
    existing,
    buildingsSource: buildings.source,
    assumptions,
  };
  await writeFile(join(dataDir, 'yield.json'), JSON.stringify(bundle));
  return bundle;
}

/** A point inside the lot: its centroid where that is inside, else the middle of the widest run across it at that latitude. */
function interiorLL(rings: number[][][]): [number, number] {
  const outer = rings[0] ?? [];
  if (!outer.length) return [0, 0];
  const lon = outer.reduce((t, p) => t + p[0], 0) / outer.length, lat = outer.reduce((t, p) => t + p[1], 0) / outer.length;
  const inside = (x: number, y: number) => rings.filter((rg) => pointInRingLL(x, y, rg)).length % 2 === 1;
  if (inside(lon, lat)) return [lon, lat];
  const xs: number[] = [];
  for (const rg of rings) for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    const [xi, yi] = rg[i], [xj, yj] = rg[j];
    if (yi > lat !== yj > lat) xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best: [number, number] = [lon, lat], widest = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > widest) { widest = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, lat]; }
  return best;
}

function pointInRingLL(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** "1//DP212120" + "2//DP212120" -> "LOT 1&2 - DP 212120" */
function describeLots(fc: GeoJSONFC): string {
  const byPlan = new Map<string, string[]>();
  for (const f of fc.features) {
    const id = String(f.properties?.lotidstring ?? '');
    const m = id.match(/^([^/]+)\/([^/]*)\/(.+)$/);
    if (!m) continue;
    const plan = m[3].replace(/^([A-Z]+)/, '$1 ');
    if (!byPlan.has(plan)) byPlan.set(plan, []);
    byPlan.get(plan)!.push(m[1] + (m[2] ? `/${m[2]}` : ''));
  }
  if (!byPlan.size) return '—';
  return [...byPlan.entries()]
    .map(([plan, lots]) => `LOT ${lots.join('&')} - ${plan}`)
    .join('; ');
}

/**
 * Ground area of the lots. Web Mercator exaggerates area by the square of the
 * scale factor at this latitude, so divide it back out. This is the cadastral
 * boundary, which is a GIS approximation — the survey figure is authoritative
 * and is usually a little different.
 */
function lotsAreaSqm(fc: GeoJSONFC, center: { x: number; y: number }): number | undefined {
  const k = mercatorScaleFactor(mercatorToLonLat(center).lat);
  let total = 0;
  for (const f of fc.features) {
    const g: any = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      // outer ring minus holes
      poly.forEach((ring: number[][], i: number) => {
        const pts = ring.map((c) => lonLatToMercator({ lon: c[0], lat: c[1] }));
        let s = 0;
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          s += (pts[b].x + pts[a].x) * (pts[b].y - pts[a].y);
        }
        total += (i === 0 ? 1 : -1) * Math.abs(s / 2) / (k * k);
      });
    }
  }
  return total > 0 ? total : undefined;
}


// ---------------------------------------------------------------------------
// OVERALL ANALYSIS slides (docs/SLIDES_SPEC.md). The first two slides are the
// planning ones: four small maps at ~1:8000 around the site and the controls
// that apply at it. One window, north up, shared by every panel.

export interface SlidesBundle {
  address: string;
  siteAddress: string;
  generatedAt: string;
  geocode: GeocodeResult;
  panel: Panel;
  extent: Extent;
  siteLots: GeoJSONFC;
  lotDescription: string;
  siteAreaSqm?: number;
  zoning: GeoJSONFC;
  hob: GeoJSONFC;
  heritage: GeoJSONFC;
  shr: GeoJSONFC;
  policy: PolicyArea[];
  /** The same maps 3 km round the site, for pointing to the nearest when none is on the page; absent in older bundles. */
  policyNear?: PolicyArea[];
  base: BaseData;
  controls: SiteControls;
  property: PropertyReport | null;
  context: PlanningContext;
  housingTarget: HousingTarget | null;
  /** Council's own DCP mapping, where a council publishes it (City of Sydney). */
  cos: CityOfSydneyDcp | null;
  /** The development-activity map is taller than a planning panel; same centre and scale. */
  daPanel: Panel;
  /** The full-bleed figure page: one A4 page at the deck's scale. */
  bleedPanel: Panel;
  /** Country's full page at the strip's scale. */
  countryPanel: Panel;
  /** The walking-reach map's window: square at the strip's scale, cut to the catchment when drawn. */
  reachPanel: Panel;
  /** Applications lodged in the window, from the council-wide feed. */
  applications: DaRecord[];
  /** The Department's register of State significant applications for the council areas the window touches, those within 3 km with their points. */
  majorProjects: MajorProjectsData;
  /** Slide 13's wind roses; absent from decks built before it. */
  wind?: WindData;
  daMeta: { council: string; from: string; to: string; total: number; complete: boolean; fetchedAt: string } | null;
  proposals: PlanningProposal[];
  /** Census, population, projections, SEIFA, land values, sales and schools for the site's regions; null when the ABS lookup failed. */
  people: PeopleData | null;
  /** The elevation grid over the tall panel and the contours over the fetch window, with their interval and origin. */
  terrain: { dem: DemGrid | null; contours: ContourLine[]; contourIntervalM?: number; contourSource?: string; contourAttribution?: string };
  /** Building footprints with heights over the tall panel (Overture, or OpenStreetMap). */
  buildings: BuildingsData;
  /** Isochrones, bus, cycleways, footways, one-way streets and active frontages over the tall panel. */
  movement: MovementData;
  /** Tree canopy by mesh block over the wide strip; open space, Green Grid assets, facilities, NPWS estate and street trees over the tall panel. */
  green: GreenData;
  /** Hazard, protection, coastal and corridor layers over the planning panel, with the plan-wide coverage check, and the soil landscape at the site. */
  constraints: ConstraintsData;
  /** The site plan's aerial, the lots, easements, neighbours and the public land around, with the two panels they are drawn in. */
  site: SiteData;
  /** The candidate views (skylines, water, the park next door) with their sight lines checked against the ground, and the eye height used. */
  views: { views: ViewTarget[]; eyeAboveM: number };
  /** The wide walking-reach strip: its panel, a lighter base (major roads, rail, stations, water) and the suburbs to label. */
  wide: { panel: Panel; base: BaseData; suburbs: GeoJSONFC };
  /** The open layers of Country over the wide strip: native title, gazetted Aboriginal Places, the pre-1750 vegetation, watercourses, land council areas, the NPWS estate, a wide elevation grid with its ridgelines, the ASDST model at the site. */
  country: CountryData;
  /** The street-level frames that look at the site, with their cameras, and the then-and-now aerial pair over one block panel. */
  photos: PhotosData;
  /** The location window at 1:75,000: the local government areas as land, the water, the railways, the arterial roads, the stations and the suburbs. */
  location: LocationData;
  /** Wikipedia's account of the suburb and its places, Commons' photographs near the site and the aerial over the planning window. */
  character: CharacterData;
  /** The regional plan at the point and the council's local strategic planning statement from the Portal's index. */
  strategies: StrategiesData;
  warnings: string[];
}

export interface SlidesPipelineOpts {
  outDir: string;
  /** Map scale of the panels; 1:8000 shows about 1.1 × 0.75 km per panel. */
  scale?: number;
  panelWmm: number;
  panelHmm: number;
  /** Height of the development-activity map panel. */
  daPanelHmm: number;
  /** The walking-reach strip: width and height in mm and its scale (defaults 296 × 100 at 1:16000). */
  wideWmm?: number;
  wideHmm?: number;
  wideScale?: number;
  /** How far back the development-activity feed reaches (default five years, never before July 2021). */
  daYears?: number;
  log?: (msg: string) => void;
}

/** The round scales the deck's site plan is drawn at. */
/** The full-page maps' scale, and Country's. */
export const BLEED_SCALE = 5000, COUNTRY_SCALE = 10000;
const DECK_SITE_SCALES = [200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];

/** A panel centred on the site's lots at the smallest round scale that keeps them within 55 % of the panel each way. */
function fitSitePanel(siteLots: GeoJSONFC, wMm: number, hMm: number): Panel {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of siteLots.features) for (const r of geomRingsOf(f.geometry)) for (const [lon, lat] of r) { const m = lonLatToMercator({ lon, lat }); x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y); }
  const center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const k = mercatorScaleFactor(mercatorToLonLat(center).lat);
  const wM = (x1 - x0) / k, hM = (y1 - y0) / k;
  const need = Math.max(wM / ((wMm / 1000) * 0.55), hM / ((hMm / 1000) * 0.55));
  const scale = DECK_SITE_SCALES.find((s) => s >= need) ?? DECK_SITE_SCALES[DECK_SITE_SCALES.length - 1];
  return { center, scale, wMm, hMm };
}
const geomRingsOf = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);

/** The site's biggest ring, for the tests that want one outline (a multi-lot site's union is the site sheet's business). */
function largestRing(siteLots: GeoJSONFC): [number, number][] {
  let best: number[][] = [], bestA = -1;
  for (const f of siteLots.features) for (const r of geomRingsOf(f.geometry)) {
    let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
  }
  return best as [number, number][];
}

/** The local environmental plans in the window, most common first: the zoning layer's plan names, then the property report's. */
function principalLeps(zoning: GeoJSONFC, property: PropertyReport | null): string[] {
  const counts = new Map<string, number>();
  for (const f of zoning.features) { const n = String(f.properties?.EPI_NAME ?? ''); if (/Local Environmental Plan/i.test(n)) counts.set(n, (counts.get(n) ?? 0) + 1); }
  for (const g of property?.epi ?? []) for (const r of g.results ?? []) { const n = String((r as any)['EPI Name'] ?? ''); if (/Local Environmental Plan/i.test(n) && !counts.has(n)) counts.set(n, 0); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

export async function runSlidesPipeline(address: string, opts: SlidesPipelineOpts): Promise<SlidesBundle> {
  const warnings: string[] = [];
  const log = (m: string) => { opts.log?.(m); if (/WARN/.test(m)) warnings.push(m.trim()); };
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);
  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');

  const panel: Panel = { center: geo.center, scale: opts.scale ?? 8000, wMm: opts.panelWmm, hMm: opts.panelHmm };
  const extent = panelExtent(panel);
  const daPanel: Panel = { ...panel, hMm: opts.daPanelHmm };
  const daExtent = panelExtent(daPanel);
  const widePanel: Panel = { center: geo.center, scale: opts.wideScale ?? 16000, wMm: opts.wideWmm ?? 186, hMm: opts.wideHmm ?? 95 };
  const wideExtent = panelExtent(widePanel);
  // The walking-reach map, cut to the shape of its own fifteen minutes: a square window at the strip's scale,
  // tall enough that the catchment is never clipped. The strip's lighter base is read over both.
  const reachPanel: Panel = { center: geo.center, scale: widePanel.scale, wMm: 186, hMm: 186 };
  const reachExtent = panelExtent(reachPanel);
  // Country's full page: one A4 page at 1:10,000, 2.1 × 3 km round the site.
  const countryPanel: Panel = { center: geo.center, scale: COUNTRY_SCALE, wMm: 210, hMm: 297 };
  const countryExtent = panelExtent(countryPanel);
  const countryFetch: Extent = {
    xmin: Math.min(wideExtent.xmin, countryExtent.xmin), ymin: Math.min(wideExtent.ymin, countryExtent.ymin),
    xmax: Math.max(wideExtent.xmax, countryExtent.xmax), ymax: Math.max(wideExtent.ymax, countryExtent.ymax),
  };
  const countryK = mercatorScaleFactor(mercatorToLonLat(geo.center).lat);
  const wideFetch: Extent = {
    xmin: Math.min(wideExtent.xmin, reachExtent.xmin, countryExtent.xmin), ymin: Math.min(wideExtent.ymin, reachExtent.ymin, countryExtent.ymin),
    xmax: Math.max(wideExtent.xmax, reachExtent.xmax, countryExtent.xmax), ymax: Math.max(wideExtent.ymax, reachExtent.ymax, countryExtent.ymax),
  };
  // The site plan's panel: the lots fitted into a little over half of a tall panel at a round scale, centred on them.
  const sitePanel = fitSitePanel(siteLots, 210, 297);
  const blockPanel: Panel = { center: geo.center, scale: 4000, wMm: opts.panelWmm, hMm: opts.wideHmm ?? 72 };
  // The then-and-now pair: two half-width panels side by side at 1:2500, the 1943 survey and today's imagery over the same ground.
  const pairPanel: Panel = { center: geo.center, scale: 2500, wMm: 210, hMm: 148.5 };
  // The location window: one full A4 page at 1:100,000, 21 × 29.7 km round the site.
  const locationPanel: Panel = { center: geo.center, scale: 100000, wMm: 210, hMm: 297 };
  // Every fetch window is the larger of the two, so nothing is missing from either map.
  // The full-bleed figure page: a map the size of one A4 page at the deck's scale,
  // for the slides that run their map to the sheet's edges.
  // 1:5000: close enough to read the block and its neighbours, wide enough for the walk to the station.
  const bleedPanel: Panel = { center: geo.center, scale: BLEED_SCALE, wMm: 210, hMm: 297 };
  const bleedExtent = panelExtent(bleedPanel);
  // The layers the full-page maps draw are read over the full page as well as the tall panel.
  const pageExtent: Extent = {
    xmin: Math.min(daExtent.xmin, bleedExtent.xmin), ymin: Math.min(daExtent.ymin, bleedExtent.ymin),
    xmax: Math.max(daExtent.xmax, bleedExtent.xmax), ymax: Math.max(daExtent.ymax, bleedExtent.ymax),
  };
  const fetchExtent: Extent = {
    xmin: Math.min(extent.xmin, daExtent.xmin, bleedExtent.xmin), ymin: Math.min(extent.ymin, daExtent.ymin, bleedExtent.ymin),
    xmax: Math.max(extent.xmax, daExtent.xmax, bleedExtent.xmax), ymax: Math.max(extent.ymax, daExtent.ymax, bleedExtent.ymax),
  };
  const emptyFC: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  log('fetching planning maps, heritage, policy areas, base layers and the property report…');
  // The council first, on its own: the development-activity feed is per
  // council and is the slowest fetch of the deck, so it should start with the
  // others rather than after them. One point query against the LGA layer.
  const lgaCouncil = await soft(queryByPoint('https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/8', geo.center, 'lganame,councilname')
    .then((fc) => fc.features[0]?.properties as { lganame?: string; councilname?: string } | undefined), undefined, 'local government area');
  const council = apiCouncilName(lgaCouncil?.councilname, lgaCouncil?.lganame);
  if (!council) log(`  WARN no Online DA API council name for "${lgaCouncil?.councilname ?? '?'}"`);
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(); fromDate.setFullYear(fromDate.getFullYear() - (opts.daYears ?? 5));
  const from = [fromDate.toISOString().slice(0, 10), PORTAL_MANDATED].sort()[1];

  const emptyGreen: GreenData = { canopy: { blocks: [], covered: false, year: 2022, source: 'Greater Sydney Tree Canopy Cover 2022 (NSW ePlanning)' }, openSpace: [], openSpaceWide: [], greenGrid: [], parkPoints: [], facilities: [], npws: [], trees: { points: [] }, fetchedAt: new Date().toISOString() };
  const emptyConstraints: ConstraintsData = { layers: [], soil: null, fetchedAt: new Date().toISOString() };
  const emptySite: SiteData = { sitePanel, blockPanel, aerial: null, imagery: null, lots: [], easements: [], neighbours: [], publicLand: [], fetchedAt: new Date().toISOString() };
  // The lots and the footprints are read once and wait for both the maps and Street View, which uses them to tell a camera in the street from one in a shop or behind a neighbour.
  const lotsRead = soft(fetchAllLots(fetchExtent), emptyFC, 'cadastral lots');
  const footprintsRead = soft(fetchBuildings(pageExtent, log), { source: 'none' as const, buildings: [], fetchedAt: new Date().toISOString() }, 'buildings');
  const [zoning, hob, heritage, shr, policy, water, lots, roads, railLines, stations, context, property, controls, proposals, feed, people, dem, contourSet, buildingsRead, movement, green, constraints, site, wideRoads, wideRail, wideStations, wideWater, wideSuburbs, country, photos, location, majorProjects, wind, policyNear] = await Promise.all([
    soft(fetchZoningDetailed(fetchExtent), emptyFC, 'zoning'),
    soft(fetchHobDetailed(fetchExtent), emptyFC, 'height of building'),
    soft(fetchHeritageDetailed(fetchExtent), emptyFC, 'heritage'),
    soft(fetchShrCurtilages(fetchExtent), emptyFC, 'State Heritage Register'),
    fetchPolicyAreas(fetchExtent, log),
    soft(fetchWaterAreas(fetchExtent), emptyFC, 'water areas'),
    lotsRead,
    soft(fetchRoads(fetchExtent), [], 'roads'),
    soft(fetchRailLines(fetchExtent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchTrainStations(fetchExtent), [], 'stations'),
    fetchPlanningContext(geo.center, log),
    fetchPropertyReport(geo.matchedAddresses[0] ?? address, geo.center, log),
    fetchSiteControls(geo.center),
    fetchPlanningProposals(pageExtent, log),
    council ? soft(fetchCouncilApplications(council, from, today, log), null, 'Online DA API') : Promise.resolve(null),
    soft(fetchPeopleData(mercatorToLonLat(geo.center), geo.matchedAddresses[0], log), null, 'people and market'),
    soft(fetchDemGrid(fetchExtent), null, 'elevation model'),
    soft(fetchContours(fetchExtent, log), { lines: [], intervalM: 2, source: 'NSW Spatial Services' }, 'contours'),
    footprintsRead,
    fetchMovement(bleedExtent, geo.center, log),
    soft(fetchGreenSpace(pageExtent, wideExtent, log), emptyGreen, 'green and public domain'),
    soft(fetchConstraints(fetchExtent, mercatorToLonLat(geo.center), log), emptyConstraints, 'environmental constraints'),
    soft(fetchSiteData(sitePanel, blockPanel, siteLots, mercatorToLonLat(geo.center), dataDir, log), emptySite, 'site data'),
    soft(fetchRoads(wideFetch, 'roadnamebase IS NOT NULL AND functionhierarchy <= 5'), [], 'wide roads'),
    soft(fetchRailLines(wideFetch), { train: [], tram: [] }, 'wide rail lines'),
    soft(fetchTrainStations(wideFetch), [], 'wide stations'),
    soft(fetchWaterAreas(wideFetch), emptyFC, 'wide water areas'),
    soft(queryByExtent('https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/2', wideFetch, 'suburbname'), emptyFC, 'suburbs'),
    soft(fetchCountry(countryFetch, Math.round((countryFetch.xmax - countryFetch.xmin) / countryK / 2), Math.round((countryFetch.ymax - countryFetch.ymin) / countryK / 2), geo.center, dataDir, log), EMPTY_COUNTRY, 'Country'),
    soft(fetchPhotos({ centre: mercatorToLonLat(geo.center), siteRings: siteLots.features.flatMap((f) => geomRingsOf(f.geometry)), pairPanel, outDir: dataDir, log, lots: lotsRead.then((fc) => fc.features.flatMap((f) => geomRingsOf(f.geometry))), buildings: footprintsRead.then((bd) => bd.buildings.flatMap((x) => x.rings)) }), emptyPhotos(pairPanel), 'street-level frames and the 1943 aerial'),
    soft(fetchLocation(locationPanel, log), emptyLocation(locationPanel), 'location window'),
    // The Department's register of State significant applications: its listing for the council areas the window touches and each project's page, cached.
    soft(fetchMajorProjects(pageExtent, geo.center, log), emptyMajorProjects('the register did not answer'), 'State significant applications'),
    // The hourly wind over the last five years from NASA's POWER project, as roses for slide 13; cached by the model's cell.
    soft(fetchWind(mercatorToLonLat(geo.center), log), emptyWind('NASA POWER did not answer'), 'wind'),
    // The housing-policy maps 3 km round the site, so a page with none on it can say where the nearest are.
    soft(fetchPolicyAreas({ xmin: geo.center.x - 3000 * countryK, ymin: geo.center.y - 3000 * countryK, xmax: geo.center.x + 3000 * countryK, ymax: geo.center.y + 3000 * countryK }, log), [] as PolicyArea[], 'housing policy maps round the site'),
  ]);
  const [housingTarget, cos, , views, character, strategies] = await Promise.all([
    context.lga?.name ? fetchHousingTarget(context.lga.name) : Promise.resolve(null),
    // The one council with its DCP as open data so far; the hook is per LGA.
    context.lga?.name === 'SYDNEY' ? fetchCityOfSydneyDcp(extent, mercatorToLonLat(geo.center), log) : Promise.resolve(null),
    // Which of the plan's hazard and protection maps exist at all, for the constraints slide: checked against the local plan in the window (the zone at the site may come from a SEPP) and the plan at the site.
    constraints.layers.length ? soft(checkLepCoverage(constraints, [...principalLeps(zoning, property), ...(controls.epiName ? [controls.epiName] : [])], log), undefined, 'constraint coverage check') : Promise.resolve(undefined),
    // Sight lines to the skyline, the water and the park next door, from the eye just under the height limit, over the 5 m elevation surface.
    soft(assessViews({ site: mercatorToLonLat(geo.center), siteRing: largestRing(siteLots), hobM: controls.maxHeightM, zoning, parkPoints: green.parkPoints, log }), { views: [] as ViewTarget[], eyeAboveM: eyeAboveGround(controls.maxHeightM) }, 'views'),
    // The suburb's name comes from the context, so Wikipedia and Commons wait for it; the aerial over the planning window comes with them.
    soft(fetchCharacter({ centre: mercatorToLonLat(geo.center), suburb: context.suburb?.name ?? '', aerialExtent: bleedExtent, outDir: dataDir, log, buildings: buildingsRead.buildings.map((x) => x.rings) }), emptyCharacter(), 'character (Wikipedia, Commons)'),
    soft(fetchStrategies(geo.center, context.lga?.name, context.lga?.council, log), emptyStrategies(), 'strategic documents'),
  ]);
  // the green of the aerial over the page, for the trees no inventory holds
  green.vegetation = await fetchVegetationMask(bleedExtent, dataDir, 0.8, 1 / mercatorScaleFactor(mercatorToLonLat(geo.center).lat)).catch((e: any) => { log(`  WARN vegetation mask failed: ${e?.message ?? e}`); return null; });
  // the site's street end to end, where Street View is keyed
  const gkey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (gkey) {
    const st = addressStreet(geo.matchedAddresses[0] ?? address, roads, mercatorToLonLat(geo.center));
    if (st) photos.series = await fetchStreetSeries(st.name, st.segments, mercatorToLonLat(geo.center), dataDir, gkey, process.env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined, 8, log).catch((e: any) => { log(`  WARN street series failed: ${e?.message ?? e}`); return []; });
  }
  const applications = feed ? clipToExtent(feed.records, pageExtent) : [];
  const daMeta = feed ? { council: feed.council, from: feed.from, to: feed.to, total: feed.total, complete: feed.complete, fetchedAt: feed.fetchedAt } : null;
  // A footprint with neither a height nor a storey count takes the storeys of a determined application on its lot, and the slides say so.
  const buildings = withDaStoreys(buildingsRead, lots, applications);

  log(`  zoning:${zoning.features.length} hob:${hob.features.length} heritage:${heritage.features.length} shr:${shr.features.length} ` +
      `policy:${policy.length} roads:${roads.length} property:${property ? 'yes' : 'no'} dcp:${context.dcp ? 'yes' : 'no'} target:${housingTarget ? housingTarget.homes : '—'}${cos ? ' council-dcp:yes' : ''} ` +
      `applications:${applications.length}${feed ? `/${feed.records.length}` : ''} proposals:${proposals.length} dem:${dem ? `${dem.cols}×${dem.rows}` : 'no'} contours:${contourSet.lines.length} (${contourSet.intervalM} m) buildings:${buildings.buildings.length}/${buildings.source} da-storeys:${buildings.buildings.filter((x) => x.heightFrom === 'da').length}`);

  const bundle: SlidesBundle = {
    address,
    siteAddress: geo.matchedAddresses[0] ?? address,
    generatedAt: new Date().toISOString(),
    geocode: geo,
    panel,
    extent,
    siteLots,
    lotDescription: describeLots(siteLots),
    siteAreaSqm: lotsAreaSqm(siteLots, geo.center),
    zoning, hob, heritage, shr, policy, policyNear,
    base: { water, lots, roads, rail: railLines, stations, siteLots },
    controls, property, context, housingTarget, cos,
    daPanel, bleedPanel, reachPanel, countryPanel, applications, majorProjects, wind, daMeta, proposals, people,
    terrain: { dem, contours: contourSet.lines, contourIntervalM: contourSet.intervalM, contourSource: contourSet.source, contourAttribution: contourSet.attribution }, buildings, movement, green, constraints, site, views,
    wide: { panel: widePanel, base: { water: wideWater, lots: emptyFC, roads: wideRoads, rail: wideRail, stations: wideStations, siteLots }, suburbs: wideSuburbs },
    country,
    photos,
    location,
    character,
    strategies,
    warnings,
  };
  await writeFile(join(dataDir, 'slides_bundle.json'), JSON.stringify(bundle));
  return bundle;
}

// ---- the streetscape ------------------------------------------------------------------

export interface StreetscapeBundle {
  address: string;
  siteAddress: string;
  generatedAt: string;
  plan: StreetscapePlan;
  /** Each face's orthographic elevation from Google's 3D tiles, in the plan's face order (null where none was drawn); absent when the tiles were not to be had. */
  elevations?: (Elevation | null)[];
  /** The providers the 3D tiles credit, most meshes first. */
  tileCredits?: string[];
  /** How far the meshes stand above AHD at the boundary: the geoid and the meshes' own error (about 22 m at Sydney). */
  groundOffsetM?: number;
  /** Without the 3D tiles: the Street View frames, their pictures in `data/` beside the drawing; none without GOOGLE_MAPS_API_KEY. */
  frames: ScapeFrame[];
  /** Why there are no frames, when there are none. */
  framesNote?: string;
  demSource?: string;
  warnings: string[];
}

/**
 * The site's street, both faces, `halfLengthM` either way from the site: the
 * frontages and their addresses from the property layer, the ground from the
 * 5 m elevation model, and with GOOGLE_MAPS_API_KEY the Street View frames
 * that the drawing rectifies onto them (src/fetch/streetscape.ts).
 */
export async function runStreetscapePipeline(address: string, opts: { outDir: string; halfLengthM?: number; source?: 'photo' | 'mesh' | 'montage'; log?: (m: string) => void }): Promise<StreetscapeBundle> {
  const warnings: string[] = [];
  const log = (m: string) => { opts.log?.(m); if (/WARN/.test(m)) warnings.push(m.trim()); };
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });
  const half = opts.halfLengthM ?? 95;

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);
  const siteLots = await fetchSiteLots(geo.points);
  if (!siteLots.features.length) throw new Error('No cadastral lots found for the site.');
  const centre = mercatorToLonLat(geo.center);
  const k = mercatorScaleFactor(centre.lat);
  const r = (half + 90) * k;
  const extent: Extent = { xmin: geo.center.x - r, ymin: geo.center.y - r, xmax: geo.center.x + r, ymax: geo.center.y + r };

  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });
  const [roads, properties, dem] = await Promise.all([
    fetchRoads(extent),
    fetchProperties(extent),
    soft(fetchDemGrid(extent, 2.5), null, 'elevation model'),
  ]);
  const st = addressStreet(geo.matchedAddresses[0] ?? address, roads.filter((x) => !x.tunnel), centre);
  if (!st) throw new Error('No named street found beside the site.');
  const plan = planStreetscape({
    street: st.name, segments: st.segments, centre, halfLengthM: half,
    siteRings: siteLots.features.flatMap((f) => geomRingsOf(f.geometry)),
    properties: properties.features.map((f) => ({ id: String(f.properties.propid), address: f.properties.address ?? '', housenumber: f.properties.housenumber ?? undefined, rings: geomRingsOf(f.geometry) })),
    roads: roads.map((x) => ({ name: x.name, coords: x.coords, tunnel: x.tunnel })),
  });
  if (!plan) throw new Error(`${st.name} is too short or too far from the site to draw.`);

  const groundAt = (p: LonLat) => { if (!dem) return undefined; const m = lonLatToMercator(p); return demAt(dem, m.x, m.y); };
  for (const face of plan.faces) {
    for (let s = plan.s0; s <= plan.s1; s++) {
      const fr = face.frontages.find((x) => s >= x.s0 && s <= x.s1);
      const z = groundAt(planPoint(plan, s, (fr?.offsetM ?? face.offsetM) * face.side));
      if (z !== undefined) face.ground.push({ s, z: Math.round(z * 100) / 100 });
    }
    log(`  ${bearingWord(face.facing)} face: ${face.frontages.length} frontages, ${face.gaps.length} gaps${face.gaps.some((g) => g.road) ? ` (${face.gaps.filter((g) => g.road).map((g) => g.road).join(', ')})` : ''}, building line ${face.offsetM.toFixed(1)} m off the axis${face.hasSite ? ', the site' : ''}`);
  }

  const gkey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  let frames: ScapeFrame[] = [], framesNote: string | undefined;
  let elevations: (Elevation | null)[] | undefined, tileCredits: string[] | undefined, groundOffsetM: number | undefined;
  // `photo` (the default): Street View frames laid on the 3D tiles' meshes, true elevations with the photographs'
  // detail; `mesh`: the meshes' own textures; `montage`: the frames rectified onto each side's boundary, which is
  // also what a key without the Map Tiles API (one billed in the EEA) gets
  const source = opts.source ?? process.env.STREETSCAPE_SOURCE ?? 'photo';
  const tunnels = roads.filter((x) => x.tunnel).map((x) => x.coords);
  const secret = process.env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined;
  const fetchFrames = () => fetchStreetscapeFrames(plan, groundAt, dataDir, gkey!, secret, log, tunnels)
    .catch((e: any) => { log(`  WARN streetscape frames failed: ${e?.message ?? e}`); return [] as ScapeFrame[]; });
  if (gkey && source !== 'montage') {
    try {
      const sides = plan.faces.map((f) => f.side * (f.offsetM + SCAPE_DEPTH_M + 5));
      const at0: [number, number] = [plan.at0.x, plan.at0.y], axis: [number, number] = [plan.axis.x, plan.axis.y];
      const got = await fetchStreetTiles(gkey, centre, { at0, axis, s: [plan.s0 - 5, plan.s1 + 5], d: [Math.min(0, ...sides), Math.max(0, ...sides)], z: [-100, 700] }, SCAPE_TILE_ERROR_M, log);
      log(`  3D tiles: ${(got.tiles.reduce((t, x) => t + x.bytes.length, 0) / 1e6).toFixed(1)} MB, finest error ${got.finestErrorM.toFixed(2)} m`);
      if (source === 'photo' && dem) frames = await fetchFrames();
      log(`  drawing the faces${frames.length ? `, ${frames.length} Street View frames laid on the meshes` : ''}…`);
      elevations = await renderElevations(got.tiles, enuFrame(centre).matrix, plan.faces.map((f) => faceView(plan, f, frames)), dataDir, { ppm: SCAPE_PPM, background: SCAPE_SKY, log });
      for (const [i, e] of elevations.entries()) {
        if (!e) continue;
        groundOffsetM ??= e.offsetM;
        log(`  ${bearingWord(plan.faces[i].facing)} face: the meshes stand ${e.offsetM.toFixed(1)} m above AHD at the boundary${e.draped ? `; photographs hold ${Math.round(e.photoShare * 100)} % of it` : ''}`);
      }
      tileCredits = got.credits;
      if (!elevations.some(Boolean)) { elevations = undefined; log('  3D tiles: no face found its ground in the meshes'); }
    } catch (e: any) {
      log(`  3D tiles not drawn (${e?.message ?? e}); Street View frames rectified onto the boundaries instead`);
      elevations = undefined;
    }
  }
  if (elevations) { /* the faces are drawn */ }
  else if (!gkey) framesNote = 'Street View frames need GOOGLE_MAPS_API_KEY; the faces are drawn as their ground and frontages alone.';
  else if (!dem) framesNote = 'The elevation model did not answer, so the frames could not be set on the ground.';
  else if (!frames.length) frames = await fetchFrames();

  const bundle: StreetscapeBundle = {
    address, siteAddress: geo.matchedAddresses[0] ?? address, generatedAt: new Date().toISOString(),
    plan, elevations, tileCredits, groundOffsetM, frames, framesNote, demSource: dem?.source, warnings,
  };
  await writeFile(join(dataDir, 'streetscape_bundle.json'), JSON.stringify(bundle));
  return bundle;
}

const bearingWord = (deg: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];

/** How far behind its boundary a face's elevation sees: the street's own buildings, not the next street's. */
const SCAPE_DEPTH_M = 35;
/** The coarsest mesh the elevations take, metres of error: Google's finest over a city street. */
const SCAPE_TILE_ERROR_M = 0.6;
/** Pixels a metre: 300 dpi at 1:500. */
const SCAPE_PPM = 24;

/** A face's camera: on the centreline opposite the window's middle, square to the face, the ground sought on its footpath. */
function faceView(plan: StreetscapePlan, face: Face, frames: ScapeFrame[]): FaceView {
  const left = { x: -plan.axis.y, y: plan.axis.x };
  const at = (s: number, d: number): [number, number] => [plan.at0.x + plan.axis.x * s + left.x * d, plan.at0.y + plan.axis.y * s + left.y * d];
  const ds = plan.centreline.map((c) => c.d).sort((a, b) => a - b);
  const clip = ds[Math.floor(ds.length / 2)] ?? 0;
  const sMid = (plan.s0 + plan.s1) / 2;
  const rays: FaceView['rays'] = [];
  for (let s = plan.s0; s <= plan.s1; s++) {
    const fr = face.frontages.find((x) => s >= x.s0 && s <= x.s1);
    const [x, y] = at(s, face.side * Math.max(1, (fr?.offsetM ?? face.offsetM) - 1.5));
    rays.push({ s, x, y });
  }
  return {
    side: face.side, sMin: plan.s0, sMax: plan.s1,
    camera: at(sMid, clip), dir: [left.x * face.side, left.y * face.side],
    far: face.offsetM - face.side * clip + SCAPE_DEPTH_M, rays, dem: face.ground, boundary: face.offsetM,
    at0: [plan.at0.x, plan.at0.y], axis: [plan.axis.x, plan.axis.y],
    frames: frames.filter((fr) => fr.side === face.side).map((fr) => {
      const [x, y] = at(fr.s, fr.d);
      return { file: fr.file, x, y, zAhd: fr.z, s: fr.s, heading: fr.heading, pitch: fr.pitch, fov: fr.fov, px: FRAME_PX };
    }),
  };
}

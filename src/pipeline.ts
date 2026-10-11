// Orchestrates all fetches for one address and saves the data bundle.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geocode, type GeocodeResult } from './fetch/geocode.js';
import { fetchSiteLots, fetchRailCorridors, fetchZoning, fetchHeightOfBuilding, fetchHeritage, fetchSiteControls } from './fetch/nsw.js';
import { fetchRoads, fetchRailLines, fetchTrainStations, fetchParkPoints, fetchComplexPoints, fetchNamedAreas, fetchAllLots, fetchPropertiesAt, type TopoRoad, type NamedPoint, type RailLines, type NamedArea } from './fetch/nswTopo.js';
import { fetchAerial, type AerialResult } from './fetch/imagery.js';
import { fetchBusData, type BusData } from './fetch/osm.js';
import { fetchBusStopsTfnsw } from './fetch/tfnsw.js';
import { fetchIsochrones, type Isochrone } from './fetch/isochrones.js';
import { mercatorScaleFactor, mercatorToLonLat, lonLatToMercator, viewBounds, type Extent, type MapView } from './lib/geo.js';
import { queryByPoint, queryByExtent, type GeoJSONFC } from './lib/arcgis.js';
import { keywordCategory } from './render/model.js';
import { setTemplate } from './render/template.js';
import type { SummaryBundle } from './render/summarySheet.js';
import {
  fetchZoningDetailed, fetchHobDetailed, fetchHeritageDetailed, fetchShrCurtilages, fetchPolicyAreas,
  fetchWaterAreas, fetchPlanningContext, fetchPropertyReport, fetchHousingTarget,
  type PolicyArea, type PlanningContext, type PropertyReport, type HousingTarget,
} from './fetch/planning.js';
import { panelExtent, type Panel, type BaseData } from './render/minimap.js';
import { fetchCityOfSydneyDcp, type CityOfSydneyDcp } from './fetch/cityOfSydney.js';
import { fetchCouncilApplications, apiCouncilName, clipToExtent, PORTAL_MANDATED, type DaRecord } from './fetch/da.js';
import { fetchPlanningProposals, type PlanningProposal } from './fetch/planning.js';
import { fetchPeopleData, type PeopleData } from './fetch/people.js';
import { fetchDemGrid, type DemGrid } from './fetch/terrain.js';
import { fetchBuildings, withDaStoreys, type BuildingsData } from './fetch/buildings.js';
import { fetchMajorProjects, emptyMajorProjects, type MajorProjectsData } from './fetch/majorProjects.js';
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
// SITE ANALYSIS pipeline: a site-scale bundle (~1:200-1:500) with the site
// outline (lots unioned), contours for levels, neighbours and street
// furniture. Shares the geocode/lots/rotation logic with the context sheet.

import { fetchContours, fetchNeighbourAddresses, fetchSiteFurniture, emptyFurniture, type ContourLine, type ContourSet, type NeighbourAddress, type SiteFurniture } from './fetch/siteData.js';
import { fetchCouncilTrees, mergeTrees, TREE_SOURCES } from './fetch/trees.js';
import { assessViews, eyeAboveGround, type ViewTarget } from './fetch/views.js';
import { fetchCountry, EMPTY_COUNTRY, type CountryData } from './fetch/country.js';
import { fetchPhotos, emptyPhotos, type PhotosData } from './fetch/photos.js';
import { fetchLocation, emptyLocation, type LocationData } from './fetch/location.js';
import { fetchCharacter, emptyCharacter, type CharacterData } from './fetch/character.js';
import { fetchStrategies, emptyStrategies, type StrategiesData } from './fetch/strategies.js';
import { buildParkingBands, type ParkingBand } from './lib/parking.js';
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
  contours: ContourLine[];
  /** Interval and origin of the contours drawn (older bundles: 2 m, NSW). */
  contourIntervalM?: number;
  contourSource?: string;
  neighbours: NeighbourAddress[];
  furniture: SiteFurniture;
  /** Kerbside bays set out from the tagged runs and the cadastre. */
  parkingBands?: ParkingBand[];
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

  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  log('fetching contours, lots, roads, neighbours, furniture, trees, imagery…');
  const nswContours: ContourSet = { lines: [], intervalM: 2, source: 'NSW Spatial Services' };
  const noBuildings: BuildingsData = { source: 'none', buildings: [], fetchedAt: new Date().toISOString() };
  const [contourSet, allLots, roads, railLines, zoning, neighbours, furniture, aerial, councilTrees, parkPoints, controls, buildings] = await Promise.all([
    soft(fetchContours(extent, log), nswContours, 'contours'),
    soft(fetchAllLots(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'lots'),
    soft(fetchRoads(extent), [], 'roads'),
    soft(fetchRailLines(extent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchZoning(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'zoning'),
    soft(fetchNeighbourAddresses(extent), [], 'neighbour addresses'),
    soft(fetchSiteFurniture(extent), emptyFurniture(), 'street furniture (OSM)'),
    fetchAerial(extent, 3600, dataDir),
    soft(fetchCouncilTrees(extent, log), [], 'council trees'),
    soft(fetchParkPoints(extent), [], 'park points'),
    soft(fetchSiteControls(geo.center), null, 'site controls'),
    soft(fetchBuildings(extent, log), noBuildings, 'buildings'),
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

  log(`  contours:${contourSet.lines.length} (${contourSet.intervalM} m) lots:${allLots.features.length} roads:${roads.length} ` +
      `neighbours:${neighbours.length} trees:${furniture.trees.length} (council ${councilTrees.length}, osm ${osmTrees}) ` +
      `parking bays:${bays} car parks:${furniture.carParks.length} busStops:${busStops.length}`);

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
  ];

  const bundle: SiteBundle = {
    address, geocode: geo, extent, view, scale,
    siteLots, siteRing: ring, allLots, roads, railLines, zoning,
    contours: contourSet.lines, contourIntervalM: contourSet.intervalM, contourSource: contourSet.source,
    neighbours, furniture, parkingBands, views, eyeAboveM, attributions,
    busStops, buildings, aerial, generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dataDir, 'site_bundle.json'), JSON.stringify(bundle));
  return bundle;
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
  base: BaseData;
  controls: SiteControls;
  property: PropertyReport | null;
  context: PlanningContext;
  housingTarget: HousingTarget | null;
  /** Council's own DCP mapping, where a council publishes it (City of Sydney). */
  cos: CityOfSydneyDcp | null;
  /** The development-activity map is taller than a planning panel; same centre and scale. */
  daPanel: Panel;
  /** Applications lodged in the window, from the council-wide feed. */
  applications: DaRecord[];
  /** The Department's register of State significant applications for the council areas the window touches, those within 3 km with their points. */
  majorProjects: MajorProjectsData;
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
  const widePanel: Panel = { center: geo.center, scale: opts.wideScale ?? 16000, wMm: opts.wideWmm ?? 296, hMm: opts.wideHmm ?? 100 };
  const wideExtent = panelExtent(widePanel);
  // The site plan's panel: the lots fitted into a little over half of a tall panel at a round scale, centred on them.
  const sitePanel = fitSitePanel(siteLots, opts.panelWmm, opts.daPanelHmm);
  const blockPanel: Panel = { center: geo.center, scale: 4000, wMm: opts.panelWmm, hMm: opts.wideHmm ?? 100 };
  // The then-and-now pair: two half-width panels side by side at 1:2500, the 1943 survey and today's imagery over the same ground.
  const pairPanel: Panel = { center: geo.center, scale: 2500, wMm: (opts.panelWmm - 4) / 2, hMm: opts.panelHmm };
  // The location window: the whole figure field's width at 1:75,000, about 22 × 13 km, the 5 km ring well inside it.
  const locationPanel: Panel = { center: geo.center, scale: 75000, wMm: opts.wideWmm ?? 296, hMm: 170 };
  // Every fetch window is the larger of the two, so nothing is missing from either map.
  const fetchExtent: Extent = {
    xmin: Math.min(extent.xmin, daExtent.xmin), ymin: Math.min(extent.ymin, daExtent.ymin),
    xmax: Math.max(extent.xmax, daExtent.xmax), ymax: Math.max(extent.ymax, daExtent.ymax),
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
  const footprintsRead = soft(fetchBuildings(daExtent, log), { source: 'none' as const, buildings: [], fetchedAt: new Date().toISOString() }, 'buildings');
  const [zoning, hob, heritage, shr, policy, water, lots, roads, railLines, stations, context, property, controls, proposals, feed, people, dem, contourSet, buildingsRead, movement, green, constraints, site, wideRoads, wideRail, wideStations, wideWater, wideSuburbs, country, photos, location, majorProjects] = await Promise.all([
    soft(fetchZoningDetailed(extent), emptyFC, 'zoning'),
    soft(fetchHobDetailed(extent), emptyFC, 'height of building'),
    soft(fetchHeritageDetailed(extent), emptyFC, 'heritage'),
    soft(fetchShrCurtilages(extent), emptyFC, 'State Heritage Register'),
    fetchPolicyAreas(fetchExtent, log),
    soft(fetchWaterAreas(fetchExtent), emptyFC, 'water areas'),
    lotsRead,
    soft(fetchRoads(fetchExtent), [], 'roads'),
    soft(fetchRailLines(fetchExtent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchTrainStations(fetchExtent), [], 'stations'),
    fetchPlanningContext(geo.center, log),
    fetchPropertyReport(geo.matchedAddresses[0] ?? address, geo.center, log),
    fetchSiteControls(geo.center),
    fetchPlanningProposals(daExtent, log),
    council ? soft(fetchCouncilApplications(council, from, today, log), null, 'Online DA API') : Promise.resolve(null),
    soft(fetchPeopleData(mercatorToLonLat(geo.center), geo.matchedAddresses[0], log), null, 'people and market'),
    soft(fetchDemGrid(daExtent), null, 'elevation model'),
    soft(fetchContours(fetchExtent, log), { lines: [], intervalM: 2, source: 'NSW Spatial Services' }, 'contours'),
    footprintsRead,
    fetchMovement(daExtent, geo.center, log),
    soft(fetchGreenSpace(daExtent, wideExtent, log), emptyGreen, 'green and public domain'),
    soft(fetchConstraints(extent, mercatorToLonLat(geo.center), log), emptyConstraints, 'environmental constraints'),
    soft(fetchSiteData(sitePanel, blockPanel, siteLots, mercatorToLonLat(geo.center), dataDir, log), emptySite, 'site data'),
    soft(fetchRoads(wideExtent, 'roadnamebase IS NOT NULL AND functionhierarchy <= 5'), [], 'wide roads'),
    soft(fetchRailLines(wideExtent), { train: [], tram: [] }, 'wide rail lines'),
    soft(fetchTrainStations(wideExtent), [], 'wide stations'),
    soft(fetchWaterAreas(wideExtent), emptyFC, 'wide water areas'),
    soft(queryByExtent('https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/2', wideExtent, 'suburbname'), emptyFC, 'suburbs'),
    soft(fetchCountry(wideExtent, Math.round(((widePanel.wMm / 1000) * widePanel.scale) / 2), Math.round(((widePanel.hMm / 1000) * widePanel.scale) / 2), geo.center, dataDir, log), EMPTY_COUNTRY, 'Country'),
    soft(fetchPhotos({ centre: mercatorToLonLat(geo.center), siteRings: siteLots.features.flatMap((f) => geomRingsOf(f.geometry)), pairPanel, outDir: dataDir, log, lots: lotsRead.then((fc) => fc.features.flatMap((f) => geomRingsOf(f.geometry))), buildings: footprintsRead.then((bd) => bd.buildings.flatMap((x) => x.rings)) }), emptyPhotos(pairPanel), 'street-level frames and the 1943 aerial'),
    soft(fetchLocation(locationPanel, log), emptyLocation(locationPanel), 'location window'),
    // The Department's register of State significant applications: its listing for the council areas the window touches and each project's page, cached.
    soft(fetchMajorProjects(daExtent, geo.center, log), emptyMajorProjects('the register did not answer'), 'State significant applications'),
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
    soft(fetchCharacter({ centre: mercatorToLonLat(geo.center), suburb: context.suburb?.name ?? '', aerialExtent: extent, outDir: dataDir, log }), emptyCharacter(), 'character (Wikipedia, Commons)'),
    soft(fetchStrategies(geo.center, context.lga?.name, context.lga?.council, log), emptyStrategies(), 'strategic documents'),
  ]);
  const applications = feed ? clipToExtent(feed.records, daExtent) : [];
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
    zoning, hob, heritage, shr, policy,
    base: { water, lots, roads, rail: railLines, stations, siteLots },
    controls, property, context, housingTarget, cos,
    daPanel, applications, majorProjects, daMeta, proposals, people,
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

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
import { queryByPoint, type GeoJSONFC } from './lib/arcgis.js';
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
  zoning: GeoJSONFC;
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

  const emptyFurniture: SiteFurniture = { trees: [], hydrants: [], powerPoles: [], streetLamps: [], onewayRoads: [], buildings: [], utilities: [], driveways: [], parkingLanes: [] };
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });

  log('fetching contours, lots, roads, neighbours, furniture, imagery…');
  const [contours, allLots, roads, railLines, zoning, neighbours, furniture, aerial] = await Promise.all([
    soft(fetchContours(extent), [], 'contours'),
    soft(fetchAllLots(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'lots'),
    soft(fetchRoads(extent), [], 'roads'),
    soft(fetchRailLines(extent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchZoning(extent), { type: 'FeatureCollection', features: [] } as GeoJSONFC, 'zoning'),
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
    siteLots, siteRing: ring, allLots, roads, railLines, zoning, contours, neighbours, furniture,
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
  daMeta: { council: string; from: string; to: string; total: number; complete: boolean; fetchedAt: string } | null;
  proposals: PlanningProposal[];
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
  /** How far back the development-activity feed reaches (default five years, never before July 2021). */
  daYears?: number;
  log?: (msg: string) => void;
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

  const [zoning, hob, heritage, shr, policy, water, lots, roads, railLines, stations, context, property, controls, proposals, feed] = await Promise.all([
    soft(fetchZoningDetailed(extent), emptyFC, 'zoning'),
    soft(fetchHobDetailed(extent), emptyFC, 'height of building'),
    soft(fetchHeritageDetailed(extent), emptyFC, 'heritage'),
    soft(fetchShrCurtilages(extent), emptyFC, 'State Heritage Register'),
    fetchPolicyAreas(fetchExtent, log),
    soft(fetchWaterAreas(fetchExtent), emptyFC, 'water areas'),
    soft(fetchAllLots(fetchExtent), emptyFC, 'cadastral lots'),
    soft(fetchRoads(fetchExtent), [], 'roads'),
    soft(fetchRailLines(fetchExtent), { train: [], tram: [] }, 'rail lines'),
    soft(fetchTrainStations(fetchExtent), [], 'stations'),
    fetchPlanningContext(geo.center, log),
    fetchPropertyReport(geo.matchedAddresses[0] ?? address, geo.center, log),
    fetchSiteControls(geo.center),
    fetchPlanningProposals(daExtent, log),
    council ? soft(fetchCouncilApplications(council, from, today, log), null, 'Online DA API') : Promise.resolve(null),
  ]);
  const [housingTarget, cos] = await Promise.all([
    context.lga?.name ? fetchHousingTarget(context.lga.name) : Promise.resolve(null),
    // The one council with its DCP as open data so far; the hook is per LGA.
    context.lga?.name === 'SYDNEY' ? fetchCityOfSydneyDcp(extent, mercatorToLonLat(geo.center), log) : Promise.resolve(null),
  ]);
  const applications = feed ? clipToExtent(feed.records, daExtent) : [];
  const daMeta = feed ? { council: feed.council, from: feed.from, to: feed.to, total: feed.total, complete: feed.complete, fetchedAt: feed.fetchedAt } : null;

  log(`  zoning:${zoning.features.length} hob:${hob.features.length} heritage:${heritage.features.length} shr:${shr.features.length} ` +
      `policy:${policy.length} roads:${roads.length} property:${property ? 'yes' : 'no'} dcp:${context.dcp ? 'yes' : 'no'} target:${housingTarget ? housingTarget.homes : '—'}${cos ? ' council-dcp:yes' : ''} ` +
      `applications:${applications.length}${feed ? `/${feed.records.length}` : ''} proposals:${proposals.length}`);

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
    daPanel, applications, daMeta, proposals, warnings,
  };
  await writeFile(join(dataDir, 'slides_bundle.json'), JSON.stringify(bundle));
  return bundle;
}

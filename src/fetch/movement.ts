// How the site connects: walking isochrones (Valhalla), bus stops (TfNSW
// with a key, else OpenStreetMap), bus and tram routes, cycleways, footways
// and one-way streets (OpenStreetMap through Overpass, which the deployer's
// local instance answers), and the LEP's active street frontages
// (ePlanning). Each part fails alone; the slide names what is missing.

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import { overpassQuery } from '../lib/http.js';
import { extentToLonLatBbox, mercatorToLonLat, type Extent, type XY } from '../lib/geo.js';
import { fetchIsochrones, type Isochrone } from './isochrones.js';
import { fetchBusStopsTfnsw } from './tfnsw.js';

const DC = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer';

export type CyclewayKind = 'separated' | 'lane' | 'shared';

export interface MovementData {
  /** Walking isochrones from the site, 5, 10 and 15 minutes. */
  isochrones: Isochrone[];
  busStops: { name?: string; lon: number; lat: number }[];
  busStopSource: 'tfnsw' | 'osm' | 'none';
  /** Distinct bus route relations touching the window, and their way geometry. */
  busRouteCount: number;
  busRoutes: [number, number][][];
  tramRoutes: [number, number][][];
  cycleways: { kind: CyclewayKind; name?: string; coords: [number, number][] }[];
  /** Footways, paths, steps and pedestrian streets. */
  footways: [number, number][][];
  onewayRoads: { name?: string; coords: [number, number][] }[];
  /** Whether OpenStreetMap answered at all: without it the cycle, footway and one-way layers are unknown, not empty. */
  osm: boolean;
  /** LEP active street frontage polygons (ePlanning layer 224). */
  activeFrontages: GeoJSONFC;
  fetchedAt: string;
}

const EMPTY_FC: GeoJSONFC = { type: 'FeatureCollection', features: [] };

async function fromOsm(extent: Extent): Promise<Pick<MovementData, 'busStops' | 'busRouteCount' | 'busRoutes' | 'tramRoutes' | 'cycleways' | 'footways' | 'onewayRoads'>> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:90];
(
  node["highway"="bus_stop"](${bbox});
  relation["route"="bus"](${bbox});
  relation["route"~"^(tram|light_rail)$"](${bbox});
  way["highway"="cycleway"](${bbox});
  way["highway"]["cycleway"~"lane|track|share_busway|shared_lane|opposite"](${bbox});
  way["highway"]["cycleway:left"~"lane|track|share_busway"](${bbox});
  way["highway"]["cycleway:right"~"lane|track|share_busway"](${bbox});
  way["highway"]["cycleway:both"~"lane|track|share_busway"](${bbox});
  way["highway"~"^(footway|path|pedestrian|steps)$"](${bbox});
  way["highway"]["oneway"="yes"](${bbox});
);
out geom;`;
  const data = await overpassQuery(q);
  const out = { busStops: [] as MovementData['busStops'], busRouteCount: 0, busRoutes: [] as [number, number][][], tramRoutes: [] as [number, number][][], cycleways: [] as MovementData['cycleways'], footways: [] as [number, number][][], onewayRoads: [] as MovementData['onewayRoads'] };
  const busWays = new Set<number>(), tramWays = new Set<number>();
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.highway === 'bus_stop') out.busStops.push({ name: t.name, lon: el.lon, lat: el.lat });
      continue;
    }
    if (el.type === 'relation') {
      const isBus = t.route === 'bus', isTram = /^(tram|light_rail)$/.test(t.route ?? '');
      if (!isBus && !isTram) continue;
      if (isBus) out.busRouteCount++;
      for (const m of el.members ?? []) {
        if (m.type !== 'way' || !m.geometry) continue;
        const seen = isBus ? busWays : tramWays;
        if (seen.has(m.ref)) continue;
        seen.add(m.ref);
        (isBus ? out.busRoutes : out.tramRoutes).push(m.geometry.map((g: any) => [g.lon, g.lat]));
      }
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const coords: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat]);
    const cw = [t.cycleway, t['cycleway:left'], t['cycleway:right'], t['cycleway:both']].filter(Boolean).join(' ');
    if (t.highway === 'cycleway') out.cycleways.push({ kind: t.segregated === 'no' || t.foot === 'designated' ? 'shared' : 'separated', name: t.name, coords });
    else if (/track/.test(cw)) out.cycleways.push({ kind: 'separated', name: t.name, coords });
    else if (/lane|share_busway|opposite/.test(cw)) out.cycleways.push({ kind: 'lane', name: t.name, coords });
    else if (/shared_lane/.test(cw)) out.cycleways.push({ kind: 'shared', name: t.name, coords });
    if (/^(footway|path|pedestrian|steps)$/.test(t.highway ?? '') && t.footway !== 'sidewalk' && t.footway !== 'crossing') out.footways.push(coords);
    if (t.highway && t.oneway === 'yes' && !/^(footway|path|pedestrian|steps|cycleway)$/.test(t.highway)) out.onewayRoads.push({ name: t.name, coords });
  }
  return out;
}

export async function fetchMovement(extent: Extent, centre: XY, log: (m: string) => void = () => {}): Promise<MovementData> {
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const key = process.env.TFNSW_API_KEY?.trim();
  const [isochrones, osm, tfnswStops, activeFrontages] = await Promise.all([
    soft(fetchIsochrones(mercatorToLonLat(centre), [5, 10, 15]), [] as Isochrone[], 'walking isochrones'),
    soft(fromOsm(extent).then((o) => ({ ok: true as const, ...o })), null, 'OpenStreetMap movement layers'),
    key ? soft(fetchBusStopsTfnsw(extent, key), null, 'TfNSW bus stops') : Promise.resolve(null),
    soft(queryByExtent(`${DC}/224`, extent, 'EPI_NAME,LAY_CLASS,LGA_NAME'), EMPTY_FC, 'active street frontages'),
  ]);
  const busStops = tfnswStops && tfnswStops.length ? tfnswStops : osm?.busStops ?? [];
  const busStopSource: MovementData['busStopSource'] = tfnswStops && tfnswStops.length ? 'tfnsw' : osm?.busStops.length ? 'osm' : 'none';
  log(`  movement: isochrones:${isochrones.length} bus-stops:${busStops.length}/${busStopSource} routes:${osm?.busRouteCount ?? 0} cycleways:${osm?.cycleways.length ?? 0} footways:${osm?.footways.length ?? 0} one-way:${osm?.onewayRoads.length ?? 0} active-frontages:${activeFrontages.features.length}${osm ? '' : ' (OpenStreetMap unavailable)'}`);
  return {
    isochrones, busStops, busStopSource,
    busRouteCount: osm?.busRouteCount ?? 0, busRoutes: osm?.busRoutes ?? [], tramRoutes: osm?.tramRoutes ?? [],
    cycleways: osm?.cycleways ?? [], footways: osm?.footways ?? [], onewayRoads: osm?.onewayRoads ?? [],
    osm: Boolean(osm), activeFrontages, fetchedAt: new Date().toISOString(),
  };
}

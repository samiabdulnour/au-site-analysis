// How the site connects: walking isochrones (Valhalla), bus stops (TfNSW
// with a key, else OpenStreetMap), bus and tram routes, cycleways, footways
// and one-way streets (OpenStreetMap through Overpass, which the deployer's
// local instance answers), and the LEP's active street frontages
// (ePlanning). Each part fails alone; the slide names what is missing.

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import { overpassQuery } from '../lib/http.js';
import { extentToLonLatBbox, mercatorToLonLat, type Extent, type XY } from '../lib/geo.js';
import { fetchIsochrones, fetchRoute, type Isochrone, type RouteSummary } from './isochrones.js';
import { CENTRES, SYDNEY_CBD, CENTRE_KIND_WORD } from '../data/centres.js';
import { fetchBusStopsTfnsw } from './tfnsw.js';

const DC = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Development_Control/MapServer';

export type CyclewayKind = 'separated' | 'lane' | 'shared';

export interface MovementData {
  /** Walking isochrones from the site, 5, 10 and 15 minutes. */
  isochrones: Isochrone[];
  /** The reach in bands of three minutes to fifteen, for the map; absent from decks read before them. */
  isochronesFine?: Isochrone[];
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
  /** The off-street car parks OpenStreetMap maps in the window, with the capacity where it is tagged; absent from decks read before them. */
  parking?: CarParkPoint[];
  /** Journeys from the site to the centres by car and by bicycle, from the public router; absent from decks read before them. */
  journeys?: Journey[];
  /** LEP active street frontage polygons (ePlanning layer 224). */
  activeFrontages: GeoJSONFC;
  fetchedAt: string;
}

const EMPTY_FC: GeoJSONFC = { type: 'FeatureCollection', features: [] };

export interface CarParkPoint { lon: number; lat: number; name?: string; kind: string; capacity?: number; fee?: boolean; access?: string }
export interface Journey { to: string; kind: string; lon: number; lat: number; auto: RouteSummary | null; bicycle: RouteSummary | null }

/** The centres a site's journeys are timed to: the Sydney CBD, and the nearest CBD or major centre of the plan beyond 1.5 km that is not it. */
export function journeyTargets(centre: { lon: number; lat: number }): { name: string; kind: string; lon: number; lat: number }[] {
  const k = 111_320 * Math.cos((centre.lat * Math.PI) / 180);
  const dist = (c: { lon: number; lat: number }) => Math.hypot((c.lon - centre.lon) * k, (c.lat - centre.lat) * 110_574);
  const out = [{ name: SYDNEY_CBD.name, kind: CENTRE_KIND_WORD[SYDNEY_CBD.kind], lon: SYDNEY_CBD.lon, lat: SYDNEY_CBD.lat }];
  const near = CENTRES.filter((c) => (c.kind === 'cbd' || c.kind === 'major') && c.name !== SYDNEY_CBD.name && dist(c) > 1500).sort((a, b) => dist(a) - dist(b))[0];
  if (near) out.push({ name: near.name, kind: CENTRE_KIND_WORD[near.kind], lon: near.lon, lat: near.lat });
  return out;
}

/** The journeys from the site to its centres, by car and by bicycle. */
export async function fetchJourneys(centre: { lon: number; lat: number }): Promise<Journey[]> {
  const out: Journey[] = [];
  for (const tg of journeyTargets(centre)) {
    const [auto, bicycle] = await Promise.all([fetchRoute(centre, tg, 'auto').catch(() => null), fetchRoute(centre, tg, 'bicycle').catch(() => null)]);
    out.push({ to: tg.name, kind: tg.kind, lon: tg.lon, lat: tg.lat, auto, bicycle });
  }
  return out;
}

async function fromOsm(extent: Extent): Promise<Pick<MovementData, 'busStops' | 'busRouteCount' | 'busRoutes' | 'tramRoutes' | 'cycleways' | 'footways' | 'onewayRoads'> & { parking: CarParkPoint[] }> {
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
  node["amenity"="parking"](${bbox});
  way["amenity"="parking"](${bbox});
);
out geom;`;
  const data = await overpassQuery(q);
  const out = { busStops: [] as MovementData['busStops'], busRouteCount: 0, busRoutes: [] as [number, number][][], tramRoutes: [] as [number, number][][], cycleways: [] as MovementData['cycleways'], footways: [] as [number, number][][], onewayRoads: [] as MovementData['onewayRoads'], parking: [] as CarParkPoint[] };
  const carPark = (t: Record<string, string>, lon: number, lat: number): CarParkPoint => ({ lon, lat, name: t.name, kind: t.parking ?? 'surface', capacity: Number.isFinite(Number(t.capacity)) && Number(t.capacity) > 0 ? Number(t.capacity) : undefined, fee: t.fee ? t.fee !== 'no' : undefined, access: t.access });
  const busWays = new Set<number>(), tramWays = new Set<number>();
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.highway === 'bus_stop') out.busStops.push({ name: t.name, lon: el.lon, lat: el.lat });
      if (t.amenity === 'parking') out.parking.push(carPark(t, el.lon, el.lat));
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
    if (t.amenity === 'parking') { out.parking.push(carPark(t, coords.reduce((n, c) => n + c[0], 0) / coords.length, coords.reduce((n, c) => n + c[1], 0) / coords.length)); continue; }
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
  const [isochrones, osm, tfnswStops, activeFrontages, isochronesFine, journeys] = await Promise.all([
    soft(fetchIsochrones(mercatorToLonLat(centre), [5, 10, 15]), [] as Isochrone[], 'walking isochrones'),
    soft(fromOsm(extent).then((o) => ({ ok: true as const, ...o })), null, 'OpenStreetMap movement layers'),
    key ? soft(fetchBusStopsTfnsw(extent, key), null, 'TfNSW bus stops') : Promise.resolve(null),
    soft(queryByExtent(`${DC}/224`, extent, 'EPI_NAME,LAY_CLASS,LGA_NAME'), EMPTY_FC, 'active street frontages'),
    // the public router takes four contours a call at most, so the five bands come in two
    soft(Promise.all([fetchIsochrones(mercatorToLonLat(centre), [3, 6, 9]), fetchIsochrones(mercatorToLonLat(centre), [12, 15])]).then(([a, b2]) => [...a, ...b2].sort((x, y) => x.minutes - y.minutes)), [] as Isochrone[], 'walking bands'),
    soft(fetchJourneys(mercatorToLonLat(centre)), [] as Journey[], 'journeys to the centres'),
  ]);
  const busStops = tfnswStops && tfnswStops.length ? tfnswStops : osm?.busStops ?? [];
  const busStopSource: MovementData['busStopSource'] = tfnswStops && tfnswStops.length ? 'tfnsw' : osm?.busStops.length ? 'osm' : 'none';
  log(`  movement: isochrones:${isochrones.length} bus-stops:${busStops.length}/${busStopSource} routes:${osm?.busRouteCount ?? 0} cycleways:${osm?.cycleways.length ?? 0} footways:${osm?.footways.length ?? 0} one-way:${osm?.onewayRoads.length ?? 0} active-frontages:${activeFrontages.features.length}${osm ? '' : ' (OpenStreetMap unavailable)'}`);
  return {
    isochrones, isochronesFine, busStops, busStopSource, parking: osm?.parking ?? [], journeys,
    busRouteCount: osm?.busRouteCount ?? 0, busRoutes: osm?.busRoutes ?? [], tramRoutes: osm?.tramRoutes ?? [],
    cycleways: osm?.cycleways ?? [], footways: osm?.footways ?? [], onewayRoads: osm?.onewayRoads ?? [],
    osm: Boolean(osm), activeFrontages, fetchedAt: new Date().toISOString(),
  };
}

// Slide 01: the location window, about 22 × 13 km at 1:75,000 around the
// site, drawn from the State's own themes rather than a basemap picture so
// it reads at A3: the local government areas as the land (the harbour and
// the open sea are the unincorporated areas and the gaps between them),
// the water theme's bays, harbours and rivers, the railways, the arterial
// roads and above, the stations and the suburbs for their names. Every
// geometry is asked for generalised, since a lot boundary's detail means
// nothing at this scale.

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { panelExtent, type Panel } from '../render/minimap.js';
import { fetchTrainStations, type NamedPoint, type RailLines } from './nswTopo.js';
import { fetchDemGrid, type DemGrid } from './terrain.js';
import { fetchNpws, type NpwsReserve } from './greenSpace.js';

const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const ADMIN = `${PORTAL}/NSW_Administrative_Boundaries_Theme/FeatureServer`;
const WATER = `${PORTAL}/NSW_Water_Theme/FeatureServer`;
const TRANSPORT = `${PORTAL}/NSW_Transport_Theme/FeatureServer`;

/** Generalisation in degrees (the query answers in lon/lat): about 15 m and 25 m at Sydney's latitude. */
const OFFSET_FINE = '0.00015';
const OFFSET_COARSE = '0.00025';
/** Roads drawn at this scale: motorways, highways and the arterials (the theme's function hierarchy 1 to 3). */
const ROAD_HIERARCHY_MAX = 3;

export interface LocationArea { name: string; rings: number[][][] }
export interface LocationLga extends LocationArea { council: string; /** The harbour and the bay are "unincorporated" areas of the layer, water rather than land. */ unincorporated: boolean }
export interface LocationRoad { hierarchy: number; coords: number[][] }

export interface LocationData {
  panel: Panel;
  lgas: LocationLga[];
  /** Bays, harbours, rivers and ponds as polygons, largest first. */
  water: (LocationArea & { kind?: string })[];
  rail: RailLines;
  roads: LocationRoad[];
  stations: NamedPoint[];
  suburbs: LocationArea[];
  /** The region's relief, the elevation model at about 60 m a cell; absent from decks read before it. */
  dem?: DemGrid | null;
  /** The National Parks and Wildlife Service estate in the window: the bushland round the city; absent likewise. */
  npws?: NpwsReserve[];
  fetchedAt: string;
}

export const emptyLocation = (panel: Panel): LocationData => ({ panel, lgas: [], water: [], rail: { train: [], tram: [] }, roads: [], stations: [], suburbs: [], dem: null, npws: [], fetchedAt: new Date().toISOString() });

const ringsOf = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const linesOf = (g: any): number[][][] => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function areas(fc: GeoJSONFC, nameOf: (p: Record<string, any>) => string): LocationArea[] {
  const out: LocationArea[] = [];
  for (const f of fc.features) {
    const rings = ringsOf(f.geometry).filter((r) => r.length >= 4);
    if (rings.length) out.push({ name: nameOf(f.properties ?? {}), rings });
  }
  return out;
}

/** The window's layers, generalised for 1:75,000; cached a month per window, since none of them moves. */
export async function fetchLocation(panel: Panel, log: (m: string) => void = () => {}): Promise<LocationData> {
  const extent = panelExtent(panel);
  const key = `${panel.center.x.toFixed(0)}_${panel.center.y.toFixed(0)}_${panel.scale}_${panel.wMm}x${panel.hMm}_rel2`;
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> => p.catch((e) => { log(`  WARN location ${name} failed: ${e?.message ?? e}`); return fallback; });
  const emptyFc: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const t0 = Date.now();
  const data = await cachedJson<Omit<LocationData, 'panel'>>('location', key, 30 * DAY_MS, async () => {
    const [lgaFc, waterFc, railFc, roadFc, stations, suburbFc, dem, npws] = await Promise.all([
      soft(queryByExtent(`${ADMIN}/8`, extent, 'lganame,councilname', '1=1', { maxAllowableOffset: OFFSET_COARSE }), emptyFc, 'local government areas'),
      soft(queryByExtent(`${WATER}/6`, extent, 'hydroname,hydronametype,hydrotype', '1=1', { maxAllowableOffset: OFFSET_FINE }), emptyFc, 'water areas'),
      soft(queryByExtent(`${TRANSPORT}/7`, extent, 'classsubtype,relevance', '1=1', { maxAllowableOffset: OFFSET_FINE }), emptyFc, 'railways'),
      soft(queryByExtent(`${TRANSPORT}/5`, extent, 'functionhierarchy', `functionhierarchy <= ${ROAD_HIERARCHY_MAX}`, { maxAllowableOffset: OFFSET_FINE }), emptyFc, 'roads'),
      soft(fetchTrainStations(extent), [] as NamedPoint[], 'stations'),
      soft(queryByExtent(`${ADMIN}/2`, extent, 'suburbname', '1=1', { maxAllowableOffset: OFFSET_COARSE }), emptyFc, 'suburbs'),
      // the relief at about 60 m a cell: a few hundred cells across, enough for the plateaus and the valleys at 1:100 000
      soft(fetchDemGrid(extent, 60), null as DemGrid | null, 'relief'),
      soft(fetchNpws(extent), [] as NpwsReserve[], 'parks estate'),
    ]);
    const lgas: LocationLga[] = areas(lgaFc, (p) => String(p.lganame ?? '')).map((a, i) => ({ ...a, council: String(lgaFc.features[i]?.properties?.councilname ?? ''), unincorporated: /UNINCORPORATED/i.test(a.name) }));
    // the areas() helper keeps the feature order, but a feature without rings is dropped, so the council names are re-read by name
    const councilByName = new Map(lgaFc.features.map((f) => [String(f.properties?.lganame ?? ''), String(f.properties?.councilname ?? '')]));
    for (const l of lgas) l.council = councilByName.get(l.name) ?? l.council;
    const water = waterFc.features
      .map((f) => ({ name: [f.properties?.hydroname, f.properties?.hydronametype].filter(Boolean).join(' '), kind: f.properties?.hydronametype ? String(f.properties.hydronametype) : undefined, rings: ringsOf(f.geometry).filter((r) => r.length >= 4), area: 0 }))
      .filter((w) => w.rings.length)
      .map((w) => ({ ...w, area: w.rings.reduce((a, r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a + Math.abs(s); }, 0) }))
      .sort((a, b) => b.area - a.area)
      .map(({ area: _a, ...w }) => w);
    // The theme's `relevance` is its own level of detail: 1 on every named line, 10 on the yards, sidings and
    // extra tracks (and on the Metro's tunnels, so it cannot simply filter). Main lines first lets the map
    // thin parallel tracks against them (thinParallelLines in render/slides.ts).
    const rail: RailLines = { train: [], tram: [] };
    const railByRelevance = [...railFc.features].sort((a, b) => (Number(a.properties?.relevance) || 10) - (Number(b.properties?.relevance) || 10));
    for (const f of railByRelevance) for (const line of linesOf(f.geometry)) (f.properties?.classsubtype === 2 ? rail.tram : rail.train).push(line as [number, number][]);
    const roads: LocationRoad[] = [];
    for (const f of roadFc.features) for (const line of linesOf(f.geometry)) roads.push({ hierarchy: Number(f.properties?.functionhierarchy ?? ROAD_HIERARCHY_MAX), coords: line });
    const suburbs = areas(suburbFc, (p) => String(p.suburbname ?? ''));
    return { lgas, water, rail, roads, stations, suburbs, dem, npws, fetchedAt: new Date().toISOString() };
  });
  log(`  location: 1:${panel.scale} lgas:${data.lgas.length} water:${data.water.length} rail:${data.rail.train.length + data.rail.tram.length} roads:${data.roads.length} stations:${data.stations.length} suburbs:${data.suburbs.length} relief:${data.dem ? `${data.dem.cols}×${data.dem.rows}` : 'no'} parks:${data.npws?.length ?? 0} (${Math.round((Date.now() - t0) / 1000)} s)`);
  return { panel, ...data };
}

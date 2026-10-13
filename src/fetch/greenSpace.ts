// Green and public domain, for slide 10: the Greater Sydney tree canopy of
// 2022 by modified mesh block (canopy and vegetation-height shares, from
// 2 m Geoscape surface features), the land zoned for recreation and
// conservation, the Green Grid's existing assets (Greater Sydney), the
// named open-space and public-facility points, the NPWS estate, and a
// council's street trees where an inventory is open (the registry in
// trees.ts). Each part fails alone; the slide names what is missing.

import { queryByExtent, type GeoJSONFC, type GeoJSONFeature } from '../lib/arcgis.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { extentToLonLatBbox, type Extent } from '../lib/geo.js';
import { overpassQuery } from '../lib/http.js';
import { fetchVegetationMask, type VegetationMask } from './imagery.js';
import { titleCase } from './planning.js';
import { fetchCouncilTrees, mergeTrees, sourcesFor, treeFromOsm, type SiteTree } from './trees.js';

const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
const CANOPY = `${M3}/ePlanning/Planning_Portal_Tree_Canopy/MapServer/1`;
const PUBLIC_SPACES = `${M3}/ePlanning/Planning_Portal_Public_Spaces/MapServer`;
const ZONING = `${M3}/Planning/EPI_Primary_Planning_Layers/MapServer/2`;
const NPWS = `${M3}/Tenure/NPWS_AllManagedLand/MapServer/0`;
const FOI_COMPLEX = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Features_of_Interest_Category/FeatureServer/3';

/** The zones the slide reads as open space: public and private recreation, and the conservation zones. */
export const OPEN_SPACE_ZONES = ['RE1', 'RE2', 'C1', 'C2', 'C3'];

export interface CanopyBlock {
  /** Rings in lon/lat, generalised to about 3 m. */
  rings: number[][][];
  /** Tree canopy share of the block, per cent. */
  pct: number;
  /** All vegetation, and vegetation taller than 10 m, per cent. */
  vegPct: number;
  over10Pct: number;
  areaHa: number;
  /** The mesh block's land-use category (Residential, Road, Recreational, Commercial, Water…) and type. */
  cat: string;
  type: string;
}
export interface OpenSpaceZone { code: string; name: string; epi?: string; rings: number[][][] }
export interface GreenGridAsset { name: string; cls: string; significance: string; landStatus: string; rings: number[][][] }
export interface NamedPlace { name: string; kind: string; lon: number; lat: number }
export type FacilityKind = 'school' | 'childcare' | 'library' | 'community' | 'pool' | 'health' | 'culture';
export interface Facility { name: string; kind: FacilityKind; lon: number; lat: number; source: 'eplanning' | 'foi' }
export interface NpwsReserve { name: string; type: string; rings: number[][][] }
export interface StreetTree { lon: number; lat: number; canopyM: number; /** Mapped in OpenStreetMap rather than the council's inventory. */ osm?: boolean }

export interface GreenData {
  /** Mesh blocks over the wide strip. `covered` is false where the dataset (Greater Sydney) does not reach. */
  canopy: { blocks: CanopyBlock[]; covered: boolean; year: number; source: string };
  /** Over the tall panel, and over the wide strip for when the canopy does not reach. */
  openSpace: OpenSpaceZone[];
  openSpaceWide: OpenSpaceZone[];
  greenGrid: GreenGridAsset[];
  parkPoints: NamedPlace[];
  facilities: Facility[];
  npws: NpwsReserve[];
  /** The green of the aerial over the page: optional, decks read before it have none. */
  vegetation?: VegetationMask | null;
  trees: { points: StreetTree[]; source?: { name: string; attribution: string } };
  fetchedAt: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function allRings(g: GeoJSONFeature['geometry']): number[][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

function points(f: GeoJSONFeature): [number, number][] {
  const g = f.geometry;
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates as [number, number]];
  if (g.type === 'MultiPoint') return g.coordinates as [number, number][];
  return [];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

async function fetchCanopy(wideExtent: Extent, log: (m: string) => void): Promise<GreenData['canopy']> {
  const key = ['xmin', 'ymin', 'xmax', 'ymax'].map((k) => Math.round(wideExtent[k as keyof Extent])).join('_');
  return cachedJson('canopy', key, 30 * DAY_MS, async () => {
    const started = Date.now();
    const fc = await queryByExtent(CANOPY, wideExtent,
      'MMB_CAT,MMB_TYPE,area__ha_,Canopy_Percentage,All_Veg_Percentage,F_10_15m_Percent,Greater_than_15m_Percent',
      '1=1', { maxAllowableOffset: '0.00003' });
    const blocks: CanopyBlock[] = [];
    for (const f of fc.features) {
      const rings = allRings(f.geometry).map((r) => r.map(([x, y]) => [round6(x), round6(y)]));
      if (!rings.length) continue;
      const p = f.properties;
      blocks.push({
        rings,
        pct: Math.round(num(p.Canopy_Percentage) * 10) / 10,
        vegPct: Math.round(num(p.All_Veg_Percentage) * 10) / 10,
        over10Pct: Math.round((num(p.F_10_15m_Percent) + num(p.Greater_than_15m_Percent)) * 10) / 10,
        areaHa: Math.round(num(p.area__ha_) * 1000) / 1000,
        cat: String(p.MMB_CAT ?? ''), type: String(p.MMB_TYPE ?? ''),
      });
    }
    log(`  canopy: ${blocks.length} mesh blocks in ${Math.round((Date.now() - started) / 1000)} s`);
    return { blocks, covered: blocks.length > 0, year: 2022, source: 'Greater Sydney Tree Canopy Cover 2022 (NSW ePlanning), 2 m Geoscape surface features by modified mesh block' };
  });
}

const FACILITY_RULES: [FacilityKind, RegExp][] = [
  ['childcare', /\b(CHILD ?CARE|KINDERGARTEN|PRE-?SCHOOL|NURSERY SCHOOL|EARLY LEARNING|DAY ?CARE|OOSH|PLAYGROUP)\b/],
  ['school', /\b(SCHOOL|COLLEGE|GRAMMAR|TAFE|UNIVERSITY|CAMPUS|ACADEMY)\b/],
  ['library', /\bLIBRARY\b/],
  ['pool', /\b(POOL|AQUATIC|LEISURE CENTRE|SWIMMING|BATHS)\b/],
  ['health', /\b(HOSPITAL|HEALTH CENTRE|HEALTH SERVICE|MEDICAL CENTRE|COMMUNITY HEALTH|HOSPICE)\b/],
  ['culture', /\b(MUSEUM|GALLERY|THEATRE|ARTS? CENTRE|OBSERVATORY|CONSERVATORIUM|OPERA HOUSE)\b/],
  ['community', /\b(COMMUNITY|NEIGHBOURHOOD CENTRE|SENIOR CITIZENS|YOUTH CENTRE|SCOUT|GIRL GUIDES?|TOWN HALL|CIVIC CENTRE|COUNCIL CHAMBERS|PCYC|MEN'?S SHED)\b/],
];
const EPLANNING_KIND: Record<string, FacilityKind> = { Library: 'library', Museum: 'culture', 'Art Gallery': 'culture', Observatory: 'culture', 'Community Facility': 'community', Showground: 'community' };

/** Which kind of public facility a name describes, if any. */
export function facilityKind(name: string): FacilityKind | null {
  const u = name.toUpperCase();
  for (const [kind, re] of FACILITY_RULES) if (re.test(u)) return kind;
  return null;
}

const nameKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

async function fetchFacilities(extent: Extent): Promise<Facility[]> {
  const [ep, foi] = await Promise.all([
    queryByExtent(`${PUBLIC_SPACES}/262`, extent, 'POINAME,POITYPE'),
    queryByExtent(FOI_COMPLEX, extent, 'generalname,buildingcomplextype', 'generalname IS NOT NULL'),
  ]);
  const out: Facility[] = [];
  const seen = new Set<string>();
  for (const f of ep.features) {
    const kind = EPLANNING_KIND[String(f.properties.POITYPE ?? '')];
    const name = titleCase(f.properties.POINAME ?? '');
    const pt = points(f)[0];
    if (!kind || !name || !pt || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({ name, kind, lon: pt[0], lat: pt[1], source: 'eplanning' });
  }
  for (const f of foi.features) {
    const raw = String(f.properties.generalname ?? '');
    const kind = facilityKind(raw);
    const name = titleCase(raw);
    const pt = points(f)[0];
    if (!kind || !name || !pt || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({ name, kind, lon: pt[0], lat: pt[1], source: 'foi' });
  }
  return out;
}

async function fetchParkPointsNamed(extent: Extent): Promise<NamedPlace[]> {
  const fc = await queryByExtent(`${PUBLIC_SPACES}/260`, extent, 'POINAME,POITYPE');
  const out: NamedPlace[] = [];
  for (const f of fc.features) {
    const name = titleCase(f.properties.POINAME ?? '');
    const pt = points(f)[0];
    if (!name || !pt) continue;
    out.push({ name, kind: String(f.properties.POITYPE ?? ''), lon: pt[0], lat: pt[1] });
  }
  return out;
}

async function fetchGreenGrid(extent: Extent): Promise<GreenGridAsset[]> {
  const fc = await queryByExtent(`${PUBLIC_SPACES}/252`, extent, 'ASSET_NAME,LAY_CLASS,SIGNIFICANCE,LAND_STATUS');
  return fc.features.map((f) => ({
    name: String(f.properties.ASSET_NAME ?? '').trim(), cls: String(f.properties.LAY_CLASS ?? ''),
    significance: String(f.properties.SIGNIFICANCE ?? ''), landStatus: String(f.properties.LAND_STATUS ?? ''), rings: allRings(f.geometry),
  })).filter((a) => a.rings.length);
}

async function fetchOpenSpaceZones(extent: Extent): Promise<OpenSpaceZone[]> {
  const fc: GeoJSONFC = await queryByExtent(ZONING, extent, 'SYM_CODE,LAY_CLASS,EPI_NAME', `SYM_CODE IN (${OPEN_SPACE_ZONES.map((z) => `'${z}'`).join(',')})`);
  return fc.features.map((f) => ({ code: String(f.properties.SYM_CODE ?? ''), name: String(f.properties.LAY_CLASS ?? ''), epi: f.properties.EPI_NAME ? String(f.properties.EPI_NAME) : undefined, rings: allRings(f.geometry) }))
    .filter((z) => z.rings.length);
}

export async function fetchNpws(extent: Extent): Promise<NpwsReserve[]> {
  const fc = await queryByExtent(NPWS, extent, 'NAME,TYPE');
  return fc.features.map((f) => ({ name: String(f.properties.NAME ?? '').trim(), type: String(f.properties.TYPE ?? ''), rings: allRings(f.geometry) })).filter((r) => r.rings.length);
}

/** OpenStreetMap's mapped trees in the extent: the trees in yards, parks and lanes a council's street inventory leaves out. */
export async function fetchOsmTrees(extent: Extent): Promise<SiteTree[]> {
  const b = extentToLonLatBbox(extent);
  const data = await overpassQuery(`[out:json][timeout:90];node["natural"="tree"](${b.south},${b.west},${b.north},${b.east});out;`);
  return (data.elements ?? []).filter((el: any) => el.type === 'node').map((el: any) => treeFromOsm(el.lon, el.lat, el.tags ?? {}));
}

async function fetchStreetTrees(extent: Extent, log: (m: string) => void): Promise<GreenData['trees']> {
  const sources = sourcesFor(extent);
  // the council's inventory first, then OpenStreetMap's trees it does not already hold
  const [council, osm] = await Promise.all([
    sources.length ? fetchCouncilTrees(extent, log) : Promise.resolve([] as SiteTree[]),
    fetchOsmTrees(extent).catch((e) => { log(`  WARN OpenStreetMap trees failed: ${e?.message ?? e}`); return [] as SiteTree[]; }),
  ]);
  const trees = mergeTrees(council, osm);
  log(`  trees: ${council.length} council, ${trees.length - council.length} more from OpenStreetMap`);
  return {
    points: trees.map((t) => ({ lon: round6(t.lon), lat: round6(t.lat), canopyM: Math.round(t.canopyM * 10) / 10, osm: t.source === 'osm' || undefined })),
    source: sources.length ? { name: `${sources[0].name} and OpenStreetMap`, attribution: `${sources[0].attribution}; trees © OpenStreetMap contributors, ODbL` } : { name: 'OpenStreetMap', attribution: 'trees © OpenStreetMap contributors, ODbL' },
  };
}

/** Everything the green-and-public-domain slide draws, each part soft. */
export async function fetchGreenSpace(tallExtent: Extent, wideExtent: Extent, log: (m: string) => void = () => {}): Promise<GreenData> {
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const [canopy, openSpace, openSpaceWide, greenGrid, parkPoints, facilities, npws, trees] = await Promise.all([
    soft(fetchCanopy(wideExtent, log), { blocks: [], covered: false, year: 2022, source: 'Greater Sydney Tree Canopy Cover 2022 (NSW ePlanning)' }, 'tree canopy'),
    soft(fetchOpenSpaceZones(tallExtent), [], 'open-space zoning'),
    soft(fetchOpenSpaceZones(wideExtent), [], 'wide open-space zoning'),
    soft(fetchGreenGrid(tallExtent), [], 'Green Grid assets'),
    soft(fetchParkPointsNamed(tallExtent), [], 'open-space points'),
    soft(fetchFacilities(tallExtent), [], 'public facilities'),
    soft(fetchNpws(tallExtent), [], 'NPWS estate'),
    soft(fetchStreetTrees(tallExtent, log), { points: [] }, 'street trees'),
  ]);
  log(`  green: canopy:${canopy.blocks.length}${canopy.covered ? '' : ' (not covered)'} open-space:${openSpace.length} green-grid:${greenGrid.length} parks:${parkPoints.length} facilities:${facilities.length} npws:${npws.length} trees:${trees.points.length}`);
  return { canopy, openSpace, openSpaceWide, greenGrid, parkPoints, facilities, npws, trees, fetchedAt: new Date().toISOString() };
}

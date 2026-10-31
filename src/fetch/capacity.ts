// The layers the capacity and opportunity slide reads beyond the deck's own:
// the cadastre's property register (one row per address, whose unit
// addresses size each strata scheme), the lots with the date their plan was
// recorded (the plan's registration date for anything after the digital
// cadastre was built in September 1993), State government land, and, where
// a council publishes one as open data, its development register and its
// parks and facilities. The City of Sydney does; the hook is per LGA.

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import { mercatorScaleFactor, mercatorToLonLat, type Extent } from '../lib/geo.js';
import { panelExtent, type Panel } from '../render/minimap.js';
import { registerRecords, type FacilityPoint, type PublicLand, type RegisterRecord } from '../lib/capacity.js';

const CADASTRE = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer';
const STATE_LAND = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_GPI/MapServer/302';

/** A council's open data: its development register, its parks and its facilities, as ArcGIS layers. */
interface CouncilLayers { name: string; register: string; registerFields: string; parks?: string; facilities?: string }
const COS = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services';
const COUNCIL_LAYERS: Record<string, CouncilLayers> = {
  SYDNEY: {
    name: 'City of Sydney development monitoring register',
    register: `${COS}/Development_Monitoring/FeatureServer/0`,
    registerFields: 'StNumber,StName,Suburb,MajorUse,DA_Number,DevelopmentType,Lodged,Determined,Completion,Status_1,Priv_Dwgs,LevelsAbove,GFA,DateExtracted',
    parks: `${COS}/Parks/FeatureServer/0`,
    facilities: `${COS}/CouncilFacilities/FeatureServer/0`,
  },
};

export interface CapacityData {
  /** The window the study is drawn in: one A4 page at 1:2000. */
  panel: Panel;
  properties: GeoJSONFC;
  lots: GeoJSONFC;
  stateLand: PublicLand[];
  councilLand: PublicLand[];
  facilities: FacilityPoint[];
  register: RegisterRecord[];
  /** The council register read, and the date of its extract, where one exists. */
  registerSource?: string;
  registerExtract?: string;
  fetchedAt: string;
}

const ringsOf = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const empty: GeoJSONFC = { type: 'FeatureCollection', features: [] };

export async function fetchCapacityData(panel: Panel, lgaName: string | undefined, log: (m: string) => void = () => {}): Promise<CapacityData> {
  const extent: Extent = panelExtent(panel);
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> => p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const council = lgaName ? COUNCIL_LAYERS[lgaName.toUpperCase()] : undefined;
  const [properties, lots, state, register, parks, facilities] = await Promise.all([
    soft(queryByExtent(`${CADASTRE}/12`, extent, 'propid,address,valnetpropertytype,valnetlotcount'), empty, 'property register'),
    soft(queryByExtent(`${CADASTRE}/8`, extent, 'lotidstring,planlabel,classsubtype,createdate'), empty, 'lots with their plan dates'),
    soft(queryByExtent(STATE_LAND, extent, 'LOTREF'), empty, 'State government land'),
    council ? soft(queryByExtent(council.register, extent, council.registerFields), empty, council.name) : Promise.resolve(empty),
    council?.parks ? soft(queryByExtent(council.parks, extent, 'Name'), empty, 'council parks') : Promise.resolve(empty),
    council?.facilities ? soft(queryByExtent(council.facilities, extent, 'Name'), empty, 'council facilities') : Promise.resolve(empty),
  ]);
  const records = registerRecords(register);
  const extract = records.map((r) => r.extracted ?? '').filter(Boolean).sort().pop();
  log(`  capacity: ${properties.features.length} register rows, ${lots.features.length} lots, ${state.features.length} State parcels${council ? `, ${records.length} on the council's register, ${parks.features.length} parks, ${facilities.features.length} facilities` : ''}`);
  return {
    panel, properties, lots,
    stateLand: state.features.map((f) => ({ kind: 'state' as const, name: f.properties.LOTREF ? String(f.properties.LOTREF) : undefined, rings: ringsOf(f.geometry) })).filter((l) => l.rings.length),
    councilLand: parks.features.map((f) => ({ kind: 'council' as const, name: f.properties.Name ? String(f.properties.Name) : undefined, rings: ringsOf(f.geometry) })).filter((l) => l.rings.length),
    facilities: facilities.features.filter((f) => f.geometry?.type === 'Point').map((f) => ({ name: String(f.properties.Name ?? ''), lon: f.geometry!.coordinates[0], lat: f.geometry!.coordinates[1] })),
    register: records, registerSource: council?.name, registerExtract: extract,
    fetchedAt: new Date().toISOString(),
  };
}

/** A panel over an extent at a scale, for reading the capacity layers over a window that is not a page. */
export function extentPanel(extent: Extent, scale = 1000): Panel {
  const center = { x: (extent.xmin + extent.xmax) / 2, y: (extent.ymin + extent.ymax) / 2 };
  const k = mercatorScaleFactor(mercatorToLonLat(center).lat);
  return { center, scale, wMm: ((extent.xmax - extent.xmin) / k / scale) * 1000, hMm: ((extent.ymax - extent.ymin) / k / scale) * 1000 };
}

// City of Sydney open data (data.cityofsydney.nsw.gov.au). Council's own
// mapping of its DCP — building height in storeys, street frontage heights,
// active frontages, setbacks — which no statewide layer carries. Only asked
// when the site is in that local government area; everywhere else the DCP
// stays a link. Same ArcGIS REST shape as the state services.

import { queryByExtent } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, type Extent, type LonLat } from '../lib/geo.js';
import { geomRings, pointInRing } from './planning.js';

const SDCP = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Sydney_Development_Control_Plan_2012/FeatureServer';

export interface CityOfSydneyDcp {
  /** Building height in storeys where the DCP maps it at the site. */
  storeysAtSite?: string;
  /** Distinct storey values mapped in the window, for a later map panel. */
  storeysInWindow: string[];
  /** Street frontage heights (storeys) mapped within ~40 m of the site. */
  frontageHeightsNearSite: string[];
  activeFrontageNearSite: boolean;
  setbacksNearSite: string[];
  /** Which DCP maps answered (e.g. "Sydney DCP 2012 - Green Square Setbacks"). */
  dcpNames: string[];
  source: string;
}

export async function fetchCityOfSydneyDcp(
  extent: Extent,
  site: LonLat,
  log: (m: string) => void = () => {},
): Promise<CityOfSydneyDcp | null> {
  const m = lonLatToMercator(site);
  const k = mercatorScaleFactor(site.lat);
  const r = 40 * k;
  const near: Extent = { xmin: m.x - r, ymin: m.y - r, xmax: m.x + r, ymax: m.y + r };
  const soft = async (layer: number, ext: Extent, fields: string) => {
    try { return (await queryByExtent(`${SDCP}/${layer}`, ext, fields)).features; }
    catch (e: any) { log(`  WARN City of Sydney DCP layer ${layer} failed: ${e?.message ?? e}`); return []; }
  };
  const [storeys, frontage, active, setbacks] = await Promise.all([
    soft(7, extent, 'DCP_Name,Storeys'),
    soft(5, near, 'DCP_Name,Storeys'),
    soft(0, near, 'DCP_Name'),
    soft(3, near, 'DCP_Name,SetbackType'),
  ]);
  if (!storeys.length && !frontage.length && !active.length && !setbacks.length) return null;

  const names = new Set<string>();
  const note = (f: { properties: Record<string, any> }) => { if (f.properties.DCP_Name) names.add(String(f.properties.DCP_Name)); };
  let storeysAtSite: string | undefined;
  const inWindow = new Set<string>();
  for (const f of storeys) {
    note(f);
    const v = String(f.properties.Storeys ?? '').trim();
    if (!v) continue;
    inWindow.add(v);
    if (!storeysAtSite && geomRings(f.geometry).some((ring) => pointInRing(site.lon, site.lat, ring))) storeysAtSite = v;
  }
  frontage.forEach(note); active.forEach(note); setbacks.forEach(note);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    storeysAtSite,
    storeysInWindow: [...inWindow].sort((a, b) => Number(a) - Number(b)),
    frontageHeightsNearSite: uniq(frontage.map((f) => String(f.properties.Storeys ?? '').trim())).sort((a, b) => Number(a) - Number(b)),
    activeFrontageNearSite: active.length > 0,
    setbacksNearSite: uniq(setbacks.map((f) => String(f.properties.SetbackType ?? '').trim())),
    dcpNames: [...names],
    source: 'City of Sydney open data — Sydney DCP 2012 layers',
  };
}

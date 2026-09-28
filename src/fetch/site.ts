// The site itself, for slide 11: the aerial under the site plan and its
// capture date, the lots' plan details, the cadastre's easements, the
// neighbours' house numbers, and the State government and Crown land in
// the block around it. The controls, the land values, the sales, the
// buildings and the levels come from what the other slides already fetch.

import { queryByExtent, queryByPoint, queryWhere, type GeoJSONFC } from '../lib/arcgis.js';
import { lonLatToMercator, type LonLat } from '../lib/geo.js';
import { fetchAerial, type AerialResult } from './imagery.js';
import { fetchNeighbourAddresses, type NeighbourAddress } from './siteData.js';
import { geomRings } from './planning.js';
import { panelExtent, type Panel } from '../render/minimap.js';

const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const CADASTRE = `${PORTAL}/NSW_Land_Parcel_Property_Theme/FeatureServer`;
const IMAGERY_DATES = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery_Dates/MapServer/0';
const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning';
const STATE_LAND = `${M3}/Planning_Portal_GPI/MapServer/302`;
const CROWN_LAND = `${M3}/Planning_Portal_Crown_Land/MapServer/258`;
const CROWN_RESERVES = `${M3}/Planning_Portal_Crown_Land/MapServer/312`;

export interface SiteLotDetail { lotid: string; lotNumber?: string; section?: string; plan?: string; planAreaSqm?: number; stratum: boolean }
export interface Easement { type?: string; widthM?: number; rings: number[][][] }
export interface PublicParcel { label: string; kind: 'state' | 'crown' | 'reserve'; detail?: string; areaHa?: number; rings: number[][][] }

export interface SiteData {
  /** The site plan's panel: the lot fitted at a round scale. */
  sitePanel: Panel;
  /** The block panel around the site, for the sales and the public land. */
  blockPanel: Panel;
  aerial: AerialResult | null;
  imagery: { block: string; type: string; date?: string; resolutionCm?: number } | null;
  lots: SiteLotDetail[];
  easements: Easement[];
  neighbours: NeighbourAddress[];
  publicLand: PublicParcel[];
  fetchedAt: string;
}

const num = (v: unknown): number | undefined => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
const isoDate = (ms: unknown) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : undefined; };

async function fetchImageryDate(centre: LonLat): Promise<SiteData['imagery']> {
  const fc = await queryByPoint(IMAGERY_DATES, lonLatToMercator(centre), 'BlockName,BlockType,BlockStartDate,Resolution_cm');
  const p = fc.features[0]?.properties;
  if (!p) return null;
  return { block: String(p.BlockName ?? ''), type: String(p.BlockType ?? ''), date: isoDate(p.BlockStartDate), resolutionCm: num(p.Resolution_cm) };
}

async function fetchLotDetails(siteLots: GeoJSONFC): Promise<SiteLotDetail[]> {
  const ids = [...new Set(siteLots.features.map((f) => String(f.properties?.lotidstring ?? '')).filter(Boolean))];
  if (!ids.length) return [];
  const fc = await queryWhere(`${CADASTRE}/8`, `lotidstring IN (${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')})`, 'lotidstring,lotnumber,sectionnumber,planlabel,planlotarea,planlotareaunits,stratumlevel');
  const seen = new Set<string>();
  const out: SiteLotDetail[] = [];
  for (const f of fc.features) {
    const p = f.properties;
    const lotid = String(p.lotidstring ?? '');
    if (!lotid || seen.has(lotid)) continue;
    seen.add(lotid);
    const area = num(p.planlotarea);
    const units = String(p.planlotareaunits ?? '').toLowerCase();
    out.push({
      lotid, lotNumber: p.lotnumber ? String(p.lotnumber) : undefined, section: p.sectionnumber ? String(p.sectionnumber) : undefined, plan: p.planlabel ? String(p.planlabel) : undefined,
      planAreaSqm: area === undefined ? undefined : /ha|hectare/.test(units) ? area * 1e4 : area,
      stratum: Number(p.stratumlevel ?? 0) !== 0,
    });
  }
  return out;
}

async function fetchEasements(panel: Panel): Promise<Easement[]> {
  const fc = await queryByExtent(`${CADASTRE}/9`, panelExtent(panel), 'easementtype,easementwidth,classsubtype');
  return fc.features.map((f) => ({ type: f.properties.easementtype != null ? String(f.properties.easementtype) : undefined, widthM: num(f.properties.easementwidth), rings: geomRings(f.geometry) })).filter((e) => e.rings.length);
}

async function fetchPublicLand(panel: Panel, log: (m: string) => void): Promise<PublicParcel[]> {
  const extent = panelExtent(panel);
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> => p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const empty: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const [state, crown, reserves] = await Promise.all([
    soft(queryByExtent(STATE_LAND, extent, 'LOTREF,SOURCE,PLANLABEL'), empty, 'State government land'),
    soft(queryByExtent(CROWN_LAND, extent, 'Area_H,DISPOSALSTATUS'), empty, 'Crown land'),
    soft(queryByExtent(CROWN_RESERVES, extent, 'reserve_name,purpose,reserve_type,reserve_no'), empty, 'Crown reserves'),
  ]);
  const out: PublicParcel[] = [];
  const lotRef = (ref: unknown, plan: unknown) => { const m = String(ref ?? '').match(/^([^/]*)\/([^/]*)\/(.+)$/); return m ? `Lot ${m[1]}${m[2] && m[2] !== '-' ? ` Sec ${m[2]}` : ''} ${m[3].replace(/^([A-Z]+)(\d)/, '$1 $2')}` : String(plan ?? 'State land'); };
  for (const f of state.features) { const rings = geomRings(f.geometry); if (rings.length) out.push({ kind: 'state', label: lotRef(f.properties.LOTREF, f.properties.PLANLABEL), detail: String(f.properties.SOURCE ?? ''), rings }); }
  for (const f of crown.features) { const rings = geomRings(f.geometry); if (rings.length) out.push({ kind: 'crown', label: 'Crown land', areaHa: num(f.properties.Area_H), rings }); }
  for (const f of reserves.features) { const rings = geomRings(f.geometry); if (rings.length) out.push({ kind: 'reserve', label: String(f.properties.reserve_name ?? `Crown reserve ${f.properties.reserve_no ?? ''}`).trim(), detail: [f.properties.reserve_type, f.properties.purpose].filter(Boolean).join(' · '), rings }); }
  return out;
}

/** The site's own data: the aerial and its date, the lots, the easements, the neighbours, the public land around. */
export async function fetchSiteData(sitePanel: Panel, blockPanel: Panel, siteLots: GeoJSONFC, centre: LonLat, dataDir: string, log: (m: string) => void = () => {}): Promise<SiteData> {
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> => p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const [aerial, imagery, lots, easements, neighbours, publicLand] = await Promise.all([
    soft(fetchAerial(panelExtent(sitePanel), 2400, dataDir, 'site_aerial'), null, 'site aerial'),
    soft(fetchImageryDate(centre), null, 'imagery date'),
    soft(fetchLotDetails(siteLots), [], 'lot details'),
    soft(fetchEasements(sitePanel), [], 'easements'),
    soft(fetchNeighbourAddresses(panelExtent(sitePanel)), [], 'neighbour addresses'),
    fetchPublicLand(blockPanel, log),
  ]);
  log(`  site: 1:${sitePanel.scale} aerial:${aerial ? `${aerial.tiles.length} tiles` : 'no'}${imagery?.date ? ` (${imagery.date}, ${imagery.resolutionCm ?? '?'} cm)` : ''} lots:${lots.length} easements:${easements.length} neighbours:${neighbours.length} public-land:${publicLand.length}`);
  return { sitePanel, blockPanel, aerial, imagery, lots, easements, neighbours, publicLand, fetchedAt: new Date().toISOString() };
}

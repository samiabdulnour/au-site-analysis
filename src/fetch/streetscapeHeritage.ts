// The streetscape's heritage: which conservation area each metre of a face
// stands in, which of the LEP's heritage items front it, and how the council's
// DCP rates each building's contribution to its conservation area
// (contributing, neutral or detracting). Each is read where the face's
// buildings stand, a few metres behind each frontage's boundary. The areas and
// items are the state's LEP layer, everywhere in NSW; the ratings are the City
// of Sydney's DCP 2012 map, so only there.

import { queryByExtent } from '../lib/arcgis.js';
import { lonLatToMercator, type Extent } from '../lib/geo.js';
import type { GeoJSONFeature } from '../lib/arcgis.js';
import { geomRings, pointInRing } from './planning.js';
import { planPoint, type StreetscapePlan } from './streetscape.js';

const LEP_HERITAGE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/0';
const SDCP_CONTRIBUTIONS = 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Sydney_Development_Control_Plan_2012/FeatureServer/2';
/** How far behind a frontage's boundary its building is read, metres. */
const BEHIND_M = 3;

export type Contribution = 'Contributing' | 'Neutral' | 'Detracting';
export interface FrontageHeritage { s0: number; s1: number; rating?: Contribution; item?: { id: string; name: string; significance?: string } }
export interface AreaRun { s0: number; s1: number; id: string; name: string }
export interface FaceHeritage { side: 1 | -1; frontages: FrontageHeritage[]; areas: AreaRun[] }
export interface StreetscapeHeritage { faces: FaceHeritage[]; plan: string; ratings?: string }

/** Whether a polygon feature holds a point: inside an odd number of its rings, so a courtyard's hole is outside. */
const holds = (f: GeoJSONFeature, lon: number, lat: number) => geomRings(f.geometry).filter((r) => pointInRing(lon, lat, r)).length % 2 === 1;

export async function fetchStreetscapeHeritage(plan: StreetscapePlan, log: (m: string) => void = () => {}): Promise<StreetscapeHeritage | null> {
  // the window and its faces' depth, as a box in web mercator
  const reach = Math.max(...plan.faces.map((f) => f.offsetM)) + 40;
  const corners = [plan.s0, plan.s1].flatMap((s) => [-reach, reach].map((d) => lonLatToMercator(planPoint(plan, s, d))));
  const extent: Extent = { xmin: Math.min(...corners.map((c) => c.x)), ymin: Math.min(...corners.map((c) => c.y)), xmax: Math.max(...corners.map((c) => c.x)), ymax: Math.max(...corners.map((c) => c.y)) };
  const soft = async (url: string, fields: string, where: string) => {
    try { return (await queryByExtent(url, extent, fields, where)).features; }
    catch (e) { log(`  WARN heritage layer failed: ${(e as Error).message}`); return null; }
  };
  const [lep, dcp] = await Promise.all([
    soft(LEP_HERITAGE, 'LAY_CLASS,H_NAME,H_ID,SIG,EPI_NAME', "LAY_CLASS LIKE 'Item%' OR LAY_CLASS LIKE 'Conservation Area%'"),
    soft(SDCP_CONTRIBUTIONS, 'ContributionType,ConservationArea', '1=1'),
  ]);
  if (!lep && !dcp) return null;
  const items = (lep ?? []).filter((f) => /^Item/i.test(String(f.properties.LAY_CLASS)));
  const areas = (lep ?? []).filter((f) => /^Conservation Area/i.test(String(f.properties.LAY_CLASS)));
  const ratings = dcp ?? [];

  const faces = plan.faces.map((face): FaceHeritage => {
    const at = (s: number, offsetM: number) => planPoint(plan, s, face.side * (offsetM + BEHIND_M));
    const frontages = face.frontages.map((fr): FrontageHeritage => {
      const a = Math.min(fr.s0, fr.s1), b = Math.max(fr.s0, fr.s1);
      // every two metres along it, at least three
      const n = Math.max(3, Math.round((b - a) / 2));
      const pts = Array.from({ length: n }, (_, i) => at(a + ((i + 0.5) * (b - a)) / n, fr.offsetM));
      const votes = new Map<Contribution, number>();
      for (const p of pts) {
        const r = ratings.find((f) => holds(f, p.lon, p.lat))?.properties.ContributionType as Contribution | undefined;
        if (r === 'Contributing' || r === 'Neutral' || r === 'Detracting') votes.set(r, (votes.get(r) ?? 0) + 1);
      }
      const rating = [...votes.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      const it = items.find((f) => pts.some((p) => holds(f, p.lon, p.lat)));
      return { s0: fr.s0, s1: fr.s1, ...(rating ? { rating } : {}), ...(it ? { item: { id: String(it.properties.H_ID ?? ''), name: String(it.properties.H_NAME ?? ''), significance: it.properties.SIG ? String(it.properties.SIG) : undefined } } : {}) };
    });
    // the conservation areas, metre by metre behind the side's building line, as runs
    const runs: AreaRun[] = [];
    for (let s = Math.ceil(plan.s0); s <= Math.floor(plan.s1); s++) {
      const p = at(s, face.offsetM);
      const f = areas.find((x) => holds(x, p.lon, p.lat));
      const last = runs[runs.length - 1];
      if (!f) continue;
      const id = String(f.properties.H_ID ?? ''), name = String(f.properties.H_NAME ?? '').trim();
      if (last && last.id === id && s - last.s1 <= 1.01) last.s1 = s;
      else runs.push({ s0: s, s1: s, id, name });
    }
    return { side: face.side, frontages, areas: runs.filter((r) => r.s1 - r.s0 >= 5) };
  });
  const epi = (lep ?? []).map((f) => String(f.properties.EPI_NAME ?? '')).find(Boolean) ?? 'the LEP';
  log(`  heritage: ${faces.map((f) => `${f.frontages.filter((x) => x.rating).length} rated, ${f.frontages.filter((x) => x.item).length} items`).join(' / ')}${faces.some((f) => f.areas.length) ? `; in ${[...new Set(faces.flatMap((f) => f.areas.map((a) => `${a.name} (${a.id})`)))].join(', ')}` : ''}`);
  return { faces, plan: epi, ...(ratings.length ? { ratings: 'Sydney DCP 2012, building contributions (City of Sydney)' } : {}) };
}

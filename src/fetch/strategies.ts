// Slide 05: the strategic documents that sit over the site, named and
// linked, one line each. The regional plan comes from the point (the
// Department's planning-regions layer names it), the local strategic
// planning statement from the Planning Portal's index of every council's
// LSPS (an HTML page, parsed and cached), the plan and the DCP from what
// the deck already read at the site. The extracts stay the author's.

import { retryFetch, USER_AGENT } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { queryByPoint } from '../lib/arcgis.js';
import type { XY } from '../lib/geo.js';

const REGIONS_LAYER = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Administrative_Boundary/MapServer/2';
const LSPS_INDEX = 'https://www.planningportal.nsw.gov.au/local-strategic-planning-statements';
const PLANS_BY_REGION = 'https://www.planning.nsw.gov.au/plans-in-nsw/plans-by-region';
const UA = USER_AGENT;

export interface RegionalPlan { region: string; name: string; url: string; year?: number; note?: string }

/**
 * The regional plans as the Department lists them (plans-in-nsw/plans-by-region,
 * September 2026). The Sydney Plan replaced the Greater Sydney Region Plan and
 * the five district plans on 13 August 2026; the rest are the 2041 regional
 * plans and the region pages that hold the older ones.
 */
export const REGIONAL_PLANS: RegionalPlan[] = [
  { region: 'Greater Sydney', name: 'The Sydney Plan', year: 2026, url: `${PLANS_BY_REGION}/the-sydney-plan`, note: 'commenced 13 August 2026; replaces the Greater Sydney Region Plan (A Metropolis of Three Cities, 2018) and the five district plans' },
  { region: 'Central Coast', name: 'Central Coast Regional Plan 2041', year: 2022, url: `${PLANS_BY_REGION}/central-coast` },
  { region: 'Central West and Orana', name: 'Central West and Orana Regional Plan 2041', year: 2022, url: `${PLANS_BY_REGION}/central-west-and-orana-regional-plan-2041` },
  { region: 'Far West', name: 'Far West Regional Plan 2036', year: 2017, url: `${PLANS_BY_REGION}/far-west` },
  { region: 'Hunter', name: 'Hunter Regional Plan 2041', year: 2022, url: `${PLANS_BY_REGION}/hunter-regional-plan-2041` },
  { region: 'Illawarra Shoalhaven', name: 'Illawarra Shoalhaven Regional Plan 2041', year: 2021, url: `${PLANS_BY_REGION}/the-illawarra-shoalhaven-plan/illawarra-shoalhaven-regional-plan-2041` },
  { region: 'New England North West', name: 'New England North West Regional Plan 2041', year: 2022, url: `${PLANS_BY_REGION}/new-england-north-west-regional-plan-2041` },
  { region: 'North Coast', name: 'North Coast Regional Plan 2041', year: 2022, url: `${PLANS_BY_REGION}/north-coast` },
  { region: 'Riverina Murray', name: 'Riverina Murray Regional Plan 2041', year: 2023, url: `${PLANS_BY_REGION}/riverina-murray-regional-plan-2041` },
  { region: 'South East and Tablelands', name: 'South East and Tablelands Regional Plan 2041', year: 2023, url: `${PLANS_BY_REGION}/south-east-and-tablelands` },
];

export interface LspsEntry { council: string; title: string; url: string; year?: number }

export interface StrategiesData {
  /** The planning region at the point, as the Department's layer names it, and the plan that matches it. */
  region: { name?: string; plan: RegionalPlan | null; ok: boolean };
  /** The council's local strategic planning statement from the Portal's index. */
  lsps: { ok: boolean; entry: LspsEntry | null; indexed: number; note?: string };
  fetchedAt: string;
}

export const emptyStrategies = (): StrategiesData => ({ region: { plan: null, ok: false }, lsps: { ok: false, entry: null, indexed: 0, note: 'not read' }, fetchedAt: new Date().toISOString() });

// ---- the regional plan ------------------------------------------------------------

const simplify = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

export function regionalPlanFor(regionName: string | undefined): RegionalPlan | null {
  if (!regionName) return null;
  const key = simplify(regionName);
  return REGIONAL_PLANS.find((p) => simplify(p.region) === key) ?? REGIONAL_PLANS.find((p) => key.includes(simplify(p.region)) || simplify(p.region).includes(key)) ?? null;
}

async function fetchRegionName(point: XY): Promise<string | undefined> {
  const fc = await queryByPoint(REGIONS_LAYER, point, 'REGION_NAME');
  const name = fc.features[0]?.properties?.REGION_NAME;
  return name ? String(name).trim() : undefined;
}

// ---- the LSPS index -----------------------------------------------------------------

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&#039;|&#39;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&[a-z]+;/g, ' ');

/** Every LSPS the Portal links, as (council words, title, url); the page is read once a month. */
async function fetchLspsIndex(): Promise<LspsEntry[]> {
  return cachedJson<LspsEntry[]>('strategies', 'lsps-index', 30 * DAY_MS, async () => {
    const res = await retryFetch(LSPS_INDEX, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, { attempts: 3, timeoutMs: 40_000, label: 'Planning Portal LSPS index' });
    if (!res.ok) throw new Error(`Planning Portal LSPS index returned HTTP ${res.status}`);
    const html = await res.text();
    const out: LspsEntry[] = [];
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = m[1];
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').replace(/\.$/, '').trim();
      // the statements are PDFs on the Portal's bucket; a few links carry no extension (the City of Sydney's), so the folder counts too
      if (!(/\.pdf(\?|$)/i.test(url) || /fapub_pdf\//i.test(url)) || !/strategic planning statement|LSPS/i.test(title)) continue;
      // the last year in the title is the statement's own ("City Plan 2036: ... Statement 2020")
      const years = [...title.matchAll(/\b(20\d\d)\b/g)].map((m) => m[1]).filter((y) => Number(y) <= new Date().getFullYear() + 1);
      const year = years[years.length - 1];
      out.push({ council: councilWords(title), title, url, year: year ? Number(year) : undefined });
    }
    if (!out.length) throw new Error('Planning Portal LSPS index: no statements found on the page');
    return out;
  });
}

/** "City Plan 2036: City of Sydney Local Strategic Planning Statement 2020" -> "sydney". */
function councilWords(title: string): string {
  let s = title;
  if (s.includes(':')) s = s.slice(s.lastIndexOf(':') + 1);
  s = s.replace(/local strategic planning statement.*$/i, '').replace(/\bLSPS\b.*$/i, '');
  return simplify(s).replace(/\b(the|city|of|council|shire|regional|municipal|municipality|area|greater)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The council's statement, matched on the council's words after the qualifiers go: "north sydney" is not "sydney". */
export function lspsFor(index: LspsEntry[], lgaName: string | undefined, councilName?: string): LspsEntry | null {
  const keys = [...new Set([lgaName, councilName].filter((s): s is string => Boolean(s)).map((s) => councilWords(`${s} Local Strategic Planning Statement`)).filter(Boolean))];
  for (const key of keys) {
    const exact = index.find((e) => e.council === key);
    if (exact) return exact;
  }
  for (const key of keys) {
    // a council named with more words than the LGA (Hawkesbury City / Hawkesbury), never one that only contains the LGA's words (North Sydney for Sydney)
    const loose = index.find((e) => e.council.startsWith(`${key} `) || key.startsWith(`${e.council} `));
    if (loose) return loose;
  }
  return null;
}

// ---- the whole -----------------------------------------------------------------------

export async function fetchStrategies(point: XY, lgaName: string | undefined, councilName: string | undefined, log: (m: string) => void = () => {}): Promise<StrategiesData> {
  const t0 = Date.now();
  const [regionRes, indexRes] = await Promise.all([
    fetchRegionName(point).then((name) => ({ ok: true, name })).catch((e: Error) => { log(`  WARN planning region failed: ${e.message}`); return { ok: false, name: undefined as string | undefined }; }),
    fetchLspsIndex().then((index) => ({ ok: true, index, note: undefined as string | undefined })).catch((e: Error) => { log(`  WARN LSPS index failed: ${e.message}`); return { ok: false, index: [] as LspsEntry[], note: e.message }; }),
  ]);
  const plan = regionalPlanFor(regionRes.name);
  const entry = indexRes.ok ? lspsFor(indexRes.index, lgaName, councilName) : null;
  log(`  strategies: region ${regionRes.name ?? '—'} -> ${plan?.name ?? 'no plan matched'}; LSPS ${indexRes.ok ? `${indexRes.index.length} indexed, ${entry ? `"${entry.title}"` : `none matched ${lgaName ?? '?'}`}` : 'index not read'}; ${Math.round((Date.now() - t0) / 1000)} s`);
  return {
    region: { name: regionRes.name, plan, ok: regionRes.ok },
    lsps: { ok: indexRes.ok, entry, indexed: indexRes.index.length, note: indexRes.note },
    fetchedAt: new Date().toISOString(),
  };
}

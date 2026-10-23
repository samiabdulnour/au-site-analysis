// Development applications from the NSW Planning Portal's Online DA API: the
// live feed of everything lodged on the portal — every council since July
// 2021, updated daily. There is no spatial filter, so the feed is asked per
// council and lodgement window, cached for a day on the output volume (a
// batch of sites in one LGA reads it once), and clipped to the map window
// here. Parameters travel in request headers; a query string is refused.

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retryFetch } from '../lib/http.js';
import { writeFileAtomic } from '../lib/cache.js';
import { lonLatToMercator, type Extent } from '../lib/geo.js';

const API = 'https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA';
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', '.cache', 'da');
const CACHE_MAX_AGE_MS = 24 * 3600 * 1000;
const PAGE = 2000;
const MAX_PAGES = 12;
const CONCURRENCY = 3;
/** Councils were required onto the portal from this date; earlier years are patchy. */
export const PORTAL_MANDATED = '2021-07-01';

export type DaStatusClass = 'determined' | 'active' | 'withdrawn' | 'appeal';

export interface DaRecord {
  pan: string;
  councilRef?: string;
  type: string;
  status: string;
  statusClass: DaStatusClass;
  lodged?: string;
  determined?: string;
  cost?: number;
  dwellings?: number;
  storeys?: number;
  developmentTypes: string[];
  address: string;
  lon?: number;
  lat?: number;
  authority?: string;
}

export interface DaFeed {
  council: string;
  from: string;
  to: string;
  total: number;
  complete: boolean;
  fetchedAt: string;
  records: DaRecord[];
}

/** The API's own council spellings (appendix 1 of the data dictionary). */
const COUNCILS = `Albury City Council|Armidale Regional Council|Ballina Shire Council|Balranald Shire Council|Bathurst Regional Council|Bayside Council|Bega Valley Shire Council|Bellingen Shire Council|Berrigan Shire Council|Blacktown City Council|Bland Shire Council|Blayney Shire Council|Blue Mountains City Council|Bogan Shire Council|Bourke Shire Council|Brewarrina Shire Council|Broken Hill City Council|Burwood Council|Byron Shire Council|Cabonne Shire Council|Camden Council|Campbelltown City Council|Canterbury-Bankstown Council|Carrathool Shire Council|Central Coast Council|Central Darling Shire Council|Cessnock City Council|City of Canada Bay Council|City of Parramatta Council|Clarence Valley Council|Cobar Shire Council|Coffs Harbour City Council|Coolamon Shire Council|Coonamble Shire Council|Cootamundra-Gundagai Regional Council|Council of the City of Sydney|Cowra Shire Council|Cumberland Council|Dubbo Regional Council|Dungog Shire Council|Edward River Council|Eurobodalla Shire Council|Fairfield City Council|Federation Council|Forbes Shire Council|Georges River Council|Gilgandra Shire Council|Glen Innes Severn Shire Council|Goulburn Mulwaree Council|Greater Hume Shire Council|Griffith City Council|Gunnedah Shire Council|Gwydir Shire Council|Hawkesbury City Council|Hay Shire Council|Hilltops Council|Inner West Council|Inverell Shire Council|Junee Shire Council|Kempsey Shire Council|Ku-ring-gai Council|Kyogle Council|Lachlan Shire Council|Lake Macquarie City Council|Lane Cove Municipal Council|Leeton Shire Council|Lismore City Council|Lithgow City Council|Liverpool City Council|Liverpool Plains Shire Council|Lockhart Shire Council|Maitland City Council|Mid-Coast Council|Mid-Western Regional Council|Moree Plains Shire Council|Mosman Municipal Council|Murray River Council|Murrumbidgee Council|Muswellbrook Shire Council|Nambucca Valley Council|Narrabri Shire Council|Narrandera Shire Council|Narromine Shire Council|Newcastle City Council|North Sydney Council|Northern Beaches Council|Oberon Council|Orange City Council|Parkes Shire Council|Penrith City Council|Port Macquarie-Hastings Council|Port Stephens Council|Queanbeyan-Palerang Regional Council|Randwick City Council|Richmond Valley Council|Ryde City Council|Shellharbour City Council|Shoalhaven City Council|Singleton Council|Snowy Monaro Regional Council|Snowy Valleys Council|Strathfield Municipal Council|Sutherland Shire Council|Tamworth Regional Council|Temora Shire Council|Tenterfield Shire Council|The Council of the Municipality of Hunters Hill|The Council of the Municipality of Kiama|The Council of the Shire of Hornsby|The Hills Shire Council|Tweed Shire Council|Upper Hunter Shire Council|Upper Lachlan Shire Council|Uralla Shire Council|Wagga Wagga City Council|Walcha Council|Walgett Shire Council|Warren Shire Council|Warrumbungle Shire Council|Waverley Council|Weddin Shire Council|Wentworth Shire Council|Willoughby City Council|Wingecarribee Shire Council|Wollondilly Shire Council|Wollongong City Council|Woollahra Municipal Council|Yass Valley Council`.split('|');

const FILLER = new Set(['THE', 'COUNCIL', 'OF', 'CITY', 'SHIRE', 'MUNICIPAL', 'MUNICIPALITY', 'REGIONAL', 'AREA']);
const stem = (s: string) =>
  s.toUpperCase().replace(/&/g, 'AND').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).sort().join(' ');

/** The API's spelling for a council named the way the LGA layer names it, or null. */
export function apiCouncilName(lgaCouncil: string | undefined, lgaName?: string): string | null {
  for (const cand of [lgaCouncil, lgaName]) {
    if (!cand) continue;
    const exact = COUNCILS.find((c) => c.toUpperCase() === cand.toUpperCase());
    if (exact) return exact;
    const k = stem(cand);
    const hit = COUNCILS.find((c) => stem(c) === k);
    if (hit) return hit;
  }
  return null;
}

export function classifyStatus(status: string): DaStatusClass {
  const s = status.toLowerCase();
  if (/court/.test(s)) return 'appeal';
  if (/withdrawn|cancel|reject|declined|lapsed/.test(s)) return 'withdrawn';
  if (/determined|deferred|operational consent|approved|consent issued/.test(s)) return 'determined';
  return 'active';
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toRecord(a: any): DaRecord | null {
  const pan = String(a.PlanningPortalApplicationNumber ?? '').trim();
  if (!pan) return null;
  const loc = Array.isArray(a.Location) ? a.Location[0] ?? {} : {};
  const lon = Number(loc.X), lat = Number(loc.Y);
  const status = String(a.ApplicationStatus ?? '');
  return {
    pan,
    councilRef: a.CouncilApplicationNumber ? String(a.CouncilApplicationNumber) : undefined,
    type: String(a.ApplicationType ?? ''),
    status,
    statusClass: classifyStatus(status),
    lodged: a.LodgementDate ? String(a.LodgementDate).slice(0, 10) : undefined,
    determined: a.DeterminationDate ? String(a.DeterminationDate).slice(0, 10) : undefined,
    cost: num(a.CostOfDevelopment),
    dwellings: num(a.NumberOfNewDwellings),
    storeys: num(a.NumberOfStoreys),
    developmentTypes: (Array.isArray(a.DevelopmentType) ? a.DevelopmentType : [])
      .map((t: any) => String(t?.DevelopmentType ?? '').trim()).filter(Boolean),
    address: String(loc.FullAddress ?? '').replace(/\s+/g, ' ').trim(),
    lon: Number.isFinite(lon) && Number.isFinite(lat) && lon !== 0 ? lon : undefined,
    lat: Number.isFinite(lon) && Number.isFinite(lat) && lat !== 0 ? lat : undefined,
    authority: a.DeterminationAuthority ? String(a.DeterminationAuthority) : undefined,
  };
}

async function page(council: string, from: string, to: string, n: number): Promise<any> {
  const res = await retryFetch(API, {
    headers: {
      PageSize: String(PAGE),
      PageNumber: String(n),
      filters: JSON.stringify({ filters: { CouncilName: [council], LodgementDateFrom: from, LodgementDateTo: to } }),
    },
  }, { attempts: 3, timeoutMs: 120_000, label: 'online DA api' });
  if (!res.ok) throw new Error(`Online DA API HTTP ${res.status}`);
  return res.json();
}

/**
 * Every application lodged with `council` between the two dates, from the
 * day's cache when there is one. `complete` is false when the feed ran past
 * the page cap, which no metropolitan council reaches in five years.
 */
export async function fetchCouncilApplications(
  council: string,
  from: string,
  to: string,
  log: (m: string) => void = () => {},
): Promise<DaFeed> {
  const key = `${council.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${from}_${to}.json`;
  const file = join(CACHE_DIR, key);
  try {
    if (Date.now() - statSync(file).mtimeMs < CACHE_MAX_AGE_MS) {
      const cached = JSON.parse(readFileSync(file, 'utf8')) as DaFeed;
      log(`  DA feed for ${council}: ${cached.records.length} applications (cached ${cached.fetchedAt.slice(0, 16)})`);
      return cached;
    }
  } catch { /* no cache yet */ }

  const records: DaRecord[] = [];
  const first = await page(council, from, to, 1);
  const total = Number(first.TotalCount) || 0;
  const pages = Math.max(1, Number(first.TotalPages) || 1);
  const add = (d: any) => { for (const a of d.Application ?? []) { const r = toRecord(a); if (r) records.push(r); } };
  add(first);
  const last = Math.min(pages, MAX_PAGES);
  // The remaining pages a few at a time: each is a megabyte or two and the
  // API spends most of a request assembling it, so three in flight roughly
  // thirds the wait without leaning on the service.
  for (let n = 2; n <= last; n += CONCURRENCY) {
    const batch = [];
    for (let k = n; k < Math.min(n + CONCURRENCY, last + 1); k++) batch.push(page(council, from, to, k));
    for (const d of await Promise.all(batch)) add(d);
  }
  const feed: DaFeed = { council, from, to, total, complete: pages <= MAX_PAGES, fetchedAt: new Date().toISOString(), records };
  log(`  DA feed for ${council}: ${records.length} of ${total} applications since ${from}${feed.complete ? '' : ' (page cap reached)'}`);
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileAtomic(file, JSON.stringify(feed)); } catch { /* cache is optional */ }
  return feed;
}

/** The records with a location inside the extent (grown by `margin` of its size when asked). */
export function clipToExtent(records: DaRecord[], extent: Extent, margin = 0): DaRecord[] {
  const mx = (extent.xmax - extent.xmin) * margin, my = (extent.ymax - extent.ymin) * margin;
  return records.filter((r) => {
    if (r.lon === undefined || r.lat === undefined) return false;
    const m = lonLatToMercator({ lon: r.lon, lat: r.lat });
    return m.x >= extent.xmin - mx && m.x <= extent.xmax + mx && m.y >= extent.ymin - my && m.y <= extent.ymax + my;
  });
}

// What a house-scale application looks like, and what a new building of any
// size looks like. Storeys and dwellings are typed in by applicants: a
// "4 storey" alteration to a dwelling house or "12 dwellings" on a balcony
// job describe the existing building, and a dual occupancy lodged at $913 M
// is a typo, not a tower. So house-scale work never counts as significant
// on those fields alone.
const HOUSE_SCALE = /dual occupancy|dwelling|secondary|alteration|addition|swimming pool|demolition|tree|sign|fence|change of use|garage|carport|shed|deck|pergola|balcon|awning|subdivision|strata|torrens|earthworks|retaining|studio|granny|patio|terrace|verandah|pool/i;
const NEW_BUILD = /residential flat|shop top|mixed use|boarding|co-?living|multi.?dwelling|seniors|apartment|build.to.rent|erection of a new|hotel|motel|office|commercial|educational|school|hospital|health|industrial|warehouse|student|manor|town ?house|retail|shop|serviced|centre|club|place of public|pub\b|data centre|infrastructure/i;

/** Of a scale that shapes context: four storeys, ten dwellings or $5 M, on something that is not house-scale work. */
export function isSignificant(r: DaRecord): boolean {
  const st = r.storeys ?? 0, dw = r.dwellings ?? 0, cost = r.cost ?? 0;
  const types = r.developmentTypes;
  const houseOnly = types.length > 0 && types.every((t) => HOUSE_SCALE.test(t) && !NEW_BUILD.test(t));
  if (houseOnly) return dw >= 10 && cost >= 2e6 && cost <= 2e9;
  if (cost > 2e9) return st >= 4 || dw >= 10;
  return st >= 4 || dw >= 10 || cost >= 5e6;
}

const STREET_WORDS: [RegExp, string][] = [
  [/\b(STREET|ST)\b/g, 'ST'], [/\b(ROAD|RD)\b/g, 'RD'], [/\b(AVENUE|AVE|AV)\b/g, 'AVE'], [/\b(PARADE|PDE)\b/g, 'PDE'],
  [/\b(HIGHWAY|HWY)\b/g, 'HWY'], [/\b(LANE|LN)\b/g, 'LN'], [/\b(PLACE|PL)\b/g, 'PL'],
];
const normaliseAddress = (s: string) => {
  let t = s.toUpperCase().replace(/\bNSW\b|\bAUSTRALIA\b|\b\d{4}\b/g, ' ');
  for (const [re, to] of STREET_WORDS) t = t.replace(re, to);
  return t.replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
};

/** One key per address spelling, so a DA and its modifications group together. */
export function siteKey(address: string): string {
  return normaliseAddress(address);
}

export interface SiteAddress {
  /** Street number range, lo ≤ hi. */
  lo: number;
  hi: number;
  /** Normalised street and suburb, the grouping key. */
  street: string;
  /** The address from the street number on, unit and level dropped, upper case. */
  display: string;
}

/**
 * Street number range and street of an address, or null when it has none:
 * "23 9-15 DANKS STREET WATERLOO 2017" is 9–15 Danks Street, Waterloo. Two
 * spellings of one lot ("44-48 O'Dea Avenue", "44 O'Dea Avenue") meet on
 * the same street with overlapping numbers of the same parity.
 */
export function parseSiteAddress(address: string): SiteAddress | null {
  const a = address.toUpperCase().replace(/\bNSW\b|\bAUSTRALIA\b/g, ' ').replace(/\b\d{4}\s*$/, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const m = a.match(/(\d+)[A-Z]?(?:\s*-\s*(\d+)[A-Z]?)?\s+([A-Z][A-Z' ]*)$/);
  if (!m || m.index === undefined) return null;
  const lo = Number(m[1]), hi = m[2] ? Number(m[2]) : lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), street: normaliseAddress(m[3]), display: a.slice(m.index).replace(/^(\d+[A-Z]?)\s*-\s*(\d+[A-Z]?)/, '$1-$2') };
}

/** Whether two parsed addresses name the same lot: same street, overlapping numbers, same side. */
export function sameLot(a: SiteAddress, b: SiteAddress): boolean {
  return a.street === b.street && a.lo <= b.hi && b.lo <= a.hi && a.lo % 2 === b.lo % 2;
}

/** Compact money: $4.2 M, $1.1 B, $850 K. */
export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)} K`;
  return `$${Math.round(n)}`;
}

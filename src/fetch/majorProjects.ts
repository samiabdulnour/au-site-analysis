// Slide 07: the State significant applications around the site. The
// Department's Major Projects register has no API or open feed. Its listing
// (/major-projects/projects) is a server-rendered page of cards, nine to a
// page, filtered by council area and case type; each card carries the
// application number, the stage, the case type, the council area, the title
// and the address. Each project has a page with its details (development
// type, decision, determination date, decider, last modification), its
// modifications with their stages, its description, and the Department's
// point for it, a geofield in the page's settings.
//
// The listing is read for every council area the window touches, State
// significant development and State significant infrastructure only (not
// the modifications, which the project pages list, nor the legacy Part 3A
// and Part 4 cases), and cached a week. Each project's page is cached a week
// while it is in assessment and two months once it is determined or
// withdrawn, so a council area costs its pages once: about 290 for the City
// of Sydney, under 70 for most. The tracker's JSON of every project
// (/state-significant-projects-spatial-data) would be one call, but it
// answered 503 through September 2026 while the rest of the site answered.

import { retryFetch, USER_AGENT } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { queryByExtent } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat, type Extent, type XY } from '../lib/geo.js';

const PORTAL = 'https://www.planningportal.nsw.gov.au';
export const MAJOR_PROJECTS_LISTING = `${PORTAL}/major-projects/projects`;
const LGA_LAYER = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Administrative_Boundaries_Theme/FeatureServer/8';
const UA = USER_AGENT;
const FOLDER = 'majorprojects';

/** The register's project case types the deck reads; their modifications come from the project pages. */
export const CASE_TYPES = ['State Significant Development', 'State Significant Infrastructure'] as const;
/** Projects further than this from the site are dropped from the bundle. */
export const KEEP_RADIUS_M = 3000;
const CONCURRENCY = 4;

export type StageClass = 'determined' | 'active' | 'withdrawn';

/** One card of the listing. */
export interface MajorProjectCard {
  number: string;
  caseType: string;
  /** The stage tag on the card: SEARs, Prepare EIS, Exhibition, Assessment, Determination, Withdrawn… */
  stage?: string;
  lga?: string;
  title: string;
  address?: string;
  url: string;
}

/** What a project's page adds to its card. */
export interface ProjectPage {
  /** "Current Status:" on the page, which can be finer than the card's stage ("More Information Required"). */
  status?: string;
  developmentType?: string;
  description?: string;
  /** Approved, Refused… when determined. */
  decision?: string;
  /** The determination date as the Department's calendar shows it (yyyy-mm-dd, Sydney). */
  determined?: string;
  decider?: string;
  lastModifiedBy?: string;
  lastModifiedOn?: string;
  modifications: { title: string; stage?: string }[];
  lon?: number;
  lat?: number;
}

export interface MajorProject extends MajorProjectCard, ProjectPage {
  stageClass: StageClass;
  distanceM: number;
  /** Degrees clockwise from north, from the site's centre. */
  bearing: number;
}

export interface MajorProjectsData {
  ok: boolean;
  note?: string;
  /** The council areas read, with the register's name for each and how many applications it lists there. */
  lgas: { id: string; name: string; listed: number }[];
  /** Applications listed across those areas, how many pages were read and how many gave a point. */
  listed: number;
  read: number;
  located: number;
  radiusM: number;
  /** Every located project within the radius, nearest first. */
  projects: MajorProject[];
  fetchedAt: string;
}

export const emptyMajorProjects = (note = 'not read'): MajorProjectsData =>
  ({ ok: false, note, lgas: [], listed: 0, read: 0, located: 0, radiusM: KEEP_RADIUS_M, projects: [], fetchedAt: new Date().toISOString() });

// ---- parsing ---------------------------------------------------------------------

const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&rsquo;|&lsquo;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** The council areas of the listing's filter, as (id, name). */
export function parseLgaOptions(html: string): { id: string; name: string }[] {
  const m = html.match(/<select[^>]*name="lga"[^>]*>([\s\S]*?)<\/select>/);
  if (!m) return [];
  return [...m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((o) => ({ id: o[1], name: text(o[2]) }))
    .filter((o) => o.id && o.id !== 'All');
}

/** One page of the listing: its cards, the result count and the last page number the pager links to. */
export function parseListing(html: string): { cards: MajorProjectCard[]; total?: number; lastPage: number } {
  const total = Number(html.match(/Showing:\s*([\d,]+)\s*results/)?.[1]?.replace(/,/g, '')) || undefined;
  // the pager's links carry the filters, HTML-escaped: "?lga=30&amp;case_type=…&amp;page=5"
  const pages = [...html.matchAll(/[?&;]page=(\d+)/g)].map((m) => Number(m[1]));
  const cards: MajorProjectCard[] = [];
  for (const chunk of html.split(/<div class="card\s*">/).slice(1)) {
    const c = chunk.split(/<div class="grid__col-6--mid/)[0];
    const pick = (re: RegExp) => { const m = c.match(re); const t = m ? text(m[1]) : ''; return t || undefined; };
    const number = pick(/field-field-case-id[^>]*>([\s\S]*?)<\/div>/);
    const href = c.match(/href="(\/major-projects\/projects\/[^"#?]+)"/)?.[1];
    const title = pick(/<h3 class="card__title">([\s\S]*?)<\/h3>/);
    if (!number || !href || !title) continue;
    cards.push({
      number, title, url: `${PORTAL}${href}`,
      stage: pick(/<div class="tag tag--fixed">([\s\S]*?)<\/div>/),
      caseType: pick(/field-field-case-type[^>]*>([\s\S]*?)<\/div>/) ?? '',
      lga: pick(/<span class="card__sub">([\s\S]*?)<\/span>/),
      address: pick(/icon--pin"><\/span>([\s\S]*?)<\/div>/),
    });
  }
  return { cards, total, lastPage: pages.length ? Math.max(...pages) : 0 };
}

const sydneyDate = (iso: string): string | undefined => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
};
const dmyToIso = (s?: string): string | undefined => {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
};
const inNsw = (lon: number, lat: number) => lon > 140 && lon < 154.5 && lat > -38.5 && lat < -28;

/** A project page: its details, its modifications and the Department's point. */
export function parseProjectPage(html: string): ProjectPage {
  const pick = (re: RegExp) => { const m = html.match(re); const t = m ? text(m[1]) : ''; return t || undefined; };
  // A detail row is "<b>Label</b> <div>value</div>"; its value runs to the next row.
  const detail = (label: string) => {
    const at = html.search(new RegExp(`<b>\\s*${label}\\s*</b>`));
    if (at < 0) return undefined;
    const rest = html.slice(at).replace(/^<b>[\s\S]*?<\/b>/, '');
    const end = rest.search(/<div class="row|<b>|<details|<\/details>/);
    return text(end >= 0 ? rest.slice(0, end) : rest.slice(0, 400)) || undefined;
  };
  const when = html.match(/<b>\s*Determination Date\s*<\/b>[\s\S]{0,400}?<time datetime="([^"]+)"/)?.[1];
  const modsAt = html.indexOf('field-major-projects-modifications');
  const modsEnd = modsAt < 0 ? -1 : html.indexOf('<div class="field field-major-project', modsAt + 40);
  const modsHtml = modsAt < 0 ? '' : html.slice(modsAt, modsEnd > modsAt ? modsEnd : modsAt + 20_000);
  const modifications = [...modsHtml.matchAll(/<a href="[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?field-field-case-stage[^>]*>([\s\S]*?)<\/div>/g)]
    .map((m) => ({ title: text(m[1]), stage: text(m[2]) || undefined }))
    .filter((m) => m.title);
  const pt = html.match(/"type":"Point","coordinates":\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
  const lon = pt ? Number(pt[1]) : NaN, lat = pt ? Number(pt[2]) : NaN;
  return {
    status: pick(/project__status-heading[^>]*>[\s\S]*?Current Status:\s*<span[^>]*>([\s\S]*?)<\/span>/),
    developmentType: detail('Development Type'),
    description: pick(/field-field-project-description[^>]*>([\s\S]*?)<\/div>/),
    decision: detail('Decision'),
    determined: when ? sydneyDate(when) : undefined,
    decider: detail('Decider'),
    lastModifiedBy: detail('Last Modified By'),
    lastModifiedOn: dmyToIso(detail('Last Modified On')),
    modifications,
    ...(inNsw(lon, lat) ? { lon, lat } : {}),
  };
}

/**
 * Determined when the page gives a decision or a date; withdrawn when the
 * card or the page's status says withdrawn, rejected or cancelled, or that
 * the SEARs expired (the proponent let them lapse); otherwise in the process.
 */
export function stageClassOf(stage?: string, page?: Pick<ProjectPage, 'decision' | 'determined' | 'status'>): StageClass {
  if (/withdrawn|rejected|cancel|expired|lapsed/i.test(`${stage ?? ''} ${page?.status ?? ''} ${page?.decision ?? ''}`)) return 'withdrawn';
  if (page?.decision || page?.determined) return 'determined';
  return 'active';
}

/** The register title-cases its own markup now and then: "&Amp;" for "&". */
const clean = (s?: string) => s?.replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() || undefined;

// ---- council areas ------------------------------------------------------------------

const QUALIFIERS = /\b(the|city|of|council|shire|regional|municipal|municipality|area)\b/g;
/** "Council of the City of Sydney" and "City of Sydney" both give "sydney"; "North Sydney" stays "north sydney". */
export const lgaKey = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();

/** The listing's option for a council area named the way the State's LGA layer names it. */
export function lgaOptionFor(options: { id: string; name: string }[], lgaName?: string, councilName?: string): { id: string; name: string } | null {
  const keys = [...new Set([lgaName, councilName].filter((s): s is string => Boolean(s)).map(lgaKey).filter(Boolean))];
  for (const k of keys) { const o = options.find((x) => lgaKey(x.name) === k); if (o) return o; }
  for (const k of keys) {
    const o = options.find((x) => { const n = lgaKey(x.name); return n.startsWith(`${k} `) || k.startsWith(`${n} `); });
    if (o) return o;
  }
  return null;
}

// ---- fetching -------------------------------------------------------------------------

async function getHtml(url: string, label: string): Promise<string> {
  const res = await retryFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, { attempts: 3, timeoutMs: 40_000, baseDelayMs: 2000, label });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  return res.text();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  }));
  return out;
}

const fetchLgaOptions = () => cachedJson(FOLDER, 'lga-options', 30 * DAY_MS, async () => {
  const options = parseLgaOptions(await getHtml(`${MAJOR_PROJECTS_LISTING}?page=0`, 'Major Projects listing'));
  if (!options.length) throw new Error('the Major Projects listing carries no council-area filter');
  return options;
});

/** Every card of one council area and case type, all pages, a week in the cache. */
const fetchListing = (lgaId: string, caseType: string) => cachedJson(FOLDER, `listing-${lgaId}-${caseType}`, 7 * DAY_MS, async () => {
  const base = `${MAJOR_PROJECTS_LISTING}?${new URLSearchParams({ lga: lgaId, case_type: caseType, status: 'All' })}`;
  const first = parseListing(await getHtml(`${base}&page=0`, 'Major Projects listing'));
  const rest = await mapLimit(Array.from({ length: first.lastPage }, (_, i) => i + 1), CONCURRENCY,
    (p) => getHtml(`${base}&page=${p}`, 'Major Projects listing').then((h) => parseListing(h).cards));
  const seen = new Set<string>();
  return [...first.cards, ...rest.flat()].filter((c) => !seen.has(c.number) && (seen.add(c.number), true));
});

/** A project's page, parsed: a week while it is live, two months once settled. */
const fetchProjectPage = (card: MajorProjectCard) => {
  const settled = /determin|withdrawn|rejected/i.test(card.stage ?? '');
  return cachedJson(FOLDER, `project-${card.number}`, (settled ? 60 : 7) * DAY_MS, async () => parseProjectPage(await getHtml(card.url, 'Major Projects project page')));
};

/**
 * The State significant applications the register lists for the council
 * areas the window touches, each with its page's details and point, those
 * within KEEP_RADIUS_M of the site nearest first.
 */
export async function fetchMajorProjects(window: Extent, centre: XY, log: (m: string) => void = () => {}): Promise<MajorProjectsData> {
  const t0 = Date.now();
  const areas = await queryByExtent(LGA_LAYER, window, 'lganame,councilname');
  const options = await fetchLgaOptions();
  const lgas: MajorProjectsData['lgas'] = [];
  const unmatched: string[] = [];
  for (const f of areas.features) {
    const name = String(f.properties?.lganame ?? '').trim(), council = String(f.properties?.councilname ?? '').trim();
    // the harbour and the bays are the layer's unincorporated areas, which are no council's
    if ((!name && !council) || /^unincorporated/i.test(name)) continue;
    const opt = lgaOptionFor(options, name, council);
    if (!opt) { unmatched.push(name || council); continue; }
    if (!lgas.some((l) => l.id === opt.id)) lgas.push({ ...opt, listed: 0 });
  }
  if (!lgas.length) return emptyMajorProjects(unmatched.length ? `no council area of the register matched ${unmatched.join(', ')}` : 'no council area found for the window');
  const cards: MajorProjectCard[] = [];
  for (const l of lgas) for (const ct of CASE_TYPES) {
    const cs = await fetchListing(l.id, ct);
    l.listed += cs.length;
    for (const c of cs) if (!cards.some((x) => x.number === c.number)) cards.push(c);
  }
  let failed = 0;
  const pages = await mapLimit(cards, CONCURRENCY, (c) => fetchProjectPage(c).catch(() => { failed++; return null; }));
  const k = mercatorScaleFactor(mercatorToLonLat(centre).lat);
  const projects: MajorProject[] = [];
  let located = 0;
  cards.forEach((card, i) => {
    const page = pages[i];
    if (!page || page.lon === undefined || page.lat === undefined) return;
    located++;
    const m = lonLatToMercator({ lon: page.lon, lat: page.lat });
    const dx = m.x - centre.x, dy = m.y - centre.y;
    const distanceM = Math.hypot(dx, dy) / k;
    if (distanceM > KEEP_RADIUS_M) return;
    projects.push({ ...card, ...page, title: clean(card.title) ?? card.title, address: clean(card.address), description: clean(page.description), stageClass: stageClassOf(card.stage, page), distanceM: Math.round(distanceM), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 });
  });
  projects.sort((a, b) => a.distanceM - b.distanceM);
  const note = [failed ? `${failed} project page${failed === 1 ? '' : 's'} could not be read` : '', unmatched.length ? `${unmatched.join(', ')} not in the register's list of council areas` : ''].filter(Boolean).join('; ') || undefined;
  log(`  major projects: ${lgas.map((l) => `${l.name} ${l.listed}`).join(', ')} listed; ${pages.length - failed} pages read, ${located} located, ${projects.length} within ${KEEP_RADIUS_M / 1000} km; ${Math.round((Date.now() - t0) / 1000)} s${note ? ` (${note})` : ''}`);
  return { ok: true, note, lgas, listed: cards.length, read: pages.length - failed, located, radiusM: KEEP_RADIUS_M, projects, fetchedAt: new Date().toISOString() };
}

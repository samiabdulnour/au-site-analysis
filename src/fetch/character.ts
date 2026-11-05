// Slide 02: the character of the place as the open sources describe and
// picture it. Wikipedia's summary of the suburb is the seed text and its
// articles within 1.5 km are the named places; Wikimedia Commons' geotagged
// photographs within 800 m, each with its author and licence, stand in for
// the office's own until the site visit; the aerial over the planning
// window shows the grain. Wikimedia rate-limits shared addresses (429), so
// every call goes through the retrying fetch, carries a descriptive
// User-Agent, and is paced; a source that still refuses is reported, not
// invented.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFetch, USER_AGENT } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { lonLatToMercator, mercatorScaleFactor, type LonLat, type Extent } from '../lib/geo.js';
import { fetchAerial, type AerialResult } from './imagery.js';
import { fetchPlaceStreetViews, type PlaceStreetView } from './streetView.js';

const UA = USER_AGENT;
const WP_REST = 'https://en.wikipedia.org/api/rest_v1';
const WP_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const PLACES_RADIUS_M = 1500;
export const PHOTOS_RADIUS_M = 800;
export const MAX_PLACES = 12;
export const MAX_PHOTOS = 8;
/** A pause between Wikimedia calls; the shared address is what gets limited. */
const PACE_MS = 400;

export interface WikiSummary {
  title: string;
  /** Wikidata's one-line description, e.g. "suburb of Sydney, Australia". */
  description?: string;
  /** The lead section as plain text. */
  extract: string;
  url: string;
  /** The article's lead image, when it is on Commons with a licence: saved like the photographs. */
  imageTitle?: string;
}

export interface WikiPlace {
  title: string;
  description?: string;
  lat: number;
  lon: number;
  distanceM: number;
  bearing: number;
  url: string;
}

export interface CommonsPhoto {
  n: number;
  file: string;
  title: string;
  /** The author as Commons records it, HTML stripped. */
  author?: string;
  licence: string;
  licenceUrl?: string;
  description?: string;
  date?: string;
  lat?: number;
  lon?: number;
  distanceM?: number;
  bearing?: number;
  widthPx: number;
  heightPx: number;
  pageUrl: string;
  /** Whether this is the article's own lead image rather than a geotagged find. */
  lead: boolean;
}

export interface CharacterData {
  wikipedia: { ok: boolean; summary: WikiSummary | null; note?: string };
  places: { ok: boolean; radiusM: number; items: WikiPlace[]; note?: string };
  photos: { ok: boolean; radiusM: number; candidates: number; items: CommonsPhoto[]; note?: string };
  aerial: AerialResult | null;
  /** Each numbered place from above: NSW Imagery over a 3:2 window round it, for the slide's frames. Optional: decks read before it have none. */
  placeViews?: PlaceView[];
  /** Each numbered place from the street, where Google Street View is keyed and has a panorama near it. */
  placeStreetViews?: PlaceStreetView[];
  /**
   * Each numbered place in its own photograph: the image Wikidata gives its article (P18), else the article's lead
   * image, where it is on Commons under an open licence and shows the place rather than a plan, a logo or a room.
   * Preferred to Street View, whose nearest panorama can stand in a tunnel, a car park or a museum's hall.
   */
  placePhotos?: PlacePhoto[];
  fetchedAt: string;
}

export interface PlaceView { n: number; title: string; lon: number; lat: number; aerial: AerialResult }
/** A place's own photograph, from Commons, with what its licence asks to be printed beside it. */
export interface PlacePhoto {
  n: number; title: string; file: string;
  /** Where the photograph was found: Wikidata's image of the article's item, or the article's lead image. */
  source: 'wikidata' | 'article';
  commonsTitle: string; author?: string; licence: string; licenceUrl?: string; pageUrl: string; date?: string; widthPx: number; heightPx: number;
}
/** The window of a place view: 150 × 100 m, the frame's 3:2. */
const PLACE_VIEW_M = { w: 150, h: 100 };

/** The places from above: NSW Imagery round each of the first `max`, one after another (one service, one pace). */
export async function fetchPlaceViews(places: { title: string; lon: number; lat: number }[], outDir: string, max = 8, log: (m: string) => void = () => {}): Promise<PlaceView[]> {
  const out: PlaceView[] = [];
  for (const [i, pl] of places.slice(0, max).entries()) {
    const c = lonLatToMercator({ lon: pl.lon, lat: pl.lat });
    const k = mercatorScaleFactor(pl.lat);
    const ext = { xmin: c.x - (PLACE_VIEW_M.w / 2) * k, xmax: c.x + (PLACE_VIEW_M.w / 2) * k, ymin: c.y - (PLACE_VIEW_M.h / 2) * k, ymax: c.y + (PLACE_VIEW_M.h / 2) * k };
    try { out.push({ n: i + 1, title: pl.title, lon: pl.lon, lat: pl.lat, aerial: await fetchAerial(ext, 900, outDir, `place_${i + 1}`) }); }
    catch (e: any) { log(`  WARN place view ${pl.title} failed: ${e?.message ?? e}`); }
  }
  return out;
}

export const emptyCharacter = (): CharacterData => ({
  wikipedia: { ok: false, summary: null, note: 'not read' },
  places: { ok: false, radiusM: PLACES_RADIUS_M, items: [], note: 'not read' },
  photos: { ok: false, radiusM: PHOTOS_RADIUS_M, candidates: 0, items: [], note: 'not read' },
  aerial: null,
  fetchedAt: new Date().toISOString(),
});

// ---- helpers ------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const toRad = (d: number) => (d * Math.PI) / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
function distBearing(from: LonLat, to: LonLat): { distanceM: number; bearing: number } {
  const kx = Math.cos(toRad((from.lat + to.lat) / 2)) * 111_320, ky = 110_574;
  const dx = (to.lon - from.lon) * kx, dy = (to.lat - from.lat) * ky;
  return { distanceM: Math.hypot(dx, dy), bearing: norm((Math.atan2(dx, dy) * 180) / Math.PI) };
}

let lastCall = 0;
/** A paced, retrying GET of a Wikimedia JSON endpoint. */
async function wikiJson<T>(url: string, label: string, attempts = 4): Promise<T> {
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await retryFetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' } }, { attempts, timeoutMs: 30_000, baseDelayMs: 2500, label });
  lastCall = Date.now();
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The Commons file an image URL serves, by its name ("Averybuilding.jpg"), or nothing for a file hosted on Wikipedia
 * alone (fair use, not free). The URL's query string (Wikipedia adds tracking parameters) and a thumbnail's size are
 * no part of the name.
 */
export function commonsFileOf(url?: string): string | undefined {
  const m = url?.match(/\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : undefined;
}

const titleCaseWords = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---- Wikipedia ---------------------------------------------------------------------

interface RestSummary { type?: string; title?: string; description?: string; extract?: string; content_urls?: { desktop?: { page?: string } }; originalimage?: { source?: string } }

/** The suburb's article: "<Suburb>, New South Wales" first, then the bare name where the suburb's article carries no qualifier. */
async function wikipediaSummary(suburb: string): Promise<WikiSummary | null> {
  const name = titleCaseWords(suburb.trim());
  for (const title of [`${name}, New South Wales`, `${name}, Sydney`, name]) {
    let j: RestSummary;
    try { j = await wikiJson<RestSummary>(`${WP_REST}/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, 'Wikipedia summary', 3); }
    catch (e: any) { if (/HTTP 404/.test(String(e?.message))) continue; throw e; }
    if (j.type === 'disambiguation' || !j.extract) continue;
    // the bare name must at least be about a place in New South Wales, not a namesake elsewhere
    if (!/New South Wales|Sydney/i.test(`${j.description ?? ''} ${j.extract}`)) continue;
    const file = commonsFileOf(j.originalimage?.source);
    return { title: j.title ?? title, description: j.description, extract: j.extract, url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, imageTitle: file ? `File:${file}` : undefined };
  }
  return null;
}

interface GeoSearchResult { pageid: number; title: string; lat: number; lon: number; dist: number }
interface QueryPages { query?: { geosearch?: GeoSearchResult[]; pages?: Record<string, { title: string; description?: string; pageprops?: Record<string, string> }> } }

/** Articles placed within the radius, with their one-line descriptions, nearest first; other suburbs' articles are left out. */
async function wikipediaPlaces(centre: LonLat, radiusM: number, suburbTitle?: string): Promise<WikiPlace[]> {
  const geo = await wikiJson<QueryPages>(`${WP_API}?${new URLSearchParams({ action: 'query', list: 'geosearch', gscoord: `${centre.lat}|${centre.lon}`, gsradius: String(radiusM), gslimit: '50', format: 'json' })}`, 'Wikipedia geosearch');
  const found = (geo.query?.geosearch ?? []).filter((g) => g.title !== suburbTitle && !/, New South Wales$/.test(g.title) && !/^List of /.test(g.title));
  if (!found.length) return [];
  const top = found.sort((a, b) => a.dist - b.dist).slice(0, 40);
  const desc = await wikiJson<QueryPages>(`${WP_API}?${new URLSearchParams({ action: 'query', prop: 'description', titles: top.map((g) => g.title).join('|'), format: 'json' })}`, 'Wikipedia descriptions', 3).catch(() => ({} as QueryPages));
  const byTitle = new Map<string, string | undefined>();
  for (const p of Object.values(desc.query?.pages ?? {})) byTitle.set(p.title, p.description);
  return top.map((g) => {
    const { distanceM, bearing } = distBearing(centre, { lon: g.lon, lat: g.lat });
    return { title: g.title, description: byTitle.get(g.title), lat: g.lat, lon: g.lon, distanceM: Math.round(distanceM), bearing: Math.round(bearing), url: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.title.replace(/ /g, '_'))}` };
  });
}

/** An article is a place when its description (or, failing one, its title) names a kind of place; companies, brands, electorates and people are left out. */
const PLACE_WORDS = /\b(hall|school|college|university|tafe|hospital|park|oval|ground|stadium|reserve|cemetery|church|cathedral|temple|mosque|synagogue|station|building|house|tower|hotel|pub|theatre|cinema|library|museum|gallery|market|square|street|road|bridge|tunnel|wharf|estate|precinct|centre|center|club|court|police|fire station|depot|works|factory|brewery|mill|warehouse|shopping|arcade|plaza|monument|memorial|heritage|suburb|locality|neighbourhood|lake|creek|river|bay|beach|garden|zoo|racecourse|golf|swimming|pool|aquatic|village|apartment|housing|tram|railway|light rail|metro|bus|airport|port|dock|pier|canal|reservoir|dam|lighthouse|fort|barracks|prison|gaol|jail|courthouse|post office|bank building|shop|store|venue|arena|showground|track|field|studio|campus|institute|academy|convent|monastery|chapel|kindergarten|clinic|mansion|villa|terrace|cottage|homestead|farm|nursery|conservatory|observatory|planetarium|aquarium|pavilion|rotunda|fountain|statue|sculpture|mural|site|place|area|district|quarter|hub|complex|facility|headquarters|office|hq|land|island|point|head|cove|wetland|lagoon|footpath|cycleway|walk|trail|way\b|lane|avenue|highway|motorway|expressway|intersection|roundabout|interchange|bridge|viaduct|tunnel|subway|shrine|cross|well|spring|quarry|mine|kiln|tannery|wool|store|silo|gasworks|power station|substation|pumping station|water tower|windmill)\b/i;
const NOT_A_PLACE = /\b(electoral|electorate|division of|local government area|brand|company|corporation|limited|pty|band\b|album|song|novel|magazine|newspaper|television|radio station|politician|footballer|cricketer|player|actor|actress|singer|musician|writer|poet|architect|painter|businessman|businesswoman|born \d|died \d|surname|given name|family|dynasty|list of)\b/i;
export const looksLikePlace = (title: string, description?: string): boolean => {
  const text = `${description ?? ''}`.trim();
  if (NOT_A_PLACE.test(text) || NOT_A_PLACE.test(title)) return false;
  return PLACE_WORDS.test(text) || (!text && PLACE_WORDS.test(title));
};

// ---- Wikimedia Commons ----------------------------------------------------------

interface ImageInfo { url?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number; mime?: string; extmetadata?: Record<string, { value?: string }> }
interface CommonsPages { query?: { geosearch?: GeoSearchResult[]; pages?: Record<string, { title: string; imageinfo?: ImageInfo[]; coordinates?: { lat: number; lon: number }[] }> } }

const OPEN_LICENCE = /^(CC[ -]BY(?:[ -]SA)?(?:[ -]\d(\.\d)?)?(?:[ -][a-z]{2})?|CC0(?: 1\.0)?|Public domain|PD.*|Attribution|FAL|GFDL)$/i;
/** Photographs Commons holds near any dealership, studio or event, which are not the place. */
const NOT_THE_PLACE = /\b(sedan|wagon|hatchback|coupe|convertible|ute\b|SUV|van\b|Lexus|Toyota|Holden|Ford|BMW|Mercedes|Audi|Nissan|Mazda|Honda|Hyundai|Kia|Subaru|Volkswagen|Porsche|Ferrari|Tesla|selfie|portrait|hair|editathon|wikimeet|meetup|logo|screenshot|map of|diagram|poster|flyer|artists?|speaking|speaker|browsing|participants?|instructing|admiring|team of|workshop|conference|event|opening|launch|festival|crowd|people|protest|rally|march|wedding|party|players?|match|game|concert|performance|band\b|stickers?|graffiti tag|receipt|ticket|menu|sign only|VW|Kombi|Falcon|Commodore|Camry|Corolla|cars?|vehicles?|motorcycle|truck|locomotive|railcar|\d{1,3} class|signs?|signage|toilets?|plaque|notice board|door handle|close-up|closeup|macro)\b/i;

interface Candidate { title: string; info: ImageInfo; lat?: number; lon?: number; distanceM?: number; bearing?: number; score: number; lead: boolean }

/** The photographs within the radius and the article's lead image, scored for being about the place and spread across authors and spots. */
async function commonsPhotos(centre: LonLat, radiusM: number, suburb: string, placeTitles: string[], leadTitle: string | undefined): Promise<{ candidates: number; picked: Candidate[] }> {
  const geo = await wikiJson<CommonsPages>(`${COMMONS_API}?${new URLSearchParams({ action: 'query', list: 'geosearch', gscoord: `${centre.lat}|${centre.lon}`, gsradius: String(radiusM), gsnamespace: '6', gslimit: '100', format: 'json' })}`, 'Commons geosearch');
  const found = (geo.query?.geosearch ?? []).filter((g) => /\.(jpe?g|png)$/i.test(g.title));
  const titles = [...new Set([...(leadTitle ? [leadTitle] : []), ...found.sort((a, b) => a.dist - b.dist).slice(0, 49).map((g) => g.title)])];
  if (!titles.length) return { candidates: 0, picked: [] };
  const geoByTitle = new Map(found.map((g) => [g.title, g]));
  const info = await wikiJson<CommonsPages>(`${COMMONS_API}?${new URLSearchParams({ action: 'query', prop: 'imageinfo|coordinates', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1024', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|DateTimeOriginal|ObjectName', titles: titles.join('|'), format: 'json' })}`, 'Commons imageinfo');
  const words = [suburb, ...placeTitles].join(' ').toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 3 && !/^(street|road|park|the|and|new|south|wales|sydney)$/.test(w));
  const cands: Candidate[] = [];
  for (const p of Object.values(info.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || !ii.thumburl || !/^image\/(jpeg|png)$/.test(ii.mime ?? '')) continue;
    if ((ii.width ?? 0) < 800 || (ii.height ?? 0) < 500) continue;
    const meta = ii.extmetadata ?? {};
    const licence = stripHtml(meta.LicenseShortName?.value ?? '');
    if (!licence || !OPEN_LICENCE.test(licence)) continue;
    const text = `${p.title} ${stripHtml(meta.ImageDescription?.value ?? '')}`;
    if (NOT_THE_PLACE.test(text)) continue;
    // "Firstname Lastname at Somewhere" is a portrait, whoever the person is
    if (/^File:\p{Lu}[\p{Ll}'’-]+ \p{Lu}[\p{Ll}'’-]+(?: \p{Lu}[\p{Ll}'’-]+)? (?:at|in|with|and|during|visiting) /u.test(p.title)) continue;
    const g = geoByTitle.get(p.title);
    const coord = p.coordinates?.[0] ?? (g ? { lat: g.lat, lon: g.lon } : undefined);
    const db = coord ? distBearing(centre, { lon: coord.lon, lat: coord.lat }) : undefined;
    const lower = text.toLowerCase();
    const lead = p.title === leadTitle;
    let score = lead ? 4 : 0;
    if (lower.includes(suburb.toLowerCase())) score += 2;
    if (words.some((w) => lower.includes(w))) score += 1;
    if (/panoramio|\(\d+\)\.jpe?g$/i.test(p.title)) score -= 0.5;          // a series from one walk; one or two are enough
    if ((ii.width ?? 0) >= (ii.height ?? 0)) score += 0.5;                     // landscape frames fit the strip
    if (db) score -= db.distanceM / 2000;
    cands.push({ title: p.title, info: ii, lat: coord?.lat, lon: coord?.lon, distanceM: db ? Math.round(db.distanceM) : undefined, bearing: db ? Math.round(db.bearing) : undefined, score, lead });
  }
  cands.sort((a, b) => b.score - a.score);
  // spread: at most two frames from one spot (about a hundred metres) or one series, three from one author, the rest to the next best
  const picked: Candidate[] = [];
  const spotCount = new Map<string, number>();
  for (const c of cands) {
    if (picked.length >= MAX_PHOTOS) break;
    const spot = c.lat !== undefined ? `${c.lat.toFixed(3)},${c.lon!.toFixed(3)}` : c.title;
    // a series is the title with its numbers, dates and "(cropped)" gone; one that is numbered like a camera roll gives one frame, another two
    const series = c.title.toLowerCase().replace(/\(cropped[^)]*\)/g, '').replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    const rolled = /\d{6,}|\d{4}-\d{2}-\d{2}/.test(c.title);
    const author = stripHtml(c.info.extmetadata?.Artist?.value ?? '') || 'unknown';
    const k1 = spotCount.get(spot) ?? 0, k2 = spotCount.get(`s:${series}`) ?? 0, k3 = spotCount.get(`a:${author}`) ?? 0;
    if (k1 >= 2 || k2 >= (rolled ? 1 : 2) || k3 >= 3) continue;
    spotCount.set(spot, k1 + 1); spotCount.set(`s:${series}`, k2 + 1); spotCount.set(`a:${author}`, k3 + 1);
    picked.push(c);
  }
  return { candidates: cands.length, picked };
}

async function saveThumb(url: string, file: string, outDir: string): Promise<boolean> {
  try {
    const res = await retryFetch(url, { headers: { 'User-Agent': UA } }, { attempts: 2, timeoutMs: 60_000, label: 'Commons thumbnail' });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return false;
    await writeFile(join(outDir, file), buf);
    return true;
  } catch { return false; }
}

// ---- the places' own photographs ----------------------------------------------------------

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
/** What a place's photograph must not be: a plan, a map, a logo or a crest, a portrait, a room, a sign. */
const NOT_A_VIEW = /\b(logo|map|plan|diagram|coat of arms|crest|emblem|seal|flag|portrait|screenshot|poster|signature|interior|inside|foyer|lobby|plaque|sign|signage|drawing|engraving|painting|postcard)\b/i;

interface WikidataEntities { entities?: Record<string, { sitelinks?: { enwiki?: { title: string } }; claims?: { P18?: { rank?: string; mainsnak?: { datavalue?: { value?: string } } }[] } }> }

/**
 * Each place's own photograph, as `place_photo_<n>.jpg`: Wikidata's image of the article's item (P18, chosen by its
 * editors to show the thing), else the article's lead image where it is a Commons file; kept where Commons holds it
 * under an open licence, large enough to print, and it shows the place — not a plan, a logo or a room. The listing
 * is kept a month; a source that refuses leaves its places to the next one.
 */
export async function fetchPlacePhotos(places: { n: number; title: string }[], outDir: string, cacheKey: string, log: (m: string) => void = () => {}): Promise<PlacePhoto[]> {
  if (!places.length) return [];
  type Found = { n: number; title: string; file: string; source: PlacePhoto['source']; info: ImageInfo };
  // a listing some source refused (Wikimedia limits shared addresses) serves this run but is not kept, so the next
  // run asks again rather than going a month without the photographs it missed
  let refused = false, partial: Found[] | null = null;
  const found = await cachedJson<Found[]>('wikipedia', `${cacheKey}_placephotos`, 30 * DAY_MS, async () => {
    const res = await lookup();
    if (refused) { partial = res; throw new Error('partial listing'); }
    return res;
  }).catch((e: Error) => { if (partial) return partial; throw e; });
  async function lookup(): Promise<Found[]> {
    const files = new Map<number, { file: string; source: PlacePhoto['source'] }>();
    // Wikidata's image, the preferred claim first, for every article at once
    try {
      const wd = await wikiJson<WikidataEntities>(`${WIKIDATA_API}?${new URLSearchParams({ action: 'wbgetentities', sites: 'enwiki', titles: places.map((p) => p.title).join('|'), props: 'claims|sitelinks', sitefilter: 'enwiki', format: 'json' })}`, 'Wikidata images', 3);
      for (const e of Object.values(wd.entities ?? {})) {
        const pl = places.find((p) => p.title === e.sitelinks?.enwiki?.title);
        const claims = (e.claims?.P18 ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue?.value);
        const best = claims.find((c) => c.rank === 'preferred') ?? claims[0];
        if (pl && best) files.set(pl.n, { file: best.mainsnak!.datavalue!.value!, source: 'wikidata' });
      }
    } catch (e: any) { refused = true; log(`  WARN Wikidata images: ${e?.message ?? e}`); }
    // the article's lead image for the rest, where Wikipedia shows one from Commons
    for (const pl of places.filter((p) => !files.has(p.n))) {
      try {
        const j = await wikiJson<RestSummary>(`${WP_REST}/page/summary/${encodeURIComponent(pl.title.replace(/ /g, '_'))}`, 'Wikipedia summary', 2);
        const file = commonsFileOf(j.originalimage?.source);
        if (file) files.set(pl.n, { file, source: 'article' });
      } catch (e: any) { if (!/HTTP 404/.test(String(e?.message))) refused = true; /* left to Street View */ }
    }
    if (!files.size) return [];
    const titles = [...new Set([...files.values()].map((f) => `File:${f.file}`))];
    const info = await wikiJson<CommonsPages>(`${COMMONS_API}?${new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '1280', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|DateTimeOriginal|ObjectName', titles: titles.join('|'), format: 'json' })}`, 'Commons imageinfo', 3);
    const byFile = new Map<string, ImageInfo>();
    for (const pg of Object.values(info.query?.pages ?? {})) if (pg.imageinfo?.[0]) byFile.set(pg.title.replace(/^File:/, '').replace(/_/g, ' '), pg.imageinfo[0]);
    const out: Found[] = [];
    for (const pl of places) {
      const f = files.get(pl.n);
      const ii = f ? byFile.get(f.file.replace(/_/g, ' ')) : undefined;
      if (!f || !ii) continue;
      out.push({ n: pl.n, title: pl.title, file: f.file, source: f.source, info: ii });
    }
    return out;
  }
  const photos: PlacePhoto[] = [];
  for (const c of found) {
    const ii = c.info, meta = ii.extmetadata ?? {};
    const licence = stripHtml(meta.LicenseShortName?.value ?? '');
    const text = `${c.file} ${stripHtml(meta.ImageDescription?.value ?? '')} ${stripHtml(meta.ObjectName?.value ?? '')}`;
    if (!ii.thumburl || !/^image\/(jpeg|png)$/.test(ii.mime ?? '')) continue;
    if ((ii.width ?? 0) < 640 || (ii.height ?? 0) < 400) { log(`  place photo ${c.title}: too small to print`); continue; }
    if (!licence || !OPEN_LICENCE.test(licence)) { log(`  place photo ${c.title}: not under an open licence (${licence || 'none'})`); continue; }
    if (NOT_A_VIEW.test(text)) { log(`  place photo ${c.title}: not a view of the place`); continue; }
    const file = `place_photo_${c.n}.jpg`;
    if (!(await saveThumb(ii.thumburl, file, outDir))) { log(`  WARN place photo ${c.title} did not download`); continue; }
    photos.push({
      n: c.n, title: c.title, file, source: c.source, commonsTitle: `File:${c.file}`,
      author: stripHtml(meta.Artist?.value ?? '') || undefined, licence, licenceUrl: meta.LicenseUrl?.value || undefined,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(`File:${c.file}`.replace(/ /g, '_'))}`,
      date: stripHtml(meta.DateTimeOriginal?.value ?? '').match(/\d{4}(-\d{2}(-\d{2})?)?/)?.[0],
      widthPx: ii.thumbwidth ?? ii.width ?? 0, heightPx: ii.thumbheight ?? ii.height ?? 0,
    });
  }
  return photos;
}

// ---- the whole ------------------------------------------------------------------------

/** Wikipedia's account of the suburb and its places, Commons' photographs saved as `commons_<n>.jpg`, and the aerial over `aerialExtent` saved with the `context` prefix. */
export async function fetchCharacter(opts: { centre: LonLat; suburb: string; aerialExtent: Extent; outDir: string; log?: (m: string) => void; /** Footprint rings, for aiming the places' Street View at their buildings. */ buildings?: number[][][][] }): Promise<CharacterData> {
  const { centre, suburb, outDir } = opts;
  const log = opts.log ?? (() => {});
  await mkdir(outDir, { recursive: true });
  const t0 = Date.now();
  const key = `${centre.lat.toFixed(4)}_${centre.lon.toFixed(4)}_${suburb.toLowerCase().replace(/\W+/g, '-')}`;
  const aerialP = fetchAerial(opts.aerialExtent, 2400, outDir, 'context').catch((e: Error) => { log(`  WARN context aerial failed: ${e.message}`); return null; });
  // Wikipedia and Commons in sequence (one address, one pace); the text a week, the photographs' listing too
  const wiki = await cachedJson<{ summary: WikiSummary | null; note?: string }>('wikipedia', `${key}_summary`, 7 * DAY_MS, async () => {
    try { return { summary: await wikipediaSummary(suburb) }; } catch (e: any) { return { summary: null, note: String(e?.message ?? e) }; }
  });
  let placesRes: { items: WikiPlace[]; note?: string };
  try { placesRes = await cachedJson('wikipedia', `${key}_places`, 7 * DAY_MS, async () => ({ items: await wikipediaPlaces(centre, PLACES_RADIUS_M, wiki.summary?.title) })); }
  catch (e: any) { placesRes = { items: [], note: String(e?.message ?? e) }; }
  let photosRes: { candidates: number; picked: Candidate[]; note?: string };
  try { photosRes = await commonsPhotos(centre, PHOTOS_RADIUS_M, suburb, placesRes.items.map((p) => p.title), wiki.summary?.imageTitle); }
  catch (e: any) { photosRes = { candidates: 0, picked: [], note: String(e?.message ?? e) }; }
  const photos: CommonsPhoto[] = [];
  for (const c of photosRes.picked) {
    const n = photos.length + 1, file = `commons_${n}.jpg`;
    if (!(await saveThumb(c.info.thumburl!, file, outDir))) { log(`  WARN Commons thumbnail ${c.title} did not download`); continue; }
    const meta = c.info.extmetadata ?? {};
    const date = stripHtml(meta.DateTimeOriginal?.value ?? '').match(/\d{4}(-\d{2}(-\d{2})?)?/)?.[0];
    photos.push({
      n, file, title: c.title.replace(/^File:/, '').replace(/\.(jpe?g|png)$/i, ''),
      author: stripHtml(meta.Artist?.value ?? '') || undefined,
      licence: stripHtml(meta.LicenseShortName?.value ?? ''), licenceUrl: meta.LicenseUrl?.value || undefined,
      description: stripHtml(meta.ImageDescription?.value ?? '') || undefined, date,
      lat: c.lat, lon: c.lon, distanceM: c.distanceM, bearing: c.bearing,
      widthPx: c.info.thumbwidth ?? c.info.width ?? 0, heightPx: c.info.thumbheight ?? c.info.height ?? 0,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(c.title.replace(/ /g, '_'))}`, lead: c.lead,
    });
  }
  const aerial = await aerialP;
  const places = placesRes.items.filter((pl) => looksLikePlace(pl.title, pl.description)).slice(0, MAX_PLACES);
  const placeViews = await fetchPlaceViews(places, outDir, 8, log);
  const numbered = places.slice(0, 8).map((pl, i) => ({ n: i + 1, title: pl.title, lon: pl.lon, lat: pl.lat }));
  // each place in its own photograph where Commons has one; Street View for the rest, where it is keyed
  const placePhotos = await fetchPlacePhotos(numbered, outDir, key, log).catch((e: Error) => { log(`  WARN place photographs failed: ${e.message}`); return [] as PlacePhoto[]; });
  const gkey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const placeStreetViews = gkey ? await fetchPlaceStreetViews(numbered.filter((pl) => !placePhotos.some((ph) => ph.n === pl.n)), outDir, gkey, process.env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined, log, opts.buildings ?? []) : [];
  log(`  character: wikipedia ${wiki.summary ? `"${wiki.summary.title}"` : `none (${wiki.note ?? 'no article'})`}; places ${placesRes.note ? `failed (${placesRes.note})` : `${placesRes.items.length} within ${PLACES_RADIUS_M} m`}; commons ${photosRes.note ? `failed (${photosRes.note})` : `${photosRes.candidates} usable, ${photos.length} saved`}; places' own photographs ${placePhotos.length} of ${numbered.length}; aerial ${aerial ? 'yes' : 'no'}; ${Math.round((Date.now() - t0) / 1000)} s`);
  return {
    wikipedia: { ok: wiki.summary !== null, summary: wiki.summary, note: wiki.note },
    places: { ok: !placesRes.note, radiusM: PLACES_RADIUS_M, items: places, note: placesRes.note },
    photos: { ok: !photosRes.note, radiusM: PHOTOS_RADIUS_M, candidates: photosRes.candidates, items: photos, note: photosRes.note },
    aerial,
    placeViews,
    placeStreetViews,
    placePhotos,
    fetchedAt: new Date().toISOString(),
  };
}

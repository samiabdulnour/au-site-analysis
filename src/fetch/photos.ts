// Slide 12: the street-level frames that look at the site, and the
// then-and-now aerial pair. KartaView's nearby-photos listing (no key) gives
// every frame within a radius with its camera position and, for most, a
// heading; a frame is kept when its view cone takes the site in, one per side
// of the site where there is one, and its large thumbnail is saved beside the
// deck with the contributor's name for the attribution the licence asks for.
// Mapillary is read the same way when a client token is set. The 1943 aerial
// survey of Sydney comes as Web Mercator tiles from Spatial Services' tile
// service (level 18 is the finest it answers, about half a metre a pixel);
// today's aerial is the SIX export over the same ground.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFetch } from '../lib/http.js';
import { planStreetViews, metadataService, imageUrl, mapsUrl, type SvView } from './streetView.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { type LonLat, type XY, type Extent } from '../lib/geo.js';
import { panelExtent, type Panel } from '../render/minimap.js';
import { fetchAerial, type AerialResult } from './imagery.js';

const KARTAVIEW_NEARBY = 'https://api.openstreetcam.org/1.0/list/nearby-photos/';
const KARTAVIEW_FILES = 'https://api.openstreetcam.org/';
const MAPILLARY_IMAGES = 'https://graph.mapillary.com/images';
const TILES_1943 = 'https://portal.spatial.nsw.gov.au/tileservices/Hosted/HistoricalImagery1943/MapServer/tile';
const SOURCE_1943 = 'Historical Imagery 1943 (NSW Spatial Services tile service)';
/** The finest level the 1943 service answers; 19 is a 404 everywhere. */
const ZOOM_1943 = 18;
/** An open frame further than this from the site's boundary stands in another street, and does not show the site. */
const FRONTAGE_REACH_M = 25;
const R = 6378137;

/** How far from the site a frame is looked for. */
export const PHOTO_RADIUS_M = 250;
/** Half-angle of the view cone the site must fall in for a frame to face it. */
const FACING_DEG = 40;
/** Beyond this the site is a sliver in the frame. */
const FACING_MAX_M = 120;
/** A frame this near still tells about the street when it looks along it rather than at the site. */
const STREET_MAX_M = 60;
const STREET_OFF_AXIS_DEG = 75;
/** Cameras closer than this show the same thing. */
const MIN_SPACING_M = 20;
export const MAX_PHOTOS = 8;
const LICENCE = 'CC BY-SA 4.0';

export type PhotoSource = 'kartaview' | 'mapillary' | 'google';

export interface StreetPhoto {
  /** Key number on the plan, clockwise from north. */
  n: number;
  /** The saved frame, in the data folder. */
  file: string;
  source: PhotoSource;
  id: string;
  sequenceId?: string;
  author?: string;
  /** Capture date, ISO, where the service gives one. */
  date?: string;
  lon: number;
  lat: number;
  /** Direction of view, degrees clockwise from north. */
  heading: number;
  /** Whether the heading was recorded with the frame or read from the camera's track. */
  headingSource: 'recorded' | 'track';
  /** From the camera to the nearest point of the site, metres. */
  distanceM: number;
  /** From the camera to the site's centre, degrees clockwise from north. */
  bearingToSite: number;
  /** Where the camera stands, seen from the site's centre. */
  bearingFromSite: number;
  /** How far the site's centre lies off the camera's axis. */
  offAxisDeg: number;
  /** Whether the view cone takes the site in, or the frame only looks along the street beside it. */
  facing: 'site' | 'street';
  pageUrl: string;
  licence: string;
  /** The horizontal field of view where the frame was asked for one (Google's), degrees. */
  fov?: number;
  /** What a Google frame was planned to show: a street frontage square on, the corner between two, a long frontage obliquely, or the street from a frontage's camera. */
  view?: SvView['kind'];
}

interface Candidate extends Omit<StreetPhoto, 'n' | 'file'> { thumbUrl: string; score: number; xy: XY }

export interface ThenTile { file: string; xmin: number; ymin: number; xmax: number; ymax: number }

export interface PhotosData {
  radiusM: number;
  kartaview: { ok: boolean; frames: number; withHeading: number; note?: string };
  mapillary: { ok: boolean; frames: number; note?: string };
  /** Google Street View: the site's sides, the street frontages the free metadata service found in front of them, the probes it took and the frames kept. Optional: decks cached before it have none. */
  google?: { ok: boolean; frames: number; frontages: number; sides: number; probes: number; /** Panoramas set aside as standing inside another lot or looking through one. */ offStreet?: number; note?: string };
  photos: StreetPhoto[];
  /** The then-and-now pair: one panel, the 1943 tiles that cover it and today's export. */
  pair: {
    panel: Panel;
    then: { ok: boolean; zoom: number; tiles: ThenTile[]; missing: number; source: string };
    now: AerialResult | null;
  };
  fetchedAt: string;
}

export const emptyPhotos = (pairPanel: Panel): PhotosData => ({
  radiusM: PHOTO_RADIUS_M,
  kartaview: { ok: false, frames: 0, withHeading: 0, note: 'not read' },
  mapillary: { ok: false, frames: 0, note: 'not read' },
  google: { ok: false, frames: 0, frontages: 0, sides: 0, probes: 0, note: 'not read' },
  photos: [],
  pair: { panel: pairPanel, then: { ok: false, zoom: ZOOM_1943, tiles: [], missing: 0, source: SOURCE_1943 }, now: null },
  fetchedAt: new Date().toISOString(),
});

// ---- geometry, in metres about the site ------------------------------------

const toRad = (d: number) => (d * Math.PI) / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const angDiff = (a: number, b: number) => { const d = Math.abs(norm(a) - norm(b)); return d > 180 ? 360 - d : d; };
const bearing = (from: XY, to: XY) => norm((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

/** A flat frame about the site: good to a few centimetres over the radius looked at. */
function localFrame(centre: LonLat) {
  const kx = Math.cos(toRad(centre.lat)) * 111_320, ky = 110_574;
  return (p: LonLat): XY => ({ x: (p.lon - centre.lon) * kx, y: (p.lat - centre.lat) * ky });
}

const segDist = (q: XY, a: XY, b: XY) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
};

function inRing(q: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the site's boundary, zero inside it. */
function distToSite(q: XY, rings: XY[][]): number {
  if (rings.some((r) => inRing(q, r))) return 0;
  let best = Infinity;
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) best = Math.min(best, segDist(q, r[i], r[i + 1]));
  return best;
}

// ---- the services -----------------------------------------------------------

interface RawFrame {
  source: PhotoSource;
  id: string;
  sequenceId?: string;
  sequenceIndex?: number;
  author?: string;
  date?: string;
  lon: number;
  lat: number;
  /** Recorded heading, or NaN. */
  heading: number;
  thumbUrl: string;
  pageUrl: string;
}

interface KvItem {
  id?: string | number; sequence_id?: string | number; sequence_index?: string | number;
  lat?: string | number; lng?: string | number; heading?: string | number | null;
  shot_date?: string | null; date_added?: string | null;
  lth_name?: string | null; name?: string | null; th_name?: string | null; username?: string | null;
}

/** A number from the listing's strings; null, undefined and the empty string are NaN, not zero (a heading of 0 would face north). */
const num = (v: unknown): number => { if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const isoDay = (s: unknown): string | undefined => { const m = String(s ?? '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : undefined; };

/** KartaView's frames within the radius, from its nearby-photos listing (the v2 photo search refuses radii over 150 m). */
async function kartaviewNearby(centre: LonLat, radiusM: number): Promise<RawFrame[]> {
  const key = `${centre.lat.toFixed(5)}_${centre.lon.toFixed(5)}_${radiusM}`;
  const items = await cachedJson<KvItem[]>('kartaview', key, 7 * DAY_MS, async () => {
    const body = new URLSearchParams({ lat: centre.lat.toFixed(6), lng: centre.lon.toFixed(6), radius: String(radiusM), ipp: '500', page: '1' });
    const res = await retryFetch(KARTAVIEW_NEARBY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString() }, { attempts: 3, timeoutMs: 40_000, label: 'KartaView nearby-photos' });
    if (!res.ok) throw new Error(`KartaView nearby-photos returned HTTP ${res.status}`);
    const j = (await res.json()) as { currentPageItems?: KvItem[] };
    return Array.isArray(j.currentPageItems) ? j.currentPageItems : [];
  });
  const out: RawFrame[] = [];
  for (const it of items) {
    const lat = num(it.lat), lon = num(it.lng);
    const path = it.lth_name || it.name || it.th_name;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !path || it.id === undefined) continue;
    const seq = it.sequence_id !== undefined ? String(it.sequence_id) : undefined;
    out.push({
      source: 'kartaview', id: String(it.id), sequenceId: seq, sequenceIndex: num(it.sequence_index),
      author: it.username ? String(it.username) : undefined, date: isoDay(it.shot_date) ?? isoDay(it.date_added),
      lon, lat, heading: num(it.heading),
      thumbUrl: /^https?:/.test(path) ? path : `${KARTAVIEW_FILES}${path.replace(/^\//, '')}`,
      pageUrl: seq && Number.isFinite(num(it.sequence_index)) ? `https://kartaview.org/details/${seq}/${num(it.sequence_index)}` : 'https://kartaview.org/',
    });
  }
  return out;
}

interface MlyItem {
  id?: string; thumb_1024_url?: string; captured_at?: number; sequence?: string; is_pano?: boolean;
  compass_angle?: number; computed_compass_angle?: number;
  geometry?: { coordinates?: number[] }; computed_geometry?: { coordinates?: number[] };
  creator?: { username?: string };
}

/**
 * Mapillary's frames in the radius's bounding box (Graph API v4 `images`,
 * `bbox` as left,bottom,right,top, at most 2,000 a call and a box under
 * 0.01 square degrees: a 250 m radius is a four-hundredth of that). The
 * token is the free client token from its developer page, sent as
 * `access_token`. The structure-from-motion position and heading are taken
 * over the camera's own where Mapillary has computed them, and 360° frames
 * are left out: a panorama has no view cone to test.
 */
async function mapillaryNearby(centre: LonLat, radiusM: number, token: string): Promise<RawFrame[]> {
  const dLat = radiusM / 110_574, dLon = radiusM / (111_320 * Math.cos(toRad(centre.lat)));
  const bbox = [centre.lon - dLon, centre.lat - dLat, centre.lon + dLon, centre.lat + dLat].map((v) => v.toFixed(6)).join(',');
  const params = new URLSearchParams({ access_token: token, fields: 'id,thumb_1024_url,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,creator,sequence,is_pano', bbox, limit: '500' });
  const res = await retryFetch(`${MAPILLARY_IMAGES}?${params}`, { headers: { Accept: 'application/json' } }, { attempts: 3, timeoutMs: 40_000, label: 'Mapillary images' });
  if (!res.ok) throw new Error(`Mapillary images returned HTTP ${res.status}`);
  const j = (await res.json()) as { data?: MlyItem[] };
  const out: RawFrame[] = [];
  for (const it of j.data ?? []) {
    if (it.is_pano) continue;
    const [lon, lat] = it.computed_geometry?.coordinates ?? it.geometry?.coordinates ?? [];
    if (!it.id || !it.thumb_1024_url || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const computedHeading = num(it.computed_compass_angle);
    out.push({
      source: 'mapillary', id: String(it.id), sequenceId: it.sequence, author: it.creator?.username,
      date: it.captured_at ? new Date(it.captured_at).toISOString().slice(0, 10) : undefined,
      lon: lon!, lat: lat!, heading: Number.isFinite(computedHeading) ? computedHeading : num(it.compass_angle), thumbUrl: it.thumb_1024_url,
      pageUrl: `https://www.mapillary.com/app/?pKey=${it.id}&focus=photo`,
    });
  }
  return out;
}

// ---- choosing the frames ------------------------------------------------------

/** Frames without a recorded heading take the direction of travel between their neighbours in the sequence; a dashcam looks where the car goes. */
function fillHeadings(frames: RawFrame[], toXY: (p: LonLat) => XY): { frame: RawFrame; headingSource: 'recorded' | 'track' }[] {
  const bySeq = new Map<string, RawFrame[]>();
  for (const f of frames) if (f.sequenceId) (bySeq.get(f.sequenceId) ?? bySeq.set(f.sequenceId, []).get(f.sequenceId)!).push(f);
  const track = new Map<RawFrame, number>();
  for (const seq of bySeq.values()) {
    const sorted = seq.filter((f) => Number.isFinite(f.sequenceIndex)).sort((a, b) => a.sequenceIndex! - b.sequenceIndex!);
    for (let i = 0; i < sorted.length; i++) {
      if (Number.isFinite(sorted[i].heading)) continue;
      const here = toXY(sorted[i]);
      const prev = sorted[i - 1], next = sorted[i + 1];
      if (prev && dist(toXY(prev), here) > 1.5 && dist(toXY(prev), here) < 60) track.set(sorted[i], bearing(toXY(prev), here));
      else if (next && dist(here, toXY(next)) > 1.5 && dist(here, toXY(next)) < 60) track.set(sorted[i], bearing(here, toXY(next)));
    }
  }
  const out: { frame: RawFrame; headingSource: 'recorded' | 'track' }[] = [];
  for (const f of frames) {
    if (Number.isFinite(f.heading)) { out.push({ frame: f, headingSource: 'recorded' }); continue; }
    const h = track.get(f);
    if (h !== undefined) out.push({ frame: { ...f, heading: h }, headingSource: 'track' });
  }
  return out;
}

function toCandidate(f: RawFrame, headingSource: 'recorded' | 'track', xy: XY, rings: XY[][], today: number): Candidate | null {
  const distanceM = distToSite(xy, rings);
  if (distanceM === 0) return null;                       // a camera on the lot looks out of it
  const centre = { x: 0, y: 0 };
  const bearingToSite = bearing(xy, centre);
  // the cone takes the site in when any of its corners, or its centre, lies within the half-angle
  const off = Math.min(angDiff(f.heading, bearingToSite), ...rings.flatMap((r) => r.map((v) => angDiff(f.heading, bearing(xy, v)))));
  const facing: Candidate['facing'] | null = off <= FACING_DEG && distanceM <= FACING_MAX_M ? 'site' : off <= STREET_OFF_AXIS_DEG && distanceM <= STREET_MAX_M ? 'street' : null;
  if (!facing) return null;
  const ageYears = f.date ? Math.max(0, (today - Date.parse(f.date)) / (365.25 * DAY_MS)) : 8;
  // nearer the axis, about thirty metres off, recent, with a recorded heading: lower is better
  const score = (off / FACING_DEG) * 0.35 + Math.abs(distanceM - 30) / 100 + ageYears * 0.03 + (headingSource === 'track' ? 0.1 : 0) + (facing === 'street' ? 1 : 0);
  return {
    source: f.source, id: f.id, sequenceId: f.sequenceId, author: f.author, date: f.date, lon: f.lon, lat: f.lat,
    heading: Math.round(f.heading * 10) / 10, headingSource, distanceM: Math.round(distanceM), bearingToSite: Math.round(bearingToSite),
    bearingFromSite: Math.round(norm(bearingToSite + 180)), offAxisDeg: Math.round(off), facing, pageUrl: f.pageUrl, licence: LICENCE,
    thumbUrl: f.thumbUrl, score, xy,
  };
}

/** A Street View frame as a candidate: it faces the site by construction, or looks along the street beside it; the URL with the key is used once, to download, and dropped. */
function svCandidate(v: SvView, toXY: (p: LonLat) => XY, rings: XY[][], key: string, secret?: string): Candidate {
  const xy = toXY(v);
  const bearingToSite = bearing(xy, { x: 0, y: 0 });
  const own = v.copyright?.replace(/^©\s*/, '').trim();
  return {
    source: 'google', id: v.panoId, author: own && !/^google$/i.test(own) ? own : undefined, date: v.date, lon: v.lon, lat: v.lat,
    heading: v.heading, headingSource: 'recorded', distanceM: Math.round(distToSite(xy, rings)), bearingToSite: Math.round(bearingToSite),
    bearingFromSite: Math.round(norm(bearingToSite + 180)), offAxisDeg: Math.round(angDiff(v.heading, bearingToSite)), facing: v.kind === 'street' ? 'street' : 'site',
    pageUrl: mapsUrl(v), licence: v.copyright?.trim() || '© Google', fov: v.fov, view: v.kind, thumbUrl: imageUrl(v, key, secret), score: 0, xy,
  };
}

/** One frame per side of the site first, then the sides with fewest frames, each new camera standing apart from the ones chosen; a frame along the street when few face the site. */
function choose(cands: Candidate[]): Candidate[] {
  const chosen: Candidate[] = [];
  const sideOf = (c: Candidate) => Math.round(c.bearingFromSite / 45) % 8;
  const perSide = new Map<number, number>();
  // two frames of one drive a few car lengths apart show the same street; another drive from the same spot is another day
  const sameShot = (c: Candidate, o: Candidate) => Boolean(c.sequenceId) && c.sequenceId === o.sequenceId && dist(c.xy, o.xy) < 60 && angDiff(c.heading, o.heading) < 30;
  const apart = (c: Candidate) => chosen.every((o) => !sameShot(c, o) && (dist(c.xy, o.xy) >= MIN_SPACING_M || angDiff(c.heading, o.heading) >= 60));
  const take = (c: Candidate) => { chosen.push(c); perSide.set(sideOf(c), (perSide.get(sideOf(c)) ?? 0) + 1); };
  const facing = cands.filter((c) => c.facing === 'site').sort((a, b) => a.score - b.score);
  for (const c of facing) { if (chosen.length >= MAX_PHOTOS) break; if (!perSide.has(sideOf(c)) && apart(c)) take(c); }
  // the rest: the side with the fewest frames so far wins, then the score
  for (;;) {
    if (chosen.length >= MAX_PHOTOS) break;
    const rest = facing.filter((c) => !chosen.includes(c) && apart(c));
    if (!rest.length) break;
    rest.sort((a, b) => ((perSide.get(sideOf(a)) ?? 0) - (perSide.get(sideOf(b)) ?? 0)) || (a.score - b.score));
    take(rest[0]);
  }
  if (chosen.length < 3) for (const c of cands.filter((x) => x.facing === 'street').sort((a, b) => a.score - b.score)) { if (chosen.length >= 3) break; if (apart(c)) take(c); }
  return chosen.sort((a, b) => a.bearingFromSite - b.bearingFromSite);
}

async function saveFrame(url: string, file: string, outDir: string): Promise<boolean> {
  try {
    const res = await retryFetch(url, {}, { attempts: 2, timeoutMs: 60_000, label: 'street-level frame' });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000 || !(res.headers.get('content-type') ?? '').startsWith('image/')) return false;
    await writeFile(join(outDir, file), buf);
    return true;
  } catch { return false; }
}

// ---- the 1943 tiles -------------------------------------------------------------

async function fetchThen(extent: Extent, outDir: string): Promise<PhotosData['pair']['then']> {
  const z = ZOOM_1943, size = (2 * Math.PI * R) / 2 ** z, origin = Math.PI * R;
  const tx = (x: number) => Math.floor((x + origin) / size), ty = (y: number) => Math.floor((origin - y) / size);
  const x0 = tx(extent.xmin), x1 = tx(extent.xmax), y0 = ty(extent.ymax), y1 = ty(extent.ymin);
  const jobs: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  if (jobs.length > 80) throw new Error(`the 1943 panel would take ${jobs.length} tiles`);
  const tiles: ThenTile[] = [];
  let missing = 0;
  const worker = async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      const [x, y] = job;
      const res = await retryFetch(`${TILES_1943}/${z}/${y}/${x}`, {}, { attempts: 3, timeoutMs: 30_000, label: '1943 tile' });
      if (res.status === 404) { missing++; continue; }
      if (!res.ok) throw new Error(`1943 tile returned HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || !(res.headers.get('content-type') ?? '').startsWith('image/')) { missing++; continue; }
      const file = `then_${z}_${x}_${y}.png`;
      await writeFile(join(outDir, file), buf);
      tiles.push({ file, xmin: -origin + x * size, xmax: -origin + (x + 1) * size, ymax: origin - y * size, ymin: origin - (y + 1) * size });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  tiles.sort((a, b) => a.file.localeCompare(b.file));
  return { ok: tiles.length > 0, zoom: z, tiles, missing, source: SOURCE_1943 };
}

// ---- the whole ------------------------------------------------------------------

/**
 * The frames that look at the site, saved as `photo_<n>.jpg`, and the pair's
 * 1943 tiles and today's export over `pairPanel`, all in `outDir`.
 */
export async function fetchPhotos(opts: { centre: LonLat; siteRings: number[][][]; pairPanel: Panel; outDir: string; log?: (m: string) => void;
  /** The cadastre's lot rings and the building footprints around the site, which tell Street View's cameras in the street from those in a shop or behind a neighbour; awaited only for Google. */
  lots?: Promise<number[][][]> | number[][][]; buildings?: Promise<number[][][]> | number[][][];
}): Promise<PhotosData> {
  const { centre, pairPanel, outDir } = opts;
  const log = opts.log ?? (() => {});
  await mkdir(outDir, { recursive: true });
  const toXY = localFrame(centre);
  const rings = opts.siteRings.map((r) => r.map(([lon, lat]) => toXY({ lon, lat }))).filter((r) => r.length >= 4);
  const soft = <T,>(p: Promise<T>, fallback: T, name: string): Promise<T> => p.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const token = process.env.MAPILLARY_TOKEN?.trim();
  const gkey = process.env.GOOGLE_MAPS_API_KEY?.trim(), gsecret = process.env.GOOGLE_MAPS_SIGNING_SECRET?.trim() || undefined;
  const pairExtent = panelExtent(pairPanel);
  const noGoogle = { views: [] as SvView[], probes: 0, frontages: 0, sides: 0, offStreet: 0 };

  const t0 = Date.now();
  const [kv, mly, then, now, gv] = await Promise.all([
    kartaviewNearby(centre, PHOTO_RADIUS_M).then((frames) => ({ ok: true, frames, note: undefined as string | undefined }), (e: Error) => ({ ok: false, frames: [] as RawFrame[], note: e.message })),
    token
      ? mapillaryNearby(centre, PHOTO_RADIUS_M, token).then((frames) => ({ ok: true, frames, note: undefined as string | undefined }), (e: Error) => ({ ok: false, frames: [] as RawFrame[], note: e.message }))
      : Promise.resolve({ ok: false, frames: [] as RawFrame[], note: 'not read: no client token (MAPILLARY_TOKEN)' }),
    soft(fetchThen(pairExtent, outDir), { ok: false, zoom: ZOOM_1943, tiles: [], missing: 0, source: SOURCE_1943 }, '1943 aerial'),
    soft(fetchAerial(pairExtent, 900, outDir, 'now'), null, "today's aerial for the pair"),
    gkey
      ? Promise.all([opts.lots ?? [], opts.buildings ?? []]).then(([lots, buildings]) => planStreetViews(opts.siteRings, centre, metadataService(gkey, gsecret), { lots, buildings })).then((r) => ({ ok: true, ...r, note: undefined as string | undefined }), (e: Error) => ({ ok: false, ...noGoogle, note: e.message }))
      : Promise.resolve({ ok: false, ...noGoogle, note: 'not read: no API key (GOOGLE_MAPS_API_KEY)' }),
  ]);

  // the frames within the radius, with a heading for each
  const within = (f: RawFrame) => dist(toXY(f), { x: 0, y: 0 }) <= PHOTO_RADIUS_M;
  const kvIn = kv.frames.filter(within), mlyIn = mly.frames.filter(within);
  const today = Date.now();
  const cands = fillHeadings([...kvIn, ...mlyIn], toXY).map(({ frame, headingSource }) => toCandidate(frame, headingSource, toXY(frame), rings, today)).filter((c): c is Candidate => c !== null && c.distanceM <= FRONTAGE_REACH_M);
  // Google's frames of the frontages first; the open frames fill the cells Google leaves, away from its cameras
  const googleCands = gkey ? gv.views.map((v) => svCandidate(v, toXY, rings, gkey, gsecret)) : [];
  const chosen = [...googleCands, ...choose(cands).filter((c) => googleCands.every((g) => dist(g.xy, c.xy) >= MIN_SPACING_M || angDiff(g.heading, c.heading) >= 60))]
    .slice(0, MAX_PHOTOS).sort((a, b) => a.bearingFromSite - b.bearingFromSite);

  // save the frames; a frame that will not download drops out and the rest close up, still clockwise
  const photos: StreetPhoto[] = [];
  for (const c of chosen) {
    const n = photos.length + 1;
    const file = `photo_${n}.jpg`;
    if (!(await saveFrame(c.thumbUrl, file, outDir))) { log(`  WARN street-level frame ${c.source} ${c.id} did not download`); continue; }
    const { thumbUrl: _u, score: _s, xy: _xy, ...rest } = c;
    photos.push({ n, file, ...rest });
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  const googleKept = photos.filter((p) => p.source === 'google').length;
  log(`  photos: google ${gv.ok ? `${gv.frontages} of ${gv.sides} sides front a street, ${googleKept} frames from ${gv.probes} probes (${gv.offStreet} panoramas off the street or looking through a neighbour)` : gv.note}; kartaview ${kv.ok ? `${kvIn.length} frames (${kvIn.filter((f) => Number.isFinite(f.heading)).length} with a heading)` : `failed (${kv.note})`}; mapillary ${mly.ok ? `${mlyIn.length} frames` : mly.note}; ${cands.filter((c) => c.facing === 'site').length} face the site, ${photos.length} kept; 1943 tiles ${then.tiles.length}${then.missing ? ` (${then.missing} missing)` : ''}; today's aerial ${now ? 'yes' : 'no'}; ${secs} s`);
  return {
    radiusM: PHOTO_RADIUS_M,
    kartaview: { ok: kv.ok, frames: kvIn.length, withHeading: kvIn.filter((f) => Number.isFinite(f.heading)).length, note: kv.note },
    mapillary: { ok: mly.ok, frames: mlyIn.length, note: mly.note },
    google: { ok: gv.ok, frames: googleKept, frontages: gv.frontages, sides: gv.sides, probes: gv.probes, offStreet: gv.offStreet, note: gv.note },
    photos,
    pair: { panel: pairPanel, then, now },
    fetchedAt: new Date().toISOString(),
  };
}

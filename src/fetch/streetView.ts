// Slide 12: Google Street View frames of each street frontage, when
// GOOGLE_MAPS_API_KEY is set (a Google Cloud project with billing and the
// Street View Static API enabled; 10,000 images a month are free, then
// US$7 a thousand; the metadata calls that find the panoramas cost nothing).
//
// The site's outline is simplified to its convex hull, nearly straight runs
// merged. From the middle of each edge a probe goes 12 m out, where the
// street would be, and the metadata service is asked for the outdoor
// panorama nearest it: an edge that finds one standing in front of it is a
// street frontage, and its frame looks back at the edge's middle with a
// field of view wide enough to take the edge in. A corner where two
// frontages meet gets a frame at the corner, a long frontage two oblique
// ones, and each frontage's camera looks along the street both ways; six
// at most, frontages first. Images are 640 × 372, the shape of the slide's
// grid cell, so nothing is cropped and Google's marks stay on the frame.
//
// "Outdoor" is Google's word, and it files some shop interiors under it, so
// the cadastre and the footprints decide: a panorama more than 2 m inside a
// lot that is not the site's, or inside a building, is in a shop, an arcade
// or a car park, and one whose sight line passes through a neighbour's
// footprint, or across more than 8 m of other lots, sees the neighbour. The
// road reserve is not a lot, so a camera in the street passes both.
//
// Google's terms forbid storing Street View content outside its services
// (panorama IDs excepted), and its brand rules bar print. The frames go
// into the deck's own folder for the electronic deck and never into the
// shared cache; each is captioned with its capture date and "© Google", and
// the key never appears in a saved URL.

import { createHmac } from 'node:crypto';
import { retryFetch } from '../lib/http.js';
import type { LonLat } from '../lib/geo.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const METADATA = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const IMAGE = 'https://maps.googleapis.com/maps/api/streetview';
/** The grid cell's shape on slide 12 (94.7 × 55 mm), in the API's pixels. */
export const SV_SIZE = { w: 640, h: 372 };
/** From an edge's middle out to where the street would be. */
export const PROBE_OUT_M = 12;
/** How far the metadata service may look from a probe. */
const PROBE_RADIUS_M = 25;
/** A panorama further than this in front of the edge stands in another street. */
const MAX_CAMERA_M = 45;
const MIN_EDGE_M = 5;
/** Consecutive hull edges within this of each other's direction are one side. */
const MERGE_DEG = 15;
/** A frontage longer than this gets two oblique frames as well. */
const OBLIQUE_EDGE_M = 30;
/** How far off square a frontage frame may meet its side, and an oblique one. */
const SQUARE_DEG = 60, OBLIQUE_DEG = 72;
export const MAX_VIEWS = 6;
/**
 * A camera this far inside a lot other than the site's stands on private
 * land: a shop, an arcade, a car park, a courtyard (Google files some shop
 * interiors as outdoor). Nearer a boundary than this is the cadastre's and
 * the GPS's error at a kerb.
 */
const INSIDE_LOT_M = 2;
/** A sight line that passes further than this through a neighbour's footprint shows the neighbour, not the site. */
const THROUGH_BUILDING_M = 2;
/** Nor may it cross more than this of other lots, for where footprints are missing; a footpath strip or a setback is narrower. */
const ACROSS_LAND_M = 8;
/** Lots and footprints further than this from the site's outline cannot stand between it and a camera. */
const NEAR_M = MAX_CAMERA_M + PROBE_RADIUS_M + 40;

export interface SvMeta { panoId: string; lon: number; lat: number; date?: string; copyright?: string }

export interface SvView extends SvMeta {
  heading: number;
  pitch: number;
  fov: number;
  /** Square to a street frontage, at a corner between two, oblique to a long one, or along the street from a frontage's camera. */
  kind: 'frontage' | 'corner' | 'oblique' | 'street';
  /** The camera's distance to what it looks at, metres. */
  distanceM: number;
}

type P = { x: number; y: number };

/** A local metre frame about a point, both ways. */
function frame(o: LonLat) {
  const kx = 111_320 * Math.cos((o.lat * Math.PI) / 180), ky = 110_574;
  return {
    toXY: (p: LonLat): P => ({ x: (p.lon - o.lon) * kx, y: (p.lat - o.lat) * ky }),
    toLL: (p: P): LonLat => ({ lon: o.lon + p.x / kx, lat: o.lat + p.y / ky }),
  };
}
const norm = (d: number) => ((d % 360) + 360) % 360;
const bearing = (from: P, to: P) => norm((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a: number, b: number) => { const d = Math.abs(norm(a) - norm(b)); return d > 180 ? 360 - d : d; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The convex hull, counter-clockwise, by the monotone chain. */
function hull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [], upper: P[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface SiteEdge { a: P; b: P; mid: P; dir: P; normal: P; length: number }

/** The site's sides: its hull's edges, nearly straight runs merged, slivers dropped; outward normals. */
export function siteEdges(rings: P[][]): SiteEdge[] {
  const h = hull(rings.flat());
  if (h.length < 3) return [];
  // merge consecutive edges that run the same way
  const verts: P[] = [];
  for (let i = 0; i < h.length; i++) {
    const prev = h[(i - 1 + h.length) % h.length], cur = h[i], next = h[(i + 1) % h.length];
    if (angDiff(bearing(prev, cur), bearing(cur, next)) >= MERGE_DEG) verts.push(cur);
  }
  const out: SiteEdge[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const length = dist(a, b);
    if (length < MIN_EDGE_M) continue;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // counter-clockwise, so the outside is on the right
    out.push({ a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir, normal: { x: dir.y, y: -dir.x }, length });
  }
  return out;
}

const pitchFor = (d: number) => (d < 15 ? 12 : d < 30 ? 8 : 5);
const inside = (p: P, poly: P[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const segDist = (q: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
};
const areaCentroid = (r: P[]): P => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j].x * r[i].y - r[i].x * r[j].y; a += f; cx += (r[j].x + r[i].x) * f; cy += (r[j].y + r[i].y) * f; }
  return a ? { x: cx / (3 * a), y: cy / (3 * a) } : r[0];
};

/** Whether a point falls in any of the polygons, each boxed so the far ones are skipped. */
function polygonTest(polys: P[][]): (p: P) => boolean {
  const boxed = polys.filter((r) => r.length >= 3).map((r) => ({ r, x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)) }));
  return (p) => boxed.some((o) => p.x >= o.x0 && p.x <= o.x1 && p.y >= o.y0 && p.y <= o.y1 && inside(p, o.r));
}

/**
 * How deep a point lies inside the lots that are not the site's: zero in the
 * street, else the distance to the boundary of the lot it is in. A road
 * reserve is not a lot in the NSW cadastre, so a camera in the street, and a
 * sight line across it, stay at zero.
 */
export function landDepth(lots: P[][], siteRings: P[][]): (p: P) => number {
  const others = lots.filter((r) => r.length >= 3 && !siteRings.some((s) => inside(areaCentroid(r), s))).map((r) => ({
    r, x0: Math.min(...r.map((p) => p.x)), x1: Math.max(...r.map((p) => p.x)), y0: Math.min(...r.map((p) => p.y)), y1: Math.max(...r.map((p) => p.y)),
  }));
  return (p) => {
    let d = 0;
    for (const o of others) {
      if (p.x < o.x0 || p.x > o.x1 || p.y < o.y0 || p.y > o.y1 || !inside(p, o.r)) continue;
      let edge = Infinity;
      for (let i = 0, j = o.r.length - 1; i < o.r.length; j = i++) edge = Math.min(edge, segDist(p, o.r[j], o.r[i]));
      d = Math.max(d, edge);
    }
    return d;
  };
}

/**
 * The frames to take: for each side, the panorama the metadata service finds
 * in front of it, looking back at the side; then the corners between two
 * frontages; then obliques to the long frontages; then the street both ways
 * from each frontage's camera. A panorama counts only where it stands in the
 * street and sees its target: one inside another lot or a building (a shop,
 * an arcade, a car park) is dropped, and so is one whose sight line passes
 * through a neighbour's footprint or a long way across other lots. `meta` is
 * the metadata service (injected, so the geometry can be tested without
 * Google); `lots` and `buildings` are rings of longitude and latitude.
 */
export async function planStreetViews(
  siteRings: number[][][], centre: LonLat,
  meta: (p: LonLat, radiusM: number) => Promise<SvMeta | null>,
  opts: { max?: number; lots?: number[][][]; buildings?: number[][][] } = {},
): Promise<{ views: SvView[]; probes: number; frontages: number; sides: number; offStreet: number }> {
  const max = opts.max ?? MAX_VIEWS;
  const { toXY, toLL } = frame(centre);
  const rings = siteRings.map((r) => r.map(([lon, lat]) => toXY({ lon, lat }))).filter((r) => r.length >= 3);
  const edges = siteEdges(rings);
  const outline = hull(rings.flat());
  const nearby = (rs: number[][][] | undefined) => (rs ?? []).map((r) => r.map(([lon, lat]) => toXY({ lon, lat }))).filter((r) => r.length >= 3 && r.some((p) => outline.some((q) => dist(p, q) < NEAR_M)));
  const depth = landDepth(nearby(opts.lots), rings);
  // the site's own buildings are what the frames are of, not what stands in their way
  const inBuilding = polygonTest(nearby(opts.buildings).filter((r) => !rings.some((s) => inside(areaCentroid(r), s))));
  const inStreet = (p: P) => !inside(p, outline) && depth(p) <= INSIDE_LOT_M && !inBuilding(p);
  // metre by metre along the sight line, leaving out the camera's own spot and the target's edge
  const clear = (from: P, to: P) => {
    const len = dist(from, to), n = Math.max(1, Math.ceil(len)), step = len / n;
    let built = 0, land = 0;
    for (let i = 1; i < n; i++) {
      if (i * step < 1 || len - i * step < 2) continue;
      const p = { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n };
      if (inBuilding(p)) built += step;
      if (depth(p) > INSIDE_LOT_M) land += step;
    }
    return built <= THROUGH_BUILDING_M && land <= ACROSS_LAND_M;
  };
  let probes = 0, offStreet = 0;
  const ask = async (p: P) => { probes++; const m = await meta(toLL(p), PROBE_RADIUS_M); return m ? { m, at: toXY(m) } : null; };
  const usable = (at: P, target: P) => { const ok = inStreet(at) && clear(at, target); if (!ok) offStreet++; return ok; };
  const view = (m: SvMeta, at: P, target: P, halfWidthM: number, kind: SvView['kind'], fovCap = 100): SvView => {
    const d = Math.max(1, dist(at, target));
    return { ...m, heading: Math.round(bearing(at, target) * 10) / 10, pitch: pitchFor(d), fov: Math.round(clamp((2 * Math.atan(halfWidthM / d) * 180) / Math.PI, 55, fovCap)), kind, distanceM: Math.round(d) };
  };
  // a panorama stands in front of an edge when it is on the edge's outer side, within reach, not far past its ends,
  // and sees its target near enough square: a camera in the cross street past a corner sees the side edge-on
  const fronts = (at: P, e: SiteEdge, target: P, maxOffSquare: number) => {
    const rel = { x: at.x - e.mid.x, y: at.y - e.mid.y };
    const out = rel.x * e.normal.x + rel.y * e.normal.y, along = rel.x * e.dir.x + rel.y * e.dir.y;
    const look = { x: target.x - at.x, y: target.y - at.y }, lookLen = Math.hypot(look.x, look.y) || 1;
    const offSquare = (Math.acos(clamp(-(look.x * e.normal.x + look.y * e.normal.y) / lookLen, -1, 1)) * 180) / Math.PI;
    return out > 1 && out <= MAX_CAMERA_M && Math.abs(along) <= e.length / 2 + 20 && offSquare <= maxOffSquare;
  };

  const frontage: { e: SiteEdge; i: number; v: SvView }[] = [];
  for (const [i, e] of edges.entries()) {
    const hit = await ask({ x: e.mid.x + e.normal.x * PROBE_OUT_M, y: e.mid.y + e.normal.y * PROBE_OUT_M });
    if (hit && fronts(hit.at, e, e.mid, SQUARE_DEG) && usable(hit.at, e.mid)) frontage.push({ e, i, v: view(hit.m, hit.at, e.mid, e.length / 2 + 3, 'frontage') });
  }
  const corners: SvView[] = [];
  for (const f of frontage) {
    const g = frontage.find((x) => x.i === (f.i + 1) % edges.length);
    if (!g || edges.length < 3) continue;
    // the corner, or the middle of a sliver dropped between the two sides
    const v = dist(f.e.b, g.e.a) < 1 ? f.e.b : { x: (f.e.b.x + g.e.a.x) / 2, y: (f.e.b.y + g.e.a.y) / 2 };
    const bis = { x: f.e.normal.x + g.e.normal.x, y: f.e.normal.y + g.e.normal.y };
    const len = Math.hypot(bis.x, bis.y) || 1;
    const hit = await ask({ x: v.x + (bis.x / len) * (PROBE_OUT_M + 4), y: v.y + (bis.y / len) * (PROBE_OUT_M + 4) });
    if (hit && usable(hit.at, v)) corners.push(view(hit.m, hit.at, v, 14, 'corner', 90));
  }
  const obliques: SvView[] = [];
  for (const f of frontage) {
    if (f.e.length <= OBLIQUE_EDGE_M) continue;
    for (const s of [-1, 1]) {
      const along = s * (f.e.length / 2 + 8);
      const hit = await ask({ x: f.e.mid.x + f.e.dir.x * along + f.e.normal.x * PROBE_OUT_M, y: f.e.mid.y + f.e.dir.y * along + f.e.normal.y * PROBE_OUT_M });
      const target = { x: f.e.mid.x + f.e.dir.x * s * (f.e.length / 4), y: f.e.mid.y + f.e.dir.y * s * (f.e.length / 4) };
      if (hit && fronts(hit.at, f.e, target, OBLIQUE_DEG) && usable(hit.at, target)) obliques.push(view(hit.m, hit.at, target, f.e.length / 4 + 4, 'oblique', 80));
    }
  }
  // the street both ways from each frontage's camera: the site visit's brief asks for it, and it fills what a narrow frontage leaves
  const streets: SvView[] = frontage.flatMap((f) => [1, -1].map((s) => ({ ...f.v, heading: Math.round(bearing({ x: 0, y: 0 }, { x: f.e.dir.x * s, y: f.e.dir.y * s }) * 10) / 10, pitch: 3, fov: 80, kind: 'street' as const })));
  // frontages longest first, then corners, obliques and the streets; one frame per panorama and direction
  const byLength = [...frontage].sort((a, b) => b.e.length - a.e.length);
  const ordered = [...byLength.map((f) => f.v), ...corners, ...obliques, ...streets];
  const views: SvView[] = [];
  for (const v of ordered) {
    if (views.some((w) => (w.panoId === v.panoId || Math.hypot((w.lon - v.lon) * 92_000, (w.lat - v.lat) * 110_574) < 8) && angDiff(w.heading, v.heading) < 30)) continue;
    views.push(v);
    if (views.length >= max) break;
  }
  return { views, probes, frontages: frontage.length, sides: edges.length, offStreet };
}

// ---- the service -------------------------------------------------------------------

/** Google's URL signing: HMAC-SHA1 of the path and query with the URL-safe base64 secret, appended URL-safe. */
export function signUrl(url: string, secret?: string): string {
  if (!secret) return url;
  const u = new URL(url);
  const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = createHmac('sha1', key).update(`${u.pathname}${u.search}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return `${url}&signature=${sig}`;
}

export function imageUrl(v: SvView, key: string, secret?: string): string {
  const q = new URLSearchParams({ size: `${SV_SIZE.w}x${SV_SIZE.h}`, pano: v.panoId, heading: v.heading.toFixed(1), pitch: v.pitch.toFixed(1), fov: String(v.fov), return_error_code: 'true', key });
  return signUrl(`${IMAGE}?${q}`, secret);
}

/** The panorama in Google Maps, facing the same way: no key, safe to print. */
export const mapsUrl = (v: SvView) => `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(v.panoId)}&heading=${Math.round(v.heading)}&pitch=${Math.round(v.pitch)}&fov=${v.fov}`;

/** The metadata service, which is free: the outdoor panorama nearest a point within a radius, or null. */
export function metadataService(key: string, secret?: string) {
  return async (p: LonLat, radiusM: number): Promise<SvMeta | null> => {
    const q = new URLSearchParams({ location: `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`, radius: String(radiusM), source: 'outdoor', key });
    const res = await retryFetch(signUrl(`${METADATA}?${q}`, secret), {}, { attempts: 3, timeoutMs: 20_000, label: 'Street View metadata' });
    if (!res.ok) throw new Error(`Street View metadata returned HTTP ${res.status}`);
    const j = (await res.json()) as { status?: string; error_message?: string; pano_id?: string; location?: { lat: number; lng: number }; date?: string; copyright?: string };
    if (j.status === 'OK' && j.pano_id && j.location) return { panoId: j.pano_id, lon: j.location.lng, lat: j.location.lat, date: j.date, copyright: j.copyright };
    if (j.status === 'ZERO_RESULTS' || j.status === 'NOT_FOUND') return null;
    // REQUEST_DENIED, OVER_QUERY_LIMIT…: the key or the project is wrong, so the whole source stops
    throw new Error(`Street View metadata answered ${j.status ?? 'nothing'}${j.error_message ? `: ${j.error_message}` : ''}`);
  };
}

/** A place seen from the street: the panorama nearest it, turned to face it. */
export interface PlaceStreetView { n: number; title: string; file: string; panoId: string; date?: string; copyright?: string; heading: number; distanceM: number; mapsUrl: string }

/**
 * Each place from the street: the outdoor panorama nearest its point (within 80 m), the camera turned to
 * face the point, a field of view that takes in a building at that distance. Saved as `place_sv_<n>.jpg`.
 */
export async function fetchPlaceStreetViews(places: { n: number; title: string; lon: number; lat: number }[], outDir: string, key: string, secret?: string, log: (m: string) => void = () => {}): Promise<PlaceStreetView[]> {
  const meta = metadataService(key, secret);
  const out: PlaceStreetView[] = [];
  for (const pl of places) {
    try {
      // probe the point and eight points 35 m round it; keep Google's own street panoramas (not visitors' uploads, which
      // are often interiors) and take the one that stands back from the place far enough to see it, about 35 m
      const pf = frame({ lon: pl.lon, lat: pl.lat });
      const probes = [{ x: 0, y: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ x: 35 * Math.sin((i * Math.PI) / 4), y: 35 * Math.cos((i * Math.PI) / 4) }))];
      const found = new Map<string, SvMeta & { d: number }>();
      for (const q of probes) {
        const mm = await meta(pf.toLL(q), 30);
        if (!mm || !/google/i.test(mm.copyright ?? '')) continue;
        const r = pf.toXY({ lon: mm.lon, lat: mm.lat });
        found.set(mm.panoId, { ...mm, d: Math.hypot(r.x, r.y) });
      }
      const cands = [...found.values()];
      const m = cands.filter((c) => c.d >= 15 && c.d <= 70).sort((a, b) => Math.abs(a.d - 35) - Math.abs(b.d - 35))[0] ?? cands.sort((a, b) => Math.abs(a.d - 35) - Math.abs(b.d - 35))[0];
      if (!m) { log(`  Street View: no street panorama near ${pl.title}`); continue; }
      const f = frame({ lon: m.lon, lat: m.lat });
      const target = f.toXY({ lon: pl.lon, lat: pl.lat });
      const d = Math.hypot(target.x, target.y);
      const heading = d < 3 ? 0 : norm((Math.atan2(target.x, target.y) * 180) / Math.PI);
      const fov = d < 25 ? 100 : d < 50 ? 85 : 70;
      const view: SvView = { ...m, heading, pitch: pitchFor(d), fov, kind: 'frontage', distanceM: d };
      const res = await retryFetch(imageUrl(view, key, secret), {}, { attempts: 2, timeoutMs: 30_000, label: 'Street View image' });
      if (!res.ok) { log(`  Street View image for ${pl.title}: HTTP ${res.status}`); continue; }
      const file = `place_sv_${pl.n}.jpg`;
      await writeFile(join(outDir, file), Buffer.from(await res.arrayBuffer()));
      out.push({ n: pl.n, title: pl.title, file, panoId: m.panoId, date: m.date, copyright: m.copyright, heading, distanceM: Math.round(d), mapsUrl: mapsUrl(view) });
    } catch (e: any) { log(`  Street View for ${pl.title} failed: ${e?.message ?? e}`); }
  }
  return out;
}

// Potential views from the site.
//
// The office draws a translucent cone at the site edge labelled CITY VIEW or
// BAY VIEW where a view is worth designing for. This finds the candidates —
// the nearest skyline, the water and the coast, the park next door — and
// tests each sight line against the ground: NSW's 5 m elevation surface,
// sampled along the line from the site at its height limit to the target.
// A line the terrain blocks is reported but not drawn.
//
// What it cannot know is what stands on that ground. Building heights are not
// open data in NSW, so a "clear" view here means the land does not rule it out;
// the sheet says so.

import { queryByExtent } from '../lib/arcgis.js';
import { retryFetch } from '../lib/http.js';
import type { Extent, LonLat } from '../lib/geo.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat } from '../lib/geo.js';
import { pointInRing } from '../render/sheet.js';
import type { GeoJSONFC } from '../lib/arcgis.js';

const DEM = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer';
const WATER = 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Water_Theme/FeatureServer';

export type ViewKind = 'city' | 'water' | 'ocean' | 'park';

export interface ViewTarget {
  kind: ViewKind;
  /** 'CITY', 'PARRAMATTA', 'BOTANY BAY', 'OCEAN', 'CENTENNIAL PARK' */
  label: string;
  lon: number;
  lat: number;
  bearingDeg: number;     // true bearing from the site centre
  distanceM: number;
  /** Water only: how far the water reaches along the bearing. A view of water
   *  is a line to its far side, not to the near shore, which a site on a
   *  plateau above the water can never see. */
  farM?: number;
  /** RL of the eye and of the target used for the sight line, m AHD. */
  eyeRL?: number;
  targetRL?: number;
  /** The ground does not block the sight line. Undefined when it could not be checked. */
  clear?: boolean;
  /** Distance along the line where the ground first rises above it. */
  blockedAtM?: number;
  /** Gets a cone on the sheet: clear, and not ranked out by the cone cap. */
  cone?: boolean;
}

/** Skylines worth a cone: centre point, how tall the skyline is, how far it reads. */
interface Skyline { label: string; lon: number; lat: number; topM: number; rangeM: number }
export const SKYLINES: Skyline[] = [
  { label: 'CITY',           lon: 151.2089, lat: -33.8705, topM: 220, rangeM: 20_000 }, // Sydney Tower
  { label: 'NORTH SYDNEY',   lon: 151.2072, lat: -33.8390, topM: 140, rangeM: 8_000 },
  { label: 'CHATSWOOD',      lon: 151.1830, lat: -33.7965, topM: 110, rangeM: 6_000 },
  { label: 'PARRAMATTA',     lon: 151.0035, lat: -33.8145, topM: 150, rangeM: 10_000 },
  { label: 'BONDI JUNCTION', lon: 151.2478, lat: -33.8915, topM: 80,  rangeM: 4_000 },
  { label: 'ST LEONARDS',    lon: 151.1945, lat: -33.8235, topM: 100, rangeM: 4_000 },
  { label: 'HURSTVILLE',     lon: 151.1022, lat: -33.9672, topM: 70,  rangeM: 4_000 },
  { label: 'BANKSTOWN',      lon: 151.0347, lat: -33.9176, topM: 50,  rangeM: 3_000 },
  { label: 'LIVERPOOL',      lon: 150.9240, lat: -33.9200, topM: 60,  rangeM: 4_000 },
  { label: 'BLACKTOWN',      lon: 150.9060, lat: -33.7710, topM: 50,  rangeM: 3_000 },
  { label: 'PENRITH',        lon: 150.6940, lat: -33.7510, topM: 50,  rangeM: 3_000 },
  { label: 'CAMPBELLTOWN',   lon: 150.8140, lat: -34.0650, topM: 40,  rangeM: 3_000 },
  { label: 'NEWCASTLE',      lon: 151.7789, lat: -32.9267, topM: 90,  rangeM: 8_000 },
  { label: 'WOLLONGONG',     lon: 150.8931, lat: -34.4249, topM: 70,  rangeM: 8_000 },
  { label: 'GOSFORD',        lon: 151.3421, lat: -33.4269, topM: 60,  rangeM: 5_000 },
];

/** Great-circle distance (m) and initial bearing (deg, 0 = north) from a to b. */
export function bearingAndDistance(a: LonLat, b: LonLat): { bearingDeg: number; distanceM: number } {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const dφ = φ2 - φ1, dλ = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const distanceM = 2 * R * Math.asin(Math.sqrt(h));
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const bearingDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { bearingDeg, distanceM };
}

/**
 * Does a straight line from (0, eyeRL) to (D, targetRL) clear the ground?
 * `profile` is distance/elevation along the line, and is checked as far as
 * `checkToM` (the shore, for water; D itself otherwise). The first `headM`
 * and the last `tailM` of that are ignored: the site's own ground and the
 * target's surrounds (a shoreline sample can sit a metre up the beach) are
 * not obstructions. Returns the distance of the first blocking sample, or
 * null when clear.
 */
export function firstObstruction(
  profile: { d: number; z: number }[],
  D: number,
  eyeRL: number,
  targetRL: number,
  opts: { headM?: number; tailM?: number; toleranceM?: number; checkToM?: number } = {},
): number | null {
  const head = opts.headM ?? 25, tail = opts.tailM ?? 60, tol = opts.toleranceM ?? 0.3;
  const end = (opts.checkToM ?? D) - tail;
  for (const s of profile) {
    if (s.d < head || s.d > end) continue;
    const line = eyeRL + ((targetRL - eyeRL) * s.d) / D;
    if (s.z > line + tol) return s.d;
  }
  return null;
}

/** Elevations along a line from `from` to `to`, from the NSW 5 m DEM. */
export async function sampleProfile(from: LonLat, to: LonLat, sampleCount: number): Promise<{ d: number; z: number }[]> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ paths: [[[from.lon, from.lat], [to.lon, to.lat]]], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolyline',
    sampleCount: String(sampleCount),
    returnFirstValueOnly: 'true',
    f: 'json',
  });
  const res = await retryFetch(`${DEM}/getSamples?${params}`, {}, { attempts: 3, timeoutMs: 45_000, label: 'DEM samples' });
  if (!res.ok) throw new Error(`DEM -> HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`DEM -> ${JSON.stringify(data.error)}`);
  const out: { d: number; z: number }[] = [];
  for (const s of data.samples ?? []) {
    const z = parseFloat(s.value);
    if (!Number.isFinite(z) || !s.location) continue;
    const { distanceM } = bearingAndDistance(from, { lon: s.location.x, lat: s.location.y });
    out.push({ d: distanceM, z });
  }
  out.sort((a, b) => a.d - b.d);
  if (out.length < 4) throw new Error('DEM returned no usable samples');
  return out;
}

/** Nearest vertex of any ring to `site`, in ground metres, with the vertex. */
function nearestVertex(site: LonLat, rings: number[][][]): { lon: number; lat: number; distanceM: number } | null {
  const P = lonLatToMercator(site);
  const k = mercatorScaleFactor(site.lat);
  let best: { lon: number; lat: number; distanceM: number } | null = null;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const Q = lonLatToMercator({ lon, lat });
      const d = Math.hypot(Q.x - P.x, Q.y - P.y) / k;
      if (!best || d < best.distanceM) best = { lon, lat, distanceM: d };
    }
  }
  return best;
}

/** How far a body of water reaches from `site` within ±`halfDeg` of `bearingDeg`. */
function farthestAlong(site: LonLat, rings: number[][][], bearingDeg: number, halfDeg = 15): number {
  let far = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const bd = bearingAndDistance(site, { lon, lat });
      let diff = Math.abs(bd.bearingDeg - bearingDeg);
      if (diff > 180) diff = 360 - diff;
      if (diff <= halfDeg && bd.distanceM > far) far = bd.distanceM;
    }
  }
  return far;
}

function fcRings(fc: GeoJSONFC): { rings: number[][][]; props: Record<string, any> }[] {
  const out: { rings: number[][][]; props: Record<string, any> }[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const rings: number[][][] = g.type === 'Polygon' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat()
      : g.type === 'MultiLineString' ? g.coordinates
      : g.type === 'LineString' ? [g.coordinates] : [];
    if (rings.length) out.push({ rings, props: f.properties });
  }
  return out;
}

function squareExtent(site: LonLat, halfM: number): Extent {
  const c = lonLatToMercator(site);
  const h = halfM * mercatorScaleFactor(site.lat);
  return { xmin: c.x - h, ymin: c.y - h, xmax: c.x + h, ymax: c.y + h };
}

const WATER_TYPES = new Set(['BAY', 'HARBOUR', 'LAKE', 'LAGOON', 'RIVER', 'ESTUARY', 'COVE', 'INLET', 'CHANNEL', 'OCEAN', 'SEA', 'STRAIT']);
const OPEN_SEA = new Set(['OCEAN', 'SEA']);
const WATER_RANGE_M: Record<string, number> = { RIVER: 2_500, CHANNEL: 1_500 };
const NARROW = new Set(['RIVER', 'CHANNEL', 'ESTUARY', 'INLET']);
const DEFAULT_WATER_RANGE_M = 5_000;
const OCEAN_RANGE_M = 6_000;
/** Below this (Web Mercator m², about 10 ha on the ground) a named water body is a pond. */
const MIN_WATER_AREA = 150_000;
/** Generalisation for the water fetches, degrees (~20 m). */
const WATER_OFFSET = '0.0002';

/**
 * Named water within range — bays, harbours, lakes, rivers — and the open
 * coast. Coastline that runs along a named bay is that bay, not the ocean, so
 * ocean is what is left once every named shore is set aside.
 */
export async function fetchWaterTargets(site: LonLat): Promise<ViewTarget[]> {
  const extent = squareExtent(site, OCEAN_RANGE_M);
  const where = `hydroname IS NOT NULL AND hydronametype IN (${[...WATER_TYPES].map((t) => `'${t}'`).join(',')})`;
  const [areas, coast] = await Promise.all([
    queryByExtent(`${WATER}/6`, extent, 'hydroname,hydronametype,Shape__Area', where, { maxAllowableOffset: WATER_OFFSET }),
    queryByExtent(`${WATER}/4`, extent, 'objectid', '1=1', { maxAllowableOffset: WATER_OFFSET }),
  ]);

  // group the named bodies: one target per name, with its total area
  const byName = new Map<string, { type: string; area: number; rings: number[][][] }>();
  for (const { rings, props } of fcRings(areas)) {
    const name = String(props.hydroname ?? '').trim().toUpperCase();
    const type = String(props.hydronametype ?? '').trim().toUpperCase();
    if (!name) continue;
    const cur = byName.get(name) ?? { type, area: 0, rings: [] };
    cur.area += Number(props.Shape__Area) || 0;
    cur.rings.push(...rings);
    byName.set(name, cur);
  }
  const out: ViewTarget[] = [];
  const namedShore: number[][] = [];
  for (const [name, body] of byName) {
    if (body.area < MIN_WATER_AREA) continue;
    for (const r of body.rings) namedShore.push(...r);
    const near = nearestVertex(site, body.rings);
    if (!near) continue;
    const range = WATER_RANGE_M[body.type] ?? DEFAULT_WATER_RANGE_M;
    if (near.distanceM > range) continue;
    const sea = OPEN_SEA.has(body.type);
    const label = sea ? 'OCEAN' : name.endsWith(body.type) ? name : `${name} ${body.type}`;
    const bd = bearingAndDistance(site, near);
    // A river is seen across, not along: its polygon can run away down the
    // bearing for kilometres, which is not the same as seeing water from here.
    const reach = farthestAlong(site, body.rings, bd.bearingDeg);
    const farM = sea ? bd.distanceM + 20_000
      : Math.max(bd.distanceM + 30, NARROW.has(body.type) ? Math.min(reach, bd.distanceM + 400) : reach);
    out.push({ kind: sea ? 'ocean' : 'water', label, lon: near.lon, lat: near.lat, ...bd, farM });
  }

  // the coast that is not a named shore
  if (!out.some((t) => t.kind === 'ocean')) {
    const P = lonLatToMercator(site);
    const k = mercatorScaleFactor(site.lat);
    const shoreM = namedShore.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
    const farFromNamed = (lon: number, lat: number): boolean => {
      const Q = lonLatToMercator({ lon, lat });
      const lim = 150 * k;
      return !shoreM.some((s) => Math.abs(s.x - Q.x) < lim && Math.abs(s.y - Q.y) < lim && Math.hypot(s.x - Q.x, s.y - Q.y) < lim);
    };
    let best: { lon: number; lat: number; d: number } | null = null;
    for (const { rings } of fcRings(coast)) {
      for (const ring of rings) {
        for (const [lon, lat] of ring) {
          const Q = lonLatToMercator({ lon, lat });
          const d = Math.hypot(Q.x - P.x, Q.y - P.y) / k;
          if (d > OCEAN_RANGE_M || (best && d >= best.d)) continue;
          if (!farFromNamed(lon, lat)) continue;
          best = { lon, lat, d };
        }
      }
    }
    if (best) {
      const bd = bearingAndDistance(site, best);
      out.push({ kind: 'ocean', label: 'OCEAN', lon: best.lon, lat: best.lat, ...bd, farM: bd.distanceM + 20_000 });
    }
  }
  return out;
}

/**
 * Open space touching the site: an RE/C zone polygon within `touchM` of the
 * boundary, named after the park point that falls inside it.
 */
export function parkTargets(
  site: LonLat,
  siteRing: number[][],
  zoning: GeoJSONFC,
  parkPoints: { name: string; lon: number; lat: number }[],
  touchM = 25,
): ViewTarget[] {
  const k = mercatorScaleFactor(site.lat);
  const ringM = siteRing.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const distToSite = (lon: number, lat: number): number => {
    const p = lonLatToMercator({ lon, lat });
    let best = Infinity;
    for (let i = 1; i < ringM.length; i++) {
      const a = ringM[i - 1], b = ringM[i];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
    }
    return best / k;
  };
  const out: ViewTarget[] = [];
  const seen = new Set<string>();
  for (const f of zoning.features) {
    const code = String(f.properties?.SYM_CODE ?? '').toUpperCase();
    if (!/^(RE|C[1-4])/.test(code) || !f.geometry) continue;
    const rings: number[][][] = f.geometry.type === 'Polygon' ? f.geometry.coordinates
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
    for (const ring of rings) {
      if (ring.length < 4) continue;
      // touching: some vertex of the zone within reach of the site boundary,
      // and the zone not being the site itself
      let touching = false;
      for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 200))) {
        if (distToSite(ring[i][0], ring[i][1]) <= touchM) { touching = true; break; }
      }
      if (!touching) continue;
      const name = parkPoints.find((p) => pointInRing(p.lon, p.lat, ring))?.name?.toUpperCase();
      const label = name ?? 'OPEN SPACE';
      if (seen.has(label)) continue;
      seen.add(label);
      let cx = 0, cy = 0;
      for (const [lon, lat] of ring) { cx += lon; cy += lat; }
      const c = { lon: cx / ring.length, lat: cy / ring.length };
      out.push({ kind: 'park', label, lon: c.lon, lat: c.lat, ...bearingAndDistance(site, c), clear: true });
    }
  }
  return out;
}

export interface AssessOpts {
  site: LonLat;
  siteRing: number[][];
  /** LEP height of building at the site, metres; the eye sits just under it. */
  hobM?: number;
  zoning: GeoJSONFC;
  parkPoints: { name: string; lon: number; lat: number }[];
  log?: (m: string) => void;
}

/** Eye height above the site's ground for the sight lines. */
export function eyeAboveGround(hobM?: number): number {
  return Math.max(4, hobM ?? 9) - 1;
}

/**
 * Every candidate, each with its sight line checked where one can be. Park
 * outlooks touch the site and need no check.
 */
export async function assessViews(o: AssessOpts): Promise<{ views: ViewTarget[]; eyeAboveM: number }> {
  const log = o.log ?? (() => {});
  const eyeAboveM = eyeAboveGround(o.hobM);
  const cands: ViewTarget[] = [];
  for (const s of SKYLINES) {
    const bd = bearingAndDistance(o.site, s);
    if (bd.distanceM > s.rangeM || bd.distanceM < 300) continue;
    cands.push({ kind: 'city', label: s.label, lon: s.lon, lat: s.lat, ...bd });
  }
  try {
    cands.push(...await fetchWaterTargets(o.site));
  } catch (e: any) {
    log(`  WARN water targets failed: ${e?.message ?? e}`);
  }
  cands.push(...parkTargets(o.site, o.siteRing, o.zoning, o.parkPoints));

  const views: ViewTarget[] = [];
  for (const t of cands) {
    if (t.kind === 'park') { views.push(t); continue; }
    const topM = t.kind === 'city' ? (SKYLINES.find((s) => s.label === t.label)?.topM ?? 60) : 0.5;
    try {
      const n = Math.max(40, Math.min(400, Math.round(t.distanceM / 15)));
      const profile = await sampleProfile(o.site, t, n);
      const groundSite = profile[0].z;
      const groundTarget = profile[profile.length - 1].z;
      const eyeRL = groundSite + eyeAboveM;
      // A skyline is seen at its top. Water is seen at its surface, on its
      // far side: the line runs to where the water ends, and the ground is
      // checked only as far as the shore.
      const targetRL = t.kind === 'city' ? groundTarget + topM : topM;
      const lineEndM = t.kind === 'city' ? t.distanceM : (t.farM ?? t.distanceM + 500);
      const blockedAt = firstObstruction(profile, lineEndM, eyeRL, targetRL, {
        tailM: t.kind === 'city' ? 400 : 60,
        checkToM: t.distanceM,
      });
      views.push({ ...t, eyeRL: +eyeRL.toFixed(1), targetRL: +targetRL.toFixed(1), clear: blockedAt == null, blockedAtM: blockedAt ?? undefined });
    } catch (e: any) {
      log(`  WARN sight line to ${t.label} not checked: ${e?.message ?? e}`);
      views.push({ ...t });
    }
  }
  const km = (m: number) => `${(m / 1000).toFixed(1)}km`;
  log(`  views: ${views.map((v) => `${v.label} ${km(v.distanceM)} ${v.clear === undefined ? 'unchecked' : v.clear ? 'clear' : `blocked at ${km(v.blockedAtM ?? 0)}`}`).join(' · ') || 'none in range'}`);
  return { views: selectCones(views), eyeAboveM };
}

/** Most cones a sheet carries; the office draws one or two. */
export const MAX_CONES = 4;

/**
 * Which clear views get a cone. Ranked — the city, then water, then the other
 * skylines, then the park next door — and a cone within 20° of a better one
 * is dropped, so a harbour and the skyline beyond it share one cone. Views
 * that are blocked or unchecked are kept in the record but never drawn.
 */
export function selectCones(views: ViewTarget[], max = MAX_CONES): ViewTarget[] {
  const rank = (v: ViewTarget) =>
    v.kind === 'city' && v.label === 'CITY' ? 0 : v.kind === 'ocean' ? 1 : v.kind === 'water' ? 2 : v.kind === 'city' ? 3 : 4;
  const clear = views.filter((v) => v.clear === true).sort((a, b) => rank(a) - rank(b) || a.distanceM - b.distanceM);
  const chosen: ViewTarget[] = [];
  for (const v of clear) {
    if (chosen.length >= max) break;
    const close = chosen.some((c) => {
      let diff = Math.abs(c.bearingDeg - v.bearingDeg);
      if (diff > 180) diff = 360 - diff;
      return diff < 20;
    });
    if (!close) chosen.push(v);
  }
  const drawn = new Set(chosen);
  return views.map((v) => ({ ...v, cone: drawn.has(v) }));
}

/** For the sheet: the point where a ray from the site centre at `bearingDeg` leaves the site. */
export function exitPoint(siteRing: number[][], centre: LonLat, bearingDeg: number): LonLat {
  const C = lonLatToMercator(centre);
  const b = (bearingDeg * Math.PI) / 180;
  const d = { x: Math.sin(b), y: Math.cos(b) };
  let best = 0;
  for (let i = 1; i < siteRing.length; i++) {
    const A = lonLatToMercator({ lon: siteRing[i - 1][0], lat: siteRing[i - 1][1] });
    const B = lonLatToMercator({ lon: siteRing[i][0], lat: siteRing[i][1] });
    const ex = B.x - A.x, ey = B.y - A.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((A.x - C.x) * ey - (A.y - C.y) * ex) / den;
    const u = ((A.x - C.x) * d.y - (A.y - C.y) * d.x) / den;
    if (t > best && u >= 0 && u <= 1) best = t;
  }
  return mercatorToLonLat({ x: C.x + d.x * best, y: C.y + d.y * best });
}

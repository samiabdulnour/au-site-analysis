// The streetscape: both faces of the site's street as elevations, the site's
// side and the side across the road, each a run of Google Street View frames
// laid edge to edge at a true scale over the ground, every property's frontage
// dashed off and named by its address, and the site marked.
//
// The street is the address's own (`addressStreet`), its centreline from the
// NSW Transport Theme. Its axis is the line between its two farthest points;
// distance along it, `s`, is zero opposite the site's centre. From the
// centreline every metre a ray goes out square to each side, and the first
// property boundary it meets (the NSW property layer, which carries each
// property's address) is that metre's frontage; a ray that meets nothing near
// the side's building line is a gap, named after the road that crosses there
// when one does. The ground is the 5 m elevation model at the boundary.
//
// The frames are Google's own panoramas: every one along the centreline (the
// free metadata service asked every 3 m for the nearest, so each drive's
// cameras answer; not those over a road in a tunnel, which Google files as
// outdoor too), and, with the Maps JavaScript API's history (src/fetch/svHistory.ts),
// those taken at the same spots in other years; of them the newest drive's
// and the best other drives' are kept, bare months first, since a street tree
// the car passed bare in July hides nothing (`choosePanoramas`). Each is
// turned square to either face and asked for low and high as the face's
// height needs (`tiersFor`). A frame is a pinhole picture, and a frontage is
// near enough a vertical plane, so the picture maps onto the plane by one
// homography (`planeToImage`); src/render/montage.ts lays every frame on the
// face that way and picks, column by column, the panorama that saw it best.
// Without that, the sheet lays the frames on one by one, each over the strip
// from halfway to its neighbours (`assignStrips`). What stands in front of
// the plane (trees, cars, awnings) reads a little large, and a building set
// back from its boundary a little small, as in any montage.
//
// Google's terms bar storing Street View content outside its services, and
// its brand rules bar print; as on slide 12 the frames go into the drawing's
// own folder, never the shared cache, the sheet credits each face "© Google"
// with the months of capture, and the key never appears in a saved URL.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFetch } from '../lib/http.js';
import type { LonLat } from '../lib/geo.js';
import { metadataService, panoMetadataService, signUrl, type SvMeta } from './streetView.js';
import type { HistoryLookup } from './svHistory.js';

type P = { x: number; y: number };

export const WGS84_A = 6_378_137, WGS84_E2 = 0.006_694_379_990_14;

/** How far out from the centreline a ray looks for a boundary. */
const REACH_M = 40;
/** A boundary this much further out than its side's building line is down a cross street, not on the frontage. */
const GAP_BEYOND_M = 12;
/** Frontages narrower than this are slivers, folded into their neighbour. */
const SLIVER_M = 1.5;
/** A run of rays meeting nothing, narrower than this, is a gap between two boundaries, not a road. */
const MIN_GAP_M = 2.5;
/** A panorama further than this off the centreline stands in another street or a forecourt. */
const OFF_CENTRE_M = 8;
/**
 * A panorama this near a road in a tunnel is in it: Google files those as outdoor too, and its cameras in a
 * tunnel stand on the tunnel's line, where one in the street above, past the portal, stands further off.
 */
const TUNNEL_M = 5;
/** The Street View camera above the road, metres. */
export const CAMERA_HEIGHT_M = 2.5;
/** Square frames, the largest the API serves without a premium plan. */
export const FRAME_PX = 640;
/** How far below the ground at the boundary the picture is kept: the footpath and the kerb. */
export const BELOW_GROUND_M = 1.2;

export interface Frontage {
  s0: number; s1: number;
  /** The property's address as the register gives it, the locality left off; empty for a property without one. */
  address: string;
  /** Its house number, or numbers ("70-76"), and its street, apart, for the label's two lines. */
  number: string;
  street: string;
  site: boolean;
  /** The boundary's distance from the street's axis, metres, to that side. */
  offsetM: number;
}
export interface Gap { s0: number; s1: number; road?: string }
export interface Face {
  /** +1 the axis' left, −1 its right. */
  side: 1 | -1;
  /** The bearing a viewer in the street looks to see this face, degrees. */
  facing: number;
  /** Whether `s` runs left to right for that viewer; the sheet draws the face as the viewer sees it. */
  sRightward: boolean;
  frontages: Frontage[];
  gaps: Gap[];
  /** The ground at the boundary every metre, m AHD (the elevation model's, indicative to about a metre). */
  ground: { s: number; z: number }[];
  /** The side's building line: the median boundary distance from the axis, metres. */
  offsetM: number;
  hasSite: boolean;
}
export interface StreetscapePlan {
  street: string;
  /** The local metre frame's origin, the site's centre. */
  origin: LonLat;
  /** The axis' unit direction (east, north) and the point at s = 0, in the local frame. */
  axis: P; at0: P;
  /** The window along the street, metres. */
  s0: number; s1: number;
  /** The centreline's distance from the axis, every metre. */
  centreline: { s: number; d: number }[];
  faces: Face[];
  site: { s0: number; s1: number } | null;
}

/** A frame of one face: where the camera stood, which way it looked, and the strip of the face it shows. */
export interface ScapeFrame {
  side: 1 | -1;
  file: string;
  panoId: string; date?: string; copyright?: string;
  /** The camera along and off the axis, metres, and its height, m AHD. */
  s: number; d: number; z: number;
  heading: number; pitch: number; fov: number;
  /** The plane the picture is rectified onto: its distance from the axis, metres. */
  planeM: number;
  /** The strip of the face this frame shows. */
  a: number; b: number;
  /** 0 the frame that takes in the footpath and the lower storeys, 1 the one tipped up for the storeys over them. */
  tier: 0 | 1;
  /** The picture's side, pixels (FRAME_PX). */
  px?: number;
}

/**
 * A local metre frame about a point, both ways: east and north on the WGS84 ellipsoid's own radii there, so it
 * agrees with the 3D tiles' east-north-up frame to millimetres across the window.
 */
export function localFrame(o: LonLat) {
  const phi = (o.lat * Math.PI) / 180, w = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  const kx = ((Math.PI / 180) * WGS84_A * Math.cos(phi)) / Math.sqrt(w);
  const ky = ((Math.PI / 180) * WGS84_A * (1 - WGS84_E2)) / w ** 1.5;
  return {
    toXY: (p: LonLat): P => ({ x: (p.lon - o.lon) * kx, y: (p.lat - o.lat) * ky }),
    toLL: (p: P): LonLat => ({ lon: o.lon + p.x / kx, lat: o.lat + p.y / ky }),
  };
}
const norm = (d: number) => ((d % 360) + 360) % 360;
const bearingOf = (v: P) => norm((Math.atan2(v.x, v.y) * 180) / Math.PI);
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
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
  const t = l2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
};
/** Where a ray from `o` along unit `u` first crosses segment ab, as its distance, or Infinity. */
function rayHit(o: P, u: P, a: P, b: P): number {
  const e = { x: b.x - a.x, y: b.y - a.y };
  const den = u.x * e.y - u.y * e.x;
  if (Math.abs(den) < 1e-12) return Infinity;
  const w = { x: a.x - o.x, y: a.y - o.y };
  const t = (w.x * e.y - w.y * e.x) / den, k = (w.x * u.y - w.y * u.x) / den;
  return t > 0 && k >= 0 && k <= 1 ? t : Infinity;
}

const STREET_TYPE = /\b(STREET|ROAD|AVENUE|LANE|PLACE|PARADE|HIGHWAY|DRIVE|CRESCENT|COURT|BOULEVARD|TERRACE|ESPLANADE|CIRCUIT|GROVE|CLOSE|WAY|MALL|ROW|WALK|PLAZA|CIRCLE|RISE|SQUARE)\b/;
/** "70-76 RILEY STREET DARLINGHURST" → number "70-76", street "RILEY STREET". */
export function splitAddress(address: string, housenumber?: string): { number: string; street: string } {
  const a = (address ?? '').toUpperCase().trim();
  const number = (housenumber ?? a.match(/^[\dA-Z]*\d[\dA-Z\-/]*/)?.[0] ?? '').trim();
  const rest = a.slice(a.startsWith(number) ? number.length : 0).trim();
  const m = rest.match(STREET_TYPE);
  return { number, street: m ? rest.slice(0, (m.index ?? 0) + m[0].length) : rest };
}

export interface Property { id: string; address: string; housenumber?: string; rings: number[][][] }
export interface Road { name: string; coords: [number, number][]; tunnel?: boolean }

/**
 * The faces of the street: which property fronts each metre of either side,
 * the gaps where a road or a lane comes in, the building line, and the site's
 * stretch. Pure geometry on lon/lat rings, so it can be tested on made-up
 * streets. `halfLengthM` is how far the window runs either way from the site.
 */
export function planStreetscape(input: {
  street: string; segments: [number, number][][]; centre: LonLat;
  siteRings: number[][][]; properties: Property[]; roads: Road[]; halfLengthM: number;
}): StreetscapePlan | null {
  const f = localFrame(input.centre);
  // points every metre along the street, with its direction there
  const pts: { p: P; dir: P }[] = [];
  for (const seg of input.segments) {
    const xy = seg.map(([lon, lat]) => f.toXY({ lon, lat }));
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i], b = xy[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 0.2) continue;
      const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      for (let t = 0; t < L; t += 1) pts.push({ p: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir });
    }
  }
  if (pts.length < 10) return null;
  // the axis between the street's two farthest points
  const far = (from: P) => pts.reduce((m, q) => (Math.hypot(q.p.x - from.x, q.p.y - from.y) > Math.hypot(m.x - from.x, m.y - from.y) ? q.p : m), from);
  const e1 = far(pts[0].p), e0 = far(e1);
  const len = Math.hypot(e1.x - e0.x, e1.y - e0.y);
  if (len < 20) return null;
  const axis = { x: (e1.x - e0.x) / len, y: (e1.y - e0.y) / len };
  const left = { x: -axis.y, y: axis.x };
  // s = 0 opposite the site's centre (the frame's origin)
  const sSite = -dot(e0, axis);
  const at0 = { x: e0.x + axis.x * sSite, y: e0.y + axis.y * sSite };
  const sOf = (p: P) => dot({ x: p.x - at0.x, y: p.y - at0.y }, axis);
  const dOf = (p: P) => dot({ x: p.x - at0.x, y: p.y - at0.y }, left);
  const ptAt = (s: number, d: number): P => ({ x: at0.x + axis.x * s + left.x * d, y: at0.y + axis.y * s + left.y * d });

  // the centreline every metre over the window, kept inside the street's own ends
  const byS = pts.map((q) => ({ s: sOf(q.p), d: dOf(q.p), dir: dot(q.dir, axis) >= 0 ? q.dir : { x: -q.dir.x, y: -q.dir.y } })).sort((a, b) => a.s - b.s);
  const s0 = Math.max(Math.ceil(byS[0].s), -Math.round(input.halfLengthM));
  const s1 = Math.min(Math.floor(byS[byS.length - 1].s), Math.round(input.halfLengthM));
  if (s1 - s0 < 20) return null;
  let k = 0;
  const centreline: { s: number; d: number; dir: P }[] = [];
  for (let s = s0; s <= s1; s++) {
    while (k < byS.length - 1 && Math.abs(byS[k + 1].s - s) <= Math.abs(byS[k].s - s)) k++;
    centreline.push({ s, d: byS[k].d, dir: byS[k].dir });
  }

  const props = input.properties.map((pr) => ({ pr, rings: pr.rings.map((r) => r.map(([lon, lat]) => f.toXY({ lon, lat }))).filter((r) => r.length >= 3) }))
    .filter((x) => x.rings.length && x.rings.some((r) => r.some((p) => Math.abs(sOf(p)) < input.halfLengthM + REACH_M && Math.abs(dOf(p)) < REACH_M * 2)));
  const site = input.siteRings.map((r) => r.map(([lon, lat]) => f.toXY({ lon, lat }))).filter((r) => r.length >= 3);
  const roads = input.roads.filter((r) => r.name && !r.tunnel && r.name.toUpperCase() !== input.street.toUpperCase())
    .map((r) => ({ name: r.name, xy: r.coords.map(([lon, lat]) => f.toXY({ lon, lat })) }));

  const faces: Face[] = [];
  for (const side of [1, -1] as const) {
    // each metre's first boundary out from the centreline
    type Prop = (typeof props)[number];
    const hits = centreline.map((c): { s: number; who: Prop | null; d: number; site: boolean } => {
      const o = ptAt(c.s, c.d);
      const u = { x: -c.dir.y * side, y: c.dir.x * side };
      let best = Infinity, who: Prop | null = null;
      for (const x of props) for (const r of x.rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const t = rayHit(o, u, r[j], r[i]);
        if (t < best) { best = t; who = x; }
      }
      if (!who || best > REACH_M) return { s: c.s, who: null, d: NaN, site: false };
      const p = { x: o.x + u.x * best, y: o.y + u.y * best };
      const inward = { x: p.x + u.x * 0.6, y: p.y + u.y * 0.6 };
      return { s: c.s, who, d: Math.abs(dOf(p)), site: site.some((r) => inside(inward, r)) };
    });
    const line = median(hits.filter((h) => h.who).map((h) => h.d));
    if (!Number.isFinite(line)) continue;
    for (const h of hits) if (h.who && h.d > line + GAP_BEYOND_M) h.who = null;

    // runs of one property, and of nothing
    type Run = { s0: number; s1: number; who: Prop | null; ds: number[]; site: boolean };
    const runs: Run[] = [];
    for (const h of hits) {
      const last = runs[runs.length - 1];
      if (last && last.who === h.who) { last.s1 = h.s + 0.5; if (h.who) last.ds.push(h.d); last.site ||= h.site; }
      else runs.push({ s0: h.s - 0.5, s1: h.s + 0.5, who: h.who, ds: h.who ? [h.d] : [], site: h.site });
    }
    // slivers and narrow gaps go to the neighbour before them (after them at the start), and two runs of one
    // property that then meet are one, until nothing changes
    for (let changed = true; changed && runs.length > 1; ) {
      changed = false;
      const i = runs.findIndex((r) => (r.who ? r.s1 - r.s0 < SLIVER_M : r.s1 - r.s0 < MIN_GAP_M));
      if (i >= 0) {
        const into = runs[i > 0 ? i - 1 : i + 1], r = runs[i];
        into.s0 = Math.min(into.s0, r.s0); into.s1 = Math.max(into.s1, r.s1);
        runs.splice(i, 1);
        changed = true;
      }
      for (let j = 1; j < runs.length; j++) {
        if (runs[j].who !== runs[j - 1].who) continue;
        Object.assign(runs[j - 1], { s1: runs[j].s1, ds: [...runs[j - 1].ds, ...runs[j].ds], site: runs[j - 1].site || runs[j].site });
        runs.splice(j--, 1);
        changed = true;
      }
    }

    const frontages: Frontage[] = runs.filter((r) => r.who).map((r) => {
      const { number, street } = splitAddress(r.who!.pr.address, r.who!.pr.housenumber);
      const address = number && street ? `${number} ${street}` : (r.who!.pr.address ?? '');
      return { s0: r.s0, s1: r.s1, address, number, street, site: r.site, offsetM: median(r.ds) };
    });
    const gaps: Gap[] = runs.filter((r) => !r.who).map((r) => {
      // the road that crosses the gap's middle, out to the building line and a little past it
      const mid = (r.s0 + r.s1) / 2;
      const c = centreline[Math.round(mid - s0)] ?? centreline[0];
      const o = ptAt(mid, c.d), u = { x: left.x * side, y: left.y * side };
      let road: string | undefined, best = Infinity;
      for (const rd of roads) for (let i = 0; i < rd.xy.length - 1; i++) {
        const t = rayHit(o, u, rd.xy[i], rd.xy[i + 1]);
        if (t < best && t < line + GAP_BEYOND_M) { best = t; road = rd.name; }
      }
      // a road that comes in square to the street runs along the ray, never across it: the road nearest the
      // gap's middle with a stretch inside the gap, out from the centreline, names it
      if (!road) {
        let nearest = 8;
        for (const rd of roads) for (let i = 0; i < rd.xy.length - 1; i++) {
          const a = rd.xy[i], b = rd.xy[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
          for (let t = 0; t <= L; t += 1) {
            const q = { x: a.x + ((b.x - a.x) * t) / (L || 1), y: a.y + ((b.y - a.y) * t) / (L || 1) };
            const qs = sOf(q), qd = (dOf(q) - c.d) * side;
            if (qs < r.s0 - 2 || qs > r.s1 + 2 || qd < 1 || qd > line + GAP_BEYOND_M) continue;
            const off = Math.abs(qs - mid);
            if (off < nearest) { nearest = off; road = rd.name; }
          }
        }
      }
      return { s0: r.s0, s1: r.s1, road };
    });
    const facingVec = { x: left.x * side, y: left.y * side };
    const facing = bearingOf(facingVec);
    // the viewer's right, looking along `facing`, is (cos θ, −sin θ)
    const th = (facing * Math.PI) / 180;
    const sRightward = dot({ x: Math.cos(th), y: -Math.sin(th) }, axis) > 0;
    faces.push({ side, facing, sRightward, frontages, gaps, ground: [], offsetM: line, hasSite: frontages.some((x) => x.site) });
  }
  if (!faces.length) return null;
  const siteRuns = faces.flatMap((fc) => fc.frontages.filter((x) => x.site));
  // the site's face first
  faces.sort((a, b) => Number(b.hasSite) - Number(a.hasSite));
  return {
    street: input.street, origin: input.centre, axis, at0, s0, s1,
    centreline: centreline.map(({ s, d }) => ({ s, d })),
    faces,
    site: siteRuns.length ? { s0: Math.min(...siteRuns.map((x) => x.s0)), s1: Math.max(...siteRuns.map((x) => x.s1)) } : null,
  };
}

/** A point of the plan's frame at s along the axis and d off it, in lon/lat. */
export function planPoint(plan: StreetscapePlan, s: number, d: number): LonLat {
  const left = { x: -plan.axis.y, y: plan.axis.x };
  return localFrame(plan.origin).toLL({ x: plan.at0.x + plan.axis.x * s + left.x * d, y: plan.at0.y + plan.axis.y * s + left.y * d });
}

/** The plan's (s, d) of a lon/lat point. */
export function planCoords(plan: StreetscapePlan, p: LonLat): { s: number; d: number } {
  const q = localFrame(plan.origin).toXY(p), left = { x: -plan.axis.y, y: plan.axis.x };
  const r = { x: q.x - plan.at0.x, y: q.y - plan.at0.y };
  return { s: dot(r, plan.axis), d: dot(r, left) };
}

/**
 * The 3 × 3 homography from a point of a face's plane, (s along the street,
 * z m AHD, 1), to the frame's pixel (u right, v down, homogeneous). The plane
 * stands `planeM` off the axis on the frame's side; the camera at (s, d, z)
 * looks along `heading` (clockwise from north) tipped up by `pitch`, with a
 * horizontal field of view `fov` over a square picture of FRAME_PX.
 */
export function planeToImage(plan: StreetscapePlan, fr: Pick<ScapeFrame, 's' | 'd' | 'z' | 'heading' | 'pitch' | 'fov' | 'planeM' | 'side'>, px = FRAME_PX): number[][] {
  const th = (fr.heading * Math.PI) / 180, ph = (fr.pitch * Math.PI) / 180;
  const fwd = [Math.sin(th) * Math.cos(ph), Math.cos(th) * Math.cos(ph), Math.sin(ph)];
  const right = [Math.cos(th), -Math.sin(th), 0];
  const up = [-Math.sin(th) * Math.sin(ph), -Math.cos(th) * Math.sin(ph), Math.cos(ph)];
  const left = { x: -plan.axis.y, y: plan.axis.x };
  // the plane's origin (s = 0, z = 0) less the camera, and its two directions
  const dd = fr.planeM * fr.side - fr.d;
  const B = [left.x * dd - plan.axis.x * fr.s, left.y * dd - plan.axis.y * fr.s, -fr.z];
  const E = [plan.axis.x, plan.axis.y, 0], Z = [0, 0, 1];
  const d3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const f = px / 2 / Math.tan(((fr.fov / 2) * Math.PI) / 180);
  const R = [[d3(E, right), d3(Z, right), d3(B, right)], [d3(E, up), d3(Z, up), d3(B, up)], [d3(E, fwd), d3(Z, fwd), d3(B, fwd)]];
  // K: u = px/2 + f·x/z, v = px/2 − f·y/z
  return [
    [f * R[0][0] + (px / 2) * R[2][0], f * R[0][1] + (px / 2) * R[2][1], f * R[0][2] + (px / 2) * R[2][2]],
    [-f * R[1][0] + (px / 2) * R[2][0], -f * R[1][1] + (px / 2) * R[2][1], -f * R[1][2] + (px / 2) * R[2][2]],
    [R[2][0], R[2][1], R[2][2]],
  ];
}

export function mul3(a: number[][], b: number[][]): number[][] {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}
export function inv3(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
export const apply3 = (m: number[][], x: number, y: number): [number, number] => {
  const w = m[2][0] * x + m[2][1] * y + m[2][2];
  return [(m[0][0] * x + m[0][1] * y + m[0][2]) / w, (m[1][0] * x + m[1][1] * y + m[1][2]) / w];
};

/** Each frame's strip, for the sheet's one-by-one fallback: halfway to its neighbours along the face, no wider than the picture holds, inside the window. */
export function assignStrips<T extends { s: number; halfM: number }>(cams: T[], s0: number, s1: number): (T & { a: number; b: number })[] {
  const sorted = [...cams].sort((x, y) => x.s - y.s);
  return sorted.map((c, i) => {
    const prev = sorted[i - 1], next = sorted[i + 1];
    const a = Math.max(s0, prev ? (prev.s + c.s) / 2 : -Infinity, c.s - c.halfM);
    const b = Math.min(s1, next ? (next.s + c.s) / 2 : Infinity, c.s + c.halfM);
    return { ...c, a, b };
  }).filter((c) => c.b - c.a > 0.5);
}

// ---- the harvest --------------------------------------------------------------------

/** How far past the window's ends the harvest runs, metres: a camera past an end still sees the end nearly square. */
const HARVEST_PAST_M = 25;
/** The centreline is probed this often, and this far about each probe, so whichever drive's camera is nearest answers. */
const PROBE_STEP_M = 3, PROBE_RADIUS_M = 4;
/** How high over a face's highest ground the frames look, metres: nine storeys at the boundary. */
export const FRAME_REACH_M = 30;
/** Panoramas are kept by bins this long along the street: the newest drive's in each, and other drives' beside them. */
const BIN_M = 6;
/** How many drives a bin keeps, the newest counted, and how many panoramas the street at most. */
const DRIVES_PER_BIN = 3, MAX_PANOS = 150;
/** The cameras' ground is the elevation model's at them, smoothed over this far either way along the street. */
const SMOOTH_M = 12;
/** Degrees of margin below the footpath (Google's marks run along the picture's foot) and over the band. */
const FOOT_MARGIN_DEG = 5, TOP_MARGIN_DEG = 2;
/** A span of the face wider than this takes two frames, a low and a high one, each this wide. */
const ONE_FRAME_SPAN_DEG = 112, TWO_FRAME_FOV = 94;
/** How many pictures are fetched at once. */
const IN_FLIGHT = 4;

export interface Tier { tier: 0 | 1; pitch: number; fov: number }

/**
 * How a camera `distM` from a face looks at it: the picture must take in the face from the footpath below the
 * boundary (`zBotM`) to the top of the band (`zTopM`). One frame where a field of view of 120° or less holds
 * that, never narrower than 100° so it reaches well along the face; else two, a low one and a high one, each
 * 94° wide (two sharper pictures rather than one stretched). Null when the camera is too near the face to frame it.
 */
export function tiersFor(distM: number, zCamM: number, zBotM: number, zTopM: number): Tier[] | null {
  if (distM < 2.5) return null;
  const deg = (z: number) => (Math.atan2(z - zCamM, distM) * 180) / Math.PI;
  const lo = deg(zBotM) - FOOT_MARGIN_DEG, hi = Math.min(88, deg(zTopM) + TOP_MARGIN_DEG);
  const span = hi - lo;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  if (span <= ONE_FRAME_SPAN_DEG) return [{ tier: 0, pitch: r1((lo + hi) / 2), fov: Math.round(Math.max(100, Math.min(120, span + 4))) }];
  return [{ tier: 0, pitch: r1(lo + TWO_FRAME_FOV / 2 - 2), fov: TWO_FRAME_FOV }, { tier: 1, pitch: r1(hi - TWO_FRAME_FOV / 2 + 2), fov: TWO_FRAME_FOV }];
}

/** How bare a street's deciduous trees are in a month, southern hemisphere: midwinter 2, its shoulders 1, else 0. */
export const leafOff = (date?: string) => { const m = Number(date?.slice(5, 7)); return m >= 6 && m <= 8 ? 2 : m === 5 || m === 9 ? 1 : 0; };

/**
 * Which panoramas to keep of all found along the street: by bins of BIN_M, every panorama of the newest year's
 * drives there (the street as it is), and beside them one of each of the best other drives, bare months first and
 * then the newest, DRIVES_PER_BIN drives in all; over `max`, the other drives' go first.
 */
export function choosePanoramas<T extends { s: number; date?: string }>(found: T[], s0: number, max = MAX_PANOS): T[] {
  const bins = new Map<number, T[]>();
  for (const p of found) { const b = Math.floor((p.s - s0) / BIN_M); const l = bins.get(b); if (l) l.push(p); else bins.set(b, [p]); }
  const ranked: { p: T; rank: number }[] = [];
  for (const list of bins.values()) {
    const newestYear = (list.map((p) => p.date ?? '').sort().pop() ?? '').slice(0, 4);
    const own = list.filter((p) => (p.date ?? '').startsWith(newestYear));
    for (const p of own) ranked.push({ p, rank: 0 });
    const rest = list.filter((p) => !own.includes(p)).sort((a, b) => leafOff(b.date) - leafOff(a.date) || (b.date ?? '').localeCompare(a.date ?? ''));
    const drives = new Set<string>();
    for (const p of rest) {
      if (drives.has(p.date ?? '') || drives.size >= DRIVES_PER_BIN - 1) continue;
      drives.add(p.date ?? '');
      ranked.push({ p, rank: drives.size });
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank || a.p.s - b.p.s).slice(0, max).map((r) => r.p).sort((a, b) => a.s - b.s);
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export interface HarvestOpts {
  /** How high over a face’s highest ground the frames look, metres (FRAME_REACH_M). */
  reachM?: number;
  /** Captures to leave out, by month ("2024-10") or year: a footpath walk, whose cameras Google places in the road. */
  skipDrives?: string[];
  /** The panoramas taken at the same spots in other years, when a service for them is given (src/fetch/svHistory.ts). */
  history?: HistoryLookup;
  maxPanos?: number;
  /** Roads in tunnels: a panorama over one is in it. */
  tunnels?: [number, number][][];
}

/**
 * The frames: every Google panorama along the centreline (the nearest to a probe every PROBE_STEP_M, so each
 * drive's cameras answer) and, with a history service, those taken at the same spots in other years; of them the
 * newest drive's and the best other drives' (`choosePanoramas`), each turned square to both faces and asked for
 * low and high as the face's height needs (`tiersFor`), IN_FLIGHT at a time. The camera stands CAMERA_HEIGHT_M
 * over the elevation model's ground, smoothed along the street so neighbouring frames agree. A picture that does
 * not come is a gap in the record. Saved as `scape_<face>_<n>[_up].jpg`.
 */
export async function fetchStreetscapeFrames(
  plan: StreetscapePlan, groundAt: (p: LonLat) => number | undefined,
  outDir: string, key: string, secret?: string, log: (m: string) => void = () => {}, opts: HarvestOpts = {},
): Promise<ScapeFrame[]> {
  const meta = metadataService(key, secret), byId = panoMetadataService(key, secret);
  const f = localFrame(plan.origin);
  const under = (opts.tunnels ?? []).map((t) => t.map(([lon, lat]) => f.toXY({ lon, lat })));
  const nearTunnel = (p: LonLat) => {
    const q = f.toXY(p);
    return under.some((t) => t.some((a, i) => i > 0 && segDist(q, t[i - 1], a) < TUNNEL_M));
  };
  const lineAt = (s: number) => plan.centreline[Math.max(0, Math.min(plan.centreline.length - 1, Math.round(s - plan.s0)))];
  type Pano = SvMeta & { s: number; d: number; ground: number };
  const found = new Map<string, Pano>();
  let inTunnel = 0, offLine = 0;
  const place = (m: SvMeta): boolean => {
    if (found.has(m.panoId) || !/google/i.test(m.copyright ?? '')) return false;
    if (nearTunnel(m)) { inTunnel++; return false; }
    const at = planCoords(plan, m);
    if (at.s < plan.s0 - HARVEST_PAST_M - 3 || at.s > plan.s1 + HARVEST_PAST_M + 3) return false;
    if (Math.abs(at.d - lineAt(at.s).d) > OFF_CENTRE_M) { offLine++; return false; }
    const g = groundAt(m);
    if (g === undefined) return false;
    found.set(m.panoId, { ...m, s: at.s, d: at.d, ground: g });
    return true;
  };
  for (let s = plan.s0 - HARVEST_PAST_M; s <= plan.s1 + HARVEST_PAST_M; s += PROBE_STEP_M) {
    let m: SvMeta | null = null;
    try { m = await meta(planPoint(plan, s, lineAt(s).d), PROBE_RADIUS_M); }
    catch (e: any) { log(`  WARN Street View metadata: ${e?.message ?? e}`); break; }
    if (m) place(m);
  }
  const latest = found.size;
  let older = 0;
  const years = new Set<string>();
  if (opts.history && found.size) {
    try {
      const hist = await opts.history([...found.keys()]);
      const ids = new Set<string>();
      for (const list of hist.values()) for (const t of list) if (!found.has(t.panoId)) ids.add(t.panoId);
      const metas = await pool([...ids], 6, (id) => byId(id).catch(() => null));
      for (const m of metas) if (m && place(m)) { older++; years.add((m.date ?? '').slice(0, 4)); }
    } catch (e: any) { log(`  Street View history not read: ${e?.message ?? e}`); }
  }
  const skip = (opts.skipDrives ?? []).map((d) => d.trim()).filter(Boolean);
  const eligible = [...found.values()].filter((p) => !skip.some((d) => (p.date ?? '').startsWith(d)));
  const kept = choosePanoramas(eligible, plan.s0, opts.maxPanos);
  const drives = new Set(kept.map((p) => p.date ?? ''));
  const months = new Map<string, number>();
  for (const p of found.values()) months.set(p.date ?? '?', (months.get(p.date ?? '?') ?? 0) + 1);
  log(`  streetscape: ${kept.length} panoramas along ${plan.street} of ${found.size} found (${latest} from the latest capture${older ? `, ${older} from ${years.size} other years` : ''}), ${drives.size} drives kept${skip.length ? `, the ${skip.join(', ')} capture set aside` : ''}${inTunnel ? `, ${inTunnel} over a tunnel left out` : ''}${offLine ? `, ${offLine} off the street` : ''}`);
  log(`  captures found: ${[...months].sort(([a], [b]) => b.localeCompare(a)).map(([d, n]) => `${d} (${n})`).join(', ')}`);
  if (!kept.length) return [];

  // the cameras' heights: the elevation model's ground about each, smoothed along the street, and the camera over it
  const all = [...found.values()];
  const zOf = (p: Pano) => median(all.filter((q) => Math.abs(q.s - p.s) <= SMOOTH_M).map((q) => q.ground)) + CAMERA_HEIGHT_M;
  const reach = opts.reachM ?? FRAME_REACH_M;
  const frames: ScapeFrame[] = [];
  for (const face of plan.faces) {
    const zs = face.ground.map((g) => g.z);
    const zTop = (zs.length ? Math.max(...zs) : 0) + reach;
    const groundNear = (s: number, fallback: number) => {
      let best: { s: number; z: number } | null = null;
      for (const g of face.ground) if (!best || Math.abs(g.s - s) < Math.abs(best.s - s)) best = g;
      return best && Math.abs(best.s - s) < 30 ? best.z : fallback;
    };
    const jobs = kept.flatMap((p) => {
      // the building line near the camera, from the frontages within 10 m either side
      const near = face.frontages.filter((x) => x.s1 > p.s - 10 && x.s0 < p.s + 10).map((x) => x.offsetM);
      const planeM = near.length ? median(near) : face.offsetM;
      const dist = planeM - p.d * face.side;
      const zCam = zOf(p);
      return (tiersFor(dist, zCam, groundNear(p.s, p.ground) - BELOW_GROUND_M, zTop) ?? []).map((t) => ({ p, planeM, dist, zCam, ...t }));
    });
    const heading = Math.round(face.facing * 10) / 10;
    const got = await pool(jobs, IN_FLIGHT, async (j) => {
      const q = new URLSearchParams({ size: `${FRAME_PX}x${FRAME_PX}`, pano: j.p.panoId, heading: heading.toFixed(1), pitch: j.pitch.toFixed(1), fov: String(j.fov), return_error_code: 'true', key });
      try {
        const res = await retryFetch(signUrl(`https://maps.googleapis.com/maps/api/streetview?${q}`, secret), {}, { attempts: 2, timeoutMs: 30_000, label: 'Street View image' });
        if (!res.ok) { log(`  Street View image: HTTP ${res.status}`); return null; }
        return Buffer.from(await res.arrayBuffer());
      } catch (e: any) { log(`  Street View image: ${e?.message ?? e}`); return null; }
    });
    const own: (ScapeFrame & { halfM: number })[] = [];
    for (const [k, j] of jobs.entries()) {
      const buf = got[k];
      if (!buf) continue;
      const file = `scape_${face.side > 0 ? 'l' : 'r'}_${kept.indexOf(j.p) + 1}${j.tier ? '_up' : ''}.jpg`;
      await writeFile(join(outDir, file), buf);
      own.push({
        side: face.side, file, panoId: j.p.panoId, date: j.p.date, copyright: j.p.copyright,
        s: j.p.s, d: j.p.d, z: j.zCam, heading, pitch: j.pitch, fov: j.fov, planeM: j.planeM, a: 0, b: 0, tier: j.tier, px: FRAME_PX,
        halfM: j.dist * Math.tan(((j.fov / 2 - 6) * Math.PI) / 180),
      });
    }
    // the one-by-one fallback's strips: halfway to the neighbours among the low frames, the high frame over each the same
    const strips = new Map(assignStrips(own.filter((fr) => fr.tier === 0), plan.s0, plan.s1).map((st) => [st.panoId, st] as const));
    for (const fr of own) {
      const st = strips.get(fr.panoId);
      if (st) { fr.a = st.a; fr.b = st.b; }
      const { halfM: _h, ...frame } = fr;
      frames.push(frame);
    }
    log(`  ${face.side > 0 ? 'left' : 'right'} face: ${own.length} frames of ${jobs.length} asked${own.some((x) => x.tier) ? ', some in two tiers' : ''}`);
  }
  return frames;
}

/** How high a frame reaches over its strip: the lowest point of the picture's top edge between a and b, m AHD. */
export function frameTop(plan: StreetscapePlan, fr: ScapeFrame): number {
  const back = inv3(planeToImage(plan, fr));
  let top = Infinity;
  for (let u = 0; u <= FRAME_PX; u += 8) {
    const [s, z] = apply3(back, u, 0);
    if (s >= fr.a - 0.5 && s <= fr.b + 0.5) top = Math.min(top, z);
  }
  return top;
}

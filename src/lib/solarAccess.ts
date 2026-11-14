// Sun and shadow at mid winter, for the yield study: the ADG's sunlight to the
// apartments a scheme holds (4A-1 and 4A-2), and the shadow it adds to the
// land round it (3B-2), on 21 June between 9 am and 3 pm.
//
// Everything stands in the study's local metres (x east, y north) as prisms:
// a footprint's rings, even-odd so a courtyard is a hole, between two levels.
// A point has the sun when the line from it toward the sun meets no prism.
// The line rises at the sun's altitude, so a prism is passed once the line is
// over its top, and a prism is only looked at where its bounds lie sunward of
// the points asked about.
//
// The apartments are not designed. The study knows how many each storey holds
// (its share of the saleable area), not where they are, so each storey's
// facade (the plate's outline, less a wall built to a side or rear boundary,
// where no window can go) is shared among its apartments in equal lengths,
// each ring of the plate, a courtyard's too, taking apartments by its length.
// An apartment has the sun at an instant when at least a metre of its facade,
// a metre above its floor, does: the ADG's 4A design guidance counts 1 m² of
// sun on the living room's glass, measured 1 m above the floor, and the
// living room is taken to be on the apartment's sunniest face, where a
// designer would put it. Its hours are the quarter hours between 9 am and
// 3 pm AEST it has the sun in, counted whether or not they run together;
// its longest unbroken run is kept too, for a council that reads the hours as
// continuous (`continuous`), and the figures say which reading they take.
//
// The ground is flat and trees cast no shadow: what the figures say is
// indicative, a test of the massing, not a solar access report.

import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import * as polyclip from 'polyclip-ts';
import { civilToUtc, sunPosition } from './solar.js';
import { convexHull, inHull } from './shadows.js';
import { storeyLevels, ringArea, type XY, type YieldResult } from './yield.js';

/** A prism: a footprint's rings (even-odd) between two levels, metres above the ground. */
export interface Block { rings: XY[][]; z0: number; z1: number }

/** The sun at an instant: its position, the unit vector toward it in plan, and the rise of its line per metre. */
export interface Sun { clockMin: number; altitudeDeg: number; azimuthDeg: number; hx: number; hy: number; tan: number }

/** Mid winter as the ADG has it: 21 June, on Australian Eastern Standard Time. */
export const MID_WINTER = { year: 2026, month: 6, day: 21, offsetHours: 10 } as const;

/** The middles of the 24 quarter hours from 9 am to 3 pm, civil minutes: each stands for 15 minutes of sun. */
export const QUARTER_HOURS: number[] = Array.from({ length: 24 }, (_, i) => 9 * 60 + 7.5 + i * 15);
/** On the hour from 9 am to 3 pm, as a shadow diagram is drawn. */
export const ON_THE_HOUR: number[] = [9, 10, 11, 12, 13, 14, 15].map((h) => h * 60);

/** The sun at each civil minute on 21 June at a place; the instants it is under half a degree up are left out. */
export function winterSun(lat: number, lon: number, clockMins: number[] = QUARTER_HOURS): Sun[] {
  const { year, month, day, offsetHours } = MID_WINTER;
  return clockMins.flatMap((clockMin) => {
    const p = sunPosition(lat, lon, civilToUtc(year, month, day, clockMin, offsetHours));
    if (p.altitudeDeg < 0.5) return [];
    const az = (p.azimuthDeg * Math.PI) / 180;
    return [{ clockMin, altitudeDeg: p.altitudeDeg, azimuthDeg: p.azimuthDeg, hx: Math.sin(az), hy: Math.cos(az), tan: Math.tan((p.altitudeDeg * Math.PI) / 180) }];
  });
}

// ---- the hours the ADG asks -----------------------------------------------------

// The Greater Sydney Region's 33 councils, which the ADG's "Sydney Metropolitan Area" is read as, and Newcastle and
// Wollongong: two hours of sun there, three everywhere else (ADG 4A-1). The names as the LEP layers write them,
// pressed to their letters, without the words a council's name carries.
const TWO_HOURS = new Set([
  'BAYSIDE', 'BLACKTOWN', 'BLUEMOUNTAINS', 'BURWOOD', 'CAMDEN', 'CAMPBELLTOWN', 'CANADABAY', 'CANTERBURYBANKSTOWN', 'CUMBERLAND',
  'FAIRFIELD', 'GEORGESRIVER', 'HAWKESBURY', 'HORNSBY', 'HUNTERSHILL', 'INNERWEST', 'KURINGGAI', 'LANECOVE', 'LIVERPOOL', 'MOSMAN',
  'NORTHSYDNEY', 'NORTHERNBEACHES', 'PARRAMATTA', 'PENRITH', 'RANDWICK', 'RYDE', 'STRATHFIELD', 'SUTHERLAND', 'SYDNEY', 'HILLS',
  'WAVERLEY', 'WILLOUGHBY', 'WOLLONDILLY', 'WOOLLAHRA', 'NEWCASTLE', 'WOLLONGONG',
]);

/**
 * The hours of mid-winter sun ADG 4A-1 asks of 70% of the apartments where the site is: two in the Sydney
 * metropolitan area (read as the Greater Sydney Region's councils) and in Newcastle and Wollongong, three
 * elsewhere. `known` is false where the council is not known, and two hours are assumed.
 */
export function adgSunHours(lgaName: string | undefined): { hours: number; where: string; known: boolean } {
  if (!lgaName) return { hours: 2, where: 'the council not known: the Sydney metropolitan area\'s two hours assumed', known: false };
  const key = lgaName.toUpperCase().replace(/\b(CITY|OF|THE|COUNCIL|SHIRE|MUNICIPAL|MUNICIPALITY)\b/g, '').replace(/[^A-Z]/g, '');
  if (key === 'NEWCASTLE' || key === 'WOLLONGONG') return { hours: 2, where: `in ${key === 'NEWCASTLE' ? 'Newcastle' : 'Wollongong'}`, known: true };
  return TWO_HOURS.has(key)
    ? { hours: 2, where: 'in the Sydney metropolitan area', known: true }
    : { hours: 3, where: 'outside Sydney, Newcastle and Wollongong', known: true };
}

// ---- rays -------------------------------------------------------------------------

/** A prism made ready for rays: its bounds, and its edges as flat arrays. */
interface Ready { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array }

function ready(b: Block): Ready | null {
  const rings = b.rings.filter((rg) => rg.length >= 3);
  if (!rings.length || !(b.z1 > b.z0)) return null;
  const n = rings.reduce((t, rg) => t + rg.length, 0);
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, k = 0;
  for (const rg of rings) for (let i = 0; i < rg.length; i++) {
    const p = rg[i], q = rg[(i + 1) % rg.length];
    ax[k] = p.x; ay[k] = p.y; bx[k] = q.x; by[k] = q.y; k++;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, z0: b.z0, z1: b.z1, ax, ay, bx, by };
}

/** Inside the prism's footprint, even-odd over all its rings. */
function insideReady(r: Ready, x: number, y: number): boolean {
  let c = false;
  for (let i = 0; i < r.ax.length; i++) {
    const ay = r.ay[i], by = r.by[i];
    if (ay > y !== by > y && x < ((r.bx[i] - r.ax[i]) * (y - ay)) / (by - ay) + r.ax[i]) c = !c;
  }
  return c;
}

/** Whether the line from (px, py, pz) toward the sun passes through the prism. */
function hits(r: Ready, px: number, py: number, pz: number, s: Sun): boolean {
  if (r.z1 <= pz) return false;
  // Along the line, d metres out in plan: over the prism's top past dTop, under its foot before dFoot.
  const dTop = (r.z1 - pz) / s.tan, dFoot = Math.max(0, (r.z0 - pz) / s.tan);
  let lo = dFoot, hi = dTop;
  // where the line is over the prism's bounds
  if (Math.abs(s.hx) < 1e-12) { if (px < r.x0 || px > r.x1) return false; }
  else { let a = (r.x0 - px) / s.hx, b = (r.x1 - px) / s.hx; if (a > b) [a, b] = [b, a]; lo = Math.max(lo, a); hi = Math.min(hi, b); }
  if (Math.abs(s.hy) < 1e-12) { if (py < r.y0 || py > r.y1) return false; }
  else { let a = (r.y0 - py) / s.hy, b = (r.y1 - py) / s.hy; if (a > b) [a, b] = [b, a]; lo = Math.max(lo, a); hi = Math.min(hi, b); }
  if (lo > hi) return false;
  // Where the line crosses the outline, within [lo, hi]: the stretches between the crossings are wholly in or out,
  // and each one's middle says which.
  const cuts = [lo, hi];
  for (let i = 0; i < r.ax.length; i++) {
    const ex = r.bx[i] - r.ax[i], ey = r.by[i] - r.ay[i];
    const den = s.hx * ey - s.hy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = r.ax[i] - px, wy = r.ay[i] - py;
    const d = (wx * ey - wy * ex) / den, u = (wx * s.hy - wy * s.hx) / den;
    if (u >= 0 && u <= 1 && d > lo && d < hi) cuts.push(d);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-9) continue;
    const m = (cuts[i] + cuts[i - 1]) / 2;
    if (insideReady(r, px + s.hx * m, py + s.hy * m)) return true;
  }
  return cuts.length === 2 && hi - lo < 1e-9 ? insideReady(r, px + s.hx * lo, py + s.hy * lo) : false;
}

/** The prisms that could stand between any point of a box (at `zMin` or above) and the sun: those over the box's sweep toward it. */
function sunward(list: Ready[], box: { x0: number; y0: number; x1: number; y1: number }, zMin: number, s: Sun): Ready[] {
  let top = -Infinity;
  for (const r of list) top = Math.max(top, r.z1);
  if (!(top > zMin)) return [];
  const D = (top - zMin) / s.tan;
  const x0 = Math.min(box.x0, box.x0 + s.hx * D), x1 = Math.max(box.x1, box.x1 + s.hx * D);
  const y0 = Math.min(box.y0, box.y0 + s.hy * D), y1 = Math.max(box.y1, box.y1 + s.hy * D);
  return list.filter((r) => r.z1 > zMin && r.x1 >= x0 && r.x0 <= x1 && r.y1 >= y0 && r.y0 <= y1);
}

const shaded = (list: Ready[], x: number, y: number, z: number, s: Sun) => list.some((r) => hits(r, x, y, z, s));

/** Whether a point has the sun: no prism stands between it and the sun. For the tests and for single questions. */
export function inSun(p: XY & { z: number }, s: Sun, blocks: Block[]): boolean {
  return !shaded(blocks.map(ready).filter((r): r is Ready => !!r), p.x, p.y, p.z, s);
}

// ---- the apartments ------------------------------------------------------------------

/** A stretch of a plate's outline: the edge from ring[edge] to the next corner, from t0 to t1 of its length. */
export interface FacadePiece { ring: number; edge: number; t0: number; t1: number }

/** An apartment as the sun study places it: its tier and storey, its stretch of facade, and its hours of sun. */
export interface SunUnit {
  tier: number;
  storey: number;
  pieces: FacadePiece[];
  /** Hours of sun at mid winter with the neighbours as they stand, and the longest of them unbroken. */
  hours: number;
  run: number;
  /** And with the neighbours built to their controls, where a future was given. */
  hoursFuture?: number;
  runFuture?: number;
}

export interface ApartmentSun {
  /** The hours ADG 4A-1 asks of 70% of the apartments here, and whether they must run unbroken. */
  hoursRequired: number;
  continuous: boolean;
  units: SunUnit[];
  /** The apartments the study counts, those with the hours asked, those with no sun at all; and the same with the neighbours built out. */
  total: number;
  meeting: number;
  none: number;
  future?: { meeting: number; none: number };
}

/** A point on a facade, a metre's worth of it or less: where it is, the way it faces, and the stretch it stands for. */
interface Sample { ring: number; edge: number; t: number; x: number; y: number; nx: number; ny: number; len: number; window: boolean }

function evenOdd(rings: XY[][], x: number, y: number): boolean {
  let c = false;
  for (const rg of rings) for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    if (rg[i].y > y !== rg[j].y > y && x < ((rg[j].x - rg[i].x) * (y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c;
  }
  return c;
}

function segDist(x: number, y: number, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/**
 * The facade of a plate, sampled every `step` metres: each sample's outward normal (the side of the edge that is
 * not the plate), and whether a window can stand there, which it cannot within 0.6 m of a boundary edge marked
 * blank (a side or rear boundary the plate is built to).
 */
function facadeSamples(plate: XY[][], boundary: XY[], blank: boolean[], step: number): Sample[] {
  const out: Sample[] = [];
  plate.forEach((rg, ring) => {
    if (rg.length < 3) return;
    for (let edge = 0; edge < rg.length; edge++) {
      const p = rg[edge], q = rg[(edge + 1) % rg.length];
      const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
      if (L < 0.2) continue;
      // the outward side: of the edge's two sides, the one not in the plate
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, ux = -dy / L, uy = dx / L;
      const left = evenOdd(plate, mx + ux * 0.3, my + uy * 0.3), right = evenOdd(plate, mx - ux * 0.3, my - uy * 0.3);
      if (left === right) continue;
      const nx = left ? -ux : ux, ny = left ? -uy : uy;
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, x = p.x + dx * t, y = p.y + dy * t;
        let window = true;
        for (let e = 0; e < boundary.length && window; e++) if (blank[e] && segDist(x, y, boundary[e], boundary[(e + 1) % boundary.length]) < 0.6) window = false;
        out.push({ ring, edge, t, x, y, nx, ny, len: L / n, window });
      }
    }
  });
  return out;
}

/** Whole counts shared out in proportion to weights, by largest remainder, summing to `n`. */
function shareOut(n: number, weights: number[]): number[] {
  const sum = weights.reduce((t, w) => t + w, 0);
  if (!(sum > 0) || n <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (n * w) / sum);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((t, v) => t + v, 0);
  for (const i of raw.map((_, i) => i).sort((a, b) => (raw[b] % 1) - (raw[a] % 1))) { if (left <= 0) break; if (weights[i] > 0) { out[i]++; left--; } }
  return out;
}

/** The prisms a study's scheme builds: each tier's plate from the foot of its first storey to the top of its last built. */
export function schemeBlocks(y: YieldResult): (Block & { tier: number })[] {
  const z = storeyLevels(y);
  return y.tiers.flatMap((t, tier) => {
    const top = Math.min(t.to, y.storeys);
    return top >= t.from && t.plate.length ? [{ rings: t.plate, z0: z.bottom(t.from), z1: z.top(top), tier }] : [];
  });
}

export interface ApartmentSunInput {
  /** The site's boundary, and per edge whether no window can face it (a side or rear boundary, built to). */
  boundary: XY[];
  blank: boolean[];
  lat: number;
  lon: number;
  /** The neighbours as they stand, and as they may rise (the same with their futures), where a future is given. */
  context: Block[];
  future?: Block[];
  hoursRequired: number;
  /** Whether the hours asked must run unbroken (a council's reading); counted in all where unset, as the ADG's criteria read. */
  continuous?: boolean;
  /** Where the sun is looked for: this far above the floor, on at least this much facade; the facade sampled this finely. Metres. */
  sillM?: number;
  litM?: number;
  stepM?: number;
}

/**
 * The hours of mid-winter sun each apartment of a study's scheme gets, the apartments laid along each storey's
 * facade as the header says; undefined where the scheme holds no apartments.
 */
export function apartmentSun(y: YieldResult, o: ApartmentSunInput): ApartmentSun | undefined {
  if (!y.units.total) return undefined;
  const sill = o.sillM ?? 1, lit = o.litM ?? 1, step = o.stepM ?? 0.5;
  const z = storeyLevels(y);
  const residential = y.floors.filter((f) => f.use === 'residential' && f.gfa > 0);
  if (!residential.length) return undefined;
  // the apartments each storey holds: its share of the residential floor area
  const counts = shareOut(y.units.total, residential.map((f) => f.gfa));
  const samplesOf = new Map<number, Sample[]>();
  // each apartment as it is worked: its samples, the level the sun is looked for at, and the runs it is in now
  const units: (SunUnit & { samples: Sample[]; z: number; now: number; nowFuture: number })[] = [];
  residential.forEach((f, i) => {
    const n = counts[i];
    if (!n) return;
    const t = y.tiers[f.tier];
    if (!t?.plate.length) return;
    let samples = samplesOf.get(f.tier);
    if (!samples) { samples = facadeSamples(t.plate, o.boundary, o.blank, step); samplesOf.set(f.tier, samples); }
    const windows = samples.filter((sm) => sm.window);
    if (!windows.length) return;
    // each ring takes apartments by the length of its windowed facade, and shares that length among them evenly
    const rings = [...new Set(windows.map((sm) => sm.ring))];
    const lengths = rings.map((r) => windows.filter((sm) => sm.ring === r).reduce((tt, sm) => tt + sm.len, 0));
    const perRing = shareOut(n, lengths);
    rings.forEach((r, ri) => {
      const k = perRing[ri];
      if (!k) return;
      const along = windows.filter((sm) => sm.ring === r);
      const each = lengths[ri] / k;
      const groups: Sample[][] = Array.from({ length: k }, () => []);
      let run = 0;
      for (const sm of along) { groups[Math.min(k - 1, Math.floor((run + sm.len / 2) / each))].push(sm); run += sm.len; }
      for (const g of groups) {
        if (!g.length) continue;
        const pieces: FacadePiece[] = [];
        for (const sm of g) {
          const last = pieces[pieces.length - 1];
          // half the sample's stretch, as a fraction of its edge
          const half = sm.len / 2 / Math.max(1e-9, edgeLength(t.plate, sm));
          if (last && last.ring === sm.ring && last.edge === sm.edge) last.t1 = sm.t + half;
          else pieces.push({ ring: sm.ring, edge: sm.edge, t0: sm.t - half, t1: sm.t + half });
        }
        units.push({ tier: f.tier, storey: f.storey, pieces, hours: 0, run: 0, samples: g, z: z.bottom(f.storey) + sill, now: 0, nowFuture: 0 });
      }
    });
  });
  if (!units.length) return undefined;

  const own = schemeBlocks(y).map(ready).filter((r): r is Ready => !!r);
  const near = (list: Block[]) => list.map(ready).filter((r): r is Ready => !!r);
  const today = [...near(o.context), ...own];
  const later = o.future ? [...near(o.future), ...own] : undefined;
  const all = units.flatMap((u) => u.samples);
  const box = { x0: Math.min(...all.map((s) => s.x)), y0: Math.min(...all.map((s) => s.y)), x1: Math.max(...all.map((s) => s.x)), y1: Math.max(...all.map((s) => s.y)) };
  const zMin = Math.min(...units.map((u) => u.z));
  const OFF = 0.05, FACING = Math.sin((5 * Math.PI) / 180);
  const hoursIn = (list: Ready[], s: Sun, u: (typeof units)[number]) => {
    let got = 0;
    for (const sm of u.samples) {
      // the sun more than 5° off the facade's plane, and nothing between
      if (s.hx * sm.nx + s.hy * sm.ny <= FACING) continue;
      if (shaded(list, sm.x + sm.nx * OFF, sm.y + sm.ny * OFF, u.z, s)) continue;
      got += sm.len;
      if (got >= lit - 1e-6) return true;
    }
    return false;
  };
  const suns = winterSun(o.lat, o.lon);
  for (const s of suns) {
    const nowToday = sunward(today, box, zMin, s);
    const nowLater = later ? sunward(later, box, zMin, s) : undefined;
    for (const u of units) {
      if (hoursIn(nowToday, s, u)) { u.hours += 0.25; u.now += 0.25; u.run = Math.max(u.run, u.now); } else u.now = 0;
      if (nowLater) {
        u.hoursFuture ??= 0; u.runFuture ??= 0;
        if (hoursIn(nowLater, s, u)) { u.hoursFuture += 0.25; u.nowFuture += 0.25; u.runFuture = Math.max(u.runFuture, u.nowFuture); } else u.nowFuture = 0;
      }
    }
  }
  const req = o.hoursRequired - 1e-9, continuous = !!o.continuous;
  const out: SunUnit[] = units.map(({ samples: _s, z: _z, now: _n, nowFuture: _f, ...u }) => u);
  return {
    hoursRequired: o.hoursRequired, continuous, units: out, total: out.length,
    meeting: out.filter((u) => meetsSun(u, req, continuous)).length,
    none: out.filter((u) => u.hours === 0).length,
    ...(later ? { future: { meeting: out.filter((u) => meetsSun(u, req, continuous, true)).length, none: out.filter((u) => !u.hoursFuture).length } } : {}),
  };
}

// ---- the sun on each facade ----------------------------------------------------------

/** A face of the scheme: one edge of a tier's plate, the storeys it rises through, and its hours of sun, cell by cell. */
export interface FacadeFace {
  tier: number;
  ring: number;
  edge: number;
  /** Its ends, ordered so the building is on the left going from a to b: seen from outside, a is on the left. */
  a: XY;
  b: XY;
  /** The way it faces (outward, a unit vector) and its compass bearing. */
  normal: XY;
  bearing: number;
  lengthM: number;
  /** A courtyard's wall rather than an outside one. */
  courtyard: boolean;
  /** Built to a side or rear boundary: a blank wall, no windows to have sun. */
  blank: boolean;
  from: number;
  to: number;
  /** A cell a storey high and about `cellM` wide: its storey, its span along the face (0 at a, 1 at b), its hours today and built out. */
  cells: { storey: number; t0: number; t1: number; hours: number; hoursFuture?: number }[];
}

/**
 * The hours of mid-winter sun on every face of a scheme, storey by storey in cells about `cellM` wide, each read at its
 * middle `sillM` above its floor, against the neighbours (and their futures, where given) and the scheme's own tiers.
 */
export function facadeSun(y: YieldResult, o: { context: Block[]; future?: Block[]; lat: number; lon: number; boundary: XY[]; blank: boolean[]; cellM?: number; sillM?: number }): FacadeFace[] {
  const cellM = o.cellM ?? 3, sill = o.sillM ?? 1;
  const z = storeyLevels(y);
  const faces: FacadeFace[] = [];
  y.tiers.forEach((t, tier) => {
    const top = Math.min(t.to, y.storeys);
    if (top < t.from || !t.plate.length) return;
    t.plate.forEach((rg, ring) => {
      if (rg.length < 3) return;
      // a ring inside another of the plate's is a courtyard's
      const courtyard = t.plate.some((other, k) => k !== ring && other.length >= 3 && evenOdd([other], rg[0].x, rg[0].y));
      for (let edge = 0; edge < rg.length; edge++) {
        const p = rg[edge], q = rg[(edge + 1) % rg.length];
        const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
        if (L < 1) continue;
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, lx = -dy / L, ly = dx / L;
        const left = evenOdd(t.plate, mx + lx * 0.3, my + ly * 0.3), right = evenOdd(t.plate, mx - lx * 0.3, my - ly * 0.3);
        if (left === right) continue;
        // outward is the side the plate is not; the building on the left going from a to b
        const normal = left ? { x: -lx, y: -ly } : { x: lx, y: ly };
        const [a, b] = left ? [p, q] : [q, p];
        const blankWall = o.boundary.some((u, e) => o.blank[e] && segDist(mx, my, u, o.boundary[(e + 1) % o.boundary.length]) < 0.6);
        const n = Math.max(1, Math.round(L / cellM));
        const cells: FacadeFace['cells'] = [];
        for (let st = t.from; st <= top; st++) for (let k = 0; k < n; k++) cells.push({ storey: st, t0: k / n, t1: (k + 1) / n, hours: 0 });
        faces.push({ tier, ring, edge, a, b, normal, bearing: ((Math.atan2(normal.x, normal.y) * 180) / Math.PI + 360) % 360, lengthM: L, courtyard, blank: blankWall, from: t.from, to: top, cells });
      }
    });
  });
  if (!faces.length) return faces;
  const own = schemeBlocks(y).map(ready).filter((r): r is Ready => !!r);
  const today = [...o.context.map(ready).filter((r): r is Ready => !!r), ...own];
  const later = o.future ? [...o.future.map(ready).filter((r): r is Ready => !!r), ...own] : undefined;
  const all = faces.flatMap((f) => [f.a, f.b]);
  const box = { x0: Math.min(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), x1: Math.max(...all.map((p) => p.x)), y1: Math.max(...all.map((p) => p.y)) };
  const FACING = Math.sin((5 * Math.PI) / 180), OFF = 0.05;
  for (const s of winterSun(o.lat, o.lon)) {
    const nowToday = sunward(today, box, sill, s), nowLater = later ? sunward(later, box, sill, s) : undefined;
    for (const f of faces) {
      if (f.blank || s.hx * f.normal.x + s.hy * f.normal.y <= FACING) { if (later) for (const c of f.cells) c.hoursFuture ??= 0; continue; }
      for (const c of f.cells) {
        const t = (c.t0 + c.t1) / 2, x = f.a.x + (f.b.x - f.a.x) * t + f.normal.x * OFF, yy = f.a.y + (f.b.y - f.a.y) * t + f.normal.y * OFF, zz = z.bottom(c.storey) + sill;
        if (!shaded(nowToday, x, yy, zz, s)) c.hours += 0.25;
        if (nowLater) c.hoursFuture = (c.hoursFuture ?? 0) + (shaded(nowLater, x, yy, zz, s) ? 0 : 0.25);
      }
    }
  }
  return faces;
}

/** A piece of a tier's roof, about `cellM` square, clipped to the roof the tiers above leave open, and its hours of sun. */
export interface RoofCell { tier: number; pts: XY[]; areaSqm: number; hours: number; hoursFuture?: number }

/**
 * The hours of mid-winter sun on the roofs of a scheme: each tier's plate less the plates of the tiers above it,
 * cut into cells about `cellM` square along its longest edge, each read at its middle just over the roof.
 */
export function roofSun(y: YieldResult, o: { context: Block[]; future?: Block[]; lat: number; lon: number; cellM?: number }): RoofCell[] {
  const cellM = o.cellM ?? 3;
  const z = storeyLevels(y);
  const close = (rg: XY[]): [number, number][] => [...rg, rg[0]].map((p) => [p.x, p.y]);
  const cells: (RoofCell & { z: number; c: XY })[] = [];
  y.tiers.forEach((t, tier) => {
    const top = Math.min(t.to, y.storeys);
    if (top < t.from || !t.plate.length) return;
    // the roof: the plate, less every plate built above its top storey
    const above = y.tiers.filter((u, k) => k !== tier && u.plate.length && u.from > top && Math.min(u.to, y.storeys) >= u.from);
    let roof: any;
    try {
      roof = polyclip.union(t.plate.filter((rg) => rg.length >= 3).map((rg) => [close(rg)]) as any);
      // the plate's rings are even-odd: a courtyard ring is a hole, so the outer less the inner
      const rings = t.plate.filter((rg) => rg.length >= 3);
      if (rings.length > 1) roof = rings.slice(1).reduce((acc, rg) => polyclip.xor(acc, [close(rg)] as any), [close(rings[0])] as any);
      if (above.length) roof = polyclip.difference(roof, ...above.flatMap((u) => u.plate.filter((rg) => rg.length >= 3).map((rg) => [close(rg)])) as any);
    } catch { return; }
    if (!roof?.length) return;
    // the grid along the plate's longest edge
    const outer = t.plate.reduce((m, rg) => (rg.length > m.length ? rg : m), t.plate[0]);
    let ang = 0, best = 0;
    outer.forEach((p, i) => { const q = outer[(i + 1) % outer.length], L = Math.hypot(q.x - p.x, q.y - p.y); if (L > best) { best = L; ang = Math.atan2(q.y - p.y, q.x - p.x); } });
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const toR = (p: XY) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }), fromR = (p: XY) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
    const rpts = t.plate.flat().map(toR);
    const x0 = Math.floor(Math.min(...rpts.map((p) => p.x)) / cellM) * cellM, y0 = Math.floor(Math.min(...rpts.map((p) => p.y)) / cellM) * cellM;
    const x1 = Math.max(...rpts.map((p) => p.x)), y1 = Math.max(...rpts.map((p) => p.y));
    for (let gx = x0; gx < x1; gx += cellM) for (let gy = y0; gy < y1; gy += cellM) {
      const sq = [{ x: gx, y: gy }, { x: gx + cellM, y: gy }, { x: gx + cellM, y: gy + cellM }, { x: gx, y: gy + cellM }].map(fromR);
      let pieces: any;
      try { pieces = polyclip.intersection(roof, [close(sq)] as any); } catch { continue; }
      for (const poly of pieces ?? []) {
        const ring: XY[] = (poly[0] as [number, number][]).slice(0, -1).map(([x, yy]) => ({ x, y: yy }));
        const area = ringArea(ring) - poly.slice(1).reduce((tt: number, h: [number, number][]) => tt + ringArea(h.slice(0, -1).map(([x, yy]) => ({ x, y: yy }))), 0);
        if (area < 0.5) continue;
        const c = ring.reduce((m, p) => ({ x: m.x + p.x / ring.length, y: m.y + p.y / ring.length }), { x: 0, y: 0 });
        cells.push({ tier, pts: ring, areaSqm: area, hours: 0, z: z.top(top), c: evenOdd([ring], c.x, c.y) ? c : ring[0] });
      }
    }
  });
  if (!cells.length) return [];
  const own = schemeBlocks(y).map(ready).filter((r): r is Ready => !!r);
  const today = [...o.context.map(ready).filter((r): r is Ready => !!r), ...own];
  const later = o.future ? [...o.future.map(ready).filter((r): r is Ready => !!r), ...own] : undefined;
  const box = { x0: Math.min(...cells.map((c) => c.c.x)), y0: Math.min(...cells.map((c) => c.c.y)), x1: Math.max(...cells.map((c) => c.c.x)), y1: Math.max(...cells.map((c) => c.c.y)) };
  const zMin = Math.min(...cells.map((c) => c.z));
  for (const s of winterSun(o.lat, o.lon)) {
    const nowToday = sunward(today, box, zMin, s), nowLater = later ? sunward(later, box, zMin, s) : undefined;
    for (const c of cells) {
      if (!shaded(nowToday, c.c.x, c.c.y, c.z + 0.1, s)) c.hours += 0.25;
      if (nowLater) c.hoursFuture = (c.hoursFuture ?? 0) + (shaded(nowLater, c.c.x, c.c.y, c.z + 0.1, s) ? 0 : 0.25);
    }
  }
  return cells.map(({ z: _z, c: _c, ...r }) => r);
}

/** Whether an apartment has the hours asked: in all, or in one unbroken run; with today's neighbours or their futures. */
export function meetsSun(u: SunUnit, hours: number, continuous: boolean, future = false): boolean {
  const got = future ? (continuous ? u.runFuture : u.hoursFuture) ?? 0 : continuous ? u.run : u.hours;
  return got >= hours - 1e-9;
}

function edgeLength(plate: XY[][], sm: { ring: number; edge: number }): number {
  const rg = plate[sm.ring], p = rg[sm.edge], q = rg[(sm.edge + 1) % rg.length];
  return Math.hypot(q.x - p.x, q.y - p.y);
}

// ---- the shadow it adds ------------------------------------------------------------------

/** What the shadow is measured on: public open space, a heritage item, residential land. */
export type ShadeKind = 'park' | 'heritage' | 'home';
export const SHADE_KINDS: ShadeKind[] = ['park', 'heritage', 'home'];

/** A piece of land the shadow is measured on: its rings, even-odd, local metres. */
export interface ShadeTarget { kind: ShadeKind; rings: XY[][] }

export interface AddedShadow {
  /** On the hour from 9 am to 3 pm: the ground the scheme puts in shadow that is in sun today, m², by kind. */
  hours: { clockMin: number; added: Record<ShadeKind, number> }[];
  /** Each kind's most, and the hour of it; null where it adds none. */
  peak: Record<ShadeKind, { sqm: number; clockMin: number } | null>;
  /** How many of each kind lie where the scheme's shadow can reach at some hour (none of a kind: nothing to measure). */
  reached: Record<ShadeKind, number>;
  /** How many of each kind the scheme adds shadow to, and which (their indices among the targets given). */
  shaded: Record<ShadeKind, number>;
  shadedTargets: number[];
  /**
   * The residential lots: those the scheme adds shadow to, and, by a common DCP test (half the lot's open ground in
   * sun for `hoursRequired` hours), those it takes below the test that pass it today, and those below it today that
   * it cuts further.
   */
  homes: { touched: number; fallBelow: number; cutFurther: number; hoursRequired: number };
}

export interface AddedShadowInput {
  /** What the path builds on the site, what stands there today, and the neighbours as they stand. */
  scheme: Block[];
  standing: Block[];
  context: Block[];
  /** The neighbours' footprints: the ground under a roof is not open ground, and is not sampled. */
  roofs: XY[][];
  site: XY[];
  targets: ShadeTarget[];
  lat: number;
  lon: number;
  /** The hours of sun the neighbours' open ground is held to. */
  hoursRequired: number;
  /** The ground sampled on a grid this fine, metres. */
  stepM?: number;
}

const zeroKinds = (): Record<ShadeKind, number> => ({ park: 0, heritage: 0, home: 0 });

/**
 * The shadow a scheme adds at mid winter to the open ground of the land round it: public open space, heritage
 * items and residential lots, sampled on a grid. Ground is in shadow today where the neighbours or what stands on
 * the site shade it, and with the scheme where the neighbours or the scheme do; what the scheme adds is the ground
 * in shadow with it that is in sun today.
 */
export function addedShadow(o: AddedShadowInput): AddedShadow {
  const step = o.stepM ?? 1.5, cell = step * step;
  const hourly = winterSun(o.lat, o.lon, ON_THE_HOUR), quarter = winterSun(o.lat, o.lon, QUARTER_HOURS);
  const out: AddedShadow = {
    hours: hourly.map((s) => ({ clockMin: s.clockMin, added: zeroKinds() })),
    peak: { park: null, heritage: null, home: null },
    reached: zeroKinds(),
    shaded: zeroKinds(),
    shadedTargets: [],
    homes: { touched: 0, fallBelow: 0, cutFurther: 0, hoursRequired: o.hoursRequired },
  };
  const scheme = o.scheme.map(ready).filter((r): r is Ready => !!r);
  if (!scheme.length) return out;
  const context = o.context.map(ready).filter((r): r is Ready => !!r);
  const standing = o.standing.map(ready).filter((r): r is Ready => !!r);
  // The reach of the scheme's shadow at each instant: its footprints and their tops' shadows, hulled (a cover, not the shadow).
  const pts = o.scheme.flatMap((b) => b.rings.flatMap((rg) => rg.map((p) => ({ p, z: b.z1 }))));
  const hullOf = (s: Sun) => convexHull(pts.flatMap(({ p, z }) => [p, { x: p.x - s.hx * (z / s.tan), y: p.y - s.hy * (z / s.tan) }]));
  const hullsH = hourly.map(hullOf), hullsQ = quarter.map(hullOf);
  const all = [...hullsH, ...hullsQ].flat();
  const reach = { x0: Math.min(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), x1: Math.max(...all.map((p) => p.x)), y1: Math.max(...all.map((p) => p.y)) };
  const roofs = o.roofs.filter((rg) => rg.length >= 3).map((rg) => ({ rg, x0: Math.min(...rg.map((p) => p.x)), x1: Math.max(...rg.map((p) => p.x)), y0: Math.min(...rg.map((p) => p.y)), y1: Math.max(...rg.map((p) => p.y)) }));
  const roofed = (x: number, y: number) => roofs.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1 && evenOdd([r.rg], x, y));

  for (const [targetIndex, target] of o.targets.entries()) {
    const rings = target.rings.filter((rg) => rg.length >= 3);
    if (!rings.length) continue;
    const xs = rings.flat().map((p) => p.x), ys = rings.flat().map((p) => p.y);
    const tb = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (tb.x1 < reach.x0 || tb.x0 > reach.x1 || tb.y1 < reach.y0 || tb.y0 > reach.y1) continue;
    // the open ground: the lot's grid points, off the site and out from under the neighbours' roofs
    const ground: XY[] = [];
    for (let x = tb.x0 + step / 2; x < tb.x1; x += step) for (let y = tb.y0 + step / 2; y < tb.y1; y += step) {
      if (evenOdd(rings, x, y) && !evenOdd([o.site], x, y) && !roofed(x, y)) ground.push({ x, y });
    }
    if (!ground.length) continue;
    const underH = hullsH.map((h) => ground.map((p) => h.length >= 3 && inHull(p, h)));
    const underQ = hullsQ.map((h) => ground.map((p) => h.length >= 3 && inHull(p, h)));
    if (!underH.some((row) => row.some(Boolean)) && !underQ.some((row) => row.some(Boolean))) continue;
    out.reached[target.kind]++;
    const gb = { x0: tb.x0, y0: tb.y0, x1: tb.x1, y1: tb.y1 };
    // shadow today and with the scheme at one instant, for the points under the scheme's reach (or every point, `all`)
    const at = (s: Sun, under: boolean[], every: boolean) => {
      const sc = sunward(scheme, gb, 0, s), cx = sunward(context, gb, 0, s), st = sunward(standing, gb, 0, s);
      const before: boolean[] = [], after: boolean[] = [];
      ground.forEach((p, i) => {
        const mayAdd = under[i] && shaded(sc, p.x, p.y, 0, s);
        if (!mayAdd && !every) { before.push(false); after.push(false); return; }
        const c = shaded(cx, p.x, p.y, 0, s);
        const b = c || shaded(st, p.x, p.y, 0, s);
        before.push(b); after.push(c || mayAdd);
      });
      return { before, after };
    };
    let added = false;
    hourly.forEach((s, h) => {
      const { before, after } = at(s, underH[h], false);
      const n = after.filter((v, i) => v && !before[i]).length;
      if (n) { out.hours[h].added[target.kind] += n * cell; added = true; }
    });
    if (target.kind !== 'home') { if (added) { out.shaded[target.kind]++; out.shadedTargets.push(targetIndex); } continue; }
    // the lot's hours with half its open ground in sun, today and with the scheme
    let hBefore = 0, hAfter = 0;
    quarter.forEach((s, q) => {
      const { before, after } = at(s, underQ[q], true);
      if (after.some((v, i) => v && !before[i])) added = true;
      if (before.filter((v) => !v).length >= ground.length / 2) hBefore += 0.25;
      if (after.filter((v) => !v).length >= ground.length / 2) hAfter += 0.25;
    });
    if (!added) continue;
    out.homes.touched++;
    out.shaded.home++;
    out.shadedTargets.push(targetIndex);
    const req = o.hoursRequired - 1e-9;
    if (hBefore >= req && hAfter < req) out.homes.fallBelow++;
    else if (hBefore < req && hAfter < hBefore - 1e-9) out.homes.cutFurther++;
  }
  for (const kind of SHADE_KINDS) {
    let best: { sqm: number; clockMin: number } | null = null;
    for (const h of out.hours) if (h.added[kind] > (best?.sqm ?? 0)) best = { sqm: h.added[kind], clockMin: h.clockMin };
    out.peak[kind] = best;
  }
  return out;
}

/**
 * The shadow prisms cast on flat ground with the sun where it is: each ring's outline carried away from the sun as
 * far as its foot and its top throw it, and swept between the two, all joined. Its rings (outer and holes, even-odd).
 */
export function groundShadow(blocks: Block[], s: Sun): XY[][] {
  const away = { x: -s.hx, y: -s.hy };
  const pieces: number[][][][] = [];
  const add = (pts: XY[]) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u.x * v.y - v.x * u.y; }
    if (Math.abs(a) > 1e-6) pieces.push([[...pts, pts[0]].map((p) => [p.x, p.y])]);
  };
  for (const b of blocks) {
    const d0 = b.z0 / s.tan, d1 = b.z1 / s.tan;
    const at = (p: XY, d: number): XY => ({ x: p.x + away.x * d, y: p.y + away.y * d });
    for (const rg of b.rings) {
      if (rg.length < 3) continue;
      add(rg.map((p) => at(p, d1)));
      add(rg.map((p) => at(p, d0)));
      rg.forEach((p, i) => { const q = rg[(i + 1) % rg.length]; add([at(p, d0), at(q, d0), at(q, d1), at(p, d1)]); });
    }
  }
  if (!pieces.length) return [];
  try {
    const joined = turfUnion(featureCollection(pieces.map((c) => polygon(c)))) as any;
    const g = joined?.geometry;
    const rings: number[][][] = g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    return rings.map((rg) => rg.slice(0, -1).map(([x, y]) => ({ x, y })));
  } catch { return []; }
}

/**
 * The ground only one set of buildings shades: at each hour its shadow (rings, even-odd, as groundShadow gives
 * them) less every other building's shadow that hour (their hulls), the hours joined, less `exclude` (the site
 * itself). What a scheme's own shadow adds, where nothing standing already shades the ground; rings, even-odd.
 */
export function addedGround(ours: XY[][][], theirs: XY[][][], exclude: XY[][] = []): XY[][] {
  type Geom = any;
  const close = (rg: XY[]) => [...rg.map((p) => [p.x, p.y]), [rg[0].x, rg[0].y]];
  const region = (rings: XY[][]): Geom | null => rings.filter((rg) => rg.length >= 3)
    .reduce<Geom | null>((acc, rg) => (acc ? polyclip.xor(acc, [close(rg)] as Geom) : [[close(rg)]]), null);
  const bbox = (rings: XY[][]) => { const ps = rings.flat(); return { x0: Math.min(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), x1: Math.max(...ps.map((p) => p.x)), y1: Math.max(...ps.map((p) => p.y)) }; };
  const meets = (a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
  let total: Geom | null = null;
  ours.forEach((rings, h) => {
    const own = region(rings);
    if (!own) return;
    const box = bbox(rings);
    const near = (theirs[h] ?? []).filter((hl) => hl.length >= 3 && meets(bbox([hl]), box)).map((hl) => [close(hl)]);
    let added: Geom;
    try { added = near.length ? polyclip.difference(own, ...(near as Geom[])) : own; } catch { added = own; }
    if (!added?.length) return;
    try { total = total ? polyclip.union(total, added) : added; } catch { /* keep what is joined */ }
  });
  if (!total) return [];
  const out = region(exclude);
  if (out) { try { total = polyclip.difference(total, out); } catch { /* the site left in */ } }
  return (total as Geom as number[][][][]).flatMap((poly) => poly.map((rg) => rg.slice(0, -1).map(([x, y]) => ({ x, y }))));
}

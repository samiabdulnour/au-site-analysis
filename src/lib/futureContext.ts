// The future context: what the neighbours may build, as the office's feasibility
// studies assume it. On each lot round the site that may redevelop (zoned for
// flats, with a height of building, and not held by the capacity study), the
// largest feasible footprint that fits the lot's envelope, built to the lot's
// height of building and no more floor area than its floor space ratio gives.
//
// The feasible footprints are the office's building envelope assumptions:
//
// - single loaded, 12 m deep, oriented north–south or east–west;
// - double loaded, 18 m deep (eight apartments a floor), deep enough and no
//   deeper for every apartment to have its sun, along an east–west axis;
// - double loaded, 22 m deep (ten a floor), for a building whose long faces
//   look east and west, along a north–south axis;
//
// each at most 45 m long, and here at least 15 m. The envelope is the lot set
// back 6 m from a street and, from its side and rear boundaries, by the ADG's
// half separation for the storeys it rises to: 6 m to four storeys, 9 m to
// eight, 12 m above. The footprint lies along the street where it can, nearest
// it; a taller band's deeper setbacks are tried first, and where the ratio
// stops the building in a lower band, that band's envelope.
//
// A lot too narrow for any footprint on its own is joined with the next lot
// along that may also redevelop, in the same zone, as its owners would
// amalgamate, up to three lots: the lots nearest the site first. A lot still
// too small stands as it is. None of this is a design or a prediction of
// what will be built: it is the context a feasibility study tests a scheme
// against.

import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import { FUTURE_ZONES, ringArea, type XY } from './yield.js';
import { ringsDistance } from './separation.js';

export type FootprintType = 'single' | 'double' | 'doubleEW';
/** The feasible footprints: depth, glass line to glass line, and the apartments a floor. */
export const FOOTPRINTS: Record<FootprintType, { depth: number; label: string; units: number }> = {
  single: { depth: 12, label: 'single-loaded', units: 4 },
  double: { depth: 18, label: 'double-loaded', units: 8 },
  doubleEW: { depth: 22, label: 'double-loaded, east–west', units: 10 },
};
export const MAX_LENGTH_M = 45, MIN_LENGTH_M = 15, STOREY_M = 3.1, MIN_STOREYS = 3, FRONT_SETBACK_M = 6, MAX_LOTS = 3;
/** ADG 3F-1's half separations to a side or rear boundary, by the storeys a building rises to. */
const BANDS = [{ top: 4, side: 6 }, { top: 8, side: 9 }, { top: Infinity, side: 12 }];

/** A lot round the site: its rings (local metres, outer first), its zone and controls, and whether the capacity study holds it. */
export interface FutureLot { rings: XY[][]; zone?: string; hobM?: number; fsr?: number; held?: boolean }

/** A building the future context stands on a lot, or on lots joined. */
export interface FutureBuilding {
  /** The lots it stands on, their indices among those given. */
  lots: number[];
  ring: XY[];
  type: FootprintType;
  depthM: number;
  lengthM: number;
  storeys: number;
  heightM: number;
  /** What stops it: the height of building, or the floor space ratio. */
  governs: 'height' | 'fsr';
  gfaSqm: number;
}

export interface FutureContext {
  buildings: FutureBuilding[];
  /** Per lot given: a future building stands on it. */
  developed: boolean[];
  /** The lots that may redevelop by their zone and controls but are held by the capacity study, and those too small even joined. */
  held: number;
  tooSmall: number;
}

const outerOf = (rings: XY[][]): XY[] => rings.filter((r) => r.length >= 3).reduce((m, r) => (ringArea(r) > ringArea(m) ? r : m), rings[0] ?? []);
const centroid = (rg: XY[]): XY => rg.reduce((t, p) => ({ x: t.x + p.x / rg.length, y: t.y + p.y / rg.length }), { x: 0, y: 0 });

function inRing(x: number, y: number, rg: XY[]): boolean {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    if (rg[i].y > y !== rg[j].y > y && x < ((rg[j].x - rg[i].x) * (y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c;
  }
  return c;
}
function segDist(x: number, y: number, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** Per edge of a ring: a street runs along it (a road's centreline within 20 m of its middle and within 35° of it). */
export function streetEdges(ring: XY[], roads: XY[][]): boolean[] {
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length], L = Math.hypot(q.x - p.x, q.y - p.y);
    if (L < 1) return false;
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, eb = Math.atan2(q.y - p.y, q.x - p.x);
    return roads.some((line) => line.some((a, j) => {
      if (!j) return false;
      const b = line[j - 1];
      if (segDist(mx, my, a, b) > 20) return false;
      let da = Math.abs(Math.atan2(a.y - b.y, a.x - b.x) - eb) % Math.PI;
      if (da > Math.PI / 2) da = Math.PI - da;
      return da <= (35 * Math.PI) / 180;
    }));
  });
}

/** A footprint fitted to a lot: its rectangle (local metres), type, size, storeys and floor area. */
type Fit = Omit<FutureBuilding, 'lots'>;

/**
 * The largest feasible footprint a lot (or lots joined) holds within its envelope, and the storeys its height and
 * ratio give it; null where none of at least 15 m fits, or the storeys come to fewer than three.
 */
export function fitFootprint(ring: XY[], fronts: boolean[], hobM: number, fsr: number | undefined, areaSqm: number, efficiency = 0.725, cell = 0.75): Fit | null {
  const byHeight = Math.floor(hobM / STOREY_M + 1e-9);
  if (byHeight < MIN_STOREYS || ring.length < 3) return null;
  // the orientations tried: along the longest street frontage (the longest edge where none), and across it
  let best = -1, theta = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length], L = Math.hypot(q.x - p.x, q.y - p.y) * (fronts[i] ? 10 : 1);
    if (L > best) { best = L; theta = Math.atan2(q.y - p.y, q.x - p.x); }
  });
  const c = centroid(ring);
  let out: Fit | null = null;
  for (const band of BANDS) {
    const prevTop = band === BANDS[0] ? 0 : BANDS[BANDS.indexOf(band) - 1].top;
    if (byHeight <= prevTop) break;
    const cap = Math.min(byHeight, band.top);
    for (const ang of [theta, theta + Math.PI / 2]) {
      const cos = Math.cos(ang), sin = Math.sin(ang);
      // the ring in a frame whose x runs along the footprint's length
      const rot = ring.map((p) => ({ x: (p.x - c.x) * cos + (p.y - c.y) * sin, y: -(p.x - c.x) * sin + (p.y - c.y) * cos }));
      const xs = rot.map((p) => p.x), ys = rot.map((p) => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const nx = Math.ceil((Math.max(...xs) - x0) / cell), ny = Math.ceil((Math.max(...ys) - y0) / cell);
      // which side the street is: the frontage's middle, low or high in the frame
      const fi = fronts.findIndex(Boolean);
      const frontLow = fi < 0 ? true : (rot[fi].y + rot[(fi + 1) % rot.length].y) / 2 < (y0 + Math.max(...ys)) / 2;
      // the envelope on the grid, and how many cells run up from each
      const inside = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
        if (!inRing(x, y, rot)) continue;
        let ok = true;
        // a cell whose middle is within half a cell of the setback line counts in: a 22 m plan fills a 22 m envelope
        for (let e = 0; e < rot.length && ok; e++) if (segDist(x, y, rot[e], rot[(e + 1) % rot.length]) < (fronts[e] ? FRONT_SETBACK_M : band.side) - cell / 2) ok = false;
        if (ok) inside[j * nx + i] = 1;
      }
      const run = new Uint16Array(nx * ny);
      for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) if (inside[j * nx + i]) run[j * nx + i] = 1 + (j + 1 < ny ? run[(j + 1) * nx + i] : 0);
      // its long axis north–south: the faces look east and west, and the deeper plan suits; east–west, the 18 m
      const bearing = ((90 - (ang * 180) / Math.PI) % 180 + 180) % 180;
      const northSouth = bearing < 45 || bearing > 135;
      for (const type of (northSouth ? ['doubleEW', 'single'] : ['double', 'single']) as FootprintType[]) {
        const depth = FOOTPRINTS[type].depth, k = Math.ceil(depth / cell - 1e-9);
        let pick: { j: number; i0: number; w: number } | null = null;
        for (let j = 0; j + k <= ny; j++) {
          let runStart = -1;
          for (let i = 0; i <= nx; i++) {
            const ok = i < nx && run[j * nx + i] >= k;
            if (ok && runStart < 0) runStart = i;
            if (!ok && runStart >= 0) {
              const w = (i - runStart) * cell;
              const better = !pick || Math.min(w, MAX_LENGTH_M) > Math.min(pick.w, MAX_LENGTH_M) + 1e-6
                || (Math.abs(Math.min(w, MAX_LENGTH_M) - Math.min(pick.w, MAX_LENGTH_M)) < 1e-6 && (frontLow ? j < pick.j : j > pick.j));
              if (better) pick = { j, i0: runStart, w };
              runStart = -1;
            }
          }
        }
        if (!pick) continue;
        const room = Math.min(pick.w, MAX_LENGTH_M);
        if (room < MIN_LENGTH_M) continue;
        // to its height where it can: where the ratio would stop the whole length short of it, the footprint shortens
        // (to 15 m at the least) so the floor area the ratio gives rises to the height; shorter than that, it stops lower
        const most = fsr && fsr > 0 ? fsr * areaSqm : Infinity;
        let length = room, storeys = cap, governs: Fit['governs'] = 'height';
        if (room * depth * efficiency * cap > most + 1e-6) {
          governs = 'fsr';
          const toHeight = most / (depth * efficiency * cap);
          if (toHeight >= MIN_LENGTH_M) length = toHeight;
          else storeys = Math.floor(most / (room * depth * efficiency) + 1e-9);
        }
        if (storeys < MIN_STOREYS) continue;
        let gfa = length * depth * efficiency * storeys;
        // the most floor area (within a hundredth), then the taller, then the deeper plan
        if (out) {
          const close = Math.abs(gfa - out.gfaSqm) <= 0.01 * Math.max(gfa, out.gfaSqm);
          if (close ? storeys < out.storeys || (storeys === out.storeys && depth <= out.depthM) : gfa < out.gfaSqm) continue;
        }
        // the rectangle, centred along its run; the grid reads the envelope to half a cell, so the footprint is
        // nudged (and its length trimmed) until every point of it keeps its setbacks exactly, or it does not stand
        const setbackOf = (e: number) => (fronts[e] ? FRONT_SETBACK_M : band.side);
        const keeps = (xa: number, ya: number, L: number) => {
          const pts: XY[] = [];
          for (let t = 0; t <= L + 1e-9; t += 0.5) pts.push({ x: xa + t, y: ya }, { x: xa + t, y: ya + depth });
          for (let t = 0; t <= depth + 1e-9; t += 0.5) pts.push({ x: xa, y: ya + t }, { x: xa + L, y: ya + t });
          pts.push({ x: xa + L, y: ya }, { x: xa + L, y: ya + depth });
          return pts.every((q) => inRing(q.x, q.y, rot) && rot.every((a, e) => segDist(q.x, q.y, a, rot[(e + 1) % rot.length]) >= setbackOf(e) - 1e-6));
        };
        const xMid = x0 + pick.i0 * cell + pick.w / 2, yBase = y0 + pick.j * cell;
        let placed: { xa: number; ya: number } | null = null;
        for (const trim of [0, 0.75, 1.5]) {
          const L = length - trim;
          if (L < MIN_LENGTH_M) break;
          for (const dy of [0, 0.125, -0.125, 0.25, -0.25, 0.375, -0.375, 0.5, -0.5, 0.625, -0.625, 0.75, -0.75]) {
            if (keeps(xMid - L / 2, yBase + dy, L)) { placed = { xa: xMid - L / 2, ya: yBase + dy }; length = L; break; }
          }
          if (placed) break;
        }
        if (!placed) continue;
        const { xa, ya } = placed;
        const corners = [{ x: xa, y: ya }, { x: xa + length, y: ya }, { x: xa + length, y: ya + depth }, { x: xa, y: ya + depth }]
          .map((p) => ({ x: c.x + p.x * cos - p.y * sin, y: c.y + p.x * sin + p.y * cos }));
        gfa = length * depth * efficiency * storeys;
        out = { ring: corners, type, depthM: depth, lengthM: length, storeys, heightM: storeys * STOREY_M, governs, gfaSqm: gfa };
      }
    }
  }
  return out;
}

/** Two rings joined into one, or null where they do not make a single outline. */
function join(a: XY[], b: XY[]): XY[] | null {
  try {
    const close = (rg: XY[]) => [...rg, rg[0]].map((p) => [p.x, p.y]);
    const g = (turfUnion(featureCollection([polygon([close(a)]), polygon([close(b)])])) as any)?.geometry;
    if (g?.type !== 'Polygon') return null;
    return (g.coordinates[0] as number[][]).slice(0, -1).map(([x, y]) => ({ x, y }));
  } catch { return null; }
}

/**
 * The future context round a site: the lots within `reach` metres of it that may redevelop, each given the largest
 * feasible footprint its envelope holds, or joined with the next lots along where it is too narrow alone, nearest
 * the site first. `roads` are the street centrelines (local metres), which say which of a lot's edges are frontages.
 */
export function futureContext(lots: FutureLot[], roads: XY[][], site: XY[], opts: { reach?: number; efficiency?: number } = {}): FutureContext {
  const reach = opts.reach ?? 120, eff = opts.efficiency ?? 0.725;
  const outers = lots.map((l) => outerOf(l.rings));
  const near = outers.map((rg) => (rg.length >= 3 ? ringsDistance([rg], [site]).d : Infinity));
  const onSite = outers.map((rg) => rg.length >= 3 && inRing(centroid(rg).x, centroid(rg).y, site));
  const may = lots.map((l, i) => !onSite[i] && near[i] <= reach && FUTURE_ZONES.includes((l.zone ?? '').toUpperCase().trim()) && !!l.hobM && Math.floor(l.hobM / STOREY_M + 1e-9) >= MIN_STOREYS);
  const out: FutureContext = { buildings: [], developed: lots.map(() => false), held: 0, tooSmall: 0 };
  const order = lots.map((_, i) => i).filter((i) => may[i]).sort((p, q) => near[p] - near[q]);
  const used = new Set<number>();
  for (const i of order) if (lots[i].held) { used.add(i); out.held++; }
  for (const i of order) {
    if (used.has(i)) continue;
    const group = [i];
    let ring = outers[i];
    const zone = (lots[i].zone ?? '').toUpperCase().trim();
    const areaOf = (g: number[]) => g.reduce((t, k) => t + ringArea(outers[k]), 0);
    const fitOf = (g: number[], rg: XY[]) => {
      const ls = g.map((k) => lots[k]), area = areaOf(g);
      // joined lots take the lower height, and the ratio the land gives them all
      const hob = Math.min(...ls.map((l) => l.hobM!));
      const fsr = ls.every((l) => l.fsr) ? g.reduce((t, k) => t + lots[k].fsr! * ringArea(outers[k]), 0) / area : undefined;
      return { fit: fitFootprint(rg, streetEdges(rg, roads), hob, fsr, area, eff), byHeight: Math.floor(hob / STOREY_M + 1e-9) };
    };
    const first = fitOf(group, ring);
    let best = first.fit ? { group: [...group], fit: first.fit, density: first.fit.gfaSqm / areaOf(group) } : null;
    // join the next lot along where this one holds nothing, or holds a building the setbacks keep below its height,
    // keeping the joined lots where they use the land better
    let held = !first.fit || (first.fit.governs === 'height' && first.fit.storeys < first.byHeight);
    while (held && group.length < MAX_LOTS) {
      const next = order.filter((j) => !used.has(j) && !group.includes(j) && (lots[j].zone ?? '').toUpperCase().trim() === zone
        && group.some((g) => ringsDistance([outers[g]], [outers[j]]).d < 0.5));
      let joined: XY[] | null = null, took = -1;
      for (const j of next) { joined = join(ring, outers[j]); if (joined) { took = j; break; } }
      if (!joined) break;
      group.push(took);
      ring = joined;
      const now = fitOf(group, ring);
      if (now.fit) {
        const density = now.fit.gfaSqm / areaOf(group);
        if (!best || density > best.density * 1.05) best = { group: [...group], fit: now.fit, density };
        held = now.fit.governs === 'height' && now.fit.storeys < now.byHeight;
      }
    }
    if (!best) continue;
    for (const g of best.group) { used.add(g); out.developed[g] = true; }
    out.buildings.push({ lots: best.group, ...best.fit });
  }
  // what may redevelop, is not held, and no footprint fits, alone or joined
  out.tooSmall = order.filter((i) => !lots[i].held && !out.developed[i]).length;
  return out;
}

// The envelope reshaped to comply: the site's floor area laid out again in the
// office's feasible footprints (lib/futureContext.ts FOOTPRINTS), so that the
// scheme meets the Apartment Design Guide's sun as well as its separations.
//
// The study's envelope fills the setbacks: a perimeter round a courtyard on a
// wide lot, a tower on a deep one. Many of its apartments face south or look
// into the courtyard, and the scheme often misses ADG 4A-1 (70% of the
// apartments with two hours of mid-winter sun) and 4A-2 (no more than 15%
// with none). The office reshapes it the way its feasibility studies do, in
// buildings of known plans:
//
// - single loaded, 12 m deep, its gallery on the face that gets least sun;
// - double loaded, 18 m deep, along an east–west axis, its apartments running
//   through to the north face;
// - double loaded, 22 m deep, along a north–south axis, its apartments facing
//   east and west;
//
// each 15 to 45 m long, a double-loaded one at least as long as it is deep.
// The buildings stand in rows within the envelope (6 m
// from the street, the ADG's half separation from the side and rear
// boundaries for the storeys they rise to), the rows and the buildings in a
// row the ADG's full separation apart (12, 18 or 24 m). The frame the rows
// run in is the main frontage's, across it, or true east–west or north–south.
//
// Each layout is built to the height of building, and held to the floor
// space ratio: all its buildings to one height, or the southern ones to the
// height and the northern lower, since the sun is in the north and a
// building shades the one south of it. The layouts are tried from the most
// floor area down: each one's apartments are read for their sun (quickly,
// every half hour, then at the quarter hours to confirm), and the first that
// meets 4A-1 and 4A-2 is the scheme. Where none does, the one whose
// apartments come nearest is, and it says so.

import { computeBuildings, computeYield, edgeKinds, ringArea, type Archetype, type Placed, type XY, type YieldAssumptions, type YieldResult } from './yield.js';
import { FOOTPRINTS, MAX_LENGTH_M, MIN_LENGTH_M, MIN_STOREYS, type FootprintType } from './futureContext.js';
import { apartmentSun, type ApartmentSun, type Block } from './solarAccess.js';

export interface ReshapeInput {
  ring: XY[];
  fronts: boolean[];
  siteAreaSqm: number;
  zone?: string;
  hobM?: number;
  fsr?: number;
  assumptions?: Partial<YieldAssumptions>;
  archetype?: Archetype;
  /** Where the site is, the neighbours as they stand, and the hours ADG 4A-1 asks here. */
  lat: number;
  lon: number;
  context: Block[];
  hoursRequired: number;
  continuous?: boolean;
  /** How many layouts the search reads the sun of before it settles for the nearest (40 unless set). */
  budget?: number;
  /** Told of each layout read, for a test or a debugging run: what it is, its floor area and its apartments' sun. */
  onRead?: (describe: string, gfa: number, sun: { meeting: number; none: number; total: number }) => void;
}

/** A building the reshaped scheme stands: its outline, its plan, its size and storeys, and the faces with no windows. */
export interface ReshapedBuilding {
  name: string;
  ring: XY[];
  type: FootprintType;
  lengthM: number;
  depthM: number;
  storeys: number;
  windowless: boolean[];
}

export interface Reshaped {
  y: YieldResult;
  buildings: ReshapedBuilding[];
  /** Whether it meets ADG 4A-1 and 4A-2, with its apartments' sun read at the quarter hours. */
  complies: boolean;
  sun: ApartmentSun;
  /** How the buildings stand, in a few words ("two rows of double-loaded buildings, east–west"), and how many layouts were read. */
  layout: string;
  tried: number;
  candidates: number;
}

const CELL = 0.75;
const FACE_TYPES: Record<'ns' | 'ew', FootprintType[]> = { ns: ['doubleEW', 'single'], ew: ['double', 'single'] };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

/** A building in the frame of its rows: from xa along the row for its length, from ya across it for its depth. */
interface FrameBar { xa: number; ya: number; length: number; depth: number; type: FootprintType }
/** A layout to read: its buildings in the world, each's storeys, its floor area, and its description. */
interface Candidate { bars: { ring: XY[]; type: FootprintType; length: number; depth: number; storeys: number; windowless: boolean[] }[]; gfa: number; describe: string; side: number }

const ROWS_WORD = (n: number) => (n === 1 ? 'one row' : n === 2 ? 'two rows' : `${n} rows`);
const TYPE_WORD: Record<FootprintType, string> = { single: 'single-loaded, 12 m', double: 'double-loaded, 18 m', doubleEW: 'double-loaded east–west, 22 m' };

/** The scheme reshaped into the office's feasible footprints, the most floor area that meets ADG 4A; undefined where the zone takes no apartments or the height holds fewer than three storeys. */
export function reshapeToComply(input: ReshapeInput): Reshaped | undefined {
  const ring = input.ring.length > 1 && input.ring[0].x === input.ring[input.ring.length - 1].x && input.ring[0].y === input.ring[input.ring.length - 1].y ? input.ring.slice(0, -1) : input.ring;
  const base = computeYield({ ...input, ring });
  if (base.archetype !== 'residential' || base.storeysByHeight < MIN_STOREYS || ring.length < 3) return undefined;
  const a = base.assumptions, A = input.siteAreaSqm, eff = a.residentialEfficiency;
  const cap = input.fsr ? input.fsr * A : Infinity;
  const sideFor = (n: number) => (n <= 4 ? a.adgSide4 : n <= 8 ? a.adgSide8 : a.adgSide9);
  const kinds = edgeKinds(ring, ring.map((_, i) => !!input.fronts[i]));
  const setbackOf = (e: number, side: number) => (kinds[e] === 'front' ? a.residentialFront : side);
  const c = ring.reduce((t, p) => ({ x: t.x + p.x / ring.length, y: t.y + p.y / ring.length }), { x: 0, y: 0 });

  // the frames the rows run in: along the main frontage, across it, east–west and north–south
  const angles: number[] = [];
  const addAngle = (t: number) => { const n = ((t % Math.PI) + Math.PI) % Math.PI; if (!angles.some((x) => Math.min(Math.abs(x - n), Math.PI - Math.abs(x - n)) < 0.09)) angles.push(n); };
  let best = -1, theta = 0;
  ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length], L = Math.hypot(q.x - p.x, q.y - p.y) * (input.fronts[i] ? 10 : 1); if (L > best) { best = L; theta = Math.atan2(q.y - p.y, q.x - p.x); } });
  addAngle(theta); addAngle(theta + Math.PI / 2); addAngle(0); addAngle(Math.PI / 2);
  const bands = [...new Set([Math.min(base.storeysByHeight, 4), Math.min(base.storeysByHeight, 8), base.storeysByHeight])].filter((n) => n >= MIN_STOREYS);

  const candidates: Candidate[] = [];
  for (const ang of angles) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const rot = ring.map((p) => ({ x: (p.x - c.x) * cos + (p.y - c.y) * sin, y: -(p.x - c.x) * sin + (p.y - c.y) * cos }));
    const toWorld = (p: XY): XY => ({ x: c.x + p.x * cos - p.y * sin, y: c.y + p.x * sin + p.y * cos });
    const ns = Math.abs(sin) > Math.SQRT1_2;
    const xs = rot.map((p) => p.x), ys = rot.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const nx = Math.ceil((Math.max(...xs) - x0) / CELL), ny = Math.ceil((Math.max(...ys) - y0) / CELL);
    for (const nTop of bands) {
      const side = sideFor(nTop), sep = 2 * side;
      const inside = new Uint8Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL;
        if (!inRing(x, y, rot)) continue;
        let ok = true;
        for (let e = 0; e < rot.length && ok; e++) if (segDist(x, y, rot[e], rot[(e + 1) % rot.length]) < setbackOf(e, side) - CELL / 2) ok = false;
        if (ok) inside[j * nx + i] = 1;
      }
      const run = new Uint16Array(nx * ny);
      for (let j = ny - 1; j >= 0; j--) for (let i = 0; i < nx; i++) if (inside[j * nx + i]) run[j * nx + i] = 1 + (j + 1 < ny ? run[(j + 1) * nx + i] : 0);
      // a building keeps its setbacks exactly: nudged across its row, and trimmed at its ends, until it does
      const keeps = (xa: number, ya: number, L: number, d: number) => {
        const pts: XY[] = [];
        for (let t = 0; t <= L + 1e-9; t += 0.5) pts.push({ x: xa + t, y: ya }, { x: xa + t, y: ya + d });
        for (let t = 0; t <= d + 1e-9; t += 0.5) pts.push({ x: xa, y: ya + t }, { x: xa + L, y: ya + t });
        pts.push({ x: xa + L, y: ya }, { x: xa + L, y: ya + d });
        return pts.every((q) => inRing(q.x, q.y, rot) && rot.every((p, e) => segDist(q.x, q.y, p, rot[(e + 1) % rot.length]) >= setbackOf(e, side) - 1e-6));
      };
      // two buildings of a frame, how far apart: they are rectangles square to it
      const apart = (p: FrameBar, q: FrameBar) => Math.hypot(Math.max(0, p.xa - (q.xa + q.length), q.xa - (p.xa + p.length)), Math.max(0, p.ya - (q.ya + q.depth), q.ya - (p.ya + p.depth)));
      const settle = (bar: FrameBar, placed: FrameBar[]): FrameBar | null => {
        for (const trim of [0, 0.75, 1.5, 3]) {
          const L = bar.length - trim;
          if (L < (bar.type === 'single' ? MIN_LENGTH_M : Math.max(MIN_LENGTH_M, bar.depth))) return null;
          for (const dy of [0, 0.125, -0.125, 0.25, -0.25, 0.375, -0.375, 0.5, -0.5, 0.625, -0.625, 0.75, -0.75]) {
            const moved = { ...bar, xa: bar.xa + trim / 2, ya: bar.ya + dy, length: L };
            if (keeps(moved.xa, moved.ya, L, bar.depth) && placed.every((o) => apart(moved, o) >= sep - 1e-6)) return moved;
          }
        }
        return null;
      };
      for (const type of FACE_TYPES[ns ? 'ns' : 'ew']) {
        const depth = FOOTPRINTS[type].depth, k = Math.ceil(depth / CELL - 1e-9), gap = Math.ceil(sep / CELL - 1e-9);
        // a corridor building runs longer than it is deep: a double-loaded one at least its depth long, a single-loaded one 15 m
        const shortest = type === 'single' ? MIN_LENGTH_M : Math.max(MIN_LENGTH_M, depth);
        // the buildings a row at j holds: each run of the envelope deep enough, shared out evenly into buildings the separation apart
        const rowAt = (j: number, placed: FrameBar[]): FrameBar[] => {
          const out: FrameBar[] = [];
          let start = -1;
          for (let i = 0; i <= nx; i++) {
            const ok = i < nx && run[j * nx + i] >= k;
            if (ok && start < 0) start = i;
            if (!ok && start >= 0) {
              const w = (i - start) * CELL;
              if (w >= shortest) {
                let m = Math.ceil((w + sep) / (MAX_LENGTH_M + sep));
                while (m > 1 && (w - (m - 1) * sep) / m < shortest) m--;
                const L = Math.min(MAX_LENGTH_M, (w - (m - 1) * sep) / m);
                const used = m * L + (m - 1) * sep, xs0 = x0 + start * CELL + (w - used) / 2;
                for (let q = 0; q < m; q++) out.push({ xa: xs0 + q * (L + sep), ya: y0 + j * CELL, length: L, depth, type });
              }
              start = -1;
            }
          }
          const kept: FrameBar[] = [];
          for (const bar of out) { const b = settle(bar, [...placed, ...kept]); if (b) kept.push(b); }
          return kept;
        };
        for (const anchor of ['low', 'high'] as const) {
          for (const oneRow of [false, true]) {
            const rows: FrameBar[][] = [];
            let j = anchor === 'low' ? 0 : ny - k;
            while (j >= 0 && j + k <= ny) {
              const row = rowAt(j, rows.flat());
              if (row.length) {
                rows.push(row);
                if (oneRow) break;
                j += anchor === 'low' ? k + gap : -(k + gap);
              } else j += anchor === 'low' ? 1 : -1;
            }
            if (!rows.length) continue;
            const bars = rows.flat();
            // a single-loaded building facing east and west keeps its gallery on the face nearer the boundary, which its
            // neighbour shades, or all of them on the east, or all on the west: each is a layout of its own
            const modes = type === 'single' && ns ? (['near', 'east', 'west'] as const) : (['-'] as const);
            for (const mode of modes) {
              // each building in the world, and its faces: the 0th and 2nd its long ones, across the row
              const world = bars.map((b) => {
                const corners = [{ x: b.xa, y: b.ya }, { x: b.xa + b.length, y: b.ya }, { x: b.xa + b.length, y: b.ya + b.depth }, { x: b.xa, y: b.ya + b.depth }].map(toWorld);
                // the long faces' outward normals: the row's −y and +y, in the world
                const n0 = { x: sin, y: -cos }, n2 = { x: -sin, y: cos };
                const windowless = [false, false, false, false];
                if (b.type === 'double' || (b.type === 'single' && !ns)) {
                  // the face that looks south: a double-loaded building's apartments run through to the north, a single-loaded one's gallery is on it
                  if (n0.y < n2.y) windowless[0] = true; else windowless[2] = true;
                } else if (b.type === 'single') {
                  const mid = (p: XY, q: XY) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
                  const near = (p: XY) => Math.min(...ring.map((r, e) => segDist(p.x, p.y, r, ring[(e + 1) % ring.length])));
                  const first = mode === 'east' ? n0.x > n2.x : mode === 'west' ? n0.x < n2.x : near(mid(corners[0], corners[1])) <= near(mid(corners[2], corners[3]));
                  windowless[first ? 0 : 2] = true;
                }
                return { ring: corners, type: b.type, length: b.length, depth: b.depth, windowless, plate: b.length * b.depth, north: corners.reduce((t, p) => t + p.y, 0) / 4 };
              });
              const galleries = mode === 'east' ? ', galleries to the east' : mode === 'west' ? ', galleries to the west' : '';
              const describe = `${ROWS_WORD(rows.length)} of ${TYPE_WORD[type]} building${bars.length > 1 ? 's' : ''}, ${ns ? 'north–south' : 'east–west'}${galleries}`;
              const plates = world.reduce((t, w) => t + w.plate, 0);
              // all to one height, held to the ratio
              const even = Math.min(nTop, Number.isFinite(cap) ? Math.floor(cap / (plates * eff) + 1e-9) : nTop);
              if (even >= MIN_STOREYS) candidates.push({ bars: world.map((w) => ({ ...w, storeys: even })), gfa: plates * eff * even, describe, side });
              // the rows stepped down to the north, which shade the rows south of them: the northern row a storey or two
              // lower, or each row a storey lower than the one south of it; then held to the ratio, the tallest of the
              // northern buildings brought down first
              const rowOf = rows.flatMap((row, r) => row.map(() => r));
              const rowNorth = rows.map((_, r) => { const ws = world.filter((_, i) => rowOf[i] === r); return ws.reduce((t, w) => t + w.north, 0) / ws.length; });
              const rank = rowNorth.map((v) => rowNorth.filter((u) => u < v).length);   // 0 the southernmost row
              const northmost = Math.max(...rank);
              const profiles: { drop: (r: number) => number; word: string }[] = [{ drop: () => 0, word: '' }];
              if (rows.length > 1) profiles.push(
                { drop: (r) => (rank[r] === northmost ? 1 : 0), word: ', the northern row a storey lower' },
                { drop: (r) => (rank[r] === northmost ? 2 : 0), word: ', the northern row two storeys lower' },
                { drop: (r) => rank[r], word: ', stepping down to the north' },
              );
              for (const pf of profiles) {
                const heights = world.map((_, i) => nTop - pf.drop(rowOf[i]));
                const gfaOf = () => world.reduce((t, w, i) => t + (heights[i] >= MIN_STOREYS ? heights[i] * w.plate * eff : 0), 0);
                while (gfaOf() > cap + 1e-6) {
                  // bring the tallest down, the northernmost of them first
                  let pick = -1;
                  world.forEach((w, i) => { if (heights[i] >= MIN_STOREYS && (pick < 0 || heights[i] > heights[pick] || (heights[i] === heights[pick] && w.north > world[pick].north))) pick = i; });
                  if (pick < 0) break;
                  heights[pick]--;
                }
                const kept = world.map((w, i) => ({ ...w, storeys: heights[i] })).filter((w) => w.storeys >= MIN_STOREYS);
                if (!kept.length) continue;
                candidates.push({ bars: kept, gfa: gfaOf(), describe: `${describe}${pf.word}`, side });
              }
            }
          }
        }
      }
    }
  }
  if (!candidates.length) return undefined;

  // the same layout found twice is read once
  const seen = new Set<string>();
  const unique = candidates.filter((cd) => {
    const key = cd.bars.map((b) => `${b.ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}:${b.storeys}:${b.windowless.map(Number).join('')}`).sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((p, q) => q.gfa - p.gfa);

  const blank = kinds.map((k) => k !== 'front');
  const build = (cd: Candidate) => {
    const buildings: Placed[] = cd.bars.map((b, i) => ({ ring: b.ring, storeys: b.storeys, windowless: b.windowless, name: `Building ${LETTERS[i] ?? i + 1} · ${TYPE_WORD[b.type]}`, front: a.residentialFront, side: cd.side, rear: cd.side }));
    return computeBuildings({ ring, fronts: input.fronts, siteAreaSqm: A, zone: input.zone, hobM: input.hobM, fsr: input.fsr, assumptions: input.assumptions, buildings });
  };
  const read = (y: YieldResult, fine: boolean) => apartmentSun(y, {
    boundary: ring, blank, lat: input.lat, lon: input.lon, context: input.context, hoursRequired: input.hoursRequired, continuous: input.continuous,
    ...(fine ? {} : { stepM: 1.5, perHour: 2 }),
  });
  const passes = (s: ApartmentSun | undefined) => !!s && s.total > 0 && s.meeting >= 0.7 * s.total - 1e-9 && s.none <= 0.15 * s.total + 1e-9;
  const budget = input.budget ?? 40;
  let tried = 0, nearest: { cd: Candidate; score: number } | undefined;
  for (const cd of unique) {
    if (tried >= budget) break;
    tried++;
    const y = build(cd);
    const quick = read(y, false);
    if (!quick?.total) continue;
    input.onRead?.(cd.describe + ` [${cd.bars.map((b) => b.storeys).join('/')} st]`, cd.gfa, quick);
    if (passes(quick)) {
      const sun = read(y, true)!;
      if (passes(sun)) return { y, buildings: named(cd), complies: true, sun, layout: cd.describe, tried, candidates: unique.length };
    }
    // nearest: the most apartments with their hours, then the fewest with none, then the most floor area
    const score = quick.meeting / quick.total - 0.5 * Math.max(0, quick.none / quick.total - 0.15) + cd.gfa / (unique[0].gfa * 1000);
    if (!nearest || score > nearest.score) nearest = { cd, score };
  }
  if (!nearest) return undefined;
  const y = build(nearest.cd);
  const sun = read(y, true);
  if (!sun) return undefined;
  return { y, buildings: named(nearest.cd), complies: passes(sun), sun, layout: nearest.cd.describe, tried, candidates: unique.length };
}

function named(cd: Candidate): ReshapedBuilding[] {
  return cd.bars.map((b, i) => ({ name: `Building ${LETTERS[i] ?? i + 1}`, ring: b.ring, type: b.type, lengthM: b.length, depthM: b.depth, storeys: b.storeys, windowless: b.windowless }));
}

/** The floor area a reshaped scheme gives up against the envelope's, as a share of it. */
export const givenUp = (r: Reshaped, envelope: YieldResult) => (envelope.gfa > 0 ? Math.max(0, 1 - r.y.gfa / envelope.gfa) : 0);

/** Its plates' total, for a check that the buildings fit the ratio. */
export const platesOf = (r: Reshaped) => r.buildings.reduce((t, b) => t + ringArea(b.ring), 0);

// The yield study: what the controls let a site hold, as a feasibility
// study first states it — the envelope the height and the Apartment Design
// Guide's separations leave, the floor area the floor space ratio caps it at,
// the apartments and the parking that floor area makes.
//
// Everything here is geometry and arithmetic on the site in local metres (x
// east, y north), so it can be tested on made-up lots with no network. The
// numbers it assumes are all in one table, DEFAULT_ASSUMPTIONS, and every one
// can be overridden from `yield_assumptions.json` beside the deck; the slides
// print the ones a run used.
//
// The envelope is found on a grid rather than by offsetting the polygon: a
// cell is buildable when it is inside the lot and at least each boundary's
// setback from that boundary. Offsetting each edge by its own distance is
// easy for a convex lot and wrong for an L-shaped one, where a half-plane of
// one wing's edge cuts across the other wing; the grid is right for both. The
// cell's "slack" — how much further it is from the nearest setback line than
// it needs to be — is kept, so a narrower floor plate (a tower held to its
// plate size, an apartment block held to its depth) is a threshold on the
// same field rather than another pass over the edges.

export interface XY { x: number; y: number }

/** The numbers a yield study assumes. Lengths in metres, areas in m², rates per dwelling or per m². */
export interface YieldAssumptions {
  /** Floor to floor: a ground floor of shops or offices, a residential storey, an office storey. */
  groundRetailF2F: number;
  residentialF2F: number;
  commercialF2F: number;
  /** Kept under the height plane for the lift overrun, plant and parapet. */
  roofAllowance: number;
  /** In a centre: the storeys of the podium built to the street and side boundaries. */
  podiumStoreys: number;
  /** The podium's rear setback, and the tower's setback from the street above it. */
  podiumRear: number;
  towerFront: number;
  /** The front setback of an apartment building in a residential zone. */
  residentialFront: number;
  /** ADG 3F-1: separation to a side or rear boundary from habitable rooms and balconies, by height. */
  adgSide4: number;    // up to 12 m (four storeys)
  adgSide8: number;    // up to 25 m (five to eight storeys)
  adgSide9: number;    // over 25 m (nine storeys and above)
  /** Commercial towers above their podium: side and rear setback. */
  commercialTowerSide: number;
  /** ADG 2E: building depth, glass line to glass line, and the plate a residential tower is held to (GBA). */
  maxDepth: number;
  towerPlateMax: number;
  /** Gross floor area as a share of the gross building area: walls, cores and risers come out. */
  residentialEfficiency: number;
  commercialEfficiency: number;
  /** Net saleable area as a share of residential GFA: corridors and lobbies come out. */
  nsaRatio: number;
  /** The apartment mix, shares summing to 1, and the internal area of each (ADG 4D-1 minima are 35, 50, 70 and 90 m²). */
  mix: { studio: number; one: number; two: number; three: number };
  sizes: { studio: number; one: number; two: number; three: number };
  /** Car parking per dwelling and visitors per dwelling, and per m² of other floor area — the rate sets the slide states. */
  parking: { studio: number; one: number; two: number; three: number; visitor: number; nonResidentialPerSqm: number; basis: string };
  /** Bicycles: per dwelling, visitors per dwelling, per m² of other floor area. */
  bicycles: { perDwelling: number; visitorPerDwelling: number; nonResidentialPerSqm: number };
  /** One motorcycle space per this many car spaces. */
  motorcycleEvery: number;
  /** A basement car space with its share of aisles and ramps, and the share of the site a basement level covers. */
  basementSqmPerSpace: number;
  basementCoverage: number;
  /** The in-fill affordable housing bonus (Housing SEPP): extra FSR and height, as fractions. */
  affordableBonus: number;
}

// The parking rates of the Guide to Traffic Generating Developments (RTA
// 2002, 5.4.3), which ADG 3J-1 makes the most a council may require within
// 800 m of a railway station or light rail stop in the Sydney metropolitan
// area: the metropolitan regional (CBD) centres' rates and the sub-regional
// centres'. Beyond 800 m the council's DCP governs; the defaults then are a
// typical DCP's, and say so.
export const PARKING_RATES = {
  cbd: { studio: 0.4, one: 0.4, two: 0.7, three: 1.2, visitor: 1 / 7, nonResidentialPerSqm: 1 / 100, basis: 'the Guide to Traffic Generating Developments, CBD centres (ADG 3J-1, within 800 m of a station)' },
  subRegional: { studio: 0.6, one: 0.6, two: 0.9, three: 1.4, visitor: 1 / 5, nonResidentialPerSqm: 1 / 100, basis: 'the Guide to Traffic Generating Developments, sub-regional centres (ADG 3J-1, within 800 m of a station)' },
  dcp: { studio: 1, one: 1, two: 1, three: 1.5, visitor: 0.2, nonResidentialPerSqm: 1 / 40, basis: 'a typical council DCP (more than 800 m from a station: the council\'s rates govern)' },
} as const;

export const DEFAULT_ASSUMPTIONS: YieldAssumptions = {
  groundRetailF2F: 4.5, residentialF2F: 3.1, commercialF2F: 3.8, roofAllowance: 1.5,
  podiumStoreys: 4, podiumRear: 6, towerFront: 3, residentialFront: 6,
  adgSide4: 6, adgSide8: 9, adgSide9: 12, commercialTowerSide: 3,
  maxDepth: 18, towerPlateMax: 750,
  residentialEfficiency: 0.82, commercialEfficiency: 0.85, nsaRatio: 0.85,
  mix: { studio: 0.05, one: 0.25, two: 0.55, three: 0.15 },
  sizes: { studio: 40, one: 55, two: 80, three: 105 },
  parking: { ...PARKING_RATES.subRegional },
  bicycles: { perDwelling: 1, visitorPerDwelling: 0.1, nonResidentialPerSqm: 1 / 200 },
  motorcycleEvery: 50,
  basementSqmPerSpace: 30, basementCoverage: 0.9,
  affordableBonus: 0.3,
};

/** What the zone builds: apartments, shops under apartments, offices, or none of these. */
export type Archetype = 'residential' | 'mixed' | 'commercial' | 'none';

/**
 * The building type a zone takes for a yield study. Residential flat
 * buildings in R1, R3 and R4 (many R3 zones allow only multi dwelling
 * housing: the slide says so); shop-top housing in the centres and the mixed
 * use zones; offices in the commercial and productivity zones; and nothing
 * apartment-shaped anywhere else, where the slide states the controls alone.
 */
export function archetypeFor(zone: string | undefined): Archetype {
  const z = (zone ?? '').toUpperCase().trim();
  if (/^R[134]$/.test(z)) return 'residential';
  if (/^(MU1|E1|B1|B2|B4)$/.test(z)) return 'mixed';
  if (/^(E2|E3|E4|E5|B3|B5|B6|B7|IN1|IN2)$/.test(z)) return 'commercial';
  return 'none';
}

/**
 * The zones a residential flat building or shop-top housing is permitted in
 * under the Standard Instrument, where a neighbour's future is built up to
 * its height control. Low density and rural are left out: their future is a
 * house. Sun-study's future context reads the same list.
 */
export const FUTURE_ZONES = ['R1', 'R3', 'R4', 'B1', 'B2', 'B3', 'B4', 'E1', 'E2', 'MU1'];

/**
 * A neighbour's future height: its own footprint raised to the whole storeys
 * its height of building holds, in a zone that permits flats. Never lowered —
 * a building already at or over the control is its own future — so undefined
 * where it would not rise. A building whose height is not recorded stands at
 * two storeys, as the massing draws it.
 */
export function futureHeight(zone: string | undefined, hobM: number | undefined, standingM: number | undefined, storeyM = 3.1): number | undefined {
  if (!hobM || hobM <= 0 || !FUTURE_ZONES.includes((zone ?? '').toUpperCase().trim())) return undefined;
  const allowed = Math.floor(hobM / storeyM + 1e-9);
  const standing = standingM && standingM > 0 ? Math.max(1, Math.round(standingM / storeyM)) : 2;
  return allowed > standing ? allowed * storeyM : undefined;
}

export type Use = 'retail' | 'residential' | 'commercial';

/** A band of storeys built to one set of setbacks. */
export interface Tier {
  name: string;
  /** Storeys, counted from 1 at the ground. */
  from: number;
  to: number;
  use: Use;
  /** Setback from the street frontages, the side boundaries and the rear. */
  front: number;
  side: number;
  rear: number;
  /** The most the setbacks leave, and the plate the study builds on it (held to a depth or a tower size). */
  envelopeSqm: number;
  plateSqm: number;
  envelope: XY[][];
  plate: XY[][];
  /** The plate's limit, when one applies: 'depth' (ADG 2E) or 'tower' (the plate size). */
  held?: 'depth' | 'tower';
}

export interface YieldInput {
  /** The site's outer boundary, local metres, in order (closed or not). */
  ring: XY[];
  /** Per edge i (ring[i] → ring[i+1]): a street runs along it. */
  fronts: boolean[];
  siteAreaSqm: number;
  zone?: string;
  /** Height of building in metres above ground; the caller converts an RL limit. */
  hobM?: number;
  fsr?: number;
  assumptions?: Partial<YieldAssumptions>;
}

export interface UnitCount { studio: number; one: number; two: number; three: number; total: number }

export interface YieldResult {
  archetype: Archetype;
  assumptions: YieldAssumptions;
  siteAreaSqm: number;
  hobM?: number;
  fsr?: number;
  /** Storeys the height of building holds, and those the study builds (fewer when the FSR runs out first). */
  storeysByHeight: number;
  storeys: number;
  /** Building height of the storeys built, to the top of the roof allowance. */
  heightM: number;
  tiers: Tier[];
  /** Floor area: what the FSR allows, what the envelope's plates hold, what is achieved, and which of the two governs. */
  gfaByFsr?: number;
  gfaCapacity: number;
  gfa: number;
  governs: 'fsr' | 'envelope' | 'height';
  gfaByUse: Record<Use, number>;
  gba: number;
  /** Storey by storey: its use, its plate and its floor area. */
  floors: { storey: number; use: Use; gba: number; gfa: number }[];
  nsa: number;
  units: UnitCount;
  averageUnitSqm: number;
  parking: { residents: number; visitors: number; nonResidential: number; total: number; motorcycles: number; bicycles: number; basementLevels: number };
  adg: {
    communalOpenSpaceSqm: number;
    deepSoil: { requiredSqm: number; minDimension: number; groundFreeSqm: number; possible: boolean };
  };
}

// ---- geometry ----------------------------------------------------------------

const open = (ring: XY[]): XY[] =>
  ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;

export function ringArea(ring: XY[]): number {
  const p = open(ring);
  let a = 0;
  for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u.x * v.y - v.x * u.y; }
  return Math.abs(a / 2);
}

function inRing(x: number, y: number, p: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) inside = !inside;
  }
  return inside;
}

function segDist(x: number, y: number, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** The lot on a grid: each cell's distance to every edge is what the setbacks are tested against. */
interface Grid { x0: number; y0: number; nx: number; ny: number; cell: number; inside: Uint8Array; dist: Float32Array[] }

function gridOf(ring: XY[]): Grid {
  const p = open(ring);
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  // Fine enough to read a setback to a few centimetres on an ordinary lot,
  // coarse enough that a large one stays near 200 000 cells.
  const cell = Math.max(0.25, Math.sqrt((w * h) / 200_000));
  const nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
  const inside = new Uint8Array(nx * ny);
  const dist = p.map(() => new Float32Array(nx * ny));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell, c = j * nx + i;
    if (!inRing(x, y, p)) continue;
    inside[c] = 1;
    for (let e = 0; e < p.length; e++) dist[e][c] = segDist(x, y, p[e], p[(e + 1) % p.length]);
  }
  return { x0, y0, nx, ny, cell, inside, dist };
}

/** Each cell's slack under a set of setbacks: how much further it stands from the nearest setback line than it must; negative outside. */
function slackOf(g: Grid, setbacks: number[]): Float32Array {
  const out = new Float32Array(g.nx * g.ny).fill(-1);
  for (let c = 0; c < out.length; c++) {
    if (!g.inside[c]) continue;
    let s = Infinity;
    for (let e = 0; e < setbacks.length; e++) s = Math.min(s, g.dist[e][c] - setbacks[e]);
    out[c] = s;
  }
  return out;
}

const cellsWhere = (slack: Float32Array, test: (s: number) => boolean): Uint8Array => {
  const m = new Uint8Array(slack.length);
  for (let c = 0; c < slack.length; c++) if (slack[c] >= 0 && test(slack[c])) m[c] = 1;
  return m;
};
const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

/**
 * The outline of a set of cells as rings: the cell edges between a set cell
 * and an unset one, chained head to tail, then straightened (Douglas–Peucker)
 * so a setback line reads as a line and not as a staircase.
 */
function outline(g: Grid, m: Uint8Array): XY[][] {
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.ny && m[j * g.nx + i] === 1;
  // Directed edges, the set cells kept on the left; keyed by their start corner.
  const next = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => { const k = `${a[0]},${a[1]}`; (next.get(k) ?? next.set(k, []).get(k)!).push(b); };
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add([i, j], [i + 1, j]);
    if (!at(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!at(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!at(i - 1, j)) add([i, j + 1], [i, j]);
  }
  const rings: XY[][] = [];
  for (const [startKey] of next) {
    while ((next.get(startKey)?.length ?? 0) > 0) {
      const pts: [number, number][] = [];
      let k = startKey;
      for (let guard = 0; guard < 1e6; guard++) {
        const list = next.get(k);
        if (!list?.length) break;
        const to = list.shift()!;
        pts.push(to);
        k = `${to[0]},${to[1]}`;
        if (k === startKey) break;
      }
      if (pts.length >= 4) rings.push(simplify(pts.map(([i, j]) => ({ x: g.x0 + i * g.cell, y: g.y0 + j * g.cell })), g.cell * 1.6));
    }
  }
  return rings.filter((r) => r.length >= 3);
}

function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i].x, pts[i].y, pts[a], pts[b]); if (d > bestD) { bestD = d; best = i; } }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---- the study -----------------------------------------------------------------

/** Storeys under a height of building: a ground floor at its own height, the rest at the typical floor to floor, the roof allowance kept clear. */
export function storeysUnder(hobM: number, ground: number, typical: number, roof: number): number {
  const free = hobM - roof - ground;
  return free < 0 ? 0 : 1 + Math.floor(free / typical + 1e-9);
}

/** The ADG's separation to a side or rear boundary for the storeys of a tier: the tallest storey decides. */
const adgSide = (a: YieldAssumptions, to: number) => (to <= 4 ? a.adgSide4 : to <= 8 ? a.adgSide8 : a.adgSide9);

/** The tiers a building of `n` storeys of this archetype rises in, with the setbacks of each. */
type TierSpec = Omit<Tier, 'envelopeSqm' | 'plateSqm' | 'envelope' | 'plate'> & { podium: boolean };

function tiersFor(arch: Archetype, n: number, a: YieldAssumptions): TierSpec[] {
  const out: TierSpec[] = [];
  const band = (name: string, from: number, to: number, use: Use, front: number, side: number, rear: number, podium = false) => {
    if (to >= from) out.push({ name, from, to, use, front, side, rear, podium });
  };
  if (arch === 'residential') {
    band('Storeys 1–4', 1, Math.min(4, n), 'residential', a.residentialFront, a.adgSide4, a.adgSide4);
    band('Storeys 5–8', 5, Math.min(8, n), 'residential', a.residentialFront, a.adgSide8, a.adgSide8);
    band('Storeys 9 and up', 9, n, 'residential', a.residentialFront, a.adgSide9, a.adgSide9);
  } else if (arch === 'mixed') {
    // The ground floor's shops and the podium over them are built to the street
    // and side boundaries, the podium's apartments kept off the rear; the
    // apartments above step back by the ADG's separations, and from the street
    // by the tower setback.
    const p = Math.min(a.podiumStoreys, n);
    band('Ground floor, retail', 1, 1, 'retail', 0, 0, 0, true);
    band(p > 2 ? `Podium, storeys 2–${p}` : 'Podium, storey 2', 2, p, 'residential', 0, 0, a.podiumRear, true);
    band(`Storeys ${p + 1}–8`, p + 1, Math.min(8, n), 'residential', a.towerFront, a.adgSide8, a.adgSide8);
    band(`Storeys ${Math.max(9, p + 1)} and up`, Math.max(9, p + 1), n, 'residential', a.towerFront, a.adgSide9, a.adgSide9);
  } else if (arch === 'commercial') {
    const p = Math.min(a.podiumStoreys, n);
    band('Podium', 1, p, 'commercial', 0, 0, 0, true);
    band('Tower', p + 1, n, 'commercial', a.towerFront, a.commercialTowerSide, a.commercialTowerSide);
  }
  return out;
}

/**
 * Each boundary's kind: a street frontage, the rear (facing away from the
 * main frontage, within 45°), or a side. A lot with no frontage is all sides.
 */
export function edgeKinds(ring: XY[], fronts: boolean[]): ('front' | 'side' | 'rear')[] {
  const p = open(ring);
  let signed = 0;
  for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; signed += u.x * v.y - v.x * u.y; }
  const normal = (i: number) => {
    const u = p[i], v = p[(i + 1) % p.length], dx = v.x - u.x, dy = v.y - u.y, l = Math.hypot(dx, dy) || 1;
    return signed > 0 ? { x: dy / l, y: -dx / l, l } : { x: -dy / l, y: dx / l, l };
  };
  let main: { x: number; y: number; l: number } | null = null;
  p.forEach((_, i) => { if (fronts[i]) { const n = normal(i); if (!main || n.l > main.l) main = n; } });
  return p.map((_, i) => {
    if (fronts[i]) return 'front';
    if (!main) return 'side';
    const n = normal(i), m = main as { x: number; y: number };
    return n.x * -m.x + n.y * -m.y > Math.SQRT1_2 ? 'rear' : 'side';
  });
}

export function computeYield(input: YieldInput): YieldResult {
  const a: YieldAssumptions = {
    ...DEFAULT_ASSUMPTIONS, ...input.assumptions,
    mix: { ...DEFAULT_ASSUMPTIONS.mix, ...input.assumptions?.mix },
    sizes: { ...DEFAULT_ASSUMPTIONS.sizes, ...input.assumptions?.sizes },
    parking: { ...DEFAULT_ASSUMPTIONS.parking, ...input.assumptions?.parking },
    bicycles: { ...DEFAULT_ASSUMPTIONS.bicycles, ...input.assumptions?.bicycles },
  };
  const arch = archetypeFor(input.zone);
  const ring = open(input.ring);
  const A = input.siteAreaSqm;
  const ground = arch === 'mixed' ? a.groundRetailF2F : arch === 'commercial' ? a.commercialF2F : a.residentialF2F;
  const typical = arch === 'commercial' ? a.commercialF2F : a.residentialF2F;
  const storeysByHeight = input.hobM ? storeysUnder(input.hobM, ground, typical, a.roofAllowance) : 0;
  const empty: YieldResult = {
    archetype: arch, assumptions: a, siteAreaSqm: A, hobM: input.hobM, fsr: input.fsr,
    storeysByHeight, storeys: 0, heightM: 0, tiers: [], gfaByFsr: input.fsr ? input.fsr * A : undefined, gfaCapacity: 0, gfa: 0,
    governs: 'height', gfaByUse: { retail: 0, residential: 0, commercial: 0 }, gba: 0, floors: [], nsa: 0,
    units: { studio: 0, one: 0, two: 0, three: 0, total: 0 }, averageUnitSqm: 0,
    parking: { residents: 0, visitors: 0, nonResidential: 0, total: 0, motorcycles: 0, bicycles: 0, basementLevels: 0 },
    adg: { communalOpenSpaceSqm: 0.25 * A, deepSoil: { requiredSqm: 0.07 * A, minDimension: A < 650 ? 0 : A <= 1500 ? 3 : 6, groundFreeSqm: A, possible: true } },
  };
  if (arch === 'none' || !storeysByHeight || ring.length < 3) return empty;

  const g = gridOf(ring);
  const cellA = g.cell * g.cell;
  // The lot's own area on the grid, so a plate is scaled to the cadastral area rather than the grid's approximation of it.
  const scale = A / Math.max(cellA, count(g.inside) * cellA);
  const kinds = edgeKinds(ring, ring.map((_, i) => !!input.fronts[i]));
  const tiers: Tier[] = tiersFor(arch, storeysByHeight, a).map(({ podium: isPodium, ...t }) => {
    const slack = slackOf(g, kinds.map((kd) => (kd === 'front' ? t.front : kd === 'rear' ? t.rear : t.side)));
    const env = cellsWhere(slack, () => true);
    const envelopeSqm = count(env) * cellA * scale;
    let plateMask = env, held: Tier['held'];
    // A residential tower is held to its plate size, centred on the envelope by
    // eroding it evenly; apartments elsewhere to the ADG's building depth.
    if (t.use === 'residential' && t.from >= 9 && envelopeSqm > a.towerPlateMax) {
      let lo = 0, hi = 60;
      for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (count(cellsWhere(slack, (s) => s >= mid)) * cellA * scale > a.towerPlateMax) lo = mid; else hi = mid; }
      plateMask = cellsWhere(slack, (s) => s >= hi);
      held = 'tower';
    } else if (t.use === 'residential' && !isPodium) {
      let deepest = 0;
      for (let c = 0; c < slack.length; c++) if (slack[c] > deepest) deepest = slack[c];
      // Wider than one building depth across: a perimeter of the depth round a
      // courtyard. The courtyard must keep the separation the ADG asks across it
      // (twice the boundary setback); where it cannot, the wings thin to keep it.
      if (deepest > a.maxDepth / 2 + 0.5) {
        const sep = t.side * 2;
        const depth = deepest - a.maxDepth >= sep / 2 ? a.maxDepth : Math.max(a.maxDepth / 2, deepest - sep / 2);
        plateMask = cellsWhere(slack, (s) => s <= depth);
        held = 'depth';
      }
    }
    return { ...t, envelopeSqm, plateSqm: count(plateMask) * cellA * scale, envelope: outline(g, env), plate: outline(g, plateMask), held };
  });

  // Storey by storey, until the height runs out or the floor space ratio does.
  const eff = (u: Use) => (u === 'residential' ? a.residentialEfficiency : a.commercialEfficiency);
  const cap = input.fsr ? input.fsr * A : Infinity;
  const floors: YieldResult['floors'] = [];
  let capacity = 0, total = 0;
  for (const t of tiers) for (let s = t.from; s <= t.to; s++) {
    const full = t.plateSqm * eff(t.use);
    capacity += full;
    if (total >= cap - 1e-6 || t.plateSqm < 1) continue;
    const take = Math.min(full, cap - total);
    floors.push({ storey: s, use: t.use, gba: t.plateSqm * (take / full), gfa: take });
    total += take;
  }
  const storeys = floors.length;
  const gfaByUse: Record<Use, number> = { retail: 0, residential: 0, commercial: 0 };
  for (const f of floors) gfaByUse[f.use] += f.gfa;
  const heightM = storeys ? (storeys === 1 ? ground : ground + (storeys - 1) * typical) + a.roofAllowance : 0;
  const governs: YieldResult['governs'] = Number.isFinite(cap) && capacity > cap ? 'fsr' : 'envelope';

  // Apartments: the saleable area over the mix's average size, shared out by the mix (largest remainder).
  const nsa = gfaByUse.residential * a.nsaRatio;
  const keys = ['studio', 'one', 'two', 'three'] as const;
  const mixSum = keys.reduce((s, k) => s + a.mix[k], 0) || 1;
  const avg = keys.reduce((s, k) => s + (a.mix[k] / mixSum) * a.sizes[k], 0);
  const n = avg > 0 ? Math.floor(nsa / avg) : 0;
  const raw = keys.map((k) => (n * a.mix[k]) / mixSum);
  const units = { studio: 0, one: 0, two: 0, three: 0, total: n };
  keys.forEach((k, i) => { units[k] = Math.floor(raw[i]); });
  let left = n - keys.reduce((s, k) => s + units[k], 0);
  for (const i of raw.map((v, i) => i).sort((p, q) => (raw[q] % 1) - (raw[p] % 1))) { if (left <= 0) break; units[keys[i]]++; left--; }

  const nonRes = gfaByUse.retail + gfaByUse.commercial;
  const residents = keys.reduce((s, k) => s + units[k] * a.parking[k], 0);
  const visitors = n * a.parking.visitor;
  const nonResidential = nonRes * a.parking.nonResidentialPerSqm;
  const totalCars = Math.ceil(residents) + Math.ceil(visitors) + Math.ceil(nonResidential);
  const bicycles = Math.ceil(n * a.bicycles.perDwelling) + Math.ceil(n * a.bicycles.visitorPerDwelling) + Math.ceil(nonRes * a.bicycles.nonResidentialPerSqm);
  const basementLevels = totalCars ? Math.ceil((totalCars * a.basementSqmPerSpace) / (A * a.basementCoverage)) : 0;

  const groundPlate = floors.length ? floors[0].gba : 0;
  const minDimension = A < 650 ? 0 : A <= 1500 ? 3 : 6;
  return {
    archetype: arch, assumptions: a, siteAreaSqm: A, hobM: input.hobM, fsr: input.fsr,
    storeysByHeight, storeys, heightM, tiers,
    gfaByFsr: Number.isFinite(cap) ? cap : undefined, gfaCapacity: capacity, gfa: total, governs: Number.isFinite(cap) ? governs : 'height',
    gfaByUse, gba: floors.reduce((s, f) => s + f.gba, 0), floors, nsa, units, averageUnitSqm: avg,
    parking: { residents: Math.ceil(residents), visitors: Math.ceil(visitors), nonResidential: Math.ceil(nonResidential), total: totalCars, motorcycles: Math.ceil(totalCars / a.motorcycleEvery), bicycles, basementLevels },
    adg: {
      communalOpenSpaceSqm: 0.25 * A,
      deepSoil: { requiredSqm: 0.07 * A, minDimension, groundFreeSqm: Math.max(0, A - groundPlate), possible: A - groundPlate >= 0.07 * A },
    },
  };
}

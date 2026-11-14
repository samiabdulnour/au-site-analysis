// Building separation (ADG 3F-1): how far a scheme stands from each building
// round it, against the separation the Apartment Design Guide asks between
// them, storey band by storey band.
//
// The yield keeps the ADG's half of each separation to every side and rear
// boundary, so the scheme does its part. What this measures is the distance
// that results: where a neighbour stands nearer its boundary than its own
// half, or rises into a band that asks more, the two fall short of the whole.
// The ADG's table, Part 3F design guidance, between habitable rooms and
// balconies: 12 m up to four storeys, 18 m from five to eight, 24 m from nine
// up; and where one of the two faces is blank (habitable to non-habitable)
// three quarters of that, 9, 13.5 and 18 m. Which faces have windows is the
// design's, so a distance under the first but over the second is read "holds
// if one face is blank".
//
// A neighbour across a street is left out: the street's width and the DCP's
// setbacks govern there. A building's storeys are its height at 3.1 m each,
// two where no height is recorded, as the massing draws it.

import type { XY } from './yield.js';

/** One row of the ADG's separation table: the band's storeys, the separation between habitable rooms, and where one face is blank. */
export interface SeparationBand { from: number; to: number; storeys: string; between: number; blank: number }

/** ADG Part 3F-1, design guidance: the separations between buildings, by the storeys they share. */
export const ADG_SEPARATION: SeparationBand[] = [
  { from: 1, to: 4, storeys: 'up to 4 storeys', between: 12, blank: 9 },
  { from: 5, to: 8, storeys: '5 to 8 storeys', between: 18, blank: 13.5 },
  { from: 9, to: Infinity, storeys: '9 storeys and over', between: 24, blank: 18 },
];

/** A tier of the scheme as separation reads it: its plate and the storeys it is built from and to. */
export interface SchemeTier { rings: XY[][]; from: number; to: number }
/** A building round about: its footprint, and its storeys today and as its controls let it rise (where they do). */
export interface Neighbour { rings: XY[][]; storeys: number; futureStoreys?: number }

/** How a distance reads against a band: clear of the separation, holding only if one face is blank, or short of both. */
export type SeparationStatus = 'clear' | 'blank' | 'short';

/** A neighbour's separation at one height of it: the band they share at their closest, the distance, the separation asked, and the two nearest points. */
export interface SeparationReading { band: SeparationBand; distanceM: number; status: SeparationStatus; a: XY; b: XY }

export interface SeparationRow {
  /** The neighbour's index in the list given. */
  index: number;
  /** Today, and with the neighbour built to its controls where it would rise: the worst band of each. */
  today: SeparationReading;
  future?: SeparationReading;
}

const segDist = (p: XY, a: XY, b: XY): { d: number; q: XY } => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
};

function inRing(p: XY, rg: XY[]): boolean {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    if (rg[i].y > p.y !== rg[j].y > p.y && p.x < ((rg[j].x - rg[i].x) * (p.y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c;
  }
  return c;
}

/** The least distance between two sets of rings, with the two points it runs between; 0 where they overlap. */
export function ringsDistance(as: XY[][], bs: XY[][]): { d: number; a: XY; b: XY } {
  let best = { d: Infinity, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  for (const ra of as) for (const rb of bs) {
    if (ra.length < 3 || rb.length < 3) continue;
    if (inRing(ra[0], rb)) return { d: 0, a: ra[0], b: ra[0] };
    if (inRing(rb[0], ra)) return { d: 0, a: rb[0], b: rb[0] };
    for (let i = 0; i < ra.length; i++) for (let j = 0; j < rb.length; j++) {
      const p = ra[i], q = rb[j];
      const x = segDist(p, rb[j], rb[(j + 1) % rb.length]);
      if (x.d < best.d) best = { d: x.d, a: p, b: x.q };
      const y = segDist(q, ra[i], ra[(i + 1) % ra.length]);
      if (y.d < best.d) best = { d: y.d, a: y.q, b: q };
    }
  }
  return best;
}

/** Whether two segments cross. */
function crosses(p1: XY, p2: XY, q1: XY, q2: XY): boolean {
  const o = (a: XY, b: XY, c: XY) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2);
}

/** The worst band two buildings share, of the scheme's tiers and a neighbour of so many storeys; undefined where they share none within reach. */
function reading(tiers: SchemeTier[], rings: XY[][], storeys: number): SeparationReading | undefined {
  let worst: SeparationReading | undefined;
  for (const band of ADG_SEPARATION) {
    if (storeys < band.from) continue;
    // the scheme's plates in the band, and the nearest of them
    const plates = tiers.filter((t) => t.from <= band.to && t.to >= band.from).flatMap((t) => t.rings);
    if (!plates.length) continue;
    const m = ringsDistance(plates, rings);
    const status: SeparationStatus = m.d >= band.between - 0.05 ? 'clear' : m.d >= band.blank - 0.05 ? 'blank' : 'short';
    // the worst is the one furthest short of the separation between habitable rooms
    if (!worst || m.d - band.between < worst.distanceM - worst.band.between) worst = { band, distanceM: m.d, status, a: m.a, b: m.b };
  }
  return worst;
}

/**
 * Each neighbour within the largest separation of the scheme (24 m), and not across a street from it, with its
 * separation today and as its controls let it rise. `site` and `fronts` say which of the site's edges are street
 * frontages: a neighbour whose nearest line to the scheme crosses one is across the street, and left out.
 */
export function separations(tiers: SchemeTier[], neighbours: Neighbour[], site: XY[], fronts: boolean[]): SeparationRow[] {
  const reach = Math.max(...ADG_SEPARATION.map((b) => b.between));
  const all = tiers.flatMap((t) => t.rings);
  if (!all.length) return [];
  const streets = site.map((p, i) => (fronts[i] ? [p, site[(i + 1) % site.length]] : null)).filter((e): e is XY[] => !!e);
  const rows: SeparationRow[] = [];
  neighbours.forEach((nb, index) => {
    const rings = nb.rings.filter((rg) => rg.length >= 3);
    if (!rings.length) return;
    const near = ringsDistance(all, rings);
    if (near.d >= reach) return;
    if (streets.some(([p, q]) => crosses(near.a, near.b, p, q))) return;
    const today = reading(tiers, rings, Math.max(1, nb.storeys));
    if (!today) return;
    const future = nb.futureStoreys && nb.futureStoreys > nb.storeys ? reading(tiers, rings, nb.futureStoreys) : undefined;
    rows.push({ index, today, ...(future ? { future } : {}) });
  });
  const rank: Record<SeparationStatus, number> = { short: 0, blank: 1, clear: 2 };
  const worstOf = (r: SeparationRow) => Math.min(rank[r.today.status], r.future ? rank[r.future.status] : 2);
  return rows.sort((p, q) => worstOf(p) - worstOf(q) || p.today.distanceM - q.today.distanceM);
}

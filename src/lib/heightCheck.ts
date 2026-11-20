// A second look at the heights the open sources give.
//
// A source's height was taken as it stood: a `height` or a storey count on a
// footprint was a measure, and nothing read after it (the 3D meshes, a
// determined application) touched it. One wrong tag then drew a tower: at
// Maroubra a mapper typed a house's street number, 62, into its `height`
// (OpenStreetMap way 1436151685, 62 Boyce Road; Overture carried it), and
// the house stood 62 m, twenty storeys, the tallest building on the page,
// in the massing, in the shadows and in the narrative.
//
// Two checks, both arithmetic, neither a source of its own:
//
//  - against the 3D meshes, where they were read (lib/meshHeights.ts): the
//    surface gives every footprint a height of its own, and a source's height
//    that is grossly apart from it (by more than 8 m and by more than six
//    tenths of the greater) gives way to the meshes' reading;
//  - against the building's own footprint and the plan over it, where no
//    mesh spoke: a height over 25 m that is more than five times the
//    footprint's lesser side and more than three times the height limit
//    mapped over it (more than eight times the lesser side where no limit is
//    mapped) is not believed, and the building is drawn as one with no
//    recorded height.
//
// And a third, on the meshes' own readings, which are a surface seen from
// above and take a tree for a roof where its picture is not green (a
// Norfolk Island pine, a fig in shadow): a height the meshes read that is
// over 12 m, more than one and a half times the footprint's lesser side,
// and either under no height limit at all (a park) or more than 1.4 times
// the limit mapped over it, is a tree or a mast, not a building. A
// footprint the sources gave keeps its place with no height; one traced
// from the meshes alone, which was only ever inferred, is not drawn.
//
// What was set aside stays on the building (`doubted`), so the deck can say
// how many heights it did not take, and its JSON which and why.

import type { Building, BuildingsData } from '../fetch/buildings.js';

/** Two readings of one building's height disagree grossly: by more than 8 m, and by more than six tenths of the greater. */
export const grosslyApart = (a: number, b: number): boolean => {
  const d = Math.abs(a - b);
  return d > 8 && d > 0.6 * Math.max(a, b);
};

/** Under this no height is questioned by its shape: eight storeys stand on a house's footprint often enough. */
export const SLENDER_OVER_M = 25;
/** A height over this many times its footprint's lesser side is a pencil tower, or a mistake. */
export const SLENDER_RATIO = 5;
/** … and over this many times it where no height limit is mapped to weigh it against. */
export const SLENDER_RATIO_ALONE = 8;
/** A height over this many times the limit mapped over it is far outside its plan. */
export const OVER_LIMIT = 3;

/** The sides of a lon/lat ring's least bounding rectangle, metres: the lesser, then the greater. */
export function footprintSidesM(ring: number[][]): [number, number] {
  if (ring.length < 3) return [0, 0];
  const lat0 = ring[0][1], mE = 111_320 * Math.cos((lat0 * Math.PI) / 180), mN = 110_574;
  const pts = ring.map(([lon, lat]) => [(lon - ring[0][0]) * mE, (lat - lat0) * mN]);
  let best = Infinity, sides: [number, number] = [0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.5) continue;
    const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of pts) { const u = x * ux + y * uy, v = -x * uy + y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const w = u1 - u0, h = v1 - v0;
    if (w * h < best) { best = w * h; sides = [Math.min(w, h), Math.max(w, h)]; }
  }
  return sides;
}

/** A height the meshes read is questioned over this, by this slenderness and this far over its limit. */
export const MESH_OVER_M = 12, MESH_SLENDER = 1.5, MESH_OVER_LIMIT = 1.4;

/** Why a height the meshes read on a footprint of these sides, under this limit, is a tree's or a mast's; null where it may stand. */
export function implausibleMeshHeight(heightM: number, sidesM: [number, number], limitM?: number): string | null {
  const [w, l] = sidesM;
  if (!(heightM > MESH_OVER_M) || !(w > 0) || heightM / w <= MESH_SLENDER) return null;
  const limited = limitM !== undefined && limitM > 0;
  if (limited && heightM <= MESH_OVER_LIMIT * limitM!) return null;
  return `the 3D meshes read ${Math.round(heightM)} m on a footprint of ${Math.round(w)} × ${Math.round(l)} m, ${limited ? `under a height limit of ${Number(limitM!.toFixed(1))} m` : 'where no height limit is mapped'}: a tree or a mast`;
}

/** Why a height on a footprint of these sides, under this limit, is not believed; null where it may stand. */
export function implausibleHeight(heightM: number, sidesM: [number, number], limitM?: number): string | null {
  const [w, l] = sidesM;
  if (!(heightM > SLENDER_OVER_M) || !(w > 0)) return null;
  const limited = limitM !== undefined && limitM > 0;
  if (heightM / w <= (limited ? SLENDER_RATIO : SLENDER_RATIO_ALONE)) return null;
  if (limited && heightM <= OVER_LIMIT * limitM!) return null;
  return `${Math.round(heightM)} m on a footprint of ${Math.round(w)} × ${Math.round(l)} m${limited ? `, under a height limit of ${Number(limitM!.toFixed(1))} m` : ''}`;
}

/**
 * The buildings with the heights that cannot be believed set aside: a source's height (measured, or from its storeys)
 * the meshes did not read and that its own footprint and the height limit over it contradict. The building stays,
 * with no height, and carries what was set aside. `limitAt` gives the height limit mapped at a point, metres above
 * ground, where one is. Pure.
 */
export function checkHeights(data: BuildingsData, opts: { limitAt?: (lon: number, lat: number) => number | undefined } = {}): BuildingsData {
  let doubted = 0, untraced = 0;
  const buildings = data.buildings.flatMap((b): Building[] => {
    // the meshes' own reading, where it is a tree's: a traced footprint goes, a source's stays with no height
    if (b.heightFrom === 'mesh' && b.estimatedHeightM && !b.doubted) {
      const why = implausibleMeshHeight(b.estimatedHeightM, footprintSidesM(b.rings[0] ?? []), opts.limitAt?.(b.centroid[0], b.centroid[1]));
      if (!why) return [b];
      if (b.source === 'mesh') { untraced++; return []; }
      doubted++;
      return [{ ...b, heightM: undefined, floors: undefined, estimatedHeightM: undefined, heightFrom: 'none', doubted: { heightM: b.estimatedHeightM, from: 'mesh', why } }];
    }
    return [check(b)];
  });
  function check(b: Building): Building {
    if ((b.heightFrom !== 'measured' && b.heightFrom !== 'floors') || !b.estimatedHeightM) return b;
    // the meshes read it and did not contradict it (lib/meshHeights.ts replaces the ones they do)
    if (b.meshM !== undefined) return b;
    const why = implausibleHeight(b.estimatedHeightM, footprintSidesM(b.rings[0] ?? []), opts.limitAt?.(b.centroid[0], b.centroid[1]));
    if (!why) return b;
    doubted++;
    return { ...b, heightM: undefined, floors: undefined, estimatedHeightM: undefined, heightFrom: 'none', doubted: { heightM: b.estimatedHeightM, from: b.heightFrom, why } };
  }
  if (!doubted && !untraced) return data;
  const mesh = data.mesh && untraced ? { ...data.mesh, footprints: Math.max(0, data.mesh.footprints - untraced) } : data.mesh;
  return { ...data, buildings, mesh, note: [data.note, doubted ? `${doubted} height${doubted === 1 ? '' : 's'} set aside as implausible` : '', untraced ? `${untraced} traced footprint${untraced === 1 ? '' : 's'} left out as trees or masts` : ''].filter(Boolean).join('; ') };
}

/** The heights a deck did not take from its sources, for its log, its sources line and its JSON. */
export function doubtedHeights(data: BuildingsData): { id: string; heightM: number; from: 'measured' | 'floors' | 'mesh'; why: string; now?: number; centroid: [number, number] }[] {
  return data.buildings.filter((b) => b.doubted).map((b) => ({ id: b.id, ...b.doubted!, now: b.estimatedHeightM, centroid: b.centroid }));
}

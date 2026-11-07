// The lots on a window that no footprint touches, outside the zones that are
// meant to stand empty (recreation, conservation, infrastructure and
// waterways). Neither open source maps every building — Overture and
// OpenStreetMap both miss most of Bondi Road's shopping strip — so these are
// drawn and counted as a gap in the data, not as open land, and the 3D
// meshes are asked for what stands on them (lib/meshHeights.ts). Slivers
// under 40 m² and lots over 5,000 m² are left out of the count.

import { geomRings, pointInRing } from '../fetch/planning.js';
import { lonLatToMercator, mercatorScaleFactor, type Extent } from './geo.js';
import type { GeoJSONFC } from './arcgis.js';
import type { Building } from '../fetch/buildings.js';

/** Zones whose lots stand empty by design: no footprint on one is no gap in the data. */
const EMPTY_ZONE = /^(RE\d|C\d|SP2|W\d)$/;

function centroidLL(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * The lots in `extent` (Web Mercator) that hold no footprint: their rings, their count, and the count of lots that
 * should hold a building (the built ones and the gaps together).
 */
export function lotsWithoutFootprint(buildings: Building[], lots: GeoJSONFC, zoning: GeoJSONFC, siteLots: GeoJSONFC, ext: Extent): { gaps: number[][][][]; count: number; lots: number } {
  const CELL = 0.0005;
  const grid = new Map<string, Building[]>();
  for (const bd of buildings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lon, lat] of bd.rings[0] ?? []) { x0 = Math.min(x0, lon); y0 = Math.min(y0, lat); x1 = Math.max(x1, lon); y1 = Math.max(y1, lat); }
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
      const key = `${i},${j}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(bd);
    }
  }
  const near = (lon: number, lat: number) => grid.get(`${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`) ?? [];
  const zones = zoning.features.map((f) => ({ code: String(f.properties.SYM_CODE ?? ''), rings: geomRings(f.geometry) }));
  const siteRings = siteLots.features.flatMap((f) => geomRings(f.geometry));
  const gaps: number[][][][] = [];
  let built = 0;
  for (const f of lots.features) {
    const rings = geomRings(f.geometry);
    const outer = rings[0];
    if (!outer || outer.length < 4) continue;
    const [clon, clat] = centroidLL(outer);
    const m = lonLatToMercator({ lon: clon, lat: clat });
    if (m.x < ext.xmin || m.x > ext.xmax || m.y < ext.ymin || m.y > ext.ymax) continue;
    if (siteRings.some((r) => pointInRing(clon, clat, r))) continue;
    const zone = zones.find((z) => z.rings.some((r) => pointInRing(clon, clat, r)));
    if (!zone || EMPTY_ZONE.test(zone.code)) continue;
    const k = mercatorScaleFactor(clat);
    let s = 0; const pts = outer.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
    for (let i = 0; i < pts.length - 1; i++) s += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
    const areaM2 = Math.abs(s / 2) / (k * k);
    if (areaM2 < 40 || areaM2 > 5000) continue;
    // a footprint stands on the lot when its centroid or a vertex is inside it, or the lot's centroid is inside it
    const cands = new Set<Building>();
    for (const [lon, lat] of outer) for (const bd of near(lon, lat)) cands.add(bd);
    for (const bd of near(clon, clat)) cands.add(bd);
    const hit = [...cands].some((bd) => pointInRing(bd.centroid[0], bd.centroid[1], outer) || pointInRing(clon, clat, bd.rings[0]) || bd.rings[0].some(([lon, lat]) => pointInRing(lon, lat, outer)));
    if (hit) built++; else gaps.push(rings);
  }
  return { gaps, count: gaps.length, lots: built + gaps.length };
}

// The surface Google's 3D meshes make over a window, read from above for the
// heights the open sources lack (lib/meshHeights.ts): the meshes over the
// whole window are fetched as the streetscape fetches them over its street
// (fetch/tiles3d.ts), coarse enough to be a few score rather than a few
// hundred, rendered straight down into a grid of heights a metre apart
// (render/elevation3d.ts renderSurface), and let go. The meshes are never
// written anywhere, as Google's terms ask; what is kept of them is a number a
// building: its height.

import { fetchStreetTiles, enuFrame, type Corridor } from './tiles3d.js';
import { renderSurface } from '../render/elevation3d.js';
import { localFrame, type HeightField, type LocalFrame } from '../lib/meshHeights.js';
import { mercatorScaleFactor, mercatorToLonLat, type Extent } from '../lib/geo.js';

/**
 * The coarsest mesh the surface is read from, metres of error: a roof's height to a storey, from a tree of tiles
 * a few score deep over a page rather than the few hundred the streetscape takes over one street at its finest.
 */
export const MESH_SURFACE_ERROR_M = Number(process.env.MESH_HEIGHTS_ERROR_M) || 4;
/** A cell of the surface, metres. */
export const MESH_SURFACE_CELL_M = 1;
/**
 * How long the meshes may take to come and be read, minutes: past it the deck goes on without them (the tiles
 * still in flight finish on their own and are dropped). A page's few score meshes come in well under a minute;
 * this is for a tree of tiles that turns out deeper than the error promised.
 */
export const MESH_SURFACE_MINUTES = Number(process.env.MESH_HEIGHTS_MINUTES) || 6;

export interface MeshSurface { field: HeightField; frame: LocalFrame; meshes: number; errorM: number; credits: string[] }

/** The surface over `extent` (Web Mercator), or null where the tiles hold no meshes there. */
export async function meshSurfaceOver(key: string, extent: Extent, log: (m: string) => void = () => {}): Promise<MeshSurface | null> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the meshes took more than ${MESH_SURFACE_MINUTES} minutes`)), MESH_SURFACE_MINUTES * 60_000); });
  try {
    return await Promise.race([readSurface(key, extent, log), budget]);
  } finally {
    clearTimeout(timer);
  }
}

async function readSurface(key: string, extent: Extent, log: (m: string) => void): Promise<MeshSurface | null> {
  const centre = mercatorToLonLat({ x: (extent.xmin + extent.xmax) / 2, y: (extent.ymin + extent.ymax) / 2 });
  const k = mercatorScaleFactor(centre.lat);
  const halfW = (extent.xmax - extent.xmin) / 2 / k, halfH = (extent.ymax - extent.ymin) / 2 / k;
  // the window as a corridor along east: `d` runs to the axis's left, which is north
  const corridor: Corridor = { at0: [0, 0], axis: [1, 0], s: [-halfW, halfW], d: [-halfH, halfH], z: [-100, 700] };
  const got = await fetchStreetTiles(key, centre, corridor, MESH_SURFACE_ERROR_M, log);
  if (!got.tiles.length) return null;
  const field = await renderSurface(got.tiles, enuFrame(centre).matrix, { x0: -halfW, y0: -halfH, x1: halfW, y1: halfH }, MESH_SURFACE_CELL_M, log);
  const held = field.z.reduce((n, z) => n + (Number.isFinite(z) ? 1 : 0), 0);
  log(`  3D tiles: the surface over ${Math.round(2 * halfW)} × ${Math.round(2 * halfH)} m from ${got.tiles.length} meshes at ${got.finestErrorM.toFixed(1)} m, ${Math.round((100 * held) / field.z.length)} % of it held`);
  return { field, frame: localFrame(centre), meshes: got.tiles.length, errorM: got.finestErrorM, credits: got.credits };
}

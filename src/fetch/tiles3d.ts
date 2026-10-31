// Google's Photorealistic 3D Tiles (the Map Tiles API) over the site's
// street, for the streetscape's orthographic elevations.
//
// The tileset is a tree of boxes in Earth-centred coordinates (ECEF), each
// with the error its own mesh carries; a box is opened only where it meets
// the street's corridor, and refined until its error is under `maxErrorM`,
// so what comes back is the finest mesh over the street and nothing else.
// The tree's nested tilesets and meshes are fetched with the key and the
// session the root hands out (one root request is one billable session; the
// rest of the session's requests are not billed). The meshes stay in memory
// for the one render: Google's terms bar caching them, and the key never
// leaves this process.

import { retryFetch } from '../lib/http.js';
import type { LonLat } from '../lib/geo.js';
import { WGS84_A, WGS84_E2 } from './streetscape.js';

const ROOT = 'https://tile.googleapis.com/v1/3dtiles/root.json';
/** A runaway guard: a street's corridor at half a metre takes a few hundred. */
const MAX_TILES = 1500;
const PARALLEL = 8;

export type V3 = [number, number, number];

export function ecef(lon: number, lat: number, h = 0): V3 {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(p) ** 2);
  return [(N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - WGS84_E2) + h) * Math.sin(p)];
}

/** The east-north-up frame on the ellipsoid at a point, and the 4 × 4 (column-major) that takes ECEF into it. */
export function enuFrame(o: LonLat) {
  const l = (o.lon * Math.PI) / 180, p = (o.lat * Math.PI) / 180;
  const e: V3 = [-Math.sin(l), Math.cos(l), 0];
  const n: V3 = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const u: V3 = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const origin = ecef(o.lon, o.lat, 0);
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const toEnu = (q: V3): V3 => { const r: V3 = [q[0] - origin[0], q[1] - origin[1], q[2] - origin[2]]; return [dot(e, r), dot(n, r), dot(u, r)]; };
  const rotate = (v: V3): V3 => [dot(e, v), dot(n, v), dot(u, v)];
  const t = [-dot(e, origin), -dot(n, origin), -dot(u, origin)];
  const matrix = [e[0], n[0], u[0], 0, e[1], n[1], u[1], 0, e[2], n[2], u[2], 0, t[0], t[1], t[2], 1];
  return { origin, e, n, u, toEnu, rotate, matrix };
}

/**
 * The corridor: a box in the east-north-up frame, square to the street. `axis` is the street's unit direction
 * (east, north), the box runs `s` along it from `at0`, `d` across it to its left, and `z` up (ellipsoidal metres).
 */
export interface Corridor { at0: [number, number]; axis: [number, number]; s: [number, number]; d: [number, number]; z: [number, number] }

const mul4 = (a: number[], b: number[]) => {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const point4 = (m: number[], v: V3): V3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
const dir4 = (m: number[], v: V3): V3 => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];

/**
 * Whether a tile's bounding volume can meet the corridor: the volume's extent along each of the corridor's three
 * axes overlaps the corridor's (the separating-axis test on those three, which never misses a tile and lets in a
 * few that only graze it). Boxes and spheres are tested; a region (lon/lat radians) is let through.
 */
export function meetsCorridor(volume: { box?: number[]; sphere?: number[]; region?: number[] }, transform: number[], frame: ReturnType<typeof enuFrame>, c: Corridor): boolean {
  const ax: V3 = [c.axis[0], c.axis[1], 0], left: V3 = [-c.axis[1], c.axis[0], 0], up: V3 = [0, 0, 1];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let centre: V3, radius: (a: V3) => number;
  if (volume.box) {
    const b = volume.box;
    centre = frame.toEnu(point4(transform, [b[0], b[1], b[2]]));
    const h = [0, 1, 2].map((i) => frame.rotate(dir4(transform, [b[3 + 3 * i], b[4 + 3 * i], b[5 + 3 * i]])));
    radius = (a) => h.reduce((t, v) => t + Math.abs(dot(v, a)), 0);
  } else if (volume.sphere) {
    const s = volume.sphere;
    centre = frame.toEnu(point4(transform, [s[0], s[1], s[2]]));
    radius = () => s[3];
  } else return true;
  const rel: V3 = [centre[0] - c.at0[0], centre[1] - c.at0[1], centre[2]];
  const within = (a: V3, [lo, hi]: [number, number]) => { const m = dot(rel, a), r = radius(a); return m + r >= lo && m - r <= hi; };
  return within(ax, c.s) && within(left, c.d) && within(up, c.z);
}

interface TileJson { boundingVolume: { box?: number[]; sphere?: number[]; region?: number[] }; geometricError: number; refine?: string; transform?: number[]; content?: { uri?: string; url?: string }; children?: TileJson[] }

export interface StreetTile { id: number; bytes: Uint8Array; transform: number[]; geometricError: number }

/** The providers a mesh credits, from its glTF's asset.copyright ("Google;Airbus;…"). */
export function glbCopyright(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || dv.getUint32(0, true) !== 0x46546c67) return [];
  const len = dv.getUint32(12, true);
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
    return String(json?.asset?.copyright ?? '').split(';').map((x) => x.trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * The meshes over the corridor, each the finest whose error is under `maxErrorM`, with the transform from its
 * tileset's frame to ECEF; and the providers they credit, most meshes first. Throws when the key's project does
 * not have the Map Tiles API (Google answers 403 SERVICE_DISABLED), so the caller can fall back.
 */
export async function fetchStreetTiles(key: string, centre: LonLat, c: Corridor, maxErrorM: number, log: (m: string) => void = () => {}): Promise<{ tiles: StreetTile[]; credits: string[]; finestErrorM: number }> {
  const frame = enuFrame(centre);
  let session: string | undefined;
  const sign = (uri: string, base: string) => {
    const u = new URL(uri, base);
    const s = u.searchParams.get('session');
    if (s) session = s;
    else if (session) u.searchParams.set('session', session);
    u.searchParams.set('key', key);
    return u.toString();
  };
  // the key goes in the query, as Google asks; it never reaches a log, an error or a file
  const scrub = (m: string) => m.split(key).join('…');
  const get = async (url: string, label: string) => {
    const res = await retryFetch(url, {}, { attempts: 3, timeoutMs: 60_000, label });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const why = body.match(/"message":\s*"([^"]+)"/)?.[1];
      throw new Error(scrub(`${label} HTTP ${res.status}${why ? `: ${why}` : ''}`));
    }
    return res;
  };

  const glbs: { url: string; transform: number[]; geometricError: number }[] = [];
  let opened = 0;
  const walk = async (t: TileJson, parent: number[], base: string): Promise<void> => {
    const transform = t.transform ? mul4(parent, t.transform) : parent;
    if (!meetsCorridor(t.boundingVolume, transform, frame, c)) return;
    const uri = t.content?.uri ?? t.content?.url;
    if (uri && new URL(uri, base).pathname.endsWith('.json')) {
      // a nested tileset: its root stands in for this tile
      const url = sign(uri, base);
      opened++;
      const sub = (await (await get(url, 'Map Tiles subtree')).json()) as { root: TileJson };
      await walk(sub.root, transform, url);
    } else if (uri && (!t.children?.length || t.geometricError <= maxErrorM)) {
      // fine enough, or as fine as there is: this mesh, and none of the ones that refine it
      glbs.push({ url: sign(uri, base), transform, geometricError: t.geometricError });
      return;
    }
    if (glbs.length > MAX_TILES) throw new Error(`Map Tiles: more than ${MAX_TILES} meshes over the corridor`);
    await Promise.all((t.children ?? []).map((ch) => walk(ch, transform, base)));
  };
  const rootUrl = `${ROOT}?key=${encodeURIComponent(key)}`;
  const root = (await (await get(rootUrl, 'Map Tiles root')).json()) as { root: TileJson };
  await walk(root.root, IDENTITY, rootUrl);
  log(`  3D tiles: ${glbs.length} meshes over the street from ${opened} subtrees, errors ${[...new Set(glbs.map((g) => g.geometricError))].sort((a, b) => a - b).slice(0, 4).map((e) => e.toFixed(2)).join(', ')} m…`);

  const tiles: StreetTile[] = [];
  const count = new Map<string, number>();
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < glbs.length) {
      const i = next++, g = glbs[i];
      const bytes = new Uint8Array(await (await get(g.url, 'Map Tiles mesh')).arrayBuffer());
      for (const who of glbCopyright(bytes)) count.set(who, (count.get(who) ?? 0) + 1);
      tiles.push({ id: i, bytes, transform: g.transform, geometricError: g.geometricError });
    }
  }));
  tiles.sort((a, b) => a.id - b.id);
  const credits = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([who]) => who);
  return { tiles, credits, finestErrorM: Math.min(...glbs.map((g) => g.geometricError)) };
}

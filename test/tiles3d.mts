/* The streetscape's 3D tiles on a made-up tileset, with Google's Map Tiles
 * API stood in for: the east-north-up frame, which boxes meet the street's
 * corridor, the walk down to the meshes fine enough and no finer, the key and
 * the session on every request after the root, the providers each mesh
 * credits, and a project without the API refused with Google's reason and
 * never the key. No network: CI never calls Google.
 *
 *   npx tsx test/tiles3d.mts
 */

import { ecef, enuFrame, meetsCorridor, fetchStreetTiles, glbCopyright, type Corridor } from '../src/fetch/tiles3d.js';
import { settleGround } from '../src/render/elevation3d.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const O = { lon: 151.2155, lat: -33.8752 };
const f = enuFrame(O);
{
  const at = f.toEnu(ecef(O.lon, O.lat, 0));
  check('the origin is the frame\'s origin', Math.hypot(...at) < 1e-6, at.join(','));
  const up = f.toEnu(ecef(O.lon, O.lat, 50));
  check('50 m up the normal is 50 m up', near(up[2], 50, 1e-6) && Math.hypot(up[0], up[1]) < 1e-6, up.join(','));
  // a thousandth of a degree north is 110.9 m at Sydney's latitude, on the ellipsoid
  const n = f.toEnu(ecef(O.lon, O.lat + 0.001, 0));
  check('a thousandth of a degree north is 110.9 m north', near(n[1], 110.92, 0.05) && Math.abs(n[0]) < 1e-3, n.join(','));
  // the column-major matrix does what toEnu does
  const q = ecef(O.lon + 0.0004, O.lat - 0.0003, 30), m = f.matrix;
  const viaM = [0, 1, 2].map((r) => m[r] * q[0] + m[4 + r] * q[1] + m[8 + r] * q[2] + m[12 + r]);
  const viaF = f.toEnu(q);
  check('the matrix and the function agree', viaM.every((v, i) => near(v, viaF[i], 1e-6)), `${viaM} / ${viaF}`);
}

// an ECEF box: centre at an east-north-up point, half-axes along east, north and up
const box = (e: number, n: number, u: number, he: number, hn: number, hu: number): number[] => {
  const c = [0, 1, 2].map((i) => f.origin[i] + f.e[i] * e + f.n[i] * n + f.u[i] * u);
  return [...c, ...f.e.map((x) => x * he), ...f.n.map((x) => x * hn), ...f.u.map((x) => x * hu)];
};
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
// the corridor: a street running north through the origin, 100 m either way, 40 m either side, the ground to 100 m up
const C: Corridor = { at0: [0, 0], axis: [0, 1], s: [-100, 100], d: [-40, 40], z: [-20, 100] };
check('a box on the street meets it', meetsCorridor({ box: box(0, 0, 10, 5, 5, 5) }, IDENT, f, C));
check('a box 60 m east does not', !meetsCorridor({ box: box(60, 0, 10, 5, 5, 5) }, IDENT, f, C));
check('a box 60 m east but 25 m wide reaches in', meetsCorridor({ box: box(60, 0, 10, 25, 5, 5) }, IDENT, f, C));
check('a box past the street\'s end does not', !meetsCorridor({ box: box(0, 130, 10, 5, 5, 5) }, IDENT, f, C));
check('a box far overhead does not', !meetsCorridor({ box: box(0, 0, 400, 5, 5, 5) }, IDENT, f, C));
check('a sphere is tested by its radius', meetsCorridor({ sphere: [...box(0, 120, 0, 0, 0, 0).slice(0, 3), 25] }, IDENT, f, C) && !meetsCorridor({ sphere: [...box(0, 130, 0, 0, 0, 0).slice(0, 3), 25] }, IDENT, f, C));

// a glb's credits
const glb = (copyright: string) => {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0', copyright } }).padEnd(48, ' '));
  const h = Buffer.alloc(20);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + json.length, 8); h.writeUInt32LE(json.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  return new Uint8Array(Buffer.concat([h, json]));
};
check('a glb names its providers', JSON.stringify(glbCopyright(glb('Google;Airbus; Aerometrex'))) === JSON.stringify(['Google', 'Airbus', 'Aerometrex']));
check('anything else names none', glbCopyright(new Uint8Array(8)).length === 0);

// Google stood in for: a root whose one child is a nested tileset, the session in its link as Google gives it; in the
// subtree a coarse mesh over the whole street refined by two finer ones, one on the street and one 300 m east, each
// refined again by meshes finer than asked for
const KEY = 'SECRET_KEY_123';
const asked: URL[] = [];
const tileset = (root: object) => JSON.stringify({ asset: { version: '1.0' }, geometricError: 1e4, root });
const realFetch = globalThis.fetch;
let disabled = false;
globalThis.fetch = (async (input: string | URL | Request) => {
  const u = new URL(String(input instanceof Request ? input.url : input));
  asked.push(u);
  if (disabled) return new Response(JSON.stringify({ error: { code: 403, message: 'Map Tiles API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED' } }), { status: 403 });
  if (u.pathname === '/v1/3dtiles/root.json') return new Response(tileset({ boundingVolume: { box: box(0, 0, 0, 5000, 5000, 1000) }, geometricError: 5000, refine: 'REPLACE', children: [{ boundingVolume: { box: box(0, 0, 0, 2000, 2000, 500) }, geometricError: 1000, content: { uri: '/v1/3dtiles/datasets/X/files/sub.json?session=S1' } }] }));
  if (u.pathname.endsWith('/sub.json')) return new Response(tileset({
    boundingVolume: { box: box(0, 0, 0, 2000, 2000, 500) }, geometricError: 1000,
    children: [{
      boundingVolume: { box: box(0, 0, 10, 400, 400, 60) }, geometricError: 4, content: { uri: 'coarse.glb' },
      children: [
        { boundingVolume: { box: box(0, 0, 10, 30, 120, 60) }, geometricError: 0.5, content: { uri: 'street.glb' }, children: [{ boundingVolume: { box: box(0, 0, 10, 30, 120, 60) }, geometricError: 0.1, content: { uri: 'street-finer.glb' } }] },
        { boundingVolume: { box: box(300, 0, 10, 30, 120, 60) }, geometricError: 0.5, content: { uri: 'east.glb' } },
        // an empty tile under the threshold still opens its children
        { boundingVolume: { box: box(0, 50, 10, 20, 20, 20) }, geometricError: 0.2, children: [{ boundingVolume: { box: box(0, 50, 10, 20, 20, 20) }, geometricError: 0.1, content: { uri: 'inner.glb' } }] },
      ],
    }],
  }));
  if (u.pathname.endsWith('.glb')) return new Response(glb(u.pathname.includes('street') ? 'Google;Airbus' : 'Google'));
  return new Response('nothing here', { status: 404 });
}) as typeof fetch;

try {
  const got = await fetchStreetTiles(KEY, O, C, 0.6);
  const names = asked.filter((u) => u.pathname.endsWith('.glb')).map((u) => u.pathname.split('/').pop()).sort();
  check('the meshes fine enough over the street, no coarser and no finer', JSON.stringify(names) === JSON.stringify(['inner.glb', 'street.glb']), names.join(', '));
  check('a mesh off the corridor is never fetched', !names.includes('east.glb'));
  check('every request carries the key', asked.every((u) => u.searchParams.get('key') === KEY));
  check('every request after the root carries the session', asked.filter((u) => !u.pathname.endsWith('root.json')).every((u) => u.searchParams.get('session') === 'S1'));
  check('relative links resolve against their tileset', asked.some((u) => u.pathname === '/v1/3dtiles/datasets/X/files/street.glb'));
  check('two meshes come back, with their errors', got.tiles.length === 2 && got.finestErrorM === 0.1, `${got.tiles.length} / ${got.finestErrorM}`);
  check('the credits, most meshes first', JSON.stringify(got.credits) === JSON.stringify(['Google', 'Airbus']), got.credits.join(','));

  disabled = true;
  let thrown = '';
  try { await fetchStreetTiles(KEY, O, C, 0.6); } catch (e) { thrown = (e as Error).message; }
  check('a project without the API is refused with Google\'s reason', /HTTP 403: Map Tiles API has not been used/.test(thrown), thrown);
  check('the refusal never carries the key', !thrown.includes(KEY), thrown);
} finally {
  globalThis.fetch = realFetch;
}

// the ground under an elevation: the elevation model lifted by what the rays read where they met the ground, a
// canopy's tops (which only ever lift a ray) left out
{
  const dem = Array.from({ length: 60 }, (_, s) => ({ s, z: 14 - s * 0.02 }));
  const hits = dem.map((g) => ({ s: g.s, z: g.z + 21.9 + (g.s % 5 === 0 ? 9 : 0) + (g.s % 7 === 0 ? 0.05 : 0) }));
  const settled = settleGround(hits, dem);
  check('the meshes\' height over the ground model is read past the canopies', !!settled && near(settled.offsetM, 21.9, 0.06), String(settled?.offsetM));
  check('the line is the ground model, lifted', !!settled && settled.ground.length === 60 && settled.ground.every((g, i) => near(g.z, dem[i].z + settled.offsetM, 1e-9)));
  check('too few rays read nothing', settleGround(hits.slice(0, 5), dem) === null);
}

if (failures.length) {
  console.error(`3d tiles: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('3d tiles: all checks passed');

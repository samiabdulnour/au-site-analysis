/* The heights and footprints read from the 3D meshes' surface, on grids drawn
 * here: a footprint's height from its roof over the ground round it, a tree
 * over the roof left out; the footprints traced on an empty lot, the grid's
 * stair-steps smoothed to wall lines, a shed too small to count, a tree not
 * a building; the buildings with what the meshes add. Then the surface itself,
 * rendered from a made-up mesh (a box on a plane in a glTF built here) by the
 * same page the streetscape's elevations use, in a headless Chromium: no
 * network, no Google. MESH_TEST_NO_BROWSER=1 skips that last part.
 *
 *   npx tsx test/mesh-heights.mts
 */

import { cellsIn, footprintHeight, gapFootprints, occupancy, traceOutlines, simplifyRing, withMeshHeights, localFrame, toXY, toLonLat, type HeightField, type XY } from '../src/lib/meshHeights.js';
import { renderSurface } from '../src/render/elevation3d.js';
import type { BuildingsData } from '../src/fetch/buildings.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A field over [0, w) × [0, h) at a metre, the ground at `ground`, drawn on by `paint`. */
const field = (w: number, h: number, ground: number, paint: (x: number, y: number) => { z?: number; green?: boolean } | undefined): HeightField => {
  const z = new Float32Array(w * h).fill(ground), green = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const p = paint(c, r); if (p?.z !== undefined) z[r * w + c] = p.z; if (p?.green) green[r * w + c] = 1; }
  return { x0: 0, y0: 0, cell: 1, cols: w, rows: h, z, green };
};
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const within = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const ringArea = (r: XY[]) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };

// ---- a footprint's height: the roof's 80th percentile over the ground's 15th round it
{
  // a block 12 × 8 m, 9 m high, on ground at 10 m; a tree 6 m over its corner; the street at 9.5 m along the south
  const f = field(60, 60, 10, (x, y) => within(x, y, 20, 20, 31, 27) ? { z: within(x, y, 20, 20, 23, 23) ? 25 : 19 } : y < 12 ? { z: 9.5 } : within(x, y, 40, 40, 45, 45) ? { z: 16, green: true } : undefined);
  const h = footprintHeight(f, [rect(19.5, 19.5, 31.5, 27.5)]);
  check('a block reads 9 m over its ground', h !== null && near(h.heightM, 9, 0.5), `${h?.heightM}`);
  check('its ground is the yards round it, not the tree', h !== null && near(h.groundZ, 10, 0.3), `${h?.groundZ}`);
  // the tree over the corner is green in the picture: the roof is read where it is not
  const g = field(60, 60, 10, (x, y) => within(x, y, 20, 20, 31, 27) ? (within(x, y, 20, 20, 25, 25) ? { z: 25, green: true } : { z: 19 }) : undefined);
  const hg = footprintHeight(g, [rect(19.5, 19.5, 31.5, 27.5)]);
  check('a tree over the roof is left out of the roof', hg !== null && near(hg.heightM, 9, 0.5), `${hg?.heightM}`);
  // the neighbour's roof does not pull the ground up: its cells are occupied
  const n = field(60, 60, 10, (x, y) => within(x, y, 20, 20, 31, 27) ? { z: 19 } : within(x, y, 32, 20, 50, 27) ? { z: 30 } : undefined);
  const occ = occupancy(n, [[rect(31.5, 19.5, 50.5, 27.5)]]);
  const hn = footprintHeight(n, [rect(19.5, 19.5, 31.5, 27.5)], occ);
  check("the neighbour's roof is no ground", hn !== null && near(hn.groundZ, 10, 0.3), `${hn?.groundZ}`);
  // a slab stands for nothing
  const s = field(30, 30, 10, (x, y) => within(x, y, 10, 10, 20, 20) ? { z: 11 } : undefined);
  check('a slab is no building', footprintHeight(s, [rect(9.5, 9.5, 20.5, 20.5)]) === null);
  // a footprint the meshes do not reach
  const e = field(30, 30, NaN, () => undefined);
  check('no meshes, no height', footprintHeight(e, [rect(9.5, 9.5, 20.5, 20.5)]) === null);
  check('cellsIn counts the cells inside', cellsIn(f, [rect(19.5, 19.5, 31.5, 27.5)]).length === 12 * 8, String(cellsIn(f, [rect(19.5, 19.5, 31.5, 27.5)]).length));
}

// ---- tracing: the cells' edges with the cells on the left, outer loops counter-clockwise, holes clockwise
{
  const f = field(20, 20, 0, () => undefined);
  const cell = (c: number, r: number) => r * 20 + c;
  // a 3 × 2 block
  const loops = traceOutlines(f, [cell(5, 5), cell(6, 5), cell(7, 5), cell(5, 6), cell(6, 6), cell(7, 6)]);
  check('a block traces to one loop', loops.length === 1, String(loops.length));
  check('the loop runs counter-clockwise round 6 m²', loops[0] && near(ringArea(loops[0]), 6, 1e-9), `${loops[0] && ringArea(loops[0])}`);
  check('the loop closes', loops[0] && loops[0][0][0] === loops[0][loops[0].length - 1][0] && loops[0][0][1] === loops[0][loops[0].length - 1][1]);
  const simple = simplifyRing(loops[0], 0.9);
  check('a rectangle keeps its four corners', simple.length === 5, String(simple.length));
  // a ring of cells: an outer loop and a hole
  const ring: number[] = [];
  for (let r = 2; r <= 6; r++) for (let c = 2; c <= 6; c++) if (r === 2 || r === 6 || c === 2 || c === 6) ring.push(cell(c, r));
  const rl = traceOutlines(f, ring);
  check('a ring traces to two loops', rl.length === 2, String(rl.length));
  check('one outer, one hole', rl.some((l) => ringArea(l) > 0) && rl.some((l) => ringArea(l) < 0), rl.map((l) => ringArea(l)).join(','));
  check('the hole is 9 m²', rl.some((l) => near(ringArea(l), -9, 1e-9)), rl.map((l) => ringArea(l)).join(','));
  // a stair-step along a slanted wall smooths to the wall line
  const slant: number[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (c <= r) slant.push(cell(c, r));
  const sl = simplifyRing(traceOutlines(f, slant)[0], 0.9);
  check('a staircase smooths to a triangle', sl.length <= 5, String(sl.length));
}

// ---- an empty lot: what rises three metres and is not green is built, each patch of a shed's size or more a footprint
{
  // ground 20 m; a house 10 × 6 at 29 m; a tree 4 × 4 at 32 m, green; a tank 2 × 2 at 24 m
  const f = field(60, 60, 20, (x, y) => within(x, y, 10, 10, 19, 15) ? { z: 29 } : within(x, y, 25, 25, 28, 28) ? { z: 32, green: true } : within(x, y, 30, 10, 31, 11) ? { z: 24 } : undefined);
  const lot = [rect(4.5, 4.5, 35.5, 35.5)];
  const out = gapFootprints(f, lot);
  check('one footprint on the lot', out.length === 1, String(out.length));
  check('it is the house, 60 m²', out[0] && near(out[0].areaSqm, 60, 2), `${out[0]?.areaSqm}`);
  check('its height is 9 m', out[0] && near(out[0].heightM, 9, 0.5), `${out[0]?.heightM}`);
  check('its outline has four corners', out[0] && out[0].rings[0].length === 5, `${out[0]?.rings[0].length}`);
  // a lot with a tree alone
  const t = field(40, 40, 20, (x, y) => within(x, y, 10, 10, 19, 19) ? { z: 30, green: true } : undefined);
  check('a tree is no building', gapFootprints(t, [rect(4.5, 4.5, 25.5, 25.5)]).length === 0);
  // a lot the meshes do not reach
  const e = field(40, 40, NaN, () => undefined);
  check('no meshes, no footprint', gapFootprints(e, [rect(4.5, 4.5, 25.5, 25.5)]).length === 0);
}

// ---- the buildings with what the meshes add
{
  const frame = localFrame({ lon: 151.26, lat: -33.89 });
  const ll = (x: number, y: number) => toLonLat(frame, x, y);
  const round = ([a, b]: XY) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6];
  check('the frame goes there and back', round(toXY(frame, ...ll(123.4, -56.7))).join() === '123.4,-56.7', round(toXY(frame, ...ll(123.4, -56.7))).join());
  check('a degree north is 110.9 km at Sydney', near(frame.mPerDegN, 110_920, 60), String(frame.mPerDegN));
  const f = field(80, 80, 10, (x, y) => within(x, y, 20, 20, 31, 27) ? { z: 19 } : within(x, y, 50, 50, 59, 55) ? { z: 25 } : undefined);
  const ringLL = (r: XY[]) => r.map(([x, y]) => ll(x, y));
  const data: BuildingsData = {
    source: 'overture', buildings: [
      { id: 'a', source: 'overture', rings: [ringLL(rect(19.5, 19.5, 31.5, 27.5))], heightFrom: 'none', centroid: ll(25, 23) },
      { id: 'b', source: 'overture', rings: [ringLL(rect(0.5, 0.5, 5.5, 5.5))], heightM: 12, estimatedHeightM: 12, heightFrom: 'measured', centroid: ll(3, 3) },
      { id: 'c', source: 'osm', rings: [ringLL(rect(70.5, 70.5, 75.5, 75.5))], floors: 2, estimatedHeightM: 6.2, heightFrom: 'floors', centroid: ll(73, 73) },
    ], fetchedAt: '2026-11-06T00:00:00Z',
  };
  const out = withMeshHeights(data, f, frame, [[ringLL(rect(44.5, 44.5, 65.5, 65.5))]], { meshes: 3, errorM: 4, credits: ['Google', 'Airbus'] });
  const a = out.buildings.find((b) => b.id === 'a')!;
  check('a footprint with no height takes the meshes\'', a.heightFrom === 'mesh' && near(a.estimatedHeightM ?? 0, 9, 0.5), `${a.heightFrom} ${a.estimatedHeightM}`);
  check('a measured height stands', out.buildings.find((b) => b.id === 'b')!.heightFrom === 'measured');
  check('a storey count stands', out.buildings.find((b) => b.id === 'c')!.heightFrom === 'floors');
  const traced = out.buildings.filter((b) => b.source === 'mesh');
  check('the empty lot gets its footprint', traced.length === 1, String(traced.length));
  check('traced at the meshes\' height', traced[0] && traced[0].heightFrom === 'mesh' && near(traced[0].estimatedHeightM ?? 0, 15, 0.5), `${traced[0]?.estimatedHeightM}`);
  check('the traced footprint is where the block is', traced[0] && near(toXY(frame, ...traced[0].centroid)[0], 55, 1) && near(toXY(frame, ...traced[0].centroid)[1], 52.5, 1), traced[0] && toXY(frame, ...traced[0].centroid).join());
  check('the data says what the meshes added', out.mesh?.heights === 1 && out.mesh?.footprints === 1 && out.mesh?.credits.includes('Airbus'), JSON.stringify(out.mesh));
  check('nothing to add, nothing changed', withMeshHeights({ ...data, buildings: [data.buildings[1]] }, f, frame, [], { meshes: 1, errorM: 4, credits: [] }) === ({ ...data, buildings: [data.buildings[1]] }) === false && withMeshHeights(data, f, frame, [], { meshes: 1, errorM: 4, credits: [] }).mesh?.footprints === 0);
}

// ---- the surface itself, from a mesh built here: a 10 × 8 m box 9 m high on a plane at 0, in a glTF of its own
async function surfaceTest() {
  if (process.env.MESH_TEST_NO_BROWSER === '1') return;
  // glTF is y-up and the page turns it z-up (x, y, z → x, −z, y): east is x, up is y, north is −z
  const v = (e: number, n: number, u: number) => [e, u, -n];
  const positions: number[] = [], indices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { const i = positions.length / 3; positions.push(...a, ...b, ...c, ...d); indices.push(i, i + 1, i + 2, i, i + 2, i + 3); };
  quad(v(-50, -50, 0), v(50, -50, 0), v(50, 50, 0), v(-50, 50, 0));
  const [e0, e1, n0, n1, u] = [10, 20, 10, 18, 9];
  quad(v(e0, n0, u), v(e1, n0, u), v(e1, n1, u), v(e0, n1, u));                     // the roof
  quad(v(e0, n0, 0), v(e1, n0, 0), v(e1, n0, u), v(e0, n0, u));                     // the walls
  quad(v(e1, n0, 0), v(e1, n1, 0), v(e1, n1, u), v(e1, n0, u));
  quad(v(e1, n1, 0), v(e0, n1, 0), v(e0, n1, u), v(e1, n1, u));
  quad(v(e0, n1, 0), v(e0, n0, 0), v(e0, n0, u), v(e0, n1, u));
  const pos = new Float32Array(positions), idx = new Uint16Array(indices);
  const pad4 = (n: number) => (n + 3) & ~3;
  const bin = Buffer.alloc(pad4(pos.byteLength) + pad4(idx.byteLength));
  Buffer.from(pos.buffer).copy(bin, 0); Buffer.from(idx.buffer).copy(bin, pad4(pos.byteLength));
  const min = [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k))), max = [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k)));
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0', copyright: 'a test' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pad4(pos.byteLength), byteLength: idx.byteLength }],
    buffers: [{ byteLength: bin.length }],
  }).padEnd(pad4(JSON.stringify({}).length) , ' '));
  const jsonPadded = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
  const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  const glb = Buffer.concat([header, ch(jsonPadded.length, 0x4e4f534a), jsonPadded, ch(bin.length, 0x004e4942), bin]);
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const tiles = [{ id: 0, bytes: new Uint8Array(glb), transform: IDENTITY, geometricError: 1 }];
  const f = await renderSurface(tiles, IDENTITY, { x0: -30, y0: -30, x1: 30, y1: 30 }, 1);
  check('the surface is 60 × 60 cells', f.cols === 60 && f.rows === 60, `${f.cols}×${f.rows}`);
  const at = (x: number, y: number) => f.z[Math.round(y - f.y0) * f.cols + Math.round(x - f.x0)];
  check('the plane reads 0', near(at(-20.5, -20.5), 0, 0.05), String(at(-20.5, -20.5)));
  check('the roof reads 9', near(at(14.5, 13.5), 9, 0.05), String(at(14.5, 13.5)));
  check('beside the box the plane reads 0', near(at(24.5, 13.5), 0, 0.05), String(at(24.5, 13.5)));
  check('the rows run from the south', near(at(14.5, 10.5), 9, 0.05) && near(at(14.5, 7.5), 0, 0.05), `${at(14.5, 10.5)} ${at(14.5, 7.5)}`);
  const h = footprintHeight(f, [rect(9.5, 9.5, 20.5, 18.5)]);
  check('the box is a 9 m building', h !== null && near(h.heightM, 9, 0.1), `${h?.heightM}`);
  const g = gapFootprints(f, [rect(0.5, 0.5, 29.5, 29.5)]);
  check('traced on the lot: the box, 80 m², 9 m', g.length === 1 && near(g[0].areaSqm, 80, 2) && near(g[0].heightM, 9, 0.1), JSON.stringify(g.map((q) => [q.areaSqm, q.heightM])));
}

surfaceTest().catch((e) => failures.push(`the surface from a mesh: ${e?.message ?? e}`)).finally(() => {
  if (failures.length) { console.error(`mesh heights: ${failures.length} failure(s)\n${failures.map((f) => ` - ${f}`).join('\n')}`); process.exit(1); }
  console.log('mesh heights: all checks passed');
});

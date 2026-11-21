/* A second look at the heights the sources give (src/lib/heightCheck.ts), on grids and footprints drawn for it:
 * a house whose street number was typed into its height (OpenStreetMap way 1436151685, 62 Boyce Road, Maroubra:
 * `height=62`, drawn as a 62 m tower 149 m from the site) gives way to what the 3D meshes read on its footprint;
 * with no meshes read, its own footprint and the height limit over it set it aside; a tree the meshes took for a
 * roof is not a building; and what is believable stands. Nothing here asks a network.
 *
 *   npx tsx test/height-check.mts
 */

import { grosslyApart, implausibleHeight, implausibleMeshHeight, footprintSidesM, checkHeights, doubtedHeights } from '../src/lib/heightCheck.js';
import { withMeshHeights, localFrame, toLonLat, type HeightField } from '../src/lib/meshHeights.js';
import type { Building, BuildingsData } from '../src/fetch/buildings.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// A frame of metres round a Maroubra point, and footprints drawn in it.
const frame = localFrame({ lon: 151.2345, lat: -33.9392 });
const rect = (x: number, y: number, w: number, h: number): number[][][] => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(([px, py]) => toLonLat(frame, px, py))];
const mid = (r: number[][][]): [number, number] => [(r[0][0][0] + r[0][2][0]) / 2, (r[0][0][1] + r[0][2][1]) / 2];
const bld = (id: string, rings: number[][][], h: Partial<Building> = {}): Building => {
  const heightFrom = h.heightFrom ?? (h.heightM ? 'measured' : h.floors ? 'floors' : 'none');
  return { id, source: 'overture', rings, centroid: mid(rings), heightFrom, estimatedHeightM: h.heightM ?? (h.floors ? h.floors * 3.1 : undefined), ...h } as Building;
};
const data = (buildings: Building[]): BuildingsData => ({ source: 'overture', buildings, fetchedAt: '2026-11-20T00:00:00Z' });

// ---- the arithmetic
check('62 m against 5.6 m is grossly apart', grosslyApart(62, 5.6));
check('3 m against 30 m is grossly apart, the other way', grosslyApart(3, 30.3));
check('a pitched roof read 2 m over its storeys is not', !grosslyApart(6.2, 8.1) && !grosslyApart(9.3, 12));
check('a tower read 8 m out in 60 is not', !grosslyApart(62, 54));
check('a house and a half is not (under 8 m apart)', !grosslyApart(3.1, 9));
const sides = footprintSidesM(rect(0, 0, 10, 17)[0]);
check('a footprint of 10 × 17 m is measured so, whichever way it lies', Math.abs(sides[0] - 10) < 0.2 && Math.abs(sides[1] - 17) < 0.2, sides.join(' × '));
const turned = footprintSidesM([[0, 0], [8.66, 5], [0.16, 19.72], [-8.5, 14.72], [0, 0]].map(([x, y]) => toLonLat(frame, x, y)));
check('turned 30°, the same', Math.abs(turned[0] - 10) < 0.3 && Math.abs(turned[1] - 17) < 0.3, turned.join(' × '));
check('62 m on 10 × 17 m under a 9.5 m limit is not believed', implausibleHeight(62, [10, 17], 9.5) !== null);
check('nor with no limit mapped at all? it is six times its width, short of eight: it stands', implausibleHeight(62, [10, 17]) === null);
check('90 m on 10 × 17 m with no limit is past belief', implausibleHeight(90, [10, 17]) !== null);
check('a pencil tower under a limit that allows it stands', implausibleHeight(62, [10, 17], 60) === null);
check('a slab of 62 m on 25 × 40 m stands, whatever the limit', implausibleHeight(62, [25, 40], 9.5) === null);
check('an eight-storey block on a narrow lot is not questioned', implausibleHeight(24.8, [4, 30], 9.5) === null);
check('a tree read as 21 m on 11 × 13 m in a park is no building', implausibleMeshHeight(21.2, [11, 13]) !== null);
check('15 m on 9 × 11 m under a 9.5 m limit is a tree', implausibleMeshHeight(15.3, [9, 11], 9.5) !== null);
check('17 m on 8 × 11 m under a 16.6 m limit is a building', implausibleMeshHeight(16.9, [8, 11], 16.6) === null);
check('a mesh height on a broad footprint stands', implausibleMeshHeight(30.3, [35, 62], 9.5) === null);
check('a mesh height of a house stands', implausibleMeshHeight(8.4, [4, 12], 9.5) === null);

// ---- with no meshes: the footprint and the plan
{
  const house = bld('way/1436151685', rect(0, 0, 10, 17), { heightM: 62 });
  const tower = bld('tower', rect(100, 0, 26, 40), { heightM: 62 });
  const flats = bld('flats', rect(200, 0, 12, 30), { floors: 9 });
  const plain = bld('plain', rect(300, 0, 9, 14));
  const limitAt = (lon: number) => (lon < toLonLat(frame, 150, 0)[0] ? 9.5 : 60);
  const out = checkHeights(data([house, tower, flats, plain]), { limitAt });
  const by = (id: string) => out.buildings.find((b) => b.id === id)!;
  check('the house keeps its footprint and loses its 62 m', by('way/1436151685').estimatedHeightM === undefined && by('way/1436151685').heightFrom === 'none' && by('way/1436151685').heightM === undefined);
  check('and says what it was told, and why', by('way/1436151685').doubted?.heightM === 62 && by('way/1436151685').doubted?.from === 'measured' && /62 m on a footprint of 10 × 17 m, under a height limit of 9.5 m/.test(by('way/1436151685').doubted?.why ?? ''), JSON.stringify(by('way/1436151685').doubted));
  check('the tower on its broad footprint stands', by('tower').estimatedHeightM === 62 && !by('tower').doubted);
  check('nine storeys of flats stand', Math.abs((by('flats').estimatedHeightM ?? 0) - 27.9) < 0.01 && by('flats').floors === 9);
  check('a footprint with no height is left as it was', by('plain') === plain);
  check('the note and the list say one height was set aside', /1 height set aside/.test(out.note ?? '') && doubtedHeights(out).length === 1 && doubtedHeights(out)[0].id === 'way/1436151685', out.note);
  check('nothing to doubt returns the data as it came', checkHeights(data([tower, flats, plain]), { limitAt }) !== out && checkHeights(data([tower, flats, plain]), { limitAt }).buildings[0] === tower);
}

// ---- with the meshes: a surface with a 5.6 m house where the source says 62 m, a 30 m block where it says 3 m,
// a 7.5 m house the source has at two storeys, a bare lot with a tree the picture does not show green, and one with a shed
{
  const cell = 1, cols = 420, rows = 120;
  const z = new Float32Array(cols * rows).fill(20), green = new Uint8Array(cols * rows);
  const raise = (x: number, y: number, w: number, h: number, top: number) => { for (let r = Math.round(y + 40); r < Math.round(y + 40 + h); r++) for (let c = Math.round(x + 40); c < Math.round(x + 40 + w); c++) z[r * cols + c] = 20 + top; };
  const field: HeightField = { x0: -40, y0: -40, cell, cols, rows, z, green };
  raise(0, 0, 10, 17, 5.6); raise(60, 0, 35, 60, 30.3); raise(130, 0, 9, 14, 7.5); raise(200, 5, 9, 9, 21); raise(260, 5, 8, 8, 4.2);
  const house = bld('house', rect(0, 0, 10, 17), { heightM: 62 });
  const block = bld('block', rect(60, 0, 35, 60), { heightM: 3 });
  const semi = bld('semi', rect(130, 0, 9, 14), { floors: 2 });
  const bare = bld('bare', rect(320, 0, 9, 14));
  const lotTree = rect(190, 0, 30, 20), lotShed = rect(250, 0, 30, 20);
  const read = withMeshHeights(data([house, block, semi, bare]), field, frame, [lotTree, lotShed], { meshes: 9, errorM: 2, credits: ['Google'] });
  const by = (id: string) => read.buildings.find((b) => b.id === id)!;
  check('the meshes replace the 62 m with what stands: 5.6 m', by('house').heightFrom === 'mesh' && Math.abs((by('house').estimatedHeightM ?? 0) - 5.6) < 0.3, `${by('house').heightFrom} ${by('house').estimatedHeightM}`);
  check('and the house says what its source claimed', by('house').doubted?.heightM === 62 && /3D meshes read 5\.6 m/.test(by('house').doubted?.why ?? ''), JSON.stringify(by('house').doubted));
  check('a block the source has at 3 m takes the meshes\' 30 m', by('block').heightFrom === 'mesh' && Math.abs((by('block').estimatedHeightM ?? 0) - 30.3) < 0.4 && by('block').doubted?.heightM === 3);
  check('a house the meshes bear out keeps its source\'s storeys, with the meshes\' reading beside them', by('semi').heightFrom === 'floors' && by('semi').floors === 2 && Math.abs((by('semi').meshM ?? 0) - 7.5) < 0.3 && !by('semi').doubted, `${by('semi').heightFrom} ${by('semi').meshM}`);
  check('the count of checked and replaced is kept', read.mesh?.checked === 3 && read.mesh?.corrected === 2, JSON.stringify(read.mesh));
  const traced = read.buildings.filter((b) => b.source === 'mesh');
  check('both lots are traced: a 21 m pole of a tree and a shed', traced.length === 2 && traced.some((b) => (b.estimatedHeightM ?? 0) > 20) && traced.some((b) => Math.abs((b.estimatedHeightM ?? 0) - 4.2) < 0.3), traced.map((b) => b.estimatedHeightM).join(' '));
  const checked = checkHeights(read, { limitAt: () => undefined });
  const left = checked.buildings.filter((b) => b.source === 'mesh');
  check('the tree is not drawn as a building; the shed is', left.length === 1 && Math.abs((left[0].estimatedHeightM ?? 0) - 4.2) < 0.3, left.map((b) => b.estimatedHeightM).join(' '));
  check('and the count of traced footprints follows', checked.mesh?.footprints === 1 && /1 traced footprint left out/.test(checked.note ?? ''), `${checked.mesh?.footprints} ${checked.note}`);
  check('what the meshes corrected is not questioned a second time', checked.buildings.find((b) => b.id === 'block')!.estimatedHeightM === by('block').estimatedHeightM && checked.buildings.find((b) => b.id === 'house')!.doubted?.heightM === 62);
  check('a source\'s height the meshes bore out is not put to the footprint test', checked.buildings.find((b) => b.id === 'semi')!.floors === 2);
}

if (failures.length) { console.error(`height check: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('height check: all checks pass');

/* Crowns peeled off a canopy mask, and streets swept out to their kerbs.
 *
 * Geometry only, nothing fetched. Two round canopies of known size on a blank
 * mask come out as two crowns at their centres, the wider first, with their
 * radii; a lawn (green but flat) gives no tree; a street between two kerb
 * lines is swept to them, and a street with no kerb near it to its class's
 * typical width.
 *
 *   npx tsx test/crowns.mts
 */

import { crownsFromMask, distanceTransform, treesFromAerial } from '../src/lib/crowns.js';
import { carriageways, kerbHalfWidths, typicalHalfWidthM } from '../src/lib/carriageway.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// A 120 × 80 mask with two discs: radius 12 at (30, 40), radius 7 at (85, 40).
const W = 120, H = 80;
const mask = new Uint8Array(W * H);
const paint = (cx: number, cy: number, r: number) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) <= r) mask[y * W + x] = 1; };
paint(30, 40, 12); paint(85, 40, 7);

const dt = distanceTransform(mask, W, H);
check('the distance transform peaks at a disc\'s centre', Math.abs(dt[40 * W + 30] - 12) <= 1.05, `${dt[40 * W + 30].toFixed(2)} for a radius of 12`);
check('the distance transform is zero off the mask', dt[5 * W + 5] === 0);

const crowns = crownsFromMask(mask, W, H, { minR: 2, maxR: 20 });
check('two discs give two crowns', crowns.length === 2, `${crowns.length}`);
check('the wider crown comes first', crowns[0]?.r > crowns[1]?.r, crowns.map((c) => c.r.toFixed(1)).join(', '));
check('the first crown stands at the wide disc\'s centre', Math.hypot(crowns[0].x - 30, crowns[0].y - 40) <= 1.5, `${crowns[0].x},${crowns[0].y}`);
check('the second at the narrow disc\'s', Math.hypot(crowns[1].x - 85, crowns[1].y - 40) <= 1.5, `${crowns[1].x},${crowns[1].y}`);
check('the radii are the discs\'', Math.abs(crowns[0].r - 12) <= 1.05 && Math.abs(crowns[1].r - 7) <= 1.05, crowns.map((c) => c.r.toFixed(1)).join(', '));

// A capped crown: a wide disc with maxR 5 gives a crowd of crowns no wider than 5, covering it.
const crowd = crownsFromMask(mask, W, H, { minR: 2, maxR: 5 });
check('a cap holds every crown', crowd.every((c) => c.r <= 5), `${Math.max(...crowd.map((c) => c.r)).toFixed(1)}`);
check('a wide canopy becomes a crowd', crowd.length >= 6, `${crowd.length}`);

// Trees from pixels: the mask over a 60 × 40 m extent at 0.5 m a pixel; the wide disc has a canopy's contrast, the
// narrow one is flat (a lawn), so only the first is a tree.
const contrast = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) contrast[i] = Math.hypot((i % W) - 30, Math.floor(i / W) - 40) <= 14 ? 40 : 2;
const extent = { xmin: 16810000, ymin: -4004040, xmax: 16810060, ymax: -4004000 };
const trees = treesFromAerial({ width: W, height: H, extent, mPerPx: 0.5, green: mask, contrast }, [], { minCanopyM: 2, maxCanopyM: 30 });
check('a canopy with light and shade is a tree, a flat lawn is not', trees.length === 1, `${trees.length}`);
check('the tree\'s crown is the disc\'s width in metres', trees[0] && Math.abs(trees[0].canopyM - 12) <= 1.2, `${trees[0]?.canopyM}`);
check('the crown is read off the photograph', trees[0]?.source === 'aerial');
// A recorded tree at the canopy's centre is kept, and the crown read there is not drawn twice.
const known = [{ lon: trees[0].lon, lat: trees[0].lat, canopyM: 9, source: 'osm' }];
const merged = treesFromAerial({ width: W, height: H, extent, mPerPx: 0.5, green: mask, contrast }, known, { minCanopyM: 2, maxCanopyM: 30 });
check('a recorded tree stands in for the crown read at it', merged.length === 1 && merged[0].source === 'osm', merged.map((t) => t.source).join(', '));

// Streets. One east–west street with kerbs 6 m either side of it; one north–south street with no kerb near it.
const ew = { coords: [{ x: -60, y: 0 }, { x: 60, y: 0 }], hierarchy: 5 };
const ns = { coords: [{ x: 0, y: -60 }, { x: 0, y: 60 }], hierarchy: 6 };
const kerbs = [[{ x: -60, y: 6 }, { x: 60, y: 6 }], [{ x: -60, y: -6 }, { x: 60, y: -6 }]];
const hw = kerbHalfWidths(ew, kerbs);
check('a street is swept to its kerbs', hw.measured && Math.abs(hw.left - 6) < 0.01 && Math.abs(hw.right - 6) < 0.01, `${hw.left} / ${hw.right}`);
const hw2 = kerbHalfWidths(ns, kerbs);
check('a street with no kerb near takes its class\'s width', !hw2.measured && hw2.left === typicalHalfWidthM(6), `${hw2.left}`);
const cw = carriageways([ew, ns, { coords: [{ x: 0, y: 0 }, { x: 30, y: 30 }], hierarchy: 9 }], kerbs);
check('two crossing streets join into one surface', cw.polygons.length === 1, `${cw.polygons.length}`);
check('a path has no carriageway', cw.axes.length === 2, `${cw.axes.length}`);
const inside = (p: { x: number; y: number }, rg: { x: number; y: number }[]) => { let c = false; for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if ((rg[i].y > p.y) !== (rg[j].y > p.y) && p.x < ((rg[j].x - rg[i].x) * (p.y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c; return c; };
check('the surface reaches the kerb and not the footpath', inside({ x: 30, y: 5.5 }, cw.polygons[0][0]) && !inside({ x: 30, y: 6.5 }, cw.polygons[0][0]));
check('the crossing street is its typical width', inside({ x: 4, y: 30 }, cw.polygons[0][0]) && !inside({ x: 5, y: 30 }, cw.polygons[0][0]));

if (failures.length) { console.error(`crowns: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('crowns: the canopy peels into crowns, a lawn is no tree, the streets sweep to their kerbs');

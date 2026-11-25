/* The envelope reshaped to comply (lib/reshape.ts), on made-up lots.
 *
 * On an open lot the office's feasible footprints are laid out within the
 * setbacks, the ADG's separation apart, to the height and the ratio, and the
 * layout chosen meets ADG 4A-1 and 4A-2; a single-loaded building's gallery
 * and a double-loaded building's back hold no apartments; a lot too small for
 * a footprint gets none. Nothing here asks a network.
 *
 *   npx tsx test/reshape.mts
 */

import { reshapeToComply } from '../src/lib/reshape.js';
import { computeBuildings, computeYield, type XY } from '../src/lib/yield.js';
import { apartmentSun, type Block } from '../src/lib/solarAccess.js';
import { ringsDistance } from '../src/lib/separation.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const segDist = (p: XY, a: XY, b: XY) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const LAT = -33.77, LON = 151.16;

// ---- an open lot: 70 m along its street (the south edge), 60 m deep; 18.5 m and 1.3:1, as Killara's R4 ----

const site = rect(0, 0, 70, 60), fronts = [true, false, false, false], A = 70 * 60;
const r = reshapeToComply({ ring: site, fronts, siteAreaSqm: A, zone: 'R4', hobM: 18.5, fsr: 1.3, lat: LAT, lon: LON, context: [], hoursRequired: 2 });
check('open lot: a scheme', !!r);
if (r) {
  check('open lot: it meets ADG 4A-1 and 4A-2', r.complies && r.sun.meeting >= 0.7 * r.sun.total && r.sun.none <= 0.15 * r.sun.total, JSON.stringify(r.sun && { m: r.sun.meeting, n: r.sun.none, t: r.sun.total }));
  check('open lot: to the height and within the ratio', r.y.heightM <= 18.5 + 1e-6 && r.y.gfa <= 1.3 * A + 1, `${r.y.heightM} m, ${Math.round(r.y.gfa)} m²`);
  check('open lot: the office\'s footprints, 15 to 45 m long, 12, 18 or 22 m deep, a double-loaded one as long as it is deep', r.buildings.every((b) => b.lengthM >= 15 - 1e-6 && b.lengthM <= 45 + 1e-6 && [12, 18, 22].includes(b.depthM) && (b.type === 'single' || b.lengthM >= b.depthM - 1e-6)),
    JSON.stringify(r.buildings.map((b) => [b.type, b.lengthM, b.depthM])));
  // each building 6 m from the street, the ADG's half separation for its storeys from the side and rear boundaries
  const half = (n: number) => (n <= 4 ? 6 : n <= 8 ? 9 : 12);
  const kept = r.buildings.every((b) => b.ring.every((p) => site.every((a, e) => segDist(p, a, site[(e + 1) % 4]) >= (fronts[e] ? 6 : half(b.storeys)) - 1e-6)));
  check('open lot: every building keeps its setbacks', kept);
  // and the buildings the ADG's full separation apart, for the taller of each two
  const apart = r.buildings.every((b, i) => r.buildings.every((c, j) => j <= i || ringsDistance([b.ring], [c.ring]).d >= 2 * half(Math.max(b.storeys, c.storeys)) - 1e-6));
  check('open lot: the buildings the ADG\'s separation apart', apart);
  check('open lot: it says how the buildings stand', /row/.test(r.layout) && r.tried >= 1 && r.candidates >= r.tried, r.layout);
  // the envelope, filled, holds more: the sun is what the reshaping pays for
  const env = computeYield({ ring: site, fronts, siteAreaSqm: A, zone: 'R4', hobM: 18.5, fsr: 1.3 });
  check('open lot: no more floor area than the envelope', r.y.gfa <= env.gfa + 1, `${Math.round(r.y.gfa)} vs ${Math.round(env.gfa)}`);
}

// ---- a gallery holds no apartments: a single-loaded building east–west, its south face windowless ----

const bar = rect(10, 20, 50, 32);
const y = computeBuildings({ ring: site, fronts, siteAreaSqm: A, zone: 'R4', hobM: 18.5, fsr: 1.3,
  buildings: [{ ring: bar, storeys: 5, windowless: [true, false, false, false], name: 'Building A', front: 6, side: 9, rear: 9 }] });
check('buildings: one tier a building, from the ground to its storeys', y.tiers.length === 1 && y.tiers[0].from === 1 && y.tiers[0].to === 5 && y.storeys === 5 && y.floors.every((f) => f.tier === 0), JSON.stringify(y.tiers.map((t) => [t.from, t.to])));
const sun = apartmentSun(y, { boundary: site, blank: [false, true, true, true], lat: LAT, lon: LON, context: [], hoursRequired: 2 })!;
check('buildings: no apartment on the gallery (the south face, edge 0)', sun.units.every((u) => u.pieces.every((pc) => pc.edge !== 0)), JSON.stringify(sun.units.slice(0, 3).map((u) => u.pieces)));
check('buildings: facing north and open, every apartment has its sun', sun.meeting === sun.total && sun.none === 0, `${sun.meeting}/${sun.total}`);

// ---- read less often, the hours still count in their share of an hour ----

const half = apartmentSun(y, { boundary: site, blank: [false, true, true, true], lat: LAT, lon: LON, context: [], hoursRequired: 2, perHour: 2, stepM: 1.5 })!;
check('screening: read every half hour, the hours come in halves', half.units.every((u) => Math.abs(u.hours * 2 - Math.round(u.hours * 2)) < 1e-9) && half.total === sun.total);

// ---- shaded by a tall neighbour to the north, the north-facing layouts fail, and the search says the nearest it found ----

const wall: Block = { rings: [rect(-30, 62, 100, 80)], z0: 0, z1: 60 };
const dark = reshapeToComply({ ring: site, fronts, siteAreaSqm: A, zone: 'R4', hobM: 18.5, fsr: 1.3, lat: LAT, lon: LON, context: [wall], hoursRequired: 2 });
check('shaded lot: a scheme still, and it says whether it complies', !!dark && typeof dark.complies === 'boolean' && dark.sun.total > 0);

// ---- too small for a footprint, or a zone that takes no apartments: none ----

check('small lot: no footprint fits, no scheme', reshapeToComply({ ring: rect(0, 0, 20, 30), fronts, siteAreaSqm: 600, zone: 'R4', hobM: 18.5, fsr: 1.3, lat: LAT, lon: LON, context: [], hoursRequired: 2 }) === undefined);
check('R2: no apartments, no scheme', reshapeToComply({ ring: site, fronts, siteAreaSqm: A, zone: 'R2', hobM: 9.5, fsr: 0.3, lat: LAT, lon: LON, context: [], hoursRequired: 2 }) === undefined);
check('two storeys: under the three a footprint asks, no scheme', reshapeToComply({ ring: site, fronts, siteAreaSqm: A, zone: 'R4', hobM: 8, fsr: 1.3, lat: LAT, lon: LON, context: [], hoursRequired: 2 }) === undefined);

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('reshape: all checks pass');

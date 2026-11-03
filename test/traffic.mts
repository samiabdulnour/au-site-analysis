/* The massing's traffic on made-up streets.
 *
 * Which vehicles each street class carries, that the buses keep to the bus
 * routes where they are given, that nothing stands over a kerb, a building or
 * another vehicle, and that the axonometric draws each kind. Nothing here asks
 * a network.
 *
 *   npx tsx test/traffic.mts
 */

import { carriageways, type RoadLine } from '../src/lib/carriageway.js';
import { placeTraffic, vehiclesClash, drawAxonometric, VEHICLE_SIZE, type Vehicle, type VehicleKind, type AxoScene } from '../src/render/axonometric.js';
import type { XY } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

const line = (a: XY, b: XY): XY[] => Array.from({ length: 41 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 40, y: a.y + ((b.y - a.y) * i) / 40 }));
const box = (x0: number, y0: number, w: number, h: number): XY[] => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
const kinds = (vs: Vehicle[]) => vs.reduce((m, v) => m.set(v.kind, (m.get(v.kind) ?? 0) + 1), new Map<VehicleKind, number>());
const inRing = (p: XY, rg: XY[]) => {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if ((rg[i].y > p.y) !== (rg[j].y > p.y) && p.x < ((rg[j].x - rg[i].x) * (p.y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c;
  return c;
};
const cornersOf = (v: Vehicle): XY[] => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, q]) => ({ x: v.c.x + v.u.x * s * v.half + v.n.x * q * v.hw, y: v.c.y + v.u.y * s * v.half + v.n.y * q * v.hw }));

// An arterial along the site's front, a local street up its side, a collector behind, and a lane.
const arterial: RoadLine = { coords: line({ x: -260, y: -40 }, { x: 260, y: -40 }), hierarchy: 3, name: 'MAIN RD' };
const local: RoadLine = { coords: line({ x: 40, y: -260 }, { x: 40, y: 260 }), hierarchy: 6, name: 'SIDE ST' };
const collector: RoadLine = { coords: line({ x: -260, y: 60 }, { x: 260, y: 60 }), hierarchy: 5, name: 'BACK ST' };
const lane: RoadLine = { coords: line({ x: -40, y: -260 }, { x: -40, y: 260 }), hierarchy: 7, name: 'A LANE' };
const footprints = [box(-30, -20, 20, 30), box(55, -20, 20, 30), box(-120, 70, 25, 25)];
const reach = 250;

// ---- the mix by street class ------------------------------------------------------
{
  const cw = carriageways([arterial, local, collector, lane], []);
  const vs = placeTraffic(cw, { reach, footprints });
  const k = kinds(vs);
  for (const kind of ['car', 'van', 'truck', 'semi', 'bus'] as VehicleKind[]) check(`the streets carry a ${kind}`, (k.get(kind) ?? 0) > 0, JSON.stringify([...k]));
  check('cars are the most of it', (k.get('car') ?? 0) > vs.length / 2, JSON.stringify([...k]));
  // on which street each stands: the nearest axis running its way (a car across a junction is not on the cross street)
  const along = (r: RoadLine, u: XY) => { const a = r.coords[0], b = r.coords[r.coords.length - 1], l = Math.hypot(b.x - a.x, b.y - a.y); return Math.abs(((b.x - a.x) * u.x + (b.y - a.y) * u.y) / l) > 0.9; };
  const streetOf = (v: Vehicle) => [arterial, local, collector, lane].filter((r) => along(r, v.u)).map((r) => ({ r, d: Math.min(...r.coords.map((p) => Math.hypot(p.x - v.c.x, p.y - v.c.y))) })).sort((a, b) => a.d - b.d)[0].r;
  check('nothing down the lane', vs.every((v) => streetOf(v) !== lane));
  check('no articulated truck off the arterial', vs.filter((v) => v.kind === 'semi').every((v) => streetOf(v) === arterial));
  check('no bus down the local street without a route', vs.filter((v) => v.kind === 'bus').every((v) => streetOf(v) !== local));
  check('the nearest few to the site take more than cars', vs.slice(0, 4).some((v) => v.kind !== 'car'), vs.slice(0, 4).map((v) => v.kind).join(' '));
  // where they stand
  const onRoad = (p: XY) => cw.polygons.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)));
  check('every vehicle on the carriageway, kerb to kerb', vs.every((v) => cornersOf(v).every(onRoad)), vs.filter((v) => !cornersOf(v).every(onRoad)).map((v) => v.kind).join(' '));
  check('none on a building', vs.every((v) => ![v.c, ...cornersOf(v)].some((p) => footprints.some((rg) => inRing(p, rg)))));
  check('none within reach of another', vs.every((v, i) => vs.every((o, j) => i === j || !vehiclesClash(v, o))));
  check('every vehicle its kind\'s size', vs.every((v) => v.half === VEHICLE_SIZE[v.kind].half && v.hw === VEHICLE_SIZE[v.kind].hw));
  check('within reach', vs.every((v) => Math.hypot(v.c.x, v.c.y) <= reach));
  check('the same streets, the same traffic', JSON.stringify(vs) === JSON.stringify(placeTraffic(cw, { reach, footprints })));
  // each on the left of its direction of travel, as the road rules have it
  const leftOf = (v: Vehicle) => {
    const r = streetOf(v), a = r.coords[0], b = r.coords[r.coords.length - 1], l = Math.hypot(b.x - a.x, b.y - a.y);
    const t = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, side = t.x * (v.c.y - a.y) - t.y * (v.c.x - a.x);
    return (v.u.x * t.x + v.u.y * t.y > 0) === (side > 0);
  };
  check('every vehicle keeps left', vs.every(leftOf));
}

// ---- the buses keep to the routes ---------------------------------------------------
{
  const cw = carriageways([arterial, local, collector], []);
  const none = placeTraffic(cw, { reach, footprints, busRoutes: [] });
  check('no route, no bus', !none.some((v) => v.kind === 'bus'));
  check('no route, the trucks and vans still run', none.some((v) => v.kind === 'truck') && none.some((v) => v.kind === 'van'));
  const route = [line({ x: 40.5, y: -260 }, { x: 40.5, y: 260 })];
  const routed = placeTraffic(cw, { reach, footprints, busRoutes: route });
  const buses = routed.filter((v) => v.kind === 'bus');
  check('a route down the local street brings a bus to it', buses.length > 0);
  check('every bus on the route', buses.every((v) => Math.abs(v.c.x - 40) < 6 && Math.abs(v.u.y) > 0.9), buses.map((v) => `${v.c.x.toFixed(1)},${v.c.y.toFixed(1)}`).join(' '));
}

// ---- a vehicle that does not fit gives way to a smaller one ----------------------------
{
  // an arterial whose carriageway comes in pieces 11 m long, 2 m apart: no bus nor articulated truck fits one, and their slots take something smaller
  const axis = line({ x: -200, y: 0 }, { x: 200, y: 0 });
  const cw = { polygons: Array.from({ length: 31 }, (_, i) => [box(-200 + i * 13, -5, 11, 10)]), axes: [{ road: { coords: axis, hierarchy: 3 }, axis, left: 5, right: 5 }] };
  const vs = placeTraffic(cw, { reach, footprints: [] });
  const k = kinds(vs);
  check('short pieces: no bus, no articulated truck', !k.get('bus') && !k.get('semi'), JSON.stringify([...k]));
  check('short pieces: the traffic still runs, in what fits', vs.length >= 8 && vs.every((v) => v.half * 2 <= 11), JSON.stringify([...k]));
  check('short pieces: each vehicle within a piece', vs.every((v) => cw.polygons.some(([rg]) => cornersOf(v).every((p) => inRing(p, rg)))));
}

// ---- drawn ------------------------------------------------------------------------
{
  const scene: AxoScene = {
    ring: box(-15, -20, 30, 40), frontNormal: { x: 0, y: -1 }, reach, built: [{ rings: [box(-12, -17, 24, 34)], z0: 0, z1: 18, fill: '#d8d0f0', edge: '#1c1c1c', edgeW: 0.2 }],
    neighbours: footprints.slice(1).map((rg) => ({ rings: [rg], heightM: 12, fill: '#e8a07a' })),
    roads: [arterial, local, collector], kerbs: [], lots: [], trees: [],
    inks: { site: '#d43d33', future: '#ffffff', futureEdge: '#888888', envelope: '#333333', kerb: '#99aaaa' },
  };
  const svg = drawAxonometric(scene, { x: 0, y: 0, w: 400, h: 280 }, 't');
  for (const kind of ['car', 'van', 'truck', 'semi', 'bus']) check(`the axonometric draws a ${kind}`, svg.includes(`data-vehicle="${kind}"`));
  check('no NaN in the drawing', !svg.includes('NaN'));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('traffic: all checks pass');

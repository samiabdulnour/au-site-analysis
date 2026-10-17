/* Indicative kerb lines on made-up lots.
 *
 * Geometry only: a kerb a footpath's width out from the lot boundary, on the
 * street's side, measured from a mapped footpath where there is one, none
 * along a lane, none where two lots meet. Nothing here asks a network.
 *
 *   npx tsx test/kerbs.mts
 */

import { estimateKerbs, typicalFootpathM } from '../src/lib/kerbs.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// Metres about a point at Sydney's latitude, to lon/lat and back.
const lat0 = -33.88, lon0 = 151.18;
const mx = 1 / (Math.cos((lat0 * Math.PI) / 180) * 111_320), my = 1 / 110_574;
const ll = (x: number, y: number): [number, number] => [lon0 + x * mx, lat0 + y * my];
const ys = (k: { coords: [number, number][] }) => k.coords.map(([, lat]) => (lat - lat0) / my);
const box = (x0: number, y0: number, x1: number, y1: number, clockwise = false) => {
  const r = [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
  return clockwise ? r.reverse() : r;
};

// Two rows of 20 m lots either side of a 20 m reserve running east, one lot wound the other way.
const lots = [box(0, 0, 20, 20), box(20, 0, 40, 20, true), box(0, 40, 20, 60), box(20, 40, 40, 60)];
const street = (hierarchy: number) => ({ hierarchy, coords: [ll(-5, 30), ll(45, 30)] });

{
  const k = estimateKerbs(lots, [street(6)], []);
  check('a local street: a kerb along each of its four frontages', k.length === 4, String(k.length));
  check('a local street: 3.5 m in from the boundary, on the street side',
    k.every((l) => ys(l).every((y) => Math.abs(y - 23.5) < 0.05 || Math.abs(y - 36.5) < 0.05)), JSON.stringify(k.map(ys)));
  check('a local street: none where two lots meet, or on the backs', k.every((l) => l.from === 'typical'));
}
{
  // A footpath mapped 2.5 m out from the south boundary: the footpath is 5 m wide there.
  const k = estimateKerbs(lots, [street(6)], [[ll(-5, 22.5), ll(45, 22.5)]]);
  const south = k.filter((l) => ys(l)[0] < 30);
  check('a mapped footpath sets the width', south.length === 2 && south.every((l) => l.from === 'footway' && Math.abs(ys(l)[0] - 25) < 0.05),
    JSON.stringify(south.map((l) => [l.from, ys(l)])));
}
check('a lane has no footpath', estimateKerbs(lots, [street(7)], []).length === 0);
check('an arterial has a wider one', typicalFootpathM(3)! > typicalFootpathM(6)!);
{
  // A 9 m reserve: the kerb stays a lane's width from the middle.
  const narrow = [box(0, 0, 20, 20), box(0, 29, 20, 49)];
  const k = estimateKerbs(narrow, [{ hierarchy: 6, coords: [ll(-5, 24.5), ll(25, 24.5)] }], []);
  check('a narrow reserve keeps a carriageway', k.every((l) => ys(l).every((y) => Math.abs(y - 24.5) >= 2.79)), JSON.stringify(k.map(ys)));
}
{
  // A mapped kerb takes the place of the estimate beside it.
  const osm = [[ll(-5, 23.4), ll(45, 23.4)]];
  const k = estimateKerbs(lots, [street(6)], [], osm);
  check('a mapped kerb replaces the estimate', k.filter((l) => l.from === 'osm').length === 1 && k.filter((l) => l.from === 'typical').length === 2,
    JSON.stringify(k.map((l) => l.from)));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('kerbs: all checks pass');

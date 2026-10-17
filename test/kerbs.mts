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
// The line's heights (m) along the lots' frontage, read off it at x = 5, 15,
// 25 and 35 m, clear of the arcs where it turns at the ends.
const ys = (k: { coords: [number, number][] }) => {
  const m = k.coords.map(([lon, lat]) => [(lon - lon0) / mx, (lat - lat0) / my]);
  const out: number[] = [];
  for (const x of [5, 15, 25, 35])
    for (let i = 1; i < m.length; i++) {
      const [xa, ya] = m[i - 1], [xb, yb] = m[i];
      if ((xa - x) * (xb - x) <= 0 && xa !== xb) { out.push(ya + ((yb - ya) * (x - xa)) / (xb - xa)); break; }
    }
  return out;
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.15;
const box = (x0: number, y0: number, x1: number, y1: number, clockwise = false) => {
  const r = [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
  return clockwise ? r.reverse() : r;
};

// Two rows of 20 m lots either side of a 20 m reserve running east, one lot wound the other way.
const lots = [box(0, 0, 20, 20), box(20, 0, 40, 20, true), box(0, 40, 20, 60), box(20, 40, 40, 60)];
const street = (hierarchy: number) => ({ hierarchy, coords: [ll(-5, 30), ll(45, 30)] });

{
  const k = estimateKerbs(lots, [street(6)], []);
  check('a local street: one unbroken kerb each side, across both lots', k.length === 2, String(k.length));
  check('a local street: 3.5 m in from the boundary, on the street side',
    k.every((l) => ys(l).length === 4 && ys(l).every((y) => near(y, 23.5) || near(y, 36.5))), JSON.stringify(k.map(ys)));
  check('a local street: none where two lots meet, or on the backs', k.every((l) => l.from === 'typical'));
}
{
  // A footpath mapped 2.5 m out from the south boundary: the footpath is 5 m wide there.
  const k = estimateKerbs(lots, [street(6)], [[ll(-5, 22.5), ll(45, 22.5)]]);
  const south = k.filter((l) => ys(l)[0] < 30);
  check('a mapped footpath sets the width', south.length === 1 && south.every((l) => l.from === 'footway' && ys(l).length === 4 && ys(l).every((y) => near(y, 25))),
    JSON.stringify(south.map((l) => [l.from, ys(l)])));
}
check('a lane has no footpath', estimateKerbs(lots, [street(7)], []).length === 0);
check('an arterial has a wider one', typicalFootpathM(3)! > typicalFootpathM(6)!);
{
  // A 9 m reserve: the kerb stays a lane's width from the middle.
  const narrow = [box(0, 0, 20, 20), box(0, 29, 20, 49)];
  const k = estimateKerbs(narrow, [{ hierarchy: 6, coords: [ll(-5, 24.5), ll(25, 24.5)] }], []);
  check('a narrow reserve keeps a carriageway', k.length === 2 && k.every((l) => ys(l).every((y) => Math.abs(y - 24.5) >= 2.65)), JSON.stringify(k.map(ys)));
}
{
  // A mapped kerb takes the place of the estimate beside it.
  const osm = [[ll(-5, 23.4), ll(45, 23.4)]];
  const k = estimateKerbs(lots, [street(6)], [], osm);
  check('a mapped kerb replaces the estimate', k.filter((l) => l.from === 'osm').length === 1 && k.filter((l) => l.from === 'typical').length === 1,
    JSON.stringify(k.map((l) => l.from)));
}

{
  // A corner block: a street along the south and one along the east. The
  // kerb turns the corner in one line, an arc round the lot's corner.
  const corner = [box(0, 0, 20, 20)];
  const roads2 = [{ hierarchy: 6, coords: [ll(-10, 30), ll(40, 30)] }, { hierarchy: 6, coords: [ll(-10, 30), ll(-10, -20)] }];
  const k = estimateKerbs(corner, roads2, []);
  const pts = k.flatMap((l) => l.coords.map(([lon, lat]) => [(lon - lon0) / mx, (lat - lat0) / my]));
  const atCorner = pts.filter(([x, y]) => x < 0 && y > 20);
  check('a corner: one line turns it', k.length === 1, String(k.length));
  check('a corner: an arc 3.5 m round the lot corner', atCorner.length > 0 && atCorner.every(([x, y]) => Math.abs(Math.hypot(x, y - 20) - 3.5) < 0.2),
    JSON.stringify(atCorner.map((p) => p.map((v) => v.toFixed(2)))));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('kerbs: all checks pass');

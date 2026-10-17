/* Indicative kerb lines on made-up lots.
 *
 * Geometry only: a kerb a footpath's width out from the lot boundary, on the
 * street's side, measured from a mapped footpath where there is one, just off
 * the boundary along a lane or a street too narrow for a footpath, none where
 * two lots meet, an arc of the return radius at a corner, and one line from a
 * street into a lane. Nothing here asks a network.
 *
 *   npx tsx test/kerbs.mts
 */

import { estimateKerbs, LANE_VERGE_M, typicalFootpathM } from '../src/lib/kerbs.js';

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
{
  const k = estimateKerbs(lots, [street(7)], []);
  check('a lane: no footpath, its kerb just off the boundary', k.length === 2 && k.every((l) => ys(l).length === 4 && ys(l).every((y) => near(y, 20 + LANE_VERGE_M) || near(y, 40 - LANE_VERGE_M))),
    JSON.stringify(k.map(ys)));
}
check('an arterial has a wider one', typicalFootpathM(3)! > typicalFootpathM(6)!);
{
  // A 9 m reserve: the kerb stays a lane's width from the middle.
  const narrow = [box(0, 0, 20, 20), box(0, 29, 20, 49)];
  const k = estimateKerbs(narrow, [{ hierarchy: 6, coords: [ll(-5, 24.5), ll(25, 24.5)] }], []);
  check('a narrow reserve keeps a carriageway', k.length === 2 && k.every((l) => ys(l).every((y) => Math.abs(y - 24.5) >= 2.65)), JSON.stringify(k.map(ys)));
}
{
  // A 7 m reserve has no room for a footpath: a lane in all but name, its kerb at the lane's verge.
  const lanelike = [box(0, 0, 20, 20), box(0, 27, 20, 47)];
  const k = estimateKerbs(lanelike, [{ hierarchy: 6, coords: [ll(-5, 23.5), ll(25, 23.5)] }], []);
  check('a street too narrow for a footpath: kerbs at the lane verge', k.length === 2 && k.every((l) => ys(l).slice(0, 2).every((y) => near(y, 20 + LANE_VERGE_M) || near(y, 27 - LANE_VERGE_M))),
    JSON.stringify(k.map(ys)));
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

{
  // A street along the north of two blocks with a 6 m lane between them
  // running south. Each block's kerb is one line: along the street at the
  // footpath's width, round the corner, and down the lane at its verge, and
  // the lane's mouth stays open between the two.
  const blocks = [box(0, 0, 20, 20), box(26, 0, 46, 20), box(-5, 40, 51, 60)];
  const roads3 = [{ hierarchy: 6, coords: [ll(-10, 30), ll(56, 30)] }, { hierarchy: 7, coords: [ll(23, 30), ll(23, -10)] }];
  const k = estimateKerbs(blocks, roads3, []);
  const m = k.map((l) => l.coords.map(([lon, lat]) => [(lon - lon0) / mx, (lat - lat0) / my]));
  const segD = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const has = (pts: number[][], x: number, y: number) => pts.some((_, i) => i > 0 && segD([x, y], pts[i - 1], pts[i]) < 0.15);
  const west = m.find((pts) => has(pts, 10, 23.5)), east = m.find((pts) => has(pts, 36, 23.5));
  check('a lane mouth: the west block\'s kerb runs from the street into the lane', !!west && has(west, 20 + LANE_VERGE_M, 10), JSON.stringify(west));
  check('a lane mouth: and the east block\'s', !!east && has(east, 26 - LANE_VERGE_M, 10), JSON.stringify(east));
  check('a lane mouth: the two are separate lines', !!west && west !== east);
  check('a lane mouth: open in the middle', m.every((pts) => !pts.some((_, i) => i > 0 && segD([23, 18.5], pts[i - 1], pts[i]) < 1.2)));
  // The return: walked along every 0.1 m, the line comes in toward the lot
  // steadily as it turns, with no step.
  const fine: number[][] = [];
  (west ?? []).forEach((p, i, a) => {
    if (!i) return;
    const n = Math.ceil(Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) / 0.1);
    for (let s2 = 0; s2 < n; s2++) fine.push([a[i - 1][0] + ((p[0] - a[i - 1][0]) * s2) / n, a[i - 1][1] + ((p[1] - a[i - 1][1]) * s2) / n]);
  });
  const lot = (q: number[]) => Math.hypot(Math.max(0, q[0] - 20, -q[0]), Math.max(0, q[1] - 20, -q[1]));
  const zone = fine.filter(([x, y]) => x > 12 && y > 8);
  let steady = zone.length > 20;
  for (let i = 1; i < zone.length; i++) if (Math.abs(lot(zone[i]) - lot(zone[i - 1])) > 0.12) steady = false;
  const ends = [lot(zone[0] ?? [0, 0]), lot(zone[zone.length - 1] ?? [0, 0])].sort((a, b) => a - b);
  check('a lane mouth: the return eases round, no step', steady && Math.abs(ends[0] - LANE_VERGE_M) < 0.15 && Math.abs(ends[1] - 3.5) < 0.15,
    JSON.stringify(zone.filter((_, i) => i % 10 === 0).map((q) => [q[0].toFixed(1), q[1].toFixed(1), lot(q).toFixed(2)])));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('kerbs: all checks pass');

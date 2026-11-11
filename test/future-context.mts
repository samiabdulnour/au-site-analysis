/* The future context (lib/futureContext.ts), on made-up lots.
 *
 * Which footprint a lot's envelope holds (22 m east–west, 18 m double-loaded,
 * 12 m single-loaded, at most 45 m long), the storeys its height and ratio
 * give, the street side it lies along, and the narrow lots joined until one
 * fits. Nothing here asks a network.
 *
 *   npx tsx test/future-context.mts
 */

import { futureContext, fitFootprint, streetEdges, FOOTPRINTS } from '../src/lib/futureContext.js';
import type { XY } from '../src/lib/yield.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = (r: XY[]) => Math.abs(r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]; return t + p.x * q.y - q.x * p.y; }, 0) / 2);

check('the footprints: 12, 18 and 22 m deep', FOOTPRINTS.single.depth === 12 && FOOTPRINTS.double.depth === 18 && FOOTPRINTS.doubleEW.depth === 22);

// a street running east–west along y = −10
const road: XY[][] = [[{ x: -300, y: -10 }, { x: 300, y: -10 }]];
check('frontage: the edge along the street', streetEdges(rect(0, 0, 40, 50), road).join(',') === 'true,false,false,false');

{
  // a wide lot on the street, 60 × 40 m, 18 m height: six storeys, its envelope 6 m off the street, 9 m off the rest
  // (five to eight storeys): 42 × 25 m; along the street an east–west bar, 18 m deep, 42 m long
  const lot = rect(0, 0, 60, 40);
  const f = fitFootprint(lot, streetEdges(lot, road), 18.6, undefined, area(lot))!;
  check('wide lot: an 18 m double-loaded bar along the street', !!f && f.type === 'double' && near(f.depthM, 18, 1e-9) && near(f.lengthM, 42, 1.6), JSON.stringify(f && { type: f.type, d: f.depthM, l: f.lengthM }));
  check('wide lot: six storeys under 18.6 m, the height governs', f.storeys === 6 && f.governs === 'height' && near(f.heightM, 18.6, 1e-9));
  check('wide lot: the bar lies along the street, 6 m off it', near(Math.min(...f.ring.map((p) => p.y)), 6, 0.8), JSON.stringify(f.ring));
  // the ratio holds the floor area: at 1:1 no more than the 2,400 m² of the lot, against 3,289 m² by the height alone
  const g = fitFootprint(lot, streetEdges(lot, road), 18.6, 1, area(lot))!;
  check('wide lot: at 1:1 the floor area keeps under the ratio\'s', !!g && g.gfaSqm <= 2400 + 1e-6 && g.gfaSqm > 2000 && g.gfaSqm < f.gfaSqm, JSON.stringify(g && { s: g.storeys, gov: g.governs, l: g.lengthM, gfa: g.gfaSqm }));
}
{
  // a deep lot running north from the street, 40 × 80 m: its long axis north–south takes the 22 m east–west plan
  const lot = rect(0, 0, 40, 80);
  const f = fitFootprint(lot, streetEdges(lot, road), 25, undefined, area(lot))!;
  check('deep lot: the bar along its length is the 22 m east–west plan', !!f && f.type === 'doubleEW' && near(f.depthM, 22, 1e-9) && near(f.lengthM, 45, 1e-9), JSON.stringify(f && { t: f.type, l: f.lengthM }));
}
{
  // a house lot, 15 × 45 m: nothing fits alone
  check('a 15 m house lot holds no footprint alone', fitFootprint(rect(0, 0, 15, 45), [true, false, false, false], 18.6, 1.3, 675) === null);
  // three of them side by side along the street, and the site to their west: joined, two hold a 12 m bar, three an 18 m
  const site = rect(-40, 0, -5, 45);
  const lots = [0, 15, 30].map((x) => ({ rings: [rect(x, 0, x + 15, 45)], zone: 'R4', hobM: 18.6, fsr: 1.3 }));
  const fc = futureContext(lots, road, site);
  check('three house lots joined hold a building', fc.buildings.length === 1 && fc.buildings[0].lots.length >= 2 && fc.developed.filter(Boolean).length === fc.buildings[0].lots.length,
    JSON.stringify(fc.buildings.map((b) => ({ lots: b.lots, type: b.type, l: b.lengthM, s: b.storeys }))));
  check('joined: the lot nearest the site first', fc.buildings[0].lots[0] === 0);
  // R2 lots and a held one do not redevelop
  const r2 = futureContext(lots.map((l) => ({ ...l, zone: 'R2' })), road, site);
  check('R2: nothing redevelops', r2.buildings.length === 0 && r2.tooSmall === 0);
  const held = futureContext(lots.map((l) => ({ ...l, held: true })), road, site);
  check('held by the capacity study: counted, none built', held.buildings.length === 0 && held.held === 3);
  const lone = futureContext([lots[0]], road, site);
  check('a lone house lot: too small, counted', lone.buildings.length === 0 && lone.tooSmall === 1);
  check('a lot beyond reach is left alone', futureContext([{ rings: [rect(500, 0, 560, 40)], zone: 'R4', hobM: 18.6 }], road, site).buildings.length === 0);
}

if (failures.length) { console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('future context: all checks pass');

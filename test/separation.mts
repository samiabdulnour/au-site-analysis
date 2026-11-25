/* Building separation (lib/separation.ts), on made-up blocks.
 *
 * The ADG 3F-1 bands, the distance between a scheme's tiers and a building
 * near it, how it reads (clear, holding only with a blank face, short), a
 * neighbour's future, and the buildings across a street left out. Nothing
 * here asks a network.
 *
 *   npx tsx test/separation.mts
 */

import { separations, ringsDistance, ADG_SEPARATION } from '../src/lib/separation.js';
import type { XY } from '../src/lib/yield.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

// the site 40 × 40 m, its street along the south edge; a scheme of four storeys 6 m in, 28 × 28 m
const site = rect(0, 0, 40, 40), fronts = [true, false, false, false];
const low = [{ rings: [rect(6, 6, 34, 34)], from: 1, to: 4 }];

check('the bands: 12, 18 and 24 m, three quarters of each where a face is blank', ADG_SEPARATION.map((b) => `${b.between}/${b.blank}`).join(' ') === '12/9 18/13.5 24/18');
{
  const d = ringsDistance([rect(0, 0, 10, 10)], [rect(13, 4, 20, 8)]);
  check('distance: from edge to edge, with the two nearest points', near(d.d, 3, 1e-9) && near(d.a.x, 10, 1e-9) && near(d.b.x, 13, 1e-9), JSON.stringify(d));
  check('distance: overlapping footprints are 0 apart', ringsDistance([rect(0, 0, 10, 10)], [rect(5, 5, 15, 15)]).d === 0);
}
{
  // two storeys 14 m east of the scheme: clear of 12; 10 m: holds with a blank face (over 9); 7 m: short
  const at = (gap: number, storeys: number, futureStoreys?: number) => separations(low, [{ rings: [rect(34 + gap, 10, 34 + gap + 8, 30)], storeys, futureStoreys }], site, fronts)[0];
  check('a low neighbour 14 m off: clear', at(14, 2)?.today.status === 'clear' && at(14, 2)?.today.band.between === 12);
  check('10 m off: holds only if one face is blank', at(10, 2)?.today.status === 'blank', JSON.stringify(at(10, 2)?.today));
  check('7 m off: short', at(7, 2)?.today.status === 'short' && near(at(7, 2)!.today.distanceM, 7, 1e-9));
  check('the band they share is the lower one\'s: a tall neighbour beside a low scheme asks 12 m', at(14, 12)?.today.band.between === 12);
  check('beyond 24 m, not listed', at(25, 2) === undefined);
  // a neighbour that may rise: its future read apart
  const r = separations([{ rings: [rect(6, 6, 34, 34)], from: 1, to: 4 }, { rings: [rect(9, 9, 31, 31)], from: 5, to: 8 }],
    [{ rings: [rect(34 + 14, 10, 34 + 22, 30)], storeys: 2, futureStoreys: 8 }], site, fronts)[0];
  check('built out: a neighbour rising to eight storeys asks 18 m of the tier that shares the band', !!r && r.today.status === 'clear' && !!r.future && r.future.band.between === 18
    && near(r.future.distanceM, 17, 1e-9) && r.future.status === 'blank', JSON.stringify(r));
}
{
  // a building across the street (south of the site's frontage) is left to the street
  const across = separations(low, [{ rings: [rect(10, -20, 30, -8)], storeys: 3 }], site, fronts);
  check('across the street: left out', across.length === 0, JSON.stringify(across));
  // the same building, the south edge no street: listed, and 14 m off is clear
  const behind = separations(low, [{ rings: [rect(10, -20, 30, -8)], storeys: 3 }], site, [false, false, false, false]);
  check('the same building over a side boundary: listed', behind.length === 1 && behind[0].today.status === 'clear' && near(behind[0].today.distanceM, 14, 1e-9), JSON.stringify(behind));
}
{
  // the worst first: short before blank before clear
  const rows = separations(low, [
    { rings: [rect(34 + 14, 10, 34 + 20, 30)], storeys: 2 },
    { rings: [rect(-7, 10, -1, 30)], storeys: 2 },
    { rings: [rect(10, 34 + 10, 30, 34 + 16)], storeys: 2 },
  ], site, fronts);
  check('order: the shortest first', rows.map((r) => r.today.status).join(',') === 'short,blank,clear', rows.map((r) => `${r.index}:${r.today.status}`).join(','));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('separation: all checks pass');

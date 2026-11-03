/* An amalgamated site: the lots of each property an address names, found by a
 * point inside each lot, and the site named by every address it joins.
 * Made-up shapes and the register's own spellings, no network.
 *
 *   npx tsx test/site-lots.mts
 */

import { interiorPoint, inRings } from '../src/fetch/nsw.js';
import { siteAddressOf } from '../src/fetch/geocode.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// A property of three lots side by side, as 99-107 Riley Street is, and its outline.
const lot = (x0: number, x1: number) => [[[x0, 0], [x1, 0], [x1, 10], [x0, 10], [x0, 0]]];
const property = [[[0, 0], [30, 0], [30, 10], [0, 10], [0, 0]]];
for (const [name, rings] of [['west', lot(0, 10)], ['middle', lot(10, 20)], ['east', lot(20, 30)]] as const) {
  const p = interiorPoint(rings as number[][][]);
  check(`${name} lot has an inside point`, !!p);
  check(`${name} lot lies in its property`, !!p && inRings(p, property), JSON.stringify(p));
}
// The neighbour sharing the property's edge is not taken: the edge alone touches, its inside does not.
const neighbour = interiorPoint(lot(30, 40));
check('the neighbour lies outside', !!neighbour && !inRings(neighbour, property), JSON.stringify(neighbour));

// An L-shaped lot whose centroid falls in the notch: the point must still be inside the lot.
const ell = [[[0, 0], [20, 0], [20, 4], [4, 4], [4, 20], [0, 20], [0, 0]]];
const pe = interiorPoint(ell);
check('an L-shaped lot has an inside point', !!pe && inRings(pe, ell), JSON.stringify(pe));

// A property with a hole (a lot it surrounds but does not own).
const holed = [[[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]], [[10, 10], [10, 20], [20, 20], [20, 10], [10, 10]]];
check('the hole is outside', !inRings([15, 15], holed));
check('the ring around the hole is inside', inRings([5, 5], holed));

// Naming the site.
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
eq('one address is itself', siteAddressOf(['109 RILEY STREET DARLINGHURST']), '109 RILEY STREET DARLINGHURST');
eq('nothing matched', siteAddressOf([]), undefined);
eq('an amalgamation on one street, in street order',
  siteAddressOf(['109 RILEY STREET DARLINGHURST', '91-93 RILEY STREET DARLINGHURST', '95-97 RILEY STREET DARLINGHURST', '99-107 RILEY STREET DARLINGHURST']),
  '91-93, 95-97, 99-107, 109 RILEY STREET DARLINGHURST');
eq('a register list stays a list',
  siteAddressOf(['136 SHOWGROUND ROAD CASTLE HILL', '134-134A SHOWGROUND ROAD CASTLE HILL', '136A SHOWGROUND ROAD CASTLE HILL']),
  '134-134A, 136, 136A SHOWGROUND ROAD CASTLE HILL');
eq('a street that begins with a number keeps it',
  siteAddressOf(['9 7 HILLS ROAD BAULKHAM HILLS', '7 7 HILLS ROAD BAULKHAM HILLS']), '7, 9 7 HILLS ROAD BAULKHAM HILLS');
eq('a register list joins a single number',
  siteAddressOf(['140 SHOWGROUND ROAD CASTLE HILL', '134, 136, 136A, 138 SHOWGROUND ROAD CASTLE HILL']),
  '134, 136, 136A, 138, 140 SHOWGROUND ROAD CASTLE HILL');
eq('different streets, each in full',
  siteAddressOf(['5 JONES ROAD CAMPSIE', '2 SMITH STREET CAMPSIE']),
  '2 SMITH STREET CAMPSIE; 5 JONES ROAD CAMPSIE');
eq('a duplicate is named once', siteAddressOf(['26 CAMPSIE STREET CAMPSIE', '26 CAMPSIE STREET CAMPSIE']), '26 CAMPSIE STREET CAMPSIE');

if (failures.length) {
  console.error(`site lots: ${failures.length} failed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('site lots: ok');

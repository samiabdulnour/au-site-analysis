/* Transport oriented development (lib/tod.ts): which station-precinct controls apply at a site.
 *
 * The Housing SEPP's TOD controls in its TOD areas (22 m and 2.5:1 for a residential flat building, 24 m for
 * shop-top housing, the LEP's where more generous, a lot 21 m wide); a council's alternative where it replaced them
 * (Ku-ring-gai's four stations, within 800 m); deferred and accelerated precincts. Nothing here asks a network.
 *
 *   npx tsx test/tod.mts
 */

import { readTod, todSentence, TOD_SEPP } from '../src/lib/tod.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const tod = [{ kind: 'tod', name: 'Homebush' }];

const r2 = readTod({ policyAtSite: tod, zone: 'R2', lepHobM: 9.5, lepFsr: 0.5, lotWidthM: 30 })!;
check('SEPP: an R2 lot takes a residential flat building to 22 m and 2.5:1', r2.regime === 'sepp' && r2.permits === 'residentialFlatBuilding' && r2.hobM === 22 && r2.fsr === 2.5 && r2.lifts === true && r2.wideEnough === true, JSON.stringify(r2));
const e1 = readTod({ policyAtSite: tod, zone: 'E1', lepHobM: 14, lepFsr: 1.5 })!;
check('SEPP: a local centre takes shop-top housing to 24 m', e1.permits === 'shopTopHousing' && e1.hobM === TOD_SEPP.shopTopHeightM && e1.fsr === 2.5, JSON.stringify(e1));
const rich = readTod({ policyAtSite: tod, zone: 'R4', lepHobM: 30, lepFsr: 3 })!;
check('SEPP: a more generous LEP stands, and the SEPP lifts nothing', rich.hobM === 30 && rich.fsr === 3 && rich.lifts === false);
const mixed = readTod({ policyAtSite: tod, zone: 'R4', lepHobM: 30, lepFsr: 1.8 })!;
check('SEPP: each standard the more generous of the two', mixed.hobM === 30 && mixed.fsr === 2.5 && mixed.lifts === true);
const narrow = readTod({ policyAtSite: tod, zone: 'R3', lepHobM: 9.5, lepFsr: 0.7, lotWidthM: 15.2 })!;
check('SEPP: a lot narrower than 21 m is not wide enough, and the sentence says so', narrow.wideEnough === false && /15\.2 m wide/.test(todSentence(narrow)) && /21 m/.test(todSentence(narrow)));
const sp2 = readTod({ policyAtSite: tod, zone: 'SP2' })!;
check('SEPP: a zone that takes neither type, nothing permitted', sp2.permits === undefined && /takes neither/.test(todSentence(sp2)));

const killara = readTod({ policyAtSite: [], station: { name: 'KILLARA RAILWAY STATION', distanceM: 287 }, lgaName: 'KU-RING-GAI', zone: 'R4' })!;
check('Ku-ring-gai: Killara\'s precinct, the alternative', killara.regime === 'alternative' && killara.name === 'Killara' && killara.alternative?.council === 'Ku-ring-gai', JSON.stringify(killara));
check('Ku-ring-gai: the sentence names the instrument, the date and the savings', /Ku-ring-gai Station Precincts/.test(todSentence(killara)) && /14 November 2025/.test(todSentence(killara)) && /13 June 2025/.test(todSentence(killara)));
check('Ku-ring-gai: Gordon 650 m out is still the precinct', readTod({ policyAtSite: [], station: { name: 'GORDON RAILWAY STATION', distanceM: 650 }, lgaName: 'KU-RING-GAI' })?.regime === 'alternative');
check('Ku-ring-gai: Pymble is not one of the four', readTod({ policyAtSite: [], station: { name: 'PYMBLE RAILWAY STATION', distanceM: 200 }, lgaName: 'KU-RING-GAI' }) === undefined);
check('Ku-ring-gai: beyond 800 m, nothing', readTod({ policyAtSite: [], station: { name: 'KILLARA RAILWAY STATION', distanceM: 820 }, lgaName: 'KU-RING-GAI' }) === undefined);
check('another council\'s Killara: nothing', readTod({ policyAtSite: [], station: { name: 'KILLARA RAILWAY STATION', distanceM: 200 }, lgaName: 'HORNSBY' }) === undefined);
check('Canterbury-Bankstown: Lakemba within 400 m, the alternative', readTod({ policyAtSite: [], station: { name: 'LAKEMBA RAILWAY STATION', distanceM: 350 }, lgaName: 'CANTERBURY-BANKSTOWN' })?.regime === 'alternative');

check('deferred: named, the LEP stands', readTod({ policyAtSite: [{ kind: 'todDeferred', name: 'Wiley Park' }] })?.regime === 'deferred');
check('accelerated: named, its own maps', /accelerated/.test(todSentence(readTod({ policyAtSite: [{ kind: 'todAccelerated', name: 'Bankstown' }] })!)));
check('none: nothing', readTod({ policyAtSite: [] }) === undefined);

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('tod: all checks pass');

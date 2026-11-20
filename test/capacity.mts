/* The capacity and opportunity study's reading of made-up lots: which
 * property is a strata scheme and how big, which is a heritage item, which
 * is public land, which was significantly developed in the past twenty
 * years, which is too small to develop on its own, and what the author's
 * overrides change; then the tick, the cross and the grey patch on each.
 * Pure geometry and record selection: nothing here asks a network.
 *
 *   npx tsx test/capacity.mts
 */

import { classifyCapacity, inWindow, capacityCounts, type RegisterRecord } from '../src/lib/capacity.js';
import type { DaRecord } from '../src/fetch/da.js';
import type { GeoJSONFC, GeoJSONFeature } from '../src/lib/arcgis.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// A local metre grid round a Sydney latitude, through the library's own projection so the assertions see what the code sees.
const ORIGIN = lonLatToMercator({ lon: 151.215, lat: -33.875 });
const K = mercatorScaleFactor(-33.875);
const ll = (xM: number, yM: number): [number, number] => { const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K }); return [p.lon, p.lat]; };
const rect = (x: number, y: number, w: number, h: number): number[][][] => [[ll(x, y), ll(x + w, y), ll(x + w, y + h), ll(x, y + h), ll(x, y)]];
const feature = (rings: number[][][], properties: Record<string, unknown>): GeoJSONFeature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties });
const fc = (features: GeoJSONFeature[]): GeoJSONFC => ({ type: 'FeatureCollection', features });
const ms = (iso: string) => new Date(iso).getTime();

// The block: the site S (40 × 35 m) with A to its north sharing a 40 m edge, then a row of other parcels.
const S = rect(0, 0, 40, 35);
const A = rect(0, 35, 40, 10);       // strata scheme of 35 lots, registered 2011
const B = rect(50, 0, 10, 15);       // heritage terrace, 150 m²
const C = rect(50, 20, 20, 20);      // 400 m² single title
const D = rect(80, 0, 10, 12);       // 120 m² single title, too small
const E = rect(80, 20, 30, 30);      // a park on State land
const F = rect(120, 0, 30, 20);      // approved six-storey new building
const G = rect(120, 30, 25, 20);     // new building completed 2023
const H = rect(160, 0, 20, 10);      // 200 m², the author's tick "DA 2018"
const I = rect(160, 20, 20, 20);     // 400 m², the author's "new"
const row = (pid: number, address: string, rings: number[][][], extra: Record<string, unknown> = {}) => feature(rings, { propid: pid, address, valnetlotcount: 1, ...extra });
const properties = fc([
  row(1, '70-76 RILEY STREET DARLINGHURST', S),
  row(2, '66-68 RILEY STREET DARLINGHURST', A, { valnetlotcount: 35 }),
  ...Array.from({ length: 35 }, (_, i) => row(2, `${i + 1}/66-68 RILEY STREET DARLINGHURST`, A, { valnetlotcount: 35, valnetpropertytype: 4 })),
  row(3, '64 STANLEY STREET DARLINGHURST', B),
  row(4, '107 CROWN STREET DARLINGHURST', C),
  row(44, '107 CROWN STREET DARLINGHURST', C),   // the register's second record of the same parcel
  row(5, '9 STANLEY LANE DARLINGHURST', D),
  row(6, 'CROWN STREET RESERVE DARLINGHURST', E),
  row(7, '85-91 WILLIAM STREET DARLINGHURST', F),
  row(8, '22 YURONG STREET DARLINGHURST', G),
  row(9, '54-56 RILEY STREET DARLINGHURST', H),
  row(10, '121-129 CROWN STREET DARLINGHURST', I),
]);
const lot = (id: string, rings: number[][][], created: string, plan = id.split('/').pop()!) => feature(rings, { lotidstring: id, planlabel: plan, classsubtype: plan.startsWith('SP') ? 3 : 1, createdate: ms(created) });
const lots = fc([
  lot('1//DP774001', S, '1993-09-07'),
  lot('//SP84299', A, '2011-09-01'),
  lot('1//DP999738', B, '1997-07-10'),
  lot('1//DP68144', C, '1993-09-07'),
  lot('1//DP735408', D, '1993-09-07'),
  lot('1//DP1046458', E, '2003-03-19'),
  lot('21//DP1045441', F, '2003-05-29'),
  lot('//SP106030', G, '2024-03-13'),
  lot('1//DP842244', H, '2003-06-10'),
  lot('1//DP125317', I, '1993-09-07'),
]);
const heritage = fc([feature(B, { LAY_CLASS: 'Item - General', H_NAME: 'Lord Roberts Hotel' }), feature(rect(-50, -50, 300, 200), { LAY_CLASS: 'Conservation Area - General', H_NAME: 'East Sydney' })]);
const register: RegisterRecord[] = [
  { address: '85-91 William Street', da: 'D/2024/534', type: 'Addition', status: 'Approved', lodged: '2024-07-11', determined: '2024-11-19', completion: '2026-11-01', dwellings: 0, levels: 6, gfa: 2122, rings: F },
  { address: '22 Yurong Street', da: 'D/2015/421', type: 'New Building', status: 'Completed', lodged: '2015-04-01', determined: '2016-08-24', completion: '2023-09-01', dwellings: 26, levels: 6, gfa: 3480, rings: G },
  { address: '9 Stanley Lane', da: 'D/2025/257', type: 'Conversion', status: 'Approved', lodged: '2025-03-27', determined: '2025-05-21', completion: '2026-11-01', dwellings: 1, levels: 2, gfa: 89, rings: D },  // house-scale: not a development
];
const applications: DaRecord[] = [];
const centre = (() => { const [lon, lat] = ll(20, 17); return lonLatToMercator({ lon, lat }); })();

const result = classifyCapacity({
  centre, properties, lots, heritage, publicLand: [{ kind: 'state', rings: E }], facilities: [], register, applications,
  overrides: { '54-56 RILEY STREET': { symbol: 'potential', note: 'DA 2018' }, '121-129 CROWN STREET': { symbol: 'mature', note: 'new' } },
  options: { thisYear: 2026 },
});
const by = (base: string) => result.properties.find((p) => p.base.startsWith(base))!;

check('the site is found from its point', result.site?.base === '70-76 RILEY STREET DARLINGHURST', result.site?.base);
check('the site is neither marked nor patched', result.site?.mark === 'tick' && result.site?.mature === false);
check('the site is 1,400 m²', Math.abs((result.site?.areaM2 ?? 0) - 1400) <= 2, String(result.site?.areaM2));
check('one neighbour shares its 40 m edge', result.neighbours.length === 1 && result.neighbours[0].base.startsWith('66-68') && Math.abs(result.neighbours[0].sharedM - 40) < 0.5, JSON.stringify(result.neighbours));

const a = by('66-68');
check('A is a strata scheme of 35 lots', a.strata && a.units === 35, `${a.strata} ${a.units}`);
check('A was developed in 2011, by its strata plan', a.developed?.how === 'strata' && a.developed.year === 2011, JSON.stringify(a.developed));
check('A is mature and crossed, the year under it', a.mature && a.mark === 'cross' && a.note === 'strata 2011', `${a.mature} ${a.mark} ${a.note}`);

const b = by('64 STANLEY');
check('B is a heritage item, crossed, not mature', b.heritageItem === 'Lord Roberts Hotel' && b.mark === 'cross' && !b.mature, `${b.heritageItem} ${b.mark} ${b.mature}`);
check('B is in the conservation area', b.inHca === 'East Sydney', b.inHca);

const c = by('107 CROWN');
check('C, a 400 m² single title, is ticked', c.kind === 'single' && c.mark === 'tick' && !c.strata, `${c.kind} ${c.mark}`);
check('the second record of C is counted once', result.duplicates === 1 && result.properties.filter((p) => p.base.startsWith('107 CROWN')).length === 1, String(result.duplicates));

const d = by('9 STANLEY LANE');
check('D, 120 m², is too small: crossed, not mature', d.mark === 'cross' && !d.mature && d.kind === 'single', `${d.mark} ${d.mature} ${d.kind}`);
check('a house conversion on D is not a development', d.active.length === 0);

const e = by('CROWN STREET RESERVE');
check('E is State land, crossed', e.kind === 'state' && e.mark === 'cross', `${e.kind} ${e.mark}`);

const f = by('85-91');
check('F with an approved six-storey addition is developing, patched and crossed, "approved"', f.kind === 'developing' && f.mature && f.mark === 'cross' && f.note === 'approved', `${f.kind} ${f.mature} ${f.mark} ${f.note}`);

const g = by('22 YURONG');
check('G, completed 2023, is mature, "built 2023"', g.mature && g.developed?.how === 'built' && g.note === 'built 2023', `${g.mature} ${JSON.stringify(g.developed)} ${g.note}`);

const h = by('54-56');
check("H keeps the author's tick and note", h.mark === 'tick' && h.note === 'DA 2018' && !h.mature, `${h.mark} ${h.note} ${h.mature}`);

const i = by('121-129');
check("I takes the author's patch, cross and note", i.mature && i.mark === 'cross' && i.note === 'new', `${i.mature} ${i.mark} ${i.note}`);

const visible = inWindow(result, { xmin: ORIGIN.x - 20 * K, xmax: ORIGIN.x + 200 * K, ymin: ORIGIN.y - 20 * K, ymax: ORIGIN.y + 100 * K });
const counts = capacityCounts(visible, result.options);
check('the window counts nine parcels, two with potential', counts.properties === 9 && counts.potential === 2 && counts.low === 7, JSON.stringify(counts));
// G's new building was strata-subdivided in 2024, so two schemes: A and G
check('four of them mature, two strata, one heritage, one public, two overridden, one small', counts.mature === 4 && counts.strata === 2 && counts.heritage === 1 && counts.publicLand === 1 && counts.overridden === 2 && counts.small === 1, JSON.stringify(counts));

// ---- a site of several addresses, flats in one ownership, and a lot too narrow (Z.'s markup of 86, 88-90, 94
// Maroubra Road, 2026-11): the site is every property its lots make, not the one under its point; four unit
// addresses on a deposited plan are flats, not a strata scheme; a 6 m lot of 280 m² is as small as one under 250 m².
{
  const P1 = rect(0, 0, 14, 40), P2 = rect(14, 0, 16, 40), P3 = rect(30, 0, 15, 20);   // the site: 86, 88-90 and 94
  const N1 = rect(-12, 0, 12, 40);            // a single title, 12 m wide, west of the site
  const N2 = rect(45, 0, 6.2, 45);            // 279 m², 6.2 m wide: one half of a semi-detached pair
  const N3 = rect(60, 0, 20, 30);             // three unit addresses, no lot under it in the cadastre's answer: still read as strata
  const N4 = rect(90, 0, 20, 30);             // three unit addresses under a strata plan
  const props = fc([
    row(11, '86 MAROUBRA ROAD MAROUBRA', P1), row(12, '88-90 MAROUBRA ROAD MAROUBRA', P2),
    row(13, '94 MAROUBRA ROAD MAROUBRA', P3), ...[1, 2, 3, 4].map((n) => row(13, `${n}/94 MAROUBRA ROAD MAROUBRA`, P3, { valnetpropertytype: 2 })),
    row(14, '84 MAROUBRA ROAD MAROUBRA', N1), row(15, '96A MAROUBRA ROAD MAROUBRA', N2),
    row(16, '98 MAROUBRA ROAD MAROUBRA', N3), ...[1, 2, 3].map((n) => row(16, `${n}/98 MAROUBRA ROAD MAROUBRA`, N3)),
    row(17, '100 MAROUBRA ROAD MAROUBRA', N4), ...[1, 2, 3].map((n) => row(17, `${n}/100 MAROUBRA ROAD MAROUBRA`, N4)),
  ]);
  const lotsFc = fc([lot('1//DP965310', P1, '1993-09-07'), lot('10//DP1118472', P2, '2007-10-02'), lot('1//DP306910', P3, '1993-09-07'), lot('1//DP100', N1, '1993-09-07'), lot('2//DP100', N2, '1993-09-07'), lot('//SP5000', N4, '1993-09-07')]);
  const at = (() => { const [lon, lat] = ll(22, 20); return lonLatToMercator({ lon, lat }); })();   // the geocoded point: in 88-90
  const args = { centre: at, properties: props, lots: lotsFc, heritage: fc([]), publicLand: [], facilities: [], register: [], applications: [], options: { thisYear: 2026 } };
  const alone = classifyCapacity(args);
  check('without its lots, the site is the property under its point alone', alone.siteParts.length === 1 && alone.site?.base.startsWith('88-90') === true, alone.siteParts.map((q) => q.base).join(' | '));
  check('and its own other addresses come out as its neighbours', alone.neighbours.some((n) => n.base.startsWith('86 ')) && alone.neighbours.some((n) => n.base.startsWith('94 ')));
  const whole = classifyCapacity({ ...args, siteRings: [P1[0], P2[0], P3[0]] });
  const part = (base: string) => whole.properties.find((q) => q.base.startsWith(base))!;
  check('with its lots, the site is all three properties', whole.siteParts.length === 3 && ['86 ', '88-90', '94 '].every((a) => whole.siteParts.some((q) => q.base.startsWith(a))), whole.siteParts.map((q) => q.base).join(' | '));
  check('the site is still named by the property under its point', whole.site?.base.startsWith('88-90') === true, whole.site?.base);
  check('none of the site carries a mark of its own, or a patch', whole.siteParts.every((q) => q.isSite && q.mark === 'tick' && !q.mature && q.note === undefined));
  check('none of the site is its own neighbour; the titles beside it are', !whole.neighbours.some((n) => /^(86|88-90|94) /.test(n.base)) && whole.neighbours.some((n) => n.base.startsWith('84 ')) && whole.neighbours.some((n) => n.base.startsWith('96A')), whole.neighbours.map((n) => n.base).join(' | '));
  check('a neighbour\'s shared boundary is counted against every part of the site', Math.abs((whole.neighbours.find((n) => n.base.startsWith('84 '))?.sharedM ?? 0) - 40) < 0.5 && Math.abs((whole.neighbours.find((n) => n.base.startsWith('96A'))?.sharedM ?? 0) - 20) < 0.5, JSON.stringify(whole.neighbours.map((n) => [n.base, n.sharedM])));
  check('inWindow leaves every part of the site out of the count', inWindow(whole, { xmin: ORIGIN.x - 50 * K, xmax: ORIGIN.x + 200 * K, ymin: ORIGIN.y - 20 * K, ymax: ORIGIN.y + 100 * K }).every((q) => !q.isSite));
  const p94 = part('94 ');
  check('four unit addresses on a deposited plan are flats in one ownership, not a strata scheme', !p94.strata && p94.flats === 4 && p94.strataPlans.length === 0, `${p94.strata} ${p94.flats}`);
  const n3 = part('98 '), n4 = part('100 ');
  check('three unit addresses with no lot read under them are still taken as a scheme', n3.strata && n3.flats === 0 && n3.mark === 'cross', `${n3.strata} ${n3.flats} ${n3.mark}`);
  check('three unit addresses under a strata plan are a scheme', n4.strata && n4.strataPlans.length === 1 && n4.mark === 'cross');
  const n2 = part('96A'), n1 = part('84 ');
  check('a lot 6.2 m wide is measured so', Math.abs(n2.widthM - 6.2) < 0.15 && Math.abs(n1.widthM - 12) < 0.15, `${n2.widthM} ${n1.widthM}`);
  check('279 m² at 6.2 m wide is too small to develop on its own: crossed, not mature', n2.areaM2 >= 250 && n2.small && n2.mark === 'cross' && !n2.mature && n2.kind === 'single', `${n2.areaM2} ${n2.small} ${n2.mark}`);
  check('a 12 m lot of 480 m² keeps its tick', !n1.small && n1.mark === 'tick', `${n1.small} ${n1.mark}`);
  const cs = capacityCounts(inWindow(whole, { xmin: ORIGIN.x - 50 * K, xmax: ORIGIN.x + 200 * K, ymin: ORIGIN.y - 20 * K, ymax: ORIGIN.y + 100 * K }), whole.options);
  check('the narrow lot is counted among the small, for its width', cs.small === 1 && cs.narrow === 1 && cs.strata === 2, JSON.stringify(cs));
  const wide = classifyCapacity({ ...args, siteRings: [P1[0], P2[0], P3[0]], options: { thisYear: 2026, narrowSite: 0 } });
  check('with the width test left out (the yield joins narrow lots itself), the narrow lot keeps its tick', wide.properties.find((q) => q.base.startsWith('96A'))!.mark === 'tick');
}

if (failures.length) { console.error(`capacity: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`capacity: ${result.properties.length} parcels read, ${counts.potential} with potential; all checks pass`);

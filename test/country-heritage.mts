/* Slide 15's heritage layers from made-up features: the ring geometry they
 * lean on (clipping to the strip, covering it, the gap to the site, how
 * much of the site a boundary takes in), the registers' text, the AHIP
 * records merged by permit, the national lists' places and the LEP
 * landscape maps, and what the slide says of them. No network: CI never
 * calls Heritage NSW, DCCEEW or ePlanning.
 *
 *   npx tsx test/country-heritage.mts
 */

import { clipRing, coversBox, inRings, ringsGap, overlapArea, ringArea } from '../src/lib/rings.js';
import { mergeAhips, listPlaces, mergeLepAreas, tidyRegisterText, stripBoxes, EMPTY_COUNTRY, type CountryData } from '../src/fetch/country.js';
import { countryFacts, countrySentences } from '../src/render/slides.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';
import type { GeoJSONFeature } from '../src/lib/arcgis.js';
import type { SlidesBundle } from '../src/pipeline.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const sq = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

// ---- rings ------------------------------------------------------------------------------

const box = { xmin: 0, ymin: 0, xmax: 10, ymax: 10 };
{
  const c = clipRing(sq(-5, -5, 5, 5), box)!;
  check('clip: a square over a corner keeps the quarter inside', near(ringArea(c), 25), JSON.stringify(c));
  check('clip: the clipped ring is closed', c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]);
  check('clip: a ring outside the box is nothing', clipRing(sq(20, 20, 30, 30), box) === null);
  check('clip: a ring inside the box is itself', near(ringArea(clipRing(sq(2, 2, 4, 4), box)!), 4));
}
check('cover: a bigger square covers the box', coversBox([sq(-1, -1, 11, 11)], box));
check('cover: a hole in the box spoils it', !coversBox([sq(-1, -1, 11, 11), sq(4, 4, 6, 6)], box));
check('cover: an edge across the box spoils it', !coversBox([sq(-1, -1, 11, 5)], box));
check('inside: even-odd, a hole is outside', inRings(1, 1, [sq(0, 0, 10, 10), sq(4, 4, 6, 6)]) && !inRings(5, 5, [sq(0, 0, 10, 10), sq(4, 4, 6, 6)]));
check('gap: two squares 3 apart', near(ringsGap([sq(0, 0, 1, 1)], [sq(4, 0, 5, 1)])!.d, 3));
check('gap: crossing edges are no gap', ringsGap([sq(0, 0, 2, 2)], [sq(1, 1, 3, 3)])!.d === 0);
check('gap: one inside the other is no gap', ringsGap([sq(4, 4, 5, 5)], [sq(0, 0, 10, 10)])!.d === 0);
check('gap: the point is on the second set', near(ringsGap([sq(0, 0, 1, 1)], [sq(4, 0, 5, 1)])!.x, 4));
{
  const ov = overlapArea([sq(0, 0, 10, 10)], [sq(5, -5, 20, 20)]);
  check('overlap: half the site', near(ov.share, 0.5, 0.03), `${ov.share}`);
  check('overlap: the site\'s own area', near(ov.siteArea, 100, 3), `${ov.siteArea}`);
  check('overlap: none', overlapArea([sq(0, 0, 10, 10)], [sq(20, 20, 30, 30)]).area === 0);
}

// ---- the registers' text -------------------------------------------------------------------

check('text: a spaced ? is a dash', tidyRegisterText('Taronga Zoo ? Stage 1') === 'Taronga Zoo – Stage 1');
check('text: a spaced hyphen is a dash', tidyRegisterText('Seating Works - Bondi Beach') === 'Seating Works – Bondi Beach');
check('text: ?word? is quoted', tidyRegisterText('Barlings Beach ?Reflections? Balance') === 'Barlings Beach ‘Reflections’ Balance', tidyRegisterText('Barlings Beach ?Reflections? Balance'));
check('text: a quoted word at the start', tidyRegisterText('?Cootha? Part Lot 230') === '‘Cootha’ Part Lot 230');
check('text: an apostrophe', tidyRegisterText('Queen?s Park') === 'Queen’s Park');
check('text: a number range', tidyRegisterText('Lots 2?4 Smith St') === 'Lots 2–4 Smith St');
check('text: line breaks run on', tidyRegisterText('Metro Integration (MTMS 3A) \nSydney') === 'Metro Integration (MTMS 3A) Sydney');

// ---- AHIP records ---------------------------------------------------------------------------

const poly = (rings: number[][][], properties: Record<string, unknown>): GeoJSONFeature => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: rings }, properties });
{
  const r = sq(151.0, -33.0, 151.001, -32.999);
  const permits = mergeAhips([
    poly([r], { AHIP: '4968', Project_Na: 'Works ? Stage 1', Decision_D: '25/08/2016', Status: 'EXPIRED', ExpireDate: Date.UTC(2021, 7, 25) }),
    poly([r], { AHIP: '4968', Project_Na: 'Works ? Stage 1', Decision_D: '3/2/2022', Status: 'ACTIVE', ExpireDate: Date.UTC(2032, 7, 25) }),
    poly([sq(151.002, -33.0, 151.003, -32.999)], { AHIP: 'C0001', Project_Na: 'Other', Decision_D: '1/1/2012', Status: 'EXPIRED', ExpireDate: Date.UTC(2014, 0, 1) }),
  ]);
  const p = permits.find((x) => x.id === '4968');
  check('AHIP: records merge by number', permits.length === 2 && p?.records === 2, JSON.stringify(permits.map((x) => [x.id, x.records])));
  check('AHIP: active when a record is', p?.status === 'ACTIVE');
  check('AHIP: the first decision and the last', p?.decided === '2016-08-25' && p?.lastDecided === '2022-02-03', `${p?.decided} ${p?.lastDecided}`);
  check('AHIP: the latest expiry', p?.expires === '2032-08-25', p?.expires);
  check('AHIP: a boundary given twice is drawn once', p?.rings.length === 1);
  check('AHIP: the project name tidied', p?.project === 'Works – Stage 1', p?.project);
  const clipped = mergeAhips([poly([sq(150.9, -33.1, 151.1, -32.9)], { AHIP: '9', Status: 'ACTIVE', Decision_D: '1/1/2020' })], { xmin: 151.0, ymin: -33.0, xmax: 151.01, ymax: -32.99 });
  check('AHIP: a long boundary is clipped to the strip', near(ringArea(clipped[0].rings[0]), 0.01 * 0.01, 1e-12), JSON.stringify(clipped[0].rings));
}

// ---- the lists and the maps ------------------------------------------------------------------

const boxes = { strip: { xmin: 151.0, ymin: -33.01, xmax: 151.05, ymax: -32.99 }, clip: { xmin: 150.99, ymin: -33.02, xmax: 151.06, ymax: -32.98 } };
{
  const nom = listPlaces('NHL', [poly([sq(150.5, -33.5, 151.5, -32.5)], { PLACE_ID: 106369, NAME: 'Rock Art', STATUS: 'Nominated place', AREA_HA: 507609.76 })], boxes);
  check('lists: a place round the whole strip covers it and keeps no outline', nom.length === 1 && nom[0].coversStrip && nom[0].rings.length === 0, JSON.stringify(nom));
  const rne = listPlaces('RNE', [
    poly([sq(151.01, -33.005, 151.012, -33.003)], { PLACE_ID: 1, NAME: 'Reserve', STATUS: 'Registered' }),
    poly([sq(151.02, -33.005, 151.022, -33.003)], { PLACE_ID: 2, NAME: 'Whale Site', STATUS: 'Rejected Place' }),
  ], boxes);
  check('lists: the RNE keeps a registered place and drops a rejected one', rne.length === 1 && rne[0].name === 'Reserve', JSON.stringify(rne.map((x) => x.name)));
  const nhl = listPlaces('NHL', [poly([sq(151.01, -33.005, 151.012, -33.003)], { PLACE_ID: 5, NAME: 'Hall', STATUS: 'Listed place', AREA_HA: 0.09, REGISTER_DATE: Date.UTC(2008, 4, 20) })], boxes);
  check('lists: a small place keeps its outline, size and listing date', nhl[0].rings.length === 1 && nhl[0].hectares === 0.09 && nhl[0].listed === '2008-05-20' && !nhl[0].coversStrip);
  const areas = mergeLepAreas([
    poly([sq(151.01, -33.005, 151.02, -33.0)], { EPI_NAME: 'Lake Macquarie Local Environmental Plan 2014', MAP_NAME: 'Sensitive Aboriginal Landscape Map', LAY_CLASS: 'Sensitive Aboriginal Landscape Area', CURRENCY_DATE: Date.UTC(2022, 9, 7) }),
    poly([sq(151.03, -33.005, 151.04, -33.0)], { EPI_NAME: 'Lake Macquarie Local Environmental Plan 2014', MAP_NAME: 'Sensitive Aboriginal Landscape Map', LAY_CLASS: 'Sensitive Aboriginal Landscape Area', CURRENCY_DATE: Date.UTC(2022, 9, 7) }),
  ], boxes);
  check('maps: one map\'s areas merge', areas.length === 1 && areas[0].rings.length === 2 && areas[0].currency === '2022-10-07', JSON.stringify(areas.map((a) => [a.map, a.rings.length])));
}
{
  const e = { xmin: 16_800_000, ymin: -4_000_000, xmax: 16_804_000, ymax: -3_998_000 };
  const b = stripBoxes(e);
  check('strip: the clip box holds the strip with a margin', b.clip.xmin < b.strip.xmin && b.clip.ymax > b.strip.ymax);
}

// ---- what the slide says -----------------------------------------------------------------

{
  // a made-up site: a 20 m square lot at the centre of a 4.7 by 1.6 km strip
  const centre = lonLatToMercator({ lon: 151.2, lat: -33.9 });
  const k = mercatorScaleFactor(-33.9);
  const ll = (dxM: number, dyM: number) => { const q = mercatorToLonLat({ x: centre.x + dxM * k, y: centre.y + dyM * k }); return [q.lon, q.lat]; };
  const sqM = (x0: number, y0: number, x1: number, y1: number) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
  const country: CountryData = {
    ...EMPTY_COUNTRY,
    ahips: { ok: true, permits: [
      { id: '100', project: 'Over the site', status: 'ACTIVE', expires: '2031-01-01', records: 1, rings: [sqM(-15, -15, 5, 15)], lon: 0, lat: 0 },
      { id: '200', project: 'Along the kerb', status: 'EXPIRED', expires: '2020-01-01', records: 1, rings: [sqM(10, -10, 40, 10)], lon: 0, lat: 0 },
      { id: '300', project: 'Down the road', status: 'ACTIVE', expires: '2020-06-01', records: 1, rings: [sqM(300, -10, 330, 10)], lon: 0, lat: 0 },
    ] },
    heritageLists: { read: { nhl: true, chl: true, rne: true }, places: [
      { list: 'NHL', id: '1', name: 'Rock Art', status: 'Nominated place', hectares: 507609.76, rings: [], coversStrip: true, lon: 0, lat: 0 },
      { list: 'RNE', id: '2', name: 'Old Reserve', status: 'Indicative Place', rings: [sqM(-600, 0, -500, 100)], coversStrip: false, lon: 0, lat: 0 },
    ] },
    lepAboriginalAreas: { ok: true, areas: [{ epi: 'Lake Macquarie Local Environmental Plan 2014', map: 'Sensitive Aboriginal Landscape Map', cls: 'Sensitive Aboriginal Landscape Area', rings: [sqM(-100, 200, 100, 300)], coversStrip: false }] },
  };
  const b = {
    country, generatedAt: '2026-09-29T00:00:00.000Z',
    panel: { center: centre, scale: 8000, wMm: 145, hMm: 95 },
    wide: { panel: { center: centre, scale: 16000, wMm: 296, hMm: 100 }, base: { water: { type: 'FeatureCollection', features: [] } } },
    siteLots: { type: 'FeatureCollection', features: [poly([sqM(-10, -10, 10, 10)], {})] },
    context: {}, constraints: {},
  } as unknown as SlidesBundle;
  const f = countryFacts(b);
  const byId = new Map(f.ahips.permits.map((p) => [p.id, p]));
  check('facts: a permit over half the lot is on the site', byId.get('100')?.onSite === true, JSON.stringify(byId.get('100')));
  check('facts: a permit that grazes the lot is at its edge, not on it', byId.get('200')?.onSite === false && byId.get('200')?.distanceM === 0, JSON.stringify(byId.get('200')));
  check('facts: a permit down the road is 290 m east', byId.get('300')?.distanceM === 290 && Math.abs((byId.get('300')?.bearing ?? 0) - 90) <= 5, JSON.stringify(byId.get('300')));
  check('facts: a permit past its expiry is not active, whatever its status', byId.get('300')?.active === false && byId.get('100')?.active === true);
  check('facts: the nomination round the strip takes in the site', f.lists.places.find((p) => p.list === 'NHL')?.onSite === true);
  check('facts: the landscape map 190 m north', f.lepAreas.areas[0]?.distanceM === 190 && Math.min(f.lepAreas.areas[0]?.bearing ?? 90, 360 - (f.lepAreas.areas[0]?.bearing ?? 90)) <= 5, JSON.stringify(f.lepAreas.areas[0]));
  const text = countrySentences(b, f).join(' ');
  check('text: the permit over the site is named first', /the site among it: Over the site \(AHIP 100, active to Jan 2031\)/.test(text), text);
  check('text: the grazing permit is at the site\'s edge', /Along the kerb \(AHIP 200, expired Jan 2020\) at the site's edge/.test(text), text);
  check('text: the nomination is not a listing', /The whole strip lies within the Rock Art, a nomination to the National Heritage List \(not a listing\) that takes in 5,076 km²\./.test(text), text);
  check('text: the RNE is an archive', /Register of the National Estate, closed in 2007 and kept as an archive with no statutory force, records Old Reserve \(indicative place, never assessed\)/.test(text), text);
  check('text: the landscape map and its provision', /The Lake Macquarie LEP 2014 maps land 190 m to the north as a Sensitive Aboriginal Landscape Area, where a local provision of the plan applies\./.test(text), text);
  // a deck cached before these layers says nothing of them
  const old = countrySentences({ ...b, country: { ...EMPTY_COUNTRY, ahips: undefined, heritageLists: undefined, lepAboriginalAreas: undefined } } as unknown as SlidesBundle, countryFacts({ ...b, country: { ...EMPTY_COUNTRY, ahips: undefined, heritageLists: undefined, lepAboriginalAreas: undefined } } as unknown as SlidesBundle)).join(' ');
  check('text: an older deck is silent on the new layers', !/Impact Permit|National Estate|Heritage List/.test(old), old);
}

if (failures.length) {
  console.error(`country heritage: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('country heritage: all checks passed');

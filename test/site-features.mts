/* The site sheet's trees, kerbside bays and sight lines, on made-up ground.
 *
 * Everything here is pure geometry: a tree's canopy from what was recorded
 * about it, bays set out along a street whose kerb is found from the lots
 * either side, and a line of sight tested against a terrain profile. None of
 * it asks anything of a network, so it can say exactly what a change broke.
 *
 *   npx tsx test/site-features.mts
 */

import { resolveCanopy, parseMetres, treeFromOsm, mergeTrees, type SiteTree } from '../src/fetch/trees.js';
import { parkingSide } from '../src/fetch/siteData.js';
import { buildParkingBands, vergeM } from '../src/lib/parking.js';
import { firstObstruction, bearingAndDistance, exitPoint, eyeAboveGround } from '../src/fetch/views.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A local metre grid around a Sydney latitude, through the library's own
// projection so the assertions see what the code sees.
const ORIGIN = lonLatToMercator({ lon: 151.2, lat: -33.9 });
const K = mercatorScaleFactor(-33.9);
const ll = (xM: number, yM: number): [number, number] => {
  const p = mercatorToLonLat({ x: ORIGIN.x + xM * K, y: ORIGIN.y + yM * K });
  return [p.lon, p.lat];
};
const local = ([lon, lat]: [number, number]) => {
  const m = lonLatToMercator({ lon, lat });
  return { x: (m.x - ORIGIN.x) / K, y: (m.y - ORIGIN.y) / K };
};

// ---- canopy from what is recorded ----------------------------------------
{
  const m = resolveCanopy({ canopyM: 9 });
  check('measured spread wins', m.canopyM === 9 && m.canopySource === 'measured');
  const h = resolveCanopy({ heightM: 12 });
  check('height gives 0.6× crown', near(h.canopyM, 7.2, 0.01) && h.canopySource === 'estimated');
  const d = resolveCanopy({ dbhCm: 40 });
  check('trunk gives 0.2 m per cm', near(d.canopyM, 8, 0.01) && d.canopySource === 'estimated');
  const n = resolveCanopy({});
  check('nothing recorded is nominal 6 m', n.canopyM === 6 && n.canopySource === 'nominal');
  check('parseMetres reads units', parseMetres('8 m') === 8 && parseMetres('800 cm') === 8 && parseMetres('abc') === undefined);
  const osm = treeFromOsm(151.2, -33.9, { natural: 'tree', circumference: '1.2', genus: 'Ficus' });
  check('OSM girth becomes a DBH and a crown', osm.canopySource === 'estimated' && near(osm.canopyM, 7.64, 0.05) && osm.species === 'Ficus',
    JSON.stringify(osm));
}

// ---- council trees take precedence over the same tree in OSM -------------
{
  const tree = (xy: [number, number], source: string): SiteTree => {
    const [lon, lat] = ll(...xy);
    return { lon, lat, canopyM: 6, canopySource: 'nominal', source };
  };
  const merged = mergeTrees([tree([0, 0], 'council')], [tree([2, 0], 'osm'), tree([50, 0], 'osm')]);
  check('OSM tree 2 m from a council tree is the same tree', merged.length === 2, `got ${merged.length}`);
  check('the council record is the one kept', merged[0].source === 'council' && merged[1].source === 'osm');
}

// ---- how OSM's two parking schemes read ----------------------------------
{
  const both = { 'parking:both': 'lane', 'parking:left:restriction': 'no_stopping' };
  check('a restriction on one side removes that side only',
    parkingSide(both, 'left')?.parked === false && parkingSide(both, 'right')?.parked === true);
  check('old scheme: the value is the orientation',
    parkingSide({ 'parking:lane:left': 'parallel' }, 'left')?.orientation === 'parallel');
  check('old scheme: no_stopping is no parking',
    parkingSide({ 'parking:lane:right': 'no_stopping' }, 'right')?.parked === false);
  check('untagged says nothing', parkingSide({}, 'left') === null);
  const perp = parkingSide({ 'parking:right': 'street_side', 'parking:right:orientation': 'perpendicular' }, 'right');
  check('new scheme carries orientation', perp?.parked === true && perp?.orientation === 'perpendicular');
}

// ---- bays along a street whose kerb the lots imply -----------------------
{
  // A 60 m street running east, lots 10 m either side: a 20 m reserve.
  const road: [number, number][] = [ll(0, 0), ll(60, 0)];
  const rect = (y0: number, y1: number) => [ll(-20, y0), ll(80, y0), ll(80, y1), ll(-20, y1), ll(-20, y0)];
  const lots = [rect(10, 40), rect(-10, -40)];
  check('verge scales with the reserve', near(vergeM(20), 3.6, 0.01) && vergeM(10) === 2.5 && vergeM(40) === 5);

  const [band] = buildParkingBands([{ coords: road, side: 'left' }], lots);
  check('one band on the left', band?.side === 'left' && band?.orientation === 'parallel');
  check('kerb is the reserve edge less a verge', near(band?.kerbM ?? 0, 6.4, 0.05), `kerb ${band?.kerbM}`);
  check('nine 6 m bays fit in 60 m', band?.bays.length === 9, `got ${band?.bays.length}`);
  const ys = band.bays.flat().map((c) => local(c).y);
  const xs = band.bays.flat().map((c) => local(c).x);
  check('bays sit between the kerb and 2.2 m inside it, north of the road',
    Math.min(...ys) > 4.1 && Math.max(...ys) < 6.5, `y ${Math.min(...ys).toFixed(2)}–${Math.max(...ys).toFixed(2)}`);
  check('bays stay within the run', Math.min(...xs) > 1 && Math.max(...xs) < 59);

  const withDrive = buildParkingBands([{ coords: road, side: 'left' }], lots, [[ll(30, 6), ll(30, 10)]]);
  check('a driveway takes out the bays it crosses', withDrive[0]?.bays.length === 7, `got ${withDrive[0]?.bays.length}`);

  // A cross street at x=30 empties the 10 m either side of it; the street's
  // own centreline, passed in with it, runs with the bays and changes nothing.
  const cross = buildParkingBands([{ coords: road, side: 'left' }], lots, [], [road, [ll(30, -50), ll(30, 50)]]);
  check('no bays at an intersection mouth', cross[0]?.bays.length === 6, `got ${cross[0]?.bays.length}`);
  const withSelf = buildParkingBands([{ coords: road, side: 'left' }], lots, [], [road]);
  check('the run itself is not a crossing', withSelf[0]?.bays.length === 9, `got ${withSelf[0]?.bays.length}`);

  // A lane between big parcels 30 m off, no road class: the close hits along
  // the lane must still win, so the kerb comes from the 3 m gap, not the median
  // of the far boundaries.
  const laneLots = [rect(3, 40), rect(-3, -40)];
  const [tight] = buildParkingBands([{ coords: road, side: 'left' }], laneLots);
  check('a narrow lane keeps its close kerb answer', near(tight?.kerbM ?? 0, 2.5, 0.01), `kerb ${tight?.kerbM}`);

  const twoSides = buildParkingBands([{ coords: road, side: 'both' }], lots);
  const south = twoSides.find((b) => b.side === 'right');
  const sys = south?.bays.flat().map((c) => local(c).y) ?? [];
  check('both sides gives a band each side', twoSides.length === 2 && Math.max(...sys) < -4.1 && Math.min(...sys) > -6.5);

  const [perp] = buildParkingBands([{ coords: road, side: 'left', orientation: 'perpendicular' }], lots);
  const pys = perp.bays.flat().map((c) => local(c).y);
  check('90° bays are 2.6 m along the kerb and 5.4 m deep', perp.bays.length === 21 && Math.min(...pys) > 0.9 && Math.max(...pys) < 6.5,
    `${perp.bays.length} bays, y ${Math.min(...pys).toFixed(2)}–${Math.max(...pys).toFixed(2)}`);

  const [narrow] = buildParkingBands([{ coords: road, side: 'left' }], [rect(7.5, 40), rect(-7.5, -40)]);
  check('a narrower reserve puts the kerb closer in', near(narrow?.kerbM ?? 0, 4.8, 0.05), `kerb ${narrow?.kerbM}`);

  // The centreline of a lane running through a big parcel: the ray finds a
  // boundary 30 m off, which no lane has. The road class bounds it.
  const [lane] = buildParkingBands([{ coords: road, side: 'left', highway: 'service' }], [rect(30, 60), rect(-30, -60)]);
  check('a service lane never puts the kerb 20 m out', near(lane?.kerbM ?? 0, 4, 0.01), `kerb ${lane?.kerbM}`);
  const [wide] = buildParkingBands([{ coords: road, side: 'left', highway: 'primary' }], [rect(30, 60), rect(-30, -60)]);
  check('an arterial keeps the cadastre answer', near(wide?.kerbM ?? 0, 14, 0.01), `kerb ${wide?.kerbM}`);
}

// ---- a sight line over the ground ---------------------------------------
{
  const flat = Array.from({ length: 101 }, (_, i) => ({ d: i * 100, z: 5 }));
  check('flat ground never blocks', firstObstruction(flat, 10_000, 14, 225) === null);
  const hill = (top: number) => flat.map((s) => (s.d === 2000 ? { d: s.d, z: top } : s));
  check('a hill above the line to the water blocks it', firstObstruction(hill(60), 4_000, 14, 0.5) === 2000);
  check('the same hill blocks a low skyline line', firstObstruction(hill(60), 10_000, 14, 225) === 2000);
  check('a lower hill under the line does not', firstObstruction(hill(50), 10_000, 14, 225) === null);
  const atSite = flat.map((s) => (s.d === 0 ? { d: 10, z: 99 } : s));
  check("the site's own ground is not an obstruction", firstObstruction(atSite, 10_000, 14, 225) === null);
  // Water is seen on its far side. A 5 m plateau with the bay 4 km off and
  // 3 km across: the line to the far shore runs high over the plateau. The
  // same plateau with a 30 m river: the line to the far bank dips into the
  // ground long before the water.
  const atShore = flat.map((s) => (s.d === 4000 ? { d: 3970, z: 3 } : s));
  check('a bay beyond a plateau is seen over the shoreline sample',
    firstObstruction(atShore, 7_000, 14, 0.5, { checkToM: 4_000 }) === null);
  check('a river across the same plateau is not', firstObstruction(atShore, 4_030, 14, 0.5, { checkToM: 4_000 }) !== null);
  check('the eye sits just under the height limit', eyeAboveGround(9.5) === 8.5 && eyeAboveGround(undefined) === 8 && eyeAboveGround(2) === 3);
}

// ---- bearings, and where a ray leaves the site --------------------------
{
  const bd = bearingAndDistance({ lon: 151.196, lat: -33.945 }, { lon: 151.2089, lat: -33.8705 });
  check('Botany to Sydney Tower is 8.4 km at about 8°', near(bd.distanceM, 8_370, 100) && bd.bearingDeg > 5 && bd.bearingDeg < 12,
    `${bd.distanceM.toFixed(0)} m, ${bd.bearingDeg.toFixed(1)}°`);
  const square = [ll(-10, -10), ll(10, -10), ll(10, 10), ll(-10, 10), ll(-10, -10)];
  const [clon, clat] = ll(0, 0);
  const east = local([exitPoint(square, { lon: clon, lat: clat }, 90).lon, exitPoint(square, { lon: clon, lat: clat }, 90).lat]);
  check('due east leaves a square at its east edge', near(east.x, 10, 0.05) && near(east.y, 0, 0.05), `(${east.x.toFixed(2)}, ${east.y.toFixed(2)})`);
  const ne = exitPoint(square, { lon: clon, lat: clat }, 45);
  const neL = local([ne.lon, ne.lat]);
  check('north-east leaves at the corner', near(neL.x, 10, 0.05) && near(neL.y, 10, 0.05));
}

if (failures.length) {
  console.error(`FAIL: ${failures.length} check(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('  ok — canopies, kerbside bays and sight lines behave');

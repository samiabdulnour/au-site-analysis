/* Sun and shadow at mid winter, on made-up blocks (lib/solarAccess.ts).
 *
 * Where the sun is on 21 June in Sydney, which prisms stand between a point
 * and it, the hours ADG 4A-1 asks by council, the apartments a scheme's
 * facades hold and the sun each gets, and the shadow a scheme adds to the
 * land round it. Nothing here asks a network.
 *
 *   npx tsx test/solar-access.mts
 */

import { winterSun, inSun, adgSunHours, apartmentSun, addedShadow, schemeBlocks, facadeSun, roofSun, QUARTER_HOURS, ON_THE_HOUR, type Block } from '../src/lib/solarAccess.js';
import { computeYield, ringArea, edgeKinds, type XY } from '../src/lib/yield.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const SYD = { lat: -33.87, lon: 151.21 };

// ---- the sun on 21 June ---------------------------------------------------------
{
  const q = winterSun(SYD.lat, SYD.lon);
  check('quarter hours: 24 of them, 9 to 3, the sun up for all', q.length === 24 && QUARTER_HOURS[0] === 547.5 && QUARTER_HOURS[23] === 892.5, String(q.length));
  const noon = winterSun(SYD.lat, SYD.lon, [12 * 60])[0];
  // Sydney's noon sun at the solstice: 90 − 33.87 − 23.44 ≈ 32.7°, a little east of north at 12:00 AEST (solar noon is about 11:55).
  check('noon: about 32.7° up, near north', near(noon.altitudeDeg, 32.7, 0.6) && (noon.azimuthDeg > 350 || noon.azimuthDeg < 10), JSON.stringify(noon));
  const nine = winterSun(SYD.lat, SYD.lon, [9 * 60])[0], three = winterSun(SYD.lat, SYD.lon, [15 * 60])[0];
  check('9 am: low in the north-east', nine.azimuthDeg > 35 && nine.azimuthDeg < 60 && nine.altitudeDeg > 10 && nine.altitudeDeg < 20, JSON.stringify(nine));
  check('3 pm: low in the north-west', three.azimuthDeg > 300 && three.azimuthDeg < 325 && three.altitudeDeg > 10 && three.altitudeDeg < 20, JSON.stringify(three));
  check('on the hour: seven instants', ON_THE_HOUR.length === 7 && winterSun(SYD.lat, SYD.lon, ON_THE_HOUR).length === 7);
}

// ---- rays ------------------------------------------------------------------------
{
  const noon = winterSun(SYD.lat, SYD.lon, [12 * 60])[0];
  const wall: Block = { rings: [rect(-20, 5, 20, 7)], z0: 0, z1: 10 };
  check('a wall to the north shades the ground behind it at noon', !inSun({ x: 0, y: 0, z: 0 }, noon, [wall]));
  check('far enough back, the sun clears its top', inSun({ x: 0, y: -20, z: 0 }, noon, [wall]));
  check('high enough, the sun clears its top', inSun({ x: 0, y: 0, z: 8 }, noon, [wall]));
  check('a wall to the south casts nothing north', inSun({ x: 0, y: 12, z: 0 }, noon, [wall]));
  check('a wall off to the side stands clear', inSun({ x: 40, y: 0, z: 0 }, noon, [wall]));
  // A block raised off the ground (a tier from storey 5): the line passes under it near, over it far.
  const raised: Block = { rings: [rect(-20, 5, 20, 25)], z0: 12, z1: 30 };
  // from under it, 10 m in, the line is 9.6 m up at its far edge: under its 12 m foot all the way
  check('a raised tier: the line passes under its foot', inSun({ x: 0, y: 10, z: 0 }, noon, [raised]));
  check('a raised tier shades a point whose line meets it', !inSun({ x: 0, y: -15, z: 0 }, noon, [raised]));
  // A courtyard is a hole: the ground in it is not inside the block, and its sunny side shades it.
  const court: Block = { rings: [rect(-20, -20, 20, 20), rect(-10, -10, 10, 10)], z0: 0, z1: 3 };
  check('a low courtyard: sun on the ground in the middle at noon', inSun({ x: 0, y: 0, z: 0 }, noon, [court]));
  const deep: Block = { ...court, z1: 20 };
  check('a deep courtyard: shade on the ground in the middle at noon', !inSun({ x: 0, y: 0, z: 0 }, noon, [deep]));
}

// ---- the hours ADG 4A-1 asks, by council -------------------------------------------
{
  for (const name of ['KU-RING-GAI', 'CITY OF PARRAMATTA', 'THE HILLS SHIRE', 'CANTERBURY-BANKSTOWN', 'HUNTERS HILL', 'SUTHERLAND SHIRE', 'SYDNEY'])
    check(`two hours in ${name}`, adgSunHours(name).hours === 2 && adgSunHours(name).known);
  check('two hours in Newcastle and Wollongong', adgSunHours('NEWCASTLE').hours === 2 && adgSunHours('WOLLONGONG').hours === 2);
  check('three hours elsewhere', adgSunHours('LAKE MACQUARIE').hours === 3 && adgSunHours('ORANGE').hours === 3 && adgSunHours('CENTRAL COAST').hours === 3);
  check('the council not known: two hours, said to be assumed', adgSunHours(undefined).hours === 2 && !adgSunHours(undefined).known);
}

// ---- the apartments on a bar running east–west --------------------------------------------
// A 60 × 30 m R4 lot fronting the south, 14.4 m: four storeys of a 48 × 18 m bar, 6 m off every boundary.
{
  const ring = rect(0, 0, 60, 30);
  const fronts = [true, false, false, false];
  const y = computeYield({ ring, fronts, siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 14.4 });
  const blank = edgeKinds(ring, fronts).map((k) => k !== 'front');
  const base = { boundary: ring, blank, ...SYD, hoursRequired: 2 };
  const open = apartmentSun(y, { ...base, context: [] })!;
  check('bar: every apartment the study counts is placed', !!open && open.total === y.units.total && y.units.total > 20, `${open?.total} of ${y.units.total}`);
  check('bar: each storey holds its share', !!open && [1, 2, 3, 4].every((s) => { const n = open.units.filter((u) => u.storey === s).length; return n >= Math.floor(y.units.total / 4) && n <= Math.ceil(y.units.total / 4); }));
  // which way each piece of facade faces: the edge's direction, and the plate on its other side
  const plate = y.tiers[0].plate;
  const facing = (pc: { ring: number; edge: number }) => {
    const rg = plate[pc.ring], p = rg[pc.edge], q = rg[(pc.edge + 1) % rg.length];
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    if (Math.abs(q.y - p.y) < 0.5) return my > 15 ? 'north' : 'south';
    return mx > 30 ? 'east' : 'west';
  };
  const faces = (u: { pieces: { ring: number; edge: number }[] }) => new Set(u.pieces.map(facing));
  const lengthOn = (u: { pieces: { ring: number; edge: number; t0: number; t1: number }[] }, side: string) => u.pieces.filter((pc) => facing(pc) === side).reduce((t, pc) => {
    const rg = plate[pc.ring], p = rg[pc.edge], q = rg[(pc.edge + 1) % rg.length];
    return t + (pc.t1 - pc.t0) * Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
  // a metre of facade is what the sun is looked for on: a sliver round a corner does not count
  const northern = open.units.filter((u) => lengthOn(u, 'north') >= 1.01);
  const southOnly = open.units.filter((u) => faces(u).size === 1 && faces(u).has('south'));
  check('bar: with nothing round it, a north face has the sun all six hours', northern.length > 0 && northern.every((u) => u.hours === 6), northern.map((u) => u.hours).join(','));
  check('bar: a south face alone has none', southOnly.length > 0 && southOnly.every((u) => u.hours === 0), southOnly.map((u) => u.hours).join(','));
  const eastOnly = open.units.filter((u) => faces(u).size === 1 && faces(u).has('east'));
  check('bar: an east face alone has the morning', eastOnly.every((u) => u.hours >= 2 && u.hours < 4), eastOnly.map((u) => u.hours).join(','));
  check('bar: the counts add up', open.meeting === open.units.filter((u) => u.hours >= 2).length && open.none === open.units.filter((u) => u.hours === 0).length);
  check('bar: about half meet two hours, the south side does not', open.meeting / open.total > 0.4 && open.meeting / open.total < 0.85 && open.none > 0, `${open.meeting}/${open.total}, none ${open.none}`);
  // a tower over the lot's northern boundary takes the north face's sun
  const tower: Block = { rings: [rect(0, 32, 60, 50)], z0: 0, z1: 45 };
  const shaded = apartmentSun(y, { ...base, context: [tower] })!;
  check('bar: a tower to the north cuts the apartments meeting the hours', shaded.meeting < open.meeting, `${shaded.meeting} vs ${open.meeting}`);
  // the same tower as a future: today's figure stands, the future's falls
  const both = apartmentSun(y, { ...base, context: [], future: [tower] })!;
  check('bar: a neighbour\'s future is counted apart', both.meeting === open.meeting && !!both.future && both.future.meeting === shaded.meeting && both.units.every((u) => u.hoursFuture !== undefined),
    JSON.stringify({ today: both.meeting, future: both.future }));
  // three hours asked: fewer meet
  const three = apartmentSun(y, { ...base, hoursRequired: 3, context: [] })!;
  check('bar: three hours asked, fewer meet', three.meeting < open.meeting, `${three.meeting} vs ${open.meeting}`);
  check('bar: no apartments, no study', apartmentSun({ ...y, units: { ...y.units, total: 0 } }, { ...base, context: [] }) === undefined);
}

// ---- the sun on each face of the bar, cell by cell ---------------------------------------------
{
  const ring = rect(0, 0, 60, 30);
  const fronts = [true, false, false, false];
  const y = computeYield({ ring, fronts, siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 14.4 });
  const faces = facadeSun(y, { context: [], ...SYD, boundary: ring, blank: edgeKinds(ring, fronts).map((k) => k !== 'front') });
  const facing = (b: number) => faces.filter((f) => Math.abs(((f.bearing - b + 540) % 360) - 180) < 10);
  check('faces: four, each a storey high cell by cell, about 3 m wide', faces.length === 4 && faces.every((f) => f.cells.length === 4 * Math.max(1, Math.round(f.lengthM / 3))), String(faces.length));
  check('faces: the north face has the sun all six hours, every cell', facing(0).length === 1 && facing(0)[0].cells.every((c) => c.hours === 6));
  check('faces: the south face none', facing(180).length === 1 && facing(180)[0].cells.every((c) => c.hours === 0));
  check('faces: the east face the morning', facing(90).length === 1 && facing(90)[0].cells.every((c) => c.hours >= 2 && c.hours < 4), JSON.stringify(facing(90)[0]?.cells.map((c) => c.hours)));
  check('faces: seen from outside, the building is on the left of a to b', faces.every((f) => (f.b.y - f.a.y) * f.normal.x - (f.b.x - f.a.x) * f.normal.y > 0));
  // a 12 m building 8 m to the north: the north face loses its lower storeys' sun, the top keeps some
  const shadedFaces = facadeSun(y, { context: [{ rings: [rect(0, 32, 60, 40)], z0: 0, z1: 12 }], ...SYD, boundary: ring, blank: edgeKinds(ring, fronts).map((k) => k !== 'front') });
  const north = shadedFaces.find((f) => Math.abs(((f.bearing + 540) % 360) - 180) < 10)!;
  const byStorey = (st: number) => north.cells.filter((c) => c.storey === st).reduce((t, c) => t + c.hours, 0);
  check('faces: a tower to the north shades the lower storeys more', byStorey(1) < byStorey(4), `${byStorey(1)} vs ${byStorey(4)}`);
}

// ---- the sun on the roofs ---------------------------------------------------------------------
{
  // the 40 × 50 m R4 lot at 22 m and 1.5:1 steps back over its fourth storey: the lower roof is the setback's ring
  const ring = rect(0, 0, 40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 22 });
  const roofs = roofSun(y, { context: [], ...SYD });
  const builtTiers = y.tiers.filter((tt) => Math.min(tt.to, y.storeys) >= tt.from);
  const topPlate = builtTiers[builtTiers.length - 1].plateSqm, lowPlate = builtTiers[0].plateSqm;
  const area = (k: number) => roofs.filter((r) => r.tier === k).reduce((s, r) => s + r.areaSqm, 0);
  check('roofs: the top tier\'s whole plate is roof', near(area(builtTiers.length - 1), topPlate, topPlate * 0.03), `${area(builtTiers.length - 1)} vs ${topPlate}`);
  // what the tier above leaves open: less than the plate, no less than the plate less the tier above's (which may reach over a courtyard)
  check('roofs: a lower tier\'s roof is what the tier above leaves open', builtTiers.length > 1 && area(0) < lowPlate - 1 && area(0) >= lowPlate - y.tiers[1].plateSqm - 1, `${area(0)} of ${lowPlate}, the tier above ${y.tiers[1].plateSqm}`);
  check('roofs: with nothing round, the top roof has the sun all six hours', roofs.filter((r) => r.tier === builtTiers.length - 1).every((r) => r.hours === 6));
  check('roofs: the setback\'s roof by the tier above has less', roofs.filter((r) => r.tier === 0).some((r) => r.hours < 6));
}

// ---- shop-top housing: no window on a wall built to a side boundary -------------------------
{
  const ring = rect(0, 0, 30, 40);
  const fronts = [true, false, false, false];
  const y = computeYield({ ring, fronts, siteAreaSqm: ringArea(ring), zone: 'MU1', hobM: 16 });
  const blank = edgeKinds(ring, fronts).map((k) => k !== 'front');
  const sun = apartmentSun(y, { boundary: ring, blank, ...SYD, hoursRequired: 2, context: [] })!;
  const podium = y.tiers.findIndex((t) => /Podium/.test(t.name));
  const onPodium = sun.units.filter((u) => u.tier === podium);
  check('shop-top: no apartment on the shops', !sun.units.some((u) => u.storey === 1));
  check('shop-top: the podium\'s apartments face the street and the rear, not the side walls', onPodium.length > 0 && onPodium.every((u) => u.pieces.every((pc) => {
    const rg = y.tiers[podium].plate[pc.ring], p = rg[pc.edge], q = rg[(pc.edge + 1) % rg.length];
    return Math.abs(q.y - p.y) < 0.5;
  })), JSON.stringify(onPodium.slice(0, 2)));
}

// ---- the shadow a scheme adds ---------------------------------------------------------------
{
  const site = rect(0, 0, 20, 20);
  const scheme: Block[] = [{ rings: [site], z0: 0, z1: 40 }];
  const home = { kind: 'home' as const, rings: [rect(0, -16, 20, -1)] };
  const park = { kind: 'park' as const, rings: [rect(0, 30, 40, 60)] };
  const base = { scheme, standing: [], context: [], roofs: [], site, targets: [home, park], ...SYD, hoursRequired: 2 };
  const sh = addedShadow(base);
  check('shadow: the lot to the south is shaded at noon', sh.hours.find((h) => h.clockMin === 720)!.added.home > 200, JSON.stringify(sh.hours.map((h) => h.added.home)));
  check('shadow: nothing reaches the park to the north', sh.reached.park === 0 && sh.peak.park === null && sh.hours.every((h) => h.added.park === 0));
  check('shadow: the home lot is touched, and loses its two hours', sh.homes.touched === 1 && sh.homes.fallBelow === 1, JSON.stringify(sh.homes));
  check('shadow: the peak is the most of any hour', sh.peak.home !== null && sh.peak.home.sqm === Math.max(...sh.hours.map((h) => h.added.home)));
  // what stands today with the same bulk: no shadow added
  const same = addedShadow({ ...base, standing: scheme });
  check('shadow: replacing what stands with the same bulk adds none', same.hours.every((h) => h.added.home === 0) && same.homes.touched === 0, JSON.stringify(same.hours.map((h) => h.added.home)));
  // a tall neighbour already shading the lot: little or nothing to add
  const wall: Block = { rings: [rect(-5, -0.8, 25, -0.2)], z0: 0, z1: 60 };
  const behind = addedShadow({ ...base, context: [wall] });
  check('shadow: ground already in shadow is not added to', behind.hours.find((h) => h.clockMin === 720)!.added.home === 0, String(behind.hours.find((h) => h.clockMin === 720)!.added.home));
  // the ground under a neighbour's roof is not open ground
  const roofed = addedShadow({ ...base, roofs: [rect(0, -16, 20, -1)] });
  check('shadow: a lot all roof has no open ground to shade', roofed.homes.touched === 0 && roofed.hours.every((h) => h.added.home === 0));
  check('shadow: no scheme, no shadow', addedShadow({ ...base, scheme: [] }).hours.every((h) => h.added.home === 0));
}

// ---- the scheme's prisms --------------------------------------------------------------------
{
  const ring = rect(0, 0, 40, 50);
  const y = computeYield({ ring, fronts: [true, false, false, false], siteAreaSqm: ringArea(ring), zone: 'R4', hobM: 22, fsr: 1.5 });
  const blocks = schemeBlocks(y);
  check('prisms: one a built tier, stacked without a gap', blocks.length >= 1 && blocks.every((b, i) => i === 0 ? b.z0 === 0 : near(b.z0, blocks[i - 1].z1, 1e-9)), JSON.stringify(blocks.map((b) => [b.z0, b.z1])));
  check('prisms: no higher than the storeys built', near(blocks[blocks.length - 1].z1, 3.1 * y.storeys, 1e-9), `${blocks[blocks.length - 1].z1} vs ${y.storeys}`);
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('solar access: all checks pass');

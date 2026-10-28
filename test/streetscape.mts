/* The streetscape's geometry on a made-up street: which property fronts each
 * stretch of either side, the gap a cross street leaves and its name, the
 * site's stretch, which way each face reads for a viewer in the street, and
 * the homography that rectifies a frame onto a face — checked by sending
 * points of the face through it and back. No network: CI never calls Google.
 *
 *   npx tsx test/streetscape.mts
 */

import { planStreetscape, planeToImage, inv3, mul3, apply3, tiersFor, choosePanoramas, leafOff, assignStrips, splitAddress, CAMERA_HEIGHT_M, BELOW_GROUND_M, FRAME_PX, type Property } from '../src/fetch/streetscape.js';
import type { LonLat } from '../src/lib/geo.js';
import { roofSteps } from '../src/render/streetscape.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A metre grid about a Sydney point.
const O: LonLat = { lon: 151.2, lat: -33.9 };
const KX = 111_320 * Math.cos((O.lat * Math.PI) / 180), KY = 110_574;
const ll = (x: number, y: number): [number, number] => [O.lon + x / KX, O.lat + y / KY];
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];

// Test Street runs north from y = −150 to 150 down x = 0, its reserve 20 m wide. Each side is a row of lots
// 10 m along it and 30 m deep, from y = −120 to 120, but for Cross Street, 12 m wide, which comes in from
// the west at y = −40…−28. The site is the two lots east of the street from y = −10 to 10.
const props: Property[] = [];
for (let y = -120; y < 120; y += 10) {
  const n = (y + 120) / 10;
  props.push({ id: `e${n}`, address: `${100 + 2 * n} TEST STREET SOMEWHERE`, housenumber: String(100 + 2 * n), rings: [rect(10, y, 40, y + 10)] });
  if (y >= -40 && y < -28) continue;
  props.push({ id: `w${n}`, address: `${101 + 2 * n} TEST STREET SOMEWHERE`, housenumber: String(101 + 2 * n), rings: [rect(-40, y, -10, y + 10)] });
}
// a lot of the cross street's own, its corner, addressed to it
props.push({ id: 'c', address: '1-3 CROSS STREET SOMEWHERE', housenumber: '1-3', rings: [rect(-40, -28, -10, -20)] });
const plan = planStreetscape({
  street: 'TEST STREET', segments: [[ll(0, -150), ll(0, 150)]], centre: O, halfLengthM: 90,
  siteRings: [rect(10, -10, 40, 10)], properties: props,
  roads: [{ name: 'TEST STREET', coords: [ll(0, -150), ll(0, 150)] }, { name: 'CROSS STREET', coords: [ll(0, -34), ll(-200, -34)] }, { name: 'DEEP TUNNEL', coords: [ll(-100, 60), ll(100, 60)], tunnel: true }],
});

check('a plan is drawn', plan !== null);
if (plan) {
  check('the window runs 90 m either way of the site', plan.s0 === -90 && plan.s1 === 90, `${plan.s0}…${plan.s1}`);
  check('two faces, the site\'s first', plan.faces.length === 2 && plan.faces[0].hasSite && !plan.faces[1].hasSite);
  const [east, west] = plan.faces;
  check('the site\'s face is the east side, seen looking east', near(east.facing, 90, 1), String(east.facing));
  // s runs north; looking east the viewer's right is south, so the east face reads against s and the west face with it
  check('the east face reads north to south, the west face south to north', !east.sRightward && west.sRightward);
  check('the building line is the boundary, 10 m off the axis', near(east.offsetM, 10, 0.2) && near(west.offsetM, 10, 0.2), `${east.offsetM} / ${west.offsetM}`);
  check('the site\'s stretch is its two lots', !!plan.site && near(plan.site.s0, -10, 1) && near(plan.site.s1, 10, 1), JSON.stringify(plan.site));
  const siteFronts = east.frontages.filter((f) => f.site);
  check('two frontages are the site\'s', siteFronts.length === 2, String(siteFronts.length));
  check('each lot is one frontage, 10 m long', east.frontages.every((f) => f.s0 < -89 || f.s1 > 89 || near(f.s1 - f.s0, 10, 1.1)), east.frontages.map((f) => (f.s1 - f.s0).toFixed(1)).join(' '));
  check('a frontage carries its number and street apart', east.frontages.some((f) => f.number === '124' && f.street === 'TEST STREET' && f.address === '124 TEST STREET'));
  check('no gap on the east side, where no road comes in', east.gaps.length === 0, JSON.stringify(east.gaps));
  const gap = west.gaps.find((g) => g.s0 < -34 && g.s1 > -34);
  check('Cross Street leaves a gap in the west side', !!gap && near(gap.s0, -40, 1) && near(gap.s1, -28, 1), JSON.stringify(west.gaps));
  check('the gap is named for the road that comes in, though it runs along the ray', gap?.road === 'CROSS STREET', gap?.road);
  check('a tunnel names no gap', !plan.faces.some((f) => f.gaps.some((g) => g.road === 'DEEP TUNNEL')));
  check('the corner lot fronts the street, addressed to its own', west.frontages.some((f) => f.address === '1-3 CROSS STREET'));
  check('the ground is left for the elevation model', east.ground.length === 0);

  // a camera in the middle of the road, 10 m off the east face, must see from the footpath below the boundary to 30 m over it
  const zc = 20 + CAMERA_HEIGHT_M;
  const tiers = tiersFor(10, zc, 20 - BELOW_GROUND_M, 20 + 30)!;
  const deg = (v: number) => (v * Math.PI) / 180;
  check('a camera 10 m off its face takes it in one frame', tiers.length === 1 && tiers[0].fov >= 100 && tiers[0].fov <= 120, JSON.stringify(tiers));
  check('the picture\'s foot takes in the footpath below the ground at the boundary, with room for the marks along it',
    tiers[0].pitch - tiers[0].fov / 2 < -(Math.atan2(CAMERA_HEIGHT_M + BELOW_GROUND_M, 10) * 180) / Math.PI - 4, String(tiers[0].pitch));
  check('and its top reaches the band\'s top', 10 * Math.tan(deg(tiers[0].pitch + tiers[0].fov / 2)) + zc >= 20 + 30, String(tiers[0].pitch + tiers[0].fov / 2));
  const narrow = tiersFor(4, zc, 20 - BELOW_GROUND_M, 20 + 30)!;
  check('a narrow lane takes two frames, the low one at the footpath and the high one at the band\'s top', narrow.length === 2 && narrow[0].tier === 0 && narrow[1].tier === 1
    && narrow[0].pitch - narrow[0].fov / 2 < -(Math.atan2(CAMERA_HEIGHT_M + BELOW_GROUND_M, 4) * 180) / Math.PI && 4 * Math.tan(deg(Math.min(88, narrow[1].pitch + narrow[1].fov / 2))) + zc >= 20 + 30, JSON.stringify(narrow));
  check('the two frames overlap', narrow[0].pitch + narrow[0].fov / 2 > narrow[1].pitch - narrow[1].fov / 2);
  check('a camera on the footpath cannot frame its face', tiersFor(2, zc, 18.8, 50) === null);
  const aim = { heading: east.facing, pitch: tiers[0].pitch, fov: tiers[0].fov };
  const fr = { s: 4, d: 0, z: 20 + CAMERA_HEIGHT_M, heading: aim.heading, pitch: aim.pitch, fov: aim.fov, planeM: 10, side: -1 as const };
  const H = planeToImage(plan, fr);
  // the point of the face straight ahead at the camera's height is on the picture's middle column, f·tan(pitch) below its middle
  const f = FRAME_PX / 2 / Math.tan(((fr.fov / 2) * Math.PI) / 180);
  const [u, v] = apply3(H, 4, fr.z);
  check('straight ahead is the middle column', near(u, FRAME_PX / 2, 0.01), String(u));
  check('the horizon sits below the middle by the tip', near(v, FRAME_PX / 2 + f * Math.tan((fr.pitch * Math.PI) / 180), 0.01), String(v));
  // north is to the left looking east: s increasing (north) moves left in the picture
  check('north is on the left looking east', apply3(H, 8, fr.z)[0] < u);
  // a metre along the face at 10 m, at the camera's height, is f / (10 cos pitch) pixels: the tipped camera sees it nearer
  check('a metre at 10 m is the focal length over its depth', near(u - apply3(H, 5, fr.z)[0], f / (10 * Math.cos((fr.pitch * Math.PI) / 180)), 0.01));
  // and back: every point of the face comes back off the picture where it was
  const back = inv3(H);
  let worst = 0;
  for (const [s, z] of [[0, 15], [8, 30], [-3, 21], [2.5, 18.2]]) { const [uu, vv] = apply3(H, s, z); const [s2, z2] = apply3(back, uu, vv); worst = Math.max(worst, Math.hypot(s2 - s, z2 - z)); }
  check('the face comes back off the picture', worst < 1e-6, String(worst));
  const I = mul3(H, back);
  check('the homography and its inverse make the identity', I.every((r, i) => r.every((x, j) => near(x / I[2][2], i === j ? 1 : 0, 1e-9))));
}

// strips: halfway between neighbours, no wider than a frame holds, inside the window
const strips = assignStrips([{ s: 0, halfM: 8 }, { s: 10, halfM: 8 }, { s: 40, halfM: 8 }], -5, 45);
check('neighbouring strips meet halfway', near(strips[0].b, 5, 1e-9) && near(strips[1].a, 5, 1e-9));
check('a strip ends where its frame does, past a gap in the cameras', near(strips[1].b, 18, 1e-9) && near(strips[2].a, 32, 1e-9));
check('strips stay inside the window', near(strips[0].a, -5, 1e-9) && near(strips[2].b, 45, 1e-9));

// which panoramas are kept: by 6 m bins, the newest year's and the barest other drives, one each
check('July is bare, May and September half so, October not', leafOff('2015-07') === 2 && leafOff('2014-05') === 1 && leafOff('2019-09') === 1 && leafOff('2024-10') === 0);
const drives = [['2024-10', 0], ['2024-10', 3], ['2021-03', 1], ['2015-07', 2], ['2013-10', 1], ['2009-11', 2], ['2024-10', 7], ['2015-07', 8]].map(([date, s], i) => ({ id: i, date: date as string, s: s as number }));
const chosen = choosePanoramas(drives, 0);
check('the newest year\'s panoramas are all kept', chosen.filter((p) => p.date === '2024-10').length === 3, JSON.stringify(chosen));
check('the bare July drive is kept beside them, once a bin', chosen.filter((p) => p.date === '2015-07' && p.s < 6).length === 1 && chosen.some((p) => p.date === '2015-07' && p.s >= 6));
check('then the newest of the rest, and no more than three drives a bin', chosen.some((p) => p.date === '2021-03') && !chosen.some((p) => p.date === '2013-10' || p.date === '2009-11'), JSON.stringify(chosen));
check('over the cap the other drives go first', choosePanoramas(drives, 0, 3).every((p) => p.date === '2024-10'));
check('the kept panoramas come back in order along the street', chosen.every((p, i) => !i || p.s >= chosen[i - 1].s));

check('an address splits into its number and street', JSON.stringify(splitAddress('70-76 RILEY STREET DARLINGHURST', '70-76')) === JSON.stringify({ number: '70-76', street: 'RILEY STREET' }));
check('a suffixed number keeps its letter', splitAddress('111A RILEY STREET DARLINGHURST').number === '111A');

// a frontage's roofline in steps: metres of building tops over a flat ground at 30
{
  const at = (s: number, h: number) => ({ s, z: 30 + h, g: 30 });
  // 12 m at 10 m with a one-metre chimney, then 8 m at 16 m with a two-metre sliver at 14 m between
  const pts = [...Array.from({ length: 12 }, (_, i) => at(i + 0.5, i === 5 ? 14 : 10)), at(12.5, 14), at(13.5, 14), ...Array.from({ length: 8 }, (_, i) => at(i + 14.5, 16))];
  const [b1, ...more] = roofSteps(pts);
  check('one building, its steps', !!b1 && !more.length && b1.length === 2, JSON.stringify(roofSteps(pts)));
  check('a chimney is passed over', !!b1 && near(b1[0].z, 40, 1e-9) && near(b1[0].s0, 0, 1e-9));
  check('a sliver folds into the step nearer its height', !!b1 && near(b1[1].s0, 12, 1e-9) && near(b1[1].z, 46, 1e-9) && near(b1[1].s1, 22, 1e-9), JSON.stringify(b1));
  // an open yard between two buildings, and a low wall, split them
  const two = roofSteps([...Array.from({ length: 6 }, (_, i) => at(i + 0.5, 9)), at(6.5, 1), at(7.5, 1.2), ...Array.from({ length: 6 }, (_, i) => at(i + 8.5, 9))]);
  check('a yard parts two buildings', two.length === 2 && near(two[0][0].s1, 6, 1e-9) && near(two[1][0].s0, 8, 1e-9), JSON.stringify(two));
  check('nothing standing is no building', roofSteps([at(0.5, 1), at(1.5, 2)]).length === 0);
}

if (failures.length) {
  console.error(`streetscape: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('streetscape: all checks passed');

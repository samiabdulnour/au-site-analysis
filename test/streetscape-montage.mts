/* The streetscape's montage on a made-up street: a row of buildings on the
 * east side of a north-running street, photographed from the centreline every
 * 6 m on two dates, the newer with a tree in front of one building, the older
 * bare and darker; the frames drawn here as the pinhole pictures Street View
 * would give (the same homography, forwards), and composed by
 * src/py/streetscape_montage.py through src/render/montage.ts. Checked: the
 * picture is the facade at true scale, the sky is gone from over the roofs,
 * the tree is seen through from the bare year, the two years' exposures
 * meet, and the footpath is kept below the ground line and nothing below it.
 * Needs python3 with Pillow and NumPy; no network.
 *
 *   npx tsx test/streetscape-montage.mts
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planStreetscape, tiersFor, CAMERA_HEIGHT_M, BELOW_GROUND_M, type Property, type ScapeFrame } from '../src/fetch/streetscape.js';
import { composeMontages } from '../src/render/montage.js';
import { encodeRgbaPng, decodePng } from '../src/lib/png.js';
import type { LonLat } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// The street of test/streetscape.mts: north down x = 0, lots 10 m along and 30 m deep either side, the site east.
const O: LonLat = { lon: 151.2, lat: -33.9 };
const KX = 111_320 * Math.cos((O.lat * Math.PI) / 180), KY = 110_574;
const ll = (x: number, y: number): [number, number] => [O.lon + x / KX, O.lat + y / KY];
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
const props: Property[] = [];
for (let y = -120; y < 120; y += 10) {
  const n = (y + 120) / 10;
  props.push({ id: `e${n}`, address: `${100 + 2 * n} TEST STREET SOMEWHERE`, housenumber: String(100 + 2 * n), rings: [rect(10, y, 40, y + 10)] });
  props.push({ id: `w${n}`, address: `${101 + 2 * n} TEST STREET SOMEWHERE`, housenumber: String(101 + 2 * n), rings: [rect(-40, y, -10, y + 10)] });
}
const plan = planStreetscape({
  street: 'TEST STREET', segments: [[ll(0, -150), ll(0, 150)]], centre: O, halfLengthM: 90,
  siteRings: [rect(10, -10, 40, 10)], properties: props, roads: [{ name: 'TEST STREET', coords: [ll(0, -150), ll(0, 150)] }],
})!;
const east = plan.faces.find((f) => f.side === -1)!;
const ground = (s: number) => 20 + 0.02 * s;
for (const f of plan.faces) for (let s = plan.s0; s <= plan.s1; s++) f.ground.push({ s, z: ground(s) });
const OFFSET = east.offsetM;
const PX = 480;

// ---- the scene -------------------------------------------------------------------------
// Buildings 10 m wide from s = −90, each its height and colour, windows on a grid, a parapet line; sky over
// them, paler toward the horizon; the footpath and the road under the ground line.
const HTS = [7, 10, 13, 8, 11, 9, 12, 7, 10, 14, 8, 9, 11, 10, 8, 12, 9, 7];
const COLS: [number, number, number][] = [[200, 170, 140], [180, 150, 130], [220, 210, 190], [150, 120, 110], [230, 190, 150], [190, 190, 180], [170, 140, 120], [210, 200, 170], [160, 130, 120], [240, 230, 210], [200, 160, 130], [180, 170, 160], [210, 180, 150], [190, 160, 140], [215, 205, 180], [165, 135, 125], [225, 195, 160], [185, 175, 165]];
const block = (s: number) => Math.max(0, Math.min(HTS.length - 1, Math.floor((s + 90) / 10)));
const roof = (s: number) => ground(s) + HTS[block(s)];
function facade(s: number, z: number): [number, number, number] {
  const g = ground(s), top = roof(s);
  if (z > top) { const t = Math.max(0, Math.min(1, (z - g) / 40)); return [140 + 60 * (1 - t), 185 + 40 * (1 - t), 235]; }
  if (z < g - 0.3) return [90, 90, 92];
  if (z < g) return [150, 148, 145];
  if (top - z < 0.3) return [90, 80, 70];
  const wx = ((s + 90) % 2.5 + 2.5) % 2.5, wz = ((z - g - 1.0) % 3.2 + 3.2) % 3.2;
  if (wx > 0.6 && wx < 1.8 && wz > 0.4 && wz < 2.0 && z - g > 1.0 && z < top - 0.5) return [40, 50, 70];
  return COLS[block(s)];
}
const TREE = { s: -15, z: ground(-15) + 7, r: 4, depthM: 4 };

/** A pinhole picture from `cam` of the scene: rays through the tree's plane first, then the boundary's. */
function render(cam: { s: number; d: number; z: number; heading: number; pitch: number; fov: number }, tree: boolean, gain: number): Buffer {
  const th = (cam.heading * Math.PI) / 180, ph = (cam.pitch * Math.PI) / 180;
  const fwd = [Math.sin(th) * Math.cos(ph), Math.cos(th) * Math.cos(ph), Math.sin(ph)];
  const right = [Math.cos(th), -Math.sin(th), 0];
  const up = [-Math.sin(th) * Math.sin(ph), -Math.cos(th) * Math.sin(ph), Math.cos(ph)];
  const f = PX / 2 / Math.tan(((cam.fov / 2) * Math.PI) / 180);
  // world: x east, y north; d is to the left of a north-running axis, so x = −d
  const C = [-cam.d, cam.s, cam.z];
  const px = new Uint8Array(PX * PX * 4);
  for (let v = 0; v < PX; v++) for (let u = 0; u < PX; u++) {
    const a = (u + 0.5 - PX / 2) / f, b = -(v + 0.5 - PX / 2) / f;
    const q = [fwd[0] + right[0] * a + up[0] * b, fwd[1] + right[1] * a + up[1] * b, fwd[2] + right[2] * a + up[2] * b];
    let c: [number, number, number] = [120, 120, 120];
    if (q[0] > 1e-6) {
      const t = (OFFSET - C[0]) / q[0];
      c = facade(C[1] + t * q[1], C[2] + t * q[2]);
      if (tree) {
        const t2 = (OFFSET - TREE.depthM - C[0]) / q[0];
        const ps = C[1] + t2 * q[1], pz = C[2] + t2 * q[2];
        if ((ps - TREE.s) ** 2 + (pz - TREE.z) ** 2 < TREE.r ** 2) { const w = 20 * Math.sin(ps * 7); c = [40 + w, 110 + w, 50 + w]; }
        else if (Math.abs(ps - TREE.s) < 0.25 && pz < TREE.z && pz > TREE.z - 12) c = [70, 55, 40];
      }
    }
    if (v >= PX - 16) c = [255, 255, 255]; // the band of marks along the foot
    const i = (v * PX + u) * 4;
    px[i] = Math.min(255, c[0] * gain); px[i + 1] = Math.min(255, c[1] * gain); px[i + 2] = Math.min(255, c[2] * gain); px[i + 3] = 255;
  }
  return encodeRgbaPng(PX, PX, px);
}

const dir = mkdtempSync(join(tmpdir(), 'montage-'));
const frames: ScapeFrame[] = [];
const zTopCapture = Math.max(...east.ground.map((g) => g.z)) + 30;
for (const [date, withTree, shift, gain] of [['2024-10', true, 0, 1], ['2021-07', false, 2, 0.85]] as const) {
  for (let s = -108 + shift; s <= 108; s += 6) {
    const zc = ground(s) + CAMERA_HEIGHT_M;
    for (const t of tiersFor(OFFSET - 0.3, zc, ground(s) - BELOW_GROUND_M, zTopCapture)!) {
      const cam = { s, d: -0.3, z: zc, heading: east.facing, pitch: t.pitch, fov: t.fov };
      const file = `frame_${frames.length + 1}.png`;
      writeFileSync(join(dir, file), render(cam, withTree, gain));
      frames.push({ side: -1, file, panoId: `${date}@${s}`, date, s, d: cam.d, z: zc, heading: cam.heading, pitch: t.pitch, fov: t.fov, planeM: OFFSET, a: 0, b: 0, tier: t.tier, px: PX });
    }
  }
}
check('the test street is one frame a camera', frames.every((fr) => fr.tier === 0), `${frames.filter((fr) => fr.tier).length} high frames`);

const notes: string[] = [];
const montages = await composeMontages(plan, frames, dir, { reachM: 30, log: (m) => notes.push(m) });
check('the montage is drawn (python3 with Pillow and NumPy)', montages !== null, notes.join(' | '));
if (montages) {
  const m = montages[plan.faces.indexOf(east)];
  const other = montages[plan.faces.indexOf(plan.faces.find((f) => f !== east)!)];
  check('the east face has its montage and the west, with no frames, none', !!m && other === null);
  if (m) {
    check('the picture spans the window at 24 pixels a metre', m.width === Math.round((plan.s1 - plan.s0) * 24) && m.ppm === 24, `${m.width} px`);
    check('looking east, north is on the left', m.sAtLeft === plan.s1 && m.sAtRight === plan.s0);
    check('every column is reached', m.columnsCovered >= 0.98, String(m.columnsCovered));
    check('the tree is seen through: next to no foliage', m.foliageShare < 0.01, String(m.foliageShare));
    check('both years were used, the bare one at the tree', m.sources.some((r) => r.date === '2021-07' && Math.min(r.s0, r.s1) < TREE.s && Math.max(r.s0, r.s1) > TREE.s)
      && m.sources.some((r) => r.date === '2024-10'), JSON.stringify(m.sources.map((r) => [Math.round(r.s0), Math.round(r.s1), r.date])));
    check('most of the face comes from the newest drive', m.sources.filter((r) => r.date === '2024-10').reduce((t, r) => t + Math.abs(r.s1 - r.s0), 0) > 0.7 * (plan.s1 - plan.s0));
    check('the sky is taken off over the roofs', m.skyShare > 0.4, String(m.skyShare));
    // the roofline: the top of each metre is the building's roof there, within a quarter metre, away from the tree
    const offRoof = m.tops.filter((t) => Math.abs(t.s - TREE.s) > TREE.r + 2 && Math.abs(((t.s + 90) % 10 + 10) % 10 - 5) < 3).map((t) => Math.abs(t.z - roof(t.s)));
    check('the top of each metre is its roof', offRoof.length > 100 && offRoof.filter((d) => d < 0.35).length > offRoof.length * 0.95, `${offRoof.length} metres, ${offRoof.filter((d) => d >= 0.35).length} off`);

    const png = decodePng(readFileSync(join(dir, m.file)))!;
    check('the picture reads back', !!png && png.width === m.width && png.height === m.height);
    if (png) {
      const at = (s: number, z: number) => {
        const x = Math.floor((m.sAtLeft - s) * m.ppm), y = Math.floor((m.zTop - z) * m.ppm);
        if (x < 0 || x >= png.width || y < 0 || y >= png.height) return null;
        const i = (y * png.width + x) * 4;
        return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
      };
      // walls, between the windows, at true scale: the picture's colour is the facade's where the facade is a wall
      const errs: number[] = [], treeErrs: number[] = [];
      for (let s = -88; s <= 88; s += 0.5) for (const dz of [0.5, 2.6, 5.8]) {
        const z = ground(s) + dz;
        if (z > roof(s) - 0.6) continue;
        const truth = facade(s, z);
        if (truth[0] === 40 && truth[1] === 50) continue; // a window
        const wx = ((s + 90) % 2.5 + 2.5) % 2.5;
        if (wx > 0.4 && wx < 2.0) continue; // near a window's edge
        const p = at(s, z);
        if (!p) { errs.push(255); continue; }
        const e = p[3] < 128 ? 255 : (Math.abs(p[0] - truth[0]) + Math.abs(p[1] - truth[1]) + Math.abs(p[2] - truth[2])) / 3;
        (Math.abs(s - TREE.s) < TREE.r + 1 ? treeErrs : errs).push(e);
      }
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      check('the walls are the facade\'s colours where they stand', median(errs) < 10, `median error ${median(errs)} of 255 over ${errs.length} points`);
      check('and under the tree too, from the bare year brought to the newer one\'s exposure', median(treeErrs) < 28, `median error ${median(treeErrs)} over ${treeErrs.length} points`);
      // the sky over a roof is transparent; the footpath below the ground line is kept, and below that nothing
      let skyOpaque = 0, skyN = 0, footOk = 0, footN = 0, underOk = 0;
      for (let s = -84; s <= 84; s += 2.5) {
        if (Math.abs(((s + 90) % 10 + 10) % 10 - 5) > 4.4) continue; // not within 0.6 m of a party wall, where the roof steps
        const p = at(s, roof(s) + 3); if (p) { skyN++; if (p[3] > 0) skyOpaque++; }
        const q = at(s, ground(s) - 0.15); if (q) { footN++; if (q[3] > 200 && Math.abs(q[0] - 150) < 25) footOk++; }
        const r = at(s, ground(s) - BELOW_GROUND_M - 0.4); if (r && r[3] === 0) underOk++;
      }
      check('three metres over every roof is sky, transparent', skyN > 50 && skyOpaque === 0, `${skyOpaque} of ${skyN} opaque`);
      check('the footpath below the ground line is kept', footN > 50 && footOk > footN * 0.9, `${footOk} of ${footN}`);
      check('and below the footpath nothing', underOk > 60, String(underOk));
    }
  }
}
if (process.env.KEEP_MONTAGE) console.log(`kept in ${dir}`); else rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(`streetscape montage: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('streetscape montage: all checks passed');

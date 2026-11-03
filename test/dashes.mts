/* Dashed lines cut to their drawing, and the context sheet's dotted texture.
 *
 * Chromium prints every dash of a dashed stroke into the PDF, those a clip
 * hides as well, so the sheet cuts its dashed lines and dotted textures to
 * what can show before it writes them. The cut must not move a single dash:
 * every dot the uncut line showed inside the box is a dot of the cut one, at
 * the same place, and the cut line has no dots far outside it.
 * Pure geometry; nothing is fetched or printed.
 *
 *   npx tsx test/dashes.mts
 */

import { clipDashed, dashPeriod, type Pt } from '../src/lib/dashes.js';
import { textureSvg } from '../src/render/sheet.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

// The dash period of a stroke-dasharray, as SVG repeats it.
check('dots', Math.abs(dashPeriod('0.01,1.9')! - 1.91) < 1e-9);
check('dashes with spaces', dashPeriod('2.2 0.9') === 3.1);
check('an odd list repeats twice over', dashPeriod('3') === 6);
check('no dasharray is solid', dashPeriod(undefined) === undefined && dashPeriod('') === undefined);
check('all-zero is solid', dashPeriod('0,0') === undefined);

/** Where a pattern of the given period puts its dots along a polyline: every period from its start. */
function dotsAlong(line: Pt[], period: number): Pt[] {
  const out: Pt[] = [];
  let next = 0, run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    while (next <= run + len + 1e-9) {
      const t = len > 0 ? (next - run) / len : 0;
      out.push([ax + t * (bx - ax), ay + t * (by - ay)]);
      next += period;
    }
    run += len;
  }
  return out;
}

const box = { x: 0, y: 0, w: 100, h: 60 };
const inBox = ([x, y]: Pt, m = 0) => x >= box.x - m && x <= box.x + box.w + m && y >= box.y - m && y <= box.y + box.h + m;
const near = (p: Pt, set: Pt[]) => set.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6);

/** Every dot of the whole line inside the box is a dot of the pieces, and no piece has a dot further out than a period and the margin. */
function samePattern(name: string, line: Pt[], period: number, margin: number) {
  const pieces = clipDashed(line, box, period, margin);
  const whole = dotsAlong(line, period).filter((p) => inBox(p));
  const cut = pieces.flatMap((p) => dotsAlong(p, period));
  const missing = whole.filter((p) => !near(p, cut));
  check(`${name}: every dot inside is kept`, missing.length === 0, `${missing.length} of ${whole.length} missing, first ${JSON.stringify(missing[0])}`);
  const moved = cut.filter((p) => inBox(p) && !near(p, dotsAlong(line, period)));
  check(`${name}: no dot moves`, moved.length === 0, `${moved.length} moved, first ${JSON.stringify(moved[0])}`);
  const far = cut.filter((p) => !inBox(p, margin + period + 1e-6));
  check(`${name}: nothing far outside is kept`, far.length === 0, `${far.length} far, first ${JSON.stringify(far[0])}`);
  return pieces;
}

// Wholly inside: the line itself, untouched.
{
  const line: Pt[] = [[10, 10], [50, 30], [90, 20]];
  const pieces = clipDashed(line, box, 1.91, 2);
  check('inside: one piece', pieces.length === 1);
  check('inside: the same array', pieces[0] === line);
}

// Wholly outside: nothing.
check('outside: nothing', clipDashed([[-50, -50], [-10, -40], [-30, -5]], box, 1.91, 2).length === 0);

// A bus route that crosses the map and runs far beyond on both sides.
{
  const line: Pt[] = [[-4000, 20], [-3000, 25], [-200, 31.7], [-0.3, 33.3], [37.77, 41.2], [101.1, 59.99], [6000, 80]];
  const pieces = samePattern('crossing route', line, 1.91, 2.1);
  const kept = pieces.reduce((n, p) => n + p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0), 0);
  check('crossing route: only the part near the map is kept', kept < 120, `kept ${kept.toFixed(1)}`);
}

// In and out and in again, the second visit after a long way outside; and a
// short excursion outside that the pattern should carry straight through.
{
  const line: Pt[] = [[-20, 10], [40, 10], [40, -30], [60, -30], [60, 30], [60, 30], [130, 30], [130, 50], [80, 50], [80, 61], [70, 61], [70, 55]];
  const pieces = samePattern('in and out', line, 2.81, 2.7);
  check('in and out: two visits, two pieces at most per visit', pieces.length >= 2 && pieces.length <= 4, `${pieces.length} pieces`);
}

// A closed ring through a corner of the box.
{
  const ring: Pt[] = [[90, 50], [130, 50], [130, 90], [90, 90], [90, 50]];
  samePattern('ring on a corner', ring, 2.01, 2.15);
}

// Long dashes rather than dots: the dash that straddles the edge starts where it did.
samePattern('long dashes', [[-33.3, 5], [150, 55]], 4.9, 1.9);

// Without a period the line is cut at the box (with its margin).
{
  const pieces = clipDashed([[-50, 30], [150, 30]], box, undefined, 1);
  check('solid: cut at the margin', pieces.length === 1 && Math.abs(pieces[0][0][0] + 1) < 1e-9 && Math.abs(pieces[0][1][0] - 101) < 1e-9, JSON.stringify(pieces));
}

// ---- the context sheet's dotted texture ---------------------------------
// The dots each row of the texture draws, from its <line>s: one every
// period from x1 to x2, as a 0.01 dash and a 1.7 gap put them.
function textureDots(svg: string): Pt[] {
  const out: Pt[] = [];
  for (const m of svg.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"\/>/g)) {
    const [x1, y1, x2] = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let x = x1; x <= x2 + 1e-9; x += 1.71) out.push([x, y1]);
  }
  return out;
}
function insideRing(x: number, y: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// The dots that show: those whose round cap (0.3 across from the centre) reaches into a shape.
const shows = ([x, y]: Pt, rings: Pt[][]) => {
  for (let a = 0; a < 16; a++) {
    const px = x + 0.3 * Math.cos((a * Math.PI) / 8), py = y + 0.3 * Math.sin((a * Math.PI) / 8);
    if (rings.reduce((n, r) => n + (insideRing(px, py, r) ? 1 : 0), 0) % 2) return true;
  }
  return rings.reduce((n, r) => n + (insideRing(x, y, r) ? 1 : 0), 0) % 2 === 1;
};
{
  const map = { x: 0, y: 0, w: 710.9, h: 566.6 };
  // three zones far apart, one a thin sliver lying almost flat and one with a hole
  const rings: Pt[][] = [
    [[20, 20], [60, 25], [55, 70], [18, 64], [20, 20]],
    [[300.2, 400.05], [520.7, 401.35], [520.7, 402.1], [300.2, 400.9], [300.2, 400.05]],
    [[600, 100], [700, 100], [700, 200], [600, 200], [600, 100]],
    [[630, 130], [670, 130], [670, 170], [630, 170], [630, 130]],
  ];
  const d = rings.map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('') + 'Z').join('');
  const cut = textureDots(textureSvg('t', d, 'dots', '#000', map));
  // the full rows, as the texture drew them before it was cut
  const full: Pt[] = [];
  for (let i = 0, yy = 1.7 / 2; yy <= map.h; yy += 1.7, i++) {
    const x1 = Number((-(i % 2 ? 0.85 : 0)).toFixed(1));
    for (let x = x1; x <= map.w + 1e-9; x += 1.71) full.push([x, Number(yy.toFixed(1))]);
  }
  // the same dot: the same row, and within the rounding of the written x1 (two decimals, where it was one)
  const same = (p: Pt, q: Pt) => Math.abs(q[1] - p[1]) < 1e-9 && Math.abs(q[0] - p[0]) < 0.006;
  const showing = full.filter((p) => shows(p, rings));
  const lost = showing.filter((p) => !cut.some((q) => same(p, q)));
  check('texture: every dot that shows is still drawn', lost.length === 0, `${lost.length} of ${showing.length} lost, first ${JSON.stringify(lost[0])}`);
  const moved = cut.filter((p) => shows(p, rings) && !full.some((q) => same(p, q)));
  check('texture: no dot that shows has moved', moved.length === 0, `${moved.length} moved, first ${JSON.stringify(moved[0])}`);
  check('texture: far fewer dots than the full rows', cut.length < full.length / 5, `${cut.length} of ${full.length}`);
  // a legend swatch's shape is written in relative commands: it keeps its full rows
  const swatch = textureSvg('s', 'M6.3,0h23v6.5h-23Z', 'dots', '#000', { x: 6.3, y: 0, w: 23, h: 6.5 });
  check('swatch: whole rows', (swatch.match(/<line /g) ?? []).length === 4, swatch);
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('dashed lines cut to their drawing keep every dash where it was');

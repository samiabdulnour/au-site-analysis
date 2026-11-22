// The illustrated people of the 3D views (render/axonometric.ts), after the
// flat isometric figures of an illustrator's town: bright tops, trousers or a
// dress, a face and its hair, arms that swing as they walk, now and then a
// bag. Each of a few dozen is painted once as a small picture (as the crowns
// are, render/crowns.ts) and placed, facing either way, at every person who
// takes it: a town of a thousand people prints as a few dozen pictures.

import { paintLayers, CONTOUR, type Layer, type CrownPicture } from './crowns.js';

const TOPS = ['#f26a3d', '#2c3c7c', '#f2c230', '#3ba56e', '#5bb5a8', '#f4a3b6', '#ffffff', '#e5493b', '#8fc3e6'];
const LEGS = ['#2c3c7c', '#c48b32', '#5bb5a8', '#3ba56e', '#a9b1b5', '#2f2f35'];
const SKIN = ['#f3c7a5', '#e0a27a', '#ad7150', '#6c4531'];
const HAIR = ['#2a2420', '#f0c050', '#c2552e', '#5b3a26', '#2a2420'];
const SHOE = '#2b2b30';

/** How many people a drawing draws its crowd from. */
export const PEOPLE_VARIANTS = 30;

/**
 * Person `i`, metres, standing on the origin and facing right (y down): what they wear and how they stand follow from
 * the number, so the same number is the same person.
 */
function personLayers(i: number): Layer[] {
  const top = TOPS[i % TOPS.length], legs = LEGS[(i * 3 + 1) % LEGS.length], skin = SKIN[(i * 5 + 2) % SKIN.length];
  const hair = HAIR[(i * 7 + 3) % HAIR.length], style = (['short', 'long', 'bun'] as const)[(i * 11 + 1) % 3];
  const dress = i % 5 === 0 || i % 7 === 3, walking = i % 3 !== 0, bag = i % 4 === 1 ? ['#f2c230', '#e5493b', '#5bb5a8'][i % 3] : undefined;
  const seg = (x0: number, y0: number, x1: number, y1: number, w: number, ink: string): Layer => ({ shape: { seg: { x0, y0, x1, y1, w } }, ink });
  const dot = (x: number, y: number, r: number, ink: string): Layer => ({ shape: { circles: [{ x, y, r }] }, ink });
  const oval = (x: number, y: number, rx: number, ry: number, ink: string): Layer => ({ shape: { oval: { x, y, rx, ry } }, ink });
  const hip = -0.86, shoulder = -1.38;
  // walking: the legs apart, the arms swinging against them; standing: the legs together, the arms down
  const feet = walking ? [[-0.17, -0.03], [0.16, -0.03]] : [[-0.06, -0.03], [0.07, -0.03]];
  const hands = walking ? [[-0.25, -0.98], [0.25, -1.0]] : [[-0.19, -0.92], [0.19, -0.92]];
  const out: Layer[] = [];
  // the arm behind, its sleeve and its hand
  out.push(seg(0.12, shoulder, (0.12 + hands[1][0]) / 2, (shoulder + hands[1][1]) / 2, 0.09, top), seg((0.12 + hands[1][0]) / 2, (shoulder + hands[1][1]) / 2, hands[1][0], hands[1][1], 0.075, skin), dot(hands[1][0], hands[1][1], 0.04, skin));
  // the legs, in trousers or bare under a dress, and the shoes
  for (const [k, [fx, fy]] of feet.entries()) out.push(seg((k ? 0.06 : -0.06), hip, fx, fy, dress ? 0.08 : 0.12, dress ? skin : legs), oval(fx + 0.04, fy + 0.005, 0.07, 0.035, SHOE));
  // long hair down the back, behind the body
  if (style === 'long') out.push(seg(-0.07, -1.62, -0.09, -1.34, 0.12, hair));
  // the body: a shirt or a coat; a dress to the knee
  out.push(oval(0, -1.12, 0.19, 0.31, top));
  if (dress) out.push({ shape: { circles: [{ x: 0, y: -0.78, r: 0.2 }, { x: -0.06, y: -0.62, r: 0.13 }, { x: 0.06, y: -0.62, r: 0.13 }] }, ink: top });
  // a bag on its strap
  if (bag) out.push(seg(0.12, shoulder + 0.02, -0.16, -0.95, 0.025, bag), oval(-0.18, -0.9, 0.07, 0.085, bag));
  // the arm in front
  out.push(seg(-0.12, shoulder, (-0.12 + hands[0][0]) / 2, (shoulder + hands[0][1]) / 2, 0.09, top), seg((-0.12 + hands[0][0]) / 2, (shoulder + hands[0][1]) / 2, hands[0][0], hands[0][1], 0.075, skin), dot(hands[0][0], hands[0][1], 0.04, skin));
  // the neck, the head, the hair
  out.push(seg(0, -1.42, 0, -1.5, 0.08, skin), dot(0, -1.6, 0.115, skin), oval(-0.01, -1.67, 0.122, 0.072, hair));
  if (style === 'bun') out.push(dot(-0.03, -1.79, 0.055, hair));
  if (style === 'long') out.push(seg(-0.1, -1.66, -0.1, -1.52, 0.05, hair));
  return out;
}

/**
 * Person `i` on a bicycle, riding right: the wheels and the frame (in the colour of their top, or a dark one), seated,
 * leaning to the bars, a foot on each pedal.
 */
function riderLayers(i: number): Layer[] {
  const top = TOPS[(i * 2 + 5) % TOPS.length], legs = LEGS[(i * 3 + 2) % LEGS.length], skin = SKIN[(i * 5 + 1) % SKIN.length], hair = HAIR[(i * 7) % HAIR.length];
  const frame = i % 3 === 0 ? '#3d4048' : TOPS[(i * 5 + 3) % TOPS.length];
  const seg = (x0: number, y0: number, x1: number, y1: number, w: number, ink: string): Layer => ({ shape: { seg: { x0, y0, x1, y1, w } }, ink });
  const R = 0.34, rear = { x: -0.52, y: -R }, front = { x: 0.52, y: -R }, bb = { x: 0, y: -0.3 }, seat = { x: -0.13, y: -0.86 }, head = { x: 0.42, y: -0.84 };
  const wheel = (c: { x: number; y: number }): Layer[] => [
    { shape: { circles: [{ x: c.x, y: c.y, r: R }] }, ink: '#3d4048' }, { shape: { circles: [{ x: c.x, y: c.y, r: R - 0.05 }] }, ink: '#000000', erase: true },
    { shape: { circles: [{ x: c.x, y: c.y, r: 0.04 }] }, ink: '#3d4048' }];
  const hip = { x: -0.1, y: -0.94 }, shoulder = { x: 0.14, y: -1.44 }, hand = { x: 0.36, y: -0.96 };
  return [
    ...wheel(rear), ...wheel(front),
    // the far leg, down to its pedal behind
    seg(hip.x, hip.y, 0.1, -0.66, 0.12, legs), seg(0.1, -0.66, -0.06, -0.24, 0.11, legs),
    // the frame and the bars
    seg(rear.x, rear.y, bb.x, bb.y, 0.04, frame), seg(bb.x, bb.y, seat.x, seat.y, 0.04, frame), seg(seat.x, seat.y, rear.x, rear.y, 0.035, frame),
    seg(bb.x, bb.y, head.x, head.y, 0.045, frame), seg(seat.x + 0.02, seat.y + 0.04, head.x, head.y, 0.04, frame), seg(head.x, head.y, front.x, front.y, 0.04, frame),
    seg(head.x, head.y, 0.36, -0.97, 0.035, '#3d4048'), seg(seat.x - 0.07, seat.y - 0.02, seat.x + 0.06, seat.y - 0.02, 0.05, '#3d4048'),
    // the body leaning to the bars, the near leg, the arm, the head
    seg(hip.x, hip.y, shoulder.x, shoulder.y, 0.3, top),
    seg(hip.x, hip.y, 0.16, -0.62, 0.13, legs), seg(0.16, -0.62, 0.08, -0.3, 0.11, legs), { shape: { oval: { x: 0.12, y: -0.27, rx: 0.07, ry: 0.035 } }, ink: '#2b2b30' },
    seg(shoulder.x, shoulder.y, hand.x, hand.y, 0.085, top), { shape: { circles: [{ x: hand.x, y: hand.y, r: 0.04 }] }, ink: skin },
    seg(0.2, -1.5, 0.22, -1.56, 0.08, skin), { shape: { circles: [{ x: 0.25, y: -1.66, r: 0.115 }] }, ink: skin }, { shape: { oval: { x: 0.24, y: -1.73, rx: 0.12, ry: 0.07 } }, ink: hair },
  ];
}

/** Layers with the town's contour round all of them first: a thin line of it round the whole figure. */
const outlined = (layers: Layer[], width: number): Layer[] => [{ shape: { union: layers.filter((L) => !L.erase).map((L) => L.shape) }, ink: CONTOUR, grow: width }, ...layers];

/** The contour round a person, metres: as thin as the trees' and the vehicles'. */
const CONTOUR_M = 0.035;

const cache = new Map<string, CrownPicture>();

/** Person `i` painted (`perUnit` pixels to the metre): the picture, and the box it covers about their feet, metres. */
export function personPicture(i: number, perUnit = 140): CrownPicture {
  const key = `p${i % PEOPLE_VARIANTS}`;
  let pic = cache.get(key);
  if (!pic) { pic = paintLayers(outlined(personLayers(i % PEOPLE_VARIANTS), CONTOUR_M), perUnit); cache.set(key, pic); }
  return pic;
}

/** How many cyclists a drawing draws from. */
export const RIDER_VARIANTS = 12;

/** Person `i` on a bicycle painted, riding right: the picture, and its box about the point under the bicycle's middle. */
export function riderPicture(i: number, perUnit = 140): CrownPicture {
  const key = `r${i % RIDER_VARIANTS}`;
  let pic = cache.get(key);
  if (!pic) { pic = paintLayers(outlined(riderLayers(i % RIDER_VARIANTS), CONTOUR_M), perUnit); cache.set(key, pic); }
  return pic;
}

// ---- people in line alone, in vector ----

/**
 * A figure in line, as an illustrator draws the people of a flat town (Flamingo's, after Z.'s sheet of 2026-11): one
 * thin dark line (`line`) round every part, each in the paper's own colour (`fill`) but for the hair, which is dark,
 * and for some of the clothes, which take one of a few flat colours (`accents`: a pair of trousers, a skirt or shorts
 * for about half the people, a top for a few, the book in a hand); no face. Under the feet a pale warm bar on the
 * ground (`ground`). Soft and loose: a blouse with rounded shoulders and full sleeves gathered at the wrist, wide
 * trousers flaring to a curved hem, slim ones, a skirt or shorts over slender legs, flat shoes; standing with the
 * arms folded, a hand on a hip, both, in the pockets, waving, or at the sides; walking with the arms swinging, a
 * book held up, or a bag on its strap; the hair short, in a bun, a tail, long and loose, or under a brimmed hat.
 * Drawn in vector, so the line is crisp at any size.
 */
export interface LineFigure { fill: string; line: string; ground?: string; accents?: string[] }

/** The line round each part, metres at life size, where a drawing does not set its own (a figure drawn large takes a finer one). */
const LINE_M = 0.02;
type Pt = [number, number];
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const straight = (p: Pt[]) => `${p.map(([x, y], k) => `${k ? 'L' : 'M'}${n(x)},${n(y)}`).join('')}Z`;
/** A smooth closed curve through the points (Catmull-Rom, as cubic Béziers). */
function smooth(p: Pt[]): string {
  const m = p.length, at = (k: number) => p[((k % m) + m) % m];
  let d = `M${n(p[0][0])},${n(p[0][1])}`;
  for (let k = 0; k < m; k++) {
    const a = at(k - 1), b = at(k), c = at(k + 1), e = at(k + 2);
    d += `C${n(b[0] + (c[0] - a[0]) / 6)},${n(b[1] + (c[1] - a[1]) / 6)} ${n(c[0] - (e[0] - b[0]) / 6)},${n(c[1] - (e[1] - b[1]) / 6)} ${n(c[0])},${n(c[1])}`;
  }
  return `${d}Z`;
}
/** A limb's outline: through the points, as wide at each as `w` says, its ends rounded; a smooth closed curve. */
function limb(p: Pt[], w: number[]): string {
  const unit = (a: Pt, b: Pt): Pt => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const L: Pt[] = [], R: Pt[] = [], last = p.length - 1;
  p.forEach((q, k) => {
    const t = unit(p[Math.max(0, k - 1)], p[Math.min(last, k + 1)]);
    L.push([q[0] - t[1] * w[k] / 2, q[1] + t[0] * w[k] / 2]);
    R.push([q[0] + t[1] * w[k] / 2, q[1] - t[0] * w[k] / 2]);
  });
  const t0 = unit(p[0], p[1]), t1 = unit(p[last - 1], p[last]);
  return smooth([...L, [p[last][0] + t1[0] * w[last] * 0.5, p[last][1] + t1[1] * w[last] * 0.5], ...R.reverse(), [p[0][0] - t0[0] * w[0] * 0.5, p[0][1] - t0[1] * w[0] * 0.5]]);
}

const WALK_ARMS = ['swing', 'book', 'swing', 'bag', 'swing'] as const, STAND_ARMS = ['folded', 'hip', 'wave', 'down', 'hips', 'pockets'] as const;
const BOTTOMS = ['wide', 'shorts', 'skirt', 'wide', 'slim'] as const, HAIRS = ['tail', 'bun', 'short', 'hat', 'long', 'short'] as const;

/**
 * Person `i` in line, metres, standing on the origin and facing right (y down). The same number is the same person;
 * every third stands, the rest walk (as the painted people do).
 */
function linePerson(i: number, f: LineFigure, t = LINE_M): string {
  const walking = i % 3 !== 0, k = Math.floor(i / 3);
  const arms = walking ? WALK_ARMS[(i + k) % WALK_ARMS.length] : STAND_ARMS[k % STAND_ARMS.length];
  const bottom = BOTTOMS[(i * 3 + 1) % BOTTOMS.length], hair = HAIRS[(i * 5 + 2) % HAIRS.length];
  // the colours: about half the trousers, skirts and shorts, a top now and then, whatever is held in a hand
  const pal = f.accents?.length ? f.accents : [f.fill];
  const lower = i % 2 === 0 ? pal[(i >> 1) % pal.length] : f.fill, upper = i % 7 === 4 ? pal[(i + 1) % pal.length] : f.fill, held = pal[(i * 3 + 1) % pal.length];
  const out: string[] = [];
  const shape = (d: string, fill = f.fill) => { out.push(`<path d="${d}" fill="${fill}" stroke="${f.line}" stroke-width="${t}" stroke-linejoin="round"/>`); };
  const pen = (d: string) => { out.push(`<path d="${d}" fill="none" stroke="${f.line}" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round"/>`); };
  const oval = (x: number, y: number, rx: number, ry: number, fill = f.fill, turn = 0) => { out.push(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${f.line}" stroke-width="${t}"${turn ? ` transform="rotate(${turn} ${n(x)} ${n(y)})"` : ''}/>`); };
  // a walker leans a little into the walk
  const lean = walking ? 0.03 : 0, hx = lean * 1.7 + 0.01, hy = -1.705;
  const S = (side: number): Pt => [side * 0.158 + lean, -1.505];
  // an arm in its sleeve: full toward the wrist and gathered there, the hand beyond the cuff
  const arm = (side: number, elbow: Pt, wrist: Pt, hands = true) => {
    const sh = S(side), fore: Pt = [elbow[0] + (wrist[0] - elbow[0]) * 0.72, elbow[1] + (wrist[1] - elbow[1]) * 0.72];
    const dx = wrist[0] - elbow[0], dy = wrist[1] - elbow[1], l = Math.hypot(dx, dy) || 1;
    if (hands) oval(wrist[0] + (dx / l) * 0.05, wrist[1] + (dy / l) * 0.05, 0.026, 0.036, f.fill, (Math.atan2(dy, dx) * 180) / Math.PI - 90);
    shape(limb([sh, elbow, fore, wrist], [0.09, 0.106, 0.12, 0.046]), upper);
  };
  // the feet: where each leg ends; the hips they hang from, at a high waist
  const feet: Pt[] = walking ? [[-0.25, -0.1], [0.29, -0.045]] : [[-0.105, -0.045], [0.105, -0.045]];
  const hips: Pt[] = walking ? [[-0.045 + lean, -1.08], [0.05 + lean, -1.08]] : [[-0.064, -1.08], [0.064, -1.08]];
  // a flat shoe, its toe the way they face
  const shoe = ([fx, fy]: Pt, lifted = false) => shape(`M${n(fx - 0.05)},${n(fy + 0.005)}C${n(fx - 0.06)},${n(fy + 0.05)} ${n(fx - 0.02)},${n(fy + 0.06)} ${n(fx + 0.04)},${n(fy + 0.06)}C${n(fx + 0.11)},${n(fy + 0.06)} ${n(fx + 0.15)},${n(fy + 0.05)} ${n(fx + 0.15)},${n(fy + (lifted ? 0.03 : 0.04))}C${n(fx + 0.12)},${n(fy + 0.02)} ${n(fx + 0.07)},${n(fy + 0.005)} ${n(fx + 0.045)},${n(fy - 0.01)}Z`);
  // a trouser leg: narrow at the waist, holding its line and then flaring to a hem that curves; `top` and `hem` its half widths
  const leg = (hip: Pt, foot: Pt, top: number, hem: number, to = 1, fill = lower) => {
    const e: Pt = [hip[0] + (foot[0] - hip[0]) * to, hip[1] + (foot[1] - hip[1]) * to];
    const dx = e[0] - hip[0], dy = e[1] - hip[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const at = (along: number, across: number): Pt => [hip[0] + ux * along * l + nx * across, hip[1] + uy * along * l + ny * across];
    const A = at(0, top), B = at(0, -top), C = at(1, -hem), D = at(1, hem), mid = (top + hem) / 2;
    const q = (c: Pt, e2: Pt) => `Q${n(c[0])},${n(c[1])} ${n(e2[0])},${n(e2[1])}`;
    shape(`M${n(A[0])},${n(A[1])}L${n(B[0])},${n(B[1])}${q(at(0.55, -(top + (mid - top) * 0.25)), C)}${q(at(1.03, 0), D)}${q(at(0.55, top + (mid - top) * 0.25), A)}Z`, fill);
  };
  // the bar on the ground under the feet
  if (f.ground) out.push(`<rect x="${n(feet[0][0] - 0.16)}" y="-0.03" width="${n(feet[1][0] - feet[0][0] + 0.5)}" height="0.11" rx="0.055" fill="${f.ground}"/>`);
  // long hair, loose down the back, behind everything
  if (hair === 'long') shape(limb([[hx - 0.02, hy - 0.08], [hx - 0.085, hy + 0.03], [hx - 0.12, hy + 0.17], [hx - 0.2, hy + 0.3]], [0.11, 0.135, 0.14, 0.05]), f.line);
  // the arm behind the body
  if (arms === 'swing' || arms === 'bag') arm(-1, [-0.225 + lean, -1.28], [-0.3, -1.08]);
  else if (arms === 'book') arm(-1, [-0.215 + lean, -1.28], [-0.24, -1.05]);
  else if (arms === 'wave') arm(1, [0.3, -1.63], [0.36, -1.9]);
  // the legs, the far one first: in trousers, wide or slim; bare and slender under a skirt or shorts; and the shoes
  for (const j of [0, 1]) {
    if (bottom === 'wide') leg(hips[j], [feet[j][0], feet[j][1] + 0.03], 0.068, 0.128);
    else if (bottom === 'slim') leg(hips[j], [feet[j][0], feet[j][1] + 0.02], 0.07, 0.058);
    else {
      const knee: Pt = [(hips[j][0] + feet[j][0]) / 2 + (walking ? 0.02 : 0), (hips[j][1] + feet[j][1]) / 2 + 0.04];
      shape(limb([[hips[j][0] + (feet[j][0] - hips[j][0]) * 0.25, hips[j][1] + 0.28], knee, [feet[j][0], feet[j][1] + 0.01]], [0.09, 0.066, 0.04]));
    }
    shoe(feet[j], walking && j === 0);
  }
  if (bottom === 'shorts') for (const j of [0, 1]) leg(hips[j], feet[j], 0.07, 0.112, 0.4);
  // a skirt, flaring from the waist to below the knee, its hem a curve
  if (bottom === 'skirt') { const sw = walking ? 0.27 : 0.21; shape(`M${n(-0.125 + lean)},-1.08L${n(0.125 + lean)},-1.08Q${n(0.17 + lean)},-0.8 ${n(sw + lean)},-0.5Q${n(lean)},-0.42 ${n(-sw + lean)},-0.5Q${n(-0.17 + lean)},-0.8 ${n(-0.125 + lean)},-1.08Z`, lower); }
  // the body: a loose top, its shoulders rounded, bloused over the waist
  const T = (x: number, y: number): Pt => [x + lean, y];
  shape(smooth([T(-0.05, -1.572), T(0.05, -1.572), T(0.135, -1.545), T(0.178, -1.48), T(0.168, -1.3), T(0.15, -1.14), T(0.152, -1.045), T(0, -1.025), T(-0.152, -1.045), T(-0.15, -1.14), T(-0.168, -1.3), T(-0.178, -1.48), T(-0.135, -1.545)]), upper);
  if (i % 5 === 0) pen(`M${n(-0.045 + lean)},-1.57L${n(lean)},-1.49L${n(0.045 + lean)},-1.57`);            // a collar
  // the arms in front of the body
  if (arms === 'swing') arm(1, [0.235 + lean, -1.28], [0.33, -1.1]);
  else if (arms === 'bag') {
    pen(`M${n(0.14 + lean)},-1.54L${n(-0.18 + lean)},-1.05`);
    out.push(`<rect x="${n(-0.3 + lean)}" y="-1.05" width="0.2" height="0.19" rx="0.04" fill="${held}" stroke="${f.line}" stroke-width="${t}"/>`);
    arm(1, [0.235 + lean, -1.28], [0.33, -1.1]);
  } else if (arms === 'book') {
    out.push(`<rect x="0.36" y="-1.47" width="0.115" height="0.17" rx="0.018" fill="${held}" stroke="${f.line}" stroke-width="${t}" transform="rotate(12 0.42 -1.385)"/>`);
    arm(1, [0.2 + lean, -1.26], [0.34, -1.31]);
  } else if (arms === 'folded') {
    // the arms folded: each forearm across the chest, a hand showing at the other elbow
    oval(0.13, -1.27, 0.026, 0.036, f.fill, 70);
    shape(limb([S(1), [0.21, -1.26], [-0.08, -1.2]], [0.088, 0.1, 0.07]), upper);
    shape(limb([S(-1), [-0.21, -1.25], [0.08, -1.265]], [0.088, 0.1, 0.07]), upper);
  } else if (arms === 'hip') { arm(-1, [-0.2, -1.28], [-0.205, -1.05]); arm(1, [0.34, -1.26], [0.17, -1.07]); }
  else if (arms === 'hips') { arm(-1, [-0.34, -1.26], [-0.17, -1.07]); arm(1, [0.34, -1.26], [0.17, -1.07]); }
  else if (arms === 'pockets') { arm(-1, [-0.24, -1.26], [-0.15, -1.03], false); arm(1, [0.24, -1.26], [0.15, -1.03], false); }
  else if (arms === 'wave') arm(-1, [-0.2, -1.28], [-0.205, -1.05]);
  else { arm(-1, [-0.2, -1.28], [-0.205, -1.05]); arm(1, [0.2, -1.28], [0.205, -1.05]); }
  // the neck and the head, without a face
  shape(straight([[hx - 0.03, -1.565], [hx + 0.024, -1.565], [hx + 0.03, hy + 0.06], [hx - 0.024, hy + 0.06]]));
  oval(hx, hy, 0.066, 0.082, f.fill, 6);
  // the hair, dark: a cap over the crown and the back of the head; a bun, a tail curling off it; or a brimmed hat instead
  const cap = `M${n(hx - 0.072)},${n(hy + 0.035)}C${n(hx - 0.11)},${n(hy - 0.075)} ${n(hx - 0.03)},${n(hy - 0.125)} ${n(hx + 0.058)},${n(hy - 0.07)}C${n(hx + 0.025)},${n(hy - 0.055)} ${n(hx - 0.02)},${n(hy - 0.04)} ${n(hx - 0.035)},${n(hy + 0.005)}C${n(hx - 0.045)},${n(hy + 0.02)} ${n(hx - 0.06)},${n(hy + 0.03)} ${n(hx - 0.072)},${n(hy + 0.035)}Z`;
  if (hair === 'hat') {
    shape(`M${n(hx - 0.07)},${n(hy - 0.055)}C${n(hx - 0.075)},${n(hy - 0.15)} ${n(hx + 0.075)},${n(hy - 0.15)} ${n(hx + 0.07)},${n(hy - 0.055)}Z`);
    oval(hx, hy - 0.052, 0.135, 0.026);
  } else {
    if (hair === 'tail') shape(limb([[hx - 0.055, hy - 0.045], [hx - 0.135, hy - 0.03], [hx - 0.19, hy + 0.06], [hx - 0.215, hy + 0.2]], [0.04, 0.062, 0.05, 0.01]), f.line);
    if (hair === 'bun') oval(hx - 0.05, hy - 0.115, 0.04, 0.04, f.line);
    shape(cap, f.line);
  }
  return out.join('');
}

/** Person `i` on a bicycle in line, riding right: thin spoked wheels and frame in the pen alone, the rider leaning to the bars, a helmet. */
function lineRider(i: number, f: LineFigure, t = LINE_M): string {
  const out: string[] = [];
  const shape = (d: string, fill = f.fill) => { out.push(`<path d="${d}" fill="${fill}" stroke="${f.line}" stroke-width="${t}" stroke-linejoin="round"/>`); };
  const pen = (p: Pt[], w = t) => { out.push(`<path d="${p.map(([x, y], k) => `${k ? 'L' : 'M'}${n(x)},${n(y)}`).join('')}" fill="none" stroke="${f.line}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`); };
  const R = 0.34, rear: Pt = [-0.52, -R], front: Pt = [0.52, -R], bb: Pt = [0, -0.3], seat: Pt = [-0.13, -0.86], head: Pt = [0.42, -0.84];
  const hip: Pt = [-0.1, -0.95], shoulder: Pt = [0.17, -1.43], grip: Pt = [0.38, -0.98], up = i % 2 === 0;
  if (f.ground) out.push(`<rect x="-0.98" y="-0.04" width="1.96" height="0.13" rx="0.065" fill="${f.ground}"/>`);
  for (const c of [rear, front]) {
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 4 + (i % 3) * 0.3; pen([[c[0] - Math.cos(a) * R, c[1] - Math.sin(a) * R], [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R]], 0.008); }
    out.push(`<circle cx="${n(c[0])}" cy="${n(c[1])}" r="${R}" fill="none" stroke="${f.line}" stroke-width="${t}"/>`);
  }
  // the far leg, down to its pedal
  shape(limb([hip, [0.1, -0.66], up ? [-0.06, -0.26] : [0.02, -0.42]], [0.11, 0.09, 0.07]));
  // the frame, the fork, the bars and the saddle
  pen([rear, bb, seat, rear], 0.03); pen([bb, head, front], 0.03); pen([[seat[0] + 0.02, seat[1] + 0.04], head], 0.03);
  pen([head, [0.38, -0.99], [0.45, -1.01]], 0.03); pen([[seat[0] - 0.08, seat[1] - 0.02], [seat[0] + 0.07, seat[1] - 0.02]], 0.045);
  // the body leaning to the bars, the near leg and its shoe, the arm
  shape(smooth([[hip[0] - 0.1, hip[1] + 0.03], [hip[0] + 0.09, hip[1] + 0.09], [shoulder[0] + 0.09, shoulder[1] + 0.09], [shoulder[0] + 0.04, shoulder[1] - 0.08], [shoulder[0] - 0.09, shoulder[1] - 0.04], [hip[0] - 0.12, hip[1] - 0.2]]));
  const foot: Pt = up ? [0.09, -0.33] : [0.0, -0.2];
  shape(limb([hip, [0.18, -0.63], foot], [0.115, 0.095, 0.07]));
  shape(`M${n(foot[0] - 0.05)},${n(foot[1] - 0.02)}L${n(foot[0] + 0.14)},${n(foot[1] + 0.0)}L${n(foot[0] + 0.14)},${n(foot[1] + 0.05)}L${n(foot[0] - 0.05)},${n(foot[1] + 0.05)}Z`);
  shape(limb([[shoulder[0], shoulder[1] + 0.03], [0.31, -1.17], grip], [0.078, 0.066, 0.054]));
  out.push(`<ellipse cx="${n(grip[0])}" cy="${n(grip[1])}" rx="0.034" ry="0.036" fill="${f.fill}" stroke="${f.line}" stroke-width="${t}"/>`);
  // the neck, the head, a helmet
  shape(straight([[0.2, -1.47], [0.26, -1.49], [0.29, -1.58], [0.22, -1.58]]));
  out.push(`<ellipse cx="0.275" cy="-1.665" rx="0.075" ry="0.08" fill="${f.fill}" stroke="${f.line}" stroke-width="${t}"/>`);
  shape('M0.175,-1.67C0.17,-1.8 0.38,-1.82 0.385,-1.69C0.32,-1.72 0.24,-1.72 0.175,-1.67Z', i % 3 === 0 ? f.line : f.fill);
  return out.join('');
}

/**
 * Person `i` in line alone, in vector: markup for a drawing's defs under `id`, standing on the origin, facing right,
 * metres; `line` the width of the line round each part, metres at life size.
 */
export const linePersonSvg = (id: string, i: number, f: LineFigure, line?: number): string => `<g id="${id}" data-line-figure="person">${linePerson(i % PEOPLE_VARIANTS, f, line)}</g>`;
/** Person `i` on a bicycle in line alone, in vector, riding right: its origin the point under the bicycle's middle. */
export const lineRiderSvg = (id: string, i: number, f: LineFigure, line?: number): string => `<g id="${id}" data-line-figure="rider">${lineRider(i % RIDER_VARIANTS, f, line)}</g>`;

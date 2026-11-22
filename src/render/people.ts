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
 * A figure in line alone, as an illustrator's isometric town draws its people (Flamingo's, after Z.'s references of
 * 2026-11): no colours, every part in the paper's own colour (`fill`) with one thin dark line (`line`) round it, so
 * an arm reads against the body it crosses; under the feet a pale warm bar on the ground (`ground`). Tall and
 * slender, the head small, the legs long: wide trousers falling to a straight hem, slim ones, a skirt or shorts;
 * standing with the arms folded, a hand on a hip, both, waving, or at the sides; walking with the arms swinging, a
 * book held up, or a bag on its strap; the hair short, in a bun, a tail, long, a quiff or under a hat, in outline or
 * filled dark. Drawn in vector, so the line is crisp at any size: these people are drawn several times life size,
 * off the town's scale, as the references draw their own.
 */
export interface LineFigure { fill: string; line: string; ground?: string }

/** The line round each part, metres at life size. */
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

const WALK_ARMS = ['swing', 'bag', 'swing', 'book', 'swing'] as const, STAND_ARMS = ['folded', 'hip', 'wave', 'down', 'hips', 'pockets'] as const;
const BOTTOMS = ['wide', 'slim', 'skirt', 'wide', 'shorts'] as const, HAIRS = ['short', 'bun', 'tail', 'long', 'quiff', 'hat'] as const;

/**
 * Person `i` in line, metres, standing on the origin and facing right (y down). The same number is the same person;
 * every third stands, the rest walk (as the painted people do).
 */
function linePerson(i: number, f: LineFigure): string {
  const walking = i % 3 !== 0, k = Math.floor(i / 3);
  const arms = walking ? WALK_ARMS[(i + k) % WALK_ARMS.length] : STAND_ARMS[k % STAND_ARMS.length];
  const bottom = BOTTOMS[(i * 3 + 1) % BOTTOMS.length], hair = HAIRS[(i * 5 + 2) % HAIRS.length], dark = i % 2 === 1;
  const t = LINE_M, out: string[] = [];
  const shape = (d: string, fill = f.fill) => { out.push(`<path d="${d}" fill="${fill}" stroke="${f.line}" stroke-width="${t}" stroke-linejoin="round"/>`); };
  const pen = (d: string) => { out.push(`<path d="${d}" fill="none" stroke="${f.line}" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round"/>`); };
  // a walker leans a little into the walk
  const lean = walking ? 0.025 : 0, hx = lean * 1.6, hy = -1.69, r = 0.08;
  const S = (side: number): Pt => [side * 0.165 + lean, -1.5];
  const hand = (q: Pt) => out.push(`<ellipse cx="${n(q[0])}" cy="${n(q[1])}" rx="0.034" ry="0.036" fill="${f.fill}" stroke="${f.line}" stroke-width="${t}"/>`);
  const arm = (side: number, elbow: Pt, wrist: Pt, hands = true) => { shape(limb([S(side), elbow, wrist], [0.078, 0.066, 0.054])); if (hands) hand(wrist); };
  // the feet: where each leg ends, and the shoe pointing the way they face
  const feet: Pt[] = walking ? [[-0.25, -0.1], [0.29, -0.05]] : [[-0.1, -0.05], [0.1, -0.05]];
  const hips: Pt[] = walking ? [[-0.035 + lean, -1.0], [0.045 + lean, -1.0]] : [[-0.072, -1.0], [0.072, -1.0]];
  const shoe = ([fx, fy]: Pt) => shape(`M${n(fx - 0.05)},${n(fy - 0.01)}L${n(fx + 0.05)},${n(fy - 0.01)}C${n(fx + 0.1)},${n(fy + 0.01)} ${n(fx + 0.17)},${n(fy + 0.03)} ${n(fx + 0.18)},${n(fy + 0.055)}L${n(fx - 0.055)},${n(fy + 0.055)}Z`);
  // a trouser leg: straight-sided from the hip to its hem, `top` and `hem` its half widths
  const leg = (hip: Pt, foot: Pt, top: number, hem: number, to = 1) => {
    const e: Pt = [hip[0] + (foot[0] - hip[0]) * to, hip[1] + (foot[1] - hip[1]) * to];
    const dx = e[0] - hip[0], dy = e[1] - hip[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    shape(straight([[hip[0] + nx * top, hip[1] + ny * top], [hip[0] - nx * top, hip[1] - ny * top], [e[0] - nx * hem, e[1] - ny * hem], [e[0] + nx * hem, e[1] + ny * hem]]));
    return e;
  };
  // the bar on the ground under the feet
  if (f.ground) out.push(`<rect x="${n(feet[0][0] - 0.2)}" y="-0.04" width="${n(feet[1][0] - feet[0][0] + 0.58)}" height="0.13" rx="0.065" fill="${f.ground}"/>`);
  // the arm behind the body
  if (arms === 'swing' || arms === 'bag') arm(-1, [-0.235 + lean, -1.27], [-0.31, -1.07]);
  else if (arms === 'book') arm(-1, [-0.225 + lean, -1.27], [-0.25, -1.04]);
  else if (arms === 'wave') arm(1, [0.3, -1.62], [0.37, -1.88]);
  // long hair, behind the head and the shoulders
  if (hair === 'long') shape(`M${n(hx - r * 1.12)},${n(hy - r * 0.2)}C${n(hx - r * 1.35)},${n(hy - r * 1.6)} ${n(hx + r * 1.35)},${n(hy - r * 1.6)} ${n(hx + r * 1.12)},${n(hy - r * 0.2)}L${n(hx + r * 1.3)},${n(hy + r * 1.9)}Q${n(hx)},${n(hy + r * 2.3)} ${n(hx - r * 1.3)},${n(hy + r * 1.9)}Z`, dark ? f.line : f.fill);
  // the legs, the far one first: in trousers, wide or slim; bare under a skirt or shorts; and the shoes
  const order = walking ? [0, 1] : [0, 1];
  for (const j of order) {
    if (bottom === 'wide') leg(hips[j], feet[j], 0.082, 0.118);
    else if (bottom === 'slim') leg(hips[j], feet[j], 0.078, 0.05);
    else {
      // a bare leg from under the skirt or the shorts
      const knee: Pt = [(hips[j][0] + feet[j][0]) / 2 + (walking ? 0.02 : 0), (hips[j][1] + feet[j][1]) / 2];
      shape(limb([[hips[j][0], hips[j][1] + 0.2], knee, [feet[j][0], feet[j][1] + 0.02]], [0.085, 0.07, 0.052]));
      if (bottom === 'shorts') leg(hips[j], feet[j], 0.082, 0.1, 0.4);
    }
    shoe(feet[j]);
  }
  // a skirt, flaring from the waist to the knee, its hem a curve
  if (bottom === 'skirt') { const sw = walking ? 0.27 : 0.22; shape(`M${n(-0.13 + lean)},-1.02L${n(0.13 + lean)},-1.02L${n(sw + lean)},-0.52Q${n(lean)},-0.47 ${n(-sw + lean)},-0.52Z`); }
  // the body: rounded shoulders, tapering to a straight hem at the waist
  const tx = (x: number) => n(x + lean);
  shape(`M${tx(-0.132)},-0.985L${tx(0.132)},-0.985C${tx(0.132)},-1.2 ${tx(0.2)},-1.37 ${tx(0.188)},-1.46C${tx(0.18)},-1.535 ${tx(0.12)},-1.56 ${tx(0.05)},-1.565L${tx(-0.05)},-1.565C${tx(-0.12)},-1.56 ${tx(-0.18)},-1.535 ${tx(-0.188)},-1.46C${tx(-0.2)},-1.37 ${tx(-0.132)},-1.2 ${tx(-0.132)},-0.985Z`);
  if (i % 4 === 0) pen(`M${tx(-0.045)},-1.563L${tx(0)},-1.49L${tx(0.045)},-1.563`);                    // a collar
  if (bottom !== 'skirt' && i % 2 === 0) pen(`M${tx(-0.13)},-1.045L${tx(0.13)},-1.045`);                // a belt
  // the arms in front of the body
  if (arms === 'swing') arm(1, [0.245 + lean, -1.27], [0.34, -1.09]);
  else if (arms === 'bag') {
    pen(`M${tx(0.15)},-1.54L${tx(-0.19)},-1.02`);
    shape(straight([[-0.3 + lean, -1.03], [-0.1 + lean, -1.03], [-0.085 + lean, -0.84], [-0.315 + lean, -0.84]]));
    arm(1, [0.245 + lean, -1.27], [0.34, -1.09]);
  } else if (arms === 'book') {
    arm(1, [0.21 + lean, -1.25], [0.37, -1.32]);
    shape(straight([[0.36, -1.44], [0.5, -1.41], [0.48, -1.27], [0.34, -1.3]]));
    pen('M0.43,-1.425L0.41,-1.285');
  } else if (arms === 'folded') {
    // the arms folded: each forearm across the chest, the hand tucked at the other elbow
    shape(limb([S(1), [0.215, -1.25], [-0.07, -1.2]], [0.078, 0.068, 0.056]));
    shape(limb([S(-1), [-0.215, -1.24], [0.08, -1.265]], [0.078, 0.068, 0.056]));
    hand([0.11, -1.27]);
  } else if (arms === 'hip') { arm(-1, [-0.205, -1.27], [-0.21, -1.03]); arm(1, [0.35, -1.25], [0.16, -1.04]); }
  else if (arms === 'hips') { arm(-1, [-0.35, -1.25], [-0.16, -1.04]); arm(1, [0.35, -1.25], [0.16, -1.04]); }
  else if (arms === 'pockets') { arm(-1, [-0.25, -1.24], [-0.15, -1.0], false); arm(1, [0.25, -1.24], [0.15, -1.0], false); }
  else if (arms === 'wave') arm(-1, [-0.205, -1.27], [-0.21, -1.03]);
  else { arm(-1, [-0.205, -1.27], [-0.21, -1.03]); arm(1, [0.205, -1.27], [0.21, -1.03]); }
  // the neck, the head, the hair
  shape(straight([[hx - 0.034, -1.555], [hx + 0.034, -1.555], [hx + 0.032, hy + r * 0.8], [hx - 0.032, hy + r * 0.8]]));
  out.push(`<ellipse cx="${n(hx)}" cy="${n(hy)}" rx="${n(r * 0.94)}" ry="${n(r)}" fill="${f.fill}" stroke="${f.line}" stroke-width="${t}"/>`);
  const ink = dark ? f.line : f.fill;
  // a cap of hair over the head, lower at the back, its front swept up for a quiff
  const q = hair === 'quiff' ? 1 : 0;
  shape(`M${n(hx - r * 1.02)},${n(hy + r * 0.1)}C${n(hx - r * 1.25)},${n(hy - r * 1.3)} ${n(hx + r * (0.9 + 0.5 * q))},${n(hy - r * (1.45 + 0.35 * q))} ${n(hx + r * 1.0)},${n(hy - r * 0.25)}C${n(hx + r * 0.5)},${n(hy - r * 0.75)} ${n(hx - r * 0.3)},${n(hy - r * 0.75)} ${n(hx - r * 0.75)},${n(hy - r * 0.2)}Z`, ink);
  if (hair === 'bun') out.push(`<circle cx="${n(hx - r * 0.5)}" cy="${n(hy - r * 1.38)}" r="${n(r * 0.42)}" fill="${ink}" stroke="${f.line}" stroke-width="${t}"/>`);
  if (hair === 'tail') shape(limb([[hx - r * 0.95, hy - r * 0.5], [hx - r * 1.8, hy - r * 0.2], [hx - r * 2.1, hy + r * 0.9]], [r * 0.5, r * 0.55, r * 0.2]), ink);
  if (hair === 'hat') { shape(`M${n(hx - r * 1.0)},${n(hy - r * 0.42)}C${n(hx - r * 0.95)},${n(hy - r * 1.6)} ${n(hx + r * 0.95)},${n(hy - r * 1.6)} ${n(hx + r * 1.0)},${n(hy - r * 0.42)}Z`); pen(`M${n(hx - r * 1.7)},${n(hy - r * 0.42)}L${n(hx + r * 1.9)},${n(hy - r * 0.42)}`); }
  return out.join('');
}

/** Person `i` on a bicycle in line, riding right: thin spoked wheels and frame in the pen alone, the rider leaning to the bars, a helmet. */
function lineRider(i: number, f: LineFigure): string {
  const t = LINE_M, out: string[] = [];
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

/** Person `i` in line alone, in vector: markup for a drawing's defs under `id`, standing on the origin, facing right, metres. */
export const linePersonSvg = (id: string, i: number, f: LineFigure): string => `<g id="${id}" data-line-figure="person">${linePerson(i % PEOPLE_VARIANTS, f)}</g>`;
/** Person `i` on a bicycle in line alone, in vector, riding right: its origin the point under the bicycle's middle. */
export const lineRiderSvg = (id: string, i: number, f: LineFigure): string => `<g id="${id}" data-line-figure="rider">${lineRider(i % RIDER_VARIANTS, f)}</g>`;

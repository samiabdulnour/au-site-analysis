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

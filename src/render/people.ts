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
 * A figure in line alone, as an illustrator's isometric town draws its people (Flamingo's, after Z.'s reference of
 * 2026-11): no colours, every part in the paper's own colour (`fill`) with one thin line (`line`) round it, so an arm
 * reads against the body it crosses; under the feet a pale warm patch on the ground (`ground`). Drawn in vector, so
 * the line is crisp at any size: these people are drawn well over life size, as the reference draws its own.
 */
export interface LineFigure { fill: string; line: string; ground?: string }

/** The line round each part, metres at life size. */
const LINE_M = 0.03;
/** A part of a line figure: a limb (a tube with round ends, through its points), a round or oval part, a flat one, or a line of the pen alone. */
type Part =
  | { tube: [number, number][]; w: number }
  | { dot: [number, number]; r: number; dark?: boolean }
  | { oval: [number, number, number, number]; dark?: boolean }
  | { poly: [number, number][]; dark?: boolean }
  | { pen: [number, number][]; w?: number }
  | { ring: [number, number]; r: number };
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
const pts = (p: [number, number][]) => p.map(([x, y], k) => `${k ? 'L' : 'M'}${n(x)},${n(y)}`).join('');
/** The parts as markup, in turn, each with its line round it. */
function partsSvg(parts: Part[], f: LineFigure): string {
  const t = LINE_M;
  return parts.map((p) => {
    if ('tube' in p) return `<path d="${pts(p.tube)}" fill="none" stroke="${f.line}" stroke-width="${n(p.w + 2 * t)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${pts(p.tube)}" fill="none" stroke="${f.fill}" stroke-width="${n(p.w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if ('dot' in p) return `<circle cx="${n(p.dot[0])}" cy="${n(p.dot[1])}" r="${n(p.r + t / 2)}" fill="${p.dark ? f.line : f.fill}" stroke="${f.line}" stroke-width="${n(t)}"/>`;
    if ('oval' in p) return `<ellipse cx="${n(p.oval[0])}" cy="${n(p.oval[1])}" rx="${n(p.oval[2] + t / 2)}" ry="${n(p.oval[3] + t / 2)}" fill="${p.dark ? f.line : f.fill}" stroke="${f.line}" stroke-width="${n(t)}"/>`;
    if ('poly' in p) return `<path d="${pts(p.poly)}Z" fill="${p.dark ? f.line : f.fill}" stroke="${f.line}" stroke-width="${n(t)}" stroke-linejoin="round"/>`;
    if ('ring' in p) return `<circle cx="${n(p.ring[0])}" cy="${n(p.ring[1])}" r="${n(p.r)}" fill="none" stroke="${f.line}" stroke-width="${n(t)}"/>`;
    return `<path d="${pts(p.pen)}" fill="none" stroke="${f.line}" stroke-width="${n(p.w ?? t)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
}

/**
 * Person `i` in line, metres, standing on the origin and facing right (y down): slim and upright, a shirt over
 * trousers or a skirt, the arms at the sides, swinging in a walk, one raised in a wave, on the hips, or carrying a
 * bag; the hair a cap in outline or filled dark, or long down the back. The same number is the same person; every
 * third stands, the rest walk (as the painted people do).
 */
function linePerson(i: number): Part[] {
  const walking = i % 3 !== 0, skirt = i % 4 === 2, dark = i % 3 === 1, long = i % 5 === 3, bag = i % 4 === 1;
  const pose = walking ? 'walk' : (['stand', 'wave', 'hips', 'stand'] as const)[Math.floor(i / 3) % 4];
  const hip = -0.92, sh = -1.42;
  const feet: [number, number][] = walking ? [[-0.17, -0.04], [0.19, -0.04]] : [[-0.075, -0.04], [0.075, -0.04]];
  const out: Part[] = [];
  const arm = (side: number, elbow: [number, number], hand: [number, number]) => { out.push({ tube: [[side * 0.165, sh + 0.04], elbow, hand], w: 0.066 }, { dot: hand, r: 0.036 }); };
  // the arm behind
  if (pose === 'walk') arm(1, [0.2, -1.2], [0.27, -1.0]);
  else if (pose === 'hips') arm(1, [0.31, -1.16], [0.15, -0.98]);
  else if (pose === 'wave') arm(1, [0.3, -1.5], [0.38, -1.8]);
  else arm(1, [0.2, -1.17], [0.2, -0.93]);
  // long hair down the back, behind the body
  if (long) out.push({ tube: [[-0.07, -1.64], [-0.1, -1.38]], w: 0.1 });
  // the legs, in trousers or bare under a skirt, and the shoes
  feet.forEach(([fx, fy], k) => {
    const hx = k ? 0.065 : -0.065, knee: [number, number] = walking ? [(hx + fx) / 2 + (k ? 0.03 : 0.02), (hip + fy) / 2] : [hx, (hip + fy) / 2];
    out.push({ tube: [[hx, hip], knee, [fx, fy]], w: skirt ? 0.07 : 0.105 }, { oval: [fx + 0.045, fy + 0.015, 0.075, 0.032] });
  });
  // the body: a shirt tapering to the waist; a skirt flaring from it to the knee
  if (skirt) out.push({ poly: [[-0.125, -1.0], [0.125, -1.0], [0.2, -0.52], [-0.2, -0.52]] });
  out.push({ poly: [[-0.175, sh], [0.175, sh], [0.19, -1.3], [0.135, skirt ? -0.98 : hip + 0.04], [-0.135, skirt ? -0.98 : hip + 0.04], [-0.19, -1.3]] });
  // a bag on its strap across the body
  if (bag) out.push({ pen: [[0.15, sh + 0.02], [-0.17, -0.98]] }, { poly: [[-0.27, -1.0], [-0.1, -1.0], [-0.09, -0.83], [-0.28, -0.83]] });
  // the arm in front
  if (pose === 'walk') arm(-1, [-0.2, -1.2], [-0.25, -0.98]);
  else if (pose === 'hips') arm(-1, [-0.31, -1.16], [-0.15, -0.98]);
  else arm(-1, [-0.2, -1.17], [-0.2, -0.93]);
  // the neck, the head, the hair
  out.push({ tube: [[0, sh - 0.01], [0, -1.52]], w: 0.07 }, { dot: [0, -1.635], r: 0.108 });
  out.push({ poly: [[-0.118, -1.63], [-0.112, -1.71], [-0.05, -1.765], [0.04, -1.765], [0.1, -1.72], [0.112, -1.66], [0.04, -1.69], [-0.05, -1.685]], dark });
  if (long) out.push({ tube: [[-0.105, -1.66], [-0.11, -1.5]], w: 0.045 });
  return out;
}

/** Person `i` on a bicycle in line, riding right: thin wheels and frame in the pen alone, the rider leaning to the bars, a helmet. */
function lineRider(i: number): Part[] {
  const R = 0.34, rear: [number, number] = [-0.52, -R], front: [number, number] = [0.52, -R], bb: [number, number] = [0, -0.3], seat: [number, number] = [-0.13, -0.86], head: [number, number] = [0.42, -0.84];
  const hip: [number, number] = [-0.1, -0.94], shoulder: [number, number] = [0.15, -1.42], hand: [number, number] = [0.37, -0.97];
  const up = i % 2 === 0;
  const spokes = (c: [number, number]): Part[] => [0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 4 + (i % 3) * 0.3; return { pen: [[c[0] - Math.cos(a) * R, c[1] - Math.sin(a) * R], [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R]] as [number, number][], w: 0.012 }; });
  return [
    ...spokes(rear), ...spokes(front), { ring: rear, r: R }, { ring: front, r: R },
    // the far leg, down to its pedal
    { tube: [hip, [0.1, -0.66], up ? [-0.06, -0.24] : [0.02, -0.4]], w: 0.1 },
    // the frame, the fork, the bars and the saddle
    { pen: [rear, bb, seat, rear], w: 0.035 }, { pen: [bb, head, front], w: 0.035 }, { pen: [[seat[0] + 0.02, seat[1] + 0.04], head], w: 0.035 },
    { pen: [head, [0.37, -0.98], [0.44, -1.0]], w: 0.035 }, { pen: [[seat[0] - 0.08, seat[1] - 0.02], [seat[0] + 0.07, seat[1] - 0.02]], w: 0.05 },
    // the body leaning to the bars, the near leg and its shoe, the arm
    { poly: [[hip[0] - 0.13, hip[1] + 0.03], [hip[0] + 0.1, hip[1] + 0.1], [shoulder[0] + 0.14, shoulder[1] + 0.05], [shoulder[0] - 0.06, shoulder[1] - 0.09]] },
    { tube: [hip, [0.17, -0.62], up ? [0.09, -0.32] : [0.0, -0.2]], w: 0.105 }, { oval: up ? [0.13, -0.29, 0.075, 0.032] : [0.04, -0.17, 0.075, 0.032] },
    { tube: [[shoulder[0], shoulder[1] + 0.03], [0.3, -1.16], hand], w: 0.066 }, { dot: hand, r: 0.036 },
    // the neck, the head, a helmet
    { tube: [[0.2, -1.47], [0.23, -1.56]], w: 0.07 }, { dot: [0.26, -1.66], r: 0.108 },
    { poly: [[0.14, -1.67], [0.16, -1.76], [0.24, -1.8], [0.34, -1.78], [0.385, -1.7], [0.3, -1.715], [0.2, -1.7]], dark: i % 3 === 0 },
  ];
}

/** A line figure's markup for a drawing's defs, placed with a `<use>`: the patch on the ground, then the parts. */
const figureSvg = (id: string, kind: string, parts: Part[], f: LineFigure, patch: [number, number]) =>
  `<g id="${id}" data-line-figure="${kind}">${f.ground ? `<ellipse cx="0" cy="-0.02" rx="${patch[0]}" ry="${patch[1]}" fill="${f.ground}"/>` : ''}${partsSvg(parts, f)}</g>`;

/** Person `i` in line alone, in vector: markup for a drawing's defs under `id`, standing on the origin, facing right, metres. */
export const linePersonSvg = (id: string, i: number, f: LineFigure): string => figureSvg(id, 'person', linePerson(i % PEOPLE_VARIANTS), f, [0.38, 0.11]);
/** Person `i` on a bicycle in line alone, in vector, riding right: its origin the point under the bicycle's middle. */
export const lineRiderSvg = (id: string, i: number, f: LineFigure): string => figureSvg(id, 'rider', lineRider(i % RIDER_VARIANTS), f, [0.98, 0.14]);

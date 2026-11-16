// The illustrated people of the 3D views (render/axonometric.ts), after the
// flat isometric figures of an illustrator's town: bright tops, trousers or a
// dress, a face and its hair, arms that swing as they walk, now and then a
// bag. Each of a few dozen is painted once as a small picture (as the crowns
// are, render/crowns.ts) and placed, facing either way, at every person who
// takes it: a town of a thousand people prints as a few dozen pictures.

import { paintLayers, type Layer, type CrownPicture } from './crowns.js';

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

const cache = new Map<number, CrownPicture>();

/** Person `i` painted (`perUnit` pixels to the metre): the picture, and the box it covers about their feet, metres. */
export function personPicture(i: number, perUnit = 140): CrownPicture {
  const k = i % PEOPLE_VARIANTS;
  let pic = cache.get(k);
  if (!pic) { pic = paintLayers(personLayers(k), perUnit); cache.set(k, pic); }
  return pic;
}

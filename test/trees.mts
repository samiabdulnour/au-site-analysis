/* The axonometric's trees and people in each deck style (render/axonometric.ts, render/crowns.ts).
 *
 * A crown painted: solid in the middle, clear at its corners, its edge darker than its fill, the same picture for the
 * same arguments, a pixel more or less to the radius as asked. Flamingo draws cloud crowns in the garden's greens and
 * Kingfisher drawn crowns in its own green, each picture once in the drawing however many trees take it, the trees'
 * shadows on the ground, people with legs, and people in a park; Heron and a white model keep the plain discs and
 * slips. Nothing here asks a network.
 *
 *   npx tsx test/trees.mts
 */

import { crownPicture } from '../src/render/crowns.js';
import { drawAxonometric, type AxoScene } from '../src/render/axonometric.js';
import { withTemplate, templateFor } from '../src/render/template.js';
import { massingInks } from '../src/render/atlasKit.js';
import { decodePng } from '../src/lib/png.js';
import type { XY } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const box = (x: number, y: number, w: number, h: number): XY[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

// ---- a crown painted ----

const tones = { edge: '#2f5a3a', dark: '#5f8f63', lit: '#82aa68', high: '#c9dcae' };
for (const kind of ['cloud', 'drawn', 'columnar'] as const) {
  const pic = crownPicture(kind, 1, tones, 0.05, 80);
  const png = decodePng(Buffer.from(pic.uri.replace(/^data:image\/png;base64,/, ''), 'base64'))!;
  check(`${kind}: a PNG`, !!png);
  if (!png) continue;
  const { width: w, height: h, data } = png;
  const px = (x: number, y: number) => { const o = (Math.round(y) * w + Math.round(x)) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
  // where the crown's middle falls in the picture
  const mx = (-pic.x / pic.w) * w, my = (-pic.y / pic.h) * h;
  check(`${kind}: solid in the middle`, px(mx, my)[3] === 255, JSON.stringify(px(mx, my)));
  check(`${kind}: clear at the corners`, px(0, 0)[3] === 0 && px(w - 1, h - 1)[3] === 0);
  // walking right from the middle, the last solid pixel is the outline's, darker than the fill
  let x = Math.round(mx);
  while (x + 1 < w && px(x + 1, my)[3] > 200) x++;
  const lum = (c: number[]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  check(`${kind}: its edge darker than its fill`, lum(px(x, my)) < lum(px(mx, my)) - 20, `${JSON.stringify(px(x, my))} vs ${JSON.stringify(px(mx, my))}`);
  check(`${kind}: about as many pixels to the radius as asked`, Math.abs(w / pic.w - 80) < 1.5, String(w / pic.w));
  check(`${kind}: painted once`, crownPicture(kind, 1, tones, 0.05, 80) === pic);
}

// ---- in each style ----

// a site, two houses, a street and a park, forty trees
const scene = (mono = false): AxoScene => ({
  ring: box(-15, -20, 30, 40), frontNormal: { x: 0, y: -1 }, reach: 120,
  built: [{ rings: [box(-12, -17, 24, 34)], z0: 0, z1: 15, fill: '#d8d0f0', edge: '#1c1c1c', edgeW: 0.2 }],
  neighbours: [{ rings: [box(30, -20, 15, 15)], heightM: 7, fill: '#e8a07a' }, { rings: [box(-50, 10, 15, 15)], heightM: 9, fill: '#e8a07a' }],
  roads: [{ coords: [{ x: -120, y: -30 }, { x: 120, y: -30 }], hierarchy: 4, name: 'A STREET' }], kerbs: [],
  lots: [{ rings: [box(20, 20, 60, 50)], park: true }],
  trees: Array.from({ length: 40 }, (_, i) => ({ p: { x: -80 + (i % 10) * 17, y: 40 + Math.floor(i / 10) * 14 }, r: 1.2 + (i % 6) })),
  inks: { site: '#d43d33', future: '#ffffff', futureEdge: '#888888', envelope: '#333333', kerb: '#99aaaa' },
  mono,
});
/** A person's legs, two to each, as the illustrated look draws them. */
const legs = (svg: string) => (svg.match(/stroke-width="0\.21" stroke-linecap="round"/g) ?? []).length;
const draw = (style: string, mono = false) => withTemplate(templateFor('slides', style), () => ({ svg: drawAxonometric(scene(mono), { x: 0, y: 0, w: 400, h: 280 }, 'tr'), M: massingInks() }));

for (const style of ['flamingo', 'kingfisher']) {
  const { svg, M } = draw(style);
  const pictures = svg.match(/<image id="axo-tr-t\d+" href="data:image\/png/g) ?? [];
  const placed = svg.match(/<use href="#axo-tr-t\d+"/g) ?? [];
  check(`${style}: every tree a placed crown`, placed.length === 40, String(placed.length));
  check(`${style}: each crown's picture once, fewer than the trees`, pictures.length >= 2 && pictures.length < placed.length && new Set(pictures).size === pictures.length, `${pictures.length} pictures`);
  check(`${style}: no plain discs left`, !svg.includes(`fill="${M.treeLight}"`));
  check(`${style}: the trees' shadows on the ground, one picture`, (svg.match(/<image data-shadows href="data:image\/png/g) ?? []).length === 1);
  check(`${style}: people with legs`, legs(svg) >= 20, String(legs(svg)));
  // (a picture's base64 can spell NaN, so the pictures are left out of the search)
  const drawn = svg.replace(/data:image\/png;base64,[^"]+/g, '');
  check(`${style}: no NaN`, !drawn.includes('NaN'), drawn.slice(Math.max(0, drawn.indexOf('NaN') - 200), drawn.indexOf('NaN') + 50));
}
// more people than the plain look's footpaths hold: some walking in twos, and groups in the park
{
  const people = legs(draw('flamingo').svg) / 2, plain = (draw('heron').svg.match(/r="0.3" fill=/g) ?? []).length;
  check('flamingo: a crowd, more people than the plain look draws', people > plain * 1.5, `${people} vs ${plain}`);
}
for (const [style, mono] of [['heron', false], ['canary', false], ['flamingo', true]] as const) {
  const { svg } = draw(style, mono);
  check(`${style}${mono ? ' white model' : ''}: plain discs, no crown pictures`, !svg.includes('<image id="axo-tr-t') && /<circle cx="[^"]+" cy="[^"]+" r="[^"]+" fill=/.test(svg));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('trees: all checks pass');

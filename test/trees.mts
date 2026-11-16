/* The axonometric's trees and people in each deck style (render/axonometric.ts, render/crowns.ts).
 *
 * A crown painted: solid in the middle, clear at its corners, a cloud's edge darker than its fill, a canopy a plain
 * mass with the town's contour round it and its wood showing under it and no form squat, the same picture for the same
 * arguments, a pixel more or less to the radius as asked. Flamingo draws cloud crowns casting shadows and Kingfisher canopies without, on its
 * masterplan's ground and lilac-grey streets, each in its own green, each picture once in the drawing however many
 * trees take it; the painted people, each picture once, and more of them than the plain look, a crowd in the park;
 * Canary and a white model keep the plain discs and slips; Heron draws a line model, white in black outline.
 * Nothing here asks a network.
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
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** A colour's hue, degrees. */
const hue = ([r, g, b]: number[]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const box = (x: number, y: number, w: number, h: number): XY[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

// ---- a crown painted ----

const tones = { edge: '#2f5a3a', dark: '#5f8f63', lit: '#82aa68', high: '#c9dcae' };
for (const kind of ['cloud', 'columnar'] as const) {
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

// a canopy: a plain mass in one colour, the town's thin contour round it, its wood showing under it; no form squat
for (let form = 0; form < 6; form++) {
  const t = { edge: '#b06853', dark: '#9fdcc0', lit: '#79d2a9', high: '#4a4e57' };
  const pic = crownPicture('canopy', form, t, 0.02, 80);
  const png = decodePng(Buffer.from(pic.uri.replace(/^data:image\/png;base64,/, ''), 'base64'))!;
  // the solid pixels by colour (where two layers meet, their edge blends the two)
  const count = new Map<string, number>();
  let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
  for (let i = 0; i < png.width * png.height; i++) {
    if (png.data[i * 4 + 3] !== 255) continue;
    const c = [0, 1, 2].map((k) => png.data[i * 4 + k].toString(16).padStart(2, '0')).join('');
    count.set(c, (count.get(c) ?? 0) + 1);
    if (c === '9fdcc0') { const x = i % png.width, y = Math.floor(i / png.width); lx0 = Math.min(lx0, x); lx1 = Math.max(lx1, x); ly0 = Math.min(ly0, y); ly1 = Math.max(ly1, y); }
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]), solid = top.reduce((k, [, v]) => k + v, 0);
  check(`canopy ${form}: one plain colour, most of it`, top[0]?.[0] === '9fdcc0' && top[0][1] > 0.6 * solid, top.slice(0, 3).map(([c, k]) => `${c}:${k}`).join(' '));
  // (a cypress's or a conifer's wood only the stub of its short trunk)
  check(`canopy ${form}: the contour round it and its wood under it`, (count.get('4a4e57') ?? 0) > 30 && (count.get('b06853') ?? 0) > (form >= 4 ? 5 : 30), `${count.get('4a4e57')} ${count.get('b06853')}`);
  check(`canopy ${form}: not squat, as tall as it is wide or near`, ly1 - ly0 >= 0.88 * (lx1 - lx0), `${lx1 - lx0} × ${ly1 - ly0} px`);
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
/** The people the illustrated look draws, on their feet and on bicycles: placed pictures each. */
const people = (svg: string) => (svg.match(/<use href="#axo-tr-[pr]\d+"/g) ?? []).length;
const draw = (style: string, mono = false) => withTemplate(templateFor('slides', style), () => ({ svg: drawAxonometric(scene(mono), { x: 0, y: 0, w: 400, h: 280 }, 'tr'), M: massingInks() }));

for (const style of ['flamingo', 'kingfisher']) {
  const { svg, M } = draw(style);
  const pictures = svg.match(/<image id="axo-tr-t\d+" href="data:image\/png/g) ?? [];
  const placed = svg.match(/<use href="#axo-tr-t\d+"/g) ?? [];
  check(`${style}: every tree a placed crown`, placed.length === 40, String(placed.length));
  check(`${style}: each crown's picture once, fewer than the trees`, pictures.length >= 2 && pictures.length < placed.length && new Set(pictures).size === pictures.length, `${pictures.length} pictures`);
  check(`${style}: no plain discs left`, !svg.includes(`fill="${M.treeLight}"`));
  if (style === 'kingfisher') check('kingfisher: the masterplan\'s ground and lilac-grey streets', svg.includes('fill="#f1f2e8"') && svg.includes('fill="#d9d7dc"') && svg.includes('stroke="#c4c1c6"'));
  // Kingfisher's vehicles have bodies and wheels (a wheel and its hub to each); Flamingo's are its blocks
  const vehicles = (svg.match(/data-vehicle="/g) ?? []).length, wheels = (svg.match(/fill="#363940"/g) ?? []).length;
  check(`${style}: ${style === 'kingfisher' ? 'vehicles on wheels, two or more each' : 'its block vehicles, no wheels'}`, vehicles > 0 && (style === 'kingfisher' ? wheels >= 2 * vehicles : wheels === 0), `${vehicles} vehicles, ${wheels} wheels`);
  // every crown in the style's own green: its commonest solid colour of the hue of massingInks().tree
  // (Kingfisher's soft yellow-green, for about one tree in five, as well)
  const wants = [hue(rgbOf(M.tree)), ...(style === 'kingfisher' ? [hue(rgbOf('#bccd84'))] : [])], off: string[] = [];
  for (const m of svg.matchAll(/<image id="axo-tr-t\d+" href="data:image\/png;base64,([^"]+)"/g)) {
    const png = decodePng(Buffer.from(m[1], 'base64'))!, count = new Map<string, number>();
    for (let i = 0; i < png.width * png.height; i++) if (png.data[i * 4 + 3] === 255) { const c = `${png.data[i * 4]},${png.data[i * 4 + 1]},${png.data[i * 4 + 2]}`; count.set(c, (count.get(c) ?? 0) + 1); }
    const got = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    if (!wants.some((want) => Math.abs(hue(got) - want) <= 10)) off.push(JSON.stringify(got));
  }
  check(`${style}: every crown in the style's own green (${M.tree}${style === 'kingfisher' ? ', or its yellow-green' : ''})`, off.length === 0, off.slice(0, 3).join(' '));
  const shadows = (svg.match(/<image data-shadows href="data:image\/png/g) ?? []).length;
  check(`${style}: ${style === 'flamingo' ? 'the trees\' shadows on the ground, one picture' : 'no shadows under the canopies'}`, shadows === (style === 'flamingo' ? 1 : 0), String(shadows));
  const riders = (svg.match(/<use href="#axo-tr-r\d+"/g) ?? []).length;
  check(`${style}: the cyclists painted as the people are, on their bicycles`, riders > 0 && !svg.includes('stroke-width="0.21" stroke-linecap="round"'), `${riders} riders`);
  const faces = svg.match(/<image id="axo-tr-p\d+" href="data:image\/png/g) ?? [];
  check(`${style}: the painted people, each picture once`, people(svg) >= 20 && faces.length >= 3 && new Set(faces).size === faces.length, `${people(svg)} people, ${faces.length} pictures`);
  // (a picture's base64 can spell NaN, so the pictures are left out of the search)
  const drawn = svg.replace(/data:image\/png;base64,[^"]+/g, '');
  check(`${style}: no NaN`, !drawn.includes('NaN'), drawn.slice(Math.max(0, drawn.indexOf('NaN') - 200), drawn.indexOf('NaN') + 50));
}
// more people than the plain look's footpaths hold: some walking in twos, and groups in the park
{
  const crowd = people(draw('flamingo').svg), plain = (draw('heron').svg.match(/r="0.3" fill=/g) ?? []).length;
  check('flamingo: a crowd, more people than the plain look draws', crowd > plain * 1.5, `${crowd} vs ${plain}`);
}
for (const [style, mono] of [['canary', false], ['flamingo', true]] as const) {
  const { svg } = draw(style, mono);
  check(`${style}${mono ? ' white model' : ''}: plain discs, no crown pictures`, !svg.includes('<image id="axo-tr-t') && /<circle cx="[^"]+" cy="[^"]+" r="[^"]+" fill=/.test(svg));
}
// Heron's line model, after an architect's axonometric: no shade on a face, every volume white in a black outline,
// the trees white canopies in their contour (pictures, as Kingfisher's), the lawns dotted, what is built in the
// heaviest line
{
  // (its callers give every neighbour white, or a light tone by its storeys: here white, so a shaded face would show)
  // (and a lot that is no park beside the scene's park, so a garden is drawn as well as a lawn)
  const white: AxoScene = { ...scene(), neighbours: scene().neighbours.map((nb) => ({ ...nb, fill: '#ffffff' })), lots: [...scene().lots, { rings: [box(-70, 0, 30, 30)], park: false }] };
  const svg = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(white, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  // Its buildings' outlines are sized on paper, millimetres whatever the drawing's scale: a width in the drawing times
  // its scale is the width on paper. The neighbours' 0.2 mm, what is built 0.3 mm in a 0.55 mm outline, its storeys 0.08.
  const scaleOf = (s: string) => Number(/scale\(([\d.]+)\)/.exec(s)![1]);
  const onPaper = (s: string, w: string) => Math.round(Number(w) * scaleOf(s) * 100) / 100;
  const faces = [...svg.matchAll(/<path d="M[^"]+Z" fill="(#[0-9a-f]{6})"[^>]*stroke="(#1a1a1a)" stroke-width="([\d.]+)" stroke-linejoin="round"\/>/g)].filter((m) => onPaper(svg, m[3]) === 0.2);
  check('heron line model: the neighbours white in a black outline, flat, 0.2 mm on paper', faces.length > 0 && faces.every((m) => m[1] === '#ffffff') && !svg.includes('@@pw'), `${faces.length} faces, ${[...new Set(faces.map((m) => m[1]))].join(' ')}`);
  // the outline holds its width on paper when the same town is drawn in a smaller frame, where a scaled stroke thins
  const small = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(white, { x: 0, y: 0, w: 120, h: 84 }, 'tr'));
  const smallFaces = [...small.matchAll(/<path d="M[^"]+Z" fill="#ffffff"[^>]*stroke="#1a1a1a" stroke-width="([\d.]+)" stroke-linejoin="round"\/>/g)].filter((m) => onPaper(small, m[1]) === 0.2);
  check('heron line model: the outlines keep their width on paper at a smaller scale', scaleOf(small) < scaleOf(svg) * 0.5 && smallFaces.length > 0, `scale ${scaleOf(small)} of ${scaleOf(svg)}, ${smallFaces.length} faces`);
  check('heron line model: the trees white canopies in their contour, each picture once', svg.includes('<image id="axo-tr-t') && !/<circle cx="[^"]+" cy="[^"]+" r="[^"]+" fill="#ffffff" stroke="#1a1a1a" stroke-width="0\.1"\/>/.test(svg));
  const heavy = /fill="none" stroke="#000000" stroke-width="([\d.]+)" stroke-linejoin="round"\/>/.exec(svg);
  check('heron line model: the built in the heaviest outline, 0.55 mm on paper', !!heavy && onPaper(svg, heavy[1]) === 0.55, heavy?.[1]);
  // its walls plain: a massing is a volume, not a facade design. The storeys ruled across them, and no windows on
  // them, neither the other styles' pattern of panes nor any drawn; the same building in Kingfisher has its panes.
  const windowed: AxoScene = { ...white, built: [{ ...white.built[0], windows: true, storeys: [3, 6, 9, 12] }] };
  const plain = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(windowed, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  const panes = withTemplate(templateFor('slides', 'kingfisher'), () => drawAxonometric(windowed, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  check('heron line model: the walls plain, the storeys ruled, no windows', !plain.includes('fill="url(#axo-win-tr)"') && !plain.includes('data-windows')
    && [...plain.matchAll(/<line [^>]*stroke="#1a1a1a" stroke-width="([\d.]+)"\/>/g)].filter((m) => onPaper(plain, m[1]) === 0.08).length >= 8 && panes.includes('fill="url(#axo-win-tr)"'));
  // No grey fills: a building given a tone (a neighbour's band of storeys, what stands on the site) is white, its
  // walls hatched as shade, lines clipped to each wall, the closer the darker its tone and closest on the wall turned
  // from the light; its roof white, and a white building has none.
  const toned: AxoScene = { ...white, built: [{ ...white.built[0], fill: '#b0b0b0' }], neighbours: [{ ...white.neighbours[0], fill: '#ededed' }, { ...white.neighbours[1], fill: '#ffffff' }] };
  const tonedSvg = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(toned, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  const hatches = [...tonedSvg.matchAll(/<clipPath id="(axo-fh\d+-tr)"><path d="M([^"]+)Z" clip-rule="evenodd"\/><\/clipPath><g data-face-hatch clip-path="url\(#axo-fh\d+-tr\)"><path d="([^"]+)" fill="none" stroke="#1a1a1a" stroke-width="([\d.]+)"\/>/g)]
    .map((m) => ({ corners: m[2].split('L').length, d: m[3], w: onPaper(tonedSvg, m[4]) }));
  // the spacing of a hatch's lines, across them: its lines run at 45°, so two neighbours' starts differ by the spacing times √2 along x
  const gap = (d: string) => { const xs = [...d.matchAll(/M([-\d.]+),/g)].map((m) => Number(m[1])); return xs.length > 1 ? (Math.abs(xs[1] - xs[0]) / Math.SQRT2) * scaleOf(tonedSvg) : Infinity; };
  const ofBuilt = hatches.filter((h) => h.w === 0.09), ofNeighbour = hatches.filter((h) => h.w === 0.06);
  check('heron line model: a toned building is white, its walls hatched (a wall has four corners), its roof not; a white one has none',
    ofBuilt.length >= 1 && ofNeighbour.length >= 1 && hatches.length === ofBuilt.length + ofNeighbour.length && hatches.every((h) => h.corners === 4) && !/fill="#(b0b0b0|ededed)"/.test(tonedSvg), `${ofBuilt.length} + ${ofNeighbour.length} of ${hatches.length}`);
  check('heron line model: the darker the tone the closer the hatch, what is built in the firmer line',
    Math.min(...ofBuilt.map((h) => gap(h.d))) < Math.min(...ofNeighbour.map((h) => gap(h.d))), `${ofBuilt.map((h) => gap(h.d).toFixed(2)).join(' ')} | ${ofNeighbour.map((h) => gap(h.d).toFixed(2)).join(' ')}`);
  // as shade: no wall closer than the tone's own spacing (0.6 mm for the darkest), and none over 1.9 times it
  check('heron line model: the hatch opens on a wall turned to the light, as shade', ofBuilt.every((h) => gap(h.d) >= 0.6 - 0.02 && gap(h.d) <= 0.6 * 1.9 + 0.02), ofBuilt.map((h) => gap(h.d).toFixed(2)).join(' '));
  // the other styles fill their tones as before
  check('heron line model: the hatch is Heron\'s alone', !withTemplate(templateFor('slides', 'kingfisher'), () => drawAxonometric(toned, { x: 0, y: 0, w: 400, h: 280 }, 'tr')).includes('data-face-hatch'));
  // its massing black and white, with no colour at all: the scene as its callers give it (a red site, lilac built,
  // peach neighbours, a plane over the site) comes out in greys alone, the site a black dash-dot boundary; the same
  // scene in Kingfisher keeps its colours, so the check can fail
  const hued: AxoScene = { ...scene(), hob: { metres: 20, note: 'PLANE' }, built: [{ ...scene().built[0], windows: true, storeys: [3, 6, 9, 12] }] };
  const inksOf = (s: string) => [...new Set([...s.replace(/data:image\/png;base64,[^"]+/g, '').matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()))];
  const hasHue = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c) > 2; };
  const inHeron = (sc: AxoScene) => inksOf(withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(sc, { x: 0, y: 0, w: 400, h: 280 }, 'tr')));
  const heronInks = inHeron(hued);
  const kfInks = inksOf(withTemplate(templateFor('slides', 'kingfisher'), () => drawAxonometric(hued, { x: 0, y: 0, w: 400, h: 280 }, 'tr')));
  check('heron line model: the massing has no colour at all, every ink a grey', heronInks.length > 3 && !heronInks.some(hasHue), heronInks.filter(hasHue).join(' '));
  check('heron line model: the check can tell (Kingfisher keeps its colours)', kfInks.some(hasHue));
  check('heron line model: the site a black dash-dot boundary, no tint', /<path data-site [^>]*fill="none" stroke="#1a1a1a" stroke-width="0\.4" stroke-dasharray="3,1,0\.6,1"\/>/.test(svg));
  // its compliance views (the town a white model) keep their colours: the walls' and the roofs' bands of sun hours as
  // they are given, and the site in its own colour
  const sunny: AxoScene = { ...hued, mono: true,
    built: [{ ...hued.built[0], cells: [{ ring: 0, edge: 0, t0: 0, t1: 0.5, z0: 0, z1: 3, fill: '#c0533f', flat: true }], roof: [{ pts: box(-10, -15, 5, 5), fill: '#d68a7a' }] }] };
  const sunnyInks = inHeron(sunny);
  check('heron line model: a compliance view keeps the sun hours\' colours and the site\'s', ['#c0533f', '#d68a7a', scene().inks.site].every((c) => sunnyInks.includes(c)), sunnyInks.filter(hasHue).join(' '));
  // each ground surface its own hatch: a park's lawn, a lot's garden, the carriageway, and the shade under the trees;
  // drawn as lines and dots clipped to the surface, never as a pattern fill, which prints as a picture
  const hatch = (n: string) => (svg.match(new RegExp(`<clipPath id="axo-${n}-tr">[\\s\\S]*?<g data-ground="${n}" clip-path="url\\(#axo-${n}-tr\\)"><path d="([^"]*)"[^>]*stroke="(#[0-9a-f]{6})"`)) ?? []);
  const hs = ['lawn', 'yard', 'road', 'shade'].map(hatch);
  check('heron line model: four ground hatches, each clipped to its surface', hs.every((m) => (m[1]?.length ?? 0) > 100), hs.map((m) => m[1]?.length ?? 0).join(' '));
  check('heron line model: the lawn hatched rising, the shade falling, the streets ruled flat, the gardens stippled',
    /^M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)/.test(hs[0][1]) && Number(/^M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)/.exec(hs[0][1])![1]) > Number(/^M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)/.exec(hs[0][1])![2])
    && Number(/^M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)/.exec(hs[3][1])![1]) < Number(/^M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)/.exec(hs[3][1])![2])
    && /^M[-\d.]+,[-\d.]+H/.test(hs[2][1]) && /^M[-\d.]+,[-\d.]+h0/.test(hs[1][1]), hs.map((m) => m[1]?.slice(0, 40)).join(' | '));
  check('heron line model: no pattern fill on the ground', !/fill="url\(#axo-(lawn|yard|road|shade)-/.test(svg));
  check('heron line model: the hatches Heron\'s alone', !draw('kingfisher').svg.includes('data-ground') && !draw('canary').svg.includes('data-ground'));
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('trees: all checks pass');

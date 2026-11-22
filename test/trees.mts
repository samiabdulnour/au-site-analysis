/* The axonometric's trees and people in each deck style (render/axonometric.ts, render/crowns.ts).
 *
 * A crown painted: solid in the middle, clear at its corners, a cloud's edge darker than its fill, a canopy a plain
 * mass with the town's contour round it and its wood showing under it and no form squat, the same picture for the same
 * arguments, a pixel more or less to the radius as asked. Kingfisher draws canopies without shadows on its
 * masterplan's ground and lilac-grey streets, each in its own green, each picture once in the drawing however many
 * trees take it; the painted people, each picture once, and more of them than the plain look, a crowd in the park.
 * Flamingo draws an illustrator's flat town on a cream ground: flat trees in vector (a few plain shapes in its teals,
 * each once in the defs, a trunk's line and a bar on the ground to each, no picture and no shadow), its people and its
 * traffic in line, the cream of its streets with one dark line and a pale orange bar under them; the people in vector
 * at the town's own scale, their hair dark and some of their clothes in a few flat colours; a few trees left in paper;
 * flat shadows.
 * Canary and a white model keep the plain discs and slips; Heron draws a line model, white in black outline.
 * Nothing here asks a network.
 *
 *   npx tsx test/trees.mts
 */

import { crownPicture } from '../src/render/crowns.js';
import { drawAxonometric, wallHatchPitch, frameReachM, LINE_FIGURE_SIZE, type AxoScene } from '../src/render/axonometric.js';
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

/** The opaque pixels of each picture a pattern finds in a drawing: for reading what a painted figure is inked in. */
const picturesOf = (svg: string, re: RegExp) => [...svg.matchAll(re)].map((m) => decodePng(Buffer.from(m[1], 'base64'))!);
for (const style of ['flamingo', 'kingfisher']) {
  const { svg, M } = draw(style);
  const flat = style === 'flamingo';
  const pictures = svg.match(/<image id="axo-tr-t\d+" href="data:image\/png/g) ?? [];
  const placed = svg.match(/<use href="#axo-tr-t\d+"/g) ?? [];
  if (flat) {
    // Flamingo's trees: flat shapes in vector, each form in each teal once in the defs and placed at every tree
    // (a few are left in paper: the streets' cream with the figures' line round the crown, so `data-paper`)
    const all = [...svg.matchAll(/<g id="(axo-tr-f\d+)" data-flat-crown="(\w+)"( data-paper)?>(?:<path d="[^"]+" fill="none" stroke="#[0-9a-f]{6}" stroke-width="[\d.]+" stroke-linejoin="round"\/>)?<path d="[^"]+" fill="(#[0-9a-f]{6})"\/>/g)];
    const stamps = all.filter((m) => !m[3]).map((m) => [m[0], m[1], m[2], m[4]]), papers = all.filter((m) => m[3]);
    check('flamingo: a tree left in paper is the streets\' cream in the figures\' line', papers.every((m) => m[4] === '#fcf9ee' && m[0].includes('stroke="#23262c"')) && papers.length <= all.length / 2, `${papers.length} of ${all.length}`);
    const used = svg.match(/<use href="#axo-tr-f\d+"/g) ?? [];
    check('flamingo: every tree a placed flat crown', used.length === 40 && placed.length === 0 && pictures.length === 0, `${used.length} flat, ${placed.length} painted`);
    check('flamingo: each form once in the defs, fewer than the trees', stamps.length >= 4 && all.length < used.length && new Set(all.map((m) => m[1])).size === all.length, `${all.length} stamps`);
    check('flamingo: several forms among them', new Set(stamps.map((m) => m[2])).size >= 4, [...new Set(stamps.map((m) => m[2]))].join(' '));
    check('flamingo: in its teals, flat: no outline round a crown', stamps.every((m) => ['#167d7f', '#0b5f66', '#5fa59a'].includes(m[3])) && !/data-flat-crown="\w+"><path d="[^"]+" fill="#[0-9a-f]{6}" stroke=/.test(svg), [...new Set(stamps.map((m) => m[3]))].join(' '));
    // a bar on the ground at each tree's foot and a trunk's line up into its crown; a bush sits on the ground with neither
    const bars = (svg.match(/<rect data-tree-bar /g) ?? []).length, bushes = (svg.match(/data-flat-crown="bush"/g) ?? []).length;
    const trunks = (svg.match(/<\/?rect data-tree-bar [^>]*\/><line /g) ?? []).length;
    check('flamingo: a bar at each tree\'s foot and its trunk\'s line', bars === trunks && bars >= 40 - 12 && bars <= 40 && (bushes > 0 || bars === 40), `${bars} bars, ${trunks} trunks`);
  } else {
    check(`${style}: every tree a placed crown`, placed.length === 40, String(placed.length));
    check(`${style}: each crown's picture once, fewer than the trees`, pictures.length >= 2 && pictures.length < placed.length && new Set(pictures).size === pictures.length, `${pictures.length} pictures`);
  }
  check(`${style}: no plain discs left`, !svg.includes(`fill="${M.treeLight}"`));
  if (style === 'kingfisher') check('kingfisher: its streets\' centre line a ruled dashed line', svg.includes('stroke-dasharray="1.4,1.1"') && !svg.includes('data-road-dashes'));
  if (style === 'kingfisher') check('kingfisher: the masterplan\'s ground and lilac-grey streets', svg.includes('fill="#f1f2e8"') && svg.includes('fill="#d9d7dc"') && svg.includes('stroke="#c4c1c6"'));
  // Kingfisher's vehicles have bodies and wheels (a wheel and its hub to each); Flamingo's are the same drawn vehicles
  // in line alone: every part white in the one dark line, the wheels in outline, a pale patch on the road under each
  const vehicles = (svg.match(/data-vehicle="/g) ?? []).length, wheels = (svg.match(/fill="#363940"/g) ?? []).length;
  if (flat) {
    const parts = [...svg.matchAll(/<g data-vehicle="\w+">(.*?)<\/g>/g)].map((m) => m[1]);
    const fills = new Set(parts.flatMap((p2) => [...p2.matchAll(/fill="(#[0-9a-f]{6}|none)"/g)].map((m) => m[1])));
    const strokes = new Set(parts.flatMap((p2) => [...p2.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1])));
    check('flamingo: its vehicles in line alone, the cream of its streets in one dark line', vehicles > 0 && wheels === 0 && [...fills].every((f) => ['#fcf9ee', '#f9dfae', 'none'].includes(f)) && strokes.size === 1 && strokes.has('#23262c'), `${vehicles} vehicles; fills ${[...fills].join(' ')}; strokes ${[...strokes].join(' ')}`);
    // the bars under its trees on the paper and the buildings' shadows in the same pale orange; none of the soft blue shadow
    check('flamingo: flat shadows, the pale orange of the bars', /<g data-cast-shadows opacity="0\.7" fill="#f9dfae">/.test(svg) && /<rect data-tree-bar [^>]*fill="#f9dfae"\/>/.test(svg));
    // the line down each street: short dashes drawn in outline and laid on the road (four corners each), in the streets'
    // cream with the figures' line, where the other styles rule a dashed line
    const dashes = /<path data-road-dashes d="([^"]+)" fill="#fcf9ee" stroke="#23262c" stroke-width="0\.05" stroke-linejoin="round"\/>/.exec(svg);
    const slips = dashes ? dashes[1].split('Z').filter(Boolean) : [];
    check('flamingo: the streets\' centre line as outlined dashes laid on the road', slips.length >= 20 && slips.every((d) => d.split('L').length === 4) && !svg.includes('stroke-dasharray="1.4,1.1"'), `${slips.length} dashes`);
    check('flamingo: a cream ground, its streets a shade lighter', svg.includes('fill="#f9f5e4"') && svg.includes('fill="#fcf9ee"') && M.ground === '#f9f5e4' && M.road === '#fcf9ee');
    check('flamingo: a pale patch on the road under each vehicle', (svg.match(/data-vehicle-patch/g) ?? []).length === vehicles);
  } else check(`${style}: vehicles on wheels, two or more each`, vehicles > 0 && wheels >= 2 * vehicles, `${vehicles} vehicles, ${wheels} wheels`);
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
  check(`${style}: no shadows under the ${flat ? 'flat trees' : 'canopies'}`, shadows === 0, String(shadows));
  const riders = (svg.match(/<use href="#axo-tr-r\d+"/g) ?? []).length;
  check(`${style}: the cyclists drawn as the people are, on their bicycles`, riders > 0 && !svg.includes('stroke-width="0.21" stroke-linecap="round"'), `${riders} riders`);
  if (flat) {
    // Flamingo's people in line alone and in vector: each figure once in the defs, in the cream of its streets with the
    // one dark line and a pale patch under it, no colour and no picture; placed well over life size (1.7 times)
    const figs = [...svg.matchAll(/<g id="(axo-tr-[pr]\d+)" data-line-figure="(person|rider)">(.*?)<\/g>/g)];
    const inks = new Set(figs.flatMap((m) => [...m[3].matchAll(/(?:fill|stroke)="(#[0-9a-f]{6}|none)"/g)].map((x) => x[1])));
    check('flamingo: its people in line alone, each figure once, in vector', people(svg) >= 20 && figs.filter((m) => m[2] === 'person').length >= 3 && figs.some((m) => m[2] === 'rider') && new Set(figs.map((m) => m[1])).size === figs.length && !/<image id="axo-tr-[pr]\d+"/.test(svg), `${people(svg)} people, ${figs.length} figures`);
    // in line: the streets' cream, the dark line (and the hair, filled with it), the pale bar; and the few flat colours
    // some of the clothes take, more than one of them among the people drawn
    const ACCENTS = ['#f6c544', '#ea8a3c', '#b3cdea', '#4a9d9c'];
    check('flamingo: its people in the streets\' cream and one dark line, some clothes in a few flat colours', [...inks].every((c) => ['#fcf9ee', '#23262c', '#f9dfae', 'none', ...ACCENTS].includes(c)) && ACCENTS.filter((c) => inks.has(c)).length >= 2 && inks.has('#fcf9ee'), [...inks].join(' '));
    const sizes = new Set([...svg.matchAll(/<use href="#axo-tr-[pr]\d+" transform="translate\([^)]+\) scale\((-?[\d.]+),([\d.]+)\)"/g)].map((m) => `${Math.abs(Number(m[1]))},${m[2]}`));
    // a sleeve is joined to the body at the shoulder: filled without a line of its own, the line round it an open one
    // (from the shoulder's top down the outside, round the cuff, up the inside to the armpit), so none crosses the shoulder
    const joinedSleeves = figs.filter((m) => m[2] === 'person').every((m) => /<path d="M[^"]+Z" fill="#[0-9a-f]{6}"\/><path d="M[^"Z]+" fill="none" stroke="#23262c"/.test(m[3]));
    check('flamingo: its people\'s sleeves joined to the body at the shoulder', joinedSleeves);
    check('flamingo: its people at the town\'s own scale', sizes.size === 1 && sizes.has(`${LINE_FIGURE_SIZE},${LINE_FIGURE_SIZE}`) && LINE_FIGURE_SIZE === 1, [...sizes].join(' '));
    // at that scale the line round each part is 0.04 m in the scene, so a figure a millimetre tall on paper still reads
    const pens = new Set(figs.flatMap((m) => [...m[3].matchAll(/stroke-width="([\d.]+)"/g)].map((x) => Number(x[1]))));
    check('flamingo: the figures\' line 0.04 m, the spokes finer', pens.has(0.04) && [...pens].every((w) => w <= 0.05), [...pens].join(' '));
  } else {
    const faces = svg.match(/<image id="axo-tr-p\d+" href="data:image\/png/g) ?? [];
    check(`${style}: the painted people, each picture once`, people(svg) >= 20 && faces.length >= 3 && new Set(faces).size === faces.length, `${people(svg)} people, ${faces.length} pictures`);
    // they keep their bright clothes: a good share of each picture is in colour
    const figures = picturesOf(svg, /<image id="axo-tr-[pr]\d+" href="data:image\/png;base64,([^"]+)"/g);
    let vivid = 0, opaque = 0;
    for (const png of figures) for (let i = 0; i < png.width * png.height; i++) {
      if (png.data[i * 4 + 3] !== 255) continue;
      const c = [png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]];
      opaque++;
      if (Math.max(...c) - Math.min(...c) > 60) vivid++;
    }
    check(`${style}: its people in their colours`, vivid > opaque * 0.1, `${vivid} coloured of ${opaque} pixels`);
  }
  // (a picture's base64 can spell NaN, so the pictures are left out of the search)
  const drawn = svg.replace(/data:image\/png;base64,[^"]+/g, '');
  check(`${style}: no NaN`, !drawn.includes('NaN'), drawn.slice(Math.max(0, drawn.indexOf('NaN') - 200), drawn.indexOf('NaN') + 50));
}
// more people than the plain look's footpaths hold: some walking in twos, and groups in the park
{
  const crowd = people(draw('kingfisher').svg), plain = (draw('heron').svg.match(/r="0.3" fill=/g) ?? []).length;
  check('kingfisher: a crowd, more people than the plain look draws', crowd > plain * 1.5, `${crowd} vs ${plain}`);
  // Flamingo's people are at the town's scale too, and as many
  const fl = people(draw('flamingo').svg);
  check('flamingo: a crowd as Kingfisher\'s, at the town\'s scale', fl > plain * 1.5 && Math.abs(fl - crowd) <= crowd * 0.25, `${fl} vs ${crowd}`);
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
  // them: none drawn, and no pattern of panes.
  const windowed: AxoScene = { ...white, built: [{ ...white.built[0], windows: true, storeys: [3, 6, 9, 12] }] };
  const plain = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(windowed, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  check('heron line model: the walls plain, the storeys ruled, no windows', !plain.includes('<pattern') && !plain.includes('data-windows')
    && [...plain.matchAll(/<line [^>]*stroke="#1a1a1a" stroke-width="([\d.]+)"\/>/g)].filter((m) => onPaper(plain, m[1]) === 0.08).length >= 8);
  // Canary marks the same building's walls with a hatch, not the pattern of small squares it had: lines at 45°
  // clipped to a wall turned from the light, in a darker cut of the wall's own colour, 0.14 mm wide on paper, 0.9 mm
  // apart on a wall turned full from the light and opening as it turns toward it; a wall turned to the light plain.
  // Flamingo and Kingfisher have no hatch on any wall. And no style a pattern fill, which the print would rasterise.
  check('wall hatch: closest full from the light, opening toward it, none on a lit wall', wallHatchPitch(-1) === 0.9 && wallHatchPitch(-0.5)! > 0.9 && wallHatchPitch(0.2)! > wallHatchPitch(-0.5)! && wallHatchPitch(0.2)! < 1.6 && wallHatchPitch(0.25) === null && wallHatchPitch(1) === null);
  {
    const col = (frontNormal: { x: number; y: number }): AxoScene => ({ ...scene(), frontNormal, built: [{ ...scene().built[0], fill: '#c04a3a', windows: true, storeys: [3, 6, 9, 12] }] });
    const hatchesOf = (out: string) => [...out.matchAll(/<clipPath id="axo-fh\d+-tr"><path d="M([^"]+)Z" clip-rule="evenodd"\/><\/clipPath><g data-face-hatch clip-path="url\(#axo-fh\d+-tr\)"><path d="([^"]+)" fill="none" stroke="(#[0-9a-f]{6})" stroke-width="([\d.]+)"\/>/g)]
      .map((m) => { const xs = [...m[2].matchAll(/M([-\d.]+),/g)].map((x) => Number(x[1])); return { corners: m[1].split('L').length, ink: m[3], w: onPaper(out, m[4]), gap: xs.length > 1 ? (Math.abs(xs[1] - xs[0]) / Math.SQRT2) * scaleOf(out) : Infinity }; });
    const drawn = (style: string, frontNormal: { x: number; y: number }) => withTemplate(templateFor('slides', style), () => drawAxonometric(col(frontNormal), { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
    // seen from the street to its south, both the walls it shows are turned from the light (which comes from the north-west)
    const south = drawn('canary', { x: 0, y: -1 });
    const hs = hatchesOf(south), mine = hs.filter((h) => h.ink === '#60251d');     // the built's: half of #c04a3a
    check('canary: the walls hatched, not patterned with squares', !south.includes('<pattern') && !south.includes('axo-win') && hs.length >= 1 && hs.every((h) => h.corners === 4), `${hs.length} hatches`);
    check('canary: the hatch a darker cut of the wall\'s own colour, 0.14 mm wide, never black', mine.length === 2 && mine.every((h) => h.w === 0.14) && hs.every((h) => h.ink !== '#1a1a1a'), JSON.stringify(mine));
    const gaps = mine.map((h) => h.gap).sort((a, b) => a - b);
    check('canary: the wall turned further from the light the closer hatched', gaps.length === 2 && gaps[0] >= 0.9 - 0.02 && gaps[1] > gaps[0] + 0.05 && gaps[1] < 1.6, gaps.map((g) => g.toFixed(2)).join(' '));
    // seen from the north, the wall it faces is lit: left plain
    const lit = hatchesOf(drawn('canary', { x: 0, y: 1 })).filter((h) => h.ink === '#60251d').length;
    check('canary: a wall turned to the light is plain', lit < 2, String(lit));
    for (const style of ['flamingo', 'kingfisher']) {
      const out = drawn(style, { x: 0, y: -1 });
      check(`${style}: no hatch on any wall, and no pattern of squares`, !out.includes('data-face-hatch') && !out.includes('<pattern') && !out.includes('axo-win'));
      // its storeys still ruled across the walls
      check(`${style}: the storeys still ruled across the walls`, (out.match(/<line /g) ?? []).length >= 8);
    }
  }
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
  // the other styles fill their tones as before: Kingfisher has no hatch at all, and Canary's is in the wall's colour, never this black
  const tonedIn = (style: string) => withTemplate(templateFor('slides', style), () => drawAxonometric(toned, { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  check('heron line model: the black hatch on white walls is Heron\'s alone', !tonedIn('kingfisher').includes('data-face-hatch') && !/data-face-hatch[^>]*><path d="[^"]+" fill="none" stroke="#1a1a1a"/.test(tonedIn('canary')));
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

// ---- a drawing that fills its frame (Z.'s markup of the built form page, 2026-11: "the image should be bigger and
// cropped by the border, not like this"): the town runs to every edge of the box, where fitting all within reach
// drew a round town in the middle of the sheet with the frame's corners empty.
{
  const FRAME = 600, BOX = { x: 0, y: 30, w: 420, h: 251 };
  const reach = frameReachM(FRAME, BOX, 25);
  // a grid of houses 30 m apart to well past the reach, each its own colour so it can be found again
  const houses: { rings: XY[][]; heightM: number; fill: string; at: XY }[] = [];
  for (let gx = -30; gx <= 30; gx++) for (let gy = -30; gy <= 30; gy++) {
    if (Math.abs(gx) < 2 && Math.abs(gy) < 2) continue;
    const fill = `#${(0x400000 + (gx + 30) * 256 * 3 + (gy + 30) * 3).toString(16)}`;
    houses.push({ rings: [box(gx * 30 - 6, gy * 30 - 6, 12, 12)], heightM: 6, fill, at: { x: gx * 30, y: gy * 30 } });
  }
  const town = (frameM?: number): AxoScene => ({
    ring: box(-15, -20, 30, 40), frontNormal: { x: 0, y: -1 }, reach: frameM ? reach : 300,
    built: [{ rings: [box(-12, -17, 24, 34)], z0: 0, z1: 9, fill: '#d8d0f0', edge: '#1c1c1c', edgeW: 0.2 }],
    neighbours: houses.map(({ rings, heightM, fill }) => ({ rings, heightM, fill })), roads: [], kerbs: [], lots: [], trees: [],
    inks: { site: '#d43d33', future: '#ffffff', futureEdge: '#888888', envelope: '#333333', kerb: '#99aaaa' }, frameM,
  });
  const draw = (frameM?: number) => withTemplate(templateFor('slides', 'canary'), () => drawAxonometric(town(frameM), BOX, 'fr'));
  const fitted = draw(), filled = draw(FRAME);
  // each building drawn ends on its roof, the one path of it with a fill rule; where each lands on the page is read
  // back through the drawing's own transform
  const read = (svg: string) => {
    const [, tx, ty, k] = svg.match(/translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/)!.map(Number);
    const roofs = [...svg.matchAll(/<path d="M([-\d.]+),([-\d.]+)L[^"]*Z" fill="#[0-9a-f]{6}" fill-rule="evenodd"/g)].map((m) => [Number(m[1]) * k + tx, Number(m[2]) * k + ty]);
    const cells = new Set<string>();
    for (const [X, Y] of roofs) if (X >= BOX.x && X <= BOX.x + BOX.w && Y >= BOX.y && Y <= BOX.y + BOX.h) cells.add(`${Math.min(11, Math.floor(((X - BOX.x) / BOX.w) * 12))},${Math.min(7, Math.floor(((Y - BOX.y) / BOX.h) * 8))}`);
    return { tx, ty, k, roofs: roofs.length, cells };
  };
  const pf = read(filled), pt = read(fitted);
  const CORNERS = ['0,0', '11,0', '0,7', '11,7'];
  check('filled, the frame is 600 m of ground across the box', Math.abs(pf.k - BOX.w / FRAME) < 1e-3, String(pf.k));
  check('fitted, the town within 300 m is all that is drawn', pt.roofs > 250 && pt.roofs < 330, String(pt.roofs));
  check('fitted, the corners of the frame were empty (the page as it was)', CORNERS.every((c) => !pt.cells.has(c)), [...pt.cells].filter((c) => CORNERS.includes(c)).join(' '));
  check('filled, every part of the frame holds buildings, its four corners too', pf.cells.size === 96, `${pf.cells.size} of 96 cells; corners missing: ${CORNERS.filter((c) => !pf.cells.has(c)).join(' ')}`);
  check('filled, more of the town is drawn than the 300 m held', pf.roofs > pt.roofs * 1.15, `${pf.roofs} against ${pt.roofs}`);
  const within = houses.filter((h) => Math.hypot(h.at.x, h.at.y) <= reach).length;
  check('filled, what cannot show in the frame is left out: far fewer than all within reach', pf.roofs < within * 0.8, `${pf.roofs} of ${within}`);
  check('the reach asked for takes in the frame\'s corners', reach > Math.hypot(FRAME / 2, (FRAME * BOX.h) / BOX.w / Math.sin((35 * Math.PI) / 180) / 2));
  // a booklet's fold: the filled drawing slides so the site is clear of it, and still fills the frame
  const cleared = withTemplate(templateFor('slides', 'canary'), () => drawAxonometric(town(FRAME), { ...BOX, clear: { x: 210, margin: 22 } }, 'fr'));
  const pc = read(cleared);
  check('filled and cleared of the fold, the drawing has slid sideways at the same scale', Math.abs(pc.k - pf.k) < 1e-6 && Math.abs(pc.tx - pf.tx) > 15, `${pc.tx} against ${pf.tx}`);
}

// ---- black and white alone (Heron's site report): the trees hatched in black inside their contour
{
  const tones = { dark: '#ffffff', lit: '#ffffff', high: '#1a1a1a', edge: '#1a1a1a', wood: 0.45 };
  const plain = crownPicture('canopy', 0, tones, 0.05, 104), hatched = crownPicture('canopy', 0, { ...tones, hatch: { ink: '#1a1a1a', pitch: 0.3, width: 0.045 } }, 0.05, 104);
  const dark = (uri: string) => { const png = decodePng(new Uint8Array(Buffer.from(uri.split(',')[1], 'base64')))!; let ink = 0, solid = 0; for (let i = 0; i < png.data.length; i += 4) { if (png.data[i + 3] > 200) { solid++; if (png.data[i] < 90) ink++; } } return { ink, solid, w: png.width, h: png.height }; };
  const a = dark(plain.uri), b = dark(hatched.uri);
  check('a hatched crown is the same picture with more black in it', a.w === b.w && a.h === b.h && Math.abs(a.solid - b.solid) < a.solid * 0.02 && b.ink > a.ink * 1.5, `${a.ink}/${a.solid} against ${b.ink}/${b.solid}`);
  check('the hatch is lines, not a fill: most of the crown stays white', b.ink < b.solid * 0.5, `${b.ink} of ${b.solid}`);
  const report = withTemplate(templateFor('slides', 'heron'), () => drawAxonometric(scene(), { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  const yieldDeck = withTemplate(templateFor('yield', 'heron'), () => drawAxonometric(scene(), { x: 0, y: 0, w: 400, h: 280 }, 'tr'));
  const stamp = (svg: string) => svg.match(/<image id="axo-tr-t0" href="([^"]+)"/)?.[1] ?? '';
  check('Heron\'s report draws its trees hatched; its yield, as before, white', dark(stamp(report)).ink > dark(stamp(yieldDeck)).ink * 1.5, `${dark(stamp(report)).ink} against ${dark(stamp(yieldDeck)).ink}`);
}

if (failures.length) {
  console.error(`${failures.length} failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('trees: all checks pass');

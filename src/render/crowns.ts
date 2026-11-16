// The illustrated trees' crowns (render/axonometric.ts), each painted once as a
// small picture and placed at every tree that takes it.
//
// A town of a few thousand trees drawn as vectors prints every lobe of every
// crown into the PDF: tens of megabytes a drawing. The PDF keeps a picture
// once however often it is drawn, so a crown is a picture: a shape (one of a
// few, by the tree's place) in a green, at one of three sizes, its outline as
// thick as the others' at that size. Painted here, each layer's edge smoothed
// by its distance from the pixel's middle, and cached for the process.

import { pngDataUri } from './png.js';
import { encodeRgbaPng } from '../lib/png.js';

/** A stable number in [0, 1) for a place and a salt, so a tree or a person drawn again is drawn the same. */
export const rand = (p: { x: number; y: number }, salt = 0) => { const v = Math.sin(p.x * 12.9898 + p.y * 78.233 + salt * 37.719) * 43758.5453; return v - Math.floor(v); };

export type Circle = { x: number; y: number; r: number };
type Seg = { x0: number; y0: number; x1: number; y1: number; w: number };
export type Shape = { circles: Circle[] } | { oval: { x: number; y: number; rx: number; ry: number } } | { seg: Seg } | { segs: Seg[] } | { union: Shape[] };

/** The one contour of the illustrated town's trees, people and vehicles: a thin line of dark slate round each. */
export const CONTOUR = '#4a4e57';
export type Layer = { shape: Shape; ink: string; grow?: number; /** cut out of what is under it: a gap in the leaves */ erase?: boolean };

/** A crown's lobes, radius one about its middle: a core and a ring of lobes round it, the same for the same variant. */
export function lobesOf(variant: number, n0: number, spread: number, ring: number, lobe: number, core: number): Circle[] {
  const seed = { x: variant * 3.1 + 0.7, y: variant * 1.7 + 0.3 };
  const n = n0 + Math.floor(rand(seed, 1) * spread), a0 = rand(seed, 2) * Math.PI * 2;
  const lobes = [{ x: 0, y: 0, r: core }];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i * 2 * Math.PI) / n + (rand(seed, 20 + i) - 0.5) * (2.6 / n);
    const dist = ring * (0.88 + 0.24 * rand(seed, 40 + i)), lr = lobe * (0.86 + 0.28 * rand(seed, 60 + i));
    lobes.push({ x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.94, r: lr });
  }
  return lobes;
}

/** How far a point is outside a shape (negative inside): the union's nearest edge, or an oval's, near enough to smooth by. */
function distance(s: Shape, x: number, y: number): number {
  if ('union' in s) { let d = Infinity; for (const p of s.union) d = Math.min(d, distance(p, x, y)); return d; }
  if ('segs' in s) { let d = Infinity; for (const g of s.segs) d = Math.min(d, distance({ seg: g }, x, y)); return d; }
  if ('seg' in s) {
    const { x0, y0, x1, y1, w } = s.seg, dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
    return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) - w / 2;
  }
  if ('oval' in s) {
    const { x: ox, y: oy, rx, ry } = s.oval, u = (x - ox) / rx, v = (y - oy) / ry, k = Math.hypot(u, v);
    return (k - 1) * Math.min(rx, ry);
  }
  let d = Infinity;
  for (const c of s.circles) { const e = Math.hypot(x - c.x, y - c.y) - c.r; if (e < d) d = e; }
  return d;
}

function extent(s: Shape): [number, number, number, number] {
  if ('union' in s) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.union) { const [a, b, c, d] = extent(p); x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    return [x0, y0, x1, y1];
  }
  if ('segs' in s) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of s.segs) { const [a, b, c, d] = extent({ seg: g }); x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    return [x0, y0, x1, y1];
  }
  if ('seg' in s) { const { x0, y0, x1, y1, w } = s.seg; return [Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w]; }
  if ('oval' in s) { const { x, y, rx, ry } = s.oval; return [x - rx, y - ry, x + rx, y + ry]; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of s.circles) { x0 = Math.min(x0, c.x - c.r); y0 = Math.min(y0, c.y - c.r); x1 = Math.max(x1, c.x + c.r); y1 = Math.max(y1, c.y + c.r); }
  return [x0, y0, x1, y1];
}

/** A shape's pieces, each painted over its own pixels: a union of circles is its circles. */
const piecesOf = (s: Shape): Shape[] => ('union' in s ? s.union.flatMap(piecesOf) : 'circles' in s ? s.circles.map((c) => ({ circles: [c] })) : 'segs' in s ? s.segs.map((g) => ({ seg: g })) : [s]);

const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', ''), v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

/** The tones of a crown: its outline (a canopy's: its branches), its shade, the lit part, the highlight (a canopy's: the light through its leaves). */
export interface CrownTones { edge: string; dark: string; lit: string; high: string }

export type CrownKind = 'cloud' | 'canopy' | 'columnar';

/** The layers of a crown at radius one, bottom first. `outline` is the outline's width, in radii. */
function layersOf(kind: CrownKind, variant: number, t: CrownTones, outline: number): Layer[] {
  const scaled = (cs: Circle[], f: number, ox: number, oy: number): Shape => ({ circles: cs.map((c) => ({ x: ox + c.x * f, y: oy + c.y * f, r: c.r * f })) });
  if (kind === 'columnar') {
    const body = { oval: { x: 0, y: 0, rx: 0.62, ry: 1.3 } };
    return [{ shape: body, ink: t.edge, grow: outline }, { shape: body, ink: t.dark },
      { shape: { oval: { x: -0.09, y: -0.13, rx: 0.5, ry: 1.09 } }, ink: t.lit }, { shape: { oval: { x: -0.22, y: -0.44, rx: 0.21, ry: 0.47 } }, ink: t.high }];
  }
  if (kind === 'cloud') {
    const lobes = lobesOf(variant, 6, 3, 0.5, 0.44, 0.6), all = { circles: lobes };
    return [{ shape: all, ink: t.edge, grow: outline }, { shape: all, ink: t.dark },
      { shape: scaled(lobes, 0.8, -0.1, -0.13), ink: t.lit },
      { shape: scaled(lobes.filter((l) => l.x + l.y < 0.1), 0.46, -0.3, -0.34), ink: t.high }];
  }
  return canopyLayers(variant, t, outline);
}

/**
 * The canopies' forms, radius one about the picture's middle (y down): round, upright, a fuller oval (its underside
 * a little flatter), three masses, and a cypress; none squat. Each is its outline wavering about an oval; `bottom` is how far below the
 * middle its leaves end, where the trunk comes in.
 */
const CANOPIES = [
  { rx: 0.95, ry: 0.97, cy: 0, under: 1 },
  { rx: 0.78, ry: 1.12, cy: -0.04, under: 1 },
  { rx: 0.88, ry: 1.04, cy: -0.02, under: 0.94 },
  { rx: 0.92, ry: 1.0, cy: 0, under: 1, masses: [[-0.36, 0.16, 0.55], [0.36, 0.1, 0.56], [0.02, -0.38, 0.62]] as [number, number, number][] },
  { rx: 0.42, ry: 1.32, cy: -0.08, under: 1 },
];
export const CANOPY_FORMS = CANOPIES.length;
/** How many ways a form's limbs part: a canopy's variant is its form and its branching (form + FORMS × branching). */
export const CANOPY_BRANCHINGS = 3;
/** How far below a canopy's middle its leaves end, in radii. */
export const canopyBottom = (variant: number) => { const c = CANOPIES[variant % CANOPIES.length]; return c.cy + c.ry * c.under; };

/**
 * A canopy as an illustrator draws a tree: a plain mass of leaves with a loose edge broken by small clusters, the
 * town's thin contour round it, and its wood drawn over it, the trunk parting into limbs and the limbs into twigs.
 * Tones: `dark` the leaves, `edge` the wood, `high` the contour; `outline` its width, in radii.
 */
function canopyLayers(variant: number, t: CrownTones, outline: number): Layer[] {
  const form = variant % CANOPIES.length, C = CANOPIES[form], seed = { x: variant * 5.3 + 1.1, y: variant * 2.9 + 0.4 };
  const ph = [rand(seed, 1), rand(seed, 2), rand(seed, 3)].map((v) => v * Math.PI * 2);
  const reach = (a: number) => 1 + 0.08 * Math.sin(3 * a + ph[0]) + 0.05 * Math.sin(5 * a + ph[1]) + 0.03 * Math.sin(8 * a + ph[2]);
  const inside = (x: number, y: number, shrink = 1) => {
    if (C.masses) return C.masses.some(([mx, my, mr]) => Math.hypot(x - mx, y - my) <= mr * shrink * reach(Math.atan2(y - my, x - mx)));
    const u = x / C.rx, v0 = (y - C.cy) / C.ry, v = v0 > 0 ? v0 / C.under : v0;
    return Math.hypot(u, v) <= shrink * reach(Math.atan2(v, u));
  };
  // the mass: larger clusters well inside, small ones strewn to the edge
  const mass: Circle[] = [];
  for (let gy = -1.4; gy <= 1.4; gy += 0.16) for (let gx = -1.2; gx <= 1.2; gx += 0.16) if (inside(gx, gy, 0.8)) mass.push({ x: gx, y: gy, r: 0.14 });
  const n = form === 4 ? 200 : 300;
  for (let i = 0, k = 0; i < n && k < n * 6; k++) {
    const x = (rand(seed, 1000 + k) * 2 - 1) * 1.25, y = (rand(seed, 3000 + k) * 2 - 1) * 1.45;
    if (!inside(x, y)) continue;
    mass.push({ x, y, r: 0.045 + 0.05 * rand(seed, 5000 + k) });
    i++;
  }
  // the wood: the trunk up to the fork, limbs out across the upper crown, a twig or two off each
  const bottom = canopyBottom(variant), top = C.masses ? -0.85 : C.cy - C.ry;
  const fork = form === 4 ? top * 0.6 : bottom - (bottom - top) * (form === 2 ? 0.25 : 0.32);
  const wood: [number, number, number, number, number][] = [[0, bottom + 0.05, 0, fork, 0.075]];
  const limbs = form === 4 ? 1 : 3 + Math.floor(rand(seed, 11) * 2);
  // the fork leans a little, and each tree of a form parts its limbs its own way
  const fx = (rand(seed, 12) - 0.5) * 0.16;
  wood[0][2] = fx;
  for (let j = 0; j < limbs; j++) {
    const spread = limbs === 1 ? 0 : -1 + (2 * j) / (limbs - 1) + (rand(seed, 20 + j) - 0.5) * 0.35;
    let tx = spread * C.rx * (form === 2 ? 0.86 : 0.66) + (rand(seed, 30 + j) - 0.5) * 0.3;
    let ty = top + (bottom - top) * (form === 2 ? 0.28 : 0.15 + 0.3 * Math.abs(spread)) + (rand(seed, 40 + j) - 0.5) * 0.25;
    for (let g = 0; g < 6 && !inside(tx, ty, 0.82); g++) { tx *= 0.85; ty = ty * 0.85 + C.cy * 0.15; }
    // a limb is two pieces, kinked: it leaves the fork steeper and bends out
    const kx = fx + (tx - fx) * (0.35 + 0.2 * rand(seed, 45 + j)) + (rand(seed, 46 + j) - 0.5) * 0.12, ky = fork + (ty - fork) * (0.5 + 0.15 * rand(seed, 47 + j));
    wood.push([fx, fork, kx, ky, 0.05], [kx, ky, tx, ty, 0.036]);
    // a twig off the kink, and one off the end
    const side = tx >= fx ? 1 : -1;
    wood.push([kx, ky, kx + side * (0.12 + 0.14 * rand(seed, 48 + j)), ky - 0.14 - 0.12 * rand(seed, 50 + j), 0.022]);
    wood.push([tx, ty, tx + side * (rand(seed, 52 + j) - 0.6) * 0.24, ty - 0.12 - 0.08 * rand(seed, 53 + j), 0.018]);
  }
  return [{ shape: { circles: mass }, ink: t.high, grow: outline }, { shape: { circles: mass }, ink: t.dark },
    ...wood.map(([x0, y0, x1, y1, w]) => ({ shape: { seg: { x0, y0, x1, y1, w } }, ink: t.edge }))];
}

/** A crown painted: its picture, and the box it covers about the crown's middle, in radii. */
export interface CrownPicture { uri: string; x: number; y: number; w: number; h: number }

const cache = new Map<string, CrownPicture>();

/**
 * The crown of `kind` and `variant` in its tones, `outline` radii wide at its edge, painted `perUnit` pixels to the
 * radius. The same arguments give the same picture, painted once.
 */
export function crownPicture(kind: CrownKind, variant: number, tones: CrownTones, outline: number, perUnit: number): CrownPicture {
  const key = `${kind}|${variant}|${tones.edge}|${tones.dark}|${tones.lit}|${tones.high}|${outline.toFixed(4)}|${perUnit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pic = paintLayers(layersOf(kind, variant, tones, outline), perUnit);
  cache.set(key, pic);
  return pic;
}

/** Layers painted bottom first, `perUnit` pixels to the unit: the picture, and the box it covers in units. */
export function paintLayers(layers: Layer[], perUnit: number): CrownPicture {
  // the box: all the layers', a pixel or two over
  let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
  for (const L of layers) {
    const [a, b, c, d] = extent(L.shape), g = L.grow ?? 0;
    ex0 = Math.min(ex0, a - g); ey0 = Math.min(ey0, b - g); ex1 = Math.max(ex1, c + g); ey1 = Math.max(ey1, d + g);
  }
  const pad = 2 / perUnit;
  const x0 = ex0 - pad, y0 = ey0 - pad, w = Math.ceil((ex1 - ex0 + 2 * pad) * perUnit), h = Math.ceil((ey1 - ey0 + 2 * pad) * perUnit);
  const unit = 1 / perUnit;
  // premultiplied, layer over layer; each layer's cover the most any of its pieces gives a pixel, each piece painted
  // over its own pixels only, so a crown of a few hundred leaves paints as fast as one of a few lobes
  const acc = new Float32Array(w * h * 4), cover = new Float32Array(w * h);
  for (const L of layers) {
    const [r, g, b] = rgbOf(L.ink), grow = L.grow ?? 0;
    cover.fill(0);
    let bx0 = w, bx1 = -1, by0 = h, by1 = -1;
    for (const piece of piecesOf(L.shape)) {
      const [lx0, ly0, lx1, ly1] = extent(piece);
      const px0 = Math.max(0, Math.floor((lx0 - grow - x0) * perUnit) - 1), px1 = Math.min(w - 1, Math.ceil((lx1 + grow - x0) * perUnit) + 1);
      const py0 = Math.max(0, Math.floor((ly0 - grow - y0) * perUnit) - 1), py1 = Math.min(h - 1, Math.ceil((ly1 + grow - y0) * perUnit) + 1);
      bx0 = Math.min(bx0, px0); bx1 = Math.max(bx1, px1); by0 = Math.min(by0, py0); by1 = Math.max(by1, py1);
      for (let py = py0; py <= py1; py++) {
        const uy = y0 + (py + 0.5) * unit;
        for (let px = px0; px <= px1; px++) {
          const a = Math.min(1, Math.max(0, 0.5 - (distance(piece, x0 + (px + 0.5) * unit, uy) - grow) * perUnit));
          const i = py * w + px;
          if (a > cover[i]) cover[i] = a;
        }
      }
    }
    for (let py = by0; py <= by1; py++) for (let px = bx0; px <= bx1; px++) {
      const i = py * w + px, a = cover[i];
      if (a <= 0) continue;
      const o = i * 4, k = 1 - a;
      if (L.erase) { acc[o] *= k; acc[o + 1] *= k; acc[o + 2] *= k; acc[o + 3] *= k; continue; }
      acc[o] = r * a + acc[o] * k; acc[o + 1] = g * a + acc[o + 1] * k; acc[o + 2] = b * a + acc[o + 2] * k; acc[o + 3] = a + acc[o + 3] * k;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = acc[i * 4 + 3];
    if (a <= 0) continue;
    rgba[i * 4] = Math.round(acc[i * 4] / a); rgba[i * 4 + 1] = Math.round(acc[i * 4 + 1] / a); rgba[i * 4 + 2] = Math.round(acc[i * 4 + 2] / a);
    rgba[i * 4 + 3] = Math.round(a * 255);
  }
  return { uri: pngDataUri(encodeRgbaPng(w, h, rgba)), x: x0, y: y0, w: w * unit, h: h * unit };
}

/**
 * The trees' shadows on the ground as one picture: each an oval (scene units, the drawing's own), laid in `ink` at
 * `opacity` where any of them falls, so two that overlap do not darken twice; painted as fine as `maxPixels` allows,
 * up to eight pixels to the unit. Undefined for none.
 */
export function shadowPicture(ovals: { x: number; y: number; rx: number; ry: number }[], ink: string, opacity: number, maxPixels = 2.5e6): CrownPicture | undefined {
  if (!ovals.length) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of ovals) { x0 = Math.min(x0, o.x - o.rx); y0 = Math.min(y0, o.y - o.ry); x1 = Math.max(x1, o.x + o.rx); y1 = Math.max(y1, o.y + o.ry); }
  const perUnit = Math.min(8, Math.sqrt(maxPixels / Math.max(1e-6, (x1 - x0) * (y1 - y0))));
  x0 -= 2 / perUnit; y0 -= 2 / perUnit;
  const w = Math.ceil((x1 - x0) * perUnit) + 2, h = Math.ceil((y1 - y0) * perUnit) + 2, unit = 1 / perUnit;
  const cover = new Float32Array(w * h);
  for (const o of ovals) {
    const px0 = Math.max(0, Math.floor((o.x - o.rx - x0) * perUnit) - 1), px1 = Math.min(w - 1, Math.ceil((o.x + o.rx - x0) * perUnit) + 1);
    const py0 = Math.max(0, Math.floor((o.y - o.ry - y0) * perUnit) - 1), py1 = Math.min(h - 1, Math.ceil((o.y + o.ry - y0) * perUnit) + 1);
    const shape: Shape = { oval: o };
    for (let py = py0; py <= py1; py++) {
      const uy = y0 + (py + 0.5) * unit;
      for (let px = px0; px <= px1; px++) {
        const a = Math.min(1, Math.max(0, 0.5 - distance(shape, x0 + (px + 0.5) * unit, uy) * perUnit));
        const i = py * w + px;
        if (a > cover[i]) cover[i] = a;
      }
    }
  }
  const [r, g, b] = rgbOf(ink), rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (!cover[i]) continue;
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = Math.round(cover[i] * opacity * 255);
  }
  return { uri: pngDataUri(encodeRgbaPng(w, h, rgba)), x: x0, y: y0, w: w * unit, h: h * unit };
}

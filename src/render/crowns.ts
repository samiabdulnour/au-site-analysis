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
/** A crown's tones; `wood`, where set, is how heavy a canopy's trunk and limbs are drawn against their usual width (a line drawing's are fine). */
export interface CrownTones {
  edge: string; dark: string; lit: string; high: string; wood?: number;
  /** A hatch ruled over the whole crown, falling to the right: its ink, the spacing of its lines and their width, in radii. A black and white drawing's trees, told from its white buildings by it. */
  hatch?: { ink: string; pitch: number; width: number };
}

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
// (taller than they would be whole: the arch under each takes some of its height)
const CANOPIES = [
  { rx: 0.95, ry: 1.1, cy: 0, under: 1 },
  { rx: 0.78, ry: 1.2, cy: -0.04, under: 1 },
  { rx: 0.88, ry: 1.14, cy: -0.02, under: 0.94 },
  { rx: 0.92, ry: 1.08, cy: 0, under: 1, masses: [[-0.36, 0.22, 0.55], [0.36, 0.16, 0.56], [0.02, -0.4, 0.64]] as [number, number, number][] },
  { rx: 0.42, ry: 1.32, cy: -0.08, under: 1 },
  // a conifer: a cone, broad at its foot, reaching low on a short trunk
  { rx: 0.86, ry: 1.3, cy: -0.1, under: 1, cone: true },
];
export const CANOPY_FORMS = CANOPIES.length;
/** The forms by name, for the axonometric choosing them. */
export const CANOPY = { cypress: 4, conifer: 5 } as const;
/** How many ways a form's limbs part. */
export const CANOPY_BRANCHINGS = 3;
/**
 * A canopy's variant: its form, the way its limbs part, and whether its underside opens in an arch showing them (a
 * tree with a single trunk) or not (one whose stems, forked low or several from the ground, the drawing gives).
 */
export const canopyVariant = (form: number, branching: number, arch: boolean) => form + CANOPY_FORMS * (branching % CANOPY_BRANCHINGS) + (arch ? 0 : CANOPY_FORMS * CANOPY_BRANCHINGS);
/** How far below a canopy's middle its leaves end, in radii. */
export const canopyBottom = (variant: number) => { const c = CANOPIES[variant % CANOPIES.length]; return c.cy + c.ry * c.under; };

/**
 * A canopy as an illustrator draws a tree: a plain mass of leaves with a broken, leafy edge, the town's thin contour
 * round it, a few small gaps through it; its wood (the trunk parting into limbs, the limbs into twigs) hidden by the
 * leaves but for the trunk, the fork and the lower limbs in an arch the underside opens round it, and a limb glimpsed
 * through a gap. Tones: `dark` the leaves, `edge`
 * the wood, `high` the contour; `outline` its width, in radii.
 */
function canopyLayers(variant: number, t: CrownTones, outline: number): Layer[] {
  const form = variant % CANOPIES.length, C = CANOPIES[form], seed = { x: variant * 5.3 + 1.1, y: variant * 2.9 + 0.4 };
  const arch = variant < CANOPY_FORMS * CANOPY_BRANCHINGS && !('cone' in C) && form !== CANOPY.cypress;
  const ph = [rand(seed, 1), rand(seed, 2), rand(seed, 3)].map((v) => v * Math.PI * 2);
  // the edge broken: a few big bays and lobes, and leafy notches between
  const reach = (a: number) => 1 + 0.1 * Math.sin(3 * a + ph[0]) + 0.06 * Math.sin(5 * a + ph[1]) + 0.05 * Math.sin(11 * a + ph[2]);
  // the underside opens in an arch round the trunk, where the fork and the lower limbs show (not in a cypress)
  const bottom = canopyBottom(variant), fx = (rand(seed, 12) - 0.5) * 0.16;
  const aw = 0.62 * C.rx, ah = arch ? 0.58 * (bottom - C.cy) : 0;
  // (the leaves at its rim, up to 0.07 across, kept out of it by that much)
  const underArch = (x: number, y: number) => ah > 0 && y + 0.06 > bottom - ah * Math.max(0, 1 - Math.abs(x - fx) / aw) ** 0.6;
  const inside = (x: number, y: number, shrink = 1) => {
    if (underArch(x, y)) return false;
    if (C.masses) return C.masses.some(([mx, my, mr]) => Math.hypot(x - mx, y - my) <= mr * shrink * reach(Math.atan2(y - my, x - mx)));
    if ('cone' in C) {
      // the cone: as wide at each height as its foot narrowed towards its tip, its sides tiered
      const top = C.cy - C.ry, foot = C.cy + C.ry, f = (y - top) / (foot - top);
      if (f < 0 || f > 1) return false;
      const half = C.rx * (0.12 + 0.88 * f ** 0.9) * (1 + 0.1 * Math.sin(f * 22 + ph[0])) * shrink;
      return Math.abs(x) <= half && (shrink === 1 || f > 0.06 && f < 0.97);
    }
    const u = x / C.rx, v0 = (y - C.cy) / C.ry, v = v0 > 0 ? v0 / C.under : v0;
    return Math.hypot(u, v) <= shrink * reach(Math.atan2(v, u));
  };
  // the mass: larger clusters well inside, many small ones strewn to the edge, which is made of them
  const mass: Circle[] = [];
  for (let gy = -1.4; gy <= 1.4; gy += 0.14) for (let gx = -1.2; gx <= 1.2; gx += 0.14) if (inside(gx, gy, 0.82)) mass.push({ x: gx, y: gy, r: 0.12 });
  const n = form === 4 ? 360 : 540;
  for (let i = 0, k = 0; i < n && k < n * 6; k++) {
    const x = (rand(seed, 1000 + k) * 2 - 1) * 1.25, y = (rand(seed, 3000 + k) * 2 - 1) * 1.45;
    if (!inside(x, y)) continue;
    mass.push({ x, y, r: 0.025 + 0.035 * rand(seed, 5000 + k) });
    i++;
  }
  // the wood: the trunk up to the fork in the arch, limbs up and out into the crown, a twig or two off each
  const top = C.masses ? -0.85 : C.cy - C.ry;
  const single = form === CANOPY.cypress || 'cone' in C;
  const fork = single ? bottom - 0.12 : bottom - ah * 0.18;
  const wood: [number, number, number, number, number][] = [[0, bottom + 0.05, 0, fork, 0.075]];
  const limbs = single ? 1 : 3 + Math.floor(rand(seed, 11) * 2);
  // the fork leans a little, and each tree of a form parts its limbs its own way
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
  // The wood is hidden by the leaves, as a tree is: it shows only where it is out of them, below the crown, in the
  // arch under it, and through the gaps in the leaves: a few small irregular openings at random, each one to three
  // clusters overlapping, outlined as the crown is; where a limb passes behind one, it shows.
  const inMass = (x: number, y: number) => mass.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r);
  const gaps: Circle[] = [], centres: { x: number; y: number }[] = [];
  // as many as chance gives (one to four; none to two in a cypress), each anywhere well inside, of its own size, apart
  const want = form === 4 ? Math.floor(rand(seed, 800) * 3) : 1 + Math.floor(rand(seed, 800) * 4);
  for (let k = 0; centres.length < want && k < 60; k++) {
    const gx = (rand(seed, 830 + k) * 2 - 1) * C.rx * 0.85, gy = C.cy + (rand(seed, 840 + k) * 2 - 1) * C.ry * 0.8;
    if (!inside(gx, gy, 0.7) || centres.some((c) => Math.hypot(c.x - gx, c.y - gy) < 0.38)) continue;
    centres.push({ x: gx, y: gy });
    const parts = 1 + Math.floor(rand(seed, 850 + k) * 3), size = 0.7 + 0.7 * rand(seed, 855 + k);
    for (let q = 0; q < parts; q++) {
      const a = rand(seed, 860 + k * 7 + q) * Math.PI * 2, dd = q ? (0.035 + 0.04 * rand(seed, 870 + k * 7 + q)) * size : 0;
      gaps.push({ x: gx + Math.cos(a) * dd, y: gy + Math.sin(a) * dd, r: (0.03 + 0.03 * rand(seed, 880 + k * 7 + q)) * size });
    }
  }
  const inGap = (x: number, y: number) => gaps.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r);
  // each piece of wood cut to the stretches that show (a line drawing's wood finer: the tones' `wood`)
  const shown: Seg[] = [], woodK = t.wood ?? 1;
  for (const [x0, y0, x1, y1, w] of wood) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.01));
    let from = -1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, see = !inMass(x, y) || inGap(x, y);
      if (see && from < 0) from = t;
      if ((!see || k === steps) && from >= 0) {
        const t1 = see ? t : (k - 1) / steps;
        if (t1 > from) shown.push({ x0: x0 + (x1 - x0) * from, y0: y0 + (y1 - y0) * from, x1: x0 + (x1 - x0) * t1, y1: y0 + (y1 - y0) * t1, w: w * woodK });
        from = -1;
      }
    }
  }
  return [{ shape: { circles: mass }, ink: t.high, grow: outline }, { shape: { circles: mass }, ink: t.dark },
    ...(gaps.length ? [{ shape: { circles: gaps }, ink: t.high, grow: outline }, { shape: { circles: gaps }, ink: '#000000', erase: true }] : []),
    ...(shown.length ? [{ shape: { segs: shown }, ink: t.edge }] : [])];
}

/** A crown painted: its picture, and the box it covers about the crown's middle, in radii. */
export interface CrownPicture { uri: string; x: number; y: number; w: number; h: number }

const cache = new Map<string, CrownPicture>();

/**
 * The crown of `kind` and `variant` in its tones, `outline` radii wide at its edge, painted `perUnit` pixels to the
 * radius. The same arguments give the same picture, painted once.
 */
export function crownPicture(kind: CrownKind, variant: number, tones: CrownTones, outline: number, perUnit: number): CrownPicture {
  const key = `${kind}|${variant}|${tones.edge}|${tones.dark}|${tones.lit}|${tones.high}|${tones.wood ?? 1}|${tones.hatch ? `${tones.hatch.ink}/${tones.hatch.pitch}/${tones.hatch.width}` : ''}|${outline.toFixed(4)}|${perUnit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pic = paintLayers(layersOf(kind, variant, tones, outline), perUnit, tones.hatch);
  cache.set(key, pic);
  return pic;
}

/** Layers painted bottom first, `perUnit` pixels to the unit: the picture, and the box it covers in units. */
export function paintLayers(layers: Layer[], perUnit: number, hatch?: { ink: string; pitch: number; width: number }): CrownPicture {
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
  // a hatch over all that was painted: lines falling to the right, each softened at its edges, where the picture holds
  if (hatch) {
    const [hr, hg, hb] = rgbOf(hatch.ink), pitch = hatch.pitch * perUnit * Math.SQRT2, half = Math.max(0.5, (hatch.width * perUnit * Math.SQRT2) / 2);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const o = (py * w + px) * 4, a0 = acc[o + 3];
      if (a0 <= 0.05) continue;
      // the distance to the nearest line of the family x − y = n · pitch, across the lines
      const t = ((px - py) % pitch + pitch) % pitch, dist = Math.min(t, pitch - t) / Math.SQRT2;
      const c = Math.min(1, Math.max(0, half / Math.SQRT2 + 0.5 - dist));
      if (c <= 0) continue;
      // laid atop what is there, within its own cover: the picture's edge stays its edge
      const a = c * a0, k = 1 - c;
      acc[o] = hr * a + acc[o] * k; acc[o + 1] = hg * a + acc[o + 1] * k; acc[o + 2] = hb * a + acc[o + 2] * k;
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

// ---- flat crowns, in vector ----

/**
 * The flat trees of an illustrator's isometric town (Flamingo's): a few plain shapes in one flat colour, no outline
 * and no shading, the trunk's line running up into each with a branch or two off it. A three-lobed crown, a round
 * one, a six-sided one, a bell (a small head on wide shoulders), a conifer's triangle, a cypress's pointed oval, a
 * shield ruled down its length, and a low bush with no trunk.
 */
export type FlatForm = 'trefoil' | 'round' | 'hex' | 'bell' | 'cone' | 'cypress' | 'shield' | 'bush';
const ring = (x: number, y: number, r: number) => `M${(x - r).toFixed(3)},${y}a${r},${r} 0 1,0 ${(2 * r).toFixed(3)},0a${r},${r} 0 1,0 ${(-2 * r).toFixed(3)},0Z`;
/** Each form at a radius of one about its crown's middle (y down): its outline, where it ends below the middle, and the lines drawn in it. */
const FLAT: Record<FlatForm, { d: string; bottom: number; lines: string }> = {
  trefoil: { d: ring(0, -0.36, 0.62) + ring(-0.43, 0.2, 0.58) + ring(0.43, 0.2, 0.58), bottom: 0.76, lines: 'M0,0.76V-0.3M0,0.3L-0.3,-0.02M0,0.08L0.27,-0.2' },
  round: { d: ring(0, 0, 0.92), bottom: 0.92, lines: 'M0,0.92V-0.36M0,0.34L-0.3,0.02M0,0.1L0.28,-0.2M0,-0.1L-0.2,-0.32' },
  hex: { d: 'M-1,0L-0.5,-0.866H0.5L1,0L0.5,0.866H-0.5Z', bottom: 0.866, lines: 'M0,0.866V-0.42M0,0.3L-0.32,-0.04M0,0.02L0.3,-0.3' },
  bell: { d: 'M-0.74,0.74V0.3C-0.74,-0.28 -0.4,-0.42 -0.38,-0.8C-0.36,-1.22 0.36,-1.22 0.38,-0.8C0.4,-0.42 0.74,-0.28 0.74,0.3V0.74Z', bottom: 0.74, lines: 'M0,0.74V-0.6M0,0.22L-0.28,-0.06M0,-0.04L0.24,-0.3' },
  cone: { d: 'M0,-1.5L0.74,0.78H-0.74Z', bottom: 0.78, lines: 'M0,0.78V-0.9' },
  cypress: { d: 'M0,-1.55C0.56,-0.9 0.62,0.2 0.42,0.72Q0,0.94 -0.42,0.72C-0.62,0.2 -0.56,-0.9 0,-1.55Z', bottom: 0.84, lines: 'M0,0.84V-0.95' },
  shield: { d: 'M-0.7,-0.78H0.7V0.1C0.7,0.6 0.3,0.86 0,0.96C-0.3,0.86 -0.7,0.6 -0.7,0.1Z', bottom: 0.96, lines: 'M0,0.96V-0.78M-0.35,0.62V-0.78M0.35,0.62V-0.78' },
  bush: { d: 'M-0.95,0.3A0.42,0.42 0 0 1 -0.38,-0.02A0.52,0.52 0 0 1 0.38,-0.02A0.42,0.42 0 0 1 0.95,0.3Z', bottom: 0.3, lines: '' },
};
/** Where a flat crown ends below its middle, in radii: where its trunk comes out. */
export const flatBottom = (form: FlatForm): number => FLAT[form].bottom;
/**
 * A flat crown at a radius of one, in `fill`, the lines in it in `line` and `width` of the radius wide: markup for a
 * drawing's defs, placed with a `<use>` at each tree's size.
 */
export function flatCrownSvg(id: string, form: FlatForm, fill: string, line: string, width = 0.05): string {
  const f = FLAT[form];
  return `<g id="${id}" data-flat-crown="${form}"><path d="${f.d}" fill="${fill}"/>${f.lines ? `<path d="${f.lines}" fill="none" stroke="${line}" stroke-width="${width.toFixed(4)}" stroke-linecap="round"/>` : ''}</g>`;
}


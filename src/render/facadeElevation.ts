// The facades unfolded: every face of a scheme laid flat side by side, storey
// by storey, each cell coloured by the hours of sun it has at mid winter
// (lib/solarAccess.ts facadeSun), so the faces a massing drawing hides are
// read with the rest.
//
// The outside faces of the lowest tier run left to right as one walks round
// the building with its walls on the left, from the face nearest north; each
// is seen from outside, so the strip is continuous, corner to corner, each
// corner a fold. A face of an upper tier, stepped back, stands over the face
// below it that looks the same way, where it is in plan; a courtyard's walls
// unfold in a strip of their own under the outside's. The colours step at the
// hours that matter: under two hours the cool end, two and over the warm,
// where ADG 4A-1's hours begin, both in the deck's palette (sunBands).

import { esc } from './chrome.js';
import { deckFamilies, deckLook, luminance } from './template.js';
import { paletteRamp } from './atlasKit.js';
import type { FacadeFace } from '../lib/solarAccess.js';
import type { XY } from '../lib/yield.js';

/** A band of hours: up to where it runs, its fill, the ink a figure on it is set in, its word in the key. */
export interface SunBand { upTo: number; fill: string; ink: string; label: string }

type Families = ReturnType<typeof deckFamilies>;
/**
 * Each style's six tones, taken straight from its palette (its families and the ramp its heights page runs
 * across): its blues short of two hours, darkest where there is none; from two hours its warm tones, the most
 * vivid at four hours and over, so the faces with the most sun glow rather than darken. Checked with the dataviz
 * validator: blue against warm at the two-hour line clear in every style (ΔE ≥ 10, ≥ 7 for colour-blind readers);
 * neighbouring blues ΔE ≥ 11; the warm bands apart at full colour vision (ΔE ≥ 10), though Flamingo's amber and
 * coral (3–4 h, 4 h and over), both passes, come close for a deutan reader.
 */
const SUN_PICKS: Record<string, (f: Families, ramp: string[]) => string[]> = {
  flamingo: (f, r) => [f.blue.deep, f.blue.line, f.blue.solid, f.orange.solid, r[2], f.red.solid],
  heron: (f, r) => [f.blue.deep, r[0], f.blue.solid, f.orange.mid, f.orange.text, f.orange.deep],
  kingfisher: (f, r) => [f.blue.deep, f.blue.line, f.blue.solid, f.orange.line, f.red.solid, r[2]],
  canary: (f) => [f.blue.deep, f.blue.line, f.blue.mid, f.orange.mid, f.red.mid, f.red.solid],
};
const LABELS = ['none', 'under 1 h', '1–2 h', '2–3 h', '3–4 h', '4 h and over'];
const UP_TO = [0, 1, 2, 3, 4, Infinity];

const BANDS_BY_PALETTE = new WeakMap<object, SunBand[]>();
/** The bands of hours a cell is coloured by, in the deck's own palette (SUN_PICKS); a style without picks takes Flamingo's rule. */
export function sunBands(): SunBand[] {
  const f = deckFamilies();
  const hit = BANDS_BY_PALETTE.get(f);
  if (hit) return hit;
  const pick = SUN_PICKS[deckLook().id] ?? SUN_PICKS.flamingo;
  const bands = pick(f, paletteRamp()).map((fill, i) => ({ upTo: UP_TO[i], fill, ink: luminance(fill) > 0.32 ? '#1c1c1c' : '#ffffff', label: LABELS[i] }));
  BANDS_BY_PALETTE.set(f, bands);
  return bands;
}
export const bandOf = (h: number): SunBand => sunBands().find((b) => (b.upTo === 0 ? h <= 1e-9 : h <= b.upTo + 1e-9))!;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (bearing: number) => COMPASS[Math.round(bearing / 22.5) % 16];
const angleBetween = (a: XY, b: XY) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));

/** A face's place in the unfolding: its strip, and where it starts and ends along it, metres. */
interface Placed { face: FacadeFace; strip: number; x0: number; x1: number; base: boolean }

/** Where each face goes: the lowest tier's rings as strips, the upper tiers' faces over the faces below them. */
function unfold(faces: FacadeFace[]): { placed: Placed[]; strips: { courtyard: boolean; lengthM: number }[] } {
  const live = faces.filter((f) => f.cells.length);
  if (!live.length) return { placed: [], strips: [] };
  const baseTier = live.reduce((m, f) => (f.from < m.from ? f : m), live[0]).tier;
  const rings = [...new Set(live.filter((f) => f.tier === baseTier).map((f) => f.ring))];
  // the outside first, then each courtyard
  rings.sort((p, q) => Number(live.find((f) => f.tier === baseTier && f.ring === p)!.courtyard) - Number(live.find((f) => f.tier === baseTier && f.ring === q)!.courtyard));
  const placed: Placed[] = [];
  const strips: { courtyard: boolean; lengthM: number }[] = [];
  rings.forEach((ring) => {
    const own = live.filter((f) => f.tier === baseTier && f.ring === ring).sort((p, q) => p.edge - q.edge);
    // walk the ring the way that keeps the building on the left: each face's a is where the last one's b was
    const forward = own.length < 2 || Math.hypot(own[0].b.x - own[1].a.x, own[0].b.y - own[1].a.y) < Math.hypot(own[1].b.x - own[0].a.x, own[1].b.y - own[0].a.y);
    const order = forward ? own : [...own].reverse();
    // from the face nearest north
    const start = order.reduce((m, f, i) => (Math.min(f.bearing, 360 - f.bearing) < Math.min(order[m].bearing, 360 - order[m].bearing) ? i : m), 0);
    const walk = [...order.slice(start), ...order.slice(0, start)];
    let x = 0;
    const strip = strips.length;
    for (const f of walk) { placed.push({ face: f, strip, x0: x, x1: x + f.lengthM, base: true }); x += f.lengthM; }
    strips.push({ courtyard: walk[0].courtyard, lengthM: x });
  });
  // each upper face over the base face that looks the same way and stands nearest, where it falls along it
  const bases = placed.slice();
  for (const f of live.filter((g) => g.tier !== baseTier)) {
    let best: Placed | undefined, score = Infinity;
    for (const p of bases) {
      if (p.face.courtyard !== f.courtyard) continue;
      const ang = angleBetween(p.face.normal, f.normal);
      if (ang > (35 * Math.PI) / 180) continue;
      const mid = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
      const off = Math.abs((mid.x - p.face.a.x) * p.face.normal.x + (mid.y - p.face.a.y) * p.face.normal.y);
      const sc = ang * 20 + off;
      if (sc < score) { score = sc; best = p; }
    }
    if (!best) continue;
    const L = best.face.lengthM, dir = { x: (best.face.b.x - best.face.a.x) / L, y: (best.face.b.y - best.face.a.y) / L };
    const along = (p: XY) => (p.x - best!.face.a.x) * dir.x + (p.y - best!.face.a.y) * dir.y;
    const u0 = along(f.a), u1 = along(f.b);
    placed.push({ face: f, strip: best.strip, x0: best.x0 + Math.min(u0, u1), x1: best.x0 + Math.max(u0, u1), base: false });
  }
  return { placed, strips };
}

/** A face's hours, averaged over its cells; and the share of its cells with `hours` or more. */
export function faceSummary(f: FacadeFace, hours = 2, future = false): { average: number; share: number } {
  const hs = f.cells.map((c) => (future ? c.hoursFuture ?? c.hours : c.hours));
  return { average: hs.reduce((a, b) => a + b, 0) / Math.max(1, hs.length), share: hs.filter((h) => h >= hours - 1e-9).length / Math.max(1, hs.length) };
}

/**
 * The faces unfolded into a box (sheet millimetres): the strips stacked, the outside's first, at one scale, true to
 * the faces' widths and the storeys' heights; each cell in its band's colour with its hours in it where it has room;
 * each fold dashed; under each face of the lowest tier the way it looks and its average hours.
 */
export function unfoldedFacades(faces: FacadeFace[], levels: { bottom: (s: number) => number; top: (s: number) => number }, box: { x: number; y: number; w: number; h: number },
  opts: { future?: boolean; hours?: number } = {}): { svg: string; scale: number } {
  const { placed, strips } = unfold(faces);
  if (!placed.length) return { svg: '', scale: 0 };
  const hoursOf = (c: FacadeFace['cells'][number]) => (opts.future ? c.hoursFuture ?? c.hours : c.hours);
  // each strip as tall as its own faces rise (a courtyard often less than the outside)
  const topOf = strips.map((_, si) => Math.max(...placed.filter((p) => p.strip === si).map((p) => levels.top(p.face.to))));
  const LABEL = 7, TITLE = 4.5, GAP = 6;   // mm under a strip for its faces' names, over it for its own, between strips
  const minX = Math.min(...placed.map((p) => p.x0)), maxX = Math.max(...placed.map((p) => p.x1));
  const k = Math.min(box.w / (maxX - minX), (box.h - strips.length * (LABEL + TITLE) - (strips.length - 1) * GAP) / topOf.reduce((a, b) => a + b, 0));
  const out: string[] = [];
  let y = box.y;
  strips.forEach((strip, si) => {
    const ground = y + TITLE + topOf[si] * k;
    const X = (m: number) => box.x + (m - minX) * k, Z = (m: number) => ground - m * k;
    out.push(`<text x="${box.x.toFixed(2)}" y="${(y + 3).toFixed(2)}" font-size="2.6" font-weight="700" letter-spacing="0.25">${esc(strip.courtyard ? 'THE COURTYARD, ITS WALLS UNFOLDED' : 'THE OUTSIDE, UNFOLDED FROM THE FACE NEAREST NORTH')}</text>`);
    const own = placed.filter((p) => p.strip === si);
    // the cells, the lowest tier's first so a face stepped back stands over them
    for (const p of [...own].sort((a, b) => Number(a.base === false) - Number(b.base === false))) {
      const f = p.face, w = p.x1 - p.x0;
      for (const c of f.cells) {
        const cx0 = X(p.x0 + c.t0 * w), cx1 = X(p.x0 + c.t1 * w), cz1 = Z(levels.bottom(c.storey)), cz0 = Z(levels.top(c.storey));
        if (f.blank) { out.push(`<rect x="${cx0.toFixed(2)}" y="${cz0.toFixed(2)}" width="${(cx1 - cx0).toFixed(2)}" height="${(cz1 - cz0).toFixed(2)}" fill="#d9d9d6" stroke="#ffffff" stroke-width="0.15"/>`); continue; }
        const h = hoursOf(c), band = bandOf(h);
        out.push(`<rect x="${cx0.toFixed(2)}" y="${cz0.toFixed(2)}" width="${(cx1 - cx0).toFixed(2)}" height="${(cz1 - cz0).toFixed(2)}" fill="${band.fill}" stroke="#ffffff" stroke-width="0.15"/>`);
        if (cx1 - cx0 >= 4.2 && cz1 - cz0 >= 2.4) out.push(`<text x="${((cx0 + cx1) / 2).toFixed(2)}" y="${((cz0 + cz1) / 2 + 0.6).toFixed(2)}" text-anchor="middle" font-size="1.7" fill="${band.ink}">${h % 1 ? h.toFixed(2).replace(/0$/, '') : h.toFixed(0)}</text>`);
      }
      // the face's outline, and its fold
      out.push(`<rect x="${X(p.x0).toFixed(2)}" y="${Z(levels.top(f.to)).toFixed(2)}" width="${(X(p.x1) - X(p.x0)).toFixed(2)}" height="${(Z(levels.bottom(f.from)) - Z(levels.top(f.to))).toFixed(2)}" fill="none" stroke="#1c1c1c" stroke-width="0.25"/>`);
      if (f.blank) out.push(`<text x="${((X(p.x0) + X(p.x1)) / 2).toFixed(2)}" y="${((Z(levels.bottom(f.from)) + Z(levels.top(f.to))) / 2 + 0.8).toFixed(2)}" text-anchor="middle" font-size="2" fill="#5a5a5a">BLANK WALL</text>`);
    }
    // the ground, and under each face of the lowest tier the way it looks and its hours
    const ends = own.flatMap((q) => [q.x0, q.x1]);
    out.push(`<line x1="${X(Math.min(...ends)).toFixed(2)}" y1="${ground.toFixed(2)}" x2="${X(Math.max(...ends)).toFixed(2)}" y2="${ground.toFixed(2)}" stroke="#1c1c1c" stroke-width="0.35"/>`);
    for (const p of own.filter((q) => q.base)) {
      const mid = (X(p.x0) + X(p.x1)) / 2, wMm = X(p.x1) - X(p.x0);
      out.push(`<line x1="${X(p.x0).toFixed(2)}" y1="${(ground + 0.6).toFixed(2)}" x2="${X(p.x0).toFixed(2)}" y2="${(ground + 2).toFixed(2)}" stroke="#1c1c1c" stroke-width="0.2"/>`);
      if (wMm < 7) continue;
      const sm = faceSummary(p.face, opts.hours ?? 2, opts.future);
      out.push(`<text x="${mid.toFixed(2)}" y="${(ground + 3.4).toFixed(2)}" text-anchor="middle" font-size="2.2" font-weight="700">${esc(compass(p.face.bearing))}</text>`);
      if (wMm >= 14) out.push(`<text x="${mid.toFixed(2)}" y="${(ground + 6).toFixed(2)}" text-anchor="middle" font-size="1.9" fill="#5a5a5a">${esc(p.face.blank ? 'blank' : `${sm.average.toFixed(1)} h · ${Math.round(sm.share * 100)}% ${opts.hours ?? 2} h+`)}</text>`);
    }
    y = ground + LABEL + GAP;
  });
  return { svg: out.join(''), scale: k };
}

/** The key to the bands, a row of swatches, for a page's key or a drawing's foot. */
export function sunBandKey(x: number, y: number): string {
  return sunBands().map((b, i) => `<rect x="${(x + i * 17).toFixed(2)}" y="${y.toFixed(2)}" width="4" height="3" fill="${b.fill}"/><text x="${(x + i * 17 + 5).toFixed(2)}" y="${(y + 2.4).toFixed(2)}" font-size="2.2">${esc(b.label)}</text>`).join('');
}

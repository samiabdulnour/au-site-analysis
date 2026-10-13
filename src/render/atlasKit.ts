// The atlas kit: the five ink families of the office's palette, the
// patterns that tell categories apart inside one family, and the chart
// blocks of the feasibility template (Z. 2026-10).
//
// One family per topic, at most five in the book. Inside a family a
// category is told by its pattern — a tint, vertical lines, horizontal
// lines, dots, waves — not by a lighter or darker shade. Patterns are drawn
// as clipped vector strokes, not SVG <pattern>s, which Chromium rasterises
// blurrily in the printed PDF.

import { esc } from './chrome.js';

export type Family = 'red' | 'orange' | 'sage' | 'green' | 'blue';

/** Sampled from the office's swatch sheet: three tints, the two pattern inks, and a text ink dark enough for the bold narrative. */
export const INK: Record<Family, { solid: string; mid: string; light: string; line: string; deep: string; text: string }> = {
  red:    { solid: '#d54747', mid: '#e69ea1', light: '#f4d8d9', line: '#d54747', deep: '#b20000', text: '#d54747' },
  orange: { solid: '#e9a879', mid: '#f3d2ba', light: '#faeee3', line: '#efbf99', deep: '#df726a', text: '#f5a470' },
  sage:   { solid: '#cbcbb9', mid: '#e5e5dc', light: '#f5f5f1', line: '#d9c49c', deep: '#9c9c88', text: '#8f8f78' },
  green:  { solid: '#7bb990', mid: '#bbdcc7', light: '#e4f0e9', line: '#7bb990', deep: '#2f8f55', text: '#4e9a69' },
  blue:   { solid: '#b2daf5', mid: '#d8ecf9', light: '#eff8fd', line: '#9fcbea', deep: '#4b55a0', text: '#0068b3' },
};

/** A fill: a ground tint, an optional pattern of strokes over it, an optional outline. Sizes in map millimetres. */
export interface Fill {
  bg?: string;
  kind?: 'vlines' | 'hlines' | 'dots' | 'waves';
  ink?: string;
  step?: number;
  w?: number;
  outline?: string;
  outlineW?: number;
  dash?: string;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/** The strokes of a pattern over a box, scaled by k (k > 1 draws finer, for a reduced swatch). */
function strokes(f: Fill, bb: Box, k = 1): string {
  if (!f.kind || !f.ink) return '';
  const step = (f.step ?? 0.8) / k, w = (f.w ?? 0.18) / k;
  const out: string[] = [];
  if (f.kind === 'vlines') {
    for (let x = bb.x0 + step / 2; x <= bb.x1; x += step) out.push(`M${x.toFixed(2)},${bb.y0.toFixed(2)}V${bb.y1.toFixed(2)}`);
    return `<path d="${out.join('')}" stroke="${f.ink}" stroke-width="${w.toFixed(3)}" fill="none"/>`;
  }
  if (f.kind === 'hlines') {
    for (let y = bb.y0 + step / 2; y <= bb.y1; y += step) out.push(`M${bb.x0.toFixed(2)},${y.toFixed(2)}H${bb.x1.toFixed(2)}`);
    return `<path d="${out.join('')}" stroke="${f.ink}" stroke-width="${w.toFixed(3)}" fill="none"/>`;
  }
  if (f.kind === 'dots') {
    let row = 0;
    for (let y = bb.y0 + step / 2; y <= bb.y1; y += step, row++)
      for (let x = bb.x0 + (row % 2 ? step : step / 2); x <= bb.x1; x += step) out.push(`M${x.toFixed(2)},${y.toFixed(2)}h0`);
    return `<path d="${out.join('')}" stroke="${f.ink}" stroke-width="${(w * 2).toFixed(3)}" stroke-linecap="round" fill="none"/>`;
  }
  // waves: a sine every step, amplitude a third of the step
  const amp = step / 3, wl = step * 2;
  for (let y = bb.y0 + step / 2; y <= bb.y1 + amp; y += step) {
    let d = `M${bb.x0.toFixed(2)},${y.toFixed(2)}`;
    for (let x = bb.x0; x < bb.x1; x += wl) d += `q${(wl / 4).toFixed(2)},${(-amp).toFixed(2)} ${(wl / 2).toFixed(2)},0t${(wl / 2).toFixed(2)},0`;
    out.push(d);
  }
  return `<path d="${out.join('')}" stroke="${f.ink}" stroke-width="${w.toFixed(3)}" fill="none"/>`;
}

let uid = 0;
/** A shape (an SVG path `d`) filled after the kit: ground, pattern clipped to the shape, outline. */
export function fillShape(d: string, bb: Box, f: Fill, k = 1): string {
  const id = `ak${++uid}`;
  const pad = 1;
  const box = { x0: bb.x0 - pad, y0: bb.y0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad };
  return (f.bg ? `<path d="${d}" fill="${f.bg}" fill-rule="evenodd"/>` : '') +
    (f.kind ? `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${id})">${strokes(f, box, k)}</g>` : '') +
    (f.outline ? `<path d="${d}" fill="none" stroke="${f.outline}" stroke-width="${((f.outlineW ?? 0.25) / k).toFixed(3)}"${f.dash ? ` stroke-dasharray="${f.dash}"` : ''} fill-rule="evenodd"/>` : '');
}

/** The key's swatch for a fill, in the legend's 5 × 3.6 box, drawn at the map's density (the box prints 1.54× larger). */
export function swatchOf(f: Fill): string {
  return fillShape('M0,0.4H5V3.2H0Z', { x0: 0, y0: 0.4, x1: 5, y1: 3.2 }, f, 1.54);
}

/** A bar in a chart, filled after the kit. */
export function barOf(x: number, y: number, w: number, h: number, f: Fill): string {
  if (w <= 0) return '';
  return fillShape(`M${x.toFixed(2)},${y.toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}Z`, { x0: x, y0: y, x1: x + w, y1: y + h }, f);
}

// ---- the template's chart blocks, flowed down the right column (75.33 → 198 mm) ----

const PT = 25.4 / 72;
const S6 = 6 * PT;
const W = 122.67;          // the column
const TRACK = 63.34;       // the bars' column, 138.67 on the page
const SPAN = 59.24;        // its width

/** The width of a 6 pt tracked label, near enough to keep it inside the column. */
const labelW = (text: string) => text.length * 1.36 + 0.4;

const txt = (x: number, top: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start') =>
  `<text x="${x.toFixed(2)}" y="${(top + 0.905 * S6).toFixed(2)}" text-anchor="${anchor}" font-size="${S6.toFixed(3)}" letter-spacing="${(0.09 * S6).toFixed(3)}" fill="#000000">${esc(text)}</text>`;

const svg = (h: number, inner: string) =>
  `<svg width="${W}mm" height="${h.toFixed(2)}mm" viewBox="0 0 ${W} ${h.toFixed(2)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible" font-family="Arial, 'Liberation Sans', sans-serif">${inner}</svg>`;

/** A head as the template sets it: 10 pt, a hairline 6.2 mm under its top; a second head over the bars' column when given. */
export const zHead = (left: string, right?: string) =>
  `<div class="zh"><span>${esc(left)}</span>${right ? `<span style="left:${TRACK}mm">${esc(right)}</span>` : ''}</div>`;

export interface BarRow { name: string; value: number; label: string; fill: Fill }

/** The template's bar chart: names down the left, a scale over the right column, dotted gridlines, the value after each bar. */
export function zBars(rows: BarRow[], max: number, step: number, opts: { ref?: { value: number; label: string; ink: string } } = {}): string {
  const AXIS = 6.3, ROWS = AXIS + 3.7, ROWH = 3.95, BAR = 1.65;
  // the scale runs on a step at a time until every value's label stays inside the column
  const fits = (m: number) => rows.every((r) => TRACK + (Math.min(r.value, m) / m) * SPAN + 1 + labelW(r.label) <= W);
  while (!fits(max) && max < 1e12) max += step;
  const X = (v: number) => TRACK + (Math.min(v, max) / max) * SPAN;
  const h = ROWS + rows.length * ROWH;
  const g: string[] = [];
  const gy0 = ROWS - 0.6, gy1 = ROWS + rows.length * ROWH - 0.15;
  for (let v = 0; v <= max + 1e-9; v += step) {
    g.push(txt(X(v), AXIS, String(Math.round(v * 10) / 10), v === 0 ? 'start' : 'middle'));
    g.push(`<line x1="${X(v).toFixed(2)}" y1="${gy0.toFixed(2)}" x2="${X(v).toFixed(2)}" y2="${gy1.toFixed(2)}" stroke="#878787" stroke-width="0.18" stroke-linecap="round" stroke-dasharray="0 0.36"/>`);
  }
  if (opts.ref) {
    const x = X(opts.ref.value);
    g.push(`<line x1="${x.toFixed(2)}" y1="${(gy0 - 1).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(gy1 + 0.6).toFixed(2)}" stroke="${opts.ref.ink}" stroke-width="0.3" stroke-dasharray="0.9 0.6"/>`);
  }
  rows.forEach((r, i) => {
    const top = ROWS + i * ROWH, end = X(r.value);
    g.push(txt(0, top, r.name));
    g.push(barOf(TRACK - 0.09, top + 0.6, Math.max(0, end - TRACK + 0.09), BAR, r.fill));
    g.push(txt(end + 1.0, top, r.label).replace('<text ', '<text stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round" paint-order="stroke" '));
  });
  if (opts.ref) {
    const x = X(opts.ref.value);
    const lw = labelW(opts.ref.label);
    g.push(txt(x, gy1 + 1.2, opts.ref.label, x + lw / 2 > W ? 'end' : x - lw / 2 < TRACK ? 'start' : 'middle'));
  }
  return svg(h + (opts.ref ? 4 : 0), g.join(''));
}

/** Label and figure pairs, as the template sets the bus figures: 6 pt, the label over the figure; two columns. */
export function zFigures(left: [string, string][], right: [string, string][] = [], rowH = 7.4): string {
  const g: string[] = [];
  left.forEach(([l, v], i) => g.push(txt(0, 6.3 + i * rowH, l), txt(0, 8.8 + i * rowH, v)));
  right.forEach(([l, v], i) => g.push(txt(TRACK, 6.3 + i * rowH, l), txt(TRACK, 8.8 + i * rowH, v)));
  return svg(6.3 + Math.max(left.length, right.length) * rowH, g.join(''));
}

/** The template's nested circles, each true to its quantity, dashed, labelled inside; drawn in the left half. */
export function zCircles(items: { value: number; label: string; sub: string; fill: Fill }[], r0 = 24): string {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(1e-9, ...sorted.map((i) => i.value));
  const CX = 29.6, TOPPAD = 6.3, BOTTOM = TOPPAD + 2 * r0;
  const circ = sorted.map((it, k) => { const r = r0 * Math.sqrt(it.value / max); const cy = BOTTOM - k * 4.5 - r; return { ...it, r, cy, top: cy - r }; });
  const g: string[] = [];
  circ.forEach((c) => g.push(fillShape(`M${(CX - c.r).toFixed(2)},${c.cy.toFixed(2)}a${c.r.toFixed(2)},${c.r.toFixed(2)} 0 1,0 ${(2 * c.r).toFixed(2)},0a${c.r.toFixed(2)},${c.r.toFixed(2)} 0 1,0 ${(-2 * c.r).toFixed(2)},0Z`, { x0: CX - c.r, y0: c.cy - c.r, x1: CX + c.r, y1: c.cy + c.r }, c.fill)));
  circ.forEach((c, k) => {
    const mid = k < circ.length - 1 ? (c.top + circ[k + 1].top) / 2 : c.cy;
    g.push(txt(CX, mid - 2.3, c.label, 'middle'), txt(CX, mid + 0.2, c.sub, 'middle'));
  });
  return svg(BOTTOM + 1, g.join(''));
}

/** A round axis for a maximum: the top of the scale and its step, four or five ticks. */
export function niceAxis(maxValue: number): { max: number; step: number } {
  const raw = Math.max(maxValue, 1e-9) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(maxValue / step) * step || step, step };
}

/** The template's 6 pt word, and its column-wide SVG, for blocks drawn outside the kit. */
export const z6 = txt;
export const zSvg = svg;
export const Z_W = W;
export const Z_TRACK = TRACK;

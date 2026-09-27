// Small statistical charts for the deck, drawn as SVG in millimetres: a
// line with its projection, paired horizontal bars against a benchmark,
// and thin columns. One family of marks — 0.5 mm lines, thin rounded bars,
// values on the marks in ink, hairline grid — so the slides read as one
// system. The accent is the validated palette's first slot; a benchmark
// is a recessive grey, a projection the same hue a few steps lighter.

import { esc } from './chrome.js';

export const CHART = {
  accent: '#2a78d6',
  projection: '#86b6ef',
  benchmark: '#bdbbb3',
  ink: '#1c1c1c',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
};

export interface YearValue { year: number; value: number }

const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M` : Math.round(n).toLocaleString('en-AU'));

/** A round step so that about `n` ticks cover `max`, and the axis top it implies. */
export function niceScale(max: number, n = 4): { step: number; top: number } {
  const raw = Math.max(max, 1e-9) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { step, top: Math.ceil(max / step) * step };
}

const svgOpen = (w: number, h: number, font: string) =>
  `<svg width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block" font-family="${font}">`;

/** A rectangle with its data end rounded and its baseline end square; `dir` is the growth direction. */
function bar(x: number, y: number, w: number, h: number, dir: 'right' | 'up', r = 0.5): string {
  if (w <= 0 || h <= 0) return '';
  if (dir === 'right') {
    const rr = Math.min(r, w / 2, h / 2);
    return `M${x.toFixed(2)},${y.toFixed(2)} H${(x + w - rr).toFixed(2)} Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + rr).toFixed(2)} V${(y + h - rr).toFixed(2)} Q${(x + w).toFixed(2)},${(y + h).toFixed(2)} ${(x + w - rr).toFixed(2)},${(y + h).toFixed(2)} H${x.toFixed(2)} Z`;
  }
  const rr = Math.min(r, w / 2, h / 2);
  return `M${x.toFixed(2)},${(y + h).toFixed(2)} V${(y + rr).toFixed(2)} Q${x.toFixed(2)},${y.toFixed(2)} ${(x + rr).toFixed(2)},${y.toFixed(2)} H${(x + w - rr).toFixed(2)} Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + rr).toFixed(2)} V${(y + h).toFixed(2)} Z`;
}

export interface LineChartOpts {
  w: number; h: number; font: string;
  history: YearValue[];
  projection: YearValue[];
  historyLabel: string;
  projectionLabel: string;
}

/** A series and its projection on one time axis from zero, with the ends labelled. */
export function lineWithProjection(o: LineChartOpts): string {
  const { w, h, history, projection } = o;
  if (!history.length && !projection.length) return '';
  const left = 12, right = 4, top = 8.5, bottom = 6;
  const pw = w - left - right, ph = h - top - bottom;
  const years = [...history, ...projection].map((v) => v.year);
  const x0 = Math.min(...years), x1 = Math.max(...years);
  const vmax = Math.max(...[...history, ...projection].map((v) => v.value), 1);
  const { step, top: yTop } = niceScale(vmax * 1.06, 5);
  const X = (yr: number) => left + ((yr - x0) / Math.max(1, x1 - x0)) * pw;
  const Y = (v: number) => top + ph - (v / yTop) * ph;
  const parts: string[] = [];
  // legend
  let lx = left;
  const key = (stroke: string, dash: string, text: string) => {
    parts.push(`<line x1="${lx}" y1="2.6" x2="${lx + 6}" y2="2.6" stroke="${stroke}" stroke-width="0.5"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`);
    parts.push(`<text x="${lx + 7.5}" y="3.35" font-size="2.05" fill="${CHART.secondary}">${esc(text)}</text>`);
    lx += 7.5 + text.length * 1.08 + 5;
  };
  if (history.length) key(CHART.accent, '', o.historyLabel);
  if (projection.length) key(CHART.projection, '1.4,1', o.projectionLabel);
  // grid and y ticks
  for (let v = 0; v <= yTop + 1e-9; v += step) {
    const y = Y(v);
    parts.push(`<line x1="${left}" y1="${y.toFixed(2)}" x2="${(w - right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${v === 0 ? CHART.axis : CHART.grid}" stroke-width="0.15"/>`);
    parts.push(`<text x="${left - 1.5}" y="${(y + 0.7).toFixed(2)}" text-anchor="end" font-size="1.95" fill="${CHART.muted}">${fmt(v)}</text>`);
  }
  // x ticks: decades and both ends
  const ticks = new Set<number>([x0, x1]);
  for (let yr = Math.ceil(x0 / 10) * 10; yr < x1; yr += 10) if (yr - x0 >= 4 && x1 - yr >= 4) ticks.add(yr);
  for (const yr of ticks) parts.push(`<text x="${X(yr).toFixed(2)}" y="${(top + ph + 3.4).toFixed(2)}" text-anchor="middle" font-size="1.95" fill="${CHART.muted}">${yr}</text>`);
  // series
  const path = (s: YearValue[]) => s.map((v, i) => `${i ? 'L' : 'M'}${X(v.year).toFixed(2)},${Y(v.value).toFixed(2)}`).join('');
  if (projection.length > 1)
    parts.push(`<path d="${path(projection)}" fill="none" stroke="${CHART.projection}" stroke-width="0.5" stroke-dasharray="1.4,1" stroke-linejoin="round" stroke-linecap="round"/>`);
  if (history.length > 1)
    parts.push(`<path d="${path(history)}" fill="none" stroke="${CHART.accent}" stroke-width="0.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  // end marks and labels
  const endDot = (v: YearValue, fill: string, text: string, anchor: 'middle' | 'end', dy: number) => {
    const x = X(v.year), y = Y(v.value);
    parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.35" fill="#ffffff"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.05" fill="${fill}"/>`);
    parts.push(`<text x="${(anchor === 'end' ? x : x).toFixed(2)}" y="${(y + dy).toFixed(2)}" text-anchor="${anchor}" font-size="2.05" font-weight="700" fill="${CHART.ink}" stroke="#ffffff" stroke-width="0.45" paint-order="stroke">${esc(text)}</text>`);
  };
  if (projection.length) {
    const last = projection[projection.length - 1];
    endDot(last, CHART.projection, `${fmt(last.value)} · ${last.year}`, 'end', -2.4);
  }
  if (history.length) {
    const last = history[history.length - 1];
    const first = history[0];
    endDot(last, CHART.accent, `${fmt(last.value)} · ${last.year}`, 'middle', projection.length ? 4.6 : -2.4);
    // The start label sits under a rising line and over a falling one, clear of the stroke.
    const rising = history.length > 2 && history[2].value > first.value;
    parts.push(`<text x="${(X(first.year) + 1.2).toFixed(2)}" y="${(Y(first.value) + (rising ? 3.6 : -2)).toFixed(2)}" font-size="1.95" fill="${CHART.secondary}">${fmt(first.value)} · ${first.year}</text>`);
  }
  return `${svgOpen(w, h, o.font)}${parts.join('')}</svg>`;
}

export interface PairedBarsOpts {
  w: number; h: number; font: string;
  rows: { label: string; a: number; b?: number }[];
  aLabel: string;
  bLabel?: string;
  /** Text after each value, e.g. " %". */
  unit?: string;
  labelW?: number;
}

/** Horizontal bars, the subject in the accent against a grey benchmark, values at the tips. */
export function pairedBars(o: PairedBarsOpts): string {
  const { w, h, rows } = o;
  if (!rows.length) return '';
  const labelW = o.labelW ?? 21, valueW = 9, top = o.bLabel ? 6 : 2;
  const twin = rows.some((r) => Number.isFinite(r.b));
  const barH = twin ? 1.6 : 2.2, gap = 0.5;
  const rowH = (h - top - 1) / rows.length;
  const pw = w - labelW - valueW - 1;
  const max = Math.max(1e-9, ...rows.flatMap((r) => [r.a, Number.isFinite(r.b) ? (r.b as number) : 0]));
  const unit = o.unit ?? '';
  const val = (v: number) => (!Number.isFinite(v) ? '' : v > 0 && v < 1 ? `<1${unit}` : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}${unit}`);
  const parts: string[] = [];
  if (o.bLabel) {
    parts.push(`<rect x="${labelW}" y="1.2" width="3" height="1.8" rx="0.3" fill="${CHART.accent}"/><text x="${labelW + 4.2}" y="2.75" font-size="2.0" fill="${CHART.secondary}">${esc(o.aLabel)}</text>`);
    const lx = labelW + 4.2 + o.aLabel.length * 1.05 + 4;
    parts.push(`<rect x="${lx.toFixed(1)}" y="1.2" width="3" height="1.8" rx="0.3" fill="${CHART.benchmark}"/><text x="${(lx + 4.2).toFixed(1)}" y="2.75" font-size="2.0" fill="${CHART.secondary}">${esc(o.bLabel)}</text>`);
  }
  parts.push(`<line x1="${labelW}" y1="${top}" x2="${labelW}" y2="${(h - 1).toFixed(1)}" stroke="${CHART.axis}" stroke-width="0.15"/>`);
  rows.forEach((r, i) => {
    const y = top + i * rowH, mid = y + rowH / 2;
    parts.push(`<text x="${(labelW - 1.6).toFixed(1)}" y="${(mid + 0.7).toFixed(2)}" text-anchor="end" font-size="2.05" fill="${CHART.ink}">${esc(r.label)}</text>`);
    const ya = twin ? mid - barH - gap / 2 : mid - barH / 2;
    const wa = (r.a / max) * pw;
    parts.push(`<path d="${bar(labelW, ya, wa, barH, 'right')}" fill="${CHART.accent}"/>`);
    parts.push(`<text x="${(labelW + Math.max(wa, 0) + 1).toFixed(2)}" y="${(ya + barH / 2 + 0.7).toFixed(2)}" font-size="1.95" fill="${CHART.ink}">${val(r.a)}</text>`);
    if (twin && Number.isFinite(r.b)) {
      const yb = mid + gap / 2, wb = ((r.b as number) / max) * pw;
      parts.push(`<path d="${bar(labelW, yb, wb, barH, 'right')}" fill="${CHART.benchmark}"/>`);
      parts.push(`<text x="${(labelW + Math.max(wb, 0) + 1).toFixed(2)}" y="${(yb + barH / 2 + 0.7).toFixed(2)}" font-size="1.95" fill="${CHART.secondary}">${val(r.b as number)}</text>`);
    }
  });
  return `${svgOpen(w, h, o.font)}${parts.join('')}</svg>`;
}

export interface ColumnsOpts {
  w: number; h: number; font: string;
  values: { label: string; value: number; text: string; muted?: boolean }[];
  /** A vertical reference through the column at `index` (fractional for between columns), with its label. */
  marker?: { index: number; label: string; colour: string };
}

/** Thin columns from a baseline, values on the caps, labels beneath. */
export function columns(o: ColumnsOpts): string {
  const { w, h, values } = o;
  if (!values.length) return '';
  const left = 2, right = 2, top = 5, bottom = 5.5;
  const ph = h - top - bottom;
  const slot = (w - left - right) / values.length;
  const barW = Math.min(6, slot * 0.5);
  const max = Math.max(1e-9, ...values.map((v) => v.value));
  const base = top + ph;
  const parts: string[] = [`<line x1="${left}" y1="${base.toFixed(2)}" x2="${(w - right).toFixed(2)}" y2="${base.toFixed(2)}" stroke="${CHART.axis}" stroke-width="0.15"/>`];
  values.forEach((v, i) => {
    const bh = (v.value / max) * ph;
    const x = left + i * slot + (slot - barW) / 2;
    parts.push(`<path d="${bar(x, base - bh, barW, bh, 'up', 0.8)}" fill="${v.muted ? CHART.projection : CHART.accent}"/>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(base - bh - 1.1).toFixed(2)}" text-anchor="middle" font-size="2.05" fill="${CHART.ink}">${esc(v.text)}</text>`);
    parts.push(`<text x="${(x + barW / 2).toFixed(2)}" y="${(base + 3.3).toFixed(2)}" text-anchor="middle" font-size="1.95" fill="${CHART.muted}">${esc(v.label)}</text>`);
  });
  if (o.marker) {
    const x = left + (o.marker.index + 0.5) * slot;
    parts.push(`<line x1="${x.toFixed(2)}" y1="${(top - 1).toFixed(2)}" x2="${x.toFixed(2)}" y2="${base.toFixed(2)}" stroke="${o.marker.colour}" stroke-width="0.4" stroke-dasharray="1.4,0.8"/>`);
    const anchor = x > w * 0.6 ? 'end' : 'start';
    parts.push(`<text x="${(x + (anchor === 'end' ? -1.2 : 1.2)).toFixed(2)}" y="${(top + ph * 0.45).toFixed(2)}" text-anchor="${anchor}" font-size="1.9" font-weight="700" fill="${o.marker.colour}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">${esc(o.marker.label)}</text>`);
  }
  return `${svgOpen(w, h, o.font)}${parts.join('')}</svg>`;
}

export interface SectionOpts {
  w: number; h: number; font: string;
  samples: { d: number; rl: number; site: boolean; water: boolean }[];
  /** The end labels, e.g. "A" and "A′". */
  from: string; to: string;
  /** Vertical exaggeration; chosen to fit when omitted. */
  ve?: number;
  siteColour: string;
  waterColour: string;
  /** Buildings the line meets: their run along it and the RL of their top. */
  blocks?: { d0: number; d1: number; top: number; site?: boolean; unknown?: boolean; label?: string }[];
  /** A height plane over a run of the line, e.g. the LEP limit over the site. */
  envelope?: { d0: number; d1: number; top: number; label: string };
}

/** A ground section: RL against distance, the site and any water marked, ends labelled. */
export function sectionSvg(o: SectionOpts): { svg: string; ve: number } {
  const { w, h, samples } = o;
  if (samples.length < 2) return { svg: '', ve: 1 };
  const left = 12, right = 4, top = 7, bottom = 6.5;
  const pw = w - left - right, ph = h - top - bottom;
  const L = samples[samples.length - 1].d;
  const rls = samples.map((s) => s.rl);
  const lo = Math.min(...rls), groundHi = Math.max(...rls);
  // Buildings stretch the scale only so far: a tower is cut at the top of the
  // plot and labelled, so the ground and the site stay legible.
  const envTop = o.envelope ? o.envelope.top : -Infinity;
  const tops = (o.blocks ?? []).map((b) => b.top).sort((a, b) => a - b);
  const tallest = tops.length ? tops[tops.length - 1] : -Infinity;
  const p90 = tops.length ? tops[Math.floor(0.9 * (tops.length - 1))] : -Infinity;
  const cap = Math.max(Math.min(Math.max(p90, groundHi + 25), groundHi + 60), envTop + 5);
  const hi = Math.max(groundHi, Math.min(tallest, cap), envTop);
  const sx = pw / L;                                    // mm per ground metre, horizontally
  const range = Math.max(1, hi - lo);
  let ve = o.ve ?? 0;
  if (!ve) { for (const cand of [20, 10, 5, 3, 2, 1]) { ve = cand; if (range * sx * cand <= ph * 0.82) break; } if (range * sx * ve > ph * 0.82) ve = (ph * 0.82) / (range * sx); }
  const sy = sx * ve;
  const tickStep = niceScale(range, 4).step;
  const y0 = Math.floor(lo / tickStep) * tickStep;
  const yTop = Math.max(y0 + tickStep, Math.ceil(hi / tickStep) * tickStep);
  const usedH = (yTop - y0) * sy;
  const base = top + Math.min(ph, usedH) + (ph - Math.min(ph, usedH)) / 2;
  const Y = (rl: number) => base - (rl - y0) * sy;
  const X = (d: number) => left + d * sx;
  const parts: string[] = [];
  // grid
  for (let v = y0; v <= yTop + 1e-9; v += tickStep) {
    if (Y(v) < top - 0.5) break;
    parts.push(`<line x1="${left}" y1="${Y(v).toFixed(2)}" x2="${(w - right).toFixed(2)}" y2="${Y(v).toFixed(2)}" stroke="${v === y0 ? CHART.axis : CHART.grid}" stroke-width="0.15"/>`);
    parts.push(`<text x="${left - 1.5}" y="${(Y(v) + 0.7).toFixed(2)}" text-anchor="end" font-size="1.95" fill="${CHART.muted}">RL ${v}</text>`);
  }
  const xStep = niceScale(L, 6).step;
  for (let d = 0; d <= L + 1e-9; d += xStep)
    parts.push(`<text x="${X(d).toFixed(2)}" y="${(base + 3.4).toFixed(2)}" text-anchor="middle" font-size="1.95" fill="${CHART.muted}">${Math.round(d)}${d === 0 ? ' m' : ''}</text>`);
  // ground: fill to the base, then water and site as bands under the line
  const line = samples.map((s, i) => `${i ? 'L' : 'M'}${X(s.d).toFixed(2)},${Y(s.rl).toFixed(2)}`).join('');
  parts.push(`<path d="${line}L${X(L).toFixed(2)},${base.toFixed(2)}L${left},${base.toFixed(2)}Z" fill="#e9e7e0"/>`);
  const bands = (flag: 'site' | 'water', fill: string, opacity: number) => {
    let start = -1;
    const runs: [number, number][] = [];
    samples.forEach((s, i) => { if (s[flag] && start < 0) start = i; if ((!s[flag] || i === samples.length - 1) && start >= 0) { runs.push([start, s[flag] ? i : i - 1]); start = -1; } });
    for (const [i0, i1] of runs) {
      const seg = samples.slice(i0, i1 + 1);
      if (seg.length < 2) continue;
      const d = seg.map((s, i) => `${i ? 'L' : 'M'}${X(s.d).toFixed(2)},${Y(s.rl).toFixed(2)}`).join('');
      parts.push(`<path d="${d}L${X(seg[seg.length - 1].d).toFixed(2)},${base.toFixed(2)}L${X(seg[0].d).toFixed(2)},${base.toFixed(2)}Z" fill="${fill}" fill-opacity="${opacity}"/>`);
    }
    return runs;
  };
  bands('water', o.waterColour, 0.9);
  const siteRuns = bands('site', o.siteColour, 0.28);
  // buildings: a block on the ground between d0 and d1, up to its top
  const groundAt = (d: number) => { let best = samples[0]; for (const s of samples) if (Math.abs(s.d - d) < Math.abs(best.d - d)) best = s; return best.rl; };
  const clipId = `sec-${Math.random().toString(36).slice(2, 8)}`;
  parts.push(`<clipPath id="${clipId}"><rect x="0" y="${(top - 0.2).toFixed(2)}" width="${w}" height="${(base - top + 0.4).toFixed(2)}"/></clipPath>`);
  parts.push(`<g clip-path="url(#${clipId})">`);
  for (const bk of o.blocks ?? []) {
    if (bk.d1 - bk.d0 < 0.5) continue;
    const under = samples.filter((s) => s.d >= bk.d0 && s.d <= bk.d1);
    const floor = under.length ? under : [{ d: bk.d0, rl: groundAt(bk.d0) }, { d: bk.d1, rl: groundAt(bk.d1) }];
    const d = `M${X(bk.d0).toFixed(2)},${Y(bk.top).toFixed(2)}L${X(bk.d1).toFixed(2)},${Y(bk.top).toFixed(2)}` +
      `L${X(bk.d1).toFixed(2)},${Y(groundAt(bk.d1)).toFixed(2)}` + [...floor].reverse().map((s) => `L${X(s.d).toFixed(2)},${Y(s.rl).toFixed(2)}`).join('') + `L${X(bk.d0).toFixed(2)},${Y(groundAt(bk.d0)).toFixed(2)}Z`;
    parts.push(`<path d="${d}" fill="${bk.site ? o.siteColour : '#cfcdc6'}" fill-opacity="${bk.site ? 0.45 : bk.unknown ? 0.35 : 0.9}" stroke="${bk.site ? o.siteColour : '#8f8d86'}" stroke-width="0.2"${bk.unknown ? ' stroke-dasharray="0.8,0.6"' : ''}/>`);
  }
  parts.push('</g>');
  for (const bk of o.blocks ?? []) {
    if (!bk.label || X(bk.d1) - X(bk.d0) <= 6) continue;
    const cut = bk.top > yTop + 1e-9;
    parts.push(`<text x="${((X(bk.d0) + X(bk.d1)) / 2).toFixed(2)}" y="${(cut ? top + 2.2 : Y(bk.top) - 1).toFixed(2)}" text-anchor="middle" font-size="1.8" fill="${CHART.secondary}">${cut ? '↑ ' : ''}${esc(bk.label)}</text>`);
  }
  if (o.envelope) {
    const e = o.envelope;
    const d = `M${X(e.d0).toFixed(2)},${Y(groundAt(e.d0)).toFixed(2)}L${X(e.d0).toFixed(2)},${Y(e.top).toFixed(2)}L${X(e.d1).toFixed(2)},${Y(e.top).toFixed(2)}L${X(e.d1).toFixed(2)},${Y(groundAt(e.d1)).toFixed(2)}`;
    parts.push(`<path d="${d}" fill="none" stroke="${o.siteColour}" stroke-width="0.45" stroke-dasharray="1.6,0.9"/>`);
  }
  let envelopeLabel: string | null = null;
  parts.push(`<path d="${line}" fill="none" stroke="${CHART.ink}" stroke-width="0.4" stroke-linejoin="round"/>`);
  // the site: a bar above the ground with its RLs at both ends
  for (const [i0, i1] of siteRuns) {
    const a = samples[i0], b = samples[i1];
    // The site's bar sits above everything drawn over its run: its ground, its buildings, the height plane.
    const over = (o.blocks ?? []).filter((bk) => bk.d1 > a.d && bk.d0 < b.d).map((bk) => Y(Math.min(bk.top, yTop)));
    if (o.envelope && o.envelope.d1 > a.d && o.envelope.d0 < b.d) over.push(Y(Math.min(o.envelope.top, yTop)));
    const yb = Math.min(Y(a.rl), Y(b.rl), ...samples.slice(i0, i1 + 1).map((s) => Y(s.rl)), ...over) - 3.2;
    parts.push(`<line x1="${X(a.d).toFixed(2)}" y1="${yb.toFixed(2)}" x2="${X(b.d).toFixed(2)}" y2="${yb.toFixed(2)}" stroke="${o.siteColour}" stroke-width="0.6"/>`);
    parts.push(`<line x1="${X(a.d).toFixed(2)}" y1="${yb.toFixed(2)}" x2="${X(a.d).toFixed(2)}" y2="${Y(a.rl).toFixed(2)}" stroke="${o.siteColour}" stroke-width="0.25"/>`);
    parts.push(`<line x1="${X(b.d).toFixed(2)}" y1="${yb.toFixed(2)}" x2="${X(b.d).toFixed(2)}" y2="${Y(b.rl).toFixed(2)}" stroke="${o.siteColour}" stroke-width="0.25"/>`);
    parts.push(`<text x="${((X(a.d) + X(b.d)) / 2).toFixed(2)}" y="${(yb - 1.2).toFixed(2)}" text-anchor="middle" font-size="2.1" font-weight="700" fill="${o.siteColour}">SITE</text>`);
    parts.push(`<text x="${(X(a.d) - 0.8).toFixed(2)}" y="${(yb + 2.4).toFixed(2)}" text-anchor="end" font-size="1.9" fill="${CHART.ink}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">RL ${a.rl.toFixed(1)}</text>`);
    parts.push(`<text x="${(X(b.d) + 0.8).toFixed(2)}" y="${(yb + 2.4).toFixed(2)}" font-size="1.9" fill="${CHART.ink}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">RL ${b.rl.toFixed(1)}</text>`);
    // The height plane's label: beside its line when the site is wide enough, else stacked over the site's name.
    const e = o.envelope;
    if (e && e.d1 > a.d && e.d0 < b.d && !envelopeLabel) {
      const wide = X(e.d1) - X(e.d0) >= 14 && Y(e.top) - yb > 5;
      envelopeLabel = wide
        ? `<text x="${(X(e.d0) + 0.6).toFixed(2)}" y="${(Y(e.top) - 1).toFixed(2)}" font-size="1.9" font-weight="700" fill="${o.siteColour}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">${esc(e.label)}</text>`
        : `<text x="${((X(a.d) + X(b.d)) / 2).toFixed(2)}" y="${(yb - 4.2).toFixed(2)}" text-anchor="middle" font-size="1.9" font-weight="700" fill="${o.siteColour}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">${esc(e.label)}</text>`;
    }
  }
  if (o.envelope && !envelopeLabel)
    envelopeLabel = `<text x="${(X(o.envelope.d0) + 0.6).toFixed(2)}" y="${(Y(o.envelope.top) - 1).toFixed(2)}" font-size="1.9" font-weight="700" fill="${o.siteColour}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">${esc(o.envelope.label)}</text>`;
  if (envelopeLabel) parts.push(envelopeLabel);
  // The highest and lowest points of the ground, unless they are the site's own labels.
  // A crest just outside the site would print over the site's edge label, so there its label goes below the line.
  const iHi = rls.indexOf(Math.max(...rls)), iLo = rls.indexOf(lo);
  const siteEdgesX = siteRuns.flatMap(([i0, i1]) => [X(samples[i0].d), X(samples[i1].d)]);
  for (const [i, anchor] of [[iHi, 'hi'], [iLo, 'lo']] as const) {
    const s = samples[i];
    if (s.site) continue;
    const nearSite = siteEdgesX.some((x) => Math.abs(x - X(s.d)) < 9);
    if (!nearSite) parts.push(`<circle cx="${X(s.d).toFixed(2)}" cy="${Y(s.rl).toFixed(2)}" r="0.7" fill="${CHART.ink}"/>`);
    parts.push(`<text x="${X(s.d).toFixed(2)}" y="${(Y(s.rl) + (anchor === 'lo' || nearSite ? 3.4 : -1.6)).toFixed(2)}" text-anchor="middle" font-size="1.9" fill="${CHART.secondary}" stroke="#ffffff" stroke-width="0.4" paint-order="stroke">RL ${s.rl.toFixed(1)}</text>`);
  }
  // ends
  const endMark = (x: number, text: string) =>
    `<circle cx="${x.toFixed(2)}" cy="3.2" r="2.4" fill="#ffffff" stroke="${CHART.ink}" stroke-width="0.3"/><text x="${x.toFixed(2)}" y="4.1" text-anchor="middle" font-size="2.4" font-weight="700" fill="${CHART.ink}">${esc(text)}</text>`;
  parts.push(endMark(left + 2.4, o.from), endMark(w - right - 2.4, o.to));
  return { svg: `${svgOpen(w, h, o.font)}${parts.join('')}</svg>`, ve };
}

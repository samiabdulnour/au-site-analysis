// Small maps for the slides: a projector for a panel of any size at any scale
// (north up — planning maps are never rotated), and the light base every
// panel shares: water, cadastre hairlines, roads by hierarchy, rail, stations
// and the site. The thematic layer goes on top, per panel.

import type { GeoJSONFC } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorScaleFactor, mercatorToLonLat, type Extent, type XY } from '../lib/geo.js';
import type { TopoRoad, RailLines, NamedPoint } from '../fetch/nswTopo.js';
import { geomRings } from '../fetch/planning.js';
import { tpl } from './template.js';
import { esc } from './chrome.js';

export type Pt = [number, number];
export type Proj = (lon: number, lat: number) => Pt;

export interface Panel { center: XY; scale: number; wMm: number; hMm: number }

/** Ground extent (EPSG:3857) a panel covers — the fetch window. */
export function panelExtent(p: Panel): Extent {
  const k = mercatorScaleFactor(mercatorToLonLat(p.center).lat);
  const hw = ((p.wMm / 1000) * p.scale * k) / 2;
  const hh = ((p.hMm / 1000) * p.scale * k) / 2;
  return { xmin: p.center.x - hw, ymin: p.center.y - hh, xmax: p.center.x + hw, ymax: p.center.y + hh };
}

export function panelProjector(p: Panel): Proj {
  const e = panelExtent(p);
  const sx = p.wMm / (e.xmax - e.xmin);
  const sy = p.hMm / (e.ymax - e.ymin);
  return (lon, lat) => {
    const m = lonLatToMercator({ lon, lat });
    return [(m.x - e.xmin) * sx, (e.ymax - m.y) * sy];
  };
}

export function ringsPath(rings: number[][][], proj: Proj, close = true): string {
  let d = '';
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = proj(lon, lat);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    });
    if (close) d += 'Z';
  }
  return d;
}

export const fcPath = (fc: GeoJSONFC, proj: Proj) =>
  fc.features.map((f) => ringsPath(geomRings(f.geometry), proj)).join('');

/** Projected area (mm²) and centroid of a ring — for deciding what gets a label. */
export function ringStats(ring: number[][], proj: Proj): { area: number; cx: number; cy: number } {
  const pts = ring.map(([lon, lat]) => proj(lon, lat));
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const f = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    a += f; cx += (pts[i][0] + pts[i + 1][0]) * f; cy += (pts[i][1] + pts[i + 1][1]) * f;
  }
  if (Math.abs(a) < 1e-6) return { area: 0, cx: pts[0]?.[0] ?? 0, cy: pts[0]?.[1] ?? 0 };
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
}

export interface BaseData {
  water: GeoJSONFC;
  lots: GeoJSONFC;
  roads: TopoRoad[];
  rail: RailLines;
  stations: NamedPoint[];
  siteLots: GeoJSONFC;
}

/**
 * The book's three type styles. Each is one size, one weight and one colour,
 * and nothing is set in any other: T1 display (titles, big figures), T2 caps
 * (heads, labels, folios, every word inside a map), T3 body (the rest).
 */
export const TYPE = {
  h: { size: 6.0, weight: 700, spacing: 0.9 },   // header: bold caps, widely tracked
  s: { size: 2.7, weight: 400, spacing: 0.14 },  // small: caps for labels, sentence case for keys and sources
  b: { size: 3.4, weight: 400 },                 // body
  // the map and graph labels are the small style
  t2: { size: 2.7, weight: 400, spacing: 0.14 },
} as const;

/** A small-style label inside a map: caps, haloed in white so it reads over any ground. `k` compensates a map drawn at a reduced size. */
export function t2Text(x: number, y: number, text: string, anchor: 'start' | 'middle' | 'end' = 'start', k = 1): string {
  const t = tpl();
  const size = TYPE.t2.size / k;
  return `<text x="${x.toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" text-anchor="${anchor}" font-size="${size.toFixed(2)}" font-weight="${TYPE.t2.weight}" letter-spacing="${(TYPE.t2.spacing / k).toFixed(2)}" fill="${t.ink}" stroke="#ffffff" stroke-width="${(0.55 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${esc(text.toUpperCase())}</text>`;
}

/** Width of a T2 label in map millimetres, for the label spacer. */
export const t2Width = (text: string, k = 1) => (text.length * TYPE.t2.size * 0.68 + 0.8) / k;

/** Railway as a track: a fine rail line crossed by short sleepers, so a yard of parallel lines reads as hatching, not noise. */
export function railSymbol(d: string, colour: string, k = 1): string {
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${(0.2 / k).toFixed(2)}"/>` +
    `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${(1.05 / k).toFixed(2)}" stroke-dasharray="${(0.16 / k).toFixed(2)},${(1.3 / k).toFixed(2)}"/>`;
}

/** The shared base under every thematic layer. */
export function baseLayers(b: BaseData, proj: Proj, p: Panel, opts: { lots?: boolean } = {}): string {
  const t = tpl();
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${p.wMm}" height="${p.hMm}" fill="${t.paper}"/>`);
  if (b.water.features.length) parts.push(`<path d="${fcPath(b.water, proj)}" fill="${t.water}" fill-rule="evenodd"/>`);
  if (opts.lots !== false && b.lots.features.length)
    parts.push(`<path d="${fcPath(b.lots, proj)}" fill="none" stroke="#b9ae99" stroke-width="0.08" opacity="0.6"/>`);
  return parts.join('\n');
}

/** Sydney Metro's own stations, which the State's station layer names as railway stations. */
const METRO_ONLY = /\b(TALLAWONG|ROUSE HILL|KELLYVILLE|BELLA VISTA|NORWEST|HILLS SHOWGROUND|CASTLE HILL|CHERRYBROOK|MACQUARIE UNIVERSITY|MACQUARIE PARK|NORTH RYDE|CROWS NEST|VICTORIA CROSS|BARANGAROO|GADIGAL|WATERLOO)\b/i;
export type StationMode = 'train' | 'metro' | 'light rail';
export const stationMode = (name: string): StationMode =>
  /LIGHT RAIL|TRAM|\bSLR\b|\bSTOP$/i.test(name) ? 'light rail' : /METRO/i.test(name) || METRO_ONLY.test(name) ? 'metro' : 'train';

/** Roads, rail, stations and the site — drawn over the theme so it stays legible. */
export function overLayers(b: BaseData, proj: Proj, p: Panel, site: SiteLayer = 'both'): string {
  const t = tpl();
  const parts: string[] = [];
  const width = (h: number) => (h <= 2 ? 0.75 : h <= 4 ? 0.5 : h <= 6 ? 0.3 : 0.16);
  const byWidth = new Map<number, string[]>();
  for (const r of b.roads) {
    const w = width(r.hierarchy);
    (byWidth.get(w) ?? byWidth.set(w, []).get(w)!).push(ringsPath([r.coords], proj, false));
  }
  // Casing then fill, so junctions read as one network rather than a pile of ends.
  for (const [w, ds] of [...byWidth.entries()].sort((a, b2) => b2[0] - a[0]))
    parts.push(`<path d="${ds.join('')}" fill="none" stroke="${t.road}" stroke-width="${(w + 0.22).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const [w, ds] of [...byWidth.entries()].sort((a, b2) => b2[0] - a[0]))
    parts.push(`<path d="${ds.join('')}" fill="none" stroke="#ffffff" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (b.rail.train.length) parts.push(railSymbol(b.rail.train.map((l) => ringsPath([l], proj, false)).join(''), t.rail));
  if (b.rail.tram.length) {
    const d = b.rail.tram.map((l) => ringsPath([l], proj, false)).join('');
    parts.push(`<path d="${d}" fill="none" stroke="${t.busRoute}" stroke-width="0.55" stroke-dasharray="2,1.2"/>`);
  }
  for (const s of b.stations) {
    const [x, y] = proj(s.lon, s.lat);
    if (x < 2 || y < 2 || x > p.wMm - 2 || y > p.hMm - 2) continue;
    const mode = stationMode(s.name);
    parts.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="2" fill="#ffffff" stroke="${t.transit}" stroke-width="0.45"/>` +
      `<text text-anchor="middle" dy="1.05" font-size="3" font-weight="600" fill="${t.transit}">${mode === 'light rail' ? 'L' : mode === 'metro' ? 'M' : 'T'}</text></g>`);
  }
  if (site !== 'none') parts.push(siteMark(b, proj, site));
  return parts.join('\n');
}

/** How much of the site mark a map wants in one pass: all of it, the wash to go under its own marks, or the outline and label to go over them. */
export type SiteLayer = 'wash' | 'outline' | 'both' | 'none';

/** Where the site's label sits, above the centroid of its largest ring, in panel mm; null without a site polygon. */
export function siteLabelPoint(b: BaseData, proj: Proj): { cx: number; cy: number } | null {
  let best = { area: -1, cx: 0, cy: 0 };
  for (const f of b.siteLots.features) for (const r of geomRings(f.geometry)) {
    const s = ringStats(r, proj); if (s.area > best.area) best = s;
  }
  return best.area >= 0 ? { cx: best.cx, cy: best.cy - 2.6 } : null;
}

/** The site: a solid accent, no word — the red is the site throughout the book. */
export function siteMark(b: BaseData, proj: Proj, layer: SiteLayer = 'both'): string {
  if (!b.siteLots.features.length || layer === 'none') return '';
  const t = tpl();
  const d = fcPath(b.siteLots, proj);
  const parts: string[] = [];
  // Solid where the site is a mark; at plan scales, where it is a shape with things inside, a wash and an outline.
  const areaMm2 = b.siteLots.features.reduce((a, f) => a + geomRings(f.geometry).reduce((x, r) => x + ringStats(r, proj).area, 0), 0);
  const solid = areaMm2 < 150;
  if (layer !== 'outline') parts.push(`<path d="${d}" fill="${t.site}" fill-opacity="${solid ? 0.9 : 0.16}" stroke="none"/>`);
  if (layer !== 'wash') parts.push(solid ? `<path d="${d}" fill="${t.site}" stroke="${t.site}" stroke-width="0.4"/>` : `<path d="${d}" fill="none" stroke="${t.site}" stroke-width="0.6"/>`);
  return parts.join('\n');
}

/** North point and a stepped scale bar in the panel's bottom-left corner. */
/** Where the scale bar sits: a bottom corner by default, a top one when the map's marks need the bottom. */
export type FurnitureCorner = 'left' | 'right' | 'topLeft' | 'topRight';

function furnitureGeom(p: Panel, corner: FurnitureCorner) {
  const mmPerM = 1000 / p.scale;
  // the longest round length that keeps the bar under 40 mm: 10 m at 1:400, 200 m at 1:8000, 500 m at 1:16000
  const barM = [5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 20, 10, 5, 2].find((m) => m * mmPerM <= 40) ?? 1;
  const barMm = barM * mmPerM;
  const x0 = corner === 'left' || corner === 'topLeft' ? 3 : p.wMm - barMm - 9.6;
  const y0 = corner === 'topLeft' || corner === 'topRight' ? 11.8 : p.hMm - 3.2;
  return { barM, barMm, x0, y0, box: { x0: x0 - 1.2, y0: y0 - 8.6, x1: x0 - 1.2 + barMm + 9, y1: y0 + 1.8 } };
}

/** The panel-space box the scale bar and north arrow occupy in a corner, so a map can keep its marks out of it. */
export function furnitureBox(p: Panel, corner: FurnitureCorner = 'left'): { x0: number; y0: number; x1: number; y1: number } {
  return furnitureGeom(p, corner).box;
}

/** Scale bar and north arrow, bottom-left unless the map asks for another corner. */
export function panelFurniture(p: Panel, corner: FurnitureCorner = 'left'): string {
  const t = tpl();
  const { barM, barMm, x0, y0 } = furnitureGeom(p, corner);
  const caps = `font-size="${TYPE.t2.size}" font-weight="${TYPE.t2.weight}" letter-spacing="${TYPE.t2.spacing}"`;
  return `<g font-family="${t.font}" fill="${t.ink}">
    <rect x="${x0 - 1.2}" y="${y0 - 8.6}" width="${(barMm + 9).toFixed(1)}" height="10.4" fill="${t.paper}" fill-opacity="0.85"/>
    <rect x="${x0}" y="${y0 - 1.2}" width="${(barMm / 2).toFixed(2)}" height="1.2" fill="${t.ink}"/>
    <rect x="${(x0 + barMm / 2).toFixed(2)}" y="${y0 - 1.2}" width="${(barMm / 2).toFixed(2)}" height="1.2" fill="none" stroke="${t.ink}" stroke-width="0.2"/>
    <text x="${x0}" y="${y0 - 2}" ${caps}>0</text>
    <text x="${(x0 + barMm).toFixed(2)}" y="${y0 - 2}" text-anchor="end" ${caps}>${barM >= 1000 ? `${barM / 1000} KM` : `${barM} M`}</text>
    <g transform="translate(${(x0 + barMm + 5).toFixed(1)},${y0 - 4.2})">
      <path d="M0,-3.2 L1.3,2.2 L0,1.2 L-1.3,2.2 Z" fill="${t.ink}"/>
      <text y="-3.8" text-anchor="middle" ${caps}>N</text>
    </g>
  </g>`;
}

/** Hatch drawn as clipped lines: SVG patterns rasterise blurrily in the PDF. */
export function hatchPath(d: string, id: string, colour: string, bbox: { x0: number; y0: number; x1: number; y1: number }, step = 1.2): string {
  const h = bbox.y1 - bbox.y0;
  let lines = '';
  for (let o = bbox.x0 - h; o <= bbox.x1; o += step)
    lines += `<line x1="${o.toFixed(1)}" y1="${bbox.y1.toFixed(1)}" x2="${(o + h).toFixed(1)}" y2="${bbox.y0.toFixed(1)}"/>`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#${id})" stroke="${colour}" stroke-width="0.22" opacity="0.9">${lines}</g>` +
    `<path d="${d}" fill="none" stroke="${colour}" stroke-width="0.35"/>`;
}

/**
 * A dot grid clipped to a shape — the book's texture for the living layers
 * (parks, canopy, reach), drawn as circles for the same reason the hatch is
 * drawn as lines. Offset rows, so the grid reads as a weave rather than
 * graph paper. `step` sets the density; `r` the dot.
 */
export function dotsPath(d: string, id: string, colour: string, bbox: { x0: number; y0: number; x1: number; y1: number }, step = 1.6, r = 0.3, opacity = 0.9): string {
  let dots = '';
  let row = 0;
  for (let y = bbox.y0; y <= bbox.y1; y += step * 0.866, row++) {
    const off = row % 2 ? step / 2 : 0;
    for (let x = bbox.x0 + off; x <= bbox.x1; x += step)
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
  }
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#${id})" fill="${colour}" opacity="${opacity}">${dots}</g>`;
}

/** The dot-grid legend swatch that matches dotsPath. */
export const swatchDots = (colour: string, stroke?: string) =>
  `<rect x="0" y="0.2" width="5" height="3" fill="none" stroke="${stroke ?? colour}" stroke-width="0.25"/>` +
  `<circle cx="1.2" cy="1.1" r="0.32" fill="${colour}"/><circle cx="2.8" cy="1.1" r="0.32" fill="${colour}"/><circle cx="4.4" cy="1.1" r="0.32" fill="${colour}"/>` +
  `<circle cx="2" cy="2.3" r="0.32" fill="${colour}"/><circle cx="3.6" cy="2.3" r="0.32" fill="${colour}"/>`;

export function bboxOf(rings: number[][][], proj: Proj) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rings) for (const [lon, lat] of r) {
    const [x, y] = proj(lon, lat);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Sutherland–Hodgman clip of a projected ring to the panel rectangle. Area
 * shares and label positions have to come from what is inside the window:
 * an infrastructure polygon that runs the length of a railway is mostly
 * elsewhere, and its centroid can be off the map altogether.
 */
export function clipToPanel(pts: Pt[], w: number, h: number): Pt[] {
  const edges: ((p: Pt) => boolean)[] = [(p) => p[0] >= 0, (p) => p[0] <= w, (p) => p[1] >= 0, (p) => p[1] <= h];
  const cross = (a: Pt, b: Pt, i: number): Pt => {
    const [x, y] = i < 2 ? [i === 0 ? 0 : w, NaN] : [NaN, i === 2 ? 0 : h];
    if (i < 2) { const t = (x - a[0]) / (b[0] - a[0] || 1e-9); return [x, a[1] + (b[1] - a[1]) * t]; }
    const t = (y - a[1]) / (b[1] - a[1] || 1e-9); return [a[0] + (b[0] - a[0]) * t, y];
  };
  let out = pts;
  for (let i = 0; i < 4 && out.length; i++) {
    const inside = edges[i];
    const input = out; out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur, i)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur, i));
    }
  }
  return out;
}

/** Area (mm²) and centroid of a lon/lat ring after clipping to the panel. */
export function clippedStats(ring: number[][], proj: Proj, p: Panel): { area: number; cx: number; cy: number } {
  const pts = clipToPanel(ring.map(([lon, lat]) => proj(lon, lat)), p.wMm, p.hMm);
  if (pts.length < 3) return { area: 0, cx: 0, cy: 0 };
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-6) return { area: 0, cx: pts[0][0], cy: pts[0][1] };
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
}

/**
 * Keeps map labels apart: candidates come sorted by importance (area), and a
 * label is dropped rather than drawn over one already placed. `wMm` is the
 * label's own width, so long names claim the room they take.
 */
export class LabelSpacer {
  private placed: { x: number; y: number; w: number; h: number }[] = [];
  constructor(private wMm: number, private hMm: number, private max = 60) {}
  take(x: number, y: number, w: number, h = 2.6): boolean {
    if (this.placed.length >= this.max) return false;
    if (x - w / 2 < 1 || x + w / 2 > this.wMm - 1 || y - h / 2 < 1 || y + h / 2 > this.hMm - 1) return false;
    for (const q of this.placed)
      if (Math.abs(q.x - x) < (q.w + w) / 2 + 0.8 && Math.abs(q.y - y) < (q.h + h) / 2 + 0.6) return false;
    this.placed.push({ x, y, w, h });
    return true;
  }
}

export interface LegendEntry { swatch: string; label: string }
/**
 * A legend as an SVG group, two columns, `rows` rows per column at most. The
 * swatch is an SVG fragment drawn in a 5 × 3 mm box at the origin.
 */
export function legendSvg(entries: LegendEntry[], widthMm: number, rows = 5, fontSize = 2.1): { svg: string; heightMm: number } {
  const lh = fontSize * 1.72;
  const cols = 2;
  const fits = entries.length <= rows * cols;
  const perCol = fits ? rows : rows - 1;
  const shown = entries.slice(0, perCol * cols);
  const colW = widthMm / cols;
  const parts: string[] = [];
  shown.forEach((e, i) => {
    const c = Math.floor(i / perCol), r = i % perCol;
    parts.push(`<g transform="translate(${(c * colW).toFixed(1)},${(r * lh).toFixed(1)})">${e.swatch}` +
      `<text x="6.5" y="${(fontSize * 1.05).toFixed(2)}" font-size="${fontSize}">${esc(e.label)}</text></g>`);
  });
  if (!fits) {
    parts.push(`<text x="0" y="${(perCol * lh + fontSize * 1.05).toFixed(2)}" font-size="${fontSize}" fill="#555">+ ${entries.length - shown.length} more (see the deck's JSON)</text>`);
  }
  const used = (fits ? Math.min(entries.length, perCol) : perCol + 1) * lh;
  return { svg: `<g font-family="${tpl().font}" fill="${tpl().ink}">${parts.join('')}</g>`, heightMm: used };
}

export const swatchFill = (fill: string, stroke = '#8a8378', dash?: string) =>
  `<rect x="0" y="0.2" width="5" height="3" fill="${fill}" stroke="${stroke}" stroke-width="0.25"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
export const swatchHatch = (colour: string) =>
  `<rect x="0" y="0.2" width="5" height="3" fill="none" stroke="${colour}" stroke-width="0.3"/>` +
  `<line x1="0" y1="3.2" x2="3" y2="0.2" stroke="${colour}" stroke-width="0.25"/><line x1="2" y1="3.2" x2="5" y2="0.2" stroke="${colour}" stroke-width="0.25"/>`;
export const swatchLine = (colour: string, width = 0.7, dash?: string) =>
  `<line x1="0" y1="1.7" x2="5" y2="1.7" stroke="${colour}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

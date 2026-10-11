// Composes the A1 CONTEXT ANALYSIS sheet as an HTML page (SVG map + title
// block column). Geometry and typography are measured from the office's
// reference sheet (2539 Campsie) with PyMuPDF — see docs/SHEET_SPEC.md.

import type { Bundle } from '../pipeline.js';
import { lonLatToMercator, ringCentroid, type Extent, type MapView } from '../lib/geo.js';
import { categories, catById, zoneToCategory } from './model.js';
import { tpl, type Texture } from './template.js';
import { sheetHtml, legendHeightFor, esc, T, SWATCH_X, SWATCH_W, LABEL_X,
         SHEET_W, SHEET_H, FRAME_L, FRAME_T, TITLE_X, TITLE_R, MAP_BOTTOM, MAP_W, MAP_H } from './chrome.js';

// Geometry/typography constants live in chrome.ts (shared by all sheet
// types); re-exported here for existing importers (cli, server, pdf).
export { SHEET_W, SHEET_H, FRAME_L, FRAME_T, TITLE_X, TITLE_R, MAP_BOTTOM, MAP_W, MAP_H };

export interface SheetMeta {
  jobNo: string;
  client: string;
  clientLines?: string[];
  status: string;
  sheetNo: string;
  revision: string;
  checked: string;
  drawn: string;
  date: string;
  preliminary: boolean;
  /** The site sheet's sun and wind drawing: sketched sun and wind ribbons, or the 21 June hour fan with straight wind arrows. */
  siteSymbols?: 'sketch' | 'hours';
}

export type Pt = [number, number];

// Projector rotates about the map center when the view is rotated: the
// site's long boundary runs horizontally, north tilts (compass follows).
export function makeProjector(view: MapView) {
  const s = MAP_W / (2 * view.halfW);
  const r = (view.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return (lon: number, lat: number): Pt => {
    const m = lonLatToMercator({ lon, lat });
    const u = (m.x - view.cx) * s;
    const v = (view.cy - m.y) * s;
    return [u * cos - v * sin + MAP_W / 2, u * sin + v * cos + MAP_H / 2];
  };
}

export function pathFromRings(rings: number[][][], proj: (lon: number, lat: number) => Pt, close = true): string {
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

export function geomRings(geometry: any): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function wrapLabel(name: string, maxChars = 14): string[] {
  const words = name.toUpperCase().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// White back-contour via double drawing (a stroked copy underneath, a filled
// copy on top) — paint-order is not reliable across text layouts in Chromium.
export function haloText(x: number, y: number, lines: string[], size: number, fill: string, weight = 700): string {
  const lh = size * 1.12;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`)
    .join('');
  const attrs = `text-anchor="middle" font-size="${size}" font-weight="${weight}"`;
  return `<g><text ${attrs} fill="none" stroke="#ffffff" stroke-width="${(size * 0.3).toFixed(2)}" stroke-linejoin="round">${tspans}</text>
    <text ${attrs} fill="${fill}">${tspans}</text></g>`;
}

/** Map label: bold black narrow text, no contour (the office map-text style). */
export function plainText(x: number, y: number, lines: string[], size: number, fill = '#000000'): string {
  const lh = size * 1.08;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`)
    .join('');
  return `<text text-anchor="middle" font-size="${size}" font-weight="700" fill="${fill}">${tspans}</text>`;
}

/**
 * White double-headed arrow along the (straight-enough) middle of a polyline.
 * Returns null when the geometry bends too much for a straight arrow. The
 * context sheet no longer bands its street names; the site sheet still does.
 */
export interface BandArrow { svg: string; cx: number; cy: number; angDeg: number }

export function arrowAlong(pts: Pt[], lengthMm: number): BandArrow | null {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < lengthMm) return null;
  const at = (s: number): Pt => {
    let i = cum.findIndex((c) => c >= s);
    if (i <= 0) i = 1;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const s0 = total / 2 - lengthMm / 2, s1 = total / 2 + lengthMm / 2;
  const a = at(s0), b = at(s1);
  // straightness: intermediate points close to the chord
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const chord = Math.hypot(dx, dy);
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] < s0 || cum[i] > s1) continue;
    const dev = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / chord;
    if (dev > 2.5) return null;
  }
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  // Band arrow: the shaft is tall enough to carry the street name (it is the
  // label's background), heads roughly twice the band height.
  const hl = 8.0, hw = 6.0, sh = 3.1;
  const L = chord;
  const svg = `<g transform="translate(${a[0].toFixed(1)},${a[1].toFixed(1)}) rotate(${ang.toFixed(1)})" fill="#ffffff">
    <path d="M0,0 L${hl},${-hw} L${hl},${-sh} L${(L - hl).toFixed(1)},${-sh} L${(L - hl).toFixed(1)},${-hw} L${L.toFixed(1)},0
             L${(L - hl).toFixed(1)},${hw} L${(L - hl).toFixed(1)},${sh} L${hl},${sh} L${hl},${hw} Z"/>
  </g>`;
  return { svg, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, angDeg: ang };
}

/** Walking-person pictogram (Material Symbols directions_walk, Apache-2.0),
 *  24x24 units, recentered; fill takes the given color. */
export function walkerGlyph(color: string, scale: number): string {
  return `<g transform="scale(${scale}) translate(-12.6,-13.5)"><path fill="${color}" d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></g>`;
}

/** Walker-in-circle marker sitting on an isochrone ring, all in ring color. */
export function walkerMedallion(x: number, y: number, color: string): string {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <circle r="4.1" fill="#ffffff" stroke="${color}" stroke-width="1.1"/>
    ${walkerGlyph(color, 0.30)}
  </g>`;
}

/**
 * `count` positions spaced evenly along a closed ring by arc length, skipping
 * anything off the sheet and never stacking two markers on top of each other.
 * `phase` (0..1) rotates the whole set so two rings can be staggered.
 */
function ringMarkers(pts: Pt[], count: number, phase: number): Pt[] {
  const inView = ([x, y]: Pt) => x > 14 && x < MAP_W - 14 && y > 14 && y < MAP_H - 14;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const visible = pts.map((p, i) => ({ p, s: cum[i] })).filter((o) => inView(o.p));
  if (!visible.length) return [];
  const out: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const want = total * (((k + phase) / count) % 1);
    let best: Pt | null = null;
    let bestDist = Infinity;
    for (const v of visible) {
      let d = Math.abs(v.s - want);
      d = Math.min(d, total - d);                     // the ring is closed
      if (d >= bestDist) continue;
      if (out.some((o) => Math.hypot(o[0] - v.p[0], o[1] - v.p[1]) < 26)) continue;
      bestDist = d; best = v.p;
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * A vector texture (dots, diagonal hatch, cross-hatch) clipped to a shape.
 * Real lines rather than an SVG pattern: patterns rasterize blurrily when
 * Chromium prints to PDF. Dots are a round-capped line with a hairline dash,
 * so a textured suburb costs a few hundred elements, not a hundred thousand.
 * `box` is the area the texture must cover (the map, or a legend swatch).
 */
export function textureSvg(clipId: string, clipPathD: string, kind: Texture, color: string,
                           box: { x: number; y: number; w: number; h: number }, opacity = 0.8): string {
  const { x, y, w, h } = box;
  let lines = '';
  if (kind === 'dots') {
    const step = 1.7;
    for (let i = 0, yy = y + step / 2; yy <= y + h; yy += step, i++) {
      const off = i % 2 ? step / 2 : 0;
      lines += `<line x1="${(x - off).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${yy.toFixed(1)}"/>`;
    }
    return `<clipPath id="${clipId}"><path d="${clipPathD}" clip-rule="evenodd"/></clipPath>
      <g clip-path="url(#${clipId})" stroke="${color}" stroke-width="0.6" stroke-linecap="round" stroke-dasharray="0.01,${1.7}" opacity="${opacity}">${lines}</g>`;
  }
  // The hatch falls to the right, the opposite way to the heritage hatch
  // drawn elsewhere, so a heritage item inside a commercial centre still
  // shows as two textures crossing rather than one thicker one.
  const step = kind === 'cross' ? 2.0 : 1.6;
  for (let o = x - h; o <= x + w; o += step)
    lines += `<line x1="${o.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(o + h).toFixed(1)}" y2="${(y + h).toFixed(1)}"/>`;
  if (kind === 'cross')
    for (let o = x - h; o <= x + w; o += step)
      lines += `<line x1="${o.toFixed(1)}" y1="${(y + h).toFixed(1)}" x2="${(o + h).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  return `<clipPath id="${clipId}"><path d="${clipPathD}" clip-rule="evenodd"/></clipPath>
    <g clip-path="url(#${clipId})" stroke="${color}" stroke-width="0.22" opacity="${opacity}">${lines}</g>`;
}

/** Abbreviate street types the way the office labels them (CAMPSIE ST, WILFRED AVE). */
export function shortStreetName(name: string): string {
  return name.toUpperCase()
    .replace(/\bSTREET\b/, 'ST').replace(/\bROAD\b/, 'RD').replace(/\bAVENUE\b/, 'AVE')
    .replace(/\bPARADE\b/, 'PDE').replace(/\bHIGHWAY\b/, 'HWY').replace(/\bDRIVE\b/, 'DR')
    .replace(/\bLANE\b/, 'LN').replace(/\bPLACE\b/, 'PL').replace(/\bCRESCENT\b/, 'CRES')
    .replace(/\bBOULEVARD\b/, 'BVD').replace(/\bTERRACE\b/, 'TCE').replace(/\bCOURT\b/, 'CT');
}

/**
 * Does this road carry the white arrow band (on the site sheet), or is it a
 * lane that only gets a plain label? NSW classifies both function and lane count, and neither alone
 * is enough: Dickson Lane is a "LocalRoad" (6) exactly like Hall Street, but
 * it is one lane wide — while an arterial with unrecorded lanes is still a
 * street. Hierarchy 7+ is service lane / track / path / access way.
 */
export function isMajorStreet(hierarchy: number, lanes: number | undefined, name: string): boolean {
  if (hierarchy >= 7) return false;
  if (/\b(LANE|LN|WALK|PATH|TRACK|STEPS|ARCADE|CLOSE)\b/i.test(name)) return false;
  if (lanes === 1) return false;
  return true;
}

/**
 * Join road pieces that meet end to end into continuous runs.
 *
 * The road network arrives split at every intersection — Bondi Road is 32
 * separate features, none longer than 163m — so a label placed on a single
 * piece can never carry an arrow band across a junction, and a through road
 * ends up looking like a laneway. Chaining the pieces back together first
 * gives each street its real length to label along.
 */
function mergeRuns(segs: Pt[][]): Pt[][] {
  const EPS = 0.4; // mm; endpoints of touching pieces are not bit-identical
  const key = (p: Pt) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [key(s[0]), key(s[s.length - 1])]) {
      const a = at.get(k);
      if (a) a.push(i); else at.set(k, [i]);
    }
  });
  const used = new Array(segs.length).fill(false);
  const runs: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let run = [...segs[i]];
    // Grow off the tail, flip, grow off the other tail. A same-named branch at
    // a T-junction is taken arbitrarily; the leftover arm becomes its own run.
    for (let side = 0; side < 2; side++) {
      for (;;) {
        const tail = run[run.length - 1];
        const next = (at.get(key(tail)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = true;
        const s = segs[next];
        run = run.concat(key(s[0]) === key(tail) ? s.slice(1) : [...s].reverse().slice(1));
      }
      run.reverse();
    }
    runs.push(run);
  }
  return runs;
}

/**
 * Does this polyline stay close enough to its own chord to carry a straight
 * label? A name set along a run that turns a corner comes out broken across
 * the bend ("COULTO N ST"), so the slot has to be rejected and the label slid
 * further along the road.
 */
function straightEnough(pts: Pt[], tolMm: number): boolean {
  const a = pts[0], b = pts[pts.length - 1];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const chord = Math.hypot(dx, dy);
  if (chord < 1) return false;
  for (const p of pts)
    if (Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / chord > tolMm) return false;
  return true;
}

/** Arc-length table for a polyline, and the sub-polyline between two arc positions. */
function arcTable(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}
function sliceAt(pts: Pt[], cum: number[], s0: number, s1: number): Pt[] {
  const point = (s: number): Pt => {
    let i = cum.findIndex((c) => c >= s);
    if (i <= 0) i = 1;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const out: Pt[] = [point(s0)];
  for (let i = 0; i < pts.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i]);
  out.push(point(s1));
  return out;
}

export function renderSheet(bundle: Bundle, meta: SheetMeta): string {
  const view = bundle.view ?? {
    cx: (bundle.extent.xmin + bundle.extent.xmax) / 2,
    cy: (bundle.extent.ymin + bundle.extent.ymax) / 2,
    halfW: (bundle.extent.xmax - bundle.extent.xmin) / 2,
    halfH: (bundle.extent.ymax - bundle.extent.ymin) / 2,
    rotationDeg: 0,
  };
  const proj = makeProjector(view);
  const usedCats = new Set<string>();
  const layers: string[] = [];

  // ---- ground --------------------------------------------------------------
  // Paper: plain white, because the photograph under the tints greys every
  // colour, and its grain is what the lot hairlines and the white streets
  // already give. Aerial: the tiles under a white veil, with the tints thinned
  // below so the photograph reads through them. The tiles are fetched either
  // way; the CAD export carries them on its own layer.
  const aerialGround = tpl().ground === 'aerial';
  // Bus routes, on the map and in the legend: dashed, or round dots a little
  // apart at half opacity so the route is there without competing.
  // Finer than the catchment dots: the railway data has a line per track,
  // so a corridor of three or four tracks stacks them into a band.
  const RAIL_DOTS = 'stroke-width="1.15" stroke-dasharray="0.01,2.0" stroke-linecap="round" opacity="0.9"';
  const busLineStyle = tpl().busLine === 'dotted'
    ? 'stroke-width="1.1" stroke-dasharray="0.01,1.9" opacity="0.5"'
    : 'stroke-width="0.9" stroke-dasharray="3,1.9" opacity="0.9"';
  layers.push(`<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="#ffffff"/>`);
  if (aerialGround) {
    // Tiles cover the axis-aligned fetch extent; place them in that rectangle
    // (centred on the map) and rotate the whole group with the view.
    const s = MAP_W / (2 * view.halfW);
    const extW = (bundle.extent.xmax - bundle.extent.xmin) * s;
    const extH = (bundle.extent.ymax - bundle.extent.ymin) * s;
    const ox = MAP_W / 2 - extW / 2, oy = MAP_H / 2 - extH / 2;
    const tiles = bundle.aerial.tiles
      .map((t) => `<image href="data/${t.file}" x="${(ox + t.left * extW).toFixed(2)}" y="${(oy + t.top * extH).toFixed(2)}"
          width="${(t.width * extW).toFixed(2)}" height="${(t.height * extH).toFixed(2)}" preserveAspectRatio="none"/>`)
      .join('\n');
    // A greyscale aerial keeps the photograph's grain without its greens and
    // terracottas fighting the tints.
    const grey = tpl().aerialTone === 'grey';
    if (grey) layers.push(`<defs><filter id="aerialGrey" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>`);
    layers.push(`<g transform="rotate(${view.rotationDeg.toFixed(2)}, ${MAP_W / 2}, ${MAP_H / 2})"${grey ? ' filter="url(#aerialGrey)"' : ''}>${tiles}</g>`);
    layers.push(`<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="#ffffff" opacity="${tpl().veil ?? 0.3}"/>`);
  }
  // Over the aerial the tints are thinned so the photograph shows through.
  const tintScale = aerialGround ? (tpl().tintScale ?? 0.55) : 1;

  // ---- zoning base -------------------------------------------------------
  const zoningByCat: Record<string, string[]> = {};
  for (const f of bundle.zoning.features) {
    const cat = zoneToCategory(f.properties.SYM_CODE);
    if (!cat) continue;
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    (zoningByCat[cat] ??= []).push(pathFromRings(rings, proj));
  }
  const catStyle = (c: { fill: string; opacity: number; stroke?: string }) =>
    `fill="${c.fill}" opacity="${(c.opacity * tintScale).toFixed(2)}" fill-rule="evenodd"` +
    (c.stroke ? ` stroke="${c.stroke}" stroke-width="0.5" stroke-linejoin="round"` : '');
  // A category's fill, then its texture clipped to the same shapes.
  let tex = 0;
  const mapBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };
  const catLayer = (c: { fill: string; opacity: number; stroke?: string; texture?: Texture; textureColor?: string }, paths: string[]) => {
    let svg = `<g ${catStyle(c)}>` + paths.map((d) => `<path d="${d}"/>`).join('') + '</g>';
    if (c.texture) svg += textureSvg(`tx${tex++}`, paths.join(''), c.texture, c.textureColor ?? c.stroke ?? c.fill, mapBox);
    return svg;
  };

  for (const [cat, paths] of Object.entries(zoningByCat)) {
    const c = catById()[cat];
    usedCats.add(cat);
    layers.push(catLayer(c, paths));
  }

  // ---- railway corridor --------------------------------------------------
  if (bundle.railCorridors.features.length) {
    usedCats.add('railway');
    const c = catById().railway;
    const d = bundle.railCorridors.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" ${catStyle(c)}/>`);
  }

  // ---- institution property fills (function beats zone) ------------------
  const poiPathsByCat: Record<string, string[]> = {};
  for (const inst of bundle.institutionPolys) {
    const rings = inst.rings.filter((r) => r.length >= 3);
    if (!rings.length) continue;
    (poiPathsByCat[inst.cat] ??= []).push(pathFromRings(rings, proj));
  }
  for (const [cat, paths] of Object.entries(poiPathsByCat)) {
    const c = catById()[cat];
    usedCats.add(cat);
    layers.push(catLayer(c, paths));
  }

  // ---- building footprints: the grain inside the blocks -------------------
  // Each footprint takes the ink of the ground it stands on — the darker
  // member of the tint's family — so a block reads as a firm figure on a light
  // ground, and never black, which would weigh the sheet down again. The
  // ground is the institution parcel or zoning polygon under the footprint's
  // centroid; a footprint on no tinted ground is a mid grey.
  if (bundle.buildings.buildings.length && tpl().footprints !== 'none') {
    // One ground per shape, with all its rings: a point is inside when an odd
    // number of them contain it, as the fill's evenodd rule draws it. Testing
    // ring by ring took a hole for more of the shape — a classified-road
    // reserve is one polygon whose holes are the street blocks, so every house
    // in those blocks came out as infrastructure.
    interface Ground { cat: string; rings: number[][][]; bbox: [number, number, number, number] }
    const grounds: Ground[] = [];
    const addGround = (cat: string, rings: number[][][]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ring of rings)
        for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (rings.length) grounds.push({ cat, rings, bbox: [x0, y0, x1, y1] });
    };
    // Parcels first, so a school's buildings take the school's tint over the zone's.
    for (const inst of bundle.institutionPolys) addGround(inst.cat, inst.rings);
    for (const f of bundle.zoning.features) {
      const cat = zoneToCategory(f.properties.SYM_CODE);
      if (!cat) continue;
      addGround(cat, geomRings(f.geometry));
    }
    const groundAt = (lon: number, lat: number): string | null => {
      for (const g of grounds) {
        const [x0, y0, x1, y1] = g.bbox;
        if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
        let inside = false;
        for (const r of g.rings) if (pointInRing(lon, lat, r)) inside = !inside;
        if (inside) return g.cat;
      }
      return null;
    };
    const byCat = new Map<string, string[]>();
    for (const b of bundle.buildings.buildings) {
      const cat = groundAt(b.centroid[0], b.centroid[1]) ?? '';
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(pathFromRings(b.rings, proj));
    }
    for (const [cat, paths] of byCat) {
      const c = cat ? catById()[cat] : undefined;
      const ink = c?.figure ?? c?.fill ?? tpl().road;
      const d = paths.map((p) => `<path d="${p}"/>`).join('');
      if (tpl().footprints === 'colour') {
        // The building in its family's strong colour on the family's pale
        // ground; a building on no zone is a quiet grey.
        layers.push(`<g fill="${c?.figure ?? '#d9d9d6'}" fill-rule="evenodd">${d}</g>`);
      } else {
        // White buildings with a hairline of the family ink, so they read as
        // figures on the tint and not as more of the white street.
        layers.push(`<g fill="#ffffff" fill-opacity="0.92" stroke="${ink}" stroke-width="0.12" stroke-linejoin="round" fill-rule="evenodd">${d}</g>`);
      }
    }
  }

  // ---- thin cadastral lot-boundary overlay --------------------------------
  if (bundle.allLots.features.length) {
    const d = bundle.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${tpl().road}" stroke-width="0.12" opacity="0.5"/>`);
  }

  // ---- streets: white strips over the tints -----------------------------
  // The road reserve in white, as the office sheets and most figure-ground
  // maps show it, so the blocks read as tinted islands on paper. Width by
  // function hierarchy, in metres on the ground scaled to the sheet: an
  // arterial reserve is about 30 m, a local street 20 m, a lane 8 m. A
  // template over the aerial can leave them out: the photograph has them.
  if (tpl().streets !== 'none') {
    const mmPerM = 1000 / bundle.scale;
    const reserveM = (h: number) => (h <= 2 ? 36 : h === 3 ? 30 : h === 4 ? 24 : h === 5 ? 20 : h === 6 ? 17 : 8);
    const byWidth = new Map<number, string[]>();
    for (const r of bundle.roads) {
      const w = reserveM(r.hierarchy);
      (byWidth.get(w) ?? byWidth.set(w, []).get(w)!).push(pathFromRings([r.coords as any], proj, false));
    }
    for (const [w, ds] of [...byWidth].sort((a, b) => b[0] - a[0]))
      layers.push(`<path d="${ds.join('')}" fill="none" stroke="#ffffff" stroke-width="${(w * mmPerM).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`);
  }

  // ---- heritage ----------------------------------------------------------
  // Hatch drawn as real vector lines clipped to each polygon — SVG patterns
  // rasterize blurrily when Chromium prints to PDF.
  // Only heritage ITEMS are hatched (conservation areas would flood whole
  // suburbs — the reference sheets never show them on this sheet).
  const heritageItems = bundle.heritage.features.filter((f) =>
    /^Item/i.test(f.properties.LAY_CLASS ?? 'Item'));
  if (heritageItems.length) {
    usedCats.add('heritage');
    const parts: string[] = [];
    let hi = 0;
    for (const f of heritageItems) {
      const rings = geomRings(f.geometry).filter((r) => r.length >= 3);
      if (!rings.length) continue;
      const projRings = rings.map((r) => r.map(([lon, lat]) => proj(lon, lat)));
      const d = projRings
        .map((pr) => 'M' + pr.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z')
        .join('');
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of projRings.flat()) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (x1 < -5 || x0 > MAP_W + 5 || y1 < -5 || y0 > MAP_H + 5) continue;
      const id = `hh${hi++}`;
      const h = y1 - y0;
      const step = Math.max(1.7, (x1 - x0 + h) / 600); // cap line count on huge areas
      let lines = '';
      for (let o = x0 - h; o <= x1; o += step)
        lines += `<line x1="${o.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(o + h).toFixed(1)}" y2="${y0.toFixed(1)}"/>`;
      parts.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>
        <g clip-path="url(#${id})" stroke="${tpl().heritage}" stroke-width="0.28" opacity="0.85">${lines}</g>
        <path d="${d}" fill="none" stroke="${tpl().heritage}" stroke-width="0.3" opacity="0.85"/>`);
    }
    layers.push(parts.join('\n'));
  }

  // ---- transit route lines (train / tram / bus) --------------------------
  if (bundle.railLines.train.length) {
    const d = bundle.railLines.train.map((l) => pathFromRings([l as any], proj, false)).join('');
    if (tpl().railLine === 'dotted') {
      // A line of round dots in the rail colour, close-set so it reads as a
      // track and not as another route.
      layers.push(`<path d="${d}" fill="none" stroke="${tpl().rail}" ${RAIL_DOTS}/>`);
    } else {
      // classic railway line: dark stroke with white sleeper dashes on top
      layers.push(`<path d="${d}" fill="none" stroke="${tpl().rail}" stroke-width="1.1"/>`);
      layers.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.55" stroke-dasharray="2.4,2.4"/>`);
    }
  }
  if (bundle.railLines.tram.length) {
    const d = bundle.railLines.tram.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${tpl().busRoute}" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`);
  }
  if (bundle.bus.tramRouteSegments.length && !bundle.railLines.tram.length) {
    const d = bundle.bus.tramRouteSegments.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${tpl().busRoute}" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`);
  }
  // Bus routes from OSM when available; otherwise derive corridors from the
  // road network — any street with a bus stop within 30m carries a route.
  let busSegments = bundle.bus.busRouteSegments as [number, number][][];
  if (!busSegments.length && bundle.bus.busStops.length) {
    const stopsM = bundle.bus.busStops.map((s) => lonLatToMercator({ lon: s.lon, lat: s.lat }));
    const nearStops = (road: { coords: [number, number][] }): number => {
      const pts = road.coords.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
      let n = 0;
      for (const st of stopsM) {
        for (let i = 1; i < pts.length; i++) {
          const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy;
          const t = L2 ? Math.max(0, Math.min(1, ((st.x - ax) * dx + (st.y - ay) * dy) / L2)) : 0;
          if (Math.hypot(st.x - (ax + t * dx), st.y - (ay + t * dy)) < 30) { n++; break; }
        }
      }
      return n;
    };
    // A route follows the whole street, not just the blocks with stops: when
    // a road name carries 2+ stops anywhere, include all its segments so the
    // dashed line runs continuously; single-stop roads keep only their
    // touched segments.
    const stopsByName = new Map<string, number>();
    const nearByRoad = bundle.roads.map((r) => {
      const n = nearStops(r);
      stopsByName.set(r.name, (stopsByName.get(r.name) ?? 0) + n);
      return n;
    });
    const qualifies = bundle.roads.map((r, i) =>
      (stopsByName.get(r.name) ?? 0) >= 2 || nearByRoad[i] > 0);

    // Stitch the network together: routes turn through short connector
    // streets that carry no stop themselves. Build a road graph, find the
    // disconnected clusters of qualifying segments, and join them with the
    // fewest connector segments (BFS through the full network).
    const nodeKey = (p: [number, number]) => {
      const m = lonLatToMercator({ lon: p[0], lat: p[1] });
      return `${Math.round(m.x / 20)}:${Math.round(m.y / 20)}`;
    };
    const segNodes = bundle.roads.map((r) => [nodeKey(r.coords[0]), nodeKey(r.coords[r.coords.length - 1])]);
    const byNode = new Map<string, number[]>();
    segNodes.forEach(([a, b], i) => {
      (byNode.get(a) ?? byNode.set(a, []).get(a)!).push(i);
      (byNode.get(b) ?? byNode.set(b, []).get(b)!).push(i);
    });
    // components of qualifying segments
    const comp = new Array(bundle.roads.length).fill(-1);
    let nComp = 0;
    for (let i = 0; i < bundle.roads.length; i++) {
      if (!qualifies[i] || comp[i] >= 0) continue;
      const stack = [i];
      comp[i] = nComp;
      while (stack.length) {
        const s = stack.pop()!;
        for (const nk of segNodes[s]) {
          for (const j of byNode.get(nk) ?? []) {
            if (qualifies[j] && comp[j] < 0) { comp[j] = nComp; stack.push(j); }
          }
        }
      }
      nComp++;
    }
    const extra = new Set<number>();
    if (nComp > 1) {
      // BFS over nodes from the largest component; absorb other components
      // via the connector segments discovered on the way (bounded hops).
      const sizes = new Array(nComp).fill(0);
      comp.forEach((c) => { if (c >= 0) sizes[c]++; });
      const mainComp = sizes.indexOf(Math.max(...sizes));
      const nodeOf = new Map<string, { dist: number; via: number[] }>();
      const queue: string[] = [];
      bundle.roads.forEach((_, i) => {
        if (comp[i] === mainComp) for (const nk of segNodes[i]) {
          if (!nodeOf.has(nk)) { nodeOf.set(nk, { dist: 0, via: [] }); queue.push(nk); }
        }
      });
      while (queue.length) {
        const nk = queue.shift()!;
        const cur = nodeOf.get(nk)!;
        if (cur.dist >= 4) continue; // max 4 connector segments
        for (const j of byNode.get(nk) ?? []) {
          const other = segNodes[j][0] === nk ? segNodes[j][1] : segNodes[j][0];
          if (qualifies[j] && comp[j] !== mainComp) {
            cur.via.forEach((s) => extra.add(s)); // reached another cluster
            continue;
          }
          if (!nodeOf.has(other)) {
            nodeOf.set(other, { dist: cur.dist + 1, via: [...cur.via, j] });
            queue.push(other);
          }
        }
      }
    }
    busSegments = bundle.roads
      .filter((r, i) => qualifies[i] || extra.has(i))
      .map((r) => r.coords);
  }
  if (busSegments.length) {
    const d = busSegments.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${tpl().transit}" ${busLineStyle} stroke-linecap="round"/>`);
  }

  // ---- isochrones --------------------------------------------------------
  const ISO_W = 3.4, ISO_OPACITY = 0.3;
  const isoStyle: Record<number, { color: string; label: string }> = {
    5: { color: tpl().walk5, label: '400m (5-MIN WALK)' },
    10: { color: tpl().walk10, label: '800m (10-MIN WALK)' },
  };
  const lineIso = tpl().isochrone === 'line';
  const dottedIso = tpl().isochrone === 'dotted';
  const walkerIso = tpl().isochrone === 'walkers';
  // Round dots a little apart, the way the bus routes are drawn but bolder.
  const ISO_DOTS = 'stroke-width="1.7" stroke-dasharray="0.01,2.8" stroke-linecap="round"';
  for (const iso of bundle.isochrones) {
    const st = isoStyle[iso.minutes] ?? { color: tpl().walk5, label: `${iso.minutes} MIN WALK` };
    const d = iso.rings.map((r) => pathFromRings([r as any], proj)).join('');
    if (dottedIso) {
      layers.push(`<path d="${d}" fill="none" stroke="${st.color}" ${ISO_DOTS} opacity="0.85" stroke-linejoin="round"/>`);
    } else if (walkerIso) {
      // The office style: a dashed line with walker medallions spaced along
      // the ring's own length, staggered between the two contours.
      layers.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="1.3" stroke-dasharray="3.6,2.2" stroke-linejoin="round"/>`);
      const ring = [...iso.rings].sort((a, b) => b.length - a.length)[0];
      if (ring) {
        const pts: Pt[] = ring.map(([lon, lat]) => proj(lon, lat));
        for (const [x, y] of ringMarkers(pts, 4, iso.minutes === 5 ? 0.15 : 0.6)) layers.push(walkerMedallion(x, y, st.color));
      }
    } else if (lineIso) {
      // A plain continuous line, nothing on it.
      layers.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="1.2" stroke-linejoin="round"/>`);
    } else {
      // A broad, continuous, translucent band rather than a dashed hairline:
      // the catchment reads as a soft edge the map shows through.
      layers.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${ISO_W}" opacity="${ISO_OPACITY}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }
  // ---- site --------------------------------------------------------------
  {
    usedCats.add('site');
    const d = bundle.siteLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="${tpl().site}" fill-opacity="0.55" stroke="${tpl().site}" stroke-width="1.4" stroke-dasharray="3.2,1.6"/>`);
  }

  // ---- transport symbols: one roundel style for all modes -----------------
  // Same size for train/bus/tram; the template says whether it is a white
  // disc with a coloured ring and letter, or a solid disc with a white letter.
  // The place-number discs share this radius, so every dot on the map is one
  // size: between the old roundel (4.0 mm) and the old number disc (2.9 mm).
  const MARK_R = 3.4;
  const RR = MARK_R;
  const MARK_LETTER = T.mapSymbol * 0.82;
  const solidRoundel = tpl().roundel === 'solid';
  const roundelAt = (r: number, letter: string, color: string, size: number) =>
    solidRoundel
      ? `<circle r="${r}" fill="${color}"/><text text-anchor="middle" dy="${(size * 0.36).toFixed(2)}" font-size="${size}" font-weight="700" fill="#ffffff">${letter}</text>`
      : `<circle r="${r}" fill="#ffffff" stroke="${color}" stroke-width="${(r * 0.22).toFixed(2)}"/><text text-anchor="middle" dy="${(size * 0.36).toFixed(2)}" font-size="${size}" font-weight="700" fill="${color}">${letter}</text>`;
  const roundel = (x: number, y: number, letter: string, color: string) =>
    `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${roundelAt(RR, letter, color, MARK_LETTER)}</g>`;

  layers.push(bundle.bus.busStops
    .map(({ lon, lat }) => proj(lon, lat))
    .filter(([x, y]) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3)
    .map(([x, y]) => roundel(x, y, 'B', tpl().transit))
    .join('\n'));

  layers.push(bundle.bus.tramStops
    .map(({ lon, lat }) => proj(lon, lat))
    .filter(([x, y]) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3)
    .map(([x, y]) => roundel(x, y, 'L', tpl().busRoute))
    .join('\n'));

  // The station's name is in the key, not on the map: the only words on the
  // map are the street names.
  const stationsOnMap = bundle.stations
    .map((s) => ({ p: proj(s.lon, s.lat), name: s.name.replace(/RAILWAY STATION$/i, 'TRAIN STATION'), tram: /LIGHT RAIL|TRAM/i.test(s.name) }))
    .filter(({ p: [x, y] }) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3);
  layers.push(stationsOnMap
    .map(({ p: [x, y], tram }) => roundel(x, y, tram ? 'L' : 'T', tram ? tpl().busRoute : tpl().site))
    .join('\n'));

  // ---- label occupancy ----------------------------------------------------
  // One shared reservation list for every piece of map text, so a street name
  // is not laid over a school name or over another street name. Each label
  // reserves a capsule around its baseline: a radius around a point label, a
  // swept segment for a street name lying along its road.
  //
  // Place-name labels go first because they cannot move — they belong to the
  // parcel they name — while a street name is free to slide along its road,
  // so it is the one that should give way.
  interface Claim { a: Pt; b: Pt; r: number }
  const claims: Claim[] = [];
  const segGap = (p: Pt, q: Pt, a: Pt, b: Pt): number => {
    // distance between segments pq and ab, by sampling — exact enough at the
    // 1mm scale these tolerances work at, and far shorter than the closed form
    let best = Infinity;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const c: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const d: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        best = Math.min(best, Math.hypot(c[0] - d[0], c[1] - d[1]));
      }
    }
    return best;
  };
  const isFree = (a: Pt, b: Pt, r: number) => !claims.some((c) => segGap(a, b, c.a, c.b) < r + c.r);
  const reserve = (a: Pt, b: Pt, r: number) => { claims.push({ a, b, r }); };

  // ---- places: a number on the map, the name in the key -------------------
  // The only words on the map are the street names. Every institution and
  // park carries a number instead — at the parcel's centroid, at the point
  // itself where no parcel was coloured, and for a park at the centroid of
  // the open-space field it sits in — and the legend carries the key, the
  // institutions in the legend's category order, then the open spaces.
  const inBounds = (x: number, y: number) => x > 10 && x < MAP_W - 10 && y > 8 && y < MAP_H - 8;
  interface Place { n: number; name: string; cat: string; x: number; y: number }
  const places: Place[] = [];

  // Open-space fields, so a park's number sits in the middle of its green
  // rather than on the point the topo layer happens to carry.
  interface Field { ring: Pt[]; area: number; cx: number; cy: number }
  const fields: Field[] = [];
  const addField = (ringLL: number[][]) => {
    const ring = ringLL.map(([lon, lat]) => proj(lon, lat));
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f;
    }
    if (Math.abs(a) < 1) return;
    fields.push({ ring, area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) });
  };
  for (const f of bundle.zoning.features) {
    if (zoneToCategory(f.properties.SYM_CODE) !== 'openSpace') continue;
    for (const r of geomRings(f.geometry)) addField(r);
  }
  const recenter = (x: number, y: number): Pt => {
    let best: Field | null = null;
    for (const f of fields) {
      if (f.area > 25_000) continue; // whole-suburb polygons are not fields
      if (!pointInRing(x, y, f.ring as any)) continue;
      if (!best || f.area < best.area) best = f;
    }
    if (best && pointInRing(best.cx, best.cy, best.ring as any)) return [best.cx, best.cy];
    return [x, y];
  };

  {
    const candidates: { name: string; cat: string; x: number; y: number; rank: number }[] = [];
    for (const inst of bundle.institutionPolys) {
      let best = inst.rings[0], bestA = 0;
      for (const r of inst.rings) {
        let a = 0;
        for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
        if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
      }
      const [clon, clat] = ringCentroid(best);
      const [x, y] = proj(clon, clat);
      candidates.push({ name: inst.name, cat: inst.cat, x, y, rank: 0 });
    }
    for (const p of bundle.complexPoints) {
      if (!p.cat) continue;
      const [x, y] = proj(p.lon, p.lat);
      candidates.push({ name: p.name, cat: p.cat, x, y, rank: 0 });
    }
    // Named areas first (centred), loose park points as the fallback.
    for (const p of bundle.parkAreas) {
      if (p.areaM2 < 2000) continue;
      const [x, y] = recenter(...proj(p.lon, p.lat));
      candidates.push({ name: p.name, cat: 'openSpace', x, y, rank: 1 });
    }
    for (const p of bundle.parkPoints) {
      const [x, y] = recenter(...proj(p.lon, p.lat));
      candidates.push({ name: p.name, cat: 'openSpace', x, y, rank: 1 });
    }
    // Institutions in legend order, then the open spaces; within a name the
    // better position was listed first and the sort is stable.
    const order = categories().map((c) => c.id);
    candidates.sort((a, b) => a.rank - b.rank || order.indexOf(a.cat) - order.indexOf(b.cat) || a.name.localeCompare(b.name));
    const seen = new Set<string>();
    for (const c of candidates) {
      const key = c.name.toUpperCase();
      if (seen.has(key) || !inBounds(c.x, c.y)) continue;
      seen.add(key);
      places.push({ n: places.length + 1, name: c.name, cat: c.cat, x: c.x, y: c.y });
    }
  }
  const NR = MARK_R;
  // The key's markers stay at the legend's own size, so its rows still fit.
  const KR = 2.9;
  const hasTrainStations = bundle.stations.some((s) => !/LIGHT RAIL|TRAM/i.test(s.name));
  const hasTramStops = bundle.bus.tramStops.length > 0 || bundle.stations.some((s) => /LIGHT RAIL|TRAM/i.test(s.name));
  // The key has only the column the legend leaves it. A wide window
  // (1:5000) keys forty places, so past twenty-four entries the rows
  // tighten; and when even that would overrun the column, the places
  // nearest the site are kept and the rest go, from the map as well as the
  // key — a sheet about a site names what is around it, and the far corner
  // of a wide window can go without its bowling club.
  const keyMetrics = (count: number) => {
    const many = count > 24;
    return { size: many ? T.legend * 0.9 : T.legend, lineH: many ? 2.9 : 3.2, wrap: many ? 38 : 34, pitch: many ? 5.4 : 6.6, pad: many ? 2.6 : 3.6 };
  };
  const keyRowHeight = (name: string, m: ReturnType<typeof keyMetrics>) =>
    Math.max(m.pitch, m.lineH * wrapLabel(name, m.wrap).length + m.pad);
  const keyM = keyMetrics(places.length + stationsOnMap.length);
  {
    // The legend's own rows, counted the way the legend will draw them.
    const legendRows = categories().filter((c) => usedCats.has(c.id) && c.id !== 'railway').length
      + (hasTrainStations ? 1 : 0) + 1 + (hasTramStops ? 1 : 0)
      + (bundle.railLines.train.length ? 1 : 0)
      + (bundle.railLines.tram.length || bundle.bus.tramRouteSegments.length ? 1 : 0)
      + 1 + 2;
    const budget = legendHeightFor(meta) - (7 + legendRows * 10) - 6.5 - 4;
    let used = stationsOnMap.reduce((h, st) => h + keyRowHeight(st.name, keyM), 0);
    const dist = (pl: Place) => Math.hypot(pl.x - MAP_W / 2, pl.y - MAP_H / 2);
    const keep = new Set<Place>();
    for (const pl of [...places].sort((a, b) => dist(a) - dist(b))) {
      const h = keyRowHeight(pl.name, keyM);
      if (used + h > budget) break;
      used += h;
      keep.add(pl);
    }
    if (keep.size < places.length) {
      const kept = places.filter((pl) => keep.has(pl));
      places.length = 0;
      kept.forEach((pl, i) => places.push({ ...pl, n: i + 1 }));
    }
  }
  // Two places on one block (a centre and its clinic) put their discs on top
  // of each other; nudge such pairs apart along the line between them until
  // the discs just clear, a few passes for a cluster.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
      const a = places[i], b = places[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const gap = 2 * NR + 0.6 - d;
      if (gap <= 0) continue;
      const ux = (dx / d) * (gap / 2), uy = (dy / d) * (gap / 2);
      a.x -= ux; a.y -= uy; b.x += ux; b.y += uy;
    }
  }
  // Numbers run to two digits, so they are set a little smaller than the
  // roundels' single letter in the same disc.
  const numberSize = T.legend * 1.3;
  const mapNumberSize = numberSize * (MARK_R / KR) * 0.92;
  // A solid disc with the number knocked out of it: one small dark mark a
  // reader can find, rather than a ring that competes with the roundels.
  const numberMarker = (x: number, y: number, n: number, r = NR, size = mapNumberSize) =>
    `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <circle r="${r}" fill="${tpl().streetInk}"/>
      <text text-anchor="middle" dy="${(size * 0.36).toFixed(2)}" font-size="${size.toFixed(2)}" font-weight="700" fill="#ffffff">${n}</text></g>`;
  for (const pl of places) reserve([pl.x, pl.y], [pl.x, pl.y], NR + 1);
  layers.push(places.map((pl) => numberMarker(pl.x, pl.y, pl.n)).join('\n'));

  // ---- catchment labels: the walking time written along its ring ----------
  // Placed before the street names, which slide along their roads and so are
  // the ones to give way. Each ring carries its time twice, half a ring
  // apart, on a straight stretch inside the map and clear of other labels;
  // the text sits just outside the line, reading left to right.
  if (dottedIso) {
    const isoSize = T.street * 0.9;
    const isoDefs: string[] = [];
    const isoTexts: string[] = [];
    let iid = 0;
    for (const iso of bundle.isochrones) {
      const color = iso.minutes === 5 ? tpl().walk5 : tpl().walk10;
      const label = `${iso.minutes} MIN`;
      const textLen = label.length * (isoSize * 0.6 + 0.3) + 2;
      const slotLen = textLen + 4;
      const ring = [...iso.rings].sort((a, b) => b.length - a.length)[0];
      if (!ring) continue;
      const pts: Pt[] = ring.map(([lon, lat]) => proj(lon, lat));
      const cum = arcTable(pts);
      const total = cum[cum.length - 1];
      if (!(total > slotLen * 2)) continue;
      // Start the 5- and 10-minute searches at different points of their
      // rings, so the two labels do not end up side by side.
      const phase = iso.minutes === 5 ? 0.12 : 0.37;
      let placed = 0;
      for (const target of [phase, phase + 0.5]) {
        const want = ((target % 1) + 1) % 1 * total;
        let slot: Pt[] | null = null;
        for (let k = 0; k <= 40 && !slot; k++) {
          const c = want + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * slotLen * 0.5;
          const c0 = c - slotLen / 2, c1 = c + slotLen / 2;
          if (c0 < 0 || c1 > total) continue;
          const win = sliceAt(pts, cum, c0, c1);
          const m = isoSize + 3;
          if (win.some(([x, y]) => x < m || x > MAP_W - m || y < m || y > MAP_H - m)) continue;
          if (!straightEnough(win, 1.6)) continue;
          const a = win[0], b = win[win.length - 1];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < textLen) continue;
          if (!isFree(a, b, isoSize * 0.9)) continue;
          slot = win;
        }
        if (!slot) continue;
        let a = slot[0], b = slot[slot.length - 1];
        reserve(a, b, isoSize * 0.9);
        if (a[0] > b[0]) [a, b] = [b, a];
        const id = `iso${iid++}`;
        isoDefs.push(`<path id="${id}" d="M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}" fill="none"/>`);
        isoTexts.push(`<text font-family="${tpl().streetFont}" font-size="${isoSize.toFixed(2)}" font-weight="700" letter-spacing="0.3" dy="${(-1.3).toFixed(2)}" fill="${color}">
          <textPath href="#${id}" startOffset="50%" text-anchor="middle">${label}</textPath></text>`);
        placed++;
      }
    }
    layers.push(`<defs>${isoDefs.join('')}</defs>`);
    layers.push(isoTexts.join('\n'));
  }

  if (tpl().streetLabels === 'band') {
    // ---- street labels: the office's arrow bands ----------------------------
    // A through street carries its name in a white double-headed arrow band; a
    // lane gets a plain bold label along the line. The original labeller, kept
    // whole for the templates that ask for it.
    const roadByName = new Map<string, { segs: Pt[][]; hierarchy: number; lanes?: number }>();
    for (const road of bundle.roads) {
      const pts = road.coords.map(([lon, lat]) => proj(lon, lat))
        .filter(([x, y]) => x > -60 && x < MAP_W + 60 && y > -60 && y < MAP_H + 60);
      if (pts.length < 2) continue;
      const entry = roadByName.get(road.name) ?? { segs: [], hierarchy: road.hierarchy, lanes: road.lanes };
      entry.segs.push(pts);
      // Most important classification and widest recorded section win: a road
      // is only a lane if every segment of it says so.
      entry.hierarchy = Math.min(entry.hierarchy, road.hierarchy);
      if (road.lanes !== undefined) entry.lanes = Math.max(entry.lanes ?? 0, road.lanes);
      roadByName.set(road.name, entry);
    }
    let rid = 0;
    const roadDefs: string[] = [];
    const roadArrows: string[] = [];
    const roadTexts: string[] = [];
    interface Run { pts: Pt[]; cum: number[]; len: number }
    // Important roads label first, so when two names compete for the same
    // corner the arterial keeps its band and the side street moves along.
    const roadOrder = [...roadByName].sort((a, b) => a[1].hierarchy - b[1].hierarchy);
    for (const [name, r] of roadOrder) {
      const label = shortStreetName(name);
      const major = isMajorStreet(r.hierarchy, r.lanes, name);
      const spacing = 1.5;  // wide tracking on banded names, mm
      const arrowedTextLen = label.length * (T.street * 0.62 + spacing);
      // Must be an over-estimate: a name wider than the path it is set on has
      // its overflowing glyphs clamped onto the ends and they pile up.
      const plainTextLen = label.length * (T.street * 0.72 + 0.4) + 3;
      const slack = 6;   // spare road either side of a plain name
      // The name plus the two arrow heads. The heads are 8mm each but taper, so
      // 7mm of clearance either side keeps the text off the points while
      // letting streets of about 45m still carry a band.
      const bandLen = arrowedTextLen + 14;

      const runs: Run[] = mergeRuns(r.segs)
        .map((pts) => { const cum = arcTable(pts); return { pts, cum, len: cum[cum.length - 1] }; })
        .sort((a, b) => b.len - a.len);
      if (!runs.length) continue;

      // A street is labelled the same way everywhere it appears: the white band
      // means "through street", so a major road must not show up banded on one
      // run and as plain text on another just because that run is short. If no
      // run of a major street is long enough for a band, it still needs a name.
      const banded = major && runs[0].len >= bandLen;
      const slotLen = banded ? bandLen : plainTextLen + slack;

      // Half the height of what this name will occupy — the arrow band is much
      // deeper than the bare text it replaces.
      const halfW = banded ? 6.6 : T.street * 0.62;

      // Repeat the name along a long street rather than labelling it once.
      let placed = 0;
      for (const run of runs) {
        if (placed >= 3 || run.len < slotLen) break;
        const n = Math.min(3 - placed, Math.max(1, Math.floor(run.len / 210)));
        for (let i = 0; i < n; i++) {
          const s = ((i + 0.5) / n) * run.len;
          // Slide the name along its road until it sits inside the map, on
          // straight-enough geometry, and on ground no earlier label has taken.
          // A street name that cannot find clear road is dropped rather than
          // overprinted — searching outward from the ideal spot keeps it as
          // close to its share of the road as the sheet allows.
          let slot: Pt[] | null = null;
          for (let k = 0; k <= 16 && !slot; k++) {
            const d = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.3;
            const c = s + d * slotLen;
            if (c - slotLen / 2 < 0 || c + slotLen / 2 > run.len) continue;
            const win = sliceAt(run.pts, run.cum, c - slotLen / 2, c + slotLen / 2);
            const m = halfW + 2;
            if (win.some(([x, y]) => x < m || x > MAP_W - m || y < m || y > MAP_H - m)) continue;
            if (!straightEnough(win, 2.2)) continue;
            if (banded && !arrowAlong(win, slotLen)) continue;
            // A plain name is set on the slot's chord, not on the road's own
            // vertices: a 2mm dog-leg where two road sections join turns the
            // path tangent through 90 degrees and shuffles the glyphs over each
            // other, and the deviation test above already keeps the chord
            // within 2mm of the real road.
            if (!banded && Math.hypot(win[win.length - 1][0] - win[0][0],
                                      win[win.length - 1][1] - win[0][1]) < plainTextLen) continue;
            if (!isFree(win[0], win[win.length - 1], halfW)) continue;
            slot = win;
          }
          if (!slot) continue;
          reserve(slot[0], slot[slot.length - 1], halfW);
          placed++;

          let pts = banded ? slot : [slot[0], slot[slot.length - 1]];
          if (pts[0][0] > pts[pts.length - 1][0]) pts = [...pts].reverse();
          const id = `rd${rid++}`;
          const d2 = pts.map((p, i2) => `${i2 === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
          roadDefs.push(`<path id="${id}" d="${d2}" fill="none"/>`);
          const arrow = banded ? arrowAlong(pts, slotLen) : null;
          if (arrow) {
            roadArrows.push(arrow.svg);
            // Rotated text centered on the band. textLength+lengthAdjust gives an
            // exact tracked width — Chromium mis-centers letter-spaced text
            // (anchor uses the unspaced width), so avoid letter-spacing here.
            let ta = arrow.angDeg;
            if (ta > 90) ta -= 180;
            if (ta < -90) ta += 180;
            roadTexts.push(`<text transform="translate(${arrow.cx.toFixed(1)},${arrow.cy.toFixed(1)}) rotate(${ta.toFixed(1)})"
              x="${(-arrowedTextLen / 2).toFixed(1)}" y="1.65" textLength="${arrowedTextLen.toFixed(1)}" lengthAdjust="spacing"
              font-size="${T.street}" font-weight="700" fill="${tpl().ink}">${esc(label)}</text>`);
          } else {
            // Lane, path, or a street too short to band: plain bold label along
            // the line, same size as the rest of the map text, no halo.
            roadTexts.push(`<text font-size="${T.street}" font-weight="700" letter-spacing="0.4" dy="-1.4" fill="${tpl().ink}">
              <textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
          }
        }
      }
    }
    layers.push(`<defs>${roadDefs.join('')}</defs>`);
    layers.push(roadArrows.join('\n'));
    layers.push(roadTexts.join('\n'));
  } else {
    // ---- street labels: repeat along long roads like the original ----------
    // Names sit plainly on the white street, no arrow band: the band was the
    // office's old device and it crowded the sheet. Through streets and lanes
    // are set the same way; the width of the white strip already says which
    // is which.
    const roadByName = new Map<string, { segs: Pt[][]; hierarchy: number }>();
    for (const road of bundle.roads) {
      const pts = road.coords.map(([lon, lat]) => proj(lon, lat))
        .filter(([x, y]) => x > -60 && x < MAP_W + 60 && y > -60 && y < MAP_H + 60);
      if (pts.length < 2) continue;
      const entry = roadByName.get(road.name) ?? { segs: [], hierarchy: road.hierarchy };
      entry.segs.push(pts);
      // Most important classification wins.
      entry.hierarchy = Math.min(entry.hierarchy, road.hierarchy);
      roadByName.set(road.name, entry);
    }
    let rid = 0;
    const roadDefs: string[] = [];
    const roadTexts: string[] = [];
    interface Run { pts: Pt[]; cum: number[]; len: number }
    // Important roads label first, so when two names compete for the same
    // corner the arterial keeps its place and the side street moves along.
    const roadOrder = [...roadByName].sort((a, b) => a[1].hierarchy - b[1].hierarchy);
    // The name is centred on the street's own line: a cap height of about
    // 0.72 em lifted by half of that puts the letters' middle on the path.
    const streetDy = (T.street * 0.36).toFixed(2);
    const narrowStreets = /narrow|condensed/i.test(tpl().streetFont);
    for (const [name, r] of roadOrder) {
      const label = shortStreetName(name);
      // Must be an over-estimate: a name wider than the path it is set on has
      // its overflowing glyphs clamped onto the ends and they pile up. The
      // narrow face runs about four fifths the width of the grotesk.
      const textLen = label.length * (T.street * (narrowStreets ? 0.58 : 0.72) + 0.4) + 3;
      const slack = 6;   // spare road either side of the name
      const slotLen = textLen + slack;

      const runs: Run[] = mergeRuns(r.segs)
        .map((pts) => { const cum = arcTable(pts); return { pts, cum, len: cum[cum.length - 1] }; })
        .sort((a, b) => b.len - a.len);
      if (!runs.length) continue;

      // Half the height of what this name will occupy.
      const halfW = T.street * 0.62;

      // Repeat the name along a long street rather than labelling it once.
      let placed = 0;
      for (const run of runs) {
        if (placed >= 3 || run.len < slotLen) break;
        const n = Math.min(3 - placed, Math.max(1, Math.floor(run.len / 210)));
        for (let i = 0; i < n; i++) {
          const s = ((i + 0.5) / n) * run.len;
          // Slide the name along its road until it sits inside the map, on
          // straight-enough geometry, and on ground no earlier label has taken.
          // A street name that cannot find clear road is dropped rather than
          // overprinted — searching outward from the ideal spot keeps it as
          // close to its share of the road as the sheet allows.
          let slot: Pt[] | null = null;
          for (let k = 0; k <= 16 && !slot; k++) {
            const d = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.3;
            const c = s + d * slotLen;
            if (c - slotLen / 2 < 0 || c + slotLen / 2 > run.len) continue;
            const win = sliceAt(run.pts, run.cum, c - slotLen / 2, c + slotLen / 2);
            const m = halfW + 2;
            if (win.some(([x, y]) => x < m || x > MAP_W - m || y < m || y > MAP_H - m)) continue;
            if (!straightEnough(win, 2.2)) continue;
            // The name is set on the slot's chord, not on the road's own
            // vertices: a 2mm dog-leg where two road sections join turns the
            // path tangent through 90 degrees and shuffles the glyphs over each
            // other, and the deviation test above already keeps the chord
            // within 2mm of the real road.
            if (Math.hypot(win[win.length - 1][0] - win[0][0],
                           win[win.length - 1][1] - win[0][1]) < textLen) continue;
            if (!isFree(win[0], win[win.length - 1], halfW)) continue;
            slot = win;
          }
          if (!slot) continue;
          reserve(slot[0], slot[slot.length - 1], halfW);
          placed++;

          let pts = [slot[0], slot[slot.length - 1]];
          if (pts[0][0] > pts[1][0]) pts = [...pts].reverse();
          const id = `rd${rid++}`;
          const d2 = pts.map((p, i2) => `${i2 === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
          roadDefs.push(`<path id="${id}" d="${d2}" fill="none"/>`);
          roadTexts.push(`<text font-family="${tpl().streetFont}" font-size="${T.street}" font-weight="700" letter-spacing="0.4" dy="${streetDy}" fill="${tpl().streetInk}">
            <textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
        }
      }
    }
    layers.push(`<defs>${roadDefs.join('')}</defs>`);
    layers.push(roadTexts.join('\n'));
  }

  // ---- legend (title column, measured geometry) ---------------------------
  const hobByCat = computeHobByCat(bundle);
  let legendSvg = '';
  let ly = 7; // below "CONTEXT ANALYSIS" heading (relative to legend svg top)
  const legendRow = (swatch: string, labelLines: string[], sub?: string) => {
    let row = `<g transform="translate(0,${ly})">${swatch}`;
    labelLines.forEach((l, i) => {
      row += `<text x="${LABEL_X}" y="${3.5 + i * 3.2}" font-size="${T.legend}" fill="#222">${esc(l)}</text>`;
    });
    if (sub) row += `<text x="${LABEL_X}" y="${3.5 + labelLines.length * 3.2}" font-size="${T.legend * 0.85}" fill="#555">${esc(sub)}</text>`;
    legendSvg += row + '</g>';
    ly += 10;
  };
  const swatchBox = { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 };
  const swatchD = `M${SWATCH_X},0h${SWATCH_W}v6.5h${-SWATCH_W}Z`;
  const box = (c: { fill: string; opacity: number; stroke?: string; texture?: Texture; textureColor?: string; figure?: string }) =>
    `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${c.fill}" fill-opacity="${Math.min(1, c.opacity + 0.15)}"
      stroke="${c.stroke ?? '#999'}" stroke-width="${c.stroke ? 0.9 : 0.2}"/>` +
    (c.texture ? textureSvg(`ltx${tex++}`, swatchD, c.texture, c.textureColor ?? c.stroke ?? c.fill, swatchBox) : '') +
    // With coloured buildings the swatch shows a few of them on their ground.
    (tpl().footprints === 'colour' && c.figure && c.figure !== c.fill
      ? `<g fill="${c.figure}">${[[1.4, 1.3, 4.2, 2.4], [1.4, 4.4, 4.2, 1.0], [6.8, 1.3, 3.0, 3.9], [11.2, 1.3, 4.8, 2.1], [11.2, 4.1, 2.6, 1.3], [17.4, 1.3, 4.2, 3.9]]
        .map(([x, y, w, h]) => `<rect x="${(SWATCH_X + x).toFixed(1)}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>`
      : '');
  for (const c of categories()) {
    if (!usedCats.has(c.id)) continue;
    if (c.id === 'railway') continue; // on the map, not in the legend
    const hob = hobByCat[c.id];
    if (c.id === 'site') {
      legendRow(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${tpl().site}" fill-opacity="0.55" stroke="${tpl().site}" stroke-width="0.9" stroke-dasharray="2.2,1.1"/>`, ['SITE']);
    } else if (c.id === 'heritage') {
      let hlines = '';
      for (let o = SWATCH_X - 6.5; o <= SWATCH_X + SWATCH_W; o += 2)
        hlines += `<line x1="${o.toFixed(1)}" y1="6.5" x2="${(o + 6.5).toFixed(1)}" y2="0"/>`;
      legendRow(`<g clip-path="url(#lhclip)" stroke="${tpl().heritage}" stroke-width="0.28">${hlines}</g>
        <rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${tpl().heritage}" stroke-width="0.4"/>`, wrapLabel(c.label, 26));
    } else {
      legendRow(box(c), wrapLabel(c.label, 26), hob ? `HOB: ${hob}` : undefined);
    }
  }
  // transport / analysis symbols
  const symC = SWATCH_X + SWATCH_W / 2;
  const legendRoundel = (letter: string, color: string) =>
    `<g transform="translate(${symC},3.2)">${roundelAt(3.4, letter, color, 5.7)}</g>`;
  if (hasTrainStations) legendRow(legendRoundel('T', tpl().site), ['TRAIN STATION']);
  legendRow(legendRoundel('B', tpl().transit), ['BUS STOPS']);
  if (hasTramStops) legendRow(legendRoundel('L', tpl().busRoute), ['LIGHT RAIL STOP']);
  if (bundle.railLines.train.length)
    legendRow(tpl().railLine === 'dotted'
      ? `<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${tpl().rail}" ${RAIL_DOTS}/>`
      : `<g><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${tpl().rail}" stroke-width="1.1"/><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#fff" stroke-width="0.55" stroke-dasharray="2.4,2.4"/></g>`, ['TRAIN LINE']);
  if (bundle.railLines.tram.length || bundle.bus.tramRouteSegments.length)
    legendRow(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${tpl().busRoute}" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`, ['TRAM ROUTE']);
  legendRow(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${tpl().transit}" ${busLineStyle} stroke-linecap="round"/>`, ['BUS ROUTE']);
  const legendIso = (color: string) => dottedIso
    ? `<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${color}" ${ISO_DOTS} opacity="0.85"/>`
    : walkerIso
    ? `<g><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${color}" stroke-width="1.1" stroke-dasharray="3.6,2.2"/>
       <g transform="translate(${symC},3.2)"><circle r="3.3" fill="#fff" stroke="${color}" stroke-width="0.9"/>${walkerGlyph(color, 0.24)}</g></g>`
    : lineIso
    ? `<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${color}" stroke-width="1.2"/>`
    : `<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${color}" stroke-width="${ISO_W}" opacity="${ISO_OPACITY}" stroke-linecap="round"/>`;
  legendRow(legendIso(tpl().walk5), ['ISOCHRONE -'], '400m/5 min walk');
  legendRow(legendIso(tpl().walk10), ['ISOCHRONE -'], '800m/10 min walk');

  // ---- the key: every numbered place, then the stations ------------------
  if (places.length || stationsOnMap.length) {
    ly += 2;
    legendSvg += `<text x="${SWATCH_X}" y="${ly}" font-size="${T.legend}" font-weight="700" fill="#222">KEY</text>`;
    ly += 4.5;
    // Rows at the metrics the budget above was measured with.
    const keyRow = (marker: string, name: string) => {
      const lines = wrapLabel(name, keyM.wrap);
      const y0 = lines.length === 1 ? KR + 1.0 : KR - 0.4;
      let row = `<g transform="translate(0,${ly.toFixed(1)})">${marker}`;
      lines.forEach((l, k) => { row += `<text x="${LABEL_X}" y="${(y0 + k * keyM.lineH).toFixed(1)}" font-size="${keyM.size.toFixed(2)}" fill="#222">${esc(l)}</text>`; });
      legendSvg += row + '</g>';
      ly += keyRowHeight(name, keyM);
    };
    for (const pl of places) keyRow(numberMarker(symC, KR, pl.n, KR, numberSize), pl.name);
    for (const st of stationsOnMap) {
      const color = st.tram ? tpl().busRoute : tpl().site;
      keyRow(`<g transform="translate(${symC},${KR})">${roundelAt(KR, st.tram ? 'L' : 'T', color, numberSize)}</g>`, st.name);
    }
  }

  return sheetHtml({
    meta,
    address: bundle.address,
    generatedAt: bundle.generatedAt,
    siteAddress: bundle.geocode.matchedAddresses[0] ?? bundle.address,
    scale: bundle.scale,
    rotationDeg: view.rotationDeg,
    drawingTitle: 'CONTEXT ANALYSIS',
    legendHeading: 'CONTEXT ANALYSIS',
    legendSvg,
    layers,
  });
}

function computeHobByCat(bundle: Bundle): Record<string, string> {
  const hobPolys = bundle.hob.features
    .map((f) => ({ rings: geomRings(f.geometry), h: f.properties.MAX_B_H }))
    .filter((p) => p.rings.length && p.h != null);
  const votes: Record<string, Record<string, number>> = {};
  for (const f of bundle.zoning.features) {
    const cat = zoneToCategory(f.properties.SYM_CODE);
    if (!cat || !/^(r2|r3|r4|localCentre|commercial|mixedUse)$/.test(cat)) continue;
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    const [cx, cy] = ringCentroid(rings[0]);
    for (const hp of hobPolys) {
      if (hp.rings.some((r) => pointInRing(cx, cy, r))) {
        const key = `${hp.h}`;
        (votes[cat] ??= {})[key] = (votes[cat][key] ?? 0) + 1;
        break;
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [cat, v] of Object.entries(votes)) {
    const sorted = Object.entries(v).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    out[cat] = sorted.slice(0, 2).join(' / ') + 'm';
  }
  return out;
}

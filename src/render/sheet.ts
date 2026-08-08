// Composes the A1 CONTEXT ANALYSIS sheet as an HTML page (SVG map + title
// block column). Geometry and typography are measured from the office's
// reference sheet (2539 Campsie) with PyMuPDF — see docs/SHEET_SPEC.md.

import type { Bundle } from '../pipeline.js';
import { lonLatToMercator, ringCentroid, type Extent } from '../lib/geo.js';
import { CATEGORIES, catById, zoneToCategory } from './model.js';

export const SHEET_W = 841;
export const SHEET_H = 594;

// Frame measured from the original: 28mm binding margin left, 10mm top,
// title column x 738.9→831 (10mm right margin), map bottom rule at 576.6.
export const FRAME_L = 28;
export const FRAME_T = 10;
export const TITLE_X = 738.9;
export const TITLE_R = 831;
export const MAP_BOTTOM = 576.6;
export const MAP_W = TITLE_X - FRAME_L;   // 710.9
export const MAP_H = MAP_BOTTOM - FRAME_T; // 566.6

// Type scale measured from the original (mm)
const T = {
  fine: 2.1,       // notes, field labels, office block
  legend: 2.7,     // legend labels, revision table
  scalebar: 2.3,
  addr: 3.4,       // site address value
  value: 4.1,      // job no / date / scale / status / title / sheet values
  street: 4.9,     // street names on map
  poi: 4.9,        // POI names on map (bold)
  mapSymbol: 6.2,  // B/T glyph on map
};

export interface SheetMeta {
  jobNo: string;
  client: string;
  clientLines?: string[];
  status: string;
  sheetNo: string;
  revision: string;
  checked: string;
  drawn: string;
  preliminary: boolean;
  office: { name: string; lines: string[] };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Pt = [number, number];

function makeProjector(extent: Extent) {
  const sx = MAP_W / (extent.xmax - extent.xmin);
  const sy = MAP_H / (extent.ymax - extent.ymin);
  return (lon: number, lat: number): Pt => {
    const m = lonLatToMercator({ lon, lat });
    return [(m.x - extent.xmin) * sx, (extent.ymax - m.y) * sy];
  };
}

function pathFromRings(rings: number[][][], proj: (lon: number, lat: number) => Pt, close = true): string {
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

function geomRings(geometry: any): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function wrapLabel(name: string, maxChars = 14): string[] {
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
function haloText(x: number, y: number, lines: string[], size: number, fill: string, weight = 700): string {
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
function plainText(x: number, y: number, lines: string[], size: number, fill = '#000000'): string {
  const lh = size * 1.08;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`)
    .join('');
  return `<text text-anchor="middle" font-size="${size}" font-weight="700" font-family="'PT Sans Narrow', Arial, sans-serif" fill="${fill}">${tspans}</text>`;
}

/**
 * White double-headed arrow along the (straight-enough) middle of a polyline.
 * Returns '' when the geometry bends too much for a straight arrow.
 */
interface BandArrow { svg: string; cx: number; cy: number; angDeg: number }

function arrowAlong(pts: Pt[], lengthMm: number): BandArrow | null {
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
function walkerGlyph(color: string, scale: number): string {
  return `<g transform="scale(${scale}) translate(-12.6,-13.5)"><path fill="${color}" d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></g>`;
}

/** Walker-in-circle marker sitting on an isochrone ring, all in ring color. */
function walkerMedallion(x: number, y: number, color: string): string {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <circle r="4.1" fill="#ffffff" stroke="${color}" stroke-width="1.1"/>
    ${walkerGlyph(color, 0.30)}
  </g>`;
}

/** Abbreviate street types the way the office labels them (CAMPSIE ST, WILFRED AVE). */
function shortStreetName(name: string): string {
  return name.toUpperCase()
    .replace(/\bSTREET\b/, 'ST').replace(/\bROAD\b/, 'RD').replace(/\bAVENUE\b/, 'AVE')
    .replace(/\bPARADE\b/, 'PDE').replace(/\bHIGHWAY\b/, 'HWY').replace(/\bDRIVE\b/, 'DR')
    .replace(/\bLANE\b/, 'LN').replace(/\bPLACE\b/, 'PL').replace(/\bCRESCENT\b/, 'CRES')
    .replace(/\bBOULEVARD\b/, 'BVD').replace(/\bTERRACE\b/, 'TCE').replace(/\bCOURT\b/, 'CT');
}

export function renderSheet(bundle: Bundle, meta: SheetMeta): string {
  const proj = makeProjector(bundle.extent);
  const usedCats = new Set<string>();
  const layers: string[] = [];

  // ---- aerial base (no CSS filter: keeps JPEGs as JPEGs in the PDF) ------
  layers.push(bundle.aerial.tiles
    .map((t) => `<image href="data/${t.file}" x="${(t.left * MAP_W).toFixed(2)}" y="${(t.top * MAP_H).toFixed(2)}"
        width="${(t.width * MAP_W).toFixed(2)}" height="${(t.height * MAP_H).toFixed(2)}" preserveAspectRatio="none"/>`)
    .join('\n'));
  layers.push(`<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="#ffffff" opacity="0.36"/>`);

  // ---- zoning base -------------------------------------------------------
  const zoningByCat: Record<string, string[]> = {};
  for (const f of bundle.zoning.features) {
    const cat = zoneToCategory(f.properties.SYM_CODE);
    if (!cat) continue;
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    (zoningByCat[cat] ??= []).push(pathFromRings(rings, proj));
  }
  for (const [cat, paths] of Object.entries(zoningByCat)) {
    const c = catById[cat];
    usedCats.add(cat);
    layers.push(`<g fill="${c.fill}" opacity="${c.opacity}" fill-rule="evenodd">` +
      paths.map((d) => `<path d="${d}"/>`).join('') + '</g>');
  }

  // ---- railway corridor --------------------------------------------------
  if (bundle.railCorridors.features.length) {
    usedCats.add('railway');
    const d = bundle.railCorridors.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="#f0912d" opacity="0.9" fill-rule="evenodd"/>`);
  }

  // ---- institution property fills (function beats zone) ------------------
  const poiPathsByCat: Record<string, string[]> = {};
  for (const inst of bundle.institutionPolys) {
    const rings = inst.rings.filter((r) => r.length >= 3);
    if (!rings.length) continue;
    (poiPathsByCat[inst.cat] ??= []).push(pathFromRings(rings, proj));
  }
  for (const [cat, paths] of Object.entries(poiPathsByCat)) {
    const c = catById[cat];
    usedCats.add(cat);
    layers.push(`<g fill="${c.fill}" opacity="${c.opacity}" fill-rule="evenodd">` +
      paths.map((d) => `<path d="${d}"/>`).join('') + '</g>');
  }

  // ---- thin cadastral lot-boundary overlay --------------------------------
  if (bundle.allLots.features.length) {
    const d = bundle.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#6f6f6f" stroke-width="0.12" opacity="0.5"/>`);
  }

  // ---- heritage ----------------------------------------------------------
  if (bundle.heritage.features.length) {
    usedCats.add('heritage');
    const d = bundle.heritage.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="url(#hatch)" stroke="#a97b3f" stroke-width="0.25" opacity="0.8"/>`);
  }

  // ---- transit route lines (train / tram / bus) --------------------------
  if (bundle.railLines.train.length) {
    const d = bundle.railLines.train.map((l) => pathFromRings([l as any], proj, false)).join('');
    // classic railway line: dark stroke with white sleeper dashes on top
    layers.push(`<path d="${d}" fill="none" stroke="#3b3b3b" stroke-width="1.1"/>`);
    layers.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.55" stroke-dasharray="2.4,2.4"/>`);
  }
  if (bundle.railLines.tram.length) {
    const d = bundle.railLines.tram.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#d5006d" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`);
  }
  if (bundle.bus.tramRouteSegments.length && !bundle.railLines.tram.length) {
    const d = bundle.bus.tramRouteSegments.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#d5006d" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`);
  }
  // Bus routes from OSM when available; otherwise derive corridors from the
  // road network — any street with a bus stop within 30m carries a route.
  let busSegments = bundle.bus.busRouteSegments as [number, number][][];
  if (!busSegments.length && bundle.bus.busStops.length) {
    const stopsM = bundle.bus.busStops.map((s) => lonLatToMercator({ lon: s.lon, lat: s.lat }));
    const near = (road: { coords: [number, number][] }): boolean => {
      const pts = road.coords.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
      for (const st of stopsM) {
        for (let i = 1; i < pts.length; i++) {
          const ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy;
          const t = L2 ? Math.max(0, Math.min(1, ((st.x - ax) * dx + (st.y - ay) * dy) / L2)) : 0;
          if (Math.hypot(st.x - (ax + t * dx), st.y - (ay + t * dy)) < 30) return true;
        }
      }
      return false;
    };
    busSegments = bundle.roads.filter(near).map((r) => r.coords);
  }
  if (busSegments.length) {
    const d = busSegments.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#2f7fd6" stroke-width="0.9" stroke-dasharray="3,1.9" opacity="0.9" stroke-linecap="round"/>`);
  }

  // ---- isochrones --------------------------------------------------------
  const isoStyle: Record<number, { color: string; label: string }> = {
    5: { color: '#e6007e', label: '400m (5-MIN WALK)' },
    10: { color: '#b5379b', label: '800m (10-MIN WALK)' },
  };
  for (const iso of bundle.isochrones) {
    const st = isoStyle[iso.minutes] ?? { color: '#e6007e', label: `${iso.minutes} MIN WALK` };
    const d = iso.rings.map((r) => pathFromRings([r as any], proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="1.3" stroke-dasharray="3.6,2.2" stroke-linejoin="round"/>`);
  }
  // Walker medallions ON the ring (the office style): white disc, ring in
  // the isochrone color, pedestrian icon. Several per ring, staggered
  // bearings per contour so the two rings' markers don't align radially.
  {
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const bearingSets: Record<number, number[]> = { 5: [50, 170, 290], 10: [110, 230, 350] };
    for (const iso of bundle.isochrones) {
      const st = isoStyle[iso.minutes] ?? { color: '#e6007e', label: `${iso.minutes} MIN WALK` };
      for (const bearing of bearingSets[iso.minutes] ?? [90, 210, 330]) {
        const target = (bearing * Math.PI) / 180;
        let best: Pt | null = null;
        let bestScore = Infinity;
        for (const r of iso.rings) for (const [lon, lat] of r) {
          const [x, y] = proj(lon, lat);
          if (x < 12 || x > MAP_W - 12 || y < 12 || y > MAP_H - 12) continue;
          const ang = Math.atan2(y - cy, x - cx);
          let diff = Math.abs(ang - target);
          diff = Math.min(diff, 2 * Math.PI - diff);
          if (diff < bestScore) { bestScore = diff; best = [x, y]; }
        }
        if (best && bestScore < 0.6) layers.push(walkerMedallion(best[0], best[1], st.color));
      }
    }
  }

  // ---- site --------------------------------------------------------------
  {
    usedCats.add('site');
    const d = bundle.siteLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="#e8402a" fill-opacity="0.55" stroke="#cc0000" stroke-width="1.4" stroke-dasharray="3.2,1.6"/>`);
  }

  // ---- street labels: repeat along long roads like the original ----------
  interface Seg { pts: Pt[]; len: number; mid: Pt }
  const roadByName = new Map<string, { segs: Seg[]; hierarchy: number }>();
  for (const road of bundle.roads) {
    const pts = road.coords.map(([lon, lat]) => proj(lon, lat))
      .filter(([x, y]) => x > -60 && x < MAP_W + 60 && y > -60 && y < MAP_H + 60);
    if (pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const mid = pts[Math.floor(pts.length / 2)];
    const entry = roadByName.get(road.name) ?? { segs: [], hierarchy: road.hierarchy };
    entry.segs.push({ pts, len, mid });
    entry.hierarchy = Math.min(entry.hierarchy, road.hierarchy);
    roadByName.set(road.name, entry);
  }
  let rid = 0;
  const roadDefs: string[] = [];
  const roadArrows: string[] = [];
  const roadTexts: string[] = [];
  for (const [name, r] of roadByName) {
    const label = shortStreetName(name);
    const minLen = label.length * T.street * 0.72 + 8; // must fit the text
    const candidates = r.segs.filter((s) => s.len >= minLen).sort((a, b) => b.len - a.len);
    const chosen: Seg[] = [];
    for (const s of candidates) {
      if (chosen.length >= 3) break;
      if (chosen.some((c) => Math.hypot(c.mid[0] - s.mid[0], c.mid[1] - s.mid[1]) < 170)) continue;
      chosen.push(s);
    }
    for (const s of chosen) {
      let pts = s.pts;
      if (pts[0][0] > pts[pts.length - 1][0]) pts = [...pts].reverse();
      const id = `rd${rid++}`;
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
      roadDefs.push(`<path id="${id}" d="${d}" fill="none"/>`);
      // The white double-headed arrow IS the label background: bold,
      // wide-tracked name centered on the band. Streets whose geometry bends
      // too much for a band keep a plain thin label along the curve.
      const spacing = 1.5; // wide tracking on arrowed names, mm
      const arrowedTextLen = label.length * (T.street * 0.62 + spacing);
      const arrow = s.len * 0.85 >= arrowedTextLen + 12
        ? arrowAlong(pts, Math.min(s.len * 0.85, arrowedTextLen + 20))
        : null;
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
          font-size="${T.street}" font-weight="700" fill="#111111">${esc(label)}</text>`);
      } else {
        // Curved-street label: bold black narrow, no contour (office style).
        roadTexts.push(`<text font-size="${T.street}" font-weight="700" font-family="'PT Sans Narrow', Arial, sans-serif" letter-spacing="0.4" dy="-1.4" fill="#000000">
          <textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
      }
    }
  }
  layers.push(`<defs>${roadDefs.join('')}</defs>`);
  layers.push(roadArrows.join('\n'));
  layers.push(roadTexts.join('\n'));

  // ---- POI labels ---------------------------------------------------------
  // Institutions with a colored parcel are labeled at the parcel centroid so
  // the name sits centered on its color field; open spaces are labeled from
  // the named-area centroids (parks must always carry their name).
  interface PoiLabel { x: number; y: number; lines: string[]; priority: number }
  const poiLabels: PoiLabel[] = [];
  const inBounds = (x: number, y: number) => x > 10 && x < MAP_W - 10 && y > 8 && y < MAP_H - 8;
  const labeledNames = new Set<string>();

  for (const inst of bundle.institutionPolys) {
    let best = inst.rings[0], bestA = 0;
    for (const r of inst.rings) {
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
    }
    const [clon, clat] = ringCentroid(best);
    const [x, y] = proj(clon, clat);
    if (!inBounds(x, y)) continue;
    labeledNames.add(inst.name.toUpperCase());
    poiLabels.push({ x, y, lines: wrapLabel(inst.name), priority: 1 });
  }
  for (const p of bundle.complexPoints) {
    if (!p.cat || labeledNames.has(p.name.toUpperCase())) continue;
    const [x, y] = proj(p.lon, p.lat);
    if (inBounds(x, y)) poiLabels.push({ x, y, lines: wrapLabel(p.name), priority: 2 });
  }
  // Open spaces: named areas (centered) first, loose park points as fallback.
  const parkSeen = new Set<string>();
  for (const p of bundle.parkAreas) {
    if (p.areaM2 < 2000) continue;
    const [x, y] = proj(p.lon, p.lat);
    if (!inBounds(x, y)) continue;
    parkSeen.add(p.name.toUpperCase());
    poiLabels.push({ x, y, lines: wrapLabel(p.name), priority: 1 });
  }
  for (const p of bundle.parkPoints) {
    if (parkSeen.has(p.name.toUpperCase())) continue;
    const [x, y] = proj(p.lon, p.lat);
    if (inBounds(x, y)) poiLabels.push({ x, y, lines: wrapLabel(p.name), priority: 2 });
  }

  poiLabels.sort((a, b) => a.priority - b.priority);
  const placed: Pt[] = [];
  const poiTexts: string[] = [];
  for (const pl of poiLabels) {
    if (placed.some(([px, py]) => Math.hypot(px - pl.x, py - pl.y) < 15)) continue;
    placed.push([pl.x, pl.y]);
    poiTexts.push(plainText(pl.x, pl.y, pl.lines, T.poi));
  }
  layers.push(poiTexts.join('\n'));

  // ---- transport symbols: one roundel style for all modes -----------------
  // (white circle, colored ring and letter — same size for train/bus/tram)
  const RR = 4.0;
  const roundel = (x: number, y: number, letter: string, color: string) =>
    `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <circle r="${RR}" fill="#ffffff" stroke="${color}" stroke-width="0.9"/>
      <text text-anchor="middle" dy="${(T.mapSymbol * 0.36).toFixed(1)}" font-size="${T.mapSymbol}" font-weight="700" fill="${color}">${letter}</text></g>`;

  layers.push(bundle.bus.busStops
    .map(({ lon, lat }) => proj(lon, lat))
    .filter(([x, y]) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3)
    .map(([x, y]) => roundel(x, y, 'B', '#2f7fd6'))
    .join('\n'));

  layers.push(bundle.bus.tramStops
    .map(({ lon, lat }) => proj(lon, lat))
    .filter(([x, y]) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3)
    .map(([x, y]) => roundel(x, y, 'L', '#d5006d'))
    .join('\n'));

  layers.push(bundle.stations
    .map((s) => ({ p: proj(s.lon, s.lat), name: s.name.replace(/RAILWAY STATION$/i, 'TRAIN STATION') }))
    .filter(({ p: [x, y] }) => x > 3 && x < MAP_W - 3 && y > 3 && y < MAP_H - 3)
    .map(({ p: [x, y], name }) =>
      roundel(x, y, 'T', '#e8402a') + plainText(x, y - RR - 6, wrapLabel(name), T.poi, '#111111'))
    .join('\n'));

  // ---- legend (title column, measured geometry) ---------------------------
  const hobByCat = computeHobByCat(bundle);
  const CL = 743.7 - TITLE_X;         // content left within column (4.8)
  const SWATCH_X = CL + 1.5, SWATCH_W = 23, LABEL_X = 773 - TITLE_X;
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
  const box = (fill: string, opacity: number, extra = '') =>
    `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${fill}" fill-opacity="${Math.min(1, opacity + 0.15)}" stroke="#555" stroke-width="0.25" ${extra}/>`;
  for (const c of CATEGORIES) {
    if (!usedCats.has(c.id)) continue;
    const hob = hobByCat[c.id];
    if (c.id === 'site') {
      legendRow(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="#e8402a" fill-opacity="0.55" stroke="#cc0000" stroke-width="0.9" stroke-dasharray="2.2,1.1"/>`, ['SITE']);
    } else if (c.id === 'heritage') {
      legendRow(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="url(#lhatch)" stroke="#a97b3f" stroke-width="0.4"/>`, wrapLabel(c.label, 26));
    } else {
      legendRow(box(c.fill, c.opacity), wrapLabel(c.label, 26), hob ? `HOB: ${hob}` : undefined);
    }
  }
  // transport / analysis symbols
  const symC = SWATCH_X + SWATCH_W / 2;
  const legendRoundel = (letter: string, color: string) =>
    `<g transform="translate(${symC},3.2)"><circle r="3.4" fill="#fff" stroke="${color}" stroke-width="0.8"/><text text-anchor="middle" dy="1.9" font-size="5.7" font-weight="700" fill="${color}">${letter}</text></g>`;
  legendRow(legendRoundel('T', '#e8402a'), ['TRAIN STATION']);
  legendRow(legendRoundel('B', '#2f7fd6'), ['BUS STOPS']);
  if (bundle.bus.tramStops.length) legendRow(legendRoundel('L', '#d5006d'), ['TRAM STATION']);
  if (bundle.railLines.train.length)
    legendRow(`<g><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#3b3b3b" stroke-width="1.1"/><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#fff" stroke-width="0.55" stroke-dasharray="2.4,2.4"/></g>`, ['TRAIN LINE']);
  if (bundle.railLines.tram.length || bundle.bus.tramRouteSegments.length)
    legendRow(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#d5006d" stroke-width="0.9" stroke-dasharray="3.4,1.8"/>`, ['TRAM ROUTE']);
  legendRow(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#2f7fd6" stroke-width="0.9" stroke-dasharray="3,1.9"/>`, ['BUS ROUTE']);
  const legendIso = (color: string) =>
    `<g><line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${color}" stroke-width="1.1" stroke-dasharray="3.6,2.2"/>
     <g transform="translate(${symC},3.2)"><circle r="3.3" fill="#fff" stroke="${color}" stroke-width="0.9"/>${walkerGlyph(color, 0.24)}</g></g>`;
  legendRow(legendIso('#e6007e'), ['ISOCHRONE -'], '400m/5 min walk');
  legendRow(legendIso('#b5379b'), ['ISOCHRONE -'], '800m/10 min walk');

  // ---- scale bar (true length: 100m at sheet scale) -----------------------
  // Stepped architectural scale bar: filled 0-20, hollow 20-50, rule to 100m.
  const mm100 = 100_000 / bundle.scale;
  const sbX = 742.3 - TITLE_X;
  const sbY = 2.2, sbH = 1.5;
  const sx = (m: number) => sbX + (m / 100) * mm100;
  const scaleBarSvg = `
    <line x1="${sx(0).toFixed(1)}" y1="${sbY + sbH}" x2="${sx(100).toFixed(1)}" y2="${sbY + sbH}" stroke="#222" stroke-width="0.3"/>
    <rect x="${sx(0).toFixed(1)}" y="${sbY}" width="${(sx(20) - sx(0)).toFixed(1)}" height="${sbH}" fill="#222"/>
    <rect x="${sx(20).toFixed(1)}" y="${sbY}" width="${(sx(50) - sx(20)).toFixed(1)}" height="${sbH}" fill="none" stroke="#222" stroke-width="0.3"/>
    ${[0, 20, 50, 100].map((m) => `<line x1="${sx(m).toFixed(1)}" y1="${sbY}" x2="${sx(m).toFixed(1)}" y2="${sbY + sbH + 0.7}" stroke="#222" stroke-width="0.3"/>`).join('')}
    ${[0, 20, 50, 100].map((m) => `<text x="${sx(m).toFixed(1)}" y="${sbY + sbH + 3.2}" text-anchor="middle" font-size="${T.scalebar}" font-weight="700" fill="#222">${m}${m === 100 ? 'm' : ''}</text>`).join('')}`;

  // Surveyor-style compass, replicated from the reference sheet's vectors:
  // double circle rim, thin crosshair, two hairline diagonals, slim needle.
  const northSvg = `
    <text x="9" y="2.8" text-anchor="middle" font-size="2.9" font-weight="700" fill="#111">N</text>
    <g transform="translate(9,10.6)" stroke="#111" stroke-width="0.15" fill="none">
      <circle r="4.95"/><circle r="4.6"/>
      <line x1="0" y1="-4.95" x2="0" y2="4.95"/>
      <line x1="-4.95" y1="0" x2="4.95" y2="0"/>
      <line x1="-4.6" y1="-2.1" x2="4.6" y2="2.1"/>
      <line x1="2.1" y1="-4.6" x2="-2.1" y2="4.6"/>
      <path d="M0,-4.95 L0.42,0 L0,0 Z" fill="#111" stroke="none"/>
    </g>`;

  const notes = [
    'NO REPRODUCTION WITHOUT PERMISSION, UNLESS NOTED OTHERWISE.',
    'THIS DRAWING IS NOT FOR CONSTRUCTION.',
    'NO STRUCTURAL OR SERVICE ENGINEERING INPUT OR COORDINATION HAS BEEN PROVIDED IN THE PREPARATION OF THE DRAWINGS. DRAWINGS CANNOT BE RELIED UPON FOR THE BASIS OF MARKETING SALES OR CONSTRUCTION QUOTATION.',
    'ALL DIMENSIONS AND LEVELS ARE TO BE CHECKED ON SITE PRIOR TO THE COMMENCEMENT OF WORK.',
    `INFORM ${meta.office.name.toUpperCase().replace('ARCHITECTS', 'ARCHITECTURE')} OF ANY DISCREPANCIES FOR CLARIFICATION BEFORE PROCEEDING WITH WORK.`,
    'DRAWINGS ARE NOT TO BE SCALED.',
    'USE ONLY FIGURED DIMENSIONS.',
    'REFER TO CONSULTANT DOCUMENTATION FOR FURTHER INFORMATION.',
  ];

  const siteAddress = bundle.geocode.matchedAddresses[0] ?? bundle.address;
  const dateStr = new Date().toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }).toUpperCase();
  const [wm1, ...wmRest] = meta.office.name.split(' ');
  const TW = TITLE_R - TITLE_X; // column content width 92.1

  // Field block helper: label (2.1mm grey) + value, absolutely positioned.
  const field = (top: number, label: string, valueHtml: string) => `
    <div class="abs" style="top:${top}mm;left:4.8mm;right:0">
      <div class="k">${esc(label)}</div>${valueHtml}
    </div>`;
  const rule = (y: number) => `<div class="abs rule" style="top:${y}mm"></div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(siteAddress)} — CONTEXT ANALYSIS</title>
<style>
  @page { size: ${SHEET_W}mm ${SHEET_H}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${SHEET_W}mm; height: ${SHEET_H}mm; font-family: Arial, 'Liberation Sans', Helvetica, sans-serif; background: #fff; }
  .sheet { position: relative; width: ${SHEET_W}mm; height: ${SHEET_H}mm; overflow: hidden; }
  svg.map { position: absolute; left: ${FRAME_L}mm; top: ${FRAME_T}mm; }
  .titlecol { position: absolute; left: ${TITLE_X}mm; top: 0; width: ${TW}mm; height: ${SHEET_H}mm;
    background: #fff; font-size: ${T.fine}mm; color: #222; }
  .abs { position: absolute; }
  .rule { left: 2.6mm; right: 0; border-top: 0.15mm solid #666; }
  .k { font-size: ${T.fine}mm; color: #444; }
  .fine { font-size: ${T.fine}mm; line-height: 1.22; color: #333; }
  .fine li { margin-left: 2.8mm; margin-bottom: 0.35mm; }
  .v-addr { font-size: ${T.addr}mm; font-weight: 400; line-height: 1.15; }
  .v { font-size: ${T.value}mm; font-weight: 400; line-height: 1.16; }
  .wordmark { font-size: 6.2mm; font-weight: 700; letter-spacing: 0.5mm; white-space: nowrap; }
  .wordmark .rule2 { text-decoration: line-through; font-weight: 400; }
  .prelim { border: 0.6mm solid #e30000; color: #e30000; text-align: center; font-weight: 700;
    letter-spacing: 1.6mm; font-size: 4.2mm; padding: 1.4mm 0; }
  .revtable { width: 100%; border-collapse: collapse; font-size: ${T.legend}mm; }
  .revtable th { text-align: left; font-weight: 700; padding: 0.4mm 0; }
  .revtable td { padding: 0.4mm 0; }
</style></head>
<body><div class="sheet">
<svg class="map" width="${MAP_W}mm" height="${MAP_H}mm" viewBox="0 0 ${MAP_W} ${MAP_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="mapclip"><rect x="0" y="0" width="${MAP_W}" height="${MAP_H}"/></clipPath>
    <pattern id="hatch" width="1.6" height="1.6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="1.6" stroke="#a97b3f" stroke-width="0.45"/>
    </pattern>
  </defs>
  <g clip-path="url(#mapclip)">
${layers.join('\n')}
  </g>
</svg>
<div class="titlecol">
  <div class="abs fine" style="top:10mm;left:4.8mm;right:0">
    ${esc(bundle.address)}<br>Generated: ${esc(bundle.generatedAt.slice(0, 10))}<br>© ${esc(meta.office.name)}
  </div>
  <div class="abs" style="top:19mm;left:4.8mm;right:0">
    <div class="fine" style="font-weight:700">NOTE:</div>
    <ul class="fine">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
  </div>
  ${rule(58)}
  <div class="abs" style="top:59.4mm;left:4.8mm;right:0;font-size:${T.legend}mm;font-weight:700">CONTEXT ANALYSIS</div>
  <svg class="abs" style="top:62mm;left:0" width="${TW}mm" height="300mm" viewBox="0 0 ${TW} 300" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="lhatch" width="1.6" height="1.6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="1.6" stroke="#a97b3f" stroke-width="0.45"/></pattern></defs>
    ${legendSvg}
  </svg>
  ${rule(363.8)}
  <div class="abs" style="top:364.6mm;left:2.6mm;right:0">
    <table class="revtable">
      <tr><th style="width:20%">REVISION ID</th><th style="width:55%">AMENDMENT</th><th>DATE</th></tr>
      <tr><td>${esc(meta.revision)}</td><td>${esc(meta.status.toUpperCase().includes('PRELIM') ? 'ISSUE FOR COORDINATION' : 'FOR SUBMISSION')}</td><td>${esc(new Date().toLocaleDateString('en-AU'))}</td></tr>
    </table>
  </div>
  ${rule(395.5)}
  ${rule(400.7)}
  <div class="abs k" style="top:401.4mm;left:4.8mm">ARCHITECT</div>
  <div class="abs wordmark" style="top:406.5mm;left:4.8mm">${esc(wm1)}<span class="rule2">—</span>${esc(wmRest.join(' '))}</div>
  <div class="abs fine" style="top:419.9mm;left:4.8mm;right:0">${meta.office.lines.map(esc).join('<br>')}</div>
  ${rule(438.4)}
  <div class="abs k" style="top:439.1mm;left:4.8mm">CLIENT</div>
  <div class="abs" style="top:443mm;left:4.8mm;right:0;font-size:${T.value}mm;font-weight:700">${esc(meta.client)}</div>
  <div class="abs fine" style="top:455.4mm;left:4.8mm;right:0">${(meta.clientLines ?? []).map(esc).join('<br>')}</div>
  ${meta.preliminary ? `<div class="abs prelim" style="top:463mm;left:2.6mm;right:2.6mm">P R E L I M I N A R Y</div>` : ''}
  <svg class="abs" style="top:470mm;left:3.5mm" width="18mm" height="18mm" viewBox="0 0 18 18">${northSvg}</svg>
  <svg class="abs" style="top:487mm;left:0" width="${TW}mm" height="8mm" viewBox="0 0 ${TW} 8">${scaleBarSvg}</svg>
  ${rule(495.8)}
  ${field(496.6, 'SITE ADDRESS', `<div class="v-addr">${esc(siteAddress)}</div>`)}
  ${rule(511.4)}
  ${field(512.2, 'JOB NO', `<div class="v">${esc(meta.jobNo)}</div>`)}
  ${rule(522.5)}
  <div class="abs" style="top:523.3mm;left:4.8mm;right:0">
    <div style="display:grid;grid-template-columns:1fr 1fr">
      <div><div class="k">CHECKED</div><div class="v">${esc(meta.checked)}</div></div>
      <div><div class="k">DRAWN</div><div class="v">${esc(meta.drawn)}</div></div>
      <div style="margin-top:1.6mm"><div class="k">DATE</div><div class="v">${esc(dateStr)}</div></div>
      <div style="margin-top:1.6mm"><div class="k">SCALE</div><div class="v">1:${bundle.scale} @ A1&nbsp;&nbsp;A3@50%</div></div>
    </div>
  </div>
  ${rule(543.2)}
  ${field(544, 'PROJECT STATUS', `<div class="v">${esc(meta.status)}</div>`)}
  ${rule(557)}
  ${field(557.8, 'DRAWING TITLE', `<div class="v">CONTEXT ANALYSIS</div>`)}
  ${rule(574)}
  <div class="abs" style="top:574.8mm;left:4.8mm;right:0">
    <div style="display:grid;grid-template-columns:1fr 1fr">
      <div><div class="k">SHEET NO.</div><div class="v">${esc(meta.sheetNo)}</div></div>
      <div><div class="k">REVISION.</div><div class="v">${esc(meta.revision)}</div></div>
    </div>
  </div>
</div>
</div></body></html>`;
}

/** Dominant height-of-building label per category (join by zoning centroid in HOB polygon). */
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

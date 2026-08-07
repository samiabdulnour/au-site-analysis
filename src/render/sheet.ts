// Composes the A1 CONTEXT ANALYSIS sheet as an HTML page (SVG map + title
// block column) matching docs/SHEET_SPEC.md.

import type { Bundle } from '../pipeline.js';
import { lonLatToMercator, ringCentroid, type Extent } from '../lib/geo.js';
import { CATEGORIES, catById, zoneToCategory, poiToCategory } from './model.js';

export const SHEET_W = 841;
export const SHEET_H = 594;
export const TITLE_W = 148;
export const MAP_W = SHEET_W - TITLE_W;

export interface SheetMeta {
  jobNo: string;
  client: string;
  status: string;      // e.g. DEVELOPMENT APPLICATION
  sheetNo: string;     // e.g. DA 003
  revision: string;
  checked: string;
  drawn: string;
  preliminary: boolean;
  office: {
    name: string;
    lines: string[];
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Pt = [number, number];

function makeProjector(extent: Extent) {
  const sx = MAP_W / (extent.xmax - extent.xmin);
  const sy = SHEET_H / (extent.ymax - extent.ymin);
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

/** Rough polygon area in m² (mercator, corrected is unnecessary for thresholds). */
function ringAreaM2(ring: number[][]): number {
  let a = 0;
  const pts = ring.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  for (let i = 0; i < pts.length - 1; i++) a += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  return Math.abs(a / 2);
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

function wrapLabel(name: string, maxChars = 16): string[] {
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

function haloText(x: number, y: number, lines: string[], size: number, fill: string, weight = 700): string {
  const lh = size * 1.15;
  const y0 = y - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="${x.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}">${esc(l)}</tspan>`)
    .join('');
  return `<text text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${fill}"
    stroke="#ffffff" stroke-width="${(size * 0.28).toFixed(2)}" paint-order="stroke" stroke-linejoin="round">${tspans}</text>`;
}

export function renderSheet(bundle: Bundle, meta: SheetMeta): string {
  const proj = makeProjector(bundle.extent);
  const usedCats = new Set<string>();
  const layers: string[] = [];

  // ---- aerial base -------------------------------------------------------
  const imgs = bundle.aerial.tiles
    .map(
      (t) => `<image href="data/${t.file}" x="${(t.left * MAP_W).toFixed(2)}" y="${(t.top * SHEET_H).toFixed(2)}"
        width="${(t.width * MAP_W).toFixed(2)}" height="${(t.height * SHEET_H).toFixed(2)}"
        preserveAspectRatio="none" style="filter:saturate(0.72)"/>`,
    )
    .join('\n');
  layers.push(imgs);
  layers.push(`<rect x="0" y="0" width="${MAP_W}" height="${SHEET_H}" fill="#ffffff" opacity="0.42"/>`);

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
    const c = catById.railway;
    const d = bundle.railCorridors.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="${c.fill}" opacity="${c.opacity}"/>`);
  }

  // ---- POI overrides (function beats zone) -------------------------------
  interface PoiLabel { x: number; y: number; lines: string[]; areaM2: number }
  const poiLabels: PoiLabel[] = [];
  const poiPathsByCat: Record<string, string[]> = {};
  for (const poi of bundle.osm.pois) {
    const cat = poiToCategory(poi.kind);
    if (!cat) continue;
    const rings = poi.rings.filter((r) => r.length >= 3);
    if (!rings.length) continue;
    (poiPathsByCat[cat] ??= []).push(pathFromRings(rings as any, proj));
    const area = ringAreaM2(rings[0] as any);
    if (poi.name && area > 1800) {
      const [clon, clat] = ringCentroid(rings[0] as any);
      const [x, y] = proj(clon, clat);
      if (x > 5 && x < MAP_W - 5 && y > 5 && y < SHEET_H - 5)
        poiLabels.push({ x, y, lines: wrapLabel(poi.name), areaM2: area });
    }
  }
  for (const [cat, paths] of Object.entries(poiPathsByCat)) {
    const c = catById[cat];
    usedCats.add(cat);
    layers.push(`<g fill="${c.fill}" opacity="${c.opacity}">` +
      paths.map((d) => `<path d="${d}"/>`).join('') + '</g>');
  }

  // ---- heritage ----------------------------------------------------------
  if (bundle.heritage.features.length) {
    usedCats.add('heritage');
    const d = bundle.heritage.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="url(#hatch)" stroke="#a97b3f" stroke-width="0.25" opacity="0.8"/>`);
  }

  // ---- OSM rail lines + bus routes --------------------------------------
  if (bundle.osm.railLines.length) {
    const d = bundle.osm.railLines.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#b35c00" stroke-width="0.5" stroke-dasharray="3,1.2" opacity="0.9"/>`);
  }
  if (bundle.osm.busRouteSegments.length) {
    const d = bundle.osm.busRouteSegments.map((l) => pathFromRings([l as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#2f7fd6" stroke-width="0.5" stroke-dasharray="2.2,1.4" opacity="0.9" stroke-linecap="round"/>`);
  }

  // ---- isochrones --------------------------------------------------------
  const isoStyle: Record<number, { color: string; label: string }> = {
    5: { color: '#e6007e', label: '400m (5-MIN WALK)' },
    10: { color: '#b5379b', label: '800m (10-MIN WALK)' },
  };
  for (const iso of bundle.isochrones) {
    const st = isoStyle[iso.minutes] ?? { color: '#e6007e', label: `${iso.minutes} MIN WALK` };
    const d = iso.rings.map((r) => pathFromRings([r as any], proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="0.7" stroke-dasharray="2.6,1.6" stroke-linejoin="round"/>`);
    // label at the ring's topmost vertex
    let best: Pt | null = null;
    for (const r of iso.rings) for (const [lon, lat] of r) {
      const p = proj(lon, lat);
      if (p[0] > 30 && p[0] < MAP_W - 40 && (!best || p[1] < best[1])) best = p;
    }
    if (best) layers.push(haloText(best[0], best[1] + 4, [st.label], 3.2, st.color));
  }

  // ---- site --------------------------------------------------------------
  {
    usedCats.add('site');
    const d = bundle.siteLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="#e8402a" fill-opacity="0.55" stroke="#cc0000" stroke-width="0.9" stroke-dasharray="2.4,1.2"/>`);
  }

  // ---- street labels -----------------------------------------------------
  const roadByName = new Map<string, { coords: Pt[]; len: number; cls: string }>();
  for (const road of bundle.osm.roads) {
    const pts = road.coords.map(([lon, lat]) => proj(lon, lat))
      .filter(([x, y]) => x > -50 && x < MAP_W + 50 && y > -50 && y < SHEET_H + 50);
    if (pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const cur = roadByName.get(road.name);
    if (!cur || len > cur.len) roadByName.set(road.name, { coords: pts, len, cls: road.cls });
  }
  let rid = 0;
  const roadDefs: string[] = [];
  const roadTexts: string[] = [];
  for (const [name, r] of roadByName) {
    if (r.len < 22) continue; // too short to label legibly
    let pts = r.coords;
    if (pts[0][0] > pts[pts.length - 1][0]) pts = [...pts].reverse();
    const id = `rd${rid++}`;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('');
    const major = /^(motorway|trunk|primary|secondary)$/.test(r.cls);
    const size = major ? 2.5 : 2.0;
    roadDefs.push(`<path id="${id}" d="${d}" fill="none"/>`);
    roadTexts.push(`<text font-size="${size}" font-weight="${major ? 700 : 500}" fill="#3a3a3a" letter-spacing="0.45"
      stroke="#ffffff" stroke-width="${(size * 0.3).toFixed(2)}" paint-order="stroke" dy="-0.7">
      <textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(name.toUpperCase())}</textPath></text>`);
  }
  layers.push(`<defs>${roadDefs.join('')}</defs>`);
  layers.push(roadTexts.join('\n'));

  // ---- POI labels (drawn above street labels) ----------------------------
  poiLabels.sort((a, b) => b.areaM2 - a.areaM2);
  const placed: Pt[] = [];
  const poiTexts: string[] = [];
  for (const pl of poiLabels) {
    if (placed.some(([px, py]) => Math.hypot(px - pl.x, py - pl.y) < 16)) continue;
    placed.push([pl.x, pl.y]);
    const size = pl.areaM2 > 40_000 ? 3.0 : 2.4;
    poiTexts.push(haloText(pl.x, pl.y, pl.lines, size, '#222222'));
  }
  layers.push(poiTexts.join('\n'));

  // ---- transport symbols -------------------------------------------------
  const busStopSvgs = bundle.osm.busStops
    .map(({ lon, lat }) => proj(lon, lat))
    .filter(([x, y]) => x > 2 && x < MAP_W - 2 && y > 2 && y < SHEET_H - 2)
    .map(([x, y]) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <circle r="1.7" fill="#2f7fd6" stroke="#ffffff" stroke-width="0.35"/>
      <text text-anchor="middle" dy="0.62" font-size="2.1" font-weight="700" fill="#ffffff">B</text></g>`);
  layers.push(busStopSvgs.join('\n'));

  const stationSvgs = bundle.osm.stations
    .map((s) => ({ p: proj(s.lon, s.lat), name: s.name }))
    .filter(({ p: [x, y] }) => x > 2 && x < MAP_W - 2 && y > 2 && y < SHEET_H - 2)
    .map(({ p: [x, y], name }) => {
      const label = name ? haloText(x, y - 6, wrapLabel(`${name} STATION`), 2.8, '#111111') : '';
      return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="2.4" fill="#ffffff" stroke="#e8402a" stroke-width="0.55"/>
        <text text-anchor="middle" dy="0.85" font-size="3" font-weight="700" fill="#e8402a">T</text></g>${label}`;
    });
  layers.push(stationSvgs.join('\n'));

  // ---- legend ------------------------------------------------------------
  const hobByCat = computeHobByCat(bundle);
  const legendRows: string[] = [];
  for (const c of CATEGORIES) {
    if (!usedCats.has(c.id)) continue;
    const hob = hobByCat[c.id];
    const label = esc(c.label) + (hob ? `<br><span class="sub">HOB: ${esc(hob)}</span>` : '');
    const swatch = c.id === 'site'
      ? `<svg width="26" height="13"><rect x="1.5" y="1.5" width="23" height="10" fill="#e8402a" fill-opacity="0.55" stroke="#cc0000" stroke-width="1.6" stroke-dasharray="4,2"/></svg>`
      : c.id === 'heritage'
        ? `<svg width="26" height="13"><defs><pattern id="lh" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="4" stroke="#a97b3f" stroke-width="1.2"/></pattern></defs><rect x="1.5" y="1.5" width="23" height="10" fill="url(#lh)" stroke="#a97b3f" stroke-width="0.7"/></svg>`
        : `<svg width="26" height="13"><rect x="1.5" y="1.5" width="23" height="10" fill="${c.fill}" fill-opacity="${c.opacity + 0.15}" stroke="#666" stroke-width="0.35"/></svg>`;
    legendRows.push(`<div class="lgrow">${swatch}<div>${label}</div></div>`);
  }
  const symbolRows = `
    <div class="lgrow"><svg width="26" height="13"><circle cx="13" cy="6.5" r="5.5" fill="#ffffff" stroke="#e8402a" stroke-width="1.3"/><text x="13" y="9" text-anchor="middle" font-size="7" font-weight="700" fill="#e8402a">T</text></svg><div>TRAIN STATION</div></div>
    <div class="lgrow"><svg width="26" height="13"><circle cx="13" cy="6.5" r="5" fill="#2f7fd6" stroke="#fff" stroke-width="1"/><text x="13" y="9" text-anchor="middle" font-size="6.5" font-weight="700" fill="#fff">B</text></svg><div>BUS STOPS</div></div>
    <div class="lgrow"><svg width="26" height="13"><line x1="1" y1="6.5" x2="25" y2="6.5" stroke="#2f7fd6" stroke-width="1.6" stroke-dasharray="5,3"/></svg><div>BUS ROUTE</div></div>
    <div class="lgrow"><svg width="26" height="13"><line x1="1" y1="6.5" x2="25" y2="6.5" stroke="#e6007e" stroke-width="1.8" stroke-dasharray="6,3.5"/></svg><div>ISOCHRONE — 400m / 5 MIN WALK</div></div>
    <div class="lgrow"><svg width="26" height="13"><line x1="1" y1="6.5" x2="25" y2="6.5" stroke="#b5379b" stroke-width="1.8" stroke-dasharray="6,3.5"/></svg><div>ISOCHRONE — 800m / 10 MIN WALK</div></div>`;

  // ---- scale bar ---------------------------------------------------------
  const mm100m = 100_000 / bundle.scale; // mm on sheet for 100 m ground
  const scaleBar = `
    <svg width="${(mm100m + 14).toFixed(1)}mm" height="8mm" viewBox="0 0 ${(mm100m + 14).toFixed(1)} 8">
      ${[0, 0.2, 0.5, 1].map((f, i, arr) => i < arr.length - 1
        ? `<rect x="${(4 + f * mm100m).toFixed(1)}" y="2.4" width="${((arr[i + 1] - f) * mm100m).toFixed(1)}" height="1.6" fill="${i % 2 ? '#ffffff' : '#333333'}" stroke="#333" stroke-width="0.2"/>` : '')
        .join('')}
      ${[0, 20, 50, 100].map((m) => `<text x="${(4 + (m / 100) * mm100m).toFixed(1)}" y="7.4" text-anchor="middle" font-size="2.1" fill="#333">${m}${m === 100 ? 'm' : ''}</text>`).join('')}
    </svg>`;

  const northArrow = `
    <svg width="12mm" height="12mm" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5.2" fill="none" stroke="#333" stroke-width="0.35"/>
      <path d="M6,1.6 L7.3,6.6 L6,5.8 L4.7,6.6 Z" fill="#333"/>
      <text x="6" y="10.6" text-anchor="middle" font-size="3" font-weight="700" fill="#333">N</text>
    </svg>`;

  // ---- notes -------------------------------------------------------------
  const notes = [
    'NO REPRODUCTION WITHOUT PERMISSION, UNLESS NOTED OTHERWISE.',
    'THIS DRAWING IS NOT FOR CONSTRUCTION.',
    'NO STRUCTURAL OR SERVICE ENGINEERING INPUT OR COORDINATION HAS BEEN PROVIDED IN THE PREPARATION OF THE DRAWINGS. DRAWINGS CANNOT BE RELIED UPON FOR THE BASIS OF MARKETING SALES OR CONSTRUCTION QUOTATION.',
    'ALL DIMENSIONS AND LEVELS ARE TO BE CHECKED ON SITE PRIOR TO THE COMMENCEMENT OF WORK.',
    `INFORM ${meta.office.name.toUpperCase()} OF ANY DISCREPANCIES FOR CLARIFICATION BEFORE PROCEEDING WITH WORK.`,
    'DRAWINGS ARE NOT TO BE SCALED.',
    'USE ONLY FIGURED DIMENSIONS.',
    'REFER TO CONSULTANT DOCUMENTATION FOR FURTHER INFORMATION.',
  ];

  const siteAddress = bundle.geocode.matchedAddresses[0] ?? bundle.address;
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }).toUpperCase();

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(siteAddress)} — CONTEXT ANALYSIS</title>
<style>
  @page { size: ${SHEET_W}mm ${SHEET_H}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${SHEET_W}mm; height: ${SHEET_H}mm; font-family: 'Liberation Sans', Arial, Helvetica, sans-serif; background: #fff; }
  .sheet { position: relative; width: ${SHEET_W}mm; height: ${SHEET_H}mm; overflow: hidden; }
  svg.map { position: absolute; left: 0; top: 0; }
  .titlecol { position: absolute; right: 0; top: 0; width: ${TITLE_W}mm; height: ${SHEET_H}mm;
    border-left: 0.4mm solid #222; background: #fff; padding: 3mm 3.5mm; display: flex; flex-direction: column; font-size: 2.2mm; color: #222; }
  .block { border-bottom: 0.15mm solid #999; padding: 1.6mm 0; }
  .block h4 { font-size: 1.9mm; font-weight: 700; letter-spacing: 0.2mm; margin-bottom: 0.8mm; }
  .tiny { font-size: 1.55mm; line-height: 1.35; color: #444; }
  .notes li { margin-left: 2.5mm; margin-bottom: 0.5mm; }
  .lgrow { display: flex; align-items: center; gap: 1.6mm; margin-bottom: 1.1mm; font-size: 1.8mm; }
  .lgrow svg { flex: 0 0 auto; }
  .lgrow .sub { color: #555; font-size: 1.6mm; }
  .wordmark { font-size: 5.4mm; font-weight: 700; letter-spacing: 0.35mm; padding: 2mm 0 1mm; }
  .wordmark span { position: relative; }
  .wordmark .rule { text-decoration: line-through; }
  .prelim { border: 0.5mm solid #e30000; color: #e30000; text-align: center; font-weight: 700;
    letter-spacing: 1.2mm; font-size: 3.6mm; padding: 1.6mm 0; margin: 1.6mm 0; }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4mm 2mm; }
  .kv .k { font-size: 1.6mm; color: #555; }
  .kv .v { font-weight: 700; font-size: 2.4mm; }
  .field { padding: 1.2mm 0; border-bottom: 0.15mm solid #999; }
  .field .k { font-size: 1.6mm; color: #555; }
  .field .v { font-weight: 700; font-size: 2.6mm; }
  .field .v.big { font-size: 3.2mm; }
  .grow { flex: 1 1 auto; }
</style></head>
<body><div class="sheet">
<svg class="map" width="${MAP_W}mm" height="${SHEET_H}mm" viewBox="0 0 ${MAP_W} ${SHEET_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="mapclip"><rect x="0" y="0" width="${MAP_W}" height="${SHEET_H}"/></clipPath>
    <pattern id="hatch" width="1.6" height="1.6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="1.6" stroke="#a97b3f" stroke-width="0.45"/>
    </pattern>
  </defs>
  <g clip-path="url(#mapclip)">
${layers.join('\n')}
  </g>
</svg>
<div class="titlecol">
  <div class="tiny">${esc(bundle.address)} — generated ${esc(bundle.generatedAt.slice(0, 10))}</div>
  <div class="block"><h4>NOTE:</h4><ul class="notes tiny">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
  <div class="block"><h4>CONTEXT ANALYSIS</h4>${legendRows.join('')}${symbolRows}</div>
  <div class="grow"></div>
  <div class="block"><h4>ARCHITECT</h4>
    <div class="wordmark">${esc(meta.office.name.split(' ')[0])}<span class="rule">—</span>${esc(meta.office.name.split(' ').slice(1).join(' '))}</div>
    <div class="tiny">${meta.office.lines.map(esc).join('<br>')}</div>
  </div>
  <div class="block"><h4>CLIENT</h4><div class="v" style="font-weight:700">${esc(meta.client)}</div></div>
  ${meta.preliminary ? '<div class="prelim">P R E L I M I N A R Y</div>' : ''}
  <div class="block" style="display:flex;align-items:center;gap:4mm">${northArrow}${scaleBar}</div>
  <div class="field"><div class="k">SITE ADDRESS</div><div class="v">${esc(siteAddress)}</div></div>
  <div class="field kv" style="display:grid">
    <div><div class="k">JOB NO</div><div class="v">${esc(meta.jobNo)}</div></div>
    <div><div class="k">DATE</div><div class="v">${esc(dateStr)}</div></div>
    <div><div class="k">CHECKED</div><div class="v">${esc(meta.checked)}</div></div>
    <div><div class="k">DRAWN</div><div class="v">${esc(meta.drawn)}</div></div>
  </div>
  <div class="field"><div class="k">SCALE</div><div class="v">1:${bundle.scale} @ A1&nbsp;&nbsp;&nbsp;A3@50%</div></div>
  <div class="field"><div class="k">PROJECT STATUS</div><div class="v">${esc(meta.status)}</div></div>
  <div class="field"><div class="k">DRAWING TITLE</div><div class="v big">CONTEXT ANALYSIS</div></div>
  <div class="field kv" style="display:grid;border-bottom:none">
    <div><div class="k">SHEET NO</div><div class="v big">${esc(meta.sheetNo)}</div></div>
    <div><div class="k">REVISION</div><div class="v big">${esc(meta.revision)}</div></div>
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

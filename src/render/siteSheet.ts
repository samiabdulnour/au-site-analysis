// Composes the A1 SITE ANALYSIS sheet: site boundary with dimensions and
// levels, fall of terrain, sun path, prevailing winds, neighbours and street
// furniture — matching the office's DA 004 / SSDA 005 reference sheets.

import type { SiteBundle } from '../pipeline.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import {
  makeProjector, plainText, haloText, wrapLabel, arrowAlong, shortStreetName,
  isMajorStreet, pathFromRings, geomRings, type Pt, type SheetMeta,
} from './sheet.js';
import { sheetHtml, esc, T, SWATCH_X, SWATCH_W, LABEL_X, MAP_W, MAP_H } from './chrome.js';
import { tpl } from './template.js';
import { exitPoint } from '../fetch/views.js';
import { NOMINAL_CANOPY_M } from '../fetch/trees.js';
import { buildParkingBands, type Orientation } from '../lib/parking.js';

// Parking, in the office's plum.
const PARK = '#9b5b6e';
const PARK_INK = '#7a3c50';
const BAY_LABEL: Record<Orientation, string> = { parallel: '6.0 m parallel', diagonal: '45° angle', perpendicular: '90°' };

// One uniform bold size for all map text on this sheet. Exceptions: street
// names on the white arrows (wide-spaced, set separately) and the neighbour
// identification boxes (a step smaller).
const MAP_TEXT = 5.2;
const NEIGHBOUR_TEXT = 4.4;

// Read at call time, not at module load: setTemplate() runs per job, long
// after this module is first imported, so a captured constant would freeze to
// whichever template happened to be active at startup.
const RED = () => tpl().site;
const BLUE = () => tpl().dimension;
const WINDBLUE = () => tpl().wind;
const SUN = () => tpl().sun;
const SUN_TEXT = 8.8;    // label size (mm) on the reference


/**
 * Label placement: keeps a list of occupied rectangles and, when a label
 * collides, nudges it outward through a ring of candidate offsets instead of
 * dropping it. Returns null only if every candidate still overlaps.
 */
class Placer {
  private boxes: { x: number; y: number; w: number; h: number }[] = [];
  reserve(x: number, y: number, w: number, h: number) {
    this.boxes.push({ x: x - w / 2, y: y - h / 2, w, h });
  }
  private free(x: number, y: number, w: number, h: number): boolean {
    const a = { x: x - w / 2, y: y - h / 2, w, h };
    return !this.boxes.some((b) =>
      a.x < b.x + b.w + 1 && a.x + a.w + 1 > b.x && a.y < b.y + b.h + 1 && a.y + a.h + 1 > b.y);
  }
  /**
   * Try (x,y) then rings of candidates around it; reserves and returns the
   * spot. `rotDeg` makes the reserved footprint the rotated envelope, so
   * vertical labels claim the space they actually occupy.
   */
  place(x: number, y: number, w: number, h: number, maxRadius = 26, rotDeg = 0): Pt | null {
    const ar0 = (rotDeg * Math.PI) / 180;
    const W = Math.abs(w * Math.cos(ar0)) + Math.abs(h * Math.sin(ar0));
    const H = Math.abs(w * Math.sin(ar0)) + Math.abs(h * Math.cos(ar0));
    if (this.free(x, y, W, H)) { this.reserve(x, y, W, H); return [x, y]; }
    for (let r = 4; r <= maxRadius; r += 4) {
      for (let a = 0; a < 360; a += 30) {
        const ar = (a * Math.PI) / 180;
        const nx = x + r * Math.cos(ar), ny = y + r * Math.sin(ar);
        if (this.free(nx, ny, W, H)) { this.reserve(nx, ny, W, H); return [nx, ny]; }
      }
    }
    return null;
  }
}

export function renderSiteSheet(sb: SiteBundle, meta: SheetMeta): string {
  const view = sb.view;
  const proj = makeProjector(view);
  const layers: string[] = [];
  const placer = new Placer();
  const lat = mercatorToLonLat({ x: view.cx, y: view.cy }).lat;
  const k = mercatorScaleFactor(lat);
  const MM = view.halfW * 2 / MAP_W; // mercator meters per mm

  // ---- aerial (rotated group over fetch bounds), light wash ---------------
  {
    const s = MAP_W / (2 * view.halfW);
    const extW = (sb.extent.xmax - sb.extent.xmin) * s;
    const extH = (sb.extent.ymax - sb.extent.ymin) * s;
    const ox = MAP_W / 2 - extW / 2;
    const oy = MAP_H / 2 - extH / 2;
    const tiles = sb.aerial.tiles
      .map((t) => `<image href="data/${t.file}" x="${(ox + t.left * extW).toFixed(2)}" y="${(oy + t.top * extH).toFixed(2)}"
          width="${(t.width * extW).toFixed(2)}" height="${(t.height * extH).toFixed(2)}" preserveAspectRatio="none"/>`)
      .join('\n');
    layers.push(`<g transform="rotate(${view.rotationDeg.toFixed(2)}, ${MAP_W / 2}, ${MAP_H / 2})">${tiles}</g>`);
  }
  // (3) White overlay everywhere EXCEPT the site: the analysed lot stays at
  // full aerial saturation, its surroundings are washed back.
  {
    const ring = sb.siteRing.map(([lon, lat2]) => proj(lon, lat2));
    const dHole = 'M' + ring.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z';
    layers.push(`<path fill-rule="evenodd" fill="#ffffff" opacity="0.55"
      d="M0,0 H${MAP_W} V${MAP_H} H0 Z ${dHole}"/>`);
  }

  const inMapWide = ([x, y]: Pt) => x > -10 && x < MAP_W + 10 && y > -10 && y < MAP_H + 10;
  const inMap = ([x, y]: Pt) => x > 2 && x < MAP_W - 2 && y > 2 && y < MAP_H - 2;

  // Reserve the fixed graphic furniture up-front (sun discs, wind banners,
  // site info box) so every later label is nudged clear of them.
  {
    const latR = (Math.abs(lat) * Math.PI) / 180;
    const dec = (23.44 * Math.PI) / 180;
    const azOf = (d: number) => (Math.acos(Math.sin(d) / Math.cos(latR)) * 180) / Math.PI;
    const Ro = Math.min(MAP_W, MAP_H) * 0.42, Ri = Ro * 0.72;
    const cx = MAP_W / 2, cy = MAP_H / 2;
    const at = (az: number, R: number): Pt => {
      const azr = ((az + view.rotationDeg) * Math.PI) / 180;
      return [cx + R * Math.sin(azr), cy - R * Math.cos(azr)];
    };
    for (const [az, R] of [[azOf(dec), Ri], [-azOf(dec), Ri], [azOf(-dec), Ro], [-azOf(-dec), Ro], [0, Ro]] as [number, number][]) {
      const [x, y] = at(az, R);
      placer.reserve(x, y, 38, 38);
    }
    placer.reserve(MAP_W - 95, 55, 110, 20);
    placer.reserve(MAP_W - 85, MAP_H - 75, 120, 20);
    placer.reserve(90, MAP_H - 60, 110, 20);
  }

  // ---- potential views ------------------------------------------------------
  // A translucent cone at the site edge, as the office draws them, for each
  // sight line the ground does not block. The cone goes under the linework;
  // its label is pushed last so nothing draws over it.
  const viewText: string[] = [];
  {
    const centreLL = mercatorToLonLat({ x: view.cx, y: view.cy });
    const L = 52;                              // cone length on paper, mm
    const half = (14 * Math.PI) / 180;         // half the opening angle
    for (const v of sb.views ?? []) {
      if (!v.cone) continue;
      const apex = exitPoint(sb.siteRing, centreLL, v.bearingDeg);
      const [ax, ay] = proj(apex.lon, apex.lat);
      const ang = ((v.bearingDeg + view.rotationDeg) * Math.PI) / 180;
      const arc: string[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = ang - half + (2 * half * i) / 10;
        arc.push(`${(ax + L * Math.sin(a)).toFixed(1)},${(ay - L * Math.cos(a)).toFixed(1)}`);
      }
      layers.push(`<path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${arc.join(' L')} Z" fill="#ffffff" fill-opacity="0.58" stroke="#ffffff" stroke-width="0.5" stroke-linejoin="round"/>`);
      const lx = ax + L * 0.6 * Math.sin(ang), ly = ay - L * 0.6 * Math.cos(ang);
      const lines = wrapLabel(v.kind === 'park' ? `${v.label} OUTLOOK` : `${v.label} VIEW`, 14);
      const dist = v.distanceM >= 950 ? `${(v.distanceM / 1000).toFixed(1)} KM` : `${Math.round(v.distanceM / 10) * 10} M`;
      const sub = v.kind === 'park' ? 'ADJOINING' : `${dist} · TERRAIN CLEAR`;
      const lh = MAP_TEXT * 1.08;
      const w = Math.max(...lines.map((l) => l.length), sub.length * 0.75) * MAP_TEXT * 0.6 + 4;
      // Several cones can leave one corner of a small site; the label is
      // nudged clear of the others rather than drawn over them.
      const spot = placer.place(lx, ly, w, lines.length * lh + 6, 24) ?? [lx, ly];
      const [tx, ty] = spot;
      viewText.push(plainText(tx, ty - lh * 0.35, lines, MAP_TEXT, '#111111'));
      viewText.push(`<text x="${tx.toFixed(1)}" y="${(ty + (lines.length / 2) * lh + 1.6).toFixed(1)}" text-anchor="middle" font-size="${(MAP_TEXT * 0.7).toFixed(2)}" font-weight="700" letter-spacing="0.3" fill="#333333">${esc(sub)}</text>`);
    }
  }

  // ---- cadastre + contours -------------------------------------------------
  if (sb.allLots.features.length) {
    const d = sb.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#5f5f5f" stroke-width="0.18" opacity="0.65"/>`);
  }
  // (2) Terrain: contour lines with elevation tags (RL m AHD) along them.
  if (sb.contours.length) {
    const d = sb.contours.map((c) => pathFromRings([c.coords as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#a07c3f" stroke-width="0.4" opacity="0.85"/>`);
    const tagged: Pt[] = [];
    for (const c of sb.contours) {
      const pts = c.coords.map(([lon, lat2]) => proj(lon, lat2)).filter(inMapWide);
      if (pts.length < 3) continue;
      const i = Math.floor(pts.length / 2);
      const [x, y] = pts[i];
      if (tagged.some(([px, py]) => Math.hypot(px - x, py - y) < 45)) continue;
      tagged.push([x, y]);
      const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[Math.min(pts.length - 1, i + 1)];
      let ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      layers.push(`<text transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)})"
        text-anchor="middle" dy="-1.4" font-size="${MAP_TEXT}" font-weight="700"
        fill="#8a6a2f">RL ${c.elevation.toFixed(0)}</text>`);
    }
  }

  // ---- noise source zigzag along main roads --------------------------------
  const zig = (pts: Pt[]): string => {
    let d = '', run = 0, side = 1;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
      const steps = Math.max(1, Math.floor(len / 2.4));
      for (let sI = 0; sI < steps; sI++) {
        const t0 = sI / steps, t1 = (sI + 1) / steps;
        const mx = ax + (bx - ax) * (t0 + t1) / 2 + nx * 1.1 * side;
        const my = ay + (by - ay) * (t0 + t1) / 2 + ny * 1.1 * side;
        if (!d) d = `M${(ax + (bx - ax) * t0).toFixed(1)},${(ay + (by - ay) * t0).toFixed(1)}`;
        d += `L${mx.toFixed(1)},${my.toFixed(1)}L${(ax + (bx - ax) * t1).toFixed(1)},${(ay + (by - ay) * t1).toFixed(1)}`;
        side = -side; run++;
      }
    }
    return d;
  };
  const mainRoads = sb.roads.filter((r) => r.hierarchy <= 4);
  const seenNoise = new Set<string>();
  for (const r of mainRoads) {
    if (seenNoise.has(r.name)) continue; // one zigzag band per named road
    seenNoise.add(r.name);
    const pts = r.coords.map(([lon, lat2]) => proj(lon, lat2));
    if (pts.length >= 2) layers.push(`<path d="${zig(pts)}" fill="none" stroke="#3b4fd8" stroke-width="0.35" opacity="0.85"/>`);
  }
  // Railways are noise sources too — one zigzag along the corridor (the
  // longest line stands in for the whole track group).
  for (const group of [sb.railLines.train, sb.railLines.tram]) {
    if (!group.length) continue;
    let bestLine = group[0], bestLen = 0;
    for (const line of group) {
      const pts = line.map(([lon, lat2]) => proj(lon, lat2));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len > bestLen) { bestLen = len; bestLine = line; }
    }
    const pts = bestLine.map(([lon, lat2]) => proj(lon, lat2));
    if (pts.length >= 2) layers.push(`<path d="${zig(pts)}" fill="none" stroke="#3b4fd8" stroke-width="0.4" opacity="0.9"/>`);
  }

  // ---- one-way arrows -------------------------------------------------------
  for (const ow of sb.furniture.onewayRoads) {
    const pts = ow.coords.map(([lon, lat2]) => proj(lon, lat2))
      .filter(([x, y]) => x > 0 && x < MAP_W && y > 0 && y < MAP_H);
    if (pts.length < 2) continue;
    const mid = Math.floor(pts.length / 2);
    const [ax, ay] = pts[Math.max(0, mid - 1)], [bx, by] = pts[mid];
    const ang = Math.atan2(by - ay, bx - ax);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const L = 7, h = 2.2;
    layers.push(`<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})">
      <path d="M${-L / 2},0 L${L / 2 - h},0 M${L / 2 - h},${-h * 0.7} L${L / 2},0 L${L / 2 - h},${h * 0.7}"
        fill="none" stroke="#ffffff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></g>`);
  }

  // (6) Utilities where mapped (OSM power lines / pipelines; DBYD-grade
  // service data is not open, so this is best-effort).
  {
    const styles: Record<string, string> = {
      power: '#f2c200', water: '#2f7fd6', sewer: '#7db87d', gas: '#e6007e',
    };
    for (const u of sb.furniture.utilities) {
      const pts = u.coords.map(([lon, lat2]) => proj(lon, lat2));
      if (pts.length < 2) continue;
      const d = 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L');
      layers.push(`<path d="${d}" fill="none" stroke="${styles[u.kind]}" stroke-width="0.7" stroke-dasharray="4,2.2"/>`);
    }
  }


  // ---- kerbside parking: one quad per bay, at the kerb the cadastre implies --
  // A bundle from before the bays were set out carries only the tagged runs;
  // set them out here from the same lots so it draws the same way.
  const bands = sb.parkingBands
    ?? buildParkingBands(sb.furniture.parkingLanes, sb.allLots.features.flatMap((f) => geomRings(f.geometry)),
      sb.furniture.driveways.map((d) => d.coords), sb.roads.map((r) => r.coords));
  const bayCount = bands.reduce((n, b) => n + b.bays.length, 0);
  const orientations = new Set(bands.map((b) => b.orientation));
  for (const band of bands) {
    layers.push(`<path d="${band.bays.map((ring) => pathFromRings([ring], proj)).join('')}" fill="${PARK}" fill-opacity="0.35" stroke="${PARK_INK}" stroke-width="0.3" stroke-linejoin="round"/>`);
  }

  // ---- off-street car parks, and bays someone mapped one by one -------------
  const carParks = sb.furniture.carParks ?? [];
  for (const cp of carParks) {
    const pts = cp.ring.map(([lon, lat2]) => proj(lon, lat2));
    if (!pts.some(inMapWide)) continue;
    const open = cp.kind === 'surface' || cp.kind === 'street_side';
    layers.push(`<path d="${pathFromRings([cp.ring], proj)}" fill="${PARK}" fill-opacity="${open ? 0.18 : 0.08}" stroke="${PARK_INK}" stroke-width="0.5"${open ? '' : ' stroke-dasharray="2.4,1.2"'}/>`);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    if (!inMap([cx, cy])) continue;
    const kindLabel: Record<string, string> = {
      surface: 'CAR PARK', 'multi-storey': 'MULTI-STOREY CAR PARK', underground: 'BASEMENT CAR PARK',
      rooftop: 'ROOFTOP CAR PARK', street_side: 'PARKING BAYS', other: 'CAR PARK',
    };
    const lines = [...wrapLabel(kindLabel[cp.kind] ?? 'CAR PARK', 14), ...(cp.capacity ? [`${cp.capacity} BAYS`] : [])];
    const w = Math.max(...lines.map((t) => t.length)) * NEIGHBOUR_TEXT * 0.56 + 3;
    const h = lines.length * NEIGHBOUR_TEXT * 1.16 + 2;
    const spot = placer.place(cx, cy, w, h, 12);
    if (spot) layers.push(plainText(spot[0], spot[1], lines, NEIGHBOUR_TEXT, '#5f2c3c'));
  }
  const mappedBays = sb.furniture.parkingBays ?? [];
  if (mappedBays.length) {
    layers.push(`<path d="${mappedBays.map((b) => pathFromRings([b.ring], proj)).join('')}" fill="${PARK}" fill-opacity="0.25" stroke="${PARK_INK}" stroke-width="0.25"/>`);
  }

  // ---- vehicular access (yellow triangle at the street end of a driveway) ---
  for (const dw of sb.furniture.driveways) {
    const pts = dw.coords.map(([lon, lat2]) => proj(lon, lat2));
    if (pts.length < 2) continue;
    // the end further from the site centre is the street end
    const dStart = Math.hypot(pts[0][0] - MAP_W / 2, pts[0][1] - MAP_H / 2);
    const dEnd = Math.hypot(pts[pts.length - 1][0] - MAP_W / 2, pts[pts.length - 1][1] - MAP_H / 2);
    const [tx, ty] = dStart > dEnd ? pts[0] : pts[pts.length - 1];
    const [nx, ny] = dStart > dEnd ? pts[1] : pts[pts.length - 2];
    if (!inMap([tx, ty])) continue;
    const ang = (Math.atan2(ny - ty, nx - tx) * 180) / Math.PI + 90;
    layers.push(`<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${ang.toFixed(1)})">
      <path d="M-3.4,-3 L3.4,-3 L0,3 Z" fill="#f5e400" stroke="#c9bb00" stroke-width="0.3"/></g>`);
  }

  // ---- traffic direction and lanes -----------------------------------------
  {
    const shown = new Set<string>();
    for (const r of sb.roads) {
      if (!r.lanes || r.lanes < 1 || r.hierarchy > 5 || shown.has(r.name)) continue;
      const pts = r.coords.map(([lon, lat2]) => proj(lon, lat2)).filter(inMap);
      if (pts.length < 2) continue;
      const i = Math.floor(pts.length / 2);
      const [ax, ay] = pts[Math.max(0, i - 1)], [bx, by] = pts[i];
      const ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      const spot = placer.place((ax + bx) / 2, (ay + by) / 2, 10, 12, 12);
      if (!spot) continue;
      shown.add(r.name);
      const lanes = Math.min(4, r.lanes);
      const arrows = Array.from({ length: lanes }, (_, n) => {
        const off = (n - (lanes - 1) / 2) * 2.6;
        const up = n % 2 === 0 ? 1 : -1;
        return `<path d="M${off},${5 * up} L${off},${-4 * up} M${off - 1.3},${-2.2 * up} L${off},${-4.4 * up} L${off + 1.3},${-2.2 * up}"
          fill="none" stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/>`;
      }).join('');
      layers.push(`<g transform="translate(${spot[0].toFixed(1)},${spot[1].toFixed(1)}) rotate(${(ang + 90).toFixed(1)})">${arrows}</g>`);
    }
  }

  // ---- trees, canopy at ground scale ---------------------------------------
  // A recorded canopy (council inventory, OSM) draws solid; the nominal size
  // for a tree nobody has measured draws dashed, so the sheet does not claim
  // more than it knows. Never smaller than a dot a reader can find.
  const mmPerM = 1000 / sb.scale;
  const treeStats = { measured: 0, estimated: 0, nominal: 0 };
  {
    const svg: string[] = [];
    for (const t of sb.furniture.trees) {
      const [x, y] = proj(t.lon, t.lat);
      if (!inMapWide([x, y])) continue;
      const src = t.canopySource ?? 'nominal';
      treeStats[src]++;
      const r = Math.min(45, Math.max(1.6, ((t.canopyM ?? NOMINAL_CANOPY_M) / 2) * mmPerM));
      svg.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#7dbb57" fill-opacity="0.38" stroke="#4e8c33" stroke-width="0.35"${src === 'nominal' ? ' stroke-dasharray="1.5,0.9"' : ''}/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.55" fill="#2f5e20"/>`);
    }
    layers.push(svg.join(''));
  }

  // ---- street furniture ------------------------------------------------------
  layers.push(sb.furniture.hydrants.map((p) => proj(p.lon, p.lat)).filter(inMap)
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" fill="#1f78d1"/>`)
    .join(''));
  layers.push(sb.furniture.powerPoles.map((p) => proj(p.lon, p.lat)).filter(inMap)
    .map(([x, y]) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><line x1="-1.8" y1="0" x2="1.8" y2="0" stroke="#333" stroke-width="0.3"/><circle r="0.9" fill="none" stroke="#333" stroke-width="0.35"/></g>`)
    .join(''));
  layers.push(sb.furniture.streetLamps.map((p) => proj(p.lon, p.lat)).filter(inMap)
    .map(([x, y]) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="1" fill="#f0c020" stroke="#a8860b" stroke-width="0.25"/>${[0, 60, 120, 180, 240, 300].map((a) => { const r0 = 1.3, r1 = 2.1, ar = (a * Math.PI) / 180; return `<line x1="${(r0 * Math.cos(ar)).toFixed(1)}" y1="${(r0 * Math.sin(ar)).toFixed(1)}" x2="${(r1 * Math.cos(ar)).toFixed(1)}" y2="${(r1 * Math.sin(ar)).toFixed(1)}" stroke="#a8860b" stroke-width="0.2"/>`; }).join('')}</g>`)
    .join(''));

  // ---- bus stops ---------------------------------------------------------------
  layers.push(sb.busStops.map((s) => proj(s.lon, s.lat)).filter(inMap)
    .map(([x, y]) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <circle r="4" fill="#ffffff" stroke="#2f7fd6" stroke-width="0.9"/>
      <text text-anchor="middle" dy="2.2" font-size="6.2" font-weight="700" fill="#2f7fd6">B</text></g>`)
    .join(''));

  const sitePx = sb.siteRing.map(([lon, lat2]) => proj(lon, lat2));
  const inSite = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = sitePx.length - 1; i < sitePx.length; j = i++) {
      const [xi, yi] = sitePx[i], [xj, yj] = sitePx[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  // The FALL/AREA box sits on the site centre — reserve it before labels.
  {
    const cx0 = sitePx.reduce((s2, p) => s2 + p[0], 0) / sitePx.length;
    const cy0 = sitePx.reduce((s2, p) => s2 + p[1], 0) / sitePx.length;
    placer.reserve(cx0, cy0, 56, 24);
  }

  // ---- (4) neighbour info boxes: address, storeys (where known), zone ------
  {
    // zone lookup by point-in-polygon over the LEP zoning layer
    const zonePolys = sb.zoning.features
      .map((f) => ({ code: f.properties.SYM_CODE as string, rings: geomRings(f.geometry) }))
      .filter((z) => z.code && z.rings.length);
    const zoneLabel = (code: string): string | null => {
      const c = (code || '').toUpperCase();
      if (c.startsWith('R2')) return 'R2 LOW DENSITY RESIDENTIAL';
      if (c.startsWith('R3')) return 'R3 MEDIUM DENSITY RESIDENTIAL';
      if (c.startsWith('R4')) return 'R4 HIGH DENSITY RESIDENTIAL';
      if (c.startsWith('R1')) return 'R1 GENERAL RESIDENTIAL';
      if (c === 'B2' || c === 'E1') return 'E1 LOCAL CENTRE';
      if (c === 'B4' || c === 'MU1') return 'MU1 MIXED USE';
      if (c.startsWith('SP')) return 'SP2 INFRASTRUCTURE';
      if (c.startsWith('RE')) return 'RE1 PUBLIC RECREATION';
      if (c.startsWith('E4') || c.startsWith('IN')) return 'E4 GENERAL INDUSTRIAL';
      return c || null;
    };
    const zoneAt = (lon: number, lat2: number): string | null => {
      for (const z of zonePolys) {
        for (const r of z.rings) {
          let inside = false;
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [xi, yi] = r[i], [xj, yj] = r[j];
            if (yi > lat2 !== yj > lat2 && lon < ((xj - xi) * (lat2 - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) return zoneLabel(z.code);
        }
      }
      return null;
    };
    // nearest OSM building with a levels tag (within 25m) gives storeys
    const storeysAt = (lon: number, lat2: number): number | undefined => {
      const P = lonLatToMercator({ lon, lat: lat2 });
      let best: number | undefined;
      let bestD = 25 * k;
      for (const b of sb.furniture.buildings) {
        if (!b.levels) continue;
        const Q = lonLatToMercator({ lon: b.lon, lat: b.lat });
        const d = Math.hypot(Q.x - P.x, Q.y - P.y);
        if (d < bestD) { bestD = d; best = b.levels; }
      }
      return best;
    };

    // "26 CAMPSIE STREET CAMPSIE" -> "CAMPSIE ST" (abbreviated, no suburb)
    const full = (sb.geocode.matchedAddresses[0] ?? '').split(' ').slice(1);
    const TYPES = new Set(['STREET','ROAD','AVENUE','PARADE','HIGHWAY','DRIVE','LANE','PLACE','CRESCENT','COURT','BOULEVARD','TERRACE','CIRCUIT','CLOSE','WAY','GROVE','ESPLANADE']);
    let cut = full.length;
    for (let i = 0; i < full.length; i++) if (TYPES.has(full[i])) { cut = i + 1; break; }
    void shortStreetName(full.slice(0, cut).join(' ')); // street name intentionally unused in labels
    const boxes: string[] = [];
    const nearLimit = (70 * k) * (MAP_W / (2 * view.halfW)); // 70 m in mm
    const distToSite = (x: number, y: number): number => {
      let best = Infinity;
      for (let i = 1; i < sitePx.length; i++) {
        const [ax, ay] = sitePx[i - 1], [bx, by] = sitePx[i];
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
      }
      return best;
    };
    const sorted = [...sb.neighbours].map((n) => {
      const [x, y] = proj(n.lon, n.lat);
      return { n, x, y, d: distToSite(x, y) };
    }).filter((e) => e.d <= nearLimit).sort((a, b) => a.d - b.d);
    for (const { n, x, y } of sorted) {
      if (!inMap([x, y]) || inSite(x, y)) continue;
      const zone = zoneAt(n.lon, n.lat);
      const st = storeysAt(n.lon, n.lat);
      const l1 = n.housenumber.toUpperCase();   // number only — no street name
      const l2 = st ? `${st} STOREY` : '';
      const lines = [l1, l2].filter(Boolean);
      const zoneLines = zone ? wrapLabel(zone, 22) : [];
      const fs = NEIGHBOUR_TEXT, lh = fs * 1.16;
      const w = Math.max(...[...lines, ...zoneLines].map((t) => t.length)) * fs * 0.54 + 4.5;
      const h = (lines.length + zoneLines.length) * lh + 2.4;
      const spot = placer.place(x, y, w, h, 30);
      if (!spot) continue;
      const [px, py] = spot;
      const bx = px - w / 2, by = py - h / 2;
      let inner = '';
      lines.forEach((t, i) => {
        inner += `<text x="${px.toFixed(1)}" y="${(by + 1.2 + lh * (i + 0.8)).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#111">${esc(t)}</text>`;
      });
      zoneLines.forEach((t, i) => {
        inner += `<text x="${px.toFixed(1)}" y="${(by + 1.2 + lh * (lines.length + i + 0.8)).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${BLUE()}">${esc(t)}</text>`;
      });
      boxes.push(`<g>${inner}</g>`);   // no white background panel
    }
    layers.push(boxes.join(''));
  }

  // ---- street names: arrow band for a street, plain text for a lane -----------
  // The same distinction the context sheet makes, and it matters just as much
  // here: at 1:300 the rear laneway is often the widest thing on the sheet
  // after the street itself, and banding both makes them read as equals.
  const best = new Map<string, { pts: Pt[]; len: number; hierarchy: number; lanes?: number }>();
  for (const road of sb.roads) {
    const pts = road.coords.map(([lon, lat2]) => proj(lon, lat2))
      .filter(([x, y]) => x > -40 && x < MAP_W + 40 && y > -40 && y < MAP_H + 40);
    if (pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const cur = best.get(road.name);
    const hierarchy = Math.min(cur?.hierarchy ?? 9, road.hierarchy);
    const lanes = road.lanes === undefined ? cur?.lanes : Math.max(cur?.lanes ?? 0, road.lanes);
    best.set(road.name, !cur || len > cur.len
      ? { pts, len, hierarchy, lanes }
      : { ...cur, hierarchy, lanes });
  }
  const siteRoadDefs: string[] = [];
  let srid = 0;
  for (const [name, r] of best) {
    const label = shortStreetName(name);
    const spacing = 1.7;
    const SITE_STREET = T.street * 1.15;
    const textLen = label.length * (SITE_STREET * 0.62 + spacing);
    let pts = r.pts;
    if (pts[0][0] > pts[pts.length - 1][0]) pts = [...pts].reverse();
    const arrow = isMajorStreet(r.hierarchy, r.lanes, name) && r.len * 0.85 >= textLen + 12
      ? arrowAlong(pts, Math.min(r.len * 0.85, textLen + 20))
      : null;
    if (arrow) {
      let ta = arrow.angDeg;
      if (ta > 90) ta -= 180;
      if (ta < -90) ta += 180;
      layers.push(arrow.svg);
      layers.push(`<text transform="translate(${arrow.cx.toFixed(1)},${arrow.cy.toFixed(1)}) rotate(${ta.toFixed(1)})"
        x="${(-textLen / 2).toFixed(1)}" y="1.65" textLength="${textLen.toFixed(1)}" lengthAdjust="spacing"
        font-size="${SITE_STREET.toFixed(2)}" font-weight="700" fill="#111111">${esc(label)}</text>`);
      continue;
    }
    // Plain label, set on the straight chord of the run: a laneway's own
    // vertices jog too much to carry text along directly.
    const plainLen = label.length * (SITE_STREET * 0.72 + 0.4) + 3;
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < plainLen) continue;
    const id = `srd${srid++}`;
    siteRoadDefs.push(`<path id="${id}" d="M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}" fill="none"/>`);
    layers.push(`<text font-size="${SITE_STREET.toFixed(2)}" font-weight="700" letter-spacing="0.4" dy="-1.4" fill="#111111">
      <textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
  }
  if (siteRoadDefs.length) layers.push(`<defs>${siteRoadDefs.join('')}</defs>`);

  // ---- SITE: boundary, dimensions, levels, fall, area ---------------------------
  // significant corners: keep vertices whose turn deviates >12° from straight
  const ringPx = sitePx.slice(0, sitePx.length - 1); // drop closing dup
  const keep: number[] = [];
  for (let i = 0; i < ringPx.length; i++) {
    const a = ringPx[(i - 1 + ringPx.length) % ringPx.length];
    const b = ringPx[i];
    const c = ringPx[(i + 1) % ringPx.length];
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let dv = Math.abs(a2 - a1) * (180 / Math.PI);
    if (dv > 180) dv = 360 - dv;
    if (dv > 12) keep.push(i);
  }
  const corners = keep.length >= 3 ? keep : ringPx.map((_, i) => i);

  // boundary path (red dash-dot) + corner circles
  const dSite = 'M' + sitePx.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z';
  layers.push(`<path d="${dSite}" fill="none" stroke="${RED()}" stroke-width="1.15" stroke-dasharray="7,2,1.6,2"/>`);
  layers.push(corners.map((i) => `<circle cx="${ringPx[i][0].toFixed(1)}" cy="${ringPx[i][1].toFixed(1)}" r="1.7" fill="none" stroke="${RED()}" stroke-width="0.55"/>`).join(''));

  // edge dimensions between consecutive kept corners
  const groundLen = (i0: number, i1: number): number => {
    // walk the ring from corner i0 to i1 summing mercator lengths
    let len = 0;
    let i = i0;
    while (i !== i1) {
      const j = (i + 1) % ringPx.length;
      const A = lonLatToMercator({ lon: sb.siteRing[i][0], lat: sb.siteRing[i][1] });
      const B = lonLatToMercator({ lon: sb.siteRing[j][0], lat: sb.siteRing[j][1] });
      len += Math.hypot(B.x - A.x, B.y - A.y);
      i = j;
    }
    return len / k;
  };
  const centroidPx: Pt = [
    ringPx.reduce((s, p) => s + p[0], 0) / ringPx.length,
    ringPx.reduce((s, p) => s + p[1], 0) / ringPx.length,
  ];
  const sbPlaced: Pt[] = [];
  for (let ci = 0; ci < corners.length; ci++) {
    const i0 = corners[ci], i1 = corners[(ci + 1) % corners.length];
    const len = groundLen(i0, i1);
    if (len < 3) continue;
    const [ax, ay] = ringPx[i0], [bx, by] = ringPx[i1];
    if (Math.hypot(bx - ax, by - ay) < 14) continue; // too short on paper to label
    let ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // offset label outward (away from centroid)
    const ox = mx - centroidPx[0], oy = my - centroidPx[1];
    const on = Math.hypot(ox, oy) || 1;
    const lx = mx + (ox / on) * 5.0, lyy = my + (oy / on) * 5.0;
    const txt = `SB ${len.toFixed(2)}`;
    const spot = placer.place(lx, lyy, txt.length * 3.0, 6.4, 16, ang);
    if (!spot) continue;
    layers.push(`<text transform="translate(${spot[0].toFixed(1)},${spot[1].toFixed(1)}) rotate(${ang.toFixed(1)})"
      text-anchor="middle" font-size="${MAP_TEXT}" font-weight="700" fill="${RED()}">${txt}</text>`);
  }

  // corner levels from contours (IDW of the two nearest distinct elevations)
  const rlOf = (lon: number, lat2: number): number | null => {
    const P = lonLatToMercator({ lon, lat: lat2 });
    const found: { e: number; d: number }[] = [];
    for (const c of sb.contours) {
      let dMin = Infinity;
      for (let i = 0; i < c.coords.length; i += 2) {
        const Q = lonLatToMercator({ lon: c.coords[i][0], lat: c.coords[i][1] });
        const d = Math.hypot(Q.x - P.x, Q.y - P.y);
        if (d < dMin) dMin = d;
      }
      const prev = found.find((f) => f.e === c.elevation);
      if (prev) { if (dMin < prev.d) prev.d = dMin; }
      else found.push({ e: c.elevation, d: dMin });
    }
    found.sort((a, b) => a.d - b.d);
    if (!found.length) return null;
    if (found.length === 1 || found[0].d < 1) return found[0].e;
    const [f1, f2] = found;
    return (f1.e / f1.d + f2.e / f2.d) / (1 / f1.d + 1 / f2.d);
  };
  const cornerRls: { i: number; rl: number }[] = [];
  for (const i of corners) {
    const rl = rlOf(sb.siteRing[i][0], sb.siteRing[i][1]);
    if (rl != null) cornerRls.push({ i, rl });
  }
  for (const { i, rl } of cornerRls) {
    const [x, y] = ringPx[i];
    const ox = x - centroidPx[0], oy = y - centroidPx[1];
    const on = Math.hypot(ox, oy) || 1;
    const txt = `RL ${rl.toFixed(2)}`;
    const spot = placer.place(x + (ox / on) * 10, y + (oy / on) * 10 - 3.5, txt.length * 3.1, 6.4, 18);
    if (!spot) continue;
    layers.push(plainText(spot[0], spot[1], [txt], MAP_TEXT, RED()));
  }

  // fall arrow: highest -> lowest corner
  let fallInfo: { drop: number; angDeg: number } | null = null;
  if (cornerRls.length >= 2) {
    const hi = cornerRls.reduce((a, b) => (b.rl > a.rl ? b : a));
    const lo = cornerRls.reduce((a, b) => (b.rl < a.rl ? b : a));
    if (hi.i !== lo.i && hi.rl - lo.rl >= 0.3) {
      const [ax, ay] = ringPx[hi.i], [bx, by] = ringPx[lo.i];
      const ang = Math.atan2(by - ay, bx - ax);
      const shrink = 8;
      const sxp = ax + Math.cos(ang) * shrink, syp = ay + Math.sin(ang) * shrink;
      const exp = bx - Math.cos(ang) * shrink, eyp = by - Math.sin(ang) * shrink;
      layers.push(`<g stroke="${BLUE()}" fill="none" stroke-width="0.8">
        <line x1="${sxp.toFixed(1)}" y1="${syp.toFixed(1)}" x2="${exp.toFixed(1)}" y2="${eyp.toFixed(1)}" stroke-dasharray="4,1.6"/>
        <path d="M${(exp - Math.cos(ang - 0.42) * 4).toFixed(1)},${(eyp - Math.sin(ang - 0.42) * 4).toFixed(1)} L${exp.toFixed(1)},${eyp.toFixed(1)} L${(exp - Math.cos(ang + 0.42) * 4).toFixed(1)},${(eyp - Math.sin(ang + 0.42) * 4).toFixed(1)}"/></g>`);
      let ta = (ang * 180) / Math.PI;
      if (ta > 90) ta -= 180;
      if (ta < -90) ta += 180;
      fallInfo = { drop: hi.rl - lo.rl, angDeg: ta };
    }
  }

  // (5) Site info on the fall diagonal: FALL + AREA, as in the references.
  {
    const ptsM = sb.siteRing.map(([lon, lat2]) => lonLatToMercator({ lon, lat: lat2 }));
    let a = 0;
    for (let i = 0; i < ptsM.length - 1; i++) a += ptsM[i].x * ptsM[i + 1].y - ptsM[i + 1].x * ptsM[i].y;
    const areaM2 = Math.abs(a / 2) / (k * k);
    const areaTxt = `AREA ${areaM2.toLocaleString('en-AU', { maximumFractionDigits: 0 })} m²`;
    const fallTxt = fallInfo ? `FALL ${fallInfo.drop.toFixed(2)}m` : null;
    const lines = fallTxt ? [fallTxt, areaTxt] : [areaTxt];
    const ang = fallInfo ? fallInfo.angDeg : 0;
    const fs = MAP_TEXT, lh = fs * 1.12;
    const w = Math.max(...lines.map((t) => t.length)) * fs * 0.55 + 4;
    const h = lines.length * lh + 2;
    layers.push(`<g transform="translate(${centroidPx[0].toFixed(1)},${centroidPx[1].toFixed(1)}) rotate(${ang.toFixed(1)})">
      <rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffffff" fill-opacity="0.9"/>
      ${lines.map((t, i) => `<text x="0" y="${(-h / 2 + 1 + lh * (i + 0.8)).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${BLUE()}">${esc(t)}</text>`).join('')}
    </g>`);
  }

  // ---- sun path -------------------------------------------------------------
  {
    const latR = (Math.abs(lat) * Math.PI) / 180;
    const dec = (23.44 * Math.PI) / 180;
    const azOf = (d: number) => (Math.acos(Math.sin(d) / Math.cos(latR)) * 180) / Math.PI;
    const winterAz = azOf(dec);      // ≈61° at Sydney (NE), sun over north
    const summerAz = azOf(-dec);     // ≈119° (ESE)
    const Ro = Math.min(MAP_W, MAP_H) * 0.42;
    const Ri = Ro * 0.72;
    const c: Pt = centroidPx;
    const pt = (az: number, R: number): Pt => {
      const azr = ((az + view.rotationDeg) * Math.PI) / 180;
      return [c[0] + R * Math.sin(azr), c[1] - R * Math.cos(azr)];
    };
    const arc = (azRise: number, R: number): string => {
      let d = '';
      for (let az = azRise; az >= -azRise; az -= 4) {
        const [x, y] = pt(az, R);
        d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      return d;
    };
    layers.push(`<path d="${arc(summerAz, Ro)}" fill="none" stroke="${SUN()}" stroke-width="0.9" opacity="0.85"/>`);
    layers.push(`<path d="${arc(winterAz, Ri)}" fill="none" stroke="${SUN()}" stroke-width="0.9" opacity="0.85" stroke-dasharray="5,2.4"/>`);
    const sun = (az: number, R: number, l1: string, l2: string) => {
      const [x, y] = pt(az, R);
      const SUN_R = 10.7;                   // 21.4mm disc on the reference
      const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => {
        const ar = (a * Math.PI) / 180;
        return `<line x1="${(SUN_R * Math.cos(ar)).toFixed(1)}" y1="${(SUN_R * Math.sin(ar)).toFixed(1)}" x2="${((SUN_R + 7) * Math.cos(ar)).toFixed(1)}" y2="${((SUN_R + 7) * Math.sin(ar)).toFixed(1)}" stroke="${SUN()}" stroke-width="1.5" stroke-linecap="round"/>`;
      }).join('');
      return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        ${rays}<circle r="${SUN_R}" fill="${SUN()}"/>
        <text text-anchor="middle" dy="-0.6" font-size="${SUN_TEXT}" font-weight="700" fill="#000">${l1}</text>
        <text text-anchor="middle" dy="${SUN_TEXT}" font-size="${SUN_TEXT}" font-weight="700" fill="#000">${l2}</text></g>`;
    };
    layers.push(sun(winterAz, Ri, 'W', 'AM'));
    layers.push(sun(-winterAz, Ri, 'W', 'PM'));
    layers.push(sun(summerAz, Ro, 'S', 'AM'));
    layers.push(sun(-summerAz, Ro, 'S', 'PM'));
    const [nx, ny] = pt(0, Ro);
    layers.push(`<g transform="translate(${nx.toFixed(1)},${ny.toFixed(1)})">
      <circle r="10.7" fill="${SUN()}"/>
      <text text-anchor="middle" dy="3.1" font-size="${SUN_TEXT}" font-weight="700" fill="#000">N</text></g>`);
  }

  // ---- prevailing wind banners ----------------------------------------------
  {
    // Banner arrow points toward the site; when that direction would put the
    // text upside-down, keep the text upright and mirror only the arrow tip.
    const banner = (x: number, y: number, text: string) => {
      let ang = (Math.atan2(MAP_H / 2 - y, MAP_W / 2 - x) * 180) / Math.PI;
      let tipRight = true;
      if (ang > 90 || ang < -90) { ang += 180; tipRight = false; }
      if (ang > 180) ang -= 360;
      const W = text.length * 3.3 + 22, H = 14;
      const tip = tipRight
        ? `M${(-W / 2).toFixed(1)},${-H / 2} L${(W / 2 - 6).toFixed(1)},${-H / 2} L${(W / 2).toFixed(1)},0 L${(W / 2 - 6).toFixed(1)},${H / 2} L${(-W / 2).toFixed(1)},${H / 2} Z`
        : `M${(W / 2).toFixed(1)},${-H / 2} L${(-W / 2 + 6).toFixed(1)},${-H / 2} L${(-W / 2).toFixed(1)},0 L${(-W / 2 + 6).toFixed(1)},${H / 2} L${(W / 2).toFixed(1)},${H / 2} Z`;
      return `<g transform="translate(${x},${y}) rotate(${ang.toFixed(1)})">
        <path d="${tip}" fill="#ffffff" fill-opacity="0.92" stroke="${WINDBLUE()}" stroke-width="1.4"/>
        <text text-anchor="middle" dy="1.8" font-size="${MAP_TEXT}" font-weight="700" fill="${WINDBLUE()}">${esc(text)}</text>
      </g>`;
    };
    layers.push(banner(MAP_W - 95, 55, 'NE SUMMER SEA BREEZE'));
    layers.push(banner(MAP_W - 85, MAP_H - 75, 'S & SE COOL SUMMER WIND'));
    layers.push(banner(90, MAP_H - 60, 'W & SW WINTER WINDS'));
  }

  // View labels last, over everything.
  layers.push(viewText.join(''));

  // ---- legend ------------------------------------------------------------------
  let legendSvg = '';
  let ly = 7;
  const row = (swatch: string, label: string, sub?: string) => {
    let r2 = `<g transform="translate(0,${ly})">${swatch}`;
    wrapLabel(label, 26).forEach((l, i) => {
      r2 += `<text x="${LABEL_X}" y="${3.5 + i * 3.2}" font-size="${T.legend}" fill="#222">${esc(l)}</text>`;
    });
    if (sub) r2 += `<text x="${LABEL_X}" y="6.7" font-size="${T.legend * 0.85}" fill="#555">${esc(sub)}</text>`;
    legendSvg += r2 + '</g>';
    ly += 10;
  };
  const mid = SWATCH_X + SWATCH_W / 2;
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${RED()}" stroke-width="0.9" stroke-dasharray="4.5,1.5,1,1.5"/>`, 'SITE');
  row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${BLUE()}" stroke-width="0.8" stroke-dasharray="4,1.6"/><path d="M${SWATCH_X + SWATCH_W - 4},1.2 L${SWATCH_X + SWATCH_W},3.2 L${SWATCH_X + SWATCH_W - 4},5.2" fill="none" stroke="${BLUE()}" stroke-width="0.8"/>`, 'FALL OF TERRAIN');
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${RED()}">SB 30.48</text>`, 'BOUNDARY DIMENSION (m)');
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${RED()}">RL 24.5</text>`, 'SURFACE LEVEL (AHD)');
  if (sb.contours.length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#a07c3f" stroke-width="0.6"/><text x="${SWATCH_X + 1}" y="2.2" font-size="2.2" font-weight="700" fill="#8a6a2f">RL 20</text>`, `CONTOURS AT ${sb.contourIntervalM ?? 2} m AHD`, sb.contourSource);
  row(`<g><rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="#fff" stroke="#bbb" stroke-width="0.2"/><text x="${SWATCH_X + SWATCH_W / 2}" y="2.8" text-anchor="middle" font-size="2" font-weight="700" fill="#111">8 LEVUKA ST</text><text x="${SWATCH_X + SWATCH_W / 2}" y="5.2" text-anchor="middle" font-size="2" font-weight="700" fill="${BLUE()}">R3 MEDIUM</text></g>`, 'NEIGHBOUR: ADDRESS, STOREYS, ZONE');
  if (bayCount) {
    const quads = Array.from({ length: 4 }, (_, i) => `<rect x="${(SWATCH_X + i * 5.6).toFixed(1)}" y="1.2" width="5.6" height="4.4" fill="${PARK}" fill-opacity="0.35" stroke="${PARK_INK}" stroke-width="0.3"/>`).join('');
    const kinds = [...orientations].map((o) => BAY_LABEL[o]).join(', ');
    row(`<g>${quads}</g>`, 'STREET PARKING BAYS', `${bayCount} bays, ${kinds}, from OSM tags`);
  }
  if (carParks.length || mappedBays.length) row(`<rect x="${SWATCH_X}" y="0.5" width="${SWATCH_W}" height="5.5" fill="${PARK}" fill-opacity="0.18" stroke="${PARK_INK}" stroke-width="0.5"/>`, 'CAR PARK', 'dashed: multi-storey or basement');
  if (sb.furniture.driveways.length) row(`<path d="M${mid - 3.6},1.4 L${mid + 3.6},1.4 L${mid},6 Z" fill="#f5e400" stroke="#c9bb00" stroke-width="0.3"/>`, 'VEHICULAR ACCESS');
  if (sb.roads.some((r) => r.lanes)) row(`<g transform="translate(${mid},3.2)"><path d="M-1.6,3 L-1.6,-2.6 M-2.6,-1 L-1.6,-3 L-0.6,-1" fill="none" stroke="#555" stroke-width="0.5"/><path d="M1.6,-3 L1.6,2.6 M0.6,1 L1.6,3 L2.6,1" fill="none" stroke="#555" stroke-width="0.5"/></g>`, 'TRAFFIC DIRECTION AND LANES');
  if (treeStats.measured + treeStats.estimated + treeStats.nominal) {
    const sub = treeStats.nominal && (treeStats.measured || treeStats.estimated)
      ? `solid: recorded size · dashed: nominal ${NOMINAL_CANOPY_M} m`
      : treeStats.nominal ? `nominal ${NOMINAL_CANOPY_M} m canopy, not measured` : 'recorded canopy';
    row(`<circle cx="${mid}" cy="3.2" r="2.8" fill="#7dbb57" fill-opacity="0.45" stroke="#4e8c33" stroke-width="0.4"/><circle cx="${mid}" cy="3.2" r="0.5" fill="#2f5e20"/>`, 'TREES, CANOPY TO SCALE', sub);
  }
  if ((sb.views ?? []).some((v) => v.cone)) {
    row(`<path d="M${SWATCH_X},3.2 L${SWATCH_X + SWATCH_W},0.4 L${SWATCH_X + SWATCH_W},6 Z" fill="#ffffff" stroke="#8a8a8a" stroke-width="0.3"/>`, 'POTENTIAL VIEW', `terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up; no buildings`);
  }
  if (sb.furniture.powerPoles.length) row(`<g transform="translate(${mid},3.2)"><line x1="-2.4" y1="0" x2="2.4" y2="0" stroke="#333" stroke-width="0.4"/><circle r="1.2" fill="none" stroke="#333" stroke-width="0.45"/></g>`, 'POWER POLE');
  if (sb.furniture.streetLamps.length) row(`<circle cx="${mid}" cy="3.2" r="1.4" fill="#f0c020" stroke="#a8860b" stroke-width="0.3"/>`, 'LIGHT POLE');
  if (sb.furniture.hydrants.length) row(`<circle cx="${mid}" cy="3.2" r="1.8" fill="#1f78d1"/>`, 'HYDRANT');
  if (sb.busStops.length) row(`<g transform="translate(${mid},3.2)"><circle r="3.4" fill="#fff" stroke="#2f7fd6" stroke-width="0.8"/><text text-anchor="middle" dy="1.9" font-size="5.7" font-weight="700" fill="#2f7fd6">B</text></g>`, 'BUS STOPS');
  if (sb.furniture.onewayRoads.length) row(`<path d="M${SWATCH_X},3.2 L${SWATCH_X + SWATCH_W - 4},3.2 M${SWATCH_X + SWATCH_W - 7},1.4 L${SWATCH_X + SWATCH_W - 4},3.2 L${SWATCH_X + SWATCH_W - 7},5" fill="none" stroke="#8a8a8a" stroke-width="1.0"/>`, 'TRAFFIC DIRECTION');
  row(`<path d="M${SWATCH_X},4.5 ${Array.from({ length: 6 }, (_, i) => `L${(SWATCH_X + 2 + i * 4).toFixed(1)},${i % 2 ? 4.5 : 1.9}`).join(' ')}" fill="none" stroke="#3b4fd8" stroke-width="0.5"/>`, 'NOISE SOURCE');
  row(`<g transform="translate(${mid},3.2)"><path d="M-9,-3 L5,-3 L9,0 L5,3 L-9,3 Z" fill="#fff" stroke="${WINDBLUE()}" stroke-width="0.8"/></g>`, 'PREVAILING BREEZES');
  row(`<g transform="translate(${mid},3.2)"><circle r="3.2" fill="${SUN()}"/><text text-anchor="middle" dy="1.2" font-size="3.2" font-weight="700" fill="#000">W</text></g>`, 'WINTER SUN (AM/PM)');
  row(`<g transform="translate(${mid},3.2)"><circle r="3.2" fill="${SUN()}"/><text text-anchor="middle" dy="1.2" font-size="3.2" font-weight="700" fill="#000">S</text></g>`, 'SUMMER SUN (AM/PM)');

  const utilKinds = new Set(sb.furniture.utilities.map((u) => u.kind));
  if (utilKinds.has('power')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#f2c200" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'POWER LINES');
  if (utilKinds.has('water')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#2f7fd6" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'WATER MAIN');
  if (utilKinds.has('sewer')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#7db87d" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'SEWER MAIN');
  if (utilKinds.has('gas')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#e6007e" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'GAS MAIN');

  return sheetHtml({
    meta,
    address: sb.address,
    generatedAt: sb.generatedAt,
    siteAddress: sb.geocode.matchedAddresses[0] ?? sb.address,
    scale: sb.scale,
    rotationDeg: view.rotationDeg,
    drawingTitle: 'SITE ANALYSIS',
    legendHeading: 'LEGEND',
    legendSvg,
    layers,
    dataNote: sb.attributions?.length ? sb.attributions.join(' · ') : undefined,
  });
}

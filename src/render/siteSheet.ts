// Composes the A1 SITE ANALYSIS sheet: site boundary with dimensions and
// levels, fall of terrain, sun path, prevailing winds, neighbours and street
// furniture — matching the office's DA 004 / SSDA 005 reference sheets.

import type { SiteBundle } from '../pipeline.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import {
  makeProjector, plainText, haloText, wrapLabel, shortStreetName,
  pathFromRings, geomRings, textureSvg, type Pt, type SheetMeta,
} from './sheet.js';
import { catById, zoneToCategory } from './model.js';
import { METRES_PER_STOREY } from '../fetch/buildings.js';
import { sheetHtml, esc, T, SWATCH_X, SWATCH_W, LABEL_X, MAP_W, MAP_H } from './chrome.js';
import { tpl } from './template.js';
import { exitPoint } from '../fetch/views.js';
import { NOMINAL_CANOPY_M } from '../fetch/trees.js';
import { buildParkingBands, type Orientation } from '../lib/parking.js';
import { levelAt, type ContourM } from '../lib/levels.js';

// Parking, in the office's plum.
const PARK = '#9b5b6e';
const PARK_INK = '#7a3c50';
const BAY_LABEL: Record<Orientation, string> = { parallel: '6.0 m parallel', diagonal: '45° angle', perpendicular: '90°' };

// One uniform bold size for all map text on this sheet. Exceptions: street
// names on the white arrows (wide-spaced, set separately) and the neighbour
// identification boxes (a step smaller).
const MAP_TEXT = 6.2;
const NEIGHBOUR_TEXT = MAP_TEXT;
// The neighbours' numbers and the street names: white, read off the aerial.
const NAME_GREEN = '#ffffff';
// Contours in green, apart from the warm site pen and the zones' hatch.
const CONTOUR = '#3f9a5c';
// The site itself — its boundary, corners, dimensions and levels — in a deep
// red, apart from the coral pen of the sun, wind and views.
const SITE_RED = '#b3261e';
// Noise in blue, so it reads apart from the coral climate marks.
const NOISE_BLUE = '#3f6fc2';

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
  /** Whether a box is clear of everything reserved so far, without reserving it. */
  isFree(x: number, y: number, w: number, h: number): boolean { return this.free(x, y, w, h); }
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

/**
 * The sheet's hand-drawn arrow: a white strip in the site pen that leaves
 * (x, y) along the unit direction (ux, uy), bows gently to one side and widens
 * as it goes, ending in a broad head. `bow` signs which side it bows to.
 */
function sketchArrow(x: number, y: number, ux: number, uy: number, L: number, bow = 2.2, w0 = 1.4, w1 = 4.4): string {
  const nx = -uy, ny = ux;
  const N = 24, headL = 11, body = L - headL, headW = w1 * 2;
  const left: string[] = [], right: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const off = bow * Math.sin(t * Math.PI);
    const cx = x + ux * body * t + nx * off, cy = y + uy * body * t + ny * off;
    const w = w0 + (w1 - w0) * t;
    left.push(`${(cx + nx * w).toFixed(2)},${(cy + ny * w).toFixed(2)}`);
    right.push(`${(cx - nx * w).toFixed(2)},${(cy - ny * w).toFixed(2)}`);
  }
  const ex = x + ux * body, ey = y + uy * body;
  const tip = [ex + ux * headL, ey + uy * headL];
  const wing = (sgn: number) => `${(ex + nx * headW * sgn).toFixed(2)},${(ey + ny * headW * sgn).toFixed(2)}`;
  return `M${left.join('L')}L${wing(1)}L${tip[0].toFixed(2)},${tip[1].toFixed(2)}L${wing(-1)}L${right.reverse().join('L')}Z`;
}

/**
 * The sun's bearing (degrees clockwise from north) and whether it is up, at a
 * solar hour on a solstice: `decDeg` +23.44 for 21 June, −23.44 for 21 December.
 */
function sunBearing(latDeg: number, decDeg: number, hour: number): { az: number; up: boolean } {
  const phi = (latDeg * Math.PI) / 180, dec = (decDeg * Math.PI) / 180;
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const up = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H) > 0.02;
  let az = (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * 180) / Math.PI + 180;
  if (az > 180) az -= 360;
  return { az, up };
}

/** Hour marks for the two solstice arcs: which hours, at what bearing, labelled how. */
function solsticeHours(latDeg: number): { winter: { h: number; az: number; label: string }[]; summer: { h: number; az: number; label: string }[] } {
  // Winter is the solstice with the sun lower: June in the south, December in the north.
  const winterDec = latDeg < 0 ? 23.44 : -23.44;
  const fmt = (h: number) => (h < 12 ? `${h}AM` : h === 12 ? '12PM' : `${h - 12}PM`);
  const marks = (dec: number) => {
    const out: { h: number; az: number; label: string }[] = [];
    for (let h = 5; h <= 19; h++) {
      const b = sunBearing(latDeg, dec, h);
      if (b.up) out.push({ h, az: b.az, label: fmt(h) });
    }
    return out;
  };
  return { winter: marks(winterDec), summer: marks(-winterDec) };
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

  // ---- zones as hatch, not words ---------------------------------------------
  // The neighbours' zoning is drawn, not written: each zone a hatch in its
  // family's ink with a fine outline, no fill, so the aerial stays readable
  // under it. The pattern is the category's texture (lines where it has
  // none), its strength the category's, so R2 sits lighter than R3. Never
  // over the site.
  const usedZoneCats = new Set<string>();
  const zoneInk = (c: { fill: string; stroke?: string; figure?: string; textureColor?: string }) =>
    c.figure ?? c.stroke ?? c.fill;
  {
    const ring = sb.siteRing.map(([lon, lat2]) => proj(lon, lat2));
    const dHole = 'M' + ring.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z';
    const byCat = new Map<string, string[]>();
    for (const f of sb.zoning.features) {
      const cat = zoneToCategory(f.properties.SYM_CODE);
      if (!cat || !catById()[cat]) continue;
      const rings = geomRings(f.geometry);
      if (!rings.length) continue;
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(pathFromRings(rings, proj));
    }
    let tex = 0;
    const mapBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    const parts: string[] = [];
    for (const [cat, paths] of byCat) {
      const c = catById()[cat];
      usedZoneCats.add(cat);
      const ink = zoneInk(c);
      const kind = c.texture === 'dots' || c.texture === 'cross' ? c.texture : 'lines';
      parts.push(textureSvg(`stx${tex++}`, paths.join(''), kind, ink, mapBox, Math.min(1, 0.65 + c.opacity * 0.5)));
      parts.push(`<g fill="none" stroke="${ink}" stroke-width="0.6">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`);
    }
    layers.push(`<defs><clipPath id="notSite"><path clip-rule="evenodd" d="M-20,-20 H${MAP_W + 20} V${MAP_H + 20} H-20 Z ${dHole}"/></clipPath></defs>
      <g clip-path="url(#notSite)">${parts.join('')}</g>`);
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
    // The sun path is centred on the site, not the sheet.
    const sr = sb.siteRing.map(([lon, lat2]) => proj(lon, lat2));
    const sn = Math.max(1, sr.length - 1);
    const cx = sr.slice(0, sn).reduce((t, p) => t + p[0], 0) / sn;
    const cy = sr.slice(0, sn).reduce((t, p) => t + p[1], 0) / sn;
    const at = (az: number, R: number): Pt => {
      const azr = ((az + view.rotationDeg) * Math.PI) / 180;
      return [cx + R * Math.sin(azr), cy - R * Math.cos(azr)];
    };
    // The suns sit at the solstices' rise and set points, with their names under them.
    for (const [az, R] of [[azOf(dec), Ri], [-azOf(dec), Ri], [azOf(-dec), Ro], [-azOf(-dec), Ro], [0, Ro + 24]] as [number, number][]) {
      const [x, y] = at(az, R);
      placer.reserve(x, y + 6, 48, 58);
    }
    // And the hours along the arcs.
    const hrs = solsticeHours(lat);
    for (const m of hrs.winter) { const [x, y] = at(m.az, Ri); placer.reserve(x, y, 12, 12); const [lx, ly] = at(m.az, Ri - 10); placer.reserve(lx, ly, 18, 9); }
    for (const m of hrs.summer) { const [x, y] = at(m.az, Ro); placer.reserve(x, y, 12, 12); const [lx, ly] = at(m.az, Ro + 10); placer.reserve(lx, ly, 18, 9); }
    placer.reserve(MAP_W - 95, 55, 110, 20);
    placer.reserve(MAP_W - 85, MAP_H - 75, 120, 20);
    placer.reserve(90, MAP_H - 60, 110, 20);
  }

  // ---- potential views ------------------------------------------------------
  // Drawn in the sun and wind's hand: for each sight line the ground does not
  // block, a telescope just outside the site edge, aimed along the bearing,
  // with the view's name set beside it in the same lettering. It goes under
  // the linework; its label is pushed last so nothing covers it.
  const viewText: string[] = [];
  {
    const centreLL = mercatorToLonLat({ x: view.cx, y: view.cy });
    const LETTER = MAP_TEXT;
    const TS = 2.8;                            // the telescope's size on paper
    for (const v of sb.views ?? []) {
      if (!v.cone) continue;
      const apex = exitPoint(sb.siteRing, centreLL, v.bearingDeg);
      const [ax, ay] = proj(apex.lon, apex.lat);
      const ang = ((v.bearingDeg + view.rotationDeg) * Math.PI) / 180;
      const ux = Math.sin(ang), uy = -Math.cos(ang);
      // The tube runs from x = -9.6 (eyepiece) to 8.6 (objective) in its own
      // units; its eyepiece end sits a few millimetres off the boundary.
      const sx = ax + ux * (9.6 * TS + 4), sy = ay + uy * (9.6 * TS + 4);
      const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
      layers.push(`<g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${TS})" stroke="${RED()}" stroke-width="${(0.7 / TS).toFixed(3)}" stroke-linejoin="round" fill="#ffffff">
        <path d="M-7,-1.7 L6,-2.6 L6,2.6 L-7,1.7 Z"/>
        <rect x="6" y="-3.3" width="2.6" height="6.6" rx="0.6"/>
        <rect x="-9.6" y="-1.2" width="2.6" height="2.4" rx="0.4"/>
        <line x1="-2" y1="-2.1" x2="-2" y2="2.1"/>
        <line x1="2" y1="-2.4" x2="2" y2="2.4"/></g>`);
      const lines = wrapLabel(v.kind === 'park' ? `${v.label} OUTLOOK` : `${v.label} VIEW`, 16);
      const dist = v.distanceM >= 950 ? `${(v.distanceM / 1000).toFixed(1)} KM` : `${Math.round(v.distanceM / 10) * 10} M`;
      const sub = v.kind === 'park' ? 'ADJOINING' : `${dist} · TERRAIN CLEAR`;
      const lh = LETTER * 1.12;
      // The telescope claims its ground, then the name settles right beside
      // its objective end.
      const w = Math.max(...lines.map((l) => l.length), sub.length) * LETTER * 0.5 + 4;
      const h = (lines.length + 1) * lh + 2;
      const reach = 8.6 * TS + 3 + (Math.abs(ux) * w + Math.abs(uy) * h) / 2;
      const lx = sx + ux * reach, ly = sy + uy * reach;
      const spot = placer.place(lx, ly, w, h, 40) ?? [lx, ly];
      for (let d = -9.6; d <= 8.6; d += 4) placer.reserve(sx + ux * d * TS, sy + uy * d * TS, 12, 12);
      const [tx, ty] = spot;
      const y0 = ty - (lines.length * lh) / 2 + LETTER * 0.36;
      viewText.push(lines.map((t, i) => `<text x="${tx.toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${RED()}" stroke="${RED()}" stroke-width="0.22">${esc(t)}</text>`).join(''));
      viewText.push(`<text x="${tx.toFixed(1)}" y="${(y0 + lines.length * lh).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${RED()}" stroke="${RED()}" stroke-width="0.22">${esc(sub)}</text>`);
    }
  }

  // ---- cadastre + contours -------------------------------------------------
  if (sb.allLots.features.length) {
    const d = sb.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.7" opacity="0.9"/>`);
  }
  // (2) Terrain: contour lines with elevation tags (RL m AHD) along them.
  if (sb.contours.length) {
    const d = sb.contours.map((c) => pathFromRings([c.coords as any], proj, false)).join('');
    layers.push(`<path d="${d}" fill="none" stroke="${CONTOUR}" stroke-width="0.6" opacity="0.9"/>`);
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
        fill="${CONTOUR}">RL ${c.elevation.toFixed(0)}</text>`);
    }
  }

  // ---- noise sources: along the main roads and the railway --------------------
  // In blue, so noise reads apart from the coral climate marks, but drawn
  // like the wind: a continuous white band in a blue pen beside each busy
  // road and the railway, on the site's side.
  const noiseRing = sb.siteRing.map(([lon, lat2]) => proj(lon, lat2));
  const noiseCentre: Pt = (() => {
    const n = Math.max(1, noiseRing.length - 1);
    return [noiseRing.slice(0, n).reduce((t, p) => t + p[0], 0) / n, noiseRing.slice(0, n).reduce((t, p) => t + p[1], 0) / n];
  })();
  const inSiteRing = (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = noiseRing.length - 1; i < noiseRing.length; j = i++) {
      const [xi, yi] = noiseRing[i], [xj, yj] = noiseRing[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const noiseMarks: string[] = [];
  // One continuous band beside the source, on the side facing the site, drawn
  // like the wind arrows: white inside a blue pen, its width swelling and
  // pinching irregularly as it runs. The road's line is resampled every
  // 0.8 mm and set off 10 mm toward the site; the band breaks where it would
  // cross the site or leave the sheet.
  const soundAlong = (pts: Pt[], seed: number) => {
    const samples: { p: Pt; n: Pt; s: number }[] = [];
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let d = 0; d < len; d += 0.8) samples.push({ p: [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len], n: [nx, ny], s: run + d });
      run += len;
    }
    if (samples.length < 2) return;
    const mid = samples[Math.floor(samples.length / 2)];
    const side = Math.sign((noiseCentre[0] - mid.p[0]) * mid.n[0] + (noiseCentre[1] - mid.p[1]) * mid.n[1]) || 1;
    // Irregular but smooth: two incommensurate waves, so it swells and pinches
    // without quite repeating.
    const half = (t: number) => 3.4 + 2.0 * Math.sin(t / 9.5 + seed) + 0.9 * Math.sin(t / 4.6 + seed * 2.1);
    const sway = (t: number) => 1.6 * Math.sin(t / 11 + seed * 1.3);
    let left: string[] = [], right: string[] = [];
    const flush = () => {
      if (left.length > 3) noiseMarks.push(`M${left.join('L')}L${right.reverse().join('L')}Z`);
      left = []; right = [];
    };
    for (const { p, n, s: t } of samples) {
      const c = side * 11 + sway(t);
      const cx = p[0] + n[0] * c, cy = p[1] + n[1] * c;
      if (!inMap([cx, cy]) || inSiteRing(cx, cy)) { flush(); continue; }
      const w = Math.max(0.8, half(t));
      left.push(`${(cx + n[0] * w).toFixed(2)},${(cy + n[1] * w).toFixed(2)}`);
      right.push(`${(cx - n[0] * w).toFixed(2)},${(cy - n[1] * w).toFixed(2)}`);
    }
    flush();
  };
  const mainRoads = sb.roads.filter((r) => r.hierarchy <= 4);
  const seenNoise = new Set<string>();
  for (const r of mainRoads) {
    if (seenNoise.has(r.name)) continue; // one run of marks per named road
    seenNoise.add(r.name);
    const pts = r.coords.map(([lon, lat2]) => proj(lon, lat2));
    if (pts.length >= 2) soundAlong(pts, seenNoise.size * 1.7);
  }
  // Railways are noise sources too — the longest line stands in for the
  // whole track group.
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
    if (pts.length >= 2) soundAlong(pts, 4.2);
  }
  layers.push(`<path d="${noiseMarks.join('')}" fill="#ffffff" fill-opacity="0.85" stroke="${NOISE_BLUE}" stroke-width="0.7" stroke-linejoin="round"/>`);

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

  // ---- neighbours: the address and the storeys on each building ------------
  // Two short lines on the building: its street number(s) and its storeys,
  // "26" over "3ST". The zone is the hatch under it. Storeys come from
  // Overture (its count, or its measured height at 3.1 m a storey), else
  // OpenStreetMap's building:levels; a building with no height anywhere
  // keeps its number and no storey line rather than a guess. A building with
  // a height but no address point still gets its storeys.
  let storeyLabels = 0;
  {
    const osmLevelsNear = (lon: number, lat2: number, withinM: number): number | undefined => {
      const P = lonLatToMercator({ lon, lat: lat2 });
      let best: number | undefined, bestD = withinM * k;
      for (const b of sb.furniture.buildings) {
        if (!b.levels) continue;
        const Q = lonLatToMercator({ lon: b.lon, lat: b.lat });
        const d = Math.hypot(Q.x - P.x, Q.y - P.y);
        if (d < bestD) { bestD = d; best = b.levels; }
      }
      return best;
    };
    const m2PerMm2 = (sb.scale / 1000) ** 2;
    interface Bld { x: number; y: number; st?: number; area: number; d: string; ring: Pt[]; bbox: [number, number, number, number]; numbers: string[] }
    const blds: Bld[] = [];
    for (const b of sb.buildings?.buildings ?? []) {
      const [x, y] = proj(b.centroid[0], b.centroid[1]);
      if (!inMapWide([x, y]) || inSite(x, y)) continue;
      const ring = b.rings[0].map(([lon, lat2]) => proj(lon, lat2));
      let a2 = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a2 += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
        x0 = Math.min(x0, ring[i][0]); y0 = Math.min(y0, ring[i][1]); x1 = Math.max(x1, ring[i][0]); y1 = Math.max(y1, ring[i][1]);
      }
      const area = Math.abs(a2 / 2) * m2PerMm2;
      if (area < 25) continue;   // sheds and carports
      const st = b.floors ?? (b.heightM ? Math.max(1, Math.round(b.heightM / METRES_PER_STOREY)) : osmLevelsNear(b.centroid[0], b.centroid[1], 12));
      blds.push({ x, y, st, area, d: pathFromRings(b.rings, proj), ring, bbox: [x0, y0, x1, y1], numbers: [] });
    }
    const inRing = (x: number, y: number, r: Pt[]) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    // Each address point to the building it stands in, or the nearest one
    // within 12 m (address points often sit at the front of the lot).
    const near12 = 12 * k * (MAP_W / (2 * view.halfW));
    const loose: { x: number; y: number; n: string; st?: number }[] = [];
    for (const n of sb.neighbours) {
      const [x, y] = proj(n.lon, n.lat);
      if (!inMap([x, y]) || inSite(x, y)) continue;
      let hit = blds.find((b) => x >= b.bbox[0] && x <= b.bbox[2] && y >= b.bbox[1] && y <= b.bbox[3] && inRing(x, y, b.ring));
      if (!hit) {
        let bestD = near12;
        for (const b of blds) { const d = Math.hypot(b.x - x, b.y - y); if (d < bestD) { bestD = d; hit = b; } }
      }
      const num = n.housenumber.toUpperCase();
      if (hit) { if (!hit.numbers.includes(num)) hit.numbers.push(num); }
      else loose.push({ x, y, n: num, st: osmLevelsNear(n.lon, n.lat, 25) });
    }
    // "26", or "26–30" for a building with a run of numbers.
    const numberLine = (nums: string[]): string => {
      if (nums.length <= 1) return nums[0] ?? '';
      const ints = nums.map((t) => parseInt(t, 10));
      if (ints.every((v) => Number.isFinite(v))) {
        const lo = Math.min(...ints), hi = Math.max(...ints);
        return lo === hi ? String(lo) : `${lo}–${hi}`;
      }
      return nums[0];
    };
    interface Lbl { x: number; y: number; lines: [string, string]; area: number; d: string }
    const cands: Lbl[] = [];
    for (const b of blds) {
      if (!inMap([b.x, b.y])) continue;
      const num = numberLine(b.numbers);
      const st = b.st ? `${b.st}ST` : '';
      if (!num && !st) continue;
      cands.push({ x: b.x, y: b.y, lines: [num, st], area: b.area + (num ? 10000 : 0), d: b.d });
    }
    for (const l of loose) cands.push({ x: l.x, y: l.y, lines: [l.n, l.st ? `${l.st}ST` : ''], area: 5000, d: '' });
    // Addressed and big buildings first, so when two crowd each other the
    // block of flats keeps its label and the garage gives way.
    cands.sort((p, q) => q.area - p.area);
    const outlines: string[] = [];
    const texts: string[] = [];
    const fs = NEIGHBOUR_TEXT, lh = fs * 1.12;
    for (const c of cands) {
      const lines = c.lines.filter(Boolean);
      const w = Math.max(...lines.map((t) => t.length)) * fs * 0.5 + 1.5, h = lines.length * lh + 0.8;
      const spot = placer.place(c.x, c.y, w, h, 6);
      if (!spot) continue;
      if (c.d) outlines.push(`<path d="${c.d}"/>`);
      const y0 = spot[1] - ((lines.length - 1) * lh) / 2 + fs * 0.36;
      lines.forEach((t, i) => {
        const isStorey = /ST$/.test(t) && i === lines.length - 1 && !!c.lines[1];
        texts.push(`<text x="${spot[0].toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${NAME_GREEN}"${isStorey ? ' opacity="0.8"' : ''}>${esc(t)}</text>`);
      });
      if (c.lines[1]) storeyLabels++;
    }
    layers.push(`<g fill="none" stroke="#ffffff" stroke-width="0.55" stroke-opacity="0.95" stroke-linejoin="round">${outlines.join('')}</g>`);
    layers.push(texts.join(''));
  }

  // ---- street names: plain text along the road ------------------------------
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
    const SITE_STREET = MAP_TEXT;
    // Every street name as plain bold text along the road, no arrow band;
    // set on the straight chord through the middle of the longest run, since
    // a road's own vertices jog too much to carry text along directly.
    const plainLen = label.length * (SITE_STREET * 0.6 + 0.6) + 3;
    const pts = r.pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    if (total < plainLen) continue;
    const at = (d: number): Pt => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    const half = Math.min(total / 2, plainLen / 2 + 8);
    // Slide along the road, middle first, until the name is clear of the
    // labels already set (a view's name, a neighbour's number).
    let a: Pt | null = null, b: Pt | null = null;
    for (const k2 of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const c = total / 2 + k2 * 16;
      if (c - half < 0 || c + half > total) continue;
      let p0 = at(c - half), p1 = at(c + half);
      if (p0[0] > p1[0]) [p0, p1] = [p1, p0];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < plainLen) continue;
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      const ang2 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const W = Math.abs(plainLen * Math.cos(ang2)) + Math.abs(SITE_STREET * Math.sin(ang2));
      const H = Math.abs(plainLen * Math.sin(ang2)) + Math.abs(SITE_STREET * Math.cos(ang2));
      if (!placer.isFree(mx, my, W * 0.8, H * 0.8) && k2 !== 4 && k2 !== -4) continue;
      a = p0; b = p1;
      placer.reserve(mx, my, W * 0.8, H * 0.8);
      break;
    }
    if (!a || !b) continue;
    const id = `srd${srid++}`;
    siteRoadDefs.push(`<path id="${id}" d="M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}" fill="none"/>`);
    layers.push(`<text font-size="${SITE_STREET.toFixed(2)}" font-weight="700" letter-spacing="0.6" dy="${(SITE_STREET * 0.36).toFixed(2)}" fill="${NAME_GREEN}">
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
  layers.push(`<path d="${dSite}" fill="none" stroke="${SITE_RED}" stroke-width="1.15" stroke-dasharray="7,2,1.6,2"/>`);
  layers.push(corners.map((i) => `<circle cx="${ringPx[i][0].toFixed(1)}" cy="${ringPx[i][1].toFixed(1)}" r="1.7" fill="none" stroke="${SITE_RED}" stroke-width="0.55"/>`).join(''));

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
      text-anchor="middle" font-size="${MAP_TEXT}" font-weight="700" fill="${SITE_RED}">${txt}</text>`);
  }

  // Corner levels: interpolated across the slope between the contours that
  // bracket each corner (see lib/levels.ts), in ground metres.
  const groundM = (lon: number, lat2: number) => {
    const m = lonLatToMercator({ lon, lat: lat2 });
    return { x: m.x / k, y: m.y / k };
  };
  const contoursM: ContourM[] = sb.contours.map((c) => ({
    z: c.elevation, pts: c.coords.map(([lon, lat2]) => groundM(lon, lat2)),
  }));
  const rlOf = (lon: number, lat2: number): number | null =>
    levelAt(groundM(lon, lat2), contoursM, sb.contourIntervalM ?? 2);
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
    layers.push(plainText(spot[0], spot[1], [txt], MAP_TEXT, SITE_RED));
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

  // ---- sun and wind, one hand ---------------------------------------------------
  // Drawn as a pair, in the same coral pen and the same open white-filled
  // marks: the sun as a disc with flame-like rays at the solstices' rise and
  // set points (on a solid summer arc and a dashed winter one), the winds as
  // the sheet's hand-drawn arrows blowing in toward the site, three abreast,
  // each named in the same lettering as the suns.
  const latR = (Math.abs(lat) * Math.PI) / 180;
  const decR = (23.44 * Math.PI) / 180;
  const riseAz = (d: number) => (Math.acos(Math.sin(d) / Math.cos(latR)) * 180) / Math.PI;
  const winterAz = riseAz(decR);       // ≈61° at Sydney (NE), the sun over north
  const summerAz = riseAz(-decR);      // ≈119° (ESE)
  const Ro = Math.min(MAP_W, MAP_H) * 0.42;
  const Ri = Ro * 0.72;
  const sunAt = (az: number, R: number): Pt => {
    const azr = ((az + view.rotationDeg) * Math.PI) / 180;
    return [centroidPx[0] + R * Math.sin(azr), centroidPx[1] - R * Math.cos(azr)];
  };
  const arcPath = (az0: number, az1: number, R: number, step = 3): string => {
    let d = '';
    const n = Math.max(2, Math.ceil(Math.abs(az1 - az0) / step));
    for (let i = 0; i <= n; i++) {
      const [x, y] = sunAt(az0 + ((az1 - az0) * i) / n, R);
      d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  };
  const PEN = RED();
  const PEN_W = 0.7;
  const LETTER = MAP_TEXT;
  const textBlock = (x: number, y: number, lines: string[]) =>
    lines.map((t, i) => `<text x="${x.toFixed(1)}" y="${(y + i * LETTER * 1.12).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${PEN}" stroke="${PEN}" stroke-width="0.22">${esc(t)}</text>`).join('');

  layers.push(`<path d="${arcPath(summerAz, -summerAz, Ro)}" fill="none" stroke="${PEN}" stroke-width="1.4" stroke-linecap="round"/>`);
  layers.push(`<path d="${arcPath(winterAz, -winterAz, Ri)}" fill="none" stroke="${PEN}" stroke-width="1.4" stroke-dasharray="5,2.6" stroke-linecap="round"/>`);
  // The hours along each arc: a dot where the sun stands at each solar hour,
  // its time beside it (inside the winter arc, outside the summer one). An
  // hour that falls on a sunrise or sunset drawing is left to the sun.
  {
    const hrs = solsticeHours(lat);
    const marks: string[] = [];
    const put = (list: { az: number; label: string }[], R: number, labelR: number, edgeAz: number) => {
      for (const m of list) {
        if (Math.abs(Math.abs(m.az) - edgeAz) < 9) continue;
        const [x, y] = sunAt(m.az, R);
        const [lx, ly] = sunAt(m.az, labelR);
        marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#ffffff" stroke="${PEN}" stroke-width="${PEN_W}"/>` +
          `<text x="${lx.toFixed(1)}" y="${(ly + LETTER * 0.36).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${PEN}" stroke="${PEN}" stroke-width="0.22">${m.label}</text>`);
      }
    };
    put(hrs.winter, Ri, Ri - 10, winterAz);
    put(hrs.summer, Ro, Ro + 10, summerAz);
    layers.push(marks.join(''));
  }
  const sketchSun = ([x, y]: Pt, lines: string[]) => {
    const r0 = 10.5, r1 = 13.4, r2 = 21, n = 16;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const tipR = r2 - (i % 2) * 3.2;
      const p0 = [r1 * Math.cos(a0), r1 * Math.sin(a0)];
      const tip = [tipR * Math.cos(a1 + 0.07), tipR * Math.sin(a1 + 0.07)];
      const c0 = [(r1 + 3.6) * Math.cos(a1 - 0.11), (r1 + 3.6) * Math.sin(a1 - 0.11)];
      const p2 = [r1 * Math.cos(a2), r1 * Math.sin(a2)];
      const c1 = [(r1 + 2.2) * Math.cos(a1 + 0.2), (r1 + 2.2) * Math.sin(a1 + 0.2)];
      d += `${i ? 'L' : 'M'}${p0[0].toFixed(2)},${p0[1].toFixed(2)} Q${c0[0].toFixed(2)},${c0[1].toFixed(2)} ${tip[0].toFixed(2)},${tip[1].toFixed(2)} Q${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <path d="${d}Z" fill="#ffffff" fill-opacity="0.85" stroke="${PEN}" stroke-width="${PEN_W}" stroke-linejoin="round"/>
      <circle r="${r0}" fill="#ffffff" stroke="${PEN}" stroke-width="${PEN_W}"/>
      ${textBlock(0, r2 + 6, lines)}</g>`;
  };
  layers.push(sketchSun(sunAt(winterAz, Ri), ['WINTER', 'SUNRISE']));
  layers.push(sketchSun(sunAt(-winterAz, Ri), ['WINTER', 'SUNSET']));
  layers.push(sketchSun(sunAt(summerAz, Ro), ['SUMMER', 'SUNRISE']));
  layers.push(sketchSun(sunAt(-summerAz, Ro), ['SUMMER', 'SUNSET']));
  {
    // North sits just beyond the summer noon mark and its label.
    const [nx, ny] = sunAt(0, Ro + 24);
    layers.push(`<g transform="translate(${nx.toFixed(1)},${ny.toFixed(1)})"><circle r="6.4" fill="#ffffff" stroke="${PEN}" stroke-width="${PEN_W}"/>
      <text text-anchor="middle" dy="2.3" font-size="6.2" font-weight="700" fill="${PEN}" stroke="${PEN}" stroke-width="0.22">N</text></g>`);
  }

  const winds: { at: Pt; label: string[] }[] = [
    { at: [MAP_W - 95, 55], label: ['NE SUMMER', 'SEA BREEZE'] },
    { at: [MAP_W - 85, MAP_H - 75], label: ['S & SE COOL', 'SUMMER WIND'] },
    { at: [90, MAP_H - 60], label: ['W & SW', 'WINTER WINDS'] },
  ];
  for (const w of winds) {
    const dx = centroidPx[0] - w.at[0], dy = centroidPx[1] - w.at[1];
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    // A wind and a sun can come from the same quarter (the SE summer wind and
    // the summer sunrise do); the ribbon then stops short of the sun rather
    // than running through it.
    const sunSpots = [sunAt(winterAz, Ri), sunAt(-winterAz, Ri), sunAt(summerAz, Ro), sunAt(-summerAz, Ro)];
    const clearOfSuns = (p: Pt) => sunSpots.every(([sx, sy]) => Math.hypot(p[0] - sx, p[1] - (sy + 8)) > 36);
    // Three of the sheet's hand-drawn arrows side by side, bowing alternately.
    const strands = [[-14, 3.2, 84], [0, -3.2, 96], [14, 3.2, 76]].map(([o, bow, len]) => {
      const from: Pt = [w.at[0] + nx * o, w.at[1] + ny * o];
      let L = len;
      while (L > 40 && ![0.6, 0.8, 1].every((f) => clearOfSuns([from[0] + ux * L * f, from[1] + uy * L * f]))) L -= 4;
      return `<path d="${sketchArrow(from[0], from[1], ux, uy, L, bow, 1.6, 4.6)}"/>`;
    }).join('');
    layers.push(`<g fill="#ffffff" fill-opacity="0.85" stroke="${PEN}" stroke-width="${PEN_W}" stroke-linejoin="round">${strands}</g>`);
    layers.push(textBlock(w.at[0] - ux * 18, w.at[1] - uy * 18, w.label));
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
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${SITE_RED}" stroke-width="0.9" stroke-dasharray="4.5,1.5,1,1.5"/>`, 'SITE');
  row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${BLUE()}" stroke-width="0.8" stroke-dasharray="4,1.6"/><path d="M${SWATCH_X + SWATCH_W - 4},1.2 L${SWATCH_X + SWATCH_W},3.2 L${SWATCH_X + SWATCH_W - 4},5.2" fill="none" stroke="${BLUE()}" stroke-width="0.8"/>`, 'FALL OF TERRAIN');
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${SITE_RED}">SB 30.48</text>`, 'BOUNDARY DIMENSION (m)');
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${SITE_RED}">RL 24.5</text>`, 'SURFACE LEVEL (AHD)');
  if (sb.contours.length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${CONTOUR}" stroke-width="0.6"/><text x="${SWATCH_X + 1}" y="2.2" font-size="2.2" font-weight="700" fill="${CONTOUR}">RL 20</text>`, `CONTOURS AT ${sb.contourIntervalM ?? 2} m AHD`, sb.contourSource);
  row(`<g><rect x="${SWATCH_X + SWATCH_W / 2 - 5}" y="0" width="10" height="6.5" fill="#8a8a8a"/><text x="${SWATCH_X + SWATCH_W / 2}" y="2.8" text-anchor="middle" font-size="2.6" font-weight="700" fill="${NAME_GREEN}">26</text>${storeyLabels ? `<text x="${SWATCH_X + SWATCH_W / 2}" y="5.8" text-anchor="middle" font-size="2.6" font-weight="700" fill="${NAME_GREEN}" opacity="0.8">3ST</text>` : ''}</g>`,
    storeyLabels ? 'NEIGHBOUR: NUMBER, STOREYS' : 'NEIGHBOUR: STREET NUMBER',
    storeyLabels ? (sb.buildings?.source === 'overture' ? 'storeys from Overture Maps, OSM levels where it has none' : 'storeys from OpenStreetMap building levels') : undefined);
  // The zones, in the legend's category order, with the context sheet's swatch.
  {
    let stex = 0;
    const swD = `M${SWATCH_X},0h${SWATCH_W}v6.5h${-SWATCH_W}Z`;
    for (const c of tpl().categories) {
      if (!usedZoneCats.has(c.id)) continue;
      const ink = zoneInk(c);
      const kind = c.texture === 'dots' || c.texture === 'cross' ? c.texture : 'lines';
      row(textureSvg(`sltx${stex++}`, swD, kind, ink, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }, Math.min(1, 0.65 + c.opacity * 0.5)) +
        `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${ink}" stroke-width="0.4"/>`, c.label);
    }
  }
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
    row(`<g transform="translate(${SWATCH_X + 11},3.2) rotate(-14) scale(0.62)" fill="#fff" stroke="${RED()}" stroke-width="0.7" stroke-linejoin="round"><path d="M-7,-1.7 L6,-2.6 L6,2.6 L-7,1.7 Z"/><rect x="6" y="-3.3" width="2.6" height="6.6"/><rect x="-9.6" y="-1.2" width="2.6" height="2.4"/></g>`, 'POTENTIAL VIEW', `terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up; no buildings`);
  }
  if (sb.furniture.powerPoles.length) row(`<g transform="translate(${mid},3.2)"><line x1="-2.4" y1="0" x2="2.4" y2="0" stroke="#333" stroke-width="0.4"/><circle r="1.2" fill="none" stroke="#333" stroke-width="0.45"/></g>`, 'POWER POLE');
  if (sb.furniture.streetLamps.length) row(`<circle cx="${mid}" cy="3.2" r="1.4" fill="#f0c020" stroke="#a8860b" stroke-width="0.3"/>`, 'LIGHT POLE');
  if (sb.furniture.hydrants.length) row(`<circle cx="${mid}" cy="3.2" r="1.8" fill="#1f78d1"/>`, 'HYDRANT');
  if (sb.busStops.length) row(`<g transform="translate(${mid},3.2)"><circle r="3.4" fill="#fff" stroke="#2f7fd6" stroke-width="0.8"/><text text-anchor="middle" dy="1.9" font-size="5.7" font-weight="700" fill="#2f7fd6">B</text></g>`, 'BUS STOPS');
  if (sb.furniture.onewayRoads.length) row(`<path d="M${SWATCH_X},3.2 L${SWATCH_X + SWATCH_W - 4},3.2 M${SWATCH_X + SWATCH_W - 7},1.4 L${SWATCH_X + SWATCH_W - 4},3.2 L${SWATCH_X + SWATCH_W - 7},5" fill="none" stroke="#8a8a8a" stroke-width="1.0"/>`, 'TRAFFIC DIRECTION');
  {
    const top: string[] = [], bot: string[] = [];
    for (let x = 0; x <= SWATCH_W - 2; x += 0.5) {
      const w = 0.9 + 0.5 * Math.sin(x / 2.1) + 0.3 * Math.sin(x / 0.9);
      top.push(`${(SWATCH_X + 1 + x).toFixed(2)},${(3.2 - w).toFixed(2)}`);
      bot.push(`${(SWATCH_X + 1 + x).toFixed(2)},${(3.2 + w).toFixed(2)}`);
    }
    row(`<path d="M${top.join('L')}L${bot.reverse().join('L')}Z" fill="#fff" stroke="${NOISE_BLUE}" stroke-width="0.35" stroke-linejoin="round"/>`, 'NOISE SOURCE', 'busy roads and the railway');
  }
  {
    const rib = `M${SWATCH_X + 2},2.6 C${SWATCH_X + 7},0.8 ${SWATCH_X + 11},4.8 ${SWATCH_X + 16},2.4 L${SWATCH_X + 16},1 L${SWATCH_X + 21},3.2 L${SWATCH_X + 16},5.4 L${SWATCH_X + 16},4 C${SWATCH_X + 11},6.2 ${SWATCH_X + 7},2.6 ${SWATCH_X + 2},3.8 Z`;
    void rib;
    row(`<path d="${sketchArrow(SWATCH_X + 2, 3.2, 1, 0, 19, 0.8, 0.5, 1.3)}" fill="#fff" stroke="${RED()}" stroke-width="0.35" stroke-linejoin="round"/>`, 'PREVAILING WINDS');
    row(`<g transform="translate(${mid},3.2)">${[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => { const ar = (a * Math.PI) / 180; return `<line x1="${(2.7 * Math.cos(ar)).toFixed(2)}" y1="${(2.7 * Math.sin(ar)).toFixed(2)}" x2="${(3.9 * Math.cos(ar)).toFixed(2)}" y2="${(3.9 * Math.sin(ar)).toFixed(2)}" stroke="${RED()}" stroke-width="0.4"/>`; }).join('')}<circle r="2.1" fill="#fff" stroke="${RED()}" stroke-width="0.4"/></g>`, 'SUN PATH', 'summer solid, winter dashed; solar hours');
  }

  const utilKinds = new Set(sb.furniture.utilities.map((u) => u.kind));
  if (utilKinds.has('power')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#f2c200" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'POWER LINES');
  if (utilKinds.has('water')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#2f7fd6" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'WATER MAIN');
  if (utilKinds.has('sewer')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#7db87d" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'SEWER MAIN');
  if (utilKinds.has('gas')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#e6007e" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'GAS MAIN');

  // Arial Narrow (Liberation Sans Narrow on the server) for every word on the
  // map and in the legend.
  layers.unshift(`<g font-family="${tpl().streetFont}">`);
  layers.push('</g>');
  legendSvg = `<g font-family="${tpl().streetFont}">${legendSvg}</g>`;

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

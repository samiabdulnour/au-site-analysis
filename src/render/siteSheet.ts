// Composes the A1 SITE ANALYSIS sheet: site boundary with dimensions and
// levels, fall of terrain, sun path, prevailing winds, neighbours and street
// furniture — matching the office's DA 004 / SSDA 005 reference sheets.

import type { SiteBundle } from '../pipeline.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import {
  makeProjector, plainText, haloText, wrapLabel, shortStreetName, pointInRing,
  pathFromRings, geomRings, textureSvg, LEP_OPACITY, type Pt, type SheetMeta,
} from './sheet.js';
import { catById, zoneToCategory } from './model.js';
import { zoneFill, zoneOrder } from './lepPalette.js';
import { METRES_PER_STOREY } from '../fetch/buildings.js';
import { sheetHtml, esc, T, SWATCH_X, SWATCH_W, LABEL_X, MAP_W, MAP_H } from './chrome.js';
import { tpl, withTemplate, siteTheme, PARK_GREEN, PARK_GREEN_INK, type SiteLook } from './template.js';
import { SUN, WIND, VIEW, RAY_SUN, ARROW, EYE } from './climateSymbols.js';
import { estimateKerbs, type KerbLine } from '../lib/kerbs.js';
import { exitPoint } from '../fetch/views.js';
import { NOMINAL_CANOPY_M, TREE_SOURCES } from '../fetch/trees.js';
import { buildParkingBands, type Orientation } from '../lib/parking.js';
import { levelAt, type ContourM } from '../lib/levels.js';

// Parking, in the office's plum.
const PARK = '#9b5b6e';
const PARK_INK = '#7a3c50';
const BAY_LABEL: Record<Orientation, string> = { parallel: '6.0 m parallel', diagonal: '45° angle', perpendicular: '90°' };

// One uniform bold size for all map text on this sheet, which a theme can
// scale (look.textScale: MAP_TEXT inside drawSiteSheet). Exceptions: street
// names on the white arrows (wide-spaced, set separately) and the neighbour
// identification boxes (a step smaller).
const BASE_MAP_TEXT = 6.2;
// The pens that differ between themes — the site's, the climate marks', the
// neighbours' and the street names' — are the theme's look (SITE_THEMES in
// template.ts): Heron draws the site in Heron's red and the analysis in grey with
// white words, Canary in the context Canary's red, slate and navy with black words.

// Read at call time, not at module load: setTemplate() runs per job, long
// after this module is first imported, so a captured constant would freeze to
// whichever template happened to be active at startup.
const SUN_TEXT = 8.8;    // label size (mm) on the reference
// The neighbours' black lettering, where a theme draws it: a step under the map's, since it stacks three lines.
const STACKED_TEXT = 4.4;
// The services' pens, after the office's legend: stormwater orange, electrical
// cables red, power lines yellow, water blue, sewer green, gas magenta.
// The services in AS 5488.1's ground-marking colours: electricity orange
// (underground dashed, overhead solid, high voltage heavier in a deeper
// orange), water blue, stormwater green, sewer cream (darkened to read on
// paper), gas yellow, communications white (black on paper).
const ELECTRIC = '#ef7d00';
// Its words a shade deeper: with no halo, the line's orange is faint as text on the aerial.
const ELECTRIC_WORDS = '#b85000';
const wordsIn = (ink: string) => (ink === ELECTRIC ? ELECTRIC_WORDS : ink);
const STORMWATER = '#2e8b3a';
const SEWER = '#bfa76a';
const GAS = '#e0b000';
const SERVICE_INK = { stormwater: STORMWATER, cable: ELECTRIC, power: ELECTRIC, powerHV: '#c45a00', water: '#2f7fd6', sewer: SEWER, gas: GAS } as const;
const MANHOLE_INK: Record<string, string> = { sewer: SEWER, drain: STORMWATER, water: '#2f7fd6', telecom: '#222222', gas: GAS, power: ELECTRIC };
const BASE_SERVICE_TEXT = 3.6;
// The services' words (11 kV, Ø 375, DS 1616 · 969 kVA spare) in plain Arial
// whatever the theme's face, and with no halo: read as notes on the lines.
const SERVICE_FONT = "Arial, 'Liberation Sans', Helvetica, sans-serif";
// The trees the legend lists: those within this reach of the boundary, at most this many, numbered in this size.
const TREE_REACH_M = 15, TREE_SCHEDULE_MAX = 16, BASE_TREE_TEXT = 4.2;


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
  place(x: number, y: number, w: number, h: number, maxRadius = 26, rotDeg = 0, within?: { w: number; h: number }): Pt | null {
    const ar0 = (rotDeg * Math.PI) / 180;
    const W = Math.abs(w * Math.cos(ar0)) + Math.abs(h * Math.sin(ar0));
    const H = Math.abs(w * Math.sin(ar0)) + Math.abs(h * Math.cos(ar0));
    // `within`: the whole box must also land on the map, not just its centre.
    const ok = (cx: number, cy: number) => this.free(cx, cy, W, H) &&
      (!within || (cx - W / 2 > 1 && cx + W / 2 < within.w - 1 && cy - H / 2 > 1 && cy + H / 2 < within.h - 1));
    if (ok(x, y)) { this.reserve(x, y, W, H); return [x, y]; }
    for (let r = 4; r <= maxRadius; r += 4) {
      for (let a = 0; a < 360; a += 30) {
        const ar = (a * Math.PI) / 180;
        const nx = x + r * Math.cos(ar), ny = y + r * Math.sin(ar);
        if (ok(nx, ny)) { this.reserve(nx, ny, W, H); return [nx, ny]; }
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

/** The prevailing winds the sheet draws: the bearing each blows from, and its name. */
const WINDS = [
  { bearing: 50, label: ['NE SUMMER', 'SEA BREEZE'] },
  { bearing: 150, label: ['S & SE COOL', 'SUMMER WIND'] },
  { bearing: 235, label: ['W & SW', 'WINTER WINDS'] },
];

/**
 * Where a wind comes in from its own compass quarter, so it turns with the
 * sheet when north is aligned to the site: where a ray from the site along its
 * bearing meets a frame kept clear of the sheet's edge.
 */
function windEntry(c: Pt, bearingDeg: number, rotationDeg: number): Pt {
  const a = ((bearingDeg + rotationDeg) * Math.PI) / 180;
  const ux = Math.sin(a), uy = -Math.cos(a);
  const [x0, x1, y0, y1] = [90, MAP_W - 90, 55, MAP_H - 60];
  const tx = ux > 0 ? (x1 - c[0]) / ux : ux < 0 ? (x0 - c[0]) / ux : Infinity;
  const ty = uy > 0 ? (y1 - c[1]) / uy : uy < 0 ? (y0 - c[1]) / uy : Infinity;
  const t = Math.max(0, Math.min(tx, ty));
  return [c[0] + ux * t, c[1] + uy * t];
}

// The climate circle, where a theme draws one: a dashed ring about the site,
// each wind named around it outside a hatched band over the quarter it blows
// from, each view named around it inside a white band over its sight line,
// and the suns on the solstices' paths inside it, the summer path this far
// in and the winter one as far again, with their names further in still.
const WIND_BAND = 5, WIND_SPAN = 22;   // the bands' depth (mm) and half their sweep (°)
const VIEW_BAND = 5, VIEW_SPAN = 10;
const SUN_INSET = 17, SUN_SIZE = 2.4;
// How much further in the winter path runs than the summer one (mm): the
// same step, so the ring and the two paths stand evenly apart.
const SUN_PATH_STEP = SUN_INSET;
// How far a sun's rays reach from its centre, and a little room past them.
const SUN_CLEAR = 4.5 * SUN_SIZE + 3;
// A sun's name, two lines of the map's lettering, and the box it takes.
const SUN_NAME_W = 30, SUN_NAME_H = 14;
// The office's marks on paper (mm), as its sheet sizes them on the A1. Drawn:
// the sun's radius, the wind's half-length, the view's length and the
// outline's weight. Banded: the rayed sun's radius, the arrow's half-length,
// the sun's and the winds' crescents at their deepest, a wind crescent's half
// sweep (°), and the view triangle's length and half angle (°).
const DRAWN_SUN_R = 13, DRAWN_WIND_HALF = 17, DRAWN_VIEW_L = 32, DRAWN_EDGE = 0.35;
const RAY_SUN_R = 8, ARROW_HALF = 5.5, SUN_BAND_W = 16, WIND_BAND_W = 15, WIND_BAND_SPAN = 24, BAND_VIEW_L = 30, BAND_VIEW_HALF = 22;
/** The sun's and the winds' crescents translucent, the winds' a step lighter, so they sit back behind the site rather than catching the eye first; the views' triangles a little stronger. */
const SUN_BAND_OPACITY = 0.5, WIND_BAND_OPACITY = 0.45, BAND_VIEW_OPACITY = 0.6;

/**
 * A crescent along a circle about c, between two page bearings: its outer edge
 * on radius r, its inner edge swelling in to depth w at the middle and closing
 * to a point at each end.
 */
function crescentD(c: Pt, r: number, a0: number, a1: number, w: number): string {
  const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 2));
  const outer: string[] = [], inner: string[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + (a1 - a0) * u;
    const [ox, oy] = onCircle(c, r, a), [ix, iy] = onCircle(c, r - w * Math.sin(Math.PI * u), a);
    outer.push(`${ox.toFixed(2)},${oy.toFixed(2)}`);
    inner.push(`${ix.toFixed(2)},${iy.toFixed(2)}`);
  }
  return `M${outer.join('L')}L${inner.reverse().join('L')}Z`;
}

/** The circle's radius: clear of the lot with room for the suns' names inside it, and short of the sheet's edge with the winds' names and north outside it. */
function climateRadius(c: Pt, ring: Pt[]): number {
  const reach = Math.max(...ring.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
  const room = Math.min(c[0], MAP_W - c[0], c[1], MAP_H - c[1]) - (WIND_BAND + 16);
  return Math.min(Math.max(reach * 1.3, reach + SUN_INSET + SUN_PATH_STEP + SUN_CLEAR + SUN_NAME_W + SUN_NAME_H / 2), room);
}

/**
 * Where a sun's name goes: toward the centre from the sun at page bearing deg
 * on radius r, just far enough that its upright box clears the sun's rays
 * whichever way the sheet is turned.
 */
function sunNameAt(c: Pt, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a);
  return onCircle(c, r - (SUN_CLEAR + (SUN_NAME_W / 2) * Math.abs(ux) + (SUN_NAME_H / 2) * Math.abs(uy)), deg);
}

type SightLine = NonNullable<SiteBundle['views']>[number];

/** The degrees between two bearings, the short way round. */
const bearingGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/**
 * The views that go on the circle, with their names and each name's half
 * sweep at radius r: the clear ones in their rank, any whose name would run
 * into a better one's left off.
 */
function viewsOnCircle(views: SightLine[], r: number, letter: number): { v: SightLine; label: string; span: number }[] {
  const kept: { v: SightLine; label: string; span: number }[] = [];
  for (const v of views) {
    if (!v.cone) continue;
    const label = `${v.label} ${v.kind === 'park' ? '' : 'VIEW'}`.trim();
    const span = Math.max(VIEW_SPAN, ((label.length * letter * 0.7) / 2 / r) * (180 / Math.PI) + 2);
    if (kept.some((o) => bearingGap(o.v.bearingDeg, v.bearingDeg) < o.span + span)) continue;
    kept.push({ v, label, span });
  }
  return kept;
}

/** A point on a circle about c, at a bearing on the page (degrees clockwise from up). */
function onCircle(c: Pt, r: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [c[0] + r * Math.sin(a), c[1] - r * Math.cos(a)];
}

/** An arc about c from one page bearing to another, the short way round; `move` false continues the path with a line to its start. */
function arcD(c: Pt, r: number, a0: number, a1: number, move = true): string {
  const [x0, y0] = onCircle(c, r, a0), [x1, y1] = onCircle(c, r, a1);
  return `${move ? 'M' : 'L'}${x0.toFixed(2)},${y0.toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/**
 * The path for words set around a circle about c, centred on a page bearing
 * and reading upright: clockwise over the top, where the letters stand out
 * from radius r, and anticlockwise under the bottom, where they hang toward
 * the centre and so ride a capital's height further out.
 */
function aroundD(c: Pt, r: number, deg: number, span: number, cap: number): string {
  return Math.cos((deg * Math.PI) / 180) >= 0 ? arcD(c, r, deg - span, deg + span) : arcD(c, r + cap, deg + span, deg - span);
}

/** The plain sun: an open disc with eight short rays, `size` times the legend's. */
function sunMark([x, y]: Pt, edge: string, fill: string, size = 1): string {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return `M${(2.9 * size * Math.cos(a)).toFixed(2)},${(2.9 * size * Math.sin(a)).toFixed(2)}L${(4.5 * size * Math.cos(a)).toFixed(2)},${(4.5 * size * Math.sin(a)).toFixed(2)}`;
  }).join('');
  const w = (0.6 * Math.sqrt(size)).toFixed(2);
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><path d="${rays}" stroke="${edge}" stroke-width="${w}" stroke-linecap="round"/><circle r="${(1.9 * size).toFixed(2)}" fill="${fill}" stroke="${edge}" stroke-width="${w}"/></g>`;
}

/** The properties of the first polygon that holds the point, of a layer's features. */
function featureAt(features: { geometry: any; properties: Record<string, any> }[], lon: number, lat: number): Record<string, any> | null {
  for (const f of features) {
    // Even-odd over every ring, so a point in a polygon's hole is outside it.
    const rings = geomRings(f.geometry);
    if (rings.length && rings.reduce((n, r) => n + (pointInRing(lon, lat, r) ? 1 : 0), 0) % 2 === 1) return f.properties;
  }
  return null;
}

/** "HOB = 18m", or "HOB = RL 45" where a plan limits height by level. */
function heightLine(v: number, units: unknown): string {
  const fig = v % 1 ? v.toFixed(1) : String(v);
  return /rl|ahd/i.test(String(units ?? '')) ? `HOB = RL ${fig}` : `HOB = ${fig}m`;
}

/** The site analysis sheet, in one of its own themes (Heron unless another is named); it never takes the context sheet's templates. */
export function renderSiteSheet(sb: SiteBundle, meta: SheetMeta, theme?: string): string {
  const t = siteTheme(theme);
  return withTemplate(t.base, () => drawSiteSheet(sb, meta, t.look));
}

/** The white buildings' fine hatch: a pattern of diagonal lines in the given ink, 1.4 mm apart. */
function buildingHatch(id: string, ink: string): string {
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(45)">` +
    `<line x1="0.7" y1="0" x2="0.7" y2="1.4" stroke="${ink}" stroke-width="0.25" stroke-opacity="0.55"/></pattern>`;
}

function drawSiteSheet(sb: SiteBundle, meta: SheetMeta, look: SiteLook): string {
  // Every word on the map in the theme's size.
  const MAP_TEXT = BASE_MAP_TEXT * look.textScale, NEIGHBOUR_TEXT = MAP_TEXT;
  const SERVICE_TEXT = BASE_SERVICE_TEXT * look.textScale, TREE_TEXT = BASE_TREE_TEXT * look.textScale;
  const SITE_RED = look.site;
  const NAME_GREEN = look.streetInk;
  const NOISE_BLUE = look.noisePen;
  const BLUE = () => look.fall;
  const view = sb.view;
  const proj = makeProjector(view);
  const layers: string[] = [];
  const placer = new Placer();
  const lat = mercatorToLonLat({ x: view.cx, y: view.cy }).lat;
  const k = mercatorScaleFactor(lat);
  const MM = view.halfW * 2 / MAP_W; // mercator meters per mm

  // ---- aerial (rotated group over fetch bounds), light wash ---------------
  // The whole map with the site cut out of it: where the aerial is greyed and veiled.
  const siteHole = 'M' + sb.siteRing.map(([lon, lat2]) => proj(lon, lat2)).map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z';
  const outsideSite = `M0,0 H${MAP_W} V${MAP_H} H0 Z ${siteHole}`;
  // On paper there is no photograph: a white sheet, and the zones' grounds
  // and the buildings below carry the plan.
  if (look.ground === 'paper') layers.push(`<rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" fill="#ffffff"/>`);
  else {
    const s = MAP_W / (2 * view.halfW);
    const extW = (sb.extent.xmax - sb.extent.xmin) * s;
    const extH = (sb.extent.ymax - sb.extent.ymin) * s;
    const ox = MAP_W / 2 - extW / 2;
    const oy = MAP_H / 2 - extH / 2;
    const tiles = sb.aerial.tiles
      .map((t) => `<image href="data/${t.file}" x="${(ox + t.left * extW).toFixed(2)}" y="${(oy + t.top * extH).toFixed(2)}"
          width="${(t.width * extW).toFixed(2)}" height="${(t.height * extH).toFixed(2)}" preserveAspectRatio="none"/>`)
      .join('\n');
    // A theme with a grey aerial (Heron, Canary) takes the photograph to grey
    // outside the site, by the context sheet's saturation blend rather than a
    // filter (see sheet.ts), so the zones' colours are the only colour round the lot.
    const photo = `<g transform="rotate(${view.rotationDeg.toFixed(2)}, ${MAP_W / 2}, ${MAP_H / 2})">${tiles}</g>`;
    layers.push(look.aerial === 'grey'
      ? `<g style="isolation:isolate">${photo}<path fill-rule="evenodd" fill="#808080" style="mix-blend-mode:saturation" d="${outsideSite}"/></g>`
      : photo);
  }
  // (3) White overlay everywhere EXCEPT the site: the analysed lot stays at
  // full aerial saturation, its surroundings are washed back.
  if (look.ground === 'aerial') layers.push(`<path fill-rule="evenodd" fill="#ffffff" opacity="${look.veil}" d="${outsideSite}"/>`);

  // ---- zones as hatch, not words ---------------------------------------------
  // The neighbours' zoning is drawn, not written: each zone a hatch in its
  // family's ink with a fine outline, so the aerial stays readable under it.
  // The pattern is the category's texture (lines where it has none), its
  // strength the category's, so R2 sits lighter than R3. A theme can tint
  // the zones under the hatch (look.zoneTint) in the category's fill,
  // multiplied into the photograph rather than laid over it, so the colour
  // reads without washing out the roofs. Or, as the context Canary draws
  // them, each zone code filled in its NSW ePlanning colour. Never over the site.
  const usedZoneCats = new Set<string>();
  const zoneInk = (c: { fill: string; stroke?: string; figure?: string; textureColor?: string }) =>
    c.figure ?? c.stroke ?? c.fill;
  const lepZones = new Map<string, { name: string; paths: string[] }>();
  {
    const byCat = new Map<string, string[]>();
    for (const f of look.zones === 'hatch' || look.zones === 'fill' ? sb.zoning.features : []) {
      const cat = zoneToCategory(f.properties.SYM_CODE);
      if (!cat || !catById()[cat]) continue;
      const rings = geomRings(f.geometry);
      if (!rings.length) continue;
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(pathFromRings(rings, proj));
    }
    let tex = 0;
    const mapBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    const tints: string[] = [];
    const parts: string[] = [];
    // Filled grounds lie on the lots only, so where a plan zones its roads
    // with the land beside them the road reserve still reads white; water is
    // rarely a lot, so it is drawn whole.
    const freeParts: string[] = [];
    for (const [cat, paths] of byCat) {
      const c = catById()[cat];
      usedZoneCats.add(cat);
      if (look.zones === 'fill') {
        // The context template's own ground: its fill at its strength, its
        // texture over it, as the context sheet draws the zone.
        (cat === 'water' ? freeParts : parts).push(`<g fill="${c.fill}" opacity="${c.opacity.toFixed(2)}" fill-rule="evenodd"${c.stroke ? ` stroke="${c.stroke}" stroke-width="0.5"` : ''}>${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`);
        if (c.texture) (cat === 'water' ? freeParts : parts).push(textureSvg(`stx${tex++}`, paths.join(''), c.texture, c.textureColor ?? c.stroke ?? c.fill, mapBox));
        continue;
      }
      const ink = zoneInk(c);
      const kind = c.texture === 'dots' || c.texture === 'cross' ? c.texture : 'lines';
      tints.push(`<g fill="${c.fill}">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`);
      parts.push(textureSvg(`stx${tex++}`, paths.join(''), kind, ink, mapBox, Math.min(1, 0.65 + c.opacity * 0.5)));
      parts.push(`<g fill="none" stroke="${ink}" stroke-width="0.6">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`);
    }
    for (const f of look.zones === 'lep' ? sb.zoning.features : []) {
      const code = String(f.properties.SYM_CODE ?? '').trim().toUpperCase();
      const rings = geomRings(f.geometry);
      if (!code || !rings.length) continue;
      let z = lepZones.get(code);
      if (!z) lepZones.set(code, z = { name: String(f.properties.LAY_CLASS ?? '').trim(), paths: [] });
      z.paths.push(pathFromRings(rings, proj));
    }
    for (const [code, z] of lepZones)
      parts.push(`<g fill="${zoneFill(code)}" opacity="${LEP_OPACITY}" fill-rule="evenodd">${z.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`);
    const lotsD = look.zones === 'fill' ? sb.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('') : '';
    const zoned = lotsD
      ? `<defs><clipPath id="onLots"><path d="${lotsD}"/></clipPath></defs><g clip-path="url(#onLots)">${parts.join('')}</g>`
      : parts.join('');
    layers.push(`<defs><clipPath id="notSite"><path clip-rule="evenodd" d="M-20,-20 H${MAP_W + 20} V${MAP_H + 20} H-20 Z ${siteHole}"/></clipPath></defs>`);
    // The blend sits on the clipped group itself: a clip on a parent would
    // isolate it, and the tint would multiply into nothing.
    if (look.zoneTint && tints.length)
      layers.push(`<g clip-path="url(#notSite)" fill-rule="evenodd" opacity="${look.zoneTint}" style="mix-blend-mode:multiply">${tints.join('')}</g>`);
    layers.push(`<g clip-path="url(#notSite)">${freeParts.join('')}${zoned}</g>`);
    // On paper the site takes the template's site tint, as on the context sheet.
    const siteCat = catById().site;
    if (look.ground === 'paper' && siteCat) layers.push(`<path d="${siteHole}" fill="${siteCat.fill}" opacity="${siteCat.opacity}"/>`);
  }

  // ---- buildings, filled: on paper the grain is the buildings themselves ------
  // Each building in the strong colour of the zone family it stands on (the
  // context template's figure), a quiet grey where no zone is mapped and on
  // the site itself, with a white edge, as the context sheet draws them. Or
  // white, edged in that family's ink, as the context Flamingo draws them,
  // and where the look asks, finely hatched in that ink so they read apart
  // from the white roads.
  const whiteBuildings = look.buildings === 'white';
  const buildingDs: string[] = [];
  if ((look.buildings === 'colour' || whiteBuildings) && sb.buildings?.buildings.length) {
    const byInk = new Map<string, string[]>();
    for (const b of sb.buildings.buildings) {
      const [x, y] = proj(b.centroid[0], b.centroid[1]);
      if (!(x > -40 && x < MAP_W + 40 && y > -40 && y < MAP_H + 40)) continue;
      const z = pointInRing(b.centroid[0], b.centroid[1], sb.siteRing) ? null : featureAt(sb.zoning.features, b.centroid[0], b.centroid[1]);
      const cat = z ? zoneToCategory(z.SYM_CODE) : null;
      const ink = (cat && catById()[cat]?.figure) || (whiteBuildings ? tpl().road : '#d9d9d6');
      (byInk.get(ink) ?? byInk.set(ink, []).get(ink)!).push(`<path d="${pathFromRings(b.rings, proj)}"/>`);
    }
    [...byInk].forEach(([ink, ds], i) => {
      buildingDs.push(...ds);
      const hatch = whiteBuildings && look.buildingHatch
        ? `${buildingHatch(`bldHatch${i}`, ink)}<g fill="#ffffff" fill-rule="evenodd">${ds.join('')}</g>` : '';
      layers.push(whiteBuildings
        ? `${hatch}<g fill="${hatch ? `url(#bldHatch${i})` : '#ffffff'}" fill-opacity="${hatch ? 1 : 0.92}" fill-rule="evenodd" stroke="${ink}" stroke-width="${look.buildingEdge}" stroke-linejoin="round">${ds.join('')}</g>`
        : `<g fill="${ink}" fill-rule="evenodd" stroke="#ffffff" stroke-width="${look.buildingEdge}" stroke-linejoin="round">${ds.join('')}</g>`);
    });
  }

  // ---- heritage: the LEP's items and conservation areas, hatched -------------
  // The items and the conservation areas each in the theme's ink (Canary's are
  // the ePlanning tan and red), a hatch with a fine outline so the aerial reads
  // through. Drawn over the site too: a listing on the lot is the first thing
  // the sheet must say.
  const heritageKinds = new Set<'item' | 'area'>();
  if (look.heritage && sb.heritage?.features.length) {
    const byKind: Record<'item' | 'area', string[]> = { item: [], area: [] };
    for (const f of sb.heritage.features) {
      const rings = geomRings(f.geometry);
      if (!rings.length) continue;
      const kind = /conservation/i.test(String(f.properties.LAY_CLASS ?? '')) ? 'area' : 'item';
      byKind[kind].push(pathFromRings(rings, proj));
    }
    const mapBox = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    for (const kind of ['area', 'item'] as const) {
      if (!byKind[kind].length) continue;
      heritageKinds.add(kind);
      const ink = look.heritageInk[kind];
      // A conservation area can take in the whole sheet (Redfern, Paddington):
      // its hatch is kept light so the aerial and the analysis still read.
      layers.push(textureSvg(`her${kind}`, byKind[kind].join(''), 'lines', ink, mapBox, kind === 'area' ? 0.3 : 0.8) +
        `<path d="${byKind[kind].join('')}" fill="none" stroke="${ink}" stroke-width="0.5"/>`);
    }
  }

  const inMapWide = ([x, y]: Pt) => x > -10 && x < MAP_W + 10 && y > -10 && y < MAP_H + 10;
  const inMap = ([x, y]: Pt) => x > 2 && x < MAP_W - 2 && y > 2 && y < MAP_H - 2;

  // The office's winds, set on the summer ring at their bearing and pointing in
  // at the site: where each stands, its bearing, which way it points, its name.
  const ringWinds: { at: Pt; az: number; deg: number; label: string[]; labelAt: Pt }[] = [];
  const drawnSun = look.sun === 'drawn' || look.sun === 'band';
  const ringWind = look.wind === 'drawn' || look.wind === 'band';
  // How far a ring wind reaches either side of its spot, along it and across.
  const windHalf = look.wind === 'band' ? WIND_BAND_W / 2 : DRAWN_WIND_HALF;
  const sunR = look.sun === 'band' ? RAY_SUN_R : DRAWN_SUN_R;
  // Reserve the fixed graphic furniture up-front (suns, the winds' names,
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
    // The crowns, or the drawn suns, sit at the solstices' rise and set points, with their names under them.
    if (look.sun === 'crown' || drawnSun)
      for (const [az, R] of [[azOf(dec), Ri], [-azOf(dec), Ri], [azOf(-dec), Ro], [-azOf(-dec), Ro], [0, Ro + 24]] as [number, number][]) {
        const [x, y] = at(az, R);
        if (drawnSun) placer.reserve(x, y + 10, sunR * 2 + 8, sunR * 2 + 30);
        else placer.reserve(x, y + 6, 48, 58);
      }
    // And the hours along the arcs.
    const hrs = solsticeHours(lat);
    // The circle's marks: the four suns and their names, north, each wind's
    // band and name outside, and each view's band and name inside.
    const R = climateRadius([cx, cy], sr.slice(0, sn));
    if (look.sun === 'circle') {
      // Winter's suns on the inner path, summer's on the outer.
      for (const [az, r] of [[azOf(dec), R - SUN_INSET - SUN_PATH_STEP], [-azOf(dec), R - SUN_INSET - SUN_PATH_STEP], [azOf(-dec), R - SUN_INSET], [-azOf(-dec), R - SUN_INSET]]) {
        placer.reserve(...at(az, r), SUN_CLEAR * 2, SUN_CLEAR * 2);
        placer.reserve(...sunNameAt([cx, cy], r, az + view.rotationDeg), SUN_NAME_W, SUN_NAME_H);
      }
      placer.reserve(...at(0, R + 10), 12, 22);
    }
    if (ringWind) {
      // Slid along the ring, a few degrees at a time, off a sun from the same
      // quarter (the W wind and the summer sunset share one) and off each other.
      const suns = [at(azOf(dec), Ri), at(-azOf(dec), Ri), at(azOf(-dec), Ro), at(-azOf(-dec), Ro), at(0, Ro + 24)];
      for (const w of WINDS) {
        let pick: Pt | null = null, pickAz = w.bearing;
        for (const off of [0, 8, -8, 16, -16, 24, -24, 32, -32]) {
          const p = at(w.bearing + off, Ro);
          const clear = suns.every(([sx, sy]) => Math.hypot(p[0] - sx, p[1] - sy) > windHalf + sunR + 10) &&
            ringWinds.every((o) => Math.hypot(p[0] - o.at[0], p[1] - o.at[1]) > windHalf * 2.4) &&
            p[0] > 30 && p[0] < MAP_W - 30 && p[1] > 30 && p[1] < MAP_H - 30;
          if (clear) { pick = p; pickAz = w.bearing + off; break; }
        }
        const p = pick ?? at(w.bearing, Ro);
        const deg = (Math.atan2(cy - p[1], cx - p[0]) * 180) / Math.PI;
        // Its name centred beyond the tail, its near edge clear of the mark
        // whichever side of the ring it stands.
        const nameW = Math.max(...w.label.map((t) => t.length)) * MAP_TEXT * 0.62, nameH = w.label.length * MAP_TEXT * 1.12;
        const pr = ((pickAz + view.rotationDeg) * Math.PI) / 180;
        const labelAt = at(pickAz, Ro + windHalf + (look.wind === 'band' ? 9 : 4) + (Math.abs(Math.sin(pr)) * nameW + Math.abs(Math.cos(pr)) * nameH) / 2);
        ringWinds.push({ at: p, az: pickAz, deg, label: w.label, labelAt });
        if (look.wind === 'band')
          for (let d = -WIND_BAND_SPAN; d <= WIND_BAND_SPAN; d += 6) placer.reserve(...at(pickAz + d, Ro), 12, 12);
        else {
          const ux = Math.cos((deg * Math.PI) / 180), uy = Math.sin((deg * Math.PI) / 180);
          for (let d = -windHalf; d <= windHalf; d += 8) placer.reserve(p[0] + ux * d, p[1] + uy * d, windHalf, windHalf);
        }
        placer.reserve(labelAt[0], labelAt[1], nameW, nameH);
      }
    }
    if (look.wind === 'circle')
      for (const w of WINDS)
        for (let d = -WIND_SPAN - 8; d <= WIND_SPAN + 8; d += 5) placer.reserve(...at(w.bearing + d, R + WIND_BAND / 2 + 4), 14, 14);
    if (look.views === 'circle')
      for (const { v, span } of viewsOnCircle(sb.views ?? [], R - VIEW_BAND - 6, MAP_TEXT))
        for (let d = -span; d <= span; d += 4) placer.reserve(...at(v.bearingDeg + d, R - VIEW_BAND - 2), 12, 12);
    if (look.sunHours) {
      for (const m of hrs.winter) { const [x, y] = at(m.az, Ri); placer.reserve(x, y, 12, 12); const [lx, ly] = at(m.az, Ri - 10); placer.reserve(lx, ly, 18, 9); }
      for (const m of hrs.summer) { const [x, y] = at(m.az, Ro); placer.reserve(x, y, 12, 12); const [lx, ly] = at(m.az, Ro + 10); placer.reserve(lx, ly, 18, 9); }
    }
    placer.reserve(MAP_W - 95, 55, 110, 20);
    placer.reserve(MAP_W - 85, MAP_H - 75, 120, 20);
    placer.reserve(90, MAP_H - 60, 110, 20);
  }

  // ---- potential views ------------------------------------------------------
  // Drawn in the sun and wind's hand: for each sight line the ground does not
  // block, a telescope just outside the site edge, aimed along the bearing,
  // with the view's name set beside it in the same lettering. It goes under
  // the linework; its label is pushed last so nothing covers it. A theme with
  // the climate circle sets its views on the circle instead.
  const viewText: string[] = [];
  {
    const centreLL = mercatorToLonLat({ x: view.cx, y: view.cy });
    const LETTER = MAP_TEXT;
    const TS = 2.8;                            // the telescope's size on paper
    for (const v of look.views === 'circle' ? [] : sb.views ?? []) {
      if (!v.cone) continue;
      const apex = exitPoint(sb.siteRing, centreLL, v.bearingDeg);
      const [ax, ay] = proj(apex.lon, apex.lat);
      const ang = ((v.bearingDeg + view.rotationDeg) * Math.PI) / 180;
      const ux = Math.sin(ang), uy = -Math.cos(ang);
      if (look.views === 'drawn' || look.views === 'band') {
        // The office's view: its point a little off the boundary, opening
        // outward along the sight line. Drawn, the wedge and the eye in its
        // triangle, solid in the ink of its words; banded, a translucent
        // triangle with the eye white in it, turned to look along the sight
        // line, its lid outward. What it found is written beyond its open end,
        // along the line, upright.
        const m = look.marks!;
        const drawn = look.views === 'drawn';
        const L = drawn ? DRAWN_VIEW_L : BAND_VIEW_L, half = drawn ? Math.atan(0.54) : (BAND_VIEW_HALF * Math.PI) / 180, gap = 3;
        const px = ax + ux * gap, py = ay + uy * gap;
        const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
        if (drawn) {
          layers.push(`<path transform="translate(${px.toFixed(1)},${py.toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${L})" d="${VIEW}" fill="${look.viewPen}" stroke="${look.viewPen}" stroke-width="${(DRAWN_EDGE / L).toFixed(4)}" stroke-linejoin="round"/>`);
        } else {
          const end = (a: number): string => `${(px + L * Math.sin(a)).toFixed(1)},${(py - L * Math.cos(a)).toFixed(1)}`;
          const eyeS = L * 0.2, ex = px + ux * L * 0.7, ey = py + uy * L * 0.7;
          layers.push(`<path d="M${px.toFixed(1)},${py.toFixed(1)} L${end(ang - half)} L${end(ang + half)} Z" fill="${m.view}" fill-opacity="${BAND_VIEW_OPACITY}"/>` +
            `<path transform="translate(${ex.toFixed(1)},${ey.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(1)}) scale(${eyeS.toFixed(2)})" d="${EYE}" fill="#ffffff"/>`);
        }
        const dist = v.distanceM >= 950 ? `${(v.distanceM / 1000).toFixed(1)} KM` : `${Math.round(v.distanceM / 10) * 10} M`;
        const rows = v.kind === 'park' ? ['ADJOINING'] : [dist, 'TERRAIN CLEAR'];
        const tdeg = Math.abs(deg) <= 90 ? deg : deg + 180;
        const lh = LETTER * 1.12;
        const tw = Math.max(...rows.map((r) => r.length)) * LETTER * 0.62;
        // Centred a half text-width beyond the open end, so the words run on
        // from the triangle; where that spot is taken (a sun's name), beside
        // the triangle instead, on whichever side is clear.
        const th = rows.length * lh;
        const boxW = Math.abs(tw * ux) + Math.abs(th * uy), boxH = Math.abs(tw * uy) + Math.abs(th * ux);
        const nx = -uy, ny = ux, side = L * Math.sin(half) + th / 2 + 2;
        const spots: Pt[] = [
          [px + ux * (L + 7 + tw / 2), py + uy * (L + 7 + tw / 2)],
          [px + ux * L * 0.6 + nx * side, py + uy * L * 0.6 + ny * side],
          [px + ux * L * 0.6 - nx * side, py + uy * L * 0.6 - ny * side],
          [px + ux * L * 0.6 + nx * (side + 8), py + uy * L * 0.6 + ny * (side + 8)],
          [px + ux * L * 0.6 - nx * (side + 8), py + uy * L * 0.6 - ny * (side + 8)],
        ];
        const [lx, ly] = spots.find(([x, y]) => placer.isFree(x, y, boxW * 0.9, boxH * 0.9)) ?? spots[0];
        for (let d = 4; d <= L; d += 6) placer.reserve(px + ux * d, py + uy * d, 10, 10);
        for (let d = -tw / 2; d <= tw / 2; d += 6) placer.reserve(lx + ux * d, ly + uy * d, 10, th + 2);
        viewText.push(`<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) rotate(${tdeg.toFixed(1)})">${rows.map((r, i) =>
          `<text x="0" y="${(LETTER * 0.36 + (i - (rows.length - 1) / 2) * lh).toFixed(2)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${look.viewPen}">${esc(r)}</text>`).join('')}</g>`);
        continue;
      }
      // The tube runs from x = -9.6 (eyepiece) to 8.6 (objective) in its own
      // units; its eyepiece end sits a few millimetres off the boundary.
      const sx = ax + ux * (9.6 * TS + 4), sy = ay + uy * (9.6 * TS + 4);
      const deg = (Math.atan2(uy, ux) * 180) / Math.PI;
      layers.push(`<g transform="translate(${sx.toFixed(1)},${sy.toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${TS})" stroke="${look.viewPen}" stroke-width="${(0.7 / TS).toFixed(3)}" stroke-linejoin="round" fill="#ffffff">
        <path d="M-7,-1.7 L6,-2.6 L6,2.6 L-7,1.7 Z"/>
        <rect x="6" y="-3.3" width="2.6" height="6.6" rx="0.6"/>
        <rect x="-9.6" y="-1.2" width="2.6" height="2.4" rx="0.4"/>
        <line x1="-2" y1="-2.1" x2="-2" y2="2.1"/>
        <line x1="2" y1="-2.4" x2="2" y2="2.4"/></g>`);
      // Only what the telescope found: how far, and that the ground is clear.
      // Set along the telescope's line, under it, upright.
      const dist = v.distanceM >= 950 ? `${(v.distanceM / 1000).toFixed(1)} KM` : `${Math.round(v.distanceM / 10) * 10} M`;
      const rows = v.kind === 'park' ? ['ADJOINING'] : [dist, 'TERRAIN CLEAR'];
      const upright = Math.abs(deg) <= 90;
      const tdeg = upright ? deg : deg + 180;
      // Under the telescope: along its line, centred on it, two short rows
      // below the tube on the page, so the label stays off the boundary.
      const lh = LETTER * 1.12;
      const tw = Math.max(...rows.map((r) => r.length)) * LETTER * 0.5;
      const down = 3.3 * TS + 2 + LETTER * 0.75;
      const ar = (tdeg * Math.PI) / 180;
      const dnx = -Math.sin(ar), dny = Math.cos(ar);   // the text's down, on the page
      const lx = sx + dnx * down, ly = sy + dny * down;
      for (let d = -tw / 2; d <= tw / 2; d += 6)
        for (let k2 = 0; k2 < rows.length; k2++) placer.reserve(lx + Math.cos(ar) * d + dnx * k2 * lh, ly + Math.sin(ar) * d + dny * k2 * lh, 8, 8);
      for (let d = -9.6; d <= 8.6; d += 4) placer.reserve(sx + ux * d * TS, sy + uy * d * TS, 12, 12);
      viewText.push(`<g transform="translate(${lx.toFixed(1)},${ly.toFixed(1)}) rotate(${tdeg.toFixed(1)})">${rows.map((r, i) =>
        `<text x="0" y="${(LETTER * 0.36 + i * lh).toFixed(2)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${look.viewPen}" stroke="${look.viewPen}" stroke-width="0.22">${esc(r)}</text>`).join('')}</g>`);
    }
  }

  // ---- cadastre + contours -------------------------------------------------
  if (sb.allLots.features.length) {
    const d = sb.allLots.features.map((f) => pathFromRings(geomRings(f.geometry), proj)).join('');
    layers.push(look.lotInk
      ? `<path d="${d}" fill="none" stroke="${look.lotInk}" stroke-width="0.3" opacity="0.6"/>`
      : `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="0.7" opacity="0.9"/>`);
  }
  // Kerb lines, on a sheet with no photograph to show them: a footpath's
  // width out from the lot boundary, measured where OpenStreetMap maps the
  // footpath, typical where it does not, and its own kerbs where it maps them.
  // The bundle carries them (the CAD export draws the same); an older one
  // has none, and they are worked out here.
  let kerbs: KerbLine[] = [];
  if (look.kerbs && sb.allLots.features.length) {
    kerbs = sb.kerbs ?? estimateKerbs(sb.allLots.features.flatMap((f) => geomRings(f.geometry)), sb.roads, sb.footways?.lines ?? [], sb.furniture.kerbs ?? []);
    const d = kerbs.map((kl) => pathFromRings([kl.coords as any], proj, false)).join('');
    if (d) layers.push(`<path d="${d}" fill="none" stroke="#8a8a8a" stroke-width="0.35" stroke-linecap="round"/>`);
  }
  // (2) Terrain: contour lines with elevation tags (RL m AHD) along them.
  if (look.contours && sb.contours.length) {
    const d = sb.contours.map((c) => pathFromRings([c.coords as any], proj, false)).join('');
    // Where the look asks, the lines all but vanish under the buildings.
    const under = look.contourUnderBuildings;
    const mask = under !== undefined && buildingDs.length
      ? `<mask id="contourMask" maskUnits="userSpaceOnUse" x="-50" y="-50" width="${MAP_W + 100}" height="${MAP_H + 100}">` +
        `<rect x="-50" y="-50" width="${MAP_W + 100}" height="${MAP_H + 100}" fill="#ffffff"/>` +
        `<g fill="#000000" fill-opacity="${1 - under}" fill-rule="evenodd">${buildingDs.join('')}</g></mask>`
      : '';
    layers.push(`${mask}<path d="${d}" fill="none" stroke="${look.contourInk}" stroke-width="0.6" opacity="0.9"${mask ? ' mask="url(#contourMask)"' : ''}/>`);
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
        fill="${look.contourInk}">RL ${c.elevation.toFixed(0)}</text>`);
    }
  }

  // ---- noise sources: along the main roads and the railway --------------------
  // In blue, so noise reads apart from the red climate marks, but drawn
  // in the wind's manner: a white line in a blue pen, a sound wave beside
  // each busy road and the railway, on the site's side.
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
  // Sound as a band along the source, on the site's side, white inside a
  // blue pen like the wind. It breaks where it would cross the site or leave
  // the sheet.
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
    if (look.noise === 'zigzag') {
      // The office's zigzag: a sharp saw beside the source, a tooth every 2.4 mm.
      let run: string[] = [];
      const flushZ = () => { if (run.length > 3) noiseMarks.push(`<path d="M${run.join('L')}"/>`); run = []; };
      let next = 0, up = 1;
      for (const { p, n, s: t } of samples) {
        if (t < next) continue;
        next = t + 1.2; up = -up;
        const c = side * 10 + up * 2;
        const cx = p[0] + n[0] * c, cy = p[1] + n[1] * c;
        if (!inMap([cx, cy]) || inSiteRing(cx, cy)) { flushZ(); continue; }
        run.push(`${cx.toFixed(2)},${cy.toFixed(2)}`);
      }
      flushZ();
      return;
    }
    // One continuous band, white inside a blue pen like the wind, swaying
    // gently and swelling a little along its length — never pinching shut,
    // so it reads as one line and not a string of beads.
    const half = (t: number) => 2.3 + 0.55 * Math.sin(t / 9.5 + seed) + 0.3 * Math.sin(t / 4.6 + seed * 2.1);
    const sway = (t: number) => 1.6 * Math.sin(t / 11 + seed * 1.3);
    let left: string[] = [], right: string[] = [];
    const flush = () => {
      if (left.length > 3) noiseMarks.push(`<path d="M${left.join('L')}L${right.reverse().join('L')}Z"/>`);
      left = []; right = [];
    };
    for (const { p, n, s: t } of samples) {
      const c = side * 11 + sway(t);
      const cx = p[0] + n[0] * c, cy = p[1] + n[1] * c;
      if (!inMap([cx, cy]) || inSiteRing(cx, cy)) { flush(); continue; }
      const w = half(t);
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
  layers.push(look.noise === 'zigzag'
    ? `<g fill="none" stroke="${NOISE_BLUE}" stroke-width="0.9" stroke-linejoin="miter">${noiseMarks.join('')}</g>`
    : `<g fill="#ffffff" fill-opacity="0.9" stroke="${NOISE_BLUE}" stroke-width="0.6" stroke-linejoin="round">${noiseMarks.join('')}</g>`);

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

  // (6) Services, where an open licence lets the sheet draw them: the
  // council's stormwater pipes and pits, Geoscience Australia's high-voltage
  // lines and substations, and what OpenStreetMap has mapped (overhead lines,
  // cables, pipelines, substations, cabinets, manholes). The office's own
  // services come from a Before You Dig enquiry, and the legend says so.
  const services = sb.services ?? { lines: [], points: [], sources: [] };
  const servicePoints = sb.furniture.servicePoints ?? [];
  {
    const dash = (pts: Pt[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L');
    for (const u of sb.furniture.utilities) {
      const pts = u.coords.map(([lon, lat2]) => proj(lon, lat2));
      if (pts.length < 2) continue;
      const style = u.kind === 'power' ? 'stroke-width="0.5"' : u.kind === 'cable' ? 'stroke-width="0.5" stroke-dasharray="3,2"' : 'stroke-width="0.7" stroke-dasharray="4,2.2"';
      layers.push(`<path d="${dash(pts)}" fill="none" stroke="${SERVICE_INK[u.kind]}" ${style}/>`);
    }
    // A label every so often along a run, kept off the others: the pipe's
    // size, the line's voltage.
    const labelled: { x: number; y: number; t: string }[] = [];
    const along = (pts: Pt[], text: string, ink: string) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (len < 18) return;
      let at = len / 2, i = 1;
      for (; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (at <= l) break; at -= l; }
      const [ax, ay] = pts[i - 1], [bx, by] = pts[Math.min(i, pts.length - 1)];
      const l = Math.hypot(bx - ax, by - ay) || 1, x = ax + ((bx - ax) * at) / l, y = ay + ((by - ay) * at) / l;
      if (!inMap([x, y]) || labelled.some((o) => o.t === text && Math.hypot(o.x - x, o.y - y) < 45)) return;
      let ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      const spot = placer.place(x, y, text.length * SERVICE_TEXT * 0.6, SERVICE_TEXT, 4, ang);
      if (!spot) return;
      labelled.push({ x, y, t: text });
      layers.push(`<text transform="translate(${spot[0].toFixed(1)},${spot[1].toFixed(1)}) rotate(${ang.toFixed(1)})" text-anchor="middle" dy="${(SERVICE_TEXT * 0.36).toFixed(2)}" font-family="${SERVICE_FONT}" font-size="${SERVICE_TEXT}" font-weight="700" fill="${wordsIn(ink)}">${esc(text)}</text>`);
    };
    for (const l of services.lines) {
      const pts = l.coords.map(([lon, lat2]) => proj(lon, lat2));
      if (pts.length < 2 || !pts.some(inMapWide)) continue;
      const ink = l.kind === 'powerCable' ? SERVICE_INK.cable : l.kind === 'powerOverhead' ? SERVICE_INK.power : SERVICE_INK[l.kind as keyof typeof SERVICE_INK] ?? '#555';
      const style = l.kind === 'powerHV' ? `stroke-width="1.1" stroke-dasharray="${l.underground ? '1.2,1.6' : '7,2,1.4,2'}"` : l.kind === 'powerCable' ? 'stroke-width="0.5" stroke-dasharray="3,2"' : l.kind === 'powerOverhead' ? 'stroke-width="0.5"' : 'stroke-width="0.8" stroke-dasharray="4,2.2"';
      layers.push(`<path d="${dash(pts)}" fill="none" stroke="${ink}" ${style}/>`);
      if (l.label) along(pts, l.kind === 'powerHV' && l.underground ? `${l.label} UG` : l.label, ink);
    }
    const marks: string[] = [];
    const point = (kind: string, lon: number, lat2: number, label?: string) => {
      const [x, y] = proj(lon, lat2);
      if (!inMap([x, y])) return;
      const g = (inner: string) => marks.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${inner}</g>`);
      if (kind === 'stormwaterPit') g(`<rect x="-1.5" y="-1.5" width="3" height="3" fill="#ffffff" stroke="${SERVICE_INK.stormwater}" stroke-width="0.4"/><path d="M-1.5,0H1.5M0,-1.5V1.5" stroke="${SERVICE_INK.stormwater}" stroke-width="0.25"/>`);
      else if (kind === 'substation' || kind === 'transformer') g(`<rect x="-2" y="-2" width="4" height="4" fill="#ffffff" stroke="${SERVICE_INK.cable}" stroke-width="0.45"/><path d="M0.5,-1.5 L-0.9,0.3 H0.7 L-0.5,1.6" fill="none" stroke="${SERVICE_INK.cable}" stroke-width="0.35" stroke-linejoin="round"/>`);
      else if (kind === 'pillar') g(`<rect x="-1.2" y="-1.2" width="2.4" height="2.4" fill="#ffffff" stroke="${SERVICE_INK.cable}" stroke-width="0.4"/>`);
      else if (kind === 'cabinet') g(`<rect x="-1.4" y="-0.8" width="2.8" height="1.6" fill="#8a8a8a" stroke="#ffffff" stroke-width="0.2"/>`);
      else if (kind === 'manhole') { const ink = MANHOLE_INK[label ?? ''] ?? '#6f6f6f'; g(`<circle r="1.5" fill="#ffffff" stroke="${ink}" stroke-width="0.4"/><path d="M-1.06,-1.06L1.06,1.06M1.06,-1.06L-1.06,1.06" stroke="${ink}" stroke-width="0.3"/>`); }
      else return;
      if (label && (kind === 'stormwaterPit' || kind === 'substation')) {
        const w = label.length * SERVICE_TEXT * 0.55;
        const spot = placer.place(x + w / 2 + 2.6, y, w, SERVICE_TEXT, 6);
        if (spot) marks.push(`<text x="${(spot[0] - w / 2).toFixed(1)}" y="${(spot[1] + SERVICE_TEXT * 0.36).toFixed(1)}" font-family="${SERVICE_FONT}" font-size="${SERVICE_TEXT}" font-weight="700" fill="${wordsIn(kind === 'substation' ? SERVICE_INK.cable : SERVICE_INK.stormwater)}">${esc(label)}</text>`);
      }
    };
    for (const pt of services.points) if (pt.kind !== 'lightPole' && pt.kind !== 'powerPole') point(pt.kind, pt.lon, pt.lat, pt.label);
    for (const pt of servicePoints) point(pt.kind, pt.lon, pt.lat, pt.label);
    layers.push(marks.join(''));
  }


  // ---- kerbside parking: one quad per bay, at the kerb the cadastre implies --
  // A bundle from before the bays were set out carries only the tagged runs;
  // set them out here from the same lots so it draws the same way.
  const bands = sb.parkingBands
    ?? buildParkingBands(sb.furniture.parkingLanes, sb.allLots.features.flatMap((f) => geomRings(f.geometry)),
      sb.furniture.driveways.map((d) => d.coords), sb.roads.map((r) => r.coords));
  const bayCount = bands.reduce((n, b) => n + b.bays.length, 0);
  const orientations = new Set(bands.map((b) => b.orientation));
  if (look.parking === 'hatch') {
    // The office's street parking zone: the bays as one hatched strip.
    const d = bands.flatMap((band) => band.bays.map((ring) => pathFromRings([ring], proj))).join('');
    if (d) layers.push(textureSvg('parkHatch', d, 'lines', PARK_INK, { x: 0, y: 0, w: MAP_W, h: MAP_H }, 0.95) +
      `<path d="${d}" fill="${PARK}" fill-opacity="0.18" stroke="${PARK_INK}" stroke-width="0.35" stroke-linejoin="round"/>`);
  } else {
    for (const band of bands) {
      layers.push(`<path d="${band.bays.map((ring) => pathFromRings([ring], proj)).join('')}" fill="${PARK}" fill-opacity="0.35" stroke="${PARK_INK}" stroke-width="0.3" stroke-linejoin="round"/>`);
    }
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
      svg.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${PARK_GREEN}" fill-opacity="0.38" stroke="${PARK_GREEN_INK}" stroke-width="0.35"${src === 'nominal' ? ' stroke-dasharray="1.5,0.9"' : ''}/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.55" fill="${PARK_GREEN_INK}"/>`);
    }
    layers.push(svg.join(''));
  }

  // ---- the trees on the lot and beside it: numbered, with their data -----------
  // A DA's arborist starts from these: each tree within reach of the site,
  // nearest first, numbered T1, T2… on the map and listed in the legend with
  // what its source recorded — species, height, canopy, trunk — and, where a
  // trunk diameter is recorded, its tree protection zone drawn dashed:
  // AS 4970-2009, 12 × DBH, at least 2 m and at most 15 m.
  const nearTrees: { n: number; t: (typeof sb.furniture.trees)[number]; distM: number; tpzM?: number }[] = [];
  {
    const ringM = sb.siteRing.map(([lon, lat2]) => lonLatToMercator({ lon, lat: lat2 }));
    const distM = (lon: number, lat2: number): number => {
      const P = lonLatToMercator({ lon, lat: lat2 });
      let inside = false, best = Infinity;
      for (let i = 0, j = ringM.length - 1; i < ringM.length; j = i++) {
        const a = ringM[j], b = ringM[i];
        if (b.y > P.y !== a.y > P.y && P.x < ((a.x - b.x) * (P.y - b.y)) / (a.y - b.y) + b.x) inside = !inside;
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.y - a.y) * dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(P.x - (a.x + t * dx), P.y - (a.y + t * dy)));
      }
      return inside ? 0 : best / k;
    };
    const cands = sb.furniture.trees
      .filter((t) => inMap(proj(t.lon, t.lat)))
      .map((t) => ({ t, distM: distM(t.lon, t.lat) }))
      .filter((c) => c.distM <= TREE_REACH_M)
      .sort((p, q) => p.distM - q.distM)
      .slice(0, TREE_SCHEDULE_MAX);
    const svg: string[] = [];
    cands.forEach((c, i) => {
      const [x, y] = proj(c.t.lon, c.t.lat);
      const tpzM = c.t.dbhCm ? Math.min(15, Math.max(2, (12 * c.t.dbhCm) / 100)) : undefined;
      if (tpzM) svg.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(tpzM * mmPerM).toFixed(1)}" fill="none" stroke="${PARK_GREEN_INK}" stroke-width="0.35" stroke-dasharray="2,1.2"/>`);
      const label = `T${i + 1}`;
      const spot = placer.place(x + 3.2, y - 3.2, label.length * TREE_TEXT * 0.62, TREE_TEXT, 8);
      if (spot) svg.push(`<text x="${spot[0].toFixed(1)}" y="${(spot[1] + TREE_TEXT * 0.36).toFixed(1)}" text-anchor="middle" font-size="${TREE_TEXT}" font-weight="700" fill="${PARK_GREEN_INK}"${look.textHalo ? ' stroke="#ffffff" stroke-width="0.9" paint-order="stroke"' : ''}>${label}</text>`);
      nearTrees.push({ n: i + 1, t: c.t, distM: c.distM, tpzM });
    });
    layers.push(svg.join(''));
  }

  // ---- street furniture ------------------------------------------------------
  layers.push(sb.furniture.hydrants.map((p) => proj(p.lon, p.lat)).filter(inMap)
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" fill="#1f78d1"/>`)
    .join(''));
  const poles = [...sb.furniture.powerPoles];
  for (const pt of services.points) {
    if (pt.kind !== 'powerPole') continue;
    const P = lonLatToMercator({ lon: pt.lon, lat: pt.lat });
    if (!sb.furniture.powerPoles.some((q) => { const Q = lonLatToMercator(q); return Math.hypot(Q.x - P.x, Q.y - P.y) < 3 * k; })) poles.push({ lon: pt.lon, lat: pt.lat });
  }
  layers.push(poles.map((p) => proj(p.lon, p.lat)).filter(inMap)
    .map(([x, y]) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><line x1="-1.8" y1="0" x2="1.8" y2="0" stroke="#333" stroke-width="0.3"/><circle r="0.9" fill="none" stroke="#333" stroke-width="0.35"/></g>`)
    .join(''));
  const lamps = [...sb.furniture.streetLamps];
  for (const pt of services.points) {
    if (pt.kind !== 'lightPole') continue;
    const P = lonLatToMercator({ lon: pt.lon, lat: pt.lat });
    if (!sb.furniture.streetLamps.some((q) => { const Q = lonLatToMercator(q); return Math.hypot(Q.x - P.x, Q.y - P.y) < 3 * k; })) lamps.push({ lon: pt.lon, lat: pt.lat });
  }
  layers.push(lamps.map((p) => proj(p.lon, p.lat)).filter(inMap)
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
    placer.reserve(cx0, cy0, 56 * look.textScale, 24 * look.textScale);
  }

  // ---- neighbours: the address and the storeys on each building ------------
  // Two short lines on the building: its street number(s) and its storeys,
  // "26" over "3ST". The zone is the hatch under it. Storeys come from
  // Overture (its count, or its measured height at 3.1 m a storey), else
  // OpenStreetMap's building:levels; a building with no height anywhere
  // keeps its number and no storey line rather than a guess. A building with
  // a height but no address point still gets its storeys.
  let storeyLabels = 0, heightLabels = 0;
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
    interface Bld { x: number; y: number; lon: number; lat: number; st?: number; area: number; d: string; ring: Pt[]; bbox: [number, number, number, number]; numbers: string[] }
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
      blds.push({ x, y, lon: b.centroid[0], lat: b.centroid[1], st, area, d: pathFromRings(b.rings, proj), ring, bbox: [x0, y0, x1, y1], numbers: [] });
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
    const loose: { x: number; y: number; lon: number; lat: number; n: string; st?: number }[] = [];
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
      else loose.push({ x, y, lon: n.lon, lat: n.lat, n: num, st: osmLevelsNear(n.lon, n.lat, 25) });
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
    interface Lbl { x: number; y: number; lon: number; lat: number; lines: [string, string]; st?: number; area: number; d: string }
    const cands: Lbl[] = [];
    for (const b of blds) {
      if (!inMap([b.x, b.y])) continue;
      const num = numberLine(b.numbers);
      const st = b.st ? `${b.st}ST` : '';
      if (!num && !st) continue;
      cands.push({ x: b.x, y: b.y, lon: b.lon, lat: b.lat, lines: [num, st], st: b.st, area: b.area + (num ? 10000 : 0), d: b.d });
    }
    for (const l of loose) cands.push({ x: l.x, y: l.y, lon: l.lon, lat: l.lat, lines: [l.n, l.st ? `${l.st}ST` : ''], st: l.st, area: 5000, d: '' });
    // Addressed and big buildings first, so when two crowd each other the
    // block of flats keeps its label and the garage gives way.
    cands.sort((p, q) => q.area - p.area);
    const outlines: string[] = [];
    const texts: string[] = [];
    const fs = NEIGHBOUR_TEXT, lh = fs * 1.12;
    if (look.neighbours === 'black') {
      // The number and the storeys in black, then the height limit at the
      // building in the second ink, written straight on the map: the zone is
      // the colour under it.
      const bfs = STACKED_TEXT, blh = bfs * 1.14;
      for (const c of cands) {
        const h = featureAt(sb.heights?.features ?? [], c.lon, c.lat);
        const black = [c.lines[0] ? `NO. ${c.lines[0]}` : '', c.st ? `${c.st} ${c.st > 1 ? 'STOREYS' : 'STOREY'}` : ''].filter(Boolean);
        const hob = Number(h?.MAX_B_H);
        const hasHob = Number.isFinite(hob) && hob > 0;
        const lines = [...black, ...(hasHob ? [heightLine(hob, h?.UNITS)] : [])];
        // Arial's capitals run about 0.66 of the size in bold, 0.6 in regular.
        const w = Math.max(...lines.map((t, i) => t.length * bfs * (i < black.length ? 0.66 : 0.6))) + 3, ht = lines.length * blh + 1.6;
        const spot = placer.place(c.x, c.y, w, ht, 10, 0, { w: MAP_W, h: MAP_H });
        if (!spot) continue;
        if (c.d) outlines.push(`<path d="${c.d}"/>`);
        const y0 = spot[1] - ((lines.length - 1) * blh) / 2 + bfs * 0.36;
        lines.forEach((t, i) => texts.push(`<text x="${spot[0].toFixed(1)}" y="${(y0 + i * blh).toFixed(1)}" text-anchor="middle" font-size="${bfs}" font-weight="${i < black.length ? 700 : 400}" fill="${i < black.length ? '#111111' : look.neighbourHeightInk}">${esc(t)}</text>`));
        if (c.st) storeyLabels++;
        if (hasHob) heightLabels++;
      }
      cands.length = 0;
    }
    for (const c of cands) {
      const lines = c.lines.filter(Boolean);
      const w = Math.max(...lines.map((t) => t.length)) * fs * 0.5 + 1.5, h = lines.length * lh + 0.8;
      const spot = placer.place(c.x, c.y, w, h, 6);
      if (!spot) continue;
      if (c.d) outlines.push(`<path d="${c.d}"/>`);
      const y0 = spot[1] - ((lines.length - 1) * lh) / 2 + fs * 0.36;
      lines.forEach((t, i) => {
        const isStorey = /ST$/.test(t) && i === lines.length - 1 && !!c.lines[1];
        texts.push(`<text x="${spot[0].toFixed(1)}" y="${(y0 + i * lh).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${look.neighbourInk ?? '#ffffff'}"${isStorey ? ' opacity="0.8"' : ''}>${esc(t)}</text>`);
      });
      if (c.lines[1]) storeyLabels++;
    }
    // A white building already carries its family's hairline; a white outline would rub it out.
    if (!whiteBuildings)
      layers.push(`<g fill="none" stroke="#ffffff" stroke-width="${look.buildingEdge}" stroke-opacity="0.95" stroke-linejoin="round">${outlines.join('')}</g>`);
    layers.push(texts.join(''));
  }

  // ---- street names: plain text along the road ---------------------------------
  const best = new Map<string, { pts: Pt[]; len: number }>();
  for (const road of sb.roads) {
    const pts = road.coords.map(([lon, lat2]) => proj(lon, lat2))
      .filter(([x, y]) => x > -40 && x < MAP_W + 40 && y > -40 && y < MAP_H + 40);
    if (pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const cur = best.get(road.name);
    if (!cur || len > cur.len) best.set(road.name, { pts, len });
  }
  const siteRoadDefs: string[] = [];
  let srid = 0;
  for (const [name, r] of best) {
    const label = shortStreetName(name);
    const SITE_STREET = MAP_TEXT;
    // A street name as plain bold text along the road, set on the straight
    // chord through the middle of the longest run, since a road's own
    // vertices jog too much to carry text along directly.
    const plainLen = label.length * (SITE_STREET * 0.6 + 0.6) + 3;
    const across = SITE_STREET;
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
      const W = Math.abs(plainLen * Math.cos(ang2)) + Math.abs(across * Math.sin(ang2));
      const H = Math.abs(plainLen * Math.sin(ang2)) + Math.abs(across * Math.cos(ang2));
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
  layers.push(`<path d="${dSite}" fill="none" stroke="${SITE_RED}" stroke-width="1.15" stroke-dasharray="${look.siteDash}"/>`);
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
      text-anchor="middle" font-size="${MAP_TEXT}" font-weight="700" fill="${look.dimensionInk}">${txt}</text>`);
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
    // Without the box, a theme can give the words a fine white edge to keep
    // them clear of a dark roof, or set them plain (on paper there is no roof).
    const edge = look.fallWords === 'edge' ? ' stroke="#ffffff" stroke-width="0.6" stroke-opacity="0.85" paint-order="stroke" stroke-linejoin="round"' : '';
    layers.push(`<g transform="translate(${centroidPx[0].toFixed(1)},${centroidPx[1].toFixed(1)}) rotate(${ang.toFixed(1)})">
      ${look.fallWords === 'box' ? `<rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffffff" fill-opacity="0.9"/>` : ''}
      ${lines.map((t, i) => `<text x="0" y="${(-h / 2 + 1 + lh * (i + 0.8)).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${look.fallInk}"${edge}>${esc(t)}</text>`).join('')}
    </g>`);
  }

  // ---- sun and wind, one hand ---------------------------------------------------
  // Drawn as a pair, in the site's deep red and the same open white-filled
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
  const PEN = look.windPen;
  const PEN_W = 0.7;
  const LETTER = MAP_TEXT;
  // The climate marks' words: in the pen, slightly heavy, for Heron; plain for Canary.
  const INK = look.climateInk;
  const heavy = INK === PEN ? ` stroke="${INK}" stroke-width="0.22"` : '';
  const textBlock = (x: number, y: number, lines: string[]) =>
    lines.map((t, i) => `<text x="${x.toFixed(1)}" y="${(y + i * LETTER * 1.12).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${INK}"${heavy}>${esc(t)}</text>`).join('');
  // The sun's words in its own ink, as heavy as the winds' when it is the pen's.
  const SUN_INK = look.sunInk;
  const sunHeavy = SUN_INK === look.sunEdge ? ` stroke="${SUN_INK}" stroke-width="0.22"` : '';
  const sunBlock = (x: number, y: number, lines: string[]) =>
    lines.map((t, i) => `<text x="${x.toFixed(1)}" y="${(y + i * LETTER * 1.12).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${SUN_INK}"${sunHeavy}>${esc(t)}</text>`).join('');

  if (look.sun === 'crown') {
    layers.push(`<path d="${arcPath(summerAz, -summerAz, Ro)}" fill="none" stroke="${look.sunPen}" stroke-width="1.4" stroke-linecap="round"/>`);
    layers.push(`<path d="${arcPath(winterAz, -winterAz, Ri)}" fill="none" stroke="${look.sunPen}" stroke-width="1.4" stroke-dasharray="5,2.6" stroke-linecap="round"/>`);
  }
  // The office's drawn suns sit on dashed arcs, summer dashed and winter
  // dotted, and where the winds are drawn too, the summer ring goes on round
  // the side the sun never reaches dashed in the wind's pen: the winds' ring.
  if (look.sun === 'drawn') {
    layers.push(`<path d="${arcPath(summerAz, -summerAz, Ro)}" fill="none" stroke="${look.sunPen}" stroke-width="1.3" stroke-dasharray="7,3.5"/>`);
    layers.push(`<path d="${arcPath(winterAz, -winterAz, Ri)}" fill="none" stroke="${look.sunPen}" stroke-width="1.6" stroke-dasharray="0.1,3" stroke-linecap="round"/>`);
    if (look.wind === 'drawn')
      layers.push(`<path d="${arcPath(summerAz + 4, 360 - summerAz - 4, Ro)}" fill="none" stroke="${look.windPen}" stroke-width="1.3" stroke-dasharray="7,3.5"/>`);
  }
  // Or each solstice's path a translucent crescent, deepest at noon, from the
  // yellow of its ends to the yellow-green of its middle.
  if (look.sun === 'band') {
    const [from, to] = look.marks!.sunBand;
    const page = (az: number) => az + view.rotationDeg;
    [[summerAz, Ro], [winterAz, Ri]].forEach(([az, R], i) => {
      const [x0, y0] = sunAt(az, R), [x1, y1] = sunAt(-az, R), [xn, yn] = sunAt(0, R);
      layers.push(`<defs><linearGradient id="sunBand${i}" gradientUnits="userSpaceOnUse" x1="${((x0 + x1) / 2).toFixed(1)}" y1="${((y0 + y1) / 2).toFixed(1)}" x2="${xn.toFixed(1)}" y2="${yn.toFixed(1)}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
        `<path d="${crescentD(centroidPx, R, page(-az), page(az), SUN_BAND_W)}" fill="url(#sunBand${i})" fill-opacity="${SUN_BAND_OPACITY}"/>`);
    });
  }
  // The winds' crescents go down before the suns, so a sun from the same
  // quarter stands on its wind's band rather than under it.
  const windOuter = Ro + WIND_BAND_W / 2;
  if (look.wind === 'band')
    for (const w of ringWinds) {
      const a = w.az + view.rotationDeg;
      layers.push(`<path d="${crescentD(centroidPx, windOuter, a - WIND_BAND_SPAN, a + WIND_BAND_SPAN, WIND_BAND_W)}" fill="${look.marks!.windBand}" fill-opacity="${WIND_BAND_OPACITY}"/>`);
    }
  // The hours along each arc: a dot where the sun stands at each solar hour,
  // its time beside it (inside the winter arc, outside the summer one). An
  // hour that falls on a sunrise or sunset drawing is left to the sun.
  if (look.sunHours) {
    const hrs = solsticeHours(lat);
    const marks: string[] = [];
    const put = (list: { az: number; label: string }[], R: number, labelR: number, edgeAz: number) => {
      for (const m of list) {
        if (Math.abs(Math.abs(m.az) - edgeAz) < 9) continue;
        const [x, y] = sunAt(m.az, R);
        const [lx, ly] = sunAt(m.az, labelR);
        marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#ffffff" stroke="${look.sunPen}" stroke-width="${PEN_W}"/>` +
          `<text x="${lx.toFixed(1)}" y="${(ly + LETTER * 0.36).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${SUN_INK}"${sunHeavy}>${m.label}</text>`);
      }
    };
    put(hrs.winter, Ri, Ri - 10, winterAz);
    put(hrs.summer, Ro, Ro + 10, summerAz);
    layers.push(marks.join(''));
  }
  // The sun: an open jagged crown in the pen, white inside, round a plain
  // circle. Twelve teeth of uneven length, and the four on the diagonals
  // drawn out as short, broad flames with one gentle bend, after the
  // manuscript suns. Each sun is drawn from its own seed, so the four differ
  // a little, as if drawn one by one.
  const sketchSun = ([x, y]: Pt, lines: string[], seed: number) => {
    let st = seed * 9301 + 49297;
    const rnd = () => { st = (st * 9301 + 49297) % 233280; return st / 233280; };
    const n = 12, rBase = 12.4, flames = [1, 4, 7, 10];
    const P = (r: number, a: number): Pt => [r * Math.cos(a), r * Math.sin(a)];
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, h = (Math.PI / n) * 0.85;
      const f = flames.indexOf(i);
      if (f < 0) {
        pts.push(P(rBase + rnd() * 0.8, a - h), P(18 + rnd() * 4, a + (rnd() - 0.5) * 0.12));
        continue;
      }
      // A flame: its centre line leaves the crown radially and bends once,
      // its width falling from a little over the tooth's base to a point;
      // neighbouring flames bend opposite ways.
      const L = 8.5, w0 = rBase * Math.sin(h) * 1.2, amp = 0.5 * (f % 2 ? -1 : 1);
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, N = 10;
      const side = (sgn: number) => Array.from({ length: N + 1 }, (_, k) => {
        const t = k / N, off = amp * Math.sin(t * Math.PI * 1.5), w = w0 * Math.pow(1 - t, 0.8) + 0.12;
        const r = rBase * Math.cos(h) + L * t;
        return [ux * r + nx * (off + sgn * w), uy * r + ny * (off + sgn * w)] as Pt;
      });
      pts.push(...side(-1), ...side(1).reverse());
    }
    return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
      <path d="M${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}Z" fill="${look.sunFill}" fill-opacity="0.9" stroke="${look.sunEdge}" stroke-width="${PEN_W}" stroke-linejoin="round"/>
      <circle r="9.6" fill="${look.sunFill}" stroke="${look.sunEdge}" stroke-width="${PEN_W}"/>
      ${sunBlock(0, 28, lines)}</g>`;
  };
  if (look.sun === 'crown' || drawnSun) {
  // The office's suns: drawn, the sun solid in the ink of its name; banded,
  // the small rayed sun, solid, at the crescent's point; each with its name under it.
  const officeSun = ([x, y]: Pt, lines: string[]) => {
    const sun = look.sun === 'drawn'
      ? `<path transform="scale(${DRAWN_SUN_R})" d="${SUN}" fill="${SUN_INK}" stroke="${SUN_INK}" stroke-width="${(DRAWN_EDGE / DRAWN_SUN_R).toFixed(4)}" stroke-linejoin="round"/>`
      : `<path transform="scale(${RAY_SUN_R})" d="${RAY_SUN}" fill="${look.sunFill}"/>`;
    return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">${sun}${sunBlock(0, sunR + 8, lines)}</g>`;
  };
  const mark = drawnSun ? officeSun : sketchSun;
  layers.push(mark(sunAt(winterAz, Ri), ['WINTER', 'SUNRISE'], 1));
  layers.push(mark(sunAt(-winterAz, Ri), ['WINTER', 'SUNSET'], 2));
  layers.push(mark(sunAt(summerAz, Ro), ['SUMMER', 'SUNRISE'], 3));
  layers.push(mark(sunAt(-summerAz, Ro), ['SUMMER', 'SUNSET'], 4));
  {
    // North sits just beyond the summer noon mark and its label.
    const [nx, ny] = sunAt(0, Ro + 24);
    layers.push(`<g transform="translate(${nx.toFixed(1)},${ny.toFixed(1)})"><circle r="6.4" fill="#ffffff" stroke="${look.sunEdge}" stroke-width="${PEN_W}"/>
      <text text-anchor="middle" dy="2.3" font-size="6.2" font-weight="700" fill="${SUN_INK}"${sunHeavy}>N</text></g>`);
  }
  }

  // The climate circle: one dashed ring about the site in the climate pen.
  // Inside it the views, each named over a white band on its sight line, and
  // further in the four suns where they rise and set at the solstices, each
  // a plain sun with its name; north an arrowhead standing out of the ring.
  // Around it the winds, each named over a hatched band on the quarter it
  // blows from.
  if (look.sun === 'circle' || look.wind === 'circle' || look.views === 'circle') {
    const c = centroidPx, R = climateRadius(c, ringPx);
    const page = (az: number) => az + view.rotationDeg;
    const defs: string[] = [];
    const cap = LETTER * 0.72;
    layers.push(`<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${R.toFixed(1)}" fill="none" stroke="${PEN}" stroke-width="0.6" stroke-dasharray="3.2,1.8"/>`);
    if (look.views === 'circle')
      viewsOnCircle(sb.views ?? [], R - VIEW_BAND - 6, LETTER).forEach(({ v, label, span }, i) => {
        const a = page(v.bearingDeg);
        const band = `${arcD(c, R, a - VIEW_SPAN, a + VIEW_SPAN)} ${arcD(c, R - VIEW_BAND, a + VIEW_SPAN, a - VIEW_SPAN, false)} Z`;
        layers.push(`<path d="${band}" fill="#ffffff" fill-opacity="0.9" stroke="${look.viewPen}" stroke-width="0.35"/>`);
        defs.push(`<path id="vw${i}" d="${aroundD(c, R - VIEW_BAND - 2 - cap, a, span + 6, cap)}"/>`);
        layers.push(`<text font-size="${LETTER}" font-weight="700" letter-spacing="0.6" fill="${look.viewPen}"><textPath href="#vw${i}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`);
      });
    if (look.sun === 'circle') {
      // The two solstices' paths through their suns: arcs of circles about
      // the site, each the climate circle drawn smaller, from the sunrise
      // over north to the sunset. Summer's (solid) this far in, winter's
      // (dashed, shorter than the climate circle's dash) a step further.
      const rSummer = R - SUN_INSET, rWinter = rSummer - SUN_PATH_STEP;
      layers.push(`<g fill="none" stroke="${look.sunPen}" stroke-width="0.7" stroke-linecap="round">` +
        `<path d="${arcD(c, rSummer, page(-summerAz), page(summerAz))}"/>` +
        `<path d="${arcD(c, rWinter, page(-winterAz), page(winterAz))}" stroke-dasharray="1.4,1.6"/></g>`);
      const suns: [number, number, string[]][] = [
        [winterAz, rWinter, ['WINTER', 'SUNRISE']], [-winterAz, rWinter, ['WINTER', 'SUNSET']],
        [summerAz, rSummer, ['SUMMER', 'SUNRISE']], [-summerAz, rSummer, ['SUMMER', 'SUNSET']],
      ];
      for (const [az, r, name] of suns) {
        const [lx, ly] = sunNameAt(c, r, page(az));
        layers.push(sunMark(onCircle(c, r, page(az)), look.sunEdge, look.sunFill, SUN_SIZE) +
          name.map((t, i) => `<text x="${lx.toFixed(1)}" y="${(ly + (i - (name.length - 1) / 2) * LETTER * 1.12 + LETTER * 0.36).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${SUN_INK}">${t}</text>`).join(''));
      }
      // North: an arrowhead standing out of the ring, N beyond its point.
      const a = page(0), ar = (a * Math.PI) / 180, tx = Math.cos(ar) * 3, ty = Math.sin(ar) * 3;
      const [bx, by] = onCircle(c, R + 1, a), [px, py] = onCircle(c, R + 12, a), [nx, ny] = onCircle(c, R + 17.5, a);
      layers.push(`<path d="M${(bx - tx).toFixed(1)},${(by - ty).toFixed(1)}L${px.toFixed(1)},${py.toFixed(1)}L${(bx + tx).toFixed(1)},${(by + ty).toFixed(1)}Z" fill="${look.sunPen}"/>` +
        `<text x="${nx.toFixed(1)}" y="${(ny + LETTER * 0.36).toFixed(1)}" text-anchor="middle" font-size="${LETTER}" font-weight="700" fill="${SUN_INK}">N</text>`);
    }
    if (look.wind === 'circle')
      WINDS.forEach((w, i) => {
        const a = page(w.bearing);
        const band = `${arcD(c, R + WIND_BAND, a - WIND_SPAN, a + WIND_SPAN)} ${arcD(c, R, a + WIND_SPAN, a - WIND_SPAN, false)} Z`;
        const edge = Array.from({ length: 12 }, (_, k) => a - WIND_SPAN + (k / 11) * WIND_SPAN * 2)
          .flatMap((d) => [onCircle(c, R, d), onCircle(c, R + WIND_BAND, d)]);
        const xs = edge.map((p) => p[0]), ys = edge.map((p) => p[1]);
        const box = { x: Math.min(...xs) - 1, y: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 2, h: Math.max(...ys) - Math.min(...ys) + 2 };
        layers.push(textureSvg(`wind${i}`, band, 'lines', PEN, box, 1) + `<path d="${band}" fill="none" stroke="${PEN}" stroke-width="0.35"/>`);
        const name = w.label.join(' ');
        const r = R + WIND_BAND + 2.4;
        const span = ((name.length * LETTER * 0.7) / 2 / r) * (180 / Math.PI) + 8;
        defs.push(`<path id="wnd${i}" d="${aroundD(c, r, a, span, cap)}"/>`);
        layers.push(`<text font-size="${LETTER}" font-weight="700" letter-spacing="0.6" fill="${INK}"><textPath href="#wnd${i}" startOffset="50%" text-anchor="middle">${esc(name)}</textPath></text>`);
      });
    if (defs.length) layers.push(`<defs>${defs.join('')}</defs>`);
  }
  // The office's winds on the ring, each pointing in at the site, its name
  // just outside the ring. Drawn, the wind solid in the ink of its name; banded, three
  // white arrows on the blue crescent (laid down above, before the suns).
  ringWinds.forEach((w) => {
    if (look.wind === 'drawn') {
      layers.push(`<path transform="translate(${w.at[0].toFixed(1)},${w.at[1].toFixed(1)}) rotate(${w.deg.toFixed(1)}) scale(${DRAWN_WIND_HALF})" d="${WIND}" fill="${INK}" stroke="${INK}" stroke-width="${(DRAWN_EDGE / DRAWN_WIND_HALF).toFixed(4)}" stroke-linejoin="round"/>`);
    } else {
      const a = w.az + view.rotationDeg;
      for (const off of [-WIND_BAND_SPAN * 0.42, 0, WIND_BAND_SPAN * 0.42]) {
        // Each arrow in the middle of the crescent's depth where it stands.
        const depth = WIND_BAND_W * Math.sin(Math.PI * (0.5 + off / (2 * WIND_BAND_SPAN)));
        const [x, y] = onCircle(centroidPx, windOuter - depth / 2, a + off);
        const deg = (Math.atan2(centroidPx[1] - y, centroidPx[0] - x) * 180) / Math.PI;
        layers.push(`<path transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${ARROW_HALF})" d="${ARROW}" fill="#ffffff"/>`);
      }
    }
    layers.push(textBlock(w.labelAt[0], w.labelAt[1] - ((w.label.length - 1) * LETTER * 1.12) / 2 + LETTER * 0.36, w.label));
  });
  const winds = look.wind === 'strands' ? WINDS.map((w) => ({ at: windEntry(centroidPx, w.bearing, view.rotationDeg), label: w.label })) : [];
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
    const lines = wrapLabel(label, 26);
    lines.forEach((l, i) => {
      r2 += `<text x="${LABEL_X}" y="${3.5 + i * 3.2}" font-size="${T.legend}" fill="#222">${esc(l)}</text>`;
    });
    // A label run onto a second line pushes its note down under it.
    const extra = sub ? (lines.length - 1) * 3.2 : 0;
    if (sub) r2 += `<text x="${LABEL_X}" y="${(6.7 + extra).toFixed(1)}" font-size="${T.legend * 0.85}" fill="#555">${esc(sub)}</text>`;
    legendSvg += r2 + '</g>';
    ly += 10 + extra;
  };
  const mid = SWATCH_X + SWATCH_W / 2;
  const legendDash = look.siteDash.split(',').map((v) => (Number(v) * 0.64).toFixed(2)).join(',');
  row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${SITE_RED}" stroke-width="0.9" stroke-dasharray="${legendDash}"/>`, 'SITE');
  row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${BLUE()}" stroke-width="0.8" stroke-dasharray="4,1.6"/><path d="M${SWATCH_X + SWATCH_W - 4},1.2 L${SWATCH_X + SWATCH_W},3.2 L${SWATCH_X + SWATCH_W - 4},5.2" fill="none" stroke="${BLUE()}" stroke-width="0.8"/>`, 'FALL OF TERRAIN');
  if (kerbs.length) {
    const measured = kerbs.some((kl) => kl.from === 'footway'), mapped = kerbs.some((kl) => kl.from === 'osm');
    row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#8a8a8a" stroke-width="0.35"/>`,
      'KERB LINE (INDICATIVE)', mapped ? 'OSM kerbs where mapped; elsewhere a footpath in from the boundary'
        : measured ? 'footpath width from OSM footpaths where mapped, typical elsewhere' : 'a typical footpath width in from the boundary; not surveyed');
  }
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${look.dimensionInk}">SB 30.48</text>`, 'BOUNDARY DIMENSION (m)');
  row(`<text x="${SWATCH_X}" y="5.4" font-size="3.2" font-weight="700" fill="${SITE_RED}">RL 24.5</text>`, 'SURFACE LEVEL (AHD)');
  if (look.contours && sb.contours.length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${look.contourInk}" stroke-width="0.6"/><text x="${SWATCH_X + 1}" y="2.2" font-size="2.2" font-weight="700" fill="${look.contourInk}">RL 20</text>`, `CONTOURS AT ${sb.contourIntervalM ?? 2} m AHD`, sb.contourSource);
  if (look.neighbours === 'black') {
    row(`<g><text x="${mid}" y="2.6" text-anchor="middle" font-size="2.1" font-weight="700" fill="#111">NO. 26 · 3 STOREYS</text><text x="${mid}" y="5.2" text-anchor="middle" font-size="2.1" fill="${look.neighbourHeightInk}">HOB = 18m</text></g>`,
      'NEIGHBOUR IDENTIFICATION',
      ['number', storeyLabels ? 'storeys' : '', heightLabels ? 'HOB' : ''].filter(Boolean).join(', ') +
        (storeyLabels ? (sb.buildings?.source === 'overture' ? '; storeys from Overture' : '; storeys from OSM') : ''));
  } else
  row(`<g>${whiteBuildings && look.buildingHatch ? `${buildingHatch('lbldHatch', tpl().road)}<rect x="${SWATCH_X + SWATCH_W / 2 - 5}" y="0" width="10" height="6.5" fill="#ffffff"/>` : ''}<rect x="${SWATCH_X + SWATCH_W / 2 - 5}" y="0" width="10" height="6.5" fill="${whiteBuildings ? (look.buildingHatch ? 'url(#lbldHatch)' : '#ffffff') : look.buildings === 'colour' ? '#c2c2bc' : '#8a8a8a'}"${whiteBuildings ? ` stroke="${tpl().road}" stroke-width="0.2"` : ''}/><text x="${SWATCH_X + SWATCH_W / 2}" y="2.8" text-anchor="middle" font-size="2.6" font-weight="700" fill="${look.neighbourInk ?? '#ffffff'}">26</text>${storeyLabels ? `<text x="${SWATCH_X + SWATCH_W / 2}" y="5.8" text-anchor="middle" font-size="2.6" font-weight="700" fill="${look.neighbourInk ?? '#ffffff'}" opacity="0.8">3ST</text>` : ''}</g>`,
    storeyLabels ? 'NEIGHBOUR: NUMBER, STOREYS' : 'NEIGHBOUR: STREET NUMBER',
    storeyLabels ? (sb.buildings?.source === 'overture' ? 'storeys from Overture Maps, OSM levels where it has none' : 'storeys from OpenStreetMap building levels') : undefined);
  // The zones, in the legend's category order, with the context sheet's swatch.
  {
    let stex = 0;
    const swD = `M${SWATCH_X},0h${SWATCH_W}v6.5h${-SWATCH_W}Z`;
    for (const c of tpl().categories) {
      if (!usedZoneCats.has(c.id)) continue;
      if (look.zones === 'fill') {
        // The context sheet's swatch: the ground, its texture, and two
        // buildings in the family's strong colour standing on it.
        const ground = `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${c.fill}" opacity="${c.opacity.toFixed(2)}"${c.stroke ? ` stroke="${c.stroke}" stroke-width="0.4"` : ''}/>`;
        const texture = c.texture ? textureSvg(`sltx${stex++}`, swD, c.texture, c.textureColor ?? c.stroke ?? c.fill, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }) : '';
        const blocks = `<rect x="${SWATCH_X + 2}" y="1.3" width="6" height="3.9"/><rect x="${SWATCH_X + 10}" y="1.3" width="4.4" height="2.6"/>`;
        const figures = look.buildings === 'colour' && c.figure && c.figure !== c.fill
          ? `<g fill="${c.figure}" stroke="#ffffff" stroke-width="0.3">${blocks}</g>`
          : whiteBuildings && c.figure ? `<g fill="#ffffff" stroke="${c.figure}" stroke-width="0.5">${blocks}</g>` : '';
        row(ground + texture + figures, c.label);
        continue;
      }
      const ink = zoneInk(c);
      const kind = c.texture === 'dots' || c.texture === 'cross' ? c.texture : 'lines';
      row((look.zoneTint ? `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${c.fill}" opacity="${look.zoneTint}"/>` : '') +
        textureSvg(`sltx${stex++}`, swD, kind, ink, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }, Math.min(1, 0.65 + c.opacity * 0.5)) +
        `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${ink}" stroke-width="0.4"/>`, c.label);
    }
  }
  // Or the ePlanning zones, keyed by code and name in the LEP's order, with Conure's swatch.
  for (const [code, z] of [...lepZones].sort(([a], [b]) => zoneOrder(a) - zoneOrder(b) || a.localeCompare(b)))
    row(`<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="${zoneFill(code)}" stroke="#999" stroke-width="0.2"/>`,
      `${code} ${z.name.replace(new RegExp(`^${code}\\s*`, 'i'), '')}`.toUpperCase());
  for (const kind of ['item', 'area'] as const) {
    if (!heritageKinds.has(kind)) continue;
    const swD = `M${SWATCH_X},0h${SWATCH_W}v6.5h${-SWATCH_W}Z`;
    const ink = look.heritageInk[kind];
    row(textureSvg(`lher${kind}`, swD, 'lines', ink, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }, 0.9) +
      `<rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5" fill="none" stroke="${ink}" stroke-width="0.4"/>`,
      kind === 'item' ? 'HERITAGE ITEM' : 'HERITAGE CONSERVATION AREA', 'from the LEP heritage map');
  }
  if (bayCount && look.parking === 'hatch') {
    const swD = `M${SWATCH_X},1h${SWATCH_W}v4.6h${-SWATCH_W}Z`;
    const kinds = [...orientations].map((o) => BAY_LABEL[o]).join(', ');
    row(textureSvg('lpark', swD, 'lines', PARK_INK, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }, 0.95) +
      `<path d="${swD}" fill="${PARK}" fill-opacity="0.18" stroke="${PARK_INK}" stroke-width="0.35"/>`, 'STREET PARKING ZONE', `${bayCount} bays, ${kinds}, from OSM tags`);
  } else if (bayCount) {
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
    row(`<circle cx="${mid}" cy="3.2" r="2.8" fill="${PARK_GREEN}" fill-opacity="0.45" stroke="${PARK_GREEN_INK}" stroke-width="0.4"/><circle cx="${mid}" cy="3.2" r="0.5" fill="${PARK_GREEN_INK}"/>`, 'TREES, CANOPY TO SCALE', sub);
  }
  if (nearTrees.length) {
    // The schedule: one line a tree, in columns, under a row that keys the numbers and the zone.
    const sources = [...new Set(nearTrees.map((x) => (x.t.source === 'osm' ? 'OpenStreetMap' : TREE_SOURCES.find((s2) => s2.id === x.t.source)?.name ?? x.t.source)))].join('; ');
    row(`<text x="${SWATCH_X + 1}" y="4.6" font-size="3.4" font-weight="700" fill="${PARK_GREEN_INK}">T1</text><circle cx="${SWATCH_X + 15}" cy="3.2" r="3" fill="none" stroke="${PARK_GREEN_INK}" stroke-width="0.35" stroke-dasharray="1.4,0.8"/>`,
      'TREES BY THE SITE', `within ${TREE_REACH_M} m · TPZ dashed, 12 × DBH (AS 4970-2009)`);
    const cols = [0, 6, 44, 52, 60, 70].map((c) => SWATCH_X + c);
    const fs = 2.15, lh = 3.3;
    const cell = (x: number, y: number, t: string, bold = false, ink = '#222') => `<text x="${x}" y="${y.toFixed(2)}" font-size="${fs}"${bold ? ' font-weight="700"' : ''} fill="${ink}">${esc(t)}</text>`;
    let yy = ly + 1;
    legendSvg += ['', 'TREE', 'H m', 'C m', 'DBH cm', 'TPZ m'].map((h, i) => cell(cols[i], yy, h, true, '#666')).join('');
    for (const x of nearTrees) {
      yy += lh;
      const name = (x.t.common || x.t.species || 'species not recorded').replace(/\s+/g, ' ');
      const fig = (v?: number) => (v ? (v >= 10 ? Math.round(v).toString() : v.toFixed(1)) : '–');
      legendSvg += cell(cols[0], yy, `T${x.n}`, true, PARK_GREEN_INK) + cell(cols[1], yy, name.length > 30 ? `${name.slice(0, 29)}…` : name) +
        cell(cols[2], yy, fig(x.t.heightM)) + cell(cols[3], yy, x.t.canopySource === 'nominal' ? '–' : fig(x.t.canopyM)) +
        cell(cols[4], yy, x.t.dbhCm ? String(Math.round(x.t.dbhCm)) : '–') + cell(cols[5], yy, fig(x.tpzM));
    }
    legendSvg += cell(cols[0], yy + lh, `from ${sources}`, false, '#666');
    ly = yy + lh + 6;
  } else {
    // Said, not left out: outside a council with an open register (Parramatta
    // has none) the trees are OpenStreetMap's, often none at all.
    row('', 'TREES: NONE IN OPEN DATA', `none mapped within ${TREE_REACH_M} m; survey or arborist to confirm`);
  }
  if ((sb.views ?? []).some((v) => v.cone) && look.views === 'circle') {
    row(`<path d="M${SWATCH_X},1.2h${SWATCH_W}v4h${-SWATCH_W}Z" fill="#ffffff" stroke="${look.viewPen}" stroke-width="0.3"/>`, 'POTENTIAL VIEW', `named around the circle; terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up`);
  } else if ((sb.views ?? []).some((v) => v.cone) && look.views === 'drawn') {
    row(`<path transform="translate(${SWATCH_X + 7},3.2) scale(6.4)" d="${VIEW}" fill="${look.viewPen}" stroke="${look.viewPen}" stroke-width="${(0.25 / 6.4).toFixed(4)}" stroke-linejoin="round"/>`, 'POTENTIAL VIEW', `terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up; no buildings`);
  } else if ((sb.views ?? []).some((v) => v.cone) && look.views === 'band') {
    row(`<path d="M${SWATCH_X + 5},3.2 L${SWATCH_X + 16},0.2 L${SWATCH_X + 16},6.2 Z" fill="${look.marks!.view}" fill-opacity="${BAND_VIEW_OPACITY}"/>` +
      `<path transform="translate(${SWATCH_X + 12.6},3.2) rotate(90) scale(1.9)" d="${EYE}" fill="#ffffff"/>`, 'POTENTIAL VIEW', `terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up; no buildings`);
  } else if ((sb.views ?? []).some((v) => v.cone)) {
    row(`<g transform="translate(${SWATCH_X + 11},3.2) rotate(-14) scale(0.62)" fill="#fff" stroke="${look.viewPen}" stroke-width="0.7" stroke-linejoin="round"><path d="M-7,-1.7 L6,-2.6 L6,2.6 L-7,1.7 Z"/><rect x="6" y="-3.3" width="2.6" height="6.6"/><rect x="-9.6" y="-1.2" width="2.6" height="2.4"/></g>`, 'POTENTIAL VIEW', `terrain only, from ${Math.round(sb.eyeAboveM ?? 8)} m up; no buildings`);
  }
  if (poles.length) row(`<g transform="translate(${mid},3.2)"><line x1="-2.4" y1="0" x2="2.4" y2="0" stroke="#333" stroke-width="0.4"/><circle r="1.2" fill="none" stroke="#333" stroke-width="0.45"/></g>`, 'POWER POLE');
  if (lamps.length) row(`<circle cx="${mid}" cy="3.2" r="1.4" fill="#f0c020" stroke="#a8860b" stroke-width="0.3"/>`, 'LIGHT POLE');
  if (sb.furniture.hydrants.length) row(`<circle cx="${mid}" cy="3.2" r="1.8" fill="#1f78d1"/>`, 'HYDRANT');
  if (sb.busStops.length) row(`<g transform="translate(${mid},3.2)"><circle r="3.4" fill="#fff" stroke="#2f7fd6" stroke-width="0.8"/><text text-anchor="middle" dy="1.9" font-size="5.7" font-weight="700" fill="#2f7fd6">B</text></g>`, 'BUS STOPS');
  if (sb.furniture.onewayRoads.length) row(`<path d="M${SWATCH_X},3.2 L${SWATCH_X + SWATCH_W - 4},3.2 M${SWATCH_X + SWATCH_W - 7},1.4 L${SWATCH_X + SWATCH_W - 4},3.2 L${SWATCH_X + SWATCH_W - 7},5" fill="none" stroke="#8a8a8a" stroke-width="1.0"/>`, 'TRAFFIC DIRECTION');
  if (look.noise === 'zigzag') {
    const zz = Array.from({ length: 16 }, (_, i) => `${(SWATCH_X + 1 + i * 1.4).toFixed(2)},${(i % 2 ? 1.9 : 4.5).toFixed(2)}`).join('L');
    row(`<path d="M${zz}" fill="none" stroke="${NOISE_BLUE}" stroke-width="0.5"/>`, 'NOISE SOURCE', 'busy roads and the railway');
  } else {
    const top: string[] = [], bot: string[] = [];
    for (let x = 0; x <= SWATCH_W - 2; x += 0.4) {
      const yc = 3.2 + 0.6 * Math.sin(x / 2.6);
      const w = 1.05 + 0.25 * Math.sin(x / 1.7);
      top.push(`${(SWATCH_X + 1 + x).toFixed(2)},${(yc - w).toFixed(2)}`);
      bot.push(`${(SWATCH_X + 1 + x).toFixed(2)},${(yc + w).toFixed(2)}`);
    }
    row(`<path d="M${top.join('L')}L${bot.reverse().join('L')}Z" fill="#fff" stroke="${NOISE_BLUE}" stroke-width="0.3" stroke-linejoin="round"/>`, 'NOISE SOURCE', 'busy roads and the railway');
  }
  {
    const rib = `M${SWATCH_X + 2},2.6 C${SWATCH_X + 7},0.8 ${SWATCH_X + 11},4.8 ${SWATCH_X + 16},2.4 L${SWATCH_X + 16},1 L${SWATCH_X + 21},3.2 L${SWATCH_X + 16},5.4 L${SWATCH_X + 16},4 C${SWATCH_X + 11},6.2 ${SWATCH_X + 7},2.6 ${SWATCH_X + 2},3.8 Z`;
    void rib;
    if (look.wind === 'circle') {
      const swD = `M${SWATCH_X},1.2h${SWATCH_W}v4h${-SWATCH_W}Z`;
      row(textureSvg('lwind', swD, 'lines', look.windPen, { x: SWATCH_X, y: 0, w: SWATCH_W, h: 6.5 }, 1) +
        `<path d="${swD}" fill="none" stroke="${look.windPen}" stroke-width="0.3"/>`, 'PREVAILING WINDS', 'named around the circle, hatched where they blow from');
    } else if (look.wind === 'drawn') {
      row(`<path transform="translate(${mid},3.2) scale(4.6)" d="${WIND}" fill="${look.climateInk}" stroke="${look.climateInk}" stroke-width="${(0.25 / 4.6).toFixed(3)}"/>`, 'PREVAILING WINDS', 'on the ring, dashed blue where the sun never goes');
    } else if (look.wind === 'band') {
      row(`<path d="M${SWATCH_X},0 Q${mid},2.6 ${SWATCH_X + SWATCH_W},0 L${SWATCH_X + SWATCH_W},4.6 Q${mid},7.2 ${SWATCH_X},4.6 Z" fill="${look.marks!.windBand}" fill-opacity="${WIND_BAND_OPACITY}"/>` +
        `<path transform="translate(${mid},3.6) rotate(90) scale(2.2)" d="${ARROW}" fill="#ffffff"/>`, 'PREVAILING WINDS', 'over the quarter each blows from');
    } else row(`<path d="${sketchArrow(SWATCH_X + 2, 3.2, 1, 0, 19, 0.8, 0.5, 1.3)}" fill="#fff" stroke="${look.windPen}" stroke-width="0.35" stroke-linejoin="round"/>`, 'PREVAILING WINDS');
    if (look.sun === 'circle')
      row(`<g fill="none" stroke="${look.sunPen}" stroke-width="0.35" stroke-linecap="round">` +
        `<path d="M${SWATCH_X + 3},5.2 Q${mid},-1.6 ${SWATCH_X + SWATCH_W - 3},5.2"/>` +
        `<path d="M${SWATCH_X + 7},6.2 Q${mid},1.4 ${SWATCH_X + SWATCH_W - 7},6.2" stroke-dasharray="0.8,0.9"/></g>` +
        sunMark([SWATCH_X + 3, 5.2], look.sunEdge, look.sunFill, 0.45),
        'SUN PATH, SUMMER AND WINTER', 'solstice rise and set; summer solid, winter dashed');
    else if (look.sun === 'drawn')
      row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${look.sunPen}" stroke-width="0.9" stroke-dasharray="3,1.6"/>` +
        `<path transform="translate(${mid},3.2) scale(3.2)" d="${SUN}" fill="${look.sunInk}" stroke="${look.sunInk}" stroke-width="${(0.25 / 3.2).toFixed(3)}"/>`,
        'SUN PATH', 'summer dashed, winter dotted; sunrise and sunset');
    else if (look.sun === 'band')
      row(`<defs><linearGradient id="lsunBand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${look.marks!.sunBand[0]}"/><stop offset="0.5" stop-color="${look.marks!.sunBand[1]}"/><stop offset="1" stop-color="${look.marks!.sunBand[0]}"/></linearGradient></defs>` +
        `<path d="M${SWATCH_X},1.2 Q${mid},9 ${SWATCH_X + SWATCH_W},1.2 Q${mid},4.4 ${SWATCH_X},1.2 Z" fill="url(#lsunBand)" fill-opacity="${SUN_BAND_OPACITY}"/>` +
        `<path transform="translate(${SWATCH_X + 2.2},2.2) scale(2)" d="${RAY_SUN}" fill="${look.sunFill}"/>`,
        'SUN PATH', 'summer outer, winter inner; sunrise and sunset');
    else row(`<g transform="translate(${mid},3.2)"><path d="M${Array.from({ length: 24 }, (_, k) => { const a = (k / 24) * Math.PI * 2, r = k % 2 ? 2.4 : (k % 6 === 2 ? 4.3 : 3.7); return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`; }).join('L')}Z" fill="#fff" stroke="${look.sunEdge}" stroke-width="0.35" stroke-linejoin="round"/><circle r="1.7" fill="#fff" stroke="${look.sunEdge}" stroke-width="0.35"/></g>`, 'SUN PATH', 'summer solid, winter dashed; solar hours');
  }

  const utilKinds = new Set(sb.furniture.utilities.map((u) => u.kind));
  const srcName = (id: string) => (id === 'cityofsydney' ? 'City of Sydney, CC BY 4.0' : id === 'ga' ? 'Geoscience Australia, CC BY 4.0' : id === 'endeavour' ? 'Endeavour Energy, TRIAL: licence to be confirmed' : id);
  const linesOf = (kind: string) => services.lines.filter((l) => l.kind === kind);
  const pointsOf = (kind: string) => services.points.filter((p) => p.kind === kind);
  const fromSources = (items: { source: string }[]) => [...new Set(items.map((i) => srcName(i.source)))].join('; ');
  if (linesOf('stormwater').length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.stormwater}" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'STORMWATER (Ø mm)', fromSources(linesOf('stormwater')));
  if (pointsOf('stormwaterPit').length) row(`<g transform="translate(${mid},3.2)"><rect x="-1.8" y="-1.8" width="3.6" height="3.6" fill="#fff" stroke="${SERVICE_INK.stormwater}" stroke-width="0.4"/><path d="M-1.8,0H1.8M0,-1.8V1.8" stroke="${SERVICE_INK.stormwater}" stroke-width="0.25"/></g>`, 'DRAINAGE PIT (IL m AHD)', fromSources(pointsOf('stormwaterPit')));
  if (linesOf('powerHV').length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.powerHV}" stroke-width="1.1" stroke-dasharray="5,1.6,1,1.6"/>`, 'HIGH VOLTAGE LINE (kV)', fromSources(linesOf('powerHV')));
  if (pointsOf('substation').length || servicePoints.some((p) => p.kind === 'substation' || p.kind === 'transformer'))
    row(`<g transform="translate(${mid},3.2)"><rect x="-2" y="-2" width="4" height="4" fill="#fff" stroke="${SERVICE_INK.cable}" stroke-width="0.45"/><path d="M0.5,-1.5 L-0.9,0.3 H0.7 L-0.5,1.6" fill="none" stroke="${SERVICE_INK.cable}" stroke-width="0.35"/></g>`, pointsOf('substation').some((p) => /kVA/.test(p.label ?? '')) ? 'SUBSTATION (kVA SPARE)' : 'SUBSTATION / TRANSFORMER', [fromSources(pointsOf('substation')), servicePoints.some((p) => p.kind === 'substation' || p.kind === 'transformer') ? 'OpenStreetMap' : ''].filter(Boolean).join('; '));
  if (linesOf('powerCable').length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.cable}" stroke-width="0.6" stroke-dasharray="3,2"/>`, 'ELECTRICAL CABLES (UG)', fromSources(linesOf('powerCable')));
  if (linesOf('powerOverhead').length) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.power}" stroke-width="0.6"/>`, 'POWER LINES (OH)', fromSources(linesOf('powerOverhead')));
  if (pointsOf('pillar').length) row(`<rect x="${mid - 1.4}" y="1.8" width="2.8" height="2.8" fill="#fff" stroke="${SERVICE_INK.cable}" stroke-width="0.4"/>`, 'ELECTRICAL PILLAR', fromSources(pointsOf('pillar')));
  if (utilKinds.has('cable')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.cable}" stroke-width="0.6" stroke-dasharray="3,2"/>`, 'ELECTRICAL CABLES', 'where OpenStreetMap maps them');
  if (servicePoints.some((p) => p.kind === 'cabinet')) row(`<rect x="${mid - 1.6}" y="2.3" width="3.2" height="1.8" fill="#8a8a8a"/>`, 'SERVICE CABINET', 'OpenStreetMap');
  if (servicePoints.some((p) => p.kind === 'manhole')) row(`<g transform="translate(${mid},3.2)"><circle r="1.7" fill="#fff" stroke="#6f6f6f" stroke-width="0.4"/><path d="M-1.2,-1.2L1.2,1.2M1.2,-1.2L-1.2,1.2" stroke="#6f6f6f" stroke-width="0.3"/></g>`, 'MANHOLE', 'OpenStreetMap; coloured by what it serves');
  if (utilKinds.has('power')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SERVICE_INK.power}" stroke-width="0.6"/>`, 'POWER LINES');
  if (utilKinds.has('water')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="#2f7fd6" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'WATER MAIN');
  if (utilKinds.has('sewer')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${SEWER}" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'SEWER MAIN');
  if (utilKinds.has('gas')) row(`<line x1="${SWATCH_X}" y1="3.2" x2="${SWATCH_X + SWATCH_W}" y2="3.2" stroke="${GAS}" stroke-width="0.9" stroke-dasharray="4,2.2"/>`, 'GAS MAIN');
  // Every sheet says where its services stop: what is drawn is open data
  // only, and the water, sewer, gas, electrical and telecom plans are a
  // Before You Dig enquiry's.
  const anyServices = services.lines.length || services.points.length || sb.furniture.utilities.length || servicePoints.length;
  row('', anyServices ? 'SERVICES: OPEN DATA ONLY' : 'SERVICES: NONE OPEN HERE', 'not a substitute for a Before You Dig enquiry');

  // The licences' attributions, folded by holder and licence ("Trees,
  // contours, drainage © City of Sydney · … · CC BY 4.0"), at the foot of
  // the legend.
  const credit = (() => {
    const groups = new Map<string, string[]>();
    for (const a of sb.attributions ?? []) {
      const m = a.match(/^(.*?)\s*©\s*(.*?),\s*(CC BY[^,]*|ODbL[^,]*)$/);
      if (!m) { groups.set(a, []); continue; }
      const key = `© ${m[2]}|${m[3]}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m[1]);
    }
    const licences = new Set([...groups.keys()].map((k) => k.split('|')[1]).filter(Boolean));
    // One licence closes the line only when every holder's data is under it;
    // a credit with none of its own (a trial source) would read as covered.
    const shared = licences.size === 1 && [...groups.keys()].every((k) => k.includes('|'));
    const parts = [...groups].map(([key, subjects]) => {
      const [holder, lic] = key.split('|');
      if (!subjects.length) return key;
      const what = subjects.map((w, i) => (i ? w.toLowerCase() : w)).join(', ');
      return `${what} ${holder}${!shared && lic ? `, ${lic}` : ''}`;
    });
    return parts.length ? `${parts.join(' · ')}${shared ? `, ${[...licences][0]}` : ''}` : '';
  })();
  // The header's four lines already fill it to its rule (the GENERATED line
  // takes two), so a fifth ran into the LEGEND heading: the credit always
  // closes the legend.
  const creditInLegend = credit.length > 0;
  if (creditInLegend) {
    ly += 2;
    legendSvg += `<text x="${SWATCH_X}" y="${ly}" font-size="${T.legend}" font-weight="700" fill="#222">DATA</text>`;
    wrapLabel(credit, 56).forEach((l, i) => { legendSvg += `<text x="${SWATCH_X}" y="${(ly + 3.4 + i * 3).toFixed(1)}" font-size="${T.legend * 0.85}" fill="#555">${esc(l)}</text>`; });
  }

  // The theme's face for every word on the map and in the legend: Arial
  // Narrow for Heron (Liberation Sans Narrow on the server), Arial for Canary.
  layers.unshift(`<g font-family="${look.font}">`);
  layers.push('</g>');
  legendSvg = `<g font-family="${look.font}">${legendSvg}</g>`;

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
    dataNote: credit && !creditInLegend ? credit : undefined,
  });
}

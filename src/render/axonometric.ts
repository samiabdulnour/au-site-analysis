// The axonometric of a city block, shared by the yield's massing and the
// site report's built form page.
//
// The camera stands off the site along a normal the caller gives (the main
// frontage's, or the nearest street's), turned 40° to take in a side, looking
// down 35°, so the street front and one side face the reader. The projection
// is orthographic and affine, so a sphere draws as a circle and a plane's
// picture skews in as one matrix. Solids are drawn far to near, the faces
// turned from the camera left out; whatever the caller lays over them (an
// envelope, a height plane) goes on as dashed lines.
//
// The colours are the caller's: each neighbour comes with its fill (the
// yield gives each its zone's, so its plan and its massing agree; the report
// gives each its height band's, as its height of buildings page does). The ground is
// a cream of the activity family, the streets white on it kerb to kerb, the
// parks and the trees in the living green, after the poster maps of a city.

import turfUnion from '@turf/union';
import { featureCollection, polygon } from '@turf/helpers';
import type { XY } from '../lib/geo.js';
import { alongLine, carriageways, type Carriageway, type RoadLine } from '../lib/carriageway.js';
import { INK, massingInks } from './atlasKit.js';
import { tint, vivid, deckLook, greyOf, tpl } from './template.js';
import { esc } from './chrome.js';
import { crownPicture, shadowPicture, rand, canopyBottom, canopyVariant, flatCrownSvg, flatBottom, CANOPY, CANOPY_BRANCHINGS, CONTOUR, type CrownKind, type FlatForm } from './crowns.js';
import { personPicture, riderPicture, linePersonSvg, lineRiderSvg, PEOPLE_VARIANTS, RIDER_VARIANTS, type LineFigure } from './people.js';

export interface Prism {
  rings: XY[][];
  z0: number;
  z1: number;
  fill: string;
  edge: string;
  edgeW: number;
  /** Its outline's width on paper, mm, whatever the drawing's scale (a line model's buildings); `edgeW`, which scales with the drawing, where unset. */
  edgeMm?: number;
  storeys?: number[];
  dashed?: boolean;
  dash?: string;
  opacity?: number;
  /** A building whose walls may be marked: Canary hatches the wall turned from the light (WALL_HATCH), a line model draws what LINE_WINDOWS says, Flamingo and Kingfisher leave them plain. */
  windows?: boolean;
  /**
   * Panels laid on the faces (an apartment's stretch of facade on a storey, coloured by its sun): each on the edge
   * from rings[ring][edge] to the next corner, from t0 to t1 of its length, between two levels. Drawn with their
   * face, so a nearer face hides them as it hides the face.
   */
  cells?: { ring: number; edge: number; t0: number; t1: number; z0: number; z1: number; fill: string; /** In its own colour, unlit, so it reads against a key. */ flat?: boolean }[];
  /** Pieces laid on its roof (a roof's cells, coloured by their sun), drawn in their own colours over its top. */
  roof?: { pts: XY[]; fill: string }[];
}

export interface AxoNeighbour {
  /** Footprint rings, local metres. */
  rings: XY[][];
  /** Recorded height; none draws a nominal two storeys, dashed. */
  heightM?: number;
  fill: string;
  /** What it may rise to, drawn as a glass over it. */
  future?: number;
}

export interface AxoScene {
  /** The site's boundary, local metres about the site. */
  ring: XY[];
  /** The outward normal the camera stands along. */
  frontNormal: XY;
  /** How far from the site to draw, metres. */
  reach: number;
  neighbours: AxoNeighbour[];
  /** What stands or is proposed on the site. */
  built: Prism[];
  /** Buildings that may stand round the site on footprints of their own (the yield's future context), drawn as the futures' glass. */
  futures?: { rings: XY[][]; heightM: number }[];
  roads: RoadLine[];
  kerbs: XY[][];
  lots: { rings: XY[][]; park: boolean }[];
  trees: { p: XY; r: number }[];
  /** The height plane over the site, and what to say when it runs above the frame. */
  hob?: { metres: number; note: string };
  envelopes?: { rings: XY[][]; z: number }[];
  inks: { site: string; future: string; futureEdge: string; envelope: string; kerb: string };
  /** The built's outline over everything, so a future in front of it does not lose it. */
  silhouette?: boolean;
  /** Set, the frame is fitted to the site and this many metres of town round it, and the town drawn to `reach` runs out past the frame's every edge; unset, everything within reach is fitted in. */
  focusM?: number;
  /**
   * Set, the frame is this many metres of ground across its width, the site at its middle, and the town runs out
   * past its every edge: the drawing fills its box to the border, where fitting everything within `reach` leaves a
   * round town in a square frame with empty corners. Only what can show in the frame is drawn; `reach` must take in
   * the frame's corners (frameReachM).
   */
  frameM?: number;
  /** Keep the trees that stand on the site (what stands today); a scheme clears them. */
  treesOnSite?: boolean;
  /** The bus routes, local metres, where the caller has them: the buses keep to them. Unset, a bus runs on the collector streets and above; empty, there is none. */
  busRoutes?: XY[][];
  /** A white model: the town round the site (the ground, the lots, the streets, the neighbours, the trees, the traffic,
   * the people) in white and greys, so the colours on what is built read alone. The built keeps its own fills. */
  mono?: boolean;
}

/** The white model's greys: its edges, its ground lines, its kerbs, its people. */
const MONO = { edge: '#8f8f8f', line: '#d2d2d2', kerb: '#8f8f8f', figure: '#b4b4b4', glass: '#ececec', chassis: '#c4c4c4' };
/**
 * The line model's inks (Heron): the town drawn in black line on white, as an architect's axonometric is. Every
 * building a white volume in a black outline, no shade on its faces; the ground's lines in greys, each of its
 * surfaces in a hatch of its own (groundHatches);
 * the trees white in their contour with their limbs drawn; the people and the traffic white in outline. What is built
 * on the site carries the heavier line. A neighbour keeps a tone where the caller gives one (the report's storeys), flat.
 */
const LINE = { edge: '#1a1a1a', line: '#c6c6c6', kerb: '#7a7a7a', figure: '#ffffff', glass: '#ffffff', chassis: '#ffffff' };

export type VehicleKind = 'car' | 'van' | 'truck' | 'semi' | 'bus';

/** A vehicle in the traffic: its middle, the way it travels (u) and its left (n), half its length and half its width, metres. */
export interface Vehicle { kind: VehicleKind; c: XY; u: XY; n: XY; half: number; hw: number }

/** Each kind's size, half its length and half its width: a car, a delivery van, a rigid truck, an articulated truck, a bus. */
export const VEHICLE_SIZE: Record<VehicleKind, { half: number; hw: number }> = {
  car: { half: 2.2, hw: 0.9 }, van: { half: 2.95, hw: 1.0 }, truck: { half: 4.3, hw: 1.25 }, semi: { half: 8.25, hw: 1.25 }, bus: { half: 6.25, hw: 1.25 },
};

// The mix down a street by its class (NSW topographic hierarchy: 1 motorway … 6 local), taken in turn: the
// articulated trucks on the arterials and above, the buses on the collectors and above, a rigid truck now and then
// even down a local street (a removalist, the bins), delivery vans everywhere.
const MIX: Record<'arterial' | 'subArterial' | 'collector' | 'local', VehicleKind[]> = {
  arterial: ['car', 'bus', 'car', 'truck', 'car', 'van', 'car', 'semi', 'car', 'car', 'van', 'bus', 'car', 'truck'],
  subArterial: ['car', 'van', 'car', 'bus', 'car', 'truck', 'car', 'car', 'van', 'car'],
  collector: ['car', 'van', 'car', 'bus', 'car', 'car', 'truck', 'car', 'van', 'car'],
  local: ['car', 'van', 'car', 'car', 'car', 'truck', 'car', 'car', 'van', 'car', 'car', 'car'],
};
/** What a vehicle that does not fit its slot gives way to, the next smaller. */
const SMALLER: Record<VehicleKind, VehicleKind | null> = { semi: 'truck', truck: 'van', bus: 'car', van: 'car', car: null };

/** Whether two vehicles' outlines come within `gap` metres of each other: the separating axis test on two oriented rectangles. */
export function vehiclesClash(a: Vehicle, b: Vehicle, gap = 0): boolean {
  const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y;
  if (Math.hypot(dx, dy) > a.half + b.half + 2 * gap + 3) return false;
  for (const ax of [a.u, a.n, b.u, b.n]) {
    const reach = (v: Vehicle) => v.half * Math.abs(v.u.x * ax.x + v.u.y * ax.y) + v.hw * Math.abs(v.n.x * ax.x + v.n.y * ax.y);
    if (Math.abs(dx * ax.x + dy * ax.y) > reach(a) + reach(b) + gap) return false;
  }
  return true;
}

/** Whether a point stands within `pad` metres of a vehicle's outline. */
export function underVehicle(p: XY, v: Vehicle, pad = 0): boolean {
  const dx = p.x - v.c.x, dy = p.y - v.c.y;
  return Math.abs(dx * v.u.x + dy * v.u.y) <= v.half + pad && Math.abs(dx * v.n.x + dy * v.n.y) <= v.hw + pad;
}

/** A vehicle's four corners, drawn in by `inset` metres. */
const corners = (v: Vehicle, inset = 0): XY[] => {
  const h = v.half - inset, w = v.hw - inset;
  return [[h, w], [h, -w], [-h, -w], [-h, w]].map(([s, q]) => ({ x: v.c.x + v.u.x * s + v.n.x * q, y: v.c.y + v.u.y * s + v.n.y * q }));
};

/**
 * The traffic down the streets: a slot every so often down each street in each direction, on the left of its axis as
 * the road rules have it, none down a lane. The slots nearest the site take their street class's mix first, so the
 * frame shows a bit of each; a bus keeps to the bus routes where they are given. A vehicle that would stand over a
 * kerb, a building or another vehicle gives way to the next smaller that fits, a car at the least, or to nothing.
 */
export function placeTraffic(cw: Carriageway, opts: { reach: number; footprints: XY[][]; busRoutes?: XY[][]; /** Where a vehicle may stand at all (a frame the drawing is cut to); anywhere within reach where unset. */ within?: (p: XY) => boolean }): Vehicle[] {
  const { reach, footprints, busRoutes } = opts;
  // each ring with its bounds, so a point far off is let go before the ring is walked
  const boxed = (rg: XY[]) => ({ rg, x0: Math.min(...rg.map((p) => p.x)), x1: Math.max(...rg.map((p) => p.x)), y0: Math.min(...rg.map((p) => p.y)), y1: Math.max(...rg.map((p) => p.y)) });
  const within = (p: XY, b: ReturnType<typeof boxed>) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && inRing(p, b.rg);
  const surfaces = cw.polygons.filter((rings) => rings[0]?.length >= 3).map(([outer, ...holes]) => ({ outer: boxed(outer), holes: holes.filter((h) => h.length >= 3).map(boxed) }));
  const buildings = footprints.filter((rg) => rg.length >= 3).map(boxed);
  const onRoad = (p: XY) => surfaces.some(({ outer, holes }) => within(p, outer) && !holes.some((h) => within(p, h)));
  // a vehicle's outline, drawn in a little: its middle, and points down both its sides no more than 1.5 m apart, so a
  // long one cannot straddle a kerb's corner or a building between its ends
  const outline = (v: Vehicle): XY[] => {
    const h = v.half - 0.15, w = v.hw - 0.15, k = Math.max(1, Math.ceil((2 * h) / 1.5));
    const pts = [v.c];
    for (let i = 0; i <= k; i++) for (const q of [w, -w]) { const s = -h + (2 * h * i) / k; pts.push({ x: v.c.x + v.u.x * s + v.n.x * q, y: v.c.y + v.u.y * s + v.n.y * q }); }
    return pts;
  };
  // a route runs along a slot where one of its segments passes within 8 m of it, running the same way
  const onRoute = (c: XY, u: XY) => (busRoutes ?? []).some((line) => line.some((a, i) => {
    if (!i) return false;
    const b = line[i - 1], dx = a.x - b.x, dy = a.y - b.y, l2 = dx * dx + dy * dy;
    if (!l2 || Math.abs(dx * u.x + dy * u.y) / Math.sqrt(l2) < 0.85) return false;
    const t = Math.max(0, Math.min(1, ((c.x - b.x) * dx + (c.y - b.y) * dy) / l2));
    return Math.hypot(c.x - b.x - t * dx, c.y - b.y - t * dy) <= 8;
  }));
  const slots: { c: XY; u: XY; n: XY; hierarchy: number }[] = [];
  cw.axes.forEach(({ axis, left, right, road }, ri) => {
    if (road.hierarchy >= 7) return;
    const lane = Math.min(2.6, (left + right) / 4);
    const step = 24 + road.hierarchy * 3;
    for (const dir of [1, -1]) {
      for (const { p, t } of alongLine(axis, step, dir > 0 ? 6 + (ri % 4) * 5 : 17 + (ri % 3) * 6)) {
        const u = { x: t.x * dir, y: t.y * dir }, n = { x: -u.y, y: u.x };   // the left of the direction of travel
        slots.push({ c: { x: p.x + n.x * lane, y: p.y + n.y * lane }, u, n, hierarchy: road.hierarchy });
      }
    }
  });
  slots.sort((a, b) => Math.hypot(a.c.x, a.c.y) - Math.hypot(b.c.x, b.c.y));
  const placed: Vehicle[] = [];
  const turn: Record<keyof typeof MIX, number> = { arterial: 0, subArterial: 0, collector: 0, local: 0 };
  const fits = (v: Vehicle) => outline(v).every((p) => Math.hypot(p.x, p.y) <= reach && onRoad(p) && !buildings.some((b) => within(p, b)))
    && !placed.some((o) => vehiclesClash(v, o, 0.4));
  for (const s of slots) {
    if (Math.hypot(s.c.x, s.c.y) > reach || (opts.within && !opts.within(s.c))) continue;
    const routed = busRoutes ? onRoute(s.c, s.u) : s.hierarchy <= 5;
    // a local street a bus route runs down takes a collector's mix
    const cls: keyof typeof MIX = s.hierarchy <= 3 ? 'arterial' : s.hierarchy === 4 ? 'subArterial' : s.hierarchy === 5 || (busRoutes && routed) ? 'collector' : 'local';
    const mix = MIX[cls];
    let kind: VehicleKind | null = mix[turn[cls]++ % mix.length];
    if (kind === 'bus' && !routed) kind = 'car';
    for (; kind; kind = SMALLER[kind]) {
      const v: Vehicle = { kind, c: s.c, u: s.u, n: s.n, ...VEHICLE_SIZE[kind] };
      if (fits(v)) { placed.push(v); break; }
    }
  }
  return placed;
}

/** A colour darkened (f < 1) or lightened toward white (f > 1). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`;
}

const FUTURE_DASH = '1.4,0.8', FUTURE_OPACITY = 0.18;
const nf = (v: number) => Math.round(v).toLocaleString('en-AU');

function inRing(p: XY, rg: XY[]): boolean {
  let c = false;
  for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) {
    if ((rg[i].y > p.y) !== (rg[j].y > p.y) && p.x < ((rg[j].x - rg[i].x) * (p.y - rg[i].y)) / (rg[j].y - rg[i].y) + rg[i].x) c = !c;
  }
  return c;
}

/**
 * How the trees and the people are drawn. Plain (Heron, Canary, a white model): a tree a flat disc in the style's
 * green with a lighter one over it, a person a slip of colour with a head. Illustrated, as an illustrator's isometric
 * draws a town: each crown outlined, in its shade with the lit part over it towards the light and a highlight, its
 * shadow on the ground; a person with legs, clothes and a face, a little larger than life; more of them walking the
 * footpaths, some in twos, and people gathered in the parks. Flamingo's trees are the flat ones of an illustrator's
 * isometric town (Z. 2026-11, after her reference): a few plain shapes in two deep teals, no outline, shading or
 * shadow, each on a thin trunk whose line runs up into it, a short bar on the ground at its foot; its people and its
 * traffic in line alone, cream with one thin dark line round each part and a pale warm bar under them, the people
 * in vector at the town's own scale, on a cream ground. Kingfisher's
 * are loose canopies, flat, many small leaf clumps with light through them and the fork of the branches under them,
 * without an outline or a shadow, after an illustrated masterplan. Each style's trees are in its own green, deeper or
 * lighter tree to tree. (`cloud`, a crown of a few lobes outlined, shaded and lit and casting its shadow, was
 * Flamingo's and is kept for a style that asks for it.)
 */
interface AxoLook {
  crown: 'disc' | 'cloud' | 'canopy' | 'flat';
  people: 'slip' | 'figure';
  crowd: boolean;
  /** The trees' greens, taken tree by tree; and the few in another colour (a blossom, an autumn tree), each with its share. */
  greens: string[];
  accents: [string, number][];
  /** Narrow upright trees among the small ones, this share of them. */
  columnar: number;
  /** The trees cast their shadows on the ground. */
  shadows: boolean;
  /** The people and the traffic in line alone (render/people.ts, LineFigure): cream, one thin line, a pale patch under them. */
  line?: LineFigure;
}
/** Flamingo's flat trees: its two teals, tree by tree, and the lighter one its ruled shields take; the lines in each a deeper cut of it. */
const FLAT_TEAL = { crown: '#167d7f', deep: '#0b5f66', light: '#5fa59a' };
/**
 * Flamingo's line figures: the cream of its streets (atlasKit, massingInks), a near-black line, a pale orange bar or
 * patch on the ground; and the few flat colours some of its people's clothes take (a yellow, an orange, a pale blue, a
 * teal, as Z.'s sheet of the people has them). Its vehicles stay in the cream alone.
 */
const FLAT_LINE: LineFigure = { fill: '#fcf9ee', line: '#23262c', ground: '#f9dfae', accents: ['#f6c544', '#ea8a3c', '#b3cdea', '#4a9d9c'] };
/**
 * How large Flamingo's people in line are drawn, times life: at the town's own scale (Z. 2026-11; they were tried at
 * three times life, as the references draw theirs, and read as giants beside a massing that is to scale). Set over
 * 2, there are fewer of them to suit: a third as many on the footpaths, a quarter as many groups in the parks.
 */
export const LINE_FIGURE_SIZE = 1;
/** The dashes down the middle of Flamingo's streets, metres: each drawn in outline, as the references' are. */
const ROAD_DASH = { len: 1.7, w: 0.42, pitch: 4.2 };
/** The line round a line figure's parts, metres in the scene whatever size the figure is drawn: a little finer than the vehicles'. */
const LINE_FIGURE_PEN = 0.04;
const PLAIN: AxoLook = { crown: 'disc', people: 'slip', crowd: false, greens: [], accents: [], columnar: 0, shadows: false };

/** The look of a drawing's trees and people, by the style; plain in a white model. */
function lookOf(M: ReturnType<typeof massingInks>, mono: boolean): AxoLook {
  const style = deckLook().id;
  // Heron's line model: each tree a canopy in white, its contour and its limbs black; the people plain, in outline
  if (style === 'heron') return { crown: 'canopy', people: 'slip', crowd: false, greens: ['#ffffff'], accents: [], columnar: 0.12, shadows: false };
  if (mono) return PLAIN;
  if (style === 'flamingo') return { crown: 'flat', people: 'figure', crowd: true, greens: [FLAT_TEAL.crown, FLAT_TEAL.crown, FLAT_TEAL.deep], accents: [], columnar: 0.22, shadows: false, line: FLAT_LINE };
  // Kingfisher's canopies in two close cuts of its green and, for about one in five, a soft yellow-green
  if (style === 'kingfisher') return { crown: 'canopy', people: 'figure', crowd: true, greens: [M.tree, M.tree, shade(M.tree, 0.9), shade(M.tree, 0.9), '#bccd84'], accents: [], columnar: 0.1, shadows: false };
  return PLAIN;
}

/**
 * The line model's ground, each surface its own hatch, as a drawn axonometric tells its surfaces apart: a park's lawn
 * closely hatched, rising to the right; a lot's garden lightly stippled; the carriageway finely ruled across; the
 * footpaths and verges left white; and under each tree a closer hatch laid the other way, its shadow.
 *
 * Drawn as lines and dots clipped to each surface, over the frame alone, not as SVG pattern fills: in print Chromium
 * turns a pattern fill into a picture of the shape it fills (the trees' shade alone came to 2 MB a page, soft at
 * print size). Sized on paper (millimetres) whatever the drawing's scale: `k` is its millimetres to the unit, `f`
 * the frame in the drawing's own units.
 */
/**
 * A line model's buildings are outlined on paper, millimetres whatever the drawing's scale (the other styles' strokes
 * scale with the drawing, so a town drawn small has hairlines): the neighbours', the futures' glass, what is built on
 * the site and the heavy outline round it, the storeys ruled on its walls.
 */
const LINE_MM = { neighbour: 0.2, future: 0.16, built: 0.3, silhouette: 0.55, storey: 0.08 };
/** A width on paper, written into the drawing before its scale is known and resolved once it is (`resolvePaper`). */
const PW = (mm: number) => `@@pw${mm}@@`;
const resolvePaper = (svg: string, k: number) => svg.replace(/@@pw([\d.]+)@@/g, (_, mm: string) => (Number(mm) / k).toFixed(4));
/**
 * The hatch a line model draws a tone as on a building's walls, where it would have filled it: the spacing of its
 * lines on paper, mm, on a wall turned from the light, the closer the darker the tone (1.7 mm for the palest down to
 * 0.6 mm); null for white, which has none. A key drawing the same building takes the same spacing.
 */
export function lineHatchPitch(fill: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return null;
  const tone = 1 - parseInt(fill.slice(1, 3), 16) / 255;
  return tone > 0.03 ? 1.7 - 1.1 * Math.min(1, tone / 0.32) : null;
}
/**
 * How a line model draws its windows: not at all (a massing is a volume, not a facade design: the storeys' lines say
 * how tall it is); or each a frame, bay by bay; a ribbon along each storey; or fine uprights between the bays, a
 * curtain wall's grid with the storeys' lines.
 */
const LINE_WINDOWS: 'none' | 'frames' | 'ribbon' | 'mullions' = 'none';
/**
 * How Canary, whose faces carry the shade in full colour, marks its buildings' walls: a wall turned from the light is
 * hatched as shade, lines at 45° in a darker cut of the wall's own colour (`ink` of it), `w` mm wide on paper and
 * `pitch` mm apart on a wall turned full from the light, opening by `open` of that as the wall turns toward it; a
 * wall turned to the light (past `turned` of full) is left plain. Flamingo and Kingfisher, light and glossy with
 * their shadows on the ground, leave every wall plain. (All three laid a pattern of small dark squares flat over
 * every wall: windows square to the page, on walls that are not.)
 */
const WALL_HATCH = { pitch: 0.9, open: 0.7, w: 0.14, ink: 0.5, turned: 0.25 };
/** The spacing of Canary's hatch on a wall whose normal is `turn` toward the light (-1 full from it, 1 full to it); null for a wall left plain. */
export const wallHatchPitch = (turn: number): number | null => (turn < WALL_HATCH.turned ? WALL_HATCH.pitch * (1 + WALL_HATCH.open * ((turn + 1) / (1 + WALL_HATCH.turned))) : null);
const GROUND_HATCH = {
  lawn: { pitch: 0.62, w: 0.07, ink: '#8a8a8a' },
  yard: { pitch: 2.0, w: 0.16, ink: '#7d7d7d' },
  road: { pitch: 0.8, w: 0.06, ink: '#a6a6a6' },
  shade: { pitch: 0.46, w: 0.08, ink: '#6f6f6f' },
} as const;
type Frame = { x0: number; y0: number; x1: number; y1: number };
function groundHatch(kind: keyof typeof GROUND_HATCH, clipD: string, clipRule: 'evenodd' | 'nonzero', f: Frame, k: number, id: string): string {
  if (!clipD) return '';
  const g = GROUND_HATCH[kind], step = g.pitch / k, H = f.y1 - f.y0, n = (v: number) => v.toFixed(2);
  const d: string[] = [];
  if (kind === 'yard') {
    // a stipple: dots in rows half a pitch apart, every other row shifted half a pitch
    let row = 0;
    for (let y = f.y0 + step / 4; y <= f.y1; y += step / 2, row++) for (let x = f.x0 + (row % 2 ? step * 0.75 : step * 0.25); x <= f.x1; x += step) d.push(`M${n(x)},${n(y)}h0`);
  } else if (kind === 'road') for (let y = f.y0 + step / 2; y <= f.y1; y += step) d.push(`M${n(f.x0)},${n(y)}H${n(f.x1)}`);
  // the lawn's lines rise to the right, the shade's fall: the two cross where a tree stands on a lawn
  else for (let o = f.x0 - H; o <= f.x1; o += step) d.push(kind === 'lawn' ? `M${n(o)},${n(f.y1)}L${n(o + H)},${n(f.y0)}` : `M${n(o)},${n(f.y0)}L${n(o + H)},${n(f.y1)}`);
  return `<clipPath id="axo-${kind}-${id}"><path d="${clipD}" clip-rule="${clipRule}"/></clipPath><g data-ground="${kind}" clip-path="url(#axo-${kind}-${id})">` +
    `<path d="${d.join('')}" fill="none" stroke="${g.ink}" stroke-width="${(g.w / k).toFixed(4)}"${kind === 'yard' ? ' stroke-linecap="round"' : ''}/></g>`;
}
/** Where a line model's ground hatches go, filled in once the drawing's scale and frame are known. */
const HOLE = { lots: '<!--axo:lots-->', road: '<!--axo:road-->', shade: '<!--axo:shade-->' };

/** How many shapes of crown a drawing draws its trees from. */
const CROWN_VARIANTS = 4;

/**
 * The trees in three sizes, each painted fine enough for the largest of them and its outline as wide in the scene
 * as the others' (radius `r` stands for the size).
 */
const CROWN_SIZES = [{ upTo: 2.2, r: 1.6, perUnit: 64 }, { upTo: 3.6, r: 2.8, perUnit: 104 }, { upTo: Infinity, r: 5, perUnit: 150 }];

/**
 * The box an axonometric is drawn in, sheet millimetres. With `clear`, the drawing slides sideways within its frame
 * (the frame stays) until the site's outline is `margin` mm clear of the vertical line at `x`: a booklet's fold, which
 * the site must not sit in. It goes whichever way is shorter, to the right where the two are even.
 */
export type AxoBox = { x: number; y: number; w: number; h: number; clear?: { x: number; margin: number } };

/** The camera: turned this far off the normal it stands along, looking down at this angle. */
const TURN_DEG = 40, ELEV_DEG = 35;

/**
 * How far from the site a drawing that fills its box must be given the town (AxoScene.frameM): to the frame's far
 * corners on the ground, and past them by what a tall building standing just outside the near edge still shows of
 * itself, and by the slide a booklet's fold may ask for.
 */
export function frameReachM(frameM: number, box: { w: number; h: number }, siteRadiusM = 0): number {
  const depth = (frameM * box.h) / box.w / Math.sin((ELEV_DEG * Math.PI) / 180);
  return Math.hypot(frameM / 2, depth / 2) + siteRadiusM + 90;
}

export function drawAxonometric(scene: AxoScene, box: AxoBox, id: string): string {
  // Heron draws a line model, every drawing of it; a white model (the compliance views) is one in greys
  const line = deckLook().id === 'heron';
  const mono = !!scene.mono || line;
  const G = line ? LINE : MONO;
  const M = mono ? { ...massingInks(), ground: '#ffffff', lot: G.line, park: '#ffffff', road: '#ffffff', axis: G.line, tree: '#ffffff', treeLight: '#ffffff', trunk: G.edge } : massingInks();
  const { ring, reach } = scene;
  // A line model's massing (the yield's massing views, the report's built form) is black and white, with no colour
  // at all: every ink and every fill it is given goes to the grey of its own lightness (a neighbour's tone, what
  // stands on the site), and the site's pen is black. Its compliance views (`scene.mono`: the town a white model so
  // the scheme's colours read alone) keep their colours: the walls' bands of sun hours and the site's accent.
  const plain = line && !scene.mono;
  const bw = (c: string) => (plain ? greyOf(c) : c);
  const inks = plain ? { site: LINE.edge, future: bw(scene.inks.future), futureEdge: bw(scene.inks.futureEdge), envelope: bw(scene.inks.envelope), kerb: bw(scene.inks.kerb) } : scene.inks;
  const look = lookOf(M, mono);
  const turn = (TURN_DEG * Math.PI) / 180;
  const nx = scene.frontNormal.x, ny = scene.frontNormal.y;
  const cam = { x: nx * Math.cos(turn) - ny * Math.sin(turn), y: nx * Math.sin(turn) + ny * Math.cos(turn) };
  const d = { x: -cam.x, y: -cam.y };                 // the view direction, horizontal
  const r = { x: d.y, y: -d.x };                       // the screen's right
  const elev = (ELEV_DEG * Math.PI) / 180, sinE = Math.sin(elev), cosE = Math.cos(elev);
  const P = (p: XY, z: number): [number, number] => [p.x * r.x + p.y * r.y, -((p.x * d.x + p.y * d.y) * sinE + z * cosE)];
  const depth = (p: XY) => p.x * d.x + p.y * d.y;

  // A drawing that fills its box (frameM): its scale is the frame's own, the site at the frame's middle (what
  // stands on it taken in), so the fit is known before anything is drawn and what cannot show in the frame is left
  // out, where the town within reach is three times what the frame holds.
  const slideClear = (k: number, tx: number): number => {
    if (!box.clear || !ring.length) return tx;
    // the site across the page: a point's place across it does not hang on its height, so its outline on the ground is its reach
    const sx = ring.map((p) => P(p, 0)[0] * k + tx);
    const lo = Math.min(...sx), hi = Math.max(...sx), { x: fold, margin } = box.clear;
    if (hi > fold - margin && lo < fold + margin) {
      const right = fold + margin - lo, left = hi - (fold - margin);
      return tx + (right <= left ? right : -left);
    }
    return tx;
  };
  let framed: { k: number; tx: number; ty: number } | null = null;
  if (scene.frameM && scene.frameM > 0 && ring.length) {
    const k = box.w / scene.frameM;
    const siteTop = Math.max(0, ...scene.built.map((pr) => pr.z1));
    const q = ring.flatMap((p) => [P(p, 0), P(p, siteTop)]);
    const qx = q.map((v) => v[0]), qy = q.map((v) => v[1]);
    const tx = slideClear(k, box.x + box.w / 2 - ((Math.min(...qx) + Math.max(...qx)) / 2) * k);
    framed = { k, tx, ty: box.y + box.h / 2 - ((Math.min(...qy) + Math.max(...qy)) / 2) * k };
  }
  /** Whether something standing at `p`, `top` metres tall and `pad` metres about, can show in a filled frame; always, where the frame is fitted to the town. */
  const inFrame = (p: XY, top = 0, pad = 0): boolean => {
    if (!framed) return true;
    const [x, y] = P(p, 0), m = pad * framed.k;
    const X = x * framed.k + framed.tx, Y0 = y * framed.k + framed.ty, Y1 = Y0 - top * cosE * framed.k;
    return X >= box.x - m && X <= box.x + box.w + m && Y0 >= box.y - m && Y1 <= box.y + box.h + m;
  };
  const spanOf = (rg: XY[], cen: XY) => rg.reduce((m, p) => Math.max(m, Math.hypot(p.x - cen.x, p.y - cen.y)), 0);

  // What is drawn: the neighbours within reach, each with its future over it, and the built on the site.
  const prisms: { key: number; group: Prism[] }[] = [];
  const shown: AxoNeighbour[] = [];
  for (const nb of scene.neighbours) {
    const rings = nb.rings.filter((rg) => rg.length >= 3);
    if (!rings.length) continue;
    const cen = rings[0].reduce((t, p) => ({ x: t.x + p.x / rings[0].length, y: t.y + p.y / rings[0].length }), { x: 0, y: 0 });
    if (Math.hypot(cen.x, cen.y) > reach) continue;
    const known = nb.heightM != null && nb.heightM > 0;
    const z1 = known ? nb.heightM! : 6.2;
    if (!inFrame(cen, Math.max(z1, nb.future ?? 0), spanOf(rings[0], cen) + 2)) continue;
    shown.push(nb);
    const group: Prism[] = [mono ? { rings, z0: 0, z1, fill: line && !scene.mono ? bw(nb.fill) : '#ffffff', edge: G.edge, edgeW: 0.12, ...(line ? { edgeMm: LINE_MM.neighbour } : {}), dashed: !known }
      : { rings, z0: 0, z1, fill: nb.fill, edge: shade(nb.fill, M.gloss ? 0.78 : 0.55), edgeW: 0.12, dashed: !known, windows: known }];
    if (nb.future && nb.future > z1) group.push({ rings, z0: z1, z1: nb.future, fill: inks.future, edge: inks.futureEdge, edgeW: 0.12, ...(line ? { edgeMm: LINE_MM.future } : {}), dashed: true, dash: FUTURE_DASH, opacity: FUTURE_OPACITY });
    prisms.push({ key: depth(cen), group });
  }
  for (const f of scene.futures ?? []) {
    const rings = f.rings.filter((rg) => rg.length >= 3);
    if (!rings.length || !(f.heightM > 0)) continue;
    const cen = rings[0].reduce((t, p) => ({ x: t.x + p.x / rings[0].length, y: t.y + p.y / rings[0].length }), { x: 0, y: 0 });
    if (Math.hypot(cen.x, cen.y) > reach) continue;
    prisms.push({ key: depth(cen), group: [{ rings, z0: 0, z1: f.heightM, fill: inks.future, edge: inks.futureEdge, edgeW: 0.12, ...(line ? { edgeMm: LINE_MM.future } : {}), dashed: true, dash: FUTURE_DASH, opacity: FUTURE_OPACITY }] });
  }
  const built: Prism[] = (plain
    ? scene.built.map((pr) => ({ ...pr, fill: bw(pr.fill), edge: bw(pr.edge), ...(pr.cells ? { cells: pr.cells.map((c) => ({ ...c, fill: bw(c.fill) })) } : {}), ...(pr.roof ? { roof: pr.roof.map((c) => ({ ...c, fill: bw(c.fill) })) } : {}) }))
    : scene.built).map((pr) => (line ? { ...pr, edgeMm: LINE_MM.built } : pr));
  prisms.push({ key: 0, group: built });
  prisms.sort((p, q) => q.key - p.key);

  // Light from the north-west and above: a face is lit by how squarely it turns to it.
  const light = { x: -0.55, y: 0.83 };
  const parts: string[] = [];
  const poly = (pts: [number, number][]) => `M${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}Z`;
  const open = (pts: [number, number][]) => `M${pts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}`;

  // The ground: a cream across the whole frame, the lots as hairlines on it with the parks in green, the streets
  // as surfaces kerb to kerb (lib/carriageway.ts), white with the kerb as their edge and a dashed line down the
  // middle; then the site.
  const ground: string[] = [];
  const far = reach + 600;
  ground.push(`<path d="${poly([P({ x: -far, y: -far }, 0), P({ x: far, y: -far }, 0), P({ x: far, y: far }, 0), P({ x: -far, y: far }, 0)])}" fill="${M.ground}"/>`);
  const lawnD: string[] = [], yardD: string[] = [];
  for (const lot of scene.lots) for (const pts of lot.rings) {
    if (pts.length < 3 || pts.some((p) => Math.hypot(p.x, p.y) > reach + 20)) continue;
    if (framed) { const cen = pts.reduce((t, p) => ({ x: t.x + p.x / pts.length, y: t.y + p.y / pts.length }), { x: 0, y: 0 }); if (!inFrame(cen, 0, spanOf(pts, cen) + 1)) continue; }
    const dLot = poly(pts.map((p) => P(p, 0)));
    if (line) (lot.park ? lawnD : yardD).push(dLot);
    ground.push(`<path d="${dLot}" fill="${lot.park && !line ? M.park : 'none'}" stroke="${M.lot}" stroke-width="0.12"/>`);
  }
  if (line) ground.push(HOLE.lots);
  const cw = carriageways(scene.roads, scene.kerbs);
  if (cw.polygons.length) {
    ground.push(`<path d="${cw.polygons.map((rings) => rings.map((rg) => poly(rg.map((p) => P(p, 0)))).join('')).join('')}" fill="${M.road}" fill-rule="evenodd" stroke="${mono ? G.kerb : M.kerb ?? inks.kerb}" stroke-width="${mono ? 0.15 : 0.2}" stroke-linejoin="round"/>`);
    if (line) ground.push(HOLE.road);
    // (Flamingo's flat town: the line down each street as short dashes drawn in outline, laid on the road: each a
    // slip ROAD_DASH.len m long and .w m wide in the streets' cream with the figures' line round it, one every .pitch m)
    if (!mono && look.line) {
      const d: string[] = [];
      for (const { axis } of cw.axes) for (const { p, t } of alongLine(axis, ROAD_DASH.pitch, ROAD_DASH.pitch / 2)) {
        const a = { x: t.x * ROAD_DASH.len / 2, y: t.y * ROAD_DASH.len / 2 }, b = { x: -t.y * ROAD_DASH.w / 2, y: t.x * ROAD_DASH.w / 2 };
        d.push(poly([P({ x: p.x - a.x - b.x, y: p.y - a.y - b.y }, 0), P({ x: p.x + a.x - b.x, y: p.y + a.y - b.y }, 0), P({ x: p.x + a.x + b.x, y: p.y + a.y + b.y }, 0), P({ x: p.x - a.x + b.x, y: p.y - a.y + b.y }, 0)]));
      }
      ground.push(`<path data-road-dashes d="${d.join('')}" fill="${look.line.fill}" stroke="${look.line.line}" stroke-width="0.05" stroke-linejoin="round"/>`);
    } else ground.push(`<path d="${cw.axes.map(({ axis }) => open(axis.map((p) => P(p, 0)))).join('')}" fill="none" stroke="${M.axis}" stroke-width="0.12" stroke-dasharray="1.4,1.1" opacity="0.85"/>`);
  }
  const SITE = inks.site;
  // (a line model's massing: the site a black dash-dot boundary on the ground, with no tint)
  ground.push(plain
    ? `<path data-site d="${poly(ring.map((p) => P(p, 0)))}" fill="none" stroke="${SITE}" stroke-width="0.4" stroke-dasharray="3,1,0.6,1"/>`
    : `<path d="${poly(ring.map((p) => P(p, 0)))}" fill="${SITE}" fill-opacity="0.08" stroke="${SITE}" stroke-width="0.35"/>`);
  // Glossy (Kingfisher, Flamingo): each building casts a soft shadow on the ground, away from the light, as far as its height is tall by
  // the sun's slant; the footprint swept along it, one translucent group so overlaps do not darken twice.
  if (M.gloss) {
    const sh = { x: -light.x * 0.42, y: -light.y * 0.42 };
    const pieces: string[] = [];
    for (const { group } of prisms) for (const pr of group) {
      if (pr.opacity != null) continue;   // a future's glass casts none
      const dz = pr.z1 - pr.z0;
      for (const rg of pr.rings) {
        const off = (p: XY) => ({ x: p.x + sh.x * dz, y: p.y + sh.y * dz });
        pieces.push(poly(rg.map((p) => P(off(p), 0))));
        rg.forEach((p, i) => { const q = rg[(i + 1) % rg.length]; pieces.push(poly([P(p, 0), P(q, 0), P(off(q), 0), P(off(p), 0)])); });
      }
    }
    // (Flamingo's flat town: the shadows flat too, the pale orange of the bars under its people and its trees)
    ground.push(!mono && look.line?.ground ? `<g data-cast-shadows opacity="0.7" fill="${look.line.ground}"><path d="${pieces.join('')}" fill-rule="nonzero"/></g>`
      : `<g opacity="${mono ? 0.07 : 0.1}" fill="${mono ? '#2b2b2b' : INK.blue.deep}"><path d="${pieces.join('')}" fill-rule="nonzero"/></g>`);
  }

  // A line model's windows, drawn on the wall as it stands: bay by bay along it, storey by storey up it, each skewed
  // as the wall is. (Canary hatches the wall turned from the light instead, WALL_HATCH; Flamingo and Kingfisher leave it plain.)
  const lineWindows = (f: { p: XY; q: XY }, pr: Prism): string => {
    const L = Math.hypot(f.q.x - f.p.x, f.q.y - f.p.y);
    if (L < 3) return '';
    const rise = pr.z1 - pr.z0, ruled = (pr.storeys ?? []).filter((z) => z > pr.z0 + 0.5 && z < pr.z1 - 0.5).sort((a, b) => a - b);
    // the floors: the storeys ruled on the wall, or 3.1 m each where none is
    const count = Math.max(1, Math.round(rise / 3.1));
    const floors = ruled.length ? ruled : Array.from({ length: count - 1 }, (_, i) => pr.z0 + ((i + 1) * rise) / count);
    const levels = [pr.z0, ...floors, pr.z1];
    const at = (t: number): XY => ({ x: f.p.x + (f.q.x - f.p.x) * t, y: f.p.y + (f.q.y - f.p.y) * t });
    const bays = Math.max(1, Math.round(L / 3.6)), d: string[] = [];
    for (let k = 0; k + 1 < levels.length; k++) {
      const za = levels[k], h = levels[k + 1] - za;
      if (h < 2) continue;
      const sill = za + h * 0.3, head = za + h * 0.8;
      if (LINE_WINDOWS === 'ribbon') { const a = at(0.7 / L), b = at(1 - 0.7 / L); d.push(poly([P(a, sill), P(b, sill), P(b, head), P(a, head)])); }
      else if (LINE_WINDOWS === 'frames') for (let i = 0; i < bays; i++) { const a = at((i + 0.27) / bays), b = at((i + 0.73) / bays); d.push(poly([P(a, sill), P(b, sill), P(b, head), P(a, head)])); }
    }
    // mullions: a fine upright between the bays, the storeys' lines across them a curtain wall's grid
    if (LINE_WINDOWS === 'mullions') for (let i = 1; i < bays; i++) d.push(open([P(at(i / bays), pr.z0), P(at(i / bays), pr.z1)]));
    return d.length ? `<path data-windows="${LINE_WINDOWS}" d="${d.join('')}" fill="${LINE_WINDOWS === 'mullions' ? 'none' : '#ffffff'}" stroke="${LINE.edge}" stroke-width="0.05" stroke-linejoin="round"/>` : '';
  };
  // A line model's massing has no grey fills: a prism given a tone (a neighbour's band of storeys, what stands on the
  // site, a shop's floors) is white, its walls hatched so the tone reads as shade: the closer the darker its tone, and
  // closest on the wall turned from the light, opening to nearly twice the spacing on one turned full to it; its roof
  // stays white. What is built on the site in a firmer line. The hatches are drawn once the drawing's scale is known,
  // each clipped to its face.
  const faceHatches: { d: string; pts: [number, number][]; pitch: number; w: number; ink?: string }[] = [];
  const hatchOf = (pr: Prism) => { const pitch = plain && pr.opacity == null ? lineHatchPitch(pr.fill) : null; return pitch ? { pitch, w: built.includes(pr) ? 0.09 : 0.06 } : null; };
  const hatchFace = (pts: [number, number][], d: string, h: { pitch: number; w: number; ink?: string }) => { faceHatches.push({ d, pts, ...h }); return `<!--axo:fh${faceHatches.length - 1}-->`; };
  const prismSvg = (pr: Prism) => {
    const out: string[] = [];
    const dash = pr.dashed ? ` stroke-dasharray="${pr.dash ?? '0.8,0.6'}"` : '';
    const alpha = pr.opacity != null ? ` fill-opacity="${pr.opacity}"` : '';
    const ew = pr.edgeMm != null ? PW(pr.edgeMm) : String(pr.edgeW);
    const hatch = hatchOf(pr), flat = hatch ? '#ffffff' : pr.fill;
    pr.rings.forEach((rg, ri) => {
      let sa = 0;
      for (let i = 0; i < rg.length; i++) { const u = rg[i], v = rg[(i + 1) % rg.length]; sa += u.x * v.y - v.x * u.y; }
      const faces = rg.map((p, i) => {
        const q = rg[(i + 1) % rg.length], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        const m = sa > 0 ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
        return { i, p, q, m, mid: depth({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) };
      }).filter((f) => f.m.x * d.x + f.m.y * d.y < 0).sort((f, g) => g.mid - f.mid);
      for (const f of faces) {
        // glossy: the faces barely shaded, the shadows cast on the ground instead
        // (a line model: no shade at all, the volume read from its edges)
        const lit = line ? 1 : (M.gloss ? 0.9 : 0.72) + (M.gloss ? 0.1 : 0.28) * Math.max(0, f.m.x * light.x + f.m.y * light.y);
        const facePts = [P(f.p, pr.z0), P(f.q, pr.z0), P(f.q, pr.z1), P(f.p, pr.z1)];
        const face = poly(facePts);
        out.push(`<path d="${face}" fill="${hatch ? flat : shade(pr.fill, lit)}"${alpha} stroke="${pr.edge}" stroke-width="${ew}" stroke-linejoin="round"${dash}/>`);
        if (hatch) out.push(hatchFace(facePts, face, { pitch: hatch.pitch * (1 + 0.9 * Math.max(0, f.m.x * light.x + f.m.y * light.y)), w: hatch.w }));
        const celled = (pr.cells ?? []).some((c) => c.ring === ri && c.edge === f.i);
        // (a line model: its windows drawn on the wall; none over a wall coloured by its hours of sun, which is a grid already)
        if (pr.windows && line) out.push(celled ? '' : lineWindows(f, pr));
        // (Canary: the wall turned from the light hatched as shade, none over a wall coloured by its hours of sun;
        // the glossy models, Flamingo and Kingfisher: no hatch at all)
        else if (pr.windows && !celled && !M.gloss) {
          const pitch = wallHatchPitch(f.m.x * light.x + f.m.y * light.y);
          if (pitch) out.push(hatchFace(facePts, face, { pitch, w: WALL_HATCH.w, ink: shade(pr.fill, WALL_HATCH.ink) }));
        }
        // the panels on this face, lit as it is, each outlined
        for (const c of pr.cells ?? []) {
          if (c.ring !== ri || c.edge !== f.i) continue;
          const at = (t: number): XY => ({ x: f.p.x + (f.q.x - f.p.x) * t, y: f.p.y + (f.q.y - f.p.y) * t });
          const a = at(Math.max(0, c.t0)), b = at(Math.min(1, c.t1));
          const cell = poly([P(a, c.z0), P(b, c.z0), P(b, c.z1), P(a, c.z1)]);
          out.push(`<path d="${cell}" fill="${c.flat ? c.fill : shade(c.fill, lit)}" stroke="${c.flat ? '#ffffff' : shade(c.fill, 0.55)}" stroke-width="0.07" stroke-linejoin="round"/>`);
        }
        for (const zz of pr.storeys ?? []) {
          const [x1, y1] = P(f.p, zz), [x2, y2] = P(f.q, zz);
          out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${line ? LINE.edge : shade(pr.fill, 0.62)}" stroke-width="${line ? PW(LINE_MM.storey) : 0.08}"/>`);
        }
      }
    });
    const roofD = pr.rings.map((rg) => poly(rg.map((p) => P(p, pr.z1)))).join('');
    out.push(`<path d="${roofD}" fill="${line ? flat : shade(pr.fill, M.gloss ? 1.3 : 1.12)}"${alpha} fill-rule="evenodd" stroke="${pr.edge}" stroke-width="${ew}" stroke-linejoin="round"${dash}/>`);
    for (const c of pr.roof ?? []) out.push(`<path d="${poly(c.pts.map((p) => P(p, pr.z1)))}" fill="${c.fill}" stroke="#ffffff" stroke-width="0.07" stroke-linejoin="round"/>`);
    return out.join('');
  };
  // The outer edge of what the prisms cover on paper: every face, joined.
  const silhouette = (group: Prism[]): string => {
    const faces: number[][][][] = [];
    const add = (pts: [number, number][]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) { const u = pts[i], v = pts[(i + 1) % pts.length]; a += u[0] * v[1] - v[0] * u[1]; }
      if (Math.abs(a) > 1e-6) faces.push([[...pts, pts[0]]]);
    };
    for (const pr of group) for (const rg of pr.rings) {
      add(rg.map((p) => P(p, pr.z1)));
      rg.forEach((p, i) => { const q = rg[(i + 1) % rg.length]; add([P(p, pr.z0), P(q, pr.z0), P(q, pr.z1), P(p, pr.z1)]); });
    }
    if (!faces.length) return '';
    try {
      const joined = turfUnion(featureCollection(faces.map((f) => polygon(f)))) as any;
      const g = joined?.geometry;
      const rings: number[][][] = g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : [];
      return `<path d="${rings.map((rg) => poly(rg.slice(0, -1) as [number, number][])).join('')}" fill="none" stroke="${line ? '#000000' : '#2e2e2e'}" stroke-width="${line ? PW(LINE_MM.silhouette) : 0.24}" stroke-linejoin="round"/>`;
    } catch { return ''; }
  };
  // The trees: each a crown on a trunk, which the projection draws as a circle, a sphere's outline; none where a
  // footprint stands, and none on the site unless the caller keeps them.
  // (in a filled frame, the footprints that show in it: nothing else is drawn for one to stand on)
  const footprints: XY[][] = [...(framed ? shown : scene.neighbours).flatMap((nb) => nb.rings), ...built.flatMap((pr) => pr.rings)];
  // A crown read off the aerial over a street stands at the kerb, not in the traffic: one whose middle falls on a
  // carriageway is moved out past the nearer kerb onto the verge, and left out where there is no room there.
  const onRoad = (p: XY) => cw.polygons.some((rings) => rings.reduce((k, rg) => k + (inRing(p, rg) ? 1 : 0), 0) % 2 === 1);
  const offRoad = (p: XY): XY | undefined => {
    if (!onRoad(p)) return p;
    let best: XY | undefined, bd = Infinity;
    for (const rings of cw.polygons) for (const rg of rings) for (let i = 0; i < rg.length; i++) {
      const a = rg[i], b = rg[(i + 1) % rg.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)), q = { x: a.x + t * dx, y: a.y + t * dy };
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < bd) { bd = dd; best = q; }
    }
    if (!best || bd > 12) return undefined;
    const ux = (best.x - p.x) / (bd || 1), uy = (best.y - p.y) / (bd || 1), q = { x: best.x + ux * 1.6, y: best.y + uy * 1.6 };
    return onRoad(q) ? undefined : q;
  };
  const trees = scene.trees.flatMap((tr) => { const p = offRoad(tr.p); return p ? [{ ...tr, p }] : []; })
    .filter((tr) => Math.hypot(tr.p.x, tr.p.y) <= reach + 10 && inFrame(tr.p, 4 + 3 * tr.r, tr.r + 2) && !footprints.some((rg) => inRing(tr.p, rg)) && (scene.treesOnSite || !inRing(tr.p, ring)));
  // Illustrated, each tree takes its green by its place, and a few small ones stand narrow and upright. Its crown is
  // one of a few stamps, each shape in each green drawn once at a radius of one and placed at the tree's size.
  const greenOf = (p: XY) => {
    let u = rand(p, 7);
    for (const [ink, share] of look.accents) { if (u < share) return ink; u -= share; }
    return look.greens[Math.floor(rand(p, 3) * look.greens.length)] ?? M.tree;
  };
  const columnar = (tr: { p: XY; r: number }) => look.columnar > 0 && tr.r < 2.4 && rand(tr.p, 11) < look.columnar;
  // A canopy tree, each its own: a form (one of the four broadleaf ones; a cypress for a narrow upright tree; now and
  // then a conifer), a way of standing (a single trunk forking in the arch under its crown; a trunk forking low into
  // two; two or three stems from the ground), its bare trunk short or tall, its crown a little taller or broader.
  type Habit = { form: number; stems: 'single' | 'fork' | 'multi'; variant: number; bole: number; stretch: number };
  const habits = new Map<XY, Habit>();
  const habitOf = (tr: { p: XY; r: number }): Habit => {
    let h = habits.get(tr.p);
    if (h) return h;
    const u = rand(tr.p, 1), conifer = !columnar(tr) && rand(tr.p, 41) < 0.12;
    const form = columnar(tr) ? CANOPY.cypress : conifer ? CANOPY.conifer : Math.floor(u * 4);
    const sv = rand(tr.p, 43), stems = form >= CANOPY.cypress ? 'single' : sv < 0.5 ? 'single' : sv < 0.8 ? 'fork' : 'multi';
    const variant = canopyVariant(form, Math.floor(rand(tr.p, 31) * CANOPY_BRANCHINGS), stems === 'single');
    // the bare trunk, metres: a conifer's or a cypress's short; a broadleaf's from a little to well over the crown's radius
    const bole = form >= CANOPY.cypress ? 0.3 + 0.6 * rand(tr.p, 45) : 0.5 + tr.r * (0.15 + 1.05 * rand(tr.p, 45) ** 1.3);
    h = { form, stems, variant, bole, stretch: 0.86 + 0.32 * rand(tr.p, 47) };
    habits.set(tr.p, h);
    return h;
  };
  // the crown's middle: a canopy's above its bare trunk, its leaves ending where its form says (on the page a height is
  // cos 35° of itself); a cloud's on a trunk of about two metres
  const crownCentre = (tr: { p: XY; r: number }) => {
    if (look.crown !== 'canopy') return 2.2 + tr.r * (columnar(tr) ? 1.3 : 1);
    const h = habitOf(tr);
    return h.bole + (canopyBottom(h.variant) * tr.r * h.stretch) / Math.cos(elev);
  };
  // the crowns' pictures, each once in the drawing's defs, placed at each tree's size (render/crowns.ts)
  const stamps = new Map<string, string>(), stampDefs: string[] = [];
  const outlineM = 0.12, WOOD = line ? LINE.edge : shade(INK.red.solid, 0.84);
  const stampOf = (kind: CrownKind, variant: number, g: string, r: number) => {
    const size = CROWN_SIZES.find((sz) => r < sz.upTo)!;
    const key = `${kind}|${variant}|${g}|${size.r}`;
    let sid = stamps.get(key);
    if (!sid) {
      sid = `axo-${id}-t${stamps.size}`;
      stamps.set(key, sid);
      // a canopy: its leaves a light cut of its green, its wood the style's terracotta, the town's contour round it; a
      // cloud: its shade, the lit part, the highlight, its outline
      // (black and white alone: each crown hatched in black inside its black contour, so the trees stand apart from the white buildings)
      const tones = line ? { dark: '#ffffff', lit: '#ffffff', high: LINE.edge, edge: LINE.edge, wood: 0.45, ...(tpl().plain ? { hatch: { ink: LINE.edge, pitch: 0.3, width: 0.045 } } : {}) } : kind === 'canopy'
        ? { dark: tint(g, 0.85), lit: g, high: CONTOUR, edge: WOOD }
        : { dark: shade(g, 0.8), lit: g, high: tint(g, 0.45), edge: shade(g, 0.52) };
      // a canopy's contour the town's one, as thin as the people's and the vehicles'
      const pic = crownPicture(kind, variant, tones, (kind === 'canopy' ? 0.05 : outlineM) / size.r, size.perUnit);
      stampDefs.push(`<image id="${sid}" href="${pic.uri}" x="${pic.x.toFixed(4)}" y="${pic.y.toFixed(4)}" width="${pic.w.toFixed(4)}" height="${pic.h.toFixed(4)}" preserveAspectRatio="none"/>`);
    }
    return sid;
  };
  // A flat tree's form, by its place: a narrow upright one a cypress or a conifer; a few of the smallest a low bush;
  // the rest mostly three-lobed and round crowns, with a hexagon, a bell, a conifer and a ruled shield among them.
  const flatFormOf = (tr: { p: XY; r: number }): FlatForm => {
    if (columnar(tr)) return rand(tr.p, 61) < 0.5 ? 'cypress' : 'cone';
    if (tr.r < 1.7 && rand(tr.p, 63) < 0.22) return 'bush';
    const u = rand(tr.p, 1);
    return u < 0.4 ? 'trefoil' : u < 0.62 ? 'round' : u < 0.72 ? 'hex' : u < 0.82 ? 'bell' : u < 0.9 ? 'cone' : 'shield';
  };
  // each form in each teal once in the drawing's defs, at a radius of one, placed at each tree's size; one for each of
  // the crowns' sizes, so the lines in a wide crown are no heavier than those in a small one (some 0.09 m)
  // (a paper tree: in the ground's cream with the figures' line round it, as the references leave a few of theirs)
  const flatStamp = (form: FlatForm, tone: string, r: number, paper = false) => {
    const size = CROWN_SIZES.find((sz) => r < sz.upTo)!;
    const key = `flat|${form}|${paper ? 'paper' : tone}|${size.r}`;
    let sid = stamps.get(key);
    if (!sid) {
      sid = `axo-${id}-f${stamps.size}`;
      stamps.set(key, sid);
      stampDefs.push(paper ? flatCrownSvg(sid, form, FLAT_LINE.fill, FLAT_LINE.line, 0.06 / size.r, FLAT_LINE.line) : flatCrownSvg(sid, form, tone, shade(tone, 0.72), 0.09 / size.r));
    }
    return sid;
  };
  const parkRings = scene.lots.filter((lot) => lot.park).flatMap((lot) => lot.rings);
  const flatTreeSvg = (tr: { p: XY; r: number }) => {
    const form = flatFormOf(tr);
    // the shields, and half the cypresses and the bushes, in the lighter teal; about one tree in fourteen left in paper
    const paper = form !== 'bush' && form !== 'shield' && rand(tr.p, 67) < 0.07;
    const tone = form === 'shield' || ((form === 'cypress' || form === 'bush') && rand(tr.p, 69) < 0.5) ? FLAT_TEAL.light : greenOf(tr.p);
    const [bx, by] = P(tr.p, 0), R = form === 'bush' ? Math.max(1.1, tr.r) : tr.r, sid = flatStamp(form, tone, R, paper);
    // the bar on the ground at its foot: the figures' pale orange on the paper, a thin cut of the tree's teal on a park's green
    const half = Math.max(0.6, R * 0.62), onGrass = parkRings.some((rg) => inRing(tr.p, rg));
    const bar = `<rect data-tree-bar x="${(bx - half).toFixed(2)}" y="${(by - 0.14).toFixed(2)}" width="${(2 * half).toFixed(2)}" height="0.28" rx="0.14" ${onGrass ? `fill="${tone}" fill-opacity="0.3"` : `fill="${FLAT_LINE.ground}"`}/>`;
    if (form === 'bush') return `<use href="#${sid}" transform="translate(${bx.toFixed(2)},${(by - flatBottom(form) * R).toFixed(2)}) scale(${R.toFixed(3)})"/>`;
    const [cx, cy] = P(tr.p, crownCentre(tr));
    return bar + `<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + (flatBottom(form) - 0.04) * R).toFixed(2)}" stroke="${paper ? FLAT_LINE.line : shade(tone, 0.72)}" stroke-width="${paper ? 0.07 : 0.12}" stroke-linecap="round"/>` +
      `<use href="#${sid}" transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${R.toFixed(3)})"/>`;
  };
  const treeSvg = (tr: { p: XY; r: number }) => {
    if (look.crown === 'flat') return flatTreeSvg(tr);
    const zc = crownCentre(tr);
    const [cx, cy] = P(tr.p, zc), [bx, by] = P(tr.p, 0);
    if (look.crown === 'disc') {
      return `<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${M.trunk}" stroke-width="0.25"/>` +
        (mono ? `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${tr.r.toFixed(2)}" fill="#ffffff" stroke="${G.edge}" stroke-width="0.1"/>`
          : `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${tr.r.toFixed(2)}" fill="${M.tree}"/>` +
          `<circle cx="${(cx - 0.22 * tr.r).toFixed(2)}" cy="${(cy - 0.2 * tr.r).toFixed(2)}" r="${(0.66 * tr.r).toFixed(2)}" fill="${M.treeLight}"/>`);
    }
    const R = tr.r, tall = columnar(tr);
    if (look.crown !== 'canopy') {
      const sid = stampOf(tall ? 'columnar' : look.crown as CrownKind, Math.floor(rand(tr.p, 1) * CROWN_VARIANTS), greenOf(tr.p), R);
      return `<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + R * 0.5).toFixed(2)}" stroke="#7d6c5a" stroke-width="0.3" stroke-linecap="round"/>` +
        `<use href="#${sid}" transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${R.toFixed(3)})"/>`;
    }
    // a canopy: its stems from the ground to under its crown, in the wood's terracotta, and the crown over them
    const h = habitOf(tr), sid = stampOf('canopy', h.variant, greenOf(tr.p), R);
    const under = cy + R * h.stretch * canopyBottom(h.variant), into = under - R * h.stretch * 0.22;
    const stem = (x1: number, y1: number, x2: number, y2: number, w: number) =>
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${WOOD}" stroke-width="${line ? (w * 0.4).toFixed(3) : w}" stroke-linecap="round"/>`;
    let wood: string;
    if (h.stems === 'fork') {
      // one trunk forking low, its two limbs leaning out into the crown
      const fy = by + (under - by) * (0.35 + 0.25 * rand(tr.p, 49)), lean = (rand(tr.p, 51) - 0.5) * 0.3 * R;
      wood = stem(bx, by, cx + lean * 0.3, fy, 0.24) + stem(cx + lean * 0.3, fy, cx - 0.32 * R + lean, into, 0.17) + stem(cx + lean * 0.3, fy, cx + 0.3 * R + lean, into, 0.17);
    } else if (h.stems === 'multi') {
      // two or three stems from one foot, spreading into the crown
      const n = 2 + Math.floor(rand(tr.p, 53) * 2);
      wood = Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0 : -1 + (2 * i) / (n - 1); return stem(bx + t * 0.12, by, cx + t * 0.34 * R, into, 0.15); }).join('');
    } else wood = stem(bx, by, cx, under, 0.2);
    return wood + `<use href="#${sid}" transform="translate(${cx.toFixed(2)},${cy.toFixed(2)}) scale(${R.toFixed(3)},${(R * h.stretch).toFixed(3)})"/>`;
  };
  // Traffic (placeTraffic): each vehicle a few blocks along its length, in stacks one behind the other, each stack a
  // column of blocks bottom to top, drawn far to near. A car, a body with a cabin, in the families' solid colours in
  // turn; a delivery van, white mostly, its box behind a cab with a windscreen and a bonnet; a rigid truck, a pale box
  // on its chassis behind a cab in the cars' colours; an articulated truck, its trailer behind a prime mover with a
  // bonnet, as the long-nosed ones on Australian roads; a bus, a skirt in the blue family under a band of glass and a
  // white roof.
  // Kingfisher's traffic as an illustrator's isometric vehicles: whites, greys, a yellow and an orange, the glass dark,
  // the town's one thin contour round each
  const kfCars = !mono && deckLook().id === 'kingfisher';
  // Flamingo's traffic in line alone, as its people are: the same drawn vehicles, every part in the paper's cream with
  // the one thin line round it, the windows and the wheels in outline, a pale warm patch on the road under each
  const LF = mono ? undefined : look.line;
  const drawnCars = kfCars || !!LF;
  // in Kingfisher's own colours: mostly warm whites and light greys, its terracotta, mint, pale blue, a cut of its deep
  // blue and its deep terracotta among them; the glass a dark slate of its blue; edged with the town's one contour
  const CAR_INKS = mono ? ['#ffffff'] : LF ? [LF.fill] : deckLook().id === 'heron' ? ['#f2f2f2', '#bdbdbd', '#8c8c8c', '#e2e2e2', '#5e5e5e'] : kfCars
    ? ['#f5f3ef', INK.red.solid, '#d9d6d1', INK.green.solid, '#f5f3ef', INK.blue.solid, tint(INK.blue.deep, 0.25), '#d9d6d1', INK.red.deep]
    : [vivid(INK.red.solid, 0.55, 0.45), vivid(INK.blue.solid, 0.5, 0.42), vivid(INK.orange.solid, 0.7, 0.5), '#f4f4f0'];
  const WHITE = mono ? '#ffffff' : LF ? LF.fill : kfCars ? '#f5f3ef' : '#f4f4f0', GLASS = mono ? G.glass : LF ? LF.fill : kfCars ? shade(INK.blue.deep, 0.62) : tint(INK.blue.solid, 0.78);
  const PALE = mono ? '#ffffff' : LF ? LF.fill : kfCars ? '#ece9e3' : '#e6e5df', CHASSIS = mono ? G.chassis : LF ? LF.fill : kfCars ? '#6e7380' : '#4a4a4a';
  const VAN_INKS = [WHITE, WHITE, CAR_INKS[2 % CAR_INKS.length], WHITE, CAR_INKS[1 % CAR_INKS.length]];
  type Block = { s0: number; s1: number; hw: number; z0: number; z1: number; fill: string };
  const block = (s0: number, s1: number, hw: number, z0: number, z1: number, fill: string): Block => ({ s0, s1, hw, z0, z1, fill });
  // a cab: its doors, its windscreen and side glass, its roof
  const cab = (s0: number, s1: number, hw: number, z0: number, zg: number, zr: number, z1: number, ink: string) =>
    [block(s0, s1, hw, z0, zg, ink), block(s0, s1, hw, zg, zr, GLASS), block(s0, s1, hw, zr, z1, ink)];
  const inkTurn: Record<VehicleKind, number> = { car: 0, van: 0, truck: 0, semi: 0, bus: 0 };
  const stacksOf = (kind: VehicleKind): Block[][] => {
    const i = inkTurn[kind]++;
    const ink = kind === 'van' ? VAN_INKS[i % VAN_INKS.length] : CAR_INKS[i % CAR_INKS.length];
    switch (kind) {
      case 'car': return [[block(-2.2, 2.2, 0.9, 0.25, 1.3, ink), block(-1.35, 0.85, 0.8, 1.3, 1.95, GLASS)]];
      case 'van': return [[block(-2.95, 1.25, 1.0, 0.35, 2.55, ink)], cab(1.25, 2.2, 1.0, 0.35, 1.3, 2.25, 2.5, ink), [block(2.2, 2.95, 0.98, 0.35, 1.15, ink)]];
      case 'truck': return [[block(-4.3, 2.15, 1.0, 0.45, 1.0, CHASSIS), block(-4.3, 2.15, 1.25, 1.0, 3.6, PALE)], cab(2.3, 4.3, 1.22, 0.45, 1.75, 2.65, 3.0, ink)];
      case 'semi': return [[block(-8.25, 5.0, 1.0, 0.5, 1.2, CHASSIS), block(-8.25, 5.0, 1.25, 1.2, 4.1, PALE)], [block(5.0, 5.6, 1.0, 0.5, 1.1, CHASSIS)],
        cab(5.6, 7.3, 1.25, 0.5, 2.0, 2.8, 3.4, ink), [block(7.3, 8.25, 1.1, 0.5, 1.85, ink)]];
      case 'bus': return [[block(-6.25, 6.25, 1.25, 0.35, 1.3, CAR_INKS[1 % CAR_INKS.length]), block(-6.25, 6.25, 1.25, 1.3, 2.6, GLASS), block(-6.25, 6.25, 1.25, 2.6, 3.15, WHITE)]];
    }
  };
  const vehicleSvg = (v: Vehicle, stacks: Block[][]): string => {
    const along = v.u.x * d.x + v.u.y * d.y;   // how much farther each metre forward stands
    const at = (b: Block): Prism => ({ rings: [corners({ ...v, c: { x: v.c.x + v.u.x * (b.s0 + b.s1) / 2, y: v.c.y + v.u.y * (b.s0 + b.s1) / 2 }, half: (b.s1 - b.s0) / 2, hw: b.hw })], z0: b.z0, z1: b.z1, fill: b.fill, edge: mono ? G.edge : kfCars ? shade(b.fill, 0.74) : '#3a3a3a', edgeW: line ? 0.07 : kfCars ? 0.05 : 0.1 });
    const order = [...stacks].sort((p, q) => (q[0].s0 + q[0].s1) * along - (p[0].s0 + p[0].s1) * along);
    return `<g data-vehicle="${v.kind}">${order.map((st) => st.map((b) => prismSvg(at(b))).join('')).join('')}</g>`;
  };
  // Kingfisher's vehicles as an illustrator's isometric ones: each part a side profile (s along its length, the front
  // forward; z up; counter-clockwise) carried across its width, only the faces turned to the camera drawn, far first, the
  // side last; the glass dark (a profile edge's face, and windows on the side); wheels on the near side, a hub in each.
  type Solid = { prof: [number, number][]; hw: number; fill: string; glass?: number[]; windows?: [number, number][][]; wheels?: { s: number; r: number }[]; panes?: number };
  const solidsOf = (kind: VehicleKind, ink: string): Solid[] => {
    switch (kind) {
      case 'car': return [{ prof: [[-2.2, 0.32], [2.2, 0.32], [2.2, 0.8], [1.2, 0.94], [0.5, 1.42], [-1.2, 1.42], [-1.95, 1.0], [-2.2, 0.92]], hw: 0.88, fill: ink, glass: [3, 5],
        windows: [[[1.08, 1.0], [0.55, 1.35], [-0.28, 1.35], [-0.28, 1.0]], [[-0.4, 1.0], [-0.4, 1.35], [-1.12, 1.35], [-1.7, 1.02]]], wheels: [{ s: 1.42, r: 0.33 }, { s: -1.42, r: 0.33 }] }];
      case 'van': return [{ prof: [[-2.95, 0.36], [2.95, 0.36], [2.95, 1.08], [2.45, 1.28], [1.75, 2.36], [-2.95, 2.42]], hw: 1.0, fill: ink, glass: [3],
        windows: [[[2.22, 1.4], [1.78, 2.2], [1.05, 2.2], [1.05, 1.4]]], wheels: [{ s: 2.0, r: 0.36 }, { s: -2.0, r: 0.36 }] }];
      case 'truck': return [
        { prof: [[-4.3, 0.45], [2.15, 0.45], [2.15, 1.0], [-4.3, 1.0]], hw: 0.95, fill: CHASSIS, wheels: [{ s: -3.2, r: 0.48 }, { s: -2.15, r: 0.48 }] },
        { prof: [[-4.3, 1.0], [2.15, 1.0], [2.15, 3.6], [-4.3, 3.6]], hw: 1.25, fill: PALE },
        { prof: [[2.3, 0.45], [4.3, 0.45], [4.3, 1.65], [4.12, 2.75], [3.7, 3.0], [2.3, 3.0]], hw: 1.22, fill: ink, glass: [2],
          windows: [[[3.98, 1.85], [3.86, 2.68], [3.0, 2.68], [3.0, 1.85]]], wheels: [{ s: 3.45, r: 0.48 }] }];
      case 'semi': return [
        { prof: [[-8.25, 0.5], [5.0, 0.5], [5.0, 1.2], [-8.25, 1.2]], hw: 0.95, fill: CHASSIS, wheels: [{ s: -7.2, r: 0.5 }, { s: -6.1, r: 0.5 }, { s: -5.0, r: 0.5 }] },
        { prof: [[-8.25, 1.2], [5.0, 1.2], [5.0, 4.1], [-8.25, 4.1]], hw: 1.25, fill: PALE },
        { prof: [[5.1, 0.5], [8.25, 0.5], [8.25, 1.75], [7.35, 1.95], [7.0, 3.3], [5.1, 3.3]], hw: 1.25, fill: ink, glass: [3],
          windows: [[[6.88, 2.1], [6.66, 3.12], [5.9, 3.12], [5.9, 2.1]]], wheels: [{ s: 5.65, r: 0.5 }, { s: 7.6, r: 0.5 }] }];
      case 'bus': return [{ prof: [[-6.25, 0.35], [6.25, 0.35], [6.25, 2.9], [6.05, 3.15], [-6.25, 3.15]], hw: 1.25, fill: WHITE, glass: [],
        windows: [[[6.12, 1.3], [6.12, 2.72], [-6.1, 2.72], [-6.1, 1.3]]], panes: 1.4, wheels: [{ s: 4.4, r: 0.48 }, { s: -4.4, r: 0.48 }] }];
    }
  };
  const viewDown = Math.sin(elev), viewAlong = Math.cos(elev);
  const solidSvg = (v: Vehicle, so: Solid): string => {
    const pt = (sx: number, side: number, z: number) => P({ x: v.c.x + v.u.x * sx + v.n.x * side, y: v.c.y + v.u.y * sx + v.n.y * side }, z);
    const along = v.u.x * d.x + v.u.y * d.y;
    const edge = LF ? LF.line : CONTOUR, pen = LF ? 0.07 : 0.05, out: string[] = [];
    // (in line alone: no shade on a face, the cream as it is)
    const tone = (fill: string, lit: number) => (LF ? fill : shade(fill, lit));
    const lightOf = (hx: number, hy: number, nz: number) => 0.9 + 0.1 * Math.max(0, hx * light.x + hy * light.y) + 0.22 * Math.max(0, nz);
    // the faces across the width, one to each edge of the profile that faces the camera, far first
    const faces: { key: number; svg: string }[] = [];
    so.prof.forEach(([s0, z0], i) => {
      const [s1, z1] = so.prof[(i + 1) % so.prof.length], ds = s1 - s0, dz = z1 - z0, l = Math.hypot(ds, dz) || 1;
      const ns = dz / l, nz = -ds / l;   // outward, the profile counter-clockwise
      if (ns * along * viewAlong - nz * viewDown >= 0) return;
      const fill = so.glass?.includes(i) ? GLASS : tone(so.fill, lightOf(v.u.x * ns, v.u.y * ns, nz));
      const quad = poly([pt(s0, so.hw, z0), pt(s1, so.hw, z1), pt(s1, -so.hw, z1), pt(s0, -so.hw, z0)]);
      faces.push({ key: ((s0 + s1) / 2) * along - ((z0 + z1) / 2) * 0.001, svg: `<path d="${quad}" fill="${fill}" stroke="${edge}" stroke-width="${pen}" stroke-linejoin="round"/>` });
    });
    faces.sort((a, b) => b.key - a.key);
    out.push(...faces.map((f) => f.svg));
    // the side turned to the camera, its windows, its wheels
    const side = v.n.x * d.x + v.n.y * d.y < 0 ? so.hw : -so.hw, sn = Math.sign(side);
    out.push(`<path d="${poly(so.prof.map(([sx, z]) => pt(sx, side, z)))}" fill="${tone(so.fill, lightOf(v.n.x * sn, v.n.y * sn, 0))}" stroke="${edge}" stroke-width="${pen}" stroke-linejoin="round"/>`);
    for (const w of so.windows ?? []) out.push(`<path d="${poly(w.map(([sx, z]) => pt(sx, side * 1.002, z)))}" fill="${GLASS}"${LF ? ` stroke="${edge}" stroke-width="0.05" stroke-linejoin="round"` : ''}/>`);
    if (so.panes && so.windows?.length) {
      const [[a0], , [a1]] = so.windows[0], zs = so.windows[0].map(([, z]) => z), zlo = Math.min(...zs), zhi = Math.max(...zs);
      for (let sx = Math.min(a0, a1) + so.panes; sx < Math.max(a0, a1) - 0.3; sx += so.panes) {
        const [x1, y1] = pt(sx, side * 1.003, zlo), [x2, y2] = pt(sx, side * 1.003, zhi);
        out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${LF ? edge : so.fill}" stroke-width="${LF ? 0.05 : 0.12}"/>`);
      }
    }
    for (const w of so.wheels ?? []) {
      const ring = (r: number) => Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * Math.PI * 2; return pt(w.s + Math.cos(a) * r, side * 1.01, w.r + Math.sin(a) * r); });
      out.push(LF ? `<path d="${poly(ring(w.r))}" fill="${LF.fill}" stroke="${edge}" stroke-width="0.06"/><path d="${poly(ring(w.r * 0.4))}" fill="none" stroke="${edge}" stroke-width="0.04"/>`
        : `<path d="${poly(ring(w.r))}" fill="#363940"/><path d="${poly(ring(w.r * 0.42))}" fill="#b7b9be"/>`);
    }
    return out.join('');
  };
  const vehicleSolidsSvg = (v: Vehicle, solids: Solid[]): string => {
    const along = v.u.x * d.x + v.u.y * d.y;
    const mid = (so: Solid) => so.prof.reduce((t, [sx]) => t + sx, 0) / so.prof.length;
    // (in line alone: a pale warm patch on the road under it, its footprint a step from the light)
    const patch = LF?.ground ? `<path data-vehicle-patch d="${poly(corners({ ...v, c: { x: v.c.x - light.x * 0.45, y: v.c.y - light.y * 0.45 } }).map((q) => P(q, 0)))}" fill="${LF.ground}"/>` : '';
    return `<g data-vehicle="${v.kind}">${patch}${[...solids].sort((p, q) => mid(q) * along - mid(p) * along).map((so) => solidSvg(v, so)).join('')}</g>`;
  };
  // the colours go round in the order the vehicles were placed, nearest the site first
  const traffic = placeTraffic(cw, { reach, footprints, busRoutes: scene.busRoutes, within: framed ? (p) => inFrame(p, 4.5, 9) : undefined }).map((v) => {
    const stacks = stacksOf(v.kind);
    return { ...v, stacks, solids: drawnCars ? solidsOf(v.kind, stacks[stacks.length - 1][0].fill) : undefined };
  });
  // People on the footpaths and bicycles at the kerb: a walker every so often along each street's footpath, a body
  // standing on the ground with a head over it; a rider every so often down the kerb side of the lane, two wheels
  // and a frame with the body over them; in the traffic's colours and a dark grey in turn. None down a lane, no
  // bicycle on a highway, none where a building or a vehicle stands, and none on the site.
  const FIGURE_INKS = mono ? [G.figure] : look.people === 'figure'
    ? ['#ffffff', '#2e2e33', CAR_INKS[0], CAR_INKS[1], '#e9c24b', tint(INK.red.solid, 0.45), '#ffffff', CAR_INKS[2]]
    : [...CAR_INKS.slice(0, 3), '#3a3a3a'];
  const SKIN = ['#f0c8a4', '#d69c74', '#a46c4a', '#6a4430'], LEGS = ['#2f3542', '#4b5d7e', '#3b3b3b', '#bfae92'];
  const SPOKE = mono ? G.edge : '#3a3a3a';
  const figures: { key: number; svg: () => string }[] = [];
  let pi = 0;
  const free = (c: XY) => Math.hypot(c.x, c.y) <= reach && inFrame(c, 2.2, 1.5) && !footprints.some((rg) => inRing(c, rg)) && !inRing(c, ring) && !traffic.some((v) => underVehicle(c, v, 0.6));
  // a body: a slip of the figure's colour, 0.5 m wide across the view, from z0 up to z1, and its head over it
  const body = (c: XY, z0: number, z1: number, fill: string) => {
    if (look.people === 'figure') return person(c, z0, fill, z0 > 0 ? undefined : { x: 0, y: 0 });
    const a = { x: c.x - r.x * 0.26, y: c.y - r.y * 0.26 }, b = { x: c.x + r.x * 0.26, y: c.y + r.y * 0.26 };
    const [hx, hy] = P(c, z1 + 0.3);
    // (a line model: white in a fine black outline)
    const pen = line ? ` stroke="${LINE.edge}" stroke-width="0.06" stroke-linejoin="round"` : '';
    return `<path d="${poly([P(a, z0), P(b, z0), P(b, z1), P(a, z1)])}" fill="${fill}"${pen}/><circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="0.3" fill="${fill}"${pen}/>`;
  };
  // Illustrated: legs in trousers (apart along the way they walk, `stride`; a rider's to the pedals), a shirt or a coat,
  // a face; standing on the ground (z0 0) or on a saddle.
  // Illustrated, a person on their feet is one of the painted people (render/people.ts), each once in the drawing's
  // defs, facing the way they walk (or either way, standing), a little larger than life; on a bicycle, drawn here.
  const peopleDefs = new Map<number, string>();
  // How large the people are drawn: the painted ones a little over life, so they read at the scale of a town; those
  // in line alone at LINE_FIGURE_SIZE. `sparse`: figures drawn well over life, so fewer of them and further apart.
  const FIGURE_SIZE = look.line ? LINE_FIGURE_SIZE : 1.1, sparse = !!look.line && LINE_FIGURE_SIZE >= 2;
  const WALKERS = Array.from({ length: PEOPLE_VARIANTS }, (_, i) => i).filter((i) => i % 3 !== 0);
  const personPic = (c: XY, stride?: XY) => {
    const k = stride && (stride.x || stride.y) ? WALKERS[Math.floor(rand(c, 21) * WALKERS.length)] : Math.floor(rand(c, 21) * PEOPLE_VARIANTS);
    if (!peopleDefs.has(k)) {
      // (in line alone: the figure in vector, crisp at the size it is drawn)
      if (look.line) peopleDefs.set(k, linePersonSvg(`axo-${id}-p${k}`, k, look.line, LINE_FIGURE_PEN / FIGURE_SIZE));
      else {
        const pic = personPicture(k);
        peopleDefs.set(k, `<image id="axo-${id}-p${k}" href="${pic.uri}" x="${pic.x.toFixed(3)}" y="${pic.y.toFixed(3)}" width="${pic.w.toFixed(3)}" height="${pic.h.toFixed(3)}" preserveAspectRatio="none"/>`);
      }
    }
    const facing = stride && (stride.x || stride.y) ? Math.sign(stride.x * r.x + stride.y * r.y) || 1 : rand(c, 23) < 0.5 ? 1 : -1;
    const [x, y] = P(c, 0), size = FIGURE_SIZE;
    return `<use href="#axo-${id}-p${k}" transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${(facing * size).toFixed(2)},${size})"/>`;
  };
  const person = (c: XY, z0: number, shirt: string, stride?: XY) => {
    if (z0 === 0 && look.people === 'figure') return personPic(c, stride);
    const s0 = rand(c, 5), legs = LEGS[Math.floor(s0 * LEGS.length)], skin = SKIN[Math.floor(rand(c, 6) * SKIN.length)];
    // a little larger than life, as an illustrator draws them, so they read at the scale of a town
    const hip = z0 + (z0 > 0 ? 0.3 : 0.95), top = hip + 0.68, head = top + 0.24;
    const w = 0.27, a = { x: c.x - r.x * w, y: c.y - r.y * w }, b = { x: c.x + r.x * w, y: c.y + r.y * w };
    const [hx, hy] = P(c, hip);
    const foot = (sgn: number) => {
      const f = stride ? { x: c.x + (stride.x * sgn) + r.x * 0.07 * sgn, y: c.y + (stride.y * sgn) + r.y * 0.07 * sgn } : c;
      const [fx, fy] = P(f, z0 > 0 ? z0 - 0.45 : 0);
      return `<line x1="${hx.toFixed(2)}" y1="${hy.toFixed(2)}" x2="${fx.toFixed(2)}" y2="${fy.toFixed(2)}" stroke="${legs}" stroke-width="0.21" stroke-linecap="round"/>`;
    };
    const [kx, ky] = P(c, head);
    return foot(-1) + foot(1) +
      `<path d="${poly([P(a, hip - 0.05), P(b, hip - 0.05), P(b, top), P(a, top)])}" fill="${shirt}" stroke="${shirt === '#ffffff' ? '#9a9a9a' : shirt}" stroke-width="0.05" stroke-linejoin="round"/>` +
      `<circle cx="${kx.toFixed(2)}" cy="${ky.toFixed(2)}" r="0.2" fill="${skin}"/>`;
  };
  const riderDefs = new Map<number, string>();
  const riderPic = (c: XY, u: XY) => {
    const k = Math.floor(rand(c, 25) * RIDER_VARIANTS);
    if (!riderDefs.has(k)) {
      if (look.line) riderDefs.set(k, lineRiderSvg(`axo-${id}-r${k}`, k, look.line, LINE_FIGURE_PEN / FIGURE_SIZE));
      else {
        const pic = riderPicture(k);
        riderDefs.set(k, `<image id="axo-${id}-r${k}" href="${pic.uri}" x="${pic.x.toFixed(3)}" y="${pic.y.toFixed(3)}" width="${pic.w.toFixed(3)}" height="${pic.h.toFixed(3)}" preserveAspectRatio="none"/>`);
      }
    }
    const facing = Math.sign(u.x * r.x + u.y * r.y) || 1, [x, y] = P(c, 0), size = FIGURE_SIZE;
    return `<use href="#axo-${id}-r${k}" transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${(facing * size).toFixed(2)},${size})"/>`;
  };
  const bikeSvg = (c: XY, u: XY, fill: string) => {
    if (look.people === 'figure') return riderPic(c, u);
    const hub = (s: number) => P({ x: c.x + u.x * s, y: c.y + u.y * s }, 0.34);
    const [ax, ay] = hub(-0.55), [bx, by] = hub(0.55);
    return `<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="0.34" fill="none" stroke="${SPOKE}" stroke-width="0.12"/><circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="0.34" fill="none" stroke="${SPOKE}" stroke-width="0.12"/><line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="${SPOKE}" stroke-width="0.12"/>${body(c, 0.8, 1.75, fill)}`;
  };
  for (const { axis, left, right, road } of cw.axes) {
    if (road.hierarchy >= 7) continue;
    for (const side of [1, -1]) {
      const path = (side > 0 ? left : right) + 1.6;   // the footpath, past the kerb
      for (const { p, t } of alongLine(axis, (9 + road.hierarchy * 2) * (sparse ? 1.9 : look.crowd ? 0.6 : 1), 4 + (pi % 5) * 2.3)) {
        const n = { x: -t.y * side, y: t.x * side };
        const c = { x: p.x + n.x * path, y: p.y + n.y * path };
        if (!free(c)) continue;
        const fill = FIGURE_INKS[pi++ % FIGURE_INKS.length];
        const way = rand(c, 9) < 0.5 ? 1 : -1, stride = { x: t.x * 0.2 * way, y: t.y * 0.2 * way };
        figures.push({ key: depth(c), svg: () => (look.people === 'figure' ? person(c, 0, fill, stride) : body(c, 0, 1.45, fill)) });
        // illustrated with a crowd: now and then a second walking beside
        if (look.crowd && rand(c, 13) < 0.35) {
          const beside = sparse ? 1.7 : 0.7, c2 = { x: c.x + n.x * beside + (sparse ? t.x * 1.2 : 0), y: c.y + n.y * beside + (sparse ? t.y * 1.2 : 0) };
          if (free(c2)) { const f2 = FIGURE_INKS[pi++ % FIGURE_INKS.length]; figures.push({ key: depth(c2), svg: () => person(c2, 0, f2, stride) }); }
        }
      }
    }
    if (road.hierarchy <= 2) continue;   // no bicycle on a highway
    for (const dir of [1, -1]) {
      for (const { p, t } of alongLine(axis, (30 + road.hierarchy * 4) * (sparse ? 2 : 1), dir > 0 ? 11 + (pi % 3) * 7 : 25 + (pi % 4) * 5)) {
        const n = { x: -t.y * dir, y: t.x * dir };   // the left of the direction of travel: the kerb side
        const kerb = dir > 0 ? left : right;
        const c = { x: p.x + n.x * (kerb - 1.1), y: p.y + n.y * (kerb - 1.1) };
        if (!free(c)) continue;
        const u = { x: t.x * dir, y: t.y * dir };
        const fill = FIGURE_INKS[pi++ % FIGURE_INKS.length];
        figures.push({ key: depth(c), svg: () => bikeSvg(c, u, fill) });
      }
    }
  }
  // A crowd: people in the parks, in ones, twos and threes, about one group to every 300 m² of park.
  if (look.crowd) for (const lot of scene.lots) {
    if (!lot.park) continue;
    for (const rg of lot.rings) {
      if (rg.length < 3) continue;
      let area = 0;
      for (let i = 0; i < rg.length; i++) { const u = rg[i], v = rg[(i + 1) % rg.length]; area += u.x * v.y - v.x * u.y; }
      const xs = rg.map((p) => p.x), ys = rg.map((p) => p.y), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
      const groups = Math.min(40, Math.round(Math.abs(area) / 2 / (sparse ? 1200 : 300)));
      for (let g = 0, tries = 0; g < groups && tries < groups * 6; tries++) {
        const c = { x: x0 + rand({ x: x0, y: y0 }, 100 + tries) * w, y: y0 + rand({ x: y0, y: x0 }, 300 + tries) * h };
        if (!inRing(c, rg) || !free(c)) continue;
        g++;
        const many = 1 + Math.floor(rand(c, 4) * 3), a = rand(c, 8) * Math.PI * 2;
        for (let m = 0; m < many; m++) {
          const apart = sparse ? 1.9 : 0.6, q = { x: c.x + Math.cos(a + m * 2.1) * apart * m, y: c.y + Math.sin(a + m * 2.1) * apart * m };
          if (!free(q)) continue;
          const fill = FIGURE_INKS[pi++ % FIGURE_INKS.length];
          const walking = rand(q, 15) < 0.4, stride = walking ? { x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2 } : undefined;
          figures.push({ key: depth(q), svg: () => person(q, 0, fill, stride) });
        }
      }
    }
  }
  // Illustrated: the trees and the people cast their shadows on the ground, under all that stands, as the buildings do.
  // Painted as one picture (render/crowns.ts): as vectors, a few thousand ovals came to megabytes a drawing.
  // A line model: each tree's shadow an oval on the ground away from the light, in a closer hatch laid the other way
  // over whatever surface it falls on, as a drawn axonometric shades under its trees.
  const shadeOvals: { x: number; y: number; rx: number; ry: number }[] = [];
  if (line && trees.length) {
    const sh = { x: -light.x * 0.42, y: -light.y * 0.42 }, sinE0 = Math.sin(elev);
    for (const tr of trees) {
      const zc = crownCentre(tr), [x, y] = P({ x: tr.p.x + sh.x * zc, y: tr.p.y + sh.y * zc }, 0), rx = tr.r * (columnar(tr) ? 0.7 : 0.95);
      shadeOvals.push({ x, y, rx, ry: rx * sinE0 });
    }
    parts.push(HOLE.shade);
  }
  if (look.shadows && M.gloss) {
    const sh = { x: -light.x * 0.42, y: -light.y * 0.42 }, sinE0 = Math.sin(elev);
    const pic = shadowPicture(trees.map((tr) => {
      const zc = crownCentre(tr), [x, y] = P({ x: tr.p.x + sh.x * zc, y: tr.p.y + sh.y * zc }, 0), rr = tr.r * (columnar(tr) ? 0.7 : 0.95);
      return { x, y, rx: rr, ry: rr * sinE0 };
    }), INK.blue.deep, 0.12);
    if (pic) parts.push(`<image data-shadows href="${pic.uri}" x="${pic.x.toFixed(2)}" y="${pic.y.toFixed(2)}" width="${pic.w.toFixed(2)}" height="${pic.h.toFixed(2)}" preserveAspectRatio="none"/>`);
  }
  // Everything that stands, farthest first: the neighbours and the built, the trees, the traffic and the people among them.
  const standing: { key: number; svg: () => string }[] = [
    // (a line model: what is built on the site in a heavier outline, drawn with it so what stands in front still covers it)
    ...prisms.map(({ key, group }) => ({ key, svg: () => group.map(prismSvg).join('') + (line && group === built && !scene.silhouette ? silhouette(built) : '') })),
    ...trees.map((tr) => ({ key: depth(tr.p), svg: () => treeSvg(tr) })),
    ...traffic.map((v) => ({ key: depth(v.c), svg: () => (v.solids ? vehicleSolidsSvg(v, v.solids) : vehicleSvg(v, v.stacks)) })),
    ...figures,
  ].sort((a, b2) => b2.key - a.key);
  for (const item of standing) parts.push(item.svg());
  if (scene.silhouette) parts.push(silhouette(built));

  // The envelopes, dashed at their tops; the height plane over the site.
  const over: string[] = [];
  for (const e of scene.envelopes ?? []) for (const rg of e.rings) over.push(`<path d="${poly(rg.map((p) => P(p, e.z)))}" fill="none" stroke="${inks.envelope}" stroke-width="0.22" stroke-dasharray="1.6,1"/>`);
  if (scene.hob?.metres) {
    const hz = scene.hob.metres;
    // (a line model's massing: the plane a fine black dashed outline, nothing in it)
    over.push(`<path d="${poly(ring.map((p) => P(p, hz)))}" fill="${plain ? 'none' : SITE}" fill-opacity="0.05" stroke="${SITE}" stroke-width="${plain ? 0.22 : 0.3}" stroke-dasharray="2.4,1.2"/>`);
    for (const p of ring) { const [x1, y1] = P(p, 0), [x2, y2] = P(p, hz); over.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${SITE}" stroke-width="0.12" stroke-dasharray="1,1"/>`); }
  }

  // Fit it all to the box. A height plane far above everything built (an airspace RL in a CBD) is not fitted: it
  // runs out of the frame, and the frame says where it is. Nor is a neighbour's future far above what stands: it
  // is cut at the same height, so a CBD's towers-to-be do not shrink the built to a speck.
  const pts: [number, number][] = [];
  let tallest = 0;
  const isFuture = (pr: Prism) => pr.opacity === FUTURE_OPACITY;
  for (const { group } of prisms) for (const pr of group) if (!isFuture(pr)) tallest = Math.max(tallest, pr.z1);
  const cap = Math.max(tallest, 12) * 1.6;
  let futureTop = 0;
  for (const { group } of prisms) for (const pr of group) {
    const z1 = isFuture(pr) ? Math.min(pr.z1, cap) : pr.z1;
    if (isFuture(pr)) futureTop = Math.max(futureTop, pr.z1);
    for (const rg of pr.rings) for (const p of rg) pts.push(P(p, pr.z0), P(p, z1));
  }
  const planeZ = scene.hob?.metres ?? 0;
  let planeFits = planeZ <= cap;
  for (const p of ring) pts.push(P(p, 0), P(p, planeFits ? planeZ : Math.max(tallest, 12) * 1.25));
  if (scene.focusM != null) {
    // Fitted to the site and the town just round it, at the height of what stands or is built on the site (or the
    // plane over it, where it is near that height; a tower across town does not bring it in): the rest of the town
    // runs out past the frame, cut at its edges.
    pts.length = 0;
    const siteTop = Math.max(12, ...built.map((pr) => pr.z1));
    planeFits = planeZ <= siteTop * 1.6;
    const zF = planeFits ? planeZ : siteTop * 1.25;
    const xs0 = ring.map((p) => p.x), ys0 = ring.map((p) => p.y), m = scene.focusM;
    const sq = [{ x: Math.min(...xs0) - m, y: Math.min(...ys0) - m }, { x: Math.max(...xs0) + m, y: Math.min(...ys0) - m }, { x: Math.max(...xs0) + m, y: Math.max(...ys0) + m }, { x: Math.min(...xs0) - m, y: Math.max(...ys0) + m }];
    for (const p of sq) pts.push(P(p, 0));
    for (const p of ring) pts.push(P(p, 0), P(p, zF));
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // (a filled frame's fit was settled before anything was drawn)
  const k = framed ? framed.k : Math.min(box.w / (x1 - x0 || 1), box.h / (y1 - y0 || 1));
  const tx = framed ? framed.tx : slideClear(k, box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k);
  const ty = framed ? framed.ty : box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  const note = (line: number, ink: string, text: string) =>
    `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + 4 + line * 4).toFixed(1)}" text-anchor="middle" font-size="2.8" fill="${ink}" stroke="#ffffff" stroke-width="1.4" paint-order="stroke">${esc(text)}</text>`;
  const notes: string[] = [];
  if (scene.hob?.metres && !planeFits) notes.push(note(notes.length, SITE, scene.hob.note));
  if (futureTop > cap) notes.push(note(notes.length, inks.futureEdge, `NEIGHBOURS' FUTURE HEIGHTS RUN ABOVE THE FRAME, TO ${nf(futureTop)}m`));
  // A line model's ground hatches, now that the scale and the frame are known: over the frame alone, each clipped to
  // its surface; the trees' shade to the ovals that reach into the frame.
  let groundSvg = ground.join(''), partsSvg = parts.join('');
  const f: Frame = { x0: (box.x - tx) / k, y0: (box.y - ty) / k, x1: (box.x + box.w - tx) / k, y1: (box.y + box.h - ty) / k };
  if (line) {
    const roadD = cw.polygons.map((rings) => rings.map((rg) => poly(rg.map((p) => P(p, 0)))).join('')).join('');
    const ovals = shadeOvals.filter((o) => o.x + o.rx >= f.x0 && o.x - o.rx <= f.x1 && o.y + o.ry >= f.y0 && o.y - o.ry <= f.y1)
      .map((o) => `M${(o.x - o.rx).toFixed(2)},${o.y.toFixed(2)}a${o.rx.toFixed(2)},${o.ry.toFixed(2)} 0 1,0 ${(2 * o.rx).toFixed(2)},0a${o.rx.toFixed(2)},${o.ry.toFixed(2)} 0 1,0 ${(-2 * o.rx).toFixed(2)},0Z`).join('');
    groundSvg = groundSvg.replace(HOLE.lots, groundHatch('lawn', lawnD.join(''), 'evenodd', f, k, id) + groundHatch('yard', yardD.join(''), 'nonzero', f, k, id))
      .replace(HOLE.road, groundHatch('road', roadD, 'evenodd', f, k, id));
    partsSvg = partsSvg.replace(HOLE.shade, groundHatch('shade', ovals, 'nonzero', f, k, id));
  }
  // The walls' hatches (a line model's toned prisms, Canary's shaded walls): lines rising to the right at 45°, on
  // one grid across the drawing so neighbouring faces' lines meet, each face's over its own box alone and clipped to
  // it; none for a face outside the frame. Lines, not a pattern fill, which the print would rasterise.
  partsSvg = partsSvg.replace(/<!--axo:fh(\d+)-->/g, (_, n: string) => {
    const j = faceHatches[Number(n)];
    const xs = j.pts.map((q) => q[0]), ys = j.pts.map((q) => q[1]);
    const x0 = Math.max(f.x0, Math.min(...xs)), x1 = Math.min(f.x1, Math.max(...xs)), y0 = Math.max(f.y0, Math.min(...ys)), y1 = Math.min(f.y1, Math.max(...ys));
    if (!(x1 > x0 && y1 > y0)) return '';
    const step = (j.pitch / k) * Math.SQRT2, d: string[] = [];
    for (let c = Math.ceil((x0 + y0) / step) * step; c <= x1 + y1; c += step) d.push(`M${(c - y1).toFixed(2)},${y1.toFixed(2)}L${(c - y0).toFixed(2)},${y0.toFixed(2)}`);
    return d.length ? `<clipPath id="axo-fh${n}-${id}"><path d="${j.d}" clip-rule="evenodd"/></clipPath><g data-face-hatch clip-path="url(#axo-fh${n}-${id})"><path d="${d.join('')}" fill="none" stroke="${j.ink ?? LINE.edge}" stroke-width="${(j.w / k).toFixed(4)}"/></g>` : '';
  });
  // The strokes scale with the scene, but for a line model's buildings, whose widths are set on paper (LINE_MM).
  const drawn = `<defs>${stampDefs.join('')}${[...peopleDefs.values()].join('')}${[...riderDefs.values()].join('')}<clipPath id="axo-${id}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>
    <g clip-path="url(#axo-${id})"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})">
    <g style="vector-effect:non-scaling-stroke">${groundSvg}${partsSvg}${over.join('')}</g></g></g>${notes.join('')}`;
  return line ? resolvePaper(drawn, k) : drawn;
}

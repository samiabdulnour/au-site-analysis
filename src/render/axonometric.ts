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
import { alongLine, carriageways, type RoadLine } from '../lib/carriageway.js';
import { INK, massingInks } from './atlasKit.js';
import { tint, vivid } from './template.js';
import { esc } from './chrome.js';

export interface Prism {
  rings: XY[][];
  z0: number;
  z1: number;
  fill: string;
  edge: string;
  edgeW: number;
  storeys?: number[];
  dashed?: boolean;
  dash?: string;
  opacity?: number;
  /** A grid of windows over the faces, as the poster maps draw a city. */
  windows?: boolean;
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
  /** Keep the trees that stand on the site (what stands today); a scheme clears them. */
  treesOnSite?: boolean;
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

export function drawAxonometric(scene: AxoScene, box: { x: number; y: number; w: number; h: number }, id: string): string {
  const M = massingInks();
  const { ring, reach, inks } = scene;
  const turn = (40 * Math.PI) / 180;
  const nx = scene.frontNormal.x, ny = scene.frontNormal.y;
  const cam = { x: nx * Math.cos(turn) - ny * Math.sin(turn), y: nx * Math.sin(turn) + ny * Math.cos(turn) };
  const d = { x: -cam.x, y: -cam.y };                 // the view direction, horizontal
  const r = { x: d.y, y: -d.x };                       // the screen's right
  const elev = (35 * Math.PI) / 180, sinE = Math.sin(elev), cosE = Math.cos(elev);
  const P = (p: XY, z: number): [number, number] => [p.x * r.x + p.y * r.y, -((p.x * d.x + p.y * d.y) * sinE + z * cosE)];
  const depth = (p: XY) => p.x * d.x + p.y * d.y;

  // What is drawn: the neighbours within reach, each with its future over it, and the built on the site.
  const prisms: { key: number; group: Prism[] }[] = [];
  for (const nb of scene.neighbours) {
    const rings = nb.rings.filter((rg) => rg.length >= 3);
    if (!rings.length) continue;
    const cen = rings[0].reduce((t, p) => ({ x: t.x + p.x / rings[0].length, y: t.y + p.y / rings[0].length }), { x: 0, y: 0 });
    if (Math.hypot(cen.x, cen.y) > reach) continue;
    const known = nb.heightM != null && nb.heightM > 0;
    const z1 = known ? nb.heightM! : 6.2;
    const group: Prism[] = [{ rings, z0: 0, z1, fill: nb.fill, edge: shade(nb.fill, M.gloss ? 0.78 : 0.55), edgeW: 0.12, dashed: !known, windows: known }];
    if (nb.future && nb.future > z1) group.push({ rings, z0: z1, z1: nb.future, fill: inks.future, edge: inks.futureEdge, edgeW: 0.12, dashed: true, dash: FUTURE_DASH, opacity: FUTURE_OPACITY });
    prisms.push({ key: depth(cen), group });
  }
  const built = scene.built;
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
  for (const lot of scene.lots) for (const pts of lot.rings) {
    if (pts.length < 3 || pts.some((p) => Math.hypot(p.x, p.y) > reach + 20)) continue;
    ground.push(`<path d="${poly(pts.map((p) => P(p, 0)))}" fill="${lot.park ? M.park : 'none'}" stroke="${M.lot}" stroke-width="0.12"/>`);
  }
  const cw = carriageways(scene.roads, scene.kerbs);
  if (cw.polygons.length) {
    ground.push(`<path d="${cw.polygons.map((rings) => rings.map((rg) => poly(rg.map((p) => P(p, 0)))).join('')).join('')}" fill="${M.road}" fill-rule="evenodd" stroke="${inks.kerb}" stroke-width="0.2" stroke-linejoin="round"/>`);
    ground.push(`<path d="${cw.axes.map(({ axis }) => open(axis.map((p) => P(p, 0)))).join('')}" fill="none" stroke="${M.axis}" stroke-width="0.12" stroke-dasharray="1.4,1.1" opacity="0.85"/>`);
  }
  const SITE = inks.site;
  ground.push(`<path d="${poly(ring.map((p) => P(p, 0)))}" fill="${SITE}" fill-opacity="0.08" stroke="${SITE}" stroke-width="0.35"/>`);
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
    ground.push(`<g opacity="0.1" fill="${INK.blue.deep}"><path d="${pieces.join('')}" fill-rule="nonzero"/></g>`);
  }

  const prismSvg = (pr: Prism) => {
    const out: string[] = [];
    const dash = pr.dashed ? ` stroke-dasharray="${pr.dash ?? '0.8,0.6'}"` : '';
    const alpha = pr.opacity != null ? ` fill-opacity="${pr.opacity}"` : '';
    for (const rg of pr.rings) {
      let sa = 0;
      for (let i = 0; i < rg.length; i++) { const u = rg[i], v = rg[(i + 1) % rg.length]; sa += u.x * v.y - v.x * u.y; }
      const faces = rg.map((p, i) => {
        const q = rg[(i + 1) % rg.length], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        const m = sa > 0 ? { x: dy / l, y: -dx / l } : { x: -dy / l, y: dx / l };
        return { p, q, m, mid: depth({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) };
      }).filter((f) => f.m.x * d.x + f.m.y * d.y < 0).sort((f, g) => g.mid - f.mid);
      for (const f of faces) {
        // glossy: the faces barely shaded, the shadows cast on the ground instead
        const lit = (M.gloss ? 0.9 : 0.72) + (M.gloss ? 0.1 : 0.28) * Math.max(0, f.m.x * light.x + f.m.y * light.y);
        const face = poly([P(f.p, pr.z0), P(f.q, pr.z0), P(f.q, pr.z1), P(f.p, pr.z1)]);
        out.push(`<path d="${face}" fill="${shade(pr.fill, lit)}"${alpha} stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${dash}/>`);
        if (pr.windows) out.push(`<path d="${face}" fill="url(#axo-win-${id})"/>`);
        for (const zz of pr.storeys ?? []) {
          const [x1, y1] = P(f.p, zz), [x2, y2] = P(f.q, zz);
          out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${shade(pr.fill, 0.62)}" stroke-width="0.08"/>`);
        }
      }
    }
    out.push(`<path d="${pr.rings.map((rg) => poly(rg.map((p) => P(p, pr.z1)))).join('')}" fill="${shade(pr.fill, M.gloss ? 1.3 : 1.12)}"${alpha} fill-rule="evenodd" stroke="${pr.edge}" stroke-width="${pr.edgeW}" stroke-linejoin="round"${dash}/>`);
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
      return `<path d="${rings.map((rg) => poly(rg.slice(0, -1) as [number, number][])).join('')}" fill="none" stroke="#2e2e2e" stroke-width="0.24" stroke-linejoin="round"/>`;
    } catch { return ''; }
  };
  // The trees: each a crown on a trunk, which the projection draws as a circle, a sphere's outline; none where a
  // footprint stands, and none on the site unless the caller keeps them.
  const footprints: XY[][] = [...scene.neighbours.flatMap((nb) => nb.rings), ...built.flatMap((pr) => pr.rings)];
  const trees = scene.trees.filter((tr) => Math.hypot(tr.p.x, tr.p.y) <= reach + 10 && !footprints.some((rg) => inRing(tr.p, rg)) && (scene.treesOnSite || !inRing(tr.p, ring)));
  const treeSvg = (tr: { p: XY; r: number }) => {
    const zc = 2.2 + tr.r;   // the crown's centre: a trunk of about two metres, then the crown
    const [cx, cy] = P(tr.p, zc), [bx, by] = P(tr.p, 0);
    return `<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${M.trunk}" stroke-width="0.25"/>` +
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${tr.r.toFixed(2)}" fill="${M.tree}"/>` +
      `<circle cx="${(cx - 0.22 * tr.r).toFixed(2)}" cy="${(cy - 0.2 * tr.r).toFixed(2)}" r="${(0.66 * tr.r).toFixed(2)}" fill="${M.treeLight}"/>`;
  };
  // Traffic: a car every so often down each street, on the left of its axis as the road rules have it, each a body with
  // a cabin, in the families' solid colours in turn; none down a lane.
  const CAR_INKS = [vivid(INK.red.solid, 0.55, 0.45), vivid(INK.blue.solid, 0.5, 0.42), vivid(INK.orange.solid, 0.7, 0.5), '#f4f4f0'];
  const GLASS = tint(INK.blue.solid, 0.78);
  const cars: { key: number; body: Prism; cabin: Prism }[] = [];
  let ci = 0;
  for (const { axis, left, right, road } of cw.axes) {
    if (road.hierarchy >= 7) continue;
    const lane = Math.min(2.6, (left + right) / 4);
    for (const dir of [1, -1]) {
      const step = 24 + road.hierarchy * 3;
      for (const { p, t } of alongLine(axis, step, dir > 0 ? 6 + (ci % 4) * 5 : 17 + (ci % 3) * 6)) {
        const n = { x: -t.y * dir, y: t.x * dir };   // the left of the direction of travel
        const c = { x: p.x + n.x * lane, y: p.y + n.y * lane };
        if (Math.hypot(c.x, c.y) > reach || footprints.some((rg) => inRing(c, rg))) continue;
        const u = { x: t.x * dir, y: t.y * dir };
        const bx = (hl: number, hw: number, back: number): XY[] => [
          { x: c.x + u.x * (hl - back) + n.x * hw, y: c.y + u.y * (hl - back) + n.y * hw }, { x: c.x + u.x * (hl - back) - n.x * hw, y: c.y + u.y * (hl - back) - n.y * hw },
          { x: c.x - u.x * (hl + back) - n.x * hw, y: c.y - u.y * (hl + back) - n.y * hw }, { x: c.x - u.x * (hl + back) + n.x * hw, y: c.y - u.y * (hl + back) + n.y * hw },
        ];
        const fill = CAR_INKS[ci++ % CAR_INKS.length];
        cars.push({ key: depth(c),
          body: { rings: [bx(2.2, 0.9, 0)], z0: 0.25, z1: 1.3, fill, edge: '#3a3a3a', edgeW: 0.1 },
          cabin: { rings: [bx(1.1, 0.8, 0.25)], z0: 1.3, z1: 1.95, fill: GLASS, edge: '#3a3a3a', edgeW: 0.1 } });
      }
    }
  }
  // People on the footpaths and bicycles at the kerb: a walker every so often along each street's footpath, a body
  // standing on the ground with a head over it; a rider every so often down the kerb side of the lane, two wheels
  // and a frame with the body over them; in the traffic's colours and a dark grey in turn. None down a lane, no
  // bicycle on a highway, none where a building stands, and none on the site.
  const FIGURE_INKS = [...CAR_INKS.slice(0, 3), '#3a3a3a'];
  const figures: { key: number; svg: () => string }[] = [];
  let pi = 0;
  const free = (c: XY) => Math.hypot(c.x, c.y) <= reach && !footprints.some((rg) => inRing(c, rg)) && !inRing(c, ring);
  // a body: a slip of the figure's colour, 0.5 m wide across the view, from z0 up to z1, and its head over it
  const body = (c: XY, z0: number, z1: number, fill: string) => {
    const a = { x: c.x - r.x * 0.26, y: c.y - r.y * 0.26 }, b = { x: c.x + r.x * 0.26, y: c.y + r.y * 0.26 };
    const [hx, hy] = P(c, z1 + 0.3);
    return `<path d="${poly([P(a, z0), P(b, z0), P(b, z1), P(a, z1)])}" fill="${fill}"/><circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="0.3" fill="${fill}"/>`;
  };
  const bikeSvg = (c: XY, u: XY, fill: string) => {
    const hub = (s: number) => P({ x: c.x + u.x * s, y: c.y + u.y * s }, 0.34);
    const [ax, ay] = hub(-0.55), [bx, by] = hub(0.55);
    return `<circle cx="${ax.toFixed(2)}" cy="${ay.toFixed(2)}" r="0.34" fill="none" stroke="#3a3a3a" stroke-width="0.12"/><circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="0.34" fill="none" stroke="#3a3a3a" stroke-width="0.12"/><line x1="${ax.toFixed(2)}" y1="${ay.toFixed(2)}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="#3a3a3a" stroke-width="0.12"/>${body(c, 0.8, 1.75, fill)}`;
  };
  for (const { axis, left, right, road } of cw.axes) {
    if (road.hierarchy >= 7) continue;
    for (const side of [1, -1]) {
      const path = (side > 0 ? left : right) + 1.6;   // the footpath, past the kerb
      for (const { p, t } of alongLine(axis, 9 + road.hierarchy * 2, 4 + (pi % 5) * 2.3)) {
        const n = { x: -t.y * side, y: t.x * side };
        const c = { x: p.x + n.x * path, y: p.y + n.y * path };
        if (!free(c)) continue;
        const fill = FIGURE_INKS[pi++ % FIGURE_INKS.length];
        figures.push({ key: depth(c), svg: () => body(c, 0, 1.45, fill) });
      }
    }
    if (road.hierarchy <= 2) continue;   // no bicycle on a highway
    for (const dir of [1, -1]) {
      for (const { p, t } of alongLine(axis, 30 + road.hierarchy * 4, dir > 0 ? 11 + (pi % 3) * 7 : 25 + (pi % 4) * 5)) {
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
  // Everything that stands, farthest first: the neighbours and the built, the trees, the traffic and the people among them.
  const standing: { key: number; svg: () => string }[] = [
    ...prisms.map(({ key, group }) => ({ key, svg: () => group.map(prismSvg).join('') })),
    ...trees.map((tr) => ({ key: depth(tr.p), svg: () => treeSvg(tr) })),
    ...cars.map((car) => ({ key: car.key, svg: () => prismSvg(car.body) + prismSvg(car.cabin) })),
    ...figures,
  ].sort((a, b2) => b2.key - a.key);
  for (const item of standing) parts.push(item.svg());
  if (scene.silhouette) parts.push(silhouette(built));

  // The envelopes, dashed at their tops; the height plane over the site.
  const over: string[] = [];
  for (const e of scene.envelopes ?? []) for (const rg of e.rings) over.push(`<path d="${poly(rg.map((p) => P(p, e.z)))}" fill="none" stroke="${inks.envelope}" stroke-width="0.22" stroke-dasharray="1.6,1"/>`);
  if (scene.hob?.metres) {
    const hz = scene.hob.metres;
    over.push(`<path d="${poly(ring.map((p) => P(p, hz)))}" fill="${SITE}" fill-opacity="0.05" stroke="${SITE}" stroke-width="0.3" stroke-dasharray="2.4,1.2"/>`);
    for (const p of ring) { const [x1, y1] = P(p, 0), [x2, y2] = P(p, hz); over.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${SITE}" stroke-width="0.12" stroke-dasharray="1,1"/>`); }
  }

  // Fit it all to the box. A height plane far above everything built (an airspace RL in a CBD) is not fitted: it
  // runs out of the frame, and the frame says where it is. Nor is a neighbour's future far above what stands: it
  // is cut at the same height, so a CBD's towers-to-be do not shrink the built to a speck.
  const pts: [number, number][] = [];
  let tallest = 0;
  for (const { group } of prisms) for (const pr of group) if (pr.fill !== inks.future) tallest = Math.max(tallest, pr.z1);
  const cap = Math.max(tallest, 12) * 1.6;
  let futureTop = 0;
  for (const { group } of prisms) for (const pr of group) {
    const z1 = pr.fill === inks.future ? Math.min(pr.z1, cap) : pr.z1;
    if (pr.fill === inks.future) futureTop = Math.max(futureTop, pr.z1);
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
  const k = Math.min(box.w / (x1 - x0 || 1), box.h / (y1 - y0 || 1));
  const tx = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k, ty = box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  const note = (line: number, ink: string, text: string) =>
    `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + 4 + line * 4).toFixed(1)}" text-anchor="middle" font-size="2.8" fill="${ink}" stroke="#ffffff" stroke-width="1.4" paint-order="stroke">${esc(text)}</text>`;
  const notes: string[] = [];
  if (scene.hob?.metres && !planeFits) notes.push(note(notes.length, SITE, scene.hob.note));
  if (futureTop > cap) notes.push(note(notes.length, inks.futureEdge, `NEIGHBOURS' FUTURE HEIGHTS RUN ABOVE THE FRAME, TO ${nf(futureTop)}m`));
  // Strokes are set in sheet millimetres and do not scale with the scene.
  return `<defs><clipPath id="axo-${id}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath><pattern id="axo-win-${id}" patternUnits="userSpaceOnUse" width="2.6" height="3.1"><rect x="0.75" y="0.8" width="1.1" height="1.5" fill="#000000" fill-opacity="${M.gloss ? 0.09 : 0.17}"/></pattern></defs>
    <g clip-path="url(#axo-${id})"><g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})">
    <g style="vector-effect:non-scaling-stroke">${ground.join('')}${parts.join('')}${over.join('')}</g></g></g>${notes.join('')}`;
}

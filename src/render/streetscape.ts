// The streetscape sheet: the site's street as two elevations on one A3
// landscape page, the site's face above and the face across the road below,
// each drawn as a viewer standing in the street sees it (so the two run
// opposite ways). A face is its orthographic elevation from Google's 3D tiles
// (src/render/elevation3d.ts) on a band of sky over a band of ground; without
// the tiles, its Street View frames, each rectified onto the face's boundary
// plane in the browser by a CSS matrix3d that is the frame's homography
// (src/fetch/streetscape.ts) and clipped to its strip and to the footpath
// below the ground line. Either way the frontages are dashed off under the
// ground and named by their addresses, the roads that come in are named
// upright in their gaps, and the site is marked in the deck's red.

import type { StreetscapeBundle } from '../pipeline.js';
import { planeToImage, frameTop, mul3, inv3, BELOW_GROUND_M, FRAME_PX, type Face, type ScapeFrame } from '../fetch/streetscape.js';
import { deckCss, SLIDE_W, SLIDE_H } from './slides.js';
import { tpl, withTemplate, DECK_TEMPLATE } from './template.js';
import { shortStreetName, type SheetMeta } from './sheet.js';
import { esc } from './chrome.js';
import { SCAPE_SKY, type Elevation } from './elevation3d.js';
import { METRES_PER_STOREY } from '../fetch/buildings.js';

const MARGIN = 15;
const BAND_TOP = 44;
/** How far above the face's highest ground its band runs at most, metres: nine storeys at the boundary and the sky over them. */
const SKY_M = 30;
/** Never lower than this over the highest ground, whatever the frames reach: four storeys. */
const MIN_SKY_M = 13;
/** An elevation's band runs to its tallest building (the 98th percentile of its metres' tops), at most this over the ground. */
const SKY_3D_M = 60;
/** The band of ground under an elevation, metres. */
const GROUND_BAND_M = 2.4;
const GROUND_FILL = '#5f6466';
const LABEL_ROWS = 3;
const ROW_MM = 4.6;
/** From the foot of a band to its labels' first row, the rows, and the caption under them with its scale bar. */
const LABEL_GAP = 2.2;
const LABELS_H = LABEL_ROWS * ROW_MM + 2;
const CAPTION_H = 7.6;
const FACE_GAP = 7;
const FOOT_TOP = SLIDE_H - 22;
const PX_PER_MM = 96 / 25.4;
const SEAM_MM = 0.05;
const SCALES = [200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500];
/** The label type's size and a generous width per character, mm. */
const LABEL_MM = 1.75, CHAR_MM = 1.12;

const f2 = (v: number) => v.toFixed(2);
const bearingWord = (deg: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const monthName = (ym?: string) => { const m = ym?.match(/^(\d{4})-(\d{2})/); return m ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}` : ''; };

interface Layout { scale: number; k: number; x0: number; bands: { top: number; zTop: number; zBot: number; h: number }[] }

/** The largest round scale at which the window fits the sheet's width and both bands its height. */
export function layoutFaces(b: StreetscapeBundle): Layout {
  const p = b.plan, len = p.s1 - p.s0, width = SLIDE_W - 2 * MARGIN;
  const wanted = p.faces.map((f, i) => {
    const e = b.elevations?.[i];
    if (e) {
      // as high as the face's buildings stand, and a little sky over them
      const zs = e.ground.map((g) => g.z), lo = Math.min(...zs), hi = Math.max(...zs);
      const tops = e.tops.map((x) => x.z).sort((x, y) => x - y);
      const reach = (tops[Math.floor(tops.length * 0.98)] ?? hi + SKY_M) + 2;
      return { zTop: Math.max(hi + MIN_SKY_M, Math.min(hi + SKY_3D_M, reach)), zMin: hi + MIN_SKY_M, zBot: lo - GROUND_BAND_M };
    }
    const zs = f.ground.map((g) => g.z);
    const lo = zs.length ? Math.min(...zs) : 0, hi = zs.length ? Math.max(...zs) : 0;
    // the frames are cut along one line, as high as three in four of the highest of them reach, so the face's top is straight
    const own = b.frames.filter((fr) => fr.side === f.side), top = Math.max(0, ...own.map((fr) => fr.tier ?? 0));
    const tops = own.filter((fr) => (fr.tier ?? 0) === top).map((fr) => frameTop(p, fr)).filter(Number.isFinite).sort((x, y) => x - y);
    const reach = tops.length ? tops[Math.floor(tops.length / 4)] : hi + SKY_M;
    return { zTop: Math.max(hi + MIN_SKY_M, Math.min(hi + SKY_M, reach)), zMin: hi + MIN_SKY_M, zBot: lo - BELOW_GROUND_M - 0.6 };
  });
  const room = FOOT_TOP - BAND_TOP - p.faces.length * (LABEL_GAP + LABELS_H + CAPTION_H) - (p.faces.length - 1) * FACE_GAP;
  // the scale the street's length allows, at which the faces fit at their lowest; then as much of their height as fits
  const scale = SCALES.find((s) => (len * 1000) / s <= width && wanted.reduce((t, r) => t + ((r.zMin - r.zBot) * 1000) / s, 0) <= room) ?? SCALES[SCALES.length - 1];
  const k = 1000 / scale;
  const ranges = wanted.map((r) => ({ zTop: Math.max(r.zMin, Math.min(r.zTop, r.zBot + room / wanted.length / k)), zBot: r.zBot }));
  const x0 = MARGIN + (width - len * k) / 2;
  // what the faces leave of the page's height goes a third above them and a third between them
  const spare = Math.max(0, room - ranges.reduce((t, r) => t + (r.zTop - r.zBot) * k, 0)) / 3;
  let top = BAND_TOP + spare;
  const bands = ranges.map((r) => {
    const h = (r.zTop - r.zBot) * k;
    const band = { top, zTop: r.zTop, zBot: r.zBot, h };
    top += h + LABEL_GAP + LABELS_H + CAPTION_H + FACE_GAP + spare;
    return band;
  });
  return { scale, k, x0, bands };
}

/** Rows of labels, each placed in the first row it fits without touching the one before. */
class Rows {
  private spans: [number, number][][] = Array.from({ length: LABEL_ROWS }, () => []);
  take(row: number, x0: number, x1: number) { this.spans[row].push([x0, x1]); }
  place(x0: number, x1: number, from = 0): number {
    for (let r = from; r < LABEL_ROWS; r++) if (!this.spans[r].some(([a, b]) => x0 < b + 0.8 && x1 > a - 0.8)) { this.spans[r].push([x0, x1]); return r; }
    return -1;
  }
}

function faceSvg(b: StreetscapeBundle, face: Face, L: Layout, i: number, overlay = false): { html: string; svg: string } {
  const t = tpl();
  const p = b.plan, band = L.bands[i], k = L.k;
  const X = (s: number) => (face.sRightward ? L.x0 + (s - p.s0) * k : L.x0 + (p.s1 - s) * k);
  const Y = (z: number) => band.top + (band.zTop - z) * k;
  const elev = b.elevations?.[i] ?? null;
  // the ground: the elevation's own, found in its meshes (ellipsoidal heights, as its picture is), else the elevation model's
  const groundLine = elev ? elev.ground : face.ground;
  const groundAt = (s: number) => {
    const g = groundLine;
    if (!g.length) return band.zBot + 0.6 + BELOW_GROUND_M;
    let j = 0;
    for (let q = 1; q < g.length; q++) if (Math.abs(g[q].s - s) < Math.abs(g[j].s - s)) j = q;
    return g[j].z;
  };
  // the frames: rectified slices without an elevation; with one, laid on it already, and only credited here
  const own = b.frames.filter((fr) => fr.side === face.side);
  const frames = elev ? [] : own;
  const views = own.filter((fr) => fr.tier === 0);

  // the frames, each its homography from the picture to the sheet, clipped to its strip and the footpath
  // the upper frames first, so the lower ones, which hold the street, lie over them where the two overlap
  const slices = elev ? elevationHtml(elev, X, Y, band, k) : [...frames].sort((x, y) => y.tier - x.tier).map((fr) => sliceHtml(b, face, fr, X, band.top, band.zTop, groundAt, k)).join('');

  const svg: string[] = [];
  // the ground at the boundary; under an elevation, a band of ground below it
  const ground = groundLine.map((g) => `${f2(X(g.s))},${f2(Y(g.z))}`).join(' ');
  if (elev && ground) {
    const xs = groundLine.map((g) => X(g.s));
    svg.push(`<polygon points="${ground} ${f2(xs[xs.length - 1])},${f2(band.top + band.h)} ${f2(xs[0])},${f2(band.top + band.h)}" fill="${GROUND_FILL}"/>`);
  }
  if (ground) svg.push(`<polyline points="${ground}" fill="none" stroke="${t.ink}" stroke-width="0.3" stroke-linejoin="round"/>`);
  if (overlay && elev?.roofs?.length) svg.push(buildingLines(elev, elev.roofs, face, X, Y, groundAt, t.site));
  const footY = (s: number) => (elev ? band.top + band.h : Y(groundAt(s) - BELOW_GROUND_M));

  // the roads that come in, named upright in their gaps over the ground, as the street's own signs would be
  for (const g of face.gaps) {
    if (!g.road || Math.abs(X(g.s1) - X(g.s0)) < 3) continue;
    const x = (X(g.s0) + X(g.s1)) / 2 + 0.9, y = Y(Math.max(groundAt(g.s0), groundAt(g.s1))) - 2.5;
    svg.push(`<text x="${f2(x)}" y="${f2(y)}" transform="rotate(-90 ${f2(x)} ${f2(y)})" class="rd">${esc(titleCase(g.road))}</text>`);
  }
  const labelTop = band.top + band.h + LABEL_GAP;
  const rows = new Rows();
  const labels: string[] = [];
  const site = face.hasSite ? p.site : null;
  const siteX = site ? [X(site.s0), X(site.s1)].sort((a, c) => a - c) : null;
  if (siteX) { rows.take(0, siteX[0], siteX[1]); }

  // the frontages: a dashed line at each boundary, the address at the frontage's start as the viewer reads it
  const bounds = new Set<number>();
  for (const fr of face.frontages) { bounds.add(Math.round(fr.s0 * 2) / 2); bounds.add(Math.round(fr.s1 * 2) / 2); }
  for (const g of face.gaps) { bounds.add(Math.round(g.s0 * 2) / 2); bounds.add(Math.round(g.s1 * 2) / 2); }
  const items = [
    ...face.frontages.map((fr) => ({ s0: fr.s0, s1: fr.s1, lines: fr.number ? [fr.number, `${shortStreetName(fr.street)}.`] : [], site: fr.site, road: false })),
  ].sort((a, c) => Math.min(X(a.s0), X(a.s1)) - Math.min(X(c.s0), X(c.s1)));
  const leaderTo = new Map<number, number>();
  for (const it of items) {
    if (!it.lines.length) continue;
    const xa = Math.min(X(it.s0), X(it.s1)), xb = Math.max(X(it.s0), X(it.s1));
    const w = Math.max(...it.lines.map((l) => l.length)) * CHAR_MM + 1;
    if (it.site) {
      // under the site's marker, centred on it
      const cx = (xa + xb) / 2;
      labels.push(`<text x="${f2(cx)}" y="${f2(labelTop + ROW_MM + 1.9)}" text-anchor="middle" class="lb site">${it.lines.map((l, j) => `<tspan x="${f2(cx)}" dy="${j ? 2.05 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
      rows.take(1, cx - w / 2, cx + w / 2);
      continue;
    }
    const x = it.road ? (xa + xb) / 2 - w / 2 + 0.5 : xa + 0.7;
    let lines = it.lines, row = rows.place(x, x + w);
    // a narrow frontage among narrow frontages keeps its number alone
    if (row < 0 && lines.length > 1) { lines = lines.slice(0, 1); row = rows.place(x, x + lines[0].length * CHAR_MM + 1); }
    if (row < 0) continue;
    const y = labelTop + row * ROW_MM + 1.9;
    labels.push(`<text x="${f2(x)}" y="${f2(y)}" class="lb${it.road ? ' road' : ''}">${lines.map((l, j) => `<tspan x="${f2(x)}" dy="${j ? 2.05 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
    if (!it.road) { const key = Math.round((face.sRightward ? it.s0 : it.s1) * 2) / 2; leaderTo.set(key, Math.max(leaderTo.get(key) ?? 0, y + (lines.length - 1) * 2.05 + 0.6)); }
  }
  for (const s of bounds) {
    if (s <= p.s0 + 0.5 || s >= p.s1 - 0.5) continue;
    if (siteX && site && (Math.abs(s - site.s0) < 0.6 || Math.abs(s - site.s1) < 0.6)) continue;
    const y1 = leaderTo.get(s) ?? labelTop + 1;
    svg.push(`<line x1="${f2(X(s))}" y1="${f2(footY(s))}" x2="${f2(X(s))}" y2="${f2(y1)}" stroke="#7d817f" stroke-width="0.13" stroke-dasharray="0.9,0.7"/>`);
  }

  // the site: red dashes through the band and down to its marker, an arrowed box between them
  if (site && siteX) {
    for (const x of siteX) svg.push(`<line x1="${f2(x)}" y1="${f2(band.top + 2)}" x2="${f2(x)}" y2="${f2(labelTop + ROW_MM * 2 + 2.6)}" stroke="${t.site}" stroke-width="0.4" stroke-dasharray="2.2,1.1"/>`);
    const [xa, xb] = siteX, ym = labelTop + 1.4, hh = 1.3;
    svg.push(`<path d="M${f2(xa + 0.4)},${f2(ym)} L${f2(xa + 2)},${f2(ym - hh)} H${f2(xb - 2)} L${f2(xb - 0.4)},${f2(ym)} L${f2(xb - 2)},${f2(ym + hh)} H${f2(xa + 2)} Z" fill="#ffffff" stroke="${t.ink}" stroke-width="0.18"/>`);
    svg.push(`<text x="${f2((xa + xb) / 2)}" y="${f2(ym + 0.62)}" text-anchor="middle" class="lb">SITE</text>`);
  } else if (p.site) {
    // across the road from the site: its stretch, lightly
    const xs = [X(p.site.s0), X(p.site.s1)].sort((a, c) => a - c);
    for (const x of xs) svg.push(`<line x1="${f2(x)}" y1="${f2(band.top - 0.6)}" x2="${f2(x)}" y2="${f2(band.top + band.h)}" stroke="${t.site}" stroke-width="0.25" stroke-dasharray="0.8,1.2" opacity="0.8"/>`);
    svg.push(`<text x="${f2((xs[0] + xs[1]) / 2)}" y="${f2(band.top - 1.2)}" text-anchor="middle" class="lb opp">OPPOSITE THE SITE</text>`);
  }

  // the face's caption, its imagery's credit and the scale bar
  const capY = labelTop + LABELS_H;
  const dates = views.map((fr) => fr.date).filter((d): d is string => !!d).sort();
  const months = dates.length ? (monthName(dates[0]) === monthName(dates[dates.length - 1]) ? monthName(dates[0]) : `${monthName(dates[0])} – ${monthName(dates[dates.length - 1])}`) : 'undated';
  const tiles = `Google Photorealistic 3D Tiles · ${(b.tileCredits ?? []).slice(0, 4).join(', ')}`;
  const ai = elev && b.ai?.sides.includes(elev.side) ? ` · AI-enhanced with Artlist, ${b.ai.model}` : '';
  const credit = elev
    ? (elev.draped ? `Street View © Google · ${views.length} panoramas · ${months}, laid on ${tiles}${ai}` : `${tiles}${ai}`)
    : views.length
      ? `Street View © Google · ${views.length} panoramas · ${months}`
      : (b.framesNote ? 'No Street View frames' : '');
  // a face is the side of the street the viewer turns to: its name and the way the viewer looks are one
  const title = `${titleCase(p.street)}, the ${bearingWord(face.facing)} side, looking ${bearingWord(face.facing)}${face.hasSite ? ' · the site’s side' : ''}`;
  const bar = scaleBar(L, SLIDE_W - MARGIN, capY + 2.4);
  return {
    html: `${slices}<div class="abs cap" style="left:${MARGIN}mm;top:${f2(capY)}mm;width:${SLIDE_W - 2 * MARGIN - 70}mm"><span class="ct">${esc(title)}</span><span class="cr">${esc(credit)}</span></div>`,
    svg: `${svg.join('')}${labels.join('')}${bar}`,
  };
}

/**
 * A frontage's roofline in steps: its metres' building tops (`z`, over ground `g`), a lone metre's spike (a chimney, a
 * mast) passed over, grouped where they stand within `tol` metres of one another, a step narrower than `minRun`
 * metres folded into the neighbour nearer its height, each at the 80th percentile of its metres. A metre standing
 * under `minH` over its ground is open (a yard, a lane) and ends a building; a building is a list of steps.
 */
export function roofSteps(pts: { s: number; z: number; g: number }[], tol = 1.2, minRun = 3, minH = 2.5): { s0: number; s1: number; z: number; g: number }[][] {
  const med = (r: { z: number }[]) => { const zs = r.map((p) => p.z).sort((a, b) => a - b); return zs[Math.floor((zs.length - 1) / 2)]; };
  const sorted = [...pts].sort((a, b) => a.s - b.s);
  const smooth = sorted.map((p, i) => ({ ...p, z: med(sorted.slice(Math.max(0, i - 1), i + 2)) }));
  const buildings: (typeof smooth)[] = [];
  let cur: typeof smooth = [];
  for (const p of smooth) {
    if (p.z - p.g < minH || (cur.length && p.s - cur[cur.length - 1].s > 1.5)) { if (cur.length) buildings.push(cur); cur = []; }
    if (p.z - p.g >= minH) cur.push(p);
  }
  if (cur.length) buildings.push(cur);
  return buildings.filter((bd) => bd.length >= 2).map((bd) => {
    const runs: (typeof smooth)[] = [];
    for (const p of bd) {
      const r = runs[runs.length - 1];
      if (r && Math.abs(p.z - med(r)) <= tol) r.push(p); else runs.push([p]);
    }
    for (let i = runs.findIndex((r) => r.length < minRun); runs.length > 1 && i >= 0; i = runs.findIndex((r) => r.length < minRun)) {
      const m = med(runs[i]), l = runs[i - 1], r = runs[i + 1];
      const j = !l ? i + 1 : !r ? i - 1 : Math.abs(med(l) - m) <= Math.abs(med(r) - m) ? i - 1 : i + 1;
      const a = Math.min(i, j);
      runs.splice(a, 2, [...runs[a], ...runs[a + 1]]);
    }
    return runs.map((r) => {
      const zs = r.map((p) => p.z).sort((a, b) => a - b);
      return { s0: r[0].s - 0.5, s1: r[r.length - 1].s + 0.5, z: zs[Math.floor((zs.length - 1) * 0.8)], g: r.reduce((t, p) => t + p.g, 0) / r.length };
    });
  });
}

/**
 * The buildings drawn over a face, gently: each frontage's building a veil of white over the picture, its roofline
 * in steps and down to the ground at its ends (the party walls at the lot lines) in a hairline, floor lines at its
 * storeys (its measured height at METRES_PER_STOREY a storey, evenly spaced) in white, and over its tallest step its
 * height over the ground and its level in AHD. The site's building in the site's red.
 */
function buildingLines(e: Elevation, roofs: { s: number; z: number }[], face: Face, X: (s: number) => number, Y: (z: number) => number, groundAt: (s: number) => number, siteInk: string): string {
  const lines: string[] = [], floors: string[] = [], tags: { x: number; y: number; h: number; text: string[]; site: boolean }[] = [];
  for (const fr of face.frontages) {
    const a = Math.min(fr.s0, fr.s1), b = Math.max(fr.s0, fr.s1);
    const pts = roofs.filter((r) => r.s > a && r.s < b).map((r) => ({ s: r.s, z: r.z, g: groundAt(r.s) }));
    for (const steps of roofSteps(pts)) {
      const s0 = Math.max(a, steps[0].s0), s1 = Math.min(b, steps[steps.length - 1].s1);
      const d = [`M${f2(X(s0))},${f2(Y(groundAt(s0)))}`, `V${f2(Y(steps[0].z))}`];
      steps.forEach((st, k) => {
        d.push(`H${f2(X(k === steps.length - 1 ? s1 : st.s1))}`);
        if (k < steps.length - 1) d.push(`V${f2(Y(steps[k + 1].z))}`);
        const h = st.z - st.g, n = Math.max(1, Math.round(h / METRES_PER_STOREY));
        for (let j = 1; j < n; j++) floors.push(`M${f2(X(Math.max(s0, st.s0)))},${f2(Y(st.g + (j * h) / n))}H${f2(X(Math.min(s1, st.s1)))}`);
      });
      d.push(`V${f2(Y(groundAt(s1)))}`);
      // and back along the ground, so the building is a shape to fill
      for (let q = Math.floor(s1); q > s0; q--) d.push(`L${f2(X(q))},${f2(Y(groundAt(q)))}`);
      d.push(`L${f2(X(s0))},${f2(Y(groundAt(s0)))}Z`);
      lines.push(`<path d="${d.join('')}" class="bl${fr.site ? ' site' : ''}"${fr.site ? ` style="fill:${siteInk};stroke:${siteInk}"` : ''}/>`);
      const top = steps.reduce((m, st) => (st.z - st.g > m.z - m.g ? st : m));
      const h = top.z - top.g;
      tags.push({ x: (X(Math.max(s0, top.s0)) + X(Math.min(s1, top.s1))) / 2, y: Y(top.z) - 0.9, h, site: !!fr.site,
        text: [`${h.toFixed(1)} m · ${Math.max(1, Math.round(h / METRES_PER_STOREY))} ST`, `RL ${(top.z - e.offsetM).toFixed(1)}`] });
    }
  }
  // the tallest first, each where it clears those already set
  const set: [number, number, number, number][] = [];
  const out: string[] = [];
  for (const tg of tags.sort((p, q) => q.h - p.h)) {
    const w = Math.max(...tg.text.map((l) => l.length)) * 0.82 + 0.6, box: [number, number, number, number] = [tg.x - w / 2, tg.y - 3.5, tg.x + w / 2, tg.y + 0.4];
    if (set.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3])) continue;
    set.push(box);
    out.push(`<text x="${f2(tg.x)}" y="${f2(tg.y - 1.75)}" text-anchor="middle" class="bh${tg.site ? ' site' : ''}"><tspan x="${f2(tg.x)}">${esc(tg.text[0])}</tspan><tspan x="${f2(tg.x)}" dy="1.75">${esc(tg.text[1])}</tspan></text>`);
  }
  return `<g>${lines.join('')}${floors.length ? `<path d="${floors.join('')}" class="fl"/>` : ''}${out.join('')}</g>`;
}

/** An elevation in its band: the picture placed by what it spans, the band cutting it to the face's sky and ground. */
function elevationHtml(e: Elevation, X: (s: number) => number, Y: (z: number) => number, band: Layout['bands'][number], k: number): string {
  const xa = Math.min(X(e.sAtLeft), X(e.sAtRight)), w = Math.abs(X(e.sAtRight) - X(e.sAtLeft));
  return `<div class="abs elev" style="left:${f2(xa)}mm;top:${f2(band.top)}mm;width:${f2(w)}mm;height:${f2(band.h)}mm"><img src="data/${esc(e.file)}" style="left:0;top:${f2(Y(e.zTop) - band.top)}mm;width:${f2(w)}mm;height:${f2((e.zTop - e.zBottom) * k)}mm" alt=""></div>`;
}

function sliceHtml(b: StreetscapeBundle, face: Face, fr: ScapeFrame, X: (s: number) => number, top: number, zTop: number, groundAt: (s: number) => number, k: number): string {
  // a hair of overlap either side, so neighbouring frames meet without a seam of paper between them
  const sA = Math.min(fr.a, fr.b), sB = Math.max(fr.a, fr.b);
  const left = Math.min(X(sA), X(sB)) - SEAM_MM, wMm = Math.abs(X(sB) - X(sA)) + 2 * SEAM_MM;
  // the sheet's px, from the slice's corner, to the face's (s, z): s runs with the sheet or against it
  const K = k * PX_PER_MM, sgn = face.sRightward ? 1 : -1;
  const sAtLeft = face.sRightward ? sA - SEAM_MM / k : sB + SEAM_MM / k;
  const sheetToPlane = [[sgn / K, 0, sAtLeft], [0, -1 / K, zTop], [0, 0, 1]];
  let T = inv3(mul3(planeToImage(b.plan, fr), sheetToPlane));
  // the picture's middle comes out with a positive w, or the browser takes it for behind the eye
  if (T[2][0] * (FRAME_PX / 2) + T[2][1] * (FRAME_PX / 2) + T[2][2] < 0) T = T.map((r) => r.map((v) => -v));
  const n = (v: number) => Number(v.toPrecision(9));
  const m3d = [T[0][0], T[1][0], 0, T[2][0], T[0][1], T[1][1], 0, T[2][1], 0, 0, 1, 0, T[0][2], T[1][2], 0, T[2][2]].map(n).join(',');
  // the clip: the strip's top and sides, and along its foot the footpath below the ground line, right to left
  const steps = Math.max(2, Math.ceil(sB - sA));
  const foot = Array.from({ length: steps + 1 }, (_, j) => {
    const s = sA + ((sB - sA) * j) / steps;
    return { x: Math.min(wMm, Math.max(0, X(s) - left)), y: (zTop - (groundAt(s) - BELOW_GROUND_M)) * k };
  }).sort((p, q) => q.x - p.x);
  foot[0].x = wMm; foot[foot.length - 1].x = 0;
  const clip = `polygon(0mm 0mm, ${f2(wMm)}mm 0mm, ${foot.map((p) => `${f2(p.x)}mm ${f2(p.y)}mm`).join(', ')})`;
  const h = Math.max(...foot.map((p) => p.y)) + 1;
  return `<div class="abs slice" style="left:${f2(left)}mm;top:${f2(top)}mm;width:${f2(wMm)}mm;height:${f2(h)}mm;clip-path:${clip}"><img src="data/${esc(fr.file)}" style="transform:matrix3d(${m3d})" alt=""></div>`;
}

function scaleBar(L: Layout, right: number, y: number): string {
  const steps = L.scale <= 500 ? [0, 10, 20, 50] : L.scale <= 1000 ? [0, 20, 50, 100] : [0, 50, 100, 200];
  const w = steps[steps.length - 1] * L.k, x0 = right - w;
  const ticks = steps.map((s) => `<line x1="${f2(x0 + s * L.k)}" y1="${f2(y - 0.9)}" x2="${f2(x0 + s * L.k)}" y2="${f2(y + 0.9)}" stroke="#2a2e2c" stroke-width="0.15"/><text x="${f2(x0 + s * L.k)}" y="${f2(y + 3.1)}" text-anchor="middle" class="lb sb">${s}${s === steps[steps.length - 1] ? ' M' : ''}</text>`).join('');
  return `<line x1="${f2(x0)}" y1="${f2(y)}" x2="${f2(right)}" y2="${f2(y)}" stroke="#2a2e2c" stroke-width="0.25"/>${ticks}<text x="${f2(x0 - 2)}" y="${f2(y + 0.6)}" text-anchor="end" class="lb sb">1:${L.scale} AT A3</text>`;
}

/** What the sheet says above the faces: the street's length and fall, and the site's frontage. */
export function streetscapeSentences(b: StreetscapeBundle): string[] {
  const p = b.plan, out: string[] = [];
  const g = p.faces[0]?.ground ?? [];
  const len = Math.round(p.s1 - p.s0);
  if (g.length > 1) {
    const a = g[0], z = g[g.length - 1], fall = Math.abs(a.z - z.z);
    const toward = bearingWord(((a.z > z.z ? 0 : 180) + (Math.atan2(p.axis.x, p.axis.y) * 180) / Math.PI + 360) % 360);
    out.push(fall < 0.5 ? `${titleCase(p.street)} runs ${len} m here, nearly level.` : `${titleCase(p.street)} runs ${len} m here, falling ${fall.toFixed(1)} m to the ${toward}.`);
  } else out.push(`${titleCase(p.street)} runs ${len} m here.`);
  const sf = p.faces.find((f) => f.hasSite);
  if (sf && p.site) {
    const own = sf.frontages.filter((f) => f.site);
    const w = Math.round(p.site.s1 - p.site.s0);
    const others = sf.frontages.filter((f) => !f.site).length;
    out.push(`The site’s frontage is ${w} m${own.length === 1 && own[0].address ? `, ${titleCase(own[0].address)}` : ''}, among ${others} other propert${others === 1 ? 'y' : 'ies'} on its side of the window.`);
  }
  return out;
}

/** The sheet; `overlay` draws the buildings' lines, heights and levels over the 3D faces. */
export function renderStreetscape(b: StreetscapeBundle, meta: SheetMeta, opts: { overlay?: boolean } = {}): string {
  return withTemplate(DECK_TEMPLATE, () => drawStreetscape(b, meta, opts.overlay ?? false));
}

function drawStreetscape(b: StreetscapeBundle, meta: SheetMeta, overlay: boolean): string {
  const t = tpl();
  const L = layoutFaces(b);
  const faces = b.plan.faces.map((f, i) => faceSvg(b, f, L, i, overlay));
  const lined = overlay && !!b.elevations?.some((e) => e?.roofs?.length);
  const lead = streetscapeSentences(b).join(' ');
  const sources = [
    b.elevations?.some(Boolean) ? `Faces: orthographic elevations of Google’s Photorealistic 3D Tiles${b.elevations.some((e) => e?.draped) ? ', each Google Street View photograph laid on the meshes from where its camera stood, so a facade is the photograph’s and stands at its own depth; the street’s trees, and what no photograph saw clear (a roof, a wall behind a tree from every camera), keep the meshes’ own texture, and the meshes’ outlines, as photogrammetry, are soft' : ' (photogrammetry, so trees and fine detail are approximate)'}. Seen square from the street’s centreline with its near half cut away, and with what stands more than 35 m behind the boundary left out; the ground line is the elevation model’s at the boundary, set on the meshes${b.groundOffsetM !== undefined ? `, which stand ${b.groundOffsetM.toFixed(1)} m above AHD here` : ''}.` : b.frames.length ? 'Frames: Google Street View, each rectified onto its frontage’s boundary as a plane, so the street reads at one true scale; what stands in front of the boundary (trees, cars, awnings) reads larger, a building set back from it smaller, and the seams between frames are the frames’, not the street’s.' : (b.framesNote ?? ''),
    'Frontages and addresses: NSW property and cadastre layers (NSW Spatial Services); a frontage is where a ray square to the street from its centreline first meets a property boundary.',
    lined ? `Buildings (the pale veils over the faces): each frontage’s building as the meshes stand at and behind its boundary (the street’s trees and the awnings over the footpath cut away, a garden’s trees left out), in steps where it changes by more than a metre; floor lines at ${METRES_PER_STOREY} m a storey of the measured height, evenly spaced, not surveyed; heights over the ground at the boundary and levels in AHD, to about a metre.` : '',
    b.ai ? `AI-enhanced and illustrative: ${b.ai.tiles} of ${b.ai.of} tiles of the faces redrawn by ${b.ai.model} through Artlist, each scaled back into its place, so ${b.elevations?.some((e) => e?.draped) ? 'the outlines and the photographed facades stand where they did, but the trees, the seams and what neither the photographs nor the meshes showed are the model’s' : 'the outlines stand where the meshes put them, but every facade, window and tree is the model’s, drawn on the meshes’ shapes and colours, not the buildings’ own'}; the measured drawing is STREETSCAPE.pdf.` : '',
    `Ground: ${b.demSource ?? 'no elevation model'}, at the boundary, indicative to about a metre.`,
    `Retrieved ${b.generatedAt.slice(0, 10)}.`,
  ].filter(Boolean).join(' ');
  const footerLeft = ['SITE ANALYST — STREETSCAPE', b.siteAddress, meta.client ? `for ${meta.client}` : '', meta.jobNo ? `job ${meta.jobNo}` : ''].filter(Boolean).join(' · ');
  const subtitle = `${b.siteAddress} · ${titleCase(b.plan.street)}, both sides, ${Math.round(b.plan.s1 - b.plan.s0)} m · 1:${L.scale}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(b.siteAddress)} — STREETSCAPE</title>
<style>
${deckCss()}
  .slice { overflow: hidden; }
  .slice img { position: absolute; left: 0; top: 0; width: ${FRAME_PX}px; height: ${FRAME_PX}px; transform-origin: 0 0; max-width: none; }
  .elev { overflow: hidden; background: ${SCAPE_SKY}; }
  .elev img { position: absolute; max-width: none; }
  .rd { font-size: 2.3px; font-weight: 500; letter-spacing: 0.02em; fill: #2a2e2c; paint-order: stroke; stroke: ${SCAPE_SKY}; stroke-width: 0.7px; stroke-linejoin: round; }
  svg.over { position: absolute; left: 0; top: 0; overflow: visible; }
  .lb { font-size: ${LABEL_MM}px; font-weight: 600; letter-spacing: 0.04em; fill: #2a2e2c; }
  .lb.road { fill: #6a7572; font-weight: 500; letter-spacing: 0.08em; }
  .lb.site { fill: ${t.site}; }
  .lb.opp { fill: ${t.site}; font-weight: 500; letter-spacing: 0.1em; paint-order: stroke; stroke: #ffffff; stroke-width: 0.5px; stroke-linejoin: round; }
  .lb.sb { font-weight: 500; fill: #454f4b; }
  .bl { fill: #ffffff; fill-opacity: 0.3; stroke: #2a2e2c; stroke-opacity: 0.5; stroke-width: 0.14px; stroke-linejoin: miter; }
  .bl.site { fill-opacity: 0.14; stroke-opacity: 0.85; stroke-width: 0.2px; }
  .fl { fill: none; stroke: #ffffff; stroke-width: 0.14px; opacity: 0.7; }
  .bh { font-size: 1.3px; font-weight: 500; letter-spacing: 0.02em; fill: #3a403d; paint-order: stroke; stroke: #ffffff; stroke-width: 0.4px; stroke-linejoin: round; }
  .bh.site { fill: ${t.site}; }
  .cap { display: flex; gap: 4mm; align-items: baseline; font-size: 2.5mm; }
  .cap .ct { font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
  .cap .cr { color: #6a7572; font-size: 2.1mm; }
  .lead { font-size: 3.05mm; line-height: 1.38; font-weight: 600; color: ${t.site}; }
  .src { font-size: 2.1mm; line-height: 1.3; color: #6a7572; }
</style></head>
<body>
<section class="slide" id="streetscape">
  <div class="abs rh" style="left:${MARGIN}mm;top:10mm;width:${SLIDE_W - 2 * MARGIN}mm"><span>Streetscape</span><span>${esc(b.siteAddress)}</span></div>
  <div class="abs title" style="left:${MARGIN}mm;top:17.5mm;width:200mm">Streetscape</div>
  <div class="abs subtitle" style="left:${MARGIN}mm;top:26.5mm;width:200mm">${esc(subtitle)}${b.ai ? ` · <span style="color:${t.site};font-weight:600;letter-spacing:0.08em">AI-ENHANCED · ILLUSTRATIVE</span>` : ''}</div>
  <div class="abs lead" style="left:${SLIDE_W - MARGIN - 150}mm;top:17.5mm;width:150mm">${esc(lead)}</div>
  ${faces.map((f) => f.html).join('\n  ')}
  <svg class="over" width="${SLIDE_W}mm" height="${SLIDE_H}mm" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">${faces.map((f) => f.svg).join('')}</svg>
  <div class="abs src" style="left:${MARGIN}mm;top:${FOOT_TOP + 1}mm;width:${SLIDE_W - 2 * MARGIN}mm">${esc(sources)}</div>
  <div class="abs foot" style="left:${MARGIN}mm;top:${SLIDE_H - 10}mm;width:${SLIDE_W - 2 * MARGIN}mm"><span>${esc(footerLeft)}</span><span>generated ${esc(b.generatedAt.slice(0, 10))}</span></div>
</section>
</body></html>`;
}

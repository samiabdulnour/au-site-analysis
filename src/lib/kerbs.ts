// Kerb lines for the site sheet, where no survey has them. NSW publishes no
// kerbs or footpath edges as open data (the state's roads are centre lines
// only, a few metres out), so the kerb is placed from what is known: the
// cadastre's lot boundary is the back of the footpath, and the kerb runs
// parallel to it, one footpath's width out into the road reserve. The width
// is measured where OpenStreetMap maps the footpath (a sidewalk is mapped
// along its middle, so the width is twice its distance from the boundary),
// and is a typical width for the street's class where it is not; a lane has
// no footpath, and its kerb stands just off the boundary. A kerb
// OpenStreetMap maps as a line is drawn as it is and takes the place of the
// estimate beside it.
//
// Drawn as a drafter would: each frontage's kerb runs straight along it and
// on until it meets the next frontage's, and each corner of the line is then
// rounded to one kerb return radius, or less where the lot is too near. So
// the kerb runs unbroken along a street, turns a corner in one arc, swings
// into a lane the same way, and ends in a return where the boundary beside it
// has no street. Indicative only: the sheet says so.

/** A kerb line in lon/lat, and how its place was found. */
export interface KerbLine { coords: [number, number][]; from: 'osm' | 'footway' | 'typical' }

interface Road { hierarchy: number; coords: [number, number][]; name?: string }
type P = [number, number];

/** A footpath's typical width (m) by the street's function: arterial, sub-arterial, collector, local. Lanes have none. */
export function typicalFootpathM(hierarchy: number): number | null {
  return hierarchy <= 3 ? 5 : hierarchy === 4 ? 4.5 : hierarchy === 5 ? 4 : hierarchy === 6 ? 3.5 : null;
}

/** How far a lane's kerb stands off the boundary (m): a lane (an access way, function 7) has no footpath, a narrow verge at most. */
export const LANE_VERGE_M = 0.6;

/** The kerb return's radius (m), at every corner. */
export const KERB_RETURN_M = 3.5;

export function estimateKerbs(lotRings: number[][][], roads: Road[], sidewalks: P[][], osmKerbs: P[][] = []): KerbLine[] {
  const all = lotRings.flat();
  if (!all.length) return [];
  // Local metres about the lots' middle: plenty for a few hundred metres.
  let lon0 = 0, lat0 = 0;
  for (const [x, y] of all) { lon0 += x; lat0 += y; }
  lon0 /= all.length; lat0 /= all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320, ky = 110_574;
  const toM = ([lon, lat]: number[]): P => [(lon - lon0) * kx, (lat - lat0) * ky];
  const toLL = ([x, y]: P): P => [x / kx + lon0, y / ky + lat0];

  const lots = lotRings.filter((r) => r.length >= 4).map((r) => {
    const ring = r.map(toM);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a2 = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      x0 = Math.min(x0, ring[i][0]); y0 = Math.min(y0, ring[i][1]); x1 = Math.max(x1, ring[i][0]); y1 = Math.max(y1, ring[i][1]);
      a2 += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return { ring, bbox: [x0, y0, x1, y1], ccw: a2 > 0 };
  });
  const inLots = ([x, y]: P): boolean => lots.some(({ ring, bbox }) => {
    if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });

  interface Seg { a: P; b: P; h: number; id: string }
  const segsOf = (lines: P[][], tag: (i: number) => number, id: (i: number) => string = () => ''): Seg[] => lines.flatMap((l, i) => {
    const m = l.map(toM);
    return m.slice(1).map((b, k) => ({ a: m[k], b, h: tag(i), id: id(i) }));
  });
  const roadSegs = segsOf(roads.map((r) => r.coords), (i) => roads[i].hierarchy, (i) => roads[i].name ?? `#${i}`);
  const walkSegs = segsOf(sidewalks, () => 0);
  const kerbSegs = segsOf(osmKerbs, () => 0);
  /** The nearest segment to p that `ok` accepts: its distance, the closest point, its unit direction. */
  const nearest = (p: P, segs: Seg[], within: number, ok: (c: P, u: P) => boolean) => {
    let best: { d: number; c: P; u: P; h: number; id: string } | null = null;
    for (const { a, b, h, id } of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (!L2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      const c: P = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d >= within || (best && d >= best.d)) continue;
      const L = Math.sqrt(L2), u: P = [dx / L, dy / L];
      if (ok(c, u)) best = { d, c, u, h, id };
    }
    return best;
  };

  // Each outer boundary edge of a lot, turned so the street lies to its
  // right, with the footpath's width there, or none (a park, a river, a
  // back fence beside it).
  interface Edge {
    p: P; q: P; u: P; n: P; len: number;
    width: number | null; measured: boolean; lane: boolean; short?: boolean; filled?: boolean;
    want: number; cap: number; depth: number; road: string;
  }
  const R = KERB_RETURN_M;
  const edges: Edge[] = [];
  for (const { ring, ccw } of lots) {
    const own: Edge[] = [];
    for (let i = 1; i < ring.length; i++) {
      let p = ring[i - 1], q = ring[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.2) continue;
      let u: P = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      // Outward: to the right of a counter-clockwise ring's edges.
      const n: P = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
      if (!ccw) { [p, q] = [q, p]; u = [-u[0], -u[1]]; }
      const m: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const at = (d: number): P => [m[0] + n[0] * d, m[1] + n[1] * d];
      if (inLots(at(Math.min(1.2, len / 2)))) continue;   // a boundary between two lots
      // How deep the lots run behind the frontage, so its strip of footpath
      // never shows out of the back of a shallow lot.
      let depth = 6;
      for (let d = 0.25; d < 6; d += 0.25) if (!inLots(at(-d))) { depth = d; break; }
      const none: Edge = { p, q, u, n, len, width: null, measured: false, lane: false, want: 0, cap: 0, depth, road: '' };
      if (len < 1.5) { own.push({ ...none, short: true }); continue; }   // a corner's splay: its neighbours' width, below
      // The road reserve's width: how far out the next lot is.
      let reserve = Infinity;
      for (let d = 2; d <= 50; d += 0.75) {
        if (!inLots(at(d))) continue;
        let lo = d - 0.75, hi = d;                   // to a centimetre
        for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (inLots(at(mid))) hi = mid; else lo = mid; }
        reserve = hi;
        break;
      }
      // A street, on this side, running with the boundary: the nearest such,
      // not the nearest of all, which at a corner is the cross street.
      const along = (side: number) => (c: P, v: P) => (c[0] - m[0]) * n[0] + (c[1] - m[1]) * n[1] >= side && Math.abs(u[0] * v[0] + u[1] * v[1]) >= 0.87;
      const road = nearest(m, roadSegs, Math.min(45, reserve + 12), along(0.5));
      let lane = road?.h === 7;
      const typical = road ? (lane ? LANE_VERGE_M : typicalFootpathM(road.h)) : null;
      if (!road || typical === null) { own.push(none); continue; }
      let want = typical, measured = false;
      const walk = lane ? null : nearest(m, walkSegs, 9, along(0.3));
      if (walk) { want = Math.max(2, Math.min(7, walk.d * 2)); measured = true; }
      // At least a lane's width of road either side of the middle; a lane
      // itself may be one lane wide.
      let cap = Number.isFinite(reserve) ? reserve / 2 - (lane ? 1.5 : 2.8) : Infinity;
      let width = Math.min(want, cap);
      // A street with no room for a footpath is a lane in all but name.
      if (!lane && width < 1.2 && Number.isFinite(reserve)) {
        lane = true; want = LANE_VERGE_M; measured = false;
        cap = reserve / 2 - 1.5; width = Math.min(want, cap);
      }
      if (width < (lane ? 0.3 : 1.2)) { own.push(none); continue; }
      own.push({ p, q, u, n, len, width, measured, lane, want, cap, depth, road: road.id });
    }
    // A short edge at a corner (a splay, a jog) takes the wider of its
    // neighbours' widths, so it never stops the kerb.
    own.forEach((e, k) => {
      if (!e.short) return;
      const ws = [own[(k + own.length - 1) % own.length], own[(k + 1) % own.length]].filter((o) => !o.short && o.width !== null);
      if (ws.length) { e.width = Math.max(...ws.map((o) => o.width!)); e.measured = ws.some((o) => o.measured); }
    });
    edges.push(...own);
  }

  // The boundary's edges in order round each block, across lots: an edge's
  // successor starts where it ends (past any splay), its predecessor ends
  // where it starts.
  const keyOf = (p: P, dx = 0, dy = 0) => `${Math.round(p[0] / 0.05) + dx},${Math.round(p[1] / 0.05) + dy}`;
  const starting = new Map<string, number[]>(), ending = new Map<string, number[]>();
  edges.forEach((e, k) => {
    (starting.get(keyOf(e.p)) ?? starting.set(keyOf(e.p), []).get(keyOf(e.p))!).push(k);
    (ending.get(keyOf(e.q)) ?? ending.set(keyOf(e.q), []).get(keyOf(e.q))!).push(k);
  });
  const touching = (index: Map<string, number[]>, p: P) => {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(index.get(keyOf(p, dx, dy)) ?? []));
    return out;
  };
  const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
  const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
  /** The next (or, backward, the previous) edge round the block that is not a splay, and the corner point it starts (or ends) at. */
  const neighbour = (k: number, forward: boolean): number => {
    let cur = k;
    for (let hop = 0; hop < 4; hop++) {
      const e = edges[cur];
      const cands = touching(forward ? starting : ending, forward ? e.q : e.p).filter((j) => j !== cur && j !== k);
      if (!cands.length) return -1;
      // At a corner two blocks only touch, keep to this block: the sharpest turn toward the lots.
      const turn = (j: number) => Math.atan2(forward ? cross(e.u, edges[j].u) : cross(edges[j].u, e.u), forward ? dot(e.u, edges[j].u) : dot(edges[j].u, e.u));
      const next = cands.reduce((a, b) => (turn(b) > turn(a) ? b : a));
      if (!edges[next].short) return next;
      cur = next;
    }
    return -1;
  };
  const succ = edges.map((_, k) => (edges[k].short ? -1 : neighbour(k, true)));
  const pred = edges.map((_, k) => (edges[k].short ? -1 : neighbour(k, false)));

  const kerbed = (k: number) => k >= 0 && !edges[k].short && edges[k].width !== null;

  // A few metres of boundary with no street of its own between two that have
  // one (a corner's splay or curve, which runs with neither street) carry the
  // footpath round: their width is eased from the one side's to the other's.
  const GAP_MAX = 12;
  edges.forEach((e, k) => {
    if (!kerbed(k)) return;
    const gap: number[] = [];
    let len = 0, j = succ[k];
    while (j >= 0 && j !== k && !kerbed(j) && !edges[j].short && len + edges[j].len <= GAP_MAX && gap.length < 12) { gap.push(j); len += edges[j].len; j = succ[j]; }
    if (!gap.length || !kerbed(j) || j === k || edges[j].filled) return;
    const f = edges[j];
    let at2 = 0;
    for (const g of gap) {
      const t = (at2 + edges[g].len / 2) / len;
      at2 += edges[g].len;
      Object.assign(edges[g], { width: e.width! + (f.width! - e.width!) * t, lane: e.lane && f.lane, filled: true, want: 0, cap: Infinity, road: '' });
    }
  });

  // Along one block face of one street the footpath is one width: its
  // frontages running on with it (bending less than 30° at a time) take their
  // mean, so the kerb does not shift at every lot, nor bulge where a mapped
  // footpath swings out to a crossing.
  const runOf = edges.map((_, k) => k);
  const find = (k: number): number => (runOf[k] === k ? k : (runOf[k] = find(runOf[k])));
  edges.forEach((e, k) => {
    const s = succ[k];
    if (kerbed(k) && kerbed(s) && !e.filled && !edges[s].filled && edges[s].road === e.road && edges[s].lane === e.lane &&
      dot(e.u, edges[s].u) > Math.cos((30 * Math.PI) / 180)) runOf[find(k)] = find(s);
  });
  const runs = new Map<number, { sum: number; len: number; measured: boolean }>();
  edges.forEach((e, k) => {
    if (!kerbed(k) || e.filled) return;
    const r = runs.get(find(k)) ?? runs.set(find(k), { sum: 0, len: 0, measured: false }).get(find(k))!;
    r.sum += e.want * e.len; r.len += e.len; r.measured ||= e.measured;
  });
  edges.forEach((e, k) => {
    if (!kerbed(k) || e.filled) return;
    const r = runs.get(find(k))!;
    e.width = Math.min(r.sum / r.len, e.cap);
    e.measured = r.measured;
  });

  // Each frontage's strip of footpath: along its edge, from a little inside
  // the lot out to the kerb, run on at each end. Where the next frontage
  // turns away round a corner, it runs on to where the two kerbs, straight,
  // would meet; where it runs in line or turns inward, a little under the
  // next strip; where the boundary beyond has no kerb, it stops.
  interface Strip { o: P; u: P; n: P; s0: number; s1: number; h0: number; h1: number; edge: number }
  const RUN_ON = 1, MITRE_MAX = 12, IN_LINE = Math.sin((3 * Math.PI) / 180);
  const strips: Strip[] = [];
  edges.forEach((e, k) => {
    if (!kerbed(k)) return;
    const w = e.width!;
    const runOn = (j: number, forward: boolean): number => {
      if (!kerbed(j)) return 0;
      const f = edges[j];
      // The turn from this edge to the next (or from the previous to this one); positive is round a corner.
      const sin = forward ? cross(e.u, f.u) : cross(f.u, e.u), cos = dot(e.u, f.u);
      if (sin <= IN_LINE) return RUN_ON;
      // Where this kerb, run straight on, meets the other's.
      const corner = forward ? e.q : e.p, other = forward ? f.p : f.q;
      const wf = f.width! - ((corner[0] - other[0]) * f.n[0] + (corner[1] - other[1]) * f.n[1]);
      return Math.max(0, Math.min(MITRE_MAX, (wf - w * cos) / sin));
    };
    strips.push({ o: e.p, u: e.u, n: e.n, s0: -runOn(pred[k], false), s1: e.len + runOn(succ[k], true), h0: -e.depth, h1: w, edge: k });
  });
  /** A strip's signed distance: negative inside. */
  const stripDist = (b: Strip, x: number, y: number) => {
    const dx = x - b.o[0], dy = y - b.o[1];
    const s = dx * b.u[0] + dy * b.u[1], h = dx * b.n[0] + dy * b.n[1];
    const qx = Math.abs(s - (b.s0 + b.s1) / 2) - (b.s1 - b.s0) / 2;
    const qy = Math.abs(h - (b.h0 + b.h1) / 2) - (b.h1 - b.h0) / 2;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  };

  // Worked on a grid a quarter of a metre fine: the strips' outline, outside
  // the lots, is the kerb, its corners still sharp.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { bbox } of lots) { x0 = Math.min(x0, bbox[0]); y0 = Math.min(y0, bbox[1]); x1 = Math.max(x1, bbox[2]); y1 = Math.max(y1, bbox[3]); }
  x0 -= 4; y0 -= 4; x1 += 4; y1 += 4;
  const cell = Math.max(0.25, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4e6));
  const cols = Math.ceil((x1 - x0) / cell) + 1, rows = Math.ceil((y1 - y0) / cell) + 1, N = cols * rows;
  const X = (j: number) => x0 + j * cell, Y = (i: number) => y0 + i * cell;

  // The lots, filled: even-odd within a lot, and any lot over the grid.
  const inside = new Uint8Array(N);
  for (const { ring, bbox } of lots) {
    const i0 = Math.max(0, Math.floor((bbox[1] - y0) / cell)), i1 = Math.min(rows - 1, Math.ceil((bbox[3] - y0) / cell));
    for (let i = i0; i <= i1; i++) {
      const y = Y(i), xs: number[] = [];
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a], [xb, yb] = ring[b];
        if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let j = Math.max(0, Math.ceil((xs[k] - x0) / cell)); j <= Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / cell)); j++) inside[i * cols + j] = 1;
    }
  }

  // The boundary edges and mapped kerbs, and the strips, filed by the
  // patches of the grid they reach, so each point weighs only those near it.
  const REACH = 9, PATCH = 9;
  const bc = Math.ceil((x1 - x0) / PATCH) + 1, br = Math.ceil((y1 - y0) / PATCH) + 1;
  const file = (into: number[][], k: number, xa: number, ya: number, xb: number, yb: number, margin: number) => {
    const j0 = Math.max(0, Math.floor((xa - margin - x0) / PATCH)), j1 = Math.min(bc - 1, Math.floor((xb + margin - x0) / PATCH));
    const i0 = Math.max(0, Math.floor((ya - margin - y0) / PATCH)), i1 = Math.min(br - 1, Math.floor((yb + margin - y0) / PATCH));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) into[i * bc + j].push(k);
  };
  const segs: [P, P][] = [...edges.map((e): [P, P] => [e.p, e.q]), ...kerbSegs.map((k): [P, P] => [k.a, k.b])];
  const E = edges.length;
  const segPatch: number[][] = Array.from({ length: bc * br }, () => []);
  segs.forEach(([a, b], k) => file(segPatch, k, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), REACH));
  const stripPatch: number[][] = Array.from({ length: bc * br }, () => []);
  strips.forEach((b, k) => {
    const cs = [[b.s0, b.h0], [b.s1, b.h0], [b.s1, b.h1], [b.s0, b.h1]].map(([s, h]) => [b.o[0] + b.u[0] * s + b.n[0] * h, b.o[1] + b.u[1] * s + b.n[1] * h]);
    file(stripPatch, k, Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1])), 1.5);
  });
  const segDist = (k: number, x: number, y: number) => {
    const [a, b] = segs[k], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
    return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
  };

  // The field: the distance out from the strips' outline, negative within;
  // the kerb is where it crosses nought. NaN where no kerb is drawn: in the
  // lots, where the nearest boundary has none, and beside a mapped kerb.
  const field = new Float64Array(N).fill(NaN);
  const byStrip = new Int32Array(N).fill(-1);
  for (let i = 0; i < rows; i++) {
    const y = Y(i), pi = Math.min(br - 1, Math.floor((y - y0) / PATCH));
    for (let j = 0; j < cols; j++) {
      const c = i * cols + j;
      if (inside[c]) continue;
      const x = X(j), patch = pi * bc + Math.min(bc - 1, Math.floor((x - x0) / PATCH));
      let dAny = Infinity, dKerb = Infinity, mapped = false;
      for (const k of segPatch[patch]) {
        const d = segDist(k, x, y);
        if (k >= E) { if (d < 3) mapped = true; continue; }
        if (d < dAny) dAny = d;
        if (edges[k].width !== null && d < dKerb) dKerb = d;
      }
      if (mapped || dAny < dKerb - 1e-6) continue;
      let f = 1, best = -1;
      for (const k of stripPatch[patch]) {
        const d = stripDist(strips[k], x, y);
        if (d < f) { f = d; best = k; }
      }
      field[c] = f;
      byStrip[c] = best;
    }
  }

  // Marching squares over the field, each crossing keyed by the grid edge it
  // falls on, so the pieces chain into whole lines.
  const point = new Map<number, P>();
  const links = new Map<number, number[]>();
  const crossing = (ca: number, cb: number, key: number): number => {
    if (!point.has(key)) {
      const fa = field[ca], fb = field[cb], t = fa / (fa - fb);
      const ia = Math.floor(ca / cols), ja = ca % cols, ib = Math.floor(cb / cols), jb = cb % cols;
      point.set(key, [X(ja + (jb - ja) * t), Y(ia + (ib - ia) * t)]);
    }
    return key;
  };
  const link = (a: number, b: number) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const c00 = i * cols + j, c01 = c00 + 1, c10 = c00 + cols, c11 = c10 + 1;
      const v = [field[c00], field[c01], field[c11], field[c10]];
      if (v.some((x) => Number.isNaN(x))) continue;
      const code = (v[0] < 0 ? 1 : 0) | (v[1] < 0 ? 2 : 0) | (v[2] < 0 ? 4 : 0) | (v[3] < 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // The square's sides: bottom (c00–c01), right (c01–c11), top (c10–c11), left (c00–c10).
      const B = () => crossing(c00, c01, 2 * c00), Rt = () => crossing(c01, c11, 2 * c01 + 1);
      const T = () => crossing(c10, c11, 2 * c10), L = () => crossing(c00, c10, 2 * c00 + 1);
      const centre = (v[0] + v[1] + v[2] + v[3]) / 4;
      switch (code) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), Rt()); break;
        case 3: case 12: link(L(), Rt()); break;
        case 4: case 11: link(Rt(), T()); break;
        case 6: case 9: link(B(), T()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: if (centre < 0) { link(L(), T()); link(B(), Rt()); } else { link(L(), B()); link(Rt(), T()); } break;
        case 10: if (centre < 0) { link(L(), B()); link(Rt(), T()); } else { link(L(), T()); link(B(), Rt()); } break;
      }
    }
  }
  const out: KerbLine[] = [];
  const used = new Set<number>();
  const walk = (start: number): number[] => {
    const chain = [start];
    used.add(start);
    for (let cur = start; ;) {
      const next = (links.get(cur) ?? []).find((n2) => !used.has(n2));
      if (next === undefined) break;
      chain.push(next);
      used.add(next);
      cur = next;
    }
    return chain;
  };
  /** How far a point is from the nearest lot (within reach). */
  const toLots = (x: number, y: number) => {
    const pi = Math.max(0, Math.min(br - 1, Math.floor((y - y0) / PATCH))), pj = Math.max(0, Math.min(bc - 1, Math.floor((x - x0) / PATCH)));
    let d = REACH;
    for (const k of segPatch[pi * bc + pj]) if (k < E) d = Math.min(d, segDist(k, x, y));
    return d;
  };
  /**
   * Each corner of the line rounded to the kerb return radius: less where
   * the lengths either side leave no room, or where the arc would come
   * nearer the lot than six tenths of the footpath beside it; a corner
   * turning away from the lots, a metre.
   */
  const fillet = (pts: P[], closed: boolean): P[] => {
    const n = pts.length;
    if (n < 3) return pts;
    const at = (i: number) => pts[(i + n) % n];
    const unit = (a: P, b: P): P => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    const segLen = (i: number) => Math.hypot(at(i + 1)[0] - at(i)[0], at(i + 1)[1] - at(i)[1]);
    const t = new Float64Array(n), half = new Float64Array(n);
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const a = at(i - 1), v = at(i), b = at(i + 1), d1 = unit(a, v), d2 = unit(v, b);
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(d1, d2))));
      if (turn < (2 * Math.PI) / 180) continue;
      const bis = unit([0, 0], [d2[0] - d1[0], d2[1] - d1[1]]);
      const here = toLots(v[0], v[1]), convex = toLots(v[0] + bis[0] * 0.2, v[1] + bis[1] * 0.2) < here;
      let r = convex ? R : 1;
      const recess = 1 / Math.cos(turn / 2) - 1;
      if (convex && recess > 0) {
        const beside = Math.min(toLots((a[0] + v[0]) / 2, (a[1] + v[1]) / 2), toLots((v[0] + b[0]) / 2, (v[1] + b[1]) / 2));
        r = Math.max(0, Math.min(r, (here - 0.6 * beside) / recess));
      }
      half[i] = Math.tan(turn / 2);
      t[i] = r * half[i];
    }
    // Two corners never share more than the length between them; a line's end may give all of its last length.
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n, L = segLen(i);
      const ti = !closed && i === 0 ? 0 : t[i], tj = !closed && j === n - 1 ? 0 : t[j];
      if (ti + tj > L) { const k2 = L / (ti + tj); t[i] = ti * k2; t[j] = tj * k2; }
    }
    const out: P[] = closed ? [] : [pts[0]];
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const v = at(i);
      if (!(t[i] > 0.01)) { out.push(v); continue; }
      const d1 = unit(at(i - 1), v), d2 = unit(v, at(i + 1)), r = t[i] / half[i];
      const p1: P = [v[0] - d1[0] * t[i], v[1] - d1[1] * t[i]];
      const left = cross(d1, d2) > 0, nrm: P = left ? [-d1[1], d1[0]] : [d1[1], -d1[0]];
      const c: P = [p1[0] + nrm[0] * r, p1[1] + nrm[1] * r];
      const f1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]), turn = 2 * Math.atan(half[i]) * (left ? 1 : -1);
      const steps = Math.max(2, Math.ceil(Math.abs(turn) / ((8 * Math.PI) / 180)));
      for (let s2 = 0; s2 <= steps; s2++) { const f = f1 + (turn * s2) / steps; out.push([c[0] + r * Math.cos(f), c[1] + r * Math.sin(f)]); }
    }
    if (!closed) out.push(pts[n - 1]);
    else out.push(out[0]);
    return out;
  };

  // Open lines from their ends first, then whatever closes on itself.
  const starts = [...links.keys()].sort((a, b) => (links.get(a)!.length === 1 ? 0 : 1) - (links.get(b)!.length === 1 ? 0 : 1));
  for (const k of starts) {
    if (used.has(k)) continue;
    const chain = walk(k);
    const closed = chain.length > 3 && (links.get(chain[chain.length - 1]) ?? []).includes(chain[0]);
    const traced = chain.map((key) => point.get(key)!);
    const tol = Math.max(0.12, 0.75 * cell);
    let straight: P[];
    if (closed) {
      // A loop, simplified in two halves split at its farthest point from the first.
      let far = 0;
      traced.forEach((q, i) => { if (Math.hypot(q[0] - traced[0][0], q[1] - traced[0][1]) > Math.hypot(traced[far][0] - traced[0][0], traced[far][1] - traced[0][1])) far = i; });
      straight = [...simplify(traced.slice(0, far + 1), tol).slice(0, -1), ...simplify([...traced.slice(far), traced[0]], tol).slice(0, -1)];
    } else straight = simplify(traced, tol);
    const pts = fillet(sharpen(straight, closed, 2.5 * cell), closed);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < 5) continue;                           // a scrap
    const mid = pts[Math.floor(pts.length / 2)];
    const c = Math.min(rows - 1, Math.max(0, Math.round((mid[1] - y0) / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.round((mid[0] - x0) / cell)));
    const s = strips[byStrip[c]];
    out.push({ coords: pts.map(toLL), from: s && edges[s.edge].measured ? 'footway' : 'typical' });
  }
  for (const k of osmKerbs) if (k.length >= 2) out.push({ coords: k, from: 'osm' });
  return out;
}

/**
 * The grid clips a sharp corner, leaving two corners a cell or so apart:
 * each such pair is put back as the one corner where the lines either side
 * meet.
 */
function sharpen(pts: P[], closed: boolean, within: number): P[] {
  const out = pts.slice();
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    const n = out.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 2); i++) {
      const a = out[(i - 1 + n) % n], b = out[i], c = out[(i + 1) % n], d = out[(i + 2) % n];
      if (Math.hypot(c[0] - b[0], c[1] - b[1]) > within) continue;
      // Where a–b, run on, meets d–c, run back.
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - d[0], vy = c[1] - d[1];
      const den = ux * vy - uy * vx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((d[0] - a[0]) * vy - (d[1] - a[1]) * vx) / den;
      const x: P = [a[0] + ux * t, a[1] + uy * t];
      if (Math.hypot(x[0] - b[0], x[1] - b[1]) > 2 * within || Math.hypot(x[0] - c[0], x[1] - c[1]) > 2 * within) continue;
      out.splice(i, 2, x);
      if (closed && i === n - 1) out.splice(0, 1);
      changed = true;
      break;
    }
  }
  return out;
}

/** Douglas–Peucker: the line with every point within `tol` of the original kept off. */
function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const dd = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (dd > fd) { fd = dd; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

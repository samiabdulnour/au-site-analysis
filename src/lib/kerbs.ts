// Kerb lines for the site sheet, where no survey has them. NSW publishes no
// kerbs or footpath edges as open data (the state's roads are centre lines
// only, a few metres out), so the kerb is placed from what is known: the
// cadastre's lot boundary is the back of the footpath, and the kerb runs
// parallel to it, one footpath's width out into the road reserve. The width
// is measured where OpenStreetMap maps the footpath (a sidewalk is mapped
// along its middle, so the width is twice its distance from the boundary),
// and is a typical width for the street's class where it is not. A kerb
// OpenStreetMap maps as a line is drawn as it is and takes the place of the
// estimate beside it. The line is traced where the distance out from the
// lots equals the width there, so it runs unbroken along a street and turns
// each corner in an arc. Indicative only: the sheet says so.

/** A kerb line in lon/lat, and how its place was found. */
export interface KerbLine { coords: [number, number][]; from: 'osm' | 'footway' | 'typical' }

interface Road { hierarchy: number; coords: [number, number][] }
type P = [number, number];

/** A footpath's typical width (m) by the street's function: arterial, sub-arterial, collector, local. Lanes have none. */
export function typicalFootpathM(hierarchy: number): number | null {
  return hierarchy <= 3 ? 5 : hierarchy === 4 ? 4.5 : hierarchy === 5 ? 4 : hierarchy === 6 ? 3.5 : null;
}

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

  const segsOf = (lines: P[][], tag: (i: number) => number) => lines.flatMap((l, i) => {
    const m = l.map(toM);
    return m.slice(1).map((b, k) => ({ a: m[k], b, h: tag(i) }));
  });
  const roadSegs = segsOf(roads.map((r) => r.coords), (i) => roads[i].hierarchy);
  const walkSegs = segsOf(sidewalks, () => 0);
  const kerbSegs = segsOf(osmKerbs, () => 0);
  /** The nearest segment to p: its distance, the closest point, its unit direction. */
  const nearest = (p: P, segs: { a: P; b: P; h: number }[], within: number) => {
    let best: { d: number; c: P; u: P; h: number } | null = null;
    for (const { a, b, h } of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (!L2) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
      const c: P = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d < within && (!best || d < best.d)) { const L = Math.sqrt(L2); best = { d, c, u: [dx / L, dy / L], h }; }
    }
    return best;
  };

  // Each outer boundary edge of a lot, with the footpath width its kerb
  // stands at, or none (a lane, a park, a river beside it).
  interface Edge { p: P; q: P; width: number | null; measured: boolean; short?: boolean }
  const edges: Edge[] = [];
  for (const { ring, ccw } of lots) {
    const own: Edge[] = [];
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i - 1], q = ring[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.2) continue;
      const u: P = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      // Outward: to the right of a counter-clockwise ring's edges.
      const n: P = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
      const m: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const at = (d: number): P => [m[0] + n[0] * d, m[1] + n[1] * d];
      if (inLots(at(Math.min(1.2, len / 2)))) continue;   // a boundary between two lots
      const none: Edge = { p, q, width: null, measured: false };
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
      // A street, on this side, running with the boundary; a park or a
      // river beside the lot has no kerb.
      const road = nearest(m, roadSegs, Math.min(45, reserve + 12));
      const typical = road ? typicalFootpathM(road.h) : null;
      if (!road || typical === null || (road.c[0] - m[0]) * n[0] + (road.c[1] - m[1]) * n[1] < 0.5 ||
        Math.abs(u[0] * road.u[0] + u[1] * road.u[1]) < 0.87) { own.push(none); continue; }
      let width = typical, measured = false;
      const walk = nearest(m, walkSegs, 9);
      if (walk && (walk.c[0] - m[0]) * n[0] + (walk.c[1] - m[1]) * n[1] > 0.3 && Math.abs(u[0] * walk.u[0] + u[1] * walk.u[1]) > 0.87) {
        width = Math.max(2, Math.min(7, walk.d * 2));
        measured = true;
      }
      // At least a lane's width of road either side of the middle.
      if (Number.isFinite(reserve)) width = Math.min(width, reserve / 2 - 2.8);
      own.push(width < 1.2 ? none : { p, q, width, measured });
    }
    // A short edge at a corner (a splay, a jog) takes the wider of its
    // neighbours' widths, so the kerb turns the corner unbroken.
    own.forEach((e, k) => {
      if (!e.short) return;
      const ws = [own[(k + own.length - 1) % own.length], own[(k + 1) % own.length]].filter((o) => !o.short && o.width !== null);
      if (ws.length) { e.width = Math.max(...ws.map((o) => o.width!)); e.measured = ws.some((o) => o.measured); }
    });
    edges.push(...own);
  }

  // The kerb is drawn as one line, not edge by edge: it is where the distance
  // out from the lots equals the footpath's width there, so it runs on
  // unbroken along a street, past the mouth of a side street, and turns each
  // corner in an arc. Worked on a grid a quarter of a metre fine: the
  // distance from the lots, the width from the nearest boundary edge, and the
  // line traced where the one meets the other.
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
  // The outer edges, drawn into the grid with their index.
  const seed = new Int32Array(N).fill(-1);
  edges.forEach(({ p, q }, e) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (cell / 2)));
    for (let s2 = 0; s2 <= steps; s2++) {
      const x = p[0] + ((q[0] - p[0]) * s2) / steps, y = p[1] + ((q[1] - p[1]) * s2) / steps;
      const j = Math.round((x - x0) / cell), i = Math.round((y - y0) / cell);
      if (i >= 0 && i < rows && j >= 0 && j < cols) seed[i * cols + j] = e;
    }
  });
  const fromLots = distanceTransform(cols, rows, (c) => inside[c] === 1);
  const toEdge = distanceTransform(cols, rows, (c) => seed[c] >= 0);
  // Mapped kerbs, if any, take their stretch of street from the estimate.
  const toMapped = kerbSegs.length ? distanceTransform(cols, rows, (() => {
    const hit = new Uint8Array(N);
    for (const { a, b } of kerbSegs) {
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2)));
      for (let s2 = 0; s2 <= steps; s2++) {
        const j = Math.round((a[0] + ((b[0] - a[0]) * s2) / steps - x0) / cell), i = Math.round((a[1] + ((b[1] - a[1]) * s2) / steps - y0) / cell);
        if (i >= 0 && i < rows && j >= 0 && j < cols) hit[i * cols + j] = 1;
      }
    }
    return (c: number) => hit[c] === 1;
  })()) : null;

  // The field: distance out from the lots less the width there; the kerb is
  // where it crosses nought. NaN where no kerb is drawn.
  const field = new Float64Array(N);
  const edgeAt = (c: number) => edges[seed[toEdge.source[c]]];
  for (let c = 0; c < N; c++) {
    const e = toEdge.source[c] >= 0 ? edgeAt(c) : undefined;
    // The boundary lies half a cell, on average, past the last cell inside it.
    const d = inside[c] ? -cell : Math.sqrt(fromLots.dist2[c]) * cell - cell / 2;
    const masked = !e || e.width === null || d > 25 || (toMapped && Math.sqrt(toMapped.dist2[c]) * cell < 3);
    field[c] = masked ? NaN : d - (e!.width as number);
  }

  // Marching squares over the field, each crossing keyed by the grid edge it
  // falls on, so the pieces chain into whole lines.
  const point = new Map<number, P>();
  const links = new Map<number, number[]>();
  const cross = (ca: number, cb: number, key: number): number => {
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
      const B = () => cross(c00, c01, 2 * c00), R = () => cross(c01, c11, 2 * c01 + 1);
      const T = () => cross(c10, c11, 2 * c10), L = () => cross(c00, c10, 2 * c00 + 1);
      const centre = (v[0] + v[1] + v[2] + v[3]) / 4;
      switch (code) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(L(), R()); break;
        case 4: case 11: link(R(), T()); break;
        case 6: case 9: link(B(), T()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: if (centre < 0) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(R(), T()); } break;
        case 10: if (centre < 0) { link(L(), B()); link(R(), T()); } else { link(L(), T()); link(B(), R()); } break;
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
  // Open lines from their ends first, then whatever closes on itself.
  const starts = [...links.keys()].sort((a, b) => (links.get(a)!.length === 1 ? 0 : 1) - (links.get(b)!.length === 1 ? 0 : 1));
  for (const k of starts) {
    if (used.has(k)) continue;
    const pts = simplify(walk(k).map((key) => point.get(key)!), 0.08);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len < 5) continue;                           // a stub where two widths meet
    const mid = pts[Math.floor(pts.length / 2)];
    const c = Math.min(rows - 1, Math.max(0, Math.round((mid[1] - y0) / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.round((mid[0] - x0) / cell)));
    out.push({ coords: pts.map(toLL), from: edgeAt(c)?.measured ? 'footway' : 'typical' });
  }
  for (const k of osmKerbs) if (k.length >= 2) out.push({ coords: k, from: 'osm' });
  return out;
}

/**
 * The exact Euclidean distance transform of a grid (Felzenszwalb and
 * Huttenlocher): for every cell, the squared distance in cells to the nearest
 * seed, and which seed that is.
 */
function distanceTransform(cols: number, rows: number, isSeed: (c: number) => boolean): { dist2: Float64Array; source: Int32Array } {
  const BIG = 1e20, N = cols * rows;
  const d1 = new Float64Array(N), r1 = new Int32Array(N);
  const n = Math.max(cols, rows);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n), at = new Int32Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -BIG; z[1] = BIG;
    for (let q = 1; q < len; q++) {
      let s2 = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s2 <= z[k]) { k--; s2 = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s2; z[k + 1] = BIG;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
      at[q] = v[k];
    }
  };
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) f[i] = isSeed(i * cols + j) ? 0 : BIG;
    pass(rows);
    for (let i = 0; i < rows; i++) { d1[i * cols + j] = d[i]; r1[i * cols + j] = at[i]; }
  }
  const dist2 = new Float64Array(N), source = new Int32Array(N);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) f[j] = d1[i * cols + j];
    pass(cols);
    for (let j = 0; j < cols; j++) {
      const q = at[j];
      dist2[i * cols + j] = d[j];
      source[i * cols + j] = d[j] >= BIG / 2 ? -1 : r1[i * cols + q] * cols + q;
    }
  }
  return { dist2, source };
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

// Kerb lines for the site sheet, where no survey has them. NSW publishes no
// kerbs or footpath edges as open data (the state's roads are centre lines
// only, a few metres out), so the kerb is placed from what is known: the
// cadastre's lot boundary is the back of the footpath, and the kerb runs
// parallel to it, one footpath's width out into the road reserve. The width
// is measured where OpenStreetMap maps the footpath (a sidewalk is mapped
// along its middle, so the width is twice its distance from the boundary),
// and is a typical width for the street's class where it is not. A kerb
// OpenStreetMap maps as a line is drawn as it is and takes the place of the
// estimate beside it. Indicative only: the sheet says so.

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

  const out: KerbLine[] = [];
  for (const { ring, ccw } of lots) {
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i - 1], q = ring[i];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1.5) continue;
      const u: P = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
      // Outward: to the right of a counter-clockwise ring's edges.
      const n: P = ccw ? [u[1], -u[0]] : [-u[1], u[0]];
      const m: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const at = (d: number): P => [m[0] + n[0] * d, m[1] + n[1] * d];
      if (inLots(at(1.2))) continue;                 // a boundary between two lots
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
      if (!road || (road.c[0] - m[0]) * n[0] + (road.c[1] - m[1]) * n[1] < 0.5) continue;
      if (Math.abs(u[0] * road.u[0] + u[1] * road.u[1]) < 0.87) continue;
      const typical = typicalFootpathM(road.h);
      if (typical === null) continue;
      let width = typical, from: KerbLine['from'] = 'typical';
      const walk = nearest(m, walkSegs, 9);
      if (walk && (walk.c[0] - m[0]) * n[0] + (walk.c[1] - m[1]) * n[1] > 0.3 && Math.abs(u[0] * walk.u[0] + u[1] * walk.u[1]) > 0.87) {
        width = Math.max(2, Math.min(7, walk.d * 2));
        from = 'footway';
      }
      // At least a lane's width of road either side of the middle.
      if (Number.isFinite(reserve)) width = Math.min(width, reserve / 2 - 2.8);
      if (width < 1.2 || inLots(at(width))) continue;
      const a: P = [p[0] + n[0] * width, p[1] + n[1] * width], b: P = [q[0] + n[0] * width, q[1] + n[1] * width];
      if (kerbSegs.length && nearest(at(width), kerbSegs, 3)) continue;   // a mapped kerb is here
      out.push({ coords: [toLL(a), toLL(b)], from });
    }
  }
  for (const k of osmKerbs) if (k.length >= 2) out.push({ coords: k, from: 'osm' });
  return out;
}

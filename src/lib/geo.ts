// Web Mercator (EPSG:3857) helpers and shared geometry types.

export interface XY { x: number; y: number }
export interface LonLat { lon: number; lat: number }
export interface Extent { xmin: number; ymin: number; xmax: number; ymax: number }

const R = 20037508.342789244;

export function lonLatToMercator(p: LonLat): XY {
  return {
    x: (p.lon * R) / 180,
    y: (Math.log(Math.tan(((90 + p.lat) * Math.PI) / 360)) / (Math.PI / 180)) * (R / 180),
  };
}

export function mercatorToLonLat(p: XY): LonLat {
  return {
    lon: (p.x / R) * 180,
    lat: (Math.atan(Math.exp((((p.y / R) * 180) * Math.PI) / 180)) * 360) / Math.PI - 90,
  };
}

/** Ground meters per mercator meter at latitude (mercator stretches with 1/cos(lat)). */
export function mercatorScaleFactor(lat: number): number {
  return 1 / Math.cos((lat * Math.PI) / 180);
}

/**
 * Sheet extent in EPSG:3857 for a map field of widthMm × heightMm at 1:scale,
 * centered on `center`. Accounts for mercator distortion so the printed scale
 * is true on the ground.
 */
export function sheetExtent(center: XY, widthMm: number, heightMm: number, scale: number): Extent {
  const lat = mercatorToLonLat(center).lat;
  const k = mercatorScaleFactor(lat);
  const wm = ((widthMm / 1000) * scale) * k;
  const hm = ((heightMm / 1000) * scale) * k;
  return {
    xmin: center.x - wm / 2,
    ymin: center.y - hm / 2,
    xmax: center.x + wm / 2,
    ymax: center.y + hm / 2,
  };
}

export function extentToLonLatBbox(e: Extent): { south: number; west: number; north: number; east: number } {
  const sw = mercatorToLonLat({ x: e.xmin, y: e.ymin });
  const ne = mercatorToLonLat({ x: e.xmax, y: e.ymax });
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

/** Centroid of the first/outer ring of a (multi)polygon in GeoJSON coords. */
export function ringCentroid(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return [ring[0][0], ring[0][1]];
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

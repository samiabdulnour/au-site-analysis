/* The north-align turn: whatever the site's shape and bearing, turning the
 * sheet by the returned angle lays the site with its long side horizontal.
 * Made-up lots near Burwood, no network.
 *
 *   npx tsx test/site-rotation.mts
 */

import { siteLongEdgeDeg } from '../src/pipeline.js';
import { lonLatToMercator, mercatorToLonLat } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

const C = lonLatToMercator({ lon: 151.104, lat: -33.877 });
// A lot drawn in metres about the centre, turned by `deg` (counter-clockwise, east = 0°).
const lot = (shape: [number, number][], deg: number) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const ring = shape.map(([x, y]) => { const p = mercatorToLonLat({ x: C.x + x * c - y * s, y: C.y + x * s + y * c }); return [p.lon, p.lat]; });
  ring.push(ring[0]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] } as any;
};
const rect = (w: number, h: number): [number, number][] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
// Width and height of the lot once the sheet is turned by `deg`, as the pipeline turns it.
const extent = (fc: any, deg: number) => {
  const r = (-deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const pts = fc.features[0].geometry.coordinates[0].map(([lon, lat]: number[]) => lonLatToMercator({ lon, lat }));
  const xs = pts.map((p: any) => (p.x - C.x) * c - (p.y - C.y) * s), ys = pts.map((p: any) => (p.x - C.x) * s + (p.y - C.y) * c);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const lying = (name: string, fc: any) => {
  const deg = siteLongEdgeDeg(fc);
  const { w, h } = extent(fc, deg);
  check(`${name}: long side horizontal`, w > h * 1.2, `turn ${deg.toFixed(1)}°, ${w.toFixed(1)} × ${h.toFixed(1)} m`);
  check(`${name}: turn within (-90°, 90°]`, deg > -90 && deg <= 90, `${deg}`);
  return deg;
};

// A deep suburban lot running north–south: the old rule kept it upright.
const deep = lying('deep lot, north–south', lot(rect(20, 60), 0));
check('deep lot turns a quarter', Math.abs(Math.abs(deep) - 90) < 0.5, `${deep}`);
// Already lying east–west: no turn.
const wide = lying('wide lot, east–west', lot(rect(60, 20), 0));
check('wide lot stays', Math.abs(wide) < 0.5, `${wide}`);
// Long side at 70° and at -70°: both beyond the old ±45° fold.
lying('lot at 70°', lot(rect(60, 20), 70));
lying('lot at -70°', lot(rect(60, 20), -70));
lying('lot at 30°', lot(rect(60, 20), 30));
// An L-shaped lot whose longest single edge is not its long axis.
lying('L-shaped lot', lot([[0, 0], [70, 0], [70, 15], [12, 15], [12, 30], [0, 30]], 55));

if (failures.length) {
  console.error(`${failures.length} failure(s):\n  ` + failures.join('\n  '));
  process.exit(1);
}
console.log('site rotation: all checks passed');

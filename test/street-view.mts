/* Slide 12's Street View planner on made-up ground, with a stand-in for
 * Google's metadata service: which sides of a site count as street
 * frontages, which cameras are set aside as standing in a shop or behind a
 * neighbour, and the URLs the frames are fetched and linked with. No
 * network: CI never calls Google.
 *
 *   npx tsx test/street-view.mts
 */

import { planStreetViews, siteEdges, landDepth, signUrl, imageUrl, mapsUrl, metadataService, type SvMeta, type SvView } from '../src/fetch/streetView.js';
import type { LonLat } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// A metre grid about a Sydney point, in the planner's own flat frame.
const O: LonLat = { lon: 151.2, lat: -33.9 };
const KX = 111_320 * Math.cos((O.lat * Math.PI) / 180), KY = 110_574;
const ll = (x: number, y: number): [number, number] => [O.lon + x / KX, O.lat + y / KY];
const xy = (p: LonLat) => ({ x: (p.lon - O.lon) * KX, y: (p.lat - O.lat) * KY });
const rect = (x0: number, y0: number, x1: number, y1: number): number[][] => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
const angDiff = (a: number, b: number) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return d > 180 ? 360 - d : d; };

// The site: 20 m east-west by 30 m north-south, centred on the origin.
const SITE = [rect(-10, -15, 10, 15)];

/**
 * Streets as lines of panoramas every 10 m, the car's path down the middle:
 * the service answers with the nearest within the radius, as Google's does.
 */
type Street = { from: [number, number]; to: [number, number] };
function fakeMeta(streets: Street[], extra: { x: number; y: number; id: string }[] = []) {
  const panos: { x: number; y: number; id: string }[] = [...extra];
  for (const [si, s] of streets.entries()) {
    const len = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
    for (let d = 0; d <= len; d += 10) panos.push({ x: s.from[0] + ((s.to[0] - s.from[0]) * d) / len, y: s.from[1] + ((s.to[1] - s.from[1]) * d) / len, id: `s${si}_${d}` });
  }
  const asked: { x: number; y: number }[] = [];
  const meta = async (p: LonLat, radiusM: number): Promise<SvMeta | null> => {
    const q = xy(p);
    asked.push(q);
    let best: { x: number; y: number; id: string } | null = null, bd = Infinity;
    for (const c of panos) { const d = Math.hypot(c.x - q.x, c.y - q.y); if (d <= radiusM && d < bd) { bd = d; best = c; } }
    if (!best) return null;
    const [lon, lat] = ll(best.x, best.y);
    return { panoId: best.id, lon, lat, date: '2024-08', copyright: '© Google' };
  };
  return { meta, asked };
}
const kinds = (vs: SvView[]) => vs.map((v) => v.kind).join(',');

// ---- the site's sides ------------------------------------------------------------

const edges = siteEdges(SITE.map((r) => r.map(([lon, lat]) => xy({ lon, lat }))));
check('a rectangle has four sides', edges.length === 4, `got ${edges.length}`);
check('each side\'s normal points out of the site', edges.every((e) => Math.hypot(e.mid.x + e.normal.x, e.mid.y + e.normal.y) > Math.hypot(e.mid.x, e.mid.y)));

// ---- one street, to the south ---------------------------------------------------------

{
  const { meta } = fakeMeta([{ from: [-80, -23], to: [80, -23] }]);
  const r = await planStreetViews(SITE, O, meta);
  check('one street: one frontage of four sides', r.frontages === 1 && r.sides === 4, `${r.frontages} of ${r.sides}`);
  const f = r.views.find((v) => v.kind === 'frontage');
  check('one street: the frontage frame looks north at the site', !!f && angDiff(f.heading, 0) < 5, `heading ${f?.heading}`);
  check('one street: its field of view takes the 20 m side in from 8 m', !!f && f.fov >= 55 && f.fov <= 100, `fov ${f?.fov}`);
  check('one street: a short frontage has no obliques and no corner', !r.views.some((v) => v.kind === 'oblique' || v.kind === 'corner'), kinds(r.views));
  const along = r.views.filter((v) => v.kind === 'street');
  check('one street: the street both ways from the frontage camera', along.length === 2 && along.some((v) => angDiff(v.heading, 90) < 5) && along.some((v) => angDiff(v.heading, 270) < 5), along.map((v) => v.heading).join(','));
  check('one street: nothing set aside', r.offStreet === 0, `${r.offStreet}`);
}

// ---- a corner site, streets south and east, the block's other lots built on to the north and west ----

{
  const { meta } = fakeMeta([{ from: [-80, -23], to: [80, -23] }, { from: [18, -80], to: [18, 80] }]);
  const block = { lots: [rect(-10, 15, 10, 45), rect(-40, -15, -10, 15), rect(-40, 15, -10, 45)], buildings: [rect(-8, 17, 8, 43), rect(-38, -13, -12, 13), rect(-38, 17, -12, 43)] };
  const r = await planStreetViews(SITE, O, meta, block);
  check('corner: two frontages', r.frontages === 2, `${r.frontages}`);
  const c = r.views.find((v) => v.kind === 'corner');
  check('corner: a frame of the south-east corner, looking north-west at it', !!c && angDiff(c.heading, 315) < 20, `heading ${c?.heading}`);
  check('corner: frontages come first', r.views[0].kind === 'frontage' && r.views[1].kind === 'frontage', kinds(r.views));
  check('corner: six frames at most', r.views.length <= 6, `${r.views.length}`);
}

// ---- a long frontage gets obliques ---------------------------------------------------

{
  const LONG = [rect(-25, -10, 25, 10)];
  const { meta } = fakeMeta([{ from: [-100, -18], to: [100, -18] }]);
  const r = await planStreetViews(LONG, O, meta);
  const ob = r.views.filter((v) => v.kind === 'oblique');
  check('long frontage: two obliques along a 50 m side', ob.length === 2, kinds(r.views));
  check('long frontage: the obliques look back along it from either end', ob.some((v) => xy(v).x > 0 && v.heading > 270) && ob.some((v) => xy(v).x < 0 && v.heading < 90), ob.map((v) => `${Math.round(xy(v).x)}:${v.heading}`).join(' '));
}

// ---- cameras on private land and sight lines through a neighbour are set aside -------------

{
  // Google's "outdoor" panorama inside the shop next door: the only one near the east side
  const shop = { x: 22, y: 0, id: 'shop' };
  const { meta } = fakeMeta([], [shop]);
  const lots = [rect(10, -15, 40, 15)];                 // the neighbour's lot, east of the site
  const r = await planStreetViews(SITE, O, meta, { lots });
  check('shop: a camera 12 m inside the neighbour\'s lot is no frontage', r.frontages === 0 && r.offStreet >= 1, `${r.frontages} frontages, ${r.offStreet} set aside`);
  const withoutLots = await planStreetViews(SITE, O, fakeMeta([], [shop]).meta);
  check('shop: without the cadastre it would have counted', withoutLots.frontages === 1, `${withoutLots.frontages}`);
  const inBuilding = await planStreetViews(SITE, O, fakeMeta([], [shop]).meta, { buildings: [rect(15, -8, 30, 8)] });
  check('shop: a camera inside a footprint is set aside even with no lot', inBuilding.frontages === 0 && inBuilding.offStreet >= 1, `${inBuilding.frontages}`);
}
{
  // the street is east, but a row of shops stands between it and the site
  const { meta } = fakeMeta([{ from: [40, -80], to: [40, 80] }]);
  const r = await planStreetViews(SITE, O, meta, { lots: [rect(10, -40, 33, 40)], buildings: [rect(12, -40, 31, 40)] });
  check('behind shops: no frontage through a neighbour\'s building', r.frontages === 0, `${r.frontages} frontages, ${kinds(r.views)}`);
}
{
  // a 6 m strip lot between the site and the street (a footpath or road widening): the site is still seen across it
  const { meta } = fakeMeta([{ from: [-80, -27], to: [80, -27] }]);
  const r = await planStreetViews(SITE, O, meta, { lots: [rect(-60, -21, 60, -15)] });
  check('strip lot: a footpath strip does not hide the frontage', r.frontages === 1, `${r.frontages} frontages, ${r.offStreet} set aside`);
}
{
  // the site's own lots are in the cadastre too, and must not count against it
  const { meta } = fakeMeta([{ from: [-80, -23], to: [80, -23] }]);
  const r = await planStreetViews(SITE, O, meta, { lots: SITE, buildings: [rect(-9, -14, 9, 14)] });
  check('own lot and building: the site does not hide itself', r.frontages === 1 && r.offStreet === 0, `${r.frontages} frontages, ${r.offStreet} set aside`);
}

// ---- how deep a point is inside other lots --------------------------------------------------

{
  const P = (x: number, y: number) => ({ x, y });
  const depth = landDepth([[P(0, 0), P(20, 0), P(20, 10), P(0, 10), P(0, 0)]], []);
  check('depth: in the street is zero', depth(P(-5, 5)) === 0);
  check('depth: the middle of a 10 m wide lot is 5 m in', Math.abs(depth(P(10, 5)) - 5) < 1e-9, `${depth(P(10, 5))}`);
  check('depth: a metre inside the boundary is a metre', Math.abs(depth(P(1, 5)) - 1) < 1e-9, `${depth(P(1, 5))}`);
  const ownOnly = landDepth([[P(0, 0), P(20, 0), P(20, 10), P(0, 10), P(0, 0)]], [[P(0, 0), P(20, 0), P(20, 10), P(0, 10), P(0, 0)]]);
  check('depth: the site\'s own lot is not another lot', ownOnly(P(10, 5)) === 0);
}

// ---- the URLs ----------------------------------------------------------------------------

// Google's signing recipe, computed independently with its Python sample's hmac and base64.
const toSign = 'https://maps.googleapis.com/maps/api/streetview?size=640x372&pano=CAoSLEFGMVFpcE1&heading=203.4&pitch=8.0&fov=100&return_error_code=true&key=TEST_KEY';
check('signing: matches Google\'s recipe', signUrl(toSign, 'chaRF2hTJKOScPr-RQCEhZbSzIE=') === `${toSign}&signature=VTsm3bM4SQLUpTUR4RzzZzIdJLQ=`, signUrl(toSign, 'chaRF2hTJKOScPr-RQCEhZbSzIE='));
check('signing: no secret, no signature', signUrl(toSign) === toSign);
const v: SvView = { panoId: 'CAoSLEFGMVFpcE1', lon: 151.2, lat: -33.9, heading: 203.4, pitch: 8, fov: 100, kind: 'frontage', distanceM: 10 };
check('image URL: the frame at the grid cell\'s shape, key last', imageUrl(v, 'TEST_KEY') === toSign, imageUrl(v, 'TEST_KEY'));
check('maps link: carries no key', !mapsUrl(v).includes('key') && mapsUrl(v).includes('pano=CAoSLEFGMVFpcE1'), mapsUrl(v));

// ---- the metadata service's answers, with fetch stood in for ------------------------------------

{
  const realFetch = globalThis.fetch;
  const answer = (body: object) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch; };
  const meta = metadataService('SECRET_KEY_123');
  answer({ status: 'OK', pano_id: 'abc', location: { lat: -33.9, lng: 151.2 }, date: '2024-08', copyright: '© Google' });
  const ok = await meta({ lon: 151.2, lat: -33.9 }, 25);
  check('metadata: OK gives the panorama', ok?.panoId === 'abc' && ok.lon === 151.2 && ok.date === '2024-08', JSON.stringify(ok));
  answer({ status: 'ZERO_RESULTS' });
  check('metadata: ZERO_RESULTS is no panorama', (await meta({ lon: 151.2, lat: -33.9 }, 25)) === null);
  answer({ status: 'REQUEST_DENIED', error_message: 'This API is not activated on your API project.' });
  let thrown = '';
  try { await meta({ lon: 151.2, lat: -33.9 }, 25); } catch (e) { thrown = (e as Error).message; }
  check('metadata: REQUEST_DENIED stops the source with Google\'s reason', /REQUEST_DENIED: This API is not activated/.test(thrown), thrown);
  check('metadata: the error never carries the key', !thrown.includes('SECRET_KEY_123'), thrown);
  globalThis.fetch = realFetch;
}

if (failures.length) {
  console.error(`street view: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('street view: all checks passed');

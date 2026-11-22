/* How a map layer is asked (src/lib/arcgis.ts): a short query in the request's
 * address, a long one in its body. The NSW spatial portal's web server answers
 * 404 to a query string over 2,048 characters, so a multipoint of 80
 * institutions never reached the layer and a wide context sheet drew without
 * its schools' and hospitals' grounds. The layer is stood in for; no network.
 *
 *   npx tsx test/arcgis-query.mts
 */

import { LONG_QUERY, queryByExtent, queryByGeometry } from '../src/lib/arcgis.js';
import { fetchPropertiesAt } from '../src/fetch/nswTopo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failures.push(`${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

interface Asked { url: string; method: string; body: string; type: string }
const asked: Asked[] = [];
/** A layer that answers each request with one property, and says more remain until `pages` have been given. */
let pages = 1;
const real = globalThis.fetch;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const body = typeof init?.body === 'string' ? init.body : '';
  asked.push({ url, method: init?.method ?? 'GET', body, type: new Headers(init?.headers).get('content-type') ?? '' });
  const params = new URLSearchParams(body || url.split('?')[1] || '');
  const offset = Number(params.get('resultOffset') ?? 0);
  return new Response(JSON.stringify({ features: [{ attributes: { propid: 100 + offset }, geometry: { rings: [[[151, -33.8], [151.001, -33.8], [151.001, -33.799], [151, -33.8]]] } }], exceededTransferLimit: offset + 1 < pages }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const LAYER = 'https://example.test/arcgis/rest/services/Layer/FeatureServer/12';
const points = (n: number) => ({ points: Array.from({ length: n }, (_, i) => [151 + i * 0.0001234, -33.8 - i * 0.0001234]), spatialReference: { wkid: 4326 } });

// a short query: in the address, as it always was
await queryByGeometry(LAYER, points(5), 'esriGeometryMultipoint', 'propid');
check('five points are asked in the address', asked.length === 1 && asked[0].method === 'GET' && asked[0].url.startsWith(`${LAYER}/query?`) && asked[0].url.includes('geometryType=esriGeometryMultipoint') && asked[0].body === '', asked[0]);
check('and that address is under the limit', asked[0].url.split('?')[1].length <= LONG_QUERY, asked[0].url.length);

// a long query: in the body
asked.length = 0;
const many = await queryByGeometry(LAYER, points(120), 'esriGeometryMultipoint', 'propid');
const a = asked[0];
const sent = new URLSearchParams(a?.body ?? '');
check('a hundred and twenty points are posted, the address bare', asked.length === 1 && a.method === 'POST' && a.url === `${LAYER}/query` && a.type === 'application/x-www-form-urlencoded', { method: a?.method, url: a?.url, type: a?.type });
check('the body is the same query: the points, their type, the fields, lon/lat out', JSON.parse(sent.get('geometry') ?? '{}').points?.length === 120 && sent.get('geometryType') === 'esriGeometryMultipoint' && sent.get('outFields') === 'propid' && sent.get('outSR') === '4326' && sent.get('f') === 'json' && sent.get('spatialRel') === 'esriSpatialRelIntersects', [...sent.keys()]);
check('that query would have been refused in the address: over 2,048 characters', a.body.length > 2048, a?.body.length);
check('its answer is read as any other', many.features.length === 1 && many.features[0].properties.propid === 100 && many.features[0].geometry?.type === 'Polygon');

// the institutions' properties, as the context sheet asks for them
asked.length = 0;
await fetchPropertiesAt(Array.from({ length: 90 }, (_, i) => ({ lon: 151 + i * 0.0003, lat: -33.81 - i * 0.0002 })));
check('ninety institutions\' properties are asked in one post, not refused', asked.length === 1 && asked[0].method === 'POST' && /NSW_Land_Parcel_Property_Theme\/FeatureServer\/12\/query$/.test(asked[0].url), asked.map((x) => `${x.method} ${x.url.slice(-40)}`));
asked.length = 0;
await fetchPropertiesAt([{ lon: 151, lat: -33.81 }]);
check('one institution\'s is still asked in the address', asked.length === 1 && asked[0].method === 'GET');

// an answer cut at the layer's limit: the rest is asked for
asked.length = 0; pages = 3;
const paged = await queryByGeometry(LAYER, points(120), 'esriGeometryMultipoint', 'propid');
check('a multipoint answer cut short is asked for again from where it stopped', asked.length === 3 && paged.features.map((f) => f.properties.propid).join() === '100,101,102' && new URLSearchParams(asked[2].body).get('resultOffset') === '2' && !new URLSearchParams(asked[0].body).has('resultOffset'), asked.map((x) => new URLSearchParams(x.body).get('resultOffset')));
pages = 1;

// a window: short, in the address
asked.length = 0;
await queryByExtent(LAYER, { xmin: 16800000, ymin: -4005000, xmax: 16801000, ymax: -4004000 }, 'propid');
check('a window is asked in the address', asked.length === 1 && asked[0].method === 'GET' && asked[0].url.includes('esriGeometryEnvelope'));

globalThis.fetch = real;
if (failures.length) { console.error(`arcgis-query: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('arcgis-query: short queries in the address, long ones posted, cut answers paged; all checks pass');

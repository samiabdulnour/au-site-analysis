/* A download read whole (fetchBytes, src/lib/http.ts): a connection cut while
 * the body is still arriving is tried again, where the first headers were all
 * retryFetch waited for. The deck's elevation model is read this way: one
 * dropped connection cost a deck its topography page. The server is stood in
 * for; no network.
 *
 *   npx tsx test/download.mts
 */

import { fetchBytes } from '../src/lib/http.js';
import { fetchDemGrid } from '../src/fetch/terrain.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failures.push(`${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

/** A body that sends a few bytes and is then cut, as undici reports a dropped connection. */
const cut = () => new Response(new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(new Uint8Array([1, 2, 3])); },
  pull(c) { c.error(new TypeError('terminated')); },
}), { status: 200 });
const whole = (bytes: number[]) => new Response(new Uint8Array(bytes), { status: 200 });

const real = globalThis.fetch;
let calls = 0;
const serve = (answers: (() => Response)[]) => { calls = 0; globalThis.fetch = (async () => answers[Math.min(calls++, answers.length - 1)]()) as typeof fetch; };
const quick = { baseDelayMs: 1, attempts: 1, timeoutMs: 5000, label: 'the made-up file' };

serve([cut, () => whole([9, 8, 7, 6])]);
const got = await fetchBytes('https://example.test/a.tif', quick);
check('a download cut part-way is read again, whole', calls === 2 && [...got].join() === '9,8,7,6', { calls, got: [...got] });

serve([() => whole([5, 5])]);
check('one that arrives whole is asked for once', [...await fetchBytes('https://example.test/b.tif', quick)].join() === '5,5' && calls === 1, calls);

serve([cut]);
let said = '';
try { await fetchBytes('https://example.test/c.tif', quick); } catch (e: any) { said = String(e?.message ?? e); }
check('cut every time, it gives up after three tries and says what was being read', calls === 3 && /the made-up file was cut off while downloading \(3 tries\): terminated/.test(said), `${calls} ${said}`);

serve([() => new Response('no', { status: 404 })]);
said = '';
try { await fetchBytes('https://example.test/d.tif', quick); } catch (e: any) { said = String(e?.message ?? e); }
check('a refusal is not tried again: it is the caller\'s to judge', calls === 1 && said === 'the made-up file HTTP 404', `${calls} ${said}`);

serve([cut, cut, () => whole([1])]);
check('the number of tries can be said', [...await fetchBytes('https://example.test/e.tif', { ...quick, reads: 5 })].join() === '1' && calls === 3, calls);

// The elevation model goes through it: cut once, then a body that is no image reads as "no model", not as a failure.
serve([cut, () => whole([0, 1, 2, 3])]);
const dem = await fetchDemGrid({ xmin: 16800000, ymin: -4005000, xmax: 16800200, ymax: -4004800 });
check('the elevation model is asked for again after a cut', calls === 2 && dem === null, { calls, dem });

globalThis.fetch = real;
if (failures.length) { console.error(`download: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('download: a cut transfer is read again, a refusal is not; all checks pass');

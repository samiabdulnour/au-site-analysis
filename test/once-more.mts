/* A task tried once more after a pause (src/lib/onceMore.ts): the samples run
 * gives each drawing a second try, so one public service's bad minute does not
 * cost a run of twenty drawings.
 *
 *   npx tsx test/once-more.mts
 */

import { onceMore } from '../src/lib/onceMore.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failures.push(`${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

let calls = 0; const said: string[] = [];
const opts = { waitMs: 5, onFail: (why: string) => said.push(why) };

calls = 0; said.length = 0;
check('a task that works is run once and nothing is said', await onceMore(async () => { calls++; return 'drawn'; }, opts) === 'drawn' && calls === 1 && said.length === 0, { calls, said });

calls = 0; said.length = 0;
const t0 = Date.now();
const second = await onceMore(async () => { if (++calls === 1) throw new Error('The NSW address register did not answer in time.\n    at geocode'); return 'drawn'; }, opts);
check('one that fails is run again after the pause, and its first line is said', second === 'drawn' && calls === 2 && said.join() === 'The NSW address register did not answer in time.' && Date.now() - t0 >= 4, { calls, said });

calls = 0; said.length = 0;
let thrown = '';
try { await onceMore(async () => { calls++; throw new Error(`still down ${calls}`); }, opts); } catch (e: any) { thrown = e.message; }
check('one that fails twice fails, with its second reason, after two tries and no more', calls === 2 && thrown === 'still down 2' && said.join() === 'still down 1', { calls, thrown, said });

if (failures.length) { console.error(`once-more: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('once-more: a failed task is tried once more, then fails; all checks pass');

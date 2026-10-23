/* The slots of src/lib/slots.ts hold across processes, as the worker pool needs.
 *
 * Six children are forked, as the server forks workers, and each asks for a
 * slot of one limited host four times, holding each for a moment. The server's
 * side counts how many are inside at once, which must reach the limit and never
 * pass it. One more child takes a slot and dies holding it, without releasing:
 * the others must still all get through, which they would not if a dead
 * worker's slot stayed taken. Then the same limit in one process, with no
 * parent, as the CLI uses it. Nothing is fetched.
 *
 *   npx tsx test/slots.mts
 */

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = 'host:example.org';
process.env.UPSTREAM_LIMITS = 'example.org=3';
const { acquire, serveSlots, slotState, slotLimit } = await import('../src/lib/slots.ts');
const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- as a child: a worker asking for slots ------------------------------------
if (process.env.SLOTS_CHILD) {
  const rounds = Number(process.env.SLOTS_CHILD);
  if (rounds === 0) {
    await acquire(HOST);          // taken, and never given back
    process.exit(3);
  }
  for (let i = 0; i < rounds; i++) {
    const release = await acquire(HOST);
    process.send!({ inside: 1 });
    await nap(40);
    process.send!({ inside: -1 });
    release();
  }
  process.send!({ finished: true }, () => process.exit(0));
  await new Promise(() => {});
}

// ---- as the server ----------------------------------------------------------------
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

check(slotLimit(HOST) === 3, 'UPSTREAM_LIMITS sets the one host');
check(slotLimit('host:overpass-nsw') === Infinity, 'a container name on our own network is not counted');
check(slotLimit('host:127.0.0.1:12345') === Infinity, 'this machine is not counted');
check(slotLimit('host:maps.six.nsw.gov.au') === 16, 'any other host has the default');

const self = fileURLToPath(import.meta.url);
const spawnChild = (rounds: number) => {
  const child = fork(self, [], { execArgv: ['--import', 'tsx'], env: { ...process.env, SLOTS_CHILD: String(rounds) } });
  serveSlots(child);
  return child;
};

// The one that dies holding a slot goes first, so it is holding it when the rest ask.
const dead = spawnChild(0);
const deadExit = new Promise<number | null>((r) => dead.once('exit', (code) => r(code)));
check(await deadExit === 3, 'a worker can die holding a slot');

let inside = 0, peak = 0, finished = 0;
const children = Array.from({ length: 6 }, () => spawnChild(4));
await Promise.race([
  Promise.all(children.map((c) => new Promise<void>((resolve) => {
    c.on('message', (m: any) => {
      if (m.inside) { inside += m.inside; peak = Math.max(peak, inside); }
      if (m.finished) finished++;
    });
    c.once('exit', () => resolve());
  }))),
  nap(30_000).then(() => { for (const c of children) c.kill(); }),
]);
check(finished === 6, `every worker got all its slots (${finished} of 6 finished)`);
check(peak <= 3, `never more than the limit inside at once (peak ${peak})`);
check(peak === 3, 'the limit is reached, not undershot');
check(Object.keys(slotState()).length === 0, 'nothing is left held or waiting');

// ---- in one process, as the CLI has it ------------------------------------------------
{
  let now = 0, top = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    // Not through acquire(): this process has a parent channel only when forked,
    // and here it is the parent, so acquire() already takes the local count.
    const release = await acquire(HOST);
    now++; top = Math.max(top, now);
    await nap(10);
    now--;
    release();
    release();      // twice is harmless
  }));
  check(top === 3, `one process keeps the same limit (peak ${top})`);
  check(Object.keys(slotState()).length === 0, 'and gives every slot back');
}

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');

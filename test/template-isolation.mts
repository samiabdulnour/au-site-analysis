/* Two renders with different templates must not see each other's.
 *
 * The active template was a module-level global until recently, safe only
 * because the server renders one sheet at a time. Two concurrent renders would
 * not have thrown: the second's setTemplate would have changed the palette out
 * from under the first, and out would have come a sheet in the wrong house
 * style — silently, and only when a public job and an office job overlapped.
 *
 * So this checks both mechanisms. The old one has to fail, or the test is
 * asserting nothing; the new one has to pass.
 *
 *   npx tsx test/template-isolation.mts
 */

import { setTemplate, withTemplate, tpl } from '../src/render/template.js';

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stands in for a render: reads the active template repeatedly, across awaits. */
async function render(expect: string, seen: string[]) {
  for (let i = 0; i < 4; i++) {
    await nap(10);
    const got = tpl().id;
    if (got !== expect) seen.push(`wanted ${expect}, saw ${got}`);
  }
}

// The old way: one global, set per job. Interleaved, they trample each other.
const old: string[] = [];
await Promise.all([
  (async () => { setTemplate('fuse'); await render('fuse', old); })(),
  (async () => { await nap(5); setTemplate('neutral'); await render('neutral', old); })(),
]);

// The new way: per async context. Each keeps its own across every await.
const now: string[] = [];
await Promise.all([
  withTemplate('fuse', () => render('fuse', now)),
  (async () => { await nap(5); return withTemplate('neutral', () => render('neutral', now)); })(),
]);

console.log(`  setTemplate  — ${old.length} contamination(s), expected some`);
console.log(`  withTemplate — ${now.length} contamination(s), expected none`);
for (const l of now.slice(0, 5)) console.log(`      ${l}`);

if (now.length) {
  console.error('FAIL: concurrent renders saw each other\'s template');
  process.exit(1);
}
if (!old.length) {
  // Not a pass. If the old mechanism no longer contaminates, this test has
  // stopped exercising the thing it exists for — most likely the interleaving
  // above stopped interleaving — and it would go on passing for a change that
  // reintroduced the bug.
  console.error('FAIL: the old mechanism did not contaminate, so this test proves nothing');
  process.exit(1);
}
console.log('  ok — the old mechanism leaks, the new one does not');

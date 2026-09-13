/* Two renders with different templates must not see each other's.
 *
 * The active template was a module-level global until recently, safe only
 * because the server renders one sheet at a time. Two concurrent renders would
 * not have thrown: the second's setTemplate would have changed the palette out
 * from under the first, and out would have come a sheet in the wrong house
 * style — silently, and only when two jobs overlapped.
 *
 * This used to prove itself by running the same interleaving through the old
 * mechanism and requiring it to leak. That is no longer expressible: only one
 * template is registered now, so setTemplate cannot produce two different
 * actives to trample each other with, and the demonstration would pass
 * vacuously.
 *
 * So the guarantee is made a different way. The two templates are fixtures
 * carrying ids no registered template has, and the test first proves those ids
 * are distinguishable from the ambient default. If withTemplate ever stops
 * isolating, tpl() falls back to that default — which is neither fixture — and
 * every read is caught.
 *
 *   npx tsx test/template-isolation.mts
 */

import { TEMPLATES, withTemplate, tpl } from '../src/render/template.js';

const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Two templates that differ only in the one thing being observed. Built from a
// real one so every field a renderer might touch is present.
const A = { ...TEMPLATES[0], id: 'fixture-a' };
const B = { ...TEMPLATES[0], id: 'fixture-b' };

/** Stands in for a render: reads the active template repeatedly, across awaits. */
async function render(expect: string, seen: string[]) {
  for (let i = 0; i < 4; i++) {
    await nap(10);
    const got = tpl().id;
    if (got !== expect) seen.push(`wanted ${expect}, saw ${got}`);
  }
}

// The fixtures must be detectable. Outside any withTemplate, tpl() is whatever
// the process-wide fallback holds — and if that already matched a fixture id,
// the isolation check below could pass without isolating anything.
const ambient = tpl().id;
if (ambient === A.id || ambient === B.id) {
  console.error(`FAIL: the ambient template is "${ambient}", which a fixture also uses — this test would prove nothing`);
  process.exit(1);
}

// Interleaved, each keeps its own across every await it makes.
const seen: string[] = [];
await Promise.all([
  withTemplate(A, () => render(A.id, seen)),
  (async () => { await nap(5); return withTemplate(B, () => render(B.id, seen)); })(),
]);

console.log(`  ambient template outside any context: ${ambient}`);
console.log(`  withTemplate — ${seen.length} contamination(s), expected none`);
for (const l of seen.slice(0, 5)) console.log(`      ${l}`);

if (seen.length) {
  console.error("FAIL: concurrent renders saw each other's template");
  process.exit(1);
}
console.log('  ok — two concurrent renders each kept their own template');

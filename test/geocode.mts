/* The geocoder against an address register that is slow the way the real one
 * is: an exact address and a block's worth of one street answer at once, a
 * number prefix ("91-%") may not answer for a minute and a half. The register
 * and the Planning Portal's address search are stood in for with made-up
 * records along Riley Street; no network.
 *
 *   npx tsx test/geocode.mts
 */

import { geocode, streetAddressOf } from '../src/fetch/geocode.js';
import { retryFetch } from '../src/lib/http.js';
import { mercatorToLonLat } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

// The register: an amalgamation's three properties on the odd side, its neighbours on both.
const RILEY = 'RILEY STREET DARLINGHURST';
const at = (dy: number, dx = 0) => ({ lon: 151.21495 + dx / 92_500, lat: -33.87495 - dy / 110_540 });
const REGISTER = [
  { hn: '87-89', ...at(-20) },
  { hn: '91-93', ...at(0) },
  { hn: '95-97', ...at(18) },
  { hn: '99-107', ...at(45) },
  { hn: '109', ...at(70) },
  { hn: '94', ...at(5, 30) },
  { hn: '98-106', ...at(30, 30) },
].map((r) => ({ address: `${r.hn} ${RILEY}`, housenumber: r.hn, lon: r.lon, lat: r.lat }));

const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
const answer = (rows: typeof REGISTER) => new Response(JSON.stringify({
  features: rows.map((r) => ({ attributes: { address: r.address, housenumber: r.housenumber }, geometry: { x: r.lon, y: r.lat } })),
}), { status: 200, headers: { 'content-type': 'application/json' } });

interface Behaviour {
  /** Prefixes that answer at once; every other prefix hangs until it is called off. */
  fastPrefixes?: string[];
  /** Every request fails as a timeout would. */
  down?: boolean;
  /** The block-round-an-address query fails. */
  nearDown?: boolean;
  /** The Planning Portal's address search does not answer. */
  portalDown?: boolean;
}

// The Portal's search finds the properties whose numbers take in the one asked for, with a shop or two among them.
const takesIn = (hn: string, n: number) => { const [a, z = a] = hn.split('-').map(Number); return n >= a && n <= z && n % 2 === a % 2; };
const portal = (q: string) => {
  const n = parseInt(q);
  return new Response(JSON.stringify(REGISTER.filter((r) => takesIn(r.housenumber, n))
    .flatMap((r) => [{ address: `SHOP 1 ${r.address} 2010`, propId: 1 }, { address: `${r.address} 2010`, propId: 1 }])), { status: 200 });
};

const asked = { exact: 0, prefix: 0, near: 0, portal: 0, calledOff: 0, hanging: 0 };
function register(b: Behaviour) {
  Object.assign(asked, { exact: 0, prefix: 0, near: 0, portal: 0, calledOff: 0, hanging: 0 });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const where = url.searchParams.get('where') ?? '';
    if (b.down) throw timeout();
    if (url.host === 'api.apps1.nsw.gov.au') {
      asked.portal++;
      if (b.portalDown) return new Response('', { status: 503 });
      return portal(url.searchParams.get('a') ?? '');
    }
    const exact = where.match(/^address = '(.+)'$/);
    if (exact) { asked.exact++; return answer(REGISTER.filter((r) => r.address === exact[1])); }
    const geometry = url.searchParams.get('geometry');
    if (geometry) {
      asked.near++;
      if (b.nearDown) throw timeout();
      const box = JSON.parse(geometry);
      const tail = where.match(/^address LIKE '%(.+?)' AND/)?.[1] ?? '';
      const sw = mercatorToLonLat({ x: box.xmin, y: box.ymin }), ne = mercatorToLonLat({ x: box.xmax, y: box.ymax });
      return answer(REGISTER.filter((r) => r.address.endsWith(tail) && r.lon >= sw.lon && r.lon <= ne.lon && r.lat >= sw.lat && r.lat <= ne.lat));
    }
    const prefix = where.match(/^address LIKE '([^']*?)%' AND address LIKE '%(.+?)'/);
    if (prefix) {
      asked.prefix++;
      if (b.fastPrefixes?.includes(prefix[1])) return answer(REGISTER.filter((r) => r.address.startsWith(prefix[1]) && r.address.endsWith(prefix[2])));
      // Cold: no answer until the caller gives up on it.
      asked.hanging++;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => { asked.calledOff++; reject(init.signal!.reason); }, { once: true });
      });
    }
    throw new Error(`unexpected query: ${where}`);
  }) as typeof fetch;
}

const real = globalThis.fetch;
const timed = async <T,>(p: Promise<T>) => { const t0 = Date.now(); const v = await p; return { v, s: (Date.now() - t0) / 1000 }; };
const sorted = (xs: string[]) => [...xs].sort().join('; ');

const AMALGAMATION = sorted([`91-93 ${RILEY}`, `95-97 ${RILEY}`, `99-107 ${RILEY}`]);
try {
  // The Portal's addresses cut to the street's: the unit, the shop and the postcode off, another street's left out.
  const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  eq('a shop is its building', streetAddressOf('SHOP 1 91-93 RILEY STREET DARLINGHURST 2010', RILEY), `91-93 ${RILEY}`);
  eq('a unit is its building', streetAddressOf('39 17-19 HASSALL STREET PARRAMATTA 2150', 'HASSALL STREET PARRAMATTA'), '17-19 HASSALL STREET PARRAMATTA');
  eq('a lettered unit is its building', streetAddressOf('U 5B 284 BONDI ROAD BONDI 2026', 'BONDI ROAD BONDI'), '284 BONDI ROAD BONDI');
  eq('another suburb is not the street', streetAddressOf('6 21 BONDI ROAD BONDI JUNCTION 2022', 'BONDI ROAD BONDI'), undefined);

  // A range none of whose numbers is an address of its own ("91-107 Riley St" is 91-93, 95-97 and 99-107): the
  // Portal names one of them, and the block round it finds the others. No prefix is asked of the register.
  register({});
  const named = await timed(geocode(`91-107 Riley Street, Darlinghurst NSW`));
  check('the Portal anchors the range', sorted(named.v.matchedAddresses) === AMALGAMATION, sorted(named.v.matchedAddresses));
  check('…without a prefix scan', asked.prefix === 0 && asked.portal > 0, JSON.stringify(asked));

  // The same without the Portal: the first prefix to answer finds one of the three, the block round it the other
  // two, and the prefixes still in flight are called off rather than waited for.
  register({ fastPrefixes: ['91-'], portalDown: true });
  const range = await timed(geocode(`91-107 Riley Street, Darlinghurst NSW`));
  check('the range finds every property it covers', sorted(range.v.matchedAddresses) === AMALGAMATION, sorted(range.v.matchedAddresses));
  check('the range does not wait on the cold prefixes', range.s < 5, `${range.s} s`);
  check('the cold prefixes are called off', asked.hanging > 0 && asked.calledOff === asked.hanging, JSON.stringify(asked));
  check('one block query finds the rest', asked.near === 1, JSON.stringify(asked));

  // One number of the range is an address of its own: the block round it finds the rest, no prefix asked.
  register({});
  const anchored = await timed(geocode(`91-109 Riley Street, Darlinghurst NSW`));
  check('an exact hit anchors the rest', sorted(anchored.v.matchedAddresses) === sorted([`91-93 ${RILEY}`, `95-97 ${RILEY}`, `99-107 ${RILEY}`, `109 ${RILEY}`]), sorted(anchored.v.matchedAddresses));
  check('nothing more is asked when the block answers', asked.prefix === 0 && asked.portal === 0, JSON.stringify(asked));

  // A single address is one exact lookup and nothing else.
  register({});
  const single = await geocode(`109 Riley St, Darlinghurst`);
  check('a single address is itself', sorted(single.matchedAddresses) === `109 ${RILEY}`, sorted(single.matchedAddresses));
  check('a single address is one lookup', asked.exact === 1 && asked.prefix === 0 && asked.near === 0 && asked.portal === 0, JSON.stringify(asked));

  // The register not answering at all is said as much, not as fetch's "aborted due to timeout".
  register({ down: true });
  const down = await geocode(`109 Riley Street, Darlinghurst NSW`).then(() => null, (e: Error) => e);
  check('a register that does not answer fails', !!down);
  check('…saying the register did not answer', !!down && /address register did not answer/.test(down.message), down?.message);
  check('…not fetch\'s own words', !!down && !/aborted due to timeout/.test(down.message), down?.message);

  // Found in part, the rest unanswered: the site is drawn with what was found, and the log says what may be missing.
  // '91-' answers; the block query fails; the other prefixes time out rather than hang.
  register({ fastPrefixes: ['91-'], nearDown: true, portalDown: true });
  globalThis.fetch = ((inner) => (async (input: string | URL, init?: RequestInit) => {
    const where = new URL(String(input)).searchParams.get('where') ?? '';
    if (/^address LIKE '(?!91-)/.test(where) && !new URL(String(input)).searchParams.get('geometry')) { asked.prefix++; throw timeout(); }
    return inner(input, init);
  }) as typeof fetch)(globalThis.fetch);
  const lines: string[] = [];
  const partial = await geocode(`91-107 Riley Street, Darlinghurst NSW`, (m) => lines.push(m));
  check('what was found is kept', sorted(partial.matchedAddresses) === `91-93 ${RILEY}`, sorted(partial.matchedAddresses));
  check('what was not answered is a WARN', lines.some((l) => /WARN .*did not answer for no\. 95/.test(l)), lines.join(' | '));

  // retryFetch names the service and the wait when it gives up on a timeout.
  globalThis.fetch = (async () => { throw timeout(); }) as typeof fetch;
  const e = await retryFetch('https://example.invalid/query', {}, { attempts: 1, timeoutMs: 1000, label: 'test layer' }).then(() => null, (x: Error) => x);
  check('a timeout names its service', e?.message === 'test layer did not answer within 1 s (1 try)', e?.message);
} finally {
  globalThis.fetch = real;
}

if (failures.length) {
  console.error(`geocode: ${failures.length} failed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('geocode: ok');

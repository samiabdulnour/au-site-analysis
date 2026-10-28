// The years a street was driven. The Static API's metadata gives one
// panorama for a point, the latest there; the Maps JavaScript API's Street
// View service gives, with any panorama, the list of those taken at the same
// spot in other years (what the Google Maps site offers as its earlier dates),
// and the Static API serves each of them by its ID. That API runs only in a
// browser, so it runs here in the headless Chromium that prints the sheets,
// on a page served from memory, and the key goes to Google and nowhere else.
// It needs the Maps JavaScript API enabled on the key, and no referrer
// restriction that shuts out a page at history.local; without either it logs
// what Google said and gives nothing, and the streetscape goes on with the
// latest drive alone. Behind a proxy that re-terminates TLS (HTTPS_PROXY set)
// the browser is pointed at the proxy and told to trust it, as Node already is.

import { launch } from '../render/pdf.js';

export interface PanoTime { panoId: string; date?: string }
/** For each panorama asked about, the panoramas at its spot, itself among them, each with the month it was taken. */
export type HistoryLookup = (panoIds: string[]) => Promise<Map<string, PanoTime[]>>;

/** How many lookups the page keeps in flight. */
const IN_FLIGHT = 4;

const PAGE = (key: string) => `<!doctype html><meta charset="utf-8"><title>history</title><script>
window.failed = null;
window.gm_authFailure = () => { window.failed = 'the key was refused by the Maps JavaScript API (gm_authFailure: the API not enabled on it, or a referrer restriction)'; };
window.__init = () => { window.svs = new google.maps.StreetViewService(); window.ready = true; };
const dateOf = (t) => { for (const v of Object.values(t)) if (v instanceof Date) return v.toISOString().slice(0, 7); return undefined; };
const one = (pano) => new Promise((res) => {
  try {
    svs.getPanorama({ pano }, (d, st) => res(st === 'OK' && d ? (d.time || []).map((t) => ({ panoId: t.pano, date: dateOf(t) })) : String(st)));
  } catch (e) { res(String(e)); }
});
window.lookup = async (ids, n) => {
  const out = {};
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, ids.length) }, async () => {
    while (i < ids.length) { const id = ids[i++]; out[id] = await one(id); }
  }));
  return out;
};
</script><script async src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__init"></script>`;

export function historyService(key: string, log: (m: string) => void = () => {}): HistoryLookup {
  return async (panoIds) => {
    const out = new Map<string, PanoTime[]>();
    if (!panoIds.length) return out;
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const browser = await launch([], proxy ? { proxy: { server: proxy } } : {});
    try {
      const page = await browser.newPage({ ignoreHTTPSErrors: Boolean(proxy) });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' || /Google Maps JavaScript API (error|warning)/.test(m.text())) errors.push(m.text()); });
      await page.route('http://history.local/**', (route) => route.fulfill({ contentType: 'text/html', body: PAGE(key) }));
      await page.goto('http://history.local/', { waitUntil: 'load' });
      await page.waitForFunction(() => (window as any).ready || (window as any).failed, null, { timeout: 30_000 })
        .catch(() => { throw new Error(errors[0]?.slice(0, 200) ?? 'the Maps JavaScript API did not load'); });
      const failed = await page.evaluate(() => (window as any).failed as string | null);
      if (failed) throw new Error(`${failed}${errors.length ? `; ${errors[0].slice(0, 160)}` : ''}`);
      const got = await page.evaluate(([ids, n]) => (window as any).lookup(ids, n), [panoIds, IN_FLIGHT] as const) as Record<string, PanoTime[] | string>;
      const refused = new Map<string, number>();
      for (const [id, v] of Object.entries(got)) {
        if (Array.isArray(v)) out.set(id, v.filter((t) => t && typeof t.panoId === 'string'));
        else refused.set(v, (refused.get(v) ?? 0) + 1);
      }
      if (refused.size) log(`  Street View history: ${[...refused].map(([why, n]) => `${n} answered ${why}`).join(', ')}`);
      return out;
    } finally {
      await browser.close();
    }
  };
}

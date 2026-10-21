import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', '.cache', 'osm');

// Shared resilient HTTP helpers. Every upstream this tool uses is a free
// public service that sheds load without warning (503/504) or rate-limits
// (429), so all of them go through here: exponential backoff with jitter,
// retry on transient status codes and network errors.

export interface RetryOpts {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  label?: string;
  /** Called before each retry — useful for logging long waits. */
  onRetry?: (attempt: number, reason: string) => void;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

export async function retryFetch(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 5;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const base = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    if (i) {
      // exponential backoff with jitter, capped so a run cannot stall forever
      const delay = Math.min(base * 2 ** (i - 1), 30_000) * (0.7 + Math.random() * 0.6);
      opts.onRetry?.(i, String(lastErr ?? 'retry'));
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (TRANSIENT.has(res.status)) {
        lastErr = new Error(`${opts.label ?? url} -> HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;   // network error / timeout — retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Overpass with mirror rotation. Public instances rate-limit per IP and shed
 * load constantly; trying every mirror per round beats hammering one.
 */
const PUBLIC_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

/**
 * A local Overpass (OVERPASS_LOCAL, e.g. http://127.0.0.1:12345/api/interpreter)
 * is always tried first: it is fast, unmetered and unaffected by the public
 * network's outages. Public mirrors remain as a fallback.
 */
function overpassEndpoints(): string[] {
  const local = process.env.OVERPASS_LOCAL?.trim();
  return local ? [local, ...PUBLIC_MIRRORS] : PUBLIC_MIRRORS;
}

export async function overpassQuery(
  query: string,
  opts: { rounds?: number; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<any> {
  // Disk cache: the public Overpass network is regularly unavailable, so a
  // previous successful answer for the same query is far better than nothing.
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const cacheFile = join(CACHE_DIR, `${key}.json`);
  // Against a local Overpass the cache is nearly pointless and actively harmful
  // to accuracy: queries are fast and free, and the database is rebuilt weekly,
  // so a month-old answer would silently outlive the data it came from. Keep a
  // short window to absorb bursts, and keep writing the file either way — the
  // stale-cache fallback below still covers a local outage.
  const maxAgeMs = process.env.OVERPASS_LOCAL ? 6 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
  try {
    const st = statSync(cacheFile);
    if (Date.now() - st.mtimeMs < maxAgeMs) {
      return JSON.parse(readFileSync(cacheFile, 'utf8'));
    }
  } catch { /* no cache yet */ }

  const rounds = opts.rounds ?? 2;
  const timeoutMs = opts.timeoutMs ?? (process.env.OVERPASS_LOCAL ? 90_000 : 40_000);
  // Each mirror's own failure in the last round, so a run that could reach
  // none says why of every one rather than only of the last tried.
  let failures: string[] = [];

  for (let round = 0; round < rounds; round++) {
    failures = [];
    if (round) {
      const wait = Math.min(8_000 * round, 16_000);
      opts.log?.(`  OSM busy, waiting ${Math.round(wait / 1000)}s before retry ${round + 1}/${rounds}`);
      await new Promise((r) => setTimeout(r, wait));
    }
    for (const mirror of overpassEndpoints()) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) { failures.push(`${new URL(mirror).host} HTTP ${res.status}`); continue; }
        const text = await res.text();
        if (!text.trimStart().startsWith('{')) {  // HTML error page
          failures.push(`${new URL(mirror).host} non-JSON response`);
          continue;
        }
        try {
          mkdirSync(CACHE_DIR, { recursive: true });
          writeFileSync(cacheFile, text);
        } catch { /* cache is optional */ }
        return JSON.parse(text);
      } catch (e: any) {
        // fetch's own message is only "fetch failed"; the reason is its cause.
        const why = e?.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000} s` : e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(e);
        failures.push(`${new URL(mirror).host} ${why}`);
      }
    }
  }
  // Every mirror failed — serve a stale cached answer if we have one.
  try {
    const stale = readFileSync(cacheFile, 'utf8');
    opts.log?.('  OSM unavailable — using cached data from an earlier run');
    return JSON.parse(stale);
  } catch { /* nothing cached */ }
  throw new Error(`no Overpass mirror answered: ${failures.join('; ')}`);
}

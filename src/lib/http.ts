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
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

export async function overpassQuery(
  query: string,
  opts: { rounds?: number; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<any> {
  // Disk cache: the public Overpass network is regularly unavailable, so a
  // previous successful answer for the same query is far better than nothing.
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  const cacheFile = join(CACHE_DIR, `${key}.json`);
  try {
    const st = statSync(cacheFile);
    if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) {
      return JSON.parse(readFileSync(cacheFile, 'utf8'));
    }
  } catch { /* no cache yet */ }

  const rounds = opts.rounds ?? 2;
  const timeoutMs = opts.timeoutMs ?? 40_000;
  let lastErr: unknown;

  for (let round = 0; round < rounds; round++) {
    if (round) {
      const wait = Math.min(8_000 * round, 16_000);
      opts.log?.(`  OSM busy, waiting ${Math.round(wait / 1000)}s before retry ${round + 1}/${rounds}`);
      await new Promise((r) => setTimeout(r, wait));
    }
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) { lastErr = new Error(`${mirror} -> HTTP ${res.status}`); continue; }
        const text = await res.text();
        if (!text.trimStart().startsWith('{')) {  // HTML error page
          lastErr = new Error(`${mirror} -> non-JSON response`);
          continue;
        }
        try {
          mkdirSync(CACHE_DIR, { recursive: true });
          writeFileSync(cacheFile, text);
        } catch { /* cache is optional */ }
        return JSON.parse(text);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  // Every mirror failed — serve a stale cached answer if we have one.
  try {
    const stale = readFileSync(cacheFile, 'utf8');
    opts.log?.('  OSM unavailable — using cached data from an earlier run');
    return JSON.parse(stale);
  } catch { /* nothing cached */ }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

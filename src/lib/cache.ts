// A file cache on the output volume for the slow or unchanging feeds the
// deck reads: a census table never changes, a projection file changes once
// a year, a council-wide list of applications once a day. Each caller
// names its folder and its shelf life; a miss or an unwritable volume is
// simply a fetch.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', '.cache');

export const DAY_MS = 24 * 3600 * 1000;

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9.+-]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

/** The cached text for `key` in `folder` if it is younger than `maxAgeMs`, else null. */
export function readCached(folder: string, key: string, maxAgeMs: number): string | null {
  const file = join(ROOT, safe(folder), safe(key));
  try {
    if (Date.now() - statSync(file).mtimeMs < maxAgeMs) return readFileSync(file, 'utf8');
  } catch { /* no cache */ }
  return null;
}

export function writeCached(folder: string, key: string, text: string): void {
  try {
    const dir = join(ROOT, safe(folder));
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, safe(key)), text);
  } catch { /* the cache is optional */ }
}

/**
 * Written beside and moved into place. Jobs run side by side (src/worker.ts)
 * and share this cache, so one job reading what another is halfway through
 * writing would take half a census table for the whole of it.
 */
export function writeFileAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** `fetchText()` once per `maxAgeMs`, through the cache. */
export async function cachedText(folder: string, key: string, maxAgeMs: number, fetchText: () => Promise<string>): Promise<string> {
  const hit = readCached(folder, key, maxAgeMs);
  if (hit !== null) return hit;
  const text = await fetchText();
  writeCached(folder, key, text);
  return text;
}

/** `fetchValue()` once per `maxAgeMs`, JSON on disk. */
export async function cachedJson<T>(folder: string, key: string, maxAgeMs: number, fetchValue: () => Promise<T>): Promise<T> {
  const hit = readCached(folder, `${key}.json`, maxAgeMs);
  if (hit !== null) {
    try { return JSON.parse(hit) as T; } catch { /* rewrite below */ }
  }
  const value = await fetchValue();
  writeCached(folder, `${key}.json`, JSON.stringify(value));
  return value;
}

/** A small CSV reader: quoted fields, embedded commas and quotes, CRLF, a BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

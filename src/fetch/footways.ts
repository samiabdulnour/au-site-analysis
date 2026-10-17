// The footpaths mapped along the streets, for the site sheet's kerb lines:
// OpenStreetMap's sidewalks as Overture Maps republishes them (ODbL), read
// from its public bucket by DuckDB through a small Python script, as the
// buildings are. Where a footpath is mapped, the sheet measures the footpath's
// width from it; where none is, it takes a typical width. Cached on the
// volume for a month, since Overture moves monthly.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import { extentToLonLatBbox, type Extent } from '../lib/geo.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'py', 'overture_footways.py');

export interface FootwaysData {
  source: 'overture' | 'none';
  release?: string;
  /** Each sidewalk's centre line, in lon/lat. */
  lines: [number, number][][];
  fetchedAt: string;
  note?: string;
}

const run = (cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number | null }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout) => {
      resolve({ stdout: String(stdout ?? ''), code: err ? ((err as any).code ?? 1) : 0 });
    });
  });

export async function fetchFootways(extent: Extent, log: (m: string) => void = () => {}): Promise<FootwaysData> {
  const key = ['xmin', 'ymin', 'xmax', 'ymax'].map((k) => Math.round(extent[k as keyof Extent])).join('_');
  return cachedJson('footways', key, 30 * DAY_MS, async (): Promise<FootwaysData> => {
    const bb = extentToLonLatBbox(extent);
    const started = Date.now();
    const res = await run('python3', [SCRIPT, String(bb.west), String(bb.south), String(bb.east), String(bb.north)], 15 * 60_000);
    let data: any;
    try { data = JSON.parse(res.stdout); } catch { throw new Error(`Overture footways script gave no JSON (exit ${res.code})`); }
    if (data.error) throw new Error(`Overture: ${data.error}`);
    const lines: [number, number][][] = [];
    for (const f of data.footways ?? []) {
      const g = f.geometry;
      if (g?.type === 'LineString') lines.push(g.coordinates);
      else if (g?.type === 'MultiLineString') lines.push(...g.coordinates);
    }
    log(`  footways: ${lines.length} sidewalks from Overture ${data.release} in ${Math.round((Date.now() - started) / 1000)} s`);
    return { source: 'overture', release: String(data.release), lines, fetchedAt: new Date().toISOString() };
  });
}

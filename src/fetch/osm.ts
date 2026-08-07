// OpenStreetMap via Overpass — used ONLY for bus stops and bus routes, which
// NSW open data lacks. Failure is soft: the sheet renders without bus data.

import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox } from '../lib/geo.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export interface OsmPoint { name?: string; lon: number; lat: number }
export interface BusData {
  busStops: OsmPoint[];
  busRouteSegments: [number, number][][];
}

// Public Overpass instances rate-limit per IP (429) and shed load (503/504) —
// rotate mirrors and back off patiently.
async function overpass(q: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 20_000 * attempt));
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) { lastErr = new Error(`Overpass ${mirror} HTTP ${res.status}`); continue; }
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

export async function fetchBusData(extent: Extent): Promise<BusData> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:60];
(
  node["highway"="bus_stop"](${bbox});
  relation["route"="bus"](${bbox});
);
out geom;`;
  const data = await overpass(q);

  const out: BusData = { busStops: [], busRouteSegments: [] };
  const segSeen = new Set<number>();
  for (const el of data.elements ?? []) {
    if (el.type === 'node' && el.tags?.highway === 'bus_stop') {
      out.busStops.push({ name: el.tags.name, lon: el.lon, lat: el.lat });
    } else if (el.type === 'relation' && el.tags?.route === 'bus') {
      for (const m of el.members ?? []) {
        if (m.type !== 'way' || !m.geometry || segSeen.has(m.ref)) continue;
        segSeen.add(m.ref);
        out.busRouteSegments.push(m.geometry.map((g: any) => [g.lon, g.lat]));
      }
    }
  }
  return out;
}

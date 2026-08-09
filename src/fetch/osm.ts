// OpenStreetMap via Overpass — used ONLY for bus stops and bus routes, which
// NSW open data lacks. Failure is soft: the sheet renders without bus data.

import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox } from '../lib/geo.js';
import { overpassQuery } from '../lib/http.js';


export interface OsmPoint { name?: string; lon: number; lat: number }
export interface BusData {
  busStops: OsmPoint[];
  busRouteSegments: [number, number][][];
  tramStops: OsmPoint[];
  tramRouteSegments: [number, number][][];
}

export async function fetchBusData(extent: Extent): Promise<BusData> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:60];
(
  node["highway"="bus_stop"](${bbox});
  node["railway"="tram_stop"](${bbox});
  relation["route"="bus"](${bbox});
  relation["route"~"^(tram|light_rail)$"](${bbox});
);
out geom;`;
  const data = await overpassQuery(q);

  const out: BusData = { busStops: [], busRouteSegments: [], tramStops: [], tramRouteSegments: [] };
  const busSeen = new Set<number>();
  const tramSeen = new Set<number>();
  for (const el of data.elements ?? []) {
    if (el.type === 'node' && el.tags?.highway === 'bus_stop') {
      out.busStops.push({ name: el.tags.name, lon: el.lon, lat: el.lat });
    } else if (el.type === 'node' && el.tags?.railway === 'tram_stop') {
      out.tramStops.push({ name: el.tags.name, lon: el.lon, lat: el.lat });
    } else if (el.type === 'relation') {
      const isBus = el.tags?.route === 'bus';
      const isTram = /^(tram|light_rail)$/.test(el.tags?.route ?? '');
      if (!isBus && !isTram) continue;
      const seen = isBus ? busSeen : tramSeen;
      const target = isBus ? out.busRouteSegments : out.tramRouteSegments;
      for (const m of el.members ?? []) {
        if (m.type !== 'way' || !m.geometry || seen.has(m.ref)) continue;
        seen.add(m.ref);
        target.push(m.geometry.map((g: any) => [g.lon, g.lat]));
      }
    }
  }
  return out;
}

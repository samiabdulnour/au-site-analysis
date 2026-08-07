// OpenStreetMap via Overpass: streets, POIs, transport. One call per generation.

import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox } from '../lib/geo.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export interface OsmRoad { name: string; cls: string; coords: [number, number][] }
export interface OsmPoint { name?: string; lon: number; lat: number }
export interface OsmPoi {
  name?: string;
  kind: string; // raw OSM value, e.g. school / hospital / park / place_of_worship / supermarket
  tag: string;  // which key it came from: amenity / leisure / landuse / shop
  rings: [number, number][][]; // outer rings
}
export interface OsmData {
  roads: OsmRoad[];
  busStops: OsmPoint[];
  stations: OsmPoint[];
  railLines: [number, number][][];
  busRouteSegments: [number, number][][];
  pois: OsmPoi[];
}

const ROAD_RE = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$/;
const AMENITY_RE = /^(school|college|university|kindergarten|hospital|clinic|community_centre|place_of_worship|library|townhall|police|fire_station)$/;
const LEISURE_RE = /^(park|garden|pitch|playground|sports_centre|recreation_ground|golf_course)$/;

export async function fetchOsm(extent: Extent): Promise<OsmData> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]["name"](${bbox});
  node["highway"="bus_stop"](${bbox});
  node["railway"~"^(station|halt)$"](${bbox});
  way["railway"~"^(rail|light_rail|tram)$"](${bbox});
  relation["route"="bus"](${bbox});
  way["amenity"~"${AMENITY_RE.source}"](${bbox});
  relation["amenity"~"^(school|college|university|hospital)$"](${bbox});
  way["leisure"~"${LEISURE_RE.source}"](${bbox});
  relation["leisure"~"^(park|garden|recreation_ground)$"](${bbox});
  way["landuse"~"^(cemetery|industrial)$"](${bbox});
  way["shop"~"^(supermarket|mall)$"](${bbox});
);
out geom;`;

  // Public Overpass instances rate-limit per IP (429) and shed load (503) —
  // rotate mirrors and back off patiently; a generation is one query, so a
  // couple of minutes of waiting is acceptable.
  let data: any;
  let lastErr: unknown;
  outer: for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 25_000 * attempt));
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!res.ok) { lastErr = new Error(`Overpass ${mirror} HTTP ${res.status}`); continue; }
        data = await res.json();
        break outer;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  if (!data) throw lastErr;

  const out: OsmData = { roads: [], busStops: [], stations: [], railLines: [], busRouteSegments: [], pois: [] };
  const busSegSeen = new Set<number>();

  const wayCoords = (el: any): [number, number][] => (el.geometry ?? []).map((g: any) => [g.lon, g.lat]);

  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.highway === 'bus_stop') out.busStops.push({ name: t.name, lon: el.lon, lat: el.lat });
      else if (t.railway === 'station' || t.railway === 'halt') out.stations.push({ name: t.name, lon: el.lon, lat: el.lat });
      continue;
    }
    if (el.type === 'way') {
      const coords = wayCoords(el);
      if (coords.length < 2) continue;
      if (t.highway && ROAD_RE.test(t.highway) && t.name) {
        out.roads.push({ name: t.name, cls: t.highway, coords });
      } else if (t.railway && /^(rail|light_rail|tram)$/.test(t.railway)) {
        out.railLines.push(coords);
      } else {
        const kind = t.amenity ?? t.leisure ?? t.landuse ?? t.shop;
        const tag = t.amenity ? 'amenity' : t.leisure ? 'leisure' : t.landuse ? 'landuse' : 'shop';
        if (kind) out.pois.push({ name: t.name, kind, tag, rings: [coords] });
      }
      continue;
    }
    if (el.type === 'relation') {
      if (t.route === 'bus') {
        for (const m of el.members ?? []) {
          if (m.type !== 'way' || !m.geometry || busSegSeen.has(m.ref)) continue;
          busSegSeen.add(m.ref);
          out.busRouteSegments.push(m.geometry.map((g: any) => [g.lon, g.lat]));
        }
      } else {
        const kind = t.amenity ?? t.leisure;
        if (!kind) continue;
        const rings = (el.members ?? [])
          .filter((m: any) => m.type === 'way' && m.role !== 'inner' && m.geometry)
          .map((m: any) => m.geometry.map((g: any) => [g.lon, g.lat]));
        if (rings.length) out.pois.push({ name: t.name, kind, tag: t.amenity ? 'amenity' : 'leisure', rings });
      }
    }
  }
  return out;
}

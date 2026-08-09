// Site-analysis-scale data: contours (for RLs and fall), neighbour address
// points, and OSM street furniture (trees, hydrants, poles, lamps, one-ways).

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox } from '../lib/geo.js';

const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';

export interface ContourLine { elevation: number; coords: [number, number][] }

export async function fetchContours(extent: Extent): Promise<ContourLine[]> {
  const fc = await queryByExtent(`${PORTAL}/NSW_Elevation_and_Depth_Theme/FeatureServer/2`,
    extent, 'elevation');
  const out: ContourLine[] = [];
  for (const f of fc.features) {
    if (!f.geometry || f.properties.elevation == null) continue;
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const l of lines) out.push({ elevation: f.properties.elevation, coords: l });
  }
  return out;
}

export interface NeighbourAddress { housenumber: string; lon: number; lat: number }

export async function fetchNeighbourAddresses(extent: Extent): Promise<NeighbourAddress[]> {
  const fc: GeoJSONFC = await queryByExtent(
    `${PORTAL}/NSW_Geocoded_Addressing_Theme/FeatureServer/1`, extent, 'housenumber');
  return fc.features
    .filter((f) => f.geometry && f.properties.housenumber && !String(f.properties.housenumber).includes('/'))
    .map((f) => ({
      housenumber: String(f.properties.housenumber),
      lon: f.geometry!.coordinates[0],
      lat: f.geometry!.coordinates[1],
    }));
}

export interface SiteFurniture {
  trees: { lon: number; lat: number }[];
  hydrants: { lon: number; lat: number }[];
  powerPoles: { lon: number; lat: number }[];
  streetLamps: { lon: number; lat: number }[];
  onewayRoads: { name?: string; coords: [number, number][] }[];
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export async function fetchSiteFurniture(extent: Extent): Promise<SiteFurniture> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:45];
(
  node["natural"="tree"](${bbox});
  node["emergency"="fire_hydrant"](${bbox});
  node["power"="pole"](${bbox});
  node["highway"="street_lamp"](${bbox});
  way["highway"]["oneway"="yes"](${bbox});
);
out geom;`;
  let data: any;
  let lastErr: unknown;
  outer: for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 15_000 * attempt));
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(mirror, {
          method: 'POST', body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) { lastErr = new Error(`Overpass HTTP ${res.status}`); continue; }
        data = await res.json();
        break outer;
      } catch (e) { lastErr = e; }
    }
  }
  if (!data) throw lastErr;

  const out: SiteFurniture = { trees: [], hydrants: [], powerPoles: [], streetLamps: [], onewayRoads: [] };
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      const p = { lon: el.lon, lat: el.lat };
      if (t.natural === 'tree') out.trees.push(p);
      else if (t.emergency === 'fire_hydrant') out.hydrants.push(p);
      else if (t.power === 'pole') out.powerPoles.push(p);
      else if (t.highway === 'street_lamp') out.streetLamps.push(p);
    } else if (el.type === 'way' && el.geometry) {
      out.onewayRoads.push({ name: t.name, coords: el.geometry.map((g: any) => [g.lon, g.lat]) });
    }
  }
  return out;
}

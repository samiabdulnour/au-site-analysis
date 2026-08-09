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
  /** Building footprints; levels only where OSM records them. */
  buildings: { levels?: number; lon: number; lat: number }[];
  /** Utility lines where mapped (power/water/sewer are sparse in OSM). */
  utilities: { kind: 'power' | 'water' | 'sewer' | 'gas'; coords: [number, number][] }[];
  /** Driveways — the road end becomes a vehicular-access triangle. */
  driveways: { coords: [number, number][] }[];
  /** Road segments tagged with kerbside parking. */
  parkingLanes: { coords: [number, number][]; side: 'left' | 'right' | 'both' }[];
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

export async function fetchSiteFurniture(extent: Extent): Promise<SiteFurniture> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:60];
(
  node["natural"="tree"](${bbox});
  node["emergency"="fire_hydrant"](${bbox});
  node["power"="pole"](${bbox});
  node["highway"="street_lamp"](${bbox});
  way["highway"]["oneway"="yes"](${bbox});
  way["building"](${bbox});
  way["power"="line"](${bbox});
  way["power"="minor_line"](${bbox});
  way["man_made"="pipeline"](${bbox});
  way["service"="driveway"](${bbox});
  way["highway"]["parking:lane:left"](${bbox});
  way["highway"]["parking:lane:right"](${bbox});
  way["highway"]["parking:both"](${bbox});
  way["highway"]["parking:left"](${bbox});
  way["highway"]["parking:right"](${bbox});
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

  const out: SiteFurniture = {
    trees: [], hydrants: [], powerPoles: [], streetLamps: [],
    onewayRoads: [], buildings: [], utilities: [], driveways: [], parkingLanes: [],
  };
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      const p = { lon: el.lon, lat: el.lat };
      if (t.natural === 'tree') out.trees.push(p);
      else if (t.emergency === 'fire_hydrant') out.hydrants.push(p);
      else if (t.power === 'pole') out.powerPoles.push(p);
      else if (t.highway === 'street_lamp') out.streetLamps.push(p);
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const coords: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat]);
    if (t.service === 'driveway') {
      out.driveways.push({ coords });
      continue;
    }
    const pl = t['parking:lane:left'] ?? t['parking:left'];
    const pr = t['parking:lane:right'] ?? t['parking:right'];
    const pb = t['parking:both'];
    const parked = (v?: string) => v && v !== 'no' && v !== 'none';
    if (t.highway && (parked(pl) || parked(pr) || parked(pb))) {
      out.parkingLanes.push({
        coords,
        side: parked(pb) ? 'both' : parked(pl) ? 'left' : 'right',
      });
      continue;
    }
    if (t.building) {
      const lv = parseInt(t['building:levels'] ?? '', 10);
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      out.buildings.push({ levels: Number.isFinite(lv) ? lv : undefined, lon: cx, lat: cy });
    } else if (t.power === 'line' || t.power === 'minor_line') {
      out.utilities.push({ kind: 'power', coords });
    } else if (t.man_made === 'pipeline') {
      const sub = (t.substance ?? '').toLowerCase();
      out.utilities.push({ kind: sub === 'gas' ? 'gas' : sub === 'sewage' ? 'sewer' : 'water', coords });
    } else if (t.highway && t.oneway === 'yes') {
      out.onewayRoads.push({ name: t.name, coords });
    }
  }
  return out;
}

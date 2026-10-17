// Site-analysis-scale data: contours (for RLs and fall), neighbour address
// points, and OSM street furniture (trees, hydrants, poles, lamps, one-ways,
// driveways, kerbside parking, car parks).

import { queryByExtent, type GeoJSONFC } from '../lib/arcgis.js';
import type { Extent } from '../lib/geo.js';
import { extentToLonLatBbox, lonLatToMercator, mercatorToLonLat, mercatorScaleFactor } from '../lib/geo.js';
import { overpassQuery } from '../lib/http.js';
import { treeFromOsm, NOMINAL_CANOPY_M, type SiteTree } from './trees.js';
import type { Orientation } from '../lib/parking.js';

const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';

export interface ContourLine { elevation: number; coords: [number, number][] }

export interface ContourSet {
  lines: ContourLine[];
  intervalM: number;
  /** Who drew them, for the legend. */
  source: string;
  /** Printed on the sheet where the licence asks for it. */
  attribution?: string;
}

// The state contours are at 2 m. Some councils fly their own survey and
// publish 1 m contours under an open licence; where one covers the sheet it is
// used instead, and the legend says whose they are. Same shape of registry as
// the tree inventories: a layer, the bbox it covers, the field with the level.
interface ContourSource {
  id: string;
  name: string;
  attribution: string;
  layer: string;
  field: string;
  intervalM: number;
  extent: { west: number; south: number; east: number; north: number };
}

export const CONTOUR_SOURCES: ContourSource[] = [
  {
    id: 'cityofsydney',
    name: 'City of Sydney 1 m contours, 2020 aerial survey',
    attribution: 'Contours © City of Sydney, CC BY 4.0',
    layer: 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Terrain_Contours/FeatureServer/0',
    field: 'Contour',
    intervalM: 1,
    extent: { west: 151.17, south: -33.93, east: 151.24, north: -33.85 },
  },
];

const NSW_CONTOURS = { source: 'NSW Spatial Services', intervalM: 2 };

function linesOf(fc: GeoJSONFC, field: string): ContourLine[] {
  const out: ContourLine[] = [];
  for (const f of fc.features) {
    const z = Number(f.properties[field]);
    if (!f.geometry || !Number.isFinite(z)) continue;
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const l of lines) out.push({ elevation: z, coords: l });
  }
  return out;
}

/**
 * How much of the extent the lines reach across, 0–1. A council set that
 * stops at the LGA boundary part-way across the sheet would leave the rest
 * blank, which is worse than 2 m contours everywhere.
 */
function coverage(lines: ContourLine[], extent: Extent): number {
  const b = extentToLonLatBbox(extent);
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const l of lines) for (const [lon, lat] of l.coords) {
    w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  if (!Number.isFinite(w)) return 0;
  const fx = (Math.min(e, b.east) - Math.max(w, b.west)) / (b.east - b.west);
  const fy = (Math.min(n, b.north) - Math.max(s, b.south)) / (b.north - b.south);
  return Math.max(0, fx) * Math.max(0, fy);
}

export async function fetchContours(extent: Extent, log?: (m: string) => void): Promise<ContourSet> {
  const b = extentToLonLatBbox(extent);
  for (const src of CONTOUR_SOURCES) {
    const x = src.extent;
    if (!(b.west <= x.east && b.east >= x.west && b.south <= x.north && b.north >= x.south)) continue;
    try {
      const lines = linesOf(await queryByExtent(src.layer, extent, src.field), src.field);
      const cov = coverage(lines, extent);
      if (lines.length >= 3 && cov >= 0.85) {
        log?.(`  contours: ${src.name} (${lines.length} lines)`);
        return { lines, intervalM: src.intervalM, source: src.name, attribution: src.attribution };
      }
      log?.(`  ${src.name} covers ${Math.round(cov * 100)}% of the sheet — using the state contours`);
    } catch (e: any) {
      log?.(`  WARN ${src.name} failed: ${e?.message ?? e}`);
    }
  }
  const fc = await queryByExtent(`${PORTAL}/NSW_Elevation_and_Depth_Theme/FeatureServer/2`, extent, 'elevation');
  return { lines: linesOf(fc, 'elevation'), ...NSW_CONTOURS };
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

/** A road run tagged with kerbside parking on one side. */
export interface ParkingLane {
  coords: [number, number][];
  side: 'left' | 'right' | 'both';
  /** How the cars stand, where OSM says; parallel is assumed otherwise. */
  orientation?: Orientation;
  /** OSM highway class: bounds how far out the kerb can be. */
  highway?: string;
}

export type CarParkKind = 'surface' | 'multi-storey' | 'underground' | 'rooftop' | 'street_side' | 'other';

/** An off-street car park (OSM amenity=parking area). */
export interface CarPark {
  ring: [number, number][];
  kind: CarParkKind;
  capacity?: number;
  name?: string;
}

export interface SiteFurniture {
  /** Every tree with a canopy figure; see fetch/trees.ts for where sizes come from. */
  trees: SiteTree[];
  hydrants: { lon: number; lat: number }[];
  powerPoles: { lon: number; lat: number }[];
  streetLamps: { lon: number; lat: number }[];
  onewayRoads: { name?: string; coords: [number, number][] }[];
  /** Building footprints; levels only where OSM records them. */
  buildings: { levels?: number; lon: number; lat: number }[];
  /** Utility lines where mapped (power/water/sewer are sparse in OSM); `cable` is an underground power cable. */
  utilities: { kind: 'power' | 'cable' | 'water' | 'sewer' | 'gas'; coords: [number, number][] }[];
  /** Service points where mapped: substations and transformers, street cabinets, manholes (with what they serve). */
  servicePoints?: { kind: 'substation' | 'transformer' | 'cabinet' | 'manhole'; lon: number; lat: number; label?: string }[];
  /** Driveways — the road end becomes a vehicular-access triangle. */
  driveways: { coords: [number, number][] }[];
  /** Road runs tagged with kerbside parking, one entry per parked side. */
  parkingLanes: ParkingLane[];
  /** Off-street car parks. */
  carParks: CarPark[];
  /** Individually mapped bays (OSM amenity=parking_space areas). */
  parkingBays: { ring: [number, number][] }[];
  /** Kerbs OpenStreetMap maps as lines (barrier=kerb; older bundles: none). */
  kerbs?: [number, number][][];
}

export const emptyFurniture = (): SiteFurniture => ({
  trees: [], hydrants: [], powerPoles: [], streetLamps: [], onewayRoads: [],
  buildings: [], utilities: [], servicePoints: [], driveways: [], parkingLanes: [], carParks: [], parkingBays: [], kerbs: [],
});

// OSM has tagged kerbside parking two ways. The older parking:lane:<side>
// carries the orientation as its value (parallel, diagonal, perpendicular) or
// a reason there is none (no_stopping…). The current parking:<side> says what
// kind of space it is (lane, street_side, on_kerb…) with the orientation and
// any restriction in their own keys. Both are read; a side-specific key
// overrides a :both key.
const NEW_NO = new Set(['no', 'none', 'separate', 'no_parking', 'no_stopping', 'no_standing', 'fire_lane']);
const RESTRICTED = new Set(['no_stopping', 'no_parking', 'no_standing', 'loading_only', 'bus_zone', 'taxi_zone', 'no_stopping_except_loading']);
const OLD_YES = new Set(['parallel', 'diagonal', 'perpendicular', 'marked', 'yes']);

function orientationOf(v?: string): Orientation | undefined {
  if (v === 'parallel' || v === 'diagonal' || v === 'perpendicular') return v;
  if (v === 'angled' || v === 'angle') return 'diagonal';
  if (v === 'orthogonal') return 'perpendicular';
  return undefined;
}

/** What a road way's tags say about parking on one side; null when they say nothing. */
export function parkingSide(t: Record<string, string>, side: 'left' | 'right'):
  { parked: boolean; orientation?: Orientation } | null {
  const v = t[`parking:${side}`] ?? t['parking:both'];
  if (v !== undefined) {
    let parked = !NEW_NO.has(v);
    const restriction = t[`parking:${side}:restriction`] ?? t['parking:both:restriction'];
    if (restriction && RESTRICTED.has(restriction)) parked = false;
    return { parked, orientation: orientationOf(t[`parking:${side}:orientation`] ?? t['parking:both:orientation']) };
  }
  const old = t[`parking:lane:${side}`] ?? t['parking:lane:both'];
  if (old !== undefined) return { parked: OLD_YES.has(old), orientation: orientationOf(old) };
  return null;
}

function carParkKind(t: Record<string, string>): CarParkKind {
  const p = t.parking ?? (t.building === 'parking' ? 'multi-storey' : 'surface');
  if (p === 'surface' || p === 'multi-storey' || p === 'underground' || p === 'rooftop' || p === 'street_side') return p;
  if (p === 'lane') return 'street_side';
  return 'other';
}

/** Nominal trees every `spacingM` along a tree row. */
function treesAlongRow(coords: [number, number][], spacingM = 8): SiteTree[] {
  const out: SiteTree[] = [];
  if (coords.length < 2) return out;
  const k = mercatorScaleFactor(coords[0][1]);
  const pts = coords.map(([lon, lat]) => lonLatToMercator({ lon, lat }));
  const step = spacingM * k;
  let carry = step / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let s = carry;
    while (s <= L) {
      const ll = mercatorToLonLat({ x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L });
      out.push({ lon: ll.lon, lat: ll.lat, canopyM: NOMINAL_CANOPY_M, canopySource: 'nominal', source: 'osm' });
      s += step;
    }
    carry = s - L;
  }
  return out;
}

export async function fetchSiteFurniture(extent: Extent): Promise<SiteFurniture> {
  const b = extentToLonLatBbox(extent);
  const bbox = `${b.south},${b.west},${b.north},${b.east}`;
  const q = `[out:json][timeout:60];
(
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
  node["emergency"="fire_hydrant"](${bbox});
  node["power"="pole"](${bbox});
  node["highway"="street_lamp"](${bbox});
  way["highway"]["oneway"="yes"](${bbox});
  way["building"](${bbox});
  way["power"="line"](${bbox});
  way["power"="minor_line"](${bbox});
  way["power"="cable"](${bbox});
  node["power"~"^(substation|transformer)$"](${bbox});
  way["power"="substation"](${bbox});
  node["man_made"="street_cabinet"](${bbox});
  node["manhole"](${bbox});
  way["man_made"="pipeline"](${bbox});
  way["service"="driveway"](${bbox});
  way["highway"]["parking:lane:left"](${bbox});
  way["highway"]["parking:lane:right"](${bbox});
  way["highway"]["parking:lane:both"](${bbox});
  way["highway"]["parking:both"](${bbox});
  way["highway"]["parking:left"](${bbox});
  way["highway"]["parking:right"](${bbox});
  way["amenity"="parking"](${bbox});
  way["amenity"="parking_space"](${bbox});
  way["barrier"="kerb"](${bbox});
);
out geom;`;
  const data = await overpassQuery(q);

  const out = emptyFurniture();
  for (const el of data.elements ?? []) {
    const t: Record<string, string> = el.tags ?? {};
    if (el.type === 'node') {
      const p = { lon: el.lon, lat: el.lat };
      if (t.natural === 'tree') out.trees.push(treeFromOsm(el.lon, el.lat, t));
      else if (t.emergency === 'fire_hydrant') out.hydrants.push(p);
      else if (t.power === 'pole') out.powerPoles.push(p);
      else if (t.highway === 'street_lamp') out.streetLamps.push(p);
      else if (t.power === 'substation' || t.power === 'transformer') out.servicePoints!.push({ kind: t.power, ...p });
      else if (t.man_made === 'street_cabinet') out.servicePoints!.push({ kind: 'cabinet', ...p, label: t.street_cabinet || t.utility });
      else if (t.manhole) out.servicePoints!.push({ kind: 'manhole', ...p, label: t.manhole === 'yes' ? undefined : t.manhole });
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const coords: [number, number][] = el.geometry.map((g: any) => [g.lon, g.lat]);
    const closed = (): [number, number][] => {
      const [a, z] = [coords[0], coords[coords.length - 1]];
      return a[0] === z[0] && a[1] === z[1] ? coords : [...coords, a];
    };
    if (t.natural === 'tree_row') {
      out.trees.push(...treesAlongRow(coords));
      continue;
    }
    if (t.service === 'driveway') {
      out.driveways.push({ coords });
      continue;
    }
    if (t.barrier === 'kerb') {
      out.kerbs!.push(coords);
      continue;
    }
    if (t.amenity === 'parking' && coords.length >= 4) {
      const cap = parseInt(t.capacity ?? '', 10);
      out.carParks.push({ ring: closed(), kind: carParkKind(t), capacity: Number.isFinite(cap) && cap > 0 ? cap : undefined, name: t.name });
    } else if (t.amenity === 'parking_space' && coords.length >= 4) {
      out.parkingBays.push({ ring: closed() });
      continue;
    }
    // A road with parking is still a road: its one-way arrow follows below.
    if (t.highway) {
      for (const side of ['left', 'right'] as const) {
        const ps = parkingSide(t, side);
        if (ps?.parked) out.parkingLanes.push({ coords, side, orientation: ps.orientation, highway: t.highway });
      }
    }
    if (t.building) {
      const lv = parseInt(t['building:levels'] ?? '', 10);
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      out.buildings.push({ levels: Number.isFinite(lv) ? lv : undefined, lon: cx, lat: cy });
    } else if (t.power === 'line' || t.power === 'minor_line') {
      out.utilities.push({ kind: 'power', coords });
    } else if (t.power === 'cable') {
      out.utilities.push({ kind: 'cable', coords });
    } else if (t.power === 'substation' && coords.length >= 3) {
      const n = coords.length;
      out.servicePoints!.push({ kind: 'substation', lon: coords.reduce((s, c) => s + c[0], 0) / n, lat: coords.reduce((s, c) => s + c[1], 0) / n, label: t.name });
    } else if (t.man_made === 'pipeline') {
      const sub = (t.substance ?? '').toLowerCase();
      out.utilities.push({ kind: sub === 'gas' ? 'gas' : sub === 'sewage' ? 'sewer' : 'water', coords });
    } else if (t.highway && t.oneway === 'yes') {
      out.onewayRoads.push({ name: t.name, coords });
    }
  }
  return out;
}

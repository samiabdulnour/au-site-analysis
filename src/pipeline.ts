// Orchestrates all fetches for one address and saves the data bundle.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { geocode, type GeocodeResult } from './fetch/geocode.js';
import { fetchSiteLots, fetchRailCorridors, fetchZoning, fetchHeightOfBuilding, fetchHeritage } from './fetch/nsw.js';
import { fetchAerial, type AerialResult } from './fetch/imagery.js';
import { fetchOsm, type OsmData } from './fetch/osm.js';
import { fetchIsochrones, type Isochrone } from './fetch/isochrones.js';
import { sheetExtent, mercatorToLonLat, type Extent } from './lib/geo.js';
import type { GeoJSONFC } from './lib/arcgis.js';

export interface Bundle {
  address: string;
  geocode: GeocodeResult;
  extent: Extent;
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  siteLots: GeoJSONFC;
  railCorridors: GeoJSONFC;
  zoning: GeoJSONFC;
  hob: GeoJSONFC;
  heritage: GeoJSONFC;
  osm: OsmData;
  isochrones: Isochrone[];
  aerial: AerialResult;
  generatedAt: string;
}

export interface PipelineOpts {
  scale: number;
  mapWidthMm: number;
  mapHeightMm: number;
  outDir: string;
  aerialPxWidth?: number;
  log?: (msg: string) => void;
}

export async function runPipeline(address: string, opts: PipelineOpts): Promise<Bundle> {
  const log = opts.log ?? (() => {});
  const dataDir = join(opts.outDir, 'data');
  await mkdir(dataDir, { recursive: true });

  log(`geocoding "${address}"…`);
  const geo = await geocode(address);
  log(`  matched: ${geo.matchedAddresses.join('; ')}`);

  const extent = sheetExtent(geo.center, opts.mapWidthMm, opts.mapHeightMm, opts.scale);
  const centerLL = mercatorToLonLat(geo.center);

  log('fetching site lots, planning layers, imagery, OSM, isochrones…');
  const emptyFC: GeoJSONFC = { type: 'FeatureCollection', features: [] };
  const soft = <T>(p: Promise<T>, fallback: T, name: string): Promise<T> =>
    p.catch((e) => { log(`  WARN ${name} failed: ${e.message ?? e}`); return fallback; });
  const [siteLots, railCorridors, zoning, hob, heritage, osm, isochrones, aerial] = await Promise.all([
    fetchSiteLots(geo.points),
    soft(fetchRailCorridors(extent), emptyFC, 'rail corridors'),
    fetchZoning(extent),
    soft(fetchHeightOfBuilding(extent), emptyFC, 'height of building'),
    soft(fetchHeritage(extent), emptyFC, 'heritage'),
    fetchOsm(extent),
    soft(fetchIsochrones(centerLL), [], 'isochrones'),
    fetchAerial(extent, opts.aerialPxWidth ?? 4000, dataDir),
  ]);
  log(`  lots:${siteLots.features.length} zoning:${zoning.features.length} hob:${hob.features.length} ` +
      `heritage:${heritage.features.length} roads:${osm.roads.length} pois:${osm.pois.length} ` +
      `busStops:${osm.busStops.length} isochrones:${isochrones.length} aerialTiles:${aerial.tiles.length}`);

  const bundle: Bundle = {
    address,
    geocode: geo,
    extent,
    scale: opts.scale,
    mapWidthMm: opts.mapWidthMm,
    mapHeightMm: opts.mapHeightMm,
    siteLots,
    railCorridors,
    zoning,
    hob,
    heritage,
    osm,
    isochrones,
    aerial,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(dataDir, 'bundle.json'), JSON.stringify(bundle));
  return bundle;
}

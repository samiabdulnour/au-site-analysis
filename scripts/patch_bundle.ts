// Re-read parts of a kept bundle after a fetch changed (a development aid, as recompose.ts).
//   npx tsx scripts/patch_bundle.ts out/<slug> [country] [character]
import { readFile, writeFile } from 'node:fs/promises';
import { deserialize, serialize } from 'node:v8';
import { join } from 'node:path';
import { fetchCountry } from '../src/fetch/country.js';
import { fetchPlaceViews } from '../src/fetch/character.js';
import { fetchAerial, fetchVegetationMask } from '../src/fetch/imagery.js';
import { fetchOsmTrees } from '../src/fetch/greenSpace.js';
import { fetchPhotos } from '../src/fetch/photos.js';
import { fetchPlaceStreetViews, fetchStreetSeries, addressStreet } from '../src/fetch/streetView.js';
import { geomRings } from '../src/fetch/planning.js';
import { mergeTrees } from '../src/fetch/trees.js';
import { panelExtent } from '../src/render/minimap.js';
import { mercatorScaleFactor, mercatorToLonLat } from '../src/lib/geo.js';
import { BLEED_SCALE, COUNTRY_SCALE } from '../src/pipeline.js';

const outDir = process.argv[2];
const what = new Set(process.argv.slice(3));
const kept = deserialize(await readFile(join(outDir, 'slides.bundle')));
const sb = kept.sb;
const dataDir = join(outDir, 'data');
const log = (m: string) => console.log(m);
sb.bleedPanel = { ...sb.bleedPanel, scale: BLEED_SCALE };
sb.countryPanel = { ...(sb.countryPanel ?? sb.bleedPanel), scale: COUNTRY_SCALE };
if (what.has('country')) {
  const w = panelExtent(sb.wide.panel), c = panelExtent(sb.countryPanel);
  const ext = { xmin: Math.min(w.xmin, c.xmin), ymin: Math.min(w.ymin, c.ymin), xmax: Math.max(w.xmax, c.xmax), ymax: Math.max(w.ymax, c.ymax) };
  const k = mercatorScaleFactor(mercatorToLonLat(sb.geocode.center).lat);
  sb.country = await fetchCountry(ext, Math.round((ext.xmax - ext.xmin) / k / 2), Math.round((ext.ymax - ext.ymin) / k / 2), sb.geocode.center, dataDir, log);
}
if (what.has('character')) {
  sb.character.aerial = await fetchAerial(panelExtent(sb.bleedPanel), 2400, dataDir, 'context');
  sb.character.placeViews = await fetchPlaceViews(sb.character.places.items, dataDir, 8, log);
  console.log(`place views: ${sb.character.placeViews.length}`);
}
if (what.has('trees')) {
  const osm = await fetchOsmTrees(panelExtent(sb.bleedPanel));
  const council = sb.green.trees.points.filter((t: { osm?: boolean }) => !t.osm).map((t: { lon: number; lat: number; canopyM: number }) => ({ ...t, source: 'cityofsydney', canopySource: 'measured' }));
  const merged = mergeTrees(council, osm);
  sb.green.trees.points = merged.map((t) => ({ lon: t.lon, lat: t.lat, canopyM: t.canopyM, osm: t.source === 'osm' || undefined }));
  sb.green.trees.source = { name: 'City of Sydney tree inventory and OpenStreetMap', attribution: 'Trees © City of Sydney, CC BY 4.0; trees © OpenStreetMap contributors, ODbL' };
  console.log(`trees: ${council.length} council + ${merged.length - council.length} OpenStreetMap`);
}
if (what.has('vegetation')) {
  sb.green.vegetation = await fetchVegetationMask(panelExtent(sb.bleedPanel), dataDir, 0.8, 1 / mercatorScaleFactor(mercatorToLonLat(sb.geocode.center).lat));
  console.log(`vegetation: ${sb.green.vegetation.pxWidth}×${sb.green.vegetation.pxHeight}, ${sb.green.vegetation.sharePct} %`);
}
if (what.has('photos')) {
  // Street View is read with GOOGLE_MAPS_API_KEY from the environment, never from a file
  const rings = (fc: { features: { geometry: unknown }[] }) => fc.features.flatMap((ft) => geomRings(ft.geometry as never));
  sb.photos = await fetchPhotos({ centre: mercatorToLonLat(sb.geocode.center), siteRings: rings(sb.base.siteLots), pairPanel: sb.photos.pair.panel, outDir: dataDir, log, lots: rings(sb.base.lots), buildings: sb.buildings.buildings.flatMap((x: { rings: number[][][] }) => x.rings) });
  console.log(`photos: ${sb.photos.photos.length} (${sb.photos.photos.filter((x: { source: string }) => x.source === 'google').length} Street View)`);
}
if (what.has('placesv')) {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  sb.character.placeStreetViews = await fetchPlaceStreetViews(sb.character.places.items.slice(0, 8).map((pl: { title: string; lon: number; lat: number }, i: number) => ({ n: i + 1, title: pl.title, lon: pl.lon, lat: pl.lat })), dataDir, key, undefined, log);
  console.log(`place street views: ${sb.character.placeStreetViews.length}`);
}
if (what.has('series')) {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set');
  const st = addressStreet(sb.siteAddress, sb.base.roads, mercatorToLonLat(sb.geocode.center));
  console.log('street:', st?.name, st?.segments.length);
  if (st) sb.photos.series = await fetchStreetSeries(st.name, st.segments, mercatorToLonLat(sb.geocode.center), dataDir, key, undefined, 8, log);
}
await writeFile(join(outDir, 'slides.bundle'), serialize(kept));
console.log('bundle patched:', [...what].join(', '));

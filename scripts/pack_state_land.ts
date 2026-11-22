// Pack the NSW Government Property Index into the file the app reads (src/lib/stateLand.ts).
//
//   npx tsx scripts/pack_state_land.ts                      from the public copy of the index (below)
//   npx tsx scripts/pack_state_land.ts --from lots.ndjson   from GeoJSON features, one a line (or one FeatureCollection),
//                                                           with LOTREF and SOURCE: the Department's own download, converted
//   … --out <file>                                          somewhere other than assets/state-land/
//
// The index was published once, as at 12 October 2022, and its map service was
// withdrawn in November 2026. The Department's download of that release
// (tenure_government_property_index_12102022.zip, on the Planning Portal's open
// data page for the index) sits behind the Portal's browser check, so the
// default source is the same file as someone loaded it to ArcGIS Online on
// 23 October 2022: the same name, the same fields, 131,231 lots. Checked
// against the cadastre before it was first packed: 72 of 80 lots drawn at
// random were today's lots to the metre, the rest re-surveyed or re-subdivided
// since.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { packStateLand, STATE_LAND_FILE, STATE_LAND_SOURCES, type StateLandSource, type StateParcel } from '../src/lib/stateLand.js';

const COPY = 'https://services.arcgis.com/zmBQLV64TsFvEpV0/arcgis/rest/services/tenure_government_property_index_12102022/FeatureServer/0';
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const from = arg('--from'), out = arg('--out') ?? STATE_LAND_FILE;

const ringsOf = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const parcelOf = (f: any): StateParcel => {
  const source = String(f.properties?.SOURCE ?? '') as StateLandSource;
  if (!STATE_LAND_SOURCES.includes(source)) throw new Error(`a lot (${f.properties?.LOTREF}) from "${source}", which the index does not name`);
  return { lotRef: String(f.properties?.LOTREF ?? ''), source, rings: ringsOf(f.geometry) };
};

async function fromFile(path: string): Promise<StateParcel[]> {
  const text = await readFile(path, 'utf8');
  const features = text.trimStart().startsWith('{"type":"FeatureCollection"') || /^\s*\{\s*"type"\s*:\s*"FeatureCollection"/.test(text) ? JSON.parse(text).features : text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  return features.map(parcelOf);
}

/** The whole layer, a thousand lots a request by their row numbers (the layer gives 2,000 at most). */
async function fromLayer(url: string): Promise<StateParcel[]> {
  const ask = async (params: Record<string, string>): Promise<any> => {
    for (let tries = 1; ; tries++) {
      try {
        const res = await fetch(`${url}/query?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(180_000) });
        const data: any = await res.json();
        if (!res.ok || data.error) throw new Error(JSON.stringify(data.error ?? res.status));
        return data;
      } catch (e) { if (tries >= 5) throw e; await new Promise((r) => setTimeout(r, 3000 * tries)); }
    }
  };
  const { count } = await ask({ where: '1=1', returnCountOnly: 'true', f: 'json' });
  const top = (await ask({ where: '1=1', outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'FID', outStatisticFieldName: 'top' }]), f: 'json' })).features[0].attributes.top;
  const parcels: StateParcel[] = [];
  for (let lo = 0; lo < top; lo += 1000) {
    const page = await ask({ where: `FID>${lo} AND FID<=${lo + 1000}`, outFields: 'LOTREF,SOURCE', outSR: '4326', geometryPrecision: '7', f: 'geojson' });
    if (page.properties?.exceededTransferLimit || page.exceededTransferLimit) throw new Error(`rows ${lo} to ${lo + 1000} came back cut short`);
    parcels.push(...page.features.map(parcelOf));
    if (lo % 20_000 === 0) console.log(`  ${parcels.length} of ${count}`);
  }
  if (parcels.length !== count) throw new Error(`read ${parcels.length} lots where the layer counts ${count}`);
  return parcels;
}

const parcels = from ? await fromFile(from) : await fromLayer(COPY);
const { file, about, dropped } = packStateLand(parcels, {
  title: 'NSW Government Property Index',
  snapshot: '2022-10-12',
  publisher: 'NSW Department of Planning, Housing and Infrastructure',
  licence: 'Creative Commons Attribution (as the index\'s open-data record gives it)',
  from: from ? `a file of the index's lots (${from.split('/').pop()})` : `${COPY} (the Department's download of 12 October 2022 as loaded to ArcGIS Online on 23 October 2022)`,
  retrieved: new Date().toISOString().slice(0, 10),
});
await mkdir(dirname(out), { recursive: true });
await writeFile(out, file);
console.log(`${about.parcels} lots (${STATE_LAND_SOURCES.map((s) => `${about.bySource[s]} ${s}`).join(', ')})${dropped ? `, ${dropped} left out with no ring wider than 0.1 m` : ''}: ${(file.length / 1e6).toFixed(1)} MB at ${out}`);

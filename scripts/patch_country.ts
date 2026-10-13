// Re-read Country alone into a kept bundle (a development aid, as recompose.ts).
import { readFile, writeFile } from 'node:fs/promises';
import { deserialize, serialize } from 'node:v8';
import { join } from 'node:path';
import { fetchCountry } from '../src/fetch/country.js';
import { panelExtent } from '../src/render/minimap.js';
import { mercatorScaleFactor, mercatorToLonLat } from '../src/lib/geo.js';

const outDir = process.argv[2];
const kept = deserialize(await readFile(join(outDir, 'slides.bundle')));
const sb = kept.sb;
const w = panelExtent(sb.wide.panel), c = panelExtent(sb.countryPanel);
const ext = { xmin: Math.min(w.xmin, c.xmin), ymin: Math.min(w.ymin, c.ymin), xmax: Math.max(w.xmax, c.xmax), ymax: Math.max(w.ymax, c.ymax) };
const k = mercatorScaleFactor(mercatorToLonLat(sb.geocode.center).lat);
sb.country = await fetchCountry(ext, Math.round((ext.xmax - ext.xmin) / k / 2), Math.round((ext.ymax - ext.ymin) / k / 2), sb.geocode.center, join(outDir, 'data'), (m) => console.log(m));
await writeFile(join(outDir, 'slides.bundle'), serialize(kept));
console.log('country patched:', sb.country.vegetation.classes.map((x: { pct: string; sharePct: number }) => `${x.pct} ${x.sharePct}%`).join('; '));

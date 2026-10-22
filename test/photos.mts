/* Slide 12's street-level frames with a stand-in for KartaView: a frame
 * gone from its file store drops out quietly and the rest close up, while
 * the nearby-photos listing not answering is a WARN, the word the samples
 * workflow refuses to commit on. No network: every request is answered here.
 *
 *   npx tsx test/photos.mts
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPhotos } from '../src/fetch/photos.js';
import { lonLatToMercator, type LonLat } from '../src/lib/geo.js';
import type { Panel } from '../src/render/minimap.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };

/**
 * A 20 m square site about a point no real run caches, a fresh one for each
 * run so the listing's cache never answers for the stand-in, and three
 * frames facing it from the south, east and north, 15 m off its edges.
 */
function scene() {
  const O: LonLat = { lon: 150 + Math.random() * 0.5, lat: -34.5 - Math.random() * 0.5 };
  const KX = 111_320 * Math.cos((O.lat * Math.PI) / 180), KY = 110_574;
  const ll = (x: number, y: number) => ({ lon: O.lon + x / KX, lat: O.lat + y / KY });
  const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]].map(([x, y]) => { const p = ll(x, y); return [p.lon, p.lat]; });
  const frames = [
    { id: 1, x: 0, y: -25, heading: 0 },
    { id: 2, x: 25, y: 0, heading: 270 },
    { id: 3, x: 0, y: 25, heading: 180 },
  ].map((f) => ({ id: f.id, sequence_id: 900 + f.id, sequence_index: 1, lat: ll(f.x, f.y).lat, lng: ll(f.x, f.y).lon, heading: f.heading, shot_date: '2024-05-01 10:00:00', lth_name: `storage/lth/frame_${f.id}.jpg`, username: 'someone' }));
  const pairPanel: Panel = { center: lonLatToMercator(O), scale: 1000, wMm: 100, hMm: 75 };
  return { O, ring, frames, pairPanel };
}
const JPEG = new Uint8Array(4000).fill(7);

function stub(frames: unknown[], listing: 'ok' | 'down', gone: number[]) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/list/nearby-photos/')) {
      return listing === 'ok' ? new Response(JSON.stringify({ currentPageItems: frames }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('down', { status: 404 });
    }
    const m = url.match(/frame_(\d+)\.jpg$/);
    if (m) return gone.includes(Number(m[1])) ? new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }) : new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response('no', { status: 404 });   // the 1943 tiles and today's aerial: not what is tested here
  }) as typeof fetch;
}

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', '.cache', 'kartaview');

async function run(listing: 'ok' | 'down', gone: number[]) {
  const { O, ring, frames, pairPanel } = scene();
  stub(frames, listing, gone);
  const outDir = await mkdtemp(join(tmpdir(), 'photos-test-'));
  const lines: string[] = [];
  const data = await fetchPhotos({ centre: O, siteRings: [ring], pairPanel, outDir, log: (m) => lines.push(m) });
  const files = (await readdir(outDir)).filter((f) => f.startsWith('photo_')).sort();
  await rm(outDir, { recursive: true, force: true });
  // the listing the stand-in left in the cache, under the name photos.ts gives it
  await rm(join(CACHE, `${O.lat.toFixed(5)}_${O.lon.toFixed(5)}_250.json`.replace(/[^a-z0-9.+-]+/g, '-').replace(/^-|-$/g, '')), { force: true });
  // only the lines about street-level frames: today's aerial is answered with a 404 here and warns of its own
  const warns = lines.filter((l) => /(^|\s)WARN\s/.test(l) && /street-level|KartaView/.test(l));
  return { data, files, lines, warns };
}

delete process.env.MAPILLARY_TOKEN; delete process.env.GOOGLE_MAPS_API_KEY;
const real = globalThis.fetch;
try {
  // every frame downloads: three kept, numbered clockwise, no skip
  {
    const r = await run('ok', []);
    check('all frames: three kept', r.data.photos.length === 3, `kept ${r.data.photos.map((p) => p.id)}`);
    check('all frames: no WARN', r.warns.length === 0, r.warns.join(' | '));
    check('all frames: no skip noted', !r.lines.some((l) => l.includes('skipped')));
  }
  // the east frame is gone: the others keep their cells and close up, and it is a note, not a WARN
  {
    const r = await run('ok', [2]);
    check('one gone: two kept', r.data.photos.length === 2, `kept ${r.data.photos.map((p) => p.id)}`);
    check('one gone: the gone frame is not shown', !r.data.photos.some((p) => p.id === '2'));
    check('one gone: numbered 1 and 2', r.data.photos.map((p) => `${p.n}:${p.file}`).join(',') === '1:photo_1.jpg,2:photo_2.jpg', r.data.photos.map((p) => `${p.n}:${p.file}`).join(','));
    check('one gone: the files on disk are the kept ones', r.files.join(',') === 'photo_1.jpg,photo_2.jpg', r.files.join(','));
    check('one gone: no WARN', r.warns.length === 0, r.warns.join(' | '));
    check('one gone: a note names the frame', r.lines.some((l) => /street-level frame kartaview 2 skipped: did not download \(HTTP 404\)/.test(l)), r.lines.join(' | '));
    check('one gone: the summary counts it', r.lines.some((l) => l.includes('2 kept (1 did not download)')), r.lines.find((l) => l.includes('photos:')) ?? '');
  }
  // every frame gone, as at 150 George Street, Parramatta: none shown, the slide's placeholder takes over, still no WARN
  {
    const r = await run('ok', [1, 2, 3]);
    check('all gone: none kept', r.data.photos.length === 0 && r.files.length === 0);
    check('all gone: the listing still reads as answered', r.data.kartaview.ok && r.data.kartaview.frames === 3);
    check('all gone: no WARN', r.warns.length === 0, r.warns.join(' | '));
  }
  // KartaView's listing does not answer: a WARN
  {
    const r = await run('down', []);
    check('listing down: not ok', !r.data.kartaview.ok);
    check('listing down: one WARN', r.warns.length === 1 && /WARN street-level frames \(KartaView\) failed: KartaView nearby-photos returned HTTP 404/.test(r.warns[0]), r.warns.join(' | '));
  }
} finally {
  globalThis.fetch = real;
}

if (failures.length) {
  console.error(`photos: ${failures.length} failed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('photos: all checks passed');

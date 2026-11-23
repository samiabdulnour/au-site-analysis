/* The deck's site aerial where the imagery answers no window as small as the
 * site panel's (siteAerial, src/fetch/site.ts): a wider window about the same
 * centre is fetched and placed so the panel shows its middle. In a country
 * town the imagery refuses a small window however coarse the picture; the
 * deck's site page for a shop-sized lot in Orange was drawn on blank paper.
 * The imagery is stood in for; no network.
 *
 *   npx tsx test/site-aerial.mts
 */

import { siteAerial, SITE_AERIAL_WIDER } from '../src/fetch/site.js';
import type { AerialResult } from '../src/fetch/imagery.js';
import type { Extent } from '../src/lib/geo.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail: unknown = '') => { if (!ok) failures.push(`${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

const asked: number[] = [];
/** An imagery service that answers no window narrower than `least` metres, and any other with two tiles side by side. */
const imagery = (least: number) => async (extent: Extent, px: number, _dir: string, prefix?: string): Promise<AerialResult> => {
  const w = extent.xmax - extent.xmin;
  asked.push(Math.round(w));
  if (w < least) throw new Error('aerial imagery unavailable for this extent');
  return { tiles: [{ file: `${prefix}_0_0.jpg`, left: 0, top: 0, width: 0.5, height: 1 }, { file: `${prefix}_0_1.jpg`, left: 0.5, top: 0, width: 0.5, height: 1 }], pxWidth: px, pxHeight: px, extent };
};
// a site panel 50 m wide and 70 m high
const panel: Extent = { xmin: 16_600_000, ymin: -3_930_070, xmax: 16_600_050, ymax: -3_930_000 };
const said: string[] = [];
const log = (m: string) => said.push(m);

// the imagery answers the panel itself: as it was
asked.length = 0; said.length = 0;
const plain = await siteAerial(panel, 'out', log, imagery(40));
check('a window the imagery answers is taken as it is', asked.join() === '50' && plain.tiles.length === 2 && plain.tiles[0].left === 0 && plain.tiles[1].left === 0.5 && plain.tiles[0].width === 0.5 && said.length === 0, { asked, tiles: plain.tiles, said });

// the imagery answers nothing under 100 m: 50 fails, 75 fails, 125 answers
asked.length = 0; said.length = 0;
const wide = await siteAerial(panel, 'out', log, imagery(100));
check('refused, it asks wider about the same centre until one answers', asked.join() === '50,75,125', asked);
const [a, b] = wide.tiles;
check('the wider picture is placed so the panel shows its middle: two and a half times the panel, a quarter of it past each edge', a.left === -0.75 && a.width === 1.25 && b.left === 0.5 && b.width === 1.25 && a.top === -0.75 && a.height === 2.5, wide.tiles);
check('its middle is the panel\'s middle', a.left + a.width === 0.5 && (a.top + a.height / 2) === 0.5, wide.tiles);
check('it is still the site aerial: its files, the panel\'s extent', a.file === 'site_aerial_0_0.jpg' && wide.extent === panel, { file: a.file, extent: wide.extent });
check('the log says so without the pipelines\' warning word', said.length === 1 && /2\.5 times as wide/.test(said[0]) && !/WARN/.test(said[0]), said);

// the widths asked for are the panel's times each step
asked.length = 0;
const none = await siteAerial(panel, 'out', log, imagery(1e9)).then(() => 'answered', (e: Error) => e.message);
check('nothing answers: every step is tried and the first refusal is the one reported', none === 'aerial imagery unavailable for this extent' && asked.join() === ['50', ...SITE_AERIAL_WIDER.map((k) => String(Math.round(50 * k)))].join(), { none, asked });

if (failures.length) { console.error(`site-aerial: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('site-aerial: a refused window is asked for wider and shown at its middle; all checks pass');

/* Heron is black, white and one colour (2026-11): the site analysis sheet, the
 * yield and the site report in black lines, hatches and Heron's accent alone,
 * plain and conventional; its context sheet keeps the office palette.
 *
 * Every ink the decks and the site sheet take in Heron is either a grey or a
 * tint or shade of the accent; Kingfisher's are not, so the check can fail.
 * The sun hours' heat map on the compliance views is the exception: exactly
 * the context sheet's colours.
 * Then a page asking for its photographs in grey prints them grey, as
 * compressed pictures (render/pdf.ts).
 *
 *   npx tsx test/heron-mono.mts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import {
  withTemplate, templateFor, deckLook, deckFamilies, siteTheme, tpl, TEMPLATES, HERON_ACCENT, HERON_SUN, HERON_MONO, HERON_PLAIN, type Category,
} from '../src/render/template.js';
import { siteMark, siteSwatch, siteOutlineRings, type BaseData } from '../src/render/minimap.js';

/** A site of one small lot, for the mark: a few metres square in the test's own projection. */
const SITE_BASE = { siteLots: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] } }] } } as unknown as BaseData;
import { paletteRamp, terrainRamp, styleRamp, heightRamp, heatFills, massingInks, categoryFill, veg1750Fills } from '../src/render/atlasKit.js';
import { textureSvg } from '../src/render/sheet.js';
import { sunBands } from '../src/render/facadeElevation.js';
import { printSlides, launch } from '../src/render/pdf.js';
import { PDFDocument, PDFRawStream, PDFName } from 'pdf-lib';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const rgb = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hue = ([r, g, b]: number[]) => {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const ACCENT_HUE = hue(rgb(HERON_ACCENT));
/** A grey (no hue to speak of), or a tint or shade of the accent; anything else is a second colour. */
const inPalette = (hex: string) => {
  const c = rgb(hex), chroma = Math.max(...c) - Math.min(...c);
  if (chroma <= 8) return true;
  const dh = Math.abs(hue(c) - ACCENT_HUE);
  return Math.min(dh, 360 - dh) <= 12;
};
const hexes = (v: unknown): string[] =>
  typeof v === 'string' ? (/^#[0-9a-f]{6}$/i.test(v) ? [v] : []) : Array.isArray(v) ? v.flatMap(hexes) : v && typeof v === 'object' ? Object.values(v).flatMap(hexes) : [];
const strays = (v: unknown) => [...new Set(hexes(v).filter((h) => !inPalette(h)))];

/** Every ink a deck takes in the active style: its look, its families, its categories and its ramps. */
const deckInks = () => ({
  look: deckLook(), families: deckFamilies(), ramps: [paletteRamp(), terrainRamp(), styleRamp(), heightRamp()], massing: massingInks(),
  template: { ...tpl(), categories: tpl().categories.map((c: Category) => c) },
});

console.log('Heron mono');
check('the yield and the site sheet draw on the mono template', templateFor('yield', 'heron') === HERON_MONO && templateFor('site', 'heron') === HERON_MONO);
// The site report is black and white alone (Z. 2026-11: "do not use different colours for Heron; just make the site a
// thick line and the trees black with a hatch"): its own template, no accent in any ink, the site a heavy dash-dot line.
check('the site report draws on the plain template, black and white alone', templateFor('slides', 'heron') === HERON_PLAIN && HERON_PLAIN.plain === true && HERON_PLAIN.id === 'heron');
{
  const grey = (h: string) => new Set(rgb(h)).size === 1;
  const inks = withTemplate(templateFor('slides', 'heron'), () => ({ site: tpl().site, accent: deckLook().accent, families: Object.values(deckFamilies()).flatMap((f) => Object.values(f)), categories: deckLook().categories.map((c) => c.fill), walk: styleRamp() }));
  const all = [inks.site, inks.accent, ...inks.families, ...inks.categories, ...inks.walk];
  check('the site report: no ink has a colour, the accent\'s family and the site\'s category included', all.every(grey), all.filter((c) => !grey(c)).join(' '));
  check('the site report: the site\'s pen and the narrative are black', inks.site === '#1a1a1a' && inks.accent === '#1a1a1a', `${inks.site} ${inks.accent}`);
  const mark = withTemplate(templateFor('slides', 'heron'), () => siteMark(SITE_BASE, (lon, lat) => [lon * 1000, lat * 1000] as [number, number], 'both'));
  check('the site report: the site is a heavy dash-dot line, white under it, nothing filled', /data-site-line[^>]*fill="none"[^>]*stroke="#1a1a1a"[^>]*stroke-width="0\.9"[^>]*stroke-dasharray=/.test(mark) && !/fill="#1a1a1a"/.test(mark) && mark.indexOf('stroke="#ffffff"') < mark.indexOf('data-site-line') && mark.indexOf('stroke="#ffffff"') >= 0, mark.slice(0, 300));
  check('the site report: the wash under a map\'s own marks is nothing', withTemplate(templateFor('slides', 'heron'), () => siteMark(SITE_BASE, (lon, lat) => [lon * 1000, lat * 1000] as [number, number], 'wash')) === '');
  const yieldMark = withTemplate(templateFor('yield', 'heron'), () => siteMark(SITE_BASE, (lon, lat) => [lon * 1000, lat * 1000] as [number, number], 'both'));
  check('the yield keeps the site in its one colour', yieldMark.includes(HERON_ACCENT) && !yieldMark.includes('data-site-line'));
  // an amalgamated site: three lots side by side, the third half as deep, are one outline of eight corners, with
  // no line between them (Z. 2026-11: "there should be one thick outline around the whole amalgamated site")
  const lotAt = (x: number, w: number, h: number) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + w, 0], [x + w, h], [x, h], [x, 0]]] } });
  const THREE = { siteLots: { type: 'FeatureCollection', features: [lotAt(0, 0.01, 0.02), lotAt(0.01, 0.01, 0.02), lotAt(0.02, 0.01, 0.01)] } } as unknown as BaseData;
  const joined = siteOutlineRings(THREE.siteLots);
  check('three adjoining lots are one outline', joined.length === 1 && joined[0].length >= 7 && joined[0].length <= 10, `${joined.length} rings of ${joined.map((r) => r.length).join(', ')} points`);
  const xs = joined[0].map((q) => q[0]), ys = joined[0].map((q) => q[1]);
  check('round the whole of it', Math.abs(Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...xs) - 0.03) < 1e-9 && Math.abs(Math.max(...ys) - 0.02) < 1e-9);
  const lineOf = (m: string) => m.match(/data-site-line d="([^"]+)"/)?.[1] ?? '';
  const threeMark = withTemplate(templateFor('slides', 'heron'), () => siteMark(THREE, (lon, lat) => [lon * 1000, lat * 1000] as [number, number], 'both'));
  check('the site\'s heavy line is drawn once round the three lots, not round each', (lineOf(threeMark).match(/M/g) ?? []).length === 1, lineOf(threeMark));
  check('no stroke of it runs between two lots', !/M10\.00,0\.00L10\.00,20\.00|L10\.00,20\.00L10\.00,0\.00/.test(lineOf(threeMark)) && !lineOf(threeMark).includes('M10.00'), lineOf(threeMark));
  const colour = withTemplate(templateFor('slides', 'canary'), () => siteMark({ siteLots: { type: 'FeatureCollection', features: [lotAt(0, 0.1, 0.2), lotAt(0.1, 0.1, 0.2), lotAt(0.2, 0.1, 0.1)] } } as unknown as BaseData, (lon, lat) => [lon * 1000, lat * 1000] as [number, number], 'outline'));
  check('in the colour styles too, at plan scale, the outline is one', (colour.match(/ d="([^"]+)"/)?.[1].match(/M/g) ?? []).length === 1, colour.slice(0, 200));
  const apart = siteOutlineRings({ type: 'FeatureCollection', features: [lotAt(0, 0.01, 0.02), lotAt(0.02, 0.01, 0.02)] } as never);
  check('two lots a lane apart keep an outline each', apart.length === 2);
  const sw = withTemplate(templateFor('slides', 'heron'), () => siteSwatch());
  check('the key\'s site is the same line, not a filled square', /fill="none"/.test(sw) && /stroke-dasharray/.test(sw));
}
check('the context sheet keeps the Heron template', templateFor('context', 'heron') === 'heron');

for (const sheet of ['slides', 'yield'] as const) {
  const bad = withTemplate(templateFor(sheet, 'heron'), () => strays(deckInks()));
  check(`${sheet}: every ink a grey or the accent`, bad.length === 0, bad.join(' '));
}
// The storeys of the height of buildings page and the landform stay black and white: their ramps are greys.
{
  const ramps = withTemplate(templateFor('slides', 'heron'), () => ({ storeys: heightRamp(), landform: terrainRamp(), tones: heatFills(5, 'tone', heightRamp()).map((f) => f.bg!) }));
  const grey = (h: string) => new Set(rgb(h)).size === 1;
  check('the storeys\' and the landform\'s ramps are greys, and the storeys\' tones', [...ramps.storeys, ...ramps.landform, ...ramps.tones].every(grey), [...ramps.storeys, ...ramps.landform, ...ramps.tones].filter((c) => !grey(c)).join(' '));
}
// The sun hours' heat map on the compliance views is the one place the decks take colour beside the accent: exactly
// the colours Heron's context sheet prints, cool to warm, the sheet's red for the most sun.
{
  const context = TEMPLATES.find((t) => t.id === 'heron')!;
  const printed = new Set([...context.categories.flatMap((c) => [c.fill, c.stroke, c.textureColor, c.figure]), context.site, context.dimension, context.wind, context.transit, context.rail, context.walk5, context.walk10, context.busRoute, context.heritage, context.discInk, context.discParkInk]
    .filter((c): c is string => !!c).map((c) => c.toLowerCase()));
  const sun = withTemplate(templateFor('yield', 'heron'), () => sunBands().map((x) => x.fill.toLowerCase()));
  check('sun hours: seven bands, each exactly a colour the context sheet prints, none twice', sun.length === 7 && sun.every((c) => printed.has(c)) && new Set(sun).size === 7, sun.filter((c) => !printed.has(c)).join(' '));
  check('sun hours: the bands are HERON_SUN, the context sheet\'s red for the most sun', sun.join() === HERON_SUN.map((c) => c.toLowerCase()).join() && sun[6] === context.site.toLowerCase());
  const kf = withTemplate(templateFor('yield', 'kingfisher'), () => sunBands().map((x) => x.fill.toLowerCase()));
  check('sun hours: Kingfisher keeps its own bands', kf.join() !== sun.join());
}
const look = siteTheme('heron').look;
const badSite = strays(look);
check('site sheet: every ink a grey or the accent', badSite.length === 0, badSite.join(' '));
check('site sheet: the site, its dimensions and its fall words in the accent', look.site === HERON_ACCENT && look.dimensionInk === HERON_ACCENT && look.fallInk === HERON_ACCENT);
check('the yield\'s narrative in the accent', withTemplate(templateFor('yield', 'heron'), () => deckLook().accent) === HERON_ACCENT);
// Black lines, hatches not shades, on white paper: the decks in the line technique, the site sheet's linework black.
const dl = withTemplate(templateFor('slides', 'heron'), () => deckLook());
check('the decks on paper, in lines and hatches', dl.ground === 'paper' && dl.technique === 'line');
const dark = (h: string | undefined) => !!h && Math.max(...rgb(h)) <= 0x30;
check('site sheet: the lots, the outlines, the names and the climate marks in black, none in white',
  [look.lotInk, look.outlineInk, look.neighbourInk, look.streetInk, look.sunPen, look.windPen, look.viewPen, look.noisePen, look.fall, look.hatchInk].every(dark));
check('site sheet: the zones hatched alone, no shade under them', look.zones === 'hatch' && look.zoneTint === 0);
check('site sheet: the contours dotted, as a site plan draws them', look.contourDots === true);
// the 3D views a line model: the low buildings white, a light tone only as they rise
const bands = withTemplate(templateFor('slides', 'heron'), () => massingInks().bands);
check('the 3D views: the lowest buildings white, the tallest a light grey', bands[0] === '#ffffff' && bands.every((c) => Math.min(...rgb(c)) >= 0xa0), bands.join(' '));
// every category a zone can take has a hatch of its own: the pattern is all that tells them apart
const ZONE_CATS = ['r2', 'r3', 'r4', 'localCentre', 'commercial', 'mixedUse', 'industrial', 'infrastructure', 'openSpace', 'water'];
const zoneCats = ZONE_CATS.map((id) => HERON_MONO.categories.find((c) => c.id === id));
const sig = (h: { kind: string; step?: number; dir?: string } | undefined) => (h ? `${h.kind}/${h.dir ?? 'fall'}/${h.step ?? ''}` : '');
check('each zone category has a hatch of its own', zoneCats.every((c) => c?.hatch) && new Set(zoneCats.map((c) => sig(c?.hatch))).size === ZONE_CATS.length, zoneCats.map((c) => `${c?.id}:${sig(c?.hatch)}`).join(' '));
const fills = withTemplate(templateFor('slides', 'heron'), () => zoneCats.map((c) => categoryFill(c!, 'paper')));
check('the decks draw a zone as its hatch in black on white, each its own', fills.every((f) => f.bg === '#ffffff' && !!f.kind && dark(f.ink)) && new Set(fills.map((f) => `${f.kind}/${f.step}`)).size === ZONE_CATS.length,
  fills.map((f) => `${f.kind}/${f.step?.toFixed(2)}`).join(' '));
// the hatch leans as asked: falling, rising, flat or upright lines
const leans = (['fall', 'rise', 'flat', 'up'] as const).map((dir) => {
  const first = /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/.exec(textureSvg('t', 'M0,0H20V20H0Z', 'lines', '#000000', { x: 0, y: 0, w: 20, h: 20 }, 1, { step: 2, dir }))!.slice(1).map(Number);
  const dx = first[2] - first[0], dy = first[3] - first[1];
  return dir === 'fall' ? dx > 0 && dy > 0 : dir === 'rise' ? dx > 0 && dy < 0 : dir === 'flat' ? dx > 0 && dy === 0 : dx === 0 && dy > 0;
});
check('a hatch leans as asked: falling, rising, flat, upright', leans.every(Boolean), leans.join(' '));
// the plant communities of the Country page: a pattern each, with no colour to tell them by
const veg = withTemplate(templateFor('slides', 'heron'), () => veg1750Fills(Array.from({ length: 9 }, (_, i) => ({ pct: `community ${i}` }))));
check('the nine plant communities each a pattern of their own', new Set(veg.map((f) => `${f.kind}/${f.step}`)).size === 9 && veg.every((f) => !f.bg && dark(f.ink)));

// the check can tell: Kingfisher's decks are in colour
const kf = withTemplate(templateFor('slides', 'kingfisher'), () => strays(deckInks()));
check('the check catches a second colour (Kingfisher)', kf.length > 0);

// A page asking for its photographs in grey prints them grey: a red picture beside it comes out without its red.
const png = (w: number, h: number, [r, g, b]: number[]) => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
};
const dir = mkdtempSync(join(tmpdir(), 'heron-mono-'));
try {
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'red.png'), png(64, 64, [220, 30, 30]));
  const page = (grey: boolean) => `<!DOCTYPE html><html><head><style>@page { size: 60mm 40mm; margin: 0 } body { margin: 0 }${grey ? ' :root { --photos: grey; }' : ''}</style></head>
<body><section class="slide" style="width:60mm;height:40mm;position:relative"><img src="data/red.png" style="width:30mm;height:30mm;display:block"><svg width="20mm" height="20mm" viewBox="0 0 20 20" style="position:absolute;left:35mm;top:0"><image href="data/red.png" width="20" height="20"/></svg></section></body></html>`;
  // the PNGs a print makes are the page as printed: their pixels say whether the red came through
  const redOf = async (grey: boolean) => {
    const html = join(dir, `p-${grey}.html`);
    writeFileSync(html, page(grey));
    const [shot] = await printSlides(html, join(dir, `p-${grey}.pdf`), join(dir, `png-${grey}`), { widthMm: 60, heightMm: 40 }, undefined, () => undefined);
    return shot;
  };
  const shots = [await redOf(false), await redOf(true)];
  // the PNGs' pixels are compressed; a browser reads them back
  const browser = await launch();
  try {
    const p = await browser.newPage();
    const reds: number[] = [];
    for (const shot of shots) {
      const b64 = readFileSync(shot).toString('base64');
      reds.push(await p.evaluate(async (src) => {
        const bmp = await createImageBitmap(await (await fetch(src)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d')!;
        cx.drawImage(bmp, 0, 0);
        const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] - Math.max(d[i + 1], d[i + 2]) > 60) n++;
        return n;
      }, `data:image/png;base64,${b64}`));
    }
    check('in colour, the picture prints red', reds[0] > 1000, `${reds[0]} red pixels`);
    check('asked for grey, the picture (img and svg image) prints without its red', reds[1] === 0, `${reds[1]} red pixels`);
  } finally { await browser.close(); }
  // the grey picture goes into the PDF as itself, 64 pixels wide: a CSS filter would have Chromium rasterise the page
  // round it, a picture as wide as the page at 300 dpi
  const doc = await PDFDocument.load(readFileSync(join(dir, 'p-true.pdf')));
  const widths = doc.context.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image' ? [Number(o.dict.get(PDFName.of('Width'))?.toString())] : []));
  check('the grey picture printed as itself, not rasterised with its page', widths.length > 0 && widths.every((w) => w === 64), `image widths ${widths.join(', ')}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) { console.error(`FAIL: ${failed} check(s)`); process.exit(1); }
console.log('  ok — Heron is black, white and one colour');

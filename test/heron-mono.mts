/* Heron is black, white and one colour (2026-11): the site analysis sheet, the
 * yield and the site report in greys and Heron's accent alone, plain and
 * conventional; its context sheet keeps the office palette.
 *
 * Every ink the decks and the site sheet take in Heron is either a grey or a
 * tint or shade of the accent; Kingfisher's are not, so the check can fail.
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
  withTemplate, templateFor, deckLook, deckFamilies, siteTheme, tpl, HERON_ACCENT, HERON_MONO, type Category,
} from '../src/render/template.js';
import { paletteRamp, terrainRamp, styleRamp, heightRamp, massingInks } from '../src/render/atlasKit.js';
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
check('the decks and the site sheet draw on the mono template', templateFor('slides', 'heron') === HERON_MONO && templateFor('yield', 'heron') === HERON_MONO && templateFor('site', 'heron') === HERON_MONO);
check('the context sheet keeps the Heron template', templateFor('context', 'heron') === 'heron');

for (const sheet of ['slides', 'yield'] as const) {
  const bad = withTemplate(templateFor(sheet, 'heron'), () => strays(deckInks()));
  check(`${sheet}: every ink a grey or the accent`, bad.length === 0, bad.join(' '));
}
const look = siteTheme('heron').look;
const badSite = strays(look);
check('site sheet: every ink a grey or the accent', badSite.length === 0, badSite.join(' '));
check('site sheet: the site, its dimensions and its fall words in the accent', look.site === HERON_ACCENT && look.dimensionInk === HERON_ACCENT && look.fallInk === HERON_ACCENT);
check('the narrative in the accent', withTemplate(templateFor('slides', 'heron'), () => deckLook().accent) === HERON_ACCENT);
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

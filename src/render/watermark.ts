// The free side's watermark, stamped onto a finished PDF when a free account
// downloads it. The sheet on disk stays clean, so a subscriber asking for the
// same address is handed that one.
//
// The artwork is assets/watermark/watermark.pdf: the office's bird sheet, one
// vector page laid over the whole of every page, embedded once and drawn on
// each. A watermark.png there instead is drawn once in the middle of every
// page. With neither, a line of text stands in. Whichever it is, the site's
// address goes in the bottom-left corner.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'watermark');
const VECTOR = join(DIR, 'watermark.pdf');
const ARTWORK = join(DIR, 'watermark.png');
// The birds are a pale line drawing that must read over the map without
// hiding it; the picture and the words are solid, so they go fainter.
const VECTOR_OPACITY = 0.3;
const OPACITY = 0.2;
// Where the free PDF came from, in the bottom-left corner of every page: on the
// A1 in the margin under the map, aligned with the frame's left edge (28 mm in
// on 841, a 17 mm margin on 594), and placed as fractions of the page so an A3
// page carries it the same way.
const ADDRESS = 'site-analyst.com';
const ADDRESS_X = 28 / 841, ADDRESS_Y = 6.4 / 594, ADDRESS_SIZE = 6.2 / 594;

/** The artwork in use: the vector page, else the picture, else none (the words). */
function artwork(): string | undefined {
  return existsSync(VECTOR) ? VECTOR : existsSync(ARTWORK) ? ARTWORK : undefined;
}

/**
 * Changes whenever the artwork or the way it is stamped does, and names the
 * stamped copies — so a new watermark is never served from the cache of an old one.
 */
export function watermarkId(): string {
  const art = artwork();
  return createHash('sha256')
    .update(art ? readFileSync(art) : 'text')
    .update(`${VECTOR_OPACITY}|${OPACITY}|${ADDRESS}|${ADDRESS_X}|${ADDRESS_Y}|${ADDRESS_SIZE}`)
    .digest('hex').slice(0, 12);
}

/** Stamp every page of src into dest, written whole and moved into place. */
export async function stampPdf(src: string, dest: string): Promise<void> {
  const doc = await PDFDocument.load(await readFile(src), { updateMetadata: false });
  const art = artwork();
  const birds = art === VECTOR ? (await doc.embedPdf(await readFile(VECTOR), [0]))[0] : undefined;
  const picture = art === ARTWORK ? await doc.embedPng(await readFile(ARTWORK)) : undefined;
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(ADDRESS, {
      x: width * ADDRESS_X, y: height * ADDRESS_Y, size: height * ADDRESS_SIZE, font,
      color: rgb(0.24, 0.24, 0.24), opacity: 0.85,
    });
    if (birds) {
      // As large as the page holds it, centred: an A-size sheet and the
      // artwork are nearly the same shape, so it reaches every edge.
      const s = Math.min(width / birds.width, height / birds.height);
      const w = birds.width * s, h = birds.height * s;
      page.drawPage(birds, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity: VECTOR_OPACITY });
    } else if (picture) {
      const w = width * 0.6, h = (w * picture.height) / picture.width;
      page.drawImage(picture, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity: OPACITY });
    } else {
      const text = 'SITE ANALYST · FREE';
      const size = (width * 0.6) / font.widthOfTextAtSize(text, 1);
      page.drawText(text, {
        x: width * 0.2, y: height / 2 - size * 0.35, size, font,
        color: rgb(0, 0, 0), opacity: OPACITY,
      });
    }
  }
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, await doc.save({ useObjectStreams: false }));
  await rename(tmp, dest);
}

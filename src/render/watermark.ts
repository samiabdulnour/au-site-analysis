// The free side's watermark, stamped onto a finished PDF when a free account
// downloads it. The sheet on disk stays clean, so a subscriber asking for the
// same address is handed that one.
//
// The artwork is assets/watermark/watermark.png (transparency kept), drawn once
// in the middle of every page. Until it is there, a line of text stands in.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTWORK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'watermark', 'watermark.png');
const OPACITY = 0.2;

/**
 * Changes whenever the artwork does, and names the stamped copies — so a new
 * watermark is never served from the cache of an old one.
 */
export function watermarkId(): string {
  return createHash('sha256')
    .update(existsSync(ARTWORK) ? readFileSync(ARTWORK) : 'text')
    .digest('hex').slice(0, 12);
}

/** Stamp every page of src into dest, written whole and moved into place. */
export async function stampPdf(src: string, dest: string): Promise<void> {
  const doc = await PDFDocument.load(await readFile(src), { updateMetadata: false });
  const art = existsSync(ARTWORK) ? await doc.embedPng(await readFile(ARTWORK)) : undefined;
  const font = art ? undefined : await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (art) {
      const w = width * 0.6, h = (w * art.height) / art.width;
      page.drawImage(art, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h, opacity: OPACITY });
    } else {
      const text = 'SITE ANALYST · FREE';
      const size = (width * 0.6) / font!.widthOfTextAtSize(text, 1);
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

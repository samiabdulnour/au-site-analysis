// Print A3 sheets written as HTML (the future context's, or any at the deck's size) and bind them, in the order
// given, into one PDF, each page set to a true A3 width as the deck's are.
//
//   npx tsx scripts/print_sheets.ts out.pdf sheet-1.html sheet-2.html …
//
// Each sheet is also printed to a PNG beside its HTML.

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { printPage } from '../src/render/pdf.js';

const [out, ...sheets] = process.argv.slice(2);
if (!out || !sheets.length) {
  console.error('usage: npx tsx scripts/print_sheets.ts out.pdf sheet.html …');
  process.exit(1);
}
const A3_WIDTH_PT = (420 / 25.4) * 72;
const SIZE = { width: 4961, height: 3508 };           // the deck's sheet, A3 at 300 dpi
const doc = await PDFDocument.create();
for (const html of sheets) {
  const pdf = html.replace(/\.html$/, '.pdf');
  await printPage(html, SIZE, { png: html.replace(/\.html$/, '.png'), pdf });
  const one = await PDFDocument.load(await readFile(pdf));
  for (const p of one.getPages()) {
    const k = A3_WIDTH_PT / p.getWidth();
    p.scale(k, k);
  }
  for (const p of await doc.copyPages(one, one.getPageIndices())) doc.addPage(p);
  console.error(`  printed ${html}`);
}
await writeFile(out, await doc.save());
console.log(out);

// Shared sheet chrome: the measured A1 frame, title column, north point,
// scale bar and legend primitives — used by every sheet type (context
// analysis, site analysis, …) so the package stays visually consistent.

import type { SheetMeta } from './sheet.js';
import { tpl } from './template.js';

export const SHEET_W = 841;
export const SHEET_H = 594;
export const FRAME_L = 28;
export const FRAME_T = 10;
export const TITLE_X = 738.9;
export const TITLE_R = 831;
export const MAP_BOTTOM = 576.6;
export const MAP_W = TITLE_X - FRAME_L;    // 710.9
export const MAP_H = MAP_BOTTOM - FRAME_T; // 566.6

// Type scale measured from the original (mm). A template may run the whole
// scale up or down; the ratios between sizes stay fixed so the sheet keeps
// its hierarchy.
const BASE_T = {
  fine: 2.1,
  legend: 2.7,
  scalebar: 2.3,
  addr: 3.4,
  value: 4.1,
  street: 4.9,
  poi: 4.9,
  mapSymbol: 6.2,
};
export type TypeScale = typeof BASE_T;
export const typeScale = (): TypeScale => {
  const k = tpl().textScale;
  return Object.fromEntries(
    Object.entries(BASE_T).map(([key, v]) => [key, +(v * k).toFixed(2)]),
  ) as TypeScale;
};
/** Back-compat accessor used across the renderers. */
export const T = new Proxy({} as TypeScale, {
  get: (_t, key: string) => typeScale()[key as keyof TypeScale],
});

// Legend geometry within the title column
export const SWATCH_X = (743.7 - TITLE_X) + 1.5;
export const SWATCH_W = 23;
export const LABEL_X = 773 - TITLE_X;

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SheetHtmlOpts {
  meta: SheetMeta;
  address: string;
  generatedAt: string;
  siteAddress: string;
  scale: number;
  rotationDeg: number;
  drawingTitle: string;   // e.g. CONTEXT ANALYSIS / SITE ANALYSIS
  legendHeading: string;  // heading above the legend (usually 'LEGEND' or title)
  legendSvg: string;
  layers: string[];       // svg content of the map field
  /** Table sheets carry no map: no north point, no scale bar, no scale. */
  noMap?: boolean;
}

export function sheetHtml(o: SheetHtmlOpts): string {
  const { meta } = o;
  const TW = TITLE_R - TITLE_X;

  // Bar length adapts to the sheet scale (site sheets need a 10/20m bar,
  // context sheets a 100m bar); same stepped-outline style either way.
  const bar = o.scale <= 300 ? [0, 2, 5, 10] : o.scale <= 900 ? [0, 5, 10, 20] : [0, 20, 50, 100];
  const [m1, m2, m3] = [bar[1], bar[2], bar[3]];
  const full = m3;
  const mmFull = (full * 1000) / o.scale;
  const sbX = 742.3 - TITLE_X;
  const sbY = 3.4, step = 1.5;
  const sx = (m: number) => sbX + (m / full) * mmFull;
  const scaleBarSvg = `
    <path d="M${sx(0).toFixed(1)},${sbY} L${sx(0).toFixed(1)},${sbY - step} L${sx(m1 / 2).toFixed(1)},${sbY - step}
             L${sx(m1 / 2).toFixed(1)},${sbY} L${sx(m1).toFixed(1)},${sbY} L${sx(m1).toFixed(1)},${sbY - step}
             L${sx(m2).toFixed(1)},${sbY - step} L${sx(m2).toFixed(1)},${sbY} L${sx(m3).toFixed(1)},${sbY}
             L${sx(m3).toFixed(1)},${sbY - step}"
      fill="none" stroke="${tpl().ink}" stroke-width="0.25"/>
    ${bar.map((m) => `<text x="${sx(m).toFixed(1)}" y="${sbY + 3.0}" text-anchor="middle" font-size="${T.scalebar}" font-weight="700" fill="${tpl().ink}">${m}${m === m3 ? 'm' : ''}</text>`).join('')}`;

  const ink = tpl().ink;
  const northSvg = `
    <text x="9" y="3.0" text-anchor="middle" font-size="3.4" font-weight="700" fill="${ink}">N</text>
    <g transform="translate(9,10.8) rotate(${o.rotationDeg.toFixed(2)})" fill="${ink}">
      <path d="M0,-5.4 L1.9,4.6 L0,2.6 L-1.9,4.6 Z"/>
    </g>`;

  const field = (top: number, label: string, valueHtml: string) => `
    <div class="abs" style="top:${top}mm;left:4.8mm;right:0">
      <div class="k">${esc(label)}</div>${valueHtml}
    </div>`;
  const rule = (y: number) => `<div class="abs rule" style="top:${y}mm"></div>`;

  // The identity fields appear only when they carry something. A sheet
  // generated from an address has no job number, client, reviewer or revision,
  // and a column of empty ruled boxes is noise on the drawing. They still
  // render when the CLI is given --job/--client/--status/… so the office can
  // issue a completed sheet.
  interface Block { h: number; html: (top: number) => string }
  const blocks: Block[] = [];
  if (meta.client || (meta.clientLines ?? []).length) {
    blocks.push({ h: 24.6, html: (t) => `
      ${rule(t)}
      <div class="abs k" style="top:${t + 0.7}mm;left:4.8mm">CLIENT</div>
      ${meta.client ? `<div class="abs" style="top:${t + 4.6}mm;left:4.8mm;right:0;font-size:${T.value}mm;font-weight:700">${esc(meta.client)}</div>` : ''}
      <div class="abs fine" style="top:${t + 17}mm;left:4.8mm;right:0">${(meta.clientLines ?? []).map(esc).join('<br>')}</div>` });
  }
  if (meta.preliminary) {
    blocks.push({ h: 7, html: (t) => `<div class="abs prelim" style="top:${t}mm;left:2.6mm;right:2.6mm">P R E L I M I N A R Y</div>` });
  }
  if (!o.noMap) {
    blocks.push({ h: 25.8, html: (t) => `
      <svg class="abs" style="top:${t}mm;left:3.5mm" width="18mm" height="18mm" viewBox="0 0 18 18">${northSvg}</svg>
      <svg class="abs" style="top:${t + 17}mm;left:0" width="${TW}mm" height="8mm" viewBox="0 0 ${TW} 8">${scaleBarSvg}</svg>` });
  }
  blocks.push({ h: 15.6, html: (t) => `${rule(t)}${field(t + 0.8, 'SITE ADDRESS', `<div class="v-addr">${esc(o.siteAddress)}</div>`)}` });
  if (meta.jobNo) {
    blocks.push({ h: 11.1, html: (t) => `${rule(t)}${field(t + 0.8, 'JOB NO', `<div class="v">${esc(meta.jobNo)}</div>`)}` });
  }
  if (meta.checked || meta.drawn) {
    blocks.push({ h: 10.4, html: (t) => `
      ${rule(t)}
      <div class="abs" style="top:${t + 0.8}mm;left:4.8mm;right:0">
        <div style="display:grid;grid-template-columns:1fr 1fr">
          <div><div class="k">CHECKED</div><div class="v">${esc(meta.checked)}</div></div>
          <div><div class="k">DRAWN</div><div class="v">${esc(meta.drawn)}</div></div>
        </div>
      </div>` });
  }
  blocks.push({ h: 10.4, html: (t) => `
    ${meta.checked || meta.drawn ? '' : rule(t)}
    <div class="abs" style="top:${t + 0.8}mm;left:4.8mm;right:0">
      <div style="display:grid;grid-template-columns:1fr 1fr">
        <div>${meta.date ? `<div class="k">DATE</div><div class="v">${esc(meta.date)}</div>` : ''}</div>
        <div><div class="k">SCALE</div><div class="v">${o.noMap ? 'NTS' : `1:${o.scale} @ A1&nbsp;&nbsp;A3@50%`}</div></div>
      </div>
    </div>` });
  if (meta.status) {
    blocks.push({ h: 13.8, html: (t) => `${rule(t)}${field(t + 0.8, 'PROJECT STATUS', `<div class="v">${esc(meta.status)}</div>`)}` });
  }
  blocks.push({ h: 17, html: (t) => `${rule(t)}${field(t + 0.8, 'DRAWING TITLE', `<div class="v">${esc(o.drawingTitle)}</div>`)}` });
  if (meta.sheetNo || meta.revision) {
    blocks.push({ h: 11, html: (t) => `
      ${rule(t)}
      <div class="abs" style="top:${t + 0.8}mm;left:4.8mm;right:0">
        <div style="display:grid;grid-template-columns:1fr 1fr">
          <div><div class="k">SHEET NO.</div><div class="v">${esc(meta.sheetNo)}</div></div>
          <div><div class="k">REVISION</div><div class="v">${esc(meta.revision)}</div></div>
        </div>
      </div>` });
  }

  // Stack them so the last one finishes just above the sheet edge; the legend
  // takes whatever height is left above.
  const stackH = blocks.reduce((sum, b) => sum + b.h, 0);
  let cursor = SHEET_H - 8 - stackH;
  const identityTop = cursor;
  const identityHtml = blocks.map((b) => { const h = b.html(cursor); cursor += b.h; return h; }).join('');
  const legendH = Math.max(40, identityTop - 27);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(o.siteAddress)} — ${esc(o.drawingTitle)}</title>
<style>
  @page { size: ${SHEET_W}mm ${SHEET_H}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${SHEET_W}mm; height: ${SHEET_H}mm; font-family: ${tpl().font}; background: #fff; }
  .sheet { position: relative; width: ${SHEET_W}mm; height: ${SHEET_H}mm; overflow: hidden; }
  svg.map { position: absolute; left: ${FRAME_L}mm; top: ${FRAME_T}mm; }
  .titlecol { position: absolute; left: ${TITLE_X}mm; top: 0; width: ${TW}mm; height: ${SHEET_H}mm;
    background: #fff; font-size: ${T.fine}mm; color: #222; }
  .abs { position: absolute; }
  .rule { left: 2.6mm; right: 0; border-top: 0.15mm solid ${tpl().rule}; }
  .k { font-size: ${T.fine}mm; color: #444; }
  .fine { font-size: ${T.fine}mm; line-height: 1.22; color: #333; }
  .fine li { margin-left: 2.8mm; margin-bottom: 0.35mm; }
  .v-addr { font-size: ${T.addr}mm; font-weight: 400; line-height: 1.15; }
  .v { font-size: ${T.value}mm; font-weight: 400; line-height: 1.16; }
  .prelim { border: 0.6mm solid #e30000; color: #e30000; text-align: center; font-weight: 700;
    letter-spacing: 1.6mm; font-size: 4.2mm; padding: 1.4mm 0; }
</style></head>
<body><div class="sheet">
<svg class="map" width="${MAP_W}mm" height="${MAP_H}mm" viewBox="0 0 ${MAP_W} ${MAP_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="mapclip"><rect x="0" y="0" width="${MAP_W}" height="${MAP_H}"/></clipPath>
  </defs>
  <g clip-path="url(#mapclip)">
${o.layers.join('\n')}
  </g>
</svg>
<div class="titlecol">
  <div class="abs fine" style="top:10mm;left:4.8mm;right:0">
    ${esc(o.address)}<br>Generated: ${esc(o.generatedAt.slice(0, 10))}
    <br>GENERATED WITH SITE ANALYST — © SAMI ABDULNOUR, LICENSED USE.
  </div>
  ${rule(20)}
  <div class="abs" style="top:21.4mm;left:4.8mm;right:0;font-size:${T.legend}mm;font-weight:700">${esc(o.legendHeading)}</div>
  <svg class="abs" style="top:24mm;left:0" width="${TW}mm" height="${legendH}mm" viewBox="0 0 ${TW} ${legendH}" xmlns="http://www.w3.org/2000/svg">
    <defs><clipPath id="lhclip"><rect x="${SWATCH_X}" y="0" width="${SWATCH_W}" height="6.5"/></clipPath></defs>
    ${o.legendSvg}
  </svg>
  ${identityHtml}
</div>
</div></body></html>`;
}

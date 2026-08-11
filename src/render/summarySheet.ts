// DEVELOPMENT SUMMARY — the planning-controls table (sheet DA 002).
//
// No map: a single table down the left of the A1 sheet, geometry measured from
// the office reference (2546 Oatley DA 002). Columns are set by x position
// only — the original draws horizontal rules and no verticals at all.
//
// The CONTROLS column is filled from open data wherever a control is actually
// published (LEP zone, height, FSR, minimum lot size, heritage, and the
// state-wide Apartment Design Guide figures, which are percentages of site
// area). PROPOSED and COMPLIANCE are deliberately left empty — they describe a
// design that does not exist yet. Council DCP controls are not published in
// machine-readable form, so those rows are ruled up and left for manual entry
// rather than guessed at.

import { FRAME_L, FRAME_T, esc, sheetHtml, T } from './chrome.js';
import type { SheetMeta } from './sheet.js';
import type { SiteControls } from '../fetch/nsw.js';

// ---- geometry measured from the reference sheet (absolute mm) -------------
const TAB_L = 45.6, TAB_R = 417.2;
const COL_LABEL = 46.3, COL_CONTROLS = 106.0, COL_PROPOSED = 247.2, COL_COMPL = 389.5;
const TITLE_Y = 20.5;          // baseline of "DEVELOPMENT SUMMARY"
const TABLE_TOP = 26.8;        // first rule
const TITLE_SIZE = 8.23;
const BODY = 3.91;             // Arial 11pt
const LEAD = 5.2;              // line spacing inside a cell
const PAD_TOP = 5.2;           // rule -> first baseline
const ROW_MIN = 7.6;
const ROW_SECTION = 9.6;
const RULE_W = 0.12;

export interface SummaryRow {
  label?: string;
  controls?: string[];
  proposed?: string[];
  /** section heading row: label spans the full width, no columns */
  section?: boolean;
  /** column-title row (CONTROLS / PROPOSED / COMPLIANCE) */
  head?: 'two' | 'three';
}

export interface SummaryData {
  address: string;
  lotDescription: string;      // "LOT 1&2 - DP 212120"
  siteAreaSqm?: number;
  areaIsCadastral: boolean;
  controls: SiteControls;
}

const fmt = (n: number, dp = 1) =>
  n.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** The row model — content decisions live here, drawing lives below. */
export function summaryRows(d: SummaryData): SummaryRow[] {
  const c = d.controls;
  const area = d.siteAreaSqm;
  const rows: SummaryRow[] = [];

  rows.push({ label: 'SITE INFO', section: true });
  rows.push({ label: 'ADDRESS', controls: [d.address] });
  rows.push({ label: 'DP', controls: [d.lotDescription] });
  rows.push({
    label: 'SITE AREA',
    controls: area
      ? [`${fmt(area)} sqm`, ...(d.areaIsCadastral ? ['(cadastral boundary, confirm against survey)'] : [])]
      : ['—'],
  });

  // Proposal side: ruled up, deliberately empty.
  rows.push({ label: 'PROJECT SUMMARY', section: true });
  rows.push({ label: 'RESIDENTIAL MIX' });
  rows.push({ label: 'COMMERCIAL AREA (sqm)' });
  rows.push({ label: 'CAR PARKING' });

  // ---- LEP: every one of these is published, so every one is filled -------
  const lep = (c.epiName ?? 'LOCAL ENVIRONMENTAL PLAN')
    .toUpperCase()
    .replace('LOCAL ENVIRONMENTAL PLAN', 'LEP');
  rows.push({ label: lep, section: true });
  rows.push({ head: 'two' });
  rows.push({
    label: 'LAND USE',
    controls: [[c.zoneCode, c.zonePurpose].filter(Boolean).join(' - ') || '—'],
  });
  rows.push({
    label: 'BUILDING HEIGHT (m)',
    controls: [c.maxHeightM ? `${fmt(c.maxHeightM, 0)}m` : 'No height of building control mapped'],
  });
  rows.push({
    label: 'FLOOR SPACE RATIO',
    controls: [c.fsr ? `${c.fsr.toFixed(2)}:1` : 'No FSR control mapped'],
  });
  rows.push({
    label: 'GROSS FLOOR AREA (sqm)',
    controls: c.fsr && area
      ? [`${fmt(c.fsr * area)} sqm`, `(${c.fsr.toFixed(2)} x ${fmt(area)} sqm site area)`]
      : ['—'],
  });
  rows.push({
    label: 'MIN. LOT SIZE (sqm)',
    controls: [c.minLotSizeSqm ? `${fmt(c.minLotSizeSqm, 0)} sqm` : 'No minimum lot size mapped'],
  });
  rows.push({
    label: 'HERITAGE',
    controls: c.heritage.length
      ? c.heritage.map((h) => `${h.name}${h.significance ? ` (${h.significance})` : ''}`)
      : ['No heritage item mapped on the site'],
  });

  // ---- DCP: council documents, not open data ------------------------------
  const lga = (c.lgaName ?? '').trim();
  rows.push({ label: `${lga ? `${lga} ` : ''}DEVELOPMENT CONTROL PLAN`, section: true });
  rows.push({ head: 'three' });
  for (const label of ['DWELLING MIX', 'SETBACK', 'MIN. LANDSCAPE AREA',
    'CAR PARKING', 'BICYCLE PARKING', 'MOTORCYCLE PARKING']) {
    rows.push({ label, controls: [''] });
  }

  // ---- ADG: state-wide, and the numeric parts are % of site area ----------
  rows.push({ label: 'APARTMENT DESIGN GUIDE', section: true });
  rows.push({ head: 'three' });
  rows.push({
    label: '3D. COMMUNAL OPEN SPACE',
    controls: [
      'Communal open space has a minimum area equal to 25% of the site',
      area ? `= ${fmt(area * 0.25)} sqm` : '',
    ].filter(Boolean),
  });
  rows.push({
    label: '3E. DEEP SOIL ZONE',
    controls: [
      '6m minimum dimension, and equal to 7% of the site area',
      area ? `= ${fmt(area * 0.07)} sqm` : '',
    ].filter(Boolean),
  });
  rows.push({
    label: '4A. SOLAR AND DAYLIGHT ACCESS',
    controls: [
      'Living rooms and private open spaces of at least 70% of apartments in a',
      'building receive a minimum of 2 hours direct sunlight between 9 am and 3 pm',
      'at mid winter in the Sydney Metropolitan Area',
    ],
  });
  rows.push({
    label: '4B. NATURAL VENTILATION',
    controls: [
      'At least 60% of apartments are naturally cross ventilated in the first nine',
      'storeys of the building. Apartments at ten storeys or greater are deemed to',
      'be cross ventilated only if any enclosure of the balconies at these levels',
      'allows adequate natural ventilation and cannot be fully enclosed',
    ],
  });

  return rows;
}

/**
 * Break a row label to the label column's width. The reference does this too:
 * "4A. SOLAR AND DAYLIGHT ACCESS" is set as "4A." / "SOLAR AND DAYLIGHT" /
 * "ACCESS", with the clause number always alone on the first line.
 */
function labelLines(label: string): string[] {
  const clause = label.match(/^(\d+[A-Z]?\.)\s+(.+)$/);
  const head = clause ? [clause[1]] : [];
  const rest = clause ? clause[2] : label;
  // Arial Bold averages ~0.60em per character; the column is 59.7mm wide.
  const maxChars = Math.floor((COL_CONTROLS - COL_LABEL - 2) / (BODY * 0.6));
  const lines: string[] = [];
  let cur = '';
  for (const w of rest.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return [...head, ...lines];
}

// Sizes are plain numbers: the map viewBox's user unit is already 1mm, so a
// "mm" suffix here would be an absolute length and render several times over.
const txt = (x: number, y: number, s: string, bold = false, size = BODY) =>
  `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}"` +
  `${bold ? ' font-weight="700"' : ''}>${esc(s)}</text>`;

/** Draw the table into the sheet's drawing field (coordinates are sheet mm). */
export function renderSummaryTable(d: SummaryData): string {
  const rows = summaryRows(d);
  const out: string[] = [];
  const rule = (y: number) =>
    `<line x1="${TAB_L}" y1="${y.toFixed(2)}" x2="${TAB_R}" y2="${y.toFixed(2)}"` +
    ` stroke="#000" stroke-width="${RULE_W}"/>`;

  out.push(txt(COL_LABEL, TITLE_Y, 'DEVELOPMENT SUMMARY', true, TITLE_SIZE));

  let y = TABLE_TOP;
  out.push(rule(y));
  for (const r of rows) {
    const lab = !r.section && !r.head && r.label ? labelLines(r.label) : [];
    const lines = Math.max(
      r.controls?.length ?? 1,
      r.proposed?.length ?? 1,
      lab.length,
      1,
    );
    const h = r.section ? ROW_SECTION : Math.max(ROW_MIN, PAD_TOP + (lines - 1) * LEAD + 2.4);
    const base = y + PAD_TOP;

    if (r.section) {
      out.push(txt(COL_LABEL, base, r.label ?? '', true));
    } else if (r.head) {
      out.push(txt(COL_CONTROLS, base, 'CONTROLS', true));
      out.push(txt(COL_PROPOSED, base, 'PROPOSED', true));
      if (r.head === 'three') out.push(txt(COL_COMPL, base, 'COMPLIANCE', true));
    } else {
      lab.forEach((line, i) => out.push(txt(COL_LABEL, base + i * LEAD, line, true)));
      (r.controls ?? []).forEach((line, i) => {
        if (line) out.push(txt(COL_CONTROLS, base + i * LEAD, line));
      });
      (r.proposed ?? []).forEach((line, i) => {
        if (line) out.push(txt(COL_PROPOSED, base + i * LEAD, line));
      });
    }
    y += h;
    out.push(rule(y));
  }

  // The table is drawn in absolute sheet coordinates; the field is offset.
  return `<g transform="translate(${-FRAME_L},${-FRAME_T})"` +
    ` font-family="Arial, Helvetica, sans-serif" fill="#000">${out.join('')}</g>`;
}

export interface SummaryBundle extends SummaryData {
  generatedAt: string;
  siteAddress: string;
}

export function renderSummarySheet(sb: SummaryBundle, meta: SheetMeta): string {
  // The legend column has nothing to list on a table sheet; use it for the
  // note that matters — which columns a person still has to fill in.
  const noteLines = [
    'CONTROLS are read from the NSW ePlanning',
    'register at the site: zone, height of',
    'building, floor space ratio, minimum lot',
    'size and heritage.',
    '',
    'PROPOSED and COMPLIANCE are left blank —',
    'they describe a design, not the site.',
    '',
    'Council DCP controls are not published as',
    'open data; those rows are ruled up for',
    'manual entry.',
  ];
  const legendSvg =
    `<g font-family="Arial, Helvetica, sans-serif" font-size="${T.fine}mm" fill="#222">` +
    noteLines.map((l, i) => `<text x="0" y="${(i * 3.1 + 3).toFixed(1)}" font-size="2.1">${esc(l)}</text>`).join('') +
    `</g>`;

  return sheetHtml({
    meta,
    address: sb.address,
    generatedAt: sb.generatedAt,
    siteAddress: sb.siteAddress,
    scale: 0,
    rotationDeg: 0,
    drawingTitle: 'DEVELOPMENT SUMMARY',
    legendHeading: 'NOTES',
    legendSvg,
    layers: [renderSummaryTable(sb)],
    noMap: true,
  });
}

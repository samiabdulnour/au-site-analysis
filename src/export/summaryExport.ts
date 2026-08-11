// Open-format exports for the DEVELOPMENT SUMMARY.
//
// This sheet is a table, not geometry, so DXF would be the wrong container —
// it would arrive as loose text entities nobody can edit as data. CSV opens
// in Excel/Numbers and pastes into a Word or InDesign table; JSON is there for
// anything that wants to read the controls programmatically. Both keep the
// empty PROPOSED / COMPLIANCE columns so the file is a working template.

import { summaryRows, type SummaryData } from '../render/summarySheet.js';

/** RFC 4180: quote when the value contains a comma, quote or newline. */
function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function summaryCsv(d: SummaryData): string {
  const lines: string[] = [];
  lines.push(['SECTION', 'ITEM', 'CONTROLS', 'PROPOSED', 'COMPLIANCE'].join(','));

  let section = '';
  for (const r of summaryRows(d)) {
    if (r.section) { section = r.label ?? ''; continue; }
    if (r.head) continue;                       // column titles are structure
    lines.push([
      section,
      r.label ?? '',
      (r.controls ?? []).filter(Boolean).join(' '),
      (r.proposed ?? []).filter(Boolean).join(' '),
      '',
    ].map(csvCell).join(','));
  }
  // Excel opens UTF-8 CSV correctly only with a BOM.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function summaryJson(d: SummaryData): string {
  let section = '';
  const items: Record<string, unknown>[] = [];
  for (const r of summaryRows(d)) {
    if (r.section) { section = r.label ?? ''; continue; }
    if (r.head) continue;
    items.push({
      section,
      item: r.label ?? '',
      controls: (r.controls ?? []).filter(Boolean),
      proposed: (r.proposed ?? []).filter(Boolean),
      compliance: null,
    });
  }
  return JSON.stringify({
    address: d.address,
    lotDescription: d.lotDescription,
    siteAreaSqm: d.siteAreaSqm,
    siteAreaSource: d.areaIsCadastral ? 'NSW cadastre (confirm against survey)' : 'survey',
    planningControls: d.controls,
    table: items,
  }, null, 2);
}

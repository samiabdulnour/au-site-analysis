// Curation: turn raw fetched data into the styled category model the sheet
// draws. Zoning is the base; named institutions override by function
// (matching how the reference sheets are curated by hand).

export interface Category {
  id: string;
  label: string;
  fill: string;
  opacity: number;
  /** Contour color — the Oatley legend outlines institutional categories. */
  stroke?: string;
}

// Palette per the office's Oatley (2546) legend.
export const CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                    fill: '#e8402a', opacity: 0.55 },
  { id: 'medical',        label: 'MEDICAL',                                 fill: '#f27ba9', opacity: 0.8, stroke: '#e5237e' },
  { id: 'education',      label: 'EDUCATION',                               fill: '#93b7f2', opacity: 0.8, stroke: '#2e6be6' },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                  fill: '#f4f8ff', opacity: 0.85, stroke: '#2e6be6' },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#e957c9', opacity: 0.6 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                           fill: '#e4d3f0', opacity: 0.8 },
  { id: 'openSpace',      label: 'OPEN SPACE',                              fill: '#e6f0d8', opacity: 0.78 },
  { id: 'community',      label: 'COMMUNITY HUB',                           fill: '#e0f2eb', opacity: 0.85, stroke: '#a5c3d8' },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',              fill: '#fce9e8', opacity: 0.75 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',           fill: '#f7c1bd', opacity: 0.75 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',             fill: '#f29e97', opacity: 0.75 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                            fill: '#f0b3c8', opacity: 0.65 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                       fill: '#d9c2ee', opacity: 0.65 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                      fill: '#c9a8ec', opacity: 0.65 },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                 fill: '#f0e2e6', opacity: 0.75, stroke: '#ef8b1d' },
  { id: 'water',          label: 'WATERWAY',                                fill: '#bcdcf0', opacity: 0.75 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                          fill: '#f3c488', opacity: 0.9, stroke: '#ef8b1d' },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                   fill: '#c8a165', opacity: 0.55 },
];

export const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** NSW LEP zone code -> category id (null = leave the aerial visible). */
export function zoneToCategory(code: string): string | null {
  const c = (code ?? '').toUpperCase();
  if (/^R2/.test(c)) return 'r2';
  if (/^R[13]/.test(c)) return 'r3';
  if (/^R4/.test(c)) return 'r4';
  if (/^R5/.test(c)) return 'r2';
  if (/^(B1|B2|E1)$/.test(c)) return 'localCentre';
  if (/^(B3|E2|E3)$/.test(c)) return 'commercial';
  if (/^(B4|MU1|B)$/.test(c)) return 'mixedUse';
  if (/^(IN|E4|E5)/.test(c)) return 'industrial';
  if (/^SP/.test(c)) return 'infrastructure';
  if (/^RE/.test(c)) return 'openSpace';
  if (/^W/.test(c)) return 'water';
  if (/^C[1-4]/.test(c)) return 'openSpace';
  if (/^RU/.test(c)) return 'r2';
  return null;
}

/**
 * Categorize a named NSW building complex by its name (the FOI type codes are
 * unreliable; names are consistently descriptive). Null = not worth showing.
 */
export function keywordCategory(name: string): string | null {
  const n = name.toUpperCase();
  if (/KINDERGARTEN|PRE-?SCHOOL|CHILD CARE|CHILDCARE|EARLY LEARNING|EARLY CHILDHOOD|AGED CARE|NURSING HOME|RETIREMENT|CONVALESCENT/.test(n)) return 'childCare';
  if (/SCHOOL|COLLEGE|TAFE|UNIVERSITY|GRAMMAR/.test(n)) return 'education';
  if (/HOSPITAL|NURSING|MEDICAL|SURGERY|HEALTH|AMBULANCE|HOSPICE/.test(n)) return 'medical';
  if (/SHOPPING|PLAZA|\bMALL\b|MARKETPLACE|\bMETRO\b|CENTRE POINT/.test(n)) return 'retail';
  if (/CHURCH|CATHEDRAL|MOSQUE|MASJID|TEMPLE|SYNAGOGUE|LIBRARY|COMMUNITY|COUNCIL|CIVIC|TOWN HALL|POLICE|FIRE STATION|\bSES\b|COURT HOUSE|MUSEUM|AQUATIC|LEISURE CENTRE|\bRSL\b|BOWLING|SENIOR CITIZENS/.test(n)) return 'community';
  return null;
}

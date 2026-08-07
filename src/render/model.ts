// Curation: turn raw fetched data into the styled category model the sheet
// draws. Zoning is the base; named institutions override by function
// (matching how the reference sheets are curated by hand).

export interface Category {
  id: string;
  label: string;
  fill: string;
  opacity: number;
}

export const CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                    fill: '#e8402a', opacity: 0.75 },
  { id: 'medical',        label: 'MEDICAL',                                 fill: '#e64c7e', opacity: 0.65 },
  { id: 'education',      label: 'EDUCATION',                               fill: '#4f8fd9', opacity: 0.65 },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#e957c9', opacity: 0.6 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                           fill: '#d9b3e6', opacity: 0.65 },
  { id: 'openSpace',      label: 'OPEN SPACE',                              fill: '#8fd158', opacity: 0.6 },
  { id: 'community',      label: 'COMMUNITY HUB',                           fill: '#bfe9e0', opacity: 0.7 },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',              fill: '#c4a6a0', opacity: 0.55 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',           fill: '#e6d3a3', opacity: 0.55 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',             fill: '#e85a50', opacity: 0.55 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                            fill: '#f0b3c8', opacity: 0.6 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                       fill: '#d9c2ee', opacity: 0.6 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                      fill: '#a06ee0', opacity: 0.55 },
  { id: 'infrastructure', label: 'SP2 INFRASTRUCTURE',                      fill: '#f0e060', opacity: 0.55 },
  { id: 'water',          label: 'WATERWAY',                                fill: '#9fd8ef', opacity: 0.6 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                          fill: '#f0912d', opacity: 0.85 },
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
  if (/SCHOOL|COLLEGE|TAFE|UNIVERSITY|KINDERGARTEN|PRE-?SCHOOL|GRAMMAR|CHILD CARE|CHILDCARE|EARLY LEARNING/.test(n)) return 'education';
  if (/HOSPITAL|AGED CARE|NURSING|MEDICAL|SURGERY|HEALTH|AMBULANCE|HOSPICE/.test(n)) return 'medical';
  if (/SHOPPING|PLAZA|\bMALL\b|MARKETPLACE|\bMETRO\b|CENTRE POINT/.test(n)) return 'retail';
  if (/CHURCH|CATHEDRAL|MOSQUE|MASJID|TEMPLE|SYNAGOGUE|LIBRARY|COMMUNITY|COUNCIL|CIVIC|TOWN HALL|POLICE|FIRE STATION|\bSES\b|COURT HOUSE|MUSEUM|AQUATIC|LEISURE CENTRE|\bRSL\b|BOWLING|SENIOR CITIZENS/.test(n)) return 'community';
  return null;
}

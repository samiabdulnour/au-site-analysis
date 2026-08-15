// Curation: turn raw fetched data into the styled category model the sheet
// draws. Zoning is the base; named institutions override by function
// (matching how the reference sheets are curated by hand).

export type { Category } from './template.js';
import { tpl } from './template.js';

/** Land-use categories for the active template. */
export const categories = () => tpl().categories;
export const catById = () => Object.fromEntries(tpl().categories.map((c) => [c.id, c]));
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

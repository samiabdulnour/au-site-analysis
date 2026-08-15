// Graphic templates.
//
// Everything about how a sheet LOOKS — typeface, text sizes, line and fill
// colours, the land-use palette, which symbol family is drawn — lives here,
// so a new house style is a data change rather than a hunt through the
// renderers. What a sheet SAYS (which data, which labels, the A1 geometry)
// is deliberately not part of a template.
//
// `fuse` reproduces the office style the sheets were reverse-engineered from.
//
// Fonts are limited to what the runtime image actually ships (Liberation and
// DejaVu). Naming a font that is not installed does not fail — it silently
// falls back and the sheet comes out in the wrong face, which is worse.

export interface Category {
  id: string;
  label: string;
  fill: string;
  opacity: number;
  /** Contour colour — the Oatley legend outlines institutional categories. */
  stroke?: string;
}

export interface Template {
  id: string;
  label: string;
  /** One-line description, shown in the web picker. */
  note: string;

  /** CSS font stack for the sheet. */
  font: string;
  /** Multiplies every text size, so a template can run larger or tighter. */
  textScale: number;

  ink: string;        // primary text and line colour
  rule: string;       // title-block rules
  site: string;       // site boundary and emphasis
  dimension: string;  // dimension lines, levels, boundary figures
  wind: string;       // wind banners
  sun: string;        // sun path disc and rays
  road: string;       // road casing
  water: string;
  transit: string;    // bus routes and stop roundels
  rail: string;       // heavy rail line
  walk5: string;      // 5-minute walking catchment
  walk10: string;     // 10-minute walking catchment
  busRoute: string;   // bus route dashes
  heritage: string;   // heritage hatch

  /** Symbol family: how stops, north point and sun are drawn. */
  symbols: 'fuse' | 'plain';
  /** Land-use fills for the context sheet legend. */
  categories: Category[];
}

// The office palette, per the Oatley (2546) legend.
const FUSE_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: '#e8402a', opacity: 0.55 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: '#f27ba9', opacity: 0.6, stroke: '#e5237e' },
  { id: 'education',      label: 'EDUCATION',                                fill: '#93b7f2', opacity: 0.6, stroke: '#2e6be6' },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: '#f4f8ff', opacity: 0.65, stroke: '#2e6be6' },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#e957c9', opacity: 0.5 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: '#e4d3f0', opacity: 0.55 },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: '#e6f0d8', opacity: 0.55 },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: '#e0f2eb', opacity: 0.6, stroke: '#a5c3d8' },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: '#fce9e8', opacity: 0.45 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: '#f7c1bd', opacity: 0.5 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: '#f29e97', opacity: 0.5 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: '#f0b3c8', opacity: 0.5 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: '#d9c2ee', opacity: 0.5 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: '#c9a8ec', opacity: 0.5 },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: '#f0e2e6', opacity: 0.55, stroke: '#ef8b1d' },
  { id: 'water',          label: 'WATERWAY',                                 fill: '#bcdcf0', opacity: 0.6 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: '#f3c488', opacity: 0.75, stroke: '#ef8b1d' },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: '#c8a165', opacity: 0.55 },
];

// A restrained alternative: one accent against neutral ground, so the aerial
// reads through and the sheet stays legible photocopied or printed in mono.
const NEUTRAL_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: '#d1362a', opacity: 0.5 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: '#cfd8dc', opacity: 0.55, stroke: '#5b6b73' },
  { id: 'education',      label: 'EDUCATION',                                fill: '#c3ced4', opacity: 0.55, stroke: '#4a5a63' },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: '#e8edef', opacity: 0.6, stroke: '#7d8a91' },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#b9a89c', opacity: 0.5 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: '#d8cec6', opacity: 0.5 },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: '#dfe6d6', opacity: 0.55 },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: '#dce5e4', opacity: 0.55, stroke: '#8fa3a1' },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: '#f2efeb', opacity: 0.45 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: '#e4ded6', opacity: 0.5 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: '#d3cabf', opacity: 0.5 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: '#e0d3c8', opacity: 0.5 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: '#d2cdd8', opacity: 0.5 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: '#c4c0cb', opacity: 0.5 },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: '#eae4e0', opacity: 0.55, stroke: '#8a8078' },
  { id: 'water',          label: 'WATERWAY',                                 fill: '#cbdae2', opacity: 0.6 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: '#ddd6cc', opacity: 0.7, stroke: '#8a8078' },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: '#c2b39a', opacity: 0.5 },
];

const SANS = "Arial, 'Liberation Sans', Helvetica, sans-serif";
const GROTESK = "'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif";

export const TEMPLATES: Template[] = [
  {
    id: 'fuse',
    label: 'fuse',
    note: 'the office style the sheets were drawn from',
    font: SANS,
    textScale: 1,
    ink: '#111111',
    rule: '#666666',
    site: '#e30613',
    dimension: '#2456c4',
    wind: '#2f9fd6',
    sun: '#feefab',
    road: '#6e6e6e',
    water: '#bcdcf0',
    transit: '#2f7fd6',
    rail: '#3b3b3b',
    walk5: '#e6007e',
    walk10: '#b5379b',
    busRoute: '#d5006d',
    heritage: '#a97b3f',
    symbols: 'fuse',
    categories: FUSE_CATEGORIES,
  },
  {
    id: 'neutral',
    label: 'neutral',
    note: 'restrained palette, one accent — survives a mono print',
    font: GROTESK,
    textScale: 0.96,
    ink: '#1c1c1c',
    rule: '#8a8a8a',
    site: '#d1362a',
    dimension: '#3c4c5a',
    wind: '#6d8a99',
    sun: '#f0e4c0',
    road: '#7d7d7d',
    water: '#cbdae2',
    transit: '#41627a',
    rail: '#2f2f2f',
    walk5: '#7a5c86',
    walk10: '#9c8aa6',
    busRoute: '#6b7f93',
    heritage: '#94836a',
    symbols: 'plain',
    categories: NEUTRAL_CATEGORIES,
  },
];

const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
export const DEFAULT_TEMPLATE = 'fuse';

// The renderers read the active template rather than threading it through
// every drawing helper. Safe because a run renders one sheet at a time — the
// server's job queue is serial. If jobs are ever run concurrently in one
// process, this has to become a parameter.
let active: Template = byId[DEFAULT_TEMPLATE];

export function setTemplate(id: string | undefined): Template {
  active = byId[id ?? ''] ?? byId[DEFAULT_TEMPLATE];
  return active;
}
export function tpl(): Template {
  return active;
}
export function isTemplateId(id: string): boolean {
  return Object.hasOwn(byId, id);
}

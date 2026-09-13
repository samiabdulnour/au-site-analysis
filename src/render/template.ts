// Graphic templates.
//
// Everything about how a sheet LOOKS — typeface, text sizes, line and fill
// colours, the land-use palette, which symbol family is drawn — lives here,
// so a new house style is a data change rather than a hunt through the
// renderers. What a sheet SAYS (which data, which labels, the A1 geometry)
// is deliberately not part of a template.
//
// There is one template. The office style that used to sit beside it is drawn
// in ArchiCAD now, so it left; this one is what every sheet comes out in until
// its replacement is designed.
//
// Fonts are limited to what the runtime image actually ships (Liberation and
// DejaVu). Naming a font that is not installed does not fail — it silently
// falls back and the sheet comes out in the wrong face, which is worse.

import { AsyncLocalStorage } from 'node:async_hooks';

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

  /** Land-use fills for the context sheet legend. */
  categories: Category[];
}

// The land-use palette for the context sheet legend.
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
    categories: NEUTRAL_CATEGORIES,
  },
];

const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
export const DEFAULT_TEMPLATE = 'neutral';

// The renderers read the active template rather than threading it through
// every drawing helper — forty-five call sites across five files, most of them
// deep inside drawing code that has no other reason to know about it.
//
// That was safe only because the server renders one sheet at a time. Two
// concurrent renders would not have failed; the second's setTemplate would
// have changed the palette out from under the first, and out would have come a
// sheet in the wrong house style, silently, and only when a public job and an
// office job happened to overlap.
//
// Threading a parameter through all forty-five was one answer. This is the
// other: the active template becomes per-async-context rather than per-process,
// which is the problem AsyncLocalStorage exists for. The drawing code is
// untouched, and a render started inside withTemplate() keeps its own template
// across every await it makes, however deep.
const als = new AsyncLocalStorage<Template>();

/** The process-wide fallback, for the CLI, which renders one sheet and exits. */
let active: Template = byId[DEFAULT_TEMPLATE];

export function setTemplate(id: string | undefined): Template {
  active = byId[id ?? ''] ?? byId[DEFAULT_TEMPLATE];
  return active;
}

/**
 * Run `fn` with `id` as the active template for it and everything it awaits,
 * without disturbing what any other concurrent run sees.
 */
export function withTemplate<T>(t: string | Template | undefined, fn: () => T): T {
  const resolved = typeof t === 'object' && t !== null
    ? t
    : byId[t ?? ''] ?? byId[DEFAULT_TEMPLATE];
  return als.run(resolved, fn);
}

export function tpl(): Template {
  // The context when there is one; otherwise whatever setTemplate last chose.
  return als.getStore() ?? active;
}
export function isTemplateId(id: string): boolean {
  return Object.hasOwn(byId, id);
}

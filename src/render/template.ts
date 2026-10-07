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
  inkSoft: string;    // secondary text — captions, notes, sources
  paper: string;      // the page and every map's ground
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

// The land-use palette for the context sheet legend: the book's pastels —
// residential in blushes, centres in sands, institutions in cool blue-greys,
// open space in the teal-greens — so the sheet sits with the deck.
const NEUTRAL_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: '#c8472e', opacity: 0.5 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: '#d3dee2', opacity: 0.6, stroke: '#5d7079' },
  { id: 'education',      label: 'EDUCATION',                                fill: '#bfd3d9', opacity: 0.6, stroke: '#4a5f68' },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: '#e3eceE', opacity: 0.6, stroke: '#7d8a91' },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#e8c494', opacity: 0.55 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: '#f0d7b4', opacity: 0.55 },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: '#cfe4d0', opacity: 0.6 },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: '#cbe0db', opacity: 0.6, stroke: '#7fa39c' },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: '#f8e3d6', opacity: 0.5 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: '#f3cdb8', opacity: 0.55 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: '#edb69a', opacity: 0.55 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: '#e4be8e', opacity: 0.55 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: '#c9cbe3', opacity: 0.55 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: '#c4bfd6', opacity: 0.55 },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: '#efe7da', opacity: 0.6, stroke: '#8a8078' },
  { id: 'water',          label: 'WATERWAY',                                 fill: '#afd2df', opacity: 0.65 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: '#e2d9c8', opacity: 0.7, stroke: '#8a8078' },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: '#d9c49a', opacity: 0.55 },
];

const SANS = "Arial, 'Liberation Sans', Helvetica, sans-serif";
const GROTESK = "'Inter', 'Inter Display', 'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif";

export const TEMPLATES: Template[] = [
  {
    id: 'neutral',
    label: 'neutral',
    note: 'the book palette — cream paper, teal and blush, one vermilion accent',
    font: GROTESK,
    textScale: 0.96,
    ink: '#2a3534',
    inkSoft: '#6a7572',
    paper: '#ffffff',
    rule: '#d8cfc0',
    site: '#c8472e',
    dimension: '#3d5a94',
    wind: '#7fa3ad',
    sun: '#dca62e',
    road: '#8a8378',
    water: '#afd2df',
    transit: '#2c4c9c',
    rail: '#3a4446',
    walk5: '#2f7d6d',
    walk10: '#6ba998',
    busRoute: '#7b90c9',
    heritage: '#a98a5b',
    categories: NEUTRAL_CATEGORIES,
  },
];

/**
 * The book's working palette beyond the template fields: the pastel families
 * the deck's thematic layers draw from, named by hue and weight. One family
 * per meaning — teal for reach and opportunity, green for the living layers,
 * blush and sand for activity and warmth, navy for transport and keyed marks,
 * terracotta for constraint — so eighteen slides read as one book.
 */
export const BOOK = {
  paper: '#ffffff',
  panel: '#f5eee0',     // a step deeper than the paper, for backdrops and photo mounts
  ink: '#2a3534',
  inkSoft: '#6a7572',
  rule: '#d8cfc0',
  site: '#c8472e',
  teal: '#2f7d6d', tealMid: '#6ba998', tealLight: '#a8cdc2', tealFaint: '#dcebe2',
  green: '#4c8a68', greenDeep: '#2f6b50', greenLight: '#a8cdb4', greenFaint: '#e6efe3',
  blush: '#d9825b', blushMid: '#efa98f', blushLight: '#f6cdbb', blushFaint: '#fae4d8',
  sand: '#e8c494', sandDeep: '#b5873b', sandLight: '#f3debc',
  navy: '#2c4c9c', navyLight: '#8fa3d4',
  terracotta: '#ba4530',
  waterDeep: '#3e7e9c',
  gold: '#dca62e',
} as const;

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

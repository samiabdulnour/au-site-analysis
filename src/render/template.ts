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
  /** Vector texture laid over the fill, so one hue can carry several categories. */
  texture?: Texture;
  /** Colour of that texture; defaults to the stroke, then the fill. */
  textureColor?: string;
  /** The building footprints on this ground: the family's ink, so a block is a dark figure on its light tint. */
  figure?: string;
}

export type Texture = 'dots' | 'lines' | 'cross';

export interface Template {
  id: string;
  label: string;
  /** One-line description, shown in the web picker. */
  note: string;

  /** CSS font stack for the sheet. */
  font: string;
  /** The street names' face: a narrow one, so a name fits its street. */
  streetFont: string;
  /** Multiplies every text size, so a template can run larger or tighter. */
  textScale: number;

  ink: string;        // primary text and line colour
  streetInk: string;  // street names and the numbered place markers: quieter than the ink
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

// The land-use palette for the context sheet legend. Four hues, each a
// family: peach for the residential zones, sand for the centres, teal for
// open space and the institutions, blue for water — and grey for what is
// neither. Within a family the categories differ by tone and by texture
// (dots, hatch, cross-hatch), not by another colour, so the sheet reads as
// paper with a few tints on it. The tints are kept light because the
// building footprints go over them in the family's ink, and the figure has
// to stand clear of its ground. The site is the one accent.
const PEACH = '#f3b8a4', PEACH_INK = '#d48b75';
const PEACH_DEEP = '#e8957c', PEACH_DEEP_INK = '#b5614a';   // the high-density tier, a step down the same hue
const SAND = '#f1cf98', SAND_INK = '#c49a52';
const TEAL = '#5a9c89', TEAL_INK = '#3f7f6d';
const PAPER = '#ffffff';
const BLUE = '#b4d0dc';
const NAVY = '#3b4f8a';
const GREY = '#d9d9d9', GREY_INK = '#8c8c8c';
const CORAL = '#e8705a';

const NEUTRAL_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: CORAL, opacity: 0.6 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: TEAL, opacity: 0.65, stroke: TEAL_INK, figure: TEAL_INK },
  { id: 'education',      label: 'EDUCATION',                                fill: TEAL, opacity: 0.55, stroke: TEAL_INK, texture: 'lines', textureColor: PAPER, figure: TEAL_INK },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: TEAL, opacity: 0.25, stroke: TEAL_INK, figure: TEAL_INK },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: SAND, opacity: 0.55, texture: 'dots', textureColor: SAND_INK, figure: SAND_INK },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: SAND, opacity: 0.4, texture: 'cross', textureColor: SAND_INK, figure: SAND_INK },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: TEAL, opacity: 0.55, texture: 'dots', textureColor: PAPER, figure: TEAL_INK },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: TEAL, opacity: 0.5, stroke: TEAL_INK, texture: 'cross', textureColor: PAPER, figure: TEAL_INK },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: PEACH, opacity: 0.22, figure: PEACH_INK },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: PEACH, opacity: 0.5, figure: PEACH_INK },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: PEACH_DEEP, opacity: 0.65, texture: 'lines', textureColor: PEACH_DEEP_INK, figure: PEACH_DEEP_INK },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: SAND, opacity: 0.55, figure: SAND_INK },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: SAND, opacity: 0.55, texture: 'lines', textureColor: SAND_INK, figure: SAND_INK },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: GREY, opacity: 0.45, texture: 'lines', textureColor: GREY_INK, figure: GREY_INK },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: GREY, opacity: 0.4, stroke: GREY_INK, figure: GREY_INK },
  { id: 'water',          label: 'WATERWAY',                                 fill: BLUE, opacity: 0.75 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: GREY, opacity: 0.6, stroke: GREY_INK, figure: GREY_INK },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: SAND_INK, opacity: 0.55 },
];

const SANS = "Arial, 'Liberation Sans', Helvetica, sans-serif";
// Arial Narrow where it is installed; Liberation Sans Narrow is its
// metric-compatible stand-in and is what the runtime image ships.
const NARROW = "'Arial Narrow', 'Liberation Sans Narrow', 'DejaVu Sans Condensed', sans-serif";
const GROTESK = "'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif";

export const TEMPLATES: Template[] = [
  {
    id: 'neutral',
    label: 'neutral',
    note: 'four tints and textures, one accent — survives a mono print',
    font: GROTESK,
    streetFont: NARROW,
    textScale: 0.96,
    ink: '#1c1c1c',
    streetInk: '#2f5f52',   // a deep green: present, not shouting
    rule: '#8a8a8a',
    site: CORAL,
    dimension: '#56616b',
    wind: '#87959d',
    sun: '#efe8d4',
    road: GREY_INK,
    water: BLUE,
    transit: NAVY,
    rail: '#3a3a3a',
    walk5: NAVY,
    walk10: '#8593bb',
    busRoute: '#7a8bb0',
    heritage: SAND_INK,
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

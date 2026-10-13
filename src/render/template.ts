// Graphic templates.
//
// Everything about how a sheet LOOKS — typeface, text sizes, line and fill
// colours, the land-use palette, which symbol family is drawn — lives here,
// so a new house style is a data change rather than a hunt through the
// renderers. What a sheet SAYS (which data, which labels, the A1 geometry)
// is deliberately not part of a template.
//
// Three templates. Flamingo is the paper-and-tints style the context sheet was
// redrawn in: four hue families with textures, white streets, every building
// white, numbered places, narrow green street names, dotted catchments, bus
// routes and railway. Kingfisher is Flamingo in a masterplan reference's
// palette, every building filled in its zone's strong colour on a pale
// ground. Heron is the office sheet the restyle started from —
// its palette over the aerial, plain black street names, dashed catchments
// with the walker — with Flamingo's stop symbols, red dotted railway and
// numbered places.
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

  /** The walking catchments: a broad translucent band, a plain continuous line, a dotted line with its walking time written along it, the office's dashed line with walker medallions on it, or a continuous line with its time and distance written along it. */
  isochrone: 'band' | 'line' | 'dotted' | 'walkers' | 'labelled';
  /** The stop and station roundels: a white disc with a coloured ring, or a solid coloured disc with a white letter. */
  roundel: 'ring' | 'solid';
  /** The bus routes: a dashed line, or a dotted one at reduced opacity that stays behind the tints. */
  busLine: 'dashed' | 'dotted';
  /** The railway: the classic dark line with white sleeper dashes, or a line of round dots in the rail colour. */
  railLine: 'sleepers' | 'dotted';
  /** What the map sits on: plain white paper, or the aerial under a white veil with the tints thinned so it shows through. */
  ground: 'paper' | 'aerial';
  /** The building footprints: white with a hairline of the family ink, no fill and only a light outline (for the aerial, where the photograph shows the roofs), or not drawn. */
  footprints: 'white' | 'colour' | 'outline' | 'none';
  /** Over the aerial: the white veil's opacity (default 0.3) and how far the tints are thinned (default 0.55). */
  veil?: number;
  tintScale?: number;
  /** The number discs' fill, where it differs from the street names' ink (Heron: white names, black discs). */
  discInk?: string;
  /** The parks' number discs, where they differ from the institutions' (Heron: green parks, brown institutions). */
  discParkInk?: string;
  /** The cadastre: a faint hairline in the road ink, or a white line over the aerial. */
  lots?: 'faint' | 'white';
  /** The white cadastre's line width, mm (default 0.45). */
  lotWidth?: number;
  /** A white contour round coloured footprints (footprints: 'colour'), mm; none when unset. */
  footprintEdge?: number;
  /** The aerial in its own colours, or in greyscale. */
  aerialTone?: 'colour' | 'grey';
  /** The road network as white strips over the tints, or not drawn (the aerial shows the streets). */
  streets?: 'white' | 'none';
  /** Street names plain along the road, or a through street's name in a white double-headed arrow band (lanes stay plain). */
  streetLabels?: 'plain' | 'band';

  /** The zoning: the template's land-use categories, or each zone in its own NSW ePlanning colour, keyed by zone code. */
  zoning?: 'categories' | 'lep';

  /** Land-use fills for the context sheet legend. */
  categories: Category[];
}

// Flamingo's land-use palette for the context sheet legend. Four hues, each a
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

const FLAMINGO_CATEGORIES: Category[] = [
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
// metric-compatible stand-in and comes with the runtime image's
// fonts-liberation (Debian's 1.07 line; the 2.x line dropped the narrow face).
const NARROW = "'Arial Narrow', 'Liberation Sans Narrow', 'DejaVu Sans Condensed', sans-serif";
const GROTESK = "'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif";

// Heron's palette, sampled from the legend of the office sheet it follows
// (the swatch colours backed out of their opacity over white): tan mixed
// use and centres, peach residential, mint open space, the institutions in
// slate blues with dark outlines. Categories that sheet's legend did not show
// are placed in the same warm families.
// Kingfisher's palette, sampled from the masterplan reference it follows
// (each family's building colour and the pale ground it stands on, as the
// image prints them). Every zone is a pale ground with its buildings in the
// family's strong colour. The residential zones take the warm side of the
// palette — a yellow ground with orange buildings for R2, pink for R3, cyan
// for R4, peach for the mixed use — and green is kept for green space alone:
// open space is the deep mint with black dots. The centres, commercial and
// retail are the blue family (told apart by texture), the institutions
// lavender, industry grey on stone, water the bright cyan, heritage a purple
// cross-hatch.
// Exactly as the reference prints them: each family's building colour and
// the pale ground it stands on, sampled from the image.
const F2 = {
  pink: '#f8cee8', pinkGround: '#f9e3f1',
  coral: '#efc0b2', coralGround: '#f7e5e1',
  orange: '#f2bf94', orangeGround: '#faebde', yellowGround: '#fbf4c9',
  mint: '#8fcdb0',
  cyan: '#b3dadc', cyanGround: '#def5f8',
  blue: '#7b91b0', blueGround: '#e0e9f6',
  violet: '#b6b2d3', violetGround: '#e5e3f4',
  grey: '#c2c2bc', stoneGround: '#e8e8d8',
  water: '#81e0f9', magenta: '#c2367c', purple: '#753583', dots: '#1c1c1c',
};

const KINGFISHER_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: F2.magenta, opacity: 0.3 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: F2.violetGround, opacity: 1, stroke: F2.violet, figure: F2.violet },
  { id: 'education',      label: 'EDUCATION',                                fill: F2.violetGround, opacity: 1, texture: 'lines', textureColor: F2.violet, figure: F2.violet },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: F2.violetGround, opacity: 1, texture: 'dots', textureColor: F2.violet, figure: F2.violet },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: F2.coralGround, opacity: 1, figure: F2.coral },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: F2.blueGround, opacity: 1, texture: 'cross', textureColor: F2.blue, figure: F2.blue },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: F2.mint, opacity: 1, texture: 'dots', textureColor: F2.dots, figure: F2.mint },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: F2.violetGround, opacity: 1, texture: 'cross', textureColor: F2.violet, figure: F2.violet },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: F2.yellowGround, opacity: 1, figure: F2.orange },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: F2.pinkGround, opacity: 1, figure: F2.pink },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: F2.cyanGround, opacity: 1, figure: F2.cyan },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: F2.blueGround, opacity: 1, figure: F2.blue },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: F2.blueGround, opacity: 1, texture: 'lines', textureColor: F2.blue, figure: F2.blue },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: F2.stoneGround, opacity: 1, figure: F2.grey },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: F2.stoneGround, opacity: 0.6, stroke: F2.grey, figure: F2.grey },
  { id: 'water',          label: 'WATERWAY',                                 fill: F2.water, opacity: 1 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: F2.stoneGround, opacity: 0.8, figure: F2.grey },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: F2.purple, opacity: 0.55 },
];

const HERON_CATEGORIES: Category[] = [
  { id: 'site',           label: 'SITE',                                     fill: '#cf4a2e', opacity: 0.5 },
  { id: 'medical',        label: 'MEDICAL',                                  fill: '#ceddde', opacity: 0.55, stroke: '#4a5a63' },
  { id: 'education',      label: 'EDUCATION',                                fill: '#b8d1d7', opacity: 0.55, stroke: '#3e5560' },
  { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: '#dfebee', opacity: 0.6, stroke: '#5f7480' },
  { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: '#e3c189', opacity: 0.5 },
  { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: '#ecd4ac', opacity: 0.5 },
  { id: 'openSpace',      label: 'OPEN SPACE',                               fill: '#cae2cc', opacity: 0.55 },
  { id: 'community',      label: 'COMMUNITY HUB',                            fill: '#d3e6e3', opacity: 0.55, stroke: '#7f9c98' },
  { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: '#f3ddd0', opacity: 0.5 },
  { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: '#eccbb2', opacity: 0.5 },
  { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: '#e2ae92', opacity: 0.5 },
  { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: '#e5b885', opacity: 0.5 },
  { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: '#daa66f', opacity: 0.5 },
  { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: '#d8d0c4', opacity: 0.5 },
  { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: '#eee7da', opacity: 0.55, stroke: '#8a8078' },
  { id: 'water',          label: 'WATERWAY',                                 fill: '#cbdae2', opacity: 0.6 },
  { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: '#ddd6cc', opacity: 0.7, stroke: '#8a8078' },
  { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: '#c2b39a', opacity: 0.5 },
];

export const TEMPLATES: Template[] = [
  { id: 'flamingo', label: 'Flamingo', note: 'paper and four tints with textures, every building white',
    font: GROTESK, streetFont: NARROW, textScale: 0.96,
    ink: '#1c1c1c',
    // Street names and the parks' discs a light cucumber green; the
    // institutions' discs the sand family's ink, a light brown.
    streetInk: '#5f9a58', discInk: SAND_INK, discParkInk: '#5f9a58',
    rule: '#8a8a8a',
    site: CORAL, dimension: '#56616b', wind: '#87959d', sun: '#efe8d4', road: GREY_INK, water: BLUE,
    transit: NAVY, rail: '#d43d33', walk5: '#1f8a5a', walk10: '#6fb88c', busRoute: '#7a8bb0', heritage: SAND_INK,
    // Solid roundels, bus routes as a faint dotted line, the catchments
    // dotted green with their walking time along them, and the railway as a
    // red dotted line.
    isochrone: 'dotted', roundel: 'solid', busLine: 'dotted', railLine: 'dotted',
    ground: 'paper', footprints: 'white',
    categories: FLAMINGO_CATEGORIES },
  { id: 'kingfisher', label: 'Kingfisher', note: 'the masterplan palette: pale zone grounds with the buildings in each family\'s strong colour',
    font: GROTESK, streetFont: NARROW, textScale: 0.96,
    ink: '#1c1c1c',
    // Street names and the institutions' number discs in the reference's
    // peach, a step deeper so it reads on the pale grounds; the parks' discs
    // keep the leaf green.
    streetInk: '#e39a6f', discInk: '#e39a6f', discParkInk: '#8faf6a',
    rule: '#8a8a8a',
    site: F2.magenta, dimension: '#56616b', wind: '#87959d', sun: '#efe8d4', road: F2.grey, water: F2.water,
    transit: '#365696', rail: '#e8835e', walk5: '#1f8a5a', walk10: '#6fb88c', busRoute: '#5b8fd6', heritage: F2.purple,
    isochrone: 'dotted', roundel: 'solid', busLine: 'dotted', railLine: 'dotted',
    // The cadastre and every building in a heavy white line.
    ground: 'paper', footprints: 'colour', footprintEdge: 0.4, lots: 'white', lotWidth: 0.45,
    categories: KINGFISHER_CATEGORIES },
  { id: 'heron', label: 'Heron', note: 'the original office sheet over the aerial, with Flamingo\'s stops, red dotted railway and numbered places',
    font: NARROW, streetFont: NARROW, textScale: 0.96,
    // Arial Narrow throughout, white on the aerial; the institutions' discs
    // a reddish brown, the parks' in the catchments' green.
    ink: '#1c1c1c', streetInk: '#ffffff', discInk: '#9c4a36', discParkInk: '#1f7a4d', rule: '#8a8a8a',
    site: '#cf4a2e', dimension: '#3c4c5a', wind: '#6d8a99', sun: '#f0e4c0', road: '#7d7d7d', water: '#cbdae2',
    transit: NAVY, rail: '#d43d33', walk5: '#1f7a4d', walk10: '#6aaf88', busRoute: '#7a8bb0', heritage: '#94836a',
    isochrone: 'walkers', roundel: 'solid', busLine: 'dashed', railLine: 'dotted',
    // Lots and buildings as heavy white lines over the aerial.
    ground: 'aerial', aerialTone: 'grey', veil: 0.36, tintScale: 1, footprints: 'outline', lots: 'white', streets: 'none', streetLabels: 'plain',
    categories: HERON_CATEGORIES },
  { id: 'conure', label: 'Conure', note: 'Heron with the zoning in the NSW ePlanning colours, keyed by zone code',
    font: NARROW, streetFont: NARROW, textScale: 0.96,
    // Heron's aerial, lines and lettering; the numbered places and the
    // walking catchments in black, the catchments as plain lines with their
    // time and distance written along them.
    ink: '#1c1c1c', streetInk: '#ffffff', discInk: '#1c1c1c', discParkInk: '#1c1c1c', rule: '#8a8a8a',
    site: '#cf4a2e', dimension: '#3c4c5a', wind: '#6d8a99', sun: '#f0e4c0', road: '#7d7d7d', water: '#cbdae2',
    transit: NAVY, rail: '#d43d33', walk5: '#1c1c1c', walk10: '#1c1c1c', busRoute: '#7a8bb0', heritage: '#dbbb7b',
    isochrone: 'labelled', roundel: 'solid', busLine: 'dashed', railLine: 'dotted',
    ground: 'aerial', aerialTone: 'grey', veil: 0.36, tintScale: 1, footprints: 'outline', lots: 'white', streets: 'none', streetLabels: 'plain',
    // The zones in exactly the NSW ePlanning colours, keyed by zone code;
    // heritage in the ePlanning item tan.
    zoning: 'lep',
    categories: HERON_CATEGORIES },
];

// Retired ids still resolve: Flamingo's white version is Flamingo, Flamingo 2 is Kingfisher; the aerial
// Flamingo and both Redferns fall back to the default, which is Flamingo too.
const ALIASES: Record<string, string> = { 'flamingo-white': 'flamingo', 'flamingo-2': 'kingfisher' };
const byId: Record<string, Template> = Object.fromEntries([
  ...TEMPLATES.map((t) => [t.id, t] as const),
  ...Object.entries(ALIASES).map(([alias, id]) => [alias, TEMPLATES.find((t) => t.id === id)!] as const),
]);
export const DEFAULT_TEMPLATE = 'flamingo';

/** The registered id an id or alias names, or the default for anything unknown. */
export function resolveTemplateId(id: string | undefined): string {
  return byId[id ?? '']?.id ?? DEFAULT_TEMPLATE;
}

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
// ---- site analysis themes ---------------------------------------------------
// The templates above are the context sheet's. The site analysis has themes of
// its own; each draws on one of the templates for what it does not set itself
// (fonts, the zones' palette), and the sheet sets the rest. The development
// summary and the deck have no themes: they are drawn in the default template.

export interface SiteTheme { id: string; label: string; note: string; base: string }
export const SITE_THEMES: SiteTheme[] = [
  { id: 'cardinal', label: 'Cardinal', base: 'flamingo',
    note: 'the aerial with the zones hatched; the site, sun, winds and views in one deep red, the sun a crown of broad teeth round a plain circle' },
];
export const DEFAULT_SITE_THEME = 'cardinal';

/** A site theme by id, or the default for anything unknown. */
export function siteTheme(id: string | undefined): SiteTheme {
  return SITE_THEMES.find((t) => t.id === id) ?? SITE_THEMES.find((t) => t.id === DEFAULT_SITE_THEME)!;
}

export type SheetKind = 'context' | 'site' | 'summary' | 'slides';

/** The theme a sheet of this kind is drawn in: a template for the context sheet, a site theme for the site sheet, none ('') for the summary and the deck. */
export function themeFor(sheet: SheetKind, id: string | undefined): string {
  return sheet === 'context' ? resolveTemplateId(id) : sheet === 'site' ? siteTheme(id).id : '';
}

/** The template a sheet of this kind is rendered under, given its theme. */
export function templateFor(sheet: SheetKind, theme: string | undefined): string {
  return sheet === 'context' ? resolveTemplateId(theme) : sheet === 'site' ? siteTheme(theme).base : DEFAULT_TEMPLATE;
}

export function isTemplateId(id: string): boolean {
  return Object.hasOwn(byId, id);
}

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
  /** Secondary text — captions, notes, sources. Optional: the map styles fall back to the ink. */
  inkSoft?: string;
  /** The page and every map's ground. Optional: white where a style does not set it. */
  paper?: string;
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
/** Flamingo's park green and its ink, which the site sheet's trees borrow. */
export const PARK_GREEN = TEAL, PARK_GREEN_INK = TEAL_INK;
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
// are placed in the same warm families. Its red and its slate are the site
// sheet's Heron's too.
const HERON_RED = '#cf4a2e', HERON_SLATE = '#3c4c5a';
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
  { id: 'site',           label: 'SITE',                                     fill: HERON_RED, opacity: 0.5 },
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
    site: HERON_RED, dimension: HERON_SLATE, wind: '#6d8a99', sun: '#f0e4c0', road: '#7d7d7d', water: '#cbdae2',
    transit: NAVY, rail: '#d43d33', walk5: '#1f7a4d', walk10: '#6aaf88', busRoute: '#7a8bb0', heritage: '#94836a',
    isochrone: 'walkers', roundel: 'solid', busLine: 'dashed', railLine: 'dotted',
    // Lots and buildings as heavy white lines over the aerial.
    ground: 'aerial', aerialTone: 'grey', veil: 0.36, tintScale: 1, footprints: 'outline', lots: 'white', streets: 'none', streetLabels: 'plain',
    categories: HERON_CATEGORIES },
  // Canary was called Conure; a request that still names it is drawn in Canary.
  { id: 'canary', label: 'Canary', note: 'Heron with the zoning in the NSW ePlanning colours, keyed by zone code',
    font: NARROW, streetFont: NARROW, textScale: 0.96,
    // Heron's aerial, lines and lettering; the numbered places and the
    // walking catchments in black, the catchments as plain lines with their
    // time and distance written along them.
    ink: '#1c1c1c', streetInk: '#ffffff', discInk: '#1c1c1c', discParkInk: '#1c1c1c', rule: '#8a8a8a',
    site: HERON_RED, dimension: HERON_SLATE, wind: '#6d8a99', sun: '#f0e4c0', road: '#7d7d7d', water: '#cbdae2',
    transit: NAVY, rail: '#d43d33', walk5: '#1c1c1c', walk10: '#1c1c1c', busRoute: '#7a8bb0', heritage: '#dbbb7b',
    isochrone: 'labelled', roundel: 'solid', busLine: 'dashed', railLine: 'dotted',
    ground: 'aerial', aerialTone: 'grey', veil: 0.36, tintScale: 1, footprints: 'outline', lots: 'white', streets: 'none', streetLabels: 'plain',
    // The zones in exactly the NSW ePlanning colours, keyed by zone code;
    // heritage in the ePlanning item tan.
    zoning: 'lep',
    categories: HERON_CATEGORIES },
];

// Retired ids still resolve: Flamingo's white version is Flamingo, Flamingo 2 is Kingfisher, Conure is
// Canary; the aerial Flamingo and both Redferns fall back to the default, which is Flamingo too.
const ALIASES: Record<string, string> = { 'flamingo-white': 'flamingo', 'flamingo-2': 'kingfisher', conure: 'canary' };
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

// ---- the overall analysis deck -----------------------------------------------
// The deck has no themes and is not offered in the picker: it is drawn in its own
// template, Arial throughout on white paper, the family inks of its atlas kit
// (render/atlasKit.ts) over grey base maps, one red for the site.

const DECK_CATEGORIES: Category[] = [
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

export const DECK_TEMPLATE: Template = {
  id: 'deck', label: 'Deck', note: 'the overall analysis deck: Arial on white, the atlas kit\'s five ink families',
  font: SANS, streetFont: SANS, textScale: 0.96,
  ink: '#2a3534', inkSoft: '#6a7572', paper: '#ffffff', streetInk: '#2a3534',
  rule: '#d8cfc0', site: '#c8472e', dimension: '#3d5a94', wind: '#7fa3ad', sun: '#dca62e', road: '#8a8378', water: '#afd2df',
  transit: '#2c4c9c', rail: '#3a4446', walk5: '#2f7d6d', walk10: '#6ba998', busRoute: '#7b90c9', heritage: '#a98a5b',
  isochrone: 'line', roundel: 'ring', busLine: 'dashed', railLine: 'sleepers', ground: 'paper', footprints: 'white',
  categories: DECK_CATEGORIES,
};

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
// ---- site analysis themes ---------------------------------------------------
// The templates above are the context sheet's. The site analysis has themes of
// its own; each draws on one of the templates for what it does not set itself
// (fonts, the zones' palette), and the sheet sets the rest. The development
// summary has no theme and is drawn in the default template; the deck has none
// either and is drawn in its own (DECK_TEMPLATE, above).

/**
 * How a site theme draws what the site sheet shows. What the sheet says is the
 * same in every theme; these are the choices of hand: which marks, in which pens.
 */
export interface SiteLook {
  /** The face of every word on the map and in the legend. */
  font: string;
  /** What the map is drawn on: the aerial photograph, or plain paper. */
  ground: 'aerial' | 'paper';
  /** The white veil over the aerial outside the site. */
  veil: number;
  /** The aerial outside the site in its own colours, or in greyscale; the site keeps its colours either way. */
  aerial: 'colour' | 'grey';
  /** The site's pen: its boundary, corners and levels. */
  site: string;
  /** The boundary's dash. */
  siteDash: string;
  /** The boundary dimensions' ink (Heron sets them in the site's red, Canary in black). */
  dimensionInk: string;
  /** The fall of terrain's arrow. */
  fall: string;
  /** The FALL/AREA words: on a white box, straight on the site with a fine white edge to the letters, or plain. */
  fallWords: 'box' | 'edge' | 'plain';
  /** Their ink. */
  fallInk: string;
  /** Every word on the map, as a multiple of the sheet's one lettering size (6.2 mm on the A1). */
  textScale: number;
  /** The neighbours' building outlines, white, this wide (mm). */
  buildingEdge: number;
  /** The buildings: an outline over the aerial's roofs, or filled in their zone family's strong colour. */
  buildings: 'outline' | 'colour';
  /** The neighbours: number and storeys in white on the building, or number, storeys and height limit in black, written straight on the map. */
  neighbours: 'white' | 'black';
  /** The second ink, for the height limit. */
  neighbourHeightInk: string;
  /** The zones hatched over the aerial in their family colours, filled in their NSW ePlanning colours, filled as the context template's pale grounds, or not drawn. */
  zones: 'hatch' | 'lep' | 'fill' | 'none';
  /** Under the hatch, each zone tinted in its category's fill, multiplied into the aerial: the tint's opacity (0 for the hatch alone). */
  zoneTint: number;
  /** The LEP heritage items and conservation areas, hatched. */
  heritage: boolean;
  /** Their inks. */
  heritageInk: { item: string; area: string };
  /** Contours with their levels along them. */
  contours: boolean;
  /** Their ink, and their levels'. */
  contourInk: string;
  /** The street names' ink, plain along the road. */
  streetInk: string;
  /** The suns: an open jagged crown at each solstice's rise and set on its arc, a plain sun at each inside the climate circle, named, with north an arrow on the circle, or the office's own drawn suns (climateSymbols.ts) on the arcs, no two alike. */
  sun: 'crown' | 'circle' | 'symbol';
  /** The sun path's pen, and the suns' fill and edge. */
  sunPen: string;
  sunFill: string;
  sunEdge: string;
  /** The suns' words and the solar hours. */
  sunInk: string;
  /** The solar hours marked along the crowns' arcs. */
  sunHours: boolean;
  /** The winds: three hand-drawn strands abreast, each named around a circle about the site with its quarter hatched on the circle, or the office's triple arrow set on the sun path's ring. */
  wind: 'strands' | 'circle' | 'symbol';
  windPen: string;
  /** The ink of the winds' and the suns' words. */
  climateInk: string;
  /** Noise: a swelling band beside the source, or a zigzag. */
  noise: 'band' | 'zigzag';
  noisePen: string;
  /** Views: a telescope aimed along the sight line, a white band inside the climate circle with the view's name around it, or a plain outlined triangle opening from the site edge. */
  views: 'telescope' | 'circle' | 'triangle';
  /** A thin white edge on words drawn over busy ground (the trees' numbers). */
  textHalo: boolean;
  /** Indicative kerb lines along the streets (lib/kerbs.ts), for a sheet with no aerial to show them. */
  kerbs: boolean;
  /** The telescope's pen and its words. */
  viewPen: string;
  /** Kerbside parking: one quad per bay, or a hatched zone. */
  parking: 'bays' | 'hatch';
}

export interface SiteTheme { id: string; label: string; note: string; base: string; look: SiteLook }

// Heron: Dove's marks in the Heron template's colours. The aerial in grey
// outside the site, the zones in Heron's palette, the site, its levels and
// boundary dimensions in Heron's red, the fall in its slate and the FALL/AREA
// words in the red again, with the site's other figures; the climate
// still drawn quietly, the sun, its path, the telescopes and the winds in one
// grey and the contours a lighter one; the neighbours white, in a fine
// outline. Heron's tints are pale, so each zone is tinted as well as
// hatched, the tint multiplied into the grey photograph so its roofs and
// trees still read; the FALL/AREA words sit plain on the photograph like
// the levels, with no box and no white edge. Every word on the map is a
// fifth larger than the sheet's usual lettering. It was Dove, on Flamingo's palette with the site in a deeper red, and before
// that Cardinal, with the sun in mustard and the winds and views in the
// site's red; a request naming either is drawn in Heron.
const CLIMATE_GREY = '#6f7377';
const HERON_LOOK: SiteLook = {
  font: NARROW, ground: 'aerial', veil: 0.55, aerial: 'grey', site: HERON_RED, siteDash: '7,2,1.6,2', dimensionInk: HERON_RED, fall: HERON_SLATE, fallWords: 'plain', fallInk: HERON_RED, textScale: 1.2,
  buildingEdge: 0.3, buildings: 'outline', neighbours: 'white', neighbourHeightInk: '#ffffff', zones: 'hatch', zoneTint: 0.55,
  heritage: false, heritageInk: { item: '#e39a3b', area: '#c8372d' }, contours: true, contourInk: '#a9adb1',
  streetInk: '#ffffff',
  sun: 'crown', sunPen: CLIMATE_GREY, sunFill: '#ffffff', sunEdge: CLIMATE_GREY, sunInk: CLIMATE_GREY, sunHours: true,
  wind: 'strands', windPen: CLIMATE_GREY, climateInk: CLIMATE_GREY,
  noise: 'band', noisePen: '#3f6fc2', views: 'telescope', viewPen: CLIMATE_GREY, parking: 'bays', textHalo: true, kerbs: false,
};

// Canary: the office's classic site sheet (DA 004 at Arncliffe, Cabramatta,
// Randwick) in the colours of the context sheet's Canary: the aerial in grey
// under its veil, the zones in the NSW ePlanning colours, its red for the
// dashed site and its levels, its slate for the boundary dimensions and the
// fall, written straight on the site; each neighbour's number, storeys and
// height limit and the street names written straight on the map; heritage in
// the ePlanning tan and red. The sun, the winds and the views are one black
// circle about the site: the winds named around it outside over hatched
// quarters, the views inside over white ones, four plain suns at the
// solstices' rise and set within, and north an arrow on it.
const CANARY_CONTEXT = TEMPLATES.find((t) => t.id === 'canary')!;
const CANARY_LOOK: SiteLook = {
  font: SANS, ground: 'aerial', veil: CANARY_CONTEXT.veil!, aerial: 'grey', site: CANARY_CONTEXT.site, siteDash: '4.2,1.8',
  dimensionInk: CANARY_CONTEXT.dimension, fall: CANARY_CONTEXT.dimension, fallWords: 'plain', fallInk: CANARY_CONTEXT.site, textScale: 1,
  buildingEdge: 0.55, buildings: 'outline', neighbours: 'black', neighbourHeightInk: '#111111', zones: 'lep', zoneTint: 0,
  heritage: true, heritageInk: { item: CANARY_CONTEXT.heritage, area: '#ff0000' }, contours: false, contourInk: '#3f9a5c',
  streetInk: CANARY_CONTEXT.ink,
  sun: 'circle', sunPen: CANARY_CONTEXT.ink, sunFill: '#ffffff', sunEdge: CANARY_CONTEXT.ink, sunInk: CANARY_CONTEXT.ink, sunHours: false,
  wind: 'circle', windPen: CANARY_CONTEXT.ink, climateInk: CANARY_CONTEXT.ink,
  noise: 'zigzag', noisePen: CANARY_CONTEXT.transit, views: 'circle', viewPen: CANARY_CONTEXT.ink, parking: 'hatch', textHalo: true, kerbs: false,
};

// Kookaburra: the site sheet on Kingfisher's paper, no photograph: the zones
// as its pale grounds on the lots only, so the roads stay white, every
// building in its family's strong colour with a white edge and its number in
// white, the white cadastre, its grotesk and its peach street names, the site
// in its magenta. The office's own suns in yellow, a different one at each
// rise and set, and its triple-arrow winds in light blue, both set on the sun
// path's ring, both large; the ring a bold yellow line with no hours. Views are
// plain triangles; no word has a white edge, and FALL and AREA sit straight on
// the site. The kerbs are drawn, indicatively, since there is no photograph
// to show them.
const KOOKABURRA_LOOK: SiteLook = {
  font: GROTESK, ground: 'paper', veil: 0, aerial: 'colour', site: F2.magenta, siteDash: '7,2,1.6,2', dimensionInk: '#56616b', fall: '#56616b', fallWords: 'plain', fallInk: '#56616b', textScale: 1,
  buildingEdge: 0.4, buildings: 'colour', neighbours: 'white', neighbourHeightInk: '#ffffff', zones: 'fill', zoneTint: 0,
  heritage: false, heritageInk: { item: '#e39a3b', area: '#c8372d' }, contours: true, contourInk: '#a9adb1',
  streetInk: '#e39a6f',
  sun: 'symbol', sunPen: '#f2c200', sunFill: '#f2c200', sunEdge: '#f2c200', sunInk: '#c99700', sunHours: false,
  wind: 'symbol', windPen: '#7cc4ea', climateInk: '#3d93c7',
  noise: 'band', noisePen: '#3f6fc2', views: 'triangle', viewPen: '#56616b', parking: 'bays', textHalo: false, kerbs: true,
};

export const SITE_THEMES: SiteTheme[] = [
  { id: 'heron', label: 'Heron', base: 'heron', look: HERON_LOOK,
    note: 'the grey aerial with the zones in Heron\'s palette; the site in Heron\'s red, the sun path, its crowns, the telescopes and the winds in grey, the contours in light grey' },
  { id: 'kookaburra', label: 'Kookaburra', base: 'kingfisher', look: KOOKABURRA_LOOK,
    note: 'Kingfisher on paper, no aerial: the zones as its pale grounds, the buildings in their family colour, the office\'s yellow suns and light-blue triple-arrow winds on the sun path\'s ring' },
  { id: 'canary', label: 'Canary', base: 'flamingo', look: CANARY_LOOK,
    note: 'the office classic in the context Canary\'s colours: a grey aerial with the zones in the ePlanning colours, one black circle for the sun, the winds and the views, each neighbour\'s number, storeys and height limit' },
];
export const DEFAULT_SITE_THEME = 'heron';

/** Old names still asked for by saved requests and batches. */
const SITE_THEME_ALIASES: Record<string, string> = { dove: 'heron', cardinal: 'heron' };

/** A site theme by id (or a former name), or the default for anything unknown. */
export function siteTheme(id: string | undefined): SiteTheme {
  const want = id && (SITE_THEME_ALIASES[id] ?? id);
  return SITE_THEMES.find((t) => t.id === want) ?? SITE_THEMES.find((t) => t.id === DEFAULT_SITE_THEME)!;
}

export type SheetKind = 'context' | 'site' | 'summary' | 'yield' | 'slides';

/** The theme a sheet of this kind is drawn in: a template for the context sheet, a site theme for the site sheet, none ('') for the summary, the yield and the deck. */
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

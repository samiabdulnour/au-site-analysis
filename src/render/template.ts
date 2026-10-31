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
  /** The reference's salmon, the site's colour on Kingfisher's sheets and decks, and the same hue deepened to carry a line of bold type. */
  salmon: '#f0bcac', salmonDeep: '#d27b63',
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
    // The deck's site in the reference's salmon, not the context sheet's magenta; the narrative in the same hue deepened.
    site: F2.salmon, dimension: '#56616b', wind: '#87959d', sun: '#efe8d4', road: F2.grey, water: F2.water,
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

// ---- site analysis themes ---------------------------------------------------
// The templates above are the context sheet's. The site analysis has themes of
// its own; each draws on one of the templates for what it does not set itself
// (fonts, the zones' palette), and the sheet sets the rest. The development
// summary has no theme and is drawn in the default template; the deck has none
// either; the yield and the site report take the four styles (the decks'
// styles, below).

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
  /** The buildings: an outline over the aerial's roofs, filled in their zone family's strong colour, or white with a hairline of the family's ink, as the context sheet's Flamingo draws them. */
  buildings: 'outline' | 'colour' | 'white';
  /** White buildings finely hatched in their family's ink, so they read apart from the white roads. */
  buildingHatch?: boolean;
  /** The cadastre's pen: a white line where unset, or this ink as a fine line, as the context sheet's faint lots. */
  lotInk?: string;
  /** The neighbours: number and storeys on the building, or number, storeys and height limit in black, written straight on the map. */
  neighbours: 'white' | 'black';
  /** The number and storeys' ink where they go on the building: white where unset. */
  neighbourInk?: string;
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
  /** Where set, the contour lines' strength under the buildings (0 to 1), so the buildings read clean. */
  contourUnderBuildings?: number;
  /** The street names' ink, plain along the road. */
  streetInk: string;
  /** The suns: an open jagged crown at each solstice's rise and set on its arc, a plain sun at each inside the climate circle, named, with north an arrow on the circle, the office's drawn sun (climateSymbols.ts) at each rise and set on dashed arcs, or its small rayed sun at the tips of a crescent band for each solstice. */
  sun: 'crown' | 'circle' | 'drawn' | 'band';
  /** The sun path's pen, and the suns' fill and edge. */
  sunPen: string;
  sunFill: string;
  sunEdge: string;
  /** The suns' words and the solar hours. */
  sunInk: string;
  /** The solar hours marked along the crowns' arcs. */
  sunHours: boolean;
  /** The winds: three hand-drawn strands abreast, each named around a circle about the site with its quarter hatched on the circle, the office's drawn wind on the sun path's ring with the ring dashed in the wind's pen where the sun does not go, or its broken-shaft arrow on a crescent band over the quarter it blows from. */
  wind: 'strands' | 'circle' | 'drawn' | 'band';
  windPen: string;
  /** The ink of the winds' and the suns' words. */
  climateInk: string;
  /** Noise: a swelling band beside the source, or a zigzag. */
  noise: 'band' | 'zigzag';
  noisePen: string;
  /** Views: a telescope aimed along the sight line, a white band inside the climate circle with the view's name around it, the office's drawn view (a wedge and the eye in a triangle) opening from the site edge, or a solid triangle with the eye white in it. */
  views: 'telescope' | 'circle' | 'drawn' | 'band';
  /** The office's marks, where the sun, the winds or the views are drawn or banded: the drawn marks' fill and outline, the sun's crescent (from its rising end's colour to its noon's), the winds' crescent, and the views' triangle. */
  marks?: { fill: string; edge: string; sunBand: [string, string]; windBand: string; view: string };
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
// solstices' rise and set within, each solstice's path joining its two over
// north on a circle inside the climate one (summer solid, winter dashed a
// step further in), and north an arrow on it.
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

// Kingfisher: the site sheet on Kingfisher's paper, no photograph: the zones
// as its pale grounds on the lots only, so the roads stay white, every
// building in its family's strong colour with a white edge and its number in
// white, the white cadastre, its grotesk and its peach street names, the site
// in its magenta. The climate as the office drew it for this palette: each
// solstice's path a nearly solid crescent in warm yellow, amber at its ends and
// brightest at noon, the office's small rayed sun at each rise and set; each
// wind a smaller translucent blue crescent over the quarter it blows from with
// the office's broken-shaft arrow on it in white; each view a green triangle
// with the eye white in it. No word has a white edge, and FALL and AREA sit
// straight on the site. The kerbs are drawn, indicatively, since there is no
// photograph to show them. It was called Kookaburra; a request naming it is
// drawn in Kingfisher.
const KINGFISHER_LOOK: SiteLook = {
  font: GROTESK, ground: 'paper', veil: 0, aerial: 'colour', site: F2.magenta, siteDash: '7,2,1.6,2', dimensionInk: '#56616b', fall: '#56616b', fallWords: 'plain', fallInk: '#56616b', textScale: 1,
  buildingEdge: 0.4, buildings: 'colour', neighbours: 'white', neighbourHeightInk: '#ffffff', zones: 'fill', zoneTint: 0,
  heritage: false, heritageInk: { item: '#e39a3b', area: '#c8372d' }, contours: true, contourInk: '#a9adb1',
  streetInk: '#e39a6f',
  sun: 'band', sunPen: '#f2c200', sunFill: '#f5a800', sunEdge: '#f5a800', sunInk: '#c98a00', sunHours: false,
  wind: 'band', windPen: '#4aa3e8', climateInk: '#2f86c9',
  noise: 'band', noisePen: '#3f6fc2', views: 'band', viewPen: '#3a8f5c', parking: 'bays', textHalo: false, kerbs: true,
  marks: { fill: '#ffffff', edge: '#ffffff', sunBand: ['#f7a21b', '#ffd12e'], windBand: '#4aa3e8', view: '#3fa66b' },
};

// Flamingo: the same paper and plan in Flamingo's palette, drawn as its context
// sheet draws them: the zones as its tints and textures, every building white
// in a heavy outline of its family's ink so it stands clear of its ground, and
// finely hatched in that ink so it stands clear of the white roads, the
// contours all but gone where they cross it, the
// cadastre the context sheet's fine grey, the site in its coral, the street
// names and the neighbours' numbers in
// its green. The climate in the office's drawn marks: a sun at each rise and
// set on the solstices' arcs, dashed in yellow, solid in the amber of its
// name; the winds on the same ring, which is dashed in blue where the sun
// never goes, solid in the blue of theirs; the views a wedge and an eye in a
// widening triangle, solid in a deeper green than the streets', as their words.
const FLAMINGO_CONTEXT = TEMPLATES.find((t) => t.id === 'flamingo')!;
const FLAMINGO_LOOK: SiteLook = {
  ...KINGFISHER_LOOK, site: FLAMINGO_CONTEXT.site, streetInk: FLAMINGO_CONTEXT.streetInk,
  buildings: 'white', buildingEdge: 1.5, buildingHatch: true, contourUnderBuildings: 0.12, lotInk: FLAMINGO_CONTEXT.road, neighbourInk: FLAMINGO_CONTEXT.streetInk,
  sun: 'drawn', sunPen: '#f5b400', sunFill: '#fcddd4', sunEdge: '#5ba8e1', sunInk: '#d48f00',
  wind: 'drawn', windPen: '#5ba8e1', climateInk: '#3d8fd1',
  views: 'drawn', viewPen: '#2e9257',
  marks: { fill: '#fcddd4', edge: '#5ba8e1', sunBand: ['#f7a21b', '#ffd12e'], windBand: '#5ba8e1', view: '#fcddd4' },
};

export const SITE_THEMES: SiteTheme[] = [
  { id: 'heron', label: 'Heron', base: 'heron', look: HERON_LOOK,
    note: 'the grey aerial with the zones in Heron\'s palette; the site in Heron\'s red, the sun path, its crowns, the telescopes and the winds in grey, the contours in light grey' },
  { id: 'kingfisher', label: 'Kingfisher', base: 'kingfisher', look: KINGFISHER_LOOK,
    note: 'Kingfisher on paper, no aerial: the zones as its pale grounds, the buildings in their family colour, the sun paths as yellow crescents, the winds as blue ones with white arrows, the views as green triangles with an eye' },
  { id: 'flamingo', label: 'Flamingo', base: 'flamingo', look: FLAMINGO_LOOK,
    note: 'Flamingo on paper, as its context sheet: the zones as its tints and textures, the buildings white and finely hatched, the cadastre fine grey, the street names and numbers green; the office\'s suns in amber, winds in blue and views in green, each as its words' },
  { id: 'canary', label: 'Canary', base: 'flamingo', look: CANARY_LOOK,
    note: 'the office classic in the context Canary\'s colours: a grey aerial with the zones in the ePlanning colours, one black circle for the sun, the winds and the views, each neighbour\'s number, storeys and height limit' },
];
export const DEFAULT_SITE_THEME = 'heron';

/** Old names still asked for by saved requests and batches. */
const SITE_THEME_ALIASES: Record<string, string> = { dove: 'heron', cardinal: 'heron', kookaburra: 'kingfisher' };

/** A site theme by id (or a former name), or the default for anything unknown. */
export function siteTheme(id: string | undefined): SiteTheme {
  const want = id && (SITE_THEME_ALIASES[id] ?? id);
  return SITE_THEMES.find((t) => t.id === want) ?? SITE_THEMES.find((t) => t.id === DEFAULT_SITE_THEME)!;
}

// ---- the decks' styles --------------------------------------------------------
// The yield and the site report take the two maps' four styles. Each is drawn
// under the context template of that name and reads its palette from it: the
// site colour for the narrative and the site, the categories (or, in Canary,
// the NSW ePlanning colours) for the zones, the heritage, street and lot inks,
// the ground; and the five ink families of the atlas kit (render/atlasKit.ts),
// one a topic, are drawn from the same categories, so every page of a deck
// is in its style's colours.

/** The decks' styles, in the picker's order. */
export const DECK_THEMES = ['flamingo', 'kingfisher', 'heron', 'canary'] as const;

/** The style a deck request names: one of the four, or the default for anything unknown. */
export function deckThemeId(id: string | undefined): string {
  return resolveTemplateId(id);
}

/**
 * What a deck page draws differently from style to style, read from the
 * active template: which palette its zones take, what the maps stand on, how
 * the buildings, the lots and the street names are drawn, and the one colour
 * its narrative is set in.
 */
export interface DeckLook {
  /** The style's id: one of DECK_THEMES. */
  id: string;
  /** The narrative's ink and the site's: the style's site colour, deepened where it is too light for bold type on white. */
  accent: string;
  /** The accent's family, for the figures that are not zones (the yield's paths, the heights). */
  family: InkFamily;
  /** The zones: the deck's land-use categories with their textures, or each code in its NSW ePlanning colour. */
  zones: 'categories' | 'lep';
  /** The land-use categories the deck's zones and lots take: the template's, or the swatch sheet's for the styles that keep it. */
  categories: Category[];
  /** What a map stands on: paper, or the aerial in grey under the template's veil, where the bundle carries one. */
  ground: 'paper' | 'aerial';
  /** The aerial's veil, and how far the tints are thinned over it. */
  veil: number;
  tintScale: number;
  /** The buildings on a plan: white in a hairline of the family's ink, filled in the family's colour with a white edge, or a quiet grey (the aerial styles, where no photograph is to hand). */
  buildings: 'white' | 'colour' | 'grey';
  /** The cadastre: a faint hairline in the road ink, or a white line. */
  lots: 'faint' | 'white';
  /** The street names' ink on paper, and on the aerial. */
  streetInk: string;
  streetInkAerial: string;
  /** The heritage items' ink, and the conservation areas'. */
  heritage: string;
  heritageArea: string;
  /** How the style renders data on a map: hatches, lines and patches on paper, or tones and heat ramps over the photograph. */
  technique: 'line' | 'tone';
}

/** `hex` mixed toward white: k of the colour, the rest white. */
export function tint(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(255 - (255 - v) * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
/** `hex` darkened: each channel at k of itself. */
export function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
/** `a` mixed with `b`: k of `b`, the rest `a`. */
export function mix(a: string, b: string, k: number): string {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((na >> sh) & 255) * (1 - k) + ((nb >> sh) & 255) * k).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
/** `hex` made vivid: its hue kept, its saturation raised to at least `minSat` and its lightness capped at `maxLight` (HSL), so a pastel family yields an ink that carries a hatch line or a band. */
export function vivid(hex: string, minSat = 0.55, maxLight = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, sat = 0;
  if (d > 1e-6) {
    sat = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const S = Math.max(sat, minSat), L = Math.min(l, maxLight);
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
  const ch = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; return Math.round(v * 255).toString(16).padStart(2, '0'); };
  return `#${ch(h + 1 / 3)}${ch(h)}${ch(h - 1 / 3)}`;
}
/** The relative luminance of `hex`, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
/** `hex` darkened, a step at a time, until its luminance is at most `maxL`: a tint made into an ink that carries a line or a word on white. */
export function inkFor(hex: string, maxL = 0.25): string {
  let c = hex;
  for (let i = 0; i < 24 && luminance(c) > maxL; i++) c = shadeHex(c, 0.9);
  return c;
}

/**
 * One ink family of the atlas kit: a tint for a ground (`light`, `mid`,
 * `solid`, light to firm), a `line` for the patterns that tell categories
 * apart inside the family, a `deep` for their dots and outlines, and a
 * `text` dark enough for the bold narrative.
 */
export interface InkFamily { solid: string; mid: string; light: string; line: string; deep: string; text: string }
export type InkFamilyName = 'red' | 'orange' | 'sage' | 'green' | 'blue';

// The office's swatch sheet, which the decks were drawn in before they took
// the styles: five families of three tints, two pattern inks and a text ink
// dark enough for the bold narrative. Heron keeps these for its decks rather
// than its tans: the office's own sheet is the office's own palette. Canary
// has a punchy sheet of its own (CANARY_INK), so the two aerial styles differ
// in more than the site's ink.
export const KIT_INK: Record<InkFamilyName, InkFamily> = {
  red:    { solid: '#d54747', mid: '#e69ea1', light: '#f4d8d9', line: '#d54747', deep: '#b20000', text: '#d54747' },
  orange: { solid: '#e9a879', mid: '#f3d2ba', light: '#faeee3', line: '#efbf99', deep: '#df726a', text: '#f5a470' },
  sage:   { solid: '#cbcbb9', mid: '#e5e5dc', light: '#f5f5f1', line: '#d9c49c', deep: '#9c9c88', text: '#8f8f78' },
  green:  { solid: '#7bb990', mid: '#bbdcc7', light: '#e4f0e9', line: '#7bb990', deep: '#2f8f55', text: '#4e9a69' },
  blue:   { solid: '#b2daf5', mid: '#d8ecf9', light: '#eff8fd', line: '#9fcbea', deep: '#4b55a0', text: '#0068b3' },
};
// The land-use categories in the swatch sheet's families, for those decks'
// zones: the residential tiers up the red family, the centres in the orange,
// open space in the green, the institutions in the blue, industry and
// infrastructure in the sage; told apart inside a family by texture, as the
// context sheet tells them. Thinned where they lie over the photograph.
const KIT_CATEGORIES: Category[] = (() => {
  const K = KIT_INK;
  return [
    { id: 'site',           label: 'SITE',                                     fill: K.red.deep, opacity: 0.5 },
    { id: 'medical',        label: 'MEDICAL',                                  fill: K.blue.mid, opacity: 0.7, stroke: K.blue.deep, figure: K.blue.deep },
    { id: 'education',      label: 'EDUCATION',                                fill: K.blue.solid, opacity: 0.7, stroke: K.blue.deep, texture: 'lines', textureColor: PAPER, figure: K.blue.deep },
    { id: 'childCare',      label: 'CHILD CARE / AGED CARE',                   fill: K.blue.light, opacity: 0.7, stroke: K.blue.deep, figure: K.blue.deep },
    { id: 'mixedUse',       label: 'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL', fill: K.orange.solid, opacity: 0.65, texture: 'dots', textureColor: K.orange.deep, figure: K.orange.deep },
    { id: 'retail',         label: 'ACTIVE RETAIL',                            fill: K.orange.mid, opacity: 0.7, texture: 'cross', textureColor: K.orange.deep, figure: K.orange.deep },
    { id: 'openSpace',      label: 'OPEN SPACE',                               fill: K.green.mid, opacity: 0.7, texture: 'dots', textureColor: K.green.deep, figure: K.green.deep },
    { id: 'community',      label: 'COMMUNITY HUB',                            fill: K.blue.mid, opacity: 0.7, stroke: K.blue.deep, texture: 'cross', textureColor: PAPER, figure: K.blue.deep },
    { id: 'r2',             label: 'R2 LOW DENSITY RESIDENTIAL',               fill: K.red.light, opacity: 0.75, figure: K.red.line },
    { id: 'r3',             label: 'R3 MEDIUM DENSITY RESIDENTIAL',            fill: K.red.mid, opacity: 0.65, figure: K.red.line },
    { id: 'r4',             label: 'R4 HIGH DENSITY RESIDENTIAL',              fill: K.red.solid, opacity: 0.55, texture: 'lines', textureColor: K.red.deep, figure: K.red.deep },
    { id: 'localCentre',    label: 'LOCAL CENTRE',                             fill: K.orange.solid, opacity: 0.65, figure: K.orange.deep },
    { id: 'commercial',     label: 'COMMERCIAL CENTRE',                        fill: K.orange.solid, opacity: 0.65, texture: 'lines', textureColor: K.orange.deep, figure: K.orange.deep },
    { id: 'industrial',     label: 'GENERAL INDUSTRIAL',                       fill: K.sage.solid, opacity: 0.7, texture: 'lines', textureColor: K.sage.deep, figure: K.sage.deep },
    { id: 'infrastructure', label: 'INFRASTRUCTURE FACILITY',                  fill: K.sage.mid, opacity: 0.75, stroke: K.sage.deep, figure: K.sage.deep },
    { id: 'water',          label: 'WATERWAY',                                 fill: K.blue.solid, opacity: 0.7 },
    { id: 'railway',        label: 'RAILWAY TRACKS',                           fill: K.sage.mid, opacity: 0.75, stroke: K.sage.deep, figure: K.sage.deep },
    { id: 'heritage',       label: 'GENERAL HERITAGE SITE',                    fill: K.sage.line, opacity: 0.6 },
  ];
})();
/** The styles whose decks keep the swatch sheet. */
const KIT_STYLES = new Set(['heron']);

// Canary's own sheet, punchy as its context sheet is: its red, its yellow, its lime and its lilac-blue, with a warm
// grey for the neutral. Its decks read these rather than families derived from its muted categories.
export const CANARY_INK: Record<InkFamilyName, InkFamily> = {
  red:    { solid: '#ff483b', mid: '#ffa39c', light: '#ffdcd8', line: '#ff483b', deep: '#c8231a', text: '#d9372c' },
  orange: { solid: '#ffd400', mid: '#ffe766', light: '#fff6bf', line: '#e0b800', deep: '#b38600', text: '#9a7300' },
  sage:   { solid: '#d8d8d0', mid: '#e8e8e2', light: '#f4f4f0', line: '#a0a098', deep: '#6e6e66', text: '#7a7a72' },
  green:  { solid: '#55e000', mid: '#a6f066', light: '#dcfac4', line: '#3fb300', deep: '#2a8000', text: '#2f8a00' },
  blue:   { solid: '#7f9fd9', mid: '#b4c6e7', light: '#e3ebf8', line: '#7f9fd9', deep: '#2b4fb0', text: '#2b4fb0' },
};

/** A family drawn from one land-use category of the active template: its tint at three strengths, its texture ink for the lines. */
function familyOf(c: Category | undefined, fallback: InkFamily): InkFamily {
  if (!c) return fallback;
  const plain = (h: string | undefined) => (h && h !== '#ffffff' && luminance(h) > 0.03 ? h : undefined);
  const line = c.stroke ?? plain(c.textureColor) ?? (c.figure && c.figure !== c.fill ? c.figure : undefined) ?? inkFor(c.fill, 0.35);
  return {
    solid: tint(c.fill, Math.min(1, c.opacity + 0.25)),
    mid: tint(c.fill, Math.min(1, c.opacity * 0.65)),
    light: tint(c.fill, Math.min(1, c.opacity * 0.3)),
    line, deep: inkFor(line, 0.16), text: inkFor(line, 0.25),
  };
}

const familiesByTemplate = new Map<string, Record<InkFamilyName, InkFamily>>();

/**
 * The atlas kit's five ink families, one a topic, in the active style: red
 * is the accent's (the site, the controls, what constrains); orange the
 * centres' (the mixed-use category: activity, character, market); sage the
 * neutral (the industrial category's grey or stone: ground, built form, the
 * site's own page); green the living layers' (open space); blue transport's
 * (the transit ink, with the water).
 */
export function deckFamilies(): Record<InkFamilyName, InkFamily> {
  const t = tpl();
  const hit = familiesByTemplate.get(t.id);
  if (hit) return hit;
  if (KIT_STYLES.has(t.id)) { familiesByTemplate.set(t.id, KIT_INK); return KIT_INK; }
  if (t.id === 'canary') { familiesByTemplate.set(t.id, CANARY_INK); return CANARY_INK; }
  const look = deckLook();
  const cat = (id: string) => t.categories.find((c) => c.id === id);
  const navy = t.transit;
  const fam: Record<InkFamilyName, InkFamily> = {
    red: look.family,
    orange: familyOf(cat('mixedUse'), look.family),
    sage: familyOf(cat('industrial'), { solid: '#d4d4d0', mid: '#e6e6e2', light: '#f4f4f1', line: '#9a9a94', deep: '#6d6d68', text: '#6d6d68' }),
    green: familyOf(cat('openSpace'), look.family),
    blue: { solid: tint(navy, 0.4), mid: tint(navy, 0.25), light: tint(navy, 0.1), line: tint(navy, 0.6), deep: navy, text: inkFor(navy, 0.25) },
  };
  familiesByTemplate.set(t.id, fam);
  return fam;
}

/** The deck look of the active template (see DeckLook). */
export function deckLook(): DeckLook {
  const t = tpl();
  const kit = KIT_STYLES.has(t.id);
  // Flamingo's coral is a map tint, too light for a line of bold type; the others hold.
  // The narrative's ink is the site's own, deepened where it is too light for bold type on white: the style's red on every page.
  const accent = t.id === 'kingfisher' ? F2.salmonDeep : inkFor(t.site, 0.3);
  const family: InkFamily = kit ? KIT_INK.red : { solid: accent, mid: tint(accent, 0.45), light: tint(accent, 0.18), line: accent, deep: shadeHex(accent, 0.78), text: accent };
  const aerial = t.ground === 'aerial';
  return {
    id: t.id, accent, family,
    zones: t.zoning === 'lep' ? 'lep' : 'categories', categories: kit ? KIT_CATEGORIES : t.categories,
    ground: aerial ? 'aerial' : 'paper', veil: t.veil ?? 0.36, tintScale: aerial ? (t.tintScale ?? 0.55) : 1,
    buildings: t.footprints === 'colour' ? 'colour' : t.footprints === 'white' ? 'white' : 'grey',
    lots: t.lots === 'white' ? 'white' : 'faint',
    // Heron and Canary name their streets white on the photograph; on paper every style's names take its ink, or the sheet's.
    streetInk: t.streetInk === '#ffffff' ? t.ink : t.streetInk, streetInkAerial: t.streetInk,
    heritage: t.heritage, heritageArea: t.id === 'canary' ? '#ff0000' : t.heritage,
    technique: aerial ? 'tone' : 'line',
  };
}

export type SheetKind = 'context' | 'site' | 'summary' | 'yield' | 'slides';

/** The theme a sheet of this kind is drawn in: a template for the context sheet, a site theme for the site sheet, a deck style for the yield and the site report, none ('') for the summary. */
export function themeFor(sheet: SheetKind, id: string | undefined): string {
  return sheet === 'context' ? resolveTemplateId(id) : sheet === 'site' ? siteTheme(id).id : sheet === 'yield' || sheet === 'slides' ? deckThemeId(id) : '';
}

/** The template a sheet of this kind is rendered under, given its theme. */
export function templateFor(sheet: SheetKind, theme: string | undefined): string {
  return sheet === 'context' ? resolveTemplateId(theme) : sheet === 'site' ? siteTheme(theme).base : sheet === 'yield' || sheet === 'slides' ? deckThemeId(theme) : DEFAULT_TEMPLATE;
}

export function isTemplateId(id: string): boolean {
  return Object.hasOwn(byId, id);
}

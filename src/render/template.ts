// Graphic templates.
//
// Everything about how a sheet LOOKS — typeface, text sizes, line and fill
// colours, the land-use palette, which symbol family is drawn — lives here,
// so a new house style is a data change rather than a hunt through the
// renderers. What a sheet SAYS (which data, which labels, the A1 geometry)
// is deliberately not part of a template.
//
// There are three, and they differ only in the context sheet's colours:
// `classic` (the default) softens the NSW planning colours into one palette,
// `nsw` is those colours exactly as the Planning Portal draws them — a base to
// restyle from — and `neutral` is the restrained palette they replaced, kept
// for a sheet that has to survive a mono print.
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
  station: string;    // train station roundels
  walk5: string;      // 5-minute walking catchment
  walk10: string;     // 10-minute walking catchment
  busRoute: string;   // bus route dashes
  heritage: string;   // heritage hatch

  /** How the aerial is drawn under the fills. In colour, terracotta roofs tint
   *  every fill laid over them and a pale pink becomes a muddy salmon; grey
   *  lets the fills read true; none leaves flat colour on white, like the LEP
   *  map itself. */
  aerial: 'colour' | 'grey' | 'none';
  /** White veil over the aerial, 0–1: how far the photo steps back behind
   *  the land-use fills. A palette is only as legible as the ground under it. */
  aerialVeil: number;
  /** Land-use fills for the context sheet legend. */
  categories: Category[];
}

/** How one land use is coloured. */
export type Swatch = Omit<Category, 'id' | 'label'>;

// The land uses a context sheet can show, in legend order, and what the legend
// calls them. That is content rather than look, so it is written once and every
// template colours the same list — a palette that forgets one fails the
// typecheck instead of the first render that meets that land use.
const LAND_USES = {
  site:           'SITE',
  medical:        'MEDICAL',
  education:      'EDUCATION',
  childCare:      'CHILD CARE / AGED CARE',
  mixedUse:       'MIXED USE CLUSTER RESIDENTIAL/COMMERCIAL',
  retail:         'ACTIVE RETAIL',
  openSpace:      'OPEN SPACE',
  community:      'COMMUNITY HUB',
  r2:             'R2 LOW DENSITY RESIDENTIAL',
  r3:             'R3 MEDIUM DENSITY RESIDENTIAL',
  r4:             'R4 HIGH DENSITY RESIDENTIAL',
  localCentre:    'LOCAL CENTRE',
  commercial:     'COMMERCIAL CENTRE',
  industrial:     'GENERAL INDUSTRIAL',
  infrastructure: 'INFRASTRUCTURE FACILITY',
  water:          'WATERWAY',
  railway:        'RAILWAY TRACKS',
  heritage:       'GENERAL HERITAGE SITE',
} as const;

function palette(swatches: Record<keyof typeof LAND_USES, Swatch>): Category[] {
  return (Object.keys(LAND_USES) as (keyof typeof LAND_USES)[])
    .map((id) => ({ id, label: LAND_USES[id], ...swatches[id] }));
}

// One accent against neutral ground, so the aerial reads through and the
// sheet survives a mono print.
const NEUTRAL_CATEGORIES = palette({
  site:           { fill: '#d1362a', opacity: 0.55 },
  medical:        { fill: '#cfd8dc', opacity: 0.55, stroke: '#5b6b73' },
  education:      { fill: '#c3ced4', opacity: 0.55, stroke: '#4a5a63' },
  childCare:      { fill: '#e8edef', opacity: 0.6, stroke: '#7d8a91' },
  mixedUse:       { fill: '#b9a89c', opacity: 0.5 },
  retail:         { fill: '#d8cec6', opacity: 0.5 },
  openSpace:      { fill: '#dfe6d6', opacity: 0.55 },
  community:      { fill: '#dce5e4', opacity: 0.55, stroke: '#8fa3a1' },
  r2:             { fill: '#f2efeb', opacity: 0.45 },
  r3:             { fill: '#e4ded6', opacity: 0.5 },
  r4:             { fill: '#d3cabf', opacity: 0.5 },
  localCentre:    { fill: '#e0d3c8', opacity: 0.5 },
  commercial:     { fill: '#d2cdd8', opacity: 0.5 },
  industrial:     { fill: '#c4c0cb', opacity: 0.5 },
  infrastructure: { fill: '#eae4e0', opacity: 0.55, stroke: '#8a8078' },
  water:          { fill: '#cbdae2', opacity: 0.6 },
  railway:        { fill: '#ddd6cc', opacity: 0.7, stroke: '#8a8078' },
  heritage:       { fill: '#c2b39a', opacity: 0.5 },
});

// Both colour palettes read the way NSW zoning is already read. Their hues are
// the Standard Instrument LEP zoning map's, as the ePlanning zoning layer
// itself draws them: pink deepening to red with residential density (R2
// #ffa6a3, R3 #ff776e, R4 #ff483b), blues for centres (E1 #99ccff, E2
// #b4c6e7), violets for mixed use and industry (MU1 #959dc2, E4 #9999ff),
// yellow for special purposes (SP2 #ffff70), green for recreation (RE1
// #55ff00) and aqua for waterways (W2 #99ffdd) — so a planner sees R3 or E1
// before reaching the legend. What the LEP map does not colour follows the
// office sheets: education blue, medical magenta, child care outlined, active
// retail orange. Transport takes TfNSW's mode colours: orange trains, blue
// buses, red light rail.
//
// The LEP map prints those flat and at full strength on white. Laid over a
// photograph at part opacity they turn to mud, so `classic` keeps the hues and
// sets lightness and chroma evenly across them (in OKLCH, where equal numbers
// look equal), into the pastel sheet an office would draw. Its yellow sits
// paler and more opaque than the rest, because at part opacity over a grey
// photo yellow goes olive — and an airport is one very large SP2 zone.
const CLASSIC_CATEGORIES = palette({
  site:           { fill: '#d1362a', opacity: 0.7 },
  medical:        { fill: '#f6a0c1', opacity: 0.74, stroke: '#b5236e' },
  education:      { fill: '#82b5ef', opacity: 0.74, stroke: '#2460b7' },
  childCare:      { fill: '#eef6ff', opacity: 0.8, stroke: '#558ac0' },
  mixedUse:       { fill: '#dfb3e1', opacity: 0.65 },
  retail:         { fill: '#f9c191', opacity: 0.7 },
  openSpace:      { fill: '#b4e0a6', opacity: 0.65 },
  community:      { fill: '#b9e9e5', opacity: 0.68, stroke: '#559a99' },
  r2:             { fill: '#ffe4e4', opacity: 0.65 },
  r3:             { fill: '#ffcccc', opacity: 0.65 },
  r4:             { fill: '#fdb0af', opacity: 0.65 },
  localCentre:    { fill: '#91d5f9', opacity: 0.65 },
  commercial:     { fill: '#aabdec', opacity: 0.65 },
  industrial:     { fill: '#b5a7e2', opacity: 0.65 },
  infrastructure: { fill: '#fdf4ba', opacity: 0.78 },
  water:          { fill: '#9de2ec', opacity: 0.72 },
  railway:        { fill: '#f3d392', opacity: 0.82, stroke: '#ba904c' },
  heritage:       { fill: '#dcb87a', opacity: 0.55 },
});

// `nsw` is the Planning Portal's zoning map unaltered: the exact colours its
// Land Zoning layer is drawn in, and opaque as it draws them (the layer's
// transparency is 0). Part opacity would blend every zone with the photo, and
// then no pixel on the sheet would be the NSW value; drawn solid, each zone is
// exactly its colour, so it can be picked or selected straight off the sheet
// and restyled from there. Where one category stands for several zones it
// takes the colour of the zone its legend names — E2 for COMMERCIAL CENTRE,
// E4 for GENERAL INDUSTRIAL, W2 for WATERWAY — and a rail corridor is SP2,
// which is how the LEP zones one. Heritage items take the Heritage map's
// colour. The LEP map has none for the institutions, so those keep classic's.
// Nor for the site, and there the house red will not do: it is R4's red, and a
// site on R4 land vanished into it. So the site is a black outline with no
// fill, which reads on every zone colour and leaves the site's own zone
// showing through.
const NSW_CATEGORIES = palette({
  site:           { fill: '#000000', opacity: 0 },
  medical:        { fill: '#f6a0c1', opacity: 1, stroke: '#b5236e' },
  education:      { fill: '#82b5ef', opacity: 1, stroke: '#2460b7' },
  childCare:      { fill: '#eef6ff', opacity: 1, stroke: '#558ac0' },
  mixedUse:       { fill: '#959dc2', opacity: 1 },   // MU1
  retail:         { fill: '#f9c191', opacity: 1 },
  openSpace:      { fill: '#55ff00', opacity: 1 },   // RE1
  community:      { fill: '#b9e9e5', opacity: 1, stroke: '#559a99' },
  r2:             { fill: '#ffa6a3', opacity: 1 },   // R2
  r3:             { fill: '#ff776e', opacity: 1 },   // R3
  r4:             { fill: '#ff483b', opacity: 1 },   // R4
  localCentre:    { fill: '#99ccff', opacity: 1 },   // E1
  commercial:     { fill: '#b4c6e7', opacity: 1 },   // E2
  industrial:     { fill: '#9999ff', opacity: 1 },   // E4
  infrastructure: { fill: '#ffff70', opacity: 1 },   // SP2
  water:          { fill: '#99ffdd', opacity: 1 },   // W2
  railway:        { fill: '#ffff70', opacity: 1 },   // SP2
  heritage:       { fill: '#dbbb7b', opacity: 1 },   // Heritage map, Item - General
});

const SANS = "Arial, 'Liberation Sans', Helvetica, sans-serif";
const GROTESK = "'DejaVu Sans', Verdana, 'Liberation Sans', sans-serif";

// What every palette shares: the type, the rules and the colours the site and
// summary sheets draw with. A palette recolours the context sheet and nothing
// else, so those two drawings come out the same whichever one is chosen.
const HOUSE = {
  font: GROTESK,
  textScale: 0.96,
  ink: '#1c1c1c',
  rule: '#8a8a8a',
  site: '#d1362a',
  dimension: '#3c4c5a',
  wind: '#6d8a99',
  sun: '#f0e4c0',
  road: '#7d7d7d',
  rail: '#2f2f2f',
};

export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    label: 'classic',
    note: 'NSW planning colours, softened into one family',
    ...HOUSE,
    water: '#9de2ec',
    transit: '#0084ba',
    station: '#e47600',
    walk5: '#413c9b',
    walk10: '#7466b5',
    busRoute: '#de3b40',
    heritage: '#9f6f3d',
    aerial: 'grey',
    aerialVeil: 0.55,
    categories: CLASSIC_CATEGORIES,
  },
  {
    id: 'nsw',
    label: 'nsw',
    note: "the Planning Portal's zoning colours, exactly",
    ...HOUSE,
    site: '#000000',   // see NSW_CATEGORIES; the site and summary sheets never use this palette
    water: '#99ffdd',
    transit: '#00b5ef',
    station: '#f6891f',
    walk5: '#413c9b',
    walk10: '#7466b5',
    busRoute: '#ee343f',
    heritage: '#dbbb7b',
    aerial: 'none',
    aerialVeil: 0,
    categories: NSW_CATEGORIES,
  },
  {
    id: 'neutral',
    label: 'neutral',
    note: 'restrained palette, one accent — survives a mono print',
    ...HOUSE,
    water: '#cbdae2',
    transit: '#41627a',
    station: '#d1362a',
    walk5: '#7a5c86',
    walk10: '#9c8aa6',
    busRoute: '#6b7f93',
    heritage: '#94836a',
    aerial: 'colour',
    aerialVeil: 0.36,
    categories: NEUTRAL_CATEGORIES,
  },
];

const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
export const DEFAULT_TEMPLATE = 'classic';

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

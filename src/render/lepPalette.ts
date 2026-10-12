// The statutory map colours, so the planning slides read like the LEP maps a
// planner already knows. Taken from the renderers the NSW ePlanning services
// publish for their own layers (EPI_Primary_Planning_Layers: Land Zoning by
// SYM_CODE, Heritage by LAY_CLASS), reduced to one colour per zone code.
// Height of building is drawn with a sequential ramp instead: the ePlanning
// height map keys its colours to 129 letter classes that mean nothing off the
// legend, whereas a ramp ordered by metres reads at a glance.

const ZONE_FILL: Record<string, string> = {
  R1: '#ffcfff', R2: '#ffa6a3', R3: '#ff776e', R4: '#ff483b', R5: '#ffd9d9',
  B1: '#c9fff9', B2: '#62f0f5', B3: '#00c2ed', B4: '#959dc2', B5: '#7da0ab', B6: '#95bfcc', B7: '#bad6de', B8: '#c8e6e0',
  E1: '#99ccff', E2: '#b4c6e7', E3: '#8ea9db', E4: '#9999ff', E5: '#9966ff',
  MU1: '#959dc2', MU: '#959dc2',
  IN1: '#deb8f5', IN2: '#f3dbff', IN3: '#c595e8', IN4: '#ae73de',
  SP1: '#ffffa0', SP2: '#ffff70', SP3: '#ffff00', SP4: '#ffff09', SP5: '#e6e600',
  RE1: '#55ff00', RE2: '#d3ffbe',
  C1: '#e69900', C2: '#f0ae3c', C3: '#f7c568', C4: '#ffda96',
  W1: '#d9fff2', W2: '#99ffdd', W3: '#33ffbb', W4: '#00e6a9',
  RU1: '#edd8ad', RU2: '#e6cb97', RU3: '#dec083', RU4: '#d6b46f', RU5: '#d7a39e', RU6: '#c79e4c',
  DM: '#ffffff', UL: '#ffffff', U: '#cafced', RW: '#d3b8f5', DR: '#ffff70',
};

/** Fill for a zone code; unknown codes get a neutral grey so they still show. */
export function zoneFill(code: string | undefined): string {
  const c = String(code ?? '').trim().toUpperCase();
  return ZONE_FILL[c] ?? ZONE_FILL[c.replace(/\s.*$/, '')] ?? '#d9d9d9';
}

/** A zone code's place in the LEP legend order (residential, centres, employment, … roads). */
export function zoneOrder(code: string | undefined): number {
  const c = String(code ?? '').trim().toUpperCase();
  const i = Object.keys(ZONE_FILL).indexOf(ZONE_FILL[c] ? c : c.replace(/\s.*$/, ''));
  return i < 0 ? Infinity : i;
}

/** Statutory heritage styles by LAY_CLASS: items solid, conservation areas hatched. */
export type HeritageStyle = { fill: string; hatch: boolean; label: string };
export function heritageStyle(layClass: string | undefined): HeritageStyle {
  const c = String(layClass ?? '');
  if (/Conservation Area - Landscape/i.test(c)) return { fill: '#38a800', hatch: true, label: 'Conservation area (landscape)' };
  if (/Conservation Area - Archaeological/i.test(c)) return { fill: '#e4df17', hatch: true, label: 'Conservation area (archaeological)' };
  if (/Conservation Area/i.test(c)) return { fill: '#ff0000', hatch: true, label: 'Heritage conservation area' };
  if (/Archaeological/i.test(c)) return { fill: '#ffffbf', hatch: false, label: 'Heritage item (archaeological)' };
  if (/Landscape/i.test(c)) return { fill: '#b3e096', hatch: false, label: 'Heritage item (landscape)' };
  if (/Aboriginal/i.test(c)) return { fill: '#ffc700', hatch: false, label: 'Aboriginal heritage' };
  return { fill: '#dbbb7b', hatch: false, label: 'Heritage item' };
}

/**
 * A sequential ramp for height of building, light to dark. Values are ranked,
 * not binned, so a window with three heights uses three well-separated steps
 * and a CBD with twelve still reads in order.
 */
const HOB_RAMP = ['#fff7dc', '#fde9b4', '#fbd68a', '#f5bd63', '#ec9f45', '#dd7f31', '#c96126', '#a9491e', '#83361a', '#5c2615'];
export function hobRamp(rank: number, count: number): string {
  if (count <= 1) return HOB_RAMP[3];
  const i = Math.round((rank / (count - 1)) * (HOB_RAMP.length - 1));
  return HOB_RAMP[Math.max(0, Math.min(HOB_RAMP.length - 1, i))];
}

/** Policy-map styles for the housing-policy panel. */
export const POLICY_STYLE: Record<string, { fill: string; stroke: string; dash?: string; label: string }> = {
  tod:            { fill: '#df73ff', stroke: '#a326c9', label: 'Transport Oriented Development area' },
  todAccelerated: { fill: 'none',    stroke: '#a326c9', dash: '2.2,1.2', label: 'Accelerated TOD precinct' },
  todDeferred:    { fill: 'none',    stroke: '#a326c9', dash: '0.8,1.2', label: 'Deferred TOD area' },
  townCentre:     { fill: '#ffb366', stroke: '#c46a12', label: 'Town centre (low and mid-rise housing policy)' },
  ssdSite:        { fill: 'none',    stroke: '#1f4e79', dash: '3,1.5', label: 'State significant development site' },
  precinct:       { fill: 'none',    stroke: '#0f8f8f', dash: '1.6,1.6', label: 'Planning precinct' },
};

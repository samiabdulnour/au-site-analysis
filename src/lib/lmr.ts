// The low and mid-rise housing controls at a site, and the scheme they allow.
//
// Chapter 6 of the Housing SEPP (the Low and Mid-Rise Housing Policy, in
// force from 28 February 2025) applies in the low and mid-rise housing areas:
// land within 800 m walking distance of a nominated town centre or station.
// There it permits, with consent, building types the zone's own land use
// table does not: in the low density zones (R1 and R2) dual occupancies,
// terraces, townhouses and residential flat buildings, each under standards
// a consent authority cannot refuse on where they are met. For a residential
// flat building in R1 or R2: a lot of at least 500 m² and 12 m wide, a floor
// space ratio of 0.8:1 and a height of 9.5 m, with half a parking space a
// dwelling (DPHI, "Low and Mid-Rise Housing Policy: summary of key
// provisions"). An LEP standard more generous than the SEPP's stands.
//
// This is what lets the study design one scheme across an amalgamated site
// in a low density zone, where the LEP's land use table takes no apartment
// building and the study drew none: three lots of 86, 88-90 and 94 Maroubra
// Road, R2 and 20 m from the Maroubra Junction town centre, were "rebuilt"
// lot by lot as the houses that stand on them.
//
// What is not read here, and the sheets say so: the 800 m is a walking
// distance, and the study has the straight line from the site to the town
// centre's mapped edge; land the policy leaves out (bushfire and flood
// constraints, heritage items, some council areas' deferred or excluded
// land); and the mid-rise standards of R3 and R4 (their heights and ratios
// by distance band), which the LEP's own controls are studied for as before.

/** The policy's reach from a town centre or station, and where its inner area ends, metres (walking distance in the SEPP). */
export const LMR_REACH_M = 800, LMR_INNER_M = 400;
/** The SEPP's standards for a residential flat building in R1 or R2 in a low and mid-rise housing area. */
export const LMR_LOW_RISE = { heightM: 9.5, fsr: 0.8, minLotSqm: 500, minLotWidthM: 12, parkingPerDwelling: 0.5 };
/**
 * What a low-rise building's roof takes of its height, metres: a flat roof's build-up, with no plant or lift overrun
 * over it. Three floors of 3.1 m then stand 9.5 m, the whole of the 9.5 m the policy gives, where the study's usual
 * 1.5 m for roof and plant (a taller building's) left room for two and spread the floor area across the site as a
 * two-storey ring round a slot of a courtyard (Z. 2026-11: "the volume is obviously filled and should be higher").
 * The SEPP sets a height, not a storey count; councils read the 9.5 m as two to three storeys, and a DCP's wall
 * height may hold a design to two: the page says it is the study's assumption.
 */
export const LMR_ROOF_M = 0.2;

export interface LmrReading {
  /** The town centre the site is near, as the sheets write it, and how far its mapped edge is in a straight line (0 inside it). */
  name: string;
  distanceM: number;
  /** Within 400 m, or 400 to 800 m. */
  band: 'inner' | 'outer';
  /** What the SEPP permits in the zone that the study draws: a low-rise residential flat building in R1 and R2; nothing drawn for the others. */
  permits?: 'residentialFlatBuilding';
  /** The height and ratio it allows (the LEP's where more generous). */
  hobM?: number;
  fsr?: number;
  /** Whether it gives the site a scheme the LEP does not: a building type the zone lacks, or more height or ratio. */
  lifts?: boolean;
  lotSqm?: number;
  lotWidthM?: number;
  bigEnough?: boolean;
  wideEnough?: boolean;
}

/**
 * The low and mid-rise housing controls at the site, read off the nearest town centre of the Housing SEPP's map
 * within the policy's reach; undefined beyond it, or in a zone the study draws no low-rise scheme for.
 */
export function readLmr(o: {
  /** The nearest town centre of the Housing SEPP's map and the straight-line distance to its edge, metres. */
  centre?: { name: string; distanceM: number };
  zone?: string;
  lepHobM?: number;
  lepFsr?: number;
  /** The site's area (every lot of an amalgamation) and its width at the street (its longest frontage). */
  lotSqm?: number;
  lotWidthM?: number;
}): LmrReading | undefined {
  const c = o.centre;
  if (!c || !(c.distanceM <= LMR_REACH_M)) return undefined;
  const z = (o.zone ?? '').toUpperCase().trim();
  if (!/^R[12]$/.test(z)) return undefined;
  const S = LMR_LOW_RISE;
  const hobM = Math.max(o.lepHobM ?? 0, S.heightM), fsr = Math.max(o.lepFsr ?? 0, S.fsr);
  return {
    name: c.name, distanceM: Math.round(c.distanceM), band: c.distanceM <= LMR_INNER_M ? 'inner' : 'outer',
    permits: 'residentialFlatBuilding', hobM, fsr,
    // a flat building the zone's own table does not take is a lift whatever the numbers; R1's does, so there it must add height or ratio
    lifts: z === 'R2' || hobM > (o.lepHobM ?? 0) + 1e-6 || fsr > (o.lepFsr ?? 0) + 1e-6,
    lotSqm: o.lotSqm, lotWidthM: o.lotWidthM,
    bigEnough: o.lotSqm === undefined ? undefined : o.lotSqm >= S.minLotSqm - 1e-6,
    wideEnough: o.lotWidthM === undefined ? undefined : o.lotWidthM >= S.minLotWidthM - 1e-6,
  };
}

/** Whether the reading gives a scheme to draw: permitted, a lift on the LEP, on a lot big and wide enough. */
export const lmrApplies = (l: LmrReading | undefined): l is LmrReading => !!l?.permits && !!l.lifts && l.bigEnough !== false && l.wideEnough !== false;

/** What a reading says, a sentence for the sheets. */
export function lmrSentence(l: LmrReading): string {
  const where = l.distanceM <= 0 ? `in the ${l.name}` : `${l.distanceM} m from the ${l.name}`;
  const S = LMR_LOW_RISE;
  if (l.bigEnough === false) return `The site is ${where}, inside the reach of the Housing SEPP's low and mid-rise housing controls, but at ${Math.round(l.lotSqm ?? 0)} m² it is under the ${S.minLotSqm} m² they ask for a residential flat building.`;
  if (l.wideEnough === false) return `The site is ${where}, inside the reach of the Housing SEPP's low and mid-rise housing controls, but at ${Math.round((l.lotWidthM ?? 0) * 10) / 10} m wide at the street it is short of the ${S.minLotWidthM} m they ask for a residential flat building.`;
  return `The site is ${where}, inside the ${LMR_REACH_M} m reach of the Housing SEPP's low and mid-rise housing controls (chapter 6): they permit a residential flat building here to ${l.hobM} m and ${l.fsr?.toFixed(2)}:1 on a lot of at least ${S.minLotSqm} m² and ${S.minLotWidthM} m wide, which the zone's own table does not take. The 800 m is a walking distance, read here as a straight line, and the land the policy excludes is not checked: to confirm.`;
}

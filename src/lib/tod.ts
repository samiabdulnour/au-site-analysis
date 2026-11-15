// Transport oriented development: which station-precinct controls apply at a
// site, and what they allow.
//
// The Housing SEPP's TOD controls (chapter 5, part 2) apply in the TOD areas
// its Transport Oriented Development Sites Map draws, about 400 m round 37
// stations: residential flat buildings permitted in the residential zones and
// the local centre zone, to 22 m and 2.5:1; shop-top housing in the local
// centre and commercial zones, to 24 m (for a taller ground floor) and 2.5:1;
// on a lot at least 21 m wide, with no minimum lot size; and 2% of the floor
// area held as affordable housing in perpetuity, managed by a community
// housing provider, where a scheme's floor area is 2,000 m² or more. An LEP
// standard more generous than the SEPP's stands. The in-fill affordable
// housing bonus applies on top.
//
// Some councils replaced the TOD controls round their stations with schemes
// of their own, written into their LEPs: Ku-ring-gai's for Gordon, Killara,
// Lindfield and Roseville, in force from 14 November 2025 (State
// Environmental Planning Policy Amendment (Ku-ring-gai Station Precincts)
// 2025), rezoning land within about 800 m of the stations, Killara and
// Roseville to eight storeys, Gordon and Lindfield to 24 (28 on a key site at
// Gordon); and others round Belmore, Canterbury, Croydon (in part), Lakemba,
// North Wollongong, Punchbowl, St Marys Metro, Wiley Park and Cockle Creek.
// There the LEP's maps carry the alternative's heights and ratios, which the
// study reads as it reads any LEP's: what the study adds is the name of what
// it is reading, and what the maps do not say.

export type TodRegime = 'sepp' | 'alternative' | 'deferred' | 'accelerated';

/** The SEPP's TOD standards (Housing SEPP chapter 5, part 2). */
export const TOD_SEPP = {
  rfbHeightM: 22, shopTopHeightM: 24, fsr: 2.5, minLotWidthM: 21,
  affordableShare: 0.02, affordableFromSqm: 2000,
} as const;

/** A council's scheme that replaced the TOD controls round its stations. */
export interface TodAlternative {
  council: string;
  lga: RegExp;
  stations: string[];
  /** How far from a station its maps reach, about: the precinct's own maps decide. */
  reachM: number;
  from?: string;
  instrument?: string;
  /** What its maps carry that a height and ratio do not say, and its savings provision. */
  also?: string;
  savings?: string;
}

export const TOD_ALTERNATIVES: TodAlternative[] = [
  {
    council: 'Ku-ring-gai', lga: /KU-?RING-?GAI/i, stations: ['GORDON', 'KILLARA', 'LINDFIELD', 'ROSEVILLE'], reachM: 800,
    from: '14 November 2025', instrument: 'State Environmental Planning Policy Amendment (Ku-ring-gai Station Precincts) 2025',
    also: 'its precinct maps also set affordable housing (up to 10% of the dwellings on key sites, 2% across parts of the precincts), key sites with their own clauses, active street frontages and a low- and mid-rise housing exclusion, none of which this study reads',
    savings: 'a development application lodged by 13 June 2025 is assessed under the TOD provisions',
  },
  { council: 'Canterbury-Bankstown', lga: /CANTERBURY/i, stations: ['BELMORE', 'CANTERBURY', 'LAKEMBA', 'PUNCHBOWL', 'WILEY PARK'], reachM: 400 },
  { council: 'Burwood and Inner West', lga: /BURWOOD|INNER WEST/i, stations: ['CROYDON'], reachM: 400, from: 'February 2026, in part' },
  { council: 'Wollongong', lga: /WOLLONGONG/i, stations: ['NORTH WOLLONGONG'], reachM: 400 },
  { council: 'Penrith', lga: /PENRITH/i, stations: ['ST MARYS'], reachM: 400 },
  { council: 'Lake Macquarie', lga: /LAKE MACQUARIE/i, stations: ['COCKLE CREEK'], reachM: 400, from: 'June 2026' },
];

export interface TodReading {
  regime: TodRegime;
  /** The TOD area's or the station's name, as the sheets write it: "Killara", "Homebush". */
  name: string;
  /** The SEPP's: what it permits in the zone, the height and ratio it allows (the LEP's where more generous), and whether the lot is wide enough. */
  permits?: 'residentialFlatBuilding' | 'shopTopHousing';
  hobM?: number;
  fsr?: number;
  /** Whether the SEPP lifts the LEP's height or ratio: where it does not, the LEP's controls are the study's already. */
  lifts?: boolean;
  lotWidthM?: number;
  wideEnough?: boolean;
  /** The alternative's council, from when, under what, and what its maps carry besides. */
  alternative?: TodAlternative;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** A station's name without its kind: "KILLARA RAILWAY STATION" → "KILLARA". */
const stationWord = (name: string) => name.toUpperCase().replace(/\s+(RAILWAY|METRO|TRAIN|LIGHT RAIL)?\s*STATION$/, '').replace(/\s+METRO$/, '').trim();

/**
 * Which station-precinct controls apply at the site, read off the bundle's policy areas (the Housing SEPP's maps),
 * its nearest station and its council; undefined where none does.
 */
export function readTod(o: {
  policyAtSite: { kind: string; name: string }[];
  station?: { name: string; distanceM: number };
  lgaName?: string;
  zone?: string;
  lepHobM?: number;
  lepFsr?: number;
  /** The lot's width at the street: its longest frontage, metres. */
  lotWidthM?: number;
}): TodReading | undefined {
  const at = (k: string) => o.policyAtSite.find((p) => p.kind === k);
  const sepp = at('tod');
  if (sepp) {
    const z = (o.zone ?? '').toUpperCase().trim();
    const permits = /^R[1-4]$/.test(z) ? 'residentialFlatBuilding' : /^(E1|E2|MU1|B1|B2|B3|B4)$/.test(z) ? 'shopTopHousing' : undefined;
    const todHob = permits === 'shopTopHousing' ? TOD_SEPP.shopTopHeightM : TOD_SEPP.rfbHeightM;
    const hobM = permits ? Math.max(o.lepHobM ?? 0, todHob) : o.lepHobM;
    const fsr = permits ? Math.max(o.lepFsr ?? 0, TOD_SEPP.fsr) : o.lepFsr;
    const lifts = !!permits && ((hobM ?? 0) > (o.lepHobM ?? 0) + 1e-6 || (fsr ?? 0) > (o.lepFsr ?? 0) + 1e-6);
    return {
      regime: 'sepp', name: sepp.name, permits, hobM, fsr, lifts,
      lotWidthM: o.lotWidthM, wideEnough: o.lotWidthM === undefined ? undefined : o.lotWidthM >= TOD_SEPP.minLotWidthM - 1e-6,
    };
  }
  if (o.station && o.lgaName) {
    const word = stationWord(o.station.name);
    const alt = TOD_ALTERNATIVES.find((a) => a.lga.test(o.lgaName!) && a.stations.includes(word) && o.station!.distanceM <= a.reachM);
    if (alt) return { regime: 'alternative', name: titleCase(word), alternative: alt };
  }
  const deferred = at('todDeferred');
  if (deferred) return { regime: 'deferred', name: deferred.name };
  const accelerated = at('todAccelerated');
  if (accelerated) return { regime: 'accelerated', name: accelerated.name };
  return undefined;
}

/** What a reading says, a sentence for the sheets: where the study's controls come from, and what it leaves to the planner. */
export function todSentence(t: TodReading): string {
  switch (t.regime) {
    case 'sepp': {
      if (!t.permits) return `The site is in the ${t.name} TOD area, but its zone takes neither residential flat buildings nor shop-top housing under the Housing SEPP's TOD controls.`;
      const what = t.permits === 'shopTopHousing' ? 'shop-top housing to 24 m' : 'residential flat buildings to 22 m';
      const width = t.wideEnough === false ? ` The lot is ${Math.round((t.lotWidthM ?? 0) * 10) / 10} m wide at the street, short of the 21 m the TOD controls ask, so they do not apply until it is amalgamated.` : '';
      return `The site is in the ${t.name} TOD area: the Housing SEPP permits ${what} and 2.5:1 here${t.lifts ? '' : ', which the LEP\'s own controls already match or better'}, on a lot at least 21 m wide, with 2% of the floor area affordable housing in perpetuity where it is 2,000 m² or more.${width}`;
    }
    case 'alternative': {
      const a = t.alternative!;
      return `The site is in ${a.council}'s ${t.name} station precinct: ${a.council}'s own controls replaced the Housing SEPP's TOD controls here${a.from ? ` from ${a.from}` : ''}${a.instrument ? ` (${a.instrument})` : ''}, and the LEP's height and floor space ratio studied are theirs.${a.also ? ` ${a.also[0].toUpperCase()}${a.also.slice(1)}.` : ''}${a.savings ? ` Under the savings provision, ${a.savings}.` : ''}`;
    }
    case 'deferred': return `The site is in the ${t.name} TOD area, whose TOD controls are deferred: the LEP's controls stand until they commence.`;
    case 'accelerated': return `The site is in the ${t.name} accelerated TOD precinct, rezoned by its own maps: the controls studied are those maps'.`;
  }
}

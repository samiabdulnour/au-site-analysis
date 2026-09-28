// The centres of The Sydney Plan (Department of Planning, Housing and
// Infrastructure, version 1.0, commenced 13 August 2026), which applies the
// NSW Centres Framework's four types: CBD, major centre, activity centre and
// local centre. The plan's network of thirty centres is the set its Appendix
// D (Housing and Employment Guidance) gives a jobs target and a type, read
// LGA by LGA; four more activity centres the plan's corridor descriptions
// name as emerging are added and marked. Each carries a representative point
// (the station or the centre's core) for a location map at 1:75,000; the
// local centres are too many and too local for that map. This is the deck's
// transcription of a published document, not a data service; the plan's own
// map governs.

export type CentreKind = 'cbd' | 'major' | 'activity';

export interface Centre {
  name: string;
  kind: CentreKind;
  lat: number;
  lon: number;
  /** "emerging" where the plan says so. */
  note?: string;
}

export const CENTRE_KIND_WORD: Record<CentreKind, string> = { cbd: 'CBD', major: 'major centre', activity: 'activity centre' };

/** The Sydney CBD at Town Hall: the point distances "to the CBD" are measured to. The plan's centre spans North Sydney to Green Square and Camperdown. */
export const SYDNEY_CBD: Centre = { name: 'Sydney CBD', kind: 'cbd', lat: -33.8732, lon: 151.2068 };

export const CENTRES: Centre[] = [
  // CBDs
  SYDNEY_CBD,
  { name: 'Parramatta CBD', kind: 'cbd', lat: -33.8151, lon: 151.0011 },
  { name: 'Bradfield', kind: 'cbd', lat: -33.9114, lon: 150.7320, note: 'emerging' },
  // major centres
  { name: 'Liverpool', kind: 'major', lat: -33.9200, lon: 150.9240 },
  { name: 'Penrith', kind: 'major', lat: -33.7510, lon: 150.6940 },
  { name: 'Campbelltown', kind: 'major', lat: -34.0650, lon: 150.8140 },
  { name: 'Blacktown', kind: 'major', lat: -33.7710, lon: 150.9060 },
  { name: 'Bankstown', kind: 'major', lat: -33.9180, lon: 151.0350 },
  { name: 'Macquarie Park', kind: 'major', lat: -33.7770, lon: 151.1230 },
  { name: 'St Leonards', kind: 'major', lat: -33.8230, lon: 151.1940 },
  { name: 'Norwest', kind: 'major', lat: -33.7330, lon: 150.9670 },
  { name: 'Sydney Olympic Park', kind: 'major', lat: -33.8470, lon: 151.0680 },
  { name: 'Randwick', kind: 'major', lat: -33.9140, lon: 151.2410 },
  { name: 'Mascot', kind: 'major', lat: -33.9230, lon: 151.1870 },
  { name: 'Kogarah', kind: 'major', lat: -33.9640, lon: 151.1330, note: 'emerging' },
  { name: 'Rouse Hill', kind: 'major', lat: -33.6900, lon: 150.9240, note: 'emerging' },
  // activity centres
  { name: 'Chatswood', kind: 'activity', lat: -33.7970, lon: 151.1830 },
  { name: 'Castle Hill', kind: 'activity', lat: -33.7310, lon: 151.0050 },
  { name: 'Hornsby', kind: 'activity', lat: -33.7030, lon: 151.0990 },
  { name: 'Brookvale', kind: 'activity', lat: -33.7620, lon: 151.2740 },
  { name: 'Frenchs Forest', kind: 'activity', lat: -33.7520, lon: 151.2350 },
  { name: 'Bondi Junction', kind: 'activity', lat: -33.8915, lon: 151.2478 },
  { name: 'Burwood', kind: 'activity', lat: -33.8770, lon: 151.1040 },
  { name: 'Rhodes', kind: 'activity', lat: -33.8300, lon: 151.0870 },
  { name: 'Hurstville', kind: 'activity', lat: -33.9670, lon: 151.1020 },
  { name: 'Miranda', kind: 'activity', lat: -34.0350, lon: 151.1010 },
  { name: 'Narellan', kind: 'activity', lat: -34.0430, lon: 150.7370 },
  { name: 'St Marys', kind: 'activity', lat: -33.7660, lon: 150.7750 },
  { name: 'Marsden Park', kind: 'activity', lat: -33.7000, lon: 150.8380 },
  { name: 'Richmond–Windsor', kind: 'activity', lat: -33.6060, lon: 150.7830 },
  { name: 'Epping', kind: 'activity', lat: -33.7720, lon: 151.0820, note: 'emerging' },
  { name: 'Five Dock', kind: 'activity', lat: -33.8660, lon: 151.1290, note: 'emerging' },
  { name: 'Oran Park', kind: 'activity', lat: -33.9990, lon: 150.7400, note: 'emerging' },
  { name: 'Leppington', kind: 'activity', lat: -33.9670, lon: 150.8060, note: 'emerging' },
];

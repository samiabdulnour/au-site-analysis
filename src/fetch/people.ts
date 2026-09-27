// Everything the people-and-market slide reads, gathered in one soft pass:
// the ABS regions at the site, their census profiles against the capital
// city, the population series and projections, SEIFA, the site's land
// values, the sales around it and the government schools nearby. Every
// part fails alone; the slide says what is missing.

import { lookupAsgs, fetchCensusProfile, fetchErpSeries, fetchErpSeriesLga, fetchSeifa, type AsgsRegions, type CensusProfile, type Seifa, type YearValue } from './abs.js';
import { fetchTzp24, type Tzp24 } from './tzp24.js';
import { fetchLandValues, fetchSales, type LandValues, type Sale } from './valuation.js';
import { fetchNearbySchools, type School } from './schools.js';
import type { LonLat } from '../lib/geo.js';

export interface PeopleData {
  regions: AsgsRegions;
  sa2: CensusProfile | null;
  lga: CensusProfile | null;
  /** The capital-city (or rest-of-state) profile the local figures are read against. */
  benchmark: CensusProfile | null;
  erpSa2: YearValue[];
  erpLga: YearValue[];
  erpBenchmark: YearValue[];
  seifaSa2: Seifa | null;
  seifaLga: Seifa | null;
  tzp24: Tzp24 | null;
  landValues: LandValues | null;
  sales: Sale[];
  salesRadiusM: number;
  schools: School[];
  schoolsRadiusM: number;
  fetchedAt: string;
}

export const SALES_RADIUS_M = 400;
export const SCHOOLS_RADIUS_M = 2000;

export async function fetchPeopleData(p: LonLat, siteAddress: string | undefined, log: (m: string) => void = () => {}): Promise<PeopleData | null> {
  const soft = <T,>(pr: Promise<T>, fallback: T, name: string): Promise<T> =>
    pr.catch((e) => { log(`  WARN ${name} failed: ${e?.message ?? e}`); return fallback; });
  const regions = await soft(lookupAsgs(p), null, 'ABS regions');
  if (!regions) return null;
  const [sa2, benchmark, lga, erpSa2, erpLga, erpBenchmark, seifaSa2, seifaLga, tzp24, landValues, sales, schools] = await Promise.all([
    soft(fetchCensusProfile(regions.sa2.code, 'SA2', regions.sa2.name), null, 'census SA2'),
    soft(fetchCensusProfile(regions.gccsa.code, 'GCCSA', regions.gccsa.name), null, 'census benchmark'),
    regions.lga ? soft(fetchCensusProfile(regions.lga.code, 'LGA', regions.lga.name), null, 'census LGA') : Promise.resolve(null),
    soft(fetchErpSeries(regions.sa2.code), [], 'population series SA2'),
    regions.lga ? soft(fetchErpSeriesLga(regions.lga.code), [], 'population series LGA') : Promise.resolve([]),
    soft(fetchErpSeries(regions.gccsa.code, 'GCCSA'), [], 'population series benchmark'),
    soft(fetchSeifa(regions.sa2.code, 'SA2'), null, 'SEIFA SA2'),
    regions.lga ? soft(fetchSeifa(regions.lga.code, 'LGA'), null, 'SEIFA LGA') : Promise.resolve(null),
    soft(fetchTzp24(regions.sa2.code, regions.lga?.name), null, 'TZP24'),
    soft(fetchLandValues(p, siteAddress), null, 'land values'),
    soft(fetchSales(p, SALES_RADIUS_M), [], 'sales'),
    soft(fetchNearbySchools(p, SCHOOLS_RADIUS_M), [], 'schools'),
  ]);
  log(`  people: ${regions.sa2.name} (SA2) · ${regions.lga?.name ?? '?'} (LGA) · census:${sa2 ? 'yes' : 'no'} erp:${erpSa2.length} tzp24:${tzp24?.sa2.length ?? 0}/${tzp24?.lga.length ?? 0} seifa:${seifaSa2 ? 'yes' : 'no'} land-values:${landValues?.values.length ?? 0} sales:${sales.length} schools:${schools.length}`);
  return { regions, sa2, lga, benchmark, erpSa2, erpLga, erpBenchmark, seifaSa2, seifaLga, tzp24, landValues, sales, salesRadiusM: SALES_RADIUS_M, schools, schoolsRadiusM: SCHOOLS_RADIUS_M, fetchedAt: new Date().toISOString() };
}

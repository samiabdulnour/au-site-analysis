// Australian Bureau of Statistics: the regions a point falls in (ASGS 2021),
// the 2021 Census tables for those regions, the annual population series
// and SEIFA 2021. Everything comes from two public services with no key:
// geo.abs.gov.au for boundaries and the SDMX API at data.api.abs.gov.au
// (the other hostname, api.data.abs.gov.au, is refused by the proxy used
// in development). Census tables never change, so they are cached on the
// volume for a month; the population series for a week.

import { retryFetch } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import type { LonLat } from '../lib/geo.js';

const GEO = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021';
const SDMX = 'https://data.api.abs.gov.au/rest/data';

export interface AsgsRegion { code: string; name: string; areaSqkm?: number }
export interface AsgsRegions {
  sa2: AsgsRegion;
  sa3?: AsgsRegion;
  sa4?: AsgsRegion;
  /** Greater Capital City Statistical Area — Greater Sydney, or Rest of NSW. */
  gccsa: AsgsRegion;
  lga?: AsgsRegion;
  /** Suburb (Suburbs and Localities). */
  sal?: AsgsRegion;
}

async function geoLookup(layer: string, p: LonLat, outFields: string): Promise<Record<string, any> | undefined> {
  const url = `${GEO}/${layer}/MapServer/0/query?` + new URLSearchParams({
    geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields, returnGeometry: 'false', f: 'json',
  });
  const res = await retryFetch(url, {}, { attempts: 3, timeoutMs: 30_000, label: `ABS ${layer}` });
  if (!res.ok) throw new Error(`ABS ${layer} HTTP ${res.status}`);
  const data = await res.json();
  return data.features?.[0]?.attributes;
}

/** The statistical regions at a point, or null when the point is outside the ASGS (offshore). */
export async function lookupAsgs(p: LonLat): Promise<AsgsRegions | null> {
  const [sa2, lga, sal] = await Promise.all([
    geoLookup('SA2', p, 'sa2_code_2021,sa2_name_2021,sa3_code_2021,sa3_name_2021,sa4_code_2021,sa4_name_2021,gccsa_code_2021,gccsa_name_2021,area_albers_sqkm'),
    geoLookup('LGA', p, 'lga_code_2021,lga_name_2021,area_albers_sqkm').catch(() => undefined),
    geoLookup('SAL', p, 'sal_code_2021,sal_name_2021,area_albers_sqkm').catch(() => undefined),
  ]);
  if (!sa2?.sa2_code_2021) return null;
  return {
    sa2: { code: String(sa2.sa2_code_2021), name: String(sa2.sa2_name_2021), areaSqkm: Number(sa2.area_albers_sqkm) || undefined },
    sa3: sa2.sa3_code_2021 ? { code: String(sa2.sa3_code_2021), name: String(sa2.sa3_name_2021) } : undefined,
    sa4: sa2.sa4_code_2021 ? { code: String(sa2.sa4_code_2021), name: String(sa2.sa4_name_2021) } : undefined,
    gccsa: { code: String(sa2.gccsa_code_2021), name: String(sa2.gccsa_name_2021) },
    lga: lga?.lga_code_2021 ? { code: String(lga.lga_code_2021), name: String(lga.lga_name_2021), areaSqkm: Number(lga.area_albers_sqkm) || undefined } : undefined,
    sal: sal?.sal_code_2021 ? { code: String(sal.sal_code_2021), name: String(sal.sal_name_2021), areaSqkm: Number(sal.area_albers_sqkm) || undefined } : undefined,
  };
}

// ---- SDMX ------------------------------------------------------------------

interface SdmxObs { codes: Record<string, string>; names: Record<string, string>; value: number }

/** One SDMX-JSON data message flattened to observations keyed by dimension id. */
async function sdmx(flow: string, key: string, extra: Record<string, string> = {}): Promise<SdmxObs[]> {
  const url = `${SDMX}/ABS,${flow},/${key}?` + new URLSearchParams({ dimensionAtObservation: 'AllDimensions', ...extra });
  const res = await retryFetch(url, { headers: { Accept: 'application/vnd.sdmx.data+json' } }, { attempts: 3, timeoutMs: 60_000, label: `ABS ${flow}` });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ABS ${flow} HTTP ${res.status}`);
  const data = await res.json();
  const structure = data.data?.structures?.[0] ?? data.structure;
  const dims: { id: string; values: { id: string; name: string }[] }[] = structure?.dimensions?.observation ?? [];
  const out: SdmxObs[] = [];
  for (const ds of data.data?.dataSets ?? []) {
    for (const [k, v] of Object.entries<any>(ds.observations ?? {})) {
      const idx = k.split(':').map(Number);
      const codes: Record<string, string> = {}, names: Record<string, string> = {};
      dims.forEach((d, i) => { const val = d.values[idx[i]]; if (val) { codes[d.id] = val.id; names[d.id] = val.name; } });
      const value = Number(Array.isArray(v) ? v[0] : v);
      if (Number.isFinite(value)) out.push({ codes, names, value });
    }
  }
  return out;
}

const MONTH = 30 * DAY_MS;
const sdmxCached = (flow: string, key: string, maxAge = MONTH, extra?: Record<string, string>) =>
  cachedJson('abs', `${flow}_${key}`, maxAge, () => sdmx(flow, key, extra));

// ---- Census 2021 -----------------------------------------------------------

export type CensusLevel = 'SA2' | 'LGA';

export interface CensusMedians {
  medianAge?: number;
  personalIncomeWk?: number;
  familyIncomeWk?: number;
  householdIncomeWk?: number;
  rentWk?: number;
  mortgageMo?: number;
  householdSize?: number;
  personsPerBedroom?: number;
}

/** Counts of occupied private dwellings by structure, and the vacancy figures. */
export interface DwellingMix {
  occupied: number;
  unoccupied: number;
  separateHouse: number;
  semiDetached: number;
  flatsLow: number;   // one to three storeys
  flatsMid: number;   // four to eight storeys
  flatsHigh: number;  // nine or more storeys
  flatsOther: number; // attached to a house
  other: number;
  notStated: number;
}

export interface TenureMix {
  total: number;
  ownedOutright: number;
  mortgage: number;
  rentedPrivate: number;
  rentedSocial: number;
  otherTenure: number;
  notStated: number;
}

/** Employed people by how they got to work on census day. */
export interface TravelMix {
  total: number;
  car: number;
  publicTransport: number;
  active: number;
  workedAtHome: number;
  other: number;
  didNotGoToWork: number;
  notStated: number;
}

export interface AgeBand { label: string; persons: number }

export interface PersonsProfile {
  persons: number;
  bornInAustralia: number;
  bornElsewhere: number;
  englishOnly: number;
  otherLanguage: number;
  indigenous: number;
  ages: AgeBand[];
}

export interface CensusProfile {
  level: CensusLevel | 'GCCSA' | 'STE';
  code: string;
  name: string;
  medians: CensusMedians;
  dwellings?: DwellingMix;
  tenure?: TenureMix;
  travel?: TravelMix;
  persons?: PersonsProfile;
}

const AGE_BANDS: [string, string][] = [
  ['0_4', '0–4'], ['5_14', '5–14'], ['15_19', '15–19'], ['20_24', '20–24'], ['25_34', '25–34'], ['35_44', '35–44'],
  ['45_54', '45–54'], ['55_64', '55–64'], ['65_74', '65–74'], ['75_84', '75–84'], ['GE85', '85+'],
];

const byCode = (obs: SdmxObs[], dim: string) => {
  const m = new Map<string, number>();
  for (const o of obs) m.set(o.codes[dim], o.value);
  return (code: string) => m.get(code) ?? 0;
};

/**
 * The Census 2021 profile of one region: medians (G02), dwelling structure
 * (G36), tenure (G37), travel to work (G62) and persons (G01). SA2 codes and
 * the Greater Capital City codes share the SA2+ tables; LGAs have their own.
 */
export async function fetchCensusProfile(code: string, level: CensusLevel | 'GCCSA' | 'STE', name: string): Promise<CensusProfile> {
  const suffix = level === 'LGA' ? 'LGA' : 'SA2';
  const [g02, g36, g37, g62, g01] = await Promise.all([
    sdmxCached(`C21_G02_${suffix}`, `.${code}..`),
    sdmxCached(`C21_G36_${suffix}`, `.D.${code}..`),
    sdmxCached(`C21_G37_${suffix}`, `._T.${code}..`),
    sdmxCached(`C21_G62_${suffix}`, `.3.${code}..`),
    sdmxCached(`C21_G01_${suffix}`, `3..${code}..`),
  ]);
  const med = byCode(g02, 'MEDAVG');
  const medians: CensusMedians = {
    medianAge: med('1') || undefined, personalIncomeWk: med('2') || undefined, familyIncomeWk: med('3') || undefined,
    householdIncomeWk: med('4') || undefined, mortgageMo: med('5') || undefined, rentWk: med('6') || undefined,
    personsPerBedroom: med('7') || undefined, householdSize: med('8') || undefined,
  };
  let dwellings: DwellingMix | undefined;
  if (g36.length) {
    const d = byCode(g36, 'DWTSTRD');
    dwellings = {
      occupied: d('OCC'), unoccupied: d('N_OCC'), separateHouse: d('11'), semiDetached: d('2'),
      flatsLow: d('31') + d('32'), flatsMid: d('33'), flatsHigh: d('34'), flatsOther: d('35'), other: d('9'), notStated: d('_N'),
    };
  }
  let tenure: TenureMix | undefined;
  if (g37.length) {
    const t = byCode(g37, 'TENLLD');
    tenure = {
      total: t('_T'), ownedOutright: t('1'), mortgage: t('2'),
      rentedPrivate: t('3') + t('6') + t('7') + t('R_N'), rentedSocial: t('4') + t('5'), otherTenure: t('9'), notStated: t('_N'),
    };
  }
  let travel: TravelMix | undefined;
  if (g62.length) {
    const m = byCode(g62, 'MTWP');
    // Any journey with a train, bus, ferry or tram leg is public transport;
    // the "and total" rows are the two-method rows led by that mode, and the
    // three-method rows led by train or bus complete it.
    const publicTransport = m('1') + m('2') + m('3') + m('4') + m('1_T') + m('2_T') + m('1_2O') + m('2_2O');
    const car = m('6') + m('7') + m('8') + m('9') + m('5');
    const active = m('10') + m('232');
    const total = m('_T');
    const workedAtHome = m('233'), didNotGoToWork = m('234'), notStated = m('_N');
    travel = { total, car, publicTransport, active, workedAtHome, didNotGoToWork, notStated,
      other: Math.max(0, total - car - publicTransport - active - workedAtHome - didNotGoToWork - notStated) };
  }
  let persons: PersonsProfile | undefined;
  if (g01.length) {
    const p = byCode(g01, 'PCHAR');
    persons = {
      persons: p('P_1'), bornInAustralia: p('B_11'), bornElsewhere: p('B_O'), englishOnly: p('L_1201'), otherLanguage: p('L_O'), indigenous: p('A_T'),
      ages: AGE_BANDS.map(([c, label]) => ({ label, persons: p(c) })),
    };
  }
  return { level, code, name, medians, dwellings, tenure, travel, persons };
}

// ---- population series and SEIFA -------------------------------------------

export interface YearValue { year: number; value: number }

/** Estimated resident population, 30 June each year from 2001, for an SA2 or any ASGS region code. */
export async function fetchErpSeries(code: string, regionType: 'SA2' | 'SA3' | 'SA4' | 'GCCSA' | 'STE' = 'SA2'): Promise<YearValue[]> {
  const obs = await sdmxCached('ABS_ANNUAL_ERP_ASGS2021', `ERP.${regionType}.${code}.A`, 7 * DAY_MS);
  return obs.map((o) => ({ year: Number(o.codes.TIME_PERIOD), value: o.value })).filter((y) => y.year > 0).sort((a, b) => a.year - b.year);
}

/** The same series for a local government area (the LGA flows are re-issued each year with that year's boundaries). */
export async function fetchErpSeriesLga(lgaCode: string): Promise<YearValue[]> {
  const year = new Date().getFullYear();
  for (const y of [year, year - 1, year - 2]) {
    const obs = await sdmxCached(`ERP_LGA${y}`, `ERP..${lgaCode}.A`, 7 * DAY_MS).catch(() => [] as SdmxObs[]);
    if (obs.length) return obs.map((o) => ({ year: Number(o.codes.TIME_PERIOD), value: o.value })).filter((v) => v.year > 0).sort((a, b) => a.year - b.year);
  }
  return [];
}

export interface Seifa {
  /** Index of Relative Socio-economic Advantage and Disadvantage. */
  irsad: { score?: number; decileAustralia?: number; decileState?: number };
  irsd: { score?: number; decileAustralia?: number; decileState?: number };
}

export async function fetchSeifa(code: string, level: 'SA2' | 'LGA'): Promise<Seifa | null> {
  const obs = await sdmxCached(`ABS_SEIFA2021_${level}`, `${code}.IRSAD+IRSD.SCORE+RWAD+RWSD`);
  if (!obs.length) return null;
  const pick = (type: string, measure: string) => obs.find((o) => o.codes.SEIFAINDEXTYPE === type && o.codes.SEIFA_MEASURE === measure)?.value;
  return {
    irsad: { score: pick('IRSAD', 'SCORE'), decileAustralia: pick('IRSAD', 'RWAD'), decileState: pick('IRSAD', 'RWSD') },
    irsd: { score: pick('IRSD', 'SCORE'), decileAustralia: pick('IRSD', 'RWAD'), decileState: pick('IRSD', 'RWSD') },
  };
}

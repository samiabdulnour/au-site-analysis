// Transport for NSW's Travel Zone Projections 2024: population 2021–2066 by
// travel zone (with the SA2 and LGA each zone sits in) and by LGA. Two CSV
// files from the open data portal, no key, cached on the volume for a month.

import { retryFetch } from '../lib/http.js';
import { cachedText, parseCsv, DAY_MS } from '../lib/cache.js';
import type { YearValue } from './abs.js';

const DATASET = 'https://opendata.transport.nsw.gov.au/data/dataset/e35da583-c645-4e15-a7ca-ea6678ae2699/resource';
const LGA_CSV = `${DATASET}/f5dbed33-175c-438d-885e-ca453f1462a6/download/tzp24-erp-by-lga-2021-2066.csv`;
const TZ_CSV = `${DATASET}/3739c279-7887-4e33-9b96-8a181b23be84/download/tzp24-population-erp_popd_pnpd-by-tz-2021-2066.csv`;

export interface Tzp24 {
  /** Projected population of the SA2, summed from its travel zones. */
  sa2: YearValue[];
  /** Projected population of the LGA, from the LGA file. */
  lga: YearValue[];
  lgaName?: string;
  source: string;
}

async function csv(url: string, key: string): Promise<Record<string, string>[]> {
  const text = await cachedText('tzp24', key, 30 * DAY_MS, async () => {
    const res = await retryFetch(url, {}, { attempts: 3, timeoutMs: 120_000, label: 'TZP24' });
    if (!res.ok) throw new Error(`TZP24 HTTP ${res.status}`);
    return res.text();
  });
  return parseCsv(text);
}

const yearCols = (row: Record<string, string>) =>
  Object.keys(row).filter((k) => /^ERP_\d{4}$/.test(k)).map((k) => Number(k.slice(4))).sort((a, b) => a - b);

const stem = (s: string) => s.toUpperCase().replace(/\(NSW\)/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

/** Population projections for an SA2 and its LGA; either list is empty when the file has no row for it. */
export async function fetchTzp24(sa2Code: string | undefined, lgaName: string | undefined): Promise<Tzp24> {
  const [tz, lga] = await Promise.all([
    sa2Code ? csv(TZ_CSV, 'tzp24-population-by-tz.csv').catch(() => []) : Promise.resolve([]),
    lgaName ? csv(LGA_CSV, 'tzp24-erp-by-lga.csv').catch(() => []) : Promise.resolve([]),
  ]);
  const out: Tzp24 = { sa2: [], lga: [], source: 'TfNSW Travel Zone Projections 2024 (TZP24)' };
  const zones = tz.filter((r) => r.SA2_CODE21 === sa2Code);
  if (zones.length) {
    out.sa2 = yearCols(zones[0]).map((year) => ({ year, value: Math.round(zones.reduce((s, r) => s + (Number(r[`ERP_${year}`]) || 0), 0)) }));
  }
  if (lgaName && lga.length) {
    const nameCol = Object.keys(lga[0]).find((k) => /LGA/i.test(k)) ?? 'LGA 2021 Name';
    const want = stem(lgaName);
    const row = lga.find((r) => stem(r[nameCol]) === want) ?? lga.find((r) => stem(r[nameCol]).startsWith(want) || want.startsWith(stem(r[nameCol])));
    if (row) {
      out.lgaName = row[nameCol];
      out.lga = yearCols(row).map((year) => ({ year, value: Math.round(Number(row[`ERP_${year}`]) || 0) }));
    }
  }
  return out;
}

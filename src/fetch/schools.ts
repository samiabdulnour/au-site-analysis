// NSW government schools: the Department of Education's master dataset of
// school locations and enrolments (data.nsw.gov.au, CSV, no key), cached on
// the volume for a month. Non-government schools are not in it.

import { retryFetch } from '../lib/http.js';
import { cachedText, parseCsv, DAY_MS } from '../lib/cache.js';
import type { LonLat } from '../lib/geo.js';

const CSV = 'https://data.nsw.gov.au/data/dataset/78c10ea3-8d04-4c9c-b255-bbf8547e37e7/resource/3e6d5f6a-055c-440d-a690-fc0537c31095/download/master_dataset.csv';

export interface School {
  name: string;
  level: string;        // Primary School, Secondary School, Central/Community School, …
  enrolment?: number;   // latest year, full-time equivalent
  selective?: string;   // Not Selective, Partially Selective, Fully Selective
  gender?: string;
  icsea?: number;
  distanceM: number;
  lon: number;
  lat: number;
}

/** Mainstream schools: not the schools for specific purposes, environmental education centres, nurseries and the like. */
const MAINSTREAM = /primary|secondary|central|community|infants|high school/i;

/** The nearest mainstream government schools within `radiusM`, nearest first. */
export async function fetchNearbySchools(p: LonLat, radiusM = 2000, limit = 8): Promise<School[]> {
  const text = await cachedText('schools', 'master_dataset.csv', 30 * DAY_MS, async () => {
    const res = await retryFetch(CSV, {}, { attempts: 3, timeoutMs: 60_000, label: 'schools dataset' });
    if (!res.ok) throw new Error(`schools dataset HTTP ${res.status}`);
    return res.text();
  });
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180), ky = 111_320;
  const out: School[] = [];
  for (const r of parseCsv(text)) {
    const lon = Number(r.Longitude), lat = Number(r.Latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const d = Math.hypot((lon - p.lon) * kx, (lat - p.lat) * ky);
    if (d > radiusM || !MAINSTREAM.test(`${r.Level_of_schooling} ${r.School_name}`) || /nursery|specific purposes|hospital school/i.test(`${r.Level_of_schooling} ${r.School_name}`)) continue;
    const enrol = Number(r.latest_year_enrolment_FTE), icsea = Number(r.ICSEA_value);
    out.push({
      name: r.School_name, level: r.Level_of_schooling, enrolment: Number.isFinite(enrol) && enrol > 0 ? Math.round(enrol) : undefined,
      selective: r.Selective_school || undefined, gender: r.School_gender || undefined,
      icsea: Number.isFinite(icsea) && icsea > 0 ? icsea : undefined, distanceM: Math.round(d), lon, lat,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
}

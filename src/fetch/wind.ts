// Slide 13: the wind, as roses of the hourly wind at 10 m over the last five
// full years, from NASA's POWER project: the MERRA-2 reanalysis, the cell of
// 0.5° × 0.625° over the site, no key, free for any use (the project asks
// for an acknowledgement, which the slides carry). It is the region's wind,
// not a measurement at the site: a reanalysis cell smooths the sea breeze
// and all but loses the calms, and the buildings and the landform around a
// site channel and shelter it.
//
// Open-Meteo's archive of ERA5 answers too, at a finer grid, but its free
// API is for non-commercial use only; the Bureau of Meteorology's station
// roses are images behind a block on scripted access.
//
// The roses are counted once per cell and cached for half a year: 16
// sectors of 22.5° by the Bureau's speed classes (2–10, 10–20, 20–30 and
// 30 km/h and over, calm below 2), for the year, summer (December to
// February), winter (June to August), and the summer afternoons and winter
// mornings (3 pm and 9 am, local standard time) that the sentence quotes.

import { retryFetch } from '../lib/http.js';
import { cachedJson, DAY_MS } from '../lib/cache.js';
import type { LonLat } from '../lib/geo.js';

const POWER_HOURLY = 'https://power.larc.nasa.gov/api/temporal/hourly/point';
export const WIND_SOURCE = 'NASA POWER (MERRA-2 reanalysis)';
export const WIND_YEARS = 5;
/** The lower edges of the speed classes, km/h; below the first is calm. */
export const WIND_CLASSES_KMH = [2, 10, 20, 30];
export const SECTORS = 16;

export interface WindRose {
  hours: number;
  /** Share of the hours below the first class, %. */
  calmPct: number;
  meanKmh: number;
  /** [sector: 0 north, clockwise][class]: share of all the rose's hours, %. */
  pct: number[][];
}

export interface WindData {
  ok: boolean;
  note?: string;
  /** The years read, first and last, whole. */
  years: [number, number];
  /** The point asked for (the site, to 0.05°), and the model's ground height for its cell. */
  lon: number;
  lat: number;
  elevationM?: number;
  annual: WindRose;
  summer: WindRose;
  winter: WindRose;
  /** Summer afternoons at 3 pm and winter mornings at 9 am, local standard time. */
  summerAfternoon: WindRose;
  winterMorning: WindRose;
  fetchedAt: string;
}

export const emptyRose = (): WindRose => ({ hours: 0, calmPct: 0, meanKmh: 0, pct: Array.from({ length: SECTORS }, () => new Array(WIND_CLASSES_KMH.length).fill(0)) });

export const emptyWind = (note: string): WindData => ({
  ok: false, note, years: [0, 0], lon: 0, lat: 0,
  annual: emptyRose(), summer: emptyRose(), winter: emptyRose(), summerAfternoon: emptyRose(), winterMorning: emptyRose(),
  fetchedAt: new Date().toISOString(),
});

/** The sector a direction the wind blows from falls in: 0 is north, each 22.5° wide and centred on its point. */
export const sectorOf = (deg: number) => Math.floor((((deg % 360) + 360 + 11.25) % 360) / 22.5) % SECTORS;

export interface WindHour { month: number; hour: number; ms: number; deg: number }

/** The rose of the hours `keep` takes (month 1–12, hour 0–23 in local standard time), speeds in m/s. */
export function roseFrom(hours: WindHour[], keep: (month: number, hour: number) => boolean): WindRose {
  const rose = emptyRose();
  let n = 0, calm = 0, sum = 0;
  for (const h of hours) {
    if (!keep(h.month, h.hour)) continue;
    n++;
    const kmh = h.ms * 3.6;
    sum += kmh;
    if (kmh < WIND_CLASSES_KMH[0]) { calm++; continue; }
    let c = WIND_CLASSES_KMH.length - 1;
    while (c > 0 && kmh < WIND_CLASSES_KMH[c]) c--;
    rose.pct[sectorOf(h.deg)][c]++;
  }
  if (!n) return rose;
  for (const row of rose.pct) for (let c = 0; c < row.length; c++) row[c] = (row[c] / n) * 100;
  return { hours: n, calmPct: (calm / n) * 100, meanKmh: sum / n, pct: rose.pct };
}

/** A rose's share of hours per sector, all speeds. */
export const sectorTotals = (rose: WindRose) => rose.pct.map((row) => row.reduce((a, v) => a + v, 0));

/**
 * The rose's prevailing winds: the three neighbouring sectors that hold the
 * most hours, and the next such run whose middle is at least 90° from the
 * first's. Each is its middle sector's bearing, its first and last
 * sectors' bearings, and its share of the hours.
 */
export function windLobes(rose: WindRose): { centre: number; from: number; to: number; pct: number }[] {
  const tot = sectorTotals(rose);
  const run = (i: number) => tot[(i + SECTORS - 1) % SECTORS] + tot[i] + tot[(i + 1) % SECTORS];
  if (!tot.some((v) => v > 0)) return [];
  let first = 0;
  for (let i = 1; i < SECTORS; i++) if (run(i) > run(first)) first = i;
  let second = -1;
  for (let i = 0; i < SECTORS; i++) {
    const apart = Math.min(Math.abs(i - first), SECTORS - Math.abs(i - first));
    if (apart >= 4 && (second < 0 || run(i) > run(second))) second = i;
  }
  return [first, second].filter((i) => i >= 0).map((i) => ({ centre: i * 22.5, from: ((i + SECTORS - 1) % SECTORS) * 22.5, to: ((i + 1) % SECTORS) * 22.5, pct: run(i) }));
}

interface PowerHourly {
  geometry?: { coordinates?: number[] };
  header?: { fill_value?: number };
  properties?: { parameter?: { WS10M?: Record<string, number>; WD10M?: Record<string, number> } };
}

/** POWER's hourly JSON as hours: its keys are YYYYMMDDHH in local standard time, and its fill value (−999) is a missing hour. */
export function parsePowerHourly(j: PowerHourly): { hours: WindHour[]; elevationM?: number } {
  const ws = j.properties?.parameter?.WS10M ?? {}, wd = j.properties?.parameter?.WD10M ?? {};
  const fill = j.header?.fill_value ?? -999;
  const hours: WindHour[] = [];
  for (const [key, ms] of Object.entries(ws)) {
    const deg = wd[key];
    if (!/^\d{10}$/.test(key) || ms === fill || deg === undefined || deg === fill || !Number.isFinite(ms) || !Number.isFinite(deg) || ms < 0) continue;
    hours.push({ month: Number(key.slice(4, 6)), hour: Number(key.slice(8, 10)), ms, deg });
  }
  const z = j.geometry?.coordinates?.[2];
  return { hours, elevationM: Number.isFinite(z) ? z : undefined };
}

const isSummer = (m: number) => m === 12 || m <= 2;
const isWinter = (m: number) => m >= 6 && m <= 8;

/** The wind at the site's cell, for the last five full years; cached by cell and years. */
export async function fetchWind(centre: LonLat, log: (m: string) => void = () => {}): Promise<WindData> {
  const last = new Date().getUTCFullYear() - 1, first = last - WIND_YEARS + 1;
  // to 0.05°: the model's cell is some 50 km across, so the sites in a suburb share one fetch
  const lat = Math.round(centre.lat * 20) / 20, lon = Math.round(centre.lon * 20) / 20;
  const t0 = Date.now();
  const data = await cachedJson<WindData>('wind', `power-${lat.toFixed(2)}-${lon.toFixed(2)}-${first}-${last}`, 180 * DAY_MS, async () => {
    const q = new URLSearchParams({ parameters: 'WS10M,WD10M', community: 'RE', longitude: lon.toFixed(2), latitude: lat.toFixed(2), start: `${first}0101`, end: `${last}1231`, format: 'JSON', 'time-standard': 'LST' });
    const res = await retryFetch(`${POWER_HOURLY}?${q}`, { headers: { Accept: 'application/json' } }, { attempts: 3, timeoutMs: 120_000, label: 'NASA POWER hourly wind' });
    if (!res.ok) throw new Error(`NASA POWER returned HTTP ${res.status}`);
    const { hours, elevationM } = parsePowerHourly((await res.json()) as PowerHourly);
    if (hours.length < 24 * 365) throw new Error(`NASA POWER returned ${hours.length} hours for ${first}–${last}`);
    return {
      ok: true, years: [first, last], lon, lat, elevationM,
      annual: roseFrom(hours, () => true),
      summer: roseFrom(hours, (m) => isSummer(m)),
      winter: roseFrom(hours, (m) => isWinter(m)),
      summerAfternoon: roseFrom(hours, (m, h) => isSummer(m) && h === 15),
      winterMorning: roseFrom(hours, (m, h) => isWinter(m) && h === 9),
      fetchedAt: new Date().toISOString(),
    };
  });
  log(`  wind: ${data.years[0]}–${data.years[1]}, ${data.annual.hours} hours at ${lat.toFixed(2)}, ${lon.toFixed(2)}; ${Math.round((Date.now() - t0) / 1000)} s`);
  return data;
}

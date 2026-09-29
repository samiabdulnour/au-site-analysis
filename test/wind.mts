/* Slide 13's wind roses from made-up hours: which sector a direction falls
 * in, the speed classes and the calms, the seasons and the hours of the
 * day, the prevailing runs of sectors, and NASA POWER's hourly JSON with
 * its fill values. No network: CI never calls NASA.
 *
 *   npx tsx test/wind.mts
 */

import { sectorOf, roseFrom, windLobes, sectorTotals, parsePowerHourly, WIND_CLASSES_KMH, type WindHour } from '../src/fetch/wind.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---- sectors ------------------------------------------------------------------------

check('sector: north is 0', sectorOf(0) === 0 && sectorOf(360) === 0);
check('sector: 11.24° is still north, 11.25° north-north-east', sectorOf(11.24) === 0 && sectorOf(11.25) === 1);
check('sector: 348.75° is north again, 348.74° north-north-west', sectorOf(348.75) === 0 && sectorOf(348.74) === 15);
check('sector: east is 4, south 8, west 12', sectorOf(90) === 4 && sectorOf(180) === 8 && sectorOf(270) === 12);
check('sector: a negative bearing wraps', sectorOf(-90) === 12);

// ---- a rose ---------------------------------------------------------------------------

const kmh = (v: number) => v / 3.6;
const hour = (month: number, h: number, speedKmh: number, deg: number): WindHour => ({ month, hour: h, ms: kmh(speedKmh), deg });
const hours: WindHour[] = [
  hour(1, 15, 15, 45),    // summer afternoon, NE, 10–20
  hour(1, 15, 25, 45),    // summer afternoon, NE, 20–30
  hour(2, 9, 5, 160),     // summer morning, SSE, 2–10
  hour(12, 3, 1, 200),    // summer night, calm
  hour(7, 9, 35, 250),    // winter morning, WSW, 30 and over
  hour(7, 9, 12, 270),    // winter morning, W, 10–20
  hour(4, 12, 8, 90),     // autumn, E, 2–10: in the year only
];
const year = roseFrom(hours, () => true);
check('rose: every hour counted', year.hours === hours.length, `${year.hours}`);
check('rose: calm is under the first class', near(year.calmPct, (1 / 7) * 100), `${year.calmPct}`);
check('rose: shares and calm make the whole', near(sectorTotals(year).reduce((a, v) => a + v, 0) + year.calmPct, 100, 1e-6));
check('rose: a 15 km/h NE hour is in the second class', near(year.pct[2][1], (1 / 7) * 100));
check('rose: a 25 km/h NE hour is in the third class', near(year.pct[2][2], (1 / 7) * 100));
check('rose: 35 km/h is in the last class', near(year.pct[11][WIND_CLASSES_KMH.length - 1], (1 / 7) * 100), JSON.stringify(year.pct[11]));
check('rose: exactly 10 km/h starts the second class', roseFrom([hour(1, 0, 10, 0)], () => true).pct[0][1] === 100);
check('rose: the mean speed counts the calms', near(year.meanKmh, (15 + 25 + 5 + 1 + 35 + 12 + 8) / 7, 1e-6), `${year.meanKmh}`);

const summer = roseFrom(hours, (m) => m === 12 || m <= 2);
check('season: summer takes December to February', summer.hours === 4, `${summer.hours}`);
const afternoon = roseFrom(hours, (m, h) => (m === 12 || m <= 2) && h === 15);
check('hour: summer afternoons are the 3 pm hours', afternoon.hours === 2 && near(sectorTotals(afternoon)[2], 100));
const none = roseFrom(hours, () => false);
check('rose: no hours, an empty rose', none.hours === 0 && none.calmPct === 0 && sectorTotals(none).every((v) => v === 0));

// ---- the prevailing runs ----------------------------------------------------------------

{
  // a north-east lobe (NNE, NE, ENE) and a south-south-east one, 135° apart, and a stray west
  const made: WindHour[] = [];
  const add = (deg: number, n: number) => { for (let i = 0; i < n; i++) made.push(hour(1, 12, 15, deg)); };
  add(22.5, 10); add(45, 14); add(67.5, 10); add(157.5, 12); add(180, 9); add(135, 6); add(270, 4); add(292.5, 3);
  const lobes = windLobes(roseFrom(made, () => true));
  check('lobes: the first is the north-east run', lobes[0]?.centre === 45 && lobes[0].from === 22.5 && lobes[0].to === 67.5, JSON.stringify(lobes[0]));
  check('lobes: its share is the three sectors\'', near(lobes[0].pct, (34 / 68) * 100, 1e-6), `${lobes[0]?.pct}`);
  check('lobes: the second is the south-south-east run, 90° or more from the first', lobes[1]?.centre === 157.5, JSON.stringify(lobes[1]));
}
{
  // two neighbouring sectors both strong: the second run must not be the first one shifted by a sector
  const made: WindHour[] = [];
  const add = (deg: number, n: number) => { for (let i = 0; i < n; i++) made.push(hour(7, 9, 20, deg)); };
  add(247.5, 12); add(270, 11); add(225, 9); add(292.5, 5); add(90, 3);
  const lobes = windLobes(roseFrom(made, () => true));
  check('lobes: a second run is at least four sectors away', !lobes[1] || Math.min(Math.abs(lobes[1].centre - lobes[0].centre), 360 - Math.abs(lobes[1].centre - lobes[0].centre)) >= 90, JSON.stringify(lobes));
}
check('lobes: an empty rose has none', windLobes(none).length === 0);

// ---- NASA POWER's hourly JSON --------------------------------------------------------------

{
  const j = {
    geometry: { coordinates: [151.25, -33.9, 31.72] },
    header: { fill_value: -999 },
    properties: { parameter: {
      WS10M: { '2025010115': 5.2, '2025010116': -999, '2025070109': 3.1, bad: 2, '2025070110': 4 },
      WD10M: { '2025010115': 45, '2025010116': 90, '2025070109': 250, bad: 10 },
    } },
  };
  const { hours: hs, elevationM } = parsePowerHourly(j);
  check('POWER: fill values and hours without a direction are dropped', hs.length === 2, JSON.stringify(hs));
  check('POWER: month and hour from the YYYYMMDDHH key', hs[0].month === 1 && hs[0].hour === 15 && hs[1].month === 7 && hs[1].hour === 9, JSON.stringify(hs));
  check('POWER: the cell\'s elevation from the geometry', elevationM === 31.72);
  check('POWER: nothing in, nothing out', parsePowerHourly({}).hours.length === 0);
}

if (failures.length) {
  console.error(`wind: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('wind: all checks passed');

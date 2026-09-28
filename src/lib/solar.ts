// Where the sun is: NOAA's solar position algorithm (Meeus), good to a
// fraction of a degree, which is all a sun-path diagram and a shadow study
// need. Times are civil: the caller says the clock offset (AEST is +10,
// AEDT +11) and gets positions for a whole day at a step.

export interface SunPosition { altitudeDeg: number; azimuthDeg: number }

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Julian day from a UTC date. */
function julianDay(utc: Date): number {
  return utc.getTime() / 86_400_000 + 2_440_587.5;
}

/** The sun's altitude and azimuth (clockwise from true north) at a place and instant. */
export function sunPosition(lat: number, lon: number, utc: Date): SunPosition {
  const jd = julianDay(utc);
  const T = (jd - 2_451_545) / 36_525;
  const L0 = (280.46646 + T * (36_000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35_999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  const minutesUtc = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60;
  const trueSolarMin = (minutesUtc + eqTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarMin / 4 - 180;
  const phi = rad(lat), ha = rad(hourAngle);
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  let az = 0;
  const denom = Math.cos(phi) * Math.sin(zen);
  if (Math.abs(denom) > 1e-9) {
    const cosAz = Math.max(-1, Math.min(1, (Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / denom));
    const a = deg(Math.acos(cosAz));
    // NOAA: afternoon (hour angle positive) is 180° + a, morning 540° − a; noon lands due north in the south
    az = hourAngle > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  // atmospheric refraction near the horizon
  const alt = 90 - deg(zen);
  let refr = 0;
  if (alt > 85) refr = 0;
  else if (alt > 5) { const te = Math.tan(rad(alt)); refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5; }
  else if (alt > -0.575) refr = 1735 + alt * (-518.2 + alt * (103.4 + alt * (-12.79 + alt * 0.711)));
  else refr = -20.772 / Math.tan(rad(alt));
  return { altitudeDeg: alt + refr / 3600, azimuthDeg: (az + 360) % 360 };
}

export interface SunSample { clockMin: number; altitudeDeg: number; azimuthDeg: number }

/** A UTC instant from a civil clock time (minutes after midnight) on a date, given the clock's offset from UTC in hours. */
export function civilToUtc(year: number, month: number, day: number, clockMin: number, offsetHours: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + (clockMin - offsetHours * 60) * 60_000);
}

/** The sun through one civil day at `stepMin`, above the horizon only. */
export function sunPath(lat: number, lon: number, year: number, month: number, day: number, offsetHours: number, stepMin = 10): SunSample[] {
  const out: SunSample[] = [];
  for (let m = 0; m < 1440; m += stepMin) {
    const p = sunPosition(lat, lon, civilToUtc(year, month, day, m, offsetHours));
    if (p.altitudeDeg > -0.5) out.push({ clockMin: m, ...p });
  }
  return out;
}

/** Sunrise, solar noon and sunset (civil minutes) on a date, by scanning at a minute. */
export function sunTimes(lat: number, lon: number, year: number, month: number, day: number, offsetHours: number): { rise: number; noon: number; set: number; noonAltitudeDeg: number } {
  let rise = -1, set = -1, noon = 0, best = -90;
  let prevUp = false;
  for (let m = 0; m <= 1440; m++) {
    const p = sunPosition(lat, lon, civilToUtc(year, month, day, m, offsetHours));
    const up = p.altitudeDeg > -0.833;
    if (up && !prevUp && rise < 0) rise = m;
    if (!up && prevUp && set < 0) set = m;
    if (p.altitudeDeg > best) { best = p.altitudeDeg; noon = m; }
    prevUp = up;
  }
  return { rise, noon, set, noonAltitudeDeg: best };
}

export const fmtClock = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

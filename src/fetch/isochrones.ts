// Walking isochrones (5 & 10 min ≈ 400 m & 800 m) from the Valhalla public server.

import type { LonLat } from '../lib/geo.js';
import { retryFetch } from '../lib/http.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de/isochrone';

export interface Isochrone { minutes: number; rings: [number, number][][] }

export async function fetchIsochrones(center: LonLat, minutes: number[] = [5, 10]): Promise<Isochrone[]> {
  const req = {
    locations: [{ lat: center.lat, lon: center.lon }],
    costing: 'pedestrian',
    contours: minutes.map((time) => ({ time })),
    polygons: true,
  };
  const res = await retryFetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(req))}`, {}, {
    attempts: 4, timeoutMs: 60_000, label: 'isochrones',
  });
  if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
  const data = await res.json();
  const out: Isochrone[] = [];
  for (const f of data.features ?? []) {
    const minutes = f.properties?.contour;
    if (f.geometry?.type === 'Polygon') out.push({ minutes, rings: f.geometry.coordinates });
    else if (f.geometry?.type === 'MultiPolygon')
      out.push({ minutes, rings: f.geometry.coordinates.flat() });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

/** A journey's time and length by one costing (auto, bicycle, pedestrian), from the public router; null where it does not answer. */
export interface RouteSummary { minutes: number; km: number }
export async function fetchRoute(from: LonLat, to: LonLat, costing: 'auto' | 'bicycle' | 'pedestrian'): Promise<RouteSummary | null> {
  const req = { locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }], costing, units: 'kilometers' };
  const res = await retryFetch(`${VALHALLA.replace(/isochrone$/, 'route')}?json=${encodeURIComponent(JSON.stringify(req))}`, {}, { attempts: 3, timeoutMs: 60_000, label: `route ${costing}` });
  if (!res.ok) return null;
  const data = await res.json();
  const sum = data?.trip?.summary;
  return sum ? { minutes: Math.round(sum.time / 60), km: Math.round(sum.length * 10) / 10 } : null;
}

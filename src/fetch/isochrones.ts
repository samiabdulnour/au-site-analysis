// Walking isochrones (5 & 10 min ≈ 400 m & 800 m) from the Valhalla public server.

import type { LonLat } from '../lib/geo.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de/isochrone';

export interface Isochrone { minutes: number; rings: [number, number][][] }

export async function fetchIsochrones(center: LonLat): Promise<Isochrone[]> {
  const req = {
    locations: [{ lat: center.lat, lon: center.lon }],
    costing: 'pedestrian',
    contours: [{ time: 5 }, { time: 10 }],
    polygons: true,
  };
  const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(req))}`, {
    signal: AbortSignal.timeout(60_000),
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

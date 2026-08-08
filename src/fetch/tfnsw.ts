// Bus stops from the TfNSW Trip Planner API (requires TFNSW_API_KEY from
// opendata.transport.nsw.gov.au — free registration). Authoritative and
// reliable, unlike the shared public Overpass servers.

import type { Extent } from '../lib/geo.js';
import { mercatorToLonLat } from '../lib/geo.js';

const COORD_API = 'https://api.transport.nsw.gov.au/v1/tp/coord';

export interface BusStop { name?: string; lon: number; lat: number }

async function coordRequest(lon: number, lat: number, radiusM: number, apiKey: string): Promise<any[]> {
  const params = new URLSearchParams({
    outputFormat: 'rapidJSON',
    coord: `${lon}:${lat}:EPSG:4326`,
    coordOutputFormat: 'EPSG:4326',
    inclFilter: '1',
    type_1: 'BUS_POINT',
    radius_1: String(radiusM),
    version: '10.2.1.42',
  });
  const res = await fetch(`${COORD_API}?${params}`, {
    headers: { Authorization: `apikey ${apiKey}` },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`TfNSW coord API HTTP ${res.status}`);
  const data = await res.json();
  return data.locations ?? [];
}

/**
 * Fetch all bus stops in the extent via a 2×2 grid of radius queries (the
 * coord API caps result counts), dedupe by stop id, then cluster stands and
 * platforms of the same stop (≤30 m apart) into one symbol.
 */
export async function fetchBusStopsTfnsw(extent: Extent, apiKey: string): Promise<BusStop[]> {
  const cx = (extent.xmin + extent.xmax) / 2;
  const cy = (extent.ymin + extent.ymax) / 2;
  const qw = (extent.xmax - extent.xmin) / 4;
  const qh = (extent.ymax - extent.ymin) / 4;
  const radius = Math.ceil(Math.hypot(qw, qh)) + 150;
  const centers = [
    { x: cx - qw, y: cy - qh }, { x: cx + qw, y: cy - qh },
    { x: cx - qw, y: cy + qh }, { x: cx + qw, y: cy + qh },
  ];

  const byId = new Map<string, BusStop>();
  for (const c of centers) {
    const ll = mercatorToLonLat(c);
    const locations = await coordRequest(ll.lon, ll.lat, radius, apiKey);
    for (const l of locations) {
      const [lat, lon] = l.coord ?? [];
      if (lat == null) continue;
      byId.set(String(l.id ?? `${lat},${lon}`), { name: l.name, lon, lat });
    }
  }

  // Greedy 30m clustering (platforms/stands of one interchange -> one B).
  const stops = [...byId.values()];
  const clustered: BusStop[] = [];
  const used = new Array(stops.length).fill(false);
  const M = 111_320; // meters per degree, near enough at Sydney latitudes
  for (let i = 0; i < stops.length; i++) {
    if (used[i]) continue;
    const group = [stops[i]];
    used[i] = true;
    for (let j = i + 1; j < stops.length; j++) {
      if (used[j]) continue;
      const dx = (stops[j].lon - stops[i].lon) * M * Math.cos((stops[i].lat * Math.PI) / 180);
      const dy = (stops[j].lat - stops[i].lat) * M;
      if (Math.hypot(dx, dy) < 30) { group.push(stops[j]); used[j] = true; }
    }
    clustered.push({
      name: group[0].name,
      lon: group.reduce((s, p) => s + p.lon, 0) / group.length,
      lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
    });
  }
  return clustered;
}

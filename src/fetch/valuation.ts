// The Valuer General's land values and property sales, through the SIX Maps
// Valuation service (no key). The Valuer General's own site blocks
// automation; this service publishes the same five annual land values per
// property and the sales register with prices, dates and areas.

import { retryFetch } from '../lib/http.js';
import { lonLatToMercator, mercatorToLonLat, type LonLat, type XY } from '../lib/geo.js';

const V = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer';

export interface LandValue { baseDate: string; year: number; value: number }
export interface LandValues {
  propid: number;
  address: string;
  zone?: string;
  areaSqm?: number;
  /** The valuation basis, e.g. "7B(1)" for a stratum. */
  basis?: string;
  stratum: boolean;
  values: LandValue[];
  source: string;
}

export interface Sale {
  address: string;
  price: number;
  date: string;   // ISO
  areaSqm?: number;
  strata: boolean;
  /** Properties conveyed in the one dealing (a portfolio or amalgamation when > 1). */
  properties: number;
  lon: number;
  lat: number;
  distanceM: number;
}

async function getJson(url: string, label: string): Promise<any> {
  const res = await retryFetch(url, {}, { attempts: 3, timeoutMs: 45_000, label });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${label}: ${data.error.message ?? 'service error'}`);
  return data;
}

const money = (s: unknown) => { const n = Number(String(s ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };
/** "1.088 hectares" or "652.3 square metres" → square metres; blank (a stratum) → undefined. */
export function areaSqm(s: unknown): number | undefined {
  const m = String(s ?? '').trim().match(/^([\d,.]+)\s*(hectares?|ha|square metres?|sq\.? ?m|m2|m²)?/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return /^h/i.test(m[2] ?? '') ? Math.round(n * 10_000) : n;
}

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
/** "16 July 2026" → "2026-07-16"; anything else comes back unchanged. */
export function isoDate(s: unknown): string {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return String(s ?? '');
  const mo = MONTHS[m[2].toLowerCase()];
  return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(s);
}

const streetKey = (a: string) => a.toUpperCase().replace(/\bSTREET\b/g, 'ST').replace(/\bROAD\b/g, 'RD').replace(/\bAVENUE\b/g, 'AVE').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The land values of the property at a point. Where properties overlap
 * (strata lots, stratum parcels) the one whose address matches the site's
 * is taken, else the largest; `stratum` says when the value is a stratum's.
 */
export async function fetchLandValues(p: LonLat, siteAddress?: string): Promise<LandValues | null> {
  const bounds = await getJson(`${V}/9/query?` + new URLSearchParams({
    geometry: `${p.lon},${p.lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'propid,shape_Area', returnGeometry: 'false', f: 'json',
  }), 'Valuation boundaries');
  const props: { propid: number; area: number }[] = (bounds.features ?? [])
    .map((f: any) => ({ propid: Number(f.attributes?.propid), area: Number(f.attributes?.shape_Area) || 0 }))
    .filter((x: { propid: number }) => Number.isFinite(x.propid) && x.propid > 0);
  if (!props.length) return null;
  const vals = await getJson(`${V}/5/query?` + new URLSearchParams({
    where: `propid IN (${props.map((x) => x.propid).join(',')})`, outFields: '*', returnGeometry: 'false', f: 'json',
  }), 'Valuation values');
  const rows: any[] = (vals.features ?? []).map((f: any) => f.attributes);
  if (!rows.length) return null;
  const want = siteAddress ? streetKey(siteAddress) : '';
  const num = want.match(/^\d+[A-Z]?/)?.[0];
  const street = want.replace(/^[\d\-A-Z ]*?\b(?=[A-Z]{2,})/, '').split(' ').slice(0, 2).join(' ');
  const scored = rows.map((r) => {
    const a = streetKey(String(r.address ?? ''));
    let score = 0;
    if (want && num && a.startsWith(`${num} `)) score += 2;
    if (want && street && a.includes(street)) score += 1;
    if (!/^7B|STRATUM/i.test(String(r.basis_desc ?? ''))) score += 0.5;
    score += (props.find((x) => x.propid === Number(r.propid))?.area ?? 0) / 1e6;
    return { r, score };
  }).sort((a, b) => b.score - a.score);
  const r = scored[0].r;
  const values: LandValue[] = [];
  for (let i = 1; i <= 5; i++) {
    const v = money(r[`val${i}_lv`]), bd = String(r[`val${i}_bd`] ?? '').trim();
    const year = Number(bd.match(/(\d{4})$/)?.[1]);
    if (v && year) values.push({ baseDate: bd, year, value: v });
  }
  values.sort((a, b) => a.year - b.year);
  const basis = String(r.basis_desc ?? '').trim();
  return {
    propid: Number(r.propid), address: String(r.address ?? '').replace(/\s+/g, ' ').trim(),
    zone: r.zone_desc ? String(r.zone_desc) : undefined, areaSqm: areaSqm(r.prop_area),
    basis: basis ? basis.split(' - ')[0] : undefined, stratum: /^7B|stratum/i.test(basis),
    values, source: 'NSW Valuer General land values via SIX Maps',
  };
}

/** Every recorded sale within `radiusM` of the point (the register keeps the last sale per property, plus earlier dealings on record). */
export async function fetchSales(p: LonLat, radiusM = 400): Promise<Sale[]> {
  const c = lonLatToMercator(p);
  const k = 1 / Math.cos((p.lat * Math.PI) / 180);
  const env = { xmin: c.x - radiusM * k, ymin: c.y - radiusM * k, xmax: c.x + radiusM * k, ymax: c.y + radiusM * k, spatialReference: { wkid: 3857 } };
  const data = await getJson(`${V}/1/query?` + new URLSearchParams({
    geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', inSR: '3857', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'house_no,street,suburb,price,sale_date,area,strata,deal_props,bp_address', returnGeometry: 'true', outSR: '3857', f: 'json',
  }), 'Valuation sales');
  const out: Sale[] = [];
  for (const f of data.features ?? []) {
    const a = f.attributes ?? {}, g: XY | undefined = f.geometry;
    const price = Number(a.price);
    if (!g || !Number.isFinite(price) || price <= 0) continue;
    const d = Math.hypot(g.x - c.x, g.y - c.y) / k;
    if (d > radiusM) continue;
    const ll = mercatorToLonLat(g);
    const bp = String(a.bp_address ?? '').replace(/\s+/g, ' ').trim();
    const unit = String(a.house_no ?? '').includes('/') ? String(a.house_no).split('/')[0] : '';
    out.push({
      address: (unit ? `${unit}/` : '') + (bp || [a.house_no, a.street, a.suburb].filter(Boolean).join(' ')),
      price, date: isoDate(a.sale_date), areaSqm: Number(a.area) > 0 ? Number(a.area) : undefined,
      strata: Number(a.strata) > 0, properties: Number(a.deal_props) || 1, lon: ll.lon, lat: ll.lat, distanceM: Math.round(d),
    });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

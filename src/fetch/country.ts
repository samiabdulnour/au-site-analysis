// The layers of Country that are open data, for the Country slide: the
// National Native Title Tribunal's registers at the site and over the
// window, the gazetted Aboriginal Places within reach, the pre-1750 plant
// community at the site and across the strip (the State Vegetation Type
// Map), the named watercourses and the coastline, the Local Aboriginal
// Land Council areas, the National Parks estate, the ASDST likelihood
// model at the site, and a wide elevation grid for the hillshade and the
// ridgelines. AHIMS itself is not open and is never read here; the slide
// says so. Each part is soft: a service that does not answer leaves its
// part empty and a warning in the log.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFetch } from '../lib/http.js';
import { queryByExtent } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor, type Extent, type LonLat, type XY } from '../lib/geo.js';
import { fetchDemGrid, type DemGrid } from './terrain.js';
import { ridgeLines } from '../lib/ridges.js';
import { fetchNpws, type NpwsReserve } from './greenSpace.js';

const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
const PORTAL = 'https://portal.spatial.nsw.gov.au/server/rest/services';
const NNTT = 'https://services2.arcgis.com/rzk7fNEt0xoEp3cX/ArcGIS/rest/services/NNTT_Custodial_AGOL/FeatureServer';
const PLACES = `${M3}/HMS/Heritage/MapServer/8`;
const SVTM = `${M3}/VIS/SVTM_NSW_1750_PCT/MapServer`;
const ASDST = `${M3}/Cultural/Aboriginal_Sites_Decision_Support_Tool_ASDST/MapServer`;
const WATER = `${PORTAL}/NSW_Water_Theme/FeatureServer`;
const LALC = `${PORTAL}/NSW_Administrative_Boundaries_Theme/FeatureServer/1`;

export interface NativeTitleRecord { kind: 'determination' | 'claim' | 'ilua'; id: string; name: string; detail: string; date?: string }
export interface AboriginalPlace {
  name: string; label: string; gazetted?: string; hectares?: number;
  /** The register marks the place's location as restricted; the public geometry is generalised. */
  restricted: boolean;
  lalc?: string; lga?: string; lon: number; lat: number; rings: number[][][]; distanceM: number; bearing: number;
}
export interface VegClass { pctId: string; pct: string; cls: string; formation: string; colour: string; sharePct: number }
export interface Watercourse { name?: string; perenniality: 'perennial' | 'non-perennial' | 'mainly dry' | 'unknown'; hierarchy: 'major' | 'secondary' | 'minor' | 'undefined'; coords: [number, number][] }
export interface LalcArea { local: string; regional: string; rings: number[][][] }

export interface CountryData {
  nativeTitle: { ok: boolean; atSite: NativeTitleRecord[]; inWindow: { determinations: number; claims: number; iluas: number }; currency?: string };
  places: AboriginalPlace[];
  placesRadiusM: number;
  placesOk: boolean;
  vegetation: {
    ok: boolean;
    atSite: { pctId: string; pct: string; cls: string; formation: string } | null;
    /** The State's own rendering of the plant community types over the strip, written beside the aerial tiles. */
    image: { file: string; extent: Extent; pxWidth: number; pxHeight: number } | null;
    /** The communities in the strip, by share of its area, in the map's colours. */
    classes: VegClass[];
    source: string;
  };
  water: { ok: boolean; courses: Watercourse[]; coastline: [number, number][][] };
  lalcs: LalcArea[];
  npws: NpwsReserve[];
  dem: DemGrid | null;
  /** Ridge polylines in Mercator coordinates, longest first. */
  ridges: { x: number; y: number; z: number }[][];
  asdst: { ok: boolean; likelihood: number | null; surveyPriority: number | null; scaleMax: number };
  fetchedAt: string;
}

const isoDate = (ms: unknown) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : undefined; };
const rings = (g: any): number[][][] => (!g ? [] : g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
const paths = (g: any): [number, number][][] => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

async function getJson(url: string, params: Record<string, string>, label: string): Promise<any> {
  const res = await retryFetch(`${url}?${new URLSearchParams(params)}`, {}, { attempts: 3, timeoutMs: 60_000, label });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${label}: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data;
}

// ---- native title ----------------------------------------------------------

const NNTT_LAYERS: { kind: NativeTitleRecord['kind']; layer: number; countKey: 'determinations' | 'claims' | 'iluas' }[] = [
  { kind: 'determination', layer: 6, countKey: 'determinations' },
  { kind: 'claim', layer: 7, countKey: 'claims' },
  { kind: 'ilua', layer: 4, countKey: 'iluas' },
];

function nativeTitleRecord(kind: NativeTitleRecord['kind'], a: Record<string, any>): NativeTitleRecord {
  const id = String(a.Tribunal_ID ?? ''), name = String(a.Name ?? '').trim();
  if (kind === 'determination') return { kind, id, name, detail: [a.Determined_Outcome, a.Determination_Type, a.RNTBC_Name ? `${a.RNTBC_Name}` : ''].filter(Boolean).join(' · '), date: isoDate(a.Determination_Date) };
  if (kind === 'claim') return { kind, id, name, detail: [a.Status, a.RT_Status].filter(Boolean).join(' · '), date: isoDate(a.Date_Lodged) };
  return { kind, id, name, detail: [a.Agreement_Status, a.Agreement_Type].filter(Boolean).join(' · '), date: isoDate(a.Date_Registered) };
}

async function fetchNativeTitle(centre: LonLat, extent: Extent): Promise<CountryData['nativeTitle']> {
  const atSite: NativeTitleRecord[] = [];
  const inWindow = { determinations: 0, claims: 0, iluas: 0 };
  let currency: string | undefined;
  await Promise.all(NNTT_LAYERS.map(async (l) => {
    const point = await getJson(`${NNTT}/${l.layer}/query`, {
      f: 'json', geometry: JSON.stringify({ x: centre.lon, y: centre.lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false',
    }, `native title ${l.kind}`);
    for (const f of point.features ?? []) { atSite.push(nativeTitleRecord(l.kind, f.attributes ?? {})); currency = currency ?? isoDate(f.attributes?.Date_Currency); }
    const count = await getJson(`${NNTT}/${l.layer}/query`, {
      f: 'json', geometry: JSON.stringify({ ...extent, spatialReference: { wkid: 3857 } }), geometryType: 'esriGeometryEnvelope', inSR: '3857',
      spatialRel: 'esriSpatialRelIntersects', returnCountOnly: 'true',
    }, `native title ${l.kind} count`);
    inWindow[l.countKey] = Number(count.count ?? 0);
  }));
  return { ok: true, atSite, inWindow, currency };
}

// ---- gazetted Aboriginal Places ---------------------------------------------

async function fetchPlaces(centre: XY, radiusM: number): Promise<AboriginalPlace[]> {
  const k = mercatorScaleFactor(mercatorToLonLat(centre).lat);
  const r = radiusM * k;
  const fc = await queryByExtent(PLACES, { xmin: centre.x - r, ymin: centre.y - r, xmax: centre.x + r, ymax: centre.y + r },
    'NAME,Label,GAZ_DATE,Hectares,Restricted,LALC,LGA,Longitude,Latitude', '1=1', { maxAllowableOffset: '0.00005' });
  const out: AboriginalPlace[] = [];
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const rg = rings(f.geometry);
    let lon = Number(p.Longitude), lat = Number(p.Latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { const pts = rg.flat(); if (!pts.length) continue; lon = pts.reduce((a, q) => a + q[0], 0) / pts.length; lat = pts.reduce((a, q) => a + q[1], 0) / pts.length; }
    const m = lonLatToMercator({ lon, lat });
    const distanceM = Math.hypot(m.x - centre.x, m.y - centre.y) / k;
    if (distanceM > radiusM) continue;
    out.push({
      name: String(p.NAME ?? '').trim(), label: String(p.Label ?? p.NAME ?? '').trim(), gazetted: isoDate(p.GAZ_DATE),
      hectares: Number.isFinite(Number(p.Hectares)) ? Math.round(Number(p.Hectares) * 100) / 100 : undefined,
      restricted: Number(p.Restricted) === 1, lalc: p.LALC ? String(p.LALC) : undefined, lga: p.LGA ? String(p.LGA) : undefined,
      lon, lat, rings: rg, distanceM: Math.round(distanceM), bearing: Math.round(((Math.atan2(m.x - centre.x, m.y - centre.y) * 180) / Math.PI + 360) % 360),
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

// ---- the pre-1750 vegetation -----------------------------------------------

async function identifyPct(lon: number, lat: number): Promise<{ pctId: string; pct: string; cls: string; formation: string } | null> {
  const d = 0.002;
  const data = await getJson(`${SVTM}/identify`, {
    f: 'json', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: 'all:2', tolerance: '1',
    mapExtent: `${lon - d},${lat - d},${lon + d},${lat + d}`, imageDisplay: '400,400,96', returnGeometry: 'false',
  }, 'vegetation identify');
  const a = (data.results ?? [])[0]?.attributes;
  if (!a) return null;
  const pctId = String(a.PCTID ?? a['Pixel Value'] ?? '').trim();
  const pct = String(a.PCTName ?? '').trim();
  if (!pct || pctId === '0') return { pctId: pctId || '0', pct: 'Not classified', cls: '', formation: '' };
  return { pctId, pct, cls: String(a.vegClass ?? '').trim(), formation: String(a.vegForm ?? '').trim() };
}

/** A 24 or 32-bit BMP's pixels as [r, g, b] rows from the top. */
function decodeBmp(buf: Uint8Array): { width: number; height: number; px: (x: number, y: number) => [number, number, number] } | null {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offset = dv.getUint32(10, true), width = dv.getInt32(18, true), heightRaw = dv.getInt32(22, true), bpp = dv.getUint16(28, true);
  if (bpp !== 24 && bpp !== 32) return null;
  const height = Math.abs(heightRaw), bottomUp = heightRaw > 0;
  const bytes = bpp / 8, stride = Math.ceil((width * bytes) / 4) * 4;
  return {
    width, height,
    px: (x, y) => { const row = bottomUp ? height - 1 - y : y; const i = offset + row * stride + x * bytes; return [buf[i + 2], buf[i + 1], buf[i]]; },
  };
}

const hex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

async function fetchVegetation(extent: Extent, pxWidth: number, pxHeight: number, centre: LonLat, outDir: string, log: (m: string) => void): Promise<CountryData['vegetation']> {
  const source = 'NSW State Vegetation Type Map, pre-1750 plant community types (DCCEEW)';
  const out: CountryData['vegetation'] = { ok: false, atSite: null, image: null, classes: [], source };
  const bbox = `${extent.xmin},${extent.ymin},${extent.xmax},${extent.ymax}`;
  // the community at the site, the picture, and a small copy to read the colours from
  const [atSite, png, bmp] = await Promise.all([
    identifyPct(centre.lon, centre.lat).catch((e) => { log(`  WARN pre-1750 vegetation at the site failed: ${e?.message ?? e}`); return null; }),
    // the layer draws only between 1:100,000 and 1:25,001, and the service reckons scale from the pixels and the dpi, so the picture is asked for at a print dpi that keeps two metres a pixel on the coarse side of that
    retryFetch(`${SVTM}/export?${new URLSearchParams({ f: 'image', bbox, bboxSR: '3857', imageSR: '3857', size: `${pxWidth},${pxHeight}`, layers: 'show:2', format: 'png32', transparent: 'true', dpi: String(Math.ceil((pxWidth / ((extent.xmax - extent.xmin) / 30_000)) * 0.0254)) })}`, {}, { attempts: 3, timeoutMs: 90_000, label: 'vegetation export' })
      .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch((e) => { log(`  WARN pre-1750 vegetation map failed: ${e?.message ?? e}`); return null; }),
    retryFetch(`${SVTM}/export?${new URLSearchParams({ f: 'image', bbox, bboxSR: '3857', imageSR: '3857', size: '296,100', layers: 'show:2', format: 'bmp', transparent: 'false' })}`, {}, { attempts: 3, timeoutMs: 60_000, label: 'vegetation colours' })
      .then(async (r) => (r.ok ? new Uint8Array(await r.arrayBuffer()) : null)).catch(() => null),
  ]);
  out.atSite = atSite;
  if (png && png.length > 100) {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'veg1750.png'), png);
    out.image = { file: 'veg1750.png', extent, pxWidth, pxHeight };
  }
  const img = bmp ? decodeBmp(bmp) : null;
  if (img) {
    // the colours by share, then a name for each colour that covers 1 % of the strip or more
    const counts = new Map<string, { n: number; sx: number; sy: number }>();
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const c = hex(img.px(x, y));
      if (c === '#ffffff') continue; // the export's background where the model has nothing
      const e = counts.get(c) ?? { n: 0, sx: 0, sy: 0 };
      e.n++; e.sx += x; e.sy += y; counts.set(c, e);
    }
    const total = [...counts.values()].reduce((a, e) => a + e.n, 0) || 1;
    const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).filter(([, e]) => e.n / total >= 0.01).slice(0, 8);
    const named = await Promise.all(top.map(async ([colour, e]) => {
      // identify at the pixel of this colour nearest its own centre of mass, so the sample is inside the patch
      let best = { x: 0, y: 0, d: Infinity };
      const cx = e.sx / e.n, cy = e.sy / e.n;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { if (hex(img.px(x, y)) !== colour) continue; const d = Math.hypot(x - cx, y - cy); if (d < best.d) best = { x, y, d }; }
      const mx = extent.xmin + ((best.x + 0.5) / img.width) * (extent.xmax - extent.xmin);
      const my = extent.ymax - ((best.y + 0.5) / img.height) * (extent.ymax - extent.ymin);
      const ll = mercatorToLonLat({ x: mx, y: my });
      const cls = await identifyPct(ll.lon, ll.lat).catch(() => null);
      return { pctId: cls?.pctId ?? '', pct: cls?.pct ?? 'Unnamed community', cls: cls?.cls ?? '', formation: cls?.formation ?? '', colour, sharePct: Math.round((e.n / total) * 1000) / 10 };
    }));
    // the same community can come back under two colours at a patch edge; merge by name
    const merged = new Map<string, VegClass>();
    for (const c of named) { const key = c.pctId || c.pct; const cur = merged.get(key); if (cur) cur.sharePct = Math.round((cur.sharePct + c.sharePct) * 10) / 10; else merged.set(key, { ...c }); }
    out.classes = [...merged.values()].sort((a, b) => b.sharePct - a.sharePct);
  }
  out.ok = Boolean(out.atSite || out.image);
  return out;
}

// ---- water, land councils, the ASDST model ----------------------------------

const PERENNIALITY: Record<number, Watercourse['perenniality']> = { 1: 'perennial', 2: 'non-perennial', 3: 'mainly dry' };
const HIERARCHY: Record<number, Watercourse['hierarchy']> = { 1: 'major', 2: 'secondary', 3: 'minor' };

async function fetchWater(extent: Extent): Promise<CountryData['water']> {
  const [lines, coast] = await Promise.all([
    queryByExtent(`${WATER}/5`, extent, 'hydroname,hydronametype,perenniality,hierarchy,hydrotype', '1=1', { maxAllowableOffset: '0.00003' }),
    queryByExtent(`${WATER}/4`, extent, 'objectid', '1=1', { maxAllowableOffset: '0.00003' }),
  ]);
  const courses: Watercourse[] = [];
  for (const f of lines.features) {
    const p = f.properties ?? {};
    const name = p.hydroname ? [String(p.hydroname).trim(), p.hydronametype ? String(p.hydronametype).trim() : ''].filter(Boolean).join(' ') : undefined;
    for (const c of paths(f.geometry)) courses.push({ name, perenniality: PERENNIALITY[Number(p.perenniality)] ?? 'unknown', hierarchy: HIERARCHY[Number(p.hierarchy)] ?? 'undefined', coords: c as [number, number][] });
  }
  return { ok: true, courses, coastline: coast.features.flatMap((f) => paths(f.geometry)) as [number, number][][] };
}

async function fetchLalcs(extent: Extent): Promise<LalcArea[]> {
  const fc = await queryByExtent(LALC, extent, 'localcouncilname,regionalcouncilname', '1=1', { maxAllowableOffset: '0.0002' });
  return fc.features.map((f) => ({ local: String(f.properties?.localcouncilname ?? '').trim(), regional: String(f.properties?.regionalcouncilname ?? '').trim(), rings: rings(f.geometry) })).filter((l) => l.local && l.rings.length);
}

async function fetchAsdst(centre: LonLat): Promise<CountryData['asdst']> {
  const d = 0.002;
  const data = await getJson(`${ASDST}/identify`, {
    f: 'json', geometry: `${centre.lon},${centre.lat}`, geometryType: 'esriGeometryPoint', sr: '4326', layers: 'all:6,4', tolerance: '1',
    mapExtent: `${centre.lon - d},${centre.lat - d},${centre.lon + d},${centre.lat + d}`, imageDisplay: '400,400,96', returnGeometry: 'false',
  }, 'ASDST identify');
  const value = (id: number) => { const r = (data.results ?? []).find((q: any) => Number(q.layerId) === id); const v = Number(r?.attributes?.['Pixel Value']); return Number.isFinite(v) ? Math.round(v) : null; };
  return { ok: true, likelihood: value(6), surveyPriority: value(4), scaleMax: 999 };
}

// ---- all of it ---------------------------------------------------------------

export const EMPTY_COUNTRY: CountryData = {
  nativeTitle: { ok: false, atSite: [], inWindow: { determinations: 0, claims: 0, iluas: 0 } },
  places: [], placesRadiusM: 10_000, placesOk: false,
  vegetation: { ok: false, atSite: null, image: null, classes: [], source: 'NSW State Vegetation Type Map, pre-1750 plant community types (DCCEEW)' },
  water: { ok: false, courses: [], coastline: [] },
  lalcs: [], npws: [], dem: null, ridges: [],
  asdst: { ok: false, likelihood: null, surveyPriority: null, scaleMax: 999 },
  fetchedAt: new Date(0).toISOString(),
};

/**
 * Everything the Country slide draws, over the wide strip's extent, with the
 * vegetation picture written to `outDir`. `pxWidth` × `pxHeight` is the
 * picture's size, two metres a pixel at the strip's scale.
 */
export async function fetchCountry(extent: Extent, pxWidth: number, pxHeight: number, centre: XY, outDir: string, log: (m: string) => void = () => {}): Promise<CountryData> {
  const centreLL = mercatorToLonLat(centre);
  const took: string[] = [];
  const soft = async <T>(p: Promise<T>, fallback: T, what: string): Promise<T> => {
    const t0 = Date.now();
    try { return await p; } catch (e: any) { log(`  WARN Country: ${what} failed: ${e?.message ?? e}`); return fallback; } finally { took.push(`${what} ${Math.round((Date.now() - t0) / 1000)} s`); }
  };
  const [nativeTitle, places, vegetation, water, lalcs, npws, dem, asdst] = await Promise.all([
    soft(fetchNativeTitle(centreLL, extent), EMPTY_COUNTRY.nativeTitle, 'native title registers'),
    soft(fetchPlaces(centre, EMPTY_COUNTRY.placesRadiusM), null as AboriginalPlace[] | null, 'Aboriginal Places'),
    soft(fetchVegetation(extent, pxWidth, pxHeight, centreLL, outDir, log), EMPTY_COUNTRY.vegetation, 'pre-1750 vegetation'),
    soft(fetchWater(extent), EMPTY_COUNTRY.water, 'watercourses'),
    soft(fetchLalcs(extent), [] as LalcArea[], 'land council areas'),
    soft(fetchNpws(extent), [] as NpwsReserve[], 'NPWS estate'),
    soft(fetchDemGrid(extent, 8), null as DemGrid | null, 'wide elevation grid'),
    soft(fetchAsdst(centreLL), EMPTY_COUNTRY.asdst, 'ASDST model'),
  ]);
  const ridges = dem ? ridgeLines(dem, { riseM: 1.0, reliefM: 4 }) : [];
  log(`  country timings: ${took.join(', ')}`);
  log(`  country: native-title at site:${nativeTitle.atSite.length} window:${nativeTitle.inWindow.determinations}/${nativeTitle.inWindow.claims}/${nativeTitle.inWindow.iluas} places:${places?.length ?? 'x'} veg:${vegetation.atSite?.pct ?? '—'} classes:${vegetation.classes.length} water:${water.courses.length} lalcs:${lalcs.length} npws:${npws.length} ridges:${ridges.length} asdst:${asdst.likelihood ?? '—'}`);
  return { nativeTitle, places: places ?? [], placesRadiusM: EMPTY_COUNTRY.placesRadiusM, placesOk: places !== null, vegetation, water, lalcs, npws, dem, ridges, asdst, fetchedAt: new Date().toISOString() };
}

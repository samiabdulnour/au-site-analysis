// The layers of Country that are open data, for the Country slide: the
// National Native Title Tribunal's registers at the site and over the
// window, the gazetted Aboriginal Places within reach, the pre-1750 plant
// community at the site and across the strip (the State Vegetation Type
// Map), the named watercourses and the coastline, the Local Aboriginal
// Land Council areas, the National Parks estate, the ASDST likelihood
// model at the site, and a wide elevation grid for the hillshade and the
// ridgelines. Over the strip too, the Aboriginal heritage the LEPs map (the
// heritage schedules' Aboriginal items and the two plans' maps of Aboriginal
// cultural landscapes), Heritage NSW's Aboriginal Heritage Impact Permit
// boundaries, and the Indigenous places of the National and Commonwealth
// Heritage Lists and of the archived Register of the National Estate.
// AHIMS itself is not open and is never read here; the slide says so. Each
// part is soft: a service that does not answer leaves its part empty and a
// warning in the log.

import { decodePng, encodeGreyPng } from '../lib/png.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retryFetch } from '../lib/http.js';
import { queryByExtent, type GeoJSONFeature } from '../lib/arcgis.js';
import { lonLatToMercator, mercatorToLonLat, mercatorScaleFactor, ringCentroid, type Extent, type LonLat, type XY } from '../lib/geo.js';
import { clipRings, coversBox, ringArea, type Box } from '../lib/rings.js';
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
export interface VegClass {
  pctId: string; pct: string; cls: string; formation: string; colour: string; sharePct: number;
  /** Every colour the State's map draws it in. */
  colours?: string[];
  /** A greyscale mask of where it stands on the map, white over the community. */
  mask?: string;
  /** Where its name goes on slide 15: the point of its biggest patch on the page farthest from the patch's edge, in Mercator, and that distance in metres (render/paintMasks.ts). */
  label?: { x: number; y: number; clearM: number };
}
export interface Watercourse { name?: string; perenniality: 'perennial' | 'non-perennial' | 'mainly dry' | 'unknown'; hierarchy: 'major' | 'secondary' | 'minor' | 'undefined'; coords: [number, number][] }
export interface LalcArea { local: string; regional: string; rings: number[][][] }

/** An Aboriginal heritage item in a local environmental plan's heritage schedule, as the plan's heritage map draws it. */
export interface LepAboriginalItem {
  id?: string;
  name: string;
  /** Aboriginal Object, Aboriginal Place of Heritage Significance, Item - Aboriginal or Conservation Area - Aboriginal. */
  cls: string;
  significance?: string;
  epi: string;
  rings: number[][][];
  /** The centroid of its largest ring. */
  lon: number;
  lat: number;
}

/** The heritage map's classes that are Aboriginal heritage (EPI_Primary_Planning_Layers/0, LAY_CLASS). */
export const LEP_ABORIGINAL_CLASSES = ['Aboriginal Object', 'Aboriginal Place of Heritage Significance', 'Item - Aboriginal', 'Conservation Area - Aboriginal'];

/**
 * Land a local environmental plan maps as an Aboriginal cultural landscape,
 * on one of its Local Provisions maps: a local provision of the plan
 * applies there. The areas of one map in the strip are merged.
 */
export interface LepAboriginalArea {
  epi: string;
  /** The map, e.g. Sensitive Aboriginal Landscape Map, and its class, e.g. Sensitive Aboriginal Landscape Area. */
  map: string;
  cls: string;
  /** The map's currency date, ISO. */
  currency?: string;
  /** Clipped to the strip and a margin round it; empty when the area takes in the whole strip. */
  rings: number[][][];
  coversStrip: boolean;
}

/**
 * An Aboriginal Heritage Impact Permit's boundary, from Heritage NSW's layer
 * of the permits issued, varied, surrendered or revoked under the National
 * Parks and Wildlife Act 1974: land where harm to Aboriginal objects was
 * permitted, for a project. A permit's records (its variations, transfers
 * and surrender) are merged under its number.
 */
export interface AhipPermit {
  /** The permit's number as the register gives it, e.g. 4968 or C0005740. */
  id: string;
  project: string;
  applicant?: string;
  location?: string;
  /** The first decision and, where the permit was varied, the last, ISO. */
  decided?: string;
  lastDecided?: string;
  /** The latest expiry of its records, ISO. */
  expires?: string;
  /** ACTIVE when any of its records is, else its last record's: EXPIRED, VARIED or AREA VARIED. */
  status: string;
  records: number;
  /** Clipped to the strip and a margin round it. */
  rings: number[][][];
  /** The centroid of its largest ring in the strip. */
  lon: number;
  lat: number;
}

/**
 * An Indigenous place of the National Heritage List, the Commonwealth
 * Heritage List (places the Commonwealth owns or leases) or the Register of
 * the National Estate, which was closed in 2007 and is kept as an archive,
 * not a statutory list.
 */
export interface HeritageListPlace {
  list: 'NHL' | 'CHL' | 'RNE';
  id: string;
  name: string;
  /** As the list gives it: Listed place, Nominated place or Within listed place; for the RNE, Registered, Identified Place, Indicative Place or Interim List. */
  status: string;
  address?: string;
  hectares?: number;
  /** The date it was listed, ISO, where the list gives one. */
  listed?: string;
  url?: string;
  /** Clipped to the strip and a margin round it; empty when the place takes in the whole strip. */
  rings: number[][][];
  coversStrip: boolean;
  /** The centroid of its largest ring in the strip, or the strip's centre when it covers it. */
  lon: number;
  lat: number;
}

/** The Register of the National Estate's statuses kept: on the register, accepted on a State's assessment, entered but never assessed, and proposed. Rejected, removed and destroyed places are left out. */
export const RNE_STATUSES = ['Registered', 'Identified Place', 'Indicative Place', 'Interim List'];

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
    /** The communities painted with the slide's patterns (render/paintMasks.ts). */
    paint?: string;
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
  /** The Aboriginal heritage items the LEPs schedule over the strip; optional, since decks cached before it have none. */
  lepAboriginal?: { ok: boolean; items: LepAboriginalItem[] };
  /** The LEPs' maps of Aboriginal cultural landscapes over the strip; optional likewise, as are the two below. */
  lepAboriginalAreas?: { ok: boolean; areas: LepAboriginalArea[] };
  /** Heritage NSW's AHIP boundaries over the strip. */
  ahips?: { ok: boolean; permits: AhipPermit[] };
  /** The Indigenous places of the national lists over the strip, and which lists answered. */
  heritageLists?: { read: { nhl: boolean; chl: boolean; rne: boolean }; places: HeritageListPlace[] };
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
  // the colours are counted on the full picture where it decodes, the small copy otherwise
  const fullImg = png ? decodePng(png) : null;
  const img = fullImg
    ? { width: fullImg.width, height: fullImg.height, px: (x: number, y: number) => { const k = (y * fullImg.width + x) * 4; return (fullImg.data[k + 3] < 128 ? [255, 255, 255] : [fullImg.data[k], fullImg.data[k + 1], fullImg.data[k + 2]]) as [number, number, number]; } }
    : bmp ? decodeBmp(bmp) : null;
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
    for (const c of named) { const key = c.pctId || c.pct; const cur = merged.get(key); if (cur) { cur.sharePct = Math.round((cur.sharePct + c.sharePct) * 10) / 10; cur.colours!.push(c.colour); } else merged.set(key, { ...c, colours: [c.colour] }); }
    out.classes = [...merged.values()].sort((a, b) => b.sharePct - a.sharePct);
    // a mask per community from the full picture, so the deck can draw each in its own pattern rather than the State's colours
    const full = png ? decodePng(png) : null;
    if (full) {
      const pal = out.classes.flatMap((c, i) => c.colours!.map((h) => ({ i, r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) })));
      const masks = out.classes.map(() => new Uint8Array(full.width * full.height));
      for (let k = 0; k < full.width * full.height; k++) {
        if (full.data[k * 4 + 3] < 128) continue;
        const r = full.data[k * 4], g = full.data[k * 4 + 1], b = full.data[k * 4 + 2];
        let best = -1, bd = 60 * 60;
        for (const q of pal) { const d = (q.r - r) ** 2 + (q.g - g) ** 2 + (q.b - b) ** 2; if (d < bd) { bd = d; best = q.i; } }
        if (best >= 0) masks[best][k] = 255;
      }
      await Promise.all(out.classes.map(async (c, i) => { c.mask = `veg1750_mask${i}.png`; await writeFile(join(outDir, c.mask), encodeGreyPng(full.width, full.height, masks[i])); }));
    }
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

// ---- the LEPs' Aboriginal heritage items ------------------------------------------

const LEP_HERITAGE = `${M3}/Planning/EPI_Primary_Planning_Layers/MapServer/0`;

/**
 * The Aboriginal heritage items the local environmental plans schedule over
 * the strip. Few plans schedule any (71 items in 16 plans across NSW in
 * September 2026: Waverley's rock engravings and shelters around Bondi,
 * Eurobodalla's conservation areas, Balranald's items), so the answer is
 * mostly none; AHIMS, which holds the registered sites, is not open.
 */
async function fetchLepAboriginal(extent: Extent): Promise<LepAboriginalItem[]> {
  const where = `LAY_CLASS IN (${LEP_ABORIGINAL_CLASSES.map((c) => `'${c}'`).join(',')})`;
  const fc = await queryByExtent(LEP_HERITAGE, extent, 'H_ID,H_NAME,LAY_CLASS,SIG,EPI_NAME', where, { maxAllowableOffset: '0.00001' });
  const byKey = new Map<string, LepAboriginalItem>();
  for (const f of fc.features) {
    const rs = rings(f.geometry).filter((r) => r.length >= 4);
    if (!rs.length) continue;
    const p = f.properties ?? {};
    const epi = String(p.EPI_NAME ?? '').trim();
    const key = `${epi}|${p.H_ID ?? p.H_NAME}`;
    const had = byKey.get(key);
    if (had) { had.rings.push(...rs); continue; }
    byKey.set(key, { id: p.H_ID ? String(p.H_ID) : undefined, name: String(p.H_NAME ?? p.LAY_CLASS ?? '').trim(), cls: String(p.LAY_CLASS ?? ''), significance: p.SIG ? String(p.SIG) : undefined, epi, rings: rs, lon: 0, lat: 0 });
  }
  const area = (r: number[][]) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a); };
  return [...byKey.values()].map((it) => {
    const biggest = [...it.rings].sort((x, y) => area(y) - area(x))[0];
    const [lon, lat] = ringCentroid(biggest);
    return { ...it, lon, lat };
  });
}

// ---- the strip as the heritage layers are clipped to it --------------------------

/** The strip's extent in lon/lat, and with a margin round it: big outlines are clipped to the margin, so their cut edges fall outside the map. */
export function stripBoxes(extent: Extent): { strip: Box; clip: Box } {
  const box = (e: Extent): Box => { const sw = mercatorToLonLat({ x: e.xmin, y: e.ymin }), ne = mercatorToLonLat({ x: e.xmax, y: e.ymax }); return { xmin: sw.lon, ymin: sw.lat, xmax: ne.lon, ymax: ne.lat }; };
  const m = Math.max(extent.xmax - extent.xmin, extent.ymax - extent.ymin) * 0.1;
  return { strip: box(extent), clip: box({ xmin: extent.xmin - m, ymin: extent.ymin - m, xmax: extent.xmax + m, ymax: extent.ymax + m }) };
}

const sameRing = (a: number[][], b: number[][]) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);
const largestCentroid = (rs: number[][][]): [number, number] => ringCentroid([...rs].sort((x, y) => ringArea(y) - ringArea(x))[0]);

// ---- the LEPs' maps of Aboriginal cultural landscapes ----------------------------------

const LOCAL_PROVISIONS = `${M3}/ePlanning/Planning_Portal_Local_Provisions/MapServer`;
/**
 * The Local Provisions layers that map Aboriginal cultural landscapes: the
 * Aboriginal Cultural Significance Map (414, Moree Plains LEP 2011) and the
 * Sensitive Aboriginal Landscape Map (557, Lake Macquarie LEP 2014), the only
 * plans with such a map in September 2026.
 */
export const LEP_ABORIGINAL_MAP_LAYERS = [414, 557];

/** A map's areas over the strip, merged by plan, map and class. */
export function mergeLepAreas(features: GeoJSONFeature[], boxes: { strip: Box; clip: Box }): LepAboriginalArea[] {
  const byKey = new Map<string, { epi: string; map: string; cls: string; currency?: string; rings: number[][][] }>();
  for (const f of features) {
    const p = f.properties ?? {};
    const rs = rings(f.geometry).filter((r) => r.length >= 4);
    if (!rs.length) continue;
    const epi = String(p.EPI_NAME ?? '').trim(), map = String(p.MAP_NAME ?? '').trim(), cls = String(p.LAY_CLASS ?? p.CLASS_DESCRIPTION ?? '').trim();
    const key = `${epi}|${map}|${cls}`;
    const e = byKey.get(key) ?? byKey.set(key, { epi, map, cls, currency: isoDate(p.CURRENCY_DATE), rings: [] }).get(key)!;
    e.rings.push(...rs);
  }
  return [...byKey.values()].map((e) => {
    const coversStrip = coversBox(e.rings, boxes.strip);
    return { epi: e.epi, map: e.map, cls: e.cls, currency: e.currency, rings: coversStrip ? [] : clipRings(e.rings, boxes.clip), coversStrip };
  }).filter((a) => a.coversStrip || a.rings.length);
}

export async function fetchLepAboriginalAreas(extent: Extent): Promise<LepAboriginalArea[]> {
  const out = await Promise.all(LEP_ABORIGINAL_MAP_LAYERS.map((id) => queryByExtent(`${LOCAL_PROVISIONS}/${id}`, extent, 'EPI_NAME,MAP_NAME,LAY_CLASS,CLASS_DESCRIPTION,CURRENCY_DATE', '1=1', { maxAllowableOffset: '0.00001' })));
  return mergeLepAreas(out.flatMap((fc) => fc.features), stripBoxes(extent));
}

// ---- Aboriginal Heritage Impact Permits -------------------------------------------

const AHIPS = `${M3}/EDP/AHIPS/MapServer/0`;

/** The register's d/m/yyyy as ISO. */
const dmyIso = (v: unknown) => { const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined; };

/**
 * The registers' free text, tidied: line breaks run on, and a '?' left
 * where an old encoding lost an en dash, a curly quote or an apostrophe is
 * put back ("Zoo ? Stage 1" is "Zoo – Stage 1", "2?4" is "2–4", and a
 * spaced hyphen is a dash too,
 * "?Reflections?" is "‘Reflections’", "Queen?s" is "Queen’s").
 */
export function tidyRegisterText(v: unknown): string {
  return String(v ?? '')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/(^|[\s(])\?([^?\s](?:[^?]*[^?\s])?)\?(?=[\s,.;:)]|$)/g, '$1‘$2’')
    .replace(/(\d)\?(\d)/g, '$1–$2')
    .replace(/([A-Za-z])\?([A-Za-z])/g, '$1’$2')
    .replace(/\s[?-]\s/g, ' – ')
    .replace(/(\w)\?\s/g, '$1 – ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The permit records over the strip, merged by permit number: a variation, a transfer or a surrender is a record of its own. */
export function mergeAhips(features: GeoJSONFeature[], clip?: Box): AhipPermit[] {
  const byId = new Map<string, { id: string; recs: { decided?: string; expires?: string; status: string; project: string; applicant: string; location: string }[]; rings: number[][][] }>();
  for (const f of features) {
    const p = f.properties ?? {};
    let rs = rings(f.geometry).filter((r) => r.length >= 4);
    if (clip) rs = clipRings(rs, clip);
    if (!rs.length) continue;
    const id = String(p.AHIP ?? '').trim(), project = tidyRegisterText(p.Project_Na);
    const key = id || project || 'unnumbered';
    const e = byId.get(key) ?? byId.set(key, { id, recs: [], rings: [] }).get(key)!;
    for (const r of rs) if (!e.rings.some((q) => sameRing(q, r))) e.rings.push(r);
    e.recs.push({ decided: dmyIso(p.Decision_D), expires: isoDate(p.ExpireDate), status: String(p.Status ?? '').trim().toUpperCase(), project, applicant: tidyRegisterText(p.Applicant), location: tidyRegisterText(p.Location) });
  }
  return [...byId.values()].map((e) => {
    const recs = [...e.recs].sort((x, y) => (x.decided ?? '').localeCompare(y.decided ?? ''));
    const first = recs[0], last = recs[recs.length - 1];
    const [lon, lat] = largestCentroid(e.rings);
    return {
      id: e.id, project: recs.find((r) => r.project)?.project ?? '', applicant: recs.find((r) => r.applicant)?.applicant, location: recs.find((r) => r.location)?.location,
      decided: first.decided, lastDecided: last.decided !== first.decided ? last.decided : undefined,
      expires: recs.map((r) => r.expires).filter((x): x is string => Boolean(x)).sort().pop(),
      status: recs.some((r) => r.status === 'ACTIVE') ? 'ACTIVE' : last.status || 'UNKNOWN',
      records: recs.length, rings: e.rings, lon, lat,
    };
  });
}

export async function fetchAhips(extent: Extent): Promise<AhipPermit[]> {
  const fc = await queryByExtent(AHIPS, extent, 'AHIP,Project_Na,Applicant,Location,Decision_D,Status,ExpireDate', '1=1', { maxAllowableOffset: '0.00001' });
  return mergeAhips(fc.features, stripBoxes(extent).clip);
}

// ---- the national lists' Indigenous places ------------------------------------------

const DCCEEW_GIS = 'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services';
const LISTS: Record<HeritageListPlace['list'], { url: string; fields: string; where: string }> = {
  NHL: { url: `${DCCEEW_GIS}/National_Heritage_List/FeatureServer/0`, fields: 'PLACE_ID,NAME,STATUS,ADDRESS,AREA_HA,REGISTER_DATE,URL', where: "CLASS='Indigenous'" },
  CHL: { url: `${DCCEEW_GIS}/Commonwealth_Heritage_List/FeatureServer/0`, fields: 'PLACE_ID,NAME,STATUS,ADDRESS,AREA_HA,REGISTER', where: "CLASS='Indigenous'" },
  RNE: { url: 'https://services1.arcgis.com/gtRkYQyUQLMTM1uS/arcgis/rest/services/heritage_rnesdb_public/FeatureServer/0', fields: 'PLACE_ID,NAME,STATUS,ADDRESS', where: `CLASS='Indigenous' AND STATUS IN (${RNE_STATUSES.map((x) => `'${x}'`).join(',')})` },
};

/** A list's places over the strip, one per place id, their outlines clipped to the strip's margin. */
export function listPlaces(list: HeritageListPlace['list'], features: GeoJSONFeature[], boxes: { strip: Box; clip: Box }): HeritageListPlace[] {
  const byId = new Map<string, { p: Record<string, any>; rings: number[][][] }>();
  for (const f of features) {
    const p = f.properties ?? {};
    const rs = rings(f.geometry).filter((r) => r.length >= 4);
    if (!rs.length) continue;
    // the RNE's query filters by status; a list that answers without the filter must not bring a rejected place in
    if (list === 'RNE' && !RNE_STATUSES.includes(String(p.STATUS ?? '').trim())) continue;
    const id = String(p.PLACE_ID ?? p.NAME ?? '').trim();
    const e = byId.get(id) ?? byId.set(id, { p, rings: [] }).get(id)!;
    e.rings.push(...rs);
  }
  const mid = { lon: (boxes.strip.xmin + boxes.strip.xmax) / 2, lat: (boxes.strip.ymin + boxes.strip.ymax) / 2 };
  const out: HeritageListPlace[] = [];
  for (const [id, { p, rings: rs }] of byId) {
    const coversStrip = coversBox(rs, boxes.strip);
    const clipped = coversStrip ? [] : clipRings(rs, boxes.clip);
    if (!coversStrip && !clipped.length) continue;
    const [lon, lat] = coversStrip ? [mid.lon, mid.lat] : largestCentroid(clipped);
    const ha = Number(p.AREA_HA);
    out.push({
      list, id, name: tidyRegisterText(p.NAME), status: String(p.STATUS ?? '').trim(), address: p.ADDRESS ? tidyRegisterText(p.ADDRESS) : undefined,
      hectares: Number.isFinite(ha) && ha > 0 ? Math.round(ha * 100) / 100 : undefined, listed: isoDate(p.REGISTER_DATE ?? p.REGISTER), url: p.URL ? String(p.URL) : undefined,
      rings: clipped, coversStrip, lon, lat,
    });
  }
  return out;
}

export async function fetchListPlaces(list: HeritageListPlace['list'], extent: Extent): Promise<HeritageListPlace[]> {
  const l = LISTS[list];
  const fc = await queryByExtent(l.url, extent, l.fields, l.where, { maxAllowableOffset: '0.00002' });
  return listPlaces(list, fc.features, stripBoxes(extent));
}

// ---- all of it ---------------------------------------------------------------

export const EMPTY_COUNTRY: CountryData = {
  nativeTitle: { ok: false, atSite: [], inWindow: { determinations: 0, claims: 0, iluas: 0 } },
  places: [], placesRadiusM: 10_000, placesOk: false,
  vegetation: { ok: false, atSite: null, image: null, classes: [], source: 'NSW State Vegetation Type Map, pre-1750 plant community types (DCCEEW)' },
  water: { ok: false, courses: [], coastline: [] },
  lalcs: [], npws: [], dem: null, ridges: [],
  asdst: { ok: false, likelihood: null, surveyPriority: null, scaleMax: 999 },
  lepAboriginal: { ok: false, items: [] },
  lepAboriginalAreas: { ok: false, areas: [] },
  ahips: { ok: false, permits: [] },
  heritageLists: { read: { nhl: false, chl: false, rne: false }, places: [] },
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
  const [nativeTitle, places, vegetation, water, lalcs, npws, dem, asdst, lepItems, lepAreas, permits, nhl, chl, rne] = await Promise.all([
    soft(fetchNativeTitle(centreLL, extent), EMPTY_COUNTRY.nativeTitle, 'native title registers'),
    soft(fetchPlaces(centre, EMPTY_COUNTRY.placesRadiusM), null as AboriginalPlace[] | null, 'Aboriginal Places'),
    soft(fetchVegetation(extent, pxWidth, pxHeight, centreLL, outDir, log), EMPTY_COUNTRY.vegetation, 'pre-1750 vegetation'),
    soft(fetchWater(extent), EMPTY_COUNTRY.water, 'watercourses'),
    soft(fetchLalcs(extent), [] as LalcArea[], 'land council areas'),
    soft(fetchNpws(extent), [] as NpwsReserve[], 'NPWS estate'),
    soft(fetchDemGrid(extent, 8), null as DemGrid | null, 'wide elevation grid'),
    soft(fetchAsdst(centreLL), EMPTY_COUNTRY.asdst, 'ASDST model'),
    soft(fetchLepAboriginal(extent), null as LepAboriginalItem[] | null, 'LEP Aboriginal heritage items'),
    soft(fetchLepAboriginalAreas(extent), null as LepAboriginalArea[] | null, 'LEP Aboriginal landscape maps'),
    soft(fetchAhips(extent), null as AhipPermit[] | null, 'AHIP boundaries'),
    soft(fetchListPlaces('NHL', extent), null as HeritageListPlace[] | null, 'National Heritage List'),
    soft(fetchListPlaces('CHL', extent), null as HeritageListPlace[] | null, 'Commonwealth Heritage List'),
    soft(fetchListPlaces('RNE', extent), null as HeritageListPlace[] | null, 'Register of the National Estate'),
  ]);
  const ridges = dem ? ridgeLines(dem, { riseM: 1.0, reliefM: 4 }) : [];
  const listed = [...(nhl ?? []), ...(chl ?? []), ...(rne ?? [])];
  log(`  country timings: ${took.join(', ')}`);
  log(`  country: native-title at site:${nativeTitle.atSite.length} window:${nativeTitle.inWindow.determinations}/${nativeTitle.inWindow.claims}/${nativeTitle.inWindow.iluas} places:${places?.length ?? 'x'} veg:${vegetation.atSite?.pct ?? '—'} classes:${vegetation.classes.length} water:${water.courses.length} lalcs:${lalcs.length} npws:${npws.length} ridges:${ridges.length} asdst:${asdst.likelihood ?? '—'} lep-aboriginal:${lepItems?.length ?? 'x'}/${lepAreas?.length ?? 'x'} ahips:${permits?.length ?? 'x'} lists:${nhl?.length ?? 'x'}/${chl?.length ?? 'x'}/${rne?.length ?? 'x'}`);
  return {
    nativeTitle, places: places ?? [], placesRadiusM: EMPTY_COUNTRY.placesRadiusM, placesOk: places !== null, vegetation, water, lalcs, npws, dem, ridges, asdst,
    lepAboriginal: { ok: lepItems !== null, items: lepItems ?? [] },
    lepAboriginalAreas: { ok: lepAreas !== null, areas: lepAreas ?? [] },
    ahips: { ok: permits !== null, permits: permits ?? [] },
    heritageLists: { read: { nhl: nhl !== null, chl: chl !== null, rne: rne !== null }, places: listed },
    fetchedAt: new Date().toISOString(),
  };
}

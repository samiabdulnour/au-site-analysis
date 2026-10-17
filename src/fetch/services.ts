// Services next to the site: the pipes, pits, poles and lines a publisher
// releases under an open licence.
//
// What an office draws on a site analysis — water and sewer mains, gas,
// electrical cables, NBN and Telstra pits — comes from a Before You Dig
// enquiry, whose plans are each asset owner's and may not be copied. None of
// that is open: Sydney Water, Jemena, NBN and Telstra publish nothing, and
// Ausgrid nothing underground. What is open is listed here, and only where
// the publisher states the licence — a public layer with no licence statement
// (Parramatta's or Canterbury-Bankstown's stormwater, Essential Energy's
// network, Before You Dig's own Look Up and Live layers) is not permission to
// redraw it, and Endeavour Energy's ODbL label is contradicted by its portal's
// terms, which grant use only and require the data removed at the project's
// end. OpenStreetMap's services, ODbL, come with the street furniture.
//
// Adding a publisher is one entry in SERVICE_SOURCES: its layers, the bbox it
// covers, what each feature is and how it is labelled. Every sheet that draws
// these says they are not a substitute for a Before You Dig enquiry, as
// Geoscience Australia's licence asks.
//
// A source whose licence is still being settled carries `trial`: it is never
// fetched unless a run asks for it by id (SERVICES_TRIAL=endeavour, or the
// CLI's --trial-services endeavour), and the sheet names it as such. That is
// how Endeavour Energy is drawn while its portal's terms and its datasets'
// ODbL are reconciled in writing.

import { queryByExtent } from '../lib/arcgis.js';
import { retryFetch } from '../lib/http.js';
import { extentToLonLatBbox, type Extent } from '../lib/geo.js';

/** What a service feature is, as the office's legend names it. */
export type ServiceKind =
  | 'stormwater'      // stormwater pipe
  | 'stormwaterPit'   // drainage pit
  | 'lightPole'       // street light pole
  | 'powerHV'         // high-voltage transmission line
  | 'substation'      // zone, transmission or distribution substation
  | 'powerCable'      // distribution cable, underground
  | 'powerOverhead'   // distribution line, overhead
  | 'powerPole'       // network pole
  | 'pillar';         // low-voltage service pillar

export interface ServiceLine { kind: ServiceKind; coords: [number, number][]; label?: string; underground?: boolean; source: string }
export interface ServicePoint { kind: ServiceKind; lon: number; lat: number; label?: string; source: string }

export interface ServicesData {
  lines: ServiceLine[];
  points: ServicePoint[];
  /** The publishers that answered with something, for the legend and the data line. */
  sources: { id: string; name: string; attribution: string; count: number }[];
}

export const emptyServices = (): ServicesData => ({ lines: [], points: [], sources: [] });

interface ServiceLayer {
  /** What the feature is; a function where one layer holds several kinds (or null to leave a feature out). */
  kind: ServiceKind | ((get: (field: string) => any) => ServiceKind | null);
  /** An ArcGIS layer… */
  url?: string;
  fields?: string;
  /** …or an Opendatasoft dataset, read through its GeoJSON export with a bbox filter on its geo field. */
  ods?: { base: string; dataset: string; geoField: string };
  geometry: 'line' | 'point';
  /** The words beside the feature, from its attributes (keys as the service spells them, any case). */
  label?: (get: (field: string) => any) => string | undefined;
  underground?: (get: (field: string) => any) => boolean;
}

export interface ServiceSource {
  id: string;
  name: string;
  /** Printed on the sheet's data line, so the licence's attribution is met. */
  attribution: string;
  /** lon/lat bbox the publisher covers; a site outside it is never queried. Absent: everywhere. */
  extent?: { west: number; south: number; east: number; north: number };
  /** A licence still being settled: fetched only when a run names this source, and said so on the sheet. */
  trial?: string;
  layers: ServiceLayer[];
}

const ENDEAVOUR = 'https://data.endeavourenergy.com.au/api/explore/v2.1/catalog/datasets';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

export const SERVICE_SOURCES: ServiceSource[] = [
  {
    // CC BY 4.0, as each dataset's record on the council's open data hub states.
    id: 'cityofsydney',
    name: 'City of Sydney drainage and street lighting',
    attribution: 'Drainage and light poles © City of Sydney, CC BY 4.0',
    extent: { west: 151.17, south: -33.93, east: 151.24, north: -33.85 },
    layers: [
      {
        kind: 'stormwater', geometry: 'line',
        url: 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Drainage_pipes/FeatureServer/0',
        fields: 'Pipe_Diameter,Box_Width,Box_Height',
        // "Ø375", or a box culvert's "1200×600".
        label: (g) => { const d = num(g('Pipe_Diameter')), w = num(g('Box_Width')), h = num(g('Box_Height')); return d ? `Ø${d}` : w && h ? `${w}×${h}` : undefined; },
      },
      {
        kind: 'stormwaterPit', geometry: 'point',
        url: 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Drainage_pits/FeatureServer/0',
        fields: 'Invert_Level,Surface_Level',
        label: (g) => { const il = num(g('Invert_Level')); return il ? `IL ${il.toFixed(2)}` : undefined; },
      },
      {
        kind: 'lightPole', geometry: 'point',
        url: 'https://services1.arcgis.com/cNVyNtjGVZybOQWZ/arcgis/rest/services/Light_poles/FeatureServer/0',
        fields: 'Height',
      },
    ],
  },
  {
    // CC BY 4.0, as the service's item information states, with its note that
    // it is no substitute for Before You Dig or Look Up and Live.
    id: 'ga',
    name: 'Geoscience Australia electricity infrastructure',
    attribution: 'Power lines and substations © Commonwealth of Australia (Geoscience Australia), CC BY 4.0',
    layers: [
      {
        kind: 'powerHV', geometry: 'line',
        url: 'https://services.ga.gov.au/gis/rest/services/Electricity_Infrastructure/MapServer/2',
        fields: 'FEATURE_SUBTYPE,CAPACITY_KV,STATUS',
        label: (g) => { const kv = num(g('CAPACITY_KV')); return kv ? `${kv} kV` : undefined; },
        underground: (g) => /under/i.test(String(g('FEATURE_SUBTYPE') ?? '')),
      },
      {
        kind: 'substation', geometry: 'point',
        url: 'https://services.ga.gov.au/gis/rest/services/Electricity_Infrastructure/MapServer/0',
        fields: 'FEATURE_NAME,VOLTAGE_KV',
        label: (g) => String(g('FEATURE_NAME') ?? '').trim() || undefined,
      },
    ],
  },
  {
    // TRIAL. The poles, other assets and capacity datasets carry ODbL 1.0, the
    // conductors none, and the portal's terms grant use only, copies for
    // operations and backup, removal at the project's end. Drawn only when a
    // run asks for it, until Endeavour confirms in writing that the ODbL governs.
    id: 'endeavour',
    name: 'Endeavour Energy network',
    attribution: 'Electrical network © Endeavour Energy (trial: licence to be confirmed)',
    trial: 'licence to be confirmed',
    // Western Sydney, the Blue Mountains, the Illawarra and the Southern Highlands.
    extent: { west: 150.0, south: -35.0, east: 151.15, north: -33.4 },
    layers: [
      {
        geometry: 'line',
        ods: { base: ENDEAVOUR, dataset: 'conductors_hv_lv_sl_ug', geoField: 'geo_point_2d' },
        kind: (g) => (String(g('state') ?? '').toLowerCase() === 'removed' ? null : String(g('orientation')).toUpperCase() === 'OH' ? 'powerOverhead' : 'powerCable'),
        // The high-voltage runs carry their voltage ("… (UG) 11" is 11 kV); the low-voltage ones nothing, there are too many.
        label: (g) => {
          if (!/^high/i.test(String(g('conductor_type') ?? ''))) return undefined;
          const kv = String(g('conductor_description') ?? '').match(/\)\s*(\d+(?:\.\d+)?)\s*$/);
          return kv ? `${kv[1]} kV` : 'HV';
        },
      },
      { geometry: 'point', kind: 'powerPole', ods: { base: ENDEAVOUR, dataset: 'endeavourenergy_poles', geoField: 'geom' } },
      {
        geometry: 'point',
        ods: { base: ENDEAVOUR, dataset: 'networkassets_otherassets', geoField: 'geom' },
        kind: (g) => {
          const t = String(g('feature_type') ?? '');
          return /substation|switching/i.test(t) ? 'substation' : /pillar/i.test(t) ? 'pillar' : /column/i.test(t) ? 'lightPole' : null;
        },
        label: (g) => (/substation/i.test(String(g('feature_type') ?? '')) && g('asset_num') ? `DS ${g('asset_num')}` : undefined),
      },
      {
        // Each distribution substation's spare capacity today, as a label beside it.
        geometry: 'point', kind: 'substation',
        ods: { base: ENDEAVOUR, dataset: 'distribution-substation-available-capacity', geoField: 'geo_point_2d' },
        label: (g) => {
          const kva = Number(g('total_headroom_kva'));
          return Number.isFinite(kva) ? `${g('dsub_name') ?? 'DS'} · ${Math.round(kva)} kVA spare` : undefined;
        },
      },
    ],
  },
];

/** Every licensed source covering the extent, each layer queried on its own so one that fails costs only itself. */
/** The ids of the trial sources a run has asked for: SERVICES_TRIAL=endeavour,… */
export function trialServices(): string[] {
  return (process.env.SERVICES_TRIAL ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/** An Opendatasoft dataset's features in a lon/lat bbox, through its GeoJSON export. */
async function odsByBbox(ods: NonNullable<ServiceLayer['ods']>, b: { west: number; south: number; east: number; north: number }): Promise<{ geometry: any; properties: Record<string, any> }[]> {
  const where = `in_bbox(${ods.geoField},${b.south},${b.west},${b.north},${b.east})`;
  const res = await retryFetch(`${ods.base}/${ods.dataset}/exports/geojson?where=${encodeURIComponent(where)}`, {}, { attempts: 3, timeoutMs: 90_000, label: ods.dataset });
  if (!res.ok) throw new Error(`${ods.dataset} -> HTTP ${res.status}`);
  const fc = await res.json();
  return (fc.features ?? []).map((f: any) => ({ geometry: f.geometry, properties: f.properties ?? {} }));
}

/** Every licensed source covering the extent, and the trial sources a run has asked for, each layer queried on its own so one that fails costs only itself. */
export async function fetchServices(extent: Extent, log: (m: string) => void = () => {}, trial: string[] = trialServices()): Promise<ServicesData> {
  const out = emptyServices();
  const b = extentToLonLatBbox(extent);
  for (const src of SERVICE_SOURCES) {
    if (src.trial && !trial.includes(src.id)) continue;
    const x = src.extent;
    if (x && !(b.west <= x.east && b.east >= x.west && b.south <= x.north && b.north >= x.south)) continue;
    let count = 0;
    await Promise.all(src.layers.map(async (layer) => {
      try {
        const features = layer.ods ? await odsByBbox(layer.ods, b) : (await queryByExtent(layer.url!, extent, layer.fields)).features;
        for (const f of features) {
          if (!f.geometry) continue;
          // Services differ in the case they return field names in.
          const p = f.properties ?? {};
          const get = (k: string) => p[k] ?? p[k.toLowerCase()] ?? p[k.toUpperCase()];
          const kind = typeof layer.kind === 'function' ? layer.kind(get) : layer.kind;
          if (!kind) continue;
          const label = layer.label?.(get);
          if (layer.geometry === 'point' && f.geometry.type === 'Point') {
            const [lon, lat] = f.geometry.coordinates;
            out.points.push({ kind, lon, lat, label, source: src.id });
            count++;
          } else if (layer.geometry === 'line') {
            const paths: [number, number][][] = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [];
            for (const coords of paths) if (coords.length >= 2) out.lines.push({ kind, coords, label, underground: layer.underground?.(get), source: src.id });
            count += paths.length ? 1 : 0;
          }
        }
      } catch (e: any) {
        log(`  WARN ${src.name}, ${typeof layer.kind === 'string' ? layer.kind : layer.ods?.dataset}: ${e?.message ?? e}`);
      }
    }));
    if (count) out.sources.push({ id: src.id, name: src.trial ? `${src.name} (trial, ${src.trial})` : src.name, attribution: src.attribution, count });
  }
  out.points = mergeNear(out.points);
  return out;
}

/**
 * One feature told twice — Endeavour's substation asset and its capacity
 * record at the same kiosk — is one point: points of a kind from one source
 * within 12 m of each other merge, keeping the fuller label ("DS 837 · 744
 * kVA spare" over "DS 95375").
 */
function mergeNear(points: ServicePoint[]): ServicePoint[] {
  const out: ServicePoint[] = [];
  const m = 12 / 111_320;   // 12 m in degrees of latitude; longitude scaled by cos(lat) below
  for (const p of points) {
    const k = Math.cos((p.lat * Math.PI) / 180);
    const twin = out.find((q) => q.kind === p.kind && q.source === p.source && p.kind === 'substation' &&
      Math.hypot((q.lon - p.lon) * k, q.lat - p.lat) < m);
    if (!twin) { out.push({ ...p }); continue; }
    if ((p.label ?? '').length > (twin.label ?? '').length) twin.label = p.label;
  }
  return out;
}

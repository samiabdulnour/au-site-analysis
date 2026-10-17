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

import { queryByExtent } from '../lib/arcgis.js';
import { extentToLonLatBbox, type Extent } from '../lib/geo.js';

/** What a service feature is, as the office's legend names it. */
export type ServiceKind =
  | 'stormwater'      // stormwater pipe
  | 'stormwaterPit'   // drainage pit
  | 'lightPole'       // street light pole
  | 'powerHV'         // high-voltage transmission line
  | 'substation';     // zone or transmission substation

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
  kind: ServiceKind;
  url: string;
  fields: string;
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
  layers: ServiceLayer[];
}

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
];

/** Every licensed source covering the extent, each layer queried on its own so one that fails costs only itself. */
export async function fetchServices(extent: Extent, log: (m: string) => void = () => {}): Promise<ServicesData> {
  const out = emptyServices();
  const b = extentToLonLatBbox(extent);
  for (const src of SERVICE_SOURCES) {
    const x = src.extent;
    if (x && !(b.west <= x.east && b.east >= x.west && b.south <= x.north && b.north >= x.south)) continue;
    let count = 0;
    await Promise.all(src.layers.map(async (layer) => {
      try {
        const fc = await queryByExtent(layer.url, extent, layer.fields);
        for (const f of fc.features) {
          if (!f.geometry) continue;
          // Services differ in the case they return field names in.
          const p = f.properties ?? {};
          const get = (k: string) => p[k] ?? p[k.toLowerCase()] ?? p[k.toUpperCase()];
          const label = layer.label?.(get);
          if (layer.geometry === 'point' && f.geometry.type === 'Point') {
            const [lon, lat] = f.geometry.coordinates;
            out.points.push({ kind: layer.kind, lon, lat, label, source: src.id });
            count++;
          } else if (layer.geometry === 'line') {
            const paths: [number, number][][] = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [];
            for (const coords of paths) if (coords.length >= 2) out.lines.push({ kind: layer.kind, coords, label, underground: layer.underground?.(get), source: src.id });
            count += paths.length ? 1 : 0;
          }
        }
      } catch (e: any) {
        log(`  WARN ${src.name}, ${layer.kind}: ${e?.message ?? e}`);
      }
    }));
    if (count) out.sources.push({ id: src.id, name: src.name, attribution: src.attribution, count });
  }
  return out;
}

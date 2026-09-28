// Environmental constraints, for slide 14: what the State's hazard,
// protection, coastal and corridor layers map around the site, each with a
// definite answer — at the site, near it, none in the window, or not mapped
// by this LEP at all. The LEP layers on ePlanning hold only the maps a plan
// actually has (twelve plans map flood planning, five map airport noise), so
// an empty window is followed by one count query against the whole plan,
// and the slide can say "not mapped by this LEP" rather than leave a blank.

import { queryByExtent, queryByPoint, countWhere } from '../lib/arcgis.js';
import { lonLatToMercator, type Extent, type LonLat } from '../lib/geo.js';
import { geomRings } from './planning.js';

const M3 = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
const HAZ = `${M3}/ePlanning/Planning_Portal_Hazard/MapServer`;
const PROT = `${M3}/ePlanning/Planning_Portal_Protection/MapServer`;
const SEPP = `${M3}/ePlanning/Planning_Portal_SEPP/MapServer`;
const RH = `${M3}/Planning/SEPP_Resilience_and_Hazards_2021/MapServer`;
const ISEPP = `${M3}/ePlanning/SydneyTrain_ISEPP/MapServer`;
const SUBSIDENCE = `${M3}/ePlanning/Planning_Portal_Subsidence_Advisory/MapServer`;
const SOIL_SYDNEY = `${M3}/Soil_Landscape/Sydney/MapServer/2`;
/** The Sydney 1:100,000 soil landscape sheet, the one published as a service. */
const SOIL_SYDNEY_EXTENT = { west: 151.0, south: -34.0, east: 151.5, north: -33.5 };

export type ConstraintGroup = 'hazard' | 'soil' | 'water' | 'coast' | 'ecology' | 'aviation' | 'corridor';

export interface ConstraintSource {
  url: string;
  /** The field that classes the polygon (LAY_CLASS, ANEF_CODE, LABEL…); `fixedClass` when the layer is one thing. */
  classField?: string;
  fixedClass?: string;
  extraFields?: string[];
  /** The layer carries the plan fields (EPI_NAME, CURRENCY_DATE, AMENDMENT); a State layer without them rejects a query that names them. */
  epiFields?: boolean;
}

export interface ConstraintDef {
  id: string;
  title: string;
  group: ConstraintGroup;
  /** Which of the two maps draws it. */
  panel: 'A' | 'B';
  /** Drawn from the LEP's own map layers, so "not mapped by this LEP" is a possible answer. */
  epiBased: boolean;
  /** The instrument behind a State layer. */
  instrument?: string;
  /** What to say when the plan does not map it. */
  absentNote?: string;
  sources: ConstraintSource[];
}

export const CONSTRAINT_DEFS: ConstraintDef[] = [
  { id: 'bushfire', title: 'Bushfire prone land', group: 'hazard', panel: 'A', epiBased: false, instrument: 'NSW RFS bushfire prone land map', sources: [{ url: `${HAZ}/229`, classField: 'd_Category', extraFields: ['LastUpdate'] }] },
  { id: 'flood', title: 'Flood planning', group: 'hazard', panel: 'A', epiBased: true, absentNote: "for flood planning the council's flood study is the reference", sources: [{ url: `${HAZ}/230`, classField: 'LAY_CLASS' }] },
  { id: 'landslide', title: 'Landslide risk land', group: 'hazard', panel: 'A', epiBased: true, sources: [{ url: `${HAZ}/232`, classField: 'LAY_CLASS' }] },
  { id: 'subsidence', title: 'Mine subsidence district', group: 'hazard', panel: 'A', epiBased: false, instrument: 'Subsidence Advisory NSW', sources: [{ url: `${SUBSIDENCE}/248`, classField: 'DISTRICTNAME' }] },
  { id: 'ass', title: 'Acid sulfate soils', group: 'soil', panel: 'A', epiBased: true, sources: [{ url: `${PROT}/234`, classField: 'LAY_CLASS' }] },
  { id: 'salinity', title: 'Salinity', group: 'soil', panel: 'A', epiBased: true, sources: [{ url: `${PROT}/241`, classField: 'LAY_CLASS' }] },
  { id: 'mineral', title: 'Mineral and resource land', group: 'soil', panel: 'A', epiBased: true, sources: [{ url: `${PROT}/238`, classField: 'LAY_CLASS' }] },
  { id: 'groundwater', title: 'Groundwater vulnerability', group: 'water', panel: 'A', epiBased: true, sources: [{ url: `${PROT}/237`, classField: 'LAY_CLASS' }] },
  { id: 'drinkingWater', title: 'Drinking water catchment', group: 'water', panel: 'A', epiBased: true, sources: [{ url: `${PROT}/236`, classField: 'LAY_CLASS' }] },
  { id: 'riparian', title: 'Riparian land and watercourses', group: 'water', panel: 'B', epiBased: true, sources: [240, 1024, 784, 751, 740, 590].map((n) => ({ url: `${PROT}/${n}`, classField: 'LAY_CLASS' })) },
  { id: 'wetlands', title: 'Wetlands', group: 'water', panel: 'B', epiBased: true, sources: [{ url: `${PROT}/244`, classField: 'LAY_CLASS' }] },
  { id: 'coastalWetlands', title: 'Coastal wetlands and littoral rainforest', group: 'coast', panel: 'B', epiBased: false, instrument: 'SEPP (Resilience and Hazards) 2021', sources: [{ url: `${RH}/3`, classField: 'LABEL', epiFields: true }, { url: `${RH}/4`, classField: 'LABEL', epiFields: true }] },
  { id: 'coastalEnvironment', title: 'Coastal environment area', group: 'coast', panel: 'B', epiBased: false, instrument: 'SEPP (Resilience and Hazards) 2021', sources: [{ url: `${RH}/6`, fixedClass: 'Coastal environment area', epiFields: true }] },
  { id: 'coastalUse', title: 'Coastal use area', group: 'coast', panel: 'B', epiBased: false, instrument: 'SEPP (Resilience and Hazards) 2021', sources: [{ url: `${RH}/7`, fixedClass: 'Coastal use area', epiFields: true }] },
  { id: 'biodiversity', title: 'Biodiversity', group: 'ecology', panel: 'B', epiBased: true, sources: [{ url: `${PROT}/243`, fixedClass: 'Terrestrial biodiversity' }, { url: `${PROT}/768`, classField: 'LAY_CLASS' }, { url: `${PROT}/591`, fixedClass: 'Biodiversity' }] },
  { id: 'sensitiveLand', title: 'Environmentally sensitive land', group: 'ecology', panel: 'B', epiBased: true, sources: [{ url: `${PROT}/245`, classField: 'LAY_CLASS' }, { url: `${PROT}/604`, classField: 'LAY_CLASS' }, { url: `${PROT}/737`, fixedClass: 'Natural resource sensitivity' }] },
  { id: 'scenic', title: 'Scenic protection land', group: 'ecology', panel: 'B', epiBased: true, sources: [{ url: `${PROT}/242`, fixedClass: 'Scenic protection land' }] },
  { id: 'airportNoise', title: 'Airport noise', group: 'aviation', panel: 'B', epiBased: true, absentNote: "for airport noise the airport's published ANEF contours", sources: [{ url: `${PROT}/235`, classField: 'ANEF_CODE' }] },
  { id: 'ols', title: 'Obstacle limitation surface', group: 'aviation', panel: 'B', epiBased: true, sources: [{ url: `${PROT}/239`, classField: 'LABEL', extraFields: ['MINIMUM_HEIGHT', 'MAXIMUM_HEIGHT'] }] },
  { id: 'railCorridor', title: 'Rail corridor protection', group: 'corridor', panel: 'B', epiBased: false, instrument: 'SEPP (Transport and Infrastructure) 2021', sources: [{ url: `${ISEPP}/1`, fixedClass: 'Corridor protection zone' }, { url: `${ISEPP}/2`, fixedClass: 'Infrastructure protection zone' }, { url: `${SEPP}/745`, fixedClass: 'Sydney Metro corridor protection zone' }] },
  { id: 'futureCorridor', title: 'Future infrastructure corridor', group: 'corridor', panel: 'B', epiBased: false, instrument: 'SEPP (Transport and Infrastructure) 2021', sources: [{ url: `${SEPP}/792`, classField: 'LAY_CLASS', epiFields: true }, { url: `${SEPP}/793`, classField: 'LAY_CLASS', epiFields: true }] },
];

export interface ConstraintFeature {
  cls: string;
  epi?: string;
  /** Map currency, ISO date. */
  currency?: string;
  amendment?: string;
  rings: number[][][];
  source: string;
}

export interface ConstraintLayer {
  id: string;
  features: ConstraintFeature[];
  /** Sources that did not answer. */
  errors: string[];
  /** For a plan's own map with nothing in the window: does the plan map it anywhere? null until checked, or when the check failed. */
  lepMapsAny: boolean | null;
}

export interface SoilLandscape { name: string; process: string; code: string; sheet: string }

export interface ConstraintsData {
  layers: ConstraintLayer[];
  soil: SoilLandscape | null;
  soilNote?: string;
  /** The plan the coverage check was made against. */
  epiChecked?: string;
  fetchedAt: string;
}

const isoDate = (ms: unknown) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().slice(0, 10) : undefined; };

function classOf(src: ConstraintSource, p: Record<string, any>): string {
  if (src.fixedClass) return src.fixedClass;
  const raw = String(p[src.classField ?? ''] ?? '').trim();
  if (src.classField === 'ANEF_CODE') return raw === 'RUNWAY' ? 'Runway' : /^\d/.test(raw) ? `ANEF ${raw.replace(/\s*-\s*/, '–').replace(/\s*\+$/, '+')}` : raw;
  if (src.classField === 'LABEL' && src.url.includes('/239')) {
    const lo = p.MINIMUM_HEIGHT, hi = p.MAXIMUM_HEIGHT;
    return raw || (lo != null || hi != null ? `${lo ?? '?'}–${hi ?? '?'} m` : 'Obstacle limitation surface');
  }
  return raw || 'Mapped';
}

async function fetchLayer(def: ConstraintDef, extent: Extent, log: (m: string) => void): Promise<ConstraintLayer> {
  const features: ConstraintFeature[] = [];
  const errors: string[] = [];
  await Promise.all(def.sources.map(async (src) => {
    const epiFields = src.epiFields ?? def.epiBased;
    const fields = [...new Set([src.classField, ...(epiFields ? ['EPI_NAME', 'CURRENCY_DATE', 'AMENDMENT'] : []), ...(src.extraFields ?? [])].filter(Boolean))].join(',') || '*';
    try {
      const fc = await queryByExtent(src.url, extent, fields);
      for (const f of fc.features) {
        const rings = geomRings(f.geometry);
        if (!rings.length) continue;
        const p = f.properties;
        features.push({
          cls: classOf(src, p), epi: p.EPI_NAME ? String(p.EPI_NAME) : undefined,
          currency: isoDate(p.CURRENCY_DATE) ?? isoDate(p.LastUpdate), amendment: p.AMENDMENT ? String(p.AMENDMENT) : undefined,
          rings, source: src.url.replace(M3 + '/', ''),
        });
      }
    } catch (e: any) {
      errors.push(src.url.replace(M3 + '/', ''));
      log(`  WARN constraint ${def.id} (${src.url.split('/').slice(-3).join('/')}) failed: ${e?.message ?? e}`);
    }
  }));
  return { id: def.id, features, errors, lepMapsAny: null };
}

async function fetchSoil(centre: LonLat, log: (m: string) => void): Promise<{ soil: SoilLandscape | null; soilNote?: string }> {
  const e = SOIL_SYDNEY_EXTENT;
  if (centre.lon < e.west || centre.lon > e.east || centre.lat < e.south || centre.lat > e.north) return { soil: null, soilNote: 'outside the Sydney 1:100,000 soil landscape sheet, the one published as a service' };
  try {
    const fc = await queryByPoint(SOIL_SYDNEY, lonLatToMercator(centre), 'NAME,PROCESS,LANDSCAPE,CODE');
    const p = fc.features[0]?.properties;
    if (!p) return { soil: null, soilNote: 'no soil landscape polygon at the site on the Sydney sheet' };
    return { soil: { name: String(p.NAME ?? ''), process: String(p.PROCESS ?? ''), code: String(p.LANDSCAPE ?? p.CODE ?? ''), sheet: 'Sydney 1:100,000' } };
  } catch (err: any) {
    log(`  WARN soil landscape failed: ${err?.message ?? err}`);
    return { soil: null, soilNote: 'the soil landscape service did not answer' };
  }
}

/** Every constraint layer over the window, and the soil landscape at the site. */
export async function fetchConstraints(extent: Extent, centre: LonLat, log: (m: string) => void = () => {}): Promise<ConstraintsData> {
  const [layers, soil] = await Promise.all([Promise.all(CONSTRAINT_DEFS.map((d) => fetchLayer(d, extent, log))), fetchSoil(centre, log)]);
  const present = layers.filter((l) => l.features.length).map((l) => `${l.id}:${l.features.length}`);
  log(`  constraints: ${present.length ? present.join(' ') : 'none in the window'}${layers.some((l) => l.errors.length) ? ` (failed: ${layers.filter((l) => l.errors.length).map((l) => l.id).join(', ')})` : ''}; soil: ${soil.soil ? `${soil.soil.name} (${soil.soil.process.toLowerCase()})` : soil.soilNote}`);
  return { layers, ...soil, fetchedAt: new Date().toISOString() };
}

/**
 * For each of the plan's own maps with nothing in the window, ask whether the
 * plan maps it anywhere at all, so the slide can distinguish "none here" from
 * "this LEP has no such map".
 */
export async function checkLepCoverage(data: ConstraintsData, epiNames: string[], log: (m: string) => void = () => {}): Promise<void> {
  const names = [...new Set(epiNames.filter(Boolean))];
  if (!names.length) return;
  const where = `EPI_NAME IN (${names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})`;
  data.epiChecked = names[0];
  await Promise.all(data.layers.map(async (layer) => {
    const def = CONSTRAINT_DEFS.find((d) => d.id === layer.id);
    if (!def?.epiBased || layer.features.length) return;
    try {
      const counts = await Promise.all(def.sources.map((s) => countWhere(s.url, where)));
      layer.lepMapsAny = counts.some((n) => n > 0);
    } catch (e: any) {
      log(`  WARN constraint coverage check ${layer.id} failed: ${e?.message ?? e}`);
    }
  }));
  const none = data.layers.filter((l) => l.lepMapsAny === false).map((l) => l.id);
  const elsewhere = data.layers.filter((l) => l.lepMapsAny === true).map((l) => l.id);
  log(`  constraints: ${names.join(' + ')} maps elsewhere: ${elsewhere.join(', ') || 'none'}; not at all: ${none.join(', ') || 'none'}`);
}

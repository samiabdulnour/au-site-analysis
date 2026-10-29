"""The capacity and opportunity site study's reading of the window: every property around the site
classified by ownership (single title, strata scheme and its size, council, State), by heritage listing,
by when it was last significantly developed, and by what is approved or under construction on it; then
a tick or a cross on each.

    python3 -I scripts/capacity_study/analyse.py out/capacity/<slug>

Reads bundle.json and da.json as scripts/capacity_study.ts writes them; writes analysis.json beside them.
Pure Python, no packages: the geometry is a few hundred polygons.
"""
import collections, datetime, json, math, re, sys

OUT = sys.argv[1]
b = json.load(open(f'{OUT}/bundle.json'))
da = json.load(open(f'{OUT}/da.json'))
# What the author knows that the data does not: an overrides.json beside the bundle, keyed by the start of a
# property's address as the register writes it ("121-129 CROWN STREET"), each {"symbol": "mature" | "none" |
# "potential", "note": "built 2019"}. A building put up on a single title before the council's register begins
# (2021) has no open-data date, and this is where the author says so.
try:
    overrides = {k.upper().strip(): v for k, v in json.load(open(f'{OUT}/overrides.json')).items()}
except FileNotFoundError:
    overrides = {}

# ---- geometry, in Web Mercator metres ------------------------------------------------------------
R = 20037508.342789244
K = b['k']  # mercator metres per ground metre at the site


def merc(lon, lat):
    return (lon * R / 180, math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * R / 180)


def rings_m(geom):
    """A GeoJSON (Multi)Polygon's rings in mercator metres."""
    if not geom:
        return []
    if geom['type'] == 'Polygon':
        rr = geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        rr = [r for p in geom['coordinates'] for r in p]
    else:
        return []
    return [[merc(*p[:2]) for p in r] for r in rr]


def area(ring):
    # about the first vertex: at Web Mercator magnitudes the raw shoelace terms cancel to the last digits of a double
    x0, y0 = ring[0]
    s = 0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] - x0, ring[i][1] - y0
        x2, y2 = ring[(i + 1) % len(ring)][0] - x0, ring[(i + 1) % len(ring)][1] - y0
        s += x1 * y2 - x2 * y1
    return s / 2


def centroid(ring):
    a = area(ring)
    if abs(a) < 1e-6:
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    x0, y0 = ring[0]
    cx = cy = 0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] - x0, ring[i][1] - y0
        x2, y2 = ring[(i + 1) % len(ring)][0] - x0, ring[(i + 1) % len(ring)][1] - y0
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return (x0 + cx / (6 * a), y0 + cy / (6 * a))


def pip(pt, ring):
    x, y = pt
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


def outer(rings):
    return max(rings, key=lambda r: abs(area(r)))


def in_poly(pt, rings):
    if not rings:
        return False
    o = outer(rings)
    if not pip(pt, o):
        return False
    return not any(pip(pt, r) for r in rings if r is not o)


def ground_m2(rings):
    return abs(area(outer(rings))) / (K * K) if rings else 0


def dist_pt_seg(p, a1, a2):
    (x, y), (x1, y1), (x2, y2) = p, a1, a2
    dx, dy = x2 - x1, y2 - y1
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def shared_m(r1, r2, tol=0.3):
    """Ground metres of r1's boundary that lie along r2's."""
    ring1, ring2 = outer(r1), outer(r2)

    def near(p):
        return min(dist_pt_seg(p, ring2[i], ring2[(i + 1) % len(ring2)]) for i in range(len(ring2))) < tol
    L = 0
    for i in range(len(ring1)):
        p, q = ring1[i], ring1[(i + 1) % len(ring1)]
        if near(p) and near(q):
            L += math.hypot(p[0] - q[0], p[1] - q[1])
    return L / K


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).strftime('%Y-%m-%d') if ms else None


# ---- the property register: one record per propid, its unit addresses counted ----------------------
props = {}
for f in b['props']['features']:
    p = f['properties']
    pid = p.get('propid')
    if pid is None:
        continue
    rec = props.setdefault(pid, {'propid': pid, 'addresses': set(), 'unitSet': set(), 'geom': None, 'valtype': set(),
                                 'lotcount': p.get('valnetlotcount') or 0})
    addr = (p.get('address') or '').strip()
    if addr:
        rec['addresses'].add(addr)
        if '/' in addr:
            rec['unitSet'].add(addr.split(' ')[0])
    if p.get('valnetpropertytype') is not None:
        rec['valtype'].add(p['valnetpropertytype'])
    g = rings_m(f['geometry'])
    if g and (rec['geom'] is None or ground_m2(g) > ground_m2(rec['geom'])):
        rec['geom'] = g
for r in props.values():
    r['addresses'] = sorted(r['addresses'], key=lambda s: ('/' in s, s))
    r['units'] = len(r.pop('unitSet'))
    r['valtype'] = sorted(r['valtype'])
    r['base'] = next((s for s in r['addresses'] if '/' not in s), r['addresses'][0] if r['addresses'] else '')
    r['areaM2'] = round(ground_m2(r['geom'])) if r['geom'] else 0
    r['centroid'] = centroid(outer(r['geom'])) if r['geom'] else None

# ---- the cadastre's lots, each linked to the property that holds its centroid --------------------
lots = []
for f in b['lots']['features']:
    p = f['properties']
    rings = rings_m(f['geometry'])
    if not rings:
        continue
    # the cadastre's record date is the plan's registration date for plans after the digital cadastre was built
    # (September 1993); every older plan carries that build date, which is left as unknown
    created = iso(p.get('createdate'))
    lots.append({'id': p['lotidstring'], 'plan': p['planlabel'], 'lotnumber': p['lotnumber'], 'sub': p['classsubtype'],
                 'planArea': p['planlotarea'], 'planAreaUnits': p['planlotareaunits'], 'rings': rings,
                 'areaM2': round(ground_m2(rings)), 'centroid': centroid(outer(rings)),
                 'registered': created if created and created >= '1994-01-01' else None})
for l in lots:
    l['propid'] = next((pid for pid, r in props.items() if r['geom'] and in_poly(l['centroid'], r['geom'])), None)
sp_under = collections.defaultdict(list)
sp_registered = {}
for l in lots:
    if l['propid'] is not None and (l['plan'] or '').startswith('SP'):
        sp_under[l['propid']].append(l['id'])
        if l['registered']:
            sp_registered[l['propid']] = max(sp_registered.get(l['propid'], ''), l['registered'])

# ---- the overlays ----------------------------------------------------------------------------------
heritage_items = [(f['properties'], rings_m(f['geometry'])) for f in b['heritage']['features'] if str(f['properties'].get('LAY_CLASS', '')).startswith('Item')]
hca = [(f['properties'], rings_m(f['geometry'])) for f in b['heritage']['features'] if str(f['properties'].get('LAY_CLASS', '')).startswith('Conservation')]
state_land = [(f['properties'], rings_m(f['geometry'])) for f in b['stateLand']['features']]
parks = [(f['properties'], rings_m(f['geometry'])) for f in b['parks']['features'] if f.get('geometry')]
facilities = [(f['properties'], merc(*f['geometry']['coordinates'][:2])) for f in b['facilities']['features'] if f.get('geometry')]
devmon = []
for f in b['devMon']['features']:
    p = f['properties']
    rings = rings_m(f['geometry'])
    if not rings:
        continue
    devmon.append({'address': f"{p.get('StNumber') or ''} {p.get('StName') or ''}".strip(), 'da': p.get('DA_Number'), 'type': p.get('DevelopmentType') or '',
                   'use': p.get('MajorUse'), 'status': p.get('Status_1') or '', 'lodged': iso(p.get('Lodged')), 'determined': iso(p.get('Determined')),
                   'completion': iso(p.get('Completion')), 'dwellings': p.get('Priv_Dwgs') or 0, 'levels': p.get('LevelsAbove') or 0,
                   'gfa': p.get('GFA') or 0, 'rings': rings, 'extracted': iso(p.get('DateExtracted'))})


def major(d):
    """A development that changes the built form: a new building, or an addition or conversion of four storeys, five dwellings or 1,000 m² of floor space."""
    return d['type'] == 'New Building' or (d['type'] in ('Addition', 'Conversion') and (d['levels'] >= 4 or d['dwellings'] >= 5 or d['gfa'] >= 1000))


# Live applications on the Planning Portal of a scale that shapes context (the same test as src/fetch/da.ts),
# leaving out alterations to what already stands.
HOUSE = re.compile(r'dual occupancy|dwelling|secondary|alteration|addition|swimming pool|demolition|tree|sign|fence|change of use|garage|carport|shed|deck|pergola|balcon|awning|subdivision|strata|torrens|earthworks|retaining|studio|granny|patio|terrace|verandah|pool', re.I)
NEWB = re.compile(r'residential flat|shop top|mixed use|boarding|co-?living|multi.?dwelling|seniors|apartment|build.to.rent|erection of a new|hotel|motel|office|commercial|educational|school|hospital|health|industrial|warehouse|student|manor|town ?house|retail|shop|serviced|centre|club|place of public|pub\b|data centre|infrastructure', re.I)
ALTER = re.compile(r'alteration|addition|fitout|fit-out|change of use|use of', re.I)


def significant(r):
    st, dw, cost = r.get('storeys') or 0, r.get('dwellings') or 0, r.get('cost') or 0
    types = r['developmentTypes']
    house_only = bool(types) and all(HOUSE.search(t) and not NEWB.search(t) for t in types)
    if house_only:
        return dw >= 10 and 2e6 <= cost <= 2e9
    if cost > 2e9:
        return st >= 4 or dw >= 10
    return st >= 4 or dw >= 10 or cost >= 5e6


live_das = [dict(r, pt=merc(r['lon'], r['lat'])) for r in da['near']
            if r['statusClass'] == 'active' and significant(r)
            and not (any(ALTER.search(t) for t in r['developmentTypes']) and (r.get('dwellings') or 0) < 10 and (r.get('storeys') or 0) < 4)]

# ---- the classification ------------------------------------------------------------------------------
STRATA_MAX = b.get('strataMax', 30)       # a scheme above this is taken as too fragmented to assemble
RECENT_YEARS = b.get('recentYears', 20)   # a site significantly developed within these years is not coming down
SMALL_SCHEME = b.get('smallScheme', 5)    # a strata scheme under this many lots is not, by itself, a significant development
THIS_YEAR = int((b.get('fetchedAt') or datetime.datetime.now(datetime.UTC).isoformat())[:4])
SINCE = THIS_YEAR - RECENT_YEARS
site_pt = (b['centre']['x'], b['centre']['y'])
for r in props.values():
    if not r['geom']:
        r['kind'] = 'unknown'
        r['mark'] = None
        r['why'] = []
        continue
    c = r['centroid']
    # strata where the cadastre holds a strata plan under the property, where the register files its addresses as
    # under a strata plan (schemes on stratum lots), or where three or more unit addresses share the title; the
    # register's unit addresses size the scheme. One or two unit addresses on a deposited plan stay single ownership.
    r['strataPlans'] = sp_under.get(r['propid'], [])
    r['strata'] = bool(r['strataPlans']) or 4 in r['valtype'] or r['units'] >= 3
    if r['strataPlans']:
        r['units'] = max(r['units'], r['lotcount'])
    r['heritageItem'] = next((h[0].get('H_NAME') or 'Heritage item' for h in heritage_items if in_poly(c, h[1])), None)
    r['inHCA'] = next((h[0].get('H_NAME') for h in hca if in_poly(c, h[1])), None)
    r['stateLand'] = any(in_poly(c, s[1]) for s in state_land)
    r['park'] = next((p[0].get('Name') for p in parks if in_poly(c, p[1])), None)
    r['facility'] = next((p[0].get('Name') for p in facilities if in_poly(p[1], r['geom'])), None)
    r['devmon'] = [d for d in devmon if in_poly(c, d['rings']) or in_poly(centroid(outer(d['rings'])), r['geom'])]
    r['liveDa'] = [dict(pan=d['pan'], status=d['status'], lodged=d['lodged'], address=d['address'], cost=d.get('cost'), storeys=d.get('storeys'), dwellings=d.get('dwellings')) for d in live_das if in_poly(d['pt'], r['geom'])]
    r['active'] = [d for d in r['devmon'] if d['status'] in ('Lodged', 'Approved', 'Construction Commenced') and major(d)]
    r['recent'] = [d for d in r['devmon'] if d['status'] == 'Completed' and d['completion'] and int(d['completion'][:4]) >= SINCE and major(d)]
    # when the property was last significantly developed: a major development the council's register saw completed,
    # or the registration of a strata scheme of SMALL_SCHEME or more lots, which follows a new building or a
    # substantial conversion (the register reaches back a few years; a strata plan's date reaches back to 1993)
    r['strataRegistered'] = sp_registered.get(r['propid'])
    developed = []
    for d in r['recent']:
        developed.append({'year': int(d['completion'][:4]), 'how': 'built', 'detail': f"{d['type'].lower()} completed {d['completion'][:4]}, {d['da']}"})
    if r['strataRegistered'] and int(r['strataRegistered'][:4]) >= SINCE and r['units'] >= SMALL_SCHEME:
        developed.append({'year': int(r['strataRegistered'][:4]), 'how': 'strata', 'detail': f"strata scheme of {r['units']} lots registered {r['strataRegistered'][:4]}"})
    r['developed'] = max(developed, key=lambda d: d['year']) if developed else None
    r['override'] = next((v for k, v in overrides.items() if r['base'].startswith(k)), None)
    r['isSite'] = in_poly(site_pt, r['geom'])
    if r['isSite']:
        r['kind'] = 'site'
    elif r['park'] or r['facility']:
        r['kind'] = 'council'
    elif r['stateLand']:
        r['kind'] = 'state'
    elif r['active'] or r['liveDa']:
        r['kind'] = 'developing'
    elif r['strata']:
        r['kind'] = 'strata'
    else:
        r['kind'] = 'single'
    reasons = []
    if r['kind'] in ('strata', 'single'):
        if r['strata'] and r['units'] > STRATA_MAX:
            reasons.append(f'strata scheme of {r["units"]} lots')
        if r['heritageItem']:
            reasons.append('heritage item')
        if r['developed']:
            reasons.append(f"developed {r['developed']['year']}")
        r['mark'] = 'x' if reasons else 'tick'
    else:
        r['mark'] = None
    r['why'] = reasons

site = next((r for r in props.values() if r.get('isSite')), None)
if site is None:
    sys.exit('the site falls in no property polygon')
site['lots'] = [l['id'] for l in lots if l['propid'] == site['propid']]
site['neighbours'] = sorted(
    ({'propid': r['propid'], 'base': r['base'], 'kind': r['kind'], 'units': r['units'], 'strata': r['strata'], 'heritageItem': r['heritageItem'], 'sharedM': round(shared_m(r['geom'], site['geom']), 1)}
     for r in props.values() if r['geom'] and r is not site and math.hypot(r['centroid'][0] - site['centroid'][0], r['centroid'][1] - site['centroid'][1]) / K < 120),
    key=lambda n: -n['sharedM'])
site['neighbours'] = [n for n in site['neighbours'] if n['sharedM'] >= 3]

out = {
    'k': K, 'extent': b['extent'], 'centre': b['centre'], 'aerial': b['aerial'], 'imagery': b.get('imagery'), 'controls': b.get('controls'),
    'meta': b.get('meta', {}), 'fetchedAt': b.get('fetchedAt'), 'strataMax': STRATA_MAX, 'recentYears': RECENT_YEARS, 'since': SINCE, 'smallScheme': SMALL_SCHEME,
    'props': {str(k): v for k, v in props.items()}, 'lots': lots,
    'heritageItems': [{'name': h[0].get('H_NAME'), 'sig': h[0].get('SIG'), 'rings': h[1]} for h in heritage_items],
    'hca': [{'name': h[0].get('H_NAME'), 'rings': h[1]} for h in hca],
    'stateLand': [{'label': s[0].get('LOTREF'), 'rings': s[1]} for s in state_land],
    'parks': [{'name': p[0].get('Name'), 'rings': p[1]} for p in parks],
    'devmon': devmon, 'liveDas': live_das,
    'roads': [{'name': f['properties'].get('roadnamelabel'),
               'paths': [[merc(*p) for p in path] for path in (f['geometry']['coordinates'] if f['geometry'] and f['geometry']['type'] == 'MultiLineString' else [f['geometry']['coordinates']] if f['geometry'] else [])]}
              for f in b['roadNames']['features']],
}
json.dump(out, open(f'{OUT}/analysis.json', 'w'))
kinds = collections.Counter(r['kind'] for r in props.values())
marks = collections.Counter(r['mark'] for r in props.values() if r['mark'])
print(f"{len(props)} properties: {dict(kinds)}; marks {dict(marks)}; overrides {sum(1 for r in props.values() if r.get('override'))}; site {site['base']} {site['areaM2']} m² {site['lots']}; "
      f"neighbours {[(n['base'], n['sharedM']) for n in site['neighbours']]}; lots unlinked {sum(1 for l in lots if l['propid'] is None)}")

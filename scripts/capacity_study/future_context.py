"""Draw the future-context scenarios over a capacity study: one A3 landscape sheet per scenario, a plan at 1:500 on
the clean aerial beside an axonometric massing and an indicative yield, the three sheets numbered in turn.

    python3 -I scripts/capacity_study/future_context.py out/capacity/<slug> scenarios.json

Reads analysis.json (the context plan's reading: every property with its polygon, the lots, the roads, all in
Web Mercator) and future.json (what scripts/future_context.ts fetched for the study: the sharp aerial over the
study window, the LEP's height and floor space ratio layers, and the height the 3D tiles give each property).
The scenarios file names the parcels by the start of their address as the register writes it, and each building
by its footprint type, its storeys and the line its long axis follows; the footprint itself is fitted here to the
real parcel. Needs shapely and Pillow (pip3 install shapely pillow). Writes future-<n>.html, future_base.jpg and
future-page.json beside analysis.json; scripts/future_context.ts prints them.
"""
import html as H, json, math, re, sys
import numpy as np
from PIL import Image, ImageEnhance
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import nearest_points, unary_union

OUT, SCEN = sys.argv[1], sys.argv[2]
a = json.load(open(f'{OUT}/analysis.json'))
fu = json.load(open(f'{OUT}/future.json'))
sc = json.load(open(SCEN))
K = a['k']
SITE = next(r for r in a['props'].values() if r.get('isSite'))
CX, CY = SITE['centroid']
R_MERC = 20037508.342789244

# ---- the frame: metres east and north of the site's centroid -----------------------------------------------------
def loc(p):
    return ((p[0] - CX) / K, (p[1] - CY) / K)


def loc_ll(lon, lat):
    """A lon/lat point in the frame, through Web Mercator as src/lib/geo.ts goes."""
    return loc((lon * R_MERC / 180, math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180) * (R_MERC / 180)))


def poly_of(rings, ll=False):
    """A polygon from rings (outer first, holes inside it, further outer rings as more parts)."""
    conv = (lambda r: [loc_ll(*p[:2]) for p in r]) if ll else (lambda r: [loc(p) for p in r])
    parts = []
    for r in sorted(rings, key=lambda r: -abs(Polygon(conv(r)).area) if len(r) >= 3 else 0):
        if len(r) < 3:
            continue
        p = Polygon(conv(r)).buffer(0)
        if p.is_empty:
            continue
        for i, q in enumerate(parts):
            if q.contains(p.representative_point()):
                parts[i] = q.difference(p)
                break
        else:
            parts.append(p)
    return unary_union(parts) if parts else Polygon()


def polys(g):
    return [g] if g.geom_type == 'Polygon' else [p for p in g.geoms if p.geom_type == 'Polygon'] if hasattr(g, 'geoms') else []


def largest(g):
    ps = polys(g)
    return max(ps, key=lambda p: p.area) if ps else Polygon()


# ---- the properties, by address ----------------------------------------------------------------------------------
PROPS = {}
for pid, r in a['props'].items():
    if r['geom']:
        PROPS[pid] = dict(r, poly=poly_of(r['geom']))


def prop(address):
    hits = [r for r in PROPS.values() if r['base'] == address or r['base'].startswith(address + ' ')]
    if not hits:
        sys.exit(f'no property at {address} in {OUT}/analysis.json')
    return max(hits, key=lambda r: r['areaM2'] or 0)


def norm_road(name):
    return re.sub(r'\b(ST|LN|RD|PL|AVE|PDE)\b', lambda m: {'ST': 'STREET', 'LN': 'LANE', 'RD': 'ROAD', 'PL': 'PLACE', 'AVE': 'AVENUE', 'PDE': 'PARADE'}[m.group(1)], (name or '').upper().strip())


ROADS = {}
for rd in a['roads']:
    for p in rd['paths']:
        if len(p) >= 2:
            ROADS.setdefault(norm_road(rd['name']), []).append(LineString([loc(q) for q in p]))

# the LEP's height and floor space ratio over each parcel, from the layers fetched over the study
HOB = [(poly_of([ring for ring in (f['geometry']['coordinates'] if f['geometry']['type'] == 'Polygon' else [r for pp in f['geometry']['coordinates'] for r in pp])], ll=True), f['properties']) for f in fu.get('hob', {}).get('features', []) if f.get('geometry')]
FSR = [(poly_of([ring for ring in (f['geometry']['coordinates'] if f['geometry']['type'] == 'Polygon' else [r for pp in f['geometry']['coordinates'] for r in pp])], ll=True), f['properties']) for f in fu.get('fsr', {}).get('features', []) if f.get('geometry')]


def control(layer, g, field):
    p = g.representative_point()
    for poly, props in layer:
        if poly.contains(p):
            v = props.get(field)
            return float(v) if v not in (None, '') else None
    return None


# the heights the 3D tiles read for each property: storeys at the repo's 3.1 m
STOREY_M = 3.1
HEIGHTS = fu.get('heights') or {}
MESH = fu.get('mesh') or {}
ASSUMED_STOREYS = 6


def measured(r):
    h = HEIGHTS.get(str(r['propid']))
    return h['heightM'] if h and h.get('heightM') else None


def storeys_of(r):
    h = measured(r)
    return max(1, round(h / STOREY_M)) if h else None


# ---- the site and the parity it sets ---------------------------------------------------------------------------
SITE_AREA = SITE['areaM2']
S = sc['site']
UNIT_GFA = 85
SITE_UNITS = S.get('units') or 100
SITE_GFA = S.get('gfaM2') or SITE_UNITS * UNIT_GFA
FSR_PAR = SITE_GFA / SITE_AREA
EFFICIENCY = 0.75


def H_of(n):
    return 4.5 + 3.2 * (n - 1)


# ---- footprints -------------------------------------------------------------------------------------------------
MAX_LEN = 45
DEPTH = dict(single=12, d18=18, d22=22)
TYPE = dict(single='Single loaded, 12 m', d18='Double loaded, 18 m', d22='Double loaded, 22 m', block='Full-lot block', consent='As approved', podium='Podium')
C = dict(single='#9c7273', d18='#e3d6cb', d22='#a995ad', block='#8fa3b5', podium='#cdc6c0', retained='#8d8d8d', low='#dedede', consent='#b7c3a2', site='#f3d9d9')


def unit(v):
    L = math.hypot(*v)
    return (v[0] / L, v[1] / L)


def band(origin, d, lo, hi, far=400):
    """The points p with lo <= (p - origin) . d <= hi."""
    ux, uy = d
    px, py = -uy, ux
    o = origin
    return Polygon([(o[0] + ux * lo + px * far, o[1] + uy * lo + py * far), (o[0] + ux * hi + px * far, o[1] + uy * hi + py * far),
                    (o[0] + ux * hi - px * far, o[1] + uy * hi - py * far), (o[0] + ux * lo - px * far, o[1] + uy * lo - py * far)])


def road_lines(name):
    lines = ROADS.get(norm_road(name))
    if not lines:
        sys.exit(f'no road named {name} in the window; the roads are {", ".join(sorted(ROADS))}')
    return lines


def reference(parcel, spec):
    """The line a building's long axis follows: its direction u, the inward normal n, and a vertex of the parcel on it."""
    if 'along' in spec:
        # the frontage: the parcel's edges near the street that run with its longest one (a boundary is often several
        # collinear edges in the cadastre); its direction is theirs, not the centreline's, which may jog at a corner
        road = unary_union(road_lines(spec['along']))
        cs = list(parcel.exterior.coords)
        edges = [(p, q) for p, q in zip(cs[:-1], cs[1:]) if math.dist(p, q) >= 1 and road.distance(Point((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) <= 14]
        if not edges:
            sys.exit(f'no edge of the parcel fronts {spec["along"]}')
        # the frontage is the run of edges that together make the longest straight boundary near the street, not the
        # longest single edge: a lane that turns a corner is near two boundaries, and the one it follows is the one
        # the cadastre cuts into the most pieces
        ang = lambda e: math.atan2(e[1][1] - e[0][1], e[1][0] - e[0][0])
        turn = lambda e, f: abs((ang(e) - ang(f) + math.pi / 2) % math.pi - math.pi / 2)
        def offset(e, f):                                             # how far e's middle lies off the line of f
            mx, my = (e[0][0] + e[1][0]) / 2 - f[0][0], (e[0][1] + e[1][1]) / 2 - f[0][1]
            fx, fy = f[1][0] - f[0][0], f[1][1] - f[0][1]
            return abs(mx * fy - my * fx) / math.hypot(fx, fy)
        runs = []
        for e in edges:
            for run in runs:                                              # collinear: with it, and on its line
                if turn(e, run[0]) < math.radians(12) and offset(e, run[0]) < 3:
                    run.append(e)
                    break
            else:
                runs.append([e])
        if spec.get('side'):                                          # a street that wraps the parcel: the frontage on the side named
            c = parcel.representative_point()
            want = dict(north=(0, 1), south=(0, -1), east=(1, 0), west=(-1, 0))[spec['side']]
            def outward(run):
                mx = sum(e[0][0] + e[1][0] for e in run) / (2 * len(run)) - c.x
                my = sum(e[0][1] + e[1][1] for e in run) / (2 * len(run)) - c.y
                return (mx * want[0] + my * want[1]) / (math.hypot(mx, my) or 1)
            best = max(runs, key=outward)
        else:
            best = max(runs, key=lambda run: sum(math.dist(*e) for e in run))
        pts = [c for e in best for c in e]
        p, q = max(((p, q) for p in pts for q in pts), key=lambda pq: math.dist(*pq))
        u = unit((q[0] - p[0], q[1] - p[1]))
        origin = min(pts, key=lambda v: road.distance(Point(v)))
    else:
        nb = prop(spec['neighbour'])['poly']
        shared = parcel.exterior.intersection(nb.buffer(0.25))
        if shared.is_empty:
            sys.exit(f'{spec["neighbour"]} shares no boundary with the parcel')
        pts = [c for g in (shared.geoms if hasattr(shared, 'geoms') else [shared]) for c in g.coords]
        p, q = max(((p, q) for p in pts for q in pts), key=lambda pq: math.dist(*pq))
        u = unit((q[0] - p[0], q[1] - p[1]))
        origin = p
    n = (-u[1], u[0])
    c = parcel.representative_point()
    if (c.x - origin[0]) * n[0] + (c.y - origin[1]) * n[1] < 0:
        n = (-n[0], -n[1])
    return u, n, origin


def fit(parcel, spec):
    """The footprint the spec asks for, fitted to the parcel: `lot` the parcel itself, else a slab of the type's depth
    from the reference line, setback off it, its ends `sides` off the parcel's and no longer than `length` (45 m at
    most), kept from the end nearest `from` (a street) or centred."""
    if spec.get('footprint') == 'lot' or spec['type'] in ('podium', 'consent'):
        # a block over the lot takes the lot's outline with the points along its straight sides dropped, so each of
        # its walls is one wall to the sun study and not the run of the old titles' ends
        return (parcel.simplify(0.3, preserve_topology=True) if spec['type'] == 'block' else parcel), dict(plate=None, gap=None)
    u, n, o = reference(parcel, spec)
    depth = min(spec.get('depth') or DEPTH[spec['type']], DEPTH.get(spec['type'], 99))
    setback = spec.get('setback', 0)
    fp = parcel.intersection(band(o, n, setback, setback + depth))
    s = lambda p: (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1]
    d = lambda p: (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]
    ss = [s(p) for p in largest(fp).exterior.coords]
    s0, s1 = min(ss) + spec.get('sides', 0), max(ss) - spec.get('sides', 0)
    length = min(spec.get('length') or MAX_LEN, MAX_LEN)
    if s1 - s0 > length:
        frm = spec.get('from', 'centre')
        if frm == 'centre':
            m = (s0 + s1) / 2
            s0, s1 = m - length / 2, m + length / 2
        else:
            road = unary_union(road_lines(frm))
            at = lambda sv: Point(o[0] + u[0] * sv, o[1] + u[1] * sv)
            es = spec.get('endSetback', 0)
            if road.distance(at(s0)) <= road.distance(at(s1)):
                s0, s1 = s0 + es, s0 + es + length
            else:
                s0, s1 = s1 - es - length, s1 - es
    fp = largest(fp.intersection(band(o, u, s0, s1)))
    if fp.is_empty or fp.area < 20:
        sys.exit(f'the {spec["type"]} footprint does not fit the parcel')
    ds = [d(p) for p in fp.exterior.coords]
    ss = [s(p) for p in fp.exterior.coords]
    gap = max(d(p) for p in parcel.exterior.coords) - max(ds)
    return fp, dict(plate=f'{max(ds) - min(ds):.0f} × {max(ss) - min(ss):.0f} m', gap=gap)


# ---- the scenarios, resolved on the data ------------------------------------------------------------------------
def parcel_of(addresses):
    return largest(unary_union([prop(x)['poly'] for x in addresses]).buffer(0.08, join_style=2).buffer(-0.08, join_style=2))


BLOCKS = [[prop(x) for x in b] for b in sc['blocks']]
RETAINED = {str(prop(r['address'])['propid']): r for r in sc['retained']}
CONSENT = {str(prop(k)['propid']): v for k, v in sc.get('consentStoreys', {}).items()}
OTHERS = [r for b in BLOCKS for r in b if not r.get('isSite')]


def retained_for(scn):
    """What a scenario keeps: its own `retained` list where it has one (empty: nothing), else the study's."""
    if 'retained' not in scn:
        return RETAINED
    return {str(prop(r['address'] if isinstance(r, dict) else r)['propid']): (r if isinstance(r, dict) else {'address': r, 'why': ''}) for r in scn['retained']}


def existing_height(r):
    """What stands today: the tiles' height, else storeys assumed."""
    h = measured(r)
    if h:
        return h, storeys_of(r), 'mesh'
    pid = str(r['propid'])
    n = CONSENT.get(pid) or (ASSUMED_STOREYS if pid in RETAINED else 2)
    return H_of(n), n, 'assumed'


def resolve(scn):
    parcels, blds, used = [], [], set()
    for p in scn['parcels']:
        parcel = parcel_of(p['addresses'])
        for x in p['addresses']:
            used.add(str(prop(x)['propid']))
        area = parcel.area
        rows = []
        for b in p['buildings']:
            fp, info = fit(parcel, b)
            n = b.get('storeys') or CONSENT.get(str(prop(p['addresses'][0])['propid'])) or ASSUMED_STOREYS
            base = b.get('base', 0)
            rows.append(dict(poly=fp, n=n, base=base, typ=b['type'], key=p['key'], **info))
        gba = sum(r['poly'].area * (r['n'] - r['base']) for r in rows)
        gfa = EFFICIENCY * gba
        main = rows[-1]
        if main['typ'] == 'consent':
            parity = None
        else:
            podium = sum(r['poly'].area * (r['n'] - r['base']) for r in rows if r['typ'] == 'podium')
            parity = main['base'] + max(1, math.ceil((FSR_PAR * area / EFFICIENCY - podium) / main['poly'].area))
        parcels.append(dict(key=p['key'], name=p['name'], poly=parcel, area=area, typ=TYPE[main['typ']], storeys=max(r['n'] for r in rows), height=H_of(max(r['n'] for r in rows)),
                            gfa=gfa, fsr=gfa / area, parity=parity, plate=main['plate'], gap=main['gap'], consent=main['typ'] == 'consent', main_poly=main['poly'],
                            hob=control(HOB, parcel, 'MAX_B_H'), lep_fsr=control(FSR, parcel, 'FSR'), titles=len(p['addresses'])))
        blds += rows
    existing = []
    for r in OTHERS:
        if str(r['propid']) in used or str(r['propid']) in retained_for(scn):
            continue
        h, n, how = existing_height(r)
        existing.append(dict(poly=r['poly'], h=h, n=n, how=how, base_addr=r['base']))
    return parcels, blds, existing


def fill_in(text, parcels, units):
    vals = {'units': f'{units:,}'}
    for p in parcels:
        k = p['key']
        vals[f'{k}.area'] = f'{p["area"]:,.0f}'
        vals[f'{k}.storeys'] = str(p['storeys'])
        vals[f'{k}.plate'] = p['plate'] or ''
        vals[f'{k}.gfa'] = f'{p["gfa"]:,.0f}'
        vals[f'{k}.fsr'] = f'{p["fsr"]:.1f}:1'
        vals[f'{k}.parity'] = f'{p["parity"]} storeys' if p['parity'] else '—'
        vals[f'{k}.gap'] = f'{p["gap"]:.0f}' if p['gap'] is not None else '—'
        vals[f'{k}.sep'] = f'{SITE_TOWER.distance(p["main_poly"]):.0f}'
        vals[f'{k}.needs'] = f'{ADG[adg_band(max(p["storeys"], S["storeys"]))][0] - p["poly"].distance(SITE_TOWER):.0f}'
    if TOWER:
        vals['site.plate'] = plate_of(SITE_TOWER)
        vals['site.area'] = f'{SITE_TOWER.area:,.0f}'
        vals['site.drawn'] = f'{BASE_TOWER.area:,.0f}'
        for name in TOWER['setbacks']:
            vals[f'site.{name.split()[0].lower()}'] = f'{site_setback(name):.0f}'
        vals['site.east'] = f'{site_setback("CROWN LANE"):.0f}' if 'CROWN LANE' in TOWER['setbacks'] else vals.get('site.east', '—')
        vals['site.north'] = next((f'{site_setback(n):.0f}' for n in TOWER['setbacks'] if norm_road(n) not in ROADS), '—')
    return re.sub(r'\{([A-Za-z]+(?:\.\w+)?)\}', lambda m: vals.get(m.group(1), m.group(0)), text)


# ---- the sheet: A3 landscape at 300 dpi, as render.py ----------------------------------------------------------
DPI = 300
MM = DPI / 25.4
PT = DPI / 72
PAGE_W, PAGE_H = round(420 * MM), round(297 * MM)
SCALE = 500
PLAN_MM = (92, 10, 184, 216)        # left, top, width, height on the sheet
PLAN_W_M, PLAN_H_M = PLAN_MM[2] * SCALE / 1000, PLAN_MM[3] * SCALE / 1000
study = unary_union([r['poly'] for b in BLOCKS for r in b] + [SITE_POLY := PROPS[next(k for k, r in PROPS.items() if r.get('isSite'))]['poly']])
bx0, by0, bx1, by1 = study.bounds
WX0, WY0 = (bx0 + bx1) / 2 - PLAN_W_M / 2, (by0 + by1) / 2 - PLAN_H_M / 2
WX1, WY1 = WX0 + PLAN_W_M, WY0 + PLAN_H_M
WINDOW = Polygon([(WX0, WY0), (WX1, WY0), (WX1, WY1), (WX0, WY1)])

# ---- our own scheme: a podium over the lot and a tower inset from it by the setbacks the scenarios file names ----
TOWER = S.get('tower')


def spec_for(name):
    return {'along': name} if norm_road(name) in ROADS else {'neighbour': name}


def inset(parcel, setbacks):
    g = parcel
    for name, sb in setbacks.items():
        u, n, o = reference(parcel, spec_for(name))
        g = g.intersection(band(o, n, sb, 400))
    return largest(g)


SITE_TOWER, SITE_PODIUM, TOWER_OWN = None, 0, False
BASE_TOWER = inset(SITE_POLY, TOWER['setbacks']) if TOWER else SITE_POLY.buffer(-1.0, join_style=2)


def set_tower(scn=None):
    """Our tower for a scenario: the study's site.tower, with whatever the scenario's own `site.tower` replaces."""
    global TOWER, SITE_TOWER, SITE_PODIUM, TOWER_OWN
    base = S.get('tower') or {}
    own = ((scn or {}).get('site') or {}).get('tower') or {}
    TOWER = {**base, **own} if base or own else None
    TOWER_OWN = bool(own)
    SITE_TOWER = inset(SITE_POLY, TOWER['setbacks']) if TOWER else SITE_POLY.buffer(-1.0, join_style=2)
    SITE_PODIUM = TOWER.get('podium', 0) if TOWER else 0


set_tower()


def plate_of(g):
    """A footprint's two sides, from its smallest enclosing rectangle."""
    cs = list(g.minimum_rotated_rectangle.exterior.coords)
    e1, e2 = math.dist(cs[0], cs[1]), math.dist(cs[1], cs[2])
    return f'{min(e1, e2):.0f} × {max(e1, e2):.0f} m'


def site_setback(name):
    """How far our tower's nearest face stands off the named street's or neighbour's boundary line."""
    u, n, o = reference(SITE_POLY, spec_for(name))
    return min((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] for p in SITE_TOWER.exterior.coords)


# ADG 3F-1: between habitable rooms or balconies, habitable to a blank face, blank to blank; at levels 9 and over,
# 5 to 8, up to 4. The setback each building owes its side or rear boundary is half the first figure.
ADG = {'tall': (24, 18, 12), 'mid': (18, 12, 9), 'low': (12, 9, 6)}


def adg_band(n):
    return 'tall' if n >= 9 else 'mid' if n >= 5 else 'low'


def face_gap(poly, parcel):
    """The gap from our tower's nearest face to a neighbour, square to that face, where the two overlap along it: the
    total and its parts (our face to our boundary, boundary to boundary, their boundary to their face), with the
    points to draw it between. None where they do not overlap along the face, and the diagonal between the nearest
    points is the honest measure."""
    q1, _ = nearest_points(SITE_TOWER, poly)
    cs = list(SITE_TOWER.exterior.coords)
    _, p, q = min(((LineString([p, q]).distance(q1), p, q) for p, q in zip(cs[:-1], cs[1:]) if math.dist(p, q) >= 1), key=lambda t: t[0])
    u = unit((q[0] - p[0], q[1] - p[1]))
    n = (-u[1], u[0])
    c = SITE_TOWER.representative_point()
    if (c.x - p[0]) * n[0] + (c.y - p[1]) * n[1] > 0:
        n = (-n[0], -n[1])                                            # outward from our face
    along = lambda v: (v[0] - p[0]) * u[0] + (v[1] - p[1]) * u[1]
    out = lambda v: (v[0] - p[0]) * n[0] + (v[1] - p[1]) * n[1]
    ours = [along(v) for v in cs]
    theirs = [along(v) for v in poly.exterior.coords]
    lo, hi = max(min(ours), min(theirs)), min(max(ours), max(theirs))
    if hi - lo < 2:
        return None
    strip = band(p, u, lo, hi)
    def dmin(g):
        vs = [out(v) for pp in polys(g.intersection(strip)) for v in pp.exterior.coords]
        return min(vs) if vs else None
    def dmax(g):
        vs = [out(v) for pp in polys(g.intersection(strip)) for v in pp.exterior.coords]
        return max(vs) if vs else None
    d0, d1, d2, d3 = dmax(SITE_TOWER), dmax(SITE_POLY), dmin(parcel), dmin(poly)
    if None in (d0, d1, d2, d3):
        return None
    d2 = min(max(d2, d1), d3)                                         # their boundary lies between ours and their face
    sm = (lo + hi) / 2
    at = lambda dv: (p[0] + u[0] * sm + n[0] * dv, p[1] + u[1] * sm + n[1] * dv)
    return dict(total=d3 - d0, parts=(d1 - d0, d2 - d1, d3 - d2), p0=at(d0), p1=at(d3), ticks=[at(d1), at(d2)])


def short(base):
    """An address as the tables print it: no suburb, St and Ln."""
    return base.title().replace(' Darlinghurst', '').replace(' Street', ' St').replace(' Lane', ' Ln')


def separation(blds, existing, RET, parcels):
    """Every building within 30 m of our tower: how far apart the two stand, square to our face where they overlap
    along it and between their nearest points where they do not, and what the ADG asks between them at the levels
    they share (the lower one's band: what the rooms face)."""
    lot = {q['key']: q['poly'] for q in parcels}
    cands = [(f'{b["key"]} · {TYPE[b["typ"]].split(",")[0].lower()}, {b["n"]} st', b['poly'], b['n'], lot[b['key']], True) for b in blds if b['typ'] != 'podium']
    cands += [(f'{short(e["base_addr"])}, stands, {e["n"]} st', e['poly'], e['n'], e['poly'], False) for e in existing]
    cands += [(f'{short(PROPS[pid]["base"])}, retained, {existing_height(PROPS[pid])[1]} st', PROPS[pid]['poly'], existing_height(PROPS[pid])[1], PROPS[pid]['poly'], False) for pid in RET]
    rows = []
    for name, poly, n, parcel, new in cands:
        if SITE_TOWER.distance(poly) > 30:
            continue
        geo = face_gap(poly, parcel)
        if geo is None:
            q1, q2 = nearest_points(SITE_TOWER, poly)
            geo = dict(diag=(q1, q2))
            d = SITE_TOWER.distance(poly)
        else:
            d = geo['total']
        geo['new'] = new
        hab, blank, _ = ADG[adg_band(min(n, S['storeys']))]
        dd = round(d)        # the verdict on the metre the sheet prints
        verdict = 'clear' if dd >= hab else 'one face blank' if dd >= blank else 'short of a blank face'
        rows.append((name, d, hab, blank, verdict, geo))
    return rows


def f(v):
    return f'{v:.2f}'


def P(x, y):
    return f'{x:.2f},{-y:.2f}'


def pts(g):
    return ' '.join(P(x, y) for x, y in g.exterior.coords[:-1])


def path(g):
    return ' '.join('M' + ' L'.join(P(x, y) for x, y in r.coords[:-1]) + ' Z' for p in polys(g) for r in [p.exterior, *p.interiors])


# the clean aerial, faded well back: the colour drawn down and a veil of white, baked into one JPEG so the printer
# keeps the PDF small (a CSS filter would make it rasterise the page)
AER = fu['aerial']
canvas = Image.new('RGB', (AER['pxWidth'], AER['pxHeight']), 'white')
for t in AER['tiles']:
    im = Image.open(f'{OUT}/data/{t["file"]}').convert('RGB')
    w, h = round(t['width'] * AER['pxWidth']), round(t['height'] * AER['pxHeight'])
    canvas.paste(im.resize((w, h)), (round(t['left'] * AER['pxWidth']), round(t['top'] * AER['pxHeight'])))
canvas = ImageEnhance.Color(canvas).enhance(0.3)
canvas = Image.blend(canvas, Image.new('RGB', canvas.size, 'white'), 0.6)
canvas.save(f'{OUT}/future_base.jpg', 'JPEG', quality=88)
AE = AER['extent']
AX0, AY0 = loc((AE['xmin'], AE['ymin']))
AX1, AY1 = loc((AE['xmax'], AE['ymax']))

LOTS = [poly_of(l['rings']) for l in a['lots'] if l['rings']]
LOTS = [l for l in LOTS if not l.is_empty and l.intersects(WINDOW)]


def label_roads(window=None, k=1.0):
    """Each street named along its longest run inside the window, the text `k` times the plan's size."""
    window = WINDOW if window is None else window
    out = []
    for name, lines in ROADS.items():
        inside = [ls.intersection(window.buffer(-4)) for ls in lines]
        segs = [g for g in inside for g in (g.geoms if hasattr(g, 'geoms') else [g]) if g.geom_type == 'LineString' and g.length > 14]
        if not segs:
            continue
        ls = max(segs, key=lambda g: g.length)
        m = ls.interpolate(0.5, normalized=True)
        q = ls.interpolate(0.5 + 2 / ls.length, normalized=True) if ls.length > 4 else Point(ls.coords[-1])
        ang = -math.degrees(math.atan2(q.y - m.y, q.x - m.x))
        ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
        lane = 'LANE' in name
        out.append(f'<text transform="translate({f(m.x)},{f(-m.y)}) rotate({f(ang)})" class="st" font-size="{(1.4 if lane else 1.9) * k}" dy="{0.6 * k}">{H.escape(name.title())}</text>')
    return out


def plan(scn, parcels, blds, existing, RET, sep):
    o = [f'<svg class="plan" viewBox="{f(WX0)} {f(-WY1)} {f(PLAN_W_M)} {f(PLAN_H_M)}" xmlns="http://www.w3.org/2000/svg">',
         '<defs><pattern id="hat" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.2" stroke="#555" stroke-width="0.28"/></pattern>'
         f'<clipPath id="win"><rect x="{f(WX0)}" y="{f(-WY1)}" width="{f(PLAN_W_M)}" height="{f(PLAN_H_M)}"/></clipPath></defs>',
         '<g clip-path="url(#win)">',
         f'<image href="future_base.jpg" x="{f(AX0)}" y="{f(-AY1)}" width="{f(AX1 - AX0)}" height="{f(AY1 - AY0)}" preserveAspectRatio="none"/>']
    for l in LOTS:
        o.append(f'<path d="{path(l)}" fill="none" stroke="#777" stroke-width="0.12" stroke-opacity="0.6"/>')
    for b in BLOCKS:
        for r in b:
            o.append(f'<path d="{path(r["poly"])}" fill="none" stroke="#fff" stroke-width="0.35"/>')
    for pid, why in RET.items():
        r = PROPS[pid]
        g = r['poly']
        o.append(f'<path d="{path(g)}" fill="{C["retained"]}" stroke="#3a3a3a" stroke-width="0.25"/><path d="{path(g)}" fill="url(#hat)" fill-opacity=".3"/>')
        c = g.representative_point()
        h, n, how = existing_height(r)
        o.append(f'<text x="{f(c.x)}" y="{-c.y + 0.3:.2f}" class="ret">retained · {n} st{"" if how == "mesh" else "*"}</text>')
    for e in existing:
        o.append(f'<path d="{path(e["poly"])}" fill="#fff" fill-opacity=".72" stroke="#9a9a9a" stroke-width="0.2"/>')
        c = e['poly'].representative_point()
        small = e['poly'].area < 110
        label = 'existing' if small else f'existing · {e["n"]} st'
        o.append(f'<text x="{f(c.x)}" y="{-c.y + 0.45:.2f}" class="ret" style="fill:#666" font-size="{1.0 if small else 1.3}">{label}</text>')
    g = SITE_POLY
    o.append(f'<path d="{path(g)}" fill="{C["site"]}" fill-opacity=".92" stroke="#e11b22" stroke-width="0.9" stroke-linejoin="round"/>')
    c = g.centroid
    if TOWER:
        o.append(f'<path d="{path(SITE_TOWER)}" fill="#e6b0b0" fill-opacity=".9" stroke="#c0161c" stroke-width="0.3"/>')
        c = SITE_TOWER.centroid
        # the label in the podium's broadest side: the strips under 3 m wide eroded away first, since an L-shaped
        # remainder's interior point lands in its thin leg
        rest = SITE_POLY.difference(SITE_TOWER.buffer(5)).buffer(-1.5)
        if not rest.is_empty:
            pc = largest(rest).centroid
            o.append(f'<text x="{f(pc.x)}" y="{-pc.y + 0.5:.2f}" class="sub" fill="#c0161c">podium · {SITE_PODIUM} st</text>')
    sub = H.escape(S.get('label', 'our site')) + (f' · {SITE_PODIUM}-storey podium' if TOWER and rest.is_empty else '')
    o.append(f'<text x="{f(c.x)}" y="{-c.y - 0.6:.2f}" class="num" fill="#c0161c">{S["storeys"]}</text><text x="{f(c.x)}" y="{-c.y + 2.0:.2f}" class="sub" fill="#c0161c">{sub}</text>')
    for p in parcels:
        o.append(f'<path d="{path(p["poly"])}" fill="#fff" fill-opacity=".82"/>')
    for b in blds:
        for g in polys(b['poly']):
            if b['typ'] == 'podium':
                o.append(f'<path d="{path(g)}" fill="{C["podium"]}" stroke="#555" stroke-width="0.18"/>')
            else:
                o.append(f'<path d="{path(g)}" fill="{C[b["typ"]]}" stroke="#222" stroke-width="0.3"/>')
    for b in blds:
        if b['typ'] == 'podium':
            continue
        c = b['poly'].representative_point()
        small = b['poly'].area < 200
        o.append(f'<text x="{f(c.x)}" y="{-c.y + (1.2 if small else 0.4):.2f}" class="num">{b["n"]}</text>')
        if b['plate'] and not small:
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 2.6:.2f}" class="sub">{b["plate"]}</text>')
    for p in parcels:
        o.append(f'<path d="{path(p["poly"])}" fill="none" stroke="#111" stroke-width="0.55" stroke-linejoin="round"/>')
    for b in BLOCKS:
        g = unary_union([r['poly'] for r in b]).buffer(1.2, join_style=2)
        o.append(f'<path d="{path(g)}" fill="none" stroke="#5a2ea6" stroke-width="0.5" stroke-dasharray="2.2 1.3"/>')
    for p in parcels:
        x, y = max(p['poly'].exterior.coords, key=lambda q: q[0] + q[1])
        o.append(f'<circle cx="{f(x + 0.4)}" cy="{f(-(y + 0.4))}" r="1.7" fill="#111"/><text x="{f(x + 0.4)}" y="{-(y + 0.4) + 0.65:.2f}" class="key">{p["key"]}</text>')
    # the separation from our tower to each neighbour: a dimension line between their nearest points, in the
    # verdict's colour
    def dim(x0, y0, x1, y1, col, label, sub=None, ticks=()):
        L = math.hypot(x1 - x0, y1 - y0)
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        nx, ny = -uy, ux
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        o.append(f'<line x1="{f(x0)}" y1="{f(-y0)}" x2="{f(x1)}" y2="{f(-y1)}" stroke="{col}" stroke-width="0.35"/>')
        for (qx, qy), h in [((x0, y0), 0.9), ((x1, y1), 0.9)] + [(t, 0.6) for t in ticks]:
            o.append(f'<line x1="{f(qx + nx * h)}" y1="{f(-(qy + ny * h))}" x2="{f(qx - nx * h)}" y2="{f(-(qy - ny * h))}" stroke="{col}" stroke-width="0.35"/>')
        ang = -math.degrees(math.atan2(uy, ux))
        ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
        o.append(f'<text transform="translate({f(mx + nx * 1.4)},{f(-(my + ny * 1.4))}) rotate({f(ang)})" class="dim" fill="{col}">{label}</text>')
        if sub:
            o.append(f'<text transform="translate({f(mx - nx * 1.6)},{f(-(my - ny * 1.6))}) rotate({f(ang)})" class="dim" font-size="1.1" fill="#555">{sub}</text>')

    for nm, d, hab, blank, v, geo in sep:
        if d < 0.5 or (v == 'clear' and d > 24 and not geo['new']):     # a standing building clear at any band and past the largest figure needs no line
            continue
        col = '#1f8f3a' if v == 'clear' else '#c77d00' if v.startswith('one') else '#c0161c'
        if 'total' in geo:
            a, g, b = geo['parts']
            sub = ' + '.join(f'{x:.0f}' for x in ((a, g, b) if g >= 0.3 else (a, b)))
            dim(*geo['p0'], *geo['p1'], col, f'{d:.0f} m', sub, [t for t, x in zip(geo['ticks'], (a, g)) if x >= 0.3])
        else:
            q1, q2 = geo['diag']
            dim(q1.x, q1.y, q2.x, q2.y, col, f'{d:.0f} m')
    o += label_roads()
    o.append('</g>')
    # scale bar and north
    L = 20
    x, y = WX0 + 3, -(WY0 + 4)
    o.append(f'<g transform="translate({f(x)} {f(y)})"><rect x="-1" y="-2.6" width="{L + 9}" height="4.2" fill="#fff" fill-opacity=".85"/><line x1="0" y1="0" x2="{L}" y2="0" stroke="#111" stroke-width="0.35"/>'
             f'<line x1="0" y1="-0.8" x2="0" y2="0.8" stroke="#111" stroke-width="0.25"/><line x1="{L / 2}" y1="-0.5" x2="{L / 2}" y2="0.5" stroke="#111" stroke-width="0.25"/><line x1="{L}" y1="-0.8" x2="{L}" y2="0.8" stroke="#111" stroke-width="0.25"/>'
             f'<text x="{L + 1.2}" y="0.6" class="sc">20 m</text></g>')
    o.append(f'<g transform="translate({f(WX1 - 5)} {f(-(WY0 + 6))})"><circle r="2.8" fill="#fff" fill-opacity=".9" stroke="#111" stroke-width="0.25"/><path d="M0 -2 L0.7 1.1 L0 0.5 L-0.7 1.1 Z" fill="#111"/><text y="-3.4" class="sc" text-anchor="middle">N</text></g>')
    o.append('</svg>')
    return '\n'.join(o)


# ---- the axonometric: the camera at the west-north-west, looking down over Riley Street --------------------------
ANG = math.radians(238)
CA, SA = math.cos(ANG), math.sin(ANG)
KY, KZ = 0.55, 0.84


def proj(x, y, z):
    xr = x * CA + y * SA
    yr = x * SA - y * CA
    return xr, yr * KY - z * KZ, yr


def shade(hexc, k):
    r, g, b = [int(hexc[i:i + 2], 16) for i in (1, 3, 5)]
    r, g, b = [int(v * k) if k < 1 else int(v + (255 - v) * (k - 1)) for v in (r, g, b)]
    return f'#{r:02x}{g:02x}{b:02x}'


def axo(scn, parcels, blds, existing, RET):
    items = []
    for pid, why in RET.items():
        r = PROPS[pid]
        h, n, how = existing_height(r)
        items.append((r['poly'], 0, h, dict(typ='retained', n=n, label=f'{n}{"" if how == "mesh" else "*"}')))
    for e in existing:
        items.append((e['poly'], 0, e['h'], dict(typ='low', n=e['n'], label=None)))
    if TOWER:
        items.append((SITE_POLY, 0, H_of(SITE_PODIUM), dict(typ='site', n=SITE_PODIUM, base=0, label=None, grp='site')))
        items.append((SITE_TOWER, H_of(SITE_PODIUM), H_of(S['storeys']), dict(typ='site', n=S['storeys'], base=SITE_PODIUM, label=str(S['storeys']), grp='site')))
    else:
        items.append((SITE_TOWER, 0, H_of(S['storeys']), dict(typ='site', n=S['storeys'], base=0, label=str(S['storeys']), grp='site')))
    for b in blds:
        items.append((b['poly'], H_of(b['base']) if b['base'] else 0, H_of(b['n']), dict(typ=b['typ'], n=b['n'], base=b['base'], label=None if b['typ'] == 'podium' else str(b['n']), grp=b['key'])))
    flat = [(p, z0, z1, b) for g, z0, z1, b in items for p in polys(g)]
    xs, ys, out = [], [], []
    C.setdefault('context', '#e2e2e2')

    def Pt(x, y, z):
        u, v, _ = proj(x, y, z)
        xs.append(u); ys.append(v)
        return f'{u:.2f},{v:.2f}'

    for b in BLOCKS:
        g = unary_union([r['poly'] for r in b]).buffer(0.3, join_style=2)
        for p in polys(g):
            out.append(f'<polygon points="{" ".join(Pt(x, y, 0) for x, y in p.exterior.coords[:-1])}" fill="#efefef" stroke="#bdbdbd" stroke-width=".25"/>')
    for g, n, h in context_buildings(30):                             # the blocks round the study, as they stand, in a lighter grey
        for p in polys(g):
            flat.append((p, 0, h, dict(typ='context', n=n, label=None)))
    # each street named at the point of it nearest the blocks, over everything with a halo, so the name sits beside
    # them whatever stands in the way
    centre = study.centroid
    names = []
    for name, lines in ROADS.items():
        near = min(lines, key=lambda ls: ls.distance(centre))
        if near.distance(centre) > 60:
            continue
        m = near.interpolate(near.project(centre))
        u, v, _ = proj(m.x, m.y, 0)
        xs += [u - 6, u + 6]; ys.append(v + 2)
        names.append(f'<text x="{u:.2f}" y="{v + 1:.2f}" class="ast">{H.escape(name.title())}</text>')

    # painter's order, far to near; the parts of one building (a podium and the tower on it) go together at the
    # podium's depth, the lowest first, so a roof is never painted over the tower that stands on it
    def own(p):
        c = p.centroid
        return round(proj(c.x, c.y, 0)[2] / 1.5)
    groups = {}
    for p, z0, z1, b in flat:
        g = b.get('grp')
        if g is not None and (g not in groups or z0 < groups[g][1]):
            groups[g] = (own(p), z0)

    def depth(it):
        p, z0, z1, b = it
        g = b.get('grp')
        return (groups[g][0] if g is not None else own(p), z0, own(p))

    for p, z0, z1, b in sorted(flat, key=depth):
        col = C[b['typ']]
        stroke = '#e11b22' if b['typ'] == 'site' else '#9a9a9a' if b['typ'] == 'context' else '#3a3a3a'
        sw = .45 if b['typ'] == 'site' else .22
        # our site's envelope is a glass, so what is retained behind it stays in view
        glass = ' fill-opacity=".6"' if b['typ'] == 'site' else ''
        if not p.exterior.is_ccw:
            p = Polygon(list(p.exterior.coords)[::-1])
        cs = list(p.exterior.coords)
        walls = []
        for (x1, y1), (x2, y2) in zip(cs[:-1], cs[1:]):
            nx, ny = (y2 - y1), -(x2 - x1)                     # outward normal of a counter-clockwise ring, y north
            nxr, nyr = nx * CA + ny * SA, nx * SA - ny * CA
            if nyr <= 0:
                continue
            k = 0.62 if nxr < 0 else 0.8
            d = (proj(x1, y1, 0)[2] + proj(x2, y2, 0)[2]) / 2
            walls.append((d, f'<polygon points="{Pt(x1, y1, z0)} {Pt(x2, y2, z0)} {Pt(x2, y2, z1)} {Pt(x1, y1, z1)}" fill="{shade(col, k)}"{glass} stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>'))
            if b['typ'] in ('single', 'd18', 'd22', 'block', 'site'):
                for s in range(max(b.get('base', 0), 1), b['n']):
                    z = H_of(s)
                    a1, a2 = Pt(x1, y1, z).split(','), Pt(x2, y2, z).split(',')
                    walls.append((d + .001, f'<line x1="{a1[0]}" y1="{a1[1]}" x2="{a2[0]}" y2="{a2[1]}" stroke="{stroke}" stroke-width=".08" opacity=".55"/>'))
        out += [w for _, w in sorted(walls)]
        out.append(f'<polygon points="{" ".join(Pt(x, y, z1) for x, y in cs[:-1])}" fill="{shade(col, 1.0)}"{glass} stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
        if b['label']:
            c = p.centroid
            u, v, _ = proj(c.x, c.y, z1)
            out.append(f'<text x="{u:.2f}" y="{v + 1.6:.2f}" class="an" fill="{"#c0161c" if b["typ"] == "site" else "#111"}">{b["label"]}</text>')
    out += names
    x0, x1, y0, y1 = min(xs) - 4, max(xs) + 4, min(ys) - 4, max(ys) + 4
    return f'<svg class="axo" viewBox="{x0:.1f} {y0:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' + '\n'.join(out) + '</svg>'


# ---- the page ---------------------------------------------------------------------------------------------------
def mm(v):
    return f'{v * MM:.1f}px'


def pt(v):
    return f'{v * PT:.1f}px'


CSS = f'''
@page{{size:{PAGE_W}px {PAGE_H}px;margin:0}}
*{{box-sizing:border-box}}
html,body{{margin:0;background:#fff}}
body{{width:{PAGE_W}px;height:{PAGE_H}px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.txt{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(79)};font-size:{pt(7.2)};line-height:1.4}}
.kick{{font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{pt(17)};line-height:1.1;margin:{mm(1.5)} 0 {mm(1)};font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{pt(7.4)};color:#555;margin-bottom:{mm(3.5)}}}
.lead{{font-size:{pt(8.2)};line-height:1.4;margin:0 0 {mm(3)}}}
ul{{margin:0;padding-left:{mm(3.4)}}} li{{margin-bottom:{mm(1.3)}}}
h2{{font-size:{pt(6.6)};letter-spacing:.06em;text-transform:uppercase;margin:{mm(4)} 0 {mm(1.2)};font-weight:700}}
table{{border-collapse:collapse;width:100%;font-size:{pt(6)};font-variant-numeric:tabular-nums}}
th{{text-align:left;font-weight:600;border-bottom:{mm(.3)} solid #111;padding:{mm(.8)} {mm(.5)};vertical-align:bottom}}
td{{border-bottom:{mm(.15)} solid #ccc;padding:{mm(.7)} {mm(.5)};vertical-align:top}}
td.r,th.r{{text-align:right}}
.k{{display:inline-block;width:{mm(3.6)};height:{mm(3.6)};border-radius:50%;background:#111;color:#fff;text-align:center;font-weight:700;font-size:{pt(6)};line-height:{mm(3.6)}}}
.plan{{position:absolute;left:{mm(PLAN_MM[0])};top:{mm(PLAN_MM[1])};width:{mm(PLAN_MM[2])};height:{mm(PLAN_MM[3])}}}
.cap{{position:absolute;font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase}}
.tabs{{position:absolute;left:{mm(PLAN_MM[0])};top:{mm(PLAN_MM[1] + PLAN_MM[3] + 7)};width:{mm(PLAN_MM[2])};display:flex;gap:{mm(6)};font-size:{pt(6)};line-height:1.35}}
.tab{{flex:1;min-width:0}} .tab h2{{margin:0 0 {mm(1)}}} .tab table{{font-size:{pt(5.8)}}} .tab td{{padding:{mm(.45)} {mm(.5)}}} .tab th{{padding:{mm(.5)} {mm(.5)}}}
.axo{{position:absolute;left:{mm(280)};top:{mm(16)};width:{mm(130)};height:{mm(150)}}}
.leg{{position:absolute;left:{mm(282)};top:{mm(172)};width:{mm(126)};font-size:{pt(6.8)};line-height:1.35}}
.leg .row{{display:flex;gap:{mm(2.5)};align-items:center;margin-bottom:{mm(1.4)}}}
.sw{{width:{mm(9)};height:{mm(4.2)};border:{mm(.25)} solid #222;flex:none}}
.ass{{position:absolute;left:{mm(282)};top:{mm(222)};width:{mm(126)};font-size:{pt(5.9)};line-height:1.4;color:#444}}
.ass p{{margin:0 0 {mm(1.2)}}}
.foot{{position:absolute;left:{mm(10)};bottom:{mm(8)};width:{mm(78)};font-size:{pt(8.5)};font-weight:700;letter-spacing:.04em;line-height:1.2}}
.foot span{{display:block;font-weight:400;font-size:{pt(6.4)};letter-spacing:0;color:#555;margin-top:{mm(.8)}}}
svg text{{font-family:Inter,Helvetica,Arial,sans-serif}}
.num{{font-size:3.6px;font-weight:700;text-anchor:middle}}
.sub{{font-size:1.35px;font-weight:500;text-anchor:middle}}
.ret{{font-size:1.3px;font-weight:600;text-anchor:middle;fill:#fff}}
.key{{font-size:1.9px;font-weight:700;text-anchor:middle;fill:#fff}}
.st{{font-weight:700;letter-spacing:.08em;text-anchor:middle;fill:#444;paint-order:stroke;stroke:#fff;stroke-width:0.45px;stroke-linejoin:round}}
.sc{{font-size:1.5px;font-weight:600}}
.dim{{font-size:1.5px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:0.45px;stroke-linejoin:round}}
.an{{font-size:4.4px;font-weight:700;text-anchor:middle}}
.ast{{font-size:2.9px;font-weight:600;text-anchor:middle;fill:#666;letter-spacing:.03em;paint-order:stroke;stroke:#fff;stroke-width:1.1px;stroke-linejoin:round}}
'''

lep = a.get('controls') or {}
hcas = sorted({r.get('inHCA') for b in BLOCKS for r in b if r.get('inHCA')})
items = sorted({r['heritageItem'] for b in BLOCKS for r in b if r.get('heritageItem')})
site_h = measured(SITE)
mesh_props = [r for b in BLOCKS for r in b if measured(r)]


def flags_for():
    flags = []
    flags.append(f'<b>Our site.</b> {S["storeys"]} storeys as the author states it, not read from the model; {SITE_UNITS} apartments and {SITE_GFA:,.0f} m² GFA {"as given" if S.get("gfaM2") else f"assumed at {UNIT_GFA} m² each"}, so parity is {FSR_PAR:.1f}:1 over {SITE_AREA:,.0f} m². The model\'s own GFA and unit count should replace them.'
                 + (f' The tower is drawn on a {SITE_PODIUM}-storey podium, {SITE_TOWER.area:,.0f} m² a floor, its faces ' + ', '.join(f'{site_setback(n):.0f} m off {n.title()}' for n in TOWER['setbacks']) + ': ' + ('setbacks the scenario sets.' if TOWER_OWN else 'setbacks read off the model\'s plan, to be confirmed in it.') if TOWER else '')
                 + (f' The envelope drawn holds {EFFICIENCY * (SITE_AREA * SITE_PODIUM + SITE_TOWER.area * (S["storeys"] - SITE_PODIUM)):,.0f} m² GFA at {EFFICIENCY:.0%}, about {EFFICIENCY * (SITE_AREA * SITE_PODIUM + SITE_TOWER.area * (S["storeys"] - SITE_PODIUM)) / UNIT_GFA:.0f} apartments at {UNIT_GFA} m²; the stated {SITE_UNITS} set the parity figure until the model\'s count replaces them.' if TOWER else ''))
    if MESH.get('meshes'):
        flags.append(f'<b>What stands.</b> Heights read off Google\'s 3D tiles ({MESH["meshes"]} meshes at {MESH.get("errorM", 0):.0f} m, the roof\'s 80th percentile over the ground round it), {len(mesh_props)} of the {sum(len(b) for b in BLOCKS)} study properties read; storeys at {STOREY_M} m. A starred count is assumed where the tiles hold nothing.')
    else:
        flags.append(f'<b>What stands.</b> No 3D-tile heights were read: the retained buildings are drawn at an assumed {ASSUMED_STOREYS} storeys (starred), the rest at 2.')
    consent = ', '.join(f'{PROPS[pid]["base"].title().replace(" Darlinghurst", "")} at {n}' for pid, n in CONSENT.items())
    if consent:
        flags.append(f'<b>Consents.</b> Storeys assumed, the register holds no record: {consent}.')
    flags.append('<b>Separation.</b> ADG 3F-1: 24 m between habitable rooms or balconies at levels 9 and over, 18 m where one face is blank; 18 and 12 m at levels 5 to 8; 12 and 9 below. Each building owes its side or rear boundary half the first figure, 12, 9 or 6 m, a lane\'s width counting as councils measure it. The table on the left reads each neighbour at the levels the two buildings share.')
    flags.append(f'<b>Controls.</b> {H.escape(lep.get("epiName") or "LEP")}: the height and floor space ratio over each parcel in the table, from the plan\'s layers; '
                 + (f'every study lot sits in the {" and ".join(hcas)} heritage conservation area' if hcas else 'no conservation area over the study lots') + (f'; items: {", ".join(items)}' if items else ', and none is a heritage item') + '.')

    return flags

LEGEND = [
    (C['single'], '', '<b>Single loaded footprint</b>, 12 m deep, either orientation'),
    (C['d18'], '', '<b>Double loaded footprint (8 units)</b>, 18 m deep'),
    (C['d22'], '', '<b>Double loaded footprint (10 units)</b>, up to 22 m deep, units facing east and west'),
    (C['block'], '', '<b>Full-lot block</b>, the whole parcel, apartments on every face that is not a party wall'),
    (C['podium'], '', 'Podium / street wall, 2 to 3 storeys'),
    (C['consent'], '', 'Built under an existing consent'),
    (C['retained'], '', 'Retained unless a scenario develops it: ' + ', '.join(PROPS[pid]['base'].title().replace(' Darlinghurst', '') + f' ({why["why"]})' for pid, why in RETAINED.items())),
    (C['site'], ';border-color:#e11b22', f'{SITE["base"].title().replace(" Darlinghurst", "")}, our site: {S["storeys"]} storeys, {SITE_UNITS} units'),
]


def ring_of(g):
    """A polygon's outline wound anticlockwise, which is the way up a prism's walls face out."""
    cs = [list(p) for p in g.exterior.coords[:-1]]
    return cs if g.exterior.is_ccw else cs[::-1]


def ground_of(props):
    """How far above our site's ground a lot's ground stands, as the tiles read it (metres); nothing where unread."""
    here = HEIGHTS.get(str(SITE['propid'])) or {}
    g0 = here.get('groundZ')
    gs = [HEIGHTS[str(r['propid'])]['groundZ'] for r in props if HEIGHTS.get(str(r['propid'])) and HEIGHTS[str(r['propid'])].get('groundZ') is not None]
    return (sum(gs) / len(gs) - g0) if gs and g0 is not None else 0.0


def export_scene(no, blds, existing, RET, sep, parcels=(), scn_parcels=()):
    """Every building of the scenario as prisms, metres east and north of the site, for future_solar.py: ours,
    the scenario's (one per parcel key), what stands, and the window's other measured buildings as context, each on
    its own lot's ground as the tiles read it."""
    lon, lat = (CX / R_MERC) * 180, math.degrees(math.atan(math.exp(CY / R_MERC * math.pi)) * 2 - math.pi / 2)
    names = {nm.split(' · ')[0]: nm for nm, *_ in sep}
    # every prism says which of its walls carry apartments: the ground floor none, a podium's from the storey the
    # scenarios file names (site.tower.homesFrom), a tower's all, a standing building's all
    homes_from = (TOWER or {}).get('homesFrom')
    site_parts = []
    if TOWER:
        if homes_from and homes_from <= SITE_PODIUM:
            site_parts += [dict(ring=ring_of(p), z0=0, z1=H_of(homes_from - 1), homes='none') for p in polys(SITE_POLY)] if homes_from > 1 else []
            site_parts += [dict(ring=ring_of(p), z0=H_of(homes_from - 1) if homes_from > 1 else 0, z1=H_of(SITE_PODIUM), homes='podium') for p in polys(SITE_POLY)]
        else:
            site_parts += [dict(ring=ring_of(p), z0=0, z1=H_of(SITE_PODIUM), homes='none') for p in polys(SITE_POLY)]
    site_parts += [dict(ring=ring_of(p), z0=H_of(SITE_PODIUM) if TOWER else 0, z1=H_of(S['storeys']), homes='tower' if TOWER else 'all') for p in polys(SITE_TOWER)]
    for part in site_parts:                                            # the plans' apartments, where the file lays them out
        if part['homes'] in ((TOWER or {}).get('units') or {}):
            part['units'] = TOWER['units'][part['homes']]
    out = [dict(id='site', kind='site', type='d22', name='Our tower', parts=site_parts)]
    by_key = {}
    for b in blds:
        by_key.setdefault(b['key'], []).append(b)
    parcel_props = {q['key']: [prop(x) for x in next(pp for pp in scn_parcels if pp['key'] == q['key'])['addresses']] for q in parcels} if parcels else {}
    for key, bs in by_key.items():
        main = [b for b in bs if b['typ'] != 'podium'][-1]
        has_podium = any(b['typ'] == 'podium' for b in bs)
        g = ground_of(parcel_props.get(key, []))                       # the new building stands on its own lot's ground
        out.append(dict(id=f'new-{key}', kind='new', type=main['typ'], name=names.get(key, f'{key} · {TYPE[main["typ"]].split(",")[0].lower()}, {main["n"]} st'),
                        parts=[dict(ring=ring_of(p), z0=g + (H_of(b['base']) if b['base'] else 0), z1=g + H_of(b['n']), homes='none' if b['typ'] == 'podium' else 'tower' if has_podium else 'all') for b in bs for p in polys(b['poly'])]))
    for e in existing:
        r = next(q for q in PROPS.values() if q['base'] == e['base_addr'])
        g = ground_of([r])
        out.append(dict(id=f'standing-{e["base_addr"]}', kind='standing', type='standing', name=f'{short(e["base_addr"])}, stands, {e["n"]} st', parts=[dict(ring=ring_of(p), z0=g, z1=g + e['h'], homes='all') for p in polys(e['poly'])]))
    for pid in RET:
        r = PROPS[pid]
        h, n, how = existing_height(r)
        g = ground_of([r])
        out.append(dict(id=f'standing-{r["base"]}', kind='standing', type='standing', name=f'{short(r["base"])}, retained, {n} st', parts=[dict(ring=ring_of(p), z0=g, z1=g + h, homes='all') for p in polys(r['poly'])]))
    # the blocks round the study as they stand; a lot of the study blocks is never context, it is developed or listed
    in_blocks = {str(r['propid']) for b in BLOCKS for r in b}
    for pid, r in PROPS.items():
        if r.get('isSite') or pid in in_blocks or not measured(r) or not r['poly'].intersects(WINDOW.buffer(10)):
            continue
        g = ground_of([r])
        out.append(dict(id=f'context-{pid}', kind='context', name=r['base'], parts=[dict(ring=ring_of(p), z0=g, z1=g + measured(r), homes='all') for p in polys(r['poly'])]))
    # a wall on a shared boundary is a party wall and holds no apartment: each part's edges within half a metre of
    # another building are marked for the sun study to pass over
    footprints = {b['id']: unary_union([Polygon(part['ring']) for part in b['parts']]) for b in out}
    for b in out:
        others = unary_union([g for i, g in footprints.items() if i != b['id']])
        for part in b['parts']:
            ring = part['ring']
            part['party'] = [[*p, *q] for p, q in zip(ring, ring[1:] + ring[:1]) if others.distance(Point((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) < 0.5]
    json.dump(dict(lat=lat, lon=lon, timezone='Australia/Sydney', year=int((a.get('fetchedAt') or '2026')[:4]), buildings=out), open(f'{OUT}/future-scene-{no}.json', 'w'))
    return out


def read_sun(no):
    try:
        return json.load(open(f'{OUT}/future-solar-{no}.json'))
    except FileNotFoundError:
        return None


def apts_verdict(r):
    """The ADG's 4A-1 on a building's bays: 70 % with two hours and no more than 15 % with none is a tick."""
    if not r:
        return '', ''
    ok = r['share'] >= 0.7 and r['dark'] <= 0.15
    close = r['share'] >= 0.6 and r['dark'] <= 0.2
    return ('✓ complies' if ok else '~ close' if close else '✗ no'), ('clear' if ok else 'one face blank' if close else 'short of a blank face')


def of(share, n):
    """So many of so many apartments."""
    return f'{round(share * n)} of {n}'


def sun_cell(r, today=False, units=None):
    """One building's sun for the summary: how many of its apartments have their two continuous hours as planned
    (its own count for ours, the yield's count for a neighbour), the mark, the plan the figure is for, and the
    single-loaded figure where that is what passes; (text, colour key)."""
    if not r or not r.get('apts'):
        return None
    ap = r['apts']
    mark, vcol = apts_verdict(ap['planned'])
    smark, _ = apts_verdict(ap['single'])
    n = ap['planned']['bays'] if r.get('units') else units
    text = (f'{of(ap["planned"]["share"], n)} ' if n else '') + f'({ap["planned"]["share"]:.0%}) {mark}'
    if not r.get('units'):
        facing = f', facing {ap["single_face"]}' if ap.get('single_face') else ''
        sides = ap.get('sides', 2)
        if r.get('type') in ('single',):
            text += ' · single-loaded' + facing
        elif sides < 2:
            text += ' · one long wall on a boundary, so single-loaded' + facing
        elif sides == 2 and r.get('party_m', 0) > 1.5 * ap.get('principal_m', 99):
            text += ' · its long walls on boundaries, apartments at the two ends only'
        else:
            text += ' · double-loaded' if sides == 2 else f' · apartments on {sides} faces'
            if mark[0] != '✓' and smark[0] == '✓':
                text += f', single-loaded{facing} {ap["single"]["share"]:.0%} ✓'
    by = r.get('apts_by') or {}
    if today and 'tower' in by and 'podium' in by:
        text += f' · tower {of(by["tower"]["planned"]["share"], by["tower"]["planned"]["bays"])} · podium {of(by["podium"]["planned"]["share"], by["podium"]["planned"]["bays"])}'
    other = r.get('apts_today') if today else r.get('apts_without_site')
    if today and other:
        text += f' (before them {other["planned"]["share"]:.0%})'
    return text, vcol


def sun_verdict(share):
    return 'likely' if share >= 0.7 else 'marginal, the plan must work for it' if share >= 0.5 else 'unlikely'


SUMMARY = []
VERDICT_COLOUR = {'clear': '#1f8f3a', 'one face blank': '#c77d00', 'short of a blank face': '#c0161c', 'likely': '#1f8f3a', 'marginal': '#c77d00', 'unlikely': '#c0161c'}


MINI_PAD = 26          # metres of context round the study on the summary's plans


def context_buildings(reach):
    """The window's other measured buildings within `reach` metres of the study: what stands round it today."""
    skip = {str(r['propid']) for b in BLOCKS for r in b} | {str(SITE['propid'])}
    return [(r['poly'], storeys_of(r), measured(r)) for pid, r in PROPS.items() if pid not in skip and measured(r) and r['poly'].intersects(study.buffer(reach))]


def mini_plan(parcels, blds, existing, RET, sep, k=1.0, big=False):
    """The scenario's plan as colour blocks alone, with the blocks round it: no aerial, no names, the separations
    drawn with their metres, every standing building with its storeys. `k` scales the text and lines (1 for the
    summary's small plans, less for a sheet's); `big` adds the street names, the plates, a scale bar and north."""
    x0, y0, x1, y1 = WX0 - MINI_PAD, WY0 - MINI_PAD, WX1 + MINI_PAD, WY1 + MINI_PAD
    box = Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    o = [f'<svg viewBox="{f(x0)} {f(-y1)} {f(x1 - x0)} {f(y1 - y0)}" xmlns="http://www.w3.org/2000/svg"><rect x="{f(x0)}" y="{f(-y1)}" width="{f(x1 - x0)}" height="{f(y1 - y0)}" fill="#f4f2ef"/>']
    for g, n, h in context_buildings(MINI_PAD + 20):
        o.append(f'<path d="{path(g)}" fill="#dcdcdc" stroke="#bbb" stroke-width="{0.3 * k:.2f}"/>')
        if g.area >= 120:
            c = g.representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.7 * k:.2f}" font-size="{5 * k:.2f}" font-weight="600" text-anchor="middle" fill="#777">{n}</text>')
    for b in BLOCKS:
        for r in b:
            o.append(f'<path d="{path(r["poly"])}" fill="#fff" stroke="#ccc" stroke-width="{0.3 * k:.2f}"/>')
    standing = [(PROPS[pid]['poly'], existing_height(PROPS[pid])[1], C['retained'], '#fff') for pid in RET] + [(e['poly'], e['n'], '#e6e6e6', '#444') for e in existing]
    for g, n, fill, ink in standing:
        o.append(f'<path d="{path(g)}" fill="{fill}" stroke="#777" stroke-width="{0.3 * k:.2f}"/>')
    for g, n, fill, ink in standing:                               # what stands today, by its storeys
        if g.area >= 100:
            c = g.representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.7 * k:.2f}" font-size="{5 * k:.2f}" font-weight="600" text-anchor="middle" fill="{ink}">{n}</text>')
    o.append(f'<path d="{path(SITE_POLY)}" fill="{C["site"]}" stroke="#e11b22" stroke-width="{1.2 * k:.2f}"/>')
    if TOWER:
        o.append(f'<path d="{path(SITE_TOWER)}" fill="#e6b0b0" stroke="#c0161c" stroke-width="{0.5 * k:.2f}"/>')
    for p in parcels:
        o.append(f'<path d="{path(p["poly"])}" fill="#fff" stroke="#111" stroke-width="{0.8 * k:.2f}"/>')
    for b in blds:
        for g in polys(b['poly']):
            o.append(f'<path d="{path(g)}" fill="{C["podium"] if b["typ"] == "podium" else C[b["typ"]]}" stroke="#222" stroke-width="{0.4 * k:.2f}"/>')
    for b in blds:
        if b['typ'] != 'podium':
            c = b['poly'].representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 2.2 * k:.2f}" font-size="{6.5 * k:.2f}" font-weight="700" text-anchor="middle" fill="#111">{b["n"]}</text>')
            if big and b.get('plate'):
                o.append(f'<text x="{f(c.x)}" y="{-c.y + 5 * k:.2f}" font-size="{2.6 * k:.2f}" font-weight="500" text-anchor="middle" fill="#111">{b["plate"]}</text>')
    for p in parcels:                                                 # the key letter at the parcel's corner, as the sheet has it
        x, y = max(p['poly'].exterior.coords, key=lambda q: q[0] + q[1])
        o.append(f'<circle cx="{f(x)}" cy="{f(-y)}" r="{3.6 * k:.2f}" fill="#111"/><text x="{f(x)}" y="{-y + 1.7 * k:.2f}" font-size="{5 * k:.2f}" font-weight="700" text-anchor="middle" fill="#fff">{p["key"]}</text>')
    c = SITE_TOWER.centroid
    o.append(f'<text x="{f(c.x)}" y="{-c.y + 2.2 * k:.2f}" font-size="{6.5 * k:.2f}" font-weight="700" text-anchor="middle" fill="#c0161c">{S["storeys"]}</text>')
    if big:
        o.append(f'<text x="{f(c.x)}" y="{-c.y + 5 * k:.2f}" font-size="{2.6 * k:.2f}" font-weight="500" text-anchor="middle" fill="#c0161c">{H.escape(S.get("label", "our site"))}</text>')
    for nm, d, hab, blank, v, geo in sep:
        if d < 0.5 or (v == 'clear' and d > 24 and not geo['new']):
            continue
        col = VERDICT_COLOUR[v]
        (ax, ay), (bx, by) = (geo['p0'], geo['p1']) if 'total' in geo else ((geo['diag'][0].x, geo['diag'][0].y), (geo['diag'][1].x, geo['diag'][1].y))
        o.append(f'<line x1="{f(ax)}" y1="{f(-ay)}" x2="{f(bx)}" y2="{f(-by)}" stroke="{col}" stroke-width="{1.1 * k:.2f}"/>')
        if geo['new'] or big:
            o.append(f'<text x="{f((ax + bx) / 2)}" y="{-(ay + by) / 2 - 1.5 * k:.2f}" font-size="{5.5 * k:.2f}" font-weight="700" text-anchor="middle" fill="{col}" paint-order="stroke" stroke="#fff" stroke-width="{1.6 * k:.2f}">{d:.0f} m</text>')
    if big:
        o += label_roads(box, k * 1.6)
        L = 20
        bx0, by0 = x0 + 4, y0 + 5
        o.append(f'<g transform="translate({f(bx0)} {f(-by0)})"><rect x="{-1.5 * k:.2f}" y="{-3 * k:.2f}" width="{L + 12 * k:.2f}" height="{5.5 * k:.2f}" fill="#fff" fill-opacity=".85"/>'
                 f'<line x1="0" y1="0" x2="{L}" y2="0" stroke="#111" stroke-width="{0.5 * k:.2f}"/><line x1="0" y1="{-1 * k:.2f}" x2="0" y2="{1 * k:.2f}" stroke="#111" stroke-width="{0.4 * k:.2f}"/>'
                 f'<line x1="{L}" y1="{-1 * k:.2f}" x2="{L}" y2="{1 * k:.2f}" stroke="#111" stroke-width="{0.4 * k:.2f}"/><text x="{L + 2 * k:.2f}" y="{0.9 * k:.2f}" font-size="{2.6 * k:.2f}" font-weight="600" fill="#111">20 m</text></g>')
        o.append(f'<g transform="translate({f(x1 - 7)} {f(-(y0 + 8))})"><circle r="{4 * k:.2f}" fill="#fff" fill-opacity=".9" stroke="#111" stroke-width="{0.4 * k:.2f}"/><path d="M0 {-2.8 * k:.2f} L{1 * k:.2f} {1.5 * k:.2f} L0 {0.7 * k:.2f} L{-1 * k:.2f} {1.5 * k:.2f} Z" fill="#111"/><text y="{-5 * k:.2f}" font-size="{2.6 * k:.2f}" font-weight="600" text-anchor="middle" fill="#111">N</text></g>')
    o.append('</svg>')
    return ''.join(o)


OPTION_NOTE = ("Separation per ADG 3F-1: 24 m between habitable rooms at nine storeys and over, 18 m where one face is blank, 18 and 12 at five to eight, "
               "read at the levels the two buildings share; the parts are our face to our boundary, the gap, their boundary to their face. Sun per ADG 4A-1 "
               "on 21 June, 9 to 3, cast with Loriini's engine with every building on its own ground: two continuous hours as hourly sun's-eye views show them; "
               "our apartments as the plans lay them out, each at its own wall and storey, a neighbour's in 8 m bays on the faces its plan gives them; 70 % with "
               "their two hours and no more than 15 % with none is a tick, 60 % close; the single-loaded figure is what a neighbour's plan could still reach. "
               "Storeys in grey are the 3D tiles' reading of what stands. Predictive only, not a proposal for any neighbouring site.")


def option_page(r):
    """One scenario on a sheet of its own in the summary's form: the plan large with the blocks round it, the
    apartments it adds, whether the neighbours can develop, and the table of separations and sun."""
    def cell(text, verdict):
        return f'<td style="color:{VERDICT_COLOUR.get(verdict, "#111")};font-weight:600">{text}</td>'
    trs = ''
    for b in r['buildings']:
        sun_t, sun_c = b['sun'] if b['sun'] else ('—', '')
        apart = f'{b["d"]:.0f} m · {b["v"]}' + (f' <span style="font-weight:400;color:#888">{b["parts"]}</span>' if b.get('parts') else '')
        trs += f'<tr><td>{H.escape(b["name"])}</td>{cell(apart, b["v"])}{cell(sun_t, sun_c)}</tr>'
    if r['ours']:
        trs += f'<tr><td><b>Our building</b></td><td style="color:#888">—</td>{cell(r["ours"][0], r["ours"][1])}</tr>'
    for name, with_, without, loss in r.get('shaded', []):
        mark, vcol = apts_verdict(dict(share=with_, dark=0))
        trs += f'<tr><td>{H.escape(name)}</td><td style="color:#888">—</td>{cell(f"{with_:.0%} {mark}" + (f" · {without:.0%} without our tower, {loss * 100:.0f} points" if without is not None else ""), vcol)}</tr>'
    if r.get('failing'):
        trs += '<tr><td colspan="3" style="color:#c0161c">Ours without their two hours: ' + ' · '.join(f'level {lv}: {", ".join(ids)}' for lv, ids in sorted(r['failing'].items())) + '</td></tr>'
    gain = f'About <b>{r["units"]} new apartments</b> on top of ours · ' if r['buildings'] else ''
    css = (f'.oh{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(400)}}} .oh h1{{margin:0}}'
           f'.oplan{{position:absolute;left:{mm(10)};top:{mm(26)};width:{mm(234)};height:{mm(260)}}} .oplan svg{{width:100%;height:100%}}'
           f'.ocol{{position:absolute;left:{mm(252)};top:{mm(26)};width:{mm(158)};font-size:{pt(7.2)};line-height:1.4}}'
           f'.ocol .u{{font-size:{pt(8)};margin-bottom:{mm(2)}}} .ocol .lead{{color:#444;margin:0 0 {mm(3)}}}'
           f'.ocol table{{font-size:{pt(6.4)}}} .ocol td{{padding:{mm(.6)} {mm(.5)}}} .ocol th{{padding:{mm(.6)} {mm(.5)}}}'
           f'.ocol .ass{{position:static;width:auto;margin-top:{mm(3)};font-size:{pt(6)};color:#555}}'
           f'.oaxo{{width:{mm(158)};height:{mm(95)};margin-top:{mm(4)}}} .oaxo svg{{position:static;width:100%;height:100%}}')
    head = (f'<div class="oh"><div class="kick">Future context · Scenario {r["no"]} of {LAST}</div><h1>{H.escape(r["title"])}</h1>'
            f'<div class="hor">{H.escape(r["horizon"])}</div></div>')
    col = (f'<div class="ocol"><div class="u">{gain}neighbours can develop: <b style="color:{r["allow_colour"]}">{r["allow"]}</b></div>'
           f'<p class="lead">{r["lead"]}</p>'
           f'<table><tr><th>Building</th><th>Separation from our tower</th><th>Apartments with 2 continuous hours of winter sun, of all its apartments</th></tr>{trs}</table>'
           f'<div class="oaxo">{r["axo"]}</div>'
           f'<div class="ass">{OPTION_NOTE}</div></div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {r["no"]}</title><style>{CSS}{css}</style></head><body>'
            f'{head}<div class="oplan">{r["big"]}</div>{col}</body></html>')


SUN_LIT, SUN_SHADE = '#f4c242', '#a9a9a9'


def sun_views(no, sun, hours=(9, 10, 11, 12, 13, 14, 15), reach=32):
    """The scene seen from the sun at each hour, our apartments lit or in shadow as it sees them: an orthographic
    projection along the sun's ray, every sun-facing wall and roof drawn far to near, our units' spans on their walls
    coloured by the engine's reading at that instant."""
    scene = json.load(open(f'{OUT}/future-scene-{no}.json'))
    site_rec = sun['buildings'].get('site') or {}
    series = {}
    for grp, res in (site_rec.get('apts_by') or {}).items():
        for uid, fl, ok, dark, ser in (res.get('each') or []):
            series[(grp, uid, fl)] = ser
    kinds = {b['id']: b['kind'] for b in scene['buildings']}
    fills = {'site': '#f3d9d9', 'new': '#cdc6c0', 'standing': '#dadada', 'context': '#e7e7e7'}
    step = sun.get('step', 10)
    views = []
    for hour in hours:
        idx = int((hour - 9) * 60 / step)
        s = np.array(sun['sun'][idx], dtype=float)
        if s[2] <= 0:
            continue
        fwd = -s
        right = np.cross(fwd, np.array([0.0, 0.0, 1.0]))
        right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        P = lambda x, y, z: (np.dot((x, y, z), right), np.dot((x, y, z), up), np.dot((x, y, z), fwd))
        items = []
        ours = []
        for b in scene['buildings']:
            fill = fills.get(b['kind'], '#e7e7e7')
            stroke = '#c0161c' if b['kind'] == 'site' else '#8a8a8a'
            for part in b['parts']:
                ring = part['ring']
                z0, z1 = part['z0'], part['z1']
                faces = []
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    nx, ny = q[1] - p[1], -(q[0] - p[0])
                    L = math.hypot(nx, ny)
                    if L < 1e-6:
                        continue
                    nx, ny = nx / L, ny / L
                    if nx * s[0] + ny * s[1] <= 0:
                        continue                                    # a wall the sun does not reach is not in its view
                    quad = [P(p[0], p[1], z0), P(q[0], q[1], z0), P(q[0], q[1], z1), P(p[0], p[1], z1)]
                    faces.append((sum(c[2] for c in quad) / 4, quad, fill, stroke))
                top = [P(x, y, z1) for x, y in ring]
                faces.append((sum(c[2] for c in top) / len(top), top, fill, stroke))
                items += faces
                if b['kind'] == 'site' and part.get('units'):
                    for side, lst in (('east', part['units'].get('east', [])), ('west', part['units'].get('west', []))):
                        want = 1 if side == 'east' else -1
                        best = None
                        for p, q in zip(ring, ring[1:] + ring[:1]):
                            nx, ny = q[1] - p[1], -(q[0] - p[0])
                            L = math.hypot(nx, ny)
                            if L and nx / L * want > 0.7 and (best is None or L > best[0]):
                                best = (L, p, q, nx / L, ny / L)
                        if not best:
                            continue
                        L, p, q, nx, ny = best
                        north, south = (p, q) if p[1] > q[1] else (q, p)
                        ux, uy = (south[0] - north[0]) / L, (south[1] - north[1]) / L
                        lit_wall = nx * s[0] + ny * s[1] > 0
                        nf = max(1, int(round((z1 - z0) / 3.2)))
                        at = 0.0
                        for unit in lst:
                            a, bb = at, at + float(unit[1])
                            at = bb
                            for fl in range(nf):
                                ser = series.get((part['homes'], str(unit[0]), fl), '')
                                lit = lit_wall and idx < len(ser) and ser[idx] == '1'
                                za, zb = z0 + fl * 3.2, z0 + (fl + 1) * 3.2
                                c0 = (north[0] + ux * a, north[1] + uy * a)
                                c1 = (north[0] + ux * bb, north[1] + uy * bb)
                                quad = [P(c0[0], c0[1], za), P(c1[0], c1[1], za), P(c1[0], c1[1], zb), P(c0[0], c0[1], zb)]
                                if lit_wall:
                                    items.append((sum(c[2] for c in quad) / 4 - 0.05, quad, SUN_LIT if lit else SUN_SHADE, '#7a6a2a' if lit else '#777'))
                                if b['kind'] == 'site':
                                    ours += quad
        items.sort(key=lambda it: -it[0])                            # far first
        xs = [c[0] for c in ours] or [0]
        ys = [c[1] for c in ours] or [0]
        x0, x1, y0, y1 = min(xs) - reach, max(xs) + reach, min(ys) - reach * 0.6, max(ys) + reach * 0.6
        svg = [f'<svg viewBox="{x0:.1f} {-y1:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" xmlns="http://www.w3.org/2000/svg"><rect x="{x0:.1f}" y="{-y1:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" fill="#f7f6f3"/>']
        for depth, poly, fill, stroke in items:
            svg.append(f'<polygon points="{" ".join(f"{c[0]:.2f},{-c[1]:.2f}" for c in poly)}" fill="{fill}" stroke="{stroke}" stroke-width="0.25" stroke-linejoin="round"/>')
        svg.append('</svg>')
        alt = math.degrees(math.asin(s[2]))
        az = (math.degrees(math.atan2(s[0], s[1])) + 360) % 360
        views.append((f'{hour}:00', f'sun at {az:.0f}°, {alt:.0f}° up', ''.join(svg)))
    return views


def sun_chart(sun, levels):
    """One line an apartment: its sunlit instants against the clock from 9 to 3, the two continuous hours it needs
    marked where it has them; (rows of html, count ok, count all)."""
    site_rec = sun['buildings'].get('site') or {}
    times = sun['times']
    n = len(times)
    rows, ok_n, all_n = [], 0, 0
    for grp, first, side_of in levels:
        res = (site_rec.get('apts_by') or {}).get(grp) or {}
        for uid, fl, ok, dark, ser in sorted(res.get('each') or [], key=lambda e: (e[1], e[0])):
            all_n += 1
            ok_n += int(ok)
            segs = ''
            run, best, start, bstart = 0, 0, 0, 0
            for i, ch in enumerate(ser):
                if ch == '1':
                    run = run + 1 if run else 1
                    start = i if run == 1 else start
                    segs += f'<rect x="{(i / (n - 1)) * 100:.2f}%" y="22%" width="{100 / (n - 1):.2f}%" height="56%" fill="{SUN_LIT}"/>'
                    if run > best:
                        best, bstart = run, start
                else:
                    run = 0
            if best and (best - 1) * sun.get('step', 10) >= 120:
                segs += f'<rect x="{(bstart / (n - 1)) * 100:.2f}%" y="12%" width="{((best - 1) / (n - 1)) * 100:.2f}%" height="76%" fill="none" stroke="#1f8f3a" stroke-width="1.2"/>'
            mark = '✓' if ok else '✗'
            col = '#1f8f3a' if ok else '#c0161c'
            rows.append(f'<div class="srow"><div class="sl">L{first + fl} · {uid} {side_of.get(uid, "")}</div><div class="sb"><svg width="100%" height="100%">{"".join(f"<line x1=\"{h / 6 * 100:.1f}%\" y1=\"0\" x2=\"{h / 6 * 100:.1f}%\" y2=\"100%\" stroke=\"#ddd\" stroke-width=\"0.6\"/>" for h in range(7))}{segs}</svg></div><div class="sm" style="color:{col}">{mark}</div></div>')
    return rows, ok_n, all_n


def sun_page(no, scn, sun, r):
    """The sun's proof for our apartments in one scenario: the sun's-eye views hour by hour, and the hour chart."""
    if not sun or not (sun['buildings'].get('site') or {}).get('units'):
        return None
    tw = TOWER or {}
    side_of = {}
    for grp in ('podium', 'tower'):
        for side, lst in (tw.get('units') or {}).get(grp, {}).items():
            for unit in lst:
                side_of[str(unit[0])] = {'east': 'Crown Lane', 'west': 'Riley St'}.get(side, side)
    rows, ok_n, all_n = sun_chart(sun, [('podium', tw.get('homesFrom', 1), side_of), ('tower', SITE_PODIUM + 1, side_of)])
    views = sun_views(no, sun)
    half = (len(rows) + 1) // 2
    vw = 400 / max(1, len(views))
    view_html = ''.join(f'<div class="sv" style="width:{mm(vw - 2)}"><div class="svt">{H.escape(t)} <span>{H.escape(d)}</span></div>{svg}</div>' for t, d, svg in views)
    css = (f'.sh{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(400)}}} .sh h1{{margin:0}}'
           f'.views{{position:absolute;left:{mm(10)};top:{mm(24)};width:{mm(400)};display:flex;gap:{mm(2)}}}'
           f'.sv{{flex:none;height:{mm(88)}}} .sv svg{{width:100%;height:{mm(82)}}} .svt{{font-size:{pt(7)};font-weight:700;margin-bottom:{mm(.5)}}} .svt span{{font-weight:400;color:#666}}'
           f'.chart{{position:absolute;left:{mm(10)};top:{mm(118)};width:{mm(400)};display:grid;grid-template-columns:1fr 1fr;column-gap:{mm(8)}}}'
           f'.ch{{font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:{mm(1)}}}'
           f'.srow{{display:flex;align-items:center;height:{mm(3.05)};font-size:{pt(5.6)};border-bottom:{mm(.1)} solid #eee}}'
           f'.sl{{width:{mm(34)};flex:none;white-space:nowrap;overflow:hidden}} .sb{{flex:1;height:{mm(2.6)}}} .sb svg{{display:block}} .sm{{width:{mm(6)};text-align:right;font-weight:700}}'
           f'.hours{{display:flex;justify-content:space-between;margin-left:{mm(34)};margin-right:{mm(6)};font-size:{pt(5.4)};color:#666}}'
           f'.sn{{position:absolute;left:{mm(10)};bottom:{mm(7)};width:{mm(400)};font-size:{pt(6)};color:#555}}')
    hours = '<div class="hours">' + ''.join(f'<span>{h}:00</span>' for h in range(9, 16)) + '</div>'
    head = (f'<div class="sh"><div class="kick">Future context · Scenario {r["no"]} of {LAST} · the sun on our apartments</div><h1>{H.escape(r["title"])}: '
            f'{ok_n} of {all_n} apartments have their two continuous hours</h1>'
            f'<div class="hor">21 June, 9 to 3. Above, the scene as the sun sees it each hour, our apartments lit where it reaches their wall; below, each apartment’s sun against the clock, its two continuous hours framed where it has them.</div></div>')
    chart = (f'<div class="chart"><div><div class="ch">Podium and tower, levels {tw.get("homesFrom", 1)} to {S["storeys"]}</div>{hours}{"".join(rows[:half])}</div>'
             f'<div><div class="ch">&nbsp;</div>{hours}{"".join(rows[half:])}</div></div>')
    note = ('<div class="sn">Cast with Loriini’s engine at a metre, every building on its own ground, the scenario standing. An apartment is lit at an instant where at least half of its wall '
            'span at that storey is in sun; the corner apartments on either of their walls. The sun’s-eye view is an orthographic projection along the sun’s ray, so whatever it shows is in sun '
            'and whatever it hides is in shadow. A yellow span is its sun, the green frame the longest unbroken run of two hours or more.</div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {r["no"]} · sun</title><style>{CSS}{css}</style></head><body>'
            f'{head}<div class="views">{view_html}</div>{chart}{note}</body></html>')


def summary_page(part, page_no, pages):
    """The overview, over as many sheets as the scenarios need: each with its plan and its massing, the apartments
    gained, and for every new building its separation from our tower and its mid-winter sun, read as the ADG reads
    them; a line on whether our massing lets the neighbours develop."""
    def cell(text, verdict):
        return f'<td style="color:{VERDICT_COLOUR.get(verdict, "#111")};font-weight:600">{text}</td>'
    rows = []
    for r in part:
        trs = ''
        for b in r['buildings']:
            sun_t, sun_c = b['sun'] if b['sun'] else ('—', '')
            apart = f'{b["d"]:.0f} m · {b["v"]}'
            trs += f'<tr><td>{H.escape(b["name"])}</td>{cell(apart, b["v"])}{cell(sun_t, sun_c)}</tr>'
        ours = r['ours']
        if ours:
            trs += f'<tr><td><b>Our building</b></td><td style="color:#888">—</td>{cell(ours[0], ours[1])}</tr>'
        gain = f'About <b>{r["units"]} new apartments</b> on top of ours · ' if r['buildings'] else ''
        rows.append(f'''<div class="row"><div class="mini">{r['mini']}</div><div class="maxo">{r['axo']}</div><div class="info">
<div class="t">{r['no']} · {H.escape(r['title'])}</div>
<div class="u">{gain}neighbours can develop: <b style="color:{r['allow_colour']}">{r['allow']}</b></div>
<table><tr><th>Building</th><th>Separation from our tower</th><th>Apartments with 2 continuous hours of winter sun, of all its apartments</th></tr>{trs}</table></div></div>''')
    lead = (f'<p class="lead">Each scenario: its plan with the blocks round it as they stand (storeys off the 3D tiles) and its massing, the apartments it adds, and for every new building how far it stands from our tower against the ADG\'s separation (24 m between habitable rooms at nine storeys and over, 18 m where one face is blank, 18 and 12 at five to eight), and how many of its apartments (the yield\'s count at 85 m² each; ours as the plans have them) get two continuous hours of sun on 21 June, read as ADG 4A-1 reads it: apartments in 8 m bays along the walls, both long faces of a double-loaded plan or the better face of a single-loaded one, corner units taking both walls; 70 % with two hours and no more than 15 % with none is a tick, 60 % is close, and the single-loaded figure says what the plan could still reach, facing the way it names. Green holds, amber holds with a condition, red does not. Our tower as the model draws it, {H.escape(plate_of(BASE_TOWER))}, {", ".join(f"{v:g} m off {n.title()}" for n, v in (S.get("tower") or {}).get("setbacks", {}).items())}; a scenario that moves it says so.</p>'
            if page_no == 1 else f'<p class="lead">Scenarios {part[0]["no"]} to {part[-1]["no"]}, read as on the first sheet.</p>')
    return f'''<!doctype html><html><head><meta charset="utf-8"><title>Future context · summary</title><style>{CSS}
.sum{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(400)}}}
.sum h1{{margin:0 0 {mm(1)}}} .sum .lead{{margin:0 0 {mm(3)};color:#444;font-size:{pt(7.4)}}}
.grid{{display:grid;grid-template-columns:1fr 1fr;column-gap:{mm(10)};row-gap:{mm(2)}}}
.row{{display:flex;gap:{mm(3)};border-top:{mm(.2)} solid #ccc;padding-top:{mm(1.5)};min-height:{mm(50)}}}
.mini{{width:{mm(40)};height:{mm(47)};flex:none}} .mini svg{{width:100%;height:100%}}
.maxo{{width:{mm(44)};height:{mm(47)};flex:none}} .maxo svg{{position:static;width:100%;height:100%}}
.info{{flex:1;min-width:0;font-size:{pt(6.4)};line-height:1.3}}
.t{{font-size:{pt(8.5)};font-weight:700;margin-bottom:{mm(.6)}}} .u{{margin-bottom:{mm(1.2)}}}
.info table{{font-size:{pt(6)}}} .info td{{padding:{mm(.4)} {mm(.5)}}} .info th{{padding:{mm(.4)} {mm(.5)}}}
</style></head><body>
<div class="sum"><div class="kick">Future context · overview{f" · sheet {page_no} of {pages}" if pages > 1 else ""}</div><h1>Does our massing let the neighbours develop?</h1>
{lead}
<div class="grid">{''.join(rows)}</div></div>
</body></html>'''


def page(no, scn):
    set_tower(scn)
    parcels, blds, existing = resolve(scn)
    RET = retained_for(scn)
    sep = separation(blds, existing, RET, parcels)
    flags = flags_for()
    sun_rows, sun = export_scene(no, blds, existing, RET, sep, parcels, scn['parcels']), read_sun(no)
    def parts(geo):
        if 'total' not in geo:
            return ' <span style="color:#888">diagonal</span>'
        a, g, b = geo['parts']
        return ' <span style="color:#888">' + '+'.join(f'{x:.0f}' for x in ((a, g, b) if g >= 0.3 else (a, b))) + '</span>'
    sep_rows = ''.join(f'<tr><td>{H.escape(nm)}</td><td class="r">{d:.0f}{parts(geo)}</td><td class="r">{hab} / {blank}</td><td>{v}</td></tr>' for nm, d, hab, blank, v, geo in sep if not (v == 'clear' and d > 24 and not geo['new']))
    sun_html = ''
    sun_failing, sun_shaded = {}, []
    if sun:
        rows, unchanged = [], []
        for bid, r in sun['buildings'].items():
            ap = r.get('apts')
            if not ap:
                continue
            other = r.get('apts_today') if r['kind'] == 'site' else r.get('apts_without_site')
            planned, single = ap['planned'], ap['single']
            loss = (other['planned']['share'] - planned['share']) if (other and r['kind'] != 'site') else 0
            if r['kind'] == 'standing' and loss < (0.05 if scn.get('sun') == 'all' else 0.1):
                unchanged.append(r['name'])                       # a standing building our tower barely touches needs no row
                continue
            if r['kind'] == 'standing':
                sun_shaded.append((r['name'], planned['share'], other['planned']['share'] if other else None, loss))
            def line(label, ap_, other_, bold=False):
                planned_, single_ = ap_['planned'], ap_['single']
                mark_, vcol_ = apts_verdict(planned_)
                smark_, _ = apts_verdict(single_)
                reads_ = mark_ + (' · single-loaded ' + smark_.split()[0] if mark_[0] != '✓' and smark_[0] == '✓' and r['type'] not in ('single',) and not r.get('units') else '')
                if r['kind'] != 'site' and loss >= 0.1:
                    reads_ += f' · our tower takes {loss * 100:.0f} points'
                other_txt = '' if other_ is None else f'{other_["planned"]["share"]:.0%}'
                lab = f'<b>{H.escape(label)}</b>' if bold else H.escape(label)
                single_txt = '—' if r.get('units') else f'{single_["share"]:.0%}'
                return (f'<tr><td>{lab}</td><td class="r" style="color:{VERDICT_COLOUR[vcol_]};font-weight:600">{planned_["share"]:.0%}</td>'
                        f'<td class="r">{single_txt}</td><td class="r">{other_txt}</td><td style="color:{VERDICT_COLOUR[vcol_]}">{reads_}</td></tr>')
            by, other_by = r.get('apts_by') or {}, (r.get('apts_other_by') or {})
            if r['kind'] == 'site' and 'podium' in by and 'tower' in by:
                plan_note = ' as the plans lay them out' if r.get('units') else ''
                per = lambda g: f', {r["per_floor"][g]} a floor' if r.get('per_floor', {}).get(g) else ''
                rows.append(line(f'Our building, all its apartments{plan_note}', ap, other, bold=True))
                rows.append(line(f'   its tower, levels {SITE_PODIUM + 1} to {S["storeys"]}{per("tower")}', by['tower'], other_by.get('tower')))
                rows.append(line(f'   its podium, levels {(TOWER or {}).get("homesFrom", 1)} to {SITE_PODIUM}{per("podium")}', by['podium'], other_by.get('podium')))
                failing = {}
                for grp, first in (('podium', (TOWER or {}).get('homesFrom', 1)), ('tower', SITE_PODIUM + 1)):
                    for uid, fl, ok_, dark_, *_ in (by[grp].get('each') or []):
                        if not ok_:
                            failing.setdefault(first + fl, []).append(uid + ('*' if dark_ else ''))
                sun_failing.update(failing)
                if failing:
                    rows.append(f'<tr><td colspan="5" style="color:#c0161c">Without their two hours: ' + ' · '.join(f'level {lv}: {", ".join(ids)}' for lv, ids in sorted(failing.items())) + ' (* no sun at all).</td></tr>')
            else:
                rows.append(line(r['name'], ap, other))
        if scn.get('sun') == 'all' and unchanged:
            rows.append(f'<tr><td colspan="5" style="color:#666">{len(unchanged)} other neighbours our tower changes by under 5 points: {H.escape(", ".join(n.split(",")[0] for n in unchanged))}.</td></tr>')
        sun_html = (f'<h2>Mid-winter sun · apartments with 2 continuous hours on 21 June</h2><table><tr><th style="width:34%">Building</th><th class="r" style="width:13%">As planned</th><th class="r" style="width:14%">Single-loaded</th>'
                    f'<th class="r" style="width:15%">Before them · without ours</th><th>Reads</th></tr>' + ''.join(rows) + '</table>')
        flags.append(f'<b>Sun.</b> Cast over the massing with Loriini\'s engine at a metre, 21 June from 9 to 3, and read as the ADG reads it (4A-1): apartments line each building\'s walls in bays of {sun.get("bay_m", 8):g} m, one a storey, on both long faces of a double-loaded plan or the better face of a single-loaded one, a corner apartment counted once on both its walls; the two hours are continuous, the longest unbroken run of sun as three hourly sun\'s-eye views would show it; a bay has them where half its wall at that storey does; 70 % of bays with two hours and no more than 15 % with none is a tick, 60 % is close. Each building is read as planned and as it would be single-loaded, with the scenario standing, and without our tower (ours: with today\'s buildings alone). A wall on a shared boundary is a party wall and holds no apartment; a neighbour\'s podium holds none. Our building is read on the SSDA plans themselves: each apartment at its own wall and storey, the corner ones on both their walls, the tower\'s 7 a floor (3 on Crown Lane, 4 on Riley Street) and the podium\'s 10 (5 and 5) from level {(TOWER or {}).get("homesFrom", "—")}, its ground floor commercial; its podium, its tower and the whole each read. The neighbours are a massing reading on an assumed plan.')
    faces = (f'<p style="margin-top:{mm(1.5)};color:#444">Our tower, {plate_of(SITE_TOWER)}: ' + ', '.join(f'{site_setback(n):.0f} m off {n.title()}' for n in TOWER['setbacks']) + '. The lines on the plan are its separations, the tables under the plan read them and the sun.</p>') if TOWER else ''
    newg = sum(p['gfa'] for p in parcels if not p['consent'])
    units = round(newg / UNIT_GFA / 5) * 5
    rows = []
    for p in parcels:
        lep_cell = f' · LEP {p["hob"]:.0f} m, {p["lep_fsr"]:g}:1' if p['hob'] and p['lep_fsr'] else ''
        kind = p['typ'] + (f', {p["plate"]}' if p['plate'] else '') + lep_cell
        rows.append(f'<tr><td><span class="k">{p["key"]}</span></td><td>{H.escape(p["name"])}<br><span style="color:#666">{kind}</span></td>'
                    f'<td class="r">{p["area"]:,.0f}</td><td class="r">{p["storeys"]}</td><td class="r">{p["height"]:.0f}</td><td class="r">{p["gfa"]:,.0f}</td><td class="r">{p["fsr"]:.1f}</td>'
                    f'<td class="r">{p["parity"] or "—"}</td></tr>')
    tr = ''.join(rows)
    lis = ''.join(f'<li>{fill_in(n, parcels, units)}</li>' for n in scn['notes'])
    leg = ''.join(f'<div class="row"><div class="sw" style="background:{c}{x}"></div><div>{t}</div></div>' for c, x, t in LEGEND)
    consents = sum(1 for p in parcels if p['consent'])
    yield_html = (f'<h2>Indicative yield</h2><table><tr><th></th><th>Site</th><th class="r">Site m²</th><th class="r">Storeys</th><th class="r">Height m</th><th class="r">GFA m²</th><th class="r">FSR</th><th class="r">Parity</th></tr>{tr}</table>'
                  f'<p style="margin-top:{mm(2)}">About <b>{units} new apartments</b>{" beside the existing consent" if consents else ""}, on top of the {SITE_UNITS} on our site. Parity: the storeys at which the parcel reaches our density of {FSR_PAR:.1f}:1.</p>') if parcels else '<p style="margin-top:{mm(2)}">Nothing new round the site: every building at the height the tiles read for it.</p>'
    # every new building, by parcel key: its separation row where it stands within 30 m, else the distance alone
    by_row = {nm.split(' · ')[0]: (nm, d, v) for nm, d, hab, blank, v, geo in sep if geo['new']}
    sunb = (sun or {}).get('buildings', {})
    buildings = []
    for key in dict.fromkeys(b['key'] for b in blds):
        main = [b for b in blds if b['key'] == key and b['typ'] != 'podium'][-1]
        nm, d, v = by_row.get(key, (f'{key} · {TYPE[main["typ"]].split(",")[0].lower()}, {main["n"]} st', SITE_TOWER.distance(main['poly']), 'clear'))
        sr = sunb.get(f'new-{key}')
        gfa_key = next((q['gfa'] for q in parcels if q['key'] == key), 0)
        buildings.append(dict(name=nm, d=d, v=v, sun=sun_cell(sr, units=round(gfa_key / UNIT_GFA)), units=round(gfa_key / UNIT_GFA)))
    ours = sun_cell(sunb.get('site'), today=True) if sunb.get('site') else None
    worst = max((['clear', 'one face blank', 'short of a blank face'].index(b['v']) for b in buildings), default=0)
    allow = ['yes', 'yes, with one face blank where amber', 'no, the red building cannot keep the separation'][worst] if buildings else 'nothing new to allow'
    parts_of = {nm.split(' · ')[0]: geo for nm, d, hab, blank, v, geo in sep if geo['new']}
    for b in buildings:
        g = parts_of.get(b['name'].split(' · ')[0])
        if g and 'total' in g:
            a_, gap_, c_ = g['parts']
            b['parts'] = '+'.join(f'{x:.0f}' for x in ((a_, gap_, c_) if gap_ >= 0.3 else (a_, c_)))
    SUMMARY.append(dict(no=no, title=scn['title'], horizon=scn.get('horizon', ''), lead=fill_in(scn['lead'], parcels, units), units=units, buildings=buildings, ours=ours,
                        allow=allow, allow_colour=list(VERDICT_COLOUR.values())[worst], failing=sun_failing, shaded=sun_shaded,
                        mini=mini_plan(parcels, blds, existing, RET, sep), big=mini_plan(parcels, blds, existing, RET, sep, k=0.45, big=True),
                        axo=axo(scn, parcels, blds, existing, RET), sun=sun, scn=scn))
    return f'''<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {no}</title><style>{CSS}</style></head><body>
<div class="txt"><div class="kick">Future context · Scenario {no} of {LAST}</div><h1>{H.escape(scn["title"])}</h1><div class="hor">{H.escape(scn["horizon"])}</div>
<p class="lead">{fill_in(scn["lead"], parcels, units)}</p><ul>{lis}</ul>
{yield_html}
{faces}
</div>
{plan(scn, parcels, blds, existing, RET, sep)}
<div class="cap" style="left:{mm(PLAN_MM[0])};top:{mm(PLAN_MM[1] + PLAN_MM[3] + 2)}">Plan · 1:{SCALE} @ A3 · storeys on each footprint · the study blocks dashed · the separations from our tower drawn</div>
<div class="tabs"><div class="tab"><h2>Separation from our tower</h2>
<table><tr><th style="width:38%">Building</th><th class="r" style="width:22%">m apart <span style="font-weight:400;color:#888">ours+gap+theirs</span></th><th class="r" style="width:16%">ADG, habitable / blank</th><th>At the levels shared</th></tr>{sep_rows}</table></div>
<div class="tab">{sun_html}</div></div>
<div class="cap" style="left:{mm(282)};top:{mm(10)}">Massing · looking east over Riley Street · our scheme as a glass</div>
{axo(scn, parcels, blds, existing, RET)}
<div class="leg">{leg}</div>
<div class="ass"><p><b>Assumptions.</b> Lots from the NSW digital cadastre and property register, as the context plan reads them. Footprints follow the three feasible types, fitted to each parcel from the line they are told to follow, no slab over {MAX_LEN} m. Heights are set by density parity with our site: a site of 1,000 m² or more is assumed to reach that FSR through the same pathway, a smaller one only what one slab between party walls can carry; the table says where parity lands. GFA is {EFFICIENCY:.0%} of the envelope, apartments at {UNIT_GFA} m² GFA each; storeys at 3.2 m over a 4.5 m ground floor. Aerial: NSW Imagery via SIX Maps{(" (" + a["imagery"]["date"][:4] + ")") if (a.get("imagery") or {}).get("date") else ""}, the colour drawn down.</p>
{''.join(f'<p>{x}</p>' for x in flags)}</div>
<div class="foot">{H.escape(SITE["base"].title().replace(" Darlinghurst", "").upper())}, DARLINGHURST · FUTURE CONTEXT SCENARIOS<span>Study area as marked in purple. Predictive only, not a proposal for any neighbouring site. Read {a.get("fetchedAt", "")[:10]}.</span></div>
</body></html>'''


FIRST = sc['scenarios'][0].get('number', 1)
LAST = FIRST + len(sc['scenarios']) - 1
for i, scn in enumerate(sc['scenarios'], 1):
    open(f'{OUT}/future-{i}.html', 'w').write(page(FIRST + i - 1, scn))
per = math.ceil(len(SUMMARY) / math.ceil(len(SUMMARY) / 8))              # at most eight scenarios a sheet, spread evenly
chunks = [SUMMARY[i:i + per] for i in range(0, len(SUMMARY), per)]
for i, part in enumerate(chunks, 1):
    open(f'{OUT}/future-summary-{i}.html', 'w').write(summary_page(part, i, len(chunks)))
sun_pages = 0
for i, r in enumerate(SUMMARY, 1):
    open(f'{OUT}/future-option-{i}.html', 'w').write(option_page(r))
    set_tower(r['scn'])
    html = sun_page(r['no'], r['scn'], r['sun'], r)
    if html:
        open(f'{OUT}/future-sun-{i}.html', 'w').write(html)
        sun_pages += 1
json.dump({'width': PAGE_W, 'height': PAGE_H, 'pages': len(sc['scenarios']), 'summary': len(chunks), 'options': True, 'sun': sun_pages}, open(f'{OUT}/future-page.json', 'w'))
for i, scn in enumerate(sc['scenarios'], 1):
    set_tower(scn)
    parcels, blds, existing = resolve(scn)
    print(f'scenario {i}: ' + '; '.join(f'{p["key"]} {p["area"]:.0f} m² {p["storeys"]} st GFA {p["gfa"]:.0f} FSR {p["fsr"]:.1f} parity {p["parity"]} plate {p["plate"]} gap {None if p["gap"] is None else round(p["gap"], 1)}' for p in parcels)
          + f'; {len(existing)} left as they stand')
print(f'site {SITE_AREA:.0f} m², parity {FSR_PAR:.2f}:1; window {PLAN_W_M:.0f} x {PLAN_H_M:.0f} m at 1:{SCALE}; heights read for {len(mesh_props)} study properties; sheet {PAGE_W} x {PAGE_H} px')

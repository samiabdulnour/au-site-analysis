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
import html as H, json, math, os, re, sys
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
TIERS = fu.get('tiers') or {}                                     # a tall building's steps, as the tiles read them
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
EFFICIENCY = 0.75


def H_of(n):
    return 4.5 + 3.2 * (n - 1)


def storey_bottom(n):
    """The level a storey stands on, metres over the ground; the ground floor's is the ground."""
    return 0.0 if n <= 1 else H_of(n - 1)


# ---- footprints -------------------------------------------------------------------------------------------------
MAX_LEN = 45
DEPTH = dict(single=12, d18=18, d22=22)
TYPE = dict(single='Single loaded, 12 m', d18='Double loaded, 18 m', d22='Double loaded, 22 m', block='Full-lot block', plate='Deep plate', consent='As approved', podium='Podium')
C = dict(single='#9c7273', d18='#e3d6cb', d22='#a995ad', block='#8fa3b5', plate='#9fb3a6', podium='#cdc6c0', retained='#8d8d8d', low='#dedede', consent='#b7c3a2', site='#f3d9d9')


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
    keep = spec.get('boundary') or 0                                  # metres off every neighbouring lot's boundary
    street = spec.get('streetBoundary') or 0                          # and off every street and lane, above the podium
    if spec['type'] == 'plate':
        # a deep plate: the lot less its setbacks (off its neighbouring lots, `boundaries` naming a lot's own figure;
        # off its streets, `streets` naming a street's own; `toCentre` from a road's middle), whatever depth that
        # leaves: no unit depth is asked of it. A street that wraps the lot is named a side at a time, `NAME@south`.
        # `wings` keeps of that plate only a band so many metres deep along each street, or lot boundary, named, so
        # two make an L and one a bar across the lot
        runs = boundary_runs(parcel)
        c_ = parcel.centroid
        def side_of(g):                                               # the side of the parcel a run or a road's middle lies on
            p_ = g.interpolate(g.project(c_))
            return compass4(p_.x - c_.x, p_.y - c_.y)
        def figure(table, name, g, default=None):
            for key_, v in (table or {}).items():
                nm, _, sd = key_.partition('@')
                if norm_road(nm) == norm_road(name) and (not sd or sd.strip().lower() == side_of(g)):
                    return v
            return default
        lots_own = [(prop(a_)['poly'], v) for a_, v in (spec.get('boundaries') or {}).items()]
        lot_keep = lambda r: next((v for g_, v in lots_own if g_.distance(r['line']) < 1), keep)
        cut = [r['line'].buffer(lot_keep(r), cap_style=3, join_style=2) for r in runs if r['kind'] == 'lot' and lot_keep(r)]
        for r in runs:
            # a scrap of frontage at a corner, under 2 m, is not a street the plate stands off: its square-ended
            # setback would only bite a notch out of the plate's corner
            v = figure(spec.get('streets'), r['name'], r['line'], street) if r['kind'] == 'street' and r['line'].length >= 2 else 0
            if v:
                cut.append(r['line'].buffer(v, cap_style=3, join_style=2))
        for name_, lines in road_axes().items():
            for ax in lines:
                v = figure(spec.get('toCentre'), name_, ax) if ax.distance(parcel) < 40 else 0
                if v:
                    cut.append(ax.buffer(v, cap_style=2))
        fp = largest(parcel.difference(unary_union(cut)).buffer(-0.5, join_style=2).buffer(0.5, join_style=2)) if cut else parcel
        if fp.is_empty or fp.area < 20:
            sys.exit(f'the plate does not fit the parcel {keep:g} m off its neighbouring lots and {street:g} m off its streets')
        if spec.get('wings'):
            bands = []
            def lot_named(key_):                                      # a wing may also run along the boundary with a lot, named by its address
                try:
                    return prop(key_)['poly'] if '@' not in key_ and key_[:1].isdigit() else None
                except SystemExit:
                    return None
            wing_lots = [(g_, v) for g_, v in ((lot_named(k_), v) for k_, v in spec['wings'].items()) if g_ is not None]
            for r in runs:
                if r['line'].length < 8:
                    continue
                deep = figure(spec['wings'], r['name'], r['line']) if r['kind'] == 'street' else next((v for g_, v in wing_lots if g_.distance(r['line']) < 1), 0)
                if deep:                                              # from the plate's own face on that side, so many metres in
                    bands.append(r['line'].buffer(fp.distance(r['line']) + deep, cap_style=2, join_style=2))
            if not bands:
                sys.exit(f'no side of the parcel is on {", ".join(spec["wings"])}')
            fp = largest(unary_union(bands).intersection(fp).buffer(-0.3, join_style=2).buffer(0.3, join_style=2))
        fp = fp.simplify(0.3, preserve_topology=True)
        return fp, dict(plate=plate_of(fp), gap=None)
    u, n, o = reference(parcel, spec)
    depth = min(spec.get('depth') or DEPTH[spec['type']], DEPTH.get(spec['type'], 99))
    setback = spec.get('setback', 0)
    if keep and 'neighbour' in spec:
        setback = max(setback, keep)
    if street and 'along' in spec:
        setback = max(setback, street)
    # `toCentre`: metres from a road's centreline, as a separation across it is shared, half each side
    centre = {norm_road(k_): v for k_, v in (spec.get('toCentre') or {}).items()}
    runs = boundary_runs(parcel) if keep or street or centre else []
    facing = [r for r in runs if r['kind'] == 'street' and norm_road(r['name']) in centre and r['line'].length >= 6]
    if 'along' in spec and norm_road(spec['along']) in centre:
        mine = [r for r in facing if norm_road(r['name']) == norm_road(spec['along'])]
        def along_u(r):                                               # how nearly a run lies along the frontage the slab follows
            (x0_, y0_), (x1_, y1_) = r['line'].coords[0], r['line'].coords[-1]
            return abs((x1_ - x0_) * u[0] + (y1_ - y0_) * u[1]) / (math.hypot(x1_ - x0_, y1_ - y0_) or 1.0)
        mine = [r for r in mine if along_u(r) > 0.9]
        if mine:
            r0 = max(mine, key=lambda r: r['line'].length)
            ax0 = axis_near(spec['along'], r0['line'])
            if ax0 is not None:                                       # measured from the road's middle, and parallel to it
                (ax_, ay_), (bx_, by_) = ax0.coords[0], ax0.coords[-1]
                La = math.dist((ax_, ay_), (bx_, by_))
                setback = max(centre[norm_road(spec['along'])], setback + ax0.distance(r0['line']))
                u = ((bx_ - ax_) / La, (by_ - ay_) / La)
                n = (-u[1], u[0])
                c_ = parcel.representative_point()
                if (c_.x - ax_) * n[0] + (c_.y - ay_) * n[1] < 0:
                    n = (-n[0], -n[1])
                o = (ax_, ay_)
            else:
                setback = max(setback, centre[norm_road(spec['along'])] - r0['half'])
    fp = parcel.intersection(band(o, n, setback, setback + depth))
    cut = [r['line'].buffer(keep, cap_style=3, join_style=2) for r in runs if r['kind'] == 'lot' and keep]
    cut += [r['line'].buffer(street, cap_style=3, join_style=2) for r in runs if r['kind'] == 'street' and street]
    cut += [ax.buffer(v, cap_style=2) for k_, v in centre.items() for ax in road_axes().get(k_, []) if ax.distance(parcel) < 40]
    if cut:
        # square ends, so a corner is cleared too, and no hairline left along a boundary
        fp = largest(fp.difference(unary_union(cut)).buffer(-0.2, join_style=2).buffer(0.2, join_style=2))
        if fp.is_empty or fp.area < 20:
            sys.exit(f'the {spec["type"]} footprint does not fit the parcel {keep:g} m off its neighbouring lots and {street:g} m off its streets')
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
        sys.exit(f'the {spec["type"]} footprint does not fit the parcel' + (f' {spec["boundary"]:g} m off its neighbouring lots: give it a `boundary` it can keep, 0 for blank party walls' if spec.get('boundary') else ''))
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


BUILT = set()
REMOVED = set()                                                     # the buildings a scenario takes away (`removed`)
HERITAGE = None
HERITAGE_HITS = {}                                                  # scenario title -> [(parcel key, address, item)]


def heritage_items():
    """The LEP's heritage items round the site: [(polygon, number, name)], off the planning portal's heritage map as
    the runner fetched it (future.json), else as the capacity study kept it (analysis.json, names alone)."""
    global HERITAGE
    if HERITAGE is None:
        HERITAGE = []
        for h, ll in [(h, True) for h in fu.get('heritage') or []] or [(h, False) for h in a.get('heritageItems') or []]:
            try:
                g = poly_of(h['rings'], ll=ll).buffer(0)
            except Exception:
                continue
            if not g.is_empty:
                HERITAGE.append((g, h.get('id'), h.get('name')))
    return HERITAGE


def heritage_on(poly):
    """The heritage items a lot stands on: those whose mapped outline covers a third of it or more."""
    return [(hid, name) for g, hid, name in heritage_items() if g.intersection(poly).area >= 0.34 * poly.area]



def site_yield():
    """Our building as the scenario draws it: (FSR, GFA, apartments), the floor space the massing's at the study's
    efficiency, the apartments the plans' count where the tower is as drawn, scaled with the floor space where a
    scenario moves it."""
    gba = tiers_gba(SITE_TIERS)
    units = SITE_UNITS if abs(gba - BASE_GBA) < 1 else round(SITE_UNITS * gba / BASE_GBA / 5) * 5
    if S.get('fsr'):                                                  # our density as the file states it, calculated off the plans
        fsr = S['fsr'] * gba / BASE_GBA                               # and scaled where a scenario moves our tower
        return fsr, fsr * SITE_AREA, units
    return EFFICIENCY * gba / SITE_AREA, EFFICIENCY * gba, units


def tiers_gba(tiers):
    return sum(t['poly'].area * (t['s1'] - t['s0'] + 1) for t in tiers)


def lvl(storey):
    """A storey as the plans name it: where `site.tower.levelZero` is set, the ground floor is GF and the storey
    over it level 1."""
    if (TOWER or {}).get('levelZero'):
        return 'GF' if storey <= 1 else 'L' + str(storey - 1)
    return 'L' + str(storey)


def yield_text(fsr, gfa, units, about=True):
    return f'FSR {fsr:.1f}:1 · GFA {round(gfa, -1):,.0f} m² · {"about " if about else ""}{units} apartments'


# Our scheme without plans (no `site.tower.units`): nothing is said of its apartments, whose layout is not known; its
# sun is the share of its facade with two hours or more, as future_facade_sun.py reads it cell by cell
NO_PLANS = not ((S.get('tower') or {}).get('units'))


# the faces our headline sun counts, as marked up on 25 November: the west face on Riley Street and the east on Crown
# Lane, where the apartments will look (the north face is close to the boundary, the south gets no winter sun)
HEADLINE_SIDES = ('W', 'E')
SIDES_WORD = 'west and east facades'


def facade_figures(no, sides=None):
    """Our facade's sun in a scene, off future-facade-<no>.json: the share of the walls that can hold a window with two
    hours or more and with none, with the scenario standing and today; only the faces looking `sides` (compass
    points) where named; None where it was not read."""
    path_ = f'{OUT}/future-facade-{no}.json'
    if not os.path.exists(path_):
        return None
    fac = json.load(open(path_))
    out_ = {}
    for key in ('with', 'today'):
        area = two = none = 0.0
        for f_ in fac['faces']:
            if f_['blank'] or (sides and f_.get('compass') not in sides):
                continue
            w_ = f_['length'] / max(1, round(f_['length'] / fac.get('cell_m', 3.0)))
            for c in f_['cells']:
                if key not in c:
                    continue
                a_ = w_ * (H_of(c['storey']) - storey_bottom(c['storey']))
                area += a_
                two += a_ * (c[key] >= 2 - 1e-9)
                none += a_ * (c[key] <= 1e-9)
        out_[key] = dict(two=two / area, none=none / area) if area else None
    return out_


def facade_sun_text(no):
    """Our building's line of sun on a plan sheet, where it has no plans: the share of its facade with two hours."""
    ff = facade_figures(no, HEADLINE_SIDES)
    if not ff or not ff.get('with'):
        return None
    today_ = ff.get('today')
    return (f'{ff["with"]["two"]:.0%} of our {SIDES_WORD} have 2 h or more' + (f' (baseline {today_["two"]:.0%})' if today_ else ''), '')


def trim_to(poly, want):
    """A footprint shortened about its middle, along its long axis, to the area asked: neither end moves towards
    anything, so no setback or separation is lost to it."""
    if poly.area <= want:
        return poly
    cs = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e01, e12 = math.dist(cs[0], cs[1]), math.dist(cs[1], cs[2])
    p, q = (cs[0], cs[1]) if e01 >= e12 else (cs[1], cs[2])
    L = max(e01, e12)
    u = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
    lo, hi = 0.0, L / 2
    for _ in range(30):
        m = (lo + hi) / 2
        lo, hi = (lo, m) if largest(poly.intersection(band(p, u, L / 2 - m, L / 2 + m))).area > want else (m, hi)
    return largest(poly.intersection(band(p, u, L / 2 - hi, L / 2 + hi)))


def trim_in(poly, want):
    """A plate drawn in from every side alike to the area asked: every setback it keeps grows by the same measure."""
    if poly.area <= want:
        return poly
    lo, hi = 0.0, 30.0
    for _ in range(30):
        m = (lo + hi) / 2
        g = poly.buffer(-m, join_style=2)
        lo, hi = (m, hi) if (not g.is_empty and largest(g).area > want) else (lo, m)
    return largest(poly.buffer(-hi, join_style=2)) if not poly.buffer(-hi, join_style=2).is_empty else poly


def trim_depth(poly, want, parcel, spec):
    """A footprint made shallower from its back to the area asked: the face on the street or line it follows stays
    where it is, and so do both its ends, so no setback the scenario set is lost to the trim."""
    if poly.area <= want:
        return poly
    cs = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e01, e12 = math.dist(cs[0], cs[1]), math.dist(cs[1], cs[2])
    p, q = (cs[0], cs[1]) if e01 >= e12 else (cs[1], cs[2])            # a long side
    L, D = max(e01, e12), min(e01, e12)
    u = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
    n = (-u[1], u[0])
    c = poly.centroid
    if (c.x - p[0]) * n[0] + (c.y - p[1]) * n[1] < 0:
        n = (-n[0], -n[1])                                            # from that side into the footprint
    _, n_ref, _ = reference(parcel, spec)                             # from the frontage into the parcel
    if n[0] * n_ref[0] + n[1] * n_ref[1] < 0:                         # that side is the back: start from the other
        p, n = (p[0] + n[0] * D, p[1] + n[1] * D), (-n[0], -n[1])
    lo, hi = 0.0, D
    for _ in range(30):
        m = (lo + hi) / 2
        lo, hi = (lo, m) if largest(poly.intersection(band(p, n, -1.0, m))).area > want else (m, hi)
    return largest(poly.intersection(band(p, n, -1.0, hi)))


def our_fsr():
    """Our density: the file's `site.fsr` where it states one, else off our massing as the scenario draws it."""
    return site_yield()[0] if TOWER else (S.get('fsr') or SITE_GFA / SITE_AREA)


AXES = None


def road_axes():
    """Each road's middle as straight lines that run through its junctions: the centreline's own straight runs, each
    gathered with the runs in line with it and moved sideways to sit halfway between the lot boundaries either side
    (the median along it), the legs of a road that bends joined at the bend; {name: [LineString]}."""
    global AXES
    if AXES is not None:
        return AXES
    reach = study.buffer(140)
    lots = unary_union([r['poly'] for r in PROPS.values() if r['poly'].intersects(reach.buffer(35))])
    between = lambda d0, d1: abs(math.atan2(d0[0] * d1[1] - d0[1] * d1[0], d0[0] * d1[0] + d0[1] * d1[1]))
    AXES = {}
    for name, lines in ROADS.items():
        runs = []
        for l in lines:
            piece = l.intersection(reach)
            for seg in (piece.geoms if hasattr(piece, 'geoms') else [piece]):
                if seg.geom_type != 'LineString' or seg.length < 3:
                    continue
                cs = list(seg.simplify(0.8).coords)
                cur = [cs[0], cs[1]]
                for b in cs[2:]:
                    a0, a1 = cur[0], cur[-1]
                    if between((a1[0] - a0[0], a1[1] - a0[1]), (b[0] - a1[0], b[1] - a1[1])) < math.radians(10):
                        cur.append(b)
                    else:
                        runs.append((cur[0], cur[-1]))
                        cur = [a1, b]
                runs.append((cur[0], cur[-1]))
        clusters = []
        for r in sorted((r for r in runs if math.dist(*r) >= 3), key=lambda r: -math.dist(*r)):
            L = math.dist(*r)
            d = ((r[1][0] - r[0][0]) / L, (r[1][1] - r[0][1]) / L)
            mid = ((r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2)
            for c in clusters:
                ang = between(c['u'], d)
                off = abs((mid[0] - c['p'][0]) * -c['u'][1] + (mid[1] - c['p'][1]) * c['u'][0])
                if min(ang, math.pi - ang) < math.radians(12) and off < 9:   # in line with it: a wobble, a second carriageway
                    c['runs'].append(r)
                    break
            else:
                clusters.append(dict(p=r[0], u=d, runs=[r]))
        legs = []
        for c in clusters:
            p, u = c['p'], c['u']
            n = (-u[1], u[0])
            ts = [(q[0] - p[0]) * u[0] + (q[1] - p[1]) * u[1] for r in c['runs'] for q in r]
            t0, t1 = min(ts), max(ts)
            rows, t = [], t0
            while t <= t1 + 1e-6:
                s0 = (p[0] + u[0] * t, p[1] + u[1] * t)
                if not lots.contains(Point(s0)):
                    side = []
                    for sg in (1, -1):
                        hit = LineString([s0, (s0[0] + sg * n[0] * 30, s0[1] + sg * n[1] * 30)]).intersection(lots)
                        side.append(None if hit.is_empty else Point(s0).distance(hit))
                    if None not in side:
                        rows.append((side[0] + side[1], (side[0] - side[1]) / 2, t))
                t += 2.5
            # the straight line through the midpoints: their offset from the run fitted against the distance along it,
            # so the line takes the road's own direction, not the mapped centreline's
            a_, b_ = 0.0, 0.0
            if rows:
                med = sorted(w for w, _, _ in rows)[len(rows) // 2]
                keep = [(t_, o) for w, o, t_ in rows if abs(w - med) <= 3]   # a side street's opening is not the road's width
                for _ in range(2):
                    if len(keep) >= 4:
                        mt, mo = sum(t_ for t_, _ in keep) / len(keep), sum(o for _, o in keep) / len(keep)
                        den = sum((t_ - mt) ** 2 for t_, _ in keep)
                        b_ = sum((t_ - mt) * (o - mo) for t_, o in keep) / den if den > 1e-6 else 0.0
                        a_ = mo - b_ * mt
                        keep = [(t_, o) for t_, o in keep if abs(o - (a_ + b_ * t_)) <= 1.2] or keep
                    elif keep:
                        a_, b_ = sorted(o for _, o in keep)[len(keep) // 2], 0.0
            at = lambda t_: (p[0] + u[0] * t_ + n[0] * (a_ + b_ * t_), p[1] + u[1] * t_ + n[1] * (a_ + b_ * t_))
            e0, e1 = at(t0), at(t1)
            Lg = math.dist(e0, e1) or 1.0
            legs.append([e0, e1, ((e1[0] - e0[0]) / Lg, (e1[1] - e0[1]) / Lg), sum(math.dist(*r) for r in c['runs'])])
        # a short leg lying along a longer one is the mapped line's wobble, not a road of its own
        keep_legs = []
        for A in sorted(legs, key=lambda g_: -g_[3]):
            mid = ((A[0][0] + A[1][0]) / 2, (A[0][1] + A[1][1]) / 2)
            dup = False
            for B in keep_legs:
                ang = between(A[2], B[2])
                if min(ang, math.pi - ang) < math.radians(30) and LineString([B[0], B[1]]).distance(Point(mid)) < 7:
                    dup = True
            if not dup:
                keep_legs.append(A)
        legs = keep_legs
        for i, A in enumerate(legs):                                        # a road that turns a corner: its legs meet at the corner
            for B in legs[i + 1:]:
                ang = between(A[2], B[2])
                if min(ang, math.pi - ang) < math.radians(25):
                    continue
                for ia in (0, 1):
                    for ib in (0, 1):
                        if math.dist(A[ia], B[ib]) < 9:
                            den = A[2][0] * B[2][1] - A[2][1] * B[2][0]
                            if abs(den) > 1e-6:
                                k_ = ((B[ib][0] - A[ia][0]) * B[2][1] - (B[ib][1] - A[ia][1]) * B[2][0]) / den
                                x = (A[ia][0] + A[2][0] * k_, A[ia][1] + A[2][1] * k_)
                                if math.dist(x, A[ia]) < 12:
                                    A[ia] = x
                                    B[ib] = x
        AXES[name] = [LineString([g_[0], g_[1]]) for g_ in legs if math.dist(g_[0], g_[1]) >= 6]
    return AXES


def axis_near(name, g):
    """The straight middle of the named road beside a geometry: for a boundary line, the leg of the road that runs
    along it (a lane that turns a corner has two); else the nearest. Nothing where the road has none."""
    lines = road_axes().get(norm_road(name)) or []
    if not lines:
        return None
    if g.geom_type == 'LineString' and g.length > 1:
        (x0, y0), (x1, y1) = g.coords[0], g.coords[-1]
        L = math.hypot(x1 - x0, y1 - y0) or 1.0

        def along(l):
            (a0, b0), (a1, b1) = l.coords[0], l.coords[-1]
            return abs((a1 - a0) * (x1 - x0) + (b1 - b0) * (y1 - y0)) / (L * (math.hypot(a1 - a0, b1 - b0) or 1.0))

        beside = [l for l in lines if l.distance(g) < 30 and along(l) > 0.85]
        if beside:
            return min(beside, key=lambda l: l.distance(g.interpolate(0.5, normalized=True)))
    return min(lines, key=lambda l: l.distance(g))


# every figure and name on a sheet's plan is set at this one size (times the plan's `k`): the dimensions, the storeys,
# the FSRs, the key letters, the streets, the heritage items, the scale and north
PLAN_FS = 4.6


def hatch_path(g, spacing, angle=45.0):
    """A hatch as real lines clipped to the outline, in one path's data: a <pattern> fill is printed by Chromium as a
    tiled bitmap, these stay vector in the PDF."""
    if g.is_empty:
        return ''
    a = math.radians(angle)
    ux, uy, nx, ny = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
    c = g.centroid
    x0, y0, x1, y1 = g.bounds
    R = math.hypot(x1 - x0, y1 - y0) / 2 + spacing
    d = []
    t = -R
    while t <= R:
        px, py = c.x + nx * t, c.y + ny * t
        cut = LineString([(px - ux * R, py - uy * R), (px + ux * R, py + uy * R)]).intersection(g)
        for seg in (cut.geoms if hasattr(cut, 'geoms') else [cut]):
            if seg.geom_type == 'LineString' and seg.length > 0.05:
                (ax_, ay_), (bx_, by_) = seg.coords[0], seg.coords[-1]
                d.append(f'M{f(ax_)} {f(-ay_)} L{f(bx_)} {f(-by_)}')
        t += spacing
    return ' '.join(d)


# every dimension on a plan is drawn in black, whatever its verdict: the tables say which separations hold
DIM_COLOUR = '#111111'


def arch_dim(pts, labels, col, k):
    """An architectural dimension through the points: a thin line, an oblique tick at each point, each span's figure
    above the line and along it, no halo; in DIM_COLOUR whatever `col` asks."""
    col = DIM_COLOUR
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    L = math.hypot(x1 - x0, y1 - y0)
    if L < 0.2:
        return []
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    ext, t, fs = 1.3 * k, 1.5 * k, PLAN_FS * k
    ang = -math.degrees(math.atan2(uy, ux))                           # the line's angle on the page, where y runs down
    ang = ang - 180 if ang > 90 else ang + 180 if ang <= -90 else ang
    a = math.radians(ang)
    tk = (math.cos(a - math.pi / 4), -math.sin(a - math.pi / 4))      # the tick, 45° to the line, in the plan's metres
    up = (math.sin(a), math.cos(a))                                   # above the figure, in the plan's metres
    o = [f'<line x1="{f(x0 - ux * ext)}" y1="{f(-(y0 - uy * ext))}" x2="{f(x1 + ux * ext)}" y2="{f(-(y1 + uy * ext))}" stroke="{col}" stroke-width="{0.5 * k:.2f}"/>']
    for px, py in pts:
        o.append(f'<line x1="{f(px - tk[0] * t)}" y1="{f(-(py - tk[1] * t))}" x2="{f(px + tk[0] * t)}" y2="{f(-(py + tk[1] * t))}" stroke="{col}" stroke-width="{0.7 * k:.2f}"/>')
    for (ax, ay), (bx, by), lab in zip(pts[:-1], pts[1:], labels):
        mx, my = (ax + bx) / 2 + up[0] * 1.0 * k, (ay + by) / 2 + up[1] * 1.0 * k
        o.append(f'<text transform="translate({f(mx)} {f(-my)}) rotate({ang:.1f})" font-size="{fs:.2f}" font-weight="600" text-anchor="middle" fill="{col}">{lab}</text>')
    return o


def unit_spans(lst, face_len):
    """A face's apartments as spans along it, as future_solar.py fits them: [(name or None, from, to, corner)], the
    first apartment taking up what a step leaves, or all scaled where it cannot. A None name is a stretch without an
    apartment (the corridor's window)."""
    ws = [float(u[1]) for u in lst]
    tot = sum(ws)
    if tot <= 0:
        return []
    diff = face_len - tot
    if abs(diff) > 0.25:
        first = next((i for i, u in enumerate(lst) if u[0] is not None), None)
        if first is not None and abs(diff) < 6 and ws[first] + diff >= 3.0:
            ws[first] += diff
        else:
            ws = [w * face_len / tot for w in ws]
    out, at = [], 0.0
    for u, w in zip(lst, ws):
        out.append((u[0], at, at + w, u[2] if len(u) > 2 else None))
        at += w
    return out


def our_units_scheme(k):
    """Our tower's typical floor as the plans lay it out: the apartments along its Riley Street and Crown Lane faces,
    a corridor between them; the lines kept within the tower as its slots leave it."""
    plan_ = ((TOWER or {}).get('units') or {}).get('tower')
    east, west = (face_run(SITE_BOX, 'east'), face_run(SITE_BOX, 'west')) if plan_ and SITE_BOX is not None else (None, None)
    if not east or not west:
        return []
    (en, es), (wn, ws) = east, west
    mn, ms = ((en[0] + wn[0]) / 2, (en[1] + wn[1]) / 2), ((es[0] + ws[0]) / 2, (es[1] + ws[1]) / 2)
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    inner = SITE_TOWER.buffer(-0.05)

    def line(a, b):
        g = LineString([a, b]).intersection(inner)
        return [f'<line x1="{f(x.coords[0][0])}" y1="{f(-x.coords[0][1])}" x2="{f(x.coords[-1][0])}" y2="{f(-x.coords[-1][1])}" stroke="#c0161c" stroke-opacity=".6" stroke-width="{0.3 * k:.2f}"/>'
                for x in (g.geoms if hasattr(g, 'geoms') else [g]) if x.geom_type == 'LineString' and x.length > 0.4]

    o = line(mn, ms)                                                  # the corridor, wall to wall
    for side, fn, fs_ in (('east', en, es), ('west', wn, ws)):
        L = math.dist(fn, fs_) or 1.0
        for i, (name, a, b, corner) in enumerate(unit_spans(plan_.get(side, []), L)):
            if i:
                o += line(lerp(fn, fs_, a / L), lerp(mn, ms, a / L))
    return o


def units_note(grp):
    """A group's apartments a floor in words: '8 a floor (3 on Crown Lane, 5 on Riley Street)'."""
    plan_ = ((TOWER or {}).get('units') or {}).get(grp) or {}
    names = {'east': 'Crown Lane', 'west': 'Riley Street', 'south': 'Stanley Lane', 'north': 'the north'}
    counts = [(names.get(side, side), sum(1 for u in lst if u[0] is not None)) for side, lst in plan_.items()]
    counts = [(n, c) for n, c in counts if c]
    return f'{sum(c for _, c in counts)} a floor (' + ', '.join(f'{c} on {n}' for n, c in counts) + ')'


def site_tier_lines(k):
    """Our building's other tiers on the plan, as thin outlines: the podium's upper levels where they stand back from
    the lot, and each step of the tower above its lowest level."""
    o = []
    for t in SITE_TIERS:
        if t['homes'] == 'none' or t['poly'].equals(SITE_TOWER) or t['poly'].symmetric_difference(SITE_POLY).area < 1:
            continue
        dash = '' if t['homes'] == 'podium' else f' stroke-dasharray="{1.2 * k:.2f} {0.9 * k:.2f}"'
        o.append(f'<path d="{path(t["poly"])}" fill="none" stroke="#c0161c" stroke-width="{0.3 * k:.2f}"{dash}/>')
    return o


def bays_scheme(poly, typ, k, dirs=None):
    """A neighbour's typical floor, schematically, as the sun study reads it: 8 m bays along its long axis, either
    side of a corridor where the plan is double-loaded; a deep plate's as a square grid of apartments round a core."""
    cs = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e01, e12 = math.dist(cs[0], cs[1]), math.dist(cs[1], cs[2])
    a0, a1, b0, b1 = (cs[0], cs[1], cs[3], cs[2]) if e01 >= e12 else (cs[1], cs[2], cs[0], cs[3])
    nb = max(1, round(max(e01, e12) / 8))
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    segs = [(lerp(a0, a1, i / nb), lerp(b0, b1, i / nb)) for i in range(1, nb)]
    if typ in ('d18', 'd22'):
        m0, m1 = lerp(a0, b0, 0.5), lerp(a1, b1, 0.5)
        segs.append((m0, m1))                                         # the corridor, wall to wall
    o = []
    if typ == 'plate':
        # a deep plate's floor, where its outline is square, square to the side of it that runs with a street: apartments on each street face,
        # 9 m deep where the plate is deep enough, the core between them (halved where it is over 12 m), and a party
        # wall across every 9 m or so; where a side is cut at an angle the grid stays square and is clipped to it
        ring = list(poly.exterior.coords)
        edges = sorted(zip(ring[:-1], ring[1:]), key=lambda e: -math.dist(*e))
        def with_street(e):
            L_e = math.dist(*e)
            ex, ey = (e[1][0] - e[0][0]) / L_e, (e[1][1] - e[0][1]) / L_e
            return any(abs(ex * dx + ey * dy) > math.cos(math.radians(20)) for dx, dy in dirs or [])
        p0, p1 = next((e for e in edges if math.dist(*e) > 4 and with_street(e)), edges[0])
        L_ = math.dist(p0, p1)
        ux, uy = (p1[0] - p0[0]) / L_, (p1[1] - p0[1]) / L_
        def square(e):                                                # an edge that runs with that side or square to it
            L_e = math.dist(*e)
            t = math.degrees(math.atan2((e[1][1] - e[0][1]) * ux - (e[1][0] - e[0][0]) * uy, (e[1][0] - e[0][0]) * ux + (e[1][1] - e[0][1]) * uy)) % 90
            return L_e < 4 or min(t, 90 - t) < 10
        if not all(square(e) for e in edges):
            # a plate cut at an angle takes no square grid: its apartments ring a core, a party wall from the outline
            # to the core every 9.5 m or so of it
            deep = min(12.0, 0.36 * min(e01, e12))
            core = poly.buffer(-deep, join_style=2)
            if core.is_empty:
                return o
            core = largest(core)
            outline = poly.exterior
            n_ = max(4, round(outline.length / 9.5))
            o.append(f'<path d="{path(core)}" fill="none" stroke="#333" stroke-opacity=".45" stroke-width="{0.3 * k:.2f}"/>')
            band_ = poly.difference(core)
            for i in range(n_):
                # each party wall square to the outline where it leaves it, as far as the core: walls drawn to the
                # core's nearest point fan out where a narrow plate's core is short
                s_ = (i + 0.5) * outline.length / n_
                a = outline.interpolate(s_)
                t0, t1 = outline.interpolate(max(0.0, s_ - 0.6)), outline.interpolate(min(outline.length, s_ + 0.6))
                tl = math.hypot(t1.x - t0.x, t1.y - t0.y) or 1.0
                nx_, ny_ = -(t1.y - t0.y) / tl, (t1.x - t0.x) / tl
                if not poly.contains(Point(a.x + nx_ * 0.3, a.y + ny_ * 0.3)):
                    nx_, ny_ = -nx_, -ny_
                ray = LineString([(a.x - nx_ * 0.05, a.y - ny_ * 0.05), (a.x + nx_ * (deep + 6), a.y + ny_ * (deep + 6))]).intersection(band_)
                seg = min((g_ for g_ in getattr(ray, 'geoms', [ray]) if g_.geom_type == 'LineString' and not g_.is_empty), key=lambda g_: g_.distance(a), default=None)
                if seg is None or seg.length < 1.0:
                    continue
                (x0_, y0_), (x1_, y1_) = seg.coords[0], seg.coords[-1]
                o.append(f'<line x1="{f(x0_)}" y1="{f(-y0_)}" x2="{f(x1_)}" y2="{f(-y1_)}" stroke="#333" stroke-opacity=".45" stroke-width="{0.3 * k:.2f}"/>')
            return o
        along = [(x - p0[0]) * ux + (y - p0[1]) * uy for x, y in ring]
        across = [-(x - p0[0]) * uy + (y - p0[1]) * ux for x, y in ring]
        s0, s1, d0, d1 = min(along), max(along), min(across), max(across)
        at = lambda sv, dv: (p0[0] + ux * sv - uy * dv, p0[1] + uy * sv + ux * dv)
        ns = max(1, round((s1 - s0) / 9))
        bay = (s1 - s0) / ns
        segs = [(at(s0 + bay * i, d0), at(s0 + bay * i, d1)) for i in range(1, ns)]
        deep = d1 - d0
        if deep >= 14:
            ud = 9.0 if deep >= 22.5 else 0.38 * deep
            marks = [d0 + ud, d1 - ud] + ([(d0 + d1) / 2] if deep - 2 * ud > 12 else [])
            # a plate three bays long or more turns its ends: each end a bay deep with its apartments side by side
            # across it, facing the end, and the core and the side apartments run between the two
            ends = ns >= 3 and poly.area >= 0.9 * (s1 - s0) * deep       # a plain plate, not an L or a bar with a wing
            a_, b_ = (s0 + bay, s1 - bay) if ends else (s0, s1)
            segs += [(at(a_, dv), at(b_, dv)) for dv in marks]
            if ends:
                across_n = max(2, round(deep / 10))
                for j in range(1, across_n):
                    dv = d0 + deep * j / across_n
                    segs += [(at(s0, dv), at(s0 + bay, dv)), (at(s1 - bay, dv), at(s1, dv))]
    inner = poly.buffer(-0.05)
    outer = list(zip(list(poly.exterior.coords)[:-1], list(poly.exterior.coords)[1:]))
    for p, q in segs:
        g = LineString([p, q]).intersection(inner)
        for part in (g.geoms if hasattr(g, 'geoms') else [g]):
            if part.geom_type == 'LineString' and part.length > 0.5:
                (x0_, y0_), (x1_, y1_) = part.coords[0], part.coords[-1]
                spans = [(0.0, 1.0)]
                if typ == 'plate':
                    # no party wall runs within 4 m of an outer wall it is parallel to: where a grid line would, in the
                    # corner of an L, that stretch of it is left out and the rest stands
                    Lp = math.hypot(x1_ - x0_, y1_ - y0_)
                    vx, vy = (x1_ - x0_) / Lp, (y1_ - y0_) / Lp
                    for (ax_, ay_), (bx_, by_) in outer:
                        Le = math.hypot(bx_ - ax_, by_ - ay_)
                        if Le < 1 or abs(vx * (by_ - ay_) - vy * (bx_ - ax_)) / Le > math.sin(math.radians(10)):
                            continue
                        if abs((ax_ - x0_) * vy - (ay_ - y0_) * vx) >= 4.0:
                            continue
                        ta, tb = sorted((((ax_ - x0_) * vx + (ay_ - y0_) * vy) / Lp, ((bx_ - x0_) * vx + (by_ - y0_) * vy) / Lp))
                        ta, tb = ta - 0.2 / Lp, tb + 0.2 / Lp
                        spans = [piece for lo, hi in spans for piece in ((lo, min(hi, ta)), (max(lo, tb), hi)) if piece[1] - piece[0] > 0.8 / Lp]
                for lo, hi in spans:
                    xa, ya, xb, yb = x0_ + (x1_ - x0_) * lo, y0_ + (y1_ - y0_) * lo, x0_ + (x1_ - x0_) * hi, y0_ + (y1_ - y0_) * hi
                    o.append(f'<line x1="{f(xa)}" y1="{f(-ya)}" x2="{f(xb)}" y2="{f(-yb)}" stroke="#333" stroke-opacity=".45" stroke-width="{0.3 * k:.2f}"/>')
    return o


FOOT = None
FOOT_ON = {}


def footprints_on(pid):
    """The buildings mapped on a lot (Overture, OpenStreetMap), each clipped to it: [(polygon, storeys, height)], the
    storeys the map's own where it gives them, the height the tiles' over the outline. Empty where none is mapped, or
    where they fill the lot and the lot is the building."""
    global FOOT
    if FOOT is None:
        FOOT = []
        for b in fu.get('footprints') or []:
            try:
                g = poly_of(b['rings'], ll=True)
            except Exception:
                continue
            if not g.is_empty and g.area >= 15:
                FOOT.append((g.buffer(0), b.get('floors'), b.get('heightM')))
    pid = str(pid)
    if pid not in FOOT_ON:
        lot = PROPS[pid]['poly']
        hit = []
        for g, floors, h in FOOT:
            if g.bounds[0] > lot.bounds[2] or g.bounds[2] < lot.bounds[0] or g.bounds[1] > lot.bounds[3] or g.bounds[3] < lot.bounds[1]:
                continue
            part = g.intersection(lot.buffer(0.5))
            if part.area >= 15 and part.area >= 0.3 * g.area:
                hit.append((part, int(floors) if floors else None, h))
        cover = unary_union([x[0] for x in hit]).area if hit else 0.0
        FOOT_ON[pid] = hit if hit and cover < 0.9 * lot.area else []
    return FOOT_ON[pid]


def steps_of(pid):
    """A tall building as the tiles read it, in its steps: [(polygon, z0, z1)], the steps whose outline does not
    change merged into one; None where it was not read in steps."""
    t = TIERS.get(str(pid))
    if not t:
        return None
    steps = []
    for x in t:
        g_ = poly_of(x['rings'], ll=True)
        if steps and abs(g_.area - steps[-1][0].area) <= 0.04 * steps[-1][0].area and g_.symmetric_difference(steps[-1][0]).area <= 0.06 * g_.area:
            steps[-1][2] = x['z1']
        else:
            steps.append([g_, x['z0'], x['z1']])
    return [tuple(st) for st in steps]


def street_dirs(parcel):
    """The directions the parcel's street frontages run in, as unit vectors."""
    out = []
    for r in boundary_runs(parcel):
        if r['kind'] == 'street' and r['line'].length >= 8:
            (x0_, y0_), (x1_, y1_) = r['line'].coords[0], r['line'].coords[-1]
            L_ = math.hypot(x1_ - x0_, y1_ - y0_) or 1.0
            out.append(((x1_ - x0_) / L_, (y1_ - y0_) / L_))
    return out


def resolve(scn):
    parcels, blds, used = [], [], set()
    for p in scn['parcels']:
        parcel = parcel_of(p['addresses'])
        for x in p['addresses']:
            used.add(str(prop(x)['propid']))
            for hid, hname in heritage_on(prop(x)['poly']):           # a heritage item cannot be redeveloped: say so, loudly
                hit = (p['key'], short(prop(x)['base']), f'{hid or "item"}, {hname}' if hname else str(hid))
                if hit not in HERITAGE_HITS.setdefault(scn['title'], []):
                    HERITAGE_HITS[scn['title']].append(hit)
                    print(f'WARN {scn["title"]}: site {p["key"]} takes {hit[1]}, heritage item {hit[2]}', file=sys.stderr)
        area = parcel.area
        rows = []
        for b in p['buildings']:
            above = b['type'] not in ('podium', 'consent') and b.get('footprint') != 'lot'
            band_n = 99 if b.get('storeys') == 'parity' else (b.get('storeys') or ASSUMED_STOREYS)
            lot_keep = b.get('boundary', HALF[adg_band(band_n)][0] if sc.get('neighbourSetback') == 'adg' else 0) if above else 0
            street_keep = b.get('streetBoundary', sc.get('streetSetback', 0) if (b.get('base') or 0) > 0 else 0) if above else 0
            # the ADG's half off every neighbouring lot and the upper-level setback off every street where the lot is
            # wide enough to keep them; where it is not, the slab is built to its side boundaries as blank party
            # walls (and, failing that, to its streets too), and the setback check says so
            for lk, sk in ((lot_keep, street_keep), (0, street_keep), (0, 0)):
                try:
                    fp, info = fit(parcel, dict(b, boundary=lk, streetBoundary=sk))
                    break
                except SystemExit:
                    if (lk, sk) == (0, 0):
                        raise
            n = b.get('storeys') or CONSENT.get(str(prop(p['addresses'][0])['propid'])) or ASSUMED_STOREYS
            base = b.get('base', 0)
            rows.append(dict(poly=fp, n=n, base=base, typ=b['type'], key=p['key'], spec=dict(b, boundary=lk, streetBoundary=sk), streets=street_dirs(parcel), **info))
        # `storeys: "parity"`: the slabs and towers rise until the parcel reaches our density, sharing the floor space
        # the podium leaves; a single tower is then made shallower from its back so the floor space lands on that density
        dense = [r for r in rows if r['n'] == 'parity']
        if dense:
            want_gba = our_fsr() * area / EFFICIENCY
            fixed = sum(r['poly'].area * (r['n'] - r['base']) for r in rows if r['n'] != 'parity')
            plate = sum(r['poly'].area for r in dense)
            for r in dense:
                r['n'] = r['base'] + max(1, math.ceil((want_gba - fixed) / plate))
                if r['spec'].get('maxStoreys'):                       # no taller than this, whatever density that leaves
                    r['n'] = min(r['n'], r['spec']['maxStoreys'])
            if len(dense) == 1 and dense[0]['spec'].get('footprint') != 'lot':
                r = dense[0]
                want_plate = (want_gba - fixed) / (r['n'] - r['base'])
                r['poly'] = trim_in(r['poly'], want_plate) if r['typ'] == 'plate' else trim_depth(r['poly'], want_plate, parcel, r['spec'])
                r['plate'] = plate_of(r['poly'])
        gba = sum(r['poly'].area * (r['n'] - r['base']) for r in rows)
        gfa = EFFICIENCY * gba
        main = rows[-1]
        if main['typ'] == 'consent':
            parity = None
        else:
            podium = sum(r['poly'].area * (r['n'] - r['base']) for r in rows if r['typ'] == 'podium')
            parity = main['base'] + max(1, math.ceil((our_fsr() * area / EFFICIENCY - podium) / main['poly'].area))
        parcels.append(dict(key=p['key'], name=p['name'], poly=parcel, area=area, typ=TYPE[main['typ']], storeys=max(r['n'] for r in rows), height=H_of(max(r['n'] for r in rows)),
                            gfa=gfa, fsr=gfa / area, parity=parity, plate=main['plate'], gap=main['gap'], consent=main['typ'] == 'consent', main_poly=main['poly'],
                            hob=control(HOB, parcel, 'MAX_B_H'), lep_fsr=control(FSR, parcel, 'FSR'), titles=len(p['addresses'])))
        blds += rows
    global BUILT, REMOVED
    BUILT = used                                                      # the lots this scenario builds on: not context
    # the buildings the scenario takes away, by address (`removed`): neither standing nor context, so the plan, the
    # massing and the sun study read the land as cleared
    REMOVED = {str(prop(a_)['propid']) for a_ in scn.get('removed', [])}
    existing = []
    for r in OTHERS:
        if str(r['propid']) in used or str(r['propid']) in REMOVED or str(r['propid']) in retained_for(scn):
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
        vals['site.fsr'] = f'{site_yield()[0]:.1f}'
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


SITE_TOWER, SITE_BOX, SITE_PODIUM, TOWER_OWN, SITE_TIERS = None, None, 0, False, []
BASE_TOWER = inset(SITE_POLY, TOWER['setbacks']) if TOWER else SITE_POLY.buffer(-1.0, join_style=2)


def face_run(poly, side):
    """A footprint's face on one side as (start, end): its longest edge facing that way, from its north end (east and
    west) or its east end (south and north)."""
    want = {'east': (1, 0), 'west': (-1, 0), 'south': (0, -1), 'north': (0, 1)}[side]
    cs = list(poly.exterior.coords)
    if not poly.exterior.is_ccw:
        cs = cs[::-1]
    best = None
    for p, q in zip(cs[:-1], cs[1:]):
        L = math.dist(p, q)
        if L >= 1 and ((q[1] - p[1]) * want[0] - (q[0] - p[0]) * want[1]) / L > 0.7 and (best is None or L > best[0]):
            best = (L, p, q)
    if not best:
        return None
    k = 1 if want[0] else 0
    return (best[1], best[2]) if best[1][k] > best[2][k] else (best[2], best[1])


def cut_slots(poly, plan_):
    """A footprint with the slots its plan leaves open: a stretch of a face without an apartment that names a depth
    (`[null, width, depth]`, the corridor's end open to the air) is cut that deep into the building."""
    out = poly
    for side, lst in (plan_ or {}).items():
        run = face_run(poly, side) if side in ('east', 'west', 'south', 'north') else None
        if not run:
            continue
        (sx, sy), (ex, ey) = run
        L = math.dist(run[0], run[1])
        ux, uy = (ex - sx) / L, (ey - sy) / L
        nx, ny = -uy, ux
        c = poly.representative_point()
        if (c.x - sx) * nx + (c.y - sy) * ny < 0:
            nx, ny = -nx, -ny                                         # inward
        for name, a, b, depth in unit_spans(lst, L):
            if name is None and isinstance(depth, (int, float)) and depth > 0:
                at = lambda t, d: (sx + ux * t + nx * d, sy + uy * t + ny * d)
                out = out.difference(Polygon([at(a, -0.5), at(b, -0.5), at(b, depth), at(a, depth)]))
    return largest(out)


def tiers_for(tw):
    """Our building as the storeys that share a footprint, bottom to top: the ground floor over the lot, the podium's
    upper levels (held off a street by `podiumSetbacks`), the tower, and the tower again from each storey a `steps`
    entry pushes it further back; dicts of poly, s0 and s1 (storeys, the ground floor 1), homes (the group whose
    apartments its walls carry) and floor0 (its first storey's index within that group)."""
    N = S['storeys']
    if not tw:
        return [dict(poly=SITE_POLY.buffer(-1.0, join_style=2), s0=1, s1=N, homes='all', floor0=0)]
    P, hf = tw.get('podium', 0), tw.get('homesFrom')
    upper = inset(SITE_POLY, tw['podiumSetbacks']) if tw.get('podiumSetbacks') else SITE_POLY
    tiers = []
    if P and hf and 1 < hf <= P:
        tiers += [dict(poly=SITE_POLY, s0=1, s1=hf - 1, homes='none', floor0=0), dict(poly=upper, s0=hf, s1=P, homes='podium', floor0=0)]
    elif P and hf == 1:
        tiers.append(dict(poly=upper, s0=1, s1=P, homes='podium', floor0=0))
    elif P:
        tiers.append(dict(poly=SITE_POLY, s0=1, s1=P, homes='none', floor0=0))
    steps = [st for st in tw.get('steps', []) if P + 1 < st['from'] <= N]
    cuts = sorted({P + 1} | {st['from'] for st in steps})
    for i, a in enumerate(cuts):
        sb = dict(tw['setbacks'])
        for st in steps:
            if st['from'] <= a:
                for name, v in st['setbacks'].items():
                    sb[name] = max(sb.get(name, 0), v)                # a step only ever pushes further back
        tiers.append(dict(poly=cut_slots(inset(SITE_POLY, sb), (tw.get('units') or {}).get('tower')), s0=a, s1=cuts[i + 1] - 1 if i + 1 < len(cuts) else N,
                          homes='tower', floor0=a - (P + 1)))
    return tiers


def tier_z(t):
    """A tier's bottom and top, metres over the ground."""
    return (H_of(t['s0'] - 1) if t['s0'] > 1 else 0.0), H_of(t['s1'])


def ours_for(band):
    """Our tower's footprint at the lowest storey of an ADG band, which is where it stands nearest its neighbours:
    the tier that holds that storey."""
    want = {'low': SITE_PODIUM + 1, 'mid': max(SITE_PODIUM + 1, 5), 'tall': max(SITE_PODIUM + 1, 9)}[band]
    towers = [t for t in SITE_TIERS if t['homes'] in ('tower', 'all')]
    return next((t['poly'] for t in towers if t['s0'] <= want <= t['s1']), towers[-1]['poly'] if towers else SITE_TOWER)


BASE_STOREYS = S['storeys']                                         # our storeys as the study states them


def set_tower(scn=None):
    """Our tower for a scenario: the study's site.tower, with whatever the scenario's own `site.tower` replaces."""
    global TOWER, SITE_TOWER, SITE_BOX, SITE_PODIUM, TOWER_OWN, SITE_TIERS
    # a scenario's own `site.storeys` builds our building to another height for that sheet
    S['storeys'] = ((scn or {}).get('site') or {}).get('storeys') or BASE_STOREYS
    base = S.get('tower') or {}
    own = ((scn or {}).get('site') or {}).get('tower') or {}
    TOWER = {**base, **own} if base or own else None
    TOWER_OWN = bool(own)
    if TOWER and TOWER.get('toCentre'):                               # so many metres from a road's middle, as the neighbours'
        TOWER['setbacks'] = dict(TOWER['setbacks'])
        for name, v in TOWER['toCentre'].items():
            runs_ = [r for r in boundary_runs(SITE_POLY) if r['kind'] == 'street' and norm_road(r['name']) == norm_road(name)]
            if runs_:
                r0 = max(runs_, key=lambda r: r['line'].length)
                ax = axis_near(name, r0['line'])
                TOWER['setbacks'][name] = max(0.0, v - (ax.distance(r0['line'].interpolate(0.5, normalized=True)) if ax is not None else r0['half']))
    SITE_TOWER = inset(SITE_POLY, TOWER['setbacks']) if TOWER else SITE_POLY.buffer(-1.0, join_style=2)
    SITE_PODIUM = TOWER.get('podium', 0) if TOWER else 0
    SITE_TIERS = tiers_for(TOWER)
    SITE_BOX = SITE_TOWER                                             # the tower's outline before its slots are cut: what its apartments are laid along
    towers = [t for t in SITE_TIERS if t['homes'] == 'tower']
    if towers:
        SITE_TOWER = towers[0]['poly']                                # the tower as it stands at its lowest level, slots and all


set_tower()
BASE_GBA = tiers_gba(SITE_TIERS)                                      # our floor space as the study's own plans have it


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
ADG = {'tall': (24, 18, 12), 'mid': (18, 13.5, 9), 'low': (12, 9, 6)}


def adg_band(n):
    return 'tall' if n >= 9 else 'mid' if n >= 5 else 'low'



# ---- the setbacks each new building keeps from its own lot's boundaries ------------------------------------------
# ADG 3F-1 asks each building for half the separation to a side or rear boundary with another lot: 6 m to
# habitable rooms and 3 m to a blank wall up to four storeys, 9 and 4.5 at five to eight, 12 and 6 at nine and over.
# A wall built on the boundary is a party wall and must be blank; a street or lane frontage is the council's setback
# (its DCP), so it is measured and shown, not judged here.
HALF = {'tall': (12, 6), 'mid': (9, 4.5), 'low': (6, 3)}


RUNS_CACHE = {}


def boundary_runs(parcel):
    """The parcel's boundary in runs: each a straight-ish stretch facing one neighbouring lot or one street; dicts of
    kind ('lot' or 'street'), name and line."""
    key_ = parcel.wkb
    if key_ in RUNS_CACHE:
        return RUNS_CACHE[key_]
    if not parcel.exterior.is_ccw:
        parcel = Polygon(list(parcel.exterior.coords)[::-1])
    others = [r for r in PROPS.values() if r['poly'].distance(parcel) < 3 and r['poly'].intersection(parcel).area < 1]
    cs = list(parcel.exterior.coords)
    edges = []
    for p, q in zip(cs[:-1], cs[1:]):
        L = math.dist(p, q)
        if L < 0.3:
            continue
        nx, ny = (q[1] - p[1]) / L, -(q[0] - p[0]) / L                # outward, the ring anticlockwise
        m = Point((p[0] + q[0]) / 2 + nx * 1.5, (p[1] + q[1]) / 2 + ny * 1.5)
        hit = next((r for r in others if r['poly'].contains(m)), None)
        if hit:
            kind, name = 'lot', short(hit['base'])
        else:
            road = min(ROADS, key=lambda n: min(l.distance(m) for l in ROADS[n])) if ROADS else 'street'
            kind, name = 'street', road.title()
        edges.append(dict(kind=kind, name=name, p=p, q=q, ang=math.atan2(q[1] - p[1], q[0] - p[0])))
    runs = []
    for e in edges:
        last = runs[-1] if runs else None
        if last and last['kind'] == e['kind'] and last['name'] == e['name'] and abs((e['ang'] - last['ang'] + math.pi) % (2 * math.pi) - math.pi) < math.radians(25):
            last['pts'].append(e['q'])
        else:
            runs.append(dict(kind=e['kind'], name=e['name'], ang=e['ang'], pts=[e['p'], e['q']]))
    if len(runs) > 1 and runs[0]['kind'] == runs[-1]['kind'] and runs[0]['name'] == runs[-1]['name'] and abs((runs[0]['ang'] - runs[-1]['ang'] + math.pi) % (2 * math.pi) - math.pi) < math.radians(25):
        runs[0]['pts'] = runs[-1]['pts'][:-1] + runs[0]['pts']
        runs.pop()
    # a street run knows half its road's width: half the way to the lots across it, which is where its middle is
    across = [r for r in PROPS.values() if r['poly'].distance(parcel) < 45 and r['poly'].intersection(parcel).area < 1]
    out = []
    for r in runs:
        line = LineString(r['pts'])
        row = dict(kind=r['kind'], name=r['name'], line=line)
        if r['kind'] == 'street':
            (ax, ay), (bx, by) = r['pts'][0], r['pts'][-1]
            L = math.hypot(bx - ax, by - ay) or 1.0
            nrm = ((by - ay) / L, -(bx - ax) / L)                     # outward, the ring anticlockwise
            widths = []
            for t in (0.2, 0.35, 0.5, 0.65, 0.8):
                m = line.interpolate(t, normalized=True)
                ray = LineString([(m.x + nrm[0] * 0.3, m.y + nrm[1] * 0.3), (m.x + nrm[0] * 45, m.y + nrm[1] * 45)])
                hits = [m.distance(q['poly'].intersection(ray)) for q in across if q['poly'].intersects(ray)]
                if hits:
                    widths.append(min(hits))
            ax = axis_near(r['name'], line)
            if ax is not None and ax.distance(line) < 30:
                half = ax.distance(line.interpolate(0.5, normalized=True))
            elif widths:
                half = sorted(widths)[len(widths) // 2] / 2
            else:
                half = min((l.distance(line) for l in ROADS.get(norm_road(r['name'])) or []), default=3.0)
            row.update(half=half, normal=nrm)
        out.append(row)
    RUNS_CACHE[key_] = out
    return out


def compass4(dx, dy):
    a = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    return ['north', 'east', 'south', 'west'][int((a + 45) // 90) % 4]


def boundary_setbacks(parcels, blds):
    """For every new building above its podium, the distance from its footprint to each run of its own lot's
    boundary, judged against the ADG's half where the run faces another lot: {key: [row]}, each row a dict of
    kind, name, side, d, hab, blank, verdict and the two points of its dimension line."""
    out = {}
    for pc in parcels:
        mains = [b for b in blds if b['key'] == pc['key'] and b['typ'] not in ('podium', 'consent')]
        if not mains:
            continue
        runs = boundary_runs(pc['poly'])
        rows = []
        for run in runs:
            if run['line'].length < 6:                                 # a corner splay is not a frontage
                continue
            # where a lot carries more than one tower, each of its boundaries is read from the tower nearest it
            for b in [min(mains, key=lambda b_: b_['poly'].distance(run['line']))]:
                hab, blank = HALF[adg_band(b['n'])]
                g = b['poly']
                d = g.distance(run['line'])
                q1, q2 = nearest_points(g, run['line'])
                c = g.centroid
                side = compass4(q2.x - c.x, q2.y - c.y) if d >= 0.5 else compass4(run['line'].centroid.x - c.x, run['line'].centroid.y - c.y)
                up = sc.get('streetSetback', 0) if (b.get('base') or 0) > 0 else 0
                if run['kind'] == 'street':
                    v = 'street' if not up else 'street ok' if d >= up - 0.05 else 'street flush'
                elif d < 0.5:
                    v = 'party wall'
                else:
                    v = 'clear' if d >= hab - 0.05 else 'one face blank' if d >= blank - 0.05 else 'short of a blank face'
                row = dict(kind=run['kind'], name=run['name'], side=side, d=d, hab=hab, blank=blank, up=up, verdict=v, p0=(q1.x, q1.y), p1=(q2.x, q2.y), key=b['key'],
                           e0=(q1.x, q1.y), e1=(q2.x, q2.y))                # the tower to its lot's edge, the podium's face
                if run['kind'] == 'street':                            # to the middle of the road: half its width past the boundary
                    ax = axis_near(run['name'], run['line'])
                    if ax is not None and ax.distance(run['line']) < 30:
                        c1, c2 = nearest_points(g, ax)
                        row.update(dc=c1.distance(c2), p0=(c1.x, c1.y), p1=(c2.x, c2.y))
                    else:
                        hw, nrm = run['half'], run['normal']
                        row.update(dc=d + hw, p0=(q1.x, q1.y), p1=(q2.x + nrm[0] * hw, q2.y + nrm[1] * hw))
                rows.append(row)
        out[pc['key']] = rows
    return out


def road_pairs(blds, parcels=()):
    """Two new buildings across a road from each other, within 32 m: the distance between them split at the road's
    centreline, judged as the ADG's separation at the lower one's height; rows for the setback table."""
    mains = [b for b in blds if b['typ'] not in ('podium', 'consent')]
    out = {}
    for i, a in enumerate(mains):
        for b in mains[i + 1:]:
            if a['key'] == b['key'] or a['poly'].distance(b['poly']) > 32:
                continue
            q1, q2 = nearest_points(a['poly'], b['poly'])
            mid = centre_between((q1.x, q1.y), (q2.x, q2.y))
            if mid is None:
                continue
            # only two that face each other across the road: their footprints overlap along it. Corner to corner
            # across a junction no window looks at another, and the line is not drawn
            ax = min((l for ls in road_axes().values() for l in ls), key=lambda l: l.distance(Point(mid)))
            (x0, y0), (x1, y1) = ax.coords[0], ax.coords[-1]
            L = math.hypot(x1 - x0, y1 - y0) or 1.0
            along = lambda g: [((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / L for x, y in g.exterior.coords]
            ta, tb = along(a['poly']), along(b['poly'])
            if min(max(ta), max(tb)) - max(min(ta), min(tb)) < 3:
                continue
            d = q1.distance(q2)
            hab, blank, _ = ADG[adg_band(min(a['n'], b['n']))]
            both = ADG[adg_band(min(a['n'], b['n']))][2]
            v = 'clear' if round(d) >= hab else 'one face blank' if round(d) >= blank else 'both faces blank' if round(d) >= both else 'short of a blank face'
            road = min(ROADS, key=lambda nm: min(l.distance(Point(mid)) for l in ROADS[nm]))
            out.setdefault(a['key'], []).append(dict(kind='pair', name=road.title(), other=b['key'], side='', d=d, a=math.dist((q1.x, q1.y), mid),
                                                     b=math.dist(mid, (q2.x, q2.y)), hab=hab, blank=blank, verdict=v, p0=(q1.x, q1.y), p1=(q2.x, q2.y), mid=mid, key=a['key']))
    return out


BOUND_COLOUR = {'clear': '#1f8f3a', 'one face blank': '#c77d00', 'both faces blank': '#c77d00', 'party wall': '#c77d00', 'short of a blank face': '#c0161c', 'street': '#666', 'street ok': '#1f8f3a', 'street flush': '#c77d00'}


def bounds_text(rows):
    """One line for a table: the lot boundaries judged, the streets measured."""
    if not rows:
        return '', None
    bits, worst = [], 0
    near = {}                                                         # a street met on several runs: its nearest
    for r in rows:
        if r['kind'] == 'street' and ((r['name'], r['side']) not in near or r['d'] < near[(r['name'], r['side'])]['d']):
            near[(r['name'], r['side'])] = r
    rows = [r for r in rows if r['kind'] in ('lot', 'pair')] + list(near.values())
    for r in rows:
        if r['kind'] == 'pair':
            mark = {'clear': '✓', 'one face blank': 'one face blank', 'both faces blank': 'both faces blank', 'short of a blank face': f'✗ needs {r["blank"]:g}'}[r['verdict']]
            worst = max(worst, {'clear': 0, 'one face blank': 1, 'both faces blank': 1, 'short of a blank face': 2}[r['verdict']])
            bits.append(f'<span style="color:{BOUND_COLOUR[r["verdict"]]}">{r["other"]} across {r["name"]} {r["d"]:.0f} m ({r["a"]:.0f} + {r["b"]:.0f}) {mark}</span>')
        elif r['kind'] == 'lot':
            mark = {'clear': '✓', 'one face blank': 'blank face', 'party wall': 'party wall, blank', 'short of a blank face': f'✗ needs {r["blank"]:g}'}[r['verdict']]
            worst = max(worst, {'clear': 0, 'one face blank': 1, 'party wall': 1, 'short of a blank face': 2}[r['verdict']])
            bits.append(f'<span style="color:{BOUND_COLOUR[r["verdict"]]}">{r["side"]} {r["d"]:.0f} m {mark}</span>')
        elif r['verdict'] == 'street flush':
            worst = max(worst, 1)
            bits.append(f'<span style="color:{BOUND_COLOUR["street flush"]}">{r["name"]} {r.get("dc", r["d"]):.0f} m to its centre, {r["d"]:.0f} m to the boundary, short of {r["up"]:g}</span>')
        elif r['verdict'] == 'street ok':
            bits.append(f'<span style="color:{BOUND_COLOUR["street ok"]}">{r["name"]} {r.get("dc", r["d"]):.0f} m to its centre ✓</span>')
        else:
            bits.append(f'<span style="color:#888">{r["name"]} {r.get("dc", r["d"]):.0f} m to its centre</span>')
    return ' · '.join(bits), worst


def own_dims(sep, k):
    """Our own tower's setbacks from its podium's edge, the lot's boundary, on every side: to each neighbouring lot's
    boundary and to each street's; facts of the plans."""
    done = set()                                                      # the roads a separation already splits at their middle
    for nm, d, hab, blank, v, geo in sep:
        if geo.get('centre') and d >= 0.5:
            m = Point(geo['ticks'][0])
            done.add(min((n_ for n_ in road_axes() if road_axes()[n_]), key=lambda n_: min(l.distance(m) for l in road_axes()[n_])))
    cs = list(SITE_TOWER.exterior.coords)
    edges = [(p, q) for p, q in zip(cs[:-1], cs[1:]) if math.dist(p, q) >= 1]
    o = []
    for run in boundary_runs(SITE_POLY):
        if run['line'].length < 6:
            continue
        (x0, y0), (x1, y1) = run['line'].coords[0], run['line'].coords[-1]
        L = math.hypot(x1 - x0, y1 - y0) or 1.0

        def along(e):
            (a, b), (c, d_) = e
            return abs((c - a) * (x1 - x0) + (d_ - b) * (y1 - y0)) / (L * math.dist(*e))

        facing = [e for e in edges if along(e) > 0.8]
        if not facing:
            continue
        p, q = min(facing, key=lambda e: run['line'].distance(Point((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2)))
        w, e_ = sorted((p, q), key=lambda c: (c[0], -c[1]))
        t = 0.72 if run['kind'] == 'lot' else 0.28                   # beside the separation's own dimension, not on it
        a = (w[0] + (e_[0] - w[0]) * t, w[1] + (e_[1] - w[1]) * t)
        to = run['line']                                              # the podium's edge, the lot's boundary
        b = to.interpolate(to.project(Point(a)))
        d = math.dist(a, (b.x, b.y))
        if d >= 0.5:
            o += arch_dim([a, (b.x, b.y)], [f'{d:.0f} m'], '#444', k)
    return o


def bound_dims(rows, k, big):
    """The dimensions for the option sheets' plans, architectural: the tower's setback from its podium's edge (its lot's
    boundary) on every side, lot and street alike, and two new buildings across a road, half by half."""
    o = []
    near = {}
    for r in rows:
        if r['kind'] == 'street' and ((r['name'], r['side']) not in near or r['d'] < near[(r['name'], r['side'])]['d']):
            near[(r['name'], r['side'])] = r
    for r in [r for r in rows if r['kind'] in ('lot', 'pair')] + list(near.values()):
        col = BOUND_COLOUR[r['verdict']]
        if r['kind'] == 'pair':
            o += arch_dim([r['p0'], r['mid'], r['p1']], [f'{r["a"]:.0f} m', f'{r["b"]:.0f} m'], col, k)
        elif r['kind'] == 'street':
            if r['d'] >= 0.5:                                         # the tower to the podium's street face
                o += arch_dim([r['e0'], r['e1']], [f'{r["d"]:.0f} m'], col, k)
        elif r['d'] >= 0.5:
            o += arch_dim([r['p0'], r['p1']], [f'{r["d"]:.0f} m'], col, k)
    return o


def face_gap(poly, parcel, mine=None):
    """The gap from our tower's nearest face to a neighbour, square to that face, where the two overlap along it: the
    total and its parts (our face to our boundary, boundary to boundary, their boundary to their face), with the
    points to draw it between. None where they do not overlap along the face, and the diagonal between the nearest
    points is the honest measure."""
    mine = SITE_TOWER if mine is None else mine
    q1, _ = nearest_points(mine, poly)
    cs = list(mine.exterior.coords)
    edges = [(LineString([p, q]).distance(q1), p, q) for p, q in zip(cs[:-1], cs[1:]) if math.dist(p, q) >= 1]
    c0, c1 = mine.representative_point(), poly.centroid

    def looks(e):
        _, p, q = e
        L = math.dist(p, q)
        nx, ny = -(q[1] - p[1]) / L, (q[0] - p[0]) / L
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        if (c0.x - mx) * nx + (c0.y - my) * ny > 0:
            nx, ny = -nx, -ny
        D = math.hypot(c1.x - mx, c1.y - my) or 1.0
        return (nx * (c1.x - mx) + ny * (c1.y - my)) / D

    _, p, q = max((e for e in edges if e[0] <= min(e_[0] for e_ in edges) + 0.05), key=looks)
    u = unit((q[0] - p[0], q[1] - p[1]))
    n = (-u[1], u[0])
    c = mine.representative_point()
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
    d0, d1, d2, d3 = dmax(mine), dmax(SITE_POLY), dmin(parcel), dmin(poly)
    if None in (d0, d1, d2, d3):
        return None
    d2 = min(max(d2, d1), d3)                                         # their boundary lies between ours and their face
    sm = (lo + hi) / 2
    at = lambda dv: (p[0] + u[0] * sm + n[0] * dv, p[1] + u[1] * sm + n[1] * dv)
    mid = centre_between(at(d0), at(d3))
    if mid is not None:
        dc = min(max(out(mid), d1), d2) if d2 - d1 >= 1 else out(mid)   # where it crosses the road's middle
        return dict(total=d3 - d0, parts=(dc - d0, 0.0, d3 - dc), p0=at(d0), p1=at(d3), ticks=[at(dc), at(dc)], centre=True)
    return dict(total=d3 - d0, parts=(d1 - d0, d2 - d1, d3 - d2), p0=at(d0), p1=at(d3), ticks=[at(d1), at(d2)])


ROAD_LINES = None


def centre_between(a, b):
    """Where the line from a to b crosses a road's centreline, if it does: the middle of the road between them."""
    global ROAD_LINES
    if ROAD_LINES is None:
        ROAD_LINES = unary_union([l for ls in road_axes().values() for l in ls])
    x = LineString([a, b]).intersection(ROAD_LINES)
    if x.is_empty:
        return None
    pts = [g for g in getattr(x, 'geoms', [x]) if g.geom_type == 'Point']
    if not pts:
        return None
    m = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    q = min(pts, key=lambda g: g.distance(m))
    return (q.x, q.y)


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
        # every band the two buildings share, each from our tower as it stands at that band's levels (a stepped tower
        # stands nearer low down, where less is asked); the row is the band that reads worst, the taller on a tie
        bands = ('low', 'mid', 'tall')
        worst = None
        for band_ in bands[:bands.index(adg_band(min(n, S['storeys']))) + 1]:
            ours = ours_for(band_)
            geo = face_gap(poly, parcel, ours)
            if geo is None:
                q1, q2 = nearest_points(ours, poly)
                geo = dict(diag=(q1, q2))
                d = ours.distance(poly)
            else:
                d = geo['total']
            hab, blank, both = ADG[band_]
            dd = round(d)        # the verdict on the metre the sheet prints
            verdict = 'clear' if dd >= hab else 'one face blank' if dd >= blank else 'both faces blank' if dd >= both else 'short of a blank face'
            rank = ('clear', 'one face blank', 'both faces blank', 'short of a blank face').index(verdict)
            if worst is None or rank >= worst[0]:
                worst = (rank, d, hab, blank, verdict, geo)
        _, d, hab, blank, verdict, geo = worst
        geo['new'] = new
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


def label_roads(window=None, k=1.0, beside=False, fs=None):
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
        out.append(f'<text transform="translate({f(m.x)},{f(-m.y)}) rotate({f(ang)})" class="st" font-size="{fs if fs else (1.4 if lane else 1.9) * k}" dy="{(-1.1 if beside else 0.6) * k}">{H.escape(name.title())}</text>')
    return out


def plan(scn, parcels, blds, existing, RET, sep, bset=None):
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
        col = DIM_COLOUR                                              # every dimension black
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
    for rows in (bset or {}).values():                                # each new building's setbacks from its own lot
        near = {}
        for r in rows:
            if r['kind'] == 'street' and ((r['name'], r['side']) not in near or r['d'] < near[(r['name'], r['side'])]['d']):
                near[(r['name'], r['side'])] = r
        for r in [r for r in rows if r['kind'] in ('lot', 'pair')] + list(near.values()):
            if r['kind'] == 'pair':
                dim(*r['p0'], *r['p1'], BOUND_COLOUR[r['verdict']], f'{r["d"]:.0f} m', f'{r["a"]:.0f} + {r["b"]:.0f}', [r['mid']])
            elif r['kind'] == 'street':
                dim(*r['p0'], *r['p1'], BOUND_COLOUR[r['verdict']], f'{r.get("dc", r["d"]):.0f} m')
            elif r['d'] >= 0.5:
                dim(*r['p0'], *r['p1'], BOUND_COLOUR[r['verdict']], f'{r["d"]:.0f} m')
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
    for t in SITE_TIERS:                                              # ours, tier by tier, the storeys on the top one
        z0, z1 = tier_z(t)
        items.append((t['poly'], z0, z1, dict(typ='site', n=t['s1'], base=t['s0'] - 1, label=str(S['storeys']) if t is SITE_TIERS[-1] else None, grp='site')))
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
    for g, n, h, pid in context_buildings(30):                        # the blocks round the study, as they stand, in a lighter grey
        fps = footprints_on(pid)
        st = [(part, 0, hh or h) for part, floors, hh in fps] if fps else steps_of(pid)
        for g_, z0, z1 in (st or [(g, 0, h)]):
            for p in polys(g_):
                if p.area >= 20:
                    flat.append((p, z0, z1, dict(typ='context', n=n, label=None)))
    # each street named at the point of it nearest the blocks, over everything with a halo, so the name sits beside
    # them whatever stands in the way
    centre = study.centroid
    names, marks = [], []
    for name, lines in ROADS.items():
        near = min(lines, key=lambda ls: ls.distance(centre))
        if near.distance(centre) > 60:
            continue
        m = near.interpolate(near.project(centre))
        u, v, _ = proj(m.x, m.y, 0)
        xs += [u - 6, u + 6]; ys.append(v + 2)
        names.append((u, v + 1, name.title()))

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
            if b['typ'] in ('single', 'd18', 'd22', 'block', 'plate', 'site'):
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
            marks.append((u, v + 1.6))
    for u, v, name in names:
        # a street's name that would lie over a building's storeys moves down clear of them
        for mu, mv in marks:
            if abs(u - mu) < 2.2 + 0.9 * len(name) and abs(v - mv) < 3.4:
                v = mv + 4.4
        out.append(f'<text x="{u:.2f}" y="{v:.2f}" class="ast">{H.escape(name)}</text>')
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
    flags.append(f'<b>Our site.</b> {S["storeys"]} storeys as the author states it, not read from the model; {SITE_UNITS} apartments; its density is ' + (f'the file\'s, calculated off the plans, {our_fsr():.1f}:1' if S.get('fsr') else f'read off the massing as this sheet draws it, {EFFICIENCY:.0%} of the envelope, {our_fsr():.1f}:1') + f' over {SITE_AREA:,.0f} m². The model\'s own GFA schedule should replace it.'
                 + (f' The tower is drawn on a {SITE_PODIUM}-storey podium, {SITE_TOWER.area:,.0f} m² a floor at its lowest level, its faces ' + ', '.join(f'{site_setback(n):.0f} m off {n.title()}' for n in TOWER['setbacks']) + ': ' + ('setbacks the scenario sets.' if TOWER_OWN else 'setbacks read off the model\'s plan, to be confirmed in it.') if TOWER else '')
                 + (f' The envelope drawn holds {site_yield()[1]:,.0f} m² GFA at {EFFICIENCY:.0%}; the plans lay out {SITE_UNITS} apartments.' if TOWER else ''))
    if MESH.get('meshes'):
        flags.append(f'<b>What stands.</b> Heights read off Google\'s 3D tiles ({MESH["meshes"]} meshes at {MESH.get("errorM", 0):.0f} m, the roof\'s 80th percentile over the ground round it), {len(mesh_props)} of the {sum(len(b) for b in BLOCKS)} study properties read; storeys at {STOREY_M} m. A starred count is assumed where the tiles hold nothing.')
    else:
        flags.append(f'<b>What stands.</b> No 3D-tile heights were read: the retained buildings are drawn at an assumed {ASSUMED_STOREYS} storeys (starred), the rest at 2.')
    consent = ', '.join(f'{PROPS[pid]["base"].title().replace(" Darlinghurst", "")} at {n}' for pid, n in CONSENT.items())
    if consent:
        flags.append(f'<b>Consents.</b> Storeys assumed, the register holds no record: {consent}.')
    flags.append('<b>Separation.</b> ADG 3F-1: 24 m between habitable rooms or balconies at levels 9 and over, 18 m where one face is blank; 18 and 13.5 m at levels 5 to 8; 12 and 9 below. Each building owes its side or rear boundary with another lot half of them, 12 or 6 m at nine storeys and over, 9 or 4.5 at five to eight, 6 or 3 below, and a wall on the boundary must be blank. Above its podium every tower or slab steps back at least ' + f'{sc.get("streetSetback", 0):g}' + ' m from each street and lane, as our tower does; the council\'s DCP sets the figure. The table on the left reads each neighbour at the levels the two buildings share.')
    flags.append(f'<b>Controls.</b> {H.escape(lep.get("epiName") or "LEP")}: the height and floor space ratio over each parcel in the table, from the plan\'s layers; '
                 + (f'every study lot sits in the {" and ".join(hcas)} heritage conservation area' if hcas else 'no conservation area over the study lots') + (f'; items: {", ".join(items)}' if items else ', and none is a heritage item') + '.')

    return flags

LEGEND = [
    (C['single'], '', '<b>Single loaded footprint</b>, 12 m deep, either orientation'),
    (C['d18'], '', '<b>Double loaded footprint (8 units)</b>, 18 m deep'),
    (C['d22'], '', '<b>Double loaded footprint (10 units)</b>, up to 22 m deep, units facing east and west'),
    (C['block'], '', '<b>Full-lot block</b>, the whole parcel, apartments on every face that is not a party wall'),
    (C['plate'], '', '<b>Deep plate</b>, the lot less its setbacks, no unit depth asked of it'),
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


CONTEXT_M = 200          # how far round the site the scene keeps what stands, whether or not it can shade us


def export_scene(no, blds, existing, RET, sep, parcels=(), scn_parcels=()):
    """Every building of the scenario as prisms, metres east and north of the site, for future_solar.py: ours,
    the scenario's (one per parcel key), what stands, and the window's other measured buildings as context, each on
    its own lot's ground as the tiles read it."""
    lon, lat = (CX / R_MERC) * 180, math.degrees(math.atan(math.exp(CY / R_MERC * math.pi)) * 2 - math.pi / 2)
    names = {nm.split(' · ')[0]: nm for nm, *_ in sep}
    # every prism says which of its walls carry apartments: the ground floor none, a podium's from the storey the
    # scenarios file names (site.tower.homesFrom), a tower's all, a standing building's all
    site_parts = []
    for t in SITE_TIERS:
        z0, z1 = tier_z(t)
        for p in polys(t['poly']):
            part = dict(ring=ring_of(p), z0=z0, z1=z1, homes=t['homes'], floor0=t['floor0'])
            if t['homes'] in ((TOWER or {}).get('units') or {}):      # the plans' apartments, where the file lays them out
                part['units'] = TOWER['units'][t['homes']]
            site_parts.append(part)
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
    low = math.tan(math.radians(17))                                  # the mid-winter sun at nine, with a margin
    for pid, r in PROPS.items():
        if r.get('isSite') or pid in in_blocks or pid in BUILT or pid in REMOVED or not measured(r):
            continue
        # the study window's buildings, every one within CONTEXT_M of the site (what the views round it draw, and
        # what may shade a neighbour though not us), and beyond that every one tall enough to reach the site with
        # its shadow on the mid-winter morning or afternoon (the tiles read what stands up to 300 m off, north, east
        # and west)
        if not r['poly'].intersects(WINDOW.buffer(10)) and r['poly'].distance(SITE_POLY) > CONTEXT_M:
            top = ground_of([r]) + measured(r)
            if top <= 0 or r['poly'].distance(SITE_POLY) > top / low or r['poly'].centroid.y < SITE_POLY.bounds[1] - 20:
                continue
        g = ground_of([r])
        if steps_of(pid):                                              # stepped: a tower on a podium, two towers, as they stand
            parts = [dict(ring=ring_of(p), z0=g + z0, z1=g + z1, homes='all') for g_, z0, z1 in steps_of(pid) for p in polys(g_) if p.area >= 20]
        else:
            parts = [dict(ring=ring_of(p), z0=g, z1=g + measured(r), homes='all') for p in polys(r['poly'])]
        out.append(dict(id=f'context-{pid}', kind='context', name=r['base'], parts=parts))
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
    text = f'{ap["planned"]["share"]:.0%} {mark}'                    # the share alone, as the ADG asks it
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
        text += f' · tower {by["tower"]["planned"]["share"]:.0%} · podium {by["podium"]["planned"]["share"]:.0%}'
    other = r.get('apts_today') if today else r.get('apts_without_site')
    if today and other:
        text += f' (before them {other["planned"]["share"]:.0%})'
    return text, vcol


def sun_verdict(share):
    return 'likely' if share >= 0.7 else 'marginal, the plan must work for it' if share >= 0.5 else 'unlikely'


SUMMARY = []
VERDICT_COLOUR = {'clear': '#1f8f3a', 'one face blank': '#c77d00', 'both faces blank': '#c77d00', 'short of a blank face': '#c0161c', 'likely': '#1f8f3a', 'marginal': '#c77d00', 'unlikely': '#c0161c'}


MINI_PAD = 26          # metres of context round the study on the summary's plans


def context_buildings(reach):
    """The window's other measured buildings within `reach` metres of the study: what stands round it today."""
    skip = {str(r['propid']) for b in BLOCKS for r in b} | {str(SITE['propid'])} | BUILT | REMOVED
    return [(r['poly'], storeys_of(r), measured(r), pid) for pid, r in PROPS.items() if pid not in skip and measured(r) and r['poly'].intersects(study.buffer(reach))]


OPTION_SCALE = 500      # the option sheet's plan, 1:500 on the A3 sheet, so it can be measured and drawn over
OPLAN_MM = (10, 26, 330, 262)   # its left and top on the sheet, the widest it may be, and its height


SCALED_WINDOW = None


def scaled_window():
    """The window of the option sheets' plans at 1:OPTION_SCALE, the same on every sheet of the deck so a sketch over
    one lies over the others: every lot any scenario builds on and ours, out to the middle of each road beside them,
    as tall as the sheet allows and no wider than it allows; (x0, y0, x1, y1)."""
    global SCALED_WINDOW
    if SCALED_WINDOW:
        return SCALED_WINDOW
    content = unary_union([parcel_of(q['addresses']) for scn_ in sc['scenarios'] for q in scn_['parcels']] + [SITE_POLY])
    bx0, by0, bx1, by1 = content.bounds
    axes = [ax for lines in road_axes().values() for ax in lines]
    reach = 14
    def grown(sideways):                                              # the roads' middles beside the lots, that way only
        frame = Polygon([(bx0 - reach, by0), (bx1 + reach, by0), (bx1 + reach, by1), (bx0 - reach, by1)]) if sideways else \
            Polygon([(bx0, by0 - reach), (bx1, by0 - reach), (bx1, by1 + reach), (bx0, by1 + reach)])
        def beside(ax):                                               # a road that runs along that side, not across it
            (ax0, ay0), (ax1, ay1) = ax.coords[0], ax.coords[-1]
            return (abs(ay1 - ay0) > abs(ax1 - ax0)) == sideways
        bits = [ax.intersection(frame) for ax in axes if beside(ax) and ax.intersects(frame) and ax.distance(content) < reach]
        return unary_union([content] + [b for b in bits if not b.is_empty]).bounds
    gx, gy = grown(True), grown(False)
    per_mm = OPTION_SCALE / 1000
    w = min(OPLAN_MM[2] * per_mm, max(gx[2] - gx[0] + 4, 90))
    h = OPLAN_MM[3] * per_mm
    cx, cy = (gx[0] + gx[2]) / 2, (gy[1] + gy[3]) / 2
    SCALED_WINDOW = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    return SCALED_WINDOW


def mini_plan(parcels, blds, existing, RET, sep, k=1.0, big=False, bset=None, window=None):
    """The scenario's plan as colour blocks alone, with the blocks round it: no aerial, no names, the separations
    drawn with their metres, every standing building with its storeys. `k` scales the text and lines (1 for the
    summary's small plans, less for a sheet's); `big` adds the street names, the plates, a scale bar and north;
    `window` (x0, y0, x1, y1) draws that window and no other, for a plan set on its sheet at a scale."""
    x0, y0, x1, y1 = WX0 - MINI_PAD, WY0 - MINI_PAD, WX1 + MINI_PAD, WY1 + MINI_PAD
    if parcels:                                                       # a scenario that builds beyond the study blocks
        bx = unary_union([q['poly'] for q in parcels]).bounds
        x0, y0, x1, y1 = min(x0, bx[0] - 8), min(y0, bx[1] - 8), max(x1, bx[2] + 8), max(y1, bx[3] + 8)
    if window:
        x0, y0, x1, y1 = window
    box = Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    o = [f'<svg viewBox="{f(x0)} {f(-y1)} {f(x1 - x0)} {f(y1 - y0)}" xmlns="http://www.w3.org/2000/svg" style="overflow:hidden"><rect x="{f(x0)}" y="{f(-y1)}" width="{f(x1 - x0)}" height="{f(y1 - y0)}" fill="#f4f2ef"/>']
    for g, n, h, pid in context_buildings(max(MINI_PAD + 20, max(Point(c).distance(study) for c in box.exterior.coords) + 5)):
        if not g.intersects(box):
            continue
        g = g.intersection(box)
        fps = footprints_on(pid)
        st = None if fps else steps_of(pid)
        o.append(f'<path d="{path(g)}" fill="{"#ebebeb" if (fps or st) else "#dcdcdc"}" stroke="#bbb" stroke-width="{0.3 * k:.2f}"/>')
        if fps:                                                       # the building as it is mapped, on its lot
            body = unary_union([x[0] for x in fps]).intersection(box)
            main = max(fps, key=lambda x: x[0].area)
            n = main[1] or (max(1, round(main[2] / STOREY_M)) if main[2] else n)
            if not body.is_empty:
                o.append(f'<path d="{path(body)}" fill="#cfcfcf" stroke="#777" stroke-width="{0.45 * k:.2f}"/>')
                g = max(polys(body), key=lambda q: q.area) if polys(body) else body
        elif st:                                                      # else as the tiles trace it
            body = unary_union([g_ for g_, z0, z1 in st if z1 > 4.5]).intersection(box)
            if not body.is_empty:
                o.append(f'<path d="{path(body)}" fill="#cfcfcf" stroke="#888" stroke-width="{0.45 * k:.2f}"/>')
                g = body
        if g.area >= 120:
            c = g.representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" text-anchor="middle" fill="#777">{n}</text>')
    for b in BLOCKS:
        for r in b:
            o.append(f'<path d="{path(r["poly"])}" fill="#fff" stroke="#ccc" stroke-width="{0.3 * k:.2f}"/>')
    standing = [(PROPS[pid]['poly'], existing_height(PROPS[pid])[1], C['retained'], '#fff') for pid in RET] + [(e['poly'], e['n'], '#e6e6e6', '#444') for e in existing]
    for g, n, fill, ink in standing:
        o.append(f'<path d="{path(g)}" fill="{fill}" stroke="#777" stroke-width="{0.3 * k:.2f}"/>')
    for g, n, fill, ink in standing:                               # what stands today, by its storeys
        if g.area >= 100:
            c = g.representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" text-anchor="middle" fill="{ink}">{n}</text>')
    if big:                                                           # the LEP's heritage items: hatched, they stay
        dev = unary_union([q['poly'] for q in parcels] + [SITE_POLY])
        for g, hid, hname in heritage_items():
            if not g.intersects(box):
                continue
            g = g.intersection(box)
            o.append(f'<path d="{hatch_path(g, 2.0)}" fill="none" stroke="#9a5b1e" stroke-width="0.2"/>')
            o.append(f'<path d="{path(g)}" fill="none" stroke="#9a5b1e" stroke-width="{0.5 * k:.2f}"/>')
            if g.distance(dev) < 14 and g.area >= 80:                 # named where it stands beside a site
                c = g.representative_point()
                o.append(f'<text x="{f(c.x)}" y="{-c.y - 2.2 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#7a4310" paint-order="stroke" stroke="#f4f2ef" stroke-width="{1.2 * k:.2f}">heritage{" " + H.escape(str(hid)) if hid else ""}</text>')
    o.append(f'<path d="{path(SITE_POLY)}" fill="{C["site"]}" stroke="#e11b22" stroke-width="{1.2 * k:.2f}"/>')
    if TOWER:
        o.append(f'<path d="{path(SITE_TOWER)}" fill="#e6b0b0" stroke="#c0161c" stroke-width="{0.5 * k:.2f}"/>')
        if big:
            o += site_tier_lines(k)                                   # the podium's upper levels and the tower's steps
            o += our_units_scheme(k)                                  # the typical floor, as the plans lay it out
    for p in parcels:
        o.append(f'<path d="{path(p["poly"])}" fill="#fff" stroke="#111" stroke-width="{0.8 * k:.2f}"/>')
    for b in blds:
        for g in polys(b['poly']):
            o.append(f'<path d="{path(g)}" fill="{C["podium"] if b["typ"] == "podium" else C[b["typ"]]}" stroke="#222" stroke-width="{0.4 * k:.2f}"/>')
            if big and b['typ'] in ('single', 'd18', 'd22', 'plate'):
                o += bays_scheme(g, b['typ'], k, b.get('streets'))                      # the typical floor the sun study reads, schematically
    fsr_of = {q['key']: q['fsr'] for q in parcels}
    # a label inside a building is haloed in the building's own colour, so the scheme's lines break round it
    halo = lambda col: f'paint-order="stroke" stroke="{col}" stroke-width="{1.4 * k:.2f}" stroke-linejoin="round"' if big else ''
    for b in blds:
        if b['typ'] != 'podium':
            c = b['poly'].representative_point()
            o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#111" {halo(C[b["typ"]])}>{b["n"]}</text>')
            if big and b.get('plate'):
                o.append(f'<text x="{f(c.x)}" y="{-c.y + 6.8 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" text-anchor="middle" fill="#111" {halo(C[b["typ"]])}>{b["plate"]}</text>')
            if big and b['key'] in fsr_of and b['typ'] != 'consent':
                o.append(f'<text x="{f(c.x)}" y="{-c.y + 12.0 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#111" {halo(C[b["typ"]])}>FSR {fsr_of[b["key"]]:.1f}:1</text>')
    for p in parcels:                                                 # the key letter at the parcel's corner, as the sheet has it
        x, y = max(p['poly'].exterior.coords, key=lambda q: q[0] + q[1])
        o.append(f'<circle cx="{f(x)}" cy="{f(-y)}" r="{3.6 * k:.2f}" fill="#111"/><text x="{f(x)}" y="{-y + 1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#fff">{p["key"]}</text>')
    c = SITE_TOWER.centroid
    o.append(f'<text x="{f(c.x)}" y="{-c.y + 1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#c0161c" {halo("#e6b0b0")}>{S["storeys"]}</text>')
    if big:
        # our site's name on the podium north of the tower, where there is room, so the tower keeps its unit scheme clear
        lab_at, fsr_dy = (c.x, c.y - 5.9 * k), 12.0
        cs_ = list(SITE_TOWER.exterior.coords)
        top = max(zip(cs_[:-1], cs_[1:]), key=lambda e: e[0][1] + e[1][1])
        w_, e_ = sorted(top, key=lambda q_: q_[0])                    # a quarter along from its west end, clear of the dimensions
        mx_, my_ = w_[0] + (e_[0] - w_[0]) * 0.16, w_[1] + (e_[1] - w_[1]) * 0.16
        L_ = math.dist(w_, e_) or 1.0
        dx_, dy_ = -(e_[1] - w_[1]) / L_, (e_[0] - w_[0]) / L_          # square to the tower's north face, northwards
        hit = LineString([(mx_ + dx_ * 0.2, my_ + dy_ * 0.2), (mx_ + dx_ * 40, my_ + dy_ * 40)]).intersection(SITE_POLY.exterior)
        if TOWER and not hit.is_empty and Point(mx_, my_).distance(hit) >= 5:
            g_ = Point(mx_, my_).distance(hit) / 2
            lab_at, fsr_dy = (mx_ + dx_ * g_, my_ + dy_ * g_), 6.8
        on_podium = fsr_dy < 10                                       # there, the short name, so it clears the dimension beside it
        o.append(f'<text x="{f(lab_at[0])}" y="{-lab_at[1] + 0.9 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" text-anchor="middle" fill="#c0161c">{H.escape(S.get("label", "our site").split(",")[0] if on_podium else S.get("label", "our site"))}</text>')
        o.append(f'<text x="{f(c.x)}" y="{-c.y + fsr_dy * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="#c0161c" {halo("#e6b0b0")}>FSR {site_yield()[0]:.1f}:1</text>')
        fronts = {norm_road(r_['name']) for q in parcels for r_ in boundary_runs(q['poly']) if r_['kind'] == 'street'}
        fronts |= {norm_road(n_) for n_ in (TOWER or {}).get('setbacks', {}) if norm_road(n_) in ROADS}
        for name_, mid_line in ((nm_, l_) for nm_, ls_ in road_axes().items() for l_ in ls_):   # each road's middle, straight through its junctions
            if norm_road(name_) not in fronts:
                continue
            g_ = mid_line.intersection(box)
            for part in (g_.geoms if hasattr(g_, 'geoms') else [g_]):
                if part.geom_type == 'LineString' and part.length > 2:
                    # dashed black, so a road's middle is never read as a lot's red boundary
                    o.append(f'<path d="M' + ' L'.join(f'{f(x_)} {f(-y_)}' for x_, y_ in part.coords) + f'" fill="none" stroke="#1a1a1a" stroke-width="{0.35 * k:.2f}" stroke-dasharray="{2.4 * k:.2f} {1.4 * k:.2f}"/>')
    for nm, d, hab, blank, v, geo in sep:
        if d < 0.5 or (v == 'clear' and d > 24 and not geo['new']):
            continue
        col = VERDICT_COLOUR[v]
        (ax, ay), (bx, by) = (geo['p0'], geo['p1']) if 'total' in geo else ((geo['diag'][0].x, geo['diag'][0].y), (geo['diag'][1].x, geo['diag'][1].y))
        if big:                                                       # architectural: to the middle of a road half by half, else whole
            if geo.get('centre'):
                a_, _, b_ = geo['parts']
                o += arch_dim([(ax, ay), geo['ticks'][0], (bx, by)], [f'{a_:.0f} m', f'{b_:.0f} m'], col, k)
            else:
                o += arch_dim([(ax, ay), (bx, by)], [f'{d:.0f} m'], col, k)
            continue
        o.append(f'<line x1="{f(ax)}" y1="{f(-ay)}" x2="{f(bx)}" y2="{f(-by)}" stroke="{col}" stroke-width="{1.1 * k:.2f}"/>')
        if geo['new']:
            o.append(f'<text x="{f((ax + bx) / 2)}" y="{-(ay + by) / 2 - 1.5 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="700" text-anchor="middle" fill="{col}" paint-order="stroke" stroke="#fff" stroke-width="{1.6 * k:.2f}">{d:.0f} m</text>')
    if big and bset:
        for rows in bset.values():
            o += bound_dims(rows, k, True)
    if big and TOWER:
        o += own_dims(sep, k)
    if big:
        o += label_roads(box, k * 1.6, beside=True, fs=PLAN_FS * k)
        L = 20
        bx0, by0 = x0 + 4, y0 + 5
        note = f'20 m · 1:{OPTION_SCALE} at A3' if window else '20 m'
        o.append(f'<g transform="translate({f(bx0)} {f(-by0)})"><rect x="{-1.5 * k:.2f}" y="{-4.2 * k:.2f}" width="{L + (2 + 0.6 * PLAN_FS * len(note)) * k:.2f}" height="{7.4 * k:.2f}" fill="#fff" fill-opacity=".85"/>'
                 f'<line x1="0" y1="0" x2="{L}" y2="0" stroke="#111" stroke-width="{0.5 * k:.2f}"/><line x1="0" y1="{-1 * k:.2f}" x2="0" y2="{1 * k:.2f}" stroke="#111" stroke-width="{0.4 * k:.2f}"/>'
                 f'<line x1="{L}" y1="{-1 * k:.2f}" x2="{L}" y2="{1 * k:.2f}" stroke="#111" stroke-width="{0.4 * k:.2f}"/><text x="{L + 2 * k:.2f}" y="{1.6 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" fill="#111">{note}</text></g>')
        o.append(f'<g transform="translate({f(x1 - 7)} {f(-(y0 + 8))})"><circle r="{4 * k:.2f}" fill="#fff" fill-opacity=".9" stroke="#111" stroke-width="{0.4 * k:.2f}"/><path d="M0 {-2.8 * k:.2f} L{1 * k:.2f} {1.5 * k:.2f} L0 {0.7 * k:.2f} L{-1 * k:.2f} {1.5 * k:.2f} Z" fill="#111"/><text y="{-5.2 * k:.2f}" font-size="{PLAN_FS * k:.2f}" font-weight="600" text-anchor="middle" fill="#111">N</text></g>')
    o.append('</svg>')
    return ''.join(o)


def option_page(r):
    """One scenario on a sheet of its own in the summary's form: the plan large with the blocks round it, the
    apartments it adds, whether the neighbours can develop, and the table of separations and sun."""
    def cell(text, verdict):
        return f'<td style="color:{VERDICT_COLOUR.get(verdict, "#111")};font-weight:600">{text}</td>'
    trs = ''
    for b in r['buildings']:
        sun_t, sun_c = b['sun'] if b['sun'] else ('—', '')
        trs += f'<tr><td>{H.escape(b["name"])}</td><td>{b.get("yld", "")}</td>{cell(sun_t, sun_c)}</tr>'
    if r['ours']:
        trs += f'<tr><td><b>Our building</b></td><td>{r.get("ours_yield", "")}</td>{cell(r["ours"][0], r["ours"][1])}</tr>'
    for name, with_, without, loss in r.get('shaded', []):
        mark, vcol = apts_verdict(dict(share=with_, dark=0))
        trs += f'<tr><td>{H.escape(name)}</td><td style="color:#888">—</td>{cell(f"{with_:.0%} {mark}" + (f" · {without:.0%} without our tower, {loss * 100:.0f} points" if without is not None else ""), vcol)}</tr>'
    pw, ph = r['plan_mm']
    cx = OPLAN_MM[0] + pw + 6                                         # the column beside the plan
    cw = 410 - cx
    narrow = cw < 120
    vb = re.search(r'viewBox="([-\d. ]+)"', r['axo'])
    aw, ah = (float(v) for v in vb.group(1).split()[2:]) if vb else (3.0, 2.0)
    css = (f'.oh{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(pw)}}} .oh h1{{margin:0}}'
           f'.oplan{{position:absolute;left:{mm(OPLAN_MM[0])};top:{mm(OPLAN_MM[1])};width:{mm(pw)};height:{mm(ph)}}} .oplan svg{{display:block;width:100%;height:100%}}'
           f'.ocol{{position:absolute;left:{mm(cx)};top:{mm(10 if narrow else OPLAN_MM[1])};width:{mm(cw)};font-size:{pt(7.2)};line-height:1.4}}'
           f'.ocol .u{{font-size:{pt(8)};margin-bottom:{mm(2)}}}'
           f'.ocol table{{font-size:{pt(6.4)}}} .ocol td{{padding:{mm(.6)} {mm(.5)}}} .ocol th{{padding:{mm(.6)} {mm(.5)}}}'
           f'.ob{{border-bottom:{mm(.15)} solid #ccc;padding:{mm(1.3)} 0;font-size:{pt(6.8)};line-height:1.35}} .ob:first-of-type{{border-top:{mm(.3)} solid #111}}'
           f'.obn{{font-weight:700}} .oby{{color:#333}} .obs{{font-weight:600}} .obc{{font-size:{pt(6)};color:#666;margin-bottom:{mm(1.5)}}}'
           f'.oaxo{{width:{mm(cw)};height:{mm(cw * ah / aw)};margin-top:{mm(6)}}} .oaxo svg{{position:static;display:block;width:100%;height:100%}}')
    # the scenario's number is the sheet's heading; its name and what it builds run under it
    head = (f'<div class="oh"><div class="kick">Future context · plan at 1:{OPTION_SCALE} on A3</div><h1>Scenario {r["no"]} of {LAST}</h1>'
            f'<div class="hor"><b style="color:#111">{H.escape(r["title"])}.</b> {H.escape(r["horizon"])}</div></div>')
    warn = ''.join(f'<div class="u" style="color:#c0161c"><b>Site {H.escape(k_)} takes {H.escape(addr)}, heritage item {H.escape(item)}: it cannot be redeveloped.</b></div>' for k_, addr, item in r.get('heritage', []))
    if narrow:
        # beside a wide plan the table is a block a building: its name, its floor space, its sun
        rows = [(H.escape(b['name']), b.get('yld', ''), b['sun'] if b['sun'] else ('—', '')) for b in r['buildings']]
        if r['ours']:
            rows.append(('Our building', r.get('ours_yield', ''), r['ours']))
        note_ = ('Floor space, and the neighbours\' apartments, a rough estimate. Sun: the neighbours\' apartments with 2 continuous hours of winter sun; '
                 'ours, the share of our west and east facades with 2 hours or more, as the facade sheet reads them (our layout is not known yet).') if NO_PLANS else \
            'Floor space and apartments are a rough estimate. Sun: apartments with 2 continuous hours of winter sun.'
        table = (f'<div class="obc">{note_}</div>'
                 + ''.join(f'<div class="ob"><div class="obn">{n_}</div><div class="oby">{y_}</div><div class="obs" style="color:{VERDICT_COLOUR.get(sc_, "#111")}">Sun: {st_}</div></div>' for n_, y_, (st_, sc_) in rows))
    else:
        table = f'<table><tr><th>Building</th><th>FSR, floor space and apartments, a rough estimate</th><th>Apartments with 2 continuous hours of winter sun</th></tr>{trs}</table>'
    col = f'<div class="ocol">{warn}{table}<div class="oaxo">{r["axo"]}</div></div>'
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {r["no"]}</title><style>{CSS}{css}</style></head><body>'
            f'{head}<div class="oplan">{r["big"]}</div>{col}</body></html>')


SUN_LIT, SUN_SHADE = '#f4c242', '#a9a9a9'
SUN_PANEL = 97 / 124            # a view of the sun's-eye sheet, four across and two down: its width to its height


def sun_views(no, sun, hours=(9, 10, 11, 12, 13, 14, 15), reach=32, tall=0.6, aspect=None):
    """The scene seen from the sun at each hour, our apartments lit or in shadow as it sees them: an orthographic
    projection along the sun's ray, every sun-facing wall and roof drawn far to near, our units' spans on their walls
    coloured by the engine's reading at that instant."""
    scene = json.load(open(f'{OUT}/future-scene-{no}.json'))
    site_rec = sun['buildings'].get('site') or {}
    fac_path = f'{OUT}/future-facade-{no}.json'
    fac = json.load(open(fac_path)) if not site_rec.get('units') and os.path.exists(fac_path) else None
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
        far = []                                                       # (name, height, projected points) of the context
        site_b = None
        for b in scene['buildings']:
            if fac and b['kind'] == 'site':                            # ours is drawn below, as one group, tier by tier
                site_b = b
                continue
            fill = fills.get(b['kind'], '#e7e7e7')
            if b['kind'] == 'context':
                ring0 = b['parts'][0]['ring']
                cxy = (sum(q[0] for q in ring0) / len(ring0), sum(q[1] for q in ring0) / len(ring0))
                if math.hypot(*cxy) > 60:
                    far.append((b['name'], max(pt['z1'] for pt in b['parts']) - min(pt['z0'] for pt in b['parts']), [P(x, y, z) for pt in b['parts'] for x, y in pt['ring'] for z in (pt['z0'], pt['z1'])]))
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
                    for side, want in (('east', (1, 0)), ('west', (-1, 0)), ('south', (0, -1)), ('north', (0, 1))):
                        lst = part['units'].get(side, [])
                        if not lst:
                            continue
                        # the wall the units line: the longest straight run of edges facing that way, as one wall from
                        # its north end to its south (east and west) or its east end to its west (south and north),
                        # since the cadastre cuts a lot's side into several collinear edges
                        runs = []
                        for p, q in zip(ring, ring[1:] + ring[:1]):
                            nx, ny = q[1] - p[1], -(q[0] - p[0])
                            L = math.hypot(nx, ny)
                            if not L or (nx * want[0] + ny * want[1]) / L <= 0.7:
                                continue
                            for run in runs:
                                (fx, fy), (gx, gy) = run[0][0], run[0][1]
                                fl = math.hypot(gx - fx, gy - fy)
                                along = abs(((q[0] - p[0]) * (gx - fx) + (q[1] - p[1]) * (gy - fy)) / (L * fl))
                                off = abs(((p[0] + q[0]) / 2 - fx) * (gy - fy) - ((p[1] + q[1]) / 2 - fy) * (gx - fx)) / fl
                                if along > math.cos(math.radians(12)) and off < 1.5:
                                    run.append((p, q))
                                    break
                            else:
                                runs.append([(p, q)])
                        if not runs:
                            continue
                        run = max(runs, key=lambda r: sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in r))
                        pts = [c for e in run for c in e]
                        k_ = 1 if want[0] else 0
                        north, south = max(pts, key=lambda c: c[k_]), min(pts, key=lambda c: c[k_])     # the end it is measured from, and the other
                        L = math.hypot(south[0] - north[0], south[1] - north[1])
                        ux, uy = (south[0] - north[0]) / L, (south[1] - north[1]) / L
                        lit_wall = want[0] * s[0] + want[1] * s[1] > 0
                        nf = max(1, int(round((z1 - z0) / 3.2)))
                        # every unit paints just in front of the wall it sits on, whatever its own storey's depth
                        wall_quad = [P(north[0], north[1], z0), P(south[0], south[1], z0), P(south[0], south[1], z1), P(north[0], north[1], z1)]
                        wall_depth = min(c[2] for c in wall_quad) - 0.05
                        for name, a, bb, corner in unit_spans(lst, L):
                            if name is None:
                                continue
                            for fl in range(nf):
                                ser = series.get((part['homes'], str(name), part.get('floor0', 0) + fl), '')
                                lit = lit_wall and idx < len(ser) and ser[idx] == '1'
                                za, zb = z0 + fl * 3.2, z0 + (fl + 1) * 3.2
                                c0 = (north[0] + ux * a, north[1] + uy * a)
                                c1 = (north[0] + ux * bb, north[1] + uy * bb)
                                quad = [P(c0[0], c0[1], za), P(c1[0], c1[1], za), P(c1[0], c1[1], zb), P(c0[0], c0[1], zb)]
                                if lit_wall:
                                    items.append((wall_depth, quad, SUN_LIT if lit else SUN_SHADE, '#7a6a2a' if lit else '#777'))
                                if b['kind'] == 'site':
                                    ours += quad
        # no plans: our facades as the yield study cuts them (future_facade_sun.py), each cell lit where the engine
        # finds the sun on it at this hour, on the walls the sun faces. Ours is one group in the painter's order, drawn
        # tier by tier from the ground, each tier's walls, the cells on them, then its roof: a tier above may cover one
        # below and never the other way, which ordering the cells by depth alone got wrong at the podium's far end
        if fac and site_b is not None:
            group = []
            for k_part, part in enumerate(sorted(site_b['parts'], key=lambda q: q['z0'])):
                ring, z0, z1 = part['ring'], part['z0'], part['z1']
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    nx, ny = q[1] - p[1], -(q[0] - p[0])
                    L = math.hypot(nx, ny)
                    if L < 1e-6 or (nx * s[0] + ny * s[1]) / L <= 0:
                        continue
                    group.append(([P(p[0], p[1], z0), P(q[0], q[1], z0), P(q[0], q[1], z1), P(p[0], p[1], z1)], fills['site'], '#c0161c'))
                for f_ in fac['faces']:
                    if f_.get('part') != k_part:
                        continue
                    (ax_, ay_), (bx_, by_), (nx_, ny_) = f_['a'], f_['b'], f_['normal']
                    zl_, zh_ = min(storey_bottom(c['storey']) for c in f_['cells']), max(H_of(c['storey']) for c in f_['cells'])
                    ours += [P(ax_, ay_, zl_), P(bx_, by_, zl_), P(bx_, by_, zh_), P(ax_, ay_, zh_)]   # the view framed on the whole building
                    # only the faces the headline counts are drawn in cells; the others stay plain, as the figure leaves them out
                    if f_['blank'] or f_.get('compass') not in HEADLINE_SIDES or nx_ * s[0] + ny_ * s[1] <= 0:
                        continue
                    for c in f_['cells']:
                        za, zb = storey_bottom(c['storey']), H_of(c['storey'])
                        p0 = (ax_ + (bx_ - ax_) * c['t0'], ay_ + (by_ - ay_) * c['t0'])
                        p1 = (ax_ + (bx_ - ax_) * c['t1'], ay_ + (by_ - ay_) * c['t1'])
                        quad = [P(p0[0], p0[1], za), P(p1[0], p1[1], za), P(p1[0], p1[1], zb), P(p0[0], p0[1], zb)]
                        lit = c.get('hourly', '')[hour - 9:hour - 8] == '1'
                        group.append((quad, SUN_LIT if lit else SUN_SHADE, '#7a6a2a' if lit else '#777'))
                group.append(([P(x, y, z1) for x, y in ring], fills['site'], '#c0161c'))
            pts_ = [c for poly_, _, _ in group for c in poly_]
            if pts_:
                items.append((sum(c[2] for c in pts_) / len(pts_), None, group, None))
        items.sort(key=lambda it: -it[0])                            # far first
        xs = [c[0] for c in ours] or [0]
        ys = [c[1] for c in ours] or [0]
        x0, x1, y0, y1 = min(xs) - reach, max(xs) + reach, min(ys) - reach * tall, max(ys) + reach * tall
        if aspect:                                                     # the panel's proportions, about ours, so the view fills it
            w_, h_ = x1 - x0, y1 - y0
            if w_ / h_ < aspect:
                x0, x1 = (x0 + x1) / 2 - h_ * aspect / 2, (x0 + x1) / 2 + h_ * aspect / 2
            else:
                y0, y1 = (y0 + y1) / 2 - w_ / aspect / 2, (y0 + y1) / 2 + w_ / aspect / 2
        clip = f'sv{no}-{hour}'                                         # what reaches past the view is cut at its edge
        svg = [f'<svg viewBox="{x0:.1f} {-y1:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" xmlns="http://www.w3.org/2000/svg"{" preserveAspectRatio=\"xMidYMid slice\"" if aspect else ""}>'
               f'<clipPath id="{clip}"><rect x="{x0:.1f}" y="{-y1:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}"/></clipPath>'
               f'<rect x="{x0:.1f}" y="{-y1:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" fill="#f7f6f3"/><g clip-path="url(#{clip})">']
        for depth, poly, fill, stroke in items:
            for poly_, fill_, stroke_ in (fill if poly is None else [(poly, fill, stroke)]):     # a group: ours, in its own order
                if max(c[0] for c in poly_) < x0 or min(c[0] for c in poly_) > x1 or max(c[1] for c in poly_) < y0 or min(c[1] for c in poly_) > y1:
                    continue                                            # wholly outside the view
                svg.append(f'<polygon points="{" ".join(f"{c[0]:.2f},{-c[1]:.2f}" for c in poly_)}" fill="{fill_}" stroke="{stroke_}" stroke-width="0.25" stroke-linejoin="round"/>')
        # a building far off that stands between the sun and ours is named where it covers us
        ox0, ox1, oy0, oy1 = min(xs), max(xs), min(ys), max(ys)
        for name, height, pts in far:
            if not pts:
                continue
            bx0, bx1 = min(c[0] for c in pts), max(c[0] for c in pts)
            by0, by1 = min(c[1] for c in pts), max(c[1] for c in pts)
            ix, iy = min(ox1, bx1) - max(ox0, bx0), min(oy1, by1) - max(oy0, by0)
            ours_d = sum(c[2] for c in ours) / max(1, len(ours))
            if ix <= 0 or iy <= 0 or ix * iy < 0.15 * (ox1 - ox0) * (oy1 - oy0) or min(c[2] for c in pts) > ours_d:
                continue
            lx = (max(ox0, bx0) + min(ox1, bx1)) / 2
            ly = max(y0 + 6, min(y1 - 4, (max(oy0, by0) + min(oy1, by1)) / 2))
            label = H.escape(f'{short(name)}, {height:.0f} m')
            svg.append(f'<text x="{lx:.1f}" y="{-ly:.1f}" font-size="3.4" font-weight="700" text-anchor="middle" fill="#c0161c" paint-order="stroke" stroke="#fff" stroke-width="1.1">{label}</text>')
        svg.append('</g></svg>')
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
            step = sun.get('step', 10)
            per = max(1, 60 // step) if sun.get('rule', 'hours') == 'hours' else 1   # the instants the rule reads
            run, best, start, bstart = 0, 0, 0, 0
            for i, ch in enumerate(ser):
                if ch == '1':
                    segs += f'<rect x="{((i - 0.5) / (n - 1)) * 100:.2f}%" y="22%" width="{100 / (n - 1):.2f}%" height="56%" fill="{SUN_LIT}"/>'
                if i % per:
                    continue
                if ch == '1':
                    run = run + 1 if run else 1
                    start = i if run == 1 else start
                    if run > best:
                        best, bstart = run, start
                else:
                    run = 0
            if best and (best - 1) * per * step >= 120:
                segs += f'<rect x="{(bstart / (n - 1)) * 100:.2f}%" y="12%" width="{((best - 1) * per / (n - 1)) * 100:.2f}%" height="76%" fill="none" stroke="#1f8f3a" stroke-width="1.2"/>'
            if per > 1:                                                   # the whole hours the rule reads, marked
                segs += ''.join(f'<rect x="{((i - 0.5) / (n - 1)) * 100:.2f}%" y="0" width="{100 / (n - 1):.2f}%" height="100%" fill="{"#1f8f3a" if ser[i:i + 1] == "1" else "#999"}" fill-opacity=".35"/>' for i in range(0, n, per))
            mark = '✓' if ok else '✗'
            col = '#1f8f3a' if ok else '#c0161c'
            rows.append(f'<div class="srow"><div class="sl">{lvl(first + fl)} · {uid} · {side_of.get(uid, "")}</div><div class="sb"><svg width="100%" height="100%">{"".join(f"<line x1=\"{h / 6 * 100:.1f}%\" y1=\"0\" x2=\"{h / 6 * 100:.1f}%\" y2=\"100%\" stroke=\"#ddd\" stroke-width=\"0.6\"/>" for h in range(7))}{segs}</svg></div><div class="sm" style="color:{col}">{mark}</div></div>')
    return rows, ok_n, all_n


def sun_page(no, scn, sun, r):
    """The sun's proof for our apartments in one scenario: the sun's-eye views hour by hour, and the hour chart."""
    if not sun or not (sun['buildings'].get('site') or {}).get('units'):
        return None
    tw = TOWER or {}
    names = {'east': 'Crown Lane', 'west': 'Riley St', 'south': 'Stanley Lane', 'north': 'north'}
    sides = {grp: {str(u[0]): names.get(side, side) for side, lst in (tw.get('units') or {}).get(grp, {}).items() for u in lst if u[0] is not None} for grp in ('podium', 'tower')}
    rows, ok_n, all_n = sun_chart(sun, [('podium', tw.get('homesFrom', 1), sides['podium']), ('tower', SITE_PODIUM + 1, sides['tower'])])
    views = sun_views(no, sun)
    half = (len(rows) + 1) // 2
    row_h = min(3.05, 156 / max(1, half))                              # the chart's 156 mm, shared by a column's rows
    vw = 400 / max(1, len(views))
    view_html = ''.join(f'<div class="sv" style="width:{mm(vw - 2)}"><div class="svt">{H.escape(t)} <span>{H.escape(d)}</span></div>{svg}</div>' for t, d, svg in views)
    css = (f'.sh{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(400)}}} .sh h1{{margin:0}}'
           f'.views{{position:absolute;left:{mm(10)};top:{mm(24)};width:{mm(400)};display:flex;gap:{mm(2)}}}'
           f'.sv{{flex:none;height:{mm(88)}}} .sv svg{{width:100%;height:{mm(82)}}} .svt{{font-size:{pt(7)};font-weight:700;margin-bottom:{mm(.5)}}} .svt span{{font-weight:400;color:#666}}'
           f'.chart{{position:absolute;left:{mm(10)};top:{mm(118)};width:{mm(400)};display:grid;grid-template-columns:1fr 1fr;column-gap:{mm(8)}}}'
           f'.ch{{font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:{mm(1)}}}'
           f'.srow{{display:flex;align-items:center;height:{mm(row_h)};font-size:{pt(5.6 if row_h >= 2.9 else 5.0)};border-bottom:{mm(.1)} solid #eee}}'
           f'.sl{{width:{mm(40)};flex:none;white-space:nowrap;overflow:hidden}} .sb{{flex:1;height:{mm(row_h - 0.45)}}} .sb svg{{display:block}} .sm{{width:{mm(6)};text-align:right;font-weight:700}}'
           f'.hours{{display:flex;justify-content:space-between;margin-left:{mm(40)};margin-right:{mm(6)};font-size:{pt(5.4)};color:#666}}'
           f'.sn{{position:absolute;left:{mm(10)};bottom:{mm(7)};width:{mm(400)};font-size:{pt(6)};color:#555}}')
    hours = '<div class="hours">' + ''.join(f'<span>{h}:00</span>' for h in range(9, 16)) + '</div>'
    head = (f'<div class="sh"><div class="kick">Future context · Scenario {r["no"]} of {LAST} · the sun on our apartments</div><h1>{H.escape(r["title"])}: '
            f'{ok_n} of {all_n} apartments have their two continuous hours</h1>'
            f'<div class="hor">21 June, 9 to 3. Above, the scene as the sun sees it each hour, our apartments lit where it reaches their wall; below, each apartment’s sun against the clock, the whole hours the rule reads marked, and its two hours framed where it has them: sun at three whole hours in a row, as three hourly views show it.</div></div>')
    chart = (f'<div class="chart"><div><div class="ch">Podium and tower, {lvl(tw.get("homesFrom", 1))} to {lvl(S["storeys"])}</div>{hours}{"".join(rows[:half])}</div>'
             f'<div><div class="ch">&nbsp;</div>{hours}{"".join(rows[half:])}</div></div>')
    note = ('<div class="sn">Cast with Loriini’s engine at a metre, every building on its own ground, the scenario standing. An apartment is lit at an instant where at least half of its wall '
            'span at that storey is in sun; the corner apartments on either of their walls. The sun’s-eye view is an orthographic projection along the sun’s ray, so whatever it shows is in sun '
            'and whatever it hides is in shadow. A yellow span is its sun; the marks are the whole hours, green where it is in sun; the green frame is three of them in a row. The ADG asks two hours of direct sunlight '
            'between 9 and 3 (4A-1) and has them shown by the view from the sun; assessors read that at the whole hours, three views in a row, which is how they are counted here, so a run from half past nine '
            'to half past eleven does not count.</div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {r["no"]} · sun</title><style>{CSS}{css}</style></head><body>'
            f'{head}<div class="views">{view_html}</div>{chart}{note}</body></html>')


def sun_eye_page(no, scn, sun, r):
    """A scenario's second sheet in a two-sheet deck: the scene as the sun sees it at each whole hour from
    9 to 3, our apartments lit where it reaches their wall, and the share of them with their two hours."""
    site_rec = (sun or {}).get('buildings', {}).get('site') or {}
    # without the plans' apartments, our facades as the yield study cuts them, where they were read
    bays = not site_rec.get('units')
    if bays and not (site_rec and os.path.exists(f'{OUT}/future-facade-{no}.json')):
        return None
    views = sun_views(no, sun, reach=62, tall=1.05, aspect=SUN_PANEL)
    ap = site_rec['apts']['planned']
    by = site_rec.get('apts_by') or {}
    mark, vcol = apts_verdict(ap)
    col = VERDICT_COLOUR.get(vcol, '#111')
    parts = ' · '.join(f'{name} {by[g]["planned"]["share"]:.0%}' for g, name in (('tower', 'tower'), ('podium', 'podium levels')) if g in by)
    # before the neighbours build: the file's scenario that rebuilds nothing, where it has one (a scenario's own
    # reading without its new buildings leaves out the buildings they replace); none on that scenario's own sheet
    today_row = next((x for x in SUMMARY if not x['scn'].get('parcels')), None)
    if today_row is r:
        before = None
    elif today_row and ((today_row.get('sun') or {}).get('buildings', {}).get('site') or {}).get('apts'):
        before = today_row['sun']['buildings']['site']['apts']
    else:
        before = (site_rec.get('apts_today') or {}).get('planned') and site_rec['apts_today']
        before = before['planned'] if before else None
    if bays:
        # no plans: nothing said of apartments, only of the facade the sun reaches, as the facade sheet reads it
        ff = facade_figures(no, HEADLINE_SIDES) or {}
        w_, t_ = ff.get('with') or dict(two=0.0, none=0.0), ff.get('today')
        base_no = f', scenario {today_row["no"]}' if today_row else ''
        fac_ = json.load(open(f'{OUT}/future-facade-{no}.json'))
        step_note = '; timed to the minute' if fac_.get('step_min', 15) <= 1 else (f'; read every {fac_.get("step_min", 15):g} minutes' if fac_.get('step_min', 15) != 15 else '; read every quarter hour')
        result = (f'<div class="sv res"><div class="big" style="color:#111">{w_["two"]:.0%}</div>'
                  f'<div class="rl">of our {SIDES_WORD} have two hours of sun or more, 9 to 3 on 21 June.</div>'
                  + (f'<div class="rs">The baseline{base_no}: {t_["two"]:.0%}.</div>' if t_ else '')
                  + f'<div class="rs">No sun at all on {w_["none"]:.0%} of them.</div>'
                  f'<div class="rs">Read cell by cell, as the facade sheet reads it: the west face on Riley Street and the east on Crown Lane alone, the north and south faces not counted{step_note}.</div>'
                  f'<div class="key"><span style="background:{SUN_LIT}"></span>facade in sun at that hour<br><span style="background:{SUN_SHADE}"></span>facade in shadow<br>'
                  f'<span style="background:#cdc6c0"></span>the neighbours as this scenario builds them</div></div>')
    else:
        result = (f'<div class="sv res"><div class="big" style="color:{col}">{ap["share"]:.0%}</div>'
                  f'<div class="rl">of our apartments have two hours of sun, 9 to 3 on 21 June. The ADG asks 70 %.</div>'
                  f'<div class="rs">{parts}</div>'
                  f'<div class="rs">No sun at all: {ap["dark"]:.0%}. The ADG allows 15 %.</div>'
                  + (f'<div class="rs">Before the neighbours build: {(before.get("planned") or before)["share"]:.0%}.</div>' if before else '')
                  + f'<div class="key"><span style="background:{SUN_LIT}"></span>apartment in sun at that hour<br><span style="background:{SUN_SHADE}"></span>apartment in shadow<br>'
                  f'<span style="background:#cdc6c0"></span>the neighbours as this scenario builds them</div></div>')
    cells = ''.join(f'<div class="sv"><div class="svt">{H.escape(t)} <span>{H.escape(d)}</span></div>{svg}</div>' for t, d, svg in views) + result
    css = (f'.sh{{position:absolute;left:{mm(10)};top:{mm(9)};width:{mm(400)}}} .sh h1{{margin:0}}'
           f'.views{{position:absolute;left:{mm(10)};top:{mm(27)};width:{mm(400)};height:{mm(262)};display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:1fr 1fr;gap:{mm(4)} {mm(4)}}}'
           f'.sv{{min-width:0;min-height:0;display:flex;flex-direction:column}} .sv svg{{flex:1;min-height:0;width:100%}}'
           f'.svt{{font-size:{pt(9)};font-weight:700;margin-bottom:{mm(1)}}} .svt span{{font-weight:400;color:#666}}'
           f'.res{{justify-content:center;padding:0 {mm(6)}}} .res .big{{font-size:{pt(64)};font-weight:800;line-height:1}}'
           f'.res .rl{{font-size:{pt(10)};font-weight:600;margin:{mm(2)} 0 {mm(4)}}} .res .rs{{font-size:{pt(8.5)};color:#333;margin-bottom:{mm(1.2)}}}'
           f'.res .key{{font-size:{pt(7.5)};color:#444;margin-top:{mm(6)};line-height:1.9}} .res .key span{{display:inline-block;width:{mm(4)};height:{mm(2.6)};margin-right:{mm(2)};vertical-align:middle;border:{mm(.1)} solid #777}}')
    head = (f'<div class="sh"><div class="kick">Future context · the view from the sun</div><h1>Scenario {r["no"]} of {LAST}</h1>'
            f'<div class="hor"><b style="color:#111">{H.escape(r["title"])}.</b> Mid-winter, 21 June, each whole hour from 9 to 3: what the sun sees is in sun, what it cannot see is in shadow.</div></div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {r["no"]} · sun</title><style>{CSS}{css}</style></head><body>'
            f'{head}<div class="views">{cells}</div></body></html>')


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
            trs += f'<tr><td>{H.escape(b["name"])}</td><td>{b.get("yld", "")}</td>{cell(sun_t, sun_c)}</tr>'
        ours = r['ours']
        if ours:
            trs += f'<tr><td><b>Our building</b></td><td>{r.get("ours_yield", "")}</td>{cell(ours[0], ours[1])}</tr>'
        gain = f'About <b>{r["units"]} new apartments</b> on top of ours · ' if r['buildings'] else ''
        rows.append(f'''<div class="row"><div class="mini">{r['mini']}</div><div class="maxo">{r['axo']}</div><div class="info">
<div class="t">{r['no']} · {H.escape(r['title'])}</div>
<div class="u">{gain}neighbours can develop: <b style="color:{r['allow_colour']}">{r['allow']}</b></div>
<table><tr><th>Building</th><th>FSR, floor space and apartments, a rough estimate</th><th>Apartments with 2 continuous hours of winter sun</th></tr>{trs}</table></div></div>''')
    lead = (f'<p class="lead">Each scenario: its plan with the blocks round it as they stand (storeys off the 3D tiles) and its massing, the apartments it adds, and for every new building how far it stands from our tower against the ADG\'s separation (24 m between habitable rooms at nine storeys and over, 18 m where one face is blank, 18 and 13.5 at five to eight) and from its own side and rear boundaries (half of those, 12 or 6 m at nine storeys and over, a party wall blank), and how many of its apartments (the yield\'s count at 85 m² each; ours as the plans have them) get two continuous hours of sun on 21 June, read as ADG 4A-1 reads it and as the convention counts it, sun at three whole hours in a row: apartments in 8 m bays along the walls, both long faces of a double-loaded plan or the better face of a single-loaded one, corner units taking both walls; 70 % with two hours and no more than 15 % with none is a tick, 60 % is close, and the single-loaded figure says what the plan could still reach, facing the way it names. Green holds, amber holds with a condition, red does not. Our tower as the model draws it, {H.escape(plate_of(BASE_TOWER))}, {", ".join(f"{v:g} m off {n.title()}" for n, v in (S.get("tower") or {}).get("setbacks", {}).items())}; a scenario that moves it says so.</p>'
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
    bset = boundary_setbacks(parcels, blds)
    for key_, rows_ in road_pairs(blds, parcels).items():
        bset.setdefault(key_, []).extend(rows_)
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
                rows.append(line(f'   its tower, {lvl(SITE_PODIUM + 1)} to {lvl(S["storeys"])}{per("tower")}', by['tower'], other_by.get('tower')))
                rows.append(line(f'   its podium, {lvl((TOWER or {}).get("homesFrom", 1))} to {lvl(SITE_PODIUM)}{per("podium")}', by['podium'], other_by.get('podium')))
                failing = {}
                for grp, first in (('podium', (TOWER or {}).get('homesFrom', 1)), ('tower', SITE_PODIUM + 1)):
                    for uid, fl, ok_, dark_, *_ in (by[grp].get('each') or []):
                        if not ok_:
                            failing.setdefault(first + fl, []).append(uid + ('*' if dark_ else ''))
                sun_failing.update(failing)
                if failing:
                    rows.append(f'<tr><td colspan="5" style="color:#c0161c">Without their two hours: ' + ' · '.join(f'{lvl(lv)}: {", ".join(ids)}' for lv, ids in sorted(failing.items())) + ' (* no sun at all).</td></tr>')
            else:
                rows.append(line(r['name'], ap, other))
        if scn.get('sun') == 'all' and unchanged:
            rows.append(f'<tr><td colspan="5" style="color:#666">{len(unchanged)} other neighbours our tower changes by under 5 points: {H.escape(", ".join(n.split(",")[0] for n in unchanged))}.</td></tr>')
        sun_html = (f'<h2>Mid-winter sun · apartments with 2 continuous hours on 21 June</h2><table><tr><th style="width:34%">Building</th><th class="r" style="width:13%">As planned</th><th class="r" style="width:14%">Single-loaded</th>'
                    f'<th class="r" style="width:15%">Before them · without ours</th><th>Reads</th></tr>' + ''.join(rows) + '</table>')
        flags.append(f'<b>Sun.</b> Cast over the massing with Loriini\'s engine at a metre, 21 June from 9 to 3, and read as the ADG reads it (4A-1): apartments line each building\'s walls in bays of {sun.get("bay_m", 8):g} m, one a storey, on both long faces of a double-loaded plan or the better face of a single-loaded one, a corner apartment counted once on both its walls; the two hours are continuous and read at whole hours, sun at three in a row as three hourly sun\'s-eye views show it (9, 10 and 11, or 10, 11 and 12, and so on; a run from half past does not count); a bay has them where half its wall at that storey does; 70 % of bays with two hours and no more than 15 % with none is a tick, 60 % is close. Each building is read as planned and as it would be single-loaded, with the scenario standing, and without our tower (ours: with today\'s buildings alone). A wall on a shared boundary is a party wall and holds no apartment; a neighbour\'s podium holds none. Our building is read on the SSDA plans themselves: each apartment at its own wall and storey, the corner ones on both their walls, the tower\'s {units_note("tower")} and the podium\'s {units_note("podium")} from {lvl((TOWER or {}).get("homesFrom", 1))}, its ground floor commercial; its podium, its tower and the whole each read. The neighbours are a massing reading on an assumed plan.')
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
                  f'<p style="margin-top:{mm(2)}">About <b>{units} new apartments</b>{" beside the existing consent" if consents else ""}, on top of the {SITE_UNITS} on our site. Parity: the storeys at which the parcel reaches our density of {our_fsr():.1f}:1.</p>') if parcels else '<p style="margin-top:{mm(2)}">Nothing new round the site: every building at the height the tiles read for it.</p>'
    # every new building, by parcel key: its separation row where it stands within 30 m, else the distance alone
    by_row = {nm.split(' · ')[0]: (nm, d, v) for nm, d, hab, blank, v, geo in sep if geo['new']}
    sunb = (sun or {}).get('buildings', {})
    buildings = []
    for key in dict.fromkeys(b['key'] for b in blds):
        main = [b for b in blds if b['key'] == key and b['typ'] != 'podium'][-1]
        nm, d, v = by_row.get(key, (f'{key} · {TYPE[main["typ"]].split(",")[0].lower()}, {main["n"]} st', SITE_TOWER.distance(main['poly']), 'clear'))
        sr = sunb.get(f'new-{key}')
        gfa_key = next((q['gfa'] for q in parcels if q['key'] == key), 0)
        btxt, bworst = bounds_text(bset.get(key, []))
        pk = next((q for q in parcels if q['key'] == key), None)
        buildings.append(dict(name=nm, d=d, v=v, sun=sun_cell(sr, units=round(gfa_key / UNIT_GFA)), units=round(gfa_key / UNIT_GFA), bounds=btxt, bworst=bworst or 0,
                              yld=yield_text(pk['fsr'], pk['gfa'], round(pk['gfa'] / UNIT_GFA / 5) * 5) if pk else ''))
    ours = sun_cell(sunb.get('site'), today=True) if sunb.get('site') else None
    worst = max((max({'clear': 0, 'one face blank': 1, 'both faces blank': 1, 'short of a blank face': 2}[b['v']], b['bworst']) for b in buildings), default=0)
    # where it is no, say which building and what it is short of
    short_of = [f'{b["name"].split(" · ")[0]} stands {b["d"]:.0f} m from our tower' for b in buildings if b['v'] == 'short of a blank face']
    for key_, rows_ in bset.items():
        for r_ in rows_:
            if r_['verdict'] == 'short of a blank face':
                short_of.append(f'{key_} and {r_["other"]} stand {r_["d"]:.0f} m apart across {r_["name"]}' if r_['kind'] == 'pair'
                                else f'{key_} stands {r_["d"]:.0f} m off {r_["name"]}, where the ADG asks {r_["blank"]:g} m of a blank wall')
    allow = (['yes', 'yes, on the conditions in amber', 'not as drawn: ' + '; '.join(dict.fromkeys(short_of))][worst] if buildings else 'nothing new to allow')
    parts_of = {nm.split(' · ')[0]: geo for nm, d, hab, blank, v, geo in sep if geo['new']}
    for b in buildings:
        g = parts_of.get(b['name'].split(' · ')[0])
        if g and 'total' in g:
            a_, gap_, c_ = g['parts']
            b['parts'] = '+'.join(f'{x:.0f}' for x in ((a_, gap_, c_) if gap_ >= 0.3 else (a_, c_)))
    oy = site_yield()
    if NO_PLANS:
        ours = facade_sun_text(no) or ours
    win = scaled_window()
    k_plan = 0.45 * OPTION_SCALE / 755                              # the text and lines as large on paper as they were
    SUMMARY.append(dict(plan_mm=((win[2] - win[0]) * 1000 / OPTION_SCALE, (win[3] - win[1]) * 1000 / OPTION_SCALE), heritage=HERITAGE_HITS.get(scn['title'], []), ours_yield=(f'FSR {oy[0]:.1f}:1 · GFA {round(oy[1], -1):,.0f} m²' if NO_PLANS else yield_text(oy[0], oy[1], oy[2], about=oy[2] != SITE_UNITS)), no=no, title=scn['title'], horizon=scn.get('horizon', ''), lead=fill_in(scn['lead'], parcels, units), units=units, buildings=buildings, ours=ours,
                        allow=allow, allow_colour=['#1f8f3a', '#c77d00', '#c0161c'][worst], failing=sun_failing, shaded=sun_shaded,
                        mini=mini_plan(parcels, blds, existing, RET, sep), big=mini_plan(parcels, blds, existing, RET, sep, k=k_plan, big=True, bset=bset, window=win),
                        axo=axo(scn, parcels, blds, existing, RET), sun=sun, scn=scn))
    return f'''<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {no}</title><style>{CSS}</style></head><body>
<div class="txt"><div class="kick">Future context · Scenario {no} of {LAST}</div><h1>{H.escape(scn["title"])}</h1><div class="hor">{H.escape(scn["horizon"])}</div>
<p class="lead">{fill_in(scn["lead"], parcels, units)}</p><ul>{lis}</ul>
{yield_html}
{faces}
</div>
{plan(scn, parcels, blds, existing, RET, sep, bset)}
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
# `--only N` (a scenario's number, or `last`) draws that scenario's sheets alone: its option sheet, its full sheet
# and its sun proof, no overview, the other scenarios untouched
ONLY = None
if '--only' in sys.argv:
    v = sys.argv[sys.argv.index('--only') + 1]
    ONLY = len(sc['scenarios']) if v == 'last' else int(v) - FIRST + 1
    if not 1 <= ONLY <= len(sc['scenarios']):
        sys.exit(f'--only {v}: the scenarios run from {FIRST} to {LAST}')
todo = [(i, scn) for i, scn in enumerate(sc['scenarios'], 1) if ONLY in (None, i)]
for i, scn in todo:
    open(f'{OUT}/future-{i}.html', 'w').write(page(FIRST + i - 1, scn))
TWO_SHEET = sc.get('deck') == 'two-sheet'
chunks = []
if ONLY is None and not TWO_SHEET:
    per = math.ceil(len(SUMMARY) / math.ceil(len(SUMMARY) / 8))          # at most eight scenarios a sheet, spread evenly
    chunks = [SUMMARY[i:i + per] for i in range(0, len(SUMMARY), per)]
    for i, part in enumerate(chunks, 1):
        open(f'{OUT}/future-summary-{i}.html', 'w').write(summary_page(part, i, len(chunks)))
sun_pages = []
for (i, _), r in zip(todo, SUMMARY):
    open(f'{OUT}/future-option-{i}.html', 'w').write(option_page(r))
    set_tower(r['scn'])
    html = (sun_eye_page if TWO_SHEET else sun_page)(r['no'], r['scn'], r['sun'], r)
    if html:
        open(f'{OUT}/future-sun-{i}.html', 'w').write(html)
        sun_pages.append(i)
json.dump({'width': PAGE_W, 'height': PAGE_H, 'pages': len(sc['scenarios']), 'summary': len(chunks), 'options': True, 'sun': len(sun_pages),
           'only': ONLY, 'onlyScene': None if ONLY is None else FIRST + ONLY - 1, 'sunPages': sun_pages, 'deck': sc.get('deck')}, open(f'{OUT}/future-page.json', 'w'))
for i, scn in todo:
    set_tower(scn)
    parcels, blds, existing = resolve(scn)
    print(f'scenario {i}: ' + '; '.join(f'{p["key"]} {p["area"]:.0f} m² {p["storeys"]} st GFA {p["gfa"]:.0f} FSR {p["fsr"]:.1f} parity {p["parity"]} plate {p["plate"]} gap {None if p["gap"] is None else round(p["gap"], 1)}' for p in parcels)
          + f'; {len(existing)} left as they stand')
set_tower()
print(f'site {SITE_AREA:.0f} m², our density as drawn {our_fsr():.2f}:1; window {PLAN_W_M:.0f} x {PLAN_H_M:.0f} m at 1:{SCALE}; heights read for {len(mesh_props)} study properties; sheet {PAGE_W} x {PAGE_H} px')

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
from PIL import Image, ImageEnhance
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

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
TYPE = dict(single='Single loaded, 12 m', d18='Double loaded, 18 m', d22='Double loaded, 22 m', consent='As approved', podium='Podium')
C = dict(single='#9c7273', d18='#e3d6cb', d22='#a995ad', podium='#cdc6c0', retained='#8d8d8d', low='#dedede', consent='#b7c3a2', site='#f3d9d9')


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
        best = None
        for ls in road_lines(spec['along']):
            cs = list(ls.coords)
            for p, q in zip(cs[:-1], cs[1:]):
                seg = LineString([p, q])
                d = seg.distance(parcel)
                if best is None or d < best[0]:
                    best = (d, p, q)
        _, p, q = best
        u = unit((q[0] - p[0], q[1] - p[1]))
        road = unary_union(road_lines(spec['along']))
        origin = min(parcel.exterior.coords[:-1], key=lambda v: road.distance(Point(v)))
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
        return parcel, dict(plate=None, gap=None)
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
                            gfa=gfa, fsr=gfa / area, parity=parity, plate=main['plate'], gap=main['gap'], consent=main['typ'] == 'consent',
                            hob=control(HOB, parcel, 'MAX_B_H'), lep_fsr=control(FSR, parcel, 'FSR'), titles=len(p['addresses'])))
        blds += rows
    existing = []
    for r in OTHERS:
        if str(r['propid']) in used or str(r['propid']) in RETAINED:
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
    return re.sub(r'\{([A-Za-z]+(?:\.\w+)?)\}', lambda m: vals.get(m.group(1), m.group(0)), text)


# ---- the sheet: A3 landscape at 300 dpi, as render.py ----------------------------------------------------------
DPI = 300
MM = DPI / 25.4
PT = DPI / 72
PAGE_W, PAGE_H = round(420 * MM), round(297 * MM)
SCALE = 500
PLAN_MM = (92, 10, 184, 236)        # left, top, width, height on the sheet
PLAN_W_M, PLAN_H_M = PLAN_MM[2] * SCALE / 1000, PLAN_MM[3] * SCALE / 1000
study = unary_union([r['poly'] for b in BLOCKS for r in b] + [SITE_POLY := PROPS[next(k for k, r in PROPS.items() if r.get('isSite'))]['poly']])
bx0, by0, bx1, by1 = study.bounds
WX0, WY0 = (bx0 + bx1) / 2 - PLAN_W_M / 2, (by0 + by1) / 2 - PLAN_H_M / 2
WX1, WY1 = WX0 + PLAN_W_M, WY0 + PLAN_H_M
WINDOW = Polygon([(WX0, WY0), (WX1, WY0), (WX1, WY1), (WX0, WY1)])


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


def label_roads():
    out = []
    for name, lines in ROADS.items():
        inside = [ls.intersection(WINDOW.buffer(-4)) for ls in lines]
        segs = [g for g in inside for g in (g.geoms if hasattr(g, 'geoms') else [g]) if g.geom_type == 'LineString' and g.length > 14]
        if not segs:
            continue
        ls = max(segs, key=lambda g: g.length)
        m = ls.interpolate(0.5, normalized=True)
        q = ls.interpolate(0.5 + 2 / ls.length, normalized=True) if ls.length > 4 else Point(ls.coords[-1])
        ang = -math.degrees(math.atan2(q.y - m.y, q.x - m.x))
        ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
        lane = 'LANE' in name
        out.append(f'<text transform="translate({f(m.x)},{f(-m.y)}) rotate({f(ang)})" class="st" font-size="{1.4 if lane else 1.9}" dy="0.6">{H.escape(name.title())}</text>')
    return out


def plan(scn, parcels, blds, existing):
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
    for pid, why in RETAINED.items():
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
    o.append(f'<text x="{f(c.x)}" y="{-c.y - 0.6:.2f}" class="num" fill="#c0161c">{S["storeys"]}</text><text x="{f(c.x)}" y="{-c.y + 2.0:.2f}" class="sub" fill="#c0161c">{H.escape(S.get("label", "our site"))}</text>')
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


def axo(scn, parcels, blds, existing):
    items = []
    for pid, why in RETAINED.items():
        r = PROPS[pid]
        h, n, how = existing_height(r)
        items.append((r['poly'], 0, h, dict(typ='retained', n=n, label=f'{n}{"" if how == "mesh" else "*"}')))
    for e in existing:
        items.append((e['poly'], 0, e['h'], dict(typ='low', n=e['n'], label=None)))
    items.append((SITE_POLY.buffer(-1.0, join_style=2), 0, H_of(S['storeys']), dict(typ='site', n=S['storeys'], label=str(S['storeys']))))
    for b in blds:
        items.append((b['poly'], H_of(b['base']) if b['base'] else 0, H_of(b['n']), dict(typ=b['typ'], n=b['n'], base=b['base'], label=None if b['typ'] == 'podium' else str(b['n']))))
    flat = [(p, z0, z1, b) for g, z0, z1, b in items for p in polys(g)]
    xs, ys, out = [], [], []

    def Pt(x, y, z):
        u, v, _ = proj(x, y, z)
        xs.append(u); ys.append(v)
        return f'{u:.2f},{v:.2f}'

    for b in BLOCKS:
        g = unary_union([r['poly'] for r in b]).buffer(0.3, join_style=2)
        for p in polys(g):
            out.append(f'<polygon points="{" ".join(Pt(x, y, 0) for x, y in p.exterior.coords[:-1])}" fill="#efefef" stroke="#bdbdbd" stroke-width=".25"/>')
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

    def depth(it):
        c = it[0].centroid
        return (round(proj(c.x, c.y, 0)[2] / 1.5), it[1])

    for p, z0, z1, b in sorted(flat, key=depth):
        col = C[b['typ']]
        stroke = '#e11b22' if b['typ'] == 'site' else '#3a3a3a'
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
            if b['typ'] in ('single', 'd18', 'd22', 'site'):
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
.txt{{position:absolute;left:{mm(10)};top:{mm(10)};width:{mm(76)};font-size:{pt(7.4)};line-height:1.42}}
.kick{{font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{pt(17)};line-height:1.1;margin:{mm(1.5)} 0 {mm(1)};font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{pt(7.4)};color:#555;margin-bottom:{mm(3.5)}}}
.lead{{font-size:{pt(8.2)};line-height:1.4;margin:0 0 {mm(3)}}}
ul{{margin:0;padding-left:{mm(3.4)}}} li{{margin-bottom:{mm(1.6)}}}
h2{{font-size:{pt(6.6)};letter-spacing:.06em;text-transform:uppercase;margin:{mm(5)} 0 {mm(1.5)};font-weight:700}}
table{{border-collapse:collapse;width:100%;font-size:{pt(6.3)};font-variant-numeric:tabular-nums}}
th{{text-align:left;font-weight:600;border-bottom:{mm(.3)} solid #111;padding:{mm(.8)} {mm(.5)};vertical-align:bottom}}
td{{border-bottom:{mm(.15)} solid #ccc;padding:{mm(.9)} {mm(.5)};vertical-align:top}}
td.r,th.r{{text-align:right}}
.k{{display:inline-block;width:{mm(3.6)};height:{mm(3.6)};border-radius:50%;background:#111;color:#fff;text-align:center;font-weight:700;font-size:{pt(6)};line-height:{mm(3.6)}}}
.plan{{position:absolute;left:{mm(PLAN_MM[0])};top:{mm(PLAN_MM[1])};width:{mm(PLAN_MM[2])};height:{mm(PLAN_MM[3])}}}
.cap{{position:absolute;font-size:{pt(6.6)};font-weight:700;letter-spacing:.06em;text-transform:uppercase}}
.axo{{position:absolute;left:{mm(280)};top:{mm(16)};width:{mm(130)};height:{mm(150)}}}
.leg{{position:absolute;left:{mm(282)};top:{mm(172)};width:{mm(126)};font-size:{pt(6.8)};line-height:1.35}}
.leg .row{{display:flex;gap:{mm(2.5)};align-items:center;margin-bottom:{mm(1.4)}}}
.sw{{width:{mm(9)};height:{mm(4.2)};border:{mm(.25)} solid #222;flex:none}}
.ass{{position:absolute;left:{mm(282)};top:{mm(222)};width:{mm(126)};font-size:{pt(5.9)};line-height:1.4;color:#444}}
.ass p{{margin:0 0 {mm(1.2)}}}
.foot{{position:absolute;left:{mm(10)};bottom:{mm(8)};font-size:{pt(8.5)};font-weight:700;letter-spacing:.04em}}
.foot span{{display:block;font-weight:400;font-size:{pt(6.4)};letter-spacing:0;color:#555;margin-top:{mm(.8)}}}
svg text{{font-family:Inter,Helvetica,Arial,sans-serif}}
.num{{font-size:3.6px;font-weight:700;text-anchor:middle}}
.sub{{font-size:1.35px;font-weight:500;text-anchor:middle}}
.ret{{font-size:1.3px;font-weight:600;text-anchor:middle;fill:#fff}}
.key{{font-size:1.9px;font-weight:700;text-anchor:middle;fill:#fff}}
.st{{font-weight:700;letter-spacing:.08em;text-anchor:middle;fill:#444;paint-order:stroke;stroke:#fff;stroke-width:0.45px;stroke-linejoin:round}}
.sc{{font-size:1.5px;font-weight:600}}
.an{{font-size:4.4px;font-weight:700;text-anchor:middle}}
.ast{{font-size:2.9px;font-weight:600;text-anchor:middle;fill:#666;letter-spacing:.03em;paint-order:stroke;stroke:#fff;stroke-width:1.1px;stroke-linejoin:round}}
'''

lep = a.get('controls') or {}
hcas = sorted({r.get('inHCA') for b in BLOCKS for r in b if r.get('inHCA')})
items = sorted({r['heritageItem'] for b in BLOCKS for r in b if r.get('heritageItem')})
site_h = measured(SITE)
flags = []
flags.append(f'<b>Our site.</b> {S["storeys"]} storeys as the author states it, not read from the model; {SITE_UNITS} apartments and {SITE_GFA:,.0f} m² GFA {"as given" if S.get("gfaM2") else f"assumed at {UNIT_GFA} m² each"}, so parity is {FSR_PAR:.1f}:1 over {SITE_AREA:,.0f} m². The model\'s own GFA and unit count should replace them.')
mesh_props = [r for b in BLOCKS for r in b if measured(r)]
if MESH.get('meshes'):
    flags.append(f'<b>What stands.</b> Heights read off Google\'s 3D tiles ({MESH["meshes"]} meshes at {MESH.get("errorM", 0):.0f} m, the roof\'s 80th percentile over the ground round it), {len(mesh_props)} of the {sum(len(b) for b in BLOCKS)} study properties read; storeys at {STOREY_M} m. A starred count is assumed where the tiles hold nothing.')
else:
    flags.append(f'<b>What stands.</b> No 3D-tile heights were read: the retained buildings are drawn at an assumed {ASSUMED_STOREYS} storeys (starred), the rest at 2.')
consent = ', '.join(f'{PROPS[pid]["base"].title().replace(" Darlinghurst", "")} at {n}' for pid, n in CONSENT.items())
if consent:
    flags.append(f'<b>Consents.</b> Storeys assumed, the register holds no record: {consent}.')
flags.append(f'<b>Controls.</b> {H.escape(lep.get("epiName") or "LEP")}: the height and floor space ratio over each parcel in the table, from the plan\'s layers; '
             + (f'every study lot sits in the {" and ".join(hcas)} heritage conservation area' if hcas else 'no conservation area over the study lots') + (f'; items: {", ".join(items)}' if items else ', and none is a heritage item') + '.')

LEGEND = [
    (C['single'], '', '<b>Single loaded footprint</b>, 12 m deep, either orientation'),
    (C['d18'], '', '<b>Double loaded footprint (8 units)</b>, 18 m deep'),
    (C['d22'], '', '<b>Double loaded footprint (10 units)</b>, up to 22 m deep, units facing east and west'),
    (C['podium'], '', 'Podium / street wall, 2 to 3 storeys'),
    (C['consent'], '', 'Built under an existing consent'),
    (C['retained'], '', 'Retained in every scenario: ' + ', '.join(PROPS[pid]['base'].title().replace(' Darlinghurst', '') + f' ({why["why"]})' for pid, why in RETAINED.items())),
    (C['site'], ';border-color:#e11b22', f'{SITE["base"].title().replace(" Darlinghurst", "")}, our site: {S["storeys"]} storeys, {SITE_UNITS} units'),
]


def page(no, scn):
    parcels, blds, existing = resolve(scn)
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
    return f'''<!doctype html><html><head><meta charset="utf-8"><title>Future context · Scenario {no}</title><style>{CSS}</style></head><body>
<div class="txt"><div class="kick">Future context · Scenario {no} of {len(sc["scenarios"])}</div><h1>{H.escape(scn["title"])}</h1><div class="hor">{H.escape(scn["horizon"])}</div>
<p class="lead">{fill_in(scn["lead"], parcels, units)}</p><ul>{lis}</ul>
<h2>Indicative yield</h2>
<table><tr><th></th><th>Site</th><th class="r">Site m²</th><th class="r">Storeys</th><th class="r">Height m</th><th class="r">GFA m²</th><th class="r">FSR</th><th class="r">Parity</th></tr>{tr}</table>
<p style="margin-top:{mm(2)}">About <b>{units} new apartments</b>{" beside the existing consent" if consents else ""}, on top of the {SITE_UNITS} on our site. Parity: the storeys at which the parcel reaches our density of {FSR_PAR:.1f}:1.</p>
</div>
{plan(scn, parcels, blds, existing)}
<div class="cap" style="left:{mm(PLAN_MM[0])};top:{mm(PLAN_MM[1] + PLAN_MM[3] + 2.5)}">Plan · 1:{SCALE} @ A3 · storeys on each footprint · the study blocks dashed</div>
<div class="cap" style="left:{mm(282)};top:{mm(10)}">Massing · looking east over Riley Street · our site's envelope as a glass</div>
{axo(scn, parcels, blds, existing)}
<div class="leg">{leg}</div>
<div class="ass"><p><b>Assumptions.</b> Lots from the NSW digital cadastre and property register, as the context plan reads them. Footprints follow the three feasible types, fitted to each parcel from the line they are told to follow, no slab over {MAX_LEN} m. Heights are set by density parity with our site: a site of 1,000 m² or more is assumed to reach that FSR through the same pathway, a smaller one only what one slab between party walls can carry; the table says where parity lands. GFA is {EFFICIENCY:.0%} of the envelope, apartments at {UNIT_GFA} m² GFA each; storeys at 3.2 m over a 4.5 m ground floor. Aerial: NSW Imagery via SIX Maps{(" (" + a["imagery"]["date"][:4] + ")") if (a.get("imagery") or {}).get("date") else ""}, the colour drawn down.</p>
{''.join(f'<p>{x}</p>' for x in flags)}</div>
<div class="foot">{H.escape(SITE["base"].title().replace(" Darlinghurst", "").upper())}, DARLINGHURST · FUTURE CONTEXT SCENARIOS<span>Study area as marked in purple. Predictive only, not a proposal for any neighbouring site. Read {a.get("fetchedAt", "")[:10]}.</span></div>
</body></html>'''


for i, scn in enumerate(sc['scenarios'], 1):
    open(f'{OUT}/future-{i}.html', 'w').write(page(i, scn))
json.dump({'width': PAGE_W, 'height': PAGE_H, 'pages': len(sc['scenarios'])}, open(f'{OUT}/future-page.json', 'w'))
for i, scn in enumerate(sc['scenarios'], 1):
    parcels, blds, existing = resolve(scn)
    print(f'scenario {i}: ' + '; '.join(f'{p["key"]} {p["area"]:.0f} m² {p["storeys"]} st GFA {p["gfa"]:.0f} FSR {p["fsr"]:.1f} parity {p["parity"]} plate {p["plate"]} gap {None if p["gap"] is None else round(p["gap"], 1)}' for p in parcels)
          + f'; {len(existing)} left as they stand')
print(f'site {SITE_AREA:.0f} m², parity {FSR_PAR:.2f}:1; window {PLAN_W_M:.0f} x {PLAN_H_M:.0f} m at 1:{SCALE}; heights read for {len(mesh_props)} study properties; sheet {PAGE_W} x {PAGE_H} px')

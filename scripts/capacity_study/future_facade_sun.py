"""The mid-winter sun on our facades, cell by cell, as the yield study reads it (src/lib/solarAccess.ts facadeSun) and
draws it (src/render/facadeElevation.ts, the compliance sheet's massing): each face of our building cut into cells
about 3 m wide and a storey high, each read at its middle a metre over its floor (the ADG's 4A guidance measures the
sun on the living room's glass a metre above the floor) at the middles of the 24 quarter hours from 9 am to 3 pm on
21 June, AEST. A quarter hour in sun is 0.25 h, the hours counted whether or not they run together. A wall on a party
edge holds no window and is left blank; a face turned from the sun (within 5 degrees) is in its own shade. The cells
are coloured in the yield study's seven bands of hours, the rainbow lorikeet's: none, under 1, 1-2, 2-3, 3-4, 4-5,
5 and over.

Each scenario's cells are read twice: with the scenario standing, and with today's buildings, from the scenarios
file's scenario that rebuilds nothing (the scene with no new building in it). Where the file has none, today is the
scenario with its new buildings taken out, and the sheet says the buildings they replace are missing from it.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_facade_sun.py out/capacity/<slug> --scenarios <file> [--scene n]

Reads the future-scene-<n>.json files future_context.py writes and the scenario titles in the scenarios file, and
writes future-facade-<n>.json and future-facade-<n>.html (an A3 sheet at the deck's size) beside each.
"""
import datetime as dt
import glob
import html as H
import json
import math
import os
import re
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
import numpy as np  # noqa: E402
from shapely.geometry import LineString, Point, Polygon  # noqa: E402
from shapely.geometry.polygon import orient  # noqa: E402
from sun_study.core.geometry import TriangleMesh, prism  # noqa: E402
from sun_study.core.occlusion import Occluder  # noqa: E402
from sun_study.core.solar import solar_position  # noqa: E402

OUT = sys.argv[1]
ONLY = sys.argv[sys.argv.index('--scene') + 1] if '--scene' in sys.argv else None

CELL_M, SILL_M, OFF_M = 3.0, 1.0, 0.05                    # as facadeSun has them
# a face has the sun where the sun stands at least this many degrees off the wall's plane: 5, as the yield study reads
# it; FACADE_MIN_ANGLE sets a stricter reading, so grazing sun is not counted
FACING = math.sin(math.radians(float(os.environ.get('FACADE_MIN_ANGLE', '5'))))
PARTY_M = 0.6
# the instants read: the middles of the quarter hours from 9 to 3, as the yield study reads them, each standing for its
# 15 minutes; FACADE_STEP_MIN reads them finer (1: every minute), so a sun that comes or goes inside a quarter is timed
STEP_MIN = float(os.environ.get('FACADE_STEP_MIN', '15'))
QUARTERS = [9 * 60 + STEP_MIN / 2 + STEP_MIN * i for i in range(int(round(360 / STEP_MIN)))]
STEP_H = STEP_MIN / 60
STEP_WORD = 'quarter hour' if STEP_MIN == 15 else 'minute' if STEP_MIN == 1 else f'{STEP_MIN:g} minutes'
LORIKEET = ['#141B70', '#3440BC', '#8590EE', '#4F9A1E', '#FFE04A', '#FFA01E', '#FF5A3D']
LABELS = ['none', 'under 1 h', '1–2 h', '2–3 h', '3–4 h', '4–5 h', '5 h and over']
UP_TO = [0, 1, 2, 3, 4, 5, math.inf]
BLANK = '#d8d8d8'
C = dict(context='#e2e2e2', standing='#b9b9b9', podium='#cdc6c0', tower='#9fb3a6', site='#f3d9d9')
PAGE_W, PAGE_H = 4961, 3508
MM = PAGE_W / 420
PT = MM * 25.4 / 72


def band(h):
    """The band an hour count falls in: half-open, the boundary in the band above (exactly two hours is 2-3 h)."""
    if h <= 1e-9:
        return 0
    return next((i for i in range(1, 7) if h < UP_TO[i] - 1e-9), 6)


def H_of(n):
    return 4.5 + 3.2 * (n - 1)


def storey_bottom(s):
    return 0.0 if s <= 1 else H_of(s - 1)


def storeys_in(z0, z1):
    """The storeys whose middles lie between two levels over our ground."""
    out, s = [], 1
    while storey_bottom(s) < z1 - 0.01 and s < 200:
        mid = (storey_bottom(s) + H_of(s)) / 2
        if z0 - 0.01 <= mid <= z1 + 0.01:
            out.append(s)
        s += 1
    return out


def level_name(s):
    return 'GF' if s == 1 else f'L{s - 1}'


def seg_dist(p, a, b):
    return LineString([a, b]).distance(Point(p))


def compass(nx, ny):
    az = (math.degrees(math.atan2(nx, ny)) + 360) % 360
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][int((az + 22.5) // 45) % 8]


COMPASS_WORD = dict(N='north', NE='north-east', E='east', SE='south-east', S='south', SW='south-west', W='west', NW='north-west')


# ---- the roads, to name the faces ----------------------------------------------------------------------------------
A_ = json.load(open(os.path.join(OUT, 'analysis.json')))
K_ = A_['k']
SITE_ = next(p for p in A_['props'].values() if p['isSite'])
CX_, CY_ = SITE_['centroid']
ROADS = {}
for r in A_['roads']:
    if not r.get('name'):
        continue
    for path in r['paths']:
        ROADS.setdefault(r['name'], []).append(LineString([((x - CX_) / K_, (y - CY_) / K_) for x, y in path]))


def street_of(mx, my, nx, ny):
    """The road a face looks onto: the nearest to a point a few metres out from it."""
    p = Point(mx + nx * 6, my + ny * 6)
    best = min(ROADS.items(), key=lambda kv: min(l.distance(p) for l in kv[1]), default=None)
    if not best or min(l.distance(p) for l in best[1]) > 14:
        return None
    nm = best[0].title()
    return re.sub(r'\bSt\b', 'Street', re.sub(r'\bLn\b', 'Lane', nm))


# ---- our faces and their cells -------------------------------------------------------------------------------------
def faces_of(bld, residential=False):
    """Each tier's faces of a building: the edges of its outline, outward, with their cells; a face on a party edge
    blank; lowest tier first, each part numbered as it stands in that order. Storeys are counted from the building's
    own ground, its lowest part's foot (`ground` on each face). With `residential`, a part holding no homes (a
    neighbour's podium) is left out."""
    faces = []
    ground = min(q['z0'] for q in bld['parts'])
    for k_part, part in enumerate(sorted(bld['parts'], key=lambda q: q['z0'])):
        if residential and part.get('homes') == 'none':
            continue
        ring = orient(Polygon(part['ring']), sign=1.0).exterior.coords[:-1]       # anticlockwise
        party = part.get('party', [])
        sts = storeys_in(part['z0'] - ground, part['z1'] - ground)
        if not sts:
            continue
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            L = math.dist(a, b)
            if L < 0.3:
                continue
            nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L                         # outward, the ring anticlockwise
            blank = any(seg_dist(a, e[:2], e[2:]) < PARTY_M and seg_dist(b, e[:2], e[2:]) < PARTY_M for e in party)
            k = max(1, round(L / CELL_M))
            cells = [dict(storey=s, t0=j / k, t1=(j + 1) / k) for s in sts for j in range(k)]
            faces.append(dict(part=k_part, homes=part.get('homes'), edge=i, a=list(a), b=list(b), normal=[nx, ny], length=L, blank=blank, ground=ground,
                              compass=compass(nx, ny), street=street_of((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, nx, ny),
                              storeys=sts, cells=cells))
    return faces


def our_faces(site):
    """Our building's faces, every tier, from our ground."""
    return faces_of(site)


def meshes_of(scene, keep=lambda b: True, extra=()):
    ms = []
    for b in list(scene['buildings']) + list(extra):
        if not keep(b):
            continue
        for part in b['parts']:
            if len(part['ring']) >= 3 and part['z1'] > part['z0']:
                ms.append(prism(part['ring'], part['z0'], part['z1']))
    return Occluder(TriangleMesh.concatenate(ms))


def sun_vectors(scene):
    tz = ZoneInfo(scene['timezone'])
    t0 = dt.datetime(scene['year'], 6, 21, 0, 0, tzinfo=tz)
    times = [t0 + dt.timedelta(minutes=m) for m in QUARTERS]
    v = solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu()
    return [vec for vec in np.asarray(v) if vec[2] > math.sin(math.radians(0.5))]


def whole_hour_suns(scene):
    """The sun at each whole hour from 9 to 3, as the view from the sun is drawn; None where it is not up."""
    tz = ZoneInfo(scene['timezone'])
    times = [dt.datetime(scene['year'], 6, 21, h, 0, tzinfo=tz) for h in range(9, 16)]
    v = np.asarray(solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu())
    return [vec if vec[2] > math.sin(math.radians(0.5)) else None for vec in v]


def read_hourly(faces, occ, suns, key):
    """Each cell in sun or not at each whole hour, '1' or '0' an hour from 9, under `key`."""
    for f in faces:
        for c in f['cells']:
            c[key] = ['0'] * len(suns)
    origins, dirs, idx = [], [], []
    for fi, f in enumerate(faces):
        if f['blank']:
            continue
        (ax, ay), (bx, by), (nx, ny) = f['a'], f['b'], f['normal']
        for ci, c in enumerate(f['cells']):
            t = (c['t0'] + c['t1']) / 2
            p = (ax + (bx - ax) * t + nx * OFF_M, ay + (by - ay) * t + ny * OFF_M, f.get('ground', 0.0) + storey_bottom(c['storey']) + SILL_M)
            for hi, s in enumerate(suns):
                if s is None:
                    continue
                hl = math.hypot(s[0], s[1]) or 1.0
                if (s[0] / hl) * nx + (s[1] / hl) * ny <= FACING:
                    continue
                origins.append(p)
                dirs.append(s)
                idx.append((fi, ci, hi))
    if origins:
        hit = occ.any_hit(np.asarray(origins), np.asarray(dirs))
        for (fi, ci, hi), h in zip(idx, hit):
            if not h:
                faces[fi]['cells'][ci][key][hi] = '1'
    for f in faces:
        for c in f['cells']:
            c[key] = ''.join(c[key])


def read_hours(faces, occ, suns, key):
    """Each cell's quarter hours in sun with this occluder, as hours, under `key`."""
    origins, dirs, idx = [], [], []
    for fi, f in enumerate(faces):
        for c in f['cells']:
            c[key] = 0.0
        if f['blank']:
            continue
        (ax, ay), (bx, by), (nx, ny) = f['a'], f['b'], f['normal']
        for ci, c in enumerate(f['cells']):
            t = (c['t0'] + c['t1']) / 2
            p = (ax + (bx - ax) * t + nx * OFF_M, ay + (by - ay) * t + ny * OFF_M, f.get('ground', 0.0) + storey_bottom(c['storey']) + SILL_M)
            for s in suns:
                hl = math.hypot(s[0], s[1]) or 1.0
                if (s[0] / hl) * nx + (s[1] / hl) * ny <= FACING:
                    continue
                origins.append(p)
                dirs.append(s)
                idx.append((fi, ci))
    if origins:
        hit = occ.any_hit(np.asarray(origins), np.asarray(dirs))
        for (fi, ci), h in zip(idx, hit):
            if not h:
                faces[fi]['cells'][ci][key] += STEP_H


# ---- the facades unfolded -------------------------------------------------------------------------------------------
def unfold(faces):
    """Where each face goes along one strip: the lowest tier's outline walked round with its walls on the left, from
    the face that looks most nearly north, each face seen from outside; a face of a tier above stands over the face
    below that looks the same way, where it is in plan. Sets x0 and x1 (metres along the strip) on each face; returns
    the strip's length and its folds."""
    base_part = min(f['part'] for f in faces)
    base = [f for f in faces if f['part'] == base_part]
    same = lambda f, g: f['normal'][0] * g['normal'][0] + f['normal'][1] * g['normal'][1] > math.cos(math.radians(30))
    start = max(range(len(base)), key=lambda i: base[i]['normal'][1])
    # from where the run of faces looking that way begins, so the north faces stand together at the strip's start
    for _ in range(len(base)):
        prev = (start - 1) % len(base)
        if not same(base[prev], base[start]):
            break
        start = prev
    base = base[start:] + base[:start]
    x, folds = 0.0, []
    for i, f in enumerate(base):
        f['x0'], f['x1'] = x, x + f['length']
        x += f['length']
        if i + 1 < len(base) and not same(f, base[i + 1]):           # a fold only at a corner, not at a jog of the lot line
            folds.append(x)
    folds.append(x)
    for f in faces:
        if f['part'] == base_part:
            continue
        twin = next((g for g in base if math.dist(g['a'], f['a']) < 0.3 and math.dist(g['b'], f['b']) < 0.3), None)
        if twin:
            f['x0'], f['x1'] = twin['x0'], twin['x1']
            continue
        cands = [g for g in base if f['normal'][0] * g['normal'][0] + f['normal'][1] * g['normal'][1] > math.cos(math.radians(35))]
        if not cands:
            cands = base
        def along(g, p):
            (ax, ay), (bx, by) = g['a'], g['b']
            L = g['length'] or 1.0
            return ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L
        def score(g):
            s0, s1 = sorted((along(g, f['a']), along(g, f['b'])))
            return min(s1, g['length']) - max(s0, 0)                             # its overlap with the base face
        g = max(cands, key=score)
        s0, s1 = along(g, f['a']), along(g, f['b'])
        # the base faces that look the same way run on round the corner: a face longer than its base face spills on
        f['x0'], f['x1'] = g['x0'] + s0, g['x0'] + s1
    return x, folds[:-1]


def elevation_svg(faces, key, width_mm, title, total):
    """The strip of our facades, cells in their bands, at a scale that fits the width; storeys up the left."""
    L, folds = total
    zmax = max(H_of(max(f['storeys'])) for f in faces)
    left, bottom = 9.0, 9.0                                    # metres of margin for the storey names and face names
    W, Hh = L + left + 2, zmax + bottom + 3
    o = [f'<svg viewBox="{-left:.2f} {-zmax - 3:.2f} {W:.2f} {Hh:.2f}" xmlns="http://www.w3.org/2000/svg" style="width:{width_mm * MM:.0f}px">']
    k = W / width_mm                                           # metres a millimetre, to set text in millimetres
    fs = 2.3 * k
    for f in sorted(faces, key=lambda f: f['part']):
        x0, x1 = f['x0'], f['x1']
        for c in f['cells']:
            z0, z1 = storey_bottom(c['storey']), H_of(c['storey'])
            xa, xb = x0 + (x1 - x0) * c['t0'], x0 + (x1 - x0) * c['t1']
            fill = BLANK if f['blank'] else LORIKEET[band(c[key])]
            o.append(f'<rect x="{min(xa, xb):.2f}" y="{-z1:.2f}" width="{abs(xb - xa):.2f}" height="{z1 - z0:.2f}" fill="{fill}" stroke="#fff" stroke-width="{0.12 * k:.3f}"/>')
    for x in folds:
        o.append(f'<line x1="{x:.2f}" y1="0" x2="{x:.2f}" y2="{-zmax:.2f}" stroke="#111" stroke-width="{0.12 * k:.3f}" stroke-dasharray="{0.8 * k:.2f} {0.6 * k:.2f}"/>')
    o.append(f'<line x1="0" y1="0" x2="{L:.2f}" y2="0" stroke="#111" stroke-width="{0.3 * k:.3f}"/>')
    sts = sorted({s for f in faces for s in f['storeys']})
    for s in sts:
        zm = (storey_bottom(s) + H_of(s)) / 2
        if len(sts) <= 16 or s % 2 == 1:
            o.append(f'<text x="{-1.2 * k:.2f}" y="{-zm + 0.8 * k:.2f}" font-size="{fs:.2f}" text-anchor="end" fill="#555">{level_name(s)}</text>')
    # one name for each run of faces between two folds: the way it looks and the street it looks onto
    base_part = min(f['part'] for f in faces)
    base = sorted((f for f in faces if f['part'] == base_part), key=lambda f: f['x0'])
    edges = [0.0] + list(folds) + [L]
    for x0, x1 in zip(edges[:-1], edges[1:]):
        run = [f for f in base if f['x0'] >= x0 - 0.01 and f['x1'] <= x1 + 0.01]
        if not run or x1 - x0 < 4:
            continue
        top = max(run, key=lambda f: f['length'])
        blank = all(f['blank'] for f in run)
        nm = top['compass'] + (f' · {top["street"]}' if top['street'] and not blank else '') + (' · party wall' if blank else '')
        if len(nm) * fs * 0.55 > x1 - x0:
            nm = top['compass'] + (' · party' if blank else '')
        o.append(f'<text x="{(x0 + x1) / 2:.2f}" y="{4.2 * k:.2f}" font-size="{fs:.2f}" text-anchor="middle" font-weight="600" fill="#111">{H.escape(nm)}</text>')
    o.append('</svg>')
    return f'<div class="elv"><div class="cap">{H.escape(title)}</div>' + ''.join(o) + '</div>'


# ---- the massing, from the street corner and the opposite one ---------------------------------------------------------
def axo_svg(scene, faces, key, view, phi_deg=34.0, reach=58.0, subject='site', centre=(0.0, 0.0)):
    """The scenario's massing round a building (ours by default; `subject` names another by its id, `centre` the point
    the view is gathered round) from `view` (a unit vector in plan toward the viewer), its faces cell by cell in their
    bands, every other building plain, ours pink: far to near, a building's parts lowest first; one standing in front
    of it drawn as glass, so its faces are read through it."""
    vx, vy = view
    dx, dy = -vx, -vy                                          # the way the viewer looks
    rx, ry = dy, -dx                                           # the viewer's right
    cphi, sphi = math.cos(math.radians(phi_deg)), math.sin(math.radians(phi_deg))

    def P(x, y, z):
        return (x * rx + y * ry, -(z * cphi + (x * dx + y * dy) * sphi))

    light = (-0.55, 0.75)                                      # the walls lit from the north-west
    items = []
    for b in scene['buildings']:
        parts = [q for q in b['parts'] if len(q['ring']) >= 3 and q['z1'] > q['z0']]
        parts = [q for q in parts if Polygon(q['ring']).distance(Point(*centre)) < reach]
        if not parts:
            continue
        g = min(parts, key=lambda q: q['z0'])
        c = Polygon(g['ring']).centroid
        items.append((c.x * dx + c.y * dy, b, sorted(parts, key=lambda q: q['z0'])))
    items.sort(key=lambda t: -t[0])
    site_poly = None
    for d_, b, parts in items:
        if b['id'] == subject:
            pts = [P(x, y, z) for q in parts for x, y in q['ring'] for z in (q['z0'], q['z1'])]
            site_poly = Polygon(pts).convex_hull
    o, xs, ys = [], [], []
    seen_site = False
    by_part = {}
    for f in faces:
        by_part.setdefault(f['part'], []).append(f)
    for d_, b, parts in items:
        kind = b['kind']
        is_site = b['id'] == subject                           # the building read, its faces in cells
        ink = '#c0161c' if kind == 'site' else '#111'          # ours outlined red, another subject black
        glass = False
        if not is_site and seen_site and site_poly is not None:
            hull = Polygon([P(x, y, z) for q in parts for x, y in q['ring'] for z in (q['z0'], q['z1'])]).convex_hull
            glass = hull.intersects(site_poly) and hull.intersection(site_poly).area > 1.0
        for k_part, q in enumerate(parts):
            ring = orient(Polygon(q['ring']), sign=1.0).exterior.coords[:-1]
            n = len(ring)
            if kind == 'new':
                base_col = C['podium'] if q.get('homes') == 'none' else C['tower']
            else:
                base_col = C.get(kind, C['context'])
            walls = []
            for i in range(n):
                a, bb = ring[i], ring[(i + 1) % n]
                L = math.dist(a, bb)
                if L < 0.05:
                    continue
                nx, ny = (bb[1] - a[1]) / L, -(bb[0] - a[0]) / L
                if nx * vx + ny * vy <= 1e-6:
                    continue
                walls.append(((a[0] + bb[0]) / 2 * dx + (a[1] + bb[1]) / 2 * dy, a, bb, nx, ny, i))
            walls.sort(key=lambda w: -w[0])
            for _, a, bb, nx, ny, i in walls:
                quad = [P(a[0], a[1], q['z0']), P(bb[0], bb[1], q['z0']), P(bb[0], bb[1], q['z1']), P(a[0], a[1], q['z1'])]
                xs += [p[0] for p in quad]
                ys += [p[1] for p in quad]
                pts = ' '.join(f'{u:.2f},{v:.2f}' for u, v in quad)
                face = next((f for f in by_part.get(k_part, []) if f['edge'] == i), None) if is_site else None
                if is_site and face is not None:
                    if face['blank']:
                        o.append(f'<polygon points="{pts}" fill="{BLANK}" stroke="#888" stroke-width=".1"/>')
                    else:
                        g0 = face.get('ground', 0.0)
                        for c in face['cells']:
                            z0, z1 = g0 + storey_bottom(c['storey']), g0 + H_of(c['storey'])
                            pa = (a[0] + (bb[0] - a[0]) * c['t0'], a[1] + (bb[1] - a[1]) * c['t0'])
                            pb = (a[0] + (bb[0] - a[0]) * c['t1'], a[1] + (bb[1] - a[1]) * c['t1'])
                            cq = [P(pa[0], pa[1], z0), P(pb[0], pb[1], z0), P(pb[0], pb[1], z1), P(pa[0], pa[1], z1)]
                            o.append(f'<polygon points="{" ".join(f"{u:.2f},{v:.2f}" for u, v in cq)}" fill="{LORIKEET[band(c[key])]}" stroke="#fff" stroke-width=".07" stroke-linejoin="round"/>')
                        o.append(f'<polygon points="{pts}" fill="none" stroke="{ink}" stroke-width=".22"/>')
                else:
                    lit = 0.8 + 0.2 * max(0.0, nx * light[0] + ny * light[1])
                    col = shade(base_col, lit)
                    edge_ = '#c0161c' if kind == 'site' else ink if is_site else '#8a8a8a'
                    if glass:
                        o.append(f'<polygon points="{pts}" fill="{col}" fill-opacity=".14" stroke="#666" stroke-width=".12"/>')
                    else:
                        o.append(f'<polygon points="{pts}" fill="{col}" stroke="{edge_}" stroke-width="{".22" if kind == "site" or is_site else ".1"}"/>')
            roof = [P(x, y, q['z1']) for x, y in ring]
            xs += [p[0] for p in roof]
            ys += [p[1] for p in roof]
            rp = ' '.join(f'{u:.2f},{v:.2f}' for u, v in roof)
            if glass:                                          # in front of the building read: glass, roof and all
                o.append(f'<polygon points="{rp}" fill="{base_col}" fill-opacity=".14" stroke="#666" stroke-width=".12"/>')
            elif is_site or kind == 'site':
                o.append(f'<polygon points="{rp}" fill="{C["site"] if kind == "site" else shade(base_col, 1.04)}" stroke="{"#c0161c" if kind == "site" else ink}" stroke-width=".22"/>')
            elif glass:
                o.append(f'<polygon points="{rp}" fill="{base_col}" fill-opacity=".14" stroke="#666" stroke-width=".12"/>')
            else:
                o.append(f'<polygon points="{rp}" fill="{shade(base_col, 1.04)}" stroke="#8a8a8a" stroke-width=".1"/>')
        if is_site:
            seen_site = True
    x0, x1, y0, y1 = min(xs) - 3, max(xs) + 3, min(ys) - 3, max(ys) + 3
    return f'<svg viewBox="{x0:.1f} {y0:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%">' + ''.join(o) + '</svg>'


def shade(hex_, k):
    r, g, b = (int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    f = lambda v: max(0, min(255, round(v * k)))
    return f'#{f(r):02x}{f(g):02x}{f(b):02x}'


# ---- the figures --------------------------------------------------------------------------------------------------
def stats(faces, key):
    """Over the walls that can hold a window: the share of facade area in each band, the mean hours, the share with two
    hours or more; and the same for each way the faces look."""
    rows = {}
    tot = dict(area=0.0, hours=0.0, two=0.0, bands=[0.0] * 7)
    for f in faces:
        if f['blank']:
            continue
        w = f['length'] / max(1, round(f['length'] / CELL_M))
        r = rows.setdefault(f['compass'], dict(area=0.0, hours=0.0, two=0.0, street=set()))
        if f['street']:
            r['street'].add(f['street'])
        for c in f['cells']:
            a = w * (H_of(c['storey']) - storey_bottom(c['storey']))
            for t in (tot, r):
                t['area'] += a
                t['hours'] += a * c[key]
                t['two'] += a * (c[key] >= 2 - 1e-9)
            tot['bands'][band(c[key])] += a
    return tot, rows


def pct(x):
    return f'{x * 100:.0f}%'


def sheet(n, last, title, horizon, faces, has_today, today_from, total):
    keys = ['with', 'today'] if has_today else ['with']
    t_with, r_with = stats(faces, 'with')
    t_today, r_today = stats(faces, 'today') if has_today else (None, None)
    views = [((-0.7071, -0.7071), 'From the corner of Riley Street and Stanley Lane, south-west'),
             ((0.7071, 0.7071), 'From the opposite corner, north-east')]
    scene = json.load(open(os.path.join(OUT, f'future-scene-{n}.json')))
    axos = ''.join(f'<div class="ax"><div class="cap">{H.escape(cap)}</div><div class="axb">{axo_svg(scene, faces, "with", v)}</div></div>' for v, cap in views)
    key = ''.join(f'<span class="kb"><i style="background:{c}"></i>{H.escape(l)}</span>' for c, l in zip(LORIKEET, LABELS)) + f'<span class="kb"><i style="background:{BLANK}"></i>party wall, no window</span>'
    bar = lambda t: '<div class="bar">' + ''.join(f'<i style="background:{LORIKEET[i]};width:{t["bands"][i] / t["area"] * 100:.2f}%"></i>' for i in range(7) if t['area'] and t['bands'][i] > 0) + '</div>'
    line = lambda t: f'{pct(t["two"] / t["area"])} of the facade has two hours or more; on average {t["hours"] / t["area"]:.1f} h'
    order = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    trs = ''
    for d in order:
        if d not in r_with:
            continue
        w = r_with[d]
        st = ', '.join(sorted(w['street']))
        tdy = r_today.get(d) if r_today else None
        tcells = (f'<td class="r">{tdy["hours"] / tdy["area"]:.1f} h</td><td class="r">{pct(tdy["two"] / tdy["area"])}</td>' if tdy and tdy['area'] else '<td></td><td></td>') if has_today else ''
        trs += f'<tr><td>{COMPASS_WORD[d]}{(" · " + H.escape(st)) if st else ""}</td><td class="r">{w["area"]:.0f} m²</td>{tcells}<td class="r"><b>{w["hours"] / w["area"]:.1f} h</b></td><td class="r"><b>{pct(w["two"] / w["area"])}</b></td></tr>'
    th = ('<th class="r">baseline, mean</th><th class="r">baseline, 2 h+</th>' if has_today else '') + ('<th class="r">with it, mean</th><th class="r">with it, 2 h+</th>' if has_today else '<th class="r">mean</th><th class="r">2 h+</th>')
    table = f'<table><tr><th>Our faces, the way they look</th><th class="r">facade</th>{th}</tr>{trs}</table>'
    if has_today:
        strips = (elevation_svg(faces, 'today', 196, f'Unfolded · the baseline, scenario {today_no}', total) + f'<div class="sl">{bar(t_today)}<div>{line(t_today)}.</div></div>'
                  + elevation_svg(faces, 'with', 196, 'Unfolded · with the scenario', total) + f'<div class="sl">{bar(t_with)}<div>{line(t_with)}.</div></div>')
        lead = (f'With the scenario standing, {pct(t_with["two"] / t_with["area"])} of our facade has two hours of sun or more on 21 June, '
                f'against {pct(t_today["two"] / t_today["area"])} in the baseline, scenario {today_no}; on average {t_with["hours"] / t_with["area"]:.1f} h against {t_today["hours"] / t_today["area"]:.1f} h.')
    else:
        strips = elevation_svg(faces, 'with', 196, 'Unfolded · the baseline', total) + f'<div class="sl">{bar(t_with)}<div>{line(t_with)}.</div></div>'
        lead = f'In the baseline, {pct(t_with["two"] / t_with["area"])} of our facade has two hours of sun or more on 21 June; on average {t_with["hours"] / t_with["area"]:.1f} h.'
    # the headline the other sheets give: the west and east faces alone
    def we(rows):
        a_ = sum(rows[d]['area'] for d in ('W', 'E') if d in rows)
        return (sum(rows[d]['two'] for d in ('W', 'E') if d in rows) / a_) if a_ else None
    we_with, we_today = we(r_with), (we(r_today) if r_today else None)
    if we_with is not None:
        lead += f' Its west and east faces alone: {pct(we_with)} with two hours or more' + (f', against {pct(we_today)} in the baseline.' if we_today is not None else '.')
    today_note = '' if today_from != 'missing' else '<p><b>Today here is the scenario with its new buildings taken out: the buildings they replace are missing from it, so today is read with more sun than it has.</b></p>'
    css = f'''@page{{size:{PAGE_W}px {PAGE_H}px;margin:0}} *{{box-sizing:border-box}} html,body{{margin:0;background:#fff}}
body{{width:{PAGE_W}px;height:{PAGE_H}px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
svg text{{font-family:Inter,Helvetica,Arial,sans-serif}}
.hd{{position:absolute;left:{10 * MM:.0f}px;top:{9 * MM:.0f}px;width:{400 * MM:.0f}px}}
.kick{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{17 * PT:.1f}px;line-height:1.1;margin:{1.5 * MM:.0f}px 0 {1 * MM:.0f}px;font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{7.4 * PT:.1f}px;color:#555}}
.axs{{position:absolute;left:{10 * MM:.0f}px;top:{34 * MM:.0f}px;width:{196 * MM:.0f}px;height:{250 * MM:.0f}px;display:flex;flex-direction:column;gap:{4 * MM:.0f}px}}
.ax{{flex:1;display:flex;flex-direction:column;min-height:0}} .axb{{flex:1;min-height:0}}
.cap{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:{1.2 * MM:.0f}px}}
.rt{{position:absolute;left:{214 * MM:.0f}px;top:{34 * MM:.0f}px;width:{196 * MM:.0f}px;font-size:{7.2 * PT:.1f}px;line-height:1.4}}
.lead{{font-size:{8.2 * PT:.1f}px;line-height:1.4;margin:0 0 {3 * MM:.0f}px}}
.key{{display:flex;flex-wrap:wrap;gap:{1.2 * MM:.0f}px {3.2 * MM:.0f}px;font-size:{6.4 * PT:.1f}px;margin:0 0 {4 * MM:.0f}px}}
.kb{{display:inline-flex;align-items:center;gap:{1.2 * MM:.0f}px}} .kb i{{display:inline-block;width:{6 * MM:.0f}px;height:{3.6 * MM:.0f}px}}
.elv{{margin:0 0 {1 * MM:.0f}px}}
.sl{{font-size:{6.4 * PT:.1f}px;margin:0 0 {4 * MM:.0f}px;color:#333}}
.bar{{display:flex;height:{2.2 * MM:.0f}px;margin:0 0 {1 * MM:.0f}px}} .bar i{{display:block;height:100%}}
table{{border-collapse:collapse;width:100%;font-size:{6.2 * PT:.1f}px;font-variant-numeric:tabular-nums}}
th{{text-align:left;font-weight:600;border-bottom:{0.3 * MM:.1f}px solid #111;padding:{0.8 * MM:.1f}px {0.5 * MM:.1f}px;vertical-align:bottom}}
td{{border-bottom:{0.15 * MM:.1f}px solid #ccc;padding:{0.7 * MM:.1f}px {0.5 * MM:.1f}px}} td.r,th.r{{text-align:right}}
.ass{{font-size:{5.9 * PT:.1f}px;line-height:1.4;color:#444;margin-top:{3 * MM:.0f}px}} .ass p{{margin:0 0 {1.2 * MM:.0f}px}}'''
    head = (f'<div class="hd"><div class="kick">Future context · sun on our facades, 21 June</div>'
            f'<h1>Scenario {n} of {last}</h1><div class="hor"><b style="color:#111">{H.escape(title)}.</b> {H.escape(horizon)}</div></div>')
    ass = ('<div class="ass"><p><b>How it is read.</b> As the yield study reads a scheme\'s facades: each face of our building cut into cells about '
           f'{CELL_M:g} m wide and a storey high, each read at its middle {SILL_M:g} m over its floor, at the middle of every {STEP_WORD} from 9 am to 3 pm '
           f'on 21 June (AEST){" (the yield study reads it every quarter hour; timed to the minute here)" if STEP_MIN < 15 else ""}; the hours are counted whether or not they run together, and the colours are the yield study\'s '
           'seven bands. A face turned from the sun is in its own shade; a wall on our boundary with 66-68 Riley St is a party wall and holds no window. '
           'The massing is the scenario\'s; the buildings round it as they stand, their heights off Google\'s 3D tiles; a building in front of ours is drawn '
           'as glass so our faces read through it. Storeys at 4.5 m on the ground floor and 3.2 m above. Indicative: a test of the massing, not a solar '
           f'access report.</p>{today_note}</div>')
    body = (f'{head}<div class="axs">{axos}</div><div class="rt"><p class="lead">{H.escape(lead)}</p><div class="key">{key}</div>{strips}{table}{ass}</div>')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{body}</body></html>'


# ---- each scene ---------------------------------------------------------------------------------------------------
if __name__ == '__main__':                                     # run as a script; imported, it only lends its functions
    paths = sorted(glob.glob(os.path.join(OUT, 'future-scene-*.json')), key=lambda p: int(re.findall(r'(\d+)\.json$', p)[0]))
    scenes = {int(re.findall(r'(\d+)\.json$', p)[0]): json.load(open(p)) for p in paths}
    today_no = next((k for k, s in scenes.items() if not any(b['kind'] == 'new' for b in s['buildings'])), None)
    scen_file = sys.argv[sys.argv.index('--scenarios') + 1] if '--scenarios' in sys.argv else None
    meta = {}
    if scen_file and os.path.exists(scen_file):
        for i, s in enumerate(json.load(open(scen_file))['scenarios'], 1):
            meta[i] = (s['title'], s.get('horizon', ''))
    written = []
    today_scene = scenes[today_no] if today_no is not None else None
    for no, scene in scenes.items():
        if ONLY is not None and str(no) != str(ONLY):
            continue
        site = next((b for b in scene['buildings'] if b['kind'] == 'site'), None)
        if not site:
            continue
        faces = our_faces(site)
        suns = sun_vectors(scene)
        occ_with = meshes_of(scene)
        read_hours(faces, occ_with, suns, 'with')
        read_hourly(faces, occ_with, whole_hour_suns(scene), 'hourly')            # for the view from the sun
        has_today = no != today_no
        today_from = 'scene' if today_scene is not None else 'missing'
        if has_today:
            # the baseline's buildings round us with our building as this scenario draws it: a scenario may build ours to
            # another height, and the baseline's own would stand in its place
            occ_today = (meshes_of(today_scene, lambda b: b['kind'] != 'site', extra=[site]) if today_scene is not None
                         else meshes_of(scene, lambda b: b['kind'] != 'new'))
            read_hours(faces, occ_today, suns, 'today')
        total = unfold(faces)
        title, horizon = meta.get(no, (f'Scenario {no}', ''))
        json.dump(dict(scene=no, today_scene=today_no, cell_m=CELL_M, sill_m=SILL_M, step_min=STEP_MIN, bands=dict(colours=LORIKEET, labels=LABELS),
                       faces=faces), open(os.path.join(OUT, f'future-facade-{no}.json'), 'w'))
        open(os.path.join(OUT, f'future-facade-{no}.html'), 'w').write(sheet(no, len(scenes), title, horizon, faces, has_today, today_from, total))
        t_w, _ = stats(faces, 'with')
        msg = f'future-facade-{no}: {pct(t_w["two"] / t_w["area"])} of our facade with 2 h+, mean {t_w["hours"] / t_w["area"]:.1f} h'
        if has_today:
            t_t, _ = stats(faces, 'today')
            msg += f' (today {pct(t_t["two"] / t_t["area"])}, {t_t["hours"] / t_t["area"]:.1f} h)'
        written.append(msg)
    print('; '.join(written))

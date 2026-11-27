"""The mid-winter sun on the new buildings round us, as our own facades are read (future_facade_sun.py): each wall of
each new building's residential part cut into cells about 3 m wide and a storey high, each read at its middle a metre
over its floor, timed every FACADE_STEP_MIN minutes from 9 to 3 on 21 June (1 by default here: to the minute); a cell
has the sun where the sun stands more than the angle off its wall and nothing stands between. A wall on a party edge
holds no window and is left out; a podium is read as holding none, as the sheets read it. For each building: the
share of its facade with two hours or more and with none, its mean hours, and the same for each way its faces look,
at 5 degrees off the wall and at the stricter angle.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_neighbour_sun.py out/capacity/<slug> --scene 9 \
        [--scenarios <file>] [--angle 15]

Writes future-neighbours-<n>.json and future-neighbours-<n>.csv beside the scene, and prints the table.
"""
import csv
import datetime as dt
import json
import math
import os
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
import numpy as np  # noqa: E402
from shapely.geometry import LineString, Point, Polygon  # noqa: E402
from shapely.geometry.polygon import orient  # noqa: E402
from sun_study.core.geometry import TriangleMesh, prism  # noqa: E402
from sun_study.core.occlusion import Occluder  # noqa: E402
from sun_study.core.solar import solar_position  # noqa: E402

args = sys.argv[1:]
flag = lambda name, d=None: args[args.index(name) + 1] if name in args else d
OUT = args[0]
NO = int(flag('--scene', '9'))
STRICT = float(flag('--angle', '15'))
STEP = float(os.environ.get('FACADE_STEP_MIN', '1'))
CELL_M, SILL_M, OFF_M, PARTY_M = 3.0, 1.0, 0.05, 0.6
COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']


def H_of(n):
    return 4.5 + 3.2 * (n - 1)


def bottom(s):
    return 0.0 if s <= 1 else H_of(s - 1)


def compass(nx, ny):
    return COMPASS[int((((math.degrees(math.atan2(nx, ny)) + 360) % 360) + 22.5) // 45) % 8]


def seg_dist(p, a, b):
    return LineString([a, b]).distance(Point(p))


scene = json.load(open(os.path.join(OUT, f'future-scene-{NO}.json')))
names = {b['id']: b['name'] for b in scene['buildings']}
if flag('--scenarios'):
    scn = json.load(open(flag('--scenarios')))['scenarios'][NO - 1]
    for pc in scn['parcels']:
        names[f'new-{pc["key"]}'] = f'{pc["key"]} · {pc["name"]}'

occ = Occluder(TriangleMesh.concatenate([prism(p['ring'], p['z0'], p['z1']) for b in scene['buildings'] for p in b['parts']
                                         if len(p['ring']) >= 3 and p['z1'] > p['z0']]))
tz = ZoneInfo(scene['timezone'])
mins = [9 * 60 + STEP / 2 + STEP * i for i in range(int(round(360 / STEP)))]
times = [dt.datetime(scene['year'], 6, 21, tzinfo=tz) + dt.timedelta(minutes=m) for m in mins]
SUN = [v for v in np.asarray(solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu()) if v[2] > math.sin(math.radians(0.5))]
STEP_H = STEP / 60


def faces_of(b):
    """The cells of a building's residential walls: every part but a podium (homes 'none'), each edge outward, a party
    edge left out; storeys counted from the building's own ground, its lowest part's foot."""
    ground = min(p['z0'] for p in b['parts'])
    out = []
    for part in b['parts']:
        if part.get('homes') == 'none' or len(part['ring']) < 3:
            continue
        ring = orient(Polygon(part['ring']), sign=1.0).exterior.coords[:-1]
        party = part.get('party', [])
        z0, z1 = part['z0'] - ground, part['z1'] - ground
        sts, s = [], 1
        while bottom(s) < z1 - 0.01 and s < 200:
            if z0 - 0.01 <= (bottom(s) + H_of(s)) / 2 <= z1 + 0.01:
                sts.append(s)
            s += 1
        for i in range(len(ring)):
            a, c = ring[i], ring[(i + 1) % len(ring)]
            L = math.dist(a, c)
            if L < 1.0:
                continue
            if any(seg_dist(a, e[:2], e[2:]) < PARTY_M and seg_dist(c, e[:2], e[2:]) < PARTY_M for e in party):
                continue
            nx, ny = (c[1] - a[1]) / L, -(c[0] - a[0]) / L
            k = max(1, round(L / CELL_M))
            out.append(dict(a=a, b=c, normal=(nx, ny), compass=compass(nx, ny), length=L, ground=ground,
                            cells=[dict(storey=st, t0=j / k, t1=(j + 1) / k, area=(L / k) * (H_of(st) - bottom(st))) for st in sts for j in range(k)]))
    return out


def read(faces, angle):
    """Each cell's hours of sun, the sun more than `angle` off its wall."""
    lim = math.sin(math.radians(angle))
    origins, dirs, idx = [], [], []
    for fi, f in enumerate(faces):
        (ax, ay), (bx, by), (nx, ny) = f['a'], f['b'], f['normal']
        for ci, c in enumerate(f['cells']):
            c['h'] = 0.0
            t = (c['t0'] + c['t1']) / 2
            p = (ax + (bx - ax) * t + nx * OFF_M, ay + (by - ay) * t + ny * OFF_M, f['ground'] + bottom(c['storey']) + SILL_M)
            for s in SUN:
                hl = math.hypot(s[0], s[1]) or 1.0
                if (s[0] * nx + s[1] * ny) / hl <= lim:
                    continue
                origins.append(p)
                dirs.append(s)
                idx.append((fi, ci))
    if origins:
        hit = occ.any_hit(np.asarray(origins), np.asarray(dirs))
        for (fi, ci), h in zip(idx, hit):
            if not h:
                faces[fi]['cells'][ci]['h'] += STEP_H
    return {(fi, ci): c['h'] for fi, f in enumerate(faces) for ci, c in enumerate(f['cells'])}


def figures(faces, hrs, sel=None):
    a = two = none = hsum = 0.0
    for fi, f in enumerate(faces):
        if sel and f['compass'] not in sel:
            continue
        for ci, c in enumerate(f['cells']):
            h = hrs[(fi, ci)]
            a += c['area']
            hsum += c['area'] * h
            two += c['area'] * (h >= 2 - 1e-9)
            none += c['area'] * (h <= 1e-9)
    return dict(area=a, two=two / a if a else None, none=none / a if a else None, mean=hsum / a if a else None)


rows = []
for b in scene['buildings']:
    if b['kind'] != 'new':
        continue
    faces = faces_of(b)
    if not faces:
        continue
    h5, hS = read(faces, 5.0), read(faces, STRICT)
    storeys = max(c['storey'] for f in faces for c in f['cells'])
    row = dict(building=names.get(b['id'], b['id']), storeys=storeys, all5=figures(faces, h5), allS=figures(faces, hS), sides={})
    for side in ('N', 'E', 'S', 'W'):
        sel = {side, *(x for x in COMPASS if len(x) == 2 and side in x)} if False else {side}
        f5 = figures(faces, h5, sel)
        if f5['area']:
            row['sides'][side] = dict(two=f5['two'], mean=f5['mean'], area=f5['area'], twoS=figures(faces, hS, sel)['two'])
    rows.append(row)

json.dump(dict(scene=NO, step_min=STEP, strict=STRICT, rows=rows), open(os.path.join(OUT, f'future-neighbours-{NO}.json'), 'w'), indent=1)
with open(os.path.join(OUT, f'future-neighbours-{NO}.csv'), 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['building', 'storeys', 'facade m2', '2h+ at 5deg', 'none at 5deg', 'mean h', f'2h+ at {STRICT:g}deg'] + [f'{s} 2h+ at 5deg' for s in 'NESW'] + [f'{s} mean h' for s in 'NESW'])
    for r in rows:
        w.writerow([r['building'], r['storeys'], round(r['all5']['area']), f"{r['all5']['two']:.0%}", f"{r['all5']['none']:.0%}", f"{r['all5']['mean']:.1f}", f"{r['allS']['two']:.0%}"]
                   + [f"{r['sides'][s]['two']:.0%}" if s in r['sides'] else '' for s in 'NESW'] + [f"{r['sides'][s]['mean']:.1f}" if s in r['sides'] else '' for s in 'NESW'])
for r in rows:
    sides = '  '.join(f"{s} {v['two']:.0%} ({v['mean']:.1f} h)" for s, v in r['sides'].items())
    print(f"{r['building']}: {r['storeys']} st, facade {r['all5']['area']:.0f} m2; 2h+ {r['all5']['two']:.0%}, none {r['all5']['none']:.0%}, mean {r['all5']['mean']:.1f} h; at {STRICT:g} deg {r['allS']['two']:.0%} | {sides}")

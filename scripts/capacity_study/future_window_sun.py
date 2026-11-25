"""A window's two hours, shown: one window on a face of our building, the middle cell of its longest wall that way, at
the storeys asked, seen from the sun every half hour from 11:30 to 3, and in plan with a ray toward the sun every
quarter hour, each ray in sun, in sun only at a grazing angle (less than ANGLE degrees off the wall's plane), cut off
by a building, or behind the wall. The facade sheets count a cell's sun once the sun stands 5 degrees off its wall, as
the yield study does; this sheet shows what that counts, and what a stricter reading leaves out.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_window_sun.py out/capacity/<slug> \
        --scenarios <file> --scene 8 [--side W] [--storeys 1,2] [--angle 15]

Reads future-scene-<n>.json and future-facade-<n>.json; writes future-window-<n>.html, an A3 sheet at the deck's size.
"""
import datetime as dt
import html as H
import json
import math
import os
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
import numpy as np  # noqa: E402
from sun_study.core.geometry import TriangleMesh, prism  # noqa: E402
from sun_study.core.occlusion import Occluder  # noqa: E402
from sun_study.core.solar import solar_position  # noqa: E402

args = sys.argv[1:]
flag = lambda name, d=None: args[args.index(name) + 1] if name in args else d
OUT = args[0]
NO = int(flag('--scene', '8'))
SIDE = flag('--side', 'W')
STOREYS = [int(x) for x in flag('--storeys', '1,2').split(',')]
ANGLE = float(flag('--angle', '15'))
BASE_ANGLE = 5.0                                               # the yield study's: the sun 5 degrees off the wall
SILL, OFF = 1.0, 0.05
PAGE_W, PAGE_H = 4961, 3508
MM = PAGE_W / 420
PT = MM * 25.4 / 72
LIT, GRAZE, BLOCK, AWAY = '#f2b705', '#ff5a3d', '#8a8a8a', '#c9c9c9'
FILLS = {'site': '#f3d9d9', 'new': '#cdc6c0', 'standing': '#dadada', 'context': '#e7e7e7'}
SIDE_WORD = dict(N='north', E='east', S='south', W='west')


def H_of(n):
    return 4.5 + 3.2 * (n - 1)


def bottom(s):
    return 0.0 if s <= 1 else H_of(s - 1)


def level(s):
    return 'ground floor' if s == 1 else f'L{s - 1}'


scene = json.load(open(os.path.join(OUT, f'future-scene-{NO}.json')))
fac = json.load(open(os.path.join(OUT, f'future-facade-{NO}.json')))
scen = json.load(open(flag('--scenarios'))) if flag('--scenarios') else {'scenarios': []}
title = scen['scenarios'][NO - 1]['title'] if len(scen['scenarios']) >= NO else f'Scenario {NO}'
LAST = len(scen['scenarios']) or NO

# the window: the middle of the longest wall that looks that way, on the lowest tier that holds the storeys asked
faces = [f for f in fac['faces'] if f['compass'] == SIDE and not f['blank'] and any(s in f['storeys'] for s in STOREYS)]
face = max(faces, key=lambda f: f['length'])
(ax, ay), (bx, by), (nx, ny) = face['a'], face['b'], face['normal']
mx, my = (ax + bx) / 2, (ay + by) / 2
ux, uy = (bx - ax) / face['length'], (by - ay) / face['length']        # along the wall
CELL = face['length'] / max(1, round(face['length'] / fac.get('cell_m', 3.0)))
street = face.get('street') or ''

meshes = {b['id']: TriangleMesh.concatenate([prism(p['ring'], p['z0'], p['z1']) for p in b['parts'] if len(p['ring']) >= 3 and p['z1'] > p['z0']])
          for b in scene['buildings']}
names = {b['id']: b['name'] for b in scene['buildings']}
# a new building by the name the scenarios file gives its parcel
for pc in (scen['scenarios'][NO - 1]['parcels'] if len(scen['scenarios']) >= NO else []):
    names[f'new-{pc["key"]}'] = pc['name']
occ_all = Occluder(TriangleMesh.concatenate(list(meshes.values())))
occ_each = {i: Occluder(m) for i, m in meshes.items() if i != 'site'}
tz = ZoneInfo(scene['timezone'])


def sun_at(minutes):
    t = dt.datetime(scene['year'], 6, 21, tzinfo=tz) + dt.timedelta(minutes=minutes)
    return np.asarray(solar_position([t], scene['lat'], scene['lon']).unit_vectors_enu())[0]


def reading(minutes, storey):
    """The window's sun at an instant: the sun, its angle off the wall's plane in plan, and what happens: 'away'
    (behind the wall), 'blocked' (with the building that cuts it off), 'graze' (in sun, under ANGLE off the wall) or
    'lit'."""
    s = sun_at(minutes)
    hl = math.hypot(s[0], s[1]) or 1.0
    off = math.degrees(math.asin(max(-1.0, min(1.0, (s[0] * nx + s[1] * ny) / hl))))   # 90 is square to the wall
    p = np.array([[mx + nx * OFF, my + ny * OFF, bottom(storey) + SILL]])
    if s[2] <= 0 or off <= BASE_ANGLE:
        return s, off, 'away', None
    if occ_all.any_hit(p, s[None, :])[0]:
        who = next((names[i] for i, o in occ_each.items() if o.any_hit(p, s[None, :])[0]), 'a building')
        return s, off, 'blocked', who
    return s, off, ('lit' if off > ANGLE else 'graze'), None


QUARTERS = [9 * 60 + 7.5 + 15 * i for i in range(24)]
VIEWS = [11 * 60 + 30 + 30 * i for i in range(8)]                 # 11:30 to 3
clock = lambda m: f'{int(m // 60)}:{int(m % 60):02d}'
short = lambda nm: nm.replace(' DARLINGHURST', '').replace(' WOOLLOOMOOLOO', '') if not nm.isupper() else nm.replace(' DARLINGHURST', '').replace(' WOOLLOOMOOLOO', '').title()


MINUTES = list(range(9 * 60, 15 * 60 + 1))
_SUNS = None


def by_the_minute(storey):
    """The window's sun minute by minute from 9 to 3: its runs in sun at BASE_ANGLE and at ANGLE off the wall, and
    the minutes of each, so a threshold is read where the sun comes and goes, not at the quarter hours."""
    global _SUNS
    if _SUNS is None:
        ts = [dt.datetime(scene['year'], 6, 21, tzinfo=tz) + dt.timedelta(minutes=m) for m in MINUTES]
        _SUNS = np.asarray(solar_position(ts, scene['lat'], scene['lon']).unit_vectors_enu())
    S = _SUNS
    p = np.array([[mx + nx * OFF, my + ny * OFF, bottom(storey) + SILL]])
    offs = [math.degrees(math.asin(max(-1.0, min(1.0, (v[0] * nx + v[1] * ny) / (math.hypot(v[0], v[1]) or 1.0))))) for v in S]
    hit = occ_all.any_hit(np.repeat(p, len(S), 0), S)
    out = {}
    for a in (BASE_ANGLE, ANGLE):
        lit = [v[2] > 0 and o > a and not h for v, o, h in zip(S, offs, hit)]
        runs, start = [], None
        for m, f in zip(MINUTES, lit):
            if f and start is None:
                start = m
            if not f and start is not None:
                runs.append((start, m))
                start = None
        if start is not None:
            runs.append((start, MINUTES[-1]))
        out[a] = (runs, sum(b - a_ for a_, b in runs))
    return out


def hours(storey):
    rs = [reading(m, storey) for m in QUARTERS]
    at5 = sum(0.25 for r in rs if r[2] in ('lit', 'graze'))
    atA = sum(0.25 for r in rs if r[2] == 'lit')
    return at5, atA, rs


# ---- the view from the sun, round the window ------------------------------------------------------------------------
def sun_view(minutes, storey, half=17.0):
    s, off, what, who = reading(minutes, storey)
    fwd = -s
    right = np.cross(fwd, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    P = lambda x, y, z: (float(np.dot((x, y, z), right)), float(np.dot((x, y, z), up)), float(np.dot((x, y, z), fwd)))
    cx, cy, _ = P(mx, my, bottom(storey) + 1.6)
    items = []
    for b in scene['buildings']:
        if b['kind'] == 'site':
            continue
        if min(math.hypot(x - mx, y - my) for p in b['parts'] for x, y in p['ring']) > 90:
            continue
        for p in b['parts']:
            ring, z0, z1 = p['ring'], p['z0'], p['z1']
            for a, c in zip(ring, ring[1:] + ring[:1]):
                wx, wy = c[1] - a[1], -(c[0] - a[0])
                if math.hypot(wx, wy) < 1e-6 or wx * s[0] + wy * s[1] <= 0:
                    continue
                q = [P(a[0], a[1], z0), P(c[0], c[1], z0), P(c[0], c[1], z1), P(a[0], a[1], z1)]
                items.append((sum(v[2] for v in q) / 4, [(q, FILLS.get(b['kind'], '#e7e7e7'), '#8a8a8a', .12)]))
            top = [P(x, y, z1) for x, y in ring]
            items.append((sum(v[2] for v in top) / len(top), [(top, FILLS.get(b['kind'], '#e7e7e7'), '#8a8a8a', .12)]))
    # ours, tier by tier from the ground, the window on its wall
    site = next(b for b in scene['buildings'] if b['kind'] == 'site')
    group = []
    for part in sorted(site['parts'], key=lambda q: q['z0']):
        ring, z0, z1 = part['ring'], part['z0'], part['z1']
        for a, c in zip(ring, ring[1:] + ring[:1]):
            wx, wy = c[1] - a[1], -(c[0] - a[0])
            if math.hypot(wx, wy) < 1e-6 or wx * s[0] + wy * s[1] <= 0:
                continue
            group.append(([P(a[0], a[1], z0), P(c[0], c[1], z0), P(c[0], c[1], z1), P(a[0], a[1], z1)], FILLS['site'], '#c0161c', .14))
        if z0 - 0.01 <= bottom(storey) < z1 - 0.01 and what != 'away':
            p0 = (mx - ux * CELL / 2, my - uy * CELL / 2)
            p1 = (mx + ux * CELL / 2, my + uy * CELL / 2)
            zz0, zz1 = bottom(storey), H_of(storey)
            fill = {'lit': LIT, 'graze': GRAZE, 'blocked': BLOCK}[what]
            group.append(([P(p0[0], p0[1], zz0), P(p1[0], p1[1], zz0), P(p1[0], p1[1], zz1), P(p0[0], p0[1], zz1)], fill, '#111', .25))
        group.append(([P(x, y, z1) for x, y in ring], FILLS['site'], '#c0161c', .14))
    pts = [v for poly, *_ in group for v in poly]
    items.append((sum(v[2] for v in pts) / len(pts), group))
    items.sort(key=lambda it: -it[0])
    o = [f'<svg viewBox="{cx - half:.2f} {-(cy + half):.2f} {2 * half:.2f} {2 * half:.2f}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%"><rect x="{cx - half:.2f}" y="{-(cy + half):.2f}" width="{2 * half:.2f}" height="{2 * half:.2f}" fill="#f7f6f3"/>']
    for _, polys in items:
        for poly, fill, stroke, sw in polys:
            o.append(f'<polygon points="{" ".join(f"{v[0]:.2f},{-v[1]:.2f}" for v in poly)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
    o.append('</svg>')
    alt = math.degrees(math.asin(s[2]))
    az = (math.degrees(math.atan2(s[0], s[1])) + 360) % 360
    if what == 'away':
        note = 'behind the wall'
    elif what == 'blocked':
        note = f'cut off by {short(who)}'
    elif what == 'graze':
        note = f'in sun, at a graze: counts at {BASE_ANGLE:g}°, not at {ANGLE:g}°'
    else:
        note = 'in sun: counts at both'
    return (f'<div class="v"><div class="vt"><b>{clock(minutes)}</b> sun {az:.0f}°, {alt:.0f}° up</div>'
            f'<div class="vs">{"".join(o)}</div><div class="vn"><b>{max(off, 0):.0f}° off the wall</b><br>{H.escape(note)}</div></div>')


# ---- the plan, a ray toward the sun every quarter hour ----------------------------------------------------------------
def plan_svg(storey, R=46.0):
    _, _, rs = hours(storey)
    o = []
    for b in scene['buildings']:
        for p in b['parts']:
            ring = p['ring']
            if min(math.hypot(x - mx, y - my) for x, y in ring) > R + 15:
                continue
            fill = FILLS.get(b['kind'], '#e7e7e7')
            stroke = '#c0161c' if b['kind'] == 'site' else '#8a8a8a'
            o.append(f'<polygon points="{" ".join(f"{x:.2f},{-y:.2f}" for x, y in ring)}" fill="{fill}" fill-opacity=".85" stroke="{stroke}" stroke-width=".18"/>')
    # the grazing wedge: from the wall's plane to ANGLE off it, both ways along the wall
    noon = sun_at(12 * 60)
    for sgn in [1 if noon[0] * ux + noon[1] * uy > 0 else -1]:      # the side of the wall the sun comes round from
        a0 = math.atan2(uy * sgn, ux * sgn)
        steps = [a0 + math.radians(ANGLE) * i / 12 * (1 if sgn * (ux * ny - uy * nx) < 0 else -1) for i in range(13)]
        pts = [(mx, my)] + [(mx + math.cos(t) * R, my + math.sin(t) * R) for t in steps]
        o.append(f'<polygon points="{" ".join(f"{x:.2f},{-y:.2f}" for x, y in pts)}" fill="{GRAZE}" fill-opacity=".12" stroke="none"/>')
    for m, (s, off, what, who) in zip(QUARTERS, rs):
        if what == 'away':
            continue
        hl = math.hypot(s[0], s[1])
        ex, ey = mx + s[0] / hl * R, my + s[1] / hl * R
        col = {'lit': LIT, 'graze': GRAZE, 'blocked': BLOCK}[what]
        dash = ' stroke-dasharray="1 .8"' if what == 'blocked' else ''
        o.append(f'<line x1="{mx:.2f}" y1="{-my:.2f}" x2="{ex:.2f}" y2="{-ey:.2f}" stroke="{col}" stroke-width=".45"{dash}/>')
        if (m - 7.5) % 30 == 0:                                          # every half hour, staggered so they do not run together
            rr = R + (3.0 if (m - 7.5) % 60 == 0 else 7.5)
            o.append(f'<text x="{mx + s[0] / hl * rr:.2f}" y="{-(my + s[1] / hl * rr) + .8:.2f}" font-size="2.4" text-anchor="middle" fill="#333">{clock(m - 7.5)}</text>')
    o.append(f'<circle cx="{mx:.2f}" cy="{-my:.2f}" r="1.1" fill="#111"/>')
    o.append(f'<text x="{mx - nx * 2 + 2:.2f}" y="{-my + 4:.2f}" font-size="2.4" font-weight="700" fill="#111">the window</text>')
    x0, y0 = mx - R - 12, my - R - 12
    return (f'<svg viewBox="{x0:.1f} {-(my + R + 12):.1f} {2 * R + 24:.1f} {2 * R + 24:.1f}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">'
            + ''.join(o) + '</svg>')


rows = ''
table = ''
for st in STOREYS:
    at5, atA, rs = hours(st)
    rows += f'<div class="row"><div class="rl">{level(st).capitalize()}</div>' + ''.join(sun_view(m, st) for m in VIEWS) + '</div>'
    mm = by_the_minute(st)
    fmt = lambda runs: ', '.join(f'{clock(a)} to {clock(b)}' for a, b in runs) or 'none'
    dur = lambda n: f'{n // 60} h {n % 60:02d} min'
    (r5, n5), (rA, nA) = mm[BASE_ANGLE], mm[ANGLE]
    table += (f'<tr><td>{level(st).capitalize()}</td><td>{fmt(r5)}</td><td class="r"><b>{dur(n5)}</b> {"✓" if n5 >= 120 else "✗"}</td>'
              f'<td>{fmt(rA)}</td><td class="r"><b>{dur(nA)}</b> {"✓" if nA >= 120 else "✗"}</td><td class="r" style="color:#666">{at5:.2f} h</td></tr>')
plan = plan_svg(STOREYS[0])
css = f'''@page{{size:{PAGE_W}px {PAGE_H}px;margin:0}} *{{box-sizing:border-box}} html,body{{margin:0;background:#fff}}
body{{width:{PAGE_W}px;height:{PAGE_H}px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
svg text{{font-family:Inter,Helvetica,Arial,sans-serif}}
.hd{{position:absolute;left:{10 * MM:.0f}px;top:{9 * MM:.0f}px;width:{400 * MM:.0f}px}}
.kick{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{17 * PT:.1f}px;line-height:1.1;margin:{1.5 * MM:.0f}px 0 {1 * MM:.0f}px;font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{7.4 * PT:.1f}px;color:#555}}
.rows{{position:absolute;left:{10 * MM:.0f}px;top:{30 * MM:.0f}px;width:{400 * MM:.0f}px}}
.row{{display:flex;gap:{2 * MM:.0f}px;margin-bottom:{3 * MM:.0f}px;align-items:flex-start}}
.rl{{width:{14 * MM:.0f}px;flex:none;font-size:{7.5 * PT:.1f}px;font-weight:700;padding-top:{24 * MM:.0f}px}}
.v{{flex:1;min-width:0}} .vt{{font-size:{6.4 * PT:.1f}px;margin-bottom:{.8 * MM:.0f}px}} .vs{{height:{46 * MM:.0f}px}}
.vn{{font-size:{6 * PT:.1f}px;line-height:1.3;margin-top:{.8 * MM:.0f}px;color:#333}}
.plan{{position:absolute;left:{10 * MM:.0f}px;top:{172 * MM:.0f}px;width:{118 * MM:.0f}px;height:{118 * MM:.0f}px}}
.cap{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:{1.2 * MM:.0f}px}}
.rt{{position:absolute;left:{140 * MM:.0f}px;top:{172 * MM:.0f}px;width:{270 * MM:.0f}px;font-size:{7.4 * PT:.1f}px;line-height:1.45}}
.lead{{font-size:{8.6 * PT:.1f}px;line-height:1.4;margin:0 0 {3 * MM:.0f}px}}
table{{border-collapse:collapse;width:100%;font-size:{7 * PT:.1f}px;font-variant-numeric:tabular-nums;margin:{1 * MM:.0f}px 0 {4 * MM:.0f}px}}
th{{text-align:left;font-weight:600;border-bottom:{.3 * MM:.1f}px solid #111;padding:{.8 * MM:.1f}px {.6 * MM:.1f}px}}
td{{border-bottom:{.15 * MM:.1f}px solid #ccc;padding:{.8 * MM:.1f}px {.6 * MM:.1f}px}} td.r,th.r{{text-align:right}}
.key span{{display:inline-flex;align-items:center;gap:{1.2 * MM:.0f}px;margin-right:{4 * MM:.0f}px}} .key i{{display:inline-block;width:{6 * MM:.0f}px;height:{2.2 * MM:.0f}px}}'''
head = (f'<div class="hd"><div class="kick">Future context · the window\'s two hours, 21 June</div><h1>Scenario {NO} of {LAST}</h1>'
        f'<div class="hor"><b style="color:#111">{H.escape(title)}.</b> One window on our {SIDE_WORD[SIDE]} wall{(" on " + H.escape(street)) if street else ""}, the middle of its longest wall, '
        f'seen from the sun every half hour: what the sun sees is in sun. At a graze the window shrinks to a sliver as the sun sees it.</div></div>')
at5_0, atA_0, _ = hours(STOREYS[0])
_m0 = by_the_minute(STOREYS[0])
(_r5, _n5), (_rA, _nA) = _m0[BASE_ANGLE], _m0[ANGLE]
_span = lambda runs: ', '.join(f'{clock(a)} to {clock(b)}' for a, b in runs) or 'never'
lead = (f'Our {SIDE_WORD[SIDE]} wall faces {(math.degrees(math.atan2(nx, ny)) + 360) % 360:.0f}°, so the mid-winter sun only comes round to it at midday, along the wall at first, '
        f'and stands well off it only in the afternoon, when the block across the street is in the way of the lower floors. '
        f'Timed to the minute, the {level(STOREYS[0])} window is in sun from {_span(_r5)}, {_n5 // 60} h {_n5 % 60:02d} min{", short of two hours" if _n5 < 120 else ""}; '
        f'the facade sheets, reading the sun every quarter hour, give it {hours(STOREYS[0])[0]:.2f} h. '
        f'Counting only sun more than {ANGLE:g}° off the wall, it has {_n5 and _nA // 60} h {_nA % 60:02d} min.')
key = (f'<div class="key"><span><i style="background:{LIT}"></i>in sun, over {ANGLE:g}° off the wall</span><span><i style="background:{GRAZE}"></i>in sun at a graze, {BASE_ANGLE:g}° to {ANGLE:g}°</span>'
       f'<span><i style="background:{BLOCK}"></i>cut off by a building</span><span><i style="background:{GRAZE};opacity:.25"></i>within {ANGLE:g}° of the wall</span></div>')
body = (f'{head}<div class="rows">{rows}</div>'
        f'<div class="plan"><div class="cap">In plan, the {level(STOREYS[0])}: a ray toward the sun every quarter hour</div>{plan}</div>'
        f'<div class="rt"><p class="lead">{H.escape(lead)}</p>'
        f'<table><tr><th>The window</th><th>In sun, over {BASE_ANGLE:g}° off the wall</th><th class="r">by the minute</th><th>Over {ANGLE:g}° off the wall</th><th class="r">by the minute</th><th class="r">the sheets, every quarter hour</th></tr>{table}</table>'
        f'{key}<p style="color:#555;margin-top:{3 * MM:.0f}px">The window is a cell of the facade sheet, {CELL:.1f} m wide and a storey high, read at its middle a metre over its floor, '
        f'by the minute from 9 to 3 (AEST). The facade sheets read it every quarter hour, as the yield study does, each reading standing for 15 minutes: '
        f'where the sun comes or goes inside a quarter, that rounds, and a window just short of two hours can read as two. Angles are in plan, off the wall\'s face. Indicative: a test of the massing.</p></div>')
html = f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{body}</body></html>'
open(os.path.join(OUT, f'future-window-{NO}.html'), 'w').write(html)
print(f'future-window-{NO}: ' + '; '.join(f'{level(st)} {by_the_minute(st)[BASE_ANGLE][1]} min at {BASE_ANGLE:g}°, {by_the_minute(st)[ANGLE][1]} min at {ANGLE:g}° (quarter hours {hours(st)[0]:.2f} h)' for st in STOREYS))

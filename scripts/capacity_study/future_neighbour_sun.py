"""The mid-winter sun on the new buildings round us, read and drawn as our own facades are (future_facade_sun.py): each
new building's residential walls cut into cells about 3 m wide and a storey high, each read at its middle a metre over
its floor, every FACADE_STEP_MIN minutes from 9 to 3 on 21 June (1 here unless set: to the minute), a cell having the
sun where the sun stands more than 5 degrees off its wall and nothing stands between; a podium is read as holding no
homes, as the sheets read it, and a wall on a party edge holds no window. For each building a sheet: its massing from
the south-west and the north-east, its faces cell by cell in the yield study's bands, its faces unfolded, and its
figures, at 5 degrees and at the stricter --angle; a second sheet, the scene as the sun sees it at each whole hour
from 9 to 3, framed on it, its facade lit where the sun reaches it; and a first sheet comparing them with ours.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_neighbour_sun.py out/capacity/<slug> --scene 9 \
        --scenarios <file> [--angle 15]

Writes future-neighbours-<n>.json and .csv, future-neighbours-<n>.html (the comparison), future-neighbour-<n>-<key>.html
(a sheet a building) and future-neighbour-<n>-<key>-sun.html (its view from the sun at each whole hour) beside the scene, and prints the HTML files in order; scripts/print_sheets.ts prints and binds them.
"""
import csv
import html as H
import json
import math
import os
import sys

import numpy as np

os.environ.setdefault('FACADE_STEP_MIN', '1')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import future_facade_sun as ff  # noqa: E402  (its run is guarded; it lends its readings and drawings)

args = sys.argv[1:]
flag = lambda name, d=None: args[args.index(name) + 1] if name in args else d
OUT = args[0]
NO = int(flag('--scene', '9'))
STRICT = float(flag('--angle', '15'))
MM, PT = ff.MM, ff.PT

scene = json.load(open(os.path.join(OUT, f'future-scene-{NO}.json')))
scen_all = json.load(open(flag('--scenarios')))['scenarios'] if flag('--scenarios') else []
scn = scen_all[NO - 1] if len(scen_all) >= NO else {}
LAST = len(scen_all) or NO
title = scn.get('title', f'Scenario {NO}')
pnames = {pc['key']: pc['name'] for pc in scn.get('parcels', [])}
solar = json.load(open(os.path.join(OUT, f'future-solar-{NO}.json'))) if os.path.exists(os.path.join(OUT, f'future-solar-{NO}.json')) else {'buildings': {}}

occ = ff.meshes_of(scene)
suns = ff.sun_vectors(scene)
WHOLE = ff.whole_hour_suns(scene)                                  # the sun at 9, 10 … 3, as the view from the sun is drawn
STEP_WORD = ff.STEP_WORD
SIDES = ('N', 'E', 'S', 'W')
SIDE_WORD = dict(N='north', E='east', S='south', W='west')
FILLS = {'site': '#f3d9d9', 'new': '#cdc6c0', 'standing': '#dadada', 'context': '#e7e7e7'}   # as the deck's view from the sun
SUN_LIT, SUN_SHADE = '#f4c242', '#a9a9a9'


def read_both(faces):
    """Each cell's hours at 5 degrees off its wall ('with') and at the stricter angle ('strict'), and whether it is in sun
    at each whole hour ('hourly'), as the view from the sun shows it."""
    ff.read_hourly(faces, occ, WHOLE, 'hourly')
    ff.read_hours(faces, occ, suns, 'with')
    keep = ff.FACING
    ff.FACING = math.sin(math.radians(STRICT))
    try:
        ff.read_hours(faces, occ, suns, 'strict')
    finally:
        ff.FACING = keep


def figures(faces, key, sides=None):
    a = two = none = hsum = 0.0
    for f in faces:
        if f['blank'] or (sides and f['compass'] not in sides):
            continue
        w = f['length'] / max(1, round(f['length'] / ff.CELL_M))
        for c in f['cells']:
            ar = w * (ff.H_of(c['storey']) - ff.storey_bottom(c['storey']))
            a += ar
            hsum += ar * c[key]
            two += ar * (c[key] >= 2 - 1e-9)
            none += ar * (c[key] <= 1e-9)
    return dict(area=a, two=two / a if a else None, none=none / a if a else None, mean=hsum / a if a else None)


pct = lambda x: '—' if x is None else f'{x * 100:.0f}%'


def css():
    return f'''@page{{size:{ff.PAGE_W}px {ff.PAGE_H}px;margin:0}} *{{box-sizing:border-box}} html,body{{margin:0;background:#fff}}
body{{width:{ff.PAGE_W}px;height:{ff.PAGE_H}px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
svg text{{font-family:Inter,Helvetica,Arial,sans-serif}}
.hd{{position:absolute;left:{10 * MM:.0f}px;top:{9 * MM:.0f}px;width:{400 * MM:.0f}px}}
.kick{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{17 * PT:.1f}px;line-height:1.1;margin:{1.5 * MM:.0f}px 0 {1 * MM:.0f}px;font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{7.4 * PT:.1f}px;color:#555}}
.axs{{position:absolute;left:{10 * MM:.0f}px;top:{34 * MM:.0f}px;width:{196 * MM:.0f}px;height:{250 * MM:.0f}px;display:flex;flex-direction:column;gap:{4 * MM:.0f}px}}
.ax{{flex:1;display:flex;flex-direction:column;min-height:0}} .axb{{flex:1;min-height:0}}
.cap{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:{1.2 * MM:.0f}px}}
.rt{{position:absolute;left:{214 * MM:.0f}px;top:{34 * MM:.0f}px;width:{196 * MM:.0f}px;font-size:{7.2 * PT:.1f}px;line-height:1.4}}
.wide{{position:absolute;left:{10 * MM:.0f}px;top:{34 * MM:.0f}px;width:{400 * MM:.0f}px;font-size:{7.4 * PT:.1f}px;line-height:1.45}}
.lead{{font-size:{8.6 * PT:.1f}px;line-height:1.4;margin:0 0 {3 * MM:.0f}px}}
.big{{font-size:{44 * PT:.1f}px;font-weight:800;line-height:1;margin:0 0 {1 * MM:.0f}px}}
.key{{display:flex;flex-wrap:wrap;gap:{1.2 * MM:.0f}px {3.2 * MM:.0f}px;font-size:{6.4 * PT:.1f}px;margin:0 0 {4 * MM:.0f}px}}
.kb{{display:inline-flex;align-items:center;gap:{1.2 * MM:.0f}px}} .kb i{{display:inline-block;width:{6 * MM:.0f}px;height:{3.6 * MM:.0f}px}}
.elv{{margin:0 0 {1 * MM:.0f}px}} .sl{{font-size:{6.4 * PT:.1f}px;margin:0 0 {4 * MM:.0f}px;color:#333}}
.bar{{display:flex;height:{2.2 * MM:.0f}px;margin:0 0 {1 * MM:.0f}px}} .bar i{{display:block;height:100%}}
table{{border-collapse:collapse;width:100%;font-size:{7 * PT:.1f}px;font-variant-numeric:tabular-nums}}
th{{text-align:left;font-weight:600;border-bottom:{.3 * MM:.1f}px solid #111;padding:{.9 * MM:.1f}px {.6 * MM:.1f}px;vertical-align:bottom}}
td{{border-bottom:{.15 * MM:.1f}px solid #ccc;padding:{.9 * MM:.1f}px {.6 * MM:.1f}px}} td.r,th.r{{text-align:right}}
.ass{{font-size:{6 * PT:.1f}px;line-height:1.45;color:#444;margin-top:{3 * MM:.0f}px}}'''


def head(kicker, sub):
    return (f'<div class="hd"><div class="kick">Future context · {H.escape(kicker)}</div><h1>Scenario {NO} of {LAST}</h1>'
            f'<div class="hor"><b style="color:#111">{H.escape(title)}.</b> {H.escape(sub)}</div></div>')


HOW = (f'Read as our facades are read, and as the yield study reads a scheme\'s: each residential wall cut into cells about {ff.CELL_M:g} m wide and a storey '
       f'high, each read at its middle {ff.SILL_M:g} m over its floor, every {STEP_WORD} from 9 am to 3 pm on 21 June (AEST); a cell has the sun where the sun stands '
       f'more than 5° off its wall and nothing stands between, the hours added whether or not they run together. The podium is read as holding no homes; a wall on '
       f'a party edge holds no window. Facing east on this grid, a wall can have the sun from 9:00 to about 10:57 at most, under two hours. Indicative: a test of the massing.')


def band_key():
    return ''.join(f'<span class="kb"><i style="background:{c}"></i>{H.escape(l)}</span>' for c, l in zip(ff.LORIKEET, ff.LABELS))


def label_of(b):
    return 'ours' if b['kind'] == 'site' else b['id'].split('-', 1)[1] if b['kind'] == 'new' else None


def sun_eye_svg(subject, faces, hour, s, reach=44.0, tall=1.05):
    """The scene as the sun sees it at `hour`, framed on the building `subject`: an orthographic projection along the
    sun's ray, every wall facing the sun and every roof drawn far to near, so whatever shows is in sun and whatever is
    hidden is in shadow. The building read is one group, tier by tier from its foot (each tier's walls, the cells on
    them lit or shaded as the engine finds them at that hour, then its roof); ours pink, outlined red."""
    hi = hour - 9
    s = np.asarray(s, dtype=float)
    fwd = -s
    right = np.cross(fwd, np.array([0.0, 0.0, 1.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    P = lambda x, y, z: (float(np.dot((x, y, z), right)), float(np.dot((x, y, z), up)), float(np.dot((x, y, z), fwd)))
    faces_toward = lambda nx, ny: nx * s[0] + ny * s[1] > 0
    items, labels, frame = [], [], []
    sub_b = None
    for b in scene['buildings']:
        if b['id'] == subject:
            sub_b = b
            continue
        fill = FILLS.get(b['kind'], FILLS['context'])
        stroke, sw = ('#c0161c', 0.3) if b['kind'] == 'site' else ('#8a8a8a', 0.2)
        for part in b['parts']:
            ring, z0, z1 = part['ring'], part['z0'], part['z1']
            if len(ring) < 3 or z1 <= z0:
                continue
            for p, q in zip(ring, ring[1:] + ring[:1]):
                nx, ny = q[1] - p[1], -(q[0] - p[0])
                if math.hypot(nx, ny) < 1e-6 or not faces_toward(nx, ny):
                    continue                                    # a wall the sun does not reach is not in its view
                quad = [P(p[0], p[1], z0), P(q[0], q[1], z0), P(q[0], q[1], z1), P(p[0], p[1], z1)]
                items.append((sum(c[2] for c in quad) / 4, quad, fill, stroke, sw))
            top = [P(x, y, z1) for x, y in ring]
            items.append((sum(c[2] for c in top) / len(top), top, fill, stroke, sw))
        if label_of(b):
            top_part = max(b['parts'], key=lambda q: q['z1'])
            r_ = top_part['ring']
            labels.append((label_of(b), P(sum(x for x, _ in r_) / len(r_), sum(y for _, y in r_) / len(r_), top_part['z1'])))
    group = []
    by_part = {}
    for f in faces:
        by_part.setdefault(f['part'], []).append(f)
    for k_part, part in enumerate(sorted(sub_b['parts'], key=lambda q: q['z0'])):
        ring, z0, z1 = part['ring'], part['z0'], part['z1']
        frame += [P(x, y, z) for x, y in ring for z in (z0, z1)]
        for p, q in zip(ring, ring[1:] + ring[:1]):
            nx, ny = q[1] - p[1], -(q[0] - p[0])
            if math.hypot(nx, ny) < 1e-6 or not faces_toward(nx, ny):
                continue
            group.append(([P(p[0], p[1], z0), P(q[0], q[1], z0), P(q[0], q[1], z1), P(p[0], p[1], z1)], FILLS['new'], '#111', 0.3))
        for f in by_part.get(k_part, []):
            (ax, ay), (bx, by), (nx, ny) = f['a'], f['b'], f['normal']
            if f['blank'] or not faces_toward(nx, ny):
                continue                                        # a party wall holds no window; it stays plain
            g0 = f.get('ground', 0.0)
            for c in f['cells']:
                za, zb = g0 + ff.storey_bottom(c['storey']), g0 + ff.H_of(c['storey'])
                p0 = (ax + (bx - ax) * c['t0'], ay + (by - ay) * c['t0'])
                p1 = (ax + (bx - ax) * c['t1'], ay + (by - ay) * c['t1'])
                lit = c.get('hourly', '')[hi:hi + 1] == '1'
                group.append(([P(p0[0], p0[1], za), P(p1[0], p1[1], za), P(p1[0], p1[1], zb), P(p0[0], p0[1], zb)],
                              SUN_LIT if lit else SUN_SHADE, '#7a6a2a' if lit else '#777', 0.25))
        group.append(([P(x, y, z1) for x, y in ring], FILLS['new'], '#111', 0.3))
    pts_ = [c for poly_, *_ in group for c in poly_]
    items.append((sum(c[2] for c in pts_) / len(pts_), None, group, None, None))
    items.sort(key=lambda it: -it[0])                            # far first
    xs, ys = [c[0] for c in frame], [c[1] for c in frame]
    x0, x1, y0, y1 = min(xs) - reach, max(xs) + reach, min(ys) - reach * tall, max(ys) + reach * tall
    svg = [f'<svg viewBox="{x0:.1f} {-y1:.1f} {x1 - x0:.1f} {y1 - y0:.1f}" xmlns="http://www.w3.org/2000/svg"><rect x="{x0:.1f}" y="{-y1:.1f}" width="{x1 - x0:.1f}" height="{y1 - y0:.1f}" fill="#f7f6f3"/>']
    for depth, poly, fill, stroke, sw in items:
        for poly_, fill_, stroke_, sw_ in (fill if poly is None else [(poly, fill, stroke, sw)]):
            svg.append(f'<polygon points="{" ".join(f"{c[0]:.2f},{-c[1]:.2f}" for c in poly_)}" fill="{fill_}" stroke="{stroke_}" stroke-width="{sw_}" stroke-linejoin="round"/>')
    # each new building and ours named on its roof, where the frame holds it, the one read in the middle of the frame
    sub_top = max(sub_b['parts'], key=lambda q: q['z1'])
    r_ = sub_top['ring']
    labels.append((label_of(sub_b), P(sum(x for x, _ in r_) / len(r_), sum(y for _, y in r_) / len(r_), sub_top['z1'])))
    for text, (lx, ly, _) in labels:
        if x0 + 4 < lx < x1 - 4 and y0 + 4 < ly < y1 - 4:
            svg.append(f'<text x="{lx:.1f}" y="{-ly:.1f}" font-size="3.4" font-weight="700" text-anchor="middle" dominant-baseline="middle" '
                       f'fill="{"#c0161c" if text == "ours" else "#111"}" paint-order="stroke" stroke="#fff" stroke-width="1.1">{H.escape(text)}</text>')
    svg.append('</svg>')
    return ''.join(svg)


def hourly_share(faces):
    """The share of a building's facade (its party walls aside) in sun at each whole hour, by area."""
    out = []
    for hi in range(len(WHOLE)):
        a = lit = 0.0
        for f in faces:
            if f['blank']:
                continue
            w = f['length'] / max(1, round(f['length'] / ff.CELL_M))
            for c in f['cells']:
                ar = w * (ff.H_of(c['storey']) - ff.storey_bottom(c['storey']))
                a += ar
                lit += ar * (c.get('hourly', '')[hi:hi + 1] == '1')
        out.append(lit / a if a else 0.0)
    return out


def sun_eye_sheet(b, faces, name, a5, aS):
    """A building's view from the sun: the scene as the sun sees it at each whole hour from 9 to 3, framed on it, its
    facade lit where the sun reaches it, and its figures."""
    views = ''
    for hour, s in zip(range(9, 16), WHOLE):
        if s is None:
            continue
        alt = math.degrees(math.asin(s[2]))
        az = (math.degrees(math.atan2(s[0], s[1])) + 360) % 360
        views += f'<div class="sv"><div class="svt">{hour}:00 <span>sun at {az:.0f}°, {alt:.0f}° up</span></div>{sun_eye_svg(b["id"], faces, hour, s)}</div>'
    shares = hourly_share(faces)
    hrs = ''.join(f'<tr><td>{h}:00</td><td class="r">{v * 100:.0f}%</td></tr>' for h, v in zip(range(9, 16), shares))
    result = (f'<div class="sv res"><div class="rbig">{pct(a5["two"])}</div>'
              f'<div class="rl">of its facade has two hours of sun or more, 9 to 3 on 21 June.</div>'
              f'<div class="rs">No sun at all on {pct(a5["none"])} of it; on average {a5["mean"]:.1f} h.</div>'
              f'<div class="rs">Counting only sun more than {STRICT:g}° off the wall: {pct(aS["two"])}.</div>'
              f'<div class="rs">Read cell by cell, as its facade sheet reads it, every face but its party walls and its podium, timed to the {STEP_WORD}. '
              f'The views are the whole hours; the figures add the sun between them.</div>'
              f'<table class="rt2"><tr><th>At</th><th class="r">facade in sun</th></tr>{hrs}</table>'
              f'<div class="rkey"><span style="background:{SUN_LIT}"></span>its facade in sun at that hour<br><span style="background:{SUN_SHADE}"></span>its facade in shadow<br>'
              f'<span style="background:{FILLS["new"]};border-color:#111"></span>its podium and party walls, not read<br>'
              f'<span style="background:{FILLS["new"]}"></span>the other new buildings, named on their roofs<br>'
              f'<span style="background:{FILLS["site"]};border-color:#c0161c"></span>our building</div></div>')
    body = (head(f'the view from the sun on {name}', f'{name}: mid-winter, 21 June, each whole hour from 9 to 3. What the sun sees is in sun, what it cannot see is in shadow.')
            + f'<div class="views">{views}{result}</div>')
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}{eye_css()}</style></head><body>{body}</body></html>'


def eye_css():
    return (f'.views{{position:absolute;left:{10 * MM:.0f}px;top:{27 * MM:.0f}px;width:{400 * MM:.0f}px;height:{262 * MM:.0f}px;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:1fr 1fr;gap:{4 * MM:.0f}px {4 * MM:.0f}px}}'
            f'.sv{{min-width:0;min-height:0;display:flex;flex-direction:column}} .sv svg{{flex:1;min-height:0;width:100%}}'
            f'.svt{{font-size:{9 * PT:.1f}px;font-weight:700;margin-bottom:{1 * MM:.0f}px}} .svt span{{font-weight:400;color:#666}}'
            f'.res{{justify-content:center;padding:0 {6 * MM:.0f}px}} .rbig{{font-size:{64 * PT:.1f}px;font-weight:800;line-height:1}}'
            f'.rl{{font-size:{10 * PT:.1f}px;font-weight:600;margin:{2 * MM:.0f}px 0 {4 * MM:.0f}px}} .rs{{font-size:{8.5 * PT:.1f}px;color:#333;margin-bottom:{1.2 * MM:.0f}px}}'
            f'.rt2{{width:60%;margin-top:{3 * MM:.0f}px;font-size:{7.5 * PT:.1f}px}}'
            f'.rkey{{font-size:{7.5 * PT:.1f}px;color:#444;margin-top:{4 * MM:.0f}px;line-height:1.9}} .rkey span{{display:inline-block;width:{4 * MM:.0f}px;height:{2.6 * MM:.0f}px;margin-right:{2 * MM:.0f}px;vertical-align:middle;border:{.25 * MM:.1f}px solid #777}}')


def building_sheet(b, faces, total):
    key = b['id'].split('-', 1)[1]
    name = pnames.get(key, b['name'])
    ring = min(b['parts'], key=lambda q: q['z0'])['ring']
    cx, cy = sum(x for x, _ in ring) / len(ring), sum(y for _, y in ring) / len(ring)
    views = [((-0.7071, -0.7071), 'From the south-west'), ((0.7071, 0.7071), 'From the north-east')]
    axos = ''.join(f'<div class="ax"><div class="cap">{cap}</div><div class="axb">{ff.axo_svg(scene, faces, "with", v, subject=b["id"], centre=(cx, cy), reach=52)}</div></div>' for v, cap in views)
    a5, aS = figures(faces, 'with'), figures(faces, 'strict')
    storeys = max(c['storey'] for f in faces for c in f['cells'])
    t5, _ = ff.stats(faces, 'with')
    bar = '<div class="bar">' + ''.join(f'<i style="background:{ff.LORIKEET[i]};width:{t5["bands"][i] / t5["area"] * 100:.2f}%"></i>' for i in range(7) if t5['area'] and t5['bands'][i] > 0) + '</div>'
    trs = ''
    for side in SIDES:
        f5, fS = figures(faces, 'with', {side}), figures(faces, 'strict', {side})
        if not f5['area']:
            continue
        streets = sorted({f['street'] for f in faces if f['compass'] == side and f['street'] and not f['blank']})
        trs += (f'<tr><td>{SIDE_WORD[side]}{(" · " + H.escape(", ".join(streets))) if streets else ""}</td><td class="r">{f5["area"]:.0f} m²</td>'
                f'<td class="r">{f5["mean"]:.1f} h</td><td class="r"><b>{pct(f5["two"])}</b></td><td class="r">{pct(f5["none"])}</td><td class="r">{pct(fS["two"])}</td></tr>')
    apts = ((solar['buildings'].get(b['id']) or {}).get('apts') or {}).get('planned')
    lead = (f'{pct(a5["two"])} of its facade has two hours of sun or more on 21 June, {pct(a5["none"])} none; on average {a5["mean"]:.1f} h. '
            f'Counting only sun more than {STRICT:g}° off the wall, {pct(aS["two"])}.'
            + (f' The plan sheet\'s apartment reading, on an assumed plan, gives {pct(apts["share"])}.' if apts else ''))
    body = (head(f'sun on {name}, 21 June', f'{name}: {storeys} storeys, its tower over a three-storey podium. Its residential walls, cell by cell.')
            + f'<div class="axs">{axos}</div><div class="rt"><div class="big">{pct(a5["two"])}</div><p class="lead">{H.escape(lead)}</p>'
            + f'<div class="key">{band_key()}<span class="kb"><i style="background:{ff.BLANK}"></i>party wall, no window</span></div>'
            + ff.elevation_svg(faces, 'with', 196, 'Unfolded · its tower', total) + f'<div class="sl">{bar}</div>'
            + f'<table><tr><th>Its faces, the way they look</th><th class="r">facade</th><th class="r">mean</th><th class="r">2 h or more</th><th class="r">none</th><th class="r">2 h+, over {STRICT:g}°</th></tr>{trs}</table>'
            + f'<div class="ass">{H.escape(HOW)}</div></div>')
    return dict(key=key, name=name, storeys=storeys, all=a5, strict=aS, apts=apts, sides={s: figures(faces, 'with', {s}) for s in SIDES},
                html=f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>{body}</body></html>')


rows, files = [], []
for b in scene['buildings']:
    if b['kind'] != 'new':
        continue
    faces = ff.faces_of(b, residential=True)
    if not faces:
        continue
    read_both(faces)
    total = ff.unfold(faces)
    r = building_sheet(b, faces, total)
    path = os.path.join(OUT, f'future-neighbour-{NO}-{r["key"]}.html')
    open(path, 'w').write(r['html'])
    eye = os.path.join(OUT, f'future-neighbour-{NO}-{r["key"]}-sun.html')
    open(eye, 'w').write(sun_eye_sheet(b, faces, r['name'], r['all'], r['strict']))
    files += [path, eye]
    rows.append(r)

# ours, read the same way, for the comparison: every wall that can hold a window, podium and ground floor with it
site = next(b for b in scene['buildings'] if b['kind'] == 'site')
ours = ff.our_faces(site)
read_both(ours)
ours_row = dict(key='ours', name='Our building', storeys=max(c['storey'] for f in ours for c in f['cells']), all=figures(ours, 'with'), strict=figures(ours, 'strict'),
                apts=None, sides={s: figures(ours, 'with', {s}) for s in SIDES})

table = ''
for r in [ours_row] + rows:
    sides = ''.join(f'<td class="r">{pct(r["sides"][s]["two"])}</td>' for s in SIDES)
    table += (f'<tr><td><b>{H.escape(r["name"])}</b></td><td class="r">{r["storeys"]}</td><td class="r">{r["all"]["area"]:.0f} m²</td>'
              f'<td class="r"><b>{pct(r["all"]["two"])}</b></td><td class="r">{pct(r["all"]["none"])}</td><td class="r">{r["all"]["mean"]:.1f} h</td>'
              f'<td class="r">{pct(r["strict"]["two"])}</td>{sides}<td class="r">{pct(r["apts"]["share"]) if r["apts"] else "—"}</td></tr>')
summary = (head('sun on every new building, 21 June', 'Every new building round us, and ours, read the same way: the share of its facade with two hours of sun or more.')
           + f'<div class="wide"><table><tr><th>Building</th><th class="r">storeys</th><th class="r">facade</th><th class="r">2 h or more</th><th class="r">none</th>'
           + f'<th class="r">mean</th><th class="r">2 h+, over {STRICT:g}°</th>' + ''.join(f'<th class="r">{SIDE_WORD[s]}, 2 h+</th>' for s in SIDES)
           + f'<th class="r">apartments, plan sheet</th></tr>{table}</table>'
           + f'<div class="ass" style="margin-top:{6 * MM:.0f}px;font-size:{7 * PT:.1f}px">{H.escape(HOW)} Ours is read on every wall that can hold a window, its podium and ground floor with them. '
           + 'The plan sheet\'s apartment column reads each neighbour on an assumed plan (bays along its long walls, corner apartments on both their walls) at the whole hours, '
           + 'as three hourly views of the sun show it; it is not a facade figure.</div>'
           + '<div style="margin-top:8mm">' + '</div></div>')
spath = os.path.join(OUT, f'future-neighbours-{NO}.html')
open(spath, 'w').write(f'<!doctype html><html><head><meta charset="utf-8"><style>{css()}</style></head><body>{summary}</body></html>')

json.dump(dict(scene=NO, step_min=ff.STEP_MIN, strict=STRICT, rows=[{k: v for k, v in r.items() if k != 'html'} for r in [ours_row] + rows]),
          open(os.path.join(OUT, f'future-neighbours-{NO}.json'), 'w'), indent=1, default=float)
with open(os.path.join(OUT, f'future-neighbours-{NO}.csv'), 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['building', 'storeys', 'facade m2', '2h+ (5deg)', 'none', 'mean h', f'2h+ ({STRICT:g}deg)'] + [f'{SIDE_WORD[s]} 2h+' for s in SIDES] + [f'{SIDE_WORD[s]} mean h' for s in SIDES] + ['apartments, plan sheet'])
    for r in [ours_row] + rows:
        w.writerow([r['name'], r['storeys'], round(r['all']['area']), pct(r['all']['two']), pct(r['all']['none']), f"{r['all']['mean']:.1f}", pct(r['strict']['two'])]
                   + [pct(r['sides'][s]['two']) for s in SIDES] + [f"{r['sides'][s]['mean']:.1f}" if r['sides'][s]['mean'] is not None else '' for s in SIDES]
                   + [pct(r['apts']['share']) if r['apts'] else ''])
print('\n'.join([spath] + files))

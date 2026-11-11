"""Mid-winter sun over each scenario's massing, cast with Loriini's core (numpy alone), and the ADG's apartment test
read off it: for every building, apartments line its residential walls in bays of about 8 m, one a storey, on both
long faces of a double-loaded plan or the better face of a single-loaded one, a corner apartment counted once on both
its walls; a bay complies where at least half its wall at that storey gets two continuous hours of direct sun between
9 and 3 on 21 June (the longest unbroken run, as three hourly sun's-eye views show it), and a building complies where 70 % of its bays do and no more than 15 % get none (ADG 4A-1). Each building
is read as planned and as it would be single-loaded, with the scenario standing, and again without our tower (for
ours, with today's buildings alone), so the sheet can say who complies, with what plan, and whom our tower shades.
Where a building's prisms say which walls hold apartments (its podium's, its tower's), each group is read on its own
as well as the whole.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_solar.py out/capacity/<slug>

Reads the future-scene-<n>.json files future_context.py writes (every building as prisms in metres east and north of
the site, each prism saying which of its walls carry apartments, `homes`: none, podium, tower or all, and which of
its edges are party walls, `party`, which hold none) and writes future-solar-<n>.json beside each. The grid is a
metre (SUN_SPACING_M), the step ten minutes, the bay BAY_M, the storey 3.2 m.
"""
import datetime as dt
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
import numpy as np  # noqa: E402
from sun_study.core.analysis import band_by_area, cumulative_minutes, instant_weights, longest_continuous_minutes, sunlit_matrix  # noqa: E402
from sun_study.core.facade import vertical_face_panels  # noqa: E402
from sun_study.core.geometry import TriangleMesh, prism  # noqa: E402
from sun_study.core.occlusion import Occluder  # noqa: E402
from sun_study.core.sampling import SamplePoints  # noqa: E402
from sun_study.core.solar import assessment_times, solar_position  # noqa: E402

OUT = sys.argv[1]
SPACING = float(os.environ.get('SUN_SPACING_M', '1.0'))
BAY_M = float(os.environ.get('BAY_M', '8.0'))
STOREY_M = 3.2
STEP = 10
THRESHOLD = 120.0
LONG_FACE_M = 14.0          # a wall shorter than this is an end, owned by the corner units of the long faces
SINGLE = ('single',)        # the types whose apartments face one way
PARTY_M = 0.6               # a wall whose two feet stand this close to a party edge is that party wall


def seg_distance(pt, a, b):
    """A point's distance to the segment a-b, in plan."""
    pt, a, b = np.asarray(pt[:2]), np.asarray(a), np.asarray(b)
    ab = b - a
    t = 0.0 if not ab.any() else float(np.clip(np.dot(pt - a, ab) / np.dot(ab, ab), 0.0, 1.0))
    return float(np.linalg.norm(pt - (a + t * ab)))


def on_party(panel, width, party):
    """Whether a panel stands on one of the part's party edges: both its feet within PARTY_M of the same edge."""
    foot0 = np.asarray(panel.origin)
    foot1 = foot0 + np.asarray(panel.axis_u) * width
    return any(seg_distance(foot0, e[:2], e[2:]) < PARTY_M and seg_distance(foot1, e[:2], e[2:]) < PARTY_M for e in party)


def apartment_test(pairs, kind):
    """The bays of the given walls (each a panel with its samples' minutes), each a storey tall, and whether each gets
    its two hours: the share that does and the share that gets none, on both long faces (a double-loaded plan) and
    on the better face alone (single-loaded), a corner apartment counted once on both its walls."""
    faces = []
    for p, mins in pairs:
        u, v = p.cell_uv[:, 0], p.cell_uv[:, 1]
        width, height = float(u.max()) + p.spacing_m / 2, float(v.max()) + p.spacing_m / 2
        nb = max(1, int(width // BAY_M + (1 if width % BAY_M >= BAY_M / 2 else 0)))
        nf = max(1, int(height // STOREY_M + (1 if height % STOREY_M >= STOREY_M / 2 else 0)))
        bi = np.minimum((u / BAY_M).astype(int), nb - 1)
        fi = np.minimum((v / STOREY_M).astype(int), nf - 1)
        ok = np.zeros((nb, nf), dtype=bool)
        dark = np.zeros((nb, nf), dtype=bool)
        for b in range(nb):
            for fl in range(nf):
                cell = (bi == b) & (fi == fl)
                if cell.any():
                    ok[b, fl] = np.mean(mins[cell] >= THRESHOLD) >= 0.5
                    dark[b, fl] = np.all(mins[cell] <= 0.0)
        faces.append(dict(width=width, ok=ok, dark=dark, p0=np.asarray(p.origin), p1=np.asarray(p.origin) + np.asarray(p.axis_u) * width, normal=np.asarray(p.normal)[:2]))
    if not faces:
        return None
    longs = [i for i, f in enumerate(faces) if f['width'] >= LONG_FACE_M] or sorted(range(len(faces)), key=lambda i: -faces[i]['width'])[:2]
    # where two walls meet, the two corner bays are one apartment on both walls: it has its sun where either does and
    # is dark only where both are
    corners = []
    for i, f in enumerate(faces):
        for j, g in enumerate(faces):
            if j <= i:
                continue
            for fp_i, fp in ((0, f['p0']), (f['ok'].shape[0] - 1, f['p1'])):
                for gp_i, gp in ((0, g['p0']), (g['ok'].shape[0] - 1, g['p1'])):
                    if np.linalg.norm(fp - gp) < 1.5:
                        corners.append((i, fp_i, j, gp_i))
    corner_bays = {(i, b) for i, b, j, c in corners} | {(j, c) for i, b, j, c in corners}

    def share(sel):
        total = ok = dark = 0
        for i in sel:
            f = faces[i]
            for b in range(f['ok'].shape[0]):
                if (i, b) in corner_bays:
                    continue
                total += f['ok'].shape[1]
                ok += int(f['ok'][b].sum())
                dark += int(f['dark'][b].sum())
        for i, b, j, c in corners:
            if i in sel or j in sel:
                nf = min(faces[i]['ok'].shape[1], faces[j]['ok'].shape[1])
                total += nf
                ok += int((faces[i]['ok'][b, :nf] | faces[j]['ok'][c, :nf]).sum())
                dark += int((faces[i]['dark'][b, :nf] & faces[j]['dark'][c, :nf]).sum())
        return dict(share=ok / total if total else 0.0, dark=dark / total if total else 0.0, bays=total)

    double = share(longs)
    # the faces that carry an apartment of their own, not only the corner ones shared with the faces beside them: an
    # 18 m end wall holds two corner bays and nothing else, so a slab stays double-loaded; a 15 m end wall on a block
    # built to its boundary holds one of its own. How many such faces there are says what the plan is (one where the
    # other long wall is a party wall, which makes a double-loaded plan single), and the best of them is the
    # single-loaded figure, with the way it looks, which for a single-loaded plan is the way its apartments face
    principal = [i for i in longs if any((i, b) not in corner_bays for b in range(faces[i]['ok'].shape[0]))] or longs
    best = max(principal, key=lambda i: share([i])['share'])
    single = share([best])
    return dict(double=double, single=single, planned=single if kind in SINGLE else double, sides=len(principal), single_face=compass(faces[best]['normal']),
                principal_m=round(max(faces[i]['width'] for i in principal), 1))


def compass(normal):
    az = (math.degrees(math.atan2(float(normal[0]), float(normal[1]))) + 360) % 360
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][int((az + 22.5) // 45) % 8]


CORNER_M = 8.0              # how far along the end wall a corner apartment's windows reach


def unit_test(pairs, units, lit_by_panel=None):
    """The plans' own apartments on one part's walls: each unit a span of a face (east or west, from the north end)
    at every storey, with the end wall's first CORNER_M metres where it is a corner unit; it has its two hours where
    half the wall of its span at that storey does, on either of its walls, and is dark only where both are."""
    faces = {}
    for p, mins in pairs:
        n = np.asarray(p.normal)
        d = 'E' if n[0] > 0.7 else 'W' if n[0] < -0.7 else 'N' if n[1] > 0.7 else 'S' if n[1] < -0.7 else None
        if d is None:
            continue
        u, v = p.cell_uv[:, 0], p.cell_uv[:, 1]
        width = float(u.max()) + p.spacing_m / 2
        origin = np.asarray(p.origin)
        far = origin + np.asarray(p.axis_u) * width
        # the coordinate along the wall from its north end (an east or west wall) or its east end (a north or south one)
        s_ = u if (origin[1] > far[1] if d in 'EW' else origin[0] > far[0]) else width - u
        faces.setdefault(d, []).append(dict(s=s_, v=v, mins=mins, width=width, lit=lit_by_panel.get(id(p)) if lit_by_panel else None))
    if not faces:
        return None
    nf = max(1, int(round(max(f['v'].max() for fs in faces.values() for f in fs) / STOREY_M)))

    def cells(d, a, b, fl, what='mins'):
        return [f[what][(f['s'] >= a) & (f['s'] < b) & ((f['v'] // STOREY_M).astype(int) == fl)] for f in faces.get(d, []) if f[what] is not None]

    total = ok = dark = 0
    each = []
    for side, lst in (('east', units.get('east', [])), ('west', units.get('west', []))):
        d = 'E' if side == 'east' else 'W'
        at = 0.0
        for unit in lst:
            width, corner = float(unit[1]), (unit[2] if len(unit) > 2 else None)
            a, b = at, at + width
            at = b
            for fl in range(nf):
                main = np.concatenate(cells(d, a, b, fl) or [np.zeros(0)])
                end = np.zeros(0)
                if corner:
                    ew = max((f['width'] for f in faces.get(corner, [])), default=0.0)
                    end = np.concatenate(cells(corner, 0.0, CORNER_M, fl) if d == 'E' else cells(corner, max(0.0, ew - CORNER_M), ew, fl) or [np.zeros(0)])
                if main.size == 0 and end.size == 0:
                    continue
                total += 1
                lit = bool((main.size and np.mean(main >= THRESHOLD) >= 0.5) or (end.size and np.mean(end >= THRESHOLD) >= 0.5))
                none = bool((main.size == 0 or np.all(main <= 0)) and (end.size == 0 or np.all(end <= 0)))
                ok += int(lit)
                dark += int(none)
                series = ''
                if lit_by_panel:
                    rows_ = cells(d, a, b, fl, 'lit') + (cells(corner, 0.0, CORNER_M, fl, 'lit') if d == 'E' and corner else cells(corner, max(0.0, ew - CORNER_M), ew, fl, 'lit') if corner else [])
                    rows_ = [x for x in rows_ if x.size]
                    if rows_:
                        stack = np.concatenate(rows_, axis=0)                      # (cells, instants)
                        series = ''.join('1' if x else '0' for x in (stack.mean(axis=0) >= 0.5))
                each.append((str(unit[0]), fl, lit, none, series))
    r = dict(share=ok / total if total else 0.0, dark=dark / total if total else 0.0, bays=total)
    return dict(double=r, single=r, planned=r, units=True, per_floor=sum(len(v) for v in units.values()), each=each)


for path in sorted(glob.glob(f'{OUT}/future-scene-*.json')):
    scene = json.load(open(path))
    times = assessment_times(dt.date(scene['year'], 6, 21), scene['timezone'], dt.time(9), dt.time(15), STEP)
    sun = solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu()        # the scene is east, north, up
    weights = instant_weights(len(times), STEP)
    meshes, walls = {}, {}
    for b in scene['buildings']:
        parts = [(part, prism(part['ring'], part['z0'], part['z1'])) for part in b['parts'] if len(part['ring']) >= 3]
        if not parts:
            continue
        meshes[b['id']] = TriangleMesh.concatenate([m for _, m in parts])
        # the walls apartments live on, by group; a part without the field: on a podium 'tower', else 'all'
        groups = []
        for part, m in parts:
            g = part.get('homes') or ('tower' if part['z0'] > 0 and any(q['z0'] == 0 for q in b['parts']) else 'all')
            if g != 'none':
                groups.append((g, m, part.get('party', []), part.get('units')))
        walls[b['id']] = groups
    kinds = {b['id']: b['kind'] for b in scene['buildings']}
    ids = list(meshes)

    def occluder(keep):
        return Occluder(TriangleMesh.concatenate([meshes[i] for i in ids if keep(kinds[i])]))

    occ = {'with': occluder(lambda k: True), 'without_site': occluder(lambda k: k != 'site'), 'today': occluder(lambda k: k != 'new')}

    out = {}
    for b in scene['buildings']:
        if b['kind'] == 'context' or b['id'] not in meshes:
            continue
        tagged = []                                                   # (group, panel), the party walls left out
        plans = {}                                                    # the plans' apartments on a group's walls, where given
        party_m = 0.0                                                 # the longest wall left out as a party wall
        for g, m, party, units in walls[b['id']]:
            if units:
                plans[g] = units
            for p in vertical_face_panels(m, b['id'], spacing_m=SPACING):
                width = float(p.cell_uv[:, 0].max()) + p.spacing_m / 2
                if not on_party(p, width, party):
                    tagged.append((g, p))
                else:
                    party_m = max(party_m, width)
        if not tagged:
            continue
        pts = SamplePoints.concatenate([p.samples for _, p in tagged])
        other = 'today' if b['kind'] == 'site' else 'without_site'
        rec = dict(name=b['name'], kind=b['kind'], type=b.get('type', ''), facade_m2=pts.total_area_m2, party_m=round(party_m, 1))
        for key, o in (('with', occ['with']), (other, occ[other])):
            # the ADG's two hours are continuous, as three hourly sun's-eye views show them: the longest unbroken run
            # of sun on each cell, not its minutes added up over the day
            lit = sunlit_matrix(pts, o, sun)
            minutes = longest_continuous_minutes(lit, STEP)
            per, lit_by_panel = [], {}
            at = 0
            for g, p in tagged:
                per.append((g, p, minutes[at:at + len(p.samples)]))
                lit_by_panel[id(p)] = lit[at:at + len(p.samples)]
                at += len(p.samples)
            def test(grp):
                pairs = [(p, mins) for g, p, mins in per if g == grp]
                return unit_test(pairs, plans[grp], lit_by_panel if key == 'with' else None) if grp in plans else apartment_test(pairs, b.get('type', ''))
            by = {grp: test(grp) for grp in sorted({g for g, _, _ in per})}
            if plans and all(g in plans for g in by):                 # the whole from the groups' own counts
                n = sum(v['planned']['bays'] for v in by.values() if v)
                whole_r = dict(share=sum(v['planned']['share'] * v['planned']['bays'] for v in by.values() if v) / n if n else 0.0,
                               dark=sum(v['planned']['dark'] * v['planned']['bays'] for v in by.values() if v) / n if n else 0.0, bays=n)
                whole = dict(double=whole_r, single=whole_r, planned=whole_r, units=True)
            else:
                whole = apartment_test([(p, mins) for g, p, mins in per], b.get('type', ''))
            if key == 'with':
                rec['share'] = band_by_area(pts, minutes, threshold_minutes=THRESHOLD).at_or_above_threshold_share
                rec['apts'], rec['apts_by'] = whole, by
                if plans:
                    rec['units'] = True
                    rec['per_floor'] = {g: v.get('per_floor') for g, v in by.items() if v}
            else:
                rec[other] = band_by_area(pts, minutes, threshold_minutes=THRESHOLD).at_or_above_threshold_share
                rec[f'apts_{other}'], rec['apts_other_by'] = whole, by
        out[b['id']] = rec
    target = path.replace('future-scene-', 'future-solar-')
    json.dump(dict(buildings=out, instants=len(times), times=[t.strftime('%H:%M') for t in times], sun=[[float(x) for x in v] for v in sun], step=STEP,
                   spacing_m=SPACING, bay_m=BAY_M, date=f'{scene["year"]}-06-21', threshold_minutes=THRESHOLD), open(target, 'w'))
    print(f'{os.path.basename(target)}: ' + '; '.join(f'{r["name"]} {r["apts"]["planned"]["share"]:.0%} of bays'
                                                      + (''.join(f', {g} {v["planned"]["share"]:.0%}' for g, v in r['apts_by'].items()) if len(r['apts_by']) > 1 else '')
                                                      + f' (single {r["apts"]["single"]["share"]:.0%})' for r in out.values() if r.get('apts')))

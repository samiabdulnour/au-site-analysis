"""Mid-winter sun over each scenario's massing, cast with Loriini's core (numpy alone), and the ADG's apartment test
read off it: for every building, apartments line its walls in bays of about 8 m, one a storey, on both long faces of a
double-loaded plan or the better face of a single-loaded one, the bays at the ends owning the end wall too (corner
units); a bay complies where at least half its wall at that storey gets two hours of direct sun between 9 and 3 on
21 June, and a building complies where 70 % of its bays do and no more than 15 % get none (ADG 4A-1). Each building
is read as planned and as it would be single-loaded, with the scenario standing, and again without our tower (for
ours, with today's buildings alone), so the sheet can say who complies, with what plan, and whom our tower shades.

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_solar.py out/capacity/<slug>

Reads the future-scene-<n>.json files future_context.py writes (every building as prisms in metres east and north of
the site, its type, the site's latitude and longitude) and writes future-solar-<n>.json beside each. The grid is a
metre (SUN_SPACING_M), the step ten minutes, the bay BAY_M, the storey 3.2 m; a podium's walls carry no apartments.
"""
import datetime as dt
import glob
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
import numpy as np  # noqa: E402
from sun_study.core.analysis import band_by_area, cumulative_minutes, instant_weights, sunlit_matrix  # noqa: E402
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
LONG_FACE_M = 16.0          # a wall shorter than this is an end, owned by the corner units of the long faces
SINGLE = ('single',)        # the types whose apartments face one way


def apartment_test(panels, minutes, kind):
    """The bays of a building's residential walls, each a storey tall, and whether each gets its two hours: the share
    that does and the share that gets none, on both long faces (a double-loaded plan) and on the better face alone
    (single-loaded), with the end walls credited to the corner bays."""
    faces = []
    at = 0
    for p in panels:
        n = len(p.samples)
        mins = minutes[at:at + n]
        at += n
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
        faces.append(dict(width=width, ok=ok, dark=dark, p0=np.asarray(p.origin), p1=np.asarray(p.origin) + np.asarray(p.axis_u) * width))
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
        """The units on the selected walls: their plain bays, and the corner units they take part in."""
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
    single = max((share([i]) for i in longs), key=lambda r: r['share'])
    return dict(double=double, single=single, planned=single if kind in SINGLE else double)


for path in sorted(glob.glob(f'{OUT}/future-scene-*.json')):
    scene = json.load(open(path))
    times = assessment_times(dt.date(scene['year'], 6, 21), scene['timezone'], dt.time(9), dt.time(15), STEP)
    sun = solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu()        # the scene is east, north, up
    weights = instant_weights(len(times), STEP)
    meshes, homes = {}, {}
    for b in scene['buildings']:
        parts = [(part, prism(part['ring'], part['z0'], part['z1'])) for part in b['parts'] if len(part['ring']) >= 3]
        if not parts:
            continue
        meshes[b['id']] = TriangleMesh.concatenate([m for _, m in parts])
        # the walls apartments live on: the parts that stand on a podium, else every part
        homes[b['id']] = [m for part, m in parts if part['z0'] > 0] or [m for _, m in parts]
    kinds = {b['id']: b['kind'] for b in scene['buildings']}
    ids = list(meshes)

    def occluder(keep):
        return Occluder(TriangleMesh.concatenate([meshes[i] for i in ids if keep(kinds[i])]))

    occ = {'with': occluder(lambda k: True), 'without_site': occluder(lambda k: k != 'site'), 'today': occluder(lambda k: k != 'new')}

    out = {}
    for b in scene['buildings']:
        if b['kind'] == 'context' or b['id'] not in meshes:
            continue
        panels = [p for m in homes[b['id']] for p in vertical_face_panels(m, b['id'], spacing_m=SPACING)]
        pts = SamplePoints.concatenate([p.samples for p in panels]) if panels else SamplePoints.empty()
        if len(pts) == 0:
            continue
        other = 'today' if b['kind'] == 'site' else 'without_site'
        rec = dict(name=b['name'], kind=b['kind'], type=b.get('type', ''), facade_m2=pts.total_area_m2)
        for key, o in (('with', occ['with']), (other, occ[other])):
            minutes = cumulative_minutes(sunlit_matrix(pts, o, sun), weights)
            rec['share' if key == 'with' else key] = band_by_area(pts, minutes, threshold_minutes=THRESHOLD).at_or_above_threshold_share
            rec['apts' if key == 'with' else f'apts_{other}'] = apartment_test(panels, minutes, b.get('type', ''))
        out[b['id']] = rec
    target = path.replace('future-scene-', 'future-solar-')
    json.dump(dict(buildings=out, instants=len(times), spacing_m=SPACING, bay_m=BAY_M, date=f'{scene["year"]}-06-21', threshold_minutes=THRESHOLD), open(target, 'w'))
    print(f'{os.path.basename(target)}: ' + '; '.join(f'{r["name"]} {r["apts"]["planned"]["share"]:.0%} of bays (single {r["apts"]["single"]["share"]:.0%})' for r in out.values() if r.get('apts')))

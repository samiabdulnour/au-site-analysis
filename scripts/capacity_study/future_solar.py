"""Mid-winter sun over each scenario's massing, cast with Loriini's core (numpy alone): for every building the share
of its upright facade that gets two hours of direct sun between 9 and 3 on 21 June, with the scenario's neighbours
standing, without our tower, and with today's buildings alone, so the sheet can say who is likely to meet ADG 4A
(70 % of apartments with 2 hours) and whom our tower shades (3B-2).

    LORIINI=/path/to/loriini python3 -I scripts/capacity_study/future_solar.py out/capacity/<slug>

Reads the future-scene-<n>.json files future_context.py writes (every building as prisms in metres east and north
of the site, with the site's latitude and longitude) and writes future-solar-<n>.json beside each. A facade share
is the massing-stage proxy Loriini's own massing mode reports, not the ADG's per-apartment test, which needs
apartments. The grid is a metre (SUN_SPACING_M), the step ten minutes, the surfaces the faces alone.
"""
import datetime as dt
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.environ.get('LORIINI') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'loriini'), 'src'))
from sun_study.core.analysis import band_by_area, cumulative_minutes, instant_weights, sunlit_matrix  # noqa: E402
from sun_study.core.facade import vertical_face_panels  # noqa: E402
from sun_study.core.geometry import TriangleMesh, prism  # noqa: E402
from sun_study.core.occlusion import Occluder  # noqa: E402
from sun_study.core.sampling import SamplePoints  # noqa: E402
from sun_study.core.solar import assessment_times, solar_position  # noqa: E402

OUT = sys.argv[1]
SPACING = float(os.environ.get('SUN_SPACING_M', '1.0'))
STEP = 10
THRESHOLD = 120.0

for path in sorted(glob.glob(f'{OUT}/future-scene-*.json')):
    scene = json.load(open(path))
    times = assessment_times(dt.date(scene['year'], 6, 21), scene['timezone'], dt.time(9), dt.time(15), STEP)
    sun = solar_position(times, scene['lat'], scene['lon']).unit_vectors_enu()        # the scene is east, north, up
    weights = instant_weights(len(times), STEP)
    meshes = {}
    for b in scene['buildings']:
        parts = [prism(part['ring'], part['z0'], part['z1']) for part in b['parts'] if len(part['ring']) >= 3]
        if parts:
            meshes[b['id']] = TriangleMesh.concatenate(parts)
    kinds = {b['id']: b['kind'] for b in scene['buildings']}
    ids = list(meshes)

    def occluder(keep):
        return Occluder(TriangleMesh.concatenate([meshes[i] for i in ids if keep(kinds[i])]))

    scenes = {'share': occluder(lambda k: True), 'without_site': occluder(lambda k: k != 'site'), 'today': occluder(lambda k: k != 'new')}

    def share(points, occ):
        if len(points) == 0:
            return None
        minutes = cumulative_minutes(sunlit_matrix(points, occ, sun), weights)
        return band_by_area(points, minutes, threshold_minutes=THRESHOLD).at_or_above_threshold_share

    out = {}
    for b in scene['buildings']:
        if b['kind'] == 'context' or b['id'] not in meshes:
            continue
        panels = vertical_face_panels(meshes[b['id']], b['id'], spacing_m=SPACING)
        pts = SamplePoints.concatenate([p.samples for p in panels]) if panels else SamplePoints.empty()
        rec = dict(name=b['name'], kind=b['kind'], facade_m2=pts.total_area_m2, share=share(pts, scenes['share']))
        rec['today' if b['kind'] == 'site' else 'without_site'] = share(pts, scenes['today' if b['kind'] == 'site' else 'without_site'])
        out[b['id']] = rec
    target = path.replace('future-scene-', 'future-solar-')
    json.dump(dict(buildings=out, instants=len(times), spacing_m=SPACING, date=f'{scene["year"]}-06-21', threshold_minutes=THRESHOLD), open(target, 'w'))
    print(f'{os.path.basename(target)}: ' + '; '.join(f'{r["name"]} {r["share"]:.0%}' + (f' (today {r["today"]:.0%})' if 'today' in r else f' (without ours {r["without_site"]:.0%})') for r in out.values() if r['share'] is not None))

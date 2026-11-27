"""The future-context scenarios side by side: one A3 sheet with each scenario's plan, the sun on our facade (its west and
east faces, as the deck's headline reads them, and the whole of it, against the baseline) and on every new building
round us (whole, podium and tower), read off the sheets' own figures: future-facade-<n>.json, which
future_facade_sun.py writes, and future-neighbours-<n>.json, which future_neighbour_sun.py writes.

    python3 -I scripts/capacity_study/future_compare.py out/capacity/<slug> --scenarios <file> [--scenes 1,2,3,4]

Writes future-compare.html beside them and prints its path.
"""
import base64
import html as H
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import future_facade_sun as ff  # noqa: E402

args = sys.argv[1:]
flag = lambda name, d=None: args[args.index(name) + 1] if name in args else d
OUT = args[0]
scen = json.load(open(flag('--scenarios')))['scenarios']
NOS = [int(x) for x in (flag('--scenes') or ','.join(str(i) for i in range(1, len(scen) + 1))).split(',')]
MM, PT = ff.MM, ff.PT
pct = lambda x: '—' if x is None else f'{x * 100:.0f}%'


def facade(no):
    """Our facade's figures off its JSON: west and east, and the whole, with the scenario and in the baseline."""
    fac = json.load(open(os.path.join(OUT, f'future-facade-{no}.json')))
    out = {'angle': fac.get('min_angle', 5)}
    for key in ('with', 'today'):
        for name, sides in (('we', {'W', 'E'}), ('all', None)):
            a = two = none = hrs = 0.0
            for f in fac['faces']:
                if f['blank'] or (sides and f.get('compass') not in sides):
                    continue
                w = f['length'] / max(1, round(f['length'] / fac.get('cell_m', 3.0)))
                for c in f['cells']:
                    if key not in c:
                        continue
                    ar = w * (ff.H_of(c['storey']) - ff.storey_bottom(c['storey']))
                    a += ar
                    two += ar * (c[key] >= 2 - 1e-9)
                    none += ar * (c[key] <= 1e-9)
                    hrs += ar * c[key]
            out[(key, name)] = dict(two=two / a, none=none / a, mean=hrs / a) if a else None
    return out


def plan_thumb(no):
    """The scenario's plan, cut from its plan sheet and made small enough to carry."""
    from PIL import Image
    path = os.path.join(OUT, f'future-option-{no}.png')
    if not os.path.exists(path):
        return ''
    im = Image.open(path).convert('RGB')
    w, h = im.size
    im = im.crop((int(w * 0.02), int(h * 0.075), int(w * 0.79), int(h * 0.985)))
    im.thumbnail((1300, 1300))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=82)
    return f'<img src="data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}">'


cols = []
for no in NOS:
    s = scen[no - 1]
    fa = facade(no)
    nb = json.load(open(os.path.join(OUT, f'future-neighbours-{no}.json')))
    rows = [r for r in nb['rows'] if r['key'] != 'ours']
    ours = next(r for r in nb['rows'] if r['key'] == 'ours')
    w_we, t_we, w_all, t_all = fa[('with', 'we')], fa[('today', 'we')], fa[('with', 'all')], fa[('today', 'all')]
    trs = ''.join(f'<tr><td><b>{H.escape(r["key"])}</b> {H.escape(r["name"])}</td><td class="r">{r["storeys"]}</td><td class="r"><b>{pct(r["all"]["two"])}</b></td>'
                  f'<td class="r">{pct((r.get("podium") or {}).get("two"))}</td><td class="r">{pct((r.get("tower") or {}).get("two"))}</td></tr>' for r in rows)
    cols.append(f'''<div class="col"><div class="no">{no}</div><div class="tt">{H.escape(s["title"])}</div><div class="th">{plan_thumb(no)}</div>
<div class="big">{pct(w_we["two"])}</div><div class="bl">of our west and east facades with 2 h or more; {pct(t_we["two"]) if t_we else "—"} in the baseline</div>
<table><tr><th>Our building</th><th class="r">scenario</th><th class="r">baseline</th></tr>
<tr><td>west and east, 2 h+</td><td class="r"><b>{pct(w_we["two"])}</b></td><td class="r">{pct(t_we["two"]) if t_we else "—"}</td></tr>
<tr><td>whole facade, 2 h+</td><td class="r">{pct(w_all["two"])}</td><td class="r">{pct(t_all["two"]) if t_all else "—"}</td></tr>
<tr><td>whole facade, no sun</td><td class="r">{pct(w_all["none"])}</td><td class="r">{pct(t_all["none"]) if t_all else "—"}</td></tr>
<tr><td>podium / tower, 2 h+</td><td class="r">{pct(ours["podium"]["two"])} / {pct(ours["tower"]["two"])}</td><td></td></tr></table>
<table class="nb"><tr><th>New building round us</th><th class="r">st</th><th class="r">2 h+</th><th class="r">podium</th><th class="r">tower</th></tr>{trs}</table></div>''')

angle = facade(NOS[0])['angle']
angle_say = ('the sun counted on a wall until it is parallel to it (0°)' if angle == 0 else f'the sun counted on a wall from {angle:g}° off it')
css = f'''@page{{size:{ff.PAGE_W}px {ff.PAGE_H}px;margin:0}} *{{box-sizing:border-box}} html,body{{margin:0;background:#fff}}
body{{width:{ff.PAGE_W}px;height:{ff.PAGE_H}px;font-family:Inter,Helvetica,Arial,sans-serif;color:#111;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.hd{{position:absolute;left:{10 * MM:.0f}px;top:{9 * MM:.0f}px;width:{400 * MM:.0f}px}}
.kick{{font-size:{6.6 * PT:.1f}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5a2ea6}}
h1{{font-size:{17 * PT:.1f}px;line-height:1.1;margin:{1.5 * MM:.0f}px 0 {1 * MM:.0f}px;font-weight:700;letter-spacing:-.01em}}
.hor{{font-size:{7.4 * PT:.1f}px;color:#555}}
.cols{{position:absolute;left:{10 * MM:.0f}px;top:{30 * MM:.0f}px;width:{400 * MM:.0f}px;display:grid;grid-template-columns:repeat({len(NOS)},1fr);column-gap:{6 * MM:.0f}px}}
.col{{min-width:0}} .no{{font-size:{22 * PT:.1f}px;font-weight:800;line-height:1}} .tt{{font-size:{8 * PT:.1f}px;font-weight:700;min-height:{9 * MM:.0f}px;margin:{1 * MM:.0f}px 0 {2 * MM:.0f}px}}
.th img{{width:100%;display:block;border:{.2 * MM:.1f}px solid #ccc}}
.big{{font-size:{40 * PT:.1f}px;font-weight:800;line-height:1;margin:{4 * MM:.0f}px 0 {1 * MM:.0f}px}} .bl{{font-size:{7.4 * PT:.1f}px;color:#333;margin-bottom:{3 * MM:.0f}px}}
table{{border-collapse:collapse;width:100%;font-size:{7 * PT:.1f}px;font-variant-numeric:tabular-nums;margin-bottom:{4 * MM:.0f}px}}
th{{text-align:left;font-weight:600;border-bottom:{.3 * MM:.1f}px solid #111;padding:{.8 * MM:.1f}px {.5 * MM:.1f}px;vertical-align:bottom}}
td{{border-bottom:{.15 * MM:.1f}px solid #ccc;padding:{.8 * MM:.1f}px {.5 * MM:.1f}px}} td.r,th.r{{text-align:right}}
.ass{{position:absolute;left:{10 * MM:.0f}px;bottom:{8 * MM:.0f}px;width:{400 * MM:.0f}px;font-size:{6.4 * PT:.1f}px;color:#444;line-height:1.45}}'''
body = (f'<div class="hd"><div class="kick">Future context · the scenarios side by side</div><h1>Sun on 21 June, {len(NOS)} scenarios</h1>'
        f'<div class="hor">Each scenario\'s plan, the share of our facade with two hours of sun or more between 9 and 3 against the baseline, and the same for '
        f'every new building round us, {H.escape(angle_say)}.</div></div><div class="cols">{"".join(cols)}</div>'
        f'<div class="ass">Read cell by cell: every wall that can hold a window cut into cells about {ff.CELL_M:g} m wide and a storey high, each read at its middle '
        f'{ff.SILL_M:g} m over its floor, every minute from 9 am to 3 pm on 21 June (AEST), {H.escape(angle_say)}, the minutes added whether or not they run together; '
        'party walls hold no window. The baseline is today\'s buildings round us with ours as each scenario draws it, the William Street towers taken away. '
        'Our headline is the west and east faces alone, as the deck reads it; the new buildings are read on all their walls, podium and tower. '
        'Each scenario\'s sheets follow: its plan, the view from the sun, our facades, and each new building. Indicative: a test of the massing, not a solar access report.</div>')
path = os.path.join(OUT, 'future-compare.html')
open(path, 'w').write(f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>{body}</body></html>')
print(path)

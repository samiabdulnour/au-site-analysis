"""Draw the context plan from analysis.json: an A3 landscape sheet at 1:2000, the faded aerial under the cadastre,
every property outlined by ownership, a heritage building in orange, a mature development patched grey, a tick or
a cross on each (a cross on strata ownership, a heritage item, public land and a mature development), the site in
red, the streets named; a white legend panel on the left with the plan's title, scale and north.

    python3 -I scripts/capacity_study/render.py out/capacity/<slug> [notes.html]

Writes diagram.html and page.json (its pixel size) beside analysis.json; scripts/capacity_study.ts prints them.
A notes.html goes under the legend, in the author's own words (the site's story, the amalgamation if any).
"""
import html as H, json, math, re, sys

OUT = sys.argv[1]
NOTES = sys.argv[2] if len(sys.argv) > 2 else None
a = json.load(open(f'{OUT}/analysis.json'))
K = a['k']
e = a['extent']
AW, AH = a['aerial']['pxWidth'], a['aerial']['pxHeight']
props = a['props']
site = next(r for r in props.values() if r.get('isSite'))
meta = a.get('meta', {})
STRATA_MAX, RECENT_YEARS, SINCE, SMALL_SCHEME = a.get('strataMax', 30), a.get('recentYears', 20), a.get('since', 2006), a.get('smallScheme', 5)

# ---- the sheet: A3 landscape at 300 dpi, the legend panel on the left, the map at 1:2000 to the three other edges
DPI = 300
PAGE_W, PAGE_H = round(420 / 25.4 * DPI), round(297 / 25.4 * DPI)   # 4961 x 3508
PANEL_W = round(110 / 25.4 * DPI)                                  # 1299
MAP_W, MAP_H = PAGE_W - PANEL_W, PAGE_H
SCALE = 2000
PX_PER_M = DPI / 25.4 * 1000 / SCALE                               # 5.9 px a ground metre
WIN_W, WIN_H = MAP_W / PX_PER_M, MAP_H / PX_PER_M                  # 620 x 594 ground metres
cx, cy = site['centroid'][0], site['centroid'][1]
wx0, wx1 = cx - WIN_W / 2 * K, cx + WIN_W / 2 * K
wy0, wy1 = cy - WIN_H / 2 * K, cy + WIN_H / 2 * K
sx = AW / (e['xmax'] - e['xmin'])
sy = AH / (e['ymax'] - e['ymin'])
PPM = sx / K  # aerial pixels per ground metre


def px(p):
    return ((p[0] - e['xmin']) * sx, (e['ymax'] - p[1]) * sy)


VX, VY = px((wx0, wy1))
VX1, VY1 = px((wx1, wy0))
VW, VH = VX1 - VX, VY1 - VY
U = VW / MAP_W  # aerial pixels per sheet pixel: line widths below are in sheet pixels, scaled by this


def f(v):
    return f'{v:.1f}'


def w(sheet_px):
    return f(sheet_px * U)


def path(rings):
    return ' '.join('M' + ' L'.join(f'{f(x)},{f(y)}' for x, y in (px(p) for p in r)) + ' Z' for r in rings)


def in_window(p):
    return wx0 <= p[0] <= wx1 and wy0 <= p[1] <= wy1


def visible(r):
    return any(in_window(p) for ring in r['geom'] for p in ring) or in_window(r['centroid'])


# ---- the palette: the office's context plan
ORANGE, WHITE, STRATA, RED, GREEN, CROSS, DOT, INK, GREY = '#e8912a', '#ffffff', '#f2d35b', '#e01f1f', '#23a94d', '#e01f1f', '#2b2b2b', '#111', '#5c5c5c'

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(VX)} {f(VY)} {f(VW)} {f(VH)}" width="{MAP_W}" height="{MAP_H}" font-family="Inter, Helvetica, Arial, sans-serif">']
svg.append(f'''<defs>
<pattern id="heritage" patternUnits="userSpaceOnUse" width="{w(14)}" height="{w(14)}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="{w(14)}" stroke="{ORANGE}" stroke-width="{w(1.6)}" stroke-opacity="0.55"/></pattern>
<pattern id="mature" patternUnits="userSpaceOnUse" width="{w(10)}" height="{w(10)}"><rect width="{w(10)}" height="{w(10)}" fill="{DOT}" fill-opacity="0.22"/><path d="M0,{w(5)} H{w(10)} M{w(5)},0 V{w(10)}" stroke="{DOT}" stroke-width="{w(1.4)}" stroke-opacity="0.85"/></pattern>
<clipPath id="win"><rect x="{f(VX)}" y="{f(VY)}" width="{f(VW)}" height="{f(VH)}"/></clipPath>
</defs>''')
svg.append('<g clip-path="url(#win)">')
# the aerial, faded well back under a white veil so the lines lead (a CSS filter here would make the
# printer rasterise the tiles, and the PDF forty megabytes heavier)
for t in a['aerial']['tiles']:
    svg.append(f'<image href="data/{t["file"]}" x="{f(t["left"] * AW)}" y="{f(t["top"] * AH)}" width="{f(t["width"] * AW)}" height="{f(t["height"] * AH)}" preserveAspectRatio="none"/>')
svg.append(f'<rect x="0" y="0" width="{AW}" height="{AH}" fill="#fff" fill-opacity="0.55"/>')
# the cadastre: every lot, faintly
for l in a['lots']:
    svg.append(f'<path d="{path(l["rings"])}" fill="none" stroke="#777" stroke-width="{w(0.9)}" stroke-opacity="0.55"/>')
def mature(r):
    """A mature development: significantly developed in the past RECENT_YEARS years (the register, a strata plan's date,
    or the author's overrides.json), or with a current approval or construction. Patched, and crossed as well."""
    o = (r.get('override') or {}).get('symbol')
    if o == 'mature':
        return True
    if o in ('potential', 'none'):
        return False
    return r['kind'] == 'developing' or bool(r.get('developed'))


def symbol(r):
    """The mark: potential (a tick) or none, that is low potential (a cross); the author's overrides.json first."""
    o = (r.get('override') or {}).get('symbol')
    if o == 'potential':
        return 'potential'
    if o in ('none', 'mature') or mature(r) or r['kind'] in ('council', 'state') or r.get('heritageItem') or r['strata']:
        return 'none'
    return 'potential'


# ownership: strata filled, a single title outlined in white, public land left to its mark
for pid, r in sorted(props.items(), key=lambda kv: kv[1]['kind'] != 'strata'):
    if not r['geom'] or not visible(r) or r['kind'] in ('council', 'state', 'site'):
        continue
    d = path(r['geom'])
    if r['strata']:
        svg.append(f'<path d="{d}" fill="{STRATA}" fill-opacity="0.5" stroke="{WHITE}" stroke-width="{w(3)}" stroke-linejoin="round"/>')
    else:
        svg.append(f'<path d="{d}" fill="none" stroke="{WHITE}" stroke-width="{w(3.5)}" stroke-linejoin="round"/>')
# mature development: a grey patch over the lot
for pid, r in props.items():
    if r['geom'] and visible(r) and not r.get('isSite') and mature(r):
        svg.append(f'<path d="{path(r["geom"])}" fill="{DOT}" fill-opacity="0.42" stroke="{DOT}" stroke-width="{w(2)}" stroke-opacity="0.8" stroke-linejoin="round"/>')
# heritage buildings: an orange line with a fine orange hatch inside it
for h in a['heritageItems']:
    svg.append(f'<path d="{path(h["rings"])}" fill="url(#heritage)" stroke="{ORANGE}" stroke-width="{w(6.5)}" stroke-linejoin="round"/>')
# the site, in red
svg.append(f'<path d="{path(site["geom"])}" fill="none" stroke="{RED}" stroke-width="{w(12)}" stroke-linejoin="round"/>')


# ---- the marks: a tick, a cross or a dot on every property, sized to it -------------------------------------
def tick(x, y, s, lw):
    d = f'M{f(x - s * 0.42)},{f(y + s * 0.02)} L{f(x - s * 0.10)},{f(y + s * 0.34)} L{f(x + s * 0.46)},{f(y - s * 0.36)}'
    return (f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{f(lw + 4 * U)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"/>'
            f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="{f(lw)}" stroke-linecap="round" stroke-linejoin="round"/>')


def cross(x, y, s, lw):
    h = s * 0.36
    d = f'M{f(x - h)},{f(y - h)} L{f(x + h)},{f(y + h)} M{f(x + h)},{f(y - h)} L{f(x - h)},{f(y + h)}'
    return (f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{f(lw + 4 * U)}" stroke-linecap="round" stroke-opacity="0.9"/>'
            f'<path d="{d}" fill="none" stroke="{CROSS}" stroke-width="{f(lw)}" stroke-linecap="round"/>')


noted, marked = [], []
for pid, r in props.items():
    if not r['geom'] or not in_window(r['centroid']) or (r['areaM2'] or 0) < 40 or r.get('isSite'):  # lane stubs and slivers carry no mark
        continue
    x, y = px(r['centroid'])
    if any(math.hypot(x - mx, y - my) < 0.5 * PPM for mx, my in marked):  # the register's second record of one parcel
        continue
    marked.append((x, y))
    s = max(24, min(72, 1.6 * math.sqrt(r['areaM2'] or 1))) * U
    lw = max(4.5, s / U * 0.15) * U
    kind = symbol(r)
    if kind == 'potential':
        svg.append(tick(x, y, s, lw))
        note = ''
    else:
        svg.append(cross(x, y, s, lw))
        # what dates a mature development, else the size of a large strata scheme
        note = (f"{r['developed']['how']} {r['developed']['year']}" if r.get('developed') else 'approved' if r['kind'] == 'developing' else '') if mature(r) else ''
        note = note or (f'{r["units"]} lots' if r['strata'] and r['units'] > STRATA_MAX else '')
    if (r.get('override') or {}).get('note'):
        note = str(r['override']['note'])
    if note and not any(math.hypot(x - nx, y - ny) < 70 * U for nx, ny in noted):  # two marks a few millimetres apart share one note
        noted.append((x, y))
        svg.append(f'<text x="{f(x)}" y="{f(y + s * 0.3 + 16 * U)}" font-size="{w(15)}" font-weight="700" text-anchor="middle" fill="{GREEN if kind == "potential" else DOT if mature(r) else CROSS}" stroke="#fff" stroke-width="{w(3)}" paint-order="stroke">{note}</text>')


# ---- the streets, named along their centrelines -----------------------------------------------------------------
def seg_len(pth):
    return sum(math.hypot(pth[i + 1][0] - pth[i][0], pth[i + 1][1] - pth[i][1]) for i in range(len(pth) - 1)) / K


def title(s):
    s = s.title().replace("'S", "'s")
    return re.sub(r'\b(St|Pl|Ln|Rd|Ave|Pde)$', lambda m: {'St': 'Street', 'Pl': 'Place', 'Ln': 'Lane', 'Rd': 'Road', 'Ave': 'Avenue', 'Pde': 'Parade'}[m.group(1)], s)


labels = {}
for rd in a['roads']:
    if not rd['name']:
        continue
    for pth in rd['paths']:
        inside = [p for p in pth if in_window(p)]
        if len(inside) >= 2:
            labels.setdefault(rd['name'], []).append(inside)
placed = []
for name, paths in labels.items():
    paths.sort(key=seg_len, reverse=True)
    lane = bool(re.search(r'\b(LANE|LN|PL|PLACE)\b', name))
    for pth in paths[:2 if seg_len(paths[0]) > 250 and not lane else 1]:
        if seg_len(pth) < (40 if lane else 60):
            continue
        total, acc, mid, ang = seg_len(pth) * K, 0, pth[len(pth) // 2], 0
        for i in range(len(pth) - 1):
            L = math.hypot(pth[i + 1][0] - pth[i][0], pth[i + 1][1] - pth[i][1])
            if acc + L >= total / 2:
                t = (total / 2 - acc) / L
                mid = (pth[i][0] + (pth[i + 1][0] - pth[i][0]) * t, pth[i][1] + (pth[i + 1][1] - pth[i][1]) * t)
                ang = -math.degrees(math.atan2(pth[i + 1][1] - pth[i][1], pth[i + 1][0] - pth[i][0]))
                break
            acc += L
        ang = ang - 180 if ang > 90 else ang + 180 if ang < -90 else ang
        x, y = px(mid)
        if any(math.hypot(x - qx, y - qy) < 200 * U for qx, qy in placed):
            continue
        placed.append((x, y))
        size = (17 if lane else 22) * U
        svg.append(f'<text transform="translate({f(x)},{f(y + size * 0.35)}) rotate({f(ang)})" font-size="{f(size)}" font-weight="600" letter-spacing="{f(1.5 * U)}" text-anchor="middle" fill="{GREY}" stroke="#fff" stroke-width="{w(4)}" paint-order="stroke" stroke-linejoin="round">{H.escape(title(name).upper())}</text>')
svg.append('</g></svg>')

# ---- the legend panel ---------------------------------------------------------------------------------------------
vis, seen = [], []
for r in props.values():
    if not r['geom'] or not in_window(r['centroid']) or r.get('isSite'):
        continue
    if any(math.hypot(r['centroid'][0] - c[0], r['centroid'][1] - c[1]) < 0.5 * K for c in seen):  # one parcel, counted once
        continue
    seen.append(r['centroid'])
    vis.append(r)
counts = {k: sum(1 for r in vis if symbol(r) == k) for k in ('potential', 'none')}
counts['mature'] = sum(1 for r in vis if mature(r))
overridden = sum(1 for r in vis if r.get('override'))
c = a.get('controls') or {}
fmt = lambda n: f'{n:,}'
caption = meta.get('caption') or ' '.join(x.capitalize() for x in site['base'].lower().split())
lot_desc = meta.get('lotDescription') or ', '.join(site.get('lots', []))


def swatch(inner):
    return f'<svg width="78" height="32" viewBox="0 0 78 32">{inner}</svg>'


legend = [
    (swatch(f'<rect x="4" y="4" width="70" height="24" fill="none" stroke="{ORANGE}" stroke-width="6"/>'), 'Heritage Building'),
    (swatch(f'<rect x="3" y="3" width="72" height="26" fill="{STRATA}" fill-opacity="0.6" stroke="#bbb" stroke-width="2"/>'), 'Strata Ownership'),
    (swatch(f'<rect x="3" y="3" width="72" height="26" fill="#d9d9d9" stroke="{WHITE}" stroke-width="4"/>'), 'Single Ownership'),
    (swatch(f'<rect x="4" y="4" width="70" height="24" fill="{DOT}" fill-opacity="0.42" stroke="{DOT}" stroke-width="2"/>'), f'Mature development [unlikely to develop]<br><span class="fine">a site significantly developed in the past {RECENT_YEARS} years, or one with a current approval or construction; crossed as well</span>'),
    (swatch(tick(39, 16, 30, 4.5).replace(f'{4.5 + 4 * U:.1f}', '8')), 'Development Potential'),
    (swatch(cross(39, 16, 30, 4.5).replace(f'{4.5 + 4 * U:.1f}', '8')), f'Low Development Potential<br><span class="fine">strata ownership (the lot count printed on schemes of more than {STRATA_MAX}), a heritage item, public land, or a mature development</span>'),
    (swatch(f'<rect x="4" y="4" width="70" height="24" fill="none" stroke="{RED}" stroke-width="8"/>'), f'Site<br><span class="fine">{H.escape(caption)}, {fmt(site["areaM2"])} m², {H.escape(lot_desc)}</span>'),
]
img = a.get('imagery') or {}


def day(iso):
    try:
        y, m, d = (int(x) for x in str(iso)[:10].split('-'))
        return f"{d} {('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December')[m - 1]} {y}"
    except (ValueError, IndexError):
        return str(iso)


extract = max((d['extracted'] for d in a['devmon'] if d.get('extracted')), default=None)
sources = (f"Aerial: NSW Imagery via SIX Maps{(' (' + ' '.join(x.capitalize() for x in img['block'].lower().split()) + ' block' + (', ' + day(img['date']) if img.get('date') else '') + ')') if img.get('block') else ''}. "
           "Lots, ownership and strata lot counts from the NSW cadastre and property register (plan type, unit addresses, plan registration dates), not title searches. "
           f"Heritage items from the {c.get('epiName', 'LEP')} layer. Development from the council's development monitoring register"
           + (f" (extract of {day(extract)})" if extract else '') + f" and the NSW Planning Portal. Significantly developed since {SINCE}: a strata scheme of {SMALL_SCHEME} or more lots registered, "
           "or a new building (or an addition or conversion of four storeys, five dwellings or 1,000 m²) completed. "
           f"Areas from the digital cadastre. In the window: {counts['potential']} lots with development potential, {counts['none']} with low potential, {counts['mature']} of them mature development"
           + (f" ({overridden} marked from the author's reading of the aerial)" if overridden else '') + f". Retrieved {day(a.get('fetchedAt') or '')}.")
notes = open(NOTES).read() if NOTES else ''
north = f'<svg width="150" height="190" viewBox="0 0 150 190"><text x="75" y="30" font-size="34" font-weight="700" text-anchor="middle" fill="{INK}" font-family="Inter, Helvetica, Arial, sans-serif">N</text><circle cx="75" cy="115" r="60" fill="none" stroke="{INK}" stroke-width="5"/><path d="M75,62 L89,124 L75,112 L61,124 Z" fill="{INK}"/><rect x="71" y="112" width="8" height="54" fill="{INK}"/></svg>'
page = f'''<!doctype html><html><head><meta charset="utf-8"><title>{H.escape(caption)}: context plan</title>
<style>
@page {{ size: {PAGE_W}px {PAGE_H}px; margin: 0 }}
html, body {{ margin: 0; background: #fff; }}
body {{ width: {PAGE_W}px; height: {PAGE_H}px; font-family: Inter, Helvetica, Arial, sans-serif; color: #111; position: relative; overflow: hidden; }}
.map {{ position: absolute; left: {PANEL_W}px; top: 0; width: {MAP_W}px; height: {MAP_H}px; }}
.map svg {{ display: block; }}
.panel {{ position: absolute; left: 0; top: 0; width: {PANEL_W}px; height: {PAGE_H}px; background: #fff; }}
.legend {{ position: absolute; left: 70px; top: 1900px; width: {PANEL_W - 140}px; }}
.legend h3 {{ margin: 0 0 26px; font-size: 40px; font-weight: 500; letter-spacing: 1px; }}
.item {{ display: flex; align-items: flex-start; gap: 26px; margin: 0 0 30px; font-size: 32px; line-height: 1.2; }}
.item svg {{ flex: none; margin-top: 2px; }}
.fine {{ font-size: 22px; color: #555; }}
.notes {{ position: absolute; left: 70px; top: 120px; width: {PANEL_W - 140}px; font-size: 26px; line-height: 1.35; }}
.notes p {{ margin: 0 0 18px; }}
.sources {{ position: absolute; left: 70px; right: 70px; bottom: 330px; font-size: 17px; line-height: 1.3; color: #777; }}
.foot {{ position: absolute; left: 70px; bottom: 70px; display: flex; align-items: flex-end; gap: 40px; }}
.foot .t {{ text-align: right; font-size: 38px; font-weight: 700; letter-spacing: 1px; line-height: 1.25; padding-bottom: 14px; }}
</style></head><body>
<div class="panel">
  <div class="notes">{notes}</div>
  <div class="legend"><h3>LEGEND</h3>{''.join(f'<div class="item">{s}<div>{t}</div></div>' for s, t in legend)}</div>
  <div class="sources">{H.escape(sources)}</div>
  <div class="foot"><div class="t">CONTEXTS PLAN<br>SCALE 1:{SCALE} @ A3</div>{north}</div>
</div>
<div class="map">{''.join(svg)}</div>
</body></html>'''
open(f'{OUT}/diagram.html', 'w').write(page)
json.dump({'width': PAGE_W, 'height': PAGE_H}, open(f'{OUT}/page.json', 'w'))
print(f"{len(vis)} properties in the window: {counts}; sheet {PAGE_W} x {PAGE_H} px, map {WIN_W:.0f} x {WIN_H:.0f} m at 1:{SCALE}")

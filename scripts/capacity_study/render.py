"""Draw the capacity and opportunity site study from analysis.json: the aerial under the cadastre, every property
coloured by ownership, a cross or a tick on each, the site, the streets named, then the legend and the narrative.

    python3 -I scripts/capacity_study/render.py out/capacity/<slug> [notes.html]

Writes diagram.html and page.json (its pixel size) beside analysis.json; scripts/capacity_study.ts prints them.
A notes.html replaces the generated narrative with the author's own paragraphs.
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

# ---- the map window: 350 x 290 ground metres, the site a little below centre ---------------------------
WIN_W, WIN_H = 350, 290
cx, cy = site['centroid'][0], site['centroid'][1] + 22 * K
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
MAP_W = 2240
MAP_H = round(MAP_W * VH / VW)


def f(v):
    return f'{v:.1f}'


def path(rings):
    return ' '.join('M' + ' L'.join(f'{f(x)},{f(y)}' for x, y in (px(p) for p in r)) + ' Z' for r in rings)


def in_window(p):
    return wx0 <= p[0] <= wx1 and wy0 <= p[1] <= wy1


def visible(r):
    return any(in_window(p) for ring in r['geom'] for p in ring) or in_window(r['centroid'])


# ---- the reference's palette --------------------------------------------------------------------------
PURPLE, ORANGE, BLUE, PINK, PINK_LINE = '#9b5fd6', '#d58a1f', '#1b3fd3', '#f4a8b4', '#e0344b'
DEV, DEV_LINE, HER, GREEN, RED, INK, GREY = '#bfd9f3', '#2f6fd1', '#9c1f1f', '#2fb84a', '#e3261e', '#111', '#6a6a6a'
STRATA_MAX, RECENT_YEAR = a.get('strataMax', 30), a.get('recentYear', 2018)

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(VX)} {f(VY)} {f(VW)} {f(VH)}" width="{MAP_W}" height="{MAP_H}" font-family="Inter, Helvetica, Arial, sans-serif">']
svg.append(f'''<defs>
<pattern id="strata" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><rect width="9" height="9" fill="#f6dcb0" fill-opacity="0.55"/><line x1="0" y1="0" x2="0" y2="9" stroke="{ORANGE}" stroke-width="2.2"/></pattern>
<clipPath id="win"><rect x="{f(VX)}" y="{f(VY)}" width="{f(VW)}" height="{f(VH)}"/></clipPath>
</defs>''')
svg.append('<g clip-path="url(#win)">')
# the aerial, lightened and a little greyed so the colour of the overlays leads
for t in a['aerial']['tiles']:
    svg.append(f'<image href="data/{t["file"]}" x="{f(t["left"] * AW)}" y="{f(t["top"] * AH)}" width="{f(t["width"] * AW)}" height="{f(t["height"] * AH)}" preserveAspectRatio="none" style="filter:saturate(0.55) brightness(1.08)"/>')
svg.append(f'<rect x="0" y="0" width="{AW}" height="{AH}" fill="#fff" fill-opacity="0.32"/>')
# the cadastre: every lot
for l in a['lots']:
    svg.append(f'<path d="{path(l["rings"])}" fill="none" stroke="#fff" stroke-width="1.6" stroke-opacity="0.9"/>')
# the council's parks, where the register maps them
for p in a['parks']:
    svg.append(f'<path d="{path(p["rings"])}" fill="{PURPLE}" fill-opacity="0.18" stroke="{PURPLE}" stroke-width="4"/>')
# ownership: strata under single, so a hatch never hides a blue line
order = {'strata': 0, 'council': 1, 'state': 1, 'single': 2, 'developing': 3, 'site': 4}
for pid, r in sorted(props.items(), key=lambda kv: order.get(kv[1]['kind'], 0)):
    if not r['geom'] or not visible(r):
        continue
    d, k = path(r['geom']), r['kind']
    if k == 'strata':
        svg.append(f'<path d="{d}" fill="url(#strata)" stroke="{ORANGE}" stroke-width="2.6" stroke-linejoin="round"/>')
    elif k == 'single':
        svg.append(f'<path d="{d}" fill="none" stroke="{BLUE}" stroke-width="3" stroke-linejoin="round"/>')
    elif k == 'council':
        svg.append(f'<path d="{d}" fill="{PURPLE}" fill-opacity="0.12" stroke="{PURPLE}" stroke-width="4.5" stroke-linejoin="round"/>')
    elif k == 'state':
        svg.append(f'<path d="{d}" fill="{PURPLE}" fill-opacity="0.10" stroke="{PURPLE}" stroke-width="4.5" stroke-dasharray="14 8" stroke-linejoin="round"/>')
    elif k == 'developing':
        svg.append(f'<path d="{d}" fill="{DEV}" fill-opacity="0.85" stroke="{DEV_LINE}" stroke-width="3.5" stroke-linejoin="round"/>')
    elif k == 'site':
        svg.append(f'<path d="{d}" fill="{PINK}" fill-opacity="0.85" stroke="{PINK_LINE}" stroke-width="4" stroke-dasharray="16 9" stroke-linejoin="round"/>')
# heritage items: a thin maroon line inside the ownership line
for h in a['heritageItems']:
    svg.append(f'<path d="{path(h["rings"])}" fill="none" stroke="{HER}" stroke-width="2.2" stroke-opacity="0.95"/>')
svg.append(f'<path d="{path(site["geom"])}" fill="none" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>')


# ---- the marks: a tick or a cross on every property, sized to it --------------------------------------
def tick(x, y, s, w):
    d = f'M{f(x - s * 0.42)},{f(y + s * 0.02)} L{f(x - s * 0.10)},{f(y + s * 0.34)} L{f(x + s * 0.46)},{f(y - s * 0.36)}'
    return (f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{w + 4}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"/>'
            f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')


def cross(x, y, s, w):
    h = s * 0.36
    d = f'M{f(x - h)},{f(y - h)} L{f(x + h)},{f(y + h)} M{f(x + h)},{f(y - h)} L{f(x - h)},{f(y + h)}'
    return (f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{w + 4}" stroke-linecap="round" stroke-opacity="0.9"/>'
            f'<path d="{d}" fill="none" stroke="{RED}" stroke-width="{w}" stroke-linecap="round"/>')


def ring_mark(x, y, s):
    return f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(s * 0.3)}" fill="none" stroke="{DEV_LINE}" stroke-width="{f(s * 0.16)}"/>'


for pid, r in props.items():
    if not r['geom'] or not in_window(r['centroid']) or (r['areaM2'] or 0) < 40:  # lane stubs and slivers carry no mark
        continue
    x, y = px(r['centroid'])
    s = max(28, min(92, 1.75 * math.sqrt(r['areaM2'] or 1)))
    w = max(5, s * 0.15)
    if r['mark'] == 'tick':
        svg.append(tick(x, y, s, w))
    elif r['mark'] == 'x':
        svg.append(cross(x, y, s, w))
        if r['strata'] and r['units'] > STRATA_MAX:
            svg.append(f'<text x="{f(x)}" y="{f(y + s * 0.42 + 15)}" font-size="15" font-weight="700" text-anchor="middle" fill="{RED}" stroke="#fff" stroke-width="3" paint-order="stroke">{r["units"]} lots</text>')
    elif r['kind'] == 'developing':
        svg.append(ring_mark(x, y, s))
x, y = px(site['centroid'])
svg.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="24" fill="{INK}" stroke="#fff" stroke-width="3"/><text x="{f(x)}" y="{f(y + 10)}" font-size="30" font-weight="800" text-anchor="middle" fill="#fff">C</text>')


# ---- the streets, named along their centrelines ----------------------------------------------------------
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
    for pth in paths[:2 if seg_len(paths[0]) > 180 and not lane else 1]:
        if seg_len(pth) < (28 if lane else 45):
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
        if any(math.hypot(x - qx, y - qy) < 150 for qx, qy in placed):
            continue
        placed.append((x, y))
        size = 19 if lane else 24
        svg.append(f'<text transform="translate({f(x)},{f(y + size * 0.35)}) rotate({f(ang)})" font-size="{size}" font-weight="600" letter-spacing="1.5" text-anchor="middle" fill="{GREY}" stroke="#fff" stroke-width="5" paint-order="stroke" stroke-linejoin="round">{H.escape(title(name).upper())}</text>')
svg.append('</g>')
# frame, north arrow, scale bar
svg.append(f'<rect x="{f(VX)}" y="{f(VY)}" width="{f(VW)}" height="{f(VH)}" fill="none" stroke="{INK}" stroke-width="2"/>')
svg.append(f'<g transform="translate({f(VX1 - 70)},{f(VY + 90)})"><circle r="40" fill="#fff" stroke="{INK}" stroke-width="2"/><path d="M0,-30 L12,14 L0,6 L-12,14 Z" fill="{INK}"/><text y="-44" font-size="20" font-weight="700" text-anchor="middle" fill="{INK}">N</text></g>')
bx, by = VX1 - 100 * PPM - 60, VY1 - 44
svg.append(f'<rect x="{f(bx - 20)}" y="{f(by - 32)}" width="{f(100 * PPM + 70)}" height="56" fill="#fff"/>')
svg.append(f'<rect x="{f(bx)}" y="{f(by)}" width="{f(50 * PPM)}" height="8" fill="{INK}"/><rect x="{f(bx + 50 * PPM)}" y="{f(by)}" width="{f(50 * PPM)}" height="8" fill="none" stroke="{INK}" stroke-width="1.5"/>')
for m in (0, 50, 100):
    svg.append(f'<text x="{f(bx + m * PPM)}" y="{f(by - 8)}" font-size="17" font-weight="600" text-anchor="middle" fill="{INK}">{m}{" m" if m == 100 else ""}</text>')
svg.append('</svg>')

# ---- the narrative, from what the window holds -------------------------------------------------------------
vis = [r for r in props.values() if r['geom'] and in_window(r['centroid'])]
ticks = [r for r in vis if r['mark'] == 'tick']
crosses = [r for r in vis if r['mark'] == 'x']
her = [r for r in crosses if 'heritage item' in r['why']]
big = [r for r in vis if r['strata'] and r['units'] > STRATA_MAX]
recent = [r for r in vis if r['recent'] and r['mark'] == 'x']
dev = [r for r in vis if r['kind'] == 'developing']
c = a.get('controls') or {}
fmt = lambda n: f'{n:,}'
STREET_TYPE = re.compile(r'\b(STREET|ROAD|LANE|PLACE|AVENUE|PARADE|HIGHWAY|DRIVE|CRESCENT|TERRACE|WAY|CLOSE|SQUARE|ESPLANADE|BOULEVARD)\b')


def tc(s):
    return ' '.join(w.capitalize() for w in s.lower().split())


def street_of(base):
    s = re.sub(r'^[\d\-A-Z/, ]*\d[A-Z]?\s+', '', base)
    m = STREET_TYPE.search(s)
    return tc(s[:m.end()]) if m else None


def streets_of(rs, n=3):
    counts = {}
    for r in rs:
        st = street_of(r['base'])
        if st:
            counts[st] = counts.get(st, 0) + 1
    top = [s for s, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:n] if counts[s] >= 2]
    return (', '.join(top[:-1]) + ' and ' + top[-1]) if len(top) > 1 else (top[0] if top else '')


def plural(n, one, many=None):
    return f'{n} {one if n == 1 else (many or one + "s")}'


def day(iso):
    """2021-01-22 -> 22 January 2021."""
    try:
        y, m, d = (int(x) for x in str(iso)[:10].split('-'))
        return f"{d} {('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December')[m - 1]} {y}"
    except (ValueError, IndexError):
        return str(iso)


LOCALITY = re.compile(r'\s+[A-Z ]+$')
SITE_LOCALITY = (re.search(r'(STREET|ROAD|LANE|PLACE|AVENUE|PARADE|HIGHWAY|DRIVE|CRESCENT|TERRACE|WAY|CLOSE|SQUARE|ESPLANADE|BOULEVARD)\s+(.+)$', site['base']) or [None, None, ''])[2]


def short(base):
    """A neighbour's address without the site's own suburb."""
    return tc(re.sub(rf'\s+{re.escape(SITE_LOCALITY)}$', '', base) if SITE_LOCALITY else base)


def dev_phrase(r):
    name = short(r['base'])
    if r['active']:
        d = r['active'][0]
        lv = int(d['levels'] or 0)
        what = {'New Building': 'new building', 'Addition': 'addition', 'Conversion': 'conversion'}.get(d['type'], d['type'].lower())
        return f"{name} ({d['da']}, a {str(lv) + '-storey ' if lv else ''}{what}, {d['status'].lower()})"
    d = r['liveDa'][0]
    return f"{name} ({d['pan']}, {d['status'].lower()})"


def neighbour_phrase(n):
    name = short(n['base'])
    if n['kind'] == 'strata' or n['strata']:
        return f"{name}, a strata scheme of about {n['units']} lots"
    if n['kind'] in ('council', 'state'):
        return f"{name}, public land"
    return f"{name}, a single title{' and a heritage item' if n['heritageItem'] else ''}"


caption = meta.get('caption') or tc(site['base'])
lot_desc = meta.get('lotDescription') or ', '.join(site.get('lots', []))
zone = f"{c.get('zoneCode', '')} {c.get('zonePurpose', '')}".strip()
controls = ', '.join(x for x in [f"height of buildings {c['maxHeightM']:g} {c.get('heightUnits') or 'm'}" if c.get('maxHeightM') else '', f"floor space ratio {c['fsr']:g}:1" if c.get('fsr') else ''] if x)
nbs = site.get('neighbours', [])
p1 = (f"{caption} is a single title of {fmt(site['areaM2'])} m² ({lot_desc})"
      + (f" in the {zone} zone of the {c['epiName']}" if c.get('epiName') else '') + (f" ({controls})" if controls else '')
      + (f", inside the {site['inHCA']} heritage conservation area" if site.get('inHCA') else '') + '. '
      + ((f"It adjoins one other title, {neighbour_phrase(nbs[0])}. " if len(nbs) == 1 else f"It adjoins {len(nbs)} other titles: " + '; '.join(neighbour_phrase(n) for n in nbs[:4]) + '. ') if nbs else 'No other title adjoins it. ')
      + 'The study considers the site on its own: no amalgamation is proposed.')
p2 = ("A capacity and opportunity site study was undertaken across the surrounding urban blocks to understand how they may realistically evolve over time. "
      "The study read the NSW cadastre and property register for ownership patterns and the size of each strata scheme, the LEP heritage schedule, "
      "the council's development monitoring register and the NSW Planning Portal's live applications, to identify the sites that are likely, or unlikely, "
      "to redevelop in the short to medium term.")
her_streets, tick_streets = streets_of(her), streets_of(ticks)
p3 = (f"Of the {len(vis)} properties in the window, {len(crosses)} are unlikely to change: {plural(len(her), 'is a heritage item', 'are heritage items')}"
      + (f", mostly along {her_streets}" if her_streets else '')
      + f", {plural(len(big), 'is a strata scheme', 'are strata schemes')} of more than {STRATA_MAX} lots"
      + (f" and {plural(len(recent), 'is a building', 'are buildings')} completed since {RECENT_YEAR}" if recent else '') + '. '
      + (('One site carries' if len(dev) == 1 else f'{len(dev)} sites carry') + ' a current approval, construction or live application: ' + '; '.join(dev_phrase(r) for r in dev) + '. ' if dev else 'No site in the window carries a current approval or live application for a new building. ')
      + f"The {len(ticks)} remaining lots, in single ownership or in small strata schemes" + (f", most of them along {tick_streets}" if tick_streets else '')
      + ', are where capacity is most likely to be taken up.')
narrative = open(NOTES).read() if NOTES else ''.join(f'<p>{H.escape(p)}</p>' for p in (p1, p2, p3))

img = a.get('imagery') or {}
imagery = ' via SIX Maps' + (f" ({tc(img['block'])} block" + (f", captured {day(img['date'])}" if img.get('date') else '') + (f", {img['resolutionCm']} cm" if img.get('resolutionCm') else '') + ')' if img.get('block') else '')
extract = max((d['extracted'] for d in a['devmon'] if d.get('extracted')), default=None)
sources = (f"Sources: NSW Spatial Services cadastre and property register (lots, plan labels, unit addresses) and NSW Imagery{imagery}; "
           f"{c.get('epiName', 'LEP')} heritage, zoning, height and FSR layers from the NSW Planning Portal; council development monitoring register"
           + (f" (extract of {day(extract)})" if extract else '') + " and open-data parks and facilities; NSW Planning Portal Online DA API. "
           "Strata lot counts are the unit addresses registered against each scheme. Ownership is read from the cadastre's plan type (strata plan or deposited plan) "
           f"and from public-land layers, not from title searches. Areas are computed from the digital cadastre, not survey. Retrieved {day(a.get('fetchedAt') or '')}.")


def sw(inner):
    return f'<svg width="92" height="44" viewBox="0 0 92 44" font-family="Inter">{inner}</svg>'


leg_left = [
    (sw(f'<rect x="3" y="4" width="86" height="36" fill="none" stroke="{PURPLE}" stroke-width="5"/>'), 'Council ownership<br><span class="fine">council parks and facilities; State government land dashed</span>'),
    (sw(f'<defs><pattern id="lstrata" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><rect width="9" height="9" fill="#f6dcb0" fill-opacity="0.55"/><line x1="0" y1="0" x2="0" y2="9" stroke="{ORANGE}" stroke-width="2.2"/></pattern></defs><rect x="3" y="4" width="86" height="36" fill="url(#lstrata)" stroke="{ORANGE}" stroke-width="3"/>'), 'Strata ownership'),
    (sw(f'<rect x="3" y="4" width="86" height="36" fill="none" stroke="{BLUE}" stroke-width="4"/>'), 'Single ownership'),
    (sw(f'<rect x="3" y="4" width="86" height="36" fill="none" stroke="{HER}" stroke-width="2.5"/>'), f'Heritage item<br><span class="fine">{H.escape(c.get("epiName") or "LEP")}, Schedule 5</span>'),
    (sw(f'<rect x="3" y="4" width="86" height="36" fill="{PINK}" stroke="{PINK_LINE}" stroke-width="4" stroke-dasharray="12 6"/>'), 'Site'),
    (sw(f'<rect x="3" y="4" width="86" height="36" fill="{DEV}" stroke="{DEV_LINE}" stroke-width="3"/><circle cx="46" cy="22" r="9" fill="none" stroke="{DEV_LINE}" stroke-width="5"/>'), 'Site under development<br><span class="fine">DA approved or under construction, or a live application for a new building</span>'),
]
leg_right = [
    (sw(cross(46, 22, 44, 7)), f'Existing mature development: a strata scheme of more than {STRATA_MAX} lots, a heritage item, or a building completed since {RECENT_YEAR}. Unlikely to be redeveloped in the short and medium term'),
    (sw(tick(46, 22, 48, 7)), 'Potential development site / lot'),
]
site_row = f'<div class="row"><div class="badge">C</div><div class="lab">The site<br><span class="fine">{H.escape(caption)}, single title, {H.escape(lot_desc)}</span></div><div class="val">Site area {fmt(site["areaM2"])} sqm</div></div>'
PAGE_H = 110 + MAP_H + 70 + 820 + 180
page = f'''<!doctype html><html><head><meta charset="utf-8"><title>{H.escape(caption)}: capacity and opportunity site study</title>
<style>
@page {{ size: 2480px {PAGE_H}px; margin: 0 }}
html, body {{ margin: 0; background: #fff; }}
body {{ width: 2480px; height: {PAGE_H}px; font-family: Inter, Helvetica, Arial, sans-serif; color: #111; position: relative; overflow: hidden; }}
.title {{ position: absolute; left: 120px; top: 50px; font-size: 26px; font-weight: 600; letter-spacing: 2px; color: #333; }}
.map {{ position: absolute; left: 120px; top: 110px; width: {MAP_W}px; height: {MAP_H}px; }}
.map svg {{ display: block; }}
.below {{ position: absolute; left: 120px; top: {110 + MAP_H + 70}px; width: {MAP_W}px; display: flex; gap: 70px; }}
.legend {{ width: 1090px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 50px; align-content: start; font-size: 24px; line-height: 1.25; }}
.col {{ display: flex; flex-direction: column; gap: 22px; }}
.item {{ display: flex; align-items: flex-start; gap: 18px; }}
.item svg {{ flex: none; margin-top: -2px; }}
.fine {{ font-size: 19px; color: #555; }}
.site h4 {{ margin: 20px 0 10px; font-size: 22px; letter-spacing: 1px; }}
.row {{ display: grid; grid-template-columns: 56px 1fr 230px; align-items: center; gap: 14px; margin: 10px 0; font-size: 22px; }}
.badge {{ width: 46px; height: 46px; border-radius: 50%; background: #111; color: #fff; font-weight: 800; font-size: 26px; display: flex; align-items: center; justify-content: center; }}
.val {{ text-align: right; }}
.text {{ flex: 1; font-size: 25px; line-height: 1.38; }}
.text p {{ margin: 0 0 22px; }}
.caption {{ position: absolute; left: 120px; bottom: 160px; font-size: 30px; font-weight: 600; }}
.sources {{ position: absolute; left: 120px; right: 120px; bottom: 60px; font-size: 16px; line-height: 1.3; color: #666; }}
</style></head><body>
<div class="title">CAPACITY AND OPPORTUNITY SITE STUDY</div>
<div class="map">{''.join(svg)}</div>
<div class="below">
  <div class="legend">
    <div class="col">{''.join(f'<div class="item">{s}<div>{t}</div></div>' for s, t in leg_left)}</div>
    <div class="col">{''.join(f'<div class="item">{s}<div>{t}</div></div>' for s, t in leg_right)}<div class="site"><h4>THE SITE</h4>{site_row}</div></div>
  </div>
  <div class="text">{narrative}</div>
</div>
<div class="caption">{H.escape(caption)}</div>
<div class="sources">{H.escape(sources)}</div>
</body></html>'''
open(f'{OUT}/diagram.html', 'w').write(page)
json.dump({'width': 2480, 'height': PAGE_H}, open(f'{OUT}/page.json', 'w'))
print(f"{len(vis)} properties in the window: {len(ticks)} ticks, {len(crosses)} crosses ({len(her)} heritage, {len(big)} large strata, {len(recent)} recent), {len(dev)} under development; page 2480 x {PAGE_H}")

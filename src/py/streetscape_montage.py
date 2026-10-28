#!/usr/bin/env python3
"""The streetscape's montage: one face of a street from many Street View frames,
each rectified onto the face's plane, the frame for every column of the
picture chosen by what it sees.

    python3 streetscape_montage.py <job.json>

The job (written by src/render/montage.ts) names, for each face, the picture
to write, its scale, the window and the heights it spans, the ground at the
boundary every metre, the boundary's distance from the street's axis along
each frontage, and the frames: where each camera stood (s along the axis, d
off it, z m AHD), how it looked (heading, pitch, field of view), its
picture's size and file, its panorama and the month it was taken.

A frame is a pinhole picture and a frontage is near enough a vertical plane,
so a frame maps onto the plane by one homography, and every frame is laid on
the picture that way over the columns it reaches, each frontage on its own
plane. The cameras must have driven the carriageway: Google also walks some
streets, and a camera a metre or two from a facade, which Google then places
in the road, shows a few metres of wall magnified several times; such a
capture is set aside by its month (`skipDrives`), the sheet's log naming the
drives found. Then every column takes one panorama: the one that saw it
squarest, with the least foliage, nothing missing and nothing that the other
cameras did not see there; of the primary drive where those are equal (the
newest that covers the window), an older drive only to see through foliage,
which is why the bare months are harvested; and the picture changes panorama
only where the two agree, over a short crossfade (a Viterbi pass over the
columns, as in a multi-viewpoint panorama). Neighbouring runs are brought to
one exposure. The sky is found from the top of each column down and made
transparent, so the sheet's own sky shows and the roofline is the picture's;
the footpath below the ground line is kept, and what is below that is cut.
What stands in front of the boundary (a tree, an awning) still reads larger
than life and a building set back from it smaller: `calibrate` tried to find
each camera's true distance from the pictures and is off by default.

Prints one JSON line: {"faces": [{"file", "width", "height", "panoramas",
"dates", "columnsCovered", "foliageShare", "skyShare", "calibrated",
"tops": [{"m", "z"}], "sources": [{"x0", "x1", "panoId", "date", "depth"}]}
| null], "notes": [...]}. Without Pillow or NumPy it says so as {"error":
...} with exit code 2.
"""
import json
import math
import os
import sys

try:
    import numpy as np
    from PIL import Image
except ImportError as e:  # pragma: no cover
    print(json.dumps({"error": f"{getattr(e, 'name', None) or 'a module'} is not installed (pip install pillow numpy)"}))
    sys.exit(2)

Image.MAX_IMAGE_PIXELS = None

# ---- how a column is judged ---------------------------------------------------------------
# A column's cost under a panorama: the rows of it the frame does not reach,
# the foliage over it, how far off square the camera saw it, how far it
# departs from what the other cameras saw there (a building since rebuilt,
# a date when the view was blocked, a camera still out of place), and its
# age: the newest year's drives are the street as it is, and an older drive
# is taken only to see through foliage. A change of panorama between two
# columns costs a constant and the colour difference between the two there,
# so the seams fall where the two agree.
MISSING_W = 3.0
FOLIAGE_W = 3.0
OBLIQUE_DEG = 40.0
CONSIST_W = 6.0
CONSIST_FREE = 0.05
OLD_YEAR_W = 1.2
AGE_W = 0.05
SWITCH_W = 1.5
SEAM_W = 2.0
# A frame that reaches less than this of a column is no candidate for it: better a bare end to the window than a
# frame's slanting edge across it, or a ground floor missing under the storeys.
MIN_COVER = 0.97
# Neighbouring runs are slid up or down to meet, by at most this many metres, where their edges say so clearly.
SHIFT_MAX_M = 0.8
# The crossfade either side of a seam, pixels.
BLEND_PX = 8
# Neighbouring runs from different drives are brought to one exposure, by at most this much either way.
GAIN_MAX = 1.3
# How far below the ground at the boundary the picture keeps the footpath, metres.
BELOW_GROUND_M = 1.2
# The band along the foot of a Street View frame that carries Google's marks, pixels of a 640 frame.
LOGO_PX = 24
# ---- the calibration (off unless the job asks: see `calibrate`) ---------------------------------
# The depths tried, as multiples of the boundary's distance from the camera; 1 is among them.
DEPTHS = np.exp(np.concatenate([np.linspace(math.log(0.22), 0, 16), np.linspace(0, math.log(2.6), 12)[1:]]))
# The calibration's resolution, pixels a metre, and the band of the face it compares: the storeys over the
# footpath, clear of cars and people below and of the sky above.
CAL_PPM = 6
FACADE_LO_M, FACADE_HI_M = 2.5, 20.0
# Neighbours this far along the street take part, two either side.
NEIGHBOUR_M = 26
# The pictures are compared by their edges (exposure changes between drives; the facades' lines do not), the one
# allowed to slide up or down by this many rows against the other (the cameras' ground is a 5 m model's).
SHIFT_ROWS = 6
# A depth is taken only where the agreement there is this good and this much better than at the boundary's.
MIN_PEAK, MIN_GAIN = 0.12, 0.025
SWEEPS = 2
# A camera calibrated to this fraction of the boundary's distance or less, on either face, stood on the footpath
# (Google walks some streets, and places those cameras in the carriageway): too near a facade to show it, so
# left out of both faces. The rest keep a depth within these bounds.
FOOTPATH_DEPTH = 0.45
DEPTH_MIN, DEPTH_MAX = 0.6, 1.8
# The drive the faces are drawn from by preference: the newest whose cameras cover this share of the window
# (a camera covers 10 m either way); the others are taken only to see through foliage.
PRIMARY_COVER = 0.7
PRIMARY_REACH_M = 10.0
# ---- the sky ------------------------------------------------------------------------------
# The sky is what looks like sky and joins the top of the picture through what looks like sky, across a wire, a
# cable or a bare branch no thicker than this (pixels): a window that mirrors the sky is shut in by its frame and
# stays. Sky only ever gets paler toward the horizon, so what is this much darker than the sky at the top of its
# column is not sky (a bluish wall in shadow), unless it is a deep blue that nothing but sky is.
BRIDGE_PX = 3
DARKER_THAN_SKY = 45
# A pale or a blue pixel is sky only where the picture about it is smoother than this (the mean gradient over 9
# pixels); a deep blue is sky whatever its texture.
PALE_TEXTURE = 3.0
BLUE_TEXTURE = 6.0
GREY_TEXTURE = 2.2
# How far the sky found grows out by colour alone, against the trees and wires whose texture it borrowed.
FRINGE_PX = 5
# The first rows of a column (pixels) are judged by colour alone: at the top of a frame the picture is stretched
# and its blocks read as texture, and a seam between frames runs along it as an edge.
SEED_ROWS = 14
# A column's sky is sought from its top only where the top is blue, or pale and quite smooth: a tall building that
# runs off the top of the picture is not a way in.
SEED_TEXTURE = 1.0
# A horizontal edge that runs at least this far (pixels) is a roofline, a parapet or a cornice, and the sky stops
# at it; a branch's or a cloud's edge does not run straight that far.
BARRIER_PX = 30
BARRIER_STEP = 18
# What does not stand on the ground through the picture (a scrap of canopy, a wire across the sky) is taken off.
GROUNDED_ONLY = True


def homography(cam, plane_m, side, axis, px):
    """The 3 x 3 that takes a point of the face's plane (s, z m AHD, 1) to the frame's pixel (u right, v down,
    homogeneous): src/fetch/streetscape.ts's planeToImage, in NumPy."""
    th = math.radians(cam["heading"])
    ph = math.radians(cam["pitch"])
    fwd = np.array([math.sin(th) * math.cos(ph), math.cos(th) * math.cos(ph), math.sin(ph)])
    right = np.array([math.cos(th), -math.sin(th), 0.0])
    up = np.array([-math.sin(th) * math.sin(ph), -math.cos(th) * math.sin(ph), math.cos(ph)])
    left = (-axis[1], axis[0])
    dd = plane_m * side - cam["d"]
    B = np.array([left[0] * dd - axis[0] * cam["s"], left[1] * dd - axis[1] * cam["s"], -cam["z"]])
    E = np.array([axis[0], axis[1], 0.0])
    Z = np.array([0.0, 0.0, 1.0])
    f = px / 2 / math.tan(math.radians(cam["fov"]) / 2)
    R = np.array([[E @ right, Z @ right, B @ right], [E @ up, Z @ up, B @ up], [E @ fwd, Z @ fwd, B @ fwd]])
    c = px / 2
    return np.array([
        [f * R[0, 0] + c * R[2, 0], f * R[0, 1] + c * R[2, 1], f * R[0, 2] + c * R[2, 2]],
        [-f * R[1, 0] + c * R[2, 0], -f * R[1, 1] + c * R[2, 1], -f * R[1, 2] + c * R[2, 2]],
        [R[2, 0], R[2, 1], R[2, 2]],
    ])


def warp(img, H, S, Zr, logo_px):
    """The frame `img` (rows, cols, 3) sampled onto the plane's grid, columns at `S` (s, metres) and rows at `Zr`
    (z, m AHD): the colours (uint8) and where the frame reached (bool): in front of the camera, inside the
    picture and above its logo band."""
    h, w = img.shape[:2]
    s = S[None, :]
    z = Zr[:, None]
    wgt = H[2, 0] * s + H[2, 1] * z + H[2, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        u = (H[0, 0] * s + H[0, 1] * z + H[0, 2]) / wgt
        v = (H[1, 0] * s + H[1, 1] * z + H[1, 2]) / wgt
    ok = (wgt > 1e-9) & np.isfinite(u) & np.isfinite(v)
    ok &= (u >= 0.5) & (u <= w - 1.5) & (v >= 0.5) & (v <= h - 1.5 - logo_px)
    u = np.clip(np.nan_to_num(u, nan=0.0, posinf=0.0, neginf=0.0), 0, w - 1.001)
    v = np.clip(np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0), 0, h - 1.001)
    x0 = u.astype(np.int32)
    y0 = v.astype(np.int32)
    fx = (u - x0)[..., None].astype(np.float32)
    fy = (v - y0)[..., None].astype(np.float32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    im = img.astype(np.float32)
    c = im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy) + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy
    return np.clip(c + 0.5, 0, 255).astype(np.uint8), ok


def greenness(rgb):
    """Where a picture is foliage: green in excess of red and blue (the ExG index) and plainly a green."""
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    return (2 * g - r - b > 20) & (g > r + 6) & (g > b + 6)


def box3(a):
    """A 3 x 3 box blur with the edges held."""
    p = np.pad(a, 1, mode="edge")
    out = np.zeros_like(a)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out += p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
    return out / 9


def box_mean(a, r):
    """The mean of `a` over a (2r + 1) square about each pixel, the edges held, by summed-area tables."""
    p = np.pad(a, r, mode="edge").astype(np.float64)
    c = np.cumsum(np.cumsum(p, axis=0), axis=1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = 2 * r + 1
    H, W = a.shape
    return ((c[n:n + H, n:n + W] - c[:H, n:n + W] - c[n:n + H, :W] + c[:H, :W]) / (n * n)).astype(np.float32)


def skylike(rgb, alpha=None):
    """Where a picture could be sky: blue, or bright and nearly grey (cloud, haze), and as smooth as sky is (a
    wall carries its windows, bricks and shadows), judged on a lightly smoothed copy so the JPEG's grain does not
    break a run of sky; the texture is read among the opaque pixels alone, so a frame's edge, or a canopy's, is
    not texture on the sky beside it. Returns that; where it is blue (which may darken toward the zenith); where
    it is pale (which must not darken on the way down a column: a wall in shadow); the smoothed luminance; where
    a column's sky may start; and where the colour alone is a sky's, texture or no, for the sky's last few
    pixels against a tree."""
    if alpha is None:
        alpha = np.ones(rgb.shape[:2], bool)
    f = rgb.astype(np.float32)
    sm = np.stack([box3(f[..., i]) for i in range(3)], axis=-1)
    r, g, b = sm[..., 0], sm[..., 1], sm[..., 2]
    v = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (v - mn) / (v + 1)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    a = alpha.astype(np.float32)
    gy = np.zeros_like(lum)
    gx = np.zeros_like(lum)
    both_y = alpha[2:] & alpha[:-2]
    both_x = alpha[:, 2:] & alpha[:, :-2]
    gy[1:-1] = np.where(both_y, np.abs(lum[2:] - lum[:-2]), 0)
    gx[:, 1:-1] = np.where(both_x, np.abs(lum[:, 2:] - lum[:, :-2]), 0)
    texture = box_mean((gy + gx) * a, 4) / np.maximum(1e-3, box_mean(a, 4))
    # at Riley Street a clear sky was 40 to 66 bluer (b − r) than it was red, a cream wall in its shade 32, a
    # brick wall far redder; the sky's texture under a unit, a rendered wall's from under one to seven, a brick
    # wall's twenty and more; an overcast sky pale and smooth
    blue_c = (b - r >= 30) & (b >= g) & (sat >= 0.16) & (sat <= 0.75) & (v >= 100)
    blue = blue_c & (texture < BLUE_TEXTURE)
    deep = (b - r >= 55) & (b - g >= 25) & (sat >= 0.3) & (v >= 100)
    # an overcast sky is light, nearly grey and smoother than any wall: a grey-blue it shares with a cream wall in
    # shade (texture from 0.7 at Riley Street), so only the smoothest of it
    pale_c = (v >= 180) & (sat <= 0.12)
    grey_c = (v >= 160) & (sat <= 0.3) & (b >= r - 2)
    pale = (pale_c & (texture < PALE_TEXTURE)) | (grey_c & (texture < GREY_TEXTURE))
    return blue | deep | pale, deep | blue, pale, lum, blue | deep | (pale & (texture < SEED_TEXTURE)), blue_c | deep | pale_c | grey_c


def shift2(m, dy, dx):
    """`m` moved by (dy, dx), what comes in being False."""
    out = np.zeros_like(m)
    H, W = m.shape
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    out[yd, xd] = m[ys, xs]
    return out


def box_dilate(m, r):
    out = m.copy()
    for d in range(1, r + 1):
        out |= shift2(m, d, 0) | shift2(m, -d, 0)
    m2 = out.copy()
    for d in range(1, r + 1):
        out |= shift2(m2, 0, d) | shift2(m2, 0, -d)
    return out


def grounded(alpha, foot_row):
    """What stands on the ground through the picture: the opaque region that reaches the footpath, found by a
    flood up from the foot of each column, at half the resolution for speed. A scrap of canopy over the sky or a
    wire across it does not."""
    H, W = alpha.shape
    rows = np.arange(H)[:, None]
    seed = alpha & (rows >= foot_row[None, :] - 4)
    a2 = alpha[::2, ::2]
    reg = seed[::2, ::2].copy()
    for _ in range(a2.shape[0] * 2):
        grown = (reg | shift2(reg, 1, 0) | shift2(reg, -1, 0) | shift2(reg, 0, 1) | shift2(reg, 0, -1)) & a2
        if np.array_equal(grown, reg):
            break
        reg = grown
    region = np.repeat(np.repeat(reg, 2, axis=0), 2, axis=1)[:H, :W] & alpha
    for _ in range(3):
        region = (region | shift2(region, 1, 0) | shift2(region, -1, 0) | shift2(region, 0, 1) | shift2(region, 0, -1)) & alpha
    return region


def sky_mask(rgb, alpha):
    """The sky of the picture: what looks like sky and is no darker than the sky at the top of its column (a deep
    blue excepted), closed across wires and bare branches, and then only what joins the top of the picture that
    way: a flood from the first rows of each column, so a window mirroring the sky, shut in by its frame, stays."""
    H, W = alpha.shape
    sky, blue, pale, lum, seedlike, loose = skylike(rgb, alpha)
    skyish = sky & alpha
    # each column's sky at its top: the mean luminance of the first few rows that look like sky
    cum_n = np.cumsum(skyish, axis=0)
    first = (cum_n <= 12) & skyish
    n_first = np.maximum(1, first.sum(0))
    ref = (np.where(first, lum, 0).sum(0) / n_first)[None, :]
    ok = (blue | (pale & (lum >= ref - DARKER_THAN_SKY))) & alpha
    edge = np.zeros_like(ok)
    edge[1:] = np.abs(lum[1:] - lum[:-1]) > 28
    top = np.argmax(alpha, axis=0)
    rows = np.arange(H)[:, None]
    top_band = alpha & (rows <= top[None, :] + SEED_ROWS)
    # a horizontal edge that runs on for BARRIER_PX is a roofline or a cornice, and the sky stops at it
    step = np.zeros_like(ok)
    step[1:] = np.abs(lum[1:] - lum[:-1]) > BARRIER_STEP
    half = BARRIER_PX // 2
    c = np.cumsum(np.pad(step, ((0, 0), (half + 1, half))), axis=1, dtype=np.int32)
    run = c[:, 2 * half + 1:] - c[:, :-(2 * half + 1)]
    barrier = run >= int(0.9 * (2 * half + 1))
    barrier[1:] |= barrier[:-1]
    barrier &= ~top_band
    # closed across thin things (a dilation, then an erosion), but never across an edge
    grown = box_dilate(ok, BRIDGE_PX)
    closed = ~box_dilate(~grown, BRIDGE_PX)
    closed = (closed | ok) & ~(edge & ~ok) & ~barrier & alpha
    # the seeds: the first rows of each column, where their colour is a sky's
    seed = loose & top_band
    closed |= seed
    # the flood, at half the resolution for speed
    ok2 = closed[::2, ::2]
    reg = seed[::2, ::2].copy()
    for _ in range(ok2.shape[0] * 2):
        grown = (reg | shift2(reg, 1, 0) | shift2(reg, -1, 0) | shift2(reg, 0, 1) | shift2(reg, 0, -1)) & ok2
        if np.array_equal(grown, reg):
            break
        reg = grown
    region = np.repeat(np.repeat(reg, 2, axis=0), 2, axis=1)[:H, :W]
    # back at full resolution: one more pass of growth so the half-grid's edges are the picture's
    region &= closed
    for _ in range(3):
        region = (region | shift2(region, 1, 0) | shift2(region, -1, 0) | shift2(region, 0, 1) | shift2(region, 0, -1)) & closed
    # the sky's last pixels against a tree or a wire, where its texture is the tree's: by colour alone, a few
    # pixels out from the sky found, never through an edge that runs on
    fringe = loose & alpha & ~barrier
    for _ in range(FRINGE_PX):
        region = (region | shift2(region, 1, 0) | shift2(region, -1, 0) | shift2(region, 0, 1) | shift2(region, 0, -1)) & (fringe | region)
    return region


def months_since(date, newest):
    try:
        y, m = int(date[:4]), int(date[5:7])
        ny, nm = int(newest[:4]), int(newest[5:7])
        return max(0, (ny - y) * 12 + (nm - m))
    except (TypeError, ValueError):
        return 24


def run_shifts(runs, cands, ground_rows, ppm):
    """How far each run is slid up or down so its storeys meet its neighbours': at each seam the shift, within
    SHIFT_MAX_M, at which the two panoramas' edges agree best over the columns both reach and the storeys over
    the footpath, taken where the agreement is clear; chained into an offset for every run and centred on none
    overall (the cameras' ground is a 5 m model's, so neighbours disagree by a few tenths of a metre)."""
    n = len(runs)
    if n < 2:
        return [0] * n
    lim = int(round(SHIFT_MAX_M * ppm))
    steps = []
    for (a, b, k), (a2, b2, k2) in zip(runs, runs[1:]):
        step = 0
        if b == a2:
            p, q = cands[k], cands[k2]
            lo, hi = max(b - 80, p["x0"], q["x0"]), min(b + 80, p["x1"], q["x1"])
            if hi - lo >= 12:
                H = p["rgb"].shape[0]
                rows = np.arange(H)[:, None]
                band = (rows < ground_rows[lo:hi][None, :] - int(2.0 * ppm)) & (rows > ground_rows[lo:hi][None, :] - int(20.0 * ppm))
                def ed(c):
                    l = c["lum"][:, lo - c["x0"]:hi - c["x0"]]
                    m = c["mask"][:, lo - c["x0"]:hi - c["x0"]] & ~c["green"][:, lo - c["x0"]:hi - c["x0"]] & band
                    g = np.zeros_like(l)
                    g[1:-1] = np.abs(l[2:] - l[:-2])
                    return np.where(m, g, np.nan)
                A, B = ed(p), ed(q)
                best, at0 = None, None
                for sh in range(-lim, lim + 1):
                    Bs = np.roll(B, sh, axis=0)
                    both = ~np.isnan(A) & ~np.isnan(Bs)
                    if both.sum() < 400:
                        continue
                    av, bv = A[both], Bs[both]
                    av, bv = av - av.mean(), bv - bv.mean()
                    den = math.sqrt(float((av * av).sum()) * float((bv * bv).sum()))
                    v = float((av * bv).sum()) / den if den > 1e-6 else 0.0
                    if sh == 0:
                        at0 = v
                    if best is None or v > best[1]:
                        best = (sh, v)
                if best and at0 is not None and best[1] >= 0.2 and best[1] - at0 >= 0.03:
                    step = best[0]
        steps.append(step)
    # q slid by `step` rows meets p: q's offset is p's less step
    offs = [0]
    for st in steps:
        offs.append(offs[-1] - st)
    centre = int(round(float(np.median(offs))))
    return [int(np.clip(o - centre, -lim, lim)) for o in offs]


def run_gains(runs, cands, foot_row):
    """One exposure along the face: at each seam the two panoramas' mean brightness over the columns both reach
    (a few metres either side), chained into a gain for every run, the chain centred on no change overall and
    each gain held within GAIN_MAX. Different drives were lit differently; the facades did not change."""
    if len(runs) < 2:
        return [1.0] * len(runs)
    ratios = []
    for (a, b, k), (a2, b2, k2) in zip(runs, runs[1:]):
        if b != a2:
            ratios.append(1.0)
            continue
        p, q = cands[k], cands[k2]
        lo, hi = max(b - 60, p["x0"], q["x0"]), min(b + 60, p["x1"], q["x1"])
        if hi - lo < 8:
            ratios.append(1.0)
            continue
        rows = np.arange(p["rgb"].shape[0])[:, None]
        under = rows < foot_row[lo:hi][None, :]
        both = p["mask"][:, lo - p["x0"]:hi - p["x0"]] & q["mask"][:, lo - q["x0"]:hi - q["x0"]] & under
        if both.sum() < 200:
            ratios.append(1.0)
            continue
        lp = p["rgb"][:, lo - p["x0"]:hi - p["x0"]].astype(np.float32).mean(-1)[both].mean()
        lq = q["rgb"][:, lo - q["x0"]:hi - q["x0"]].astype(np.float32).mean(-1)[both].mean()
        ratios.append(float(lp / lq) if lq > 1 and lp > 1 else 1.0)
    logs = [0.0]
    for r in ratios:
        logs.append(logs[-1] + math.log(min(GAIN_MAX, max(1 / GAIN_MAX, r))))
    centre = sum(logs) / len(logs)
    return [float(np.clip(math.exp(g - centre), 1 / GAIN_MAX, GAIN_MAX)) for g in logs]


class FaceGrid:
    """The picture's grid at some resolution: a column's s, a row's z, the ground and the boundary's plane under
    every column, and the runs of one plane."""

    def __init__(self, face, ppm):
        self.ppm = ppm
        s_left, s_right = float(face["sAtLeft"]), float(face["sAtRight"])
        self.z_top, self.z_bot = float(face["zTop"]), float(face["zBot"])
        self.W = max(1, int(round(abs(s_right - s_left) * ppm)))
        self.H = max(1, int(round((self.z_top - self.z_bot) * ppm)))
        self.direction = 1.0 if s_right >= s_left else -1.0
        self.s_left = s_left
        self.S = s_left + self.direction * (np.arange(self.W) + 0.5) / ppm
        self.Zr = self.z_top - (np.arange(self.H) + 0.5) / ppm
        g = sorted(face.get("ground", []), key=lambda p: p["s"])
        if g:
            self.ground = np.interp(self.S, np.array([p["s"] for p in g], float), np.array([p["z"] for p in g], float))
        else:
            self.ground = np.full(self.W, self.z_bot + BELOW_GROUND_M)
        self.plane = np.full(self.W, float(face["offsetM"]))
        for p in face.get("planes", []):
            sel = (self.S >= min(p["s0"], p["s1"])) & (self.S <= max(p["s0"], p["s1"]))
            self.plane[sel] = float(p["offsetM"])
        self.segments = []
        start = 0
        for x in range(1, self.W + 1):
            if x == self.W or self.plane[x] != self.plane[start]:
                self.segments.append((start, x, float(self.plane[start])))
                start = x

    def x_of(self, s):
        return int(math.floor((s - self.s_left) * self.direction * self.ppm))

    def lay(self, pano, depth, side, axis):
        """The panorama's frames on this grid, its tiers filling in turn, the plane under each column moved to
        `depth` times its distance from the camera. Returns the colours, where they reached, and the columns."""
        cam0 = pano["cam"]
        dist = max(1.0, depth * (self.plane[min(self.W - 1, max(0, self.x_of(cam0["s"])))] - cam0["d"] * side))
        fov = max(f["fov"] for f in pano["frames"])
        reach = min(90.0, dist * math.tan(math.radians(min(fov / 2 + 8, 82))) * 1.3 + 1)
        xa, xb = sorted((self.x_of(cam0["s"] - reach), self.x_of(cam0["s"] + reach)))
        xa, xb = max(0, xa - 1), min(self.W, xb + 2)
        if xb - xa < 2:
            return None
        rgb = np.zeros((self.H, xb - xa, 3), np.uint8)
        mask = np.zeros((self.H, xb - xa), bool)
        for f in pano["frames"]:
            img = f["img"]
            px = f.get("px", img.shape[1])
            logo = int(round(LOGO_PX * img.shape[0] / 640)) if f.get("logo", True) else 0
            cam = {"s": f["s"], "d": f["d"], "z": f["z"], "heading": f["heading"], "pitch": f["pitch"], "fov": f["fov"]}
            for (a, b, off) in self.segments:
                a2, b2 = max(a, xa), min(b, xb)
                if b2 <= a2:
                    continue
                plane_m = cam["d"] * side + depth * (off - cam["d"] * side)
                H = homography(cam, plane_m, side, axis, px)
                c, ok = warp(img, H, self.S[a2:b2], self.Zr, logo)
                take = ok & ~mask[:, a2 - xa:b2 - xa]
                rgb[:, a2 - xa:b2 - xa][take] = c[take]
                mask[:, a2 - xa:b2 - xa] |= ok
        cols = np.flatnonzero(mask.any(axis=0))
        if cols.size < 2:
            return None
        c0, c1 = int(cols[0]), int(cols[-1]) + 1
        return np.ascontiguousarray(rgb[:, c0:c1]), np.ascontiguousarray(mask[:, c0:c1]), xa + c0, xa + c1


def edges(lum):
    """The strength of a picture's edges: the gradient's magnitude of its luminance, NaN where it had none."""
    gy = np.full_like(lum, np.nan)
    gx = np.full_like(lum, np.nan)
    gy[1:-1] = lum[2:] - lum[:-2]
    gx[:, 1:-1] = lum[:, 2:] - lum[:, :-2]
    return np.sqrt(gy * gy + gx * gx)


def calibrate(face, panos, side, axis, log):
    """Each panorama's depth: of DEPTHS, the multiple of the boundary's distance at which its picture, laid on the
    plane, agrees best with its neighbours' of the same drive (the nearest two either side within NEIGHBOUR_M,
    or of any drive where it has none). Agreement is the correlation of the two pictures' edges over the storeys
    of the face both reach, clear of foliage, the one slid up or down a few rows against the other (the ground
    under the cameras is a 5 m model's), so a change of exposure between drives counts for nothing and a facade
    in the wrong place for everything. A camera keeps the boundary's distance where no depth agrees clearly
    (MIN_PEAK) and clearly better (MIN_GAIN). Two sweeps, the neighbours' depths moving too.

    Off unless the job says `calibrate`: on the made-up street of the test it keeps the true depth, but at Riley
    Street, Darlinghurst, in October 2026 it moved many of a car drive's cameras to a quarter of their distance
    and left most of a footpath walk's where they were, the agreement between real frames (trees, cars, people,
    a different light on each drive) being too weak to trust. A footpath capture is set aside by its month
    instead (`skipDrives` in src/render/montage.ts)."""
    grid = FaceGrid(face, CAL_PPM)
    facade = (grid.Zr[:, None] >= (grid.ground + FACADE_LO_M)[None, :]) & (grid.Zr[:, None] <= (grid.ground + FACADE_HI_M)[None, :])
    n = len(panos)
    order = sorted(range(n), key=lambda i: panos[i]["cam"]["s"])
    depth = [1.0] * n
    peak = [0.0] * n

    def lo(i, dep):
        laid = grid.lay(panos[i], dep, side, axis)
        if laid is None:
            return None
        rgb, mask, x0, x1 = laid
        full = np.full((grid.H, grid.W), np.nan, np.float32)
        full[:, x0:x1] = np.where(mask & ~greenness(rgb), rgb.astype(np.float32).mean(-1), np.nan)
        e = edges(full)
        e[~facade] = np.nan
        return e

    cache = {i: lo(i, 1.0) for i in range(n)}

    def neighbours(i):
        s0, date = panos[i]["cam"]["s"], panos[i]["date"]
        same = [j for j in order if j != i and panos[j]["date"] == date and abs(panos[j]["cam"]["s"] - s0) <= NEIGHBOUR_M]
        pool = same if same else [j for j in order if j != i and abs(panos[j]["cam"]["s"] - s0) <= NEIGHBOUR_M]
        before = sorted([j for j in pool if panos[j]["cam"]["s"] < s0], key=lambda j: s0 - panos[j]["cam"]["s"])[:2]
        after = sorted([j for j in pool if panos[j]["cam"]["s"] >= s0], key=lambda j: panos[j]["cam"]["s"] - s0)[:2]
        return before + after

    def ncc(a, b):
        both = ~np.isnan(a) & ~np.isnan(b)
        m = int(both.sum())
        if m < 300:
            return None, 0
        av, bv = a[both], b[both]
        av = av - av.mean()
        bv = bv - bv.mean()
        den = math.sqrt(float((av * av).sum()) * float((bv * bv).sum()))
        return (float((av * bv).sum()) / den if den > 1e-6 else None), m

    def agreement(a, js):
        tot, wsum = 0.0, 0
        for j in js:
            b = cache[j]
            if b is None:
                continue
            best, m_best = None, 0
            for sh in range(-SHIFT_ROWS, SHIFT_ROWS + 1):
                bs = b if sh == 0 else np.roll(b, sh, axis=0)
                v, m = ncc(a, bs)
                if v is not None and (best is None or v > best):
                    best, m_best = v, m
            if best is not None:
                tot += best * m_best
                wsum += m_best
        return (tot / wsum) if wsum else 0.0

    one = int(np.argmin(np.abs(DEPTHS - 1.0)))
    for _sweep in range(SWEEPS):
        for i in order:
            js = neighbours(i)
            if not js or cache[i] is None:
                continue
            laid = {}
            scores = np.full(len(DEPTHS), -1.0)
            for k, dep in enumerate(DEPTHS):
                dep = float(dep)
                a = cache[i] if dep == depth[i] else lo(i, dep)
                laid[dep] = a
                if a is not None:
                    scores[k] = agreement(a, js)
            k = int(np.argmax(scores))
            best = float(DEPTHS[k])
            if scores[k] >= MIN_PEAK and (k == one or scores[k] - scores[one] >= MIN_GAIN):
                depth[i], peak[i] = best, float(scores[k])
            else:
                depth[i], peak[i] = 1.0, float(scores[one])
            cache[i] = laid[depth[i]]
    moved = sum(1 for d in depth if d != 1.0)
    if n:
        log(f"side {side}: {moved} of {n} cameras calibrated off the boundary's distance; depths {np.percentile(depth, 10):.2f}–{np.percentile(depth, 90):.2f} (10th–90th), agreement {np.median(peak):.2f}")
    return depth, peak


def prepare_face(face, axis, out_dir, log):
    """The face's panoramas, each its frames read once, and each calibrated for depth."""
    side = int(face["side"])
    frames = face.get("frames", [])
    if not frames:
        return None
    by_pano = {}
    for f in frames:
        try:
            f = dict(f, img=np.asarray(Image.open(os.path.join(out_dir, f["file"])).convert("RGB")))
        except (OSError, ValueError) as e:
            log(f"frame {f['file']} unreadable: {e}")
            continue
        by_pano.setdefault(f["panoId"], []).append(f)
    panos = []
    for pano, fs in by_pano.items():
        fs.sort(key=lambda f: f.get("tier", 0))
        panos.append({"pano": pano, "date": fs[0].get("date"), "cam": fs[0], "frames": fs})
    if not panos:
        return None
    depths, peaks = calibrate(face, panos, side, axis, log) if face.get("calibrate", False) else ([1.0] * len(panos), [0.0] * len(panos))
    return {"face": face, "side": side, "panos": panos, "depths": depths, "peaks": peaks}


def primary_drive(panos, s0, s1):
    """The drive the face is drawn from by preference: the newest whose cameras cover PRIMARY_COVER of the window,
    else the one that covers most of it."""
    span = max(1.0, s1 - s0)
    cover = {}
    for date in {p["date"] for p in panos if p["date"]}:
        xs = sorted(p["cam"]["s"] for p in panos if p["date"] == date)
        covered, at = 0.0, s0
        for x in xs:
            a, b = max(at, x - PRIMARY_REACH_M), min(s1, x + PRIMARY_REACH_M)
            if b > a:
                covered += b - a
                at = b
        cover[date] = covered / span
    good = sorted((d for d, c in cover.items() if c >= PRIMARY_COVER), reverse=True)
    return good[0] if good else max(cover, key=cover.get), cover


def compose_face(prepared, axis, out_dir, log, drop=frozenset()):
    face, side = prepared["face"], prepared["side"]
    panos, depths = [], []
    for p, dep in zip(prepared["panos"], prepared["depths"]):
        if p["pano"] in drop:
            continue
        panos.append(p)
        depths.append(float(np.clip(dep, DEPTH_MIN, DEPTH_MAX)))
    if not panos:
        return None
    s0, s1 = sorted((float(face["sAtLeft"]), float(face["sAtRight"])))
    primary, cover = primary_drive(panos, s0, s1)
    newest = max((p["date"] or "") for p in panos) or primary
    for p in panos:
        p["newest"] = p["date"] == primary
        p["age"] = months_since(p["date"] or "", primary) / 12.0 if (p["date"] or "") <= primary else 0.0
    log(f"side {side}: drawn from the {primary} drive ({round(cover.get(primary, 0) * 100)} % of the window within {PRIMARY_REACH_M:.0f} m of its cameras), {len(panos)} panoramas of {len(prepared['panos'])}{'' if newest == primary else f', the {newest} capture set aside'}")

    grid = FaceGrid(face, float(face["ppm"]))
    W, Hh, ppm, S, ground, plane = grid.W, grid.H, grid.ppm, grid.S, grid.ground, grid.plane
    z_top = grid.z_top
    rows = np.arange(Hh)[:, None]
    foot_row = np.clip(np.round((z_top - (ground - BELOW_GROUND_M)) * ppm).astype(int), 0, Hh)

    cands = []
    for p, dep in zip(panos, depths):
        laid = grid.lay(p, dep, side, axis)
        if laid is None:
            continue
        rgb, mask, x0, x1 = laid
        cands.append({"pano": p["pano"], "date": p["date"], "s": float(p["cam"]["s"]), "d": float(p["cam"]["d"]), "depth": dep,
                      "x0": x0, "x1": x1, "rgb": rgb, "mask": mask, "age": p["age"], "newest": p["newest"]})
    if not cands:
        return None

    # each candidate's cost down every column it reaches
    for c in cands:
        cols = np.arange(c["x0"], c["x1"])
        below_foot = rows < foot_row[cols][None, :]
        cover = (c["mask"] & below_foot).sum(0) / np.maximum(1, foot_row[cols])
        top_rows = np.clip(np.round((z_top - (ground[cols] + 0.5)) * ppm).astype(int), 0, Hh)
        upper = (rows < top_rows[None, :]) & c["mask"]
        c["green"] = greenness(c["rgb"])
        foliage = (c["green"] & upper).sum(0) / np.maximum(1, upper.sum(0))
        dist = np.maximum(1.0, c["depth"] * (plane[cols] - c["d"] * side))
        oblique = np.degrees(np.arctan2(np.abs(S[cols] - c["s"]), dist))
        # foliage as its square root: a column half under a canopy is nearly as spoilt as one wholly under it
        age = 0.0 if c["newest"] else OLD_YEAR_W + AGE_W * c["age"]
        c["cost"] = MISSING_W * (1 - cover) + FOLIAGE_W * np.sqrt(foliage) + (oblique / OBLIQUE_DEG) ** 2 + age
        c["ok"] = cover >= MIN_COVER
        c["lum"] = c["rgb"].astype(np.float32).mean(-1)

    # how far each candidate departs, column by column, from what the other cameras saw there: the median down
    # the column of the newest year's cameras that reach it (of all of them where fewer than two do), each
    # column's brightness taken out, so an exposure is not a departure but a building that is not there is
    rows_ref = np.arange(0, Hh, 2)
    at = [[] for _ in range(W)]
    for k, c in enumerate(cands):
        for i in np.flatnonzero(c["ok"]):
            at[c["x0"] + i].append(k)
    for x in range(W):
        ks = at[x]
        if len(ks) < 2:
            continue
        L = np.stack([cands[k]["lum"][rows_ref, x - cands[k]["x0"]] for k in ks])
        M = np.stack([cands[k]["mask"][rows_ref, x - cands[k]["x0"]] & ~cands[k]["green"][rows_ref, x - cands[k]["x0"]] for k in ks])
        ref_i = [i for i, k in enumerate(ks) if cands[k]["newest"]]
        if len(ref_i) < 2:
            ref_i = list(range(len(ks)))
        Lr = np.where(M[ref_i], L[ref_i], np.nan)
        n_ref = (~np.isnan(Lr)).sum(0)
        ref_ok = n_ref >= (2 if len(ref_i) >= 2 else 1)
        if ref_ok.sum() < 20:
            continue
        ref = np.zeros(len(rows_ref), np.float32)
        ref[ref_ok] = np.nanmedian(Lr[:, ref_ok], axis=0)
        for i, k in enumerate(ks):
            both = M[i] & ref_ok
            if both.sum() < 20:
                continue
            a = L[i][both]
            r = ref[both]
            d = np.abs((a - a.mean()) - (r - r.mean())).mean() / 255.0
            cands[k]["cost"][x - cands[k]["x0"]] += CONSIST_W * max(0.0, d - CONSIST_FREE)

    # the Viterbi pass: the cheapest run of panoramas down the columns, each run of reachable columns on its own
    rows_sub = np.arange(0, Hh, 3)
    labels = np.full(W, -1, np.int32)

    def column(k, x):
        c = cands[k]
        return c["rgb"][rows_sub, x - c["x0"]].astype(np.int16), c["mask"][rows_sub, x - c["x0"]]

    x = 0
    while x < W:
        if not at[x]:
            x += 1
            continue
        start = x
        accs, backs = [], []
        prev_ks, prev_acc = None, None
        while x < W and at[x]:
            ks = at[x]
            cost = np.array([cands[k]["cost"][x - cands[k]["x0"]] for k in ks])
            if prev_ks is None:
                acc, bp = cost, None
            else:
                P = np.stack([column(k, x - 1)[0] for k in prev_ks])
                MP = np.stack([column(k, x - 1)[1] for k in prev_ks])
                Q = np.stack([column(k, x)[0] for k in ks])
                MQ = np.stack([column(k, x)[1] for k in ks])
                both = MP[:, None, :] & MQ[None, :, :]
                diff = np.abs(P[:, None, :, :] - Q[None, :, :, :]).mean(-1)
                n_both = both.sum(-1)
                d = np.where(n_both > 0, (diff * both).sum(-1) / np.maximum(1, n_both) / 255.0, 0.5)
                T = SWITCH_W + SEAM_W * d
                T[np.equal.outer(np.array(prev_ks), np.array(ks))] = 0.0
                tot = prev_acc[:, None] + T
                arg = np.argmin(tot, axis=0)
                acc = tot[arg, np.arange(len(ks))] + cost
                bp = [prev_ks[a] for a in arg]
            accs.append(acc)
            backs.append(bp)
            prev_ks, prev_acc = ks, acc
            x += 1
        k = at[x - 1][int(np.argmin(accs[-1]))]
        for y in range(x - 1, start - 1, -1):
            labels[y] = k
            bp = backs[y - start]
            if bp is None:
                break
            k = bp[at[y].index(k)]

    # the picture: each run of a panorama, crossfaded into the next over the columns both reach
    runs = []
    x = 0
    while x < W:
        k = labels[x]
        y = x
        while y < W and labels[y] == k:
            y += 1
        if k >= 0:
            runs.append((x, y, int(k)))
        x = y
    gains = run_gains(runs, cands, foot_row)
    ground_rows = np.clip(np.round((z_top - ground) * ppm).astype(int), 0, Hh)
    shifts = run_shifts(runs, cands, ground_rows, ppm)
    acc_rgb = np.zeros((Hh, W, 3), np.float32)
    acc_w = np.zeros((Hh, W), np.float32)
    for (a, b, k), gain, shift in zip(runs, gains, shifts):
        c = cands[k]
        left_seam = a > 0 and labels[a - 1] >= 0
        right_seam = b < W and labels[b] >= 0
        lo = max(a - BLEND_PX if left_seam else a, c["x0"])
        hi = min(b + BLEND_PX if right_seam else b, c["x1"])
        if hi <= lo:
            continue
        cols = np.arange(lo, hi)
        wgt = np.ones(hi - lo, np.float32)
        if left_seam:
            wgt = np.minimum(wgt, np.clip((cols - (a - BLEND_PX) + 0.5) / (2 * BLEND_PX), 0, 1))
        if right_seam:
            wgt = np.minimum(wgt, np.clip(((b + BLEND_PX) - cols - 0.5) / (2 * BLEND_PX), 0, 1))
        msk = c["mask"][:, lo - c["x0"]:hi - c["x0"]]
        pic = c["rgb"][:, lo - c["x0"]:hi - c["x0"]]
        if shift:
            msk = shift2(msk, shift, 0)
            pic = np.roll(pic, shift, axis=0)
        m = msk.astype(np.float32) * wgt[None, :]
        acc_rgb[:, lo:hi] += pic.astype(np.float32) * gain * m[..., None]
        acc_w[:, lo:hi] += m
    has = acc_w > 1e-6
    out = np.zeros((Hh, W, 3), np.uint8)
    out[has] = np.clip(acc_rgb[has] / acc_w[has][:, None] + 0.5, 0, 255).astype(np.uint8)
    alpha = has & (rows < foot_row[None, :])

    # the sky, taken off where it joins the top of the picture; then what no longer stands on the ground
    sky_px = 0
    if face.get("sky", True):
        skymask = sky_mask(out, alpha)
        sky_px = int(skymask.sum())
        alpha &= ~skymask
        if GROUNDED_ONLY:
            alpha &= grounded(alpha, foot_row)

    # what the sheet needs: the top of what stands on each metre, the coverage, the foliage, the sources
    tops = []
    for mtr in range(int(W // ppm)):
        a, b = int(round(mtr * ppm)), min(W, int(round((mtr + 1) * ppm)))
        col = alpha[:, a:b].any(axis=1)
        if col.any():
            tops.append({"m": mtr, "z": round(z_top - int(np.argmax(col)) / ppm, 2)})
    above = (rows < np.clip(np.round((z_top - (ground + 0.3)) * ppm).astype(int), 0, Hh)[None, :]) & alpha
    foliage_share = float((greenness(out) & above).sum() / max(1, above.sum()))
    band = int((rows < foot_row[None, :]).sum())
    sources = [{"x0": int(a), "x1": int(b), "panoId": cands[k]["pano"], "date": cands[k]["date"], "depth": round(cands[k]["depth"], 3)} for (a, b, k) in runs]
    used = sorted({cands[k]["pano"] for (_, _, k) in runs})
    dates = sorted({cands[k]["date"] for (_, _, k) in runs if cands[k]["date"]})

    Image.fromarray(np.dstack([out, (alpha * 255).astype(np.uint8)]), "RGBA").save(os.path.join(out_dir, face["file"]), compress_level=6)
    return {
        "file": face["file"], "width": W, "height": Hh, "ppm": ppm,
        "panoramas": len(used), "candidates": len(cands), "dates": dates,
        "calibrated": sum(1 for d in depths if d != 1.0),
        "drive": primary,
        "columnsCovered": float((labels >= 0).mean()),
        "foliageShare": foliage_share,
        "skyShare": float(sky_px / max(1, band)),
        "opaqueShare": float(int(alpha.sum()) / max(1, band)),
        "tops": tops, "sources": sources,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: streetscape_montage.py job.json"}))
        sys.exit(1)
    with open(sys.argv[1]) as fh:
        job = json.load(fh)
    notes = []
    prepared = []
    for face in job["faces"]:
        try:
            prepared.append(prepare_face(face, job["axis"], job["outDir"], notes.append))
        except Exception as e:  # one face failing is not the other's fault
            notes.append(f"face {face.get('side')}: {type(e).__name__}: {e}")
            prepared.append(None)
    # a camera on the footpath of either face is left out of both
    nearest = {}
    for pr in prepared:
        if not pr:
            continue
        for p, dep in zip(pr["panos"], pr["depths"]):
            nearest[p["pano"]] = min(nearest.get(p["pano"], 9.0), dep)
    drop = frozenset(k for k, v in nearest.items() if v <= FOOTPATH_DEPTH)
    if drop:
        by_date = {}
        for pr in prepared:
            if pr:
                for p in pr["panos"]:
                    if p["pano"] in drop:
                        by_date[p["date"]] = by_date.get(p["date"], 0) + 1
        notes.append(f"{len(drop)} cameras stood on a footpath, left out of both faces: " + ", ".join(f"{n} of {d}" for d, n in sorted(by_date.items(), key=lambda kv: str(kv[0]))))
    if job.get("debug"):
        for pr in prepared:
            if pr:
                notes.append(f"side {pr['side']} depths: " + " ".join(f"{p['date']}@{p['cam']['s']:.0f}:{d:.2f}" for p, d in sorted(zip(pr["panos"], pr["depths"]), key=lambda t: t[0]["cam"]["s"])))
    out = []
    for pr in prepared:
        if not pr:
            out.append(None)
            continue
        try:
            out.append(compose_face(pr, job["axis"], job["outDir"], notes.append, drop))
        except Exception as e:
            notes.append(f"face {pr['side']}: {type(e).__name__}: {e}")
            out.append(None)
    print(json.dumps({"faces": out, "notes": notes}))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""CAD export for the SITE ANALYSIS sheet.

Reads the pipeline's data/site_bundle.json and writes SITE_ANALYSIS.dxf in
real-world meters on the MGA2020 grid (the NSW survey datum), one layer per
data class, ready to import into ArchiCAD / AutoCAD and trace over.

Everything is drawn at true ground scale — not sheet scale — so the drawing
can be underlaid directly beneath a survey.

If an ODA File Converter binary is available (ODAFileConverter on PATH or
ODA_CONVERTER env), a true .dwg is produced next to the .dxf.

Usage: site_dxf_export.py <outDir>   (expects <outDir>/data/site_bundle.json)
"""
import json
import math
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment
from pyproj import Transformer

OUT = Path(sys.argv[1])
bundle = json.loads((OUT / "data" / "site_bundle.json").read_text())

# ---- projection: lon/lat -> MGA2020 zone of the site ----------------------
site_lon = bundle["siteRing"][0][0] if bundle.get("siteRing") else 151.0
zone = int(site_lon // 6) + 31                # 151E -> zone 56
EPSG = 7800 + zone                            # MGA2020: zone 56 -> EPSG:7856
tf = Transformer.from_crs("EPSG:4326", f"EPSG:{EPSG}", always_xy=True)

def P(lon, lat):
    return tf.transform(lon, lat)

doc = ezdxf.new("R2010", setup=True)
doc.header["$INSUNITS"] = 6                   # meters
msp = doc.modelspace()

# ---- namespace the layers -------------------------------------------------
# Everything this tool writes is prefixed, so when the DXF is merged into a
# project file it is obvious which layers came from Site Analyst — and they can
# be switched off or purged as a group.
LAYER_PREFIX = "SA_"

# ezdxf refuses to rename its special layers ("0", "Defpoints"), and a raised
# error here would abort the export before it saved anything.
SPECIAL_LAYERS = {"0", "defpoints"}

def prefix_layers(doc):
    for lay in list(doc.layers):
        name = lay.dxf.name
        if name.lower() in SPECIAL_LAYERS or name.startswith(LAYER_PREFIX):
            continue
        try:
            lay.rename(LAYER_PREFIX + name)
        except ValueError:
            pass

def layer(name, rgb, linetype="Continuous"):
    if name not in doc.layers:
        doc.layers.add(name, dxfattribs={"true_color": rgb, "linetype": linetype})
    return name

# One layer per class so the architect can switch off what they don't want.
layer("SITE-BOUNDARY", 0xE30613)
layer("SITE-LOTS", 0xE30613)
layer("CADASTRE", 0x9A9A9A)
layer("CONTOURS", 0xB07A3C)
layer("CONTOUR-LEVELS", 0xB07A3C)
layer("ROADS", 0x6E6E6E)
layer("ROAD-NAMES", 0x333333)
layer("RAIL", 0xEF8B1D)
layer("BUILDINGS", 0x8A8A8A)
layer("NEIGHBOUR-LABELS", 0x333333)
layer("TREES", 0x3E8B49)
layer("DRIVEWAYS", 0x2456C4)
layer("PARKING-LANES", 0x2456C4)
layer("PARKING-BAYS", 0x2456C4)
layer("CAR-PARKS", 0x2456C4)
layer("TREE-LABELS", 0x3E8B49)
layer("VIEWS", 0x8A8A8A)
layer("UTILITIES", 0x9B59B6)
layer("STREET-LAMPS", 0xC8A165)
layer("POWER-POLES", 0xC8A165)
layer("HYDRANTS", 0x2F9FD6)
layer("BUS-STOPS", 0xE30613)
layer("ZONING", 0xBBBBBB)
layer("NORTH", 0x000000)

def rings_of(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly]
    return []

def add_poly(layer_name, ring, closed=True):
    pts = [P(c[0], c[1]) for c in ring if c and len(c) >= 2]
    if len(pts) < 2:
        return None
    return msp.add_lwpolyline(pts, close=closed, dxfattribs={"layer": layer_name})

def add_text(layer_name, text, x, y, height, rotation=0.0):
    t = msp.add_text(text, dxfattribs={
        "layer": layer_name, "height": height, "rotation": rotation})
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t

# ---- site boundary and lots ----------------------------------------------
add_poly("SITE-BOUNDARY", bundle["siteRing"])
for f in bundle.get("siteLots", {}).get("features", []):
    for ring in rings_of(f.get("geometry")):
        add_poly("SITE-LOTS", ring)

# ---- surrounding cadastre ------------------------------------------------
for f in bundle.get("allLots", {}).get("features", []):
    for ring in rings_of(f.get("geometry")):
        add_poly("CADASTRE", ring)

# ---- terrain: contours, each labelled with its RL ------------------------
for c in bundle.get("contours", []):
    coords = c.get("coords") or []
    pl = add_poly("CONTOURS", coords, closed=False)
    if pl is not None and len(coords) > 2:
        mx, my = P(*coords[len(coords) // 2])
        add_text("CONTOUR-LEVELS", f"RL {c['elevation']:.1f}", mx, my, 0.6)

# ---- roads and names -----------------------------------------------------
for r in bundle.get("roads", []):
    line = r.get("coords") or []
    add_poly("ROADS", line, closed=False)
    name = r.get("name")
    if name and len(line) > 1:
        a, b = line[len(line) // 2 - 1], line[len(line) // 2]
        (ax, ay), (bx, by) = P(*a), P(*b)
        rot = math.degrees(math.atan2(by - ay, bx - ax))
        if rot > 90 or rot < -90:
            rot += 180
        add_text("ROAD-NAMES", name.upper(), (ax + bx) / 2, (ay + by) / 2, 1.2, rot)

rail = bundle.get("railLines") or {}
for key in ("train", "tram"):
    for line in rail.get(key, []) or []:
        add_poly("RAIL", line, closed=False)

# ---- neighbours: house number where the pipeline found one --------------
for n in bundle.get("neighbours", []):
    x, y = P(n["lon"], n["lat"])
    add_text("NEIGHBOUR-LABELS", str(n.get("housenumber", "")).strip(), x, y, 1.0)

# ---- street furniture ----------------------------------------------------
fur = bundle.get("furniture") or {}

def dots(layer_name, items, radius):
    for it in items or []:
        x, y = P(it["lon"], it["lat"])
        msp.add_circle((x, y), radius, dxfattribs={"layer": layer_name})

# ---- trees: the canopy at its recorded or nominal size, trunk at centre ----
for t in fur.get("trees") or []:
    x, y = P(t["lon"], t["lat"])
    canopy = t.get("canopyM") or 6
    msp.add_circle((x, y), canopy / 2, dxfattribs={"layer": "TREES"})
    msp.add_circle((x, y), 0.25, dxfattribs={"layer": "TREES"})
    if t.get("canopySource") == "measured" or t.get("species"):
        name = t.get("common") or t.get("species") or ""
        size = f"C{canopy:g}m" + (f" H{t['heightM']:g}m" if t.get("heightM") else "")
        add_text("TREE-LABELS", f"{name} {size}".strip(), x, y - canopy / 2 - 0.6, 0.4)

dots("STREET-LAMPS", fur.get("streetLamps"), 0.4)
dots("POWER-POLES", fur.get("powerPoles"), 0.4)
dots("HYDRANTS", fur.get("hydrants"), 0.4)
dots("BUILDINGS", fur.get("buildings"), 0.5)
for b in fur.get("buildings") or []:
    if b.get("levels"):
        x, y = P(b["lon"], b["lat"])
        add_text("BUILDINGS", f"{b['levels']} storey", x, y + 1.2, 0.8)

for d in fur.get("driveways") or []:
    add_poly("DRIVEWAYS", d.get("coords") or [], closed=False)
for pl in fur.get("parkingLanes") or []:
    add_poly("PARKING-LANES", pl.get("coords") or [], closed=False)

# ---- kerbside bays as set out on the sheet, car parks as OSM has them -----
for band in bundle.get("parkingBands") or []:
    for ring in band.get("bays") or []:
        add_poly("PARKING-BAYS", ring)
for b in fur.get("parkingBays") or []:
    add_poly("PARKING-BAYS", b.get("ring") or [])
CAR_PARK_KIND = {
    "surface": "CAR PARK", "multi-storey": "MULTI-STOREY CAR PARK",
    "underground": "BASEMENT CAR PARK", "rooftop": "ROOFTOP CAR PARK",
    "street_side": "PARKING BAYS",
}
for cp in fur.get("carParks") or []:
    ring = cp.get("ring") or []
    if add_poly("CAR-PARKS", ring) is None:
        continue
    pts = [P(c[0], c[1]) for c in ring]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    label = CAR_PARK_KIND.get(cp.get("kind"), "CAR PARK")
    if cp.get("capacity"):
        label += f" ({cp['capacity']} BAYS)"
    add_text("CAR-PARKS", label, cx, cy, 0.8)
for u in fur.get("utilities") or []:
    p = add_poly("UTILITIES", u.get("coords") or [], closed=False)
    if p is not None:
        p.dxf.layer = layer(f"UTILITIES-{u.get('kind', 'OTHER').upper()}", 0x9B59B6)

# ---- services an open licence lets the sheet draw (fetch/services.ts) and the
# ones OpenStreetMap maps; one layer each, so a BYDA plan traced over them can
# replace them kind by kind. Not a substitute for a Before You Dig enquiry. ----
# AS 5488.1's colours, as on the sheet: electricity orange, stormwater green.
SERVICE_RGB = {"STORMWATER": 0x2E8B3A, "STORMWATERPIT": 0x2E8B3A, "LIGHTPOLE": 0xA8860B,
               "POWERHV": 0xC45A00, "SUBSTATION": 0xEF7D00, "TRANSFORMER": 0xEF7D00,
               "CABINET": 0x8A8A8A, "MANHOLE": 0x6F6F6F, "POWERCABLE": 0xEF7D00,
               "POWEROVERHEAD": 0xEF7D00, "POWERPOLE": 0x333333, "PILLAR": 0xEF7D00}
svc = bundle.get("services") or {}
for l in svc.get("lines") or []:
    name = f"SERVICES-{str(l.get('kind', 'OTHER')).upper()}"
    p = add_poly("UTILITIES", l.get("coords") or [], closed=False)
    if p is None:
        continue
    p.dxf.layer = layer(name, SERVICE_RGB.get(name[9:], 0x9B59B6))
    if l.get("label") and len(l["coords"]) >= 2:
        a, b = P(*l["coords"][0][:2]), P(*l["coords"][-1][:2])
        add_text(layer(name, SERVICE_RGB.get(name[9:], 0x9B59B6)), l["label"], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.4,
                 math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])))
for pt in (svc.get("points") or []) + (fur.get("servicePoints") or []):
    name = f"SERVICES-{str(pt.get('kind', 'OTHER')).upper()}"
    lay = layer(name, SERVICE_RGB.get(name[9:], 0x9B59B6))
    x, y = P(pt["lon"], pt["lat"])
    msp.add_circle((x, y), 0.4, dxfattribs={"layer": lay})
    if pt.get("label"):
        add_text(lay, pt["label"], x + 0.6, y, 0.35)

for s in bundle.get("busStops", []) or []:
    x, y = P(s["lon"], s["lat"])
    msp.add_circle((x, y), 1.0, dxfattribs={"layer": "BUS-STOPS"})

# ---- zoning polygons (boundaries only; the wash is a sheet device) -------
for f in bundle.get("zoning", {}).get("features", []):
    for ring in rings_of(f.get("geometry")):
        add_poly("ZONING", ring)

# ---- potential views: a 40 m cone from the site edge, where the ground
# leaves the sight line clear. Ground only — the sheet's legend says so. ----
site_pts = [P(c[0], c[1]) for c in bundle["siteRing"]]
site_cx = sum(p[0] for p in site_pts) / len(site_pts)
site_cy = sum(p[1] for p in site_pts) / len(site_pts)

def exit_point(bearing_deg):
    """Where a ray from the site centre at this bearing leaves the boundary."""
    dx, dy = math.sin(math.radians(bearing_deg)), math.cos(math.radians(bearing_deg))
    best = 0.0
    for (ax, ay), (bx, by) in zip(site_pts, site_pts[1:]):
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = ((ax - site_cx) * ey - (ay - site_cy) * ex) / den
        u = ((ax - site_cx) * dy - (ay - site_cy) * dx) / den
        if t > best and 0 <= u <= 1:
            best = t
    return site_cx + dx * best, site_cy + dy * best

for v in bundle.get("views") or []:
    if not v.get("cone"):
        continue
    ax, ay = exit_point(v["bearingDeg"])
    b = math.radians(v["bearingDeg"])
    L, half = 40.0, math.radians(14)
    arc = [(ax + L * math.sin(b - half + 2 * half * i / 10),
            ay + L * math.cos(b - half + 2 * half * i / 10)) for i in range(11)]
    msp.add_lwpolyline([(ax, ay)] + arc, close=True, dxfattribs={"layer": "VIEWS"})
    word = "OUTLOOK" if v.get("kind") == "park" else "VIEW"
    add_text("VIEWS", f"{v['label']} {word}", ax + 0.6 * L * math.sin(b), ay + 0.6 * L * math.cos(b), 1.2)

# ---- true north arrow at the site, so orientation survives the import ---
cx, cy = P(*bundle["siteRing"][0])
msp.add_lwpolyline([(cx, cy), (cx, cy + 10)], dxfattribs={"layer": "NORTH"})
add_text("NORTH", "N", cx, cy + 11.5, 1.5)

dxf_path = OUT / "SITE_ANALYSIS.dxf"
prefix_layers(doc)
doc.saveas(dxf_path)
print(f"dxf: {dxf_path}")

# ---- optional DWG via ODA File Converter --------------------------------
oda = os.environ.get("ODA_CONVERTER") or shutil.which("ODAFileConverter")
dwg_path = OUT / "SITE_ANALYSIS.dwg"
if oda:
    try:
        subprocess.run([oda, str(OUT), str(OUT), "ACAD2018", "DWG", "0", "1",
                        dxf_path.name], check=True, timeout=180,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if dwg_path.exists():
            print(f"dwg: {dwg_path}")
    except Exception as e:                      # noqa: BLE001 - DXF is enough
        print(f"dwg: conversion failed ({e}) — DXF only")
else:
    print("dwg: ODA File Converter not found — DXF only (ArchiCAD imports DXF natively)")

zip_path = OUT / "SITE_ANALYSIS_CAD.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(dxf_path, dxf_path.name)
    if dwg_path.exists():
        z.write(dwg_path, dwg_path.name)
    z.writestr("README.txt",
               "SITE ANALYSIS — CAD export\n"
               f"Coordinate system: MGA2020 zone {zone} (EPSG:{EPSG}), meters.\n"
               "Drawn at true ground scale, not sheet scale.\n"
               "One layer per data class; switch off what you do not need.\n\n"
               "Levels are from the NSW 1m elevation model, not a survey.\n"
               "Cadastral boundaries are GIS approximations — confirm all\n"
               "boundaries and levels against a registered survey before use.\n"
               "Tree canopies are at the recorded size where a council inventory\n"
               "or OSM records one, otherwise a nominal 6 m. Kerbside bays are set\n"
               "out at AS/NZS 2890.5 sizes from OSM kerbside tags, not surveyed.\n"
               "View cones are ground sight lines only; buildings not assessed.\n")
print(f"zip: {zip_path}")

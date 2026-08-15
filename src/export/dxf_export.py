#!/usr/bin/env python3
"""CAD export for the autonomous site analyst.

Reads the pipeline's data/bundle.json and writes CONTEXT_ANALYSIS.dxf in
real-world meters on the MGA2020 grid (the NSW survey datum), with one layer
per data class — prepared for direct import into ArchiCAD / AutoCAD.

If an ODA File Converter binary is available (ODAFileConverter on PATH or
ODA_CONVERTER env), a true .dwg is produced next to the .dxf.

Usage: dxf_export.py <outDir>   (expects <outDir>/data/bundle.json)
"""
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment
from pyproj import Transformer

OUT = Path(sys.argv[1])
bundle = json.loads((OUT / "data" / "bundle.json").read_text())

SCALE = bundle["scale"]                      # e.g. 2000 -> sheet 1:2000
MM = SCALE / 1000.0                          # 1 mm on the sheet = MM meters

# ---- projection: lon/lat -> MGA2020 zone of the site ----------------------
site_lon = None
for f in bundle["siteLots"]["features"]:
    if f.get("geometry"):
        site_lon = f["geometry"]["coordinates"][0][0][0]
        break
if site_lon is None:
    site_lon = 151.0
zone = int(site_lon // 6) + 31               # 151E -> zone 56
EPSG = 7800 + zone                            # MGA2020: zone 56 -> EPSG:7856
tf = Transformer.from_crs("EPSG:4326", f"EPSG:{EPSG}", always_xy=True)
tf3857 = Transformer.from_crs("EPSG:3857", f"EPSG:{EPSG}", always_xy=True)

def P(lon, lat):
    return tf.transform(lon, lat)

# ---- palette (mirrors src/render/model.ts) --------------------------------
CATS = {
    "site":           dict(rgb=0xE8402A),
    "medical":        dict(rgb=0xF27BA9, stroke=0xE5237E),
    "education":      dict(rgb=0x93B7F2, stroke=0x2E6BE6),
    "childCare":      dict(rgb=0xF4F8FF, stroke=0x2E6BE6),
    "mixedUse":       dict(rgb=0xE957C9),
    "retail":         dict(rgb=0xE4D3F0),
    "openSpace":      dict(rgb=0xE6F0D8),
    "community":      dict(rgb=0xE0F2EB, stroke=0xA5C3D8),
    "r2":             dict(rgb=0xFCE9E8),
    "r3":             dict(rgb=0xF7C1BD),
    "r4":             dict(rgb=0xF29E97),
    "localCentre":    dict(rgb=0xF0B3C8),
    "commercial":     dict(rgb=0xD9C2EE),
    "industrial":     dict(rgb=0xC9A8EC),
    "infrastructure": dict(rgb=0xF0E2E6, stroke=0xEF8B1D),
    "water":          dict(rgb=0xBCDCF0),
    "railway":        dict(rgb=0xF3C488, stroke=0xEF8B1D),
    "heritage":       dict(rgb=0xC8A165),
}

def zone_to_cat(code):
    c = (code or "").upper()
    if c.startswith("R2"): return "r2"
    if c[:2] in ("R1", "R3"): return "r3"
    if c.startswith("R4"): return "r4"
    if c.startswith("R5"): return "r2"
    if c in ("B1", "B2", "E1"): return "localCentre"
    if c in ("B3", "E2", "E3"): return "commercial"
    if c in ("B4", "MU1", "B"): return "mixedUse"
    if c.startswith(("IN", "E4", "E5")): return "industrial"
    if c.startswith("SP"): return "infrastructure"
    if c.startswith("RE"): return "openSpace"
    if c.startswith("W"): return "water"
    if c.startswith("C") and len(c) == 2 and c[1].isdigit(): return "openSpace"
    if c.startswith("RU"): return "r2"
    return None

# ---- document --------------------------------------------------------------
doc = ezdxf.new("R2013", setup=True)          # setup=True loads DASHED etc.
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
doc.header["$INSUNITS"] = 6                   # meters
doc.header["$MEASUREMENT"] = 1

def layer(name, rgb, linetype="Continuous"):
    if name not in doc.layers:
        la = doc.layers.add(name, linetype=linetype)
        la.rgb = ((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
    return name

def rings_of(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly]
    return []

def add_poly(layer_name, ring, closed=True):
    pts = [P(x, y) for x, y in ring]
    if len(pts) < 2:
        return None
    return msp.add_lwpolyline(pts, close=closed, dxfattribs={"layer": layer_name})

def add_solid_hatch(layer_name, rings, rgb, transparency=0.5):
    h = msp.add_hatch(dxfattribs={"layer": layer_name})
    h.rgb = ((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
    try:
        h.transparency = transparency
    except Exception:
        pass
    for ring in rings:
        pts = [P(x, y) for x, y in ring]
        if len(pts) >= 3:
            h.paths.add_polyline_path(pts, is_closed=True)
    return h

def add_text(layer_name, text, x, y, height, rotation=0.0):
    t = msp.add_text(text, dxfattribs={
        "layer": layer_name, "height": height, "rotation": rotation, "style": "OpenSans",
    })
    t.set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)
    return t

# ---- cadastre ---------------------------------------------------------------
layer("CADASTRE", 0x6F6F6F)
for f in bundle["allLots"]["features"]:
    for r in rings_of(f.get("geometry")):
        add_poly("CADASTRE", r)

# ---- zoning -----------------------------------------------------------------
for f in bundle["zoning"]["features"]:
    cat = zone_to_cat(f["properties"].get("SYM_CODE"))
    if not cat:
        continue
    color = CATS[cat]["rgb"]
    lname = layer(f"ZONE-{cat.upper()}", color)
    fname = layer(f"ZONE-{cat.upper()}-FILL", color)
    rings = rings_of(f.get("geometry"))
    for r in rings:
        add_poly(lname, r)
    if rings:
        add_solid_hatch(fname, rings, color, 0.55)

# ---- rail corridor ------------------------------------------------------------
layer("RAIL-CORRIDOR", CATS["railway"]["rgb"])
for f in bundle["railCorridors"]["features"]:
    for r in rings_of(f.get("geometry")):
        add_poly("RAIL-CORRIDOR", r)

# ---- institutions -------------------------------------------------------------
for inst in bundle["institutionPolys"]:
    cat = inst["cat"]
    color = CATS.get(cat, CATS["community"])["rgb"]
    stroke = CATS.get(cat, {}).get("stroke", color)
    lname = layer(f"INST-{cat.upper()}", stroke)
    fname = layer(f"INST-{cat.upper()}-FILL", color)
    for r in inst["rings"]:
        add_poly(lname, r)
    add_solid_hatch(fname, inst["rings"], color, 0.4)

# ---- heritage items (hatched) --------------------------------------------------
layer("HERITAGE", CATS["heritage"]["rgb"])
for f in bundle["heritage"]["features"]:
    lay_class = (f["properties"].get("LAY_CLASS") or "Item")
    if not lay_class.startswith("Item"):
        continue
    rings = rings_of(f.get("geometry"))
    for r in rings:
        add_poly("HERITAGE", r)
    if rings:
        h = msp.add_hatch(dxfattribs={"layer": "HERITAGE"})
        h.rgb = (0xA9, 0x7B, 0x3F)
        h.set_pattern_fill("ANSI31", scale=2.0)
        for ring in rings:
            pts = [P(x, y) for x, y in ring]
            if len(pts) >= 3:
                h.paths.add_polyline_path(pts, is_closed=True)

# ---- site (on top) --------------------------------------------------------------
layer("SITE", CATS["site"]["rgb"], "DASHED")
for f in bundle["siteLots"]["features"]:
    for r in rings_of(f.get("geometry")):
        pl = add_poly("SITE", r)
        if pl is not None:
            pl.dxf.const_width = 0.5 * MM / 2   # heavy outline

# ---- roads + names ---------------------------------------------------------------
layer("ROADS", 0x8A8A8A)
layer("ROAD-NAMES", 0x2E2E2E)
best = {}
for road in bundle["roads"]:
    pts = road["coords"]
    if len(pts) < 2:
        continue
    msp.add_lwpolyline([P(x, y) for x, y in pts], dxfattribs={"layer": "ROADS"})
    length = sum(math.dist(pts[i - 1], pts[i]) for i in range(1, len(pts)))
    cur = best.get(road["name"])
    if not cur or length > cur[0]:
        best[road["name"]] = (length, pts)
_ABBR = [("STREET", "ST"), ("ROAD", "RD"), ("AVENUE", "AVE"), ("PARADE", "PDE"),
         ("HIGHWAY", "HWY"), ("DRIVE", "DR"), ("LANE", "LN"), ("PLACE", "PL"),
         ("CRESCENT", "CRES"), ("BOULEVARD", "BVD"), ("TERRACE", "TCE"), ("COURT", "CT")]
for name, (_length, pts) in best.items():
    mid = pts[len(pts) // 2]
    nxt = pts[min(len(pts) // 2 + 1, len(pts) - 1)]
    a, b = P(*mid), P(*nxt)
    ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    label = name.upper()
    for full, short in _ABBR:
        label = label.replace(f" {full}", f" {short}")
    add_text("ROAD-NAMES", label, a[0], a[1], 4.9 * MM, ang)

# ---- rail / tram lines -------------------------------------------------------------
layer("RAIL-LINE", 0x3B3B3B)
for line in bundle["railLines"]["train"]:
    msp.add_lwpolyline([P(x, y) for x, y in line], dxfattribs={"layer": "RAIL-LINE"})
layer("TRAM-LINE", 0xD5006D, "DASHED")
for line in bundle["railLines"]["tram"]:
    msp.add_lwpolyline([P(x, y) for x, y in line], dxfattribs={"layer": "TRAM-LINE"})

# ---- bus routes (from OSM if present) ----------------------------------------------
layer("BUS-ROUTES", 0x2F7FD6, "DASHED")
for line in bundle["bus"]["busRouteSegments"]:
    msp.add_lwpolyline([P(x, y) for x, y in line], dxfattribs={"layer": "BUS-ROUTES"})

# ---- stop symbols as blocks ---------------------------------------------------------
def make_stop_block(bname, letter, rgb):
    if bname in doc.blocks:
        return
    blk = doc.blocks.new(name=bname)
    r = 4.0 * MM
    c = blk.add_circle((0, 0), r)
    c.rgb = ((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
    t = blk.add_text(letter, dxfattribs={"height": 4.4 * MM, "style": "OpenSans"})
    t.rgb = c.rgb
    t.set_placement((0, 0), align=TextEntityAlignment.MIDDLE_CENTER)

make_stop_block("BUS_STOP", "B", 0x2F7FD6)
make_stop_block("TRAIN_STATION", "T", 0xE8402A)
make_stop_block("TRAM_STOP", "L", 0xD5006D)

layer("BUS-STOPS", 0x2F7FD6)
for s in bundle["bus"]["busStops"]:
    x, y = P(s["lon"], s["lat"])
    msp.add_blockref("BUS_STOP", (x, y), dxfattribs={"layer": "BUS-STOPS"})
layer("STATIONS", 0xE8402A)
layer("LABELS-POI", 0x1C1C1C)
for s in bundle["stations"]:
    x, y = P(s["lon"], s["lat"])
    tram = ("LIGHT RAIL" in s["name"].upper()) or ("TRAM" in s["name"].upper())
    msp.add_blockref("TRAM_STOP" if tram else "TRAIN_STATION", (x, y), dxfattribs={"layer": "STATIONS"})
    add_text("LABELS-POI", s["name"].upper(), x, y + 10 * MM, 4.9 * MM)
for s in bundle["bus"].get("tramStops", []):
    x, y = P(s["lon"], s["lat"])
    msp.add_blockref("TRAM_STOP", (x, y), dxfattribs={"layer": "STATIONS"})

# ---- isochrones -----------------------------------------------------------------------
iso_layers = {5: ("ISOCHRONE-400", 0xE6007E), 10: ("ISOCHRONE-800", 0xB5379B)}
for iso in bundle["isochrones"]:
    lname, rgb = iso_layers.get(iso["minutes"], (f"ISOCHRONE-{iso['minutes']}MIN", 0xE6007E))
    layer(lname, rgb, "DASHED")
    for ring in iso["rings"]:
        add_poly(lname, ring)

# ---- POI labels -------------------------------------------------------------------------
for p in bundle["parkAreas"]:
    x, y = P(p["lon"], p["lat"])
    add_text("LABELS-POI", p["name"].upper(), x, y, 4.9 * MM)
seen = {p["name"].upper() for p in bundle["parkAreas"]}
for p in bundle["parkPoints"]:
    if p["name"].upper() in seen:
        continue
    x, y = P(p["lon"], p["lat"])
    add_text("LABELS-POI", p["name"].upper(), x, y, 4.9 * MM)
for p in bundle["complexPoints"]:
    if not p.get("cat"):
        continue
    x, y = P(p["lon"], p["lat"])
    add_text("LABELS-POI", p["name"].upper(), x, y, 4.9 * MM)

# ---- text style --------------------------------------------------------------------------
if "OpenSans" not in doc.styles:
    doc.styles.add("OpenSans", font="arial.ttf")

# ---- aerial: georeferenced world files (+ IMAGE defs) --------------------------------------
ext = bundle["extent"]
aerial = bundle["aerial"]
pxW, pxH = aerial["pxWidth"], aerial["pxHeight"]
for t in aerial["tiles"]:
    # tile extent in EPSG:3857
    x0 = ext["xmin"] + (ext["xmax"] - ext["xmin"]) * t["left"]
    x1 = x0 + (ext["xmax"] - ext["xmin"]) * t["width"]
    y1 = ext["ymax"] - (ext["ymax"] - ext["ymin"]) * t["top"]
    y0 = y1 - (ext["ymax"] - ext["ymin"]) * t["height"]
    sw = tf3857.transform(x0, y0)
    se = tf3857.transform(x1, y0)
    nw = tf3857.transform(x0, y1)
    tile_px_w = round(pxW * t["width"])
    tile_px_h = round(pxH * t["height"])
    # world file (JGW) in MGA meters
    a = (se[0] - sw[0]) / tile_px_w
    d = (se[1] - sw[1]) / tile_px_w
    b = (sw[0] - nw[0]) / tile_px_h
    e = (sw[1] - nw[1]) / tile_px_h
    jgw = OUT / "data" / (Path(t["file"]).stem + ".jgw")
    jgw.write_text(f"{a:.6f}\n{d:.6f}\n{b:.6f}\n{e:.6f}\n{nw[0] + a / 2:.3f}\n{nw[1] + e / 2:.3f}\n")
    # DXF IMAGE underlay
    image_def = doc.add_image_def(filename=f"data/{t['file']}", size_in_pixel=(tile_px_w, tile_px_h))
    layer("AERIAL", 0xFFFFFF)
    msp.add_image(image_def=image_def, insert=sw,
                  size_in_units=(math.dist(sw, se), math.dist(sw, nw)),
                  rotation=math.degrees(math.atan2(se[1] - sw[1], se[0] - sw[0])),
                  dxfattribs={"layer": "AERIAL"})

# ---- notes -----------------------------------------------------------------------------------
readme = OUT / "CAD_README.txt"
readme.write_text(f"""CONTEXT ANALYSIS — CAD EXPORT
Address: {bundle['address']}
Coordinate system: MGA2020 zone {zone} (EPSG:{EPSG}), meters.
Symbol/text sizes are scaled for 1:{SCALE} output.

ArchiCAD import: File > Interoperability > Merge (or open as Worksheet),
set 1 drawing unit = 1 meter. Layers:
  SITE, CADASTRE, ZONE-* (+ -FILL hatches), INST-* (+ -FILL), HERITAGE,
  ROADS, ROAD-NAMES, RAIL-*, TRAM-*, BUS-ROUTES, BUS-STOPS, STATIONS,
  ISOCHRONE-400/800, LABELS-POI, AERIAL.
Aerial tiles: data/aerial_*.jpg with .jgw world files (MGA meters) for
manual georeferenced placement if the IMAGE underlay is not imported.
""")

dxf_path = OUT / "CONTEXT_ANALYSIS.dxf"
prefix_layers(doc)
doc.saveas(dxf_path)
print(f"dxf: {dxf_path}")

# ---- optional DWG via ODA File Converter -----------------------------------------------------
oda = os.environ.get("ODA_CONVERTER") or shutil.which("ODAFileConverter")
if oda:
    import tempfile
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as dst:
        shutil.copy(dxf_path, Path(src) / "CONTEXT_ANALYSIS.dxf")
        r = subprocess.run([oda, src, dst, "ACAD2013", "DWG", "0", "1"],
                           capture_output=True, timeout=300)
        produced = Path(dst) / "CONTEXT_ANALYSIS.dwg"
        if produced.exists():
            shutil.copy(produced, OUT / "CONTEXT_ANALYSIS.dwg")
            print(f"dwg: {OUT / 'CONTEXT_ANALYSIS.dwg'}")
        else:
            print(f"dwg: conversion failed ({r.returncode})", file=sys.stderr)
else:
    print("dwg: ODA File Converter not found — DXF only (ArchiCAD imports DXF natively)")

# ---- CAD package zip (DXF references data/*.jpg, so ship them together) ----
import zipfile
zip_path = OUT / "CONTEXT_ANALYSIS_CAD.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(dxf_path, "CONTEXT_ANALYSIS.dxf")
    if (OUT / "CONTEXT_ANALYSIS.dwg").exists():
        z.write(OUT / "CONTEXT_ANALYSIS.dwg", "CONTEXT_ANALYSIS.dwg")
    z.write(readme, "CAD_README.txt")
    for f in sorted((OUT / "data").glob("aerial_*")):
        z.write(f, f"data/{f.name}")
print(f"zip: {zip_path}")

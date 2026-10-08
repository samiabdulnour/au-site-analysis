#!/usr/bin/env python3
"""Building footprints with heights from Overture Maps, for one window.

    python3 overture_buildings.py <west> <south> <east> <north> [release]

Reads the buildings theme of the given release straight from Overture's
public S3 bucket with DuckDB, keeping only the row groups whose bounding
boxes touch the window, and prints one JSON object on stdout:
{"release", "count", "buildings": [{"id", "height", "floors", "class",
"subtype", "name", "geometry" (GeoJSON)}]}. Needs the duckdb wheel
(pip install duckdb); says so as {"error": ...} with exit code 2 when it
is missing, so the caller can fall back to OpenStreetMap.
"""
import json
import os
import sys
from urllib.parse import urlparse

try:
    import duckdb
except ImportError:
    print(json.dumps({"error": "duckdb is not installed"}))
    sys.exit(2)

if len(sys.argv) < 5:
    print(json.dumps({"error": "usage: overture_buildings.py west south east north [release]"}))
    sys.exit(1)

west, south, east, north = (float(v) for v in sys.argv[1:5])
release = sys.argv[5] if len(sys.argv) > 5 else os.environ.get("OVERTURE_RELEASE", "2026-09-23.1")

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")
proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
if proxy:
    u = urlparse(proxy)
    con.execute(f"SET http_proxy='{u.hostname}:{u.port}';")
    if u.username:
        con.execute(f"SET http_proxy_username='{u.username}'; SET http_proxy_password='{u.password}';")

path = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
query = f"""
    SELECT id, height, num_floors, class, subtype, names.primary AS name, ST_AsGeoJSON(geometry) AS geojson
    FROM read_parquet('{path}', hive_partitioning=1)
    WHERE bbox.xmin <= {east} AND bbox.xmax >= {west} AND bbox.ymin <= {north} AND bbox.ymax >= {south}
    """
# The scan touches the footer of every part file of the theme, a few hundred
# small requests, and one of them answered with a stray 404 or a dropped
# connection kills the whole query. DuckDB retries only 5xx, so the query is
# retried here as a whole; a file that is really missing fails three times.
rows = None
for attempt in range(3):
    try:
        rows = con.execute(query).fetchall()
        break
    except duckdb.HTTPException as e:
        if attempt == 2:
            raise
        print(f"overture scan failed ({str(e).splitlines()[0][:120]}); retrying", file=sys.stderr)

buildings = []
for id_, height, floors, cls, subtype, name, geojson in rows:
    buildings.append({
        "id": id_,
        "height": float(height) if height is not None else None,
        "floors": int(floors) if floors is not None else None,
        "class": cls,
        "subtype": subtype,
        "name": name,
        "geometry": json.loads(geojson),
    })
print(json.dumps({"release": release, "count": len(buildings), "buildings": buildings}))

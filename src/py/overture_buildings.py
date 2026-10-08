#!/usr/bin/env python3
"""Building footprints with heights from Overture Maps, for one window.

    python3 overture_buildings.py <west> <south> <east> <north> [release]

Reads the buildings theme of the given release straight from Overture's
public S3 bucket with DuckDB (its Azure mirror when the S3 scan keeps
failing), keeping only the row groups whose bounding boxes touch the
window, and prints one JSON object on stdout:
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

proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
proxy_url = urlparse(proxy) if proxy else None

select = f"""
    SELECT id, height, num_floors, class, subtype, names.primary AS name, ST_AsGeoJSON(geometry) AS geojson
    FROM read_parquet('{{path}}', hive_partitioning=1)
    WHERE bbox.xmin <= {east} AND bbox.xmax >= {west} AND bbox.ymin <= {north} AND bbox.ymax >= {south}
    """
suffix = f"release/{release}/theme=buildings/type=building/*"


def scan_s3():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';")
    if proxy_url:
        con.execute(f"SET http_proxy='{proxy_url.hostname}:{proxy_url.port}';")
        if proxy_url.username:
            con.execute(f"SET http_proxy_username='{proxy_url.username}'; SET http_proxy_password='{proxy_url.password}';")
    return con.execute(select.format(path=f"s3://overturemaps-us-west-2/{suffix}")).fetchall()


def scan_azure():
    # Overture mirrors each release on Azure. The extension's curl transport
    # reads the CA bundle from CURL_CA_BUNDLE, which a proxy that re-terminates
    # TLS sets only under the other names.
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "AWS_CA_BUNDLE"):
        if os.environ.get(var) and not os.environ.get("CURL_CA_BUNDLE"):
            os.environ["CURL_CA_BUNDLE"] = os.environ[var]
    con = duckdb.connect()
    con.execute("INSTALL azure; LOAD azure; INSTALL spatial; LOAD spatial;")
    con.execute("SET azure_transport_option_type='curl';")
    if proxy_url:
        con.execute(f"SET azure_http_proxy='http://{proxy_url.hostname}:{proxy_url.port}';")
        if proxy_url.username:
            con.execute(f"SET azure_proxy_user_name='{proxy_url.username}'; SET azure_proxy_password='{proxy_url.password}';")
    con.execute("SET azure_storage_connection_string='DefaultEndpointsProtocol=https;AccountName=overturemapswestus2;EndpointSuffix=core.windows.net';")
    return con.execute(select.format(path=f"az://{suffix}")).fetchall()


# The scan touches the footer of every part file of the theme, a few hundred
# small requests, and one of them answered with a stray 404 or a dropped
# connection kills the whole query (DuckDB retries only 5xx). So the S3 scan
# is retried as a whole, and when it keeps failing the same release is read
# from Overture's Azure mirror, a different host down a different path.
rows = None
attempts = [("s3", scan_s3), ("s3", scan_s3), ("azure", scan_azure)]
for i, (label, scan) in enumerate(attempts):
    try:
        rows = scan()
        break
    except Exception as e:
        if i == len(attempts) - 1:
            raise
        print(f"overture {label} scan failed ({str(e).splitlines()[0][:120]}); trying {attempts[i + 1][0]}", file=sys.stderr)

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

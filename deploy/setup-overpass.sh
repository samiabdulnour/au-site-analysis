#!/usr/bin/env bash
# One-time: run a LOCAL Overpass API seeded with the NSW OpenStreetMap
# extract, so trees, driveways, parking zones, bus routes and street furniture
# no longer depend on the public Overpass network (which is regularly down).
#
#   bash deploy/setup-overpass.sh
#
# Downloads ~266MB, then builds the database (30-90 min on a 2-vCPU box,
# unattended). The app keeps working from public mirrors meanwhile and
# switches over automatically once OVERPASS_LOCAL is set.
set -euo pipefail

REGION_URL="${REGION_URL:-https://download.geofabrik.de/australia-oceania/australia/new-south-wales-latest.osm.pbf}"
PORT="${OVERPASS_PORT:-12345}"
VOLUME="${OVERPASS_VOLUME:-/var/lib/overpass-nsw}"
NAME=overpass-nsw
NET="${SITE_NET:-site-net}"

echo "==> disk space check"
avail=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
if [ "$avail" -lt 12 ]; then
  echo "ERROR: need ~12GB free on / (have ${avail}GB). Free space or use a volume." >&2
  exit 1
fi

echo "==> pulling Overpass image"
docker pull wiktorn/overpass-api:latest

mkdir -p "$VOLUME"
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

echo "==> starting $NAME (first run clones the NSW extract; this takes a while)"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped \
  --network "$NET" \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL="$REGION_URL" \
  -e OVERPASS_DIFF_URL=https://download.geofabrik.de/australia-oceania/australia/new-south-wales-updates/ \
  -e OVERPASS_RULES_LOAD=10 \
  -e OVERPASS_META=no \
  -e OVERPASS_UPDATE_SLEEP=86400 \
  -v "$VOLUME:/db" \
  -p "127.0.0.1:${PORT}:80" \
  --memory 2g \
  wiktorn/overpass-api:latest

cat <<EOF

==> $NAME is initialising in the background.
    Watch progress:   docker logs -f $NAME
    It is ready when a query returns JSON:
      curl -s "http://127.0.0.1:${PORT}/api/interpreter" \\
        --data 'data=[out:json];node(-33.912,151.100,-33.910,151.104)["highway"="bus_stop"];out 2;'

    Nothing else to do: deploy/ensure-overpass.sh runs on every auto-deploy
    pass, notices the database is answering, writes

      OVERPASS_LOCAL=http://$NAME/api/interpreter

    into /etc/site-analyst.env and redeploys the app. Both containers share
    the "$NET" docker network, so the app resolves Overpass by container name.
EOF

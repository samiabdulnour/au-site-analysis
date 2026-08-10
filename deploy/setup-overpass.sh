#!/usr/bin/env bash
# One-time: run a LOCAL Overpass API seeded with a Greater Sydney OpenStreetMap
# extract, so trees, driveways, parking zones, bus routes and street furniture
# no longer depend on the public Overpass network (which is regularly down).
#
#   bash deploy/setup-overpass.sh
#
# Downloads ~54MB, then builds the database (10-20 min on a 2-vCPU box,
# unattended). The app keeps working from public mirrors meanwhile and
# switches over automatically once OVERPASS_LOCAL is set.
set -euo pipefail

# Greater Sydney (54MB), not all of NSW (253MB): the whole-state build gets
# OOM-killed on a 4GB box, and the office works in the Sydney basin. Addresses
# outside the extent still work — src/lib/http.ts falls back to the public
# mirrors — they are just slower.
#
# For NSW-wide coverage set both (needs ~8GB RAM to build):
#   REGION_URL=https://download.geofabrik.de/australia-oceania/australia/new-south-wales-latest.osm.pbf
#   DIFF_URL=https://download.geofabrik.de/australia-oceania/australia/new-south-wales-updates/
#
# Geofabrik dropped .osm.bz2 for sub-regions and this image only ingests
# bz2-compressed OSM XML, so the pbf is converted on arrival with osmium
# (OVERPASS_PLANET_PREPROCESS below). Area generation is deliberately not
# enabled: every query in src/fetch is bbox-based, none use area[…].
REGION_URL="${REGION_URL:-https://download.bbbike.org/osm/bbbike/Sydney/Sydney.osm.pbf}"
# BBBike publishes no diff stream; without it the extract is refreshed by
# re-running this script rather than updated daily in place.
DIFF_URL="${DIFF_URL:-}"
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

# init mode requires an empty database directory — leftovers from an
# interrupted run make every subsequent start fail the same way.
find "${VOLUME:?}" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true

echo "==> starting $NAME (first run clones the NSW extract; this takes a while)"
docker rm -f "$NAME" >/dev/null 2>&1 || true
# on-failure, not unless-stopped: a broken init must not churn indefinitely.
# ensure-overpass.sh promotes it to unless-stopped once it is serving.
diff_args=()
[ -n "$DIFF_URL" ] && diff_args=(-e OVERPASS_DIFF_URL="$DIFF_URL" -e OVERPASS_UPDATE_SLEEP=86400)

docker run -d --name "$NAME" --restart on-failure:3 \
  --network "$NET" \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL="$REGION_URL" \
  -e OVERPASS_PLANET_PREPROCESS='mv /db/planet.osm.bz2 /db/planet.osm.pbf && osmium cat -o /db/planet.osm.bz2 /db/planet.osm.pbf' \
  -e OVERPASS_META=no \
  "${diff_args[@]}" \
  -v "$VOLUME:/db" \
  -p "127.0.0.1:${PORT}:80" \
  --memory 3g \
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

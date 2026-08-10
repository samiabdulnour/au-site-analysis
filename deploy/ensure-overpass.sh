#!/usr/bin/env bash
# Idempotent: bring up the local NSW Overpass and wire the app to it.
#
# Run on every auto-deploy pass (from update.sh). It walks the install through
# its three states without anyone touching a terminal:
#
#   1. no container yet  -> launch setup-overpass.sh (detached; the database
#                           then builds inside the container for ~30-90 min)
#   2. container present -> keep it running and on the app's docker network
#   3. it answers queries-> write OVERPASS_LOCAL into /etc/site-analyst.env
#                           and signal update.sh to redeploy the app
#
# Exit 10 means "config changed, redeploy the app". Any other non-zero is a
# real error; the app keeps working off the public mirrors regardless.
set -uo pipefail

NAME=overpass-nsw
PORT="${OVERPASS_PORT:-12345}"
NET="${SITE_NET:-site-net}"
ENV_FILE=/etc/site-analyst.env
STATE_DIR=/var/lib/site-analyst
LOG=/var/log/site-analyst-overpass.log
# The app reaches Overpass by container name on the shared docker network —
# publishing to the host loopback is not reachable from another container.
LOCAL_URL="http://${NAME}/api/interpreter"

mkdir -p "$STATE_DIR"
say() { echo "[$(date -Is)] overpass: $*" | tee -a "$LOG"; }

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

exists=$(docker ps -a --filter "name=^/${NAME}$" --format '{{.Names}}')

# --- state 1: not installed yet -------------------------------------------
if [ -z "$exists" ]; then
  if [ -f "$STATE_DIR/overpass.launching" ]; then
    # Launched but no container: the setup script failed (usually disk space).
    # Say so once an hour instead of retrying forever in silence.
    if [ -z "$(find "$STATE_DIR/overpass.launching" -mmin +60)" ]; then exit 0; fi
    say "setup produced no container — see $LOG (most likely free disk < 12GB)"
    touch "$STATE_DIR/overpass.launching"
    exit 0
  fi
  touch "$STATE_DIR/overpass.launching"
  say "no container — launching setup (downloads the NSW extract, then builds)"
  setsid bash /opt/site-analyst/deploy/setup-overpass.sh >>"$LOG" 2>&1 &
  exit 0
fi
rm -f "$STATE_DIR/overpass.launching"

# --- state 2: installed — keep it up and on the network --------------------
running=$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)
if [ "$running" != "true" ]; then
  say "container not running — starting it"
  docker start "$NAME" >/dev/null 2>&1 || { say "could not start container"; exit 1; }
fi
docker network connect "$NET" "$NAME" >/dev/null 2>&1 || true

# --- state 3: ready? -------------------------------------------------------
probe=$(curl -s --max-time 20 "http://127.0.0.1:${PORT}/api/interpreter" \
  --data 'data=[out:json][timeout:15];node(-33.9125,151.1000,-33.9105,151.1040)["highway"="bus_stop"];out 2;' 2>/dev/null)
case "$probe" in
  \{*) ;;                                   # JSON — the database is serving
  *) say "still building (no JSON yet)"; exit 0 ;;
esac

if grep -q '^OVERPASS_LOCAL=' "$ENV_FILE" 2>/dev/null; then
  exit 0                                    # already wired up — nothing to do
fi
say "database is serving — pointing the app at $LOCAL_URL"
printf 'OVERPASS_LOCAL=%s\n' "$LOCAL_URL" >> "$ENV_FILE"
exit 10

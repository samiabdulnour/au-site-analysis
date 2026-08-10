#!/usr/bin/env bash
# Idempotent: bring up the local NSW Overpass and wire the app to it.
#
# Run on every auto-deploy pass (from update.sh). It walks the install through
# its states without anyone touching a terminal:
#
#   1. no container yet  -> launch setup-overpass.sh (detached; the database
#                           then builds inside the container for ~30-90 min)
#   2. container present -> keep it running and on the app's docker network
#   3. it answers queries-> write OVERPASS_LOCAL into /etc/site-analyst.env
#                           and signal update.sh to redeploy the app
#
# Every pass also refreshes a one-line status file that the app publishes at
# /api/version, because the host log is not reachable from anywhere else.
#
# Exit 10 means "config changed, redeploy the app". Any other non-zero is a
# real error; the app keeps working off the public mirrors regardless.
set -uo pipefail

NAME=overpass-nsw
PORT="${OVERPASS_PORT:-12345}"
NET="${SITE_NET:-site-net}"
ENV_FILE=/etc/site-analyst.env
STATE_DIR=/var/lib/site-analyst
STATUS="$STATE_DIR/overpass.status"
ATTEMPT="$STATE_DIR/overpass.attempt"
LOG=/var/log/site-analyst-overpass.log
# The app reaches Overpass by container name on the shared docker network —
# publishing to the host loopback is not reachable from another container.
LOCAL_URL="http://${NAME}/api/interpreter"

mkdir -p "$STATE_DIR"
say() { echo "[$(date -Is)] overpass: $*" | tee -a "$LOG"; }

# Short, non-sensitive status string — this is served publicly.
free_gb() { df --output=avail -BG / | tail -1 | tr -dc '0-9'; }
set_status() { printf 'disk=%sG %s\n' "$(free_gb)" "$1" > "$STATUS"; }

# Leave a breadcrumb immediately: if the status never advances past this, the
# script is running but dying early, which is not the same as never running.
set_status "pass-start"

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

exists=$(docker ps -a --filter "name=^/${NAME}$" --format '{{.Names}}')

# --- state 1: not installed yet -------------------------------------------
if [ -z "$exists" ]; then
  # Retry at most hourly: the usual cause is free disk, which someone may fix.
  if [ -f "$ATTEMPT" ] && [ -z "$(find "$ATTEMPT" -mmin +60)" ]; then
    exit 0
  fi
  avail=$(free_gb)
  if [ "$avail" -lt 12 ]; then
    set_status "setup-blocked:needs-12G"
    say "cannot install: only ${avail}G free on / (needs 12G)"
    touch "$ATTEMPT"
    exit 0
  fi
  touch "$ATTEMPT"
  set_status "installing"
  say "no container — launching setup (downloads the NSW extract, then builds)"
  # Detached, but record the outcome so a failure is visible at /api/version.
  setsid bash -c "
    if bash /opt/site-analyst/deploy/setup-overpass.sh >>'$LOG' 2>&1; then
      printf 'disk=%sG building\n' \"\$(df --output=avail -BG / | tail -1 | tr -dc '0-9')\" > '$STATUS'
    else
      printf 'disk=%sG setup-failed\n' \"\$(df --output=avail -BG / | tail -1 | tr -dc '0-9')\" > '$STATUS'
    fi" >/dev/null 2>&1 &
  exit 0
fi
rm -f "$ATTEMPT"

# --- state 2: installed — keep it up and on the network --------------------
# Report what docker actually thinks of the container. exit=137 with oom=true
# is the kernel killing the database build for memory — the one failure mode
# that no amount of retrying fixes.
read -r cstate code oom < <(docker inspect \
  -f '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$NAME" 2>/dev/null || echo '? ? ?')
if [ "$cstate" != "running" ]; then
  say "container is $cstate (exit $code, oomkilled $oom) — starting it"
  set_status "ctr=$cstate exit=$code oom=$oom"
  if ! docker start "$NAME" >/dev/null 2>&1; then
    exit 1
  fi
fi
docker network connect "$NET" "$NAME" >/dev/null 2>&1 || true

# --- state 3: ready? -------------------------------------------------------
probe=$(curl -s --max-time 20 "http://127.0.0.1:${PORT}/api/interpreter" \
  --data 'data=[out:json][timeout:15];node(-33.9125,151.1000,-33.9105,151.1040)["highway"="bus_stop"];out 2;' 2>/dev/null)
case "$probe" in
  \{*) ;;                                   # JSON — the database is serving
  *) set_status "building ctr=$cstate oom=$oom"; exit 0 ;;
esac

set_status "serving"
if grep -q '^OVERPASS_LOCAL=' "$ENV_FILE" 2>/dev/null; then
  exit 0                                    # already wired up — nothing to do
fi
say "database is serving — pointing the app at $LOCAL_URL"
printf 'OVERPASS_LOCAL=%s\n' "$LOCAL_URL" >> "$ENV_FILE"
exit 10

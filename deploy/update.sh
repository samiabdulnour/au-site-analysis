#!/usr/bin/env bash
# Auto-deploy: rebuild + restart when origin/main has new commits.
# Installed by deploy/install-autodeploy.sh; runs from cron every 5 minutes.
set -euo pipefail

# --- say what this pass did, including when it died ------------------------
#
# This ran blind for six days once. An expired credential made `git fetch` fail
# on the first command, `set -e` ended the pass there, and nothing downstream
# wrote anything — so /api/version went on serving the domain and Overpass
# lines earlier passes had left behind, looking exactly like a healthy server,
# while every five minutes another identical `fatal:` went into a log on a host
# nobody had logged into for a fortnight. A deployer that cannot report its own
# death is a deployer nobody notices has died.
#
# A trap rather than a line at the end, because `set -e` exits from wherever
# the failure is and where it got to is the thing worth knowing. The timestamp
# matters as much as the text: "up-to-date" from a deployer that stopped
# running last week reads no differently from one that ran a minute ago.
STATUS_DIR=/var/lib/site-analyst
mkdir -p "$STATUS_DIR"
STAGE=start
on_exit() {
  rc=$?
  # UTC and no offset: the app strips punctuation from this before publishing
  # it, and a +00:00 would come out the other side as digits run together.
  when=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  {
    if [ "$rc" -eq 0 ]; then printf '%s %s\n' "$STAGE" "$when"
    else printf 'FAILED %s rc=%s %s\n' "$STAGE" "$rc" "$when"
    fi
  } > "$STATUS_DIR/deploy.status" 2>/dev/null || true
}
trap on_exit EXIT

cd /opt/site-analyst

FORCE=""
[ "${1:-}" = "--force" ] && FORCE=1

STAGE=fetch
git fetch origin main --quiet

# The real domain in front of the app. Idempotent, and a no-op on any host
# where Caddy is not what is answering.
STAGE=domain
if [ -f deploy/ensure-domain.sh ]; then
  chmod +x deploy/ensure-domain.sh
  deploy/ensure-domain.sh || true
fi

# Local Overpass: install it, keep it up, and switch the app over once its
# database is serving. Exit 10 = it just changed the env, so redeploy now.
STAGE=overpass
if [ -f deploy/ensure-overpass.sh ]; then
  chmod +x deploy/ensure-overpass.sh
  rc=0; deploy/ensure-overpass.sh || rc=$?
  if [ "$rc" = 10 ]; then FORCE=1; fi
fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ -z "$FORCE" ] && [ "$LOCAL" = "$REMOTE" ]; then
  STAGE="up-to-date ${LOCAL:0:9}"
  exit 0
fi

# Do not cut the ground out from under a running job — a sheet takes 1-3
# minutes and the queue is in memory, so replacing the container loses it.
# Wait for a quiet moment, but not forever: after ~30 minutes deploy anyway.
DEFER=/var/lib/site-analyst/deploy.deferred
if curl -sf --max-time 5 http://127.0.0.1:3100/api/version 2>/dev/null | grep -q '"busy":true'; then
  n=$(( $(cat "$DEFER" 2>/dev/null || echo 0) + 1 ))
  if [ "$n" -le 6 ]; then
    echo "$n" > "$DEFER"
    echo "[$(date -Is)] job in progress — deferring deploy (${n}/6)"
    STAGE="deferred ${n}/6"
    exit 0
  fi
  echo "[$(date -Is)] job still in progress after ${n} passes — deploying anyway"
fi
rm -f "$DEFER"

echo "[$(date -Is)] deploying ${REMOTE:0:9} (was ${LOCAL:0:9})"
git reset --hard origin/main --quiet

# Secrets live outside the repo.
set -a; . /etc/site-analyst.env; set +a

NET="${SITE_NET:-site-net}"
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

# Generated sheets and the OSM disk cache live on the host, not inside the
# container. Without this every pass through here threw away both: the PDF a
# visitor was seconds from downloading, and the cached Overpass answers that
# are what keep sheets generating while Overpass is down. A deploy is not
# supposed to cost anybody their drawing.
OUT="${SITE_OUT:-/var/lib/site-analyst/out}"
mkdir -p "$OUT"

STAGE="build ${REMOTE:0:9}"
docker build -q --build-arg GIT_SHA="$REMOTE" -t site-analyst .
STAGE="run ${REMOTE:0:9}"
docker rm -f site-analyst >/dev/null 2>&1 || true
docker run -d --name site-analyst --restart unless-stopped \
  --network "$NET" \
  -p 127.0.0.1:3100:3000 \
  -e ACCESS_CODE="$ACCESS_CODE" \
  # ADMIN_CODE opens /status, and nothing else does. Unset, the ops view has
  # no code that opens it.
  -e ADMIN_CODE="${ADMIN_CODE:-}" \
  -e TFNSW_API_KEY="$TFNSW_API_KEY" \
  -e OVERPASS_LOCAL="${OVERPASS_LOCAL:-}" \
  -e WEB_OUT_BUDGET_MB="${WEB_OUT_BUDGET_MB:-4096}" \
  -v /var/lib/site-analyst:/hostinfo:ro \
  -v "$OUT":/app/out \
  site-analyst >/dev/null
# Health gate: report what actually came up, rather than assuming it did.
STAGE="health ${REMOTE:0:9}"
for _ in $(seq 1 30); do
  live=$(curl -sf --max-time 3 http://127.0.0.1:3100/api/version 2>/dev/null || true)
  case "$live" in *"${REMOTE:0:9}"*) break;; esac
  sleep 2
done
case "$live" in
  *"${REMOTE:0:9}"*) echo "[$(date -Is)] healthy on ${REMOTE:0:9}"
     STAGE="deployed ${REMOTE:0:9}";;
  # The pass carries on to the prune and exits 0, so without this the status
  # would say "deployed" about a container that never answered.
  *) echo "[$(date -Is)] WARNING: ${REMOTE:0:9} did not answer /api/version within 60s"
     STAGE="unhealthy ${REMOTE:0:9}"
     docker logs --tail 20 site-analyst 2>&1 | tail -20;;
esac

docker image prune -f >/dev/null
# The layer cache grows with every deploy and `image prune` does not touch it;
# on a 40GB disk it is what eventually starves the Overpass database.
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
echo "[$(date -Is)] deployed ${REMOTE:0:9}"

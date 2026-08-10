#!/usr/bin/env bash
# Auto-deploy: rebuild + restart when origin/main has new commits.
# Installed by deploy/install-autodeploy.sh; runs from cron every 5 minutes.
set -euo pipefail
cd /opt/site-analyst

FORCE=""
[ "${1:-}" = "--force" ] && FORCE=1

git fetch origin main --quiet

# Local Overpass: install it, keep it up, and switch the app over once its
# database is serving. Exit 10 = it just changed the env, so redeploy now.
if [ -f deploy/ensure-overpass.sh ]; then
  chmod +x deploy/ensure-overpass.sh
  rc=0; deploy/ensure-overpass.sh || rc=$?
  if [ "$rc" = 10 ]; then FORCE=1; fi
fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ -z "$FORCE" ] && [ "$LOCAL" = "$REMOTE" ] && exit 0

# Do not cut the ground out from under a running job — a sheet takes 1-3
# minutes and the queue is in memory, so replacing the container loses it.
# Wait for a quiet moment, but not forever: after ~30 minutes deploy anyway.
DEFER=/var/lib/site-analyst/deploy.deferred
if curl -sf --max-time 5 http://127.0.0.1:3100/api/version 2>/dev/null | grep -q '"busy":true'; then
  n=$(( $(cat "$DEFER" 2>/dev/null || echo 0) + 1 ))
  if [ "$n" -le 6 ]; then
    echo "$n" > "$DEFER"
    echo "[$(date -Is)] job in progress — deferring deploy (${n}/6)"
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

docker build -q --build-arg GIT_SHA="$REMOTE" -t site-analyst .
docker rm -f site-analyst >/dev/null 2>&1 || true
docker run -d --name site-analyst --restart unless-stopped \
  --network "$NET" \
  -p 127.0.0.1:3100:3000 \
  -e ACCESS_CODE="$ACCESS_CODE" \
  -e TFNSW_API_KEY="$TFNSW_API_KEY" \
  -e OVERPASS_LOCAL="${OVERPASS_LOCAL:-}" \
  -v /var/lib/site-analyst:/hostinfo:ro \
  site-analyst >/dev/null
# Health gate: report what actually came up, rather than assuming it did.
for _ in $(seq 1 30); do
  live=$(curl -sf --max-time 3 http://127.0.0.1:3100/api/version 2>/dev/null || true)
  case "$live" in *"${REMOTE:0:9}"*) break;; esac
  sleep 2
done
case "$live" in
  *"${REMOTE:0:9}"*) echo "[$(date -Is)] healthy on ${REMOTE:0:9}";;
  *) echo "[$(date -Is)] WARNING: ${REMOTE:0:9} did not answer /api/version within 60s";
     docker logs --tail 20 site-analyst 2>&1 | tail -20;;
esac

docker image prune -f >/dev/null
# The layer cache grows with every deploy and `image prune` does not touch it;
# on a 40GB disk it is what eventually starves the Overpass database.
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
echo "[$(date -Is)] deployed ${REMOTE:0:9}"

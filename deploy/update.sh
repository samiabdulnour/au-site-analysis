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
  site-analyst >/dev/null
docker image prune -f >/dev/null
echo "[$(date -Is)] deployed ${REMOTE:0:9}"

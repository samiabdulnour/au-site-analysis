#!/usr/bin/env bash
# Auto-deploy: rebuild + restart when origin/main has new commits.
# Installed by deploy/install-autodeploy.sh; runs from cron every 5 minutes.
set -euo pipefail
cd /opt/site-analyst

FORCE=""
[ "${1:-}" = "--force" ] && FORCE=1

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ -z "$FORCE" ] && [ "$LOCAL" = "$REMOTE" ] && exit 0

echo "[$(date -Is)] deploying ${REMOTE:0:9} (was ${LOCAL:0:9})"
git reset --hard origin/main --quiet

# Secrets live outside the repo.
set -a; . /etc/site-analyst.env; set +a

docker build -q --build-arg GIT_SHA="$REMOTE" -t site-analyst .
docker rm -f site-analyst >/dev/null 2>&1 || true
docker run -d --name site-analyst --restart unless-stopped \
  -p 127.0.0.1:3100:3000 \
  -e ACCESS_CODE="$ACCESS_CODE" \
  -e TFNSW_API_KEY="$TFNSW_API_KEY" \
  -e OVERPASS_LOCAL="${OVERPASS_LOCAL:-}" \
  --add-host host.docker.internal:host-gateway \
  site-analyst >/dev/null
docker image prune -f >/dev/null
echo "[$(date -Is)] deployed ${REMOTE:0:9}"

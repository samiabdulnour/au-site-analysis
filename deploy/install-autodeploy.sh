#!/usr/bin/env bash
# One-time setup on the server: captures the running container's secrets,
# installs the cron-based auto-deployer, and deploys the latest main now.
set -euo pipefail

# 1. Secrets file from the running container (or keep an existing one)
if [ ! -f /etc/site-analyst.env ]; then
  ACCESS_CODE=$(docker inspect site-analyst --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ACCESS_CODE=' | cut -d= -f2-)
  TFNSW_API_KEY=$(docker inspect site-analyst --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^TFNSW_API_KEY=' | cut -d= -f2-)
  printf 'ACCESS_CODE=%s\nTFNSW_API_KEY=%s\n' "$ACCESS_CODE" "$TFNSW_API_KEY" > /etc/site-analyst.env
  chmod 600 /etc/site-analyst.env
  echo "wrote /etc/site-analyst.env"
fi

# 2. Cron: check origin/main every 5 minutes
chmod +x /opt/site-analyst/deploy/update.sh
cat > /etc/cron.d/site-analyst-deploy <<'EOF'
*/5 * * * * root /opt/site-analyst/deploy/update.sh >> /var/log/site-analyst-deploy.log 2>&1
EOF
chmod 644 /etc/cron.d/site-analyst-deploy
echo "auto-deploy installed (checks origin/main every 5 minutes)"

# 3. Deploy whatever is on main right now
/opt/site-analyst/deploy/update.sh || true
echo "current version: $(curl -s http://127.0.0.1:3100/api/version || echo unknown)"

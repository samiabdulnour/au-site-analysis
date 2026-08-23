#!/usr/bin/env bash
# Put the real domain in front of the app.
#
# Runs from the auto-deployer on every pass, so it has to be safe to run
# forever: once the Caddyfile names the domain it does nothing at all. There
# is no shell access to this host from where the change is written, so the
# script has to be its own operator — it backs the config up, validates the
# edit before asking Caddy to load it, and puts the old file back if either
# step fails. Whatever happened is written to a status file that the app
# publishes on /api/version, which is the only way to see the result.
#
# DNS has to point at this host first. Caddy asks Let's Encrypt for the
# certificate on the first request for the name, and that only works once
# the A record resolves here and port 80 is reachable.
set -uo pipefail

DOMAIN="${SITE_DOMAIN:-site-analyst.com}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
UPSTREAM="${SITE_UPSTREAM:-127.0.0.1:3100}"
STATUS_DIR=/var/lib/site-analyst
STATUS="$STATUS_DIR/domain.status"

mkdir -p "$STATUS_DIR"
set_status() { echo "$1" > "$STATUS"; }

command -v caddy >/dev/null 2>&1 || { set_status "no-caddy"; exit 0; }
[ -f "$CADDYFILE" ] || { set_status "no-caddyfile"; exit 0; }

# Already done — the common case, every five minutes, forever.
if grep -qE "^[[:space:]]*(www\.)?${DOMAIN//./\\.}[[:space:],{]" "$CADDYFILE"; then
  set_status "serving $DOMAIN"
  exit 0
fi

BACKUP="$CADDYFILE.before-$DOMAIN.$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$CADDYFILE" "$BACKUP" || { set_status "backup-failed"; exit 0; }

# Appended, never rewritten: whatever already serves this host — the sslip.io
# name it was reached by until now — keeps working alongside the new name.
cat >> "$CADDYFILE" <<EOF

# --- added by deploy/ensure-domain.sh ---
www.${DOMAIN} {
	redir https://${DOMAIN}{uri} permanent
}

${DOMAIN} {
	reverse_proxy ${UPSTREAM}
}
EOF

restore() {
  cp -a "$BACKUP" "$CADDYFILE"
  systemctl reload caddy >/dev/null 2>&1 || true
  set_status "$1"
  exit 0
}

caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1 \
  || restore "invalid-config-rolled-back"
systemctl reload caddy >/dev/null 2>&1 \
  || restore "reload-failed-rolled-back"

set_status "added $DOMAIN"

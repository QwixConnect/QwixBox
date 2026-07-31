#!/usr/bin/env bash
### Deploy the Hono API: dependencies, Drizzle migrations, systemd unit.
###
# step-inputs: resources/conf/api
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/api"

SRC="$REPO_DIR/portal/api"
[ -d "$SRC" ] || die "No API source at $SRC."
command -v bun >/dev/null || die "Bun is not installed - run 40-bun.sh first."

### --- Service account ----------------------------------------------------------------------

### A dedicated unprivileged account with no login shell. The API talks to Postgres and
### FreeSWITCH's ESL; it has no reason to be able to log in.
if ! id -u "$API_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$API_DIR" --shell /usr/sbin/nologin \
    --gecos "Qwixbox API" "$API_USER"
  info "Created service account: $API_USER"
fi

### --- Code ---------------------------------------------------------------------------------

install -d -m 0750 -o "$API_USER" -g "$API_USER" "$API_DIR"

### node_modules is rebuilt from the lockfile on the target, so excluding it keeps the copy
### fast and avoids shipping a macOS-built esbuild binary to a Linux server.
rsync -a --delete \
  --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  "$SRC/" "$API_DIR/"
chown -R "$API_USER:$API_USER" "$API_DIR"
ok "Source synced to $API_DIR"

### --- Environment ----------------------------------------------------------------------------

### ENCRYPTION_KEY is kept distinct from AUTH_SECRET on purpose: rotating a session secret
### should not make every stored SIP password undecryptable. Both are generated once and
### persist in config.env - config_ensure_secret never rotates an existing value.
config_ensure_secret ENCRYPTION_KEY 48
config_ensure_secret AUTH_SECRET 48
config_ensure_secret FS_XML_GATEWAY_SECRET 32

### Secrets live in a root-owned file the service can read but not modify, rather than being
### baked into the unit where they would show up in `systemctl show`.
deploy_template "$TPL/env" "$API_DIR/.env" 0640 "root:$API_USER" || true

### --- Dependencies and migrations ---------------------------------------------------------

info "Installing dependencies"
bun_as "$API_USER" "$API_DIR" bun install --frozen-lockfile --production \
  || bun_as "$API_USER" "$API_DIR" bun install \
  || die "bun install failed."

if grep -q '"drizzle-kit"' "$API_DIR/package.json" 2>/dev/null && [ -f "$API_DIR/drizzle.config.ts" ]; then
  info "Applying database migrations"
  ### Migrations are the one step that can leave the database half-changed, so a failure here
  ### stops the deploy rather than starting an API against a schema it does not match.
  bun_as "$API_USER" "$API_DIR" bunx drizzle-kit push --force \
    || die "Database migration failed - not starting the API against a mismatched schema."
  ok "Migrations applied"
fi

### --- Service --------------------------------------------------------------------------------

### The API also runs on media nodes (for the mod_xml_curl call path), where Postgres and
### Redis are not installed. A hard Requires= there would fail the unit on every boot, so the
### local-database ordering is only declared when this host actually is the database.
if has_role db; then
  api_after="network-online.target postgresql.service redis-server.service"
  api_requires="Requires=postgresql.service"
else
  # shellcheck disable=SC2034  # read by name from the template
  api_after="network-online.target"
  # shellcheck disable=SC2034  # read by name from the template
  api_requires="# database is remote - no local ordering dependency"
fi

### Must match the default in 31-freeswitch-config.sh: FreeSWITCH writes faxes there and the
### unit's ReadWritePaths has to cover the same directory.
# shellcheck disable=SC2034  # read by name from the template
FAX_SPOOL="${FAX_SPOOL:-/var/spool/qwixbox-fax}"

### Determine the entrypoint: package.json start script wins, else a conventional filename.
ENTRY="server.ts"
for candidate in server.ts src/index.ts index.ts; do
  [ -f "$API_DIR/$candidate" ] && ENTRY="$candidate" && break
done
info "Entrypoint: $ENTRY"

deploy_template "$TPL/qwixbox-api.service" /etc/systemd/system/qwixbox-api.service 0644 || true

systemctl daemon-reload
enable_service qwixbox-api
restart_service qwixbox-api

sleep 3
if ss -ltn 2>/dev/null | grep -q ":${API_PORT}"; then
  ok "API listening on 127.0.0.1:${API_PORT}"
else
  warn "Nothing listening on ${API_PORT} yet - check: journalctl -u qwixbox-api -n 50"
fi

ok "API deployed"

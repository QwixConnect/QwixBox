#!/usr/bin/env bash
# Hono API build, Drizzle push, systemd unit, secrets.
# step-inputs: resources/conf/api portal/api
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/api"

SRC="$REPO_DIR/portal/api"
[ -d "$SRC" ] || die "No API source at $SRC."
command -v bun >/dev/null || die "Bun is not installed - run 40-bun.sh first."

if ! id -u "$API_USER" >/dev/null 2>&1; then
  adduser --system --group --home "$API_DIR" --shell /usr/sbin/nologin \
    --gecos "QwixBox API" "$API_USER"
  info "Created service account: $API_USER"
fi

if getent group kamailio >/dev/null 2>&1; then
  if ! id -nG "$API_USER" 2>/dev/null | tr ' ' '\n' | grep -qx kamailio; then
    usermod -a -G kamailio "$API_USER"
    info "Added $API_USER to the kamailio group (for kamcmd reloads)"
  fi
fi

if getent group qwixbox-fax >/dev/null 2>&1; then
  usermod -a -G qwixbox-fax "$API_USER"
fi

install -d -m 0750 -o "$API_USER" -g "$API_USER" "$API_DIR"

rsync -a --delete \
  --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  "$SRC/" "$API_DIR/"
chown -R "$API_USER:$API_USER" "$API_DIR"
ok "Source synced to $API_DIR"

config_ensure_secret ENCRYPTION_KEY 48
config_ensure_secret AUTH_SECRET 48
config_ensure_secret FS_XML_GATEWAY_SECRET 32

# shellcheck disable=SC2034  # read by name from the template
STIR_SIGNING="$(stir_signing_ready)"
deploy_template "$TPL/env" "$API_DIR/.env" 0640 "root:$API_USER" || true

apt_install pcre2-utils

PRE_UPGRADE_DIR="${BACKUP_DIR:-/var/backups/qwixbox}/pre-upgrade"
PRE_UPGRADE_KEEP=5
DESTRUCTIVE_DDL='\b(DROP (TABLE|COLUMN|TYPE|SCHEMA)|TRUNCATE|DELETE FROM|SET DATA TYPE)\b'

# The database as it was before this upgrade touched it, for docs/rollback.md (I14). Taken before
# check-schema-tables, which drops retired tables.
pre_upgrade_dump() {
  local stamp out dumps
  stamp="$(date +%Y%m%d-%H%M%S)"
  out="$PRE_UPGRADE_DIR/qwixbox-$stamp.dump"
  install -d -m 0700 -o root -g root "$PRE_UPGRADE_DIR"
  (umask 077 && su - postgres -c "pg_dump -Fc qwixbox" >"$out.partial") \
    || die "Could not dump the qwixbox database before upgrading - nothing has been changed."
  mv "$out.partial" "$out"
  mapfile -t dumps < <(ls -1t "$PRE_UPGRADE_DIR"/qwixbox-*.dump)
  rm -f -- "${dumps[@]:PRE_UPGRADE_KEEP}"
  ok "Pre-upgrade dump: $out"
}

# `drizzle-kit push --force` applies whatever the diff says, a dropped column or a narrowed type
# included, with no confirmation (I14). So push to a copy first, read what it ran, and refuse a
# data-losing statement unless this run was told to accept it. A push that fails on the copy
# stops here, before production is touched.
rehearse_schema_push() {
  local copy=qwixbox_preflight log destructive
  log="/var/log/qwixbox/schema-preflight-$(date +%Y%m%d-%H%M%S).log"
  su - postgres -c "dropdb --if-exists $copy && createdb -O '$API_USER' $copy \
    && pg_dump qwixbox | psql -q -v ON_ERROR_STOP=1 $copy" >/dev/null \
    || die "Could not copy the qwixbox database for a schema rehearsal - nothing has been changed."
  local status=0
  (umask 077 && DATABASE_URL="postgres://$API_USER:$API_DB_PASSWORD@$DB_HOST:$DB_PORT/$copy" \
    bun_as "$API_USER" "$API_DIR" bun run db:push --force >"$log" 2>&1) || status=$?
  su - postgres -c "dropdb --if-exists $copy" >/dev/null || warn "Could not drop $copy."
  [ "$status" -eq 0 ] || die "The schema push failed on a copy of the database (see $log) - production is unchanged."
  destructive="$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -iE "$DESTRUCTIVE_DDL" || true)"
  [ -z "$destructive" ] && { ok "Schema rehearsed on a copy: no data-losing statements ($log)"; return; }
  printf '%s\n' "$destructive" | sed 's/^/     /' >&2
  [ "${SCHEMA_ACCEPT_DESTRUCTIVE:-0}" = 1 ] \
    || die "This upgrade's schema push would destroy data (above, full log $log). Restore from $PRE_UPGRADE_DIR if needed, and re-run with SCHEMA_ACCEPT_DESTRUCTIVE=1 to accept it for this run."
  warn "Applying data-losing schema changes because SCHEMA_ACCEPT_DESTRUCTIVE=1."
}

info "Installing dependencies"
bun_as "$API_USER" "$API_DIR" bun install --frozen-lockfile \
  || die "bun install failed."

if grep -q '"drizzle-kit"' "$API_DIR/package.json" 2>/dev/null && [ -f "$API_DIR/drizzle.config.ts" ]; then
  bun_as "$API_USER" "$API_DIR" bun run src/cli/check-did-ownership.ts \
    || die "Duplicate DID ownership must be resolved before applying this upgrade."
  if has_role db; then
    pre_upgrade_dump
  else
    warn "Database is remote: no pre-upgrade dump or schema rehearsal. Take a backup before upgrading."
  fi
  bun_as "$API_USER" "$API_DIR" bun run src/cli/check-schema-tables.ts \
    || die "Unknown tables would make the schema push prompt or drop data. See the message above."
  if has_role db; then rehearse_schema_push; fi
  info "Applying database migrations"
  bun_as "$API_USER" "$API_DIR" bun run db:push --force \
    || die "Database migration failed - not starting the API against a mismatched schema."
  bun_as "$API_USER" "$API_DIR" bun run src/cli/check-route-patterns.ts \
    || die "Outbound pattern audit failed. Review legacy routes before starting this upgrade."
  # Kamailio's emergency exemption is projected from the routes (I02); an older install has none.
  bun_as "$API_USER" "$API_DIR" bun run src/cli/project-emergency.ts \
    || die "Could not queue the emergency pattern projection - emergency calls would meet the capacity check."
  # Warns only: duplicates predate I19 and both XML tiers resolve them the same way.
  bun_as "$API_USER" "$API_DIR" bun run src/cli/check-dialable-numbers.ts \
    || warn "Could not audit dialable numbers for duplicates."
  ok "Migrations applied"
fi

if has_role db; then
  api_after="network-online.target postgresql.service redis-server.service"
  api_requires="Requires=postgresql.service"
else
  # shellcheck disable=SC2034  # read by name from the template
  api_after="network-online.target"
  # shellcheck disable=SC2034  # read by name from the template
  api_requires="# database is remote - no local ordering dependency"
fi

# shellcheck disable=SC2034  # read by name from the template
FAX_SPOOL="${FAX_SPOOL:-/var/spool/qwixbox-fax}"

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

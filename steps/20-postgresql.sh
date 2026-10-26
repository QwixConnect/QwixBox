#!/usr/bin/env bash
# PostgreSQL from PGDG, pg_hba, tuning, WAL/backup prep.
# step-inputs: resources/conf/postgresql
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/postgresql"

PG_VERSION="${PG_VERSION:-18}"

codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
apt_add_repo "pgdg" \
  "https://www.postgresql.org/media/keys/ACCC4CF8.asc" \
  "https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main"

apt_install "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}" postgresql-common

CLUSTER_DIR="/etc/postgresql/${PG_VERSION}/main"
[ -d "$CLUSTER_DIR" ] || die "Expected cluster config at $CLUSTER_DIR - is postgresql-${PG_VERSION} installed?"

if is_all_in_one; then
  pg_listen="localhost"
else
  pg_listen="localhost,$(internal_bind_addr)"
fi

mem_mb="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
shared_buffers=$(( mem_mb / 4 ))
# shellcheck disable=SC2034  # read by name from the template
effective_cache=$(( mem_mb / 2 ))
maint_work_mem=$(( mem_mb / 16 ))
[ "$maint_work_mem" -gt 2048 ] && maint_work_mem=2048
[ "$shared_buffers" -lt 128 ] && shared_buffers=128

install -d -m 0755 -o postgres -g postgres "${CLUSTER_DIR}/conf.d"

deploy_template "$TPL/90-qwixbox.conf" "${CLUSTER_DIR}/conf.d/90-qwixbox.conf" 0644 postgres:postgres || true

if is_all_in_one; then
  pg_hba_internal="# (all-in-one: no off-host access)"
else
  # shellcheck disable=SC2034  # read by name from the template
  pg_hba_internal="host    all             all             ${INTERNAL_CIDR}            scram-sha-256"
fi

deploy_template "$TPL/pg_hba.conf" "${CLUSTER_DIR}/pg_hba.conf" 0640 postgres:postgres || true

systemctl enable postgresql >/dev/null 2>&1 || true
if systemctl list-unit-files | grep -q "postgresql@${PG_VERSION}-main"; then
  restart_service "postgresql@${PG_VERSION}-main"
else
  restart_service postgresql
fi

config_ensure_secret PG_SUPERUSER_PASSWORD 32
printf 'ALTER ROLE postgres WITH PASSWORD %s;\n' "$(sql_literal "$PG_SUPERUSER_PASSWORD")" | psql_secret
ok "Superuser password set (for TCP admin tools such as kamdbctl)"

# Earlier releases set role passwords with `psql -c` under log_statement = 'ddl', which wrote them
# into this log in plain text (I14). Redact what is left, rewriting in place: the postmaster
# appends to the open file, and replacing the inode (sed -i) would leave it logging into a deleted
# one. dd with nocreat, because the directory is sticky and fs.protected_regular refuses even root
# an O_CREAT open (which `>` is) of a file postgres owns there.
for pg_log in /var/log/postgresql/postgresql-*.log*; do
  [ -f "$pg_log" ] || continue
  case "$pg_log" in
    *.gz) reader=(zcat) finder=(zgrep) ;;
    *) reader=(cat) finder=(grep) ;;
  esac
  "${finder[@]}" -qE "PASSWORD '[^[]" "$pg_log" || continue
  redacted=$(mktemp)
  "${reader[@]}" "$pg_log" | sed -E "s/(PASSWORD )'([^']|'')*'/\1'[redacted]'/g" >"$redacted"
  if [ "${reader[0]}" = zcat ]; then gzip -c "$redacted"; else cat "$redacted"; fi |
    dd of="$pg_log" conv=nocreat status=none
  rm -f "$redacted"
  warn "Redacted role passwords logged by an earlier release from $pg_log"
done

su - postgres -c "psql -tAc 'SELECT version()'" | sed 's/^/  /'
ok "PostgreSQL ${PG_VERSION} ready (listening on ${pg_listen}, shared_buffers=${shared_buffers}MB)"

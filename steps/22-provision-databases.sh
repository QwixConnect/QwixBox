#!/usr/bin/env bash
# Roles and databases for Kamailio and the API, least privilege.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

command -v psql >/dev/null || die "PostgreSQL is not installed - run 20-postgresql.sh first."
systemctl is-active --quiet postgresql || die "PostgreSQL is not running."

config_ensure_secret KAMAILIO_DB_PASSWORD 32
config_ensure_secret KAMAILIO_RO_DB_PASSWORD 32
config_ensure_secret API_DB_PASSWORD 32

create_role() {
  local role="$1" password="$2"
  if pg_role_exists "$role"; then
    ok "Role already exists: $role"
  else
    printf 'CREATE ROLE "%s" LOGIN PASSWORD %s;\n' "$role" "$(sql_literal "$password")" | psql_secret
    info "Created role: $role"
  fi
  printf 'ALTER ROLE "%s" WITH LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE;\n' \
    "$role" "$(sql_literal "$password")" | psql_secret
}

create_db() {
  local db="$1" owner="$2"
  if pg_db_exists "$db"; then
    ok "Database already exists: $db"
  else
    su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE DATABASE \\\"${db}\\\" OWNER \\\"${owner}\\\" ENCODING 'UTF8'\"" >/dev/null
    info "Created database: $db (owner $owner)"
  fi
}

create_role "kamailio"    "$KAMAILIO_DB_PASSWORD"
create_role "kamailioro"  "$KAMAILIO_RO_DB_PASSWORD"
create_role "$API_USER"   "$API_DB_PASSWORD"

create_db "kamailio" "kamailio"
create_db "qwixbox"  "$API_USER"

for db in kamailio qwixbox; do
  su - postgres -c "psql -v ON_ERROR_STOP=1 -d ${db} -c \"REVOKE ALL ON SCHEMA public FROM PUBLIC\"" >/dev/null
  su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"REVOKE ALL ON DATABASE \\\"${db}\\\" FROM PUBLIC\"" >/dev/null
done

su - postgres -c "psql -v ON_ERROR_STOP=1 -d kamailio -c \"GRANT ALL ON SCHEMA public TO kamailio\"" >/dev/null
su - postgres -c "psql -v ON_ERROR_STOP=1 -d qwixbox  -c \"GRANT ALL ON SCHEMA public TO \\\"${API_USER}\\\"\"" >/dev/null

su - postgres -c "psql -v ON_ERROR_STOP=1 -d kamailio -c \"GRANT CONNECT ON DATABASE kamailio TO kamailioro\"" >/dev/null
su - postgres -c "psql -v ON_ERROR_STOP=1 -d kamailio -c \"GRANT USAGE ON SCHEMA public TO kamailioro\"" >/dev/null
su - postgres -c "psql -v ON_ERROR_STOP=1 -d kamailio -c \"GRANT SELECT ON ALL TABLES IN SCHEMA public TO kamailioro\"" >/dev/null
su - postgres -c "psql -v ON_ERROR_STOP=1 -d kamailio -c \"ALTER DEFAULT PRIVILEGES FOR ROLE kamailio IN SCHEMA public GRANT SELECT ON TABLES TO kamailioro\"" >/dev/null

check_login() {
  local role="$1" pass="$2" db="$3"
  if PGPASSWORD="$pass" psql -h 127.0.0.1 -U "$role" -d "$db" -tAc 'SELECT 1' >/dev/null 2>&1; then
    ok "Login verified: ${role}@${db}"
  else
    die "Cannot log in as ${role} to ${db} - check pg_hba.conf."
  fi
}

check_login kamailio   "$KAMAILIO_DB_PASSWORD"    kamailio
check_login kamailioro "$KAMAILIO_RO_DB_PASSWORD" kamailio
check_login "$API_USER" "$API_DB_PASSWORD"        qwixbox

ok "Databases provisioned"

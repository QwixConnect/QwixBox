#!/usr/bin/env bash
# Registrar, multi-tenant routing, WebRTC/WSS, dispatcher, schema. Deliberately conservative:
# number translation and trunking are business logic and live in FreeSWITCH.
# step-inputs: resources/conf/kamailio
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

command -v kamailio >/dev/null || die "Kamailio is not installed - run 32-kamailio.sh first."
pg_db_exists kamailio || die "The kamailio database does not exist - run 22-provision-databases.sh first."

TPL="$REPO_DIR/resources/conf/kamailio"

KAM_MPATH="$(dirname "$(find /usr/lib -name 'tm.so' -path '*kamailio*' 2>/dev/null | head -1)")"
if [ -z "$KAM_MPATH" ] || [ "$KAM_MPATH" = "." ]; then
  KAM_MPATH="/usr/lib/x86_64-linux-gnu/kamailio/modules"
  warn "Could not locate the Kamailio module directory - assuming $KAM_MPATH"
fi

deploy_template "$TPL/kamctlrc" /etc/kamailio/kamctlrc 0640 root:kamailio || true

if su - postgres -c "psql -tAc \"SELECT to_regclass('public.subscriber')\" kamailio" | grep -q subscriber; then
  ok "Kamailio schema already present"
else
  SCHEMA_DIR="/usr/share/kamailio/postgres"
  [ -d "$SCHEMA_DIR" ] || die "Kamailio schema files not found at $SCHEMA_DIR"

  KAM_SCHEMAS="standard auth_db usrloc domain permissions dispatcher dialog acc"

  info "Applying the Kamailio schema"
  for schema in $KAM_SCHEMAS; do
    f="$SCHEMA_DIR/${schema}-create.sql"
    if [ ! -f "$f" ]; then
      warn "  no schema file for ${schema} - skipping"
      continue
    fi
    if su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d kamailio -f '$f'" >/dev/null 2>&1; then
      info "  ${schema}"
    else
      die "Failed applying ${schema} schema. Run: su - postgres -c \"psql -d kamailio -f $f\""
    fi
  done

  su - postgres -c "psql -q -d kamailio -c \
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO kamailio;
     GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO kamailio;
     GRANT SELECT ON ALL TABLES IN SCHEMA public TO kamailioro;'" >/dev/null

  ok "Schema applied"
fi

ACC_EXTRA_COLS="src_user VARCHAR(64)|src_domain VARCHAR(128)|dst_user VARCHAR(64)|dst_domain VARCHAR(128)|src_ip VARCHAR(64)|dialog_id VARCHAR(64)"

acc_sql=""
IFS='|' read -ra _cols <<< "$ACC_EXTRA_COLS"
for col in "${_cols[@]}"; do
  for tbl in acc missed_calls; do
    acc_sql="${acc_sql}ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col} NOT NULL DEFAULT '';"
  done
done
acc_sql="${acc_sql}CREATE INDEX IF NOT EXISTS acc_time_idx ON acc (time);"
acc_sql="${acc_sql}CREATE INDEX IF NOT EXISTS acc_callid_idx ON acc (callid);"

if su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d kamailio -c \"${acc_sql}\"" >/dev/null 2>&1; then
  ok "Accounting columns present (acc, missed_calls)"
else
  die "Failed adding the acc db_extra columns - accounting would fail on every call."
fi

# Emergency route patterns, written by the API and loaded by htable as `emergency=><domain>[i]`
# (I02). Outside the schema guard so an existing install gets it. htable's column layout, plus
# the organization that owns each row; the version row is what htable checks before loading.
emergency_sql="CREATE TABLE IF NOT EXISTS emergency_pattern (
    id SERIAL PRIMARY KEY NOT NULL,
    key_name VARCHAR(256) DEFAULT '' NOT NULL,
    key_type INTEGER DEFAULT 1 NOT NULL,
    value_type INTEGER DEFAULT 0 NOT NULL,
    key_value VARCHAR(512) DEFAULT '' NOT NULL,
    expires INTEGER DEFAULT 0 NOT NULL,
    organization_id TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS emergency_pattern_org_idx ON emergency_pattern (organization_id);
  INSERT INTO version (table_name, table_version) SELECT 'emergency_pattern', 2
    WHERE NOT EXISTS (SELECT 1 FROM version WHERE table_name = 'emergency_pattern');
  GRANT ALL ON emergency_pattern TO kamailio;
  GRANT ALL ON SEQUENCE emergency_pattern_id_seq TO kamailio;
  GRANT SELECT ON emergency_pattern TO kamailioro;"
if su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d kamailio" <<<"$emergency_sql" >/dev/null 2>&1; then
  ok "Emergency pattern table present"
else
  die "Failed creating emergency_pattern - Kamailio cannot load its emergency exemption."
fi

TLS_READY=0
if [ -f /etc/qwixbox/tls/fullchain.pem ]; then
  usermod -aG ssl-cert kamailio 2>/dev/null || true
  TLS_READY=1
  deploy_template "$TPL/tls.cfg" /etc/kamailio/tls.cfg 0640 root:kamailio || true
else
  warn "No TLS material at /etc/qwixbox/tls - SIP TLS on ${SIPS_PORT} will be disabled."
  warn "Run 13-tls-certs.sh, then re-run this step."
fi

WEBRTC_READY=0
if [ "${ENABLE_WEBRTC:-1}" = "1" ]; then
  if [ "$TLS_READY" = "1" ]; then
    WEBRTC_READY=1
    ok "WebRTC enabled - WSS on ${WSS_PORT}"
  else
    warn "WebRTC needs TLS. Run 13-tls-certs.sh first."
  fi
fi

STIRSHAKEN_READY=0
if [ "${ENABLE_STIR_SHAKEN:-0}" = "1" ]; then
  if [ -f "$KAM_MPATH/stirshaken.so" ] && [ -f /etc/kamailio/stirshaken.cfg ]; then
    STIRSHAKEN_READY=1
    ok "STIR/SHAKEN enabled"
  else
    warn "ENABLE_STIR_SHAKEN is set but the module is not built - run 33-stir-shaken.sh."
  fi
fi

local_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "")"

# FreeSWITCH's external profile sits one above its internal one (31-freeswitch-config.sh); the
# two are the only source ports Kamailio trusts as FreeSWITCH (I28).
# shellcheck disable=SC2034  # read by name from the template
FS_EGRESS_SIP_PORT="$((FS_INTERNAL_SIP_PORT + 1))"
# shellcheck disable=SC2034
ADV_SIP=""
# shellcheck disable=SC2034
ADV_SIPS=""
# shellcheck disable=SC2034
ADV_WSS=""
# shellcheck disable=SC2034
if [ -n "$public_ip" ] && [ -n "$local_ip" ] && [ "$public_ip" != "$local_ip" ]; then
  ADV_SIP=" advertise ${public_ip}:${SIP_PORT}"
  ADV_SIPS=" advertise ${public_ip}:${SIPS_PORT}"
  ADV_WSS=" advertise ${public_ip}:${WSS_PORT}"
  info "NAT detected: Kamailio binds ${local_ip} and advertises ${public_ip}"
elif [ -z "$public_ip" ]; then
  warn "Could not determine the public IP. If this host is behind NAT, add 'advertise <public>'"
  warn "  to the listen lines in /etc/kamailio/kamailio.cfg, or calls will fail mid-dialog."
fi

# shellcheck disable=SC2034
if [ "$TLS_READY" = "1" ];        then DEFINE_TLS='#!define WITH_TLS';               else DEFINE_TLS=""; fi
# shellcheck disable=SC2034
if [ "$WEBRTC_READY" = "1" ];     then DEFINE_WEBRTC='#!define WITH_WEBRTC';         else DEFINE_WEBRTC=""; fi
# shellcheck disable=SC2034
if [ "$STIRSHAKEN_READY" = "1" ]; then DEFINE_STIRSHAKEN='#!define WITH_STIRSHAKEN'; else DEFINE_STIRSHAKEN=""; fi

STIR_SHAKEN_X5U="${STIR_SHAKEN_X5U:-}"
STIR_SHAKEN_ATTEST="${STIR_SHAKEN_ATTEST:-B}"
STIR_SHAKEN_ORIGID="${STIR_SHAKEN_ORIGID:-}"

deploy_template "$TPL/kamailio.cfg" /etc/kamailio/kamailio.cfg 0640 root:kamailio || true

# The API's .env records whether signing is live; re-render it when that changed.
API_ENV="${API_DIR:-/opt/qwixbox-api}/.env"
if [ -f "$API_ENV" ] && ! grep -qx "STIR_SIGNING=$(stir_signing_ready)" "$API_ENV"; then
  invalidate_step 41-api-deploy.sh
fi

info "Kamailio module path: ${KAM_MPATH}/"

install -d -m 0755 -o kamailio -g kamailio /run/kamailio

ensure_directive /etc/default/kamailio "RUN_KAMAILIO" "yes" "="
ensure_directive /etc/default/kamailio "USER" "kamailio" "="
ensure_directive /etc/default/kamailio "GROUP" "kamailio" "="

if ! su - postgres -c "psql -tAq -d kamailio -c \"SELECT 1 FROM dispatcher WHERE destination='sip:127.0.0.1:${FS_INTERNAL_SIP_PORT}'\"" 2>/dev/null | grep -q 1; then
  if su - postgres -c "psql -q -d kamailio -c \
      \"INSERT INTO dispatcher (setid, destination, flags, priority, description)
        VALUES (1, 'sip:127.0.0.1:${FS_INTERNAL_SIP_PORT}', 0, 0, 'local freeswitch')\"" >/dev/null 2>&1; then
    info "Seeded the dispatcher with the local FreeSWITCH"
  else
    warn "Could not seed the dispatcher table - add the FreeSWITCH destination manually."
  fi
fi

if su - postgres -c "psql -tAq -d kamailio -c \"SELECT to_regclass('public.address')\"" 2>/dev/null | grep -q address; then
  count="$(su - postgres -c "psql -tAq -d kamailio -c 'SELECT COUNT(*) FROM address'" 2>/dev/null | tr -d ' ')"
  ok "Trunk address table present (${count:-0} entries)"
else
  warn "No address table - trunk-by-IP authentication will not work until the schema has one."
fi

kamailio -c -f /etc/kamailio/kamailio.cfg >/dev/null 2>&1 \
  || die "Kamailio config check failed. Run: kamailio -c -f /etc/kamailio/kamailio.cfg"
ok "Configuration syntax valid"

systemctl enable kamailio >/dev/null 2>&1 || true
restart_service kamailio

ok "Kamailio listening on ${SIP_PORT} (UDP/TCP)$( [ "$TLS_READY" = "1" ] && echo " and ${SIPS_PORT} (TLS)" )"
info "Outbound routes and number translation are applied in FreeSWITCH. Registration trunks and billing are not supported yet."

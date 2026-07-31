#!/usr/bin/env bash
### Kamailio database schema, TLS and routing configuration.
###
### Role: public SIP edge. Handles registration and authentication against Postgres, applies
### anti-flood protection, engages rtpengine for media, and relays established calls to
### FreeSWITCH on loopback.
###
### The three files this deploys live in resources/conf/kamailio/; @NAME@ placeholders are
### filled from the shell variables below - see deploy_template.
###
# step-inputs: resources/conf/kamailio
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

command -v kamailio >/dev/null || die "Kamailio is not installed - run 32-kamailio.sh first."
pg_db_exists kamailio || die "The kamailio database does not exist - run 22-provision-databases.sh first."

TPL="$REPO_DIR/resources/conf/kamailio"

### The module path differs on arm64, so it is detected rather than hardcoded. Resolved here
### because kamailio.cfg is rendered with it: it used to be written as the x86_64 path and
### sed-patched afterwards, which made write_file see a difference on every single re-run and
### drop another .bak file beside the config each time.
KAM_MPATH="$(dirname "$(find /usr/lib -name 'tm.so' -path '*kamailio*' 2>/dev/null | head -1)")"
if [ -z "$KAM_MPATH" ] || [ "$KAM_MPATH" = "." ]; then
  KAM_MPATH="/usr/lib/x86_64-linux-gnu/kamailio/modules"
  warn "Could not locate the Kamailio module directory - assuming $KAM_MPATH"
fi

### --- Schema ------------------------------------------------------------------------------

### kamdbctl reads its settings from kamctlrc. Point it at Postgres and the roles created in
### step 22 so it never prompts.
deploy_template "$TPL/kamctlrc" /etc/kamailio/kamctlrc 0640 root:kamailio || true

### kamdbctl create is not idempotent - it errors out if the tables are already there. Detect
### an existing schema by looking for the subscriber table.
if su - postgres -c "psql -tAc \"SELECT to_regclass('public.subscriber')\" kamailio" | grep -q subscriber; then
  ok "Kamailio schema already present"
else
  ### Apply the schema files directly rather than running `kamdbctl create`.
  ###
  ### kamdbctl insists on creating the database and the roles itself, and both already exist -
  ### 22-provision-databases.sh made them with tighter privileges than kamdbctl would. It fails
  ### on "database already exists" before it ever reaches the tables. It also wants credentials
  ### in ~/.pgpass for a TCP connection we do not otherwise need.
  ###
  ### Applying the per-module SQL is deterministic, idempotent to re-run in the sense that it
  ### either succeeds or fails loudly, and makes the module-to-table mapping explicit: each
  ### file here exists because a module in kamailio.cfg requires it.
  SCHEMA_DIR="/usr/share/kamailio/postgres"
  [ -d "$SCHEMA_DIR" ] || die "Kamailio schema files not found at $SCHEMA_DIR"

  ### standard covers version/usrloc/subscriber-adjacent core tables. The rest map one-to-one
  ### onto loadmodule lines: drop a module and its schema stops being needed.
  ### No drouting: carrier selection happens in FreeSWITCH's Lua handler, so the dr_* tables
  ### would be created and never written. See the "Carrier routing" note in kamailio.cfg.
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

  ### The tables are owned by postgres after this; Kamailio connects as the kamailio role and
  ### needs to actually use them.
  su - postgres -c "psql -q -d kamailio -c \
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO kamailio;
     GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO kamailio;
     GRANT SELECT ON ALL TABLES IN SCHEMA public TO kamailioro;'" >/dev/null

  ok "Schema applied"
fi

### --- Columns for acc's db_extra ------------------------------------------------------------

### OUTSIDE the schema guard above, deliberately. kamdbctl's acc table has only the standard
### eight columns, but `modparam("acc", "db_extra", ...)` below names six more. Kamailio does
### not validate that at startup - it builds the INSERT from the db_extra string, so every
### accounted call fails with a column error at runtime, long after anyone is watching the
### config load. Running this only on a fresh schema would leave every existing install broken,
### which is the case that matters: these ALTERs are IF NOT EXISTS and cost nothing to re-run.
###
### Widths match the columns these mirror elsewhere in the schema, so a long From: user
### truncates the same way everywhere rather than failing only in accounting.
ACC_EXTRA_COLS="src_user VARCHAR(64)|src_domain VARCHAR(128)|dst_user VARCHAR(64)|dst_domain VARCHAR(128)|src_ip VARCHAR(64)|dialog_id VARCHAR(64)"

acc_sql=""
IFS='|' read -ra _cols <<< "$ACC_EXTRA_COLS"
for col in "${_cols[@]}"; do
  for tbl in acc missed_calls; do
    acc_sql="${acc_sql}ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col} NOT NULL DEFAULT '';"
  done
done
### Accounting is queried by time for reports and by callid when reconciling one call against
### the FreeSWITCH CDR. Neither is indexed by the stock schema.
acc_sql="${acc_sql}CREATE INDEX IF NOT EXISTS acc_time_idx ON acc (time);"
acc_sql="${acc_sql}CREATE INDEX IF NOT EXISTS acc_callid_idx ON acc (callid);"

if su - postgres -c "psql -v ON_ERROR_STOP=1 -q -d kamailio -c \"${acc_sql}\"" >/dev/null 2>&1; then
  ok "Accounting columns present (acc, missed_calls)"
else
  die "Failed adding the acc db_extra columns - accounting would fail on every call."
fi

### --- TLS ---------------------------------------------------------------------------------

TLS_READY=0
if [ -f /etc/qwixbox/tls/fullchain.pem ]; then
  usermod -aG ssl-cert kamailio 2>/dev/null || true
  TLS_READY=1
  deploy_template "$TPL/tls.cfg" /etc/kamailio/tls.cfg 0640 root:kamailio || true
else
  warn "No TLS material at /etc/qwixbox/tls - SIP TLS on ${SIPS_PORT} will be disabled."
  warn "Run 13-tls-certs.sh, then re-run this step."
fi

### --- Feature detection ---------------------------------------------------------------------

### WebRTC rides on the same TLS material as SIP TLS - a browser will not open a WSS socket
### to an untrusted certificate, so there is no useful "WebRTC without TLS" mode.
WEBRTC_READY=0
if [ "${ENABLE_WEBRTC:-1}" = "1" ]; then
  if [ "$TLS_READY" = "1" ]; then
    WEBRTC_READY=1
    ok "WebRTC enabled - WSS on ${WSS_PORT}"
  else
    warn "WebRTC needs TLS. Run 13-tls-certs.sh first."
  fi
fi

### The stirshaken module is a source build (33-stir-shaken.sh); its absence is normal.
STIRSHAKEN_READY=0
if [ "${ENABLE_STIR_SHAKEN:-0}" = "1" ]; then
  if [ -f "$KAM_MPATH/stirshaken.so" ] && [ -f /etc/kamailio/stirshaken.cfg ]; then
    STIRSHAKEN_READY=1
    ok "STIR/SHAKEN enabled"
  else
    warn "ENABLE_STIR_SHAKEN is set but the module is not built - run 33-stir-shaken.sh."
  fi
fi

### --- Public address ---------------------------------------------------------------------

### Every mainstream cloud puts the instance behind a 1:1 NAT: the NIC holds a private address
### (10.x on GCP and AWS, often the public one on Vultr) and the public IP lives on the
### provider's edge. Kamailio binds to the private address, so without being told otherwise it
### writes that address into Via, Record-Route and Contact - and every SIP response and
### in-dialog request from an external endpoint is then aimed at an address that does not exist
### on the internet. Registration appears to work and calls fail one step later, which is a
### miserable thing to debug.
###
### `advertise` on each PUBLIC listener makes Kamailio write the public address into those
### headers while still binding to the private one. Per-listener rather than the global
### `advertised_address`, which would apply to the loopback egress socket too and rewrite the
### internal FreeSWITCH leg to a public address it must never use.
###
### Detected the same way rtpengine already does it, and skipped entirely when the two match,
### which is the no-NAT case (Vultr and most bare metal).
local_ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"
public_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "")"

### Read by name, as @ADV_SIP@ and friends in kamailio.cfg - which shellcheck cannot see, hence
### the directives here and on the DEFINE_* block below.
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
  ### Worth saying out loud rather than silently guessing: on a NATed host this is the
  ### difference between a working PBX and one that registers but cannot complete a call.
  warn "Could not determine the public IP. If this host is behind NAT, add 'advertise <public>'"
  warn "  to the listen lines in /etc/kamailio/kamailio.cfg, or calls will fail mid-dialog."
fi

### --- Routing configuration -----------------------------------------------------------------

### The conditional #!define lines. Each renders as an empty line when its feature is off,
### exactly as the command substitutions these replaced did. Read by name from the template,
### which is why shellcheck has to be told they are used.
# shellcheck disable=SC2034
if [ "$TLS_READY" = "1" ];        then DEFINE_TLS='#!define WITH_TLS';               else DEFINE_TLS=""; fi
# shellcheck disable=SC2034
if [ "$WEBRTC_READY" = "1" ];     then DEFINE_WEBRTC='#!define WITH_WEBRTC';         else DEFINE_WEBRTC=""; fi
# shellcheck disable=SC2034
if [ "$STIRSHAKEN_READY" = "1" ]; then DEFINE_STIRSHAKEN='#!define WITH_STIRSHAKEN'; else DEFINE_STIRSHAKEN=""; fi

### Defaulted so every @NAME@ resolves; render_template aborts the step on an unset one.
STIR_SHAKEN_X5U="${STIR_SHAKEN_X5U:-}"
STIR_SHAKEN_ATTEST="${STIR_SHAKEN_ATTEST:-B}"
STIR_SHAKEN_ORIGID="${STIR_SHAKEN_ORIGID:-}"

### This is a deliberately conservative starting point: register/authenticate, protect, relay
### to FreeSWITCH. It is NOT a finished dialplan - number translation, outbound trunking and
### billing hooks are business logic and belong to you. Review before taking real traffic.
deploy_template "$TPL/kamailio.cfg" /etc/kamailio/kamailio.cfg 0640 root:kamailio || true

### --- Runtime -------------------------------------------------------------------------------

info "Kamailio module path: ${KAM_MPATH}/"

install -d -m 0755 -o kamailio -g kamailio /run/kamailio

### Kamailio's Debian default refuses to start until this is flipped, as a guard against
### running the example config in production. We have just written a real one.
ensure_directive /etc/default/kamailio "RUN_KAMAILIO" "yes" "="
ensure_directive /etc/default/kamailio "USER" "kamailio" "="
ensure_directive /etc/default/kamailio "GROUP" "kamailio" "="

### --- Seed the routing tables ---------------------------------------------------------------

### dispatcher holds the FreeSWITCH pool. Seeding it here means the proxy has somewhere to
### send calls on a fresh install; adding a second media server later is an INSERT.
if ! su - postgres -c "psql -tAq -d kamailio -c \"SELECT 1 FROM dispatcher WHERE destination='sip:127.0.0.1:${FS_INTERNAL_SIP_PORT}'\"" 2>/dev/null | grep -q 1; then
  if su - postgres -c "psql -q -d kamailio -c \
      \"INSERT INTO dispatcher (setid, destination, flags, priority, description)
        VALUES (1, 'sip:127.0.0.1:${FS_INTERNAL_SIP_PORT}', 0, 0, 'local freeswitch')\"" >/dev/null 2>&1; then
    info "Seeded the dispatcher with the local FreeSWITCH"
  else
    warn "Could not seed the dispatcher table - add the FreeSWITCH destination manually."
  fi
fi

### The address table drives both permissions (who may send us calls without registering) and
### the responsive firewall. It starts empty: adding a carrier is a deliberate act.
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
warn "The routing config is a safe baseline, not a finished dialplan."
warn "Number translation, outbound trunks and billing hooks still need to be added."

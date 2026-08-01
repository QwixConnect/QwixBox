#!/usr/bin/env bash
# Verify services, listening ports, TLS validity; print summary. The [ERR]/[CRIT] count is
# scoped to the current FreeSWITCH run - the log appends across restarts.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

PREFIX=/usr/local/freeswitch
problems=0
checks=0

check() {
  local label="$1"; shift
  checks=$((checks + 1))
  if "$@" >/dev/null 2>&1; then
    ok "$label"
  else
    fail "$label"
    problems=$((problems + 1))
  fi
}

# shellcheck disable=SC2329 # invoked indirectly via check()
port_listening() {
  ss -ltnu 2>/dev/null | grep -qE "[:.]$1\b"
}

UNIT_FILES="$(systemctl list-unit-files --no-legend 2>/dev/null || true)"

printf '\n--- Services ---\n'
for unit in postgresql redis-server freeswitch kamailio rtpengine-daemon nginx qwixbox-api fail2ban nftables; do
  case "$UNIT_FILES" in
    *"${unit}.service"*) : ;;
    *) continue ;;
  esac
  check "$unit running" systemctl is-active --quiet "$unit"
done

printf '\n--- Listening ports ---\n'
check "SIP ${SIP_PORT}"            port_listening "$SIP_PORT"
check "FreeSWITCH ${FS_INTERNAL_SIP_PORT} (loopback)" port_listening "$FS_INTERNAL_SIP_PORT"
check "API ${API_PORT} (loopback)" port_listening "$API_PORT"
check "HTTPS 443"                  port_listening 443
check "Postgres 5432"              port_listening 5432

printf '\n--- Telephony ---\n'
if [ -x "$PREFIX/bin/fs_cli" ]; then
  check "FreeSWITCH responds on ESL" bash -c "$PREFIX/bin/fs_cli -p $FS_ESL_PASSWORD -x status | grep -q '^UP'"
  check "Opus codec loaded"          bash -c "$PREFIX/bin/fs_cli -p $FS_ESL_PASSWORD -x 'show codec' | grep -qi opus"
  check "SIP profile up"             bash -c "$PREFIX/bin/fs_cli -p $FS_ESL_PASSWORD -x 'sofia status' | grep -qi RUNNING"

  fs_since=""
  if fs_started="$(systemctl show freeswitch -p ActiveEnterTimestamp --value 2>/dev/null)" \
     && [ -n "$fs_started" ]; then
    fs_since="$(date -d "$fs_started" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
  fi

  fs_log_errors() {
    if [ -n "$fs_since" ]; then
      awk -v since="$fs_since" \
        '/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}/ && /\[(ERR|CRIT)\]/ \
           && (substr($0, 1, 19) "") >= (since "")' \
        "$PREFIX/log/freeswitch.log" 2>/dev/null || true
    else
      grep -aE '\[(ERR|CRIT)\]' "$PREFIX/log/freeswitch.log" 2>/dev/null || true
    fi
  }

  errs="$(fs_log_errors | grep -c . || true)"
  errs="${errs:-0}"
  checks=$((checks + 1))
  if [ "$errs" -eq 0 ]; then
    ok "No errors in the FreeSWITCH log"
  else
    fail "$errs [ERR]/[CRIT] lines in the FreeSWITCH log since it started"
    fs_log_errors | sed -E 's/^[0-9-]+ [0-9:.]+ [0-9.]+% //' | sort -u | head -5 | sed 's/^/      /'
    problems=$((problems + 1))
  fi
fi

check "Kamailio config valid" kamailio -c -f /etc/kamailio/kamailio.cfg
check "rtpengine control socket" bash -c "ss -lun | grep -q ':${RTPENGINE_NG_PORT}'"

if [ "${ENABLE_WEBRTC:-1}" = "1" ]; then
  check "WSS ${WSS_PORT} listening" port_listening "${WSS_PORT}"
  check "WSS presents a valid certificate" \
    bash -c "echo | openssl s_client -connect 127.0.0.1:${WSS_PORT} -servername ${PBX_FQDN} 2>/dev/null | grep -q 'Verify return code: 0'"
fi

if [ "${ENABLE_STIR_SHAKEN:-0}" = "1" ]; then
  mp="$(dirname "$(find /usr/lib -name 'tm.so' -path '*kamailio*' 2>/dev/null | head -1)")"
  check "stirshaken module built" test -f "$mp/stirshaken.so"
  check "STIR signing key present" test -f "${STIR_SHAKEN_KEY:-/etc/qwixbox/stir/signing.key}"
  check "STIR CA roots present" bash -c "[ -n \"\$(ls -A /etc/qwixbox/stir/ca 2>/dev/null)\" ]"
fi

printf '\n--- Security ---\n'
check "Firewall active"          bash -c "nft list ruleset | grep -q 'hook input'"
check "SSH root login disabled"  bash -c "sshd -T 2>/dev/null | grep -q '^permitrootlogin no'"
check "fail2ban jails loaded"    bash -c "fail2ban-client status | grep -q 'Jail list'"
check "Redis needs a password"   bash -c "! redis-cli ping 2>/dev/null | grep -q PONG"
check "Postgres is loopback-only" bash -c "! ss -ltn | grep ':5432' | grep -qv '127.0.0.1\|::1'"

if [ -x /usr/sbin/sendmail ]; then
  printf '\n--- Mail ---\n'
  check "postfix running" systemctl is-active --quiet postfix
  check "sendmail available" test -x /usr/sbin/sendmail

  check "postfix is loopback-only" \
    bash -c "! ss -ltn 2>/dev/null | awk '\$4 ~ /:25\$/' | grep -qv '127.0.0.1\|::1'"

  if systemctl is-active --quiet opendkim 2>/dev/null; then
    check "opendkim running" systemctl is-active --quiet opendkim
    _dkim_domain="${MAIL_DOMAIN:-}"
    if [ -z "$_dkim_domain" ]; then
      case "${SMTP_FROM:-}" in *@*) _dkim_domain="${SMTP_FROM#*@}" ;; *) _dkim_domain="${PBX_FQDN#*.}" ;; esac
    fi
    check "DKIM key matches DNS (${_dkim_domain})" \
      bash -c "opendkim-testkey -d '$_dkim_domain' -s '${DKIM_SELECTOR:-qwixbox}' -vvv 2>&1 | grep -q 'key OK'"
  fi
fi

printf '\n--- TLS ---\n'
CERT=/etc/qwixbox/tls/fullchain.pem
if [ -f "$CERT" ]; then
  end="$(openssl x509 -enddate -noout -in "$CERT" 2>/dev/null | cut -d= -f2)"
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  checks=$((checks + 1))
  if [ "$days" -gt 14 ]; then
    ok "Certificate valid for ${days} more days"
  else
    fail "Certificate expires in ${days} days"
    problems=$((problems + 1))
  fi
  check "Certificate matches ${PBX_FQDN}" \
    bash -c "openssl x509 -noout -text -in '$CERT' | grep -q '${PBX_FQDN}'"
  check "Renewal timer enabled" systemctl is-enabled --quiet certbot.timer
else
  fail "No certificate at $CERT"
  problems=$((problems + 1)); checks=$((checks + 1))
fi

printf '\n--- Scheduled work ---\n'
for timer in qwixbox-backup.timer qwixbox-maintenance.timer qwixbox-healthcheck.timer; do
  case "$UNIT_FILES" in *"${timer}"*) : ;; *) continue ;; esac
  check "$timer enabled" systemctl is-enabled --quiet "$timer"
done

printf '\n=================================================================\n'
if [ "$problems" -eq 0 ]; then
  ok "All ${checks} checks passed."
  printf '\n'
  info "SIP domain:  ${PBX_SIP_DOMAIN}"
  info "SIP:         ${PBX_FQDN}:${SIP_PORT} (UDP/TCP), ${SIPS_PORT} (TLS)"
  info "Portal:      https://${PBX_FQDN}/"
  info "Config:      ${CONFIG_FILE}"
  info "Health:      qwixbox-healthcheck"
  printf '\n'

  if [ -f "${CONFIG_DIR}/first-login" ]; then
    info "Sign in as ${ADMIN_EMAIL:-the account you created}"
    info "  Password:  sudo cat ${CONFIG_DIR}/first-login"
    info "  Delete that file once you are in."
  elif [ -z "${ADMIN_EMAIL:-}" ]; then
    warn "No portal account exists. Create one:"
    warn "  cd ${API_DIR:-/opt/qwixbox-api} && sudo -u ${API_USER:-qwixbox} \\"
    warn "    bun run src/cli/create-user.ts --email you@example.com --name 'Your Name'"
  fi
  printf '\n'

  warn "Still to do before taking real traffic:"
  warn "  - Create SIP subscribers (kamctl add <user>@${PBX_SIP_DOMAIN} <password>)"
  warn "  - Write the dialplan and outbound trunk routing"
  warn "  - Narrow ADMIN_ALLOW_CIDR if it is still 0.0.0.0/0"
  warn "  - Set OFFSITE_RSYNC_TARGET so backups leave this host"
  warn "  - Place a test call and confirm two-way audio"
  exit 0
else
  fail "${problems} of ${checks} checks failed."
  printf '\n'
  info "Investigate with: journalctl -xeu <unit>, or qwixbox-healthcheck"
  exit 1
fi

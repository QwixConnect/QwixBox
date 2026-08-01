#!/usr/bin/env bash
# SIP profiles, ACLs, xml_curl + Lua, Opus. mod_lua must load before mod_xml_curl or the API
# answers every XML lookup and extension.lua never runs - asserted below.
# step-inputs: resources/conf/freeswitch resources/lua
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

PREFIX="/usr/local/freeswitch"
CONF="$PREFIX/conf"
TPL="$REPO_DIR/resources/conf/freeswitch"
[ -d "$CONF" ] || die "$CONF is missing - run 30-freeswitch.sh first."

config_ensure_secret FS_ESL_PASSWORD 32
config_ensure_secret FS_XML_GATEWAY_SECRET 32

# shellcheck disable=SC2034  # read indirectly, by name, from @FS_EGRESS_SIP_PORT@
FS_EGRESS_SIP_PORT="$((FS_INTERNAL_SIP_PORT + 1))"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
VM_MAX_RECORD_LEN="${VM_MAX_RECORD_LEN:-300}"
MAIL_FROM_NAME="${MAIL_FROM_NAME:-Phone System}"
SMTP_FROM="${SMTP_FROM:-pbx@${PBX_FQDN}}"
FAX_SPOOL="${FAX_SPOOL:-/var/spool/qwixbox-fax}"
CDR_SPOOL="${CDR_SPOOL:-$PREFIX/log/xml_cdr}"

FS_AUTOLOAD_ADD="mod_opus mod_lua mod_hiredis mod_pgsql mod_spandsp mod_voicemail mod_curl mod_xml_curl mod_xml_cdr mod_say_en mod_tone_stream"

deploy_template "$TPL/autoload_configs/event_socket.conf.xml" \
  "$CONF/autoload_configs/event_socket.conf.xml" 0644 freeswitch:freeswitch || true

deploy_template "$TPL/fs_cli.conf" /etc/fs_cli.conf 0600 root:root || true

deploy_template "$TPL/vars.xml" "$CONF/vars.xml" 0644 freeswitch:freeswitch || true

deploy_template "$TPL/autoload_configs/acl.conf.xml" \
  "$CONF/autoload_configs/acl.conf.xml" 0644 freeswitch:freeswitch || true

install -d -m 0755 -o freeswitch -g freeswitch "$CONF/sip_profiles"
rm -f "$CONF/sip_profiles/internal-ipv6.xml" "$CONF/sip_profiles/external-ipv6.xml" \
      2>/dev/null || true

deploy_template "$TPL/sip_profiles/internal.xml" \
  "$CONF/sip_profiles/internal.xml" 0644 freeswitch:freeswitch || true
deploy_template "$TPL/sip_profiles/external.xml" \
  "$CONF/sip_profiles/external.xml" 0644 freeswitch:freeswitch || true

deploy_template "$TPL/autoload_configs/logfile.conf.xml" \
  "$CONF/autoload_configs/logfile.conf.xml" 0644 freeswitch:freeswitch || true

install -d -m 0755 -o freeswitch -g freeswitch "$PREFIX/scripts"
for script in "$REPO_DIR"/resources/lua/*.lua; do
  install -m 0644 -o freeswitch -g freeswitch "$script" "$PREFIX/scripts/$(basename "$script")"
done

apt_install libtiff-tools
install -d -m 0770 -o freeswitch -g "$API_USER" "$FAX_SPOOL" 2>/dev/null || \
  install -d -m 0775 -o freeswitch -g freeswitch "$FAX_SPOOL"

deploy_template "$TPL/autoload_configs/lua.conf.xml" \
  "$CONF/autoload_configs/lua.conf.xml" 0644 freeswitch:freeswitch || true

install -d -m 0755 /etc/systemd/system/freeswitch.service.d
deploy_template "$TPL/systemd-env.conf" \
  /etc/systemd/system/freeswitch.service.d/10-qwixbox-env.conf 0644 || true
systemctl daemon-reload

deploy_template "$TPL/autoload_configs/hiredis.conf.xml" \
  "$CONF/autoload_configs/hiredis.conf.xml" 0640 freeswitch:freeswitch || true

deploy_template "$TPL/autoload_configs/voicemail.conf.xml" \
  "$CONF/autoload_configs/voicemail.conf.xml" 0644 freeswitch:freeswitch || true

deploy_template "$TPL/voicemail.tpl" "$CONF/voicemail.tpl" 0644 freeswitch:freeswitch || true
deploy_template "$TPL/notify-voicemail.tpl" \
  "$CONF/notify-voicemail.tpl" 0644 freeswitch:freeswitch || true

if [ -f /usr/src/freeswitch/conf/vanilla/web-vm.tpl ] && [ ! -f "$CONF/web-vm.tpl" ]; then
  install -m 0644 -o freeswitch -g freeswitch \
    /usr/src/freeswitch/conf/vanilla/web-vm.tpl "$CONF/web-vm.tpl"
fi

install -d -m 0750 -o freeswitch -g freeswitch "$CDR_SPOOL"

deploy_template "$TPL/autoload_configs/xml_cdr.conf.xml" \
  "$CONF/autoload_configs/xml_cdr.conf.xml" 0640 freeswitch:freeswitch || true

deploy_template "$TPL/autoload_configs/xml_curl.conf.xml" \
  "$CONF/autoload_configs/xml_curl.conf.xml" 0640 freeswitch:freeswitch || true

FS_AUTOLOAD_CONF="$CONF/autoload_configs/modules.conf.xml"
pending=""
for mod_name in $FS_AUTOLOAD_ADD; do
  if [ ! -f "$PREFIX/mod/${mod_name}.so" ]; then
    warn "${mod_name}.so was not built - skipping autoload"
    continue
  fi
  if grep -q "<load module=\"${mod_name}\"/>" "$FS_AUTOLOAD_CONF"; then
    continue
  fi
  conf_name="${mod_name#mod_}.conf.xml"
  src_conf="/usr/src/freeswitch/conf/vanilla/autoload_configs/$conf_name"
  if [ -f "$src_conf" ] && [ ! -f "$CONF/autoload_configs/$conf_name" ]; then
    install -m 0644 -o freeswitch -g freeswitch "$src_conf" "$CONF/autoload_configs/$conf_name"
    info "Installed $conf_name from the vanilla config"
  fi
  pending="${pending}    <load module=\"${mod_name}\"/>\n"
  info "Autoloading ${mod_name}"
done

if [ -n "$pending" ]; then
  sed -i "s|<!-- Codec Interfaces -->|<!-- Codec Interfaces -->\n${pending%\\n}|" "$FS_AUTOLOAD_CONF"
fi

lua_line="$(grep -n '<load module="mod_lua"/>' "$FS_AUTOLOAD_CONF" | cut -d: -f1)"
curl_line="$(grep -n '<load module="mod_xml_curl"/>' "$FS_AUTOLOAD_CONF" | cut -d: -f1)"
if [ -n "$lua_line" ] && [ -n "$curl_line" ] && [ "$lua_line" -gt "$curl_line" ]; then
  die "mod_xml_curl loads before mod_lua - the API would answer every lookup and extension.lua would never run."
fi

VANILLA_LANG="/usr/src/freeswitch/conf/vanilla/lang/en"
if [ -d "$VANILLA_LANG" ]; then
  if [ ! -d "$CONF/lang/en" ]; then
    install -d -m 0755 -o freeswitch -g freeswitch "$CONF/lang"
    cp -a "$VANILLA_LANG" "$CONF/lang/en"
    chown -R freeswitch:freeswitch "$CONF/lang"
    info "Installed en language and phrase files"
  else
    ok "Language files already present"
  fi

  if ! grep -q 'section name="languages"' "$CONF/freeswitch.xml"; then
    sed -i 's|</document>|  <section name="languages" description="Language Management">\n    <X-PRE-PROCESS cmd="include" data="lang/en/*.xml"/>\n  </section>\n\n</document>|' \
      "$CONF/freeswitch.xml"
    info "Added the languages section to freeswitch.xml"
  fi
else
  warn "No vanilla lang/en tree at $VANILLA_LANG - voicemail and IVR prompts will not play."
fi

chown -R freeswitch:freeswitch "$CONF"

if systemctl is-active --quiet freeswitch; then
  restart_service freeswitch
  sleep 4
  if ! "$PREFIX/bin/fs_cli" -p "$FS_ESL_PASSWORD" -x "status" 2>/dev/null | grep -q "^UP"; then
    die "FreeSWITCH did not come back after the config change."
  fi
  ok "FreeSWITCH reloaded"

  missing=0
  for mod_name in $FS_AUTOLOAD_ADD; do
    if [ "$("$PREFIX/bin/fs_cli" -p "$FS_ESL_PASSWORD" -x "module_exists ${mod_name}" 2>/dev/null)" = "true" ]; then
      ok "  ${mod_name} loaded"
    else
      fail "  ${mod_name} did NOT load"
      missing=$((missing + 1))
    fi
  done
  [ "$missing" -eq 0 ] || die "$missing module(s) failed to load - check: fs_cli -x 'load mod_x'"

  "$PREFIX/bin/fs_cli" -p "$FS_ESL_PASSWORD" -x "sofia status" 2>/dev/null | sed 's/^/  /' | head -8
else
  warn "FreeSWITCH is not running - configuration written, start it with: systemctl start freeswitch"
fi

ok "FreeSWITCH configured (Lua XML handler primary, xml_curl fallback, Redis on ${REDIS_HOST})"

ok "FreeSWITCH configured (ESL on 127.0.0.1:8021, SIP on 127.0.0.1:${FS_INTERNAL_SIP_PORT}, Opus preferred)"

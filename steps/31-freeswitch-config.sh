#!/usr/bin/env bash
### Production FreeSWITCH configuration.
###
### Topology: Kamailio owns the public SIP ports and forwards to FreeSWITCH on loopback.
### FreeSWITCH is therefore never directly exposed, which removes an entire class of
### internet-facing attack surface and lets Kamailio absorb scans and floods first.
###
### The files themselves live in resources/conf/freeswitch/ and carry their own reasoning as
### comments; this script only decides what gets rendered where, with which mode and owner.
### @NAME@ placeholders are filled from the shell variables below - see deploy_template.
###
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

### Values the templates reference that are derived rather than read straight from config.env.
### Every @NAME@ must resolve or render_template aborts, so an optional setting is defaulted here
### rather than left to chance.
# shellcheck disable=SC2034  # read indirectly, by name, from @FS_EGRESS_SIP_PORT@
FS_EGRESS_SIP_PORT="$((FS_INTERNAL_SIP_PORT + 1))"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
VM_MAX_RECORD_LEN="${VM_MAX_RECORD_LEN:-300}"
MAIL_FROM_NAME="${MAIL_FROM_NAME:-Phone System}"
SMTP_FROM="${SMTP_FROM:-pbx@${PBX_FQDN}}"
FAX_SPOOL="${FAX_SPOOL:-/var/spool/qwixbox-fax}"
CDR_SPOOL="${CDR_SPOOL:-$PREFIX/log/xml_cdr}"

### --- Modules that must be autoloaded -------------------------------------------------------

### These are all BUILT by 30-freeswitch.sh but none is in the minimal config's autoload list,
### and each fails differently and quietly when missing:
###   mod_lua      - no XML handler at all, so every lookup falls through to HTTP
###   mod_hiredis  - Lua cannot reach Redis; every call takes the slow path
###   mod_pgsql    - freeswitch.Dbh("pgsql://...") fails, so the Postgres fallback is dead
###   mod_spandsp  - fax silently does not answer
###   mod_xml_cdr  - no call is ever recorded, and the loss is unrecoverable after the fact
### The install asserts each one loaded at the end rather than trusting the config.
### mod_xml_curl and mod_curl are DIFFERENT modules with confusingly similar names:
###   mod_xml_curl - the XML gateway; this is the fallback binding. Without it the whole
###                  fall-through tier is inert and a Redis miss resolves to nothing.
###   mod_curl     - an HTTP client for Lua and the dialplan. Not a fallback for anything.
###   mod_say_en   - renders numbers, dates and times as speech. Every voicemail and IVR prompt
###                  goes through it, so without it "you have 3 new messages" cannot be spoken.
###   mod_tone_stream - provides the silence_stream:// and tone_stream:// file formats. Our own
###                  scripts use them in four places (ivr.lua's pre-greeting pause and default
###                  greeting, feature_code.lua's pause and confirmation tone, and the fax
###                  answer delay), and without it each one logs
###                  "Invalid file format [silence_stream]" and plays nothing.
FS_AUTOLOAD_ADD="mod_opus mod_lua mod_hiredis mod_pgsql mod_spandsp mod_voicemail mod_curl mod_xml_curl mod_xml_cdr mod_say_en mod_tone_stream"

### --- Event socket -----------------------------------------------------------------------

deploy_template "$TPL/autoload_configs/event_socket.conf.xml" \
  "$CONF/autoload_configs/event_socket.conf.xml" 0644 freeswitch:freeswitch || true

### fs_cli defaults to the stock "ClueCon" password, so once ESL has a generated one every
### fs_cli invocation fails with "Error Connecting" - including the ones this installer uses to
### verify the result, and every one an operator types. fs_cli reads /etc/fs_cli.conf, so
### writing it here fixes both at once.
deploy_template "$TPL/fs_cli.conf" /etc/fs_cli.conf 0600 root:root || true

### --- Codecs and globals ------------------------------------------------------------------

deploy_template "$TPL/vars.xml" "$CONF/vars.xml" 0644 freeswitch:freeswitch || true

### --- ACLs ------------------------------------------------------------------------------

deploy_template "$TPL/autoload_configs/acl.conf.xml" \
  "$CONF/autoload_configs/acl.conf.xml" 0644 freeswitch:freeswitch || true

### --- SIP profiles ------------------------------------------------------------------------

install -d -m 0755 -o freeswitch -g freeswitch "$CONF/sip_profiles"
rm -f "$CONF/sip_profiles/internal-ipv6.xml" "$CONF/sip_profiles/external-ipv6.xml" \
      2>/dev/null || true

deploy_template "$TPL/sip_profiles/internal.xml" \
  "$CONF/sip_profiles/internal.xml" 0644 freeswitch:freeswitch || true
deploy_template "$TPL/sip_profiles/external.xml" \
  "$CONF/sip_profiles/external.xml" 0644 freeswitch:freeswitch || true

### --- Logging ----------------------------------------------------------------------------

deploy_template "$TPL/autoload_configs/logfile.conf.xml" \
  "$CONF/autoload_configs/logfile.conf.xml" 0644 freeswitch:freeswitch || true

### --- Lua XML handler ----------------------------------------------------------------------

### This is the hot path. mod_lua binds through switch_xml_bind_search_function - the same
### mechanism mod_xml_curl uses - so lookups are served in-process from Redis instead of over
### HTTP. The API can be down or mid-deploy and calls keep flowing.
install -d -m 0755 -o freeswitch -g freeswitch "$PREFIX/scripts"
for script in "$REPO_DIR"/resources/lua/*.lua; do
  install -m 0644 -o freeswitch -g freeswitch "$script" "$PREFIX/scripts/$(basename "$script")"
done

### Fax spool. tiff2pdf (libtiff-tools) converts what spandsp writes into something a person
### can actually open - the conversion is the feature, not the receiving.
apt_install libtiff-tools
install -d -m 0770 -o freeswitch -g "$API_USER" "$FAX_SPOOL" 2>/dev/null || \
  install -d -m 0775 -o freeswitch -g freeswitch "$FAX_SPOOL"

deploy_template "$TPL/autoload_configs/lua.conf.xml" \
  "$CONF/autoload_configs/lua.conf.xml" 0644 freeswitch:freeswitch || true

install -d -m 0755 /etc/systemd/system/freeswitch.service.d
deploy_template "$TPL/systemd-env.conf" \
  /etc/systemd/system/freeswitch.service.d/10-qwixbox-env.conf 0644 || true
systemctl daemon-reload

### --- Redis client --------------------------------------------------------------------------

deploy_template "$TPL/autoload_configs/hiredis.conf.xml" \
  "$CONF/autoload_configs/hiredis.conf.xml" 0640 freeswitch:freeswitch || true

### --- Voicemail -----------------------------------------------------------------------------

### Written before the autoload loop below, which copies a module's vanilla config only when
### none exists - so this file has to be in place first or it gets shadowed on a fresh install.
deploy_template "$TPL/autoload_configs/voicemail.conf.xml" \
  "$CONF/autoload_configs/voicemail.conf.xml" 0644 freeswitch:freeswitch || true

### Email bodies. The vanilla templates declare ISO-8859-1 and 7bit, which mangles any caller ID
### name outside ASCII; these declare UTF-8. They also put the platform address in From: and the
### caller in Reply-To, matching the email-from reasoning in voicemail.conf.xml. An RFC822 body
### has no comment syntax, which is why that note lives here and not in the templates.
deploy_template "$TPL/voicemail.tpl" "$CONF/voicemail.tpl" 0644 freeswitch:freeswitch || true
deploy_template "$TPL/notify-voicemail.tpl" \
  "$CONF/notify-voicemail.tpl" 0644 freeswitch:freeswitch || true

if [ -f /usr/src/freeswitch/conf/vanilla/web-vm.tpl ] && [ ! -f "$CONF/web-vm.tpl" ]; then
  install -m 0644 -o freeswitch -g freeswitch \
    /usr/src/freeswitch/conf/vanilla/web-vm.tpl "$CONF/web-vm.tpl"
fi

### --- CDR ------------------------------------------------------------------------------------

install -d -m 0750 -o freeswitch -g freeswitch "$CDR_SPOOL"

deploy_template "$TPL/autoload_configs/xml_cdr.conf.xml" \
  "$CONF/autoload_configs/xml_cdr.conf.xml" 0640 freeswitch:freeswitch || true

### --- xml_curl, bound second ------------------------------------------------------------------

deploy_template "$TPL/autoload_configs/xml_curl.conf.xml" \
  "$CONF/autoload_configs/xml_curl.conf.xml" 0640 freeswitch:freeswitch || true

### --- Autoload ------------------------------------------------------------------------------

### Load ORDER is load-bearing, not cosmetic. Both mod_lua and mod_xml_curl bind themselves as
### XML search handlers when they load, FreeSWITCH consults bindings in registration order, and
### the first non-empty answer wins. So whichever loads first is the primary tier.
###
### This inserted each module immediately after the marker, which reverses the list: mod_xml_curl
### is declared after mod_lua and therefore ended up ABOVE it in the file. The result was the
### opposite of the intended design - the API answered every lookup, extension.lua never ran (so
### DND, call forwarding, call waiting and voicemail treatment were all skipped), and the Redis
### tier that exists to keep call setup off the network was bypassed on every call.
###
### Fixed by collecting the modules and inserting them once, in declared order.
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
  ### A module's own config comes from the vanilla tree; the minimal config does not ship it.
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
  ### The trailing \n is already on the last entry, so the marker line is put back first and the
  ### block follows it in the order declared above.
  sed -i "s|<!-- Codec Interfaces -->|<!-- Codec Interfaces -->\n${pending%\\n}|" "$FS_AUTOLOAD_CONF"
fi

### The whole point of the ordering above, asserted rather than assumed. A silent inversion here
### is invisible until someone notices that call forwarding does nothing.
lua_line="$(grep -n '<load module="mod_lua"/>' "$FS_AUTOLOAD_CONF" | cut -d: -f1)"
curl_line="$(grep -n '<load module="mod_xml_curl"/>' "$FS_AUTOLOAD_CONF" | cut -d: -f1)"
if [ -n "$lua_line" ] && [ -n "$curl_line" ] && [ "$lua_line" -gt "$curl_line" ]; then
  die "mod_xml_curl loads before mod_lua - the API would answer every lookup and extension.lua would never run."
fi

### --- Language and phrase files ---------------------------------------------------------------
###
### The minimal config ships no lang/ tree and no <section name="languages"> at all, so every
### prompt fails with "Open of languages and phrases failed" - voicemail cannot say "you have
### three new messages" and an IVR cannot read anything back. The sound files were installed by
### 30-freeswitch.sh; these are the XML macros that decide which of them to play and in what
### order, and they only exist in the vanilla tree.
###
### en only. Each language is ~100KB of XML parsed at startup, and a prompt in a language with no
### matching sound files installed is worse than the English one.
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

  ### The include is what actually makes them load. Added to freeswitch.xml rather than deployed
  ### as a template because that file is generated by `make config-minimal` and carries the
  ### other section declarations.
  if ! grep -q 'section name="languages"' "$CONF/freeswitch.xml"; then
    sed -i 's|</document>|  <section name="languages" description="Language Management">\n    <X-PRE-PROCESS cmd="include" data="lang/en/*.xml"/>\n  </section>\n\n</document>|' \
      "$CONF/freeswitch.xml"
    info "Added the languages section to freeswitch.xml"
  fi
else
  warn "No vanilla lang/en tree at $VANILLA_LANG - voicemail and IVR prompts will not play."
fi

chown -R freeswitch:freeswitch "$CONF"

### --- Apply ------------------------------------------------------------------------------

if systemctl is-active --quiet freeswitch; then
  restart_service freeswitch
  sleep 4
  if ! "$PREFIX/bin/fs_cli" -p "$FS_ESL_PASSWORD" -x "status" 2>/dev/null | grep -q "^UP"; then
    die "FreeSWITCH did not come back after the config change."
  fi
  ok "FreeSWITCH reloaded"

  ### Assert each module actually loaded. This is the check that catches the trap these four
  ### share: built, referenced in config, and silently absent at runtime.
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

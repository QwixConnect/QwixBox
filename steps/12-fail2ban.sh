#!/usr/bin/env bash
# Jails for sshd, FreeSWITCH (mod_fail2ban) and Kamailio.
# step-inputs: resources/conf/fail2ban
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

apt_install fail2ban

TPL="$REPO_DIR/resources/conf/fail2ban"

deploy_template "$TPL/jail.d/00-defaults.local" /etc/fail2ban/jail.d/00-defaults.local || true

deploy_template "$TPL/jail.d/sshd.local" /etc/fail2ban/jail.d/sshd.local || true

deploy_template "$TPL/filter.d/freeswitch-pbx.conf" /etc/fail2ban/filter.d/freeswitch-pbx.conf || true

deploy_template "$TPL/jail.d/freeswitch.local" /etc/fail2ban/jail.d/freeswitch.local || true

deploy_template "$TPL/filter.d/kamailio-auth.conf" /etc/fail2ban/filter.d/kamailio-auth.conf || true

deploy_template "$TPL/jail.d/kamailio.local" /etc/fail2ban/jail.d/kamailio.local || true

if [ ! -f /usr/local/freeswitch/log/freeswitch.log ]; then
  warn "FreeSWITCH log not present yet - its jail starts working after 30-freeswitch.sh."
  install -d -m 0755 /usr/local/freeswitch/log
  touch /usr/local/freeswitch/log/freeswitch.log
fi

fail2ban-client -t >/dev/null || die "fail2ban configuration is invalid."
enable_service fail2ban
restart_service fail2ban

info "Active jails: $(fail2ban-client status 2>/dev/null | awk -F: '/Jail list/{print $2}' | xargs)"
ok "fail2ban configured"

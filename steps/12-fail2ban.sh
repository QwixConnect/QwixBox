#!/usr/bin/env bash
### fail2ban jails for SSH and SIP. SIP brute force is constant and automated on any public
### IP - this is not optional hardening.
###
### The jail and filter files live in resources/conf/fail2ban/; none of them interpolates
### anything, so they are deployed verbatim.
###
# step-inputs: resources/conf/fail2ban
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

apt_install fail2ban

TPL="$REPO_DIR/resources/conf/fail2ban"

### Use nftables as the ban backend so bans land in the same ruleset as 11-firewall.sh
### rather than fighting it with a parallel iptables chain.
deploy_template "$TPL/jail.d/00-defaults.local" /etc/fail2ban/jail.d/00-defaults.local || true

deploy_template "$TPL/jail.d/sshd.local" /etc/fail2ban/jail.d/sshd.local || true

### FreeSWITCH ships mod_fail2ban (we build it), which writes auth failures to the FreeSWITCH
### log in a format fail2ban can parse.
deploy_template "$TPL/filter.d/freeswitch-pbx.conf" /etc/fail2ban/filter.d/freeswitch-pbx.conf || true

deploy_template "$TPL/jail.d/freeswitch.local" /etc/fail2ban/jail.d/freeswitch.local || true

### Kamailio is the public-facing SIP element, so it sees the scans first. It logs auth
### failures to syslog under its own unit.
deploy_template "$TPL/filter.d/kamailio-auth.conf" /etc/fail2ban/filter.d/kamailio-auth.conf || true

deploy_template "$TPL/jail.d/kamailio.local" /etc/fail2ban/jail.d/kamailio.local || true

### The FreeSWITCH jail points at a log file that only exists after 30-freeswitch.sh has run.
### Tolerate its absence so the security tier can be applied to a fresh host first.
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

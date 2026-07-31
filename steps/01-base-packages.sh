#!/usr/bin/env bash
### Common tooling and automatic security updates.
###
# step-inputs: resources/conf/apt
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/apt"

### whiptail drives the configuration wizard and the menu; dnsutils provides dig, which the
### FQDN detection and the DNS step both use to check what a name actually resolves to.
apt_install \
  curl wget git ca-certificates gnupg lsb-release apt-transport-https \
  vim-tiny htop jq rsync whiptail dnsutils \
  tcpdump sngrep ngrep \
  rsyslog logrotate \
  unattended-upgrades apt-listchanges

### --- Unattended security upgrades ------------------------------------------------------

### Security patches only. Deliberately not enabling the general updates origin: an unplanned
### restart of Kamailio or FreeSWITCH drops every call in progress, so anything beyond
### security fixes should be a decision you make during a maintenance window.
deploy_template "$TPL/50unattended-upgrades" /etc/apt/apt.conf.d/50unattended-upgrades || true

deploy_template "$TPL/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades || true

systemctl enable unattended-upgrades >/dev/null 2>&1 || true
ok "Unattended security upgrades enabled (telephony packages held back)"

ok "Base packages complete"

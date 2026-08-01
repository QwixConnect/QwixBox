#!/usr/bin/env bash
# Common tooling, CA certificates, unattended security upgrades.
# step-inputs: resources/conf/apt
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/apt"

apt_install \
  curl wget git ca-certificates gnupg lsb-release apt-transport-https \
  vim-tiny htop jq rsync whiptail dnsutils qrencode \
  tcpdump sngrep ngrep \
  rsyslog logrotate \
  unattended-upgrades apt-listchanges

deploy_template "$TPL/50unattended-upgrades" /etc/apt/apt.conf.d/50unattended-upgrades || true

deploy_template "$TPL/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades || true

systemctl enable unattended-upgrades >/dev/null 2>&1 || true
ok "Unattended security upgrades enabled (telephony packages held back)"

ok "Base packages complete"

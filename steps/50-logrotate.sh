#!/usr/bin/env bash
# Rotation and retention for FreeSWITCH, Kamailio and API logs.
# step-inputs: resources/conf/logrotate
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/logrotate"

apt_install logrotate

deploy_template "$TPL/freeswitch" /etc/logrotate.d/freeswitch || true

deploy_template "$TPL/qwixbox-nginx" /etc/logrotate.d/qwixbox-nginx || true

deploy_template "$TPL/qwixbox-postfix" /etc/logrotate.d/qwixbox-postfix || true

rm -f /etc/logrotate.d/qwixbox-msmtp

deploy_template "$TPL/journald-90-qwixbox.conf" /etc/systemd/journald.conf.d/90-qwixbox.conf || true

systemctl restart systemd-journald

logrotate -d /etc/logrotate.d/freeswitch >/dev/null 2>&1 \
  || warn "logrotate reported a problem with the FreeSWITCH rule - check it manually."

ok "Log rotation configured (FreeSWITCH 30d, CDR 90d, journal 30d/2G)"

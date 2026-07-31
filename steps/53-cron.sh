#!/usr/bin/env bash
### Scheduled maintenance. Timers rather than crontab entries, so failures land in the
### journal alongside everything else and can be inspected with systemctl.
###
# step-inputs: resources/conf/maintenance
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/maintenance"

CDR_KEEP_DAYS="${CDR_KEEP_DAYS:-365}"
RECORDING_KEEP_DAYS="${RECORDING_KEEP_DAYS:-90}"

deploy_template "$TPL/qwixbox-maintenance" /usr/local/sbin/qwixbox-maintenance 0750 || true

deploy_template "$TPL/qwixbox-maintenance.service" /etc/systemd/system/qwixbox-maintenance.service || true

deploy_template "$TPL/qwixbox-maintenance.timer" /etc/systemd/system/qwixbox-maintenance.timer || true

systemctl daemon-reload
systemctl enable --now qwixbox-maintenance.timer >/dev/null 2>&1 || true

info "Scheduled timers:"
systemctl list-timers --no-pager 'qwixbox-*' 'certbot*' 2>/dev/null | head -6 | sed 's/^/  /' || true

ok "Maintenance scheduled (CDR ${CDR_KEEP_DAYS}d, recordings ${RECORDING_KEEP_DAYS}d)"

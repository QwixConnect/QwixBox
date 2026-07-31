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

deploy_template "$TPL/voip-maintenance" /usr/local/sbin/voip-maintenance 0750 || true

deploy_template "$TPL/voip-maintenance.service" /etc/systemd/system/voip-maintenance.service || true

deploy_template "$TPL/voip-maintenance.timer" /etc/systemd/system/voip-maintenance.timer || true

systemctl daemon-reload
systemctl enable --now voip-maintenance.timer >/dev/null 2>&1 || true

info "Scheduled timers:"
systemctl list-timers --no-pager 'voip-*' 'certbot*' 2>/dev/null | head -6 | sed 's/^/  /' || true

ok "Maintenance scheduled (CDR ${CDR_KEEP_DAYS}d, recordings ${RECORDING_KEEP_DAYS}d)"

#!/usr/bin/env bash
### Nightly backups of the databases and configuration.
###
### Local-only by design. A backup on the same disk survives a bad deploy or a dropped table,
### but not a lost instance - wire OFFSITE_RSYNC_TARGET up before calling this done.
###
# step-inputs: resources/conf/backups
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/backups"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/voip-pbx}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

install -d -m 0700 -o root -g root "$BACKUP_DIR"

deploy_template "$TPL/voip-backup" /usr/local/sbin/voip-backup 0750 || true

deploy_template "$TPL/voip-backup.service" /etc/systemd/system/voip-backup.service 0644 || true

deploy_template "$TPL/voip-backup.timer" /etc/systemd/system/voip-backup.timer 0644 || true

systemctl daemon-reload
systemctl enable --now voip-backup.timer >/dev/null 2>&1 || true

info "Running an initial backup to prove it works"
if /usr/local/sbin/voip-backup; then
  ok "Backup verified"
else
  warn "The first backup reported errors - check the output above."
fi

[ -n "${OFFSITE_RSYNC_TARGET:-}" ] || \
  warn "No OFFSITE_RSYNC_TARGET set - backups are on the same host they protect."

ok "Backups scheduled nightly at 03:20, ${BACKUP_KEEP_DAYS} day retention"

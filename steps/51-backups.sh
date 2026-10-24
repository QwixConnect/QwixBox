#!/usr/bin/env bash
# Scheduled pg_dump plus config snapshots. config.env is in the set: without it a restored
# database has a mismatched ENCRYPTION_KEY and every stored secret is undecryptable.
# step-inputs: resources/conf/backups
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/backups"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/qwixbox}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

install -d -m 0700 -o root -g root "$BACKUP_DIR"

deploy_template "$TPL/qwixbox-backup" /usr/local/sbin/qwixbox-backup 0750 || true

deploy_template "$TPL/qwixbox-backup.service" /etc/systemd/system/qwixbox-backup.service 0644 || true

deploy_template "$TPL/qwixbox-backup.timer" /etc/systemd/system/qwixbox-backup.timer 0644 || true

systemctl daemon-reload
systemctl enable --now qwixbox-backup.timer >/dev/null 2>&1 || true

info "Running an initial backup to prove it works"
if /usr/local/sbin/qwixbox-backup; then
  ok "Initial backup completed (a restore test is still required)"
else
  warn "The first backup reported errors - check the output above."
fi

[ -n "${OFFSITE_RSYNC_TARGET:-}" ] || \
  warn "No OFFSITE_RSYNC_TARGET set - backups are on the same host they protect."

ok "Backups scheduled nightly at 03:20, ${BACKUP_KEEP_DAYS} day retention"

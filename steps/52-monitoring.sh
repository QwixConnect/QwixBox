#!/usr/bin/env bash
# Health checks, metrics exporter, alerting.
# step-inputs: resources/conf/monitoring
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/monitoring"

apt_install prometheus-node-exporter

ensure_directive /etc/default/prometheus-node-exporter "ARGS" \
  '"--web.listen-address=127.0.0.1:9100"' "="
systemctl restart prometheus-node-exporter 2>/dev/null || true
enable_service prometheus-node-exporter

API_PORT="${API_PORT:-3000}"
# shellcheck disable=SC2034  # read by name from the template; must match 51-backups.sh
BACKUP_DIR="${BACKUP_DIR:-/var/backups/qwixbox}"
deploy_template "$TPL/qwixbox-healthcheck" /usr/local/sbin/qwixbox-healthcheck 0755 || true

# Where the health check sends alerts (I17). Kept out of the world-readable script: a webhook URL
# is usually its own credential. Defaults to wherever install results already go.
ALERT_EMAIL="${ALERT_EMAIL:-${INSTALL_NOTIFY_EMAIL:-${ADMIN_EMAIL:-}}}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-${INSTALL_NOTIFY_WEBHOOK:-}}"
printf 'ALERT_EMAIL=%q\nALERT_WEBHOOK=%q\n' "$ALERT_EMAIL" "$ALERT_WEBHOOK" \
  | write_file /etc/qwixbox/alerts.env 0600 root:root || true

deploy_template "$TPL/qwixbox-healthcheck.service" /etc/systemd/system/qwixbox-healthcheck.service 0644 || true

deploy_template "$TPL/qwixbox-healthcheck.timer" /etc/systemd/system/qwixbox-healthcheck.timer 0644 || true

systemctl daemon-reload
systemctl enable --now qwixbox-healthcheck.timer >/dev/null 2>&1 || true

info "Current health:"
/usr/local/sbin/qwixbox-healthcheck 2>&1 | sed 's/^/  /' || true

ok "Monitoring configured (node_exporter on 127.0.0.1:9100, health check every 5min)"
if [ -n "$ALERT_EMAIL$ALERT_WEBHOOK" ]; then
  ok "Health alerts go to: ${ALERT_EMAIL:-}${ALERT_EMAIL:+${ALERT_WEBHOOK:+ and }}${ALERT_WEBHOOK:+the webhook}"
  [ -n "$ALERT_EMAIL" ] && [ -z "${SMTP_HOST:-}" ] \
    && warn "No SMTP_HOST: alert email goes direct to MX, which GCP blocks. Set a relay or ALERT_WEBHOOK."
else
  warn "No alert target: set ALERT_EMAIL or ALERT_WEBHOOK, then ./install.sh --only 52-monitoring.sh --force - or nobody is told."
fi

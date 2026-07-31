#!/usr/bin/env bash
### Health checking and metrics.
###
### A PBX fails quietly: registrations stop refreshing, or calls connect with no audio, and
### nothing crashes. These checks look at whether the system is doing its job, not just
### whether the processes exist.
###
# step-inputs: resources/conf/monitoring
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/monitoring"

apt_install prometheus-node-exporter

### Bind the exporter to loopback. Metrics leak a lot about a host and it has no auth.
ensure_directive /etc/default/prometheus-node-exporter "ARGS" \
  '"--web.listen-address=127.0.0.1:9100"' "="
systemctl restart prometheus-node-exporter 2>/dev/null || true
enable_service prometheus-node-exporter

### --- Health check --------------------------------------------------------------------------

deploy_template "$TPL/voip-healthcheck" /usr/local/sbin/voip-healthcheck 0755 || true

### Run it on a timer and let failures surface through the journal, where an existing
### monitoring agent can pick them up without this script needing to know about your alerting.
deploy_template "$TPL/voip-healthcheck.service" /etc/systemd/system/voip-healthcheck.service 0644 || true

deploy_template "$TPL/voip-healthcheck.timer" /etc/systemd/system/voip-healthcheck.timer 0644 || true

systemctl daemon-reload
systemctl enable --now voip-healthcheck.timer >/dev/null 2>&1 || true

info "Current health:"
/usr/local/sbin/voip-healthcheck 2>&1 | sed 's/^/  /' || true

ok "Monitoring configured (node_exporter on 127.0.0.1:9100, health check every 5min)"
warn "Nothing alerts yet - point your monitoring at the exporter and the voip-health journal identifier."

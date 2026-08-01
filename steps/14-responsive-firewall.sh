#!/usr/bin/env bash
# Reputation-tiered SIP rate limiting, learned from live registrations.
# step-inputs: resources/conf/responsive-firewall
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/responsive-firewall"

command -v nft >/dev/null || die "nftables is not installed - run 11-firewall.sh first."

deploy_template "$TPL/qwixbox-responsive.nft" /etc/nftables.d/qwixbox-responsive.nft || true

install -d -m 0755 /etc/nftables.d
nft -f /etc/nftables.d/qwixbox-responsive.nft || die "Failed to create the responsive sets."

if ! grep -q 'include "/etc/nftables.d/\*.nft"' /etc/nftables.conf; then
  sed -i '/^flush ruleset$/a\\ninclude "/etc/nftables.d/*.nft"' /etc/nftables.conf
  info "Wired /etc/nftables.d/*.nft into the main ruleset"
fi

if grep -q 'sip_known' /etc/nftables.conf; then
  ok "Responsive SIP rules already present"
else
  python3 - "$SIP_PORT" <<'PY'
import re, sys
port = sys.argv[1]
path = "/etc/nftables.conf"
src = open(path).read()

old = re.compile(
    r"[ \t]*# SIP\. The rate limit.*?udp dport %s accept\n" % re.escape(port),
    re.S,
)
new = f"""        # SIP, tiered by reputation (see 14-responsive-firewall.sh).
        udp dport {port} ip saddr @sip_trusted accept
        udp dport {port} ip saddr @sip_known accept
        tcp dport {port} ip saddr @sip_trusted accept
        tcp dport {port} ip saddr @sip_known accept

        udp dport {port} add @sip_flood {{ ip saddr limit rate over 6/second }} drop
        udp dport {port} ip saddr @sip_flood drop
        udp dport {port} accept
"""

if not old.search(src):
    sys.exit("Could not find the SIP rule block to replace - has 11-firewall.sh changed?")

open(path, "w").write(old.sub(new, src))
print("  -> rewrote the SIP rules with reputation tiers")
PY
fi

nft -c -f /etc/nftables.conf || die "Ruleset invalid after adding responsive rules."
nft -f /etc/nftables.conf
ok "Responsive SIP rules active"

deploy_template "$TPL/qwixbox-fw-sync" /usr/local/sbin/qwixbox-fw-sync 0750 || true

deploy_template "$TPL/qwixbox-fw-sync.service" /etc/systemd/system/qwixbox-fw-sync.service || true

deploy_template "$TPL/qwixbox-fw-sync.timer" /etc/systemd/system/qwixbox-fw-sync.timer || true

systemctl daemon-reload
systemctl enable --now qwixbox-fw-sync.timer >/dev/null 2>&1 || true

if pg_db_exists kamailio 2>/dev/null; then
  /usr/local/sbin/qwixbox-fw-sync 2>&1 | sed 's/^/  /' || true
else
  warn "The kamailio database does not exist yet - sync starts working after 33-kamailio-config.sh."
fi

ok "Responsive firewall active (unknown sources limited to 6/s, registered endpoints unrestricted)"

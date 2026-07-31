#!/usr/bin/env bash
### Responsive firewall - the idea borrowed from FreePBX's firewall module.
###
### The problem with a static SIP allowlist: real endpoints roam. A phone on a mobile network
### changes IP constantly, so you cannot pre-declare who is allowed. The usual answer is to
### leave 5060 open to the world and let Kamailio's auth absorb the abuse, which works but
### means every scanner on the internet gets to talk to your SIP stack all day.
###
### Responsive approach: anyone may attempt to register, but unknown sources are held to a
### tight rate limit. An IP that successfully registers is promoted to a "known" set and gets
### the normal limit. Attackers never authenticate, so they never leave the slow lane.
###
# step-inputs: resources/conf/responsive-firewall
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/responsive-firewall"

command -v nft >/dev/null || die "nftables is not installed - run 11-firewall.sh first."

### --- Named sets -------------------------------------------------------------------------

### Entries carry a timeout, so an endpoint that stops registering ages out on its own.
###
### The sets MUST live in the same table as the rules that reference them - nftables scopes
### sets to their table, and there is no cross-table reference. They are declared in their own
### file, included after `flush ruleset` and before the main filter table, so nftables merges
### the two declarations of `table inet filter` into one.
###
### Consequence to be aware of: re-running 11-firewall.sh flushes the ruleset and empties these
### sets. That is survivable - qwixbox-fw-sync repopulates within its 2 minute period, and the
### tiered rules degrade to rate-limiting everyone rather than failing open.
deploy_template "$TPL/qwixbox-responsive.nft" /etc/nftables.d/qwixbox-responsive.nft || true

install -d -m 0755 /etc/nftables.d
nft -f /etc/nftables.d/qwixbox-responsive.nft || die "Failed to create the responsive sets."

### Load the sets before the main ruleset so the filter chain can reference them.
if ! grep -q 'include "/etc/nftables.d/\*.nft"' /etc/nftables.conf; then
  sed -i '/^flush ruleset$/a\\ninclude "/etc/nftables.d/*.nft"' /etc/nftables.conf
  info "Wired /etc/nftables.d/*.nft into the main ruleset"
fi

### --- Rate limiting by reputation ------------------------------------------------------------

### Replace the single blanket SIP rule from 11-firewall.sh with a tiered one. Known and
### trusted sources bypass the limiter entirely; everyone else gets a trickle that is ample
### for a genuine registration attempt and useless for a brute-force sweep.
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
        # Trunks and endpoints that have actually registered skip the limiter.
        udp dport {port} ip saddr @sip_trusted accept
        udp dport {port} ip saddr @sip_known accept
        tcp dport {port} ip saddr @sip_trusted accept
        tcp dport {port} ip saddr @sip_known accept

        # Everyone else: enough to register, nowhere near enough to brute force.
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

### --- Sync daemon ------------------------------------------------------------------------

### Kamailio holds the authoritative list of who is registered, in the location table. Sync
### reads it and mirrors the source addresses into the nftables set.
deploy_template "$TPL/qwixbox-fw-sync" /usr/local/sbin/qwixbox-fw-sync 0750 || true

deploy_template "$TPL/qwixbox-fw-sync.service" /etc/systemd/system/qwixbox-fw-sync.service || true

### Sync interval must be comfortably shorter than the set timeout, or a still-registered
### endpoint drops out of the set between runs and gets rate limited for no reason.
deploy_template "$TPL/qwixbox-fw-sync.timer" /etc/systemd/system/qwixbox-fw-sync.timer || true

systemctl daemon-reload
systemctl enable --now qwixbox-fw-sync.timer >/dev/null 2>&1 || true

if pg_db_exists kamailio 2>/dev/null; then
  /usr/local/sbin/qwixbox-fw-sync 2>&1 | sed 's/^/  /' || true
else
  warn "The kamailio database does not exist yet - sync starts working after 33-kamailio-config.sh."
fi

ok "Responsive firewall active (unknown sources limited to 6/s, registered endpoints unrestricted)"

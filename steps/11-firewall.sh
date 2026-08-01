#!/usr/bin/env bash
# nftables: default deny, SIP/RTP/HTTPS allowlist, SIP rate limiting.
# step-inputs: resources/conf/firewall
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/firewall"

apt_install nftables

admin_set=""
for cidr in $ADMIN_ALLOW_CIDR; do
  admin_set="${admin_set}${admin_set:+, }${cidr}"
done
[ -n "$admin_set" ] || die "ADMIN_ALLOW_CIDR is empty in $CONFIG_FILE."
if [ "$ADMIN_ALLOW_CIDR" = "0.0.0.0/0" ]; then
  warn "ADMIN_ALLOW_CIDR is 0.0.0.0/0 - SSH is exposed to the whole internet."
  warn "Narrow this to your office/VPN range in $CONFIG_FILE."
fi

# shellcheck disable=SC2034  # read by name from the template
if [ "${ENABLE_WEBRTC:-1}" = "1" ]; then
  WEBRTC_RULE="$(printf '        # SIP over secure WebSocket, for browser clients.\n        tcp dport %s accept' "${WSS_PORT:-8443}")"
else
  WEBRTC_RULE=""
fi

deploy_template "$TPL/nftables.conf" /etc/nftables.conf 0644 || true

nft -c -f /etc/nftables.conf || die "nftables ruleset is invalid - not applying."

systemctl enable --now nftables >/dev/null 2>&1 || systemctl enable nftables >/dev/null 2>&1 || true
nft -f /etc/nftables.conf
ok "Firewall active: SSH limited to ${ADMIN_ALLOW_CIDR}, SIP ${SIP_PORT}/${SIPS_PORT}, RTP ${RTP_PORT_MIN}-${RTP_PORT_MAX}"

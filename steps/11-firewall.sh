#!/usr/bin/env bash
# nftables: default deny, SIP/RTP/HTTPS allowlist, SIP rate limiting.
# step-inputs: resources/conf/firewall
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/firewall"

apt_install nftables

reason="$(valid_cidr_list "${ADMIN_ALLOW_CIDR:-}")" || die "ADMIN_ALLOW_CIDR in $CONFIG_FILE: $reason"
admin4="" admin6=""
for cidr in $ADMIN_ALLOW_CIDR; do
  case "$cidr" in
    *:*) admin6="${admin6}${admin6:+, }${cidr}" ;;
    *)   admin4="${admin4}${admin4:+, }${cidr}" ;;
  esac
done
# shellcheck disable=SC2034  # read by name from the template
ADMIN_SSH_RULES="$(
  [ -z "$admin4" ] || printf '        ip saddr { %s } tcp dport 22 accept\n' "$admin4"
  [ -z "$admin6" ] || printf '        ip6 saddr { %s } tcp dport 22 accept\n' "$admin6"
)"
if [[ " $ADMIN_ALLOW_CIDR " == *" 0.0.0.0/0 "* || " $ADMIN_ALLOW_CIDR " == *" ::/0 "* ]]; then
  warn "ADMIN_ALLOW_CIDR includes the whole internet ($ADMIN_ALLOW_CIDR) - SSH is exposed to it."
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
invalidate_step 14-responsive-firewall.sh
if has_role sip && [ -f /etc/nftables.d/qwixbox-responsive.nft ]; then
  "$REPO_DIR/steps/14-responsive-firewall.sh"
fi
ok "Firewall active: SSH limited to ${ADMIN_ALLOW_CIDR}, SIP ${SIP_PORT}/${SIPS_PORT}, RTP ${RTP_PORT_MIN}-${RTP_PORT_MAX}"

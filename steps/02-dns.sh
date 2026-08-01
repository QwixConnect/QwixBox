#!/usr/bin/env bash
# Public DNS records. Ordered before 13-tls-certs.sh: Let's Encrypt validates whatever PBX_FQDN
# resolves to. Which provider writes them is lib/dns.sh's problem.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

apt_install curl jq dnsutils

MODE="$(dns_mode)"
info "DNS mode: $MODE"

if ! PUBLIC_IP="$(detect_public_ip)"; then
  [ "$MODE" = "none" ] || die "Could not determine this host's public IP address."
  warn "Could not determine this host's public IP - the records below will need it filled in."
  PUBLIC_IP="<this server's public IP>"
fi
info "Public address: $PUBLIC_IP"

dns_publish A "$PBX_FQDN" "$PUBLIC_IP" 300 false

if [ "${PBX_SIP_DOMAIN:-$PBX_FQDN}" != "$PBX_FQDN" ]; then
  dns_publish A "$PBX_SIP_DOMAIN" "$PUBLIC_IP" 300 false
fi

dns_commit || warn "Not every record could be published - see above."

if [ "$MODE" = "cloudflare" ]; then
  dns_wait_for_record "$PBX_FQDN" "$PUBLIC_IP" A || \
    warn "Continuing anyway - certificate issuance may fail until this propagates."
fi

ok "DNS ready for $PBX_FQDN"

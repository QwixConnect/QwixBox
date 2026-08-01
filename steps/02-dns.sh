#!/usr/bin/env bash
### Public DNS for this host.
###
### Runs before 13-tls-certs.sh on purpose: Let's Encrypt validates against whatever PBX_FQDN
### resolves to, so the record has to exist and have propagated before a certificate is
### requested. Getting that order wrong produces a confusing failure three steps later.
###
### Which provider does the writing is lib/dns.sh's problem. This step only knows which records
### this system needs, which is the part that belongs next to the thing that needs them.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

apt_install curl jq dnsutils

MODE="$(dns_mode)"
info "DNS mode: $MODE"

### Needed by every tier: it is the content of the record on the automated paths, and the value
### the operator has to type on the manual one. A failure is only fatal where we intend to write.
if ! PUBLIC_IP="$(detect_public_ip)"; then
  [ "$MODE" = "none" ] || die "Could not determine this host's public IP address."
  warn "Could not determine this host's public IP - the records below will need it filled in."
  PUBLIC_IP="<this server's public IP>"
fi
info "Public address: $PUBLIC_IP"

### proxied=false is not a default worth changing, and dns_publish refuses anything else.
### Cloudflare's HTTP proxy terminates TLS and only handles HTTP - it cannot carry SIP or RTP, and
### an orange-cloud record would advertise Cloudflare's address to endpoints that need to reach
### this host directly.
dns_publish A "$PBX_FQDN" "$PUBLIC_IP" 300 false

### The SIP domain is usually the same name; only publish a second record when it differs.
if [ "${PBX_SIP_DOMAIN:-$PBX_FQDN}" != "$PBX_FQDN" ]; then
  dns_publish A "$PBX_SIP_DOMAIN" "$PUBLIC_IP" 300 false
fi

dns_commit || warn "Not every record could be published - see above."

### Only the API tier needs this. Domain Connect already waited for each record as its proof the
### user finished approving, and blocking for a minute on the manual tier would delay every
### DNS_PROVIDER=none install - including every automated one - to re-state what was just printed.
if [ "$MODE" = "cloudflare" ]; then
  dns_wait_for_record "$PBX_FQDN" "$PUBLIC_IP" A || \
    warn "Continuing anyway - certificate issuance may fail until this propagates."
fi

ok "DNS ready for $PBX_FQDN"

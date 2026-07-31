#!/usr/bin/env bash
### Public DNS for this host.
###
### Runs before 13-tls-certs.sh on purpose: Let's Encrypt validates against whatever PBX_FQDN
### resolves to, so the record has to exist and have propagated before a certificate is
### requested. Getting that order wrong produces a confusing failure three steps later.
###
### A no-op when DNS_PROVIDER=none, which is the default - plenty of operators manage DNS
### elsewhere, and this must not be a barrier to installing.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

DNS_PROVIDER="${DNS_PROVIDER:-none}"

if [ "$DNS_PROVIDER" = "none" ]; then
  info "DNS_PROVIDER is 'none' - not touching DNS."
  info "  Make sure $PBX_FQDN has an A record pointing at this server before 13-tls-certs.sh."
  exit 0
fi

if [ "$DNS_PROVIDER" != "cloudflare" ]; then
  die "Unknown DNS_PROVIDER '$DNS_PROVIDER'. Supported: none, cloudflare."
fi

apt_install curl jq dnsutils

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || \
  die "DNS_PROVIDER=cloudflare but CLOUDFLARE_API_TOKEN is empty in $CONFIG_FILE."

### --- Verify the token owns the name -------------------------------------------------------

ZONE_ID="$(cf_zone_for_name "$PBX_FQDN")" || \
  die "Could not find a Cloudflare zone for $PBX_FQDN. Check the token's scope covers it."

### Cached so later steps (and re-runs) skip the zone walk. Not a secret, unlike the token.
config_set CLOUDFLARE_ZONE_ID "$ZONE_ID"

### --- A record ------------------------------------------------------------------------------

PUBLIC_IP="$(detect_public_ip)" || die "Could not determine this host's public IP address."
info "Public address: $PUBLIC_IP"

### proxied=false is not a default worth changing. Cloudflare's HTTP proxy terminates TLS and
### only handles HTTP - it cannot carry SIP or RTP, and an orange-cloud record here would
### advertise Cloudflare's address to endpoints that need to reach this host directly.
cf_record_put "$ZONE_ID" A "$PBX_FQDN" "$PUBLIC_IP" 300 false

### The SIP domain is usually the same name; only publish a second record when it differs and
### lives in the same zone.
if [ "${PBX_SIP_DOMAIN:-$PBX_FQDN}" != "$PBX_FQDN" ]; then
  if SIP_ZONE="$(cf_zone_for_name "$PBX_SIP_DOMAIN" 2>/dev/null)"; then
    cf_record_put "$SIP_ZONE" A "$PBX_SIP_DOMAIN" "$PUBLIC_IP" 300 false
  else
    warn "PBX_SIP_DOMAIN ($PBX_SIP_DOMAIN) is not in a zone this token can see - skipping."
  fi
fi

cf_wait_for_record "$PBX_FQDN" "$PUBLIC_IP" A || \
  warn "Continuing anyway - certificate issuance may fail until this propagates."

ok "DNS ready for $PBX_FQDN"

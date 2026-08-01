#!/usr/bin/env bash
### Let's Encrypt certificate plus renewal hooks. One certificate serves nginx (API/WSS),
### Kamailio (SIP TLS) and FreeSWITCH.
###
# step-inputs: resources/conf/tls
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/tls"

apt_install certbot

ACME_CHALLENGE="${ACME_CHALLENGE:-http}"
LIVE="/etc/letsencrypt/live/$PBX_FQDN"
CF_CREDS="$CONFIG_DIR/cloudflare.ini"

### --- Challenge method --------------------------------------------------------------------

### DNS-01 is the only way to get a certificate when port 80 is not reachable from the internet
### - behind a restrictive cloud firewall, on a host with no public HTTP, or for a wildcard.
challenge_args=()
case "$ACME_CHALLENGE" in
  dns)
    [ "${DNS_PROVIDER:-none}" = "cloudflare" ] || \
      die "ACME_CHALLENGE=dns needs DNS_PROVIDER=cloudflare (only provider implemented)."
    [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || \
      die "ACME_CHALLENGE=dns but CLOUDFLARE_API_TOKEN is empty in $CONFIG_FILE."

    apt_install python3-certbot-dns-cloudflare

    ### certbot refuses to use a credentials file that is group- or world-readable, and says so
    ### only in its own output - so the mode is set here rather than left to umask.
    write_file "$CF_CREDS" 0600 root:root <<EOF || true
# Managed by the QwixBox installer. Used by certbot's Cloudflare DNS plugin.
dns_cloudflare_api_token = ${CLOUDFLARE_API_TOKEN}
EOF
    chmod 0600 "$CF_CREDS"

    ### 30s rather than certbot's 10s default: Cloudflare's edge is fast but the plugin polls
    ### authoritative nameservers, and a too-short wait fails validation on a zone that would
    ### have worked a few seconds later.
    challenge_args=(--dns-cloudflare
                    --dns-cloudflare-credentials "$CF_CREDS"
                    --dns-cloudflare-propagation-seconds 30)
    ;;
  http)
    ### standalone binds :80 itself. nginx is not installed yet at this point in the run, so
    ### there is nothing to conflict with; later renewals use the webroot hook below.
    challenge_args=(--standalone --preferred-challenges http)
    ;;
  *)
    die "Unknown ACME_CHALLENGE '$ACME_CHALLENGE'. Use 'http' or 'dns'."
    ;;
esac

### --- Issue -----------------------------------------------------------------------------

if [ -d "$LIVE" ]; then
  ok "Certificate already exists for $PBX_FQDN"
else
  staging_flag=""
  [ "${LETSENCRYPT_STAGING:-0}" = "1" ] && staging_flag="--staging" && \
    warn "Using the Let's Encrypt STAGING CA - the certificate will not be publicly trusted."

  info "Requesting a certificate for $PBX_FQDN (${ACME_CHALLENGE}-01)"
  # shellcheck disable=SC2086
  certbot certonly --non-interactive --agree-tos \
    --email "$LETSENCRYPT_EMAIL" -d "$PBX_FQDN" \
    --key-type ecdsa "${challenge_args[@]}" $staging_flag \
    || if [ "$ACME_CHALLENGE" = "dns" ]; then
         die "Certificate issuance failed. Check the token has DNS:Edit on the zone for $PBX_FQDN."
       else
         die "Certificate issuance failed. Check that $PBX_FQDN resolves here and :80 is reachable."
       fi
  ok "Certificate issued"
fi

### --- Shared copy for the telephony services ---------------------------------------------

### Kamailio and FreeSWITCH do not run as root and must not read /etc/letsencrypt directly.
### Copy the material into a group-readable location instead, and refresh it on renewal.
getent group ssl-cert >/dev/null || groupadd --system ssl-cert
install -d -m 0750 -o root -g ssl-cert /etc/qwixbox/tls

deploy_template "$TPL/qwixbox-deploy-certs" /usr/local/sbin/qwixbox-deploy-certs 0755 || true

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
ln -sf /usr/local/sbin/qwixbox-deploy-certs /etc/letsencrypt/renewal-hooks/deploy/qwixbox-deploy-certs

/usr/local/sbin/qwixbox-deploy-certs
ok "Certificate material published to /etc/qwixbox/tls (group ssl-cert)"

### --- Renewal ---------------------------------------------------------------------------

### certbot ships a systemd timer; make sure it is actually on. Renewal that silently stops
### working is a classic way to take a PBX offline 90 days after install.
systemctl enable --now certbot.timer >/dev/null 2>&1 || true
if systemctl is-enabled --quiet certbot.timer 2>/dev/null; then
  ok "Automatic renewal enabled ($(systemctl show certbot.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo 'timer active'))"
else
  warn "certbot.timer is not enabled - renewals will not happen automatically."
fi

certbot certificates 2>/dev/null | grep -E "Certificate Name|Expiry Date" | sed 's/^/  /' || true
ok "TLS certificates configured"

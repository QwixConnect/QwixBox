#!/usr/bin/env bash
# Let's Encrypt certificates and renewal hooks for SIP TLS, WSS and the API.
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

challenge_args=()
case "$ACME_CHALLENGE" in
  dns)
    [ "${DNS_PROVIDER:-none}" = "cloudflare" ] || \
      die "ACME_CHALLENGE=dns needs DNS_PROVIDER=cloudflare (only provider implemented)."
    [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || \
      die "ACME_CHALLENGE=dns but CLOUDFLARE_API_TOKEN is empty in $CONFIG_FILE."

    apt_install python3-certbot-dns-cloudflare

    write_file "$CF_CREDS" 0600 root:root <<EOF || true
dns_cloudflare_api_token = ${CLOUDFLARE_API_TOKEN}
EOF
    chmod 0600 "$CF_CREDS"

    challenge_args=(--dns-cloudflare
                    --dns-cloudflare-credentials "$CF_CREDS"
                    --dns-cloudflare-propagation-seconds 30)
    ;;
  http)
    challenge_args=(--standalone --preferred-challenges http)
    ;;
  *)
    die "Unknown ACME_CHALLENGE '$ACME_CHALLENGE'. Use 'http' or 'dns'."
    ;;
esac

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

getent group ssl-cert >/dev/null || groupadd --system ssl-cert
install -d -m 0750 -o root -g ssl-cert /etc/qwixbox/tls

deploy_template "$TPL/qwixbox-deploy-certs" /usr/local/sbin/qwixbox-deploy-certs 0755 || true

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
ln -sf /usr/local/sbin/qwixbox-deploy-certs /etc/letsencrypt/renewal-hooks/deploy/qwixbox-deploy-certs

/usr/local/sbin/qwixbox-deploy-certs
ok "Certificate material published to /etc/qwixbox/tls (group ssl-cert)"

systemctl enable --now certbot.timer >/dev/null 2>&1 || true
if systemctl is-enabled --quiet certbot.timer 2>/dev/null; then
  ok "Automatic renewal enabled ($(systemctl show certbot.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo 'timer active'))"
else
  warn "certbot.timer is not enabled - renewals will not happen automatically."
fi

certbot certificates 2>/dev/null | grep -E "Certificate Name|Expiry Date" | sed 's/^/  /' || true
ok "TLS certificates configured"

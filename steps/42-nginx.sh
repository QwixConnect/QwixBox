#!/usr/bin/env bash
# TLS reverse proxy for the API and WSS. `location = /` must exist or an anonymous visitor 404s
# at the site root with no way to reach the login page.
# step-inputs: resources/conf/nginx
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/nginx"

apt_install nginx

WEB_ROOT="${WEB_ROOT:-/var/www/qwixbox-portal}"
TLS_DIR="/etc/qwixbox/tls"

if [ ! -d "$WEB_ROOT" ]; then
  install -d -m 0755 "$WEB_ROOT"
  printf '<!doctype html><title>QwixBox</title><p>Portal not built yet - run 43-portal-web.sh.\n' \
    > "$WEB_ROOT/index.html"
fi
if [ ! -f "$TLS_DIR/fullchain.pem" ]; then
  die "No certificate at $TLS_DIR - run 13-tls-certs.sh first."
fi
usermod -aG ssl-cert www-data 2>/dev/null || true

install -d -m 0755 /var/www/acme
# Step 13 issues an HTTP-01 certificate standalone, before nginx holds :80, so renewal is moved to
# nginx's webroot through the global cli.ini. certbot applies cli.ini over every lineage's own
# renewal config, so on a DNS-01 host the same file turned renewal into HTTP-01 (verified with
# certbot 4.0) - and failed it on a host that chose DNS-01 because :80 is unreachable (I11).
if [ "${ACME_CHALLENGE:-http}" = "http" ]; then
  deploy_template "$TPL/letsencrypt-cli.ini" /etc/letsencrypt/cli.ini || true
elif [ -f /etc/letsencrypt/cli.ini ] && head -1 /etc/letsencrypt/cli.ini | grep -qx '# Managed by the QwixBox installer.'; then
  rm -f /etc/letsencrypt/cli.ini
  info "Removed the webroot cli.ini: renewal uses DNS-01"
fi

rm -f /etc/nginx/sites-enabled/default

NGINX_OVERRIDDEN="server_tokens ssl_protocols ssl_prefer_server_ciphers ssl_ciphers ssl_session_timeout ssl_session_cache ssl_session_tickets"
for directive in $NGINX_OVERRIDDEN; do
  if grep -qE "^[[:space:]]*${directive}[[:space:]]" /etc/nginx/nginx.conf; then
    sed -i -E "s|^([[:space:]]*)(${directive}[[:space:]].*)|\1# \2  # overridden in conf.d/00-hardening.conf|" \
      /etc/nginx/nginx.conf
    info "Neutralised stock ${directive} in nginx.conf"
  fi
done

deploy_template "$TPL/conf.d/00-hardening.conf" /etc/nginx/conf.d/00-hardening.conf || true

deploy_template "$TPL/sites-available/qwixbox-api" /etc/nginx/sites-available/qwixbox-api || true

deploy_template "$TPL/proxy_params" /etc/nginx/proxy_params || true

deploy_template "$TPL/conf.d/01-upgrade-map.conf" /etc/nginx/conf.d/01-upgrade-map.conf || true

ln -sf /etc/nginx/sites-available/qwixbox-api /etc/nginx/sites-enabled/qwixbox-api

nginx -t || die "nginx configuration is invalid."
enable_service nginx
restart_service nginx

ok "nginx serving https://${PBX_FQDN}/ -> 127.0.0.1:${API_PORT}"

#!/usr/bin/env bash
### nginx: TLS termination for the API and the ACME webroot for renewals.
###
# step-inputs: resources/conf/nginx
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/nginx"

apt_install nginx

WEB_ROOT="${WEB_ROOT:-/var/www/voip-portal}"
TLS_DIR="/etc/voip-pbx/tls"

### 43-portal-web.sh publishes the built bundle here. Create a placeholder so nginx has a
### valid root on a first run where the portal has not been built yet.
if [ ! -d "$WEB_ROOT" ]; then
  install -d -m 0755 "$WEB_ROOT"
  printf '<!doctype html><title>VoIP PBX</title><p>Portal not built yet - run 43-portal-web.sh.\n' \
    > "$WEB_ROOT/index.html"
fi
if [ ! -f "$TLS_DIR/fullchain.pem" ]; then
  die "No certificate at $TLS_DIR - run 13-tls-certs.sh first."
fi
usermod -aG ssl-cert www-data 2>/dev/null || true

### ACME renewals switch from standalone to webroot now that nginx owns :80, so certbot never
### needs to stop the web server to renew.
install -d -m 0755 /var/www/acme
deploy_template "$TPL/letsencrypt-cli.ini" /etc/letsencrypt/cli.ini || true

rm -f /etc/nginx/sites-enabled/default

### Debian's stock nginx.conf declares several of the directives we set below at http scope.
### nginx treats a second declaration of most of them as a hard error, not an override, so the
### distro versions are commented out rather than fought with. Doing it as a list means adding
### a directive to 00-hardening.conf only needs the name adding here too.
NGINX_OVERRIDDEN="server_tokens ssl_protocols ssl_prefer_server_ciphers ssl_ciphers ssl_session_timeout ssl_session_cache ssl_session_tickets"
for directive in $NGINX_OVERRIDDEN; do
  if grep -qE "^[[:space:]]*${directive}[[:space:]]" /etc/nginx/nginx.conf; then
    sed -i -E "s|^([[:space:]]*)(${directive}[[:space:]].*)|\1# \2  # overridden in conf.d/00-hardening.conf|" \
      /etc/nginx/nginx.conf
    info "Neutralised stock ${directive} in nginx.conf"
  fi
done

deploy_template "$TPL/conf.d/00-hardening.conf" /etc/nginx/conf.d/00-hardening.conf || true

deploy_template "$TPL/sites-available/voip-api" /etc/nginx/sites-available/voip-api || true

### Debian ships proxy_params, but not with WebSocket upgrade handling - which SIP over WSS
### and any realtime API endpoint both need.
deploy_template "$TPL/proxy_params" /etc/nginx/proxy_params || true

### $connection_upgrade must be defined at http scope for the above to work.
deploy_template "$TPL/conf.d/01-upgrade-map.conf" /etc/nginx/conf.d/01-upgrade-map.conf || true

ln -sf /etc/nginx/sites-available/voip-api /etc/nginx/sites-enabled/voip-api

nginx -t || die "nginx configuration is invalid."
enable_service nginx
restart_service nginx

ok "nginx serving https://${PBX_FQDN}/ -> 127.0.0.1:${API_PORT}"

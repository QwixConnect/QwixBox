#!/usr/bin/env bash
# Outbound mail: Postfix (loopback-only) plus OpenDKIM. Both voicemail-to-email and
# fax-to-email reach the network via `sendmail -t`, so without this they deliver nothing.
# step-inputs: resources/conf/mail
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/mail"

SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
SMTP_FROM="${SMTP_FROM:-pbx@${PBX_FQDN}}"
SMTP_STARTTLS="${SMTP_STARTTLS:-on}"
DKIM_SELECTOR="${DKIM_SELECTOR:-qwixbox}"

# Settings an unattended install takes straight from config.env, without the wizard's checks
# (I12). Mail sent as the template's pbx@example.com fails DMARC everywhere, and its DKIM key and
# DNS records were generated for a domain nobody here owns.
reason="$(valid_email "$SMTP_FROM")" || die "SMTP_FROM=\"$SMTP_FROM\" in $CONFIG_FILE: $reason"
case "$SMTP_STARTTLS" in
  on|off) ;;
  *) die "SMTP_STARTTLS must be \"on\" (STARTTLS, usually 587) or \"off\" (implicit TLS, usually 465)." ;;
esac
if [ -n "$SMTP_HOST" ] && [ "$SMTP_PORT" = 465 ] && [ "$SMTP_STARTTLS" = on ]; then
  die "SMTP_PORT=465 is implicit TLS: set SMTP_STARTTLS=\"off\". With STARTTLS, Postfix waits for a
    plaintext greeting the relay never sends, and every message is deferred."
fi

MAIL_DOMAIN="${MAIL_DOMAIN:-}"
if [ -z "$MAIL_DOMAIN" ]; then
  case "$SMTP_FROM" in
    *@*) MAIL_DOMAIN="${SMTP_FROM#*@}" ;;
    *)   MAIL_DOMAIN="${PBX_FQDN#*.}" ;;
  esac
fi

debconf-set-selections <<EOF
postfix postfix/main_mailer_type select No configuration
postfix postfix/mailname string ${PBX_FQDN}
EOF

apt_install postfix opendkim opendkim-tools

if dpkg-query -W -f='${Status}' msmtp-mta 2>/dev/null | grep -q "install ok installed"; then
  info "Removing msmtp-mta - Postfix now provides sendmail"
  DEBIAN_FRONTEND=noninteractive apt-get purge -y msmtp-mta msmtp >/dev/null 2>&1 || true
  systemctl unmask msmtpd.service >/dev/null 2>&1 || true
fi

KEY_DIR="/etc/opendkim/keys/$MAIL_DOMAIN"
KEY_FILE="$KEY_DIR/${DKIM_SELECTOR}.private"
TXT_FILE="$KEY_DIR/${DKIM_SELECTOR}.txt"

install -d -m 0750 -o opendkim -g opendkim /etc/opendkim/keys
install -d -m 0750 -o opendkim -g opendkim "$KEY_DIR"

if [ ! -f "$KEY_FILE" ]; then
  info "Generating a 2048-bit DKIM key for $MAIL_DOMAIN (selector: $DKIM_SELECTOR)"
  opendkim-genkey -b 2048 -d "$MAIL_DOMAIN" -s "$DKIM_SELECTOR" -D "$KEY_DIR"
  ok "DKIM key generated"
else
  ok "DKIM key already present for $MAIL_DOMAIN"
fi
chown opendkim:opendkim "$KEY_FILE" "$TXT_FILE" 2>/dev/null || true
chmod 0600 "$KEY_FILE"

deploy_template "$TPL/opendkim.conf" /etc/opendkim.conf 0644 || true
deploy_template "$TPL/default-opendkim" /etc/default/opendkim 0644 || true

install -d -m 0750 -o opendkim -g postfix /var/spool/postfix/opendkim
install -d -m 0755 -o opendkim -g opendkim /run/opendkim
if ! id -nG postfix 2>/dev/null | tr ' ' '\n' | grep -qx opendkim; then
  usermod -a -G opendkim postfix
  info "Added postfix to the opendkim group"
fi

# shellcheck disable=SC2034
if [ -n "$SMTP_HOST" ]; then
  RELAYHOST="[${SMTP_HOST}]:${SMTP_PORT}"
  if [ -n "$SMTP_USER" ]; then
    RELAY_BLOCK="smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_sasl_tls_security_options = noanonymous
smtp_tls_security_level = encrypt"
  else
    RELAY_BLOCK="smtp_sasl_auth_enable = no
smtp_tls_security_level = encrypt"
  fi
  # Implicit TLS (465): TLS before the greeting. Only for the relay - the direct path speaks
  # STARTTLS to MX hosts on 25, so this must never apply without SMTP_HOST.
  if [ "$SMTP_STARTTLS" = off ]; then
    RELAY_BLOCK="$RELAY_BLOCK
smtp_tls_wrappermode = yes"
  fi
else
  RELAYHOST=""
  RELAY_BLOCK="smtp_sasl_auth_enable = no
smtp_tls_security_level = may"
  warn "SMTP_HOST is not set - Postfix will deliver directly to recipient MX servers on port 25."
  warn "  GCP blocks outbound port 25 permanently; AWS and Vultr block it until you request an"
  warn "  unblock. Set SMTP_HOST to a relay unless you know port 25 egress works here."
fi
deploy_template "$TPL/main.cf" /etc/postfix/main.cf 0644 || true

if [ -n "$SMTP_HOST" ] && [ -n "$SMTP_USER" ]; then
  deploy_template "$TPL/sasl_passwd" /etc/postfix/sasl_passwd 0600 root:root || true
  chmod 0600 /etc/postfix/sasl_passwd
  postmap /etc/postfix/sasl_passwd
  chmod 0600 /etc/postfix/sasl_passwd.db
else
  rm -f /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
fi

postfix set-permissions >/dev/null 2>&1 || true

systemctl enable opendkim >/dev/null 2>&1 || true
restart_service opendkim
systemctl enable postfix >/dev/null 2>&1 || true
restart_service postfix

if [ ! -x /usr/sbin/sendmail ]; then
  die "Postfix did not provide /usr/sbin/sendmail - voicemail and fax email will not work."
fi

DKIM_VALUE="$(awk '/\(/,/\)/' "$TXT_FILE" 2>/dev/null | grep -o '"[^"]*"' | sed 's/"//g' | tr -d '\n')"
DKIM_NAME="${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}"
DMARC_NAME="_dmarc.${MAIL_DOMAIN}"
DMARC_VALUE="v=DMARC1; p=none; rua=mailto:${LETSENCRYPT_EMAIL}"

SPF_VALUE=""
if [ -z "$SMTP_HOST" ]; then
  if PUBLIC_IP="$(detect_public_ip)"; then
    SPF_VALUE="v=spf1 ip4:${PUBLIC_IP} -all"
  fi
fi

dns_publish TXT "$DKIM_NAME"  "$DKIM_VALUE"  300 false
dns_publish TXT "$DMARC_NAME" "$DMARC_VALUE" 300 false
if [ -n "$SPF_VALUE" ]; then
  dns_publish TXT "$MAIL_DOMAIN" "$SPF_VALUE" 300 false
fi

if [ "${DNS_PUBLISH_MX:-0}" = "1" ]; then
  warn "Publishing an MX for $MAIL_DOMAIN - this host does NOT accept inbound mail."
  dns_publish MX "$MAIL_DOMAIN" "$PBX_FQDN" 300 false
fi

dns_commit || warn "Publish the records above by hand - DKIM will not verify until you do."

if [ -z "$SPF_VALUE" ]; then
  printf '\n'
  printf '  %-40s TXT  v=spf1 include:<your relay> ~all\n' "$MAIL_DOMAIN"
  printf '\n'
  info "  The SPF include comes from your relay provider - it names the servers that will"
  info "  actually send your mail. Ours is not one of them when SMTP_HOST is set."
  printf '\n'
fi

if [ -n "$SMTP_HOST" ]; then
  ok "Mail configured: relaying through ${SMTP_HOST}:${SMTP_PORT} ($([ "$SMTP_STARTTLS" = off ] && echo "implicit TLS" || echo STARTTLS)) as ${SMTP_FROM}"
else
  ok "Mail configured: direct delivery as ${SMTP_FROM}"
fi
ok "DKIM signing for ${MAIL_DOMAIN} (selector ${DKIM_SELECTOR})"
info "Test delivery with:"
info "  printf 'To: you@example.com\\nSubject: QwixBox test\\n\\nhello\\n' | /usr/sbin/sendmail -t"
info "Queue: mailq   Log: /var/log/postfix.log"

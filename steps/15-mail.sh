#!/usr/bin/env bash
### Outbound mail: Postfix for delivery, OpenDKIM for signing.
###
### Two v1 features deliver by email - voicemail-to-email and fax-to-email - and both reach the
### network the same way: they shell out to `sendmail -t`. FreeSWITCH's switch_simple_email()
### does it (switch_utils.c), and the API's fax delivery does it. Debian installs no MTA, so
### without this step both features record the message, log a line, and deliver nothing.
###
### Postfix is bound to loopback only and accepts nothing from the network. That keeps the
### property the earlier msmtp-only design was protecting - a SIP edge must not be able to
### become an open relay - while giving us a milter, which msmtp cannot support at all and
### which is the only way to sign mail with DKIM.
###
### Delivery path, in preference order:
###   SMTP_HOST set  - relay through it on 587 with SASL. This is the path that works on the
###                    cloud: GCP blocks outbound port 25 permanently, and AWS and Vultr block
###                    it until you ask them not to.
###   SMTP_HOST unset - direct to MX on port 25. Needs egress on 25 and a clean IP reputation.
###
### Either way OpenDKIM signs locally, so the DKIM record published for MAIL_DOMAIN is ours.
###
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
DKIM_SELECTOR="${DKIM_SELECTOR:-qwixbox}"

### The domain we sign as, which must match the domain in SMTP_FROM or receivers will fail
### DKIM alignment even though the signature itself verifies.
MAIL_DOMAIN="${MAIL_DOMAIN:-}"
if [ -z "$MAIL_DOMAIN" ]; then
  case "$SMTP_FROM" in
    *@*) MAIL_DOMAIN="${SMTP_FROM#*@}" ;;
    ### No usable From address: fall back to the parent domain of the host name, since a DKIM
    ### record on "pbx.acme.com" is not what a receiver checking "acme.com" mail looks up.
    *)   MAIL_DOMAIN="${PBX_FQDN#*.}" ;;
  esac
fi

### --- Packages -------------------------------------------------------------------------------

### postfix's package asks debconf questions on install; preseeding them keeps the run
### non-interactive and stops it writing a main.cf we are about to replace anyway.
debconf-set-selections <<EOF
postfix postfix/main_mailer_type select No configuration
postfix postfix/mailname string ${PBX_FQDN}
EOF

apt_install postfix opendkim opendkim-tools

### Debian's msmtp-mta also provides /usr/sbin/sendmail, and having both installed leaves the
### alternative pointing at whichever won last. Remove it so there is one answer.
if dpkg-query -W -f='${Status}' msmtp-mta 2>/dev/null | grep -q "install ok installed"; then
  info "Removing msmtp-mta - Postfix now provides sendmail"
  DEBIAN_FRONTEND=noninteractive apt-get purge -y msmtp-mta msmtp >/dev/null 2>&1 || true
  systemctl unmask msmtpd.service >/dev/null 2>&1 || true
fi

### --- OpenDKIM key ----------------------------------------------------------------------------

KEY_DIR="/etc/opendkim/keys/$MAIL_DOMAIN"
KEY_FILE="$KEY_DIR/${DKIM_SELECTOR}.private"
TXT_FILE="$KEY_DIR/${DKIM_SELECTOR}.txt"

install -d -m 0750 -o opendkim -g opendkim /etc/opendkim/keys
install -d -m 0750 -o opendkim -g opendkim "$KEY_DIR"

### Generated once and never rotated, for the same reason config_ensure_secret never rotates a
### secret: the public half is published in DNS, and replacing the key breaks every signature
### until that record propagates.
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

### The milter socket must live inside Postfix's chroot to be reachable at all. Group postfix
### plus UMask 002 in opendkim.conf is what lets Postfix open it.
install -d -m 0750 -o opendkim -g postfix /var/spool/postfix/opendkim
install -d -m 0755 -o opendkim -g opendkim /run/opendkim
if ! id -nG postfix 2>/dev/null | tr ' ' '\n' | grep -qx opendkim; then
  usermod -a -G opendkim postfix
  info "Added postfix to the opendkim group"
fi

### --- Postfix ---------------------------------------------------------------------------------

### RELAYHOST and RELAY_BLOCK are read by name from main.cf, in every branch below. RELAY_BLOCK
### carries smtp_tls_security_level too, so that there is exactly one occurrence of it in the
### rendered file - Postfix honours the last one it sees.
# shellcheck disable=SC2034
if [ -n "$SMTP_HOST" ]; then
  RELAYHOST="[${SMTP_HOST}]:${SMTP_PORT}"
  if [ -n "$SMTP_USER" ]; then
    ### encrypt, not may: this is the only path that puts a password on the wire, and "may"
    ### would let a downgrade strip the TLS and send it in the clear.
    RELAY_BLOCK="smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_sasl_tls_security_options = noanonymous
smtp_tls_security_level = encrypt"
  else
    RELAY_BLOCK="smtp_sasl_auth_enable = no
smtp_tls_security_level = encrypt"
  fi
else
  RELAYHOST=""
  ### Opportunistic only on the direct-to-MX path: plenty of receiving MXs still have no usable
  ### certificate, and refusing them would silently drop voicemail. No credentials are at risk
  ### here - there is no password to leak when we are not authenticating.
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
  ### Postfix reads the compiled .db, not the text file. Forgetting this leaves the old
  ### credentials live with no indication that the file was even read.
  postmap /etc/postfix/sasl_passwd
  chmod 0600 /etc/postfix/sasl_passwd.db
else
  rm -f /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
fi

postfix set-permissions >/dev/null 2>&1 || true

### --- Start ----------------------------------------------------------------------------------

systemctl enable opendkim >/dev/null 2>&1 || true
restart_service opendkim
systemctl enable postfix >/dev/null 2>&1 || true
restart_service postfix

if [ ! -x /usr/sbin/sendmail ]; then
  die "Postfix did not provide /usr/sbin/sendmail - voicemail and fax email will not work."
fi

### --- DNS records ------------------------------------------------------------------------------

### The public half of the signing key, reassembled from opendkim-genkey's output. The file
### wraps the value across several quoted chunks; concatenating the chunk contents (rather than
### stripping every space) preserves the value exactly.
DKIM_VALUE="$(awk '/\(/,/\)/' "$TXT_FILE" 2>/dev/null | grep -o '"[^"]*"' | sed 's/"//g' | tr -d '\n')"
DKIM_NAME="${DKIM_SELECTOR}._domainkey.${MAIL_DOMAIN}"
DMARC_NAME="_dmarc.${MAIL_DOMAIN}"
DMARC_VALUE="v=DMARC1; p=none; rua=mailto:${LETSENCRYPT_EMAIL}"

### SPF names the hosts allowed to send for this domain. When relaying, that is the relay
### provider's infrastructure, not us - and only they know which addresses that is. Publishing
### a guess would authorise the wrong senders and fail the right ones, so the relay case prints
### instructions instead of writing a record.
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

### Nothing here receives mail, so an MX pointing at this host makes every message to the domain
### bounce. Off unless explicitly asked for.
if [ "${DNS_PUBLISH_MX:-0}" = "1" ]; then
  warn "Publishing an MX for $MAIL_DOMAIN - this host does NOT accept inbound mail."
  dns_publish MX "$MAIL_DOMAIN" "$PBX_FQDN" 300 false
fi

### On the manual tier this prints the records instead of writing them, which is the same list
### this step used to format by hand. Never fatal: mail signing works the moment the records
### appear, and holding up the install until then helps nobody.
dns_commit || warn "Publish the records above by hand - DKIM will not verify until you do."

### Independent of any of that. An empty SPF_VALUE means we are relaying, and only the relay
### provider knows which servers to authorise, so this is guidance rather than a record.
if [ -z "$SPF_VALUE" ]; then
  printf '\n'
  printf '  %-40s TXT  v=spf1 include:<your relay> ~all\n' "$MAIL_DOMAIN"
  printf '\n'
  info "  The SPF include comes from your relay provider - it names the servers that will"
  info "  actually send your mail. Ours is not one of them when SMTP_HOST is set."
  printf '\n'
fi

### --- Report ------------------------------------------------------------------------------------

if [ -n "$SMTP_HOST" ]; then
  ok "Mail configured: relaying through ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_FROM}"
else
  ok "Mail configured: direct delivery as ${SMTP_FROM}"
fi
ok "DKIM signing for ${MAIL_DOMAIN} (selector ${DKIM_SELECTOR})"
info "Test delivery with:"
info "  printf 'To: you@example.com\\nSubject: QwixBox test\\n\\nhello\\n' | /usr/sbin/sendmail -t"
info "Queue: mailq   Log: /var/log/postfix.log"

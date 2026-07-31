#!/usr/bin/env bash
#
# The first-run configuration wizard. Sourced from lib/common.sh.
#
# Replaces "edit /etc/qwixbox/config.env in an editor" for the values an operator must supply.
# It deliberately does NOT expose every key in the template - the wizard covers what the installer
# refuses to run without, plus the things people get wrong. Everything else keeps its documented
# default and stays editable in the file.
#
# Writes through config_set, so the file keeps its comments, its 0600 mode, and any secrets that
# earlier runs generated.

# shellcheck shell=bash

### Shown once, before the questions, so the operator knows what they are being asked for and
### that nothing has been changed yet.
_wizard_intro() {
  tui_msg "This configures Qwixbox on this machine.

You will be asked for:
  - the public hostname endpoints will register against
  - an email address for Let's Encrypt
  - which addresses may reach SSH and the admin portal
  - optionally, DNS and outbound mail

Detected defaults are pre-filled. Nothing is written until the end." 18 72
}

run_wizard() {
  require_root

  tui_available || die "The wizard needs a terminal and whiptail (apt install whiptail)."

  ### The file must exist before config_set can rewrite keys in place, and creating it from the
  ### template is what preserves the explanatory comments around every setting.
  if [ ! -f "$CONFIG_FILE" ]; then
    install -d -m 0755 "$CONFIG_DIR"
    install -m 0600 "$REPO_DIR/config.env.example" "$CONFIG_FILE"
  fi
  # shellcheck disable=SC1090
  { set -a; . "$CONFIG_FILE"; set +a; }

  _wizard_intro || return 1

  local fqdn sip_domain email cidr tz roles detected

  ### --- Identity ---------------------------------------------------------------------------

  detected="$(detect_fqdn || true)"
  [ -n "$detected" ] || detected="${PBX_FQDN:-}"
  [ "$detected" = "pbx.example.com" ] && detected=""
  fqdn="$(tui_input_validated \
    "Public hostname for this PBX.

Endpoints register against it and the TLS certificate is issued for it. It must resolve to this
server's public address - the DNS step can create that record for you." \
    "$detected" valid_fqdn)" || return 1

  sip_domain="$(tui_input_validated \
    "SIP domain presented to endpoints.

Usually the same as the hostname above. Change it only if endpoints register against a different
domain than the one on the certificate." \
    "$fqdn" valid_fqdn)" || return 1

  detected="${LETSENCRYPT_EMAIL:-}"
  [ "$detected" = "admin@example.com" ] && detected=""
  email="$(tui_input_validated \
    "Email address for Let's Encrypt.

Used for certificate expiry warnings. It is not published anywhere." \
    "$detected" valid_email)" || return 1

  ### --- Access ----------------------------------------------------------------------------

  detected="$(detect_admin_cidr || true)"
  if [ -z "$detected" ]; then
    detected="${ADMIN_ALLOW_CIDR:-}"
    [ "$detected" = "0.0.0.0/0" ] && detected=""
  fi
  cidr="$(tui_input_validated \
    "Addresses allowed to reach SSH and the admin portal.

Space-separated CIDRs. This was pre-filled from your current SSH connection where possible.
Leaving it as 0.0.0.0/0 exposes SSH to the whole internet." \
    "${detected:-0.0.0.0/0}" valid_cidr_list)" || return 1

  if [ "$cidr" = "0.0.0.0/0" ]; then
    tui_yesno "ADMIN_ALLOW_CIDR is 0.0.0.0/0, which allows SSH from anywhere.

Continue anyway?" || return 1
  fi

  tz="$(tui_input_validated "Timezone (Region/City)." "$(detect_timezone)" valid_timezone)" || return 1

  ### --- Roles ----------------------------------------------------------------------------

  roles="$(tui_menu "What does this machine run?

'all' is the single-server install and is what almost everyone wants. The split-role options are
for spreading the stack across several hosts, and each host then needs its own config." \
    "all"          "Everything on this one server (recommended)" \
    "db"           "PostgreSQL and Redis only" \
    "sip"          "Kamailio and rtpengine (the SIP edge)" \
    "media"        "FreeSWITCH only" \
    "portal"       "API, web portal and nginx")" || return 1

  ### --- Optional sections ------------------------------------------------------------------

  local dns_provider="none" cf_token="" acme="http"
  if tui_yesno "Manage DNS through Cloudflare?

With an API token Qwixbox can create the A record for $fqdn, verify it, and obtain certificates
over DNS instead of HTTP - which is the only way to get a certificate when port 80 is not
reachable from the internet." ; then
    dns_provider="cloudflare"
    cf_token="$(tui_password "Cloudflare API token.

Create it at: My Profile > API Tokens > Create Token
Permissions needed: Zone:Read and DNS:Edit, restricted to the zone for $fqdn.")" || return 1
    if [ -n "$cf_token" ]; then
      tui_yesno "Obtain certificates over DNS (DNS-01) instead of HTTP?

Choose Yes if port 80 is not open to the internet, or if you want wildcard certificates." \
        && acme="dns" || acme="http"
    else
      dns_provider="none"
    fi
  fi

  local smtp_host="" smtp_port="587" smtp_user="" smtp_pass="" smtp_from=""
  if tui_yesno "Configure outbound email now?

Voicemail-to-email and fax-to-email need a relay. You can skip this - both features still record
and store messages, they just do not send them - and run the mail step later." ; then
    smtp_host="$(tui_input "SMTP relay hostname (e.g. smtp.postmarkapp.com)." "${SMTP_HOST:-}")" || return 1
    if [ -n "$smtp_host" ]; then
      smtp_port="$(tui_input "SMTP port. 587 for STARTTLS, 465 for implicit TLS." "${SMTP_PORT:-587}")" || return 1
      smtp_user="$(tui_input "SMTP username (blank if the relay needs no login)." "${SMTP_USER:-}")" || return 1
      [ -n "$smtp_user" ] && { smtp_pass="$(tui_password "SMTP password.")" || return 1; }
      smtp_from="$(tui_input_validated \
        "From address for voicemail and fax notifications.

Its domain must be one you control and can add SPF/DKIM records for." \
        "${SMTP_FROM:-pbx@${fqdn#*.}}" valid_email)" || return 1
    fi
  fi

  ### --- Confirm ----------------------------------------------------------------------------
  ###
  ### Nothing above this point has touched the file. The operator sees the whole set and can still
  ### back out - which is the difference between a wizard and an interrogation.

  tui_yesno "Write this configuration?

  Hostname       $fqdn
  SIP domain     $sip_domain
  LE email       $email
  Admin CIDR     $cidr
  Timezone       $tz
  Roles          $roles
  DNS            $dns_provider (ACME over ${acme})
  SMTP relay     ${smtp_host:-<not configured>}

Written to $CONFIG_FILE. Generated secrets are left untouched." 20 72 || return 1

  config_set PBX_FQDN           "$fqdn"
  config_set PBX_SIP_DOMAIN     "$sip_domain"
  config_set LETSENCRYPT_EMAIL  "$email"
  config_set ADMIN_ALLOW_CIDR   "$cidr"
  config_set TIMEZONE           "$tz"
  config_set ROLES              "$roles"
  config_set DNS_PROVIDER       "$dns_provider"
  config_set ACME_CHALLENGE     "$acme"
  [ -n "$cf_token" ] && config_set CLOUDFLARE_API_TOKEN "$cf_token"

  if [ -n "$smtp_host" ]; then
    config_set SMTP_HOST     "$smtp_host"
    config_set SMTP_PORT     "$smtp_port"
    config_set SMTP_USER     "$smtp_user"
    config_set SMTP_PASSWORD "$smtp_pass"
    config_set SMTP_FROM     "$smtp_from"
  fi

  ok "Wrote $CONFIG_FILE"
  return 0
}

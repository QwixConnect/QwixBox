#!/usr/bin/env bash
#
# First-run configuration wizard. Express path asks four questions and shows what was detected;
# the advanced path is the full linear flow, reachable from the confirmation screen.

# shellcheck shell=bash

# Both paths collect into these; neither sets all of them.
_WZ_FQDN=""; _WZ_SIP_DOMAIN=""; _WZ_EMAIL=""; _WZ_CIDR=""; _WZ_TZ=""; _WZ_ROLES="all"
_WZ_DNS="none"; _WZ_ACME="http"; _WZ_CF_TOKEN=""
_WZ_ADMIN_EMAIL=""; _WZ_TENANT_NAME=""
_WZ_SMTP_HOST=""; _WZ_SMTP_PORT="587"; _WZ_SMTP_USER=""; _WZ_SMTP_PASS=""; _WZ_SMTP_FROM=""

# Not detect_fqdn: its reverse-DNS fallback yields the ISP's PTR, which is plausible enough to
# accept and impossible to certificate. Empty beats wrong - whiptail appends to a default.
_wizard_guess_domain() {
  local n
  n="${PBX_FQDN:-}"
  [ "$n" = "pbx.example.com" ] && n=""
  if [ -z "$n" ]; then
    n="$(hostname -f 2>/dev/null || true)"
    _plausible_fqdn "$n" || n=""
  fi
  [ -n "$n" ] || return 0
  dns_zone_name "$n"
}

_wizard_apply_detected() {
  local d
  _WZ_SIP_DOMAIN="$_WZ_FQDN"
  _WZ_ROLES="all"
  _WZ_TZ="$(detect_timezone)"

  d="$(detect_admin_cidr || true)"
  if [ -z "$d" ]; then
    d="${ADMIN_ALLOW_CIDR:-}"
    [ "$d" = "0.0.0.0/0" ] && d=""
  fi
  _WZ_CIDR="${d:-0.0.0.0/0}"
}

# Returns 0 written, 2 operator wants the full flow, 1 backed out.
_wizard_express() {
  local domain provider guess

  tui_msg "This configures QwixBox on this machine.

It needs four things: your domain, the hostname phones will register against, your company name,
and an email address. Everything else is detected and shown before anything is written.

When it finishes you will have a portal account and a password to sign in with - there is no
default login to look up.

Nothing is changed until you confirm." 17 74 || return 1

  guess="$(_wizard_guess_domain)"
  domain="$(tui_input_validated \
    "Your domain.

The registered name, not the host - 'acme.com' rather than 'pbx.acme.com'. If your DNS provider
supports it, the records can be created for you." \
    "$guess" valid_fqdn)" || return 1

  # Nothing has installed these yet on a fresh host, and a missing dig looks identical to an
  # unsupported provider from the outside.
  if ! command -v dig >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    tui_info "Checking what your DNS provider supports - installing a few tools first." 8 70
    apt_install curl jq dnsutils >/dev/null 2>&1 || true
  fi

  if provider="$(dc_provider_name "$domain" 2>/dev/null)" && [ -n "$provider" ]; then
    if tui_yesno "Your DNS is at ${provider}, which supports automatic setup.

QwixBox can create the records it needs - you approve once in your browser and never touch a DNS
dashboard. No password or API key is stored anywhere.

Set DNS up automatically?" 14 74; then
      _WZ_DNS="domainconnect"
    fi
  fi

  _WZ_FQDN="$(tui_input_validated \
    "Hostname for this PBX.

Endpoints register against it and the TLS certificate is issued for it." \
    "pbx.${domain}" valid_fqdn)" || return 1

  local name_guess="${domain%%.*}"
  name_guess="$(printf '%s' "${name_guess:0:1}" | tr '[:lower:]' '[:upper:]')${name_guess:1}"
  _WZ_TENANT_NAME="$(tui_input_validated \
    "Your company name.

Shown in the portal, and the name this system's tenant is created under." \
    "${TENANT_NAME:-$name_guess}" "")" || return 1

  local email_default="${ADMIN_EMAIL:-${LETSENCRYPT_EMAIL:-}}"
  [ "$email_default" = "admin@example.com" ] && email_default=""
  # One address for both; the advanced flow separates them.
  _WZ_EMAIL="$(tui_input_validated \
    "Your email address.

This is your portal sign-in, and where Let's Encrypt sends certificate expiry warnings. It is
not published anywhere.

A password is generated during the install and shown once at the end." \
    "$email_default" valid_email)" || return 1
  _WZ_ADMIN_EMAIL="$_WZ_EMAIL"

  _wizard_apply_detected

  # Domain Connect needs a human per approval, so it cannot renew dns-01.
  _WZ_ACME="http"

  _wizard_confirm
}

_wizard_confirm() {
  local dns_line choice
  # Read by tui_menu via dynamic scoping; whiptail truncates a prompt that does not fit.
  # shellcheck disable=SC2034  # read by tui_menu in lib/tui.sh
  local TUI_MENU_HEIGHT=26 TUI_MENU_LIST=3

  case "$_WZ_DNS" in
    domainconnect) dns_line="automatic, via your DNS provider" ;;
    cloudflare)    dns_line="Cloudflare API token" ;;
    *)             dns_line="you create the records yourself" ;;
  esac

  choice="$(tui_menu "Ready to install.

  Company        ${_WZ_TENANT_NAME:-<not set>}
  Hostname       $_WZ_FQDN
  SIP domain     $_WZ_SIP_DOMAIN
  Portal login   ${_WZ_ADMIN_EMAIL:-<create one later>}
  Certificate    $_WZ_EMAIL  (over ${_WZ_ACME}-01)
  Admin access   $_WZ_CIDR
  Timezone       $_WZ_TZ
  Roles          $_WZ_ROLES
  DNS            $dns_line
  Mail           configure later" \
    "install"  "Write this and install" \
    "change"   "Change these settings" \
    "cancel"   "Back out - write nothing")" || return 1

  case "$choice" in
    install) _wizard_check_cidr || return 1; _wizard_write; return 0 ;;
    change)  return 2 ;;
    *)       return 1 ;;
  esac
}

# An interlock, not a question - hence it survives into the express path.
_wizard_check_cidr() {
  [ "$_WZ_CIDR" = "0.0.0.0/0" ] || return 0
  tui_yesno "ADMIN_ALLOW_CIDR is 0.0.0.0/0, which allows SSH from anywhere.

Continue anyway?" || return 1
}

# The full linear flow. Every field the wizard exposes is reachable here.
_wizard_advanced() {
  local detected

  detected="$_WZ_FQDN"
  if [ -z "$detected" ]; then
    detected="$(detect_fqdn || true)"
    [ -n "$detected" ] || detected="${PBX_FQDN:-}"
    [ "$detected" = "pbx.example.com" ] && detected=""
  fi
  _WZ_FQDN="$(tui_input_validated \
    "Public hostname for this PBX.

Endpoints register against it and the TLS certificate is issued for it. It must resolve to this
server's public address - the DNS step can create that record for you." \
    "$detected" valid_fqdn)" || return 1

  _WZ_SIP_DOMAIN="$(tui_input_validated \
    "SIP domain presented to endpoints.

Usually the same as the hostname above. Change it only if endpoints register against a different
domain than the one on the certificate." \
    "${_WZ_SIP_DOMAIN:-$_WZ_FQDN}" valid_fqdn)" || return 1

  detected="${_WZ_EMAIL:-${LETSENCRYPT_EMAIL:-}}"
  [ "$detected" = "admin@example.com" ] && detected=""
  _WZ_EMAIL="$(tui_input_validated \
    "Email address for Let's Encrypt.

Used for certificate expiry warnings. It is not published anywhere." \
    "$detected" valid_email)" || return 1

  detected="$_WZ_CIDR"
  [ -n "$detected" ] || detected="$(detect_admin_cidr || true)"
  if [ -z "$detected" ]; then
    detected="${ADMIN_ALLOW_CIDR:-}"
    [ "$detected" = "0.0.0.0/0" ] && detected=""
  fi
  _WZ_CIDR="$(tui_input_validated \
    "Addresses allowed to reach SSH and the admin portal.

Space-separated CIDRs. This was pre-filled from your current SSH connection where possible.
Leaving it as 0.0.0.0/0 exposes SSH to the whole internet." \
    "${detected:-0.0.0.0/0}" valid_cidr_list)" || return 1

  _wizard_check_cidr || return 1

  _WZ_TZ="$(tui_input_validated "Timezone (Region/City)." \
    "${_WZ_TZ:-$(detect_timezone)}" valid_timezone)" || return 1

  _WZ_ROLES="$(tui_menu "What does this machine run?

'all' is the single-server install and is what almost everyone wants. The split-role options are
for spreading the stack across several hosts, and each host then needs its own config." \
    "all"          "Everything on this one server (recommended)" \
    "db"           "PostgreSQL and Redis only" \
    "sip"          "Kamailio and rtpengine (the SIP edge)" \
    "media"        "FreeSWITCH only" \
    "portal"       "API, web portal and nginx")" || return 1

  _wizard_account_advanced || return 1
  _wizard_dns_advanced || return 1
  _wizard_smtp_advanced || return 1

  _wizard_confirm_advanced
}

_wizard_account_advanced() {
  _WZ_TENANT_NAME="$(tui_input \
    "Company name. Shown in the portal, and the name the tenant is created under." \
    "${_WZ_TENANT_NAME:-${TENANT_NAME:-}}")" || return 1

  if ! tui_yesno "Create a portal account during the install?

Otherwise the install finishes with no way to sign in, and you run create-user.ts and
provision-tenant.ts on the server yourself." 12 74; then
    _WZ_ADMIN_EMAIL=""
    return 0
  fi

  _WZ_ADMIN_EMAIL="$(tui_input_validated \
    "Email address to sign in to the portal with.

A password is generated during the install and shown once at the end - there is no default
credential to look up." \
    "${_WZ_ADMIN_EMAIL:-${ADMIN_EMAIL:-$_WZ_EMAIL}}" valid_email)" || return 1
}

_wizard_dns_advanced() {
  local choice

  choice="$(tui_menu "How should DNS records be created?

The A record for $_WZ_FQDN has to exist before a certificate can be issued." \
    "auto"       "Automatically, via my DNS provider (Domain Connect)" \
    "cloudflare" "With a Cloudflare API token" \
    "none"       "I will create the records myself")" || return 1

  case "$choice" in
    auto)
      if dc_available "$_WZ_FQDN"; then
        _WZ_DNS="domainconnect"
      else
        tui_msg "That domain's DNS provider does not advertise Domain Connect support, so this
cannot be automatic. Falling back to creating the records yourself.

Supported providers include GoDaddy, IONOS, Cloudflare, NameSilo, Plesk, Vercel and
WordPress.com." 14 74
        _WZ_DNS="none"
      fi
      _WZ_ACME="http"
      ;;
    cloudflare)
      _WZ_CF_TOKEN="$(tui_password "Cloudflare API token.

Create it at: My Profile > API Tokens > Create Token
Permissions needed: Zone:Read and DNS:Edit, restricted to the zone for $_WZ_FQDN.")" || return 1
      if [ -n "$_WZ_CF_TOKEN" ]; then
        _WZ_DNS="cloudflare"
        # The only tier that can renew unattended.
        tui_yesno "Obtain certificates over DNS (DNS-01) instead of HTTP?

Choose Yes if port 80 is not open to the internet, or if you want wildcard certificates." \
          && _WZ_ACME="dns" || _WZ_ACME="http"
      else
        _WZ_DNS="none"
      fi
      ;;
    *)
      _WZ_DNS="none"; _WZ_ACME="http"
      ;;
  esac
}

_wizard_smtp_advanced() {
  tui_yesno "Configure outbound email now?

Voicemail-to-email and fax-to-email need a relay. You can skip this - both features still record
and store messages, they just do not send them - and run the mail step later." || return 0

  _WZ_SMTP_HOST="$(tui_input "SMTP relay hostname (e.g. smtp.postmarkapp.com)." "${SMTP_HOST:-}")" || return 1
  [ -n "$_WZ_SMTP_HOST" ] || return 0

  _WZ_SMTP_PORT="$(tui_input "SMTP port. 587 for STARTTLS, 465 for implicit TLS." "${SMTP_PORT:-587}")" || return 1
  _WZ_SMTP_USER="$(tui_input "SMTP username (blank if the relay needs no login)." "${SMTP_USER:-}")" || return 1
  [ -n "$_WZ_SMTP_USER" ] && { _WZ_SMTP_PASS="$(tui_password "SMTP password.")" || return 1; }
  _WZ_SMTP_FROM="$(tui_input_validated \
    "From address for voicemail and fax notifications.

Its domain must be one you control and can add SPF/DKIM records for." \
    "${SMTP_FROM:-pbx@${_WZ_FQDN#*.}}" valid_email)" || return 1
}

# Nothing above has touched the file.
_wizard_confirm_advanced() {
  tui_yesno "Write this configuration?

  Company        ${_WZ_TENANT_NAME:-<not set>}
  Hostname       $_WZ_FQDN
  SIP domain     $_WZ_SIP_DOMAIN
  Portal login   ${_WZ_ADMIN_EMAIL:-<create one later>}
  LE email       $_WZ_EMAIL
  Admin CIDR     $_WZ_CIDR
  Timezone       $_WZ_TZ
  Roles          $_WZ_ROLES
  DNS            $_WZ_DNS (ACME over ${_WZ_ACME})
  SMTP relay     ${_WZ_SMTP_HOST:-<not configured>}

Written to $CONFIG_FILE. Generated secrets are left untouched." 22 72 || return 1

  _wizard_write
}

_wizard_write() {
  config_set PBX_FQDN           "$_WZ_FQDN"
  config_set PBX_SIP_DOMAIN     "$_WZ_SIP_DOMAIN"
  config_set LETSENCRYPT_EMAIL  "$_WZ_EMAIL"
  config_set ADMIN_ALLOW_CIDR   "$_WZ_CIDR"
  config_set TIMEZONE           "$_WZ_TZ"
  config_set ROLES              "$_WZ_ROLES"
  config_set DNS_PROVIDER       "$_WZ_DNS"
  config_set ACME_CHALLENGE     "$_WZ_ACME"
  config_set ADMIN_EMAIL        "$_WZ_ADMIN_EMAIL"
  config_set TENANT_NAME        "$_WZ_TENANT_NAME"
  [ -n "$_WZ_CF_TOKEN" ] && config_set CLOUDFLARE_API_TOKEN "$_WZ_CF_TOKEN"

  if [ -n "$_WZ_SMTP_HOST" ]; then
    config_set SMTP_HOST     "$_WZ_SMTP_HOST"
    config_set SMTP_PORT     "$_WZ_SMTP_PORT"
    # The port the wizard offers is what decides the mode; step 15 refuses 465 with STARTTLS.
    if [ "$_WZ_SMTP_PORT" = 465 ]; then config_set SMTP_STARTTLS off; else config_set SMTP_STARTTLS on; fi
    config_set SMTP_USER     "$_WZ_SMTP_USER"
    config_set SMTP_PASSWORD "$_WZ_SMTP_PASS"
    config_set SMTP_FROM     "$_WZ_SMTP_FROM"
  fi

  ok "Wrote $CONFIG_FILE"
}

run_wizard() {
  local rc

  require_root
  tui_available || die "The wizard needs a terminal and whiptail (apt install whiptail)."

  # config_set rewrites keys in place, so the template has to be there first.
  if [ ! -f "$CONFIG_FILE" ]; then
    install -d -m 0755 "$CONFIG_DIR"
    install -m 0600 "$REPO_DIR/config.env.example" "$CONFIG_FILE"
  fi
  # shellcheck disable=SC1090
  { set -a; . "$CONFIG_FILE"; set +a; }

  _wizard_express; rc=$?
  [ "$rc" -eq 2 ] || return "$rc"

  # Pre-filled from what express collected, so "Change these" edits rather than re-asks.
  _wizard_advanced
}

#!/usr/bin/env bash
#
# Domain Connect, synchronous flow. The user approves once at their own DNS provider; we hold no
# credential. Discovery is a _domainconnect TXT lookup, so a non-participating provider just
# falls through. Cannot renew anything (needs a human), so dns-01 goes to a credentialled tier.

# shellcheck shell=bash

# providerId must match what was onboarded with each DNS provider; changing it invalidates
# every agreement.
DC_PROVIDER_ID="${DC_PROVIDER_ID:-qwixbox.com}"
DC_SERVICE_HOST="${DC_SERVICE_HOST:-pbx-host}"
DC_SERVICE_MAIL="${DC_SERVICE_MAIL:-pbx-mail}"

_DC_SETTINGS=""
_DC_DOMAIN=""
_DC_QUERIED=""

# Walks upward to the domain carrying the record. Settings JSON on stdout, diagnostics on stderr
# because callers capture this with $( ).
dc_discover() {
  local candidate="${1:-${PBX_FQDN:-}}" authority resp

  [ -n "$candidate" ] || return 1
  command -v dig >/dev/null 2>&1 || return 1
  command -v curl >/dev/null 2>&1 || return 1

  # Keyed on the requested name: the wizard probes a domain, steps later probe a host under it.
  if [ -n "$_DC_SETTINGS" ] && [ "$_DC_QUERIED" = "$candidate" ]; then
    printf '%s' "$_DC_SETTINGS"; return 0
  fi
  _DC_QUERIED="$candidate"

  while [ "${candidate#*.}" != "$candidate" ]; do
    # Quoted lines only. Providers often publish _domainconnect as a CNAME, and `dig +short TXT`
    # prints the chain - the unquoted CNAME target is not an API authority.
    authority="$(dig +short @1.1.1.1 "_domainconnect.$candidate" TXT 2>/dev/null \
      | grep '^"' | tr -d '"' | head -1)"

    if [ -n "$authority" ]; then
      authority="${authority#https://}"; authority="${authority#http://}"

      # 404 means the record exists but this domain is not one they serve settings for - a
      # fall-through, not a fault worth reporting.
      local status
      status="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' \
        "https://${authority}/v2/${candidate}/settings" 2>/dev/null)" || status="000"
      case "$status" in
        200) resp="$(curl -fsS -m 10 "https://${authority}/v2/${candidate}/settings" 2>/dev/null)" ;;
        404) return 1 ;;
        *)   warn "$candidate's Domain Connect API answered $status - not using it." >&2; return 1 ;;
      esac
      if printf '%s' "$resp" | jq -e '.urlSyncUX' >/dev/null 2>&1; then
        _DC_SETTINGS="$resp"; _DC_DOMAIN="$candidate"
        printf '%s' "$resp"
        return 0
      fi
      warn "$candidate's DNS provider does not offer the synchronous flow." >&2
      return 1
    fi
    candidate="${candidate#*.}"
  done

  return 1
}

dc_available() { dc_discover "$1" >/dev/null 2>&1; }

dc_provider_name() {
  local settings
  settings="$(dc_discover "${1:-}")" || return 1
  printf '%s' "$(printf '%s' "$settings" | jq -r '.providerDisplayName // .providerName // empty')"
}

# Unsigned: signing guards against a tampered URL, and the installer builds this locally for the
# operator's own terminal. Revisit if we ever hand the URL over.
dc_apply_url() {
  local service="$1"; shift
  local settings sync_ux url pair

  settings="$(dc_discover)" || return 1
  sync_ux="$(printf '%s' "$settings" | jq -r '.urlSyncUX')"

  url="${sync_ux}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${service}/apply"
  url="${url}?domain=$(_dc_urlencode "$_DC_DOMAIN")"

  for pair in "$@"; do
    url="${url}&${pair%%=*}=$(_dc_urlencode "${pair#*=}")"
  done

  printf '%s' "$url"
}

_dc_urlencode() {
  jq -rn --arg v "$1" '$v|@uri'
}

# Empty when the name IS the domain, which Domain Connect expects as an absent host.
_dc_host_of() {
  local name="$1"
  [ "$name" = "$_DC_DOMAIN" ] && return 0
  printf '%s' "${name%".$_DC_DOMAIN"}"
}

# Grouped by record type rather than by an argument: the two moments an install needs DNS are
# already separated in time (A at step 02, mail at step 15).
dc_commit() {
  local i have_addr=0 have_mail=0
  local -a addr_vars=() mail_vars=()

  [ "${#DNS_Q_TYPE[@]}" -gt 0 ] || return 0
  dc_discover >/dev/null || { fail "Domain Connect discovery failed."; return 1; }

  for i in "${!DNS_Q_TYPE[@]}"; do
    case "${DNS_Q_TYPE[$i]}" in
      A)
        have_addr=1
        if [ "${DNS_Q_NAME[$i]}" = "${PBX_SIP_DOMAIN:-}" ] && [ "${DNS_Q_NAME[$i]}" != "${PBX_FQDN:-}" ]; then
          addr_vars+=("siphost=$(_dc_host_of "${DNS_Q_NAME[$i]}")")
        else
          addr_vars+=("host=$(_dc_host_of "${DNS_Q_NAME[$i]}")" "ip=${DNS_Q_CONTENT[$i]}")
        fi
        ;;
      TXT)
        have_mail=1
        case "${DNS_Q_NAME[$i]}" in
          *._domainkey.*) mail_vars+=("dkim=${DNS_Q_CONTENT[$i]}" "selector=${DKIM_SELECTOR:-qwixbox}") ;;
          _dmarc.*)       mail_vars+=("dmarc=${DNS_Q_CONTENT[$i]}") ;;
          *)              mail_vars+=("spf=${DNS_Q_CONTENT[$i]}") ;;
        esac
        ;;
      MX)
        have_mail=1
        mail_vars+=("mx=${DNS_Q_CONTENT[$i]}")
        ;;
    esac
  done

  [ "$have_addr" -eq 1 ] && { _dc_apply "$DC_SERVICE_HOST" "${addr_vars[@]}" || return 1; }
  [ "$have_mail" -eq 1 ] && { _dc_apply "$DC_SERVICE_MAIL" "${mail_vars[@]}" || return 1; }
  return 0
}

# No callback exists - the browser is on the user's machine, which cannot reach this host - so
# watching public DNS is both the completion signal and the only proof worth having.
_dc_apply() {
  local service="$1"; shift
  local url i

  url="$(dc_apply_url "$service" "$@")" || return 1

  if tui_available; then
    tui_msg "Open this on any device to approve the DNS changes:

$url

Your DNS provider will ask you to sign in and confirm. Nothing is changed until you approve, and
this installer never sees your DNS password.

Waiting for the records once you have approved." 20 78
  else
    printf '\n  Approve the DNS changes at:\n\n    %s\n\n' "$url"
  fi

  command -v qrencode >/dev/null 2>&1 && qrencode -t ANSIUTF8 -m 2 "$url" >&2

  for i in "${!DNS_Q_TYPE[@]}"; do
    dns_wait_for_record "${DNS_Q_NAME[$i]}" "${DNS_Q_CONTENT[$i]}" "${DNS_Q_TYPE[$i]}" 150 || {
      warn "Did not see ${DNS_Q_TYPE[$i]} ${DNS_Q_NAME[$i]} after approving."
      dns_print_queue
      return 1
    }
  done

  ok "DNS records applied via $(dc_provider_name || printf 'your DNS provider')"
}

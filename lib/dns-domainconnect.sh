#!/usr/bin/env bash
#
# Domain Connect, the synchronous flow. Sourced from lib/common.sh; do not execute.
#
# The user opens one URL, their own DNS provider authenticates them and applies our template in
# that same session. We hold no credential, before or after - which is why this tier is tried
# first, and why it needs no service of ours running anywhere.
#
# Discovery is a DNS lookup: _domainconnect names the provider's settings API. A domain whose
# provider does not participate simply has no such record, and lib/dns.sh falls through.
#
# Two limits worth knowing before extending this:
#
#   - Templates are onboarded with each DNS provider out of band, by agreement. Shipping a new
#     record type means renegotiating with every provider, so the templates are deliberately
#     wider than one install needs rather than exactly fitted to it.
#   - The flow needs a human in a browser, so it cannot renew anything. dns-01 certificate
#     renewal is not available on this tier; lib/dns.sh routes that to a credentialled tier.

# shellcheck shell=bash

### Our identity in the Domain Connect ecosystem. providerId is the domain the templates are
### registered under and must match what was onboarded with each DNS provider - changing it
### invalidates every agreement.
DC_PROVIDER_ID="${DC_PROVIDER_ID:-qwixbox.io}"
DC_SERVICE_HOST="${DC_SERVICE_HOST:-pbx-host}"
DC_SERVICE_MAIL="${DC_SERVICE_MAIL:-pbx-mail}"

_DC_SETTINGS=""   # cached settings JSON
_DC_DOMAIN=""     # the registered domain the settings belong to
_DC_QUERIED=""    # the name that produced the cache, so a different one re-probes

### Finds the domain that actually carries the _domainconnect record, walking upward from the
### name we were given. "pbx.acme.com" has no such record; "acme.com" does - and assuming the
### last two labels breaks on acme.co.uk, which is a three-label zone.
###
### Prints the settings JSON on stdout. Diagnostics go to stderr: callers capture this with $( ),
### and an info line on stdout would be parsed as part of the JSON.
dc_discover() {
  local candidate="${1:-${PBX_FQDN:-}}" authority resp

  [ -n "$candidate" ] || return 1
  command -v dig >/dev/null 2>&1 || return 1
  command -v curl >/dev/null 2>&1 || return 1

  ### Cached per requested name, not globally: the wizard probes one domain and the steps later
  ### probe a host under it, and returning the first answer to the second question would apply a
  ### template to the wrong domain.
  if [ -n "$_DC_SETTINGS" ] && [ "$_DC_QUERIED" = "$candidate" ]; then
    printf '%s' "$_DC_SETTINGS"; return 0
  fi
  _DC_QUERIED="$candidate"

  while [ "${candidate#*.}" != "$candidate" ]; do
    ### Quoted lines only. Providers commonly publish _domainconnect as a CNAME into their own
    ### zone (IONOS does this for every domain it registers), and `dig +short TXT` prints the
    ### chain: unquoted CNAME targets first, then the quoted TXT value if the chain ends in one.
    ### Taking the first line therefore picks up a host name that is not an API authority -
    ### _domainconnect.wordpress.com resolves to lb.wordpress.com and has no TXT at all. Quoting
    ### is what distinguishes the answer from the path taken to reach it.
    authority="$(dig +short @1.1.1.1 "_domainconnect.$candidate" TXT 2>/dev/null \
      | grep '^"' | tr -d '"' | head -1)"

    if [ -n "$authority" ]; then
      ### The record holds an authority plus path prefix, not a URL - the scheme and the /v2
      ### suffix are ours to add. A record that already carries a scheme is malformed, but
      ### tolerating it costs one substitution and saves a confusing failure.
      authority="${authority#https://}"; authority="${authority#http://}"

      ### A 404 here is a real and unremarkable answer: the record exists but this domain is not
      ### one the provider serves settings for. Reported separately from an unreachable API
      ### because only one of the two is worth investigating.
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
      ### Reachable but no synchronous UX. The async OAuth flow would need a registration with
      ### this provider that we do not have, so this is a fall-through, not a failure.
      warn "$candidate's DNS provider does not offer the synchronous flow." >&2
      return 1
    fi
    candidate="${candidate#*.}"
  done

  return 1
}

### Boolean wrapper, for the wizard and for dns_mode's auto path.
dc_available() { dc_discover "$1" >/dev/null 2>&1; }

### Human name of the provider, for the wizard. Falls back to the domain so the prompt never
### reads "your DNS is at ".
dc_provider_name() {
  local settings
  settings="$(dc_discover "${1:-}")" || return 1
  printf '%s' "$(printf '%s' "$settings" | jq -r '.providerDisplayName // .providerName // empty')"
}

### Builds the apply URL for one service, with template variables as query parameters.
###
### Unsigned. Signing is optional in the spec and needs a private key plus a public key published
### in DNS; it protects against a tampered URL, which matters when a third party constructs the
### link. Here the installer builds it locally and the user reads it off their own terminal, so
### the threat it defends against is not present. Revisit if the URL is ever handed over by us.
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

### The host part of a name relative to the registered domain: "pbx.acme.com" in "acme.com" is
### "pbx". Empty when the name IS the domain, which Domain Connect expects as an absent host.
_dc_host_of() {
  local name="$1"
  [ "$name" = "$_DC_DOMAIN" ] && return 0
  printf '%s' "${name%".$_DC_DOMAIN"}"
}

### Applies whatever lib/dns.sh queued.
###
### Records are grouped onto the two registered templates by type, rather than the caller naming
### one: the two moments an install needs DNS are already separated in time - A records at step
### 02, mail records at step 15 - so the grouping falls out of what is in the queue and there is
### no third call site to keep in sync.
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

### Shows the URL and waits for the records to appear.
###
### There is no callback: the user approves in a browser on their own machine, which cannot reach
### this host. Watching public DNS is both the completion signal and the only proof worth having -
### the provider reporting success would still leave "can anyone resolve it" unanswered.
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

  ### A QR saves retyping a long URL onto a phone. Absent qrencode is not worth failing over.
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

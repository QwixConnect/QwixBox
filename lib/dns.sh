#!/usr/bin/env bash
#
# Provider-independent DNS publishing. Steps call dns_resolve_mode, then dns_publish, then
# dns_commit.
# Tiers: domainconnect (no credential), cloudflare (API token, the only one that can renew
# dns-01), none (print the records). lib/dns-{cloudflare,domainconnect}.sh implement them.

# shellcheck shell=bash

# Parallel arrays: a DKIM TXT value contains any separator worth using.
DNS_Q_TYPE=(); DNS_Q_NAME=(); DNS_Q_CONTENT=(); DNS_Q_TTL=()

_DNS_MODE=""
# Set when a provider refused a record; dns_commit then prints the queue and returns 1.
_DNS_FAILED=0

# Guess at the registered domain, for pre-filling the wizard. Strips one label at three or more,
# so pbx.acme.co.uk gives acme.co.uk rather than co.uk. dc_discover does not trust this.
dns_zone_name() {
  local name="${1:-${PBX_FQDN:-}}"
  if [ "$(printf '%s' "$name" | tr -cd . | wc -c)" -ge 2 ]; then
    name="${name#*.}"
  fi
  printf '%s' "$name"
}

# Sets _DNS_MODE in the calling shell. It must not be run inside $( ): the cache would die with the
# subshell, and every later call would rediscover - for `auto`, a fresh network probe that could
# choose differently half-way through a step (I11). dns_publish and dns_commit call it themselves.
dns_resolve_mode() {
  [ -n "$_DNS_MODE" ] && return 0

  local configured="${DNS_PROVIDER:-none}"

  case "$configured" in
    none)          _DNS_MODE="none" ;;
    cloudflare)    _DNS_MODE="cloudflare" ;;
    domainconnect) _DNS_MODE="domainconnect" ;;
    auto)
      # Full host name: dc_discover walks upward and gets three-label suffixes right.
      if dc_available "${PBX_FQDN:-}"; then
        _DNS_MODE="domainconnect"
      elif [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
        _DNS_MODE="cloudflare"
      else
        _DNS_MODE="none"
      fi
      ;;
    *)
      die "Unknown DNS_PROVIDER '$configured'. Supported: none, cloudflare, domainconnect, auto."
      ;;
  esac
}

dns_mode() { dns_resolve_mode; printf '%s' "$_DNS_MODE"; }

_dns_queue() {
  DNS_Q_TYPE+=("$1"); DNS_Q_NAME+=("$2"); DNS_Q_CONTENT+=("$3"); DNS_Q_TTL+=("$4")
}

# Queues or writes, tier's choice. Callers must assume nothing landed until dns_commit returns.
# Never fails the step: a record the provider refused is queued for dns_commit to print, so the
# manual fallback the caller promises actually appears. Under set -e a bare failure here aborted
# the step before it (I11).
# proxied is always false: Cloudflare's proxy cannot carry SIP or RTP.
dns_publish() {
  local type="$1" name="$2" content="$3" ttl="${4:-300}" proxied="${5:-false}"

  [ "$proxied" = "false" ] || die "dns_publish: proxied=true is never correct for this system ($name)."

  dns_resolve_mode
  case "$_DNS_MODE" in
    cloudflare)
      local zone
      if ! zone="$(cf_zone_for_name "$name")" \
         || ! cf_record_put "$zone" "$type" "$name" "$content" "$ttl" false; then
        warn "Cloudflare did not take the $type record for $name."
        _DNS_FAILED=1
        _dns_queue "$type" "$name" "$content" "$ttl"
      fi
      ;;
    domainconnect|none)
      _dns_queue "$type" "$name" "$content" "$ttl"
      ;;
  esac
}

dns_commit() {
  local rc=0

  dns_resolve_mode
  case "$_DNS_MODE" in
    domainconnect) dc_commit || rc=$? ;;
    none) [ "${#DNS_Q_TYPE[@]}" -gt 0 ] && dns_print_queue ;;
    cloudflare)
      if [ "$_DNS_FAILED" = 1 ]; then
        dns_print_queue
        rc=1
      fi
      ;;
  esac
  _DNS_FAILED=0

  DNS_Q_TYPE=(); DNS_Q_NAME=(); DNS_Q_CONTENT=(); DNS_Q_TTL=()
  return "$rc"
}

dns_print_queue() {
  local i
  info "Create these DNS records before continuing:"
  for i in "${!DNS_Q_TYPE[@]}"; do
    printf '      %-5s %-45s %s\n' \
      "${DNS_Q_TYPE[$i]}" "${DNS_Q_NAME[$i]}" "${DNS_Q_CONTENT[$i]}"
  done
}

# Asks 1.1.1.1 rather than the system resolver, which may hold a stale answer. An API reporting
# success means stored, not resolvable.
dns_wait_for_record() {
  local name="$1" expect="$2" type="${3:-A}" tries="${4:-30}" got i

  command -v dig >/dev/null 2>&1 || { warn "dig not installed - not waiting for $name."; return 0; }

  for i in $(seq 1 "$tries"); do
    got="$(dig +short @1.1.1.1 "$name" "$type" 2>/dev/null | tr -d '"' | head -1)"

    # TXT is presence-only: a DKIM key exceeds 255 bytes and comes back split into chunks that
    # do not reassemble into what we sent.
    if [ "$type" = "TXT" ]; then
      [ -n "$got" ] && { ok "$name has a $type record"; return 0; }
    elif [ "$got" = "$expect" ]; then
      ok "$name resolves to $expect"
      return 0
    fi

    [ "$i" -eq 1 ] && info "Waiting for $name"
    sleep 2
  done

  warn "$name still does not resolve as expected (last answer: ${got:-none})."
  return 1
}

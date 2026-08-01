#!/usr/bin/env bash
#
# DNS publishing, provider-independent. Sourced from lib/common.sh; do not execute.
#
# Every step that needs a public DNS record calls dns_publish, then dns_commit. Nothing outside
# this file knows which provider is in play - that was the point of extracting it, because the
# record SET (what this system needs in DNS) and the record TRANSPORT (how it gets there) change
# for completely different reasons and used to live in the same twenty lines.
#
# Three tiers, tried in this order unless DNS_PROVIDER pins one:
#
#   domainconnect      the user approves once at their own DNS provider. No credential is held
#                      anywhere, which is why it is first.
#   cloudflare         a long-lived API token in config.env. The original path; still the answer
#                      for an unattended install, and the only tier that can renew a dns-01
#                      certificate, since that needs a credential rather than a person.
#   none               print the records and carry on. Not a failure: plenty of operators manage
#                      DNS somewhere this cannot reach, and that must never block an install.
#
# lib/dns-cloudflare.sh and lib/dns-domainconnect.sh implement the tiers. This file only decides.
#
# A brokered Cloudflare OAuth tier is designed (docs/) and deliberately not wired here: there is
# no broker deployed, and a mode that resolves to "not implemented" is worse than one that does
# not exist. Add the case when the service does.

# shellcheck shell=bash

### Queued records, for the tiers that apply a batch rather than a record at a time. Parallel
### arrays rather than one delimited string: a DKIM TXT value contains characters that any
### separator worth using would also contain.
DNS_Q_TYPE=(); DNS_Q_NAME=(); DNS_Q_CONTENT=(); DNS_Q_TTL=()

### Resolved once per process and cached. dns_mode is called by every publish and by the wizard,
### and the domainconnect probe below costs a DNS lookup plus an HTTPS round trip.
_DNS_MODE=""

### A guess at the registered domain behind a host name, for pre-filling the wizard's prompt.
###
### Strips one label when there are three or more, so pbx.acme.com gives acme.com and
### pbx.acme.co.uk gives acme.co.uk - reducing to the last two labels instead would give co.uk
### and quietly break every three-label public suffix.
###
### It is a guess: pbx.internal.acme.com gives internal.acme.com, which is wrong. Nothing depends
### on it being right - the operator sees and edits it, and dc_discover walks upward from the full
### name rather than trusting this.
dns_zone_name() {
  local name="${1:-${PBX_FQDN:-}}"
  if [ "$(printf '%s' "$name" | tr -cd . | wc -c)" -ge 2 ]; then
    name="${name#*.}"
  fi
  printf '%s' "$name"
}

dns_mode() {
  [ -n "$_DNS_MODE" ] && { printf '%s' "$_DNS_MODE"; return 0; }

  local configured="${DNS_PROVIDER:-none}"

  case "$configured" in
    none)
      _DNS_MODE="none"
      ;;
    cloudflare)
      ### A configured token beats an interactive flow even where both would work. An install
      ### that can complete unattended should.
      _DNS_MODE="cloudflare"
      ;;
    domainconnect)
      _DNS_MODE="domainconnect"
      ;;
    auto)
      ### The full host name, not a derived zone: dc_discover walks upward itself and gets
      ### three-label suffixes right, which any local guess here would not.
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

  printf '%s' "$_DNS_MODE"
}

### Queue a record. Whether this writes now or at dns_commit is the tier's business; callers must
### behave as though nothing has happened until dns_commit returns.
###
### `proxied` is accepted for one reason and ignored for every tier but the Cloudflare ones: it is
### always false here. Cloudflare's proxy terminates HTTP and cannot carry SIP or RTP, so an
### orange-cloud record would advertise Cloudflare's address to endpoints that must reach this
### host directly. The parameter exists so the intent is visible at the call site rather than
### buried in a default two files away.
dns_publish() {
  local type="$1" name="$2" content="$3" ttl="${4:-300}" proxied="${5:-false}"

  [ "$proxied" = "false" ] || die "dns_publish: proxied=true is never correct for this system ($name)."

  case "$(dns_mode)" in
    cloudflare)
      local zone
      zone="$(cf_zone_for_name "$name")" || return 1
      cf_record_put "$zone" "$type" "$name" "$content" "$ttl" false
      ;;
    domainconnect|none)
      DNS_Q_TYPE+=("$type"); DNS_Q_NAME+=("$name")
      DNS_Q_CONTENT+=("$content"); DNS_Q_TTL+=("$ttl")
      ;;
  esac
}

### Applies anything queued. A no-op for the tiers that wrote as they went, so every caller can
### finish with it unconditionally.
dns_commit() {
  local rc=0

  case "$(dns_mode)" in
    domainconnect)
      dc_commit || rc=$?
      ;;
    none)
      [ "${#DNS_Q_TYPE[@]}" -gt 0 ] && dns_print_queue
      ;;
  esac

  DNS_Q_TYPE=(); DNS_Q_NAME=(); DNS_Q_CONTENT=(); DNS_Q_TTL=()
  return "$rc"
}

### What an operator has to create by hand. Printed rather than logged as a warning per record:
### this is the normal path for DNS_PROVIDER=none, not a fault.
dns_print_queue() {
  local i
  info "Create these DNS records before continuing:"
  for i in "${!DNS_Q_TYPE[@]}"; do
    printf '      %-5s %-45s %s\n' \
      "${DNS_Q_TYPE[$i]}" "${DNS_Q_NAME[$i]}" "${DNS_Q_CONTENT[$i]}"
  done
}

### Waits for a public resolver to return the expected value.
###
### Moved here from lib/dns-cloudflare.sh, unchanged, because it is the one check that works
### the same way for every tier - it asks the internet what it can see, which is the only
### question that actually matters. An API answering "success" means the record is stored, not
### that anyone can resolve it, and certbot's own pre-flight will disagree.
###
### Queries 1.1.1.1 explicitly rather than the system resolver: on a freshly-renamed host the
### local stub may still hold the old answer with a long TTL.
dns_wait_for_record() {
  local name="$1" expect="$2" type="${3:-A}" tries="${4:-30}" got i

  command -v dig >/dev/null 2>&1 || { warn "dig not installed - not waiting for $name."; return 0; }

  for i in $(seq 1 "$tries"); do
    got="$(dig +short @1.1.1.1 "$name" "$type" 2>/dev/null | tr -d '"' | head -1)"

    ### Exact match for an address. For TXT, presence only: a DKIM public key is longer than the
    ### 255-byte limit of a single character-string, so resolvers hand it back split into chunks
    ### that do not reassemble into the value we sent. Checking that SOMETHING is published under
    ### the name is the strongest claim that can honestly be made here, and the signature check
    ### at a real receiver is what proves the content.
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

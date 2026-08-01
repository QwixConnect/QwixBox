#!/usr/bin/env bash
#
# Cloudflare DNS, used by steps/02-dns.sh and steps/15-mail.sh. Sourced from lib/common.sh.
#
# Only Cloudflare is implemented, and deliberately so: a provider abstraction with a single
# implementation is the "elaborate configuration wired to nothing" this codebase keeps growing.
# A second provider is a sibling file plus one `case` in 02-dns.sh, and should be added then.
#
# The token needs Zone:Read and DNS:Edit, scoped to the one zone. Nothing here needs more, and a
# token that has more is a larger blast radius sitting in a config file on a SIP edge.

# shellcheck shell=bash

CF_API="https://api.cloudflare.com/client/v4"

### Every response is checked for "success": true. Cloudflare answers 200 with success=false for
### a surprising number of errors (bad token scope among them), so testing the HTTP status alone
### reports a failed change as a successful one.
cf_api() {
  local method="$1" path="$2" body="${3:-}" out rc=0

  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { fail "CLOUDFLARE_API_TOKEN is not set."; return 1; }

  if [ -n "$body" ]; then
    out="$(curl -fsS -m 20 -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" --data "$body" 2>&1)" || rc=$?
  else
    out="$(curl -fsS -m 20 -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>&1)" || rc=$?
  fi

  if [ "$rc" -ne 0 ]; then
    fail "Cloudflare API request failed: $method $path"
    return 1
  fi
  if ! printf '%s' "$out" | jq -e '.success == true' >/dev/null 2>&1; then
    fail "Cloudflare rejected $method $path: $(printf '%s' "$out" | jq -r '.errors[]?.message' 2>/dev/null | head -3 | tr '\n' ';')"
    return 1
  fi
  printf '%s' "$out"
}

### Walks the name's parent domains until one is a zone this token can see. That walk IS the
### ownership check the operator asked for: a token that cannot see any parent of the name does
### not control the domain, and we stop rather than guessing.
###
### Walking rather than assuming the last two labels, because "pbx.acme.co.uk" is a three-label
### zone and "pbx.internal.acme.com" may be delegated at either level.
cf_zone_for_name() {
  local name="$1" candidate="$1" resp id

  if [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    printf '%s' "$CLOUDFLARE_ZONE_ID"
    return 0
  fi

  while [ "${candidate#*.}" != "$candidate" ]; do
    resp="$(cf_api GET "/zones?name=$candidate&status=active")" || return 1
    id="$(printf '%s' "$resp" | jq -r '.result[0].id // empty')"
    if [ -n "$id" ]; then
      ### stderr, not stdout: this function's stdout IS the zone id, and callers capture it with
      ### $( ). A log line on stdout would be concatenated into the id and every subsequent API
      ### path would be built from it.
      info "Cloudflare zone for $name: $candidate" >&2
      printf '%s' "$id"
      return 0
    fi
    candidate="${candidate#*.}"
  done

  fail "No Cloudflare zone found for $name - the token cannot see any parent domain of it."
  return 1
}

### Upsert. Returns 0 whether it created or updated, and says which; already-correct records are
### left alone so a re-run is quiet and does not churn the zone's audit log.
cf_record_put() {
  local zone="$1" type="$2" name="$3" content="$4" ttl="${5:-300}" proxied="${6:-false}"
  local resp id current body

  resp="$(cf_api GET "/zones/$zone/dns_records?type=$type&name=$name")" || return 1
  id="$(printf '%s' "$resp" | jq -r '.result[0].id // empty')"
  current="$(printf '%s' "$resp" | jq -r '.result[0].content // empty')"

  body="$(jq -nc --arg t "$type" --arg n "$name" --arg c "$content" \
                 --argjson ttl "$ttl" --argjson p "$proxied" \
          '{type:$t, name:$n, content:$c, ttl:$ttl, proxied:$p}')"

  if [ -z "$id" ]; then
    cf_api POST "/zones/$zone/dns_records" "$body" >/dev/null || return 1
    ok "Created $type $name -> $content"
  elif [ "$current" != "$content" ]; then
    cf_api PUT "/zones/$zone/dns_records/$id" "$body" >/dev/null || return 1
    ok "Updated $type $name -> $content (was $current)"
  else
    ok "Already correct: $type $name"
  fi
}

### cf_wait_for_record used to live here. It is now dns_wait_for_record in lib/dns.sh: asking a
### public resolver what it can see is the same question whatever wrote the record, and every
### tier needs the answer. Nothing Cloudflare-specific was lost in the move.

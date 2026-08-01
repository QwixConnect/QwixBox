#!/usr/bin/env bash
# Cloudflare API. Token needs Zone:Read and DNS:Edit on the one zone.
# shellcheck shell=bash

CF_API="https://api.cloudflare.com/client/v4"

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

_CF_OVERRIDE_ZONE_NAME=""

# True when $2 is $1 or a subdomain of it.
_cf_name_in_zone() {
  local zone="$1" name="$2"
  [ "$name" = "$zone" ] || [ "${name%".$zone"}" != "$name" ]
}

cf_zone_for_name() {
  local name="$1" candidate="$1" resp id

  # CLOUDFLARE_ZONE_ID names one zone, so it can only answer for names inside that zone.
  # 15-mail.sh publishes for MAIL_DOMAIN, which need not share a zone with PBX_FQDN, and
  # returning this id unconditionally wrote those records into the wrong zone.
  if [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    if [ -z "$_CF_OVERRIDE_ZONE_NAME" ]; then
      resp="$(cf_api GET "/zones/$CLOUDFLARE_ZONE_ID")" || return 1
      _CF_OVERRIDE_ZONE_NAME="$(printf '%s' "$resp" | jq -r '.result.name // empty')"
      [ -n "$_CF_OVERRIDE_ZONE_NAME" ] || {
        fail "CLOUDFLARE_ZONE_ID is not a zone this token can see."
        return 1
      }
    fi
    if _cf_name_in_zone "$_CF_OVERRIDE_ZONE_NAME" "$name"; then
      printf '%s' "$CLOUDFLARE_ZONE_ID"
      return 0
    fi
    info "$name is outside CLOUDFLARE_ZONE_ID ($_CF_OVERRIDE_ZONE_NAME) - looking it up." >&2
  fi

  while [ "${candidate#*.}" != "$candidate" ]; do
    resp="$(cf_api GET "/zones?name=$candidate&status=active")" || return 1
    id="$(printf '%s' "$resp" | jq -r '.result[0].id // empty')"
    if [ -n "$id" ]; then
      info "Cloudflare zone for $name: $candidate" >&2
      printf '%s' "$id"
      return 0
    fi
    candidate="${candidate#*.}"
  done

  fail "No Cloudflare zone found for $name - the token cannot see any parent domain of it."
  return 1
}

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


#!/usr/bin/env bash
# Host self-detection. Everything here returns a suggestion, never a value written unconfirmed.
# shellcheck shell=bash

_meta() {
  local url="$1" hdr="${2:-}"
  if [ -n "$hdr" ]; then
    curl -fsS -m 2 -H "$hdr" "$url" 2>/dev/null
  else
    curl -fsS -m 2 "$url" 2>/dev/null
  fi
}

detect_public_ip() {
  local ip=""

  ip="$(_meta 'http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' 'Metadata-Flavor: Google')"
  [ -n "$ip" ] || ip="$(_meta 'http://169.254.169.254/latest/meta-data/public-ipv4')"
  [ -n "$ip" ] || ip="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true)"

  [ -n "$ip" ] || ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"

  case "$ip" in
    *[0-9].[0-9]*) printf '%s' "$ip" ;;
    *) return 1 ;;
  esac
}

_plausible_fqdn() {
  local n="$1"
  case "$n" in
    ""|localhost|localhost.*|*.localdomain|*.internal|*.local) return 1 ;;
    *.*) return 0 ;;
    *) return 1 ;;
  esac
}

detect_fqdn() {
  local n ip

  n="$(hostname -f 2>/dev/null || true)"
  if _plausible_fqdn "$n"; then printf '%s' "$n"; return 0; fi

  if ip="$(detect_public_ip)"; then
    if command -v dig >/dev/null 2>&1; then
      n="$(dig +short -x "$ip" 2>/dev/null | head -1 | sed 's/\.$//')"
      if _plausible_fqdn "$n"; then printf '%s' "$n"; return 0; fi
    fi
  fi

  return 1
}

detect_timezone() {
  local tz=""
  [ -r /etc/timezone ] && tz="$(cat /etc/timezone 2>/dev/null || true)"
  [ -n "$tz" ] || tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  printf '%s' "${tz:-Etc/UTC}"
}

detect_admin_cidr() {
  local addr=""
  [ -n "${SSH_CLIENT:-}" ] && addr="${SSH_CLIENT%% *}"
  [ -n "$addr" ] || { [ -n "${SSH_CONNECTION:-}" ] && addr="${SSH_CONNECTION%% *}"; }
  case "$addr" in
    *:*)           printf '%s/128' "$addr" ;;   # IPv6
    *[0-9].[0-9]*) printf '%s/32'  "$addr" ;;
    *)             return 1 ;;
  esac
}

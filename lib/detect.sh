#!/usr/bin/env bash
#
# Host self-detection, used to pre-fill the configuration wizard and to validate what is already
# configured. Sourced from lib/common.sh; do not execute.
#
# Everything here returns a SUGGESTION. Nothing detected is written to config.env without the
# operator confirming it - a wrong PBX_FQDN issues a certificate for the wrong name and becomes
# the SIP domain every endpoint registers against, which is not a mistake worth automating.

# shellcheck shell=bash

### Cloud metadata is authoritative and answers in milliseconds off the link-local address; the
### public lookup services are the fallback for bare metal. Short timeouts throughout: this runs
### on the interactive path and a hung probe is worse than no answer.
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

  ### Behind 1:1 NAT the interface holds a private address, so this is a last resort - but on a
  ### host with a directly attached public address it is exactly right and needs no network.
  [ -n "$ip" ] || ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"

  case "$ip" in
    *[0-9].[0-9]*) printf '%s' "$ip" ;;
    *) return 1 ;;
  esac
}

### A name is only a candidate if it could plausibly be a public FQDN. The container/VM defaults
### (localhost, *.localdomain, *.internal, *.local) are what makes a naive `hostname -f` useless.
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

  ### Reverse DNS of the public address. Often the provider's generic PTR, which is why this
  ### only ever becomes a pre-filled default the operator can overwrite.
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

### The address the operator is connected from, as a /32. A far better default for
### ADMIN_ALLOW_CIDR than 0.0.0.0/0, which is what config.env.example ships and which leaves SSH
### open to the internet. Empty when not over SSH, in which case the caller keeps the default.
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

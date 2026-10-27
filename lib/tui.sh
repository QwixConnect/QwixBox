#!/usr/bin/env bash
# whiptail wrappers. Each writes its widget to stderr and the value to stdout, because the
# installer tees stdout into the log.
# shellcheck shell=bash

TUI_TITLE="QwixBox installer"

tui_available() {
  [ -t 0 ] && [ -t 2 ] && command -v whiptail >/dev/null 2>&1
}

tui_msg() {
  whiptail --title "$TUI_TITLE" --msgbox "$1" "${2:-12}" "${3:-72}" 3>&1 1>&2 2>&3
}

tui_yesno() {
  whiptail --title "$TUI_TITLE" --yesno "$1" "${2:-10}" "${3:-72}" 3>&1 1>&2 2>&3
}

tui_info() {
  whiptail --title "$TUI_TITLE" --infobox "$1" "${2:-8}" "${3:-72}" 3>&1 1>&2 2>&3
}

tui_input() {
  local prompt="$1" default="${2:-}"
  whiptail --title "$TUI_TITLE" --inputbox "$prompt" 10 72 "$default" 3>&1 1>&2 2>&3
}

tui_password() {
  whiptail --title "$TUI_TITLE" --passwordbox "$1" 10 72 3>&1 1>&2 2>&3
}

# Height/list are variables because the menu items occupy the trailing args. whiptail silently
# truncates a prompt that does not fit, showing only its first line.
tui_menu() {
  local prompt="$1"; shift
  whiptail --title "$TUI_TITLE" --menu "$prompt" \
    "${TUI_MENU_HEIGHT:-20}" 78 "${TUI_MENU_LIST:-10}" "$@" 3>&1 1>&2 2>&3
}

tui_input_validated() {
  local prompt="$1" default="${2:-}" validator="${3:-}" value hint
  while true; do
    value="$(tui_input "$prompt" "$default")" || return 1
    if [ -z "$validator" ]; then printf '%s' "$value"; return 0; fi
    if hint="$("$validator" "$value")"; then
      printf '%s' "$value"; return 0
    fi
    tui_msg "${hint:-That value is not valid.}\n\nTry again." 10 72
    default="$value"
  done
}

valid_fqdn() {
  case "$1" in
    ""|*[!A-Za-z0-9.-]*) echo "A hostname may only contain letters, digits, dots and hyphens."; return 1 ;;
    *.*) ;;
    *) echo "That is a hostname, not a fully-qualified name - it needs a domain (pbx.example.com)."; return 1 ;;
  esac
  case "$1" in
    pbx.example.com) echo "That is the placeholder from the template. Use your own name."; return 1 ;;
    .*|*.) echo "A hostname cannot start or end with a dot."; return 1 ;;
  esac
  return 0
}

valid_email() {
  case "$1" in
    *@*.*) ;;
    *) echo "That does not look like an email address."; return 1 ;;
  esac
  case "$1" in
    *@example.com|*@example.net|*@example.org)
      echo "That is a reserved placeholder domain. Use an address at a domain you control."; return 1 ;;
    *" "*) echo "An email address cannot contain a space."; return 1 ;;
  esac
  return 0
}

valid_cidr_list() {
  local item addr prefix
  [ -n "$1" ] || { echo "At least one CIDR is required."; return 1; }
  for item in $1; do
    case "$item" in
      */*) addr="${item%/*}"; prefix="${item#*/}" ;;
      *) echo "'$item' has no prefix length - write it as $item/32."; return 1 ;;
    esac
    case "$prefix" in
      ""|*[!0-9]*) echo "'$item' has a non-numeric prefix length."; return 1 ;;
    esac
    case "$addr" in
      *[!0-9.:a-fA-F]*) echo "'$item' is not an address."; return 1 ;;
    esac
    if [ "${addr}" = "${addr#*:}" ] && [ "$prefix" -gt 32 ]; then
      echo "'$item' has a prefix longer than 32 for an IPv4 address."; return 1
    fi
  done
  return 0
}

valid_timezone() {
  [ -n "$1" ] || { echo "A timezone is required."; return 1; }

  case "$1" in
    /*|*..*|*[!A-Za-z0-9/_+-]*)
      echo "'$1' is not a timezone name. Use Region/City, e.g. Europe/London."; return 1 ;;
  esac

  if grep -qxF "$1" <<<"$(timedatectl list-timezones 2>/dev/null)"; then return 0; fi
  [ -f "/usr/share/zoneinfo/$1" ] && return 0

  echo "'$1' is not a known timezone. Use Region/City, e.g. Europe/London."
  return 1
}

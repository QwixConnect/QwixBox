#!/usr/bin/env bash
#
# whiptail wrappers for the configuration wizard and the menu. Sourced from lib/common.sh.
#
# Every wrapper writes its widget to stderr and the captured value to stdout, which is whiptail's
# own convention (--3>&1 1>&2 2>&3). That matters here because the installer redirects stdout into
# a tee pipe: a widget drawn on stdout would be written into the log file instead of the screen.

# shellcheck shell=bash

TUI_TITLE="Qwixbox installer"

### False without a terminal or without whiptail, which is what keeps every automated run on the
### existing non-interactive path. Checked before each widget, never assumed.
tui_available() {
  [ -t 0 ] && [ -t 2 ] && command -v whiptail >/dev/null 2>&1
}

### 0 when the operator confirmed, non-zero on Cancel/Esc. Callers must treat a cancel as "stop",
### not as "no" - silently continuing past a cancelled prompt is how a wizard writes a value the
### operator explicitly declined.
tui_msg() {
  whiptail --title "$TUI_TITLE" --msgbox "$1" "${2:-12}" "${3:-72}" 3>&1 1>&2 2>&3
}

tui_yesno() {
  whiptail --title "$TUI_TITLE" --yesno "$1" "${2:-10}" "${3:-72}" 3>&1 1>&2 2>&3
}

### Progress notice with no button - it returns immediately and the next widget paints over it.
### tui_msg would be wrong for this: an <Ok> the operator has to dismiss before a step they did
### not ask for is not information, it is an interruption, and it silently shifts every answer
### after it when the flow is being driven by anything other than a human.
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

# tui_menu "prompt" tag1 "label1" tag2 "label2" ...
#
# Height and list size are variables rather than parameters because the parameters after the
# prompt are the menu items themselves - there is nowhere to put an optional argument. Callers
# with a long prompt set TUI_MENU_HEIGHT and TUI_MENU_LIST around the call.
#
# whiptail silently truncates a prompt that does not fit the remaining rows, so a menu whose
# prompt is a summary shows only its first line and nothing warns you. That is worth knowing
# before adding another one.
tui_menu() {
  local prompt="$1"; shift
  whiptail --title "$TUI_TITLE" --menu "$prompt" \
    "${TUI_MENU_HEIGHT:-20}" 78 "${TUI_MENU_LIST:-10}" "$@" 3>&1 1>&2 2>&3
}

### Re-prompts until the value passes `validator`, so the wizard cannot produce a config.env that
### the installer will reject three steps later. An empty value is accepted only when the caller
### passes an empty validator - callers use that for genuinely optional fields.
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

### --- Validators -------------------------------------------------------------------------
###
### Each prints an explanation and returns non-zero when the value is wrong. They are shared with
### the non-interactive path, so a hand-edited config.env gets the same checks.

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
    *@example.com) echo "That is the placeholder domain. Use an address you can receive at."; return 1 ;;
    *" "*) echo "An email address cannot contain a space."; return 1 ;;
  esac
  return 0
}

### Space-separated list, each item addr/prefix. Deliberately strict about the prefix being
### present: a bare address here silently becomes a /32 in some tools and a /0 in others.
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

### timedatectl is authoritative but needs the system bus, which containers and minimal installs
### often lack - there it returns an empty list. Falling back to the zoneinfo tree keeps a real
### check in that case; an earlier version returned "valid" on an empty list and accepted anything.
valid_timezone() {
  [ -n "$1" ] || { echo "A timezone is required."; return 1; }

  ### The value is used as a path component below, so refuse anything that could climb out of
  ### the zoneinfo tree or name a file outside it.
  case "$1" in
    /*|*..*|*[!A-Za-z0-9/_+-]*)
      echo "'$1' is not a timezone name. Use Region/City, e.g. Europe/London."; return 1 ;;
  esac

  if timedatectl list-timezones 2>/dev/null | grep -qxF "$1"; then return 0; fi
  [ -f "/usr/share/zoneinfo/$1" ] && return 0

  echo "'$1' is not a known timezone. Use Region/City, e.g. Europe/London."
  return 1
}

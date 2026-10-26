#!/usr/bin/env bash
# Shared helpers, sourced by every step. Also sources detect/tui/wizard/dns so a step's single
# `. lib/common.sh` line gets them all.
# shellcheck shell=bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="/etc/qwixbox"
CONFIG_FILE="$CONFIG_DIR/config.env"

if [ -t 1 ]; then
  _C_RESET=$'\033[0m'; _C_RED=$'\033[31m'; _C_GREEN=$'\033[32m'
  _C_YELLOW=$'\033[33m'; _C_BLUE=$'\033[34m'
else
  _C_RESET=""; _C_RED=""; _C_GREEN=""; _C_YELLOW=""; _C_BLUE=""
fi

info() { printf '  %s->%s %s\n'  "$_C_BLUE"   "$_C_RESET" "$*"; }
ok()   { printf '  %s ok%s %s\n' "$_C_GREEN"  "$_C_RESET" "$*"; }
warn() { printf '  %s !!%s %s\n' "$_C_YELLOW" "$_C_RESET" "$*"; }
fail() { printf '  %s XX%s %s\n' "$_C_RED"    "$_C_RESET" "$*" >&2; }
die()  { fail "$*"; exit 1; }

EXIT_NEEDS_CONFIG=78
needs_config() { printf '  %s>>%s %s\n' "$_C_YELLOW" "$_C_RESET" "$*"; exit "$EXIT_NEEDS_CONFIG"; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "This must run as root (use sudo)."
}

require_debian() {
  [ -f /etc/os-release ] || die "Cannot identify the OS - /etc/os-release is missing."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) : ;;
    *) die "Unsupported OS '${ID:-unknown}'. This installer targets Debian/Ubuntu." ;;
  esac
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

random_secret() {
  local len="${1:-32}" out=""
  while [ "${#out}" -lt "$len" ]; do
    out="${out}$(LC_ALL=C head -c "$((len * 8))" /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${out:0:len}"
}

config_set() {
  local key="$1" value="$2" tmp line found=0 esc

  case "$value" in
    *$'\n'*) die "config_set: $key value contains a newline, which config.env cannot represent." ;;
  esac

  esc="${value//\\/\\\\}"   # backslash first, or it re-escapes the escapes added below
  esc="${esc//\"/\\\"}"
  esc="${esc//\$/\\\$}"
  esc="${esc//\`/\\\`}"

  touch "$CONFIG_FILE"
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key"=*)
        if [ "$found" -eq 0 ]; then
          printf '%s="%s"\n' "$key" "$esc"
          found=1
        fi
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$CONFIG_FILE" > "$tmp"

  [ "$found" -eq 1 ] || printf '%s="%s"\n' "$key" "$esc" >> "$tmp"

  cat "$tmp" > "$CONFIG_FILE"
  rm -f "$tmp"
}

config_ensure_secret() {
  local key="$1" len="${2:-32}" current=""
  current="$(eval "printf '%s' \"\${$key:-}\"")"
  if [ -z "$current" ]; then
    current="$(random_secret "$len")"
    config_set "$key" "$current"
    export "$key=$current"
    info "Generated $key"
  fi
}

load_config() {
  if [ ! -d "$CONFIG_DIR" ]; then
    install -d -m 0755 "$CONFIG_DIR"
  else
    chmod 0755 "$CONFIG_DIR"
  fi

  if tui_available; then
    if [ ! -f "$CONFIG_FILE" ] || grep -q '^PBX_FQDN="pbx.example.com"' "$CONFIG_FILE" 2>/dev/null; then
      run_wizard || true
    fi
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    install -m 0600 "$REPO_DIR/config.env.example" "$CONFIG_FILE"
    printf '\n'
    ok "Created $CONFIG_FILE from the template."
    printf '\n'
    printf '  This is the expected first run. Nothing is wrong - the installer needs your\n'
    printf '  site details before it can do anything useful.\n\n'
    printf '  1. Run the wizard:     sudo ./install.sh --configure\n'
    printf '     or edit the file:   sudo editor %s\n' "$CONFIG_FILE"
    printf '  2. Set at least:       PBX_FQDN, PBX_SIP_DOMAIN, LETSENCRYPT_EMAIL,\n'
    printf '                         ADMIN_ALLOW_CIDR, TIMEZONE\n'
    printf '  3. Run again:          sudo ./install.sh\n\n'
    printf '  PBX_FQDN must already resolve to this server: Let'"'"'s Encrypt validates over HTTP.\n'
    needs_config "Waiting for configuration."
  fi
  chmod 0600 "$CONFIG_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a

  if [ -z "${PBX_FQDN:-}" ] || [ "${PBX_FQDN:-}" = "pbx.example.com" ]; then
    printf '\n'
    printf '  PBX_FQDN is still the placeholder in %s.\n\n' "$CONFIG_FILE"
    printf '  Set it to this server'"'"'s public hostname, then run again.\n\n'
    needs_config "Waiting for configuration."
  fi
}

# shellcheck source=./detect.sh
. "$REPO_DIR/lib/detect.sh"
# shellcheck source=./tui.sh
. "$REPO_DIR/lib/tui.sh"
# shellcheck source=./wizard.sh
. "$REPO_DIR/lib/wizard.sh"
# shellcheck source=./dns-cloudflare.sh
. "$REPO_DIR/lib/dns-cloudflare.sh"
# shellcheck source=./dns-domainconnect.sh
. "$REPO_DIR/lib/dns-domainconnect.sh"
# shellcheck source=./dns.sh
. "$REPO_DIR/lib/dns.sh"

has_role() {
  local want="$1" r
  case " ${ROLES:-all} " in *" all "*) return 0 ;; esac
  for r in ${ROLES:-all}; do
    [ "$r" = "$want" ] && return 0
  done
  return 1
}

is_all_in_one() {
  case " ${ROLES:-all} " in *" all "*) return 0 ;; esac
  return 1
}

invalidate_step() {
  local name="$1"
  case "$name" in
    *[!a-zA-Z0-9_.-]*|"") die "Invalid step name: $name" ;;
  esac
  rm -f "${QWIXBOX_STATE_DIR:-/var/lib/qwixbox}/$name.done"
  info "Invalidated $name: its inputs were replaced"
}

# Prints 1 when this host's Kamailio will actually sign outbound calls, else 0. Read from the
# deployed files rather than ENABLE_STIR_SHAKEN, because the flag can be set while the module
# failed to build or no key was supplied. The API refuses the per-tenant signing toggle unless
# this is 1; a host without Kamailio (split roles) has neither file and answers 0.
stir_signing_ready() {
  local dir="${KAMAILIO_ETC:-/etc/kamailio}"
  if grep -qx '#!define WITH_STIRSHAKEN' "$dir/kamailio.cfg" 2>/dev/null \
     && grep -q 'as_default_key' "$dir/stirshaken.cfg" 2>/dev/null; then
    printf '1'
  else
    printf '0'
  fi
}

internal_bind_addr() {
  if is_all_in_one; then
    printf '127.0.0.1'
  else
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || printf '0.0.0.0'
  fi
}

APT_UPDATED=0

apt_update_once() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    APT_UPDATED=1
  fi
}

apt_install() {
  local missing=()
  local p
  for p in "$@"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    ok "Packages already present: $*"
    return 0
  fi
  apt_update_once
  info "Installing: ${missing[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold "${missing[@]}"
}

apt_add_repo() {
  local name="$1" key_url="$2" repo_line="$3"
  local keyring="/usr/share/keyrings/${name}.gpg"
  local list="/etc/apt/sources.list.d/${name}.list"

  apt_install curl gnupg ca-certificates

  if [ ! -s "$keyring" ]; then
    info "Fetching signing key for $name"
    curl -fsSL "$key_url" | gpg --dearmor -o "$keyring"
    chmod 0644 "$keyring"
    APT_UPDATED=0
  fi

  local desired="deb [signed-by=${keyring}] ${repo_line}"
  if [ ! -f "$list" ] || [ "$(cat "$list")" != "$desired" ]; then
    printf '%s\n' "$desired" > "$list"
    APT_UPDATED=0
    info "Configured apt repository: $name"
  else
    ok "apt repository already configured: $name"
  fi
}

write_file() {
  local path="$1" mode="${2:-0644}" owner="${3:-root:root}"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp"

  install -d -m 0755 "$(dirname "$path")"

  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    rm -f "$tmp"
    chmod "$mode" "$path"; chown "$owner" "$path"
    ok "Already current: $path"
    return 1
  fi

  if [ -f "$path" ]; then
    cp -a "$path" "${path}.bak-$(date +%Y%m%d%H%M%S)"
  fi

  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$path"
  rm -f "$tmp"
  info "Wrote $path"
  return 0
}

render_template() {
  local src="$1" body name value had_patsub=0
  [ -f "$src" ] || die "Template not found: $src"
  body="$(cat "$src")"

  if shopt -q patsub_replacement 2>/dev/null; then
    had_patsub=1
    shopt -u patsub_replacement
  fi

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    eval "[ \"\${${name}+set}\" = set ]" \
      || die "$(basename "$src"): @${name}@ has no value in the environment"
    eval "value=\"\${${name}}\""
    body="${body//@${name}@/$value}"
  done < <(grep -o '@[A-Za-z_][A-Za-z0-9_]*@' "$src" | tr -d '@' | sort -u)

  [ "$had_patsub" -eq 1 ] && shopt -s patsub_replacement

  printf '%s\n' "$body"
}

deploy_template() {
  local src="$1" dst="$2" mode="${3:-0644}" owner="${4:-root:root}" tmp rc=0
  tmp="$(mktemp)"
  render_template "$src" > "$tmp"
  write_file "$dst" "$mode" "$owner" < "$tmp" || rc=$?
  rm -f "$tmp"
  return "$rc"
}

ensure_directive() {
  local file="$1" key="$2" value="$3" sep="${4:- }"
  touch "$file"
  if grep -qE "^[#[:space:]]*${key}${sep}" "$file"; then
    sed -i -E "s|^[#[:space:]]*${key}${sep}.*|${key}${sep}${value}|" "$file"
  else
    printf '%s%s%s\n' "$key" "$sep" "$value" >> "$file"
  fi
}

enable_service() {
  local unit="$1"
  systemctl enable --now "$unit" >/dev/null 2>&1 || systemctl enable --now "$unit"
  if systemctl is-active --quiet "$unit"; then
    ok "$unit is active"
  else
    systemctl status "$unit" --no-pager -l | head -20 >&2 || true
    die "$unit failed to start"
  fi
}

restart_service() {
  local unit="$1"
  info "Restarting $unit"
  systemctl restart "$unit"
  sleep 1
  systemctl is-active --quiet "$unit" || {
    systemctl status "$unit" --no-pager -l | head -20 >&2 || true
    die "$unit failed to restart"
  }
  ok "$unit restarted"
}

bun_as() {
  local user="$1" dir="$2"
  shift 2
  local bun_user_home cache
  bun_user_home="$(getent passwd "$user" | cut -d: -f6)"
  [ -n "$bun_user_home" ] && [ -d "$bun_user_home" ] || bun_user_home="$dir"
  cache="$bun_user_home/.bun-cache"

  install -d -m 0755 -o "$user" -g "$user" "$cache" "$cache/tmp" 2>/dev/null || true

  su -s /bin/bash -c 'cd -- "$1" && export BUN_INSTALL_CACHE_DIR="$2" BUN_TMPDIR="$2/tmp" TMPDIR="$2/tmp" && shift 2 && exec "$@"' \
    "$user" -- bash "$dir" "$cache" "$@"
}

psql_super() { su - postgres -c "psql -v ON_ERROR_STOP=1 $*"; }

# Run SQL that carries a secret (a role password) as the superuser (I14). The SQL travels on stdin,
# never in argv where `ps` shows it, and the session turns statement logging off first: the
# shipped `log_statement = 'ddl'` otherwise writes every ALTER ROLE ... PASSWORD into the server
# log in plain text. log_min_error_statement covers the failure path, which logs the statement too.
psql_secret() {
  {
    printf '%s\n' "SET log_statement = 'none';" "SET log_min_error_statement = 'panic';" \
      "SET log_min_duration_statement = -1;"
    cat
  } | su - postgres -c "psql -q -v ON_ERROR_STOP=1" >/dev/null
}

# Single-quote a value as an SQL string literal.
sql_literal() { printf "'%s'" "${1//\'/\'\'}"; }

pg_role_exists() {
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$1'\"" | grep -q 1
}

pg_db_exists() {
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$1'\"" | grep -q 1
}

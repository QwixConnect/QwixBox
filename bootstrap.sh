#!/usr/bin/env bash
# One-line installer. The site build replaces the immutable release ref below.
main() {
  set -euo pipefail
  local repo_url="${QWIXBOX_REPO:-https://github.com/QwixConnect/QwixBox.git}"
  local release_ref="${QWIXBOX_REF:-@QWIXBOX_INSTALL_REF@}"
  local checkout_dir="${QWIXBOX_DEST:-/usr/src/qwixbox}"
  die() { printf '\n  Error: %s\n\n' "$*" >&2; exit 1; }

  [[ "$release_ref" =~ ^[0-9a-f]{40}$ ]] || die "Set QWIXBOX_REF to a full commit SHA when running this source template directly."
  [ "$(id -u)" -eq 0 ] || die "Run this with sudo."
  [ -r /etc/os-release ] || die "Cannot identify the operating system."
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = debian ] || die "The bootstrap requires Debian 13."
  case "${VERSION_ID:-}" in 13*) ;; *) die "The bootstrap requires Debian 13." ;; esac
  case "$(dpkg --print-architecture)" in amd64|arm64) ;; *) die "Unsupported architecture." ;; esac

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates whiptail >/dev/null
  if [ -d "$checkout_dir/.git" ]; then
    [ -z "$(git -C "$checkout_dir" status --porcelain)" ] || die "Checkout has local changes; preserve them before updating."
    [ "$(git -C "$checkout_dir" remote get-url origin)" = "$repo_url" ] || die "Checkout origin does not match QWIXBOX_REPO."
  else
    git clone --quiet --no-checkout "$repo_url" "$checkout_dir"
  fi
  git -C "$checkout_dir" fetch --quiet origin "$release_ref"
  [ "$(git -C "$checkout_dir" rev-parse FETCH_HEAD)" = "$release_ref" ] || die "Fetched ref does not match the reviewed release."
  git -C "$checkout_dir" checkout --quiet --detach "$release_ref"
  printf '\n  qwixbox %s at %s\n\n' "$release_ref" "$checkout_dir"
  if [ -r /dev/tty ] && [ -w /dev/tty ]; then
    exec "$checkout_dir/install.sh" "$@" </dev/tty
  fi
  exec "$checkout_dir/install.sh" "$@"
}

# Keep invocation last: a truncated download must never execute an incomplete function.
main "$@"

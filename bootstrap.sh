#!/usr/bin/env bash
# One-line installer: curl -fsSL https://get.qwixbox.com | sudo bash
set -euo pipefail

REPO="${QWIXBOX_REPO:-https://github.com/QwixConnect/QwixBox.git}"
BRANCH="${QWIXBOX_BRANCH:-main}"
DEST="${QWIXBOX_DEST:-/usr/src/qwixbox}"

die() { printf '\n  Error: %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

[ -r /etc/os-release ] || die "Cannot identify this system - /etc/os-release is missing."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "debian" ] || die "QwixBox installs on Debian 13. This is ${PRETTY_NAME:-unknown}."
case "${VERSION_ID:-}" in
  13*) ;;
  *) die "QwixBox installs on Debian 13. This is ${PRETTY_NAME:-unknown}." ;;
esac

case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
  amd64|x86_64|arm64|aarch64) ;;
  *) die "Unsupported architecture: $(uname -m). QwixBox builds on amd64 and arm64." ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ca-certificates whiptail >/dev/null

if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --quiet origin "$BRANCH"
  git -C "$DEST" merge --ff-only "origin/$BRANCH" --quiet 2>/dev/null \
    || printf '  Local checkout at %s was left as it is (not fast-forwardable).\n' "$DEST"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DEST"
fi

printf '\n  qwixbox %s at %s\n\n' "$(git -C "$DEST" rev-parse --short HEAD)" "$DEST"

exec "$DEST/install.sh" "$@"

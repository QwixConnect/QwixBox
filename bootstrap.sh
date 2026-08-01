#!/usr/bin/env bash
#
# One-line install:
#
#   curl -fsSL https://get.qwixbox.io | sudo bash
#
# Fetches the repository and hands over to install.sh, which opens the configuration wizard.
# Everything this does is deliberately visible and reversible - it clones into a fixed path and
# execs a script you can read first. Anyone who would rather do that should run the two lines in
# the README instead; this exists to save typing, not to hide anything.
set -euo pipefail

REPO="${QWIXBOX_REPO:-https://github.com/QwixPBX/qwixbox.git}"
BRANCH="${QWIXBOX_BRANCH:-main}"
DEST="${QWIXBOX_DEST:-/usr/src/qwixbox}"

die() { printf '\n  Error: %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

### The install builds FreeSWITCH from source against Debian 13's library versions, and the step
### scripts assume apt and systemd. Refusing early beats failing forty minutes into a build.
[ -r /etc/os-release ] || die "Cannot identify this system - /etc/os-release is missing."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "debian" ] || die "Qwixbox installs on Debian 13. This is ${PRETTY_NAME:-unknown}."
case "${VERSION_ID:-}" in
  13*) ;;
  *) die "Qwixbox installs on Debian 13. This is ${PRETTY_NAME:-unknown}." ;;
esac

case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
  amd64|x86_64|arm64|aarch64) ;;
  *) die "Unsupported architecture: $(uname -m). Qwixbox builds on amd64 and arm64." ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
### whiptail is what makes the wizard appear rather than the exit-78 path; without it the first
### run would print instructions and stop, which is exactly the friction this script removes.
apt-get install -y -qq git ca-certificates whiptail >/dev/null

if [ -d "$DEST/.git" ]; then
  git -C "$DEST" fetch --quiet origin "$BRANCH"
  ### Fast-forward only. A checkout that has been edited locally - which is how this repo is
  ### tested - stops the pull rather than having its changes reverted underneath it.
  git -C "$DEST" merge --ff-only "origin/$BRANCH" --quiet 2>/dev/null \
    || printf '  Local checkout at %s was left as it is (not fast-forwardable).\n' "$DEST"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DEST"
fi

### Printed so what actually ran is recoverable from the scrollback. A one-line install is only
### as trustworthy as the ability to say afterwards which commit it was.
printf '\n  qwixbox %s at %s\n\n' "$(git -C "$DEST" rev-parse --short HEAD)" "$DEST"

exec "$DEST/install.sh" "$@"

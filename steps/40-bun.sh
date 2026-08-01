#!/usr/bin/env bash
# Bun runtime.
# step-inputs: resources/conf/bun
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/bun"

BUN_INSTALL="/usr/local/lib/bun"
BUN_BIN="/usr/local/bin/bun"

if [ -x "$BUN_BIN" ]; then
  ok "Bun already installed: $("$BUN_BIN" --version)"
else
  apt_install unzip curl
  info "Installing Bun"
  install -d -m 0755 "$BUN_INSTALL"
  BUN_INSTALL="$BUN_INSTALL" bash -c "$(curl -fsSL https://bun.sh/install)" >/dev/null \
    || die "Bun installation failed."
  ln -sf "$BUN_INSTALL/bin/bun" "$BUN_BIN"
  ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bunx
  ok "Bun $("$BUN_BIN" --version) installed to $BUN_INSTALL"
fi

deploy_template "$TPL/bun.sh" /etc/profile.d/bun.sh 0644 || true

"$BUN_BIN" --version >/dev/null || die "Bun is installed but not runnable."
ok "Bun ready"

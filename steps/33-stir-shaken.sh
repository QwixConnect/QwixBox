#!/usr/bin/env bash
# STIR/SHAKEN caller attestation (source build; off by default).
# step-inputs: resources/conf/stir-shaken
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/stir-shaken"

if [ "${ENABLE_STIR_SHAKEN:-0}" != "1" ]; then
  info "ENABLE_STIR_SHAKEN is not 1 - skipping."
  info "Set it in $CONFIG_FILE once you hold an STI-CA certificate, then re-run this step."
  exit 0
fi

BUILD_DIR="/usr/src"
command -v kamailio >/dev/null || die "Kamailio is not installed - run 32-kamailio.sh first."

MPATH="$(dirname "$(find /usr/lib -name 'tm.so' -path '*kamailio*' 2>/dev/null | head -1)")"
[ -n "$MPATH" ] || die "Could not locate the Kamailio module directory."

apt_install build-essential automake autoconf libtool pkg-config \
  libcurl4-openssl-dev libssl-dev libjwt-dev uuid-dev

if [ ! -f /usr/local/lib/pkgconfig/libks2.pc ] && [ ! -f /usr/lib/pkgconfig/libks2.pc ]; then
  if [ -d "$BUILD_DIR/libks" ]; then
    info "Building libks (from the FreeSWITCH source tree)"
    ( cd "$BUILD_DIR/libks" && cmake . >/dev/null && make -j"$(nproc)" >/dev/null && make install >/dev/null )
    ldconfig
  else
    die "libks not found. Run 30-freeswitch.sh first, or install libks manually."
  fi
fi
ok "libks present"

if [ -f /usr/local/lib/libstirshaken.so ] || [ -f /usr/lib/libstirshaken.so ]; then
  ok "libstirshaken already installed"
else
  [ -d "$BUILD_DIR/libstirshaken" ] || \
    git clone https://github.com/signalwire/libstirshaken.git "$BUILD_DIR/libstirshaken"

  info "Building libstirshaken (a few minutes)"
  (
    cd "$BUILD_DIR/libstirshaken"
    ./bootstrap.sh >/dev/null
    ./configure >/dev/null
    make -j"$(nproc)" >/dev/null
    make install >/dev/null
  ) || die "libstirshaken build failed. Build it by hand in $BUILD_DIR/libstirshaken to see why."
  ldconfig
  ok "libstirshaken built and installed"
fi

if [ -f "$MPATH/stirshaken.so" ]; then
  ok "Kamailio stirshaken module already present"
else
  kam_ver="$(kamailio -v 2>/dev/null | awk '/^version:/{print $3}')"
  [ -n "$kam_ver" ] || die "Could not determine the installed Kamailio version."
  info "Building the stirshaken module for Kamailio $kam_ver"

  SRC="$BUILD_DIR/kamailio-$kam_ver"
  if [ ! -d "$SRC" ]; then
    git clone --depth 1 -b "$kam_ver" https://github.com/kamailio/kamailio.git "$SRC" 2>/dev/null \
      || git clone --depth 1 -b "${kam_ver%.*}" https://github.com/kamailio/kamailio.git "$SRC" \
      || die "Could not fetch Kamailio source matching $kam_ver."
  fi

  (
    cd "$SRC"
    make cfg >/dev/null 2>&1 || true
    make modules modules=src/modules/stirshaken >/dev/null
  ) || die "stirshaken module build failed. Build it by hand in $SRC to see why."

  built="$(find "$SRC/src/modules/stirshaken" -name 'stirshaken.so' | head -1)"
  [ -n "$built" ] || die "Build reported success but produced no stirshaken.so."
  install -m 0644 "$built" "$MPATH/stirshaken.so"
  ok "Installed stirshaken.so into $MPATH"
fi

install -d -m 0750 -o root -g kamailio /etc/qwixbox/stir

SS_KEY="${STIR_SHAKEN_KEY:-/etc/qwixbox/stir/signing.key}"
SS_CERT="${STIR_SHAKEN_CERT:-/etc/qwixbox/stir/signing.pem}"

if [ ! -f "$SS_KEY" ] || [ ! -f "$SS_CERT" ]; then
  warn "No signing material at $SS_KEY / $SS_CERT."
  warn "Obtain an SP certificate from an STI-CA (you need an OCN and an SPC token from"
  warn "the policy administrator), then place the EC private key and certificate there."
  warn "Publish the certificate at STIR_SHAKEN_X5U so verifiers can fetch it."
  warn "Kamailio will VERIFY inbound calls but will not SIGN outbound ones until then."
  SIGNING_READY=0
else
  chown root:kamailio "$SS_KEY" "$SS_CERT"
  chmod 0640 "$SS_KEY"; chmod 0644 "$SS_CERT"
  if ! openssl ec -in "$SS_KEY" -noout 2>/dev/null; then
    warn "$SS_KEY is not an EC key. SHAKEN requires ES256 (prime256v1) - signing will fail."
  fi
  SIGNING_READY=1
  ok "Signing material present"
fi

CA_DIR="/etc/qwixbox/stir/ca"
install -d -m 0755 "$CA_DIR"
if [ -z "$(ls -A "$CA_DIR" 2>/dev/null)" ]; then
  warn "No STI-CA root certificates in $CA_DIR - inbound verification will reject everything."
  warn "Add the roots you trust (from the STI-PA trust list) as .pem files there."
fi

# shellcheck disable=SC2034  # read by name from the template
STIR_X5U_DISPLAY="${STIR_SHAKEN_X5U:-<set STIR_SHAKEN_X5U in /etc/qwixbox/config.env>}"

deploy_template "$TPL/README" /etc/qwixbox/stir/README 0644 || true

# shellcheck disable=SC2034  # read by name from the template
if [ "$SIGNING_READY" = "1" ]; then
  SIGNING_KEY_PARAM="modparam(\"stirshaken\", \"as_default_key\", \"${SS_KEY}\")"
else
  SIGNING_KEY_PARAM=""
fi

deploy_template "$TPL/stirshaken.cfg" /etc/kamailio/stirshaken.cfg 0640 root:kamailio || true

systemctl is-active --quiet kamailio && restart_service kamailio || true

ok "STIR/SHAKEN ready (verification on$( [ "$SIGNING_READY" = "1" ] && echo ", signing on" || echo ", signing pending a certificate" ))"
info "Re-run 34-kamailio-config.sh so the routing logic picks this up:"
info "  sudo ./install.sh --only 34-kamailio-config.sh --force"

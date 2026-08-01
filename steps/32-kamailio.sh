#!/usr/bin/env bash
# Kamailio from deb.kamailio.org with postgres/tls/lua modules.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

KAMAILIO_REPO_VERSION="${KAMAILIO_REPO_VERSION:-kamailio61}"
codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"

apt_add_repo "kamailio" \
  "http://deb.kamailio.org/kamailiodebkey.gpg" \
  "http://deb.kamailio.org/${KAMAILIO_REPO_VERSION} ${codename} main"

apt_install \
  kamailio \
  kamailio-postgres-modules \
  kamailio-tls-modules \
  kamailio-lua-modules \
  kamailio-utils-modules \
  kamailio-presence-modules \
  kamailio-json-modules \
  kamailio-extra-modules \
  kamailio-websocket-modules   # websocket.so + xhttp.so, required for SIP over WSS (WebRTC)

systemctl stop kamailio 2>/dev/null || true
systemctl disable kamailio >/dev/null 2>&1 || true

installed="$(dpkg-query -W -f='${Version}' kamailio 2>/dev/null || echo unknown)"
ok "Kamailio ${installed} installed (left stopped - 33-kamailio-config.sh configures and starts it)"

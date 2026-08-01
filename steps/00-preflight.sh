#!/usr/bin/env bash
# Host validation, hostname/FQDN, timezone, NTP, kernel and limit tuning.
# step-inputs: resources/conf/system
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
require_debian
load_config

TPL="$REPO_DIR/resources/conf/system"

# shellcheck disable=SC1091
. /etc/os-release
info "Host: ${PRETTY_NAME:-unknown} on $(uname -m), $(nproc) CPUs, $(awk '/MemTotal/{printf "%.1fGB", $2/1048576}' /proc/meminfo)"

case "$(uname -m)" in
  x86_64|aarch64) : ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac

mem_mb="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)"
[ "$mem_mb" -ge 1800 ] || warn "Only ${mem_mb}MB RAM - 2GB is a realistic minimum for this stack."
disk_gb="$(df -BG --output=avail / | tail -1 | tr -dc '0-9')"
[ "$disk_gb" -ge 15 ] || warn "Only ${disk_gb}GB free on / - the FreeSWITCH build plus sounds needs ~10GB."

resolved="$(getent ahostsv4 "$PBX_FQDN" 2>/dev/null | awk 'NR==1{print $1}')" || resolved=""
if [ -z "$resolved" ]; then
  if [ "${DNS_PROVIDER:-none}" = "none" ]; then
    warn "$PBX_FQDN does not resolve, and DNS_PROVIDER is 'none' so nothing will create it."
    warn "  Add an A record pointing at this server, or set DNS_PROVIDER in $CONFIG_FILE."
  else
    info "$PBX_FQDN does not resolve yet - 02-dns.sh will create the record."
  fi
else
  public_ip="$(detect_public_ip || echo "")"
  if [ -n "$public_ip" ] && [ "$resolved" != "$public_ip" ]; then
    warn "$PBX_FQDN resolves to $resolved but this host's public IP looks like $public_ip."
    warn "Certificate issuance will fail unless that is a proxy or the DNS is still propagating."
  else
    ok "$PBX_FQDN resolves to $resolved"
  fi
fi

if [ "$(hostnamectl --static 2>/dev/null)" != "$PBX_FQDN" ]; then
  if hostnamectl set-hostname "$PBX_FQDN" 2>/dev/null; then
    info "Hostname set to $PBX_FQDN"
  else
    printf '%s\n' "$PBX_FQDN" > /etc/hostname
    hostname "$PBX_FQDN" 2>/dev/null || true
    warn "hostnamectl unavailable (no system bus) - wrote /etc/hostname directly"
  fi
fi

short="${PBX_FQDN%%.*}"
if ! grep -qE "^127\.0\.1\.1[[:space:]]+${PBX_FQDN}" /etc/hosts; then
  hosts_tmp="$(mktemp)"
  grep -vE "^127\.0\.1\.1[[:space:]]" /etc/hosts > "$hosts_tmp" || true
  printf '127.0.1.1\t%s %s\n' "$PBX_FQDN" "$short" >> "$hosts_tmp"
  cat "$hosts_tmp" > /etc/hosts
  rm -f "$hosts_tmp"
  info "Added $PBX_FQDN to /etc/hosts"
fi

if timedatectl set-timezone "$TIMEZONE" 2>/dev/null; then
  ok "Timezone: $TIMEZONE"
elif [ -f "/usr/share/zoneinfo/$TIMEZONE" ]; then
  ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime
  printf '%s\n' "$TIMEZONE" > /etc/timezone
  warn "timedatectl unavailable - set /etc/localtime directly ($TIMEZONE)"
else
  die "Unknown timezone '$TIMEZONE' - no /usr/share/zoneinfo entry."
fi

apt_install chrony
enable_service chrony

deploy_template "$TPL/sysctl-90-qwixbox.conf" /etc/sysctl.d/90-qwixbox.conf || true
sysctl --system >/dev/null
ok "Kernel parameters applied"

deploy_template "$TPL/limits-90-qwixbox.conf" /etc/security/limits.d/90-qwixbox.conf || true
ok "File descriptor limits raised"

apt_update_once
info "Applying pending security updates"
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -o Dpkg::Options::=--force-confold

ok "Preflight complete"

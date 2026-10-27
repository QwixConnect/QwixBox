#!/usr/bin/env bash
# Key-only SSH; retain root key access on cloud hosts.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

CONF=/etc/ssh/sshd_config.d/00-qwixbox-hardening.conf
install -d -m 0755 /etc/ssh/sshd_config.d

key_count=0
root_key_count=0
while IFS=: read -r user _ uid _ _ home _; do
  [ "$uid" -ge 1000 ] || [ "$user" = "root" ] || continue
  if [ "$user" != root ] && ! id -nG "$user" 2>/dev/null | tr ' ' '\n' | grep -qE '^(sudo|admin)$'; then
    continue
  fi
  [ -f "$home/.ssh/authorized_keys" ] || continue
  n="$(grep -cvE '^\s*(#|$)' "$home/.ssh/authorized_keys" 2>/dev/null || true)"
  n="${n:-0}"
  if [ "$n" -gt 0 ]; then
    info "$user has $n authorised key(s)"
    key_count=$((key_count + n))
    [ "$user" != root ] || root_key_count="$n"
  fi
done < /etc/passwd

DISABLE_PASSWORDS=1
if [ "$key_count" -eq 0 ]; then
  warn "No authorised SSH keys found anywhere on this host."
  warn "Leaving password authentication ENABLED so you are not locked out."
  warn "Add a key, then re-run: sudo ./install.sh --only 10-ssh-hardening.sh --force"
  DISABLE_PASSWORDS=0
fi

{
  echo "# Managed by the QwixBox installer."
  if [ "$root_key_count" -gt 0 ]; then
    echo "PermitRootLogin prohibit-password"
  elif [ "$DISABLE_PASSWORDS" -eq 1 ]; then
    echo "PermitRootLogin no"
  fi
  echo "PubkeyAuthentication yes"
  if [ "$DISABLE_PASSWORDS" -eq 1 ]; then
    echo "PasswordAuthentication no"
    echo "KbdInteractiveAuthentication no"
  else
    echo "PasswordAuthentication yes"
    echo "KbdInteractiveAuthentication yes"
  fi
  echo "PermitEmptyPasswords no"
  echo "X11Forwarding no"
  echo "AllowAgentForwarding no"
  echo "MaxAuthTries 3"
  echo "MaxSessions 10"
  echo "LoginGraceTime 30"
  echo "ClientAliveInterval 300"
  echo "ClientAliveCountMax 2"
  echo "# Modern algorithms only."
  echo "KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512"
  echo "Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com"
  echo "MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com"
} | write_file "$CONF" 0644 || true

# OpenSSH takes the first value, so our settings must precede cloud-init's 50-*.conf.
legacy=/etc/ssh/sshd_config.d/90-hardening.conf
if [ -f "$legacy" ] && head -1 "$legacy" | grep -qx '# Managed by the QwixBox installer.'; then
  rm -f "$legacy"
  info "Removed superseded QwixBox SSH drop-in: $legacy"
fi

# Not "awk | grep -q": under pipefail grep's early exit killed awk with SIGPIPE, so Debian 13's
# 60 stock 2047-bit moduli were never found and never removed.
if [ -f /etc/ssh/moduli ] && awk '$5 < 3071 { weak = 1; exit } END { exit !weak }' /etc/ssh/moduli; then
  awk '$5 >= 3071' /etc/ssh/moduli > /etc/ssh/moduli.strong
  mv /etc/ssh/moduli.strong /etc/ssh/moduli
  info "Removed weak DH moduli"
fi

if ! command -v sshd >/dev/null 2>&1; then
  warn "No SSH server installed - hardening config written but not applied."
  ok "SSH hardening skipped (sshd absent)"
  exit 0
fi

sshd -t || die "sshd configuration is invalid - not restarting. Fix $CONF first."
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || \
  warn "Could not reload sshd - the config applies on its next restart."
ok "SSH hardened (password auth $([ "$DISABLE_PASSWORDS" -eq 1 ] && echo disabled || echo "left enabled"))"

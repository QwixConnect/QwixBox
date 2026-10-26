#!/usr/bin/env bash
# Restore a qwixbox-backup snapshot onto this host (I13). docs/restore.md is the runbook.
#
#   ./restore.sh /var/backups/qwixbox/<stamp>
#
# Meant for a fresh Debian 13 host with this repository checked out at the release the snapshot
# was taken on; it also restores in place over an install with the same config.env. In order:
#
#   1. check the snapshot is complete, and that this host has no different config.env;
#   2. put /etc/qwixbox (config.env and its secrets), the DKIM key and the TLS certificates in
#      place, so the install reuses them rather than generating new ones;
#   3. run the full install;
#   4. prove ENCRYPTION_KEY opens the stored secrets, on a scratch copy, before replacing anything;
#   5. restore both databases, re-apply grants, reconcile Kamailio and the cache, and check health.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_root
SNAP="${1:-}"
[ -n "$SNAP" ] && [ -d "$SNAP" ] || die "Usage: $0 <snapshot directory from qwixbox-backup>"
SNAP="$(cd "$SNAP" && pwd)"

### 1. The snapshot, and what is already here.
[ -f "$SNAP/COMPLETE" ] || die "$SNAP has no COMPLETE marker: that backup failed part-way. Use another snapshot."
for f in kamailio.dump qwixbox.dump config.tar.gz; do
  [ -s "$SNAP/$f" ] || die "$SNAP/$f is missing or empty."
done
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
tar xzf "$SNAP/config.tar.gz" -C "$STAGE" etc/qwixbox \
  || die "The snapshot's configuration archive does not contain /etc/qwixbox."
[ -s "$STAGE/etc/qwixbox/config.env" ] || die "The snapshot holds no config.env, so its encryption key is lost."
if [ -f /etc/qwixbox/config.env ] && ! cmp -s /etc/qwixbox/config.env "$STAGE/etc/qwixbox/config.env"; then
  die "This host already has a different /etc/qwixbox/config.env. Restoring would replace every
    secret the running services hold. Restore onto a fresh host, or move it aside if you mean to."
fi
ok "Snapshot $(basename "$SNAP") is complete"

### 2. Secrets and keys the install must reuse. Owners are left to the steps that create the
### accounts (a uid on the old host means nothing here); step 15 chowns the DKIM key.
members=(etc/qwixbox)
for path in etc/opendkim/keys etc/letsencrypt; do
  tar tzf "$SNAP/config.tar.gz" "$path" >/dev/null 2>&1 && members+=("$path")
done
tar xzf "$SNAP/config.tar.gz" -C / --no-same-owner "${members[@]}"
chmod 0700 /etc/qwixbox
chmod 0600 /etc/qwixbox/config.env
ok "Restored ${members[*]/#//}"

### 3. The install, with the restored secrets.
# RESTORE_STEPS limits the install to the named steps, for a host that was installed that way (a
# test container has no public name for TLS). Leave it unset on a real host.
if [ -n "${RESTORE_STEPS:-}" ]; then
  for name in $RESTORE_STEPS; do
    "$REPO_DIR/install.sh" --only "$name" --quiet || die "Step $name failed. Fix it and re-run $0; it is safe to repeat."
  done
else
  info "Running the installer (this is a full install on a fresh host)"
  "$REPO_DIR/install.sh" --quiet || die "The install failed. Fix it and re-run $0; it is safe to repeat."
fi
load_config

### 4. The key, before anything is replaced.
CHECK=qwixbox_restore_check
su - postgres -c "dropdb --if-exists $CHECK && createdb -O '$API_USER' $CHECK" >/dev/null
su - postgres -c "pg_restore --exit-on-error -d $CHECK" <"$SNAP/qwixbox.dump" >/dev/null \
  || die "The snapshot's qwixbox dump does not restore. Nothing has been restored."
key_ok=0
DATABASE_URL="postgres://$API_USER:$API_DB_PASSWORD@$DB_HOST:$DB_PORT/$CHECK" \
  bun_as "$API_USER" "$API_DIR" bun run src/cli/check-encryption.ts && key_ok=1
su - postgres -c "dropdb --if-exists $CHECK" >/dev/null || true
[ "$key_ok" = 1 ] || die "ENCRYPTION_KEY in config.env does not match this snapshot. Nothing has been restored."

### 5. The data.
info "Stopping services that write to the databases"
systemctl stop qwixbox-api kamailio freeswitch
for db in kamailio qwixbox; do
  su - postgres -c "pg_restore --clean --if-exists --exit-on-error -d $db" <"$SNAP/$db.dump" \
    || die "Restoring $db failed. Services are stopped; re-run $0 after fixing the cause."
  ok "Restored database $db"
done
"$REPO_DIR/install.sh" --only 22-provision-databases.sh --force --quiet \
  || die "Re-applying database grants failed."
# Step 44 wrote a first-login for the account the fresh install created; that account is gone now.
tar xzf "$SNAP/config.tar.gz" -C / --no-same-owner etc/qwixbox/first-login 2>/dev/null \
  || rm -f /etc/qwixbox/first-login

systemctl start freeswitch kamailio qwixbox-api
for _ in $(seq 30); do
  curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 2
done
bun_as "$API_USER" "$API_DIR" bun run src/cli/reconcile-kamailio.ts \
  || die "Reconciling Kamailio and the cache failed."

health=""
for _ in $(seq 30); do
  health="$(curl -sS "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || true)"
  [[ $health == *'"status":"ok"'* && $health == *'"pending":0'* ]] && break
  sleep 2
done
[[ $health == *'"status":"ok"'* ]] \
  || die "Restored, but the API reports degraded: $health"
ok "Restored $(basename "$SNAP"): $health"
warn "Not in the backup: voicemail messages, recordings and fax files. Point DNS at this host if it moved."

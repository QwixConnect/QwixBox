#!/usr/bin/env bash
# First portal account and its tenant. Skipped without ADMIN_EMAIL. The generated password goes
# to fd 3 so it never reaches the install log.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

API_DIR="${API_DIR:-/opt/qwixbox-api}"
API_USER="${API_USER:-qwixbox}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"

if [ -z "$ADMIN_EMAIL" ]; then
  info "ADMIN_EMAIL is not set - not creating a portal account."
  info "  Create one later:  cd $API_DIR && sudo -u $API_USER bun run src/cli/create-user.ts --email you@example.com --name 'Your Name'"
  exit 0
fi

[ -d "$API_DIR" ] || die "$API_DIR does not exist - 41-api-deploy.sh has not run."

TENANT_NAME="${TENANT_NAME:-${PBX_SIP_DOMAIN}}"
if [ -z "${TENANT_SLUG:-}" ]; then
  TENANT_SLUG="$(printf '%s' "$TENANT_NAME" | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')"
fi
[ -n "$TENANT_SLUG" ] || die "Could not derive a tenant slug from TENANT_NAME='$TENANT_NAME'."

ADMIN_PASSWORD="$(random_secret 20)"
ADMIN_NAME="${ADMIN_NAME:-${ADMIN_EMAIL%%@*}}"

# One real call, exit status as the existence check: create-user.ts creates the account when it
# does not find one, so a probe would make the account it was asking about.
ACCOUNT_EXISTED=0
if ! CREATE_OUT="$(bun_as "$API_USER" "$API_DIR" \
      "bun run src/cli/create-user.ts --email '$ADMIN_EMAIL' --name '$ADMIN_NAME' --password '$ADMIN_PASSWORD'" 2>&1)"; then
  if printf '%s' "$CREATE_OUT" | grep -q "already exists"; then
    ACCOUNT_EXISTED=1
    ok "Portal account $ADMIN_EMAIL already exists - leaving its password alone."
  else
    printf '%s\n' "$CREATE_OUT" >&2
    die "Could not create the portal account for $ADMIN_EMAIL."
  fi
else
  ok "Created portal account $ADMIN_EMAIL"
fi

bun_as "$API_USER" "$API_DIR" \
  "bun run src/cli/provision-tenant.ts --name '$TENANT_NAME' --slug '$TENANT_SLUG' --domain '$PBX_SIP_DOMAIN' --owner '$ADMIN_EMAIL'" \
  >/dev/null || die "Could not provision tenant '$TENANT_NAME' for $ADMIN_EMAIL."
ok "Tenant '$TENANT_NAME' ($TENANT_SLUG) on $PBX_SIP_DOMAIN"

if [ "$ACCOUNT_EXISTED" -eq 0 ]; then
  CRED_FILE="$CONFIG_DIR/first-login"
  umask 077
  cat > "$CRED_FILE" <<EOF
url=https://${PBX_FQDN}/
email=${ADMIN_EMAIL}
password=${ADMIN_PASSWORD}
EOF
  chmod 0600 "$CRED_FILE"

  BANNER="$(printf '\n  Portal sign-in\n    %s\n    %s\n    %s\n\n  Also in %s (0600) - delete it once you have signed in.\n' \
    "https://${PBX_FQDN}/" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$CRED_FILE")"

  printf '%s\n' "$BANNER" >&3 2>/dev/null || printf '%s\n' "$BANNER"
fi

ok "Portal account ready"

#!/usr/bin/env bash
### The first portal account and its tenant.
###
### Until this existed, a finished install had no way in: there is deliberately no default
### account and no self-service registration, so the operator had to know to SSH back in and run
### two CLIs from a directory that is not the checkout. That is a reasonable security posture and
### a poor first five minutes.
###
### This does not weaken it. "No default credential" means no well-known password, not "no
### account" - the password here is generated per install and exists nowhere else. What it
### removes is the guessing.
###
### Runs after 43-portal-web.sh because it needs the API deployed, its .env written, and the
### database reachable. Skips rather than fails when ADMIN_EMAIL is unset: a split-role install
### or an operator who prefers the CLIs is not an error.
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

### Company name and slug. The slug is the tenant's handle in URLs and in add-tenant-user.ts, so
### it is derived rather than asked for: lowercase, non-alphanumerics collapsed to hyphens.
TENANT_NAME="${TENANT_NAME:-${PBX_SIP_DOMAIN}}"
if [ -z "${TENANT_SLUG:-}" ]; then
  TENANT_SLUG="$(printf '%s' "$TENANT_NAME" | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')"
fi
[ -n "$TENANT_SLUG" ] || die "Could not derive a tenant slug from TENANT_NAME='$TENANT_NAME'."

### --- Account --------------------------------------------------------------------------------

### Generated, never chosen. Same rule as every other secret here, and for a stronger reason:
### this console can place calls billed to a customer.
ADMIN_PASSWORD="$(random_secret 20)"
ADMIN_NAME="${ADMIN_NAME:-${ADMIN_EMAIL%%@*}}"

### One call, and the exit status is the existence check.
###
### There is no read-only "does this account exist" CLI, and probing with a throwaway create is
### not a probe - create-user.ts checks for the address and then creates it, so a dry run would
### make the very account it was asking about, under a placeholder name and a password nobody
### captured. Running the real command and reading why it refused is the honest version.
ACCOUNT_EXISTED=0
if ! CREATE_OUT="$(bun_as "$API_USER" "$API_DIR" \
      "bun run src/cli/create-user.ts --email '$ADMIN_EMAIL' --name '$ADMIN_NAME' --password '$ADMIN_PASSWORD'" 2>&1)"; then
  ### An existing account keeps its password. Rotating one underneath somebody already signed in
  ### would make a re-run of the installer a lockout.
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

### --- Tenant ---------------------------------------------------------------------------------

### provision-tenant.ts is idempotent on its own terms - it stops once the organization has the
### owner as a member - so this runs on every pass and repairs a half-provisioned tenant.
bun_as "$API_USER" "$API_DIR" \
  "bun run src/cli/provision-tenant.ts --name '$TENANT_NAME' --slug '$TENANT_SLUG' --domain '$PBX_SIP_DOMAIN' --owner '$ADMIN_EMAIL'" \
  >/dev/null || die "Could not provision tenant '$TENANT_NAME' for $ADMIN_EMAIL."
ok "Tenant '$TENANT_NAME' ($TENANT_SLUG) on $PBX_SIP_DOMAIN"

### --- Handing over the password ----------------------------------------------------------

if [ "$ACCOUNT_EXISTED" -eq 0 ]; then
  ### The password must not reach the log. install.sh redirects stdout into a tee pipe, so
  ### anything printed normally is written to /var/log/qwixbox/install-*.log and stays there.
  ### fd 3 is the real stdout it saved beforehand for exactly this kind of output.
  ###
  ### Written to a file as well because it scrolls: another fifty steps run after this one, and
  ### on a provider's web console the buffer is gone long before the install ends. 0600 root-only,
  ### alongside config.env, which already holds ENCRYPTION_KEY and every database password.
  CRED_FILE="$CONFIG_DIR/first-login"
  umask 077
  cat > "$CRED_FILE" <<EOF
# Qwixbox first sign-in. Delete this file once you are in.
url=https://${PBX_FQDN}/
email=${ADMIN_EMAIL}
password=${ADMIN_PASSWORD}
EOF
  chmod 0600 "$CRED_FILE"

  BANNER="$(printf '\n  Portal sign-in\n    %s\n    %s\n    %s\n\n  Also in %s (0600) - delete it once you have signed in.\n' \
    "https://${PBX_FQDN}/" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$CRED_FILE")"

  ### Falls back to stdout when fd 3 is not open, which is the case when this step is run on its
  ### own rather than through install.sh - there stdout IS the terminal and nothing is teed.
  printf '%s\n' "$BANNER" >&3 2>/dev/null || printf '%s\n' "$BANNER"
fi

ok "Portal account ready"

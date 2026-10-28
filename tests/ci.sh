#!/usr/bin/env bash
# The CI checks, one job per argument: shell | api | web | site | integration | sip (I16).
#
# .github/workflows/ci.yml runs exactly these, so running one here reproduces CI. The first four
# need no live service. integration and sip run against disposable service containers, and refuse
# a URL that does not name a *_test database, so they cannot be pointed at an install.
#
#   shell  Debian 13 as root, with shellcheck, lua5.4, python3, nginx, openssl and jq installed.
#          It binds loopback 80/443 for the nginx check, so use a disposable container.
#   api    bun, pcre2grep and network (auth:check fetches the auth generator); portal/api
#   (shell runs git ls-files: as root on another user's checkout, set git's safe.directory)
#   web    bun; portal/web, then the root portal tests that import it
#   site   node/npm; site, then the generated-site link check
#   integration  bun; TEST_DATABASE_URL (Postgres, database *_test) and TEST_REDIS_URL. Pushes the
#          schema, then the API security and cache-publication suites, each in its own run.
#   sip    Debian 13 with kamailio, kamailio-postgres-modules, postgresql-client and python3;
#          SIP_TEST_DATABASE_URL naming qwixbox_sip_test. Loads the fixture, runs sip-auth.py.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

shell_scripts() {
  # Every shell script in the installer, its helpers and its executable templates.
  grep -rlE '^#!.*\b(ba)?sh\b' install.sh restore.sh bootstrap.sh lib steps resources tests/ci.sh \
    portal/api/scripts | sort
}

job_shell() {
  local scripts
  mapfile -t scripts < <(shell_scripts)
  for script in "${scripts[@]}"; do bash -n "$script"; done
  shellcheck -x --severity=warning "${scripts[@]}"
  echo "shell syntax and ShellCheck: ${#scripts[@]} scripts"
  for script in resources/lua/*.lua; do luac5.4 -p "$script"; done
  echo "luac: $(find resources/lua -name '*.lua' | wc -l) scripts"
  for script in tests/*.lua; do lua5.4 "$script" .; done
  python3 tests/installer-safety.py
  python3 tests/nginx-auth-limits.py
  python3 tests/docs-links.py
}

job_api() {
  cd portal/api
  bun install --frozen-lockfile
  bun run typecheck
  bun run format:check
  # auth-schema.ts must stay the generator's output (I24); this fetches the matching generator.
  bun run auth:check
  bun test tests/validation.test.ts
}

job_web() {
  (cd portal/web && bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run build)
  # One file per run: a combined run shares mocked modules between suites.
  bun test ./tests/portal-mock.test.ts
  bun test ./tests/portal-client.test.ts
}

job_site() {
  (cd site && npm ci && npm test && npm run build)
  python3 tests/docs-links.py --site-dir site/dist
}

# The suites truncate tables and delete keys: refuse anything that is not plainly a test target.
require_test_url() {
  local name="$1" url="${!1:-}"
  [ -n "$url" ] || { echo "$name is required" >&2; exit 64; }
  case "${url%%\?*}" in
    postgres://*/*_test | postgresql://*/*_test | redis://*) ;;
    *) echo "$name must name a disposable *_test database" >&2; exit 64 ;;
  esac
}

job_integration() {
  require_test_url TEST_DATABASE_URL
  require_test_url TEST_REDIS_URL
  cd portal/api
  bun install --frozen-lockfile
  DATABASE_URL="$TEST_DATABASE_URL" bun run db:push --force
  # One file per run: cache-publish needs the real Redis client, which the security suite mocks.
  bun test tests/security.test.ts
  bun test tests/cache-publish.test.ts
}

job_sip() {
  require_test_url SIP_TEST_DATABASE_URL
  psql -v ON_ERROR_STOP=1 -q "$SIP_TEST_DATABASE_URL" -f tests/sip-auth.sql
  python3 tests/sip-auth.py
}

case "${1:-}" in
  shell | api | web | site | integration | sip) "job_$1" ;;
  *)
    echo "usage: $0 shell|api|web|site|integration|sip" >&2
    exit 64
    ;;
esac

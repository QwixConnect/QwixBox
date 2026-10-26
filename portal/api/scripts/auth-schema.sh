#!/usr/bin/env bash
# src/db/auth-schema.ts is better-auth's generator output, byte for byte (I24).
#
#   scripts/auth-schema.sh generate   rewrite it after changing a better-auth plugin or field
#   scripts/auth-schema.sh check      fail if it differs from what the generator now produces
#
# The generator is the `auth` package at the installed better-auth's version. The unpinned
# @better-auth/cli this replaced stops at 1.4 and produced a different file for 1.6. A generated
# change reaches every install through `push --force`, so review the diff - and the push
# rehearsal step 41 runs - before committing one.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

version="$(bun -p "require('better-auth/package.json').version")"
out="src/db/auth-schema.ts"
[ "${1:-}" = check ] && out="$(mktemp -d)/auth-schema.ts"

# auth.ts reads these at import; the generator never connects to the database.
DATABASE_URL="postgres://generate@127.0.0.1:1/generate_test" \
  ENCRYPTION_KEY="generate-only" AUTH_SECRET="generate-only-not-a-secret-0123456789abcdef" \
  bunx "auth@$version" generate --output "$out" --yes >/dev/null

case "${1:-}" in
  generate) echo "Wrote src/db/auth-schema.ts from auth@$version" ;;
  check)
    if ! diff -u src/db/auth-schema.ts "$out"; then
      echo "src/db/auth-schema.ts differs from auth@$version's output. Run scripts/auth-schema.sh generate" >&2
      echo "and review what push --force would change on an install." >&2
      exit 1
    fi
    echo "auth-schema.ts matches auth@$version"
    ;;
  *) echo "usage: $0 generate|check" >&2; exit 64 ;;
esac

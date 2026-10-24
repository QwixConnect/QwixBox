#!/usr/bin/env bash
# Input hashing shared by the installer and its regression harness. Include local source
# additions, but exclude dependencies, private configuration and generated build products.

script_hash() {
  local path="$1" input
  {
    sha256sum "$path"
    for input in "$SCRIPT_DIR"/lib/*.sh; do sha256sum "$input"; done
    # shellcheck disable=SC2013
    for input in $(sed -n 's/^#[[:space:]]*step-inputs:[[:space:]]*//p' "$path"); do
      [ -e "$SCRIPT_DIR/$input" ] || die "$(basename "$path"): step-inputs path not found: $input"
      (
        cd "$SCRIPT_DIR" || exit 1
        find "$input" \( -type d \( -name node_modules -o -name dist -o -name .git -o -name .astro -o -name .wrangler \) -prune \) -o \
          \( -type f ! -name '.env' ! -name '.env.*' ! -name '.DS_Store' ! -name '*.tsbuildinfo' -exec sha256sum {} + \) | sort -k2
      )
    done
  } | sha256sum | cut -d' ' -f1
}

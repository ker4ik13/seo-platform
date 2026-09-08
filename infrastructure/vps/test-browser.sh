#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
[ "${SEO_PLATFORM_E2E_CONFIRM:-}" = CREATE_TEST_DATA ] || runtime_fail "set SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA"
load_runtime_environment
mkdir -p "$runtime_root/tmp"
chmod 700 "$runtime_root/tmp"
output_dir=$(mktemp -d "$runtime_root/tmp/e2e.XXXXXXXX")
printf '%s\n' "$$" > "$output_dir/owner.pid"
printf 'e2e artifacts=%s\n' "$output_dir"
env -i PATH="$PATH" HOME="$HOME" \
  LD_LIBRARY_PATH="${SEO_PLATFORM_BROWSER_LIBRARIES:-${LD_LIBRARY_PATH:-}}" \
  SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
  SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA \
  SEO_PLATFORM_E2E_OUTPUT_DIR="$output_dir" \
  pnpm --dir "$project_root" exec node --test "$project_root/infrastructure/e2e/runtime.test.mjs"

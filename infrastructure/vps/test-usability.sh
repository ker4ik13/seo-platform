#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
[ "${SEO_PLATFORM_E2E_CONFIRM:-}" = CREATE_TEST_DATA ] || runtime_fail "set SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA"
load_runtime_environment
# Dedicated local test stand only; never grant test staff privileges on production.
[ "$SEO_PLATFORM_PUBLIC_URL" = https://144.31.221.28:3000 ] || runtime_fail "usability fixtures require the dedicated HTTPS test stand"
"$script_dir/status-runtime.sh" >/dev/null
mkdir -p "$runtime_root/tmp"
chmod 700 "$runtime_root/tmp"
output_dir=$(mktemp -d "$runtime_root/tmp/e2e.usability.XXXXXXXX")
printf '%s\n' "$$" > "$output_dir/owner.pid"
printf 'usability artifacts=%s\n' "$output_dir"
browser_libraries=${SEO_PLATFORM_BROWSER_LIBRARIES:-$runtime_root/browser-libs/root/usr/lib/x86_64-linux-gnu}
test_environment=(env -i PATH="$PATH" HOME=/home/dev LD_LIBRARY_PATH="$browser_libraries"
  SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA
  SEO_PLATFORM_E2E_OUTPUT_DIR="$output_dir" SEO_PLATFORM_SESSION_FIXTURES="$output_dir/sessions.json")
cleanup_fixtures() {
  if [ -s "$output_dir/sessions.json" ]; then
    "${test_environment[@]}" node "$project_root/infrastructure/e2e/cleanup-analytics-fixtures.mjs"
  fi
}
trap cleanup_fixtures EXIT
cd "$project_root"
"${test_environment[@]}" node infrastructure/e2e/prepare-analytics-fixtures.mjs
"${test_environment[@]}" node --import ./backend-core/modules/seo/node_modules/tsx/dist/loader.mjs --test infrastructure/e2e/project-usability.test.mjs infrastructure/e2e/usability-regression.test.mjs
"${test_environment[@]}" node infrastructure/e2e/usability-audit.mjs
printf '%s\n' 'usability result=passed'

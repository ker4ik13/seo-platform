#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
. "$script_dir/runtime-lib.sh"
[ "${SEO_PLATFORM_E2E_CONFIRM:-}" = CREATE_TEST_DATA ] || runtime_fail "set SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA"
load_runtime_environment
[ "$SEO_PLATFORM_PUBLIC_URL" = https://144.31.221.28:3000 ] || runtime_fail "position-import fixtures require the dedicated HTTPS test stand"
"$script_dir/status-runtime.sh" >/dev/null
mkdir -p "$runtime_root/tmp"
output_dir=$(mktemp -d "$runtime_root/tmp/e2e.positions.XXXXXXXX")
printf '%s\n' "$$" > "$output_dir/owner.pid"
printf 'position import artifacts=%s\n' "$output_dir"
test_environment=(env -i PATH="$PATH" HOME=/home/dev LD_LIBRARY_PATH="$runtime_root/browser-libs/root/usr/lib/x86_64-linux-gnu"
  SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA
  SEO_PLATFORM_E2E_OUTPUT_DIR="$output_dir" SEO_PLATFORM_SESSION_FIXTURES="$output_dir/sessions.json")
cleanup() { if [ -s "$output_dir/sessions.json" ]; then "${test_environment[@]}" node "$project_root/infrastructure/e2e/cleanup-analytics-fixtures.mjs"; fi; }
trap cleanup EXIT
cd "$project_root"
"${test_environment[@]}" node infrastructure/e2e/prepare-analytics-fixtures.mjs
"${test_environment[@]}" node --test infrastructure/e2e/position-import.test.mjs

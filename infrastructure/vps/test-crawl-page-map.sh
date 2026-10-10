#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
[ "${SEO_PLATFORM_E2E_CONFIRM:-}" = CREATE_TEST_DATA ] || runtime_fail "set SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA"
load_runtime_environment
[ "$SEO_PLATFORM_PUBLIC_URL" = https://144.31.221.28:3000 ] || runtime_fail "crawl fixtures require the dedicated HTTPS stand"
"$script_dir/status-runtime.sh" >/dev/null
mkdir -p "$runtime_root/tmp"
output_dir=$(mktemp -d "$runtime_root/tmp/e2e.crawl-map.XXXXXXXX")
printf '%s\n' "$$" > "$output_dir/owner.pid"
printf 'crawl-map artifacts=%s\n' "$output_dir"
test_environment=(env -i PATH="$PATH" LD_LIBRARY_PATH="$runtime_root/browser-libs/root/usr/lib/x86_64-linux-gnu"
  SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" SEO_PLATFORM_E2E_CONFIRM=CREATE_TEST_DATA
  SEO_PLATFORM_E2E_RECOVERED_CRAWL_JOB_ID="${SEO_PLATFORM_E2E_RECOVERED_CRAWL_JOB_ID:-}"
  SEO_PLATFORM_E2E_OUTPUT_DIR="$output_dir" SEO_PLATFORM_SESSION_FIXTURES="$output_dir/sessions.json")
cleanup_fixtures() {
  if [ -s "$output_dir/sessions.json" ]; then "${test_environment[@]}" node "$project_root/infrastructure/e2e/cleanup-analytics-fixtures.mjs"; fi
}
trap cleanup_fixtures EXIT
cd "$project_root"
"${test_environment[@]}" node infrastructure/e2e/prepare-analytics-fixtures.mjs
"${test_environment[@]}" node --test infrastructure/e2e/crawl-page-map.test.mjs
printf '%s\n' 'crawl-map result=passed (HTTPS, real remote worker, public HTTP, actual files and persisted facts)'

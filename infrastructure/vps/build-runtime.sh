#!/usr/bin/env bash
set -euo pipefail
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
load_runtime_environment
if tmux has-session -t "$runtime_session" 2>/dev/null; then
  runtime_fail "stop this project's runtime before rebuilding its artifacts"
fi
cd "$project_root"
# Build tools receive public origins only, never runtime credentials.
env -i PATH="$PATH" HOME="$HOME" \
  WEB_PUBLIC_URL="${WEB_PUBLIC_URL:-$SEO_PLATFORM_PUBLIC_URL}" API_PUBLIC_URL="$(public_api_endpoint)" \
  PLATFORM_API_INTERNAL_URL=http://127.0.0.1:4000 \
  NEXT_TELEMETRY_DISABLED=1 pnpm build

#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
assert_runtime_root
[ -d "$runtime_root" ] || runtime_fail "runtime directory is missing"
exec flock -n "$runtime_root/maintenance.lock" \
  /home/dev/.nvm/versions/node/v24.18.1/bin/node \
  "$script_dir/maintain-runtime.mjs" "$runtime_root" "$@"

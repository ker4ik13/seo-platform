#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

component=${1:-}
[ -n "$component" ] || runtime_fail "component name is required"

mkdir -p "$runtime_root/logs"
chmod 700 "$runtime_root/logs"
log_file=$runtime_root/logs/$component.log
stop_marker=$runtime_root/stop
child_pid=

forward_signal() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    shutdown_attempts=10
    if [ "$component" = auth-email-worker ]; then
      shutdown_attempts=20
    fi
    for ((attempt = 1; attempt <= shutdown_attempts; attempt += 1)); do
      kill -0 "$child_pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
    wait "$child_pid" 2>/dev/null || true
  fi
  exit 0
}

trap forward_signal HUP INT TERM

while [ ! -e "$stop_marker" ]; do
  printf '%s component=%s event=start\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$component" >> "$log_file"

  set +e
  "$script_dir/run-component.sh" "$component" >> "$log_file" 2>&1 &
  child_pid=$!
  wait "$child_pid"
  component_exit_code=$?
  child_pid=
  set -e

  printf '%s component=%s event=exit code=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$component" \
    "$component_exit_code" >> "$log_file"

  [ -e "$stop_marker" ] && break
  sleep 5
done

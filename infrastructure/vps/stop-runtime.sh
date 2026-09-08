#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

assert_runtime_root
touch "$runtime_root/stop"

if tmux has-session -t "$runtime_session" 2>/dev/null; then
  while IFS= read -r pane_pid; do
    case "$pane_pid" in
      ''|*[!0-9]*) continue ;;
    esac
    kill -TERM "$pane_pid" 2>/dev/null || true
  done < <(
    tmux list-panes \
      -t "$runtime_session" \
      -s \
      -F '#{pane_pid}'
  )
fi

if [ -x "$(postgres_bin_dir)/pg_ctl" ] &&
  [ -f "$runtime_root/postgres/data/postmaster.pid" ]
then
  env \
    -i \
    PATH="$(postgres_bin_dir):/usr/bin:/bin" \
    LD_LIBRARY_PATH="$(postgres_library_dir)" \
    "$(postgres_bin_dir)/pg_ctl" \
    --pgdata "$runtime_root/postgres/data" \
    --mode fast \
    --wait \
    stop >/dev/null 2>&1 || true
fi

for ((attempt = 1; attempt <= 20; attempt += 1)); do
  tmux has-session -t "$runtime_session" 2>/dev/null || break
  sleep 1
done
tmux kill-session -t "$runtime_session" 2>/dev/null || true
env \
  -i \
  PATH="/usr/bin:/bin" \
  "$script_dir/storage-proxy.sh" \
  remove || true
env \
  -i \
  PATH="/usr/bin:/bin" \
  "$script_dir/public-api-proxy.sh" \
  remove || true
env \
  -i \
  PATH="/usr/bin:/bin" \
  "$script_dir/billing-webhook-proxy.sh" \
  remove || true
printf '%s\n' "seo-platform-vps: runtime stopped"

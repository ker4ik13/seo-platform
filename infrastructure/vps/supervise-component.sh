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
load_runtime_environment

mkdir -p "$runtime_root/logs"
chmod 700 "$runtime_root/logs"
log_file=$runtime_root/logs/$component.log
stop_marker=$runtime_root/stop
child_pid=
watcher_pid=
node_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/node

send_operational_alert() {
  local code=$1
  local severity=$2
  local fingerprint=$3
  [ "${TELEGRAM_ALERTS_ENABLED:-false}" = true ] || return 0
  [ "$component" != operational-alerts ] || return 0

  if ! env \
    -i \
    PATH="/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin" \
    OPERATIONAL_ALERT_TOKEN="$OPERATIONAL_ALERT_TOKEN" \
    OPERATIONAL_ALERT_SOURCE="$component" \
    OPERATIONAL_ALERT_CODE="$code" \
    OPERATIONAL_ALERT_SEVERITY="$severity" \
    OPERATIONAL_ALERT_FINGERPRINT="$fingerprint" \
    "$node_bin" \
    --input-type=module \
    -e '
      const envelope = {
        version: 1,
        service: "vps-runtime",
        source: process.env.OPERATIONAL_ALERT_SOURCE,
        code: process.env.OPERATIONAL_ALERT_CODE,
        severity: process.env.OPERATIONAL_ALERT_SEVERITY,
        fingerprint: process.env.OPERATIONAL_ALERT_FINGERPRINT
      };
      const response = await fetch(
        "http://127.0.0.1:4004/internal/alerts",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.OPERATIONAL_ALERT_TOKEN}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(envelope),
          redirect: "error",
          signal: AbortSignal.timeout(1_500)
        }
      );
      await response.body?.cancel();
      if (response.status !== 202) process.exit(1);
    ' >/dev/null 2>&1
  then
    printf '%s component=%s event=operational-alert-unavailable\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$component" >> "$log_file"
  fi
}

watch_error_lines() {
  tail --pid="$$" --lines=0 --follow=name --retry "$log_file" 2>/dev/null |
    while IFS= read -r line; do
      if printf '%s\n' "$line" |
        grep -Eiq '(^|[^[:alnum:]_])(error|fatal)([^[:alnum:]_]|$)|uncaught(exception)?|unhandled rejection'
      then
        fingerprint=$(printf '%s' "$line" | sha256sum | cut -c1-16)
        send_operational_alert CHILD_ERROR_LOG ERROR "$fingerprint"
      fi
    done
}

: >> "$log_file"
if [ "${TELEGRAM_ALERTS_ENABLED:-false}" = true ] &&
  [ "$component" != operational-alerts ]
then
  watch_error_lines &
  watcher_pid=$!
fi

stop_watcher() {
  if [ -n "$watcher_pid" ]; then
    kill "$watcher_pid" 2>/dev/null || true
    wait "$watcher_pid" 2>/dev/null || true
    watcher_pid=
  fi
}

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
  stop_watcher
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
  exit_fingerprint=$(printf '%s:%s' "$component" "$component_exit_code" |
    sha256sum | cut -c1-16)
  if [ "$component_exit_code" -eq 0 ]; then
    send_operational_alert \
      UNEXPECTED_PROCESS_STOP \
      CRITICAL \
      "$exit_fingerprint"
  else
    send_operational_alert \
      UNEXPECTED_PROCESS_EXIT \
      CRITICAL \
      "$exit_fingerprint"
  fi
  sleep 5
done

stop_watcher

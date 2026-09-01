#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

load_runtime_environment

if [ "${AUTH_EMAIL_ENABLED:-false}" = true ]; then
  if [ -f /tmp/seo-platform-auth-email-worker.ready ]; then
    printf 'service=auth-email-worker status=ready\n'
  else
    printf 'service=auth-email-worker status=unavailable\n'
  fi
else
  printf 'service=auth-email-worker status=disabled\n'
fi

if tmux has-session -t "$runtime_session" 2>/dev/null; then
  printf 'tmux=%s status=running\n' "$runtime_session"
  tmux list-windows \
    -t "$runtime_session" \
    -F 'window=#{window_name} pane_dead=#{pane_dead} pid=#{pane_pid}'
else
  printf 'tmux=%s status=stopped\n' "$runtime_session"
fi

for endpoint in \
  http://127.0.0.1:4000/health/ready \
  http://127.0.0.1:4001/health/ready \
  http://127.0.0.1:4002/health/ready \
  http://127.0.0.1:4003/health/ready \
  http://127.0.0.1:4004/health/ready \
  http://127.0.0.1:3000/ru \
  http://127.0.0.1:9000/minio/health/ready \
  "$(public_storage_endpoint)/minio/health/ready"
do
  status=$(
    curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --max-time 2 \
      "$endpoint" 2>/dev/null || true
  )
  printf 'endpoint=%s status=%s\n' "$endpoint" "${status:-unreachable}"
done

public_api_status=$(
  curl --insecure --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 2 "$(public_api_endpoint)/api/v1/workspaces" 2>/dev/null || true
)
printf 'endpoint=%s status=%s\n' \
  "$(public_api_endpoint)/api/v1/workspaces" \
  "${public_api_status:-unreachable}"

if python3 -c \
  'import socket; s=socket.create_connection(("127.0.0.1",3310),2); s.sendall(b"zPING\0"); ok=s.recv(16)==b"PONG\0"; s.close(); raise SystemExit(0 if ok else 1)' \
  >/dev/null 2>&1
then
  printf 'service=clamd status=ready\n'
else
  printf 'service=clamd status=unreachable\n'
fi

ss -lntp |
  grep -E ':(3000|3310|4000|4001|4002|4003|4004|4222|5432|6379|6380|8222|9000|9001|9443)([[:space:]]|$)' ||
  true

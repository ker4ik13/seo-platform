#!/usr/bin/env bash

set -euo pipefail

vps_script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
project_root=$(
  CDPATH= cd -- "$vps_script_dir/../.."
  pwd -P
)
runtime_root=${SEO_PLATFORM_RUNTIME_DIR:-/home/dev/.local/share/seo-platform-runtime}
runtime_env_file=$runtime_root/runtime.env
runtime_session=${SEO_PLATFORM_TMUX_SESSION:-seo-platform-runtime}

runtime_fail() {
  printf 'seo-platform-vps: %s\n' "$1" >&2
  exit 1
}

assert_runtime_root() {
  case "$runtime_root" in
    /home/dev/.local/share/seo-platform-runtime|/home/dev/.local/share/seo-platform-runtime/*) ;;
    *) runtime_fail "SEO_PLATFORM_RUNTIME_DIR must stay under /home/dev/.local/share/seo-platform-runtime" ;;
  esac
}

load_runtime_environment() {
  assert_runtime_root
  [ -f "$runtime_env_file" ] ||
    runtime_fail "runtime.env is missing; run bootstrap-runtime.sh first"
  [ "$(stat -c '%a' "$runtime_env_file")" = "600" ] ||
    runtime_fail "runtime.env must have mode 600"

  set -a
  # The file is generated locally by bootstrap-runtime.sh and is never
  # accepted from an HTTP request or another tenant-controlled source.
  # shellcheck disable=SC1090
  . "$runtime_env_file"
  set +a
}

postgres_bin_dir() {
  printf '%s/postgres/usr/lib/postgresql/18/bin\n' "$runtime_root"
}

postgres_library_dir() {
  printf '%s/postgres/usr/lib/x86_64-linux-gnu\n' "$runtime_root"
}

wait_for_http() {
  local url=$1
  local attempts=${2:-60}
  local response_code

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    response_code=$(
      curl \
        --silent \
        --show-error \
        --output /dev/null \
        --write-out '%{http_code}' \
        --max-time 2 \
        "$url" 2>/dev/null || true
    )
    if [[ "$response_code" =~ ^2[0-9][0-9]$ ]]; then
      return 0
    fi
    sleep 1
  done

  runtime_fail "timed out waiting for $url"
}

wait_for_postgres() {
  local pg_bin_dir
  pg_bin_dir=$(postgres_bin_dir)

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if env \
      -i \
      PATH="$pg_bin_dir:/usr/bin:/bin" \
      LD_LIBRARY_PATH="$(postgres_library_dir)" \
      "$pg_bin_dir/pg_isready" \
      --host "$runtime_root/postgres/socket" \
      --port 5432 \
      --username seo_bootstrap \
      --dbname postgres >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done

  runtime_fail "timed out waiting for PostgreSQL"
}

wait_for_redis() {
  local port=$1
  local user=$2
  local password=$3

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if env \
      -i \
      PATH="$runtime_root/bin:/usr/bin:/bin" \
      "$runtime_root/bin/redis-cli" \
      -h 127.0.0.1 \
      -p "$port" \
      --user "$user" \
      --pass "$password" \
      --no-auth-warning \
      ping 2>/dev/null | grep -qx PONG
    then
      return 0
    fi
    sleep 1
  done

  runtime_fail "timed out waiting for Redis on port $port"
}

wait_for_nats() {
  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if curl \
      --silent \
      --fail \
      --max-time 2 \
      http://127.0.0.1:8222/healthz >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done

  runtime_fail "timed out waiting for NATS"
}

public_storage_endpoint() {
  local authority=${SEO_PLATFORM_PUBLIC_URL#https://}
  authority=${authority%%/*}
  local host=${authority%%:*}
  case "$host" in
    ''|*[!A-Za-z0-9.-]*) runtime_fail "public URL host is not supported" ;;
  esac
  printf 'https://%s:9443\n' "$host"
}

public_api_endpoint() {
  if [ -n "${API_PUBLIC_URL:-}" ]; then
    case "$API_PUBLIC_URL" in
      https://*) ;;
      *) runtime_fail "API_PUBLIC_URL must be an HTTPS origin" ;;
    esac
    local explicit_authority=${API_PUBLIC_URL#https://}
    case "$explicit_authority" in
      ''|*/*|*\?*|*\#*|*@*) runtime_fail "API_PUBLIC_URL must be an explicit HTTPS origin" ;;
    esac
    printf '%s\n' "$API_PUBLIC_URL"
    return
  fi
  local authority=${SEO_PLATFORM_PUBLIC_URL#https://}
  authority=${authority%%/*}
  local host=${authority%%:*}
  case "$host" in
    ''|*[!A-Za-z0-9.-]*) runtime_fail "public URL host is not supported" ;;
  esac
  printf 'https://%s:4000\n' "$host"
}

wait_for_public_api() {
  local endpoint
  local response_code
  endpoint=$(public_api_endpoint)
  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    response_code=$(
      curl --silent --output /dev/null --write-out '%{http_code}' \
        --max-time 2 "$endpoint/api/v1/workspaces" 2>/dev/null || true
    )
    [ "$response_code" = 401 ] && return 0
    sleep 1
  done
  runtime_fail "timed out waiting for public API at $endpoint"
}

wait_for_object_storage() {
  local url=${1:-http://127.0.0.1:9000}
  for ((attempt = 1; attempt <= 90; attempt += 1)); do
    if curl \
      --silent \
      --fail \
      --max-time 2 \
      "$url/minio/health/ready" >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done
  runtime_fail "timed out waiting for object storage at $url"
}

wait_for_clamd() {
  for ((attempt = 1; attempt <= 180; attempt += 1)); do
    if python3 -c \
      'import socket; s=socket.create_connection(("127.0.0.1",3310),2); s.sendall(b"zPING\0"); ok=s.recv(16)==b"PONG\0"; s.close(); raise SystemExit(0 if ok else 1)' \
      >/dev/null 2>&1
    then
      return 0
    fi
    sleep 1
  done
  runtime_fail "timed out waiting for ClamAV"
}

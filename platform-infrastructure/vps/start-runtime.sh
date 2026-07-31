#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

load_runtime_environment

tmux has-session -t "$runtime_session" 2>/dev/null &&
  runtime_fail "tmux session $runtime_session is already running"

for build_artifact in \
  platform-api/dist/main.js \
  platform-seo-data/dist/main.js \
  platform-jobs-integrations/dist/main.js \
  platform-jobs-integrations/dist/inspection-worker.main.js \
  platform-realtime/dist/main.js \
  platform-web/.next/BUILD_ID
do
  [ -f "$project_root/$build_artifact" ] ||
    runtime_fail "missing production build artifact: $build_artifact"
done

rm -f "$runtime_root/stop"
mkdir -p "$runtime_root/logs"
chmod 700 "$runtime_root/logs"

start_window() {
  local component=$1
  if [ "$component" = postgres ]; then
    tmux new-session \
      -d \
      -s "$runtime_session" \
      -n "$component" \
      "$script_dir/supervise-component.sh '$component'"
  else
    tmux new-window \
      -d \
      -t "$runtime_session" \
      -n "$component" \
      "$script_dir/supervise-component.sh '$component'"
  fi
}

start_window postgres
wait_for_postgres
"$script_dir/migrate-runtime.sh"

start_window redis-jobs
start_window redis-realtime
start_window nats
wait_for_redis 6379 seo_health ignored
wait_for_redis 6380 seo_health ignored
wait_for_nats

[ -x "$runtime_root/bin/minio" ] ||
  runtime_fail "MinIO server is not installed"
[ -x "$runtime_root/bin/mc" ] ||
  runtime_fail "MinIO client is not installed"
start_window object-storage
wait_for_object_storage
"$script_dir/provision-object-storage.sh"
start_window storage-proxy
wait_for_object_storage "$(public_storage_endpoint)"
"$script_dir/prepare-clamav.sh"
start_window clamd
wait_for_clamd
start_window freshclam

mkdir -p "$runtime_root/nats/provisioner"
chmod 700 "$runtime_root/nats/provisioner"
install -m 0600 \
  "$project_root/platform-infrastructure/nats/topology.mjs" \
  "$project_root/platform-infrastructure/nats/provisioner-config.mjs" \
  "$project_root/platform-infrastructure/nats/provisioner.mjs" \
  "$runtime_root/nats/provisioner/"
ln -sfn \
  "$project_root/platform-api/node_modules" \
  "$runtime_root/nats/provisioner/node_modules"

env \
  -i \
  PATH="/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin" \
  NATS_URL=nats://127.0.0.1:4222 \
  NATS_USER="$NATS_PROVISIONER_USER" \
  NATS_PASSWORD="$NATS_PROVISIONER_PASSWORD" \
  NATS_EVENT_ENVIRONMENT="$NATS_EVENT_ENVIRONMENT" \
  /home/dev/.nvm/versions/node/v24.18.1/bin/node \
  "$runtime_root/nats/provisioner/provisioner.mjs" \
  >> "$runtime_root/logs/nats-provisioner.log" 2>&1

start_window seo-data
wait_for_http http://127.0.0.1:4001/health/ready
start_window jobs-api
wait_for_http http://127.0.0.1:4002/health/ready
start_window realtime
wait_for_http http://127.0.0.1:4003/health/ready
start_window platform-api
wait_for_http http://127.0.0.1:4000/health/ready

for worker in \
  system-worker \
  inspection-worker \
  import-worker \
  rank-worker \
  crawl-worker \
  connector-worker
do
  start_window "$worker"
done

start_window web
wait_for_http http://127.0.0.1:3000/ru

printf '%s\n' \
  "seo-platform-vps: runtime is ready" \
  "seo-platform-vps: tmux session: $runtime_session" \
  "seo-platform-vps: logs: $runtime_root/logs" \
  "seo-platform-vps: public URL: $SEO_PLATFORM_PUBLIC_URL"

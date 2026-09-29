#!/bin/sh

set -eu

script_dir=$(
  CDPATH= cd -- "$(dirname -- "$0")"
  pwd
)

case ${WORKER_GATEWAY_ENABLED:-false} in
  true|false) ;;
  *) echo "WORKER_GATEWAY_ENABLED must be true or false" >&2; exit 1 ;;
esac

psql \
  --no-psqlrc \
  --set="worker_gateway_enabled=${WORKER_GATEWAY_ENABLED:-false}" \
  --file="$script_dir/service-runtime.sql"

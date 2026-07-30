#!/bin/sh

set -eu

script_dir=$(
  CDPATH= cd -- "$(dirname -- "$0")"
  pwd
)

psql \
  --no-psqlrc \
  --file="$script_dir/service-runtime.sql"

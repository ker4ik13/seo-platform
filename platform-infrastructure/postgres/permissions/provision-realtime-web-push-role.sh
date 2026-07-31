#!/bin/sh

set -eu

: "${REALTIME_WEB_PUSH_DATABASE_USER:?REALTIME_WEB_PUSH_DATABASE_USER is required}"
: "${REALTIME_WEB_PUSH_DATABASE_PASSWORD:?REALTIME_WEB_PUSH_DATABASE_PASSWORD is required}"

worker_password=$REALTIME_WEB_PUSH_DATABASE_PASSWORD
unset REALTIME_WEB_PUSH_DATABASE_PASSWORD

script_dir=$(
  CDPATH= cd -- "$(dirname -- "$0")"
  pwd
)

psql \
  --no-psqlrc \
  --file="$script_dir/realtime-web-push.sql"

printf '%s\n%s\n' \
  "$worker_password" \
  "$worker_password" |
  psql \
    --no-psqlrc \
    --set=worker_user="$REALTIME_WEB_PUSH_DATABASE_USER" \
    --command="SET password_encryption = 'scram-sha-256'" \
    --command='\password :"worker_user"'

unset worker_password

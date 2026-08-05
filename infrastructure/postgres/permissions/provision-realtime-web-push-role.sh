#!/bin/sh

set -eu

: "${REALTIME_WEB_PUSH_DATABASE_USER:?REALTIME_WEB_PUSH_DATABASE_USER is required}"
: "${REALTIME_WEB_PUSH_DATABASE_PASSWORD:?REALTIME_WEB_PUSH_DATABASE_PASSWORD is required}"

worker_password=$REALTIME_WEB_PUSH_DATABASE_PASSWORD
unset REALTIME_WEB_PUSH_DATABASE_PASSWORD

worker_password_length=${#worker_password}
if [ "$worker_password_length" -lt 32 ] ||
  [ "$worker_password_length" -gt 512 ]
then
  echo "REALTIME_WEB_PUSH_DATABASE_PASSWORD must contain 32..512 characters" >&2
  exit 1
fi
case $worker_password in
  *[!A-Za-z0-9._~-]*)
    echo "REALTIME_WEB_PUSH_DATABASE_PASSWORD must be URL-safe" >&2
    exit 1
    ;;
esac
lowercase_worker_password=$(
  printf '%s' "$worker_password" | tr '[:upper:]' '[:lower:]'
)
case $lowercase_worker_password in
  replace-*|change-*|changeme*|example*|dummy-*|placeholder*|test-*|your-*|your_*)
    echo "REALTIME_WEB_PUSH_DATABASE_PASSWORD must not use an example placeholder" >&2
    exit 1
    ;;
esac
unset worker_password_length lowercase_worker_password

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

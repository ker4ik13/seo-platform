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

case $REALTIME_WEB_PUSH_DATABASE_USER in
  *[!A-Za-z0-9_]*)
    echo "REALTIME_WEB_PUSH_DATABASE_USER must be a SQL identifier" >&2
    exit 1
    ;;
esac

# PostgreSQL 18 reads the interactive password meta-command from the controlling
# TTY and hangs unattended deployments. The validated quote-free password is sent only through stdin;
# it is never present in process arguments, psql history, or application logs.
{
  printf '%s\n' "SET password_encryption = 'scram-sha-256';"
  printf "ALTER ROLE %s PASSWORD '%s';\n" \
    "$REALTIME_WEB_PUSH_DATABASE_USER" \
    "$worker_password"
} | psql \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --quiet

unset worker_password

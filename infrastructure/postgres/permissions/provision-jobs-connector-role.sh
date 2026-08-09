#!/bin/sh

set -eu

: "${JOBS_CONNECTOR_DATABASE_USER:?JOBS_CONNECTOR_DATABASE_USER is required}"
: "${JOBS_CONNECTOR_DATABASE_PASSWORD:?JOBS_CONNECTOR_DATABASE_PASSWORD is required}"

connector_password=$JOBS_CONNECTOR_DATABASE_PASSWORD
unset JOBS_CONNECTOR_DATABASE_PASSWORD

connector_password_length=${#connector_password}
if [ "$connector_password_length" -lt 32 ] ||
  [ "$connector_password_length" -gt 512 ]
then
  echo "JOBS_CONNECTOR_DATABASE_PASSWORD must contain 32..512 characters" >&2
  exit 1
fi
case $connector_password in
  *[!A-Za-z0-9._~-]*)
    echo "JOBS_CONNECTOR_DATABASE_PASSWORD must be URL-safe" >&2
    exit 1
    ;;
esac
lowercase_connector_password=$(
  printf '%s' "$connector_password" | tr '[:upper:]' '[:lower:]'
)
case $lowercase_connector_password in
  replace-*|change-*|changeme*|example*|dummy-*|placeholder*|test-*|your-*|your_*)
    echo "JOBS_CONNECTOR_DATABASE_PASSWORD must not use an example placeholder" >&2
    exit 1
    ;;
esac
unset connector_password_length lowercase_connector_password

script_dir=$(
  CDPATH= cd -- "$(dirname -- "$0")"
  pwd
)

psql \
  --no-psqlrc \
  --file="$script_dir/jobs-connector.sql"

case $JOBS_CONNECTOR_DATABASE_USER in
  *[!A-Za-z0-9_]*)
    echo "JOBS_CONNECTOR_DATABASE_USER must be a SQL identifier" >&2
    exit 1
    ;;
esac

# PostgreSQL 18 reads the interactive password meta-command from the controlling
# TTY and hangs unattended deployments. The validated quote-free password is sent only through stdin;
# it is never present in process arguments, psql history, or application logs.
{
  printf '%s\n' "SET password_encryption = 'scram-sha-256';"
  printf "ALTER ROLE %s PASSWORD '%s';\n" \
    "$JOBS_CONNECTOR_DATABASE_USER" \
    "$connector_password"
} | psql \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --quiet

unset connector_password

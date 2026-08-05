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

# \password derives the SCRAM verifier client-side. The cleartext password is
# supplied only through stdin and therefore never becomes an ALTER ROLE SQL
# literal, a process argument, or a psql history entry. Force SCRAM in this
# same psql session so a cluster/user PGOPTIONS default cannot downgrade the
# verifier to legacy MD5.
printf '%s\n%s\n' \
  "$connector_password" \
  "$connector_password" |
  psql \
    --no-psqlrc \
    --set=connector_user="$JOBS_CONNECTOR_DATABASE_USER" \
    --command="SET password_encryption = 'scram-sha-256'" \
    --command='\password :"connector_user"'

unset connector_password

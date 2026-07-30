#!/bin/sh

set -eu

: "${JOBS_CONNECTOR_DATABASE_USER:?JOBS_CONNECTOR_DATABASE_USER is required}"
: "${JOBS_CONNECTOR_DATABASE_PASSWORD:?JOBS_CONNECTOR_DATABASE_PASSWORD is required}"

connector_password=$JOBS_CONNECTOR_DATABASE_PASSWORD
unset JOBS_CONNECTOR_DATABASE_PASSWORD

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

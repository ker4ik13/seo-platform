#!/bin/sh

set -eu

: "${PLATFORM_DATABASE_OWNER_PASSWORD:?PLATFORM_DATABASE_OWNER_PASSWORD is required}"
: "${PLATFORM_DATABASE_PASSWORD:?PLATFORM_DATABASE_PASSWORD is required}"
: "${SEO_DATABASE_OWNER_PASSWORD:?SEO_DATABASE_OWNER_PASSWORD is required}"
: "${SEO_DATABASE_PASSWORD:?SEO_DATABASE_PASSWORD is required}"
: "${JOBS_DATABASE_OWNER_PASSWORD:?JOBS_DATABASE_OWNER_PASSWORD is required}"
: "${JOBS_DATABASE_PASSWORD:?JOBS_DATABASE_PASSWORD is required}"
: "${JOBS_RANK_DATABASE_PASSWORD:?JOBS_RANK_DATABASE_PASSWORD is required}"
: "${JOBS_AUTH_EMAIL_DATABASE_PASSWORD:?JOBS_AUTH_EMAIL_DATABASE_PASSWORD is required}"
: "${REALTIME_DATABASE_OWNER_PASSWORD:?REALTIME_DATABASE_OWNER_PASSWORD is required}"
: "${REALTIME_DATABASE_PASSWORD:?REALTIME_DATABASE_PASSWORD is required}"
: "${DIRECTUS_DATABASE_PASSWORD:?DIRECTUS_DATABASE_PASSWORD is required}"

platform_owner_password=$PLATFORM_DATABASE_OWNER_PASSWORD
platform_runtime_password=$PLATFORM_DATABASE_PASSWORD
seo_owner_password=$SEO_DATABASE_OWNER_PASSWORD
seo_runtime_password=$SEO_DATABASE_PASSWORD
jobs_owner_password=$JOBS_DATABASE_OWNER_PASSWORD
jobs_runtime_password=$JOBS_DATABASE_PASSWORD
jobs_rank_runtime_password=$JOBS_RANK_DATABASE_PASSWORD
jobs_auth_email_runtime_password=$JOBS_AUTH_EMAIL_DATABASE_PASSWORD
realtime_owner_password=$REALTIME_DATABASE_OWNER_PASSWORD
realtime_runtime_password=$REALTIME_DATABASE_PASSWORD
directus_runtime_owner_password=$DIRECTUS_DATABASE_PASSWORD

unset PLATFORM_DATABASE_OWNER_PASSWORD
unset PLATFORM_DATABASE_PASSWORD
unset SEO_DATABASE_OWNER_PASSWORD
unset SEO_DATABASE_PASSWORD
unset JOBS_DATABASE_OWNER_PASSWORD
unset JOBS_DATABASE_PASSWORD
unset JOBS_RANK_DATABASE_PASSWORD
unset JOBS_AUTH_EMAIL_DATABASE_PASSWORD
unset REALTIME_DATABASE_OWNER_PASSWORD
unset REALTIME_DATABASE_PASSWORD
unset DIRECTUS_DATABASE_PASSWORD

script_dir=$(
  CDPATH= cd -- "$(dirname -- "$0")"
  pwd
)

validate_password() {
  password=$1

  if [ "${#password}" -lt 32 ]; then
    echo "service database passwords must contain at least 32 characters" >&2
    exit 1
  fi

  case $password in
    *[!A-Za-z0-9._~-]*)
      echo "service database passwords must be URL-safe" >&2
      exit 1
      ;;
  esac

  lowercase_password=$(printf '%s' "$password" | tr '[:upper:]' '[:lower:]')
  case $lowercase_password in
    replace-*|change-*|changeme*|example*|dummy-*|placeholder*|test-*|your-*|your_*)
      echo "service database passwords must not use an example placeholder" >&2
      exit 1
      ;;
  esac
  unset lowercase_password
}

ensure_distinct_passwords() {
  while [ "$#" -gt 1 ]; do
    first_password=$1
    shift

    for candidate_password do
      if [ "$first_password" = "$candidate_password" ]; then
        echo "service database passwords must be pairwise distinct" >&2
        exit 1
      fi
    done
  done
}

for database_password in \
  "$platform_owner_password" \
  "$platform_runtime_password" \
  "$seo_owner_password" \
  "$seo_runtime_password" \
  "$jobs_owner_password" \
  "$jobs_runtime_password" \
  "$jobs_rank_runtime_password" \
  "$jobs_auth_email_runtime_password" \
  "$realtime_owner_password" \
  "$realtime_runtime_password" \
  "$directus_runtime_owner_password"
do
  validate_password "$database_password"
done

ensure_distinct_passwords \
  "$platform_owner_password" \
  "$platform_runtime_password" \
  "$seo_owner_password" \
  "$seo_runtime_password" \
  "$jobs_owner_password" \
  "$jobs_runtime_password" \
  "$jobs_rank_runtime_password" \
  "$jobs_auth_email_runtime_password" \
  "$realtime_owner_password" \
  "$realtime_runtime_password" \
  "$directus_runtime_owner_password"

psql \
  --no-psqlrc \
  --file="$script_dir/bootstrap-service-database-roles.sql"

psql \
  --no-psqlrc \
  --file="$script_dir/ensure-service-databases.sql"

prepare_database() {
  database_name=$1
  owner_role=$2

  SERVICE_DATABASE_NAME=$database_name \
  SERVICE_DATABASE_OWNER_ROLE=$owner_role \
  PGDATABASE=$database_name \
    psql \
      --no-psqlrc \
      --file="$script_dir/prepare-service-database.sql"
}

prepare_database platform_db platform_owner
prepare_database seo_db seo_owner
prepare_database jobs_db jobs_owner
prepare_database realtime_db realtime_owner
prepare_database directus_db directus_runtime_owner

set_role_password() {
  role_name=$1
  role_password=$2

  printf '%s\n%s\n' "$role_password" "$role_password" |
    psql \
      --no-psqlrc \
      --set=role_name="$role_name" \
      --command="SET password_encryption = 'scram-sha-256'" \
      --command='\password :"role_name"'
}

set_role_password platform_owner "$platform_owner_password"
set_role_password platform_runtime "$platform_runtime_password"
set_role_password seo_owner "$seo_owner_password"
set_role_password seo_runtime "$seo_runtime_password"
set_role_password jobs_owner "$jobs_owner_password"
set_role_password jobs_runtime "$jobs_runtime_password"
set_role_password jobs_rank_runtime "$jobs_rank_runtime_password"
set_role_password jobs_auth_email_runtime "$jobs_auth_email_runtime_password"
set_role_password realtime_owner "$realtime_owner_password"
set_role_password realtime_runtime "$realtime_runtime_password"
set_role_password directus_runtime_owner "$directus_runtime_owner_password"

unset platform_owner_password
unset platform_runtime_password
unset seo_owner_password
unset seo_runtime_password
unset jobs_owner_password
unset jobs_runtime_password
unset jobs_rank_runtime_password
unset jobs_auth_email_runtime_password
unset realtime_owner_password
unset realtime_runtime_password
unset directus_runtime_owner_password

PGDATABASE=postgres \
  psql \
    --no-psqlrc \
    --file="$script_dir/audit-service-database-roles.sql"

#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

load_runtime_environment
wait_for_postgres

pg_bin_dir=$(postgres_bin_dir)
pg_library_dir=$(postgres_library_dir)
bootstrap_environment=(
  env
  -i
  PATH="$pg_bin_dir:/usr/bin:/bin"
  LD_LIBRARY_PATH="$pg_library_dir"
  PGHOST="$runtime_root/postgres/socket"
  PGPORT=5432
  PGDATABASE=postgres
  PGUSER=seo_bootstrap
)

"${bootstrap_environment[@]}" \
  PLATFORM_DATABASE_OWNER_PASSWORD="$PLATFORM_DATABASE_OWNER_PASSWORD" \
  PLATFORM_DATABASE_PASSWORD="$PLATFORM_DATABASE_PASSWORD" \
  SEO_DATABASE_OWNER_PASSWORD="$SEO_DATABASE_OWNER_PASSWORD" \
  SEO_DATABASE_PASSWORD="$SEO_DATABASE_PASSWORD" \
  JOBS_DATABASE_OWNER_PASSWORD="$JOBS_DATABASE_OWNER_PASSWORD" \
  JOBS_DATABASE_PASSWORD="$JOBS_DATABASE_PASSWORD" \
  JOBS_RANK_DATABASE_PASSWORD="$JOBS_RANK_DATABASE_PASSWORD" \
  JOBS_AUTH_EMAIL_DATABASE_PASSWORD="$JOBS_AUTH_EMAIL_DATABASE_PASSWORD" \
  REALTIME_DATABASE_OWNER_PASSWORD="$REALTIME_DATABASE_OWNER_PASSWORD" \
  REALTIME_DATABASE_PASSWORD="$REALTIME_DATABASE_PASSWORD" \
  DIRECTUS_DATABASE_PASSWORD="$DIRECTUS_DATABASE_PASSWORD" \
  /bin/sh \
  "$project_root/platform-infrastructure/postgres/roles/provision-service-database-roles.sh" \
  >/dev/null

run_migrations() {
  local package_name=$1
  local database_name=$2
  local database_user=$3
  local database_password=$4

  env \
    -i \
    PATH="/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin" \
    HOME=/home/dev \
    DATABASE_URL="postgresql://${database_user}:${database_password}@127.0.0.1:5432/${database_name}" \
    /home/dev/.nvm/versions/node/v24.18.1/bin/pnpm \
    --dir "$project_root" \
    --filter "$package_name" \
    run prisma:migrate:deploy >/dev/null
}

run_migrations @seo-platform/platform-api platform_db platform_owner "$PLATFORM_DATABASE_OWNER_PASSWORD"
run_migrations @seo-platform/seo-data seo_db seo_owner "$SEO_DATABASE_OWNER_PASSWORD"
run_migrations @seo-platform/jobs-integrations jobs_db jobs_owner "$JOBS_DATABASE_OWNER_PASSWORD"
run_migrations @seo-platform/realtime realtime_db realtime_owner "$REALTIME_DATABASE_OWNER_PASSWORD"

grant_runtime_permissions() {
  local database_name=$1
  local database_user=$2
  local database_password=$3

  env \
    -i \
    PATH="$pg_bin_dir:/usr/bin:/bin" \
    LD_LIBRARY_PATH="$pg_library_dir" \
    PGHOST=127.0.0.1 \
    PGPORT=5432 \
    PGDATABASE="$database_name" \
    PGUSER="$database_user" \
    PGPASSWORD="$database_password" \
    /bin/sh \
    "$project_root/platform-infrastructure/postgres/permissions/provision-service-runtime-role.sh" \
    >/dev/null
}

grant_runtime_permissions platform_db platform_owner "$PLATFORM_DATABASE_OWNER_PASSWORD"
grant_runtime_permissions seo_db seo_owner "$SEO_DATABASE_OWNER_PASSWORD"
grant_runtime_permissions jobs_db jobs_owner "$JOBS_DATABASE_OWNER_PASSWORD"
grant_runtime_permissions realtime_db realtime_owner "$REALTIME_DATABASE_OWNER_PASSWORD"

"${bootstrap_environment[@]}" \
  PGDATABASE=jobs_db \
  JOBS_CONNECTOR_DATABASE_USER=jobs_connector \
  JOBS_CONNECTOR_DATABASE_PASSWORD="$JOBS_CONNECTOR_DATABASE_PASSWORD" \
  /bin/sh \
  "$project_root/platform-infrastructure/postgres/permissions/provision-jobs-connector-role.sh" \
  >/dev/null

"${bootstrap_environment[@]}" \
  PGDATABASE=realtime_db \
  REALTIME_WEB_PUSH_DATABASE_USER=realtime_web_push \
  REALTIME_WEB_PUSH_DATABASE_PASSWORD="$REALTIME_WEB_PUSH_DATABASE_PASSWORD" \
  /bin/sh \
  "$project_root/platform-infrastructure/postgres/permissions/provision-realtime-web-push-role.sh" \
  >/dev/null

printf '%s\n' "seo-platform-vps: all service migrations and runtime grants are current"

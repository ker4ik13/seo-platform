#!/usr/bin/env bash

set -euo pipefail
umask 077

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

assert_runtime_root

postgres_distribution_root=${POSTGRES_DISTRIBUTION_ROOT:-}
redis_server_binary=${REDIS_SERVER_BINARY:-}
redis_cli_binary=${REDIS_CLI_BINARY:-}
nats_server_binary=${NATS_SERVER_BINARY:-}
public_url=${SEO_PLATFORM_PUBLIC_URL:-}

case "$postgres_distribution_root" in
  /*) ;;
  *) runtime_fail "POSTGRES_DISTRIBUTION_ROOT must be an absolute directory" ;;
esac
case "$redis_server_binary" in
  /*) ;;
  *) runtime_fail "REDIS_SERVER_BINARY must be an absolute path" ;;
esac
case "$redis_cli_binary" in
  /*) ;;
  *) runtime_fail "REDIS_CLI_BINARY must be an absolute path" ;;
esac
case "$nats_server_binary" in
  /*) ;;
  *) runtime_fail "NATS_SERVER_BINARY must be an absolute path" ;;
esac
case "$public_url" in
  https://*) ;;
  *) runtime_fail "SEO_PLATFORM_PUBLIC_URL must be an HTTPS URL" ;;
esac

[ -x "$postgres_distribution_root/usr/lib/postgresql/18/bin/postgres" ] ||
  runtime_fail "POSTGRES_DISTRIBUTION_ROOT does not contain PostgreSQL 18"
[ -x "$redis_server_binary" ] ||
  runtime_fail "REDIS_SERVER_BINARY is not executable"
[ -x "$redis_cli_binary" ] ||
  runtime_fail "REDIS_CLI_BINARY is not executable"
[ -x "$nats_server_binary" ] ||
  runtime_fail "NATS_SERVER_BINARY is not executable"

mkdir -p \
  "$runtime_root/bin" \
  "$runtime_root/logs" \
  "$runtime_root/nats/data" \
  "$runtime_root/nats/runtime" \
  "$runtime_root/object-storage/data" \
  "$runtime_root/object-storage/mc" \
  "$runtime_root/postgres/socket" \
  "$runtime_root/clamav/database" \
  "$runtime_root/clamav/run" \
  "$runtime_root/redis/jobs/data" \
  "$runtime_root/redis/realtime/data"
chmod 700 \
  "$runtime_root" \
  "$runtime_root/logs" \
  "$runtime_root/nats" \
  "$runtime_root/nats/data" \
  "$runtime_root/nats/runtime" \
  "$runtime_root/object-storage" \
  "$runtime_root/object-storage/data" \
  "$runtime_root/object-storage/mc" \
  "$runtime_root/postgres/socket" \
  "$runtime_root/clamav" \
  "$runtime_root/clamav/database" \
  "$runtime_root/clamav/run" \
  "$runtime_root/redis" \
  "$runtime_root/redis/jobs" \
  "$runtime_root/redis/jobs/data" \
  "$runtime_root/redis/realtime" \
  "$runtime_root/redis/realtime/data"

if [ ! -x "$runtime_root/postgres/usr/lib/postgresql/18/bin/postgres" ]; then
  mkdir -p "$runtime_root/postgres"
  cp -a "$postgres_distribution_root/." "$runtime_root/postgres/"
fi
install -m 0755 "$redis_server_binary" "$runtime_root/bin/redis-server"
install -m 0755 "$redis_cli_binary" "$runtime_root/bin/redis-cli"
install -m 0755 "$nats_server_binary" "$runtime_root/bin/nats-server"

"$runtime_root/postgres/usr/lib/postgresql/18/bin/postgres" --version |
  grep -Eq '^postgres \(PostgreSQL\) 18\.' ||
  runtime_fail "installed PostgreSQL has an unexpected major version"
"$runtime_root/bin/redis-server" --version |
  grep -q 'v=8.8.1' ||
  runtime_fail "installed Redis must be 8.8.1"
"$runtime_root/bin/nats-server" --version |
  grep -q 'v2.12.12' ||
  runtime_fail "installed NATS must be 2.12.12"

random_url_secret() {
  openssl rand -hex 32
}

random_base64url_key() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
}

bcrypt_verifier() {
  python3 -c \
    'import bcrypt,sys; print(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(rounds=11, prefix=b"2a")).decode())'
}

write_environment_value() {
  local name=$1
  local value=$2
  case "$name" in
    *[!A-Z0-9_]*) runtime_fail "invalid environment variable name" ;;
  esac
  case "$value" in
    *"'"*|*$'\n'*|*$'\r'*) runtime_fail "unsafe generated environment value" ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$temporary_env_file"
}

if [ ! -f "$runtime_env_file" ]; then
  temporary_env_file=$runtime_root/runtime.env.tmp.$$
  trap 'rm -f "$temporary_env_file"' EXIT INT TERM
  : > "$temporary_env_file"
  chmod 600 "$temporary_env_file"

  write_environment_value SEO_PLATFORM_PUBLIC_URL "$public_url"
  write_environment_value POSTGRES_BOOTSTRAP_PASSWORD "$(random_url_secret)"

  for secret_name in \
    PLATFORM_DATABASE_OWNER_PASSWORD \
    PLATFORM_DATABASE_PASSWORD \
    SEO_DATABASE_OWNER_PASSWORD \
    SEO_DATABASE_PASSWORD \
    JOBS_DATABASE_OWNER_PASSWORD \
    JOBS_DATABASE_PASSWORD \
    JOBS_RANK_DATABASE_PASSWORD \
    JOBS_AUTH_EMAIL_DATABASE_PASSWORD \
    JOBS_CONNECTOR_DATABASE_PASSWORD \
    REALTIME_DATABASE_OWNER_PASSWORD \
    REALTIME_DATABASE_PASSWORD \
    DIRECTUS_DATABASE_PASSWORD \
    REDIS_JOBS_API_PASSWORD \
    REDIS_JOBS_SYSTEM_PASSWORD \
    REDIS_JOBS_INSPECTION_PASSWORD \
    REDIS_JOBS_IMPORT_PASSWORD \
    REDIS_JOBS_RANK_PASSWORD \
    REDIS_JOBS_CRAWL_PASSWORD \
    REDIS_JOBS_CONNECTOR_PASSWORD \
    REDIS_REALTIME_PASSWORD \
    REDIS_DIRECTUS_PASSWORD \
    PLATFORM_API_TO_SEO_DATA_TOKEN \
    PLATFORM_API_TO_JOBS_TOKEN \
    JOBS_TO_SEO_DATA_TOKEN \
    PLATFORM_API_TO_REALTIME_TOKEN \
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN \
    PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN \
    JOBS_TO_SEO_RANK_TOKEN \
    JOBS_TO_SEO_RANK_RESULT_TOKEN \
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN \
    JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN \
    RANK_HISTORY_CURSOR_KEY \
    AUTH_PASSWORD_PEPPER
  do
    write_environment_value "$secret_name" "$(random_url_secret)"
  done

  write_environment_value AUTH_DATA_ENCRYPTION_KEY "$(random_base64url_key)"
  write_environment_value INTEGRATION_CREDENTIAL_KEY "$(random_base64url_key)"
  write_environment_value INTEGRATION_CREDENTIAL_FINGERPRINT_KEY "$(random_base64url_key)"
  write_environment_value MINIO_ROOT_USER seo_minio_root
  write_environment_value MINIO_ROOT_PASSWORD "$(random_url_secret)"
  write_environment_value S3_ACCESS_KEY_ID seo_platform_storage
  write_environment_value S3_SECRET_ACCESS_KEY "$(random_url_secret)"
  write_environment_value S3_REGION us-east-1
  write_environment_value S3_BUCKET_UPLOADS seo-platform-uploads
  write_environment_value S3_BUCKET_ARTIFACTS seo-platform-artifacts

  write_environment_value NATS_RUNTIME_USER seo_runtime
  write_environment_value NATS_PLATFORM_PUBLISHER_USER seo_platform_publisher
  write_environment_value NATS_REALTIME_CONSUMER_USER seo_realtime_consumer
  write_environment_value NATS_AUTH_EMAIL_CONSUMER_USER seo_auth_email_consumer
  write_environment_value NATS_PROVISIONER_USER seo_topology_provisioner

  for nats_role in \
    RUNTIME \
    PLATFORM_PUBLISHER \
    REALTIME_CONSUMER \
    AUTH_EMAIL_CONSUMER \
    PROVISIONER
  do
    nats_password="n$(random_url_secret)"
    write_environment_value "NATS_${nats_role}_PASSWORD" "$nats_password"
    write_environment_value \
      "NATS_${nats_role}_PASSWORD_HASH" \
      "$(printf '%s' "$nats_password" | bcrypt_verifier)"
    unset nats_password
  done

  write_environment_value NATS_EVENT_ENVIRONMENT production
  write_environment_value NATS_IDENTITY_EVENT_SUBJECT production.identity.session-family.revoked.v1
  write_environment_value NATS_IDENTITY_EVENT_DLQ_SUBJECT production.dlq.realtime.identity.session-family.revoked.v1
  write_environment_value NATS_EMAIL_VERIFICATION_EVENT_SUBJECT production.email.identity.email-verification.requested.v1
  write_environment_value NATS_PASSWORD_RESET_EVENT_SUBJECT production.email.identity.password-reset.requested.v1
  write_environment_value NATS_WORKSPACE_INVITE_EVENT_SUBJECT production.email.workspace.invite.requested.v1
  write_environment_value NATS_NPD_RECEIPT_EVENT_SUBJECT production.email.billing.npd-receipt.delivery-requested.v1
  write_environment_value NATS_AUTH_EMAIL_DLQ_SUBJECT production.dlq.jobs.transactional-email.v1

  mv "$temporary_env_file" "$runtime_env_file"
  temporary_env_file=
  trap - EXIT INT TERM
  chmod 600 "$runtime_env_file"
else
  chmod 600 "$runtime_env_file"
fi

if ! grep -q '^MINIO_ROOT_USER=' "$runtime_env_file"; then
  temporary_env_file=$runtime_root/runtime.env.tmp.$$
  trap 'rm -f "$temporary_env_file"' EXIT INT TERM
  cp "$runtime_env_file" "$temporary_env_file"
  chmod 600 "$temporary_env_file"
  write_environment_value MINIO_ROOT_USER seo_minio_root
  write_environment_value MINIO_ROOT_PASSWORD "$(random_url_secret)"
  write_environment_value S3_ACCESS_KEY_ID seo_platform_storage
  write_environment_value S3_SECRET_ACCESS_KEY "$(random_url_secret)"
  write_environment_value S3_REGION us-east-1
  write_environment_value S3_BUCKET_UPLOADS seo-platform-uploads
  write_environment_value S3_BUCKET_ARTIFACTS seo-platform-artifacts
  mv "$temporary_env_file" "$runtime_env_file"
  temporary_env_file=
  trap - EXIT INT TERM
  chmod 600 "$runtime_env_file"
fi

load_runtime_environment

postgres_data_dir=$runtime_root/postgres/data
if [ ! -f "$postgres_data_dir/PG_VERSION" ]; then
  password_file=$runtime_root/postgres/bootstrap-password.tmp.$$
  trap 'rm -f "$password_file"' EXIT INT TERM
  printf '%s' "$POSTGRES_BOOTSTRAP_PASSWORD" > "$password_file"
  chmod 600 "$password_file"
  env \
    -i \
    PATH="$(postgres_bin_dir):/usr/bin:/bin" \
    LD_LIBRARY_PATH="$(postgres_library_dir)" \
    "$(postgres_bin_dir)/initdb" \
    --pgdata "$postgres_data_dir" \
    --username seo_bootstrap \
    --pwfile "$password_file" \
    --auth-local trust \
    --auth-host scram-sha-256 \
    --encoding UTF8 \
    --locale C.UTF-8 >/dev/null
  rm -f "$password_file"
  trap - EXIT INT TERM
  chmod 700 "$postgres_data_dir"
fi

env \
  -i \
  PATH="/usr/bin:/bin" \
  REDIS_JOBS_API_PASSWORD="$REDIS_JOBS_API_PASSWORD" \
  REDIS_JOBS_SYSTEM_PASSWORD="$REDIS_JOBS_SYSTEM_PASSWORD" \
  REDIS_JOBS_INSPECTION_PASSWORD="$REDIS_JOBS_INSPECTION_PASSWORD" \
  REDIS_JOBS_IMPORT_PASSWORD="$REDIS_JOBS_IMPORT_PASSWORD" \
  REDIS_JOBS_RANK_PASSWORD="$REDIS_JOBS_RANK_PASSWORD" \
  REDIS_JOBS_CRAWL_PASSWORD="$REDIS_JOBS_CRAWL_PASSWORD" \
  REDIS_JOBS_CONNECTOR_PASSWORD="$REDIS_JOBS_CONNECTOR_PASSWORD" \
  /bin/sh \
  "$project_root/platform-infrastructure/redis/render-acl.sh" \
  jobs \
  "$runtime_root/redis/jobs/users.acl"

env \
  -i \
  PATH="/usr/bin:/bin" \
  REDIS_REALTIME_PASSWORD="$REDIS_REALTIME_PASSWORD" \
  /bin/sh \
  "$project_root/platform-infrastructure/redis/render-acl.sh" \
  realtime \
  "$runtime_root/redis/realtime/users.acl"

printf '%s\n' \
  "seo-platform-vps: runtime installed in $runtime_root" \
  "seo-platform-vps: generated secrets are stored only in runtime.env (mode 600)"

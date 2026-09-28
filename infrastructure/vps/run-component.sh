#!/usr/bin/env bash

set -euo pipefail

script_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"

component=${1:-}
load_runtime_environment

node_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/node
pnpm_bin=/home/dev/.nvm/versions/node/v24.18.1/bin/pnpm
node_path=/home/dev/.nvm/versions/node/v24.18.1/bin:/usr/bin:/bin
nats_url=nats://127.0.0.1:4222
postgres_url=127.0.0.1:5432

case "$component" in
  postgres)
    exec env \
      -i \
      PATH="$(postgres_bin_dir):/usr/bin:/bin" \
      LD_LIBRARY_PATH="$(postgres_library_dir)" \
      "$(postgres_bin_dir)/postgres" \
      -D "$runtime_root/postgres/data" \
      -h 127.0.0.1 \
      -k "$runtime_root/postgres/socket" \
      -p 5432 \
      -c password_encryption=scram-sha-256 \
      -c timezone=UTC \
      -c max_connections="${POSTGRES_MAX_CONNECTIONS:-250}" \
      -c log_timezone=UTC \
      -c log_statement=none \
      -c log_min_error_statement=panic \
      -c log_error_verbosity=terse \
      -c log_parameter_max_length=0 \
      -c log_parameter_max_length_on_error=0
    ;;
  redis-jobs)
    redis_jobs_config=$runtime_root/redis/jobs/redis.conf
    sed \
      -e 's/^bind .*/bind 127.0.0.1/' \
      -e "s#^aclfile .*#aclfile $runtime_root/redis/jobs/users.acl#" \
      -e "s#^dir .*#dir $runtime_root/redis/jobs/data#" \
      "$project_root/infrastructure/redis/jobs.conf" \
      > "$redis_jobs_config"
    chmod 600 "$redis_jobs_config"
    exec env \
      -i \
      PATH="$runtime_root/bin:/usr/bin:/bin" \
      "$runtime_root/bin/redis-server" \
      "$redis_jobs_config"
    ;;
  redis-realtime)
    redis_realtime_config=$runtime_root/redis/realtime/redis.conf
    sed \
      -e 's/^bind .*/bind 127.0.0.1/' \
      -e 's/^port .*/port 6380/' \
      -e "s#^aclfile .*#aclfile $runtime_root/redis/realtime/users.acl#" \
      -e "s#^dir .*#dir $runtime_root/redis/realtime/data#" \
      "$project_root/infrastructure/redis/realtime.conf" \
      > "$redis_realtime_config"
    chmod 600 "$redis_realtime_config"
    exec env \
      -i \
      PATH="$runtime_root/bin:/usr/bin:/bin" \
      "$runtime_root/bin/redis-server" \
      "$redis_realtime_config"
    ;;
  nats)
    nats_template=$runtime_root/nats/nats-server.template.conf
    sed \
      -e '/^port: 4222$/a host: "127.0.0.1"' \
      -e 's/^http_port: 8222$/http: "127.0.0.1:8222"/' \
      -e "s#store_dir: \"/data\"#store_dir: \"$runtime_root/nats/data\"#" \
      "$project_root/infrastructure/nats/nats-server.conf" \
      > "$nats_template"
    chmod 600 "$nats_template"
    exec env \
      -i \
      PATH="$runtime_root/bin:/usr/bin:/bin" \
      NATS_RUNTIME_USER="$NATS_RUNTIME_USER" \
      NATS_RUNTIME_PASSWORD_HASH="$NATS_RUNTIME_PASSWORD_HASH" \
      NATS_PLATFORM_PUBLISHER_USER="$NATS_PLATFORM_PUBLISHER_USER" \
      NATS_PLATFORM_PUBLISHER_PASSWORD_HASH="$NATS_PLATFORM_PUBLISHER_PASSWORD_HASH" \
      NATS_REALTIME_CONSUMER_USER="$NATS_REALTIME_CONSUMER_USER" \
      NATS_REALTIME_CONSUMER_PASSWORD_HASH="$NATS_REALTIME_CONSUMER_PASSWORD_HASH" \
      NATS_AUTH_EMAIL_CONSUMER_USER="$NATS_AUTH_EMAIL_CONSUMER_USER" \
      NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH="$NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH" \
      NATS_PROVISIONER_USER="$NATS_PROVISIONER_USER" \
      NATS_PROVISIONER_PASSWORD_HASH="$NATS_PROVISIONER_PASSWORD_HASH" \
      NATS_IDENTITY_EVENT_SUBJECT="$NATS_IDENTITY_EVENT_SUBJECT" \
      NATS_IDENTITY_EVENT_DLQ_SUBJECT="$NATS_IDENTITY_EVENT_DLQ_SUBJECT" \
      NATS_EMAIL_VERIFICATION_EVENT_SUBJECT="$NATS_EMAIL_VERIFICATION_EVENT_SUBJECT" \
      NATS_PASSWORD_RESET_EVENT_SUBJECT="$NATS_PASSWORD_RESET_EVENT_SUBJECT" \
      NATS_WORKSPACE_INVITE_EVENT_SUBJECT="$NATS_WORKSPACE_INVITE_EVENT_SUBJECT" \
      NATS_NPD_RECEIPT_EVENT_SUBJECT="$NATS_NPD_RECEIPT_EVENT_SUBJECT" \
      NATS_AUTH_EMAIL_DLQ_SUBJECT="$NATS_AUTH_EMAIL_DLQ_SUBJECT" \
      /bin/sh \
      "$project_root/infrastructure/nats/start-nats.sh" \
      "$nats_template" \
      "$runtime_root/nats/runtime"
    ;;
  object-storage)
    exec env \
      -i \
      PATH="$runtime_root/bin:/usr/bin:/bin" \
      HOME="$runtime_root/object-storage" \
      MINIO_ROOT_USER="$MINIO_ROOT_USER" \
      MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
      MINIO_BROWSER=off \
      MINIO_API_CORS_ALLOW_ORIGIN="$SEO_PLATFORM_PUBLIC_URL" \
      MINIO_PROMETHEUS_AUTH_TYPE=public \
      "$runtime_root/bin/minio" \
      server \
      --quiet \
      --anonymous \
      --json \
      --address 127.0.0.1:9000 \
      --console-address 127.0.0.1:9001 \
      "$runtime_root/object-storage/data"
    ;;
  storage-proxy)
    exec env \
      -i \
      PATH="/usr/bin:/bin" \
      SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      "$script_dir/storage-proxy.sh" \
      watch
    ;;
  public-api-proxy)
    exec env \
      -i \
      PATH="/usr/bin:/bin" \
      SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      API_PUBLIC_URL="${API_PUBLIC_URL:-}" \
      "$script_dir/public-api-proxy.sh" \
      watch
    ;;
  billing-webhook-proxy)
    exec env \
      -i \
      PATH="/usr/bin:/bin" \
      SEO_PLATFORM_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      "$script_dir/billing-webhook-proxy.sh" \
      watch
    ;;
  clamd)
    clam_root=$runtime_root/clamav
    exec env \
      -i \
      PATH="$clam_root/usr/local/bin:$clam_root/usr/local/sbin:/usr/bin:/bin" \
      LD_LIBRARY_PATH="$clam_root/usr/local/lib" \
      CVD_CERTS_DIR="$clam_root/usr/local/etc/certs" \
      "$clam_root/usr/local/sbin/clamd" \
      --foreground \
      --config-file "$clam_root/run/clamd.conf"
    ;;
  freshclam)
    clam_root=$runtime_root/clamav
    exec env \
      -i \
      PATH="$clam_root/usr/local/bin:/usr/bin:/bin" \
      LD_LIBRARY_PATH="$clam_root/usr/local/lib" \
      CVD_CERTS_DIR="$clam_root/usr/local/etc/certs" \
      CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
      "$clam_root/usr/local/bin/freshclam" \
      --daemon \
      --foreground \
      --config-file "$clam_root/run/freshclam.conf" \
      --daemon-notify="$clam_root/run/clamd.conf" \
      --stdout
    ;;
  operational-alerts)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      BIND_ADDRESS=127.0.0.1 \
      SERVICE_VERSION=0.1.0 \
      OPERATIONAL_ALERTS_PORT=4004 \
      OPERATIONAL_ALERT_TOKEN="$OPERATIONAL_ALERT_TOKEN" \
      TELEGRAM_ALERTS_ENABLED="${TELEGRAM_ALERTS_ENABLED:-false}" \
      TELEGRAM_ALERT_BOT_TOKEN="${TELEGRAM_ALERT_BOT_TOKEN:-}" \
      TELEGRAM_ALERT_CHAT_ID="${TELEGRAM_ALERT_CHAT_ID:-}" \
      TELEGRAM_ALERT_THREAD_ID="${TELEGRAM_ALERT_THREAD_ID:-}" \
      TELEGRAM_ALERT_ENVIRONMENT="${TELEGRAM_ALERT_ENVIRONMENT:-production}" \
      "$node_bin" "$project_root/backend-core/dist/alert.main.js"
    ;;
  backend-core)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      BIND_ADDRESS=127.0.0.1 \
      TELEGRAM_ALERTS_ENABLED="${TELEGRAM_ALERTS_ENABLED:-false}" \
      OPERATIONAL_ALERTS_INTERNAL_URL="http://127.0.0.1:4004" \
      OPERATIONAL_ALERT_TOKEN="$OPERATIONAL_ALERT_TOKEN" \
      SERVICE_VERSION=0.1.0 \
      PLATFORM_PORT=4000 \
      PLATFORM_DATABASE_URL="postgresql://platform_runtime:${PLATFORM_DATABASE_PASSWORD}@${postgres_url}/platform_db" \
      PLATFORM_DATABASE_POOL_MAX=20 \
      PLATFORM_NATS_USER="$NATS_PLATFORM_PUBLISHER_USER" \
      PLATFORM_NATS_PASSWORD="$NATS_PLATFORM_PUBLISHER_PASSWORD" \
      SEO_PORT=4001 \
      SEO_DATABASE_URL="postgresql://seo_runtime:${SEO_DATABASE_PASSWORD}@${postgres_url}/seo_db" \
      SEO_DATABASE_POOL_MAX=30 \
      SEO_NATS_USER="$NATS_RUNTIME_USER" \
      SEO_NATS_PASSWORD="$NATS_RUNTIME_PASSWORD" \
      NATS_URL="$nats_url" \
      OUTBOX_PUBLISHER_ENABLED=true \
      NATS_EVENT_ENVIRONMENT="$NATS_EVENT_ENVIRONMENT" \
      NATS_EVENT_STREAM=IDENTITY_EVENTS \
      NATS_AUTH_EMAIL_STREAM=AUTH_EMAIL_EVENTS \
      SESSION_EXPIRY_SWEEPER_ENABLED=true \
      SEO_DATA_INTERNAL_URL=http://127.0.0.1:4001 \
      JOBS_INTERNAL_URL=http://127.0.0.1:4002 \
      REALTIME_INTERNAL_URL=http://127.0.0.1:4003 \
      PLATFORM_API_TO_SEO_DATA_TOKEN="$PLATFORM_API_TO_SEO_DATA_TOKEN" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      JOBS_TO_SEO_RANK_TOKEN="$JOBS_TO_SEO_RANK_TOKEN" \
      JOBS_TO_SEO_RANK_RESULT_TOKEN="$JOBS_TO_SEO_RANK_RESULT_TOKEN" \
      RANK_HISTORY_CURSOR_KEY="$RANK_HISTORY_CURSOR_KEY" \
      PLATFORM_API_TO_JOBS_TOKEN="$PLATFORM_API_TO_JOBS_TOKEN" \
      PLATFORM_API_TO_REALTIME_TOKEN="$PLATFORM_API_TO_REALTIME_TOKEN" \
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN="$PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN" \
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN="$PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN" \
      REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN="$REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN" \
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN="$JOBS_TO_PLATFORM_RANK_GRANT_TOKEN" \
      JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN="$JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN" \
      JOBS_TO_PLATFORM_AUTOMATION_TOKEN="$JOBS_TO_PLATFORM_AUTOMATION_TOKEN" \
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN="$JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN" \
      CORS_ORIGINS="$SEO_PLATFORM_PUBLIC_URL" \
      WEB_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      AUTH_COOKIE_SECURE=true \
      AUTH_EMAIL_VERIFICATION_REQUIRED="${AUTH_EMAIL_ENABLED:-false}" \
      AUTH_EXPOSE_DEVELOPMENT_TOKENS=false \
      AUTH_PASSWORD_PEPPER="$AUTH_PASSWORD_PEPPER" \
      AUTH_DATA_ENCRYPTION_KEY="$AUTH_DATA_ENCRYPTION_KEY" \
      TELEGRAM_LOGIN_ENABLED="${TELEGRAM_LOGIN_ENABLED:-false}" \
      TELEGRAM_LOGIN_BOT_TOKEN="${TELEGRAM_LOGIN_BOT_TOKEN:-}" \
      TELEGRAM_LOGIN_BOT_USERNAME="${TELEGRAM_LOGIN_BOT_USERNAME:-}" \
      TELEGRAM_LOGIN_WEBHOOK_SECRET="${TELEGRAM_LOGIN_WEBHOOK_SECRET:-}" \
      TELEGRAM_LOGIN_WEBHOOK_URL="${TELEGRAM_LOGIN_WEBHOOK_URL:-}" \
      NPD_RECEIPTS_ENABLED="${NPD_RECEIPTS_ENABLED:-false}" \
      NPD_PROCESSOR_API_TOKEN="${NPD_PROCESSOR_API_TOKEN:-}" \
      CRYPTO_PAY_ENABLED="${CRYPTO_PAY_ENABLED:-false}" \
      CRYPTO_PAY_API_TOKEN="${CRYPTO_PAY_API_TOKEN:-}" \
      CRYPTO_PAY_API_BASE_URL="${CRYPTO_PAY_API_BASE_URL:-https://pay.crypt.bot/api}" \
      CRYPTO_PAY_REQUEST_TIMEOUT_MS="${CRYPTO_PAY_REQUEST_TIMEOUT_MS:-10000}" \
      YOOKASSA_ENABLED="${YOOKASSA_ENABLED:-false}" \
      YOOKASSA_SHOP_ID="${YOOKASSA_SHOP_ID:-}" \
      YOOKASSA_SECRET_KEY="${YOOKASSA_SECRET_KEY:-}" \
      YOOKASSA_RETURN_URL="${YOOKASSA_RETURN_URL:-${SEO_PLATFORM_PUBLIC_URL}/app/settings/billing?checkout=return}" \
      YOOKASSA_API_BASE_URL="${YOOKASSA_API_BASE_URL:-https://api.yookassa.ru/v3}" \
      YOOKASSA_REQUEST_TIMEOUT_MS="${YOOKASSA_REQUEST_TIMEOUT_MS:-10000}" \
      YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP="${YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP:-true}" \
      BILLING_RECONCILIATION_ENABLED="${BILLING_RECONCILIATION_ENABLED:-false}" \
      BILLING_RECONCILIATION_INTERVAL_MS="${BILLING_RECONCILIATION_INTERVAL_MS:-60000}" \
      BILLING_RECONCILIATION_BATCH_SIZE="${BILLING_RECONCILIATION_BATCH_SIZE:-25}" \
      PLATFORM_XMLSTOCK_ENABLED="${PLATFORM_XMLSTOCK_ENABLED:-false}" \
      PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR="${PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR:-}" \
      PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR="${PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR:-}" \
      PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR="${PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR:-}" \
      PLATFORM_ARSENKIN_ENABLED="${PLATFORM_ARSENKIN_ENABLED:-false}" \
      PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR="${PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR:-}" \
      PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR="${PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR:-}" \
      PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR="${PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR:-}" \
      "$node_bin" "$project_root/backend-core/dist/core.main.js"
    ;;
  backend-execution)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      BIND_ADDRESS=127.0.0.1 \
      PORT=4002 \
      SERVICE_VERSION=0.1.0 \
      DATABASE_URL="postgresql://jobs_runtime:${JOBS_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=30 \
      REDIS_URL="redis://seo_jobs_api:${REDIS_JOBS_API_PASSWORD}@127.0.0.1:6379" \
      NATS_URL="$nats_url" \
      NATS_USER="$NATS_RUNTIME_USER" \
      NATS_PASSWORD="$NATS_RUNTIME_PASSWORD" \
      PLATFORM_API_TO_JOBS_TOKEN="$PLATFORM_API_TO_JOBS_TOKEN" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN="$PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      PLATFORM_API_URL=http://127.0.0.1:4000 \
      JOBS_TO_PLATFORM_AUTOMATION_TOKEN="$JOBS_TO_PLATFORM_AUTOMATION_TOKEN" \
      INTEGRATION_CREDENTIAL_ROLE=MANAGEMENT \
      INTEGRATION_CREDENTIAL_KEYS="1:${INTEGRATION_CREDENTIAL_KEY}" \
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION=1 \
      INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS="1:${INTEGRATION_CREDENTIAL_FINGERPRINT_KEY}" \
      INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION=1 \
      PLATFORM_XMLSTOCK_ENABLED="${PLATFORM_XMLSTOCK_ENABLED:-false}" \
      PLATFORM_XMLSTOCK_API_KEY="${PLATFORM_XMLSTOCK_API_KEY:-}" \
      PLATFORM_XMLSTOCK_API_KEYS="${PLATFORM_XMLSTOCK_API_KEYS:-}" \
      PLATFORM_XMLSTOCK_ACCOUNT_ID="${PLATFORM_XMLSTOCK_ACCOUNT_ID:-}" \
      PLATFORM_XMLSTOCK_ACCOUNT_IDS="${PLATFORM_XMLSTOCK_ACCOUNT_IDS:-}" \
      PLATFORM_XMLSTOCK_SOFT_ID="${PLATFORM_XMLSTOCK_SOFT_ID:-}" \
      PLATFORM_ARSENKIN_ENABLED="${PLATFORM_ARSENKIN_ENABLED:-false}" \
      PLATFORM_ARSENKIN_API_KEY="${PLATFORM_ARSENKIN_API_KEY:-}" \
      PLATFORM_ARSENKIN_API_KEYS="${PLATFORM_ARSENKIN_API_KEYS:-}" \
      RANK_PREPARATION_ENABLED=false \
      RANK_PROVIDER_SUBMIT_ENABLED=false \
      S3_ENABLED=true \
      S3_ENDPOINT="$(public_storage_endpoint)" \
      S3_REGION="$S3_REGION" \
      S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
      S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      S3_BUCKET_UPLOADS="$S3_BUCKET_UPLOADS" \
      S3_BUCKET_ARTIFACTS="$S3_BUCKET_ARTIFACTS" \
      S3_FORCE_PATH_STYLE=true \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/backend-execution/dist/http.main.js"
    ;;
  realtime)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      BIND_ADDRESS=127.0.0.1 \
      PORT=4003 \
      SERVICE_VERSION=0.1.0 \
      DATABASE_URL="postgresql://realtime_runtime:${REALTIME_DATABASE_PASSWORD}@${postgres_url}/realtime_db" \
      DATABASE_POOL_MAX=20 \
      REDIS_URL="redis://seo_realtime:${REDIS_REALTIME_PASSWORD}@127.0.0.1:6380" \
      NATS_URL="$nats_url" \
      NATS_USER="$NATS_REALTIME_CONSUMER_USER" \
      NATS_PASSWORD="$NATS_REALTIME_CONSUMER_PASSWORD" \
      NATS_EVENT_CONSUMER_ENABLED=true \
      NATS_EVENT_ENVIRONMENT="$NATS_EVENT_ENVIRONMENT" \
      NATS_EVENT_STREAM=IDENTITY_EVENTS \
      NATS_EVENT_CONSUMER_DURABLE=realtime_session_family_revoked_v1 \
      NATS_EVENT_DLQ_STREAM=DOMAIN_EVENTS_DLQ \
      NATS_EVENT_DLQ_SUBJECT="$NATS_IDENTITY_EVENT_DLQ_SUBJECT" \
      PLATFORM_API_TO_REALTIME_TOKEN="$PLATFORM_API_TO_REALTIME_TOKEN" \
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN="$PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN" \
      WEB_ORIGINS="$SEO_PLATFORM_PUBLIC_URL" \
      WEB_PUSH_REGISTRATION_ENABLED="${WEB_PUSH_REGISTRATION_ENABLED:-false}" \
      WEB_PUSH_DELIVERY_AVAILABLE="${WEB_PUSH_DELIVERY_AVAILABLE:-false}" \
      WEB_PUSH_VAPID_PUBLIC_KEY="${WEB_PUSH_VAPID_PUBLIC_KEY:-}" \
      WEB_PUSH_VAPID_KEY_VERSION="${WEB_PUSH_VAPID_KEY_VERSION:-}" \
      WEB_PUSH_ENDPOINT_ORIGINS="${WEB_PUSH_ENDPOINT_ORIGINS:-}" \
      WEB_PUSH_SUBSCRIPTION_KEYS="${WEB_PUSH_SUBSCRIPTION_KEYS:-}" \
      WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION="${WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION:-}" \
      WEB_PUSH_FINGERPRINT_KEYS="${WEB_PUSH_FINGERPRINT_KEYS:-}" \
      WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION="${WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION:-}" \
      WEB_PUSH_MAX_ACTIVE_DEVICES="${WEB_PUSH_MAX_ACTIVE_DEVICES:-20}" \
      "$node_bin" "$project_root/backend-core/dist/realtime.main.js"
    ;;
  web-push-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      SERVICE_ROLE=WEB_PUSH_WORKER \
      SERVICE_VERSION=0.1.0 \
      DATABASE_URL="postgresql://realtime_web_push:${REALTIME_WEB_PUSH_DATABASE_PASSWORD}@${postgres_url}/realtime_db" \
      DATABASE_POOL_MAX=10 \
      PLATFORM_API_INTERNAL_URL=http://127.0.0.1:4000 \
      REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN="$REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN" \
      WEB_PUSH_DELIVERY_ENABLED="${WEB_PUSH_DELIVERY_ENABLED:-false}" \
      WEB_PUSH_VAPID_PUBLIC_KEY="${WEB_PUSH_VAPID_PUBLIC_KEY:-}" \
      WEB_PUSH_VAPID_PRIVATE_KEY="${WEB_PUSH_VAPID_PRIVATE_KEY:-}" \
      WEB_PUSH_VAPID_SUBJECT="${WEB_PUSH_VAPID_SUBJECT:-}" \
      WEB_PUSH_VAPID_KEY_VERSION="${WEB_PUSH_VAPID_KEY_VERSION:-}" \
      WEB_PUSH_SUBSCRIPTION_KEYS="${WEB_PUSH_SUBSCRIPTION_KEYS:-}" \
      WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION="${WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION:-}" \
      WEB_PUSH_FINGERPRINT_KEYS="${WEB_PUSH_FINGERPRINT_KEYS:-}" \
      WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION="${WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION:-}" \
      WEB_PUSH_DELIVERY_MAX_ATTEMPTS="${WEB_PUSH_DELIVERY_MAX_ATTEMPTS:-8}" \
      WEB_PUSH_DELIVERY_POLL_INTERVAL_MS="${WEB_PUSH_DELIVERY_POLL_INTERVAL_MS:-1000}" \
      WEB_PUSH_DELIVERY_LEASE_MS="${WEB_PUSH_DELIVERY_LEASE_MS:-30000}" \
      WEB_PUSH_DELIVERY_RETRY_BASE_MS="${WEB_PUSH_DELIVERY_RETRY_BASE_MS:-1000}" \
      WEB_PUSH_DELIVERY_RETRY_MAX_MS="${WEB_PUSH_DELIVERY_RETRY_MAX_MS:-300000}" \
      WEB_PUSH_DELIVERY_SEND_TIMEOUT_MS="${WEB_PUSH_DELIVERY_SEND_TIMEOUT_MS:-10000}" \
      WEB_PUSH_DELIVERY_AUTHORIZATION_TIMEOUT_MS="${WEB_PUSH_DELIVERY_AUTHORIZATION_TIMEOUT_MS:-5000}" \
      WEB_PUSH_DELIVERY_TTL_SECONDS="${WEB_PUSH_DELIVERY_TTL_SECONDS:-3600}" \
      WEB_PUSH_EXPIRY_SWEEP_INTERVAL_MS="${WEB_PUSH_EXPIRY_SWEEP_INTERVAL_MS:-60000}" \
      WEB_PUSH_EXPIRY_SWEEP_BATCH_SIZE="${WEB_PUSH_EXPIRY_SWEEP_BATCH_SIZE:-100}" \
      "$node_bin" "$project_root/backend-core/dist/web-push-worker.main.js"
    ;;
  system-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      REDIS_URL="redis://seo_jobs_system:${REDIS_JOBS_SYSTEM_PASSWORD}@127.0.0.1:6379" \
      SYSTEM_WORKER_CONCURRENCY=2 \
      "$node_bin" "$project_root/backend-execution/dist/worker.main.js"
    ;;
  import-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_runtime:${JOBS_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=10 \
      REDIS_URL="redis://seo_jobs_import:${REDIS_JOBS_IMPORT_PASSWORD}@127.0.0.1:6379" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      S3_ENABLED=true \
      S3_ENDPOINT="$(public_storage_endpoint)" \
      S3_REGION="$S3_REGION" \
      S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
      S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      S3_BUCKET_UPLOADS="$S3_BUCKET_UPLOADS" \
      S3_BUCKET_ARTIFACTS="$S3_BUCKET_ARTIFACTS" \
      S3_FORCE_PATH_STYLE=true \
      UPLOAD_FILE_RETENTION_DAYS="${UPLOAD_FILE_RETENTION_DAYS:-30}" \
      EXPORT_FILE_RETENTION_DAYS="${EXPORT_FILE_RETENTION_DAYS:-7}" \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/backend-execution/dist/import-worker.main.js"
    ;;
  inspection-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_runtime:${JOBS_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=10 \
      REDIS_URL="redis://seo_jobs_inspection:${REDIS_JOBS_INSPECTION_PASSWORD}@127.0.0.1:6379" \
      S3_ENABLED=true \
      S3_ENDPOINT="$(public_storage_endpoint)" \
      S3_REGION="$S3_REGION" \
      S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
      S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
      S3_BUCKET_UPLOADS="$S3_BUCKET_UPLOADS" \
      S3_BUCKET_ARTIFACTS="$S3_BUCKET_ARTIFACTS" \
      S3_FORCE_PATH_STYLE=true \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=true \
      MALWARE_SCANNER_HOST=127.0.0.1 \
      MALWARE_SCANNER_PORT=3310 \
      "$node_bin" "$project_root/backend-execution/dist/inspection-worker.main.js"
    ;;
  auth-email-worker)
    [ "${AUTH_EMAIL_ENABLED:-false}" = true ] ||
      runtime_fail "auth-email worker is not enabled"
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_auth_email_runtime:${JOBS_AUTH_EMAIL_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=5 \
      NATS_URL="$nats_url" \
      NATS_USER="$NATS_AUTH_EMAIL_CONSUMER_USER" \
      NATS_PASSWORD="$NATS_AUTH_EMAIL_CONSUMER_PASSWORD" \
      PLATFORM_API_URL=http://127.0.0.1:4000 \
      PLATFORM_API_COMMAND_TIMEOUT_MS=5000 \
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN="$JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN" \
      AUTH_EMAIL_EVENT_ENVIRONMENT="$NATS_EVENT_ENVIRONMENT" \
      AUTH_EMAIL_MAX_ATTEMPTS="${AUTH_EMAIL_MAX_ATTEMPTS:-10}" \
      AUTH_EMAIL_LEASE_SECONDS="${AUTH_EMAIL_LEASE_SECONDS:-120}" \
      AUTH_EMAIL_DISPATCH_MS="${AUTH_EMAIL_DISPATCH_MS:-1000}" \
      AUTH_EMAIL_FETCH_EXPIRES_MS="${AUTH_EMAIL_FETCH_EXPIRES_MS:-30000}" \
      AUTH_EMAIL_PUBLISH_TIMEOUT_MS="${AUTH_EMAIL_PUBLISH_TIMEOUT_MS:-5000}" \
      AUTH_EMAIL_RETRY_BASE_MS="${AUTH_EMAIL_RETRY_BASE_MS:-1000}" \
      AUTH_EMAIL_RETRY_MAX_MS="${AUTH_EMAIL_RETRY_MAX_MS:-300000}" \
      AUTH_EMAIL_MAX_PAYLOAD_BYTES="${AUTH_EMAIL_MAX_PAYLOAD_BYTES:-65536}" \
      AUTH_EMAIL_SHUTDOWN_GRACE_MS="${AUTH_EMAIL_SHUTDOWN_GRACE_MS:-10000}" \
      EMAIL_ENABLED=true \
      EMAIL_FROM="${AUTH_EMAIL_FROM:?AUTH_EMAIL_FROM is required}" \
      EMAIL_MESSAGE_ID_DOMAIN="${AUTH_EMAIL_MESSAGE_ID_DOMAIN:?AUTH_EMAIL_MESSAGE_ID_DOMAIN is required}" \
      SMTP_HOST="${AUTH_EMAIL_SMTP_HOST:?AUTH_EMAIL_SMTP_HOST is required}" \
      SMTP_PORT="${AUTH_EMAIL_SMTP_PORT:-587}" \
      SMTP_SECURE="${AUTH_EMAIL_SMTP_SECURE:-false}" \
      SMTP_USER="${AUTH_EMAIL_SMTP_USER:?AUTH_EMAIL_SMTP_USER is required}" \
      SMTP_PASSWORD="${AUTH_EMAIL_SMTP_PASSWORD:?AUTH_EMAIL_SMTP_PASSWORD is required}" \
      SMTP_CONNECTION_TIMEOUT_MS="${AUTH_EMAIL_SMTP_CONNECTION_TIMEOUT_MS:-5000}" \
      SMTP_SOCKET_TIMEOUT_MS="${AUTH_EMAIL_SMTP_SOCKET_TIMEOUT_MS:-10000}" \
      "$node_bin" "$project_root/backend-execution/dist/auth-email-worker.main.js"
    ;;
  rank-worker|rank-worker-2)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_rank_runtime:${JOBS_RANK_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=5 \
      REDIS_URL="redis://seo_jobs_rank:${REDIS_JOBS_RANK_PASSWORD}@127.0.0.1:6379" \
      PLATFORM_API_URL=http://127.0.0.1:4000 \
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN="$JOBS_TO_PLATFORM_RANK_GRANT_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      JOBS_TO_SEO_RANK_TOKEN="$JOBS_TO_SEO_RANK_TOKEN" \
      JOBS_TO_SEO_RANK_RESULT_TOKEN="$JOBS_TO_SEO_RANK_RESULT_TOKEN" \
      RANK_PREPARATION_ENABLED=true \
      RANK_PREPARATION_DISPATCH_SECONDS=5 \
      RANK_RESULT_PERSISTENCE_DISPATCH_INTERVAL_MS=1000 \
      RANK_PREPARATION_CONCURRENCY=5 \
      CONNECTOR_RUNTIME_SHARD_COUNT=3 \
      RANK_CONNECTOR_CONCURRENCY=32 \
      RANK_PROVIDER_SUBMIT_ENABLED=false \
      INTEGRATION_CREDENTIAL_ROLE=DISABLED \
      S3_ENABLED=false \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/backend-execution/dist/rank-worker.main.js"
    ;;
  crawl-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_runtime:${JOBS_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=10 \
      REDIS_URL="redis://seo_jobs_crawl:${REDIS_JOBS_CRAWL_PASSWORD}@127.0.0.1:6379" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      CRAWL_CONTACT_URL="${SEO_PLATFORM_PUBLIC_URL}/crawler" \
      CRAWL_CONCURRENCY=2 \
      CRAWL_DISPATCH_SECONDS=15 \
      CRAWL_LEASE_SECONDS=180 \
      CRAWL_REQUEST_TIMEOUT_MS=20000 \
      CRAWL_MAX_RESPONSE_BYTES=2000000 \
      CRAWL_MAX_REDIRECTS=5 \
      S3_ENABLED=false \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/backend-execution/dist/crawl-worker.main.js"
    ;;
  connector-worker|connector-worker-2|connector-worker-3)
    case "$component" in
      connector-worker) connector_runtime_shard_index=0 ;;
      connector-worker-2) connector_runtime_shard_index=1 ;;
      connector-worker-3) connector_runtime_shard_index=2 ;;
    esac
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      TZ=UTC \
      DATABASE_URL="postgresql://jobs_connector:${JOBS_CONNECTOR_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=16 \
      REDIS_URL="redis://seo_jobs_connector:${REDIS_JOBS_CONNECTOR_PASSWORD}@127.0.0.1:6379" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      PLATFORM_API_URL=http://127.0.0.1:4000 \
      JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN="$JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN" \
      INTEGRATION_CREDENTIAL_ROLE=EXECUTION \
      INTEGRATION_CREDENTIAL_KEYS="1:${INTEGRATION_CREDENTIAL_KEY}" \
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION=1 \
      PLATFORM_XMLSTOCK_SOFT_ID="${PLATFORM_XMLSTOCK_SOFT_ID:-}" \
      INTEGRATION_VALIDATION_DISPATCH_SECONDS=5 \
      INTEGRATION_VALIDATION_CONCURRENCY=1 \
      CONNECTOR_RUNTIME_DISPATCH_INTERVAL_MS=1000 \
      CONNECTOR_PAID_RUNTIME_ENABLED="${SEO_PLATFORM_PAID_CONNECTOR_RUNTIME:-true}" \
      CONNECTOR_RUNTIME_SHARD_INDEX="$connector_runtime_shard_index" \
      CONNECTOR_RUNTIME_SHARD_COUNT=3 \
      RANK_CONNECTOR_CONCURRENCY=32 \
      FREQUENCY_COLLECTION_CONCURRENCY=4 \
      XMLSTOCK_GLOBAL_HTTP_CONCURRENCY=96 \
      KEYWORD_RESEARCH_CONCURRENCY=1 \
      RANK_PROVIDER_SUBMIT_ENABLED=true \
      RANK_PROVIDER_KILL_SWITCH_VERSION=arsenkin-positions@4 \
      S3_ENABLED=false \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/backend-execution/dist/connector-worker.main.js"
    ;;
  npd-worker)
    exec env -i PATH="$node_path" HOME=/home/dev \
      NODE_ENV=production \
      TZ=UTC \
      NPD_RECEIPTS_ENABLED=true NPD_PROCESSOR_API_TOKEN="${NPD_PROCESSOR_API_TOKEN:-}" \
      NPD_INN="${NPD_INN:-}" NPD_PASSWORD="${NPD_PASSWORD:-}" NPD_DEVICE_ID="${NPD_DEVICE_ID:-}" \
      "$node_bin" "$project_root/backend-core/dist/npd-worker.main.js"
    ;;
  web)
    exec env \
      -i \
      PATH="$node_path" \
      HOME=/home/dev \
      NODE_ENV=production \
      TZ=UTC \
      WEB_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      API_PUBLIC_URL="$(public_api_endpoint)" \
      PLATFORM_API_INTERNAL_URL=http://127.0.0.1:4000 \
      REALTIME_INTERNAL_URL=http://127.0.0.1:4003 \
      AUTH_ACCESS_COOKIE_NAME=seo_access \
      AUTH_SESSION_COOKIE_NAME=seo_session \
      AUTH_CSRF_COOKIE_NAME=seo_csrf \
      NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME=seo_csrf \
      NEXT_PUBLIC_TERMS_VERSION=2026-09-07 \
      NEXT_PUBLIC_PRIVACY_VERSION=2026-09-07 \
      NEXT_PUBLIC_MARKETING_VERSION=2026-09-07 \
      DEFAULT_LOCALE=ru \
      LEGAL_DOCUMENTS_PUBLISHED="${LEGAL_DOCUMENTS_PUBLISHED:-false}" \
      LEGAL_SELLER_NAME="${LEGAL_SELLER_NAME:-}" \
      LEGAL_SELLER_INN="${LEGAL_SELLER_INN:-}" \
      LEGAL_CONTACT_ADDRESS="${LEGAL_CONTACT_ADDRESS:-}" \
      "$pnpm_bin" \
      --dir "$project_root" \
      --filter @seo-platform/frontend \
      start
    ;;
  *)
    runtime_fail "unknown runtime component: $component"
    ;;
esac

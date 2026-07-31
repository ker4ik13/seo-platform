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
      -c password_encryption=scram-sha-256
    ;;
  redis-jobs)
    redis_jobs_config=$runtime_root/redis/jobs/redis.conf
    sed \
      -e 's/^bind .*/bind 127.0.0.1/' \
      -e "s#^aclfile .*#aclfile $runtime_root/redis/jobs/users.acl#" \
      -e "s#^dir .*#dir $runtime_root/redis/jobs/data#" \
      "$project_root/platform-infrastructure/redis/jobs.conf" \
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
      "$project_root/platform-infrastructure/redis/realtime.conf" \
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
      "$project_root/platform-infrastructure/nats/nats-server.conf" \
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
      "$project_root/platform-infrastructure/nats/start-nats.sh" \
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
  seo-data)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      BIND_ADDRESS=127.0.0.1 \
      PORT=4001 \
      SERVICE_VERSION=0.1.0 \
      DATABASE_URL="postgresql://seo_runtime:${SEO_DATABASE_PASSWORD}@${postgres_url}/seo_db" \
      DATABASE_POOL_MAX=30 \
      NATS_URL="$nats_url" \
      NATS_USER="$NATS_RUNTIME_USER" \
      NATS_PASSWORD="$NATS_RUNTIME_PASSWORD" \
      PLATFORM_API_TO_SEO_DATA_TOKEN="$PLATFORM_API_TO_SEO_DATA_TOKEN" \
      JOBS_TO_SEO_DATA_TOKEN="$JOBS_TO_SEO_DATA_TOKEN" \
      JOBS_TO_SEO_RANK_TOKEN="$JOBS_TO_SEO_RANK_TOKEN" \
      JOBS_TO_SEO_RANK_RESULT_TOKEN="$JOBS_TO_SEO_RANK_RESULT_TOKEN" \
      RANK_HISTORY_CURSOR_KEY="$RANK_HISTORY_CURSOR_KEY" \
      "$node_bin" "$project_root/platform-seo-data/dist/main.js"
    ;;
  jobs-api)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
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
      "$node_bin" "$project_root/platform-jobs-integrations/dist/main.js"
    ;;
  realtime)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
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
      WEB_PUSH_REGISTRATION_ENABLED=false \
      "$node_bin" "$project_root/platform-realtime/dist/main.js"
    ;;
  platform-api)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      BIND_ADDRESS=127.0.0.1 \
      PORT=4000 \
      SERVICE_VERSION=0.1.0 \
      DATABASE_URL="postgresql://platform_runtime:${PLATFORM_DATABASE_PASSWORD}@${postgres_url}/platform_db" \
      DATABASE_POOL_MAX=20 \
      NATS_URL="$nats_url" \
      NATS_USER="$NATS_PLATFORM_PUBLISHER_USER" \
      NATS_PASSWORD="$NATS_PLATFORM_PUBLISHER_PASSWORD" \
      OUTBOX_PUBLISHER_ENABLED=true \
      NATS_EVENT_ENVIRONMENT="$NATS_EVENT_ENVIRONMENT" \
      NATS_EVENT_STREAM=IDENTITY_EVENTS \
      NATS_AUTH_EMAIL_STREAM=AUTH_EMAIL_EVENTS \
      SESSION_EXPIRY_SWEEPER_ENABLED=true \
      SEO_DATA_INTERNAL_URL=http://127.0.0.1:4001 \
      JOBS_INTERNAL_URL=http://127.0.0.1:4002 \
      REALTIME_INTERNAL_URL=http://127.0.0.1:4003 \
      PLATFORM_API_TO_SEO_DATA_TOKEN="$PLATFORM_API_TO_SEO_DATA_TOKEN" \
      PLATFORM_API_TO_JOBS_TOKEN="$PLATFORM_API_TO_JOBS_TOKEN" \
      PLATFORM_API_TO_REALTIME_TOKEN="$PLATFORM_API_TO_REALTIME_TOKEN" \
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN="$PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN" \
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN="$PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN" \
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN="$JOBS_TO_PLATFORM_RANK_GRANT_TOKEN" \
      JOBS_TO_PLATFORM_AUTOMATION_TOKEN="$JOBS_TO_PLATFORM_AUTOMATION_TOKEN" \
      JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN="$JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN" \
      CORS_ORIGINS="$SEO_PLATFORM_PUBLIC_URL" \
      WEB_PUBLIC_URL="$SEO_PLATFORM_PUBLIC_URL" \
      AUTH_COOKIE_SECURE=true \
      AUTH_EMAIL_VERIFICATION_REQUIRED=false \
      AUTH_EXPOSE_DEVELOPMENT_TOKENS=false \
      AUTH_PASSWORD_PEPPER="$AUTH_PASSWORD_PEPPER" \
      AUTH_DATA_ENCRYPTION_KEY="$AUTH_DATA_ENCRYPTION_KEY" \
      YOOKASSA_ENABLED=false \
      BILLING_RECONCILIATION_ENABLED=false \
      "$node_bin" "$project_root/platform-api/dist/main.js"
    ;;
  system-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      REDIS_URL="redis://seo_jobs_system:${REDIS_JOBS_SYSTEM_PASSWORD}@127.0.0.1:6379" \
      SYSTEM_WORKER_CONCURRENCY=2 \
      "$node_bin" "$project_root/platform-jobs-integrations/dist/worker.main.js"
    ;;
  import-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
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
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/platform-jobs-integrations/dist/import-worker.main.js"
    ;;
  inspection-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
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
      "$node_bin" "$project_root/platform-jobs-integrations/dist/inspection-worker.main.js"
    ;;
  rank-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      DATABASE_URL="postgresql://jobs_rank_runtime:${JOBS_RANK_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=10 \
      REDIS_URL="redis://seo_jobs_rank:${REDIS_JOBS_RANK_PASSWORD}@127.0.0.1:6379" \
      PLATFORM_API_URL=http://127.0.0.1:4000 \
      JOBS_TO_PLATFORM_RANK_GRANT_TOKEN="$JOBS_TO_PLATFORM_RANK_GRANT_TOKEN" \
      SEO_DATA_URL=http://127.0.0.1:4001 \
      JOBS_TO_SEO_RANK_TOKEN="$JOBS_TO_SEO_RANK_TOKEN" \
      JOBS_TO_SEO_RANK_RESULT_TOKEN="$JOBS_TO_SEO_RANK_RESULT_TOKEN" \
      RANK_PREPARATION_ENABLED=true \
      RANK_PROVIDER_SUBMIT_ENABLED=false \
      INTEGRATION_CREDENTIAL_ROLE=DISABLED \
      S3_ENABLED=false \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/platform-jobs-integrations/dist/rank-worker.main.js"
    ;;
  crawl-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
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
      "$node_bin" "$project_root/platform-jobs-integrations/dist/crawl-worker.main.js"
    ;;
  connector-worker)
    exec env \
      -i \
      PATH="$node_path" \
      NODE_ENV=production \
      DATABASE_URL="postgresql://jobs_connector:${JOBS_CONNECTOR_DATABASE_PASSWORD}@${postgres_url}/jobs_db" \
      DATABASE_POOL_MAX=10 \
      REDIS_URL="redis://seo_jobs_connector:${REDIS_JOBS_CONNECTOR_PASSWORD}@127.0.0.1:6379" \
      INTEGRATION_CREDENTIAL_ROLE=EXECUTION \
      INTEGRATION_CREDENTIAL_KEYS="1:${INTEGRATION_CREDENTIAL_KEY}" \
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION=1 \
      RANK_PROVIDER_SUBMIT_ENABLED=true \
      RANK_PROVIDER_KILL_SWITCH_VERSION=arsenkin-positions@2 \
      S3_ENABLED=false \
      EMAIL_ENABLED=false \
      MALWARE_SCANNER_ENABLED=false \
      "$node_bin" "$project_root/platform-jobs-integrations/dist/connector-worker.main.js"
    ;;
  web)
    exec env \
      -i \
      PATH="$node_path" \
      HOME=/home/dev \
      NODE_ENV=production \
      NEXT_PUBLIC_SITE_URL="$SEO_PLATFORM_PUBLIC_URL" \
      PLATFORM_API_INTERNAL_URL=http://127.0.0.1:4000 \
      AUTH_ACCESS_COOKIE_NAME=seo_access \
      AUTH_SESSION_COOKIE_NAME=seo_session \
      AUTH_CSRF_COOKIE_NAME=seo_csrf \
      NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME=seo_csrf \
      NEXT_PUBLIC_TERMS_VERSION=2026-07-01 \
      NEXT_PUBLIC_PRIVACY_VERSION=2026-07-01 \
      NEXT_PUBLIC_MARKETING_VERSION=2026-07-01 \
      DEFAULT_LOCALE=ru \
      "$pnpm_bin" \
      --dir "$project_root" \
      --filter @seo-platform/web \
      exec next start -p 3000 -H 127.0.0.1
    ;;
  *)
    runtime_fail "unknown runtime component: $component"
    ;;
esac

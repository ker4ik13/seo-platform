#!/usr/bin/env bash
set -euo pipefail
umask 077
script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=runtime-lib.sh
. "$script_dir/runtime-lib.sh"
[ "${SEO_PLATFORM_POSTGRES_TEST_CONFIRM:-}" = CREATE_ISOLATED_CLUSTER ] || runtime_fail "set SEO_PLATFORM_POSTGRES_TEST_CONFIRM=CREATE_ISOLATED_CLUSTER"
assert_runtime_root
# No runtime.env is loaded: the tests receive only freshly generated secrets.
pg_bin=$(postgres_bin_dir)
export LD_LIBRARY_PATH=$(postgres_library_dir)
export PATH="$pg_bin:$PATH"
mkdir -p "$runtime_root/tmp"
chmod 700 "$runtime_root/tmp"
test_root=$(mktemp -d "$runtime_root/tmp/e2e.pgXXXXXXXX")
printf '%s\n' "$$" > "$test_root/owner.pid"
mkdir -p "$test_root/socket"
openssl rand -hex 24 > "$test_root/password"
export PGPASSWORD=$(cat "$test_root/password")
test_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
[[ "$test_port" =~ ^[0-9]+$ ]] && [ "$test_port" != 5432 ] || runtime_fail "invalid isolated PostgreSQL port"
cleanup_test_cluster() {
  if [ -f "$test_root/data/postmaster.pid" ]; then
    "$pg_bin/pg_ctl" -D "$test_root/data" -m immediate --wait stop > /dev/null 2>&1 || true
  fi
  rm -f -- "$test_root/password"
}
trap cleanup_test_cluster EXIT
printf 'postgres-tests artifacts=%s port=%s\n' "$test_root" "$test_port"
"$pg_bin/initdb" -D "$test_root/data" --username=postgres --pwfile="$test_root/password" --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --no-locale > "$test_root/init.log"
"$pg_bin/pg_ctl" -D "$test_root/data" -l "$test_root/server.log" -o "-h 127.0.0.1 -p $test_port -k $test_root/socket -c timezone=UTC -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all -c log_timezone=UTC -c log_min_error_statement=panic -c log_error_verbosity=terse -c log_parameter_max_length_on_error=0" --wait start > /dev/null
cd "$project_root"
SERVICE_DATABASE_ROLE_TEST_ADMIN_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:$test_port/postgres" SERVICE_DATABASE_ROLE_TEST_PSQL="$pg_bin/psql" node --test infrastructure/tests/service-database-role-isolation-postgres.test.mjs > "$test_root/postgres-isolation.log" 2>&1
export PGHOST=127.0.0.1 PGPORT="$test_port" PGUSER=postgres PGDATABASE=postgres
for key in PLATFORM_DATABASE_OWNER_PASSWORD PLATFORM_DATABASE_PASSWORD SEO_DATABASE_OWNER_PASSWORD SEO_DATABASE_PASSWORD JOBS_DATABASE_OWNER_PASSWORD JOBS_DATABASE_PASSWORD JOBS_RANK_DATABASE_PASSWORD JOBS_AUTH_EMAIL_DATABASE_PASSWORD REALTIME_DATABASE_OWNER_PASSWORD REALTIME_DATABASE_PASSWORD; do
  export "$key=$(openssl rand -hex 24)"
done
bash infrastructure/postgres/roles/provision-service-database-roles.sh > "${test_root}/race-migrations.log" 2>&1
for entry in 'platform:backend-core-api:PLATFORM' 'seo:backend-core-seo:SEO' 'jobs:backend-execution:JOBS' 'realtime:backend-core-realtime:REALTIME'; do
 IFS=: read -r db package prefix <<< "$entry"
 key="${prefix}_DATABASE_OWNER_PASSWORD"
 DATABASE_URL="postgresql://${db}_owner:${!key}@127.0.0.1:${test_port}/${db}_db" pnpm --filter "@seo-platform/$package" prisma:migrate:deploy >> "${test_root}/race-migrations.log" 2>&1
done
export JOBS_NOTIFICATION_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/jobs_db"
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = usability ]; then
  export SEO_DATA_URL_FILTER_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/rank-workbench/rank-workbench-url-filters.postgres.integration.test.ts > "$test_root/usability-seo.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (real imported snapshots, URL filters, sorting, pagination and tenant isolation)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = admin-operations ]; then
  export JOBS_ADMIN_OPERATIONS_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/jobs_db"
  pnpm --filter @seo-platform/backend-execution exec node --import tsx --test src/operation-activity/admin-import-operation.postgres.integration.test.ts > "$test_root/admin-operations.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (merged operations, pagination, import workers and safe metadata)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = note-formats ]; then
  export SEO_NOTE_FORMATS_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/notes/project-note-formats.postgres.integration.test.ts > "$test_root/note-formats-seo.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (file formats, preserved content and public token revocation)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = page-map ]; then
  export SEO_PAGE_INSIGHTS_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  export SEO_DATA_CRAWL_TEST_DATABASE_URL="$SEO_PAGE_INSIGHTS_TEST_DATABASE_URL"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/pages/page-insights.postgres.integration.test.ts src/crawls/crawl-snapshot-postgres.integration.test.ts > "$test_root/page-map-seo.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (page statistics, evidence, panels, URL paths and tenant isolation)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = onboarding ]; then
  export PLATFORM_ONBOARDING_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/platform_db"
  export SEO_ONBOARDING_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-api exec node --import tsx --test src/tenants/project-onboarding.postgres.integration.test.ts > "$test_root/onboarding-core.log" 2>&1
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/project-onboarding/project-onboarding.postgres.integration.test.ts > "$test_root/onboarding-seo.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (project creation replays, bounded bootstrap, tenant isolation, zero keyword/provider work)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = analytics ]; then
  export PLATFORM_ANALYTICS_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/platform_db"
  export JOBS_ANALYTICS_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
  pnpm --filter @seo-platform/backend-core-api exec node --import tsx --test src/analytics/product-analytics.postgres.integration.test.ts > "$test_root/analytics-core.log" 2>&1
  pnpm --filter @seo-platform/backend-execution exec node --import tsx --test src/operation-activity/operation-analytics.postgres.integration.test.ts > "$test_root/analytics-jobs.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (analytics overlap union, idempotency, tenant scope and canonical operation facts)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = remote-work ]; then
  export JOBS_REMOTE_WORK_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
  export JOBS_FREQUENCY_BATCH_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
  pnpm --filter @seo-platform/backend-execution exec node --import tsx --test src/worker-nodes/remote-work-postgres.integration.test.ts src/frequency-collections/xmlstock-frequency-batch.postgres.integration.test.ts > "$test_root/remote-work-postgres.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (Gateway leases, receipts, fairness and XMLStock frequency waves)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = rank-large ]; then
  export SEO_DATA_LARGE_RANK_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/rank-manifests/large-rank-postgres.integration.test.ts > "$test_root/large-rank-postgres.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (large rank manifest seal and chunk read)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = rank-claim ]; then
  export JOBS_RANK_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
  pnpm --filter @seo-platform/backend-execution exec node --import tsx --test --test-concurrency=1 \
    src/rank-runs/rank-connector-claim-postgres.integration.test.ts \
    src/rank-runs/rank-remote-capacity-postgres.integration.test.ts \
    src/rank-runs/rank-poll-batch-postgres.integration.test.ts > "$test_root/rank-claim-postgres.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (rank claim fencing, real batch SQL and node capacity)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = semantic-read ]; then
  export SEO_DATA_KEYWORD_SORT_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test \
    src/keywords/keyword-rank-comparison.postgres.integration.test.ts > "$test_root/semantic-read-postgres.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (set-based semantic rank comparison)'
  exit 0
fi
if [ "${SEO_PLATFORM_POSTGRES_TEST_SUITE:-full}" = semantic-sort ]; then
  export SEO_DATA_KEYWORD_SORT_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
  pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test \
    src/keywords/keyword-rank-dimension-sort-postgres.integration.test.ts \
    src/keywords/keyword-ai-position-sort-postgres.integration.test.ts \
    > "$test_root/semantic-sort-postgres.log" 2>&1
  printf '%s\n' 'postgres-tests result=passed (set-based semantic position sort and AI sort)'
  exit 0
fi
pnpm --filter @seo-platform/backend-execution exec node --import tsx --test src/job-notifications/job-notification-postgres.integration.test.ts > "${test_root}/notification-postgres.log" 2>&1
export PLATFORM_API_SESSION_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/platform_db"
export PLATFORM_API_RANK_GRANT_TEST_DATABASE_URL="$PLATFORM_API_SESSION_TEST_DATABASE_URL"
export PLATFORM_API_ADMIN_TEST_DATABASE_URL="$PLATFORM_API_SESSION_TEST_DATABASE_URL"
export PLATFORM_API_BILLING_TEST_DATABASE_URL="$PLATFORM_API_SESSION_TEST_DATABASE_URL"
export PLATFORM_API_TELEGRAM_TEST_DATABASE_URL="$PLATFORM_API_SESSION_TEST_DATABASE_URL"
export PLATFORM_API_NPD_TEST_DATABASE_URL="$PLATFORM_API_SESSION_TEST_DATABASE_URL"
pnpm --filter @seo-platform/backend-core-api exec node --import tsx --test src/npd/npd-processing-postgres.integration.test.ts > "${test_root}/npd-postgres.log" 2>&1
pnpm --filter @seo-platform/backend-core-api exec node --import tsx --test --test-concurrency=1 src/identity/session-lifecycle-integration.test.ts src/identity/telegram-login-postgres.integration.test.ts src/rankings/rank-execution-grant-postgres.integration.test.ts src/admin/platform-admin-postgres.integration.test.ts src/admin/platform-admin-workspace-postgres.integration.test.ts src/billing/billing-payments-postgres.integration.test.ts src/billing/operation-billing-postgres.integration.test.ts src/billing/refund-request-postgres.integration.test.ts src/billing/provider-balance-postgres.integration.test.ts > "${test_root}/core-postgres-races.log" 2>&1
export JOBS_RANK_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
export JOBS_CRAWL_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
export JOBS_CREDENTIAL_BROKER_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
export JOBS_PAID_OPERATION_TEST_DATABASE_URL="$JOBS_NOTIFICATION_TEST_DATABASE_URL"
pnpm --filter @seo-platform/backend-execution exec node --import tsx --test --test-concurrency=1 'src/rank-runs/*integration.test.ts' src/integrations/integration-credential-broker-postgres.integration.test.ts src/integrations/platform-account-probe-postgres.integration.test.ts src/crawls/crawl-host-state-postgres.integration.test.ts src/paid-operations/paid-operation-postgres.integration.test.ts src/operation-activity/failed-operation-dismissal-postgres.integration.test.ts > "${test_root}/execution-postgres-races.log" 2>&1
export SEO_DATA_CRAWL_TEST_DATABASE_URL="postgresql://postgres:$PGPASSWORD@127.0.0.1:${test_port}/seo_db"
export SEO_DATA_KEYWORD_SORT_TEST_DATABASE_URL="$SEO_DATA_CRAWL_TEST_DATABASE_URL"
export SEO_DATA_LARGE_RANK_TEST_DATABASE_URL="$SEO_DATA_CRAWL_TEST_DATABASE_URL"
export SEO_DATA_MANUAL_HISTORY_TEST_DATABASE_URL="$SEO_DATA_CRAWL_TEST_DATABASE_URL"
export SEO_NOTE_FORMATS_TEST_DATABASE_URL="$SEO_DATA_CRAWL_TEST_DATABASE_URL"
export SEO_PAGE_INSIGHTS_TEST_DATABASE_URL="$SEO_DATA_CRAWL_TEST_DATABASE_URL"
pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test src/rank-manifests/large-rank-postgres.integration.test.ts > "${test_root}/large-rank-postgres.log" 2>&1
pnpm --filter @seo-platform/backend-core-seo exec node --import tsx --test --test-concurrency=1 src/crawls/crawl-snapshot-postgres.integration.test.ts src/keywords/keyword-ai-position-sort-postgres.integration.test.ts src/keywords/keyword-rank-dimension-sort-postgres.integration.test.ts src/keywords/keyword-rank-comparison.postgres.integration.test.ts src/semantic-imports/manual-position-history-postgres.integration.test.ts src/notes/project-note-formats.postgres.integration.test.ts src/pages/page-insights.postgres.integration.test.ts > "${test_root}/seo-postgres-races.log" 2>&1

printf '%s\n' 'postgres-tests result=passed (isolation, notifications, core, execution, SEO); historical pre-upgrade fixture is separate'

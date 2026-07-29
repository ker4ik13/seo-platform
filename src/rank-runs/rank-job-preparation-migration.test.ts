import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PREPARING_STATUS_MIGRATION = new URL(
  "../../prisma/migrations/20260729170000_rank_job_preparing_status/migration.sql",
  import.meta.url
);
const RANK_JOB_PREPARATION_MIGRATION = new URL(
  "../../prisma/migrations/20260729170100_rank_job_preparation/migration.sql",
  import.meta.url
);

const migrations = Promise.all([
  readFile(PREPARING_STATUS_MIGRATION, "utf8"),
  readFile(RANK_JOB_PREPARATION_MIGRATION, "utf8")
]);

function compactSql(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function sqlSection(sql: string, start: string, end: string): string {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex + start.length);

  assert.ok(startIndex >= 0, `Missing SQL section start: ${start}`);
  assert.ok(endIndex > startIndex, `Missing SQL section end: ${end}`);

  return sql.slice(startIndex, endIndex);
}

test("adds rank lifecycle statuses before the preparation transaction", async () => {
  const [statusMigration, preparationMigration] = await migrations;

  assert.equal(
    compactSql(statusMigration),
    `ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PREPARING' BEFORE 'QUEUED'; ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'ACTION_REQUIRED' BEFORE 'EXPIRED';`
  );
  assert.match(preparationMigration, /^BEGIN;\s/u);
  assert.match(preparationMigration, /\sCOMMIT;\s*$/u);
});

test("uses tenant-safe composite foreign keys for rank job runs", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);

  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "jobs_tenant_project_id_key" ON "jobs" ("workspace_id", "project_id", "id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_estimates_tenant_project_id_key" ON "rank_estimates" ("workspace_id", "project_id", "id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "rank_job_runs_job_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "job_id") REFERENCES "jobs" ("workspace_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT`
    )
  );
  assert.ok(
    normalized.includes(
      `CONSTRAINT "rank_job_runs_estimate_tenant_fkey" FOREIGN KEY ("workspace_id", "project_id", "estimate_id") REFERENCES "rank_estimates" ("workspace_id", "project_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT`
    )
  );
});

test("fails closed before unsupported legacy rows or active dedup conflicts", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);

  assert.ok(
    normalized.includes(
      `IF EXISTS ( SELECT 1 FROM "jobs" WHERE "type" = 'MANUAL_RANK_CHECK' ) THEN RAISE EXCEPTION 'Backfill legacy MANUAL_RANK_CHECK rows before rank preparation migration'`
    )
  );
  assert.ok(
    normalized.includes(
      `GROUP BY "workspace_id", "deduplication_key" HAVING count(*) > 1`
    )
  );
  assert.match(
    migration,
    /Resolve active Job deduplication conflicts before migration/u
  );
});

test("rejects half-null execution and receipt evidence", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);

  assert.ok(
    normalized.includes(
      `"execution_snapshot" IS NOT NULL AND "execution_snapshot_hash" IS NOT NULL AND jsonb_typeof("execution_snapshot") = 'object' AND octet_length("execution_snapshot_hash") = 32`
    )
  );
  assert.match(
    normalized,
    /"seal_state" IN \('SEALED', 'FINALIZED'\) AND "manifest_id" IS NOT NULL AND "manifest_hash_schema" IS NOT NULL AND "manifest_hash_schema" = 'rank-manifest@1' AND "manifest_hash" IS NOT NULL AND octet_length\("manifest_hash"\) = 32 AND "manifest_deduplication_hash" IS NOT NULL AND octet_length\("manifest_deduplication_hash"\) = 32 AND "manifest_pair_count" IS NOT NULL/u
  );
  assert.match(
    normalized,
    /"seal_state" = 'FINALIZED' AND "finalization_status" IS NOT NULL AND "finalization_request_hash" IS NOT NULL AND octet_length\("finalization_request_hash"\) = 32 AND "finalized_at" IS NOT NULL/u
  );
});

test("keeps PREPARING and CANCEL_REQUESTED inside active job deduplication", async () => {
  const [, migration] = await migrations;
  const activeDeduplicationIndex = compactSql(
    sqlSection(
      migration,
      `CREATE UNIQUE INDEX "jobs_active_deduplication_key"`,
      `CREATE FUNCTION "assert_manual_rank_job_shape"()`
    )
  );

  assert.ok(
    activeDeduplicationIndex.includes(
      `WHERE "deduplication_key" IS NOT NULL AND "status" IN ( 'PREPARING', 'QUEUED', 'WAITING_RATE_LIMIT', 'RUNNING', 'CANCEL_REQUESTED', 'RETRY_SCHEDULED' );`
    )
  );
  assert.doesNotMatch(
    activeDeduplicationIndex,
    /'(?:CANCELLED|PARTIALLY_COMPLETED|COMPLETED|FAILED_FINAL|ACTION_REQUIRED|EXPIRED)'/u
  );
});

test("makes the persisted manifest command and rank run identity immutable", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);
  const protectionFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "protect_rank_job_run"()`,
      `CREATE TRIGGER "rank_job_run_protection"`
    )
  );
  const identityFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "protect_manual_rank_job_identity"()`,
      `CREATE TRIGGER "manual_rank_job_identity_immutable"`
    )
  );

  assert.ok(
    protectionFunction.includes(
      `NEW."manifest_command" IS DISTINCT FROM OLD."manifest_command" OR NEW."manifest_command_hash" IS DISTINCT FROM OLD."manifest_command_hash"`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Rank job runs are immutable history'`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `OLD."cancel_requested_by" IS NULL AND NEW."cancel_requested_by" IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM "jobs" j`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `j."status" IN ('CANCEL_REQUESTED', 'CANCELLED')`
    )
  );
  assert.match(
    migration,
    /CREATE TRIGGER "rank_job_run_protection"\s+BEFORE INSERT OR UPDATE OR DELETE ON "rank_job_runs"/u
  );
  assert.match(
    migration,
    /CREATE TRIGGER "rank_job_run_no_truncate"\s+BEFORE TRUNCATE ON "rank_job_runs"/u
  );
  assert.ok(
    identityFunction.includes(
      `NEW."request_hash" IS DISTINCT FROM OLD."request_hash" OR NEW."input_snapshot" IS DISTINCT FROM OLD."input_snapshot"`
    )
  );
  assert.ok(
    identityFunction.includes(
      `NEW."schedule_id" IS DISTINCT FROM OLD."schedule_id" OR NEW."parent_job_id" IS DISTINCT FROM OLD."parent_job_id"`
    )
  );
  assert.ok(
    identityFunction.includes(
      `NEW."scope_snapshot" IS DISTINCT FROM OLD."scope_snapshot" OR NEW."progress_total" IS DISTINCT FROM OLD."progress_total" OR NEW."progress_unit" IS DISTINCT FROM OLD."progress_unit"`
    )
  );
  assert.ok(
    identityFunction.includes(
      `NEW."estimated_cost_micro" IS DISTINCT FROM OLD."estimated_cost_micro" OR NEW."currency" IS DISTINCT FROM OLD."currency"`
    )
  );
  assert.ok(
    identityFunction.includes(
      `NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"`
    )
  );
  assert.ok(
    identityFunction.includes(
      `NEW."version" <> OLD."version" + 1 OR NEW."attempt" NOT IN ( OLD."attempt", OLD."attempt" + 1 )`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE TRIGGER "rank_estimate_immutable" BEFORE UPDATE ON "rank_estimates" FOR EACH ROW EXECUTE FUNCTION "reject_rank_estimate_update"();`
    )
  );
});

test("requires exact initial states and bounded attempt evidence", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);
  const protectionFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "protect_rank_job_run"()`,
      `CREATE TRIGGER "rank_job_run_protection"`
    )
  );

  assert.ok(
    normalized.includes(
      `IF TG_OP = 'INSERT' AND ( NEW."status" <> 'PREPARING' OR NEW."version" <> 1 OR NEW."attempt" <> 0 OR NEW."progress_current" <> 0 OR NEW."reserved_cost_micro" IS NOT NULL OR NEW."actual_cost_micro" IS NOT NULL OR NEW."error_summary" IS NOT NULL OR NEW."result_summary" IS NOT NULL OR NEW."cancel_requested_at" IS NOT NULL OR NEW."lease_owner" IS NOT NULL OR NEW."lease_expires_at" IS NOT NULL OR NEW."retry_at" IS NOT NULL ) THEN`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `IF TG_OP = 'INSERT' AND ( NEW."seal_state" <> 'PENDING' OR NEW."seal_attempt_count" <> 0`
    )
  );
  assert.ok(
    normalized.includes(
      `"seal_attempt_count" BETWEEN 0 AND 1000 AND (`
    )
  );
  assert.ok(
    normalized.includes(
      `OR NEW."attempt" NOT BETWEEN 0 AND NEW."max_attempts"`
    )
  );
});

test("enforces the explicit manual rank job transition matrix", async () => {
  const [, migration] = await migrations;
  const identityFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "protect_manual_rank_job_identity"()`,
      `CREATE TRIGGER "manual_rank_job_identity_immutable"`
    )
  );

  assert.ok(
    identityFunction.includes(
      `OLD."status" = 'PREPARING' AND NEW."status" IN ( 'QUEUED', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED_FINAL', 'ACTION_REQUIRED', 'EXPIRED' )`
    )
  );
  assert.ok(
    identityFunction.includes(
      `OLD."status" = 'QUEUED' AND NEW."status" IN ( 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'FAILED_FINAL', 'ACTION_REQUIRED' )`
    )
  );
  assert.ok(
    identityFunction.includes(
      `OLD."status" = 'RUNNING' AND NEW."status" IN ( 'CANCEL_REQUESTED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED_FINAL', 'ACTION_REQUIRED' )`
    )
  );
  assert.ok(
    identityFunction.includes(
      `OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" IN ( 'CANCELLED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED_FINAL', 'ACTION_REQUIRED' )`
    )
  );
  assert.doesNotMatch(
    identityFunction,
    /OLD\."status" = '(?:CANCELLED|PARTIALLY_COMPLETED|COMPLETED|FAILED_FINAL|ACTION_REQUIRED|EXPIRED)'\s+AND NEW\."status" IN/u
  );
});

test("freezes manifest receipts and keeps seal attempts monotonic", async () => {
  const [, migration] = await migrations;
  const protectionFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "protect_rank_job_run"()`,
      `CREATE TRIGGER "rank_job_run_protection"`
    )
  );

  assert.ok(
    protectionFunction.includes(
      `OLD."seal_state" IN ('SEALED', 'FINALIZED') AND ( NEW."manifest_id" IS DISTINCT FROM OLD."manifest_id"`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `OLD."seal_state" = 'FINALIZED' AND ( NEW."finalization_status" IS DISTINCT FROM OLD."finalization_status"`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `OLD."seal_state" IN ('NOT_SEALED', 'SEALED', 'FINALIZED') AND ( NEW."seal_attempt_count" IS DISTINCT FROM OLD."seal_attempt_count"`
    )
  );
  assert.ok(
    protectionFunction.includes(
      `NEW."seal_attempt_count" = OLD."seal_attempt_count" + 1 AND NEW."last_seal_attempt_at" >= OLD."last_seal_attempt_at"`
    )
  );
});

test("enforces a deferred one-to-one manual rank job boundary", async () => {
  const [, migration] = await migrations;
  const normalized = compactSql(migration);

  assert.ok(
    normalized.includes(
      `CREATE UNIQUE INDEX "rank_job_runs_tenant_job_key" ON "rank_job_runs" ("workspace_id", "project_id", "job_id");`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE CONSTRAINT TRIGGER "manual_rank_job_has_run" AFTER INSERT OR UPDATE ON "jobs" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_manual_rank_job_has_run"();`
    )
  );
  assert.ok(
    normalized.includes(
      `CREATE CONSTRAINT TRIGGER "rank_run_has_manual_job" AFTER INSERT OR UPDATE ON "rank_job_runs" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_rank_run_has_manual_job"();`
    )
  );
  assert.match(
    migration,
    /NEW\."type" = 'MANUAL_RANK_CHECK'[\s\S]*FROM "rank_job_runs" r[\s\S]*r\."workspace_id" = NEW\."workspace_id"[\s\S]*r\."project_id" = NEW\."project_id"/u
  );
  assert.match(
    migration,
    /FROM "jobs" j[\s\S]*j\."workspace_id" = NEW\."workspace_id"[\s\S]*j\."project_id" = NEW\."project_id"[\s\S]*j\."type" = 'MANUAL_RANK_CHECK'/u
  );
  assert.ok(
    normalized.includes(
      `AND j."attempt" BETWEEN 0 AND j."max_attempts" AND ( ( r."seal_state" IN ( 'PENDING', 'OUTCOME_UNKNOWN', 'NOT_SEALED' ) AND r."seal_attempt_count" = j."attempt" ) OR ( r."seal_state" IN ('SEALED', 'FINALIZED') AND r."seal_attempt_count" <= j."attempt" ) )`
    )
  );
  assert.ok(
    normalized.includes(
      `AND e."actor_id" = j."actor_id" AND e."tracking_context_id" = r."tracking_context_id" AND e."project_version" = r."project_version" AND e."keyword_count"::bigint = j."progress_total" AND e."execution_snapshot" IS NOT NULL AND e."execution_snapshot_hash" IS NOT NULL`
    )
  );
  assert.ok(
    normalized.includes(
      `r."seal_state" NOT IN ('SEALED', 'FINALIZED') OR r."manifest_pair_count"::bigint = j."progress_total"`
    )
  );
});

test("enforces coherent committed Job and rank sidecar states", async () => {
  const [, migration] = await migrations;
  const coherenceFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "manual_rank_job_state_is_coherent"(`,
      `CREATE FUNCTION "assert_manual_rank_job_has_run"()`
    )
  );

  assert.ok(
    coherenceFunction.includes(
      `WHEN job_status = 'PREPARING' THEN seal_state IN ('PENDING', 'OUTCOME_UNKNOWN') AND finalization_status IS NULL`
    )
  );
  assert.ok(
    coherenceFunction.includes(
      `WHEN job_status IN ('QUEUED', 'RUNNING') THEN seal_state = 'SEALED' AND finalization_status IS NULL`
    )
  );
  assert.ok(
    coherenceFunction.includes(
      `WHEN job_status = 'CANCELLED' THEN ( seal_state = 'NOT_SEALED' AND finalization_status IS NULL ) OR ( seal_state = 'FINALIZED' AND finalization_status = 'CANCELLED' )`
    )
  );
  assert.ok(
    coherenceFunction.includes(
      `WHEN job_status = 'ACTION_REQUIRED' THEN ( seal_state IN ('OUTCOME_UNKNOWN', 'SEALED') AND finalization_status IS NULL ) OR ( seal_state = 'FINALIZED' AND finalization_status = 'ACTION_REQUIRED' )`
    )
  );
});

test("rejects unsafe manual rank job lifecycle shapes on insert and update", async () => {
  const [, migration] = await migrations;
  const shapeFunction = compactSql(
    sqlSection(
      migration,
      `CREATE FUNCTION "assert_manual_rank_job_shape"()`,
      `CREATE TRIGGER "manual_rank_job_shape"`
    )
  );

  assert.match(
    migration,
    /CREATE TRIGGER "manual_rank_job_shape"\s+BEFORE INSERT OR UPDATE ON "jobs"/u
  );
  assert.ok(
    shapeFunction.includes(
      `NEW."provider" IS DISTINCT FROM 'ARSENKIN'`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `NEW."progress_unit" IS DISTINCT FROM 'KEYWORD' OR NEW."estimated_cost_micro" IS DISTINCT FROM 0`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `IF NEW."status" = 'PREPARING' AND ( NEW."stage" IS DISTINCT FROM 'PREPARING_SCOPE' OR NEW."queued_at" IS NOT NULL OR NEW."started_at" IS NOT NULL OR NEW."finished_at" IS NOT NULL )`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `IF NEW."status" = 'QUEUED' AND ( NEW."stage" IS DISTINCT FROM 'WAITING_FOR_QUEUE' OR NEW."queued_at" IS NULL OR NEW."started_at" IS NOT NULL OR NEW."finished_at" IS NOT NULL )`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `NEW."result_summary" IS DISTINCT FROM jsonb_build_object( 'pairCount', NEW."progress_total"::text, 'persistedCount', '0', 'foundCount', '0', 'notFoundCount', '0', 'failedCount', '0', 'submitOutcomeUnknownCount', NEW."progress_total"::text )`
    )
  );
  assert.match(
    migration,
    /Terminal MANUAL_RANK_CHECK outcome is immutable/u
  );
  assert.ok(
    shapeFunction.includes(
      `IF NEW."status" = 'CANCEL_REQUESTED' AND ( NEW."cancel_requested_at" IS NULL OR NEW."finished_at" IS NOT NULL )`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `IF NEW."status" IN ( 'CANCELLED', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED_FINAL', 'EXPIRED' ) AND ( NEW."stage" IS DISTINCT FROM 'FINISHED' OR NEW."finished_at" IS NULL OR NEW."lease_owner" IS NOT NULL OR NEW."lease_expires_at" IS NOT NULL OR NEW."retry_at" IS NOT NULL )`
    )
  );
  assert.ok(
    shapeFunction.includes(
      `IF NEW."status" = 'ACTION_REQUIRED' AND ( NEW."stage" IS DISTINCT FROM 'SUBMIT_OUTCOME_UNKNOWN' OR NEW."finished_at" IS NULL OR NEW."lease_owner" IS NOT NULL OR NEW."lease_expires_at" IS NOT NULL OR NEW."retry_at" IS NOT NULL OR NEW."progress_current" <> 0`
    )
  );
});

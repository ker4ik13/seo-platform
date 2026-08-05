BEGIN;

CREATE TYPE "RankManifestSealState" AS ENUM (
  'PENDING',
  'OUTCOME_UNKNOWN',
  'NOT_SEALED',
  'SEALED',
  'FINALIZED'
);

CREATE TYPE "RankCheckFinalStatus" AS ENUM (
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'CANCELLED',
  'FAILED',
  'ACTION_REQUIRED'
);

ALTER TABLE "rank_estimates"
  ADD COLUMN "execution_snapshot" JSONB,
  ADD COLUMN "execution_snapshot_hash" BYTEA;

ALTER TABLE "rank_estimates"
  DROP CONSTRAINT "rank_estimates_blockers_array",
  ADD CONSTRAINT "rank_estimates_blockers_array"
    CHECK (
      jsonb_typeof("blockers") = 'array'
      AND jsonb_array_length("blockers") BETWEEN 0 AND 64
    ),
  ADD CONSTRAINT "rank_estimates_execution_snapshot_pair"
    CHECK (
      (
        "execution_snapshot" IS NULL
        AND "execution_snapshot_hash" IS NULL
      )
      OR
      (
        "execution_snapshot" IS NOT NULL
        AND "execution_snapshot_hash" IS NOT NULL
        AND jsonb_typeof("execution_snapshot") = 'object'
        AND octet_length("execution_snapshot_hash") = 32
      )
    );

CREATE FUNCTION "reject_rank_estimate_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rank estimates are immutable receipts'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_estimate_immutable"
  BEFORE UPDATE ON "rank_estimates"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_rank_estimate_update"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "jobs"
    WHERE "type" = 'MANUAL_RANK_CHECK'
  ) THEN
    RAISE EXCEPTION
      'Backfill legacy MANUAL_RANK_CHECK rows before rank preparation migration'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "jobs"
    WHERE "deduplication_key" IS NOT NULL
      AND "status" IN (
        'PREPARING',
        'QUEUED',
        'WAITING_RATE_LIMIT',
        'RUNNING',
        'CANCEL_REQUESTED',
        'RETRY_SCHEDULED'
      )
    GROUP BY "workspace_id", "deduplication_key"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Resolve active Job deduplication conflicts before migration'
      USING ERRCODE = '23505';
  END IF;
END
$$;

CREATE UNIQUE INDEX "jobs_tenant_project_id_key"
  ON "jobs" ("workspace_id", "project_id", "id");

CREATE UNIQUE INDEX "rank_estimates_tenant_project_id_key"
  ON "rank_estimates" ("workspace_id", "project_id", "id");

CREATE TABLE "rank_job_runs" (
  "job_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "estimate_id" UUID NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "project_domain" TEXT NOT NULL,
  "project_status" VARCHAR(16) NOT NULL,
  "project_version" INTEGER NOT NULL,
  "manifest_command" JSONB NOT NULL,
  "manifest_command_hash" BYTEA NOT NULL,
  "seal_state" "RankManifestSealState" NOT NULL DEFAULT 'PENDING',
  "seal_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_seal_attempt_at" TIMESTAMPTZ(6),
  "manifest_id" UUID,
  "manifest_hash_schema" VARCHAR(64),
  "manifest_hash" BYTEA,
  "manifest_deduplication_hash" BYTEA,
  "manifest_pair_count" INTEGER,
  "manifest_chunk_count" INTEGER,
  "manifest_chunk_size" INTEGER,
  "manifest_sealed_at" TIMESTAMPTZ(6),
  "finalization_status" "RankCheckFinalStatus",
  "finalization_request_hash" BYTEA,
  "finalized_at" TIMESTAMPTZ(6),
  "cancel_requested_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "rank_job_runs_pkey" PRIMARY KEY ("job_id"),
  CONSTRAINT "rank_job_runs_project_snapshot"
    CHECK (
      "project_status" = 'ACTIVE'
      AND "project_version" > 0
      AND length("project_domain") BETWEEN 1 AND 2048
      AND "project_domain" = btrim("project_domain")
    ),
  CONSTRAINT "rank_job_runs_manifest_command"
    CHECK (
      jsonb_typeof("manifest_command") = 'object'
      AND octet_length("manifest_command_hash") = 32
    ),
  CONSTRAINT "rank_job_runs_seal_attempt"
    CHECK (
      "seal_attempt_count" BETWEEN 0 AND 1000
      AND (
        (
          "seal_state" = 'PENDING'
          AND "seal_attempt_count" = 0
          AND "last_seal_attempt_at" IS NULL
        )
        OR
        (
          "seal_state" = 'NOT_SEALED'
          AND "seal_attempt_count" = 0
          AND "last_seal_attempt_at" IS NULL
        )
        OR
        (
          "seal_state" <> 'PENDING'
          AND "seal_state" <> 'NOT_SEALED'
          AND "seal_attempt_count" > 0
          AND "last_seal_attempt_at" IS NOT NULL
        )
        OR
        (
          "seal_state" = 'NOT_SEALED'
          AND "seal_attempt_count" > 0
          AND "last_seal_attempt_at" IS NOT NULL
        )
      )
    ),
  CONSTRAINT "rank_job_runs_manifest_receipt"
    CHECK (
      (
        "seal_state" IN ('PENDING', 'OUTCOME_UNKNOWN', 'NOT_SEALED')
        AND "manifest_id" IS NULL
        AND "manifest_hash_schema" IS NULL
        AND "manifest_hash" IS NULL
        AND "manifest_deduplication_hash" IS NULL
        AND "manifest_pair_count" IS NULL
        AND "manifest_chunk_count" IS NULL
        AND "manifest_chunk_size" IS NULL
        AND "manifest_sealed_at" IS NULL
      )
      OR
      (
        "seal_state" IN ('SEALED', 'FINALIZED')
        AND "manifest_id" IS NOT NULL
        AND "manifest_hash_schema" IS NOT NULL
        AND "manifest_hash_schema" = 'rank-manifest@1'
        AND "manifest_hash" IS NOT NULL
        AND octet_length("manifest_hash") = 32
        AND "manifest_deduplication_hash" IS NOT NULL
        AND octet_length("manifest_deduplication_hash") = 32
        AND "manifest_pair_count" IS NOT NULL
        AND "manifest_pair_count" BETWEEN 1 AND 1000
        AND "manifest_chunk_count" IS NOT NULL
        AND "manifest_chunk_count" =
          (("manifest_pair_count" + 249) / 250)
        AND "manifest_chunk_size" IS NOT NULL
        AND "manifest_chunk_size" = 250
        AND "manifest_sealed_at" IS NOT NULL
      )
    ),
  CONSTRAINT "rank_job_runs_finalization_receipt"
    CHECK (
      (
        "seal_state" <> 'FINALIZED'
        AND "finalization_status" IS NULL
        AND "finalization_request_hash" IS NULL
        AND "finalized_at" IS NULL
      )
      OR
      (
        "seal_state" = 'FINALIZED'
        AND "finalization_status" IS NOT NULL
        AND "finalization_request_hash" IS NOT NULL
        AND octet_length("finalization_request_hash") = 32
        AND "finalized_at" IS NOT NULL
        AND "finalized_at" >= "manifest_sealed_at"
      )
    )
);

CREATE UNIQUE INDEX "rank_job_runs_tenant_estimate_key"
  ON "rank_job_runs" ("workspace_id", "project_id", "estimate_id");

CREATE UNIQUE INDEX "rank_job_runs_tenant_job_key"
  ON "rank_job_runs" ("workspace_id", "project_id", "job_id");

CREATE UNIQUE INDEX "rank_job_runs_manifest_id_key"
  ON "rank_job_runs" ("manifest_id");

CREATE INDEX "rank_job_runs_seal_recovery_idx"
  ON "rank_job_runs" (
    "seal_state",
    "last_seal_attempt_at",
    "created_at"
  );

ALTER TABLE "rank_job_runs"
  ADD CONSTRAINT "rank_job_runs_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_job_runs_estimate_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "estimate_id")
    REFERENCES "rank_estimates" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

DROP INDEX "jobs_active_deduplication_key";

CREATE UNIQUE INDEX "jobs_active_deduplication_key"
  ON "jobs" ("workspace_id", "deduplication_key")
  WHERE "deduplication_key" IS NOT NULL
    AND "status" IN (
      'PREPARING',
      'QUEUED',
      'WAITING_RATE_LIMIT',
      'RUNNING',
      'CANCEL_REQUESTED',
      'RETRY_SCHEDULED'
    );

CREATE FUNCTION "assert_manual_rank_job_shape"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."type" <> 'MANUAL_RANK_CHECK' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW."status" <> 'PREPARING'
    OR NEW."version" <> 1
    OR NEW."attempt" <> 0
    OR NEW."progress_current" <> 0
    OR NEW."reserved_cost_micro" IS NOT NULL
    OR NEW."actual_cost_micro" IS NOT NULL
    OR NEW."error_summary" IS NOT NULL
    OR NEW."result_summary" IS NOT NULL
    OR NEW."cancel_requested_at" IS NOT NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK must start in PREPARING version 1 attempt 0'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."project_id" IS NULL
    OR NEW."actor_id" IS NULL
    OR NEW."idempotency_key" IS NULL
    OR NEW."request_hash" IS NULL
    OR octet_length(NEW."request_hash") <> 32
    OR NEW."deduplication_key" IS NULL
    OR NEW."credential_mode" <> 'BYOK_API_KEY'
    OR NEW."provider" IS DISTINCT FROM 'ARSENKIN'
    OR NEW."progress_total" IS NULL
    OR NEW."progress_total" NOT BETWEEN 1 AND 1000
    OR NEW."progress_current" < 0
    OR NEW."progress_current" > NEW."progress_total"
    OR NEW."progress_unit" IS DISTINCT FROM 'KEYWORD'
    OR NEW."estimated_cost_micro" IS DISTINCT FROM 0
    OR NEW."currency" IS NULL
    OR NEW."max_attempts" NOT BETWEEN 1 AND 1000
    OR NEW."attempt" NOT BETWEEN 0 AND NEW."max_attempts"
  THEN
    RAISE EXCEPTION 'Invalid MANUAL_RANK_CHECK job shape'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" NOT IN (
    'PREPARING',
    'QUEUED',
    'RUNNING',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'ACTION_REQUIRED',
    'EXPIRED'
  ) THEN
    RAISE EXCEPTION 'Unsupported MANUAL_RANK_CHECK job status'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'PREPARING' AND (
    NEW."stage" IS DISTINCT FROM 'PREPARING_SCOPE'
    OR NEW."queued_at" IS NOT NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid PREPARING rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'QUEUED' AND (
    NEW."stage" IS DISTINCT FROM 'WAITING_FOR_QUEUE'
    OR NEW."queued_at" IS NULL
    OR NEW."started_at" IS NOT NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid QUEUED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'CANCEL_REQUESTED' AND (
    NEW."cancel_requested_at" IS NULL
    OR NEW."finished_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid CANCEL_REQUESTED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN (
    'CANCELLED',
    'PARTIALLY_COMPLETED',
    'COMPLETED',
    'FAILED_FINAL',
    'EXPIRED'
  ) AND (
    NEW."stage" IS DISTINCT FROM 'FINISHED'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Invalid terminal rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'ACTION_REQUIRED' AND (
    NEW."stage" IS DISTINCT FROM 'SUBMIT_OUTCOME_UNKNOWN'
    OR NEW."finished_at" IS NULL
    OR NEW."lease_owner" IS NOT NULL
    OR NEW."lease_expires_at" IS NOT NULL
    OR NEW."retry_at" IS NOT NULL
    OR NEW."progress_current" <> 0
    OR NEW."error_summary"
      IS DISTINCT FROM '{"code":"SUBMIT_OUTCOME_UNKNOWN"}'::jsonb
    OR NEW."result_summary" IS DISTINCT FROM jsonb_build_object(
      'pairCount', NEW."progress_total"::text,
      'persistedCount', '0',
      'foundCount', '0',
      'notFoundCount', '0',
      'failedCount', '0',
      'submitOutcomeUnknownCount', NEW."progress_total"::text
    )
  ) THEN
    RAISE EXCEPTION 'Invalid ACTION_REQUIRED rank job lifecycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "manual_rank_job_shape"
  BEFORE INSERT OR UPDATE ON "jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_manual_rank_job_shape"();

CREATE FUNCTION "protect_manual_rank_job_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."type" <> 'MANUAL_RANK_CHECK'
    AND NEW."type" = 'MANUAL_RANK_CHECK'
  THEN
    RAISE EXCEPTION 'MANUAL_RANK_CHECK type cannot be assigned after insert'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."type" = 'MANUAL_RANK_CHECK' AND (
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."schedule_id" IS DISTINCT FROM OLD."schedule_id"
    OR NEW."parent_job_id" IS DISTINCT FROM OLD."parent_job_id"
    OR NEW."deduplication_key" IS DISTINCT FROM OLD."deduplication_key"
    OR NEW."idempotency_scope" IS DISTINCT FROM OLD."idempotency_scope"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."request_hash" IS DISTINCT FROM OLD."request_hash"
    OR NEW."input_snapshot" IS DISTINCT FROM OLD."input_snapshot"
    OR NEW."scope_snapshot" IS DISTINCT FROM OLD."scope_snapshot"
    OR NEW."progress_total" IS DISTINCT FROM OLD."progress_total"
    OR NEW."progress_unit" IS DISTINCT FROM OLD."progress_unit"
    OR NEW."estimated_cost_micro"
      IS DISTINCT FROM OLD."estimated_cost_micro"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."credential_mode" IS DISTINCT FROM OLD."credential_mode"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
    OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'MANUAL_RANK_CHECK identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."type" = 'MANUAL_RANK_CHECK' AND (
    NEW."version" <> OLD."version" + 1
    OR NEW."attempt" NOT IN (
      OLD."attempt",
      OLD."attempt" + 1
    )
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK version and attempt must advance monotonically'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."type" = 'MANUAL_RANK_CHECK'
    AND NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (
      (
        OLD."status" = 'PREPARING'
        AND NEW."status" IN (
          'QUEUED',
          'CANCEL_REQUESTED',
          'CANCELLED',
          'FAILED_FINAL',
          'ACTION_REQUIRED',
          'EXPIRED'
        )
      )
      OR (
        OLD."status" = 'QUEUED'
        AND NEW."status" IN (
          'RUNNING',
          'CANCEL_REQUESTED',
          'CANCELLED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
      OR (
        OLD."status" = 'RUNNING'
        AND NEW."status" IN (
          'CANCEL_REQUESTED',
          'PARTIALLY_COMPLETED',
          'COMPLETED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
      OR (
        OLD."status" = 'CANCEL_REQUESTED'
        AND NEW."status" IN (
          'CANCELLED',
          'PARTIALLY_COMPLETED',
          'COMPLETED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid MANUAL_RANK_CHECK job status transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."type" = 'MANUAL_RANK_CHECK'
    AND OLD."status" IN (
      'CANCELLED',
      'PARTIALLY_COMPLETED',
      'COMPLETED',
      'FAILED_FINAL',
      'ACTION_REQUIRED',
      'EXPIRED'
    )
    AND (
      NEW."stage" IS DISTINCT FROM OLD."stage"
      OR NEW."progress_current" IS DISTINCT FROM OLD."progress_current"
      OR NEW."reserved_cost_micro"
        IS DISTINCT FROM OLD."reserved_cost_micro"
      OR NEW."actual_cost_micro" IS DISTINCT FROM OLD."actual_cost_micro"
      OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
      OR NEW."error_summary" IS DISTINCT FROM OLD."error_summary"
      OR NEW."result_summary" IS DISTINCT FROM OLD."result_summary"
      OR NEW."queued_at" IS DISTINCT FROM OLD."queued_at"
      OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
      OR NEW."finished_at" IS DISTINCT FROM OLD."finished_at"
      OR NEW."cancel_requested_at"
        IS DISTINCT FROM OLD."cancel_requested_at"
      OR NEW."lease_owner" IS DISTINCT FROM OLD."lease_owner"
      OR NEW."lease_expires_at" IS DISTINCT FROM OLD."lease_expires_at"
      OR NEW."retry_at" IS DISTINCT FROM OLD."retry_at"
    )
  THEN
    RAISE EXCEPTION 'Terminal MANUAL_RANK_CHECK outcome is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "manual_rank_job_identity_immutable"
  BEFORE UPDATE ON "jobs"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_manual_rank_job_identity"();

CREATE FUNCTION "protect_rank_job_run"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Rank job runs are immutable history'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW."seal_state" <> 'PENDING'
    OR NEW."seal_attempt_count" <> 0
    OR NEW."last_seal_attempt_at" IS NOT NULL
    OR NEW."cancel_requested_by" IS NOT NULL
    OR NEW."manifest_id" IS NOT NULL
    OR NEW."manifest_hash_schema" IS NOT NULL
    OR NEW."manifest_hash" IS NOT NULL
    OR NEW."manifest_deduplication_hash" IS NOT NULL
    OR NEW."manifest_pair_count" IS NOT NULL
    OR NEW."manifest_chunk_count" IS NOT NULL
    OR NEW."manifest_chunk_size" IS NOT NULL
    OR NEW."manifest_sealed_at" IS NOT NULL
    OR NEW."finalization_status" IS NOT NULL
    OR NEW."finalization_request_hash" IS NOT NULL
    OR NEW."finalized_at" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rank job run must start in exact PENDING state'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."job_id" IS DISTINCT FROM OLD."job_id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."estimate_id" IS DISTINCT FROM OLD."estimate_id"
    OR NEW."tracking_context_id" IS DISTINCT FROM OLD."tracking_context_id"
    OR NEW."project_domain" IS DISTINCT FROM OLD."project_domain"
    OR NEW."project_status" IS DISTINCT FROM OLD."project_status"
    OR NEW."project_version" IS DISTINCT FROM OLD."project_version"
    OR NEW."manifest_command" IS DISTINCT FROM OLD."manifest_command"
    OR NEW."manifest_command_hash" IS DISTINCT FROM OLD."manifest_command_hash"
    OR (
      OLD."cancel_requested_by" IS NOT NULL
      AND NEW."cancel_requested_by"
        IS DISTINCT FROM OLD."cancel_requested_by"
    )
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Rank job run identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."cancel_requested_by" IS NULL
    AND NEW."cancel_requested_by" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "jobs" j
      WHERE j."id" = NEW."job_id"
        AND j."workspace_id" = NEW."workspace_id"
        AND j."project_id" = NEW."project_id"
        AND j."type" = 'MANUAL_RANK_CHECK'
        AND j."status" IN ('CANCEL_REQUESTED', 'CANCELLED')
    )
  THEN
    RAISE EXCEPTION
      'Rank cancellation actor requires a cancelling parent Job'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND NOT (
    NEW."seal_state" = OLD."seal_state"
    OR (OLD."seal_state" = 'PENDING'
      AND NEW."seal_state" IN ('OUTCOME_UNKNOWN', 'NOT_SEALED'))
    OR (OLD."seal_state" = 'OUTCOME_UNKNOWN'
      AND NEW."seal_state" IN (
        'OUTCOME_UNKNOWN',
        'NOT_SEALED',
        'SEALED'
      ))
    OR (OLD."seal_state" = 'SEALED'
      AND NEW."seal_state" IN ('SEALED', 'FINALIZED'))
    OR (OLD."seal_state" = 'NOT_SEALED'
      AND NEW."seal_state" = 'NOT_SEALED')
    OR (OLD."seal_state" = 'FINALIZED'
      AND NEW."seal_state" = 'FINALIZED')
  ) THEN
    RAISE EXCEPTION 'Invalid rank manifest seal transition'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."seal_state" IN ('SEALED', 'FINALIZED')
    AND (
      NEW."manifest_id" IS DISTINCT FROM OLD."manifest_id"
      OR NEW."manifest_hash_schema"
        IS DISTINCT FROM OLD."manifest_hash_schema"
      OR NEW."manifest_hash" IS DISTINCT FROM OLD."manifest_hash"
      OR NEW."manifest_deduplication_hash"
        IS DISTINCT FROM OLD."manifest_deduplication_hash"
      OR NEW."manifest_pair_count"
        IS DISTINCT FROM OLD."manifest_pair_count"
      OR NEW."manifest_chunk_count"
        IS DISTINCT FROM OLD."manifest_chunk_count"
      OR NEW."manifest_chunk_size"
        IS DISTINCT FROM OLD."manifest_chunk_size"
      OR NEW."manifest_sealed_at"
        IS DISTINCT FROM OLD."manifest_sealed_at"
    )
  THEN
    RAISE EXCEPTION 'Rank manifest seal receipt is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."seal_state" = 'FINALIZED'
    AND (
      NEW."finalization_status"
        IS DISTINCT FROM OLD."finalization_status"
      OR NEW."finalization_request_hash"
        IS DISTINCT FROM OLD."finalization_request_hash"
      OR NEW."finalized_at" IS DISTINCT FROM OLD."finalized_at"
    )
  THEN
    RAISE EXCEPTION 'Rank manifest finalization receipt is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    (
      OLD."seal_state" IN ('NOT_SEALED', 'SEALED', 'FINALIZED')
      AND (
        NEW."seal_attempt_count"
          IS DISTINCT FROM OLD."seal_attempt_count"
        OR NEW."last_seal_attempt_at"
          IS DISTINCT FROM OLD."last_seal_attempt_at"
      )
    )
    OR (
      OLD."seal_state" = 'PENDING'
      AND NEW."seal_state" = 'OUTCOME_UNKNOWN'
      AND (
        NEW."seal_attempt_count" <> 1
        OR NEW."last_seal_attempt_at" IS NULL
      )
    )
    OR (
      OLD."seal_state" = 'PENDING'
      AND NEW."seal_state" <> 'OUTCOME_UNKNOWN'
      AND (
        NEW."seal_attempt_count"
          IS DISTINCT FROM OLD."seal_attempt_count"
        OR NEW."last_seal_attempt_at"
          IS DISTINCT FROM OLD."last_seal_attempt_at"
      )
    )
    OR (
      OLD."seal_state" = 'OUTCOME_UNKNOWN'
      AND NEW."seal_state" = 'OUTCOME_UNKNOWN'
      AND NOT (
        (
          NEW."seal_attempt_count" = OLD."seal_attempt_count"
          AND NEW."last_seal_attempt_at" = OLD."last_seal_attempt_at"
        )
        OR (
          NEW."seal_attempt_count" = OLD."seal_attempt_count" + 1
          AND NEW."last_seal_attempt_at" >= OLD."last_seal_attempt_at"
        )
      )
    )
    OR (
      OLD."seal_state" = 'OUTCOME_UNKNOWN'
      AND NEW."seal_state" <> 'OUTCOME_UNKNOWN'
      AND (
        NEW."seal_attempt_count"
          IS DISTINCT FROM OLD."seal_attempt_count"
        OR NEW."last_seal_attempt_at"
          IS DISTINCT FROM OLD."last_seal_attempt_at"
      )
    )
  ) THEN
    RAISE EXCEPTION 'Rank manifest seal attempt evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "rank_job_run_protection"
  BEFORE INSERT OR UPDATE OR DELETE ON "rank_job_runs"
  FOR EACH ROW
  EXECUTE FUNCTION "protect_rank_job_run"();

CREATE FUNCTION "reject_rank_job_run_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rank job runs cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_job_run_no_truncate"
  BEFORE TRUNCATE ON "rank_job_runs"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_rank_job_run_truncate"();

CREATE FUNCTION "manual_rank_job_state_is_coherent"(
  job_status "JobStatus",
  seal_state "RankManifestSealState",
  finalization_status "RankCheckFinalStatus"
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN job_status = 'PREPARING' THEN
      seal_state IN ('PENDING', 'OUTCOME_UNKNOWN')
      AND finalization_status IS NULL
    WHEN job_status IN ('QUEUED', 'RUNNING') THEN
      seal_state = 'SEALED'
      AND finalization_status IS NULL
    WHEN job_status = 'CANCEL_REQUESTED' THEN
      seal_state IN ('OUTCOME_UNKNOWN', 'SEALED')
      AND finalization_status IS NULL
    WHEN job_status = 'CANCELLED' THEN
      (
        seal_state = 'NOT_SEALED'
        AND finalization_status IS NULL
      )
      OR (
        seal_state = 'FINALIZED'
        AND finalization_status = 'CANCELLED'
      )
    WHEN job_status = 'PARTIALLY_COMPLETED' THEN
      seal_state = 'FINALIZED'
      AND finalization_status = 'PARTIALLY_COMPLETED'
    WHEN job_status = 'COMPLETED' THEN
      seal_state = 'FINALIZED'
      AND finalization_status = 'COMPLETED'
    WHEN job_status = 'FAILED_FINAL' THEN
      (
        seal_state = 'NOT_SEALED'
        AND finalization_status IS NULL
      )
      OR (
        seal_state = 'FINALIZED'
        AND finalization_status = 'FAILED'
      )
    WHEN job_status = 'ACTION_REQUIRED' THEN
      (
        seal_state IN ('OUTCOME_UNKNOWN', 'SEALED')
        AND finalization_status IS NULL
      )
      OR (
        seal_state = 'FINALIZED'
        AND finalization_status = 'ACTION_REQUIRED'
      )
    WHEN job_status = 'EXPIRED' THEN
      seal_state = 'NOT_SEALED'
      AND finalization_status IS NULL
    ELSE FALSE
  END
$$;

CREATE FUNCTION "assert_manual_rank_job_has_run"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."type" = 'MANUAL_RANK_CHECK' AND NOT EXISTS (
    SELECT 1
    FROM "jobs" j
    JOIN "rank_job_runs" r
      ON r."job_id" = j."id"
     AND r."workspace_id" = j."workspace_id"
     AND r."project_id" = j."project_id"
    JOIN "rank_estimates" e
      ON e."id" = r."estimate_id"
     AND e."workspace_id" = r."workspace_id"
     AND e."project_id" = r."project_id"
    WHERE j."id" = NEW."id"
      AND j."workspace_id" = NEW."workspace_id"
      AND j."project_id" = NEW."project_id"
      AND j."type" = 'MANUAL_RANK_CHECK'
      AND e."actor_id" = j."actor_id"
      AND e."tracking_context_id" = r."tracking_context_id"
      AND e."project_version" = r."project_version"
      AND e."keyword_count"::bigint = j."progress_total"
      AND e."execution_snapshot" IS NOT NULL
      AND e."execution_snapshot_hash" IS NOT NULL
      AND "manual_rank_job_state_is_coherent"(
        j."status",
        r."seal_state",
        r."finalization_status"
      )
      AND j."attempt" BETWEEN 0 AND j."max_attempts"
      AND (
        (
          r."seal_state" IN (
            'PENDING',
            'OUTCOME_UNKNOWN',
            'NOT_SEALED'
          )
          AND r."seal_attempt_count" = j."attempt"
        )
        OR (
          r."seal_state" IN ('SEALED', 'FINALIZED')
          AND r."seal_attempt_count" <= j."attempt"
        )
      )
      AND (
        (
          j."status" IN ('CANCEL_REQUESTED', 'CANCELLED')
          AND r."cancel_requested_by" IS NOT NULL
        )
        OR (
          j."status" NOT IN (
            'CANCEL_REQUESTED',
            'CANCELLED',
            'PARTIALLY_COMPLETED',
            'COMPLETED',
            'FAILED_FINAL',
            'ACTION_REQUIRED'
          )
          AND r."cancel_requested_by" IS NULL
        )
        OR j."status" IN (
          'PARTIALLY_COMPLETED',
          'COMPLETED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
      AND (
        r."seal_state" NOT IN ('SEALED', 'FINALIZED')
        OR r."manifest_pair_count"::bigint = j."progress_total"
      )
      AND r."job_id" = NEW."id"
      AND r."workspace_id" = NEW."workspace_id"
      AND r."project_id" = NEW."project_id"
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK requires a coherent rank_job_runs row'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "manual_rank_job_has_run"
  AFTER INSERT OR UPDATE ON "jobs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "assert_manual_rank_job_has_run"();

CREATE FUNCTION "assert_rank_run_has_manual_job"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "rank_job_runs" r
    JOIN "jobs" j
      ON j."id" = r."job_id"
     AND j."workspace_id" = r."workspace_id"
     AND j."project_id" = r."project_id"
    JOIN "rank_estimates" e
      ON e."id" = r."estimate_id"
     AND e."workspace_id" = r."workspace_id"
     AND e."project_id" = r."project_id"
    WHERE r."job_id" = NEW."job_id"
      AND r."workspace_id" = NEW."workspace_id"
      AND r."project_id" = NEW."project_id"
      AND j."type" = 'MANUAL_RANK_CHECK'
      AND e."actor_id" = j."actor_id"
      AND e."tracking_context_id" = r."tracking_context_id"
      AND e."project_version" = r."project_version"
      AND e."keyword_count"::bigint = j."progress_total"
      AND e."execution_snapshot" IS NOT NULL
      AND e."execution_snapshot_hash" IS NOT NULL
      AND "manual_rank_job_state_is_coherent"(
        j."status",
        r."seal_state",
        r."finalization_status"
      )
      AND j."attempt" BETWEEN 0 AND j."max_attempts"
      AND (
        (
          r."seal_state" IN (
            'PENDING',
            'OUTCOME_UNKNOWN',
            'NOT_SEALED'
          )
          AND r."seal_attempt_count" = j."attempt"
        )
        OR (
          r."seal_state" IN ('SEALED', 'FINALIZED')
          AND r."seal_attempt_count" <= j."attempt"
        )
      )
      AND (
        (
          j."status" IN ('CANCEL_REQUESTED', 'CANCELLED')
          AND r."cancel_requested_by" IS NOT NULL
        )
        OR (
          j."status" NOT IN (
            'CANCEL_REQUESTED',
            'CANCELLED',
            'PARTIALLY_COMPLETED',
            'COMPLETED',
            'FAILED_FINAL',
            'ACTION_REQUIRED'
          )
          AND r."cancel_requested_by" IS NULL
        )
        OR j."status" IN (
          'PARTIALLY_COMPLETED',
          'COMPLETED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
      AND (
        r."seal_state" NOT IN ('SEALED', 'FINALIZED')
        OR r."manifest_pair_count"::bigint = j."progress_total"
      )
  ) THEN
    RAISE EXCEPTION
      'rank_job_runs requires a coherent MANUAL_RANK_CHECK parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "rank_run_has_manual_job"
  AFTER INSERT OR UPDATE ON "rank_job_runs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_run_has_manual_job"();

COMMIT;

BEGIN;

CREATE TYPE "RankConnectorExecutionStatus" AS ENUM (
  'READY_TO_SUBMIT'
);

CREATE TABLE "rank_connector_executions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "grant_attempt_id" UUID NOT NULL,
  "execution_attempt" INTEGER NOT NULL,
  "job_version" INTEGER NOT NULL,
  "estimate_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "manifest_hash" BYTEA NOT NULL,
  "manifest_chunk_index" INTEGER NOT NULL,
  "binding_id" UUID NOT NULL,
  "binding_version" INTEGER NOT NULL,
  "route_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "credential_version" INTEGER NOT NULL,
  "credential_material_version" INTEGER NOT NULL,
  "credential_validation_id" UUID NOT NULL,
  "credential_validation_version" INTEGER NOT NULL,
  "credential_validation_connector_version" VARCHAR(64) NOT NULL,
  "credential_verified_at" TIMESTAMPTZ(6) NOT NULL,
  "estimate_execution_hash" BYTEA NOT NULL,
  "execution_evidence_hash" BYTEA NOT NULL,
  "execution_connector_version" VARCHAR(64) NOT NULL,
  "provider_policy_version" VARCHAR(64) NOT NULL,
  "kill_switch_version" VARCHAR(64) NOT NULL,
  "authorization_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "RankConnectorExecutionStatus" NOT NULL
    DEFAULT 'READY_TO_SUBMIT',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "rank_connector_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_connector_executions_shape"
    CHECK (
      "execution_attempt" BETWEEN 1 AND 1000
      AND "job_version" > 0
      AND "manifest_chunk_index" BETWEEN 0 AND 3
      AND "binding_version" > 0
      AND "credential_version" > 0
      AND "credential_material_version" > 0
      AND "credential_validation_version" > 0
      AND octet_length("manifest_hash") = 32
      AND octet_length("estimate_execution_hash") = 32
      AND octet_length("execution_evidence_hash") = 32
      AND "credential_validation_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "execution_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "provider_policy_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "kill_switch_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "authorization_expires_at" > "created_at"
      AND "status" = 'READY_TO_SUBMIT'
    )
);

CREATE UNIQUE INDEX "rank_connector_executions_grant_attempt_key"
  ON "rank_connector_executions" ("grant_attempt_id");

CREATE UNIQUE INDEX "rank_connector_executions_workspace_item_attempt_key"
  ON "rank_connector_executions" (
    "workspace_id",
    "job_item_id",
    "execution_attempt"
  );

CREATE INDEX "rank_connector_executions_job_created_idx"
  ON "rank_connector_executions" (
    "workspace_id",
    "project_id",
    "job_id",
    "created_at"
  );

CREATE INDEX "rank_connector_executions_status_expiry_idx"
  ON "rank_connector_executions" (
    "status",
    "authorization_expires_at",
    "created_at"
  );

ALTER TABLE "rank_connector_executions"
  ADD CONSTRAINT "rank_connector_executions_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "jobs" ("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_rank_run_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "job_id")
    REFERENCES "rank_job_runs" ("workspace_id", "project_id", "job_id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_job_item_tenant_fkey"
    FOREIGN KEY (
      "workspace_id",
      "project_id",
      "job_id",
      "job_item_id"
    )
    REFERENCES "job_items" (
      "workspace_id",
      "project_id",
      "job_id",
      "id"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_grant_attempt_fkey"
    FOREIGN KEY ("grant_attempt_id")
    REFERENCES "rank_execution_grant_attempts" ("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_binding_tenant_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "binding_id")
    REFERENCES "project_connector_bindings" (
      "workspace_id",
      "project_id",
      "id"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_route_fkey"
    FOREIGN KEY ("route_id")
    REFERENCES "project_connector_routes" ("id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_credential_tenant_fkey"
    FOREIGN KEY ("workspace_id", "credential_id")
    REFERENCES "integration_credentials" ("workspace_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  ADD CONSTRAINT "rank_connector_executions_validation_job_tenant_fkey"
    FOREIGN KEY ("workspace_id", "credential_validation_id")
    REFERENCES "jobs" ("workspace_id", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT;

CREATE FUNCTION "assert_rank_connector_execution_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "rank_execution_grant_attempts" attempt
    JOIN "jobs" job
      ON job."workspace_id" = attempt."workspace_id"
      AND job."project_id" = attempt."project_id"
      AND job."id" = attempt."job_id"
    JOIN "rank_job_runs" run
      ON run."workspace_id" = attempt."workspace_id"
      AND run."project_id" = attempt."project_id"
      AND run."job_id" = attempt."job_id"
    JOIN "rank_estimates" estimate
      ON estimate."workspace_id" = run."workspace_id"
      AND estimate."project_id" = run."project_id"
      AND estimate."id" = run."estimate_id"
    JOIN "job_items" item
      ON item."workspace_id" = attempt."workspace_id"
      AND item."project_id" = attempt."project_id"
      AND item."job_id" = attempt."job_id"
      AND item."id" = attempt."job_item_id"
    JOIN "integration_credentials" credential
      ON credential."workspace_id" = attempt."workspace_id"
      AND credential."id" = NEW."credential_id"
    JOIN "jobs" validation
      ON validation."workspace_id" = attempt."workspace_id"
      AND validation."id" = NEW."credential_validation_id"
    JOIN "project_connector_bindings" binding
      ON binding."workspace_id" = attempt."workspace_id"
      AND binding."project_id" = attempt."project_id"
      AND binding."id" = NEW."binding_id"
    JOIN "project_connector_routes" route
      ON route."workspace_id" = attempt."workspace_id"
      AND route."project_id" = attempt."project_id"
      AND route."binding_id" = NEW."binding_id"
      AND route."id" = NEW."route_id"
      AND route."credential_id" = NEW."credential_id"
    WHERE attempt."id" = NEW."grant_attempt_id"
      AND attempt."workspace_id" = NEW."workspace_id"
      AND attempt."project_id" = NEW."project_id"
      AND attempt."job_id" = NEW."job_id"
      AND attempt."job_item_id" = NEW."job_item_id"
      AND attempt."execution_attempt" = NEW."execution_attempt"
      AND attempt."job_version" = NEW."job_version"
      AND attempt."execution_evidence_hash" =
        NEW."execution_evidence_hash"
      AND attempt."status" = 'GRANTED_PENDING_CONSUME'
      AND attempt."expires_at" = NEW."authorization_expires_at"
      AND attempt."expires_at" > clock_timestamp()
      AND job."type" = 'MANUAL_RANK_CHECK'
      AND job."version" = NEW."job_version"
      AND job."provider" = 'ARSENKIN'
      AND job."credential_mode" = 'BYOK_API_KEY'
      AND (
        (
          job."status" = 'QUEUED'
          AND job."stage" = 'WAITING_FOR_QUEUE'
        )
        OR
        (
          job."status" = 'RUNNING'
          AND job."stage" = 'WAITING_EXECUTION_GRANT'
        )
      )
      AND job."cancel_requested_at" IS NULL
      AND run."seal_state" = 'SEALED'
      AND run."estimate_id" = NEW."estimate_id"
      AND run."manifest_id" = NEW."manifest_id"
      AND run."manifest_hash" = NEW."manifest_hash"
      AND run."manifest_chunk_count" BETWEEN 1 AND 4
      AND NEW."manifest_chunk_index" >= 0
      AND NEW."manifest_chunk_index" < run."manifest_chunk_count"
      AND run."finalization_status" IS NULL
      AND item."sequence" = NEW."manifest_chunk_index"
      AND item."status" = 'QUEUED'
      AND item."provider_request_id" IS NULL
      AND item."output_reference" IS NULL
      AND item."actual_cost_micro" IS NULL
      AND item."error" IS NULL
      AND item."attempt" = 0
      AND item."retry_at" IS NULL
      AND item."input_reference" = jsonb_build_object(
        'schemaVersion', 'rank-job-item@1',
        'manifestId', NEW."manifest_id"::text,
        'chunkIndex', NEW."manifest_chunk_index"
      )
      AND estimate."execution_snapshot_hash" =
        NEW."estimate_execution_hash"
      AND estimate."binding_id" = NEW."binding_id"
      AND estimate."binding_version" = NEW."binding_version"
      AND estimate."route_id" = NEW."route_id"
      AND estimate."credential_id" = NEW."credential_id"
      AND estimate."credential_version" = NEW."credential_version"
      AND estimate."credential_material_version" =
        NEW."credential_material_version"
      AND estimate."credential_validation_id" =
        NEW."credential_validation_id"
      AND estimate."credential_validation_version" =
        NEW."credential_validation_version"
      AND estimate."credential_validation_connector_version" =
        NEW."credential_validation_connector_version"
      AND estimate."credential_verified_at" =
        NEW."credential_verified_at"
      AND estimate."provider_policy_version" =
        NEW."provider_policy_version"
      AND credential."provider" = 'ARSENKIN'
      AND credential."mode" = 'BYOK_API_KEY'
      AND credential."status" = 'ACTIVE'
      AND credential."deleted_at" IS NULL
      AND credential."version" = NEW."credential_version"
      AND credential."material_version" =
        NEW."credential_material_version"
      AND credential."verified_at" = NEW."credential_verified_at"
      AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation."status" = 'COMPLETED'
      AND validation."version" = NEW."credential_validation_version"
      AND binding."capability" = 'SERP_RANK_TRACKING'
      AND binding."enabled"
      AND binding."version" = NEW."binding_version"
      AND route."position" = 0
      AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
  ) THEN
    RAISE EXCEPTION
      'Rank connector execution must match one current granted Job graph'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "rank_connector_execution_scope_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "rank_connector_executions"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_scope"();

CREATE FUNCTION "assert_rank_connector_execution_consumed_graph"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'rank_connector_executions' THEN
    IF TG_OP = 'DELETE' THEN
      attempt_id := OLD."grant_attempt_id";
    ELSE
      attempt_id := NEW."grant_attempt_id";
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      attempt_id := OLD."id";
    ELSE
      attempt_id := NEW."id";
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "rank_execution_grant_attempts" attempt
    WHERE attempt."id" = attempt_id
      AND (
        (
          attempt."status" = 'CONSUMED'
          AND (
            SELECT count(*)
            FROM "rank_connector_executions" execution
            WHERE execution."grant_attempt_id" = attempt."id"
          ) <> 1
        )
        OR
        (
          attempt."status" <> 'CONSUMED'
          AND EXISTS (
            SELECT 1
            FROM "rank_connector_executions" execution
            WHERE execution."grant_attempt_id" = attempt."id"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Consumed rank grant and connector execution must commit together'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "rank_connector_execution_consumed_attempt_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "rank_connector_executions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_consumed_graph"();

CREATE CONSTRAINT TRIGGER "rank_grant_attempt_connector_execution_guard"
  AFTER INSERT OR UPDATE OR DELETE ON "rank_execution_grant_attempts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_consumed_graph"();

CREATE FUNCTION "reject_rank_connector_execution_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rank connector executions cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_connector_execution_no_truncate"
  BEFORE TRUNCATE ON "rank_connector_executions"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_rank_connector_execution_truncate"();

COMMIT;

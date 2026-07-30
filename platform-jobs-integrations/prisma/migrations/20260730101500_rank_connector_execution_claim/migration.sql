-- PostgreSQL does not allow a newly added enum value to be used before the
-- transaction that added it commits. Keep the expand step separate from the
-- transactional table/function switch below.
ALTER TYPE "RankConnectorExecutionStatus"
  ADD VALUE IF NOT EXISTS 'CLAIMED';

BEGIN;

CREATE TABLE "rank_connector_execution_controls" (
  "provider" VARCHAR(64) NOT NULL,
  "capability" VARCHAR(100) NOT NULL,
  "submit_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "execution_connector_version" VARCHAR(64) NOT NULL,
  "provider_policy_version" VARCHAR(64) NOT NULL,
  "kill_switch_version" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_connector_execution_controls_pkey"
    PRIMARY KEY ("provider", "capability"),
  CONSTRAINT "rank_connector_execution_controls_shape"
    CHECK (
      "provider" ~ '^[A-Z][A-Z0-9_]{0,63}$'
      AND "capability" ~ '^[A-Z][A-Z0-9_]{0,99}$'
      AND "execution_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "provider_policy_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "kill_switch_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "version" > 0
      AND "updated_at" >= "created_at"
    )
);

CREATE TABLE "rank_connector_execution_control_versions" (
  "provider" VARCHAR(64) NOT NULL,
  "capability" VARCHAR(100) NOT NULL,
  "kill_switch_version" VARCHAR(64) NOT NULL,
  "submit_enabled" BOOLEAN NOT NULL,
  "execution_connector_version" VARCHAR(64) NOT NULL,
  "provider_policy_version" VARCHAR(64) NOT NULL,
  "control_version" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_connector_execution_control_versions_pkey"
    PRIMARY KEY ("provider", "capability", "kill_switch_version"),
  CONSTRAINT "rank_connector_execution_control_versions_control_fkey"
    FOREIGN KEY ("provider", "capability")
    REFERENCES "rank_connector_execution_controls" (
      "provider",
      "capability"
    )
    ON DELETE RESTRICT
    ON UPDATE RESTRICT,
  CONSTRAINT "rank_connector_execution_control_versions_shape"
    CHECK (
      "execution_connector_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "provider_policy_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "kill_switch_version" ~
        '^[a-z0-9][a-z0-9@._-]{0,63}$'
      AND "control_version" > 0
    )
);

-- Expand fail-closed. Enabling this row is an explicit owner-operated rollout
-- and must use a new kill-switch version; the connector role has no table DML.
INSERT INTO "rank_connector_execution_controls" (
  "provider",
  "capability",
  "submit_enabled",
  "execution_connector_version",
  "provider_policy_version",
  "kill_switch_version",
  "version"
)
VALUES (
  'ARSENKIN',
  'SERP_RANK_TRACKING',
  FALSE,
  'arsenkin-positions@1.0.0',
  'manual-arsenkin-positions@1.0.0',
  'arsenkin-positions@1',
  1
);

INSERT INTO "rank_connector_execution_control_versions" (
  "provider",
  "capability",
  "kill_switch_version",
  "submit_enabled",
  "execution_connector_version",
  "provider_policy_version",
  "control_version"
)
VALUES (
  'ARSENKIN',
  'SERP_RANK_TRACKING',
  'arsenkin-positions@1',
  FALSE,
  'arsenkin-positions@1.0.0',
  'manual-arsenkin-positions@1.0.0',
  1
);

CREATE FUNCTION "assert_rank_connector_execution_control_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Rank connector execution controls cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW."provider",
    NEW."capability",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."provider",
    OLD."capability",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Rank connector execution control identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW."submit_enabled",
    NEW."execution_connector_version",
    NEW."provider_policy_version",
    NEW."kill_switch_version"
  ) IS NOT DISTINCT FROM ROW(
    OLD."submit_enabled",
    OLD."execution_connector_version",
    OLD."provider_policy_version",
    OLD."kill_switch_version"
  ) THEN
    RAISE EXCEPTION 'Rank connector execution control no-op is forbidden'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."version" <> OLD."version" + 1
    OR NEW."updated_at" <= OLD."updated_at"
  THEN
    RAISE EXCEPTION
      'Rank connector execution control version must advance exactly once'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."kill_switch_version" = OLD."kill_switch_version" THEN
    RAISE EXCEPTION
      'Rank connector execution control changes require a new kill-switch version'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.rank_connector_execution_control_versions (
    "provider",
    "capability",
    "kill_switch_version",
    "submit_enabled",
    "execution_connector_version",
    "provider_policy_version",
    "control_version",
    "created_at"
  ) VALUES (
    NEW."provider",
    NEW."capability",
    NEW."kill_switch_version",
    NEW."submit_enabled",
    NEW."execution_connector_version",
    NEW."provider_policy_version",
    NEW."version",
    NEW."updated_at"
  );

  RETURN NEW;
END
$$;

CREATE TRIGGER "rank_connector_execution_control_mutation_guard"
  BEFORE UPDATE OR DELETE ON "rank_connector_execution_controls"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_control_mutation"();

-- The seeded row is recorded above because this trigger intentionally appears
-- after the seed. Every future provider/capability control records its initial
-- kill-switch version on insert, so A -> B -> A cannot bypass history merely by
-- starting from a newly introduced control row.
CREATE FUNCTION "record_rank_connector_execution_control_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.rank_connector_execution_control_versions (
    "provider",
    "capability",
    "kill_switch_version",
    "submit_enabled",
    "execution_connector_version",
    "provider_policy_version",
    "control_version",
    "created_at"
  ) VALUES (
    NEW."provider",
    NEW."capability",
    NEW."kill_switch_version",
    NEW."submit_enabled",
    NEW."execution_connector_version",
    NEW."provider_policy_version",
    NEW."version",
    NEW."created_at"
  );

  RETURN NULL;
END
$$;

CREATE TRIGGER "rank_connector_execution_control_insert_history"
  AFTER INSERT ON "rank_connector_execution_controls"
  FOR EACH ROW
  EXECUTE FUNCTION "record_rank_connector_execution_control_insert"();

CREATE FUNCTION "reject_rank_connector_execution_control_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rank connector execution controls cannot be truncated'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_connector_execution_control_no_truncate"
  BEFORE TRUNCATE ON "rank_connector_execution_controls"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "reject_rank_connector_execution_control_truncate"();

CREATE FUNCTION "reject_rank_connector_execution_control_version_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Rank connector execution control version history is immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER "rank_connector_execution_control_version_immutable"
  BEFORE UPDATE OR DELETE ON "rank_connector_execution_control_versions"
  FOR EACH ROW
  EXECUTE FUNCTION
    "reject_rank_connector_execution_control_version_mutation"();

CREATE TRIGGER "rank_connector_execution_control_version_no_truncate"
  BEFORE TRUNCATE ON "rank_connector_execution_control_versions"
  FOR EACH STATEMENT
  EXECUTE FUNCTION
    "reject_rank_connector_execution_control_version_mutation"();

ALTER TABLE "rank_connector_executions"
  ADD COLUMN "lease_owner" VARCHAR(100),
  ADD COLUMN "lease_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "rank_connector_executions"
  DROP CONSTRAINT "rank_connector_executions_shape",
  ADD CONSTRAINT "rank_connector_executions_shape"
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
      AND (
        (
          "status" = 'READY_TO_SUBMIT'
          AND "lease_owner" IS NULL
          AND "lease_token" IS NULL
          AND "lease_expires_at" IS NULL
          AND "claimed_at" IS NULL
          AND "version" = 1
        )
        OR
        (
          "status" = 'CLAIMED'
          AND "lease_owner" IS NOT NULL
          AND "lease_owner" ~
            '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
          AND "lease_token" IS NOT NULL
          AND "lease_expires_at" IS NOT NULL
          AND "claimed_at" IS NOT NULL
          AND "lease_expires_at" > "claimed_at"
          AND "lease_expires_at" <= "authorization_expires_at"
          AND "claimed_at" >= "created_at"
          AND "version" >= 2
        )
      )
    );

DROP INDEX "rank_connector_executions_status_expiry_idx";

CREATE INDEX "rank_connector_executions_claim_due_idx"
  ON "rank_connector_executions" (
    "status",
    "authorization_expires_at",
    "lease_expires_at",
    "created_at",
    "id"
  );

-- The original insert guard remains authoritative. It is detached from UPDATE
-- so only the exact lease transition guard below can mutate an execution row.
DROP TRIGGER "rank_connector_execution_scope_guard"
  ON "rank_connector_executions";

CREATE TRIGGER "rank_connector_execution_scope_guard"
  BEFORE INSERT OR DELETE ON "rank_connector_executions"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_scope"();

CREATE FUNCTION "assert_rank_connector_execution_claim_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW."id",
    NEW."workspace_id",
    NEW."project_id",
    NEW."job_id",
    NEW."job_item_id",
    NEW."grant_attempt_id",
    NEW."execution_attempt",
    NEW."job_version",
    NEW."estimate_id",
    NEW."manifest_id",
    NEW."manifest_hash",
    NEW."manifest_chunk_index",
    NEW."binding_id",
    NEW."binding_version",
    NEW."route_id",
    NEW."credential_id",
    NEW."credential_version",
    NEW."credential_material_version",
    NEW."credential_validation_id",
    NEW."credential_validation_version",
    NEW."credential_validation_connector_version",
    NEW."credential_verified_at",
    NEW."estimate_execution_hash",
    NEW."execution_evidence_hash",
    NEW."execution_connector_version",
    NEW."provider_policy_version",
    NEW."kill_switch_version",
    NEW."authorization_expires_at",
    NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."workspace_id",
    OLD."project_id",
    OLD."job_id",
    OLD."job_item_id",
    OLD."grant_attempt_id",
    OLD."execution_attempt",
    OLD."job_version",
    OLD."estimate_id",
    OLD."manifest_id",
    OLD."manifest_hash",
    OLD."manifest_chunk_index",
    OLD."binding_id",
    OLD."binding_version",
    OLD."route_id",
    OLD."credential_id",
    OLD."credential_version",
    OLD."credential_material_version",
    OLD."credential_validation_id",
    OLD."credential_validation_version",
    OLD."credential_validation_connector_version",
    OLD."credential_verified_at",
    OLD."estimate_execution_hash",
    OLD."execution_evidence_hash",
    OLD."execution_connector_version",
    OLD."provider_policy_version",
    OLD."kill_switch_version",
    OLD."authorization_expires_at",
    OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" <> 'CLAIMED'
    OR NEW."version" <> OLD."version" + 1
    OR NEW."updated_at" <> NEW."claimed_at"
    OR NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"
    OR NOT (
      OLD."status" = 'READY_TO_SUBMIT'
      OR (
        OLD."status" = 'CLAIMED'
        AND OLD."lease_expires_at" <= clock_timestamp()
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid rank connector execution claim transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "rank_connector_execution_claim_transition_guard"
  BEFORE UPDATE ON "rank_connector_executions"
  FOR EACH ROW
  EXECUTE FUNCTION "assert_rank_connector_execution_claim_transition"();

-- Claim runs with owner privileges and queues the existing consumed-graph
-- constraint trigger. Harden that deferred boundary before any connector role
-- can receive EXECUTE: a caller-controlled pg_temp/search_path must never be
-- able to redirect owner reads at transaction end.
CREATE OR REPLACE FUNCTION
  public.assert_rank_connector_execution_consumed_graph()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    FROM public.rank_execution_grant_attempts attempt
    WHERE attempt."id" = attempt_id
      AND (
        (
          attempt."status" = 'CONSUMED'
          AND (
            SELECT count(*)
            FROM public.rank_connector_executions execution
            WHERE execution."grant_attempt_id" = attempt."id"
          ) <> 1
        )
        OR
        (
          attempt."status" <> 'CONSUMED'
          AND EXISTS (
            SELECT 1
            FROM public.rank_connector_executions execution
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

CREATE FUNCTION "claim_rank_connector_execution"(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID,
  "provider" VARCHAR(64),
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  current_execution public.rank_connector_executions%ROWTYPE;
  current_credential public.integration_credentials%ROWTYPE;
  current_control public.rank_connector_execution_controls%ROWTYPE;
  v_claimed_at TIMESTAMPTZ;
  v_claimed_lease_token UUID;
  v_claimed_lease_expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector lease owner'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 25 THEN
    RAISE EXCEPTION 'Rank connector lease must be between 5 and 25 seconds'
      USING ERRCODE = '22023';
  END IF;

  IF p_execution_connector_version IS NULL
    OR p_execution_connector_version !~
      '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank execution connector version'
      USING ERRCODE = '22023';
  END IF;

  -- Candidate discovery does not lock a child row first. Only the parent Job
  -- is claimed here; the remaining graph follows the canonical lock order.
  /* rank-connector-claim:job */
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job."workspace_id" = execution."workspace_id"
    AND job."project_id" = execution."project_id"
    AND job."id" = execution."job_id"
  JOIN public.rank_connector_execution_controls control
    ON control."provider" = job."provider"
    AND control."capability" = 'SERP_RANK_TRACKING'
  JOIN public.rank_job_runs run
    ON run."workspace_id" = execution."workspace_id"
    AND run."project_id" = execution."project_id"
    AND run."job_id" = execution."job_id"
  JOIN public.job_items item
    ON item."workspace_id" = execution."workspace_id"
    AND item."project_id" = execution."project_id"
    AND item."job_id" = execution."job_id"
    AND item."id" = execution."job_item_id"
  JOIN public.integration_credentials credential
    ON credential."workspace_id" = execution."workspace_id"
    AND credential."id" = execution."credential_id"
  JOIN public.jobs validation
    ON validation."workspace_id" = execution."workspace_id"
    AND validation."id" = execution."credential_validation_id"
  JOIN public.project_connector_bindings binding
    ON binding."workspace_id" = execution."workspace_id"
    AND binding."project_id" = execution."project_id"
    AND binding."id" = execution."binding_id"
  JOIN public.project_connector_routes route
    ON route."workspace_id" = execution."workspace_id"
    AND route."project_id" = execution."project_id"
    AND route."binding_id" = execution."binding_id"
    AND route."id" = execution."route_id"
    AND route."credential_id" = execution."credential_id"
  JOIN public.rank_execution_grant_attempts grant_attempt
    ON grant_attempt."id" = execution."grant_attempt_id"
    AND grant_attempt."workspace_id" = execution."workspace_id"
    AND grant_attempt."project_id" = execution."project_id"
    AND grant_attempt."job_id" = execution."job_id"
    AND grant_attempt."job_item_id" = execution."job_item_id"
  WHERE control."submit_enabled"
    AND control."execution_connector_version" =
      p_execution_connector_version
    AND control."execution_connector_version" =
      execution."execution_connector_version"
    AND control."provider_policy_version" =
      execution."provider_policy_version"
    AND control."kill_switch_version" =
      execution."kill_switch_version"
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = 'ARSENKIN'
    AND job."credential_mode" = 'BYOK_API_KEY'
    AND job."version" = execution."job_version"
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
    AND run."estimate_id" = execution."estimate_id"
    AND run."seal_state" = 'SEALED'
    AND run."manifest_id" = execution."manifest_id"
    AND run."manifest_hash" = execution."manifest_hash"
    AND run."manifest_chunk_count" BETWEEN 1 AND 4
    AND execution."manifest_chunk_index" < run."manifest_chunk_count"
    AND run."finalization_status" IS NULL
    AND item."sequence" = execution."manifest_chunk_index"
    AND item."status" = 'QUEUED'
    AND item."provider_request_id" IS NULL
    AND item."output_reference" IS NULL
    AND item."actual_cost_micro" IS NULL
    AND item."error" IS NULL
    AND item."attempt" = 0
    AND item."retry_at" IS NULL
    AND item."input_reference" = jsonb_build_object(
      'schemaVersion', 'rank-job-item@1',
      'manifestId', execution."manifest_id"::text,
      'chunkIndex', execution."manifest_chunk_index"
    )
    AND credential."provider" = 'ARSENKIN'
    AND credential."mode" = 'BYOK_API_KEY'
    AND credential."status" = 'ACTIVE'
    AND credential."deleted_at" IS NULL
    AND credential."version" = execution."credential_version"
    AND credential."material_version" =
      execution."credential_material_version"
    AND credential."verified_at" = execution."credential_verified_at"
    AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND validation."provider" = 'ARSENKIN'
    AND validation."credential_mode" = 'BYOK_API_KEY'
    AND validation."status" = 'COMPLETED'
    AND validation."version" =
      execution."credential_validation_version"
    AND validation."input_snapshot" = jsonb_build_object(
      'kind', 'integration.credential.validation.v1',
      'credentialId', execution."credential_id"::text,
      'credentialMaterialVersion',
        execution."credential_material_version",
      'connectorVersion',
        execution."credential_validation_connector_version"
    )
    AND binding."capability" = 'SERP_RANK_TRACKING'
    AND binding."enabled"
    AND binding."version" = execution."binding_version"
    AND route."position" = 0
    AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
    AND grant_attempt."execution_attempt" =
      execution."execution_attempt"
    AND grant_attempt."job_version" = execution."job_version"
    AND grant_attempt."execution_evidence_hash" =
      execution."execution_evidence_hash"
    AND grant_attempt."status" = 'CONSUMED'
    AND grant_attempt."expires_at" =
      execution."authorization_expires_at"
    AND execution."authorization_expires_at" >
      clock_timestamp() + make_interval(secs => p_lease_seconds)
    AND (
      execution."status" = 'READY_TO_SUBMIT'
      OR (
        execution."status" = 'CLAIMED'
        AND execution."lease_expires_at" <= clock_timestamp()
      )
    )
  ORDER BY execution."created_at", execution."id"
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  /* rank-connector-claim:run */
  PERFORM 1
  FROM public.rank_job_runs run
  WHERE run."workspace_id" = candidate."workspace_id"
    AND run."project_id" = candidate."project_id"
    AND run."job_id" = candidate."job_id"
    AND run."estimate_id" = candidate."estimate_id"
    AND run."seal_state" = 'SEALED'
    AND run."manifest_id" = candidate."manifest_id"
    AND run."manifest_hash" = candidate."manifest_hash"
    AND run."manifest_chunk_count" BETWEEN 1 AND 4
    AND candidate."manifest_chunk_index" < run."manifest_chunk_count"
    AND run."finalization_status" IS NULL
  FOR UPDATE OF run;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:item */
  PERFORM 1
  FROM public.job_items item
  WHERE item."workspace_id" = candidate."workspace_id"
    AND item."project_id" = candidate."project_id"
    AND item."job_id" = candidate."job_id"
    AND item."id" = candidate."job_item_id"
    AND item."sequence" = candidate."manifest_chunk_index"
    AND item."status" = 'QUEUED'
    AND item."provider_request_id" IS NULL
    AND item."output_reference" IS NULL
    AND item."actual_cost_micro" IS NULL
    AND item."error" IS NULL
    AND item."attempt" = 0
    AND item."retry_at" IS NULL
    AND item."input_reference" = jsonb_build_object(
      'schemaVersion', 'rank-job-item@1',
      'manifestId', candidate."manifest_id"::text,
      'chunkIndex', candidate."manifest_chunk_index"
    )
  FOR UPDATE OF item;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:credential */
  SELECT credential.*
  INTO current_credential
  FROM public.integration_credentials credential
  WHERE credential."workspace_id" = candidate."workspace_id"
    AND credential."id" = candidate."credential_id"
    AND credential."provider" = 'ARSENKIN'
    AND credential."mode" = 'BYOK_API_KEY'
    AND credential."status" = 'ACTIVE'
    AND credential."deleted_at" IS NULL
    AND credential."version" = candidate."credential_version"
    AND credential."material_version" =
      candidate."credential_material_version"
    AND credential."verified_at" = candidate."credential_verified_at"
  FOR UPDATE OF credential;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:validation */
  PERFORM 1
  FROM public.jobs validation
  WHERE validation."workspace_id" = candidate."workspace_id"
    AND validation."id" = candidate."credential_validation_id"
    AND validation."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND validation."provider" = 'ARSENKIN'
    AND validation."credential_mode" = 'BYOK_API_KEY'
    AND validation."status" = 'COMPLETED'
    AND validation."version" =
      candidate."credential_validation_version"
    AND validation."input_snapshot" = jsonb_build_object(
      'kind', 'integration.credential.validation.v1',
      'credentialId', candidate."credential_id"::text,
      'credentialMaterialVersion',
        candidate."credential_material_version",
      'connectorVersion',
        candidate."credential_validation_connector_version"
    )
  FOR UPDATE OF validation;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:binding */
  PERFORM 1
  FROM public.project_connector_bindings binding
  WHERE binding."workspace_id" = candidate."workspace_id"
    AND binding."project_id" = candidate."project_id"
    AND binding."id" = candidate."binding_id"
    AND binding."capability" = 'SERP_RANK_TRACKING'
    AND binding."enabled"
    AND binding."version" = candidate."binding_version"
  FOR UPDATE OF binding;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:route */
  PERFORM 1
  FROM public.project_connector_routes route
  WHERE route."workspace_id" = candidate."workspace_id"
    AND route."project_id" = candidate."project_id"
    AND route."binding_id" = candidate."binding_id"
    AND route."id" = candidate."route_id"
    AND route."credential_id" = candidate."credential_id"
    AND route."position" = 0
    AND route."source_kind" = 'WORKSPACE_CREDENTIAL'
  FOR UPDATE OF route;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:grant */
  PERFORM 1
  FROM public.rank_execution_grant_attempts grant_attempt
  WHERE grant_attempt."id" = candidate."grant_attempt_id"
    AND grant_attempt."workspace_id" = candidate."workspace_id"
    AND grant_attempt."project_id" = candidate."project_id"
    AND grant_attempt."job_id" = candidate."job_id"
    AND grant_attempt."job_item_id" = candidate."job_item_id"
    AND grant_attempt."execution_attempt" =
      candidate."execution_attempt"
    AND grant_attempt."job_version" = candidate."job_version"
    AND grant_attempt."execution_evidence_hash" =
      candidate."execution_evidence_hash"
    AND grant_attempt."status" = 'CONSUMED'
    AND grant_attempt."expires_at" =
      candidate."authorization_expires_at"
  FOR UPDATE OF grant_attempt;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:execution */
  SELECT execution.*
  INTO current_execution
  FROM public.rank_connector_executions execution
  WHERE execution."id" = candidate."id"
    AND execution."version" = candidate."version"
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  /* rank-connector-claim:control */
  SELECT control.*
  INTO current_control
  FROM public.rank_connector_execution_controls control
  WHERE control."provider" = 'ARSENKIN'
    AND control."capability" = 'SERP_RANK_TRACKING'
  FOR SHARE OF control;
  IF NOT FOUND THEN RETURN; END IF;

  -- All potentially blocking locks are held. Re-read clock, execution state,
  -- exact control versions and the authoritative Job lifecycle before claim.
  v_claimed_at := clock_timestamp();
  v_claimed_lease_expires_at :=
    v_claimed_at + make_interval(secs => p_lease_seconds);

  IF NOT current_control."submit_enabled"
    OR current_control."execution_connector_version" <>
      p_execution_connector_version
    OR current_control."execution_connector_version" <>
      current_execution."execution_connector_version"
    OR current_control."provider_policy_version" <>
      current_execution."provider_policy_version"
    OR current_control."kill_switch_version" <>
      current_execution."kill_switch_version"
    OR current_execution."authorization_expires_at" <=
      v_claimed_lease_expires_at
    OR NOT (
      current_execution."status" = 'READY_TO_SUBMIT'
      OR (
        current_execution."status" = 'CLAIMED'
        AND current_execution."lease_expires_at" <= v_claimed_at
      )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.jobs job
      WHERE job."workspace_id" = current_execution."workspace_id"
        AND job."project_id" = current_execution."project_id"
        AND job."id" = current_execution."job_id"
        AND job."type" = 'MANUAL_RANK_CHECK'
        AND job."provider" = 'ARSENKIN'
        AND job."credential_mode" = 'BYOK_API_KEY'
        AND job."version" = current_execution."job_version"
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
    )
  THEN
    RETURN;
  END IF;

  v_claimed_lease_token := pg_catalog.uuidv7();

  UPDATE public.rank_connector_executions execution
  SET
    "status" = 'CLAIMED',
    "lease_owner" = p_lease_owner,
    "lease_token" = v_claimed_lease_token,
    "lease_expires_at" = v_claimed_lease_expires_at,
    "claimed_at" = v_claimed_at,
    "version" = execution."version" + 1,
    "updated_at" = v_claimed_at
  WHERE execution."id" = current_execution."id"
    AND execution."version" = current_execution."version";

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- CLAIMED is intentionally pre-network. A future authorize/SUBMITTING
  -- operation must re-check this lease and control before any provider bytes.
  RETURN QUERY
  SELECT
    current_execution."id",
    v_claimed_lease_token,
    v_claimed_lease_expires_at,
    current_credential."workspace_id",
    current_credential."provider",
    current_credential."id",
    current_credential."material_version",
    current_credential."ciphertext",
    current_credential."nonce",
    current_credential."auth_tag",
    current_credential."encrypted_data_key",
    current_credential."data_key_nonce",
    current_credential."data_key_auth_tag",
    current_credential."key_version";
END
$$;

REVOKE ALL ON FUNCTION
  "assert_rank_connector_execution_control_mutation"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "record_rank_connector_execution_control_insert"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "reject_rank_connector_execution_control_truncate"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "reject_rank_connector_execution_control_version_mutation"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "assert_rank_connector_execution_claim_transition"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "assert_rank_connector_execution_consumed_graph"()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  "claim_rank_connector_execution"(TEXT, INTEGER, TEXT)
  FROM PUBLIC;

COMMIT;

BEGIN;

DROP TRIGGER "rank_connector_execution_claim_transition_guard"
  ON public.rank_connector_executions;

ALTER TABLE public.rank_connector_executions
  DROP CONSTRAINT "rank_connector_executions_shape",
  ADD COLUMN "provider_task_id" VARCHAR(100),
  ADD COLUMN "provider_wire_request_snapshot" JSONB,
  ADD COLUMN "provider_wire_request_hash" BYTEA,
  ADD COLUMN "provider_submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN "poll_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_action_at" TIMESTAMPTZ(6),
  ADD COLUMN "observed_at" TIMESTAMPTZ(6),
  ADD COLUMN "normalized_result_snapshot" JSONB,
  ADD COLUMN "normalized_result_hash" BYTEA,
  ADD COLUMN "last_error_code" VARCHAR(100),
  ADD COLUMN "finished_at" TIMESTAMPTZ(6);

ALTER TABLE public.rank_connector_executions
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
    AND "lease_generation" BETWEEN 0 AND 2147483646
    AND "submit_attempt_count" BETWEEN 0 AND 1
    AND "poll_attempt_count" BETWEEN 0 AND 180
    AND (
      "provider_task_id" IS NULL
      OR "provider_task_id" ~ '^[A-Za-z0-9_-]{1,100}$'
    )
    AND (
      "provider_wire_request_hash" IS NULL
      OR octet_length("provider_wire_request_hash") = 32
    )
    AND (
      "normalized_result_hash" IS NULL
      OR octet_length("normalized_result_hash") = 32
    )
    AND (
      "last_error_code" IS NULL
      OR "last_error_code" ~ '^[A-Z0-9_]{1,100}$'
    )
    AND (
      (
        "status" = 'READY_TO_SUBMIT'
        AND "lease_owner" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "claimed_at" IS NULL
        AND "lease_generation" = 0
        AND "submit_attempt_count" = 0
        AND "submit_bytes_started_at" IS NULL
        AND "provider_wire_request_snapshot" IS NULL
        AND "provider_wire_request_hash" IS NULL
        AND "provider_task_id" IS NULL
        AND "provider_submitted_at" IS NULL
        AND "poll_attempt_count" = 0
        AND "next_action_at" IS NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
        AND "version" = 1
      )
      OR (
        "status" = 'CLAIMED'
        AND "lease_owner" IS NOT NULL
        AND "lease_owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "claimed_at" IS NOT NULL
        AND "lease_expires_at" > "claimed_at"
        AND "lease_expires_at" <= "authorization_expires_at"
        AND "claimed_at" >= "created_at"
        AND "lease_generation" >= 1
        AND "submit_attempt_count" = 0
        AND "submit_bytes_started_at" IS NULL
        AND "provider_wire_request_snapshot" IS NULL
        AND "provider_wire_request_hash" IS NULL
        AND "provider_task_id" IS NULL
        AND "provider_submitted_at" IS NULL
        AND "poll_attempt_count" = 0
        AND "next_action_at" IS NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
      )
      OR (
        "status" = 'SUBMITTING'
        AND "lease_owner" IS NOT NULL
        AND "lease_owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "claimed_at" IS NOT NULL
        AND "lease_expires_at" > "claimed_at"
        AND "lease_expires_at" <= "authorization_expires_at"
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" >= "claimed_at"
        AND "submit_bytes_started_at" < "lease_expires_at"
        AND "provider_wire_request_snapshot" IS NULL
        AND "provider_wire_request_hash" IS NULL
        AND "provider_task_id" IS NULL
        AND "provider_submitted_at" IS NULL
        AND "poll_attempt_count" = 0
        AND "next_action_at" IS NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
      )
      OR (
        "status" = 'POLL_WAIT'
        AND "lease_owner" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "claimed_at" IS NULL
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" IS NOT NULL
        AND "provider_wire_request_snapshot" IS NOT NULL
        AND "provider_wire_request_hash" IS NOT NULL
        AND "provider_task_id" IS NOT NULL
        AND "provider_submitted_at" IS NOT NULL
        AND "next_action_at" IS NOT NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
      )
      OR (
        "status" = 'FETCHING'
        AND "lease_owner" IS NOT NULL
        AND "lease_owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "claimed_at" IS NOT NULL
        AND "lease_expires_at" > "claimed_at"
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" IS NOT NULL
        AND "provider_wire_request_snapshot" IS NOT NULL
        AND "provider_wire_request_hash" IS NOT NULL
        AND "provider_task_id" IS NOT NULL
        AND "provider_submitted_at" IS NOT NULL
        AND "poll_attempt_count" BETWEEN 1 AND 180
        AND "next_action_at" IS NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
      )
      OR (
        "status" IN ('STAGED', 'PERSISTED')
        AND "lease_owner" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "claimed_at" IS NULL
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" IS NOT NULL
        AND "provider_wire_request_snapshot" IS NOT NULL
        AND "provider_wire_request_hash" IS NOT NULL
        AND "provider_task_id" IS NOT NULL
        AND "provider_submitted_at" IS NOT NULL
        AND "poll_attempt_count" BETWEEN 1 AND 180
        AND "next_action_at" IS NULL
        AND "observed_at" IS NOT NULL
        AND "normalized_result_snapshot" IS NOT NULL
        AND "normalized_result_hash" IS NOT NULL
        AND "last_error_code" IS NULL
        AND (
          ("status" = 'STAGED' AND "finished_at" IS NULL)
          OR
          ("status" = 'PERSISTED' AND "finished_at" IS NOT NULL)
        )
      )
      OR (
        "status" = 'PERSISTING'
        AND "lease_owner" IS NOT NULL
        AND "lease_owner" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
        AND "claimed_at" IS NOT NULL
        AND "lease_expires_at" > "claimed_at"
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" IS NOT NULL
        AND "provider_wire_request_snapshot" IS NOT NULL
        AND "provider_wire_request_hash" IS NOT NULL
        AND "provider_task_id" IS NOT NULL
        AND "provider_submitted_at" IS NOT NULL
        AND "poll_attempt_count" BETWEEN 1 AND 180
        AND "next_action_at" IS NULL
        AND "observed_at" IS NOT NULL
        AND "normalized_result_snapshot" IS NOT NULL
        AND "normalized_result_hash" IS NOT NULL
        AND "last_error_code" IS NULL
        AND "finished_at" IS NULL
      )
      OR (
        "status" IN (
          'SUBMIT_OUTCOME_UNKNOWN',
          'FAILED_RETRYABLE',
          'FAILED_FINAL'
        )
        AND "lease_owner" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
        AND "claimed_at" IS NULL
        AND "submit_attempt_count" = 1
        AND "submit_bytes_started_at" IS NOT NULL
        AND "provider_wire_request_snapshot" IS NOT NULL
        AND "provider_wire_request_hash" IS NOT NULL
        AND "next_action_at" IS NULL
        AND "observed_at" IS NULL
        AND "normalized_result_snapshot" IS NULL
        AND "normalized_result_hash" IS NULL
        AND "last_error_code" IS NOT NULL
        AND "finished_at" IS NOT NULL
      )
    )
  );

CREATE INDEX "rank_connector_executions_poll_due_idx"
  ON public.rank_connector_executions (
    "status",
    "next_action_at",
    "lease_expires_at",
    "created_at",
    "id"
  );

COMMENT ON COLUMN
  public.rank_connector_executions."provider_wire_request_snapshot"
IS
  'Private exact secret-free wire request. It must never enter public APIs, events, queues, metrics or logs.';
COMMENT ON COLUMN
  public.rank_connector_executions."normalized_result_snapshot"
IS
  'Private normalized staged result; raw provider response is deliberately never persisted.';

CREATE OR REPLACE FUNCTION
  public.assert_rank_connector_execution_claim_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF ROW(
    NEW."id", NEW."workspace_id", NEW."project_id", NEW."job_id",
    NEW."job_item_id", NEW."grant_attempt_id", NEW."execution_attempt",
    NEW."job_version", NEW."estimate_id", NEW."manifest_id",
    NEW."manifest_hash", NEW."manifest_chunk_index", NEW."binding_id",
    NEW."binding_version", NEW."route_id", NEW."credential_id",
    NEW."credential_version", NEW."credential_material_version",
    NEW."credential_validation_id", NEW."credential_validation_version",
    NEW."credential_validation_connector_version",
    NEW."credential_verified_at", NEW."estimate_execution_hash",
    NEW."execution_evidence_hash", NEW."execution_connector_version",
    NEW."provider_policy_version", NEW."kill_switch_version",
    NEW."authorization_expires_at", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."id", OLD."workspace_id", OLD."project_id", OLD."job_id",
    OLD."job_item_id", OLD."grant_attempt_id", OLD."execution_attempt",
    OLD."job_version", OLD."estimate_id", OLD."manifest_id",
    OLD."manifest_hash", OLD."manifest_chunk_index", OLD."binding_id",
    OLD."binding_version", OLD."route_id", OLD."credential_id",
    OLD."credential_version", OLD."credential_material_version",
    OLD."credential_validation_id", OLD."credential_validation_version",
    OLD."credential_validation_connector_version",
    OLD."credential_verified_at", OLD."estimate_execution_hash",
    OLD."execution_evidence_hash", OLD."execution_connector_version",
    OLD."provider_policy_version", OLD."kill_switch_version",
    OLD."authorization_expires_at", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (
    OLD."provider_task_id" IS NOT NULL
    AND NEW."provider_task_id" IS DISTINCT FROM OLD."provider_task_id"
  ) OR (
    OLD."provider_wire_request_snapshot" IS NOT NULL
    AND NEW."provider_wire_request_snapshot" IS DISTINCT FROM
      OLD."provider_wire_request_snapshot"
  ) OR (
    OLD."provider_wire_request_hash" IS NOT NULL
    AND NEW."provider_wire_request_hash" IS DISTINCT FROM
      OLD."provider_wire_request_hash"
  ) OR (
    OLD."normalized_result_snapshot" IS NOT NULL
    AND NEW."normalized_result_snapshot" IS DISTINCT FROM
      OLD."normalized_result_snapshot"
  ) OR (
    OLD."normalized_result_hash" IS NOT NULL
    AND NEW."normalized_result_hash" IS DISTINCT FROM
      OLD."normalized_result_hash"
  ) THEN
    RAISE EXCEPTION 'Rank connector provider evidence is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'CLAIMED' THEN
    NEW."lease_generation" := OLD."lease_generation" + 1;
    IF NEW."version" <> OLD."version" + 1
      OR NEW."updated_at" <> NEW."claimed_at"
      OR NEW."claimed_at" < OLD."updated_at"
      OR NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"
      OR NEW."submit_attempt_count" <> 0
      OR NEW."submit_bytes_started_at" IS NOT NULL
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
  END IF;

  IF NEW."status" = 'SUBMITTING' THEN
    IF OLD."status" <> 'CLAIMED'
      OR NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."submit_attempt_count" <> 1
      OR OLD."submit_attempt_count" <> 0
      OR OLD."submit_bytes_started_at" IS NOT NULL
      OR NEW."submit_bytes_started_at" IS NULL
      OR NEW."updated_at" <> NEW."submit_bytes_started_at"
      OR NEW."submit_bytes_started_at" < OLD."claimed_at"
      OR NEW."submit_bytes_started_at" >= OLD."lease_expires_at"
      OR NEW."submit_bytes_started_at" >= OLD."authorization_expires_at"
    THEN
      RAISE EXCEPTION
        'Invalid rank connector execution submit authorization transition'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'SUBMITTING'
    AND NEW."status" IN (
      'POLL_WAIT',
      'SUBMIT_OUTCOME_UNKNOWN',
      'FAILED_RETRYABLE',
      'FAILED_FINAL'
    )
  THEN
    IF NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."updated_at" < OLD."updated_at"
    THEN
      RAISE EXCEPTION 'Invalid rank connector submit completion'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'FETCHING' THEN
    NEW."lease_generation" := OLD."lease_generation" + 1;
    IF NEW."version" <> OLD."version" + 1
      OR NEW."poll_attempt_count" <> OLD."poll_attempt_count" + 1
      OR NEW."poll_attempt_count" > 180
      OR NEW."updated_at" <> NEW."claimed_at"
      OR NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"
      OR NOT (
        OLD."status" = 'POLL_WAIT'
        OR (
          OLD."status" = 'FETCHING'
          AND OLD."lease_expires_at" <= clock_timestamp()
        )
      )
    THEN
      RAISE EXCEPTION 'Invalid rank connector poll claim transition'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'FETCHING'
    AND NEW."status" IN ('POLL_WAIT', 'STAGED', 'FAILED_FINAL')
  THEN
    IF NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."poll_attempt_count" <> OLD."poll_attempt_count"
      OR NEW."updated_at" < OLD."updated_at"
    THEN
      RAISE EXCEPTION 'Invalid rank connector poll completion'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'STAGED' AND NEW."status" = 'PERSISTED' THEN
    IF NEW."version" <> OLD."version" + 1
      OR NEW."normalized_result_snapshot" IS DISTINCT FROM
        OLD."normalized_result_snapshot"
      OR NEW."normalized_result_hash" IS DISTINCT FROM
        OLD."normalized_result_hash"
      OR NEW."provider_task_id" IS DISTINCT FROM OLD."provider_task_id"
    THEN
      RAISE EXCEPTION 'Invalid rank connector persist completion'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" = 'PERSISTING' THEN
    NEW."lease_generation" := OLD."lease_generation" + 1;
    IF NEW."version" <> OLD."version" + 1
      OR NEW."updated_at" <> NEW."claimed_at"
      OR NEW."lease_token" IS NOT DISTINCT FROM OLD."lease_token"
      OR NOT (
        OLD."status" = 'STAGED'
        OR (
          OLD."status" = 'PERSISTING'
          AND OLD."lease_expires_at" <= clock_timestamp()
        )
      )
    THEN
      RAISE EXCEPTION 'Invalid rank result persistence claim'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PERSISTING'
    AND NEW."status" IN ('STAGED', 'PERSISTED')
  THEN
    IF NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."normalized_result_snapshot" IS DISTINCT FROM
        OLD."normalized_result_snapshot"
      OR NEW."normalized_result_hash" IS DISTINCT FROM
        OLD."normalized_result_hash"
      OR NEW."provider_task_id" IS DISTINCT FROM OLD."provider_task_id"
    THEN
      RAISE EXCEPTION 'Invalid rank result persistence completion'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid rank connector execution lifecycle transition'
    USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER "rank_connector_execution_claim_transition_guard"
  BEFORE UPDATE ON public.rank_connector_executions
  FOR EACH ROW
  EXECUTE FUNCTION
    public.assert_rank_connector_execution_claim_transition();

CREATE FUNCTION public.read_rank_connector_submit_request(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER
)
RETURNS TABLE (
  "executionId" UUID,
  "workspaceId" UUID,
  "requestSnapshot" JSONB,
  "requestHash" BYTEA
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    execution."id",
    execution."workspace_id",
    intent."request_snapshot",
    intent."request_hash"
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" =
      execution."provider_request_intent_hash"
    AND intent."manifest_id" = execution."manifest_id"
    AND intent."manifest_hash" = execution."manifest_hash"
    AND intent."manifest_chunk_index" =
      execution."manifest_chunk_index"
    AND intent."manifest_chunk_hash" =
      execution."provider_request_intent_chunk_hash"
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'CLAIMED'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."lease_expires_at" > clock_timestamp()
    AND execution."authorization_expires_at" > clock_timestamp()
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_items item
      LEFT JOIN public.rank_connector_executions sibling
        ON sibling."workspace_id" = item."workspace_id"
        AND sibling."project_id" = item."project_id"
        AND sibling."job_id" = item."job_id"
        AND sibling."job_item_id" = item."id"
      WHERE item."workspace_id" = execution."workspace_id"
        AND item."project_id" = execution."project_id"
        AND item."job_id" = execution."job_id"
        AND item."status" = 'QUEUED'
        AND sibling."id" IS NULL
    )
$$;

CREATE FUNCTION public.claim_rank_connector_submit_bounded(
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
  "keyVersion" INTEGER,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- The provider permits at most five simultaneous tasks. Count claims and
  -- authorized-but-not-yet-recorded submits as occupied slots too, so
  -- concurrent workers cannot oversubscribe the remote account.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('seo-platform:arsenkin-rank-submit', 0)
  ) THEN
    RETURN;
  END IF;

  IF (
    SELECT count(*)
    FROM public.rank_connector_executions execution
    WHERE execution."status" IN (
      'CLAIMED', 'SUBMITTING', 'POLL_WAIT', 'FETCHING'
    )
  ) >= 5 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_rank_connector_execution(
    p_lease_owner,
    p_lease_seconds,
    p_execution_connector_version
  );
END
$$;

CREATE FUNCTION public.complete_rank_connector_submit(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER,
  p_outcome TEXT,
  p_provider_task_id TEXT,
  p_wire_request_snapshot JSONB,
  p_wire_request_hash BYTEA,
  p_error_code TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "status" public."RankConnectorExecutionStatus",
  "executionVersion" INTEGER,
  "providerTaskId" TEXT,
  "nextActionAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_status public."RankConnectorExecutionStatus";
BEGIN
  IF p_outcome NOT IN (
      'ACCEPTED', 'OUTCOME_UNKNOWN', 'RETRYABLE_FAILURE', 'REJECTED'
    )
    OR p_wire_request_snapshot IS NULL
    OR p_wire_request_hash IS NULL
    OR octet_length(p_wire_request_hash) <> 32
    OR (
      p_outcome = 'ACCEPTED'
      AND (
        p_provider_task_id IS NULL
        OR p_provider_task_id !~ '^[A-Za-z0-9_-]{1,100}$'
        OR p_error_code IS NOT NULL
      )
    )
    OR (
      p_outcome <> 'ACCEPTED'
      AND (
        p_provider_task_id IS NOT NULL
        OR p_error_code IS NULL
        OR p_error_code !~ '^[A-Z0-9_]{1,100}$'
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid rank connector submit result'
      USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_outcome
    WHEN 'ACCEPTED' THEN 'POLL_WAIT'
    WHEN 'OUTCOME_UNKNOWN' THEN 'SUBMIT_OUTCOME_UNKNOWN'
    WHEN 'RETRYABLE_FAILURE' THEN 'FAILED_RETRYABLE'
    ELSE 'FAILED_FINAL'
  END;

  RETURN QUERY
  UPDATE public.rank_connector_executions execution
  SET
    "status" = v_status,
    "lease_owner" = NULL,
    "lease_token" = NULL,
    "lease_expires_at" = NULL,
    "claimed_at" = NULL,
    "provider_task_id" = p_provider_task_id,
    "provider_wire_request_snapshot" = p_wire_request_snapshot,
    "provider_wire_request_hash" = p_wire_request_hash,
    "provider_submitted_at" =
      CASE WHEN p_outcome = 'ACCEPTED' THEN v_now ELSE NULL END,
    "next_action_at" =
      CASE
        WHEN p_outcome = 'ACCEPTED' THEN v_now + interval '5 seconds'
        ELSE NULL
      END,
    "last_error_code" = p_error_code,
    "finished_at" =
      CASE WHEN p_outcome = 'ACCEPTED' THEN NULL ELSE v_now END,
    "version" = execution."version" + 1,
    "updated_at" = v_now
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'SUBMITTING'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
  RETURNING
    execution."id",
    execution."status",
    execution."version",
    execution."provider_task_id"::TEXT,
    execution."next_action_at";
END
$$;

CREATE FUNCTION public.claim_rank_connector_poll(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID,
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER,
  "providerTaskId" TEXT,
  "requestSnapshot" JSONB,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_token UUID;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
    OR p_lease_seconds NOT BETWEEN 5 AND 25
    OR p_execution_connector_version IS NULL
    OR p_execution_connector_version !~
      '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector poll claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job."workspace_id" = execution."workspace_id"
    AND job."project_id" = execution."project_id"
    AND job."id" = execution."job_id"
  JOIN public.rank_connector_execution_controls control
    ON control."provider" = 'ARSENKIN'
    AND control."capability" = 'SERP_RANK_TRACKING'
  JOIN public.integration_credentials credential
    ON credential."workspace_id" = execution."workspace_id"
    AND credential."id" = execution."credential_id"
  WHERE execution."execution_connector_version" =
      p_execution_connector_version
    AND control."execution_connector_version" =
      p_execution_connector_version
    AND control."provider_policy_version" =
      execution."provider_policy_version"
    AND control."kill_switch_version" = execution."kill_switch_version"
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = 'ARSENKIN'
    AND job."status" = 'RUNNING'
    AND job."stage" = 'WAITING_EXECUTION_GRANT'
    AND job."version" = execution."job_version"
    AND credential."provider" = 'ARSENKIN'
    AND credential."material_version" =
      execution."credential_material_version"
    AND credential."ciphertext" IS NOT NULL
    AND execution."poll_attempt_count" < 180
    AND (
      (
        execution."status" = 'POLL_WAIT'
        AND execution."next_action_at" <= clock_timestamp()
      )
      OR (
        execution."status" = 'FETCHING'
        AND execution."lease_expires_at" <= clock_timestamp()
      )
    )
  ORDER BY
    execution."next_action_at" NULLS FIRST,
    execution."created_at",
    execution."id"
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  v_now := clock_timestamp();
  v_token := pg_catalog.uuidv7();
  v_expiry := v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.rank_connector_executions execution
  SET
    "status" = 'FETCHING',
    "lease_owner" = p_lease_owner,
    "lease_token" = v_token,
    "lease_expires_at" = v_expiry,
    "claimed_at" = v_now,
    "poll_attempt_count" = execution."poll_attempt_count" + 1,
    "next_action_at" = NULL,
    "version" = execution."version" + 1,
    "updated_at" = v_now
  WHERE execution."id" = candidate."id"
    AND execution."version" = candidate."version";

  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    execution."id",
    v_token,
    v_expiry,
    credential."workspace_id",
    credential."id",
    credential."material_version",
    credential."ciphertext",
    credential."nonce",
    credential."auth_tag",
    credential."encrypted_data_key",
    credential."data_key_nonce",
    credential."data_key_auth_tag",
    credential."key_version",
    execution."provider_task_id"::TEXT,
    intent."request_snapshot",
    execution."lease_generation",
    execution."version"
  FROM public.rank_connector_executions execution
  JOIN public.integration_credentials credential
    ON credential."workspace_id" = execution."workspace_id"
    AND credential."id" = execution."credential_id"
  JOIN public.rank_provider_request_intents intent
    ON intent."id" = execution."provider_request_intent_id"
    AND intent."workspace_id" = execution."workspace_id"
    AND intent."request_hash" =
      execution."provider_request_intent_hash"
  WHERE execution."id" = candidate."id"
    AND execution."lease_token" = v_token
    AND execution."status" = 'FETCHING';
END
$$;

CREATE FUNCTION public.complete_rank_connector_poll(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER,
  p_outcome TEXT,
  p_retry_after_seconds INTEGER,
  p_observed_at TIMESTAMPTZ,
  p_normalized_result_snapshot JSONB,
  p_normalized_result_hash BYTEA,
  p_error_code TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "status" public."RankConnectorExecutionStatus",
  "executionVersion" INTEGER,
  "nextActionAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_execution public.rank_connector_executions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_status public."RankConnectorExecutionStatus";
  v_delay INTEGER;
BEGIN
  SELECT execution.*
  INTO current_execution
  FROM public.rank_connector_executions execution
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'FETCHING'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_outcome NOT IN ('PENDING', 'READY', 'RETRYABLE_FAILURE', 'REJECTED')
  THEN
    RAISE EXCEPTION 'Invalid rank connector poll result'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'READY' THEN
    IF p_observed_at IS NULL
      OR p_normalized_result_snapshot IS NULL
      OR p_normalized_result_hash IS NULL
      OR octet_length(p_normalized_result_hash) <> 32
      OR p_retry_after_seconds IS NOT NULL
      OR p_error_code IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid ready rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status := 'STAGED';
  ELSIF p_outcome = 'REJECTED' THEN
    IF p_error_code IS NULL
      OR p_error_code !~ '^[A-Z0-9_]{1,100}$'
      OR p_observed_at IS NOT NULL
      OR p_normalized_result_snapshot IS NOT NULL
      OR p_normalized_result_hash IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid rejected rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status := 'FAILED_FINAL';
  ELSE
    IF p_observed_at IS NOT NULL
      OR p_normalized_result_snapshot IS NOT NULL
      OR p_normalized_result_hash IS NOT NULL
      OR (
        p_outcome = 'PENDING'
        AND p_error_code IS NOT NULL
      )
      OR (
        p_outcome = 'RETRYABLE_FAILURE'
        AND (
          p_error_code IS NULL
          OR p_error_code !~ '^[A-Z0-9_]{1,100}$'
        )
      )
    THEN
      RAISE EXCEPTION 'Invalid pending rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status :=
      CASE
        WHEN current_execution."poll_attempt_count" >= 180
          THEN 'FAILED_FINAL'
        ELSE 'POLL_WAIT'
      END;
  END IF;

  v_delay := LEAST(GREATEST(COALESCE(p_retry_after_seconds, 10), 5), 3600);

  RETURN QUERY
  UPDATE public.rank_connector_executions execution
  SET
    "status" = v_status,
    "lease_owner" = NULL,
    "lease_token" = NULL,
    "lease_expires_at" = NULL,
    "claimed_at" = NULL,
    "next_action_at" =
      CASE
        WHEN v_status = 'POLL_WAIT'
          THEN v_now + make_interval(secs => v_delay)
        ELSE NULL
      END,
    "observed_at" =
      CASE WHEN v_status = 'STAGED' THEN p_observed_at ELSE NULL END,
    "normalized_result_snapshot" =
      CASE
        WHEN v_status = 'STAGED' THEN p_normalized_result_snapshot
        ELSE NULL
      END,
    "normalized_result_hash" =
      CASE
        WHEN v_status = 'STAGED' THEN p_normalized_result_hash
        ELSE NULL
      END,
    "last_error_code" =
      CASE
        WHEN v_status = 'FAILED_FINAL'
          THEN COALESCE(p_error_code, 'PROVIDER_POLL_TIMEOUT')
        ELSE NULL
      END,
    "finished_at" =
      CASE WHEN v_status = 'FAILED_FINAL' THEN v_now ELSE NULL END,
    "version" = execution."version" + 1,
    "updated_at" = v_now
  WHERE execution."id" = current_execution."id"
    AND execution."version" = current_execution."version"
  RETURNING
    execution."id",
    execution."status",
    execution."version",
    execution."next_action_at";
END
$$;

CREATE FUNCTION public.claim_rank_staged_result(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER,
  "workspaceId" UUID,
  "projectId" UUID,
  "jobId" UUID,
  "jobItemId" UUID,
  "manifestId" UUID,
  "manifestChunkIndex" INTEGER,
  "manifestChunkHash" BYTEA,
  "requestSnapshot" JSONB,
  "normalizedResultSnapshot" JSONB,
  "normalizedResultHash" BYTEA
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  candidate public.rank_connector_executions%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_token UUID;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
    OR p_lease_seconds NOT BETWEEN 10 AND 300
  THEN
    RAISE EXCEPTION 'Invalid rank persistence claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job."workspace_id" = execution."workspace_id"
    AND job."project_id" = execution."project_id"
    AND job."id" = execution."job_id"
  WHERE job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = 'ARSENKIN'
    AND job."status" = 'RUNNING'
    AND job."stage" = 'WAITING_EXECUTION_GRANT'
    AND job."version" = execution."job_version"
    AND (
      execution."status" = 'STAGED'
      OR (
        execution."status" = 'PERSISTING'
        AND execution."lease_expires_at" <= clock_timestamp()
      )
    )
  ORDER BY execution."created_at", execution."id"
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_now := clock_timestamp();
  v_token := pg_catalog.uuidv7();
  v_expiry := v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.rank_connector_executions execution
  SET
    "status" = 'PERSISTING',
    "lease_owner" = p_lease_owner,
    "lease_token" = v_token,
    "lease_expires_at" = v_expiry,
    "claimed_at" = v_now,
    "version" = execution."version" + 1,
    "updated_at" = v_now
  WHERE execution."id" = candidate."id"
    AND execution."version" = candidate."version";
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    execution."id",
    execution."lease_token",
    execution."lease_expires_at",
    execution."lease_generation",
    execution."version",
    execution."workspace_id",
    execution."project_id",
    execution."job_id",
    execution."job_item_id",
    execution."manifest_id",
    execution."manifest_chunk_index",
    execution."provider_request_intent_chunk_hash",
    intent."request_snapshot",
    execution."normalized_result_snapshot",
    execution."normalized_result_hash"
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" =
      execution."provider_request_intent_hash"
  WHERE execution."id" = candidate."id"
    AND execution."lease_token" = v_token
    AND execution."status" = 'PERSISTING';
END
$$;

CREATE FUNCTION public.complete_rank_staged_result(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER,
  p_persisted BOOLEAN
)
RETURNS TABLE (
  "executionId" UUID,
  "status" public."RankConnectorExecutionStatus",
  "executionVersion" INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE public.rank_connector_executions execution
  SET
    "status" =
      CASE
        WHEN p_persisted THEN 'PERSISTED'
        ELSE 'STAGED'
      END::public."RankConnectorExecutionStatus",
    "lease_owner" = NULL,
    "lease_token" = NULL,
    "lease_expires_at" = NULL,
    "claimed_at" = NULL,
    "finished_at" =
      CASE WHEN p_persisted THEN clock_timestamp() ELSE NULL END,
    "version" = execution."version" + 1,
    "updated_at" = clock_timestamp()
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'PERSISTING'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
  RETURNING execution."id", execution."status", execution."version"
$$;

REVOKE ALL ON FUNCTION
  public.read_rank_connector_submit_request(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_rank_connector_submit(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, JSONB, BYTEA, TEXT
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_connector_poll(TEXT, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_rank_connector_poll(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER,
    TIMESTAMPTZ, JSONB, BYTEA, TEXT
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_staged_result(TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_rank_staged_result(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER, BOOLEAN
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.assert_rank_connector_execution_claim_transition()
  FROM PUBLIC;

COMMIT;

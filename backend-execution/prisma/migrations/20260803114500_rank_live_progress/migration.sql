BEGIN;

CREATE OR REPLACE FUNCTION public.protect_manual_rank_job_identity()
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

  -- Live progress is a derived monotonic projection. It deliberately keeps
  -- the Job version stable so already granted connector executions retain
  -- their exact job_version binding.
  IF OLD."type" = 'MANUAL_RANK_CHECK'
    AND OLD."status" IN ('RUNNING', 'CANCEL_REQUESTED')
    AND NEW."version" = OLD."version"
    AND NEW."progress_current" > OLD."progress_current"
    AND NEW."progress_current" <= NEW."progress_total"
    AND (
      to_jsonb(NEW) - 'progress_current' - 'updated_at'
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - 'progress_current' - 'updated_at'
    )
  THEN
    RETURN NEW;
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

CREATE OR REPLACE FUNCTION public.complete_rank_staged_result(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_project_id UUID;
  v_job_id UUID;
  v_keyword_count INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_execution public.rank_connector_executions%ROWTYPE;
BEGIN
  SELECT
    execution."project_id",
    execution."job_id",
    CASE
      WHEN jsonb_typeof(intent."request_snapshot"->'keywords') = 'array'
        THEN jsonb_array_length(intent."request_snapshot"->'keywords')
      ELSE NULL
    END
  INTO v_project_id, v_job_id, v_keyword_count
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" = execution."provider_request_intent_hash"
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id;

  IF v_job_id IS NULL OR v_keyword_count NOT BETWEEN 1 AND 15000 THEN
    RETURN;
  END IF;

  -- Preserve the canonical lifecycle lock order: parent Job before execution.
  PERFORM 1
  FROM public.jobs job
  WHERE job."workspace_id" = p_workspace_id
    AND job."project_id" = v_project_id
    AND job."id" = v_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

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
    "finished_at" = CASE WHEN p_persisted THEN v_now ELSE NULL END,
    "version" = execution."version" + 1,
    "updated_at" = v_now
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."project_id" = v_project_id
    AND execution."job_id" = v_job_id
    AND execution."id" = p_execution_id
    AND execution."status" = 'PERSISTING'
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
  RETURNING execution.* INTO v_execution;

  IF v_execution."id" IS NULL THEN
    RETURN;
  END IF;

  IF p_persisted THEN
    UPDATE public.jobs job
    SET
      "progress_current" = LEAST(
        job."progress_total",
        job."progress_current" + v_keyword_count
      ),
      "updated_at" = v_now
    WHERE job."workspace_id" = p_workspace_id
      AND job."project_id" = v_project_id
      AND job."id" = v_job_id
      AND job."type" = 'MANUAL_RANK_CHECK'
      AND job."status" IN ('RUNNING', 'CANCEL_REQUESTED')
      AND job."progress_total" IS NOT NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rank progress parent is not mutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_execution."id",
    v_execution."status",
    v_execution."version";
END
$$;

-- Existing running operations are reconciled from the idempotent persisted
-- execution set so the UI becomes accurate immediately after this migration.
WITH persisted_progress AS (
  SELECT
    execution."workspace_id",
    execution."project_id",
    execution."job_id",
    SUM(
      CASE
        WHEN jsonb_typeof(intent."request_snapshot"->'keywords') = 'array'
          THEN jsonb_array_length(intent."request_snapshot"->'keywords')
        ELSE 0
      END
    )::INTEGER AS "keyword_count"
  FROM public.rank_connector_executions execution
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" = execution."provider_request_intent_hash"
  WHERE execution."status" = 'PERSISTED'
  GROUP BY
    execution."workspace_id",
    execution."project_id",
    execution."job_id"
)
UPDATE public.jobs job
SET
  "progress_current" = LEAST(
    job."progress_total",
    persisted_progress."keyword_count"
  ),
  "updated_at" = clock_timestamp()
FROM persisted_progress
WHERE job."workspace_id" = persisted_progress."workspace_id"
  AND job."project_id" = persisted_progress."project_id"
  AND job."id" = persisted_progress."job_id"
  AND job."type" = 'MANUAL_RANK_CHECK'
  AND job."status" IN ('RUNNING', 'CANCEL_REQUESTED')
  AND job."progress_total" IS NOT NULL
  AND job."progress_current" < LEAST(
    job."progress_total",
    persisted_progress."keyword_count"
  );

REVOKE ALL ON FUNCTION
  public.protect_manual_rank_job_identity()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_rank_staged_result(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER, BOOLEAN
  )
  FROM PUBLIC;

COMMIT;

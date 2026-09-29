BEGIN;

-- A result batch is scoped to one Job. Locking its parent once preserves the
-- existing lock order while avoiding one hot Job update per keyword.
CREATE FUNCTION public.complete_rank_staged_results_batch(
  p_workspace_id UUID,
  p_job_id UUID,
  p_claims JSONB,
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
  v_expected_count INTEGER;
  v_valid_count INTEGER;
  v_keyword_count BIGINT;
  v_completed JSONB;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_workspace_id IS NULL OR p_job_id IS NULL
    OR jsonb_typeof(p_claims) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_claims) NOT BETWEEN 1 AND 16
    OR p_persisted IS NULL
  THEN
    RAISE EXCEPTION 'Invalid rank result batch'
      USING ERRCODE = '22023';
  END IF;
  v_expected_count := jsonb_array_length(p_claims);

  SELECT job."project_id"
  INTO v_project_id
  FROM public.jobs job
  WHERE job."workspace_id" = p_workspace_id
    AND job."id" = p_job_id
    AND job."type" = 'MANUAL_RANK_CHECK'
  FOR UPDATE;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Rank result batch lease lost'
      USING ERRCODE = '55000';
  END IF;

  WITH claims AS (
    SELECT *
    FROM jsonb_to_recordset(p_claims) AS claim(
      "executionId" UUID,
      "leaseOwner" TEXT,
      "leaseToken" UUID,
      "leaseGeneration" INTEGER,
      "executionVersion" INTEGER
    )
  )
  SELECT count(*)::integer,
    coalesce(sum(jsonb_array_length(intent."request_snapshot"->'keywords')), 0)
  INTO v_valid_count, v_keyword_count
  FROM claims claim
  JOIN public.rank_connector_executions execution
    ON execution."id" = claim."executionId"
    AND execution."workspace_id" = p_workspace_id
    AND execution."project_id" = v_project_id
    AND execution."job_id" = p_job_id
    AND execution."status" = 'PERSISTING'
    AND execution."lease_owner" = claim."leaseOwner"
    AND execution."lease_token" = claim."leaseToken"
    AND execution."lease_generation" = claim."leaseGeneration"
    AND execution."version" = claim."executionVersion"
  JOIN public.rank_provider_request_intents intent
    ON intent."workspace_id" = execution."workspace_id"
    AND intent."project_id" = execution."project_id"
    AND intent."job_id" = execution."job_id"
    AND intent."job_item_id" = execution."job_item_id"
    AND intent."id" = execution."provider_request_intent_id"
    AND intent."request_hash" = execution."provider_request_intent_hash"
  WHERE CASE
    WHEN jsonb_typeof(intent."request_snapshot"->'keywords') = 'array'
      THEN jsonb_array_length(intent."request_snapshot"->'keywords')
    ELSE 0
  END BETWEEN 1 AND 15000;

  IF v_valid_count <> v_expected_count THEN
    RAISE EXCEPTION 'Rank result batch lease lost'
      USING ERRCODE = '55000';
  END IF;

  WITH claims AS (
    SELECT *
    FROM jsonb_to_recordset(p_claims) AS claim(
      "executionId" UUID,
      "leaseOwner" TEXT,
      "leaseToken" UUID,
      "leaseGeneration" INTEGER,
      "executionVersion" INTEGER
    )
  ), updated AS (
    UPDATE public.rank_connector_executions execution
    SET
      "status" = CASE WHEN p_persisted THEN 'PERSISTED'
        ELSE 'STAGED' END::public."RankConnectorExecutionStatus",
      "lease_owner" = NULL,
      "lease_token" = NULL,
      "lease_expires_at" = NULL,
      "claimed_at" = NULL,
      "finished_at" = CASE WHEN p_persisted THEN v_now ELSE NULL END,
      "version" = execution."version" + 1,
      "updated_at" = v_now
    FROM claims claim
    WHERE execution."id" = claim."executionId"
      AND execution."workspace_id" = p_workspace_id
      AND execution."project_id" = v_project_id
      AND execution."job_id" = p_job_id
      AND execution."status" = 'PERSISTING'
      AND execution."lease_owner" = claim."leaseOwner"
      AND execution."lease_token" = claim."leaseToken"
      AND execution."lease_generation" = claim."leaseGeneration"
      AND execution."version" = claim."executionVersion"
    RETURNING execution."id", execution."version"
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'executionId', updated."id",
    'executionVersion', updated."version"
  )), '[]'::jsonb)
  INTO v_completed
  FROM updated;

  IF jsonb_array_length(v_completed) <> v_expected_count THEN
    RAISE EXCEPTION 'Rank result batch lease lost'
      USING ERRCODE = '55000';
  END IF;

  IF p_persisted THEN
    UPDATE public.jobs job
    SET
      "progress_current" = LEAST(
        job."progress_total",
        job."progress_current" + v_keyword_count::integer
      ),
      "updated_at" = v_now
    WHERE job."workspace_id" = p_workspace_id
      AND job."project_id" = v_project_id
      AND job."id" = p_job_id
      AND job."type" = 'MANUAL_RANK_CHECK'
      AND job."status" IN ('RUNNING', 'CANCEL_REQUESTED')
      AND job."progress_total" IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rank progress parent is not mutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    (value->>'executionId')::uuid,
    CASE WHEN p_persisted THEN 'PERSISTED'
      ELSE 'STAGED' END::public."RankConnectorExecutionStatus",
    (value->>'executionVersion')::integer
  FROM jsonb_array_elements(v_completed) AS value;
END
$$;

REVOKE ALL ON FUNCTION public.complete_rank_staged_results_batch(
  UUID, UUID, JSONB, BOOLEAN
) FROM PUBLIC;

COMMIT;

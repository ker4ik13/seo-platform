BEGIN;

-- Result persistence used to be a global FIFO by execution.created_at. A
-- large older Job therefore kept every newer Job in STAGED until the older
-- Job had been fully ingested. Serialize only the short claim decision and
-- choose the least-served workspace/Job before taking the oldest chunk inside
-- that Job. Provider HTTP and SEO Data ingest remain outside this lock.
CREATE OR REPLACE FUNCTION public.claim_rank_staged_result(
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

  BEGIN
    PERFORM set_config('lock_timeout', '2000ms', TRUE);
    PERFORM pg_advisory_xact_lock(
      hashtextextended('seo-platform:rank-result-persistence', 0)
    );
  EXCEPTION
    WHEN lock_not_available THEN RETURN;
  END;

  WITH candidate_jobs AS MATERIALIZED (
    SELECT
      job."workspace_id",
      job."project_id",
      job."id" AS "job_id",
      job."version" AS "job_version",
      job."created_at",
      job."updated_at",
      (
        SELECT COUNT(*)::BIGINT
        FROM public.rank_connector_executions active_execution
        WHERE active_execution."workspace_id" = job."workspace_id"
          AND active_execution."project_id" = job."project_id"
          AND active_execution."job_id" = job."id"
          AND active_execution."job_version" = job."version"
          AND active_execution."status" = 'PERSISTING'
          AND active_execution."lease_expires_at" > clock_timestamp()
      ) AS "active_count"
    FROM public.jobs job
    WHERE job."type" = 'MANUAL_RANK_CHECK'
      AND job."status" = 'RUNNING'
      AND job."stage" = 'WAITING_EXECUTION_GRANT'
      AND EXISTS (
        SELECT 1
        FROM public.rank_connector_executions eligible_execution
        WHERE eligible_execution."workspace_id" = job."workspace_id"
          AND eligible_execution."project_id" = job."project_id"
          AND eligible_execution."job_id" = job."id"
          AND eligible_execution."job_version" = job."version"
          AND eligible_execution."provider" = job."provider"
          AND (
            eligible_execution."status" = 'STAGED'
            OR (
              eligible_execution."status" = 'PERSISTING'
              AND eligible_execution."lease_expires_at" <= clock_timestamp()
            )
          )
      )
  ),
  fair_jobs AS MATERIALIZED (
    SELECT
      candidate_job.*,
      SUM(candidate_job."active_count") OVER (
        PARTITION BY candidate_job."workspace_id"
      ) AS "workspace_active_count",
      MAX(candidate_job."updated_at") OVER (
        PARTITION BY candidate_job."workspace_id"
      ) AS "workspace_last_progress_at"
    FROM candidate_jobs candidate_job
  ),
  selected_job AS MATERIALIZED (
    SELECT fair_job.*
    FROM fair_jobs fair_job
    ORDER BY
      fair_job."workspace_active_count",
      fair_job."workspace_last_progress_at",
      fair_job."active_count",
      fair_job."updated_at",
      fair_job."created_at",
      fair_job."job_id"
    LIMIT 1
  )
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN selected_job selected
    ON selected."workspace_id" = execution."workspace_id"
    AND selected."project_id" = execution."project_id"
    AND selected."job_id" = execution."job_id"
    AND selected."job_version" = execution."job_version"
  WHERE (
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
    AND intent."request_hash" = execution."provider_request_intent_hash"
  WHERE execution."id" = candidate."id"
    AND execution."lease_token" = v_token
    AND execution."status" = 'PERSISTING';
END
$$;

REVOKE ALL ON FUNCTION
  public.claim_rank_staged_result(TEXT, INTEGER)
  FROM PUBLIC;

COMMIT;

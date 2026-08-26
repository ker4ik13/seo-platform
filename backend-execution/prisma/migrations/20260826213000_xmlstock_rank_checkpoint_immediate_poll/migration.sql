BEGIN;

-- A completed Live page is not provider-side pending work.  The next page is
-- a separate GET and may be claimed immediately; Redis still applies the
-- credential/product RPS and concurrency policy around the actual HTTP call.
CREATE OR REPLACE FUNCTION public.complete_rank_connector_poll(
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
  p_error_code TEXT,
  p_provider_progress_snapshot JSONB,
  p_provider_progress_hash BYTEA
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
  WHERE execution.workspace_id = p_workspace_id
    AND execution.id = p_execution_id
    AND execution.status = 'FETCHING'
    AND execution.lease_owner = p_lease_owner
    AND execution.lease_token = p_lease_token
    AND execution.lease_generation = p_lease_generation
    AND execution.version = p_expected_version
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_outcome NOT IN (
    'PENDING', 'CHECKPOINTED', 'READY', 'RETRYABLE_FAILURE', 'REJECTED'
  ) THEN
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
      OR p_provider_progress_snapshot IS NOT NULL
      OR p_provider_progress_hash IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid ready rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status := 'STAGED';
  ELSIF p_outcome = 'CHECKPOINTED' THEN
    IF current_execution.provider <> 'XMLSTOCK'
      OR p_provider_progress_snapshot IS NULL
      OR p_provider_progress_hash IS NULL
      OR octet_length(p_provider_progress_hash) <> 32
      OR p_retry_after_seconds IS NOT NULL
      OR p_observed_at IS NOT NULL
      OR p_normalized_result_snapshot IS NOT NULL
      OR p_normalized_result_hash IS NOT NULL
      OR p_error_code IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid rank connector page checkpoint'
        USING ERRCODE = '22023';
    END IF;
    v_status := CASE
      WHEN current_execution.poll_attempt_count >= 720 THEN 'FAILED_FINAL'
      ELSE 'POLL_WAIT'
    END;
  ELSIF p_outcome = 'REJECTED' THEN
    IF p_error_code IS NULL
      OR p_error_code !~ '^[A-Z0-9_]{1,100}$'
      OR p_observed_at IS NOT NULL
      OR p_normalized_result_snapshot IS NOT NULL
      OR p_normalized_result_hash IS NOT NULL
      OR p_provider_progress_snapshot IS NOT NULL
      OR p_provider_progress_hash IS NOT NULL
    THEN
      RAISE EXCEPTION 'Invalid rejected rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status := 'FAILED_FINAL';
  ELSE
    IF p_observed_at IS NOT NULL
      OR p_normalized_result_snapshot IS NOT NULL
      OR p_normalized_result_hash IS NOT NULL
      OR p_provider_progress_snapshot IS NOT NULL
      OR p_provider_progress_hash IS NOT NULL
      OR (p_outcome = 'PENDING' AND p_error_code IS NOT NULL)
      OR (
        p_outcome = 'RETRYABLE_FAILURE'
        AND (p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,100}$')
      )
    THEN
      RAISE EXCEPTION 'Invalid pending rank connector result'
        USING ERRCODE = '22023';
    END IF;
    v_status := CASE
      WHEN current_execution.poll_attempt_count >= 720 THEN 'FAILED_FINAL'
      ELSE 'POLL_WAIT'
    END;
  END IF;

  v_delay := LEAST(
    GREATEST(COALESCE(p_retry_after_seconds, 10), 5),
    3600
  );

  RETURN QUERY
  UPDATE public.rank_connector_executions execution
  SET status = v_status,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      next_action_at = CASE
        WHEN v_status = 'POLL_WAIT' AND p_outcome = 'CHECKPOINTED'
          THEN v_now
        WHEN v_status = 'POLL_WAIT'
          THEN v_now + make_interval(secs => v_delay)
        ELSE NULL
      END,
      provider_progress_snapshot = CASE
        WHEN p_outcome = 'CHECKPOINTED' THEN p_provider_progress_snapshot
        WHEN v_status = 'POLL_WAIT' THEN execution.provider_progress_snapshot
        ELSE NULL
      END,
      provider_progress_hash = CASE
        WHEN p_outcome = 'CHECKPOINTED' THEN p_provider_progress_hash
        WHEN v_status = 'POLL_WAIT' THEN execution.provider_progress_hash
        ELSE NULL
      END,
      observed_at = CASE WHEN v_status = 'STAGED' THEN p_observed_at ELSE NULL END,
      normalized_result_snapshot = CASE
        WHEN v_status = 'STAGED' THEN p_normalized_result_snapshot
        ELSE NULL
      END,
      normalized_result_hash = CASE
        WHEN v_status = 'STAGED' THEN p_normalized_result_hash
        ELSE NULL
      END,
      last_error_code = CASE
        WHEN v_status = 'FAILED_FINAL'
          THEN COALESCE(p_error_code, 'PROVIDER_POLL_TIMEOUT')
        ELSE NULL
      END,
      finished_at = CASE WHEN v_status = 'FAILED_FINAL' THEN v_now ELSE NULL END,
      version = execution.version + 1,
      updated_at = v_now
  WHERE execution.id = current_execution.id
    AND execution.version = current_execution.version
  RETURNING execution.id, execution.status, execution.version, execution.next_action_at;
END
$$;

REVOKE ALL ON FUNCTION public.complete_rank_connector_poll(
  UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER,
  TIMESTAMPTZ, JSONB, BYTEA, TEXT, JSONB, BYTEA
) FROM PUBLIC;

COMMIT;

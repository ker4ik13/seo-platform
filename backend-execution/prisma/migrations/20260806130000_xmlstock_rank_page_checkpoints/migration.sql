BEGIN;

-- A Live Top-30/50/100 lookup is billed and returned one ten-result page at
-- a time. Persist the normalized, secret-free page prefix so a transient
-- failure retries only the current page instead of discarding paid work.
ALTER TABLE public.rank_connector_executions
  ADD COLUMN provider_progress_snapshot JSONB,
  ADD COLUMN provider_progress_hash BYTEA;

ALTER TABLE public.rank_connector_executions
  ADD CONSTRAINT rank_connector_executions_provider_progress_shape
  CHECK (
    (
      provider_progress_snapshot IS NULL
      AND provider_progress_hash IS NULL
    )
    OR (
      provider = 'XMLSTOCK'
      AND provider_progress_snapshot IS NOT NULL
      AND provider_progress_hash IS NOT NULL
      AND octet_length(provider_progress_hash) = 32
      AND status IN ('POLL_WAIT', 'FETCHING')
    )
  ) NOT VALID;

CREATE UNIQUE INDEX rank_jobs_single_manual_rank_retry_child_key
  ON public.jobs(parent_job_id)
  WHERE type = 'MANUAL_RANK_CHECK' AND parent_job_id IS NOT NULL;

COMMENT ON COLUMN public.rank_connector_executions.provider_progress_snapshot
IS 'Private normalized XMLStock Live page checkpoint. Raw provider responses and credentials are never stored here.';

DROP FUNCTION public.claim_rank_connector_poll(TEXT, INTEGER, TEXT);

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
  "providerTaskId" TEXT,
  "requestSnapshot" JSONB,
  "providerProgressSnapshot" JSONB,
  "providerProgressHash" BYTEA,
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
    OR p_lease_seconds NOT BETWEEN 5 AND 120
    OR p_execution_connector_version IS NULL
    OR p_execution_connector_version !~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
  THEN
    RAISE EXCEPTION 'Invalid rank connector poll claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job.workspace_id = execution.workspace_id
    AND job.project_id = execution.project_id
    AND job.id = execution.job_id
  JOIN public.rank_connector_execution_controls control
    ON control.provider = execution.provider
    AND control.capability = 'SERP_RANK_TRACKING'
  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
  WHERE execution.execution_connector_version = p_execution_connector_version
    AND control.execution_connector_version = p_execution_connector_version
    AND control.provider_policy_version = execution.provider_policy_version
    AND control.kill_switch_version = execution.kill_switch_version
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.provider = execution.provider
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND job.version = execution.job_version
    AND credential.provider = execution.provider
    AND credential.material_version = execution.credential_material_version
    AND credential.ciphertext IS NOT NULL
    AND execution.poll_attempt_count < 720
    AND (
      (execution.status = 'POLL_WAIT' AND execution.next_action_at <= clock_timestamp())
      OR (execution.status = 'FETCHING' AND execution.lease_expires_at <= clock_timestamp())
    )
  ORDER BY execution.next_action_at NULLS FIRST, execution.created_at, execution.id
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_now := clock_timestamp();
  v_token := pg_catalog.uuidv7();
  v_expiry := v_now + make_interval(secs => p_lease_seconds);

  UPDATE public.rank_connector_executions execution
  SET status = 'FETCHING',
      lease_owner = p_lease_owner,
      lease_token = v_token,
      lease_expires_at = v_expiry,
      claimed_at = v_now,
      poll_attempt_count = execution.poll_attempt_count + 1,
      next_action_at = NULL,
      version = execution.version + 1,
      updated_at = v_now
  WHERE execution.id = candidate.id
    AND execution.version = candidate.version;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT execution.id,
         v_token,
         v_expiry,
         credential.workspace_id,
         execution.provider,
         credential.id,
         credential.material_version,
         credential.ciphertext,
         credential.nonce,
         credential.auth_tag,
         credential.encrypted_data_key,
         credential.data_key_nonce,
         credential.data_key_auth_tag,
         credential.key_version,
         execution.provider_task_id::TEXT,
         intent.request_snapshot,
         execution.provider_progress_snapshot,
         execution.provider_progress_hash,
         execution.lease_generation,
         execution.version
  FROM public.rank_connector_executions execution
  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
    AND credential.provider = execution.provider
  JOIN public.rank_provider_request_intents intent
    ON intent.id = execution.provider_request_intent_id
    AND intent.workspace_id = execution.workspace_id
    AND intent.request_hash = execution.provider_request_intent_hash
  WHERE execution.id = candidate.id
    AND execution.lease_token = v_token
    AND execution.status = 'FETCHING';
END
$$;

DROP FUNCTION public.complete_rank_connector_poll(
  UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER,
  TIMESTAMPTZ, JSONB, BYTEA, TEXT
);

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
    GREATEST(
      COALESCE(
        p_retry_after_seconds,
        CASE WHEN p_outcome = 'CHECKPOINTED' THEN 5 ELSE 10 END
      ),
      5
    ),
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

ALTER TABLE public.rank_connector_executions
  VALIDATE CONSTRAINT rank_connector_executions_provider_progress_shape;

REVOKE ALL ON FUNCTION public.claim_rank_connector_poll(TEXT, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_rank_connector_poll(
  UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER,
  TIMESTAMPTZ, JSONB, BYTEA, TEXT, JSONB, BYTEA
) FROM PUBLIC;

COMMIT;

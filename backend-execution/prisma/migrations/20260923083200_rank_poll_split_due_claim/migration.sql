BEGIN;

CREATE OR REPLACE FUNCTION public.claim_rank_connector_poll(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)
 RETURNS TABLE("executionId" uuid, "leaseToken" uuid, "leaseExpiresAt" timestamp with time zone, "workspaceId" uuid, provider character varying, "credentialId" uuid, "credentialMaterialVersion" integer, ciphertext bytea, nonce bytea, "authTag" bytea, "encryptedDataKey" bytea, "dataKeyNonce" bytea, "dataKeyAuthTag" bytea, "keyVersion" integer, "providerTaskId" text, "requestSnapshot" jsonb, "providerProgressSnapshot" jsonb, "providerProgressHash" bytea, "leaseGeneration" integer, "executionVersion" integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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


  -- Most runtime ticks have no provider result due yet. Avoid opening the
  -- complete tenant/credential/control graph until the indexed execution and
  -- its parent Job show possible work. The full query below remains the
  -- authoritative eligibility and lock fence.
  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
      AND job.project_id = execution.project_id
      AND job.id = execution.job_id
    WHERE execution.execution_connector_version =
      p_execution_connector_version
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.status = 'RUNNING'
      AND job.stage = 'WAITING_EXECUTION_GRANT'
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (
          execution.status = 'POLL_WAIT'
          AND execution.next_action_at <= clock_timestamp()
        )
        OR (
          execution.status = 'FETCHING'
          AND execution.lease_expires_at <= clock_timestamp()
        )
      )
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  -- A worker that lost its lease on the fiftieth request must become terminal
  -- without issuing request 51.  This also recovers maxed POLL_WAIT rows left
  -- by an older worker version.
  UPDATE public.rank_connector_executions execution
  SET status = 'FAILED_FINAL',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      next_action_at = NULL,
      provider_progress_snapshot = NULL,
      provider_progress_hash = NULL,
      observed_at = NULL,
      normalized_result_snapshot = NULL,
      normalized_result_hash = NULL,
      last_error_code = COALESCE(
        execution.last_error_code,
        'PROVIDER_POLL_TIMEOUT'
      ),
      finished_at = clock_timestamp(),
      version = execution.version + 1,
      updated_at = clock_timestamp()
  FROM public.jobs job
  WHERE job.workspace_id = execution.workspace_id
    AND job.project_id = execution.project_id
    AND job.id = execution.job_id
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.provider = execution.provider
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND job.version = execution.job_version
    AND job.cancel_requested_at IS NULL
    AND execution.provider = 'XMLSTOCK'
    AND execution.poll_attempt_count >= 50
    AND (
      execution.status = 'POLL_WAIT'
      OR (
        execution.status = 'FETCHING'
        AND execution.lease_expires_at <= clock_timestamp()
      )
    );

  -- Split the two due states so PostgreSQL can use the small partial
  -- index for each state. Recover an expired lease first, then claim the next
  -- scheduled provider poll. SKIP LOCKED keeps all connector lanes parallel.
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
    AND (control.provider_policy_version = execution.provider_policy_version OR (control.provider_policy_version = 'manual-arsenkin-positions@2.0.0' AND execution.provider_policy_version = 'manual-arsenkin-positions@3.0.0') OR (control.provider_policy_version = 'manual-xmlstock-serp@1.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@2.0.0') OR (control.provider_policy_version = 'manual-arsenkin-positions@3.0.0' AND execution.provider_policy_version IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (control.provider_policy_version = 'manual-xmlstock-serp@2.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@1.0.0'))
    AND control.kill_switch_version = execution.kill_switch_version
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.provider = execution.provider
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND job.version = execution.job_version
    AND job.cancel_requested_at IS NULL
    AND credential.provider = execution.provider
    AND credential.material_version = execution.credential_material_version
    AND credential.ciphertext IS NOT NULL
    AND execution.poll_attempt_count <
      CASE WHEN execution.provider = 'XMLSTOCK' THEN 50 ELSE 720 END
    AND execution.status = 'FETCHING'
    AND execution.lease_expires_at <= clock_timestamp()
  ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.credential_id = execution.credential_id
      AND active_execution.project_id = execution.project_id
      AND active_execution.provider = execution.provider
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
  ), execution.lease_expires_at, execution.created_at, execution.id
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
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
    AND (control.provider_policy_version = execution.provider_policy_version OR (control.provider_policy_version = 'manual-arsenkin-positions@2.0.0' AND execution.provider_policy_version = 'manual-arsenkin-positions@3.0.0') OR (control.provider_policy_version = 'manual-xmlstock-serp@1.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@2.0.0') OR (control.provider_policy_version = 'manual-arsenkin-positions@3.0.0' AND execution.provider_policy_version IN ('manual-arsenkin-positions@1.0.0', 'manual-arsenkin-positions@2.0.0')) OR (control.provider_policy_version = 'manual-xmlstock-serp@2.0.0' AND execution.provider_policy_version = 'manual-xmlstock-serp@1.0.0'))
    AND control.kill_switch_version = execution.kill_switch_version
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.provider = execution.provider
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND job.version = execution.job_version
    AND job.cancel_requested_at IS NULL
    AND credential.provider = execution.provider
    AND credential.material_version = execution.credential_material_version
    AND credential.ciphertext IS NOT NULL
    AND execution.poll_attempt_count <
      CASE WHEN execution.provider = 'XMLSTOCK' THEN 50 ELSE 720 END
    AND execution.status = 'POLL_WAIT'
    AND execution.next_action_at <= clock_timestamp()
  ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.credential_id = execution.credential_id
      AND active_execution.project_id = execution.project_id
      AND active_execution.provider = execution.provider
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
  ), execution.next_action_at, execution.created_at, execution.id
  FOR UPDATE OF execution SKIP LOCKED
  LIMIT 1;
  END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_poll(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;

COMMIT;

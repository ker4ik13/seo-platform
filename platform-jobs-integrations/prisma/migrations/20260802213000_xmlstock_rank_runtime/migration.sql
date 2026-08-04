BEGIN;

LOCK TABLE public.rank_estimates IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_job_runs IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_provider_request_intents IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_connector_executions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.jobs IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.rank_estimates
  DROP CONSTRAINT rank_estimates_provider_route,
  ADD CONSTRAINT rank_estimates_provider_route
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND credential_mode = 'BYOK_API_KEY'
  ) NOT VALID;

ALTER TABLE public.rank_estimates
  DROP CONSTRAINT rank_estimates_scope_hash_availability,
  ADD CONSTRAINT rank_estimates_scope_hash_availability
  CHECK (
    (
      provider = 'ARSENKIN'
      AND provider_policy_version = 'manual-arsenkin-positions@1.0.0'
      AND (
        (
          keyword_count BETWEEN 0 AND 1000
          AND semantic_scope_hash IS NOT NULL
          AND scope_hash IS NOT NULL
          AND octet_length(semantic_scope_hash) = 32
          AND octet_length(scope_hash) = 32
        )
        OR (
          keyword_count BETWEEN 1 AND 1001
          AND semantic_scope_hash IS NULL
          AND scope_hash IS NULL
        )
      )
    )
    OR (
      provider = 'ARSENKIN'
      AND provider_policy_version = 'manual-arsenkin-positions@2.0.0'
      AND (
        (
          keyword_count BETWEEN 0 AND 15000
          AND semantic_scope_hash IS NOT NULL
          AND scope_hash IS NOT NULL
          AND octet_length(semantic_scope_hash) = 32
          AND octet_length(scope_hash) = 32
        )
        OR (
          keyword_count BETWEEN 1 AND 15001
          AND semantic_scope_hash IS NULL
          AND scope_hash IS NULL
        )
      )
    )
    OR (
      provider = 'XMLSTOCK'
      AND provider_policy_version = 'manual-xmlstock-serp@1.0.0'
      AND (
        (
          keyword_count BETWEEN 0 AND 15000
          AND semantic_scope_hash IS NOT NULL
          AND scope_hash IS NOT NULL
          AND octet_length(semantic_scope_hash) = 32
          AND octet_length(scope_hash) = 32
        )
        OR (
          keyword_count BETWEEN 1 AND 15001
          AND semantic_scope_hash IS NULL
          AND scope_hash IS NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public.rank_estimates
  DROP CONSTRAINT rank_estimates_counts_bounded,
  ADD CONSTRAINT rank_estimates_counts_bounded
  CHECK (
    keyword_count >= 0
    AND provider_task_count >= 0
    AND minimum_submit_request_count >= 0
    AND minimum_check_request_count >= 0
    AND minimum_get_request_count >= 0
    AND (
      (
        provider = 'ARSENKIN'
        AND provider_policy_version = 'manual-arsenkin-positions@1.0.0'
        AND keyword_count <= 1001
        AND provider_task_count <= 4
        AND minimum_submit_request_count = provider_task_count
        AND minimum_check_request_count = provider_task_count
        AND minimum_get_request_count = provider_task_count
        AND (
          (keyword_count <= 1000 AND provider_task_count = ((keyword_count + 249) / 250))
          OR (keyword_count = 1001 AND provider_task_count = 0)
        )
      )
      OR (
        provider = 'ARSENKIN'
        AND provider_policy_version = 'manual-arsenkin-positions@2.0.0'
        AND keyword_count <= 15001
        AND provider_task_count <= 1
        AND minimum_submit_request_count = provider_task_count
        AND minimum_check_request_count = provider_task_count
        AND minimum_get_request_count = provider_task_count
        AND (
          (keyword_count BETWEEN 1 AND 15000 AND provider_task_count = 1)
          OR (keyword_count IN (0, 15001) AND provider_task_count = 0)
        )
      )
      OR (
        provider = 'XMLSTOCK'
        AND provider_policy_version = 'manual-xmlstock-serp@1.0.0'
        AND keyword_count <= 15001
        AND provider_task_count <= 15000
        AND (
          (keyword_count BETWEEN 1 AND 15000 AND provider_task_count = keyword_count)
          OR (keyword_count IN (0, 15001) AND provider_task_count = 0)
        )
        AND execution_snapshot IS NOT NULL
        AND (
          (
            execution_snapshot ->> 'searchEngine' = 'YANDEX'
            AND minimum_submit_request_count = provider_task_count
            AND minimum_check_request_count = provider_task_count
            AND minimum_get_request_count = 0
          )
          OR (
            execution_snapshot ->> 'searchEngine' = 'GOOGLE'
            AND minimum_submit_request_count = 0
            AND minimum_check_request_count = 0
            AND minimum_get_request_count = provider_task_count *
              (((execution_snapshot ->> 'depth')::integer + 9) / 10)
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public.rank_job_runs
  DROP CONSTRAINT rank_job_runs_manifest_receipt,
  ADD CONSTRAINT rank_job_runs_manifest_receipt
  CHECK (
    (
      seal_state IN ('PENDING', 'OUTCOME_UNKNOWN', 'NOT_SEALED')
      AND manifest_id IS NULL
      AND manifest_hash_schema IS NULL
      AND manifest_hash IS NULL
      AND manifest_deduplication_hash IS NULL
      AND manifest_pair_count IS NULL
      AND manifest_chunk_count IS NULL
      AND manifest_chunk_size IS NULL
      AND manifest_sealed_at IS NULL
    )
    OR (
      seal_state IN ('SEALED', 'FINALIZED')
      AND manifest_id IS NOT NULL
      AND manifest_hash_schema = 'rank-manifest@1'
      AND manifest_hash IS NOT NULL
      AND octet_length(manifest_hash) = 32
      AND manifest_deduplication_hash IS NOT NULL
      AND octet_length(manifest_deduplication_hash) = 32
      AND manifest_sealed_at IS NOT NULL
      AND (
        (
          manifest_pair_count BETWEEN 1 AND 1000
          AND manifest_chunk_size = 250
          AND manifest_chunk_count = ((manifest_pair_count + 249) / 250)
        )
        OR (
          manifest_pair_count BETWEEN 1 AND 15000
          AND manifest_chunk_size = 15000
          AND manifest_chunk_count = 1
        )
        OR (
          manifest_pair_count BETWEEN 1 AND 15000
          AND manifest_chunk_size = 1
          AND manifest_chunk_count = manifest_pair_count
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public.rank_provider_request_intents
  DROP CONSTRAINT rank_provider_request_intents_shape,
  ADD CONSTRAINT rank_provider_request_intents_shape
  CHECK (
    octet_length(manifest_hash) = 32
    AND manifest_chunk_index BETWEEN 0 AND 14999
    AND octet_length(manifest_chunk_hash) = 32
    AND schema_version = 'rank-provider-request-intent@1'
    AND jsonb_typeof(request_snapshot) = 'object'
    AND octet_length(request_snapshot::text) <= 67108864
    AND octet_length(request_hash) = 32
  ) NOT VALID;

ALTER TABLE public.rank_connector_executions
  ADD COLUMN provider VARCHAR(64) NOT NULL DEFAULT 'ARSENKIN',
  ADD CONSTRAINT rank_connector_executions_provider
    CHECK (provider IN ('ARSENKIN', 'XMLSTOCK')) NOT VALID;

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO definition
  FROM pg_constraint
  WHERE conrelid = 'public.rank_connector_executions'::regclass
    AND conname = 'rank_connector_executions_shape';
  IF definition IS NULL
    OR position('(manifest_chunk_index <= 3)' IN definition) = 0
  THEN
    RAISE EXCEPTION 'Unexpected rank connector shape before XMLStock migration'
      USING ERRCODE = '55000';
  END IF;
  ALTER TABLE public.rank_connector_executions
    DROP CONSTRAINT rank_connector_executions_shape;
  EXECUTE 'ALTER TABLE public.rank_connector_executions ADD CONSTRAINT ' ||
    'rank_connector_executions_shape ' ||
    replace(
      definition,
      '(manifest_chunk_index <= 3)',
      '(manifest_chunk_index <= 14999)'
    ) ||
    ' NOT VALID';
END
$migration$;

CREATE UNIQUE INDEX rank_connector_execution_controls_connector_key
  ON public.rank_connector_execution_controls (
    capability,
    execution_connector_version
  );

INSERT INTO public.rank_connector_execution_controls (
  provider,
  capability,
  submit_enabled,
  execution_connector_version,
  provider_policy_version,
  kill_switch_version,
  version
) VALUES (
  'XMLSTOCK',
  'SERP_RANK_TRACKING',
  TRUE,
  'xmlstock-serp@1.0.0',
  'manual-xmlstock-serp@1.0.0',
  'xmlstock-serp@1',
  1
);

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.rank_execution_grant_request_is_exact(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea)'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    '''provider'', ''ARSENKIN''',
    '''provider'', p_snapshot ->> ''provider'''
  );
  definition := replace(
    definition,
    'manifest_chunk_index BETWEEN 0 AND 3',
    'manifest_chunk_index BETWEEN 0 AND 14999'
  );
  definition := replace(
    definition,
    'AND (p_snapshot ->> ''policyVersion'') ~',
    'AND (p_snapshot ->> ''provider'') IN (''ARSENKIN'', ''XMLSTOCK'')' || E'\n    ' ||
    'AND (p_snapshot ->> ''policyVersion'') ~'
  );
  IF position('''provider'', ''ARSENKIN''' IN definition) > 0
    OR position('BETWEEN 0 AND 3' IN definition) > 0
  THEN
    RAISE EXCEPTION 'Rank grant request guard was not widened safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.assert_manual_rank_job_shape()'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'NEW.provider IS DISTINCT FROM ''ARSENKIN''',
    'NEW.provider NOT IN (''ARSENKIN'', ''XMLSTOCK'')'
  );
  definition := replace(
    definition,
    'NEW.progress_total NOT BETWEEN 1 AND 1000',
    'NEW.progress_total NOT BETWEEN 1 AND 15000'
  );
  IF position('NEW.provider IS DISTINCT FROM ''ARSENKIN''' IN definition) > 0
    OR position('NEW.progress_total NOT BETWEEN 1 AND 1000' IN definition) > 0
  THEN
    RAISE EXCEPTION 'Manual rank Job guard was not widened safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

CREATE OR REPLACE FUNCTION public.assert_rank_connector_execution_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Rank connector execution identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.provider NOT IN ('ARSENKIN', 'XMLSTOCK') OR NOT EXISTS (
    SELECT 1
    FROM public.rank_execution_grant_attempts attempt
    JOIN public.jobs job
      ON job.workspace_id = attempt.workspace_id
      AND job.project_id = attempt.project_id
      AND job.id = attempt.job_id
    JOIN public.rank_job_runs run
      ON run.workspace_id = attempt.workspace_id
      AND run.project_id = attempt.project_id
      AND run.job_id = attempt.job_id
    JOIN public.rank_estimates estimate
      ON estimate.workspace_id = run.workspace_id
      AND estimate.project_id = run.project_id
      AND estimate.id = run.estimate_id
    JOIN public.job_items item
      ON item.workspace_id = attempt.workspace_id
      AND item.project_id = attempt.project_id
      AND item.job_id = attempt.job_id
      AND item.id = attempt.job_item_id
    JOIN public.integration_credentials credential
      ON credential.workspace_id = attempt.workspace_id
      AND credential.id = NEW.credential_id
    JOIN public.jobs validation
      ON validation.workspace_id = attempt.workspace_id
      AND validation.id = NEW.credential_validation_id
    JOIN public.project_connector_bindings binding
      ON binding.workspace_id = attempt.workspace_id
      AND binding.project_id = attempt.project_id
      AND binding.id = NEW.binding_id
    JOIN public.project_connector_routes route
      ON route.workspace_id = attempt.workspace_id
      AND route.project_id = attempt.project_id
      AND route.binding_id = NEW.binding_id
      AND route.id = NEW.route_id
      AND route.credential_id = NEW.credential_id
    WHERE attempt.id = NEW.grant_attempt_id
      AND attempt.workspace_id = NEW.workspace_id
      AND attempt.project_id = NEW.project_id
      AND attempt.job_id = NEW.job_id
      AND attempt.job_item_id = NEW.job_item_id
      AND attempt.execution_attempt = NEW.execution_attempt
      AND attempt.job_version = NEW.job_version
      AND attempt.execution_evidence_hash = NEW.execution_evidence_hash
      AND attempt.status = 'GRANTED_PENDING_CONSUME'
      AND attempt.expires_at = NEW.authorization_expires_at
      AND attempt.expires_at > clock_timestamp()
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.version = NEW.job_version
      AND job.provider = NEW.provider
      AND job.credential_mode = 'BYOK_API_KEY'
      AND (
        (job.status = 'QUEUED' AND job.stage = 'WAITING_FOR_QUEUE')
        OR (job.status = 'RUNNING' AND job.stage = 'WAITING_EXECUTION_GRANT')
      )
      AND job.cancel_requested_at IS NULL
      AND run.seal_state = 'SEALED'
      AND run.estimate_id = NEW.estimate_id
      AND run.manifest_id = NEW.manifest_id
      AND run.manifest_hash = NEW.manifest_hash
      AND run.manifest_chunk_count BETWEEN 1 AND 15000
      AND NEW.manifest_chunk_index BETWEEN 0 AND run.manifest_chunk_count - 1
      AND run.finalization_status IS NULL
      AND item.sequence = NEW.manifest_chunk_index
      AND item.status = 'QUEUED'
      AND item.provider_request_id IS NULL
      AND item.output_reference IS NULL
      AND item.actual_cost_micro IS NULL
      AND item.error IS NULL
      AND item.attempt = 0
      AND item.retry_at IS NULL
      AND item.input_reference = jsonb_build_object(
        'schemaVersion', 'rank-job-item@1',
        'manifestId', NEW.manifest_id::text,
        'chunkIndex', NEW.manifest_chunk_index
      )
      AND estimate.provider = NEW.provider
      AND estimate.execution_snapshot_hash = NEW.estimate_execution_hash
      AND estimate.binding_id = NEW.binding_id
      AND estimate.binding_version = NEW.binding_version
      AND estimate.route_id = NEW.route_id
      AND estimate.credential_id = NEW.credential_id
      AND estimate.credential_version = NEW.credential_version
      AND estimate.credential_material_version = NEW.credential_material_version
      AND estimate.credential_validation_id = NEW.credential_validation_id
      AND estimate.credential_validation_version = NEW.credential_validation_version
      AND estimate.credential_validation_connector_version =
        NEW.credential_validation_connector_version
      AND estimate.credential_verified_at = NEW.credential_verified_at
      AND estimate.provider_policy_version = NEW.provider_policy_version
      AND credential.provider = NEW.provider
      AND credential.mode = 'BYOK_API_KEY'
      AND credential.status = 'ACTIVE'
      AND credential.deleted_at IS NULL
      AND credential.version = NEW.credential_version
      AND credential.material_version = NEW.credential_material_version
      AND credential.verified_at = NEW.credential_verified_at
      AND validation.type = 'INTEGRATION_CREDENTIAL_VALIDATE'
      AND validation.provider = NEW.provider
      AND validation.status = 'COMPLETED'
      AND validation.version = NEW.credential_validation_version
      AND binding.capability = 'SERP_RANK_TRACKING'
      AND binding.enabled
      AND binding.version = NEW.binding_version
      AND route.position = 0
      AND route.source_kind = 'WORKSPACE_CREDENTIAL'
  ) THEN
    RAISE EXCEPTION
      'Rank connector execution must match one current granted Job graph'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution(text,integer,text)'::regprocedure
  ) INTO definition;
  definition := replace(definition, 'BETWEEN 5 AND 25', 'BETWEEN 5 AND 120');
  definition := replace(definition, 'BETWEEN 1 AND 4', 'BETWEEN 1 AND 15000');
  definition := regexp_replace(definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = execution."provider"');
  definition := regexp_replace(definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = execution."provider"');
  definition := regexp_replace(definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = execution."provider"');
  definition := regexp_replace(definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = candidate."provider"');
  definition := regexp_replace(definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = candidate."provider"');
  definition := regexp_replace(definition,
    'control\."provider" = ''ARSENKIN''',
    'control."provider" = current_execution."provider"');
  definition := regexp_replace(definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = current_execution."provider"');
  IF position('ARSENKIN' IN definition) > 0
    OR position('BETWEEN 1 AND 4' IN definition) > 0
    OR position('BETWEEN 5 AND 25' IN definition) > 0
  THEN
    RAISE EXCEPTION 'Rank connector claim was not generalized safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)'::regprocedure
  ) INTO definition;
  definition := replace(definition, 'BETWEEN 1 AND 4', 'BETWEEN 1 AND 15000');
  definition := regexp_replace(definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = candidate."provider"');
  definition := regexp_replace(definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = candidate."provider"');
  definition := regexp_replace(definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = candidate."provider"');
  definition := regexp_replace(definition,
    'control\."provider" = ''ARSENKIN''',
    'control."provider" = current_execution."provider"');
  definition := regexp_replace(definition,
    'job\."provider" = ''ARSENKIN''',
    'job."provider" = current_execution."provider"');
  definition := regexp_replace(definition,
    'credential\."provider" = ''ARSENKIN''',
    'credential."provider" = current_execution."provider"');
  definition := regexp_replace(definition,
    'validation\."provider" = ''ARSENKIN''',
    'validation."provider" = current_execution."provider"');
  IF position('ARSENKIN' IN definition) > 0
    OR position('BETWEEN 1 AND 4' IN definition) > 0
  THEN
    RAISE EXCEPTION 'Rank connector authorization was not generalized safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

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

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_staged_result(text,integer)'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'job."provider" = ''ARSENKIN''',
    'job."provider" = execution."provider"'
  );
  IF position('job."provider" = ''ARSENKIN''' IN definition) > 0 THEN
    RAISE EXCEPTION 'Rank persistence claim was not generalized safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

CREATE OR REPLACE FUNCTION public.claim_rank_connector_submit_bounded(
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
DECLARE
  provider_name VARCHAR(64);
  active_provider_tasks BIGINT;
BEGIN
  SELECT control.provider
  INTO provider_name
  FROM public.rank_connector_execution_controls control
  WHERE control.capability = 'SERP_RANK_TRACKING'
    AND control.execution_connector_version = p_execution_connector_version;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('seo-platform:rank-submit:' || provider_name, 0)
  ) THEN
    RETURN;
  END IF;

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.provider = provider_name
        AND execution.status IN ('CLAIMED','SUBMITTING','POLL_WAIT','FETCHING')
    ) + (
      SELECT COUNT(DISTINCT frequency_job.id)
      FROM public.jobs frequency_job
      JOIN public.job_items item
        ON item.job_id = frequency_job.id
        AND item.workspace_id = frequency_job.workspace_id
        AND item.project_id = frequency_job.project_id
      WHERE frequency_job.type = 'FREQUENCY_COLLECTION'
        AND frequency_job.provider = provider_name
        AND (
          (
            frequency_job.status IN ('RUNNING','RETRY_SCHEDULED','WAITING_RATE_LIMIT','FAILED_RETRYABLE')
            AND item.status IN ('RUNNING','FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL
          )
          OR (
            frequency_job.status = 'ACTION_REQUIRED'
            AND item.provider_request_id ~ '^submitting:'
          )
        )
    )
  INTO active_provider_tasks;
  IF active_provider_tasks >= 5 THEN RETURN; END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_rank_connector_execution(
    p_lease_owner,
    p_lease_seconds,
    p_execution_connector_version
  );
END
$$;

ALTER TABLE public.rank_estimates
  VALIDATE CONSTRAINT rank_estimates_provider_route;
ALTER TABLE public.rank_estimates
  VALIDATE CONSTRAINT rank_estimates_scope_hash_availability;
ALTER TABLE public.rank_estimates
  VALIDATE CONSTRAINT rank_estimates_counts_bounded;
ALTER TABLE public.rank_job_runs
  VALIDATE CONSTRAINT rank_job_runs_manifest_receipt;
ALTER TABLE public.rank_provider_request_intents
  VALIDATE CONSTRAINT rank_provider_request_intents_shape;
ALTER TABLE public.rank_connector_executions
  VALIDATE CONSTRAINT rank_connector_executions_provider;
ALTER TABLE public.rank_connector_executions
  VALIDATE CONSTRAINT rank_connector_executions_shape;

REVOKE ALL ON FUNCTION public.claim_rank_connector_poll(TEXT, INTEGER, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)
  FROM PUBLIC;

COMMIT;

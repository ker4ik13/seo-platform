BEGIN;

-- Clustering is a single provider task over one immutable keyword scope. The
-- connector role receives no table DML and can only use these fenced commands.
CREATE FUNCTION public.claim_clustering_run(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "jobId" UUID,
  "jobItemId" UUID,
  "workspaceId" UUID,
  "projectId" UUID,
  "actorId" UUID,
  "credentialId" UUID,
  "providerRequestId" TEXT,
  "keywordId" UUID,
  "keywordVersion" INTEGER,
  "attempt" INTEGER,
  "maxAttempts" INTEGER,
  "inputSnapshot" JSONB,
  "jobVersion" INTEGER,
  "leaseExpiresAt" TIMESTAMPTZ,
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
  job_row public.jobs%ROWTYPE;
  credential_row public.integration_credentials%ROWTYPE;
  credential_id UUID;
  item_ids UUID[];
  expected_count INTEGER;
  updated_count INTEGER;
  request_id_count INTEGER;
  expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'invalid clustering run claim';
  END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);

  SELECT job.*
  INTO job_row
  FROM public.jobs job
  WHERE job.type = 'CLUSTERING_RUN'
    AND job.project_id IS NOT NULL
    AND job.actor_id IS NOT NULL
    AND job.provider = 'ARSENKIN'
    AND job.status IN (
      'QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT',
      'RETRY_SCHEDULED', 'FAILED_RETRYABLE'
    )
    AND job.cancel_requested_at IS NULL
    AND (job.retry_at IS NULL OR job.retry_at <= clock_timestamp())
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
    AND EXISTS (
      SELECT 1 FROM public.job_items item
      WHERE item.job_id = job.id
        AND item.workspace_id = job.workspace_id
        AND item.project_id = job.project_id
        AND item.status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
        AND (item.retry_at IS NULL OR item.retry_at <= clock_timestamp())
    )
  ORDER BY job.priority, job.created_at, job.id
  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(job_row.scope_snapshot->>'credentialId', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR COALESCE(job_row.scope_snapshot->>'routeId', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    UPDATE public.job_items
    SET status = 'FAILED_FINAL', retry_at = NULL,
        error = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE job_id = job_row.id
      AND status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE');
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED', stage = 'credential_required',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        result_summary = jsonb_build_object('completed', 0, 'failed', progress_total),
        finished_at = clock_timestamp(), lease_owner = NULL,
        lease_expires_at = NULL, version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = job_row.id;
    RETURN;
  END IF;
  credential_id := (job_row.scope_snapshot->>'credentialId')::UUID;

  SELECT credential.*
  INTO credential_row
  FROM public.integration_credentials credential
  WHERE credential.id = credential_id
    AND credential.workspace_id = job_row.workspace_id
    AND credential.provider = 'ARSENKIN'
    AND credential.mode = 'BYOK_API_KEY'
    AND credential.status = 'ACTIVE'
    AND credential.deleted_at IS NULL
    AND jsonb_typeof(credential.capabilities) = 'array'
    AND credential.capabilities ? 'CLUSTERING'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      JOIN public.project_connector_routes route
        ON route.binding_id = binding.id
       AND route.workspace_id = binding.workspace_id
       AND route.project_id = binding.project_id
      WHERE binding.workspace_id = job_row.workspace_id
        AND binding.project_id = job_row.project_id
        AND binding.capability = 'CLUSTERING'
        AND binding.enabled
        AND route.id::TEXT = job_row.scope_snapshot->>'routeId'
        AND route.credential_id = credential.id
    );
  IF NOT FOUND THEN
    UPDATE public.job_items
    SET status = 'FAILED_FINAL', retry_at = NULL,
        error = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE job_id = job_row.id
      AND status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE');
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED', stage = 'credential_required',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        result_summary = jsonb_build_object('completed', 0, 'failed', progress_total),
        finished_at = clock_timestamp(), lease_owner = NULL,
        lease_expires_at = NULL, version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = job_row.id;
    RETURN;
  END IF;

  SELECT
    COALESCE(array_agg(candidate.id ORDER BY candidate.sequence, candidate.id), ARRAY[]::UUID[]),
    COUNT(DISTINCT COALESCE(candidate.provider_request_id::TEXT, '__NULL__'))
  INTO item_ids, request_id_count
  FROM (
    SELECT item.id, item.sequence, item.provider_request_id
    FROM public.job_items item
    WHERE item.job_id = job_row.id
      AND item.workspace_id = job_row.workspace_id
      AND item.project_id = job_row.project_id
      AND item.status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
      AND (item.retry_at IS NULL OR item.retry_at <= clock_timestamp())
    ORDER BY item.sequence, item.id
    FOR UPDATE OF item
  ) candidate;
  expected_count := cardinality(item_ids);
  IF expected_count NOT BETWEEN 1 AND 10000
     OR expected_count::BIGINT <> job_row.progress_total
     OR request_id_count > 1 THEN
    RAISE EXCEPTION 'invalid clustering run item set';
  END IF;

  UPDATE public.job_items AS claimed_item
  SET status = 'RUNNING', retry_at = NULL, error = NULL,
      attempt = claimed_item.attempt + 1,
      updated_at = clock_timestamp()
  WHERE claimed_item.id = ANY(item_ids)
    AND claimed_item.job_id = job_row.id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'clustering run claim changed concurrently';
  END IF;

  UPDATE public.jobs AS claimed_job
  SET status = 'RUNNING',
      stage = CASE WHEN EXISTS (
        SELECT 1 FROM public.job_items item
        WHERE item.job_id = claimed_job.id
          AND item.provider_request_id IS NOT NULL
      ) THEN 'provider_poll' ELSE 'clustering' END,
      started_at = COALESCE(claimed_job.started_at, clock_timestamp()),
      retry_at = NULL, lease_owner = p_lease_owner,
      lease_expires_at = expires_at,
      attempt = claimed_job.attempt + 1,
      version = claimed_job.version + 1,
      updated_at = clock_timestamp()
  WHERE claimed_job.id = job_row.id
  RETURNING claimed_job.* INTO job_row;

  RETURN QUERY
  SELECT
    job_row.id, item.id, job_row.workspace_id, job_row.project_id,
    job_row.actor_id, credential_row.id, item.provider_request_id::TEXT,
    (item.input_reference->>'keywordId')::UUID,
    (item.input_reference->>'version')::INTEGER,
    item.attempt, job_row.max_attempts, job_row.input_snapshot,
    job_row.version, expires_at,
    credential_row.ciphertext, credential_row.nonce,
    credential_row.auth_tag, credential_row.encrypted_data_key,
    credential_row.data_key_nonce, credential_row.data_key_auth_tag,
    credential_row.key_version
  FROM public.job_items item
  WHERE item.id = ANY(item_ids)
  ORDER BY item.sequence, item.id;
END
$$;

CREATE FUNCTION public.renew_clustering_run_lease(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_lease_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER, "leaseExpiresAt" TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  expected_count INTEGER;
  matched_count INTEGER;
  expires_at TIMESTAMPTZ;
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'invalid clustering run lease renewal';
  END IF;
  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id AND job.type = 'CLUSTERING_RUN'
    AND job.provider = 'ARSENKIN' AND job.status = 'RUNNING'
    AND job.cancel_requested_at IS NULL
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
    AND job.version = p_job_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COUNT(*) INTO matched_count
  FROM public.job_items item
  WHERE item.id = ANY(p_job_item_ids)
    AND item.job_id = p_job_id
    AND item.workspace_id = job_row.workspace_id
    AND item.project_id = job_row.project_id
    AND item.status = 'RUNNING';
  IF matched_count <> expected_count THEN RETURN; END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  UPDATE public.jobs
  SET lease_expires_at = expires_at, updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN QUERY SELECT job_row.id, job_row.version, expires_at;
END
$$;

CREATE FUNCTION public.mark_clustering_run_submitting(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_submit_marker TEXT, p_lease_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER, "leaseExpiresAt" TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  expected_count INTEGER;
  matched_count INTEGER;
  active_provider_tasks BIGINT;
  expires_at TIMESTAMPTZ;
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_submit_marker !~ '^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'invalid clustering submit marker';
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '2000ms', TRUE);
    PERFORM pg_advisory_xact_lock(hashtextextended('seo-platform:rank-dispatch:ARSENKIN', 0));
  EXCEPTION WHEN lock_not_available THEN RETURN;
  END;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id AND job.type = 'CLUSTERING_RUN'
    AND job.provider = 'ARSENKIN' AND job.status = 'RUNNING'
    AND job.cancel_requested_at IS NULL
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
    AND job.version = p_job_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      JOIN public.jobs rank_job
        ON rank_job.workspace_id = execution.workspace_id
       AND rank_job.project_id = execution.project_id
       AND rank_job.id = execution.job_id
      WHERE execution.provider = 'ARSENKIN'
        AND rank_job.status = 'RUNNING'
        AND rank_job.cancel_requested_at IS NULL
        AND (
          execution.status IN ('SUBMITTING','POLL_WAIT')
          OR (execution.status = 'READY_TO_SUBMIT' AND execution.authorization_expires_at > clock_timestamp())
          OR (execution.status IN ('CLAIMED','FETCHING') AND execution.lease_expires_at > clock_timestamp())
        )
    ) + (
      SELECT COUNT(DISTINCT provider_job.id)
      FROM public.jobs provider_job
      JOIN public.job_items item
        ON item.job_id = provider_job.id
       AND item.workspace_id = provider_job.workspace_id
       AND item.project_id = provider_job.project_id
      WHERE provider_job.id <> p_job_id
        AND provider_job.type IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN')
        AND provider_job.provider = 'ARSENKIN'
        AND (
          (
            provider_job.status IN ('RUNNING', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'FAILED_RETRYABLE')
            AND item.status IN ('RUNNING', 'FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL
          )
          OR (provider_job.status = 'ACTION_REQUIRED' AND item.provider_request_id ~ '^submitting:')
        )
    )
  INTO active_provider_tasks;
  IF active_provider_tasks >= 5 THEN RETURN; END IF;

  SELECT COUNT(*) INTO matched_count
  FROM public.job_items item
  WHERE item.id = ANY(p_job_item_ids)
    AND item.job_id = p_job_id
    AND item.workspace_id = job_row.workspace_id
    AND item.project_id = job_row.project_id
    AND item.status = 'RUNNING'
    AND item.provider_request_id IS NULL;
  IF matched_count <> expected_count THEN RETURN; END IF;

  UPDATE public.job_items
  SET provider_request_id = p_submit_marker, updated_at = clock_timestamp()
  WHERE id = ANY(p_job_item_ids);
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  UPDATE public.jobs
  SET stage = 'submitting', lease_expires_at = expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN QUERY SELECT job_row.id, job_row.version, expires_at;
END
$$;

CREATE FUNCTION public.transition_clustering_run(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_action TEXT,
  p_provider_request_id TEXT,
  p_retry_after_seconds INTEGER,
  p_error_code TEXT,
  p_result_summary JSONB
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  expected_count INTEGER;
  matched_count INTEGER;
  all_below_attempt_limit BOOLEAN;
  should_retry BOOLEAN;
  retry_at_value TIMESTAMPTZ;
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_action NOT IN ('COMPLETE', 'DEFER', 'FAIL', 'CAPACITY', 'QUARANTINE') THEN
    RAISE EXCEPTION 'invalid clustering transition';
  END IF;
  IF p_action = 'DEFER' AND (
    p_provider_request_id !~ '^[A-Za-z0-9._:-]{1,255}$'
    OR p_retry_after_seconds NOT BETWEEN 5 AND 3600
  ) THEN RAISE EXCEPTION 'invalid clustering deferral'; END IF;
  IF p_action = 'FAIL' AND (
    p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR (p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN 5 AND 3600)
  ) THEN RAISE EXCEPTION 'invalid clustering failure'; END IF;
  IF p_action = 'CAPACITY' AND p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid clustering capacity deferral';
  END IF;
  IF p_action = 'COMPLETE' AND (
    jsonb_typeof(p_result_summary) IS DISTINCT FROM 'object'
    OR NOT (p_result_summary ?& ARRAY[
      'proposalId', 'clusterCount', 'unclusteredCount', 'completed', 'failed'
    ])
    OR p_result_summary - ARRAY['proposalId','clusterCount','unclusteredCount','completed','failed'] <> '{}'::jsonb
    OR jsonb_typeof(p_result_summary->'proposalId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_result_summary->'clusterCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_result_summary->'unclusteredCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_result_summary->'completed') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_result_summary->'failed') IS DISTINCT FROM 'number'
    OR COALESCE(p_result_summary->>'proposalId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_result_summary->>'clusterCount')::INTEGER NOT BETWEEN 0 AND expected_count
    OR (p_result_summary->>'unclusteredCount')::INTEGER NOT BETWEEN 0 AND expected_count
    OR (p_result_summary->>'completed')::INTEGER <> expected_count
    OR (p_result_summary->>'failed')::INTEGER <> 0
  ) THEN RAISE EXCEPTION 'invalid clustering completion summary'; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id AND job.type = 'CLUSTERING_RUN'
    AND job.provider = 'ARSENKIN' AND job.status = 'RUNNING'
    AND job.cancel_requested_at IS NULL
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
    AND job.version = p_job_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*), BOOL_AND(item.attempt < job_row.max_attempts)
  INTO matched_count, all_below_attempt_limit
  FROM public.job_items item
  WHERE item.id = ANY(p_job_item_ids)
    AND item.job_id = p_job_id
    AND item.workspace_id = job_row.workspace_id
    AND item.project_id = job_row.project_id
    AND item.status = 'RUNNING'
    AND CASE p_action
      WHEN 'DEFER' THEN (
        item.provider_request_id IS NULL
        OR item.provider_request_id = p_provider_request_id
        OR item.provider_request_id ~ '^submitting:'
      )
      WHEN 'CAPACITY' THEN item.provider_request_id IS NULL AND item.attempt > 0
      WHEN 'QUARANTINE' THEN item.provider_request_id ~ '^submitting:'
      ELSE TRUE
    END;
  IF matched_count <> expected_count THEN RETURN; END IF;

  IF p_action = 'DEFER' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.job_items
    SET status = 'FAILED_RETRYABLE', provider_request_id = p_provider_request_id,
        retry_at = retry_at_value, error = NULL, updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED', stage = 'provider_poll',
        retry_at = retry_at_value, error_summary = NULL,
        lease_owner = NULL, lease_expires_at = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_job_id RETURNING * INTO job_row;
  ELSIF p_action = 'CAPACITY' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.job_items
    SET status = 'FAILED_RETRYABLE', attempt = attempt - 1,
        retry_at = retry_at_value,
        error = '{"code":"PROVIDER_CONCURRENCY_LIMITED"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED', stage = 'provider_capacity',
        retry_at = retry_at_value,
        error_summary = '{"code":"PROVIDER_CONCURRENCY_LIMITED"}'::jsonb,
        lease_owner = NULL, lease_expires_at = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_job_id RETURNING * INTO job_row;
  ELSIF p_action = 'QUARANTINE' THEN
    UPDATE public.job_items
    SET status = 'FAILED_FINAL', retry_at = NULL,
        error = '{"code":"PROVIDER_TRANSPORT_AMBIGUOUS"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED', stage = 'submit_ambiguous', retry_at = NULL,
        error_summary = jsonb_build_object(
          'code', 'PROVIDER_TRANSPORT_AMBIGUOUS',
          'manualReconciliationRequired', true
        ),
        result_summary = jsonb_build_object('completed', 0, 'failed', expected_count),
        lease_owner = NULL, lease_expires_at = NULL,
        finished_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id RETURNING * INTO job_row;
  ELSIF p_action = 'FAIL' THEN
    should_retry := p_retry_after_seconds IS NOT NULL AND all_below_attempt_limit;
    retry_at_value := CASE WHEN should_retry
      THEN clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      ELSE NULL END;
    UPDATE public.job_items
    SET status = CASE WHEN should_retry
          THEN 'FAILED_RETRYABLE'::public."JobItemStatus"
          ELSE 'FAILED_FINAL'::public."JobItemStatus" END,
        retry_at = retry_at_value,
        error = jsonb_build_object('code', p_error_code),
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = CASE WHEN should_retry
          THEN 'RETRY_SCHEDULED'::public."JobStatus"
          ELSE 'FAILED_FINAL'::public."JobStatus" END,
        stage = CASE WHEN should_retry THEN 'retry_scheduled' ELSE 'failed' END,
        retry_at = retry_at_value,
        error_summary = jsonb_build_object('code', p_error_code, 'failed', expected_count),
        result_summary = CASE WHEN should_retry THEN result_summary
          ELSE jsonb_build_object('completed', 0, 'failed', expected_count) END,
        lease_owner = NULL, lease_expires_at = NULL,
        finished_at = CASE WHEN should_retry THEN NULL ELSE clock_timestamp() END,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = p_job_id RETURNING * INTO job_row;
  ELSE
    UPDATE public.job_items
    SET status = 'COMPLETED',
        output_reference = jsonb_build_object('proposalId', p_result_summary->>'proposalId'),
        retry_at = NULL, error = NULL, updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'COMPLETED', stage = 'proposal_ready',
        progress_current = progress_total, retry_at = NULL,
        lease_owner = NULL, lease_expires_at = NULL,
        result_summary = p_result_summary, error_summary = NULL,
        finished_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id RETURNING * INTO job_row;
  END IF;
  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

-- All Arsenkin workloads share the account's five durable provider slots.
DO $migration$
DECLARE
  function_signature TEXT;
  function_definition TEXT;
  old_fragment TEXT := '(''FREQUENCY_COLLECTION'', ''AI_ANSWER_COLLECTION'')';
  new_fragment TEXT := '(''FREQUENCY_COLLECTION'', ''AI_ANSWER_COLLECTION'', ''CLUSTERING_RUN'')';
  occurrence_count INTEGER;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.mark_frequency_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)',
    'public.claim_rank_connector_submit_bounded(text,integer,text)',
    'public.mark_ai_answer_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)'
  ]
  LOOP
    SELECT pg_get_functiondef(function_signature::regprocedure)
    INTO function_definition;
    occurrence_count := (
      length(function_definition) - length(replace(function_definition, old_fragment, ''))
    ) / length(old_fragment);
    IF occurrence_count <> 1 THEN
      RAISE EXCEPTION 'unexpected Arsenkin capacity predicate in %', function_signature;
    END IF;
    EXECUTE replace(function_definition, old_fragment, new_fragment);
  END LOOP;
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_clustering_run(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_clustering_run_lease(UUID, UUID[], TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_clustering_run_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_clustering_run(UUID, UUID[], TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC;

COMMIT;

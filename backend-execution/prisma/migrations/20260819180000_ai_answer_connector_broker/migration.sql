BEGIN;

-- AI answer collection is executed by the least-privilege connector role.
-- Keep all Jobs-owned rows behind narrow, fenced SECURITY DEFINER commands;
-- the connector never receives direct table privileges.
CREATE FUNCTION public.claim_ai_answer_collection_batch(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_max_batch_items INTEGER
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
  first_item public.job_items%ROWTYPE;
  credential_row public.integration_credentials%ROWTYPE;
  credential_id UUID;
  item_ids UUID[];
  expected_count INTEGER;
  updated_count INTEGER;
  expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 120
     OR p_max_batch_items NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'invalid AI answer collection batch claim';
  END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);

  SELECT job.*
  INTO job_row
  FROM public.jobs job
  WHERE job.type = 'AI_ANSWER_COLLECTION'
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
      SELECT 1
      FROM public.job_items item
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
    SET status = 'FAILED_FINAL',
        retry_at = NULL,
        error = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE job_id = job_row.id
      AND status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE');
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        stage = 'credential_required',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        result_summary = jsonb_build_object('completed', 0, 'failed', progress_total),
        finished_at = clock_timestamp(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
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
    AND credential.capabilities ? 'SERP_COLLECTION'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      JOIN public.project_connector_routes route
        ON route.binding_id = binding.id
       AND route.workspace_id = binding.workspace_id
       AND route.project_id = binding.project_id
      WHERE binding.workspace_id = job_row.workspace_id
        AND binding.project_id = job_row.project_id
        AND binding.capability = 'SERP_COLLECTION'
        AND binding.enabled
        AND route.id::TEXT = job_row.scope_snapshot->>'routeId'
        AND route.credential_id = credential.id
    );
  IF NOT FOUND THEN
    UPDATE public.job_items
    SET status = 'FAILED_FINAL',
        retry_at = NULL,
        error = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE job_id = job_row.id
      AND status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE');
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        stage = 'credential_required',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        result_summary = jsonb_build_object('completed', 0, 'failed', progress_total),
        finished_at = clock_timestamp(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = job_row.id;
    RETURN;
  END IF;

  SELECT item.*
  INTO first_item
  FROM public.job_items item
  WHERE item.job_id = job_row.id
    AND item.workspace_id = job_row.workspace_id
    AND item.project_id = job_row.project_id
    AND item.status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
    AND (item.retry_at IS NULL OR item.retry_at <= clock_timestamp())
  ORDER BY item.sequence, item.id
  FOR UPDATE OF item SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.sequence, candidate.id), ARRAY[]::UUID[])
  INTO item_ids
  FROM (
    SELECT item.id, item.sequence
    FROM public.job_items item
    WHERE item.job_id = job_row.id
      AND item.workspace_id = job_row.workspace_id
      AND item.project_id = job_row.project_id
      AND item.status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
      AND (item.retry_at IS NULL OR item.retry_at <= clock_timestamp())
      AND item.provider_request_id IS NOT DISTINCT FROM first_item.provider_request_id
    ORDER BY item.sequence, item.id
    LIMIT p_max_batch_items
    FOR UPDATE OF item SKIP LOCKED
  ) candidate;
  expected_count := cardinality(item_ids);
  IF expected_count NOT BETWEEN 1 AND p_max_batch_items THEN
    RAISE EXCEPTION 'invalid AI answer collection item set';
  END IF;

  UPDATE public.job_items
  SET status = 'RUNNING',
      retry_at = NULL,
      error = NULL,
      attempt = attempt + 1,
      updated_at = clock_timestamp()
  WHERE id = ANY(item_ids)
    AND job_id = job_row.id
    AND workspace_id = job_row.workspace_id
    AND project_id = job_row.project_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'AI answer collection batch claim changed concurrently';
  END IF;

  UPDATE public.jobs
  SET status = 'RUNNING',
      stage = CASE WHEN first_item.provider_request_id IS NULL
        THEN 'collecting' ELSE 'provider_poll' END,
      started_at = COALESCE(started_at, clock_timestamp()),
      retry_at = NULL,
      lease_owner = p_lease_owner,
      lease_expires_at = expires_at,
      attempt = attempt + 1,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = job_row.id
  RETURNING * INTO job_row;

  RETURN QUERY
  SELECT
    job_row.id,
    item.id,
    job_row.workspace_id,
    job_row.project_id,
    job_row.actor_id,
    credential_row.id,
    item.provider_request_id,
    (item.input_reference->>'keywordId')::UUID,
    (item.input_reference->>'version')::INTEGER,
    item.attempt,
    job_row.max_attempts,
    job_row.input_snapshot,
    job_row.version,
    expires_at,
    credential_row.ciphertext,
    credential_row.nonce,
    credential_row.auth_tag,
    credential_row.encrypted_data_key,
    credential_row.data_key_nonce,
    credential_row.data_key_auth_tag,
    credential_row.key_version
  FROM public.job_items item
  WHERE item.id = ANY(item_ids)
  ORDER BY item.sequence, item.id;
END
$$;

CREATE FUNCTION public.renew_ai_answer_collection_batch_lease(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "jobId" UUID,
  "jobVersion" INTEGER,
  "leaseExpiresAt" TIMESTAMPTZ
)
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
    RAISE EXCEPTION 'invalid AI answer collection lease renewal';
  END IF;
  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'AI_ANSWER_COLLECTION'
    AND job.provider = 'ARSENKIN'
    AND job.status = 'RUNNING'
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
  SET lease_expires_at = expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN QUERY SELECT job_row.id, job_row.version, expires_at;
END
$$;

CREATE FUNCTION public.mark_ai_answer_collection_batch_submitting(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_submit_marker TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "jobId" UUID,
  "jobVersion" INTEGER,
  "leaseExpiresAt" TIMESTAMPTZ
)
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
    RAISE EXCEPTION 'invalid AI answer collection submit marker';
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '2000ms', TRUE);
    PERFORM pg_advisory_xact_lock(
      hashtextextended('seo-platform:rank-dispatch:ARSENKIN', 0)
    );
  EXCEPTION
    WHEN lock_not_available THEN RETURN;
  END;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'AI_ANSWER_COLLECTION'
    AND job.provider = 'ARSENKIN'
    AND job.status = 'RUNNING'
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
          OR (
            execution.status = 'READY_TO_SUBMIT'
            AND execution.authorization_expires_at > clock_timestamp()
          )
          OR (
            execution.status IN ('CLAIMED','FETCHING')
            AND execution.lease_expires_at > clock_timestamp()
          )
        )
    ) + (
      SELECT COUNT(DISTINCT provider_job.id)
      FROM public.jobs provider_job
      JOIN public.job_items item
        ON item.job_id = provider_job.id
       AND item.workspace_id = provider_job.workspace_id
       AND item.project_id = provider_job.project_id
      WHERE provider_job.id <> p_job_id
        AND provider_job.type IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION')
        AND provider_job.provider = 'ARSENKIN'
        AND (
          (
            provider_job.status IN (
              'RUNNING', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'FAILED_RETRYABLE'
            )
            AND item.status IN ('RUNNING', 'FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL
          )
          OR (
            provider_job.status = 'ACTION_REQUIRED'
            AND item.provider_request_id ~ '^submitting:'
          )
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
  SET provider_request_id = p_submit_marker,
      updated_at = clock_timestamp()
  WHERE id = ANY(p_job_item_ids);
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  UPDATE public.jobs
  SET stage = 'submitting',
      lease_expires_at = expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_job_id;
  RETURN QUERY SELECT job_row.id, job_row.version, expires_at;
END
$$;

-- Private transition primitive used only by the narrow public wrappers below.
CREATE FUNCTION public._transition_ai_answer_collection_batch(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_action TEXT,
  p_provider_request_id TEXT,
  p_retry_after_seconds INTEGER,
  p_error_code TEXT
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
  completed_count BIGINT;
  failed_count BIGINT;
  remaining_count BIGINT;
  next_status public."JobStatus";
  retry_at_value TIMESTAMPTZ;
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_action NOT IN ('COMPLETE', 'DEFER', 'FAIL', 'CAPACITY', 'QUARANTINE') THEN
    RAISE EXCEPTION 'invalid AI answer collection transition';
  END IF;
  IF p_action = 'DEFER' AND (
    p_provider_request_id !~ '^[A-Za-z0-9._:-]{1,255}$'
    OR p_retry_after_seconds NOT BETWEEN 5 AND 3600
  ) THEN RAISE EXCEPTION 'invalid AI answer collection deferral'; END IF;
  IF p_action = 'FAIL' AND (
    p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR (p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN 5 AND 3600)
  ) THEN RAISE EXCEPTION 'invalid AI answer collection failure'; END IF;
  IF p_action = 'CAPACITY' AND p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid AI answer collection capacity deferral';
  END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'AI_ANSWER_COLLECTION'
    AND job.provider = 'ARSENKIN'
    AND job.status = 'RUNNING'
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
        OR item.provider_request_id ~ '^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      WHEN 'CAPACITY' THEN item.provider_request_id IS NULL AND item.attempt > 0
      WHEN 'QUARANTINE' THEN item.provider_request_id ~ '^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ELSE TRUE
    END;
  IF matched_count <> expected_count THEN RETURN; END IF;

  IF p_action = 'DEFER' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.job_items
    SET status = 'FAILED_RETRYABLE',
        provider_request_id = p_provider_request_id,
        retry_at = retry_at_value,
        error = NULL,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED',
        stage = 'provider_poll',
        retry_at = retry_at_value,
        error_summary = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
    RETURNING * INTO job_row;
  ELSIF p_action = 'CAPACITY' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.job_items
    SET status = 'FAILED_RETRYABLE',
        attempt = attempt - 1,
        retry_at = retry_at_value,
        error = '{"code":"PROVIDER_CONCURRENCY_LIMITED"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED',
        stage = 'provider_capacity',
        retry_at = retry_at_value,
        error_summary = '{"code":"PROVIDER_CONCURRENCY_LIMITED"}'::jsonb,
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
    RETURNING * INTO job_row;
  ELSIF p_action = 'QUARANTINE' THEN
    UPDATE public.job_items
    SET status = 'FAILED_FINAL',
        retry_at = NULL,
        error = '{"code":"PROVIDER_TRANSPORT_AMBIGUOUS"}'::jsonb,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        stage = 'submit_ambiguous',
        retry_at = NULL,
        error_summary = jsonb_build_object(
          'code', 'PROVIDER_TRANSPORT_AMBIGUOUS',
          'manualReconciliationRequired', true
        ),
        result_summary = jsonb_build_object('completed', 0, 'failed', expected_count),
        lease_owner = NULL,
        lease_expires_at = NULL,
        finished_at = clock_timestamp(),
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
    RETURNING * INTO job_row;
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
    IF should_retry THEN
      UPDATE public.jobs
      SET status = 'RETRY_SCHEDULED',
          stage = 'retry_scheduled',
          retry_at = retry_at_value,
          error_summary = jsonb_build_object('code', p_error_code),
          lease_owner = NULL,
          lease_expires_at = NULL,
          version = version + 1,
          updated_at = clock_timestamp()
      WHERE id = p_job_id
      RETURNING * INTO job_row;
    ELSE
      SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED'),
        COUNT(*) FILTER (WHERE status = 'FAILED_FINAL'),
        COUNT(*) FILTER (WHERE status IN ('PENDING','QUEUED','RUNNING','FAILED_RETRYABLE'))
      INTO completed_count, failed_count, remaining_count
      FROM public.job_items
      WHERE job_id = p_job_id;
      next_status := CASE
        WHEN remaining_count > 0 THEN 'QUEUED'::public."JobStatus"
        WHEN completed_count = 0 THEN 'FAILED_FINAL'::public."JobStatus"
        ELSE 'PARTIALLY_COMPLETED'::public."JobStatus" END;
      UPDATE public.jobs
      SET status = next_status,
          stage = CASE WHEN remaining_count > 0 THEN 'collecting' ELSE 'failed' END,
          progress_current = completed_count,
          retry_at = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_summary = jsonb_build_object('code', p_error_code, 'failed', failed_count),
          result_summary = CASE WHEN remaining_count = 0
            THEN jsonb_build_object('completed', completed_count, 'failed', failed_count)
            ELSE result_summary END,
          finished_at = CASE WHEN remaining_count = 0 THEN clock_timestamp() ELSE NULL END,
          version = version + 1,
          updated_at = clock_timestamp()
      WHERE id = p_job_id
      RETURNING * INTO job_row;
    END IF;
  ELSE
    UPDATE public.job_items
    SET status = 'COMPLETED',
        output_reference = '{"snapshotCount":1}'::jsonb,
        retry_at = NULL,
        error = NULL,
        updated_at = clock_timestamp()
    WHERE id = ANY(p_job_item_ids);
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED'),
      COUNT(*) FILTER (WHERE status = 'FAILED_FINAL'),
      COUNT(*) FILTER (WHERE status IN ('PENDING','QUEUED','RUNNING','FAILED_RETRYABLE'))
    INTO completed_count, failed_count, remaining_count
    FROM public.job_items
    WHERE job_id = p_job_id;
    next_status := CASE
      WHEN remaining_count > 0 THEN 'QUEUED'::public."JobStatus"
      WHEN failed_count = 0 THEN 'COMPLETED'::public."JobStatus"
      ELSE 'PARTIALLY_COMPLETED'::public."JobStatus" END;
    UPDATE public.jobs
    SET status = next_status,
        stage = CASE WHEN remaining_count > 0 THEN 'collecting' ELSE 'completed' END,
        progress_current = completed_count,
        retry_at = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        result_summary = CASE WHEN remaining_count = 0
          THEN jsonb_build_object('completed', completed_count, 'failed', failed_count)
          ELSE result_summary END,
        error_summary = CASE WHEN remaining_count = 0 AND failed_count > 0
          THEN jsonb_build_object('code', 'ITEMS_FAILED', 'failed', failed_count)
          ELSE NULL END,
        finished_at = CASE WHEN remaining_count = 0 THEN clock_timestamp() ELSE NULL END,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
    RETURNING * INTO job_row;
  END IF;
  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

CREATE FUNCTION public.defer_ai_answer_collection_batch(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_provider_request_id TEXT, p_retry_after_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT * FROM public._transition_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    'DEFER', p_provider_request_id, p_retry_after_seconds, NULL
  )
$$;

CREATE FUNCTION public.fail_ai_answer_collection_batch(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_error_code TEXT, p_retry_after_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT * FROM public._transition_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    'FAIL', NULL, p_retry_after_seconds, p_error_code
  )
$$;

CREATE FUNCTION public.defer_ai_answer_collection_batch_capacity(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_retry_after_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT * FROM public._transition_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    'CAPACITY', NULL, p_retry_after_seconds, NULL
  )
$$;

CREATE FUNCTION public.quarantine_ai_answer_collection_batch_submit(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT, p_job_version INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT * FROM public._transition_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    'QUARANTINE', NULL, NULL, NULL
  )
$$;

CREATE FUNCTION public.complete_ai_answer_collection_batch(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT, p_job_version INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT * FROM public._transition_ai_answer_collection_batch(
    p_job_id, p_job_item_ids, p_lease_owner, p_job_version,
    'COMPLETE', NULL, NULL, NULL
  )
$$;

REVOKE ALL ON FUNCTION public.claim_ai_answer_collection_batch(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_ai_answer_collection_batch_lease(UUID, UUID[], TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_ai_answer_collection_batch_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._transition_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_ai_answer_collection_batch_capacity(UUID, UUID[], TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quarantine_ai_answer_collection_batch_submit(UUID, UUID[], TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER) FROM PUBLIC;

COMMIT;

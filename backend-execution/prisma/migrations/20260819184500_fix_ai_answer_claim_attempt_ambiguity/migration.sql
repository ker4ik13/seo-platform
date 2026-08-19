BEGIN;

-- RETURNS TABLE exposes `attempt` as a PL/pgSQL output variable. Qualify both
-- target-table reads so claim execution cannot confuse that variable with the
-- persisted retry counters.
CREATE OR REPLACE FUNCTION public.claim_ai_answer_collection_batch(
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

  UPDATE public.job_items AS claimed_item
  SET status = 'RUNNING',
      retry_at = NULL,
      error = NULL,
      attempt = claimed_item.attempt + 1,
      updated_at = clock_timestamp()
  WHERE claimed_item.id = ANY(item_ids)
    AND claimed_item.job_id = job_row.id
    AND claimed_item.workspace_id = job_row.workspace_id
    AND claimed_item.project_id = job_row.project_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'AI answer collection batch claim changed concurrently';
  END IF;

  UPDATE public.jobs AS claimed_job
  SET status = 'RUNNING',
      stage = CASE WHEN first_item.provider_request_id IS NULL
        THEN 'collecting' ELSE 'provider_poll' END,
      started_at = COALESCE(claimed_job.started_at, clock_timestamp()),
      retry_at = NULL,
      lease_owner = p_lease_owner,
      lease_expires_at = expires_at,
      attempt = claimed_job.attempt + 1,
      version = claimed_job.version + 1,
      updated_at = clock_timestamp()
  WHERE claimed_job.id = job_row.id
  RETURNING claimed_job.* INTO job_row;

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

COMMIT;

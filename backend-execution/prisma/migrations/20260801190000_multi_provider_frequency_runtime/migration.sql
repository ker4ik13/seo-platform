BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.integration_credentials
    WHERE provider = 'ARSENKIN'
      AND jsonb_typeof(capabilities) IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Arsenkin credential capabilities must be JSON arrays';
  END IF;
END
$$;

UPDATE public.integration_credentials
SET capabilities = capabilities || '["WORDSTAT"]'::jsonb,
    version = version + 1,
    updated_at = clock_timestamp()
WHERE provider = 'ARSENKIN'
  AND deleted_at IS NULL
  AND NOT capabilities ? 'WORDSTAT';

DROP FUNCTION public.claim_frequency_collection_item(TEXT, INTEGER);

CREATE FUNCTION public.claim_frequency_collection_item(
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
  "provider" TEXT,
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
  item_row public.job_items%ROWTYPE;
  credential_row public.integration_credentials%ROWTYPE;
  credential_id UUID;
  expires_at TIMESTAMPTZ;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'invalid frequency collection claim';
  END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);

  SELECT job.*
  INTO job_row
  FROM public.jobs job
  WHERE job.type = 'FREQUENCY_COLLECTION'
    AND job.project_id IS NOT NULL
    AND job.actor_id IS NOT NULL
    AND job.provider IN ('XMLSTOCK', 'ARSENKIN')
    AND job.status IN (
      'QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT',
      'RETRY_SCHEDULED', 'FAILED_RETRYABLE'
    )
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

  SELECT item.*
  INTO item_row
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

  IF COALESCE(job_row.scope_snapshot->>'credentialId', '')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
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
    AND credential.provider = job_row.provider
    AND credential.provider IN ('XMLSTOCK', 'ARSENKIN')
    AND credential.mode = 'BYOK_API_KEY'
    AND credential.status = 'ACTIVE'
    AND credential.deleted_at IS NULL
    AND credential.capabilities ? 'WORDSTAT'
    AND EXISTS (
      SELECT 1
      FROM public.project_connector_bindings binding
      JOIN public.project_connector_routes route
        ON route.binding_id = binding.id
       AND route.workspace_id = binding.workspace_id
       AND route.project_id = binding.project_id
      WHERE binding.workspace_id = job_row.workspace_id
        AND binding.project_id = job_row.project_id
        AND binding.capability = 'WORDSTAT'
        AND binding.enabled
        AND route.position = 0
        AND route.credential_id = credential.id
        AND route.id::TEXT = job_row.scope_snapshot->>'routeId'
    );

  IF NOT FOUND THEN
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        finished_at = clock_timestamp(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = job_row.id;
    RETURN;
  END IF;

  UPDATE public.job_items
  SET status = 'RUNNING',
      retry_at = NULL,
      error = NULL,
      attempt = attempt + 1,
      updated_at = clock_timestamp()
  WHERE id = item_row.id
  RETURNING * INTO item_row;

  UPDATE public.jobs
  SET status = 'RUNNING',
      stage = CASE WHEN item_row.provider_request_id IS NULL
        THEN 'collecting' ELSE 'waiting_provider' END,
      started_at = COALESCE(started_at, clock_timestamp()),
      retry_at = NULL,
      lease_owner = p_lease_owner,
      lease_expires_at = expires_at,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = job_row.id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT
    job_row.id,
    item_row.id,
    job_row.workspace_id,
    job_row.project_id,
    job_row.actor_id,
    credential_row.id,
    credential_row.provider,
    item_row.provider_request_id,
    (item_row.input_reference->>'keywordId')::UUID,
    (item_row.input_reference->>'version')::INTEGER,
    item_row.attempt,
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
    credential_row.key_version;
END
$$;

CREATE FUNCTION public.defer_frequency_collection_item(
  p_job_id UUID,
  p_job_item_id UUID,
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_provider_request_id TEXT,
  p_retry_after_seconds INTEGER
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
BEGIN
  IF p_provider_request_id !~ '^[A-Za-z0-9._:-]{1,255}$'
     OR p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid frequency deferral';
  END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'FREQUENCY_COLLECTION'
    AND job.provider = 'ARSENKIN'
    AND job.status = 'RUNNING'
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
    AND job.version = p_job_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.job_items
  SET status = 'FAILED_RETRYABLE',
      provider_request_id = p_provider_request_id,
      retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      error = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_job_item_id
    AND job_id = p_job_id
    AND workspace_id = job_row.workspace_id
    AND project_id = job_row.project_id
    AND status = 'RUNNING'
    AND (provider_request_id IS NULL OR provider_request_id = p_provider_request_id);
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.jobs
  SET status = 'RETRY_SCHEDULED',
      stage = 'waiting_provider',
      retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      error_summary = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

REVOKE ALL ON FUNCTION
  public.claim_frequency_collection_item(TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.defer_frequency_collection_item(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER)
  FROM PUBLIC;

COMMIT;

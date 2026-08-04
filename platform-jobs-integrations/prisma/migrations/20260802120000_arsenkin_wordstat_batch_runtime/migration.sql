BEGIN;

CREATE FUNCTION public.claim_frequency_collection_batch(
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
  first_row RECORD;
  extra_ids UUID[] := ARRAY[]::UUID[];
  item_ids UUID[];
  updated_count INTEGER;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 60
     OR p_max_batch_items NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid frequency collection batch claim';
  END IF;

  SELECT *
  INTO first_row
  FROM public.claim_frequency_collection_item(
    p_lease_owner,
    p_lease_seconds
  );
  IF NOT FOUND THEN RETURN; END IF;

  item_ids := ARRAY[first_row."jobItemId"::UUID];
  IF first_row."provider" = 'ARSENKIN' AND p_max_batch_items > 1 THEN
    SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.sequence, candidate.id), ARRAY[]::UUID[])
    INTO extra_ids
    FROM (
      SELECT item.id, item.sequence
      FROM public.job_items item
      WHERE item.job_id = first_row."jobId"
        AND item.workspace_id = first_row."workspaceId"
        AND item.project_id = first_row."projectId"
        AND item.id <> first_row."jobItemId"
        AND item.status IN ('PENDING', 'QUEUED', 'RUNNING', 'FAILED_RETRYABLE')
        AND (item.retry_at IS NULL OR item.retry_at <= clock_timestamp())
        AND (
          (
            first_row."providerRequestId" IS NULL
            AND item.provider_request_id IS NULL
          )
          OR item.provider_request_id = first_row."providerRequestId"
        )
      ORDER BY item.sequence, item.id
      LIMIT (p_max_batch_items - 1)
      FOR UPDATE OF item SKIP LOCKED
    ) candidate;

    IF cardinality(extra_ids) > 0 THEN
      UPDATE public.job_items
      SET status = 'RUNNING',
          retry_at = NULL,
          error = NULL,
          attempt = attempt + 1,
          updated_at = clock_timestamp()
      WHERE id = ANY(extra_ids)
        AND job_id = first_row."jobId"
        AND workspace_id = first_row."workspaceId"
        AND project_id = first_row."projectId";
      GET DIAGNOSTICS updated_count = ROW_COUNT;
      IF updated_count <> cardinality(extra_ids) THEN
        RAISE EXCEPTION 'frequency batch claim changed concurrently';
      END IF;
      item_ids := item_ids || extra_ids;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    first_row."jobId"::UUID,
    item.id,
    first_row."workspaceId"::UUID,
    first_row."projectId"::UUID,
    first_row."actorId"::UUID,
    first_row."credentialId"::UUID,
    first_row."provider"::TEXT,
    item.provider_request_id::TEXT,
    (item.input_reference->>'keywordId')::UUID,
    (item.input_reference->>'version')::INTEGER,
    item.attempt,
    first_row."maxAttempts"::INTEGER,
    first_row."inputSnapshot"::JSONB,
    first_row."jobVersion"::INTEGER,
    first_row."leaseExpiresAt"::TIMESTAMPTZ,
    first_row."ciphertext"::BYTEA,
    first_row."nonce"::BYTEA,
    first_row."authTag"::BYTEA,
    first_row."encryptedDataKey"::BYTEA,
    first_row."dataKeyNonce"::BYTEA,
    first_row."dataKeyAuthTag"::BYTEA,
    first_row."keyVersion"::INTEGER
  FROM public.job_items item
  WHERE item.id = ANY(item_ids)
  ORDER BY item.sequence, item.id;
END
$$;

CREATE FUNCTION public.complete_frequency_collection_batch(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_snapshot_count INTEGER
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
  completed_count BIGINT;
  failed_count BIGINT;
  remaining_count BIGINT;
  terminal_status public."JobStatus";
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 200
     OR p_snapshot_count NOT BETWEEN 1 AND 3
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count THEN
    RAISE EXCEPTION 'invalid frequency batch completion';
  END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'FREQUENCY_COLLECTION'
    AND job.status = 'RUNNING'
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

  UPDATE public.job_items
  SET status = 'COMPLETED',
      output_reference = jsonb_build_object('snapshotCount', p_snapshot_count),
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

  terminal_status := CASE
    WHEN remaining_count > 0 THEN 'QUEUED'::public."JobStatus"
    WHEN failed_count = 0 THEN 'COMPLETED'::public."JobStatus"
    WHEN completed_count = 0 THEN 'FAILED_FINAL'::public."JobStatus"
    ELSE 'PARTIALLY_COMPLETED'::public."JobStatus"
  END;

  UPDATE public.jobs
  SET status = terminal_status,
      progress_current = completed_count,
      lease_owner = NULL,
      lease_expires_at = NULL,
      retry_at = NULL,
      result_summary = CASE
        WHEN remaining_count = 0
        THEN jsonb_build_object('completed', completed_count, 'failed', failed_count)
        ELSE result_summary
      END,
      error_summary = CASE
        WHEN remaining_count = 0 AND failed_count > 0
        THEN jsonb_build_object('code', 'ITEMS_FAILED', 'failed', failed_count)
        ELSE NULL
      END,
      finished_at = CASE WHEN remaining_count = 0 THEN clock_timestamp() ELSE NULL END,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

CREATE FUNCTION public.defer_frequency_collection_batch(
  p_job_id UUID,
  p_job_item_ids UUID[],
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
  expected_count INTEGER;
  matched_count INTEGER;
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 200
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_provider_request_id !~ '^[A-Za-z0-9._:-]{1,255}$'
     OR p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid frequency batch deferral';
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

  SELECT COUNT(*) INTO matched_count
  FROM public.job_items item
  WHERE item.id = ANY(p_job_item_ids)
    AND item.job_id = p_job_id
    AND item.workspace_id = job_row.workspace_id
    AND item.project_id = job_row.project_id
    AND item.status = 'RUNNING'
    AND (item.provider_request_id IS NULL OR item.provider_request_id = p_provider_request_id);
  IF matched_count <> expected_count THEN RETURN; END IF;

  UPDATE public.job_items
  SET status = 'FAILED_RETRYABLE',
      provider_request_id = p_provider_request_id,
      retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      error = NULL,
      updated_at = clock_timestamp()
  WHERE id = ANY(p_job_item_ids);

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

CREATE FUNCTION public.fail_frequency_collection_batch(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
  p_error_code TEXT,
  p_retry_after_seconds INTEGER
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
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL
     OR expected_count NOT BETWEEN 1 AND 200
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
     OR (p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN 5 AND 3600) THEN
    RAISE EXCEPTION 'invalid frequency batch failure';
  END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = p_job_id
    AND job.type = 'FREQUENCY_COLLECTION'
    AND job.status = 'RUNNING'
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
    AND item.status = 'RUNNING';
  IF matched_count <> expected_count THEN RETURN; END IF;

  should_retry := p_retry_after_seconds IS NOT NULL AND all_below_attempt_limit;
  UPDATE public.job_items
  SET status = CASE
        WHEN should_retry THEN 'FAILED_RETRYABLE'::public."JobItemStatus"
        ELSE 'FAILED_FINAL'::public."JobItemStatus"
      END,
      retry_at = CASE
        WHEN should_retry
        THEN clock_timestamp() + make_interval(secs => p_retry_after_seconds)
        ELSE NULL
      END,
      error = jsonb_build_object('code', p_error_code),
      updated_at = clock_timestamp()
  WHERE id = ANY(p_job_item_ids);

  IF should_retry THEN
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED',
        retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
        error_summary = jsonb_build_object('code', p_error_code),
        lease_owner = NULL,
        lease_expires_at = NULL,
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
    RETURNING * INTO job_row;
    RETURN QUERY SELECT job_row.id, job_row.version;
    RETURN;
  END IF;

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
    ELSE 'PARTIALLY_COMPLETED'::public."JobStatus"
  END;
  UPDATE public.jobs
  SET status = next_status,
      progress_current = completed_count,
      retry_at = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      error_summary = jsonb_build_object('code', p_error_code, 'failed', failed_count),
      result_summary = CASE
        WHEN remaining_count = 0
        THEN jsonb_build_object('completed', completed_count, 'failed', failed_count)
        ELSE result_summary
      END,
      finished_at = CASE WHEN remaining_count = 0 THEN clock_timestamp() ELSE NULL END,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO job_row;
  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

REVOKE ALL ON FUNCTION
  public.claim_frequency_collection_batch(TEXT, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.complete_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.defer_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.fail_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)
  FROM PUBLIC;

COMMIT;

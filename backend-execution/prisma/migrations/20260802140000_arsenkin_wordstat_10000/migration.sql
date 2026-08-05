BEGIN;

-- The public command is capped by provider before work reaches this runtime.
-- Keep one claimed Arsenkin batch equal to one paid remote Wordstat task.
DO $migration$
DECLARE
  function_signature TEXT;
  function_definition TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.claim_frequency_collection_batch(text,integer,integer)',
    'public.complete_frequency_collection_batch(uuid,uuid[],text,integer,integer)',
    'public.defer_frequency_collection_batch(uuid,uuid[],text,integer,text,integer)',
    'public.fail_frequency_collection_batch(uuid,uuid[],text,integer,text,integer)'
  ]
  LOOP
    SELECT pg_get_functiondef(function_signature::regprocedure)
    INTO function_definition;
    IF position('BETWEEN 1 AND 200' IN function_definition) = 0 THEN
      RAISE EXCEPTION 'unexpected frequency batch bound in %', function_signature;
    END IF;
    function_definition := replace(
      function_definition,
      'BETWEEN 1 AND 200',
      'BETWEEN 1 AND 10000'
    );
    EXECUTE function_definition;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.defer_frequency_collection_batch(uuid,uuid[],text,integer,text,integer)'::regprocedure
  )
  INTO function_definition;
  IF position(
    'AND (item.provider_request_id IS NULL OR item.provider_request_id = p_provider_request_id)'
    IN function_definition
  ) = 0 THEN
    RAISE EXCEPTION 'unexpected frequency batch provider task guard';
  END IF;
  function_definition := replace(
    function_definition,
    'AND (item.provider_request_id IS NULL OR item.provider_request_id = p_provider_request_id)',
    E'AND (\n      item.provider_request_id IS NULL\n      OR item.provider_request_id = p_provider_request_id\n      OR item.provider_request_id ~ ''^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$''\n    )'
  );
  EXECUTE function_definition;
END
$migration$;

-- Reserve a shared Arsenkin provider slot and durably record that the paid
-- submit may have happened before making the external HTTP request. A worker
-- that crashes after this point must fail closed instead of submitting again.
CREATE FUNCTION public.mark_frequency_collection_batch_submitting(
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
     OR p_lease_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'invalid frequency submit marker';
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('seo-platform:arsenkin-rank-submit', 0)
  ) THEN
    RETURN;
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

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.status IN ('CLAIMED','SUBMITTING','POLL_WAIT','FETCHING')
    ) + (
      SELECT COUNT(DISTINCT frequency_job.id)
      FROM public.jobs frequency_job
      JOIN public.job_items item
        ON item.job_id = frequency_job.id
       AND item.workspace_id = frequency_job.workspace_id
       AND item.project_id = frequency_job.project_id
      WHERE frequency_job.id <> p_job_id
        AND frequency_job.type = 'FREQUENCY_COLLECTION'
        AND frequency_job.provider = 'ARSENKIN'
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

CREATE FUNCTION public.renew_frequency_collection_batch_lease(
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
     OR p_lease_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'invalid frequency lease renewal';
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

  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  UPDATE public.jobs
  SET lease_expires_at = expires_at,
      updated_at = clock_timestamp()
  WHERE id = p_job_id;

  RETURN QUERY SELECT job_row.id, job_row.version, expires_at;
END
$$;

CREATE FUNCTION public.defer_frequency_collection_batch_capacity(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER,
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
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid frequency capacity deferral';
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
    AND item.provider_request_id IS NULL
    AND item.attempt > 0;
  IF matched_count <> expected_count THEN RETURN; END IF;

  UPDATE public.job_items
  SET status = 'FAILED_RETRYABLE',
      attempt = attempt - 1,
      retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      error = jsonb_build_object('code', 'PROVIDER_CONCURRENCY_LIMITED'),
      updated_at = clock_timestamp()
  WHERE id = ANY(p_job_item_ids);

  UPDATE public.jobs
  SET status = 'RETRY_SCHEDULED',
      stage = 'waiting_provider_capacity',
      retry_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      error_summary = jsonb_build_object('code', 'PROVIDER_CONCURRENCY_LIMITED'),
      lease_owner = NULL,
      lease_expires_at = NULL,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

CREATE FUNCTION public.quarantine_frequency_collection_batch_submit(
  p_job_id UUID,
  p_job_item_ids UUID[],
  p_lease_owner TEXT,
  p_job_version INTEGER
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
     OR expected_count NOT BETWEEN 1 AND 10000
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count THEN
    RAISE EXCEPTION 'invalid ambiguous frequency submit quarantine';
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
    AND item.provider_request_id ~ '^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  IF matched_count <> expected_count THEN RETURN; END IF;

  UPDATE public.job_items
  SET status = 'FAILED_FINAL',
      retry_at = NULL,
      error = jsonb_build_object('code', 'PROVIDER_TRANSPORT_AMBIGUOUS'),
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
      lease_owner = NULL,
      lease_expires_at = NULL,
      finished_at = clock_timestamp(),
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT job_row.id, job_row.version;
END
$$;

-- Rank and Wordstat share the same remote account limit. Rank claims already
-- reserve a slot; include durable Wordstat submit markers/tasks in that count.
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
  active_provider_tasks BIGINT;
BEGIN
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('seo-platform:arsenkin-rank-submit', 0)
  ) THEN
    RETURN;
  END IF;

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.status IN ('CLAIMED','SUBMITTING','POLL_WAIT','FETCHING')
    ) + (
      SELECT COUNT(DISTINCT frequency_job.id)
      FROM public.jobs frequency_job
      JOIN public.job_items item
        ON item.job_id = frequency_job.id
       AND item.workspace_id = frequency_job.workspace_id
       AND item.project_id = frequency_job.project_id
      WHERE frequency_job.type = 'FREQUENCY_COLLECTION'
        AND frequency_job.provider = 'ARSENKIN'
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
REVOKE ALL ON FUNCTION
  public.mark_frequency_collection_batch_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.renew_frequency_collection_batch_lease(UUID, UUID[], TEXT, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.defer_frequency_collection_batch_capacity(UUID, UUID[], TEXT, INTEGER, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.quarantine_frequency_collection_batch_submit(UUID, UUID[], TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)
  FROM PUBLIC;

COMMIT;

BEGIN;

-- Keep the established credential/routing/job lease fences. Only widen the
-- XMLStock item window (50); physical Wordstat concurrency is enforced by
-- the HTTP quota permit and a ten-item execution wave, not by SQL batch size.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition := pg_get_functiondef('public.claim_frequency_collection_batch(text,integer,integer)'::regprocedure);
  updated := replace(definition,
    $old$IF first_row."provider" = 'ARSENKIN' AND p_max_batch_items > 1 THEN$old$,
    $new$IF first_row."provider" IN ('ARSENKIN', 'XMLSTOCK') AND p_max_batch_items > 1 THEN$new$);
  updated := replace(updated,
    'LIMIT (p_max_batch_items - 1)',
    'LIMIT (CASE WHEN first_row."provider" = ''XMLSTOCK'' THEN LEAST(p_max_batch_items, 50) ELSE p_max_batch_items END - 1)');
  IF updated = definition OR position('LEAST(p_max_batch_items, 50)' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected frequency batch claim boundary was not found';
  END IF;
  EXECUTE updated;
END $$;

-- Rank submit and poll fetch ID hints in one read. Every actual page still
-- obtains its own fenced lease before any provider HTTP call.
DO $$
DECLARE signature REGPROCEDURE; definition TEXT; updated TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.list_rank_connector_submit_candidates(text,integer,integer,uuid[])'::regprocedure,
    'public.list_rank_connector_poll_candidates(text,integer,uuid[])'::regprocedure,
    'public.list_rank_connector_poll_candidates_for_worker(text,integer,uuid[],text)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(signature);
    updated := replace(definition, 'p_limit NOT BETWEEN 1 AND 30', 'p_limit NOT BETWEEN 1 AND 100');
    IF updated = definition THEN RAISE EXCEPTION 'Expected rank ID window bound was not found: %', signature; END IF;
    EXECUTE updated;
  END LOOP;
END $$;

-- Interleave search products before applying the 100-ID page limit. A large
-- Live backlog must not repeatedly fill the page ahead of one Google XML or
-- Yandex XML job. This is an ID hint ordering only; per-page fences remain.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition := pg_get_functiondef(
    'public.list_rank_connector_poll_candidates_for_worker(text,integer,uuid[],text)'::regprocedure);
  updated := replace(definition,
    'ROW_NUMBER() OVER (',
    'ROW_NUMBER() OVER (PARTITION BY COALESCE(execution.provider_wire_request_snapshot->>''engine'', ''UNKNOWN''), COALESCE(execution.provider_wire_request_snapshot->>''delayed'', ''false''), COALESCE(execution.provider_wire_request_snapshot->>''turbo'', ''false'') ORDER BY execution.created_at, execution.id) AS product_turn, ROW_NUMBER() OVER (');
  updated := replace(updated,
    'ORDER BY COALESCE(active.active_count, 0), due.job_turn,',
    'ORDER BY due.product_turn, COALESCE(active.active_count, 0), due.job_turn,');
  IF updated = definition OR position('AS product_turn' IN updated) = 0 OR
     position('ORDER BY due.product_turn' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected rank product fairness boundary was not found';
  END IF;
  EXECUTE updated;
END $$;

-- One atomic parent transition for mixed results. Successful phrases must not
-- be reissued because a neighbour is waiting for capacity or failed.
CREATE FUNCTION public.settle_xmlstock_frequency_batch(
  p_job_id UUID, p_job_item_ids UUID[], p_lease_owner TEXT,
  p_job_version INTEGER, p_snapshot_count INTEGER, p_outcomes JSONB,
  p_finalize BOOLEAN
)
RETURNS TABLE ("jobId" UUID, "jobVersion" INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  job_row public.jobs%ROWTYPE;
  expected_count INTEGER;
  matched_count INTEGER;
  completed_count BIGINT;
  failed_count BIGINT;
  remaining_count BIGINT;
  next_retry TIMESTAMPTZ;
  next_status public."JobStatus";
BEGIN
  expected_count := cardinality(p_job_item_ids);
  IF p_job_item_ids IS NULL OR expected_count NOT BETWEEN 1 AND 10
     OR (SELECT COUNT(DISTINCT id) FROM unnest(p_job_item_ids) id) <> expected_count
     OR p_finalize IS NULL
     OR p_snapshot_count IS NULL OR p_snapshot_count NOT BETWEEN 1 AND 3
     OR p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' THEN
    RAISE EXCEPTION 'invalid XMLStock frequency settlement';
  END IF;
  IF jsonb_array_length(p_outcomes) <> expected_count
     OR (SELECT COUNT(DISTINCT entry->>'jobItemId') FROM jsonb_array_elements(p_outcomes) entry) <> expected_count
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_outcomes) entry
       WHERE jsonb_typeof(entry) <> 'object'
          OR NOT (entry->>'jobItemId')::UUID = ANY(p_job_item_ids)
          OR COALESCE(entry->>'status', '') NOT IN ('COMPLETED', 'CAPACITY', 'FAILED')
          OR (entry->>'status' <> 'COMPLETED' AND
              (COALESCE(entry->>'retryAfterSeconds', '') !~ '^[0-9]{1,4}$'
               OR (entry->>'retryAfterSeconds')::INTEGER NOT BETWEEN 1 AND 3600))
          OR (entry->>'status' = 'FAILED' AND
              (COALESCE(entry->>'code', '') !~ '^[A-Z][A-Z0-9_]{0,63}$'
               OR jsonb_typeof(entry->'retryable') IS DISTINCT FROM 'boolean'))
     ) THEN
    RAISE EXCEPTION 'invalid XMLStock frequency outcomes';
  END IF;

  SELECT job.* INTO job_row FROM public.jobs job
  WHERE job.id = p_job_id AND job.type = 'FREQUENCY_COLLECTION'
    AND job.provider = 'XMLSTOCK' AND job.status = 'RUNNING'
    AND job.cancel_requested_at IS NULL AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp() AND job.version = p_job_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*) INTO matched_count FROM public.job_items item
  WHERE item.id = ANY(p_job_item_ids) AND item.job_id = job_row.id
    AND item.workspace_id = job_row.workspace_id AND item.project_id = job_row.project_id
    AND item.status = 'RUNNING';
  IF matched_count <> expected_count THEN RETURN; END IF;

  UPDATE public.job_items item SET
    status = CASE
      WHEN outcome->>'status' = 'COMPLETED' THEN 'COMPLETED'::public."JobItemStatus"
      WHEN outcome->>'status' = 'CAPACITY' OR
        ((outcome->>'retryable')::BOOLEAN AND item.attempt < job_row.max_attempts)
        THEN 'FAILED_RETRYABLE'::public."JobItemStatus"
      ELSE 'FAILED_FINAL'::public."JobItemStatus" END,
    attempt = CASE WHEN outcome->>'status' = 'CAPACITY' THEN GREATEST(0, item.attempt - 1) ELSE item.attempt END,
    output_reference = CASE WHEN outcome->>'status' = 'COMPLETED'
      THEN jsonb_build_object('snapshotCount', p_snapshot_count) ELSE item.output_reference END,
    retry_at = CASE WHEN outcome->>'status' = 'CAPACITY' OR
      ((outcome->>'retryable')::BOOLEAN AND item.attempt < job_row.max_attempts)
      THEN clock_timestamp() + make_interval(secs => (outcome->>'retryAfterSeconds')::INTEGER) ELSE NULL END,
    error = CASE WHEN outcome->>'status' = 'FAILED' THEN jsonb_build_object('code', outcome->>'code') ELSE NULL END,
    updated_at = clock_timestamp()
  FROM jsonb_array_elements(p_outcomes) outcome
  WHERE item.id = (outcome->>'jobItemId')::UUID;

  SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED'),
    COUNT(*) FILTER (WHERE status = 'FAILED_FINAL'),
    COUNT(*) FILTER (WHERE status IN ('PENDING','QUEUED','RUNNING','FAILED_RETRYABLE')),
    MIN(CASE WHEN status IN ('PENDING','QUEUED','RUNNING','FAILED_RETRYABLE')
      THEN COALESCE(retry_at, clock_timestamp()) END)
  INTO completed_count, failed_count, remaining_count, next_retry
  FROM public.job_items WHERE job_id = p_job_id;
  next_status := CASE
    WHEN NOT p_finalize THEN 'RUNNING'::public."JobStatus"
    WHEN remaining_count > 0 AND next_retry > clock_timestamp() THEN 'RETRY_SCHEDULED'::public."JobStatus"
    WHEN remaining_count > 0 THEN 'QUEUED'::public."JobStatus"
    WHEN failed_count = 0 THEN 'COMPLETED'::public."JobStatus"
    WHEN completed_count = 0 THEN 'FAILED_FINAL'::public."JobStatus"
    ELSE 'PARTIALLY_COMPLETED'::public."JobStatus" END;

  UPDATE public.jobs SET status = next_status, progress_current = completed_count,
    lease_owner = CASE WHEN p_finalize THEN NULL ELSE lease_owner END,
    lease_expires_at = CASE WHEN p_finalize THEN NULL ELSE lease_expires_at END,
    retry_at = CASE WHEN next_status = 'RETRY_SCHEDULED' THEN next_retry ELSE NULL END,
    result_summary = CASE WHEN p_finalize AND remaining_count = 0 THEN
      jsonb_build_object('completed', completed_count, 'failed', failed_count) ELSE result_summary END,
    error_summary = CASE WHEN failed_count > 0 THEN
      jsonb_build_object('code', 'ITEMS_FAILED', 'failed', failed_count) ELSE NULL END,
    finished_at = CASE WHEN p_finalize AND remaining_count = 0 THEN clock_timestamp() ELSE NULL END,
    version = version + 1, updated_at = clock_timestamp()
  WHERE id = p_job_id RETURNING * INTO job_row;
  RETURN QUERY SELECT job_row.id, job_row.version;
END $$;

REVOKE ALL ON FUNCTION public.settle_xmlstock_frequency_batch(UUID, UUID[], TEXT, INTEGER, INTEGER, JSONB, BOOLEAN) FROM PUBLIC;
COMMIT;

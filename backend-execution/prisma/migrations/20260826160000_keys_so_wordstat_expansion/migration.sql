BEGIN;

ALTER TABLE public.keyword_research_runs
  DROP CONSTRAINT keyword_research_runs_values_check;

ALTER TABLE public.keyword_research_runs
  ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'KEYS_SO',
  ADD COLUMN input_snapshot JSONB,
  ADD COLUMN provider_task_id VARCHAR(255),
  ADD COLUMN overview JSONB,
  ADD COLUMN competitors JSONB,
  ADD COLUMN target_group_path VARCHAR(2048),
  ALTER COLUMN domain DROP NOT NULL,
  ALTER COLUMN database DROP NOT NULL;

UPDATE public.keyword_research_runs
SET input_snapshot = jsonb_build_object(
  'source', 'KEYS_SO',
  'domain', domain,
  'database', database,
  'maxKeywords', max_keywords
)
WHERE input_snapshot IS NULL;

ALTER TABLE public.keyword_research_runs
  ALTER COLUMN input_snapshot SET NOT NULL;

ALTER TABLE public.keyword_research_rows
  DROP CONSTRAINT keyword_research_rows_values_check;

ALTER TABLE public.keyword_research_rows
  ADD COLUMN source_query TEXT,
  ADD COLUMN source_column VARCHAR(8);

ALTER TABLE public.keyword_research_pages
  DROP CONSTRAINT keyword_research_pages_values_check;

ALTER TABLE public.keyword_research_pages
  ADD CONSTRAINT keyword_research_pages_values_check CHECK (
    page >= 1
    AND row_count BETWEEN 0 AND 10000
    AND octet_length(response_hash) = 32
  );

ALTER TABLE public.keyword_research_rows
  ADD CONSTRAINT keyword_research_rows_values_check CHECK (
    ordinal >= 1
    AND length(btrim(keyword)) BETWEEN 1 AND 2000
    AND (url IS NULL OR length(url) BETWEEN 1 AND 8192)
    AND (frequency_base IS NULL OR frequency_base >= 0)
    AND (frequency_exact IS NULL OR frequency_exact >= 0)
    AND (frequency_fixed IS NULL OR frequency_fixed >= 0)
    AND (position IS NULL OR position >= 1)
    AND (
      kei IS NULL
      OR (
        kei >= 0
        AND kei <> 'NaN'::DOUBLE PRECISION
        AND kei <> 'Infinity'::DOUBLE PRECISION
      )
    )
    AND (
      (source_query IS NULL AND source_column IS NULL)
      OR (
        length(btrim(source_query)) BETWEEN 1 AND 400
        AND source_column IN ('LEFT', 'RIGHT')
      )
    )
  );

ALTER TABLE public.keyword_research_runs
  ADD CONSTRAINT keyword_research_runs_values_check CHECK (
    source IN ('KEYS_SO', 'ARSENKIN_WORDSTAT')
    AND jsonb_typeof(input_snapshot) = 'object'
    AND (
      (
        source = 'KEYS_SO'
        AND provider = 'KEYS_SO'
        AND length(domain) BETWEEN 1 AND 253
        AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
        AND database IN (
          'msk','gru','zen','gkv','rnd','ekb','ufa','sar','krr','prm','sam',
          'kry','oms','kzn','che','nsk','nnv','vlg','vrn','spb','mns','tmn',
          'gmns','tom','gny'
        )
        AND max_keywords BETWEEN 25 AND 500
        AND provider_task_id IS NULL
      )
      OR (
        source = 'ARSENKIN_WORDSTAT'
        AND provider = 'ARSENKIN'
        AND domain IS NULL
        AND database IS NULL
        AND max_keywords BETWEEN 1 AND 10000
        AND (
          provider_task_id IS NULL
          OR provider_task_id ~ '^(submitting:[0-9a-f-]{36}|[A-Za-z0-9._:-]{1,255})$'
        )
      )
    )
    AND next_page >= 1
    AND collected_keywords BETWEEN 0 AND max_keywords
    AND selected_keywords BETWEEN 0 AND collected_keywords
    AND imported_keywords BETWEEN 0 AND selected_keywords
    AND (total_available IS NULL OR total_available >= 0)
    AND (overview IS NULL OR jsonb_typeof(overview) = 'object')
    AND (competitors IS NULL OR jsonb_typeof(competitors) = 'array')
    AND (duplicate_policy IS NULL OR duplicate_policy IN (
      'SKIP_EXISTING', 'MERGE_NON_EMPTY', 'OVERWRITE_MAPPED'
    ))
    AND (target_group_path IS NULL OR length(target_group_path) BETWEEN 1 AND 2048)
    AND (entitlement IS NULL OR jsonb_typeof(entitlement) = 'object')
    AND (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
    AND version >= 1
    AND (
      (status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','READY_TO_IMPORT')
        AND duplicate_policy IS NULL AND entitlement IS NULL)
      OR
      (status IN ('IMPORT_QUEUED','IMPORTING','COMPLETED','FAILED')
        AND (
          (duplicate_policy IS NOT NULL AND entitlement IS NOT NULL)
          OR status = 'FAILED'
        ))
      OR status = 'CANCELLED'
    )
  );

DROP FUNCTION public.claim_keyword_research_run(TEXT, INTEGER);
DROP FUNCTION public.complete_keyword_research_page(
  UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA, INTEGER, BOOLEAN
);

CREATE FUNCTION public.claim_keyword_research_run(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "runId" UUID,
  "workspaceId" UUID,
  "projectId" UUID,
  "jobId" UUID,
  "actorId" UUID,
  "credentialId" UUID,
  "source" TEXT,
  "provider" TEXT,
  "domain" TEXT,
  "database" TEXT,
  "inputSnapshot" JSONB,
  "providerTaskId" TEXT,
  "page" INTEGER,
  "maxKeywords" INTEGER,
  "collectedKeywords" INTEGER,
  "jobAttempt" INTEGER,
  "maxAttempts" INTEGER,
  "runVersion" INTEGER,
  "jobVersion" INTEGER,
  "leaseToken" UUID,
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
  candidate public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  credential_row public.integration_credentials%ROWTYPE;
  token UUID := uuidv7();
  expires_at TIMESTAMPTZ;
  required_capability TEXT;
BEGIN
  IF p_lease_owner !~ '^[A-Za-z0-9._:-]{8,100}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'invalid keyword research claim';
  END IF;
  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);

  SELECT run.*
  INTO candidate
  FROM public.keyword_research_runs run
  JOIN public.jobs job ON job.id = run.job_id
  WHERE run.status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED')
    AND (run.retry_at IS NULL OR run.retry_at <= clock_timestamp())
    AND (job.lease_expires_at IS NULL OR job.lease_expires_at <= clock_timestamp())
  ORDER BY run.created_at, run.id
  FOR UPDATE OF run SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = candidate.job_id
  FOR UPDATE;

  required_capability := CASE candidate.source
    WHEN 'KEYS_SO' THEN 'COMPETITOR_RESEARCH'
    WHEN 'ARSENKIN_WORDSTAT' THEN 'WORDSTAT'
    ELSE NULL
  END;

  SELECT credential.* INTO credential_row
  FROM public.integration_credentials credential
  JOIN public.project_connector_bindings binding
    ON binding.id = candidate.binding_id
   AND binding.workspace_id = candidate.workspace_id
   AND binding.project_id = candidate.project_id
  JOIN public.project_connector_routes route
    ON route.id = candidate.route_id
   AND route.binding_id = binding.id
   AND route.credential_id = credential.id
  WHERE credential.id = candidate.credential_id
    AND credential.workspace_id = candidate.workspace_id
    AND credential.provider = candidate.provider
    AND credential.mode = 'BYOK_API_KEY'
    AND credential.status = 'ACTIVE'
    AND credential.deleted_at IS NULL
    AND binding.enabled
    AND binding.capability = required_capability
    AND credential.capabilities ? required_capability;

  IF NOT FOUND THEN
    UPDATE public.keyword_research_runs
    SET status = 'FAILED', failure_code = 'CONNECTOR_NOT_READY',
        finished_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = candidate.id;
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED',
        error_summary = '{"code":"CONNECTOR_NOT_READY"}'::jsonb,
        finished_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = candidate.job_id;
    RETURN;
  END IF;

  UPDATE public.keyword_research_runs
  SET status = 'RUNNING', retry_at = NULL, failure_code = NULL,
      lease_token = token, version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = candidate.id
  RETURNING * INTO candidate;

  UPDATE public.jobs
  SET status = 'RUNNING',
      stage = CASE WHEN candidate.provider_task_id IS NULL
        THEN 'collecting' ELSE 'provider_poll' END,
      started_at = COALESCE(started_at, clock_timestamp()),
      retry_at = NULL, lease_owner = p_lease_owner,
      lease_expires_at = expires_at, version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = candidate.job_id
  RETURNING * INTO job_row;

  RETURN QUERY SELECT
    candidate.id, candidate.workspace_id, candidate.project_id,
    candidate.job_id, candidate.actor_id, candidate.credential_id,
    candidate.source::TEXT, candidate.provider::TEXT,
    candidate.domain::TEXT, candidate.database::TEXT,
    candidate.input_snapshot, candidate.provider_task_id::TEXT,
    candidate.next_page, candidate.max_keywords,
    candidate.collected_keywords, job_row.attempt, job_row.max_attempts,
    candidate.version, job_row.version, token, expires_at,
    credential_row.ciphertext, credential_row.nonce,
    credential_row.auth_tag, credential_row.encrypted_data_key,
    credential_row.data_key_nonce, credential_row.data_key_auth_tag,
    credential_row.key_version;
END
$$;

CREATE FUNCTION public.complete_keyword_research_page(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
  p_rows JSONB,
  p_response_hash BYTEA,
  p_total_available INTEGER,
  p_complete BOOLEAN,
  p_overview JSONB,
  p_competitors JSONB
)
RETURNS TABLE ("runId" UUID, "runVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  row_count INTEGER;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) > 25
     OR octet_length(p_response_hash) <> 32
     OR (p_total_available IS NOT NULL AND p_total_available < 0)
     OR (p_overview IS NOT NULL AND jsonb_typeof(p_overview) <> 'object')
     OR (p_competitors IS NOT NULL AND jsonb_typeof(p_competitors) <> 'array') THEN
    RAISE EXCEPTION 'invalid keyword research page';
  END IF;
  row_count := jsonb_array_length(p_rows);

  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id AND run.source = 'KEYS_SO'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id AND job.status = 'RUNNING'
    AND job.version = p_job_version AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) item
    WHERE jsonb_typeof(item) <> 'object'
      OR jsonb_typeof(item->'keyword') <> 'string'
      OR length(btrim(item->>'keyword')) NOT BETWEEN 1 AND 2000
      OR (item ? 'url' AND (
        jsonb_typeof(item->'url') <> 'string'
        OR length(item->>'url') NOT BETWEEN 1 AND 8192
      ))
  ) THEN RAISE EXCEPTION 'invalid keyword research result row'; END IF;

  INSERT INTO public.keyword_research_pages(
    workspace_id, project_id, run_id, page, response_hash, row_count
  ) VALUES (
    run_row.workspace_id, run_row.project_id, run_row.id, run_row.next_page,
    p_response_hash, row_count
  );

  INSERT INTO public.keyword_research_rows(
    workspace_id, project_id, run_id, ordinal, provider_row_id, keyword, url,
    frequency_base, frequency_exact, frequency_fixed, position, kei
  )
  SELECT run_row.workspace_id, run_row.project_id, run_row.id,
    run_row.collected_keywords + item.ordinality::INTEGER,
    value."providerRowId", btrim(value.keyword), value.url,
    value."frequencyBase", value."frequencyExact", value."frequencyFixed",
    value.position, value.kei
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY item(json, ordinality)
  CROSS JOIN LATERAL jsonb_to_record(item.json) AS value(
    "providerRowId" TEXT, keyword TEXT, url TEXT,
    "frequencyBase" INTEGER, "frequencyExact" INTEGER,
    "frequencyFixed" INTEGER, position INTEGER, kei DOUBLE PRECISION
  );

  UPDATE public.keyword_research_runs
  SET status = CASE WHEN p_complete THEN 'READY_TO_IMPORT'::public."KeywordResearchStatus"
        ELSE 'QUEUED'::public."KeywordResearchStatus" END,
      next_page = next_page + 1,
      total_available = COALESCE(p_total_available, total_available),
      collected_keywords = collected_keywords + row_count,
      overview = COALESCE(p_overview, overview),
      competitors = COALESCE(p_competitors, competitors),
      lease_token = NULL, version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.id RETURNING * INTO run_row;

  UPDATE public.jobs
  SET status = CASE WHEN p_complete THEN 'AWAITING_APPROVAL'::public."JobStatus"
        ELSE 'QUEUED'::public."JobStatus" END,
      stage = CASE WHEN p_complete THEN 'preview' ELSE 'collecting' END,
      progress_current = run_row.collected_keywords,
      lease_owner = NULL, lease_expires_at = NULL,
      version = version + 1, updated_at = clock_timestamp()
  WHERE id = run_row.job_id;

  RETURN QUERY SELECT run_row.id, run_row.version;
END
$$;

CREATE FUNCTION public.mark_keyword_research_submitting(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
  p_submit_marker TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "runId" UUID,
  "runVersion" INTEGER,
  "leaseExpiresAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  active_provider_tasks BIGINT;
  expires_at TIMESTAMPTZ;
BEGIN
  IF p_submit_marker !~ '^submitting:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_lease_seconds NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'invalid keyword research submit marker';
  END IF;
  BEGIN
    PERFORM set_config('lock_timeout', '2000ms', TRUE);
    PERFORM pg_advisory_xact_lock(hashtextextended('seo-platform:rank-dispatch:ARSENKIN', 0));
  EXCEPTION WHEN lock_not_available THEN RETURN;
  END;

  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id AND run.source = 'ARSENKIN_WORDSTAT'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token AND run.provider_task_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id AND job.type = 'KEYWORD_RESEARCH'
    AND job.provider = 'ARSENKIN' AND job.status = 'RUNNING'
    AND job.cancel_requested_at IS NULL AND job.lease_owner = p_lease_owner
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
      WHERE provider_job.id <> run_row.job_id
        AND provider_job.type IN ('FREQUENCY_COLLECTION', 'AI_ANSWER_COLLECTION', 'CLUSTERING_RUN')
        AND provider_job.provider = 'ARSENKIN'
        AND (
          (provider_job.status IN ('RUNNING', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'FAILED_RETRYABLE')
            AND item.status IN ('RUNNING', 'FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL)
          OR (provider_job.status = 'ACTION_REQUIRED' AND item.provider_request_id ~ '^submitting:')
        )
    ) + (
      SELECT COUNT(*)
      FROM public.keyword_research_runs other
      JOIN public.jobs other_job ON other_job.id = other.job_id
      WHERE other.id <> run_row.id
        AND other.source = 'ARSENKIN_WORDSTAT'
        AND other.provider_task_id IS NOT NULL
        AND other.status IN ('RUNNING', 'RETRY_SCHEDULED')
        AND other_job.status IN ('RUNNING', 'RETRY_SCHEDULED', 'ACTION_REQUIRED')
    )
  INTO active_provider_tasks;
  IF active_provider_tasks >= 5 THEN RETURN; END IF;

  expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  UPDATE public.keyword_research_runs
  SET provider_task_id = p_submit_marker, updated_at = clock_timestamp()
  WHERE id = run_row.id;
  UPDATE public.jobs
  SET stage = 'submitting', lease_expires_at = expires_at,
      updated_at = clock_timestamp()
  WHERE id = run_row.job_id;
  RETURN QUERY SELECT run_row.id, run_row.version, expires_at;
END
$$;

CREATE FUNCTION public.transition_wordstat_keyword_research_run(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
  p_action TEXT,
  p_provider_task_id TEXT,
  p_retry_after_seconds INTEGER,
  p_error_code TEXT,
  p_rows JSONB,
  p_response_hash BYTEA
)
RETURNS TABLE ("runId" UUID, "runVersion" INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  retry_at_value TIMESTAMPTZ;
  should_retry BOOLEAN;
  row_count INTEGER;
BEGIN
  IF p_action NOT IN ('DEFER', 'CAPACITY', 'QUARANTINE', 'FAIL', 'COMPLETE') THEN
    RAISE EXCEPTION 'invalid wordstat research transition';
  END IF;
  IF p_action = 'DEFER' AND (
    p_provider_task_id !~ '^[A-Za-z0-9._:-]{1,255}$'
    OR p_retry_after_seconds NOT BETWEEN 5 AND 3600
  ) THEN RAISE EXCEPTION 'invalid wordstat research defer'; END IF;
  IF p_action = 'CAPACITY' AND p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'invalid wordstat research capacity deferral';
  END IF;
  IF p_action = 'FAIL' AND (
    p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    OR (p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds NOT BETWEEN 5 AND 3600)
  ) THEN RAISE EXCEPTION 'invalid wordstat research failure'; END IF;
  IF p_action = 'COMPLETE' AND (
    jsonb_typeof(p_rows) <> 'array'
    OR octet_length(p_response_hash) <> 32
  ) THEN RAISE EXCEPTION 'invalid wordstat research completion'; END IF;

  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id AND run.source = 'ARSENKIN_WORDSTAT'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id AND job.status = 'RUNNING'
    AND job.version = p_job_version AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_action = 'QUARANTINE' AND run_row.provider_task_id !~ '^submitting:' THEN RETURN; END IF;
  IF p_action = 'CAPACITY' AND run_row.provider_task_id IS NOT NULL THEN RETURN; END IF;
  IF p_action = 'DEFER' AND NOT (
    run_row.provider_task_id IS NULL
    OR run_row.provider_task_id = p_provider_task_id
    OR run_row.provider_task_id ~ '^submitting:'
  ) THEN RETURN; END IF;

  IF p_action = 'COMPLETE' THEN
    row_count := jsonb_array_length(p_rows);
    IF row_count > run_row.max_keywords OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_rows) item
      WHERE jsonb_typeof(item) <> 'object'
        OR jsonb_typeof(item->'keyword') <> 'string'
        OR length(btrim(item->>'keyword')) NOT BETWEEN 1 AND 2000
        OR jsonb_typeof(item->'sourceQuery') <> 'string'
        OR length(btrim(item->>'sourceQuery')) NOT BETWEEN 1 AND 400
        OR item->>'sourceColumn' NOT IN ('LEFT', 'RIGHT')
        OR (item ? 'frequencyBase' AND jsonb_typeof(item->'frequencyBase') <> 'number')
    ) THEN RAISE EXCEPTION 'invalid wordstat research result row'; END IF;

    INSERT INTO public.keyword_research_pages(
      workspace_id, project_id, run_id, page, response_hash, row_count
    ) VALUES (
      run_row.workspace_id, run_row.project_id, run_row.id, 1,
      p_response_hash, row_count
    );
    INSERT INTO public.keyword_research_rows(
      workspace_id, project_id, run_id, ordinal, keyword,
      frequency_base, source_query, source_column
    )
    SELECT run_row.workspace_id, run_row.project_id, run_row.id,
      item.ordinality::INTEGER, btrim(value.keyword), value."frequencyBase",
      btrim(value."sourceQuery"), value."sourceColumn"
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY item(json, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(item.json) AS value(
      keyword TEXT, "frequencyBase" INTEGER,
      "sourceQuery" TEXT, "sourceColumn" TEXT
    );
    UPDATE public.keyword_research_runs
    SET status = 'READY_TO_IMPORT', total_available = row_count,
        collected_keywords = row_count, lease_token = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.id RETURNING * INTO run_row;
    UPDATE public.jobs
    SET status = 'AWAITING_APPROVAL', stage = 'preview',
        progress_current = row_count, lease_owner = NULL,
        lease_expires_at = NULL, error_summary = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.job_id;
  ELSIF p_action = 'DEFER' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.keyword_research_runs
    SET status = 'RETRY_SCHEDULED', provider_task_id = p_provider_task_id,
        retry_at = retry_at_value, lease_token = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.id RETURNING * INTO run_row;
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED', stage = 'provider_poll',
        attempt = attempt + 1, retry_at = retry_at_value,
        error_summary = NULL, lease_owner = NULL, lease_expires_at = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.job_id;
  ELSIF p_action = 'CAPACITY' THEN
    retry_at_value := clock_timestamp() + make_interval(secs => p_retry_after_seconds);
    UPDATE public.keyword_research_runs
    SET status = 'RETRY_SCHEDULED', retry_at = retry_at_value,
        lease_token = NULL, version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = run_row.id RETURNING * INTO run_row;
    UPDATE public.jobs
    SET status = 'RETRY_SCHEDULED', stage = 'provider_capacity',
        retry_at = retry_at_value,
        error_summary = '{"code":"PROVIDER_CONCURRENCY_LIMITED"}'::jsonb,
        lease_owner = NULL, lease_expires_at = NULL,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.job_id;
  ELSIF p_action = 'QUARANTINE' THEN
    UPDATE public.keyword_research_runs
    SET status = 'FAILED', failure_code = 'PROVIDER_TRANSPORT_AMBIGUOUS',
        retry_at = NULL, lease_token = NULL, finished_at = clock_timestamp(),
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.id RETURNING * INTO run_row;
    UPDATE public.jobs
    SET status = 'ACTION_REQUIRED', stage = 'submit_ambiguous',
        retry_at = NULL,
        error_summary = '{"code":"PROVIDER_TRANSPORT_AMBIGUOUS","manualReconciliationRequired":true}'::jsonb,
        lease_owner = NULL, lease_expires_at = NULL,
        finished_at = clock_timestamp(), version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = run_row.job_id;
  ELSE
    should_retry := p_retry_after_seconds IS NOT NULL
      AND job_row.attempt + 1 < job_row.max_attempts;
    retry_at_value := CASE WHEN should_retry
      THEN clock_timestamp() + make_interval(secs => p_retry_after_seconds)
      ELSE NULL END;
    UPDATE public.keyword_research_runs
    SET status = CASE WHEN should_retry THEN 'RETRY_SCHEDULED'::public."KeywordResearchStatus"
          ELSE 'FAILED'::public."KeywordResearchStatus" END,
        retry_at = retry_at_value, failure_code = p_error_code,
        provider_task_id = NULL,
        lease_token = NULL,
        finished_at = CASE WHEN should_retry THEN NULL ELSE clock_timestamp() END,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.id RETURNING * INTO run_row;
    UPDATE public.jobs
    SET status = CASE WHEN should_retry THEN 'RETRY_SCHEDULED'::public."JobStatus"
          ELSE 'FAILED_FINAL'::public."JobStatus" END,
        stage = CASE WHEN should_retry THEN 'retry_scheduled' ELSE 'failed' END,
        attempt = attempt + 1, retry_at = retry_at_value,
        error_summary = jsonb_build_object('code', p_error_code),
        lease_owner = NULL, lease_expires_at = NULL,
        finished_at = CASE WHEN should_retry THEN NULL ELSE clock_timestamp() END,
        version = version + 1, updated_at = clock_timestamp()
    WHERE id = run_row.job_id;
  END IF;

  RETURN QUERY SELECT run_row.id, run_row.version;
END
$$;

REVOKE ALL ON FUNCTION public.claim_keyword_research_run(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_keyword_research_page(
  UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA, INTEGER, BOOLEAN, JSONB, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_keyword_research_submitting(
  UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_wordstat_keyword_research_run(
  UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, JSONB, BYTEA
) FROM PUBLIC;

COMMIT;

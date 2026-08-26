BEGIN;

-- Validation owns the executable capability projection. Keyword expansion is
-- intentionally separate from ordinary WORDSTAT frequencies: a project can
-- use XMLStock for one workflow and either XMLStock or Arsenkin for research.
DO $migration$
DECLARE
  definition TEXT;
  old_arsenkin CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","CLUSTERING"]''::JSONB';
  new_arsenkin CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","CLUSTERING","KEYWORD_RESEARCH"]''::JSONB';
  old_xmlstock CONSTANT TEXT :=
    E'        WHEN ''XMLSTOCK'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]''::JSONB';
  new_xmlstock CONSTANT TEXT :=
    E'        WHEN ''XMLSTOCK'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","KEYWORD_RESEARCH"]''::JSONB';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_arsenkin IN definition) = 0
    OR position(old_xmlstock IN definition) = 0
    OR position(new_arsenkin IN definition) > 0
    OR position(new_xmlstock IN definition) > 0
  THEN
    RAISE EXCEPTION 'Unexpected Wordstat provider capability projection'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_arsenkin, new_arsenkin);
  definition := replace(definition, old_xmlstock, new_xmlstock);

  IF position(old_arsenkin IN definition) > 0
    OR position(old_xmlstock IN definition) > 0
    OR position(new_arsenkin IN definition) = 0
    OR position(new_xmlstock IN definition) = 0
  THEN
    RAISE EXCEPTION 'Wordstat keyword research capabilities were not persisted safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

CREATE OR REPLACE FUNCTION public.ensure_arsenkin_persisted_capabilities()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."provider" = 'ARSENKIN'
    AND NEW."status" = 'ACTIVE'
    AND NEW."verified_at" IS NOT NULL
  THEN
    IF pg_catalog.jsonb_typeof(NEW."capabilities") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Arsenkin credential capabilities must be a JSON array';
    END IF;
    IF NOT NEW."capabilities" ? 'WORDSTAT' THEN
      NEW."capabilities" := NEW."capabilities" || '["WORDSTAT"]'::JSONB;
    END IF;
    IF NOT NEW."capabilities" ? 'CLUSTERING' THEN
      NEW."capabilities" := NEW."capabilities" || '["CLUSTERING"]'::JSONB;
    END IF;
    IF NOT NEW."capabilities" ? 'KEYWORD_RESEARCH' THEN
      NEW."capabilities" := NEW."capabilities" || '["KEYWORD_RESEARCH"]'::JSONB;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ensure_arsenkin_persisted_capabilities()
FROM PUBLIC;

UPDATE public.integration_credentials
SET
  "capabilities" = "capabilities" || '["KEYWORD_RESEARCH"]'::JSONB,
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "provider" IN ('ARSENKIN', 'XMLSTOCK')
  AND "status" = 'ACTIVE'
  AND "verified_at" IS NOT NULL
  AND "deleted_at" IS NULL
  AND NOT "capabilities" ? 'KEYWORD_RESEARCH';

ALTER TABLE public.keyword_research_runs
  DROP CONSTRAINT keyword_research_runs_values_check;

ALTER TABLE public.keyword_research_runs
  ADD CONSTRAINT keyword_research_runs_values_check CHECK (
    source IN ('KEYS_SO', 'ARSENKIN_WORDSTAT', 'XMLSTOCK_WORDSTAT')
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
      OR (
        source = 'XMLSTOCK_WORDSTAT'
        AND provider = 'XMLSTOCK'
        AND domain IS NULL
        AND database IS NULL
        AND max_keywords BETWEEN 1 AND 10000
        AND provider_task_id IS NULL
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

-- The connector claim is database-fenced. It validates the same dedicated
-- capability as the command path before returning encrypted credential data.
DO $migration$
DECLARE
  definition TEXT;
  old_case CONSTANT TEXT :=
    'WHEN ''ARSENKIN_WORDSTAT'' THEN ''WORDSTAT''';
  new_case CONSTANT TEXT :=
    E'WHEN ''ARSENKIN_WORDSTAT'' THEN ''KEYWORD_RESEARCH''\n'
    || E'    WHEN ''XMLSTOCK_WORDSTAT'' THEN ''KEYWORD_RESEARCH''';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_keyword_research_run(text,integer)'::regprocedure
  ) INTO definition;
  IF definition IS NULL
    OR position(old_case IN definition) = 0
    OR position(new_case IN definition) > 0
  THEN
    RAISE EXCEPTION 'Unexpected Wordstat research claim capability'
      USING ERRCODE = '55000';
  END IF;
  definition := replace(definition, old_case, new_case);
  IF position(old_case IN definition) > 0
    OR position(new_case IN definition) = 0
  THEN
    RAISE EXCEPTION 'Wordstat research claim capability was not replaced safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

CREATE FUNCTION public.complete_xmlstock_wordstat_research_seed(
  p_run_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_run_version INTEGER,
  p_job_version INTEGER,
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
  seed_query TEXT;
  query_count INTEGER;
  row_count INTEGER;
  inserted_count INTEGER;
  is_complete BOOLEAN;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array'
    OR jsonb_array_length(p_rows) > 2000
    OR octet_length(p_response_hash) <> 32
  THEN
    RAISE EXCEPTION 'invalid XMLStock Wordstat research seed';
  END IF;
  row_count := jsonb_array_length(p_rows);

  SELECT run.* INTO run_row
  FROM public.keyword_research_runs run
  WHERE run.id = p_run_id
    AND run.source = 'XMLSTOCK_WORDSTAT'
    AND run.status = 'RUNNING'
    AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT job.* INTO job_row
  FROM public.jobs job
  WHERE job.id = run_row.job_id
    AND job.status = 'RUNNING'
    AND job.version = p_job_version
    AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF jsonb_typeof(run_row.input_snapshot->'queries') <> 'array' THEN
    RAISE EXCEPTION 'invalid stored XMLStock Wordstat queries';
  END IF;
  query_count := jsonb_array_length(run_row.input_snapshot->'queries');
  seed_query := run_row.input_snapshot->'queries'->>(run_row.next_page - 1);
  IF query_count NOT BETWEEN 1 AND 500
    OR seed_query IS NULL
    OR length(btrim(seed_query)) NOT BETWEEN 1 AND 400
  THEN
    RAISE EXCEPTION 'invalid stored XMLStock Wordstat seed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item
    WHERE jsonb_typeof(item) <> 'object'
      OR jsonb_typeof(item->'keyword') <> 'string'
      OR length(btrim(item->>'keyword')) NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(item->'sourceQuery') <> 'string'
      OR btrim(item->>'sourceQuery') <> btrim(seed_query)
      OR item->>'sourceColumn' NOT IN ('LEFT', 'RIGHT')
      OR jsonb_typeof(item->'frequencyBase') <> 'number'
      OR CASE
        WHEN item->>'frequencyBase' ~ '^[0-9]{1,10}$'
          THEN (item->>'frequencyBase')::NUMERIC > 2147483647
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'invalid XMLStock Wordstat research row';
  END IF;

  INSERT INTO public.keyword_research_pages(
    workspace_id, project_id, run_id, page, response_hash, row_count
  ) VALUES (
    run_row.workspace_id, run_row.project_id, run_row.id,
    run_row.next_page, p_response_hash, row_count
  );

  WITH parsed AS (
    SELECT
      btrim(value.keyword) AS keyword,
      value."frequencyBase" AS frequency_base,
      btrim(value."sourceQuery") AS source_query,
      value."sourceColumn" AS source_column,
      item.ordinality,
      row_number() OVER (
        PARTITION BY lower(btrim(value.keyword))
        ORDER BY item.ordinality
      ) AS duplicate_rank
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY item(json, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(item.json) AS value(
      keyword TEXT,
      "frequencyBase" INTEGER,
      "sourceQuery" TEXT,
      "sourceColumn" TEXT
    )
  ), eligible AS (
    SELECT
      parsed.*,
      row_number() OVER (ORDER BY parsed.ordinality) AS insertion_order
    FROM parsed
    WHERE parsed.duplicate_rank = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.keyword_research_rows existing
        WHERE existing.run_id = run_row.id
          AND lower(btrim(existing.keyword)) = lower(parsed.keyword)
      )
    ORDER BY parsed.ordinality
    LIMIT GREATEST(run_row.max_keywords - run_row.collected_keywords, 0)
  ), inserted AS (
    INSERT INTO public.keyword_research_rows(
      workspace_id, project_id, run_id, ordinal, keyword,
      frequency_base, source_query, source_column
    )
    SELECT
      run_row.workspace_id, run_row.project_id, run_row.id,
      run_row.collected_keywords + eligible.insertion_order::INTEGER,
      eligible.keyword, eligible.frequency_base,
      eligible.source_query, eligible.source_column
    FROM eligible
    ORDER BY eligible.insertion_order
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO inserted_count FROM inserted;

  is_complete :=
    run_row.next_page >= query_count
    OR run_row.collected_keywords + inserted_count >= run_row.max_keywords;

  UPDATE public.keyword_research_runs
  SET
    status = CASE WHEN is_complete
      THEN 'READY_TO_IMPORT'::public."KeywordResearchStatus"
      ELSE 'QUEUED'::public."KeywordResearchStatus"
    END,
    next_page = next_page + 1,
    total_available = CASE WHEN is_complete
      THEN run_row.collected_keywords + inserted_count
      ELSE total_available
    END,
    collected_keywords = collected_keywords + inserted_count,
    lease_token = NULL,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = run_row.id
  RETURNING * INTO run_row;

  UPDATE public.jobs
  SET
    status = CASE WHEN is_complete
      THEN 'AWAITING_APPROVAL'::public."JobStatus"
      ELSE 'QUEUED'::public."JobStatus"
    END,
    stage = CASE WHEN is_complete THEN 'preview' ELSE 'collecting' END,
    progress_current = run_row.collected_keywords,
    lease_owner = NULL,
    lease_expires_at = NULL,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = run_row.job_id;

  RETURN QUERY SELECT run_row.id, run_row.version;
END
$$;

REVOKE ALL ON FUNCTION public.complete_xmlstock_wordstat_research_seed(
  UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA
) FROM PUBLIC;

-- Existing projects receive one route per healthy provider they already use.
-- The backfill only creates a previously absent capability and never calls a
-- paid API.
CREATE TEMP TABLE keyword_research_provider_sources
ON COMMIT DROP
AS
SELECT
  ranked.workspace_id,
  ranked.project_id,
  ranked.provider,
  ranked.credential_id,
  ranked.actor_id
FROM (
  SELECT
    binding.workspace_id,
    binding.project_id,
    credential.provider,
    route.credential_id,
    binding.updated_by AS actor_id,
    row_number() OVER (
      PARTITION BY binding.workspace_id, binding.project_id, credential.provider
      ORDER BY
        CASE binding.capability
          WHEN 'WORDSTAT' THEN 0
          WHEN 'CLUSTERING' THEN 1
          WHEN 'SERP_RANK_TRACKING' THEN 2
          WHEN 'SERP_COLLECTION' THEN 3
          ELSE 4
        END,
        route.position,
        binding.id,
        route.id
    ) AS preference
  FROM public.project_connector_bindings binding
  JOIN public.project_connector_routes route
    ON route.workspace_id = binding.workspace_id
   AND route.project_id = binding.project_id
   AND route.binding_id = binding.id
   AND route.retired_at IS NULL
  JOIN public.integration_credentials credential
    ON credential.workspace_id = route.workspace_id
   AND credential.id = route.credential_id
  WHERE binding.enabled
    AND credential.provider IN ('XMLSTOCK', 'ARSENKIN')
    AND credential.status = 'ACTIVE'
    AND credential.verified_at IS NOT NULL
    AND credential.deleted_at IS NULL
    AND credential.capabilities ? 'KEYWORD_RESEARCH'
) ranked
WHERE ranked.preference = 1;

CREATE TEMP TABLE keyword_research_backfill_projects
ON COMMIT DROP
AS
SELECT
  source.workspace_id,
  source.project_id,
  min(source.actor_id::TEXT)::UUID AS actor_id,
  count(*)::INTEGER AS provider_count
FROM keyword_research_provider_sources source
WHERE NOT EXISTS (
  SELECT 1
  FROM public.project_connector_bindings existing
  WHERE existing.workspace_id = source.workspace_id
    AND existing.project_id = source.project_id
    AND existing.capability = 'KEYWORD_RESEARCH'
)
GROUP BY source.workspace_id, source.project_id;

INSERT INTO public.project_connector_bindings (
  workspace_id, project_id, capability, enabled,
  fallback_mode, fallback_reasons,
  created_by, updated_by, updated_at
)
SELECT
  project.workspace_id,
  project.project_id,
  'KEYWORD_RESEARCH',
  true,
  CASE WHEN project.provider_count > 1 THEN 'NEXT_AVAILABLE' ELSE 'NONE' END,
  CASE WHEN project.provider_count > 1
    THEN '["CREDENTIAL_UNAVAILABLE","LOW_BALANCE","RATE_LIMITED","RETRYABLE_PROVIDER_ERROR"]'::JSONB
    ELSE '[]'::JSONB
  END,
  project.actor_id,
  project.actor_id,
  clock_timestamp()
FROM keyword_research_backfill_projects project;

INSERT INTO public.project_connector_routes (
  workspace_id, project_id, binding_id, position,
  source_kind, credential_id, routing_scope, updated_at
)
SELECT
  source.workspace_id,
  source.project_id,
  binding.id,
  row_number() OVER (
    PARTITION BY source.workspace_id, source.project_id
    ORDER BY CASE source.provider WHEN 'XMLSTOCK' THEN 0 ELSE 1 END
  )::INTEGER - 1,
  'WORKSPACE_CREDENTIAL'::public."ProjectConnectorRouteSourceKind",
  source.credential_id,
  'PROJECT_OVERRIDE',
  clock_timestamp()
FROM keyword_research_provider_sources source
JOIN keyword_research_backfill_projects project
  ON project.workspace_id = source.workspace_id
 AND project.project_id = source.project_id
JOIN public.project_connector_bindings binding
  ON binding.workspace_id = project.workspace_id
 AND binding.project_id = project.project_id
 AND binding.capability = 'KEYWORD_RESEARCH';

COMMIT;

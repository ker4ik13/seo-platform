BEGIN;

-- A rolling deploy must not replace a worker that already sent a paid seed
-- without the new STARTED checkpoint. Drain legacy in-flight runs first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.keyword_research_runs run
    WHERE run.source = 'XMLSTOCK_WORDSTAT' AND run.status = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'drain running XMLStock Wordstat research before parallel migration'
      USING ERRCODE = '55000';
  END IF;
END
$$;

-- A seed is marked STARTED before its potentially paid XMLStock HTTP call.
-- An interrupted STARTED seed is never sent again automatically.
CREATE TABLE public.keyword_research_seed_checkpoints (
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  run_id UUID NOT NULL,
  seed_index INTEGER NOT NULL,
  state VARCHAR(16) NOT NULL,
  lease_token UUID NOT NULL,
  rows JSONB,
  response_hash BYTEA,
  error_code VARCHAR(64),
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT keyword_research_seed_checkpoints_pkey PRIMARY KEY (run_id, seed_index),
  CONSTRAINT keyword_research_seed_checkpoints_run_tenant_fkey
    FOREIGN KEY (workspace_id, project_id, run_id)
    REFERENCES public.keyword_research_runs (workspace_id, project_id, id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT keyword_research_seed_checkpoints_seed_positive CHECK (seed_index > 0),
  CONSTRAINT keyword_research_seed_checkpoints_attempt_positive CHECK (attempt > 0),
  CONSTRAINT keyword_research_seed_checkpoints_state_valid CHECK (
    state IN ('STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN')
  ),
  CONSTRAINT keyword_research_seed_checkpoints_evidence_valid CHECK (
    (state = 'ACCEPTED' AND rows IS NOT NULL AND response_hash IS NOT NULL
      AND jsonb_typeof(rows) = 'array'
      AND octet_length(response_hash) = 32 AND error_code IS NULL)
    OR (state <> 'ACCEPTED' AND rows IS NULL AND response_hash IS NULL
      AND (state = 'STARTED' OR error_code IS NOT NULL))
  )
);
CREATE INDEX keyword_research_seed_checkpoints_tenant_state_idx
  ON public.keyword_research_seed_checkpoints (workspace_id, project_id, run_id, state);
ALTER TABLE public.keyword_research_seed_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.reserve_xmlstock_wordstat_research_seed(
  p_run_id UUID, p_lease_owner TEXT, p_lease_token UUID,
  p_run_version INTEGER, p_job_version INTEGER, p_seed_index INTEGER,
  p_begin BOOLEAN
)
RETURNS TABLE ("state" TEXT, "rows" JSONB, "responseHash" BYTEA, "errorCode" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  checkpoint public.keyword_research_seed_checkpoints%ROWTYPE;
BEGIN
  SELECT run.* INTO run_row FROM public.keyword_research_runs run
  WHERE run.id = p_run_id AND run.source = 'XMLSTOCK_WORDSTAT'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT job.* INTO job_row FROM public.jobs job
  WHERE job.id = run_row.job_id AND job.status = 'RUNNING'
    AND job.version = p_job_version AND job.lease_owner = p_lease_owner
    AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF jsonb_typeof(run_row.input_snapshot->'queries') <> 'array'
    OR p_seed_index < run_row.next_page
    OR p_seed_index >= run_row.next_page + 10
    OR p_seed_index > jsonb_array_length(run_row.input_snapshot->'queries')
  THEN
    RAISE EXCEPTION 'invalid XMLStock Wordstat seed reservation' USING ERRCODE = '22023';
  END IF;

  SELECT item.* INTO checkpoint FROM public.keyword_research_seed_checkpoints item
  WHERE item.run_id = p_run_id AND item.seed_index = p_seed_index
  FOR UPDATE;
  IF FOUND THEN
    IF checkpoint.state = 'REJECTED' THEN
      IF NOT p_begin THEN
        RETURN QUERY SELECT 'REJECTED'::TEXT, NULL::JSONB, NULL::BYTEA,
          checkpoint.error_code::TEXT;
        RETURN;
      END IF;
      UPDATE public.keyword_research_seed_checkpoints item
      SET state = 'STARTED', lease_token = p_lease_token,
          rows = NULL, response_hash = NULL, error_code = NULL,
          attempt = attempt + 1, started_at = clock_timestamp(), finished_at = NULL
      WHERE item.run_id = p_run_id AND item.seed_index = p_seed_index;
      RETURN QUERY SELECT 'STARTED'::TEXT, NULL::JSONB, NULL::BYTEA, NULL::TEXT;
      RETURN;
    END IF;
    IF checkpoint.state = 'STARTED' THEN
      UPDATE public.keyword_research_seed_checkpoints item
      SET state = 'UNKNOWN', error_code = 'XMLSTOCK_OUTCOME_UNKNOWN',
          finished_at = clock_timestamp()
      WHERE item.run_id = p_run_id AND item.seed_index = p_seed_index;
      RETURN QUERY SELECT 'UNKNOWN'::TEXT, NULL::JSONB, NULL::BYTEA,
        'XMLSTOCK_OUTCOME_UNKNOWN'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      checkpoint.state::TEXT,
      checkpoint.rows, checkpoint.response_hash, checkpoint.error_code::TEXT;
    RETURN;
  END IF;
  IF NOT p_begin THEN
    RETURN QUERY SELECT 'AVAILABLE'::TEXT, NULL::JSONB, NULL::BYTEA, NULL::TEXT;
    RETURN;
  END IF;
  INSERT INTO public.keyword_research_seed_checkpoints (
    workspace_id, project_id, run_id, seed_index, state, lease_token
  ) VALUES (
    run_row.workspace_id, run_row.project_id, p_run_id, p_seed_index,
    'STARTED', p_lease_token
  );
  RETURN QUERY SELECT 'STARTED'::TEXT, NULL::JSONB, NULL::BYTEA, NULL::TEXT;
END
$$;

CREATE FUNCTION public.finish_xmlstock_wordstat_research_seed_checkpoint(
  p_run_id UUID, p_lease_owner TEXT, p_lease_token UUID,
  p_run_version INTEGER, p_job_version INTEGER, p_seed_index INTEGER,
  p_state TEXT, p_rows JSONB, p_response_hash BYTEA, p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
BEGIN
  IF p_state NOT IN ('ACCEPTED', 'REJECTED', 'UNKNOWN')
    OR (p_state = 'ACCEPTED' AND (jsonb_typeof(p_rows) <> 'array'
      OR jsonb_array_length(p_rows) > 2000 OR octet_length(p_response_hash) <> 32
      OR p_error_code IS NOT NULL))
    OR (p_state <> 'ACCEPTED' AND (p_rows IS NOT NULL OR p_response_hash IS NOT NULL
      OR p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'))
  THEN
    RAISE EXCEPTION 'invalid XMLStock Wordstat seed evidence' USING ERRCODE = '22023';
  END IF;
  SELECT run.* INTO run_row FROM public.keyword_research_runs run
  JOIN public.jobs job ON job.id = run.job_id
  WHERE run.id = p_run_id AND run.source = 'XMLSTOCK_WORDSTAT'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token
    AND job.status = 'RUNNING' AND job.version = p_job_version
    AND job.lease_owner = p_lease_owner AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE OF run, job;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.keyword_research_seed_checkpoints item
  SET state = p_state, rows = p_rows, response_hash = p_response_hash,
      error_code = p_error_code, finished_at = clock_timestamp()
  WHERE item.run_id = p_run_id AND item.seed_index = p_seed_index
    AND item.state = 'STARTED' AND item.lease_token = p_lease_token;
  RETURN FOUND;
END
$$;

CREATE FUNCTION public.skip_unknown_xmlstock_wordstat_research_seed(
  p_run_id UUID, p_lease_owner TEXT, p_lease_token UUID,
  p_run_version INTEGER, p_job_version INTEGER, p_seed_index INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  run_row public.keyword_research_runs%ROWTYPE;
  query_count INTEGER;
  is_complete BOOLEAN;
BEGIN
  SELECT run.* INTO run_row FROM public.keyword_research_runs run
  JOIN public.jobs job ON job.id = run.job_id
  WHERE run.id = p_run_id AND run.source = 'XMLSTOCK_WORDSTAT'
    AND run.status = 'RUNNING' AND run.version = p_run_version
    AND run.lease_token = p_lease_token
    AND job.status = 'RUNNING' AND job.version = p_job_version
    AND job.lease_owner = p_lease_owner AND job.lease_expires_at > clock_timestamp()
  FOR UPDATE OF run, job;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_seed_index <> run_row.next_page OR NOT EXISTS (
    SELECT 1 FROM public.keyword_research_seed_checkpoints checkpoint
    WHERE checkpoint.run_id = p_run_id AND checkpoint.seed_index = p_seed_index
      AND checkpoint.state = 'UNKNOWN'
  ) THEN RETURN false; END IF;
  query_count := jsonb_array_length(run_row.input_snapshot->'queries');
  is_complete := run_row.next_page >= query_count
    OR run_row.collected_keywords >= run_row.max_keywords;
  UPDATE public.keyword_research_runs
  SET status = CASE WHEN is_complete
        THEN 'READY_TO_IMPORT'::public."KeywordResearchStatus"
        ELSE 'QUEUED'::public."KeywordResearchStatus" END,
      next_page = next_page + 1,
      total_available = CASE WHEN is_complete THEN run_row.collected_keywords
        ELSE total_available END,
      failure_code = 'XMLSTOCK_OUTCOME_UNKNOWN', lease_token = NULL,
      version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_run_id;
  UPDATE public.jobs
  SET status = CASE WHEN is_complete
        THEN 'AWAITING_APPROVAL'::public."JobStatus"
        ELSE 'QUEUED'::public."JobStatus" END,
      stage = CASE WHEN is_complete THEN 'preview' ELSE 'collecting' END,
      progress_current = run_row.collected_keywords,
      error_summary = CASE WHEN is_complete
        THEN '{"code":"XMLSTOCK_OUTCOME_UNKNOWN"}'::jsonb
        ELSE error_summary END,
      lease_owner = NULL, lease_expires_at = NULL, version = version + 1,
      updated_at = clock_timestamp()
  WHERE id = run_row.job_id;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.reserve_xmlstock_wordstat_research_seed(
  UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_xmlstock_wordstat_research_seed_checkpoint(
  UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER, TEXT, JSONB, BYTEA, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.skip_unknown_xmlstock_wordstat_research_seed(
  UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;

-- A new claim must preserve the partial-result warning after skipped seeds.
DO $migration$
DECLARE
  definition TEXT;
  old_clear CONSTANT TEXT := 'failure_code = NULL,';
  new_clear CONSTANT TEXT :=
    'failure_code = CASE WHEN candidate.source = ''XMLSTOCK_WORDSTAT'' AND EXISTS (SELECT 1 FROM public.keyword_research_seed_checkpoints checkpoint WHERE checkpoint.run_id = candidate.id AND checkpoint.state = ''UNKNOWN'') THEN ''XMLSTOCK_OUTCOME_UNKNOWN'' ELSE NULL END,';
BEGIN
  SELECT pg_get_functiondef('public.claim_keyword_research_run(text,integer)'::regprocedure)
    INTO definition;
  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_clear, '')))
      / length(old_clear) <> 1
  THEN RAISE EXCEPTION 'unexpected keyword research claim failure reset'; END IF;
  EXECUTE replace(definition, old_clear, new_clear);
END
$migration$;

-- The funded unit remains one SEED:n request. Allow ten different n values
-- inside the same leased run without widening the total immutable quote.
DO $migration$
DECLARE
  definition TEXT;
  old_scope CONSTANT TEXT :=
    'r.next_page BETWEEN 1 AND jsonb_array_length(j.input_snapshot->''queries'') AND p_part = ''SEED:'' || r.next_page::text';
  new_scope CONSTANT TEXT :=
    'r.max_keywords > r.collected_keywords AND p_part ~ ''^SEED:[1-9][0-9]{0,2}$'' AND split_part(p_part, '':'', 2)::integer BETWEEN r.next_page AND LEAST(r.next_page + 9, r.next_page + GREATEST(1, (r.max_keywords - r.collected_keywords) / 2000) - 1, jsonb_array_length(j.input_snapshot->''queries''))';
BEGIN
  SELECT pg_get_functiondef(
    'public.prepare_provider_usage_ticket(uuid,uuid,uuid,text,integer,text,uuid[])'::regprocedure
  ) INTO definition;
  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_scope, '')))
      / length(old_scope) <> 1
  THEN
    RAISE EXCEPTION 'unexpected Wordstat research paid unit scope';
  END IF;
  EXECUTE replace(definition, old_scope, new_scope);
END
$migration$;

COMMIT;

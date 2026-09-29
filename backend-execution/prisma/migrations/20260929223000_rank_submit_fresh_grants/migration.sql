BEGIN;

-- The 30-second grant is claimable only while it has enough time left for its
-- fenced submit lease. Oldest-first candidate hints repeatedly presented
-- grants at the edge of that window; prefer the newest unsubmitted attempt
-- inside each Job while keeping credential/Job fairness unchanged.
DO $migration$
DECLARE
  definition TEXT;
  old_job_order CONSTANT TEXT :=
    'ORDER BY execution.created_at, execution.id';
  new_job_order CONSTANT TEXT :=
    'ORDER BY execution.created_at DESC, execution.id DESC';
  old_global_order CONSTANT TEXT :=
    'eligible.created_at, eligible.id';
  new_global_order CONSTANT TEXT :=
    'eligible.created_at DESC, eligible.id DESC';
BEGIN
  SELECT pg_get_functiondef(
    'public.list_rank_connector_submit_candidates(text,integer,integer,uuid[])'::regprocedure
  ) INTO definition;
  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_job_order, '')))
      / length(old_job_order) <> 1
    OR (length(definition) - length(replace(definition, old_global_order, '')))
      / length(old_global_order) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank submit candidate order before fresh grants'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(
    replace(definition, old_job_order, new_job_order),
    old_global_order, new_global_order
  );
END
$migration$;

REVOKE ALL ON FUNCTION public.list_rank_connector_submit_candidates(
  TEXT, INTEGER, INTEGER, UUID[]
) FROM PUBLIC;

COMMIT;

BEGIN;

-- The ID-list query already returns no rows when nothing is claimable.
-- Its preliminary EXISTS scanned the same large execution history again,
-- and pg_stat_statements showed it as a separate expensive nested statement.
DO $migration$
DECLARE
  definition TEXT;
  start_marker CONSTANT TEXT := $start$  IF NOT EXISTS (
    SELECT 1 FROM public.rank_connector_executions execution$start$;
  end_marker CONSTANT TEXT := '  RETURN QUERY';
  start_at INTEGER;
  end_at INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'public.list_rank_connector_submit_candidates(text,integer,integer,uuid[])'::regprocedure
  ) INTO definition;
  start_at := strpos(definition, start_marker);
  end_at := strpos(definition, end_marker);
  IF definition IS NULL OR start_at = 0 OR end_at <= start_at
    OR (length(definition) - length(replace(definition, start_marker, '')))
      / length(start_marker) <> 1
    OR (length(definition) - length(replace(definition, end_marker, '')))
      / length(end_marker) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank submit candidate precheck before single scan'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE substring(definition FROM 1 FOR start_at - 1)
    || substring(definition FROM end_at);
END
$migration$;

REVOKE ALL ON FUNCTION public.list_rank_connector_submit_candidates(
  TEXT, INTEGER, INTEGER, UUID[]
) FROM PUBLIC;

COMMIT;

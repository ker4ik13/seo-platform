BEGIN;

-- PostgreSQL may choose a join order that scans the append-only execution
-- history despite the exact execution ID predicate later in the graph. The
-- targeted function already knows the primary key; materialize that single
-- row first, then run the unchanged tenant/credential/grant and lock fences.
DO $migration$
DECLARE
  definition TEXT;
  old_candidate CONSTANT TEXT := $old$  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution$old$;
  new_candidate CONSTANT TEXT := $new$  WITH target_execution AS MATERIALIZED (
    SELECT * FROM public.rank_connector_executions
    WHERE id = p_execution_id
  )
  SELECT execution.*
  INTO candidate
  FROM target_execution execution$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization_targeted(text,integer,text,uuid)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_candidate, '')))
      / length(old_candidate) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected targeted rank submit graph before PK anchor'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition, old_candidate, new_candidate);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization_targeted(
    TEXT, INTEGER, TEXT, UUID
  ) FROM PUBLIC;

COMMIT;

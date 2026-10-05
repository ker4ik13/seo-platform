BEGIN;

-- The old multi-table candidate SELECT re-plans its large graph on every
-- targeted claim. It is only a non-authoritative hint: every graph member is
-- already locked and revalidated after the parent Job lock. Read one indexed
-- execution first and leave all security/fencing decisions to those existing
-- post-lock checks. No provider call happens inside this function.
DO $migration$
DECLARE
  definition TEXT;
  start_marker CONSTANT TEXT := '  /* rank-connector-claim:job */';
  end_marker CONSTANT TEXT := '  /* rank-connector-claim:job-lock */';
  start_at INTEGER;
  end_at INTEGER;
  replacement CONSTANT TEXT := $new$
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution
  WHERE execution."id" = p_execution_id
    AND execution."execution_connector_version" =
      p_execution_connector_version
    AND execution."authorization_expires_at" >
      clock_timestamp() + make_interval(secs => p_lease_seconds)
    AND (
      execution."status" = 'READY_TO_SUBMIT'
      OR (
        execution."status" = 'CLAIMED'
        AND execution."lease_expires_at" <= clock_timestamp()
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization_targeted(text,integer,text,uuid)'::regprocedure
  ) INTO definition;

  start_at := strpos(definition, start_marker);
  end_at := strpos(definition, end_marker);
  IF definition IS NULL
    OR start_at = 0 OR end_at <= start_at
    OR (length(definition) - length(replace(definition, start_marker, '')))
      / length(start_marker) <> 1
    OR (length(definition) - length(replace(definition, end_marker, '')))
      / length(end_marker) <> 1
    OR strpos(substring(definition FROM start_at FOR end_at - start_at),
      'WITH target_execution AS MATERIALIZED') = 0
    OR strpos(substring(definition FROM end_at),
      'rank-connector-claim:execution') = 0
  THEN
    RAISE EXCEPTION 'Unexpected targeted rank graph before indexed candidate'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE substring(definition FROM 1 FOR start_at + length(start_marker) - 1)
    || replacement
    || substring(definition FROM end_at);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization_targeted(
    TEXT, INTEGER, TEXT, UUID
  ) FROM PUBLIC;

COMMIT;

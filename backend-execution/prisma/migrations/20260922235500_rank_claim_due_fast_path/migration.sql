BEGIN;

CREATE INDEX rank_connector_executions_connector_submit_due_idx
  ON public.rank_connector_executions (
    execution_connector_version,
    status,
    authorization_expires_at,
    lease_expires_at
  );

DO $migration$
DECLARE
  definition TEXT;
  old_marker CONSTANT TEXT := $old$  -- Candidate discovery does not lock a child row first. Only the parent Job
  -- is claimed here; the remaining graph follows the canonical lock order.$old$;
  new_marker CONSTANT TEXT := $new$  -- Most ticks arrive while there is no due work. Use the dedicated index
  -- before opening the full tenant graph; the complete query below remains
  -- the authoritative eligibility and lock fence.
  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    WHERE execution.execution_connector_version =
      p_execution_connector_version
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (
          execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp()
        )
      )
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  -- Candidate discovery does not lock a child row first. Only the parent Job
  -- is claimed here; the remaining graph follows the canonical lock order.$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_marker, '')))
      / length(old_marker) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank claim function before due fast path'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_marker, new_marker);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization(
    TEXT, INTEGER, TEXT
  )
  FROM PUBLIC;

COMMIT;

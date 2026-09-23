BEGIN;

CREATE INDEX rank_connector_executions_connector_poll_due_idx
  ON public.rank_connector_executions (
    execution_connector_version,
    status,
    next_action_at,
    lease_expires_at,
    poll_attempt_count,
    created_at,
    id
  );

DO $migration$
DECLARE
  definition TEXT;
  old_marker CONSTANT TEXT := $old$  -- A worker that lost its lease on the fiftieth request must become terminal$old$;
  new_marker CONSTANT TEXT := $new$  -- Most runtime ticks have no provider result due yet. Avoid opening the
  -- complete tenant/credential/control graph until the indexed execution and
  -- its parent Job show possible work. The full query below remains the
  -- authoritative eligibility and lock fence.
  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
      AND job.project_id = execution.project_id
      AND job.id = execution.job_id
    WHERE execution.execution_connector_version =
      p_execution_connector_version
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.status = 'RUNNING'
      AND job.stage = 'WAITING_EXECUTION_GRANT'
      AND (
        (
          execution.status = 'POLL_WAIT'
          AND execution.next_action_at <= clock_timestamp()
        )
        OR (
          execution.status = 'FETCHING'
          AND execution.lease_expires_at <= clock_timestamp()
        )
      )
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  -- A worker that lost its lease on the fiftieth request must become terminal$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_marker, '')))
      / length(old_marker) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank poll function before idle fast path'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_marker, new_marker);
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_poll(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;

COMMIT;

BEGIN;

-- Terminal rank Jobs retain their connector executions as immutable audit
-- evidence. Those historical SUBMITTING/POLL_WAIT states must not reserve a
-- live provider slot: otherwise cancelled work permanently shrinks the shared
-- worker window after every restart. Count only the exact current running Job
-- graph that can still be claimed by the connector broker.
DO $migration$
DECLARE
  function_definition TEXT;
  old_capacity_fragment TEXT := $old_capacity$      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.provider = provider_name
        AND (
          execution.status IN ('SUBMITTING', 'POLL_WAIT')
          OR (
            execution.status = 'CLAIMED'
            AND execution.lease_expires_at > clock_timestamp()
          )
          OR (
            execution.status = 'FETCHING'
            AND execution.lease_expires_at > clock_timestamp()
          )
        )$old_capacity$;
  new_capacity_fragment TEXT := $new_capacity$      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      JOIN public.jobs rank_job
        ON rank_job.workspace_id = execution.workspace_id
       AND rank_job.project_id = execution.project_id
       AND rank_job.id = execution.job_id
      WHERE execution.provider = provider_name
        AND rank_job.type = 'MANUAL_RANK_CHECK'
        AND rank_job.provider = provider_name
        AND rank_job.status = 'RUNNING'
        AND rank_job.stage = 'WAITING_EXECUTION_GRANT'
        AND rank_job.cancel_requested_at IS NULL
        AND rank_job.version = execution.job_version
        AND (
          execution.status IN ('SUBMITTING', 'POLL_WAIT')
          OR (
            execution.status = 'CLAIMED'
            AND execution.lease_expires_at > clock_timestamp()
          )
          OR (
            execution.status = 'FETCHING'
            AND execution.lease_expires_at > clock_timestamp()
          )
        )$new_capacity$;
  occurrence_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_submit_bounded(text,integer,text)'::regprocedure
  )
  INTO function_definition;

  occurrence_count := (
    length(function_definition) -
    length(replace(function_definition, old_capacity_fragment, ''))
  ) / length(old_capacity_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected rank submit provider-capacity query';
  END IF;

  EXECUTE replace(
    function_definition,
    old_capacity_fragment,
    new_capacity_fragment
  );
END
$migration$;

COMMIT;

BEGIN;

-- Rank estimates intentionally support an explicitly selected provider route
-- at positions 1..7. The execution graph is already bound to the exact
-- route/credential IDs from that estimate, so requiring the selected route to
-- also be the project default (position 0) rejects a legitimate execution.
DO $migration$
DECLARE
  function_definition TEXT;
  route_position_fragment TEXT;
  occurrence_count INTEGER;
  function_signature TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.assert_rank_connector_execution_scope()'::regprocedure
  )
  INTO function_definition;
  route_position_fragment := 'AND route.position = 0';
  occurrence_count := (
    length(function_definition) -
    length(replace(function_definition, route_position_fragment, ''))
  ) / length(route_position_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION
      'unexpected rank execution scope route-position invariant';
  END IF;
  EXECUTE replace(function_definition, route_position_fragment, '');

  route_position_fragment := 'AND route."position" = 0';
  FOREACH function_signature IN ARRAY ARRAY[
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)',
    'public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)'
  ]
  LOOP
    SELECT pg_get_functiondef(function_signature::regprocedure)
    INTO function_definition;
    occurrence_count := (
      length(function_definition) -
      length(replace(function_definition, route_position_fragment, ''))
    ) / length(route_position_fragment);
    IF occurrence_count <> 2 THEN
      RAISE EXCEPTION
        'unexpected route-position invariant in %', function_signature;
    END IF;
    EXECUTE replace(function_definition, route_position_fragment, '');
  END LOOP;
END
$migration$;

-- Wordstat and rank share five Arsenkin provider-task slots. Count only the
-- current Arsenkin graph: terminal jobs, expired pre-network leases and every
-- XMLStock execution must not consume Arsenkin capacity. Use the same advisory
-- lock identity as the rank dispatcher so the capacity check stays atomic
-- across both workflows.
DO $migration$
DECLARE
  function_definition TEXT;
  old_lock_fragment TEXT :=
    $old_lock$'seo-platform:arsenkin-rank-submit'$old_lock$;
  new_lock_fragment TEXT :=
    $new_lock$'seo-platform:rank-dispatch:ARSENKIN'$new_lock$;
  old_capacity_fragment TEXT := $old_capacity$      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      WHERE execution.status IN ('CLAIMED','SUBMITTING','POLL_WAIT','FETCHING')$old_capacity$;
  new_capacity_fragment TEXT := $new_capacity$      SELECT COUNT(*)
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
          OR (
            execution.status = 'READY_TO_SUBMIT'
            AND execution.authorization_expires_at > clock_timestamp()
          )
          OR (
            execution.status IN ('CLAIMED','FETCHING')
            AND execution.lease_expires_at > clock_timestamp()
          )
        )$new_capacity$;
  occurrence_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'public.mark_frequency_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)'::regprocedure
  )
  INTO function_definition;

  occurrence_count := (
    length(function_definition) -
    length(replace(function_definition, old_lock_fragment, ''))
  ) / length(old_lock_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected Wordstat provider-slot lock identity';
  END IF;
  function_definition := replace(
    function_definition,
    old_lock_fragment,
    new_lock_fragment
  );

  occurrence_count := (
    length(function_definition) -
    length(replace(function_definition, old_capacity_fragment, ''))
  ) / length(old_capacity_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected Wordstat provider-capacity query';
  END IF;
  function_definition := replace(
    function_definition,
    old_capacity_fragment,
    new_capacity_fragment
  );

  EXECUTE function_definition;
END
$migration$;

COMMIT;

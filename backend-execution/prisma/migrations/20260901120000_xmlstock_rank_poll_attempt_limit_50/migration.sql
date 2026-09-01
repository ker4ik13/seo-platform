BEGIN;

-- XMLStock executes one immutable provider task per keyword.  Cap only that
-- provider at fifty real poll HTTP requests; Arsenkin keeps its batch-task
-- recovery budget because one Arsenkin task can contain many keywords.
DO $migration$
DECLARE
  claim_definition TEXT;
  complete_definition TEXT;
  claim_limit_needle TEXT := 'AND execution.poll_attempt_count < 720';
  complete_limit_needle TEXT :=
    'WHEN current_execution.poll_attempt_count >= 720 THEN ''FAILED_FINAL''';
  claim_select_needle TEXT := E'  SELECT execution.*\n  INTO candidate';
  claim_cleanup TEXT := $cleanup$
  -- A worker that lost its lease on the fiftieth request must become terminal
  -- without issuing request 51.  This also recovers maxed POLL_WAIT rows left
  -- by an older worker version.
  UPDATE public.rank_connector_executions execution
  SET status = 'FAILED_FINAL',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      next_action_at = NULL,
      provider_progress_snapshot = NULL,
      provider_progress_hash = NULL,
      observed_at = NULL,
      normalized_result_snapshot = NULL,
      normalized_result_hash = NULL,
      last_error_code = COALESCE(
        execution.last_error_code,
        'PROVIDER_POLL_TIMEOUT'
      ),
      finished_at = clock_timestamp(),
      version = execution.version + 1,
      updated_at = clock_timestamp()
  FROM public.jobs job
  WHERE job.workspace_id = execution.workspace_id
    AND job.project_id = execution.project_id
    AND job.id = execution.job_id
    AND job.type = 'MANUAL_RANK_CHECK'
    AND job.status = 'RUNNING'
    AND job.stage = 'WAITING_EXECUTION_GRANT'
    AND execution.provider = 'XMLSTOCK'
    AND execution.poll_attempt_count >= 50
    AND (
      execution.status = 'POLL_WAIT'
      OR (
        execution.status = 'FETCHING'
        AND execution.lease_expires_at <= clock_timestamp()
      )
    );

  SELECT execution.*
  INTO candidate$cleanup$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO claim_definition;
  IF claim_definition IS NULL
    OR (
      length(claim_definition) -
      length(replace(claim_definition, claim_limit_needle, ''))
    ) / length(claim_limit_needle) <> 1
    OR (
      length(claim_definition) -
      length(replace(claim_definition, claim_select_needle, ''))
    ) / length(claim_select_needle) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank poll claim function before attempt-limit migration'
      USING ERRCODE = '55000';
  END IF;

  claim_definition := replace(
    claim_definition,
    claim_limit_needle,
    'AND execution.poll_attempt_count <' || E'\n      ' ||
      'CASE WHEN execution.provider = ''XMLSTOCK'' THEN 50 ELSE 720 END'
  );
  claim_definition := replace(
    claim_definition,
    claim_select_needle,
    claim_cleanup
  );
  IF position(claim_limit_needle IN claim_definition) > 0
    OR (
      length(claim_definition) -
      length(replace(claim_definition, claim_select_needle, ''))
    ) / length(claim_select_needle) <> 1
    OR position('execution.poll_attempt_count >= 50' IN claim_definition) = 0
  THEN
    RAISE EXCEPTION 'Rank poll claim function was not patched safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE claim_definition;

  SELECT pg_get_functiondef(
    'public.complete_rank_connector_poll(uuid,uuid,text,uuid,integer,integer,text,integer,timestamp with time zone,jsonb,bytea,text,jsonb,bytea)'::regprocedure
  ) INTO complete_definition;
  IF complete_definition IS NULL
    OR (
      length(complete_definition) -
      length(replace(complete_definition, complete_limit_needle, ''))
    ) / length(complete_limit_needle) <> 2
  THEN
    RAISE EXCEPTION 'Unexpected rank poll completion function before attempt-limit migration'
      USING ERRCODE = '55000';
  END IF;
  complete_definition := replace(
    complete_definition,
    complete_limit_needle,
    'WHEN current_execution.poll_attempt_count >=' || E'\n        ' ||
      'CASE WHEN current_execution.provider = ''XMLSTOCK'' THEN 50 ELSE 720 END' || E'\n      ' ||
      'THEN ''FAILED_FINAL'''
  );
  IF position(complete_limit_needle IN complete_definition) > 0 THEN
    RAISE EXCEPTION 'Rank poll completion function was not patched safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE complete_definition;
END
$migration$;

-- Apply the same terminal transition immediately to already-waiting rows;
-- active leases finish through the replaced completion function above.
UPDATE public.rank_connector_executions execution
SET status = 'FAILED_FINAL',
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL,
    next_action_at = NULL,
    provider_progress_snapshot = NULL,
    provider_progress_hash = NULL,
    observed_at = NULL,
    normalized_result_snapshot = NULL,
    normalized_result_hash = NULL,
    last_error_code = COALESCE(
      execution.last_error_code,
      'PROVIDER_POLL_TIMEOUT'
    ),
    finished_at = clock_timestamp(),
    version = execution.version + 1,
    updated_at = clock_timestamp()
FROM public.jobs job
WHERE job.workspace_id = execution.workspace_id
  AND job.project_id = execution.project_id
  AND job.id = execution.job_id
  AND job.type = 'MANUAL_RANK_CHECK'
  AND job.status = 'RUNNING'
  AND job.stage = 'WAITING_EXECUTION_GRANT'
  AND execution.provider = 'XMLSTOCK'
  AND execution.poll_attempt_count >= 50
  AND (
    execution.status = 'POLL_WAIT'
    OR (
      execution.status = 'FETCHING'
      AND execution.lease_expires_at <= clock_timestamp()
    )
  );

COMMIT;

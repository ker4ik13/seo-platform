BEGIN;

-- A candidate list is only a short-lived hint. The targeted claim below still
-- locks and validates the same execution, Job, credential and control graph.
CREATE FUNCTION public.list_rank_connector_poll_candidates(
  p_execution_connector_version TEXT,
  p_limit INTEGER,
  p_excluded UUID[]
)
RETURNS TABLE ("executionId" UUID, "jobId" UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_execution_connector_version IS NULL
    OR p_execution_connector_version !~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30
    OR p_excluded IS NULL OR cardinality(p_excluded) > 120
  THEN
    RAISE EXCEPTION 'Invalid rank poll candidate request'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH active_fetches AS MATERIALIZED (
    SELECT execution.credential_id, execution.project_id,
           execution.provider, COUNT(*) AS active_count
    FROM public.rank_connector_executions execution
    WHERE execution.execution_connector_version = p_execution_connector_version
      AND execution.status = 'FETCHING'
      AND execution.lease_expires_at > clock_timestamp()
    GROUP BY execution.credential_id, execution.project_id,
             execution.provider
  ), due AS MATERIALIZED (
    SELECT execution.id, execution.job_id, execution.credential_id,
           execution.project_id, execution.provider, execution.created_at,
           CASE WHEN execution.status = 'FETCHING' THEN 0 ELSE 1 END
             AS state_priority,
           CASE WHEN execution.status = 'FETCHING'
             THEN execution.lease_expires_at ELSE execution.next_action_at END
             AS due_at,
           ROW_NUMBER() OVER (
             PARTITION BY execution.credential_id, execution.project_id,
                          execution.job_id
             ORDER BY
               CASE WHEN execution.status = 'FETCHING' THEN 0 ELSE 1 END,
               CASE WHEN execution.status = 'FETCHING'
                 THEN execution.lease_expires_at
                 ELSE execution.next_action_at END,
               execution.created_at, execution.id
           ) AS job_turn
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
     AND job.project_id = execution.project_id
     AND job.id = execution.job_id
    WHERE execution.execution_connector_version = p_execution_connector_version
      AND execution.provider = 'XMLSTOCK'
      AND execution.id <> ALL(p_excluded)
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.status = 'RUNNING'
      AND job.stage = 'WAITING_EXECUTION_GRANT'
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (execution.status = 'POLL_WAIT'
          AND execution.next_action_at <= clock_timestamp())
        OR (execution.status = 'FETCHING'
          AND execution.lease_expires_at <= clock_timestamp())
      )
  )
  SELECT due.id, due.job_id
  FROM due
  LEFT JOIN active_fetches active
    ON active.credential_id = due.credential_id
   AND active.project_id = due.project_id
   AND active.provider = due.provider
  ORDER BY COALESCE(active.active_count, 0), due.job_turn,
           due.state_priority, due.due_at, due.created_at, due.id
  LIMIT p_limit;
END
$$;

-- Clone the canonical lease-fenced poll claim instead of reimplementing its
-- paid-request and terminal-attempt invariants. Restrict both candidate scans
-- and the max-attempt cleanup to the hinted execution ID.
DO $migration$
DECLARE
  definition TEXT;
  old_header CONSTANT TEXT :=
    'claim_rank_connector_poll(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)';
  new_header CONSTANT TEXT :=
    'claim_rank_connector_poll_targeted(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text, p_execution_id uuid)';
  old_candidate CONSTANT TEXT :=
    'WHERE execution.execution_connector_version = p_execution_connector_version'
    || E'\n    AND control.execution_connector_version = p_execution_connector_version';
  new_candidate CONSTANT TEXT :=
    'WHERE execution.id = p_execution_id'
    || E'\n    AND execution.execution_connector_version = p_execution_connector_version'
    || E'\n    AND control.execution_connector_version = p_execution_connector_version';
  old_terminal CONSTANT TEXT :=
    'AND execution.provider = ''XMLSTOCK'''
    || E'\n    AND execution.poll_attempt_count >= 50';
  new_terminal CONSTANT TEXT :=
    'AND execution.id = p_execution_id'
    || E'\n    AND execution.provider = ''XMLSTOCK'''
    || E'\n    AND execution.poll_attempt_count >= 50';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_header, '')))
      / length(old_header) <> 1
    OR (length(definition) - length(replace(definition, old_candidate, '')))
      / length(old_candidate) <> 2
    OR (length(definition) - length(replace(definition, old_terminal, '')))
      / length(old_terminal) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank poll claim before targeted prefetch'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(
    replace(
      replace(definition, old_header, new_header),
      old_candidate, new_candidate
    ),
    old_terminal, new_terminal
  );
END
$migration$;

REVOKE ALL ON FUNCTION public.list_rank_connector_poll_candidates(
  TEXT, INTEGER, UUID[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_poll_targeted(
  TEXT, INTEGER, TEXT, UUID
) FROM PUBLIC;

COMMIT;

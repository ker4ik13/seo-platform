BEGIN;

-- BYOK has no Platform settlement round-trips around the provider request.
-- Its submit needs the 10-second HTTP timeout plus a bounded safety margin,
-- not the 23-second platform-paid lease. With a 30-second grant the old lease
-- left only seven seconds in which a candidate could be claimed.
CREATE OR REPLACE FUNCTION public.list_rank_connector_submit_candidates(
  p_execution_connector_version TEXT,
  p_lease_seconds INTEGER,
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
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 120
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 30
    OR p_excluded IS NULL OR cardinality(p_excluded) > 120
  THEN
    RAISE EXCEPTION 'Invalid rank submit candidate request'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rank_connector_executions execution
    WHERE execution.execution_connector_version = p_execution_connector_version
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => LEAST(p_lease_seconds, 17))
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp())
      )
    LIMIT 1
  ) THEN RETURN; END IF;

  RETURN QUERY
  WITH eligible AS MATERIALIZED (
    SELECT execution.id, execution.job_id, execution.credential_id,
           execution.project_id, execution.provider, execution.created_at,
           row_number() OVER (
             PARTITION BY execution.credential_id, execution.project_id,
                          execution.job_id
             ORDER BY execution.created_at, execution.id
           ) AS job_turn
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
     AND job.project_id = execution.project_id
     AND job.id = execution.job_id
    JOIN public.rank_connector_execution_controls control
      ON control.provider = execution.provider
     AND control.capability = 'SERP_RANK_TRACKING'
    JOIN public.integration_credentials credential
      ON credential.workspace_id = execution.workspace_id
     AND credential.id = execution.credential_id
    WHERE execution.provider = 'XMLSTOCK'
      AND execution.id <> ALL(p_excluded)
      AND execution.execution_connector_version = p_execution_connector_version
      AND control.execution_connector_version = p_execution_connector_version
      AND control.submit_enabled
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (job.status = 'QUEUED' AND job.stage = 'WAITING_FOR_QUEUE')
        OR (job.status = 'RUNNING' AND job.stage = 'WAITING_EXECUTION_GRANT')
      )
      AND credential.provider = execution.provider
      AND credential.mode IN ('BYOK_API_KEY', 'PLATFORM_PAID')
      AND credential.status = 'ACTIVE'
      AND credential.deleted_at IS NULL
      AND execution.authorization_expires_at > clock_timestamp()
        + make_interval(secs => CASE
            WHEN credential.mode = 'BYOK_API_KEY'
              THEN LEAST(p_lease_seconds, 17)
            ELSE p_lease_seconds
          END)
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp())
      )
  ), active AS MATERIALIZED (
    SELECT execution.credential_id, execution.project_id,
           execution.provider, COUNT(*) AS active_count
    FROM public.rank_connector_executions execution
    WHERE execution.provider = 'XMLSTOCK'
      AND (
        execution.status = 'SUBMITTING'
        OR (execution.status IN ('CLAIMED', 'FETCHING')
          AND execution.lease_expires_at > clock_timestamp())
      )
    GROUP BY execution.credential_id, execution.project_id,
             execution.provider
  )
  SELECT eligible.id, eligible.job_id
  FROM eligible
  LEFT JOIN active
    ON active.credential_id = eligible.credential_id
   AND active.project_id = eligible.project_id
   AND active.provider = eligible.provider
  ORDER BY COALESCE(active.active_count, 0), eligible.job_turn,
           eligible.created_at, eligible.id
  LIMIT p_limit;
END
$$;

DO $migration$
DECLARE
  definition TEXT;
  old_call CONSTANT TEXT :=
    'p_lease_owner, p_lease_seconds, p_execution_connector_version,';
  new_call CONSTANT TEXT := $new$
    p_lease_owner,
    COALESCE((
      SELECT CASE
        WHEN credential.mode = 'BYOK_API_KEY'
          THEN LEAST(p_lease_seconds, 17)
        ELSE p_lease_seconds
      END
      FROM public.rank_connector_executions execution
      JOIN public.integration_credentials credential
        ON credential.workspace_id = execution.workspace_id
       AND credential.id = execution.credential_id
      WHERE execution.id = p_execution_id
    ), p_lease_seconds),
    p_execution_connector_version,$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_submit_targeted(text,integer,text,uuid)'::regprocedure
  ) INTO definition;
  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_call, '')))
      / length(old_call) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected targeted submit claim before BYOK lease'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition, old_call, new_call);
END
$migration$;

REVOKE ALL ON FUNCTION public.list_rank_connector_submit_candidates(
  TEXT, INTEGER, INTEGER, UUID[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_targeted(
  TEXT, INTEGER, TEXT, UUID
) FROM PUBLIC;

COMMIT;

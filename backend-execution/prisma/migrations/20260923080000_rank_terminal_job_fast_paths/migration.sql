BEGIN;

-- Recently cancelled large runs can retain valid execution grants for a short
-- window. Filter those rows by the parent Job before either the full claim
-- graph or the Arsenkin provider-wide lock is opened.
DO $migration$
DECLARE
  definition TEXT;
  old_path CONSTANT TEXT := $old$  IF NOT EXISTS (
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
  END IF;$old$;
  new_path CONSTANT TEXT := $new$  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
      AND job.project_id = execution.project_id
      AND job.id = execution.job_id
    WHERE execution.execution_connector_version =
      p_execution_connector_version
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (
          job.status = 'QUEUED'
          AND job.stage = 'WAITING_FOR_QUEUE'
        )
        OR (
          job.status = 'RUNNING'
          AND job.stage = 'WAITING_EXECUTION_GRANT'
        )
      )
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
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_path, '')))
      / length(old_path) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank claim function before terminal Job fast path'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_path, new_path);
END
$migration$;

DO $migration$
DECLARE
  definition TEXT;
  old_path CONSTANT TEXT := $old$  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    WHERE execution.provider = provider_name
      AND execution.execution_connector_version =
        p_execution_connector_version
      AND (
        execution.status = 'READY_TO_SUBMIT'
        OR (
          execution.status = 'CLAIMED'
          AND execution.lease_expires_at <= clock_timestamp()
        )
      )
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
    LIMIT 1
  ) THEN
    RETURN;
  END IF;$old$;
  new_path CONSTANT TEXT := $new$  IF NOT EXISTS (
    SELECT 1
    FROM public.rank_connector_executions execution
    JOIN public.jobs job
      ON job.workspace_id = execution.workspace_id
      AND job.project_id = execution.project_id
      AND job.id = execution.job_id
    WHERE execution.provider = provider_name
      AND execution.execution_connector_version =
        p_execution_connector_version
      AND execution.authorization_expires_at >
        clock_timestamp() + make_interval(secs => p_lease_seconds)
      AND job.type = 'MANUAL_RANK_CHECK'
      AND job.provider = execution.provider
      AND job.version = execution.job_version
      AND job.cancel_requested_at IS NULL
      AND (
        (
          job.status = 'QUEUED'
          AND job.stage = 'WAITING_FOR_QUEUE'
        )
        OR (
          job.status = 'RUNNING'
          AND job.stage = 'WAITING_EXECUTION_GRANT'
        )
      )
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
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_submit_bounded(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_path, '')))
      / length(old_path) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected bounded rank submit before terminal Job fast path'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_path, new_path);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization(
    TEXT, INTEGER, TEXT
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_bounded(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;

COMMIT;

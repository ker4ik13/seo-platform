BEGIN;

DO $migration$
DECLARE
  definition TEXT;
  old_path CONSTANT TEXT := $old$IF provider_name <> 'ARSENKIN' THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock($old$;
  new_path CONSTANT TEXT := $new$IF provider_name <> 'ARSENKIN' THEN RETURN; END IF;

  -- Avoid serialising every idle connector slot on the provider-wide lock.
  -- This is intentionally only a broad indexed pre-check; the original
  -- locked function below remains the authoritative eligibility fence.
  IF NOT EXISTS (
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
  END IF;

  PERFORM pg_advisory_xact_lock($new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_submit_bounded(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_path, '')))
      / length(old_path) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected bounded rank submit function before idle fast path'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_path, new_path);
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_bounded(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;

COMMIT;

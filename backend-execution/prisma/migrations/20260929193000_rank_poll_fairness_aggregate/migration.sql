BEGIN;

-- A due poll used to run the active-FETCHING COUNT once for every candidate
-- before LIMIT 1. With thousands of due pages that multiplies the same
-- credential/project index scan millions of times. Aggregate the small set
-- of live FETCHING leases once per claim instead; keep the same fairness
-- ordering and the existing job/control/credential/lease fences.
DO $migration$
DECLARE
  definition TEXT;
  old_candidate CONSTANT TEXT := $old$  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution$old$;
  new_candidate CONSTANT TEXT := $new$  WITH active_fetches AS MATERIALIZED (
    SELECT active_execution.credential_id,
           active_execution.project_id,
           active_execution.provider,
           COUNT(*) AS active_count
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.execution_connector_version =
      p_execution_connector_version
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
    GROUP BY active_execution.credential_id,
             active_execution.project_id,
             active_execution.provider
  )
  SELECT execution.*
  INTO candidate
  FROM public.rank_connector_executions execution$new$;
  old_join CONSTANT TEXT := $old$  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
  WHERE execution.execution_connector_version = p_execution_connector_version$old$;
  new_join CONSTANT TEXT := $new$  JOIN public.integration_credentials credential
    ON credential.workspace_id = execution.workspace_id
    AND credential.id = execution.credential_id
  LEFT JOIN active_fetches
    ON active_fetches.credential_id = execution.credential_id
    AND active_fetches.project_id = execution.project_id
    AND active_fetches.provider = execution.provider
  WHERE execution.execution_connector_version = p_execution_connector_version$new$;
  old_order CONSTANT TEXT := $old$ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.credential_id = execution.credential_id
      AND active_execution.project_id = execution.project_id
      AND active_execution.provider = execution.provider
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
  ), execution.$old$;
  new_order CONSTANT TEXT :=
    'ORDER BY COALESCE(active_fetches.active_count, 0), execution.';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_candidate, '')))
      / length(old_candidate) <> 2
    OR (length(definition) - length(replace(definition, old_join, '')))
      / length(old_join) <> 2
    OR (length(definition) - length(replace(definition, old_order, '')))
      / length(old_order) <> 2
  THEN
    RAISE EXCEPTION 'Unexpected rank poll claim before fairness aggregation'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(
    replace(
      replace(definition, old_candidate, new_candidate),
      old_join, new_join
    ),
    old_order, new_order
  );
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_poll(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;

COMMIT;

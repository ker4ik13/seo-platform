BEGIN;

-- Candidate fairness is decided by list_rank_connector_submit_candidates.
-- The targeted graph claim sees exactly one execution ID: recomputing the
-- active execution count for ORDER BY cannot change its order and repeatedly
-- scans the large append-only execution table under every connector lane.
DO $migration$
DECLARE
  definition TEXT;
  old_order CONSTANT TEXT := $old$ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution."credential_id" = execution."credential_id"
      AND active_execution."project_id" = execution."project_id"
      AND active_execution."provider" = execution."provider"
      AND (
        active_execution."status" = 'SUBMITTING'
        OR (
          active_execution."status" IN ('CLAIMED', 'FETCHING')
          AND active_execution."lease_expires_at" > clock_timestamp()
        )
      )
  ), execution."created_at", execution."id"$old$;
  new_order CONSTANT TEXT :=
    'ORDER BY execution."created_at", execution."id"';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization_targeted(text,integer,text,uuid)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_order, '')))
      / length(old_order) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected targeted rank submit sort before optimization'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(definition, old_order, new_order);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization_targeted(
    TEXT, INTEGER, TEXT, UUID
  ) FROM PUBLIC;

COMMIT;

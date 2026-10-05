BEGIN;

-- The full graph lookup is only a hint. Locking the parent Job as part of
-- that many-way SELECT makes every concurrent connector execute its joins
-- under LockRows. Keep the lookup read-only, then acquire the same parent
-- lock by its exact tenant-scoped key before locking any child row. The
-- existing post-lock graph and control rechecks remain authoritative.
DO $migration$
DECLARE
  definition TEXT;
  old_claim CONSTANT TEXT := $old$  FOR UPDATE OF job SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;$old$;
  new_claim CONSTANT TEXT := $new$  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  /* rank-connector-claim:job-lock */
  PERFORM 1
  FROM public.jobs job
  WHERE job."workspace_id" = candidate."workspace_id"
    AND job."project_id" = candidate."project_id"
    AND job."id" = candidate."job_id"
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."version" = candidate."job_version"
    AND job."cancel_requested_at" IS NULL
    AND (
      (job."status" = 'QUEUED' AND job."stage" = 'WAITING_FOR_QUEUE')
      OR (job."status" = 'RUNNING' AND job."stage" = 'WAITING_EXECUTION_GRANT')
    )
  FOR UPDATE OF job SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization_targeted(text,integer,text,uuid)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR strpos(definition, 'WITH target_execution AS MATERIALIZED') = 0
    OR (length(definition) - length(replace(definition, old_claim, '')))
      / length(old_claim) <> 1
    OR strpos(definition, 'rank-connector-claim:job-lock') <> 0
  THEN
    RAISE EXCEPTION 'Unexpected targeted rank submit before separate Job lock'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, old_claim, new_claim);
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_rank_connector_execution_pre_authorization_targeted(
    TEXT, INTEGER, TEXT, UUID
  ) FROM PUBLIC;

COMMIT;

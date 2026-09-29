BEGIN;

ALTER TABLE public.rank_connector_executions
  ADD COLUMN remote_unknown_retries INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT rank_connector_executions_remote_unknown_retries_check
    CHECK (remote_unknown_retries BETWEEN 0 AND 1);

-- The previous remote lease is conservatively treated as possibly paid. A
-- second expired lease on the same page becomes visible failed work instead
-- of issuing a third potentially paid provider request.
DO $migration$
DECLARE
  definition TEXT;
  old_terminal CONSTANT TEXT :=
    'AND execution.poll_attempt_count >= 50';
  new_terminal CONSTANT TEXT :=
    'AND (execution.poll_attempt_count >= 50 OR '
    || '(execution.remote_unknown_retries >= 1 '
    || 'AND execution.status = ''FETCHING'' '
    || 'AND execution.lease_expires_at <= clock_timestamp()))';
  old_increment CONSTANT TEXT :=
    'poll_attempt_count = execution.poll_attempt_count + 1,';
  new_increment CONSTANT TEXT :=
    'poll_attempt_count = execution.poll_attempt_count + 1,'
    || E'\n      remote_unknown_retries = CASE'
    || E'\n        WHEN execution.status = ''POLL_WAIT'' THEN 0'
    || E'\n        WHEN execution.lease_owner LIKE ''remote:%'' THEN 1'
    || E'\n        ELSE execution.remote_unknown_retries END,';
  old_error CONSTANT TEXT :=
    'COALESCE('
    || E'\n        execution.last_error_code,'
    || E'\n        ''PROVIDER_POLL_TIMEOUT'''
    || E'\n      )';
  new_error CONSTANT TEXT :=
    'COALESCE('
    || E'\n        execution.last_error_code,'
    || E'\n        CASE WHEN execution.remote_unknown_retries >= 1'
    || E'\n          THEN ''REMOTE_WORKER_OUTCOME_UNKNOWN'''
    || E'\n          ELSE ''PROVIDER_POLL_TIMEOUT'' END'
    || E'\n      )';
  old_header CONSTANT TEXT :=
    'claim_rank_connector_poll(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text)';
  targeted_header CONSTANT TEXT :=
    'claim_rank_connector_poll_targeted(p_lease_owner text, p_lease_seconds integer, p_execution_connector_version text, p_execution_id uuid)';
  old_candidate CONSTANT TEXT :=
    'WHERE execution.execution_connector_version = p_execution_connector_version'
    || E'\n    AND control.execution_connector_version = p_execution_connector_version';
  targeted_candidate CONSTANT TEXT :=
    'WHERE execution.id = p_execution_id'
    || E'\n    AND execution.execution_connector_version = p_execution_connector_version'
    || E'\n    AND control.execution_connector_version = p_execution_connector_version';
  old_terminal_scope CONSTANT TEXT :=
    'AND execution.provider = ''XMLSTOCK'''
    || E'\n    AND (execution.poll_attempt_count >= 50';
  targeted_terminal_scope CONSTANT TEXT :=
    'AND execution.id = p_execution_id'
    || E'\n    AND execution.provider = ''XMLSTOCK'''
    || E'\n    AND (execution.poll_attempt_count >= 50';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO definition;
  IF definition IS NULL
    OR (length(definition) - length(replace(definition, old_terminal, '')))
      / length(old_terminal) <> 1
    OR (length(definition) - length(replace(definition, old_increment, '')))
      / length(old_increment) <> 1
    OR (length(definition) - length(replace(definition, old_error, '')))
      / length(old_error) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected canonical rank poll function'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(
    replace(replace(definition, old_terminal, new_terminal),
      old_increment, new_increment), old_error, new_error
  );
  EXECUTE definition;

  -- Rebuild the targeted variant from the same guarded source so local and
  -- remote claimers cannot take different recovery paths.
  IF (length(definition) - length(replace(definition, old_header, '')))
      / length(old_header) <> 1
    OR (length(definition) - length(replace(definition, old_candidate, '')))
      / length(old_candidate) <> 2
    OR (length(definition) - length(replace(definition, old_terminal_scope, '')))
      / length(old_terminal_scope) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected rank poll function before targeted rebuild'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE replace(
    replace(
      replace(definition, old_header, targeted_header),
      old_candidate, targeted_candidate
    ),
    old_terminal_scope, targeted_terminal_scope
  );
END
$migration$;

COMMIT;

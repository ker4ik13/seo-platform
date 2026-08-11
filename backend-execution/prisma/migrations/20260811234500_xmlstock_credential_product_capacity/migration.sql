BEGIN;

-- XMLStock capacity belongs to one credential and one provider product, not
-- to every tenant using XMLStock. Redis gates the real HTTP requests with
-- separate credential/product buckets. Keep the legacy five-task lifecycle
-- limit only for Arsenkin, whose remote task contract still requires it.
CREATE OR REPLACE FUNCTION public.claim_rank_connector_submit_bounded(
  p_lease_owner TEXT,
  p_lease_seconds INTEGER,
  p_execution_connector_version TEXT
)
RETURNS TABLE (
  "executionId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "workspaceId" UUID,
  "provider" VARCHAR(64),
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "keyVersion" INTEGER,
  "leaseGeneration" INTEGER,
  "executionVersion" INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  provider_name VARCHAR(64);
  active_provider_tasks BIGINT;
BEGIN
  SELECT control.provider
  INTO provider_name
  FROM public.rank_connector_execution_controls control
  WHERE control.capability = 'SERP_RANK_TRACKING'
    AND control.execution_connector_version = p_execution_connector_version;
  IF NOT FOUND THEN RETURN; END IF;

  IF provider_name = 'XMLSTOCK' THEN
    RETURN QUERY
    SELECT *
    FROM public.claim_rank_connector_execution(
      p_lease_owner,
      p_lease_seconds,
      p_execution_connector_version
    );
    RETURN;
  END IF;

  IF provider_name <> 'ARSENKIN' THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('seo-platform:rank-submit:' || provider_name, 0)
  );

  SELECT
    (
      SELECT COUNT(*)
      FROM public.rank_connector_executions execution
      JOIN public.jobs rank_job
        ON rank_job.workspace_id = execution.workspace_id
       AND rank_job.project_id = execution.project_id
       AND rank_job.id = execution.job_id
      WHERE execution.provider = provider_name
        AND rank_job.type = 'MANUAL_RANK_CHECK'
        AND rank_job.provider = provider_name
        AND rank_job.status = 'RUNNING'
        AND rank_job.stage = 'WAITING_EXECUTION_GRANT'
        AND rank_job.cancel_requested_at IS NULL
        AND rank_job.version = execution.job_version
        AND (
          execution.status IN ('SUBMITTING', 'POLL_WAIT')
          OR (
            execution.status = 'CLAIMED'
            AND execution.lease_expires_at > clock_timestamp()
          )
          OR (
            execution.status = 'FETCHING'
            AND execution.lease_expires_at > clock_timestamp()
          )
        )
    ) + (
      SELECT COUNT(DISTINCT frequency_job.id)
      FROM public.jobs frequency_job
      JOIN public.job_items item
        ON item.job_id = frequency_job.id
        AND item.workspace_id = frequency_job.workspace_id
        AND item.project_id = frequency_job.project_id
      WHERE frequency_job.type = 'FREQUENCY_COLLECTION'
        AND frequency_job.provider = provider_name
        AND (
          (
            frequency_job.status IN (
              'RUNNING',
              'RETRY_SCHEDULED',
              'WAITING_RATE_LIMIT',
              'FAILED_RETRYABLE'
            )
            AND item.status IN ('RUNNING', 'FAILED_RETRYABLE')
            AND item.provider_request_id IS NOT NULL
          )
          OR (
            frequency_job.status = 'ACTION_REQUIRED'
            AND item.provider_request_id ~ '^submitting:'
          )
        )
    )
  INTO active_provider_tasks;
  IF active_provider_tasks >= 5 THEN RETURN; END IF;

  RETURN QUERY
  SELECT *
  FROM public.claim_rank_connector_execution(
    p_lease_owner,
    p_lease_seconds,
    p_execution_connector_version
  );
END
$$;

-- Prefer a project/credential pair with fewer live connector leases. This
-- keeps a large old run from monopolising all connector workers while still
-- retaining the established lock order and oldest-item ordering as tie-breaks.
DO $migration$
DECLARE
  function_definition TEXT;
  old_order CONSTANT TEXT :=
    'ORDER BY execution."created_at", execution."id"';
  new_order CONSTANT TEXT := $order$ORDER BY (
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
  ), execution."created_at", execution."id"$order$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL
    OR (length(function_definition) - length(replace(function_definition, old_order, '')))
      / length(old_order) <> 1
  THEN
    RAISE EXCEPTION 'unexpected rank submit ordering before fairness migration';
  END IF;

  EXECUTE replace(function_definition, old_order, new_order);
END
$migration$;

-- Polls are also distributed fairly. POLL_WAIT is deliberately not counted:
-- waiting for the next provider page is not an HTTP request and must not hold
-- capacity that another credential or project can use.
DO $migration$
DECLARE
  function_definition TEXT;
  old_order CONSTANT TEXT :=
    'ORDER BY execution.next_action_at NULLS FIRST, execution.created_at, execution.id';
  new_order CONSTANT TEXT := $order$ORDER BY (
    SELECT COUNT(*)
    FROM public.rank_connector_executions active_execution
    WHERE active_execution.credential_id = execution.credential_id
      AND active_execution.project_id = execution.project_id
      AND active_execution.provider = execution.provider
      AND active_execution.status = 'FETCHING'
      AND active_execution.lease_expires_at > clock_timestamp()
  ), execution.next_action_at NULLS FIRST, execution.created_at, execution.id$order$;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_poll(text,integer,text)'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL
    OR (length(function_definition) - length(replace(function_definition, old_order, '')))
      / length(old_order) <> 1
  THEN
    RAISE EXCEPTION 'unexpected rank poll ordering before fairness migration';
  END IF;

  EXECUTE replace(function_definition, old_order, new_order);
END
$migration$;

CREATE INDEX rank_connector_executions_credential_project_active_idx
  ON public.rank_connector_executions (
    credential_id,
    project_id,
    provider,
    status,
    lease_expires_at
  );

-- A local Redis-capacity miss means no provider request happened. Permit the
-- exact FETCHING -> POLL_WAIT transition to restore the consumed poll counter.
DO $migration$
DECLARE
  function_definition TEXT;
  old_guard CONSTANT TEXT := $old$IF NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NEW."poll_attempt_count" <> OLD."poll_attempt_count"
      OR NEW."updated_at" < OLD."updated_at"$old$;
  new_guard CONSTANT TEXT := $new$IF NEW."version" <> OLD."version" + 1
      OR NEW."lease_generation" <> OLD."lease_generation"
      OR NOT (
        NEW."poll_attempt_count" = OLD."poll_attempt_count"
        OR (
          NEW."status" = 'POLL_WAIT'
          AND OLD."poll_attempt_count" > 0
          AND NEW."poll_attempt_count" = OLD."poll_attempt_count" - 1
        )
      )
      OR NEW."updated_at" < OLD."updated_at"$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.assert_rank_connector_execution_claim_transition()'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL
    OR (length(function_definition) - length(replace(function_definition, old_guard, '')))
      / length(old_guard) <> 1
  THEN
    RAISE EXCEPTION 'unexpected rank poll completion guard before capacity migration';
  END IF;

  EXECUTE replace(function_definition, old_guard, new_guard);
END
$migration$;

CREATE FUNCTION public.defer_rank_connector_poll_capacity(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER,
  p_retry_after_seconds INTEGER
)
RETURNS TABLE (
  "executionId" UUID,
  "status" public."RankConnectorExecutionStatus",
  "executionVersion" INTEGER,
  "nextActionAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_execution public.rank_connector_executions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_retry_after_seconds NOT BETWEEN 5 AND 3600 THEN
    RAISE EXCEPTION 'Invalid rank connector capacity retry delay'
      USING ERRCODE = '22023';
  END IF;

  SELECT execution.*
  INTO current_execution
  FROM public.rank_connector_executions execution
  WHERE execution.workspace_id = p_workspace_id
    AND execution.id = p_execution_id
    AND execution.provider = 'XMLSTOCK'
    AND execution.status = 'FETCHING'
    AND execution.lease_owner = p_lease_owner
    AND execution.lease_token = p_lease_token
    AND execution.lease_generation = p_lease_generation
    AND execution.version = p_expected_version
    AND execution.lease_expires_at > v_now
    AND execution.poll_attempt_count > 0
  FOR UPDATE OF execution;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.rank_connector_executions execution
  SET status = 'POLL_WAIT',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_at = NULL,
      poll_attempt_count = execution.poll_attempt_count - 1,
      next_action_at = v_now + make_interval(secs => p_retry_after_seconds),
      last_error_code = NULL,
      version = execution.version + 1,
      updated_at = v_now
  WHERE execution.id = current_execution.id
    AND execution.version = current_execution.version
  RETURNING execution.id, execution.status, execution.version, execution.next_action_at;
END
$$;

-- XMLStock uses the same no-attempt capacity deferral as Arsenkin. The
-- provider-specific Redis limiter decides whether capacity is available.
DO $migration$
DECLARE
  function_definition TEXT;
  old_provider CONSTANT TEXT := 'AND job.provider = ''ARSENKIN''';
  new_provider CONSTANT TEXT :=
    'AND job.provider IN (''ARSENKIN'', ''XMLSTOCK'')';
BEGIN
  SELECT pg_get_functiondef(
    'public.defer_frequency_collection_batch_capacity(uuid,uuid[],text,integer,integer)'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL
    OR (length(function_definition) - length(replace(function_definition, old_provider, '')))
      / length(old_provider) <> 1
  THEN
    RAISE EXCEPTION 'unexpected frequency capacity provider boundary';
  END IF;

  EXECUTE replace(function_definition, old_provider, new_provider);
END
$migration$;

-- Move a just-serviced frequency job behind other due jobs. This provides a
-- cheap round-robin across projects without changing claim ownership or
-- introducing a second source of truth.
DO $migration$
DECLARE
  function_definition TEXT;
  old_order CONSTANT TEXT :=
    'ORDER BY job.priority, job.created_at, job.id';
  new_order CONSTANT TEXT :=
    'ORDER BY job.priority, job.updated_at, job.created_at, job.id';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_frequency_collection_item(text,integer)'::regprocedure
  ) INTO function_definition;

  IF function_definition IS NULL
    OR (length(function_definition) - length(replace(function_definition, old_order, '')))
      / length(old_order) <> 1
  THEN
    RAISE EXCEPTION 'unexpected frequency claim ordering before fairness migration';
  END IF;

  EXECUTE replace(function_definition, old_order, new_order);
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_rank_connector_submit_bounded(
  TEXT, INTEGER, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_rank_connector_poll_capacity(
  UUID, UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.defer_frequency_collection_batch_capacity(
  UUID, UUID[], TEXT, INTEGER, INTEGER
) FROM PUBLIC;

COMMIT;

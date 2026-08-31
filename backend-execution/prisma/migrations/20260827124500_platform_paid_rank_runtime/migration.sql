BEGIN;

LOCK TABLE public.rank_estimates IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.integration_credentials IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.rank_connector_executions IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.rank_estimates
  DROP CONSTRAINT rank_estimates_provider_route,
  ADD CONSTRAINT rank_estimates_provider_route
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND credential_mode IN ('BYOK_API_KEY', 'PLATFORM_PAID')
  ) NOT VALID;

-- A workspace can route through at most one current system credential per
-- provider. Revoked rows remain as immutable history and do not block re-enable.
CREATE UNIQUE INDEX integration_credentials_workspace_platform_provider_active_key
  ON public.integration_credentials (workspace_id, provider)
  WHERE mode = 'PLATFORM_PAID' AND deleted_at IS NULL;

-- The signed request remains an exact JSON allowlist. Widen only the
-- credential-mode literal and bind the rebuilt object to that same value.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.rank_execution_grant_request_is_exact(jsonb,uuid,uuid,uuid,uuid,integer,integer,bytea)'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    '''credentialMode'', ''BYOK_API_KEY''',
    '''credentialMode'', p_snapshot ->> ''credentialMode'''
  );
  definition := replace(
    definition,
    'AND (p_snapshot ->> ''policyVersion'') ~',
    'AND (p_snapshot ->> ''credentialMode'') IN ' ||
      '(''BYOK_API_KEY'', ''PLATFORM_PAID'')' || E'\n    ' ||
    'AND (p_snapshot ->> ''policyVersion'') ~'
  );
  IF position('''credentialMode'', ''BYOK_API_KEY''' IN definition) > 0
    OR position(
      '(p_snapshot ->> ''credentialMode'') IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
      IN definition
    ) = 0
  THEN
    RAISE EXCEPTION 'Rank grant request mode guard was not widened safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

-- Preserve the complete current Job lifecycle function while widening only
-- its immutable credential-mode vocabulary.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.assert_manual_rank_job_shape()'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'NEW."credential_mode" <> ''BYOK_API_KEY''',
    'NEW."credential_mode" NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
  );
  definition := replace(
    definition,
    'new.credential_mode <> ''BYOK_API_KEY''',
    'new.credential_mode NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
  );
  definition := replace(
    definition,
    'NEW."estimated_cost_micro" IS DISTINCT FROM 0',
    '(NEW."credential_mode" = ''BYOK_API_KEY''
      AND NEW."estimated_cost_micro" IS DISTINCT FROM 0)
    OR (NEW."credential_mode" = ''PLATFORM_PAID''
      AND (
        NEW."estimated_cost_micro" IS NULL
        OR NEW."estimated_cost_micro" <= 0
        OR mod(NEW."estimated_cost_micro", 10000) <> 0
      ))'
  );
  IF position('credential_mode" <> ''BYOK_API_KEY''' IN definition) > 0
    OR position('credential_mode <> ''BYOK_API_KEY''' IN definition) > 0
    OR position('PLATFORM_PAID' IN definition) = 0
    OR position(
      'mod(NEW."estimated_cost_micro", 10000) <> 0' IN definition
    ) = 0
  THEN
    RAISE EXCEPTION 'Manual rank Job price guard was not widened safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

-- The connector execution insert is the authoritative cross-table fence.
-- Require Job, estimate, credential and validation to agree on the same mode.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.assert_rank_connector_execution_scope()'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'AND job.credential_mode = ''BYOK_API_KEY''',
    'AND job.credential_mode IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
  );
  definition := replace(
    definition,
    'AND estimate.provider = NEW.provider',
    'AND estimate.provider = NEW.provider' || E'\n      ' ||
    'AND estimate.credential_mode = job.credential_mode'
  );
  definition := replace(
    definition,
    'AND credential.mode = ''BYOK_API_KEY''',
    'AND credential.mode = job.credential_mode'
  );
  definition := replace(
    definition,
    'AND validation.provider = NEW.provider',
    'AND validation.provider = NEW.provider' || E'\n      ' ||
    'AND validation.credential_mode = job.credential_mode'
  );
  IF position('job.credential_mode = ''BYOK_API_KEY''' IN definition) > 0
    OR position('credential.mode = ''BYOK_API_KEY''' IN definition) > 0
    OR position(
      'estimate.credential_mode = job.credential_mode' IN definition
    ) = 0
    OR position(
      'credential.mode = job.credential_mode' IN definition
    ) = 0
    OR position(
      'validation.credential_mode = job.credential_mode' IN definition
    ) = 0
  THEN
    RAISE EXCEPTION 'Rank connector scope mode fence was not updated safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

-- The private claim and final submit authorization are downstream of the
-- cross-table fence, but still fail closed to the same two allowed modes.
DO $migration$
DECLARE
  procedure_name REGPROCEDURE;
  definition TEXT;
BEGIN
  FOREACH procedure_name IN ARRAY ARRAY[
    'public.claim_rank_connector_execution_pre_authorization(text,integer,text)'::regprocedure,
    'public.authorize_rank_connector_execution_submit(uuid,uuid,text,uuid,integer,integer,text)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(procedure_name) INTO definition;
    definition := replace(
      definition,
      '"credential_mode" = ''BYOK_API_KEY''',
      '"credential_mode" IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '.credential_mode = ''BYOK_API_KEY''',
      '.credential_mode IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '"mode" = ''BYOK_API_KEY''',
      '"mode" IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '.mode = ''BYOK_API_KEY''',
      '.mode IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    IF position('= ''BYOK_API_KEY''' IN definition) > 0
      OR position('PLATFORM_PAID' IN definition) = 0
    THEN
      RAISE EXCEPTION 'Rank connector runtime mode guard was not updated safely'
        USING ERRCODE = '55000';
    END IF;
    EXECUTE definition;
  END LOOP;
END
$migration$;

-- Validation jobs use the same encrypted vault and connector probes for
-- BYOK and platform-owned API keys. No other credential mode is admitted.
DO $migration$
DECLARE
  procedure_name REGPROCEDURE;
  definition TEXT;
BEGIN
  FOREACH procedure_name IN ARRAY ARRAY[
    'public.claim_integration_credential_validation(uuid,text,integer)'::regprocedure,
    'public.finish_integration_credential_validation_provider_failure(uuid,text,uuid,integer,text,text,integer)'::regprocedure,
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ]
  LOOP
    SELECT pg_get_functiondef(procedure_name) INTO definition;
    definition := replace(
      definition,
      '"mode" IS DISTINCT FROM ''BYOK_API_KEY''',
      '"mode" NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '.mode IS DISTINCT FROM ''BYOK_API_KEY''',
      '.mode NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '"credential_mode" IS DISTINCT FROM ''BYOK_API_KEY''',
      '"credential_mode" NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    definition := replace(
      definition,
      '.credential_mode IS DISTINCT FROM ''BYOK_API_KEY''',
      '.credential_mode NOT IN (''BYOK_API_KEY'', ''PLATFORM_PAID'')'
    );
    IF position('IS DISTINCT FROM ''BYOK_API_KEY''' IN definition) > 0
      OR position('PLATFORM_PAID' IN definition) = 0
    THEN
      RAISE EXCEPTION 'Credential validation mode guard was not updated safely'
        USING ERRCODE = '55000';
    END IF;
    EXECUTE definition;
  END LOOP;
END
$migration$;

-- Platform credentials also need a fresh validation proof after 24 hours.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.schedule_integration_credential_validation_refreshes(uuid[],timestamptz,jsonb,text,integer)'::regprocedure
  ) INTO definition;
  definition := replace(
    definition,
    'IN (''BYOK_API_KEY'', ''BYOK_OAUTH'')',
    'IN (''BYOK_API_KEY'', ''BYOK_OAUTH'', ''PLATFORM_PAID'')'
  );
  IF position(
    'IN (''BYOK_API_KEY'', ''BYOK_OAUTH'', ''PLATFORM_PAID'')'
    IN definition
  ) = 0
  THEN
    RAISE EXCEPTION 'Credential refresh mode guard was not updated safely'
      USING ERRCODE = '55000';
  END IF;
  EXECUTE definition;
END
$migration$;

-- The connector may learn only the immutable billing receipt identifier and
-- whether the currently leased submit or poll uses platform-paid credentials.
-- A poll lease is admitted because synchronous XMLStock performs its first
-- paid HTTP request after the local submit transition. The function rechecks
-- the complete lease/grant/job fence and exposes neither billing amounts nor
-- any credential material.
CREATE FUNCTION public.read_rank_connector_billing_settlement(
  p_workspace_id UUID,
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_lease_generation INTEGER,
  p_expected_version INTEGER
)
RETURNS TABLE (
  "grantId" UUID,
  "credentialMode" TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    (attempt."decision_snapshot" #>> '{grant,id}')::uuid,
    job."credential_mode"::text
  FROM public.rank_connector_executions execution
  JOIN public.jobs job
    ON job."workspace_id" = execution."workspace_id"
    AND job."project_id" = execution."project_id"
    AND job."id" = execution."job_id"
  JOIN public.rank_execution_grant_attempts attempt
    ON attempt."id" = execution."grant_attempt_id"
    AND attempt."workspace_id" = execution."workspace_id"
    AND attempt."project_id" = execution."project_id"
    AND attempt."job_id" = execution."job_id"
    AND attempt."job_item_id" = execution."job_item_id"
    AND attempt."execution_attempt" = execution."execution_attempt"
    AND attempt."job_version" = execution."job_version"
    AND attempt."execution_evidence_hash" =
      execution."execution_evidence_hash"
  WHERE execution."workspace_id" = p_workspace_id
    AND execution."id" = p_execution_id
    AND execution."status" IN ('CLAIMED', 'FETCHING')
    AND execution."lease_owner" = p_lease_owner
    AND execution."lease_token" = p_lease_token
    AND execution."lease_generation" = p_lease_generation
    AND execution."version" = p_expected_version
    AND execution."lease_expires_at" > clock_timestamp()
    AND (
      execution."status" = 'FETCHING'
      OR execution."authorization_expires_at" > clock_timestamp()
    )
    AND attempt."status" = 'CONSUMED'
    AND attempt."expires_at" = execution."authorization_expires_at"
    AND attempt."decision_snapshot" ->> 'status' = 'GRANTED'
    AND attempt."decision_snapshot" #>> '{grant,id}' IS NOT NULL
    AND job."type" = 'MANUAL_RANK_CHECK'
    AND job."provider" = execution."provider"
    AND job."credential_mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND job."status" = 'RUNNING'
    AND job."stage" = 'WAITING_EXECUTION_GRANT'
    AND job."version" = execution."job_version"
    AND job."cancel_requested_at" IS NULL
    AND (
      execution."status" <> 'FETCHING'
      OR execution."provider_task_id" IS NOT NULL
    )
$$;

REVOKE ALL ON FUNCTION
  public.read_rank_connector_billing_settlement(
    UUID, UUID, TEXT, UUID, INTEGER, INTEGER
  )
  FROM PUBLIC;

ALTER TABLE public.rank_estimates
  VALIDATE CONSTRAINT rank_estimates_provider_route;

COMMIT;

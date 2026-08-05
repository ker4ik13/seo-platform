BEGIN;

-- Validation leases need an unguessable per-claim token in addition to the
-- worker label and optimistic Job version. Other Job types never use it.
ALTER TABLE public.jobs
  ADD COLUMN "validation_lease_token" UUID;

ALTER TABLE public.jobs
  ADD CONSTRAINT "jobs_validation_lease_token_scope"
    CHECK (
      (
        "type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
        AND (
          "validation_lease_token" IS NULL
          OR (
            "status" = 'RUNNING'
            AND "lease_owner" IS NOT NULL
            AND "lease_expires_at" IS NOT NULL
          )
        )
      )
      OR (
        "type" <> 'INTEGRATION_CREDENTIAL_VALIDATE'
        AND "validation_lease_token" IS NULL
      )
    );

-- These rows contain only a synthetic known plaintext encrypted with a KEK.
-- They deliberately contain no workspace, credential or provider identity.
CREATE TABLE public.integration_credential_kek_canaries (
  "key_version" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "auth_tag" BYTEA NOT NULL,
  "encrypted_data_key" BYTEA NOT NULL,
  "data_key_nonce" BYTEA NOT NULL,
  "data_key_auth_tag" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_credential_kek_canaries_pkey"
    PRIMARY KEY ("key_version"),
  CONSTRAINT "integration_credential_kek_canaries_shape"
    CHECK (
      "key_version" > 0
      AND octet_length("ciphertext") > 0
      AND octet_length("nonce") = 12
      AND octet_length("auth_tag") = 16
      AND octet_length("encrypted_data_key") > 0
      AND octet_length("data_key_nonce") = 12
      AND octet_length("data_key_auth_tag") = 16
    )
);

CREATE FUNCTION public.reject_integration_credential_kek_canary_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Integration credential KEK canaries are immutable'
    USING ERRCODE = '55000';
END
$$;

-- Every broker finish updates public.jobs and therefore reaches this deferred
-- trigger. Harden the pre-existing trigger function before exposing any
-- SECURITY DEFINER broker path so caller-owned pg_temp objects cannot hijack
-- its relation or helper lookup.
CREATE OR REPLACE FUNCTION public.assert_manual_rank_job_has_run()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."type" = 'MANUAL_RANK_CHECK' AND NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.rank_job_runs r
      ON r."job_id" = j."id"
     AND r."workspace_id" = j."workspace_id"
     AND r."project_id" = j."project_id"
    JOIN public.rank_estimates e
      ON e."id" = r."estimate_id"
     AND e."workspace_id" = r."workspace_id"
     AND e."project_id" = r."project_id"
    WHERE j."id" = NEW."id"
      AND j."workspace_id" = NEW."workspace_id"
      AND j."project_id" = NEW."project_id"
      AND j."type" = 'MANUAL_RANK_CHECK'
      AND e."actor_id" = j."actor_id"
      AND e."tracking_context_id" = r."tracking_context_id"
      AND e."project_version" = r."project_version"
      AND e."keyword_count"::bigint = j."progress_total"
      AND e."execution_snapshot" IS NOT NULL
      AND e."execution_snapshot_hash" IS NOT NULL
      AND public.manual_rank_job_state_is_coherent(
        j."status",
        r."seal_state",
        r."finalization_status"
      )
      AND j."attempt" BETWEEN 0 AND j."max_attempts"
      AND (
        (
          r."seal_state" IN (
            'PENDING',
            'OUTCOME_UNKNOWN',
            'NOT_SEALED'
          )
          AND r."seal_attempt_count" = j."attempt"
        )
        OR (
          r."seal_state" IN ('SEALED', 'FINALIZED')
          AND r."seal_attempt_count" <= j."attempt"
        )
      )
      AND (
        (
          j."status" IN ('CANCEL_REQUESTED', 'CANCELLED')
          AND r."cancel_requested_by" IS NOT NULL
        )
        OR (
          j."status" NOT IN (
            'CANCEL_REQUESTED',
            'CANCELLED',
            'PARTIALLY_COMPLETED',
            'COMPLETED',
            'FAILED_FINAL',
            'ACTION_REQUIRED'
          )
          AND r."cancel_requested_by" IS NULL
        )
        OR j."status" IN (
          'PARTIALLY_COMPLETED',
          'COMPLETED',
          'FAILED_FINAL',
          'ACTION_REQUIRED'
        )
      )
      AND (
        r."seal_state" NOT IN ('SEALED', 'FINALIZED')
        OR r."manifest_pair_count"::bigint = j."progress_total"
      )
      AND r."job_id" = NEW."id"
      AND r."workspace_id" = NEW."workspace_id"
      AND r."project_id" = NEW."project_id"
  ) THEN
    RAISE EXCEPTION
      'MANUAL_RANK_CHECK requires a coherent rank_job_runs row'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.assert_manual_rank_job_has_run() FROM PUBLIC;

CREATE FUNCTION public.finish_integration_credential_validation_job_failure(
  p_validation_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_expected_job_version INTEGER,
  p_error_code TEXT,
  p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS TABLE (
  "validationId" UUID,
  "workspaceId" UUID,
  "provider" TEXT,
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "connectorVersion" TEXT,
  "jobStatus" TEXT,
  "errorCode" TEXT,
  "requestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "retryAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_job public.jobs%ROWTYPE;
  retryable_failure BOOLEAN;
  next_status public."JobStatus";
  failed_at TIMESTAMPTZ;
  retry_at_value TIMESTAMPTZ;
  exponential_seconds INTEGER;
  parsed_credential_id UUID;
  parsed_material_version INTEGER;
  connector_version_text TEXT;
BEGIN
  IF p_validation_id IS NULL OR p_lease_token IS NULL
    OR p_expected_job_version IS NULL OR p_expected_job_version <= 0
    OR p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
  THEN
    RAISE EXCEPTION 'Invalid credential validation lease identity'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NULL OR p_error_code NOT IN (
    'CREDENTIAL_CHANGED',
    'CREDENTIAL_DISABLED',
    'CREDENTIAL_MODE_UNSUPPORTED',
    'CREDENTIAL_VALIDATION_UNAVAILABLE',
    'CONNECTOR_VERSION_CHANGED',
    'CREDENTIAL_KEY_VERSION_UNAVAILABLE',
    'CREDENTIAL_DECRYPTION_FAILED',
    'CREDENTIAL_VALIDATION_INTERNAL_ERROR'
  ) THEN
    RAISE EXCEPTION 'Unsupported credential validation job error code'
      USING ERRCODE = '22023';
  END IF;
  IF p_retry_after_seconds IS NOT NULL
    AND p_retry_after_seconds NOT BETWEEN 0 AND 3600
  THEN
    RAISE EXCEPTION 'Invalid credential validation retry delay'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO current_job
  FROM public.jobs job
  WHERE job."id" = p_validation_id
    AND job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND job."status" = 'RUNNING'
    AND job."lease_owner" = p_lease_owner
    AND job."validation_lease_token" = p_lease_token
    AND job."version" = p_expected_job_version
    AND job."lease_expires_at" > clock_timestamp()
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  retryable_failure := p_error_code IN (
    'CREDENTIAL_KEY_VERSION_UNAVAILABLE',
    'CREDENTIAL_DECRYPTION_FAILED',
    'CREDENTIAL_VALIDATION_INTERNAL_ERROR'
  );
  failed_at := clock_timestamp();
  IF retryable_failure AND current_job."attempt" < current_job."max_attempts" THEN
    next_status := 'RETRY_SCHEDULED';
    exponential_seconds := LEAST(
      (5 * power(2::NUMERIC, GREATEST(current_job."attempt" - 1, 0)))::INTEGER,
      300
    );
    retry_at_value := failed_at + make_interval(
      secs => GREATEST(
        exponential_seconds,
        COALESCE(p_retry_after_seconds, 0)
      )
    );
  ELSIF retryable_failure THEN
    next_status := 'FAILED_RETRYABLE';
    retry_at_value := NULL;
  ELSE
    next_status := 'FAILED_FINAL';
    retry_at_value := NULL;
  END IF;

  UPDATE public.jobs job
  SET
    "status" = next_status,
    "stage" = CASE
      WHEN next_status = 'RETRY_SCHEDULED'
        THEN 'credential_validation_retry_scheduled'
      ELSE 'credential_validation_failed'
    END,
    "error_summary" = jsonb_strip_nulls(jsonb_build_object(
      'code', p_error_code,
      'retryable', retryable_failure,
      'retryAt', CASE
        WHEN retry_at_value IS NULL THEN NULL
        ELSE to_char(
          retry_at_value AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      END
    )),
    "result_summary" = NULL,
    "finished_at" = CASE
      WHEN next_status = 'RETRY_SCHEDULED' THEN NULL
      ELSE failed_at
    END,
    "lease_owner" = NULL,
    "lease_expires_at" = NULL,
    "validation_lease_token" = NULL,
    "retry_at" = retry_at_value,
    "version" = job."version" + 1,
    "updated_at" = failed_at
  WHERE job."id" = current_job."id"
  RETURNING job.* INTO current_job;

  IF NOT pg_catalog.pg_input_is_valid(
      current_job."input_snapshot" ->> 'credentialId',
      'uuid'
    )
    OR current_job."input_snapshot" ->> 'credentialMaterialVersion'
      !~ '^[1-9][0-9]{0,9}$'
  THEN
    RETURN;
  END IF;
  parsed_credential_id :=
    (current_job."input_snapshot" ->> 'credentialId')::UUID;
  parsed_material_version :=
    (current_job."input_snapshot" ->> 'credentialMaterialVersion')::INTEGER;
  connector_version_text :=
    current_job."input_snapshot" ->> 'connectorVersion';

  RETURN QUERY
  SELECT
    current_job."id",
    current_job."workspace_id",
    current_job."provider"::TEXT,
    parsed_credential_id,
    parsed_material_version,
    connector_version_text,
    current_job."status"::TEXT,
    p_error_code,
    current_job."created_at",
    current_job."started_at",
    current_job."retry_at",
    current_job."finished_at";
END
$$;

CREATE TRIGGER "integration_credential_kek_canary_immutable"
  BEFORE UPDATE OR DELETE ON public.integration_credential_kek_canaries
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_integration_credential_kek_canary_mutation();

CREATE TRIGGER "integration_credential_kek_canary_no_truncate"
  BEFORE TRUNCATE ON public.integration_credential_kek_canaries
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.reject_integration_credential_kek_canary_mutation();

CREATE FUNCTION public.finish_integration_credential_validation_provider_failure(
  p_validation_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_expected_job_version INTEGER,
  p_error_code TEXT,
  p_credential_status TEXT DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS TABLE (
  "validationId" UUID,
  "workspaceId" UUID,
  "provider" TEXT,
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "connectorVersion" TEXT,
  "jobStatus" TEXT,
  "errorCode" TEXT,
  "requestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "retryAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_job public.jobs%ROWTYPE;
  current_credential public.integration_credentials%ROWTYPE;
  parsed_credential_id UUID;
  parsed_material_version INTEGER;
  connector_version_text TEXT;
  failed_at TIMESTAMPTZ;
  retry_at_value TIMESTAMPTZ;
  exponential_seconds INTEGER;
  retryable_failure BOOLEAN;
  next_status public."JobStatus";
  effective_error_code TEXT;
  applied_credential_status TEXT;
BEGIN
  IF p_validation_id IS NULL OR p_lease_token IS NULL
    OR p_expected_job_version IS NULL OR p_expected_job_version <= 0
    OR p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
  THEN
    RAISE EXCEPTION 'Invalid credential validation lease identity'
      USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NULL OR (
    (p_error_code = 'INVALID_CREDENTIAL'
      AND p_credential_status = 'INVALID')
    OR (p_error_code = 'PROVIDER_RATE_LIMITED'
      AND p_credential_status = 'RATE_LIMITED')
    OR (p_error_code IN (
        'PROVIDER_UNAVAILABLE',
        'PROVIDER_PLAN_OR_REQUEST_REJECTED'
      )
      AND (p_credential_status IS NULL OR p_credential_status = 'DEGRADED'))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'Unsupported provider validation failure mapping'
      USING ERRCODE = '22023';
  END IF;
  IF p_retry_after_seconds IS NOT NULL
    AND p_retry_after_seconds NOT BETWEEN 0 AND 3600
  THEN
    RAISE EXCEPTION 'Invalid provider validation retry delay'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO current_job
  FROM public.jobs job
  WHERE job."id" = p_validation_id
    AND job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND job."status" = 'RUNNING'
    AND job."lease_owner" = p_lease_owner
    AND job."validation_lease_token" = p_lease_token
    AND job."version" = p_expected_job_version
    AND job."lease_expires_at" > clock_timestamp()
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT pg_catalog.pg_input_is_valid(
      current_job."input_snapshot" ->> 'credentialId',
      'uuid'
    )
    OR current_job."input_snapshot" ->> 'credentialMaterialVersion'
      !~ '^[1-9][0-9]{0,9}$'
  THEN
    RETURN;
  END IF;
  parsed_credential_id :=
    (current_job."input_snapshot" ->> 'credentialId')::UUID;
  parsed_material_version :=
    (current_job."input_snapshot" ->> 'credentialMaterialVersion')::INTEGER;
  connector_version_text :=
    current_job."input_snapshot" ->> 'connectorVersion';

  SELECT credential.*
  INTO current_credential
  FROM public.integration_credentials credential
  WHERE credential."workspace_id" = current_job."workspace_id"
    AND credential."id" = parsed_credential_id
  FOR UPDATE OF credential;

  failed_at := clock_timestamp();
  IF NOT FOUND
    OR current_credential."deleted_at" IS NOT NULL
    OR current_credential."status" IN ('DISABLED', 'REVOKED')
    OR current_credential."provider" IS DISTINCT FROM current_job."provider"
    OR current_credential."mode" IS DISTINCT FROM 'BYOK_API_KEY'
    OR current_credential."material_version" <> parsed_material_version
  THEN
    effective_error_code := 'CREDENTIAL_CHANGED';
    retryable_failure := FALSE;
    next_status := 'FAILED_FINAL';
    retry_at_value := NULL;
    applied_credential_status := NULL;
  ELSE
    effective_error_code := p_error_code;
    retryable_failure := p_error_code IN (
      'PROVIDER_RATE_LIMITED', 'PROVIDER_UNAVAILABLE'
    );
    applied_credential_status := CASE
      WHEN p_credential_status = 'DEGRADED'
        AND current_credential."verified_at" IS NULL THEN NULL
      ELSE p_credential_status
    END;

    UPDATE public.integration_credentials credential
    SET
      "status" = CASE applied_credential_status
        WHEN 'INVALID' THEN 'INVALID'::public."CredentialStatus"
        WHEN 'RATE_LIMITED' THEN 'RATE_LIMITED'::public."CredentialStatus"
        WHEN 'DEGRADED' THEN 'DEGRADED'::public."CredentialStatus"
        ELSE credential."status"
      END,
      "last_error_at" = failed_at,
      "last_error_code" = p_error_code,
      "updated_by" = COALESCE(current_job."actor_id", credential."updated_by"),
      "version" = credential."version" + 1,
      "updated_at" = failed_at
    WHERE credential."id" = current_credential."id";

    IF retryable_failure AND current_job."attempt" < current_job."max_attempts" THEN
      next_status := CASE
        WHEN p_error_code = 'PROVIDER_RATE_LIMITED'
          THEN 'WAITING_RATE_LIMIT'::public."JobStatus"
        ELSE 'RETRY_SCHEDULED'::public."JobStatus"
      END;
      exponential_seconds := LEAST(
        (5 * power(2::NUMERIC, GREATEST(current_job."attempt" - 1, 0)))::INTEGER,
        300
      );
      retry_at_value := failed_at + make_interval(
        secs => GREATEST(
          exponential_seconds,
          COALESCE(p_retry_after_seconds, 0)
        )
      );
    ELSIF retryable_failure THEN
      next_status := 'FAILED_RETRYABLE';
      retry_at_value := NULL;
    ELSE
      next_status := 'FAILED_FINAL';
      retry_at_value := NULL;
    END IF;
  END IF;

  UPDATE public.jobs job
  SET
    "status" = next_status,
    "stage" = CASE
      WHEN next_status = 'RETRY_SCHEDULED'
        THEN 'credential_validation_retry_scheduled'
      WHEN next_status = 'WAITING_RATE_LIMIT'
        THEN 'credential_validation_waiting_rate_limit'
      ELSE 'credential_validation_failed'
    END,
    "error_summary" = jsonb_strip_nulls(jsonb_build_object(
      'code', effective_error_code,
      'retryable', retryable_failure,
      'credentialStatus', applied_credential_status,
      'retryAt', CASE
        WHEN retry_at_value IS NULL THEN NULL
        ELSE to_char(
          retry_at_value AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      END
    )),
    "result_summary" = NULL,
    "finished_at" = CASE
      WHEN next_status IN ('RETRY_SCHEDULED', 'WAITING_RATE_LIMIT') THEN NULL
      ELSE failed_at
    END,
    "lease_owner" = NULL,
    "lease_expires_at" = NULL,
    "validation_lease_token" = NULL,
    "retry_at" = retry_at_value,
    "version" = job."version" + 1,
    "updated_at" = failed_at
  WHERE job."id" = current_job."id"
  RETURNING job.* INTO current_job;

  RETURN QUERY
  SELECT
    current_job."id",
    current_job."workspace_id",
    current_job."provider"::TEXT,
    parsed_credential_id,
    parsed_material_version,
    connector_version_text,
    current_job."status"::TEXT,
    effective_error_code,
    current_job."created_at",
    current_job."started_at",
    current_job."retry_at",
    current_job."finished_at";
END
$$;

CREATE FUNCTION public.finish_integration_credential_validation_success(
  p_validation_id UUID,
  p_lease_owner TEXT,
  p_lease_token UUID,
  p_expected_job_version INTEGER,
  p_connector_version TEXT,
  p_provider_meta JSONB DEFAULT NULL
)
RETURNS TABLE (
  "validationId" UUID,
  "workspaceId" UUID,
  "provider" TEXT,
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "connectorVersion" TEXT,
  "jobStatus" TEXT,
  "errorCode" TEXT,
  "requestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "retryAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_job public.jobs%ROWTYPE;
  current_credential public.integration_credentials%ROWTYPE;
  parsed_credential_id UUID;
  parsed_material_version INTEGER;
  connector_version_text TEXT;
  completed_at TIMESTAMPTZ;
  api_request JSONB;
  effective_error_code TEXT;
BEGIN
  IF p_validation_id IS NULL OR p_lease_token IS NULL
    OR p_expected_job_version IS NULL OR p_expected_job_version <= 0
    OR p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
    OR p_connector_version IS NULL
    OR p_connector_version !~ '^[a-z0-9][a-z0-9@._-]{0,31}$'
  THEN
    RAISE EXCEPTION 'Invalid credential validation success identity'
      USING ERRCODE = '22023';
  END IF;
  IF p_provider_meta IS NOT NULL
    AND jsonb_typeof(p_provider_meta) <> 'object'
  THEN
    RAISE EXCEPTION 'Credential validation provider metadata must be an object'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.*
  INTO current_job
  FROM public.jobs job
  WHERE job."id" = p_validation_id
    AND job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND job."status" = 'RUNNING'
    AND job."lease_owner" = p_lease_owner
    AND job."validation_lease_token" = p_lease_token
    AND job."version" = p_expected_job_version
    AND job."lease_expires_at" > clock_timestamp()
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT pg_catalog.pg_input_is_valid(
      current_job."input_snapshot" ->> 'credentialId',
      'uuid'
    )
    OR current_job."input_snapshot" ->> 'credentialMaterialVersion'
      !~ '^[1-9][0-9]{0,9}$'
  THEN
    RETURN;
  END IF;
  parsed_credential_id :=
    (current_job."input_snapshot" ->> 'credentialId')::UUID;
  parsed_material_version :=
    (current_job."input_snapshot" ->> 'credentialMaterialVersion')::INTEGER;
  connector_version_text :=
    current_job."input_snapshot" ->> 'connectorVersion';
  IF connector_version_text IS DISTINCT FROM p_connector_version THEN
    RAISE EXCEPTION 'Credential validation connector version changed'
      USING ERRCODE = '22023';
  END IF;

  IF current_job."provider" = 'ARSENKIN' THEN
    -- A successful Arsenkin connector response always contains exactly one
    -- normalized non-negative safe integer.  Keep this invariant at the DB
    -- boundary too: SQL NULL/JSON null/missing keys must not pass through
    -- three-valued boolean logic and activate a credential.
    IF p_provider_meta IS NULL
      OR jsonb_typeof(p_provider_meta) IS DISTINCT FROM 'object'
      OR NOT p_provider_meta ? 'limitsTotal'
      OR p_provider_meta - 'limitsTotal' <> '{}'::JSONB
      OR jsonb_typeof(p_provider_meta -> 'limitsTotal')
        IS DISTINCT FROM 'number'
      OR COALESCE(
        p_provider_meta ->> 'limitsTotal'
          !~ '^(0|[1-9][0-9]{0,15})$',
        TRUE
      )
    THEN
      RAISE EXCEPTION 'Invalid Arsenkin validation metadata'
        USING ERRCODE = '22023';
    END IF;
    IF (p_provider_meta ->> 'limitsTotal')::NUMERIC > 9007199254740991 THEN
      RAISE EXCEPTION 'Invalid Arsenkin validation metadata'
        USING ERRCODE = '22023';
    END IF;
  ELSIF current_job."provider" = 'KEYS_SO' THEN
    IF p_provider_meta IS NOT NULL AND p_provider_meta <> '{}'::JSONB THEN
      IF p_provider_meta - 'apiRequest' <> '{}'::JSONB
        OR jsonb_typeof(p_provider_meta -> 'apiRequest') <> 'object'
      THEN
        RAISE EXCEPTION 'Invalid Keys.so validation metadata'
          USING ERRCODE = '22023';
      END IF;
      api_request := p_provider_meta -> 'apiRequest';
      IF api_request = '{}'::JSONB
        OR api_request - 'limit' - 'usedLimit' <> '{}'::JSONB
        OR (
          api_request ? 'limit'
          AND (
            jsonb_typeof(api_request -> 'limit') <> 'number'
            OR api_request ->> 'limit' !~ '^(0|[1-9][0-9]{0,15})$'
            OR (api_request ->> 'limit')::NUMERIC > 9007199254740991
          )
        )
        OR (
          api_request ? 'usedLimit'
          AND (
            jsonb_typeof(api_request -> 'usedLimit') <> 'number'
            OR api_request ->> 'usedLimit' !~ '^(0|[1-9][0-9]{0,15})$'
            OR (api_request ->> 'usedLimit')::NUMERIC > 9007199254740991
          )
        )
      THEN
        RAISE EXCEPTION 'Invalid Keys.so validation metadata'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Provider does not support credential validation success'
      USING ERRCODE = '22023';
  END IF;

  SELECT credential.*
  INTO current_credential
  FROM public.integration_credentials credential
  WHERE credential."workspace_id" = current_job."workspace_id"
    AND credential."id" = parsed_credential_id
  FOR UPDATE OF credential;

  completed_at := clock_timestamp();
  IF NOT FOUND
    OR current_credential."deleted_at" IS NOT NULL
    OR current_credential."status" IN ('DISABLED', 'REVOKED')
    OR current_credential."provider" IS DISTINCT FROM current_job."provider"
    OR current_credential."mode" IS DISTINCT FROM 'BYOK_API_KEY'
    OR current_credential."material_version" <> parsed_material_version
  THEN
    effective_error_code := 'CREDENTIAL_CHANGED';
    UPDATE public.jobs job
    SET
      "status" = 'FAILED_FINAL',
      "stage" = 'credential_validation_stale',
      "error_summary" = jsonb_build_object(
        'code', effective_error_code,
        'retryable', FALSE
      ),
      "result_summary" = NULL,
      "finished_at" = completed_at,
      "lease_owner" = NULL,
      "lease_expires_at" = NULL,
      "validation_lease_token" = NULL,
      "retry_at" = NULL,
      "version" = job."version" + 1,
      "updated_at" = completed_at
    WHERE job."id" = current_job."id"
    RETURNING job.* INTO current_job;
  ELSE
    UPDATE public.integration_credentials credential
    SET
      "status" = 'ACTIVE',
      "capabilities" = CASE current_job."provider"
        WHEN 'ARSENKIN' THEN
          '["SERP_RANK_TRACKING","CLUSTERING","INDEXATION"]'::JSONB
        WHEN 'KEYS_SO' THEN
          '["KEYWORD_RESEARCH","COMPETITOR_RESEARCH","SERP_COLLECTION"]'::JSONB
        ELSE '[]'::JSONB
      END,
      "verified_at" = completed_at,
      "last_success_at" = completed_at,
      "last_error_at" = NULL,
      "last_error_code" = NULL,
      "provider_meta" = CASE
        WHEN p_provider_meta IS NULL THEN credential."provider_meta"
        ELSE (
          CASE
            WHEN jsonb_typeof(credential."provider_meta") = 'object'
              THEN credential."provider_meta"
            ELSE '{}'::JSONB
          END
        ) || p_provider_meta
      END,
      "updated_by" = COALESCE(current_job."actor_id", credential."updated_by"),
      "version" = credential."version" + 1,
      "updated_at" = completed_at
    WHERE credential."id" = current_credential."id";

    effective_error_code := NULL;
    UPDATE public.jobs job
    SET
      "status" = 'COMPLETED',
      "stage" = 'credential_validation_completed',
      "progress_current" = 1,
      "result_summary" = jsonb_build_object(
        'credentialStatus', 'ACTIVE'
      ),
      "error_summary" = NULL,
      "finished_at" = completed_at,
      "lease_owner" = NULL,
      "lease_expires_at" = NULL,
      "validation_lease_token" = NULL,
      "retry_at" = NULL,
      "version" = job."version" + 1,
      "updated_at" = completed_at
    WHERE job."id" = current_job."id"
    RETURNING job.* INTO current_job;
  END IF;

  RETURN QUERY
  SELECT
    current_job."id",
    current_job."workspace_id",
    current_job."provider"::TEXT,
    parsed_credential_id,
    parsed_material_version,
    connector_version_text,
    current_job."status"::TEXT,
    effective_error_code,
    current_job."created_at",
    current_job."started_at",
    current_job."retry_at",
    current_job."finished_at";
END
$$;

-- MANAGEMENT uses only version metadata. The connector role is not granted
-- this function because it has no fingerprint keyring.
CREATE FUNCTION public.list_integration_credential_key_versions()
RETURNS TABLE (
  "keyKind" TEXT,
  "keyVersion" INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT versions."keyKind", versions."keyVersion"
  FROM (
    SELECT
      'ENCRYPTION'::TEXT AS "keyKind",
      credential."key_version" AS "keyVersion"
    FROM public.integration_credentials credential
    WHERE credential."deleted_at" IS NULL
    GROUP BY credential."key_version"

    UNION ALL

    SELECT
      'FINGERPRINT'::TEXT AS "keyKind",
      credential."fingerprint_key_version" AS "keyVersion"
    FROM public.integration_credentials credential
    WHERE credential."deleted_at" IS NULL
    GROUP BY credential."fingerprint_key_version"
  ) versions
  ORDER BY versions."keyKind", versions."keyVersion"
$$;

-- Register is expand-only. An existing version is returned byte-for-byte and
-- can never be overwritten with ciphertext created by replacement key bytes.
CREATE FUNCTION public.register_integration_credential_kek_canary(
  p_key_version INTEGER,
  p_ciphertext BYTEA,
  p_nonce BYTEA,
  p_auth_tag BYTEA,
  p_encrypted_data_key BYTEA,
  p_data_key_nonce BYTEA,
  p_data_key_auth_tag BYTEA
)
RETURNS TABLE (
  "keyVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_key_version IS NULL OR p_key_version <= 0
    OR p_ciphertext IS NULL OR octet_length(p_ciphertext) = 0
    OR p_nonce IS NULL OR octet_length(p_nonce) <> 12
    OR p_auth_tag IS NULL OR octet_length(p_auth_tag) <> 16
    OR p_encrypted_data_key IS NULL
    OR octet_length(p_encrypted_data_key) = 0
    OR p_data_key_nonce IS NULL OR octet_length(p_data_key_nonce) <> 12
    OR p_data_key_auth_tag IS NULL
    OR octet_length(p_data_key_auth_tag) <> 16
  THEN
    RAISE EXCEPTION 'Invalid integration credential KEK canary'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.integration_credential_kek_canaries (
    "key_version",
    "ciphertext",
    "nonce",
    "auth_tag",
    "encrypted_data_key",
    "data_key_nonce",
    "data_key_auth_tag"
  )
  VALUES (
    p_key_version,
    p_ciphertext,
    p_nonce,
    p_auth_tag,
    p_encrypted_data_key,
    p_data_key_nonce,
    p_data_key_auth_tag
  )
  ON CONFLICT ("key_version") DO NOTHING;

  RETURN QUERY
  SELECT
    canary."key_version",
    canary."ciphertext",
    canary."nonce",
    canary."auth_tag",
    canary."encrypted_data_key",
    canary."data_key_nonce",
    canary."data_key_auth_tag"
  FROM public.integration_credential_kek_canaries canary
  WHERE canary."key_version" = p_key_version;
END
$$;

-- EXECUTION requests every locally configured version so a replacement KEK is
-- proven on every replica before activation. The broker also includes versions
-- currently used by non-deleted credentials, even when the caller omitted
-- them, so incomplete keyrings still fail closed. Retired, unused and
-- unrequested historical versions are intentionally excluded. A missing
-- canary remains visible as NULL material instead of being silently skipped.
CREATE FUNCTION public.list_integration_credential_execution_kek_canaries(
  p_requested_key_versions TEXT[]
)
RETURNS TABLE (
  "keyVersion" INTEGER,
  "usedByCredential" BOOLEAN,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_requested_key_versions IS NULL
    OR pg_catalog.cardinality(p_requested_key_versions) > 128
    OR (
      pg_catalog.cardinality(p_requested_key_versions) > 0
      AND pg_catalog.array_ndims(p_requested_key_versions) <> 1
    )
  THEN
    RAISE EXCEPTION
      'Requested integration credential KEK versions are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_requested_key_versions) requested(value)
    WHERE requested.value IS NULL
      OR requested.value !~ '^[1-9][0-9]{0,9}$'
      OR NOT pg_catalog.pg_input_is_valid(requested.value, 'integer')
  ) THEN
    RAISE EXCEPTION
      'Requested integration credential KEK versions are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT requested.value)
    FROM pg_catalog.unnest(p_requested_key_versions) requested(value)
  ) THEN
    RAISE EXCEPTION
      'Requested integration credential KEK versions must be unique'
      USING ERRCODE = '22023';
  END IF;

  IF (
    WITH requested_versions AS (
      SELECT requested.value::INTEGER AS "key_version"
      FROM pg_catalog.unnest(p_requested_key_versions) requested(value)
    ),
    target_versions AS (
      SELECT requested."key_version"
      FROM requested_versions requested

      UNION

      SELECT credential."key_version"
      FROM public.integration_credentials credential
      WHERE credential."deleted_at" IS NULL
    )
    SELECT pg_catalog.count(*) > 128
    FROM target_versions
  ) THEN
    RAISE EXCEPTION
      'Integration credential KEK canary projection exceeds its limit'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_versions AS (
    SELECT requested.value::INTEGER AS "key_version"
    FROM pg_catalog.unnest(p_requested_key_versions) requested(value)
  ),
  used_versions AS (
    SELECT credential."key_version"
    FROM public.integration_credentials credential
    WHERE credential."deleted_at" IS NULL
    GROUP BY credential."key_version"
  ),
  target_versions AS (
    SELECT requested."key_version"
    FROM requested_versions requested

    UNION

    SELECT used."key_version"
    FROM used_versions used
  )
  SELECT
    target."key_version",
    used."key_version" IS NOT NULL,
    canary."ciphertext",
    canary."nonce",
    canary."auth_tag",
    canary."encrypted_data_key",
    canary."data_key_nonce",
    canary."data_key_auth_tag"
  FROM target_versions target
  LEFT JOIN used_versions used
    ON used."key_version" = target."key_version"
  LEFT JOIN public.integration_credential_kek_canaries canary
    ON canary."key_version" = target."key_version"
  ORDER BY target."key_version";
END
$$;

CREATE FUNCTION public.list_due_integration_credential_validations(
  p_limit INTEGER
)
RETURNS TABLE ("validationId" UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Credential validation list limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT job."id"
  FROM public.jobs job
  WHERE job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
    AND (
      (
        job."status" IN (
          'QUEUED',
          'RETRY_SCHEDULED',
          'WAITING_RATE_LIMIT'
        )
        AND (
          job."retry_at" IS NULL
          OR job."retry_at" <= clock_timestamp()
        )
      )
      OR (
        job."status" = 'RUNNING'
        AND (
          job."lease_expires_at" IS NULL
          OR job."lease_expires_at" <= clock_timestamp()
        )
      )
    )
  ORDER BY job."priority", job."created_at", job."id"
  LIMIT p_limit;
END
$$;

CREATE FUNCTION public.claim_integration_credential_validation(
  p_validation_id UUID,
  p_lease_owner TEXT,
  p_lease_seconds INTEGER
)
RETURNS TABLE (
  "claimOutcome" TEXT,
  "scopeState" TEXT,
  "validationId" UUID,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ,
  "jobVersion" INTEGER,
  "workspaceId" UUID,
  "provider" TEXT,
  "credentialId" UUID,
  "credentialMaterialVersion" INTEGER,
  "connectorVersion" TEXT,
  "keyVersion" INTEGER,
  "ciphertext" BYTEA,
  "nonce" BYTEA,
  "authTag" BYTEA,
  "encryptedDataKey" BYTEA,
  "dataKeyNonce" BYTEA,
  "dataKeyAuthTag" BYTEA,
  "jobStatus" TEXT,
  "errorCode" TEXT,
  "requestedAt" TIMESTAMPTZ,
  "startedAt" TIMESTAMPTZ,
  "retryAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_job public.jobs%ROWTYPE;
  current_credential public.integration_credentials%ROWTYPE;
  credential_id_text TEXT;
  material_version_text TEXT;
  connector_version_text TEXT;
  parsed_credential_id UUID;
  parsed_material_version INTEGER;
  claim_outcome TEXT := 'NOT_CLAIMABLE';
  scope_state TEXT := 'NOT_APPLICABLE';
  claimed_token UUID;
  now_at TIMESTAMPTZ;
BEGIN
  IF p_validation_id IS NULL THEN
    RAISE EXCEPTION 'Credential validation id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$'
  THEN
    RAISE EXCEPTION 'Invalid credential validation lease owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 600 THEN
    RAISE EXCEPTION 'Credential validation lease must be between 10 and 600 seconds'
      USING ERRCODE = '22023';
  END IF;

  -- An arbitrary UUID or another Job type yields no row and no existence
  -- oracle. Every subsequent field is derived from this exact Job.
  SELECT job.*
  INTO current_job
  FROM public.jobs job
  WHERE job."id" = p_validation_id
    AND job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
  FOR UPDATE OF job;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  credential_id_text := current_job."input_snapshot" ->> 'credentialId';
  material_version_text :=
    current_job."input_snapshot" ->> 'credentialMaterialVersion';
  connector_version_text :=
    current_job."input_snapshot" ->> 'connectorVersion';

  IF jsonb_typeof(current_job."input_snapshot") <> 'object'
    OR current_job."input_snapshot" ->> 'kind' IS DISTINCT FROM
      'integration.credential.validation.v1'
    OR credential_id_text IS NULL
    OR NOT pg_catalog.pg_input_is_valid(credential_id_text, 'uuid')
    OR material_version_text IS NULL
    OR material_version_text !~ '^[1-9][0-9]{0,9}$'
    OR material_version_text::BIGINT > 2147483647
    OR connector_version_text IS NULL
    OR connector_version_text !~ '^[a-z0-9][a-z0-9@._-]{0,31}$'
  THEN
    IF current_job."status" IN (
      'QUEUED', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'RUNNING'
    ) THEN
      UPDATE public.jobs job
      SET
        "status" = 'FAILED_FINAL',
        "stage" = 'credential_validation_failed',
        "error_summary" = jsonb_build_object(
          'code', 'VALIDATION_SCOPE_INVALID',
          'retryable', FALSE
        ),
        "result_summary" = NULL,
        "finished_at" = clock_timestamp(),
        "lease_owner" = NULL,
        "lease_expires_at" = NULL,
        "validation_lease_token" = NULL,
        "retry_at" = NULL,
        "version" = job."version" + 1,
        "updated_at" = clock_timestamp()
      WHERE job."id" = current_job."id";
    END IF;
    RETURN;
  END IF;

  parsed_credential_id := credential_id_text::UUID;
  parsed_material_version := material_version_text::INTEGER;

  IF current_job."project_id" IS NOT NULL
    OR current_job."provider" IS NULL
    OR current_job."provider" NOT IN ('XMLSTOCK', 'ARSENKIN', 'KEYS_SO')
    OR current_job."credential_mode" IS DISTINCT FROM 'BYOK_API_KEY'
    OR current_job."input_snapshot" IS DISTINCT FROM jsonb_build_object(
      'kind', 'integration.credential.validation.v1',
      'credentialId', parsed_credential_id::TEXT,
      'credentialMaterialVersion', parsed_material_version,
      'connectorVersion', connector_version_text
    )
    OR current_job."scope_snapshot" IS DISTINCT FROM jsonb_build_object(
      'workspaceId', current_job."workspace_id"::TEXT,
      'credentialId', parsed_credential_id::TEXT
    )
    OR current_job."idempotency_scope" IS DISTINCT FROM
      'integration-credential-validation:' || parsed_credential_id::TEXT
    OR current_job."deduplication_key" IS DISTINCT FROM
      'integration-credential-validation:' || parsed_credential_id::TEXT ||
      ':' || parsed_material_version::TEXT
  THEN
    IF current_job."status" IN (
      'QUEUED', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'RUNNING'
    ) THEN
      UPDATE public.jobs job
      SET
        "status" = 'FAILED_FINAL',
        "stage" = 'credential_validation_failed',
        "error_summary" = jsonb_build_object(
          'code', 'VALIDATION_SCOPE_INVALID',
          'retryable', FALSE
        ),
        "result_summary" = NULL,
        "finished_at" = clock_timestamp(),
        "lease_owner" = NULL,
        "lease_expires_at" = NULL,
        "validation_lease_token" = NULL,
        "retry_at" = NULL,
        "version" = job."version" + 1,
        "updated_at" = clock_timestamp()
      WHERE job."id" = current_job."id";
    END IF;
    RETURN;
  END IF;

  now_at := clock_timestamp();
  IF current_job."status" NOT IN (
    'QUEUED', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT', 'RUNNING'
  ) THEN
    claim_outcome := 'TERMINAL';
  ELSIF NOT (
    (
      current_job."status" IN (
        'QUEUED', 'RETRY_SCHEDULED', 'WAITING_RATE_LIMIT'
      )
      AND (
        current_job."retry_at" IS NULL
        OR current_job."retry_at" <= now_at
      )
    )
    OR (
      current_job."status" = 'RUNNING'
      AND (
        current_job."lease_expires_at" IS NULL
        OR current_job."lease_expires_at" <= now_at
      )
    )
  ) THEN
    claim_outcome := 'NOT_CLAIMABLE';
  ELSIF current_job."attempt" >= current_job."max_attempts" THEN
    UPDATE public.jobs job
    SET
      "status" = 'FAILED_RETRYABLE',
      "stage" = 'credential_validation_failed',
      "error_summary" = jsonb_build_object(
        'code', 'VALIDATION_ATTEMPTS_EXHAUSTED',
        'retryable', TRUE
      ),
      "result_summary" = NULL,
      "finished_at" = now_at,
      "lease_owner" = NULL,
      "lease_expires_at" = NULL,
      "validation_lease_token" = NULL,
      "retry_at" = NULL,
      "version" = job."version" + 1,
      "updated_at" = now_at
    WHERE job."id" = current_job."id"
    RETURNING job.* INTO current_job;
    claim_outcome := 'EXHAUSTED';
  ELSE
    -- Keep the canonical Job -> credential lock order, but do not start the
    -- lease before a potentially unbounded wait on the credential row.  The
    -- worker must never receive material paired with an already-expired
    -- token that another worker can immediately reclaim.
    SELECT credential.*
    INTO current_credential
    FROM public.integration_credentials credential
    WHERE credential."workspace_id" = current_job."workspace_id"
      AND credential."id" = parsed_credential_id
    FOR SHARE OF credential;

    IF NOT FOUND
      OR current_credential."deleted_at" IS NOT NULL
      OR current_credential."status" = 'REVOKED'
      OR current_credential."provider" IS DISTINCT FROM current_job."provider"
      OR current_credential."material_version" <>
        parsed_material_version
    THEN
      scope_state := 'STALE';
    ELSIF current_credential."mode" IS DISTINCT FROM 'BYOK_API_KEY' THEN
      scope_state := 'MODE_UNSUPPORTED';
    ELSIF current_credential."status" = 'DISABLED' THEN
      scope_state := 'DISABLED';
    ELSE
      scope_state := 'READY';
    END IF;

    now_at := clock_timestamp();
    claimed_token := pg_catalog.uuidv7();
    UPDATE public.jobs job
    SET
      "status" = 'RUNNING',
      "stage" = 'credential_validation_running',
      "lease_owner" = p_lease_owner,
      "lease_expires_at" =
        now_at + make_interval(secs => p_lease_seconds),
      "validation_lease_token" = claimed_token,
      "retry_at" = NULL,
      "started_at" = COALESCE(job."started_at", now_at),
      "finished_at" = NULL,
      "attempt" = job."attempt" + 1,
      "version" = job."version" + 1,
      "updated_at" = now_at
    WHERE job."id" = current_job."id"
    RETURNING job.* INTO current_job;
    claim_outcome := 'CLAIMED';
  END IF;

  RETURN QUERY
  SELECT
    claim_outcome,
    scope_state,
    current_job."id",
    CASE WHEN claim_outcome = 'CLAIMED' THEN claimed_token ELSE NULL END,
    CASE WHEN claim_outcome = 'CLAIMED'
      THEN current_job."lease_expires_at" ELSE NULL END,
    current_job."version",
    current_job."workspace_id",
    current_job."provider"::TEXT,
    parsed_credential_id,
    parsed_material_version,
    connector_version_text,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."key_version" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."ciphertext" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."nonce" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."auth_tag" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."encrypted_data_key" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."data_key_nonce" ELSE NULL END,
    CASE WHEN scope_state = 'READY'
      THEN current_credential."data_key_auth_tag" ELSE NULL END,
    current_job."status"::TEXT,
    CASE
      WHEN current_job."error_summary" ->> 'code' ~ '^[A-Z0-9_]{1,100}$'
        THEN current_job."error_summary" ->> 'code'
      ELSE NULL
    END,
    current_job."created_at",
    current_job."started_at",
    current_job."retry_at",
    current_job."finished_at";
END
$$;

REVOKE ALL ON TABLE public.integration_credential_kek_canaries FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.reject_integration_credential_kek_canary_mutation()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.list_integration_credential_key_versions()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.register_integration_credential_kek_canary(
    INTEGER, BYTEA, BYTEA, BYTEA, BYTEA, BYTEA, BYTEA
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.list_integration_credential_execution_kek_canaries(TEXT[])
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.list_due_integration_credential_validations(INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.claim_integration_credential_validation(UUID, TEXT, INTEGER)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.finish_integration_credential_validation_job_failure(
    UUID, TEXT, UUID, INTEGER, TEXT, INTEGER
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.finish_integration_credential_validation_provider_failure(
    UUID, TEXT, UUID, INTEGER, TEXT, TEXT, INTEGER
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.finish_integration_credential_validation_success(
    UUID, TEXT, UUID, INTEGER, TEXT, JSONB
  )
  FROM PUBLIC;

COMMIT;

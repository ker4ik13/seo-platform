BEGIN;

LOCK TABLE public.integration_credentials IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workspace_connector_bindings IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.workspace_connector_routes IN SHARE ROW EXCLUSIVE MODE;

-- New credentials are appended transactionally by the management service.
-- Backfill credentials created before that invariant without changing an
-- existing primary source or route order.
WITH provider_capabilities("provider", "capability") AS (
  VALUES
    ('XMLSTOCK', 'SERP_RANK_TRACKING'),
    ('XMLSTOCK', 'SERP_COLLECTION'),
    ('XMLSTOCK', 'WORDSTAT'),
    ('XMLSTOCK', 'KEYWORD_RESEARCH'),
    ('ARSENKIN', 'SERP_RANK_TRACKING'),
    ('ARSENKIN', 'SERP_COLLECTION'),
    ('ARSENKIN', 'WORDSTAT'),
    ('ARSENKIN', 'CLUSTERING'),
    ('ARSENKIN', 'KEYWORD_RESEARCH'),
    ('KEYS_SO', 'KEYWORD_RESEARCH'),
    ('KEYS_SO', 'COMPETITOR_RESEARCH')
), candidates AS (
  SELECT DISTINCT
    credential."workspace_id",
    capability."capability",
    COALESCE(credential."created_by", credential."updated_by") AS "actor_id"
  FROM public.integration_credentials credential
  JOIN provider_capabilities capability
    ON capability."provider" = credential."provider"
  WHERE credential."deleted_at" IS NULL
    AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND COALESCE(credential."created_by", credential."updated_by") IS NOT NULL
    AND jsonb_typeof(credential."capabilities") = 'array'
    AND credential."capabilities" ? capability."capability"
)
INSERT INTO public.workspace_connector_bindings (
  "workspace_id",
  "capability",
  "enabled",
  "fallback_mode",
  "fallback_reasons",
  "created_by",
  "updated_by",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  candidate."workspace_id",
  candidate."capability",
  true,
  'NONE',
  '[]'::jsonb,
  candidate."actor_id",
  candidate."actor_id",
  1,
  clock_timestamp(),
  clock_timestamp()
FROM candidates candidate
ON CONFLICT ("workspace_id", "capability") DO NOTHING;

WITH provider_capabilities("provider", "capability") AS (
  VALUES
    ('XMLSTOCK', 'SERP_RANK_TRACKING'),
    ('XMLSTOCK', 'SERP_COLLECTION'),
    ('XMLSTOCK', 'WORDSTAT'),
    ('XMLSTOCK', 'KEYWORD_RESEARCH'),
    ('ARSENKIN', 'SERP_RANK_TRACKING'),
    ('ARSENKIN', 'SERP_COLLECTION'),
    ('ARSENKIN', 'WORDSTAT'),
    ('ARSENKIN', 'CLUSTERING'),
    ('ARSENKIN', 'KEYWORD_RESEARCH'),
    ('KEYS_SO', 'KEYWORD_RESEARCH'),
    ('KEYS_SO', 'COMPETITOR_RESEARCH')
), missing AS (
  SELECT
    credential."workspace_id",
    binding."id" AS "binding_id",
    credential."id" AS "credential_id",
    credential."created_at",
    COALESCE(existing."tail", -1) AS "tail"
  FROM public.integration_credentials credential
  JOIN provider_capabilities capability
    ON capability."provider" = credential."provider"
  JOIN public.workspace_connector_bindings binding
    ON binding."workspace_id" = credential."workspace_id"
   AND binding."capability" = capability."capability"
  LEFT JOIN LATERAL (
    SELECT max(route."position") AS "tail"
    FROM public.workspace_connector_routes route
    WHERE route."workspace_id" = binding."workspace_id"
      AND route."binding_id" = binding."id"
  ) existing ON true
  WHERE credential."deleted_at" IS NULL
    AND credential."mode" IN ('BYOK_API_KEY', 'PLATFORM_PAID')
    AND jsonb_typeof(credential."capabilities") = 'array'
    AND credential."capabilities" ? capability."capability"
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_connector_routes route
      WHERE route."workspace_id" = credential."workspace_id"
        AND route."binding_id" = binding."id"
        AND route."credential_id" = credential."id"
    )
), ordered AS (
  SELECT
    missing.*,
    row_number() OVER (
      PARTITION BY missing."workspace_id", missing."binding_id"
      ORDER BY missing."created_at", missing."credential_id"
    ) AS "append_offset"
  FROM missing
)
INSERT INTO public.workspace_connector_routes (
  "workspace_id",
  "binding_id",
  "position",
  "credential_id",
  "created_at",
  "updated_at"
)
SELECT
  ordered."workspace_id",
  ordered."binding_id",
  ordered."tail" + ordered."append_offset"::integer,
  ordered."credential_id",
  clock_timestamp(),
  clock_timestamp()
FROM ordered
WHERE ordered."tail" + ordered."append_offset" <= 7
ON CONFLICT DO NOTHING;

UPDATE public.workspace_connector_bindings binding
SET
  "fallback_mode" = 'NEXT_AVAILABLE',
  "fallback_reasons" =
    '["CREDENTIAL_UNAVAILABLE","LOW_BALANCE","RATE_LIMITED","RETRYABLE_PROVIDER_ERROR"]'::jsonb,
  "version" = binding."version" + 1,
  "updated_at" = clock_timestamp()
WHERE binding."fallback_mode" = 'NONE'
  AND (
    SELECT count(*)
    FROM public.workspace_connector_routes route
    WHERE route."workspace_id" = binding."workspace_id"
      AND route."binding_id" = binding."id"
  ) > 1;

-- Provider-operation completion may happen once per batch. Keep the automatic
-- account probe on the same hourly freshness boundary instead of starting a
-- continuous validation chain during a large operation. Explicit user checks
-- use the separate validation command and remain immediate.
CREATE OR REPLACE FUNCTION public.schedule_integration_credential_validation_refreshes(
  p_credential_ids UUID[],
  p_stale_before TIMESTAMPTZ,
  p_connector_versions JSONB,
  p_reason TEXT,
  p_limit INTEGER
)
RETURNS TABLE ("validationId" UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('HOURLY', 'PROVIDER_OPERATION') THEN
    RAISE EXCEPTION 'Invalid credential refresh reason' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Credential refresh limit must be between 1 and 500'
      USING ERRCODE = '22023';
  END IF;
  IF p_connector_versions IS NULL OR jsonb_typeof(p_connector_versions) <> 'object' THEN
    RAISE EXCEPTION 'Credential connector versions must be an object'
      USING ERRCODE = '22023';
  END IF;
  IF p_stale_before IS NULL THEN
    RAISE EXCEPTION 'Credential refresh requires a stale boundary'
      USING ERRCODE = '22023';
  END IF;
  IF p_credential_ids IS NOT NULL AND cardinality(p_credential_ids) > 500 THEN
    RAISE EXCEPTION 'Too many credential refresh targets' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT credential.*,
      p_connector_versions ->> credential."provider" AS connector_version
    FROM public.integration_credentials credential
    WHERE credential."deleted_at" IS NULL
      AND credential."mode" IN ('BYOK_API_KEY', 'BYOK_OAUTH', 'PLATFORM_PAID')
      AND credential."status" NOT IN ('DISABLED', 'REVOKED', 'INVALID')
      AND (p_credential_ids IS NULL OR credential."id" = ANY(p_credential_ids))
      AND GREATEST(
        COALESCE(credential."last_success_at", '-infinity'::timestamptz),
        COALESCE(credential."last_error_at", '-infinity'::timestamptz),
        credential."created_at"
      ) <= p_stale_before
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs active
        WHERE active."workspace_id" = credential."workspace_id"
          AND active."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
          AND active."deduplication_key" =
            'integration-credential-validation:' || credential."id"::text ||
            ':' || credential."material_version"::text
          AND active."status" IN (
            'QUEUED', 'WAITING_RATE_LIMIT', 'RUNNING', 'RETRY_SCHEDULED'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs rank_job
        JOIN public.rank_job_runs rank_run
          ON rank_run."workspace_id" = rank_job."workspace_id"
          AND rank_run."project_id" = rank_job."project_id"
          AND rank_run."job_id" = rank_job."id"
        JOIN public.rank_estimates estimate
          ON estimate."workspace_id" = rank_run."workspace_id"
          AND estimate."project_id" = rank_run."project_id"
          AND estimate."id" = rank_run."estimate_id"
        WHERE rank_job."workspace_id" = credential."workspace_id"
          AND rank_job."type" = 'MANUAL_RANK_CHECK'
          AND rank_job."status" IN (
            'PREPARING', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'
          )
          AND rank_run."finalization_status" IS NULL
          AND estimate."credential_id" = credential."id"
          AND estimate."credential_material_version" =
            credential."material_version"
      )
    ORDER BY
      GREATEST(
        COALESCE(credential."last_success_at", '-infinity'::timestamptz),
        COALESCE(credential."last_error_at", '-infinity'::timestamptz),
        credential."created_at"
      ),
      credential."id"
    LIMIT p_limit
  ), prepared AS (
    SELECT candidates.*, pg_catalog.uuidv7() AS validation_id
    FROM candidates
    WHERE connector_version ~ '^[a-z0-9][a-z0-9@._-]{0,31}$'
  ), inserted AS (
    INSERT INTO public.jobs (
      "id", "workspace_id", "type", "status", "stage", "priority",
      "actor_id", "deduplication_key", "idempotency_scope",
      "idempotency_key", "request_hash", "input_snapshot",
      "scope_snapshot", "progress_total", "progress_unit",
      "estimated_cost_micro", "credential_mode", "provider",
      "max_attempts", "correlation_id", "queued_at", "updated_at"
    )
    SELECT
      prepared.validation_id,
      prepared."workspace_id",
      'INTEGRATION_CREDENTIAL_VALIDATE',
      'QUEUED',
      'credential_validation_queued',
      10,
      COALESCE(prepared."updated_by", prepared."created_by"),
      'integration-credential-validation:' || prepared."id"::text ||
        ':' || prepared."material_version"::text,
      'integration-credential-validation:' || prepared."id"::text,
      'auto:' || lower(p_reason) || ':' || prepared.validation_id::text,
      decode(repeat('00', 32), 'hex'),
      jsonb_build_object(
        'kind', 'integration.credential.validation.v1',
        'credentialId', prepared."id"::text,
        'credentialMaterialVersion', prepared."material_version",
        'connectorVersion', prepared.connector_version
      ),
      jsonb_build_object(
        'workspaceId', prepared."workspace_id"::text,
        'credentialId', prepared."id"::text
      ),
      1,
      'credential',
      0,
      prepared."mode",
      prepared."provider",
      3,
      'credential-refresh:' || prepared.validation_id::text,
      clock_timestamp(),
      clock_timestamp()
    FROM prepared
    ON CONFLICT DO NOTHING
    RETURNING "id"
  )
  SELECT inserted."id" FROM inserted;
END
$$;

REVOKE ALL ON FUNCTION
  public.schedule_integration_credential_validation_refreshes(
    UUID[], TIMESTAMPTZ, JSONB, TEXT, INTEGER
  )
  FROM PUBLIC;

COMMIT;

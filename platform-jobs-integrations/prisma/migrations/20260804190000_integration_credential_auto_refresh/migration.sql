BEGIN;

CREATE FUNCTION public.schedule_integration_credential_validation_refreshes(
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
  IF p_reason = 'HOURLY' AND p_stale_before IS NULL THEN
    RAISE EXCEPTION 'Hourly refresh requires a stale boundary'
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
      AND credential."mode" IN ('BYOK_API_KEY', 'BYOK_OAUTH')
      AND credential."status" NOT IN ('DISABLED', 'REVOKED', 'INVALID')
      AND (
        (p_credential_ids IS NOT NULL AND credential."id" = ANY(p_credential_ids))
        OR (
          p_credential_ids IS NULL
          AND GREATEST(
            COALESCE(credential."last_success_at", '-infinity'::timestamptz),
            COALESCE(credential."last_error_at", '-infinity'::timestamptz),
            credential."created_at"
          ) <= p_stale_before
        )
      )
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

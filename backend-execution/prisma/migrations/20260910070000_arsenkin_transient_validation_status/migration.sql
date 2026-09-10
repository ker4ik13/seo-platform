BEGIN;

-- A post-operation Arsenkin validation shares the provider rate-limit gate
-- with the operation that just completed. A temporary 429 or transport outage
-- must retry the validation job, but it must not make an already verified
-- credential unroutable in the meantime.
DO $migration$
DECLARE
  definition TEXT;
  old_declarations CONSTANT TEXT :=
    E'  retryable_failure BOOLEAN;\n'
    || E'  next_status public."JobStatus";';
  new_declarations CONSTANT TEXT :=
    E'  retryable_failure BOOLEAN;\n'
    || E'  keep_verified_arsenkin_active BOOLEAN;\n'
    || E'  next_status public."JobStatus";';
  old_status_mapping CONSTANT TEXT :=
    E'    retryable_failure := p_error_code IN (\n'
    || E'      ''PROVIDER_RATE_LIMITED'', ''PROVIDER_UNAVAILABLE''\n'
    || E'    );\n'
    || E'    applied_credential_status := CASE\n'
    || E'      WHEN p_credential_status = ''DEGRADED''\n'
    || E'        AND current_credential."verified_at" IS NULL THEN NULL\n'
    || E'      ELSE p_credential_status\n'
    || E'    END;';
  new_status_mapping CONSTANT TEXT :=
    E'    retryable_failure := p_error_code IN (\n'
    || E'      ''PROVIDER_RATE_LIMITED'', ''PROVIDER_UNAVAILABLE''\n'
    || E'    );\n'
    || E'    keep_verified_arsenkin_active :=\n'
    || E'      retryable_failure\n'
    || E'      AND current_credential."provider" = ''ARSENKIN''\n'
    || E'      AND current_credential."verified_at" IS NOT NULL\n'
    || E'      AND (\n'
    || E'        current_credential."status" IN (''ACTIVE'', ''RATE_LIMITED'')\n'
    || E'        OR (\n'
    || E'          current_credential."status" = ''DEGRADED''\n'
    || E'          AND current_credential."last_error_code" = ''PROVIDER_UNAVAILABLE''\n'
    || E'        )\n'
    || E'      );\n'
    || E'    applied_credential_status := CASE\n'
    || E'      WHEN keep_verified_arsenkin_active THEN NULL\n'
    || E'      WHEN p_credential_status = ''DEGRADED''\n'
    || E'        AND current_credential."verified_at" IS NULL THEN NULL\n'
    || E'      ELSE p_credential_status\n'
    || E'    END;';
  old_update CONSTANT TEXT :=
    E'      "status" = CASE applied_credential_status\n'
    || E'        WHEN ''INVALID'' THEN ''INVALID''::public."CredentialStatus"\n'
    || E'        WHEN ''RATE_LIMITED'' THEN ''RATE_LIMITED''::public."CredentialStatus"\n'
    || E'        WHEN ''DEGRADED'' THEN ''DEGRADED''::public."CredentialStatus"\n'
    || E'        ELSE credential."status"\n'
    || E'      END,';
  new_update CONSTANT TEXT :=
    E'      "status" = CASE\n'
    || E'        WHEN keep_verified_arsenkin_active\n'
    || E'          THEN ''ACTIVE''::public."CredentialStatus"\n'
    || E'        ELSE CASE applied_credential_status\n'
    || E'          WHEN ''INVALID'' THEN ''INVALID''::public."CredentialStatus"\n'
    || E'          WHEN ''RATE_LIMITED'' THEN ''RATE_LIMITED''::public."CredentialStatus"\n'
    || E'          WHEN ''DEGRADED'' THEN ''DEGRADED''::public."CredentialStatus"\n'
    || E'          ELSE credential."status"\n'
    || E'        END\n'
    || E'      END,';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_provider_failure(uuid,text,uuid,integer,text,text,integer)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_declarations IN definition) = 0
    OR position(old_status_mapping IN definition) = 0
    OR position(old_update IN definition) = 0
    OR position('keep_verified_arsenkin_active' IN definition) > 0
  THEN
    RAISE EXCEPTION 'Unexpected credential provider-failure function before Arsenkin transient-status migration'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(definition, old_declarations, new_declarations);
  definition := replace(definition, old_status_mapping, new_status_mapping);
  definition := replace(definition, old_update, new_update);

  IF position(old_declarations IN definition) > 0
    OR position(old_status_mapping IN definition) > 0
    OR position(old_update IN definition) > 0
    OR position(new_declarations IN definition) = 0
    OR position(new_status_mapping IN definition) = 0
    OR position(new_update IN definition) = 0
  THEN
    RAISE EXCEPTION 'Arsenkin transient credential status was not patched safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

-- Repair credentials left unavailable by the old transient-failure mapping.
-- Keep last_error_* as operational evidence; a later successful validation
-- clears it through the existing success function.
UPDATE public.integration_credentials credential
SET
  "status" = 'ACTIVE',
  "version" = credential."version" + 1,
  "updated_at" = clock_timestamp()
WHERE credential."provider" = 'ARSENKIN'
  AND credential."verified_at" IS NOT NULL
  AND credential."deleted_at" IS NULL
  AND (
    (
      credential."status" = 'RATE_LIMITED'
      AND credential."last_error_code" = 'PROVIDER_RATE_LIMITED'
    )
    OR (
      credential."status" = 'DEGRADED'
      AND credential."last_error_code" = 'PROVIDER_UNAVAILABLE'
    )
  );

COMMIT;

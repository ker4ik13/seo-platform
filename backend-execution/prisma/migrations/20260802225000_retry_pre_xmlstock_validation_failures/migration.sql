BEGIN;

-- XMLStock validation responses received before
-- 20260802224500_xmlstock_validation_and_rank_lease could not be committed by
-- the broker and exhausted all three attempts. Requeue only the exact current
-- pending credential material for the affected connector version. The next
-- worker pass performs the read-only provider validation again; no credential
-- is activated merely by this data repair.
UPDATE public.jobs job
SET
  "status" = 'RETRY_SCHEDULED',
  "stage" = 'credential_validation_retry_scheduled',
  "attempt" = 0,
  "error_summary" = NULL,
  "result_summary" = NULL,
  "finished_at" = NULL,
  "lease_owner" = NULL,
  "lease_expires_at" = NULL,
  "validation_lease_token" = NULL,
  "retry_at" = clock_timestamp(),
  "version" = job."version" + 1,
  "updated_at" = clock_timestamp()
FROM public.integration_credentials credential
WHERE job."type" = 'INTEGRATION_CREDENTIAL_VALIDATE'
  AND job."provider" = 'XMLSTOCK'
  AND job."status" = 'FAILED_RETRYABLE'
  AND job."stage" = 'credential_validation_failed'
  AND job."attempt" >= job."max_attempts"
  AND job."input_snapshot" ->> 'connectorVersion' = 'xmlstock@1.1.0'
  AND pg_catalog.pg_input_is_valid(
    job."input_snapshot" ->> 'credentialId',
    'uuid'
  )
  AND job."input_snapshot" ->> 'credentialMaterialVersion'
    ~ '^[1-9][0-9]{0,9}$'
  AND credential."workspace_id" = job."workspace_id"
  AND credential."id" = (job."input_snapshot" ->> 'credentialId')::UUID
  AND credential."provider" = 'XMLSTOCK'
  AND credential."mode" = 'BYOK_API_KEY'
  AND credential."status" = 'PENDING_VERIFICATION'
  AND credential."deleted_at" IS NULL
  AND credential."material_version" =
    (job."input_snapshot" ->> 'credentialMaterialVersion')::INTEGER;

COMMIT;

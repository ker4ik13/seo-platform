BEGIN;

-- A successful Arsenkin revalidation still replaced the credential's
-- capabilities with the legacy pre-rank set. That made an already verified
-- key disappear from AI answer collection immediately after any subsequent
-- verification. Keep validation as the capability authority, but make its
-- persisted result match the current provider catalog.
DO $migration$
DECLARE
  definition TEXT;
  old_capabilities CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","CLUSTERING","INDEXATION"]''::JSONB';
  new_capabilities CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]''::JSONB';
BEGIN
  SELECT pg_get_functiondef(
    'public.finish_integration_credential_validation_success(uuid,text,uuid,integer,text,jsonb)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position(old_capabilities IN definition) = 0
    OR position(new_capabilities IN definition) > 0
  THEN
    RAISE EXCEPTION 'Unexpected Arsenkin validation capability projection'
      USING ERRCODE = '55000';
  END IF;

  definition := replace(
    definition,
    old_capabilities,
    new_capabilities
  );

  IF position(old_capabilities IN definition) > 0
    OR position(new_capabilities IN definition) = 0
  THEN
    RAISE EXCEPTION 'Arsenkin validation capabilities were not updated safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

-- Repair credentials affected by a revalidation after the original AI
-- capability backfill. Status remains authoritative for executability.
UPDATE public.integration_credentials
SET
  "capabilities" =
    '["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]'::JSONB,
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "provider" = 'ARSENKIN'
  AND "deleted_at" IS NULL
  AND "capabilities" IS DISTINCT FROM
    '["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]'::JSONB;

COMMIT;

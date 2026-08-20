BEGIN;

-- Validation is the authority for an executable credential's capabilities.
-- Keep its persisted Arsenkin projection aligned with the public catalog so a
-- successful revalidation cannot make clustering disappear from an active key.
DO $migration$
DECLARE
  definition TEXT;
  old_capabilities CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"]''::JSONB';
  new_capabilities CONSTANT TEXT :=
    E'        WHEN ''ARSENKIN'' THEN\n'
    || E'          ''["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","CLUSTERING"]''::JSONB';
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
    RAISE EXCEPTION 'Arsenkin clustering capability was not persisted safely'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE definition;
END
$migration$;

-- Consolidate the existing Arsenkin capability guard instead of accumulating
-- one trigger per newly documented product capability.
ALTER FUNCTION public.ensure_arsenkin_wordstat_capability()
RENAME TO ensure_arsenkin_persisted_capabilities;

ALTER TRIGGER "integration_credential_arsenkin_wordstat_capability"
ON public.integration_credentials
RENAME TO "integration_credential_arsenkin_persisted_capabilities";

CREATE OR REPLACE FUNCTION public.ensure_arsenkin_persisted_capabilities()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."provider" = 'ARSENKIN'
    AND NEW."status" = 'ACTIVE'
    AND NEW."verified_at" IS NOT NULL
  THEN
    IF pg_catalog.jsonb_typeof(NEW."capabilities") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Arsenkin credential capabilities must be a JSON array';
    END IF;

    IF NOT NEW."capabilities" ? 'WORDSTAT' THEN
      NEW."capabilities" :=
        NEW."capabilities" || '["WORDSTAT"]'::JSONB;
    END IF;

    IF NOT NEW."capabilities" ? 'CLUSTERING' THEN
      NEW."capabilities" :=
        NEW."capabilities" || '["CLUSTERING"]'::JSONB;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ensure_arsenkin_persisted_capabilities()
FROM PUBLIC;

-- Existing verified credentials become usable immediately, without asking the
-- workspace owner to rotate or re-enter a provider secret.
UPDATE public.integration_credentials
SET
  "capabilities" =
    CASE
      WHEN "capabilities" ? 'CLUSTERING' THEN "capabilities"
      ELSE "capabilities" || '["CLUSTERING"]'::JSONB
    END,
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "provider" = 'ARSENKIN'
  AND "status" = 'ACTIVE'
  AND "verified_at" IS NOT NULL
  AND "deleted_at" IS NULL
  AND NOT "capabilities" ? 'CLUSTERING';

COMMIT;

BEGIN;

CREATE FUNCTION public.ensure_arsenkin_wordstat_capability()
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
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ensure_arsenkin_wordstat_capability()
FROM PUBLIC;

CREATE TRIGGER "integration_credential_arsenkin_wordstat_capability"
BEFORE INSERT OR UPDATE OF
  "provider", "status", "verified_at", "capabilities"
ON public.integration_credentials
FOR EACH ROW
EXECUTE FUNCTION public.ensure_arsenkin_wordstat_capability();

UPDATE public.integration_credentials
SET
  "capabilities" = "capabilities" || '["WORDSTAT"]'::JSONB,
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "provider" = 'ARSENKIN'
  AND "status" = 'ACTIVE'
  AND "verified_at" IS NOT NULL
  AND "deleted_at" IS NULL
  AND NOT "capabilities" ? 'WORDSTAT';

COMMIT;

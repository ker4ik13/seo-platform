BEGIN;

-- JavaScript Date and every signed internal contract preserve milliseconds.
-- Canonicalize the source credential timestamp at the database boundary so
-- exact execution-evidence comparisons cannot drift on hidden microseconds.
CREATE FUNCTION public.canonicalize_credential_verified_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW."verified_at" IS NOT NULL THEN
    NEW."verified_at" := date_trunc('milliseconds', NEW."verified_at");
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "integration_credentials_verified_at_precision"
  BEFORE INSERT OR UPDATE OF "verified_at"
  ON public.integration_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.canonicalize_credential_verified_at();

UPDATE public.integration_credentials
SET "verified_at" = date_trunc('milliseconds', "verified_at")
WHERE "verified_at" IS NOT NULL
  AND "verified_at" <> date_trunc('milliseconds', "verified_at");

REVOKE ALL ON FUNCTION
  public.canonicalize_credential_verified_at()
  FROM PUBLIC;

COMMIT;

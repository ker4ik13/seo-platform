CREATE OR REPLACE FUNCTION public.enforce_frequency_terminal_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW."type" = 'FREQUENCY_COLLECTION'
     AND NEW."status" IN (
       'COMPLETED',
       'PARTIALLY_COMPLETED',
       'FAILED_FINAL',
       'CANCELLED',
       'EXPIRED'
     ) THEN
    NEW."stage" := 'finished';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "jobs_frequency_terminal_stage_guard" ON public."jobs";

CREATE TRIGGER "jobs_frequency_terminal_stage_guard"
BEFORE INSERT OR UPDATE OF "type", "status", "stage"
ON public."jobs"
FOR EACH ROW
EXECUTE FUNCTION public.enforce_frequency_terminal_stage();

UPDATE public."jobs"
SET "stage" = 'finished'
WHERE "type" = 'FREQUENCY_COLLECTION'
  AND "status" IN (
    'COMPLETED',
    'PARTIALLY_COMPLETED',
    'FAILED_FINAL',
    'CANCELLED',
    'EXPIRED'
  )
  AND "stage" IS DISTINCT FROM 'finished';

REVOKE ALL ON FUNCTION public.enforce_frequency_terminal_stage() FROM PUBLIC;

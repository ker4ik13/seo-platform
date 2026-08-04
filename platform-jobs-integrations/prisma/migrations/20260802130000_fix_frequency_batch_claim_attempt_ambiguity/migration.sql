BEGIN;

DO $migration$
DECLARE
  function_definition TEXT;
  old_update CONSTANT TEXT := E'      UPDATE public.job_items\n      SET status = \'RUNNING\',\n          retry_at = NULL,\n          error = NULL,\n          attempt = attempt + 1,';
  fixed_update CONSTANT TEXT := E'      UPDATE public.job_items AS claimed_item\n      SET status = \'RUNNING\',\n          retry_at = NULL,\n          error = NULL,\n          attempt = claimed_item.attempt + 1,';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_frequency_collection_batch(text,integer,integer)'::regprocedure
  )
  INTO function_definition;

  IF position(fixed_update IN function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_update IN function_definition) = 0 THEN
    RAISE EXCEPTION 'unexpected frequency batch claim projection';
  END IF;

  function_definition := replace(
    function_definition,
    old_update,
    fixed_update
  );
  EXECUTE function_definition;
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_frequency_collection_batch(TEXT, INTEGER, INTEGER)
  FROM PUBLIC;

COMMIT;

BEGIN;

DO $migration$
DECLARE
  function_definition TEXT;
  old_projection CONSTANT TEXT := E'    item.provider_request_id,\n';
  fixed_projection CONSTANT TEXT := E'    item.provider_request_id::TEXT,\n';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_ai_answer_collection_batch(text,integer,integer)'::regprocedure
  )
  INTO function_definition;

  IF position(fixed_projection IN function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_projection IN function_definition) = 0 THEN
    RAISE EXCEPTION 'unexpected AI answer batch claim projection';
  END IF;

  function_definition := replace(
    function_definition,
    old_projection,
    fixed_projection
  );
  EXECUTE function_definition;
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_ai_answer_collection_batch(TEXT, INTEGER, INTEGER)
  FROM PUBLIC;

COMMIT;

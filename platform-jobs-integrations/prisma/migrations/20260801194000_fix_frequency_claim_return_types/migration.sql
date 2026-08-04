BEGIN;

DO $migration$
DECLARE
  function_definition TEXT;
  old_projection CONSTANT TEXT := E'    credential_row.provider,\n    item_row.provider_request_id,';
  new_projection CONSTANT TEXT := E'    credential_row.provider::TEXT,\n    item_row.provider_request_id::TEXT,';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_frequency_collection_item(text,integer)'::regprocedure
  )
  INTO function_definition;

  IF position(new_projection IN function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_projection IN function_definition) = 0 THEN
    RAISE EXCEPTION 'unexpected frequency claim projection';
  END IF;

  function_definition := replace(
    function_definition,
    old_projection,
    new_projection
  );
  EXECUTE function_definition;
END
$migration$;

REVOKE ALL ON FUNCTION
  public.claim_frequency_collection_item(TEXT, INTEGER)
  FROM PUBLIC;

COMMIT;

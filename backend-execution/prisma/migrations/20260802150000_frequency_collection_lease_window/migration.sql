BEGIN;

-- The connector's production SEO Data timeout is 60 seconds. A 60-second
-- lease therefore cannot cover one bounded internal call plus the required
-- five-second persistence margin. Extend only the frequency runtime's fenced
-- lease window; ownership and EXECUTE grants remain unchanged.
DO $migration$
DECLARE
  function_signature TEXT;
  function_definition TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.claim_frequency_collection_item(text,integer)',
    'public.claim_frequency_collection_batch(text,integer,integer)',
    'public.mark_frequency_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)',
    'public.renew_frequency_collection_batch_lease(uuid,uuid[],text,integer,integer)'
  ]
  LOOP
    SELECT pg_get_functiondef(function_signature::regprocedure)
    INTO function_definition;
    IF position('BETWEEN 5 AND 60' IN function_definition) = 0 THEN
      RAISE EXCEPTION 'unexpected frequency lease bound in %', function_signature;
    END IF;
    function_definition := replace(
      function_definition,
      'BETWEEN 5 AND 60',
      'BETWEEN 5 AND 120'
    );
    EXECUTE function_definition;
  END LOOP;
END
$migration$;

COMMIT;

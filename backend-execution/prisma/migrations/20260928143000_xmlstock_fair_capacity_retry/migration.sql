BEGIN;

-- Redis permits can be released well before their safety lease expires.
-- Revisit a capacity-delayed XMLStock claim after one second so a newly
-- active physical key can claim its fair share without a five-second hole.
DO $migration$
DECLARE
  function_definition TEXT;
  signature REGPROCEDURE;
  old_limit CONSTANT TEXT := 'p_retry_after_seconds NOT BETWEEN 5 AND 3600';
  new_limit CONSTANT TEXT := 'p_retry_after_seconds NOT BETWEEN 1 AND 3600';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.defer_rank_connector_poll_capacity(uuid,uuid,text,uuid,integer,integer,integer)'::regprocedure,
    'public.defer_frequency_collection_batch_capacity(uuid,uuid[],text,integer,integer)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(signature) INTO function_definition;
    IF function_definition IS NULL
      OR (length(function_definition) - length(replace(function_definition, old_limit, '')))
        / length(old_limit) <> 1
    THEN
      RAISE EXCEPTION 'unexpected XMLStock capacity retry function: %', signature;
    END IF;
    EXECUTE replace(function_definition, old_limit, new_limit);
  END LOOP;
END
$migration$;

COMMIT;

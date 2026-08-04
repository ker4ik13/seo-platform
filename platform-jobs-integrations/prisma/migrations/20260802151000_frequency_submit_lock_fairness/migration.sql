BEGIN;

-- Runtime ticks for rank and Wordstat share the same provider-submit lock and
-- can arrive in the same scheduler bucket. An immediate try-lock makes the
-- Wordstat tick repeatedly lose that deterministic race. Wait for the short
-- transaction-scoped critical section, but retain a two-second fail-closed
-- lock timeout for an unhealthy holder.
DO $migration$
DECLARE
  function_definition TEXT;
  expected_fragment TEXT := E'  IF NOT pg_try_advisory_xact_lock(\n    hashtextextended(''seo-platform:arsenkin-rank-submit'', 0)\n  ) THEN\n    RETURN;\n  END IF;';
  replacement_fragment TEXT := E'  BEGIN\n    PERFORM set_config(''lock_timeout'', ''2000ms'', TRUE);\n    PERFORM pg_advisory_xact_lock(\n      hashtextextended(''seo-platform:arsenkin-rank-submit'', 0)\n    );\n  EXCEPTION\n    WHEN lock_not_available THEN RETURN;\n  END;';
BEGIN
  SELECT pg_get_functiondef(
    'public.mark_frequency_collection_batch_submitting(uuid,uuid[],text,integer,text,integer)'::regprocedure
  )
  INTO function_definition;
  IF position(expected_fragment IN function_definition) = 0 THEN
    RAISE EXCEPTION 'unexpected frequency provider submit lock definition';
  END IF;
  EXECUTE replace(
    function_definition,
    expected_fragment,
    replacement_fragment
  );
END
$migration$;

COMMIT;

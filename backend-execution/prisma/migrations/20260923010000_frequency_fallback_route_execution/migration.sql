BEGIN;

-- A frequency Job is already bound to an exact materialized route and
-- credential in scope_snapshot. Requiring that route to also occupy position
-- zero rejects a legitimate LOW_BALANCE fallback selected before Job create.
DO $migration$
DECLARE
  definition TEXT;
  route_position CONSTANT TEXT := 'AND route.position = 0';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_frequency_collection_item(text,integer)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR (length(definition) - length(replace(definition, route_position, '')))
      / length(route_position) <> 1
  THEN
    RAISE EXCEPTION 'Unexpected frequency route-position invariant'
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(definition, route_position, '');
END
$migration$;

REVOKE ALL ON FUNCTION public.claim_frequency_collection_item(
  TEXT, INTEGER
) FROM PUBLIC;

COMMIT;

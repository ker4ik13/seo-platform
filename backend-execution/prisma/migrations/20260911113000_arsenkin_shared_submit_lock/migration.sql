BEGIN;

-- Rank, Wordstat, AI answers, clustering and keyword research all reserve the
-- same Arsenkin account task window. A later XMLStock migration restored the
-- old rank-only lock name, allowing a rank submit and a Wordstat submit to
-- pass their capacity checks concurrently. Restore the common lock identity
-- without changing either function's ownership or data boundary.
DO $migration$
DECLARE
  function_definition TEXT;
  old_lock_fragment TEXT :=
    $old$'seo-platform:rank-submit:' || provider_name$old$;
  new_lock_fragment TEXT :=
    $new$'seo-platform:rank-dispatch:ARSENKIN'$new$;
  occurrence_count INTEGER;
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_rank_connector_submit_bounded(text,integer,text)'::regprocedure
  ) INTO function_definition;

  occurrence_count := (
    length(function_definition) -
    length(replace(function_definition, old_lock_fragment, ''))
  ) / length(old_lock_fragment);
  IF occurrence_count <> 1 THEN
    RAISE EXCEPTION 'unexpected Arsenkin rank submit lock identity';
  END IF;

  EXECUTE replace(
    function_definition,
    old_lock_fragment,
    new_lock_fragment
  );
END
$migration$;

COMMIT;

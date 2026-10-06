BEGIN;

-- Product interleaving must not put the hundred oldest pages of two jobs
-- ahead of the first due page of another job on the same remote worker.
-- Preserve physical-key load preference, then take one turn per Job before
-- the next page of any Job. Product turn breaks ties within that round.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition := pg_get_functiondef(
    'public.list_rank_connector_poll_candidates_for_worker(text,integer,uuid[],text)'::REGPROCEDURE);
  updated := replace(definition,
    'ORDER BY due.product_turn, COALESCE(active.active_count, 0), due.job_turn,',
    'ORDER BY COALESCE(active.active_count, 0), due.job_turn, due.product_turn,');
  IF updated = definition OR
     position('ORDER BY COALESCE(active.active_count, 0), due.job_turn, due.product_turn,' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected remote rank poll fairness boundary was not found';
  END IF;
  EXECUTE updated;
END $$;

COMMIT;

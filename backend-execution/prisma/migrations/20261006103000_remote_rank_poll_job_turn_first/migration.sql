BEGIN;

-- Active-key load is useful only after each waiting Job has had a turn.
-- Otherwise two jobs on idle keys can refill the bounded 100-ID window
-- forever while a third job with one live page never appears in it.
DO $$
DECLARE definition TEXT; updated TEXT;
BEGIN
  definition := pg_get_functiondef(
    'public.list_rank_connector_poll_candidates_for_worker(text,integer,uuid[],text)'::REGPROCEDURE);
  updated := replace(definition,
    'ORDER BY COALESCE(active.active_count, 0), due.job_turn, due.product_turn,',
    'ORDER BY due.job_turn, due.product_turn, COALESCE(active.active_count, 0),');
  IF updated = definition OR
     position('ORDER BY due.job_turn, due.product_turn, COALESCE(active.active_count, 0),' IN updated) = 0 THEN
    RAISE EXCEPTION 'Expected remote rank Job turn boundary was not found';
  END IF;
  EXECUTE updated;
END $$;

COMMIT;

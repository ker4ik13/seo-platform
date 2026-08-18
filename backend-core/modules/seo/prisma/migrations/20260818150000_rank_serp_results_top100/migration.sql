BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.rank_serp_results
  DROP CONSTRAINT "rank_serp_results_position_check",
  ADD CONSTRAINT "rank_serp_results_position_check"
    CHECK ("position" BETWEEN 1 AND 100);

COMMIT;

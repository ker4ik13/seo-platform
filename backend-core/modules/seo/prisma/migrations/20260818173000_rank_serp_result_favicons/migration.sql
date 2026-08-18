BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.rank_serp_results
  ADD COLUMN "favicon_url" TEXT,
  ADD CONSTRAINT "rank_serp_results_favicon_url_check"
    CHECK (
      "favicon_url" IS NULL
      OR (
        length("favicon_url") BETWEEN 1 AND 4096
        AND "favicon_url" ~ '^https?://'
      )
    );

COMMIT;

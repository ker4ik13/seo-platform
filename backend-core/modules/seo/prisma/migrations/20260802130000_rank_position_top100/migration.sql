BEGIN;

ALTER TABLE public.rank_snapshots
  DROP CONSTRAINT "rank_snapshots_result_shape",
  ADD CONSTRAINT "rank_snapshots_result_shape"
    CHECK (
      (
        "found"
        AND "position" BETWEEN 1 AND 100
        AND (
          "absolute_position" IS NULL
          OR "absolute_position" >= 0
        )
        AND (
          "pixel_position" IS NULL
          OR "pixel_position" >= 0
        )
        AND "ranking_url" IS NOT NULL
        AND length("ranking_url") BETWEEN 1 AND 4096
        AND "normalized_ranking_url" IS NOT NULL
        AND length("normalized_ranking_url") BETWEEN 1 AND 4096
        AND "result_type" = 'ORGANIC'
      )
      OR (
        NOT "found"
        AND "position" IS NULL
        AND "absolute_position" IS NULL
        AND "pixel_position" IS NULL
        AND "ranking_url" IS NULL
        AND "normalized_ranking_url" IS NULL
        AND "title" IS NULL
        AND "snippet" IS NULL
        AND "result_type" IS NULL
      )
    );

ALTER TABLE public.current_ranks
  DROP CONSTRAINT "current_ranks_result_shape",
  ADD CONSTRAINT "current_ranks_result_shape"
    CHECK (
      (
        "found"
        AND "position" BETWEEN 1 AND 100
        AND "ranking_url" IS NOT NULL
        AND "normalized_ranking_url" IS NOT NULL
      )
      OR (
        NOT "found"
        AND "position" IS NULL
        AND "ranking_url" IS NULL
        AND "normalized_ranking_url" IS NULL
      )
    );

COMMIT;

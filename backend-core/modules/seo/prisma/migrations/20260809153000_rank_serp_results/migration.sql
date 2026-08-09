BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE "rank_serp_results" (
  "snapshot_observed_at" TIMESTAMPTZ(6) NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "ranking_url" TEXT NOT NULL,
  "normalized_ranking_url" TEXT NOT NULL,
  "title" TEXT,
  "snippet" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_serp_results_pkey"
    PRIMARY KEY ("snapshot_observed_at", "snapshot_id", "position"),
  CONSTRAINT "rank_serp_results_position_check"
    CHECK ("position" BETWEEN 1 AND 10),
  CONSTRAINT "rank_serp_results_ranking_url_check"
    CHECK (length("ranking_url") BETWEEN 1 AND 4096),
  CONSTRAINT "rank_serp_results_normalized_url_check"
    CHECK (length("normalized_ranking_url") BETWEEN 1 AND 4096),
  CONSTRAINT "rank_serp_results_title_check"
    CHECK ("title" IS NULL OR length("title") <= 2048),
  CONSTRAINT "rank_serp_results_snippet_check"
    CHECK ("snippet" IS NULL OR length("snippet") <= 8192),
  CONSTRAINT "rank_serp_results_snapshot_fkey"
    FOREIGN KEY ("snapshot_observed_at", "snapshot_id")
    REFERENCES "rank_snapshots"("observed_at", "id")
    ON DELETE RESTRICT
    ON UPDATE RESTRICT
);

CREATE INDEX "rank_serp_results_snapshot_position_idx"
  ON "rank_serp_results"("snapshot_id", "position");

CREATE FUNCTION "reject_rank_serp_result_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank SERP results are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "rank_serp_results_immutable"
  BEFORE UPDATE OR DELETE ON "rank_serp_results"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_rank_serp_result_mutation"();

COMMIT;

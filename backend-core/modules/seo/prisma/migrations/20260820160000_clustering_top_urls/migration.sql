BEGIN;

ALTER TABLE "clustering_proposal_clusters"
  ADD COLUMN "top_urls" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "clustering_proposal_clusters"
  ADD CONSTRAINT "clustering_proposal_clusters_top_urls_check"
  CHECK (
    jsonb_typeof("top_urls") = 'array' AND
    jsonb_array_length("top_urls") <= 100
  );

COMMIT;

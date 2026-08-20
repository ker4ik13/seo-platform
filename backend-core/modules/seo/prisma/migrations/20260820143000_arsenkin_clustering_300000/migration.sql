BEGIN;

ALTER TABLE public.clustering_proposals
  DROP CONSTRAINT clustering_proposals_counts_check;

ALTER TABLE public.clustering_proposals
  ADD CONSTRAINT clustering_proposals_counts_check CHECK (
    keyword_count BETWEEN 1 AND 300000 AND
    cluster_count BETWEEN 0 AND keyword_count AND
    unclustered_count BETWEEN 0 AND keyword_count AND
    applied_keyword_count BETWEEN 0 AND keyword_count AND
    created_group_count BETWEEN 0 AND cluster_count + 1
  ) NOT VALID;

ALTER TABLE public.clustering_proposals
  VALIDATE CONSTRAINT clustering_proposals_counts_check;

COMMIT;

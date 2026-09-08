BEGIN;
-- Preserve imported KC4 and existing manifests; add new batching shapes.

ALTER TABLE public.rank_execution_manifests DROP CONSTRAINT rank_execution_manifests_counts, ADD CONSTRAINT rank_execution_manifests_counts CHECK ((((((provider)::text = 'ARSENKIN'::text) AND ((pair_count >= 1) AND (pair_count <= 1000)) AND (chunk_size = 250) AND (chunk_count = ((pair_count + 249) / 250))) OR (((provider)::text = 'ARSENKIN'::text) AND ((pair_count >= 1) AND (pair_count <= 15000)) AND (chunk_size = 15000) AND (chunk_count = 1)) OR (((provider)::text = 'XMLSTOCK'::text) AND ((pair_count >= 1) AND (pair_count <= 15000)) AND (chunk_size = 1) AND (chunk_count = pair_count)) OR (((provider)::text = 'KEY_COLLECTOR'::text) AND ((pair_count >= 1) AND (pair_count <= 500)) AND (chunk_size = pair_count) AND (chunk_count = 1)))) OR ((provider = 'ARSENKIN' AND pair_count BETWEEN 1 AND 300000 AND chunk_size = 5000 AND chunk_count = (pair_count + 4999) / 5000)
 OR (provider = 'XMLSTOCK' AND pair_count BETWEEN 1 AND 300000 AND chunk_size = 1 AND chunk_count = pair_count))) NOT VALID;
ALTER TABLE public.rank_execution_manifests VALIDATE CONSTRAINT rank_execution_manifests_counts;

ALTER TABLE public.rank_check_finalization_receipts DROP CONSTRAINT rank_check_finalization_receipts_result_boundary, ADD CONSTRAINT rank_check_finalization_receipts_result_boundary CHECK ((((pair_count >= 1) AND (pair_count <= 300000)) AND ((persisted_count >= 0) AND (persisted_count <= pair_count)) AND ((found_count >= 0) AND (found_count <= persisted_count)) AND ((not_found_count >= 0) AND (not_found_count <= persisted_count)) AND (persisted_count = (found_count + not_found_count)) AND (missing_count = (pair_count - persisted_count)) AND (((status = 'COMPLETED'::"RankCheckFinalStatus") AND (persisted_count = pair_count)) OR ((status = 'PARTIALLY_COMPLETED'::"RankCheckFinalStatus") AND ((persisted_count >= 1) AND (persisted_count <= (pair_count - 1)))) OR ((status = 'CANCELLED'::"RankCheckFinalStatus") AND ((persisted_count >= 0) AND (persisted_count <= pair_count))) OR ((status = 'FAILED'::"RankCheckFinalStatus") AND (persisted_count = 0)) OR ((status = 'ACTION_REQUIRED'::"RankCheckFinalStatus") AND ((persisted_count >= 0) AND (persisted_count <= (pair_count - 1))))))) NOT VALID;
ALTER TABLE public.rank_check_finalization_receipts VALIDATE CONSTRAINT rank_check_finalization_receipts_result_boundary;

ALTER TABLE public.rank_chunk_ingest_receipts DROP CONSTRAINT rank_chunk_ingest_receipts_chunk_index, ADD CONSTRAINT rank_chunk_ingest_receipts_chunk_index CHECK (((chunk_index >= 0) AND (chunk_index <= 299999))) NOT VALID;
ALTER TABLE public.rank_chunk_ingest_receipts VALIDATE CONSTRAINT rank_chunk_ingest_receipts_chunk_index;

ALTER TABLE public.rank_execution_manifest_entries DROP CONSTRAINT rank_execution_manifest_entries_sequence, ADD CONSTRAINT rank_execution_manifest_entries_sequence CHECK ((((chunk_index >= 0) AND (chunk_index <= 299999)) AND ((sequence >= 0) AND (sequence <= 299999)))) NOT VALID;
ALTER TABLE public.rank_execution_manifest_entries VALIDATE CONSTRAINT rank_execution_manifest_entries_sequence;

ALTER TABLE public.rank_snapshots DROP CONSTRAINT rank_snapshots_manifest_position, ADD CONSTRAINT rank_snapshots_manifest_position CHECK ((((chunk_index >= 0) AND (chunk_index <= 299999)) AND ((sequence >= 0) AND (sequence <= 299999)))) NOT VALID;
ALTER TABLE public.rank_snapshots VALIDATE CONSTRAINT rank_snapshots_manifest_position;

COMMIT;

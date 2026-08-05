BEGIN;

LOCK TABLE public.rank_execution_manifests IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_execution_manifest_chunks IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_execution_manifest_entries IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_chunk_ingest_receipts IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.rank_snapshots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.current_ranks IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.rank_execution_manifests
  DROP CONSTRAINT rank_execution_manifests_provider_operation,
  ADD CONSTRAINT rank_execution_manifests_provider_operation
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND operation = 'POSITIONS'
  ) NOT VALID;

ALTER TABLE public.rank_execution_manifests
  DROP CONSTRAINT rank_execution_manifests_counts,
  ADD CONSTRAINT rank_execution_manifests_counts
  CHECK (
    (
      provider = 'ARSENKIN'
      AND pair_count BETWEEN 1 AND 1000
      AND chunk_size = 250
      AND chunk_count = ((pair_count + 249) / 250)
    )
    OR (
      provider = 'ARSENKIN'
      AND pair_count BETWEEN 1 AND 15000
      AND chunk_size = 15000
      AND chunk_count = 1
    )
    OR (
      provider = 'XMLSTOCK'
      AND pair_count BETWEEN 1 AND 15000
      AND chunk_size = 1
      AND chunk_count = pair_count
    )
  ) NOT VALID;

ALTER TABLE public.rank_execution_manifest_entries
  DROP CONSTRAINT rank_execution_manifest_entries_sequence,
  ADD CONSTRAINT rank_execution_manifest_entries_sequence
  CHECK (
    chunk_index BETWEEN 0 AND 14999
    AND sequence BETWEEN 0 AND 14999
  ) NOT VALID;

ALTER TABLE public.rank_chunk_ingest_receipts
  DROP CONSTRAINT rank_chunk_ingest_receipts_provider_operation,
  ADD CONSTRAINT rank_chunk_ingest_receipts_provider_operation
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND operation = 'POSITIONS'
  ) NOT VALID;

ALTER TABLE public.rank_chunk_ingest_receipts
  DROP CONSTRAINT rank_chunk_ingest_receipts_chunk_index,
  ADD CONSTRAINT rank_chunk_ingest_receipts_chunk_index
  CHECK (chunk_index BETWEEN 0 AND 14999) NOT VALID;

ALTER TABLE public.rank_snapshots
  DROP CONSTRAINT rank_snapshots_manifest_position,
  ADD CONSTRAINT rank_snapshots_manifest_position
  CHECK (
    chunk_index BETWEEN 0 AND 14999
    AND sequence BETWEEN 0 AND 14999
  ) NOT VALID;

ALTER TABLE public.rank_snapshots
  DROP CONSTRAINT rank_snapshots_provider_source,
  ADD CONSTRAINT rank_snapshots_provider_source
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND source_mode = 'BYOK'
  ) NOT VALID;

ALTER TABLE public.current_ranks
  DROP CONSTRAINT current_ranks_provider_source,
  ADD CONSTRAINT current_ranks_provider_source
  CHECK (
    provider IN ('ARSENKIN', 'XMLSTOCK')
    AND source_mode = 'BYOK'
  ) NOT VALID;

ALTER TABLE public.rank_execution_manifests
  VALIDATE CONSTRAINT rank_execution_manifests_provider_operation;
ALTER TABLE public.rank_execution_manifests
  VALIDATE CONSTRAINT rank_execution_manifests_counts;
ALTER TABLE public.rank_execution_manifest_entries
  VALIDATE CONSTRAINT rank_execution_manifest_entries_sequence;
ALTER TABLE public.rank_chunk_ingest_receipts
  VALIDATE CONSTRAINT rank_chunk_ingest_receipts_provider_operation;
ALTER TABLE public.rank_chunk_ingest_receipts
  VALIDATE CONSTRAINT rank_chunk_ingest_receipts_chunk_index;
ALTER TABLE public.rank_snapshots
  VALIDATE CONSTRAINT rank_snapshots_manifest_position;
ALTER TABLE public.rank_snapshots
  VALIDATE CONSTRAINT rank_snapshots_provider_source;
ALTER TABLE public.current_ranks
  VALIDATE CONSTRAINT current_ranks_provider_source;

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "rank_chunk_ingest_receipts"
  DROP CONSTRAINT "rank_chunk_ingest_receipts_provider_request",
  ADD CONSTRAINT "rank_chunk_ingest_receipts_provider_request"
    CHECK (
      length("provider_request_id") BETWEEN 1 AND 256
      AND "provider_request_id" ~ '^[ -~]+$'
    );

ALTER TABLE "rank_snapshots"
  DROP CONSTRAINT "rank_snapshots_provider_request",
  ADD CONSTRAINT "rank_snapshots_provider_request"
    CHECK (
      length("provider_request_id") BETWEEN 1 AND 256
      AND "provider_request_id" ~ '^[ -~]+$'
    );

COMMIT;

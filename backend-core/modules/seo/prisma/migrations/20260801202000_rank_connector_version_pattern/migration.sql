BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "rank_chunk_ingest_receipts"
  DROP CONSTRAINT "rank_chunk_ingest_receipts_connector_version",
  ADD CONSTRAINT "rank_chunk_ingest_receipts_connector_version"
    CHECK (
      "connector_version" ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
    );

ALTER TABLE "rank_snapshots"
  DROP CONSTRAINT "rank_snapshots_connector_version",
  ADD CONSTRAINT "rank_snapshots_connector_version"
    CHECK (
      "connector_version" ~ '^[a-z0-9][a-z0-9@._-]{0,63}$'
    );

COMMIT;

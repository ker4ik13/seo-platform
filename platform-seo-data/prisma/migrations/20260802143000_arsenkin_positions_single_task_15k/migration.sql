BEGIN;

LOCK TABLE "rank_execution_manifests" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_execution_manifest_chunks" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_execution_manifest_entries" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_chunk_ingest_receipts" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_snapshots" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "rank_check_finalization_receipts" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "rank_execution_manifests"
  DROP CONSTRAINT "rank_execution_manifests_counts";

ALTER TABLE "rank_execution_manifests"
  ADD CONSTRAINT "rank_execution_manifests_counts"
  CHECK (
    (
      "pair_count" BETWEEN 1 AND 1000
      AND "chunk_size" = 250
      AND "chunk_count" = (("pair_count" + 249) / 250)
    )
    OR (
      "pair_count" BETWEEN 1 AND 15000
      AND "chunk_size" = 15000
      AND "chunk_count" = 1
    )
  ) NOT VALID;

ALTER TABLE "rank_execution_manifest_chunks"
  DROP CONSTRAINT "rank_execution_manifest_chunks_entry_count";

ALTER TABLE "rank_execution_manifest_chunks"
  ADD CONSTRAINT "rank_execution_manifest_chunks_entry_count"
  CHECK ("entry_count" BETWEEN 1 AND 15000) NOT VALID;

ALTER TABLE "rank_execution_manifest_entries"
  DROP CONSTRAINT "rank_execution_manifest_entries_sequence";

ALTER TABLE "rank_execution_manifest_entries"
  ADD CONSTRAINT "rank_execution_manifest_entries_sequence"
  CHECK (
    "chunk_index" BETWEEN 0 AND 3
    AND "sequence" BETWEEN 0 AND 14999
  ) NOT VALID;

CREATE OR REPLACE FUNCTION "guard_rank_execution_manifest_child_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "manifest_status" "RankExecutionManifestStatus";
  "manifest_pair_count" INTEGER;
  "manifest_chunk_count" INTEGER;
  "manifest_chunk_size" INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      "status",
      "pair_count",
      "chunk_count",
      "chunk_size"
    INTO
      "manifest_status",
      "manifest_pair_count",
      "manifest_chunk_count",
      "manifest_chunk_size"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "id" = NEW."manifest_id";

    IF "manifest_status" = 'BUILDING' THEN
      IF TG_TABLE_NAME = 'rank_execution_manifest_chunks'
        AND NEW."chunk_index" BETWEEN 0 AND "manifest_chunk_count" - 1
        AND NEW."entry_count" = LEAST(
          "manifest_chunk_size",
          "manifest_pair_count" - NEW."chunk_index" * "manifest_chunk_size"
        )
      THEN
        RETURN NEW;
      END IF;

      IF TG_TABLE_NAME = 'rank_execution_manifest_entries'
        AND NEW."chunk_index" BETWEEN 0 AND "manifest_chunk_count" - 1
        AND NEW."sequence" BETWEEN
          NEW."chunk_index" * "manifest_chunk_size"
          AND LEAST(
            "manifest_pair_count",
            (NEW."chunk_index" + 1) * "manifest_chunk_size"
          ) - 1
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank execution manifest storage is immutable or invalid'
    USING ERRCODE = '55000';
END;
$$;

ALTER TABLE "rank_chunk_ingest_receipts"
  DROP CONSTRAINT "rank_chunk_ingest_receipts_counts";

ALTER TABLE "rank_chunk_ingest_receipts"
  ADD CONSTRAINT "rank_chunk_ingest_receipts_counts"
  CHECK (
    "persisted_count" BETWEEN 1 AND 15000
    AND "found_count" BETWEEN 0 AND "persisted_count"
    AND "not_found_count" BETWEEN 0 AND "persisted_count"
    AND "persisted_count" = "found_count" + "not_found_count"
    AND "current_updated_count" BETWEEN 0 AND "persisted_count"
    AND "current_skipped_count" BETWEEN 0 AND "persisted_count"
    AND "persisted_count"
      = "current_updated_count" + "current_skipped_count"
  ) NOT VALID;

ALTER TABLE "rank_snapshots"
  DROP CONSTRAINT "rank_snapshots_manifest_position";

ALTER TABLE "rank_snapshots"
  ADD CONSTRAINT "rank_snapshots_manifest_position"
  CHECK (
    "chunk_index" BETWEEN 0 AND 3
    AND "sequence" BETWEEN 0 AND 14999
  ) NOT VALID;

ALTER TABLE "rank_check_finalization_receipts"
  DROP CONSTRAINT "rank_check_finalization_receipts_result_boundary";

ALTER TABLE "rank_check_finalization_receipts"
  ADD CONSTRAINT "rank_check_finalization_receipts_result_boundary"
  CHECK (
    "pair_count" BETWEEN 1 AND 15000
    AND "persisted_count" BETWEEN 0 AND "pair_count"
    AND "found_count" BETWEEN 0 AND "persisted_count"
    AND "not_found_count" BETWEEN 0 AND "persisted_count"
    AND "persisted_count" = "found_count" + "not_found_count"
    AND "missing_count" = "pair_count" - "persisted_count"
    AND (
      (
        "status" = 'COMPLETED'
        AND "persisted_count" = "pair_count"
      )
      OR (
        "status" = 'PARTIALLY_COMPLETED'
        AND "persisted_count" BETWEEN 1 AND "pair_count" - 1
      )
      OR (
        "status" = 'CANCELLED'
        AND "persisted_count" BETWEEN 0 AND "pair_count"
      )
      OR (
        "status" = 'FAILED'
        AND "persisted_count" = 0
      )
      OR (
        "status" = 'ACTION_REQUIRED'
        AND "persisted_count" BETWEEN 0 AND "pair_count" - 1
      )
    )
  ) NOT VALID;

ALTER TABLE "rank_execution_manifests"
  VALIDATE CONSTRAINT "rank_execution_manifests_counts";
ALTER TABLE "rank_execution_manifest_chunks"
  VALIDATE CONSTRAINT "rank_execution_manifest_chunks_entry_count";
ALTER TABLE "rank_execution_manifest_entries"
  VALIDATE CONSTRAINT "rank_execution_manifest_entries_sequence";
ALTER TABLE "rank_chunk_ingest_receipts"
  VALIDATE CONSTRAINT "rank_chunk_ingest_receipts_counts";
ALTER TABLE "rank_snapshots"
  VALIDATE CONSTRAINT "rank_snapshots_manifest_position";
ALTER TABLE "rank_check_finalization_receipts"
  VALIDATE CONSTRAINT "rank_check_finalization_receipts_result_boundary";

COMMIT;

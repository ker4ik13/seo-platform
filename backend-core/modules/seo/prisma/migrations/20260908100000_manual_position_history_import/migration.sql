BEGIN;

-- Extend the immutable rank ledger for user-supplied dated history. Existing
-- rows and data stay valid; MANUAL_IMPORT always remains source_mode=IMPORT.
CREATE OR REPLACE FUNCTION "rank_data_quality_flags_valid"("flags" JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT
    jsonb_typeof("flags") = 'array'
    AND jsonb_array_length("flags") <= 6
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements("flags") AS "item"("value")
      WHERE jsonb_typeof("item"."value") <> 'string'
        OR "item"."value" #>> '{}' NOT IN (
          'PROVIDER_OBSERVED_AT_UNAVAILABLE', 'ABSOLUTE_POSITION_UNAVAILABLE',
          'PIXEL_POSITION_UNAVAILABLE', 'TITLE_UNAVAILABLE', 'SNIPPET_UNAVAILABLE',
          'IMPORTED_KC4', 'IMPORTED_MANUAL_HISTORY'
        )
    )
    AND jsonb_array_length("flags") = (
      SELECT count(DISTINCT "item"."value" #>> '{}')
      FROM jsonb_array_elements("flags") AS "item"("value")
    );
$$;

ALTER TABLE "rank_execution_manifests"
  DROP CONSTRAINT "rank_execution_manifests_provider_operation",
  ADD CONSTRAINT "rank_execution_manifests_provider_operation"
    CHECK ("provider" IN ('ARSENKIN', 'XMLSTOCK', 'KEY_COLLECTOR', 'MANUAL_IMPORT') AND "operation" = 'POSITIONS') NOT VALID,
  DROP CONSTRAINT "rank_execution_manifests_counts",
  ADD CONSTRAINT "rank_execution_manifests_counts" CHECK (
    ("provider" = 'ARSENKIN' AND "pair_count" BETWEEN 1 AND 1000 AND "chunk_size" = 250 AND "chunk_count" = ("pair_count" + 249) / 250)
    OR ("provider" = 'ARSENKIN' AND "pair_count" BETWEEN 1 AND 15000 AND "chunk_size" = 15000 AND "chunk_count" = 1)
    OR ("provider" = 'ARSENKIN' AND "pair_count" BETWEEN 1 AND 300000 AND "chunk_size" = 5000 AND "chunk_count" = ("pair_count" + 4999) / 5000)
    OR ("provider" = 'XMLSTOCK' AND "pair_count" BETWEEN 1 AND 300000 AND "chunk_size" = 1 AND "chunk_count" = "pair_count")
    OR ("provider" IN ('KEY_COLLECTOR', 'MANUAL_IMPORT') AND "pair_count" BETWEEN 1 AND 500 AND "chunk_size" = "pair_count" AND "chunk_count" = 1)
  ) NOT VALID;

ALTER TABLE "rank_chunk_ingest_receipts"
  DROP CONSTRAINT "rank_chunk_ingest_receipts_provider_operation",
  ADD CONSTRAINT "rank_chunk_ingest_receipts_provider_operation"
    CHECK ("provider" IN ('ARSENKIN', 'XMLSTOCK', 'KEY_COLLECTOR', 'MANUAL_IMPORT') AND "operation" = 'POSITIONS') NOT VALID;

ALTER TABLE "rank_snapshots"
  DROP CONSTRAINT "rank_snapshots_provider_source",
  ADD CONSTRAINT "rank_snapshots_provider_source" CHECK (
    ("provider" IN ('ARSENKIN', 'XMLSTOCK') AND "source_mode" = 'BYOK')
    OR ("provider" IN ('KEY_COLLECTOR', 'MANUAL_IMPORT') AND "source_mode" = 'IMPORT')
  ) NOT VALID,
  DROP CONSTRAINT "rank_snapshots_data_quality_shape",
  ADD CONSTRAINT "rank_snapshots_data_quality_shape" CHECK (
    (
      "source_mode" = 'BYOK'
      AND (
        (NOT "found" AND "data_quality_flags" <@ '["PROVIDER_OBSERVED_AT_UNAVAILABLE"]'::jsonb)
        OR (
          "found"
          AND (("absolute_position" IS NULL) = ("data_quality_flags" @> '["ABSOLUTE_POSITION_UNAVAILABLE"]'::jsonb))
          AND (("pixel_position" IS NULL) = ("data_quality_flags" @> '["PIXEL_POSITION_UNAVAILABLE"]'::jsonb))
          AND (("title" IS NULL) = ("data_quality_flags" @> '["TITLE_UNAVAILABLE"]'::jsonb))
          AND (("snippet" IS NULL) = ("data_quality_flags" @> '["SNIPPET_UNAVAILABLE"]'::jsonb))
        )
      )
    )
    OR ("source_mode" = 'IMPORT' AND "data_quality_flags" IN ('["IMPORTED_KC4"]'::jsonb, '["IMPORTED_MANUAL_HISTORY"]'::jsonb))
  ) NOT VALID;

ALTER TABLE "current_ranks"
  DROP CONSTRAINT "current_ranks_provider_source",
  ADD CONSTRAINT "current_ranks_provider_source" CHECK (
    ("provider" IN ('ARSENKIN', 'XMLSTOCK') AND "source_mode" = 'BYOK')
    OR ("provider" IN ('KEY_COLLECTOR', 'MANUAL_IMPORT') AND "source_mode" = 'IMPORT')
  ) NOT VALID;

ALTER TABLE "rank_execution_manifests" VALIDATE CONSTRAINT "rank_execution_manifests_provider_operation";
ALTER TABLE "rank_execution_manifests" VALIDATE CONSTRAINT "rank_execution_manifests_counts";
ALTER TABLE "rank_chunk_ingest_receipts" VALIDATE CONSTRAINT "rank_chunk_ingest_receipts_provider_operation";
ALTER TABLE "rank_snapshots" VALIDATE CONSTRAINT "rank_snapshots_provider_source";
ALTER TABLE "rank_snapshots" VALIDATE CONSTRAINT "rank_snapshots_data_quality_shape";
ALTER TABLE "current_ranks" VALIDATE CONSTRAINT "current_ranks_provider_source";

COMMIT;

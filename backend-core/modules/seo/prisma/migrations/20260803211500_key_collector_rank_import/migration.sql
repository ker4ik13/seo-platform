BEGIN;

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
      SELECT 1
      FROM jsonb_array_elements("flags") AS "item"("value")
      WHERE jsonb_typeof("item"."value") <> 'string'
        OR "item"."value" #>> '{}' NOT IN (
          'PROVIDER_OBSERVED_AT_UNAVAILABLE',
          'ABSOLUTE_POSITION_UNAVAILABLE',
          'PIXEL_POSITION_UNAVAILABLE',
          'TITLE_UNAVAILABLE',
          'SNIPPET_UNAVAILABLE',
          'IMPORTED_KC4'
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
    CHECK (
      "provider" IN ('ARSENKIN', 'XMLSTOCK', 'KEY_COLLECTOR')
      AND "operation" = 'POSITIONS'
    ) NOT VALID,
  DROP CONSTRAINT "rank_execution_manifests_counts",
  ADD CONSTRAINT "rank_execution_manifests_counts"
    CHECK (
      (
        "provider" = 'ARSENKIN'
        AND "pair_count" BETWEEN 1 AND 1000
        AND "chunk_size" = 250
        AND "chunk_count" = ("pair_count" + 249) / 250
      )
      OR (
        "provider" = 'ARSENKIN'
        AND "pair_count" BETWEEN 1 AND 15000
        AND "chunk_size" = 15000
        AND "chunk_count" = 1
      )
      OR (
        "provider" = 'XMLSTOCK'
        AND "pair_count" BETWEEN 1 AND 15000
        AND "chunk_size" = 1
        AND "chunk_count" = "pair_count"
      )
      OR (
        "provider" = 'KEY_COLLECTOR'
        AND "pair_count" BETWEEN 1 AND 500
        AND "chunk_size" = "pair_count"
        AND "chunk_count" = 1
      )
    ) NOT VALID;

ALTER TABLE "rank_chunk_ingest_receipts"
  DROP CONSTRAINT "rank_chunk_ingest_receipts_provider_operation",
  ADD CONSTRAINT "rank_chunk_ingest_receipts_provider_operation"
    CHECK (
      "provider" IN ('ARSENKIN', 'XMLSTOCK', 'KEY_COLLECTOR')
      AND "operation" = 'POSITIONS'
    ) NOT VALID;

ALTER TABLE "rank_snapshots"
  DROP CONSTRAINT "rank_snapshots_provider_source",
  ADD CONSTRAINT "rank_snapshots_provider_source"
    CHECK (
      (
        "provider" IN ('ARSENKIN', 'XMLSTOCK')
        AND "source_mode" = 'BYOK'
      )
      OR (
        "provider" = 'KEY_COLLECTOR'
        AND "source_mode" = 'IMPORT'
      )
    ) NOT VALID,
  DROP CONSTRAINT "rank_snapshots_result_shape",
  ADD CONSTRAINT "rank_snapshots_result_shape"
    CHECK (
      (
        "source_mode" = 'BYOK'
        AND (
          (
            "found"
            AND "position" BETWEEN 1 AND 100
            AND ("absolute_position" IS NULL OR "absolute_position" >= 0)
            AND ("pixel_position" IS NULL OR "pixel_position" >= 0)
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
        )
      )
      OR (
        "source_mode" = 'IMPORT'
        AND (
          (
            "found"
            AND "position" BETWEEN 1 AND 100
            AND (
              ("ranking_url" IS NULL AND "normalized_ranking_url" IS NULL)
              OR (
                "ranking_url" IS NOT NULL
                AND length("ranking_url") BETWEEN 1 AND 4096
                AND "normalized_ranking_url" IS NOT NULL
                AND length("normalized_ranking_url") BETWEEN 1 AND 4096
              )
            )
          )
          OR (
            NOT "found"
            AND "position" IS NULL
            AND "ranking_url" IS NULL
            AND "normalized_ranking_url" IS NULL
          )
        )
      )
    ) NOT VALID,
  DROP CONSTRAINT "rank_snapshots_data_quality_shape",
  ADD CONSTRAINT "rank_snapshots_data_quality_shape"
    CHECK (
      (
        "source_mode" = 'BYOK'
        AND (
          (
            NOT "found"
            AND "data_quality_flags"
              <@ '["PROVIDER_OBSERVED_AT_UNAVAILABLE"]'::jsonb
          )
          OR (
            "found"
            AND (("absolute_position" IS NULL) = (
              "data_quality_flags" @> '["ABSOLUTE_POSITION_UNAVAILABLE"]'::jsonb
            ))
            AND (("pixel_position" IS NULL) = (
              "data_quality_flags" @> '["PIXEL_POSITION_UNAVAILABLE"]'::jsonb
            ))
            AND (("title" IS NULL) = (
              "data_quality_flags" @> '["TITLE_UNAVAILABLE"]'::jsonb
            ))
            AND (("snippet" IS NULL) = (
              "data_quality_flags" @> '["SNIPPET_UNAVAILABLE"]'::jsonb
            ))
          )
        )
      )
      OR (
        "source_mode" = 'IMPORT'
        AND "data_quality_flags" = '["IMPORTED_KC4"]'::jsonb
      )
    ) NOT VALID;

ALTER TABLE "current_ranks"
  DROP CONSTRAINT "current_ranks_provider_source",
  ADD CONSTRAINT "current_ranks_provider_source"
    CHECK (
      (
        "provider" IN ('ARSENKIN', 'XMLSTOCK')
        AND "source_mode" = 'BYOK'
      )
      OR (
        "provider" = 'KEY_COLLECTOR'
        AND "source_mode" = 'IMPORT'
      )
    ) NOT VALID,
  DROP CONSTRAINT "current_ranks_result_shape",
  ADD CONSTRAINT "current_ranks_result_shape"
    CHECK (
      (
        "found"
        AND "position" BETWEEN 1 AND 100
        AND (
          (
            "source_mode" = 'BYOK'
            AND "ranking_url" IS NOT NULL
            AND "normalized_ranking_url" IS NOT NULL
          )
          OR (
            "source_mode" = 'IMPORT'
            AND (
              ("ranking_url" IS NULL AND "normalized_ranking_url" IS NULL)
              OR (
                "ranking_url" IS NOT NULL
                AND "normalized_ranking_url" IS NOT NULL
              )
            )
          )
        )
      )
      OR (
        NOT "found"
        AND "position" IS NULL
        AND "ranking_url" IS NULL
        AND "normalized_ranking_url" IS NULL
      )
    ) NOT VALID;

ALTER TABLE "rank_execution_manifests"
  VALIDATE CONSTRAINT "rank_execution_manifests_provider_operation";
ALTER TABLE "rank_execution_manifests"
  VALIDATE CONSTRAINT "rank_execution_manifests_counts";
ALTER TABLE "rank_chunk_ingest_receipts"
  VALIDATE CONSTRAINT "rank_chunk_ingest_receipts_provider_operation";
ALTER TABLE "rank_snapshots"
  VALIDATE CONSTRAINT "rank_snapshots_provider_source";
ALTER TABLE "rank_snapshots"
  VALIDATE CONSTRAINT "rank_snapshots_result_shape";
ALTER TABLE "rank_snapshots"
  VALIDATE CONSTRAINT "rank_snapshots_data_quality_shape";
ALTER TABLE "current_ranks"
  VALIDATE CONSTRAINT "current_ranks_provider_source";
ALTER TABLE "current_ranks"
  VALIDATE CONSTRAINT "current_ranks_result_shape";

COMMIT;

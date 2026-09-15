-- Rebuild only the mutable current-rank projection for active Key Collector
-- contexts. Immutable snapshots and their SERP rows remain untouched.
CREATE OR REPLACE FUNCTION "guard_current_rank_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_snapshot" "rank_snapshots"%ROWTYPE;
  "old_snapshot" "rank_snapshots"%ROWTYPE;
  "new_has_serp" BOOLEAN := FALSE;
  "old_has_serp" BOOLEAN := FALSE;
BEGIN
  SELECT *
  INTO "stored_snapshot"
  FROM "rank_snapshots"
  WHERE "workspace_id" = NEW."workspace_id"
    AND "project_id" = NEW."project_id"
    AND "keyword_id" = NEW."keyword_id"
    AND "tracking_context_id" = NEW."tracking_context_id"
    AND "observed_at" = NEW."observed_at"
    AND "id" = NEW."snapshot_id";

  IF NOT FOUND
    OR "stored_snapshot"."configuration_version" <> NEW."configuration_version"
    OR "stored_snapshot"."found" <> NEW."found"
    OR "stored_snapshot"."position" IS DISTINCT FROM NEW."position"
    OR "stored_snapshot"."ranking_url" IS DISTINCT FROM NEW."ranking_url"
    OR "stored_snapshot"."normalized_ranking_url" IS DISTINCT FROM NEW."normalized_ranking_url"
    OR "stored_snapshot"."provider" <> NEW."provider"
    OR "stored_snapshot"."source_mode" <> NEW."source_mode"
    OR "stored_snapshot"."data_quality_flags" IS DISTINCT FROM NEW."data_quality_flags"
  THEN
    RAISE EXCEPTION 'current rank does not match its immutable snapshot'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW."version" = 1
    AND NEW."previous_position" IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT *
    INTO "old_snapshot"
    FROM "rank_snapshots"
    WHERE "workspace_id" = OLD."workspace_id"
      AND "project_id" = OLD."project_id"
      AND "keyword_id" = OLD."keyword_id"
      AND "tracking_context_id" = OLD."tracking_context_id"
      AND "observed_at" = OLD."observed_at"
      AND "id" = OLD."snapshot_id";

    SELECT EXISTS (
      SELECT 1 FROM "rank_serp_results"
      WHERE "snapshot_observed_at" = NEW."observed_at"
        AND "snapshot_id" = NEW."snapshot_id"
    ) INTO "new_has_serp";
    SELECT EXISTS (
      SELECT 1 FROM "rank_serp_results"
      WHERE "snapshot_observed_at" = OLD."observed_at"
        AND "snapshot_id" = OLD."snapshot_id"
    ) INTO "old_has_serp";
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      OLD."workspace_id",
      OLD."project_id",
      OLD."keyword_id",
      OLD."tracking_context_id"
    ) = (
      NEW."workspace_id",
      NEW."project_id",
      NEW."keyword_id",
      NEW."tracking_context_id"
    )
    AND (
      NEW."observed_at" > OLD."observed_at"
      OR (
        NEW."observed_at" = OLD."observed_at"
        AND NEW."snapshot_id" <> OLD."snapshot_id"
        AND (
          "stored_snapshot"."created_at" > "old_snapshot"."created_at"
          OR ("new_has_serp" AND NOT "old_has_serp")
        )
      )
    )
    AND NEW."version" = OLD."version" + 1
    AND NEW."previous_position" IS NOT DISTINCT FROM OLD."position"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'current rank update is not monotonic'
    USING ERRCODE = '55000';
END;
$$;

WITH current_keys AS (
  SELECT
    current.workspace_id,
    current.project_id,
    current.keyword_id,
    current.tracking_context_id
  FROM current_ranks current
  INNER JOIN tracking_contexts context
    ON context.workspace_id = current.workspace_id
   AND context.project_id = current.project_id
   AND context.id = current.tracking_context_id
   AND context.status::text = 'ACTIVE'
  WHERE current.provider = 'KEY_COLLECTOR'
),
ranked_snapshots AS (
  SELECT DISTINCT ON (
    snapshot.workspace_id,
    snapshot.project_id,
    snapshot.keyword_id,
    snapshot.tracking_context_id
  )
    snapshot.workspace_id,
    snapshot.project_id,
    snapshot.keyword_id,
    snapshot.tracking_context_id,
    snapshot.configuration_version,
    snapshot.observed_at,
    snapshot.id,
    snapshot.found,
    snapshot.position,
    snapshot.ranking_url,
    snapshot.normalized_ranking_url,
    snapshot.provider,
    snapshot.source_mode,
    snapshot.data_quality_flags,
    snapshot.created_at,
    receipt.applied_at
  FROM current_keys key
  INNER JOIN rank_snapshots snapshot
    ON snapshot.workspace_id = key.workspace_id
   AND snapshot.project_id = key.project_id
   AND snapshot.keyword_id = key.keyword_id
   AND snapshot.tracking_context_id = key.tracking_context_id
   AND snapshot.provider = 'KEY_COLLECTOR'
  INNER JOIN rank_chunk_ingest_receipts receipt
    ON receipt.workspace_id = snapshot.workspace_id
   AND receipt.project_id = snapshot.project_id
   AND receipt.manifest_id = snapshot.manifest_id
   AND receipt.chunk_index = snapshot.chunk_index
   AND receipt.job_id = snapshot.job_id
   AND receipt.job_item_id = snapshot.job_item_id
   AND receipt.provider = snapshot.provider
   AND receipt.provider_request_id = snapshot.provider_request_id
   AND receipt.connector_version = snapshot.connector_version
   AND receipt.observed_at = snapshot.observed_at
  ORDER BY
    snapshot.workspace_id,
    snapshot.project_id,
    snapshot.keyword_id,
    snapshot.tracking_context_id,
    snapshot.observed_at DESC,
    EXISTS (
      SELECT 1
      FROM rank_serp_results result
      WHERE result.snapshot_observed_at = snapshot.observed_at
        AND result.snapshot_id = snapshot.id
    ) DESC,
    receipt.applied_at DESC,
    snapshot.created_at DESC,
    snapshot.id DESC
)
UPDATE current_ranks current
SET
  configuration_version = chosen.configuration_version,
  observed_at = chosen.observed_at,
  snapshot_id = chosen.id,
  found = chosen.found,
  position = chosen.position,
  previous_position = current.position,
  ranking_url = chosen.ranking_url,
  normalized_ranking_url = chosen.normalized_ranking_url,
  provider = chosen.provider,
  source_mode = chosen.source_mode,
  data_quality_flags = chosen.data_quality_flags,
  version = current.version + 1,
  updated_at = chosen.applied_at
FROM ranked_snapshots chosen
WHERE current.workspace_id = chosen.workspace_id
  AND current.project_id = chosen.project_id
  AND current.keyword_id = chosen.keyword_id
  AND current.tracking_context_id = chosen.tracking_context_id
  AND current.snapshot_id IS DISTINCT FROM chosen.id;

BEGIN;

-- A logical tracking context can acquire a new immutable configuration for a
-- different city or device. Keep one current projection per configuration so
-- a later run cannot erase the current value of an older dimension.
LOCK TABLE
  "rank_snapshots",
  "rank_serp_results",
  "rank_chunk_ingest_receipts",
  "current_ranks"
IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "current_ranks_monotonic" ON "current_ranks";
DROP TRIGGER "current_ranks_rekey_guarded_update" ON "current_ranks";
DROP TRIGGER "current_ranks_ingest_receipt_at_commit" ON "current_ranks";
DROP TRIGGER "current_ranks_receipt_rekey_guarded_update" ON "current_ranks";

ALTER TABLE "current_ranks"
  DROP CONSTRAINT "current_ranks_pkey",
  ADD CONSTRAINT "current_ranks_pkey" PRIMARY KEY (
    "workspace_id",
    "project_id",
    "keyword_id",
    "tracking_context_id",
    "configuration_version"
  );

-- current_ranks is a rebuildable projection. Rebuild every configuration from
-- immutable snapshots so dimensions that were overwritten under the old key
-- become visible immediately without another provider request.
DELETE FROM "current_ranks";

WITH "snapshot_candidates" AS MATERIALIZED (
  SELECT
    "snapshot".*,
    "receipt"."applied_at",
    EXISTS (
      SELECT 1
      FROM "rank_serp_results" AS "result"
      WHERE "result"."snapshot_observed_at" = "snapshot"."observed_at"
        AND "result"."snapshot_id" = "snapshot"."id"
    ) AS "has_serp"
  FROM "rank_snapshots" AS "snapshot"
  INNER JOIN "rank_chunk_ingest_receipts" AS "receipt"
    ON "receipt"."workspace_id" = "snapshot"."workspace_id"
   AND "receipt"."project_id" = "snapshot"."project_id"
   AND "receipt"."manifest_id" = "snapshot"."manifest_id"
   AND "receipt"."chunk_index" = "snapshot"."chunk_index"
   AND "receipt"."job_id" = "snapshot"."job_id"
   AND "receipt"."job_item_id" = "snapshot"."job_item_id"
   AND "receipt"."provider" = "snapshot"."provider"
   AND "receipt"."provider_request_id" = "snapshot"."provider_request_id"
   AND "receipt"."connector_version" = "snapshot"."connector_version"
   AND "receipt"."observed_at" = "snapshot"."observed_at"
  WHERE "snapshot"."position_tracking_enabled" = TRUE
),
"ranked_snapshots" AS (
  SELECT
    "candidate".*,
    row_number() OVER (
      PARTITION BY
        "candidate"."workspace_id",
        "candidate"."project_id",
        "candidate"."keyword_id",
        "candidate"."tracking_context_id",
        "candidate"."configuration_version"
      ORDER BY
        "candidate"."observed_at" DESC,
        "candidate"."has_serp" DESC,
        "candidate"."applied_at" DESC,
        "candidate"."created_at" DESC,
        "candidate"."id" DESC
    ) AS "projection_order",
    count(*) OVER (
      PARTITION BY
        "candidate"."workspace_id",
        "candidate"."project_id",
        "candidate"."keyword_id",
        "candidate"."tracking_context_id",
        "candidate"."configuration_version"
    ) AS "projection_version",
    lead("candidate"."position") OVER (
      PARTITION BY
        "candidate"."workspace_id",
        "candidate"."project_id",
        "candidate"."keyword_id",
        "candidate"."tracking_context_id",
        "candidate"."configuration_version"
      ORDER BY
        "candidate"."observed_at" DESC,
        "candidate"."has_serp" DESC,
        "candidate"."applied_at" DESC,
        "candidate"."created_at" DESC,
        "candidate"."id" DESC
    ) AS "previous_position"
  FROM "snapshot_candidates" AS "candidate"
)
INSERT INTO "current_ranks" (
  "workspace_id",
  "project_id",
  "keyword_id",
  "tracking_context_id",
  "configuration_version",
  "observed_at",
  "snapshot_id",
  "found",
  "position",
  "previous_position",
  "ranking_url",
  "normalized_ranking_url",
  "provider",
  "source_mode",
  "data_quality_flags",
  "version",
  "updated_at"
)
SELECT
  "workspace_id",
  "project_id",
  "keyword_id",
  "tracking_context_id",
  "configuration_version",
  "observed_at",
  "id",
  "found",
  "position",
  "previous_position",
  "ranking_url",
  "normalized_ranking_url",
  "provider",
  "source_mode",
  "data_quality_flags",
  "projection_version"::integer,
  "applied_at"
FROM "ranked_snapshots"
WHERE "projection_order" = 1;

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
      OLD."tracking_context_id",
      OLD."configuration_version"
    ) = (
      NEW."workspace_id",
      NEW."project_id",
      NEW."keyword_id",
      NEW."tracking_context_id",
      NEW."configuration_version"
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

CREATE TRIGGER "current_ranks_monotonic"
BEFORE INSERT OR DELETE ON "current_ranks"
FOR EACH ROW
EXECUTE FUNCTION "guard_current_rank_mutation"();

CREATE TRIGGER "current_ranks_rekey_guarded_update"
BEFORE UPDATE ON "current_ranks"
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "guard_current_rank_mutation"();

CREATE CONSTRAINT TRIGGER "current_ranks_ingest_receipt_at_commit"
AFTER INSERT ON "current_ranks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_current_rank_ingest_receipt_at_commit"();

CREATE CONSTRAINT TRIGGER "current_ranks_receipt_rekey_guarded_update"
AFTER UPDATE ON "current_ranks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NOT project_workspace_rekey_allowed(to_jsonb(OLD), to_jsonb(NEW)))
EXECUTE FUNCTION "require_current_rank_ingest_receipt_at_commit"();

COMMIT;

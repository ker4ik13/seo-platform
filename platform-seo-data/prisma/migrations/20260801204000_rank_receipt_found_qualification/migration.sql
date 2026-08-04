BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION "guard_rank_chunk_ingest_receipt_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "manifest_status" "RankExecutionManifestStatus";
  "manifest_sealed_at" TIMESTAMPTZ;
  "chunk_entry_count" INTEGER;
  "chunk_hash" BYTEA;
  "snapshot_count" INTEGER;
  "snapshot_found_count" INTEGER;
  "snapshot_not_found_count" INTEGER;
  "snapshot_scope_valid" BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      "manifest"."status",
      "manifest"."sealed_at",
      "chunk"."entry_count",
      "chunk"."chunk_hash"
    INTO
      "manifest_status",
      "manifest_sealed_at",
      "chunk_entry_count",
      "chunk_hash"
    FROM "rank_execution_manifests" AS "manifest"
    JOIN "rank_execution_manifest_chunks" AS "chunk"
      ON "chunk"."workspace_id" = "manifest"."workspace_id"
     AND "chunk"."project_id" = "manifest"."project_id"
     AND "chunk"."manifest_id" = "manifest"."id"
    WHERE "manifest"."workspace_id" = NEW."workspace_id"
      AND "manifest"."project_id" = NEW."project_id"
      AND "manifest"."id" = NEW."manifest_id"
      AND "manifest"."job_id" = NEW."job_id"
      AND "chunk"."chunk_index" = NEW."chunk_index";

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE "snapshot"."found")::integer,
      count(*) FILTER (WHERE NOT "snapshot"."found")::integer,
      COALESCE(
        bool_and(
          "snapshot"."job_id" = NEW."job_id"
          AND "snapshot"."job_item_id" = NEW."job_item_id"
          AND "snapshot"."provider" = NEW."provider"
          AND "snapshot"."provider_request_id" = NEW."provider_request_id"
          AND "snapshot"."connector_version" = NEW."connector_version"
          AND "snapshot"."observed_at" = NEW."observed_at"
        ),
        FALSE
      )
    INTO
      "snapshot_count",
      "snapshot_found_count",
      "snapshot_not_found_count",
      "snapshot_scope_valid"
    FROM "rank_snapshots" AS "snapshot"
    WHERE "snapshot"."workspace_id" = NEW."workspace_id"
      AND "snapshot"."project_id" = NEW."project_id"
      AND "snapshot"."manifest_id" = NEW."manifest_id"
      AND "snapshot"."chunk_index" = NEW."chunk_index";

    IF "manifest_status" = 'SEALED'
      AND "manifest_sealed_at" <= NEW."applied_at"
      AND "chunk_entry_count" = NEW."persisted_count"
      AND "chunk_hash" = NEW."manifest_chunk_hash"
      AND "snapshot_count" = NEW."persisted_count"
      AND "snapshot_found_count" = NEW."found_count"
      AND "snapshot_not_found_count" = NEW."not_found_count"
      AND "snapshot_scope_valid"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank chunk ingest receipt is immutable or invalid'
    USING ERRCODE = '55000';
END;
$$;

COMMIT;

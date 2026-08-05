BEGIN;

-- A trigger function shared by the chunk and entry tables must not reference
-- table-specific NEW fields directly: PostgreSQL resolves those fields for
-- the actual trigger row type before the TG_TABLE_NAME branch is evaluated.
-- Reading the row through JSON keeps the shared guard strict without making
-- inserts into rank_execution_manifest_entries fail on chunk.entry_count.
CREATE OR REPLACE FUNCTION "guard_rank_execution_manifest_child_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "manifest_status" "RankExecutionManifestStatus";
  "manifest_pair_count" INTEGER;
  "manifest_chunk_count" INTEGER;
  "manifest_chunk_size" INTEGER;
  "new_row" JSONB;
  "new_chunk_index" INTEGER;
  "new_entry_count" INTEGER;
  "new_sequence" INTEGER;
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
      "new_row" := to_jsonb(NEW);
      "new_chunk_index" := ("new_row" ->> 'chunk_index')::integer;

      IF TG_TABLE_NAME = 'rank_execution_manifest_chunks' THEN
        "new_entry_count" := ("new_row" ->> 'entry_count')::integer;
        IF "new_chunk_index" BETWEEN 0 AND "manifest_chunk_count" - 1
          AND "new_entry_count" = LEAST(
            "manifest_chunk_size",
            "manifest_pair_count" - "new_chunk_index" * "manifest_chunk_size"
          )
        THEN
          RETURN NEW;
        END IF;
      ELSIF TG_TABLE_NAME = 'rank_execution_manifest_entries' THEN
        "new_sequence" := ("new_row" ->> 'sequence')::integer;
        IF "new_chunk_index" BETWEEN 0 AND "manifest_chunk_count" - 1
          AND "new_sequence" BETWEEN
            "new_chunk_index" * "manifest_chunk_size"
            AND LEAST(
              "manifest_pair_count",
              ("new_chunk_index" + 1) * "manifest_chunk_size"
            ) - 1
        THEN
          RETURN NEW;
        END IF;
      END IF;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank execution manifest storage is immutable or invalid'
    USING ERRCODE = '55000';
END;
$$;

COMMIT;

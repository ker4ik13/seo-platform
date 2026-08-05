BEGIN;

LOCK TABLE "rank_snapshots", "current_ranks"
IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "rank_snapshots")
    OR EXISTS (SELECT 1 FROM "current_ranks")
  THEN
    RAISE EXCEPTION
      'normalized rank-result persistence requires empty pre-release rank tables'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DROP TABLE "current_ranks";
DROP TABLE "rank_snapshots";

CREATE UNIQUE INDEX
  "rank_execution_manifest_entries_tenant_chunk_id_key"
ON "rank_execution_manifest_entries"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index",
  "id"
);

CREATE TABLE "rank_chunk_ingest_receipts" (
  "manifest_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "ingested_by" UUID NOT NULL,
  "schema_version" VARCHAR(32) NOT NULL,
  "ingest_envelope_hash" BYTEA NOT NULL,
  "manifest_chunk_hash" BYTEA NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "provider_request_id" VARCHAR(256) NOT NULL,
  "connector_version" VARCHAR(64) NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "persisted_count" INTEGER NOT NULL,
  "found_count" INTEGER NOT NULL,
  "not_found_count" INTEGER NOT NULL,
  "current_updated_count" INTEGER NOT NULL,
  "current_skipped_count" INTEGER NOT NULL,
  "applied_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "rank_chunk_ingest_receipts_pkey"
    PRIMARY KEY ("manifest_id", "chunk_index"),
  CONSTRAINT "rank_chunk_ingest_receipts_schema"
    CHECK ("schema_version" = 'rank-ingest@1'),
  CONSTRAINT "rank_chunk_ingest_receipts_hash_sizes"
    CHECK (
      octet_length("ingest_envelope_hash") = 32
      AND octet_length("manifest_chunk_hash") = 32
    ),
  CONSTRAINT "rank_chunk_ingest_receipts_provider_operation"
    CHECK (
      "provider" = 'ARSENKIN'
      AND "operation" = 'POSITIONS'
    ),
  CONSTRAINT "rank_chunk_ingest_receipts_status"
    CHECK ("status" = 'APPLIED'),
  CONSTRAINT "rank_chunk_ingest_receipts_chunk_index"
    CHECK ("chunk_index" BETWEEN 0 AND 3),
  CONSTRAINT "rank_chunk_ingest_receipts_provider_request"
    CHECK (
      "provider_request_id" ~ '^[ -~]{1,256}$'
    ),
  CONSTRAINT "rank_chunk_ingest_receipts_connector_version"
    CHECK (
      "connector_version" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  CONSTRAINT "rank_chunk_ingest_receipts_counts"
    CHECK (
      "persisted_count" BETWEEN 1 AND 250
      AND "found_count" BETWEEN 0 AND "persisted_count"
      AND "not_found_count" BETWEEN 0 AND "persisted_count"
      AND "persisted_count" = "found_count" + "not_found_count"
      AND "current_updated_count" BETWEEN 0 AND "persisted_count"
      AND "current_skipped_count" BETWEEN 0 AND "persisted_count"
      AND "persisted_count"
        = "current_updated_count" + "current_skipped_count"
    )
);

CREATE UNIQUE INDEX "rank_chunk_ingest_receipts_tenant_chunk_key"
ON "rank_chunk_ingest_receipts"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
);

CREATE UNIQUE INDEX
  "rank_chunk_ingest_receipts_tenant_job_item_key"
ON "rank_chunk_ingest_receipts"(
  "workspace_id",
  "project_id",
  "job_item_id"
);

CREATE INDEX "rank_chunk_ingest_receipts_job_idx"
ON "rank_chunk_ingest_receipts"(
  "workspace_id",
  "project_id",
  "job_id",
  "chunk_index"
);

ALTER TABLE "rank_chunk_ingest_receipts"
ADD CONSTRAINT "rank_chunk_ingest_receipts_manifest_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "job_id"
)
REFERENCES "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "id",
  "job_id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_chunk_ingest_receipts"
ADD CONSTRAINT "rank_chunk_ingest_receipts_chunk_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
)
REFERENCES "rank_execution_manifest_chunks"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

CREATE FUNCTION "rank_data_quality_flags_valid"("flags" JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT
    jsonb_typeof("flags") = 'array'
    AND jsonb_array_length("flags") <= 5
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("flags") AS "item"("value")
      WHERE jsonb_typeof("item"."value") <> 'string'
        OR "item"."value" #>> '{}' NOT IN (
          'PROVIDER_OBSERVED_AT_UNAVAILABLE',
          'ABSOLUTE_POSITION_UNAVAILABLE',
          'PIXEL_POSITION_UNAVAILABLE',
          'TITLE_UNAVAILABLE',
          'SNIPPET_UNAVAILABLE'
        )
    )
    AND jsonb_array_length("flags") = (
      SELECT count(DISTINCT "item"."value" #>> '{}')
      FROM jsonb_array_elements("flags") AS "item"("value")
    );
$$;

CREATE TABLE "rank_snapshots" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "manifest_id" UUID NOT NULL,
  "manifest_entry_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "job_id" UUID NOT NULL,
  "job_item_id" UUID NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "found" BOOLEAN NOT NULL,
  "position" INTEGER,
  "absolute_position" INTEGER,
  "pixel_position" INTEGER,
  "ranking_url" TEXT,
  "normalized_ranking_url" TEXT,
  "title" TEXT,
  "snippet" TEXT,
  "result_type" VARCHAR(32),
  "serp_features" JSONB NOT NULL,
  "data_quality_flags" JSONB NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "source_mode" "DataSourceMode" NOT NULL,
  "provider_request_id" VARCHAR(256) NOT NULL,
  "connector_version" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_snapshots_pkey"
    PRIMARY KEY ("observed_at", "id"),
  CONSTRAINT "rank_snapshots_configuration_version"
    CHECK ("configuration_version" > 0),
  CONSTRAINT "rank_snapshots_manifest_position"
    CHECK (
      "chunk_index" BETWEEN 0 AND 3
      AND "sequence" BETWEEN 0 AND 999
      AND "chunk_index" = ("sequence" / 250)
    ),
  CONSTRAINT "rank_snapshots_provider_source"
    CHECK (
      "provider" = 'ARSENKIN'
      AND "source_mode" = 'BYOK'
    ),
  CONSTRAINT "rank_snapshots_provider_request"
    CHECK (
      "provider_request_id" ~ '^[ -~]{1,256}$'
    ),
  CONSTRAINT "rank_snapshots_connector_version"
    CHECK (
      "connector_version" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    ),
  CONSTRAINT "rank_snapshots_serp_features"
    CHECK ("serp_features" = '[]'::jsonb),
  CONSTRAINT "rank_snapshots_data_quality"
    CHECK ("rank_data_quality_flags_valid"("data_quality_flags")),
  CONSTRAINT "rank_snapshots_data_quality_shape"
    CHECK (
      (
        NOT "found"
        AND "data_quality_flags"
          <@ '["PROVIDER_OBSERVED_AT_UNAVAILABLE"]'::jsonb
      )
      OR (
        "found"
        AND (
          ("absolute_position" IS NULL)
          = (
            "data_quality_flags"
              @> '["ABSOLUTE_POSITION_UNAVAILABLE"]'::jsonb
          )
        )
        AND (
          ("pixel_position" IS NULL)
          = (
            "data_quality_flags"
              @> '["PIXEL_POSITION_UNAVAILABLE"]'::jsonb
          )
        )
        AND (
          ("title" IS NULL)
          = (
            "data_quality_flags"
              @> '["TITLE_UNAVAILABLE"]'::jsonb
          )
        )
        AND (
          ("snippet" IS NULL)
          = (
            "data_quality_flags"
              @> '["SNIPPET_UNAVAILABLE"]'::jsonb
          )
        )
      )
    ),
  CONSTRAINT "rank_snapshots_result_shape"
    CHECK (
      (
        "found"
        AND "position" BETWEEN 1 AND 30
        AND (
          "absolute_position" IS NULL
          OR "absolute_position" >= 0
        )
        AND (
          "pixel_position" IS NULL
          OR "pixel_position" >= 0
        )
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
    ),
  CONSTRAINT "rank_snapshots_text_bounds"
    CHECK (
      ("title" IS NULL OR char_length("title") <= 2048)
      AND ("snippet" IS NULL OR char_length("snippet") <= 8192)
    )
);

CREATE UNIQUE INDEX "rank_snapshots_manifest_entry_key"
ON "rank_snapshots"("manifest_id", "manifest_entry_id");

CREATE UNIQUE INDEX "rank_snapshots_tenant_manifest_entry_key"
ON "rank_snapshots"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index",
  "manifest_entry_id"
);

CREATE INDEX "rank_snapshots_context_history_idx"
ON "rank_snapshots"(
  "workspace_id",
  "project_id",
  "tracking_context_id",
  "observed_at" DESC,
  "id" DESC
);

CREATE INDEX "rank_snapshots_keyword_history_idx"
ON "rank_snapshots"(
  "workspace_id",
  "project_id",
  "keyword_id",
  "tracking_context_id",
  "observed_at" DESC,
  "id" DESC
);

CREATE INDEX "rank_snapshots_job_chunk_idx"
ON "rank_snapshots"(
  "workspace_id",
  "project_id",
  "job_id",
  "chunk_index"
);

ALTER TABLE "rank_snapshots"
ADD CONSTRAINT "rank_snapshots_manifest_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "job_id"
)
REFERENCES "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "id",
  "job_id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_snapshots"
ADD CONSTRAINT "rank_snapshots_chunk_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
)
REFERENCES "rank_execution_manifest_chunks"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_snapshots"
ADD CONSTRAINT "rank_snapshots_entry_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index",
  "manifest_entry_id"
)
REFERENCES "rank_execution_manifest_entries"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index",
  "id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_snapshots"
ADD CONSTRAINT "rank_snapshots_keyword_tenant_fkey"
FOREIGN KEY ("workspace_id", "project_id", "keyword_id")
REFERENCES "keywords"("workspace_id", "project_id", "id")
ON DELETE RESTRICT
ON UPDATE RESTRICT;

CREATE TABLE "current_ranks" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "found" BOOLEAN NOT NULL,
  "position" INTEGER,
  "previous_position" INTEGER,
  "ranking_url" TEXT,
  "normalized_ranking_url" TEXT,
  "provider" VARCHAR(32) NOT NULL,
  "source_mode" "DataSourceMode" NOT NULL,
  "data_quality_flags" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "current_ranks_pkey"
    PRIMARY KEY (
      "workspace_id",
      "project_id",
      "keyword_id",
      "tracking_context_id"
    ),
  CONSTRAINT "current_ranks_version"
    CHECK (
      "configuration_version" > 0
      AND "version" > 0
    ),
  CONSTRAINT "current_ranks_provider_source"
    CHECK (
      "provider" = 'ARSENKIN'
      AND "source_mode" = 'BYOK'
    ),
  CONSTRAINT "current_ranks_data_quality"
    CHECK ("rank_data_quality_flags_valid"("data_quality_flags")),
  CONSTRAINT "current_ranks_result_shape"
    CHECK (
      (
        "found"
        AND "position" BETWEEN 1 AND 30
        AND "ranking_url" IS NOT NULL
        AND "normalized_ranking_url" IS NOT NULL
      )
      OR (
        NOT "found"
        AND "position" IS NULL
        AND "ranking_url" IS NULL
        AND "normalized_ranking_url" IS NULL
      )
    )
);

CREATE INDEX "current_ranks_context_position_idx"
ON "current_ranks"(
  "workspace_id",
  "project_id",
  "tracking_context_id",
  "position"
);

CREATE FUNCTION "guard_rank_snapshot_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_manifest" "rank_execution_manifests"%ROWTYPE;
  "stored_entry" "rank_execution_manifest_entries"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT *
    INTO "stored_manifest"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "id" = NEW."manifest_id"
      AND "job_id" = NEW."job_id";

    SELECT *
    INTO "stored_entry"
    FROM "rank_execution_manifest_entries"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "manifest_id" = NEW."manifest_id"
      AND "chunk_index" = NEW."chunk_index"
      AND "id" = NEW."manifest_entry_id";

    IF "stored_manifest"."status" = 'SEALED'
      AND "stored_manifest"."tracking_context_id"
        = NEW."tracking_context_id"
      AND "stored_manifest"."configuration_version"
        = NEW."configuration_version"
      AND "stored_manifest"."provider" = NEW."provider"
      AND "stored_entry"."keyword_id" = NEW."keyword_id"
      AND "stored_entry"."sequence" = NEW."sequence"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank snapshot is immutable or has invalid provenance'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "guard_current_rank_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_snapshot" "rank_snapshots"%ROWTYPE;
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
    OR "stored_snapshot"."configuration_version"
      <> NEW."configuration_version"
    OR "stored_snapshot"."found" <> NEW."found"
    OR "stored_snapshot"."position" IS DISTINCT FROM NEW."position"
    OR "stored_snapshot"."ranking_url"
      IS DISTINCT FROM NEW."ranking_url"
    OR "stored_snapshot"."normalized_ranking_url"
      IS DISTINCT FROM NEW."normalized_ranking_url"
    OR "stored_snapshot"."provider" <> NEW."provider"
    OR "stored_snapshot"."source_mode" <> NEW."source_mode"
    OR "stored_snapshot"."data_quality_flags"
      IS DISTINCT FROM NEW."data_quality_flags"
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
      NEW."observed_at",
      NEW."snapshot_id"
    ) > (
      OLD."observed_at",
      OLD."snapshot_id"
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

CREATE FUNCTION "guard_rank_chunk_ingest_receipt_mutation"()
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
      count(*) FILTER (WHERE "found")::integer,
      count(*) FILTER (WHERE NOT "found")::integer,
      COALESCE(
        bool_and(
          "job_id" = NEW."job_id"
          AND "job_item_id" = NEW."job_item_id"
          AND "provider" = NEW."provider"
          AND "provider_request_id" = NEW."provider_request_id"
          AND "connector_version" = NEW."connector_version"
          AND "observed_at" = NEW."observed_at"
        ),
        FALSE
      )
    INTO
      "snapshot_count",
      "snapshot_found_count",
      "snapshot_not_found_count",
      "snapshot_scope_valid"
    FROM "rank_snapshots"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "manifest_id" = NEW."manifest_id"
      AND "chunk_index" = NEW."chunk_index";

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

CREATE FUNCTION "require_rank_snapshot_ingest_receipt_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "rank_chunk_ingest_receipts" AS "receipt"
    WHERE "receipt"."workspace_id" = NEW."workspace_id"
      AND "receipt"."project_id" = NEW."project_id"
      AND "receipt"."manifest_id" = NEW."manifest_id"
      AND "receipt"."chunk_index" = NEW."chunk_index"
      AND "receipt"."job_id" = NEW."job_id"
      AND "receipt"."job_item_id" = NEW."job_item_id"
      AND "receipt"."provider" = NEW."provider"
      AND "receipt"."provider_request_id"
        = NEW."provider_request_id"
      AND "receipt"."connector_version" = NEW."connector_version"
      AND "receipt"."observed_at" = NEW."observed_at"
  )
  THEN
    RAISE EXCEPTION
      'rank snapshot requires its immutable ingest receipt'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION "require_current_rank_ingest_receipt_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "rank_snapshots" AS "snapshot"
    JOIN "rank_chunk_ingest_receipts" AS "receipt"
      ON "receipt"."workspace_id" = "snapshot"."workspace_id"
     AND "receipt"."project_id" = "snapshot"."project_id"
     AND "receipt"."manifest_id" = "snapshot"."manifest_id"
     AND "receipt"."chunk_index" = "snapshot"."chunk_index"
     AND "receipt"."job_id" = "snapshot"."job_id"
     AND "receipt"."job_item_id" = "snapshot"."job_item_id"
     AND "receipt"."provider" = "snapshot"."provider"
     AND "receipt"."provider_request_id"
       = "snapshot"."provider_request_id"
     AND "receipt"."connector_version"
       = "snapshot"."connector_version"
     AND "receipt"."observed_at" = "snapshot"."observed_at"
    WHERE "snapshot"."workspace_id" = NEW."workspace_id"
      AND "snapshot"."project_id" = NEW."project_id"
      AND "snapshot"."keyword_id" = NEW."keyword_id"
      AND "snapshot"."tracking_context_id"
        = NEW."tracking_context_id"
      AND "snapshot"."observed_at" = NEW."observed_at"
      AND "snapshot"."id" = NEW."snapshot_id"
      AND "receipt"."applied_at" = NEW."updated_at"
  )
  THEN
    RAISE EXCEPTION
      'current rank requires the snapshot ingest receipt'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION "reject_rank_result_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank result persistence cannot be truncated'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "rank_snapshots_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "rank_snapshots"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_snapshot_mutation"();

CREATE TRIGGER "current_ranks_monotonic"
BEFORE INSERT OR UPDATE OR DELETE ON "current_ranks"
FOR EACH ROW
EXECUTE FUNCTION "guard_current_rank_mutation"();

CREATE TRIGGER "rank_chunk_ingest_receipts_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "rank_chunk_ingest_receipts"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_chunk_ingest_receipt_mutation"();

CREATE CONSTRAINT TRIGGER
  "rank_snapshots_ingest_receipt_at_commit"
AFTER INSERT ON "rank_snapshots"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_rank_snapshot_ingest_receipt_at_commit"();

CREATE CONSTRAINT TRIGGER
  "current_ranks_ingest_receipt_at_commit"
AFTER INSERT OR UPDATE ON "current_ranks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_current_rank_ingest_receipt_at_commit"();

CREATE TRIGGER "rank_snapshots_no_truncate"
BEFORE TRUNCATE ON "rank_snapshots"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_result_truncate"();

CREATE TRIGGER "current_ranks_no_truncate"
BEFORE TRUNCATE ON "current_ranks"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_result_truncate"();

CREATE TRIGGER "rank_chunk_ingest_receipts_no_truncate"
BEFORE TRUNCATE ON "rank_chunk_ingest_receipts"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_result_truncate"();

ALTER TABLE "rank_check_finalization_receipts"
DROP CONSTRAINT "rank_check_finalization_receipts_zero_result_boundary";

ALTER TABLE "rank_check_finalization_receipts"
ADD CONSTRAINT "rank_check_finalization_receipts_result_boundary"
CHECK (
  "pair_count" BETWEEN 1 AND 1000
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
);

CREATE OR REPLACE FUNCTION
  "guard_rank_check_finalization_receipt_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_manifest" "rank_execution_manifests"%ROWTYPE;
  "stored_persisted_count" INTEGER;
  "stored_found_count" INTEGER;
  "stored_not_found_count" INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT *
    INTO "stored_manifest"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "id" = NEW."manifest_id"
      AND "job_id" = NEW."job_id";

    SELECT
      COALESCE(sum("persisted_count"), 0)::integer,
      COALESCE(sum("found_count"), 0)::integer,
      COALESCE(sum("not_found_count"), 0)::integer
    INTO
      "stored_persisted_count",
      "stored_found_count",
      "stored_not_found_count"
    FROM "rank_chunk_ingest_receipts"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "manifest_id" = NEW."manifest_id"
      AND "job_id" = NEW."job_id";

    IF FOUND
      AND "stored_manifest"."status" = 'CLOSED'
      AND "stored_manifest"."closed_at" = NEW."finalized_at"
      AND "stored_manifest"."tracking_context_id"
        = NEW."tracking_context_id"
      AND "stored_manifest"."configuration_version"
        = NEW."configuration_version"
      AND "stored_manifest"."pair_count" = NEW."pair_count"
      AND "stored_persisted_count" = NEW."persisted_count"
      AND "stored_found_count" = NEW."found_count"
      AND "stored_not_found_count" = NEW."not_found_count"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank check finalization receipt is immutable or invalid'
    USING ERRCODE = '55000';
END;
$$;

CREATE UNIQUE INDEX "rank_completion_outbox_manifest_key"
ON "outbox_events"("event_type", "aggregate_id")
WHERE "event_type" = 'seo.rank-check.completed.v1';

CREATE FUNCTION "require_rank_completion_outbox_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" IN ('COMPLETED', 'PARTIALLY_COMPLETED')
    AND NOT EXISTS (
      SELECT 1
      FROM "outbox_events" AS "event"
      WHERE "event"."event_type" = 'seo.rank-check.completed.v1'
        AND "event"."aggregate_id" = NEW."manifest_id"
        AND "event"."workspace_id" = NEW."workspace_id"
        AND "event"."project_id" = NEW."project_id"
        AND "event"."payload" = jsonb_build_object(
          'jobId', NEW."job_id"::text,
          'manifestId', NEW."manifest_id"::text,
          'workspaceId', NEW."workspace_id"::text,
          'projectId', NEW."project_id"::text,
          'trackingContextId', NEW."tracking_context_id"::text,
          'configurationVersion', NEW."configuration_version",
          'status', NEW."status"::text,
          'pairCount', NEW."pair_count"::text,
          'persistedCount', NEW."persisted_count"::text,
          'foundCount', NEW."found_count"::text,
          'notFoundCount', NEW."not_found_count"::text,
          'completedAt',
            to_char(
              NEW."finalized_at" AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
        )
        AND "event"."metadata" = jsonb_build_object(
          'producer', 'seo-data',
          'source', 'rank-results'
        )
    )
  THEN
    RAISE EXCEPTION
      'completed rank finalization requires an exact redacted outbox event'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" NOT IN ('COMPLETED', 'PARTIALLY_COMPLETED')
    AND EXISTS (
      SELECT 1
      FROM "outbox_events" AS "event"
      WHERE "event"."event_type" = 'seo.rank-check.completed.v1'
        AND "event"."aggregate_id" = NEW."manifest_id"
    )
  THEN
    RAISE EXCEPTION
      'non-completion rank finalization cannot emit a completed event'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "rank_check_finalization_completion_outbox_at_commit"
AFTER INSERT ON "rank_check_finalization_receipts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_rank_completion_outbox_at_commit"();

CREATE FUNCTION "require_rank_completion_receipt_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."event_type" = 'seo.rank-check.completed.v1'
    AND NOT EXISTS (
      SELECT 1
      FROM "rank_check_finalization_receipts" AS "receipt"
      WHERE "receipt"."manifest_id" = NEW."aggregate_id"
        AND "receipt"."workspace_id" = NEW."workspace_id"
        AND "receipt"."project_id" = NEW."project_id"
        AND "receipt"."status" IN (
          'COMPLETED',
          'PARTIALLY_COMPLETED'
        )
        AND NEW."payload" = jsonb_build_object(
          'jobId', "receipt"."job_id"::text,
          'manifestId', "receipt"."manifest_id"::text,
          'workspaceId', "receipt"."workspace_id"::text,
          'projectId', "receipt"."project_id"::text,
          'trackingContextId',
            "receipt"."tracking_context_id"::text,
          'configurationVersion',
            "receipt"."configuration_version",
          'status', "receipt"."status"::text,
          'pairCount', "receipt"."pair_count"::text,
          'persistedCount', "receipt"."persisted_count"::text,
          'foundCount', "receipt"."found_count"::text,
          'notFoundCount', "receipt"."not_found_count"::text,
          'completedAt',
            to_char(
              "receipt"."finalized_at" AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
        )
        AND NEW."metadata" = jsonb_build_object(
          'producer', 'seo-data',
          'source', 'rank-results'
        )
    )
  THEN
    RAISE EXCEPTION
      'rank completion outbox event requires its exact finalization receipt'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "rank_completion_outbox_receipt_at_commit"
AFTER INSERT ON "outbox_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW."event_type" = 'seo.rank-check.completed.v1')
EXECUTE FUNCTION "require_rank_completion_receipt_at_commit"();

COMMIT;

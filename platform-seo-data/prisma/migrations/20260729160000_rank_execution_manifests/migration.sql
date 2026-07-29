BEGIN;

CREATE TYPE "RankExecutionManifestStatus"
AS ENUM ('BUILDING', 'SEALED', 'CLOSED');

CREATE UNIQUE INDEX
  "tracking_context_assignments_tenant_project_id_key"
ON "tracking_context_keyword_assignments"(
  "workspace_id",
  "project_id",
  "id"
);

CREATE TABLE "rank_execution_manifests" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "estimate_id" UUID NOT NULL,
  "sealed_by" UUID NOT NULL,
  "request_hash" BYTEA NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "project_domain" VARCHAR(255) NOT NULL,
  "project_status" VARCHAR(16) NOT NULL,
  "project_version" INTEGER NOT NULL,
  "tracking_context_id" UUID NOT NULL,
  "context_version" INTEGER NOT NULL,
  "configuration_version" INTEGER NOT NULL,
  "configuration_hash" BYTEA NOT NULL,
  "semantic_scope_hash" BYTEA NOT NULL,
  "scope_hash" BYTEA NOT NULL,
  "hash_schema_version" VARCHAR(32) NOT NULL,
  "manifest_hash" BYTEA NOT NULL,
  "deduplication_hash" BYTEA NOT NULL,
  "pair_count" INTEGER NOT NULL,
  "chunk_count" INTEGER NOT NULL,
  "chunk_size" INTEGER NOT NULL,
  "execution" JSONB NOT NULL,
  "retention" JSONB NOT NULL,
  "status" "RankExecutionManifestStatus" NOT NULL DEFAULT 'BUILDING',
  "sealed_at" TIMESTAMPTZ(6) NOT NULL,
  "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_manifests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_execution_manifests_request_hash_size"
    CHECK (octet_length("request_hash") = 32),
  CONSTRAINT "rank_execution_manifests_configuration_hash_size"
    CHECK (octet_length("configuration_hash") = 32),
  CONSTRAINT "rank_execution_manifests_semantic_scope_hash_size"
    CHECK (octet_length("semantic_scope_hash") = 32),
  CONSTRAINT "rank_execution_manifests_scope_hash_size"
    CHECK (octet_length("scope_hash") = 32),
  CONSTRAINT "rank_execution_manifests_manifest_hash_size"
    CHECK (octet_length("manifest_hash") = 32),
  CONSTRAINT "rank_execution_manifests_deduplication_hash_size"
    CHECK (octet_length("deduplication_hash") = 32),
  CONSTRAINT "rank_execution_manifests_provider_operation"
    CHECK ("provider" = 'ARSENKIN' AND "operation" = 'POSITIONS'),
  CONSTRAINT "rank_execution_manifests_project_active"
    CHECK ("project_status" = 'ACTIVE'),
  CONSTRAINT "rank_execution_manifests_versions_positive"
    CHECK (
      "project_version" > 0
      AND "context_version" > 0
      AND "configuration_version" > 0
    ),
  CONSTRAINT "rank_execution_manifests_hash_schema"
    CHECK ("hash_schema_version" = 'rank-manifest@1'),
  CONSTRAINT "rank_execution_manifests_counts"
    CHECK (
      "pair_count" BETWEEN 1 AND 1000
      AND "chunk_size" = 250
      AND "chunk_count" = (("pair_count" + 249) / 250)
    ),
  CONSTRAINT "rank_execution_manifests_project_domain"
    CHECK (
      length("project_domain") BETWEEN 3 AND 255
      AND "project_domain" = btrim("project_domain")
    ),
  CONSTRAINT "rank_execution_manifests_execution_object"
    CHECK (jsonb_typeof("execution") = 'object'),
  CONSTRAINT "rank_execution_manifests_retention_exact"
    CHECK (
      "retention" = jsonb_build_object(
        'normalizedRankHistory',
        'LONG_TERM',
        'rawSerp',
        'NOT_COLLECTED'
      )
    ),
  CONSTRAINT "rank_execution_manifests_lifecycle"
    CHECK (
      (
        "status" IN ('BUILDING', 'SEALED')
        AND "closed_at" IS NULL
      )
      OR (
        "status" = 'CLOSED'
        AND "closed_at" IS NOT NULL
        AND "closed_at" >= "sealed_at"
      )
    )
);

CREATE TABLE "rank_execution_manifest_chunks" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "hash_schema_version" VARCHAR(40) NOT NULL,
  "chunk_hash" BYTEA NOT NULL,
  "entry_count" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_manifest_chunks_pkey"
    PRIMARY KEY ("manifest_id", "chunk_index"),
  CONSTRAINT "rank_execution_manifest_chunks_index"
    CHECK ("chunk_index" >= 0),
  CONSTRAINT "rank_execution_manifest_chunks_hash_schema"
    CHECK ("hash_schema_version" = 'rank-manifest-chunk@1'),
  CONSTRAINT "rank_execution_manifest_chunks_hash_size"
    CHECK (octet_length("chunk_hash") = 32),
  CONSTRAINT "rank_execution_manifest_chunks_entry_count"
    CHECK ("entry_count" BETWEEN 1 AND 250)
);

CREATE TABLE "rank_execution_manifest_entries" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "manifest_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "assignment_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "keyword_version" INTEGER NOT NULL,
  "keyword_text" TEXT NOT NULL,
  "keyword_text_hash" BYTEA NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_execution_manifest_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rank_execution_manifest_entries_sequence"
    CHECK (
      "sequence" >= 0
      AND "chunk_index" = ("sequence" / 250)
    ),
  CONSTRAINT "rank_execution_manifest_entries_keyword_version"
    CHECK ("keyword_version" > 0),
  CONSTRAINT "rank_execution_manifest_entries_keyword_text"
    CHECK (
      char_length("keyword_text") BETWEEN 1 AND 500
      AND octet_length("keyword_text") BETWEEN 1 AND 2000
    ),
  CONSTRAINT "rank_execution_manifest_entries_keyword_text_hash_size"
    CHECK (octet_length("keyword_text_hash") = 32),
  CONSTRAINT "rank_execution_manifest_entries_language"
    CHECK (length(btrim("language")) BETWEEN 1 AND 16)
);

CREATE UNIQUE INDEX "rank_execution_manifests_tenant_project_job_key"
ON "rank_execution_manifests"("workspace_id", "project_id", "job_id");

CREATE UNIQUE INDEX "rank_execution_manifests_tenant_project_id_key"
ON "rank_execution_manifests"("workspace_id", "project_id", "id");

CREATE INDEX "rank_execution_manifests_context_sealed_idx"
ON "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "tracking_context_id",
  "sealed_at" DESC
);

CREATE INDEX "rank_execution_manifests_dedup_idx"
ON "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "provider",
  "deduplication_hash"
);

CREATE UNIQUE INDEX "rank_execution_manifests_active_dedup_key"
ON "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "provider",
  "deduplication_hash"
)
WHERE "status" = 'SEALED';

CREATE UNIQUE INDEX
  "rank_execution_manifest_chunks_tenant_project_chunk_key"
ON "rank_execution_manifest_chunks"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
);

CREATE INDEX "rank_execution_manifest_chunks_read_idx"
ON "rank_execution_manifest_chunks"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index"
);

CREATE UNIQUE INDEX "rank_execution_manifest_entries_sequence_key"
ON "rank_execution_manifest_entries"("manifest_id", "sequence");

CREATE UNIQUE INDEX "rank_execution_manifest_entries_assignment_key"
ON "rank_execution_manifest_entries"("manifest_id", "assignment_id");

CREATE UNIQUE INDEX "rank_execution_manifest_entries_keyword_key"
ON "rank_execution_manifest_entries"("manifest_id", "keyword_id");

CREATE INDEX "rank_execution_manifest_entries_chunk_read_idx"
ON "rank_execution_manifest_entries"(
  "workspace_id",
  "project_id",
  "manifest_id",
  "chunk_index",
  "sequence"
);

ALTER TABLE "rank_execution_manifests"
ADD CONSTRAINT "rank_execution_manifests_context_tenant_fkey"
FOREIGN KEY ("workspace_id", "project_id", "tracking_context_id")
REFERENCES "tracking_contexts"("workspace_id", "project_id", "id")
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_execution_manifests"
ADD CONSTRAINT "rank_execution_manifests_configuration_tenant_fkey"
FOREIGN KEY (
  "workspace_id",
  "project_id",
  "tracking_context_id",
  "configuration_version"
)
REFERENCES "tracking_context_versions"(
  "workspace_id",
  "project_id",
  "context_id",
  "configuration_version"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_execution_manifest_chunks"
ADD CONSTRAINT "rank_execution_manifest_chunks_manifest_tenant_fkey"
FOREIGN KEY ("workspace_id", "project_id", "manifest_id")
REFERENCES "rank_execution_manifests"(
  "workspace_id",
  "project_id",
  "id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_execution_manifest_entries"
ADD CONSTRAINT "rank_execution_manifest_entries_chunk_tenant_fkey"
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

ALTER TABLE "rank_execution_manifest_entries"
ADD CONSTRAINT "rank_execution_manifest_entries_assignment_tenant_fkey"
FOREIGN KEY ("workspace_id", "project_id", "assignment_id")
REFERENCES "tracking_context_keyword_assignments"(
  "workspace_id",
  "project_id",
  "id"
)
ON DELETE RESTRICT
ON UPDATE RESTRICT;

ALTER TABLE "rank_execution_manifest_entries"
ADD CONSTRAINT "rank_execution_manifest_entries_keyword_tenant_fkey"
FOREIGN KEY ("workspace_id", "project_id", "keyword_id")
REFERENCES "keywords"("workspace_id", "project_id", "id")
ON DELETE RESTRICT
ON UPDATE RESTRICT;

CREATE FUNCTION "guard_rank_execution_manifest_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "stored_chunk_count" INTEGER;
  "declared_entry_count" INTEGER;
  "stored_entry_count" INTEGER;
  "minimum_chunk_index" INTEGER;
  "maximum_chunk_index" INTEGER;
  "minimum_entry_sequence" INTEGER;
  "maximum_entry_sequence" INTEGER;
  "chunk_counts_match" BOOLEAN;
  "entry_provenance_valid" BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT'
    AND NEW."status" = 'BUILDING'
    AND NEW."closed_at" IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" = 'BUILDING'
    AND NEW."status" = 'SEALED'
    AND OLD."closed_at" IS NULL
    AND NEW."closed_at" IS NULL
    AND (
      to_jsonb(NEW) - ARRAY['status', 'closed_at']
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['status', 'closed_at']
    )
  THEN
    SELECT
      count(*)::integer,
      COALESCE(sum("chunk"."entry_count"), 0)::integer,
      COALESCE(sum("actual"."entry_count"), 0)::integer,
      min("chunk"."chunk_index"),
      max("chunk"."chunk_index"),
      min("actual"."minimum_sequence"),
      max("actual"."maximum_sequence"),
      COALESCE(
        bool_and("chunk"."entry_count" = "actual"."entry_count"),
        FALSE
      )
    INTO
      "stored_chunk_count",
      "declared_entry_count",
      "stored_entry_count",
      "minimum_chunk_index",
      "maximum_chunk_index",
      "minimum_entry_sequence",
      "maximum_entry_sequence",
      "chunk_counts_match"
    FROM "rank_execution_manifest_chunks" AS "chunk"
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS "entry_count",
        min("entry"."sequence") AS "minimum_sequence",
        max("entry"."sequence") AS "maximum_sequence"
      FROM "rank_execution_manifest_entries" AS "entry"
      WHERE "entry"."workspace_id" = "chunk"."workspace_id"
        AND "entry"."project_id" = "chunk"."project_id"
        AND "entry"."manifest_id" = "chunk"."manifest_id"
        AND "entry"."chunk_index" = "chunk"."chunk_index"
    ) AS "actual" ON TRUE
    WHERE "chunk"."workspace_id" = NEW."workspace_id"
      AND "chunk"."project_id" = NEW."project_id"
      AND "chunk"."manifest_id" = NEW."id";

    SELECT NOT EXISTS (
      SELECT 1
      FROM "rank_execution_manifest_entries" AS "entry"
      LEFT JOIN "tracking_context_keyword_assignments" AS "assignment"
        ON "assignment"."workspace_id" = "entry"."workspace_id"
       AND "assignment"."project_id" = "entry"."project_id"
       AND "assignment"."id" = "entry"."assignment_id"
      LEFT JOIN "keywords" AS "keyword"
        ON "keyword"."workspace_id" = "entry"."workspace_id"
       AND "keyword"."project_id" = "entry"."project_id"
       AND "keyword"."id" = "entry"."keyword_id"
      WHERE "entry"."workspace_id" = NEW."workspace_id"
        AND "entry"."project_id" = NEW."project_id"
        AND "entry"."manifest_id" = NEW."id"
        AND (
          "assignment"."id" IS NULL
          OR "assignment"."context_id" <> NEW."tracking_context_id"
          OR "assignment"."keyword_id" <> "entry"."keyword_id"
          OR "assignment"."removed_at" IS NOT NULL
          OR "keyword"."id" IS NULL
          OR "keyword"."status" <> 'ACTIVE'
          OR "keyword"."version" <> "entry"."keyword_version"
          OR "keyword"."text_original" <> "entry"."keyword_text"
          OR "keyword"."language" <> "entry"."language"
        )
    )
    INTO "entry_provenance_valid";

    IF "stored_chunk_count" = NEW."chunk_count"
      AND "declared_entry_count" = NEW."pair_count"
      AND "stored_entry_count" = NEW."pair_count"
      AND "minimum_chunk_index" = 0
      AND "maximum_chunk_index" = NEW."chunk_count" - 1
      AND "minimum_entry_sequence" = 0
      AND "maximum_entry_sequence" = NEW."pair_count" - 1
      AND "chunk_counts_match"
      AND "entry_provenance_valid"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" = 'SEALED'
    AND NEW."status" = 'CLOSED'
    AND OLD."closed_at" IS NULL
    AND NEW."closed_at" IS NOT NULL
    AND (
      to_jsonb(NEW) - ARRAY['status', 'closed_at']
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['status', 'closed_at']
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'rank execution manifest is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "guard_rank_execution_manifest_child_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "manifest_status" "RankExecutionManifestStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status"
    INTO "manifest_status"
    FROM "rank_execution_manifests"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = NEW."project_id"
      AND "id" = NEW."manifest_id";

    IF "manifest_status" = 'BUILDING' THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'rank execution manifest storage is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "reject_rank_execution_manifest_truncate"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'rank execution manifest storage cannot be truncated'
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "require_rank_execution_manifest_sealed_at_commit"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "manifest_status" "RankExecutionManifestStatus";
BEGIN
  SELECT "status"
  INTO "manifest_status"
  FROM "rank_execution_manifests"
  WHERE "id" = NEW."id";

  IF "manifest_status" = 'BUILDING' THEN
    RAISE EXCEPTION 'building rank execution manifest cannot commit'
      USING ERRCODE = '55000';
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "rank_execution_manifests_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "rank_execution_manifests"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_mutation"();

CREATE CONSTRAINT TRIGGER "rank_execution_manifests_sealed_at_commit"
AFTER INSERT OR UPDATE ON "rank_execution_manifests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "require_rank_execution_manifest_sealed_at_commit"();

CREATE TRIGGER "rank_execution_manifest_chunks_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "rank_execution_manifest_chunks"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();

CREATE TRIGGER "rank_execution_manifest_entries_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "rank_execution_manifest_entries"
FOR EACH ROW
EXECUTE FUNCTION "guard_rank_execution_manifest_child_mutation"();

CREATE TRIGGER "rank_execution_manifests_no_truncate"
BEFORE TRUNCATE ON "rank_execution_manifests"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_execution_manifest_truncate"();

CREATE TRIGGER "rank_execution_manifest_chunks_no_truncate"
BEFORE TRUNCATE ON "rank_execution_manifest_chunks"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_execution_manifest_truncate"();

CREATE TRIGGER "rank_execution_manifest_entries_no_truncate"
BEFORE TRUNCATE ON "rank_execution_manifest_entries"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_rank_execution_manifest_truncate"();

COMMIT;

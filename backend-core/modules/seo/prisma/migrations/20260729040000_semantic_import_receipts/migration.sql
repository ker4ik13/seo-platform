CREATE TYPE "SemanticImportReceiptStatus" AS ENUM (
  'RECEIVING',
  'COMPLETED'
);

ALTER TABLE "keywords"
  ADD COLUMN "source_mode" "DataSourceMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_id" UUID,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "keyword_groups"
  ADD COLUMN "path" TEXT,
  ADD COLUMN "path_hash" CHAR(64);

WITH RECURSIVE "group_tree" AS (
  SELECT
    "id",
    "parent_id",
    ARRAY[
      btrim(
        regexp_replace(
          normalize("name", NFKC),
          '\s+',
          ' ',
          'g'
        )
      )
    ]::TEXT[] AS "segments"
  FROM "keyword_groups"
  WHERE "parent_id" IS NULL

  UNION ALL

  SELECT
    "child"."id",
    "child"."parent_id",
    "parent"."segments" || btrim(
      regexp_replace(
        normalize("child"."name", NFKC),
        '\s+',
        ' ',
        'g'
      )
    )
  FROM "keyword_groups" AS "child"
  JOIN "group_tree" AS "parent"
    ON "child"."parent_id" = "parent"."id"
  WHERE cardinality("parent"."segments") < 100
)
UPDATE "keyword_groups" AS "target"
SET
  "path" = array_to_string("tree"."segments", ' / '),
  "path_hash" = encode(
    sha256(
      convert_to(
        lower(array_to_string("tree"."segments", chr(31))),
        'UTF8'
      )
    ),
    'hex'
  )
FROM "group_tree" AS "tree"
WHERE "target"."id" = "tree"."id";

CREATE UNIQUE INDEX "keyword_groups_project_id_path_hash_key"
  ON "keyword_groups"("project_id", "path_hash");

CREATE TABLE "tags" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "keyword_tags" (
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "keyword_tags_pkey" PRIMARY KEY ("keyword_id", "tag_id"),
  CONSTRAINT "keyword_tags_keyword_id_fkey"
    FOREIGN KEY ("keyword_id") REFERENCES "keywords"("id") ON DELETE CASCADE,
  CONSTRAINT "keyword_tags_tag_id_fkey"
    FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tags_project_id_normalized_name_key"
  ON "tags"("project_id", "normalized_name");
CREATE INDEX "tags_workspace_project_status_name_idx"
  ON "tags"("workspace_id", "project_id", "status", "name");
CREATE INDEX "keyword_tags_project_tag_keyword_idx"
  ON "keyword_tags"("project_id", "tag_id", "keyword_id");

CREATE TABLE "semantic_import_receipts" (
  "import_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "status" "SemanticImportReceiptStatus" NOT NULL DEFAULT 'RECEIVING',
  "mapping_hash" CHAR(64) NOT NULL,
  "duplicate_policy" VARCHAR(32) NOT NULL,
  "expected_chunks" INTEGER NOT NULL,
  "expected_unique_rows" BIGINT NOT NULL,
  "semantic_version_id" UUID,
  "result_summary" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "semantic_import_receipts_pkey" PRIMARY KEY ("import_id")
);

CREATE TABLE "semantic_import_chunk_receipts" (
  "import_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "input_rows" INTEGER NOT NULL,
  "created_keywords" BIGINT NOT NULL DEFAULT 0,
  "updated_keywords" BIGINT NOT NULL DEFAULT 0,
  "skipped_keywords" BIGINT NOT NULL DEFAULT 0,
  "created_groups" BIGINT NOT NULL DEFAULT 0,
  "created_pages" BIGINT NOT NULL DEFAULT 0,
  "created_tags" BIGINT NOT NULL DEFAULT 0,
  "created_metric_snapshots" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "semantic_import_chunk_receipts_pkey"
    PRIMARY KEY ("import_id", "chunk_index"),
  CONSTRAINT "semantic_import_chunk_receipts_import_id_fkey"
    FOREIGN KEY ("import_id")
    REFERENCES "semantic_import_receipts"("import_id")
    ON DELETE CASCADE
);

CREATE INDEX "semantic_import_receipts_workspace_project_status_created_idx"
  ON "semantic_import_receipts"(
    "workspace_id",
    "project_id",
    "status",
    "created_at"
  );

CREATE TYPE "SemanticCustomColumnType" AS ENUM (
  'TEXT',
  'LONG_TEXT',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'SELECT',
  'MULTI_SELECT',
  'URL',
  'USER',
  'STATUS'
);

CREATE TABLE "semantic_custom_columns" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "normalized_name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "type" "SemanticCustomColumnType" NOT NULL,
  "config" JSONB NOT NULL,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "semantic_custom_columns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "semantic_custom_columns_name_not_blank"
    CHECK (length(btrim("name")) BETWEEN 1 AND 160),
  CONSTRAINT "semantic_custom_columns_description_bounded"
    CHECK ("description" IS NULL OR length("description") <= 2000),
  CONSTRAINT "semantic_custom_columns_config_object"
    CHECK (jsonb_typeof("config") = 'object'),
  CONSTRAINT "semantic_custom_columns_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "semantic_custom_columns_delete_consistent"
    CHECK (
      ("status" = 'ACTIVE' AND "deleted_at" IS NULL)
      OR ("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "semantic_custom_columns_tenant_project_id_key"
ON "semantic_custom_columns"("workspace_id", "project_id", "id");

CREATE UNIQUE INDEX "semantic_custom_columns_active_name_key"
ON "semantic_custom_columns"(
  "workspace_id",
  "project_id",
  "normalized_name"
)
WHERE "status" = 'ACTIVE';

CREATE INDEX "semantic_custom_columns_project_status_name_idx"
ON "semantic_custom_columns"(
  "workspace_id",
  "project_id",
  "status",
  "name",
  "id"
);

CREATE TABLE "semantic_keyword_custom_values" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "keyword_id" UUID NOT NULL,
  "column_id" UUID NOT NULL,
  "text_value" TEXT,
  "integer_value" BIGINT,
  "decimal_value" DECIMAL(30, 10),
  "boolean_value" BOOLEAN,
  "date_value" DATE,
  "datetime_value" TIMESTAMPTZ(6),
  "string_array_value" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "semantic_keyword_custom_values_pkey"
    PRIMARY KEY ("keyword_id", "column_id"),
  CONSTRAINT "semantic_keyword_custom_values_version_positive"
    CHECK ("version" > 0),
  CONSTRAINT "semantic_keyword_custom_values_exactly_one"
    CHECK (
      num_nonnulls(
        "text_value",
        "integer_value",
        "decimal_value",
        "boolean_value",
        "date_value",
        "datetime_value",
        "user_id"
      ) + CASE
        WHEN cardinality("string_array_value") > 0 THEN 1
        ELSE 0
      END = 1
    ),
  CONSTRAINT "semantic_keyword_custom_values_keyword_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "keyword_id")
    REFERENCES "keywords"("workspace_id", "project_id", "id")
    ON DELETE CASCADE,
  CONSTRAINT "semantic_keyword_custom_values_column_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "column_id")
    REFERENCES "semantic_custom_columns"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT
);

CREATE INDEX "semantic_keyword_custom_values_text_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "text_value"
);

CREATE INDEX "semantic_keyword_custom_values_integer_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "integer_value"
);

CREATE INDEX "semantic_keyword_custom_values_decimal_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "decimal_value"
);

CREATE INDEX "semantic_keyword_custom_values_boolean_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "boolean_value"
);

CREATE INDEX "semantic_keyword_custom_values_date_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "date_value"
);

CREATE INDEX "semantic_keyword_custom_values_datetime_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "datetime_value"
);

CREATE INDEX "semantic_keyword_custom_values_user_idx"
ON "semantic_keyword_custom_values"(
  "workspace_id",
  "project_id",
  "column_id",
  "user_id"
);

CREATE INDEX "semantic_keyword_custom_values_array_idx"
ON "semantic_keyword_custom_values"
USING GIN ("string_array_value");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "keywords"
    WHERE "custom_values" <> '{}'::jsonb
      AND ("created_by" IS NULL OR "updated_by" IS NULL)
  ) THEN
    RAISE EXCEPTION
      'typed custom-column backfill requires actor provenance for every legacy custom value'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "keywords" AS "keyword"
    CROSS JOIN LATERAL jsonb_object_keys(
      "keyword"."custom_values"
    ) AS "keys"("key")
    GROUP BY
      "keyword"."id",
      lower(btrim(normalize("keys"."key", NFKC)))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'typed custom-column backfill found case-insensitive duplicate keys'
      USING ERRCODE = '23505';
  END IF;
END
$$;

WITH "legacy_columns" AS (
  SELECT DISTINCT ON (
    "keyword"."workspace_id",
    "keyword"."project_id",
    lower(btrim(normalize("entry"."key", NFKC)))
  )
    "keyword"."workspace_id",
    "keyword"."project_id",
    "entry"."key" AS "name",
    lower(btrim(normalize("entry"."key", NFKC))) AS "normalized_name",
    "keyword"."created_by",
    "keyword"."updated_by"
  FROM "keywords" AS "keyword"
  CROSS JOIN LATERAL jsonb_each_text(
    "keyword"."custom_values"
  ) AS "entry"
  WHERE "keyword"."custom_values" <> '{}'::jsonb
  ORDER BY
    "keyword"."workspace_id",
    "keyword"."project_id",
    lower(btrim(normalize("entry"."key", NFKC))),
    "keyword"."created_at",
    "keyword"."id"
)
INSERT INTO "semantic_custom_columns" (
  "workspace_id",
  "project_id",
  "name",
  "normalized_name",
  "description",
  "type",
  "config",
  "created_by",
  "updated_by",
  "updated_at"
)
SELECT
  "workspace_id",
  "project_id",
  "name",
  "normalized_name",
  'Перенесено из legacy import custom values',
  'LONG_TEXT',
  '{"required":false}'::jsonb,
  "created_by",
  "updated_by",
  CURRENT_TIMESTAMP
FROM "legacy_columns";

INSERT INTO "semantic_keyword_custom_values" (
  "workspace_id",
  "project_id",
  "keyword_id",
  "column_id",
  "text_value",
  "updated_by",
  "updated_at"
)
SELECT
  "keyword"."workspace_id",
  "keyword"."project_id",
  "keyword"."id",
  "column"."id",
  "entry"."value",
  "keyword"."updated_by",
  "keyword"."updated_at"
FROM "keywords" AS "keyword"
CROSS JOIN LATERAL jsonb_each_text(
  "keyword"."custom_values"
) AS "entry"
JOIN "semantic_custom_columns" AS "column"
  ON "column"."workspace_id" = "keyword"."workspace_id"
  AND "column"."project_id" = "keyword"."project_id"
  AND "column"."normalized_name"
    = lower(btrim(normalize("entry"."key", NFKC)))
WHERE "keyword"."custom_values" <> '{}'::jsonb;

CREATE FUNCTION "validate_semantic_keyword_custom_value_type"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  "column_type" "SemanticCustomColumnType";
BEGIN
  SELECT "type"
  INTO "column_type"
  FROM "semantic_custom_columns"
  WHERE "workspace_id" = NEW."workspace_id"
    AND "project_id" = NEW."project_id"
    AND "id" = NEW."column_id"
    AND "status" = 'ACTIVE';

  IF "column_type" IS NULL THEN
    RAISE EXCEPTION 'active custom column not found'
      USING ERRCODE = '23503';
  END IF;

  IF (
    "column_type" IN ('TEXT', 'LONG_TEXT', 'SELECT', 'URL', 'STATUS')
    AND NEW."text_value" IS NULL
  ) OR (
    "column_type" = 'INTEGER'
    AND NEW."integer_value" IS NULL
  ) OR (
    "column_type" = 'DECIMAL'
    AND NEW."decimal_value" IS NULL
  ) OR (
    "column_type" = 'BOOLEAN'
    AND NEW."boolean_value" IS NULL
  ) OR (
    "column_type" = 'DATE'
    AND NEW."date_value" IS NULL
  ) OR (
    "column_type" = 'DATETIME'
    AND NEW."datetime_value" IS NULL
  ) OR (
    "column_type" = 'MULTI_SELECT'
    AND cardinality(NEW."string_array_value") = 0
  ) OR (
    "column_type" = 'USER'
    AND NEW."user_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'custom value does not match column type'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "semantic_keyword_custom_value_type_guard"
BEFORE INSERT OR UPDATE
ON "semantic_keyword_custom_values"
FOR EACH ROW
EXECUTE FUNCTION "validate_semantic_keyword_custom_value_type"();

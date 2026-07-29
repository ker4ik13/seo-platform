CREATE TYPE "SemanticImportStatus" AS ENUM (
  'QUEUED',
  'PARSING',
  'AWAITING_MAPPING',
  'READY_TO_PUBLISH',
  'PUBLISHING',
  'COMPLETED',
  'FAILED',
  'CANCEL_REQUESTED',
  'CANCELLED'
);

CREATE TABLE "semantic_imports" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "upload_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "status" "SemanticImportStatus" NOT NULL DEFAULT 'QUEUED',
  "stage" VARCHAR(64) NOT NULL DEFAULT 'queued',
  "source_format" VARCHAR(64) NOT NULL,
  "requested_encoding" VARCHAR(32) NOT NULL,
  "requested_delimiter" VARCHAR(32) NOT NULL,
  "header_mode" VARCHAR(32) NOT NULL,
  "detected_encoding" VARCHAR(32),
  "detected_delimiter" VARCHAR(32),
  "headers" JSONB,
  "suggested_mapping" JSONB,
  "sample_rows" JSONB,
  "total_rows" BIGINT NOT NULL DEFAULT 0,
  "valid_rows" BIGINT NOT NULL DEFAULT 0,
  "warning_rows" BIGINT NOT NULL DEFAULT 0,
  "error_rows" BIGINT NOT NULL DEFAULT 0,
  "progress_bytes" BIGINT NOT NULL DEFAULT 0,
  "total_bytes" BIGINT NOT NULL,
  "failure" JSONB,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "parsing_started_at" TIMESTAMPTZ(6),
  "parsing_heartbeat_at" TIMESTAMPTZ(6),
  "parsing_completed_at" TIMESTAMPTZ(6),
  "cancel_requested_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "semantic_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_import_staging_rows" (
  "import_id" UUID NOT NULL,
  "row_number" BIGINT NOT NULL,
  "raw_values" JSONB NOT NULL,
  "issues" JSONB NOT NULL DEFAULT '[]',
  "fingerprint" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "semantic_import_staging_rows_pkey"
    PRIMARY KEY ("import_id", "row_number"),
  CONSTRAINT "semantic_import_staging_rows_import_id_fkey"
    FOREIGN KEY ("import_id")
    REFERENCES "semantic_imports"("id")
    ON DELETE CASCADE
) PARTITION BY HASH ("import_id");

CREATE TABLE "semantic_import_staging_rows_p00"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE "semantic_import_staging_rows_p01"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE "semantic_import_staging_rows_p02"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE "semantic_import_staging_rows_p03"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE "semantic_import_staging_rows_p04"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE "semantic_import_staging_rows_p05"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE "semantic_import_staging_rows_p06"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE "semantic_import_staging_rows_p07"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE "semantic_import_staging_rows_p08"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE "semantic_import_staging_rows_p09"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE "semantic_import_staging_rows_p10"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE "semantic_import_staging_rows_p11"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE "semantic_import_staging_rows_p12"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE "semantic_import_staging_rows_p13"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE "semantic_import_staging_rows_p14"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE "semantic_import_staging_rows_p15"
  PARTITION OF "semantic_import_staging_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 15);

CREATE UNIQUE INDEX "semantic_imports_workspace_actor_idempotency_key_key"
  ON "semantic_imports"(
    "workspace_id",
    "actor_id",
    "idempotency_key"
  );
CREATE INDEX "semantic_imports_workspace_project_status_created_at_idx"
  ON "semantic_imports"(
    "workspace_id",
    "project_id",
    "status",
    "created_at"
  );
CREATE INDEX "semantic_imports_upload_id_status_idx"
  ON "semantic_imports"("upload_id", "status");
CREATE INDEX "semantic_imports_status_heartbeat_created_at_idx"
  ON "semantic_imports"(
    "status",
    "parsing_heartbeat_at",
    "created_at"
  );
CREATE INDEX "semantic_import_staging_rows_import_fingerprint_idx"
  ON "semantic_import_staging_rows"("import_id", "fingerprint");

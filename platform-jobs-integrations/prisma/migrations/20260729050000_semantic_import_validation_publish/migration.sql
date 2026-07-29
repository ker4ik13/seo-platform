ALTER TYPE "SemanticImportStatus"
  ADD VALUE 'VALIDATING' AFTER 'AWAITING_MAPPING';
ALTER TYPE "SemanticImportStatus"
  ADD VALUE 'AWAITING_CONFIRMATION' AFTER 'VALIDATING';

ALTER TABLE "semantic_imports"
  ADD COLUMN "confirmed_mapping" JSONB,
  ADD COLUMN "validation_summary" JSONB,
  ADD COLUMN "result_summary" JSONB,
  ADD COLUMN "validation_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "validation_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "validation_completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "publishing_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "publishing_heartbeat_at" TIMESTAMPTZ(6),
  ADD COLUMN "publishing_completed_at" TIMESTAMPTZ(6);

CREATE TABLE "semantic_import_validated_rows" (
  "import_id" UUID NOT NULL,
  "row_number" BIGINT NOT NULL,
  "normalized_hash" CHAR(64),
  "canonical_row" JSONB,
  "issues" JSONB NOT NULL DEFAULT '[]',
  "is_valid" BOOLEAN NOT NULL DEFAULT false,
  "project_duplicate" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "semantic_import_validated_rows_pkey"
    PRIMARY KEY ("import_id", "row_number"),
  CONSTRAINT "semantic_import_validated_rows_import_id_fkey"
    FOREIGN KEY ("import_id")
    REFERENCES "semantic_imports"("id")
    ON DELETE CASCADE
) PARTITION BY HASH ("import_id");

CREATE TABLE "semantic_import_validated_rows_p00"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 0);
CREATE TABLE "semantic_import_validated_rows_p01"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 1);
CREATE TABLE "semantic_import_validated_rows_p02"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 2);
CREATE TABLE "semantic_import_validated_rows_p03"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 3);
CREATE TABLE "semantic_import_validated_rows_p04"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 4);
CREATE TABLE "semantic_import_validated_rows_p05"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 5);
CREATE TABLE "semantic_import_validated_rows_p06"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 6);
CREATE TABLE "semantic_import_validated_rows_p07"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 7);
CREATE TABLE "semantic_import_validated_rows_p08"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 8);
CREATE TABLE "semantic_import_validated_rows_p09"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 9);
CREATE TABLE "semantic_import_validated_rows_p10"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 10);
CREATE TABLE "semantic_import_validated_rows_p11"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 11);
CREATE TABLE "semantic_import_validated_rows_p12"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 12);
CREATE TABLE "semantic_import_validated_rows_p13"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 13);
CREATE TABLE "semantic_import_validated_rows_p14"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 14);
CREATE TABLE "semantic_import_validated_rows_p15"
  PARTITION OF "semantic_import_validated_rows"
  FOR VALUES WITH (MODULUS 16, REMAINDER 15);

CREATE INDEX "semantic_import_validated_rows_import_hash_idx"
  ON "semantic_import_validated_rows"("import_id", "normalized_hash");
CREATE INDEX "semantic_import_validated_rows_import_valid_duplicate_idx"
  ON "semantic_import_validated_rows"(
    "import_id",
    "is_valid",
    "project_duplicate"
  );

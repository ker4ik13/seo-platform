ALTER TYPE "SemanticImportReceiptStatus" ADD VALUE IF NOT EXISTS 'ABORTED';

ALTER TABLE "semantic_import_receipts"
  ADD COLUMN "plan_code" VARCHAR(64) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "stored_keywords_limit" BIGINT NOT NULL DEFAULT 9223372036854775807,
  ADD COLUMN "keywords_per_project_limit" BIGINT NOT NULL DEFAULT 9223372036854775807,
  ADD COLUMN "reserved_keywords" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "semantic_import_receipts"
  ALTER COLUMN "plan_code" DROP DEFAULT,
  ALTER COLUMN "plan_version" DROP DEFAULT,
  ALTER COLUMN "stored_keywords_limit" DROP DEFAULT,
  ALTER COLUMN "keywords_per_project_limit" DROP DEFAULT,
  ALTER COLUMN "reserved_keywords" DROP DEFAULT;

ALTER TABLE "semantic_import_receipts"
  ADD CONSTRAINT "semantic_import_receipts_plan_code_check"
    CHECK ("plan_code" ~ '^[A-Z][A-Z0-9_-]{0,63}$'),
  ADD CONSTRAINT "semantic_import_receipts_plan_version_check"
    CHECK ("plan_version" > 0),
  ADD CONSTRAINT "semantic_import_receipts_stored_keywords_limit_check"
    CHECK ("stored_keywords_limit" > 0),
  ADD CONSTRAINT "semantic_import_receipts_keywords_per_project_limit_check"
    CHECK ("keywords_per_project_limit" > 0),
  ADD CONSTRAINT "semantic_import_receipts_reserved_keywords_check"
    CHECK ("reserved_keywords" >= 0);

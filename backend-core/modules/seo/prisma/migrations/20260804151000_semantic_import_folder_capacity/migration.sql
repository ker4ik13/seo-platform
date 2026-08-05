ALTER TABLE "semantic_import_receipts"
  ADD COLUMN "folders_per_project_limit" BIGINT NOT NULL
    DEFAULT 9223372036854775807;

ALTER TABLE "semantic_import_receipts"
  ALTER COLUMN "folders_per_project_limit" DROP DEFAULT;

ALTER TABLE "semantic_import_receipts"
  ADD CONSTRAINT "semantic_import_receipts_folders_per_project_limit_check"
    CHECK ("folders_per_project_limit" >= 0);

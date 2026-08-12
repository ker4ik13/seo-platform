BEGIN;

-- Zero is the canonical value for an unlimited capacity entitlement. Import
-- receipts keep the immutable entitlement snapshot used by the publisher, so
-- their checks must accept the same values as the execution-side import row.
-- Replacing the checks is metadata-only and does not rewrite receipt data.
ALTER TABLE "semantic_import_receipts"
  DROP CONSTRAINT "semantic_import_receipts_stored_keywords_limit_check",
  DROP CONSTRAINT "semantic_import_receipts_keywords_per_project_limit_check";

ALTER TABLE "semantic_import_receipts"
  ADD CONSTRAINT "semantic_import_receipts_stored_keywords_limit_check"
    CHECK ("stored_keywords_limit" >= 0) NOT VALID,
  ADD CONSTRAINT "semantic_import_receipts_keywords_per_project_limit_check"
    CHECK ("keywords_per_project_limit" >= 0) NOT VALID;

ALTER TABLE "semantic_import_receipts"
  VALIDATE CONSTRAINT "semantic_import_receipts_stored_keywords_limit_check";

ALTER TABLE "semantic_import_receipts"
  VALIDATE CONSTRAINT "semantic_import_receipts_keywords_per_project_limit_check";

COMMIT;

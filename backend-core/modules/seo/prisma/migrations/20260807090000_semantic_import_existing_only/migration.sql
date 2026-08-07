-- Existing receipts were created before the update-only import option and
-- must retain their original create-enabled behaviour when resumed.
ALTER TABLE "semantic_import_receipts"
ADD COLUMN "create_missing_keywords" BOOLEAN NOT NULL DEFAULT TRUE;

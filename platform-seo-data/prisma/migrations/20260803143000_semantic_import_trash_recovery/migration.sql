BEGIN;

ALTER TABLE "semantic_import_chunk_receipts"
ADD COLUMN "trashed_duplicate_candidates" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "semantic_import_chunk_receipts"
ADD CONSTRAINT "semantic_import_chunk_receipts_trash_candidates_array"
CHECK (jsonb_typeof("trashed_duplicate_candidates") = 'array');

COMMIT;

BEGIN;

-- PostgreSQL text and the bounded HTTP transport remain the only size
-- boundaries. Dropping this legacy product limit does not rewrite rows.
ALTER TABLE "keywords"
  DROP CONSTRAINT IF EXISTS "keywords_note_length";

COMMIT;
